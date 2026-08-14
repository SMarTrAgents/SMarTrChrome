/*
 * Prüfung der Selektor-Kaskade — das echte `src/content/selektor.js`,
 * gefahren gegen einen Seitenbaum, der Selektoren wirklich auflöst.
 *
 * Warum die Attrappe hier einen echten kleinen Selektor-Motor hat und nicht
 * bloss vorbereitete Antworten: Diese Datei baut Anker UND löst sie wieder
 * auf. Eine Attrappe, die auf `querySelectorAll` immer dasselbe Element
 * zurückgibt, würde jeden Anker für eindeutig halten — auch den, der auf einer
 * echten Seite zwei Knöpfe trifft. Gemessen würde dann nur, dass die Funktion
 * eine Zeichenkette zurückgibt.
 *
 * Das Akzeptanzkriterium des Auftrags steht in S7 und S8: Ändert sich die
 * Seite so, dass Anker 1 bricht, trägt Anker 2 den Schritt weiter.
 *
 * Was die Attrappe NICHT kann und was deshalb am Gerät bleibt: echtes Layout,
 * Schattenbäume, fremde Rahmenseiten. Der Selektor-Motor kennt genau die
 * Formen, die `selektor.js` selbst erzeugt — trifft er auf etwas anderes,
 * wirft er, statt still „kein Treffer" zu sagen. Ein neuer Ankertyp fällt so
 * im Prüfsatz auf und nicht erst beim Kunden.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const QUELLE = new URL("../content/selektor.js", import.meta.url);
const GEHEIM_QUELLE = new URL("../content/geheim.js", import.meta.url);

/* ------------------------------------------------------------------ *
 * Ein kleiner, echter Seitenbaum
 * ------------------------------------------------------------------ */

