/*
 * Prüfung des Aufzeichners — das echte `src/content/rekorder.js`, gefahren
 * zusammen mit dem echten `src/content/selektor.js` in einem Seitenbaum, der
 * Selektoren wirklich auflöst.
 *
 * Beide Skripte laufen in DEMSELBEN Sandkasten und in der Reihenfolge, in der
 * das Manifest sie einspielt. Das ist keine Bequemlichkeit: Ein Inhaltsskript
 * kann `src/net/*.js` nicht importieren, es findet den Nachbarn nur über
 * `globalThis`. Genau diese Kopplung ist am 11.08.2026 gerissen, als die
 * Verdeckungswache in einem Modul lag, das im Klickweg niemand rufen konnte.
 * Hier wird sie mitgeprüft und nicht angenommen.
 *
 * Die Zusage, um die es in dieser Datei vor allen anderen geht (§7.2):
 *
 *   In ein Geheimfeld wird KEIN Wert aufgezeichnet — nicht „aufgezeichnet und
 *   danach gelöscht", sondern gar nicht erst ausgelesen.
 *
 * Gemessen wird das in R4 zweifach: einmal als Textsuche über den ganzen
 * erzeugten Ablauf, und einmal als Tatsache über den Zugriff. Jedes Feld im
 * Seitenbaum zählt mit, wie oft jemand seinen Wert gelesen hat. Ein Rekorder,
 * der liest und danach verwirft, bliebe bei der Textsuche grün und fällt hier
 * durch — und genau dieser Unterschied steht im Vertrag.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { attrappeSetzen } from "./chrome-attrappe.mjs";
import { workflowPruefen } from "../net/werkstatt.js";

const GEHEIM_QUELLE = new URL("../content/geheim.js", import.meta.url);
const SELEKTOR_QUELLE = new URL("../content/selektor.js", import.meta.url);
const REKORDER_QUELLE = new URL("../content/rekorder.js", import.meta.url);

/* ------------------------------------------------------------------ *
 * Ein kleiner, echter Seitenbaum
 *
 * Bewusst dieselbe Bauart wie in `selektor.test.mjs` und bewusst noch einmal
 * hier: Eine gemeinsame Hilfsdatei gehörte niemandem, und eine Prüfdatei zu
 * importieren hiesse, ihre Prüfsätze ein zweites Mal laufen zu lassen.
 * ------------------------------------------------------------------ */

function k(tag, attrs = {}, inhalt = [], merke = null) {
  return { tag, attrs, inhalt, merke };
}

function zerlegen(text, trenner) {
  const stuecke = [];
  let jetzt = "";
  let klammer = 0;
  let anfuehrung = null;
  for (const zeichen of String(text)) {
    if (anfuehrung) {
      jetzt += zeichen;
      if (zeichen === anfuehrung) anfuehrung = null;
      continue;
    }
    if (zeichen === '"' || zeichen === "'") {
      anfuehrung = zeichen;
      jetzt += zeichen;
      continue;
    }
    if (zeichen === "[") klammer += 1;
    if (zeichen === "]") klammer -= 1;
    if (!klammer && trenner.test(zeichen)) {
      if (jetzt) stuecke.push(jetzt);
      jetzt = "";
      continue;
    }
    jetzt += zeichen;
  }
  if (jetzt) stuecke.push(jetzt);
  return stuecke;
}

function kompaktParsen(text) {
  let rest = String(text).trim();
  const teil = { tag: null, id: null, klassen: [], attrs: [], nth: null };
  if (rest.startsWith("*")) {
    teil.tag = "*";
    rest = rest.slice(1);
  } else {
    const tagM = /^[a-zA-Z][\w-]*/.exec(rest);
    if (tagM) {
      teil.tag = tagM[0].toUpperCase();
      rest = rest.slice(tagM[0].length);
    }
  }
  while (rest) {
    let m;
    if ((m = /^#([\w-]+)/.exec(rest))) teil.id = m[1];
    else if ((m = /^\.([\w-]+)/.exec(rest))) teil.klassen.push(m[1]);
    else if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) teil.attrs.push([m[1].toLowerCase(), m[2]]);
    else if ((m = /^:nth-of-type\((\d+)\)/.exec(rest))) teil.nth = Number(m[1]);
    else throw new Error(`Die Attrappe kennt diesen Selektorteil nicht: „${rest}" (aus „${text}")`);
    rest = rest.slice(m[0].length);
  }
  return teil;
}

function passt(el, teil) {
  if (typeof el.getAttribute !== "function") return false;
  if (teil.tag && teil.tag !== "*" && el.tagName !== teil.tag) return false;
  if (teil.id && el.getAttribute("id") !== teil.id) return false;
  for (const kl of teil.klassen) {
    if (!String(el.getAttribute("class") || "").split(/\s+/).includes(kl)) return false;
  }
  for (const [name, wert] of teil.attrs) {
    const hat = el.getAttribute(name);
    if (hat === null || hat === undefined) return false;
    if (wert !== undefined && hat !== wert) return false;
  }
  if (teil.nth !== null) {
    const eltern = el.parentElement;
    if (!eltern) return teil.nth === 1;
    const gleiche = eltern.children.filter((g) => g.tagName === el.tagName);
    if (gleiche.indexOf(el) + 1 !== teil.nth) return false;
  }
  return true;
}

function ketteParsen(gruppe) {
  const teile = zerlegen(gruppe.trim(), /\s/);
  const kette = [];
  let komb = " ";
  for (const stueck of teile) {
    if (stueck === ">") {
      komb = ">";
      continue;
    }
    kette.push({ teil: kompaktParsen(stueck), komb });
    komb = " ";
  }
  return kette;
}

function passtKette(el, kette) {
  if (!passt(el, kette[kette.length - 1].teil)) return false;
  let knoten = el;
  for (let i = kette.length - 2; i >= 0; i--) {
    const komb = kette[i + 1].komb;
    if (komb === ">") {
      knoten = knoten.parentElement;
      if (!knoten || !passt(knoten, kette[i].teil)) return false;
    } else {
      let a = knoten.parentElement;
      let gefunden = null;
      while (a) {
        if (passt(a, kette[i].teil)) {
          gefunden = a;
          break;
        }
        a = a.parentElement;
      }
      if (!gefunden) return false;
      knoten = gefunden;
    }
  }
  return true;
}

function nachfahren(el, raus = []) {
  for (const kind of el.children || []) {
    raus.push(kind);
    nachfahren(kind, raus);
  }
  return raus;
}

function suchen(wurzel, selektor) {
  const menge =
    wurzel.nodeType === 9
      ? [wurzel.documentElement, ...nachfahren(wurzel.documentElement)]
      : nachfahren(wurzel);
  const gruppen = zerlegen(selektor, /,/).map((g) => ketteParsen(g)).filter((kette) => kette.length);
  if (!gruppen.length) throw new Error(`leerer Selektor: „${selektor}"`);
  return menge.filter((el) => gruppen.some((kette) => passtKette(el, kette)));
}

function knotenBauen(bauplan, dok, eltern, register) {
  const attrs = new Map();
  for (const [n, w] of Object.entries(bauplan.attrs || {})) {
    if (n.startsWith("__")) continue;
    attrs.set(n.toLowerCase(), String(w));
  }
  const tag = String(bauplan.tag).toUpperCase();
  const inhalt = [];
  const el = {
    nodeType: 1,
    tagName: tag,
    ownerDocument: dok,
    parentElement: eltern,
    parentNode: eltern,
    children: [],
    isConnected: true,
    __inhalt: inhalt,
    __rect: bauplan.attrs && bauplan.attrs.__rect,
    /* Wie oft jemand den Wert dieses Feldes gelesen hat. Die Zahl ist die
       eigentliche Messgrösse von §7.2 (siehe Kopf der Datei). */
    __wertGelesen: 0,
    get attributes() {
      return [...attrs.entries()].map(([name, value]) => ({ name, value }));
    },
    getAttribute(n) {
      const s = String(n).toLowerCase();
      return attrs.has(s) ? attrs.get(s) : null;
    },
    setAttribute(n, w) {
      attrs.set(String(n).toLowerCase(), String(w));
    },
    removeAttribute(n) {
      attrs.delete(String(n).toLowerCase());
    },
    get id() {
      return attrs.get("id") || "";
    },
    get name() {
      return attrs.get("name") || "";
    },
    get type() {
      return attrs.get("type") || (tag === "INPUT" ? "text" : undefined);
    },
    get isContentEditable() {
      const w = attrs.get("contenteditable");
      return w === "" || w === "true";
    },
    get textContent() {
      return inhalt.map((s) => (typeof s === "string" ? s : s.textContent)).join("");
    },
    get innerText() {
      return el.textContent;
    },
    querySelectorAll(sel) {
      return suchen(el, sel);
    },
    querySelector(sel) {
      return suchen(el, sel)[0] || null;
    },
    closest(sel) {
      let k2 = el;
      while (k2 && k2.nodeType === 1) {
        if (passt(k2, kompaktParsen(sel))) return k2;
        k2 = k2.parentElement;
      }
      return null;
    },
    appendChild(kind) {
      kind.parentElement = el;
      kind.parentNode = el;
      kind.isConnected = true;
      el.children.push(kind);
      inhalt.push(kind);
      return kind;
    },
    removeChild(kind) {
      const i = el.children.indexOf(kind);
      if (i >= 0) el.children.splice(i, 1);
      const j = inhalt.indexOf(kind);
      if (j >= 0) inhalt.splice(j, 1);
      kind.parentElement = null;
      kind.parentNode = null;
      kind.isConnected = false;
      return kind;
    },
    getBoundingClientRect() {
      const r = el.__rect || { left: 10, top: 20, width: 120, height: 30 };
      return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height };
    },
    focus() {},
    scrollIntoView() {},
    dispatchEvent() {
      return true;
    },
  };

  let wert = bauplan.attrs && bauplan.attrs.value !== undefined ? String(bauplan.attrs.value) : "";
  Object.defineProperty(el, "value", {
    get() {
      el.__wertGelesen += 1;
      return wert;
    },
    set(w) {
      wert = String(w);
    },
    enumerable: true,
    configurable: true,
  });

  const roh = bauplan.inhalt;
  const stuecke = Array.isArray(roh) ? roh : roh === undefined || roh === null ? [] : [roh];
  for (const stueck of stuecke) {
    if (typeof stueck === "string") {
      inhalt.push(stueck);
      continue;
    }
    const kind = knotenBauen(stueck, dok, el, register);
    el.children.push(kind);
    inhalt.push(kind);
  }

  if (tag === "SELECT") {
    el.options = el.children.filter((c) => c.tagName === "OPTION");
    el.options.forEach((o) => {
      Object.defineProperty(o, "text", { get: () => o.textContent, configurable: true });
    });
    el.selectedIndex = 0;
    el.multiple = false;
  }

  if (bauplan.merke) register.set(bauplan.merke, el);
  return el;
}

