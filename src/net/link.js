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
/*
 * Die Positivliste der Agenten (§8.1) — Befund BRUECKE-4 vom 14.08.2026.
 *
 * Sie ist die EINE Quelle für den Namen, den ein Mensch zu sehen bekommt. Bis
 * zu dieser Runde filterte `agentAnzeige` nur Zeichen, während `worker.js:732`
 * dieselbe Angabe gegen diese Liste hielt: Symboltitel und Systemmeldung
 * behaupteten „smartrbrowser steuert diesen Browser", ein Name, der nicht auf
 * der Liste steht, während `link:zustand?` daneben `agent=undefined` lieferte.
 * Zwei der drei Zeichen aus §8.4 behaupteten etwas, das das dritte verwarf.
 */
import { AGENTEN } from "./matrix.js";
import * as protokollbuch from "./protokollbuch.js";
/*
 * Der Sprachkatalog (Vertrag v3.5 §12).
 *
 * Warum eine Netzdatei aus `panel/` importiert, Befund M10 vom 14.08.2026:
 * Diese Datei setzt die einzigen zwei Texte, die ein Mensch ausserhalb der
 * Seitenleiste zu sehen bekommt, den Titel am Symbol und die Systemmeldung.
 * Beide standen hier als deutsche Literale und liefen an `_locales` vorbei.
 * Gemessen mit `--lang=en-US` kamen beide deutsch. Einem englischsprachigen
 * Menschen mit geschlossener Seitenleiste blieb damit kein lesbares Zeichen
 * ausser dem Abzeichen.
 *
 * `sprache.js` ist die EINE Quelle dafuer und nicht eine zweite daneben; sie
 * fasst kein Dokument an, solange niemand `textEinsetzen` ruft, und laeuft
 * deshalb auch im Dienstarbeiter. Der zweite Parameter von `t` ist die
 * deutsche Fassung, wortgleich mit `_locales/de/messages.json`.
 */
import { t } from "../panel/sprache.js";
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

/* ------------------------------------------------------------------ *
 * Die Kappmarke — der Wiedereintritt nach `await`
 *
 * DER GRUNDSATZ, um den es in dieser ganzen Datei geht:
 *
 *   **Nach einem Not-Aus darf kein Weg mehr etwas WIEDERHERSTELLEN, auch
 *   nicht ein Weg, der VOR dem Not-Aus begonnen hat.**
 *
 * Befund NOTAUS-2 vom 14.08.2026, gemessen: Fällt der Not-Aus in das `await`
 * auf `sitzungSchreiben` im `auth_ok`-Zweig, läuft der Handschlag danach zu
 * Ende und macht das Kappen rückgängig — `link_sitzung` steht wieder in der
 * Ablage, `zaehlerNeu()` setzt `aktiv` bedingungslos auf true, der Herzschlag
 * läuft, der Wecker steht wieder, und die Seitenleiste bekommt
 * `verbunden=true`, nachdem der Mensch gestoppt hat. Eine volle Sekunde nach
 * dem Not-Aus lief ein `readPage` durch und las die Seite.
 *
 * Das Gegenmittel ist eine Generationszählung und ausdrücklich KEIN
 * `AbortSignal`, obwohl der Ausführer eines benutzt. Der Unterschied ist der
 * Zweck: Ein Signal bricht ein WARTEN ab, das man selbst hält. Hier geht es um
 * etwas anderes — die `await`s in dieser Datei sind Schreibvorgänge in
 * `chrome.storage.session` und Aufrufe von `chrome.alarms`, die niemand
 * abbrechen kann und die auch gar nicht abgebrochen werden sollen. Gemessen
 * werden muss, ob die Welt beim Wiedereintritt noch dieselbe ist. Genau das
 * kann eine Zahl, die bei jedem Kappen weiterzählt, und ein Signal kann es
 * nicht: Ein Signal, das beim Wiedereintritt schon durch ein neues ersetzt
 * wurde, sagt „alles in Ordnung", obwohl dazwischen gekappt wurde.
 *
 * Jeder Weg, der nach einem `await` einen Zustand SCHREIBT, einen Wecker
 * stellt, ein Intervall startet oder ein Zeichen setzt, merkt sich die Marke
 * beim Eintritt und prüft sie danach. Passt sie nicht mehr, wird nichts
 * aufgebaut — und was schon aufgebaut wurde, wird zurückgenommen.
 *
 * Die Marke liegt im Modul und nicht in der Ablage: Stirbt der Dienstprozess,
 * stirbt jeder Weg mit ihm, der sie prüfen könnte.
 * ------------------------------------------------------------------ */

let kappmarke = 0;

/** Die Marke, die ein Weg sich beim Eintritt merkt. */
export function kappmarkeJetzt() {
  return kappmarke;
}

/** Gilt die gemerkte Marke noch, oder wurde zwischendurch gekappt? */
export function markeGilt(marke) {
  return marke === kappmarke;
}

/*
 * Weiterzählen. Synchron und ohne jedes `await`: Zwischen dem Ereignis und dem
 * Zustand „nichts wird mehr wiederhergestellt" liegt keine Netzrunde (§5).
 */
function markeWeiter() {
  kappmarke += 1;
}