/** Ein Bauplan für einen Knoten. `inhalt` ist Text oder eine Liste von Kindern. */
export function k(tag, attrs = {}, inhalt = [], merke = null) {
  return { tag, attrs, inhalt, merke };
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
  if (teil.tag && teil.tag !== "*" && el.tagName !== teil.tag) return false;
  if (teil.id && el.getAttribute("id") !== teil.id) return false;
  for (const kl of teil.klassen) {
    if (!String(el.getAttribute("class") || "").split(/\s+/).includes(kl)) return false;
  }
  for (const [name, wert] of teil.attrs) {
    const hat = el.getAttribute(name);
    if (hat === null) return false;
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

/*
 * Selektoren in Stücke schneiden, ohne in Klammern und Anführungszeichen zu
 * schneiden.
 *
 * Beim ersten Lauf am 14.08.2026 zerlegte die Attrappe hier stumpf an jedem
 * Leerzeichen. `[aria-label="Erneut einstellen"]` wurde damit zu zwei Gliedern
 * einer Nachfahrenkette, traf nichts, und `selektor.js` verwarf einen völlig
 * gesunden Anker als mehrdeutig. Der Fehler lag in der Attrappe, gekostet
 * hätte er den zweiten Anker der ganzen Kaskade.
 */
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
  for (const kind of el.children) {
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

let laufendeNr = 0;

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
    children: [],
    isConnected: true,
    __inhalt: inhalt,
    __nr: ++laufendeNr,
    __rect: bauplan.attrs && bauplan.attrs.__rect,
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
    hasAttribute(n) {
      return attrs.has(String(n).toLowerCase());
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
    matches(sel) {
      return suchen(dok, sel).includes(el);
    },
    closest(sel) {
      let k2 = el;
      while (k2 && k2.nodeType === 1) {
        if (passt(k2, kompaktParsen(sel))) return k2;
        k2 = k2.parentElement;
      }
      return null;
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

  /* Der Wert liegt hinter einem Zugriffszähler. Damit ist „der Rekorder liest
     den Wert eines Geheimfeldes GAR NICHT erst aus" (§7.2) messbar, und zwar
     als Tatsache über den Zugriff — nicht als Textsuche im Ergebnis, die auch
     dann grün bliebe, wenn der Wert gelesen und danach verworfen würde. */
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

/* Einen Knoten wirklich aus dem Baum nehmen: aus der Kinderliste UND aus dem
   Inhalt des Elternknotens. Nur eines von beidem hiesse, dass das Element
   verschwunden ist und sein Text noch dasteht. */
export function entfernen(el) {
  const eltern = el.parentElement;
  if (!eltern) return el;
  const i = eltern.children.indexOf(el);
  if (i >= 0) eltern.children.splice(i, 1);
  const j = eltern.__inhalt.indexOf(el);
  if (j >= 0) eltern.__inhalt.splice(j, 1);
  el.parentElement = null;
  el.isConnected = false;
  return el;
}

/** …und einen anhängen, so wie es ein Umbau der fremden Seite täte. */
export function anhaengen(eltern, el) {
  el.parentElement = eltern;
  eltern.children.push(el);
  eltern.__inhalt.push(el);
  return el;
}

export function seiteBauen(bauplan) {
  const register = new Map();
  const dok = {
    nodeType: 9,
    ownerDocument: null,
    title: "Prüfseite",
    documentElement: null,
    body: null,
    querySelectorAll(sel) {
      return suchen(dok, sel);
    },
    querySelector(sel) {
      return suchen(dok, sel)[0] || null;
    },
    getElementById(id) {
      return suchen(dok, `[id="${id}"]`)[0] || null;
    },
    /* Nur FIRST_ORDERED_NODE_TYPE und nur absolute Pfade mit Stellenangabe —
       genau die Form, die `xpfadBauen` erzeugt. Jede andere Form wirft, damit
       ein umgebauter XPath hier auffällt und nicht als „kein Treffer" durch
       die Prüfung rutscht. */
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
 * Das Skript laden
 * ------------------------------------------------------------------ */

let quelleZwischen = null;
let geheimZwischen = null;

/**
 * Beide Inhaltsskripte starten, in der Reihenfolge, in der `net/seite.js` sie
 * einspielt: `geheim.js` als ERSTE Datei (Festlegung F4 vom 14.08.2026),
 * danach `selektor.js`.
 *
 * @param {object} dok der Seitenbaum
 * @param {{ohneGeheim?: boolean}} angaben `ohneGeheim` ist die Gegenprobe:
 *        Ohne die eine Quelle darf kein Text mit einer Ziffer in einen Anker.
 */
export async function selektorLaden(dok, { ohneGeheim = false } = {}) {
  if (!quelleZwischen) quelleZwischen = await readFile(QUELLE, "utf8");
  if (!geheimZwischen) geheimZwischen = await readFile(GEHEIM_QUELLE, "utf8");
  const sandkasten = { console, document: dok, setTimeout, clearTimeout };
  sandkasten.window = sandkasten;
  sandkasten.globalThis = sandkasten;
  vm.createContext(sandkasten);
  if (!ohneGeheim) {
    vm.runInContext(geheimZwischen, sandkasten, { filename: "geheim.js" });
    assert.ok(sandkasten.SMARTR_GEHEIM, "geheim.js muss globalThis.SMARTR_GEHEIM setzen");
  }
  vm.runInContext(quelleZwischen, sandkasten, { filename: "selektor.js" });
  assert.ok(sandkasten.SMARTR_SELEKTOR, "selektor.js muss globalThis.SMARTR_SELEKTOR setzen");
  return sandkasten.SMARTR_SELEKTOR;
}

/* Eine Seite, die den ganzen Fächer trägt: Datenmerkmal, Beschriftung mit
   Rolle, Kennung, Text — und daneben Elemente, die dieselben Anker mehrdeutig
   machen könnten. */
function laden() {
  return seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k("div", { id: "haupt", class: "seite css-1x2y3z" }, [
          k("form", { id: "kasse" }, [
            k(
              "button",
              {
                "data-testid": "relist",
                "aria-label": "Erneut einstellen",
                role: "button",
                id: "relist-knopf",
                class: "btn btn-primary sc-bdVaJa",
              },
              "Erneut einstellen",
              "knopf"
            ),
            k("input", { id: "itemnr", name: "artikelnummer", class: "feld" }, [], "feld"),
            k("button", { class: "btn" }, "Abbrechen", "abbrechen"),
          ]),
          k(
            "ul",
            { class: "liste" },
            [
              k("li", { class: "zeile" }, [k("span", {}, "Erster", "erster")]),
              k("li", { class: "zeile" }, [k("span", {}, "Zweiter", "zweiter")]),
              k("li", { class: "zeile" }, [k("span", {}, "Dritter", "dritter")]),
            ],
            "liste"
          ),
        ]),
      ]),
    ])
  );
}

/* ------------------------------------------------------------------ *
 * S1 bis S6 — was in die Kaskade kommt
 * ------------------------------------------------------------------ */

test("S1: das Datenmerkmal steht ganz vorn", async () => {
  const seite = laden();
  const S = await selektorLaden(seite.dok);
  const kaskade = S.kaskadeBauen(seite.finden("knopf"));
  assert.equal(kaskade[0], '[data-testid="relist"]');
});

test("S2: die Reihenfolge ist die aus §7.1", async () => {
  const seite = laden();
  const S = await selektorLaden(seite.dok);
  const kaskade = S.kaskadeBauen(seite.finden("knopf"));

  const stelle = (muster) => kaskade.findIndex((a) => muster.test(a));
  const daten = stelle(/^\[data-testid=/);
  const aria = stelle(/aria-label=/);
  const pfad = stelle(/^#relist-knopf$/);
  const text = stelle(/^text=/);
  const xpfad = stelle(/^\//);

  assert.ok(daten >= 0 && aria >= 0 && pfad >= 0 && text >= 0 && xpfad >= 0,
    `alle fünf Ankerarten erwartet, bekommen: ${JSON.stringify(kaskade)}`);
  assert.ok(daten < aria, "Datenmerkmal vor Beschriftung");
  assert.ok(aria < pfad, "Beschriftung vor CSS-Pfad");
  assert.ok(pfad < text, "CSS-Pfad vor Textanker");
  assert.ok(text < xpfad, "Textanker vor XPath");
  assert.equal(xpfad, kaskade.length - 1, "der XPath ist der letzte Ausweg und steht hinten");
});

test("S3: für ein Element gibt es immer mindestens einen Anker, und der trifft", async () => {
  const seite = seiteBauen(
    k("html", {}, [k("body", {}, [k("div", {}, [k("span", {}, [], "nackt")])])])
  );
  const S = await selektorLaden(seite.dok);
  const ziel = seite.finden("nackt");
  const kaskade = S.kaskadeBauen(ziel);
  assert.ok(kaskade.length >= 1, "ein Element ohne jedes Merkmal bekommt trotzdem einen Anker");
  const erg = S.kaskadeAufloesen(kaskade, seite.dok);
  assert.equal(erg.ok, true);
  assert.equal(erg.el, ziel);
});

test("S4: was kein Element ist, bekommt keinen erfundenen Anker", async () => {
  const seite = laden();
  const S = await selektorLaden(seite.dok);
  for (const nichts of [null, undefined, 42, "button", {}, { nodeType: 3, tagName: "SPAN" }]) {
    assert.equal(S.kaskadeBauen(nichts).length, 0, `für ${JSON.stringify(nichts)} darf nichts entstehen`);
  }
});

test("S5: die Zufallserkennung ist eine benannte Regel, keine Ahnung", async () => {
  const seite = laden();
  const S = await selektorLaden(seite.dok);

  /* Was fliegen MUSS, mit der Regel, die es fangen soll. */
  const raus = [
    ["css-1x2y3z", "praefix_hash"],
    ["sc-bdVaJa", "praefix_hash"],
    ["jss142", "praefix_hash"],
    ["emotion-9f2a1b", "praefix_hash"],
    ["header-a1b2c3", "ziffernmix"],
    ["x1n2onr6", "ziffernmix"],
    ["a3f9c2b1", "ziffernmix"],
    ["deadbeef", "hexkette"],
    ["XyAbCd", "kurzsilben"],
    ["hshtgkr", "vokallos"],
    ["a".repeat(25), "zu_lang"],
  ];
  for (const [name, regel] of raus) {
    const befund = S.klasseZufaellig(name);
    assert.equal(befund.zufall, true, `„${name}" muss als Zufall gelten`);
    assert.equal(befund.regel, regel, `„${name}" soll an der Regel ${regel} scheitern`);
  }

  /* Und was bleiben MUSS. Eine Regel, die alles fängt, ist keine Regel,
     sondern eine Abschaltung des CSS-Pfades. */
  const bleibt = [
    "btn", "btn-primary", "col-md-6", "main-content", "container", "dropdown-menu",
    "seite", "zeile", "liste", "feld", "h1", "col6", "item12", "nav__item", "Button", "AppBar",
  ];
  for (const name of bleibt) {
    assert.equal(S.klasseZufaellig(name).zufall, false, `„${name}" ist keine Zufallsklasse`);
  }
});

test("S6: eine Zufallsklasse kommt in keinen Anker", async () => {
  const seite = laden();
  const S = await selektorLaden(seite.dok);
  const kaskade = S.kaskadeBauen(seite.finden("knopf"));
  const alles = kaskade.join(" ");
  assert.ok(!alles.includes("sc-bdVaJa"), `Zufallsklasse im Anker: ${alles}`);
  assert.ok(!alles.includes("css-1x2y3z"), `Zufallsklasse eines Vorfahren im Anker: ${alles}`);

  /* Gegenprobe: Die stabile Klasse steht sehr wohl zur Verfügung.
     Gemessen wird sie seit dem 14.08.2026 an einem Element, das die Klasse am
     BLATT trägt. Vorher stand hier der Text „Zweiter", und der zugehörige
     Pfad hiess `ul.liste > li.zeile:nth-of-type(2) > span` — die Klasse auf
     dem Vorfahren, die Stellenzählerei auf dem Weg, das Blatt nackt. Genau
     dieser Pfad ist der Befund TEACH-5 und entsteht nicht mehr (S13). Die
     Frage dieses Prüfsatzes ist eine andere, nämlich ob die Zufallserkennung
     eine gepflegte Klasse stehen lässt, und die wird hier weiterhin
     gestellt. */
  const pfad = S.kaskadeBauen(seite.finden("liste")).find((a) => a.includes("ul"));
  assert.ok(pfad && pfad.includes(".liste"), `stabile Klasse erwartet, bekommen: ${pfad}`);
});

/* ------------------------------------------------------------------ *
 * S7 bis S10 — das Akzeptanzkriterium: die Kaskade trägt weiter
 * ------------------------------------------------------------------ */

test("S7: bricht Anker 1, trägt Anker 2 den Schritt weiter", async () => {
  const seite = laden();
  const S = await selektorLaden(seite.dok);
  const ziel = seite.finden("knopf");
  const kaskade = S.kaskadeBauen(ziel);

  const vorher = S.kaskadeAufloesen(kaskade, seite.dok);
  assert.equal(vorher.ok, true);
  assert.equal(vorher.stelle, 0, "vor dem Umbau trägt der stärkste Anker");
  assert.equal(vorher.anker, '[data-testid="relist"]');

  /* Der Umbau der fremden Seite: Das Testmerkmal heisst nach dem nächsten
     Build anders. Genau dafür gibt es die Kaskade. */
  ziel.removeAttribute("data-testid");

  const nachher = S.kaskadeAufloesen(kaskade, seite.dok);
  assert.equal(nachher.ok, true, "der Schritt darf daran nicht scheitern");
  assert.equal(nachher.el, ziel, "und er muss auf demselben Element landen");
  assert.equal(nachher.stelle, 1, "getragen hat jetzt Anker 2");
  assert.ok(nachher.anker.includes("aria-label"), `gemeldet wurde: ${nachher.anker}`);
});

test("S8: brechen Anker 1 und 2, trägt der CSS-Pfad", async () => {
  const seite = laden();
  const S = await selektorLaden(seite.dok);
  const ziel = seite.finden("knopf");
  const kaskade = S.kaskadeBauen(ziel);

  ziel.removeAttribute("data-testid");
  ziel.removeAttribute("aria-label");

  const erg = S.kaskadeAufloesen(kaskade, seite.dok);
  assert.equal(erg.ok, true);
  assert.equal(erg.el, ziel);
  assert.equal(erg.anker, "#relist-knopf");

  /* Und noch eine Ebene tiefer: auch die Kennung fällt weg, dann trägt der
     Text. Das ist der Anker, den ein Mensch beim Aufnehmen gesehen hat. */
  ziel.removeAttribute("id");
  const weiter = S.kaskadeAufloesen(kaskade, seite.dok);
  assert.equal(weiter.ok, true);
  assert.equal(weiter.el, ziel);
  assert.equal(weiter.anker, "text=Erneut einstellen");
});

test("S9: bricht alles, heisst das kaskade_gebrochen und nichts anderes", async () => {
  const seite = laden();
  const S = await selektorLaden(seite.dok);
  const ziel = seite.finden("knopf");
  const kaskade = S.kaskadeBauen(ziel);

  /* Die Seite baut den Bereich komplett um: Der Knopf ist weg, und mit ihm
     das Formular, in dem er stand.

     Warum das ganze Formular und nicht nur der Knopf: Der XPath zählt
     Stellen. Nimmt man nur den Knopf heraus, rückt der Nachbar auf seine
     Stelle, und der XPath fände IHN. Genau deshalb steht der XPath ganz
     unten in der Kaskade und nie oben — er trifft immer etwas, notfalls das
     Falsche. */
  ziel.removeAttribute("data-testid");
  ziel.removeAttribute("aria-label");
  ziel.removeAttribute("id");
  ziel.removeAttribute("class");
  entfernen(seite.dok.getElementById("kasse"));

  const erg = S.kaskadeAufloesen(kaskade, seite.dok);
  assert.equal(erg.ok, false);
  assert.equal(erg.fehler, "kaskade_gebrochen", "§7.4 nennt genau diesen Namen");
  assert.ok(erg.versucht >= 1, "es wurde wirklich probiert");
});

test("S10: kaputte Anker werden beantwortet, nicht geworfen", async () => {
  const seite = laden();
  const S = await selektorLaden(seite.dok);

  /* Ein von Hand veränderter Ablauf kann alles Mögliche enthalten. Keine
     dieser Formen darf eine Ausnahme werden: Der Ausführer wartet auf eine
     Aussage, und eine Ausnahme ist keine. */
  const muell = [
    [],
    null,
    undefined,
    "kein Feld",
    ["[[[", "text=", 42, null, {}, "/html[1]/nichts"],
    ["))nichtCSS(("],
    ["/kaputt/xpath"],
  ];
  for (const eingabe of muell) {
    const erg = S.kaskadeAufloesen(eingabe, seite.dok);
    assert.equal(typeof erg, "object");
    assert.equal(erg.ok, false, `für ${JSON.stringify(eingabe)} war eine Absage erwartet`);
    assert.ok(["anker_fehlt", "kaskade_gebrochen"].includes(erg.fehler), `unbekannte Absage: ${erg.fehler}`);
  }
});

/* ------------------------------------------------------------------ *
 * S11 bis S16 — die einzelnen Regeln
 * ------------------------------------------------------------------ */

test("S11: der Textanker trägt genauen Text und höchstens 80 Zeichen", async () => {
  const lang = "Sehr langer Knopftext, ".repeat(6);
  const seite = seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k("button", { class: "a" }, "  Erneut   einstellen  ", "kurz"),
        k("button", { class: "b" }, lang, "lang"),
      ]),
    ])
  );
  const S = await selektorLaden(seite.dok);

  const kurz = S.kaskadeBauen(seite.finden("kurz")).find((a) => a.startsWith("text="));
  assert.equal(kurz, "text=Erneut einstellen", "der Text wird normalisiert, nicht gekürzt");

  const langer = S.kaskadeBauen(seite.finden("lang")).find((a) => a.startsWith("text="));
  assert.equal(langer, undefined, `${lang.length} Zeichen sind kein Anker mehr`);
});

