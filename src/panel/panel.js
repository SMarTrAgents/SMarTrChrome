/*
 * SMarTrChrome Beta — Seitenleiste.
 *
 * Hier lebt die Bedienung der Sitzung. Die Sitzung selbst hängt seit dem
 * Netzumbau am Service Worker (src/net/link.js) — sonst wäre sie weg, sobald
 * der Nutzer die Seitenleiste schließt. Was hier steht, ist die Anzeige und
 * der Weg dorthin: Anmeldung, Kennwort, Freigabe, Verbindung.
 *
 * Drei Regeln, die im Code sichtbar bleiben müssen:
 *  - Gesprochen wird nur, was der Nutzer im Menü eingestellt hat. Nichts läuft
 *    von allein los. Die Live-Region für Screenreader wird trotzdem immer gefüllt.
 *  - Text von fremden Seiten wird nie in eine Frage eingebaut und nie vorgelesen.
 *    Er steht abgesetzt daneben, gekürzt und von Steuerzeichen befreit.
 *  - Stufe, Dauer und Bereich der laufenden Sitzung kommen vom Server, nicht
 *    aus diesem Dialog. Was hier gewählt wird, ist ein Vorschlag; entschieden
 *    wird auf der Freigabeseite in der echten Cloud.
 */

import * as konto from "../net/konto.js";
import * as ticket from "../net/ticket.js";
import * as rechte from "../net/rechte.js";
import * as chat from "../net/chat.js";
import { CLOUD_URSPRUNG, anfragen } from "../net/dienste.js";
import { MODI, MODUS_STANDARD } from "../net/befehle.js";
import * as startseite from "./startseite.js";
import * as werkbank from "./werkbank.js";
import {
  SPERRE,
  FREIGABE_ABGELEHNT,
  AUSWEIS_FEHLT,
  GUTHABEN_LAGETEXT,
  MODUS_TEXT,
  MODUS_RIEGEL,
  NOTBREMSE_SAETZE,
  TAB_LISTE,
  /* Die Sprachschicht aus panel/sprache.js, durchgereicht — die Begruendung
     steht im Kopf von erklaerungen.js. */
  t,
  sprechsprache,
  spracheAnwenden,
  textEinsetzen,
} from "./erklaerungen.js";

const $ = (id) => document.getElementById(id);
const app = $("app");

/* Derselbe Satz an zwei Stellen (Aufbau und Chat). Er stand zweimal wörtlich
   da; mit Katalog wären das zwei Schlüssel für eine Aussage gewesen. */
const DIENST_STUMM = t(
  "fehler_dienst_stumm",
  "Der Hintergrunddienst der Erweiterung hat nicht geantwortet. Das liegt an der Erweiterung, nicht an dir. Starte Chrome neu, dann geht es wieder.",
);

/* Zweimal derselbe Satz: beim Abbrechen des Dialogs und beim Abbrechen der
   Anmeldekarte ohne laufende Sitzung. */
const ABGEBROCHEN_OHNE_VERBINDUNG = t(
  "dialog_abgebrochen",
  "Abgebrochen. Es wurde keine Verbindung aufgebaut.",
);

/* ------------------------------------------------------------------ *
 * Sprache (Vertrag §12)
 *
 * Der Katalog wird hier WIRKLICH benutzt und nicht nur mitgeliefert: Diese
 * drei Aufrufe stehen im Produktivweg, ganz am Anfang, noch vor dem ersten
 * setzeZustand. Was sie tun:
 *
 *  1. `spracheAnwenden` setzt `<html lang>` auf die Sprache, die WIRKLICH
 *     ankommt, und löst jedes `data-i18n` in panel.html auf.
 *  2. `merkmaleUebersetzen` holt nach, was nicht als `data-i18n-attr` im HTML
 *     stehen kann: Prüfsatz I1 (A-PANEL) misst jeden Wert von `data-i18n…`
 *     gegen `^[a-z][a-z0-9_]*$`, und die Form `aria-label:schluessel` aus §12
 *     fällt dort durch. Bis das gelöst ist, stehen diese Merkmale hier.
 *  3. `zusatztexteUebersetzen` deckt die eine Stelle ab, an der ein Prüfsatz
 *     das Element ohne jedes Merkmal verlangt.
 *
 * Ohne diese drei Zeilen wäre der ganze Katalog eine grüne Prüfung über
 * Funktionen, die niemand ruft. Das ist der Befund vom 11.08.2026.
 * ------------------------------------------------------------------ */

/** [Kennung, Merkmal, Schlüssel, deutsche Fassung] */
const MERKMALSTEXTE = [
  ["neu", "aria-label", "kopf_neues_gespraech", "Neues Gespräch"],
  ["neu", "title", "kopf_neues_gespraech", "Neues Gespräch"],
  ["menue-knopf", "aria-label", "kopf_menue", "Menü"],
  ["menue-knopf", "title", "kopf_menue", "Menü"],
  ["menue", "aria-label", "kopf_menue", "Menü"],
  ["stufe-wahl", "aria-label", "dialog_stufe_gruppe", "Was der Agent darf"],
  ["dauer-wahl", "aria-label", "dialog_dauer_gruppe", "Dauer der Verbindung"],
  ["verlauf", "aria-label", "kopf_verlauf_marke", "Gespräch mit Niemand"],
  ["chat-modus", "aria-label", "chat_modus_gruppe", "Antwortmodus"],
  ["vorlesen-knopf", "aria-label", "kopf_vorlesen_knopf", "Letzte Antwort vorlesen"],
  ["vorlesen-knopf", "title", "kopf_vorlesen_knopf", "Letzte Antwort vorlesen"],
  ["senden", "aria-label", "kopf_senden", "Senden"],
  ["senden", "title", "kopf_senden", "Senden"],
];

function merkmaleUebersetzen() {
  for (const [kennung, merkmal, schluessel, deutsch] of MERKMALSTEXTE) {
    const el = $(kennung);
    if (el) el.setAttribute(merkmal, t(schluessel, deutsch));
  }
}

/*
 * Der fett gesetzte Halbsatz im Geltungsbereich.
 *
 * Er trägt kein `data-i18n`, weil der Prüfsatz „Stufe und Dauer sind echte
 * Auswahlen" (A-PANEL) `<strong>Nur dieser eine Tab</strong>` ohne jedes
 * Merkmal misst. Übersetzt wird er trotzdem, nur eben von hier.
 */
function zusatztexteUebersetzen() {
  const stark = document.querySelector("#dialog-mehr .geltung strong");
  if (stark) stark.textContent = t("dialog_geltung_stark", "Nur dieser eine Tab");
}

spracheAnwenden(document);
merkmaleUebersetzen();
zusatztexteUebersetzen();

const zustand = {
  tabId: null,
  ursprung: null,
  ursprungMuster: null,
  sitzung: null, // { stufe, bereich, modus, endetUm, ticker, code, vorfuehrung }
  /*
   * Die Marke des Verbindungsaufbaus, der GERADE unterwegs ist, sonst null.
   *
   * Befund Abnahme 14.08.2026 (ZZ13): Bis dahin gab es diesen Zustand nicht.
   * Der Riegel gegen einen zweiten Anlauf fragte allein nach `zustand.sitzung`,
   * und die entsteht erst ganz am Ende von sitzungAnzeigen(). Zwischen Klick
   * und Sitzung lag damit ein Fenster von mehreren hundert Millisekunden, in
   * dem die Seitenleiste sichtbar nichts tat und jeder weitere Klick einen
   * zweiten Lauf startete. Wer arbeitet, steht ab jetzt hier drin, und zwar
   * noch vor dem ersten await.
   */
  aufbau: null,
  freigabeLaeuft: null,
  abgebrochen: false,
  grosseSicht: true,
  vorlesen: "sicher", // aus | sicher | alles — Vorgabe Inhaber 27.07.: nur wichtige Ansagen
  /* Der Antwortmodus des Gesprächs: "normal" (Normal Mode) oder "smartr"
     (SMarTrMode). Er reist als model_id im Netz-Body (net/chat.js) — hier
     steht nur der Produktname, nie ein Modellname. */
  chatModus: "normal",
  letzteRede: "",
  ausweis: null, // nur Ausweis, nie Befugnis
  abbruch: null, // AbortController für den laufenden Freigabeweg
  freigabeAdresse: null,
  chatKontext: null, // context_id des laufenden Gesprächs
  chatLaeuft: false, // eine Frage ist unterwegs, die Antwort noch nicht da
  /* Wem die unterwegs befindliche Frage gehört — "browser" oder "gespraech".
     Befund Inhaber 29.07.: Beim Beenden der Sitzung muss der Browser-Auftrag
     mitsterben, ein gewöhnliches Gespräch aber nicht. Ohne diese Angabe wäre
     beides dasselbe, und der Stopp träfe die falsche Frage. */
  chatLaeuftFuer: null,
  browserKontext: null, // context_id des Browser-Auftrags (G4-Bindung), solange die Sitzung läuft
  wunsch: null, // der Antrag der laufenden Sitzung — Grundlage der Verlängerung
  verlaengerungLaeuft: false,
  /* Die zuletzt getroffene Wahl im Verbindungsdialog. Die Seitenleiste wird
     bei jedem Schließen abgeräumt und neu gebaut; ohne diese beiden Werte
     stand die Wahl danach still wieder auf 10 Minuten und Zusehen. Wer 60
     Minuten wählte, die Leiste zumachte und wieder aufmachte, beantragte
     unbemerkt wieder 10 — genau der Verdacht aus dem 05.08.-Befund, den keine
     Spur ausschließen konnte. */
  wahlDauer: null,
  wahlStufe: null,
  /*
   * Der Betriebsmodus dieses Tabs (Vertrag §2). Er gilt JE TAB und stirbt mit
   * dem Browser; die Wahrheit dazu liegt im Hintergrunddienst
   * (chrome.storage.session, Schlüssel sa_modus). Was hier steht, ist die
   * Anzeige davon. Voreinstellung ist MODUS_STANDARD und nicht die stärkste
   * Stufe: Ein Modus, an den sich niemand erinnert, wäre eine Vollmacht.
   */
  modus: MODUS_STANDARD,
  /*
   * Der Tab, mit dem der eine Klick verbinden würde, und die übrigen offenen
   * Tabs. Beides steht VOR dem Klick fest, und das ist keine Bequemlichkeit:
   * `chrome.permissions.request` verlangt eine Nutzergeste, und die ist nach
   * dem ersten await verbraucht (siehe seitenrechteHolen). Wer den Tab erst im
   * Klick nachschlägt, hat sie schon verloren.
   */
  aktuellerTab: null,
  tabs: [],
  /* Der Tab, dem die laufende Sitzung gehört — für die Statuskarte. Er kann
     ein anderer sein als der gerade aktive: Die Sitzung überlebt einen
     Tabwechsel, die Karte muss trotzdem den richtigen Titel zeigen. */
  verbundenerTab: null,
  /* Der Agent der laufenden Cloud-Sitzung (Vertrag §8.4), oder null. */
  cloudAgent: null,
};

/* ------------------------------------------------------------------ *
 * Fokusfuehrung
 *
 * Vorlesen ist der Haupt-Bedienweg des Inhabers. Wo der Fokus nach einem
 * Wechsel steht, entscheidet deshalb darüber, ob er überhaupt erfährt, dass
 * sich etwas geändert hat: Fällt der Fokus auf `body`, sagt der Vorleser
 * nichts, der Mensch merkt nichts, und er muss sich mit der Tabulatortaste neu
 * durch die ganze Leiste arbeiten. Genau das war der Befund vom 10.08.2026.
 *
 * Jede Stelle, die etwas Neues zeigt, trifft hier deshalb eine bewusste
 * Entscheidung, wohin er wandert. Zwei Regeln gelten dabei überall:
 *
 *  - Wer tippt, behält den Fokus. Ihn mitten im Satz aus dem Eingabefeld zu
 *    reißen, wäre schlimmer als eine Karte, die ungelesen bleibt: Die Karte
 *    steht auch in der Ansagezone, der halbe Satz ist weg.
 *  - Ein verstecktes oder abgeschaltetes Ziel bekommt ihn nie. Es zu
 *    fokussieren hieße, ihn auf `body` fallen zu lassen, also genau der
 *    Fehler, den diese Stelle verhindert.
 * ------------------------------------------------------------------ */

/* Was der Browser von sich aus anspringt. Alles andere braucht tabindex="-1",
   sonst nimmt focus() es gar nicht erst an. */
const VON_SELBST_ANSPRINGBAR = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

function anspringbarMachen(el) {
  if (VON_SELBST_ANSPRINGBAR.has(String(el.tagName || "").toUpperCase())) return;
  /* -1 heißt: mit der Tabulatortaste NICHT erreichbar, mit focus() sehr wohl.
     Ein Knopf bekommt das nie, sonst nähme man ihn aus der Tabulatorreihe.
     Ein vorhandener Wert wird nicht überschrieben — er stünde in der Seite und
     hätte dort einen Grund. */
  if (el.getAttribute("tabindex") === null) el.setAttribute("tabindex", "-1");
}

/* Tippt gerade jemand? Dann gehört der Fokus ihm und keiner Karte. */
const jemandTippt = () => document.activeElement === $("eingabe");

/* Liegt der Fokus auf nichts, also faktisch auf `body`? Das ist die Lage, in
   der der Vorleser stumm bleibt. */
function fokusIstLos() {
  const a = document.activeElement;
  return !a || a === document.body || a.hidden === true || a.disabled === true;
}

/**
 * Den Fokus setzen — und ehrlich zurückmelden, ob er wirklich gewandert ist.
 * @returns {boolean}
 */
function fokusHin(el) {
  if (!el || el.hidden || el.disabled || typeof el.focus !== "function") return false;
  if (jemandTippt()) return false;
  anspringbarMachen(el);
  el.focus();
  return document.activeElement === el;
}

/* Die Überschrift einer Karte ist das bessere Ziel als die Karte selbst: Der
   Vorleser sagt damit zuerst, WO man gelandet ist, und der Rest der Karte
   liegt danach in Leserichtung. Hat eine Karte keine Überschrift, bekommt sie
   selbst den Fokus. */
function ueberschriftVon(el) {
  if (!el) return null;
  const h = typeof el.querySelector === "function" ? el.querySelector("h2") : null;
  return h || el;
}

/*
 * Wohin der Fokus nach einem Zustandswechsel gehört.
 *
 * Als Funktionen und nicht als Kennungen, weil zwei der Ziele von der Lage
 * abhängen: Der Weg zur Verbindung ist zugedeckt, solange eine Sitzung noch
 * Rechte hält (setzeZustand), und ein zugedecktes Ziel wäre wieder `body`.
 */
const FOKUS_NACH_ZUSTAND = {
  dialog: () => $("dialog"),
  anmeldung: () => $("anmeldung"),
  kennwort: () => $("kennwort"),
  erklaerung: () => $("erklaerkarte"),
  /* Die Sitzungsleiste trägt Stufe, Restzeit und den Stopp-Knopf. Wer gerade
     eine Steuerung eingeschaltet hat, soll genau das zuerst hören — und die
     Notbremse liegt danach einen Tabulatorschritt entfernt. */
  aktiv: () => $("sitzungsleiste"),
  /* Im Ruhezustand ist die Karte weg, an der der Mensch eben stand: Abbrechen,
     Zurück und Stopp verschwinden mit ihr. Der nächste Schritt ist der Weg zur
     Verbindung, also steht der Fokus dort — seit 0.5.3 auf dem Knopf, der
     wirklich verbindet, und nicht mehr auf dem Weg in den Dialog. */
  bereit: () => ($("verbindungsleiste").hidden ? null : $("verbinden-tab")),
  werkbank: () => $("werkbank"),
  buch: () => $("buch"),
};

function fokusNachZustand(name) {
  const suchen = FOKUS_NACH_ZUSTAND[name];
  const ziel = typeof suchen === "function" ? suchen() : null;
  return ziel ? fokusHin(ueberschriftVon(ziel)) : false;
}

/* ------------------------------------------------------------------ *
 * Bildschirmzustand — ein Dokument, kein Bildschirmwechsel.
 * ------------------------------------------------------------------ */

/* Was zuletzt gezeigt wurde. Nur ein echter WECHSEL rührt den Fokus an: Beim
   ersten Aufbau der Leiste wird er nicht angefasst (niemand hat um sie
   gebeten), und ein zweiter Aufruf mit demselben Namen ist kein Wechsel,
   sondern ein Nachziehen der Sichtbarkeiten. */
let zuletztGezeigt = null;

function setzeZustand(name) {
  const wechsel = zuletztGezeigt !== null && zuletztGezeigt !== name;
  zuletztGezeigt = name;
  app.dataset.state = name;
  /* Das Gespräch hängt NICHT an der Browser-Sitzung: Sobald Blasen da sind,
     bleibt der Verlauf auch im Ruhezustand sichtbar — der Leerzustand weicht
     ihm dann. Nur die Karten (Dialog, Anmeldung, Kennwort) verdrängen ihn. */
  const blasen = $("verlauf").childElementCount > 0;
  $("leer").hidden = name !== "bereit" || blasen;
  $("dialog").hidden = name !== "dialog";
  $("anmeldung").hidden = name !== "anmeldung";
  $("kennwort").hidden = name !== "kennwort";
  $("erklaerkarte").hidden = name !== "erklaerung";
  $("werkbank").hidden = name !== "werkbank";
  $("buch").hidden = name !== "buch";
  $("verlauf").hidden = !(name === "aktiv" || (name === "bereit" && blasen));
  /*
   * Der Not-Aus verschwindet nie.
   *
   * Bis 0.5.2 hing diese Leiste allein am Zustand `aktiv`. Jede Karte, die
   * während einer laufenden Sitzung erscheinen kann — die Kennwortkarte bei
   * der Selbsterneuerung, die Erklärkarte, die Anmeldung — nahm dem Menschen
   * damit den Stopp-Knopf weg, während der Agent seine Rechte auf dem Tab
   * behielt. Die Bedingung fragt deshalb nicht mehr nach dem Bildschirm,
   * sondern danach, ob wirklich etwas läuft (Vertrag §5).
   */
  $("sitzungsleiste").hidden = !(name === "aktiv" || !!zustand.sitzung);
  /* Die Statuskarte des verbundenen Tabs teilt die Lebensdauer der Sitzung,
     nicht die eines Bildschirms — aus demselben Grund. */
  $("tabkarte").hidden = !zustand.sitzung;
  /* Der Weg zur Verbindung steht nur im Ruhezustand offen, und nur solange
     KEINE Sitzung läuft. Die zweite Bedingung ist keine Zierde: Ohne sie böte
     das Panel in der Lage „Ausweis verfallen, Sitzung läuft weiter" einen
     zweiten Verbindungsaufbau an, während die erste noch Rechte auf dem Tab
     hält. Bei laufender Sitzung führt der Weg über Stopp, nicht über einen
     zweiten Antrag. */
  $("verbindungsleiste").hidden = name !== "bereit" || !!zustand.sitzung;
  /*
   * Die Startseite trägt zwei Dinge: die Statuskarte der laufenden Sitzung
   * (samt „Am Werk:", Vertrag §8.4) und die Liste der übrigen Tabs.
   *
   * Befund Abnahme 14.08.2026 (M7): Hier stand `name !== "bereit" ||
   * !!zustand.sitzung`, und damit war die Karte genau dann zugedeckt, wenn sie
   * etwas zu sagen hatte. Der ganze Zweig `verbunden=true` in startseite.js war
   * gemessen und nie zu sehen, also der Befund vom 11.08.2026 in neuer Gestalt.
   * Sie bleibt jetzt auch bei laufender Sitzung stehen; die Tabliste darin
   * räumt startseite.js selbst weg, weil der Weg dann über Stopp führt und
   * nicht über einen zweiten Antrag.
   */
  $("startseite").hidden = !(name === "bereit" || name === "aktiv");
  /* Der Beispielauftrag wohnte bis 0.4.0 in #leer und war damit nie zu sehen:
     sitzungAnzeigen() blendet ihn ein und schaltet unmittelbar danach auf
     `aktiv`, wo #leer verschwindet. Jetzt steht er neben der Sitzungsleiste
     und teilt deren Lebensdauer — er zeigt auf den Tab, auf dem gerade
     wirklich gearbeitet werden darf, und ergibt ohne Sitzung keinen Sinn. */
  $("vorschlag").hidden = name !== "aktiv";
  /* Die Vorführung gehört zur Störung, nicht zum Zustand: Sie erscheint nach
     einem Fehlversuch (aufbauAbbrechen) und geht mit der Störungszeile wieder
     weg (stoerung(null)). Hier wird sie nur zugedeckt, solange eine echte
     Sitzung läuft — zwei Angebote nebeneinander wären eine Einladung, die
     laufende Steuerung mit einer Attrappe zu verwechseln. */
  if (name === "aktiv") $("vorfuehrung").hidden = true;
  $("menue-beenden").hidden = name !== "aktiv";
  if (name !== "aktiv") $("protokoll-box").hidden = true;
  zustandChipSetzen();
  /* Der Fokus ganz zum Schluss: Vorher ist die neue Karte noch versteckt, und
     ein verstecktes Element kann ihn nicht halten. */
  if (wechsel) fokusNachZustand(name);
}

function zustandChipSetzen() {
  const s = zustand.sitzung;
  if (s) {
    const etikett = STUFENTEXT[s.stufe]?.etikett || t("kopf_stufe_read", "Nur zusehen");
    $("zustand-text").textContent = s.vorfuehrung
      ? t("kopf_zustand_vorfuehrung", "Vorführung · $1", etikett)
      : t("kopf_zustand_aktiv", "Aktiv · $1", etikett);
    return;
  }
  if (app.dataset.state === "kennwort") {
    $("zustand-text").textContent = t("kopf_zustand_warte", "Warte auf deine Freigabe");
    return;
  }
  /*
   * Zwischen Klick und Sitzung steht hier, dass gearbeitet wird.
   *
   * Befund Abnahme 14.08.2026 (H3, ZZ11): Mit einem Dienstarbeiter, der 300 ms
   * braucht, also dem MV3-Regelfall Kaltstart, waren 50 ms nach dem Klick Chip,
   * Knopf, Karten und Störungszeile unverändert. Die einzige Meldung ging nach
   * `#ansage`, und das ist per panel.css auf ein Pixel geklippt, also
   * ausschließlich für den Bildschirmleser da. Wer sieht, sah nichts, drückte
   * noch einmal, und genau daraus wurde B8.
   *
   * Derselbe Satz wie die Ansage in verbinden(): Es ist dieselbe Aussage über
   * denselben Augenblick, und zwei Schlüssel dafür liefen beim ersten
   * Redigieren auseinander.
   */
  if (zustand.aufbau !== null) {
    $("zustand-text").textContent = t("dialog_verbinde", "Ich stelle die Verbindung her …");
    return;
  }
  /* Befund Inhaber 29.07.: „Nicht verbunden" stand auch dann da, wenn Konto
     und Guthaben längst verbunden waren — der Chip sprach nur über die
     Steuersitzung und verschwieg die Anmeldung. Jetzt benennt er beide Lagen:
     Wer angemeldet ist, liest das auch. */
  $("zustand-text").textContent = zustand.ausweis
    ? t("kopf_zustand_angemeldet", "Angemeldet · bereit")
    : t("kopf_nicht_verbunden", "Nicht verbunden");
}

