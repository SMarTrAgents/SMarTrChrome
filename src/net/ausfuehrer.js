/*
 * SMarTrChrome — der Ausführer.
 *
 * Das ist die Stelle, an der ein Befehl des Agenten wirklich etwas tut. Bis zu
 * dieser Runde gab es sie nicht: Der Relay legte eine Wartestelle an, schickte
 * den Befehl und wartete auf einen `result`-Rahmen — und die Erweiterung reichte
 * ihn nur als Nachricht an die Seitenleiste weiter, wo niemand antwortete.
 * Jeder einzelne Befehl lief damit in die Zeitüberschreitung.
 *
 * Die eine Regel, aus der alles Übrige folgt:
 *
 *   **Kein Weg darf ohne Antwort enden.**
 *
 * Nicht bei einem unbekannten Befehl, nicht bei fehlender Freigabe, nicht bei
 * einer geschlossenen Seitenleiste, nicht bei einem Fehler im Ausführer selbst.
 * Wer keine Antwort schickt, lässt den Agenten in eine Frist laufen, die er
 * nicht deuten kann: „keine Antwort vom Browser" heißt für ihn gleichzeitig
 * „die Seite braucht länger" und „der Mensch hat abgelehnt" und „die
 * Erweiterung ist kaputt". Eine Ablehnung ist eine Aussage. Stille ist keine.
 *
 * Fünf Grenzen, die vor jeder Ausführung stehen — in dieser Reihenfolge, jede
 * bricht ab:
 *
 *   1. **Positivliste.** Nur was in `BEFEHLE` steht, wird überhaupt betrachtet.
 *   2. **Stufe.** Die Erweiterung prüft sie selbst noch einmal; der Server darf
 *      einschränken, nie erweitern (spec-01 §5.4).
 *   3. **Bereich.** Nicht das Ziel im Befehl, sondern die Adresse, auf der der
 *      Tab GERADE steht. Der Relay kann sie nicht kennen.
 *   4. **Parameter.** Was der Befehl tun soll, muss im Rahmen stehen und nicht
 *      aus einer Voreinstellung stammen (befehle.js, `parameterPruefen`). Diese
 *      Grenze steht ausdrücklich VOR der Freigabe: Erst fragen und dann selbst
 *      ablehnen hieße, den Menschen etwas bestätigen zu lassen, das nie
 *      stattfindet.
 *   5. **Freigabe.** Jeder Schritt geht durch die Rückfrage in der
 *      Seitenleiste, bevor er ausgeführt wird.
 *
 * Und eine Regel für die Anzeige, die aus dem Bestand kommt und hier gilt wie
 * überall: Text von der besuchten Seite kommt NIE in die Freigabefrage und wird
 * NIE vorgelesen. Er steht abgesetzt daneben (`quelle`), gekürzt und von
 * Steuerzeichen befreit.
 */

import {
  BEFEHLE,
  GRENZEN,
  FRIST_PUFFER_MS,
  AUSFUEHRUNG_RESERVE_MS,
  WARTE_BEDINGUNGEN,
  MODI,
  MODUS_STANDARD,
  MODUS_ABLAGE,
  KLICK_ABSAGEN,
  kennungPruefen,
  stufeReicht,
  bereichPasst,
  hostAus,
  saeubern,
  eigen,
  vergleichsform,
  textbaumBauen,
  rahmenDeckeln,
  parameterPruefen,
  frageZusatz,
  refPruefen,
  klassenBestimmen,
  freigabeNoetig,
  schrittMarke,
  einschleusungVerdacht,
  KLASSEN,
  HART,
  WEICH,
} from "./befehle.js";
/* Die EINE Messform (`src/gemeinsam/messform.js`, über den Mantel daneben).
   Sie wird hier für den Identitätsvergleich der Kaskade gebraucht: `gleicherText`
   misst Gleichheit als GANZES, nach derselben Normalisierung, mit der auch der
   Klassifizierer arbeitet. Ein zweiter Vergleich mit eigenen Regeln wäre der
   F4-Fehler in seiner dritten Auflage. */
import { gleicherText, messtext } from "./messform.js";
import { AGENTEN, regelnFuer, agentDarf } from "./matrix.js";
import { workflowHolen, platzhalterFuellen } from "./werkstatt.js";
import { eintragen as buchEintragen } from "./protokollbuch.js";
import { anSeite, overlaySicherstellen, tabAdresse } from "./seite.js";
/* Der Freigabe-Ursprung wird nirgends fotografiert und nirgends bedient
   (DRAHTFORMAT §7.3, Punkt 2). Die Prüfung steht in `rechte.js` und wird von
   hier gerufen, statt hier ein zweites Mal aufgeschrieben zu werden. */
import { istGesperrterUrsprung } from "./rechte.js";
/* Der Markenfilter des Chatwegs gilt auch hier: Der Satz des Agenten aus dem
   Befehlsrahmen landet in der Freigabekarte UND wird vorgelesen. Ohne diesen
   Import stand „A0" auf der prominentesten Fläche der Erweiterung, genau an
   der Stelle, an der jeder Schritt einzeln vorgelesen wird. Vier Eintritts-
   punkte waren gedeckt, dieser fünfte nicht. */
import { entmarken } from "./chat.js";
/*
 * Die Brücke als ganzes Modul — für den Freigaberuf (Befund RUF-1 vom
 * 15.08.2026). Bis dahin sendete `menschRufen` eine Nachricht
 * `link:freigabe-wartet` per `chrome.runtime.sendMessage` und hoffte, dass
 * `link.js` sie hört. Das kann baulich nie funktionieren: Beide Dateien laufen
 * im SELBEN Dienstarbeiter, und `sendMessage` erreicht den eigenen Kontext
 * nicht — die Nachricht hatte im ganzen Baum keinen einzigen Empfänger, das
 * Fragezeichen am Symbol erschien nie, `freigabeOffen` blieb für immer false.
 * Ein Ruf-Zeichen ohne Empfänger ist exakt die 0.5.3-Fehlerklasse: gebaut,
 * grün gemessen, im ausgelieferten Weg von niemandem gerufen.
 *
 * Deshalb wird `link.freigabeRufen` jetzt DIREKT gerufen. Als Modulobjekt und
 * nicht mit benannten Feldern, aus demselben Grund, aus dem `link.js` es
 * umgekehrt mit dieser Datei hält: Die beiden importieren einander, und ein
 * benannter Import auf ein Feld, das im Lademoment noch nicht initialisiert
 * ist, wäre ein Ladefehler der ganzen Datei — eine Brücke, die nicht lädt,
 * ruft auch niemanden.
 */
import * as link from "./link.js";

/* --------------------------------------------------------------------- *
 * Zustand des Ausführers. Alles im Modul, nichts auf Platte: Stirbt der
 * Service Worker, stirbt die Sitzung mit ihm — dann gibt es auch nichts mehr
 * zu zählen.
 * --------------------------------------------------------------------- */

let generation = 0; // wechselt bei jedem Sitzungsanfang und -ende
let aktiv = false; // läuft gerade eine Sitzung, in der ausgeführt werden darf?
let kette = Promise.resolve(); // Befehle laufen einer nach dem anderen
let wartende = 0;
const zaehler = { gesamt: 0, zeiten: [] };

/* Der zuletzt bekannte Bildlaufstand je Tab. Er gehört zur Schleifenmarke
   (§5): Dieselbe Aktion an einer anderen Stelle der Seite ist eine andere
   Aktion. Ihn vor JEDEM Schritt frisch bei der Seite zu erfragen kostete einen
   ganzen Umlauf je Befehl — gemessen wird deshalb der Stand, den die letzte
   Antwort der Seite ohnehin mitgebracht hat. */
const bildlaufStand = new Map();

/* Die letzte Schleifenmarke je Tab, samt Zähler. Sie liegt im Modul und nicht
   in der Ablage: Stirbt der Hintergrunddienst, ist auch der Auftrag vorbei,
   den sie beschreibt. */
const marken = new Map();

/* Welchen Modus die Seite zuletzt angezeigt bekommen hat. `overlay:modus` geht
   nur bei einer ÄNDERUNG raus (§6) — eine Nachricht je Befehl wäre Lärm in
   einer fremden Seite, und Lärm in einer fremden Seite ist eine Spur. */
const gezeigterModus = new Map();

/*
 * Das Not-Aus-Signal.
 *
 * Es ist ein Versprechen, das beim Kappen erfüllt wird, und kein Merkzeichen,
 * das irgendwer abfragen müsste. Der Unterschied ist die Zusage aus §5: Ein
 * Befehl, der gerade auf eine hängende Seite wartet, soll nicht erst dann
 * aufhören, wenn diese Seite antwortet. Er rennt gegen dieses Versprechen, und
 * das Versprechen gewinnt sofort.
 *
 * Jeder laufende Befehl merkt sich das Signal, das bei seinem Start galt.
 * Sonst liefe ein Befehl, der nach dem Kappen startet, gegen ein Signal, das
 * nie wieder erfüllt wird — und der nächste Not-Aus fände ihn nicht mehr.
 */
const ABBRUCH = Symbol("abbruch");
let abbruchSignal = signalNeu();

/*
 * Dasselbe Signal in zwei Gestalten, und beide werden gebraucht.
 *
 * `versprechen` ist das, gegen das ein laufender Befehl rennt — es gewinnt
 * das `Promise.race` und liefert die Antwort an den Agenten.
 *
 * `abbruch` ist ein `AbortSignal` und geht in JEDEN Aufruf an die Seite
 * (Festlegung F1). Es ist die Antwort auf den Befund vom 14.08.2026 (B3):
 * `Promise.race` beendet nur das Warten, nicht den Verlierer. Gewann das
 * Not-Aus-Signal, lief `AUSFUEHRUNG[cmd]` weiter und schickte seine Handlung
 * trotzdem an die Seite — gemessen 16996 ms nach dem Kappen. Ein Rennen
 * gewinnt man nicht, indem man wegsieht; der Verlierer muss selbst aufhören,
 * und dafür braucht er ein Signal, das er lesen kann.
 */
function signalNeu() {
  let ausloesen = null;
  const versprechen = new Promise((fertig) => {
    ausloesen = fertig;
  });
  const steuerung = new AbortController();
  return { versprechen, ausloesen, steuerung, abbruch: steuerung.signal };
}

/** Beim Sitzungsanfang: Zähler auf null, alte Läufe entwerten. */
export function zaehlerNeu() {
  generation += 1;
  aktiv = true;
  zaehler.gesamt = 0;
  zaehler.zeiten = [];
  wartende = 0;
  marken.clear();
  bildlaufStand.clear();
  gezeigterModus.clear();
  abbruchSignal = signalNeu();
  /* Die Schrittzähler des letzten Auftrags gehören nicht zu diesem. Sie liegen
     in der Ablage und werden deshalb asynchron geleert; der erste Befehl
     wartet darauf, weil er hinter derselben Kette hängt. Ein Auftrag, der die
     Zählung seines Vorgängers erbt, wäre nach fünfzig geerbten Schritten
     sofort am Limit. */
  kette = schritteLeeren().catch(() => undefined);
}

/**
 * Beim Sitzungsende: Was noch in der Warteschlange steht, wird nicht mehr
 * ausgeführt. Es bekommt trotzdem eine Antwort — die Leitung ist in diesem
 * Moment vielleicht noch offen, und wenn nicht, kostet der Versuch nichts.
 *
 * Die Marke `aktiv` ist hier das Tragende und nicht die Generationsnummer:
 * Ein Befehl, der NACH dem Ende eintrifft, bekäme sonst die neue Nummer und
 * liefe damit als „aktuell" durch. Eine beendete Sitzung führt nichts mehr
 * aus — auch keinen Befehl, der eine Millisekunde zu spät kommt.
 */
export function laufBeenden() {
  generation += 1;
  aktiv = false;
}

/**
 * Der Not-Aus (§5).
 *
 * Er unterscheidet sich von `laufBeenden` in genau einem Punkt, und der ist
 * der ganze Zweck: Er wartet auf nichts. `laufBeenden` entwertet die Sitzung,
 * und ein Befehl, der gerade in einer hängenden Seite steht, merkt das erst,
 * wenn diese Seite antwortet — beim Not-Aus wären das die Sekunden, in denen
 * der Mensch zusieht, wie weitergeklickt wird.
 *
 * Deshalb ist diese Funktion ausdrücklich NICHT `async`: Zwischen dem Ereignis
 * und dem Zustand „nichts läuft mehr" liegt kein einziges `await`, und damit
 * auch keine Antwort des Relays. Erst kappen, dann melden — der Widerruf beim
 * Relay steht in `link.js` hinter diesem Aufruf, nicht davor.
 *
 * Was sie tut:
 *  - `aktiv = false` und `generation` hoch: Jeder Befehl, der noch in der
 *    Schlange steht, fällt beim ersten Schritt auf `session_beendet`.
 *  - Das Signal wird erfüllt: Jeder Befehl, der schon läuft, bricht sein
 *    Rennen ab und antwortet ebenfalls `session_beendet`.
 *  - Die Kette wird geleert, damit nichts mehr hinterherläuft.
 */
export function laufAbbrechen() {
  generation += 1;
  aktiv = false;
  const altesSignal = abbruchSignal;
  abbruchSignal = signalNeu();
  kette = Promise.resolve();
  marken.clear();
  /* Erst das Abbruchsignal, dann das Versprechen. Die Reihenfolge trägt die
     Zusage aus B3: Wer geweckt wird, soll ein Signal vorfinden, das schon
     gebrochen ist — sonst schickt er zwischen Wecken und Lesen noch eine
     letzte Nachricht in die Seite. */
  if (altesSignal && altesSignal.steuerung) {
    try {
      altesSignal.steuerung.abort();
    } catch (_) {
      /* Ein Signal, das sich nicht brechen lässt, hält den Not-Aus nicht auf. */
    }
  }
  /* Zuletzt, weil das Erfüllen des Versprechens die wartenden Befehle weckt:
     Sie sollen die neue Lage vorfinden und nicht die alte. */
  if (altesSignal && altesSignal.ausloesen) altesSignal.ausloesen(ABBRUCH);
}

/* --------------------------------------------------------------------- *
 * Der Betriebsmodus je Tab (§2)
 *
 * Er liegt in `chrome.storage.session` unter `sa_modus` und stirbt mit dem
 * Browser. Das ist keine Bequemlichkeit: Ein Modus, der einen Neustart
 * überlebt, wäre eine Vollmacht, an die sich niemand erinnert.
 *
 * Und die Regel, die diese Datei durchsetzt und die genauso schon für die
 * Stufe gilt (Schritt 4 der Schleife, spec-01 §5.4):
 *
 *   **Der Serverwert schränkt ein, er erweitert nie.**
 *
 * Der Mensch stellt am Browser ein, wie viel ohne Rückfrage laufen darf; der
 * Server sagt, wie viel er zulässt. Es gilt das Kleinere von beidem. Ein
 * Relay, das `auto` schickt, kann damit aus einem Handbetrieb keine Automatik
 * machen — und ein Browser, der `auto` steht, bekommt in einer Sitzung mit
 * `confirm_each` trotzdem jede Frage gestellt.
 * --------------------------------------------------------------------- */

const MODUS_RANG = Object.freeze({ manual: 1, assist: 2, auto: 3 });

/* Wie der Schrittmodus der Sitzung heisst, in unseren Worten. Unbekannte Werte
   fallen auf `manual` — dieselbe Richtung wie überall: Wer nicht gelesen
   werden kann, bekommt weniger, nicht mehr (DRAHTFORMAT §5.4, Vertrag §11.3). */
const SERVER_MODUS = Object.freeze({
  auto: "auto",
  assist: "assist",
  confirm_each: "manual",
});

function leererModusStand() {
  return { version: 1, tabs: {}, schritte: {}, grenze: GRENZEN.schritteJeAuftrag };
}

/**
 * Der Modusstand, immer vollständig und immer gemessen.
 *
 * Was in der Ablage steht, kommt aus der Seitenleiste und damit aus einer
 * fremden Feder. Ein unlesbarer Modus wird nicht zur Voreinstellung, sondern
 * fällt ganz weg, und ein fehlender Modus ist `assist` — nie `auto`.
 */
async function modusStandLesen() {
  let roh = null;
  try {
    const daten = await chrome.storage.session.get(MODUS_ABLAGE);
    roh = daten && daten[MODUS_ABLAGE];
  } catch (_) {
    return leererModusStand();
  }
  const stand = leererModusStand();
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return stand;

  const tabs = roh.tabs && typeof roh.tabs === "object" ? roh.tabs : {};
  for (const [schluessel, wert] of Object.entries(tabs)) {
    if (!/^\d{1,12}$/.test(schluessel)) continue;
    if (MODI.includes(wert)) stand.tabs[schluessel] = wert;
  }
  const schritte = roh.schritte && typeof roh.schritte === "object" ? roh.schritte : {};
  for (const [schluessel, wert] of Object.entries(schritte)) {
    if (!/^\d{1,12}$/.test(schluessel)) continue;
    const zahl = Number(wert);
    if (Number.isFinite(zahl) && zahl >= 0) stand.schritte[schluessel] = Math.floor(zahl);
  }
  /* Die Seitenleiste darf das Schrittlimit einstellen (§5), aber nicht
     abschaffen: Wer 5.000 Schritte eintragen darf, hat den Deckel entfernt,
     ohne es zu merken. */
  const grenze = Number(roh.grenze);
  if (Number.isFinite(grenze) && grenze >= 1) {
    stand.grenze = Math.min(Math.floor(grenze), GRENZEN.schritteDeckel);
  }
  return stand;
}

async function modusStandSchreiben(stand) {
  try {
    await chrome.storage.session.set({ [MODUS_ABLAGE]: stand });
    return true;
  } catch (_) {
    /* Ein Modus, der sich nicht speichern lässt, hält keine Sitzung an. Beim
       nächsten Lesen steht die Voreinstellung da, und die Voreinstellung ist
       die vorsichtige. */
    return false;
  }
}

async function schritteLeeren() {
  const stand = await modusStandLesen();
  stand.schritte = {};
  await modusStandSchreiben(stand);
}

/**
 * Den Modus dieses Tabs setzen.
 *
 * Der Weg für `modus:setzen` aus der Seitenleiste (§6). Er liegt hier und
 * nicht im Worker, weil hier auch gelesen wird: Zwei Stellen, die dieselbe
 * Ablage verschieden schreiben, sind der Ursprung fast jeder Herunterstufung.
 * Genau das war der Befund vom 14.08.2026 — der Dienstarbeiter hielt
 * `schritte` für das eingestellte Limit, diese Datei für den verbrauchten
 * Zähler. Seither schreibt nur noch diese Datei.
 *
 * `grenze` ist das in der Seitenleiste eingestellte Schrittlimit (§5). Es wird
 * hier gedeckelt und nicht an der Oberfläche: Wer den Deckel an der Oberfläche
 * durchsetzt, hat ihn genau so lange, wie niemand eine zweite Oberfläche baut.
 * Ohne Angabe bleibt die bestehende Grenze stehen, sie wird nicht zurückgesetzt.
 *
 * @returns {Promise<{ok:boolean, modus:string, satz:string}>} wirft nie
 */
export async function modusSetzen(tabId, modus, grenze) {
  if (!Number.isInteger(tabId)) {
    return { ok: false, modus: MODUS_STANDARD, satz: "Zu dieser Einstellung fehlt der Tab." };
  }
  if (!MODI.includes(modus)) {
    return { ok: false, modus: MODUS_STANDARD, satz: "Diesen Betriebsmodus kenne ich nicht." };
  }
  const stand = await modusStandLesen();
  stand.tabs[String(tabId)] = modus;
  const gewuenscht = Number(grenze);
  if (Number.isFinite(gewuenscht) && gewuenscht >= 1) {
    stand.grenze = Math.min(Math.floor(gewuenscht), GRENZEN.schritteDeckel);
  }
  const ok = await modusStandSchreiben(stand);
  /* Zwingend: Ein Mensch, der den Schalter umlegt, will die Farbe wechseln
     sehen. Ob wir glauben, die Seite wisse es schon, ist dabei ohne Belang —
     sie kann inzwischen neu geladen worden sein. */
  if (ok) await modusAnDieSeite(tabId, modus, true);
  return {
    ok,
    modus,
    satz: ok
      ? "Der Betriebsmodus für diesen Tab steht."
      : "Der Betriebsmodus liess sich nicht speichern.",
  };
}

/**
 * Der Stand dieses Tabs für `modus:stand?` (§6).
 *
 * @returns {Promise<{modus:string, schritte:number, grenze:number}>}
 */
export async function modusStand(tabId) {
  const stand = await modusStandLesen();
  const schluessel = String(tabId);
  /* `tabId` kommt aus der Seitenleiste, also über eine Nachricht — mit `eigen`
     (H2 vom 14.08.2026). Ohne sie gäbe `modus:stand?` für einen Tab namens
     „constructor" eine Funktion als Modus zurück. */
  return {
    modus: eigen(stand.tabs, schluessel) || MODUS_STANDARD,
    schritte: eigen(stand.schritte, schluessel) || 0,
    grenze: stand.grenze,
  };
}

/**
 * Der Modus, der wirklich gilt: der kleinere von Browser und Server.
 *
 * Befund vom 14.08.2026 (H2), und er stand genau in der einen Zeile, die
 * diese Zusage trägt: `SERVER_MODUS[schrittmodus] || "manual"` über einem
 * gewöhnlichen Objektliteral. `constructor`, `toString`, `valueOf`,
 * `__proto__` und `hasOwnProperty` liefern dort eine Funktion, und eine
 * Funktion ist wahr — das `|| "manual"` griff nicht, `MODUS_RANG[<Funktion>]`
 * wurde `undefined`, der Vergleich `undefined < 3` falsch, und der lokale
 * Modus blieb stehen. Gemessen: `schrittmodus=constructor` bei lokalem `auto`
 * ergab NULL Rückfragen beim Klick. Die Zusage „der Serverwert schränkt ein,
 * er erweitert nie" war damit für jeden unbekannten Wert falsch.
 *
 * Zwei Zeilen, zwei Riegel: `eigen` fragt nach dem eigenen Eintrag, und der
 * Rang wird gemessen statt geglaubt. Was nicht zu lesen ist, wird `manual` —
 * dieselbe Richtung wie überall: weniger, nicht mehr.
 */
function modusVerrechnen(lokal, schrittmodus) {
  const l = MODI.includes(lokal) ? lokal : MODUS_STANDARD;
  const gelesen = eigen(SERVER_MODUS, schrittmodus);
  const s = MODI.includes(gelesen) ? gelesen : "manual";
  const rangS = eigen(MODUS_RANG, s) || 1;
  const rangL = eigen(MODUS_RANG, l) || 1;
  return rangS < rangL ? s : l;
}

/*
 * Den Modus in der Seite anzeigen (§6, `overlay:modus`).
 *
 * Die Nachricht trägt genau ein Feld, und in diesem Feld steht eines von drei
 * unserer eigenen Wörter. Nichts von der Seite, nichts vom Agenten, nichts aus
 * der Sitzung — sie geht in eine fremde Seite, und was dorthin geht, kann
 * diese Seite lesen.
 */
async function modusAnDieSeite(tabId, modus, zwingend = false, signal = null) {
  if (!Number.isInteger(tabId) || !MODI.includes(modus)) return;
  if (!zwingend && gezeigterModus.get(tabId) === modus) return;
  gezeigterModus.set(tabId, modus);
  await anSeite(tabId, { typ: "overlay:modus", modus }, 2000, { signal }).catch(() => {});
}

/* --------------------------------------------------------------------- *
 * Werte, die von der besuchten Seite kommen
 *
 * Die Fehlerklasse aus der Abnahme vom 14.08.2026 (H1, AUTOMODUS-2), in einem
 * Satz:
 *
 *   **Es wird gekürzt, bevor gemessen wird.**
 *
 * `saeubern` schneidet die MITTE heraus — also genau das Wort, auf das es
 * ankommt. Gemessen: Ein Knopf mit 208 Zeichen barrierefreiem Namen, in dessen
 * Mitte „kaufen" steht, ergibt am Klassifizierer ungekürzt `hart=zahlung`,
 * über den Produktivweg aber `fragen=0` und `erfolg=true` im Modus `auto`. Und
 * die besuchte Seite bestimmt selbst, wie lang ihre Namen sind.
 *
 * Ab hier gilt in dieser Datei die Trennung, und sie ist sichtbar gemacht:
 *
 *   - **Messeingänge bleiben ungekürzt.** Alles, was in `klassenBestimmen`,
 *     in `einschleusungVerdacht` oder in die Identitätswache der Kaskade geht,
 *     geht ganz hinein. Ein Deckel dort ist ein Schalter, den die Seite
 *     bedient.
 *   - **Gekürzt wird ausschliesslich für Anzeige und Protokoll**, und zwar in
 *     einem eigenen Feld (`anzeigename`), damit an der Aufrufstelle zu sehen
 *     ist, welches der beiden gerade benutzt wird.
 *   - **Kennungen werden gemessen, nicht geschnitten.** Eine Epoche ist kein
 *     Anzeigetext, sie wird auf GLEICHHEIT geprüft. Zwei verschiedene, lange
 *     Kennungen können nach einer mittigen Kürzung dieselbe sein — dann
 *     stimmt eine Epochenprüfung zu, die nie stattgefunden hat. Zu lang heisst
 *     deshalb ungültig und nicht „gekürzt gültig".
 *
 * Die Gegenwache dazu steht in `befehle.js` (`kuerzungsspur`) und in
 * `pruefung/gattung.test.mjs` (Positivliste `KUERZUNGEN`).
 * --------------------------------------------------------------------- */

/* Was `overlay.js` als Epoche vergibt: `s<Nummer>.<vier Zeichen>` (siehe
   `DOKUMENTMARKE` dort). Das Muster ist bewusst etwas weiter gefasst als die
   heutige Form — es soll eine Kennung von einem Fliesstext trennen, nicht eine
   Fassung festnageln. */
const EPOCHE_MUSTER = /^[A-Za-z0-9._:-]{1,64}$/;

/** Eine Epoche von der Seite: entweder ganz oder gar nicht. */
function epocheRoh(roh) {
  return typeof roh === "string" && EPOCHE_MUSTER.test(roh) ? roh : null;
}

/*
 * Ein Text von der Seite, wie er GEMESSEN wird: ungekürzt.
 *
 * Er wird nur in eine Zeichenkette gebracht — was über die Leitung kommt, ist
 * JSON und kann eine Zahl oder `null` sein, und ein Vergleich gegen `undefined`
 * hätte am Ende die Wortliste nie gesehen. Gekürzt wird hier nichts: Diese
 * Werte gehen in den Klassifizierer.
 */
function messeingang(roh) {
  return roh === null || roh === undefined ? "" : String(roh);
}

/* --------------------------------------------------------------------- *
 * Rahmenbau
 * --------------------------------------------------------------------- */

function meta(begonnen, tabId, zusatz = {}) {
  return {
    tookMs: Date.now() - begonnen,
    tabId: Number.isInteger(tabId) ? tabId : null,
    clientTime: new Date().toISOString(),
    ...zusatz,
  };
}

function gelungen(id, cmd, data, m) {
  return rahmenDeckeln({ type: "result", id, cmd, success: true, data, meta: m });
}

/*
 * Der Fehlerrahmen. `success: false` ist eine Beobachtung, kein Auftragsende
 * (spec-01 §3.6.4) — der Agent bekommt sie ins Modell und darf anders planen.
 * `message` ist der Satz für den Menschen und wird auf der Agentenseite
 * vorgelesen; `hint` sagt, was stattdessen ginge.
 */
function misslungen(id, cmd, code, message, { retryable = false, hint = null, data = null, m = null } = {}) {
  const rahmen = {
    type: "result",
    id,
    cmd,
    success: false,
    error: { code, message, retryable },
    meta: m || meta(Date.now(), null),
  };
  if (hint) rahmen.error.hint = hint;
  if (data) rahmen.data = data;
  return rahmenDeckeln(rahmen);
}

/* --------------------------------------------------------------------- *
 * Absagen des Inhaltsskripts
 *
 * Der Befund vom 29.07.2026 (M1, M4, M5) — und er stand in fünf Fehlertabellen
 * gleichzeitig: Kennungen, die das Inhaltsskript senden KANN, fehlten dort, und
 * der Vorgabezweig log für sie. `select` beantwortete `feld_geheim` mit dem Code
 * `tab_gone`, dem Satz „Ich konnte auf dieser Seite nichts auswählen." und
 * `retryable: true`. Der Agent erfuhr weder, dass es an einem Geheimfeld lag,
 * noch dass die Verweigerung dauerhaft ist — er las, der Tab sei weg, und wurde
 * zum Wiederholen eingeladen. Das ergibt eine Schleife, in der der Mensch jedes
 * Mal neu gefragt wird und jedes Mal dasselbe scheitert.
 *
 * Zwei Regeln, die daraus folgen und für JEDE dieser Tabellen gelten:
 *
 *  1. **Wer antwortet, lebt.** Hat das Inhaltsskript geantwortet — und sei es
 *     mit einer Absage —, dann ist der Tab erreichbar. `tab_gone` ist in diesem
 *     Fall eine Falschaussage. Der Vorgabezweig `stumm` unten gilt deshalb nur
 *     dort, wo GAR KEINE Antwort kam.
 *  2. **`retryable` ist eine Zusage, keine Höflichkeit.** Es heißt: „derselbe
 *     Aufruf kann beim zweiten Mal gelingen". Ein Geheimfeld, eine Option, die
 *     es nicht gibt, eine Seite ohne messbare Ruhe — nichts davon ändert sich
 *     durch Wiederholen. Steht dort trotzdem `true`, baut der Agent eine
 *     Schleife auf Kosten des Menschen.
 *
 * Und die dritte Regel, die diese Funktion selbst durchsetzt: Eine Kennung, für
 * die es hier keinen Satz gibt, ist ein Fehler bei UNS und wird als solcher
 * benannt — nicht als toter Tab. Dass es sie nicht geben darf, prüft
 * ausfuehrer.test.mjs gegen overlay.js selbst.
 * --------------------------------------------------------------------- */

/**
 * @param {{id:string, cmd:string, meta:Function}} ziel
 * @param {boolean} geantwortet  hat die Seite überhaupt geantwortet?
 * @param {string}  kennung      ihre Fehlerkennung
 * @param {object}  texte        Kennung → [code, satz, hinweis, wiederholbar]
 * @param {{code:string, satz:string, hinweis:string}} stumm  wenn nichts kam
 */