test("S12: aus dem Inhalt eines Feldes wird nie ein Anker gebaut", async () => {
  const seite = seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k("input", { type: "password", name: "passwort", value: "Hunter2Geheim" }, [], "pw"),
        k("div", { contenteditable: "true" }, "Getippter Inhalt", "bereich"),
        k("select", { name: "land" }, [k("option", {}, "Deutschland"), k("option", {}, "Österreich")], "liste"),
      ]),
    ])
  );
  const S = await selektorLaden(seite.dok);

  for (const name of ["pw", "bereich", "liste"]) {
    const el = seite.finden(name);
    const kaskade = S.kaskadeBauen(el);
    assert.ok(!kaskade.some((a) => a.startsWith("text=")), `${name} darf keinen Textanker bekommen: ${kaskade}`);
    assert.equal(el.__wertGelesen, 0, `${name}: der Wert wurde gelesen, und das darf hier niemand`);
    assert.ok(!JSON.stringify(kaskade).includes("Hunter2Geheim"), "kein Geheimnis im Anker");
    assert.ok(!JSON.stringify(kaskade).includes("Getippter"), "kein getippter Inhalt im Anker");
  }
});

test("S13: der Pfad bleibt kurz, und eine Stellenangabe macht ihn wertlos", async () => {
  /* ERWARTUNG GEÄNDERT am 14.08.2026, Befund TEACH-5. Vorher stand hier:
     „der Pfad nimmt die Stelle nur, wenn er sie braucht", und gemessen wurde,
     dass `ul.liste > li.zeile:nth-of-type(2) > span` entsteht und trifft.
     Er trifft — auch nach einem Umbau, und dann das falsche Element: Ein
     davor eingeschobenes `<li>` verschiebt die Zählung, der Anker bleibt
     eindeutig, und der Schritt geht auf die falsche Zeile. Gemessen wurde
     genau das mit `[data-testid="zeile-1"]` in der Abnahme.
     Eine Stellenangabe ist deshalb keine Notlösung mehr, sondern das
     Ausschlusskriterium: Ein Pfad, der zählt, kommt nicht in die Kaskade.
     Was er kostet, ist ein Anker; was er einbrächte, wäre ein stiller
     Fehlgriff. Der Textanker darunter trägt den Schritt weiter, und genau
     das ist die Reihenfolge aus §7.1. */
  const seite = laden();
  const S = await selektorLaden(seite.dok);

  const zweiter = seite.finden("zweiter");
  const kaskade = S.kaskadeBauen(zweiter);
  const pfad = kaskade.find((a) => !a.startsWith("text=") && !a.startsWith("/"));
  assert.equal(pfad, undefined, `ein zählender Pfad steht in der Kaskade: ${JSON.stringify(kaskade)}`);
  assert.ok(kaskade.includes("text=Zweiter"), `der Textanker trägt jetzt: ${JSON.stringify(kaskade)}`);
  assert.equal(S.kaskadeAufloesen(kaskade, seite.dok).el, zweiter, "und der Schritt bleibt abspielbar");

  /* Gegenprobe eins: Trägt das Blatt selbst ein Merkmal, entsteht der Pfad
     sofort wieder — und zwar ohne jede Stellenangabe. */
  zweiter.setAttribute("class", "wert");
  const mitKlasse = S.kaskadeBauen(zweiter).find((a) => !a.startsWith("text=") && !a.startsWith("/"));
  assert.ok(mitKlasse, `mit Klasse am Blatt war ein Pfad erwartet: ${JSON.stringify(S.kaskadeBauen(zweiter))}`);
  assert.ok(!mitKlasse.includes(":nth-"), `keine Stellenangabe: ${mitKlasse}`);
  assert.ok(mitKlasse.split(">").length <= S.PFAD_EBENEN, `höchstens ${S.PFAD_EBENEN} Ebenen: ${mitKlasse}`);
  assert.equal(S.kaskadeAufloesen([mitKlasse], seite.dok).el, zweiter);

  /* Gegenprobe zwei: Wo die Kennung reicht, steht keine Stelle im Anker. */
  const knopfPfad = S.kaskadeBauen(seite.finden("knopf")).find((a) => a.startsWith("#"));
  assert.equal(knopfPfad, "#relist-knopf");
});

