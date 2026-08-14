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
  textbaumBauen,
  rahmenDeckeln,
  parameterPruefen,
  frageZusatz,
  refPruefen,
  klassenBestimmen,
  freigabeNoetig,
  schrittMarke,
  einschleusungVerdacht,
} from "./befehle.js";
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

function signalNeu() {
  let ausloesen = null;
  const versprechen = new Promise((fertig) => {
    ausloesen = fertig;
  });
  return { versprechen, ausloesen };
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
  return {
    modus: stand.tabs[schluessel] || MODUS_STANDARD,
    schritte: stand.schritte[schluessel] || 0,
    grenze: stand.grenze,
  };
}

/** Der Modus, der wirklich gilt: der kleinere von Browser und Server. */
function modusVerrechnen(lokal, schrittmodus) {
  const l = MODI.includes(lokal) ? lokal : MODUS_STANDARD;
  const s = SERVER_MODUS[schrittmodus] || "manual";
  return MODUS_RANG[s] < MODUS_RANG[l] ? s : l;
}

/*
 * Den Modus in der Seite anzeigen (§6, `overlay:modus`).
 *
 * Die Nachricht trägt genau ein Feld, und in diesem Feld steht eines von drei
 * unserer eigenen Wörter. Nichts von der Seite, nichts vom Agenten, nichts aus
 * der Sitzung — sie geht in eine fremde Seite, und was dorthin geht, kann
 * diese Seite lesen.
 */
