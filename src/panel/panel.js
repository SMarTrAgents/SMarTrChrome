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
import {
  SPERRE,
  FREIGABE_ABGELEHNT,
  AUSWEIS_FEHLT,
  GUTHABEN_LAGETEXT,
} from "./erklaerungen.js";

const $ = (id) => document.getElementById(id);
const app = $("app");

const zustand = {
  tabId: null,
  ursprung: null,
  ursprungMuster: null,
  sitzung: null, // { stufe, bereich, modus, endetUm, ticker, code, vorfuehrung }
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
     Verbindung, also steht der Fokus dort. */
  bereit: () => ($("verbindungsleiste").hidden ? null : $("verbinden-start")),
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
  $("verlauf").hidden = !(name === "aktiv" || (name === "bereit" && blasen));
  $("sitzungsleiste").hidden = name !== "aktiv";
  /* Der Weg zur Verbindung steht nur im Ruhezustand offen, und nur solange
     KEINE Sitzung läuft. Die zweite Bedingung ist keine Zierde: Ohne sie böte
     das Panel in der Lage „Ausweis verfallen, Sitzung läuft weiter" einen
     zweiten Verbindungsaufbau an, während die erste noch Rechte auf dem Tab
     hält. Bei laufender Sitzung führt der Weg über Stopp, nicht über einen
     zweiten Antrag. */
  $("verbindungsleiste").hidden = name !== "bereit" || !!zustand.sitzung;
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
    const etikett = STUFENTEXT[s.stufe]?.etikett || "Nur zusehen";
    $("zustand-text").textContent = s.vorfuehrung
      ? `Vorführung · ${etikett}`
      : `Aktiv · ${etikett}`;
    return;
  }
  if (app.dataset.state === "kennwort") {
    $("zustand-text").textContent = "Warte auf deine Freigabe";
    return;
  }
  /* Befund Inhaber 29.07.: „Nicht verbunden" stand auch dann da, wenn Konto
     und Guthaben längst verbunden waren — der Chip sprach nur über die
     Steuersitzung und verschwieg die Anmeldung. Jetzt benennt er beide Lagen:
     Wer angemeldet ist, liest das auch. */
  $("zustand-text").textContent = zustand.ausweis ? "Angemeldet · bereit" : "Nicht verbunden";
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
    s.lang = "de-DE";
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
const PLATZHALTER_GESPRAECH = "Schreib Niemand, was du brauchst …";
const PLATZHALTER_TAB = "Sag Niemand, was er in diesem Tab tun soll …";