/** Ein frisch erzeugter Knoten, wie ihn `document.createElement` liefert. */
function frischerKnoten(tag, dok) {
  const attrs = new Map();
  const inhalt = [];
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    ownerDocument: dok,
    parentElement: null,
    parentNode: null,
    children: [],
    isConnected: false,
    __inhalt: inhalt,
    __schatten: null,
    style: {
      cssText: "",
      setProperty(name, wert, prio) {
        el.style.cssText += `${name}:${wert}${prio ? ` !${prio}` : ""};`;
      },
    },
    get attributes() {
      return [...attrs.entries()].map(([name, value]) => ({ name, value }));
    },
    getAttribute(n) {
      const s = String(n).toLowerCase();
      if (s === "id") return el.id || null;
      return attrs.has(s) ? attrs.get(s) : null;
    },
    setAttribute(n, w) {
      attrs.set(String(n).toLowerCase(), String(w));
    },
    get textContent() {
      return inhalt.map((s) => (typeof s === "string" ? s : s.textContent)).join("");
    },
    set textContent(w) {
      inhalt.length = 0;
      inhalt.push(String(w));
    },
    /* Ein geschlossener Schattenbaum: Was hineingelegt wird, ist von aussen
       nicht mehr zu finden — genau das soll er leisten. Die Prüfung kommt an
       ihn nur über `__schatten` heran, die Seite gar nicht. */
    attachShadow(o) {
      el.__schatten = {
        mode: (o && o.mode) || "open",
        kinder: [],
        appendChild(kind) {
          el.__schatten.kinder.push(kind);
          kind.parentElement = null;
          return kind;
        },
      };
      return el.__schatten;
    },
    appendChild(kind) {
      kind.parentElement = el;
      kind.parentNode = el;
      kind.isConnected = el.isConnected;
      el.children.push(kind);
      inhalt.push(kind);
      return kind;
    },
    remove() {
      if (el.parentNode && typeof el.parentNode.removeChild === "function") {
        el.parentNode.removeChild(el);
        return;
      }
      el.parentNode = null;
      el.parentElement = null;
      el.isConnected = false;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 0, height: 0, x: 0, y: 0, right: 0, bottom: 0 };
    },
    querySelectorAll(sel) {
      return suchen(el, sel);
    },
  };
  el.id = "";
  return el;
}

function seiteBauen(bauplan) {
  const register = new Map();
  const dok = {
    nodeType: 9,
    ownerDocument: null,
    title: "Prüfseite",
    documentElement: null,
    body: null,
    createElement(tag) {
      return frischerKnoten(tag, dok);
    },
    querySelectorAll(sel) {
      return suchen(dok, sel);
    },
    querySelector(sel) {
      return suchen(dok, sel)[0] || null;
    },
    getElementById(id) {
      return suchen(dok, `[id="${id}"]`)[0] || null;
    },
    evaluate(pfad, kontext, aufloeser, art) {
      if (art !== 9) throw new Error(`Die Attrappe kennt nur Ergebnisart 9, nicht ${art}`);
      const teile = String(pfad).split("/").filter(Boolean);
      if (!teile.length) throw new Error(`Die Attrappe kennt diesen XPath nicht: „${pfad}"`);
      let knoten = null;
      for (let i = 0; i < teile.length; i++) {
        const m = /^([a-zA-Z][\w-]*)\[(\d+)\]$/.exec(teile[i]);
        if (!m) throw new Error(`Die Attrappe kennt diesen XPath nicht: „${pfad}"`);
        const tag = m[1].toUpperCase();
        const nr = Number(m[2]);
        const kandidaten = i === 0 ? [dok.documentElement] : knoten.children;
        const gleiche = kandidaten.filter((c) => c && c.tagName === tag);
        knoten = gleiche[nr - 1] || null;
        if (!knoten) return { singleNodeValue: null };
      }
      return { singleNodeValue: knoten };
    },
  };
  dok.documentElement = knotenBauen(bauplan, dok, null, register);
  dok.documentElement.scrollHeight = 5000;
  dok.body = suchen(dok, "body")[0] || dok.documentElement;
  return {
    dok,
    finden(name) {
      const el = register.get(name);
      assert.ok(el, `im Seitenbaum gibt es kein „${name}"`);
      return el;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Die Umgebung: Uhr, Fenster, Ereignisse, Beobachter
 * ------------------------------------------------------------------ */

/* Eine Uhr zum Vorspulen. Ohne sie kostete die Drossel von 250 ms und die
   DOM-Ruhe von 500 ms in jedem Prüfsatz echte Zeit — und eine Prüfung, die
   Sekunden kostet, wird irgendwann übersprungen. */
function uhrBauen() {
  let jetzt = 0;
  let nr = 0;
  const auftraege = new Map();
  return {
    now: () => jetzt,
    setTimeout(f, ms) {
      const id = ++nr;
      auftraege.set(id, { f, wann: jetzt + (Number(ms) || 0) });
      return id;
    },
    clearTimeout(id) {
      auftraege.delete(id);
    },
    offen: () => auftraege.size,
    vor(ms) {
      const ziel = jetzt + ms;
      for (;;) {
        let naechster = null;
        for (const [id, a] of auftraege) {
          if (a.wann <= ziel && (!naechster || a.wann < naechster[1].wann)) naechster = [id, a];
        }
        if (!naechster) break;
        auftraege.delete(naechster[0]);
        jetzt = Math.max(jetzt, naechster[1].wann);
        naechster[1].f();
      }
      jetzt = ziel;
    },
  };
}

let quellen = null;

async function quellenLesen() {
  if (!quellen) {
    quellen = {
      geheim: await readFile(GEHEIM_QUELLE, "utf8"),
      selektor: await readFile(SELEKTOR_QUELLE, "utf8"),
      rekorder: await readFile(REKORDER_QUELLE, "utf8"),
    };
  }
  return quellen;
}

/**
 * Beide Inhaltsskripte starten, in der Reihenfolge des Manifests.
 *
 * @param {object} angaben
 * @param {boolean} angaben.ohneSelektor `selektor.js` NICHT einspielen
 * @param {boolean} angaben.ohneGeheim `geheim.js` NICHT einspielen (F4)
 * @param {object} angaben.ablageLocal Startinhalt von chrome.storage.local
 * @param {boolean} angaben.panelHoert ob die Seitenleiste offen ist
 */
async function starten(bauplan, angaben = {}) {
  const {
    ohneSelektor = false,
    ohneGeheim = false,
    ablageLocal = {},
    panelHoert = true,
    url = "https://www.ebay.de/verkaufen",
  } = angaben;

  const seite = seiteBauen(bauplan);
  const uhr = uhrBauen();
  const { chrome, spur } = attrappeSetzen({
    ablageLocal,
    panelAntwortet: panelHoert ? () => ({ ok: true }) : null,
  });

  const hoerer = [];
  const beobachter = [];
  const zustand = { y: 0, hoerer, beobachter, spur, chrome, uhr, seite };

  const sandkasten = {
    console,
    document: seite.dok,
    location: { href: url },
    chrome,
    CSS: { escape: (s) => String(s) },
    performance: { now: () => uhr.now() },
    setTimeout: (f, ms) => uhr.setTimeout(f, ms),
    clearTimeout: (id) => uhr.clearTimeout(id),
    innerHeight: 900,
    MutationObserver: class {
      constructor(ruf) {
        this.__ruf = ruf;
        this.__aktiv = false;
        this.__ziele = [];
        beobachter.push(this);
      }
      observe(ziel, o) {
        this.__aktiv = true;
        this.__ziele.push({ ziel, o });
      }
      disconnect() {
        this.__aktiv = false;
        this.__ziele = [];
      }
    },
  };
  sandkasten.window = sandkasten;
  sandkasten.self = sandkasten;
  sandkasten.globalThis = sandkasten;
  Object.defineProperty(sandkasten, "scrollY", { get: () => zustand.y });
  sandkasten.window.addEventListener = (typ, fn, o) => {
    hoerer.push({ typ, fn, o: o || {} });
  };
  sandkasten.window.removeEventListener = (typ, fn) => {
    const i = hoerer.findIndex((h) => h.typ === typ && h.fn === fn);
    if (i >= 0) hoerer.splice(i, 1);
  };

  const quelle = await quellenLesen();
  vm.createContext(sandkasten);
  /* Die Reihenfolge des Manifests: `geheim.js` als ERSTE Datei (Festlegung F4
     vom 14.08.2026), danach `selektor.js`, danach `rekorder.js`. */
  if (!ohneGeheim) {
    vm.runInContext(quelle.geheim, sandkasten, { filename: "geheim.js" });
    assert.ok(sandkasten.SMARTR_GEHEIM, "geheim.js muss globalThis.SMARTR_GEHEIM setzen");
  }
  if (!ohneSelektor) vm.runInContext(quelle.selektor, sandkasten, { filename: "selektor.js" });
  vm.runInContext(quelle.rekorder, sandkasten, { filename: "rekorder.js" });

  const zuhoerer = chrome.runtime.onMessage._zuhoerer;
  assert.equal(zuhoerer.length, 1, "rekorder.js muss genau einen Nachrichtenhörer anmelden");

  /* Fragen wie Chrome: Der Hörer bekommt Nachricht, Absender und die
     Antwortfunktion. Ob er antwortet, ist Teil der Messung — deshalb wird es
     hier festgehalten und nicht vorausgesetzt. */
  const fragenRoh = (nachricht) => {
    let antwort;
    let kam = false;
    const rueckgabe = zuhoerer[0](nachricht, { id: "abc" }, (a) => {
      antwort = a;
      kam = true;
    });
    return { kam, antwort, rueckgabe };
  };
  const fragen = (nachricht) => {
    const erg = fragenRoh(nachricht);
    assert.ok(erg.kam, `keine Antwort auf ${nachricht.typ}`);
    return JSON.parse(JSON.stringify(erg.antwort));
  };

  /* Was die Seite an ihrem EIGENEN Element hört. Der Unterschied zu einem
     Hörer am Fenster ist der ganze Punkt von §7.2: Ein Ereignis läuft vom
     Fenster zum Ziel (Erfassung) und wieder zurück (Blase). Ein Hörer am
     Ziel kommt also NACH jedem Erfassungshörer am Fenster und VOR jedem
     Blasenhörer dort. Ruft er `stopPropagation()`, ist alles Spätere weg. */
  const zielHoerer = [];
  const seiteHoert = (typ, fn) => zielHoerer.push({ typ, fn });

  const feuern = (typ, roh = {}) => {
    let gestoppt = false;
    const ereignis = {
      type: typ,
      isTrusted: true,
      ...roh,
      stopPropagation() {
        gestoppt = true;
      },
      stopImmediatePropagation() {
        gestoppt = true;
      },
      preventDefault() {},
    };
    const laufen = (liste, wenn) => {
      for (const h of [...liste]) {
        if (h.typ !== typ || gestoppt) continue;
        if (wenn && !wenn(h)) continue;
        h.fn(ereignis);
      }
    };
    laufen(hoerer, (h) => !!h.o.capture); // 1. Erfassung, vom Fenster abwärts
    laufen(zielHoerer, null); //              2. am Ziel, wo die Seite hört
    laufen(hoerer, (h) => !h.o.capture); //   3. Blase, zurück zum Fenster
    return ereignis;
  };

  /* Der Beobachter meldet, was sich geändert hat. */
  const aendern = (eintraege) => {
    for (const b of beobachter) if (b.__aktiv) b.__ruf(eintraege, b);
  };
  const seiteArbeitet = (ziel) =>
    aendern([{ type: "childList", target: ziel || seite.dok.body, addedNodes: [], removedNodes: [] }]);

  const rollen = (y) => {
    zustand.y = y;
    feuern("scroll", { target: seite.dok.documentElement });
  };

  const wirt = () =>
    (seite.dok.body.children || []).find((n) => n && n.id === "smartrchrome-rekorder") || null;

  /* Der Umweg über JSON bildet nach, was Chrome zwischen den Welten tut
     (structured clone) — und macht die Nachricht mit `deepEqual` vergleichbar,
     obwohl sie in einem anderen Rahmen entstanden ist. */
  const anDasPanel = (typ) =>
    spur
      .filter((e) => e.wohin === "panel" && e.nachricht && e.nachricht.typ === typ)
      .map((e) => JSON.parse(JSON.stringify(e.nachricht)));

  return {
    seite,
    sandkasten,
    zustand,
    chrome,
    spur,
    uhr,
    hoerer,
    fragen,
    fragenRoh,
    feuern,
    seiteHoert,
    aendern,
    seiteArbeitet,
    rollen,
    wirt,
    anDasPanel,
    finden: seite.finden,
  };
}

/* ------------------------------------------------------------------ *
 * Zwei Seiten, die immer wieder gebraucht werden
 * ------------------------------------------------------------------ */

function verkaufsseite() {
  return k("html", {}, [
    k("body", {}, [
      k("div", { id: "haupt" }, [
        k("button", { "data-testid": "relist", id: "relist" }, "Erneut einstellen", "relist"),
        k("input", { id: "itemnr", name: "artikelnummer" }, [], "itemnr"),
        k("select", { id: "zustand", name: "zustand" }, [
          k("option", { value: "neu" }, "Neu"),
          k("option", { value: "gebraucht" }, "Gebraucht"),
        ], "zustand"),
        k("div", { contenteditable: "true", id: "notiz", "aria-label": "Notiz" }, "", "notiz"),
        k("a", { id: "hilfe", href: "/hilfe" }, "Hilfe", "hilfe"),
      ]),
    ]),
  ]);
}

/* Eine Anmeldemaske mit allen drei Sorten Geheimnis: Passwort, Einmalcode,
   Kartennummer. */
function anmeldeseite() {
  return k("html", {}, [
    k("body", {}, [
      k("form", { id: "anmeldung" }, [
        k("input", { id: "benutzer", name: "benutzername" }, [], "benutzer"),
        k("input", { id: "pw", name: "passwort", type: "password" }, [], "pw"),
        k("input", { id: "otp", name: "code", autocomplete: "one-time-code" }, [], "otp"),
        k("input", { id: "karte", name: "kartennummer", autocomplete: "cc-number" }, [], "karte"),
        k("button", { id: "absenden", type: "submit" }, "Anmelden", "absenden"),
        k("a", { id: "vergessen", href: "/reset" }, "Passwort vergessen", "vergessen"),
      ]),
    ]),
  ]);
}

const alsText = (was) => JSON.stringify(was);

/* ------------------------------------------------------------------ *
 * R1 bis R3 — Start, Zeichen, Erfassungsphase
 * ------------------------------------------------------------------ */

test("R1: der Start antwortet, zeigt das Zeichen und merkt sich, wo es losging", async () => {
  const u = await starten(verkaufsseite());
  const antwort = u.fragen({ typ: "rekorder:start" });
  assert.equal(antwort.ok, true);
  assert.equal(antwort.laeuft, true);

  const w = u.wirt();
  assert.ok(w, "das Zeichen muss in der Seite hängen");
  assert.equal(w.__schatten.mode, "closed", "der Schattenbaum ist geschlossen, sonst greift die Seite hinein");
  assert.ok(w.style.cssText.includes("!important"), "ohne !important schaltet ein Seiten-Stylesheet das Zeichen ab");
  for (const pflicht of ["display:block", "visibility:visible", "opacity:1", "position:fixed"]) {
    assert.ok(w.style.cssText.includes(pflicht), `im Stil des Wirts fehlt ${pflicht}`);
  }
  const schild = w.__schatten.kinder[0];
  assert.ok(schild.style.cssText.includes("!important"), "auch das Schild selbst steht mit !important");
  assert.equal(schild.textContent, "● Aufnahme läuft, 1 Schritt");

  /* Der erste Schritt ist der Ort, an dem der Mensch stand. */
  const erg = u.fragen({ typ: "rekorder:stop" });
  assert.equal(erg.schritte.length, 1);
  assert.deepEqual(Array.from(erg.schritte), [
    { type: "navigate", url: "https://www.ebay.de/verkaufen", wait: "load" },
  ]);
});

test("R2: jeder Hörer hängt in der Erfassungsphase", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });

  const erwartet = ["click", "dblclick", "input", "change", "keydown", "scroll", "popstate", "hashchange"];
  for (const typ of erwartet) {
    const h = u.hoerer.find((x) => x.typ === typ);
    assert.ok(h, `es fehlt ein Hörer für ${typ}`);
    assert.equal(h.o.capture, true, `${typ} muss in der Erfassungsphase hängen (§7.2)`);
  }
  /* Nur der Bildlauf ist passiv: Dort sagt es dem Browser zu, dass nichts
     abgefangen wird. Bei den übrigen wäre es eine Zusage über etwas, das wir
     gar nicht tun. */
  assert.equal(u.hoerer.find((x) => x.typ === "scroll").o.passive, true);
  assert.equal(u.hoerer.find((x) => x.typ === "click").o.passive, undefined);
});