/*
 * Störungen stehen sichtbar da und werden zusätzlich gesprochen. Ein Fehler,
 * den nur die Stimme kennt, ist für einen abgeschalteten Ton dasselbe wie kein
 * Fehler.
 *
 * Gesprochen wird über `merkenUndSprechen` und nicht über `ansagen`, und das
 * ist der Unterschied zwischen einmal und zweimal: `#stoerung` trägt selbst
 * `role="alert"`, ist also bereits eine Vorlesezone, und zwar die dringlichste
 * im ganzen Dokument. Derselbe Satz zusätzlich in `#ansage` hieße, dass der
 * Bildschirmleser ihn zweimal liest, einmal als Alarm und einmal als
 * Statusmeldung. Genau dieser Fund ist bei den Sprechblasen schon einmal
 * ausgebaut worden (siehe merkenUndSprechen). Die eigene Sprachausgabe und der
 * 🔊-Knopf (`zustand.letzteRede`) arbeiten unverändert weiter.
 */
function stoerung(text) {
  const p = $("stoerung");
  if (!text) {
    p.textContent = "";
    p.hidden = true;
    /* Die Vorführung ist der Ausweg aus GENAU dieser Störung. Ist die Störung
       weg, ist auch ihr Ausweg gegenstandslos. Seit sie nicht mehr in #leer
       wohnt, deckt sie niemand mehr zu — also muss sie hier selbst gehen. */
    $("vorfuehrung").hidden = true;
    return;
  }
  p.textContent = text;
  p.hidden = false;
  merkenUndSprechen(text, true);
}

/*
 * Die Erklärkarte — für alles, was kein Fehler ist.
 *
 * Der Befund vom 28.07.2026: Der Inhaber drückte auf einem gesperrten
 * Ursprung „Verbinden" und bekam eine rote Meldung, die klang, als hätte er
 * etwas falsch gemacht. Er hatte nichts falsch gemacht — die Erweiterung
 * arbeitet dort aus Absicht nicht (DRAHTFORMAT §7.3). Eine Regel gehört nicht
 * in die Störungszeile: `stoerung()` trägt `role="alert"` und ist rot, und ein
 * Alarm für eine Absicht ist eine Falschaussage über den eigenen Zustand.
 *
 * Vorgelesen wird immer (dringend), weil der Hauptbedienweg des Inhabers das
 * Vorlesen ist — eine Erklärung, die nur auf dem Bildschirm steht, hat ihn
 * nicht erreicht.
 *
 * @param {{titel:string, text:string, knopf?:string}} erklaerung
 * @param {null|(()=>void)} tun  Was der Hauptknopf auslöst; ohne ihn erscheint
 *                               nur „Zurück".
 */
let erklaerAktion = null;

function erklaerkarteZeigen(erklaerung, tun = null) {
  $("erklaer-titel").textContent = erklaerung.titel;
  $("erklaer-text").textContent = erklaerung.text;
  const knopf = $("erklaer-tun");
  erklaerAktion = typeof tun === "function" ? tun : null;
  if (erklaerAktion && erklaerung.knopf) {
    knopf.textContent = erklaerung.knopf;
    knopf.hidden = false;
  } else {
    knopf.textContent = "";
    knopf.hidden = true;
  }
  stoerung(null);
  setzeZustand("erklaerung");
  ansagen(`${erklaerung.titel}. ${erklaerung.text}`, true);
}

/* ------------------------------------------------------------------ *
 * Ansage: Bildschirm und Screenreader immer, Stimme nur auf Wunsch.
 * ------------------------------------------------------------------ */

function sprich(text) {
  try {
    speechSynthesis.cancel();
    const s = new SpeechSynthesisUtterance(text);
    /* Bis 0.5.3 stand hier fest "de-DE". Eine englische Oberflaeche waere
       damit von einer deutschen Stimme buchstabiert worden, und Vorlesen ist
       der Haupt-Bedienweg des Inhabers (Befund 09.08.2026). */
    s.lang = sprechsprache();
    s.rate = 1.0;
    speechSynthesis.speak(s);
  } catch (_) {
    /* Ohne Stimme funktioniert alles Übrige weiter. */
  }
}

function ansagen(text, dringend = false) {
  $("ansage").textContent = text;
  zustand.letzteRede = text;
  if (zustand.vorlesen === "alles" || (zustand.vorlesen === "sicher" && dringend)) {
    sprich(text);
  }
}

/*
 * Wie `ansagen`, aber ohne die Ansagezone zu beschreiben.
 *
 * Für Texte, die schon als Blase im Verlauf stehen. `#verlauf` trägt selbst
 * `aria-live="polite"`, `#ansage` ebenso: Derselbe Satz in beiden Zonen wurde
 * dem Bildschirmleser zweimal vorgelesen, einmal als Blase und einmal als
 * Statusmeldung. Die eigene Sprachausgabe (`sprich`) und der Vorlesen-Knopf
 * (`zustand.letzteRede`) arbeiten unverändert weiter, nur die zweite
 * Vorlesezone bleibt still.
 */
function merkenUndSprechen(text, dringend = false) {
  zustand.letzteRede = text;
  if (zustand.vorlesen === "alles" || (zustand.vorlesen === "sicher" && dringend)) {
    sprich(text);
  }
}

/*
 * Das Eingabefeld sagt, wohin die nächste Frage geht.
 *
 * Ist die Sitzung an den Agenten gebunden, landet sie beim Agenten, der genau
 * diesen Tab bedient — sonst im gewöhnlichen Gespräch. Das ist ein Unterschied,
 * den der Mensch vorher nirgends sehen konnte. Der Platzhalter ist die Stelle,
 * an der er ihn liest, bevor er tippt (und an der ihn der Bildschirmleser
 * beim Betreten des Feldes vorliest).
 */
/* Die beiden Saetze stehen als blanke Zeichenketten da und nicht schon als
   `t(...)`: panel.html traegt denselben Platzhalter, und ein Pruefsatz haelt
   beide woertlich gegeneinander. Uebersetzt wird deshalb erst beim Setzen. */
const PLATZHALTER_GESPRAECH = "Schreib Niemand, was du brauchst …";
const PLATZHALTER_TAB = "Sag Niemand, was er in diesem Tab tun soll …";

function eingabePlatzhalterSetzen() {
  const gebunden = !!(zustand.sitzung && !zustand.sitzung.vorfuehrung && zustand.browserKontext);
  $("eingabe").placeholder = gebunden
    ? t("kopf_platzhalter_tab", PLATZHALTER_TAB)
    : t("kopf_platzhalter_gespraech", PLATZHALTER_GESPRAECH);
}

function sagen(wer, text) {
  const b = document.createElement("div");
  b.className = `blase ${wer === "niemand" ? "niemand" : "du"}`;
  b.textContent = text;
  $("verlauf").appendChild(b);
  /* Die erste Blase im Ruhezustand löst den Leerzustand ab. */
  if (app.dataset.state === "bereit") {
    $("leer").hidden = true;
    $("verlauf").hidden = false;
  }
  b.scrollIntoView({ block: "nearest" });
  if (wer === "niemand") zustand.letzteRede = text;
}

/* Zwei Ziffern, damit die Uhrzeit im Protokoll untereinander steht und nicht
   springt. */
const zwei = (n) => String(n).padStart(2, "0");

/*
 * Der Zeitstempel einer Protokollzeile.
 *
 * `zeit` kommt nach Vertrag §6 als Millisekunden seit der Epoche mit — vom
 * Ausführer, also von der Stelle, die den Schritt wirklich getan hat. Fehlt
 * sie oder ist sie unbrauchbar, gilt der Augenblick des Eintragens. Geraten
 * wird nichts: Eine Zeile ohne Uhrzeit wäre im Nachhinein nicht mehr
 * einzuordnen, und genau dafür gibt es das Protokoll.
 */
function zeitStempel(roh) {
  const ms = Number(roh);
  const wann = new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now());
  return {
    /* Für Maschinen und für den Bildschirmleser, der `datetime` vorliest. */
    iso: wann.toISOString(),
    kurz: `${zwei(wann.getHours())}:${zwei(wann.getMinutes())}:${zwei(wann.getSeconds())}`,
  };
}

/*
 * Eine Zeile im Live-Protokoll.
 *
 * Seit v3.5 nimmt sie `{ text, cmd, zeit, ergebnis }` (Vertrag §6). `text`
 * bleibt Pflicht, und eine blanke Zeichenkette wird weiterhin angenommen: Der
 * Bestand ruft diese Stelle an einem Dutzend Orten so auf, und eine
 * Umstellung, die dort still Zeilen verschluckt, wäre schlimmer als das
 * fehlende Feld.
 *
 * `cmd` und `ergebnis` stehen als Merkmale am Element und nicht im Satz: Der
 * Satz ist das, was vorgelesen wird, und „Erledigt: click, ok" sagt einem
 * Menschen nichts, was „Erledigt: click" nicht schon sagt. Für das Auge und
 * für eine spätere Auswertung sind sie trotzdem da.
 */
function protokollieren(eintrag) {
  const daten = typeof eintrag === "string" ? { text: eintrag } : eintrag || {};
  const text = String(daten.text || "");
  if (!text) return;
  const li = document.createElement("li");

  const zeit = zeitStempel(daten.zeit);
  const uhr = document.createElement("time");
  uhr.className = "protokoll-zeit";
  uhr.setAttribute("datetime", zeit.iso);
  uhr.textContent = zeit.kurz;
  li.appendChild(uhr);
  li.append(" ");

  if (daten.cmd) li.setAttribute("data-cmd", zitat(daten.cmd, 40));
  if (daten.ergebnis) li.setAttribute("data-ergebnis", zitat(daten.ergebnis, 40));

  const trenner = text.indexOf(":");
  if (trenner > 0) {
    const kopf = document.createElement("strong");
    kopf.textContent = text.slice(0, trenner);
    li.append(kopf, text.slice(trenner));
  } else {
    li.append(text);
  }
  $("protokoll").appendChild(li);
  $("protokoll-box").hidden = false;
  li.scrollIntoView({ block: "nearest" });
}

/* Fremdtext von der besuchten Seite: kürzen, Steuerzeichen raus, nie in einen
   Satz einbauen und nie sprechen. */
function zitat(roh, grenze = 60) {
  const s = String(roh || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > grenze ? `${s.slice(0, grenze)}…` : s;
}

/* ------------------------------------------------------------------ *
 * Guthaben (GT) — echt, vom Gateway (GET /api/v1/user/tokens).
 *
 * Hier wird nur angezeigt. Abgerechnet wird beim Server; ein lokaler
 * Rechenweg würde zwangsläufig von der Wahrheit abweichen und hätte
 * genau die Preisdrift wieder, die die Demo hatte. Nach jeder fertigen
 * Agentenantwort wird der Stand neu geholt.
 * ------------------------------------------------------------------ */

const KNAPP_AB = 2000;

let guthaben = null; // null = noch nicht geladen oder nicht angemeldet

/* Warum es keine Zahl gibt — „laedt" | „uebergabe_fehlt" | „keine_anmeldung".
   Ein Strich stünde für alle drei Lagen und erklärte keine davon (Befund
   Inhaber 28.07.: „Guthaben: —" ohne jeden Hinweis). */
let guthabenLage = "laedt";

const gt = (n) => n.toLocaleString("de-DE");

function guthabenAnzeigen() {
  const el = $("guthaben");
  if (guthaben === null) {
    el.textContent = GUTHABEN_LAGETEXT[guthabenLage] || GUTHABEN_LAGETEXT.laedt;
    el.removeAttribute("data-stand");
    return;
  }
  const stand = guthaben <= 0 ? "leer" : guthaben < KNAPP_AB ? "knapp" : "ok";
  el.textContent = t("kopf_guthaben", "Guthaben: $1 GT", gt(guthaben));
  el.setAttribute("data-stand", stand);
}

/*
 * Ist ein Cloud-Tab offen?
 *
 * Das ist der einzige Unterschied, den die Erweiterung ehrlich feststellen
 * kann: Ob jemand angemeldet ist, weiß nur die Cloud-Seite — in ihren
 * Ursprung hineinzusehen ist der Erweiterung verboten (DRAHTFORMAT §7.3).
 * `chrome.tabs.query` sieht nur, DASS ein Tab dieser Adresse offen ist; das
 * genügt, um „nicht angemeldet" von „angemeldet, Übergabe fehlt" zu trennen.
 */
async function cloudTabFinden() {
  try {
    const tabs = await chrome.tabs.query({ url: `${CLOUD_URSPRUNG}/*` });
    return (Array.isArray(tabs) && tabs[0]) || null;
  } catch (_) {
    return null;
  }
}

/*
 * Kein Ausweis — und was das für den Menschen bedeutet.
 *
 * Der Befund vom 28.07.2026: Die Cloud-Seite reicht den Ausweis genau einmal
 * beim Seitenaufbau herüber. Wer die Erweiterung installiert, WÄHREND der
 * Cloud-Tab schon offen ist, bekommt deshalb nie einen — angemeldet ist er
 * trotzdem. Die Seitenleiste zeigte dafür bisher einen Strich; das ist keine
 * Auskunft, sondern das Verschweigen einer.
 *
 * Ein Neuladen des Cloud-Tabs löst genau diesen Fall auf. `chrome.tabs.reload`
 * braucht dafür kein Skriptrecht — es lädt die Seite, es liest sie nicht.
 */
async function ausweisFehltErklaeren() {
  const tab = await cloudTabFinden();
  guthabenLage = tab ? "uebergabe_fehlt" : "keine_anmeldung";
  guthabenAnzeigen();
  const erklaerung = AUSWEIS_FEHLT[guthabenLage];

  /* Eine laufende Sitzung und ein offener Freigabeschritt werden nie
     überblendet: Wer gerade steuert, braucht Restzeit und Stopp-Knopf. Dann
     steht dieselbe Erklärung in der Zeile statt in der Karte — verschwiegen
     wird sie nie. */
  if (zustand.sitzung || app.dataset.state === "kennwort" || app.dataset.state === "dialog") {
    stoerung(erklaerung.text);
    return;
  }

  if (!tab) {
    /* Wirklich keine Anmeldung in Sicht — dafür gibt es die Anmeldekarte mit
       dem Weg zur echten Anmeldeseite. */
    setzeZustand("anmeldung");
    ansagen(erklaerung.text, true);
    return;
  }
  erklaerkarteZeigen(erklaerung, () => cloudTabNeuLaden(tab.id));
}

async function cloudTabNeuLaden(tabId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.tabs.reload(tabId);
    ansagen(
      t("ausweis_neuladen", "Ich lade den SMarTrAgents-Tab neu. Sobald er da ist, habe ich deine Anmeldung."),
      true
    );
  } catch (_) {
    stoerung(
      t("fehler_neuladen", "Ich konnte den SMarTrAgents-Tab nicht neu laden. Wechsle bitte selbst dorthin und drücke F5.")
    );
  }
}

async function guthabenLaden() {
  const ausweis = zustand.ausweis || (await konto.ausweisBesorgen());
  if (!ausweis) {
    guthaben = null;
    /* Auch ohne Erklärkarte bekommt die Guthabenzeile ihren Grund — sie sagt
       dann, WORAN es liegt, statt einen Strich zu zeigen. */
    await ausweisFehltErklaeren();
    return;
  }
  zustand.ausweis = ausweis;
  zustandChipSetzen();
  guthabenLage = "laedt";
  const vorher = guthaben;
  try {
    const stand = await chat.guthabenHolen(ausweis.token);
    guthaben = stand.balance;
  } catch (_) {
    /* Der alte Stand bleibt stehen; eine geratene Zahl wäre schlimmer als
       eine kurz veraltete. */
    return;
  }
  guthabenAnzeigen();
  if (vorher !== null && vorher >= KNAPP_AB && guthaben < KNAPP_AB && guthaben > 0) {
    ansagen(t("kopf_guthaben_knapp", "Achtung, dein Guthaben wird knapp: noch $1 GT.", gt(guthaben)), true);
  }
  if (vorher !== 0 && guthaben === 0) {
    ansagen(t("kopf_guthaben_leer", "Dein Guthaben ist aufgebraucht. In der Cloud kannst du aufladen."), true);
  }
}

/* Die Einstellungen liegen weiter im lokalen Speicher — sie sind keine
   Kontodaten, sondern Bedienung dieses Geräts. */
async function einstellungenLaden() {
  try {
    const d = await chrome.storage.local.get([
      "vorlesen",
      "grosseSicht",
      "chatModus",
      "wahlDauer",
      "wahlStufe",
    ]);
    if (["aus", "sicher", "alles"].includes(d.vorlesen)) zustand.vorlesen = d.vorlesen;
    if (typeof d.grosseSicht === "boolean") zustand.grosseSicht = d.grosseSicht;
    /* Nur die zwei gebauten Modi kommen zurück — alles andere bleibt beim
       Normal Mode (fail-closed, wie bei den Dialogwahlen darunter). */
    if (["normal", "smartr"].includes(d.chatModus)) zustand.chatModus = d.chatModus;
    /* Hier wird nur GEMERKT, nicht geprüft. Ob der Wert überhaupt angeboten
       wird, entscheidet auswahlSetzen() am wirklichen Dialog — an dieser
       Stelle steht der noch gar nicht. */
    if (typeof d.wahlDauer === "string") zustand.wahlDauer = d.wahlDauer;
    if (typeof d.wahlStufe === "string") zustand.wahlStufe = d.wahlStufe;
  } catch (_) {
    /* Vorgaben bleiben stehen. */
  }
  menueSpiegeln();
  chatModusSpiegeln();
  /*
   * Die gemerkte Wahl steht ab jetzt schon VOR dem Dialog in den Feldern.
   *
   * Befund Abnahme 14.08.2026 (M8): Der eine Klick beantragt die gemerkte
   * Stufe, bis hin zu Vollzugriff, und die Startseite sagte nirgends welche.
   * Sie zu nennen, ohne sie herzustellen, hieße sie zweimal zu lesen — und
   * zwei Lesarten derselben Ablage sind zwei Wahrheiten, von denen der Mensch
   * die eine liest und die andere bekommt. Also gilt: EINE Herstellung
   * (auswahlHerstellen), und Anzeige wie Antrag lesen danach dieselben Felder.
   */
  auswahlHerstellen();
  verbindenStufeZeigen();
}

/* ------------------------------------------------------------------ *
 * Menü
 * ------------------------------------------------------------------ */

function menueSpiegeln() {
  for (const b of document.querySelectorAll("[data-vorlesen]")) {
    b.setAttribute("aria-checked", String(b.dataset.vorlesen === zustand.vorlesen));
  }
  $("menue-sicht").setAttribute("aria-checked", String(zustand.grosseSicht));
}

function menueOeffnen(offen) {
  /* Beim Schließen den Fokus zurückgeben, BEVOR das Menü versteckt wird: Der
     Fokus stand noch in einem Punkt darin, und ein verstecktes Element kann
     ihn nicht halten. Er fiel damit auf `body`, und wer mit Tastatur oder
     Bildschirmleser arbeitet, stand danach am Seitenanfang statt am Knopf, den
     er gerade gedrückt hatte. */
  if (!offen && $("menue").contains(document.activeElement)) $("menue-knopf").focus();
  $("menue").hidden = !offen;
  $("menue-knopf").setAttribute("aria-expanded", String(offen));
  if (offen) $("menue").querySelector(".menue-punkt")?.focus();
}

/* ------------------------------------------------------------------ *
 * Tab und Ursprung
 * ------------------------------------------------------------------ */

async function aktiverTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function ursprungAus(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return { ursprung: u.origin, muster: `${u.origin}/*` };
  } catch (_) {
    return null;
  }
}

/* Der Host einer Adresse, für die Anzeige. Leer heißt: nichts, was ein Mensch
   als Adresse lesen könnte — dann steht dort auch nichts. */
function hostWort(url) {
  try {
    return new URL(String(url || "")).host;
  } catch (_) {
    return "";
  }
}

/* Wie ein Tab in der Liste und in der Statuskarte heißt. Titel kommen von
   fremden Seiten und gehen deshalb durch `zitat` — sie werden nie in einen
   Satz eingebaut und nie vorgelesen. */
const tabWort = (tab) => zitat(tab && (tab.title || tab.url), 60) || hostWort(tab && tab.url);

/* ------------------------------------------------------------------ *
 * Die offenen Tabs — Grundlage des einen Klicks und der Tab-Liste
 *
 * Beides braucht dieselbe Auskunft, und beides braucht sie VOR dem Klick:
 * `chrome.permissions.request` verlangt eine Nutzergeste, und die ist nach dem
 * ersten await verbraucht. Deshalb wird der Bestand hier gepflegt und im Klick
 * nur noch gelesen.
 * ------------------------------------------------------------------ */

let tabsLaufen = false;
let tabsNochmal = false;

async function tabsAuffrischen() {
  /* Ein Lauf zur Zeit. Chrome feuert onUpdated je Tab mehrfach, und drei
     gleichzeitige Abfragen lieferten drei Listen, von denen die letzte
     gewinnt — nicht die neueste.
     Verworfen wird ein Ereignis trotzdem nie: Trifft eines ein, während ein
     Lauf unterwegs ist, wird nachgeholt. Ohne dieses Nachholen bliebe der
     aktuelle Tab veraltet, und der eine Klick verbände mit dem Tab von
     vorhin — mit dem, den der Mensch gerade NICHT ansieht. */
  if (tabsLaufen) {
    tabsNochmal = true;
    return;
  }
  tabsLaufen = true;
  try {
    let alle = [];
    let aktiv = null;
    try {
      alle = await chrome.tabs.query({});
      const [einer] = await chrome.tabs.query({ active: true, currentWindow: true });
      aktiv = einer || null;
    } catch (_) {
      /* Ohne Auskunft bleibt der letzte Stand stehen; eine geleerte Liste
         sähe aus wie „kein Tab offen" und wäre eine Falschaussage. */
      return;
    }
    const vorher = zustand.aktuellerTab ? zustand.aktuellerTab.id : null;
    zustand.tabs = Array.isArray(alle) ? alle : [];
    if (aktiv) zustand.aktuellerTab = aktiv;
    if (zustand.sitzung && Number.isInteger(zustand.tabId)) {
      const gefunden = zustand.tabs.find((t) => t && t.id === zustand.tabId);
      if (gefunden) zustand.verbundenerTab = gefunden;
    }
    verbindungswegZeichnen();
    /* Der Modus gilt je Tab. Wechselt der Tab, gilt der Modus des neuen — und
       nicht der, der zufällig noch angezeigt wurde. Nur beim WECHSEL, sonst
       liefe bei jedem Ladefortschritt eine Frage an den Dienst. */
    const jetzt = zustand.aktuellerTab ? zustand.aktuellerTab.id : null;
    if (jetzt !== vorher) await modusHolen();
  } finally {
    tabsLaufen = false;
  }
  if (tabsNochmal) {
    tabsNochmal = false;
    await tabsAuffrischen();
  }
}

/*
 * Welche Tabs überhaupt zur Auswahl stehen.
 *
 * Die Sperre steht in net/rechte.js und wird hier BENUTZT, nicht wiederholt:
 * Eine zweite Hostliste in der Oberfläche liefe genau dann auseinander, wenn
 * es darauf ankommt (DRAHTFORMAT §7.3). Was dort gesperrt ist — die eigene
 * Freigabeseite, das Gateway, der Relay, alles, was keine gewöhnliche Webseite
 * ist —, erscheint hier gar nicht erst. Ein Ziel anzubieten, das garantiert
 * scheitert, ist keine Auswahl, sondern eine Falle (Befund 28.07.2026).
 */