function eingabePlatzhalterSetzen() {
  const gebunden = !!(zustand.sitzung && !zustand.sitzung.vorfuehrung && zustand.browserKontext);
  $("eingabe").placeholder = gebunden ? PLATZHALTER_TAB : PLATZHALTER_GESPRAECH;
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

function protokollieren(text) {
  const li = document.createElement("li");
  const trenner = text.indexOf(":");
  if (trenner > 0) {
    const kopf = document.createElement("strong");
    kopf.textContent = text.slice(0, trenner);
    li.append(kopf, text.slice(trenner));
  } else {
    li.textContent = text;
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
  el.textContent = `Guthaben: ${gt(guthaben)} GT`;
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
      "Ich lade den SMarTrAgents-Tab neu. Sobald er da ist, habe ich deine Anmeldung.",
      true
    );
  } catch (_) {
    stoerung(
      "Ich konnte den SMarTrAgents-Tab nicht neu laden. Wechsle bitte selbst dorthin und drücke F5."
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
    ansagen(`Achtung, dein Guthaben wird knapp: noch ${gt(guthaben)} GT.`, true);
  }
  if (vorher !== 0 && guthaben === 0) {
    ansagen("Dein Guthaben ist aufgebraucht. In der Cloud kannst du aufladen.", true);
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

const DAUERTEXT = {
  600: "10 Minuten",
  1800: "30 Minuten",
  3600: "60 Minuten",
};

/* Für Zeitspannen, die NICHT aus der Knopfreihe stammen: was der Server
   tatsächlich bewilligt hat, und die Leerlauffrist aus dem Schein. Beides kann
   jeder Wert sein, DAUERTEXT deckt nur die vier wählbaren ab. */
function zeitWort(sekunden) {
  const s = Math.max(0, Math.round(Number(sekunden) || 0));
  if (s < 60) return `${s} Sekunden`;
  const min = Math.round(s / 60);
  return min === 1 ? "eine Minute" : `${min} Minuten`;
}

/* Was die gewählte Stufe im Klartext bedeutet. */
const STUFENTEXT = {
  read: {
    etikett: "Nur zusehen",
    tut: "zusehen und dir Dinge zeigen",
    ansage: "Er schaut nur zu.",
  },
  write: {
    etikett: "Bedienen",
    tut: "für dich klicken, tippen und ausfüllen",
    ansage: "Er darf für dich klicken und tippen. Anmelden machst du selbst.",
  },
  voll: {
    etikett: "Vollzugriff",
    tut: "für dich klicken, tippen und selbständig weiterarbeiten",
    ansage: "Er arbeitet selbständig weiter und fragt nicht bei jedem Schritt. Anmelden machst du selbst.",
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
    ? "so lange, bis du beendest,"
    : `${DAUERTEXT[String(dauer.sekunden)] || zeitWort(dauer.sekunden)} lang`;
  const bereich = "in diesem einen Tab";
  $("zusammenfassung").textContent =
    `Ich beantrage: Der Agent darf ${dauerWort} ${bereich} ${stufeText().tut}. ` +
    `Jeden Schritt bestätigst du einzeln. ` +
    (dauer.unbegrenzt
      ? "Ich verlängere die Freigabe selbst, bis du auf Stopp drückst. "
      : "Danach ist die Verbindung von selbst zu Ende. ") +
    "Wie lange der Server wirklich bewilligt, sage ich dir beim Verbinden.";
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
  if (zustand.sitzung) {
    ansagen(
      "Es läuft schon eine Verbindung. Beende sie mit Stopp, dann kannst du eine neue aufbauen.",
      true
    );
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
    "Verbindung mit dieser Website. Zum Verbinden auf Verbindung herstellen. Dauer und Stufe kannst du vorher ändern. Jeden Schritt bestätigst du einzeln."
  );
}

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
  await anTab({ typ: "overlay:aus" });
  await seitenrechteZurueckgeben();
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
 */
async function verbinden() {
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
      "Ich konnte den Rahmen auf dieser Seite nicht anzeigen. Aus Sicherheitsgründen baue ich dann keine Sitzung auf."
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
  $("kennwort-lage").textContent = "Ich frage die Freigabe an …";
  /* Die Kennwortkarte erscheint erst, wenn wirklich ein Kennwort kommt
     (Rückruf `kennwortZeigen`). Bei der Sofortfreigabe der Lesestufe gibt es
     keines — der Nutzer drückt Verbinden und ist verbunden, ohne Umweg über
     eine Karte, die nichts zu vergleichen hätte. */
  ansagen("Ich stelle die Verbindung her …");

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
            ? "Ich warte auf deine Freigabe im anderen Tab."
            : "Ich warte weiter. Gib die Verbindung im anderen Tab frei oder brich hier ab.";
      },
    });
  } catch (fehler) {
    if (fehler && fehler.kennung === "anmeldung") await konto.ausweisVerwerfen();
    await aufbauAbbrechen(klartextVon(fehler));
    return;
  }

  if (app.dataset.state === "kennwort") {
    $("kennwort-lage").textContent = "Freigabe da. Ich stelle die Verbindung her.";
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
    await aufbauAbbrechen(
      (antwort && antwort.klartext) ||
        "Der Hintergrunddienst der Erweiterung hat nicht geantwortet. Das liegt an der Erweiterung, nicht an dir. Starte Chrome neu, dann geht es wieder."
    );
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
const BINDUNG_FEHLT =
  "Die Verbindung steht, aber ich konnte sie dem Agenten nicht übergeben. Der Beispielauftrag unten geht trotzdem. Für Aufträge im Gespräch baue die Verbindung bitte neu auf.";
const BINDUNG_OHNE_AUSWEIS =
  "Die Verbindung steht, aber ich konnte sie dem Agenten nicht übergeben: Mir fehlt gerade deine Anmeldung. Melde dich in der Cloud an oder lade den SMarTrAgents-Tab neu, dann baue die Verbindung bitte neu auf.";

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
          ? "Ich habe jetzt Hände für diesen Tab: Sag mir, was ich klicken, ausfüllen oder nachsehen soll. Jeden Schritt bestätigst du einzeln."
          : "Ich sehe diesen Tab jetzt: Frag mich, was auf der Seite steht, oder lass dir Dinge zeigen."
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
  const wo = zustand.ursprung || "der geöffneten Seite";
  return gewuenscht.access === "write"
    ? `Auf ${wo} für dich klicken und tippen`
    : `Auf ${wo} mitlesen und dir Dinge zeigen`;
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
    "Das hat nicht geklappt. Es ist keine Verbindung entstanden."
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
  feld.setAttribute("aria-label", `Kennwort: ${buchstabiert}`);
  $("kennwort-funk").textContent = ansage;
  $("kennwort-lage").textContent =
    "Gleich geht ein Tab auf. Vergleiche dort das Kennwort und gib die Verbindung frei.";
  ansagen(`Kennwort: ${ansage}. Vergleiche es im neuen Tab, bevor du freigibst.`, true);
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
        `Du hast ${zeitWort(gewuenscht)} gewählt, bekommen hast du ${zeitWort(bewilligt)}.`,
      );
    }
    const leerlauf = Number(serverSitzung.leerlaufSekunden) || 0;
    if (leerlauf > 0) {
      hinweise.push(`Ohne Auftrag endet die Verbindung nach ${zeitWort(leerlauf)} von selbst.`);
    }
    if (hinweise.length) ansagen(hinweise.join(" "), true);
  }

  await anTab({
    typ: "overlay:an",
    gross: zustand.grosseSicht,
    text: "SMarTrAgent steuert diesen Tab. Esc Esc = Stopp",
  });

  const st = STUFENTEXT[stufe] || STUFENTEXT.read;
  $("stufe-anzeige").textContent = st.etikett;
  const codeFeld = $("sitzungscode");
  if (zustand.sitzung.code) {
    codeFeld.textContent = zustand.sitzung.code;
    codeFeld.setAttribute("aria-label", `Sitzungscode ${ticket.buchstabiert(zustand.sitzung.code)}`);
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
      ? "Ich arbeite selbständig weiter und frage nicht bei jedem Schritt. "
      : "Ich frage dich vor jedem Schritt. ";
  sagen("niemand", `Verbunden. ${schrittSatz}Ich bin noch etwa ${rest} Minuten für dich da.`);
  ansagen(
    `Verbunden. ${schrittSatz}Der Agent ist jetzt auf diesem Tab. Noch etwa ${rest} Minuten. ` +
      `${st.ansage} Zweimal Escape beendet sofort.`,
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
    await aufbauAbbrechen("Ich konnte den Rahmen auf dieser Seite nicht anzeigen.");
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
    text: "Vorführung ohne Agent. Esc Esc = Stopp",
  });

  $("stufe-anzeige").textContent = "Vorführung";
  $("sitzungscode").hidden = true;
  $("protokoll").replaceChildren();
  setzeZustand("aktiv");

  sagen(
    "niemand",
    "Das ist eine Vorführung ohne Server. Kein Agent ist verbunden, es wird nichts gesteuert. " +
      "Du siehst nur, was diese Erweiterung anzeigt."
  );
  ansagen("Vorführung gestartet. Es ist kein Agent verbunden. Zehn Minuten.", true);

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
    ansagen("Noch zwei Minuten.");
  }
  if (rest <= 60 && !s.gewarnt60) {
    s.gewarnt60 = true;
    ansagen("Noch eine Minute. Danach endet die Verbindung von selbst.", true);
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
      codeFeld.setAttribute("aria-label", `Sitzungscode ${ticket.buchstabiert(s.code)}`);
      codeFeld.hidden = false;
    }
    protokollieren("Verlängert: die Freigabe läuft weiter");
    /* Der Agent bekommt den neuen Sitzungsschein in denselben Auftrag. */
    await agentenBindung();
  } catch (fehler) {
    ansagen(
      "Ich konnte die Verbindung nicht verlängern. Sie endet zur angezeigten Zeit. Du kannst danach neu verbinden.",
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

  const texte = {
    notbremse: "Gestoppt. Der Agent steuert nicht mehr.",
    abgelaufen: "Die Sitzung ist beendet. Die Freigabe habe ich zurückgegeben.",
    verloren: "Die Verbindung ist abgerissen. Die Freigabe habe ich zurückgegeben.",
    nutzer: "Beendet. Die Freigabe habe ich zurückgegeben.",
  };
  const text = klartext || texte[grund] || texte.nutzer;
  sagen("niemand", text);
  merkenUndSprechen(text, true);
  setTimeout(() => setzeZustand("bereit"), 1200);
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
const OHNE_UHR_ZEILE = "Wie lange der Agent noch wartet, weiß ich hier nicht.";
const OHNE_UHR_ANSAGE = "Wie lange du Zeit hast, weiß ich nicht, antworte am besten sofort.";

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
    $("freigabe-rest-text").textContent = rest
      ? `Noch ${rest} Sekunde${rest === 1 ? "" : "n"} für deine Antwort.`
      : "Die Zeit für diese Antwort ist gleich um.";
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
    ansagen(`${frage} Freigeben oder ablehnen?${fristMs === 0 ? ` ${OHNE_UHR_ANSAGE}` : ""}`, true);
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
    String(n.frage || "Der Agent möchte einen Schritt ausführen."),
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
      protokollieren("Abgelaufen: der Agent hat auf die Antwort nicht mehr gewartet");
      /* Sichtbar UND hörbar. Bisher stand der Ablauf nur im Protokoll und in
         der Live-Region — und die (#ansage) ist ausschließlich für den
         Bildschirmleser da. Wer die Karte verschwinden sah, bekam dafür keine
         Erklärung (Befund Inhaber 29.07.). Die Sitzung läuft weiter: nicht
         passiert ist nur dieser eine Schritt. */
      sagen(
        "niemand",
        "Ich habe nicht länger auf deine Antwort gewartet. Dieser Schritt ist nicht passiert. " +
          "Sag mir, ob ich es noch einmal versuchen soll."
      );
      ansagen("Der Agent hat nicht länger gewartet. Dieser Schritt ist nicht passiert.", true);
    }
    return false;
  }

  /* Was der Agent gerade tut, steht im Protokoll. Der Satz stammt vom Agenten
     und aus unseren eigenen Worten — Text von der Seite steht dort nie. */
  if (n.typ === "link:protokoll") {
    protokollieren(String(n.text || "").slice(0, 300));
    return false;
  }

  /* Und was dabei herausgekommen ist. Bewusst knapp: Die ausführliche Fassung
     bekommt der Agent, der Mensch braucht die Zeile, die zeigt, dass etwas
     passiert ist. */
  if (n.typ === "link:befehl") {
    if (n.erfolg) protokollieren(`Erledigt: ${String(n.cmd || "").slice(0, 40)}`);
    /* Der Satz, nicht die Kennung. Hier stand `n.fehler`, also der reine
       Maschinencode, und der Mensch las „Nicht ausgeführt: tab_gone". Der
       fertige Satz kommt jetzt als `klartext` mit; die Kennung bleibt für den
       Fall, dass einmal keiner mitkommt. */
    else protokollieren(`Nicht ausgeführt: ${String(n.klartext || n.fehler || "Der Schritt hat nicht geklappt.").slice(0, 160)}`);
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
    sagen("du", "Zeig mir, was hier anklickbar ist.");
    protokollieren("Lese die Seite: sichtbare Bedienelemente einsammeln");
    const antwort = await anTab({ typ: "overlay:lesen", grenze: 5 });
    if (!antwort || !antwort.ok || !antwort.elemente.length) {
      sagen("niemand", "Ich finde auf dieser Seite gerade nichts Anklickbares im sichtbaren Bereich.");
      ansagen("Ich finde hier nichts Anklickbares im sichtbaren Bereich.");
      return;
    }
    const liste = antwort.elemente;

    sagen(
      "niemand",
      `Ich habe ${liste.length} Bedienelement${liste.length === 1 ? "" : "e"} gefunden und ` +
        `zeige sie dir eins nach dem anderen.`
    );

    for (const [i, el] of liste.entries()) {
      if (!zustand.sitzung || zustand.abgebrochen) return;
      const name = zitat(el.name);
      /* `null`: Diese Frage wartet in der Seitenleiste selbst, kein Ausführer
         hält dazu eine Frist. Eine Restzeitzeile wäre hier eine Erfindung. */
      const ja = await freigabeHolen(
        `Schritt ${i + 1} von ${liste.length}: ein Bedienelement zeigen.`,
        name,
        null
      );
      if (!zustand.sitzung || zustand.abgebrochen) return;
      if (!ja) {
        /* Protokollzeile und Ansage macht schon der Ablehnen-Knopf — hier
           käme sonst dieselbe Aussage doppelt, und die zweite Ansage bräche
           die erste mitten im Satz ab (sprich() bricht ab, bevor es spricht).
           Was hier fehlt, ist nur der Satz zum Beispielauftrag. */
        sagen("niemand", "Alles klar, dann lasse ich den Rest. Die Verbindung bleibt bestehen.");
        return;
      }
      await anTab({
        typ: "overlay:zeiger",
        x: el.mitte.x,
        y: el.mitte.y,
        beschriftung: el.name,
        rect: el.rect,
      });
      protokollieren(`Zeigen: „${name}“ (${zitat(el.rolle, 20)}, ${i + 1} von ${liste.length})`);
      ansagen(`Schritt ${i + 1} von ${liste.length} gezeigt.`);
      await new Promise((r) => setTimeout(r, 1400));
    }

    await anTab({ typ: "overlay:zeiger", x: -200, y: -200 });
    protokollieren("Fertig: alle gefundenen Elemente gezeigt");
    sagen("niemand", "Das war alles, was ich hier gefunden habe. Sag mir, was ich damit tun soll.");
    ansagen("Auftrag erledigt.");
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
 * Ereignisse
 * ------------------------------------------------------------------ */

$("verbinden-start").addEventListener("click", dialogVorbereiten);
$("menue-verbinden").addEventListener("click", () => {
  menueOeffnen(false);
  dialogVorbereiten();
});
$("dialog-abbrechen").addEventListener("click", () => {
  setzeZustand(zustand.sitzung ? "aktiv" : "bereit");
  ansagen("Abgebrochen. Es wurde keine Verbindung aufgebaut.");
});
/* Stufe und Dauer sind wieder Auswahlfelder — die Zusammenfassung folgt der
   Auswahl, damit vorgelesen wird, was wirklich beantragt wird. */
$("dialog").addEventListener("change", (e) => {
  if (e.target && (e.target.name === "dauer" || e.target.name === "stufe")) {
    zusammenfassen();
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
    ansagen("Dauer und Stufe. Ändere, was du möchtest, dann auf Verbindung herstellen.");
  }
});
$("vorfuehrung").addEventListener("click", vorfuehrungStarten);

/* Erklärkarte: „Zurück" führt dorthin, wo der Nutzer herkam — in eine
   laufende Sitzung oder in den Ruhezustand. Der zweite Knopf trägt die
   Handlung, die zur Erklärung gehört (Tab neu laden, noch einmal versuchen). */
$("erklaer-zurueck").addEventListener("click", () => {
  setzeZustand(zustand.sitzung ? "aktiv" : "bereit");
  ansagen("Verstanden. Es wurde nichts verändert.");
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
      "Ich habe die Anmeldeseite geöffnet. Melde dich dort an und komm dann hierher zurück.",
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
      ? "Abgebrochen. Die laufende Verbindung bleibt bestehen, Stopp ist weiter da."
      : "Abgebrochen. Es wurde keine Verbindung aufgebaut.",
  );
});

