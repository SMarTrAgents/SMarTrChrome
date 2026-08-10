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
 *      die Sitzung sauber, wenn nicht.
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
import { befehlAusfuehren, zaehlerNeu, laufBeenden } from "./ausfuehrer.js";

const WECKER = "smartrlink-wache";
const ABLAGE = "link_sitzung";

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
    chrome.action.setBadgeText({ text: an ? "LIVE" : "" });
    if (an) chrome.action.setBadgeBackgroundColor({ color: "#2aff2a" });
  } catch (_) {
    /* Ältere Chrome-Fassung ohne action-API im Worker: Der Rahmen im Tab
       bleibt das Hauptsignal, kein Grund zum Abbruch. */
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

/* Der öffentliche Blick auf den Zustand — für die Seitenleiste, wenn sie
   neu aufgeht und wissen muss, ob gerade etwas läuft. */
export async function zustand() {
  const gespeichert = await sitzungLesen();
  if (!gespeichert) return { verbunden: false };
  const offen = !!draht && draht.readyState === WebSocket.OPEN;
  return { ...gespeichert, verbunden: offen };
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
  laufBeenden();
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
export function verbinden({ ticket, ausweis, ursprungMuster = null, tabId = null }) {
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
        const dauer = Number(rahmen.expiry) || 0;
        const gemeldet = rahmen.expires_at ? Date.parse(rahmen.expires_at) : NaN;
        const endetUm = Number.isFinite(gemeldet)
          ? gemeldet
          : dauer > 0
            ? Date.now() + dauer * 1000
            : 0;

        /* Eine Sitzung ohne Ende nehmen wir nicht an. Der Bestand erlaubt sie
           (duration 0), die Vorgabe verbietet sie. Im Zweifel die strengere
           Variante — also auflegen. Die Prüfung steht vor `erledigt`, damit
           die Ablehnung den Aufrufer auch wirklich erreicht. */
        if (!endetUm || endetUm <= Date.now()) {
          beenden(
            new NetzFehler(
              "ohne_ende",
              "Unser Dienst wollte eine Verbindung ohne klares Ende aufbauen. Das lasse ich nicht zu."
            )
          );
          return;
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
          code: String(rahmen.code || ""),
          stufe: rahmen.access === "write" ? "write" : "read",
          bereich: Array.isArray(rahmen.allow) ? rahmen.allow.map(String) : [],
          modus: rahmen.mode === "domains" ? "domains" : "tab",
          schrittmodus: rahmen.step_mode === "auto" ? "auto" : "confirm_each",
          endetUm,
          leerlaufSekunden: Number(rahmen.idle_timeout) || 0,
          begonnenUm: Date.now(),
          ursprungMuster,
          /* Der Tab, auf dem gearbeitet werden darf. Er steht hier und nicht
             nur in der Seitenleiste, weil der Ausführer im Hintergrunddienst
             läuft — und weil ein Befehl niemals in einem anderen Tab landen
             darf als in dem, für den der Mensch freigegeben hat. */
          tabId: Number.isInteger(tabId) ? tabId : null,
        });

        /* Neue Sitzung, neue Deckel: Der Ausführer zählt Befehle je Sitzung. */
        zaehlerNeu();

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
      let ergebnis;
      try {
        ergebnis = await befehlAusfuehren(rahmen, laufende || {});
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

  try {
    const neu = await verbinden({
      ticket,
      ausweis,
      ursprungMuster: alt.ursprungMuster || null,
      tabId: Number.isInteger(alt.tabId) ? alt.tabId : null,
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
  senden({ type: "disconnect", reason: grund === "notbremse" ? "user_revoked" : grund });

  const texte = {
    notbremse: "Gestoppt. Der Agent kann diesen Browser nicht mehr steuern.",
    abgelaufen: "Die vereinbarte Zeit ist um. Die Verbindung ist beendet.",
    nutzer: "Die Verbindung ist beendet.",
    verloren: "Die Verbindung ist abgerissen. Der Agent kann diesen Browser nicht mehr steuern.",
  };
  await sitzungBeenden(grund, texte[grund] || texte.nutzer, { ausweis, widerrufen: true });
}

/*
 * Der Wecker. Läuft alle 30 Sekunden und stellt genau drei Fragen.
 *
 * Er baut nichts wieder auf. Findet er eine gespeicherte Sitzung ohne
 * stehende Verbindung vor, dann ist der Service Worker zwischendurch beendet
 * worden — und damit ist die Befugnis erloschen, nicht nur die Leitung.
 */
export async function wacheLaufen() {
  const gespeichert = await sitzungLesen();
  if (!gespeichert) {
    try {
      await chrome.alarms.clear(WECKER);
    } catch (_) {
      /* Kein Wecker da. */
    }
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

  if (Date.now() >= gespeichert.endetUm) {
    await trennen("abgelaufen");
  }
}

export const WECKER_NAME = WECKER;