function waehlbareTabs() {
  return zustand.tabs.filter((t) => t && typeof t.url === "string" && !rechte.sperrgrund(t.url));
}

/* Der Verbindungsweg oben: Hinweiszeile, beantragte Stufe, Statuskarte,
   Tab-Liste. */
function verbindungswegZeichnen() {
  verbindenHinweisSetzen();
  verbindenStufeZeigen();
  verbindenKnoepfeSpiegeln();
  tabkarteZeichnen();
  startseiteZeichnen();
}

function verbindenHinweisSetzen() {
  /* Läuft gerade ein Aufbau, gehört diese Zeile ihm: Sie sagt dann, dass
     verbunden wird (aufbauSpiegeln). Ein Tabwechsel während des Aufbaus darf
     diese Auskunft nicht überschreiben. */
  if (zustand.aufbau !== null) return;
  const t = zustand.aktuellerTab;
  const name = t ? tabWort(t) : "";
  /* Ohne lesbaren Tab bleibt der allgemeine Satz aus panel.html stehen. Ein
     leerer Hinweis neben einem Knopf, der „diesen Tab" sagt, wäre die Frage,
     welchen. */
  if (name) $("verbinden-hinweis").textContent = name;
}

function tabkarteZeichnen() {
  const t = zustand.verbundenerTab || (zustand.sitzung ? zustand.aktuellerTab : null);
  if (!t) {
    /* Kein Tab in der Hand, aber eine Sitzung: Dann steht wenigstens die
       Adresse da, für die der Mensch freigegeben hat. Eine leere Karte neben
       einem grünen Punkt behauptete eine Verbindung mit nichts. */
    const ursprung = zustand.ursprung || "";
    $("tabkarte-titel").textContent = hostWort(ursprung) || ursprung;
    $("tabkarte-adresse").textContent = "";
    $("tabkarte-bild").hidden = true;
    $("tabkarte-glyph").hidden = false;
    return;
  }
  $("tabkarte-titel").textContent = tabWort(t);
  $("tabkarte-adresse").textContent = hostWort(t.url);
  const bild = $("tabkarte-bild");
  const glyph = $("tabkarte-glyph");
  /* Ein Favicon ist ein Bild von einer fremden Seite. Es wird angezeigt, nie
     ausgewertet; fehlt es, steht das Ersatzzeichen da statt einer Lücke. */
  const symbol = typeof t.favIconUrl === "string" && /^https?:\/\//.test(t.favIconUrl) ? t.favIconUrl : "";
  if (symbol) {
    bild.setAttribute("src", symbol);
    bild.hidden = false;
    glyph.hidden = true;
  } else {
    bild.removeAttribute("src");
    bild.hidden = true;
    glyph.hidden = false;
  }
}

/*
 * Die Anker, in die A-WERKBANK ihre Ansichten baut (Vertrag §1).
 *
 * Der Griff wird gemerkt: Jede dieser Ansichten raeumt beim Aufbau ihren Anker
 * leer, und ein zweiter Aufbau bei jedem Oeffnen wuerfe den Stand weg, an dem
 * der Mensch gerade arbeitet.
 */
const anker = { startseite: null, werkbank: null, matrix: null, buch: null };

/**
 * Eine fremde Ansicht in einen Anker bauen — und ehrlich zurueckmelden, ob es
 * geklappt hat.
 *
 * Fehlt die Funktion, wirft sie oder sagt sie selbst `ok:false`, kommt `null`
 * zurueck und die Seitenleiste zeichnet ihre eigene, schlichte Fassung. Ein
 * leerer Anker waere ein Weg ohne Antwort: Der Mensch saehe eine Ueberschrift
 * und darunter nichts und wuesste nicht, ob es laedt, leer ist oder fehlt.
 */
function ankerBauen(name, zeichner, wurzel, dienste) {
  if (anker[name]) return anker[name];
  if (typeof zeichner !== "function" || !wurzel) return null;
  try {
    const griff = zeichner(wurzel, dienste);
    if (griff && griff.ok === false) return null;
    anker[name] = griff || { ok: true };
    /* Was das fremde Modul eben gebaut hat, bekommt hier seine Sprache: Nur
       ueber diesen Aufruf erreicht `data-i18n-attr` ueberhaupt einen Knoten,
       denn in panel.html darf die Form nicht stehen (siehe Sprachblock). */
    textEinsetzen(wurzel);
    return anker[name];
  } catch (_) {
    return null;
  }
}

/*
 * Die Tab-Liste zeichnen.
 *
 * Gezeichnet wird sie von src/panel/startseite.js. Sie holt sich die Tabs
 * ueber `tabsHolen` und meldet eine Wahl ueber `verbinden` zurueck — beides
 * ohne Abwarten davor, damit die Nutzergeste bis zur Chrome-Abfrage haelt
 * (siehe tabVerbindenMit).
 */
function startseiteZeichnen() {
  const liste = waehlbareTabs();
  const griff = ankerBauen("startseite", startseite.aufbauen, $("startseite"), {
    tabsHolen: () => waehlbareTabs(),
    verbinden: (tab) => tabVerbindenMit(tab),
    trennen: () => beenden("nutzer"),
  });
  if (griff) {
    if (typeof griff.tabsZeigen === "function") griff.tabsZeigen(liste);
    if (typeof griff.standSetzen === "function") {
      griff.standSetzen({
        verbunden: !!zustand.sitzung,
        tab: zustand.verbundenerTab || zustand.aktuellerTab,
        agent: zustand.cloudAgent || "",
      });
    }
    return "modul";
  }
  tabListeSelbstZeichnen($("startseite-liste"), {
    tabs: liste,
    aktuellerTabId: zustand.aktuellerTab ? zustand.aktuellerTab.id : null,
    aufWaehlen: (tab) => tabVerbindenMit(tab),
  });
  return "ersatz";
}

function tabListeSelbstZeichnen(wurzel, angaben) {
  wurzel.replaceChildren();
  if (!angaben.tabs.length) {
    const p = document.createElement("p");
    p.className = "hinweis";
    p.textContent = TAB_LISTE.leer.text;
    wurzel.appendChild(p);
    return;
  }
  for (const t of angaben.tabs) {
    const knopf = document.createElement("button");
    knopf.className = "tabzeile";
    knopf.setAttribute("type", "button");
    const worte = document.createElement("span");
    worte.className = "tabzeile-worte";
    const titel = document.createElement("span");
    titel.className = "tabzeile-titel";
    titel.textContent = tabWort(t);
    const adresse = document.createElement("span");
    adresse.className = "tabzeile-adresse";
    adresse.textContent = hostWort(t.url);
    worte.append(titel, adresse);
    knopf.appendChild(worte);
    knopf.addEventListener("click", () => angaben.aufWaehlen(t));
    wurzel.appendChild(knopf);
  }
}

/* ------------------------------------------------------------------ *
 * Verbindungsdialog
 * ------------------------------------------------------------------ */

const gewaehlt = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;

/* Erlaubt sind ausschließlich schlichte Wörter und Zahlen. Der Wert stammt aus
   dem lokalen Speicher und wandert in einen Selektor — er wird deshalb nicht
   entschärft, sondern abgelehnt, wenn er nicht harmlos ist. */
const HARMLOSER_WERT = /^[a-z0-9]{1,16}$/;

/*
 * Eine gemerkte Wahl im Dialog wiederherstellen — fail-closed in drei Stufen:
 * unsauberer Wert, unbekannter Wert, nicht mehr angebotener Wert führen alle
 * zum selben Ergebnis, nämlich zur Vorgabe aus panel.html. Die ist die
 * schwächste Stufe und die kürzeste Dauer, und das soll sie bleiben.
 */
function auswahlSetzen(name, wert) {
  if (typeof wert !== "string" || !HARMLOSER_WERT.test(wert)) return false;
  const feld = document.querySelector(`input[name="${name}"][value="${wert}"]`);
  if (!feld) return false;
  feld.checked = true;
  return true;
}

function auswahlHerstellen() {
  auswahlSetzen("dauer", zustand.wahlDauer);
  auswahlSetzen("stufe", zustand.wahlStufe);
}

/*
 * Die Wahl überdauert das Schließen der Seitenleiste.
 *
 * Was das NICHT ist: eine stille Rechteerweiterung. Der Dialog erscheint
 * weiterhin bei jedem Aufbau, die Vorauswahl steht sichtbar da, die
 * Zusammenfassung liest sie vor, und jeder einzelne Befehl wird danach
 * trotzdem einzeln freigegeben. Gemerkt wird eine Voreinstellung, bewilligt
 * wird nach wie vor je Schritt.
 */
async function auswahlMerken() {
  try {
    await chrome.storage.local.set({
      wahlDauer: gewaehlt("dauer") || null,
      wahlStufe: gewaehlt("stufe") || null,
    });
  } catch (_) {
    /* Für diese Sitzung gilt die Wahl trotzdem; nur das Gedächtnis fehlt. */
  }
}

/* Dieselben Schlüssel wie die drei Knöpfe im Dialog: Es ist derselbe Text am
   selben Schalter, und zwei Schlüssel dafür wären zwei Fassungen. */
const DAUERTEXT = {
  600: t("dialog_dauer_600", "10 Minuten"),
  1800: t("dialog_dauer_1800", "30 Minuten"),
  3600: t("dialog_dauer_3600", "60 Minuten"),
};

/* Für Zeitspannen, die NICHT aus der Knopfreihe stammen: was der Server
   tatsächlich bewilligt hat, und die Leerlauffrist aus dem Schein. Beides kann
   jeder Wert sein, DAUERTEXT deckt nur die vier wählbaren ab. */
function zeitWort(sekunden) {
  const s = Math.max(0, Math.round(Number(sekunden) || 0));
  if (s < 60) return t("zeit_sekunden", "$1 Sekunden", s);
  const min = Math.round(s / 60);
  return min === 1 ? t("zeit_eine_minute", "eine Minute") : t("zeit_minuten", "$1 Minuten", min);
}

/* Was die gewählte Stufe im Klartext bedeutet. */
const STUFENTEXT = {
  read: {
    etikett: t("kopf_stufe_read", "Nur zusehen"),
    tut: t("dialog_stufe_read_tut", "zusehen und dir Dinge zeigen"),
    ansage: t("dialog_stufe_read_ansage", "Er schaut nur zu."),
  },
  write: {
    etikett: t("kopf_stufe_write", "Bedienen"),
    tut: t("dialog_stufe_write_tut", "für dich klicken, tippen und ausfüllen"),
    ansage: t("dialog_stufe_write_ansage", "Er darf für dich klicken und tippen. Anmelden machst du selbst."),
  },
  voll: {
    etikett: t("kopf_stufe_voll", "Vollzugriff"),
    tut: t("dialog_stufe_voll_tut", "für dich klicken, tippen und selbständig weiterarbeiten"),
    ansage: t("dialog_stufe_voll_ansage", "Er arbeitet selbständig weiter und fragt nicht bei jedem Schritt. Anmelden machst du selbst."),
  },
};

/*
 * „Vollzugriff" ist die Wahl des Menschen, nicht eine dritte Stufe auf der
 * Leitung.
 *
 * Auf der Leitung gibt es read, write und full. Was `full` dort zusätzlich
 * freigäbe, sind ausschließlich `eval`, `terminal` und `maintenance` — Befehle,
 * die diese Erweiterung gar nicht kennt und auch nicht bekommen darf: Ein
 * `eval` würde vom Server geliefertes JavaScript auf der Kundenseite ausführen,
 * das verbietet Manifest V3, und es machte die besuchte Seite zur Befehlsquelle.
 * Die Stufe `full` wäre hier also entweder wirkungslos oder gefährlich.
 *
 * Was der Inhaber mit „Vollzugriff" meint, ist etwas anderes und Sinnvolles:
 * bedienen dürfen UND nicht bei jedem Schritt gefragt werden. Genau das ist
 * diese Wahl — Stufe `write` auf der Leitung, Schrittmodus `auto`. Sie ist
 * doppelt gesichert: Der Mensch muss sie ausdrücklich wählen, und die
 * Gegenstelle muss den Selbständig-Modus überhaupt erlauben, sonst fällt die
 * Sitzung dort auf Einzelfreigabe zurück und die Seitenleiste sagt es an.
 */
const VOLL = "voll";
const stufeAufDerLeitung = (wahl) => (wahl === VOLL ? "write" : wahl === "write" ? "write" : "read");
const schrittmodusAus = (wahl) => (wahl === VOLL ? "auto" : "confirm_each");

/*
 * Stufe und Dauer sind seit dem 29.07.2026 wieder echte Auswahlen.
 *
 * Beide Stufen sind durchgängig gebaut: Der Ausführer beherrscht click und
 * type, der Server bewilligt beide Stufen als Sitzungsfreigabe (E16).
 *
 * Zur Dauer stand hier bis 0.4.1 der Satz, der Server gewähre die gewünschte
 * Dauer bis 60 Minuten, der Dialog verspreche also nichts, was gekürzt werde.
 * Ein solcher Satz ist ein Versprechen im Namen einer Gegenstelle, die diese
 * Seitenleiste nicht kennt, und kann jederzeit stillschweigend unwahr werden.
 *
 * Trotzdem steht er nicht zurück, und das ist Absicht. Die Seitenleiste läuft
 * im Browser des Kunden und kann nicht wissen, welche Fassung auf dem Server
 * gerade antwortet. Statt einer Zusage, die stillschweigend rotten kann, misst
 * sitzungAnzeigen() den Unterschied zwischen Wunsch und Bewilligung und sagt
 * ihn an. Eine Messung veraltet nicht.
 *
 * „Unbegrenzt" ist keine Serversitzung ohne Ende — die gibt es weiterhin
 * nicht (link.js nimmt sie nicht einmal an). Es heißt: Die Erweiterung
 * erneuert die Freigabe kurz vor Ablauf selbst, mit demselben Weg, den auch
 * der erste Aufbau geht. Das ist die Entscheidung des Menschen im Dialog,
 * nicht ein stilles Wiederverbinden nach dem Tod der Sitzung.
 */
const VERLAENGERN_AB_SEKUNDEN = 75;
const VERLAENGERUNGS_DAUER = 3600;

const gewaehlteStufe = () => {
  const w = gewaehlt("stufe");
  return w === "write" || w === VOLL ? w : "read";
};
const gewaehlteDauer = () => {
  const wert = gewaehlt("dauer");
  if (wert === "unbegrenzt") return { sekunden: VERLAENGERUNGS_DAUER, unbegrenzt: true };
  const s = Number(wert) || 600;
  return { sekunden: Math.min(3600, Math.max(60, s)), unbegrenzt: false };
};

const stufeText = () => STUFENTEXT[gewaehlteStufe()] || STUFENTEXT.read;

/*
 * Welche Stufe der eine Klick beantragen WÜRDE — sichtbar, bevor er gedrückt
 * wird.
 *
 * Befund Abnahme 14.08.2026 (M8): „Mit diesem Tab verbinden" beantragte die
 * zuletzt gemerkte Stufe, bis hin zu Vollzugriff, und vor dem Klick stand
 * nirgends, welche das ist. Wer einmal Vollzugriff gewählt hatte, bekam ihn
 * danach mit einem Klick wieder, ohne es zu lesen.
 *
 * Der Satz wird aus STUFENTEXT gebaut und nicht neu getextet: Etikett und
 * Vorbehalt sind dieselben Worte wie im Dialog. Damit gilt hier dieselbe Regel
 * wie dort (Prüfsatz S4): Das Etikett verspricht nichts, was nicht gilt — der
 * Halbsatz „Anmelden machst du selbst" reist mit, weil er zur Stufe gehört und
 * nicht zum Dialog.
 */
function verbindenStufeZeigen() {
  const st = STUFENTEXT[gewaehlteStufe()] || STUFENTEXT.read;
  $("verbinden-stufe").textContent = `${st.etikett}. ${st.ansage}`;
}

/*
 * Was der Dialog zusammenfasst, ist ein ANTRAG und keine Zusage.
 *
 * Bis 0.4.1 stand hier „Der Agent darf 30 Minuten lang …". Das ist ein
 * Versprechen im Namen einer Gegenstelle, die diese Seitenleiste nicht kennt,
 * und kann jederzeit stillschweigend unwahr werden.
 *
 * Der Vorbehalt ist bewusst NICHT als fester Satz über eine Kürzung gebaut.
 * Ein fest verdrahtetes „wird gekürzt" wäre genauso ein Versprechen im Namen
 * des Servers und ebenso zerbrechlich, nur mit umgekehrtem Vorzeichen. Statt eine
 * Behauptung durch eine andere zu ersetzen, sagt der Dialog, was er tut
 * (beantragen), und verweist auf die Stelle, die WIRKLICH nachsieht:
 * sitzungAnzeigen() vergleicht Wunsch und Bewilligung und sagt jede Abweichung
 * an, in beide Richtungen und ohne Vorannahme über die Serverfassung.
 */
function zusammenfassen() {
  const dauer = gewaehlteDauer();
  const dauerWort = dauer.unbegrenzt
    ? t("dialog_dauer_offen", "so lange, bis du beendest,")
    : t("dialog_dauer_lang", "$1 lang", DAUERTEXT[String(dauer.sekunden)] || zeitWort(dauer.sekunden));
  const bereich = t("dialog_bereich", "in diesem einen Tab");
  $("zusammenfassung").textContent =
    t("dialog_antrag", "Ich beantrage: Der Agent darf $1 $2 $3. ", dauerWort, bereich, stufeText().tut) +
    t("dialog_antrag_schritt", "Jeden Schritt bestätigst du einzeln. ") +
    (dauer.unbegrenzt
      ? t("dialog_antrag_offen", "Ich verlängere die Freigabe selbst, bis du auf Stopp drückst. ")
      : t("dialog_antrag_ende", "Danach ist die Verbindung von selbst zu Ende. ")) +
    t("dialog_antrag_server", "Wie lange der Server wirklich bewilligt, sage ich dir beim Verbinden.");
}

/*
 * Der Dialog wird nur dort angeboten, wo er auch zu einer Verbindung führen
 * kann.
 *
 * Die Prüfung steht VOR dem Dialog und nicht erst hinter „Verbinden" (Befund
 * Inhaber 28.07.2026): Auf einem gesperrten Ursprung war früher jede Angabe
 * im Dialog folgenlos — inklusive der Auswahl „Diese Website
 * (https://cloud.smartragents.ai)", die garantiert scheitern musste. Ein
 * Dialog, dessen Ergebnis feststeht, ist keine Frage, sondern eine Falle.
 */
async function dialogVorbereiten() {
  /*
   * Läuft schon eine Sitzung, gibt es hier nichts zu beantragen.
   *
   * Die Verbindungsleiste macht diesen Weg von sich aus zu (setzeZustand), der
   * Menüpunkt „Verbindung aufbauen …" tat es bis 0.4.1 nicht. Über ihn war
   * folgende Kette erreichbar, gefunden am 06.08.2026 beim Messen gegen die
   * halbe Änderung: zweiter Anlauf während laufender Sitzung → irgendein
   * Fehlschlag → aufbauAbbrechen(). Das gab die Seitenrechte für den Ursprung
   * ZURÜCK und schaltete die Anzeige auf `bereit`, während zustand.sitzung
   * stehen blieb. Ergebnis: Der Agent verlor mitten in der Arbeit sein Recht
   * auf den Tab, und der Mensch verlor gleichzeitig den Stopp-Knopf.
   *
   * Bei laufender Sitzung führt der Weg deshalb über Stopp, und nur über
   * Stopp. Eine Sackgasse ist das nicht: beenden() räumt zustand.sitzung noch
   * vor dem ersten await, danach steht der Dialog sofort wieder offen.
   */
  if (verbindungLaeuftSchon()) {
    schonUnterwegsSagen();
    return;
  }
  stoerung(null);
  const tab = await aktiverTab();
  const grund = rechte.sperrgrund(tab ? tab.url || "" : "");
  if (grund) {
    /* Zwei Gründe, zwei Sätze — siehe erklaerungen.js. Beides ist eine Regel,
       kein Defekt: keine rote Störung, kein Vorwurf. */
    erklaerkarteZeigen(SPERRE[grund] || SPERRE.browser);
    return;
  }
  const u = ursprungAus(tab.url || "");
  if (!u) {
    /* Kommt nach der Sperrprüfung praktisch nicht mehr vor; bleibt als
       fail-closed-Ausgang stehen, damit es keinen halb gefüllten Dialog gibt. */
    erklaerkarteZeigen(SPERRE.browser);
    return;
  }
  zustand.tabId = tab.id;
  zustand.ursprung = u.ursprung;
  zustand.ursprungMuster = u.muster;
  $("ursprung").textContent = u.ursprung;
  /* Erst die gemerkte Wahl herstellen, dann zusammenfassen: Sonst liest die
     Zusammenfassung die Vorgabe vor und der Nutzer beantragt etwas anderes,
     als ihm vorgelesen wurde. */
  auswahlHerstellen();
  zusammenfassen();
  /* Kompakt öffnen: Dauer und Stufe stehen vorbelegt und eingeklappt. Wer sie
     ändern will, klappt sie mit dem Knopf auf. Jeder Aufbau beginnt eingeklappt,
     damit die Wahl nicht aus einem früheren Aufbau offen stehen bleibt. */
  $("dialog-mehr").hidden = true;
  $("einstellungen-aendern").setAttribute("aria-expanded", "false");
  setzeZustand("dialog");
  ansagen(
    t(
      "dialog_ansage",
      "Verbindung mit dieser Website. Zum Verbinden auf Verbindung herstellen. Dauer und Stufe kannst du vorher ändern. Jeden Schritt bestätigst du einzeln."
    )
  );
}

/* ------------------------------------------------------------------ *
 * Der Riegel gegen den zweiten Anlauf
 *
 * Befund Abnahme 14.08.2026 (B8, ZZ13), gemessen: Klick auf „Mit diesem Tab
 * verbinden", nach 0,3 s noch einmal geklickt, weil sichtbar nichts passierte.
 * Lauf A bekam die Sitzung, Lauf B bekam `schon_verbunden` und lief in
 * aufbauAbbrechen — `overlay:aus` an den Tab UND `seitenrechteZurueckgeben`
 * für genau den Ursprung, auf dem A gerade arbeitete. Endstand: Der Mensch las
 * „Aktiv", der Agent hatte sein Recht auf die Seite verloren, der grüne Rahmen
 * war weg, und die Sitzung lief am Dienst weiter.
 *
 * Die Ursache war nicht der Klick, sondern die Frage: `zustand.sitzung` steht
 * erst am ENDE des Aufbaus. Gefragt wird ab jetzt danach, ob überhaupt etwas
 * unterwegs ist — und diese Marke wird noch vor dem ersten await gesetzt.
 * ------------------------------------------------------------------ */

function verbindungLaeuftSchon() {
  return !!zustand.sitzung || zustand.aufbau !== null;
}

/* Der Satz zum zweiten Anlauf: bei laufender Sitzung der Weg über Stopp, beim
   laufenden Aufbau die Auskunft, dass gerade verbunden wird. */
function schonUnterwegsSagen() {
  ansagen(
    zustand.sitzung
      ? t("kopf_schon_verbunden", "Es läuft schon eine Verbindung. Beende sie mit Stopp, dann kannst du eine neue aufbauen.")
      : t("dialog_verbinde", "Ich stelle die Verbindung her …"),
    true,
  );
}

let aufbauZaehler = 0;