test("S14: ein mehrdeutiges Merkmal wird nicht zum Anker", async () => {
  const seite = seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k("ul", {}, [
          k("li", {}, [k("button", { "data-testid": "kaufen" }, "Kaufen", "eins")]),
          k("li", {}, [k("button", { "data-testid": "kaufen" }, "Kaufen", "zwei")]),
        ]),
      ]),
    ])
  );
  const S = await selektorLaden(seite.dok);
  const zwei = seite.finden("zwei");
  const kaskade = S.kaskadeBauen(zwei);

  assert.ok(!kaskade.includes('[data-testid="kaufen"]'),
    "ein Merkmal, das zwei Knöpfe trifft, ist kein Anker");
  assert.ok(!kaskade.includes("text=Kaufen"), "ein doppelter Text ist kein Anker");

  const erg = S.kaskadeAufloesen(kaskade, seite.dok);
  assert.equal(erg.ok, true);
  assert.equal(erg.el, zwei, "und aufgelöst wird der zweite, nicht der erste");
});

test("S15: auch beim Auflösen zählt Eindeutigkeit", async () => {
  const seite = seiteBauen(
    k("html", {}, [k("body", {}, [k("div", { id: "kopf" }, [k("button", { class: "kaufen" }, "Kaufen", "eins")])])])
  );
  const S = await selektorLaden(seite.dok);
  const eins = seite.finden("eins");
  const kaskade = S.kaskadeBauen(eins);
  assert.equal(S.kaskadeAufloesen(kaskade, seite.dok).el, eins);

  /* Die Seite bekommt einen zweiten Knopf derselben Art. Ein Anker, der jetzt
     zwei trifft, hat seine Aussage verloren — den ersten zu nehmen wäre
     geraten, und geraten wird hier nicht. */
  const kopf = seite.dok.getElementById("kopf");
  const zweiter = seiteBauen(k("html", {}, [k("body", {}, [k("button", { class: "kaufen" }, "Kaufen", "x")])])).finden("x");
  anhaengen(kopf, zweiter);

  const erg = S.kaskadeAufloesen(["button.kaufen"], seite.dok);
  assert.equal(erg.ok, false);
  assert.equal(erg.fehler, "kaskade_gebrochen");
});

