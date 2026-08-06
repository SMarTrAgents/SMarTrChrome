/*
 * SMarTrChrome — das Gespräch mit dem Agenten.
 *
 * Der Chat braucht KEINE Browser-Sitzung. Mit dem Agenten reden geht immer,
 * sobald ein Ausweis da ist; den Browser steuern ist ein getrennter,
 * zusätzlicher Weg (ticket.js/link.js). Diese Trennung ist Absicht: Wer nur
 * eine Frage hat, soll nicht erst eine Steuerfreigabe durchlaufen.
 *
 * Der Ablauf gegen das Gateway (gateway_live, /api/v1/chat/*):
 *
 *   1. POST /chat/message  → nimmt die Frage an und antwortet sofort mit
 *      einer Auftragsnummer (`task_id`). Die Antwort selbst entsteht im
 *      Hintergrund — so läuft nichts in den 100-Sekunden-Deckel von
 *      Cloudflare.
 *   2. GET /chat/poll/{task_id} → alle 2 Sekunden, bis `status` auf `done`
 *      oder `error` steht.
 *
 * Das Abfragen läuft im Service Worker, nicht in der Seitenleiste — aus
 * demselben Grund wie die Verbindung in link.js: Die Seitenleiste ist zu,
 * sobald der Nutzer sie schließt, und eine laufende Antwort darf daran nicht
 * sterben. Die Seitenleiste bekommt das Ergebnis als Laufzeitnachricht
 * (`chat:antwort`) und holt beim Öffnen den Stand über `chat:zustand?` nach.
 *
 * Der Wecker ist das Netz darunter: Stirbt der Worker mitten im Abfragen,
 * weckt ihn der Wecker, und das Abfragen wird aus der Sitzungsablage heraus
 * fortgesetzt. Das ist hier — anders als bei der Steuersitzung — erlaubt:
 * Eine Chat-Antwort abzuholen ist keine Befugnis, sie ist ein Botengang.
 *
 * Das Zugangstor des Gateways (`_chat_access_gate`): Seit dem H-70-Fix vom
 * 05.08.2026 braucht der CHAT IMMER ein aktives Abo — die `-app`-Ausnahme
 * gilt nur noch für die reinen Datenwege (Verlauf, Liste, Löschen, Teilen).
 * Dieser Client nennt sich weiterhin `smartrchrome-app`; ohne Abo antwortet das
 * Gateway mit 402, den Satz dazu trägt `chatFehlerText`. Der Modus (Normal oder
 * SMarTr) reist als `model_id` mit — kein Modellname wird angezeigt, nur der
 * Produktname des Modus (siehe `panel.js`).
 *
 * Backend-Interna werden hier nie angezeigt. Der Framework-Name des Agenten
 * (intern „A0", Pfade unter „/a0") wird serverseitig gefiltert; `entmarken()`
 * unten ist die zweite Verteidigungslinie im Client, damit er weder auf dem
 * Bildschirm noch beim Vorlesen je auftaucht. Die Antwort kommt von „Niemand"
 * — dabei bleibt es.
 */

import { anfragen, warten, NetzFehler } from "./dienste.js";
import { ausweisAusAblage } from "./konto.js";

/*
 * Sicherheitsnetz gegen den Framework-Namen. Der Tenant-Agent baut auf einem
 * Rahmenwerk auf, dessen Hauptagent intern „A0" heißt und dessen Pfade unter
 * „/a0" liegen. Beides darf beim Kunden NIE zu lesen sein (Markenregel; Befund
 * 06.08.2026: „A0: Calling LLM…" war im Chat sichtbar). Die eigentliche Quelle
 * wird im Gateway gefiltert — diese Funktion greift zusätzlich im Client auf
 * ALLES, was in Anzeige oder Vorlesen geht, und hält damit auch dann dicht,
 * wenn ein Serverstand die Filterung einmal verliert.
 *
 * Bewusst in Kauf genommene Unschärfe: „DIN A0" (Papierformat) würde mit
 * ersetzt. Im Produktzusammenhang praktisch bedeutungslos.
 */
