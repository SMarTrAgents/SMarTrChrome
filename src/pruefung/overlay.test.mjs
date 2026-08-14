/*
 * Prüfung der Wahrnehmung — das echte `src/content/overlay.js`, gefahren in
 * einer Attrappe des Seitenbaums.
 *
 * Warum der Aufwand: In dieser Datei entscheidet sich, WAS der Agent von der
 * Seite eines Menschen zu sehen bekommt. Zwei Zusicherungen daraus sind
 * Sicherheitszusagen und keine Bequemlichkeit:
 *
 *   - Der Inhalt von Geheimfeldern (Passwort, Karte, Einmalcode) wird nie
 *     ausgelesen — auch nicht für den eigenen Agenten (spec-01 V10).
 *   - Eine Referenz aus einer alten Wahrnehmung löst nichts mehr auf. Ein
 *     Zeiger, der auf das falsche Element zeigt, ist schlimmer als keiner.
 *
 * Die Attrappe bildet nur nach, was das Skript wirklich anfasst. Sie kann
 * keinen echten Browser ersetzen — Layout, geschlossene Schattenbäume und
 * fremde Rahmenseiten bleiben ungeprüft und gehören in den Handlauf am Gerät.
 * Offene Schattenbäume sind seit 06.08.2026 Teil der Wahrnehmung und werden
 * hier als handgebaute shadowRoot-Objekte mitgeprüft.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const QUELLE = new URL("../content/overlay.js", import.meta.url);
const WACHE_QUELLE = new URL("../content/klickwache.js", import.meta.url);

/* ------------------------------------------------------------------ *
 * Attrappe des Seitenbaums
 * ------------------------------------------------------------------ */

let naechsteId = 0;

/* Eine Option einer Auswahlliste. `text` ist das Etikett, `value` das, was die
   Seite selbst benutzt — die beiden sind selten dasselbe. */
function option(text, wert, { disabled = false } = {}) {
  return { text, textContent: text, value: wert === undefined ? text : wert, disabled, selected: false };
}

/* Jeder Knoten bekommt seinen eigenen Platz auf dem Schirm.
 *
 * Befund vom 14.08.2026: Bis hierher trugen ALLE Attrappen-Knoten dasselbe
 * Rechteck. Solange niemand am Punkt nachsah, war das gleichgültig; mit der
 * Verdeckungswache ist es das Gegenteil — bei deckungsgleichen Rechtecken liegt
 * jedes Element über jedem anderen, und „ist mein Ziel frei" wäre nicht
 * messbar, sondern immer nein. Deshalb liegen die Knoten jetzt in einem Raster,
 * dessen Zellen sich nicht berühren: fünf Spalten mit 130 Punkten Abstand bei
 * 120 Punkten Breite, zwanzig Zeilen mit 40 bei 30. Wer verdecken will, sagt
 * es ausdrücklich (`rect` und `z`). */
const RASTER_SPALTEN = 5;
const RASTER_ZEILEN = 20;
function platz(nr) {
  const zelle = nr % (RASTER_SPALTEN * RASTER_ZEILEN);
  return {
    left: 10 + (zelle % RASTER_SPALTEN) * 130,
    top: 20 + Math.floor(zelle / RASTER_SPALTEN) * 40,
    width: 120,
    height: 30,
  };
}