function absageBenennen(ziel, geantwortet, kennung, texte, stumm) {
  /* `kennung` kommt aus einer fremden Seite. `texte[kennung]` allein fände auch
     `constructor` oder `toString` — und stolperte dann beim Auspacken. Gefragt
     wird deshalb nach dem EIGENEN Eintrag, nicht nach irgendeiner Eigenschaft. */
  const eintrag = Object.prototype.hasOwnProperty.call(texte, kennung) ? texte[kennung] : null;
  if (eintrag) {
    const [code, satz, hinweis, nochmal] = eintrag;
    return misslungen(ziel.id, ziel.cmd, code, satz, {
      retryable: nochmal === true,
      hint: hinweis,
      m: ziel.meta(),
    });
  }
  if (geantwortet) {
    return misslungen(ziel.id, ziel.cmd, "client_fehler",
      `${stumm.satz} Das Inhaltsskript hat einen Grund genannt, den diese Fassung nicht kennt.`,
      {
        retryable: false,
        hint: "Den Nutzer bitten, die Erweiterung zu aktualisieren — Inhaltsskript und Ausführer sind auseinandergelaufen.",
        m: ziel.meta(),
      });
  }
  return misslungen(ziel.id, ziel.cmd, stumm.code, stumm.satz,
    { retryable: true, hint: stumm.hinweis, m: ziel.meta() });
}

/** Dasselbe, aber direkt aus einer Antwort von `anSeite`. */
function absageDerSeite(lage, antwort, texte, stumm) {
  const geantwortet = antwort.ok === true;
  const kennung = geantwortet ? String((antwort.antwort && antwort.antwort.fehler) || "") : "";
  return absageBenennen(lage, geantwortet, kennung, texte, stumm);
}

/* Die Absagen, die aus dem Auflösen einer Referenz kommen (`overlay:nachschlagen`
   und alles, was darauf aufsetzt). Sie stehen an einer Stelle, weil sie in vier
   Befehlen dieselben sind — und weil zwei Abschriften voneinander schon dreimal
   auseinandergelaufen sind. */
const REF_ABSAGEN = {
  stale_ref: ["stale_ref", "Diese Referenz gehört zu einer älteren Wahrnehmung.",
    "`readPage` aufrufen und die neuen Referenzen verwenden.", true],
  element_not_found: ["element_not_found", "Das Element gibt es auf der Seite nicht mehr.",
    "`readPage` aufrufen.", true],
  element_not_visible: ["element_not_visible", "Das Element ist gerade nicht sichtbar.",
    "Erst `scroll` zu dem Element, dann noch einmal.", true],
};

/*
 * Die Absagen der Verdeckungswache.
 *
 * Befund vom 11.08.2026, und er ist der teuerste dieses Projektes: Die Wache
 * war gebaut, 372 Prüfsätze standen grün, und im ausgelieferten Klickweg rief
 * sie niemand. Ein Klick ging durch einen deckenden Überzug. Ab jetzt meldet
 * das Inhaltsskript ihre Kennungen, und ab jetzt haben sie hier einen Satz —
 * ohne diese Zeilen liefe `verdeckt` in den Vorgabezweig und der Agent läse
 * „der Tab ist weg, versuch es nochmal", während der Mensch ein
 * Zustimmungsfenster vor sich hat.
 *
 * Die Sätze werden NICHT abgeschrieben, sondern aus `KLICK_ABSAGEN`
 * (befehle.js) gebaut. Zwei Abschriften desselben Satzes sind schon dreimal
 * auseinandergelaufen, und hier hinge an der Abweichung ein Schutz.
 */
function ausKlickwache(...namen) {
  const raus = {};
  for (const name of namen) {
    const a = KLICK_ABSAGEN[name];
    if (!a) continue;
    raus[name] = [a.code, a.satz, a.hinweis, a.retryable === true];
  }
  return raus;
}

/*
 * Zwei Schreibweisen, eine Wache.
 *
 * Das Inhaltsskript übersetzt die Namen der Wache heute schon in die Codes des
 * Drahtformats (`verdeckt` → `element_covered`). Beide Schreibweisen stehen
 * hier trotzdem: Der Ausführer ist die Stelle, an der eine Kennung einen Satz
 * bekommt, und eine Kennung ohne Satz fällt in den Vorgabezweig — dort heisst
 * jede Verdeckung „der Tab ist weg, versuch es nochmal". Genau diese
 * Falschaussage ist der Befund vom 29.07.2026, und sie hier für den Schutz vom
 * 11.08.2026 zu wiederholen wäre die teuerste Art, aus zwei Lehren keine zu
 * ziehen.
 */
const KLICK_WACHE_ABSAGEN = {
  ...ausKlickwache("verdeckt", "klicktaub", "ausserhalb", "keine_flaeche", "leer", "kein_ziel"),
  element_covered: [
    KLICK_ABSAGEN.verdeckt.code,
    KLICK_ABSAGEN.verdeckt.satz,
    KLICK_ABSAGEN.verdeckt.hinweis,
    KLICK_ABSAGEN.verdeckt.retryable === true,
  ],
  /* Ohne Wache keine Bedienung. Das ist die harte Lesart des Befundes und die
     einzige, die ihn wirklich schliesst: Eine Bedienung, die bei fehlender
     Prüfung durchwinkt, ist die Bedienung von vorher. */
  wache_fehlt: ["client_fehler",
    "In diesem Tab fehlt die Wache, die prüft, ob über dem Ziel etwas liegt. Ohne sie bediene ich nichts.",
    "Den Nutzer bitten, die Seite neu zu laden. Danach ist die Wache wieder da.",
    false],
};

/** Dieselbe Wache, aber mit den Worten des jeweiligen Schrittes. */
function wacheAbsagen(satzVerdeckt, hinweisVerdeckt) {
  return {
    ...KLICK_WACHE_ABSAGEN,
    verdeckt: [KLICK_ABSAGEN.verdeckt.code, satzVerdeckt, hinweisVerdeckt, true],
    element_covered: [KLICK_ABSAGEN.verdeckt.code, satzVerdeckt, hinweisVerdeckt, true],
  };
}

/* --------------------------------------------------------------------- *
 * Der Weg zur Seitenleiste
 * --------------------------------------------------------------------- */

/* Eine Meldung an die Seitenleiste. Ist sie zu, geht sie ins Leere — das ist
   kein Fehler und wird deshalb verschluckt. */
function melden(nachricht) {
  chrome.runtime.sendMessage(nachricht).catch(() => {});
}

/*
 * Eine Zeile für das Protokoll der Seitenleiste (§6).
 *
 * Seit v3.5 trägt sie neben dem Satz auch Befehl, Zeit und Ergebnis: Die
 * Seitenleiste soll dieselbe Zeile sortieren und filtern können, die sie
 * vorliest, und ohne Zeitstempel raten zwei Fenster verschieden, wann etwas
 * war. `text` bleibt Pflicht und die erste Angabe — er ist das, was der
 * Mensch hört, und ein Protokoll ohne Satz wäre für ihn leer.
 *
 * Was hier NIE hineingehört, ist die Adresse: Das Protokoll steht offen auf
 * dem Schirm und wird vorgelesen.
 */
function protokoll(text, { cmd = "", ergebnis = "" } = {}) {
  melden({ typ: "link:protokoll", text, cmd, zeit: Date.now(), ergebnis });
}

/* --------------------------------------------------------------------- *
 * Der Riegel
 *
 * Befund vom 14.08.2026 (B3, B4). `Promise.race` beendet das Warten, nicht
 * den Verlierer: Gewann der Not-Aus, lief die Ausführung weiter und griff
 * danach noch in die Seite. Zwei Dinge halten das ab, und beide werden
 * gebraucht:
 *
 *  1. Das Abbruchsignal steckt in JEDEM Aufruf an die Seite (F1). Ist es
 *     gebrochen, wird gar nicht erst gesendet.
 *  2. Nach JEDEM `await` in den `tu*`-Funktionen wird der Riegel gefragt,
 *     bevor der nächste Schritt folgt. Das braucht es zusätzlich, weil nicht
 *     jeder Weg in die Seite über `anSeite` läuft: `tabs.update`,
 *     `tabs.goBack`, `captureVisibleTab` und das Einspielen der
 *     Inhaltsskripte sind eigene Türen.
 *
 * Der Grundsatz, an dem beides hängt: **Nach dem Not-Aus verlässt nichts mehr
 * die Erweiterung in Richtung Seite.**
 * --------------------------------------------------------------------- */

/**
 * Den Riegel dieses Schrittes an den Not-Aus binden.
 *
 * Er bricht, sobald der Not-Aus bricht — und `schliessen()` bricht ihn auch
 * dann, wenn das Rennen anders zu Ende gegangen ist. Der Horcher wird dabei
 * wieder abgemeldet: Das Not-Aus-Signal lebt so lange wie die ganze Sitzung,
 * und ein Horcher je Befehl wäre nach ein paar hundert Schritten eine Liste,
 * die niemand mehr leert.
 */
function riegelBinden(meinSignal) {
  const steuerung = new AbortController();
  const quelle = meinSignal && meinSignal.abbruch ? meinSignal.abbruch : null;
  let horcher = null;
  if (quelle && quelle.aborted === true) {
    steuerung.abort();
  } else if (quelle) {
    horcher = () => steuerung.abort();
    quelle.addEventListener("abort", horcher, { once: true });
  }
  return {
    signal: steuerung.signal,
    schliessen() {
      if (quelle && horcher) quelle.removeEventListener("abort", horcher);
      steuerung.abort();
    },
  };
}

/** Ist der Riegel gefallen? Dann geschieht nichts mehr. */
function riegelZu(lage) {
  if (!lage) return !aktiv;
  if (!aktiv) return true;
  if (Number.isInteger(lage.generation) && lage.generation !== generation) return true;
  return !!(lage.abbruch && lage.abbruch.aborted === true);
}

/** Die Antwort, die ein abgebrochener Schritt gibt. Eine Antwort, kein Sturz. */
function riegelAbsage(lage) {
  return misslungen(lage.id, lage.cmd, "session_beendet",
    "Die Browsersitzung wurde mitten im Schritt beendet. Ich arbeite nicht weiter.",
    { m: lage.meta() });
}

/**
 * Warten, das sich abbrechen lässt.
 *
 * `tuClick` wartete fest 600 ms und las danach die Seite erneut; auch das lief
 * nach dem Not-Aus weiter (B3). Ein Wecker, den niemand löschen kann, hält
 * ausserdem den Dienstarbeiter am Leben.
 */
function schlafen(ms, signal) {
  if (signal && signal.aborted === true) return Promise.resolve();
  return new Promise((fertig) => {
    let horcher = null;
    const uhr = setTimeout(() => {
      if (signal && horcher) signal.removeEventListener("abort", horcher);
      fertig();
    }, ms);
    if (signal) {
      horcher = () => {
        clearTimeout(uhr);
        fertig();
      };
      signal.addEventListener("abort", horcher, { once: true });
    }
  });
}

/**
 * Die Rückfrage beim Menschen.
 *
 * Fail-closed in jeder Richtung: Antwortet die Seitenleiste nicht, ist sie
 * nicht da oder läuft die Frist ab, gilt das als Ablehnung. Eine Freigabe, die
 * niemand erteilt hat, gibt es nicht.
 *
 * Und seit v3.5 rennt auch der Not-Aus mit: Eine Frage, die im Augenblick des
 * Kappens noch offen steht, wird nicht erst nach der Bedenkzeit bemerkt. Das
 * Signal steht IM Rennen und nicht daneben, damit der Wecker danach wirklich
 * gelöscht wird — ein stehengelassener Wecker hält den Hintergrunddienst am
 * Leben, und dreissig Sekunden nach dem Not-Aus ist genau der Zustand, den
 * niemand erwartet.
 *
 * @returns {"ja"|"nein"|"besetzt"|"keine_stelle"|"frist"|"abbruch"}
 */
async function freigabeFragen({ frage, quelle, cmd, id, frist, signal = null }) {
  let uhr = null;
  const uhrenLauf = new Promise((fertig) => {
    uhr = setTimeout(() => fertig("frist"), Math.max(1000, frist));
  });
  const abbruchLauf = signal ? signal.versprechen.then(() => "abbruch") : null;
  const stellen = () => chrome.runtime
    /* `frist` geht mit: Die Freigabekarte zeigt eine Restzeit, und panel.js
       rechnet sie sonst selbst aus `BEFEHLE[cmd].frist` aus. Seit die
       Bedenkzeit nicht mehr aus der Befehlsfrist stammt (M3), wäre diese
       Rechnung falsch — und eine Restzeit, die nicht stimmt, ist schlimmer als
       gar keine. */
    .sendMessage({ typ: "link:schritt-freigabe", frage, quelle, cmd, id, frist })
    .then((antwort) => {
      if (antwort && antwort.ja === true) return "ja";
      /* „Besetzt" ist ausdrücklich KEIN Nein: Die Seitenleiste hatte gerade
         eine andere Frage offen. Das als Ablehnung auszugeben hieße, dem
         Nutzer eine Entscheidung zuzuschreiben, die er nie getroffen hat. */
      if (antwort && antwort.besetzt === true) return "besetzt";
      return "nein";
    })
    .catch(() => "keine_stelle");

  /*
   * Der Weg zum abwesenden Menschen (Befund BRUECKE-2 und BRUECKE-3).
   *
   * Antwortet niemand auf die Frage, ist die Seitenleiste zu — und im
   * Hintergrundbetrieb ist sie das immer. Bis zum 14.08.2026 endete es hier:
   * `grant_required`, null Systemmeldungen, null Abzeichenwechsel. Der Agent
   * blieb an der Kasse stehen, und der Mensch erfuhr es erst, wenn er die
   * Seitenleiste von sich aus wieder öffnete. `panel.js` sagt ihm dabei
   * wörtlich zu, der Dienst mache „mit dem Fragezeichen am Symbol auf sich
   * aufmerksam".
   *
   * Also wird er gerufen, bevor abgesagt wird: eine Systemmeldung, die auch
   * ohne offene Seitenleiste ankommt, und die Bitte an `link.js`, das
   * Abzeichen umzustellen (das Symbol gehört dort hin, und zwei Besitzer für
   * ein Abzeichen wären der F4-Fehler).
   *
   * Danach bekommt eine Seitenleiste, die gerade aufgeht, EINE zweite
   * Gelegenheit. Die Nachfrist ist bewusst kurz: Der Ruf ist der Kanal, der
   * den Menschen erreicht, das zweite Fragen fängt nur die Seitenleiste ein,
   * die schon im Aufgehen war. Wer erst danach kommt, ist nicht verloren —
   * die Absage ist BENANNT und `retryable`, der Agent schickt den Schritt
   * noch einmal, und dann steht die Frage vor einem Menschen, der zusieht.
   * Eine halbe Minute lang blind zu warten wäre für jeden Einzelbefehl eine
   * halbe Minute Stillstand und würde den Menschen keinen Deut früher
   * erreichen.
   */
  const rufen = async () => {
    const erste = await stellen();
    if (erste !== "keine_stelle") return erste;
    const ruf = menschRufen({ frage, cmd, id });
    await schlafen(RUF_NACHFRIST_MS, signal && signal.abbruch);
    const zweite = await stellen();
    if (zweite !== "keine_stelle") return zweite;
    /* Auch beim zweiten Mal niemand da: Das sind ZWEI Lagen mit zwei Namen.
       „unerreichbar" heißt: gerufen wurde (Systemmeldung, Abzeichen), und in
       der Nachfrist kam niemand. „unzustellbar" heißt: Auch der Ruf selbst
       hatte keinen Weg zum Menschen — keine Systemmeldung möglich, kein
       Abzeichen. Welcher Absagecode daraus wird, entscheidet Schritt 10 der
       Schleife, an genau EINER Stelle (Festlegung F4). */
    return ruf && ruf.erreicht === true ? "unerreichbar" : "unzustellbar";
  };

  try {
    const laeufe = [rufen(), uhrenLauf];
    if (abbruchLauf) laeufe.push(abbruchLauf);
    return await Promise.race(laeufe);
  } finally {
    if (uhr) clearTimeout(uhr);
    /* Läuft unsere Frist ab, während der Mensch noch überlegt, muss die Karte
       weg — sonst beantwortet er eine Frage, auf die niemand mehr wartet
       (spec-01 §3.6.3, „Verspätete Freigabe"). */
    melden({ typ: "link:freigabe-zurueckziehen", id });
    /* Und das Fragezeichen am Symbol geht mit der Frage weg. Ein Zeichen, das
       stehenbleibt, nachdem es nichts mehr zu beantworten gibt, ist beim
       dritten Mal keines mehr. Direkt bei `link.js` und nicht per Nachricht —
       der Weg über `sendMessage` erreichte den eigenen Dienstarbeiter nie
       (Befund RUF-1). */
    if (gerufen) {
      gerufen = false;
      try {
        link.freigabeRufAus();
      } catch (_) {
        /* Ein Zeichen, das sich nicht wegräumen lässt, hält keine Antwort auf. */
      }
    }
  }
}

/*
 * Wie lange eine Seitenleiste Zeit bekommt, die gerade aufgeht.
 *
 * Kurz und begründet: siehe `freigabeFragen`. Sie steht als benannte
 * Konstante, weil eine Zahl mitten im Ablauf eine Entscheidung versteckt.
 */
const RUF_NACHFRIST_MS = 1200;

/* Steht gerade ein Ruf aus? Im Modul, nicht in der Ablage — stirbt der
   Dienstprozess, ist auch die Frage weg, die er stellen wollte. */
let gerufen = false;

/**
 * Den Menschen rufen, der gerade nicht zusieht (§8.4, Befund BRUECKE-3,
 * verdrahtet mit Befund RUF-1 vom 15.08.2026).
 *
 * Zwei Zeichen, und sie tun Verschiedenes: Die Systemmeldung ist der
 * Augenblick („dein Browser wartet gerade auf dich"), das Abzeichen ist der
 * Zustand („da ist noch etwas offen"). Beides ist Beste-Kraft und niemals
 * eine Bedingung — ein Schutz, der an einer fehlenden Berechtigung stürzte,
 * wäre schlimmer als einer, der leise ist.
 *
 * Gesetzt wird beides von `link.freigabeRufen`, und NUR von dort: Das Symbol
 * gehört `link.js`, und zwei Stellen, die dasselbe Zeichen setzen, sind die
 * Bauform, die Festlegung F4 verbietet. Bis zum 15.08.2026 sagte diese Datei
 * per `sendMessage` „nur Bescheid" — an einen Empfänger, den es baulich nie
 * geben konnte, denn `link.js` läuft im selben Dienstarbeiter. Die
 * Systemmeldung entstand hier als zweite, flüchtige Fassung daneben. Jetzt
 * gibt es EINE Fassung des Rufs, die aus `link.js`, mit `requireInteraction`
 * und dem Fragezeichen am Symbol.
 *
 * @returns {{erreicht:boolean, wege:string[]}} `erreicht:false` heißt: Kein
 *   Weg hat den Menschen erreicht — Stufe 3, die benannte Absage.
 */
function menschRufen({ frage = "", cmd = "", id = "" } = {}) {
  gerufen = true;
  try {
    return link.freigabeRufen({ frage, cmd, id });
  } catch (_) {
    /* Ein Ruf, der stürzt, hat niemanden erreicht — das ist die ehrliche
       Antwort, und sie fällt in die strengere Richtung. */
    return { erreicht: false, wege: [] };
  }
}

/* --------------------------------------------------------------------- *
 * Die Wache: Wo steht der Tab JETZT?
 *
 * Befund vom 11.08.2026, Stufe HOCH. Schritt 6 der Befehlsschleife prüft den
 * Bereich an der Adresse, auf der der Tab steht — aber das ist die Adresse VOR
 * der Rückfrage beim Menschen. Zwischen der Freigabe und der Ausführung liegen
 * Sekunden bis Minuten Menschenzeit, und in dieser Zeit kann der Tab woanders
 * stehen: Die Seite leitet sich selbst weiter (meta refresh, `location`, ein
 * abgeschicktes Formular, ein Zeitgeber), oder der Mensch wechselt selbst.
 * Danach wurde der Tab weiterbenutzt, als hätte niemand hingesehen.
 *
 * Am teuersten bei `screenshot`: `captureVisibleTab` nimmt den GANZEN
 * sichtbaren Tab auf, es gibt keinen Ausschnitt, und das Bild geht an die
 * Cloud. Freigegeben war der Warenkorb, aufgenommen wurde das Onlinebanking.
 * Aber es ist kein Sonderfall des Bildes: Jeder Weg, auf dem Seiteninhalt nach
 * draußen geht, hat dieselbe Lücke.
 *
 * Deshalb steht die Prüfung hier EINMAL und wird an den vier Stellen gerufen,
 * an denen wirklich etwas den Tab verlässt:
 *
 *   1. In der Befehlsschleife, direkt nach dem Ja und vor allem Übrigen. Damit
 *      hängt kein einziger der dreizehn Befehle mehr an der alten Messung —
 *      auch der Arbeitszeiger fährt dann nicht mehr über eine fremde Seite.
 *   2. In `wahrnehmenGesichert`, also vor JEDER Wahrnehmung. Das schließt den
 *      Fall, den die Schleife nicht sehen kann: Der Schritt selbst (ein Klick,
 *      ein abgeschicktes Formular) bringt die Seite erst zum Wechseln, und die
 *      Wahrnehmung danach läse die neue.
 *   3. In `tuExtract` vor dem Ablesen — der einzige Weg, der Seitentext
 *      ausliefert, ohne durch die Wahrnehmung zu gehen.
 *   4. In `tuScreenshot` vor JEDER einzelnen Aufnahme, auch vor der zweiten der
 *      Qualitätsleiter.
 *
 * Zwei Dinge, die die Wache ausdrücklich NICHT tut:
 *
 *  - Sie nennt die neue Adresse nirgends. Eine Absage, die „ich fotografiere
 *    dein Onlinebanking nicht" sagt, hat gerade verraten, dass dort das
 *    Onlinebanking steht. Die Ablehnung wäre dann selbst das Leck, das sie
 *    verhindern soll. Sie geht auch nicht ins Protokoll der Seitenleiste.
 *  - Sie verlangt den Vordergrund nur da, wo er technisch zählt. Seit 0.5.2
 *    darf im Hintergrund gearbeitet werden; `captureVisibleTab` kann das aber
 *    nicht, es nimmt immer den aktiven Tab des Fensters auf. Steht inzwischen
 *    ein anderer Tab vorn, wäre das Bild von einer Seite, die nie freigegeben
 *    wurde — dafür trägt nur der Bildweg `vordergrund: true`.
 * --------------------------------------------------------------------- */

/* Die Sätze stehen als Konstanten, weil sie an mehreren Stellen entstehen und
   ein Prüfsatz sie WÖRTLICH misst. Sie werden auf der Agentenseite vorgelesen:
   Kommas statt Gedankenstrichen. */
const WACHE_TAB_WEG = "Der Tab, den ich steuern durfte, ist nicht mehr da.";
const WACHE_ABGEWANDERT =
  "Dieser Tab hat seit der Freigabe die Seite gewechselt. Ich arbeite hier nicht weiter, und ich sage auch nicht, wo er jetzt steht.";
const WACHE_NICHT_VORN =
  "Dieser Tab steht gerade nicht im Vordergrund. Ich fotografiere nicht, was ich nicht steuern darf.";
/*
 * Der Satz für den gesperrten Wirt (Befund vom 14.08.2026, B2).
 *
 * Er nennt die Adresse nicht, aus demselben Grund wie `WACHE_ABGEWANDERT`.
 * Er nennt aber die Sperrliste, denn die hat der Mensch selbst geschrieben —
 * ihm zu sagen, dass seine eigene Einstellung greift, verrät nichts.
 */
const WACHE_GESPERRT =
  "Dieser Tab steht auf einem Wirt, den du gesperrt hast. Hier arbeite ich nicht, und ich lese hier auch nichts.";

/**
 * Noch einmal hinsehen, bevor etwas geschieht.
 *
 * `wirte` sind die Wirte, über die der Mensch in DIESEM Schritt entschieden
 * hat: der, auf dem der Tab beim Fragen stand, und bei `navigate` das Ziel.
 * Sie stehen hier wegen des Befundes vom 14.08.2026 (B2): Die Sperrliste
 * wurde ausschliesslich VOR der Frage gemessen. Wanderte der Tab danach von
 * selbst auf einen gesperrten Wirt — Weiterleitung, Zeitgeber, abgeschicktes
 * Formular —, arbeitete die Erweiterung dort weiter, als hätte niemand
 * hingesehen.
 *
 * Warum nicht schlicht „gesperrt heisst nie": Weil §3.2 die Sperrliste als
 * Rückfall auf Handbetrieb beschreibt und nicht als Verbot. Es bleibt seine
 * Bank und nicht unsere; sagt er ja, wird gearbeitet. Diese Wache trennt
 * deshalb genau das eine vom anderen: Ein gesperrter Wirt, über den gefragt
 * wurde, ist erlaubt. Ein gesperrter Wirt, auf dem der Tab überraschend
 * steht, ist es nicht.
 *
 * @param {{id:string, cmd:string, meta:Function}} ziel
 * @param {number} tabId
 * @param {object} sitzung
 * @param {{vordergrund?:boolean, wirte?:Set<string>}} wahl
 * @returns {Promise<{ok:true, tab:object, adresse:string}|{ok:false, absage:object}>}
 */
async function wacheStellen(ziel, tabId, sitzung, { vordergrund = false, wirte = null } = {}) {
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_) {
    tab = null;
  }
  if (!tab) {
    return {
      ok: false,
      absage: misslungen(ziel.id, ziel.cmd, "tab_gone", WACHE_TAB_WEG, {
        retryable: false,
        hint: "Den Nutzer bitten, den Tab offen zu lassen, und eine neue Sitzung beginnen.",
        m: ziel.meta(),
      }),
    };
  }

  const adresse = typeof tab.url === "string" ? tab.url : "";
  if (!adresse || !bereichPasst(adresse, sitzung)) {
    /* Auch diese Meldung trägt keine Adresse: Die Seitenleiste steht offen auf
       dem Schirm, und das Protokoll wird vorgelesen. */
    protokoll("Der Tab hat die Seite gewechselt, ich arbeite hier nicht weiter.", {
      cmd: ziel.cmd,
      ergebnis: "scope_violation_local",
    });
    return {
      ok: false,
      absage: misslungen(ziel.id, ziel.cmd, "scope_violation_local", WACHE_ABGEWANDERT, {
        retryable: false,
        hint: "Den Nutzer bitten, den Tab auf eine freigegebene Seite zurückzubringen, danach den Schritt neu senden.",
        m: ziel.meta(),
      }),
    };
  }

  if (vordergrund && tab.active !== true) {
    return {
      ok: false,
      absage: misslungen(ziel.id, ziel.cmd, "tab_nicht_im_vordergrund", WACHE_NICHT_VORN, {
        retryable: true,
        hint: "Den Nutzer bitten, den Tab nach vorn zu holen — oder `readPage` nehmen, das geht auch im Hintergrund.",
        m: ziel.meta(),
      }),
    };
  }

  const gesperrt = await wirtGesperrt(adresse, wirte);
  if (gesperrt) {
    protokoll("Der Tab steht auf einem gesperrten Wirt, ich arbeite hier nicht weiter.", {
      cmd: ziel.cmd,
      ergebnis: "guardrail_blocked",
    });
    return {
      ok: false,
      absage: misslungen(ziel.id, ziel.cmd, "guardrail_blocked", WACHE_GESPERRT, {
        retryable: false,
        hint: "Den Nutzer bitten, den Tab zurückzubringen — oder diesen Wirt in den Einstellungen von der Sperrliste zu nehmen.",
        m: ziel.meta(),
      }),
    };
  }

  return { ok: true, tab, adresse };
}

/**
 * Die Regeln zweier Wirte, in die strengere Richtung zusammengelegt (B2).
 *
 * Wirft nie. Lässt sich die Matrix nicht lesen, gilt, was `regelnFuer` selbst
 * für diesen Fall vorsieht — diese Funktion erfindet keine Erlaubnis.
 */
async function regelnZusammen(adresse, zieladresse) {
  const hier = await regelnFuer(adresse);
  if (!zieladresse) return hier;
  const dort = await regelnFuer(zieladresse);
  const freiHier = Array.isArray(hier && hier.frei) ? hier.frei : [];
  const freiDort = Array.isArray(dort && dort.frei) ? dort.frei : [];
  return {
    gesperrt: (hier && hier.gesperrt === true) || (dort && dort.gesperrt === true),
    frei: freiHier.filter((k) => freiDort.includes(k)),
  };
}

/**
 * Darf dieser Agent die Klasse auf BEIDEN Wirten (Befund AUTOMODUS-5)?
 *
 * Dieselbe Zusammenlegung wie in `regelnZusammen`, nur für die Agentenmatrix:
 * Erlaubt ist, was auf der Herkunft UND auf dem Ziel erlaubt ist. Ohne Ziel
 * (jeder Befehl ausser `navigate`) bleibt es bei der Herkunft.
 *
 * Warum die strengere Richtung und nicht „eines von beiden genügt": Eine
 * Freischaltung ist eine Aussage über EINEN Wirt. Aus „darf auf geizhals.de
 * navigieren" folgt nichts über fremd.de — und der Befehl, der den Wirt
 * wechselt, liefert am Ende die Wahrnehmung des ZIELS an den Agenten.
 */
async function agentDarfBeides(agent, adresse, zieladresse, klasse) {
  if (!(await agentDarf(agent, adresse, klasse))) return false;
  if (!zieladresse) return true;
  return agentDarf(agent, zieladresse, klasse);
}

/**
 * Steht dieser Wirt auf der Sperrliste, ohne dass jemand danach gefragt wurde?
 *
 * Wirft nie: Eine Matrix, die sich nicht lesen lässt, hält keine Sitzung an —
 * aber sie erteilt auch keine Erlaubnis, deshalb gilt im Zweifel „nicht
 * gesperrt" nur, wenn wirklich nichts dagegen spricht.
 */
async function wirtGesperrt(adresse, wirte) {
  const wirt = hostAus(adresse);
  if (wirte && wirt && wirte.has(wirt)) return false;
  try {
    const regeln = await regelnFuer(adresse);
    return regeln && regeln.gesperrt === true;
  } catch (_) {
    /* Der Rückfall führt zur STRENGEREN Antwort und nicht zur milderen.
       Hier stand `return false`, also „nicht gesperrt" — und damit hätte eine
       Matrix, die sich nicht lesen lässt, jede Sperre des Menschen aufgehoben.
       Das ist dieselbe Fehlerklasse wie ein `catch`, der eine Freigabe
       erfindet: Wer nicht nachsehen konnte, weiss nicht, dass es erlaubt ist.
       `regelnFuer` wirft heute nicht (matrix.js fängt selbst); dass dieser
       Zweig tot ist, ist kein Grund, ihn falsch stehen zu lassen. */
    return true;
  }
}