test("S16: die Kaskade bleibt unter dem Deckel der Werkstatt", async () => {
  const seite = seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k(
          "button",
          {
            "data-testid": "a", "data-test": "b", "data-cy": "c", "data-rolle": "d",
            "data-bereich": "e", "data-schritt": "f", "aria-label": "Speichern",
            role: "button", id: "speichern", class: "btn",
          },
          "Speichern",
          "voll"
        ),
      ]),
    ])
  );
  const S = await selektorLaden(seite.dok);
  const kaskade = S.kaskadeBauen(seite.finden("voll"));
  assert.ok(kaskade.length <= S.KASKADE_HOECHSTENS, `höchstens ${S.KASKADE_HOECHSTENS}, bekommen ${kaskade.length}`);
  /* `werkstatt.js` lässt 8 Anker je Schritt durch (WERKSTATT_GRENZEN.
     ankerJeSchritt). Die Lücke ist die Luft für einen selbstgeheilten Anker
     aus §7.4. */
  assert.ok(kaskade.length < 8, "unter dem Deckel der Werkstatt bleibt Platz zum Heilen");
  assert.ok(kaskade[kaskade.length - 1].startsWith("/"), "der XPath fällt dabei nicht hinten herunter");
});

test("S17: Merkmale des Rahmenwerks sind keine Anker", async () => {
  const seite = seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k("button", { "data-reactid": "17", "data-v-4f2ab9": "", "data-index": "3", "data-aktion": "senden" }, "Senden", "s"),
      ]),
    ])
  );
  const S = await selektorLaden(seite.dok);
  const kaskade = S.kaskadeBauen(seite.finden("s"));
  const daten = Array.from(kaskade).filter((a) => a.includes("data-"));
  assert.deepEqual(daten, ['[data-aktion="senden"]'],
    `nur das gepflegte Merkmal darf durch, bekommen: ${JSON.stringify(daten)}`);
});

test("S18: die Beschriftung wird mit der Rolle verankert", async () => {
  const seite = seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k("div", { role: "button", "aria-label": "Menü öffnen" }, [], "div"),
        k("button", { "aria-label": "Schliessen" }, [], "knopf"),
      ]),
    ])
  );
  const S = await selektorLaden(seite.dok);
  assert.ok(
    S.kaskadeBauen(seite.finden("div")).includes('[role="button"][aria-label="Menü öffnen"]'),
    "ausdrückliche Rolle gehört in den Anker"
  );
  assert.ok(
    S.kaskadeBauen(seite.finden("knopf")).includes('button[aria-label="Schliessen"]'),
    "sonst steht der Elementname für die stillschweigende Rolle"
  );
});

test("S19: der gemeldete Anker ist der, der wirklich getroffen hat", async () => {
  const seite = laden();
  const S = await selektorLaden(seite.dok);
  const ziel = seite.finden("knopf");
  const kaskade = S.kaskadeBauen(ziel);
  for (let i = 0; i < kaskade.length; i++) {
    const erg = S.kaskadeAufloesen(kaskade.slice(i), seite.dok);
    if (!erg.ok) continue;
    assert.equal(erg.anker, kaskade[i + erg.stelle], "Stelle und Anker müssen zusammenpassen");
    assert.equal(S.kaskadeAufloesen([erg.anker], seite.dok).el, erg.el,
      `der gemeldete Anker „${erg.anker}" muss für sich allein dasselbe Element finden`);
  }
});

test("S20: eine Kennung mit Zufallsanteil wird nicht verankert", async () => {
  const seite = seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k("div", { id: "ember1234", class: "hülle" }, [k("button", { id: "kaufen" }, "Kaufen", "gut")], "schlecht"),
      ]),
    ])
  );
  const S = await selektorLaden(seite.dok);
  const schlecht = S.kaskadeBauen(seite.finden("schlecht"));
  assert.ok(!schlecht.some((a) => a.includes("ember1234")), `gewürfelte Kennung im Anker: ${schlecht}`);
  assert.ok(S.kaskadeBauen(seite.finden("gut")).includes("#kaufen"), "eine gepflegte Kennung dagegen schon");
});