function knoten(tag, {
  art = "element", // element | bereich | text
  attrs = {},
  text = "",
  rect = null,
  /* Die Stapelebene und die Klicktaubheit — beides braucht die Wache, und
     beides gibt es im echten Browser auch. */
  z = 0,
  klicktaub = false,
  value = undefined,
  type = undefined,
  disabled = false,
  versteckt = false,
  optionen = undefined,
  checked = undefined,
  form = undefined,
  bearbeitbar = false,
  umLabel = undefined, // das <label>, das dieses Feld umschließt
} = {}) {
  const nr = ++naechsteId;
  const flaeche = rect || platz(nr);
  const el = {
    __art: art,
    __versteckt: versteckt,
    __z: z,
    __klicktaub: klicktaub,
    __wert: value,
    __ereignisse: [], // was auf diesem Element ausgelöst wurde
    __klicks: 0,
    __fokus: 0,
    tagName: tag.toUpperCase(),
    id: attrs.id || "",
    name: attrs.name || "",
    innerText: text,
    type,
    disabled,
    readOnly: false,
    required: !!attrs.required,
    checked,
    isConnected: true,
    isContentEditable: bearbeitbar,
    parentElement: null,
    /* Die Wache geht über `parentNode` nach oben (und über `host` durch
       Schattengrenzen). Ohne dieses Feld wäre „der Punkt gehört einem Kind des
       Ziels" nicht prüfbar — und genau dieser Fall ist der Alltag: Auf dem
       Knopf liegt seine eigene Beschriftung. */
    parentNode: null,
    childNodes: text ? [{ nodeType: 3, nodeValue: text }] : [],
    __id: nr,
    getAttribute: (n) => (n in attrs ? String(attrs[n]) : null),
    getBoundingClientRect: () => ({
      ...flaeche,
      bottom: flaeche.top + flaeche.height,
      right: flaeche.left + flaeche.width,
    }),
    matches: (sel) => {
      if (sel.startsWith("a[href]")) return el.__art === "element";
      if (sel.startsWith("header")) return el.__art === "bereich";
      if (sel.startsWith("h1")) return el.__art === "text";
      return false;
    },
    /* Befund M4: Die Attrappe gab hier immer null zurück — damit war das
       umschließende <label> als Beschriftungsquelle gar nicht prüfbar. Der
       eigene Rahmen (`#smartrchrome-host`) bleibt weiterhin fremd, sonst
       verschwände jedes Element aus dem Textbaum. */
    closest: (sel) => {
      if (sel === "label") return umLabel || null;
      if (sel === "form") return el.form || null;
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
    /* click() bildet nach, was ein Browser tut: Ankreuzfelder kippen, und die
       Ereignisse kommen von selbst. */
    click: () => {
      el.__klicks += 1;
      if (el.type === "checkbox") el.checked = !el.checked;
      if (el.type === "radio") el.checked = true;
      if (el.type === "checkbox" || el.type === "radio") {
        el.dispatchEvent({ type: "input" });
        el.dispatchEvent({ type: "change" });
      }
    },
  };
  if (form) el.form = form;
  if (optionen) {
    el.options = optionen;
    el.selectedIndex = 0;
    el.multiple = false;
  }
  /* Der Wert liegt hinter einem Zugriffspaar, weil overlay.js absichtlich den
     Setter des Prototyps benutzt (React & Co. sehen sonst nichts). Beide Wege
     müssen auf denselben Platz schreiben. */
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

/* Ein Beschriftungsknoten — ein <label for=…> oder der Absatz, auf den ein
   aria-labelledby zeigt. Er steht absichtlich NICHT in der Elementliste: Er
   beschriftet ein Feld, er ist keines. */
function etikett(text, { id = "", fuer = "" } = {}) {
  return { tagName: "LABEL", id, __fuer: fuer, textContent: text, getAttribute: () => null };
}

/* Ereignisse und die zwei Prototypen mit dem echten Wert-Setter. */
class Ereignis {
  constructor(typ, o = {}) {
    this.type = typ;
    Object.assign(this, o);
  }
}
function mitWertSetter() {
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
}

/* Ein Inline-Stil, wie ihn eine CSSStyleDeclaration führt: Text UND einzeln
   abfragbare Eigenschaften samt Priorität.
   Warum das sein muss: Der Wächter am Wirt erkennt einen gekaperten Stil an
   `getPropertyValue`/`getPropertyPriority` und ausdrücklich NICHT am ganzen
   cssText — Chrome schreibt den beim Setzen um („0" wird „0px"), ein
   Textvergleich wäre danach dauerhaft ungleich und der Wächter liefe im Kreis.
   Eine Attrappe, die nur cssText kann, würde genau diese Bauentscheidung
   ungeprüft lassen.
   Grenze der Nachbildung: Ein direkt gesetztes `style.left = "5px"` legt hier
   eine gewöhnliche Eigenschaft an und taucht nicht in der Karte auf. Das
   genügt, weil overlay.js die Karte ausschließlich für den Wirt-Stil befragt,
   den es am Stück über cssText schreibt. */
function stilAttrappe() {
  const karte = new Map();
  let roh = "";
  const neuSchreiben = () => {
    roh = [...karte]
      .map(([k, v]) => `${k}:${v.wert}${v.prio ? " !important" : ""}`)
      .join(";");
    if (roh) roh += ";";
  };
  return {
    get cssText() {
      return roh;
    },
    set cssText(t) {
      roh = String(t == null ? "" : t);
      karte.clear();
      for (const stueck of roh.split(";")) {
        const s = stueck.trim();
        if (!s) continue;
        const trenn = s.indexOf(":");
        if (trenn < 0) continue;
        const name = s.slice(0, trenn).trim().toLowerCase();
        let wert = s.slice(trenn + 1).trim();
        let prio = "";
        if (/!\s*important$/i.test(wert)) {
          prio = "important";
          wert = wert.replace(/!\s*important$/i, "").trim();
        }
        karte.set(name, { wert, prio });
      }
    },
    getPropertyValue(n) {
      return (karte.get(String(n).toLowerCase()) || { wert: "" }).wert;
    },
    getPropertyPriority(n) {
      return (karte.get(String(n).toLowerCase()) || { prio: "" }).prio;
    },
    setProperty(n, w, p) {
      karte.set(String(n).toLowerCase(), {
        wert: String(w),
        prio: p === "important" ? "important" : "",
      });
      neuSchreiben();
    },
    removeProperty(n) {
      karte.delete(String(n).toLowerCase());
      neuSchreiben();
    },
  };
}

/* Wer bekäme an dieser Stelle den Klick? Dieselbe Regel wie im Browser: Wer den
   Punkt überdeckt, kommt in Frage, es gewinnt die höchste Ebene, bei gleicher
   Ebene der spätere Knoten. Unsichtbares und Klicktaubes nimmt nichts an. */
function trefferAmPunkt(elemente, x, y) {
  let bester = null;
  elemente.forEach((el, i) => {
    if (!el || el.__versteckt || el.__klicktaub) return;
    if (el.isConnected === false) return;
    const r = el.getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return;
    const z = Number(el.__z) || 0;
    if (!bester || z > bester.z || (z === bester.z && i > bester.i)) bester = { el, z, i };
  });
  return bester ? bester.el : null;
}

function umgebungBauen(elemente, etiketten = []) {
  /* `erzeugt` und `angehaengt` halten fest, WAS das Skript in die fremde
     Seite baut. Ohne diese zwei Listen war der Wirt-Knoten des Overlays
     (#smartrchrome-host) für keine Prüfung erreichbar — createElement gab ein
     namenloses Objekt zurück und appendChild warf es weg. Genau an diesem
     Knoten hängt aber die Abwehr gegen Seiten-CSS. */
  const zustand = {
    scrollY: 0,
    geschrieben: [],
    beobachter: [],
    erzeugt: [],
    angehaengt: [],
    /* Fensterhörer (keydown, scroll) und das Stylesheet des Schattenbaums.
       Ohne beides wären die Notbremse und der Klick-Puls von außen weder
       auslösbar noch lesbar. */
    hoerer: [],
    stil: "",
  };

  /* Eine Meldung zustellen — und zwar nur an die Beobachter, die sie im echten
     Browser auch bekämen.
     Warum so genau: Der Wächter am Wirt hängt an genau zwei Stellen, an den
     Kindern von <html> und an den Attributen des eigenen Knotens. Eine
     Attrappe, die jede Meldung an jeden Beobachter gibt, kann nicht messen, ob
     er überhaupt an der richtigen Stelle hängt — die Gegenprobe „Beobachtung
     entfernt" bliebe grün. Zugestellt wird deshalb nach Ziel, nach Art und,
     bei Attributen, nach dem Filter. */
  zustand.melden = (art, ziel, merkmal = null) => {
    for (const b of [...zustand.beobachter]) {
      if (!b.__aktiv) continue;
      const passt = (b.__ziele || []).some((e) => {
        const o = e.o || {};
        if (!o[art]) return false;
        if (e.ziel !== ziel) return !!o.subtree;
        if (art === "attributes" && o.attributeFilter && merkmal) {
          return o.attributeFilter.includes(merkmal);
        }
        return true;
      });
      if (passt) b.__ruf([{ type: art, target: ziel, attributeName: merkmal }]);
    }
  };

  /* Eine Änderung irgendwo am Seitenbaum — für die Ruhe-Bedingung von
     overlay:warten. Sie erreicht nur, wer den ganzen Teilbaum beobachtet. */
  zustand.aendern = (ziel = {}) => zustand.melden("childList", ziel);

  /* Eine Änderung an den DIREKTEN Kindern von <html>: genau die Meldung, mit
     der der Browser das Entfernen des Wirts anzeigt. */
  zustand.kindWechsel = () => zustand.melden("childList", document.documentElement);

  const document = {
    title: "Warenkorb",
    readyState: "complete",
    activeElement: null,
    body: { innerText: "" },
    documentElement: {
      /* Der Wirt ist der einzige Knoten, den das Overlay in die fremde Seite
         hängt. Er wird hier aufbewahrt statt verworfen, damit prüfbar bleibt,
         womit er sich gegen das CSS dieser Seite wehrt.
         Wie im echten Baum bekommt der Knoten dabei seinen Elternteil und
         seine Verbindung — und der Browser meldet die Änderung an die
         Beobachter. Nur so ist überhaupt prüfbar, dass das Wiedereinsetzen
         durch den Wächter nicht in eine Schleife mit sich selbst läuft. */
      appendChild(n) {
        zustand.angehaengt.push(n);
        if (n) {
          n.isConnected = true;
          n.parentNode = document.documentElement;
        }
        zustand.kindWechsel();
        return n;
      },
      scrollHeight: 4000,
    },
    createElement: () => {
      const attrs = {};
      /* Der Textknoten des Schildes bleibt derselbe — sonst wäre nicht
         nachlesbar, WAS das Overlay dem Menschen hinschreibt. */
      const textKnoten = { textContent: "" };
      const el = {
        style: stilAttrappe(),
        className: "",
        id: "",
        innerHTML: "",
        textContent: "",
        dataset: {},
        isConnected: false,
        parentNode: null,
        __eigen: true,
        __attrs: attrs,
        __text: textKnoten,
        setAttribute(n, w) {
          attrs[n] = String(w);
        },
        removeAttribute(n) {
          delete attrs[n];
        },
        getAttribute: (n) => (n in attrs ? attrs[n] : null),
        /* Der eigene Rahmen erkennt seine eigenen Knoten — overlay:warten darf
           die eigene Anzeige nicht für Bewegung der Seite halten. */
        contains: (n) => !!(n && n.__eigen),
        querySelector: (sel) => (sel === ".text" ? textKnoten : { textContent: "" }),
        /* Ereignishörer werden aufbewahrt statt verworfen: Am Not-Aus-Schild
           hängt einer, und ein Knopf, den keine Prüfung drücken kann, ist ein
           Knopf, von dem niemand weiß, ob er etwas tut. */
        __hoerer: [],
        addEventListener(typ, hoerer, o) {
          el.__hoerer.push({ typ, hoerer, o });
        },
        removeEventListener(typ, hoerer) {
          el.__hoerer = el.__hoerer.filter((h) => !(h.typ === typ && h.hoerer === hoerer));
        },
        __kinder: [],
        append(...kinder) {
          for (const k of kinder) if (k) el.__kinder.push(k);
        },
        appendChild(k) {
          if (k) el.__kinder.push(k);
          return k;
        },
        attachShadow: () => ({
          adoptedStyleSheets: [],
          append() {},
        }),
      };
      zustand.erzeugt.push(el);
      return el;
    },
    querySelectorAll: () => elemente,
    /* Die Auswahl, die der Browser an einem Punkt selbst trifft — und die
       einzige, die die Verdeckungswache befragt. Sie steht hier, weil sich ohne
       sie überhaupt nicht messen lässt, ob ein Ziel frei liegt: Der Befund vom
       11.08.2026 (Klick auf ein verdecktes Ziel wird ausgeführt und als Erfolg
       gemeldet) wäre in einer Attrappe ohne Punktprobe unsichtbar geblieben.
       Nachgebildet sind genau die drei Dinge, an denen es hängt: Rechtecke,
       Stapelreihenfolge (höheres z-index gewinnt, sonst der spätere Knoten) und
       die Frage, wer überhaupt Zeigerereignisse annimmt. Außerhalb des
       Sichtfensters gibt es wie im Browser `null`. */
    elementFromPoint: (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (x < 0 || y < 0 || x >= sandbox.innerWidth || y >= sandbox.innerHeight) return null;
      return trefferAmPunkt(elemente, x, y);
    },
    /* Befund M4: Beide gaben immer null zurück — damit waren `aria-labelledby`
       und `label[for=…]` als Beschriftungsquellen der Geheim-Erkennung nicht
       prüfbar. Ohne Etiketten in der Liste ist das Ergebnis wie vorher null. */
    querySelector: (sel) => {
      const m = /^label\[for="(.*)"\]$/.exec(String(sel || ""));
      if (!m) return null;
      return etiketten.find((n) => n && n.__fuer === m[1]) || null;
    },
    getElementById: (id) =>
      [...etiketten, ...elemente].find((n) => n && n.id && n.id === id) || null,
    addEventListener() {},
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document,
    innerHeight: 900,
    /* Die Breite fehlte bis 14.08.2026. Solange sie fehlte, war `innerWidth`
       im Sandkasten undefiniert, und jede Rechnung damit ergab NaN — die
       Sichtfeldprüfung der Wache („liegt das Ziel überhaupt auf dem Schirm")
       wäre stillschweigend übersprungen worden. */
    innerWidth: 1280,
    get scrollY() {
      return zustand.scrollY;
    },
    scrollTo: (o) => {
      zustand.scrollY = Math.max(0, Math.round((o && o.top) || 0));
    },
    scrollBy: (o) => {
      zustand.scrollY = Math.max(0, zustand.scrollY + Math.round((o && o.top) || 0));
    },
    getComputedStyle: (el) => ({
      ...(el.__versteckt
        ? { visibility: "hidden", display: "none", opacity: "0" }
        : { visibility: "visible", display: "block", opacity: "1" }),
      /* Ein Ziel mit abgeschalteten Zeigerereignissen ist nicht verdeckt,
         sondern durchlässig — die Wache unterscheidet das, und ohne diese
         Angabe wäre der Unterschied hier nicht messbar. */
      pointerEvents: el.__klicktaub ? "none" : "auto",
    }),
    /* Das Stylesheet des Schattenbaums wird mitgeschrieben statt verworfen:
       Der Klick-Puls und das Zeichen für ein totes Overlay leben ausschließlich
       im CSS, und was hier nicht ankommt, kann keine Prüfung sehen. */
    CSSStyleSheet: class {
      replaceSync(text) {
        zustand.stil = String(text || "");
      }
    },
    CSS: { escape: (s) => s },
    performance: { now: () => Date.now() },
    location: { href: "https://laden.example/warenkorb" },
    Event: Ereignis,
    InputEvent: Ereignis,
    KeyboardEvent: Ereignis,
    /* Die echte Klick-Ereigniskette (echterKlick in overlay.js) sendet Zeiger-
       und Mausereignisse, damit moderne Bedienelemente reagieren. Ohne diese
       Prototypen würden sie werfen und still verschluckt — dann bliebe der
       Rückbau auf focus()+click() unbemerkt grün. */
    MouseEvent: Ereignis,
    PointerEvent: Ereignis,
    HTMLInputElement: mitWertSetter(),
    HTMLTextAreaElement: mitWertSetter(),
    MutationObserver: class {
      constructor(ruf) {
        this.__ruf = ruf;
        this.__aktiv = false;
        /* Woran dieser Beobachter hängt und mit welchen Vorgaben. Ohne diese
           Liste wäre „hängt am richtigen Knoten" keine prüfbare Aussage. */
        this.__ziele = [];
        zustand.beobachter.push(this);
      }
      observe(ziel, o = {}) {
        this.__aktiv = true;
        this.__ziele.push({ ziel, o });
      }
      disconnect() {
        this.__aktiv = false;
        this.__ziele = [];
      }
    },
    chrome: {
      runtime: {
        /* Chrome setzt `id` immer — und nimmt sie weg, sobald der Kontext
           ungültig ist (Erweiterung neu geladen, aktualisiert, abgeschaltet).
           Genau daran erkennt overlay.js, dass die Notbremse nichts mehr
           erreichen kann. */
        id: "smartrchrome-attrappe",
        __hoerer: null,
        __gesendet: [],
        __wirft: false,
        __abgelehnt: false,
        onMessage: {
          addListener(f) {
            sandbox.chrome.runtime.__hoerer = f;
          },
        },
        sendMessage(n) {
          const r = sandbox.chrome.runtime;
          /* So wirft der echte Browser: synchron, mitten im Ereignishörer. */
          if (r.__wirft) throw new Error("Extension context invalidated.");
          r.__gesendet.push(n);
          if (r.__abgelehnt) return Promise.reject(new Error("message port closed"));
          return undefined;
        },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.scrollX = 0;
  /* Fensterhörer werden aufbewahrt statt verworfen: Notbremse (keydown) und
     das Nachführen im Bildlauf (scroll) hängen daran, und ohne sie wäre beides
     von außen gar nicht auslösbar. */
  sandbox.window.addEventListener = (typ, hoerer, o) => {
    zustand.hoerer.push({ typ, hoerer, o });
  };
  zustand.feuern = (typ, ereignis = {}) => {
    for (const h of zustand.hoerer) if (h.typ === typ) h.hoerer(ereignis);
  };

  /* Der Wirt, so wie ihn eine Prüfung angreift. */
  const wirt = () =>
    zustand.angehaengt.find((n) => n && n.id === "smartrchrome-host") || null;
  zustand.wirt = wirt;

  /* `node.remove()` der Seite: raus aus dem Baum, und der Browser meldet die
     Änderung an den Kindern von <html>. */
  zustand.wirtEntfernen = () => {
    const w = wirt();
    assert.ok(w, "ohne Wirt gibt es nichts zu entfernen");
    w.isConnected = false;
    w.parentNode = null;
    zustand.kindWechsel();
    return w;
  };

  /* Verschieben statt entfernen: Der Knoten lebt, hängt aber woanders — zum
     Beispiel in einem Behälter mit overflow:hidden. */
  zustand.wirtVerschieben = () => {
    const w = wirt();
    assert.ok(w, "ohne Wirt gibt es nichts zu verschieben");
    w.parentNode = { __fremd: true };
    zustand.kindWechsel();
    return w;
  };

  /* Ein Seitenskript überschreibt den Inline-Stil an genau der Stelle, an der
     die Abwehr steht. Gegen !important im CSS hilft der Stil, gegen das hier
     nicht — nur der Wächter. Der Browser meldet es als Attributänderung an
     „style", und genau darauf muss der Wächter hören. */
  zustand.stilKapern = (eigenschaft = "display", neu = "none", prio = "important") => {
    const w = wirt();
    assert.ok(w, "ohne Wirt gibt es keinen Stil zu kapern");
    w.style.setProperty(eigenschaft, neu, prio);
    zustand.melden("attributes", w, "style");
    return w;
  };

  return { sandbox, zustand };
}

async function overlayStarten(elemente, etiketten = [], { ohneWache = false } = {}) {
  const quelle = await readFile(QUELLE, "utf8");
  const { sandbox, zustand } = umgebungBauen(elemente, etiketten);
  vm.createContext(sandbox);
  /* Die Klickwache wird eingespielt wie im Browser: VOR dem Overlay, als
     klassisches Skript, in denselben globalen Rahmen (`src/net/seite.js`
     spielt genau diese Reihenfolge ein). Damit läuft in dieser Prüfung
     wirklich der Weg, den auch der Kunde bekommt — der Befund vom 11.08.2026
     war eine geprüfte Wache, die im Klickweg niemand rief.
     `ohneWache` ist die Gegenprobe: Fehlt sie, darf nicht bedient werden. */
  if (!ohneWache) {
    const wache = await readFile(WACHE_QUELLE, "utf8");
    vm.runInContext(wache, sandbox, { filename: "klickwache.js" });
    assert.ok(sandbox.SMARTR_KLICKWACHE, "klickwache.js muss sich an globalThis hängen");
  }
  vm.runInContext(quelle, sandbox, { filename: "overlay.js" });
  const hoerer = sandbox.chrome.runtime.__hoerer;
  assert.ok(hoerer, "overlay.js muss einen Nachrichtenhörer anmelden");

  /* Jede Nachricht antwortet synchron — genau das ist die Zusicherung:
     Es gibt keinen Weg, auf dem das Seitenskript stumm bleibt. */
  const fragen = (nachricht) => {
    let antwort;
    let kam = false;
    hoerer(nachricht, null, (a) => {
      antwort = a;
      kam = true;
    });
    assert.ok(kam, `keine Antwort auf ${nachricht.typ}`);
    /* Chrome kopiert jede Nachricht zwischen den Welten (structured clone).
       Der Umweg über JSON bildet das nach — und stellt nebenbei sicher, dass
       im Rahmen nichts steht, was die Leitung gar nicht überstünde. */
    return JSON.parse(JSON.stringify(antwort));
  };

  /* overlay:warten ist der einzige Weg, der später antwortet — für ihn dieselbe
     Frage, nur als Zusage. Auch hier gilt: Es gibt keinen Weg, auf dem das
     Seitenskript stumm bleibt; nur einen, der sich Zeit lässt. */
  const fragenSpaeter = (nachricht) =>
    new Promise((fertig, scheitern) => {
      const uhr = setTimeout(
        () => scheitern(new Error(`keine Antwort auf ${nachricht.typ}`)),
        20000
      );
      hoerer(nachricht, null, (a) => {
        clearTimeout(uhr);
        fertig(JSON.parse(JSON.stringify(a)));
      });
    });

  return { fragen, fragenSpaeter, zustand, sandbox };
}

/* Einen Durchlauf der Warteschlange abwarten — klicken, auswählen und
   absenden geschehen absichtlich NACH der Antwort. */
const gleich = () => new Promise((f) => setTimeout(f, 0));

/* Eine Uhr zum Vorspulen.
 *
 * Befund M3: Der Fristdeckel von overlay:warten war durch keine Prüfung
 * gedeckt — die Gegenlesung hat ihn entfernt, und alle 33 Prüfungen blieben
 * grün. Eine Prüfung in echter Zeit wäre der Grund dafür: Eine Frist von 45
 * Sekunden ehrlich abzuwarten kostet 45 Sekunden.
 *
 * Deshalb bekommt die Attrappe hier ihre eigene Zeit. `setTimeout` und
 * `performance.now` werden im Sandkasten ausgetauscht — overlay.js schlägt
 * beide bei jedem Aufruf im globalen Rahmen nach, sieht also ab sofort diese
 * Uhr. Die Prüfung des Rahmens (`fragenSpaeter`) läuft weiter auf der echten. */
function uhrEinbauen(sandbox) {
  let jetzt = 0;
  let nr = 0;
  const auftraege = new Map();
  sandbox.performance = { now: () => jetzt };
  sandbox.setTimeout = (f, ms) => {
    const id = ++nr;
    auftraege.set(id, { f, wann: jetzt + Math.max(0, Number(ms) || 0) });
    return id;
  };
  sandbox.clearTimeout = (id) => auftraege.delete(id);

  return {
    /* Bis `ziel` vorspulen und dabei jeden fälligen Auftrag in der richtigen
       Reihenfolge ausführen — auch die, die dabei neue Aufträge stellen. */
    async vor(ms) {
      const ziel = jetzt + ms;
      for (let schutz = 0; schutz < 10000; schutz += 1) {
        let naechste = null;
        for (const [id, a] of auftraege) {
          if (a.wann <= ziel && (!naechste || a.wann < naechste[1].wann)) naechste = [id, a];
        }
        if (!naechste) break;
        auftraege.delete(naechste[0]);
        jetzt = Math.max(jetzt, naechste[1].wann);
        naechste[1].f();
      }
      jetzt = ziel;
      /* Den echten Warteschlangen einen Durchlauf gönnen, damit ein erfülltes
         Versprechen auch angekommen ist, bevor die Prüfung weiterfragt. */
      await gleich();
    },
  };
}

/* Ob ein Versprechen schon eingelöst ist, ohne darauf zu warten. */
function beobachten(versprechen) {
  const zustand = { fertig: false, wert: undefined };
  versprechen.then((w) => {
    zustand.fertig = true;
    zustand.wert = w;
  });
  return zustand;
}

/* ------------------------------------------------------------------ *
 * Ein kleiner Warenkorb
 * ------------------------------------------------------------------ */

function seiteBauen() {
  const nav = knoten("nav", { art: "bereich", attrs: { "aria-label": "Hauptmenü" } });
  const start = knoten("a", { attrs: { href: "/" }, text: "Startseite" });
  const passwort = knoten("input", {
    attrs: { type: "password", name: "passwort", placeholder: "Passwort" },
    type: "password",
    value: "streng-geheim-123",
  });
  const suche = knoten("input", {
    attrs: { type: "text", name: "suche", "aria-label": "Produktsuche" },
    type: "text",
    value: "SSD 2TB",
  });
  const kasse = knoten("button", { text: "Zur Kasse", disabled: true });
  const summe = knoten("p", { art: "text", text: "Zwischensumme: 428,90 Euro" });
  const weitUnten = knoten("a", {
    attrs: { href: "/impressum" },
    text: "Impressum",
    rect: { left: 0, top: 5000, width: 100, height: 20 },
  });
  const unsichtbar = knoten("button", { text: "Versteckt", versteckt: true });

  for (const k of [start, passwort, suche, kasse, summe, weitUnten, unsichtbar]) {
    k.parentElement = nav;
  }
  return { nav, start, passwort, suche, kasse, summe, weitUnten, unsichtbar,
    alle: [nav, start, passwort, suche, kasse, summe, weitUnten, unsichtbar] };
}

/* Ein Bestellformular mit allem, was man auswählen kann. */
function bedienseiteBauen() {
  const form = { __abgeschickt: 0, requestSubmit: () => { form.__abgeschickt += 1; } };

  const versand = knoten("select", {
    attrs: { "aria-label": "Versandart" },
    optionen: [
      option("Standard", "std"),
      option("Express", "exp"),
      option("Nachtzustellung", "nacht", { disabled: true }),
    ],
  });
  const farbe = knoten("select", {
    attrs: { "aria-label": "Farbe" },
    optionen: [option("Rot", "r1"), option("Rotbraun", "r2")],
  });
  const monat = knoten("select", {
    attrs: { "aria-label": "Monat", autocomplete: "cc-exp-month" },
    optionen: [option("01"), option("02")],
  });
  /* Befund M1: Diese Liste heißt auf jeder zweiten Bestellseite so — und galt
     bis zur Gegenlesung als Geheimfeld, weil „country_code" das Wortstück
     „code" enthält. Der Agent bekam dafür `feld_geheim` — eine Absage, die der
     Ausführer bei `select` nicht kannte und in „der Tab ist weg, versuch es
     nochmal" übersetzte. Der Mensch wurde für denselben aussichtslosen Versuch
     immer wieder um Freigabe gebeten. */
  const land = knoten("select", {
    attrs: { "aria-label": "Land", name: "country_code" },
    optionen: [option("Deutschland", "DE"), option("Österreich", "AT")],
  });
  const agb = knoten("input", {
    attrs: { type: "checkbox", "aria-label": "AGB gelesen" },
    type: "checkbox",
    checked: false,
  });
  const brief = knoten("input", {
    attrs: { type: "checkbox", "aria-label": "Newsletter" },
    type: "checkbox",
    checked: true,
  });
  const rechnung = knoten("input", {
    attrs: { type: "radio", "aria-label": "Auf Rechnung" },
    type: "radio",
    checked: false,
  });
  const suche = knoten("input", {
    attrs: { type: "text", "aria-label": "Produktsuche" },
    type: "text",
    value: "",
    form,
  });
  const weg = knoten("select", {
    attrs: { "aria-label": "Verschwunden" },
    optionen: [option("A"), option("B")],
  });
  /* Wird erst NACH der Wahrnehmung unsichtbar — genau so, wie es auf einer
     echten Seite passiert. */
  const versteckt = knoten("select", {
    attrs: { "aria-label": "Unsichtbar" },
    optionen: [option("A"), option("B")],
  });

  const alle = [versand, farbe, monat, land, agb, brief, rechnung, suche, weg, versteckt];
  return { form, versand, farbe, monat, land, agb, brief, rechnung, suche, weg, versteckt, alle };
}

/* Referenzen werden nach Namen gesucht, nicht abgezählt — sonst prüft die
   Prüfung die Reihenfolge der Attrappe statt das Verhalten. */
const refVon = (baum, name) => (baum.knoten.find((k) => k.name === name) || {}).ref;

/* Die Mitte eines Knotens — der Punkt, an dem geklickt und nachgesehen wird. */
const mitteVon = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/* ------------------------------------------------------------------ *
 * Echte Feldnamen aus dem Alltag — Bank, Bezahlseite, Anmeldung.
 *
 * Befund S5: Die alte Erkennung kannte nur eine Handvoll Wortstücke und
 * prüfte nur name/id/autocomplete als eine Zeichenkette. PIN, TAN und die
 * standardisierten Karten-Marken (cc-number, cc-csc, cc-exp) fielen glatt
 * durch — der Inhalt wurde ausgelesen, und seit der Bedienstufe wurde auch
 * hineingetippt.
 *
 * Jede Zeile ist ein Feld, wie es auf deutschen Seiten wirklich vorkommt.
 * Die Beschriftung ist absichtlich nichtssagend ("Eingabe"), damit die Zeile
 * genau das prüft, was in ihren Merkmalen steht — außer in der einen Zeile,
 * in der die Beschriftung selbst der einzige Hinweis ist.
 * ------------------------------------------------------------------ */

const GEHEIME_FELDER = [
  ["Anmeldung: Passwortfeld", { type: "password", name: "password" }],
  ["Anmeldung: Kennwort auf Deutsch", { type: "text", name: "kennwort" }],
  ["Anmeldung: neues Kennwort über die Marke", { type: "text", name: "np", autocomplete: "new-password" }],
  ["Anmeldung: altes Kennwort über die Marke", { type: "text", name: "ap", autocomplete: "current-password" }],
  ["Bank: Geheimzahl", { type: "text", name: "geheimzahl" }],
  ["Bank: PIN", { type: "text", name: "pin" }],
  ["Bank: TAN", { type: "text", name: "tan" }],
  ["Bank: iTAN im Kennzeichen", { type: "text", id: "itan" }],
  ["Bank: TAN in Schlangenschrift", { type: "text", name: "sms_tan" }],
  ["Bezahlseite: Kartennummer über die Marke", { type: "text", name: "num", autocomplete: "cc-number" }],
  ["Bezahlseite: Prüfziffer über die Marke", { type: "text", name: "sec", autocomplete: "cc-csc" }],
  ["Bezahlseite: Ablauf über die Marke", { type: "text", name: "ex", autocomplete: "cc-exp" }],
  ["Bezahlseite: Ablaufmonat über die Marke", { type: "text", name: "exm", autocomplete: "shipping cc-exp-month" }],
  ["Bezahlseite: Kartennummer im Namen", { type: "text", name: "cardNumber" }],
  ["Bezahlseite: Kartennummer auf Deutsch", { type: "text", name: "kartennummer" }],
  ["Bezahlseite: Prüfziffer auf Deutsch", { type: "text", name: "pruefziffer" }],
  ["Bezahlseite: Sicherheitscode", { type: "text", name: "sicherheitscode" }],
  ["Zwei Faktoren: Einmalcode über die Marke", { type: "text", name: "otc", autocomplete: "one-time-code" }],
  ["Zwei Faktoren: nur beschriftet", { type: "text", id: "feld7" }, "Geheimzahl"],
  /* Befund M2: „code" wird nicht mehr blind als Wortstück verurteilt, sondern
     über seinen Nachbarn entschieden. Diese Zeilen halten fest, welche echten
     Feldnamen dabei geheim BLEIBEN müssen — der nackte „code" einer
     Zwei-Faktoren-Seite ebenso wie der Sortierschlüssel einer britischen Bank. */
  ["Zwei Faktoren: das Feld heißt schlicht code", { type: "text", name: "code" }],
  ["Zwei Faktoren: Bestätigungscode", { type: "text", name: "verificationCode" }],
  ["Zwei Faktoren: Code per SMS", { type: "text", name: "sms_code" }],
  ["Zwei Faktoren: Wiederherstellungscode", { type: "text", name: "recovery_code" }],
  ["Bezahlseite: Sicherheitscode englisch", { type: "text", name: "security_code" }],
  ["Bank: Sortierschlüssel (UK)", { type: "text", name: "sortCode" }],
  ["Anmeldung: Zugangscode", { type: "text", name: "zugangscode" }],
  /* Der harmlose Nachbar entschärft nur das „code" NEBEN sich. Steht der
     eigentliche Code an einem anderen Wort, bleibt das Feld geheim. */
  ["Zwei Faktoren: Code zur Telefonnummer", { type: "text", name: "phone_verification_code" }],
  /* Zwei Entscheidungen gegen die Bequemlichkeit: „phone_code" ist mindestens so
     oft der Code aus der SMS wie die Ländervorwahl, und ein Einladungscode ist
     eine Eintrittskarte. Beide bleiben geheim. */
  ["Zwei Faktoren: Code ans Telefon", { type: "text", name: "phone_code" }],
  ["Anmeldung: Einladungscode", { type: "text", name: "invite_code" }],
  /* Der harmlose Nachbar zählt nur AN der Fuge, nicht irgendwo im Feldnamen:
     „product" macht den Artikelcode harmlos, den Aktivierungsschlüssel daneben
     aber nicht — der ist bezahlte Ware. */
  ["Software: Produkt-Aktivierungscode", { type: "text", name: "product_activation_code" }],
];

/* Die Gegenprobe. Diese Felder MÜSSEN lesbar bleiben — eine Erkennung, die
   alles für geheim hält, ist keine Erkennung, sondern eine Abschaltung. */
const OFFENE_FELDER = [
  ["Suche", { type: "text", name: "suche" }],
  ["E-Mail", { type: "text", name: "email", autocomplete: "email" }],
  ["Lieferadresse", { type: "text", name: "shipping_street", autocomplete: "address-line1" }],
  ["Standort", { type: "text", name: "standort" }],
  ["Menge", { type: "text", name: "menge" }],
  ["Vorname", { type: "text", name: "vorname", autocomplete: "given-name" }],
  ["Firma", { type: "text", name: "instanz" }],
  /* Zwei harmlose Beschriftungen, die aneinandergehängt „pass" ergäben. Jedes
     Merkmal wird für sich geprüft, sonst wäre das hier ein Geheimfeld. */
  ["Alp", { type: "text", name: "berg", title: "Assistent" }],
  /* Befund M2: Das Wortstück „code" hat mehr falsche Freunde als richtige. Jede
     dieser Zeilen ist ein Feldname, wie ihn Bestellseiten wirklich schreiben —
     und jede einzelne galt vor der Gegenlesung als Geheimnis. Der Agent konnte
     die Postleitzahl einer Bestellung weder lesen noch ausfüllen. */
  ["Postleitzahl", { type: "text", name: "postcode" }],
  ["Postleitzahl mit Fuge", { type: "text", name: "post_code" }],
  ["postal code", { type: "text", name: "postalCode", autocomplete: "postal-code" }],
  ["zip code", { type: "text", name: "zipcode" }],
  ["Länderwahl", { type: "text", name: "country_code" }],
  ["Telefonvorwahl", { type: "text", name: "areaCode" }],
  ["Gutscheincode", { type: "text", name: "promo_code" }],
  ["Rabattcode auf Deutsch", { type: "text", name: "gutscheincode" }],
  ["Sprachkennung", { type: "text", id: "langcode" }],
  ["Währungskennung", { type: "text", name: "currency_code" }],
  /* Auch andersherum: der harmlose Nachbar darf vor dem „code" stehen oder
     dahinter, mit Fuge, ohne Fuge und in Schlangenschrift. */
  ["Bestellung: Länderkennung der Telefonnummer", { type: "text", name: "phone_country_code" }],
];

function feldBauen(attrs, etikett = "Eingabe", wert = "GEHEIM-4711") {
  return knoten("input", {
    attrs: { "aria-label": etikett, ...attrs },
    value: wert,
  });
}

/* ------------------------------------------------------------------ *
 * Prüfungen
 * ------------------------------------------------------------------ */

test("S5: Der Inhalt echter Geheimfelder verlässt die Seite nie", async () => {
  for (const [was, attrs, etikett] of GEHEIME_FELDER) {
    const { fragen } = await overlayStarten([feldBauen(attrs, etikett)]);
    const a = fragen({ typ: "overlay:baum" });
    const feld = a.knoten.find((k) => k.art === "element");
    assert.ok(feld, `${was}: das Feld muss im Baum stehen`);
    assert.equal(feld.wert, null, `${was}: der Inhalt darf nie herausgehen`);
    assert.ok(
      !JSON.stringify(a).includes("GEHEIM-4711"),
      `${was}: der Inhalt steht auch sonst nirgends im Rahmen`
    );
  }
});

test("S5: In ein echtes Geheimfeld wird nie getippt", async () => {
  for (const [was, attrs, etikett] of GEHEIME_FELDER) {
    const { fragen } = await overlayStarten([feldBauen(attrs, etikett)]);
    const a = fragen({ typ: "overlay:baum" });
    const t = fragen({ typ: "overlay:tippen", ref: "e1", epoche: a.epoche, text: "1234" });
    assert.deepEqual(t, { ok: false, fehler: "feld_geheim" }, was);
  }
});

test("S5: Gewöhnliche Felder bleiben lesbar", async () => {
  for (const [was, attrs] of OFFENE_FELDER) {
    const { fragen } = await overlayStarten([feldBauen(attrs, was, "Freitext-42")]);
    const a = fragen({ typ: "overlay:baum" });
    const feld = a.knoten.find((k) => k.art === "element");
    assert.ok(feld, `${was}: das Feld muss im Baum stehen`);
    assert.equal(feld.wert, "Freitext-42", `${was}: ein gewöhnliches Feld wird gelesen`);
  }
});

/* Befund M4(e): Von den sechs behaupteten Beschriftungsquellen wurde nur
   aria-label wirklich gefahren. title und placeholder waren ungeprüft;
   aria-labelledby, label[for] und das umschließende label waren mit der alten
   Attrappe gar nicht prüfbar, weil getElementById, querySelector und closest
   immer null lieferten. Jede Zeile hier ist eine Quelle — und jede einzelne
   entscheidet allein darüber, ob der Inhalt die Seite verlässt. */
const BESCHRIFTUNGSQUELLEN = [
  ["aria-label", { "aria-label": "Geheimzahl" }, [], undefined],
  ["title", { title: "Ihre PIN" }, [], undefined],
  ["placeholder", { placeholder: "Kartennummer" }, [], undefined],
  ["aria-labelledby", { "aria-labelledby": "b1" }, [etikett("Sicherheitscode", { id: "b1" })], undefined],
  ["label[for]", { id: "f1" }, [etikett("Einmalkennwort", { fuer: "f1" })], undefined],
  ["umschließendes label", {}, [], etikett("TAN aus der App")],
];

test("Geheim-Erkennung: jede der sechs Beschriftungsquellen trägt für sich allein", async () => {
  for (const [quelle, attrs, etiketten, um] of BESCHRIFTUNGSQUELLEN) {
    /* `alt` gibt dem Feld einen Namen im Baum, ohne selbst Beschriftung zu
       sein — sonst stünde das Feld der letzten Zeile mangels Namen gar nicht
       erst im Baum und die Prüfung liefe ins Leere. */
    const feld = knoten("input", {
      attrs: { alt: "Eingabe", type: "text", name: "feld", ...attrs },
      type: "text",
      value: "GEHEIM-4711",
      umLabel: um,
    });
    const { fragen } = await overlayStarten([feld], etiketten);
    const a = fragen({ typ: "overlay:baum" });
    const zeile = a.knoten.find((k) => k.art === "element");
    assert.ok(zeile, `${quelle}: das Feld muss im Baum stehen`);
    assert.equal(zeile.wert, null, `${quelle}: allein diese Quelle macht das Feld geheim`);
    assert.ok(!JSON.stringify(a).includes("GEHEIM-4711"), `${quelle}: und zwar überall`);
    assert.deepEqual(
      fragen({ typ: "overlay:tippen", ref: zeile.ref, epoche: a.epoche, text: "1234" }),
      { ok: false, fehler: "feld_geheim" },
      `${quelle}: und es wird auch nicht hineingetippt`
    );
  }
});

test("Geheim-Erkennung: dieselben sechs Quellen harmlos gefüllt lassen das Feld lesbar", async () => {
  /* Die Gegenprobe zur Zeile darüber: Wären die Quellen gar nicht angeschlossen,
     bliebe dieses Feld genauso lesbar — sie zeigt, dass oben die Beschriftung
     entschieden hat und nicht irgendetwas anderes am Feld. */
  const feld = knoten("input", {
    attrs: {
      alt: "Eingabe", type: "text", name: "feld",
      "aria-label": "Lieferadresse", title: "Straße und Hausnummer",
      placeholder: "Musterweg 3", "aria-labelledby": "b1", id: "f1",
    },
    type: "text",
    value: "Freitext-42",
    umLabel: etikett("Wohin sollen wir liefern?"),
  });
  const { fragen } = await overlayStarten(
    [feld],
    [etikett("Anschrift", { id: "b1" }), etikett("Zustellung", { fuer: "f1" })]
  );
  const a = fragen({ typ: "overlay:baum" });
  assert.equal(a.knoten.find((k) => k.art === "element").wert, "Freitext-42");
});

test("Der Textbaum trägt Bereiche, Elemente und Text — in dieser Ordnung", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const a = fragen({ typ: "overlay:baum" });

  assert.equal(a.ok, true);
  assert.match(a.epoche, /^s1\.[a-z0-9]{2,6}$/, "die Epoche trägt eine Marke dieses Dokuments");

  const arten = a.knoten.map((k) => k.art);
  assert.equal(arten[0], "bereich");
  assert.ok(arten.includes("element"));
  assert.ok(arten.includes("text"));

  const elemente = a.knoten.filter((k) => k.art === "element");
  assert.deepEqual(elemente.map((e) => e.ref), ["e1", "e2", "e3", "e4"]);
});

test("Der Inhalt eines Geheimfeldes verlässt die Seite nie", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const a = fragen({ typ: "overlay:baum" });

  const alsText = JSON.stringify(a);
  assert.ok(!alsText.includes("streng-geheim-123"), "das Passwort steht nirgends im Rahmen");

  const feld = a.knoten.find((k) => k.name === "Passwort");
  assert.ok(feld, "der NAME des Feldes darf bleiben — er sagt dem Agenten, was zu tun wäre");
  assert.equal(feld.wert, null);

  const gesucht = a.knoten.find((k) => k.name === "Produktsuche");
  assert.equal(gesucht.wert, "SSD 2TB", "ein gewöhnliches Feld wird gelesen");
});

test("Zustände kommen aus der geschlossenen Menge, Unsichtbares gar nicht", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const a = fragen({ typ: "overlay:baum" });

  const kasse = a.knoten.find((k) => k.name === "Zur Kasse");
  assert.ok(kasse.zustand.includes("disabled"));
  assert.equal(kasse.rolle, "button");

  assert.ok(!a.knoten.some((k) => k.name === "Versteckt"), "display:none wird nicht gemeldet");
});

test("Was weit außerhalb liegt, wird gezählt statt geliefert", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);

  const eng = fragen({ typ: "overlay:baum" });
  assert.ok(!eng.knoten.some((k) => k.name === "Impressum"));
  assert.equal(eng.ausgelassen.ausserhalb, 1, "die Auslassung wird benannt, nicht verschwiegen");

  const weit = fragen({ typ: "overlay:baum", offscreen: true });
  assert.ok(weit.knoten.some((k) => k.name === "Impressum"));
});

