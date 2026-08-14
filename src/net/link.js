/*
 * SMarTrChrome — die Verbindung zum SMarTrLink-Relay.
 *
 * Diese Datei läuft im Service Worker, nicht in der Seitenleiste. Grund: die
 * Seitenleiste ist zu, sobald der Nutzer sie schließt, und eine Steuersitzung
 * darf nicht davon abhängen, wo gerade ein Fenster offen ist.
 *
 * Damit erbt sie das Manifest-V3-Problem: Der Service Worker wird nach 30
 * Sekunden Untätigkeit beendet. Dagegen stehen hier zwei Dinge, und zwar
 * bewusst nur diese zwei:
 *
 *   1. Ein Herzschlag alle 20 Sekunden über die Verbindung. Verkehr auf einem
 *      WebSocket setzt den Leerlaufzähler zurück (ab Chrome 116, darum die
 *      Mindestversion im Manifest). Solange die Verbindung steht, lebt der
 *      Worker.
 *   2. Ein Wecker alle 30 Sekunden als Netz darunter. Er baut die Verbindung
 *      NICHT wieder auf. Er stellt nur fest, ob sie noch steht — und beendet
 *      die Sitzung sauber, wenn nicht. Er führt außerdem die Zeitrechnung
 *      der Sitzung fort, siehe den Block „Die Frist einer Sitzung" weiter
 *      unten.
 *
 * Punkt 2 ist der wichtige. Stilles Wiederverbinden wäre bequem und wäre
 * genau der Bruch der Vorgabe „jede Sitzung neu über SMarTrLink": Der Nutzer
 * hat eine Verbindung freigegeben, nicht das Recht, sie nachzubilden. Stirbt
 * der Worker, stirbt die Befugnis mit ihm.
 *
 * Der Herzschlag hält übrigens nur den Worker am Leben, nicht die Sitzung:
 * Der Leerlaufzähler des Relays läuft über Befehle und Ereignisse, nicht über
 * Pings. Eine Erweiterung, die nichts tut außer pingen, hält damit nichts offen.
 *
 * Diese Datei ist zugleich die Stelle, an der eine Sitzung wirklich endet.
 * Deshalb hängt hier auch die Rücknahme des Seitenrechts (net/rechte.js) —
 * nicht in der Seitenleiste, die jederzeit ohne Vorwarnung verschwinden kann.
 */

import {
  RELAY_WS,
  RELAY_BASIS,
  UNTERPROTOKOLL,
  KLIENT,
  VERSION,
  FAEHIGKEITEN,
  FRIST_AUTH,
  HERZSCHLAG_MS,
  NetzFehler,
} from "./dienste.js";
import { ausweisAusAblage } from "./konto.js";
import { rechtZurueckgeben } from "./rechte.js";
import { tabAdresse } from "./seite.js";
import { saeubern } from "./befehle.js";
import * as protokollbuch from "./protokollbuch.js";
/*
 * Der Ausführer kommt als ganzes Modul herein und nicht mit benannten Feldern.
 *
 * Grund, Befund vom 14.08.2026: `laufAbbrechen()` (Vertrag v3.5 §5) entsteht in
 * derselben Runde in `ausfuehrer.js`. Ein benannter Import auf ein Feld, das es
 * in dem Augenblick noch nicht gibt, ist kein Laufzeitfehler an einer Stelle,
 * sondern ein Ladefehler der ganzen Datei — und eine Brücke, die nicht lädt,
 * kappt auch nichts. Über das Modulobjekt kann `laufKappen()` nehmen, was da
 * ist, und die Notbremse greift in jedem Fall.
 */
import * as ausfuehrer from "./ausfuehrer.js";

const WECKER = "smartrlink-wache";
const ABLAGE = "link_sitzung";

/* Die Schrittmodi, die auf dem Draht stehen dürfen (DRAHTFORMAT §2, Vertrag
   v3.5 §11.3). Eine Positivliste, keine Aufzählung des Verbotenen: Was hier
   nicht steht, fällt auf `confirm_each` — die vorsichtigste der drei Stufen.
   Die Übersetzung in unsere eigenen Wörter (`manual`, `assist`, `auto`) macht
   der Ausführer; hier wird nur durchgereicht, was der Server gesagt hat. */
const SERVER_SCHRITTMODI = Object.freeze(["auto", "assist", "confirm_each"]);

/* Alles Flüchtige liegt im Modul, nicht im Speicher. Stirbt der Worker,
   ist es weg — und genau das soll es. */
let draht = null;
let herzschlag = null;
let authFrist = null;
let ausweisImSpeicher = null;
let sitzung = null;
/* Der Grund, den der Relay im letzten `disconnect`-Rahmen genannt hat. Er
   kommt VOR dem Schließcode an; ohne diese Zeile wäre er beim Schließen
   schon wieder vergessen. */
let letzterGrund = null;

/*
 * Kappen, was gerade läuft — die erste Handlung jeder Notbremse.
 *
 * Sie ist absichtlich synchron und wartet auf nichts: Zwischen dem Ereignis
 * und dem Zustand „nichts läuft mehr" liegt keine Netzrunde (Vertrag v3.5 §5).
 * `laufAbbrechen` ist die Fassung aus v3.5, `laufBeenden` der Bestand; welche
 * von beiden im Modul steht, entscheidet die Datei nebenan, nicht diese hier.
 */
function laufKappen() {
  try {
    const kappen =
      typeof ausfuehrer.laufAbbrechen === "function"
        ? ausfuehrer.laufAbbrechen
        : ausfuehrer.laufBeenden;
    if (typeof kappen === "function") kappen();
    return true;
  } catch (_) {
    /* Ein Fehler im Ausführer darf das Ende der Sitzung nicht aufhalten. Die
       Leitung wird gleich danach ohnehin zugemacht. */
    return false;
  }
}

/* Wer über Zustandswechsel unterrichtet wird. Die Seitenleiste hört zu,
   solange sie offen ist; ist sie zu, geht die Nachricht ins Leere. Das ist
   kein Fehler, deshalb wird der Fehlschlag verschluckt. */
function melden(nachricht) {
  /* Das Symbol-Abzeichen folgt dem Verbindungszustand. Es überlebt jede
     Navigation und jedes Schließen der Seitenleiste, anders als der grüne
     Rahmen im Tab und das Titel-Präfix — so bleibt „hier läuft eine Sitzung"
     immer sichtbar, in welchem Tab der Mensch auch ist. */
  if (nachricht && nachricht.typ === "link:zustand") {
    abzeichenSetzen(nachricht.verbunden === true);
  }
  chrome.runtime.sendMessage(nachricht).catch(() => {});
}

function abzeichenSetzen(an) {
  try {
    /* Drei Zustände statt zwei: nichts, LIVE (Sitzung mit Zuschauer) und das
       Auge (Sitzung ohne offene Seitenleiste). Das Auge ist das Zeichen für
       Arbeit im Hintergrund; es steht auch dann, wenn der Mensch in einem
       ganz anderen Fenster ist. */
    const text = an ? (unbeaufsichtigt ? "👁" : "LIVE") : "";
    chrome.action.setBadgeText({ text });
    if (an) chrome.action.setBadgeBackgroundColor({ color: unbeaufsichtigt ? "#00d4ff" : "#2aff2a" });
  } catch (_) {
    /* Ältere Chrome-Fassung ohne action-API im Worker: Der Rahmen im Tab
       bleibt das Hauptsignal, kein Grund zum Abbruch. */
  }
}

/* ------------------------------------------------------------------ *
 * Sichtbarkeit einer Cloud-Sitzung (Vertrag v3.5 §8.4)
 *
 * Drei Zeichen, gleichzeitig, nicht verhandelbar:
 *
 *   1. die Dauerzeile in der Seitenleiste (`link:cloud-sitzung`),
 *   2. das Abzeichen am Symbol,
 *   3. EINE Systemmeldung beim Start der Sitzung.
 *
 * Warum alle drei durch EINE Funktion gehen und warum die in `sitzungSchreiben`
 * hängt: Am 11.08.2026 lag eine fertige, geprüfte Wache über einem Weg, den im
 * Auslieferungsstand niemand rief. Drei Zeichen, die an drei Stellen einzeln
 * gesetzt werden, sind dieselbe Bauform — es genügt ein neuer Weg in die
 * Sitzung hinein, und eines davon fehlt. Eine Sitzung entsteht dagegen
 * ausschliesslich dadurch, dass sie geschrieben wird. Wer diesen einen Weg
 * nimmt, setzt die Zeichen mit; einen zweiten gibt es nicht.
 *
 * Die Systemmeldung hängt am Sitzungscode, die Zeile am Agentennamen: Der Name
 * kommt unter Umständen erst mit dem ersten Befehl an, und dann soll die Zeile
 * ihn nachtragen, ohne den Menschen ein zweites Mal anzupiepsen.
 * ------------------------------------------------------------------ */