test("R3: eine Seite, die stopPropagation ruft, schaltet die Aufnahme nicht ab", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });

  /* Das Seitenskript hängt an seinem eigenen Knopf und beendet die
     Ausbreitung — die Bauart jeder zweiten Anmeldemaske. Hinge der Rekorder
     in der Blasenphase, käme er nach diesem Hörer und bekäme nichts mehr. */
  let seiteSahEs = 0;
  u.seiteHoert("click", (e) => {
    seiteSahEs += 1;
    e.stopPropagation();
  });

  u.feuern("click", { target: u.finden("relist") });
  const erg = u.fragen({ typ: "rekorder:stop" });
  assert.equal(seiteSahEs, 1, "die Seite hat ihren Klick bekommen");
  assert.equal(erg.schritte.length, 2, "und der Rekorder seinen Schritt");
  assert.equal(erg.schritte[1].type, "click");
});

/* ------------------------------------------------------------------ *
 * R4 — das Verbot ohne Zweifelsfall
 * ------------------------------------------------------------------ */

test("R4: in ein Geheimfeld wird kein Wert aufgezeichnet, und keiner gelesen", async () => {
  const u = await starten(anmeldeseite(), { url: "https://www.ebay.de/anmelden" });
  u.fragen({ typ: "rekorder:start" });

  const pw = u.finden("pw");
  const otp = u.finden("otp");
  const karte = u.finden("karte");
  const benutzer = u.finden("benutzer");

  const GEHEIMNISSE = ["Hunter2!Geheim", "884213", "4111111111111111"];

  /* Der Mensch meldet sich an: Name, Passwort, Einmalcode, Karte, absenden. */
  benutzer.value = "julian";
  u.feuern("input", { target: benutzer });

  pw.value = GEHEIMNISSE[0];
  u.feuern("input", { target: pw });
  u.feuern("keydown", { target: pw, key: "Tab" });

  otp.value = GEHEIMNISSE[1];
  u.feuern("input", { target: otp });

  karte.value = GEHEIMNISSE[2];
  u.feuern("input", { target: karte });

  u.feuern("click", { target: u.finden("absenden") });
  u.feuern("keydown", { target: pw, key: "Enter" });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);

  /* 1. Keines der drei Geheimnisse steht irgendwo im Ablauf — auch nicht in
        einem Selektor, einer Beschreibung oder einem Bildnamen. */
  for (const geheimnis of GEHEIMNISSE) {
    assert.ok(!text.includes(geheimnis), `„${geheimnis}" steht im Ablauf: ${text}`);
  }

  /* 2. Und die Werte wurden gar nicht erst gelesen. Das ist der Unterschied,
        den §7.2 ausdrücklich macht: nicht lesen und verwerfen, sondern gar
        nicht erst anfassen. */
  assert.equal(pw.__wertGelesen, 0, "der Wert des Passwortfeldes wurde gelesen");
  assert.equal(otp.__wertGelesen, 0, "der Wert des Einmalcodes wurde gelesen");
  assert.equal(karte.__wertGelesen, 0, "der Wert des Kartenfeldes wurde gelesen");

  /* 3. An ihrer Stelle steht die Übergabe an den Menschen, wörtlich wie in
        §7.2 — und nicht dreimal hintereinander dieselbe. */
  const uebergaben = Array.from(erg.schritte).filter((s) => s.type === "user_input_required");
  assert.equal(uebergaben.length, 1, `aus einer Anmeldung wird eine Übergabe: ${text}`);
  assert.deepEqual(JSON.parse(JSON.stringify(uebergaben[0])), {
    type: "user_input_required",
    reason: "Login/2FA",
  });
  /* Auch das Absenden gehört dazu. Ein Ablauf, der die Anmeldemaske ohne
     Passwort abschickt, ist ein Fehlversuch, und drei davon sperren das
     Konto. */
  assert.ok(
    !Array.from(erg.schritte).some((s) => s.type === "click"),
    `das Absenden der Anmeldung darf kein eigener Schritt werden: ${text}`
  );

  /* 4. Der harmlose Benutzername steht sehr wohl da. Eine Erkennung, die
        alles verschluckt, wäre keine Erkennung, sondern ein Ausschalter. */
  assert.ok(text.includes("julian"), "der Benutzername gehört in den Ablauf");
  assert.equal(benutzer.__wertGelesen > 0, true);
});