test("Eine Referenz löst nur in ihrer eigenen Epoche auf", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const a = fragen({ typ: "overlay:baum" });

  const gut = fragen({ typ: "overlay:nachschlagen", ref: "e1", epoche: a.epoche });
  assert.equal(gut.ok, true);
  assert.equal(gut.name, "Startseite");
  assert.equal(gut.rolle, "link");
  /* Die Mitte wird aus dem Element gerechnet statt abgeschrieben: Seit die
     Attrappe am Punkt nachsieht, liegt jeder Knoten auf einem eigenen Platz,
     und eine abgeschriebene Zahl misst dann den Platz statt die Rechnung. */
  assert.deepEqual(gut.mitte, mitteVon(seite.start));

  const alt = fragen({ typ: "overlay:nachschlagen", ref: "e1", epoche: "s1.fremd" });
  assert.deepEqual(alt, { ok: false, fehler: "stale_ref" });

  const ohne = fragen({ typ: "overlay:nachschlagen", ref: "e1", epoche: null });
  assert.deepEqual(ohne, { ok: false, fehler: "stale_ref" });

  const nixda = fragen({ typ: "overlay:nachschlagen", ref: "e99", epoche: a.epoche });
  assert.deepEqual(nixda, { ok: false, fehler: "element_not_found" });
});

test("Ein verschwundenes Element wird nicht durch ein ähnliches ersetzt", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const a = fragen({ typ: "overlay:baum" });

  seite.start.isConnected = false;
  const weg = fragen({ typ: "overlay:nachschlagen", ref: "e1", epoche: a.epoche });
  assert.deepEqual(weg, { ok: false, fehler: "element_not_found" });
});

test("Nur die zwei jüngsten Wahrnehmungen bleiben stehen", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const eins = fragen({ typ: "overlay:baum" }).epoche;
  const zwei = fragen({ typ: "overlay:baum" }).epoche;
  assert.notEqual(eins, zwei, "jede Wahrnehmung ist eine eigene Epoche");
  assert.equal(fragen({ typ: "overlay:nachschlagen", ref: "e1", epoche: eins }).ok, true);

  const drei = fragen({ typ: "overlay:baum" }).epoche;
  assert.deepEqual(
    fragen({ typ: "overlay:nachschlagen", ref: "e1", epoche: eins }),
    { ok: false, fehler: "stale_ref" }
  );
  assert.equal(fragen({ typ: "overlay:nachschlagen", ref: "e1", epoche: drei }).ok, true);
});

test("Bildlauf bewegt den Ausschnitt und meldet, wie weit", async () => {
  const seite = seiteBauen();
  const { fragen, zustand } = await overlayStarten(seite.alle);

  const runter = fragen({ typ: "overlay:scrollen", richtung: "down", menge: "page" });
  assert.equal(runter.ok, true);
  assert.equal(runter.scrolledBy, 810, "eine Seite sind 90 Prozent der Fensterhöhe");
  assert.equal(runter.atTop, false);
  assert.equal(zustand.scrollY, 810);

  const halb = fragen({ typ: "overlay:scrollen", richtung: "down", menge: "half" });
  assert.equal(halb.scrolledBy, 450);

  const genau = fragen({ typ: "overlay:scrollen", richtung: "up", menge: 60 });
  assert.equal(genau.scrolledBy, -60);

  const gedeckelt = fragen({ typ: "overlay:scrollen", richtung: "down", menge: 999999 });
  assert.equal(gedeckelt.scrolledBy, 3000, "mehr als 3000 Pixel auf einmal gibt es nicht");

  const oben = fragen({ typ: "overlay:scrollen", richtung: "top" });
  assert.equal(oben.atTop, true);
  assert.equal(zustand.scrollY, 0);
});

test("Bildlauf zu einer alten Referenz führt nirgendwohin", async () => {
  const seite = seiteBauen();
  const { fragen, zustand } = await overlayStarten(seite.alle);
  fragen({ typ: "overlay:baum" });
  const a = fragen({ typ: "overlay:scrollen", ref: "e1", epoche: "s1.fremd" });
  assert.deepEqual(a, { ok: false, fehler: "stale_ref" });
  assert.equal(zustand.scrollY, 0);
});

test("Der Zustand meldet Lage und Größe, aber keinen Inhalt", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  fragen({ typ: "overlay:baum" });
  const z = fragen({ typ: "overlay:zustand" });

  assert.equal(z.ok, true);
  assert.equal(z.readyState, "complete");
  assert.equal(z.viewportHeight, 900);
  assert.equal(z.scrollHeight, 4000);
  assert.equal(z.atTop, true);
  assert.equal(z.elementCount, 4);
  assert.ok(!JSON.stringify(z).includes("Zur Kasse"), "im Zustand steht kein Seitentext");
});

/* ------------------------------------------------------------------ *
 * Auswählen
 * ------------------------------------------------------------------ */

test("Auswählen: eine Option über Etikett, Wert und Stelle", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });
  const ref = refVon(baum, "Versandart");

  const a = fragen({ typ: "overlay:auswaehlen", ref, epoche: baum.epoche, etikett: "Express" });
  assert.deepEqual(a, { ok: true, rolle: "combobox", name: "Versandart", gewaehlt: "Express" });
  assert.equal(seite.versand.selectedIndex, 0, "vor der Antwort passiert nichts an der Seite");
  await gleich();
  assert.equal(seite.versand.selectedIndex, 1);
  assert.deepEqual(
    seite.versand.__ereignisse.map((e) => e.typ),
    ["input", "change"],
    "input UND change — sonst sieht eine Seite mit eigenem Zustand die Auswahl nicht"
  );

  const b = fragen({ typ: "overlay:auswaehlen", ref, epoche: baum.epoche, wert: "std" });
  assert.equal(b.gewaehlt, "Standard", "der Wert der Seite zählt genauso wie das Etikett");
  await gleich();
  assert.equal(seite.versand.selectedIndex, 0);

  const c = fragen({ typ: "overlay:auswaehlen", ref, epoche: baum.epoche, index: 1 });
  assert.equal(c.gewaehlt, "Express");
});

test("Auswählen: was nicht eindeutig ist, wird nicht geraten", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });
  const farbe = refVon(baum, "Farbe");
  const versand = refVon(baum, "Versandart");
  const frage = (mehr) => fragen({ typ: "overlay:auswaehlen", ref: farbe, epoche: baum.epoche, ...mehr });

  assert.equal(frage({ etikett: "Rot" }).gewaehlt, "Rot", "der genaue Treffer geht vor");
  assert.equal(frage({ etikett: "rotbr" }).gewaehlt, "Rotbraun", "ein eindeutiger Teil genügt");
  assert.deepEqual(frage({ etikett: "rot" }).gewaehlt, "Rot");
  assert.deepEqual(
    frage({ etikett: "ro" }),
    { ok: false, fehler: "auswahl_nicht_gefunden" },
    "zwischen Rot und Rotbraun wird nicht geraten"
  );
  assert.deepEqual(frage({ etikett: "Türkis" }), { ok: false, fehler: "auswahl_nicht_gefunden" });
  assert.deepEqual(frage({}), { ok: false, fehler: "auswahl_nicht_gefunden" });

  const gesperrt = { typ: "overlay:auswaehlen", ref: versand, epoche: baum.epoche };
  assert.deepEqual(
    fragen({ ...gesperrt, etikett: "Nachtzustellung" }),
    { ok: false, fehler: "auswahl_nicht_gefunden" },
    "eine gesperrte Option ist keine Auswahl"
  );
  assert.deepEqual(fragen({ ...gesperrt, index: 2 }), { ok: false, fehler: "auswahl_nicht_gefunden" });
  assert.deepEqual(fragen({ ...gesperrt, index: 9 }), { ok: false, fehler: "auswahl_nicht_gefunden" });
});

test("Auswählen: Ankreuzfeld an, aus und schon-so", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });

  const an = fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "AGB gelesen"), epoche: baum.epoche });
  assert.deepEqual(an, { ok: true, rolle: "checkbox", name: "AGB gelesen", gewaehlt: "checked" });
  await gleich();
  assert.equal(seite.agb.checked, true);
  assert.equal(seite.agb.__klicks, 1, "angekreuzt wird über den Weg, den ein Mensch auch nimmt");

  const brief = refVon(baum, "Newsletter");
  const aus = fragen({ typ: "overlay:auswaehlen", ref: brief, epoche: baum.epoche, wert: "false" });
  assert.equal(aus.gewaehlt, "unchecked");
  await gleich();
  assert.equal(seite.brief.checked, false);
  assert.equal(seite.brief.__klicks, 1);

  const nochmal = fragen({ typ: "overlay:auswaehlen", ref: brief, epoche: baum.epoche, wert: "aus" });
  assert.equal(nochmal.gewaehlt, "unchecked");
  await gleich();
  assert.equal(seite.brief.__klicks, 1, "was schon so ist, wird nicht noch einmal geklickt");
});

test("Auswählen: ein Optionsfeld wählt man nicht ab", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });
  const ref = refVon(baum, "Auf Rechnung");

  assert.equal(fragen({ typ: "overlay:auswaehlen", ref, epoche: baum.epoche }).gewaehlt, "checked");
  await gleich();
  assert.equal(seite.rechnung.checked, true);

  assert.deepEqual(
    fragen({ typ: "overlay:auswaehlen", ref, epoche: baum.epoche, wert: "nein" }),
    { ok: false, fehler: "auswahl_nicht_gefunden" }
  );
});

/* Befund M4(a): Genau die Falle, von der der Bereich schreibt, er habe sie beim
   Gegenlesen geschlossen — und die trotzdem durch keine Prüfung gedeckt war.
   Zwischen Antwort und Setzen liegt ein Durchlauf der Warteschlange; baut die
   Seite in diesem Augenblick ihre Liste neu auf, steht die gemeinte Option
   nicht mehr an ihrer Stelle. `selectedIndex = -1` wählte dann ALLES ab. */
test("Auswählen: ändert sich die Liste zwischen Antwort und Setzen, wird die Option selbst gesetzt", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });

  const express = seite.versand.options[1];
  const a = fragen({
    typ: "overlay:auswaehlen", ref: refVon(baum, "Versandart"), epoche: baum.epoche, etikett: "Express",
  });
  assert.equal(a.gewaehlt, "Express");

  seite.versand.options = [option("Sofort", "now"), option("Abholung", "ab")];
  seite.versand.selectedIndex = 0;
  await gleich();

  assert.equal(express.selected, true, "die gemeinte Option wird selbst gesetzt");
  assert.equal(seite.versand.selectedIndex, 0, "und nicht die ganze Liste abgewählt");

  /* Dieselbe Klammer trägt die Mehrfachauswahl: Dort ist `selectedIndex` die
     falsche Schraube, weil sie die anderen Haken mitnähme. */
  seite.farbe.multiple = true;
  const b = fragen({
    typ: "overlay:auswaehlen", ref: refVon(baum, "Farbe"), epoche: baum.epoche, etikett: "Rotbraun",
  });
  assert.equal(b.gewaehlt, "Rotbraun");
  await gleich();
  assert.equal(seite.farbe.options[1].selected, true);
  assert.equal(seite.farbe.selectedIndex, 0, "bei mehrfacher Auswahl bleibt die Stelle unberührt");
});

/* Befund M4(e): Die Bedienseite baute ausschließlich native Felder — die als
   unterstützt gemeldeten ARIA-Bedienelemente waren damit ungeprüft. Auf einer
   Seite, die ihre Schalter aus divs baut, entscheidet allein `aria-checked`,
   ob schon geschaltet ist; `el.checked` gibt es dort nicht. */
test("Auswählen: die ARIA-Bedienelemente einer Seite ohne native Felder", async () => {
  const schalter = knoten("div", { attrs: { role: "switch", "aria-checked": "false", "aria-label": "Nachtmodus" } });
  const haken = knoten("div", { attrs: { role: "checkbox", "aria-checked": "true", "aria-label": "AGB gelesen" } });
  const wahl = knoten("div", { attrs: { role: "radio", "aria-checked": "true", "aria-label": "Auf Rechnung" } });
  const { fragen } = await overlayStarten([schalter, haken, wahl]);
  const baum = fragen({ typ: "overlay:baum" });

  const a = fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "Nachtmodus"), epoche: baum.epoche });
  assert.deepEqual(a, { ok: true, rolle: "switch", name: "Nachtmodus", gewaehlt: "checked" });
  await gleich();
  assert.equal(schalter.__klicks, 1, "geschaltet wird über den Weg, den ein Mensch auch nimmt");

  const b = fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "AGB gelesen"), epoche: baum.epoche });
  assert.deepEqual(b, { ok: true, rolle: "checkbox", name: "AGB gelesen", gewaehlt: "checked" });
  await gleich();
  assert.equal(haken.__klicks, 0, "was aria-checked schon meldet, wird nicht wieder ausgeklickt");

  assert.deepEqual(
    fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "Auf Rechnung"), epoche: baum.epoche, wert: "nein" }),
    { ok: false, fehler: "auswahl_nicht_gefunden" },
    "ein Optionsfeld wählt man auch als div nicht ab"
  );
  await gleich();
  assert.equal(wahl.__klicks, 0);
});

test("Auswählen: Geheimes und Nicht-Auswählbares werden benannt abgelehnt", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });

  assert.deepEqual(
    fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "Monat"), epoche: baum.epoche, index: 1 }),
    { ok: false, fehler: "feld_geheim" },
    "der Ablaufmonat einer Karte ist eine Liste — und trotzdem die Zahlung des Menschen"
  );
  assert.deepEqual(
    fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "Produktsuche"), epoche: baum.epoche, wert: "x" }),
    { ok: false, fehler: "kein_auswahlfeld" }
  );
  await gleich();
  assert.equal(seite.monat.__ereignisse.length, 0, "an einem Geheimfeld passiert auch später nichts");
});