const MELDUNG_ID = "smartrlink-cloud-sitzung";

/* Was zuletzt angezeigt wurde (`code|agent`) und für welchen Code die
   Systemmeldung schon lief. Beides im Modul: Stirbt der Dienstprozess, stirbt
   die Sitzung mit ihm, und dann ist auch nichts mehr anzuzeigen. */
let gezeigterStand = null;
let gemeldeterCode = null;

/**
 * Der Agentenname, wie ein Mensch ihn zu sehen bekommt.
 *
 * Er stammt vom Relay (§8.1) und damit nicht aus dieser Erweiterung. In die
 * Oberfläche geht deshalb nur, was auch der Relay durchlässt: Buchstaben,
 * Ziffern, Unterstrich und Strich. Was der AUSFÜHRER bekommt, wird davon nicht
 * berührt — dort geht der Rahmen unverändert hin, geprüft wird er dort.
 */
export function agentAnzeige(roh) {
  return saeubern(roh, 32)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 32);
}

function titelSetzen(agent, an) {
  try {
    chrome.action.setTitle({
      title: an
        ? agent
          ? `SMarTrChrome, Cloud-Sitzung aktiv, ${agent} steuert diesen Browser`
          : "SMarTrChrome, Cloud-Sitzung aktiv"
        : "SMarTrChrome, Niemand öffnen",
    });
  } catch (_) {
    /* Ältere Fassung ohne action-API: Abzeichen und Rahmen bleiben. */
  }
}

/*
 * Die Systemmeldung. Sie ist das einzige der drei Zeichen, das den Menschen
 * auch dann erreicht, wenn er in einem anderen Fenster arbeitet.
 *
 * ⚠️ Die Berechtigung `notifications` steht am 14.08.2026 NICHT im Manifest
 * (gemeldet an A-SPRACHE). Ohne sie ist `chrome.notifications` schlicht nicht
 * da. Deshalb bricht hier nichts ab: Eine fehlende Berechtigung darf den Start
 * einer Sitzung nicht verhindern, sie kostet nur eines von drei Zeichen.
 */