test("R5: der Weg zum vergessenen Passwort ist kein Anmeldeversuch", async () => {
  const u = await starten(anmeldeseite());
  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("vergessen") });
  const erg = u.fragen({ typ: "rekorder:stop" });
  const letzter = erg.schritte[erg.schritte.length - 1];
  assert.equal(letzter.type, "click", `erwartet war ein Klick, bekommen: ${alsText(letzter)}`);
  assert.ok(alsText(letzter).includes("hilfe") === false);
  assert.ok(letzter.selector_cascade.length >= 1);
});

/* ------------------------------------------------------------------ *
 * R6 bis R12 — die einzelnen Ereignisse
 * ------------------------------------------------------------------ */

test("R6: getippt wird der Stand des Feldes, nicht jeder Tastendruck", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  const feld = u.finden("itemnr");
  for (const teil of ["4", "47", "471", "4711"]) {
    feld.value = teil;
    u.feuern("input", { target: feld });
  }
  const erg = u.fragen({ typ: "rekorder:stop" });
  const eingaben = Array.from(erg.schritte).filter((s) => s.type === "input");
  assert.equal(eingaben.length, 1, `aus vier Tastendrücken wird ein Schritt: ${alsText(erg.schritte)}`);
  assert.equal(eingaben[0].value, "4711");
  assert.equal(eingaben[0].clear, true, "aufgezeichnet ist der Endstand, also wird vorher geleert");
  assert.ok(eingaben[0].selector_cascade.includes("#itemnr"));
});

test("R7: eine Auswahl wird mit dem Etikett aufgezeichnet, das der Mensch gesehen hat", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  const liste = u.finden("zustand");
  liste.selectedIndex = 1;
  u.feuern("change", { target: liste });
  /* Ein `change` an einem Textfeld ist das Verlassen des Feldes und kein
     zweiter Schritt (§7.2). */
  u.feuern("change", { target: u.finden("itemnr") });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const auswahl = Array.from(erg.schritte).filter((s) => s.type === "select");
  assert.equal(auswahl.length, 1);
  assert.equal(auswahl[0].label, "Gebraucht");
  assert.equal(auswahl[0].value, undefined, "genau ein Weg, sonst lehnt die Werkstatt den Schritt ab");
  assert.equal(auswahl[0].index, undefined);
});

test("R8: der Bildlauf ist gedrosselt und wird netto gebucht", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });

  /* Zehn Rasten am Rollrad innerhalb der Drossel. */
  for (let i = 1; i <= 10; i++) u.rollen(i * 60);
  assert.equal(u.fragen({ typ: "rekorder:stand" }).anzahl, 1, "vor Ablauf der Drossel entsteht kein Schritt");
  u.uhr.vor(250);

  let stand = u.fragen({ typ: "rekorder:stand" });
  assert.equal(stand.anzahl, 2, "nach der Drossel genau ein Bildlaufschritt");

  /* Weiter in dieselbe Richtung: dieselbe Bewegung, kein zweiter Schritt. */
  u.rollen(900);
  u.uhr.vor(250);
  stand = u.fragen({ typ: "rekorder:stand" });
  assert.equal(stand.anzahl, 2, "gleiche Richtung wird zusammengezählt");

  const erg = u.fragen({ typ: "rekorder:stop" });
  const rollen = Array.from(erg.schritte).filter((s) => s.type === "scroll");
  assert.equal(rollen.length, 1);
  assert.equal(rollen[0].direction, "down");
  assert.equal(rollen[0].amount, 900);
});

test("R9: ein Wackeln am Rollrad ist kein Schritt", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  u.rollen(2);
  u.uhr.vor(250);
  assert.equal(u.fragen({ typ: "rekorder:stand" }).anzahl, 1);
});

test("R10: aus DOM-Ruhe wird eine Wartezeit, aus Stille nichts", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("relist") });

  /* Die Seite arbeitet, dann wird sie ruhig. */
  u.seiteArbeitet();
  u.uhr.vor(200);
  u.seiteArbeitet();
  u.uhr.vor(500);

  let stand = u.fragen({ typ: "rekorder:stand" });
  assert.equal(stand.anzahl, 3, "navigate, click, wait");

  /* Und noch einmal 500 ms Stille: Daraus entsteht kein zweiter Wartschritt,
     sonst wüchse der Ablauf, solange der Mensch überlegt. */
  u.uhr.vor(2000);
  stand = u.fragen({ typ: "rekorder:stand" });
  assert.equal(stand.anzahl, 3);

  const erg = u.fragen({ typ: "rekorder:stop" });
  const warten = Array.from(erg.schritte).filter((s) => s.type === "wait");
  assert.equal(warten.length, 1);
  assert.equal(warten[0].until, "idle");
  assert.ok(/Millisekunden gearbeitet/.test(warten[0].beschreibung), warten[0].beschreibung);
});

test("R11: nur Enter und Tab, und nur vom Menschen", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  const feld = u.finden("itemnr");
  for (const key of ["a", "Escape", "F5", "Shift", "Enter", "Tab"]) {
    u.feuern("keydown", { target: feld, key });
  }
  /* Ein Tastendruck, den ein Skript ausgelöst hat: Der Agent selbst tippt so,
     und die Seite auch. */
  u.feuern("keydown", { target: feld, key: "Enter", isTrusted: false });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const tasten = Array.from(erg.schritte).filter((s) => s.type === "key").map((s) => s.key);
  assert.deepEqual(tasten, ["Enter", "Tab"]);
});

test("R12: was kein Mensch getan hat, wird nicht aufgezeichnet", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  const knopf = u.finden("relist");
  const feld = u.finden("itemnr");

  /* Die Ereigniskette des eigenen Agenten (overlay.js klickt so) und alles,
     was die Seite selbst auslöst. */
  u.feuern("click", { target: knopf, isTrusted: false });
  feld.value = "vom Skript";
  u.feuern("input", { target: feld, isTrusted: false });
  u.feuern("change", { target: u.finden("zustand"), isTrusted: false });

  const erg = u.fragen({ typ: "rekorder:stop" });
  assert.equal(erg.schritte.length, 1, `nur der Startschritt: ${alsText(erg.schritte)}`);
});

test("R13: ein Doppelklick frisst seinen eigenen Vorklick", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  const knopf = u.finden("relist");
  u.feuern("click", { target: knopf });
  u.feuern("dblclick", { target: knopf });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const zeiger = Array.from(erg.schritte).filter((s) => s.type === "click" || s.type === "dblclick");
  assert.equal(zeiger.length, 1, `sonst wird beim Abspielen dreimal geklickt: ${alsText(erg.schritte)}`);
  assert.equal(zeiger[0].type, "dblclick");
  assert.equal(zeiger[0].screenshot, "s1.webp", "und die Bildnummer läuft nicht davon");
});

/* ------------------------------------------------------------------ *
 * R14 bis R18 — Nachrichten, Bilder, Ablage
 * ------------------------------------------------------------------ */

test("R14: der Stand geht bei jedem Schritt an die Seitenleiste", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("relist") });

  const stand = u.fragen({ typ: "rekorder:stand" });
  assert.deepEqual(stand, { ok: true, laeuft: true, anzahl: 2, voll: false });

  const gemeldet = u.anDasPanel("rekorder:stand");
  assert.ok(gemeldet.length >= 2, "der Stand wird von sich aus gemeldet, nicht nur auf Nachfrage");
  assert.deepEqual(gemeldet[gemeldet.length - 1], { typ: "rekorder:stand", anzahl: 2, laeuft: true });
});

test("R15: das Miniaturbild wird angemeldet, nicht selbst aufgenommen", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("relist") });

  const bilder = u.anDasPanel("rekorder:bild");
  assert.equal(bilder.length, 1);
  assert.equal(bilder[0].name, "s1.webp");
  assert.equal(bilder[0].anlass, "user_request", "der Anlass stammt aus BILD_ANLAESSE und ist keine neue Erfindung");
  assert.deepEqual(bilder[0].rect, { x: 10, y: 20, width: 120, height: 30 });

  /* Kein zweiter Bildweg: Die Aufnahme selbst macht der Ausführer. */
  assert.equal(u.spur.filter((e) => e.wohin === "tabs.captureVisibleTab").length, 0);

  const erg = u.fragen({ typ: "rekorder:stop" });
  assert.equal(erg.schritte[1].screenshot, "s1.webp");
  /* Beim Tippen gibt es kein Bild: Es zeigte den getippten Text ein zweites
     Mal, und bei einem Formular ist das genau das, was nicht doppelt liegen
     soll. */
  u.fragen({ typ: "rekorder:start" });
  const feld = u.finden("itemnr");
  feld.value = "4711";
  u.feuern("input", { target: feld });
  const zweiter = u.fragen({ typ: "rekorder:stop" });
  assert.equal(zweiter.schritte[1].screenshot, undefined);
});

test("R16: eine geschlossene Seitenleiste hält die Aufnahme nicht auf", async () => {
  const u = await starten(verkaufsseite(), { panelHoert: false });
  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("relist") });
  const erg = u.fragen({ typ: "rekorder:stop" });
  assert.equal(erg.schritte.length, 2, "der Schritt entsteht, obwohl niemand zuhört");
});

test("R17: die Aufnahme überlebt den Seitenwechsel", async () => {
  const erste = await starten(verkaufsseite(), { url: "https://www.ebay.de/verkaufen" });
  erste.fragen({ typ: "rekorder:start" });
  erste.feuern("click", { target: erste.finden("relist") });

  /* So sieht die Ablage nach dem Klick aus. Das neue Dokument bekommt genau
     das, was der Browser wirklich weiterreicht. */
  const gemerkt = await erste.chrome.storage.local.get("sa_rekorder");
  assert.ok(gemerkt.sa_rekorder, "die laufende Aufnahme muss die Ablage erreichen");
  assert.equal(gemerkt.sa_rekorder.laeuft, true);
  assert.equal(gemerkt.sa_rekorder.schritte.length, 2);

  /* Der Seitenwechsel: neues Dokument, neue Adresse, Skripte frisch
     eingespielt. */
  const zweite = await starten(verkaufsseite(), {
    url: "https://www.ebay.de/verkaufen/schritt2",
    ablageLocal: { sa_rekorder: gemerkt.sa_rekorder },
  });
  await new Promise((f) => setTimeout(f, 0)); // die Ablage antwortet mit einem Versprechen

  const stand = zweite.fragen({ typ: "rekorder:stand" });
  assert.equal(stand.laeuft, true, "im neuen Dokument läuft dieselbe Aufnahme weiter");
  assert.equal(stand.anzahl, 3, "und der Ortswechsel ist ihr dritter Schritt");
  assert.ok(zweite.wirt(), "auch das Zeichen ist wieder da");

  const erg = zweite.fragen({ typ: "rekorder:stop" });
  assert.deepEqual(Array.from(erg.schritte).map((s) => s.type), ["navigate", "click", "navigate"]);
  assert.equal(erg.schritte[2].url, "https://www.ebay.de/verkaufen/schritt2");

  /* Nach dem Stopp ist die Ablage leer: Eine halbe Aufnahme, die morgen noch
     dasteht, wäre ein Mitschnitt ohne Anlass. */
  const nachher = await zweite.chrome.storage.local.get("sa_rekorder");
  assert.deepEqual(nachher, {});
});

