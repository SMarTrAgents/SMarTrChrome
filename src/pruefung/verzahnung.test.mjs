/*
 * Verzahnung — die Zusagen, die keinem einzelnen Gebiet gehören.
 *
 * Aufruf:  node --test src/pruefung/verzahnung.test.mjs
 *
 * Warum es diese Datei gibt: Am 11.08.2026 lagen achtzehn grüne Prüfsätze über
 * der Verdeckungswache, und der ausgelieferte Klickweg rief sie nirgends. Jedes
 * Gebiet war für sich gemessen, das Ganze war es nie. Acht Agenten haben
 * anschliessend gleichzeitig gebaut; diese Datei ist die Gegenprobe darauf.
 *
 * Der Unterschied zu den anderen Prüfdateien ist die Länge des Weges. Hier
 * läuft NICHT eine Funktion gegen eine Attrappe, sondern
 *
 *     Befehlsrahmen → net/ausfuehrer.js → net/seite.js → chrome.tabs
 *       → content/klickwache.js + content/selektor.js + content/overlay.js
 *       → zurück, mit Freigabefrage, Modus, Agentenmatrix und Protokollbuch
 *
 * am Stück. Die drei Inhaltsskripte sind die ECHTEN Dateien, geladen in einem
 * Sandkasten mit einer Nachbildung des Seitenbaums; die Nachricht zwischen
 * Ausführer und Seite geht durch denselben Nachrichtenhörer, den Chrome ruft.
 * Bricht irgendwo dazwischen eine Naht, wird hier etwas rot und nicht erst beim
 * Kunden.
 *
 * Was diese Datei NICHT ersetzt: den Handlauf am Gerät. Layout, geschlossene
 * Schattenbäume, fremde Rahmenseiten und der Bildschirmleser sind in einer
 * Nachbildung nicht messbar.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, BEVOR die Module geladen werden: dienste.js liest
   die Fassung beim Laden aus dem Manifest. */
let welt = attrappeSetzen();

const { MODUS_ABLAGE, KLICK_ABSAGEN } = await import("../net/befehle.js");
const { MATRIX_ABLAGE } = await import("../net/matrix.js");
const { BUCH_ABLAGE } = await import("../net/protokollbuch.js");
const { WERKSTATT_ABLAGE } = await import("../net/werkstatt.js");
const ausfuehrer = await import("../net/ausfuehrer.js");
const link = await import("../net/link.js");

/* Der Dienstarbeiter wird EINMAL geladen; sein Nachrichtenhörer wird dabei
   angemeldet. Gemessen wird der Hörer, den die Erweiterung wirklich anmeldet,
   nicht einer, den diese Datei nachbaut. */
await import("../background/worker.js");
const workerHoerer = welt.chrome.runtime.onMessage._zuhoerer[0];
assert.equal(typeof workerHoerer, "function", "Der Dienstarbeiter meldet einen Nachrichtenhörer an.");

const WACHE_QUELLE = await readFile(new URL("../content/klickwache.js", import.meta.url), "utf8");
const SELEKTOR_QUELLE = await readFile(new URL("../content/selektor.js", import.meta.url), "utf8");
const OVERLAY_QUELLE = await readFile(new URL("../content/overlay.js", import.meta.url), "utf8");

const HOST = "laden.example";
const ADRESSE = `https://${HOST}/warenkorb`;

const TAB = {
  id: 7,
  url: ADRESSE,
  title: "Warenkorb",
  active: true,
  status: "complete",
  windowId: 3,
};

const SITZUNG = {
  stufe: "write",
  modus: "tab",
  bereich: [HOST],
  schrittmodus: "auto",
  tabId: 7,
  endetUm: Date.now() + 600000,
};

/* ================================================================== *
 * Die Nachbildung des Seitenbaums
 *
 * Sie bildet nur nach, was die drei Inhaltsskripte wirklich anfassen. Zwei
 * Dinge sind dabei nicht verhandelbar, weil ohne sie die Verdeckungswache gar
 * nicht messbar wäre:
 *
 *   - Jeder Knoten hat SEIN eigenes Rechteck. Bei deckungsgleichen Rechtecken
 *     liegt jedes Element über jedem anderen, und „liegt mein Ziel frei" wäre
 *     immer nein.
 *   - `elementFromPoint` trifft eine echte Entscheidung: höheres z-index
 *     gewinnt, sonst der spätere Knoten. Genau diese Auskunft hat am
 *     11.08.2026 im echten Chrome den Überzug gemeldet, während geklickt wurde.
 * ================================================================== */

let knotenNr = 0;

/* Fünf Spalten, zwanzig Zeilen, Zellen, die sich nicht berühren. Wer verdecken
   will, sagt es ausdrücklich (`rect` und `z`). */
function platz(nr) {
  const zelle = nr % 100;
  return {
    left: 10 + (zelle % 5) * 130,
    top: 20 + Math.floor(zelle / 5) * 40,
    width: 120,
    height: 30,
  };
}

/**
 * Ein sehr kleiner Auswahl-Abgleich.
 *
 * Er kann `*`, Listen mit Komma, Marken, `#kennung`, `.klasse` und
 * `[merkmal]` / `[merkmal=wert]`. Mehr braucht keine der drei Dateien, und
 * mehr wäre eine zweite Auswahl-Maschine, die selbst niemand prüft.
 * Ein zusammengesetzter Pfad (`div > button`) trifft hier absichtlich NICHTS:
 * In der Kaskade steht er dann für einen Anker, der nach einem Umbau der
 * fremden Seite nicht mehr greift, und genau das ist der Alltag.
 */