function systemmeldung(agent) {
  try {
    const meldungen = globalThis.chrome && chrome.notifications;
    if (!meldungen || typeof meldungen.create !== "function") return false;
    const lauf = meldungen.create(MELDUNG_ID, {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: "Cloud-Sitzung aktiv",
      message: agent
        ? `${agent} steuert jetzt diesen Browser. Zum Beenden drückst du Alt, Umschalt und S.`
        : "Ein Agent steuert jetzt diesen Browser. Zum Beenden drückst du Alt, Umschalt und S.",
      priority: 2,
    });
    if (lauf && typeof lauf.catch === "function") lauf.catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}

/** Alle drei Zeichen setzen. Gibt zurück, ob sich etwas geändert hat. */
function cloudSitzungZeigen(satz) {
  const agent = agentAnzeige(satz && satz.agent);
  const code = String((satz && satz.code) || "");
  const stand = `${code}|${agent}`;
  if (stand === gezeigterStand) return false;
  gezeigterStand = stand;

  melden({ typ: "link:cloud-sitzung", an: true, agent });
  abzeichenSetzen(true);
  titelSetzen(agent, true);

  if (code !== gemeldeterCode) {
    gemeldeterCode = code;
    systemmeldung(agent);
  }
  return true;
}

/** Und alle drei wieder wegnehmen. */
function cloudSitzungAus() {
  gezeigterStand = null;
  gemeldeterCode = null;
  melden({ typ: "link:cloud-sitzung", an: false, agent: "" });
  abzeichenSetzen(false);
  titelSetzen("", false);
  try {
    const meldungen = globalThis.chrome && chrome.notifications;
    if (meldungen && typeof meldungen.clear === "function") {
      const lauf = meldungen.clear(MELDUNG_ID);
      if (lauf && typeof lauf.catch === "function") lauf.catch(() => {});
    }
  } catch (_) {
    /* Ohne Berechtigung gibt es auch nichts wegzuräumen. */
  }
}

/* Close-Codes des Relays in Sätze, die ohne Vorwissen verständlich sind.
   Die Zuordnung folgt DRAHTFORMAT §8. */
const CODE_TEXTE = {
  1000: "Die Verbindung ist beendet.",
  4400: "Unser Dienst hat meine Anfrage nicht angenommen. Bitte baue die Verbindung neu auf.",
  4401: "Die Freigabe war nicht mehr gültig. Bitte gib die Verbindung noch einmal frei.",
  4408: "Die vereinbarte Zeit ist um. Die Verbindung ist beendet.",
  4409: "Es ist längere Zeit nichts passiert. Ich habe die Verbindung beendet.",
  4410: "Die Verbindung wurde beendet.",
  4429: "Es waren zu viele Befehle in kurzer Zeit. Ich habe die Verbindung beendet.",
};

/*
 * Der Schließgrund des Relays im Klartext.
 *
 * Der Relay sendet VOR dem Schließen `{"type":"disconnect","reason":…}` und
 * unmittelbar danach den Schließcode (DRAHTFORMAT §5.4, §8). Bis zu dieser
 * Runde wurde der Grund weggeworfen und jedes Ende mit demselben Satz erklärt
 * — auch die Fälle, in denen der Nutzer etwas tun kann. Ein Schließcode
 * beantwortet „was ist passiert", der Grund beantwortet „warum". Der Grund ist
 * der genauere von beiden und hat deshalb Vorrang; fehlt er, bleibt der Text
 * zum Code, und fehlt auch der, bleibt der ehrliche Satz „abgerissen".
 *
 * Die Liste deckt §8 vollständig ab. Ein unbekannter Grund fällt auf den Code
 * zurück, statt eine Kennung anzuzeigen, mit der niemand etwas anfangen kann.
 */
const GRUND_TEXTE = {
  /* Betrieb */
  session_expired: "Die vereinbarte Zeit ist um. Die Verbindung ist beendet.",
  session_idle: "Es ist längere Zeit nichts passiert. Ich habe die Verbindung beendet.",
  revoked_by_user: "Die Verbindung wurde beendet.",
  rate_limited: "Es waren zu viele Befehle in kurzer Zeit. Ich habe die Verbindung beendet.",
  client_disconnect: "Die Verbindung ist beendet.",

  /* Handschlag: der Antrag selbst wurde abgewiesen. */
  protocol_error:
    "Unser Dienst und ich haben uns nicht verstanden. Bitte baue die Verbindung neu auf.",
  client_unbekannt: "Dieser Browser ist für die Steuerung nicht zugelassen.",
  duration_zero_forbidden:
    "Die Freigabe hatte kein klares Ende. Eine Verbindung ohne Ende baue ich nicht auf.",
  access_level_forbidden:
    "Für diese Stufe reicht die Freigabe nicht. Bitte gib die Verbindung mit weniger Rechten frei.",
  access_ungueltig: "Die Freigabe war unvollständig. Bitte gib sie noch einmal.",
  duration_ungueltig: "Die Freigabe war unvollständig. Bitte gib sie noch einmal.",
  modus_ungueltig: "Die Freigabe war unvollständig. Bitte gib sie noch einmal.",
  idle_timeout_ungueltig: "Die Freigabe war unvollständig. Bitte gib sie noch einmal.",
  allow_leer: "Die Freigabe nannte keine Seite, auf der ich arbeiten darf.",
  allow_ungueltig: "Die freigegebene Adresse war nicht lesbar. Bitte gib die Verbindung neu frei.",
  allow_zu_weit: "Die Freigabe war zu weit gefasst. Bitte wähle eine einzelne Seite.",
  allow_zu_gross: "Die Freigabe nannte zu viele Adressen. Bitte wähle weniger.",
  ticket_im_query: "Ich habe die Freigabe auf dem falschen Weg vorgezeigt. Bitte versuche es erneut.",
  token_im_unterprotokoll:
    "Ich habe die Freigabe auf dem falschen Weg vorgezeigt. Bitte versuche es erneut.",
  unauthorized: "Die Freigabe war nicht mehr gültig. Bitte gib die Verbindung noch einmal frei.",
  ticket_replayed:
    "Diese Freigabe war schon verbraucht. Jede Verbindung braucht eine eigene. Bitte gib neu frei.",
  ausweis_fehlt: "Meine Anmeldung hat gefehlt. Melde dich bitte in der Cloud an und versuche es erneut.",
  ausweis_fremd: "Freigabe und Anmeldung gehören zu verschiedenen Konten. Ich baue nichts auf.",
};

export function schliessgrund(code, grund = null) {
  const kennung = typeof grund === "string" ? grund.trim() : "";
  if (kennung && GRUND_TEXTE[kennung]) return GRUND_TEXTE[kennung];
  return (
    CODE_TEXTE[code] ||
    "Die Verbindung ist abgerissen. Der Agent kann diesen Browser nicht mehr steuern."
  );
}

async function sitzungSchreiben(daten) {
  sitzung = daten;
  /* Hier und nur hier entsteht oder endet eine Cloud-Sitzung — also stehen
     hier auch ihre drei Zeichen (§8.4). Vor der Ablage und nicht danach: Ein
     Speicher, der klemmt, darf die Sichtbarkeit nicht kosten. */
  if (daten) cloudSitzungZeigen(daten);
  else cloudSitzungAus();
  try {
    if (daten) await chrome.storage.session.set({ [ABLAGE]: daten });
    else await chrome.storage.session.remove(ABLAGE);
  } catch (_) {
    /* Ohne Ablage funktioniert die laufende Sitzung weiter; nur der Wecker
       findet nach einem Worker-Neustart nichts mehr vor. Das führt zum
       sauberen Ende, nicht zu einer Sitzung ohne Aufsicht. */
  }
}

async function sitzungLesen() {
  if (sitzung) return sitzung;
  try {
    const daten = await chrome.storage.session.get(ABLAGE);
    sitzung = daten[ABLAGE] || null;
  } catch (_) {
    sitzung = null;
  }
  return sitzung;
}

/* ------------------------------------------------------------------ *
 * Die Frist einer Sitzung — uhrunabhängig gerechnet
 *
 * Bis zum 11.08.2026 hing das Ende einer Sitzung allein an `Date.now()`. Das
 * ist die Uhr des Rechners, und die kann jeder verstellen: zwei Stunden
 * zurück, und die Sitzung lief zwei Stunden länger. Sprang die Uhr vor, etwa
 * bei der Zeitumstellung, nach einem NTP-Sprung oder beim Aufwachen aus dem
 * Ruhezustand, endete sie zu früh oder blieb in einem halben Zustand hängen.
 *
 * Führend ist deshalb jetzt eine DAUER, gemessen mit `performance.now()`.
 * Diese Uhr zählt seit dem Start des Dienstprozesses aufwärts und lässt sich
 * nicht zurückstellen.
 *
 * `expires_at` vom Server bleibt eine ZWEITE Grenze. Sie wird beim
 * Sitzungsbeginn EINMAL in eine Dauer umgerechnet und mit der ersten
 * zusammengelegt: Es gilt die kürzere von beiden, was zuerst abläuft, beendet
 * die Sitzung. Der Server kann damit verkürzen, verlängern kann er nie. Und
 * weil aus `expires_at` sofort eine Dauer wird, wirkt ein späterer Sprung der
 * Uhr auch auf diese zweite Grenze nicht mehr.
 *
 * Der Dienstarbeiter in MV3 schläft ein. Wacht er wieder auf, beginnt
 * `performance.now()` bei null, und der Anker aus dem vorigen Leben passt
 * nicht mehr dazu. Deshalb steht im Sitzungssatz, WELCHES Leben den Anker
 * gesetzt hat:
 *
 *   - Gleiches Leben: `performance.now()` ist genau und allein zuständig.
 *     Eine Uhr, die währenddessen springt, ändert daran nichts.
 *   - Anderes Leben: Es gilt der GRÖSSERE der beiden gemessenen Verbräuche,
 *     also die Laufzeit dieses Prozesses und der Abstand auf der Wanduhr. So
 *     geht der Schlaf nicht als geschenkte Zeit durch, und eine zurückgestellte
 *     Uhr schenkt trotzdem nichts.
 *
 * Der Wecker (alle 30 Sekunden, derselbe, der die Leitung prüft) schreibt den
 * Verbrauch fest und setzt den Anker neu. Was einmal verbraucht ist, liegt
 * damit in der Ablage und überlebt das Ende des Dienstprozesses.
 * ------------------------------------------------------------------ */

/* Die Kennung dieses Dienstprozesses. Sie liegt im Modul, nicht in der
   Ablage — stirbt der Prozess, ist sie weg, und genau daran erkennt der
   nächste Prozess, dass der Anker nicht ihm gehört. */
const LEBEN = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
export const LEBEN_KENNUNG = LEBEN;

/* Die uhrunabhängige Messung. Fehlt `performance` (sehr alte Umgebung oder
   Prüfstand), bleibt nur die Wanduhr — dann ist die Sicherung schwächer, aber
   die Sitzung läuft nicht ohne jede Frist weiter. */
function monoton() {
  const p = globalThis.performance;
  if (p && typeof p.now === "function") return p.now();
  return Date.now();
}

/*
 * Aus `expiry` (Sekunden) und `expires_at` (Zeitpunkt) wird EINE Dauer in
 * Millisekunden. Führend ist `expiry`; `expires_at` darf nur kürzen.
 * Ergebnis 0 heißt: keine gültige Frist, die Sitzung wird nicht angenommen.
 */
export function dauerBestimmen({ expiry, expires_at } = {}, jetzt = Date.now()) {
  const sekunden = Number(expiry);
  const ausDauer = Number.isFinite(sekunden) && sekunden > 0 ? sekunden * 1000 : 0;
  const gemeldet = expires_at ? Date.parse(expires_at) : NaN;
  const ausServer = Number.isFinite(gemeldet) ? gemeldet - jetzt : null;

  let budget = ausDauer;
  if (ausServer !== null) {
    /* Nennt der Server nur `expires_at`, ist das die einzige Angabe. Nennt er
       beides, gilt die kürzere — nie die längere. */
    budget = budget > 0 ? Math.min(budget, ausServer) : ausServer;
  }
  return budget > 0 ? Math.floor(budget) : 0;
}

/* Ein frischer Anker: Der bisherige Verbrauch wird festgeschrieben, ab hier
   wird wieder monoton weitergezählt. */
export function ankerNeu(verbraucht = 0, jetzt = Date.now(), mono = monoton()) {
  return {
    verbrauchtMs: Math.max(0, Math.round(Number(verbraucht) || 0)),
    ankerMonoton: mono,
    ankerUhr: jetzt,
    ankerLeben: LEBEN,
  };
}

/* Wie lang die Sitzung insgesamt laufen darf. Sitzungssätze aus der Zeit vor
   dieser Runde kennen `budgetMs` nicht; für sie wird die Dauer aus den alten
   Feldern hergeleitet, damit sie nicht plötzlich ohne Frist dastehen. */
export function budgetVon(sitzungssatz) {
  if (!sitzungssatz) return 0;
  const budget = Number(sitzungssatz.budgetMs);
  if (Number.isFinite(budget) && budget > 0) return budget;
  const ende = Number(sitzungssatz.endetUm);
  const start = Number(sitzungssatz.begonnenUm);
  if (Number.isFinite(ende) && Number.isFinite(start) && ende > start) return ende - start;
  if (Number.isFinite(ende)) return Math.max(0, ende - Date.now());
  return 0;
}

/*
 * Wie viel der Dauer verbraucht ist. Siehe den Block oben: Im selben Leben
 * zählt allein die monotone Uhr, nach einem Wechsel des Dienstprozesses der
 * größere der beiden Verbräuche.
 */
export function verbrauchMessen(sitzungssatz, jetzt = Date.now(), mono = monoton()) {
  if (!sitzungssatz) return 0;
  const gesammelt = Math.max(0, Number(sitzungssatz.verbrauchtMs) || 0);
  const anker = Number(sitzungssatz.ankerMonoton);
  const gleichesLeben = sitzungssatz.ankerLeben === LEBEN && Number.isFinite(anker);

  if (gleichesLeben) return gesammelt + Math.max(0, mono - anker);

  /* Anderer Dienstprozess: `mono` zählt erst seit dem Start DIESES Prozesses
     und ist damit eine Untergrenze für die verstrichene Zeit. Die Wanduhr
     kennt den ganzen Abstand, lässt sich aber verstellen. Der größere der
     beiden Werte nimmt beiden Seiten den Vorteil. */
  const ankerUhr = Number.isFinite(Number(sitzungssatz.ankerUhr))
    ? Number(sitzungssatz.ankerUhr)
    : Number(sitzungssatz.begonnenUm);
  const nachUhr = Number.isFinite(ankerUhr) ? Math.max(0, jetzt - ankerUhr) : 0;
  const seitProzessstart = Math.max(0, mono);
  return gesammelt + Math.max(seitProzessstart, nachUhr);
}

/* Was von der Dauer noch übrig ist, in Millisekunden. */
export function restMs(sitzungssatz, jetzt = Date.now(), mono = monoton()) {
  if (!sitzungssatz) return 0;
  return Math.max(0, budgetVon(sitzungssatz) - verbrauchMessen(sitzungssatz, jetzt, mono));
}

export function fristAbgelaufen(sitzungssatz, jetzt = Date.now(), mono = monoton()) {
  if (!sitzungssatz) return false;
  return restMs(sitzungssatz, jetzt, mono) <= 0;
}

/*
 * Der Sitzungssatz, wie ihn die Seitenleiste und der Ausführer brauchen: mit
 * einem `endetUm`, das aus der uhrunabhängigen Restzeit hergeleitet ist.
 *
 * Beide rechnen `endetUm - Date.now()`, um eine Restzeit anzuzeigen. Stünde
 * dort weiter der beim Aufbau berechnete Zeitpunkt, zeigte die Karte nach
 * einem Sprung der Uhr eine Restzeit an, die es nicht gibt — und eine
 * Restzeit, die nicht stimmt, ist schlimmer als gar keine.
 */
export function sitzungMitFrist(sitzungssatz, jetzt = Date.now(), mono = monoton()) {
  if (!sitzungssatz) return sitzungssatz;
  return { ...sitzungssatz, endetUm: jetzt + restMs(sitzungssatz, jetzt, mono) };
}

/* Der öffentliche Blick auf den Zustand — für die Seitenleiste, wenn sie
   neu aufgeht und wissen muss, ob gerade etwas läuft. */
export async function zustand() {
  const gespeichert = await sitzungLesen();
  if (!gespeichert) return { verbunden: false };
  const offen = !!draht && draht.readyState === WebSocket.OPEN;
  return { ...sitzungMitFrist(gespeichert), verbunden: offen, unbeaufsichtigt };
}

/*
 * Sieht gerade jemand zu?
 *
 * Im Modulspeicher, nicht in der Ablage: Die Frage gilt nur, solange dieser
 * Dienstprozess lebt. Startet er neu, ist auch die Seitenleiste neu zu fragen,
 * und bis dahin gilt die vorsichtige Annahme, dass jemand zusieht.
 */
let unbeaufsichtigt = false;

export async function unbeaufsichtigtSetzen(an) {
  unbeaufsichtigt = !!an;
  /* Das Symbol sagt es mit: LIVE heißt „läuft und du siehst zu", das Auge
     heißt „läuft, während du woanders bist". Ohne dieses Zeichen wäre eine
     Sitzung im Hintergrund genau das, was sie nie sein darf: unbemerkt. */
  const s = await sitzungLesen();
  if (s) abzeichenSetzen(true);
  return unbeaufsichtigt;
}

export function istUnbeaufsichtigt() {
  return unbeaufsichtigt;
}

function senden(rahmen) {
  if (!draht || draht.readyState !== WebSocket.OPEN) return false;
  try {
    draht.send(JSON.stringify(rahmen));
    return true;
  } catch (_) {
    return false;
  }
}

function uhrenStoppen() {
  if (herzschlag) clearInterval(herzschlag);
  if (authFrist) clearTimeout(authFrist);
  herzschlag = null;
  authFrist = null;
}

/*
 * Aufräumen. Reihenfolge nach spec-01, 3.7: erst dem Menschen Bescheid
 * geben, dann die Verbindung zumachen. Die Debugger-Ablösung und der Abbau
 * des Rahmens gehören der Ausführungsschicht und passieren in der
 * Seitenleiste, ausgelöst durch die Meldung hier.
 *
 * Was hier NEU ist und warum: Das Seitenrecht wird an dieser Stelle
 * zurückgegeben, nicht (nur) im Panel. `chrome.permissions.request` erteilt
 * dauerhaft; wird das Panel auf irgendeinem Weg beendet, an den niemand
 * gedacht hat, überlebte das Recht sonst die Sitzung. Hier läuft es im
 * Hintergrunddienst, also auf demselben Weg, auf dem auch die Sitzung endet.
 *
 * Was hier NICHT mehr passiert: `ausweisImSpeicher` auf null setzen. Der
 * Serverwiderruf (Ebene 3 der Notbremse) braucht diesen Ausweis, und er läuft
 * NACH dem Aufräumen. Wer ihn hier löscht, schickt den Widerruf ins Leere —
 * genau das war der Fehler, den die Gegenprobe gefunden hat. Das Löschen
 * steht jetzt in `sitzungBeenden`, hinter dem Widerruf.
 */
async function aufraeumen(grund, text) {
  uhrenStoppen();
  /* Was noch in der Warteschlange des Ausführers steht, wird nicht mehr
     ausgeführt. Es bekommt trotzdem eine Antwort — der Ausführer beantwortet
     jeden Weg, auch den abgebrochenen. */
  laufKappen();
  const alt = await sitzungLesen();
  await sitzungSchreiben(null);
  try {
    await chrome.alarms.clear(WECKER);
  } catch (_) {
    /* Kein Wecker da: dann ist auch keiner zu löschen. */
  }
  if (draht) {
    const d = draht;
    draht = null;
    try {
      d.close(1000, "ende");
    } catch (_) {
      /* Schon zu. */
    }
  }
  /* Das Recht überlebt die Sitzung nicht — auch dann nicht, wenn die
     Seitenleiste längst weg ist. */
  if (alt && alt.ursprungMuster) await rechtZurueckgeben(alt.ursprungMuster);
  if (alt) melden({ typ: "link:zustand", verbunden: false, grund, klartext: text });
  return alt;
}

/*
 * Ebene 3 der Notbremse: der Widerruf beim Server.
 *
 * Nötig, weil die Ebenen davor in der Erweiterung liegen — und die gilt als
 * kompromittierbar. Der Widerruf muss auch dann greifen, wenn die Erweiterung
 * lügt. Der Aufruf ist absichtlich ohne Fehlerbehandlung nach außen: Er ist
 * eine zusätzliche Sicherung, keine Bedingung für das lokale Ende.
 *
 * Adresse ist der Relay, nicht das Gateway (DRAHTFORMAT E12) — die Sitzung
 * führt der Relay, und nur er kann sie beenden.
 */
async function serverWiderruf(code, ausweis) {
  if (!code || !ausweis) return false;
  try {
    await fetch(`${RELAY_BASIS}/api/v1/browser/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ausweis}` },
      body: JSON.stringify({ code, reason: "user_revoked" }),
      cache: "no-store",
      credentials: "omit",
    });
    return true;
  } catch (_) {
    /* Der Relay beendet die Sitzung ohnehin mit Ablauf der Dauer. */
    return false;
  }
}