test("R18: das Zeichen kommt zurück, wenn die Seite es herausnimmt", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  const vorher = u.wirt();
  assert.ok(vorher);

  /* Ein Seitenskript räumt den Wirt weg und meldet die Änderung. */
  u.seite.dok.body.removeChild(vorher);
  assert.equal(u.wirt(), null);
  u.seiteArbeitet();

  const nachher = u.wirt();
  assert.ok(nachher, "der Wirt muss zurückkommen");
  assert.ok(nachher.style.cssText.includes("!important"));
});

/* ------------------------------------------------------------------ *
 * R19 bis R23 — Antworten, Absagen, Grenzen
 * ------------------------------------------------------------------ */

test("R19: ohne Selektor-Kaskade gibt es eine Absage mit Begründung, keine Ausnahme", async () => {
  const u = await starten(verkaufsseite(), { ohneSelektor: true });
  const antwort = u.fragen({ typ: "rekorder:start" });
  assert.equal(antwort.ok, false);
  assert.equal(antwort.fehler, "selektor_fehlt");
  assert.ok(antwort.satz && antwort.hinweis, "eine Absage nennt Grund und Weg");
  assert.equal(u.wirt(), null, "und es läuft auch nichts an");
  assert.equal(u.fragen({ typ: "rekorder:stand" }).laeuft, false);
});

test("R20: fremde Nachrichten werden nicht beantwortet", async () => {
  const u = await starten(verkaufsseite());
  /* `overlay.js` hängt im selben Tab am selben Ereignis. Wer hier antwortet,
     nimmt ihm jede Antwort weg — die erste Antwort gewinnt. */
  const erg = u.fragenRoh({ typ: "overlay:baum" });
  assert.equal(erg.kam, false, "auf eine fremde Nachricht antwortet der Rekorder nicht");
  assert.equal(erg.rueckgabe, false, "und sagt Chrome, dass keine Antwort kommt");

  /* Auf die eigenen Nachrichten dagegen kommt immer eine Antwort. */
  for (const typ of ["rekorder:start", "rekorder:stand", "rekorder:ping", "rekorder:stop"]) {
    const a = u.fragen({ typ });
    assert.equal(typeof a, "object", `${typ} muss antworten`);
  }
});

test("R21: zweimal stoppen ist kein Fehler", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  const erste = u.fragen({ typ: "rekorder:stop" });
  assert.equal(erste.schritte.length, 1);

  const zweite = u.fragen({ typ: "rekorder:stop" });
  assert.equal(zweite.ok, true);
  assert.equal(zweite.schritte.length, 0);
  assert.ok(zweite.satz, "eine leere Aufnahme sagt, dass sie leer ist");
  assert.equal(u.wirt(), null);

  /* Und nach dem Stopp zeichnet nichts mehr auf. */
  u.feuern("click", { target: u.finden("relist") });
  assert.equal(u.fragen({ typ: "rekorder:stand" }).anzahl, 0);
});

test("R22: zweimal starten startet nicht zweimal", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("relist") });
  const zweite = u.fragen({ typ: "rekorder:start" });
  assert.equal(zweite.ok, true);
  assert.equal(zweite.schon, true, "die laufende Aufnahme wird nicht heimlich weggeworfen");
  assert.equal(u.fragen({ typ: "rekorder:stand" }).anzahl, 2);
});

test("R23: am Schrittdeckel hört die Aufnahme auf zu wachsen", async () => {
  const voll = [];
  for (let i = 0; i < 500; i++) voll.push({ type: "key", key: "Tab" });
  const u = await starten(verkaufsseite(), {
    ablageLocal: { sa_rekorder: { version: 1, laeuft: true, bildNr: 0, schritte: voll } },
  });
  await new Promise((f) => setTimeout(f, 0));

  const stand = u.fragen({ typ: "rekorder:stand" });
  assert.equal(stand.anzahl, 500);
  assert.equal(stand.voll, true);

  u.feuern("click", { target: u.finden("relist") });
  assert.equal(u.fragen({ typ: "rekorder:stand" }).anzahl, 500,
    "mehr Schritte als der Deckel liesse `workflowPruefen` ohnehin nicht durch");
});

/* ------------------------------------------------------------------ *
 * R24 — die Abnahme: was hier herauskommt, nimmt die Werkstatt an
 * ------------------------------------------------------------------ */

test("R24: der aufgezeichnete Ablauf besteht workflowPruefen unverändert", async () => {
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });

  const feld = u.finden("itemnr");
  const liste = u.finden("zustand");

  u.feuern("click", { target: u.finden("relist") });
  u.seiteArbeitet();
  u.uhr.vor(500);
  feld.value = "4711";
  u.feuern("input", { target: feld });
  liste.selectedIndex = 1;
  u.feuern("change", { target: liste });
  u.feuern("keydown", { target: feld, key: "Enter" });
  u.rollen(600);
  u.uhr.vor(250);
  u.feuern("dblclick", { target: u.finden("relist") });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const schritte = JSON.parse(JSON.stringify(erg.schritte));
  assert.ok(schritte.length >= 7, `zu wenig aufgezeichnet: ${alsText(schritte)}`);

  const geprueft = workflowPruefen({
    id: "wf_pruefung",
    name: "Aufgezeichneter Ablauf",
    version: 1,
    params: [],
    steps: schritte,
  });
  assert.equal(geprueft.ok, true,
    `die Werkstatt lehnt den aufgezeichneten Ablauf ab: ${geprueft.code} — ${geprueft.satz}`);
  /* Und sie lässt ihn nicht bloss durch, sie behält ihn ganz: Kein Schritt
     und kein Feld fällt beim Prüfen still weg. */
  assert.equal(geprueft.workflow.steps.length, schritte.length);
  assert.deepEqual(geprueft.workflow.steps, schritte);
});

test("R25: auch die Anmeldemaske ergibt einen Ablauf, den die Werkstatt annimmt", async () => {
  const u = await starten(anmeldeseite(), { url: "https://www.ebay.de/anmelden" });
  u.fragen({ typ: "rekorder:start" });
  const pw = u.finden("pw");
  pw.value = "Hunter2!Geheim";
  u.feuern("input", { target: pw });
  u.feuern("click", { target: u.finden("absenden") });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const schritte = JSON.parse(JSON.stringify(erg.schritte));
  const geprueft = workflowPruefen({
    id: "wf_anmeldung",
    name: "Anmeldung",
    version: 1,
    params: [],
    steps: schritte,
  });
  assert.equal(geprueft.ok, true, `${geprueft.code} — ${geprueft.satz}`);
  assert.ok(
    geprueft.workflow.steps.some((s) => s.type === "user_input_required" && s.reason === "Login/2FA"),
    "der Ablauf hält an der Anmeldung an"
  );
});

test("R26: ein Anker, der das Element nicht wiederfindet, kommt nicht in den Ablauf", async () => {
  const u = await starten(verkaufsseite());

  /* Ein Element in einem geschlossenen Schattenbaum findet sein eigener
     XPath nie wieder — `document.evaluate` kommt dort nicht hinein. Die
     Attrappe bildet genau das nach: Der XPath trifft ab jetzt nichts. */
  u.seite.dok.evaluate = () => ({ singleNodeValue: null });

  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("relist") });
  const erg = u.fragen({ typ: "rekorder:stop" });

  const kaskade = Array.from(erg.schritte[1].selector_cascade);
  assert.ok(kaskade.length >= 1, "der Schritt braucht einen Anker");
  assert.ok(!kaskade.some((a) => a.startsWith("/")), `der tote XPath steht noch drin: ${alsText(kaskade)}`);
  assert.ok(kaskade.includes('[data-testid="relist"]'), `die tragenden Anker bleiben: ${alsText(kaskade)}`);
});

test("R27: findet gar kein Anker zurück, entsteht trotzdem ein Schritt", async () => {
  const u = await starten(
    k("html", {}, [k("body", {}, [k("div", {}, [k("span", {}, "", "nackt")])])])
  );
  /* Ein Element in einem geschlossenen Schattenbaum ist für das Dokument
     weder über einen Selektor noch über einen XPath erreichbar. Die Attrappe
     bildet genau diese Lage nach: Das Dokument findet nichts mehr.
     Ein Schritt, der beim Abspielen laut scheitert, ist mehr wert als einer,
     der still fehlt — §7.4 heilt ihn über die Beschreibung. */
  u.seite.dok.evaluate = () => ({ singleNodeValue: null });
  u.seite.dok.querySelectorAll = () => [];
  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("nackt") });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const schritt = erg.schritte[erg.schritte.length - 1];
  assert.equal(schritt.type, "click");
  assert.equal(schritt.selector_cascade.length, 1);
  assert.ok(schritt.selector_cascade[0].startsWith("/"), alsText(schritt.selector_cascade));
  assert.ok(schritt.beschreibung, "und die Beschreibung, an der die Selbstheilung ansetzt");
});

/* ================================================================== *
 * R28 bis R35 — Befund B5 vom 14.08.2026: die drei gemessenen Lecks
 *
 * Die Erkennung war ausser `type=password` und der `cc`-Familie im
 * `autocomplete` eine reine Wortliste. Was sie nicht kannte, las `aufEingabe`
 * als `el.value` aus und schrieb es wörtlich in den Ablauf. Alle drei Fälle
 * hier bestanden `workflowPruefen` und lagen danach unverschlüsselt in
 * `sa_workflows`.
 *
 * Gemessen wird jedes Mal doppelt, wie in R4: einmal als Textsuche über den
 * ganzen Ablauf, und einmal als Tatsache über den Zugriff. Ein Rekorder, der
 * liest und danach verwirft, bliebe bei der Textsuche grün.
 * ================================================================== */

/* Leck 1: sechs Kästchen für den Einmalcode, in einem Formular, das ein
   echtes Passwortfeld enthält. `geheimUmfeld` deckte dort nur die
   Absendeknöpfe, also gingen die Kästchen glatt durch. */
function kaestchen(nr) {
  return k("input", { name: `d${nr}`, "aria-label": `Ziffer ${nr}`, maxlength: "1" }, [], `d${nr}`);
}