/* Befund M1: Die Absage `feld_geheim` kannte der Ausführer bei `select` nicht —
   er machte daraus `tab_gone` („der Tab ist weg") mit retryable:true. Jeder
   falsch als geheim erkannte Auswahlkasten wurde damit zu einer Schleife: Der
   Agent versuchte es wieder, der Mensch wurde wieder gefragt, es scheiterte
   identisch. Die fehlende Zeile ist Sache des Ausführers; die Länderwahl, die
   überhaupt erst hineingeriet, ist Sache dieser Datei. */
test("Auswählen: die Länderwahl eines Bestellformulars ist keine Zahlung", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });

  const a = fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "Land"), epoche: baum.epoche, wert: "AT" });
  assert.deepEqual(a, { ok: true, rolle: "combobox", name: "Land", gewaehlt: "Österreich" });
  await gleich();
  assert.equal(seite.land.selectedIndex, 1);

  /* Die Gegenprobe steht direkt daneben: Der Ablaufmonat derselben Bestellung
     bleibt geheim. Die Lockerung gilt dem Nachbarn „country", nicht dem Wort
     „code". */
  assert.deepEqual(
    fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "Monat"), epoche: baum.epoche, index: 1 }),
    { ok: false, fehler: "feld_geheim" }
  );
});

test("Auswählen: alte Epoche, verschwundenes und unsichtbares Element", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });
  const ref = refVon(baum, "Versandart");

  assert.deepEqual(
    fragen({ typ: "overlay:auswaehlen", ref, epoche: "s1.fremd", index: 1 }),
    { ok: false, fehler: "stale_ref" }
  );
  assert.deepEqual(
    fragen({ typ: "overlay:auswaehlen", ref: "e99", epoche: baum.epoche, index: 1 }),
    { ok: false, fehler: "element_not_found" }
  );

  seite.weg.isConnected = false;
  assert.deepEqual(
    fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "Verschwunden"), epoche: baum.epoche, index: 1 }),
    { ok: false, fehler: "element_not_found" }
  );

  seite.versteckt.__versteckt = true;
  assert.deepEqual(
    fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "Unsichtbar"), epoche: baum.epoche, index: 1 }),
    { ok: false, fehler: "element_not_visible" }
  );

  await gleich();
  assert.equal(seite.versand.selectedIndex, 0, "keine Absage hat trotzdem etwas gesetzt");
});

/* ------------------------------------------------------------------ *
 * Tippen mit Absenden
 * ------------------------------------------------------------------ */

test("Tippen: absenden löst Enter aus — und zwar erst nach der Antwort", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });
  const ref = refVon(baum, "Produktsuche");

  const a = fragen({
    typ: "overlay:tippen", ref, epoche: baum.epoche, text: "Schuhe", absenden: true,
  });
  assert.deepEqual(a, {
    ok: true, rolle: "textbox", name: "Produktsuche", laenge: 6, abgesendet: true,
  });
  assert.equal(seite.suche.value, "Schuhe", "der Wert geht über den Setter des Prototyps");
  assert.deepEqual(
    seite.suche.__ereignisse.map((e) => e.typ),
    ["input", "change"],
    "das Absenden kommt NACH der Antwort — sonst stirbt es mit der Navigation"
  );
  assert.equal(seite.form.__abgeschickt, 0);

  await gleich();
  assert.deepEqual(seite.suche.__ereignisse.map((e) => e.typ), [
    "input", "change", "keydown", "keypress", "keyup",
  ]);
  assert.ok(
    seite.suche.__ereignisse.slice(-3).every((e) => e.taste === "Enter"),
    "und zwar die Eingabetaste"
  );
  assert.equal(seite.form.__abgeschickt, 1, "ein Formular wird zusätzlich abgeschickt");
});

test("Tippen: ohne absenden bleibt es beim Text", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });

  const a = fragen({
    typ: "overlay:tippen", ref: refVon(baum, "Produktsuche"), epoche: baum.epoche, text: "Socken",
  });
  assert.equal(a.abgesendet, false, "das Feld steht in JEDER Erfolgsantwort");
  await gleich();
  assert.deepEqual(seite.suche.__ereignisse.map((e) => e.typ), ["input", "change"]);
  assert.equal(seite.form.__abgeschickt, 0);
});

test("Tippen: alte Epoche, verschwundenes und unsichtbares Feld", async () => {
  const seite = bedienseiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });
  const ref = refVon(baum, "Produktsuche");
  const text = { text: "x", absenden: true };

  assert.deepEqual(
    fragen({ typ: "overlay:tippen", ref, epoche: "s1.fremd", ...text }),
    { ok: false, fehler: "stale_ref" }
  );
  assert.deepEqual(
    fragen({ typ: "overlay:tippen", ref: "e99", epoche: baum.epoche, ...text }),
    { ok: false, fehler: "element_not_found" }
  );

  seite.suche.__versteckt = true;
  assert.deepEqual(
    fragen({ typ: "overlay:tippen", ref, epoche: baum.epoche, ...text }),
    { ok: false, fehler: "element_not_visible" }
  );
  seite.suche.__versteckt = false;
  seite.suche.isConnected = false;
  assert.deepEqual(
    fragen({ typ: "overlay:tippen", ref, epoche: baum.epoche, ...text }),
    { ok: false, fehler: "element_not_found" }
  );

  await gleich();
  assert.equal(seite.form.__abgeschickt, 0, "keine Absage sendet trotzdem ab");
  assert.equal(seite.suche.__ereignisse.length, 0);
});

/* ------------------------------------------------------------------ *
 * Warten
 * ------------------------------------------------------------------ */

test("Warten: Text auf der Seite — da und nicht da", async () => {
  const seite = seiteBauen();
  const { fragenSpaeter, sandbox } = await overlayStarten(seite.alle);
  sandbox.document.body.innerText = "Ihre Bestellung ist eingegangen";

  const da = await fragenSpaeter({
    typ: "overlay:warten", bedingung: "textPresent", wert: "bestellung ist eingegangen", fristMs: 3000,
  });
  assert.equal(da.ok, true);
  assert.equal(da.erfuellt, true);
  assert.ok(da.wartezeitMs < 800, "was schon da ist, wird nicht abgewartet");

  const nicht = await fragenSpaeter({
    typ: "overlay:warten", bedingung: "textPresent", wert: "Versandbestätigung", fristMs: 300,
  });
  assert.equal(nicht.ok, true, "eine abgelaufene Frist ist kein Fehler, sondern ein Ergebnis");
  assert.equal(nicht.erfuellt, false);
  assert.ok(nicht.wartezeitMs >= 250, "und die Frist wurde wirklich abgewartet");
});

test("Warten: auf ein Element — verschwunden, sichtbar, unsichtbar", async () => {
  const seite = seiteBauen();
  const { fragen, fragenSpaeter } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });
  const warte = (mehr) =>
    fragenSpaeter({ typ: "overlay:warten", epoche: baum.epoche, fristMs: 300, ...mehr });

  assert.equal((await warte({ bedingung: "refVisible", wert: "e1" })).erfuellt, true);
  assert.equal((await warte({ bedingung: "refGone", wert: "e1" })).erfuellt, false);

  seite.start.isConnected = false;
  assert.equal((await warte({ bedingung: "refGone", wert: "e1" })).erfuellt, true);
  assert.equal((await warte({ bedingung: "refVisible", wert: "e1" })).erfuellt, false);

  seite.start.isConnected = true;
  seite.start.__versteckt = true;
  const unsichtbar = await warte({ bedingung: "refVisible", wert: "e1" });
  assert.equal(unsichtbar.ok, true);
  assert.equal(unsichtbar.erfuellt, false, "unsichtbar ist nicht sichtbar — aber auch kein Fehler");
});

test("Warten: fremde Epoche und erfundene Referenz sind Absagen", async () => {
  const seite = seiteBauen();
  const { fragen, fragenSpaeter } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });

  assert.deepEqual(
    await fragenSpaeter({ typ: "overlay:warten", bedingung: "refGone", wert: "e1", epoche: "s1.fremd", fristMs: 300 }),
    { ok: false, fehler: "stale_ref" }
  );
  assert.deepEqual(
    await fragenSpaeter({ typ: "overlay:warten", bedingung: "refVisible", wert: "e99", epoche: baum.epoche, fristMs: 300 }),
    { ok: false, fehler: "element_not_found" },
    "eine Referenz, die es nie gab, gilt nicht als verschwunden"
  );
  assert.deepEqual(
    await fragenSpaeter({ typ: "overlay:warten", bedingung: "irgendwas", fristMs: 300 }),
    { ok: false, fehler: "unbekannte_bedingung" }
  );
  assert.deepEqual(
    await fragenSpaeter({ typ: "overlay:warten", bedingung: "textPresent", fristMs: 300 }),
    { ok: false, fehler: "wert_fehlt" }
  );
});

test("Warten: die Adresse der Seite", async () => {
  const seite = seiteBauen();
  const { fragenSpaeter } = await overlayStarten(seite.alle);

  const a = await fragenSpaeter({ typ: "overlay:warten", bedingung: "urlMatches", wert: "/warenkorb", fristMs: 300 });
  assert.equal(a.erfuellt, true);
  const b = await fragenSpaeter({ typ: "overlay:warten", bedingung: "urlMatches", wert: "/kasse", fristMs: 300 });
  assert.equal(b.erfuellt, false);
});

test("Warten: Ruhe heißt keine Änderung mehr am Seitenbaum", async () => {
  const seite = seiteBauen();
  const { fragenSpaeter, zustand } = await overlayStarten(seite.alle);

  const laeuft = fragenSpaeter({ typ: "overlay:warten", bedingung: "idle", fristMs: 4000 });
  zustand.aendern();
  /* Die eigene Anzeige bewegt sich weiter — sie darf die Ruhe nicht verhindern. */
  const eigen = setInterval(() => zustand.aendern({ __eigen: true }), 100);
  const a = await laeuft;
  clearInterval(eigen);

  assert.equal(a.ok, true);
  assert.equal(a.erfuellt, true);
  assert.ok(a.wartezeitMs >= 600, "erst nach einer Ruhezeit gilt die Seite als ruhig");
});

/* Befund M3: Der Deckel lag bei 30 Sekunden — unterhalb dessen, was der Rahmen
   selbst anfordert. `waitFor` hat in befehle.js eine Frist von 60 Sekunden, und
   der Ausführer schickt daraus bis zu ~55 Sekunden an die Seite. Die Seite kappte
   das kommentarlos und meldete „ok, nicht erfüllt"; der Ausführer machte daraus
   „habe die volle Zeit gewartet" samt gedeckelt:false. Der Agent gab damit einen
   richtigen Plan auf, obwohl der Rahmen noch Zeit gehabt hätte. */
test("Warten: die Frist des Rahmens wird nicht heimlich gekürzt", async () => {
  const seite = seiteBauen();
  const { fragenSpaeter, sandbox } = await overlayStarten(seite.alle);
  const uhr = uhrEinbauen(sandbox);

  const laeuft = beobachten(
    fragenSpaeter({ typ: "overlay:warten", bedingung: "textPresent", wert: "kommt nie", fristMs: 45000 })
  );

  await uhr.vor(31000);
  assert.equal(laeuft.fertig, false, "bei einem 30-Sekunden-Deckel wäre hier schon Schluss");

  await uhr.vor(15000);
  assert.equal(laeuft.fertig, true, "die angeforderte Frist läuft ab, sie wird nicht überzogen");
  assert.equal(laeuft.wert.ok, true);
  assert.equal(laeuft.wert.erfuellt, false);
  assert.ok(laeuft.wert.wartezeitMs >= 45000, "die volle angeforderte Frist wurde abgewartet");
  assert.equal(laeuft.wert.fristMs, 45000, "die Antwort sagt, mit welcher Frist gewartet wurde");
  assert.equal(laeuft.wert.gedeckelt, false, "nichts gekürzt — und genau das steht auch da");
});

test("Warten: der eigene Deckel bleibt, aber er wird angesagt", async () => {
  const seite = seiteBauen();
  const { fragenSpaeter, sandbox } = await overlayStarten(seite.alle);
  const uhr = uhrEinbauen(sandbox);

  /* Ein Zeitgeber, der eine Stunde läuft, ist ein Leck — der Deckel bleibt. Er
     darf nur nicht mehr stumm sein: Wer mehr anfordert, als die Seite gibt,
     erfährt es in derselben Antwort. */
  const laeuft = beobachten(
    fragenSpaeter({ typ: "overlay:warten", bedingung: "textPresent", wert: "kommt nie", fristMs: 3600000 })
  );

  await uhr.vor(61000);
  assert.equal(laeuft.fertig, true, "der Deckel greift — nach einer Stunde wartet hier niemand");
  assert.equal(laeuft.wert.erfuellt, false);
  assert.equal(laeuft.wert.gedeckelt, true, "eine Kürzung wird gemeldet, nicht verschwiegen");
  assert.equal(laeuft.wert.fristMs, 60000);
  assert.ok(laeuft.wert.wartezeitMs < 62000, "und zwar wirklich gekürzt, nicht nur gemeldet");
});

test("Warten: eine Seite, die nie zur Ruhe kommt, meldet das", async () => {
  const seite = seiteBauen();
  const { fragenSpaeter, zustand } = await overlayStarten(seite.alle);

  const laeuft = fragenSpaeter({ typ: "overlay:warten", bedingung: "idle", fristMs: 900 });
  const unruhe = setInterval(() => zustand.aendern(), 100);
  const a = await laeuft;
  clearInterval(unruhe);

  assert.equal(a.ok, true);
  assert.equal(a.erfuellt, false);
});

/* ------------------------------------------------------------------ *
 * Auslesen
 * ------------------------------------------------------------------ */

/* Befund M4(d): Ohne MutationObserver ist Ruhe nicht messbar — und geraten
   wird hier nicht. Die Zusicherung stand im Bericht, gedeckt war sie nicht. */
test("Warten: ohne Beobachter wird Ruhe nicht geraten, sondern abgesagt", async () => {
  const seite = seiteBauen();
  const { fragenSpaeter, sandbox } = await overlayStarten(seite.alle);
  sandbox.MutationObserver = undefined;

  assert.deepEqual(
    await fragenSpaeter({ typ: "overlay:warten", bedingung: "idle", fristMs: 300 }),
    { ok: false, fehler: "ruhe_nicht_messbar" },
    "keine erfüllte Ruhe ohne Beobachter — und auch kein stiller Fristablauf"
  );
});

/* Befund M4(b): „antwortet garantiert genau einmal" war unbewiesen. Der Fall,
   in dem es darauf ankommt: Chrome wirft beim Antworten, weil der Kanal schon
   zu ist. Der Wurf landet im catch des Hörers — und ohne die einmal-Klammer
   antwortet der ein zweites Mal auf denselben Kanal. */
test("Warten antwortet genau einmal — auch wenn der Kanal beim Antworten wirft", async () => {
  const seite = seiteBauen();
  const { sandbox } = await overlayStarten(seite.alle);
  const hoerer = sandbox.chrome.runtime.__hoerer;
  let rufe = 0;

  try {
    hoerer(
      { typ: "overlay:warten", bedingung: "urlMatches", wert: "/warenkorb", fristMs: 300 },
      null,
      () => {
        rufe += 1;
        throw new Error("Chrome: der Kanal ist geschlossen");
      }
    );
  } catch (_) {
    /* Hier käme der Wurf des zweiten Rufes an. */
  }

  assert.equal(rufe, 1, "ein zweiter Ruf auf antwort ist in Chrome ein Fehler und in der Wirkung Stille");
});

test("Auslesen: genannte Referenzen — mit Namen, ohne Geheimnisse", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });

  const a = fragen({ typ: "overlay:auslesen", refs: ["e3", "e1"], epoche: baum.epoche });
  assert.equal(a.ok, true);
  assert.deepEqual(a.treffer, [
    { ref: "e3", rolle: "textbox", name: "Produktsuche", wert: "SSD 2TB" },
    { ref: "e1", rolle: "link", name: "Startseite", wert: null },
  ]);

  const geheim = fragen({ typ: "overlay:auslesen", refs: ["e2"], epoche: baum.epoche });
  assert.deepEqual(geheim.treffer, [
    { ref: "e2", rolle: "textbox", name: "Passwort", wert: null },
  ]);
  assert.ok(!JSON.stringify(geheim).includes("streng-geheim-123"));
});

test("Auslesen: ein Bereich und einzelne Felder", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });

  const bereich = fragen({ typ: "overlay:auslesen", region: "nav", epoche: baum.epoche });
  assert.equal(bereich.ok, true);
  assert.deepEqual(bereich.treffer.map((t) => t.ref), ["e1", "e2", "e3", "e4"]);

  const etikett = fragen({ typ: "overlay:auslesen", region: "Hauptmenü", epoche: baum.epoche });
  assert.deepEqual(etikett.treffer.map((t) => t.name), bereich.treffer.map((t) => t.name));

  const felder = fragen({ typ: "overlay:auslesen", felder: ["produktsuche"], epoche: baum.epoche });
  assert.deepEqual(felder.treffer, [
    { ref: "e3", rolle: "textbox", name: "Produktsuche", wert: "SSD 2TB" },
  ]);

  const beides = fragen({
    typ: "overlay:auslesen", region: "nav", felder: ["kasse"], epoche: baum.epoche,
  });
  assert.deepEqual(beides.treffer.map((t) => t.name), ["Zur Kasse"]);

  assert.deepEqual(
    fragen({ typ: "overlay:auslesen", region: "dialog", epoche: baum.epoche }),
    { ok: false, fehler: "bereich_nicht_gefunden" }
  );
  assert.deepEqual(
    fragen({ typ: "overlay:auslesen", epoche: baum.epoche }),
    { ok: false, fehler: "nichts_angefragt" },
    "auslesen ist gezielt — alles auf einmal gibt es über den Baum"
  );
});

test("Auslesen: alte Epoche, verschwundenes und unsichtbares Element", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });

  assert.deepEqual(
    fragen({ typ: "overlay:auslesen", refs: ["e1"], epoche: "s1.fremd" }),
    { ok: false, fehler: "stale_ref" }
  );
  assert.deepEqual(
    fragen({ typ: "overlay:auslesen", refs: ["e1"], epoche: null }),
    { ok: false, fehler: "stale_ref" }
  );
  assert.deepEqual(
    fragen({ typ: "overlay:auslesen", refs: ["e99"], epoche: baum.epoche }),
    { ok: false, fehler: "element_not_found" }
  );

  seite.start.isConnected = false;
  assert.deepEqual(
    fragen({ typ: "overlay:auslesen", refs: ["e3", "e1"], epoche: baum.epoche }),
    { ok: false, fehler: "element_not_found" },
    "eine halbe Antwort auf eine genannte Referenz wäre eine halbe Wahrheit"
  );

  seite.start.isConnected = true;
  seite.suche.__versteckt = true;
  assert.deepEqual(
    fragen({ typ: "overlay:auslesen", refs: ["e3"], epoche: baum.epoche }),
    { ok: false, fehler: "element_not_visible" }
  );
  const bereich = fragen({ typ: "overlay:auslesen", region: "nav", epoche: baum.epoche });
  assert.deepEqual(
    bereich.treffer.map((t) => t.ref),
    ["e1", "e2", "e4"],
    "im Bereich wird Unsichtbares übergangen, nicht erfunden"
  );
});

test("Jede Nachricht bekommt eine Antwort — auch eine unbekannte", async () => {
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  for (const typ of [
    "overlay:ping", "overlay:baum", "overlay:zustand", "overlay:scrollen",
    "overlay:nachschlagen", "overlay:an", "overlay:aus", "overlay:gestoppt",
    "overlay:gross", "overlay:zeiger", "overlay:lesen", "overlay:klicken",
    "overlay:tippen", "overlay:auswaehlen", "overlay:auslesen", "voellig:unbekannt",
  ]) {
    const a = fragen({ typ });
    assert.equal(typeof a.ok, "boolean", `${typ} antwortet nicht verwertbar`);
  }
});

/* ------------------------------------------------------------------ *
 * Offene Schattenbäume
 *
 * Viele deutsche Zustimmungsbanner (Usercentrics u. a.) und Web-Components
 * rendern in einer OFFENEN Schatten-Wurzel. Mit dem alten Stand
 * (document.querySelectorAll allein) waren sie unsichtbar — weder lesbar
 * noch klickbar, und „akzeptiere das Banner und such X" scheiterte am
 * ersten Schritt. Die Schatten-Wurzel ist hier ein handgebautes Objekt mit
 * eigenem querySelectorAll, genau wie der Rest der Attrappe.
 * ------------------------------------------------------------------ */