export function entmarken(roh) {
  let t = String(roh == null ? "" : roh);
  /* Pfade zuerst: /a0 oder /a0/… → /sa, sonst frisst die A0-Regel das a0 darin. */
  t = t.replace(/\/a0(?=\/|\b)/gi, "/sa");
  /* Das icon://<name>-Präfix der Framework-Überschriften abschneiden — nicht
     nur am Anfang, sondern an jeder Stelle (Zeilenanfang, mehrfach): eine
     done-Antwort oder ein Verlauf kann mehrere Zeilen tragen. Die führende
     Leerstelle bleibt erhalten ($1), damit Wörter nicht zusammenkleben. */
  t = t.replace(/(^|\s)icon:\/\/\S+\s*/gi, "$1");
  /* agent zero / agent-zero / agent_zero in jeder Schreibung. */
  t = t.replace(/\bagent[\s_-]?zero\b/gi, "SMarTrAgent");
  /* Der nackte Agentenname als eigenes Wort — „_a0_connector" bleibt heil,
     weil der Unterstrich ein Wortzeichen ist und die Wortgrenze fehlt. */
  t = t.replace(/\b[Aa]0\b/g, "SMarTrAgent");
  return t;
}

/* Der Name, mit dem dieser Client durch das Chat-Zugangstor geht. Die
   `-app`-Endung ist die Bedingung des Gateways (`_is_app_client`). */
export const CHAT_KLIENT = "smartrchrome-app";

/* Abfragetakt und Obergrenze. 2 Sekunden wie beim Ticket-Abholen; die
   Obergrenze (300 × 2 s = 10 Minuten) liegt über der Arbeitsfrist des
   Gateways und unter der Lebensdauer seines Antwortspeichers (30 Minuten). */
export const CHAT_TAKT_MS = 2000;
export const CHAT_HOECHSTENS = 300;

const WECKER = "smartrchat-wache";
const ABLAGE = "chat_lauf";

/* Der laufende Botengang — im Modulspeicher, solange der Worker lebt.
   In der Ablage liegt nur, was ein Neustart zum Fortsetzen braucht:
   Auftragsnummer und Gesprächskennung. Der Ausweis liegt dort NICHT —
   den holt die Fortsetzung aus der Kontoablage (konto.js). */
let lauf = null; // { taskId, contextId, ausweis, abbruch }

function melden(nachricht) {
  chrome.runtime.sendMessage(nachricht).catch(() => {});
}

/*
 * Ehrliche Fehlertexte für den Chat. Regel (Inhaber, 28.07.): Die Meldung
 * sagt, WER schuld ist — und „versuche es noch einmal" steht nur da, wo ein
 * zweiter Versuch wirklich helfen kann. Die allgemeinen Texte aus dienste.js
 * sprechen von der Browsersteuerung; hier geht es um den Chat, also werden
 * die Statusfälle für diesen Weg übersetzt.
 */
export function chatFehlerText(fehler) {
  if (!(fehler instanceof NetzFehler)) {
    return "In der Erweiterung ist etwas schiefgegangen. Deine Frage ist nicht angekommen. Das liegt an uns, nicht an dir.";
  }
  const nachStatus = {
    402: "Dafür reicht dein Guthaben oder Abo gerade nicht. In der Cloud kannst du aufladen, dann geht es sofort weiter.",
    404: "Der Agenten-Chat ist bei uns serverseitig noch nicht eingerichtet. Du kannst hier nichts falsch machen. Das müssen wir freischalten.",
    409: "Ich arbeite noch an deiner vorigen Frage. Warte bitte, bis die Antwort da ist.",
  };
  return nachStatus[fehler.status] || fehler.klartext;
}

/*
 * Schritt 1 — die Frage abgeben. Antwortet sofort mit der Auftragsnummer.
 * `contextId` hält das Gespräch zusammen; ohne sie beginnt der Server ein
 * neues. `agent_profile` wird bewusst NIE gesendet (siehe Kopf dieser Datei).
 *
 * Der Modus reist als `model_id` — das ist die Drahtwahrheit des Gateways,
 * ein zusätzliches „mode“-Feld würde es ignorieren:
 *   - Normal Mode  → KEIN model_id im Body (exakt das bisherige Verhalten).
 *   - SMarTrMode   → model_id "ollama/smartr".
 * Die Kennung ist reine Leitungssprache. Angezeigt wird immer nur der
 * Produktname des Modus (panel.js), nie ein Modellname.
 */