/*
 * Wann der eine Klick überhaupt etwas auslösen kann.
 *
 * Befund Abnahme 14.08.2026 (N1): `setzeZustand("bereit")` stand am Dateiende
 * VOR `tabsAuffrischen()`. Dazwischen war `zustand.aktuellerTab` noch null, der
 * Knopf aber schon da — und ein Klick in dieser Lücke landete in
 * `erklaerkarteZeigen(SPERRE.browser)`, also bei der Auskunft „das ist eine
 * Browserseite". Das ist eine Falschaussage über einen Tab, den niemand
 * angesehen hat. Solange kein Ziel feststeht, gibt es nichts zu verbinden, und
 * genau das steht am Knopf.
 */
function verbindenKnoepfeSpiegeln() {
  const laeuft = zustand.aufbau !== null;
  /* Der Weg über den Dialog holt sich seinen Tab selbst (aktiverTab) und
     braucht den Bestand deshalb nicht. */
  $("verbinden-start").disabled = laeuft;
  $("verbinden").disabled = laeuft;
  $("verbinden-tab").disabled = laeuft || !zustand.aktuellerTab;
}

/*
 * Was der Mensch zwischen Klick und Sitzung SIEHT (H3).
 *
 * Drei sichtbare Stellen, nicht eine: der Chip oben, die Zeile neben dem Knopf
 * und der Knopf selbst. Abgeschaltet wird er, weil er in diesem Augenblick
 * wirklich nichts mehr auslöst — das ist keine Ausgrauung eines Angebots,
 * sondern die Anzeige einer laufenden Arbeit, dieselbe Entscheidung wie beim
 * Beispielauftrag (demoAuftrag).
 */
function aufbauSpiegeln() {
  const laeuft = zustand.aufbau !== null;
  app.dataset.aufbau = laeuft ? "laeuft" : "";
  verbindenKnoepfeSpiegeln();
  if (laeuft) {
    $("verbinden-hinweis").textContent = t("dialog_verbinde", "Ich stelle die Verbindung her …");
  } else {
    verbindenHinweisSetzen();
  }
  zustandChipSetzen();
}

function aufbauBeginnen() {
  aufbauZaehler += 1;
  zustand.aufbau = aufbauZaehler;
  aufbauSpiegeln();
  return aufbauZaehler;
}

/* Nur der Lauf, dem die Marke gehört, räumt sie weg. Ein später eintreffender
   Nachzügler soll nicht den Aufbau abmelden, der inzwischen begonnen hat. */
function aufbauBeenden(marke) {
  if (zustand.aufbau !== marke) return false;
  zustand.aufbau = null;
  aufbauSpiegeln();
  return true;
}

/*
 * Der eine Klick.
 *
 * Befund Inhaber 14.08.2026: Bis 0.5.2 führte der Weg über den Dialog, und bis
 * zur aktiven Verbindung waren es drei bis vier Klicks. Für jemanden, der sich
 * die Seitenleiste vorlesen lässt, ist jeder davon ein eigener vorgelesener
 * Bildschirm — der Weg zur Arbeit war länger als die Arbeit.
 *
 * Diese Funktion darf deshalb bis zur Chrome-Abfrage NICHTS awaiten. Das ist
 * keine Stilfrage: `chrome.permissions.request` verlangt eine Nutzergeste, und
 * die ist nach dem ersten await verbraucht. Alles, was sie braucht — der Tab,
 * seine Adresse, die gemerkte Wahl —, steht deshalb schon fest, gepflegt von
 * tabsAuffrischen(). Das erste await der ganzen Kette ist die Chrome-Abfrage
 * in verbinden().
 *
 * Was hier NICHT abgekürzt wird: die Sperre aus net/rechte.js, die
 * Seitenfreigabe durch Chrome, der Ausweis, das Ticket und die Freigabeseite.
 * Ein Klick weniger heißt ein Klick weniger, nicht eine Prüfung weniger.
 */
function tabVerbindenMit(tab) {
  /* Läuft schon etwas, gibt es hier nichts zu beantragen — derselbe Riegel wie
     in dialogVorbereiten, aus demselben Grund (Befund 06.08.2026: ein zweiter
     Anlauf nahm dem laufenden Agenten das Seitenrecht weg; Befund 14.08.2026:
     über den neuen Ein-Klick-Weg war genau das wieder erreichbar). Er steht
     VOR den Zuweisungen darunter: Ein zweiter Lauf hätte sonst Tab, Ursprung
     und Muster des ersten überschrieben, noch bevor er abgewiesen wird. */
  if (verbindungLaeuftSchon()) {
    schonUnterwegsSagen();
    return Promise.resolve();
  }
  if (!tab || typeof tab.url !== "string") {
    erklaerkarteZeigen(SPERRE.browser);
    return Promise.resolve();
  }
  const grund = rechte.sperrgrund(tab.url);
  if (grund) {
    erklaerkarteZeigen(SPERRE[grund] || SPERRE.browser);
    return Promise.resolve();
  }
  const u = ursprungAus(tab.url);
  if (!u) {
    erklaerkarteZeigen(SPERRE.browser);
    return Promise.resolve();
  }
  zustand.tabId = tab.id;
  zustand.ursprung = u.ursprung;
  zustand.ursprungMuster = u.muster;
  zustand.verbundenerTab = tab;
  $("ursprung").textContent = u.ursprung;
  /* Die gemerkte Wahl herstellen, bevor der Antrag daraus entsteht. Sie ist
     dieselbe wie im Dialog — zwei Vorbelegungen wären zwei Wahrheiten, und der
     Mensch bekäme je nach Weg eine andere Sitzung. */
  auswahlHerstellen();
  zusammenfassen();
  return verbinden();
}

const tabVerbinden = () => tabVerbindenMit(zustand.aktuellerTab);

/* ------------------------------------------------------------------ *
 * Sitzung: aufbauen, laufen, beenden
 * ------------------------------------------------------------------ */

async function anTab(nachricht) {
  if (!zustand.tabId) return null;
  try {
    return await chrome.tabs.sendMessage(zustand.tabId, nachricht);
  } catch (_) {
    return null;
  }
}

/* Die Chrome-Freigabe für die Seite muss im selben Klick erfragt werden — sie
   verlangt eine Nutzergeste, und die ist nach dem ersten await verbraucht.
   Deshalb steht sie ganz vorn, vor allem Netzverkehr.
   Welche Muster überhaupt erfragt werden dürfen, entscheidet net/rechte.js —
   der Freigabe-Ursprung ist dort gesperrt (DRAHTFORMAT §7.3). */
async function seitenrechteHolen() {
  return rechte.rechtHolen(zustand.ursprungMuster);
}

/* Zusätzliche Rücknahme. Die tragende liegt im Hintergrunddienst
   (net/link.js), weil diese Seitenleiste jederzeit verschwinden kann. */
async function seitenrechteZurueckgeben() {
  await rechte.rechtZurueckgeben(zustand.ursprungMuster);
}

/* Jeder Weg zum Service Worker kann ins Leere laufen — etwa wenn er beim
   Start hängengeblieben ist. Dann bekommt der Aufrufer eine Absage statt
   einer Ausnahme, die niemand sieht. Stumm hängen ist die einzige Antwort,
   die es hier nicht geben darf. */
async function anWorker(nachricht) {
  try {
    return await chrome.runtime.sendMessage(nachricht);
  } catch (_) {
    return null;
  }
}

/* Gemeinsamer Abbruchweg für jeden Fehlschlag im Aufbau: Rechte zurück,
   Overlay weg, Klartext auf den Bildschirm, zurück zum Anfang.
 *
 * `ziel` ist seit 0.4.1 kein festes "bereit" mehr. Der Grund ist derselbe wie
 * bei der Anmeldekarte (M1): `bereit` versteckt die Sitzungsleiste und damit
 * den Stopp-Knopf. Solange dieser Weg nur nach einem gescheiterten AUFBAU
 * begangen wird, läuft dabei keine Sitzung — dank der Sperre in
 * dialogVorbereiten() kann er gar nicht mehr während einer laufenden Sitzung
 * beginnen. Die Bedingung bleibt trotzdem stehen: Sie kostet nichts, und der
 * Preis für ihr Fehlen wäre ein Mensch ohne Notbremse.
 */
async function aufbauAbbrechen(text, ziel = zustand.sitzung ? "aktiv" : "bereit") {
  zustand.abbruch = null;
  zustand.freigabeAdresse = null;
  /*
   * Zurückgenommen wird nur, was kein anderer mehr braucht.
   *
   * Befund Abnahme 14.08.2026 (B8, ZZ13): Diese beiden Zeilen liefen bis dahin
   * bedingungslos. Ein gescheiterter Anlauf nahm damit einer LAUFENDEN Sitzung
   * den grünen Rahmen und das Seitenrecht für ihren Ursprung weg — gemessen
   * wurde `rechteZurueckgegeben=1` und `anTab=[overlay:an, overlay:aus]`,
   * während die Sitzung am Dienst weiterlief. Der Riegel in
   * verbindungLaeuftSchon() verhindert diesen Weg schon davor; die Bedingung
   * hier ist der zweite Riegel, denn das Seitenrecht ist das, was der Agent
   * wirklich in der Hand hat, und ein Aufbau darf niemals mehr abräumen, als
   * er selbst aufgebaut hat.
   */
  if (!zustand.sitzung) {
    await anTab({ typ: "overlay:aus" });
    await seitenrechteZurueckgeben();
  }
  setzeZustand(ziel);
  if (text) {
    stoerung(text);
    $("vorfuehrung").hidden = false;
  }
}

/*
 * Der ganze Verbindungsweg, in der Reihenfolge, in der er stattfinden muss:
 * Seitenrechte → Rahmen → Ausweis → Kennwort → Freigabe im Web-Tab → Ticket
 * → Verbindung. Bricht einer der Schritte ab, wird alles Vorherige
 * zurückgenommen. Es gibt keinen halb aufgebauten Zustand.
 *
 * Seit dem 14.08.2026 ist der Weg zweigeteilt: `verbinden()` ist der Riegel und
 * die Buchführung darüber, DASS gerade aufgebaut wird, `verbindungAufbauen()`
 * ist der Weg selbst. Der Grund für die Teilung ist das `finally`: Die Marke
 * muss auf jedem Ausgang fallen, auch auf dem, an den beim nächsten Umbau
 * niemand denkt (B8).
 */
async function verbinden() {
  /* Derselbe Riegel wie in tabVerbindenMit, weil hierher auch der Dialogknopf
     führt (Befund 14.08.2026, B8). Er steht vor dem ersten await; die
     Nutzergeste für chrome.permissions.request bleibt damit heil, denn geprüft
     wird ausschließlich der eigene Zustand. */
  if (verbindungLaeuftSchon()) {
    schonUnterwegsSagen();
    return;
  }
  const marke = aufbauBeginnen();
  try {
    await verbindungAufbauen();
  } finally {
    /* Auf JEDEM Ausgang, auch dem, an den beim nächsten Umbau niemand denkt:
       Eine Marke, die stehen bleibt, wäre ein Knopf, der nie wiederkommt. */
    aufbauBeenden(marke);
  }
}

async function verbindungAufbauen() {
  stoerung(null);
  $("vorfuehrung").hidden = true;

  /* Noch einmal die Sperre prüfen, obwohl der Dialog auf einem gesperrten
     Ursprung gar nicht erst erscheint: Zwischen Öffnen des Dialogs und diesem
     Klick kann der Nutzer den Tab gewechselt haben. Sonst liefe die Sperre in
     `rechtHolen` auf und käme als „abgelehnt" heraus — also als Entscheidung
     des Menschen, die er nie getroffen hat. */
  const grund = rechte.sperrgrund(zustand.ursprung);
  if (grund) {
    erklaerkarteZeigen(SPERRE[grund] || SPERRE.browser);
    return;
  }

  const gewuenscht = geltungsbereichVorschlag();

  if (!(await seitenrechteHolen())) {
    /* Nach der Sperrprüfung bleibt genau ein Grund übrig: Chrome hat gefragt
       und der Mensch hat Nein gesagt. Das ist keine Störung, sondern seine
       Entscheidung — und sie wird auch so benannt. */
    erklaerkarteZeigen(FREIGABE_ABGELEHNT, dialogVorbereiten);
    return;
  }

  const eingespielt = await anWorker({
    typ: "overlay:einspielen",
    tabId: zustand.tabId,
  });
  if (!eingespielt || !eingespielt.ok) {
    await aufbauAbbrechen(
      t(
        "fehler_rahmen_sicherheit",
        "Ich konnte den Rahmen auf dieser Seite nicht anzeigen. Aus Sicherheitsgründen baue ich dann keine Sitzung auf."
      )
    );
    return;
  }

  /* Anmeldung — nur als Ausweis. Sie beantwortet „wer bist du", nicht
     „was darfst du". Ohne angemeldeten Cloud-Tab gibt es hier kein
     Passwortfeld, sondern den Weg zur echten Anmeldeseite. */
  zustand.ausweis = await konto.ausweisBesorgen();
  if (!zustand.ausweis) {
    await anTab({ typ: "overlay:aus" });
    await seitenrechteZurueckgeben();
    /* Der Dialog ist an dieser Stelle gescheitert und darf weichen; erst
       danach entscheidet die Lage, ob die Anmeldekarte oder die Erklärung
       „Übergabe fehlt" der richtige Weg ist. Auch hier gilt die Regel aus M1:
       Läuft eine Sitzung, bleibt der Zustand `aktiv`, sonst verschwände mit
       der Sitzungsleiste der Stopp-Knopf. */
    setzeZustand(zustand.sitzung ? "aktiv" : "bereit");
    await ausweisFehltErklaeren();
    return;
  }

  const abbruch = new AbortController();
  zustand.abbruch = abbruch;
  $("kennwort-wert").textContent = "";
  $("kennwort-funk").textContent = "";
  $("kennwort-lage").textContent = t("dialog_kennwort_anfrage", "Ich frage die Freigabe an …");
  /* Die Kennwortkarte erscheint erst, wenn wirklich ein Kennwort kommt
     (Rückruf `kennwortZeigen`). Bei der Sofortfreigabe der Lesestufe gibt es
     keines — der Nutzer drückt Verbinden und ist verbunden, ohne Umweg über
     eine Karte, die nichts zu vergleichen hätte. */
  ansagen(t("dialog_verbinde", "Ich stelle die Verbindung her …"));

  let freigabe;
  try {
    freigabe = await ticket.freigabeDurchlaufen({
      ausweis: zustand.ausweis.token,
      zweck: zweckText(gewuenscht),
      gewuenscht,
      signal: abbruch.signal,
      aufKennwort: kennwortZeigen,
      aufWarten: ({ versuch }) => {
        if (app.dataset.state !== "kennwort") return;
        $("kennwort-lage").textContent =
          versuch < 3
            ? t("dialog_kennwort_warten", "Ich warte auf deine Freigabe im anderen Tab.")
            : t("dialog_kennwort_warten_lang", "Ich warte weiter. Gib die Verbindung im anderen Tab frei oder brich hier ab.");
      },
    });
  } catch (fehler) {
    if (fehler && fehler.kennung === "anmeldung") await konto.ausweisVerwerfen();
    await aufbauAbbrechen(klartextVon(fehler));
    return;
  }

  if (app.dataset.state === "kennwort") {
    $("kennwort-lage").textContent = t("dialog_kennwort_da", "Freigabe da. Ich stelle die Verbindung her.");
  }

  const antwort = await anWorker({
    typ: "link:verbinden",
    ticket: freigabe.ticket,
    ausweis: zustand.ausweis.token,
    /* Damit der Hintergrunddienst das Seitenrecht auch dann zurückgeben kann,
       wenn diese Seitenleiste das Sitzungsende nicht mehr erlebt. */
    ursprungMuster: zustand.ursprungMuster,
    /* Und damit der Ausführer weiß, in welchem Tab er arbeiten darf. Er läuft
       im Hintergrunddienst; ohne diese Angabe hätte er nur die Adressliste,
       aber keinen Tab — und „irgendein Tab dieser Adresse" ist nicht das,
       was der Mensch freigegeben hat. */
    tabId: zustand.tabId,
  });

  /* Der konkrete Grund aus dem Hintergrunddienst erreicht die Störungszeile
     unverändert. Erfunden wird hier nichts mehr: Kommt gar keine Antwort, war
     der Hintergrunddienst nicht erreichbar — das ist ein Fehler der
     Erweiterung und wird auch so benannt (Regel Inhaber 28.07.). */
  if (!antwort || !antwort.ok) {
    await aufbauAbbrechen((antwort && antwort.klartext) || DIENST_STUMM);
    return;
  }

  zustand.abbruch = null;
  zustand.wunsch = gewuenscht;
  await sitzungAnzeigen(antwort.sitzung, { verlaengern: gewuenscht.unbegrenzt === true });

  /* Die Sitzung dem Agenten in die Hand geben: Das Gateway bindet sie an
     einen Browser-Auftragskontext (Profil smartr-browser). Erst damit kann
     Niemand hier im Gespräch wirklich Befehle schicken — vorher war die
     Verbindung nur Anzeige. Scheitert der Schritt, bleibt die Sitzung
     nutzbar (Beispielauftrag), aber der Mensch erfährt es ehrlich. */
  await agentenBindung();
}

/*
 * Die Bindung der laufenden Sitzung an den Agenten (G4).
 *
 * POST /api/v1/link/session/bind legt (einmal je Sitzung) den Auftragskontext
 * an und hinterlegt dort den Sitzungsschein. Bei der Verlängerung wird mit
 * demselben Kontext neu gebunden — der Auftrag läuft weiter, nur der
 * Sitzungscode ist neu.
 *
 * Scheitert sie, ist das ein ganzer Satz und keine stille Rückkehr: Die
 * Oberfläche zeigt dann „Aktiv · Bedienen", grünen Rahmen und Sitzungscode,
 * aber jede Frage liefe ins gewöhnliche Gespräch. Ein Versprechen, das niemand
 * einlöst, ist schlimmer als eine Absage.
 */
const BINDUNG_FEHLT = t(
  "fehler_bindung",
  "Die Verbindung steht, aber ich konnte sie dem Agenten nicht übergeben. Der Beispielauftrag unten geht trotzdem. Für Aufträge im Gespräch baue die Verbindung bitte neu auf.",
);
const BINDUNG_OHNE_AUSWEIS = t(
  "fehler_bindung_ausweis",
  "Die Verbindung steht, aber ich konnte sie dem Agenten nicht übergeben: Mir fehlt gerade deine Anmeldung. Melde dich in der Cloud an oder lade den SMarTrAgents-Tab neu, dann baue die Verbindung bitte neu auf.",
);

async function agentenBindung() {
  const s = zustand.sitzung;
  if (!s || s.vorfuehrung || !s.code) return;
  /* Ohne Ausweis gibt es keine Bindung — und das war bisher ein stiller
     Ausgang. Beim Wiederöffnen der Seitenleiste ist er der wahrscheinlichste
     (Befund Gegenlesung 29.07.), und dort wäre er der teuerste: Der Mensch
     liest „Aktiv" und bekommt auf jede Frage eine Antwort ohne Hände. */
  if (!zustand.ausweis) {
    zustand.browserKontext = null;
    eingabePlatzhalterSetzen();
    stoerung(BINDUNG_OHNE_AUSWEIS);
    return;
  }
  try {
    const antwort = await anfragen("/api/v1/link/session/bind", {
      methode: "POST",
      ausweis: zustand.ausweis.token,
      kopfzeilen: { "X-Client": chat.CHAT_KLIENT },
      koerper: {
        code: s.code,
        context_id: zustand.browserKontext || "",
        step_mode: s.modus === "auto" ? "auto" : "confirm_each",
      },
    });
    const kontext = String(antwort.context_id || "");
    if (!kontext) throw new Error("kein_kontext");
    const neu = !zustand.browserKontext;
    zustand.browserKontext = kontext;
    eingabePlatzhalterSetzen();
    if (neu) {
      sagen(
        "niemand",
        s.stufe === "write"
          ? t(
              "sitzung_haende_write",
              "Ich habe jetzt Hände für diesen Tab: Sag mir, was ich klicken, ausfüllen oder nachsehen soll. Jeden Schritt bestätigst du einzeln."
            )
          : t(
              "sitzung_haende_read",
              "Ich sehe diesen Tab jetzt: Frag mich, was auf der Seite steht, oder lass dir Dinge zeigen."
            )
      );
    }
  } catch (_) {
    zustand.browserKontext = null;
    eingabePlatzhalterSetzen();
    stoerung(BINDUNG_FEHLT);
  }
}

/* Was auf der Freigabeseite als Zweck steht. Bewusst aus unseren eigenen
   Worten gebaut — Text von der besuchten Seite kommt hier nie hinein. */
function zweckText(gewuenscht) {
  const wo = zustand.ursprung || t("dialog_zweck_ort", "der geöffneten Seite");
  return gewuenscht.access === "write"
    ? t("dialog_zweck_write", "Auf $1 für dich klicken und tippen", wo)
    : t("dialog_zweck_read", "Auf $1 mitlesen und dir Dinge zeigen", wo);
}

/*
 * Der Wunsch der Erweiterung — flach, nach DRAHTFORMAT E6/E7.
 *
 * `allow` ist NIE leer, auch nicht bei „nur dieser Tab". Früher hieß „nur
 * dieser Tab" hier: leere Liste. Das war die gefährlichste Angabe im ganzen
 * System, denn der Relay prüft den Geltungsbereich nur, wenn `allow` gefüllt
 * ist — eine leere Liste war damit keine Beschränkung, sondern die Aufhebung
 * jeder Beschränkung. „Nur dieser Tab" wäre die weiteste Freigabe gewesen
 * statt der engsten.
 *
 * Was hier steht, ist trotzdem nur ein Vorschlag. Entschieden wird auf der
 * Freigabeseite, und die belegt aus `preselect` vor, nicht aus unserem Wunsch.
 */
function geltungsbereichVorschlag() {
  /* Ein gesperrter Host kommt hier nie heraus (net/rechte.js, bereichHost):
     Was die Erweiterung nicht bedienen darf, schlägt sie auch nicht als
     Bereich vor — sonst stünde auf der Freigabeseite ein Ziel, das ein Mensch
     bestätigen könnte, obwohl es garantiert nicht funktioniert. */
  const host = rechte.bereichHost(zustand.ursprung);
  const dauer = gewaehlteDauer();
  const wahl = gewaehlteStufe();
  return {
    /* Auf der Leitung gibt es nur read und write. „Vollzugriff" ist write mit
       Selbständig-Modus, siehe die Begründung bei STUFENTEXT. */
    access: stufeAufDerLeitung(wahl),
    duration: dauer.sekunden,
    unbegrenzt: dauer.unbegrenzt,
    mode: "tab",
    allow: host ? [host] : [],
    tab_host: host,
    /* Vorgabe bleibt die Einzelbestätigung. Nur wer ausdrücklich „Vollzugriff"
       wählt, beantragt den Selbständig-Modus — und auch dann entscheidet die
       Gegenstelle, ob sie ihn erteilt. */
    step_mode: schrittmodusAus(wahl),
  };
}

function klartextVon(fehler) {
  if (fehler && fehler.kennung === "abgebrochen") return null;
  return (
    (fehler && fehler.klartext) ||
    t("fehler_kein_erfolg", "Das hat nicht geklappt. Es ist keine Verbindung entstanden.")
  );
}

/* Das Kennwort: groß auf dem Bildschirm, buchstabiert für den Bildschirmleser,
   und als Ansage nach deutschem Funkalphabet. Sechs zufällige Zeichen sind
   sonst nicht zwischen zwei Fenstern vergleichbar. */