/* Eine offene Schatten-Wurzel der Attrappe: liefert ihre Kinder — wie der
   document-Stumpf oben ohne Selektorauswertung, die Filter macht overlay.js.
   Sie kann seit dem 14.08.2026 auch am Punkt nachsehen: `elementFromPoint`
   bleibt im Browser an jeder Schattengrenze am Wirt stehen, und die Wache
   steigt genau deshalb Wurzel für Wurzel ab. Eine Attrappe ohne diese Stufe
   würde den Abstieg ungeprüft lassen — und damit die Zustimmungsbanner, für
   die er überhaupt gebaut wurde. */
const schattenWurzel = (kinder) => ({
  querySelectorAll: () => kinder,
  elementFromPoint: (x, y) => trefferAmPunkt(kinder, x, y),
});

test("Wahrnehmung: das Zustimmungsbanner im offenen Schattenbaum wird gesehen und bedienbar", async () => {
  const seite = seiteBauen();
  /* Die Rechtecke stehen hier ausdrücklich da: Ein Schattenkind liegt IM Kasten
     seines Wirts, sonst gäbe der Browser am Punkt des Knopfes gar nicht erst
     den Wirt zurück und der Abstieg fände nie statt. */
  const knopf = knoten("button", {
    text: "Alle akzeptieren",
    rect: { left: 700, top: 100, width: 200, height: 40 },
  });
  /* Ein Schatten im Schatten — Usercentrics verschachtelt seine Bausteine. */
  const tief = knoten("button", {
    text: "Auswahl speichern",
    rect: { left: 700, top: 160, width: 200, height: 40 },
  });
  const innererWirt = knoten("div", { rect: { left: 700, top: 160, width: 200, height: 40 } });
  innererWirt.shadowRoot = schattenWurzel([tief]);
  const banner = knoten("div", { rect: { left: 680, top: 80, width: 240, height: 140 } });
  banner.shadowRoot = schattenWurzel([knopf, innererWirt]);

  const { fragen } = await overlayStarten([...seite.alle, banner]);
  const baum = fragen({ typ: "overlay:baum" });
  assert.equal(baum.ok, true);
  const ref = refVon(baum, "Alle akzeptieren");
  assert.ok(ref, "der Knopf aus dem offenen Schattenbaum steht im Baum");
  assert.ok(refVon(baum, "Auswahl speichern"), "auch ein Schatten im Schatten wird betreten");
  assert.ok(refVon(baum, "Startseite"), "und das Dokument selbst bleibt vollständig");

  /* Gesehen ist die Hälfte — die Referenz muss auch auflösen und klicken. */
  const k = fragen({ typ: "overlay:klicken", ref, epoche: baum.epoche });
  assert.equal(k.ok, true);
  assert.equal(k.name, "Alle akzeptieren");
  await gleich();
  assert.equal(knopf.__klicks, 1, "der Klick kommt im Schattenbaum an");

  /* Auch das schnelle Lesen (overlay:lesen) sieht in den Schatten. */
  const lesen = fragen({ typ: "overlay:lesen" });
  assert.ok(
    lesen.elemente.some((e) => e.name === "Alle akzeptieren"),
    "seiteLesen sammelt ebenfalls über die Schattengrenze"
  );
});

test("Sichtbarkeit: der Klick löst die volle Ereigniskette aus, nicht nur click()", async () => {
  /* Moderne Bedienelemente hören auf pointerdown/mousedown, nicht auf das
     schlichte click. Rückbau von echterKlick auf focus()+click() würde diesen
     Prüfsatz rot färben (die Kette fehlte dann). */
  const seite = seiteBauen();
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });
  const ref = refVon(baum, "Startseite");
  assert.ok(ref, "der Link steht im Baum");
  const k = fragen({ typ: "overlay:klicken", ref, epoche: baum.epoche });
  assert.equal(k.ok, true);
  await gleich();
  const typen = seite.start.__ereignisse.map((e) => e.typ);
  assert.ok(typen.includes("pointerdown"), "pointerdown wird ausgelöst");
  assert.ok(typen.includes("mousedown"), "mousedown wird ausgelöst");
  assert.ok(typen.indexOf("pointerdown") < typen.indexOf("mousedown"),
    "pointerdown kommt vor mousedown, wie bei einem echten Klick");
  assert.equal(seite.start.__klicks, 1, "am Ende steht weiterhin ein echter click");
});

test("Sichtbarkeit: overlay:an setzt das Titel-Präfix, overlay:aus stellt den Titel wieder her", async () => {
  const seite = seiteBauen();
  const { fragen, sandbox } = await overlayStarten(seite.alle);
  const vorher = sandbox.document.title;
  fragen({ typ: "overlay:an", gross: false, text: "SMarTrAgent steuert diesen Tab" });
  assert.ok(sandbox.document.title.startsWith("🐇▶ "),
    "der gesteuerte Tab trägt das Präfix, auch im Hintergrund erkennbar");
  assert.ok(sandbox.document.title.includes(vorher), "der ursprüngliche Titel bleibt dahinter");
  fragen({ typ: "overlay:aus" });
  assert.equal(sandbox.document.title, vorher, "nach dem Ende ist der Titel wieder wie zuvor");
});

test("Wahrnehmung: shadowRoot null (geschlossen oder keiner) wirft nicht und bleibt normal", async () => {
  const seite = seiteBauen();
  /* Genau das liefert der Browser bei mode:closed — und bei jedem Element
     ohne Schatten sowieso: null bzw. undefined. Beides darf weder werfen
     noch das Element aus der Wahrnehmung kippen. */
  seite.kasse.shadowRoot = null;
  const { fragen } = await overlayStarten(seite.alle);
  const baum = fragen({ typ: "overlay:baum" });
  assert.equal(baum.ok, true, "ein geschlossener Schatten ist kein Fehler");
  assert.ok(
    baum.knoten.some((k) => k.name === "Zur Kasse"),
    "das Wirt-Element selbst bleibt normal im Baum"
  );
  assert.ok(baum.knoten.some((k) => k.name === "Startseite"));
});

test("Wahrnehmung: der Abtast-Deckel hält auch einen endlosen Schattenbaum an", { timeout: 8000 }, async () => {
  /* Ein Wirt, der in seinem eigenen Schatten liegt — im echten DOM unmöglich,
     als Attrappe der härteste Fall: Ohne den Deckel (Vierfaches der
     ABTASTGRENZE) liefe das Einsammeln hier endlos. */
  const wirt = knoten("div", {});
  wirt.shadowRoot = schattenWurzel([wirt]);
  const { fragen } = await overlayStarten([wirt]);
  const baum = fragen({ typ: "overlay:baum" });
  assert.equal(baum.ok, true, "der Deckel beendet das Einsammeln, statt die Seite anzuhalten");
});

test("Auch der wartende Weg bleibt nie stumm", async () => {
  const seite = seiteBauen();
  const { fragenSpaeter } = await overlayStarten(seite.alle);
  /* Ohne alles: Der Weg muss trotzdem antworten — hier mit einer Absage. */
  const a = await fragenSpaeter({ typ: "overlay:warten" });
  assert.equal(typeof a.ok, "boolean");
  const b = await fragenSpaeter({ typ: "overlay:warten", bedingung: "idle", fristMs: 200 });
  assert.equal(typeof b.ok, "boolean");
});

/* ------------------------------------------------------------------ *
 * Abwehr des Seiten-CSS am Wirt-Knoten
 *
 * Im echten Chrome gemessen: Ein `#smartrchrome-host{display:none!important}`
 * oder schlicht ein `*{display:none!important}` im Stylesheet der Seite
 * schaltete den grünen Rahmen, das Schild und den Agentenzeiger vollständig
 * ab — der Agent bediente unverändert weiter, nur eben unsichtbar. Damit fiel
 * genau die Zusage, für die es das Overlay überhaupt gibt.
 *
 * Die Gegenwehr ist ein Inline-Stil, in dem JEDE Deklaration !important trägt:
 * die steht in der Autoren-Kaskade über jeder Regel eines Seiten-Stylesheets,
 * auch über deren !important. Zwei Dinge müssen dafür stimmen, und beide
 * werden hier einzeln gemessen — eine Textsuche nach dem Wort „important"
 * bliebe grün, sobald auch nur eine Zeile es verlöre:
 *
 *   1. Keine Deklaration ohne !important. Eine einzige schwache genügt.
 *   2. display, visibility und opacity müssen ÜBERHAUPT dastehen. Was nicht
 *      deklariert ist, kann auch nicht mit !important gewinnen — gegen
 *      `*{display:none!important}` hilft nur ein eigenes display.
 *
 * Die Nachbildung kennt kein Layout und keine Kaskade, deshalb wird der
 * Inline-Stil selbst gelesen, aber Deklaration für Deklaration.
 * ------------------------------------------------------------------ */

/* Der höchste Wert, den z-index in Chrome annimmt (2^31 - 1). Darüber liegt
   nichts mehr, was eine Seite auf sich stapeln könnte. */
const HOECHSTE_EBENE = "2147483647";

/* Den Wirt aus dem holen, was das Skript in die Seite gehängt hat. Absichtlich
   über den angehängten Knoten und nicht über die Reihenfolge der Erzeugung:
   Ein Stil, der nur an einem nie eingehängten Knoten hinge, wäre wertlos. */
function wirtHolen(zustand) {
  const wirt = zustand.angehaengt.find((n) => n && n.id === "smartrchrome-host");
  assert.ok(wirt, "der Wirt #smartrchrome-host muss in die Seite gehängt werden");
  return wirt;
}

/* Einen Inline-Stil in seine einzelnen Deklarationen zerlegen.
   Nur so ist „jede einzelne trägt !important" überhaupt eine Aussage: Ein
   indexOf("important") wäre schon bei einer einzigen wichtigen Zeile zufrieden
   und bliebe damit auch grün, wenn dreizehn andere schwach würden. */