export async function frageSenden({ text, contextId = null, ausweis, signal = null, modus = "normal" }) {
  const koerper = { text: String(text || "") };
  if (contextId) koerper.context_id = String(contextId);
  if (modus === "smartr") koerper.model_id = "ollama/smartr";
  const antwort = await anfragen("/api/v1/chat/message", {
    methode: "POST",
    ausweis,
    signal,
    kopfzeilen: { "X-Client": CHAT_KLIENT },
    koerper,
  });
  const taskId = String(antwort.task_id || "");
  if (!taskId) {
    throw new NetzFehler(
      "antwort_unbrauchbar",
      "Unser Dienst hat die Frage angenommen, mir aber keine Auftragsnummer gegeben. Das liegt an uns. Stelle die Frage bitte noch einmal."
    );
  }
  return { taskId, contextId: String(antwort.context_id || taskId) };
}

/*
 * Was der Agent gerade tut — aus dem Abfrageergebnis herausgeholt.
 *
 * Das Gateway sammelt während der Arbeit die Schritte des Agenten und legt sie
 * als `steps` in dieselbe Antwort, die auch den Zustand trägt. Bis zum
 * 29.07.2026 warf diese Datei sie weg: Der Mensch sah zehn Minuten lang
 * „Niemand arbeitet …" und sonst nichts. Für jemanden, der sich alles vorlesen
 * lässt, ist das von „hängt" nicht zu unterscheiden.
 *
 * Die Schritte stammen vom Agenten, nicht von der besuchten Seite. Trotzdem
 * werden sie hier gedeckelt und von Steuerzeichen befreit, bevor sie irgendwo
 * angezeigt werden: Ein Werkzeugergebnis kann Seitentext enthalten, und ein
 * Zeilenumbruch mitten in einer Protokollzeile ist für den Bildschirmleser
 * dasselbe wie ein zweiter Satz.
 */
const SCHRITT_ZEICHEN = 160;
const SCHRITTE_HOECHSTENS = 40;

export function schritteLesen(roh) {
  if (!Array.isArray(roh)) return [];
  return roh
    .slice(-SCHRITTE_HOECHSTENS)
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const text = entmarken(String(s.text || ""))
        /* Dieselbe Entschaerfung wie `zitat()` in der Seitenleiste: Steuerzeichen,
           Nullbreiten- und Richtungszeichen raus. Ein Richtungswechsel mitten in
           einer Protokollzeile kann anzeigen lassen, was dort nicht steht.

           Der Bereich ist hier BREITER als in `zitat()` (panel.js) und
           `saeubern()` (befehle.js): Die decken \u200b-\u200f ab, lassen die
           Einbettungs- und Umkehrzeichen \u202a-\u202e und die Isolatoren
           \u2066-\u2069 aber durch. Mit \u202e laesst sich eine Zeile
           rueckwaerts anzeigen — aus "exe.gnuhcer" wird sichtbar
           "rechnung.exe". Die beiden anderen Stellen gehoeren zur Zeit
           anderen Baustellen; der Befund ist gemeldet. */
        .replace(
          /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g,
          " "
        )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, SCHRITT_ZEICHEN);
      if (!text) return null;
      return {
        art: ["thinking", "tool_call", "response", "error", "info"].includes(s.type)
          ? s.type
          : "info",
        text,
        werkzeug: entmarken(String(s.tool || "")).slice(0, 40),
      };
    })
    .filter(Boolean);
}