/*
 * Der eine Weg, auf dem eine Sitzung endet — lokal und beim Server.
 *
 * Die Reihenfolge ist der ganze Punkt dieser Funktion:
 *
 *   1. Ausweis und Sitzungscode sichern, SOLANGE es sie noch gibt.
 *   2. Lokal abbauen (Uhren, Ablage, Leitung, Seitenrecht).
 *   3. Erst jetzt beim Server widerrufen — mit dem gesicherten Ausweis.
 *   4. Und erst danach den Ausweis aus dem Modulspeicher werfen.
 *
 * Als dritte Quelle für den Ausweis steht die Sitzungsablage bereit. Das ist
 * kein Luxus: Nach einem Neustart des Service Workers ist der Modulspeicher
 * leer, und ohne diese Quelle wäre der Widerruf ausgerechnet in dem Fall
 * wirkungslos, in dem er am nötigsten ist.
 */
async function sitzungBeenden(grund, text, { ausweis = null, widerrufen = true } = {}) {
  /* 1. Hinsehen, ohne anzufassen: Gibt es überhaupt etwas zu widerrufen? */
  const vorher = await sitzungLesen();
  const brauchtWiderruf = widerrufen && !!(vorher && vorher.code);

  /* 2. Den Ausweis sichern — VOR dem Aufräumen. Das ist die eine Zeile,
        an der Ebene 3 der Notbremse hängt. */
  let nachweis = null;
  if (brauchtWiderruf) {
    nachweis = ausweis || ausweisImSpeicher;
    if (!nachweis) {
      const ausAblage = await ausweisAusAblage();
      nachweis = ausAblage ? ausAblage.token : null;
    }
  }

  /* 3. Lokal abbauen: Uhren, Ablage, Leitung, Seitenrecht. */
  const alt = await aufraeumen(grund, text);

  /* 4. Und erst jetzt der Widerruf beim Server, mit dem gesicherten Ausweis. */
  if (brauchtWiderruf) await serverWiderruf(vorher.code, nachweis);

  /* 5. Zum Schluss der Modulspeicher. Nicht früher. */
  ausweisImSpeicher = null;
  return alt;
}

/*
 * Eine Absage an den Agenten, in der Form, die auch der Ausführer benutzt.
 *
 * Sie steht hier, weil die Brücke selbst absagen können muss, ohne den
 * Ausführer zu bemühen: abgelaufene Frist, geschlossener Tab. In beiden Fällen
 * ist die Antwort schon bekannt, und der Agent soll sie sofort hören und nicht
 * hinter einer Warteschlange.
 */