/*
 * Kappen, was gerade läuft — die erste Handlung jeder Notbremse.
 *
 * Sie ist absichtlich synchron und wartet auf nichts: Zwischen dem Ereignis
 * und dem Zustand „nichts läuft mehr" liegt keine Netzrunde (Vertrag v3.5 §5).
 * `laufAbbrechen` ist die Fassung aus v3.5, `laufBeenden` der Bestand; welche
 * von beiden im Modul steht, entscheidet die Datei nebenan, nicht diese hier.
 */
function laufKappen() {
  /* Zuerst die Marke, dann der Ausführer: Wer zwischen diesen beiden Zeilen
     aus einem `await` zurückkommt, soll die neue Lage vorfinden und nicht die
     alte. Diese eine Zeile liegt auf allen sechs Wegen, auf denen eine Sitzung
     endet — `trennen()` ruft sie selbst, `aufraeumen()` ruft sie für die
     übrigen fünf. */
  markeWeiter();
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
    /* Vier Zustände statt zwei: nichts, LIVE (Sitzung mit Zuschauer), das Auge
       (Sitzung ohne offene Seitenleiste) und das Fragezeichen (eine Freigabe
       wartet auf einen Menschen, den sonst nichts erreicht). Das Auge ist das
       Zeichen für Arbeit im Hintergrund; es steht auch dann, wenn der Mensch
       in einem ganz anderen Fenster ist.

       Das Fragezeichen ist Befund BRUECKE-3 vom 14.08.2026: `panel.js:3671`
       sagt zu, der Dienst mache „mit dem Fragezeichen am Symbol auf sich
       aufmerksam" — ein GREP über `setBadgeText` fand im ganzen Baum nur
       „LIVE", das Auge und die leere Zeichenkette. Eine Zusage in der
       Oberfläche, die im Quelltext nirgends steht, ist eine Behauptung. Es
       steht VOR dem Auge, weil eine wartende Frage dringender ist als die
       Feststellung, dass niemand zusieht. */
    const text = an ? (freigabeOffen ? ABZEICHEN_FRAGE : unbeaufsichtigt ? "👁" : "LIVE") : "";
    chrome.action.setBadgeText({ text });
    if (an) {
      chrome.action.setBadgeBackgroundColor({
        color: freigabeOffen ? "#ffb020" : unbeaufsichtigt ? "#00d4ff" : "#2aff2a",
      });
    }
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
 * Der BEHAUPTETE Agentenname — entschärft, aber nicht belegt.
 *
 * Er stammt vom Relay (§8.1) und damit nicht aus dieser Erweiterung. Hier
 * werden nur die Zeichen beschnitten, auf die auch der Relay säubert. Dieser
 * Wert gehört ausschliesslich ins Protokollbuch: Dass ein fremder Name
 * angeklopft hat, ist genau die Zeile, die man später sucht
 * (`protokollbuch.js` trifft dieselbe Entscheidung in `agentAus`).
 *
 * In die OBERFLÄCHE geht er nie. Dafür gibt es `agentAnzeige`.
 */
export function agentBehauptet(roh) {
  return saeubern(roh, 32)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 32);
}

/**
 * Der BELEGTE Agentenname, wie ein Mensch ihn zu sehen bekommt.
 *
 * Befund BRUECKE-4 vom 14.08.2026, gemessen: `auth_ok` mit dem Agenten
 * „smartrbrowser" (steht NICHT in `AGENTEN`) ergab den Symboltitel
 * „SMarTrChrome, Cloud-Sitzung aktiv, smartrbrowser steuert diesen Browser",
 * die Systemmeldung „smartrbrowser steuert jetzt diesen Browser." und die
 * Dauerzeile mit demselben Namen — während `link:zustand?` daneben
 * `agent=undefined` lieferte. Drei Zeichen aus §8.4, zwei behaupteten, das
 * dritte verwarf.
 *
 * Ab jetzt gilt hier dieselbe EINE Quelle wie in `worker.js:732`: die
 * Positivliste. Was nicht darauf steht, ist kein Agent, und dann steht auch
 * kein Name da — die Zeile sagt „Ein Agent", nicht irgendeinen Namen. Das ist
 * die fail-closed-Richtung: Ein Relay oder Gateway, das den Namen aus einer
 * Selbstauskunft füllt, schreibt dem Menschen sonst einen beliebigen Namen auf
 * den Bildschirm, und diese Erweiterung kann diese Behauptung nicht belegen.
 *
 * Was der AUSFÜHRER bekommt, wird davon nicht berührt — dort geht der Rahmen
 * unverändert hin, geprüft wird er dort (§8.1, `ausfuehrer.js:2892`).
 */
export function agentAnzeige(roh) {
  const name = agentBehauptet(roh);
  return AGENTEN.includes(name) ? name : "";
}

/*
 * Der Titel am Symbol, das zweite der drei Zeichen aus §8.4.
 *
 * Befund M10 vom 14.08.2026, zwei Fehler in derselben Funktion:
 *
 *   1. Beide Saetze waren deutsche Literale. Ab jetzt kommen sie aus dem
 *      Katalog, mit der deutschen Fassung als Notfalltext.
 *   2. Der AUS-Fall schrieb „SMarTrChrome, Niemand oeffnen" fest und
 *      ueberschrieb damit dauerhaft den Titel aus dem Manifest — der steht
 *      dort als `__MSG_ext_symbol_titel__` und ist laengst uebersetzt. Die
 *      leere Zeichenkette gibt ihn zurueck, statt eine zweite, unuebersetzte
 *      Fassung daneben stehen zu lassen.
 */