/*
 * Schritt 2 — die Antwort abholen. Die Zustandsmaschine ist bewusst flach:
 * `processing` → weiter warten, `done` → Text zurück, `error` → der Satz des
 * Servers (er ist dort schon für Menschen geschrieben), alles andere →
 * unbrauchbar. Takt und Obergrenze sind Parameter, damit die Prüfungen die
 * Maschine ohne echte Uhr fahren können.
 *
 * `aufTakt` bekommt seit dem 29.07.2026 die Schritte mit — und zwar nur die
 * NEUEN. Das Gateway liefert bei jeder Abfrage die ganze Liste; wer sie
 * ungefiltert weiterreicht, schreibt dieselbe Zeile alle zwei Sekunden neu ins
 * Protokoll.
 */
export async function antwortAbholen({
  taskId,
  ausweis,
  signal = null,
  taktMs = CHAT_TAKT_MS,
  hoechstens = CHAT_HOECHSTENS,
  aufTakt = null,
}) {
  let gemeldet = 0;
  for (let versuch = 1; versuch <= hoechstens; versuch += 1) {
    const antwort = await anfragen(`/api/v1/chat/poll/${encodeURIComponent(taskId)}`, {
      ausweis,
      signal,
      kopfzeilen: { "X-Client": CHAT_KLIENT },
    });
    const status = String(antwort.status || "");

    const schritte = schritteLesen(antwort.steps);
    const neue = schritte.slice(gemeldet);
    if (neue.length) {
      gemeldet = schritte.length;
      melden({ typ: "chat:schritte", taskId, schritte: neue });
    }

    if (status === "done") {
      const text = entmarken(String(antwort.response || "")).trim();
      if (!text) {
        throw new NetzFehler(
          "leer",
          "Der Agent hat keine Antwort geliefert. Das liegt an uns. Stelle die Frage bitte noch einmal."
        );
      }
      return { text, contextId: String(antwort.context_id || "") };
    }

    if (status === "error") {
      /* Der Server schreibt hier bereits einen Satz für Menschen (z. B.
         „Verbindung zum Auftrag verloren — Dienst neu gestartet"). Der ist
         genauer als alles, was wir hier erfinden könnten. */
      throw new NetzFehler(
        entmarken(String(antwort.error || "agentenfehler")),
        entmarken(String(antwort.message || "").trim()) ||
          "Beim Agenten ist etwas schiefgegangen. Das liegt an uns, nicht an dir."
      );
    }

    if (status !== "processing") {
      throw new NetzFehler(
        "antwort_unbrauchbar",
        "Unser Dienst hat mir einen Zustand gemeldet, den ich nicht kenne. Das liegt an uns."
      );
    }

    if (typeof aufTakt === "function") aufTakt({ versuch });
    await warten(taktMs, signal);
  }

  throw new NetzFehler(
    "frist",
    "Der Agent braucht ungewöhnlich lange. Ich habe aufgehört zu warten. Das liegt an uns, nicht an dir."
  );
}

/* Der Kontostand — echt, vom Gateway. Kein lokales Rechnen, kein Faktor:
   Abgerechnet wird beim Server, hier wird nur angezeigt. */
export async function guthabenHolen(ausweis, signal = null) {
  const antwort = await anfragen("/api/v1/user/tokens", {
    ausweis,
    signal,
    kopfzeilen: { "X-Client": CHAT_KLIENT },
  });
  return {
    balance: Number(antwort.balance) || 0,
    used: Number(antwort.used) || 0,
    quota: Number(antwort.quota) || 0,
    tier: String(antwort.tier || ""),
  };
}

/* Der bisherige Verlauf eines Gesprächs — beim Öffnen der Seitenleiste.
   Rollen werden auf die zwei Sprecher der Oberfläche abgebildet; was keine
   Rolle oder keinen Text hat, fällt weg. */
export async function verlaufLaden({ contextId, ausweis, signal = null }) {
  const antwort = await anfragen(`/api/v1/chat/history/${encodeURIComponent(contextId)}`, {
    ausweis,
    signal,
    kopfzeilen: { "X-Client": CHAT_KLIENT },
  });
  const roh = Array.isArray(antwort.messages) ? antwort.messages : [];
  return roh
    .map((m) => ({
      wer: m && m.role === "user" ? "du" : "niemand",
      text: entmarken(String((m && m.content) || "")).trim(),
    }))
    .filter((m) => m.text);
}

/* ------------------------------------------------------------------ *
 * Der Botengang im Service Worker
 * ------------------------------------------------------------------ */