/* ================================================================== *
 * S21 bis S26 — Befund B6 vom 14.08.2026: der Einmalcode im Anker
 *
 * Gemessen wurde eine 2FA-Seite mit
 * `<span class="otp-anzeige">849271</span>` und
 * `<button class="kopieren" data-code="849271">Kopieren</button>`. Der Mensch
 * klickt beides an, und der gespeicherte Ablauf enthält danach
 * `selector_cascade: ["span.otp-anzeige","text=849271", …]` und
 * `["[data-code=\"849271\"]", …]`. Der Textanker kannte KEINERLEI
 * Geheimprüfung, und das Datenmerkmal liess reine Ziffernketten durch, weil
 * `klasseZufaellig` Ziffernabschnitte als Ordnungszahlen überspringt.
 * ================================================================== */

function zweiFaktorSeite() {
  return seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k("div", { class: "karte" }, [
          k("h2", {}, "Ihr Einmalcode"),
          k("span", { class: "otp-anzeige" }, "849271", "anzeige"),
          k("button", { class: "kopieren", "data-code": "849271" }, "Kopieren", "kopieren"),
          k("button", { class: "weiter" }, "Weiter", "weiter"),
        ]),
      ]),
    ])
  );
}

test("S21: der sichtbare Einmalcode wird kein Textanker", async () => {
  const seite = zweiFaktorSeite();
  const S = await selektorLaden(seite.dok);
  const kaskade = S.kaskadeBauen(seite.finden("anzeige"));

  assert.ok(kaskade.length >= 1, "ein Anker muss trotzdem entstehen");
  assert.ok(
    !kaskade.some((a) => a.includes("849271")),
    `der Einmalcode steht im Anker: ${JSON.stringify(kaskade)}`
  );
  /* Und die Klasse trägt den Schritt weiter — es geht nicht um weniger Anker,
     sondern um andere. */
  assert.ok(kaskade.includes("span.otp-anzeige"), JSON.stringify(kaskade));

  const erg = S.kaskadeAufloesen(kaskade, seite.dok);
  assert.equal(erg.ok, true, "der Schritt bleibt abspielbar");
  assert.equal(erg.el, seite.finden("anzeige"));
});

test("S22: derselbe Code in einem Datenmerkmal wird auch kein Anker", async () => {
  const seite = zweiFaktorSeite();
  const S = await selektorLaden(seite.dok);
  const kaskade = S.kaskadeBauen(seite.finden("kopieren"));

  assert.ok(
    !kaskade.some((a) => a.includes("849271")),
    `der Einmalcode steht im Anker: ${JSON.stringify(kaskade)}`
  );
  /* Gegenprobe im selben Prüfsatz: Der Text „Kopieren" ist harmlos und bleibt
     als Anker stehen. Eine Prüfung, die alles verwirft, misst nichts. */
  assert.ok(kaskade.includes("text=Kopieren"), JSON.stringify(kaskade));
  assert.equal(S.kaskadeAufloesen(kaskade, seite.dok).el, seite.finden("kopieren"));
});

test("S23: die Zufallserkennung und die Geheimprüfung sind zwei Fragen", async () => {
  const seite = zweiFaktorSeite();
  const S = await selektorLaden(seite.dok);

  /* Das war die Ursache: `klasseZufaellig` überspringt reine
     Ziffernabschnitte ausdrücklich als Ordnungszahlen, und genau deshalb
     hielt es „849271" für einen gepflegten Wert. Das ist für `col-md-6`
     richtig und bleibt so. */
  assert.equal(S.klasseZufaellig("849271").zufall, false,
    "die Zufallsfrage beantwortet sich weiterhin so, und das ist kein Fehler");
  /* Die zweite Frage ist die, die vorher niemand gestellt hat. */
  assert.equal(S.textOffen("849271"), false, "ein sechsstelliger Code gehört in keinen Anker");
  assert.equal(S.wertTaugt("849271"), false);

  /* Und was harmlos ist, bleibt es. */
  for (const gut of ["relist", "Erneut einstellen", "col-md-6", "btn-primary", "Seite 12"]) {
    assert.equal(S.textOffen(gut), true, `„${gut}" muss durchgehen`);
  }
});

test("S24: die Kartennummer erkennt die Prüfziffer, nicht die Länge", async () => {
  const seite = zweiFaktorSeite();
  const S = await selektorLaden(seite.dok);
  /* Luhn-gültig, also eine Kartennummer, auch mit Zwischenräumen. */
  assert.equal(S.textOffen("4111 1111 1111 1111"), false);
  assert.equal(S.textOffen("4111111111111111"), false);
});

test("S25: ohne die eine Quelle wird nicht geraten, sondern verweigert", async () => {
  /* Die Gegenprobe zu F4: Fehlt `geheim.js`, entscheidet `selektor.js` nicht
     selbst, sondern lässt keinen Text mit einer Ziffer mehr in einen Anker.
     Das kostet Anker. Anker kosten weniger als ein Code in `sa_workflows`. */
  const seite = zweiFaktorSeite();
  const S = await selektorLaden(seite.dok, { ohneGeheim: true });
  assert.equal(S.textOffen("849271"), false);
  const kaskade = S.kaskadeBauen(seite.finden("anzeige"));
  assert.ok(!kaskade.some((a) => a.includes("849271")), JSON.stringify(kaskade));
});

/* ================================================================== *
 * S26 bis S29 — Befund B7: die Kaskade prüft Identität, nicht Stellen
 *
 * Gemessen wurde `<input id="input-4f3a2b9c" name="artikelnummer"
 * class="css-9k2j1h">`. Kennung und Klasse fielen zu Recht als Zufall heraus,
 * `name` stand in keiner Kaskade, und gespeichert wurde
 * `["input:nth-of-type(1)", "/html[1]/…/input[1]"]`. Die Seite bekommt ein
 * Feld `titel` davor, `kaskadeAufloesen` antwortet `ok:true`, getroffen wird
 * `name=titel`, und die Artikelnummer landet im Titelfeld.
 * ================================================================== */

function formularseite(mitTitel = false) {
  const felder = [];
  if (mitTitel) felder.push(k("input", { name: "titel", class: "css-7h3k2p" }, [], "titel"));
  felder.push(
    k("input", { id: "input-4f3a2b9c", name: "artikelnummer", class: "css-9k2j1h" }, [], "artikelnr")
  );
  return seiteBauen(k("html", {}, [k("body", {}, [k("div", { class: "css-2b8f1a" }, felder)])]));
}