function einmalcodeImFormular() {
  return k("html", {}, [
    k("body", {}, [
      k("form", { id: "anmeldung" }, [
        k("input", { id: "benutzer", name: "benutzername" }, [], "benutzer"),
        k("input", { id: "pw", name: "passwort", type: "password" }, [], "pw"),
        k("div", { class: "kaesten" }, [1, 2, 3, 4, 5, 6].map(kaestchen)),
        k("button", { id: "absenden", type: "submit" }, "Bestätigen", "absenden"),
      ]),
    ]),
  ]);
}

/* Dieselben Kästchen auf einer reinen 2FA-Seite, ohne jedes Passwortfeld.
   Hier trägt kein Umfeld, sondern allein die Bauform der Reihe. */
function einmalcodeOhneFormular() {
  return k("html", {}, [
    k("body", {}, [
      k("div", { class: "karte" }, [
        k("h2", {}, "Code aus der App"),
        k("div", { class: "kaesten" }, [1, 2, 3, 4, 5, 6].map(kaestchen)),
        k("button", { class: "weiter" }, "Weiter", "weiter"),
      ]),
    ]),
  ]);
}

const EINMALCODE = ["8", "4", "9", "2", "7", "1"];

function codeTippen(u) {
  for (let nr = 1; nr <= 6; nr++) {
    const feld = u.finden(`d${nr}`);
    feld.value = EINMALCODE[nr - 1];
    u.feuern("input", { target: feld });
  }
}

test("R28: die sechs Kästchen des Einmalcodes kommen nicht in den Ablauf", async () => {
  const u = await starten(einmalcodeImFormular(), { url: "https://www.ebay.de/anmelden" });
  u.fragen({ typ: "rekorder:start" });
  codeTippen(u);

  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);

  const eingaben = Array.from(erg.schritte).filter((s) => s.type === "input");
  assert.deepEqual(eingaben, [], `aus den Kästchen darf kein Eingabeschritt werden: ${text}`);
  for (let nr = 1; nr <= 6; nr++) {
    assert.equal(u.finden(`d${nr}`).__wertGelesen, 0, `der Wert von d${nr} wurde gelesen`);
  }
  /* Zusammengesetzt stünde hier der ganze Code. Also auch die Ziffern einzeln
     suchen, und zwar dort, wo sie stehen könnten. */
  assert.ok(!text.includes('"value"'), `irgendein Wert steht im Ablauf: ${text}`);

  const uebergaben = Array.from(erg.schritte).filter((s) => s.type === "user_input_required");
  assert.equal(uebergaben.length, 1, `aus sechs Kästchen wird eine Übergabe: ${text}`);
  assert.equal(uebergaben[0].reason, "Login/2FA");
});

test("R29: dieselben Kästchen ohne Formular und ohne Passwort auch nicht", async () => {
  const u = await starten(einmalcodeOhneFormular(), { url: "https://www.ebay.de/2fa" });
  u.fragen({ typ: "rekorder:start" });
  codeTippen(u);

  const erg = u.fragen({ typ: "rekorder:stop" });
  assert.deepEqual(
    Array.from(erg.schritte).filter((s) => s.type === "input"),
    [],
    `hier trägt allein die Bauform der Reihe: ${alsText(erg.schritte)}`
  );

  /* Und die Bauform ist die gemessene Regel, nicht das Ergebnis: sechs
     Kästchen mit demselben winzigen Fassungsvermögen im selben Abschnitt. */
  const G = u.sandkasten.SMARTR_GEHEIM;
  assert.equal(G.zifferngruppe(u.finden("d1")), true, "eine Reihe gleichartiger Kästchen");
  assert.equal(G.zifferngruppe(u.finden("weiter")), false, "ein Knopf ist keine Reihe");
});

test("R30: die Kartennummer im Branchenfeld `pan` kommt nicht in den Ablauf", async () => {
  /* `pan` ist der Branchenname (Primary Account Number); Adyen und Worldpay
     benutzen ihn. Keine Wortliste dieser Erweiterung kannte ihn, und genau
     das ist der Punkt: Sie muss ihn auch nicht kennen. */
  const u = await starten(
    k("html", {}, [
      k("body", {}, [
        k("div", { class: "zahlung" }, [
          k("input", { name: "pan", maxlength: "19", inputmode: "numeric" }, [], "pan"),
          k("button", { class: "bezahlen" }, "Bezahlen", "bezahlen"),
        ]),
      ]),
    ]),
    { url: "https://www.ebay.de/kasse" }
  );
  u.fragen({ typ: "rekorder:start" });
  const feld = u.finden("pan");
  feld.value = "4111111111111111";
  u.feuern("input", { target: feld });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);
  assert.ok(!text.includes("4111111111111111"), `die Kartennummer steht im Ablauf: ${text}`);
  assert.equal(feld.__wertGelesen, 0, "und sie wurde nicht einmal gelesen");
  assert.ok(
    Array.from(erg.schritte).some((s) => s.type === "user_input_required"),
    text
  );
});

test("R31: das Passwortfeld nach dem Klick aufs Auge bleibt geschützt", async () => {
  /* Die Seite tauscht `type=password` gegen `type=text`, damit der Mensch
     sein Passwort lesen kann. Danach war es für die alte Erkennung ein
     gewöhnliches Textfeld, und „pw" stand in keiner Liste. */
  const u = await starten(
    k("html", {}, [
      k("body", {}, [
        k("div", { class: "anmeldemaske" }, [
          k("input", { name: "benutzername" }, [], "benutzer"),
          k("input", { name: "pw", type: "text" }, [], "pw"),
          k("button", { class: "auge", "aria-label": "Anzeigen" }, "", "auge"),
          k("button", { class: "anmelden" }, "Anmelden", "anmelden"),
        ]),
      ]),
    ]),
    { url: "https://www.ebay.de/anmelden" }
  );
  u.fragen({ typ: "rekorder:start" });
  const pw = u.finden("pw");
  pw.value = "hunter2";
  u.feuern("input", { target: pw });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);
  assert.ok(!text.includes("hunter2"), `das Passwort steht im Ablauf: ${text}`);
  assert.equal(pw.__wertGelesen, 0, "und es wurde nicht einmal gelesen");
  assert.ok(Array.from(erg.schritte).some((s) => s.type === "user_input_required"), text);
});

test("R32: was sich als gewöhnliches Feld ausweist, wird weiterhin aufgezeichnet", async () => {
  /* Die Gegenprobe zu R28 bis R31, und sie ist die wichtigere Hälfte: Eine
     Erkennung, die alles verschluckt, ist keine Erkennung, sondern ein
     Ausschalter. Der Ablauf muss noch etwas taugen. */
  const u = await starten(verkaufsseite());
  u.fragen({ typ: "rekorder:start" });

  const feld = u.finden("itemnr");
  feld.value = "4711";
  u.feuern("input", { target: feld });

  const notiz = u.finden("notiz");
  notiz.__inhalt.push("Zustand sehr gut");
  u.feuern("input", { target: notiz });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const eingaben = Array.from(erg.schritte).filter((s) => s.type === "input");
  assert.equal(eingaben.length, 2, alsText(erg.schritte));
  assert.equal(eingaben[0].value, "4711", "die Artikelnummer weist sich über ihren Namen aus");
  assert.equal(eingaben[1].value, "Zustand sehr gut", "die Notiz über ihre Beschriftung");
  assert.ok(feld.__wertGelesen > 0, "ein belegtes Feld wird gelesen");
});

test("R33: die Prüfziffer schlägt auch in einem belegten Feld zu", async () => {
  /* Ein Shop, der seine Zahlungsmaske aus demselben Bauteil baut wie seine
     Bestellmaske, nennt das Feld „bestellnummer". Der Name ist dann
     belegt — die Luhn-Prüfziffer sagt trotzdem, was wirklich drinsteht. */
  const u = await starten(
    k("html", {}, [
      k("body", {}, [
        k("div", { class: "kasse" }, [
          k("input", { name: "bestellnummer", "aria-label": "Bestellnummer" }, [], "feld"),
        ]),
      ]),
    ])
  );
  u.fragen({ typ: "rekorder:start" });
  const feld = u.finden("feld");
  feld.value = "4111 1111 1111 1111";
  u.feuern("input", { target: feld });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);
  assert.ok(!text.includes("4111"), `die Kartennummer steht im Ablauf: ${text}`);
  assert.ok(Array.from(erg.schritte).some((s) => s.type === "user_input_required"), text);

  /* Und eine gewöhnliche Bestellnummer im selben Feld geht durch. */
  u.fragen({ typ: "rekorder:start" });
  feld.value = "17-44821";
  u.feuern("input", { target: feld });
  const zweiter = u.fragen({ typ: "rekorder:stop" });
  assert.ok(alsText(zweiter.schritte).includes("17-44821"), alsText(zweiter.schritte));
});

test("R33b: ein kurzes Ziffernkästchen ist ein Code, auch mit harmlosem Namen", async () => {
  /* Die zweite Hälfte von B5, die keine Wortliste je fangen könnte: Ein Shop,
     der sein Bestätigungsfeld „bestellnummer" nennt, hat es trotzdem auf sechs
     Ziffern begrenzt und `inputmode="numeric"` gesetzt. Die Bauform sagt, was
     der Name verschweigt. */
  const seite = (zusatz) =>
    k("html", {}, [
      k("body", {}, [
        k("div", { class: "kasse" }, [
          k("input", { name: "bestellnummer", ...zusatz }, [], "feld"),
        ]),
      ]),
    ]);

  const eng = await starten(seite({ maxlength: "6", inputmode: "numeric" }));
  eng.fragen({ typ: "rekorder:start" });
  const kasten = eng.finden("feld");
  kasten.value = "849271";
  eng.feuern("input", { target: kasten });
  const erste = eng.fragen({ typ: "rekorder:stop" });
  assert.ok(!alsText(erste.schritte).includes("849271"), alsText(erste.schritte));

  /* Dasselbe Feld ohne Längenbegrenzung ist eine gewöhnliche Bestellnummer. */
  const weit = await starten(seite({}));
  weit.fragen({ typ: "rekorder:start" });
  const frei = weit.finden("feld");
  frei.value = "849271";
  weit.feuern("input", { target: frei });
  const zweite = weit.fragen({ typ: "rekorder:stop" });
  assert.ok(alsText(zweite.schritte).includes("849271"), alsText(zweite.schritte));
});