async function laufSchreiben(daten) {
  try {
    if (daten) await chrome.storage.session.set({ [ABLAGE]: daten });
    else await chrome.storage.session.remove(ABLAGE);
  } catch (_) {
    /* Ohne Ablage überlebt der Botengang keinen Worker-Neustart — die
       Seitenleiste holt sich den Stand dann über GET /chat/active nach. */
  }
}

async function laufLesen() {
  try {
    const daten = await chrome.storage.session.get(ABLAGE);
    return daten[ABLAGE] || null;
  } catch (_) {
    return null;
  }
}

async function laufEnde() {
  lauf = null;
  await laufSchreiben(null);
  try {
    await chrome.alarms.clear(WECKER);
  } catch (_) {
    /* Kein Wecker da: dann ist auch keiner zu löschen. */
  }
}

async function weiterAbholen() {
  if (!lauf) return;
  const der = lauf;
  try {
    const ergebnis = await antwortAbholen({
      taskId: der.taskId,
      ausweis: der.ausweis,
      signal: der.abbruch.signal,
    });
    await laufEnde();
    melden({
      typ: "chat:antwort",
      ok: true,
      text: ergebnis.text,
      contextId: ergebnis.contextId || der.contextId,
    });
  } catch (fehler) {
    const abgebrochen = fehler instanceof NetzFehler && fehler.kennung === "abgebrochen";
    await laufEnde();
    if (abgebrochen) return; /* Neues Gespräch angefangen — kein Fehler. */
    melden({
      typ: "chat:antwort",
      ok: false,
      kennung: (fehler && fehler.kennung) || "unerwartet",
      klartext: chatFehlerText(fehler),
      contextId: der.contextId,
    });
  }
}

/*
 * Eine Frage losschicken und das Abholen anwerfen. Antwortet der Seitenleiste
 * sofort — mit Auftrags- und Gesprächskennung oder mit einem ehrlichen Satz,
 * warum nichts losging. Es läuft höchstens ein Botengang zugleich; das
 * spiegelt den Server, der je Gespräch ohnehin nur eine Frage verarbeitet.
 */
export async function chatStarten({ text, contextId = null, ausweis, modus = "normal" }) {
  if (lauf || (await laufLesen())) {
    return {
      ok: false,
      kennung: "laeuft",
      klartext: "Ich arbeite noch an deiner vorigen Frage. Warte bitte, bis die Antwort da ist.",
    };
  }
  if (!ausweis) {
    return {
      ok: false,
      kennung: "anmeldung",
      klartext: "Dafür musst du in der Cloud angemeldet sein. Melde dich dort an, dann geht es weiter.",
    };
  }

  let start;
  try {
    start = await frageSenden({ text, contextId, ausweis, modus });
  } catch (fehler) {
    return {
      ok: false,
      kennung: (fehler && fehler.kennung) || "unerwartet",
      klartext: chatFehlerText(fehler),
    };
  }

  lauf = {
    taskId: start.taskId,
    contextId: start.contextId,
    ausweis,
    abbruch: new AbortController(),
  };
  await laufSchreiben({ taskId: start.taskId, contextId: start.contextId });
  try {
    /* Das Netz unter dem Abfragen: weckt den Worker, falls Chrome ihn
       zwischendurch beendet. 0,5 Minuten ist der kleinste erlaubte Wert. */
    await chrome.alarms.create(WECKER, { periodInMinutes: 0.5 });
  } catch (_) {
    /* Ohne Wecker fehlt nur das Netz — die Seitenleiste holt notfalls nach. */
  }

  /* Bewusst nicht `await`: Die Seitenleiste bekommt die Auftragsnummer
     sofort, das Ergebnis kommt später als `chat:antwort`. */
  weiterAbholen();

  return { ok: true, taskId: start.taskId, contextId: start.contextId };
}

/* Die offenen und frisch fertigen Aufträge beim Server — für die
   Seitenleiste beim Öffnen, wenn der Worker nichts mehr weiß. */