/* --------------------------------------------------------------------- *
 * Die einzelnen Befehle
 *
 * Die Lesebefehle verändern die Seite nicht; der Agentenzeiger und der grüne
 * Rahmen liegen im geschlossenen Schattenbaum der Erweiterung. `click`, `type`
 * und `select` verändern die Seite — sie stehen auf Stufe `write`, und jeder
 * einzelne Schritt geht durch die Rückfrage beim Menschen (befehle.js,
 * Freigabe „immer").
 *
 * `navigate` und `back` sind der Sonderfall dazwischen: Sie verändern die Seite
 * nicht, aber sie wechseln sie — und nach einem Wechsel gilt nichts mehr, was
 * vorher galt. Weder die Referenzen noch das Inhaltsskript noch die Zusage,
 * dass diese Adresse freigegeben ist. Deshalb hat ihr Nachlauf eine eigene
 * Funktion (`nachDemWechsel`) und prüft dort alles noch einmal.
 *
 * Jede Ausführung nimmt ihre Parameter aus `lage.plan` und nie mehr direkt aus
 * dem Rahmen: Was im Plan steht, ist geprüft; was im Rahmen steht, ist eine
 * Behauptung des Relays.
 * --------------------------------------------------------------------- */

/*
 * Was der Ausführer sich selbst zurückhält, wenn er die Seite fragt.
 *
 * Beim Nachmessen am 29.07.2026 gefunden: Wo ein Aufruf an die Seite die GANZE
 * Restfrist bekam, liefen zwei Uhren auf dieselbe Millisekunde — die des
 * Aufrufs und der Wecker des Befehls. Wer gewann, war Zufall (gemessen: rund
 * jeder zwanzigste Lauf ging anders aus). Gewann der Wecker, bekam der Agent
 * `settle_timeout` („Die Seite ist in der Frist nicht fertig geworden") statt
 * der genauen Aussage des Befehls — und bei `click`, `type` und `select` sogar
 * dann, wenn der Schritt längst stattgefunden hatte und nur die Wahrnehmung
 * danach hing. Ein Schritt, der geschehen ist und als nicht geschehen gemeldet
 * wird, ist die schlimmste Sorte Falschaussage.
 *
 * Der Abstand sorgt dafür, dass immer der Befehl antwortet und der Wecker das
 * bleibt, was er sein soll: das letzte Netz.
 */
const SEITEN_RESERVE_MS = 1500;

/*
 * Der Verdacht auf eingeschleuste Anweisungen (§9).
 *
 * Er wird auf JEDEN Textbaum gelegt, den diese Erweiterung erhebt — und zwar
 * hier, an der einen Stelle, durch die alle Wahrnehmungen laufen. Er an jedem
 * der dreizehn Befehle einzeln zu prüfen wäre dreizehn Gelegenheiten, ihn zu
 * vergessen; das ist der Befund vom 11.08.2026 in anderer Gestalt.
 *
 * Ein Treffer beendet die Sitzung NICHT und lehnt den Schritt NICHT ab. Er tut
 * genau zwei Dinge: Er hält die Automatik an und fällt auf Mitarbeit zurück,
 * und er sagt es dem Menschen. Der Grund steht im Vertrag: Eine Seite, auf der
 * „ignore previous instructions" steht, kann auch schlicht ein Blogartikel
 * über Einschleusung sein. Ein Schutz, der bei jedem Fachartikel die Leitung
 * kappt, wird abgeschaltet, und dann schützt er gar nichts mehr.
 *
 * Was der Agent davon erfährt, steht in `meta` und nicht im Fehler: Der Schritt
 * hat stattgefunden, das Gelesene ist echt, und nur seine Herkunft ist
 * verdächtig. Das Muster ist UNSER Wort aus der Liste, nie der Fremdtext, in
 * dem es stand.
 */
/*
 * Der fertige Befund, nicht der Text.
 *
 * Befund AUTOMODUS-2, dritte Fundstelle derselben Bauform (Merkzettel
 * `fundament.md`, 5.4): Hier stand `einschleusungMessen(lage, baum.text, …)`,
 * und `baum.text` ist DREIFACH gedeckelt — 400 rohe Knoten, 120 Zeichen je
 * Name, 12.000 Zeichen im Ganzen. Ein „ignore previous instructions" hinter
 * Zeichen 12.000 oder in der 401. Zeile wurde nie gefunden, und eine Seite
 * bestimmt selbst, wie lang sie ist.
 *
 * `textbaumBauen` misst den Verdacht deshalb selbst, über `baum.volltext` aus
 * den ROHEN Knoten und ohne jede Kürzung. Diese Funktion nimmt das Ergebnis
 * entgegen; sie lässt an der Aufrufstelle nichts mehr auszuwählen.
 */
async function einschleusungMelden(lage, befund, adresse = "") {
  if (!lage) return;
  const v = befund && typeof befund === "object" ? befund : { verdacht: false, muster: "" };
  if (!v.verdacht) return;
  /* Nur der erste Treffer zählt. Ein zweiter Fund im selben Schritt wäre
     dieselbe Aussage ein zweites Mal, und der Modus steht dann schon. */
  if (lage.einschleusung) return;
  lage.einschleusung = v.muster;

  const heruntergestuft = lage.modus === "auto";
  if (heruntergestuft) {
    lage.modus = "assist";
    const stand = await modusStandLesen();
    stand.tabs[String(lage.tabId)] = "assist";
    await modusStandSchreiben(stand);
    await modusAnDieSeite(lage.tabId, "assist", false, lage.abbruch);
  }
  protokoll(
    "Auf dieser Seite steht ein Versuch, mir neue Anweisungen unterzuschieben. Ich frage ab jetzt wieder bei jedem Schritt nach.",
    { cmd: lage.cmd, ergebnis: "injection_suspected" }
  );

  /*
   * Befund vom 14.08.2026 (M2): Bis hierher ging der Fund AUSSCHLIESSLICH als
   * Protokollzeile an die Seitenleiste. Ist sie zu — und im Hintergrundbetrieb
   * ist sie das immer —, erfuhr es niemand, und im Protokollbuch stand es
   * auch nicht. Ein Schutz, dessen Auslösen niemand je erfährt, ist eine
   * Zusage ohne Zeugen.
   *
   * Zwei Wege, und sie tun Verschiedenes: Das Buch ist die Nachschau („was ist
   * in meinem Namen geschehen?"), die Systemmeldung ist der Augenblick („dein
   * Browser arbeitet gerade anders als eingestellt").
   *
   * Der Eintrag ins Buch ist ausdrücklich EIN ZWEITER neben dem der Aktion.
   * §8.3 sagt „jede Fernaktion bekommt genau einen Eintrag", und dieser hier
   * ist keine Fernaktion, sondern ein Befund über die Seite, auf der sie
   * stattfand. Er hätte in der Zeile der Aktion keinen Platz: Ihre Felder sind
   * eine Positivliste, und die aufzubohren hiesse, die Datenminimierung
   * aufzumachen, die den Sinn des Buches trägt.
   */
  await buchEintragen({
    zeit: Date.now(),
    agent: lage.agent,
    cmd: lage.cmd,
    url: adresse || (lage.kopf && lage.kopf.url) || "",
    ergebnis: "injection_suspected",
    /* Die Klassen des Schrittes gehören nicht hierher: Dieser Eintrag sagt
       etwas über die Seite, nicht über die Handlung. */
    klassen: [],
  }).catch(() => undefined);

  /* Die Systemmeldung nur, wenn sich WIRKLICH etwas geändert hat. Bei jedem
     Fachartikel über Einschleusung eine Meldung zu werfen, wäre der schnellste
     Weg, sie abzuschalten — und dann meldet auch die wichtige nichts mehr. */
  if (heruntergestuft) systemmeldung(
    katalog(
      "einschleusung_meldung_titel",
      "SMarTrChrome hat die Automatik angehalten"
    ),
    katalog(
      "einschleusung_meldung_text",
      "Auf der offenen Seite steht ein Versuch, dem Agenten neue Anweisungen unterzuschieben. Ab jetzt wird wieder bei jedem Schritt gefragt."
    )
  );
}

/*
 * Ein Satz für den MENSCHEN, aus dem Sprachkatalog (Befund BRUECKE-5).
 *
 * Gemessen am 14.08.2026 mit dem echten englischen Katalog: Die Start-
 * Systemmeldung und der Symboltitel kamen englisch, die Einschleusungsmeldung
 * blieb deutsch — sie war die einzige Zeile dieser Erweiterung, die den
 * abwesenden Menschen erreicht, und ein englischsprachiger Käufer bekam sie
 * auf Deutsch. Vertrag §12 nimmt nur die Sätze AN DEN AGENTEN aus; das hier
 * ist Oberfläche.
 *
 * Der deutsche Wortlaut bleibt als Rückfall stehen und ist kein Schmuck:
 * `chrome.i18n.getMessage` gibt bei einem fehlenden Schlüssel die LEERE
 * Zeichenkette zurück (so verhält sich Chrome), und eine Systemmeldung ohne
 * Text ist eine Warnung, die niemand lesen kann. Solange die Schlüssel in
 * `_locales/*` fehlen, meldet diese Stelle also weiter auf Deutsch — das ist
 * gemeldeter Fremdbedarf und keine stille Lücke.
 */
function katalog(schluessel, rueckfall) {
  try {
    const t = chrome.i18n && typeof chrome.i18n.getMessage === "function"
      ? chrome.i18n.getMessage(schluessel)
      : "";
    return typeof t === "string" && t.length ? t : rueckfall;
  } catch (_) {
    return rueckfall;
  }
}

/*
 * Eine Meldung, die auch ohne offene Seitenleiste ankommt (M2).
 *
 * Sie ist Beste-Kraft und niemals eine Bedingung: Fehlt die Berechtigung
 * `notifications`, gibt es die Schnittstelle gar nicht, und dann bleibt es
 * beim Protokollbuch. Ein Schutz, der an einer fehlenden Berechtigung
 * stürzte, wäre schlimmer als einer, der leise ist.
 */
function systemmeldung(titel, text) {
  try {
    if (!chrome.notifications || typeof chrome.notifications.create !== "function") return;
    /*
     * Der Pfad des Symbols wird gegen die Erweiterungswurzel aufgelöst und
     * nicht gegen die Adresse des Dienstarbeiters (Befund BRUECKE-8).
     * `worker.js` liegt unter `chrome-extension://ID/src/background/`; ein
     * relatives „icons/icon-128.png" zeigte von dort auf
     * `src/background/icons/…`, das es nicht gibt, und
     * `chrome.notifications.create` scheitert dann mit „Unable to download all
     * specified images" — der `catch` unten verschluckt den Fehlschlag, und
     * damit fällt STUMM genau das eine der drei Zeichen aus §8.4 aus, das den
     * Menschen im anderen Fenster erreicht.
     */
    const symbol = typeof chrome.runtime.getURL === "function"
      ? chrome.runtime.getURL("icons/icon-128.png")
      : "icons/icon-128.png";
    const zurueck = chrome.notifications.create("", {
      type: "basic",
      iconUrl: symbol,
      title: titel,
      message: text,
    });
    if (zurueck && typeof zurueck.catch === "function") zurueck.catch(() => {});
  } catch (_) {
    /* Ohne Meldungsrecht bleibt das Buch der Weg. */
  }
}

/*
 * Seitentext, der den Browser verlässt, ohne durch die Wahrnehmung zu gehen.
 *
 * Der Verdacht wird über die ROHEN Werte gelegt — vor jedem Deckel und vor
 * jedem `saeubern`. Die Aufrufer geben einfach hinein, was sie ausliefern
 * wollen; was davon eine Zeichenkette ist, entscheidet `messeingang`.
 */
async function seitentextMessen(lage, werte) {
  if (!lage) return;
  const teile = [];
  const sammeln = (w) => {
    if (Array.isArray(w)) {
      for (const e of w) sammeln(e);
      return;
    }
    if (w && typeof w === "object") {
      teile.push(messeingang(w.name), messeingang(w.wert), messeingang(w.rolle));
      return;
    }
    teile.push(messeingang(w));
  };
  sammeln(werte);
  await einschleusungMelden(
    lage,
    einschleusungVerdacht(teile.join(" ")),
    (lage.kopf && lage.kopf.url) || ""
  );
}

/** Was der Agent über einen Einschleusungsverdacht erfährt. */
function einschleusungAnhaengen(rahmen, lage) {
  if (!rahmen || typeof rahmen !== "object" || !lage || !lage.einschleusung) return rahmen;
  rahmen.meta = {
    ...(rahmen.meta || {}),
    warnung: "injection_suspected",
    muster: lage.einschleusung,
    modus: lage.modus,
  };
  return rahmen;
}

/** Die Wahrnehmung erheben und in den Textbaum verwandeln. */
async function wahrnehmen(tabId, kopf, frist, offscreen = false, lage = null) {
  const antwort = await anSeite(
    tabId,
    { typ: "overlay:baum", offscreen: offscreen === true },
    frist,
    { signal: lage && lage.abbruch }
  );
  /* `geantwortet` bleibt erhalten und wird nicht mit der Kennung verrechnet:
     „die Seite hat sich gemeldet und konnte nicht" ist etwas anderes als „von
     der Seite kam gar nichts". Vorher fiel beides auf denselben Satz zusammen. */
  if (!antwort.ok) return { ok: false, geantwortet: false, fehler: antwort.fehler };
  if (!antwort.antwort.ok) {
    return { ok: false, geantwortet: true, fehler: String(antwort.antwort.fehler || "") };
  }
  const roh = antwort.antwort;
  const baum = textbaumBauen(roh.knoten, {
    /* Adresse und Titel kommen vom Browser, nicht aus der Seite. Eine Seite,
       die ihren eigenen Namen in die Kopfzeile schreiben darf, kann dem
       Agenten vorspielen, er stünde woanders. */
    url: kopf.url,
    titel: kopf.titel,
    epoche: roh.epoche,
  });
  /* Vor dem Verpacken, nicht danach: Der Modus soll schon stehen, wenn der
     nächste Schritt die Entscheidungstabelle fragt.

     Gemessen wird `baum.einschleusung` und nicht mehr `baum.text`: Der Befund
     entsteht in `textbaumBauen` aus den ROHEN Knoten, ohne die drei Deckel des
     Anzeigetextes (Begründung bei `einschleusungMelden`). Hier bleibt nichts
     mehr auszuwählen — die Aufrufstelle kann die Wache nicht mehr aus
     Versehen an den gekürzten Text hängen. */
  await einschleusungMelden(lage, baum.einschleusung, kopf.url);
  return {
    ok: true,
    snapshot: {
      /* Die Epoche ist eine Kennung und wird gemessen, nicht geschnitten
         (siehe `epocheRoh`). Der Agent schickt sie als `snapshotEpoch` zurück,
         und die Seite prüft sie auf Gleichheit. */
      epoch: epocheRoh(roh.epoche) || "",
      url: kopf.url,
      title: saeubern(kopf.titel, 120),
      text: baum.text,
      elementCount: baum.elementCount,
      truncated: baum.truncated,
    },
    ausgelassen: baum.ausgelassen,
  };
}

/**
 * Wahrnehmen, aber vorher nachsehen, wo der Tab steht.
 *
 * Der Kopf kommt hier aus der Wache und nicht mehr aus `lage.kopf`: Ein Tab,
 * der auf demselben Wirt eine andere Unterseite geöffnet hat, ist erlaubt —
 * aber dann muss auch die Adresse im Textbaum die neue sein. Vorher trug die
 * Wahrnehmung die Adresse VOR dem Schritt, und der Agent las eine Seite unter
 * dem Namen einer anderen.
 *
 * Misslingt die Wache, kommt `ok: false` mit `ausserhalb: true` und dem
 * fertigen Ablehnungsrahmen zurück. Wer die Wahrnehmung nur als Zugabe
 * mitschickt (scroll, click, type, select, waitFor), lässt sie dann einfach
 * weg: Der Schritt selbst hat stattgefunden, und ihn nachträglich als
 * gescheitert zu melden wäre die schlimmere Falschaussage.
 */
async function wahrnehmenGesichert(lage, offscreen = false) {
  if (riegelZu(lage)) return { ok: false, geantwortet: false, fehler: "abgebrochen" };
  const wache = await wacheStellen(lage, lage.tabId, lage.sitzung, { wirte: lage.wirte });
  if (!wache.ok) {
    return { ok: false, geantwortet: false, fehler: "bereich_verlassen", ausserhalb: true, absage: wache.absage };
  }
  const kopf = { url: wache.adresse, titel: (wache.tab && wache.tab.title) || "" };
  return wahrnehmen(lage.tabId, kopf, lage.seitenfrist(), offscreen, lage);
}

/*
 * Den Bildlaufstand merken, wo die Seite ihn ohnehin mitschickt.
 *
 * Er gehört zur Schleifenmarke (§5): Dreimal „auf den nächsten Knopf klicken"
 * mit wanderndem Bildlauf ist Arbeit, dreimal ohne ist eine Schleife. Ihn vor
 * jedem Schritt eigens zu erfragen kostete einen ganzen Umlauf je Befehl.
 *
 * Bleibt er stehen, weil kein Befehl ihn berichtet hat, fällt die Erkennung
 * strenger aus und nicht milder: Sie fragt einmal mehr. Das ist dieselbe
 * erlaubte Richtung wie beim Klassifizierer — ein Fehlalarm kostet eine
 * Rückfrage, ein übersehener Treffer kostet einen Auftrag, der im Kreis läuft.
 */
function bildlaufMerken(tabId, y) {
  const zahl = Number(y);
  if (Number.isFinite(zahl)) bildlaufStand.set(tabId, Math.round(zahl));
}

async function tuReadPage(rahmen, lage) {
  /* `includeOffscreen` ist der einzige Parameter, den diese Fassung von
     `readPage` kennt. `mode` reicht der Relay bewusst nicht durch (dasselbe
     Wort heißt in der Sitzung „tab|domains"), und ein Ausschnitt ist die
     Aufgabe von `extract` — beides wird in `parameterPruefen` benannt
     abgelehnt statt hier stillschweigend zur ganzen Seite. */
  const w = await wahrnehmenGesichert(lage, lage.plan.offscreen === true);
  /* Hier ist die Wahrnehmung der Befehl selbst und keine Zugabe: Steht der Tab
     nicht mehr im freigegebenen Bereich, geht die Ablehnung der Wache raus. */
  if (w.ausserhalb) return w.absage;
  if (!w.ok) {
    return absageBenennen(lage, w.geantwortet === true, w.fehler, {
      /* `leer` heißt: Das Inhaltsskript hat es versucht und ist dabei
         hängengeblieben. Der Code bleibt `snapshot_unavailable` — genau der
         Fall, für den spec-01 §3.8 den Bild-Notausgang nennt. */
      leer: ["snapshot_unavailable", "Das Inhaltsskript ist beim Erfassen dieser Seite nicht durchgekommen.",
        "Kurz warten und `readPage` noch einmal versuchen. Bleibt es dabei, ist `screenshot` mit `screenshotReason: \"empty_ax\"` der Notausgang.", true],
    }, {
      code: "snapshot_unavailable",
      satz: "Ich konnte die Seite gerade nicht lesen.",
      hinweis: "Kurz warten und noch einmal versuchen.",
    });
  }
  return gelungen(lage.id, lage.cmd, { snapshot: w.snapshot }, lage.meta({ truncation: w.snapshot.truncated }));
}

async function tuGetState(rahmen, lage) {
  const antwort = await anSeite(lage.tabId, { typ: "overlay:zustand" }, lage.seitenfrist(),
    { signal: lage.abbruch });
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      /* Die Seite hat geantwortet, aber ihr eigenes Ablesen ist gescheitert.
         Das als `tab_gone` zu melden, war eine Falschaussage: Wer antwortet,
         lebt. */
      leer: ["seitenskript_fehler", "Das Inhaltsskript kann den Zustand dieses Tabs gerade nicht ablesen.",
        "`readPage` versuchen — es geht einen anderen Weg durch dieselbe Seite.", true],
    }, {
      code: "tab_gone",
      satz: "Ich erreiche diesen Tab gerade nicht.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }
  const z = antwort.antwort;
  bildlaufMerken(lage.tabId, z.scrollY);
  return gelungen(lage.id, lage.cmd, {
    state: {
      url: lage.kopf.url,
      title: saeubern(lage.kopf.titel, 120),
      /* Ladezustand, Bildlaufstand, Größe — nichts vom Inhalt. Wer den Inhalt
         will, ruft `readPage` und geht dafür durch dieselbe Freigabe. */
      readyState: saeubern(z.readyState, 20),
      scrollY: Number(z.scrollY) || 0,
      scrollHeight: Number(z.scrollHeight) || 0,
      viewportHeight: Number(z.viewportHeight) || 0,
      atTop: !!z.atTop,
      atBottom: !!z.atBottom,
      epoch: saeubern(z.epoche, 24),
      elementCount: Number(z.elementCount) || 0,
      access: lage.sitzung.stufe,
      mode: lage.sitzung.modus,
      allow: Array.isArray(lage.sitzung.bereich) ? lage.sitzung.bereich.slice(0, 10) : [],
      secondsLeft: Math.max(0, Math.round((Number(lage.sitzung.endetUm) - Date.now()) / 1000)),
    },
  }, lage.meta());
}

/*
 * Bildlauf. Richtung und Weite stehen im Plan — geprüft, bevor der Mensch
 * gefragt wurde (befehle.js, `parameterPruefen`). Vorher stand hier
 * `String(rahmen.direction || "down")`: Jeder Aufruf ohne Richtung scrollte
 * nach unten und meldete Erfolg. Diese Zeile gibt es nicht mehr, und sie darf
 * in keiner Gestalt zurückkommen.
 */
async function tuScroll(rahmen, lage) {
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:scrollen",
      richtung: lage.plan.richtung,
      menge: lage.plan.menge,
      ref: lage.plan.ref,
      epoche: lage.epoche,
    },
    Math.max(1000, lage.restfrist() - 2000),
    { signal: lage.abbruch }
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      stale_ref: REF_ABSAGEN.stale_ref,
      /* Die Referenz war gültig, das Element ist aber aus der Seite
         verschwunden. Vorher fiel dieser Fall auf `tab_gone` — der Agent las,
         der Tab sei weg, obwohl die Seite geantwortet hatte. */
      element_not_found: ["element_not_found", "Das Element, zu dem ich scrollen sollte, gibt es auf der Seite nicht mehr.",
        "`readPage` aufrufen — oder mit `direction` scrollen statt zu einem Element.", true],
    }, {
      code: "tab_gone",
      satz: "Ich konnte auf dieser Seite nicht scrollen.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }
  const s = antwort.antwort;
  /* Der neue Stand entsteht aus dem alten und dem, was wirklich gerollt wurde.
     Ein Bildlauf, der nichts bewegt (schon ganz unten), lässt die Marke damit
     unverändert — und drei davon hintereinander sind genau die Schleife, die
     §5 meint. */
  bildlaufMerken(lage.tabId, (bildlaufStand.get(lage.tabId) || 0) + (Number(s.scrolledBy) || 0));

  /* Nach dem Bildlauf immer eine neue Wahrnehmung: Durch Nachladen entsteht in
     der Regel eine neue Epoche, und der Agent soll dafür keinen zweiten Umlauf
     brauchen (spec-01 §5.2). Kommt sie nicht zustande, ist das Scrollen
     trotzdem gelungen — dann geht die Antwort ohne Wahrnehmung raus. */
  const w = await wahrnehmenGesichert(lage);
  const daten = {
    scrolledBy: Number(s.scrolledBy) || 0,
    atTop: !!s.atTop,
    atBottom: !!s.atBottom,
  };
  if (w.ok) daten.snapshot = w.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta());
}

/*
 * Den Agentenzeiger ans Ziel setzen, bevor geklickt, getippt oder ausgewählt
 * wird. Steht NACH der Freigabe (die tu-Wege laufen nur nach dem Ja), also darf
 * er die Maus bewegen — ein abgelehnter Schritt tut es nie. So sieht der Mensch
 * bei JEDER Handlung, wohin gegriffen wird, nicht nur beim reinen Zeigen.
 * Beste-Kraft: Misslingt das Setzen, wird der eigentliche Schritt trotzdem
 * versucht — der Zeiger ist Anzeige, keine Bedingung.
 */
async function zeigerZeigen(lage) {
  const ziel = lage.ziel;
  if (!ziel || !ziel.mitte) return;
  await anSeite(
    lage.tabId,
    {
      typ: "overlay:zeiger",
      x: ziel.mitte.x,
      y: ziel.mitte.y,
      /* ANZEIGE, nicht Messung: Die Beschriftung steht neben dem Zeiger im
         Sichtfenster. Der ungekürzte Name ist der Messeingang und bleibt es
         (siehe `messeingang` und AUTOMODUS-2). */
      beschriftung: ziel.anzeigename,
      rect: ziel.rect,
    },
    Math.max(1000, lage.seitenfrist()),
    { signal: lage.abbruch }
  ).catch(() => {});
}

/*
 * Der Arbeitszeiger: eine sichtbare Bewegung für Schritte OHNE Ziel.
 *
 * Gemessen am 10.08.2026: Von den zehn Befehlen der Lesestufe bewegte genau
 * einer den Zeiger, nämlich `highlight` — und der auch nur, wenn der Agent die
 * Epoche der letzten Wahrnehmung mitschickte. Wer lesen, blättern oder warten
 * ließ, sah den grünen Rahmen und sonst nichts. Für einen Menschen ist „der
 * Rahmen steht, aber nichts bewegt sich" von „kaputt" nicht zu unterscheiden,
 * und genau so wurde es gemeldet.
 *
 * Die Oberfläche verspricht auf der Lesestufe wörtlich „lesen, blättern,
 * zeigen". Diese Funktion löst das ein: Sie schickt ein Muster an die Seite,
 * die daraus eine Bewegung im Sichtfenster zeichnet. Sie trägt keinerlei
 * Seiteninhalt und braucht keine Referenz, ist also auf jeder Stufe und in
 * jedem Zustand erlaubt.
 *
 * Beste-Kraft wie beim Zielzeiger: Misslingt es, läuft der Schritt trotzdem.
 */
const ARBEITSMUSTER = {
  readPage: "lesen",
  snapshot: "lesen",
  get_state: "prüfen",
  extract: "ablesen",
  scroll: "blättern",
  waitFor: "warten",
  screenshot: "aufnehmen",
  navigate: "wechseln",
  back: "zurück",
  /* Ein Ablauf bewegt den Zeiger auch selbst, denn seine Schritte gehen durch
     dieselbe Schleife. Diese Zeile ist trotzdem nötig: Zwischen dem Ja und dem
     ersten Schritt liegt das Nachschlagen des Ablaufs, und für den Menschen
     ist „der Rahmen steht, aber nichts bewegt sich" von „kaputt" nicht zu
     unterscheiden (Befund vom 10.08.2026). */
  run_workflow: "abspielen",
};

async function arbeitsZeigerFahren(tabId, cmd, frist, signal = null) {
  /* `eigen` und nicht `ARBEITSMUSTER[cmd]`: `cmd` kommt aus dem Rahmen des
     Relays, und über einem Objektliteral fände `toString` eine Funktion, die
     dann als „Muster" in eine fremde Seite ginge (H2 vom 14.08.2026). */
  const muster = eigen(ARBEITSMUSTER, cmd);
  if (typeof muster !== "string") return;
  await anSeite(tabId, { typ: "overlay:arbeitszeiger", muster }, Math.max(800, frist || 1500),
    { signal })
    .catch(() => {});
}

async function tuHighlight(rahmen, lage) {
  const ziel = lage.ziel; // vor der Freigabe nachgeschlagen, siehe unten
  const gesetzt = await anSeite(
    lage.tabId,
    {
      typ: "overlay:zeiger",
      x: ziel.mitte.x,
      y: ziel.mitte.y,
      /* ANZEIGE, nicht Messung: Die Beschriftung steht neben dem Zeiger im
         Sichtfenster. Der ungekürzte Name ist der Messeingang und bleibt es
         (siehe `messeingang` und AUTOMODUS-2). */
      beschriftung: ziel.anzeigename,
      rect: ziel.rect,
    },
    lage.seitenfrist(),
    { signal: lage.abbruch }
  );
  if (!gesetzt.ok) {
    return misslungen(lage.id, lage.cmd, "tab_gone",
      "Ich konnte den Zeiger auf dieser Seite nicht setzen.",
      { retryable: true, m: lage.meta() });
  }
  /* `highlight` ist der zweite Weg, der Seitentext ausliefert, ohne eine
     Wahrnehmung mitzuschicken (`shown.name` unten). Also auch hier die
     Einschleusungswache, über den UNGEKÜRZTEN Namen — siehe `tuExtract`. */
  await seitentextMessen(lage, [ziel.name, ziel.rolle]);
  return gelungen(lage.id, lage.cmd, {
    shown: { ref: ziel.ref, role: saeubern(ziel.rolle, 40), name: saeubern(ziel.name, GRENZEN.nameZeichen) },
  }, lage.meta());
}

/*
 * Klicken. Das Ziel steht in `lage.ziel` — vor der Freigabe nachgeschlagen,
 * damit der Mensch einem konkreten Element zugestimmt hat. Das Seitenskript
 * antwortet VOR dem Klick (overlay.js): Löst der Klick eine Navigation aus,
 * wäre die Antwort sonst verloren. Deshalb gilt: Antwort da = Klick ausgelöst,
 * und die neue Wahrnehmung danach ist Zugabe, keine Bedingung.
 */