function absageRahmen(rahmen, code, satz, hinweis = null) {
  const antwort = {
    type: "result",
    id: typeof rahmen?.id === "string" ? rahmen.id : "",
    cmd: typeof rahmen?.cmd === "string" ? rahmen.cmd.slice(0, 40) : "",
    success: false,
    error: { code, message: satz, retryable: false },
  };
  if (hinweis) antwort.error.hint = hinweis;
  return antwort;
}

/*
 * Der Eintrag ins Protokollbuch (§8.3).
 *
 * Gespeichert wird der ORT, nicht der Inhalt — das Buch selbst kürzt die
 * Adresse auf Schema, Wirt und Pfad. Hier wird nur zusammengetragen, was der
 * Weg ohnehin schon weiss, und zwar so, dass kein Weg ohne Zeile bleibt:
 * gelungen, abgelehnt oder gar nicht erst versucht.
 *
 * Wirft nie. Ein Buch, das klemmt, hält keine Sitzung an.
 */
async function buchFuehren(rahmen, laufende, ergebnis, adresse) {
  try {
    await protokollbuch.eintragen({
      zeit: Date.now(),
      agent: agentAnzeige(rahmen && rahmen.agent) || (laufende && laufende.agent) || "",
      cmd: (ergebnis && ergebnis.cmd) || (rahmen && rahmen.cmd) || "",
      url: adresse || "",
      ergebnis: ergebnis && ergebnis.success
        ? "gelungen"
        : (ergebnis && ergebnis.error && ergebnis.error.code) || "abgelehnt",
      /* Die Aktionsklassen kennt der Ausführer, nicht die Brücke. Reicht er
         sie in `meta` durch, stehen sie im Buch; tut er es nicht, steht dort
         keine erfundene Klasse. */
      klassen: Array.isArray(ergebnis && ergebnis.meta && ergebnis.meta.klassen)
        ? ergebnis.meta.klassen
        : [],
    });
    return true;
  } catch (_) {
    return false;
  }
}

/*
 * Phase D — Handschlag der Ticketschiene (DRAHTFORMAT §5.1).
 *
 * Das Einweg-Ticket steht als LETZTES Element der Unterprotokollliste, der
 * Alltags-Ausweis im auth-Rahmen unter `ausweis`. Diese Verteilung ist keine
 * Geschmacksfrage:
 *
 *  - Der Relay liest das Token als letztes Unterprotokoll-Element. Bis zur
 *    Gegenprobe stand hier der Ausweis an dieser Stelle und das Ticket im
 *    Rahmen — genau vertauscht, und damit war der ganze Freigabeweg wirkungslos.
 *  - Das Ticket lebt 60 Sekunden und ist einmal einlösbar; landet es in einem
 *    Proxy-Zugriffslog, ist es dort längst tot. Der Ausweis gilt 24 Stunden
 *    fürs ganze Konto und gehört deshalb nur in den verschlüsselten Rumpf.
 *
 * `access`, `duration`, `mode`, `allow` und `step_mode` sind im auth-Rahmen
 * VERBOTEN. Der Relay nimmt sie aus dem signierten Ticket; eine Behauptung der
 * Erweiterung wäre keine Tatsache — und der Relay quittiert sie mit 4400.
 */