/* Kennwortschritt: abbrechen bricht wirklich ab — die laufende Abfrage
   hört sofort auf, statt noch einen Takt weiterzulaufen. */
$("kennwort-abbrechen").addEventListener("click", async () => {
  if (zustand.abbruch) zustand.abbruch.abort();
  await aufbauAbbrechen(null);
  ansagen("Abgebrochen. Es ist keine Verbindung entstanden.", true);
});
$("kennwort-erneut").addEventListener("click", async () => {
  if (!zustand.freigabeAdresse) return;
  try {
    await ticket.freigabeseiteOeffnen(zustand.freigabeAdresse);
  } catch (fehler) {
    stoerung(klartextVon(fehler));
  }
});

$("stopp").addEventListener("click", () => beenden("nutzer"));
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
  protokollieren("Abgelehnt: dieser Schritt findet nicht statt");
  ansagen(
    "Abgelehnt. Dieser Schritt findet nicht statt, die Verbindung bleibt bestehen. " +
      "Zum Beenden drückst du auf Stopp.",
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
  ansagen("Neues Gespräch. Die Verbindung bleibt, wie sie ist.");
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
      aus: "Vorlesen ist aus.",
      sicher: "Ich lese nur noch wichtige Ansagen vor.",
      alles: "Ich lese alles vor.",
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
  ansagen(zustand.grosseSicht ? "Große Sichtbarkeit an." : "Große Sichtbarkeit aus.");
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
  ansagen(zustand.chatModus === "smartr" ? "SMarTr Modus." : "Normal Modus.");
}