async function tuClick(rahmen, lage) {
  const ziel = lage.ziel;
  await zeigerZeigen(lage);
  /* Nach dem `await` und vor dem nächsten Griff in die Seite: Genau in diesem
     Fenster lag der Befund B3 vom 14.08.2026. Die Seite antwortete auf
     `overlay:zeiger` nicht, der Not-Aus kam, der Agent bekam nach 0 ms
     `session_beendet` — und 16996 ms später ging `overlay:klicken` doch noch
     raus. */
  if (riegelZu(lage)) return riegelAbsage(lage);
  const antwort = await anSeite(
    lage.tabId,
    { typ: "overlay:klicken", ref: ziel.ref, epoche: lage.epoche },
    Math.max(1000, lage.restfrist() - 4000),
    { signal: lage.abbruch }
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      ...REF_ABSAGEN,
      element_not_visible: ["element_not_visible", "Das Element ist gerade nicht sichtbar.",
        "Erst `scroll`, dann noch einmal klicken.", true],
      ...KLICK_WACHE_ABSAGEN,
    }, {
      code: "tab_gone",
      satz: "Ich konnte auf dieser Seite nicht klicken.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }

  /* Nach dem Klick eine neue Wahrnehmung — die Seite hat sich vermutlich
     verändert. Nach einer Navigation ist das Inhaltsskript weg; dann geht die
     Antwort ohne Wahrnehmung raus, und der Agent ruft `readPage` selbst. */
  await schlafen(600, lage.abbruch);
  const daten = {
    clicked: { ref: ziel.ref, role: saeubern(ziel.rolle, 40), name: saeubern(ziel.name, GRENZEN.nameZeichen) },
  };
  /* Der Klick hat stattgefunden, also wird er gemeldet — aber die Wahrnehmung
     danach ist Zugabe und unterbleibt nach dem Not-Aus. Sie hier trotzdem zu
     holen hiesse, nach dem Kappen noch einmal die ganze Seite zu lesen. */
  if (riegelZu(lage)) return gelungen(lage.id, lage.cmd, daten, lage.meta());
  const w = await wahrnehmenGesichert(lage).catch(() => ({ ok: false }));
  if (w && w.ok) daten.snapshot = w.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta());
}

/* Tippen. Nie in Geheimfelder (overlay.js prüft dieselbe Liste, nach der es
   deren Inhalt nicht ausliest) — Anmelden bleibt Sache des Menschen.

   `absenden` (auf dem Draht `submit`) löst nach der Eingabe Enter im Feld aus.
   Es steht im Plan und damit auch in der Frage an den Menschen: Absenden ist
   der Schritt, der aus einer Eingabe eine Handlung macht — wer nur „tippen"
   bestätigt hat, hat nicht „abschicken" bestätigt. */
async function tuType(rahmen, lage) {
  const text = lage.plan.text;
  await zeigerZeigen(lage);
  if (riegelZu(lage)) return riegelAbsage(lage);
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:tippen",
      ref: lage.ziel.ref,
      epoche: lage.epoche,
      text,
      leeren: lage.plan.leeren,
      absenden: lage.plan.absenden,
    },
    Math.max(1000, lage.restfrist() - 4000),
    { signal: lage.abbruch }
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      ...REF_ABSAGEN,
      element_not_visible: ["element_not_visible", "Das Feld ist gerade nicht sichtbar.",
        "Erst `scroll`, dann noch einmal tippen.", true],
      ...wacheAbsagen(
        "Über dem Feld liegt ein anderes Element. Ich tippe nicht, denn die Eingabe ginge an dieses andere Element und nicht an das, was der Mensch freigegeben hat.",
        "Meist ist es eine Bannerleiste oder ein Zustimmungsfenster. Es zuerst schließen, dann `readPage` neu lesen und noch einmal tippen."
      ),
      feld_geheim: ["user_declined", "In Passwort- und Geheimfelder tippe ich nicht. Das übernimmt der Mensch selbst.",
        "Den Nutzer bitten, das Feld selbst auszufüllen.", false],
      /* Kein `retryable` mehr: Ein Element, das kein Eingabefeld ist, wird beim
         zweiten Versuch auch keins — dieselbe Begründung wie bei
         `kein_auswahlfeld` in `tuSelect`. */
      kein_eingabefeld: ["element_not_found", "Dieses Element ist kein Eingabefeld.",
        "`readPage` aufrufen und ein Feld mit Rolle textbox wählen.", false],
      eingabe_fehlgeschlagen: ["settle_timeout", "Die Eingabe ist auf dieser Seite nicht angekommen.",
        "Noch einmal versuchen oder den Nutzer bitten, das Feld selbst auszufüllen.", true],
    }, {
      code: "tab_gone",
      satz: "Ich konnte in dieses Feld nicht tippen.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }

  const w = await wahrnehmenGesichert(lage).catch(() => ({ ok: false }));
  /* Die Form stammt aus spec-01 §5.2 und ist genau die, die das Werkzeug auf
     der Agentenseite liest (`browser_tool.py::_erfolgstext`): `length` und
     `submitted` stehen NEBEN `typed`, nicht darin. Vorher lag `length` innen —
     der Agent bekam „? Zeichen eingegeben" zu lesen und wusste nie, ob seine
     Eingabe angekommen war.

     Nur die Länge, nie der Text: Sonst stünde das Eingetippte über den Umweg
     Werkzeugprotokoll doch wieder im Verlauf. */
  const daten = {
    typed: {
      ref: lage.ziel.ref,
      name: saeubern(lage.ziel.name, GRENZEN.nameZeichen),
    },
    length: Number(antwort.antwort.laenge) || text.length,
    submitted: antwort.antwort.abgesendet === true,
  };
  if (w && w.ok) daten.snapshot = w.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta());
}

/*
 * Auswählen. Der Mensch hat in der Frage gelesen, WAS gewählt wird (der Wert
 * kommt aus dem Rahmen des Agenten), und WORAN — der Name des Auswahlfelds
 * steht abgesetzt in `quelle`, weil er von der Seite stammt.
 */
async function tuSelect(rahmen, lage) {
  const plan = lage.plan;
  await zeigerZeigen(lage);
  if (riegelZu(lage)) return riegelAbsage(lage);
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:auswaehlen",
      ref: plan.ref,
      epoche: lage.epoche,
      wert: plan.wert,
      etikett: plan.etikett,
      index: plan.index,
    },
    Math.max(1000, lage.restfrist() - 4000),
    { signal: lage.abbruch }
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    /* „Noch einmal versuchen" (das letzte Feld je Zeile) steht nur da, wo ein
       zweiter Versuch hilft: Eine Option, die es nicht gibt, entsteht durch
       Wiederholen nicht — und ein Element, das kein Auswahlfeld ist, wird auch
       keins. */
    return absageDerSeite(lage, antwort, {
      ...REF_ABSAGEN,
      element_not_visible: ["element_not_visible", "Das Auswahlfeld ist gerade nicht sichtbar.",
        "Erst `scroll`, dann noch einmal auswählen.", true],
      ...wacheAbsagen(
        "Über dem Auswahlfeld liegt ein anderes Element. Ich wähle nichts aus, denn die Auswahl träfe dieses andere Element und nicht das, was der Mensch freigegeben hat.",
        "Meist ist es eine Bannerleiste oder ein Zustimmungsfenster. Es zuerst schließen, dann `readPage` neu lesen und noch einmal auswählen."
      ),
      kein_auswahlfeld: ["element_not_found", "Dieses Element ist kein Auswahlfeld.",
        "`readPage` aufrufen und ein Feld mit Rolle combobox oder listbox wählen.", false],
      /* Befund M1 vom 29.07.2026: Diese Zeile fehlte. overlay.js weist Geheim-
         und Zahlungsfelder (Ablaufmonat, Kartenart) ausdrücklich mit
         `feld_geheim` ab; ohne Eintrag griff der Vorgabezweig und meldete
         `tab_gone`, „Ich konnte auf dieser Seite nichts auswählen." und
         `retryable: true` — der Tab lebte, die Verweigerung war dauerhaft, und
         der Agent wurde zum Wiederholen eingeladen. `tuType` macht denselben
         Fall an derselben Stelle seit jeher richtig; hier steht jetzt dasselbe
         Wort mit demselben Code. */
      feld_geheim: ["user_declined", "In Passwort- und Geheimfeldern wähle ich nichts aus — Ablaufmonat und Kartenart gehören dazu. Das übernimmt der Mensch selbst.",
        "Den Nutzer bitten, die Auswahl selbst zu treffen.", false],
      /* Eigener Code aus spec-01 §5.2: Die Option gibt es nicht. Das ist eine
         Beobachtung über die Seite, kein Fehler des Rahmens — der Agent sieht
         in der neuen Wahrnehmung, welche Optionen es wirklich gibt. */
      auswahl_nicht_gefunden: ["option_not_found", "Diese Option gibt es in dem Auswahlfeld nicht.",
        "`readPage` aufrufen und aus den vorhandenen Optionen wählen.", false],
    }, {
      code: "tab_gone",
      satz: "Ich konnte auf dieser Seite nichts auswählen.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }

  const a = antwort.antwort;
  const w = await wahrnehmenGesichert(lage).catch(() => ({ ok: false }));
  const daten = {
    selected: {
      ref: plan.ref,
      role: saeubern(a.rolle, 40),
      name: saeubern(a.name, GRENZEN.nameZeichen),
      /* `gewaehlt` kommt von der Seite und wird wie jeder Seitentext gemessen,
         gekürzt und von Steuerzeichen befreit. */
      value: a.gewaehlt === null || a.gewaehlt === undefined ? null : saeubern(a.gewaehlt, GRENZEN.wertZeichen),
    },
  };
  if (w && w.ok) daten.snapshot = w.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta());
}

/*
 * Ablesen. `extract` ist die billige Schwester von `readPage`: Es liest aus
 * derselben Wahrnehmung, liefert aber nur die Zeilen, nach denen gefragt wurde.
 * Alles, was zurückkommt, ist Seitentext und geht deshalb durch dieselbe
 * Säuberung und dieselben Deckel wie der Textbaum.
 */
async function tuExtract(rahmen, lage) {
  const plan = lage.plan;
  /* Der einzige Weg, der Seitentext ausliefert, ohne durch `wahrnehmen` zu
     gehen — also braucht er die Wache selbst. Ohne sie läse `extract` die
     Zeilen der Seite, auf die der Tab nach der Freigabe gewechselt ist. */
  if (riegelZu(lage)) return riegelAbsage(lage);
  const wache = await wacheStellen(lage, lage.tabId, lage.sitzung, { wirte: lage.wirte });
  if (!wache.ok) return wache.absage;
  if (riegelZu(lage)) return riegelAbsage(lage);
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:auslesen",
      refs: plan.refs,
      region: plan.region,
      felder: plan.felder,
      epoche: lage.epoche,
    },
    Math.max(1000, lage.restfrist() - 2000),
    { signal: lage.abbruch }
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      stale_ref: ["stale_ref", "Diese Referenzen gehören zu einer älteren Wahrnehmung.",
        "`readPage` aufrufen und die neuen Referenzen verwenden.", true],
      element_not_found: ["element_not_found", "Diese Stelle gibt es auf der Seite nicht mehr.",
        "`readPage` aufrufen.", true],
      /* Befund M5 vom 29.07.2026: Beide Zeilen fehlten und fielen auf
         `snapshot_unavailable` mit „Kurz warten und noch einmal versuchen" —
         Warten hilft in keinem der beiden Fälle.

         `element_not_visible` ist der Alltagsfall: overlay.js bricht das GANZE
         Auslesen ab, sobald eine einzige der genannten Referenzen außerhalb des
         Sichtfelds liegt. Lücken auszuliefern wäre schlimmer, aber der Agent
         muss den nächsten Schritt erfahren, und der heißt `scroll`. */
      element_not_visible: ["element_not_visible", "Mindestens eine der genannten Stellen liegt außerhalb des sichtbaren Bereichs. Dann lese ich gar nichts ab — sonst bekämst du Lücken, die wie ein Ergebnis aussehen.",
        "Erst `scroll` zu der Stelle, dann noch einmal ablesen — oder weniger Referenzen auf einmal.", false],
      bereich_nicht_gefunden: ["region_not_found", "Diesen Bereich gibt es auf dieser Seite nicht.",
        "`readPage` aufrufen und einen Bereich daraus nehmen — zum Beispiel nav, main, header, footer oder form.", false],
      /* Kann nur ankommen, wenn Rahmen und Seite auseinanderlaufen:
         `parameterPruefen` lässt einen Aufruf ohne `refs` und ohne `region` gar
         nicht erst durch. Ein Satz steht hier trotzdem — ein Weg ohne Antwort
         ist auch dann einer, wenn er unerreichbar scheint. */
      nichts_angefragt: ["param_ungueltig", "Auf der Seite kam keine Angabe an, WAS abgelesen werden soll.",
        "`refs` (Liste von Referenzen) oder `region` (ein Bereich) mitsenden.", false],
    }, {
      code: "snapshot_unavailable",
      satz: "Ich konnte von dieser Seite nichts ablesen.",
      hinweis: "Kurz warten und noch einmal versuchen.",
    });
  }

  const treffer = Array.isArray(antwort.antwort.treffer) ? antwort.antwort.treffer : [];

  /*
   * Die Einschleusungswache, auch hier — und über die ROHEN Treffer.
   *
   * Dieselbe Fehlerklasse wie AUTOMODUS-2, nur in ihrer anderen Gestalt: nicht
   * „gekürzt gemessen", sondern „an dieser Aufrufstelle gar nicht gemessen".
   * `einschleusungMelden` hängt an `wahrnehmen`, und `extract` ist ausdrücklich
   * der eine Weg, der Seitentext ausliefert, OHNE durch die Wahrnehmung zu
   * gehen (siehe die Wache oben, Punkt 3). Damit ging ein „ignore previous
   * instructions" ungemessen an den Agenten, sobald er es gezielt abliest
   * statt die Seite zu lesen — und gezielt ablesen ist der billigere Weg, den
   * ein sparsamer Agent bevorzugt.
   *
   * Gemessen wird VOR den Deckeln dieser Funktion (`extraktRefs`,
   * `extraktZeichen`) und ohne `saeubern`: Der Deckel unten ist die Anzeige
   * für den Agenten, nicht der Messeingang.
   */
  await seitentextMessen(lage, treffer);

  const zeilen = [];
  let zeichen = 0;
  let ausgelassen = plan.ausgelassen || 0;

  for (const t of treffer) {
    /* Auch ein unbrauchbarer Eintrag wird gezählt: Ein Agent, der nicht weiß,
       dass er unvollständig sieht, behauptet Dinge über Teile, die er nie
       hatte (spec-01 §4.8, derselbe Grundsatz wie beim Textbaum). */
    if (!t || typeof t !== "object") {
      ausgelassen += 1;
      continue;
    }
    if (zeilen.length >= GRENZEN.extraktRefs || zeichen >= GRENZEN.extraktZeichen) {
      ausgelassen += 1;
      continue;
    }
    const name = saeubern(t.name, GRENZEN.nameZeichen);
    const wert = t.wert === null || t.wert === undefined ? null : saeubern(t.wert, GRENZEN.wertZeichen);
    zeichen += name.length + (wert ? wert.length : 0);
    zeilen.push({
      ref: refPruefen(t.ref),
      role: saeubern(t.rolle, 40),
      name,
      value: wert,
    });
  }

  if (!zeilen.length) {
    /* Eine leere Ernte ist kein Fehler der Erweiterung, sondern eine Aussage
       über die Seite: An der genannten Stelle stand nichts. */
    return misslungen(lage.id, lage.cmd, "nothing_extracted",
      "An dieser Stelle war nichts abzulesen.",
      { retryable: true, hint: "`readPage` aufrufen und sehen, welche Referenzen es wirklich gibt.", m: lage.meta() });
  }

  return gelungen(lage.id, lage.cmd, {
    rows: zeilen,
    rowCount: zeilen.length,
    truncated: ausgelassen > 0,
    omitted: ausgelassen,
  }, lage.meta());
}

/*
 * Warten. Die Erweiterung wartet, nicht der Agent — das spart eine ganze
 * Modellrunde je Sekunde Geduld.
 *
 * Läuft die Zeit ab, ohne dass die Bedingung eintritt, ist das `wait_timeout`
 * MIT Wahrnehmung (spec-01 §5.2): Der Agent muss sehen können, worauf er
 * vergeblich gewartet hat, sonst wartet er gleich noch einmal.
 */
async function tuWaitFor(rahmen, lage) {
  const plan = lage.plan;
  /* Der Plan kennt die Frist des Befehls; hier zählt, was nach der Rückfrage
     beim Menschen davon übrig ist. Ein Wecker, der nach der Antwort losgeht,
     ist kein Wecker. */
  const wartenMs = Math.max(500, Math.min(plan.wartenMs, lage.restfrist() - 3000));
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:warten",
      bedingung: plan.bedingung,
      wert: plan.wert,
      epoche: lage.epoche,
      fristMs: wartenMs,
    },
    wartenMs + 1500,
    { signal: lage.abbruch }
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      stale_ref: ["stale_ref", "Diese Referenz gehört zu einer älteren Wahrnehmung.",
        "`readPage` aufrufen und die neue Referenz verwenden.", true],
      element_not_found: ["element_not_found", "Das Element gibt es auf der Seite nicht mehr.",
        "`readPage` aufrufen.", true],
      /* Befund M4 vom 29.07.2026: Diese drei Zeilen fehlten und fielen auf
         `tab_gone` / „Ich konnte auf dieser Seite nicht warten." mit
         `retryable: true`.

         `ruhe_nicht_messbar` ist der praktische Fall: Ohne MutationObserver
         lässt sich Ruhe auf dieser Seite nicht messen — und wird es auch beim
         zehnten Versuch nicht. Der Agent hörte „der Tab ist weg, versuch es
         nochmal" und wartete in einer Schleife auf etwas, das nie messbar
         wird. */
      ruhe_nicht_messbar: ["idle_not_measurable", "Auf dieser Seite lässt sich Ruhe nicht messen — dem Browser fehlt dafür der Beobachter.",
        `Auf etwas Sichtbares warten statt auf Ruhe: ${WARTE_BEDINGUNGEN.filter((b) => b !== "idle").join(", ")}.`, false],
      unbekannte_bedingung: ["param_ungueltig", "Diese Wartebedingung kennt das Inhaltsskript nicht.",
        `Genau eine mitsenden: ${WARTE_BEDINGUNGEN.join(", ")}.`, false],
      wert_fehlt: ["param_ungueltig", "Zu dieser Wartebedingung kam auf der Seite kein Wert an.",
        "`textPresent` und `urlMatches` brauchen den Text, auf den gewartet wird.", false],
      leer: ["seitenskript_fehler", "Das Warten ist auf dieser Seite fehlgeschlagen.",
        "Mit `readPage` nachsehen, wie die Seite jetzt aussieht — oder auf eine andere Bedingung warten.", true],
      /* Der Not-Aus, gemeldet von der Warteschleife selbst (overlay.js, Befund
         M6 vom 14.08.2026). Das ist KEIN Ergebnis der Seite und keine
         verstrichene Frist: Die Sitzung ist zu Ende. Ohne eigene Zeile fiele
         es auf „Ich konnte auf dieser Seite nicht warten" mit
         `retryable: true` — und der Agent versuchte es in einer Sitzung noch
         einmal, die es nicht mehr gibt. */
      gestoppt: ["session_beendet", "Die Browsersitzung wurde beendet, während ich gewartet habe. Ich warte nicht weiter.",
        "Das ist kein Fehler der Seite. Der Nutzer hat die Sitzung beendet — für einen neuen Versuch braucht es eine neue Freigabe.", false],
    }, {
      code: "tab_gone",
      satz: "Ich konnte auf dieser Seite nicht warten.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }

  const erfuellt = antwort.antwort.erfuellt === true;
  const w = await wahrnehmenGesichert(lage).catch(() => ({ ok: false }));
  const daten = {
    satisfied: erfuellt,
    waitedMs: Number(antwort.antwort.wartezeitMs) || 0,
    condition: plan.bedingung,
  };
  if (w && w.ok) daten.snapshot = w.snapshot;

  if (!erfuellt) {
    return misslungen(lage.id, lage.cmd, "wait_timeout",
      "In der Wartezeit ist das nicht eingetreten.",
      {
        retryable: true,
        hint: "Die mitgelieferte Wahrnehmung zeigt, wie die Seite jetzt aussieht — vielleicht ist es eine andere Bedingung.",
        data: daten,
        m: lage.meta({ gedeckelt: plan.gedeckelt === true }),
      });
  }
  return gelungen(lage.id, lage.cmd, daten, lage.meta({ gedeckelt: plan.gedeckelt === true }));
}

/*
 * Das Bild. Der Notausgang, und deshalb an drei Stellen misstrauisch:
 *
 *  1. `captureVisibleTab` nimmt den SICHTBAREN Tab eines Fensters auf — nicht
 *     den Tab, den wir übergeben. Steht unser Tab im Hintergrund, fotografiert
 *     der Aufruf eine fremde Seite, die nie freigegeben wurde. Das ist keine
 *     Randfrage, sondern der kürzeste Weg an der Bereichsprüfung vorbei.
 *     Dieselbe Frage stellt sich für die Adresse: Der Bereich wurde vor der
 *     Freigabe gemessen, aufgenommen wird nach ihr. Beides prüft jetzt
 *     `wacheStellen`, unmittelbar vor jeder einzelnen Aufnahme — die Prüfung
 *     steht bewusst NICHT mehr einmalig am Kopf dieser Funktion, weil zwischen
 *     ihr und dem Auslöser sonst wieder eine Lücke läge.
 *  2. Ein Bild als Base64 sprengt den Rahmendeckel mühelos. Ein abgeschnittenes
 *     Bild ist aber kein Bild, sondern Datenmüll mit Erfolgsmeldung — also
 *     lieber eine ehrliche Absage.
 *  3. Ohne Wahrnehmung. Sie zusätzlich mitzuschicken verdoppelte die Nutzlast
 *     genau dort, wo sie ohnehin am größten ist; `readPage` steht dem Agenten
 *     einen Befehl später offen.
 */
async function tuScreenshot(rahmen, lage) {
  /*
   * Die Leiter (Befund M7 vom 29.07.2026). Vorher gab es genau eine Stufe:
   * Qualität 40, Deckel 90 KiB Base64 ≈ 67 KiB JPEG. Ein Ausschnitt von
   * 1920×1080 liegt typischerweise darüber, auf einem HiDPI-Schirm deutlich —
   * der Notausgang stand damit die meiste Zeit zu, und zwar mit einer
   * ehrlichen, aber ausweglosen Meldung.
   *
   * Jetzt wird dieselbe Ansicht bei Bedarf gröber noch einmal aufgenommen. Ein
   * Notausgang muss lesbar sein, nicht schön. Erst wenn auch die unterste Stufe
   * nicht passt, wird abgesagt — und die Absage sagt dann, was versucht wurde.
   *
   * Verkleinern statt gröber komprimieren wäre der stärkere Hebel, braucht im
   * Hintergrunddienst aber `OffscreenCanvas` und `createImageBitmap`; beides
   * ist hier ungeprüft, und ungeprüfter Code auf dem Notausgang ist kein
   * Notausgang. Die Leiter ist der Teil, der sich ohne Browser prüfen lässt.
   */
  const stufen = Array.isArray(GRENZEN.bildQualitaeten) && GRENZEN.bildQualitaeten.length
    ? GRENZEN.bildQualitaeten
    : [40];
  let b64 = "";
  let mime = "image/jpeg";
  let qualitaet = stufen[stufen.length - 1];

  for (const stufe of stufen) {
    /* IN der Schleife, nicht davor. Jede Runde ist eine eigene Aufnahme, und
       zwischen zwei Aufnahmen liegt eine ganze Bildkodierung — Zeit genug für
       eine Weiterleitung. Die Wache prüft hier zusätzlich den Vordergrund:
       `captureVisibleTab` nimmt den aktiven Tab des Fensters auf, nicht den,
       den wir übergeben. Steht inzwischen ein anderer vorn, wäre das Bild von
       einer nie freigegebenen Seite. */
    if (riegelZu(lage)) return riegelAbsage(lage);
    const wache = await wacheStellen(lage, lage.tabId, lage.sitzung, {
      vordergrund: true,
      wirte: lage.wirte,
    });
    if (!wache.ok) return wache.absage;
    const tab = wache.tab;

    let datenUrl = null;
    try {
      datenUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: stufe,
      });
    } catch (fehler) {
      return misslungen(lage.id, lage.cmd, "snapshot_unavailable",
        "Von dieser Seite kann ich kein Bild aufnehmen.",
        {
          retryable: true,
          hint: "`readPage` liefert dasselbe als Text — und liest sich für den Nutzer auch vor.",
          m: lage.meta(),
        });
    }

    const komma = typeof datenUrl === "string" ? datenUrl.indexOf(",") : -1;
    if (komma < 0 || !datenUrl.startsWith("data:image/")) {
      return misslungen(lage.id, lage.cmd, "snapshot_unavailable",
        "Die Aufnahme ist leer geblieben.",
        { retryable: true, hint: "Noch einmal versuchen oder `readPage` nehmen.", m: lage.meta() });
    }

    b64 = datenUrl.slice(komma + 1);
    mime = (/^data:([^;,]+)/.exec(datenUrl) || [])[1] || "image/jpeg";
    qualitaet = stufe;
    if (b64.length <= GRENZEN.bildZeichen) break;
  }

  const fuellzeichen = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;

  if (b64.length > GRENZEN.bildZeichen) {
    return misslungen(lage.id, lage.cmd, "screenshot_zu_gross",
      `Das Bild ist auch in der gröbsten Stufe (Qualität ${qualitaet}) zu groß für die Leitung. Ich habe es verworfen, statt dir die Hälfte zu schicken.`,
      {
        retryable: false,
        hint: "`readPage` nehmen — oder den Nutzer bitten, das Fenster kleiner zu machen; dann passt auch die Aufnahme.",
        m: lage.meta(),
      });
  }

  return gelungen(lage.id, lage.cmd, {
    image: {
      mime,
      /* Welche Stufe der Leiter es geworden ist. Ein Bild bei Qualität 10 ist
         etwas anderes als eines bei 40 — wer darauf etwas liest, soll wissen,
         wie grob es war. */
      quality: qualitaet,
      /* Breite und Höhe fehlen bewusst: Im Hintergrunddienst gibt es kein DOM,
         mit dem sie sich messen ließen, und eine geratene Zahl wäre schlimmer
         als keine. Die Byte-Zahl dagegen ist gerechnet — Base64 trägt vier
         Zeichen je drei Byte, die Füllzeichen am Ende zählen nicht mit. */
      bytes: Math.floor((b64.length * 3) / 4) - fuellzeichen,
      dataB64: b64,
    },
    reason: lage.plan.anlass,
  }, lage.meta());
}

/* --------------------------------------------------------------------- *
 * Das Miniaturbild einer Aufzeichnung (`rekorder:bild`, §7.2)
 *
 * `rekorder.js` nennt Name, Nummer, Anlass und Rechteck; die Aufnahme selbst
 * gehört hierher, weil hier die Leiter aus Befund M7 steht. Ein zweiter
 * Bildweg im Inhaltsskript wäre dieselbe Frage ein zweites Mal, nur ungeprüft.
 *
 * Diese Nachricht kommt aus einem TAB und ist damit die dritte, die das darf
 * (neben `notbremse` und `rekorder:stand`). Deshalb gilt hier dieselbe
 * Vorsicht wie bei `screenshot`, und aus demselben Grund:
 * `captureVisibleTab` nimmt den SICHTBAREN Tab eines Fensters auf, nicht den,
 * den jemand nennt. Ein Inhaltsskript im Hintergrund könnte sonst die Seite
 * fotografieren, die gerade vorn steht — der kürzeste Weg an jeder Freigabe
 * vorbei. Also: Der Tab muss der aufrufende sein, er muss vorn stehen, und
 * sein Ursprung darf nicht gesperrt sein.
 * --------------------------------------------------------------------- */

/* Ablage der Bilder einer laufenden Aufzeichnung. `local` und nicht `session`,
   weil eine Aufzeichnung über Seitenwechsel führt und das Inhaltsskript dabei
   stirbt — und weil `chrome.storage.session` für Inhaltsskripte ohne
   `setAccessLevel` verschlossen ist. */
export const REKORDER_BILD_ABLAGE = "sa_rekorder_bilder";

/* Ein Bildvorrat, der die Ablage sprengt, nimmt der Erweiterung ihre
   Einstellungen mit. Beide Deckel sind grosszügig gerechnet und gedeckelt
   wird ehrlich: Was nicht mehr passt, wird abgesagt, nicht halb gespeichert. */
const REKORDER_BILDER_HOECHSTENS = 60;
const REKORDER_BILDER_ZEICHEN = 4 * 1024 * 1024;

/*
 * Wie lange ein Bildvorrat höchstens stehenbleibt (Befund M3 vom 14.08.2026).
 *
 * Bis dahin wurde `sa_rekorder_bilder` ausschliesslich beim BROWSERSTART
 * weggeräumt. Zu jedem Klick- und Auswahlschritt liegt hier ein JPEG des
 * ganzen sichtbaren Tabs — bis zu 60 Stück und 4 MiB —, und wer den Browser
 * wochenlang offen lässt, trägt die Bilder jeder Aufzeichnung dieser Wochen
 * mit sich herum. Sie zeigen ganze Seiten, also Warenkörbe, Postfächer und
 * alles, was beim Aufzeichnen offen stand.
 *
 * Diese Frist ist die Bremse, die diese Datei allein setzen kann: Ein Vorrat,
 * den seit zwei Stunden niemand ergänzt hat, gehört zu einer Aufnahme, die
 * niemand mehr beendet. Die Aufnahme selbst hört woanders auf — der
 * Dienstarbeiter beantwortet `rekorder:stop`, und dort gehört
 * `rekorderBilderLeeren()` hin. Das ist gemeldet und steht nicht in diesem
 * Gebiet; bis dahin räumt wenigstens die Zeit auf.
 */
export const REKORDER_BILDER_FRIST_MS = 2 * 60 * 60 * 1000;

/* Der Name kommt aus dem Inhaltsskript und damit aus einer fremden Seite. Er
   wird Schlüssel in unserer Ablage, also wird er gemessen und nicht gesäubert:
   Ein Name, der das Muster nicht trifft, ist keiner. */
const REKORDER_BILDNAME = /^[a-z0-9][a-z0-9_.-]{0,39}$/i;

/**
 * Ein Miniaturbild für einen aufgezeichneten Schritt aufnehmen und ablegen.
 *
 * @param {number} tabId  der Tab, aus dem die Nachricht kam (von Chrome, nicht aus der Nutzlast)
 * @returns {Promise<{ok:boolean, name?:string, kennung?:string, klartext?:string}>} wirft nie
 */