test("S26: der `name` eines Feldes steht in der Kaskade", async () => {
  const seite = formularseite();
  const S = await selektorLaden(seite.dok);
  const kaskade = S.kaskadeBauen(seite.finden("artikelnr"));

  assert.ok(
    kaskade.includes('input[name="artikelnummer"]') || kaskade.includes('[name="artikelnummer"]'),
    `der name gehört in die Kaskade, bekommen: ${JSON.stringify(kaskade)}`
  );
  /* Und zwar VOR den Ankern, die nur Stellen zählen. */
  const nameStelle = kaskade.findIndex((a) => a.includes('name="artikelnummer"'));
  const xpfadStelle = kaskade.findIndex((a) => a.startsWith("/"));
  assert.ok(nameStelle >= 0 && nameStelle < xpfadStelle, JSON.stringify(kaskade));
});

test("S27: ein Anker aus Elementname und Stelle allein entsteht nicht mehr", async () => {
  const seite = formularseite();
  const S = await selektorLaden(seite.dok);
  const kaskade = S.kaskadeBauen(seite.finden("artikelnr"));

  /* Der XPath darf es, er steht als letzter Ausweg ganz unten und die
     Identität hält ab F3 der Ausführer dagegen. Ein CSS-Anker darf es nicht,
     er stünde weit oben. */
  for (const anker of kaskade) {
    if (anker.startsWith("/") || anker.startsWith("text=")) continue;
    assert.ok(
      S.pfadTraegtMerkmal(anker),
      `„${anker}" nennt kein Merkmal, sondern nur eine Stelle: ${JSON.stringify(kaskade)}`
    );
  }
  assert.ok(!kaskade.includes("input:nth-of-type(1)"), JSON.stringify(kaskade));
});

test("S28: ein eingeschobenes Feld führt den Ablauf nicht ins falsche Feld", async () => {
  /* Der gemessene Fall, in voller Länge: aufgezeichnet auf der alten Seite,
     abgespielt auf der neuen. */
  const alt = formularseite();
  const S1 = await selektorLaden(alt.dok);
  const kaskade = S1.kaskadeBauen(alt.finden("artikelnr"));

  const neu = formularseite(true);
  const S2 = await selektorLaden(neu.dok);
  const erg = S2.kaskadeAufloesen(kaskade, neu.dok);

  assert.equal(erg.ok, true, `der Schritt muss weiter tragen: ${JSON.stringify(kaskade)}`);
  assert.equal(
    erg.el,
    neu.finden("artikelnr"),
    `getroffen wurde „${erg.el && erg.el.getAttribute("name")}" statt der Artikelnummer`
  );
  assert.notEqual(erg.el, neu.finden("titel"), "das Titelfeld ist das falsche Feld");
});

test("S29: bricht auch der `name`, wird nicht geraten, sondern gemeldet", async () => {
  /* Die Gegenprobe zu S28: Ein Anker, der nur noch die Stelle zählt, darf
     nicht als Erfolg durchgehen — deshalb steht der XPath ganz unten und
     deshalb verlangt F3 den Identitätsvergleich beim Ausführer. Hier wird
     gemessen, was diese Datei allein leisten kann: Ohne den `name` bleibt nur
     der XPath, und der meldet wenigstens, welcher Anker getragen hat. */
  const alt = formularseite();
  const S1 = await selektorLaden(alt.dok);
  const kaskade = S1.kaskadeBauen(alt.finden("artikelnr"));

  const neu = formularseite(true);
  neu.finden("artikelnr").removeAttribute("name");
  const S2 = await selektorLaden(neu.dok);
  const erg = S2.kaskadeAufloesen(kaskade, neu.dok);

  assert.equal(erg.ok, true, "der XPath trifft immer etwas, notfalls das Falsche");
  assert.ok(erg.anker.startsWith("/"), `getragen hat: ${erg.anker}`);
  assert.ok(
    erg.stelle === kaskade.length - 1,
    "und die Antwort sagt, dass der schwächste Anker getragen hat"
  );
});

/* ================================================================== *
 * S30 bis S34 — Abnahmefunde TEACH-2 und TEACH-5 vom 14.08.2026
 *
 * Zwei Befunde, eine Fehlerart: Die Wache prüft das GANZE, die Gefahr tritt
 * als TEIL auf.
 *
 *  - `pfadTraegtMerkmal` war zufrieden, sobald IRGENDWO im Pfad ein `#`, `.`
 *    oder `[` stand. Gemessen wurde
 *    `pfadTraegtMerkmal("form.maske > input:nth-of-type(2)") === true`: Das
 *    Merkmal sass auf dem Vorfahren, das Blatt zählte nur die Stelle.
 *  - `textHarmlos` mass die ganze Zeichenkette. „849271" war verboten,
 *    „Dein Code lautet 849271" erlaubt — und genau so steht ein Code auf
 *    einer Seite.
 * ================================================================== */

/* Die gemessene Maske: Felder ohne Kennung, ohne Namen, mit gewürfelten
   Klassen. Mit `mitZusatz` steht ein weiteres Feld davor, wie nach einem
   Umbau der fremden Seite. */
function maskeSeite(mitZusatz = false) {
  const felder = [];
  if (mitZusatz) {
    felder.push(k("div", { class: "feld" }, [k("input", { class: "css-4d5e6f" }, [], "zusatz")]));
  }
  felder.push(k("div", { class: "feld" }, [k("input", { class: "css-7h3k2p" }, [], "titel")]));
  felder.push(k("div", { class: "feld" }, [k("input", { class: "css-9k2j1h" }, [], "nummer")]));
  return seiteBauen(k("html", {}, [k("body", {}, [k("form", { class: "maske" }, felder)])]));
}