function stilZerlegen(cssText) {
  return String(cssText || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((stueck) => {
      const trenn = stueck.indexOf(":");
      const eigenschaft = (trenn < 0 ? stueck : stueck.slice(0, trenn)).trim().toLowerCase();
      const rohwert = trenn < 0 ? "" : stueck.slice(trenn + 1).trim();
      return {
        roh: stueck,
        eigenschaft,
        wichtig: /!\s*important$/i.test(rohwert),
        wert: rohwert.replace(/!\s*important$/i, "").trim().toLowerCase(),
      };
    });
}

/* Den zerlegten Wirt-Stil eines frisch gestarteten Overlays holen. */
async function wirtStil() {
  const seite = seiteBauen();
  const { zustand } = await overlayStarten(seite.alle);
  return stilZerlegen(wirtHolen(zustand).style.cssText);
}

test("Abwehr: jede einzelne Deklaration am Wirt trägt !important", async () => {
  const stil = await wirtStil();

  /* Erst zählen, dann prüfen: Ein leerer oder auf zwei Zeilen zusammen-
     gestrichener Stil darf diesen Prüfsatz nicht dadurch bestehen, dass es
     nichts zu beanstanden gibt. */
  assert.ok(
    stil.length >= 10,
    `der Wirt muss sich mit einer vollständigen Liste wehren, gefunden: ${stil.length}`
  );

  /* Jede Zeile muss auch wirklich eine Deklaration sein — sonst hätte das
     Zerlegen danebengegriffen und die Zählung oben wäre wertlos. */
  const kaputt = stil.filter((d) => !d.eigenschaft || !d.wert).map((d) => d.roh);
  assert.deepEqual(kaputt, [], "jede Zeile muss Eigenschaft und Wert tragen");

  /* Der Kern: nicht „irgendwo steht important", sondern keine einzige Zeile
     ohne. Die Fehlermeldung nennt die schwachen Zeilen beim Namen. */
  const schwach = stil.filter((d) => !d.wichtig).map((d) => d.eigenschaft);
  assert.deepEqual(
    schwach,
    [],
    `ohne !important verliert diese Deklaration gegen das Seiten-CSS: ${schwach.join(", ")}`
  );
  assert.equal(
    stil.filter((d) => d.wichtig).length,
    stil.length,
    "die Zahl der wichtigen Deklarationen muss der Gesamtzahl entsprechen"
  );

  /* Doppelt gesetzte Eigenschaften wären ein stiller Widerspruch: Die zweite
     gewinnt, und welche das ist, sieht beim Lesen niemand. */
  const namen = stil.map((d) => d.eigenschaft);
  assert.equal(new Set(namen).size, namen.length, `doppelte Eigenschaft in: ${namen.join(", ")}`);
});

test("Abwehr: display, visibility und opacity stehen ausdrücklich am Wirt", async () => {
  const stil = await wirtStil();
  const karte = new Map(stil.map((d) => [d.eigenschaft, d]));

  /* Genau diese drei schalten das Overlay ab, wenn die Seite sie greift. Eine
     fehlende Angabe reicht: Gegen `*{display:none!important}` gewinnt nur ein
     eigenes display, ein nicht deklariertes kann nichts überstimmen. */
  for (const [eigenschaft, erwartet] of [
    ["display", "block"],
    ["visibility", "visible"],
    ["opacity", "1"],
  ]) {
    const d = karte.get(eigenschaft);
    assert.ok(
      d,
      `${eigenschaft} fehlt am Wirt — damit schaltet das Seiten-CSS das Overlay ab`
    );
    assert.equal(d.wert, erwartet, `${eigenschaft} muss ausdrücklich auf ${erwartet} stehen`);
    assert.equal(d.wichtig, true, `${eigenschaft} ohne !important verliert gegen das Seiten-CSS`);
  }
});

test("Abwehr: der Wirt liegt fixiert und auf der höchsten Ebene", async () => {
  const stil = await wirtStil();
  const karte = new Map(stil.map((d) => [d.eigenschaft, d]));

  const lage = karte.get("position");
  assert.ok(lage, "position fehlt am Wirt");
  assert.equal(lage.wert, "fixed", "der Wirt muss am Sichtfenster hängen, nicht am Seitenfluss");
  assert.equal(lage.wichtig, true, "position ohne !important kann die Seite verschieben");

  const ebene = karte.get("z-index");
  assert.ok(ebene, "z-index fehlt am Wirt");
  assert.equal(
    ebene.wert,
    HOECHSTE_EBENE,
    "der Rahmen muss über allem liegen, sonst deckt ein Seitenelement ihn zu"
  );
  assert.equal(ebene.wichtig, true, "z-index ohne !important kann die Seite überstapeln");
});

/* ------------------------------------------------------------------ *
 * Der Wächter am Wirt
 *
 * Der Inline-Stil mit !important hält das CSS der Seite auf. Gegen ein SKRIPT
 * der Seite hilft er nicht: `document.getElementById("smartrchrome-host")
 * .remove()` nimmt den Knoten aus dem Baum, ein appendChild woanders
 * verschiebt ihn aus dem Sichtfenster, und `host.style.display = "none"`
 * überschreibt die Abwehr an genau der Stelle, an der sie steht. In allen drei
 * Fällen bediente der Agent bis 0.5.2 unverändert weiter, nur eben unsichtbar
 * — dasselbe gebrochene Versprechen wie beim CSS, nur eine Ebene tiefer.
 *
 * Die drei Fallen des Wächters werden hier einzeln gemessen: keine Schleife
 * mit sich selbst, keine teure Arbeit bei jeder Änderung, und kein endloser
 * Kampf gegen eine Seite, die es darauf anlegt.
 * ------------------------------------------------------------------ */

/* Der exakte Wortlaut, den der Mensch zu lesen bekommt. Beide Sätze stehen
   hier ausgeschrieben, damit eine stille Umformulierung auffällt: Sie sind das
   Einzige, woran ein Mensch merkt, dass die Sitzung vorbei ist. */
const ANGRIFF_SATZ =
  "Diese Seite entfernt das Sichtzeichen immer wieder, deshalb ist die Sitzung jetzt beendet.";
const KONTEXT_SATZ =
  "Die Verbindung zur Erweiterung ist weg, die Sitzung ist damit ohnehin beendet.";

/* Ein Teil der Anzeige aus dem, was das Skript gebaut hat. Über die Klasse
   und nicht über die Reihenfolge: Die Reihenfolge ist Sache von overlay.js. */
function teilHolen(zustand, klasse) {
  const el = zustand.erzeugt.find((n) => n && n.className === klasse);
  assert.ok(el, `das Overlay muss ein Element .${klasse} bauen`);
  return el;
}

const schildSatz = (zustand) => teilHolen(zustand, "schild").__text.textContent;

/* Was das Seitenskript an den Dienst gemeldet hat. Der Umweg über JSON ist
   nicht Zierde: Objekte aus dem Sandkasten stammen aus einer anderen Welt und
   sind für assert.deepEqual nie gleich, so gleich ihr Inhalt auch ist. Chrome
   kopiert jede Nachricht ohnehin genauso zwischen den Welten. */
const gesendet = (sandbox) =>
  JSON.parse(JSON.stringify(sandbox.chrome.runtime.__gesendet));

/* Ein laufendes Overlay mit Sitzung — erst ab `overlay:an` gibt es etwas zu
   bewachen. */
async function sitzungStarten() {
  const seite = seiteBauen();
  const alles = await overlayStarten(seite.alle);
  alles.fragen({ typ: "overlay:an", text: "SMarTrAgent steuert diesen Tab" });
  return { ...alles, seite };
}

test("Wächter: die Seite entfernt den Wirt, er ist sofort wieder da", async () => {
  const { zustand } = await sitzungStarten();
  const wirt = zustand.wirt();
  assert.equal(wirt.isConnected, true, "vor dem Angriff hängt der Wirt in der Seite");

  zustand.wirtEntfernen();

  assert.equal(
    wirt.isConnected,
    true,
    "nach node.remove() muss der Wirt wieder im Baum hängen, sonst bedient der Agent unsichtbar weiter"
  );
  assert.equal(
    wirt.parentNode,
    zustand.wirt().parentNode,
    "und zwar an <html>, nicht irgendwo"
  );
  assert.equal(
    zustand.angehaengt.filter((n) => n && n.id === "smartrchrome-host").length,
    2,
    "genau einmal wieder eingesetzt: einmal beim Start, einmal nach dem Angriff"
  );
});

test("Wächter: der verschobene Wirt kommt an <html> zurück", async () => {
  const { zustand, sandbox } = await sitzungStarten();
  const wirt = zustand.wirt();

  /* Verschieben statt entfernen: Der Knoten lebt, hängt aber in einem
     fremden Behälter — und ein Behälter mit overflow:hidden oder eigenem
     Stapelkontext blendet ihn genauso aus wie ein remove(). */
  zustand.wirtVerschieben();

  assert.equal(
    wirt.parentNode,
    sandbox.document.documentElement,
    "der Wirt gehört an <html>, ein fremder Elternteil ist ein Versteck"
  );
});

test("Wächter: ein gekaperter Inline-Stil wird wiederhergestellt", async () => {
  const { zustand } = await sitzungStarten();
  const wirt = zustand.wirt();

  /* Das ist der Weg, gegen den !important nichts ausrichtet: Die Seite
     schreibt an derselben Stelle, an der die Abwehr steht. */
  zustand.stilKapern("display", "none");

  assert.equal(
    wirt.style.getPropertyValue("display"),
    "block",
    "display muss wieder auf block stehen, sonst ist das Overlay abgeschaltet"
  );
  assert.equal(
    wirt.style.getPropertyPriority("display"),
    "important",
    "und wieder mit !important, sonst gewinnt das nächste Seiten-CSS"
  );

  /* Ein einzelner Eingriff beendet noch nichts — sonst wäre der Wächter
     selbst die Reißleine.
     Der Betriebsmodus steht seit v3.5 vorn im Schild (VERTRAG §6): Der Satz
     des Ausführers bleibt Wort für Wort stehen, das Modus-Wort kommt davor. */
  assert.equal(schildSatz(zustand), "Begleitet, SMarTrAgent steuert diesen Tab");
});

test("Wächter: auch ein entwertetes !important wird wiederhergestellt", async () => {
  const { zustand } = await sitzungStarten();

  /* Der leiseste Angriff von allen: Der Wert bleibt richtig, nur die
     Priorität fällt weg. Dann sieht der Inline-Stil unverändert aus, und das
     nächste `#smartrchrome-host{display:none!important}` der Seite gewinnt
     trotzdem. Ein Wächter, der nur auf Werte schaut, merkt davon nichts. */
  zustand.stilKapern("display", "block", "");

  assert.equal(zustand.wirt().style.getPropertyValue("display"), "block");
  assert.equal(
    zustand.wirt().style.getPropertyPriority("display"),
    "important",
    "ohne !important verliert die Abwehr gegen das nächste Seiten-Stylesheet"
  );
});

test("Wächter: opacity, Sichtbarkeit und Ebene werden einzeln nachgezogen", async () => {
  /* Nicht nur display: Jede dieser Angaben macht das Zeichen für sich allein
     unsichtbar, und der Wächter prüft sie deshalb einzeln. */
  for (const [eigenschaft, angriff, soll] of [
    ["opacity", "0", "1"],
    ["visibility", "hidden", "visible"],
    ["position", "static", "fixed"],
    ["z-index", "0", "2147483647"],
    ["pointer-events", "auto", "none"],
  ]) {
    const { zustand } = await sitzungStarten();
    zustand.stilKapern(eigenschaft, angriff);
    assert.equal(
      zustand.wirt().style.getPropertyValue(eigenschaft),
      soll,
      `${eigenschaft}:${angriff} der Seite muss zurückgenommen werden`
    );
  }
});

test("Wächter: das Wiedereinsetzen läuft nicht in eine Schleife mit sich selbst", async () => {
  const { zustand } = await sitzungStarten();

  /* Die Attrappe meldet das Wiedereinsetzen an denselben Beobachter, genau
     wie der Browser. Ohne Riegel riefe der Wächter sich selbst nach: Jede
     Reparatur ist eine Änderung, jede Änderung wäre wieder ein Anlass.
     Gemessen wird an der Zahl der Einsetzungen, nicht am Ausbleiben eines
     Absturzes — eine Schleife, die nach 200 Runden von selbst aufhört, wäre
     genauso falsch. */
  zustand.wirtEntfernen();

  assert.equal(
    zustand.angehaengt.length,
    2,
    "eine Entfernung, eine Einsetzung. Mehr heißt: der Wächter reagiert auf sich selbst"
  );
  assert.notEqual(
    schildSatz(zustand),
    ANGRIFF_SATZ,
    "eine einzelne Entfernung darf keine Sitzung beenden"
  );
});

test("Wächter: dreimal entfernt ist ein Angriff, die Sitzung wird beendet", async () => {
  const { zustand, sandbox, fragen } = await sitzungStarten();

  zustand.wirtEntfernen();
  zustand.wirtEntfernen();
  assert.notEqual(schildSatz(zustand), ANGRIFF_SATZ, "zweimal ist noch kein Angriff");

  zustand.wirtEntfernen();

  assert.equal(
    schildSatz(zustand),
    ANGRIFF_SATZ,
    "der Mensch muss im Overlay lesen, warum die Sitzung vorbei ist"
  );
  assert.deepEqual(
    gesendet(sandbox),
    [{ typ: "notbremse", quelle: "overlay-entfernt" }],
    "die Sitzung wird wirklich beendet, nicht nur beklagt"
  );
  assert.equal(
    teilHolen(zustand, "rahmen").getAttribute("data-zustand"),
    "tot",
    "der Rahmen zeigt, dass er nichts mehr verspricht"
  );
  assert.equal(
    teilHolen(zustand, "schild").getAttribute("data-zustand"),
    "tot",
    "und das Schild ebenso"
  );

  /* Und ab hier ist Schluss: Ein totes Overlay führt keinen Befehl mehr aus. */
  const k = fragen({ typ: "overlay:klicken", ref: "e1", epoche: "s1" });
  assert.deepEqual(k, { ok: false, fehler: "overlay_tot" });
  const an = fragen({ typ: "overlay:an", text: "wieder da" });
  assert.deepEqual(an, { ok: false, fehler: "overlay_tot" });
  assert.equal(
    schildSatz(zustand),
    ANGRIFF_SATZ,
    "ein totes Overlay lässt sich nicht wieder als lebendes anschalten"
  );
});

test("Wächter: kommt der Wirt gar nicht wieder, endet die Sitzung sofort", async () => {
  const { zustand, sandbox } = await sitzungStarten();

  /* Die Seite hält den Knoten draußen — appendChild läuft ins Leere, meldet
     die Änderung aber wie der Browser. Ein Zeichen, das nicht wiederkommt,
     kommt auch beim dritten Versuch nicht wieder; weiterzumachen hieße,
     unsichtbar zu bedienen.
     Hier hängt zugleich die schärfste Probe auf die Selbstschleife: Ohne
     Riegel ruft sich der Wächter über seine eigene Reparatur endlos selbst
     auf, weil die Reparatur nie zum Ziel führt. */
  let versuche = 0;
  sandbox.document.documentElement.appendChild = (n) => {
    versuche += 1;
    zustand.angehaengt.push(n);
    zustand.kindWechsel();
    return n;
  };

  zustand.wirtEntfernen();

  assert.equal(
    versuche,
    1,
    "ein Versuch, dann Schluss. Mehr heißt: Der Wächter ruft sich über seine eigene Reparatur selbst nach"
  );
  assert.equal(schildSatz(zustand), ANGRIFF_SATZ);
  assert.deepEqual(gesendet(sandbox), [{ typ: "notbremse", quelle: "overlay-entfernt" }]);
});

test("Wächter: ohne Sitzung bewacht niemand, und nach dem Ende auch nicht mehr", async () => {
  const seite = seiteBauen();
  const { fragen, zustand } = await overlayStarten(seite.alle);

  /* Vor overlay:an gibt es kein Versprechen, also auch nichts zu bewachen —
     kein fremdes Blatt schleppt einen Beobachter mit, den niemand braucht. */
  assert.equal(zustand.beobachter.filter((b) => b.__aktiv).length, 0);

  fragen({ typ: "overlay:an" });
  assert.equal(
    zustand.beobachter.filter((b) => b.__aktiv).length,
    1,
    "mit der Sitzung beginnt die Bewachung"
  );

  fragen({ typ: "overlay:aus" });
  assert.equal(
    zustand.beobachter.filter((b) => b.__aktiv).length,
    0,
    "mit dem Ende hört sie wieder auf"
  );
});

test("Wächter: er sieht die Meldungen gar nicht an, sondern nur den Ist-Zustand", async () => {
  const { zustand } = await sitzungStarten();
  const vorher = zustand.angehaengt.length;

  /* Tausend Meldungen an genau der Stelle, an der der Wächter hängt. Er darf
     davon nichts tun außer sechs Eigenschaften abfragen — kein Baumvergleich,
     kein Wiedereinsetzen, keine Zählung Richtung Sitzungsende. */
  for (let i = 0; i < 1000; i += 1) zustand.kindWechsel();

  assert.equal(zustand.angehaengt.length, vorher, "ein heiler Wirt wird nicht angefasst");
  assert.notEqual(schildSatz(zustand), ANGRIFF_SATZ, "Bewegung der Seite ist kein Angriff");
});

/* ------------------------------------------------------------------ *
 * Die Notbremse ohne Erweiterung
 *
 * Befund 10.08.2026: Ist der Erweiterungskontext weg — Erweiterung neu
 * geladen, aktualisiert oder abgeschaltet —, wirft chrome.runtime.sendMessage
 * synchron. Der Wurf lief aus dem Tastenhörer in die Konsole der Seite, die
 * niemand offen hat: Der Mensch drückte zweimal Escape, sah nichts und glaubte,
 * gestoppt zu haben.
 * ------------------------------------------------------------------ */

/* Zweimal Escape, wie ein Mensch es drückt. */
function escEsc(zustand) {
  zustand.feuern("keydown", { key: "Escape" });
  zustand.feuern("keydown", { key: "Escape" });
}

test("Notbremse: zweimal Escape meldet die Notbremse an den Dienst", async () => {
  const { zustand, sandbox } = await sitzungStarten();
  escEsc(zustand);
  assert.deepEqual(gesendet(sandbox), [{ typ: "notbremse", quelle: "esc-esc" }]);
  assert.notEqual(
    teilHolen(zustand, "rahmen").getAttribute("data-zustand"),
    "tot",
    "mit lebender Erweiterung bleibt das Overlay am Leben"
  );
});

test("Notbremse: ein einzelnes Escape löst nichts aus", async () => {
  const { zustand, sandbox } = await sitzungStarten();
  zustand.feuern("keydown", { key: "Escape" });
  assert.deepEqual(gesendet(sandbox), []);
});

test("Notbremse: ohne Erweiterungskontext gibt es eine ehrliche Meldung statt eines stillen Wurfs", async () => {
  const { zustand, sandbox, fragen } = await sitzungStarten();

  /* Genau das macht Chrome, wenn die Erweiterung neu geladen wurde: Die
     Kennung ist weg, und jeder Aufruf wirft. */
  sandbox.chrome.runtime.id = undefined;
  sandbox.chrome.runtime.__wirft = true;

  assert.doesNotThrow(
    () => escEsc(zustand),
    "der Tastenhörer darf nicht werfen, sonst landet die Wahrheit in einer Konsole, die niemand liest"
  );

  assert.equal(
    schildSatz(zustand),
    KONTEXT_SATZ,
    "der Mensch muss lesen, dass sein Druck ins Leere ging und die Sitzung ohnehin vorbei ist"
  );
  assert.equal(
    teilHolen(zustand, "rahmen").getAttribute("data-zustand"),
    "tot",
    "ein totes Overlay darf sich nicht als lebendes ausgeben"
  );
  assert.equal(teilHolen(zustand, "zeiger").getAttribute("data-an"), "0");
  assert.deepEqual(fragen({ typ: "overlay:ping" }), { ok: false, fehler: "overlay_tot" });
});

test("Notbremse: wirft sendMessage trotz Kennung, ist das derselbe Befund", async () => {
  const { zustand, sandbox } = await sitzungStarten();
  /* Die Kennung steht noch, der Kanal ist trotzdem tot — auch dieser Weg
     darf nicht still werfen. */
  sandbox.chrome.runtime.__wirft = true;

  assert.doesNotThrow(() => escEsc(zustand));
  assert.equal(schildSatz(zustand), KONTEXT_SATZ);
  assert.equal(teilHolen(zustand, "rahmen").getAttribute("data-zustand"), "tot");
});

test("Notbremse: eine abgewiesene Zusage ist derselbe Befund wie ein Wurf", async () => {
  const { zustand, sandbox } = await sitzungStarten();
  /* Chrome gibt in Manifest V3 ein Versprechen zurück. Wird es abgewiesen,
     ist die Meldung genauso wenig angekommen wie bei einem Wurf — und der
     Mensch stünde genauso im Dunkeln. */
  sandbox.chrome.runtime.__abgelehnt = true;

  escEsc(zustand);
  await gleich();

  assert.equal(schildSatz(zustand), KONTEXT_SATZ);
  assert.equal(teilHolen(zustand, "rahmen").getAttribute("data-zustand"), "tot");
});

test("Notbremse: ein totes Overlay gibt den Seitentitel wieder frei", async () => {
  const { zustand, sandbox } = await sitzungStarten();
  const vorher = "Warenkorb";
  assert.ok(sandbox.document.title.startsWith("🐇▶ "), "die Sitzung trägt das Präfix");

  sandbox.chrome.runtime.id = undefined;
  escEsc(zustand);

  assert.equal(
    sandbox.document.title,
    vorher,
    "das Präfix verspricht einen gesteuerten Tab, und gesteuert wird hier nichts mehr"
  );
});

/* ------------------------------------------------------------------ *
 * Der Zielrahmen im Bildlauf
 *
 * Der Rahmen steht in Sichtfenster-Koordinaten, weil der Wirt fixiert ist.
 * Genau deshalb zeigte er bis 0.5.2 nach jedem Bildlauf auf die falsche
 * Stelle: Das Element wandert mit dem Inhalt, der Rahmen blieb stehen. Der
 * Mensch sah einen Rahmen um „Abmelden" und gab in Wahrheit „Bestellen" frei.
 * ------------------------------------------------------------------ */

const RECHTECK = { left: 100, top: 400, width: 200, height: 40 };

async function zielGesetzt() {
  const alles = await sitzungStarten();
  alles.fragen({
    typ: "overlay:zeiger",
    x: 200,
    y: 420,
    rect: RECHTECK,
    beschriftung: "Bestellen",
  });
  return alles;
}

test("Bildlauf: der Zielrahmen folgt dem Bildlauf des Agenten", async () => {
  const { fragen, zustand } = await zielGesetzt();
  const ziel = teilHolen(zustand, "ziel");
  assert.equal(ziel.style.top, "400px", "vor dem Bildlauf sitzt der Rahmen auf dem Element");

  fragen({ typ: "overlay:scrollen", richtung: "down", menge: 300 });

  assert.equal(
    ziel.style.top,
    "100px",
    "300 Pixel Bildlauf heißt 300 Pixel höher, sonst rahmt der Rahmen etwas anderes ein"
  );
  assert.equal(ziel.style.left, "100px", "seitwärts wurde nicht gescrollt, also bleibt links links");
  assert.equal(ziel.style.height, "40px", "die Größe des Elements ändert der Bildlauf nicht");
  assert.equal(ziel.getAttribute("data-an"), "1", "und sichtbar bleibt er auch");
});

test("Bildlauf: auch der Zeiger zeigt nach dem Bildlauf noch auf dasselbe Element", async () => {
  const { fragen, zustand } = await zielGesetzt();
  const zeiger = teilHolen(zustand, "zeiger");
  assert.equal(zeiger.style.transform, "translate3d(192px, 412px, 0)");

  fragen({ typ: "overlay:scrollen", richtung: "down", menge: 300 });

  assert.equal(
    zeiger.style.transform,
    "translate3d(192px, 112px, 0)",
    "ein Zeiger, der auf das falsche Element zeigt, ist schlimmer als gar keiner"
  );
  assert.equal(
    zeiger.getAttribute("data-folgt"),
    "1",
    "beim Nachführen darf der Zeiger nicht gleiten, sonst zeigt er unterwegs daneben"
  );
});

test("Bildlauf: auch der Mensch am Rad führt den Rahmen nach", async () => {
  const { zustand } = await zielGesetzt();
  const ziel = teilHolen(zustand, "ziel");

  /* Kein Befehl des Agenten, sondern das Scroll-Ereignis des Browsers. */
  zustand.scrollY = 250;
  zustand.feuern("scroll", {});

  assert.equal(ziel.style.top, "150px", "der Rahmen hängt am Element, nicht am Sichtfenster");
});

test("Bildlauf: der Rahmen kehrt zurück, wenn zurückgescrollt wird", async () => {
  const { fragen, zustand } = await zielGesetzt();
  const ziel = teilHolen(zustand, "ziel");
  fragen({ typ: "overlay:scrollen", richtung: "down", menge: 300 });
  fragen({ typ: "overlay:scrollen", richtung: "up", menge: 300 });
  assert.equal(ziel.style.top, "400px", "die Nachführung rechnet vom Bezugspunkt, nicht Schritt für Schritt");
});

test("Bildlauf: ohne gesetzten Zielrahmen führt niemand etwas nach", async () => {
  const { fragen, zustand } = await sitzungStarten();
  const ziel = teilHolen(zustand, "ziel");
  /* Der Arbeitszeiger hat kein Element und darf deshalb auch nicht wandern. */
  fragen({ typ: "overlay:zeiger", x: 50, y: 50 });
  fragen({ typ: "overlay:scrollen", richtung: "down", menge: 300 });
  assert.equal(ziel.style.top, undefined, "ohne Rechteck gibt es keinen Rahmen zu bewegen");
  assert.equal(ziel.getAttribute("data-an"), "0");
});

test("Bildlauf: nach dem Sitzungsende wird nichts mehr nachgeführt", async () => {
  const { fragen, zustand } = await zielGesetzt();
  const ziel = teilHolen(zustand, "ziel");
  fragen({ typ: "overlay:aus" });
  zustand.scrollY = 250;
  zustand.feuern("scroll", {});
  assert.equal(ziel.style.top, "400px", "ein abgeschaltetes Overlay bewegt nichts mehr");
});

/* ------------------------------------------------------------------ *
 * Der Klick-Puls ohne Bewegung
 *
 * Wer „Bewegung reduzieren" eingestellt hat, sah bis 0.5.2 beim Klick gar
 * nichts: Die einzige Regel für den ausgelösten Puls lag in
 * prefers-reduced-motion: no-preference. Genau die Menschen, die auf eine
 * ruhige, deutliche Anzeige angewiesen sind, bekamen keine.
 *
 * Geprüft wird nicht mit einer Textsuche, sondern an der Struktur des
 * Stylesheets: Welche Regel liegt in welcher Medienabfrage, und was steht
 * darin. Eine Textsuche nach „puls" bliebe grün, egal wo die Regel steht.
 * ------------------------------------------------------------------ */

/* Ein kleiner CSS-Zerleger: Regeln mit ihrer Umgebung und ihren
   Deklarationen. Verschachtelte Blöcke (@media mit Regeln darin) werden
   betreten, @keyframes übergangen. */
function regelnLesen(css, umgebung = "") {
  const raus = [];
  let i = 0;
  /* Kommentare zuerst heraus: Sonst klebt der Kommentar über einer Regel am
     Selektor, und genau die Regeln mit der ausführlichsten Begründung wären
     die, die keine Prüfung findet. */
  const text = String(css || "").replace(/\/\*[\s\S]*?\*\//g, " ");
  while (i < text.length) {
    const auf = text.indexOf("{", i);
    if (auf < 0) break;
    const kopf = text.slice(i, auf).trim();
    let tiefe = 1;
    let j = auf + 1;
    while (j < text.length && tiefe > 0) {
      if (text[j] === "{") tiefe += 1;
      else if (text[j] === "}") tiefe -= 1;
      j += 1;
    }
    const koerper = text.slice(auf + 1, j - 1);
    if (kopf.startsWith("@media")) {
      raus.push(...regelnLesen(koerper, kopf));
    } else if (!kopf.startsWith("@")) {
      const deklarationen = new Map();
      for (const stueck of koerper.split(";")) {
        const s = stueck.trim();
        if (!s || s.includes("{")) continue;
        const trenn = s.indexOf(":");
        if (trenn < 0) continue;
        deklarationen.set(s.slice(0, trenn).trim().toLowerCase(), s.slice(trenn + 1).trim());
      }
      for (const teil of kopf.split(",")) {
        raus.push({ selektor: teil.trim(), umgebung, deklarationen });
      }
    }
    i = j;
  }
  return raus;
}

async function stylesheetLesen() {
  const seite = seiteBauen();
  const { zustand } = await overlayStarten(seite.alle);
  assert.ok(zustand.stil.length > 200, "das Overlay muss ein Stylesheet mitbringen");
  return regelnLesen(zustand.stil);
}

test("Der Zerleger findet die Regeln wirklich, sonst misst der Rest nichts", async () => {
  /* Ein Zerleger, der nichts findet, macht jede folgende Prüfung zu einer
     Prüfung über die leere Menge. Deshalb zuerst er selbst. */
  const regeln = await stylesheetLesen();
  assert.ok(regeln.length >= 15, `zu wenige Regeln gefunden: ${regeln.length}`);
  const rahmen = regeln.find((r) => r.selektor === ".rahmen");
  assert.ok(rahmen, "die Grundregel des Rahmens muss auffindbar sein");
  assert.equal(rahmen.umgebung, "", "sie steht in keiner Medienabfrage");
  assert.equal(rahmen.deklarationen.get("position"), "fixed");
  const atmen = regeln.find(
    (r) => r.selektor === '.rahmen[data-an="1"]' && r.umgebung.includes("no-preference")
  );
  assert.ok(atmen, "und die Bewegungsregel muss in ihrer Medienabfrage stehen");
});

test("Klick-Puls: auch ohne Bewegung gibt es ein sichtbares Zeichen", async () => {
  const regeln = await stylesheetLesen();
  const pulsRegeln = regeln.filter((r) => r.selektor === '.puls[data-an="1"]');
  assert.ok(pulsRegeln.length, "es muss überhaupt eine Regel für den ausgelösten Puls geben");

  /* Der Kern: eine Regel, die den Puls sichtbar macht, OHNE an
     „no-preference" zu hängen. Liegt die einzige sichtbar machende Regel in
     dieser Abfrage, sieht ein Mensch mit abgestellter Bewegung nichts. */
  const ohneBewegung = pulsRegeln.filter((r) => !r.umgebung.includes("no-preference"));
  assert.ok(
    ohneBewegung.length,
    "der ausgelöste Puls hängt vollständig an prefers-reduced-motion: no-preference"
  );

  const sichtbar = ohneBewegung.find((r) => Number(r.deklarationen.get("opacity")) > 0);
  assert.ok(
    sichtbar,
    "ohne Bewegung muss der Puls eine Deckkraft über null bekommen, sonst ist er unsichtbar"
  );

  /* Und er muss ohne Bewegung auch etwas hermachen: Ein 18-Pixel-Ring, der
     nicht aufgeht, ist auf einer vollen Seite nicht zu finden. */
  assert.ok(
    sichtbar.deklarationen.get("background"),
    "die stehende Hervorhebung braucht eine Fläche, ein dünner Ring allein genügt nicht"
  );
  assert.ok(
    !sichtbar.deklarationen.has("animation"),
    "eine Bewegung ist genau das, was hier nicht stattfinden darf"
  );

  /* Der Ruhezustand bleibt unsichtbar — sonst wäre die Prüfung oben trivial
     erfüllt und der Puls stünde dauerhaft auf der Seite. */
  const grund = regeln.find((r) => r.selektor === ".puls" && !r.umgebung);
  assert.ok(grund, "die Grundregel des Pulses muss es geben");
  assert.equal(grund.deklarationen.get("opacity"), "0", "ungeklickt ist der Puls unsichtbar");
});

test("Klick-Puls: mit Bewegung bleibt der aufgehende Ring erhalten", async () => {
  const regeln = await stylesheetLesen();
  const bewegt = regeln.find(
    (r) => r.selektor === '.puls[data-an="1"]' && r.umgebung.includes("no-preference")
  );
  assert.ok(bewegt, "wer Bewegung mag, bekommt weiterhin den aufgehenden Ring");
  const animation = String(bewegt.deklarationen.get("animation") || "");
  assert.ok(animation.includes("pulsRing"), `keine Puls-Animation gefunden: ${animation}`);
  assert.ok(
    animation.includes("forwards"),
    "ohne forwards blitzt die stehende Hervorhebung nach dem Auslaufen noch einmal auf"
  );
});

test("Der Klick löst den Puls wirklich aus", async () => {
  /* Die schönste CSS-Regel nützt nichts, wenn niemand data-an setzt. */
  const seite = seiteBauen();
  const { fragen, zustand } = await overlayStarten(seite.alle);
  fragen({ typ: "overlay:an" });
  const baum = fragen({ typ: "overlay:baum" });
  const ref = refVon(baum, "Startseite");
  fragen({ typ: "overlay:klicken", ref, epoche: baum.epoche });
  const puls = teilHolen(zustand, "puls");
  assert.equal(puls.getAttribute("data-an"), "1", "beim Klick geht der Puls an");
  assert.equal(
    puls.style.left,
    `${mitteVon(seite.start).x}px`,
    "und zwar dort, wo geklickt wurde"
  );
});

test("Ein totes Overlay hat sein eigenes Aussehen im Stylesheet", async () => {
  const regeln = await stylesheetLesen();
  const totRahmen = regeln.find((x) => x.selektor.includes('.rahmen[') && x.selektor.includes('[data-zustand="tot"]'));
  const totSchild = regeln.find((x) => x.selektor === '.schild[data-zustand="tot"]');
  assert.ok(totRahmen, "der Rahmen braucht ein eigenes Aussehen für tot");
  assert.ok(totSchild, "und das Schild ebenso");
  assert.ok(totSchild.deklarationen.size > 0, "die Regel steht da, sagt aber nichts");
  assert.ok(
    !String(totRahmen.deklarationen.get("box-shadow") || "").includes("#2aff2a"),
    "ein totes Overlay darf nicht mehr grün leuchten, Grün ist die Zusage"
  );

  /* Und es darf auch nicht weiteratmen. Die Atem-Regel steht später im
     Stylesheet; wäre der Tot-Selektor nicht spezifischer, gewänne sie bei
     gleicher Spezifität allein durch ihre Stelle. */
  assert.equal(
    totRahmen.deklarationen.get("animation"),
    "none",
    "ein totes Overlay darf nicht weiter grün pulsieren"
  );
  const atmen = regeln.find(
    (r) => r.selektor === '.rahmen[data-an="1"]' && r.umgebung.includes("no-preference")
  );
  assert.ok(atmen, "die Atem-Regel muss es geben, sonst misst der Vergleich nichts");
  assert.ok(
    totRahmen.selektor.split("[").length > atmen.selektor.split("[").length,
    `der Tot-Selektor muss spezifischer sein als die Atem-Regel: ${totRahmen.selektor}`
  );
});

/* ------------------------------------------------------------------ *
 * Die Abwehr gegen die übrigen Verstecke
 *
 * display, visibility und opacity sind die bekannten drei. Sie sind nicht die
 * einzigen: `scale: 0` überlebt ein `transform: none`, weil die einzelnen
 * Transform-Eigenschaften eigene Eigenschaften sind. clip, mask,
 * mix-blend-mode, content-visibility und eine Breite von null blenden das
 * Zeichen ebenso aus, ohne eine der bekannten drei anzufassen.
 * ------------------------------------------------------------------ */

test("Abwehr: auch scale, clip, mask und Verwandtschaft stehen am Wirt", async () => {
  const stil = await wirtStil();
  const karte = new Map(stil.map((d) => [d.eigenschaft, d]));

  for (const [eigenschaft, erwartet] of [
    ["scale", "none"],
    ["rotate", "none"],
    ["translate", "none"],
    ["clip", "auto"],
    ["mask", "none"],
    ["mix-blend-mode", "normal"],
    ["content-visibility", "visible"],
    ["animation", "none"],
    ["width", "auto"],
    ["height", "auto"],
    ["max-width", "none"],
    ["max-height", "none"],
  ]) {
    const d = karte.get(eigenschaft);
    assert.ok(d, `${eigenschaft} fehlt am Wirt, damit blendet die Seite das Zeichen darüber aus`);
    assert.equal(d.wert, erwartet, `${eigenschaft} muss auf ${erwartet} stehen`);
    assert.equal(d.wichtig, true, `${eigenschaft} ohne !important verliert gegen das Seiten-CSS`);
  }
});

/* ------------------------------------------------------------------ *
 * Die Verdeckungswache im Klickweg
 *
 * Der Auslieferungsblocker vom 11.08.2026, im echten Chrome gemessen: Über
 * einem freigegebenen „Jetzt kaufen" lag ein ganzseitiger Überzug,
 * `document.elementFromPoint` gab in der Mitte des Knopfes eindeutig den
 * Überzug zurück — und `overlay:klicken` antwortete trotzdem
 * `{ok:true, name:"Jetzt kaufen"}`, die Klickspur der Seite zeigte den Kauf.
 * Die Wache war gebaut, geprüft und wurde von niemandem gerufen.
 *
 * Deshalb wird hier nicht die Wache geprüft (das tut klickwache.test.mjs, und
 * zwar gegen die Fassung in befehle.js), sondern der EINBAU: Jede Prüfung
 * unten geht durch `overlay:klicken`, `overlay:tippen` und
 * `overlay:auswaehlen` — also durch genau den Weg, den der Ausführer benutzt.
 * ------------------------------------------------------------------ */

/* Die Seite aus dem Funktionstest, mit den Maßen von dort. */
function kaufseiteBauen() {
  const kaufen = knoten("button", {
    text: "Jetzt kaufen",
    rect: { left: 41, top: 250, width: 122, height: 38 },
  });
  const menge = knoten("input", {
    attrs: { type: "text", "aria-label": "Menge" },
    type: "text",
    value: "1",
    rect: { left: 41, top: 320, width: 122, height: 38 },
  });
  const versand = knoten("select", {
    attrs: { "aria-label": "Versandart" },
    optionen: [option("Standard", "std"), option("Express", "exp")],
    rect: { left: 41, top: 380, width: 122, height: 38 },
  });
  return { kaufen, menge, versand, alle: [kaufen, menge, versand] };
}

/* Ein Überzug über der ganzen Seite. Ohne Namen und ohne Wert steht er in
   keiner Wahrnehmung — genau wie auf einer echten Seite, wo ihn niemand
   bedienen will und trotzdem jeder Klick an ihm hängen bleibt. */
const ueberzugBauen = (z) =>
  knoten("div", { rect: { left: 0, top: 0, width: 1280, height: 900 }, z });

async function kaufseiteStarten(zusatz = []) {
  const seite = kaufseiteBauen();
  const alles = await overlayStarten([...seite.alle, ...zusatz]);
  const baum = alles.fragen({ typ: "overlay:baum" });
  assert.equal(baum.ok, true);
  return { ...alles, seite, baum };
}

test("Die Attrappe sieht wirklich am Punkt nach — sonst misst der Rest nichts", async () => {
  /* Zuerst die Nachbildung selbst: Eine Attrappe, deren elementFromPoint immer
     das Ziel zurückgibt, hielte jede Prüfung darunter grün. Gemessen wird
     deshalb genau der Befund des Funktionstests: In der Mitte des Kaufknopfes
     liegt der Überzug, nicht der Knopf. */
  const seite = kaufseiteBauen();
  const ueberzug = ueberzugBauen(999999);
  const { sandbox } = await overlayStarten([...seite.alle, ueberzug]);
  const m = mitteVon(seite.kaufen);

  assert.equal(
    sandbox.document.elementFromPoint(m.x, m.y),
    ueberzug,
    "über dem Knopf muss wirklich der Überzug liegen"
  );
  ueberzug.__z = -1;
  assert.equal(
    sandbox.document.elementFromPoint(m.x, m.y),
    seite.kaufen,
    "ohne Überzug darüber bekommt der Knopf den Punkt"
  );
  assert.equal(
    sandbox.document.elementFromPoint(2000, 40),
    null,
    "außerhalb des Fensters liegt nichts, genau wie im Browser"
  );
});

test("Blocker 11.08.: ein durchsichtiger Ganzseiten-Überzug hält den Klick auf", async () => {
  const { fragen, seite, baum } = await kaufseiteStarten([ueberzugBauen(999999)]);
  const ref = refVon(baum, "Jetzt kaufen");
  assert.ok(ref, "der Knopf steht in der Wahrnehmung");

  const k = fragen({ typ: "overlay:klicken", ref, epoche: baum.epoche });
  assert.equal(k.ok, false, "genau hier meldete die alte Fassung Erfolg");
  assert.equal(k.fehler, "element_covered");
  assert.equal(k.wache, "verdeckt");
  assert.equal(k.darueber, "div", "was oben liegt, wird benannt");

  await gleich();
  assert.equal(seite.kaufen.__klicks, 0, "und es wird wirklich nicht geklickt");
  assert.equal(seite.kaufen.__fokus, 0, "auch der Fokus bleibt, wo er war");
  assert.deepEqual(seite.kaufen.__ereignisse, [], "keine einzige Ereigniskette");
});

test("Blocker 11.08.: auch ein deckendes Banner auf der höchsten Ebene hält ihn auf", async () => {
  const banner = knoten("aside", {
    rect: { left: 0, top: 0, width: 1280, height: 900 },
    z: 2147483647,
  });
  const { fragen, seite, baum } = await kaufseiteStarten([banner]);
  const k = fragen({ typ: "overlay:klicken", ref: refVon(baum, "Jetzt kaufen"), epoche: baum.epoche });
  assert.equal(k.ok, false);
  assert.equal(k.fehler, "element_covered");
  assert.equal(k.darueber, "aside");
  await gleich();
  assert.equal(seite.kaufen.__klicks, 0);
});

test("Ein Ziel mit abgeschalteten Zeigerereignissen wird nicht angeklickt", async () => {
  const kaufen = knoten("button", {
    text: "Jetzt kaufen",
    rect: { left: 41, top: 250, width: 122, height: 38 },
    klicktaub: true,
  });
  const { fragen } = await overlayStarten([kaufen]);
  const baum = fragen({ typ: "overlay:baum" });
  const k = fragen({ typ: "overlay:klicken", ref: refVon(baum, "Jetzt kaufen"), epoche: baum.epoche });
  assert.equal(k.ok, false);
  assert.equal(k.wache, "klicktaub", "das ist keine Verdeckung, sondern das Gegenteil");
  assert.equal(k.fehler, "element_not_visible");
  await gleich();
  assert.equal(kaufen.__klicks, 0);
});

test("Ein Ziel, dessen Mitte außerhalb des Sichtfeldes liegt, wird nicht angeklickt", async () => {
  /* Der Fall, den das Nachschlagen allein nicht findet: Das Element ragt gerade
     noch in den Ausschnitt (also ist es „sichtbar"), aber der Punkt, an dem
     geklickt würde, liegt darunter. Und seitwärts prüft das Nachschlagen gar
     nichts. */
  const halbUnten = knoten("button", {
    text: "Halb unten",
    rect: { left: 41, top: 880, width: 122, height: 200 },
  });
  const rechtsRaus = knoten("button", {
    text: "Rechts raus",
    rect: { left: 1200, top: 100, width: 200, height: 38 },
  });
  const { fragen } = await overlayStarten([halbUnten, rechtsRaus]);
  const baum = fragen({ typ: "overlay:baum" });

  for (const [name, el] of [["Halb unten", halbUnten], ["Rechts raus", rechtsRaus]]) {
    const ref = refVon(baum, name);
    assert.ok(ref, `${name} steht in der Wahrnehmung, das Nachschlagen lässt es durch`);
    const k = fragen({ typ: "overlay:klicken", ref, epoche: baum.epoche });
    assert.equal(k.ok, false, name);
    assert.equal(k.wache, "ausserhalb", name);
    await gleich();
    assert.equal(el.__klicks, 0, `${name}: auf etwas, das niemand sieht, wird nicht geklickt`);
  }
});

test("Was frei liegt, wird weiterhin geklickt — auch unter seiner eigenen Beschriftung", async () => {
  /* Die Gegenprobe. Eine Wache, die alles ablehnt, wäre genauso unbrauchbar wie
     keine: Auf dem Knopf liegt im Alltag seine eigene Beschriftung, und die
     gehört zum Ziel. */
  const seite = kaufseiteBauen();
  const beschriftung = knoten("span", {
    rect: { left: 41, top: 250, width: 122, height: 38 },
    z: 1,
  });
  beschriftung.parentNode = seite.kaufen;
  const { fragen } = await overlayStarten([...seite.alle, beschriftung]);
  const baum = fragen({ typ: "overlay:baum" });
  const k = fragen({ typ: "overlay:klicken", ref: refVon(baum, "Jetzt kaufen"), epoche: baum.epoche });
  assert.equal(k.ok, true, "der Punkt gehört einem Kind des Ziels, das ist keine Verdeckung");
  await gleich();
  assert.equal(seite.kaufen.__klicks, 1);
});

test("Auch das Tippen und das Auswählen gehen durch die Wache", async () => {
  const { fragen, seite, baum } = await kaufseiteStarten([ueberzugBauen(999999)]);

  const t = fragen({
    typ: "overlay:tippen",
    ref: refVon(baum, "Menge"),
    epoche: baum.epoche,
    text: "3",
  });
  assert.equal(t.ok, false, "wer in ein verdecktes Feld tippt, tippt ins Falsche");
  assert.equal(t.fehler, "element_covered");
  assert.equal(seite.menge.value, "1", "der Wert bleibt, was er war");
  assert.deepEqual(seite.menge.__ereignisse, [], "und die Seite erfährt nichts davon");

  const a = fragen({
    typ: "overlay:auswaehlen",
    ref: refVon(baum, "Versandart"),
    epoche: baum.epoche,
    etikett: "Express",
  });
  assert.equal(a.ok, false);
  assert.equal(a.fehler, "element_covered");
  await gleich();
  assert.equal(seite.versand.selectedIndex, 0, "die Auswahl bleibt stehen");
});

test("Geheime Felder bleiben geheim, auch wenn nichts darüber liegt", async () => {
  /* Die Reihenfolge im Code ist eine Aussage: Das Verbot für Geheimfelder gilt
     unbedingt und kommt VOR der Wache. Sonst hieße die Absage plötzlich
     `element_covered`, und der Agent suchte ein Banner statt zu verstehen, dass
     Anmelden Sache des Menschen bleibt. */
  const passwort = knoten("input", {
    attrs: { type: "password", "aria-label": "Passwort" },
    type: "password",
    value: "geheim",
    rect: { left: 41, top: 250, width: 122, height: 38 },
  });
  const { fragen } = await overlayStarten([passwort, ueberzugBauen(9)]);
  const baum = fragen({ typ: "overlay:baum" });
  const t = fragen({
    typ: "overlay:tippen",
    ref: refVon(baum, "Passwort"),
    epoche: baum.epoche,
    text: "1234",
  });
  assert.deepEqual(t, { ok: false, fehler: "feld_geheim" });
});

test("Ohne Wache wird nicht bedient", async () => {
  /* Die Lehre vom 11.08.2026 zu Ende gedacht: Ein Weg, der bei fehlender
     Prüfung durchwinkt, ist genau der Weg von vorher. Fehlt die Wache, bleibt
     die Seite unberührt. */
  const seite = kaufseiteBauen();
  const { fragen } = await overlayStarten(seite.alle, [], { ohneWache: true });
  const baum = fragen({ typ: "overlay:baum" });

  const k = fragen({ typ: "overlay:klicken", ref: refVon(baum, "Jetzt kaufen"), epoche: baum.epoche });
  assert.deepEqual(k, { ok: false, fehler: "wache_fehlt" });
  const t = fragen({
    typ: "overlay:tippen", ref: refVon(baum, "Menge"), epoche: baum.epoche, text: "3",
  });
  assert.deepEqual(t, { ok: false, fehler: "wache_fehlt" });
  const a = fragen({
    typ: "overlay:auswaehlen", ref: refVon(baum, "Versandart"), epoche: baum.epoche, etikett: "Express",
  });
  assert.deepEqual(a, { ok: false, fehler: "wache_fehlt" });

  await gleich();
  assert.equal(seite.kaufen.__klicks, 0);
  assert.equal(seite.menge.value, "1");
  assert.equal(seite.versand.selectedIndex, 0);
});

test("Der Klickweg ruft die Wache wirklich, und reicht ihr die Seite herein", async () => {
  /* Der Prüfsatz gegen den Befund selbst: Nicht „die Wache entscheidet richtig",
     sondern „der ausgelieferte Weg fragt sie überhaupt". Achtzehn grüne
     Prüfsätze über einer Funktion, die niemand ruft, sind achtzehn grüne
     Prüfsätze über nichts. */
  const { fragen, sandbox, seite, baum } = await kaufseiteStarten();
  const echt = sandbox.SMARTR_KLICKWACHE;
  const rufe = [];
  sandbox.SMARTR_KLICKWACHE = {
    ...echt,
    klickFreigeben(el, umgebung, ausloesen) {
      rufe.push({ el, umgebung, hatAusloeser: typeof ausloesen === "function" });
      return echt.klickFreigeben(el, umgebung, ausloesen);
    },
  };

  const k = fragen({ typ: "overlay:klicken", ref: refVon(baum, "Jetzt kaufen"), epoche: baum.epoche });
  assert.equal(k.ok, true);
  assert.equal(rufe.length, 1, "genau ein Gang durch die Wache je Klick");
  assert.equal(rufe[0].el, seite.kaufen, "und zwar mit dem Element, dem der Mensch zugestimmt hat");
  assert.equal(rufe[0].hatAusloeser, true, "der Klick wird als Auslöser abgegeben, nicht selbst getan");
  assert.equal(rufe[0].umgebung.dokument, sandbox.document, "die Wache bekommt das echte Dokument");
  /* Der Umweg über die Kopie: Objekte aus dem Sandkasten stammen aus einer
     anderen Welt und sind für deepEqual nie gleich, so gleich ihr Inhalt auch
     ist. Chrome kopiert jede Nachricht zwischen den Welten ohnehin genauso. */
  assert.deepEqual({ ...rufe[0].umgebung.sichtfeld }, { breite: 1280, hoehe: 900 });
  assert.equal(typeof rufe[0].umgebung.stil, "function");
  /* Die Stilabfrage wird eingepackt und nicht blank gereicht: Losgelöst von
     ihrem Fenster wirft `getComputedStyle` in Chrome „Illegal invocation", der
     Wurf liefe in den try der Wache, und aus der Prüfung auf `pointer-events`
     würde ein stilles Nichts. Im Sandkasten fällt das nicht auf, im Browser
     schon — deshalb steht es hier als Bedingung. */
  assert.notEqual(
    rufe[0].umgebung.stil,
    sandbox.getComputedStyle,
    "getComputedStyle darf nicht als blanke Referenz gereicht werden"
  );
  assert.deepEqual(rufe[0].umgebung.stil(seite.kaufen).pointerEvents, "auto");

  /* Und dieselbe Frage für die beiden anderen Wege. */
  fragen({ typ: "overlay:tippen", ref: refVon(baum, "Menge"), epoche: baum.epoche, text: "2" });
  fragen({ typ: "overlay:auswaehlen", ref: refVon(baum, "Versandart"), epoche: baum.epoche, etikett: "Express" });
  assert.equal(rufe.length, 3, "auch Tippen und Auswählen gehen durch dieselbe Wache");
});

test("Der Puls geht nur an, wenn wirklich geklickt wird", async () => {
  /* Der Puls sagt dem Menschen „jetzt ist etwas passiert". Ginge er auch bei
     einer Absage an, sagte er die Unwahrheit — und zwar genau in der Lage, in
     der der Mensch hinsieht. */
  const verdeckt = await kaufseiteStarten([ueberzugBauen(5)]);
  verdeckt.fragen({ typ: "overlay:an" });
  verdeckt.fragen({
    typ: "overlay:klicken",
    ref: refVon(verdeckt.baum, "Jetzt kaufen"),
    epoche: verdeckt.baum.epoche,
  });
  assert.notEqual(
    teilHolen(verdeckt.zustand, "puls").getAttribute("data-an"),
    "1",
    "bei einer Absage darf am Ort der Handlung nichts aufleuchten"
  );

  /* Die Gegenprobe, sonst misst die Zeile darüber nur, dass der Puls nie angeht. */
  const frei = await kaufseiteStarten();
  frei.fragen({ typ: "overlay:an" });
  frei.fragen({
    typ: "overlay:klicken",
    ref: refVon(frei.baum, "Jetzt kaufen"),
    epoche: frei.baum.epoche,
  });
  assert.equal(teilHolen(frei.zustand, "puls").getAttribute("data-an"), "1");
});

/* ------------------------------------------------------------------ *
 * Der Betriebsmodus am Zeichen (VERTRAG v3.5 §6)
 * ------------------------------------------------------------------ */

const MARKENFARBEN = ["#4CC2F1", "#5B8DEF", "#8D7CF6"];

async function modusStarten() {
  const seite = seiteBauen();
  const alles = await overlayStarten(seite.alle);
  alles.fragen({ typ: "overlay:an", text: "SMarTrAgent steuert diesen Tab" });
  return alles;
}

test("Modus: die Automatik trägt den Markenverlauf, Rahmen und Schild", async () => {
  const { fragen, zustand } = await modusStarten();
  const antwort = fragen({ typ: "overlay:modus", modus: "auto" });
  assert.deepEqual(antwort, { ok: true, gesetzt: true, modus: "auto" });

  const rahmen = teilHolen(zustand, "rahmen");
  const verlauf = rahmen.style.getPropertyValue("border-image-source");
  for (const farbe of MARKENFARBEN) {
    assert.ok(verlauf.includes(farbe), `die Marke fehlt im Rahmen: ${farbe}`);
  }
  /* Inline und mit !important, aus demselben Grund wie am Wirt: Ein Blatt der
     Seite darf das Zeichen nicht umfärben (Befund 10.08.2026). */
  for (const eigenschaft of ["border", "border-image-source", "box-shadow"]) {
    assert.equal(
      rahmen.style.getPropertyPriority(eigenschaft),
      "important",
      `${eigenschaft} am Rahmen ohne !important`
    );
  }
  const punkt = teilHolen(zustand, "punkt");
  assert.ok(punkt.style.getPropertyValue("background-image").includes("#4CC2F1"));
  assert.equal(punkt.style.getPropertyPriority("background-image"), "important");
  assert.equal(teilHolen(zustand, "schild").style.getPropertyPriority("border-color"), "important");
  assert.equal(rahmen.getAttribute("data-modus"), "auto");
});

test("Modus: das Schild sagt, welcher Modus läuft", async () => {
  const { fragen, zustand } = await modusStarten();
  const gesehen = [];
  for (const [modus, wort] of [["auto", "Automatik"], ["assist", "Begleitet"], ["manual", "Handbetrieb"]]) {
    fragen({ typ: "overlay:modus", modus });
    const satz = schildSatz(zustand);
    assert.ok(satz.startsWith(`${wort},`), `${modus}: das Schild sagt „${satz}"`);
    assert.ok(satz.includes("SMarTrAgent steuert diesen Tab"), `${modus}: der Satz des Ausführers bleibt`);
    /* Kommas statt Gedankenstrichen: Das Schild wird vorgelesen, und ein
       Gedankenstrich wird als Pause gelesen, die den Satz zerreißt. */
    assert.ok(!satz.includes("—"), `${modus}: kein Gedankenstrich im gesprochenen Text`);
    gesehen.push(wort);
  }
  assert.equal(new Set(gesehen).size, 3, "jeder Modus hat sein eigenes Wort");
});

test("Modus: begleitet und Handbetrieb bleiben grün", async () => {
  const { fragen, zustand } = await modusStarten();
  const rahmen = teilHolen(zustand, "rahmen");
  const punkt = teilHolen(zustand, "punkt");
  fragen({ typ: "overlay:modus", modus: "auto" });
  assert.ok(rahmen.style.getPropertyValue("border-image-source"), "erst die Automatik");

  for (const modus of ["assist", "manual"]) {
    fragen({ typ: "overlay:modus", modus });
    assert.equal(
      rahmen.style.getPropertyValue("border-image-source"),
      "",
      `${modus}: der Verlauf muss wieder weg sein, sonst zeigt das Zeichen eine Lage, die nicht läuft`
    );
    assert.equal(rahmen.style.getPropertyValue("border"), "");
    assert.equal(punkt.style.getPropertyValue("background-image"), "");
    assert.equal(rahmen.getAttribute("data-modus"), modus);
  }
});

test("Modus: ein unbekannter Wert ändert nichts und sagt es", async () => {
  const { fragen, zustand } = await modusStarten();
  fragen({ typ: "overlay:modus", modus: "auto" });
  for (const wild of ["vollzugriff", "", null, 7, "AUTO"]) {
    const a = fragen({ typ: "overlay:modus", modus: wild });
    assert.deepEqual(a, { ok: true, gesetzt: false, modus: "auto" },
      `„${wild}" darf das Zeichen nicht umschreiben`);
  }
  assert.ok(teilHolen(zustand, "rahmen").style.getPropertyValue("border-image-source"),
    "die Automatik steht weiterhin da, denn sie läuft weiterhin");
});

/* ------------------------------------------------------------------ *
 * Der Not-Aus im Schild
 * ------------------------------------------------------------------ */

/* Ein Druck auf den Knopf — über den Ereignishörer, den das Overlay wirklich
   angemeldet hat. Ohne Hörer gibt es keinen Druck, und genau das fällt auf. */
function notausDruecken(zustand, typ = "click") {
  const knopf = teilHolen(zustand, "notaus");
  const hoerer = (knopf.__hoerer || []).filter((h) => h.typ === typ);
  assert.ok(hoerer.length, `am Not-Aus hängt kein Hörer für ${typ}`);
  let verhindert = 0;
  for (const h of hoerer) {
    h.hoerer({ preventDefault: () => { verhindert += 1; }, stopPropagation: () => {} });
  }
  return { knopf, verhindert };
}

test("Not-Aus: der Knopf im Schild meldet die Notbremse mit eigener Quelle", async () => {
  const { fragen, zustand, sandbox } = await modusStarten();
  const { verhindert } = notausDruecken(zustand);
  assert.ok(verhindert >= 1, "der Klick gehört dem Knopf, nicht der Seite darunter");
  assert.deepEqual(
    gesendet(sandbox),
    [{ typ: "notbremse", quelle: "schild" }],
    "genau eine Notbremse, und sie sagt, woher sie kommt"
  );
  /* Erst kappen, dann melden: Das Zeichen steht sofort auf GESTOPPT, ohne auf
     eine Antwort des Dienstes zu warten. */
  assert.equal(teilHolen(zustand, "rahmen").getAttribute("data-zustand"), "gestoppt");
  assert.equal(schildSatz(zustand), "GESTOPPT, der Agent steuert nicht mehr");
  fragen({ typ: "overlay:ping" });
});

test("Not-Aus: er hört auch auf pointerdown, falls die Seite Klicks abfängt", async () => {
  const { zustand, sandbox } = await modusStarten();
  notausDruecken(zustand, "pointerdown");
  assert.deepEqual(gesendet(sandbox), [{ typ: "notbremse", quelle: "schild" }]);
});

test("Not-Aus: ohne Erweiterung sagt der Knopf die Wahrheit statt still zu scheitern", async () => {
  const { zustand, sandbox } = await modusStarten();
  sandbox.chrome.runtime.id = undefined;
  notausDruecken(zustand);
  assert.deepEqual(gesendet(sandbox), [], "ohne Kontext geht nichts mehr hinaus");
  assert.equal(teilHolen(zustand, "schild").getAttribute("data-zustand"), "tot");
  assert.ok(schildSatz(zustand).includes("Verbindung zur Erweiterung"));
});

test("Not-Aus: der Knopf ist nur treffbar, solange das Zeichen etwas verspricht", async () => {
  const seite = seiteBauen();
  const { fragen, zustand } = await overlayStarten(seite.alle);
  const knopf = teilHolen(zustand, "notaus");

  /* Vor der Sitzung: kein Knopf. Ein unsichtbarer Knopf, der weiter Klicks
     schluckt, wäre ein Loch in der Seite des Menschen. */
  assert.equal(knopf.style.getPropertyValue("display"), "none");
  assert.equal(knopf.style.getPropertyValue("pointer-events"), "none");

  fragen({ typ: "overlay:an" });
  assert.equal(knopf.style.getPropertyValue("display"), "inline-flex");
  assert.equal(knopf.style.getPropertyValue("pointer-events"), "auto");
  /* Inline und wichtig, sonst schaltet ein Blatt der Seite die Reißleine ab. */
  for (const eigenschaft of ["display", "pointer-events", "background", "color"]) {
    assert.equal(
      knopf.style.getPropertyPriority(eigenschaft),
      "important",
      `${eigenschaft} am Not-Aus ohne !important`
    );
  }

  fragen({ typ: "overlay:aus" });
  assert.equal(knopf.style.getPropertyValue("display"), "none");
  assert.equal(knopf.style.getPropertyValue("pointer-events"), "none");
});

test("Not-Aus: ein totes Zeichen zeigt keine Reißleine mehr", async () => {
  const { zustand, sandbox } = await modusStarten();
  sandbox.chrome.runtime.__wirft = true;
  zustand.feuern("keydown", { key: "Escape" });
  zustand.feuern("keydown", { key: "Escape" });
  assert.equal(teilHolen(zustand, "schild").getAttribute("data-zustand"), "tot");
  const knopf = teilHolen(zustand, "notaus");
  assert.equal(knopf.style.getPropertyValue("display"), "none",
    "ein Knopf, der nichts mehr stoppen kann, ist ein falsches Versprechen");
  assert.equal(knopf.style.getPropertyValue("pointer-events"), "none");
});

test("Not-Aus: der Knopf trägt einen Namen für den Vorleser", async () => {
  const { zustand } = await modusStarten();
  const knopf = teilHolen(zustand, "notaus");
  assert.equal(knopf.getAttribute("type"), "button", "sonst schickt er in einem Formular etwas ab");
  const name = knopf.getAttribute("aria-label") || "";
  assert.ok(name.length > 4, "ohne Namen ist der Knopf für einen Vorleser stumm");
  assert.ok(!name.includes("—"), "Kommas statt Gedankenstrichen, der Text wird vorgelesen");
  assert.equal(knopf.textContent, "STOPP");
});

/* ------------------------------------------------------------------ *
 * Was wirklich in die Seite eingespielt wird — `src/net/seite.js`
 *
 * Diese Prüfungen stehen hier, weil sie dieselbe Zusage messen wie alles
 * darüber: Der Klickweg hat seine Wache. Nützt der beste Einbau in
 * overlay.js nichts, wenn `klickwache.js` gar nicht erst in die Seite kommt —
 * dann heißt jede Antwort `wache_fehlt`, und die Erweiterung bedient gar nicht
 * mehr. Gemessen wird deshalb der Auftrag, den Chrome bekommt, und nicht der
 * Quelltext, der ihn baut.
 * ------------------------------------------------------------------ */

import { attrappeSetzen } from "./chrome-attrappe.mjs";

/* Erst die Attrappe stellen, dann laden: `net/dienste.js` liest die Fassung aus
   dem Manifest schon beim Einlesen der Datei. Ohne ein `chrome` davor bricht
   der Import, und zwar bevor irgendeine Prüfung läuft. */
attrappeSetzen();
const { overlaySicherstellen } = await import("../net/seite.js");

const EINSPIEL_TAB = {
  id: 7,
  url: "https://geizhals.de/warenkorb",
  title: "Warenkorb",
  active: true,
  status: "complete",
  windowId: 3,
};

/* Ein Tab, in dem das Overlay noch nicht läuft: Der erste Ping bleibt ohne
   Erfolg, nach dem Einspielen antwortet es. Genau so verhält sich eine frisch
   geladene Seite. */
function einspielstandBauen({ scheitertBei = null } = {}) {
  const stand = { lebt: false };
  const { chrome, spur } = attrappeSetzen({
    tab: { ...EINSPIEL_TAB },
    seiteAntwortet: (n) =>
      n.typ === "overlay:ping" ? { ok: stand.lebt } : { ok: true },
  });
  chrome.scripting.executeScript = async (auftrag) => {
    spur.push({ wohin: "executeScript", auftrag });
    /* So sagt Chrome nein, wenn eine Datei des Auftrags fehlt: Der ganze
       Auftrag wird abgelehnt, nicht nur die eine Datei. */
    if (scheitertBei && (auftrag.files || []).some((d) => d.includes(scheitertBei))) {
      throw new Error("Could not load file");
    }
    stand.lebt = true;
    return [{ result: null }];
  };
  const auftraege = () =>
    spur.filter((e) => e.wohin === "executeScript").map((e) => e.auftrag.files);
  return { spur, auftraege };
}

test("Einspielen: die Klickwache kommt vor dem Overlay in die Seite", async () => {
  const { auftraege } = einspielstandBauen();
  const ergebnis = await overlaySicherstellen(EINSPIEL_TAB.id);
  assert.deepEqual(ergebnis, { ok: true, schonDa: false });

  const dateien = auftraege();
  assert.equal(dateien.length, 1, "ein Auftrag genügt, wenn alles da ist");
  assert.deepEqual(dateien[0], [
    "src/content/klickwache.js",
    "src/content/selektor.js",
    "src/content/overlay.js",
  ]);
  /* Die Reihenfolge ist die Aussage: overlay.js findet die Wache vor, wenn es
     startet. Umgekehrt liefe der erste Befehl in ein `wache_fehlt`. */
  assert.ok(
    dateien[0].indexOf("src/content/klickwache.js") < dateien[0].indexOf("src/content/overlay.js"),
    "die Wache muss VOR dem Overlay eingespielt werden"
  );
});

test("Einspielen: fehlt die Datei des Teach-Modus, wird trotzdem bedient", async () => {
  /* `selektor.js` gehört einem anderen Gebiet und entsteht gerade erst. Fehlt
     sie, lehnt Chrome den ganzen Auftrag ab — dann stünde die Erweiterung ohne
     Zeichen und ohne Wache in der Seite, wegen einer Datei, die zum Klicken
     niemand braucht. */
  const { auftraege } = einspielstandBauen({ scheitertBei: "selektor.js" });
  const ergebnis = await overlaySicherstellen(EINSPIEL_TAB.id);
  assert.deepEqual(ergebnis, { ok: true, schonDa: false });

  const dateien = auftraege();
  assert.equal(dateien.length, 2, "erst der volle Auftrag, dann der Pflichtteil");
  assert.deepEqual(dateien[1], ["src/content/klickwache.js", "src/content/overlay.js"]);
});

test("Einspielen: ohne Wache wird auch nichts eingespielt", async () => {
  /* Die Gegenprobe zum Rückfall: Er ist kein Weg, auf dem das Overlay allein
     in die Seite kommt. Ohne Wache keine Bedienung, und zwar schon hier. */
  const { auftraege } = einspielstandBauen({ scheitertBei: "klickwache.js" });
  const ergebnis = await overlaySicherstellen(EINSPIEL_TAB.id);
  assert.deepEqual(ergebnis, { ok: false, fehler: "einspielen_fehlgeschlagen" });
  for (const dateien of auftraege()) {
    assert.ok(
      dateien.includes("src/content/klickwache.js"),
      "kein Auftrag darf overlay.js ohne seine Wache in die Seite bringen"
    );
  }
});

test("Einspielen: läuft das Overlay schon, wird gar nichts eingespielt", async () => {
  const stand = { lebt: true };
  const { chrome, spur } = attrappeSetzen({
    tab: { ...EINSPIEL_TAB },
    seiteAntwortet: (n) => (n.typ === "overlay:ping" ? { ok: stand.lebt } : { ok: true }),
  });
  chrome.scripting.executeScript = async (auftrag) => {
    spur.push({ wohin: "executeScript", auftrag });
    return [{ result: null }];
  };
  const ergebnis = await overlaySicherstellen(EINSPIEL_TAB.id);
  assert.deepEqual(ergebnis, { ok: true, schonDa: true });
  assert.equal(spur.filter((e) => e.wohin === "executeScript").length, 0);
});

test("Einspielen: in den Freigabe-Ursprung wird nie eingespielt", async () => {
  /* Der Bestand aus DRAHTFORMAT §7.3, hier nur nachgemessen: Die Liste ändert
     daran nichts. Ein Skript in cloud.smartragents.ai spräche mit der Stimme
     dieses Ursprungs. */
  const { chrome, spur } = attrappeSetzen({
    tab: { ...EINSPIEL_TAB, url: "https://cloud.smartragents.ai/agenten" },
    seiteAntwortet: () => ({ ok: false }),
  });
  chrome.scripting.executeScript = async (auftrag) => {
    spur.push({ wohin: "executeScript", auftrag });
    return [{ result: null }];
  };
  const ergebnis = await overlaySicherstellen(EINSPIEL_TAB.id);
  assert.deepEqual(ergebnis, { ok: false, fehler: "ursprung_gesperrt" });
  assert.equal(spur.filter((e) => e.wohin === "executeScript").length, 0);
});

test("Modus: ein gestopptes Zeichen ist rot, auch aus der Automatik heraus", async () => {
  /* Der Inline-Stil mit !important schlägt auch das eigene Blatt im
     Schattenbaum. Bliebe der Verlauf stehen, sagte der Rahmen nach dem Stopp
     weiter „hier läuft etwas allein". */
  const { fragen, zustand } = await modusStarten();
  fragen({ typ: "overlay:modus", modus: "auto" });
  const rahmen = teilHolen(zustand, "rahmen");
  assert.ok(rahmen.style.getPropertyValue("border-image-source"), "erst läuft die Automatik");

  fragen({ typ: "overlay:gestoppt" });
  assert.equal(rahmen.getAttribute("data-zustand"), "gestoppt");
  assert.equal(
    rahmen.style.getPropertyValue("border-image-source"),
    "",
    "die Farbe der Automatik muss weg sein, sonst gewinnt sie gegen das Rot"
  );
  assert.equal(rahmen.style.getPropertyValue("box-shadow"), "");
});

test("Modus: ein totes Zeichen trägt keine Automatikfarbe mehr", async () => {
  const { fragen, zustand, sandbox } = await modusStarten();
  fragen({ typ: "overlay:modus", modus: "auto" });
  sandbox.chrome.runtime.__wirft = true;
  zustand.feuern("keydown", { key: "Escape" });
  zustand.feuern("keydown", { key: "Escape" });

  const rahmen = teilHolen(zustand, "rahmen");
  assert.equal(rahmen.getAttribute("data-zustand"), "tot");
  assert.equal(rahmen.style.getPropertyValue("border-image-source"), "");
  assert.equal(
    rahmen.getAttribute("data-modus"),
    null,
    "ein totes Zeichen hat keinen Betriebsmodus, sonst atmet es weiter in dessen Farbe"
  );
  assert.equal(teilHolen(zustand, "punkt").style.getPropertyValue("background-image"), "");
});

test("Modus: die Automatik atmet in ihrer eigenen Farbe, das tote Zeichen gar nicht", async () => {
  const seite = seiteBauen();
  const { zustand } = await overlayStarten(seite.alle);
  const regeln = regelnLesen(zustand.stil);
  const auto = regeln.find(
    (r) => r.selektor.includes('[data-modus="auto"]') && r.umgebung.includes("no-preference")
  );
  assert.ok(auto, "die Automatik braucht ihre eigene Bewegungsregel");
  assert.ok(
    auto.selektor.includes(":not([data-zustand])"),
    "sonst gewinnt sie gegen das tote und das gestoppte Zeichen, die früher im Blatt stehen"
  );
  const animation = String(auto.deklarationen.get("animation") || "");
  assert.ok(animation.includes("atmenAuto"), `keine eigene Bewegung gefunden: ${animation}`);
  assert.ok(zustand.stil.includes("@keyframes atmenAuto"), "die Bewegung muss es auch geben");
  /* Und der Schein trägt die Marke, nicht das Grün. */
  const stelle = zustand.stil.indexOf("@keyframes atmenAuto");
  assert.ok(
    zustand.stil.slice(stelle, stelle + 260).includes("91,141,239"),
    "ein blauer Rahmen mit grünem Schein wären zwei Aussagen auf einmal"
  );
});