test("R34: der Einmalcode wird auch nicht zur Beschreibung eines Schrittes", async () => {
  /* Befund B6, die Hälfte, die in dieser Datei sitzt: Der Mensch klickt auf
     die Anzeige des Codes, und die Beschreibung des Schrittes WAR der Code. */
  const u = await starten(
    k("html", {}, [
      k("body", {}, [
        k("div", { class: "karte" }, [
          k("span", { class: "otp-anzeige" }, "849271", "anzeige"),
          k("button", { class: "kopieren", "data-code": "849271" }, "Kopieren", "kopieren"),
        ]),
      ]),
    ]),
    { url: "https://www.ebay.de/2fa" }
  );
  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("anzeige") });
  u.feuern("click", { target: u.finden("kopieren") });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);
  assert.ok(!text.includes("849271"), `der Einmalcode steht im Ablauf: ${text}`);

  /* Beide Klicks bleiben trotzdem Schritte, mit einem Anker, der trägt. */
  const klicks = Array.from(erg.schritte).filter((s) => s.type === "click");
  assert.equal(klicks.length, 2, text);
  for (const klick of klicks) assert.ok(klick.selector_cascade.length >= 1, text);
  /* Und der Knopf behält seine sprechende Beschreibung. */
  assert.equal(klicks[1].beschreibung, "Kopieren");
});

test("R35: ohne die eine Quelle läuft gar keine Aufnahme", async () => {
  /* Die Gegenprobe zu F4. Eine Aufnahme ohne Geheimerkennung schreibt alles
     mit, was in einem Feld steht — lieber gar keine Aufnahme als eine, die
     man erst hinterher liest. */
  const u = await starten(anmeldeseite(), { ohneGeheim: true });
  const antwort = u.fragen({ typ: "rekorder:start" });
  assert.equal(antwort.ok, false);
  assert.equal(antwort.fehler, "geheim_fehlt");
  assert.ok(antwort.satz && antwort.hinweis, "eine Absage nennt Grund und Weg");
  assert.ok(!antwort.satz.includes("—"), "Kommas statt Gedankenstrichen, der Text wird vorgelesen");
  assert.equal(u.wirt(), null, "und es läuft auch nichts an");
});

test("R36: auch die neuen Absagen ergeben einen Ablauf, den die Werkstatt annimmt", async () => {
  const u = await starten(einmalcodeImFormular(), { url: "https://www.ebay.de/anmelden" });
  u.fragen({ typ: "rekorder:start" });
  const benutzer = u.finden("benutzer");
  benutzer.value = "julian";
  u.feuern("input", { target: benutzer });
  codeTippen(u);
  u.feuern("click", { target: u.finden("absenden") });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const schritte = JSON.parse(JSON.stringify(erg.schritte));
  const geprueft = workflowPruefen({
    id: "wf_2fa",
    name: "Anmeldung mit Einmalcode",
    version: 1,
    params: [],
    steps: schritte,
  });
  assert.equal(geprueft.ok, true, `${geprueft.code} — ${geprueft.satz}`);
  assert.ok(alsText(schritte).includes("julian"), "der Benutzername gehört weiterhin hinein");
  assert.ok(schritte.some((s) => s.type === "user_input_required"), alsText(schritte));
});

/* ================================================================== *
 * R37 bis R45 — die Abnahmefunde TEACH-1 bis TEACH-4, TEACH-7 und TEACH-8
 * vom 14.08.2026, alle über den Produktivweg gemessen.
 *
 * Eine Fehlerart hält sie zusammen: Die Wache prüft das GANZE, die Gefahr
 * tritt als TEIL auf. `textHarmlos("849271")` war falsch,
 * `textHarmlos("Dein Code lautet 849271")` wahr; `harmlosBeleg` fand „mail"
 * irgendwo in einem Satz und gab damit einen Einmalcode frei. Was jeder
 * einzelne Prüfsatz hier misst, ist deshalb nie die Funktion allein, sondern
 * der Ablauf, der am Ende in `sa_workflows` liegt.
 * ================================================================== */

/* Die gemessene 2FA-Seite: der Code steht als SATZ auf dem Schirm, das Feld
   trägt eine Erklärung statt eines Namens. Beides ist der Alltag, und beides
   ist vorher durchgegangen. */
function zweiFaktorMitSatz() {
  return k("html", {}, [
    k("body", {}, [
      k("div", { class: "karte" }, [
        k("p", { id: "hinweis" }, "Dein Code lautet 849271", "hinweis"),
        k(
          "label",
          { for: "c" },
          "Wir haben dir eine E-Mail geschickt, trag die sechs Ziffern hier ein.",
          "etikett"
        ),
        k("input", { id: "c" }, [], "code"),
        k("button", { class: "weiter" }, "Weiter", "weiter"),
      ]),
    ]),
  ]);
}

test("R37: ein Einmalcode MITTEN im Satz wird weder Anker noch Beschreibung", async () => {
  const u = await starten(zweiFaktorMitSatz(), { url: "https://www.ebay.de/2fa" });
  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("hinweis") });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);
  assert.ok(!text.includes("849271"), `der Einmalcode steht im Ablauf: ${text}`);

  /* Der Klick bleibt trotzdem ein Schritt, mit einem Anker, der trägt. */
  const klick = Array.from(erg.schritte).find((s) => s.type === "click");
  assert.ok(klick, text);
  assert.ok(klick.selector_cascade.includes("#hinweis"), alsText(klick.selector_cascade));
  /* Und weil vom Text nichts übrig bleibt, sagt die Beschreibung das auch,
     statt still „p" zu behaupten (TEACH-1). */
  assert.ok(u.sandkasten.SMARTR_GEHEIM.namenlos(klick.beschreibung), klick.beschreibung);
});

test("R38: ein erklärender Satz am Feld ist kein Beleg, sondern eine Erklärung", async () => {
  /* Befund TEACH-3, erster gemessener Fall: `harmlosBeleg` prüfte
     `flach.includes(wort)` über die ganze Etikettzeile. „Wir haben dir eine
     E-Mail geschickt …" enthält „mail", also galt das Feld als belegt, und
     `{"type":"input","value":"849271"}` lag im Ablauf. */
  const u = await starten(zweiFaktorMitSatz(), { url: "https://www.ebay.de/2fa" });
  u.fragen({ typ: "rekorder:start" });
  const feld = u.finden("code");
  feld.value = "849271";
  u.feuern("input", { target: feld });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);
  assert.ok(!text.includes("849271"), `der Einmalcode steht im Ablauf: ${text}`);
  assert.equal(feld.__wertGelesen, 0, "und er wurde nicht einmal gelesen");
  assert.ok(
    Array.from(erg.schritte).some((s) => s.type === "user_input_required" && s.reason === "Login/2FA"),
    text
  );

  /* Gegenprobe an derselben Stelle: Ein Feld, das wirklich „E-Mail" heisst,
     bleibt ein gewöhnliches Feld. Es geht um die Länge der Aussage, nicht um
     das Wort. */
  const G = u.sandkasten.SMARTR_GEHEIM;
  assert.equal(G.bezeichnungTaugt("E-Mail"), true);
  assert.equal(G.bezeichnungTaugt("Wir haben dir eine E-Mail geschickt, trag die sechs Ziffern hier ein."), false);
});

test("R39: neben einem Passwortfeld zählt auch die Gestalt des Wertes", async () => {
  /* Befund TEACH-3, zweiter gemessener Fall: Das Feld hiess „Bestellung
     bestaetigen", der Beleg zog, und der Riegel `abschnitt_geheim` griff
     ausdrücklich NUR bei Feldern OHNE Beleg. Im selben `<form>` stand ein
     `type=password`. */
  const seite = () =>
    k("html", {}, [
      k("body", {}, [
        k("form", { id: "anmeldung" }, [
          k("input", { id: "pw", name: "passwort", type: "password" }, [], "pw"),
          k("label", { for: "t" }, "Bestellung bestaetigen", "etikett"),
          k("input", { id: "t" }, [], "feld"),
        ]),
      ]),
    ]);

  const u = await starten(seite(), { url: "https://www.ebay.de/anmelden" });
  u.fragen({ typ: "rekorder:start" });
  const feld = u.finden("feld");
  feld.value = "849271";
  u.feuern("input", { target: feld });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);
  assert.ok(!text.includes("849271"), `der Einmalcode steht im Ablauf: ${text}`);
  assert.ok(Array.from(erg.schritte).some((s) => s.type === "user_input_required"), text);

  /* Gegenprobe, und sie ist die wichtigere Hälfte: Was ein Mensch neben einem
     Passwortfeld wirklich schreibt, bleibt stehen. Sonst wäre aus der Wache
     ein Ausschalter geworden. */
  const zwei = await starten(seite(), { url: "https://www.ebay.de/anmelden" });
  zwei.fragen({ typ: "rekorder:start" });
  const feld2 = zwei.finden("feld");
  feld2.value = "Meier";
  zwei.feuern("input", { target: feld2 });
  const zweiter = zwei.fragen({ typ: "rekorder:stop" });
  assert.ok(alsText(zweiter.schritte).includes("Meier"), alsText(zweiter.schritte));
});

test("R40: der Wiederherstellungsschlüssel kommt auch aus einem belegten Feld nicht durch", async () => {
  /* Befund TEACH-4: Die Formprüfung kannte nur reine Ziffern, Luhn und
     `^[A-Z0-9]{6,12}$`. Gemessen durchgekommen sind `a3f9c2`,
     `sk-live-9f3a2b`, `a1b2c-3d4e5`, `8s7d6f5g`, `kl4us-2026` — also genau
     das, was GitHub, Discord und die Authenticator-Verfahren ausgeben. */
  const seite = () =>
    k("html", {}, [
      k("body", {}, [
        k("div", { class: "kasse" }, [
          k("input", { name: "bestellnummer", "aria-label": "Bestellnummer" }, [], "feld"),
        ]),
      ]),
    ]);

  for (const geheimnis of ["a3f9c2", "A3f9C2", "a1b2c-3d4e5", "x7f2k9-p3q8r1", "8s7d6f5g", "sk-live-9f3a2b", "kl4us-2026", "abcd efgh ijkl mnop"]) {
    const u = await starten(seite());
    u.fragen({ typ: "rekorder:start" });
    const feld = u.finden("feld");
    feld.value = geheimnis;
    u.feuern("input", { target: feld });
    const erg = u.fragen({ typ: "rekorder:stop" });
    const text = alsText(erg.schritte);
    assert.ok(!text.includes(geheimnis), `„${geheimnis}" steht im Ablauf: ${text}`);
    assert.ok(
      Array.from(erg.schritte).some((s) => s.type === "user_input_required"),
      `„${geheimnis}": ${text}`
    );
  }

  /* Und die Gegenprobe, Wort für Wort: Was ein Mensch in ein Formular tippt,
     bleibt drin. „iPhone13" und „julian69" tragen ihre Ziffern am Ende, das
     ist ein Wort mit einer Zahl und kein Code — die Entscheidung steht
     ausgeschrieben in `tokenGestalt`. */
  for (const gut of ["17-44821", "iPhone13", "julian69", "Zustand sehr gut", "86150 Augsburg"]) {
    const u = await starten(seite());
    u.fragen({ typ: "rekorder:start" });
    const feld = u.finden("feld");
    feld.value = gut;
    u.feuern("input", { target: feld });
    const erg = u.fragen({ typ: "rekorder:stop" });
    assert.ok(alsText(erg.schritte).includes(gut), `„${gut}" fehlt im Ablauf: ${alsText(erg.schritte)}`);
  }
});