export async function rekorderBild(tabId, angaben = {}) {
  const name = typeof angaben.name === "string" ? angaben.name.trim() : "";
  if (!REKORDER_BILDNAME.test(name)) {
    return { ok: false, kennung: "name_ungueltig", klartext: "Zu diesem Bild fehlt ein brauchbarer Name." };
  }
  if (!Number.isInteger(tabId)) {
    return { ok: false, kennung: "tab_unbekannt", klartext: "Zu diesem Bild fehlt der Tab." };
  }

  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_) {
    tab = null;
  }
  if (!tab || !tab.url) {
    return { ok: false, kennung: "tab_gone", klartext: "Den Tab gibt es nicht mehr." };
  }
  if (istGesperrterUrsprung(tab.url)) {
    return { ok: false, kennung: "ursprung_gesperrt", klartext: "Von dieser Seite nehme ich kein Bild auf." };
  }
  if (tab.active !== true) {
    /* Kein Fehler, sondern der Normalfall beim Tabwechsel: Der Schritt bleibt
       stehen, nur ohne Bild. Ein Bild vom falschen Tab wäre schlimmer als
       keines. */
    return { ok: false, kennung: "tab_im_hintergrund", klartext: "Der Tab steht nicht vorn, deshalb ohne Bild." };
  }

  /*
   * Wovon KEIN Bild gemacht wird (Befund TEACH-8 vom 14.08.2026).
   *
   * `captureVisibleTab` nimmt den GANZEN sichtbaren Tab auf. Gemessen an einem
   * echten Rekorderlauf auf einer 2FA-Seite: Der Klick auf den Hinweistext
   * ergab eine Bildanforderung genau in dem Augenblick, in dem der Einmalcode
   * auf dem Schirm stand. Geprüft wurden bis dahin Name, Tab, Ursprung, Grösse
   * und Anzahl — nie, WAS auf dem Bild ist. Das Bild liegt danach als rohes
   * JPEG in `chrome.storage.local`.
   *
   * Was diese Datei allein messen kann, misst sie jetzt: Adresse und Titel des
   * Tabs gehen durch denselben Klassifizierer wie jeder andere Schritt. Trägt
   * die Seite eine harte Klasse — `geheim` („Bestätigungscode eingeben"),
   * `zahlung` („/kasse/bezahlen"), `unwiderruflich`, `berechtigung`, `datei`,
   * `captcha` —, wird nicht fotografiert. Der Schritt bleibt stehen, nur ohne
   * Bild, genau wie beim Tab im Hintergrund.
   *
   * Das ist ausdrücklich NICHT die ganze Reparatur, und es soll auch nicht so
   * aussehen: Ein Code kann auf einer Seite stehen, deren Adresse und Titel
   * harmlos sind. Die vollständige Antwort wäre eine Auskunft der SEITE („hier
   * steht gerade ein Geheimfeld"), und die liegt in `content/rekorder.js` und
   * `background/worker.js` — gemeldeter Fremdbedarf. Diese Wache ist das Netz,
   * das ohne fremde Dateien gespannt werden kann, und sie fällt in die sichere
   * Richtung: lieber ein Bild zu wenig.
   */
  /* Gefragt wird mit `type` und nicht mit `screenshot`, und das ist Absicht:
     `type` ist der einzige Befehl, unter dem der Klassifizierer den Namen auch
     gegen `WORTE_GEHEIM` hält („Bestätigungscode eingeben", „Einmalcode"). Ein
     Bild von der ganzen Seite ist mindestens so heikel wie ein Tippen in
     dieses Feld — also wird hier die strengste Lesart genommen, die der
     Klassifizierer hergibt. */
  const seitenbefund = klassenBestimmen(
    "type",
    {},
    { name: messeingang(tab.title), rolle: "", marke: "", typ: "", formularGeheim: false },
    /* Die Adresse steht auch als ZIEL. Zwei Klassen — `unwiderruflich` und
       ein Teil von `zahlung` — hängen ausdrücklich am Ziel und nicht an der
       Herkunft, weil bei einem Ortswechsel die Adresse die Handlung ist. Für
       ein Bild gilt dasselbe: Die Seite, die fotografiert wird, IST der
       Gegenstand. `/konto/loeschen` wäre sonst gemessen worden, als stünde man
       nur zufällig dort. */
    { url: tab.url, titel: messeingang(tab.title), ziel: tab.url }
  );
  if (seitenbefund.hart) {
    return {
      ok: false,
      kennung: "seite_zu_heikel",
      klartext: "Auf dieser Seite nehme ich kein Bild auf, dafür steht dort zu viel.",
    };
  }

  const stufen = Array.isArray(GRENZEN.bildQualitaeten) && GRENZEN.bildQualitaeten.length
    ? GRENZEN.bildQualitaeten
    : [40];
  let b64 = "";
  let mime = "image/jpeg";
  let qualitaet = stufen[stufen.length - 1];

  for (const stufe of stufen) {
    let datenUrl = null;
    try {
      datenUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: stufe });
    } catch (_) {
      return { ok: false, kennung: "aufnahme_fehlgeschlagen", klartext: "Von dieser Seite kann ich kein Bild aufnehmen." };
    }
    const komma = typeof datenUrl === "string" ? datenUrl.indexOf(",") : -1;
    if (komma < 0 || !datenUrl.startsWith("data:image/")) {
      return { ok: false, kennung: "aufnahme_leer", klartext: "Die Aufnahme ist leer geblieben." };
    }
    b64 = datenUrl.slice(komma + 1);
    mime = (/^data:([^;,]+)/.exec(datenUrl) || [])[1] || "image/jpeg";
    qualitaet = stufe;
    if (b64.length <= GRENZEN.bildZeichen) break;
  }
  if (b64.length > GRENZEN.bildZeichen) {
    return { ok: false, kennung: "bild_zu_gross", klartext: "Das Bild ist auch in der gröbsten Stufe zu groß." };
  }

  let vorrat = {};
  try {
    const daten = await chrome.storage.local.get(REKORDER_BILD_ABLAGE);
    const roh = daten && daten[REKORDER_BILD_ABLAGE];
    if (roh && typeof roh.bilder === "object" && roh.bilder) vorrat = { ...roh.bilder };
  } catch (_) {
    vorrat = {};
  }

  /* Was zu einer längst vergessenen Aufnahme gehört, geht jetzt (M3). Der
     Deckel darunter zählt danach nur noch, was wirklich zu dieser Aufnahme
     gehört — sonst sagte eine Absage „genug Bilder gespeichert" über Bilder
     von vorgestern. */
  const alt = Date.now() - REKORDER_BILDER_FRIST_MS;
  for (const [schluessel, bild] of Object.entries(vorrat)) {
    const zeit = Number(bild && bild.zeit);
    if (!Number.isFinite(zeit) || zeit < alt) delete vorrat[schluessel];
  }

  const schonDa = Object.prototype.hasOwnProperty.call(vorrat, name);
  if (!schonDa && Object.keys(vorrat).length >= REKORDER_BILDER_HOECHSTENS) {
    return { ok: false, kennung: "zu_viele_bilder", klartext: "Für diese Aufzeichnung sind genug Bilder gespeichert." };
  }
  let umfang = b64.length;
  for (const [schluessel, bild] of Object.entries(vorrat)) {
    if (schluessel === name) continue;
    umfang += (bild && typeof bild.dataB64 === "string" ? bild.dataB64.length : 0);
  }
  if (umfang > REKORDER_BILDER_ZEICHEN) {
    return { ok: false, kennung: "vorrat_voll", klartext: "Die Bilder dieser Aufzeichnung füllen den Speicher." };
  }

  vorrat[name] = {
    mime,
    quality: qualitaet,
    /* Das Rechteck des Ziels kommt aus der Seite. Es sagt, WO auf dem Bild der
       Schritt stattfand; es ist eine Angabe über Geometrie, nie über Inhalt. */
    rect: rechteckSaeubern(angaben.rect),
    nr: Number.isFinite(Number(angaben.nr)) ? Math.max(0, Math.floor(Number(angaben.nr))) : 0,
    /* Der Anlass steht in der Aufzeichnung und wird gemessen, nicht geglaubt.
       Heute gibt es genau einen: Der Mensch hat aufgezeichnet. */
    anlass: angaben.anlass === "user_request" ? "user_request" : "unbekannt",
    zeit: Date.now(),
    dataB64: b64,
  };

  try {
    await chrome.storage.local.set({ [REKORDER_BILD_ABLAGE]: { version: 1, bilder: vorrat } });
  } catch (_) {
    return { ok: false, kennung: "ablage_fehler", klartext: "Das Bild liess sich nicht speichern." };
  }
  return { ok: true, name, quality: qualitaet };
}

function rechteckSaeubern(roh) {
  const zahl = (w) => {
    const n = Number(w);
    return Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.round(n))) : 0;
  };
  const r = roh && typeof roh === "object" ? roh : {};
  return { x: zahl(r.x), y: zahl(r.y), width: zahl(r.width), height: zahl(r.height) };
}

/** Die Bilder einer Aufzeichnung wegräumen. Wird mit `sa_rekorder` zusammen gerufen. */
export async function rekorderBilderLeeren() {
  try {
    await chrome.storage.local.remove(REKORDER_BILD_ABLAGE);
    return true;
  } catch (_) {
    return false;
  }
}

/* --------------------------------------------------------------------- *
 * Ortswechsel
 *
 * `navigate` und `back` haben denselben Nachlauf, und er ist der eigentliche
 * Inhalt beider Befehle: Nach einem Wechsel ist das Inhaltsskript WEG. Der
 * grüne Rahmen wäre verschwunden, und der Agent läse eine Seite, auf der der
 * Mensch nicht sieht, dass gelesen wird. Also: warten, bis der Tab fertig ist,
 * die neue Adresse gegen den Bereich prüfen, den Rahmen neu einspielen — und
 * erst dann wahrnehmen.
 * --------------------------------------------------------------------- */

/**
 * Warten, bis der Tab geladen hat — mit eigener Uhr statt blindem Schlafen.
 *
 * Ein festes `setTimeout(2000)` wäre auf einer schnellen Seite Verschwendung
 * und auf einer langsamen zu wenig; deshalb wird gefragt statt geschätzt.
 *
 * Trägt der Tab überhaupt kein `status`, gilt er als fertig, statt bis zur
 * Frist zu warten: Die verbindliche Bereitschaftsprüfung ist ohnehin der Ping
 * auf das Inhaltsskript (`overlaySicherstellen`), nicht dieses Feld. Und läuft
 * die Frist ab, während die Seite noch lädt, ist auch das kein Abbruch — die
 * Antwort geht mit `statusHint: "loading"` heraus, damit der Agent weiß, dass
 * er ein Zwischenbild sieht.
 */
async function tabFertigAbwarten(tabId, fristMs, signal = null) {
  const ende = Date.now() + Math.max(500, fristMs);
  for (;;) {
    /* Diese Schleife kann Sekunden dauern. Ohne den Riegel liefe sie nach dem
       Not-Aus weiter und hielte den Dienstarbeiter am Leben (B3/B4 vom
       14.08.2026). */
    if (signal && signal.aborted === true) return { ok: false, fehler: "abgebrochen" };
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      return { ok: false, fehler: "tab_gone" };
    }
    if (!tab) return { ok: false, fehler: "tab_gone" };
    if (tab.status === undefined || tab.status === "complete") return { ok: true, tab };
    if (Date.now() >= ende) return { ok: false, fehler: "frist", tab };
    await schlafen(150, signal);
  }
}

/**
 * Schaltet den grünen Rahmen an, wenn das Inhaltsskript gerade neu eingespielt
 * wurde. Ein frisch eingespieltes Overlay startet unsichtbar (opacity 0), erst
 * `overlay:an` setzt `data-an` und damit die Deckkraft.
 *
 * Diese Funktion gibt es, weil es die Stelle ZWEIMAL braucht und sie beim
 * ersten Mal nur an einer von beiden stand: Schritt 7 der Befehlsschleife hatte
 * sie, der gemeinsame Nachlauf von `navigate` und `back` nicht. Ein Agent, der
 * einmal selbst navigierte, arbeitete danach für den Rest der Sitzung ohne
 * Rahmen, ohne Schild und ohne Titel-Präfix — denn beim nächsten Befehl meldet
 * `overlaySicherstellen` `schonDa: true` und der Zweig greift nie mehr. Genau
 * die Regression „nichts passiert sichtbar", die für behoben erklärt war, stand
 * über den Ortswechsel wieder offen. Zwei Aufrufer, eine Quelle: so können die
 * beiden Stellen nicht erneut auseinanderlaufen.
 */
async function rahmenWiederAnschalten(tabId, overlay, signal = null) {
  if (!overlay || overlay.schonDa) return;
  /* Ein frisch eingespieltes Inhaltsskript weiss nichts von einem Modus. Was
     wir ihm zuletzt gesagt haben, ist mit der alten Seite gestorben — also
     vergessen wir es auch, sonst bliebe der Rahmen der neuen Seite farblos. */
  gezeigterModus.delete(tabId);
  const gross = await grosseSichtLesen();
  await anSeite(tabId, {
    typ: "overlay:an",
    gross,
    text: "SMarTrAgent steuert diesen Tab, Esc Esc = Stopp",
  }, 2000, { signal }).catch(() => {});
}

/**
 * Der gemeinsame Nachlauf von `navigate` und `back`.
 *
 * @returns {{ok:true, kopf:object, snapshot:object|null, fertig:boolean}
 *          |{ok:false, code:string, satz:string, hinweis:string|null, retryable:boolean}}
 */
async function nachDemWechsel(lage, fristMs) {
  const fertig = await tabFertigAbwarten(lage.tabId, fristMs, lage.abbruch);
  if (riegelZu(lage)) {
    return { ok: false, code: "session_beendet", satz: "Die Browsersitzung wurde während des Wechsels beendet.", hinweis: null, retryable: false };
  }
  if (!fertig.ok && fertig.fehler === "tab_gone") {
    return { ok: false, code: "tab_gone", satz: "Der Tab ist beim Wechsel verschwunden.", hinweis: null, retryable: false };
  }

  const adresse = await tabAdresse(lage.tabId);
  if (!adresse) {
    return { ok: false, code: "tab_gone", satz: "Der Tab ist beim Wechsel verschwunden.", hinweis: null, retryable: false };
  }

  /* Die Adresse NACH dem Wechsel. Eine Weiterleitung kann aus einer
     freigegebenen Adresse eine fremde machen — geprüft wird deshalb, wo der Tab
     wirklich steht, nicht wohin er sollte.

     Abweichung von spec-01 §5.2, bewusst: Dort steht, der Tab werde in diesem
     Fall auf `about:blank` gesetzt. Das zerstört dem Menschen seinen Tab, ohne
     ihn zu fragen — der Schutz besteht aber darin, NICHT ZU LESEN, nicht darin,
     etwas kaputtzumachen. Die Seite bleibt stehen, der Agent bekommt eine
     Absage, und jeder folgende Befehl scheitert ohnehin an derselben Prüfung
     (Schritt 6 der Schleife). */
  if (!bereichPasst(adresse, lage.sitzung)) {
    protokoll("Der Tab steht nach dem Wechsel außerhalb der Freigabe, ich lese hier nicht.", {
      cmd: lage.cmd,
      ergebnis: "scope_violation_local",
    });
    return {
      ok: false,
      code: "scope_violation_local",
      satz: "Nach dem Wechsel steht dieser Tab auf einer Seite, die nicht freigegeben ist. Ich lese sie nicht.",
      hinweis: "Den Nutzer bitten, zurückzuwechseln oder eine neue Freigabe zu erteilen.",
      retryable: false,
    };
  }

  /* Und die Sperrliste, ein zweites Mal (Befund vom 14.08.2026, B2).
     Bis dahin prüfte dieser Nachlauf ausschliesslich `bereichPasst` — der
     Bereich ist die Freigabe des Menschen für die SITZUNG, die Sperrliste ist
     seine dauerhafte Ansage „hier nicht". Eine Weiterleitung konnte damit aus
     einem freigegebenen Wirt einen gesperrten machen, und danach wurde dort
     der Rahmen aufgebaut und die Seite wahrgenommen. Gefragt hatte niemand:
     Vor dem Wechsel stand der Tab noch woanders.

     Was der Mensch für DIESEN Schritt freigegeben hat, steht in `lage.wirte`
     und gilt weiter. Alles andere ist eine Überraschung, und Überraschungen
     werden hier nicht gelesen. */
  if (await wirtGesperrt(adresse, lage.wirte)) {
    protokoll("Der Tab steht nach dem Wechsel auf einem gesperrten Wirt, ich lese hier nicht.", {
      cmd: lage.cmd,
      ergebnis: "guardrail_blocked",
    });
    return {
      ok: false,
      code: "guardrail_blocked",
      satz: WACHE_GESPERRT,
      hinweis: "Den Nutzer bitten, den Tab zurückzubringen — oder diesen Wirt in den Einstellungen von der Sperrliste zu nehmen.",
      retryable: false,
    };
  }

  /*
   * Und die harten Klassen der NEUEN Adresse (Befund AUTOMODUS-6 vom
   * 14.08.2026).
   *
   * Bis hierher prüfte dieser Nachlauf Bereich und Sperrliste — beides sind
   * Aussagen darüber, WO gearbeitet werden darf, keine darüber, WAS dort
   * steht. Gemessen: `navigate` auf `https://shop.de/angebot/1` mit
   * Weiterleitung auf `https://shop.de/kasse/bezahlen?jetzt=1` endete im
   * Modus `auto` mit `fragen=0`, `erfolg=true` und lieferte die vollständige
   * Wahrnehmung der Kassenseite an den Agenten. Der Vertrag begründet die
   * Klasse `zahlung` ausdrücklich damit, dass auf einer Kassenseite auch das
   * LESEN eine Rückfrage wert ist, weil dort der Warenkorb eines Menschen
   * steht.
   *
   * Verglichen wird gegen das, worüber in diesem Schritt schon entschieden
   * wurde (`lage.klassen`): Bei `navigate` auf eine Kassenadresse hat der
   * Mensch die Klasse `zahlung` bereits gehört und Ja gesagt — dann ist sie
   * hier keine Überraschung mehr. Eine harte Klasse, die ERST durch die
   * Weiterleitung entsteht, ist eine, und Überraschungen werden hier nicht
   * gelesen. Dieselbe Trennung wie beim gesperrten Wirt eine Ebene höher:
   * gefragt = erlaubt, überraschend = nicht.
   *
   * Angehalten wird das Lesen, nicht die Seite. Der Tab bleibt stehen, wo er
   * steht — der Schutz besteht darin, NICHT ZU LESEN, nicht darin, dem
   * Menschen seinen Tab kaputtzumachen (dieselbe Abweichung von spec-01 §5.2
   * wie beim Bereich darüber).
   */
  const neueKlassen = klassenBestimmen(lage.cmd, {}, null, {
    url: adresse,
    titel: "",
    /* Die neue Adresse steht auch als ZIEL: Nach einer Weiterleitung ist sie
       das, worauf dieser Schritt gebracht hat, und nur so werden die Klassen
       gemessen, die ausdrücklich am Ziel hängen (`unwiderruflich`). */
    ziel: adresse,
  });
  const schonEntschieden = new Set(Array.isArray(lage.klassen) ? lage.klassen : []);
  const ueberraschung = neueKlassen.klassen.filter((k) => HART.has(k) && !schonEntschieden.has(k));
  if (ueberraschung.length) {
    protokoll("Nach dem Wechsel steht hier etwas, wofür niemand gefragt wurde. Ich lese es nicht.", {
      cmd: lage.cmd,
      ergebnis: "guardrail_blocked",
    });
    return {
      ok: false,
      code: "guardrail_blocked",
      /* Der Satz nennt die KLASSE und nicht die Adresse — die Klasse ist unser
         eigenes Wort, die Adresse wäre die Auskunft darüber, wo der Mensch
         gerade steht (siehe `WACHE_ABGEWANDERT`). */
      satz: "Dieser Wechsel ist woanders gelandet als angekündigt, und dort steht etwas, wofür in diesem Schritt niemand gefragt wurde. Ich lese die neue Seite nicht.",
      hinweis: "Die Adresse selbst mit `navigate` aufrufen, dann wird über sie entschieden, bevor sie gelesen wird.",
      retryable: false,
    };
  }

  /*
   * Und die Agentenmatrix für den Wirt, auf dem der Tab WIRKLICH steht
   * (Befund AUTOMODUS-8 vom 15.08.2026).
   *
   * Die Vorprüfung (Schritt 9c der Schleife) misst Herkunft und ANGEKÜNDIGTES
   * Ziel — eine Weiterleitung kann daraus einen Wirt machen, für den die
   * Matrix diesem Agenten nichts erlaubt. Gemessen: Sitzung im Modus
   * `domains` mit zwei freigegebenen Wirten, Matrix erlaubt dem Agenten nur
   * den ersten; `navigate` auf den ersten mit Weiterleitung auf den zweiten
   * lieferte dessen vollen Snapshot, obwohl `agentDarf` dort für jede Klasse
   * false sagt. Der Bereich ist die Freigabe des MENSCHEN für die Sitzung —
   * die Matrix ist seine Ansage, was DIESER Agent wo darf, und die gilt auch
   * hinter einer Weiterleitung. AUTOMODUS-6 hat die harten Klassen
   * nachgezogen, die Matrix blieb stehen.
   *
   * Gemessen werden die Klassen, über die in diesem Schritt entschieden wurde
   * (`lage.klassen`), UND die der neuen Adresse: Der Snapshot am Ende ist
   * eine Wahrnehmung des neuen Wirts. Fällt die Prüfung, geht KEIN
   * Seiteninhalt in die Antwort — und die Absage nennt die Adresse nicht
   * (dieselbe Zusage wie bei `WACHE_ABGEWANDERT`: Wer sagt, WO der Tab jetzt
   * steht, ist selbst das Leck).
   */
  if (lage.agent) {
    const zuPruefen = new Set([
      ...(Array.isArray(lage.klassen) ? lage.klassen : []),
      ...neueKlassen.klassen,
    ]);
    for (const klasse of zuPruefen) {
      let erlaubt = false;
      try {
        erlaubt = (await agentDarf(lage.agent, adresse, klasse)) === true;
      } catch (_) {
        /* Eine Matrix, die sich nicht lesen lässt, erteilt keine Erlaubnis —
           dieselbe strengere Richtung wie in `wirtGesperrt`. */
        erlaubt = false;
      }
      if (erlaubt) continue;
      protokoll("Der Tab steht nach dem Wechsel auf einem Wirt, der für diesen Agenten nicht freigeschaltet ist. Ich lese hier nicht.", {
        cmd: lage.cmd,
        ergebnis: "agent_not_permitted",
      });
      return {
        ok: false,
        code: "agent_not_permitted",
        satz: `Dieser Wechsel ist woanders gelandet als angekündigt, und dort ist für ${saeubern(lage.agent, 40)} nicht freigeschaltet, was dieser Schritt tut. Ich lese die neue Seite nicht.`,
        hinweis: "Den Nutzer bitten, das in den Einstellungen der Erweiterung für diesen Agenten und diese Seite freizuschalten.",
        retryable: false,
      };
    }
  }

  const overlay = await overlaySicherstellen(lage.tabId, { signal: lage.abbruch });
  if (!overlay.ok) {
    return {
      ok: false,
      code: "snapshot_unavailable",
      satz: overlay.fehler === "ursprung_gesperrt"
        ? "Auf dieser Seite arbeite ich grundsätzlich nicht."
        : "Ich kann auf der neuen Seite den grünen Rahmen nicht anzeigen. Ohne ihn arbeite ich nicht.",
      hinweis: "Den Nutzer bitten, eine gewöhnliche Webseite zu öffnen.",
      retryable: overlay.fehler !== "ursprung_gesperrt",
    };
  }

  /* Vor der Wahrnehmung, nicht danach: schon der erste Blick auf die neue Seite
     soll unter sichtbarem Rahmen geschehen. */
  await rahmenWiederAnschalten(lage.tabId, overlay, lage.abbruch);

  const kopf = { url: adresse, titel: await tabTitel(lage.tabId) };
  const w = await wahrnehmen(lage.tabId, kopf, lage.seitenfrist(), false, lage).catch(() => ({ ok: false }));
  /* Nach einem Ortswechsel steht die Seite oben. Das ist keine Annahme,
     sondern die Zusage des Browsers, und ohne sie behielte die Schleifenmarke
     den Stand der VORIGEN Seite. */
  bildlaufMerken(lage.tabId, 0);
  return { ok: true, kopf, snapshot: w && w.ok ? w.snapshot : null, fertig: fertig.ok };
}

function wechselAbsage(lage, nachlauf) {
  return misslungen(lage.id, lage.cmd, nachlauf.code, nachlauf.satz, {
    retryable: nachlauf.retryable === true,
    hint: nachlauf.hinweis,
    m: lage.meta(),
  });
}

async function tuNavigate(rahmen, lage) {
  const plan = lage.plan;
  /* `tabs.update` ist eine eigene Tür in die Seite, an `anSeite` vorbei.
     Befund B4 vom 14.08.2026: Der Arbeitszeiger stand ausserhalb des Rennens,
     und in diesem Fenster lief der Ortswechsel nach dem Not-Aus trotzdem —
     gemessen wurde ein `tabs.update`, das NACH dem Kappen ausgeführt wurde. */
  if (riegelZu(lage)) return riegelAbsage(lage);
  try {
    await chrome.tabs.update(lage.tabId, { url: plan.url });
  } catch (fehler) {
    return misslungen(lage.id, lage.cmd, "navigation_failed",
      "Diese Adresse ließ sich nicht aufrufen.",
      { retryable: true, hint: "Adresse prüfen oder den Nutzer bitten, die Seite selbst zu öffnen.", m: lage.meta() });
  }

  const nachlauf = await nachDemWechsel(lage, Math.max(1000, lage.restfrist() - 6000));
  if (!nachlauf.ok) return wechselAbsage(lage, nachlauf);

  const daten = {
    url: nachlauf.kopf.url,
    title: saeubern(nachlauf.kopf.titel, 120),
    /* Weitergeleitet heißt: ein anderer HOST. Ein angehängter Schrägstrich ist
       keine Weiterleitung, und ein Agent, dem man das als eine verkauft, sucht
       den Fehler an der falschen Stelle. */
    redirected: hostAus(nachlauf.kopf.url) !== plan.host,
    statusHint: nachlauf.fertig ? "complete" : "loading",
  };
  if (nachlauf.snapshot) daten.snapshot = nachlauf.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta({ settled: nachlauf.fertig }));
}

async function tuBack(rahmen, lage) {
  if (riegelZu(lage)) return riegelAbsage(lage);
  try {
    await chrome.tabs.goBack(lage.tabId);
  } catch (fehler) {
    /* Chrome lehnt hier zwei sehr verschiedene Dinge mit einem Wurf ab. Welches
       von beiden es war, lässt sich billig nachsehen — und der Unterschied ist
       für den Agenten der zwischen „anders planen" und „aufhören". */
    const daNoch = await tabAdresse(lage.tabId);
    if (!daNoch) {
      return misslungen(lage.id, lage.cmd, "tab_gone",
        "Der Tab, den ich steuern durfte, ist nicht mehr da.", { m: lage.meta() });
    }
    return misslungen(lage.id, lage.cmd, "no_history",
      "Hier gibt es keine Seite zurück — dieser Tab hat keine Vorgeschichte.",
      {
        retryable: false,
        hint: "Das ist kein Fehler. Mit `navigate` ein Ziel nennen oder den Nutzer fragen, wohin es gehen soll.",
        m: lage.meta(),
      });
  }

  const nachlauf = await nachDemWechsel(lage, Math.max(1000, lage.restfrist() - 5000));
  if (!nachlauf.ok) return wechselAbsage(lage, nachlauf);

  const daten = {
    url: nachlauf.kopf.url,
    title: saeubern(nachlauf.kopf.titel, 120),
    statusHint: nachlauf.fertig ? "complete" : "loading",
  };
  if (nachlauf.snapshot) daten.snapshot = nachlauf.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta({ settled: nachlauf.fertig }));
}

/* --------------------------------------------------------------------- *
 * Der gespeicherte Ablauf (§7.3, §8.2)
 *
 * Die eine Zusage, aus der dieser ganze Abschnitt folgt:
 *
 *   **Ein Ablauf ist eine Reihe von Befehlen, keine zweite Tür.**
 *
 * Jeder einzelne Schritt geht durch `einzeln` — also durch Positivliste,
 * Stufe, Bereich, Parameterprüfung, Klassifizierer, Modus, Guardrails,
 * Verdeckungswache und Protokollbuch. Es gibt hier keinen Aufruf an die Seite,
 * der an dieser Schleife vorbeigeht, und es darf keinen geben: Ein zweiter
 * Ausführungspfad wäre genau die Stelle, an der die Prüfungen des ersten
 * niemandem mehr nützen. Ein Prüfsatz misst das an der härtesten Stelle, die
 * es dafür gibt — ein Workflow-Schritt mit harter Klasse löst auch in der
 * Automatik eine Rückfrage aus.
 *
 * Was ein Ablauf NICHT mitbringt, ist eine Referenz. Er trägt eine Kaskade von
 * Ankern (§7.1), und die muss auf der Seite erst zu einem Element werden.
 * Diese Auflösung ist der einzige neue Weg zur Seite, den dieser Abschnitt
 * braucht, und sie verändert nichts: Sie schlägt nach.
 * --------------------------------------------------------------------- */

/* Welcher Befehl aus welchem Schritttyp wird. Die Tabelle ist geschlossen —
   ein Typ ohne Eintrag wird benannt abgelehnt und nicht auf gut Glück auf
   etwas Ähnliches abgebildet. Ein Doppelklick, der als einfacher Klick
   ausgeführt wird, ist ein Schritt, dem der Mensch nie zugestimmt hat. */
const SCHRITT_BEFEHL = Object.freeze({
  navigate: "navigate",
  click: "click",
  input: "type",
  select: "select",
  scroll: "scroll",
  wait: "waitFor",
});

/* Wie ein Schritt in einem Satz heisst, den der Mensch vorgelesen bekommt.
   Er steht im `reason` des Schrittes und damit in der Freigabefrage. */
const SCHRITT_TEXT = Object.freeze({
  navigate: "eine Adresse aufrufen",
  click: "klicken",
  dblclick: "doppelt klicken",
  input: "in ein Feld tippen",
  select: "eine Auswahl treffen",
  scroll: "auf der Seite rollen",
  key: "eine Taste drücken",
  wait: "warten",
  user_input_required: "auf den Menschen warten",
});