function kennwortZeigen({ kennwort, buchstabiert, ansage, adresse }) {
  zustand.freigabeAdresse = adresse;
  /* Erst jetzt, mit echtem Kennwort, erscheint die Karte — die
     Sofortfreigabe der Lesestufe kommt hier nie vorbei. */
  setzeZustand("kennwort");
  const feld = $("kennwort-wert");
  feld.textContent = kennwort;
  feld.setAttribute("aria-label", t("dialog_kennwort_marke", "Kennwort: $1", buchstabiert));
  $("kennwort-funk").textContent = ansage;
  $("kennwort-lage").textContent = t(
    "dialog_kennwort_lage",
    "Gleich geht ein Tab auf. Vergleiche dort das Kennwort und gib die Verbindung frei.",
  );
  ansagen(
    t("dialog_kennwort_ansage", "Kennwort: $1. Vergleiche es im neuen Tab, bevor du freigibst.", ansage),
    true,
  );
}

/*
 * Ab hier zählt nur noch, was der Server erteilt hat.
 *
 * Und zwar ausschließlich aus `auth_ok` (DRAHTFORMAT §5.3): nicht aus dem
 * `granted` von /redeem, nicht aus der Auswahl im Dialog und nicht aus dem
 * Ticket, das die Erweiterung selbst auslesen könnte. Weicht die Anzeige vom
 * Gewünschten ab, hat der Mensch etwas anderes erteilt — dann ist die Anzeige
 * richtig und der Wunsch war es nicht.
 */
async function sitzungAnzeigen(serverSitzung, { verlaengern = false } = {}) {
  const stufe = serverSitzung.stufe === "write" ? "write" : "read";
  zustand.sitzung = {
    stufe,
    /* Nur was der Mensch im Dialog gewählt hat — nie eine Servervorgabe. */
    verlaengern: verlaengern === true,
    /* `auto` gibt es serverseitig; diese Fassung führt trotzdem jeden Schritt
       einzeln vor — sie hat noch keine Werkzeugschicht, die etwas anderes
       könnte. Der erteilte Wert wird mitgeführt, damit die Anzeige nicht lügt. */
    modus: serverSitzung.schrittmodus === "auto" ? "auto" : "schritt",
    bereich: serverSitzung.modus === "domains" ? "origin" : "tab",
    adressen: Array.isArray(serverSitzung.bereich) ? serverSitzung.bereich : [],
    code: serverSitzung.code || "",
    endetUm: serverSitzung.endetUm,
    vorfuehrung: false,
    gewarnt120: false,
    gewarnt60: false,
  };
  zustand.abgebrochen = false;

  /* Zwei Abweichungen zwischen Antrag und Bewilligung fielen bisher still unter
     den Tisch, und beide sehen für den Menschen wie ein Fehler der Erweiterung
     aus. Erstens kann der Server die Dauer kürzen. Zweitens endet eine Sitzung
     ohne Auftrag nach der Leerlauffrist von selbst, während die Anzeige seelen-
     ruhig die volle Restzeit herunterzählt. Wer 60 Minuten wählt und nach drei
     Minuten Tippen vor einer toten Sitzung steht, sucht den Fehler bei sich.
     Nur beim ersten Aufbau ansagen, nicht bei jeder Selbsterneuerung. */
  if (!verlaengern) {
    const hinweise = [];
    const gewuenscht = Number(zustand.wunsch?.duration) || 0;
    const bewilligt = Math.round((Number(serverSitzung.endetUm) - Date.now()) / 1000);
    if (gewuenscht > 0 && bewilligt > 0 && gewuenscht - bewilligt > 60) {
      hinweise.push(
        t(
          "sitzung_dauer_gekuerzt",
          "Du hast $1 gewählt, bekommen hast du $2.",
          zeitWort(gewuenscht),
          zeitWort(bewilligt),
        ),
      );
    }
    const leerlauf = Number(serverSitzung.leerlaufSekunden) || 0;
    if (leerlauf > 0) {
      hinweise.push(
        t("sitzung_leerlauf", "Ohne Auftrag endet die Verbindung nach $1 von selbst.", zeitWort(leerlauf)),
      );
    }
    if (hinweise.length) ansagen(hinweise.join(" "), true);
  }

  await anTab({
    typ: "overlay:an",
    gross: zustand.grosseSicht,
    text: t("overlay_schild", "SMarTrAgent steuert diesen Tab. Esc Esc = Stopp"),
  });

  const st = STUFENTEXT[stufe] || STUFENTEXT.read;
  $("stufe-anzeige").textContent = st.etikett;
  const codeFeld = $("sitzungscode");
  if (zustand.sitzung.code) {
    codeFeld.textContent = zustand.sitzung.code;
    codeFeld.setAttribute(
      "aria-label",
      t("sitzung_code_marke", "Sitzungscode $1", ticket.buchstabiert(zustand.sitzung.code)),
    );
    codeFeld.hidden = false;
  } else {
    codeFeld.hidden = true;
  }
  /* Das Gespräch bleibt stehen — eine neue Steuersitzung ist kein neues
     Gespräch. Nur das Schrittprotokoll beginnt mit der Sitzung neu. */
  $("protokoll").replaceChildren();
  /* Sichtbarkeit des Beispielauftrags gehört seit 0.4.1 setzeZustand allein.
     Zwei Schreiber auf dasselbe `hidden` waren die Ursache dafür, dass der
     Knopf jahrelang unsichtbar blieb, ohne dass es jemandem auffiel. */
  stoerung(null);
  /* Erst die Karten füllen, dann zeigen: setzeZustand hebt ihr `hidden` auf,
     und eine leere Karte, die eine Sekunde lang „verbunden mit nichts" sagt,
     wäre schlimmer als gar keine. Seit dem 14.08.2026 steht die Startseite
     während der Sitzung ebenfalls da (M7), also wird der ganze Verbindungsweg
     nachgezogen und nicht nur die Tabkarte. */
  verbindungswegZeichnen();
  setzeZustand("aktiv");
  /* Der Platzhalter wird hier selbst nachgezogen und nicht der Startreihenfolge
     überlassen (Befund Gegenlesung 29.07.): Zwischen dieser Anzeige und der
     Bindung liegt ein Netzweg, und solange der läuft, muss das Eingabefeld
     sagen, wohin die nächste Frage WIRKLICH geht. */
  eingabePlatzhalterSetzen();

  const rest = Math.max(0, Math.round((zustand.sitzung.endetUm - Date.now()) / 60000));
  /* Die Zusage, an der die Schrittfreigabe hängt, steht in der Ansage selbst:
     Verbunden — und vor jedem Schritt wird gefragt. Nur im (serverseitig
     erteilten) Automatikmodus entfällt der Satz, damit die Anzeige nicht lügt. */
  /* Im Selbständig-Modus wurde der Satz bisher nur weggelassen. Eine
     Auslassung ist aber keine Aussage, und gerade wer sich alles vorlesen
     lässt, muss hören, dass jetzt NICHT mehr gefragt wird. */
  const schrittSatz =
    zustand.sitzung.modus === "auto"
      ? t("sitzung_schritt_auto", "Ich arbeite selbständig weiter und frage nicht bei jedem Schritt. ")
      : t("sitzung_schritt_einzeln", "Ich frage dich vor jedem Schritt. ");
  sagen(
    "niemand",
    t("sitzung_verbunden_blase", "Verbunden. $1Ich bin noch etwa $2 Minuten für dich da.", schrittSatz, rest),
  );
  ansagen(
    t(
      "sitzung_verbunden_ansage",
      "Verbunden. $1Der Agent ist jetzt auf diesem Tab. Noch etwa $2 Minuten. $3 Zweimal Escape beendet sofort.",
      schrittSatz,
      rest,
      st.ansage,
    ),
    true
  );

  zustand.sitzung.ticker = setInterval(tick, 1000);
  tick();
}

/*
 * Vorführung ohne Server.
 *
 * Sie ist keine Verbindung: kein Ausweis, kein Ticket, kein Relay, kein
 * Agent. Sie zeigt ausschließlich, was diese Erweiterung an der Oberfläche
 * tut — Rahmen, Zeiger, Schritt-Freigabe, Notbremse. Sie heißt überall so
 * und wird in der Sitzungsleiste als Vorführung geführt, damit sie niemand
 * für eine echte Steuerung hält.
 */
async function vorfuehrungStarten() {
  stoerung(null);
  if (!zustand.ursprungMuster) {
    await dialogVorbereiten();
    return;
  }
  /* Dieselbe Reihenfolge wie beim echten Verbinden: erst die Regel, dann die
     Frage an Chrome. Sonst hieße auch hier eine Sperre „du hast abgelehnt". */
  const grund = rechte.sperrgrund(zustand.ursprung);
  if (grund) {
    erklaerkarteZeigen(SPERRE[grund] || SPERRE.browser);
    return;
  }
  if (!(await seitenrechteHolen())) {
    erklaerkarteZeigen(FREIGABE_ABGELEHNT, dialogVorbereiten);
    return;
  }
  const eingespielt = await anWorker({
    typ: "overlay:einspielen",
    tabId: zustand.tabId,
  });
  if (!eingespielt || !eingespielt.ok) {
    await aufbauAbbrechen(t("fehler_rahmen", "Ich konnte den Rahmen auf dieser Seite nicht anzeigen."));
    return;
  }

  zustand.sitzung = {
    stufe: "read",
    modus: "schritt",
    bereich: "tab",
    code: "",
    endetUm: Date.now() + 600 * 1000,
    vorfuehrung: true,
    gewarnt120: false,
    gewarnt60: false,
  };
  zustand.abgebrochen = false;

  await anTab({
    typ: "overlay:an",
    gross: zustand.grosseSicht,
    text: t("overlay_schild_vorfuehrung", "Vorführung ohne Agent. Esc Esc = Stopp"),
  });

  $("stufe-anzeige").textContent = t("kopf_stufe_vorfuehrung", "Vorführung");
  $("sitzungscode").hidden = true;
  $("protokoll").replaceChildren();
  setzeZustand("aktiv");

  sagen(
    "niemand",
    t(
      "vorfuehrung_blase",
      "Das ist eine Vorführung ohne Server. Kein Agent ist verbunden, es wird nichts gesteuert. " +
        "Du siehst nur, was diese Erweiterung anzeigt.",
    )
  );
  ansagen(t("vorfuehrung_ansage", "Vorführung gestartet. Es ist kein Agent verbunden. Zehn Minuten."), true);

  zustand.sitzung.ticker = setInterval(tick, 1000);
  tick();
}