export function verbinden({ ticket, ausweis, ursprungMuster = null, tabId = null, fortsetzung = null }) {
  return new Promise((fertig, fehlgeschlagen) => {
    if (draht) {
      fehlgeschlagen(
        new NetzFehler("schon_verbunden", "Es läuft bereits eine Verbindung. Beende sie zuerst.")
      );
      return;
    }
    if (!ticket || !ausweis) {
      fehlgeschlagen(
        new NetzFehler("unvollstaendig", "Mir fehlt die Freigabe für diese Verbindung. Bitte baue sie neu auf.")
      );
      return;
    }

    let erledigt = false;
    const abbrechen = async (fehler) => {
      if (erledigt) return;
      erledigt = true;
      uhrenStoppen();
      if (draht) {
        const d = draht;
        draht = null;
        try {
          d.close(4000, "abbruch");
        } catch (_) {
          /* Schon zu. */
        }
      }
      ausweisImSpeicher = null;
      /* Kommt keine Sitzung zustande, gibt es auch nichts zu berechtigen.
         Das Recht sofort zurückzugeben ist die strengere Variante — und sie
         hängt nicht daran, dass die Seitenleiste den Fehlschlag noch erlebt. */
      if (ursprungMuster) await rechtZurueckgeben(ursprungMuster);
      fehlgeschlagen(fehler);
    };
    const beenden = (fehler) => {
      abbrechen(fehler).catch(() => {});
    };

    let ws;
    try {
      /* Ticket als letztes Element — so und nicht anders liest der Relay es. */
      ws = new WebSocket(RELAY_WS, [UNTERPROTOKOLL, ticket]);
    } catch (_) {
      fehlgeschlagen(
        new NetzFehler("netz", "Ich erreiche die Verbindungsstelle nicht. Prüfe bitte deine Internetverbindung.")
      );
      return;
    }
    draht = ws;
    ausweisImSpeicher = ausweis;
    letzterGrund = null;

    /* Der Relay lässt 20 Sekunden für den auth-Frame. Wir setzen dieselbe
       Frist auf die Antwort — sonst wartet die Seitenleiste unbegrenzt auf
       einen Dienst, der vielleicht gar nicht antwortet. */
    authFrist = setTimeout(() => {
      beenden(
        new NetzFehler(
          "frist",
          "Die Verbindungsstelle hat nicht geantwortet. Ich habe aufgehört zu warten, damit du nicht hängen bleibst."
        )
      );
    }, FRIST_AUTH);

    ws.onopen = () => {
      /* Der Relay MUSS genau `smartrlink.v2` echoen, nie das Ticket
         (DRAHTFORMAT §5.1, Schritt 5). Echot er etwas anderes, spricht am
         anderen Ende nicht der Relay, den wir meinen — oder er reicht unser
         Ticket zurück, was es in eine weitere Kopfzeile bringen würde.
         Beides ist ein Abbruchgrund, kein Schönheitsfehler. */
      if (ws.protocol !== UNTERPROTOKOLL) {
        beenden(
          new NetzFehler(
            "protokoll",
            "Die Gegenstelle hat sich nicht wie erwartet gemeldet. Aus Sicherheitsgründen baue ich keine Verbindung auf."
          )
        );
        return;
      }
      senden({
        type: "auth",
        client: KLIENT,
        version: VERSION,
        ausweis,
        capabilities: FAEHIGKEITEN,
      });
    };

    ws.onmessage = async (ereignis) => {
      let rahmen;
      try {
        rahmen = JSON.parse(ereignis.data);
      } catch (_) {
        return; /* Kein JSON: nicht unser Protokoll, wird verworfen. */
      }

      if (rahmen.type === "auth_ok" && !erledigt) {
        const jetzt = Date.now();
        /* Führend ist die Dauer, `expires_at` darf nur kürzen. Ab hier ist die
           Wanduhr aus der Rechnung heraus: Der Rest der Sitzung wird monoton
           gemessen. */
        const budget = dauerBestimmen(rahmen, jetzt);

        /* Eine Sitzung ohne Ende nehmen wir nicht an. Der Bestand erlaubt sie
           (duration 0), die Vorgabe verbietet sie. Im Zweifel die strengere
           Variante — also auflegen. Die Prüfung steht vor `erledigt`, damit
           die Ablehnung den Aufrufer auch wirklich erreicht. Ein `expires_at`
           in der Vergangenheit fällt hier ebenfalls heraus, weil daraus keine
           Dauer größer null wird. */
        if (!budget) {
          beenden(
            new NetzFehler(
              "ohne_ende",
              "Unser Dienst wollte eine Verbindung ohne klares Ende aufbauen. Das lasse ich nicht zu."
            )
          );
          return;
        }

        /*
         * Verlängern oder nur die Leitung tauschen?
         *
         * Die Rechnung darf NUR dann bei null anfangen, wenn der Mensch
         * wirklich verlängert hat. Woran das zu erkennen ist: Ein
         * vollständiger Freigabeweg mit frischem Einweg-Ticket führt beim
         * Relay zu einer NEUEN Sitzung, also zu einem neuen `code`. Meldet der
         * Relay denselben `code` wie die laufende Sitzung, ist nichts neu
         * bewilligt worden — dann läuft die alte Rechnung weiter, und der
         * Server kann die Sitzung auch auf diesem Weg nicht verlängern.
         */
        const neuerCode = String(rahmen.code || "");
        const weiter =
          !!fortsetzung && !!fortsetzung.code && String(fortsetzung.code) === neuerCode;

        let verbraucht = 0;
        let budgetMs = budget;
        let begonnenUm = jetzt;
        if (weiter) {
          verbraucht = Math.max(0, Number(fortsetzung.verbrauchtMs) || 0);
          const alterRest = Math.max(0, (Number(fortsetzung.budgetMs) || 0) - verbraucht);
          /* Die kürzere der beiden Restzeiten gewinnt, damit ein erneuter
             Handschlag auf derselben Sitzung nichts hinzugewinnen kann. */
          budgetMs = verbraucht + Math.min(budget, alterRest);
          const alterStart = Number(fortsetzung.begonnenUm);
          if (Number.isFinite(alterStart)) begonnenUm = alterStart;
        }

        erledigt = true;
        if (authFrist) clearTimeout(authFrist);
        authFrist = null;

        /* `auth_ok` ist die EINZIGE Quelle der Befugnis (DRAHTFORMAT §5.3).
           Nicht das `granted` aus /redeem, nicht der Inhalt des Tickets, den
           die Erweiterung selbst auslesen könnte. Der Geltungsbereich ist
           flach: `allow`, `mode`, `step_mode` — ein `scope` als Adressliste
           gibt es nicht mehr. */
        await sitzungSchreiben({
          code: neuerCode,
          stufe: rahmen.access === "write" ? "write" : "read",
          bereich: Array.isArray(rahmen.allow) ? rahmen.allow.map(String) : [],
          modus: rahmen.mode === "domains" ? "domains" : "tab",
          /* Drei Werte, nicht zwei (Vertrag v3.5 §11.3): `auto`, `assist`,
             `confirm_each`. Unbekanntes fällt weiterhin auf `confirm_each` —
             wer nicht gelesen werden kann, bekommt weniger, nie mehr.
             Befund vom 14.08.2026 (Verzahnung): Solange hier `assist` auf
             `confirm_each` fiel, war die mittlere Stufe vom Server aus gar
             nicht erreichbar. Der Ausführer verrechnet die drei Werte über
             `SERVER_MODUS`, und er verrechnet sie einschränkend: Der Serverwert
             kann den lokalen Modus nur senken. */
          schrittmodus: SERVER_SCHRITTMODI.includes(rahmen.step_mode)
            ? rahmen.step_mode
            : "confirm_each",
          /* Die führende Größe: eine Dauer, keine Uhrzeit. */
          budgetMs,
          /* …und der Anker, ab dem monoton weitergezählt wird. */
          ...ankerNeu(verbraucht, jetzt),
          /* `endetUm` bleibt für die Anzeige erhalten (Seitenleiste und
             Ausführer rechnen damit die Restzeit aus). Es wird aus der Dauer
             hergeleitet und bei jedem Weckerschlag nachgeführt, ist also
             Ergebnis der Rechnung und nicht mehr ihre Grundlage. */
          endetUm: jetzt + (budgetMs - verbraucht),
          leerlaufSekunden: Number(rahmen.idle_timeout) || 0,
          begonnenUm,
          ursprungMuster,
          /* Der Tab, auf dem gearbeitet werden darf. Er steht hier und nicht
             nur in der Seitenleiste, weil der Ausführer im Hintergrunddienst
             läuft — und weil ein Befehl niemals in einem anderen Tab landen
             darf als in dem, für den der Mensch freigegeben hat. */
          tabId: Number.isInteger(tabId) ? tabId : null,
          /* Wer steuert (§8.1). Nennt der Relay den Agenten schon beim
             Handschlag, steht sein Name ab der ersten Sekunde in der
             Seitenleiste. Nennt er ihn erst mit dem ersten Befehl, wird er
             dort nachgetragen. Erfunden wird er nie: Ohne Angabe bleibt das
             Feld leer, und die Zeile sagt „Ein Agent", nicht irgendeinen
             Namen. */
          agent: agentAnzeige(rahmen.agent),
        });

        /* Neue Sitzung, neue Deckel: Der Ausführer zählt Befehle je Sitzung. */
        ausfuehrer.zaehlerNeu();

        herzschlag = setInterval(() => {
          senden({ type: "ping", ts: Math.floor(Date.now() / 1000) });
        }, HERZSCHLAG_MS);

        try {
          /* 0,5 Minuten ist der kleinste Wert, den Chrome zulässt. */
          await chrome.alarms.create(WECKER, { periodInMinutes: 0.5 });
        } catch (_) {
          /* Ohne Wecker fehlt nur das Netz unter dem Herzschlag. */
        }

        melden({ typ: "link:zustand", verbunden: true, sitzung: await zustand() });
        fertig(await zustand());
        return;
      }

      if (rahmen.type === "disconnect") {
        /* Der Relay nennt hier, WARUM er schließt — der Schließcode danach
           sagt nur, dass er es tut. Der Grund wird gemerkt, weil der Rahmen
           vor dem Schließen ankommt und `onclose` ihn sonst nicht mehr hätte. */
        letzterGrund = typeof rahmen.reason === "string" ? rahmen.reason : null;
        if (!erledigt) {
          /* Noch keine Sitzung — der Handschlag ist abgewiesen worden. Das
             Ende übernimmt `onclose`, das gleich danach kommt; hier gäbe es
             nichts abzubauen, wohl aber einen Grund zu behalten. */
          return;
        }
        /* Der Relay beendet selbst — dann weiß er es auch schon. Ein
           Widerruf wäre nur Lärm auf der Leitung. */
        await sitzungBeenden("relay", schliessgrund(4410, letzterGrund), { widerrufen: false });
        return;
      }

      if (rahmen.type === "pong" || rahmen.type === "ping") return;

      /* Rahmen mit einem uns unbekannten `type` sind keine Befehle. Ein
         Befehlsrahmen trägt gar keinen (DRAHTFORMAT §5.4, `befehlsrahmen_bauen`
         setzt `type` nie) — was einen trägt, wird verworfen statt geraten. */
      if (typeof rahmen.type === "string" && rahmen.type) return;

      /*
       * Ab hier ist es ein Befehl des Agenten — und ab hier MUSS eine Antwort
       * zurückgehen. Der Relay hat vor dem Senden eine Wartestelle angelegt
       * (app.py) und wartet dort auf einen `result`-Rahmen mit derselben `id`.
       * Ohne Antwort läuft jeder einzelne Befehl in die Zeitüberschreitung —
       * genau das war der Zustand vor dieser Runde.
       *
       * `befehlAusfuehren` wirft nicht. Der Versuch drumherum fängt trotzdem
       * ab, was niemand vorhergesehen hat: Ein Fehler in unserem Code darf
       * nicht dazu führen, dass der Agent ins Leere wartet.
       */
      const laufende = await sitzungLesen();

      /* Die Frist gilt auch zwischen zwei Weckerschlägen. Ist die Dauer
         verbraucht, wird nichts mehr ausgeführt — der Agent bekommt trotzdem
         seine Antwort, sonst wartet er bis zur Frist des Relays ins Leere. */
      if (laufende && fristAbgelaufen(laufende)) {
        const absage = absageRahmen(
          rahmen,
          "frist_abgelaufen",
          "Die vereinbarte Zeit ist um. Die Verbindung ist beendet."
        );
        senden(absage);
        await buchFuehren(rahmen, laufende, absage, "");
        await trennen("abgelaufen");
        return;
      }

      /*
       * Kein stilles Warten (§8.4).
       *
       * Die Leitung steht, aber der Tab, für den der Mensch freigegeben hat,
       * ist zu: Dann gibt es hier eine Absage und keine Warteschlange. Ein
       * Befehl, der eine Stunde später ausgeführt wird, ist ein anderer Befehl
       * — er trifft auf eine andere Seite, einen anderen Warenkorb und einen
       * Menschen, der längst etwas anderes tut.
       *
       * Der Ausführer prüft den Tab ebenfalls (Schritt 5). Diese Prüfung steht
       * trotzdem hier und davor, weil sie VOR seiner Kette liegt: Steht dort
       * gerade ein langsamer Schritt, wartete der Agent sonst auf eine Absage,
       * die schon feststeht.
       */
      const tabNummer = laufende && Number.isInteger(laufende.tabId) ? laufende.tabId : null;
      const adresse = tabNummer === null ? null : await tabAdresse(tabNummer);
      if (laufende && !adresse) {
        const absage = absageRahmen(
          rahmen,
          "tab_gone",
          tabNummer === null
            ? "Zu dieser Sitzung gehört kein Tab mehr. Ich führe nichts aus."
            : "Der Tab, den ich steuern durfte, ist nicht mehr da. Ich führe nichts aus.",
          "Den Nutzer bitten, eine neue Verbindung für den Tab freizugeben, den er meint."
        );
        senden(absage);
        await buchFuehren(rahmen, laufende, absage, "");
        melden({
          typ: "link:befehl",
          cmd: absage.cmd,
          erfolg: false,
          fehler: absage.error.code,
          klartext: absage.error.message,
        });
        return;
      }

      /* Der Agentenname aus dem Rahmen wird nachgetragen, sobald er sich
         ändert. Geprüft wird er im Ausführer (§8.1); hier geht es allein
         darum, dass in der Seitenleiste steht, WER gerade steuert. */
      if (laufende && agentAnzeige(rahmen.agent) && agentAnzeige(rahmen.agent) !== agentAnzeige(laufende.agent)) {
        await sitzungSchreiben({ ...laufende, agent: agentAnzeige(rahmen.agent) });
      }

      let ergebnis;
      try {
        /* Der Rahmen geht unverändert weiter, mitsamt `agent`. Diese Datei
           fälscht nichts hinein und lässt nichts weg: Was der Ausführer prüft,
           soll er an dem messen, was wirklich angekommen ist. */
        ergebnis = await ausfuehrer.befehlAusfuehren(
          rahmen,
          laufende ? sitzungMitFrist((await sitzungLesen()) || laufende) : {}
        );
      } catch (fehler) {
        ergebnis = {
          type: "result",
          id: typeof rahmen.id === "string" ? rahmen.id : "",
          cmd: typeof rahmen.cmd === "string" ? rahmen.cmd.slice(0, 40) : "",
          success: false,
          error: {
            code: "client_fehler",
            message: "In der Erweiterung ist etwas schiefgegangen. Der Schritt wurde nicht ausgeführt.",
            retryable: true,
          },
        };
      }
      senden(ergebnis);
      melden({
        typ: "link:befehl",
        cmd: ergebnis.cmd,
        erfolg: !!ergebnis.success,
        fehler: ergebnis.error ? ergebnis.error.code : null,
        /* Der fertige deutsche Satz reist mit. Er wurde bisher weggeworfen, und
           die Seitenleiste zeigte dem Menschen stattdessen den Maschinencode,
           also Zeilen wie „Nicht ausgeführt: scope_violation_local". Der Satz
           daneben lautet „Nach dem Wechsel steht dieser Tab auf einer Seite,
           die nicht freigegeben ist. Ich lese sie nicht." Genau der gehört ins
           Protokoll (Hausregel: Klartext statt Fehlernummer). */
        klartext: ergebnis.error ? ergebnis.error.message : null,
      });
      /*
       * Hier steht KEIN Eintrag ins Protokollbuch.
       *
       * Befund vom 14.08.2026, gemessen und nicht vermutet: Ein Befehl, der
       * den Ausführer erreicht, wird DORT gebucht — sein Eintrag trägt die
       * Aktionsklassen, die nur er kennt. Ein zweiter Eintrag an dieser Stelle
       * machte aus jeder Fernaktion zwei Zeilen, und §8.3 sagt „genau einen".
       * Die Brücke bucht deshalb ausschliesslich, was den Ausführer nie
       * erreicht hat: abgelaufene Frist, geschlossener Tab, Sitzungsende.
       */
    };

    ws.onerror = () => {
      if (!erledigt) {
        beenden(
          new NetzFehler(
            "netz",
            "Ich erreiche die Verbindungsstelle nicht. Prüfe bitte deine Internetverbindung und versuche es noch einmal."
          )
        );
      }
    };

    ws.onclose = async (ereignis) => {
      /* Der Grund aus dem `disconnect`-Rahmen ist genauer als der Schließcode
         und wird deshalb bevorzugt — er ist gerade eben angekommen. */
      const text = schliessgrund(ereignis.code, letzterGrund);
      if (!erledigt) {
        beenden(new NetzFehler("abgewiesen", text));
        return;
      }
      draht = null;
      /* Die Gegenstelle hat aufgelegt; sie weiß Bescheid. */
      await sitzungBeenden("getrennt", text, { widerrufen: false });
    };
  });
}