export async function aktiveHolen(ausweis, signal = null) {
  const antwort = await anfragen("/api/v1/chat/active", {
    ausweis,
    signal,
    kopfzeilen: { "X-Client": CHAT_KLIENT },
  });
  const tasks =
    antwort && antwort.data && Array.isArray(antwort.data.tasks) ? antwort.data.tasks : [];
  return tasks.map((t) => ({
    taskId: String(t.task_id || ""),
    status: String(t.status || ""),
    contextId: String(t.context_id || ""),
    hatAntwort: !!t.has_response,
  }));
}

/*
 * Einen beim Server noch laufenden Auftrag wieder übernehmen — der Weg, den
 * die Seitenleiste geht, wenn sie über GET /chat/active einen offenen
 * Botengang findet, den dieser Worker (nach Neustart) nicht mehr kennt.
 */
export async function chatFortsetzen({ taskId, contextId, ausweis }) {
  if (lauf) return { ok: true, taskId: lauf.taskId, contextId: lauf.contextId };
  if (!taskId || !ausweis) return { ok: false };
  lauf = { taskId, contextId: contextId || taskId, ausweis, abbruch: new AbortController() };
  await laufSchreiben({ taskId, contextId: lauf.contextId });
  try {
    await chrome.alarms.create(WECKER, { periodInMinutes: 0.5 });
  } catch (_) {
    /* Ohne Wecker fehlt nur das Netz. */
  }
  weiterAbholen();
  return { ok: true, taskId, contextId: lauf.contextId };
}

/* Für die Seitenleiste beim Öffnen: Läuft gerade ein Botengang? */
export async function chatZustand() {
  if (lauf) return { laeuft: true, taskId: lauf.taskId, contextId: lauf.contextId };
  const gespeichert = await laufLesen();
  if (gespeichert) return { laeuft: true, ...gespeichert };
  return { laeuft: false };
}

/*
 * Neues Gespräch: den laufenden Botengang beenden und den Auftrag beim
 * Server stoppen (POST /chat/cancel ist dort ausdrücklich gutmütig und
 * bucht nichts). Eine Antwort, auf die niemand mehr wartet, soll weder
 * ankommen noch weiterkosten.
 */
export async function chatAbbrechen() {
  const der = lauf || (await laufLesen());
  if (lauf && lauf.abbruch) lauf.abbruch.abort();
  await laufEnde();
  if (der && der.contextId) {
    try {
      const ausweis = der.ausweis || (await ausweisAusAblage())?.token || null;
      if (ausweis) {
        await anfragen("/api/v1/chat/cancel", {
          methode: "POST",
          ausweis,
          kopfzeilen: { "X-Client": CHAT_KLIENT },
          koerper: { context_id: der.contextId },
        });
      }
    } catch (_) {
      /* Der Stopp beim Server ist eine Höflichkeit, keine Bedingung. */
    }
  }
  return { ok: true };
}

/*
 * Der Wecker. Findet er einen abgelegten Botengang ohne laufende Schleife
 * vor, war der Worker zwischendurch tot — dann wird aus der Ablage heraus
 * fortgesetzt. Der Ausweis kommt aus der Kontoablage; ist er weg, endet der
 * Botengang ehrlich statt still.
 */
export async function wacheLaufen() {
  if (lauf) return;
  const gespeichert = await laufLesen();
  if (!gespeichert) {
    try {
      await chrome.alarms.clear(WECKER);
    } catch (_) {
      /* Kein Wecker da. */
    }
    return;
  }
  const ausweis = await ausweisAusAblage();
  if (!ausweis) {
    await laufEnde();
    melden({
      typ: "chat:antwort",
      ok: false,
      kennung: "anmeldung",
      klartext:
        "Deine Anmeldung ist zwischendurch abgelaufen. Ich konnte die Antwort nicht mehr abholen. Melde dich in der Cloud neu an.",
      contextId: gespeichert.contextId || null,
    });
    return;
  }
  lauf = {
    taskId: gespeichert.taskId,
    contextId: gespeichert.contextId,
    ausweis: ausweis.token,
    abbruch: new AbortController(),
  };
  weiterAbholen();
}

export const CHAT_WECKER_NAME = WECKER;