async function modusAnDieSeite(tabId, modus, zwingend = false) {
  if (!Number.isInteger(tabId) || !MODI.includes(modus)) return;
  if (!zwingend && gezeigterModus.get(tabId) === modus) return;
  gezeigterModus.set(tabId, modus);
  await anSeite(tabId, { typ: "overlay:modus", modus }, 2000).catch(() => {});
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
  const fragenLauf = chrome.runtime
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

  try {
    const laeufe = [fragenLauf, uhrenLauf];
    if (abbruchLauf) laeufe.push(abbruchLauf);
    return await Promise.race(laeufe);
  } finally {
    if (uhr) clearTimeout(uhr);
    /* Läuft unsere Frist ab, während der Mensch noch überlegt, muss die Karte
       weg — sonst beantwortet er eine Frage, auf die niemand mehr wartet
       (spec-01 §3.6.3, „Verspätete Freigabe"). */
    melden({ typ: "link:freigabe-zurueckziehen", id });
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

/**
 * Noch einmal hinsehen, bevor etwas geschieht.
 *
 * @param {{id:string, cmd:string, meta:Function}} ziel
 * @param {number} tabId
 * @param {object} sitzung
 * @param {{vordergrund?:boolean}} wahl
 * @returns {Promise<{ok:true, tab:object, adresse:string}|{ok:false, absage:object}>}
 */
async function wacheStellen(ziel, tabId, sitzung, { vordergrund = false } = {}) {
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

  return { ok: true, tab, adresse };
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
async function einschleusungMessen(lage, text) {
  if (!lage) return;
  const v = einschleusungVerdacht(text);
  if (!v.verdacht) return;
  /* Nur der erste Treffer zählt. Ein zweiter Fund im selben Schritt wäre
     dieselbe Aussage ein zweites Mal, und der Modus steht dann schon. */
  if (lage.einschleusung) return;
  lage.einschleusung = v.muster;

  if (lage.modus === "auto") {
    lage.modus = "assist";
    const stand = await modusStandLesen();
    stand.tabs[String(lage.tabId)] = "assist";
    await modusStandSchreiben(stand);
    await modusAnDieSeite(lage.tabId, "assist");
  }
  protokoll(
    "Auf dieser Seite steht ein Versuch, mir neue Anweisungen unterzuschieben. Ich frage ab jetzt wieder bei jedem Schritt nach.",
    { cmd: lage.cmd, ergebnis: "injection_suspected" }
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
  const antwort = await anSeite(tabId, { typ: "overlay:baum", offscreen: offscreen === true }, frist);
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
     nächste Schritt die Entscheidungstabelle fragt. */
  await einschleusungMessen(lage, baum.text);
  return {
    ok: true,
    snapshot: {
      epoch: saeubern(roh.epoche, 24),
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
  const wache = await wacheStellen(lage, lage.tabId, lage.sitzung);
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
  const antwort = await anSeite(lage.tabId, { typ: "overlay:zustand" }, lage.seitenfrist());
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
    Math.max(1000, lage.restfrist() - 2000)
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
      beschriftung: ziel.name,
      rect: ziel.rect,
    },
    Math.max(1000, lage.seitenfrist())
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

async function arbeitsZeigerFahren(tabId, cmd, frist) {
  const muster = ARBEITSMUSTER[cmd];
  if (!muster) return;
  await anSeite(tabId, { typ: "overlay:arbeitszeiger", muster }, Math.max(800, frist || 1500))
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
      beschriftung: ziel.name,
      rect: ziel.rect,
    },
    lage.seitenfrist()
  );
  if (!gesetzt.ok) {
    return misslungen(lage.id, lage.cmd, "tab_gone",
      "Ich konnte den Zeiger auf dieser Seite nicht setzen.",
      { retryable: true, m: lage.meta() });
  }
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
  const antwort = await anSeite(
    lage.tabId,
    { typ: "overlay:klicken", ref: ziel.ref, epoche: lage.epoche },
    Math.max(1000, lage.restfrist() - 4000)
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
  await new Promise((r) => setTimeout(r, 600));
  const w = await wahrnehmenGesichert(lage).catch(() => ({ ok: false }));
  const daten = {
    clicked: { ref: ziel.ref, role: saeubern(ziel.rolle, 40), name: saeubern(ziel.name, GRENZEN.nameZeichen) },
  };
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
    Math.max(1000, lage.restfrist() - 4000)
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
    Math.max(1000, lage.restfrist() - 4000)
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
  const wache = await wacheStellen(lage, lage.tabId, lage.sitzung);
  if (!wache.ok) return wache.absage;
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:auslesen",
      refs: plan.refs,
      region: plan.region,
      felder: plan.felder,
      epoche: lage.epoche,
    },
    Math.max(1000, lage.restfrist() - 2000)
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
    wartenMs + 1500
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
    const wache = await wacheStellen(lage, lage.tabId, lage.sitzung, { vordergrund: true });
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
async function tabFertigAbwarten(tabId, fristMs) {
  const ende = Date.now() + Math.max(500, fristMs);
  for (;;) {
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      return { ok: false, fehler: "tab_gone" };
    }
    if (!tab) return { ok: false, fehler: "tab_gone" };
    if (tab.status === undefined || tab.status === "complete") return { ok: true, tab };
    if (Date.now() >= ende) return { ok: false, fehler: "frist", tab };
    await new Promise((r) => setTimeout(r, 150));
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
async function rahmenWiederAnschalten(tabId, overlay) {
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
  }, 2000).catch(() => {});
}

/**
 * Der gemeinsame Nachlauf von `navigate` und `back`.
 *
 * @returns {{ok:true, kopf:object, snapshot:object|null, fertig:boolean}
 *          |{ok:false, code:string, satz:string, hinweis:string|null, retryable:boolean}}
 */
async function nachDemWechsel(lage, fristMs) {
  const fertig = await tabFertigAbwarten(lage.tabId, fristMs);
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

  const overlay = await overlaySicherstellen(lage.tabId);
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
  await rahmenWiederAnschalten(lage.tabId, overlay);

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

/**
 * Eine Ankerkaskade auf der Seite zu einem Element machen (§7.1).
 *
 * Der Weg dorthin ist `overlay:kaskade`; das Inhaltsskript löst gegen seine
 * jüngste Wahrnehmung auf und gibt Referenz UND Epoche zurück. Beides gehört
 * zusammen: Eine Referenz ohne ihre Epoche ist eine Zahl, die auf der nächsten
 * Wahrnehmung etwas anderes bedeutet.
 *
 * @returns {{ok:true, ref:string, epoche:string|null} | {ok:false, fehler:string}}
 */
async function kaskadeAufloesen(lage, kaskade) {
  const antwort = await anSeite(
    lage.tabId,
    { typ: "overlay:kaskade", kaskade },
    Math.max(1000, lage.seitenfrist())
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
  const epoche = typeof antwort.antwort.epoche === "string" ? saeubern(antwort.antwort.epoche, 24) : null;
  return { ok: true, ref, epoche };
}

/** Aus einem geprüften Schritt den Befehlsrahmen bauen, den `einzeln` erwartet. */
async function schrittRahmenBauen(lage, schritt, nr, gesamt) {
  const wf = lage.plan.workflow;
  const cmd = SCHRITT_BEFEHL[schritt.type];
  if (!cmd) {
    return {
      ok: false,
      satz: `Den Schritttyp „${saeubern(schritt.type, 40)}" spielt diese Fassung nicht ab.`,
      hinweis: `Abspielbar sind: ${Object.keys(SCHRITT_BEFEHL).join(", ")}, dazu user_input_required. Den Ablauf in der Werkbank entsprechend aufzeichnen.`,
    };
  }

  const was = schritt.beschreibung || SCHRITT_TEXT[schritt.type] || schritt.type;
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
       einer anderen Prüfung scheitert. */
    if (!aktiv || lage.generation !== generation) {
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
        signal: lage.signal,
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
        innen: gebaut.kaskade ? { code: "kaskade_gebrochen", message: gebaut.fehler } : null,
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

async function einzeln(rahmen, sitzung, { id, cmd, begonnen, meineGeneration, notiz = null }) {
  const tabId = sitzung && Number.isInteger(sitzung.tabId) ? sitzung.tabId : null;
  const m = (zusatz) => meta(begonnen, tabId, zusatz);
  /* Das Not-Aus-Signal, das bei DIESEM Befehl galt. Siehe `laufAbbrechen`. */
  const meinSignal = abbruchSignal;
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
  const eintrag = BEFEHLE[cmd];
  if (!eintrag) {
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

         Ein Rahmen OHNE Kennung läuft weiter. Das ist eine bewusste
         Übergangsentscheidung und keine Nachlässigkeit: Der Relay setzt das
         Feld erst ab v3.5 (§11.2), und ein Client, der ohne es gar nichts mehr
         täte, wäre gegen jede heute laufende Gegenstelle taub. Sobald ein Name
         dasteht, gilt er — und dann gilt auch die Matrix. */
  const agent = typeof (rahmen && rahmen.agent) === "string" ? rahmen.agent.trim() : "";
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
  const overlay = await overlaySicherstellen(tabId);
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
  await rahmenWiederAnschalten(tabId, overlay);

  /* 7b. Der Modus, der wirklich gilt (§2). Er entsteht aus dem, was der Mensch
         am Browser eingestellt hat, und dem, was der Server zulässt — und es
         gilt das Kleinere. Er steht hier, weil der Rahmen gerade sichergestellt
         wurde: Die Seite soll ihn zeigen, sobald sie überhaupt etwas zeigt. */
  const stand = await modusStandLesen();
  const schluessel = String(tabId);
  const modus = modusVerrechnen(stand.tabs[schluessel], sitzung && sitzung.schrittmodus);
  await modusAnDieSeite(tabId, modus);

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
      6000
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
    ziel = {
      ref,
      name: saeubern(nachschlag.antwort.name, GRENZEN.nameZeichen),
      rolle: saeubern(nachschlag.antwort.rolle, 40),
      rect: nachschlag.antwort.rect,
      mitte: nachschlag.antwort.mitte,
      /* Die drei Angaben, aus denen der Klassifizierer die Bauform des Ziels
         liest (§3.1): das HTML-Element, sein `type` und ob sein Formular ein
         Geheimfeld enthält. Sie sind alle freiwillig — antwortet eine ältere
         Fassung des Inhaltsskripts ohne sie, fällt der Befund milder aus und
         nie strenger. Deshalb stehen sie hier und nicht als Bedingung. */
      marke: saeubern(nachschlag.antwort.marke, 20),
      typ: saeubern(nachschlag.antwort.feldtyp, 20),
      formularGeheim: nachschlag.antwort.formularGeheim === true,
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
  const kopfJetzt = { url: adresse, titel: "" };
  const befund = klassenBestimmen(cmd, plan, ziel, kopfJetzt);
  buch.klassen = befund.klassen;
  const regeln = await regelnFuer(adresse);
  const entscheidung = freigabeNoetig(modus, befund, regeln);

  /* 9c. Die Agentenmatrix (§4). Sie steht NACH dem Klassifizierer, weil sie
         die Klassen braucht, und VOR der Frage, weil der Mensch nichts
         bestätigen soll, das die Matrix danach selbst ablehnt.

         Gefragt wird für JEDE Klasse des Schrittes, nicht für die erste: Ein
         Agent, der lesen darf, darf damit nicht auch bezahlen. Voreinstellung
         ist überall `false` — eine Matrix, die im Zweifel erlaubt, ist keine. */
  if (agent) {
    const noetig = cmd === "run_workflow" ? ["workflow", ...befund.klassen] : befund.klassen;
    for (const klasse of noetig) {
      if (await agentDarf(agent, adresse, klasse)) continue;
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
      quelle: ziel ? ziel.name : "",
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
      protokoll(`Ohne Antwort geblieben: ${eintrag.tut}`, { cmd, ergebnis: "grant_required" });
      const saetze = {
        keine_stelle: "Es war kein Fenster offen, in dem der Nutzer hätte zustimmen können.",
        besetzt: "Der Nutzer beantwortet gerade eine andere Frage.",
        frist: "Der Nutzer hat in der Zeit nicht geantwortet.",
      };
      return misslungen(id, cmd, "grant_required", saetze[antwort] || saetze.frist,
        { retryable: true, hint: "Erneut fragen oder den Auftrag zusammenfassen.", m: m() });
    }
  }

  /* 10b. Der Menschentest (§3.1). Ein `captcha` heisst nie „automatisch
          lösen", sondern immer „an den Menschen übergeben" — auch nach einem
          Ja. Der Mensch hat zugestimmt, dass ich ihm zeige, WO es steht; er
          hat nicht zugestimmt, dass ich mich als Mensch ausgebe.

          Zugesagt wird deshalb genau eines: der Zeiger. Danach ist Schluss. */
  if (befund.klassen.includes("captcha")) {
    if (ziel) await zeigerZeigen({ tabId, ziel, seitenfrist: () => 2000 });
    else await arbeitsZeigerFahren(tabId, cmd, 2000);
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
  const wache = await wacheStellen({ id, cmd, meta: m }, tabId, sitzung);
  if (!wache.ok) return wache.absage;
  const kopf = { url: wache.adresse, titel: (wache.tab && wache.tab.title) || "" };

  protokoll(`${eintrag.tut}: ${grund}`, { cmd });

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
  /* Sichtbar machen, dass jetzt gearbeitet wird — bei JEDEM Befehl, nicht nur
     bei denen mit Ziel. Steht nach der Freigabe und vor der Ausführung, genau
     wie der Zielzeiger: Ein abgelehnter Schritt bewegt weiterhin nichts. */
  await arbeitsZeigerFahren(tabId, cmd, lage.seitenfrist());

  let ergebnis;
  try {
    /* Drei Läufer, drei Enden: die Arbeit, der Wecker und der Not-Aus. Der
       Not-Aus steht IM Rennen, weil er sonst erst wirkte, wenn die Seite
       antwortet — und in den Sekunden bis dahin sieht der Mensch zu, wie
       weitergearbeitet wird (§5). */
    ergebnis = await Promise.race([
      AUSFUEHRUNG[cmd](rahmen, lage),
      uhr,
      meinSignal.versprechen,
    ]);
  } finally {
    if (wecker) clearTimeout(wecker);
  }

  if (ergebnis === ABBRUCH) {
    return misslungen(id, cmd, "session_beendet",
      "Die Browsersitzung wurde mitten im Schritt beendet. Ich arbeite nicht weiter.",
      { m: m() });
  }
  if (ergebnis) return einschleusungAnhaengen(ergebnis, lage);

  /* Unsere Uhr läuft vor der des Relays ab. Damit bekommt der Agent eine
     Aussage statt eines nackten „keine Antwort vom Browser" (spec-01 §3.9). */
  return misslungen(id, cmd, "settle_timeout",
    "Die Seite ist in der Frist nicht fertig geworden.",
    { retryable: true, hint: "Kurz warten und noch einmal versuchen.", m: m() });
}

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
  const gemacht = stand.schritte[schluessel] || 0;
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
  stand.schritte[schluessel] = zuruecksetzen ? 1 : (stand.schritte[schluessel] || 0) + 1;
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