/*
 * Verlängern („Unbegrenzt", Entscheid des Inhabers 29.07.2026).
 *
 * Das ist KEIN stilles Wiederverbinden: Der Aufrufer hat ein frisches
 * Einweg-Ticket aus einem vollständigen Freigabeweg in der Hand — derselbe
 * Weg wie beim ersten Aufbau, vom Menschen im Dialog so bestellt. Hier wird
 * nur die Leitung getauscht: neue Verbindung aufbauen, alte stumm schalten
 * und schließen. Scheitert der Aufbau, endet die Sitzung sauber — eine halbe
 * Verlängerung gibt es nicht.
 */
export async function verlaengernMit({ ticket, ausweis }) {
  const alt = await sitzungLesen();
  if (!alt || !draht) {
    throw new NetzFehler("keine_sitzung", "Es läuft keine Verbindung, die ich verlängern könnte.");
  }
  const alterDraht = draht;
  /* Die alte Leitung wird stumm geschaltet, BEVOR die neue entsteht: Ihr
     onclose würde sonst die frisch getauschte Sitzung beenden. */
  alterDraht.onclose = null;
  alterDraht.onerror = null;
  alterDraht.onmessage = null;
  uhrenStoppen();
  /* Der Wecker gehört mit stillgelegt. `uhrenStoppen()` räumt nur Herzschlag
     und Auth-Frist weg, den 30-Sekunden-Wecker löscht sonst allein
     `aufraeumen()`, und das läuft bei einer Verlängerung nicht. Feuerte er
     während des Handschlags, sah `wacheLaufen` eine Sitzung ohne Leitung,
     riss den Tausch ab und gab das Seitenrecht zurück. Nach dem gelungenen
     Tausch legt `verbinden()` ihn selbst wieder an. */
  await Promise.resolve(chrome.alarms.clear(WECKER)).catch(() => {});
  draht = null;

  /* Der Stand der Rechnung reist mit. Er wird NUR dann weiterverwendet, wenn
     der Relay dieselbe Sitzung meldet (siehe `auth_ok`): Dann ist die Leitung
     getauscht und sonst nichts. Hat der Mensch dagegen wirklich verlängert,
     kommt eine neue Sitzung mit neuem `code` zurück, und die Rechnung beginnt
     zu Recht von vorn. */
  const uebergabe = {
    code: alt.code ? String(alt.code) : null,
    budgetMs: budgetVon(alt),
    verbrauchtMs: verbrauchMessen(alt),
    begonnenUm: Number(alt.begonnenUm),
  };

  try {
    const neu = await verbinden({
      ticket,
      ausweis,
      ursprungMuster: alt.ursprungMuster || null,
      tabId: Number.isInteger(alt.tabId) ? alt.tabId : null,
      fortsetzung: uebergabe,
    });
    try {
      alterDraht.close(1000, "verlaengert");
    } catch (_) {
      /* Schon zu. */
    }
    return neu;
  } catch (fehler) {
    /* Die alte Leitung ist ohne Handler nicht mehr betreibbar — die Sitzung
       endet deshalb ganz, mit Widerruf, statt kopflos weiterzulaufen. */
    try {
      alterDraht.close(1000, "ende");
    } catch (_) {
      /* Schon zu. */
    }
    await sitzungBeenden(
      "verloren",
      "Die Verlängerung ist fehlgeschlagen. Die Verbindung ist beendet. Baue sie bitte neu auf.",
      { ausweis, widerrufen: true }
    );
    throw fehler;
  }
}

/*
 * Trennen. `grund` steuert den Text — beendet wird die Sitzung in jedem Fall,
 * und in jedem Fall wird zusätzlich beim Server widerrufen.
 *
 * Warum immer und nicht nur bei der Notbremse: Der Widerruf ist beim Relay
 * ausdrücklich gutmütig (DRAHTFORMAT §6, `already_ended`), er kostet also
 * nichts, wenn die Sitzung dort schon vorbei ist. Umgekehrt ist er der
 * einzige Weg, eine Sitzung zu beenden, deren Leitung gerade tot ist — und
 * ob sie das ist, weiß man in dem Moment, in dem man trennt, nicht sicher.
 */