function restText(sekunden) {
  const m = Math.floor(sekunden / 60);
  const s = sekunden % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function tick() {
  const s = zustand.sitzung;
  if (!s) return;
  const rest = Math.max(0, Math.round((s.endetUm - Date.now()) / 1000));
  $("rest").textContent = restText(rest);
  if (s.verlaengern && !s.vorfuehrung) {
    /* „Unbegrenzt": kurz vor dem Ablauf erneuert die Erweiterung die Freigabe
       selbst — mit demselben Weg wie beim Aufbau. Die Minutenwarnungen wären
       hier Lärm; gewarnt wird erst, wenn die Verlängerung scheitert. */
    if (rest <= VERLAENGERN_AB_SEKUNDEN && !zustand.verlaengerungLaeuft) {
      verlaengern();
    }
    if (rest === 0) beenden("abgelaufen");
    return;
  }
  if (rest <= 120 && !s.gewarnt120) {
    s.gewarnt120 = true;
    ansagen(t("sitzung_zwei_minuten", "Noch zwei Minuten."));
  }
  if (rest <= 60 && !s.gewarnt60) {
    s.gewarnt60 = true;
    ansagen(t("sitzung_eine_minute", "Noch eine Minute. Danach endet die Verbindung von selbst."), true);
  }
  if (rest === 0) beenden("abgelaufen");
}

/*
 * Die Verlängerung der „unbegrenzten" Sitzung.
 *
 * Sie ist ein vollwertiger neuer Freigabeweg (Antrag → Ticket → neue
 * Leitung), kein Wiederbeleben: Der Service Worker tauscht die Leitung erst,
 * wenn die neue steht (link:verlaengern). Scheitert irgendein Schritt, läuft
 * die alte Sitzung einfach bis zu ihrem Ende — und der Mensch hört warum.
 */
async function verlaengern() {
  const s = zustand.sitzung;
  if (!s || s.vorfuehrung || !zustand.wunsch || !zustand.ausweis) return;
  zustand.verlaengerungLaeuft = true;
  try {
    const freigabe = await ticket.freigabeDurchlaufen({
      ausweis: zustand.ausweis.token,
      zweck: zweckText(zustand.wunsch),
      gewuenscht: { ...zustand.wunsch, duration: VERLAENGERUNGS_DAUER },
      signal: null,
      aufKennwort: kennwortZeigen,
      aufWarten: () => {},
    });
    const antwort = await anWorker({
      typ: "link:verlaengern",
      ticket: freigabe.ticket,
      ausweis: zustand.ausweis.token,
    });
    if (!antwort || !antwort.ok || !antwort.sitzung) {
      throw new Error((antwort && antwort.klartext) || "verlaengerung_fehlgeschlagen");
    }
    s.endetUm = antwort.sitzung.endetUm;
    s.code = antwort.sitzung.code || s.code;
    const codeFeld = $("sitzungscode");
    if (s.code) {
      codeFeld.textContent = s.code;
      codeFeld.setAttribute("aria-label", t("sitzung_code_marke", "Sitzungscode $1", ticket.buchstabiert(s.code)));
      codeFeld.hidden = false;
    }
    protokollieren(t("protokoll_verlaengert", "Verlängert: die Freigabe läuft weiter"));
    /* Der Agent bekommt den neuen Sitzungsschein in denselben Auftrag. */
    await agentenBindung();
  } catch (fehler) {
    ansagen(
      t(
        "fehler_verlaengern",
        "Ich konnte die Verbindung nicht verlängern. Sie endet zur angezeigten Zeit. Du kannst danach neu verbinden."
      ),
      true
    );
  } finally {
    zustand.verlaengerungLaeuft = false;
  }
}

async function beenden(grund, klartext = null) {
  const s = zustand.sitzung;
  if (!s) return;
  clearInterval(s.ticker);
  zustand.sitzung = null;
  zustand.abgebrochen = true;
  /* Der Browser-Auftrag endet mit der Sitzung: Die nächste Frage geht wieder
     an das normale Gespräch. Der Sitzungsschein im Agenten läuft ohnehin ab. */
  zustand.browserKontext = null;
  zustand.wunsch = null;
  zustand.verlaengerungLaeuft = false;
  /* Die Statuskarte gehört der Sitzung. Der Agent der Cloud-Sitzung dagegen
     NICHT: Die läuft in der Cloud weiter, und sie hier stillschweigend
     wegzuräumen hieße, dem Menschen eine laufende Fernsitzung zu verschweigen
     (Vertrag §8.4). Sie endet, wenn die Brücke es meldet. */
  zustand.verbundenerTab = null;
  if (zustand.freigabeLaeuft) {
    zustand.freigabeLaeuft(false);
    zustand.freigabeLaeuft = null;
  }
  freigabeUhrStoppen();
  /* Auch hier verschwindet die Freigabekarte, nur nicht über
     freigabeSchliessen. Stand der Fokus darin, muss er auch hier zurück:
     Sonst liegt er die 1200 Millisekunden bis zum Ruhezustand auf `body`, und
     das ist die Zeit, in der die Schlussansage läuft. */
  freigabeFokusZurueckgeben();
  $("freigabe").hidden = true;
  $("sitzungscode").hidden = true;

  /*
   * Befund Inhaber 29.07.: Nach Stopp, Notbremse oder Ablauf blieb die
   * Seitenleiste auf „Niemand arbeitet …" stehen — der Wartezustand des Chats
   * wurde nirgends aufgelöst — und der Browser-Auftrag lief beim Server
   * weiter. Beides gehört zum Beenden.
   *
   * Die Anzeige geht sofort zurück (noch vor jedem await): Wer Stopp drückt,
   * darf nicht noch einen Takt lang lesen, dass gearbeitet wird. Gestoppt wird
   * nur ein Browser-Auftrag; ein gewöhnliches Gespräch gehört nicht zur
   * Sitzung und läuft weiter. Den Weg dafür gibt es schon (worker.js,
   * `chat:neu` → chat.chatAbbrechen) — ein zweiter wäre eine zweite Wahrheit.
   */
  const liefBrowserAuftrag = zustand.chatLaeuft && zustand.chatLaeuftFuer === "browser";
  chatWartenZeigen(false);

  /*
   * Und die Anzeige geht mit, und zwar SOFORT.
   *
   * Befund Abnahme 14.08.2026 (H4, ZZ9/ZZ10), gemessen für Stopp, „abgelaufen"
   * und „verloren": Hier stand am Ende ein `setTimeout(…, 1200)`. Noch bei
   * +608 ms zeigte die Leiste „Aktiv, Nur zusehen", grüne Sitzungsleiste mit
   * Stopp-Knopf und Tabkarte mit grünem Punkt — obwohl `zustand.sitzung` schon
   * null war und das Seitenrecht gleich darauf zurückging. Erst bei +1509 ms
   * wurde daraus „Angemeldet, bereit". In demselben Fenster war der Weg zurück
   * nicht begehbar: Die Verbindungsleiste hängt am Ruhezustand.
   *
   * Die Begründung für die Verzögerung war, die Schlussansage nicht von einem
   * Bildwechsel überholen zu lassen. Das ist der falsche Tausch: Die Ansage
   * steht danach immer noch als Blase und in der Ansagezone, die Anzeige
   * dagegen behauptete 1200 ms lang eine Steuerung, die es nicht mehr gab.
   * Angesagt wird deshalb unverändert, nur eben hinter dem Wechsel.
   */
  setzeZustand("bereit");
  /* Und die Karten sagen dasselbe: Die Statuskarte der Startseite gehört der
     Sitzung, sie darf sie nicht überleben (M7). */
  verbindungswegZeichnen();

  /* Erst die Verbindung kappen, dann die Anzeige abbauen: Solange die
     Leitung steht, könnte noch ein Befehl eintreffen. Bei der Vorführung
     gibt es nichts zu kappen — sie hatte nie eine Leitung. */
  if (!s.vorfuehrung) {
    await anWorker({
      typ: "link:trennen",
      grund,
      ausweis: zustand.ausweis ? zustand.ausweis.token : null,
    });
    if (liefBrowserAuftrag) await anWorker({ typ: "chat:neu" });
  }

  eingabePlatzhalterSetzen();

  if (grund === "notbremse") await anTab({ typ: "overlay:gestoppt" });
  else await anTab({ typ: "overlay:aus" });

  /* Die Rechte überleben die Sitzung nicht. */
  await seitenrechteZurueckgeben();

  /* `notbremse` teilt sich den Schlüssel mit NOTBREMSE_SAETZE.seitenleiste:
     Es ist derselbe Satz für dieselbe Lage, und zwei Schlüssel dafür liefen
     beim ersten Redigieren auseinander. */
  const texte = {
    notbremse: t("notaus_seitenleiste", "Gestoppt. Der Agent steuert nicht mehr."),
    abgelaufen: t("sitzung_ende_abgelaufen", "Die Sitzung ist beendet. Die Freigabe habe ich zurückgegeben."),
    verloren: t("sitzung_ende_verloren", "Die Verbindung ist abgerissen. Die Freigabe habe ich zurückgegeben."),
    nutzer: t("sitzung_ende_nutzer", "Beendet. Die Freigabe habe ich zurückgegeben."),
  };
  const text = klartext || texte[grund] || texte.nutzer;
  sagen("niemand", text);
  merkenUndSprechen(text, true);
}

/* ------------------------------------------------------------------ *
 * Freigabe je Schritt
 *
 * Die Frage selbst enthält nie Text von der besuchten Seite — der steht
 * abgesetzt darunter und wird nicht gesprochen. Vorausgewählt ist "Ablehnen".
 * ------------------------------------------------------------------ */

/*
 * Die Restzeit für die Antwort.
 *
 * Befund Inhaber 29.07.: Je Schritt bleiben rund 13 bis 20 Sekunden, und die
 * Karte verschwand danach kommentarlos. Für jemanden, der sich alles vorlesen
 * lässt, ist das zu knapp — und eine Karte, die ohne Wort verschwindet, sieht
 * aus wie ein Defekt. Die Frist selbst gehört dem Ausführer (net/ausfuehrer.js);
 * hier wird sie nur sichtbar gemacht.
 *
 * Befund Gegenlesung 29.07.: Die angezeigte Zahl war trotzdem immer falsch und
 * immer zu groß. Die Seitenleiste rechnete sie aus der Befehlstabelle
 * (`frist − Puffer − Reserve`) und kannte dabei nur den ANFANG des Befehls. Bis
 * die Frage hier ankommt, sind Rahmen, Tabtitel, Parameterprüfung und bei
 * click/type/select ein Umlauf zum Seitenskript vergangen: Bei `click` standen
 * 15 Sekunden da, wo real noch rund 9 blieben — und die Karte wurde weggeräumt,
 * während die Uhr noch zählte.
 *
 * Wie viel wirklich übrig ist, weiß genau eine Stelle: der Ausführer. Sagt er
 * es (`frist`), gilt seine Zahl und sonst keine. Sagt er es nicht, zeigt die
 * Karte gar keine Uhr — fail-closed, wie überall sonst. Eine geratene Restzeit
 * ist eine Falschaussage, und die ist schlimmer als eine Lücke.
 *
 * Stand 29.07.2026: Der Ausführer BERECHNET die Restzeit bereits
 * (`restBisAusfuehrung`) und übergibt sie an `freigabeFragen`, sendet sie aber
 * nicht mit — `sendMessage` trägt nur frage/quelle/cmd/id. Solange das so ist,
 * läuft hier nie eine Uhr, und die Karte sagt genau das. Kommt das Feld dazu,
 * tickt sie ohne weitere Änderung.
 */
function antwortfristMs(nachricht) {
  const gesagt = Number(nachricht && nachricht.frist);
  return Number.isFinite(gesagt) && gesagt > 0 ? Math.round(gesagt) : 0;
}

/* Was in der Zeile steht, solange niemand die Restzeit kennt. Sie bleibt
   sichtbar: Eine Absage ist eine Aussage, und „ich weiß es nicht" ist die
   einzige, die hier stimmt. Die Ansage dazu steht in `freigabeHolen` — sie
   gehört in DIESELBE Ansage wie die Frage, nicht in eine zweite. */
const OHNE_UHR_ZEILE = t("freigabe_ohne_uhr_zeile", "Wie lange der Agent noch wartet, weiß ich hier nicht.");
const OHNE_UHR_ANSAGE = t(
  "freigabe_ohne_uhr_ansage",
  "Wie lange du Zeit hast, weiß ich nicht, antworte am besten sofort.",
);

let freigabeUhr = null;

/**
 * @param {number|null} fristMs  Millisekunden, 0 = es wartet jemand und niemand
 *   weiß wie lange, `null` = es wartet gar niemand (Beispielauftrag).
 */
function freigabeUhrStarten(fristMs) {
  freigabeUhrStoppen();
  const zeile = $("freigabe-rest");
  /* Beim Beispielauftrag läuft die Frage in dieser Seitenleiste und hat keine
     Frist. Eine Auskunft über eine Zeit, die es nicht gibt, wäre erfunden —
     also steht dort nichts. */
  if (fristMs === null) {
    zeile.hidden = true;
    return;
  }
  zeile.hidden = false;
  if (!fristMs) {
    /* Kein Balken ohne bekannte Gesamtzeit: Ein Balken behauptet ein
       Verhältnis, und ein erfundenes Verhältnis ist eine erfundene Anzeige. */
    $("freigabe-balken").hidden = true;
    $("freigabe-rest-text").textContent = OHNE_UHR_ZEILE;
    return;
  }
  $("freigabe-balken").hidden = false;
  const endeUm = Date.now() + fristMs;
  const zeigen = () => {
    const uebrig = endeUm - Date.now();
    const rest = Math.max(0, Math.ceil(uebrig / 1000));
    $("freigabe-rest-text").textContent = !rest
      ? t("freigabe_rest_gleich", "Die Zeit für diese Antwort ist gleich um.")
      : rest === 1
        ? t("freigabe_rest_eine", "Noch 1 Sekunde für deine Antwort.")
        : t("freigabe_rest_viele", "Noch $1 Sekunden für deine Antwort.", rest);
    $("freigabe-balken-fuellung").style.width =
      `${Math.max(0, Math.min(100, (uebrig / fristMs) * 100))}%`;
    /* Bei null schließt sich hier nichts. Ein „Nein" von der Uhr wäre eine
       Entscheidung, die der Mensch nie getroffen hat — und der Ausführer
       unterscheidet Ablehnung und Zeitablauf ausdrücklich. Weggeräumt wird die
       Karte von dem, der wirklich aufgehört hat zu warten
       (`link:freigabe-zurueckziehen`). */
    if (uebrig <= 0) freigabeUhrStoppen(false);
  };
  zeigen();
  freigabeUhr = setInterval(zeigen, 1000);
}

function freigabeUhrStoppen(verbergen = true) {
  if (freigabeUhr) {
    clearInterval(freigabeUhr);
    freigabeUhr = null;
  }
  if (verbergen) $("freigabe-rest").hidden = true;
}

/*
 * Wo der Fokus stand, bevor die Freigabekarte kam.
 *
 * Die Karte ist der einzige Teil der Leiste, der ungefragt dazwischentritt:
 * Sie erscheint, weil der Agent etwas will, nicht weil der Mensch etwas
 * gedrückt hat. Danach muss er dort weitermachen können, wo er war — sonst
 * kostet ihn jede einzelne Freigabe den Weg mit der Tabulatortaste vom
 * Seitenanfang zurück an seine Stelle.
 */
let fokusVorFreigabe = null;

/* Die Freigabekarte gibt den Fokus zurück, BEVOR sie verschwindet: Ein
   verstecktes Element hält ihn nicht, und die Frage danach, wo er stand, ist
   dann nicht mehr zu beantworten. Steht er inzwischen woanders, weil der Mensch
   selbst weitergegangen ist, bleibt er dort. */
function freigabeFokusZurueckgeben() {
  const ziel = fokusVorFreigabe;
  fokusVorFreigabe = null;
  if (!ziel || !$("freigabe").contains(document.activeElement)) return false;
  if (ziel.hidden || ziel.disabled || typeof ziel.focus !== "function") return false;
  ziel.focus();
  return document.activeElement === ziel;
}

function freigabeHolen(frage, quelle = "", fristMs = 0) {
  return new Promise((aufloesen) => {
    $("freigabe-text").textContent = frage;
    const q = $("freigabe-quelle");
    if (quelle) {
      q.textContent = `Beschriftung auf der Seite: „${quelle}“`;
      q.hidden = false;
    } else {
      q.textContent = "";
      q.hidden = true;
    }
    freigabeUhrStarten(fristMs);
    /* Merken, bevor die Karte den Fokus bekommt — danach steht dort sie. */
    fokusVorFreigabe = document.activeElement;
    $("freigabe").hidden = false;
    zustand.freigabeLaeuft = aufloesen;
    /* Der Hauptbedienweg des Inhabers ist das Vorlesen: Was nur in der Karte
       steht, hat ihn nicht erreicht. Die unbekannte Restzeit gehört deshalb in
       DIESELBE Ansage wie die Frage — eine zweite bräche die erste ab. Nur
       wenn wirklich jemand wartet (fristMs === 0) und niemand weiß, wie lange:
       Beim Beispielauftrag (null) gibt es keine Zeit, über die zu reden wäre. */
    ansagen(
      t("freigabe_frage_ansage", "$1 Freigeben oder ablehnen?", frage) +
        (fristMs === 0 ? ` ${OHNE_UHR_ANSAGE}` : ""),
      true,
    );
    /* Vorausgewählt ist „Ablehnen", und dort landet auch der Fokus: Wer die
       Eingabetaste drückt, ohne hinzusehen, lehnt ab.
       Über `fokusHin` und nicht über ein blankes focus(): Tippt gerade jemand,
       bleibt der Fokus bei ihm. Sonst spränge die Eingabetaste mitten im Satz
       auf „Ablehnen" — der Mensch verlöre seinen Text und träfe zugleich eine
       Entscheidung, die er nie treffen wollte. Die Karte ist eine dringende
       Vorlesezone (`aria-live="assertive"`), gesagt wird sie also trotzdem. */
    fokusHin($("freigabe-nein"));
  });
}

function freigabeSchliessen(antwort) {
  if (!zustand.freigabeLaeuft) return;
  freigabeUhrStoppen();
  freigabeFokusZurueckgeben();
  $("freigabe").hidden = true;
  const f = zustand.freigabeLaeuft;
  zustand.freigabeLaeuft = null;
  f(antwort);
}

/* ------------------------------------------------------------------ *
 * Die Schritt-Freigabe für den Agenten
 *
 * Der Ausführer läuft im Hintergrunddienst, die Frage steht hier. Das ist
 * Absicht: Der Hintergrunddienst hat kein Fenster, und eine Rückfrage ohne
 * Fenster wäre keine.
 *
 * Fail-closed in jeder Richtung — es gibt genau einen Weg zu „ja", und der
 * führt über den Knopf:
 *
 *   - keine laufende Sitzung        → nein, mit Begründung „besetzt"
 *   - schon eine Frage offen        → nein, mit Begründung „besetzt"
 *   - Seitenleiste zu               → die Nachricht kommt gar nicht an, der
 *                                     Ausführer wertet das als Ablehnung
 *
 * „besetzt" ist dabei ausdrücklich kein Nein des Menschen. Der Ausführer
 * unterscheidet beides, damit dem Nutzer keine Entscheidung zugeschrieben
 * wird, die er nie getroffen hat.
 *
 * Und die Regel, die aus dem Bestand kommt und hier weiter gilt: In `frage`
 * steht nie Text von der besuchten Seite. Der Name eines Elements kommt als
 * `quelle` daneben — sichtbar, gekürzt, nicht vorgelesen.
 */
chrome.runtime.onMessage.addListener((n, _absender, antworten) => {
  if (!n || n.typ !== "link:schritt-freigabe") return false;

  if (!zustand.sitzung || zustand.sitzung.vorfuehrung || zustand.freigabeLaeuft) {
    antworten({ ja: false, besetzt: true });
    return false;
  }

  freigabeHolen(
    String(n.frage || t("freigabe_standardfrage", "Der Agent möchte einen Schritt ausführen.")),
    zitat(n.quelle),
    antwortfristMs(n)
  )
    .then((ja) => antworten({ ja: ja === true }))
    .catch(() => antworten({ ja: false }));
  return true; // die Antwort kommt später
});

chrome.runtime.onMessage.addListener((n) => {
  if (!n || typeof n.typ !== "string") return false;

  /* Der Ausführer wartet nicht mehr — die Karte muss weg, sonst beantwortet
     der Mensch eine Frage, auf die niemand mehr hört (spec-01 §3.6.3). */
  if (n.typ === "link:freigabe-zurueckziehen") {
    if (zustand.freigabeLaeuft) {
      freigabeSchliessen(false);
      protokollieren(t("protokoll_abgelaufen", "Abgelaufen: der Agent hat auf die Antwort nicht mehr gewartet"));
      /* Sichtbar UND hörbar. Bisher stand der Ablauf nur im Protokoll und in
         der Live-Region — und die (#ansage) ist ausschließlich für den
         Bildschirmleser da. Wer die Karte verschwinden sah, bekam dafür keine
         Erklärung (Befund Inhaber 29.07.). Die Sitzung läuft weiter: nicht
         passiert ist nur dieser eine Schritt. */
      sagen(
        "niemand",
        t(
          "freigabe_zurueckgezogen_blase",
          "Ich habe nicht länger auf deine Antwort gewartet. Dieser Schritt ist nicht passiert. " +
            "Sag mir, ob ich es noch einmal versuchen soll.",
        )
      );
      ansagen(
        t(
          "freigabe_zurueckgezogen_ansage",
          "Der Agent hat nicht länger gewartet. Dieser Schritt ist nicht passiert.",
        ),
        true,
      );
    }
    return false;
  }

  /* Was der Agent gerade tut, steht im Protokoll. Der Satz stammt vom Agenten
     und aus unseren eigenen Worten — Text von der Seite steht dort nie.
     Seit v3.5 kommen Befehl, Zeitpunkt und Ergebnis mit (Vertrag §6); `text`
     bleibt Pflicht, eine Meldung ohne die neuen Felder ist weiterhin gültig. */
  if (n.typ === "link:protokoll") {
    protokollieren({
      text: String(n.text || "").slice(0, 300),
      cmd: n.cmd,
      zeit: n.zeit,
      ergebnis: n.ergebnis,
    });
    return false;
  }

  /* Läuft eine Cloud-Sitzung, steht das durchgehend in der Leiste
     (Vertrag §8.4). Der Name kommt von außen und wird entschärft. */
  if (n.typ === "link:cloud-sitzung") {
    cloudSitzungZeigen(n.an === true, n.agent);
    return false;
  }

  /* Und was dabei herausgekommen ist. Bewusst knapp: Die ausführliche Fassung
     bekommt der Agent, der Mensch braucht die Zeile, die zeigt, dass etwas
     passiert ist. */
  if (n.typ === "link:befehl") {
    if (n.erfolg) protokollieren(t("protokoll_erledigt", "Erledigt: $1", String(n.cmd || "").slice(0, 40)));
    /* Der Satz, nicht die Kennung. Hier stand `n.fehler`, also der reine
       Maschinencode, und der Mensch las „Nicht ausgeführt: tab_gone". Der
       fertige Satz kommt jetzt als `klartext` mit; die Kennung bleibt für den
       Fall, dass einmal keiner mitkommt. */
    else
      protokollieren(
        t(
          "protokoll_nicht_ausgefuehrt",
          "Nicht ausgeführt: $1",
          String(n.klartext || n.fehler || t("fehler_schritt", "Der Schritt hat nicht geklappt.")).slice(0, 160),
        ),
      );
    return false;
  }

  return false;
});

/* ------------------------------------------------------------------ *
 * Beispielauftrag — liest die Seite und zeigt, was anklickbar wäre.
 * ------------------------------------------------------------------ */

async function demoAuftrag() {
  if (!zustand.sitzung) return;
  $("vorschlag").disabled = true;
  try {
    sagen("du", t("demo_frage", "Zeig mir, was hier anklickbar ist."));
    protokollieren(t("protokoll_lesen", "Lese die Seite: sichtbare Bedienelemente einsammeln"));
    const antwort = await anTab({ typ: "overlay:lesen", grenze: 5 });
    if (!antwort || !antwort.ok || !antwort.elemente.length) {
      sagen(
        "niemand",
        t("demo_nichts_blase", "Ich finde auf dieser Seite gerade nichts Anklickbares im sichtbaren Bereich."),
      );
      ansagen(t("demo_nichts_ansage", "Ich finde hier nichts Anklickbares im sichtbaren Bereich."));
      return;
    }
    const liste = antwort.elemente;

    sagen(
      "niemand",
      liste.length === 1
        ? t("demo_gefunden_eins", "Ich habe 1 Bedienelement gefunden und zeige es dir.")
        : t(
            "demo_gefunden_viele",
            "Ich habe $1 Bedienelemente gefunden und zeige sie dir eins nach dem anderen.",
            liste.length,
          )
    );

    for (const [i, el] of liste.entries()) {
      if (!zustand.sitzung || zustand.abgebrochen) return;
      const name = zitat(el.name);
      /* `null`: Diese Frage wartet in der Seitenleiste selbst, kein Ausführer
         hält dazu eine Frist. Eine Restzeitzeile wäre hier eine Erfindung. */
      const ja = await freigabeHolen(
        t("demo_schritt_frage", "Schritt $1 von $2: ein Bedienelement zeigen.", i + 1, liste.length),
        name,
        null
      );
      if (!zustand.sitzung || zustand.abgebrochen) return;
      if (!ja) {
        /* Protokollzeile und Ansage macht schon der Ablehnen-Knopf — hier
           käme sonst dieselbe Aussage doppelt, und die zweite Ansage bräche
           die erste mitten im Satz ab (sprich() bricht ab, bevor es spricht).
           Was hier fehlt, ist nur der Satz zum Beispielauftrag. */
        sagen("niemand", t("demo_abbruch", "Alles klar, dann lasse ich den Rest. Die Verbindung bleibt bestehen."));
        return;
      }
      await anTab({
        typ: "overlay:zeiger",
        x: el.mitte.x,
        y: el.mitte.y,
        beschriftung: el.name,
        rect: el.rect,
      });
      protokollieren(
        t("protokoll_zeigen", "Zeigen: „$1“ ($2, $3 von $4)", name, zitat(el.rolle, 20), i + 1, liste.length),
      );
      ansagen(t("demo_schritt_gezeigt", "Schritt $1 von $2 gezeigt.", i + 1, liste.length));
      await new Promise((r) => setTimeout(r, 1400));
    }

    await anTab({ typ: "overlay:zeiger", x: -200, y: -200 });
    protokollieren(t("protokoll_demo_fertig", "Fertig: alle gefundenen Elemente gezeigt"));
    sagen(
      "niemand",
      t("demo_fertig_blase", "Das war alles, was ich hier gefunden habe. Sag mir, was ich damit tun soll."),
    );
    ansagen(t("demo_fertig_ansage", "Auftrag erledigt."));
  } finally {
    $("vorschlag").disabled = false;
    /* Der Knopf war während des Auftrags abgeschaltet, und ein abgeschaltetes
       Element hält den Fokus nicht: Er fiel beim ersten Klick auf `body` und
       blieb dort liegen. Ist seitdem nichts anderes an seine Stelle getreten,
       bekommt der Knopf ihn zurück — er ist die Stelle, an der der Mensch
       gerade stand. */
    if (fokusIstLos()) fokusHin($("vorschlag"));
  }
}

/* ------------------------------------------------------------------ *
 * Der Betriebsmodus des Tabs (Vertrag §2)
 *
 * Drei Stufen, ein Umschalter, keine Klapptür. Der Modus gilt je Tab und liegt
 * beim Hintergrunddienst; was hier steht, ist die Bedienung davon. Die Liste
 * der Modi kommt aus net/befehle.js und wird hier nicht noch einmal
 * eingetippt — eine zweite Liste liefe genau dann auseinander, wenn eine Stufe
 * dazukäme.
 * ------------------------------------------------------------------ */

const modusText = (m) => MODUS_TEXT[m] || MODUS_TEXT[MODUS_STANDARD];

/* Für welchen Tab der Modus gilt. Läuft eine Sitzung, ist es ihrer; sonst der
   Tab, mit dem der eine Klick verbinden würde. Ein Modus ohne Tab wäre eine
   globale Einstellung, und genau die schließt Vertrag §2 aus. */
function modusTabId() {
  if (Number.isInteger(zustand.tabId)) return zustand.tabId;
  const t = zustand.aktuellerTab;
  return t && Number.isInteger(t.id) ? t.id : null;
}

function modusSpiegeln() {
  for (const m of MODI) {
    const knopf = $(`modus-${m}`);
    if (!knopf) continue;
    const gewaehlt = m === zustand.modus;
    knopf.setAttribute("aria-checked", String(gewaehlt));
    /* Wandertabulator: Der Umschalter ist EIN Halt in der Tabulatorreihe, die
       Wahl darin trifft man mit den Pfeiltasten. Drei einzelne Halte wären für
       jemanden, der sich durch die Leiste tabbt, drei Hindernisse. */
    knopf.setAttribute("tabindex", gewaehlt ? "0" : "-1");
  }
  const t = modusText(zustand.modus);
  $("modus-auskunft").textContent = t.auskunft;
  /* Der Riegel steht bei der Wahl und wird nie ausgeblendet: Er gilt in jedem
     Modus, also darf ihn kein Modus verstecken. */
  $("modus-riegel").textContent = MODUS_RIEGEL;
  /* Der Chip an der Eingabekarte spiegelt denselben Modus. Zwei Anzeigen mit
     zwei Wahrheiten waren schon einmal der Grund für einen Fehlbefund. */
  $("modus-chip").textContent = t.etikett;
}

/**
 * Den Modus setzen und ihn dem Hintergrunddienst sagen.
 *
 * Fail-closed: Ein Wert, der nicht in MODI steht, wird abgelehnt und ändert
 * nichts. Es gibt keinen Weg, über den eine fremde Angabe hier eine Stufe
 * einstellt, die niemand gewählt hat.
 *
 * @returns {Promise<boolean>} ob wirklich etwas gesetzt wurde
 */
async function modusSetzen(neu, { melden = true } = {}) {
  if (typeof neu !== "string" || !MODI.includes(neu)) return false;
  zustand.modus = neu;
  modusSpiegeln();
  const tabId = modusTabId();
  if (tabId !== null) await anWorker({ typ: "modus:setzen", tabId, modus: neu });
  if (melden) {
    const t = modusText(neu);
    /* Der Riegel wird beim selbständigen Modus mitgesprochen und sonst nicht.
       Das ist kein Zufall: Genau dort könnte das Etikett mehr versprechen, als
       gilt, und wer sich alles vorlesen lässt, muss die Grenze im selben
       Atemzug hören. In den anderen beiden Stufen wäre derselbe Satz jedes Mal
       Lärm, und Lärm überhört man. */
    ansagen(neu === "auto" ? `${t.etikett}. ${t.auskunft} ${MODUS_RIEGEL}` : `${t.etikett}. ${t.auskunft}`, true);
  }
  return true;
}

/* Beim Öffnen: Was gilt für diesen Tab? Die Wahrheit steht im
   Hintergrunddienst, nicht hier. Bekommt die Leiste keine oder eine unbekannte
   Auskunft, gilt die Voreinstellung aus dem Vertrag — nie die zuletzt
   angezeigte, denn die stammte aus einem anderen Tab. */
async function modusHolen() {
  let stand = null;
  const tabId = modusTabId();
  if (tabId !== null) stand = await anWorker({ typ: "modus:stand?", tabId });
  const gemeldet = stand && typeof stand.modus === "string" ? stand.modus : null;
  zustand.modus = gemeldet && MODI.includes(gemeldet) ? gemeldet : MODUS_STANDARD;
  modusSpiegeln();
}

/* ------------------------------------------------------------------ *
 * Die Cloud-Sitzung (Vertrag §8.4)
 * ------------------------------------------------------------------ */

/*
 * Die Dauerzeile „Cloud-Sitzung aktiv: …".
 *
 * Der Agentenname kommt vom Relay und damit von außen. Er geht deshalb durch
 * dieselbe Entschärfung wie jeder Fremdtext (`zitat`) und wird nie in einen
 * Satz eingebaut, den die Stimme spricht. Die Zeile selbst ist keine
 * Vorlesezone: Der Start der Sitzung wird einmal angesagt, danach ist sie eine
 * Auskunft, die dasteht (F7).
 */
function cloudSitzungZeigen(an, agent) {
  const zeile = $("cloud-zeile");
  if (!an) {
    zustand.cloudAgent = null;
    $("cloud-agent").textContent = "";
    zeile.hidden = true;
  } else {
    const name = zitat(agent, 40);
    zustand.cloudAgent = name || null;
    $("cloud-agent").textContent = name;
    zeile.hidden = false;
  }
  /* „Am Werk: …" auf der Startseite ist dieselbe Auskunft an einer zweiten
     Stelle, und sie wird hier nachgezogen statt vom Aufrufer erwartet: Zwei
     Anzeigen mit zwei Wahrheiten waren schon einmal der Grund für einen
     Fehlbefund (siehe modusSpiegeln). */
  startseiteZeichnen();
}

/* ------------------------------------------------------------------ *
 * Not-Aus
 *
 * Zusage aus Vertrag §5: Zwischen dem Ereignis und „nichts läuft mehr" liegt
 * weniger als eine Sekunde, und zwar ohne auf eine Antwort des Relays zu
 * warten. Erst kappen, dann melden.
 * ------------------------------------------------------------------ */

function notAus(grund = "notbremse") {
  const s = zustand.sitzung;
  if (!s) return Promise.resolve();
  /* Bewusst OHNE await: Der Dienst soll die Leitung sofort kappen, und diese
     Meldung darf den Abbau hier nicht aufhalten. Eine Vorführung hat keine
     Leitung, für sie gibt es nichts zu kappen. */
  if (!s.vorfuehrung) anWorker({ typ: "link:notaus", grund });
  return beenden("notbremse");
}

/* ------------------------------------------------------------------ *
 * Regeln, Abläufe und Protokollbuch (Vertrag §4 und §8.3)
 *
 * Gezeichnet werden beide Ansichten von src/panel/werkbank.js. Die
 * Seitenleiste holt die Daten, stellt den Anker hin und ruft. Fehlt die
 * Funktion dort, zeichnet sie eine schlichte Fassung selbst: Ein leerer Anker
 * wäre ein Weg ohne Antwort.
 * ------------------------------------------------------------------ */

function listeSelbstZeichnen(wurzel, zeilen, leerText) {
  wurzel.replaceChildren();
  if (!zeilen.length) {
    const p = document.createElement("p");
    p.className = "hinweis";
    p.textContent = leerText;
    wurzel.appendChild(p);
    return;
  }
  for (const zeile of zeilen) {
    const p = document.createElement("p");
    p.className = "hinweis";
    p.textContent = zeile;
    wurzel.appendChild(p);
  }
}

/*
 * Eine Zeichenkette als Datei anbieten.
 *
 * Bewusst ueber einen Verweis mit `data:`-Adresse und nicht ueber die
 * Download-Schnittstelle des Browsers: Dafuer braeuchte das Manifest eine
 * weitere Pflichtberechtigung, und eine Berechtigung fuer einen Knopf, der
 * einmal im Monat gedrueckt wird, ist zu teuer. Der Verweis bleibt danach
 * sichtbar stehen — fuehrt der Browser den Klick von sich aus nicht aus, ist
 * der Weg trotzdem da.
 *
 * Denselben Weg bekommt src/panel/werkbank.js als Dienst `ausgeben`
 * hingestellt, damit es nicht einen zweiten baut.
 */
function dateiAnbieten(text, dateiname) {
  const inhalt = typeof text === "string" ? text : "";
  if (!inhalt) return false;
  const verweis = $("buch-datei");
  const wann = zeitStempel(Date.now()).iso.slice(0, 19).replace(/[:T]/g, "-");
  const name = typeof dateiname === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(dateiname)
    ? dateiname
    : `smartrchrome-protokollbuch-${wann}.json`;
  verweis.setAttribute("href", `data:application/json;charset=utf-8,${encodeURIComponent(inhalt)}`);
  verweis.setAttribute("download", name);
  verweis.hidden = false;
  if (typeof verweis.click === "function") verweis.click();
  return true;
}

async function werkbankOeffnen() {
  setzeZustand("werkbank");
  ansagen(t("werkbank_ansage", "Regeln und Abläufe. Hier stellst du je Website ein, was ohne Rückfrage laufen darf."));
  /* Die Regeln je Domain (Vertrag §4) und die Abläufe (§7.3) sind zwei
     Ansichten und bekommen zwei Anker: Eine gemeinsame Wurzel hiesse, dass die
     eine beim Aufbau die andere wegräumt. */
  ankerBauen("matrix", werkbank.matrixAufbauen, $("matrix-inhalt"));
  const griff = ankerBauen("werkbank", werkbank.aufbauen, $("werkbank-inhalt"), {
    spielen: (id, params) => anWorker({ typ: "werkbank:spielen", id, params: params || {} }),
    ausgeben: dateiAnbieten,
    /* Der Weg des Menschen in den Teach-Modus (§7.2). Der Tab kommt von hier
       und nicht aus der Werkbank: Aufgezeichnet wird in dem Tab, den der
       Mensch gerade vor sich hat, und welcher das ist, weiss die Leiste. */
    aufnahmeStart: () => anWorker({ typ: "rekorder:start", tabId: modusTabId() }),
    aufnahmeStop: () => anWorker({ typ: "rekorder:stop", tabId: modusTabId() }),
  });
  if (griff) {
    if (typeof griff.laden === "function") await griff.laden();
    return "modul";
  }
  const antwort = await anWorker({ typ: "werkbank:liste" });
  const workflows = Array.isArray(antwort && antwort.workflows) ? antwort.workflows : [];
  listeSelbstZeichnen(
    $("werkbank-inhalt"),
    workflows.map((w) => zitat(w && (w.name || w.id), 80)).filter(Boolean),
    t(
      "werkbank_ersatz_leer",
      "Für diese Website ist noch nichts freigeschaltet, und gespeicherte Abläufe gibt es auch noch keine.",
    )
  );
  return "ersatz";
}

async function buchOeffnen() {
  setzeZustand("buch");
  $("buch-datei").hidden = true;
  ansagen(t("buch_ansage", "Protokollbuch. Jede Fernaktion steht hier mit Zeit, Agent und Adresse."));
  const griff = ankerBauen("buch", werkbank.buchAufbauen, $("buch-inhalt"), { ausgeben: dateiAnbieten });
  if (griff) {
    if (typeof griff.laden === "function") await griff.laden();
    return "modul";
  }
  const antwort = await anWorker({ typ: "buch:lesen", von: 0, bis: Date.now() });
  const eintraege = Array.isArray(antwort && antwort.eintraege) ? antwort.eintraege : [];
  listeSelbstZeichnen(
    $("buch-inhalt"),
    eintraege.map((e) => {
      const zeit = zeitStempel(e && e.zeit);
      return `${zeit.kurz} ${zitat(e && e.agent, 24)} ${zitat(e && e.cmd, 24)} ${zitat(e && e.url, 60)}`.trim();
    }),
    t(
      "buch_ersatz_leer",
      "Es steht noch nichts im Protokollbuch. Sobald ein Agent von außen etwas tut, kommt hier eine Zeile dazu.",
    )
  );
  return "ersatz";
}

/*
 * Das Protokollbuch als Datei — der Knopf, der immer da ist.
 *
 * Er holt die Ausgabe beim Dienst (Vertrag §6, `buch:ausgeben`) und legt sie
 * in denselben Verweis, den auch werkbank.js benutzt. Kommt nichts zurueck,
 * wird nichts behauptet: eine Absage mit Weg statt eines toten Knopfes.
 */
async function buchAusgeben() {
  const antwort = await anWorker({ typ: "buch:ausgeben" });
  const json = antwort && typeof antwort.json === "string" ? antwort.json : "";
  if (!dateiAnbieten(json)) {
    stoerung(
      t("fehler_buch_ausgabe", "Ich konnte das Protokollbuch gerade nicht ausgeben. Versuche es bitte gleich noch einmal.")
    );
    return false;
  }
  ansagen(t("buch_datei_bereit", "Das Protokollbuch liegt als Datei bereit."), true);
  return true;
}

/* ------------------------------------------------------------------ *
 * Ereignisse
 * ------------------------------------------------------------------ */

/* Der Regelweg: ein Klick, eine Verbindung. Der Dialog daneben bleibt der Weg
   für Dauer und Geltung. */
$("verbinden-tab").addEventListener("click", tabVerbinden);
$("trennen").addEventListener("click", () => beenden("nutzer"));
$("verbinden-start").addEventListener("click", dialogVorbereiten);

/* Der Umschalter. Die Modi kommen aus dem Vertrag, nicht aus dieser Datei —
   kommt eine Stufe dazu, hängt sie hier von selbst mit drin, sobald sie einen
   Knopf hat. */
for (const m of MODI) {
  const knopf = $(`modus-${m}`);
  if (knopf) knopf.addEventListener("click", () => modusSetzen(m));
}

/* Die Rueckgabe wird durchgereicht und nicht verschluckt: Wer den Punkt
   drueckt, wartet auf eine Ansicht, und ein Aufrufer, der nicht warten kann,
   sieht eine leere. */
$("menue-werkbank").addEventListener("click", () => {
  menueOeffnen(false);
  return werkbankOeffnen();
});
$("menue-buch").addEventListener("click", () => {
  menueOeffnen(false);
  return buchOeffnen();
});
$("werkbank-zurueck").addEventListener("click", () => {
  setzeZustand(zustand.sitzung ? "aktiv" : "bereit");
});
$("buch-zurueck").addEventListener("click", () => {
  setzeZustand(zustand.sitzung ? "aktiv" : "bereit");
});
$("buch-ausgeben").addEventListener("click", buchAusgeben);
$("menue-verbinden").addEventListener("click", () => {
  menueOeffnen(false);
  dialogVorbereiten();
});
$("dialog-abbrechen").addEventListener("click", () => {
  setzeZustand(zustand.sitzung ? "aktiv" : "bereit");
  ansagen(ABGEBROCHEN_OHNE_VERBINDUNG);
});
/* Stufe und Dauer sind wieder Auswahlfelder — die Zusammenfassung folgt der
   Auswahl, damit vorgelesen wird, was wirklich beantragt wird. */
$("dialog").addEventListener("change", (e) => {
  if (e.target && (e.target.name === "dauer" || e.target.name === "stufe")) {
    zusammenfassen();
    /* Und die Zeile am einen Klick zieht mit: Sie beantragt dieselbe Stufe,
       und sie darf keinen Augenblick lang eine andere nennen (M8). */
    verbindenStufeZeigen();
    /* Gemerkt wird beim Wählen, nicht erst beim Verbinden: Wer den Dialog
       abbricht, hat trotzdem gewählt — und findet seine Wahl beim nächsten
       Mal wieder vor. */
    auswahlMerken();
  }
});
$("verbinden").addEventListener("click", verbinden);
/* Dauer und Stufe aufklappen. Rein für die Anzeige — die Auswahl selbst und der
   Verbindungsweg bleiben unverändert. Beim Aufklappen wandert der Fokus auf die
   erste Angabe, damit der Weg ohne Maus weitergeht. */
$("einstellungen-aendern").addEventListener("click", () => {
  const auf = $("dialog-mehr").hidden;
  $("dialog-mehr").hidden = !auf;
  $("einstellungen-aendern").setAttribute("aria-expanded", String(auf));
  if (auf) {
    const erstes = $("dialog-mehr").querySelector('input[name="dauer"]:checked')
      || $("dialog-mehr").querySelector('input[name="dauer"]');
    if (erstes && erstes.focus) erstes.focus();
    ansagen(t("dialog_mehr_ansage", "Dauer und Stufe. Ändere, was du möchtest, dann auf Verbindung herstellen."));
  }
});
$("vorfuehrung").addEventListener("click", vorfuehrungStarten);

/* Erklärkarte: „Zurück" führt dorthin, wo der Nutzer herkam — in eine
   laufende Sitzung oder in den Ruhezustand. Der zweite Knopf trägt die
   Handlung, die zur Erklärung gehört (Tab neu laden, noch einmal versuchen). */
$("erklaer-zurueck").addEventListener("click", () => {
  setzeZustand(zustand.sitzung ? "aktiv" : "bereit");
  ansagen(t("dialog_erklaer_ansage", "Verstanden. Es wurde nichts verändert."));
});
$("erklaer-tun").addEventListener("click", () => {
  const tun = erklaerAktion;
  if (tun) tun();
});

/* Anmeldung: kein Passwortfeld, nur der Weg zur echten Anmeldeseite. */
$("zur-anmeldung").addEventListener("click", async () => {
  try {
    await konto.anmeldeseiteOeffnen();
    ansagen(
      t("dialog_anmeldung_geoeffnet", "Ich habe die Anmeldeseite geöffnet. Melde dich dort an und komm dann hierher zurück."),
      true
    );
  } catch (fehler) {
    stoerung(klartextVon(fehler));
  }
});
$("anmeldung-nochmal").addEventListener("click", async () => {
  const ausweis = await konto.ausweisBesorgen();
  if (!ausweis) {
    /* Kein Ausweis heißt nicht zwangsläufig „nicht angemeldet". Ist ein
       Cloud-Tab offen, fehlt nur die Übergabe — dann bekommt der Nutzer den
       Knopf, der sie auslöst, statt eines Satzes, der ihn ratlos lässt. */
    await ausweisFehltErklaeren();
    return;
  }
  zustand.ausweis = ausweis;
  stoerung(null);
  ansagen(konto.ausweisBeschreiben(ausweis), true);
  await guthabenLaden();
  await dialogVorbereiten();
});
$("anmeldung-abbrechen").addEventListener("click", () => {
  /* Läuft eine Sitzung, MUSS der Zustand `aktiv` bleiben: `bereit` versteckt
     die Sitzungsleiste (siehe setzeZustand) und damit den Stopp-Knopf, während
     der Agent seine Rechte auf dem Tab behält. Geräumt wird `zustand.sitzung`
     ausschließlich in beenden(). Gleiche Bedingung wie bei den Geschwistern. */
  setzeZustand(zustand.sitzung ? "aktiv" : "bereit");
  ansagen(
    zustand.sitzung
      ? t("dialog_abgebrochen_laufend", "Abgebrochen. Die laufende Verbindung bleibt bestehen, Stopp ist weiter da.")
      : ABGEBROCHEN_OHNE_VERBINDUNG,
  );
});

/* Kennwortschritt: abbrechen bricht wirklich ab — die laufende Abfrage
   hört sofort auf, statt noch einen Takt weiterzulaufen. */
$("kennwort-abbrechen").addEventListener("click", async () => {
  if (zustand.abbruch) zustand.abbruch.abort();
  await aufbauAbbrechen(null);
  ansagen(t("dialog_abgebrochen_kennwort", "Abgebrochen. Es ist keine Verbindung entstanden."), true);
});
$("kennwort-erneut").addEventListener("click", async () => {
  if (!zustand.freigabeAdresse) return;
  try {
    await ticket.freigabeseiteOeffnen(zustand.freigabeAdresse);
  } catch (fehler) {
    stoerung(klartextVon(fehler));
  }
});

/* Der Stopp-Knopf ist der Not-Aus, nicht das höfliche Beenden. Das höfliche
   Beenden steht als „Trennen" an der Statuskarte. Der Unterschied ist kein
   Wortspiel: Der Not-Aus meldet dem Dienst zuerst und wartet auf nichts. */
$("stopp").addEventListener("click", () => notAus());
$("menue-beenden").addEventListener("click", () => {
  menueOeffnen(false);
  beenden("nutzer");
});
$("freigabe-ja").addEventListener("click", () => freigabeSchliessen(true));
/*
 * Befund Inhaber 29.07.: Ein einziges „Ablehnen" beendete die GANZE Sitzung —
 * obwohl beide Seiten das Gegenteil zusagen. Der Dialog verspricht „Jeden
 * Schritt bestätigst du einzeln", und der Ausführer sagt dem Agenten
 * ausdrücklich „Das ist kein Fehler. Plane anders." Ein Nein ist also genau
 * das: Dieser eine Schritt findet nicht statt. Beendet wird über den
 * Stopp-Knopf, der direkt daneben steht.
 */
$("freigabe-nein").addEventListener("click", () => {
  freigabeSchliessen(false);
  protokollieren(t("protokoll_abgelehnt", "Abgelehnt: dieser Schritt findet nicht statt"));
  ansagen(
    t(
      "freigabe_abgelehnt_ansage",
      "Abgelehnt. Dieser Schritt findet nicht statt, die Verbindung bleibt bestehen. " +
        "Zum Beenden drückst du auf Stopp.",
    ),
    true
  );
});
$("vorschlag").addEventListener("click", demoAuftrag);

/*
 * ＋ beginnt ein neues Gespräch: neuer Kontext beim Server, laufender
 * Botengang wird gestoppt. Eine bestehende Browser-Verbindung bleibt
 * unberührt — Gespräch und Steuerung sind getrennte Dinge.
 *
 * Befund Inhaber 29.07.: Aufgeräumt wurde bisher nur der Gesprächskontext.
 * Der Browser-Auftrag blieb stehen, und die nächste Frage lief entweder in
 * den 409-Riegel des Gateways („Der Agent verarbeitet noch die vorherige
 * Nachricht") oder in einen Kontext, der zum neuen Gespräch nicht mehr passte.
 * Ein neues Gespräch räumt deshalb BEIDE Kontexte weg. Die Sitzung selbst
 * bleibt bestehen — sie wird gleich danach an einen frischen Auftrag gebunden,
 * sonst hätte der Agent zwar die Freigabe, aber keine Hände mehr.
 */
$("neu").addEventListener("click", async () => {
  $("verlauf").replaceChildren();
  $("protokoll").replaceChildren();
  $("protokoll-box").hidden = true;
  chatWartenZeigen(false);
  zustand.browserKontext = null;
  eingabePlatzhalterSetzen();
  /* Der Verlauf ist jetzt leer, also muss der Leerzustand zurück. Ohne diesen
     Aufruf bleibt die Hauptfläche nach „Neues Gespräch" schlicht leer, weil
     setzeZustand die Sichtbarkeit von #leer an die Zahl der Blasen knüpft und
     seit dem Leeren niemand mehr nachgerechnet hat. */
  setzeZustand(zustand.sitzung ? "aktiv" : "bereit");
  await chatKontextMerken(null);
  await anWorker({ typ: "chat:neu" });
  ansagen(t("kopf_neues_gespraech_ansage", "Neues Gespräch. Die Verbindung bleibt, wie sie ist."));
  if (zustand.sitzung && !zustand.sitzung.vorfuehrung) await agentenBindung();
});

/* Menü */
$("menue-knopf").addEventListener("click", () => menueOeffnen($("menue").hidden));
document.addEventListener("click", (e) => {
  if (!$("menue").hidden && !e.target.closest("#menue") && !e.target.closest("#menue-knopf")) {
    menueOeffnen(false);
  }
});
for (const b of document.querySelectorAll("[data-vorlesen]")) {
  b.addEventListener("click", async () => {
    zustand.vorlesen = b.dataset.vorlesen;
    await chrome.storage.local.set({ vorlesen: zustand.vorlesen }).catch(() => {});
    menueSpiegeln();
    menueOeffnen(false);
    if (zustand.vorlesen === "aus") speechSynthesis.cancel();
    const worte = {
      aus: t("kopf_vorlesen_aus_ansage", "Vorlesen ist aus."),
      sicher: t("kopf_vorlesen_sicher_ansage", "Ich lese nur noch wichtige Ansagen vor."),
      alles: t("kopf_vorlesen_alles_ansage", "Ich lese alles vor."),
    };
    $("ansage").textContent = worte[zustand.vorlesen];
    if (zustand.vorlesen !== "aus") sprich(worte[zustand.vorlesen]);
  });
}
$("menue-sicht").addEventListener("click", async () => {
  zustand.grosseSicht = !zustand.grosseSicht;
  await chrome.storage.local.set({ grosseSicht: zustand.grosseSicht }).catch(() => {});
  menueSpiegeln();
  anTab({ typ: "overlay:gross", gross: zustand.grosseSicht });
  ansagen(
    zustand.grosseSicht
      ? t("kopf_sicht_an", "Große Sichtbarkeit an.")
      : t("kopf_sicht_aus", "Große Sichtbarkeit aus."),
  );
});

/* Der Antwortmodus — Normal Mode oder SMarTrMode, nach dem Muster von
   grosseSicht: merken, spiegeln, ansagen. Der aktive Knopf trägt
   aria-pressed; angezeigt wird nur der Produktname des Modus. */
function chatModusSpiegeln() {
  $("modus-normal").setAttribute("aria-pressed", String(zustand.chatModus === "normal"));
  $("modus-smartr").setAttribute("aria-pressed", String(zustand.chatModus === "smartr"));
}

async function chatModusSetzen(modus) {
  zustand.chatModus = modus === "smartr" ? "smartr" : "normal";
  await chrome.storage.local.set({ chatModus: zustand.chatModus }).catch(() => {});
  chatModusSpiegeln();
  ansagen(
    zustand.chatModus === "smartr"
      ? t("chat_modus_smartr", "SMarTr Modus.")
      : t("chat_modus_normal", "Normal Modus."),
  );
}

$("modus-normal").addEventListener("click", () => chatModusSetzen("normal"));
$("modus-smartr").addEventListener("click", () => chatModusSetzen("smartr"));
/* Zustands-Chip klappt die Erklärung auf — nie eine Auswahl. */
$("zustand-chip").addEventListener("click", () => {
  const e = $("zustand-erklaerung");
  const offen = e.hidden;
  e.textContent = zustand.sitzung
    ? t(
        "kopf_chip_sitzung",
        "Der Agent ist auf diesem Tab: $1. Die Freigabe endet mit der Sitzung und wird zurückgegeben.",
        STUFENTEXT[zustand.sitzung.stufe]?.etikett,
      )
    : zustand.ausweis
      ? t(
          "kopf_chip_angemeldet",
          "Du bist angemeldet; Konto und Guthaben sind verbunden. Eine Steuersitzung läuft gerade " +
            "nicht. Öffne die Seite, die der Agent bedienen soll, und drücke dort auf " +
            "Mit diesem Tab verbinden.",
        )
      : t(
          "kopf_chip_getrennt",
          "Es besteht keine Verbindung. Der Agent kann auf dieser Seite nichts sehen und nichts tun.",
        );
  e.hidden = !offen;
  $("zustand-chip").setAttribute("aria-expanded", String(offen));
});

/* Vorlesen auf Knopfdruck — der Weg, der immer funktioniert. */
$("vorlesen-knopf").addEventListener("click", () => {
  if (!zustand.letzteRede) {
    $("ansage").textContent = t("kopf_nichts_vorzulesen", "Es gibt noch nichts vorzulesen.");
    return;
  }
  sprich(zustand.letzteRede);
});

/* ------------------------------------------------------------------ *
 * Das Gespräch mit Niemand — echt, über das Gateway.
 *
 * Der Chat braucht KEINE Browser-Sitzung: Mit dem Agenten reden geht immer,
 * den Browser steuern ist ein getrennter, zusätzlicher Weg. Die Frage geht
 * an den Service Worker (chat:senden), der die Antwort abholt — auch dann,
 * wenn diese Seitenleiste zwischendurch zugeht. Sie kommt als `chat:antwort`
 * zurück. Modellnamen des Backends erscheinen hier nie; es spricht Niemand.
 * ------------------------------------------------------------------ */

const WARTEWORT = t("chat_warten", "Niemand arbeitet …");

function chatWartenZeigen(an, fuer = null) {
  zustand.chatLaeuft = an;
  zustand.chatLaeuftFuer = an ? fuer : null;
  $("kostenhinweis").textContent = an ? WARTEWORT : "";
  $("senden").disabled = an;
}

/*
 * Was der Agent gerade tut — die Live-Schritte aus dem Abfragen.
 *
 * Befund Inhaber 29.07.: Zwischen Frage und Antwort standen bis zu zehn
 * Minuten lang „Niemand arbeitet …" und sonst nichts. Das Gateway liefert die
 * Schritte beim Abfragen längst mit; sie kamen nur nie bis hierher.
 *
 * Drei Entscheidungen, die man dem Code ansehen soll:
 *
 *  - Die Schritte stammen vom Agenten, nicht von der besuchten Seite. Sie
 *    dürfen deshalb in Sätzen stehen — gedeckelt und von Steuerzeichen
 *    befreit werden sie trotzdem, mit demselben zitat() wie Fremdtext. Ein
 *    Agent, der eine Seite zitiert, würde sonst genau das Loch aufmachen, das
 *    zitat() zuhält.
 *  - Vorgelesen wird von selbst nur in der Stufe „alles". Ein Schritt alle
 *    zwei Sekunden wäre keine Ansage, sondern Lärm — und jede neue Ansage
 *    bricht die vorige mitten im Satz ab.
 *  - Er landet aber immer in der Live-Region, in der Wartezeile und als letzte
 *    Rede. Damit sagt der 🔊-Knopf jederzeit, woran der Agent gerade ist —
 *    der Weg, der für den Inhaber immer funktioniert.
 */
/* Die fünf Arten, auf die der Chat-Weg die Schritte des Gateways abbildet
   (net/chat.js, `schritteLesen`). Was nicht darunterfällt, heißt „Arbeitet" —
   ein Wort zu viel ist besser als eine Zeile ohne Kopf. */
const ARBEITET = t("chat_schritt_info", "Arbeitet");
const SCHRITTWORT = {
  thinking: t("chat_schritt_thinking", "Überlegt"),
  tool_call: t("chat_schritt_tool", "Werkzeug"),
  response: t("chat_schritt_response", "Sagt"),
  error: t("chat_schritt_error", "Störung beim Agenten"),
  info: ARBEITET,
};

function schrittZeigen(roh) {
  if (!roh) return;
  /* Auf der Leitung heißen die Felder type/tool; welche Fassung der Chat-Weg
     weiterreicht, entscheidet ein anderer Bereich. Beide Namen zu verstehen
     kostet nichts — an einem Wort sterben sollte diese Anzeige nicht. */
  const art = String(roh.art || roh.type || "").toLowerCase();
  const werkzeug = zitat(roh.werkzeug || roh.tool || "", 40);
  const text = zitat(roh.text || "", 160);
  if (!text && !werkzeug) return;

  /* `art` kommt von außen und wird deshalb nur als eigener Schlüssel gelesen.
     Ohne diese Prüfung lieferte etwa die Art „constructor" den Object-
     Konstruktor — und der stünde als ganzer Quelltext im Protokoll. */
  const wort = Object.hasOwn(SCHRITTWORT, art) ? SCHRITTWORT[art] : ARBEITET;
  const kopf = werkzeug ? t("chat_schritt_werkzeug", "Werkzeug $1", werkzeug) : wort;
  const zeile = text ? t("chat_zeile", "$1: $2", kopf, text) : kopf;
  protokollieren(zeile);
  /* Die Wartezeile ist die einzige Stelle, die immer sichtbar ist — das
     Protokoll darf der Nutzer zuklappen. Dort steht deshalb die Kurzfassung. */
  if (zustand.chatLaeuft) {
    $("kostenhinweis").textContent = t(
      "chat_zeile",
      "$1: $2",
      WARTEWORT.replace(" …", ""),
      zitat(text || werkzeug, 40),
    );
  }
  /*
   * Steht gerade eine Freigabefrage offen, gehört die Live-Region ihr.
   *
   * Befund Gegenlesung 29.07.: Die Schritte treffen im Zwei-Sekunden-Takt ein
   * (net/chat.js, CHAT_TAKT_MS) — der Schritt zu genau dem Befehl, der zur
   * Freigabe steht, kommt also mit der Karte zusammen an. `ansagen` überschrieb
   * dann #ansage UND die letzte Rede: Der 🔊-Knopf las „Werkzeug click: …"
   * statt der Frage, die der Mensch beantworten soll, und in der Stufe „alles"
   * brach `sprich()` die vorgelesene Frage mitten im Satz ab. Genau dieser
   * Fehler ist schon einmal ausgebaut worden (Beispielauftrag) und an der Uhr
   * mit aria-live="off" verhindert worden.
   *
   * Was der Agent tut, steht deshalb weiterhin im Protokoll und in der
   * Wartezeile — es spricht nur nicht dazwischen.
   */
  if (!zustand.freigabeLaeuft) ansagen(zeile);
}

async function chatKontextMerken(contextId) {
  zustand.chatKontext = contextId || null;
  try {
    if (contextId) await chrome.storage.session.set({ chat_kontext: contextId });
    else await chrome.storage.session.remove("chat_kontext");
  } catch (_) {
    /* Ohne Ablage beginnt das nächste Öffnen ein neues Gespräch. */
  }
}

/* Chat-Fehler nach der Regel vom 28.07.: konkreter Grund in die Störungszeile
   UND in die Sprachausgabe; bei abgelaufener Anmeldung die Anmeldekarte statt
   eines kryptischen Fehlers. */
async function chatFehlerZeigen(kennung, klartext) {
  chatWartenZeigen(false);
  if (kennung === "anmeldung") {
    await konto.ausweisVerwerfen();
    zustand.ausweis = null;
    setzeZustand("anmeldung");
    ansagen(
      t("fehler_anmeldung_abgelaufen", "Deine Anmeldung gilt nicht mehr. Melde dich bitte in der Cloud neu an, dann reden wir weiter."),
      true
    );
    return;
  }
  stoerung(
    klartext ||
      t(
        "fehler_intern",
        "In der Erweiterung ist etwas schiefgegangen. Deine Frage ist nicht angekommen. Das liegt an uns, nicht an dir.",
      )
  );
}

$("chatform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("eingabe").value.trim();
  if (!text) return;
  if (zustand.chatLaeuft) {
    ansagen(t("chat_noch_beschaeftigt", "Ich arbeite noch an deiner vorigen Frage. Warte bitte, bis die Antwort da ist."), true);
    return;
  }

  /* Ohne Ausweis keine Frage — aber auch kein kryptischer Fehler: Je nach Lage
     zeigt die Erklärkarte den Weg (Cloud-Tab neu laden) oder die Anmeldekarte
     die Anmeldung. Ein Passwortfeld gibt es hier nicht, und es kommt auch
     keines. */
  const ausweis = zustand.ausweis || (await konto.ausweisBesorgen());
  if (!ausweis) {
    await ausweisFehltErklaeren();
    return;
  }
  zustand.ausweis = ausweis;

  stoerung(null);
  sagen("du", text);
  $("eingabe").value = "";
  $("eingabe").style.height = "";

  /* Läuft eine gebundene Browsersitzung, geht die Frage an den
     Browser-Auftrag (Profil smartr-browser) — dort hat der Agent die
     Werkzeuge für diesen Tab. Ohne Sitzung bleibt es das normale Gespräch.
     Wem die Frage gehört, wird mitgeführt: Beim Beenden der Sitzung wird
     genau der Browser-Auftrag gestoppt und kein gewöhnliches Gespräch. */
  const anBrowser = !!(zustand.sitzung && !zustand.sitzung.vorfuehrung && zustand.browserKontext);
  chatWartenZeigen(true, anBrowser ? "browser" : "gespraech");

  const antwort = await anWorker({
    typ: "chat:senden",
    text,
    contextId: anBrowser ? zustand.browserKontext : zustand.chatKontext,
    ausweis: ausweis.token,
    /* Der gewählte Antwortmodus reist mit — der Worker reicht ihn bis in den
       Netz-Body durch (net/chat.js). */
    modus: zustand.chatModus,
  });

  if (!antwort || !antwort.ok) {
    await chatFehlerZeigen(
      antwort && antwort.kennung,
      (antwort && antwort.klartext) || DIENST_STUMM
    );
    return;
  }
  /* Der Browser-Auftrag wird nie zum Alltagsgespräch: Sein Kontext bleibt in
     `browserKontext` und verfällt mit der Sitzung. */
  if (!anBrowser) await chatKontextMerken(antwort.contextId);
});