/* --------------------------------------------------------------------- *
 * Die Vorklassifizierung eines Ablaufs (Befund BRUECKE-2, 14.08.2026)
 *
 * Der Befund, in einem Satz: **Ein Ablauf liess sich im Hintergrund baulich
 * nie abspielen.**
 *
 * Gemessen: gespeicherter Ablauf `wf_kasse`, Modus `auto`, Seitenleiste zu,
 * `run_workflow` über den Draht → sofort `grant_required` („Es war kein
 * Fenster offen …"), null Schritte ausgeführt. Mit offener, zustimmender
 * Seitenleiste lief derselbe Ablauf durch. Ursache: `run_workflow` trägt in
 * `befehle.js` absichtlich KEINE Grundklasse, und `freigabeNoetig` fragt bei
 * einem Schritt ohne bekannte Klasse in JEDEM Modus („Ein neuer Befehl, der
 * still durchläuft, wäre genau die Lücke, die niemand bemerkt"). Damit war
 * die Hintergrundbedienung, die der Vertrag zusagt, in keiner Einstellung
 * erreichbar.
 *
 * Die Entscheidung des Inhabers vom 14.08.2026 löst das auf, ohne die Regel
 * aufzuweichen, aus der sie folgte:
 *
 *   **Der Ablauf wird VOR dem ersten Schritt vorklassifiziert.** Jeder Schritt
 *   geht durch denselben Klassifizierer, soweit er ohne die Seite messbar ist
 *   — Schritttyp, Zieladresse und die aufgezeichnete Beschreibung samt
 *   Textankern. Die VEREINIGUNG dieser Klassen ist die Klasse des
 *   `run_workflow`. Ein Ablauf aus lauter weichen Schritten läuft im Modus
 *   `auto` damit ohne eine einzige Rückfrage; ein Ablauf, in dem irgendwo
 *   „Zur Kasse" steht, fragt — und zwar EINMAL, vorher, statt mittendrin.
 *
 * Drei Dinge, die diese Funktion ausdrücklich NICHT ist:
 *
 *  1. **Kein Freibrief.** Sie ist eine UNTERGRENZE. Jeder Schritt geht bei der
 *     Ausführung trotzdem durch den vollen Klassifizierer in `einzeln` — mit
 *     dem echten Elementnamen, den die Seite dann wirklich nennt. Ein Schritt,
 *     der sich als härter herausstellt als vorhergesagt, fragt dann eben doch.
 *     Sie kann Rückfragen nur HINZUFÜGEN, nie eine wegnehmen.
 *  2. **Keine Messung an der Seite.** Was hier gemessen wird, steht in der
 *     gespeicherten Datei. Der Elementname kommt erst bei der Auflösung der
 *     Kaskade dazu, und der ist der eigentliche Messeingang.
 *  3. **Keine Abkürzung um die Agentenmatrix.** Im Gegenteil: Weil die Klassen
 *     jetzt schon vor dem ersten Schritt feststehen, wird die Matrix für sie
 *     ALLE gefragt, bevor irgendetwas geschieht (Schritt 9c).
 * --------------------------------------------------------------------- */

/**
 * Was ein einzelner Ablaufschritt an Klassen trägt, ohne die Seite zu fragen.
 *
 * @returns {object|null} Befund aus `klassenBestimmen`, oder null bei einem
 *          Schritttyp, den diese Fassung nicht abspielt (dann scheitert der
 *          Schritt später an `schrittRahmenBauen`, und bis dahin trägt er
 *          keine Klasse bei — sein Beitrag zur Untergrenze ist „unbekannt",
 *          und `freigabeNoetig` fragt bei „unbekannt" ohnehin).
 */
function schrittVorbefund(schritt, adresse) {
  const cmd = eigen(SCHRITT_BEFEHL, schritt && schritt.type);
  if (typeof cmd !== "string") return null;

  /* Alles, was beim Aufzeichnen über das Ziel festgehalten wurde, geht als
     Name in die Messung: die Beschreibung, die Textanker der Kaskade und bei
     `select` das Etikett der Option. Das ist derselbe Text, gegen den auch
     die Identitätswache hält — und er ist das Einzige, was hier über das Ziel
     bekannt ist. UNGEKÜRZT, wie jeder Messeingang (AUTOMODUS-2). */
  const teile = [messeingang(schritt.beschreibung)];
  if (Array.isArray(schritt.selector_cascade)) {
    for (const anker of schritt.selector_cascade) {
      if (typeof anker === "string" && anker.startsWith("text=")) teile.push(anker.slice(5));
    }
  }
  if (schritt.label !== undefined) teile.push(messeingang(schritt.label));

  const ziel = {
    name: teile.filter(Boolean).join(" "),
    rolle: "",
    /* Marke, Feldtyp und Geheimformular sind Bauform und stehen erst auf der
       Seite fest. Sie fehlen hier — und ihr Fehlen macht den Befund milder,
       nie strenger. Genau deshalb ist das hier eine Untergrenze. */
    marke: "",
    typ: "",
    formularGeheim: false,
  };

  const plan = {};
  if (schritt.type === "input" && schritt.submit === true) plan.absenden = true;

  return klassenBestimmen(cmd, plan, ziel, {
    url: adresse,
    titel: "",
    /* Die Zieladresse eines aufgezeichneten Ortswechsels ist ohne die Seite
       messbar und gehört deshalb hierher (dieselbe Begründung wie bei B1:
       Bei einem Ortswechsel IST die Adresse die Handlung). */
    ziel: schritt.type === "navigate" ? schritt.url : null,
  });
}

/**
 * Den Befund des `run_workflow` um die Klassen seiner Schritte erweitern.
 *
 * Für jeden anderen Befehl gibt sie den Befund unverändert zurück — es gibt
 * hier keinen Weg, der einem Einzelbefehl etwas wegnimmt oder hinzufügt.
 */
function ablaufBefund(cmd, eigenerBefund, plan, adresse) {
  if (cmd !== "run_workflow") return eigenerBefund;
  const schritte = plan && plan.workflow && Array.isArray(plan.workflow.steps)
    ? plan.workflow.steps
    : [];

  const alle = new Set(eigenerBefund.klassen);
  let unvollstaendig = eigenerBefund.unvollstaendig === true;
  const gruende = [];
  for (const schritt of schritte) {
    const b = schrittVorbefund(schritt, adresse);
    if (!b) continue;
    for (const k of b.klassen) alle.add(k);
    if (b.unvollstaendig === true) unvollstaendig = true;
    if (b.hart) gruende.push(b.grund);
  }

  const klassen = KLASSEN.filter((k) => alle.has(k));
  return {
    klassen,
    hart: klassen.find((k) => HART.has(k)) || null,
    weich: klassen.filter((k) => WEICH.has(k)),
    /* Der Grund nennt weiterhin ausschliesslich UNSERE Wörter aus den Listen,
       nie den aufgezeichneten Fremdtext, in dem sie standen. */
    grund: gruende.length
      ? `Aus den Schritten dieses Ablaufs: ${gruende.join(" ")}`
      : eigenerBefund.grund,
    unvollstaendig,
  };
}

/**
 * Eine Ankerkaskade auf der Seite zu einem Element machen (§7.1).
 *
 * Der Weg dorthin ist `overlay:kaskade`; das Inhaltsskript löst gegen seine
 * jüngste Wahrnehmung auf und gibt Referenz UND Epoche zurück. Beides gehört
 * zusammen: Eine Referenz ohne ihre Epoche ist eine Zahl, die auf der nächsten
 * Wahrnehmung etwas anderes bedeutet.
 *
 * Seit Festlegung F3 (14.08.2026) antwortet die Seite zusätzlich mit `name`,
 * `rolle` und `anker`. Der Grund ist der Unterschied zwischen Eindeutigkeit
 * und Identität: Dass ein Anker GENAU EIN Element trifft, sagt nichts darüber,
 * ob es dasselbe Element ist wie beim Aufzeichnen. Eine fremde Seite baut
 * um, ein `[data-testid]` wandert an einen anderen Knopf, und der Ablauf
 * klickt zuverlässig das Falsche.
 *
 * @returns {{ok:true, ref:string, epoche:string|null, name:string, rolle:string}
 *          | {ok:false, fehler:string}}
 */
async function kaskadeAufloesen(lage, kaskade) {
  const antwort = await anSeite(
    lage.tabId,
    { typ: "overlay:kaskade", kaskade },
    Math.max(1000, lage.seitenfrist()),
    { signal: lage.abbruch }
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return { ok: false, fehler: String((antwort.antwort && antwort.antwort.fehler) || "kaskade_gebrochen") };
  }
  const ref = refPruefen(antwort.antwort.ref);
  /* Eine Antwort ohne brauchbare Referenz ist keine Auflösung. Sie hier
     durchzulassen hiesse, den nächsten Schritt mit einer Referenz zu füttern,
     die es nicht gibt — und der Agent läse dann `element_not_found` statt
     „dein Anker findet nichts mehr". */
  if (!ref) return { ok: false, fehler: "kaskade_gebrochen" };
  /* Die Epoche ist eine KENNUNG und wird gemessen, nicht geschnitten
     (`epocheRoh`). Sie stand hier als `saeubern(…, 24)`: Zwei verschiedene
     Epochen, die sich erst nach dem 24. Zeichen unterscheiden, wären danach
     dieselbe — und eine Epochenprüfung, die zwei Wahrnehmungen für eine hält,
     ist keine. */
  const epoche = epocheRoh(antwort.antwort.epoche);
  /*
   * Name und Rolle sind Text von der besuchten Seite — und sie gehen in eine
   * WACHE (`zielIstDasAufgezeichnete`), nicht in einen Satz für den Menschen.
   *
   * Bis zum 14.08.2026 standen sie hier als `saeubern(…, GRENZEN.nameZeichen)`
   * und `saeubern(…, 40)`, also gekürzt. Das ist dieselbe Bauform wie
   * AUTOMODUS-2, nur an der Identitätswache statt am Klassifizierer: Die
   * besuchte Seite hätte über die LÄNGE ihres Namens mitbestimmt, ob der
   * Vergleich überhaupt vergleichbaren Text sieht. Ein gekürzter Name ist
   * ausserdem nie mehr gleich dem aufgezeichneten — die Wache hätte bei
   * langen, richtigen Namen Alarm geschlagen und wäre abgeschaltet worden.
   */
  const name = messeingang(antwort.antwort.name);
  const rolle = messeingang(antwort.antwort.rolle);
  return { ok: true, ref, epoche, name, rolle };
}

/*
 * Namen, die nichts belegen: der Rückfall auf den HTML-Elementnamen.
 *
 * Befund TEACH-1 vom 14.08.2026, gemessen an echten Dateien in einem echten
 * DOM: `content/geheim.js` (`beschreibungVon`) liest weder `label[for]` noch
 * das umschliessende `<label>` und fällt deshalb auf den Elementnamen zurück
 * (dort Zeile 769, `kuerzen(marke(el).toLowerCase())`). Ein Formular
 * `<label for=":r2:">Artikelnummer</label><input id=":r2:">` ergibt damit
 * `beschreibung: "input"`. Wird ein Pflichtfeld davor eingeschoben, trifft
 * der Stellenanker `div.feld:nth-of-type(2) > input` weiter GENAU EIN
 * Element, jetzt das Titelfeld — und dessen Name ist ebenfalls „input".
 * Gleich gegen gleich, die Wache liess durch, `{{artikelnummer}}` landete im
 * Titelfeld, Antwort `success`.
 *
 * Zwei Werte, die nur deshalb übereinstimmen, weil BEIDE nichts sagen, sind
 * kein Beleg. Diese Liste ist deshalb keine Liste verbotener Wörter, sondern
 * die Liste dessen, was der Rückfall erzeugen KANN: der Name eines
 * HTML-Elements, klein und ohne Leerzeichen. Trifft ein Knopf zufällig
 * wirklich die Beschriftung „button", hält die Wache ihn ebenfalls für
 * unbelegt — das ist die sichere Richtung und kostet eine Nachfrage.
 *
 * Sie steht hier und nicht in `geheim.js`, weil sie hier gebraucht wird: Die
 * Wache muss sich auf die Beschreibung nicht verlassen können. Dass
 * `beschreibungVon` ein Etikett lesen sollte, ist gemeldeter Fremdbedarf und
 * macht diese Liste danach nicht überflüssig — sie ist das Netz darunter.
 */
const MARKEN_RUECKFALL = Object.freeze(new Set([
  "a", "abbr", "article", "aside", "b", "body", "button", "canvas", "caption",
  "cite", "code", "col", "datalist", "dd", "details", "dialog", "div", "dl",
  "dt", "em", "embed", "fieldset", "figure", "footer", "form", "h1", "h2",
  "h3", "h4", "h5", "h6", "header", "hr", "i", "iframe", "img", "input",
  "label", "legend", "li", "main", "mark", "menu", "meter", "nav", "object",
  "ol", "optgroup", "option", "output", "p", "picture", "pre", "progress",
  "section", "select", "slot", "small", "span", "strong", "sub", "summary",
  "sup", "svg", "table", "tbody", "td", "template", "textarea", "tfoot", "th",
  "thead", "time", "tr", "u", "ul", "video",
]));

/** Sagt dieser Text überhaupt etwas, oder ist er nur ein Elementname? */
function belegtNichts(roh) {
  const t = messtext(roh);
  if (!t) return true;
  return MARKEN_RUECKFALL.has(t);
}

/*
 * Ist das gefundene Element auch das gemeinte? (Festlegung F3)
 *
 * Verglichen wird der Name, den die Seite JETZT nennt, mit dem, was beim
 * Aufzeichnen über dieses Element festgehalten wurde. Beide Seiten gehen
 * durch `gleicherText` aus der gemeinsamen Messform — dieselbe Form, in der
 * auch der Klassifizierer misst, und Gleichheit als GANZES.
 *
 * Festgehalten wurde ZWEIERLEI, und beides zählt:
 *
 *  1. `beschreibung` — was die Werkbank notiert hat. Sie stammt meist vom
 *     Element selbst (aria-label, title, Text), kann aber ein Satz eines
 *     Menschen sein.
 *  2. Die Textanker der Kaskade (`text=…`). Sie sind die maschinell
 *     aufgezeichnete Tatsache: Dieser Anker VERLANGT genau diesen Text.
 *
 * Warum die Anker dazugehören und die Festlegung F3 hier über ihren
 * Wortlaut hinausgeht: Gemessen am 14.08.2026 an einem echten Ablauf
 * (`wf_knopf`, Anker `text=Jetzt kaufen`, Beschreibung „den Kauf
 * abschliessen"). Der Anker trifft nachweislich das aufgezeichnete Element,
 * und der Vergleich allein gegen die Prosa des Menschen hätte den Ablauf mit
 * „falsches Ziel" abgebrochen. Eine Wache, die bei jedem zweiten richtigen
 * Ablauf Alarm schlägt, wird abgeschaltet, und dann schützt sie gar nichts.
 *
 * ================================================================
 * DREI ÄNDERUNGEN VOM 14.08.2026, ALLE DREI GEGEN GEMESSENE FUNDE
 * ================================================================
 *
 * **1. Kein `includes` mehr (Befund TEACH-6).** Hier stand
 * `a === b || a.includes(b) || b.includes(a)` über `vergleichsform`, also
 * über Text mit Randleerzeichen. Gemessen mit der wortwörtlichen Funktion:
 * aufgezeichnet „Abbrechen" trifft „Bestellung abbrechen" DURCH, „Speichern"
 * trifft „Speichern und beenden" DURCH, „Loeschen" trifft „Alles
 * unwiderruflich loeschen" DURCH, „Weiter" trifft „Weiter ohne zu speichern"
 * DURCH. Das sind genau die gefährlichen Verwechslungen: Ein umgebautes
 * Bedienfeld, auf dem der alte Knopf durch einen umfassenderen ersetzt wurde,
 * war für die Wache dasselbe Element. Die Randleerzeichen machten aus dem
 * Teilwort ein ganzes Wort, aus dem Teilsatz aber nicht denselben Satz.
 * Ab jetzt gilt Gleichheit als Ganzes (`gleicherText`).
 *
 * **2. Ein Beleg, der nichts sagt, ist keiner (Befund TEACH-1).** Siehe
 * `MARKEN_RUECKFALL` darüber.
 *
 * **3. Ohne Beleg wird angehalten, nicht durchgelassen.** Bis hierher stand
 * an zwei Stellen `return true`: bei fehlendem Namen von der Seite und bei
 * fehlendem Beleg im Ablauf. Begründet war das mit älteren Fassungen von
 * Inhaltsskript und Werkbank. Der Preis dieser Milde ist aber genau die
 * Lücke, um die es geht — und der Name kommt VON DER SEITE: Ein Element ohne
 * barrierefreien Namen schaltete die Wache ab, und welche Elemente keinen
 * Namen haben, bestimmt die Seite. Diese Funktion soll Identität BELEGEN;
 * aus „es gibt nichts zu vergleichen" folgt kein Beleg.
 *
 * Was der Preis wirklich ist: Der Ablauf hält an, der Agent bekommt die
 * mitgelieferte Wahrnehmung und darf die Referenz selbst nennen (§7.4). Er
 * verliert also einen Umlauf, nicht den Auftrag. Und weil „ich habe das
 * falsche Element gefunden" etwas anderes ist als „ich kann es nicht
 * belegen", tragen die beiden Lagen ab jetzt verschiedene Kennungen.
 *
 * @returns {"belegt"|"anderes_ziel"|"unbelegt"}
 */
function zielIstDasAufgezeichnete(name, schritt) {
  const belege = [];
  if (schritt && schritt.beschreibung) belege.push(schritt.beschreibung);
  if (Array.isArray(schritt && schritt.selector_cascade)) {
    for (const anker of schritt.selector_cascade) {
      if (typeof anker === "string" && anker.startsWith("text=")) belege.push(anker.slice(5));
    }
  }

  /* Nur Belege, die überhaupt etwas behaupten. Zwei Felder, die beide „input"
     heissen, belegen einander nicht. */
  const brauchbar = belege.filter((b) => !belegtNichts(b));
  if (!brauchbar.length) return "unbelegt";

  /* Und der Name der Seite muss ebenfalls etwas sagen. Ohne ihn — oder wenn er
     auch nur der Elementname ist — gibt es nichts, woran der Beleg hängen
     könnte. */
  if (belegtNichts(name)) return "unbelegt";

  return brauchbar.some((roh) => gleicherText(name, roh)) ? "belegt" : "anderes_ziel";
}

/** Aus einem geprüften Schritt den Befehlsrahmen bauen, den `einzeln` erwartet. */
async function schrittRahmenBauen(lage, schritt, nr, gesamt) {
  const wf = lage.plan.workflow;
  /* Der Schritttyp kommt aus einer gespeicherten Datei, also von aussen (H2
     vom 14.08.2026). */
  const cmd = eigen(SCHRITT_BEFEHL, schritt.type);
  if (typeof cmd !== "string") {
    return {
      ok: false,
      satz: `Den Schritttyp „${saeubern(schritt.type, 40)}" spielt diese Fassung nicht ab.`,
      hinweis: `Abspielbar sind: ${Object.keys(SCHRITT_BEFEHL).join(", ")}, dazu user_input_required. Den Ablauf in der Werkbank entsprechend aufzeichnen.`,
    };
  }

  const was = schritt.beschreibung || eigen(SCHRITT_TEXT, schritt.type) || schritt.type;
  const rahmen = {
    id: `${lage.id}.${nr}`,
    cmd,
    /* Der Satz, der dem Menschen vorgelesen wird. Er stammt aus der Werkbank
       des Menschen und nicht von der besuchten Seite — das ist die Bedingung
       dafür, dass er überhaupt in die Frage darf. */
    reason: `Schritt ${nr} von ${gesamt} aus dem Ablauf „${wf.name}": ${was}`,
    /* Die Kennung des Agenten reist mit. Ein Ablauf umgeht die Agentenmatrix
       nicht: Wer nicht klicken darf, darf es auch nicht in zwanzig
       aufgezeichneten Schritten. */
    agent: lage.agent || undefined,
  };

  if (Array.isArray(schritt.selector_cascade) && schritt.selector_cascade.length) {
    const gefunden = await kaskadeAufloesen(lage, schritt.selector_cascade);
    if (!gefunden.ok) {
      /* Zwei verschiedene Lagen, zwei verschiedene Sätze.
         `kaskade_gebrochen` ist die einzige Absage, die dieser Weg im Vertrag
         kennt (§7.4): Die Anker treffen nichts mehr, und dagegen hilft die
         mitgelieferte Wahrnehmung. Kommt etwas anderes zurück, spricht das
         Inhaltsskript eine Sprache, die diese Fassung nicht kennt — dann von
         „kein Anker trifft" zu reden wäre eine Erklärung, die wir uns
         ausgedacht haben. Befund vom 14.08.2026 (Verzahnung): Bis hierher
         bekamen beide Lagen denselben Satz. */
      const gebrochen = gefunden.fehler === "kaskade_gebrochen";
      return {
        ok: false,
        kaskade: true,
        fehler: gefunden.fehler,
        satz: gebrochen
          ? `Schritt ${nr} findet sein Element nicht mehr: Keiner der Anker trifft auf dieser Seite noch etwas.`
          /* Die Kennung der Seite steht ausdrücklich NICHT im Satz: Sie kommt
             aus einer fremden Seite, und Fremdtext geht hier nirgends in einen
             Satz. Sie reist als `stepError` in den Daten mit, wo sie als
             Angabe kenntlich ist und nicht als unsere Aussage. */
          : `Schritt ${nr} konnte sein Element nicht auflösen, die Seite hat auf die Ankerfrage anders geantwortet als vereinbart.`,
        hinweis: gebrochen
          ? "Die mitgelieferte Wahrnehmung zeigt, was jetzt dasteht. Nenne mir die Referenz des gemeinten Elements, dann spiele ich den Schritt damit."
          : "Den Tab neu laden und den Ablauf noch einmal starten. Bleibt es dabei, den Schritt in der Werkbank neu aufzeichnen.",
      };
    }
    /* Festlegung F3: Identität, nicht nur Eindeutigkeit. Weicht der Name des
       gefundenen Elements von dem ab, was der Mensch aufgezeichnet hat, ist
       das kein Erfolg, sondern ein anderes Ziel — und ein Ablauf, der
       zuverlässig das Falsche trifft, ist gefährlicher als einer, der
       abbricht.

       Drei Ausgänge statt zwei (Befund TEACH-1 vom 14.08.2026): „belegt",
       „anderes_ziel" und „unbelegt". Der dritte ist neu und hielt bis dahin
       für „belegt" her — zwei Felder, die beide „input" heissen, galten als
       dasselbe Element. Er bekommt einen eigenen Code und einen eigenen Satz,
       weil er eine ANDERE Lage beschreibt: Beim falschen Ziel ist die Seite
       umgebaut, hier fehlt schlicht der Beleg. Beides unter einem Namen zu
       melden hiesse, dem Agenten zwei Lagen als dieselbe zu verkaufen. */
    const identitaet = zielIstDasAufgezeichnete(gefunden.name, schritt);
    if (identitaet === "anderes_ziel") {
      return {
        ok: false,
        kaskade: true,
        fehler: "kaskade_falsches_ziel",
        satz: `Schritt ${nr} hat ein Element gefunden, aber nicht das aufgezeichnete: Der Anker trifft jetzt etwas anderes.`,
        hinweis: "Die Seite wurde vermutlich umgebaut. Die mitgelieferte Wahrnehmung zeigt, was jetzt dasteht. Nenne mir die Referenz des gemeinten Elements, oder den Schritt in der Werkbank neu aufzeichnen.",
      };
    }
    if (identitaet === "unbelegt") {
      return {
        ok: false,
        kaskade: true,
        fehler: "kaskade_unbelegt",
        satz: `Schritt ${nr} hat ein Element gefunden, kann aber nicht belegen, dass es das aufgezeichnete ist: Weder die Aufzeichnung noch die Seite nennt einen Namen, der etwas aussagt.`,
        hinweis: "Die mitgelieferte Wahrnehmung zeigt, was jetzt dasteht. Nenne mir die Referenz des gemeinten Elements, oder den Schritt in der Werkbank neu aufzeichnen — mit einem Feld, das eine Beschriftung trägt.",
      };
    }
    rahmen.ref = gefunden.ref;
    if (gefunden.epoche) rahmen.snapshotEpoch = gefunden.epoche;
  }

  switch (schritt.type) {
    case "navigate":
      rahmen.url = schritt.url;
      break;
    case "input":
      rahmen.text = schritt.value;
      if (schritt.clear !== undefined) rahmen.clear = schritt.clear;
      if (schritt.submit !== undefined) rahmen.submit = schritt.submit;
      break;
    case "select":
      if (schritt.value !== undefined) rahmen.value = schritt.value;
      if (schritt.label !== undefined) rahmen.label = schritt.label;
      if (schritt.index !== undefined) rahmen.index = schritt.index;
      break;
    case "scroll":
      if (schritt.direction) rahmen.direction = schritt.direction;
      if (schritt.amount !== undefined) rahmen.amount = schritt.amount;
      break;
    case "wait":
      /* `ms` ist eine Wartezeit, `until` eine Bedingung. Beide werden zu dem
         einen Weg, den `waitFor` kennt: auf Ruhe warten, höchstens so lange. */
      rahmen.idle = true;
      if (Number.isFinite(schritt.ms)) rahmen.waitSeconds = Math.max(1, Math.round(schritt.ms / 1000));
      break;
    default:
      break;
  }
  return { ok: true, cmd, rahmen };
}

/**
 * Die Absage eines Schrittes (§7.4).
 *
 * Sie trägt die Beschreibung des gesuchten Elements und den gekürzten
 * Textbaum. Der Grund steht im Vertrag: Der Agent soll selbst ein Ziel
 * benennen können, statt den ganzen Ablauf für kaputt zu halten. Eine Absage,
 * die nur „Schritt 4 ist gescheitert" sagt, macht aus einem verschobenen Knopf
 * einen verlorenen Ablauf.
 */
async function workflowSchrittAbsage(lage, nr, schritt, { satz, hinweis, innen = null }) {
  const wf = lage.plan.workflow;
  const daten = {
    workflow: { id: wf.id, name: wf.name },
    step: nr,
    stepCount: wf.steps.length,
    type: schritt.type,
    /* Die Beschreibung stammt aus der Werkbank des Menschen und ist genau das,
       was §7.4 verlangt: eine Beschreibung des gesuchten Elements. */
    description: schritt.beschreibung || "",
    anchors: Array.isArray(schritt.selector_cascade) ? schritt.selector_cascade.slice(0, 8) : [],
  };
  if (innen) daten.stepError = innen;

  const w = await wahrnehmenGesichert(lage).catch(() => ({ ok: false }));
  if (w && w.ok) daten.snapshot = w.snapshot;

  return misslungen(lage.id, lage.cmd, "workflow_step_failed", satz, {
    retryable: false,
    hint: hinweis,
    data: daten,
    m: lage.meta(),
  });
}

async function tuRunWorkflow(rahmen, lage) {
  const wf = lage.plan.workflow;
  const gesamt = wf.steps.length;
  let gemacht = 0;

  for (let i = 0; i < gesamt; i++) {
    const schritt = wf.steps[i];
    const nr = i + 1;

    /* Vor JEDEM Schritt: Lebt die Sitzung noch? Ohne diese Zeile liefe ein
       Ablauf nach dem Not-Aus weiter, bis der nächste Schritt zufällig an
       einer anderen Prüfung scheitert. Gefragt wird der Riegel und nicht nur
       `aktiv`: Er kennt auch den Abbruch dieses einen Schrittes (B3). */
    if (riegelZu(lage)) {
      return misslungen(lage.id, lage.cmd, "session_beendet",
        `Die Browsersitzung wurde beendet, ${gemacht} von ${gesamt} Schritten waren erledigt.`,
        { m: lage.meta() });
    }

    /* Der Halt für den Menschen (§7.2). Hier hat der Rekorder ein Geheimfeld
       gesehen und absichtlich nichts aufgezeichnet — Anmelden bleibt Sache des
       Menschen, und dieser Schritt ist die Stelle, an der er es tut. */
    if (schritt.type === "user_input_required") {
      const antwort = await freigabeFragen({
        frage: `Der Ablauf „${wf.name}" hält bei Schritt ${nr} an: ${schritt.reason}. Erledige das bitte selbst, danach mache ich weiter.`,
        quelle: "",
        cmd: lage.cmd,
        id: `${lage.id}.${nr}`,
        frist: Math.max(GRENZEN.bedenkzeitMs, lage.restfrist() - AUSFUEHRUNG_RESERVE_MS),
        /* Am Signal des ABLAUFS, nicht nur am Not-Aus (WFRIST-1): Läuft die
           äußere Uhr ab, während diese Frage offen steht, wird sie
           zurückgezogen statt später beantwortet. */
        signal: lage.schrittsignal || lage.signal,
      });
      if (antwort !== "ja") {
        return workflowSchrittAbsage(lage, nr, schritt, {
          satz: `Der Ablauf hält bei Schritt ${nr} an und wartet auf den Menschen, und der hat nicht bestätigt.`,
          hinweis: "Den Nutzer bitten, sich anzumelden oder den fehlenden Wert einzutragen, danach den Ablauf neu starten.",
          innen: { code: antwort === "nein" ? "user_declined" : "grant_required", message: schritt.reason },
        });
      }
      gemacht += 1;
      continue;
    }

    const gebaut = await schrittRahmenBauen(lage, schritt, nr, gesamt);
    if (!gebaut.ok) {
      return workflowSchrittAbsage(lage, nr, schritt, {
        satz: gebaut.satz,
        hinweis: gebaut.hinweis,
        /* Der innere Code ist der, den die Kaskade wirklich gemeldet hat —
           `kaskade_gebrochen`, wenn kein Anker mehr trifft, und
           `kaskade_falsches_ziel`, wenn einer etwas anderes trifft (F3).
           Beides unter einem Namen zu melden hiesse, dem Agenten zwei sehr
           verschiedene Lagen als dieselbe zu verkaufen: Bei der einen hilft
           eine neue Referenz, bei der anderen ist die Seite umgebaut. */
        innen: gebaut.kaskade ? { code: gebaut.fehler || "kaskade_gebrochen", message: gebaut.fehler } : null,
      });
    }

    /* Und hier geht der Schritt durch dieselbe Tür wie jeder Agentenbefehl.
       `einzeln` und nicht `befehlAusfuehren`: Letzteres hängt sich an die
       Warteschlange, und wir stehen selbst schon darin — der Ablauf wartete
       auf sich selbst. */
    const antwort = await schrittSchicken(lage, gebaut.rahmen, gebaut.cmd);
    if (!antwort || antwort.success !== true) {
      const fehler = (antwort && antwort.error) || {};
      return workflowSchrittAbsage(lage, nr, schritt, {
        satz: `Schritt ${nr} von ${gesamt} des Ablaufs „${wf.name}" ist nicht durchgekommen: ${fehler.message || "Der Schritt hat keine Antwort geliefert."}`,
        hinweis: fehler.hint || "Die mitgelieferte Wahrnehmung zeigt, wie die Seite jetzt aussieht.",
        innen: { code: fehler.code || "client_fehler", message: fehler.message || "" },
      });
    }
    gemacht += 1;
  }

  return gelungen(lage.id, lage.cmd, {
    workflow: { id: wf.id, name: saeubern(wf.name, 120) },
    stepCount: gesamt,
    stepsDone: gemacht,
  }, lage.meta());
}