function passt(el, auswahl) {
  const roh = String(auswahl || "").trim();
  if (!roh) return false;
  for (const teil of roh.split(",")) {
    const s = teil.trim();
    if (!s) continue;
    if (s === "*") return true;
    if (/[\s>+~]/.test(s)) continue;
    const stuecke = s.match(/^([a-zA-Z][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/);
    if (!stuecke) continue;
    if (stuecke[1] && el.tagName.toLowerCase() !== stuecke[1].toLowerCase()) continue;
    let alleTreffen = true;
    for (const m of (stuecke[2] || "").match(/[#.][\w-]+|\[[^\]]+\]/g) || []) {
      if (m[0] === "#") {
        if (el.id !== m.slice(1)) alleTreffen = false;
      } else if (m[0] === ".") {
        if (!String(el.className || "").split(/\s+/).includes(m.slice(1))) alleTreffen = false;
      } else {
        const inhalt = m.slice(1, -1);
        const gleich = inhalt.indexOf("=");
        if (gleich < 0) {
          if (el.getAttribute(inhalt) === null) alleTreffen = false;
        } else {
          const name = inhalt.slice(0, gleich).trim();
          const wert = inhalt.slice(gleich + 1).trim().replace(/^["']|["']$/g, "");
          if (el.getAttribute(name) !== wert) alleTreffen = false;
        }
      }
      if (!alleTreffen) break;
    }
    if (alleTreffen) return true;
  }
  return false;
}

function knoten(tag, {
  art = "element", // element | bereich | text
  attrs = {},
  text = "",
  rect = null,
  z = 0,
  klicktaub = false,
  versteckt = false,
  value = undefined,
  type = undefined,
  bearbeitbar = false,
  form = null,
} = {}) {
  const merkmale = { ...attrs };
  if (type !== undefined) merkmale.type = type;
  const flaeche = rect || platz(++knotenNr);
  const el = {
    nodeType: 1,
    __art: art,
    __z: z,
    __klicktaub: klicktaub,
    __versteckt: versteckt,
    __klicks: 0,
    __fokus: 0,
    __ereignisse: [],
    __wert: value,
    tagName: tag.toUpperCase(),
    id: merkmale.id || "",
    name: merkmale.name || "",
    className: merkmale.class || "",
    innerText: text,
    textContent: text,
    type,
    disabled: false,
    readOnly: false,
    required: false,
    checked: undefined,
    isConnected: true,
    isContentEditable: bearbeitbar,
    parentElement: null,
    parentNode: null,
    shadowRoot: null,
    childNodes: text ? [{ nodeType: 3, nodeValue: text }] : [],
    __form: form,
    /* Der Rekorder liest die Datenmerkmale ueber `el.attributes` (selektor.js,
       `datenMerkmale`). Ohne diese Liste haette ein `data-testid` in der
       Kaskade nie gestanden, und der staerkste Anker waere in dieser Pruefung
       gar nicht messbar gewesen. */
    get attributes() {
      return Object.entries(merkmale).map(([name, value]) => ({ name, value: String(value) }));
    },
    ownerDocument: null,
    getAttribute: (n) => (n in merkmale ? String(merkmale[n]) : null),
    setAttribute: (n, w) => {
      merkmale[n] = String(w);
      if (n === "id") el.id = String(w);
    },
    removeAttribute: (n) => {
      delete merkmale[n];
      if (n === "id") el.id = "";
    },
    hasAttribute: (n) => n in merkmale,
    getBoundingClientRect: () => ({
      ...flaeche,
      bottom: flaeche.top + flaeche.height,
      right: flaeche.left + flaeche.width,
    }),
    matches: (sel) => passt(el, sel),
    closest: (sel) => {
      if (sel === "form") return el.__form;
      if (sel === "label") return null;
      if (sel === "#smartrchrome-host") return null;
      return null;
    },
    scrollIntoView: () => {},
    focus: () => {
      el.__fokus += 1;
    },
    dispatchEvent: (e) => {
      el.__ereignisse.push({ typ: e.type, taste: e.key });
      return true;
    },
    click: () => {
      el.__klicks += 1;
    },
  };
  Object.defineProperty(el, "value", {
    get() {
      return this.__wert;
    },
    set(v) {
      this.__wert = v;
    },
    enumerable: true,
    configurable: true,
  });
  return el;
}

/** Ein Formular, das seine Felder kennt — die Bauform-Auskunft hängt daran. */
function formular(felder = []) {
  const f = {
    nodeType: 1,
    tagName: "FORM",
    __abgeschickt: 0,
    requestSubmit() {
      f.__abgeschickt += 1;
    },
    querySelectorAll: (sel) => felder.filter((e) => passt(e, sel)),
    getAttribute: () => null,
  };
  for (const feld of felder) feld.__form = f;
  return f;
}

/**
 * Der Sandkasten mit den DREI echten Inhaltsskripten.
 *
 * Die Reihenfolge ist die aus `net/seite.js` und sie ist verbindlich:
 * Wache, Selektor, Overlay. Wer sie hier umstellt, misst eine Erweiterung,
 * die es nicht gibt.
 */
function seiteLaden(elemente) {
  const zustand = { scrollY: 0, angehaengt: [], hoerer: [] };

  const document = {
    title: "Warenkorb",
    readyState: "complete",
    activeElement: null,
    body: { innerText: "" },
    documentElement: {
      appendChild(n) {
        zustand.angehaengt.push(n);
        if (n) {
          n.isConnected = true;
          n.parentNode = document.documentElement;
        }
        return n;
      },
      scrollHeight: 4000,
    },
    createElement: () => {
      const merkmale = {};
      const textKnoten = { textContent: "" };
      const el = {
        style: {
          _karte: new Map(),
          cssText: "",
          getPropertyValue(n) {
            return (this._karte.get(String(n).toLowerCase()) || { wert: "" }).wert;
          },
          getPropertyPriority(n) {
            return (this._karte.get(String(n).toLowerCase()) || { prio: "" }).prio;
          },
          setProperty(n, w, p) {
            this._karte.set(String(n).toLowerCase(), {
              wert: String(w),
              prio: p === "important" ? "important" : "",
            });
          },
          removeProperty(n) {
            this._karte.delete(String(n).toLowerCase());
          },
        },
        className: "",
        id: "",
        innerHTML: "",
        textContent: "",
        dataset: {},
        isConnected: false,
        parentNode: null,
        __eigen: true,
        __hoerer: [],
        __kinder: [],
        setAttribute(n, w) {
          merkmale[n] = String(w);
          if (n === "id") el.id = String(w);
        },
        removeAttribute(n) {
          delete merkmale[n];
        },
        getAttribute: (n) => (n in merkmale ? merkmale[n] : null),
        contains: (n) => !!(n && n.__eigen),
        querySelector: (sel) => (sel === ".text" ? textKnoten : { textContent: "" }),
        addEventListener(typ, hoerer, o) {
          el.__hoerer.push({ typ, hoerer, o });
        },
        removeEventListener() {},
        append(...kinder) {
          for (const k of kinder) if (k) el.__kinder.push(k);
        },
        appendChild(k) {
          if (k) el.__kinder.push(k);
          return k;
        },
        attachShadow: () => ({ adoptedStyleSheets: [], append() {} }),
      };
      return el;
    },
    querySelectorAll: (sel) =>
      String(sel).trim() === "*" ? elemente : elemente.filter((e) => passt(e, sel)),
    querySelector: (sel) => {
      const treffer = document.querySelectorAll(sel);
      return treffer.length ? treffer[0] : null;
    },
    getElementById: (id) => elemente.find((e) => e && e.id === id) || null,
    /* Die Entscheidung, die die Verdeckungswache befragt: Wer bekäme hier den
       Klick? Höheres z gewinnt, sonst der spätere Knoten — wie im Browser. */
    elementFromPoint: (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (x < 0 || y < 0 || x >= sandbox.innerWidth || y >= sandbox.innerHeight) return null;
      let treffer = null;
      let rang = -Infinity;
      elemente.forEach((el, i) => {
        if (el.__versteckt) return;
        const r = el.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
        const wert = (el.__z || 0) * 1e6 + i;
        if (wert >= rang) {
          rang = wert;
          treffer = el;
        }
      });
      return treffer;
    },
    addEventListener() {},
  };

  class Ereignis {
    constructor(typ, o = {}) {
      this.type = typ;
      Object.assign(this, o);
    }
  }
  const mitWertSetter = () => {
    const K = class {};
    Object.defineProperty(K.prototype, "value", {
      get() {
        return this.__wert;
      },
      set(v) {
        this.__wert = v;
      },
      configurable: true,
    });
    return K;
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document,
    innerHeight: 900,
    innerWidth: 1280,
    get scrollY() {
      return zustand.scrollY;
    },
    scrollX: 0,
    scrollTo: (o) => {
      zustand.scrollY = Math.max(0, Math.round((o && o.top) || 0));
    },
    scrollBy: (o) => {
      zustand.scrollY = Math.max(0, zustand.scrollY + Math.round((o && o.top) || 0));
    },
    getComputedStyle: (el) => ({
      ...(el && el.__versteckt
        ? { visibility: "hidden", display: "none", opacity: "0" }
        : { visibility: "visible", display: "block", opacity: "1" }),
      pointerEvents: el && el.__klicktaub ? "none" : "auto",
    }),
    CSSStyleSheet: class {
      replaceSync() {}
    },
    CSS: { escape: (s) => s },
    performance: { now: () => Date.now() },
    location: { href: ADRESSE },
    Event: Ereignis,
    InputEvent: Ereignis,
    KeyboardEvent: Ereignis,
    MouseEvent: Ereignis,
    PointerEvent: Ereignis,
    HTMLInputElement: mitWertSetter(),
    HTMLTextAreaElement: mitWertSetter(),
    MutationObserver: class {
      constructor(ruf) {
        this.__ruf = ruf;
      }
      observe() {}
      disconnect() {}
    },
    chrome: {
      runtime: {
        id: "smartrchrome-attrappe",
        __hoerer: null,
        __gesendet: [],
        onMessage: {
          addListener(f) {
            sandbox.chrome.runtime.__hoerer = f;
          },
        },
        sendMessage(n) {
          sandbox.chrome.runtime.__gesendet.push(n);
          return undefined;
        },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = (typ, hoerer, o) => {
    zustand.hoerer.push({ typ, hoerer, o });
  };

  /* Jeder Knoten kennt sein Dokument. `kaskadeBauen` sucht darueber die Wurzel,
     gegen die es die Eindeutigkeit eines Ankers misst. */
  for (const el of elemente) el.ownerDocument = document;

  vm.createContext(sandbox);
  vm.runInContext(WACHE_QUELLE, sandbox, { filename: "klickwache.js" });
  assert.ok(sandbox.SMARTR_KLICKWACHE, "klickwache.js muss sich an globalThis hängen");
  vm.runInContext(SELEKTOR_QUELLE, sandbox, { filename: "selektor.js" });
  assert.ok(sandbox.SMARTR_SELEKTOR, "selektor.js muss sich an globalThis hängen");
  vm.runInContext(OVERLAY_QUELLE, sandbox, { filename: "overlay.js" });
  const hoerer = sandbox.chrome.runtime.__hoerer;
  assert.ok(hoerer, "overlay.js muss einen Nachrichtenhörer anmelden");

  /* Genau der Weg, den `net/seite.js` nimmt: eine Nachricht hinein, eine
     Antwort heraus, über Chrome kopiert. Der Umweg über JSON bildet den
     structured clone nach und stellt nebenbei sicher, dass in der Antwort
     nichts steht, was die Leitung gar nicht überstünde. */
  const fragen = (nachricht) =>
    new Promise((fertig) => {
      let kam = false;
      const weiter = hoerer(nachricht, null, (a) => {
        kam = true;
        fertig(a === undefined ? undefined : JSON.parse(JSON.stringify(a)));
      });
      if (weiter !== true && !kam) fertig(undefined);
    });

  return { fragen, sandbox, zustand, elemente };
}

/* ================================================================== *
 * Der Prüfstand: Ausführer gegen die echte Seite
 * ================================================================== */

/**
 * Eine Welt aufsetzen, in der der Ausführer mit der ECHTEN Seite spricht.
 *
 * Alles, was der Ausführer an `chrome.tabs.sendMessage` gibt, landet im
 * Nachrichtenhörer von `overlay.js`. Es gibt in dieser Prüfung keinen zweiten
 * Weg in die Seite und keine erfundene Antwort.
 */
function weltMitSeite(elemente, {
  sitzung = SITZUNG,
  panel = (n) => (n.typ === "link:schritt-freigabe" ? { ja: true } : { ok: true }),
  ablageLocal = null,
  ablageSession = null,
  tab = TAB,
} = {}) {
  const seite = seiteLaden(elemente);
  const gefragt = [];
  welt = attrappeSetzen({
    tab: { ...tab },
    seiteAntwortet: (n) => {
      gefragt.push(n);
      return seite.fragen(n);
    },
    panelAntwortet: panel,
    ablageLocal: ablageLocal || {},
    ablageSession: ablageSession || {},
  });
  ausfuehrer.zaehlerNeu();
  return { seite, gefragt, sitzung, spur: welt.spur };
}

/** Die Freigabefragen, die dem Menschen gestellt wurden. */
function freigabefragen(spur) {
  return spur
    .filter((e) => e.wohin === "panel" && e.nachricht && e.nachricht.typ === "link:schritt-freigabe")
    .map((e) => e.nachricht);
}

/** Die letzte Nachricht dieser Art an die Seite. */
function anDieSeite(spur, typ) {
  return [...spur].reverse().find((e) => e.wohin === "seite" && e.nachricht.typ === typ)?.nachricht;
}

/** Das Protokollbuch, so wie es wirklich in der Ablage steht. */
async function buchLesen() {
  const daten = await welt.chrome.storage.local.get(BUCH_ABLAGE);
  const roh = daten && daten[BUCH_ABLAGE];
  return Array.isArray(roh) ? roh : [];
}

/** Ein paar Runden der Ereignisschleife, ohne echte Zeit verstreichen zu lassen. */
async function runden(anzahl = 4) {
  for (let i = 0; i < anzahl; i += 1) await new Promise((f) => setImmediate(f));
}

/**
 * Eine Wahrnehmung erheben und die Referenz eines Elements holen.
 *
 * Über den echten Befehl `readPage`, nicht über einen Seitenblick: Die
 * Referenzen, mit denen danach geklickt wird, müssen aus derselben Epoche
 * stammen, die der Agent zu sehen bekommt.
 */
async function wahrnehmen(stand, name, sitzung = null) {
  const ergebnis = await ausfuehrer.befehlAusfuehren(
    { id: `w-${name}-${Date.now()}`, cmd: "readPage", reason: "Ich sehe mir die Seite an." },
    sitzung || stand.sitzung
  );
  assert.equal(ergebnis.success, true, "die Wahrnehmung selbst muss gelingen");
  const baum = ergebnis.data.snapshot;
  const zeile = baum.text.split("\n").find((z) => z.includes(`"${name}"`));
  assert.ok(zeile, `„${name}" steht nicht im Textbaum:\n${baum.text}`);
  return { ref: zeile.trim().split(/\s+/)[0], epoche: baum.epoch };
}

/*
 * Nach jedem Satz aufräumen.
 *
 * Ohne diese Zeile hielte ein laufender Herzschlag (`setInterval` aus
 * `link.verbinden`) den Prüflauf offen, und ein Lauf, der hängt, sagt
 * niemandem, was kaputt ist.
 */
test.afterEach(async () => {
  ausfuehrer.laufAbbrechen();
  await link.trennen("nutzer").catch(() => {});
});

/* ================================================================== *
 * a) Ein Klick auf ein verdecktes Ziel wird abgelehnt — am AUSFÜHRER
 * ================================================================== */

test("V-a: Über dem freigegebenen Knopf liegt ein Überzug, der Ausführer sagt element_covered", async () => {
  /*
   * Der Befund vom 11.08.2026, in voller Länge nachgestellt: Der Mensch gibt
   * „Zur Kasse" frei, über dem Knopf liegt ein ganzseitiger Überzug, und
   * `document.elementFromPoint` meldet eindeutig den Überzug.
   *
   * Gemessen wird am ENDE der Kette, im Ergebnisrahmen des Ausführers. Dass
   * die Wache selbst richtig entscheidet, steht in klickwache.test.mjs; hier
   * geht es um die Frage, die 0.5.3 zum Blocker gemacht hat: Kommt ihre
   * Entscheidung überhaupt bis zum Agenten durch?
   */
  const kasse = knoten("button", {
    text: "Zur Kasse",
    rect: { left: 100, top: 200, width: 200, height: 50 },
  });
  const ueberzug = knoten("div", {
    art: "bereich",
    attrs: { role: "dialog", "aria-label": "Cookie-Hinweis" },
    rect: { left: 0, top: 0, width: 1280, height: 900 },
    z: 9999,
  });
  const stand = weltMitSeite([kasse, ueberzug]);

  const ziel = await wahrnehmen(stand, "Zur Kasse");
  const ergebnis = await ausfuehrer.befehlAusfuehren(
    {
      id: "va-1",
      cmd: "click",
      reason: "Ich gehe für dich zur Kasse.",
      ref: ziel.ref,
      snapshotEpoch: ziel.epoche,
    },
    stand.sitzung
  );

  assert.equal(ergebnis.type, "result");
  assert.equal(ergebnis.success, false, "ein verdecktes Ziel wird nicht geklickt");
  assert.equal(ergebnis.error.code, "element_covered", "und zwar mit genau dieser Kennung");
  assert.equal(
    ergebnis.error.message,
    KLICK_ABSAGEN.verdeckt.satz,
    "der Satz stammt aus KLICK_ABSAGEN.verdeckt und wird nicht neu erfunden"
  );
  assert.ok(ergebnis.error.hint, "und er nennt dem Agenten den nächsten Schritt");
  assert.equal(ergebnis.error.retryable, true, "ein Überzug kann weggehen, also darf er es erneut versuchen");

  /* Die Gegenprobe, ohne die der Prüfsatz nichts wert wäre: Der Klick hat
     wirklich NICHT stattgefunden. Eine Absage, nach der die Wirkung trotzdem
     eintritt, ist die schlimmste Sorte grüner Prüfsatz. */
  await runden();
  assert.equal(kasse.__klicks, 0, "geklickt wurde nichts");
  assert.equal(ueberzug.__klicks, 0, "und auf dem Überzug erst recht nicht");
});

test("V-a2: Ohne Überzug geht derselbe Klick durch, dieselbe Kette", async () => {
  /* Die Gegenprobe zur Gegenprobe: Eine Wache, die alles ablehnt, wäre in
     V-a ebenfalls grün. */
  const kasse = knoten("button", {
    text: "Zur Kasse",
    rect: { left: 100, top: 200, width: 200, height: 50 },
  });
  const stand = weltMitSeite([kasse]);

  const ziel = await wahrnehmen(stand, "Zur Kasse");
  const ergebnis = await ausfuehrer.befehlAusfuehren(
    { id: "va-2", cmd: "click", reason: "Ich gehe für dich zur Kasse.", ref: ziel.ref, snapshotEpoch: ziel.epoche },
    stand.sitzung
  );

  assert.equal(ergebnis.success, true, "ein freies Ziel wird geklickt");
  await runden();
  assert.equal(kasse.__klicks, 1, "und der Klick erreicht wirklich das Element");
});

/* ================================================================== *
 * b) Automatik: die Folge läuft durch, „Jetzt kaufen" fragt trotzdem
 * ================================================================== */

test(`V-b: Im Modus auto laufen readPage, scroll und click ohne Rückfrage, „Jetzt kaufen" fragt trotzdem`, async () => {
  /*
   * Der Unterschied zwischen `assist` und `auto` ist genau einer (§3.2), und
   * der Riegel aus §3 gilt daneben in JEDEM Modus. Beides in einem Durchlauf:
   * dieselbe Sitzung, derselbe Tab, derselbe Modus, zwei Knöpfe.
   *
   * Der Modus kommt dabei nicht als Angabe im Rahmen, sondern aus der Ablage
   * `sa_modus` — geschrieben über `ausfuehrer.modusSetzen`, also über den Weg,
   * den auch die Seitenleiste nimmt.
   */
  const weiter = knoten("button", { text: "Weiter", rect: { left: 100, top: 200, width: 150, height: 40 } });
  const kaufen = knoten("button", { text: "Jetzt kaufen", rect: { left: 400, top: 200, width: 200, height: 40 } });
  const stand = weltMitSeite([weiter, kaufen]);

  const gesetzt = await ausfuehrer.modusSetzen(7, "auto");
  assert.equal(gesetzt.ok, true, "der Modus muss sich setzen lassen");
  /* Gemessen an der ECHTEN Ablage, nicht am Rückgabewert: Bis zum 14.08.2026
     lasen der Dienstarbeiter und der Ausführer denselben Satz verschieden. */
  const abgelegt = await welt.chrome.storage.session.get(MODUS_ABLAGE);
  assert.equal(abgelegt[MODUS_ABLAGE].tabs["7"], "auto");

  const ablehnend = {
    ...stand.sitzung,
    /* Der Server erlaubt die Automatik; sonst schränkt er sie ein, und dann
       misst dieser Prüfsatz die Einschränkung statt der Automatik. */
    schrittmodus: "auto",
  };

  const ab = welt.spur.length;
  const lesen = await ausfuehrer.befehlAusfuehren(
    { id: "vb-1", cmd: "readPage", reason: "Ich sehe mir die Seite an." }, ablehnend
  );
  assert.equal(lesen.success, true);
  const rollen = await ausfuehrer.befehlAusfuehren(
    { id: "vb-2", cmd: "scroll", reason: "Ich rolle weiter.", direction: "down", amount: "page" }, ablehnend
  );
  assert.equal(rollen.success, true);

  /* Jede Referenz wird frisch geholt. Das ist keine Bequemlichkeit des
     Prüfsatzes, sondern das Verhalten des Bestandes: `overlay.js` hält genau
     die zwei jüngsten Wahrnehmungen vor, und jeder ausgeführte Befehl bringt
     eine neue mit. Eine Referenz aus der ersten Runde wäre nach dem dritten
     Befehl `stale_ref` — fail-closed, wie es sein soll. */
  const zielWeiter = await wahrnehmen(stand, "Weiter", ablehnend);
  const harmlos = await ausfuehrer.befehlAusfuehren(
    {
      id: "vb-3", cmd: "click", reason: "Ich gehe einen Schritt weiter.",
      ref: zielWeiter.ref, snapshotEpoch: zielWeiter.epoche,
    },
    ablehnend
  );
  assert.equal(harmlos.success, true, "ein gewöhnlicher Klick läuft in der Automatik durch");
  assert.deepEqual(
    freigabefragen(welt.spur.slice(ab)),
    [],
    "und bis hierher wurde der Mensch kein einziges Mal gefragt"
  );

  const zielKaufen = await wahrnehmen(stand, "Jetzt kaufen", ablehnend);
  const vorKauf = welt.spur.length;
  const kauf = await ausfuehrer.befehlAusfuehren(
    {
      id: "vb-4", cmd: "click", reason: "Ich schliesse den Kauf ab.",
      ref: zielKaufen.ref, snapshotEpoch: zielKaufen.epoche,
    },
    ablehnend
  );

  const fragen = freigabefragen(welt.spur.slice(vorKauf));
  assert.equal(fragen.length, 1, `„Jetzt kaufen" wird auch in der Automatik vorgelegt`);
  assert.equal(kauf.success, true, "und nach dem Ja läuft er durch");
  await runden();
  assert.equal(kaufen.__klicks, 1);

  /* Und der Grund steht in der Frage, in UNSEREN Worten, nicht als Zitat der
     fremden Seite. */
  const text = JSON.stringify(fragen[0]);
  assert.ok(/[Zz]ahlung/.test(text), `die Frage nennt die erkannte Klasse: ${text}`);
});

/* ================================================================== *
 * c) laufAbbrechen kappt, ohne auf eine Netzantwort zu warten
 * ================================================================== */

test("V-c: laufAbbrechen beendet lokale und Cloud-Aktionen, ohne auf eine Antwort zu warten", async () => {
  /*
   * Die Zusage aus §5: Zwischen dem Ereignis und dem Zustand „nichts läuft
   * mehr" liegt keine Netzrunde. Gemessen wird sie an einem Befehl, der in
   * einer HÄNGENDEN Seite steckt — dem Fall, für den es die Notbremse gibt.
   *
   * `laufBeenden` (der Bestand) hätte diesen Befehl bis zu seiner Frist
   * weiterlaufen lassen. Deshalb misst dieser Satz nicht, DASS abgebrochen
   * wird, sondern WANN.
   */
  const knopf = knoten("button", { text: "Weiter" });
  const stand = weltMitSeite([knopf]);

  /* Eine Seite, die genau bei der ARBEIT hängenbleibt.
     Der Rahmen steht, das Zeichen steht, der Zeiger steht — und dann kommt
     nichts mehr. Das ist die Lage, für die es die Notbremse gibt: nicht ein
     toter Tab (den erkennt `wacheStellen`), sondern ein Skript der fremden
     Seite, das die Antwort verschluckt. */
  welt = attrappeSetzen({
    tab: { ...TAB },
    seiteAntwortet: (n) => (n.typ === "overlay:baum" ? new Promise(() => {}) : stand.seite.fragen(n)),
    panelAntwortet: () => ({ ja: true }),
  });
  ausfuehrer.zaehlerNeu();

  const laufend = ausfuehrer.befehlAusfuehren(
    { id: "vc-1", cmd: "readPage", reason: "Ich lese die Seite." },
    stand.sitzung
  );
  await runden(2);

  const vorher = Date.now();
  ausfuehrer.laufAbbrechen();
  const nachher = Date.now();

  /* 1. Das Kappen selbst ist synchron. Es gibt hier nichts abzuwarten, also
        wird auch auf nichts gewartet. */
  assert.ok(nachher - vorher < 50, `laufAbbrechen brauchte ${nachher - vorher} ms`);

  /* 2. Der wartende Befehl bekommt eine Antwort, und zwar sofort — obwohl die
        Seite weiterhin schweigt und seine eigene Frist noch lange läuft. */
  const ergebnis = await Promise.race([
    laufend,
    new Promise((f) => setTimeout(() => f({ zuSpaet: true }), 1500)),
  ]);
  assert.ok(!ergebnis.zuSpaet, "der wartende Befehl hängt weiter, statt beantwortet zu werden");
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "session_beendet");

  /* 3. Die Warteschlange ist leer: Was danach kommt, wird gar nicht erst
        ausgeführt, sondern beantwortet. */
  const danach = await ausfuehrer.befehlAusfuehren(
    { id: "vc-2", cmd: "readPage", reason: "Ich lese noch einmal." },
    stand.sitzung
  );
  assert.equal(danach.error.code, "session_beendet");
});

test("V-c2: Der Not-Aus der Brücke kappt VOR dem Widerruf beim Relay", async () => {
  /*
   * Dieselbe Zusage, eine Ebene höher: `link.trennen()` ruft `laufKappen()`
   * als erste Zeile, vor jedem `await`. Gemessen wird die Reihenfolge, und
   * zwar ohne den Relay überhaupt antworten zu lassen — wenn die Wirkung der
   * Notbremse von der Gegenstelle abhinge, wäre sie keine.
   */
  const knopf = knoten("button", { text: "Weiter" });
  const stand = weltMitSeite([knopf]);
  welt = attrappeSetzen({
    tab: { ...TAB },
    seiteAntwortet: (n) => (n.typ === "overlay:baum" ? new Promise(() => {}) : stand.seite.fragen(n)),
    panelAntwortet: () => ({ ja: true }),
  });
  ausfuehrer.zaehlerNeu();

  /* Der Widerruf beim Relay wird angenommen und NIE beantwortet. */
  let widerrufe = 0;
  const alterFetch = globalThis.fetch;
  globalThis.fetch = () => {
    widerrufe += 1;
    return new Promise(() => {});
  };

  try {
    const laufend = ausfuehrer.befehlAusfuehren(
      { id: "vc2-1", cmd: "readPage", reason: "Ich lese die Seite." },
      stand.sitzung
    );
    await runden(2);

    /* Absichtlich OHNE await: Gemessen wird, was schon gilt, während `trennen`
       noch unterwegs ist. */
    const trennt = link.trennen("notbremse");

    const ergebnis = await Promise.race([
      laufend,
      new Promise((f) => setTimeout(() => f({ zuSpaet: true }), 1500)),
    ]);
    assert.ok(!ergebnis.zuSpaet, "der Befehl läuft weiter, obwohl die Notbremse gezogen ist");
    assert.equal(ergebnis.error.code, "session_beendet", "gekappt wird vor dem Melden");

    await Promise.race([trennt, new Promise((f) => setTimeout(f, 200))]);
    assert.ok(widerrufe <= 1, "der Widerruf wird höchstens einmal versucht");
  } finally {
    globalThis.fetch = alterFetch;
  }
});

/* ================================================================== *
 * d) Ein aufgezeichneter Ablauf überlebt eine Seitenänderung
 * ================================================================== */

test("V-d: Anker 1 bricht nach dem Umbau der Seite, Anker 2 trägt, der Platzhalter steht drin", async () => {
  /*
   * Der Alltagsfall des Teach-Modus: Ein Ablauf wurde vor Wochen aufgezeichnet,
   * seither hat die fremde Seite ein neues Frontend bekommen, und das
   * `data-testid` von damals gibt es nicht mehr. Genau dafür gibt es die
   * Kaskade (§7.1) und die Selbstheilung (§7.4).
   *
   * Gemessen wird über die volle Kette: `run_workflow` → werkstatt →
   * platzhalterFuellen → Freigabe → `overlay:kaskade` → selektor.js → Klick.
   * Die Kaskade selbst stammt aus dem ECHTEN `kaskadeBauen`, also von der
   * Seite, die der Rekorder gesehen hätte.
   */
  const feld = knoten("input", {
    attrs: { id: "artikelnr", "aria-label": "Artikelnummer" },
    type: "text",
    value: "",
    rect: { left: 100, top: 100, width: 200, height: 30 },
  });
  const kasse = knoten("button", {
    attrs: { "data-testid": "kasse" },
    text: "Zur Kasse",
    rect: { left: 100, top: 200, width: 200, height: 50 },
  });
  const stand = weltMitSeite([feld, kasse], {
    ablageLocal: {
      [WERKSTATT_ABLAGE]: [],
    },
  });

  /* So hätte der Rekorder die Anker gebaut: mit der echten Datei, an dem
     Element, das damals dastand. */
  const kaskadeDamals = stand.seite.sandbox.SMARTR_SELEKTOR.kaskadeBauen(kasse);
  assert.ok(kaskadeDamals.length >= 2, `zu wenige Anker: ${JSON.stringify(kaskadeDamals)}`);
  assert.equal(kaskadeDamals[0], '[data-testid="kasse"]', "der stärkste Anker steht vorn");
  const textAnker = kaskadeDamals.find((a) => a.startsWith("text="));
  assert.ok(textAnker, `ohne Textanker gibt es nichts zu heilen: ${JSON.stringify(kaskadeDamals)}`);

  const ablauf = {
    id: "wf_kasse",
    name: "Kasse: Artikel eintragen",
    version: 1,
    params: ["artikelnummer"],
    steps: [
      {
        type: "input",
        selector_cascade: ["#artikelnr"],
        value: "{{artikelnummer}}",
        beschreibung: "die Artikelnummer eintippen",
      },
      {
        type: "click",
        /* Genau zwei Anker, wie der Rekorder sie geliefert hat. */
        selector_cascade: [kaskadeDamals[0], textAnker],
        beschreibung: "den Knopf „Zur Kasse\" drücken",
      },
    ],
  };
  await welt.chrome.storage.local.set({ [WERKSTATT_ABLAGE]: [ablauf] });

  /* Der Umbau der fremden Seite: Das Merkmal von damals ist weg, die
     Beschriftung steht noch. */
  kasse.removeAttribute("data-testid");
  assert.equal(kasse.getAttribute("data-testid"), null);

  const ergebnis = await ausfuehrer.befehlAusfuehren(
    {
      id: "vd-1",
      cmd: "run_workflow",
      reason: "Ich spiele den Ablauf ab.",
      workflowId: "wf_kasse",
      params: { artikelnummer: "A-4711" },
    },
    stand.sitzung
  );

  assert.equal(ergebnis.success, true, `der Ablauf muss durchlaufen: ${JSON.stringify(ergebnis.error || {})}`);

  /* Der Platzhalter ist wirklich ersetzt worden, und zwar auf dem Weg in die
     Seite — nicht erst in der Anzeige. */
  const getippt = anDieSeite(welt.spur, "overlay:tippen");
  assert.ok(getippt, "es wurde getippt");
  assert.equal(getippt.text, "A-4711", "der Platzhalter steht gefüllt in der Nachricht an die Seite");
  assert.equal(feld.__wert, "A-4711", "und wirklich im Feld");

  /* Und der zweite Anker hat getragen: Der Klick ist beim Knopf angekommen,
     obwohl sein `data-testid` weg ist. */
  await runden();
  assert.equal(kasse.__klicks, 1, "Anker 2 hat den Schritt getragen");

  const aufgeloest = anDieSeite(welt.spur, "overlay:kaskade");
  assert.ok(aufgeloest, "der Weg overlay:kaskade wurde wirklich gegangen");
});

test("V-d2: Bricht die GANZE Kaskade, meldet der Ausführer workflow_step_failed mit Beschreibung", async () => {
  /* Die Gegenprobe: Ohne sie wäre V-d auch mit einer Kaskade grün, die alles
     findet, was irgendwie aussieht wie ein Knopf. */
  const kasse = knoten("button", { text: "Zur Kasse" });
  const stand = weltMitSeite([kasse], { ablageLocal: { [WERKSTATT_ABLAGE]: [] } });

  const ablauf = {
    id: "wf_weg",
    name: "Ablauf ins Leere",
    version: 1,
    params: [],
    steps: [
      {
        type: "click",
        selector_cascade: ['[data-testid="gibtesnicht"]', "text=Gibt es nicht"],
        beschreibung: "einen Knopf drücken, den es nicht mehr gibt",
      },
    ],
  };
  await welt.chrome.storage.local.set({ [WERKSTATT_ABLAGE]: [ablauf] });

  const ergebnis = await ausfuehrer.befehlAusfuehren(
    { id: "vd2-1", cmd: "run_workflow", reason: "Ich spiele den Ablauf ab.", workflowId: "wf_weg" },
    stand.sitzung
  );

  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "workflow_step_failed");
  assert.equal(
    ergebnis.data.description,
    "einen Knopf drücken, den es nicht mehr gibt",
    "§7.4: die Beschreibung des gesuchten Elements reist mit"
  );
  assert.deepEqual(
    ergebnis.data.anchors,
    ['[data-testid="gibtesnicht"]', "text=Gibt es nicht"],
    "und die Anker, an denen es gescheitert ist"
  );
  assert.ok(ergebnis.data.snapshot, "und der Textbaum, damit der Agent ein Ziel benennen kann");
  assert.equal(kasse.__klicks, 0, "und geklickt wurde ausdrücklich nichts anderes");
});

/* ================================================================== *
 * e) Ein Cloud-Agent spielt einen Ablauf ab
 * ================================================================== */

test("V-e: Cloud-Sitzung sichtbar, Ablauf durch dieselbe Schleife, harte Klasse fragt, Buch vollständig", async () => {
  /*
   * Der ganze Weg von aussen: Handschlag mit dem Relay, drei Zeichen nach
   * §8.4, ein `run_workflow` als Agentenbefehl, eine harte Klasse mitten im
   * Ablauf, und am Ende ein Buch, in dem jede Fernaktion steht — mit Ort statt
   * Inhalt.
   */
  const kaufen = knoten("button", { text: "Jetzt kaufen", rect: { left: 100, top: 200, width: 200, height: 50 } });
  const stand = weltMitSeite([kaufen], {
    sitzung: { ...SITZUNG, schrittmodus: "auto" },
  });

  /* Die Matrix schaltet diesen Agenten für diesen Wirt frei. Voreinstellung
     ist alles aus (§4); ohne diesen Satz misst der Prüfsatz nur die Sperre. */
  await welt.chrome.storage.local.set({
    [MATRIX_ABLAGE]: {
      version: 1,
      domains: {},
      gesperrt: [],
      agenten: {
        SMarTrCEO: { [HOST]: ["lesen", "bedienen", "navigieren", "workflow", "zahlung"] },
      },
    },
  });
  await welt.chrome.storage.local.set({
    [WERKSTATT_ABLAGE]: [
      {
        id: "wf_kauf",
        name: "Kasse: Kauf abschliessen",
        version: 1,
        params: [],
        steps: [
          {
            type: "click",
            selector_cascade: ["text=Jetzt kaufen"],
            beschreibung: "den Kauf abschliessen",
          },
        ],
      },
    ],
  });

  const ab = welt.spur.length;
  const ergebnis = await ausfuehrer.befehlAusfuehren(
    {
      id: "ve-1",
      cmd: "run_workflow",
      reason: "Ich schliesse den Kauf für dich ab.",
      workflowId: "wf_kauf",
      agent: "SMarTrCEO",
    },
    { ...stand.sitzung, schrittmodus: "auto", agent: "SMarTrCEO" }
  );

  assert.equal(ergebnis.success, true, `der Ablauf muss laufen: ${JSON.stringify(ergebnis.error || {})}`);

  /* 1. Die harte Klasse hat gefragt — trotz Automatik, trotz freigeschalteter
        Matrix. `zahlung` steht in HART, und HART ist nicht abschaltbar. */
  const fragen = freigabefragen(welt.spur.slice(ab));
  assert.ok(fragen.length >= 1, "die harte Klasse erzeugt eine Freigabeanfrage");

  /* 2. Der Ablauf ist wirklich durch DIESELBE Schleife gegangen: Es gibt keine
        zweite Tür, auf der geklickt werden könnte. */
  await runden();
  assert.equal(kaufen.__klicks, 1);

  /* 3. Das Buch: eine Zeile je Fernaktion, mit Agent, Kommando und Ort — und
        ohne einen Krümel Seiteninhalt (§8.3). */
  const buch = await buchLesen();
  assert.ok(buch.length >= 1, "jede Fernaktion bekommt ihre Zeile");
  const meins = buch.filter((e) => e.agent === "SMarTrCEO");
  assert.ok(meins.length >= 1, `im Buch steht kein Eintrag dieses Agenten: ${JSON.stringify(buch)}`);
  for (const eintrag of meins) {
    assert.ok(eintrag.zeit > 0, "mit Zeitstempel");
    assert.ok(eintrag.cmd, "mit Kommando");
    assert.equal(eintrag.url, `https://${HOST}/warenkorb`, "mit der Adresse, ohne Abfrage und Marke");
    assert.ok(typeof eintrag.ergebnis === "string" && eintrag.ergebnis, "mit Ergebnis");
    const alsText = JSON.stringify(eintrag);
    assert.ok(!alsText.includes("Jetzt kaufen"), `Seiteninhalt im Buch: ${alsText}`);
  }
});

test("V-e3: Der Knopf „Abspielen\" der Seitenleiste läuft über den Worker durch dieselbe Schleife", async () => {
  /*
   * Der Weg des MENSCHEN, ganz: Seitenleiste → `werkbank:spielen` → der echte
   * Nachrichtenhörer des Dienstarbeiters → `run_workflow` im Ausführer → die
   * echte Seite. Nicht `befehlAusfuehren` von Hand, sondern die Nachricht, die
   * der Knopf wirklich sendet.
   *
   * Damit ist die Naht gemessen, die am 11.08.2026 gefehlt hat: ein fertiger
   * Weg auf der einen Seite, ein fertiger Knopf auf der anderen und niemand
   * dazwischen.
   */
  const kaufen = knoten("button", {
    text: "Jetzt kaufen",
    rect: { left: 100, top: 200, width: 200, height: 50 },
  });
  const seite = seiteLaden([kaufen]);

  const draehte = [];
  /* `WebSocket.OPEN` muss hier stehen: `link.zustand()` misst daran, ob die
     Leitung wirklich offen ist, und nur eine offene Sitzung reicht der Worker
     an den Ausführer weiter. Ohne die Konstante liefe der Prüfsatz gegen eine
     Sitzung ohne Stufe und meldete `stufe_zu_niedrig` — richtig, aber am Thema
     vorbei. */
  class DrahtAttrappe {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(adresse, unterprotokolle) {
      this.adresse = adresse;
      this.angeboten = unterprotokolle;
      this.protocol = "";
      this.readyState = 0;
      this.gesendet = [];
      draehte.push(this);
    }
    send(text) {
      this.gesendet.push(JSON.parse(text));
    }
    close() {
      this.readyState = 3;
    }
    oeffnen() {
      this.readyState = 1;
      this.protocol = "smartrlink.v2";
      if (this.onopen) this.onopen();
    }
    empfangen(rahmen) {
      return this.onmessage ? this.onmessage({ data: JSON.stringify(rahmen) }) : undefined;
    }
  }
  const altesWs = globalThis.WebSocket;
  const alterFetch = globalThis.fetch;
  globalThis.WebSocket = DrahtAttrappe;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    async json() {
      return {};
    },
  });

  welt = attrappeSetzen({
    tab: { ...TAB },
    seiteAntwortet: (n) => seite.fragen(n),
    panelAntwortet: (n) => (n.typ === "link:schritt-freigabe" ? { ja: true } : { ok: true }),
    ablageLocal: {
      [WERKSTATT_ABLAGE]: [
        {
          id: "wf_knopf",
          name: "Kasse: Kauf abschliessen",
          version: 1,
          params: [],
          steps: [
            {
              type: "click",
              selector_cascade: ["text=Jetzt kaufen"],
              beschreibung: "den Kauf abschliessen",
            },
          ],
        },
      ],
    },
  });
  ausfuehrer.zaehlerNeu();

  try {
    const laeuft = link.verbinden({ ticket: "einweg-ticket", ausweis: "ausweis", tabId: 7 });
    const draht = draehte[draehte.length - 1];
    draht.oeffnen();
    await draht.empfangen({
      type: "auth_ok",
      code: "verzahnung-knopf",
      access: "write",
      allow: [HOST],
      mode: "tab",
      step_mode: "confirm_each",
      expiry: 1800,
    });
    await laeuft;

    const ab = welt.spur.length;
    const antwort = await new Promise((fertig) => {
      let beantwortet = false;
      const geben = (wert) => {
        if (beantwortet) return;
        beantwortet = true;
        fertig(wert);
      };
      const weiter = workerHoerer(
        { typ: "werkbank:spielen", id: "wf_knopf", params: {} },
        { id: welt.chrome.runtime.id },
        geben
      );
      if (weiter !== true && !beantwortet) fertig(undefined);
    });

    assert.ok(antwort, "der Knopf bekommt eine Antwort, immer");
    assert.equal(antwort.ok, true, `der Ablauf muss laufen: ${JSON.stringify(antwort)}`);

    /* Gefragt wurde trotzdem: Der Mensch hat auf „Abspielen" gedrückt, nicht
       auf „kaufen". `zahlung` ist hart und wird auch hier vorgelegt. */
    assert.ok(freigabefragen(welt.spur.slice(ab)).length >= 1, "die harte Klasse wird auch hier vorgelegt");

    await runden();
    assert.equal(kaufen.__klicks, 1, "und der Klick ist wirklich in der Seite angekommen");
  } finally {
    globalThis.WebSocket = altesWs;
    globalThis.fetch = alterFetch;
  }
});

test("V-e2: Die drei Zeichen einer Cloud-Sitzung stehen, und sie gehen zusammen wieder weg", async () => {
  /*
   * §8.4 verlangt alle drei gleichzeitig: Dauerzeile, Abzeichen, EINE
   * Systemmeldung. Gemessen am echten Handschlag, nicht an einem Aufruf von
   * `cloudSitzungZeigen` — das ist der Unterschied zwischen „gebaut" und
   * „erreichbar".
   */
  welt = attrappeSetzen({ tab: { ...TAB } });
  const draehte = [];
  class DrahtAttrappe {
    static OPEN = 1;
    constructor(adresse, unterprotokolle) {
      this.adresse = adresse;
      this.angeboten = unterprotokolle;
      this.protocol = "";
      this.readyState = 0;
      this.gesendet = [];
      draehte.push(this);
    }
    send(text) {
      this.gesendet.push(JSON.parse(text));
    }
    close() {
      this.readyState = 3;
    }
    oeffnen() {
      this.readyState = 1;
      this.protocol = "smartrlink.v2";
      if (this.onopen) this.onopen();
    }
    empfangen(rahmen) {
      return this.onmessage ? this.onmessage({ data: JSON.stringify(rahmen) }) : undefined;
    }
  }
  const altesWs = globalThis.WebSocket;
  const alterFetch = globalThis.fetch;
  globalThis.WebSocket = DrahtAttrappe;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    async json() {
      return {};
    },
  });

  try {
    const ab = welt.spur.length;
    const laeuft = link.verbinden({ ticket: "einweg-ticket", ausweis: "ausweis", tabId: 7 });
    const draht = draehte[draehte.length - 1];
    draht.oeffnen();
    await draht.empfangen({
      type: "auth_ok",
      code: "verzahnung-1",
      access: "write",
      allow: [HOST],
      mode: "tab",
      /* Die mittlere Stufe, seit v3.5 §11.3 auch vom Server aus erreichbar. */
      step_mode: "assist",
      expiry: 1800,
      agent: "SMarTrCEO",
    });
    await laeuft;

    const teil = welt.spur.slice(ab);
    const zeile = teil.filter(
      (e) => e.wohin === "panel" && e.nachricht && e.nachricht.typ === "link:cloud-sitzung" && e.nachricht.an === true
    );
    const abzeichen = teil.filter((e) => e.wohin === "action.setBadgeText" && e.text);
    const meldung = teil.filter((e) => e.wohin === "notifications.create");
    assert.ok(zeile.length >= 1, "die Seitenleiste bekommt die Dauerzeile");
    assert.equal(zeile[0].nachricht.agent, "SMarTrCEO", "und in ihr steht, WER steuert");
    assert.ok(abzeichen.length >= 1, "am Symbol steht ein Abzeichen");
    assert.equal(meldung.length, 1, "und es gibt genau eine Systemmeldung");

    /* Der Serverwert kommt unverfälscht an: `assist` fällt nicht mehr auf
       `confirm_each` (Befund vom 14.08.2026). */
    const lage = await link.zustand();
    assert.equal(lage.schrittmodus, "assist", "der mittlere Modus überlebt die Leitung");

    const vorEnde = welt.spur.length;
    await link.trennen("nutzer");
    const nachher = welt.spur.slice(vorEnde);
    assert.ok(
      nachher.some(
        (e) => e.wohin === "panel" && e.nachricht && e.nachricht.typ === "link:cloud-sitzung" && e.nachricht.an === false
      ),
      "endet die Sitzung, geht die Zeile wieder weg"
    );
    assert.ok(
      nachher.some((e) => e.wohin === "action.setBadgeText" && !e.text),
      "und das Abzeichen auch"
    );
  } finally {
    globalThis.WebSocket = altesWs;
    globalThis.fetch = alterFetch;
  }
});

/* ================================================================== *
 * f) Ein unbekannter Agent kommt nicht durch
 * ================================================================== */

test("V-f: Ein Befehl mit unbekanntem agent wird mit agent_not_permitted abgelehnt", async () => {
  /*
   * §8.1: Was nicht in der Positivliste AGENTEN steht, ist kein Agent. Der
   * Name kommt vom Relay und damit von aussen; geprüft wird er hier, im
   * Client, weil eine Prüfung, die nur auf der Gegenseite steht, keine ist.
   */
  const knopf = knoten("button", { text: "Weiter" });
  const stand = weltMitSeite([knopf]);

  const ergebnis = await ausfuehrer.befehlAusfuehren(
    { id: "vf-1", cmd: "readPage", reason: "Ich lese die Seite.", agent: "SMarTrBoese" },
    stand.sitzung
  );

  assert.equal(ergebnis.type, "result");
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "agent_not_permitted");
  assert.equal(ergebnis.error.retryable, false, "derselbe Name wird beim zweiten Mal nicht besser");
  assert.ok(ergebnis.error.message, "und der Mensch bekommt einen Satz");

  /* Die Seite wurde dabei gar nicht erst angefasst. Ein abgelehnter Befehl
     darf nichts auslösen, auch kein Lesen. */
  assert.deepEqual(
    welt.spur.filter((e) => e.wohin === "seite").map((e) => e.nachricht.typ),
    [],
    "mit einem unbekannten Agenten wird nicht einmal gelesen"
  );
});

test("V-f2: Ein Rahmen OHNE agent bleibt der Weg des Menschen und wird nicht gesperrt", async () => {
  /*
   * DRAHTFORMAT §6 lässt ausdrücklich auch den Alltags-Ausweis des
   * Sitzungseigentümers als Befehlsausweis zu. Der trägt keinen Agentennamen,
   * also fährt der Mensch selbst ohne `agent`. Wer fehlendes `agent` wie einen
   * unbekannten Agenten behandelt, sperrt genau den Weg, den der 27.07.2026
   * ausdrücklich wieder geöffnet hat.
   */
  const knopf = knoten("button", { text: "Weiter" });
  const stand = weltMitSeite([knopf]);

  const ergebnis = await ausfuehrer.befehlAusfuehren(
    { id: "vf-2", cmd: "readPage", reason: "Ich lese die Seite." },
    stand.sitzung
  );
  assert.equal(ergebnis.success, true, "ohne Agentennamen fährt der Mensch selbst");
});

test("V-f3: Ein bekannter Agent ohne Eintrag in der Matrix kommt auch nicht durch", async () => {
  /*
   * Die zweite Hälfte von §4: Voreinstellung ist alles aus. Ein Agent, der in
   * der Positivliste steht, aber für diesen Wirt nichts freigeschaltet hat,
   * wird ebenso abgelehnt — nur eben an der Matrix und nicht an der Liste.
   */
  const knopf = knoten("button", { text: "Weiter" });
  const stand = weltMitSeite([knopf], { ablageLocal: {} });

  const ergebnis = await ausfuehrer.befehlAusfuehren(
    { id: "vf-3", cmd: "readPage", reason: "Ich lese die Seite.", agent: "SMarTrTrader" },
    stand.sitzung
  );
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "agent_not_permitted");
});

/* ================================================================== *
 * g) Kein stillschweigendes Umbiegen eines Schritttyps
 * ================================================================== */

test("V-g: `key` und `dblclick` werden benannt abgelehnt, nie stillschweigend als Klick gespielt", async () => {
  /*
   * `SCHRITT_TYPEN` in werkstatt.js kennt `dblclick` und `key`, `BEFEHLE` in
   * befehle.js hat für beide keinen Eintrag. Der Ausführer lehnt sie deshalb
   * BENANNT ab, und genau so muss es bleiben, solange der Zustand besteht:
   * Ein Doppelklick, der als einfacher Klick ausgeführt wird, ist ein Schritt,
   * dem der Mensch nie zugestimmt hat.
   *
   * Dieser Satz ist ausdrücklich eine Sperre und keine Zufriedenheit. Der
   * Rekorder zeichnet `key` für Enter und Tab auf; jede Aufnahme mit einem
   * Enter bleibt an dieser Stelle stehen. Der offene Punkt steht im Bericht
   * vom 14.08.2026: entweder faltet der Rekorder das Enter in den
   * `input`-Schritt (`submit: true`), oder `key` bekommt einen Befehl, dann
   * aber zusammen mit DRAHTFORMAT, Relay und Werkzeugtabelle. Was nicht geht,
   * ist die dritte Möglichkeit: es leise auf `click` abzubilden.
   */
  const knopf = knoten("button", { attrs: { id: "los" }, text: "Absenden" });
  const stand = weltMitSeite([knopf], { ablageLocal: { [WERKSTATT_ABLAGE]: [] } });

  /* Jeder Schritt traegt genau die Felder, die `SCHRITT_FELDER` ihm zugesteht.
     Ein Schritt mit einem fremden Feld faellt schon beim Lesen aus der Ablage
     durch, und dann maesse dieser Satz die Feldpruefung statt der fehlenden
     Ausfuehrung. */
  for (const [typ, felder] of [
    ["dblclick", { selector_cascade: ["#los"] }],
    ["key", { key: "Enter" }],
  ]) {
    await welt.chrome.storage.local.set({
      [WERKSTATT_ABLAGE]: [
        {
          id: "wf_typ",
          name: "Ablauf mit unspielbarem Schritt",
          version: 1,
          params: [],
          steps: [{ type: typ, beschreibung: "etwas tun", ...felder }],
        },
      ],
    });

    const ergebnis = await ausfuehrer.befehlAusfuehren(
      { id: `vg-${typ}`, cmd: "run_workflow", reason: "Ich spiele den Ablauf ab.", workflowId: "wf_typ" },
      stand.sitzung
    );

    assert.equal(ergebnis.success, false, `${typ} darf nicht als gelungen gemeldet werden`);
    assert.equal(ergebnis.error.code, "workflow_step_failed", typ);
    assert.ok(
      ergebnis.error.message.includes(typ),
      `${typ}: die Absage nennt den Schritttyp beim Namen, statt ihn umzubiegen (${ergebnis.error.message})`
    );
    assert.ok(ergebnis.error.hint, `${typ}: und sie sagt, was abspielbar ist`);
    await runden();
    assert.equal(knopf.__klicks, 0, `${typ} wurde stillschweigend als Klick gespielt`);
  }
});

/* ================================================================== *
 * h) Das Miniaturbild einer Aufzeichnung (§7.2)
 * ================================================================== */

/** Der Nachrichtenweg des Dienstarbeiters, so wie Chrome ihn ruft. */
function anWorker(nachricht, absender = { id: welt.chrome.runtime.id }) {
  return new Promise((fertig) => {
    let beantwortet = false;
    const geben = (wert) => {
      if (beantwortet) return;
      beantwortet = true;
      fertig(wert);
    };
    const weiter = workerHoerer(nachricht, absender, geben);
    if (weiter !== true && !beantwortet) fertig(undefined);
  });
}

test("V-h: `rekorder:bild` aus dem Tab wird aufgenommen, abgelegt und nur aus dem Vordergrund", async () => {
  /*
   * Bis zum 14.08.2026 sendete `content/rekorder.js` diese Nachricht, und
   * niemand hörte zu: Jeder Klickschritt trug einen Bildnamen ohne Bild.
   * Gemessen wird hier der ganze Weg — Nachricht aus dem Tab, echter
   * Nachrichtenhörer des Dienstarbeiters, `captureVisibleTab` des Ausführers,
   * echte Ablage.
   *
   * Und die Grenze dazu: `captureVisibleTab` nimmt den SICHTBAREN Tab eines
   * Fensters auf, nicht den genannten. Ein Inhaltsskript im Hintergrund darf
   * damit nicht die Seite fotografieren lassen, die gerade vorn steht.
   */
  welt = attrappeSetzen({ tab: { ...TAB }, bildDatenUrl: "data:image/jpeg;base64,QUJD" });

  const ausDemTab = { id: welt.chrome.runtime.id, tab: { id: 7 }, url: ADRESSE };
  const antwort = await anWorker(
    { typ: "rekorder:bild", name: "s1.webp", nr: 1, anlass: "user_request", rect: { x: 10, y: 20, width: 100, height: 40 } },
    ausDemTab
  );

  assert.ok(antwort, "auf diese Nachricht wird geantwortet, immer");
  assert.equal(antwort.ok, true, `das Bild muss entstehen: ${JSON.stringify(antwort)}`);

  const daten = await welt.chrome.storage.local.get(ausfuehrer.REKORDER_BILD_ABLAGE);
  const vorrat = daten[ausfuehrer.REKORDER_BILD_ABLAGE];
  assert.ok(vorrat && vorrat.bilder && vorrat.bilder["s1.webp"], "und unter seinem Namen liegen");
  const bild = vorrat.bilder["s1.webp"];
  assert.equal(bild.dataB64, "QUJD");
  assert.deepEqual(bild.rect, { x: 10, y: 20, width: 100, height: 40 }, "das Rechteck reist mit");
  assert.equal(bild.anlass, "user_request", "und der Anlass, aus der geschlossenen Menge");

  /* Aus der Seitenleiste kommt kein Bild: Dort läuft keine Aufzeichnung. */
  const ausLeiste = await anWorker({ typ: "rekorder:bild", name: "s2.webp" });
  assert.equal(ausLeiste.ok, false);
  assert.equal(ausLeiste.kennung, "absender_ungueltig");

  /* Und ein Tab im Hintergrund bekommt kein Bild, sondern eine Absage. */
  welt = attrappeSetzen({
    tab: { ...TAB, active: false },
    bildDatenUrl: "data:image/jpeg;base64,QUJD",
  });
  const imHintergrund = await anWorker({ typ: "rekorder:bild", name: "s3.webp" }, ausDemTab);
  assert.equal(imHintergrund.ok, false, "kein Bild vom falschen Tab");
  assert.equal(imHintergrund.kennung, "tab_im_hintergrund");
  const danach = await welt.chrome.storage.local.get(ausfuehrer.REKORDER_BILD_ABLAGE);
  assert.equal(danach[ausfuehrer.REKORDER_BILD_ABLAGE], undefined, "und nichts in der Ablage");
});

test("V-h2: Ein Bildname, der als Ablageschlüssel nicht taugt, wird abgelehnt", async () => {
  /* Der Name kommt aus einer fremden Seite und wird Schlüssel in unserer
     Ablage. Er wird deshalb gemessen und nicht gesäubert: Ein Name, der das
     Muster nicht trifft, ist keiner. */
  welt = attrappeSetzen({ tab: { ...TAB }, bildDatenUrl: "data:image/jpeg;base64,QUJD" });
  const ausDemTab = { id: welt.chrome.runtime.id, tab: { id: 7 }, url: ADRESSE };

  for (const name of ["", "../../etc/passwd", "__proto__", "s1 .webp", "x".repeat(80)]) {
    const antwort = await anWorker({ typ: "rekorder:bild", name }, ausDemTab);
    assert.equal(antwort.ok, false, `durchgelassen: ${JSON.stringify(name)}`);
    assert.equal(antwort.kennung, "name_ungueltig", JSON.stringify(name));
    assert.ok(antwort.klartext, "und mit einem Satz");
  }
  const daten = await welt.chrome.storage.local.get(ausfuehrer.REKORDER_BILD_ABLAGE);
  assert.equal(daten[ausfuehrer.REKORDER_BILD_ABLAGE], undefined, "nichts davon liegt in der Ablage");
});

/* ================================================================== *
 * i) Der Live-Blocker vom 14.08.2026: overlay.js und rekorder.js im
 *    selben Tab
 * ================================================================== */

test("V-i: Läuft schon eine Agentensitzung, wird der Rekorder trotzdem eingespielt", async () => {
  /*
   * Der Ablauf, an dem es hing: `rekorderSenden` (worker.js) fragt ZUERST den
   * Tab, ob dort schon ein Rekorder läuft, und spielt ihn nur ein, wenn
   * niemand antwortet. Läuft eine Agentensitzung, hängt `overlay.js` im Tab —
   * und es beantwortete `rekorder:start` in seinem Vorgabezweig mit
   * `{ok:false, fehler:"unbekannte_nachricht"}`. `anSeite` meldete das als
   * Antwort, der Worker hielt es für Erfolg, spielte den Rekorder nie ein, und
   * der Mensch bekam einen Startknopf, der nichts tut.
   *
   * Gemessen mit dem ECHTEN `overlay.js` im Tab und dem ECHTEN
   * Nachrichtenhörer des Dienstarbeiters.
   */
  const knopf = knoten("button", { text: "Weiter" });
  const seite = seiteLaden([knopf]);

  /* Die Gegenprobe zuerst, direkt am Inhaltsskript: Das Overlay antwortet auf
     eine Nachricht mit Präfix `rekorder:` gar nicht. */
  const stumm = await seite.fragen({ typ: "rekorder:start", tabId: 7 });
  assert.equal(stumm, undefined, "overlay.js darf auf `rekorder:` nicht antworten");
  /* Und auf seine eigenen Nachrichten weiterhin schon. */
  const ping = await seite.fragen({ typ: "overlay:ping" });
  assert.deepEqual(ping, { ok: true });

  welt = attrappeSetzen({ tab: { ...TAB }, seiteAntwortet: (n) => seite.fragen(n) });

  const antwort = await anWorker({ typ: "rekorder:start", tabId: 7 });
  const eingespielt = welt.spur.filter((e) => e.wohin === "executeScript");
  assert.ok(
    eingespielt.length >= 1,
    "der Rekorder wird eingespielt, obwohl das Overlay schon im Tab hängt"
  );
  assert.deepEqual(
    eingespielt[0].auftrag.files,
    ["src/content/selektor.js", "src/content/rekorder.js"],
    "und zwar Selektor vor Rekorder, die Reihenfolge ist verbindlich"
  );
  assert.ok(antwort, "und der Knopf bekommt in jedem Fall eine Antwort");
});

/* ================================================================== *
 * j) Der Inhalt eines Geheimfeldes verlässt die Seite nicht — auch nicht
 *    als NAME
 * ================================================================== */

test("V-j: Ein bearbeitbarer Bereich mit Geheiminhalt gibt seinen Text nicht als Namen heraus", async () => {
  /*
   * Befund vom 14.08.2026 (Verzahnung): `geheim()` und `wertVon()` decken den
   * WERT eines Feldes ab, den Namen nicht. Bei einem `<div contenteditable>`
   * hat `wertVon` den Wert richtig verweigert, derselbe getippte Text stand
   * aber als `name` im Textbaum und ging so an den Agenten.
   *
   * Gemessen am Ergebnisrahmen von `readPage`, also an dem, was der Agent
   * wirklich zu sehen bekommt. Ein Prüfsatz an `nameVon` allein hätte diese
   * Lücke nicht gezeigt: Die Funktion tat genau, was sie sollte.
   */
  const GEHEIM = "Hunter2-Geheim-4711";
  const feld = knoten("div", {
    /* Kein `aria-label`, kein `<label>` — genau die Lage, in der `nameVon`
       auf den Text IM Element zurückfällt. Geheim ist es an seiner Kennung. */
    attrs: { id: "pin-feld", role: "textbox" },
    text: GEHEIM,
    bearbeitbar: true,
    rect: { left: 100, top: 100, width: 200, height: 30 },
  });
  const harmlos = knoten("button", { text: "Anmelden", rect: { left: 100, top: 200, width: 150, height: 40 } });
  const stand = weltMitSeite([feld, harmlos]);

  const ergebnis = await ausfuehrer.befehlAusfuehren(
    { id: "vj-1", cmd: "readPage", reason: "Ich sehe mir die Seite an." },
    stand.sitzung
  );
  assert.equal(ergebnis.success, true);

  const alles = JSON.stringify(ergebnis.data);
  assert.ok(
    !alles.includes(GEHEIM),
    `der Geheiminhalt steht im Textbaum: ${ergebnis.data.snapshot.text}`
  );
  assert.ok(
    ergebnis.data.snapshot.text.includes("Anmelden"),
    "und die Gegenprobe: gewöhnliche Beschriftungen stehen weiterhin drin"
  );
});