$("eingabe").addEventListener("input", (e) => {
  e.target.style.height = "auto";
  e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
});
$("eingabe").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("chatform").requestSubmit();
  }
});

chrome.runtime.onMessage.addListener((n) => {
  /* Der Zählerstand der Aufzeichnung (§6, `rekorder:stand`). Er kommt aus dem
     Tab und wird angezeigt, nicht geglaubt: Die Werkbank stellt damit nichts
     ein, sie zeigt nur, dass mitgeschrieben wird. Eine Aufnahme, von der der
     Mensch nichts sieht, wäre eine Mitschrift, um die niemand gebeten hat. */
  if (n.typ === "rekorder:stand") {
    const wb = anker.werkbank;
    if (wb && typeof wb.aufnahmeStandSetzen === "function") {
      wb.aufnahmeStandSetzen({ anzahl: n.anzahl, laeuft: n.laeuft === true });
    }
  }

  /* Die Notbremse hat mehrere Absender: Esc Esc im Tab, der Stoppknopf im
     Schild (`quelle: "schild"`, Vertrag v3.5 §5), das Tastenkürzel und die
     Seitenleiste selbst. Gestoppt wird immer gleich; nur der Satz sagt, wo der
     Mensch gedrückt hat. Ein unbekannter Absender endet in demselben Stopp mit
     dem allgemeinen Satz — eine Quelle, die niemand kennt, darf keine
     Notbremse verschlucken. */
  if (n.typ === "notbremse:an-panel" && zustand.sitzung) {
    beenden("notbremse", NOTBREMSE_SAETZE[n.quelle] || null);
  }

  /* Die Live-Schritte des laufenden Auftrags. Der Chat-Weg meldet sie im Bund
     (`chat:schritte`, net/chat.js); der Einzahlname und die rohen Feldnamen
     des Gateways werden mitverstanden, damit diese Anzeige nicht an einem Wort
     stirbt — sie ist die einzige Rückmeldung in bis zu zehn Minuten Warten. */
  if (n.typ === "chat:schritte" || n.typ === "chat:schritt") {
    const schritte = Array.isArray(n.schritte) ? n.schritte : Array.isArray(n.steps) ? n.steps : [n];
    for (const s of schritte) schrittZeigen(s);
  }

  /* Die Antwort des Agenten, abgeholt vom Service Worker. Sie kommt auch
     dann an, wenn die Frage vor dem letzten Schließen der Seitenleiste
     gestellt wurde. Danach wird das echte Guthaben neu geladen — abgerechnet
     hat der Server, hier wird nur nachgesehen. */
  if (n.typ === "chat:antwort") {
    if (n.ok) {
      chatWartenZeigen(false);
      if (n.contextId && n.contextId !== zustand.browserKontext) chatKontextMerken(n.contextId);
      sagen("niemand", String(n.text || ""));
      merkenUndSprechen(String(n.text || ""));
      guthabenLaden();
    } else {
      chatFehlerZeigen(n.kennung, n.klartext);
    }
  }

  /* Die Cloud-Seite hat den Ausweis herübergereicht (worker.js, Kanal
     `smartrlink:ausweis`).
     Das gilt jetzt in JEDEM Zustand, nicht nur auf der Anmeldemaske: Wer die
     Erweiterung bei offenem Cloud-Tab installiert hat, sieht die Anmeldemaske
     nie — er sieht nur eine Guthabenzeile ohne Zahl. Sobald der Ausweis da
     ist, wird deshalb erst das Guthaben nachgeladen, und nur wer wirklich
     wartete, wird weitergeführt. */
  if (n.typ === "konto:ausweis") {
    konto.ausweisBesorgen().then((ausweis) => {
      if (!ausweis) return;
      zustand.ausweis = ausweis;
      zustandChipSetzen();
      stoerung(null);
      guthabenLaden();
      const wartete =
        app.dataset.state === "anmeldung" || app.dataset.state === "erklaerung";
      if (!wartete) return;
      ansagen(konto.ausweisBeschreiben(ausweis), true);
      /* Aus der Anmeldemaske heraus wollte der Nutzer verbinden; aus der
         Erklärkarte heraus wollte er nur seine Anmeldung zurück. */
      if (app.dataset.state === "anmeldung") dialogVorbereiten();
      else setzeZustand(zustand.sitzung ? "aktiv" : "bereit");
    });
  }

  /* Die Cloud-Seite meldet die Abmeldung. Der Ausweis ist in der Ablage schon
     weg — hier muss er noch aus dem Zustand der Seitenleiste verschwinden,
     sonst zeigt sie weiter „Angemeldet als …" und schickt beim nächsten
     Versuch ein Token los, das es nicht mehr gibt.

     Eine laufende Sitzung wird dabei bewusst NICHT gekappt: Sie steht auf dem
     Einweg-Ticket, nicht auf der Anmeldung. Identität ist keine Steuerbefugnis
     (spec-01, 1.1) — und was der Nutzer freigegeben hat, endet, wenn er es
     beendet oder die Zeit abläuft, nicht durch ein Abmelden nebenan. */
  if (n.typ === "konto:abgemeldet") {
    zustand.ausweis = null;
    zustandChipSetzen();
    if (app.dataset.state === "anmeldung") {
      ansagen(t("fehler_abgemeldet", "Du bist in der Cloud jetzt abgemeldet. Melde dich dort an, dann geht es weiter."), true);
    }
  }

  /* Der Service Worker meldet, wenn die Verbindung von sich aus endet —
     Zeit um, Leerlauf, Widerruf, oder der Worker war zwischendurch weg.
     Wiederaufgebaut wird nichts: Wer wieder steuern will, gibt neu frei. */
  if (n.typ === "link:zustand" && n.verbunden === false) {
    if (zustand.sitzung && !zustand.sitzung.vorfuehrung) {
      beenden(n.grund === "abgelaufen" ? "abgelaufen" : "verloren", n.klartext);
    }
  }
});