/* Die Tabelle der Ausführungen. Sie muss zu `BEFEHLE` passen — ein Eintrag
   dort ohne Eintrag hier wäre ein Befehl, der die Freigabe durchläuft und dann
   an `AUSFUEHRUNG[cmd] is not a function` stirbt. Die Prüfung „Zu jedem Befehl
   der Tabelle gibt es auch eine Ausführung" hält beide Listen zusammen. */
const AUSFUEHRUNG = {
  readPage: tuReadPage,
  snapshot: tuReadPage,
  get_state: tuGetState,
  scroll: tuScroll,
  highlight: tuHighlight,
  extract: tuExtract,
  waitFor: tuWaitFor,
  screenshot: tuScreenshot,
  navigate: tuNavigate,
  back: tuBack,
  click: tuClick,
  type: tuType,
  select: tuSelect,
  run_workflow: tuRunWorkflow,
};

/* --------------------------------------------------------------------- *
 * Die Schleife
 * --------------------------------------------------------------------- */

function rateFrei() {
  const jetzt = Date.now();
  zaehler.zeiten = zaehler.zeiten.filter((t) => jetzt - t < GRENZEN.fensterMs);
  if (zaehler.gesamt >= GRENZEN.befehleJeSitzung) return "sitzung";
  if (zaehler.zeiten.length >= GRENZEN.befehleJeFenster) return "fenster";
  return null;
}

/**
 * Ein Befehl vom Relay — geprüft, freigegeben, ausgeführt, beantwortet.
 *
 * Diese Funktion wirft nie. Sie gibt immer einen `result`-Rahmen zurück, und
 * zwar mit derselben `id`, die der Relay gesendet hat. Ist die Kennung
 * unbrauchbar, geht die Antwort trotzdem raus — der Relay wirft sie dann weg,
 * und das ist billiger, als wenn ein Aufrufer wartet.
 */
export async function befehlAusfuehren(rahmen, sitzung) {
  const begonnen = Date.now();
  const id = kennungPruefen(rahmen && rahmen.id) || "";
  const cmd = typeof rahmen?.cmd === "string" ? rahmen.cmd.slice(0, 40) : "";
  const meineGeneration = generation;
  /* Was `einzeln` unterwegs erfährt und das Buch braucht: die Adresse, auf der
     der Tab beim Messen stand, und die Klassen, die der Schritt trug. Beides
     entsteht mitten in der Schleife und wäre danach verloren. */
  const notiz = { adresse: "", klassen: [] };

  if (wartende >= GRENZEN.warteschlange) {
    return buchFuehren(rahmen, misslungen(id, cmd, "busy",
      "Ich arbeite gerade einen Schritt ab und komme nicht hinterher.",
      { retryable: true, hint: "Einen Schritt nach dem anderen senden.", m: meta(begonnen, sitzung && sitzung.tabId) }), notiz);
  }

  wartende += 1;
  const meins = kette.then(() =>
    einzeln(rahmen, sitzung, { id, cmd, begonnen, meineGeneration, notiz }).catch((fehler) =>
      /* Der letzte Fangnetz-Zweig. Was hier ankommt, ist ein Fehler in dieser
         Erweiterung — der Agent bekommt trotzdem eine Antwort, sonst wäre ein
         Programmfehler bei uns für ihn nicht von einem toten Browser zu
         unterscheiden. */
      misslungen(id, cmd, "client_fehler",
        "In der Erweiterung ist etwas schiefgegangen. Der Schritt wurde nicht ausgeführt.",
        { retryable: true, hint: String(fehler && fehler.message ? fehler.message : fehler).slice(0, 120), m: meta(begonnen, sitzung && sitzung.tabId) })
    )
  );
  kette = meins.then(
    () => undefined,
    () => undefined
  );
  try {
    return await buchFuehren(rahmen, await meins, notiz);
  } finally {
    wartende -= 1;
  }
}

/*
 * Genau ein Eintrag ins Protokollbuch je Fernaktion (§8.3).
 *
 * „Genau einer" ist hier baulich und nicht durch Sorgfalt gelöst: Der Eintrag
 * entsteht an der einen Stelle, durch die JEDE Antwort geht — auch die
 * abgelehnte, auch die aus dem vollen Wartezimmer, auch die aus dem
 * Fangnetz-Zweig. Ihn in die dreizehn Ausführungen zu streuen hiesse, ihn
 * dreizehnmal vergessen zu können, und ein Buch mit Lücken ist kein Buch.
 *
 * Es wird GEWARTET, bis der Eintrag steht, obwohl das die Antwort an den Relay
 * um einen Speicherzugriff verzögert. Der Grund ist die Nachweisbarkeit: Ein
 * Buch, das nebenher geschrieben wird, ist ein Buch, dessen Vollständigkeit
 * niemand messen kann, und die Zusage aus §8.3 wäre eine Behauptung.
 *
 * Es hält nichts an: Schlägt das Schreiben fehl, geht die Antwort trotzdem
 * raus. Das Buch ist eine Auskunft, kein Gate.
 */
async function buchFuehren(rahmen, ergebnis, notiz) {
  try {
    await buchEintragen({
      zeit: Date.now(),
      agent: rahmen && rahmen.agent,
      cmd: ergebnis && ergebnis.cmd,
      /* Die Adresse aus der Messung, nicht die von jetzt. Wandert der Tab nach
         der Freigabe ab, gehört ins Buch, wofür freigegeben war — und ganz
         sicher nicht die Seite, auf die er gewechselt ist. Die verrät die
         Wache aus gutem Grund nirgends. */
      url: notiz && notiz.adresse,
      ergebnis: ergebnis && ergebnis.success === true
        ? "gelungen"
        : (ergebnis && ergebnis.error && ergebnis.error.code) || "unbekannt",
      klassen: (notiz && notiz.klassen) || [],
    });
  } catch (_) {
    /* Siehe oben: kein Gate. */
  }
  return ergebnis;
}

/** Einen Workflow-Schritt durch dieselbe Schleife schicken wie einen Befehl. */
async function schrittSchicken(lage, rahmen, cmd) {
  const begonnen = Date.now();
  const id = kennungPruefen(rahmen.id) || "";
  const notiz = { adresse: "", klassen: [] };
  const antwort = await einzeln(rahmen, lage.sitzung, {
    id,
    cmd,
    begonnen,
    meineGeneration: lage.generation,
    notiz,
    /* Der Schritt hängt am Signal des ABLAUFS, nicht nur am Modul-Not-Aus
       (Befund WFRIST-1): Läuft die äußere Uhr von `run_workflow` ab, bricht
       dieses Signal — und damit auch ein Schritt, der gerade auf eine
       Freigabe oder eine langsame Seite wartet. */
    schrittsignal: lage.schrittsignal || null,
  }).catch((fehler) =>
    misslungen(id, cmd, "client_fehler",
      "In der Erweiterung ist beim Abspielen etwas schiefgegangen.",
      { retryable: false, hint: String(fehler && fehler.message ? fehler.message : fehler).slice(0, 120), m: lage.meta() })
  );
  /* Auch ein Schritt aus einem Ablauf ist eine Fernaktion und bekommt seinen
     eigenen Eintrag. Ein Buch, in dem zwanzig Klicks als eine Zeile
     „run_workflow: gelungen" stehen, beantwortet die Frage nicht, für die es
     geführt wird: Was ist in meinem Namen geschehen? */
  return buchFuehren(rahmen, antwort, notiz);
}