function titelSetzen(agent, an) {
  try {
    const titel = !an
      ? ""
      : agent
        ? t(
            "ext_symbol_sitzung_agent",
            "SMarTrChrome, Cloud-Sitzung aktiv, $1 steuert diesen Browser",
            agent
          )
        : t("ext_symbol_sitzung", "SMarTrChrome, Cloud-Sitzung aktiv");
    chrome.action.setTitle({ title: titel });
  } catch (_) {
    /* Ältere Fassung ohne action-API: Abzeichen und Rahmen bleiben. */
  }
}

/*
 * Die Systemmeldung. Sie ist das einzige der drei Zeichen, das den Menschen
 * auch dann erreicht, wenn er in einem anderen Fenster arbeitet.
 *
 * Die Berechtigung `notifications` steht im Manifest. Trotzdem bricht hier
 * nichts ab, wenn `chrome.notifications` fehlt: Eine Fassung ohne diese API
 * darf den Start einer Sitzung nicht verhindern, sie kostet nur eines von drei
 * Zeichen.
 *
 * Der Text kommt seit dem 14.08.2026 aus dem Katalog (Befund M10). Er ist der
 * einzige Satz, der einen Menschen auch dann erreicht, wenn er in einem
 * anderen Fenster arbeitet — und genau der war fest deutsch.
 */
/*
 * Der Pfad zum Symbol einer Systemmeldung — Befund BRUECKE-8 vom 14.08.2026.
 *
 * Hier stand `iconUrl: "icons/icon-128.png"`, also ein RELATIVER Pfad. Der
 * Dienstarbeiter läuft aber als `chrome-extension://ID/src/background/worker.js`
 * und damit zwei Ordner tief. Löst Chrome den Pfad gegen die Worker-Adresse
 * auf, zeigt er auf `src/background/icons/icon-128.png`, das es nicht gibt, und
 * `chrome.notifications.create` schlägt mit „Unable to download all specified
 * images" fehl — still, denn der Fehlschlag wird hier verschluckt. Damit fiele
 * genau das eine der drei Zeichen aus §8.4 aus, das den Menschen im anderen
 * Fenster erreicht.
 *
 * `chrome.runtime.getURL` löst IMMER gegen die Erweiterungswurzel auf. Damit
 * hängt die Meldung nicht mehr daran, welche Auflösung Chrome wählt — die
 * Frage stellt sich nicht mehr. Fehlt die API (sehr alte Fassung, Prüfstand),
 * bleibt der relative Pfad; das ist der Bestand und nicht schlechter als er.
 */
function symbolAdresse() {
  try {
    if (globalThis.chrome && chrome.runtime && typeof chrome.runtime.getURL === "function") {
      return chrome.runtime.getURL("icons/icon-128.png");
    }
  } catch (_) {
    /* Ohne runtime-API bleibt der Bestand. */
  }
  return "icons/icon-128.png";
}