$("modus-normal").addEventListener("click", () => chatModusSetzen("normal"));
$("modus-smartr").addEventListener("click", () => chatModusSetzen("smartr"));
/* Zustands-Chip klappt die Erklärung auf — nie eine Auswahl. */
$("zustand-chip").addEventListener("click", () => {
  const e = $("zustand-erklaerung");
  const offen = e.hidden;
  e.textContent = zustand.sitzung
    ? `Der Agent ist auf diesem Tab: ${STUFENTEXT[zustand.sitzung.stufe]?.etikett}. ` +
      `Die Freigabe endet mit der Sitzung und wird zurückgegeben.`
    : zustand.ausweis
      ? "Du bist angemeldet; Konto und Guthaben sind verbunden. Eine Steuersitzung läuft gerade " +
        "nicht. Öffne die Seite, die der Agent bedienen soll, und drücke dort auf " +
        "Verbindung aufbauen."
      : "Es besteht keine Verbindung. Der Agent kann auf dieser Seite nichts sehen und nichts tun.";
  e.hidden = !offen;
  $("zustand-chip").setAttribute("aria-expanded", String(offen));
});

/* Vorlesen auf Knopfdruck — der Weg, der immer funktioniert. */
$("vorlesen-knopf").addEventListener("click", () => {
  if (!zustand.letzteRede) {
    $("ansage").textContent = "Es gibt noch nichts vorzulesen.";
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

const WARTEWORT = "Niemand arbeitet …";

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
const SCHRITTWORT = {
  thinking: "Überlegt",
  tool_call: "Werkzeug",
  response: "Sagt",
  error: "Störung beim Agenten",
  info: "Arbeitet",
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
  const wort = Object.hasOwn(SCHRITTWORT, art) ? SCHRITTWORT[art] : "Arbeitet";
  const kopf = werkzeug ? `Werkzeug ${werkzeug}` : wort;
  const zeile = text ? `${kopf}: ${text}` : kopf;
  protokollieren(zeile);
  /* Die Wartezeile ist die einzige Stelle, die immer sichtbar ist — das
     Protokoll darf der Nutzer zuklappen. Dort steht deshalb die Kurzfassung. */
  if (zustand.chatLaeuft) {
    $("kostenhinweis").textContent = `${WARTEWORT.replace(" …", "")}: ${zitat(text || werkzeug, 40)}`;
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
      "Deine Anmeldung gilt nicht mehr. Melde dich bitte in der Cloud neu an, dann reden wir weiter.",
      true
    );
    return;
  }
  stoerung(
    klartext ||
      "In der Erweiterung ist etwas schiefgegangen. Deine Frage ist nicht angekommen. Das liegt an uns, nicht an dir."
  );
}

$("chatform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("eingabe").value.trim();
  if (!text) return;
  if (zustand.chatLaeuft) {
    ansagen("Ich arbeite noch an deiner vorigen Frage. Warte bitte, bis die Antwort da ist.", true);
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
      (antwort && antwort.klartext) ||
        "Der Hintergrunddienst der Erweiterung hat nicht geantwortet. Das liegt an der Erweiterung, nicht an dir. Starte Chrome neu, dann geht es wieder."
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
  if (n.typ === "notbremse:an-panel" && zustand.sitzung) beenden("notbremse");

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
      ansagen("Du bist in der Cloud jetzt abgemeldet. Melde dich dort an, dann geht es weiter.", true);
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
  if (laufend.ursprungMuster) zustand.ursprungMuster = laufend.ursprungMuster;
  else if (u) zustand.ursprungMuster = u.muster;
  if (u && (!Number.isInteger(laufend.tabId) || laufend.tabId === (tab && tab.id))) {
    zustand.ursprung = u.ursprung;
  }
  zustand.ausweis = await konto.ausweisBesorgen();
  await sitzungAnzeigen(laufend);

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
  if (jetzt - letztesEsc < 800 && zustand.sitzung) beenden("notbremse");
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

setzeZustand("bereit");
eingabePlatzhalterSetzen();
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
