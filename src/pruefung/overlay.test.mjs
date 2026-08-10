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

/* ------------------------------------------------------------------ *
 * Attrappe des Seitenbaums
 * ------------------------------------------------------------------ */

let naechsteId = 0;

/* Eine Option einer Auswahlliste. `text` ist das Etikett, `value` das, was die
   Seite selbst benutzt — die beiden sind selten dasselbe. */
function option(text, wert, { disabled = false } = {}) {
  return { text, textContent: text, value: wert === undefined ? text : wert, disabled, selected: false };
}

function knoten(tag, {
  art = "element", // element | bereich | text
  attrs = {},
  text = "",
  rect = { left: 10, top: 20, width: 120, height: 30 },
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
  const el = {
    __art: art,
    __versteckt: versteckt,
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
    childNodes: text ? [{ nodeType: 3, nodeValue: text }] : [],
    __id: ++naechsteId,
    getAttribute: (n) => (n in attrs ? String(attrs[n]) : null),
    getBoundingClientRect: () => ({
      ...rect,
      bottom: rect.top + rect.height,
      right: rect.left + rect.width,
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

function umgebungBauen(elemente, etiketten = []) {
  /* `erzeugt` und `angehaengt` halten fest, WAS das Skript in die fremde
     Seite baut. Ohne diese zwei Listen war der Wirt-Knoten des Overlays
     (#smartrchrome-host) für keine Prüfung erreichbar — createElement gab ein
     namenloses Objekt zurück und appendChild warf es weg. Genau an diesem
     Knoten hängt aber die Abwehr gegen Seiten-CSS. */
  const zustand = { scrollY: 0, geschrieben: [], beobachter: [], erzeugt: [], angehaengt: [] };

  /* Eine Änderung am Seitenbaum melden — für die Ruhe-Bedingung von
     overlay:warten. */
  zustand.aendern = (ziel = {}) => {
    for (const b of zustand.beobachter) if (b.__aktiv) b.__ruf([{ target: ziel }]);
  };

  const document = {
    title: "Warenkorb",
    readyState: "complete",
    activeElement: null,
    body: { innerText: "" },
    documentElement: {
      /* Der Wirt ist der einzige Knoten, den das Overlay in die fremde Seite
         hängt. Er wird hier aufbewahrt statt verworfen, damit prüfbar bleibt,
         womit er sich gegen das CSS dieser Seite wehrt. */
      appendChild(n) {
        zustand.angehaengt.push(n);
        return n;
      },
      scrollHeight: 4000,
    },
    createElement: () => {
      const el = {
        style: { cssText: "" },
        className: "",
        id: "",
        innerHTML: "",
        textContent: "",
        dataset: {},
        setAttribute() {},
        removeAttribute() {},
        getAttribute: () => null,
        /* Der eigene Rahmen erkennt seine eigenen Knoten — overlay:warten darf
           die eigene Anzeige nicht für Bewegung der Seite halten. */
        contains: (n) => !!(n && n.__eigen),
        querySelector: () => ({ textContent: "" }),
        append() {},
        appendChild() {},
        attachShadow: () => ({
          adoptedStyleSheets: [],
          append() {},
        }),
      };
      zustand.erzeugt.push(el);
      return el;
    },
    querySelectorAll: () => elemente,
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
    get scrollY() {
      return zustand.scrollY;
    },
    scrollTo: (o) => {
      zustand.scrollY = Math.max(0, Math.round((o && o.top) || 0));
    },
    scrollBy: (o) => {
      zustand.scrollY = Math.max(0, zustand.scrollY + Math.round((o && o.top) || 0));
    },
    getComputedStyle: (el) =>
      el.__versteckt
        ? { visibility: "hidden", display: "none", opacity: "0" }
        : { visibility: "visible", display: "block", opacity: "1" },
    CSSStyleSheet: class {
      replaceSync() {}
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
        zustand.beobachter.push(this);
      }
      observe() {
        this.__aktiv = true;
      }
      disconnect() {
        this.__aktiv = false;
      }
    },
    chrome: {
      runtime: {
        __hoerer: null,
        onMessage: {
          addListener(f) {
            sandbox.chrome.runtime.__hoerer = f;
          },
        },
        sendMessage() {},
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};

  return { sandbox, zustand };
}

async function overlayStarten(elemente, etiketten = []) {
  const quelle = await readFile(QUELLE, "utf8");
  const { sandbox, zustand } = umgebungBauen(elemente, etiketten);
  vm.createContext(sandbox);
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
  assert.deepEqual(gut.mitte, { x: 70, y: 35 });

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
   document-Stumpf oben ohne Selektorauswertung, die Filter macht overlay.js. */
const schattenWurzel = (kinder) => ({ querySelectorAll: () => kinder });

test("Wahrnehmung: das Zustimmungsbanner im offenen Schattenbaum wird gesehen und bedienbar", async () => {
  const seite = seiteBauen();
  const knopf = knoten("button", { text: "Alle akzeptieren" });
  /* Ein Schatten im Schatten — Usercentrics verschachtelt seine Bausteine. */
  const tief = knoten("button", { text: "Auswahl speichern" });
  const innererWirt = knoten("div", {});
  innererWirt.shadowRoot = schattenWurzel([tief]);
  const banner = knoten("div", {});
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