test("S30: ein Merkmal auf dem Vorfahren macht aus Stellenzählerei keinen Anker", async () => {
  const seite = maskeSeite();
  const S = await selektorLaden(seite.dok);

  /* Die beiden wörtlich gemessenen Pfade aus TEACH-5. */
  assert.equal(
    S.pfadTraegtMerkmal("form.maske > input:nth-of-type(2)"),
    false,
    "das Merkmal sitzt auf dem Vorfahren, das Blatt zählt nur die Stelle"
  );
  assert.equal(S.pfadTraegtMerkmal("div.feld:nth-of-type(2) > input"), false, "hier ist das Blatt nackt");
  assert.equal(S.pfadZaehltStellen("div.feld:nth-of-type(2) > input"), true);
  assert.equal(S.pfadTaugt("div.feld:nth-of-type(2) > input"), false);

  /* Gegenprobe: Am Blatt zählt das Merkmal, und ohne Stellenangabe trägt der
     Pfad. Es geht nicht um weniger Anker, sondern um andere. */
  assert.equal(S.pfadTraegtMerkmal("form.maske > input.nummer"), true);
  assert.equal(S.pfadZaehltStellen("form.maske > input.nummer"), false);
  assert.equal(S.pfadTaugt("form.maske > input.nummer"), true);
  assert.equal(S.pfadTaugt("#kasse > span.wert"), true);
  assert.equal(S.pfadTaugt('[data-testid="relist"]'), true);
});

test("S31: der zählende Pfad bricht laut, statt still auf das falsche Feld zu zeigen", async () => {
  /* Der gemessene Volldurchlauf aus TEACH-5, über den Produktivweg: erst
     aufnehmen, dann ein Feld einschieben, dann auflösen.
     Vor der Reparatur stand `div.feld:nth-of-type(2) > input` auf Platz 1 der
     Kaskade, traf nach dem Umbau GENAU EIN Element und meldete `ok:true` —
     nur eben das Titelfeld. Ab jetzt bleibt für ein Feld ohne jedes Merkmal
     der XPath ganz unten, und die Antwort sagt, dass der schwächste Anker
     getragen hat. Dort und nur dort hält ab F3 die Identitätswache des
     Ausführers dagegen. */
  const alt = maskeSeite();
  const S1 = await selektorLaden(alt.dok);
  const kaskade = S1.kaskadeBauen(alt.finden("nummer"));

  for (const anker of kaskade) {
    if (anker.startsWith("/")) continue;
    assert.equal(
      S1.pfadZaehltStellen(anker),
      false,
      `„${anker}" zählt nur die Stelle: ${JSON.stringify(kaskade)}`
    );
  }
  assert.ok(
    !kaskade.includes("div.feld:nth-of-type(2) > input"),
    `der gemessene Fehlanker steht wieder in der Kaskade: ${JSON.stringify(kaskade)}`
  );

  const neu = maskeSeite(true);
  const S2 = await selektorLaden(neu.dok);
  const erg = S2.kaskadeAufloesen(kaskade, neu.dok);
  assert.ok(erg.ok, "der XPath trifft immer etwas, notfalls das Falsche");
  assert.ok(
    erg.anker.startsWith("/"),
    `getragen hat „${erg.anker}", und das ist ein Anker oberhalb des XPfades`
  );
  assert.equal(erg.stelle, kaskade.length - 1, "die Antwort nennt den schwächsten Anker");
});

test("S32: ein Einmalcode MITTEN in einem Merkmalswert wird kein Anker", async () => {
  /* Befund TEACH-2 an der Stelle von B6: Die Reparatur mass die ganze Kette,
     also kam derselbe Code mit einem Wort davor wieder durch.
     `[data-testid="code-849271"]` stand danach als stärkster Anker im Ablauf. */
  const seite = seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k("div", { class: "karte" }, [
          k("button", { class: "kopieren", "data-testid": "code-849271" }, "Kopieren", "kopieren"),
        ]),
      ]),
    ])
  );
  const S = await selektorLaden(seite.dok);

  assert.equal(S.textOffen("code-849271"), false, "der Code steckt mitten im Wert");
  assert.equal(S.wertTaugt("code-849271"), false);
  assert.equal(S.textOffen("Dein Code lautet 849271"), false, "und mitten im Satz");
  assert.equal(S.textOffen("Ihre Kartennummer 4111111111111111"), false);
  assert.equal(S.textOffen("Karte 4111 1111 1111 1111"), false);
  assert.equal(S.textOffen("Schluessel a1b2c-3d4e5"), false);

  const kaskade = S.kaskadeBauen(seite.finden("kopieren"));
  assert.ok(
    !kaskade.some((a) => a.includes("849271")),
    `der Einmalcode steht im Anker: ${JSON.stringify(kaskade)}`
  );
  /* Gegenprobe: Der Text „Kopieren" trägt den Schritt weiter, und was eine
     Jahreszahl oder ein Preis ist, bleibt ebenfalls stehen. */
  assert.ok(kaskade.includes("text=Kopieren"), JSON.stringify(kaskade));
  for (const gut of ["Angebot vom 14.08.2026", "Preis 1299 Euro", "Seite 12", "iPhone13", "MP3-Player"]) {
    assert.equal(S.textOffen(gut), true, `„${gut}" muss durchgehen`);
  }
});

test("S33: derselbe Code im sichtbaren Text wird auch kein Textanker", async () => {
  const seite = seiteBauen(
    k("html", {}, [
      k("body", {}, [
        k("div", { class: "karte" }, [
          k("button", { class: "kopieren" }, "Code 849271 kopieren", "kopieren"),
          k("button", { class: "hilfe" }, "Hilfe", "hilfe"),
        ]),
      ]),
    ])
  );
  const S = await selektorLaden(seite.dok);
  const kaskade = S.kaskadeBauen(seite.finden("kopieren"));

  assert.ok(
    !kaskade.some((a) => a.includes("849271")),
    `der Einmalcode steht im Anker: ${JSON.stringify(kaskade)}`
  );
  assert.ok(kaskade.includes("button.kopieren"), `die Klasse trägt weiter: ${JSON.stringify(kaskade)}`);
  assert.equal(S.kaskadeAufloesen(kaskade, seite.dok).el, seite.finden("kopieren"));

  /* Gegenprobe im selben Prüfsatz: Der Nachbarknopf behält seinen Textanker. */
  assert.ok(S.kaskadeBauen(seite.finden("hilfe")).includes("text=Hilfe"));
});