/* Geht die Seitenleiste neu auf, während eine Sitzung läuft, holt sie sich
   den Zustand beim Service Worker. Die Wahrheit steht dort, nicht hier. */
async function zustandNachfragen() {
  const laufend = await anWorker({ typ: "link:zustand?" });
  if (!laufend || !laufend.verbunden) return;
  /* Die Sitzung sagt selbst, an welchem Tab sie hängt. Genau das wurde hier
     übergangen: Es zählte der gerade aktive Tab. Wer die Seitenleiste in einem
     anderen Tab wieder öffnete, band die Oberfläche an den falschen, und das
     Abschalten des Rahmens traf danach die falsche Seite. Der aktive Tab ist
     nur noch der Rückfall für den Fall, dass die Sitzung nichts mitbringt. */
  const tab = await aktiverTab();
  const u = tab ? ursprungAus(tab.url || "") : null;
  if (Number.isInteger(laufend.tabId)) zustand.tabId = laufend.tabId;
  else if (tab) zustand.tabId = tab.id;
  /* Damit die Statuskarte beim Wiederöffnen nicht leer dasteht: Ist der
     laufende Tab genau der aktive, steht sein Titel schon fest. Sonst holt ihn
     tabsAuffrischen() gleich nach. */
  if (tab && tab.id === zustand.tabId) zustand.verbundenerTab = tab;
  if (laufend.ursprungMuster) zustand.ursprungMuster = laufend.ursprungMuster;
  else if (u) zustand.ursprungMuster = u.muster;
  if (u && (!Number.isInteger(laufend.tabId) || laufend.tabId === (tab && tab.id))) {
    zustand.ursprung = u.ursprung;
  }
  zustand.ausweis = await konto.ausweisBesorgen();
  await sitzungAnzeigen(laufend);

  /*
   * Und die Cloud-Sitzung bekommt ihre Dauerzeile zurück (Vertrag §8.4).
   *
   * Befund Abnahme 14.08.2026 (H5): Hier fehlte dieser Aufruf. Einziger
   * Aufrufer von cloudSitzungZeigen war der Nachrichtenhörer, und `link.js`
   * sendet `link:cloud-sitzung` nur beim START der Sitzung. Wer die
   * Seitenleiste schloss und wieder öffnete, bekam Sitzung, Tab und Ursprung
   * zurück — die drei Zeichen aus §8.4 aber nicht: `#cloud-zeile` blieb
   * versteckt, `#cloud-agent` leer, und „Am Werk:" auf der Startseite ebenso.
   * §8.4 verlangt sie, solange die Sitzung LÄUFT, nicht nur im Augenblick
   * ihres Starts.
   *
   * Der Name kommt aus der Antwort des Hintergrunddienstes und wird wie jeder
   * Fremdtext entschärft (cloudSitzungZeigen). Fehlt er, bleibt die Zeile weg:
   * Eine Dauerzeile ohne Agentennamen behauptete eine Fernsitzung, von der
   * niemand weiß, wem sie gehört.
   */
  const agent = typeof laufend.agent === "string" ? laufend.agent.trim() : "";
  cloudSitzungZeigen(!!agent, agent);

  /*
   * Und die Sitzung bekommt ihre Hände zurück.
   *
   * Befund Gegenlesung 29.07.: Hier war die Wiederherstellung bisher zu Ende.
   * Chip „Aktiv · Bedienen", grüner Rahmen, Sitzungscode und die Blase „Ich
   * frage dich vor jedem Schritt." standen wieder da — der Browser-Auftrag
   * nicht: `browserKontext` lebte nur in der Seitenleiste, die der Nutzer
   * geschlossen hat. Jede weitere Frage lief danach ins gewöhnliche Gespräch,
   * während die Oberfläche das Gegenteil behauptete. Das ist ein Weg ohne
   * Antwort, und der einzige Hinweis war ein stiller Platzhalterwechsel.
   *
   * Die Sitzung selbst gehört dem Hintergrunddienst und läuft weiter; ihr
   * fehlt nur der Auftrag. Also wird sie neu gebunden — mit demselben Weg wie
   * beim Aufbau. Geht das nicht, sagt es `agentenBindung` in beiden Fällen
   * (kein Ausweis, kein Kontext), statt es den Nutzer an einer ausbleibenden
   * Wirkung erraten zu lassen.
   */
  await agentenBindung();
}

/*
 * Beim Öffnen: das Gespräch wieder aufnehmen. Erst der gemerkte Kontext und
 * sein Verlauf (GET /chat/history/{context_id}), dann die Frage, ob noch eine
 * Antwort unterwegs ist — zuerst beim Worker, danach beim Server
 * (GET /chat/active). Eine Antwort, die während geschlossener Seitenleiste
 * fertig wurde, steht im Verlauf; eine, die noch läuft, wird dem Worker
 * zurückgegeben, damit sie auch das nächste Schließen überlebt.
 */
async function chatZustandHolen() {
  try {
    const d = await chrome.storage.session.get("chat_kontext");
    zustand.chatKontext = d.chat_kontext || null;
  } catch (_) {
    zustand.chatKontext = null;
  }

  const ausweis = zustand.ausweis || (await konto.ausweisBesorgen());
  if (ausweis) zustand.ausweis = ausweis;

  if (zustand.chatKontext && ausweis) {
    try {
      const nachrichten = await chat.verlaufLaden({
        contextId: zustand.chatKontext,
        ausweis: ausweis.token,
      });
      if (nachrichten.length) {
        $("verlauf").replaceChildren();
        for (const m of nachrichten) sagen(m.wer, m.text);
      }
    } catch (_) {
      /* Der Verlauf ist Komfort, keine Bedingung fürs Weiterreden. */
    }
  }

  const laufend = await anWorker({ typ: "chat:zustand?" });
  if (laufend && laufend.laeuft) {
    if (laufend.contextId) await chatKontextMerken(laufend.contextId);
    /* Wem dieser Botengang gehört, weiß eine frisch geöffnete Seitenleiste
       nicht — sie hat den Browser-Auftrag der alten Sitzung nicht mehr. Ohne
       Zuordnung wird er beim Beenden NICHT gestoppt: Eine fremde Frage
       abzuwürgen wäre der schlimmere der beiden Fehler. */
    chatWartenZeigen(true);
    return;
  }

  if (!ausweis) return;
  try {
    const aktive = await chat.aktiveHolen(ausweis.token);
    const offen = aktive.find((t) => t.status === "processing");
    if (offen) {
      await chatKontextMerken(offen.contextId || zustand.chatKontext);
      chatWartenZeigen(true);
      await anWorker({
        typ: "chat:fortsetzen",
        taskId: offen.taskId,
        contextId: offen.contextId,
        ausweis: ausweis.token,
      });
    }
  } catch (_) {
    /* Ohne Nachschau bleibt es beim normalen Start. */
  }
}

/* Escape in der Seitenleiste selbst zählt genauso. */
let letztesEsc = 0;
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("menue").hidden) {
    menueOeffnen(false);
    return;
  }
  const jetzt = performance.now();
  /* Zweimal Escape in der Seitenleiste ist derselbe Not-Aus wie im Tab
     (content/overlay.js) und wie der Stopp-Knopf. Drei Wege, ein Ablauf. */
  if (jetzt - letztesEsc < 800 && zustand.sitzung) notAus("esc");
  letztesEsc = jetzt;
});

/*
 * Schließt der Nutzer die Seitenleiste, endet die Sitzung — samt Rechten und
 * samt Verbindung. Technisch könnte die Verbindung im Service Worker
 * weiterlaufen; sie soll es aber nicht: Ohne Seitenleiste sieht der Nutzer
 * weder Restzeit noch Stopp-Knopf, und eine Steuersitzung, die niemand
 * beaufsichtigt, ist genau das, was die Vorgabe ausschließt.
 */
/*
 * Die Seitenleiste geht zu. Das beendet die Sitzung NICHT mehr.
 *
 * Vorher stand hier `link:trennen`, und das war die eingebaute Sperre gegen
 * jede Arbeit im Hintergrund: Wer die Leiste zuklappte oder das Fenster
 * wechselte, riss dem Agenten mitten im Auftrag die Sitzung weg, samt
 * Seitenrecht und laufender Arbeit. Zusammen mit der zweiten Sperre (jeder
 * Befehl brauchte eine Karte in genau dieser Leiste) konnte SMarTrChrome
 * baulich nichts tun, sobald der Mensch woanders hinsah.
 *
 * Jetzt gilt: Die Sitzung gehört dem Hintergrunddienst und läuft weiter. Die
 * Leiste meldet nur, dass gerade niemand zusieht. Der Dienst entscheidet
 * daraufhin, was ohne Aufsicht noch erlaubt ist: im Selbständig-Modus arbeitet
 * der Agent weiter, im Einzelschritt-Modus wartet er und macht mit dem
 * Fragezeichen am Symbol auf sich aufmerksam.
 *
 * Der grüne Rahmen bleibt ausdrücklich stehen. Er sagt „hier arbeitet eine
 * Maschine", und das gilt weiter, gerade wenn der Mensch nicht hinsieht.
 */
window.addEventListener("pagehide", () => {
  chrome.runtime
    .sendMessage({
      typ: "link:unbeaufsichtigt",
      an: true,
      tabId: Number.isInteger(zustand.tabId) ? zustand.tabId : null,
    })
    .catch(() => {});
});

/*
 * Die Restzeit tickt still.
 *
 * Sie steht in der Sitzungsleiste, und die trägt `role="status"` — also eine
 * Vorlesezone. `tick()` schreibt dort im Sekundentakt eine neue Zahl hinein:
 * Ein Bildschirmleser liest damit jede Sekunde die Uhr vor und übertönt genau
 * das, worauf es ankommt, die Freigabefrage und jede Ansage. Dieselbe
 * Entscheidung ist bei der Antwortuhr der Freigabekarte schon getroffen worden
 * (panel.html, `aria-live="off"` an #freigabe-rest); hier wird sie
 * nachgezogen. Verschwiegen wird nichts: Die Zahl steht sichtbar da, wird beim
 * Betreten der Leiste mitgelesen, und die Warnungen bei zwei Minuten und einer
 * Minute kommen als eigene Ansage.
 */
$("rest").setAttribute("aria-live", "off");

/*
 * Der Bestand an Tabs wird gepflegt, nicht im Klick nachgeschlagen.
 *
 * Grund steht bei tabVerbindenMit: `chrome.permissions.request` verlangt eine
 * Nutzergeste, und die ist nach dem ersten await verbraucht. Wer den Tab erst
 * im Klick sucht, hat sie verloren, bevor er fragt — und der eine Klick wäre
 * wieder zwei. Fehlt einer der Anschlüsse (ältere Chrome-Fassung), arbeitet die
 * Leiste mit dem Stand vom Öffnen weiter, statt beim Laden auszusteigen.
 */
for (const anschluss of [
  chrome.tabs && chrome.tabs.onActivated,
  chrome.tabs && chrome.tabs.onUpdated,
  chrome.tabs && chrome.tabs.onRemoved,
]) {
  if (anschluss && typeof anschluss.addListener === "function") {
    anschluss.addListener(() => {
      tabsAuffrischen();
    });
  }
}

/*
 * Der Tabbestand wird als ERSTES angestoßen, nicht als letztes.
 *
 * Befund Abnahme 14.08.2026 (N1): `setzeZustand("bereit")` stand hier vor
 * `tabsAuffrischen()`, und dazwischen war `zustand.aktuellerTab` noch null. Der
 * eine Klick war in dieser Lücke sichtbar und wirkungslos, und er antwortete
 * mit der falschen Erklärung. Die Abfrage läuft weiterhin nebenher, sie beginnt
 * jetzt nur eher; solange sie nicht durch ist, sagt der Knopf selbst, dass es
 * noch kein Ziel gibt (verbindenKnoepfeSpiegeln).
 */
tabsAuffrischen();

setzeZustand("bereit");
eingabePlatzhalterSetzen();
/* Der Umschalter steht mit seiner Voreinstellung da, bevor der Dienst
   antwortet. Ein leerer Umschalter wäre für einen Sekundenbruchteil eine
   Oberfläche ohne Aussage, und wer sich vorlesen lässt, träfe genau darauf. */
modusSpiegeln();
/* Aus demselben Grund: Der eine Klick steht mit seinem ehrlichen Zustand und
   mit der Stufe da, die er beantragen würde, bevor die erste Antwort eintrifft
   (N1 und M8). `einstellungenLaden` zieht die gemerkte Wahl gleich nach; bis
   dahin steht dort die schwächste Stufe und keine Lücke. */
verbindenKnoepfeSpiegeln();
verbindenStufeZeigen();
einstellungenLaden();
/* Die Leiste ist offen, es sieht also wieder jemand zu. Gegenstück zum
   pagehide weiter unten. */
chrome.runtime.sendMessage({ typ: "link:unbeaufsichtigt", an: false }).catch(() => {});
/* Die Reihenfolge ist Absicht: Erst nachsehen, ob eine Sitzung läuft — eine
   Erklärung darf niemals eine laufende Sitzung überblenden. Danach das
   Guthaben, das ohne Ausweis von sich aus erklärt, woran es liegt. Ohne diese
   Reihenfolge stünde die Seitenleiste wieder stumm mit einem Strich da. */
zustandNachfragen()
  .catch(() => {})
  .then(() => guthabenLaden());
chatZustandHolen();