export async function trennen(grund = "nutzer", ausweis = null) {
  /*
   * Erst kappen, dann melden (Vertrag v3.5 §5).
   *
   * `laufKappen()` ist synchron und steht deshalb VOR jedem `await`. Zwischen
   * dem Ereignis und dem Zustand „nichts läuft mehr" liegt damit keine
   * Netzrunde: Weder der `disconnect`-Rahmen noch der Widerruf beim Relay noch
   * das Protokollbuch stehen davor. Der Relay kann langsam sein, offline sein
   * oder gar nicht mehr antworten — ausgeführt wird trotzdem nichts mehr.
   *
   * Die Reihenfolge ist der ganze Sinn dieser Funktion. Wer den Widerruf
   * vorzieht, baut eine Notbremse, deren Wirkung von der Gegenstelle abhängt.
   */
  laufKappen();
  const laufende = await sitzungLesen();

  senden({ type: "disconnect", reason: grund === "notbremse" ? "user_revoked" : grund });

  const texte = {
    notbremse: "Gestoppt. Der Agent kann diesen Browser nicht mehr steuern.",
    abgelaufen: "Die vereinbarte Zeit ist um. Die Verbindung ist beendet.",
    nutzer: "Die Verbindung ist beendet.",
    verloren: "Die Verbindung ist abgerissen. Der Agent kann diesen Browser nicht mehr steuern.",
  };
  await sitzungBeenden(grund, texte[grund] || texte.nutzer, { ausweis, widerrufen: true });

  /* Und zuletzt das Buch. Auch das Ende einer Sitzung ist eine Fernaktion, die
     ein Mensch später nachlesen können muss — vor allem die, die er selbst
     ausgelöst hat. */
  if (laufende) {
    await buchFuehren(
      { cmd: "disconnect", agent: laufende.agent },
      laufende,
      { cmd: "disconnect", success: false, error: { code: grund } },
      ""
    );
  }
}

/*
 * Der Wecker. Läuft alle 30 Sekunden und stellt genau drei Fragen.
 *
 * Er baut nichts wieder auf. Findet er eine gespeicherte Sitzung ohne
 * stehende Verbindung vor, dann ist der Service Worker zwischendurch beendet
 * worden — und damit ist die Befugnis erloschen, nicht nur die Leitung.
 *
 * Die Frist wird ZUERST geprüft, vor der Leitung. Zwei Gründe: Eine Sitzung,
 * deren Zeit um ist, soll das auch so heißen und nicht als „abgerissen"
 * erklärt werden. Und der Verbrauch muss auch dann gerechnet werden, wenn die
 * Leitung ohnehin schon weg ist, sonst hinge das Ergebnis davon ab, welcher
 * der beiden Fälle zufällig zuerst eintritt.
 *
 * Er ist zugleich die Stelle, an der der Verbrauch festgeschrieben wird: Bei
 * jedem Schlag wandert die bis dahin verbrauchte Dauer in die Ablage und der
 * monotone Anker wird neu gesetzt. Schläft der Dienstprozess danach ein, ist
 * höchstens die Zeit seit dem letzten Schlag ungenau, und auch die wird beim
 * Aufwachen über die Wanduhr nachgeholt.
 */
export async function wacheLaufen() {
  /* Das Protokollbuch räumt an DIESEM Wecker mit auf (§8.3) und nicht an einem
     zweiten. Ein zweiter Takt wäre ein zweiter Grund, den Dienstarbeiter zu
     wecken, und damit genau das Provisorium, das MV3 bestraft. Es steht vor
     jeder Rückkehr, damit auch der letzte Schlag einer endenden Sitzung noch
     aufräumt.
     Mit der EINGESTELLTEN Dauer, nicht mit der Voreinstellung: Befund vom
     14.08.2026 (Verzahnung). Vorher galt, was der Mensch eingestellt hatte,
     genau in dem Augenblick, in dem er den Knopf drückte, und danach wieder
     dreissig Tage. */
  await protokollbuch
    .aufbewahrungLesen()
    .then((tage) => protokollbuch.aufraeumen(tage))
    .catch(() => {});

  const gespeichert = await sitzungLesen();
  if (!gespeichert) {
    try {
      await chrome.alarms.clear(WECKER);
    } catch (_) {
      /* Kein Wecker da. */
    }
    return;
  }

  const jetzt = Date.now();
  const mono = monoton();
  const verbraucht = verbrauchMessen(gespeichert, jetzt, mono);
  const rest = Math.max(0, budgetVon(gespeichert) - verbraucht);

  if (rest <= 0) {
    await trennen("abgelaufen");
    return;
  }

  if (!draht || draht.readyState !== WebSocket.OPEN) {
    /* Die Leitung ist weg, der Relay weiß davon vielleicht nichts. Also
       lokal beenden UND beim Server widerrufen. */
    await sitzungBeenden(
      "verloren",
      "Die Verbindung ist abgerissen. Der Agent kann diesen Browser nicht mehr steuern. Baue sie bitte neu auf.",
      { widerrufen: true }
    );
    return;
  }

  /* Verbrauch festschreiben, Anker neu setzen, Anzeigezeit nachführen. */
  await sitzungSchreiben({
    ...gespeichert,
    ...ankerNeu(verbraucht, jetzt, mono),
    endetUm: jetzt + rest,
  });
}

/* ------------------------------------------------------------------ *
 * Der Anlauf des Dienstarbeiters
 *
 * MV3-Wirklichkeit: Chrome beendet den Dienstarbeiter, wenn er nichts zu tun
 * hat, und startet ihn beim nächsten Ereignis neu. Der Herzschlag über die
 * Leitung hält ihn wach, solange die Leitung steht — aber er ist keine Garantie
 * und war nie als eine gemeint. Wird der Prozess trotzdem beendet, ist die
 * Leitung weg, und mit ihr die Befugnis.
 *
 * Bis zum 14.08.2026 merkte das ausschliesslich der 30-Sekunden-Wecker. Das
 * liess zwei Lücken offen, die beide zu Lasten des Menschen gehen:
 *
 *   1. Bis zu 30 Sekunden lang behauptete das Abzeichen am Symbol eine
 *      Steuerung, die es nicht mehr gab. Ein sichtbares Zeichen, das eine
 *      Sitzung überlebt, ist schlimmer als gar keines.
 *   2. Kam der Wecker gar nicht zustande — `chrome.alarms.create` kann
 *      scheitern, und `wacheLaufen` löscht ihn selbst, sobald keine Sitzung
 *      mehr da ist —, blieb der Sitzungssatz in der Ablage liegen, ohne dass
 *      ihn jemals jemand ansah.
 *
 * Deshalb sieht der Dienstarbeiter jetzt bei JEDEM Start selbst nach. Erkannt
 * wird ein fremdes Leben an `ankerLeben`: Diese Kennung liegt im Modul und
 * stirbt mit dem Prozess. Steht in der Ablage eine andere, dann gehört die
 * Sitzung einem Prozess, den es nicht mehr gibt.
 *
 * Und was NICHT passiert: Es wird nichts wieder aufgebaut. Die Freigabe galt
 * einer Verbindung, nicht dem Recht, sie nachzubilden.
 *
 * @returns {Promise<{gefunden:boolean, beendet:boolean, grund:string}>}
 */
export async function anlaufPruefen() {
  /* Läuft in diesem Leben schon eine Sitzung, ist der Anlauf längst vorbei —
     dann ruft hier jemand ein zweites Mal, und aufzuräumen gäbe es nur die
     eigene Arbeit. Die Leitung zählt mit: Der Dienstarbeiter startet oft
     GERADE WEIL die Seitenleiste eine Verbindung aufbauen will, und zwischen
     dem `new WebSocket` und dem `auth_ok` gibt es noch keine Sitzung, wohl
     aber eine Leitung, die niemand zumachen darf. */
  if (sitzung || draht) return { gefunden: false, beendet: false, grund: "eigene_sitzung" };

  let alt = null;
  try {
    const daten = await chrome.storage.session.get(ABLAGE);
    alt = (daten && daten[ABLAGE]) || null;
  } catch (_) {
    return { gefunden: false, beendet: false, grund: "keine_ablage" };
  }
  if (!alt) {
    /* Keine Sitzung, also auch kein Zeichen dafür. Das Abzeichen am Symbol
       überlebt den Dienstarbeiter; bliebe es stehen, behauptete das Symbol
       eine Steuerung, die es nicht gibt. */
    cloudSitzungAus();
    return { gefunden: false, beendet: false, grund: "keine_sitzung" };
  }

  /* Zwischen dem Lesen und hier kann `verbinden()` eine eigene Leitung oder
     Sitzung angelegt haben. Die eigene wird nicht abgeräumt. */
  if (sitzung || draht) return { gefunden: false, beendet: false, grund: "eigene_sitzung" };
  if (alt.ankerLeben === LEBEN) {
    return { gefunden: true, beendet: false, grund: "eigene_sitzung" };
  }

  /* Ein fremdes Leben: Die Leitung dieser Sitzung ist mit ihrem Prozess
     gestorben. Sie wird ehrlich beendet, mitsamt Widerruf beim Relay — der
     weiss davon nichts und hielte sie sonst bis zum Ablauf ihrer Frist offen. */
  sitzung = alt;
  await sitzungBeenden(
    "verloren",
    "Die Verbindung ist abgerissen. Der Agent kann diesen Browser nicht mehr steuern. Baue sie bitte neu auf.",
    { widerrufen: true }
  );
  return { gefunden: true, beendet: true, grund: "fremdes_leben" };
}

export const WECKER_NAME = WECKER;