test("R41: die Zifferntastatur ist kein Nachweis über den Inhalt", async () => {
  /* Befund TEACH-7: `type="tel"` war ein bedingungsloser Harmlos-Beleg, und
     `<input id="s" type="tel" value="849271">` ergab
     `{"ok":true,"wert":"849271","beleg":"feldtyp"}`. `tel` öffnet die
     Zifferntastatur; über den Inhalt sagt das nichts. */
  const u = await starten(
    k("html", {}, [
      k("body", {}, [
        k("div", { class: "maske" }, [k("input", { id: "s", type: "tel" }, [], "ohneNamen")]),
        k("div", { class: "kontakt" }, [
          k("input", { id: "t", type: "tel", name: "telefon" }, [], "telefon"),
        ]),
      ]),
    ])
  );
  u.fragen({ typ: "rekorder:start" });
  const ohneNamen = u.finden("ohneNamen");
  ohneNamen.value = "849271";
  u.feuern("input", { target: ohneNamen });

  const telefon = u.finden("telefon");
  telefon.value = "0821 4567890";
  u.feuern("input", { target: telefon });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);
  assert.ok(!text.includes("849271"), `der Code steht im Ablauf: ${text}`);
  assert.equal(ohneNamen.__wertGelesen, 0, "und er wurde nicht einmal gelesen");
  /* Gegenprobe: Ein Feld, das wirklich ein Telefonfeld ist, sagt das mit
     seinem Namen und wird weiterhin aufgezeichnet. */
  assert.ok(text.includes("0821 4567890"), `die Telefonnummer gehört in den Ablauf: ${text}`);
});

test("R42: auf einer Seite mit einem Code auf dem Schirm wird kein Bild angefordert", async () => {
  /* Befund TEACH-8: Zu jedem Klick- und Auswahlschritt ging ein JPEG des
     ganzen sichtbaren Tabs nach `chrome.storage.local`, ohne jede
     Geheimprüfung — gemessen an genau dem Augenblick, in dem der Einmalcode
     auf dem Schirm stand. `geheimUmfeld` schützt nur Elemente IM
     Geheimabschnitt, der Klick daneben ging durch. */
  const u = await starten(zweiFaktorMitSatz(), { url: "https://www.ebay.de/2fa" });
  u.fragen({ typ: "rekorder:start" });
  u.feuern("click", { target: u.finden("weiter") });

  assert.deepEqual(u.anDasPanel("rekorder:bild"), [], "auf dieser Seite wird kein Bild angefordert");
  const erg = u.fragen({ typ: "rekorder:stop" });
  const klick = Array.from(erg.schritte).find((s) => s.type === "click");
  assert.ok(klick, alsText(erg.schritte));
  assert.equal(klick.screenshot, undefined, alsText(klick));

  /* Gegenprobe: Auf einer gewöhnlichen Seite bleibt das Vorschaubild. Es geht
     um den Augenblick, nicht um die Abschaffung. */
  const gut = await starten(verkaufsseite());
  gut.fragen({ typ: "rekorder:start" });
  gut.feuern("click", { target: gut.finden("relist") });
  assert.equal(gut.anDasPanel("rekorder:bild").length, 1);
});

test("R43: zwei Felder mit Etikett heissen nicht beide „input\"", async () => {
  /* Befund TEACH-1: `beschreibungVon` las weder `label[for]` noch das
     umschliessende `<label>` und fiel deshalb auf den Elementnamen zurück.
     Zwei verschiedene Felder hiessen dann beide „input", der
     Identitätsvergleich aus F3 fand keinen Unterschied, und die Artikelnummer
     wurde ins Titelfeld getippt — Antwort `success`. */
  const u = await starten(
    k("html", {}, [
      k("body", {}, [
        k("form", { id: "maske" }, [
          k("label", { for: "f1" }, "Titel", "l1"),
          k("input", { id: "f1" }, [], "titelfeld"),
          k("label", { for: "f2" }, "Artikelnummer", "l2"),
          k("input", { id: "f2" }, [], "nummerfeld"),
          k("span", { id: "leer" }, "", "leer"),
        ]),
      ]),
    ])
  );
  u.fragen({ typ: "rekorder:start" });
  const titel = u.finden("titelfeld");
  titel.value = "Schuhe";
  u.feuern("input", { target: titel });
  const nummer = u.finden("nummerfeld");
  nummer.value = "9988776655";
  u.feuern("input", { target: nummer });
  u.feuern("click", { target: u.finden("leer") });

  const erg = u.fragen({ typ: "rekorder:stop" });
  const eingaben = Array.from(erg.schritte).filter((s) => s.type === "input");
  assert.equal(eingaben.length, 2, alsText(erg.schritte));
  assert.equal(eingaben[0].beschreibung, "Titel");
  assert.equal(eingaben[1].beschreibung, "Artikelnummer");
  assert.notEqual(
    eingaben[0].beschreibung,
    eingaben[1].beschreibung,
    "zwei Felder mit demselben Namen heben die Identitätswache aus F3 aus"
  );

  /* Und wo wirklich nur der Elementname übrig bleibt, steht das auch da. Ein
     stiller Name ist der gefährlichere Fall: Er sieht aus wie eine Aussage. */
  const klick = Array.from(erg.schritte).find((s) => s.type === "click");
  const G = u.sandkasten.SMARTR_GEHEIM;
  assert.ok(G.namenlos(klick.beschreibung), klick.beschreibung);
  assert.equal(klick.beschreibung, `${G.OHNE_NAMEN}span`);
  assert.equal(G.namenlos("Artikelnummer"), false);
});

test("R44: der Einmalcode in der Adresse kommt nicht in den Ablauf", async () => {
  /* Dieselbe Fehlerart an einer Stelle, die keiner der Funde nennt, und sie
     ist beim Suchen nach weiteren Aufrufstellen aufgefallen: `navigate`
     schrieb `location.href` ungeprüft in den Ablauf. Ein Bestätigungslink
     aus der E-Mail, eine OAuth-Rückleitung und ein Zurücksetzen-Link tragen
     ihr Geheimnis in der Adresse, und ein Mensch geht beim Aufzeichnen genau
     darüber. */
  const u = await starten(verkaufsseite(), {
    url: "https://www.ebay.de/verify?token=8f3a2b9c&next=/verkaufen#code=849271",
  });
  u.fragen({ typ: "rekorder:start" });
  const erg = u.fragen({ typ: "rekorder:stop" });
  const text = alsText(erg.schritte);

  assert.ok(!text.includes("8f3a2b9c"), `die Bestätigungsmarke steht im Ablauf: ${text}`);
  assert.ok(!text.includes("849271"), `der Einmalcode steht im Ablauf: ${text}`);
  const navigate = Array.from(erg.schritte).find((s) => s.type === "navigate");
  assert.equal(navigate.url, "https://www.ebay.de/verify?next=/verkaufen");
  assert.ok(navigate.beschreibung, "ein weggelassener Parameter wird gesagt, nicht verschwiegen");

  /* Gegenprobe: Eine gewöhnliche Adresse bleibt Zeichen für Zeichen stehen.
     Eine Artikelnummer im Pfad ist der Alltag dieses Produkts, und ein
     Ablauf, der auf der falschen Seite anfängt, ist kein Ablauf. */
  const gut = await starten(verkaufsseite(), {
    url: "https://www.ebay.de/itm/123456789012?_from=R40",
  });
  gut.fragen({ typ: "rekorder:start" });
  const zweiter = gut.fragen({ typ: "rekorder:stop" });
  assert.equal(zweiter.schritte[0].url, "https://www.ebay.de/itm/123456789012?_from=R40");
  assert.equal(zweiter.schritte[0].beschreibung, undefined);
});

test("R45: jede Gestaltregel trägt einen Namen und wird einzeln gehalten", async () => {
  /* Ein Prüfsatz, der nur das Ergebnis misst, kann nicht unterscheiden, ob
     die richtige Regel gegriffen hat oder eine andere zufällig auch. Deshalb
     dieselbe Bauart wie `ZUFALL_REGELN` in `selektor.js`: Jede Regel hat
     einen Namen, und hier steht, welche wofür zuständig ist. */
  const u = await starten(verkaufsseite());
  const G = u.sandkasten.SMARTR_GEHEIM;

  assert.equal(G.geheimGestalt("849271"), "ziffernkette");
  assert.equal(G.geheimGestalt("Dein Code lautet 849271"), "ziffernkette");
  assert.equal(G.geheimGestalt("Ihre Kartennummer 4111111111111111"), "kartennummer");
  assert.equal(G.geheimGestalt("Karte 4111 1111 1111 1111"), "kartennummer");
  assert.equal(G.geheimGestalt("Schluessel A3F9C2"), "grosscode");
  assert.equal(G.geheimGestalt("Schluessel a1b2c-3d4e5"), "mischcode");
  assert.equal(G.geheimGestalt("Angebot vom 14.08.2026 bearbeiten"), null);
  assert.equal(G.geheimGestalt("Seite 12"), null);
  assert.equal(G.geheimGestalt(""), null);

  /* Die Ziffergruppen: gleich lange Gruppen ab drei Stellen sind EINE Nummer,
     alles andere bleibt getrennt. Ohne diese Unterscheidung wäre jedes Datum
     ein Geheimnis und jede Kartennummer mit Zwischenräumen keines. */
  /* `Array.from` und nicht die Liste selbst: Sie kommt aus dem Sandkasten der
     Seite, und `deepEqual` misst auch den Prototyp. */
  assert.deepEqual(Array.from(G.ziffernketten("4111 1111 1111 1111")), ["4111111111111111"]);
  assert.deepEqual(Array.from(G.ziffernketten("14.08.2026")), ["14", "08", "2026"]);
  assert.deepEqual(Array.from(G.ziffernketten("849 271")), ["849271"]);

  /* Und der Wert kennt die reine Ziffernkette ausdrücklich NICHT als Regel:
     Sie ist der Inhalt jeder Artikelnummer. Darüber entscheidet das Feld. */
  assert.equal(G.wertGestalt("9988776655"), null);
  assert.equal(G.wertGestalt("4111 1111 1111 1111"), "kartennummer");
  assert.equal(G.wertGestalt("a1b2c-3d4e5"), "mischcode");
  assert.equal(G.wertGestalt("abcd efgh ijkl mnop"), "gruppenkette");
  assert.equal(G.wertGestalt("Haus Baum Ball Wald"), null, "vier Wörter sind kein Schlüssel");
});