async function einzeln(rahmen, sitzung, { id, cmd, begonnen, meineGeneration, notiz = null, schrittsignal = null }) {
  const tabId = sitzung && Number.isInteger(sitzung.tabId) ? sitzung.tabId : null;
  const m = (zusatz) => meta(begonnen, tabId, zusatz);
  /* Das Not-Aus-Signal, das bei DIESEM Befehl galt. Siehe `laufAbbrechen`.
     Ein Schritt aus einem Ablauf bekommt stattdessen das Signal des Ablaufs
     (`schrittsignal`, Befund WFRIST-1): Es bricht mit dem Not-Aus UND mit dem
     äußeren Riegel von `run_workflow` — sonst liefe der Schritt weiter,
     nachdem die äußere Uhr längst geantwortet hat. */
  const meinSignal = schrittsignal || abbruchSignal;
  const buch = notiz || { adresse: "", klassen: [] };

  /* Die Uhr, an der die AUSFÜHRUNG hängt. Sie beginnt beim Eintreffen des
     Befehls — und wird um die Zeit zurückgestellt, die der Mensch für seine
     Antwort gebraucht hat (Schritt 10, Befund M3). `begonnen` selbst bleibt
     unangetastet: `meta.tookMs` soll sagen, wie lange es WIRKLICH gedauert hat,
     nicht wie lange die Maschine daran gearbeitet hat. */
  let uhrBeginn = begonnen;

  /* 0. Lebt die Sitzung noch, für die dieser Befehl gedacht war? */
  if (!aktiv || meineGeneration !== generation) {
    return misslungen(id, cmd, "session_beendet",
      "Die Browsersitzung ist beendet. Ich führe nichts mehr aus.",
      { m: m() });
  }

  /* 1. Positivliste. Ein unbekannter Befehl wird abgelehnt und benannt — nicht
        stillschweigend verschluckt und nicht auf gut Glück versucht. */
  /* `cmd` kommt aus dem Rahmen des Relays. `BEFEHLE[cmd]` allein fände auch
     `constructor` und `toString`, und der Befehl liefe mit einer geerbten
     Funktion als „Eintrag" weiter — bis er irgendwo an `eintrag.tut` stürbe.
     Dass er heute an der Stufenprüfung hängenbleibt, ist Zufall und keine
     Prüfung (Befund H2 vom 14.08.2026). */
  const eintrag = eigen(BEFEHLE, cmd);
  if (!eintrag || typeof eintrag !== "object") {
    return misslungen(id, cmd, "not_supported",
      cmd
        ? `Den Befehl „${saeubern(cmd, 40)}" kann diese Erweiterung nicht.`
        : "Der Rahmen trug keinen Befehl.",
      {
        hint: `Möglich sind zurzeit: ${Object.keys(BEFEHLE).join(", ")}.`,
        m: m(),
      });
  }

  /* 1b. Die Agentenkennung (§8.1). Sie kommt vom Relay und damit aus einer
         Quelle, die wir nicht selbst schreiben — also wird sie gemessen, nicht
         geglaubt. Was nicht auf der Positivliste steht, ist kein Agent.

         Ein Rahmen OHNE das Feld läuft weiter. Das ist eine bewusste
         Übergangsentscheidung und keine Nachlässigkeit: Der Relay setzt das
         Feld erst ab v3.5 (§11.2), und ein Client, der ohne es gar nichts mehr
         täte, wäre gegen jede heute laufende Gegenstelle taub. Sobald ein Name
         dasteht, gilt er — und dann gilt auch die Matrix.

         ============================================================
         Befund AUTOMODUS-7 vom 14.08.2026: „ohne das Feld" und „das Feld ist
         leer" sind NICHT dasselbe.
         ============================================================

         §11.2 sagt, der Relay säubere jeden Namen auf `[A-Za-z]{1,32}` — und
         was er nicht lesen kann, macht er dabei gerade zu LEER. Ein leeres
         Feld ist also keine fehlende Behauptung, sondern eine, die niemand
         entziffern konnte. Gemessen: Mit `agent: ""` lief der Befehl im Modus
         `auto` mit `fragen=0` und `erfolg=true` durch, während derselbe
         Befehl mit `agent: "SMarTrTrader"` an der leeren Matrix scheiterte.
         Ein Aufrufer, dessen Kennung der Relay nicht lesen kann, bekam damit
         MEHR Rechte als ein bekannter Agent — genau die falsche Richtung.

         Ab jetzt: Feld nicht da → Übergangsweg wie bisher. Feld da, aber
         nicht lesbar (leer, nur Leerraum, keine Zeichenkette) → Absage. Wer
         etwas behauptet hat, muss es lesbar behaupten. */
  const kennungDa = !!rahmen && Object.prototype.hasOwnProperty.call(rahmen, "agent") &&
    rahmen.agent !== undefined && rahmen.agent !== null;
  const agent = typeof (rahmen && rahmen.agent) === "string" ? rahmen.agent.trim() : "";
  if (kennungDa && !agent) {
    return misslungen(id, cmd, "agent_not_permitted",
      "Dieser Rahmen trägt eine Agentenkennung, die niemand lesen kann. Eine Kennung, die nichts benennt, gilt hier nicht.",
      {
        retryable: false,
        hint: `Den Namen des Agenten ungekürzt mitsenden, oder das Feld ganz weglassen. Zugelassen sind: ${AGENTEN.join(", ")}.`,
        m: m(),
      });
  }
  if (agent && !AGENTEN.includes(agent)) {
    return misslungen(id, cmd, "agent_not_permitted",
      `„${saeubern(agent, 40)}" steht nicht auf der Liste der Agenten, die diesen Browser steuern dürfen.`,
      {
        retryable: false,
        hint: `Zugelassen sind: ${AGENTEN.join(", ")}.`,
        m: m(),
      });
  }

  /* 2. Der Satz für den Menschen ist Pflicht. Er wird vorgelesen; ohne ihn
        wüsste der Inhaber nicht, wofür er gerade freigibt. Das ist eine
        Barrierefreiheits-Erzwingung im Protokoll, keine Höflichkeit
        (spec-01 §3.6.2). */
  const grund = typeof (rahmen && rahmen.reason) === "string" ? entmarken(saeubern(rahmen.reason, 200)) : "";
  if (!grund) {
    return misslungen(id, cmd, "reason_required",
      "Zu diesem Schritt fehlt der Satz, der dem Menschen vorgelesen wird.",
      { hint: "`reason` mitsenden: ein Satz in Alltagssprache, was du tust und warum.", m: m() });
  }

  /* 3. Deckel. Der Relay zählt selbst (DRAHTFORMAT §6); diese Zählung ist die
        zweite und greift auch dann, wenn der Relay eine andere Meinung hat. */
  const rate = rateFrei();
  if (rate) {
    return misslungen(id, cmd, "budget_exceeded",
      rate === "sitzung"
        ? "Diese Sitzung hat ihr Befehlskontingent aufgebraucht."
        : "Das waren zu viele Befehle in kurzer Zeit.",
      { retryable: rate === "fenster", m: m() });
  }
  zaehler.gesamt += 1;
  zaehler.zeiten.push(Date.now());

  /* 4. Stufe. Der Server darf einschränken, nie erweitern. */
  if (!stufeReicht(sitzung && sitzung.stufe, cmd)) {
    return misslungen(id, cmd, "stufe_zu_niedrig",
      `Diese Sitzung darf nur zusehen. „${saeubern(cmd, 40)}" braucht mehr Rechte.`,
      { hint: "Dem Nutzer sagen, was du bräuchtest — er kann eine neue Sitzung freigeben.", m: m() });
  }

  /* 5. Der Tab. */
  if (tabId === null) {
    return misslungen(id, cmd, "tab_gone",
      "Zu dieser Sitzung gehört kein Tab mehr.", { m: m() });
  }
  const adresse = await tabAdresse(tabId);
  if (!adresse) {
    return misslungen(id, cmd, "tab_gone",
      "Der Tab, den ich steuern durfte, ist nicht mehr da.", { m: m() });
  }

  /* 6. Bereich — gemessen an der Adresse, auf der der Tab JETZT steht.
        Der Relay prüft die Ziele im Befehl; wohin der Mensch oder die Seite
        selbst inzwischen gewechselt ist, kann er nicht wissen. Ohne diese
        Prüfung läse der Agent eine Seite, die nie freigegeben wurde. */
  if (!bereichPasst(adresse, sitzung)) {
    return misslungen(id, cmd, "scope_violation_local",
      "Dieser Tab steht auf einer Seite, die nicht freigegeben ist. Ich lese sie nicht.",
      { hint: "Den Nutzer bitten, den Tab zurückzuwechseln oder eine neue Freigabe zu erteilen.", m: m() });
  }
  /* Ab hier steht fest, wofür dieser Schritt gedacht war. Das Buch bekommt
     genau diese Adresse und nie die, auf der der Tab später steht. */
  buch.adresse = adresse;

  /* 7. Der Rahmen muss stehen, bevor gelesen wird. Ohne ihn sieht der Mensch
        nicht, dass gerade auf seiner Seite gearbeitet wird — und dann wird
        nicht gearbeitet. */
  const overlay = await overlaySicherstellen(tabId, { signal: meinSignal.abbruch });
  if (!overlay.ok) {
    return misslungen(id, cmd, "snapshot_unavailable",
      overlay.fehler === "ursprung_gesperrt"
        ? "Auf dieser Seite arbeite ich grundsätzlich nicht."
        : "Ich kann auf dieser Seite den grünen Rahmen nicht anzeigen. Ohne ihn arbeite ich nicht.",
      { retryable: overlay.fehler !== "ursprung_gesperrt", m: m() });
  }

  /* War das Overlay gerade neu einzuspielen, ist der grüne Rahmen aus: Nach
     jeder Navigation stirbt das alte Skript, das neue startet unsichtbar
     (opacity 0). Bis 0.4.1 schaltete es danach niemand wieder an — deshalb war
     die Seite nach dem ersten Seitenwechsel unsichtbar bedient. Das ist der
     Kern der Meldung „nichts passiert sichtbar". Jetzt wird der Rahmen bei
     jeder Neu-Einspielung wiederhergestellt. */
  await rahmenWiederAnschalten(tabId, overlay, meinSignal.abbruch);

  /* 7b. Der Modus, der wirklich gilt (§2). Er entsteht aus dem, was der Mensch
         am Browser eingestellt hat, und dem, was der Server zulässt — und es
         gilt das Kleinere. Er steht hier, weil der Rahmen gerade sichergestellt
         wurde: Die Seite soll ihn zeigen, sobald sie überhaupt etwas zeigt. */
  const stand = await modusStandLesen();
  const schluessel = String(tabId);
  const modus = modusVerrechnen(eigen(stand.tabs, schluessel), sitzung && sitzung.schrittmodus);
  await modusAnDieSeite(tabId, modus, false, meinSignal.abbruch);

  /* 8. Die Parameter — geprüft, BEVOR gefragt wird.
        Zwei Gründe, und beide sind Befunde:
        (a) `scroll` machte aus einer fehlenden Richtung stillschweigend „nach
            unten" und meldete Erfolg. Ein fehlender Parameter, der bestimmt,
            WAS geschieht, ist ab hier eine benannte Absage.
        (b) Bei `navigate` muss die Zieladresse vor der Frage gegen den Bereich
            stehen. Sonst bestätigt der Mensch eine Adresse, die die Erweiterung
            danach selbst ablehnt — und lernt, dass seine Zustimmung nichts
            bedeutet. */
  const gepruefte = parameterPruefen(cmd, parameterRahmen(cmd, rahmen, id), {
    sitzung,
    fristMs: Math.max(1000, frist(eintrag, uhrBeginn) - AUSFUEHRUNG_RESERVE_MS),
  });
  if (!gepruefte.ok) {
    return misslungen(id, cmd, gepruefte.code, gepruefte.satz,
      { retryable: gepruefte.retryable === true, hint: gepruefte.hinweis, m: m() });
  }
  const plan = gepruefte.plan;

  /* 8b. Der gespeicherte Ablauf — geholt und gefüllt, BEVOR gefragt wird
         (§8.2). Aus demselben Grund wie die Parameter: Der Mensch soll hören,
         WELCHER Ablauf gleich läuft und wie viele Schritte er hat, und er soll
         nichts bestätigen, das danach an einem Tippfehler in der Kennung
         scheitert. `frageZusatz` liest genau diese beiden Felder. */
  if (cmd === "run_workflow") {
    const geholt = await workflowHolen(plan.id);
    if (!geholt.ok) {
      return misslungen(id, cmd, "workflow_not_found", geholt.satz,
        { retryable: false, hint: geholt.hinweis, m: m() });
    }
    const gefuellt = platzhalterFuellen(geholt.workflow, plan.params);
    if (!gefuellt.ok) {
      return misslungen(id, cmd, "param_ungueltig", gefuellt.satz,
        { retryable: false, hint: gefuellt.hinweis, m: m() });
    }
    plan.workflow = gefuellt.workflow;
    plan.name = gefuellt.workflow.name;
    plan.schritte = gefuellt.workflow.steps.length;
  }

  /* 9. Bei „zeigen", „klicken", „tippen" und „auswählen" muss vor der Frage
        feststehen, WORAUF gezielt wird — sonst könnte der Mensch nur einer
        Absicht zustimmen, nicht einem Schritt. Nachgeschlagen wird nur; die
        Seite bleibt an dieser Stelle unberührt. */
  let ziel = null;
  const epoche = typeof rahmen.snapshotEpoch === "string" ? rahmen.snapshotEpoch : null;
  if (cmd === "highlight" || cmd === "click" || cmd === "type" || cmd === "select") {
    const ref = plan.ref;
    const nachschlag = await anSeite(
      tabId,
      {
        typ: "overlay:nachschlagen",
        ref,
        epoche,
      },
      6000,
      { signal: meinSignal.abbruch }
    );
    if (!nachschlag.ok || !nachschlag.antwort.ok) {
      return absageDerSeite({ id, cmd, meta: m }, nachschlag, {
        ...REF_ABSAGEN,
        element_not_visible: ["element_not_visible", "Das Element ist gerade nicht sichtbar.",
          "Erst `scroll` zu dem Element, dann noch einmal zeigen.", true],
      }, {
        code: "tab_gone",
        satz: "Ich erreiche den Tab gerade nicht.",
        hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
      });
    }
    /*
     * Befund AUTOMODUS-2 vom 14.08.2026, und er stand genau hier.
     *
     * Bis dahin hiess diese Zeile
     * `name: saeubern(nachschlag.antwort.name, GRENZEN.nameZeichen)`. Der
     * Name wurde also auf 120 Zeichen gekürzt, BEVOR `klassenBestimmen` ihn
     * sah — und `saeubern` schneidet die MITTE heraus, also genau das Wort.
     * Gemessen: Ein Knopf mit 208 Zeichen barrierefreiem Namen, in dessen
     * Mitte „kaufen" steht, ergibt am Klassifizierer ungekürzt
     * `hart=zahlung`, über den Produktivweg aber `fragen=0` und
     * `erfolg=true` im Modus `auto`. Dasselbe gemessen für „loeschen",
     * „Kamera", „captcha" und ein Feld namens „Passwort". Lange `aria-label`
     * sind auf Verkaufsseiten alltäglich und von der Seite frei wählbar.
     *
     * Ab jetzt gehen ALLE vier Messeingänge ungekürzt hinein — Name, Rolle,
     * Marke und Feldtyp. Rolle, Marke und Feldtyp standen mit 40, 20 und 20
     * Zeichen zwar bequem über jedem gültigen Wert, aber die Zusage ist keine
     * über Längen: Wo die besuchte Seite den Wert liefert, darf sie nicht
     * mitbestimmen, ob die Wache ihn ganz zu sehen bekommt.
     *
     * Ein Deckel steht hier nicht mehr, auch kein grosser. Er wäre wieder
     * genau das, was der Befund beschreibt — nur mit einer anderen Zahl. Der
     * Aufwand ist ein Durchlauf über die Zeichenkette; die Wahrnehmung selbst
     * ist um Grössenordnungen teurer und hat ihre Deckel dort, wo sie
     * hingehören: an der ANZEIGE.
     */
    ziel = {
      ref,
      /* Messeingänge: ungekürzt. */
      name: messeingang(nachschlag.antwort.name),
      rolle: messeingang(nachschlag.antwort.rolle),
      /* Die drei Angaben, aus denen der Klassifizierer die Bauform des Ziels
         liest (§3.1): das HTML-Element, sein `type` und ob sein Formular ein
         Geheimfeld enthält. Sie sind alle freiwillig — antwortet eine ältere
         Fassung des Inhaltsskripts ohne sie, fällt der Befund milder aus und
         nie strenger. Deshalb stehen sie hier und nicht als Bedingung. */
      marke: messeingang(nachschlag.antwort.marke),
      typ: messeingang(nachschlag.antwort.feldtyp),
      formularGeheim: nachschlag.antwort.formularGeheim === true,
      /* ANZEIGE: Das ist der Name, der in `quelle` neben die Freigabefrage
         geht und ins Protokoll. Er ist gekürzt und von Steuerzeichen befreit,
         weil er auf einen Bildschirm geht — und er ist ein EIGENES Feld,
         damit an jeder Aufrufstelle zu sehen ist, welches der beiden gerade
         benutzt wird. */
      anzeigename: saeubern(nachschlag.antwort.name, GRENZEN.nameZeichen),
      rect: nachschlag.antwort.rect,
      mitte: nachschlag.antwort.mitte,
    };
    /* Der Zeiger wird hier BEWUSST noch nicht gesetzt. Ein abgelehnter Schritt
       darf nichts auf der Seite bewegen, auch nicht den Agentenzeiger — das
       wäre ein `highlight` ohne Freigabe. Sichtbar wird das Ziel erst nach dem
       Ja, in der Ausführung (overlay.js: zeigerAufTreffer in klicken/tippen/
       auswählen). Prüfsatz: „overlay:zeiger trotz Ablehnung" muss ausbleiben. */
  }

  /* 9b. Die Modus-Maschine (§2, §3).
   *
   * Bis 0.5.3 stand hier eine einzige Zeile: „fragen, ausser der Schrittmodus
   * ist `auto`". Kein Befehl trug `freigabe: "immer"`, also liefen im
   * Vollzugriff `click`, `type` und `select` ohne jede Rückfrage durch — ein
   * Klick auf „Kaufen" so gut wie einer auf „Weiter". Das war die riskanteste
   * Stelle im ganzen Bestand.
   *
   * Ab jetzt entscheidet die Entscheidungstabelle aus befehle.js, und sie
   * bekommt drei Auskünfte: welche Klassen dieser Schritt trägt
   * (`klassenBestimmen`), was auf diesem Wirt gilt (`regelnFuer`) und in
   * welchem Modus wir sind. Der Klassifizierer liest dabei Text von der
   * besuchten Seite — deshalb darf sein Ergebnis ausschliesslich MEHR
   * Rückfrage auslösen, und deshalb steht `freigabeNoetig` und nicht diese
   * Datei am Ende der Kette.
   */
  /*
   * Wo der Tab steht — UND wohin dieser Schritt ihn bringt.
   *
   * Befund vom 14.08.2026 (B1): Hier stand `{ url: adresse }`, also
   * ausschliesslich die Adresse, auf der der Tab GERADE steht. Bei `navigate`
   * wurde damit die Seite klassifiziert, die verlassen wird, und nie das
   * Ziel. Alle adressgestützten harten Klassen — `zahlung`, `datei`,
   * `captcha` — massen beim Ortswechsel die falsche Seite. Gemessen: Ein Tab
   * auf `https://shop.de/artikel/12345` durfte in der Automatik
   * `https://shop.de/order/confirm?buy=1` aufrufen, mit `success=true` und
   * null Rückfragen. Ein Ein-Klick-Kauf per GET war stumm auslösbar.
   *
   * `back` trägt hier nichts ein und kann es nicht: Wohin der Verlauf führt,
   * weiss vorher niemand. Für `back` bleibt es deshalb bei der Herkunft, und
   * die zweite Wache in `nachDemWechsel` prüft die neue Adresse, sobald sie
   * feststeht — dort gegen Bereich UND Sperrliste, bevor irgendetwas gelesen
   * wird. Eine erfundene Zieladresse wäre schlechter als keine.
   */
  const kopfJetzt = { url: adresse, titel: "", ziel: cmd === "navigate" ? plan.url : null };
  const befund = ablaufBefund(cmd, klassenBestimmen(cmd, plan, ziel, kopfJetzt), plan, adresse);
  buch.klassen = befund.klassen;

  /*
   * Die Regeln des Wirtes — auch die des ZIELS (Befund vom 14.08.2026, B2).
   *
   * `regelnFuer(adresse)` allein misst den Wirt, den der Tab gerade verlässt.
   * Gemessen: Mit `sa_matrix.gesperrt=["bank.de"]`, Tab auf `shop.de`, Modus
   * `auto`, lief `navigate` nach `https://bank.de/ueberweisung` mit
   * `success=true` und null Rückfragen durch — und danach wurde dort der
   * Rahmen aufgebaut und die Seite wahrgenommen. Vertrag §3.2, erste Zeile,
   * verlangt für einen gesperrten Wirt in JEDEM Modus eine Frage.
   *
   * Zusammengelegt wird in die strengere Richtung: gesperrt, sobald EINER von
   * beiden gesperrt ist, und freigeschaltet nur, was auf BEIDEN
   * freigeschaltet ist. Eine Freischaltung, die der Mensch für den einen Wirt
   * erteilt hat, ist keine für den anderen.
   */
  const regeln = await regelnZusammen(adresse, cmd === "navigate" ? plan.url : null);

  /* Die Wirte, über die in DIESEM Schritt entschieden wird. Sie reisen bis in
     die Wache nach der Freigabe: Ein gesperrter Wirt, über den gefragt wurde,
     ist erlaubt; einer, auf dem der Tab überraschend steht, nicht. */
  const wirte = new Set([hostAus(adresse)].filter(Boolean));
  if (cmd === "navigate" && plan.host) wirte.add(plan.host);

  const entscheidung = freigabeNoetig(modus, befund, regeln);

  /* 9c. Die Agentenmatrix (§4). Sie steht NACH dem Klassifizierer, weil sie
         die Klassen braucht, und VOR der Frage, weil der Mensch nichts
         bestätigen soll, das die Matrix danach selbst ablehnt.

         Gefragt wird für JEDE Klasse des Schrittes, nicht für die erste: Ein
         Agent, der lesen darf, darf damit nicht auch bezahlen. Voreinstellung
         ist überall `false` — eine Matrix, die im Zweifel erlaubt, ist keine.

         ============================================================
         Befund AUTOMODUS-5 vom 14.08.2026: gemessen wurde nur die HERKUNFT.
         ============================================================

         Hier stand `agentDarf(agent, adresse, klasse)` — also ausschliesslich
         die Adresse, auf der der Tab GERADE steht. Zwölf Zeilen darüber wurde
         genau dieser Fehler für die Sperrliste bereits behoben
         (`regelnZusammen`), hier blieb er stehen. Gemessen: Matrix enthält nur
         `{SMarTrTrader: {"geizhals.de": ["lesen", "navigieren"]}}`,
         Sitzungsbereich umfasst `geizhals.de` UND `fremd.de`.
         `agentDarf("SMarTrTrader", "https://fremd.de/seite", "navigieren")`
         ist false — trotzdem lief `navigate` von `geizhals.de` nach
         `fremd.de` im Modus `auto` mit `fragen=0` und `erfolg=true` durch,
         und die Antwort enthielt eine vollständige Wahrnehmung von
         `fremd.de`. Der Agent las in einem Befehl eine Seite, für die die
         Matrix ihm nichts erlaubt.

         Ab jetzt gilt dieselbe Zusammenlegung wie bei der Sperrliste:
         erlaubt nur, was auf BEIDEN Wirten erlaubt ist. Eine Freischaltung,
         die der Mensch für den einen Wirt erteilt hat, ist keine für den
         anderen. `back` trägt kein Ziel und kann keines tragen — wohin der
         Verlauf führt, weiss vorher niemand; dort bleibt es bei der Herkunft,
         und `nachDemWechsel` sieht danach noch einmal hin. */
  if (agent) {
    const noetig = cmd === "run_workflow" ? ["workflow", ...befund.klassen] : befund.klassen;
    const zieladresse = cmd === "navigate" ? plan.url : null;
    for (const klasse of noetig) {
      if (await agentDarfBeides(agent, adresse, zieladresse, klasse)) continue;
      return misslungen(id, cmd, "agent_not_permitted",
        `Für ${saeubern(agent, 40)} ist auf dieser Seite nicht freigeschaltet, was dieser Schritt tut.`,
        {
          retryable: false,
          hint: "Den Nutzer bitten, das in den Einstellungen der Erweiterung für diesen Agenten und diese Seite freizuschalten.",
          m: m(),
        });
    }
  }

  /* 9d. Schrittlimit und Schleife (§5). Beide halten an und FRAGEN; keiner von
         beiden beendet die Sitzung. Ein Auftrag, der sich im Kreis dreht, wird
         nicht schneller, wenn man ihn laufen lässt, aber er ist auch kein
         Grund, dem Menschen die Leitung wegzunehmen.

         Sie erzwingen die Frage in JEDEM Modus und hängen ihren Satz an die
         Frage an, statt eine zweite zu stellen: Wer zweimal gefragt wird,
         liest beim zweiten Mal nicht mehr mit. */
  const anhalter = schleifePruefen(tabId, cmd, plan, kopfJetzt, stand, schluessel);

  /* 10. Die Freigabe. Sie steht vor der Ausführung, nicht in ihr.
        Die Frage besteht aus unseren eigenen Worten und dem Satz des Agenten.
        Der Name des Elements ist Text von der Seite — er geht in `quelle`,
        wird abgesetzt angezeigt und nicht vorgelesen. */
  const brauchtFreigabe =
    eintrag.freigabe === "immer" || entscheidung.fragen === true || anhalter !== null;

  if (brauchtFreigabe) {
    /* Wartet dieser Befehl schon länger in der Schlange, als der Relay
       überhaupt auf eine Antwort wartet, ist die Frage sinnlos: Der Mensch
       entschiede über einen Schritt, dessen Ergebnis niemand mehr hört. */
    if (Date.now() - begonnen >= GRENZEN.gesamtfristMs) {
      return misslungen(id, cmd, "settle_timeout",
        "Bis zur Rückfrage war die Zeit schon um.",
        { retryable: true, hint: "Den Schritt noch einmal senden.", m: m() });
    }

    /* Die Bedenkzeit ist Menschenzeit, nicht Maschinenzeit (Befund M3,
       Begründung in befehle.js bei `GRENZEN.bedenkzeitMs`). Sie ist mindestens
       so lang wie dort angegeben — und nie kürzer als das, was die eigene Frist
       des Befehls ohnehin hergäbe. */
    const bedenkzeit = Math.max(
      GRENZEN.bedenkzeitMs,
      frist(eintrag, uhrBeginn) - AUSFUEHRUNG_RESERVE_MS
    );

    /* Was genau geschieht, gehört in die Frage: der Text beim Tippen, die
       Option beim Auswählen, die Adresse beim Wechsel. Alles davon stammt vom
       Agenten, nicht von der besuchten Seite (befehle.js, `frageZusatz`). */
    const zusatz = frageZusatz(cmd, plan);
    /* Warum gefragt wird, gehört in die Frage — aber nur, wenn es einen
       eigenen Grund gibt. „Im Handbetrieb frage ich bei jedem Schritt" hinter
       jede Frage zu hängen, wäre ein Satz, den der Mensch nach dem dritten Mal
       nicht mehr hört, und dann hört er auch den wichtigen nicht mehr.

       Diese Sätze sind UNSERE Worte: Der Klassifizierer nennt in seinem Grund
       nur Wörter aus unseren eigenen Listen, nie den Fremdtext, in dem sie
       standen. Seitentext geht ausschliesslich abgesetzt in `quelle`. */
    const warum = [
      entscheidung.code === "guardrail_blocked" ? entscheidung.grund : "",
      anhalter ? anhalter.satz : "",
    ].filter(Boolean).join(" ");
    const gefragtUm = Date.now();
    const antwort = await freigabeFragen({
      frage: `${eintrag.tut.charAt(0).toUpperCase()}${eintrag.tut.slice(1)}? Der Agent sagt: „${grund}"${zusatz}${warum ? ` ${warum}` : ""}`,
      /* ANZEIGE und nichts sonst: `quelle` steht abgesetzt neben der Frage und
         wird NICHT vorgelesen. Deshalb der gekürzte, von Steuerzeichen
         befreite Name — der ungekürzte ist der Messeingang und war schon in
         Schritt 9b beim Klassifizierer (AUTOMODUS-2). */
      quelle: ziel ? ziel.anzeigename : "",
      cmd,
      id,
      frist: bedenkzeit,
      signal: meinSignal,
    });

    /* Die Zeit, die der Mensch gebraucht hat, bekommt die Maschine zurück.
       Sonst wäre die längere Bedenkzeit nur eine längere Art, `settle_timeout`
       zu sagen: Bei `scroll` (10 s Frist) hätte nach 25 Sekunden Nachdenken
       niemand mehr gescrollt. Gedeckelt auf `GRENZEN.gesamtfristMs`, damit die
       Antwort den Relay noch erreicht — ein Schritt, der stattgefunden hat und
       als nicht stattgefunden gemeldet wird, wäre schlimmer als beides. */
    uhrBeginn += Math.min(
      Date.now() - gefragtUm,
      Math.max(0, GRENZEN.gesamtfristMs - eintrag.frist)
    );

    /* Der Not-Aus, während der Mensch noch überlegt. Er bekommt seine eigene
       Antwort und nicht `user_declined`: Der Mensch hat nicht abgelehnt, die
       Sitzung ist ihm unter der Hand weggezogen worden. */
    if (antwort === "abbruch") {
      return misslungen(id, cmd, "session_beendet",
        "Die Browsersitzung wurde beendet, während ich gefragt habe.", { m: m() });
    }

    if (antwort === "nein") {
      /* Welchen Code eine Ablehnung trägt, hängt davon ab, WER die Frage
         erzwungen hat (§10).

         Stand ein Guardrail dahinter — eine harte Klasse, ein Wirt auf der
         Sperrliste, eine weiche Klasse ohne Freischaltung —, dann ist
         `guardrail_blocked` die Auskunft, die der Agent braucht: Hier hilft
         auch der zehnte Versuch nichts, solange die Einstellung so steht.
         Sonst bleibt es bei `user_declined`: Der Mensch hätte gedurft und
         wollte nicht, und beim nächsten Schritt kann er anders entscheiden.
         Zwei verschiedene Lagen unter einem Code hiessen für den Agenten,
         beide gleich zu behandeln, und eine davon falsch. */
      const code = anhalter ? anhalter.code : entscheidung.code === "guardrail_blocked" ? "guardrail_blocked" : "user_declined";
      protokoll(`Abgelehnt: ${eintrag.tut}`, { cmd, ergebnis: code });
      /* Eine Ablehnung ist eine gültige Antwort und kein Fehler dieser
         Erweiterung. Sie geht als Beobachtung zurück; der Auftrag läuft
         weiter, der Agent plant anders. */
      return misslungen(id, cmd, code,
        code === "user_declined"
          ? "Der Nutzer hat diesen Schritt abgelehnt."
          : `Der Nutzer hat diesen Schritt abgelehnt. ${anhalter ? anhalter.satz : entscheidung.grund}`,
        { hint: "Das ist kein Fehler. Plane anders oder frage den Nutzer, was er stattdessen möchte.", m: m() });
    }
    if (antwort !== "ja") {
      /* Die EINE Stelle, an der entschieden wird, welcher Code fällt
         (Festlegung F4, Befund RUF-1): `grant_required` heißt „gefragt und
         keine Zustimmung bekommen" — auch dann, wenn der Mensch gerufen wurde
         und in der Nachfrist niemand kam. `grant_unreachable` heißt „ich
         konnte niemanden fragen": Die Seitenleiste war zu, UND der Ruf selbst
         hatte keinen Weg (keine Systemmeldung möglich, kein Abzeichen). Code
         und Satz dafür kommen aus `link.js` und nur von dort — eine zweite
         Fassung hier wäre die Doppelfassung, die F4 verbietet. */
      if (antwort === "unzustellbar") {
        protokoll(`Ohne Antwort geblieben: ${eintrag.tut}`, { cmd, ergebnis: link.FREIGABE_UNERREICHBAR });
        return misslungen(id, cmd, link.FREIGABE_UNERREICHBAR, link.FREIGABE_UNERREICHBAR_TEXT, {
          retryable: true,
          hint: "Den Nutzer auf einem anderen Weg bitten, die Seitenleiste zu öffnen, und den Schritt danach noch einmal senden.",
          m: m(),
        });
      }
      protokoll(`Ohne Antwort geblieben: ${eintrag.tut}`, { cmd, ergebnis: "grant_required" });
      const saetze = {
        keine_stelle: "Es war kein Fenster offen, in dem der Nutzer hätte zustimmen können.",
        besetzt: "Der Nutzer beantwortet gerade eine andere Frage.",
        frist: "Der Nutzer hat in der Zeit nicht geantwortet.",
        /* Eigene Lage, eigener Satz (BRUECKE-2): Es war nicht nur niemand da,
           es wurde auch gerufen. Der Agent soll den Unterschied hören, denn
           beim zweiten Versuch stehen die Chancen anders. */
        unerreichbar: "Es sieht gerade niemand zu. Ich habe den Nutzer gerufen, und in der Zeit hat niemand geantwortet.",
      };
      const hinweise = {
        unerreichbar: "Der Nutzer wurde benachrichtigt. Den Schritt in einem Augenblick noch einmal senden, oder den Auftrag zusammenfassen und auf ihn warten.",
      };
      return misslungen(id, cmd, "grant_required", eigen(saetze, antwort) || saetze.frist,
        { retryable: true, hint: eigen(hinweise, antwort) || "Erneut fragen oder den Auftrag zusammenfassen.", m: m() });
    }
  }

  /* 10b. Der Menschentest (§3.1). Ein `captcha` heisst nie „automatisch
          lösen", sondern immer „an den Menschen übergeben" — auch nach einem
          Ja. Der Mensch hat zugestimmt, dass ich ihm zeige, WO es steht; er
          hat nicht zugestimmt, dass ich mich als Mensch ausgebe.

          Zugesagt wird deshalb genau eines: der Zeiger. Danach ist Schluss. */
  if (befund.klassen.includes("captcha")) {
    /* Auch dieser eine Zeiger trägt das Abbruchsignal: Er steht nach der
       Freigabe, und nach dem Not-Aus geht auch er nicht mehr raus (B3). */
    if (ziel) await zeigerZeigen({ tabId, ziel, seitenfrist: () => 2000, abbruch: meinSignal.abbruch });
    else await arbeitsZeigerFahren(tabId, cmd, 2000, meinSignal.abbruch);
    protokoll("Hier steht ein Menschentest. Den löse ich nicht, den übergebe ich dir.",
      { cmd, ergebnis: "guardrail_blocked" });
    return misslungen(id, cmd, "guardrail_blocked",
      "Das ist ein Menschentest. Ich löse ihn nicht, ich zeige dem Nutzer nur, wo er steht.",
      {
        retryable: false,
        hint: "Den Nutzer bitten, den Test selbst zu lösen, und danach weiterarbeiten.",
        m: m(),
      });
  }

  /* 11. Und erst jetzt die Ausführung. */
  if (!aktiv || meineGeneration !== generation) {
    return misslungen(id, cmd, "session_beendet",
      "Die Browsersitzung wurde beendet, während ich gefragt habe.", { m: m() });
  }

  /* 11b. Der Schritt zählt (§5). Gezählt wird, was WIRKLICH geschieht: Ein
          abgelehnter Schritt hat den Auftrag nicht vorangebracht, und die
          Deckel gegen einen Agenten, der nur fragt, stehen schon in Schritt 3.
          Hat der Mensch gerade einem Anhalter zugestimmt, beginnt die Zählung
          neu — sonst stünde die nächste Frage sofort wieder da, und aus einer
          Bremse würde eine Dauerwarnung. */
  await schrittZaehlen(tabId, cmd, plan, kopfJetzt, anhalter !== null);

  /* 12. Die Wache. Schritt 6 hat den Bereich gemessen, BEVOR der Mensch
         gefragt wurde — dazwischen liegt Menschenzeit, und in der kann der Tab
         woanders stehen. Also noch einmal hinsehen, bevor irgendetwas
         geschieht: vor dem Arbeitszeiger, vor der Ausführung, vor dem Bild.
         Der Kopf für die Ausführung entsteht ebenfalls hier, damit Adresse und
         Titel aus derselben Messung stammen wie die Erlaubnis und nicht aus
         einer älteren. */
  const wache = await wacheStellen({ id, cmd, meta: m }, tabId, sitzung, { wirte });
  if (!wache.ok) return wache.absage;
  const kopf = { url: wache.adresse, titel: (wache.tab && wache.tab.title) || "" };

  protokoll(`${eintrag.tut}: ${grund}`, { cmd });

  /*
   * Der Riegel dieses einen Schrittes (Befund vom 14.08.2026, B3 und B4).
   *
   * Er bricht aus zwei Gründen: wenn der Not-Aus kommt, und wenn dieses
   * Rennen zu Ende ist. Der zweite Grund ist der weniger offensichtliche und
   * genauso wichtig: Gewinnt der Wecker, bekommt der Agent `settle_timeout` —
   * und die Ausführung liefe ohne diesen Riegel munter weiter und griffe
   * danach noch in die Seite. Eine Antwort „hat nicht stattgefunden" über
   * einem Schritt, der gerade doch stattfindet, ist die schlimmste Sorte
   * Falschaussage.
   */
  const riegel = riegelBinden(meinSignal);

  /*
   * Das Signal, unter dem die SCHRITTE eines Ablaufs laufen (Befund WFRIST-1
   * vom 15.08.2026). Bis dahin liefen sie am MODUL-Not-Aus-Signal: Der äußere
   * Wecker von `run_workflow` schloss im `finally` nur den äußeren Riegel,
   * und der in-flight-Schritt hing daran gar nicht — gemessen wurde ein
   * `tabs.update`, das NACH der settle_timeout-Antwort noch die Seite
   * wechselte, weil die verspätete Freigabe des Menschen den Schritt noch
   * auslöste. Ein Riegel, an dem die Schritte nicht hängen, kappt nichts.
   *
   * Dieses Signal bricht mit dem äußeren Riegel, also beim Not-Aus UND beim
   * Ablauf der äußeren Uhr — kooperativ, wie der Not-Aus selbst: Die Sitzung
   * bleibt stehen, gekappt wird der Ablauf, nicht die Verbindung.
   */
  let ablaufSignal = null;
  if (cmd === "run_workflow") {
    ablaufSignal = {
      abbruch: riegel.signal,
      versprechen: new Promise((fertig) => {
        if (riegel.signal.aborted) fertig(ABBRUCH);
        else riegel.signal.addEventListener("abort", () => fertig(ABBRUCH), { once: true });
      }),
    };
  }

  const lage = {
    id,
    cmd,
    tabId,
    sitzung,
    kopf,
    ziel,
    plan,
    epoche,
    meta: m,
    /* Was der Ablauf und die Einschleusungswache brauchen: der Modus, der für
       diesen Schritt gilt, die Kennung des Agenten, die Generation dieses
       Laufs und das Not-Aus-Signal. */
    modus,
    agent,
    generation: meineGeneration,
    signal: meinSignal,
    /* Das Signal für die Schritte eines Ablaufs (WFRIST-1): Not-Aus ODER
       äußere Uhr, beides kappt. Nur `run_workflow` trägt es. */
    schrittsignal: ablaufSignal,
    /* Das Abbruchsignal für ALLES, was diesen Schritt verlässt (F1). */
    abbruch: riegel.signal,
    /* Die Wirte, über die der Mensch für diesen Schritt entschieden hat (B2). */
    wirte,
    /* Die Klassen, über die in DIESEM Schritt entschieden wurde. Sie reisen
       bis in `nachDemWechsel`: Eine harte Klasse, über die gefragt wurde, ist
       nach einer Weiterleitung keine Überraschung mehr; eine, die erst dort
       entsteht, sehr wohl (AUTOMODUS-6). */
    klassen: befund.klassen,
    einschleusung: null,
    restfrist: () => Math.max(1000, frist(eintrag, uhrBeginn)),
    /* Für jeden Aufruf an die Seite: dieselbe Restfrist, aber mit Abstand zum
       eigenen Wecker (siehe `SEITEN_RESERVE_MS`). */
    seitenfrist: () => Math.max(1000, frist(eintrag, uhrBeginn) - SEITEN_RESERVE_MS),
  };

  /* Die Uhr wird nach dem Rennen gelöscht. Ein stehengelassener Wecker hält
     den Service Worker am Leben, obwohl längst nichts mehr zu tun ist — und
     bei 25 Sekunden je Befehl summiert sich das zu einer Erweiterung, die nie
     schlafen geht. */
  let wecker = null;
  const uhr = new Promise((fertig) => {
    wecker = setTimeout(() => fertig(null), Math.max(1500, frist(eintrag, uhrBeginn)));
  });
  /*
   * Der Arbeitszeiger steht IM Rennen (Befund vom 14.08.2026, B4).
   *
   * Bis dahin wurde er davor abgewartet — nach dem letzten Riegel und vor dem
   * `Promise.race`. In genau diesem Fenster wirkte der Not-Aus gar nicht:
   * Antwortete die Seite auf `overlay:arbeitszeiger` nicht, erreichte
   * `session_beendet` den Agenten erst nach 42034 ms, und `tabs.update` auf
   * die Zieladresse lief NACH dem Not-Aus. Das betraf jeden einzelnen Befehl,
   * denn diese Zeile steht vor jedem.
   *
   * Die Reihenfolge bleibt, was sie war: erst der Zeiger, dann die Tat. Er
   * kündigt an, er berichtet nicht — und ein abgelehnter Schritt bewegt
   * weiterhin nichts, weil das Ganze nach der Freigabe steht.
   */
  const arbeit = (async () => {
    await arbeitsZeigerFahren(tabId, cmd, lage.seitenfrist(), lage.abbruch);
    if (riegelZu(lage)) return riegelAbsage(lage);
    /* `eigen` und nicht `AUSFUEHRUNG[cmd]`: Über einem Objektliteral fände ein
       Rahmen mit `cmd: "constructor"` eine geerbte Funktion und riefe sie
       (H2 vom 14.08.2026). Dass Schritt 1 und 4 das heute abfangen, ist
       Zufall — und die Stelle, die etwas AUFRUFT, prüft selbst. */
    const weg = eigen(AUSFUEHRUNG, cmd);
    if (typeof weg !== "function") {
      return misslungen(id, cmd, "not_supported",
        `Den Befehl „${saeubern(cmd, 40)}" kann diese Erweiterung nicht.`,
        { hint: `Möglich sind zurzeit: ${Object.keys(BEFEHLE).join(", ")}.`, m: m() });
    }
    return weg(rahmen, lage);
  })();
  /* Ein Läufer, dem niemand mehr zuhört, darf den Dienstarbeiter nicht mit
     einer unbehandelten Ablehnung beenden. */
  arbeit.catch(() => undefined);

  let ergebnis;
  try {
    /* Drei Läufer, drei Enden: die Arbeit, der Wecker und der Not-Aus. Der
       Not-Aus steht IM Rennen, weil er sonst erst wirkte, wenn die Seite
       antwortet — und in den Sekunden bis dahin sieht der Mensch zu, wie
       weitergearbeitet wird (§5). */
    ergebnis = await Promise.race([arbeit, uhr, meinSignal.versprechen]);
  } finally {
    if (wecker) clearTimeout(wecker);
    /* Das Rennen ist entschieden. Wer es verloren hat, hört jetzt auf — das
       ist der Teil, den `Promise.race` von sich aus NICHT tut und der den
       ganzen Befund B3 ausmacht. */
    riegel.schliessen();
  }

  if (ergebnis === ABBRUCH) {
    return misslungen(id, cmd, "session_beendet",
      "Die Browsersitzung wurde mitten im Schritt beendet. Ich arbeite nicht weiter.",
      { m: m() });
  }
  if (ergebnis) return einschleusungAnhaengen(ergebnis, lage);

  /*
   * Die Uhr hat gewonnen — und für einen ABLAUF ist das eine eigene Lage
   * (Befund WFRIST-1 vom 15.08.2026). Der Riegel ist im `finally` schon
   * geschlossen, und die Schritte hängen seit WFRIST-1 wirklich daran; jetzt
   * wird gewartet, bis nichts mehr läuft, und ERST DANN geantwortet. Eine
   * Antwort „hat nicht stattgefunden" über einem Schritt, der noch läuft, ist
   * die schlimmste Sorte Falschaussage (siehe die GRENZEN in befehle.js).
   *
   * Und `retryable` ist die Absage in KEINEM Fall: `run_workflow` beginnt
   * immer bei Schritt 1, einen Wiederaufsetzpunkt gibt es nicht — die
   * Schritte vor dem Ablauf der Uhr haben die Seite womöglich schon
   * verändert, und ein erneuter Versuch wäre eine Doppelausführung, keine
   * Wiederholung. Meldet sich der gekappte Läufer im Nachlauf nicht, gilt
   * erst recht: Solange nicht sicher ist, dass nichts mehr läuft, wird nichts
   * zur Wiederholung eingeladen.
   */
  if (cmd === "run_workflow") {
    const ruhe = await Promise.race([
      arbeit.then(() => true, () => true),
      schlafen(ABLAUF_NACHLAUF_MS),
    ]);
    const steht = ruhe === true;
    return misslungen(id, cmd, "settle_timeout",
      steht
        ? "Der Ablauf hat seine Frist überschritten. Ich habe ihn angehalten; die Schritte davor können die Seite schon verändert haben."
        : "Der Ablauf hat seine Frist überschritten, und ein Schritt hat auf das Anhalten noch nicht geantwortet. Ich kann nicht zusichern, dass nichts mehr läuft.",
      {
        retryable: false,
        hint: "Den Ablauf nicht einfach neu starten, sonst laufen schon erledigte Schritte doppelt. Erst mit einer Wahrnehmung nachsehen, wo die Seite steht, und den Nutzer entscheiden lassen.",
        m: m(),
      });
  }

  /* Unsere Uhr läuft vor der des Relays ab. Damit bekommt der Agent eine
     Aussage statt eines nackten „keine Antwort vom Browser" (spec-01 §3.9). */
  return misslungen(id, cmd, "settle_timeout",
    "Die Seite ist in der Frist nicht fertig geworden.",
    { retryable: true, hint: "Kurz warten und noch einmal versuchen.", m: m() });
}

/*
 * Wie lange nach dem Ablauf der äußeren Uhr auf den gekappten Läufer gewartet
 * wird, bevor geantwortet werden muss (WFRIST-1). Kurz und begründet: Das
 * Kappen ist kooperativ und greift am nächsten `await`, im Regelfall in
 * Millisekunden. Die Grenze existiert nur, damit ein Läufer, der in einer
 * hängenden Browser-API steht, die Antwort an den Relay nicht ganz
 * verschluckt — dann sagt die Absage ehrlich, dass Stille nicht zugesichert
 * werden kann, und lädt NICHT zur Wiederholung ein.
 */
const ABLAUF_NACHLAUF_MS = 1000;

/* Wie lange dieser Befehl insgesamt haben darf — gerechnet ab seinem Eintreffen,
   nicht ab dem Beginn der Ausführung. Wartezeit in der Schlange ist Zeit, die
   der Relay ebenfalls mitzählt. */
function frist(eintrag, begonnen) {
  return eintrag.frist - FRIST_PUFFER_MS - (Date.now() - begonnen);
}

/*
 * Der Rahmen, wie ihn `parameterPruefen` lesen soll.
 *
 * Für zwölf Befehle ist das der Rahmen selbst. Für `run_workflow` steht hier
 * ein Befund vom 14.08.2026, gefunden beim Bauen:
 *
 *   Der Befehlsrahmen trägt `id` als Kennung des AUFTRAGS (DRAHTFORMAT §5.4,
 *   der Relay wartet unter dieser Kennung auf die Antwort). Vertrag §8.2 nennt
 *   den Parameter des Ablaufs ebenfalls `id`. Beide liegen im selben flachen
 *   Rahmen. Wer den Ablauf benennt, überschreibt damit die Kennung, unter der
 *   der Agent auf seine Antwort wartet — und wer es nicht tut, bekommt seine
 *   Auftragskennung gegen `/^wf_[a-z0-9_]{1,40}$/` gehalten und eine Absage.
 *   `run_workflow` wäre so in keiner Fassung aufrufbar.
 *
 * Aufgelöst wird das hier und nicht in befehle.js: Der Name auf dem Draht
 * gehört dem Relay, und die Prüfung dort misst `id`, wie der Vertrag es sagt.
 * Diese Stelle sagt nur, WAS `id` für diesen einen Befehl bedeutet — und nimmt
 * dafür `workflowId`, wenn es dasteht, sonst die Kennung selbst. Beide
 * Lesarten führen zum selben Ablauf; keine erfindet eine Erlaubnis.
 */
function parameterRahmen(cmd, rahmen, id) {
  if (cmd !== "run_workflow" || !rahmen || typeof rahmen !== "object") return rahmen;
  const genannt = typeof rahmen.workflowId === "string" ? rahmen.workflowId.trim() : "";
  if (!genannt) return rahmen;
  /* Die Auftragskennung bleibt unangetastet. Sie ist das Einzige, woran der
     Relay diese Antwort wiedererkennt. */
  return { ...rahmen, id: genannt, auftragskennung: id };
}

/* --------------------------------------------------------------------- *
 * Schrittlimit und Schleife (§5)
 *
 * Bis v3.4 gab es Deckel je Sitzung und je Zeitfenster. Beide zählen Befehle,
 * keiner zählt einen AUFTRAG: Ein Agent, der sich verrannt hatte, durfte 300
 * Schritte lang danebengreifen, solange er langsam genug war.
 *
 * Beide Bremsen hier halten an und FRAGEN. Sie beenden nichts. Der Unterschied
 * ist wichtig: Ein Auftrag, der im Kreis läuft, ist kein Angriff, sondern ein
 * Missverständnis — und ein Missverständnis klärt der Mensch in einem Satz,
 * während ein abgebrochener Auftrag ihn eine halbe Stunde kostet.
 * --------------------------------------------------------------------- */

/**
 * Steht diesem Schritt eine Bremse im Weg?
 *
 * @returns {{code:string, satz:string}|null}
 */
function schleifePruefen(tabId, cmd, plan, kopf, stand, schluessel) {
  const grenze = stand.grenze;
  const gemacht = eigen(stand.schritte, schluessel) || 0;
  if (gemacht >= grenze) {
    return {
      code: "step_limit",
      satz: `Achtung, dieser Auftrag hat schon ${gemacht} Schritte gemacht, mehr als die ${grenze}, die eingestellt sind. Soll ich weitermachen?`,
    };
  }

  const marke = schrittMarke(cmd, plan, kopf, { y: bildlaufStand.get(tabId) || 0 });
  const vorher = marken.get(tabId);
  const wieOft = vorher && vorher.marke === marke ? vorher.wieOft + 1 : 1;
  if (wieOft >= GRENZEN.schleifeGleich) {
    return {
      code: "loop_detected",
      satz: `Achtung, das ist zum ${wieOft}. Mal derselbe Schritt auf demselben Stand der Seite. Das sieht nach einer Schleife aus. Soll ich es trotzdem tun?`,
    };
  }
  return null;
}

/**
 * Den Schritt zählen — und nach einem bestätigten Anhalter neu beginnen.
 *
 * Die Marke wird hier gesetzt und nicht in `schleifePruefen`: Ein Schritt, der
 * an der Freigabe scheitert, hat nicht stattgefunden, und drei abgelehnte
 * Versuche sind keine Schleife, sondern ein Mensch, der dreimal nein sagt.
 */
async function schrittZaehlen(tabId, cmd, plan, kopf, zuruecksetzen) {
  const marke = schrittMarke(cmd, plan, kopf, { y: bildlaufStand.get(tabId) || 0 });
  const vorher = marken.get(tabId);
  const wieOft = !zuruecksetzen && vorher && vorher.marke === marke ? vorher.wieOft + 1 : 1;
  marken.set(tabId, { marke, wieOft });

  const stand = await modusStandLesen();
  const schluessel = String(tabId);
  stand.schritte[schluessel] = zuruecksetzen ? 1 : (eigen(stand.schritte, schluessel) || 0) + 1;
  await modusStandSchreiben(stand);
}

async function tabTitel(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return (tab && tab.title) || "";
  } catch (_) {
    return "";
  }
}

/* Die Einstellung „Große Sichtbarkeit" liegt im lokalen Speicher (Vorgabe an).
   Der Ausführer läuft im Hintergrunddienst und liest sie von dort, damit ein
   nach einer Navigation neu eingespielter Rahmen dieselbe Größe trägt wie der,
   den die Seitenleiste beim Sitzungsstart gesetzt hat. */
async function grosseSichtLesen() {
  try {
    const d = await chrome.storage.local.get("grosseSicht");
    return d.grosseSicht !== false;
  } catch (_) {
    return true;
  }
}