function systemmeldung(agent) {
  try {
    const meldungen = globalThis.chrome && chrome.notifications;
    if (!meldungen || typeof meldungen.create !== "function") return false;
    const lauf = meldungen.create(MELDUNG_ID, {
      type: "basic",
      iconUrl: symbolAdresse(),
      title: t("ext_meldung_titel", "Cloud-Sitzung aktiv"),
      message: agent
        ? t(
            "ext_meldung_text_agent",
            "$1 steuert jetzt diesen Browser. Zum Beenden drückst du Alt, Umschalt und S.",
            agent
          )
        : t(
            "ext_meldung_text",
            "Ein Agent steuert jetzt diesen Browser. Zum Beenden drückst du Alt, Umschalt und S."
          ),
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
  /* Eine offene Freigabefrage endet mit der Sitzung, auf jedem der sechs Wege
     (BRUECKE-3). Ein Fragezeichen am Symbol, das eine beendete Sitzung
     überlebt, fragt nach etwas, das niemand mehr beantworten kann — und der
     Not-Aus ist genau der Fall, in dem es sonst stehen bliebe. */
  freigabeRufAus();
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

/**
 * Eine Sitzung anlegen, fortschreiben oder wegnehmen.
 *
 * `marke` ist die Kappmarke, die der AUFRUFER sich beim Eintritt in seinen Weg
 * gemerkt hat. Sie ist die eine Stelle, an der der Grundsatz von oben baulich
 * hängt: Diese Funktion ist der einzige Weg, auf dem eine Sitzung entsteht
 * (siehe der Block zu §8.4), also genügt eine Prüfung hier, um JEDEN Weg
 * abzudecken, der eine Sitzung nach einem Not-Aus wiederherstellen könnte.
 *
 * Zweimal geprüft, davor und danach, und das ist kein Gürtel mit Hosenträgern:
 * Der Not-Aus kann VOR dem Schreiben eintreffen (dann wird gar nicht erst
 * geschrieben) oder GENAU IN das `await` fallen (dann steht der Satz schon in
 * der Ablage und muss wieder heraus). Nur der zweite Fall ist der gemessene
 * aus NOTAUS-2.
 *
 * Das LÖSCHEN (`daten === null`) läuft immer und ohne Prüfung. Es ist die
 * strengere Richtung, und die ist nie zu spät.
 */
async function sitzungSchreiben(daten, marke = kappmarke) {
  if (daten && !markeGilt(marke)) return false;
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
  if (daten && !markeGilt(marke)) {
    /* Der Not-Aus fiel in dieses `await`. Was gerade geschrieben wurde, wird
       sofort wieder zurückgenommen — mitsamt den drei Zeichen. Ein Abzeichen,
       das eine Steuerung behauptet, die es nicht mehr gibt, ist schlimmer als
       gar keines. */
    sitzung = null;
    cloudSitzungAus();
    try {
      await chrome.storage.session.remove(ABLAGE);
    } catch (_) {
      /* Ohne Ablage gibt es auch nichts zurückzunehmen. */
    }
    return false;
  }
  return true;
}

async function sitzungLesen() {
  if (sitzung) return sitzung;
  const marke = kappmarke;
  try {
    const daten = await chrome.storage.session.get(ABLAGE);
    /* Wiedereintritt nach `await`: Diese Zeile SCHREIBT den Modulspeicher.
       Fällt der Not-Aus in das Lesen, hätte sie die gerade weggeräumte Sitzung
       aus der Ablage wiederbelebt — und `sitzungTabId()`, `zustand()` und der
       Wecker hingen danach wieder an ihr. */
    if (!markeGilt(marke)) return null;
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

/**
 * Der Tab, für den die laufende Sitzung freigegeben ist — ohne `await`.
 *
 * @returns {number|null}
 *
 * Warum ohne Ablage und damit ohne Warten, Festlegung F2 vom 14.08.2026: Der
 * Not-Aus im Dienstarbeiter muss WISSEN, welchem Tab er `overlay:gestoppt`
 * schickt, und er muss es wissen, BEVOR er kappt — `trennen()` räumt die
 * Sitzung ja gerade weg. Ein `await` davor wäre die erste Runde, die zwischen
 * dem Ereignis und dem Kappen liegt, und §5 sagt: erst kappen, dann melden.
 *
 * Kennt dieser Dienstprozess keine Sitzung, gibt es auch keinen Tab zu
 * verdunkeln: Eine Sitzung aus einem fremden Leben hat `anlaufPruefen` beim
 * Start bereits beendet.
 */
export function sitzungTabId() {
  const s = sitzung;
  return s && Number.isInteger(s.tabId) ? s.tabId : null;
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
  const marke = kappmarke;
  unbeaufsichtigt = !!an;
  /* Das Symbol sagt es mit: LIVE heißt „läuft und du siehst zu", das Auge
     heißt „läuft, während du woanders bist". Ohne dieses Zeichen wäre eine
     Sitzung im Hintergrund genau das, was sie nie sein darf: unbemerkt. */
  const s = await sitzungLesen();
  /* Wiedereintritt nach `await`: Fällt der Not-Aus in das Lesen, darf das
     Abzeichen nicht wieder angehen. Es überlebt jede Navigation und jedes
     Schließen der Seitenleiste — ein Abzeichen, das eine Steuerung behauptet,
     die es nicht mehr gibt, hält sich sonst bis zum nächsten Ereignis. */
  if (s && markeGilt(marke)) abzeichenSetzen(true);
  return unbeaufsichtigt;
}

export function istUnbeaufsichtigt() {
  return unbeaufsichtigt;
}

/* ------------------------------------------------------------------ *
 * Die Freigabeanfrage, die keine Seitenleiste erreicht (§8.4, BRUECKE-3)
 *
 * Befund vom 14.08.2026, gemessen: `navigate` nach `/checkout/payment`, Klassen
 * [navigieren, zahlung], Seitenleiste zu — `link:schritt-freigabe` ging ins
 * Leere, der Agent bekam `grant_required`, und es gab NULL Systemmeldungen und
 * NULL Abzeichenwechsel. Der Zustand „niemand sieht zu" wurde geführt
 * (`istUnbeaufsichtigt`), aber von niemandem gelesen: ein GREP über den ganzen
 * Baum fand keinen einzigen Aufrufer und keinen Prüfsatz.
 *
 * Der Mensch erfuhr davon erst, wenn er die Seitenleiste wieder öffnete und ins
 * Buch sah. Bis dahin stand der Agent an der Kasse und wartete.
 *
 * Was hier gebaut wird, ist der Weg, den der Ausführer braucht — drei Stufen,
 * absteigend, und keine davon still:
 *
 *   1. Die Seitenleiste. Sie fragt der Ausführer selbst; nur er kann auf die
 *      Antwort warten.
 *   2. Erreicht sie niemanden: EINE Systemmeldung mit der Frage und das
 *      Fragezeichen am Symbol. Beide erreichen den Menschen auch in einem
 *      anderen Fenster.
 *   3. Geht auch das nicht (keine Berechtigung `notifications`, keine
 *      action-API): eine BENANNTE Absage an den Agenten. `grant_required`
 *      heißt „der Mensch hat nicht zugestimmt" — hier hat ihn niemand
 *      gefragt, und das ist eine andere Aussage.
 *
 * Warum das hier steht und nicht im Ausführer: Symbol und Systemmeldung sind
 * die Zeichen aus §8.4, und die gehören in die Datei, die sie schon setzt.
 * Zwei Stellen, die dasselbe Abzeichen schreiben, laufen auseinander — das ist
 * derselbe Fehler wie die zweite Abschrift von `saeubern` (Festlegung F4).
 * ------------------------------------------------------------------ */

/* Das Zeichen, das `panel.js:3671` dem Menschen zusagt. */
const ABZEICHEN_FRAGE = "?";
const FREIGABE_MELDUNG_ID = "smartrlink-freigabe";

/* Steht gerade eine Frage offen, die niemand in der Seitenleiste sieht? Und
   welche — die Kennung wird gebraucht, um genau DIESE Meldung wieder
   wegzunehmen und nicht irgendeine. */
let freigabeOffen = false;
let freigabeId = "";

/**
 * Die Kennung der Absage aus Stufe 3.
 *
 * Sie ist ausdrücklich NICHT `grant_required`. Der Unterschied ist der ganze
 * Sinn: `grant_required` sagt „gefragt und keine Zustimmung bekommen",
 * `grant_unreachable` sagt „ich konnte niemanden fragen". Ein Agent, der beides
 * gleich behandelt, sagt dem Menschen später das Falsche.
 */
export const FREIGABE_UNERREICHBAR = "grant_unreachable";
export const FREIGABE_UNERREICHBAR_TEXT =
  "Für diesen Schritt brauche ich eine Freigabe, und ich habe niemanden erreicht: Die Seitenleiste ist zu, und dieser Browser lässt mich weder eine Systemmeldung zeigen noch das Symbol kennzeichnen. Ich habe nichts ausgeführt.";

/**
 * Stufe 2: Den Menschen über Systemmeldung UND Abzeichen erreichen.
 *
 * @param {{frage?:string, cmd?:string, id?:string}} was
 * @returns {{erreicht:boolean, wege:string[]}} `erreicht:false` heißt Stufe 3.
 *
 * Sie ist absichtlich synchron: Sie steht im Weg einer Freigabe, und eine
 * Freigabe, die auf eine Ablage wartet, ist eine Freigabe, die eine Frist
 * verpassen kann.
 */
export function freigabeRufen({ frage = "", cmd = "", id = "", nurAbzeichen = false } = {}) {
  const wege = [];
  /* Eine vorige Frage, die noch offen steht, wird zuerst weggenommen. Zwei
     Fragezeichen gibt es am Symbol nicht, und zwei Meldungen zu derselben
     Sitzung wären Lärm statt eines Zeichens. */
  if (freigabeOffen) freigabeRufAus();
  freigabeOffen = true;
  freigabeId = String(id || "");

  /* Das Abzeichen. Es hängt am Verbindungszustand, deshalb geht es nur an,
     wenn eine Sitzung läuft — ein Fragezeichen ohne Sitzung wäre ein Zeichen
     für etwas, das es nicht gibt. */
  if (sitzung) {
    try {
      chrome.action.setBadgeText({ text: ABZEICHEN_FRAGE });
      chrome.action.setBadgeBackgroundColor({ color: "#ffb020" });
      wege.push("abzeichen");
    } catch (_) {
      /* Ältere Fassung ohne action-API. */
    }
  }

  /*
   * Die Systemmeldung. Sie trägt die Frage im Klartext, damit der Mensch nicht
   * erst die Seitenleiste öffnen muss, um zu WISSEN, worum es geht. Der Befehl
   * steht dabei, nicht die Adresse: Eine Meldung, die „soll ich auf
   * deinem-onlinebanking.example bezahlen?" auf einen fremden Bildschirm legt,
   * wäre selbst das Leck, das sie verhindern soll.
   *
   * `nurAbzeichen` gibt es aus EINEM Grund: Ein Aufrufer, der die Meldung schon
   * selbst gesetzt hat, soll hier nur das Abzeichen holen. Zwei Meldungen für
   * eine Frage sind schlimmer als eine, und ein zweites Abzeichen an einer
   * zweiten Stelle wäre der F4-Fehler — das Symbol hat genau einen Besitzer,
   * und der ist diese Datei.
   */
  if (!nurAbzeichen) {
    try {
      const meldungen = globalThis.chrome && chrome.notifications;
      if (meldungen && typeof meldungen.create === "function") {
        const lauf = meldungen.create(`${FREIGABE_MELDUNG_ID}-${freigabeId}`, {
          type: "basic",
          iconUrl: symbolAdresse(),
          /* Derselbe Schlüssel, den `ausfuehrer.js` in `menschRufen` benutzt.
             Zwei Schlüssel für denselben Satz wären zwei Übersetzungen, die
             auseinanderlaufen, sobald eine von beiden angefasst wird — und der
             Mensch sähe in derselben Lage zwei verschiedene Titel. */
          title: t("freigabe_ruf_titel", "SMarTrChrome wartet auf deine Freigabe"),
          /* Der Notfalltext ist der, den die Seitenleiste in derselben Lage
             zeigt (`freigabe_standardfrage`). Ein zweiter Satz daneben wäre
             eine zweite Abschrift derselben Aussage, und die laufen
             auseinander, sobald eine von beiden angefasst wird (F4). */
          message:
            saeubern(frage, 200) || t("freigabe_standardfrage", "Der Agent möchte einen Schritt ausführen."),
          priority: 2,
          requireInteraction: true,
        });
        if (lauf && typeof lauf.catch === "function") lauf.catch(() => {});
        wege.push("systemmeldung");
      }
    } catch (_) {
      /* Ohne Berechtigung bleibt das Abzeichen. */
    }
  }

  if (!wege.length) {
    freigabeOffen = false;
    freigabeId = "";
  }
  return { erreicht: wege.length > 0, wege };
}

/**
 * Die Frage ist beantwortet, abgelaufen oder zurückgezogen: Zeichen weg.
 *
 * Sie muss auf JEDEM Ausgang laufen, auch auf dem abgelehnten. Ein
 * Fragezeichen, das stehen bleibt, ist eine Frage, die niemand mehr
 * beantworten kann — und dem Menschen ist nicht zu erklären, warum sein Symbol
 * ihn nach etwas fragt, das längst entschieden ist.
 */
export function freigabeRufAus() {
  if (!freigabeOffen) return false;
  const id = freigabeId;
  freigabeOffen = false;
  freigabeId = "";
  /* Zurück auf das Zeichen, das zur Lage gehört: LIVE, Auge oder nichts. */
  abzeichenSetzen(!!sitzung);
  try {
    const meldungen = globalThis.chrome && chrome.notifications;
    if (meldungen && typeof meldungen.clear === "function") {
      const lauf = meldungen.clear(`${FREIGABE_MELDUNG_ID}-${id}`);
      if (lauf && typeof lauf.catch === "function") lauf.catch(() => {});
    }
  } catch (_) {
    /* Ohne Berechtigung gibt es auch nichts wegzuräumen. */
  }
  return true;
}

/** Nur für Prüfsätze und die Anzeige: Steht gerade eine Frage offen? */
export function freigabeSteht() {
  return freigabeOffen;
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
 *
 * Und hier, an genau dieser Stelle, steht seit dem 14.08.2026 der Eintrag ins
 * Protokollbuch (Befund N3). Vorher stand er in `trennen()`, also auf EINEM von
 * sechs Wegen: Der `disconnect`-Rahmen des Relays, das `onclose` der Leitung,
 * die gescheiterte Verlängerung, die abgelaufene Frist ohne Leitung und die
 * verwaiste Sitzung aus einem fremden Leben gingen alle ohne Zeile durch. Ein
 * Buch mit Lücken ist als Nachweis wertlos, und es sind gerade die Enden, die
 * der Mensch nicht selbst ausgelöst hat, nach denen er später sucht. Hier
 * kommen alle sechs vorbei, und einen siebten Weg gibt es nicht.
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

  /* 5. Die Zeile im Buch — genau dann, wenn hier wirklich eine Sitzung zu Ende
        gegangen ist. `aufraeumen` gibt sie zurück oder gibt `null`; ohne
        Sitzung gibt es auch kein Ende zu buchen, und ein Aufruf ins Leere darf
        keine Zeile erfinden. Das trifft auch den zweiten Anlauf: Schliesst
        `aufraeumen` die Leitung, ruft Chrome danach `onclose`, und das kommt
        noch einmal hier vorbei — dann steht in der Ablage aber nichts mehr. */
  if (alt) {
    await buchFuehren(
      { cmd: "disconnect", agent: alt.agent },
      alt,
      { cmd: "disconnect", success: false, error: { code: grund } },
      ""
    );
  }

  /* 6. Zum Schluss der Modulspeicher. Nicht früher. */
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
      /*
       * Ins Buch geht der BEHAUPTETE Name, nicht der belegte (BRUECKE-4/-7).
       *
       * Das ist kein Widerspruch zur fail-closed-Anzeige, sondern ihre andere
       * Hälfte: Die Oberfläche darf nur behaupten, was sie belegen kann, das
       * Buch soll festhalten, was wirklich angekommen ist. Dass ein fremder
       * Name angeklopft hat, ist genau die Zeile, die man später sucht — und
       * `protokollbuch.js` entscheidet in `agentAus` schon heute so.
       *
       * OFFEN und ausserhalb dieses Baums (BRUECKE-7, OFFEN-v3.5 §2.2): Das
       * Gateway signiert den Anspruch `agent` nicht. Solange das so ist, ist
       * dieses Feld eine Selbstauskunft und beantwortet die Frage „was ist in
       * meinem Namen geschehen" nur, soweit man dem Absender glaubt.
       */
      agent: agentBehauptet(rahmen && rahmen.agent) || (laufende && laufende.agent) || "",
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
      /* Ein abgebrochener Aufbau ist ein Ende wie jedes andere: Was danach aus
         einem `await` zurückkommt, darf nichts mehr aufbauen. */
      markeWeiter();
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

    /*
     * Die Kappmarke DIESES Aufbaus (NOTAUS-2).
     *
     * Sie wird hier gemerkt und nicht erst im `auth_ok`-Zweig: Das Fenster
     * zwischen `new WebSocket` und der Antwort des Relays ist die ganze
     * Handschlagfrist, bis zu FRIST_AUTH = 20 Sekunden. Drückt der Mensch in
     * dieser Zeit den Not-Aus, ist `erledigt` noch false, die Leitung wird
     * geschlossen — und wenn `auth_ok` das Schließen überholt (Chrome schickt
     * das close-Ereignis erst, wenn der Relay antwortet), baute der Handschlag
     * danach eine vollständige Sitzung auf. Genau das war die Messung.
     */
    const meineMarke = kappmarke;

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
        /*
         * ERSTE Prüfung des Wiedereintritts (NOTAUS-2).
         *
         * Zwischen `new WebSocket` und diesem Rahmen liegt die Antwortzeit des
         * Relays. Ist in dieser Zeit gekappt worden, wird hier NICHTS
         * aufgebaut. Und die Sitzung, die der Relay auf seiner Seite gerade
         * angelegt hat, wird ausdrücklich widerrufen: Der Not-Aus lief mit
         * `vorher = null` durch, also mit `brauchtWiderruf = false`, und das
         * spätere `onclose` ruft `sitzungBeenden` mit `widerrufen: false`. Ohne
         * diese Zeilen bliebe die Sitzung beim Relay bis zum Ablauf ihrer Frist
         * stehen — gemessen war das der Zustand.
         */
        if (!markeGilt(meineMarke)) {
          const gekappterCode = String(rahmen.code || "");
          senden({ type: "disconnect", reason: "user_revoked" });
          if (gekappterCode) serverWiderruf(gekappterCode, ausweis).catch(() => {});
          beenden(
            new NetzFehler(
              "gekappt",
              "Die Verbindung wurde beendet, während ich sie aufgebaut habe. Ich habe nichts aufgebaut."
            )
          );
          return;
        }

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
        const angelegt = await sitzungSchreiben({
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
        }, meineMarke);

        /*
         * ZWEITE Prüfung — die gemessene Stelle.
         *
         * `sitzungSchreiben` ist ein `chrome.storage.session.set`, also ein IPC
         * von wenigen Millisekunden. Genau dorthinein fiel der Not-Aus in der
         * Messung vom 14.08.2026, und alles Folgende machte ihn rückgängig:
         * `zaehlerNeu()` setzt `aktiv` BEDINGUNGSLOS wieder auf true, der
         * Herzschlag beginnt zu laufen, der Wecker wird neu angelegt, und die
         * Seitenleiste bekommt `verbunden=true`. Eine Sekunde nach dem Not-Aus
         * lief ein `readPage` durch.
         *
         * `sitzungSchreiben` hat den Satz in diesem Fall selbst wieder
         * zurückgenommen und meldet es mit `false`. Ab hier wird nur noch
         * abgesagt — und der Relay bekommt seinen Widerruf, damit die Sitzung
         * dort nicht bis zum Fristende stehen bleibt.
         */
        if (!angelegt || !markeGilt(meineMarke)) {
          senden({ type: "disconnect", reason: "user_revoked" });
          if (neuerCode) serverWiderruf(neuerCode, ausweis).catch(() => {});
          beenden(
            new NetzFehler(
              "gekappt",
              "Die Verbindung wurde beendet, während ich sie aufgebaut habe. Ich habe nichts aufgebaut."
            )
          );
          return;
        }

        /* Neue Sitzung, neue Deckel: Der Ausführer zählt Befehle je Sitzung.
           Erst NACH der Prüfung oben, denn `zaehlerNeu()` setzt `aktiv` ohne
           jede Bedingung auf true — es ist die eine Zeile, die den Not-Aus
           wörtlich rückgängig macht. */
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

        /* DRITTE Prüfung. `chrome.alarms.create` ist wieder ein IPC, und was
           danach kommt, sind der Wecker und die Meldung „verbunden" an die
           Seitenleiste. Beide sind Wiederherstellungen: Der Wecker weckt den
           Dienstarbeiter noch zehn Minuten lang, und die Meldung ist die Zeile,
           die der Mensch nach seinem Not-Aus zuletzt sehen soll. */
        if (!markeGilt(meineMarke)) {
          uhrenStoppen();
          try {
            await chrome.alarms.clear(WECKER);
          } catch (_) {
            /* Kein Wecker da: dann ist auch keiner zu löschen. */
          }
          await sitzungSchreiben(null);
          senden({ type: "disconnect", reason: "user_revoked" });
          if (neuerCode) serverWiderruf(neuerCode, ausweis).catch(() => {});
          beenden(
            new NetzFehler(
              "gekappt",
              "Die Verbindung wurde beendet, während ich sie aufgebaut habe. Ich habe nichts aufgebaut."
            )
          );
          return;
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
      /* Die Kappmarke DIESES Befehls. Alles Weitere in diesem Zweig steht
         hinter mindestens einem `await` — die Ablage, die Tabadresse, der
         Ausführer. Fällt der Not-Aus dazwischen, wird nichts mehr ausgeführt
         und nichts mehr geschrieben. */
      const befehlsMarke = kappmarke;
      const laufende = await sitzungLesen();

      /* Wiedereintritt: Zwischen dem Eintreffen des Befehls und dem Lesen der
         Ablage kann gekappt worden sein. Der Agent bekommt trotzdem seine
         Antwort — ohne sie wartet er bis zur Frist des Relays ins Leere. */
      if (!markeGilt(befehlsMarke)) {
        const absage = absageRahmen(
          rahmen,
          "session_beendet",
          "Die Verbindung wurde beendet. Ich führe nichts mehr aus."
        );
        senden(absage);
        await buchFuehren(rahmen, laufende, absage, "");
        return;
      }

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
         darum, dass in der Seitenleiste steht, WER gerade steuert.

         `agentAnzeige` hält seit BRUECKE-4 gegen die Positivliste: Ein Name,
         den diese Erweiterung nicht belegen kann, trägt sich nicht nach. Der
         Rahmen selbst geht davon unberührt weiter an den Ausführer.

         Die Marke reist mit, weil `sitzungSchreiben` ein Schreibvorgang nach
         mehreren `await`s ist — nach einem Not-Aus stünde die Sitzung sonst
         wieder in der Ablage, nur mit einem Agentennamen mehr. */
      const gemeldeterAgent = agentAnzeige(rahmen.agent);
      if (laufende && gemeldeterAgent && gemeldeterAgent !== agentAnzeige(laufende.agent)) {
        await sitzungSchreiben({ ...laufende, agent: gemeldeterAgent }, befehlsMarke);
      }

      /* Letzte Prüfung vor der Übergabe an den Ausführer. Er hat seine eigene
         Generationszählung, und die trägt; diese Zeile steht davor, weil sie
         den Weg gar nicht erst betritt — und weil eine Wache, die nur in einer
         zweiten Datei steht, genau die Bauform ist, an der der 11.08. hing. */
      if (!markeGilt(befehlsMarke)) {
        const absage = absageRahmen(
          rahmen,
          "session_beendet",
          "Die Verbindung wurde beendet. Ich führe nichts mehr aus."
        );
        senden(absage);
        await buchFuehren(rahmen, laufende, absage, adresse || "");
        return;
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
  /* Die Marke dieses Tauschs. Zwischen dem Lesen der alten Sitzung und dem
     Aufbau der neuen liegen zwei `await`s, und ein Not-Aus dazwischen darf
     nicht in einer NEUEN Leitung enden — eine Verlängerung, die nach dem Stopp
     noch durchgeht, ist genau die Wiederherstellung aus dem Grundsatz oben. */
  const meineMarke = kappmarke;
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

  /* Wiedereintritt nach dem Löschen des Weckers: Ist inzwischen gekappt
     worden, wird keine neue Leitung mehr aufgebaut. Die alte ist schon stumm
     und wird hier geschlossen; die Sitzung ist damit ehrlich zu Ende. */
  if (!markeGilt(meineMarke)) {
    try {
      alterDraht.close(1000, "ende");
    } catch (_) {
      /* Schon zu. */
    }
    throw new NetzFehler(
      "gekappt",
      "Die Verbindung wurde beendet, während ich sie verlängert habe. Baue sie bitte neu auf."
    );
  }

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

  senden({ type: "disconnect", reason: grund === "notbremse" ? "user_revoked" : grund });

  const texte = {
    notbremse: "Gestoppt. Der Agent kann diesen Browser nicht mehr steuern.",
    abgelaufen: "Die vereinbarte Zeit ist um. Die Verbindung ist beendet.",
    nutzer: "Die Verbindung ist beendet.",
    verloren: "Die Verbindung ist abgerissen. Der Agent kann diesen Browser nicht mehr steuern.",
  };
  /* Das Buch führt `sitzungBeenden` selbst (Befund N3 vom 14.08.2026). Hier
     stand die Zeile bis dahin — und damit auf genau einem von sechs Wegen, auf
     denen eine Sitzung endet. Zwei Zeilen für ein Ende wären derselbe Fehler
     wie keine, deshalb steht sie jetzt dort und nur dort. */
  await sitzungBeenden(grund, texte[grund] || texte.nutzer, { ausweis, widerrufen: true });
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
  /*
   * Die Marke dieses Weckerschlags — dieselbe Klasse wie NOTAUS-2, selbst
   * gefunden.
   *
   * Dieser Weg endet mit einem `sitzungSchreiben`, und davor stehen vier
   * `await`s: das Protokollbuch, die Ablage, die Rechnung und gegebenenfalls
   * das Ende. Fällt der Not-Aus dazwischen, schriebe der letzte Aufruf die
   * gerade weggeräumte Sitzung wieder in `storage.session` — mitsamt frischem
   * Anker, Abzeichen, Dauerzeile und Systemmeldung. Ein Wecker, der einen
   * Not-Aus zurücknimmt, ist genau das, was §5 verbietet.
   */
  const meineMarke = kappmarke;

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

  /* Verbrauch festschreiben, Anker neu setzen, Anzeigezeit nachführen — aber
     nur, wenn dieser Weckerschlag noch zu der Welt gehört, in der er begonnen
     hat. `sitzungSchreiben` prüft die Marke selbst und nimmt zurück, was es
     geschrieben hat, wenn der Not-Aus in sein `await` fällt. */
  await sitzungSchreiben(
    {
      ...gespeichert,
      ...ankerNeu(verbraucht, jetzt, mono),
      endetUm: jetzt + rest,
    },
    meineMarke
  );
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
     weiss davon nichts und hielte sie sonst bis zum Ablauf ihrer Frist offen.

     Diese Zeile SCHREIBT den Modulspeicher nach einem `await`, gehört also zur
     Klasse aus dem Block oben. Sie bleibt trotzdem ohne Markenprüfung, und das
     ist die Begründung: Was hier geschrieben wird, ist die Vorbereitung eines
     ENDES, keine Wiederherstellung. `sitzungBeenden` räumt es in derselben
     Runde wieder weg und widerruft beim Relay. Fiele der Not-Aus genau
     hierhin, wäre das Ergebnis ein Widerruf zu viel — und ein Widerruf zu viel
     ist beim Relay ausdrücklich gutmütig (DRAHTFORMAT §6, `already_ended`).
     Die strengere Richtung ist hier also, NICHT zu prüfen. */
  sitzung = alt;
  await sitzungBeenden(
    "verloren",
    "Die Verbindung ist abgerissen. Der Agent kann diesen Browser nicht mehr steuern. Baue sie bitte neu auf.",
    { widerrufen: true }
  );
  return { gefunden: true, beendet: true, grund: "fremdes_leben" };
}

export const WECKER_NAME = WECKER;
