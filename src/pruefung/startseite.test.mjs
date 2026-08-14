/*
 * Pruefung der Startseite (Vertrag v3.5, Feature 2).
 *
 * Sie faehrt das Modul WIRKLICH: Jeder Pruefsatz geht durch `aufbauen()`, also
 * durch den Eintritt, den die Seitenleiste benutzt, und loest danach echte
 * Klicks aus. Das ist die Lehre vom 11.08.2026: An dem Tag lagen achtzehn
 * gruene Pruefsaetze ueber einer Verdeckungswache, die der ausgelieferte
 * Klickweg nirgends rief. Eine Pruefung, die eine Funktion einzeln anfasst,
 * belegt nur, dass diese Funktion rechnen kann, und nicht, dass sie im Betrieb
 * vorkommt.
 *
 * Die Nachbildung des Seitenbaums steht am Ende der Datei und ist absichtlich
 * klein. Sie kann genau das, was die Startseite wirklich anfasst, und sie
 * SCHREIBT MIT, wenn jemand `innerHTML` setzt: Fremdtext gehoert in
 * `textContent`, und diese Zusage laesst sich nur so messen.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, bevor panel/* geladen wird: rechte.js zieht
   dienste.js nach, und die liest beim Laden das Manifest. */
attrappeSetzen({ panelAntwortet: null });

const startseite = await import("../panel/startseite.js");

/* ------------------------------------------------------------------ *
 * Die Nachbildung des Seitenbaums
 * ------------------------------------------------------------------ */

function dokumentBauen() {
  const dok = {
    /* Jeder Versuch, Text als Markup einzusetzen, landet hier. Leer heisst:
       Es gab keinen. */
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
    /* Ein Klick, wie ein Mensch ihn ausloest, samt Abwarten der Zuhoerer. */
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

/** Alle Texte, die ein Mensch wirklich zu sehen bekommt. Ohne den Stil. */
function sichtbareTexte(el) {
  return alleKnoten(el)
    .filter((k) => k.tagName !== "STYLE")
    .map((k) => k._text)
    .filter((t) => t && t.trim());
}

const NORMAL = { id: 7, url: "https://geizhals.de/warenkorb", title: "Warenkorb", favIconUrl: "" };

/**
 * Eine Startseite aufbauen und fertig geladen zurueckgeben.
 *
 * Alles geht ueber `aufbauen`, den Eintritt, den panel.js benutzt.
 */
async function startseiteBauen({ tabs = [NORMAL], verbinden, trennen, tabsHolen } = {}) {
  const dok = dokumentBauen();
  const wurzel = knoten("div", dok);
  const gerufen = { verbinden: [], trennen: 0, tabsHolen: 0 };
  const griff = startseite.aufbauen(wurzel, {
    tabsHolen:
      tabsHolen ||
      (async () => {
        gerufen.tabsHolen += 1;
        return tabs;
      }),
    verbinden:
      verbinden === null
        ? undefined
        : verbinden ||
          (async (tab) => {
            gerufen.verbinden.push(tab);
            return { ok: true };
          }),
    trennen:
      trennen === null
        ? undefined
        : trennen ||
          (async () => {
            gerufen.trennen += 1;
            return { ok: true };
          }),
  });
  await griff.bereit;
  return { griff, wurzel, dok, gerufen };
}

/* ------------------------------------------------------------------ *
 * S1 — die Sperre, und zwar durch Weglassen
 * ------------------------------------------------------------------ */

test("S1: Ein Tab mit gesperrtem Ursprung steht nicht in der Liste", async () => {
  const { wurzel } = await startseiteBauen({
    tabs: [
      { id: 1, url: "https://cloud.smartragents.ai/chat", title: "Cloud" },
      { id: 2, url: "https://beta.cloud.smartragents.ai/", title: "Cloud beta" },
      { id: 3, url: "chrome://extensions", title: "Erweiterungen" },
      { id: 4, url: "file:///home/tongie/notiz.txt", title: "Notiz" },
      { id: 5, url: "about:blank", title: "Leer" },
      { id: 6, url: "chrome-extension://abcd/src/panel/panel.html", title: "Wir selbst" },
      NORMAL,
      { id: 8, url: "http://localhost:5173/", title: "Baustelle" },
    ],
  });

  const hosts = mitKlasse(wurzel, "sa-tab-host").map((k) => k.textContent);
  assert.deepEqual(hosts, ["geizhals.de", "localhost"]);

  /* Und die gesperrten Namen stehen NIRGENDS im Baum, auch nicht ausgegraut
     oder als Hinweis: Was nicht gilt, wird weggelassen. */
  const alles = sichtbareTexte(wurzel).join(" ");
  for (const wort of ["cloud.smartragents.ai", "chrome://", "file://", "about:blank"]) {
    assert.ok(!alles.includes(wort), `„${wort}" darf in der Liste nicht vorkommen`);
  }

  /* Gegenprobe zur Nachbildung: Ein Tab ohne Kennung faellt ebenfalls weg. */
  const ohne = await startseiteBauen({ tabs: [{ url: "https://ebay.de/", title: "eBay" }] });
  assert.equal(mitKlasse(ohne.wurzel, "sa-tab").length, 0);
});

test("S1b: Wird ein Tab nach dem Aufbau gesperrt, verbindet der Klick ihn nicht", async () => {
  const tab = { id: 7, url: "https://geizhals.de/warenkorb", title: "Warenkorb" };
  const { wurzel, gerufen } = await startseiteBauen({ tabs: [tab] });
  assert.equal(mitKlasse(wurzel, "sa-tab").length, 1);

  /* Zwischen dem Bauen der Zeile und dem Klick koennen Minuten liegen. */
  tab.url = "https://cloud.smartragents.ai/chat";
  await eins(wurzel, "sa-tab-verbinden").ausloesen("click");

  assert.deepEqual(gerufen.verbinden, [], "ein gesperrter Tab wird nie verbunden");
  assert.equal(eins(wurzel, "sa-start-hinweis").hidden, false, "und der Mensch hoert davon");
});

/* ------------------------------------------------------------------ *
 * S2 — das Sinnbild kommt aus dem Tab und wird nie gebaut
 * ------------------------------------------------------------------ */

test("S2: Kein Sinnbild von einer fremden Adresse, und keine selbst gebaute", async () => {
  const eigenes = "data:image/png;base64,iVBORw0KGgo=";
  const { wurzel } = await startseiteBauen({
    tabs: [
      { id: 1, url: "https://ebay.de/", title: "eBay", favIconUrl: eigenes },
      { id: 2, url: "https://amazon.de/", title: "Amazon", favIconUrl: "https://amazon.de/favicon.ico" },
      { id: 3, url: "https://blog.de/", title: "Blog", favIconUrl: "https://wanze.example/ping.gif" },
      { id: 4, url: "https://ohne.de/", title: "Ohne", favIconUrl: "" },
      { id: 5, url: "https://boese.de/", title: "Boese", favIconUrl: "javascript:alert(1)" },
      { id: 6, url: "https://auchboese.de/", title: "Auch", favIconUrl: "data:text/html,<script>1</script>" },
    ],
  });

  const zeilen = mitKlasse(wurzel, "sa-tab");
  assert.equal(zeilen.length, 6);

  const art = zeilen.map((z) => (eins(z, "sa-tab-bild") ? "bild" : "zeichen"));
  assert.deepEqual(art, ["bild", "bild", "zeichen", "zeichen", "zeichen", "zeichen"]);

  /* Die Quelle ist WOERTLICH das, was der Browser mitgegeben hat. Gebaut wird
     nichts, kein /favicon.ico und kein Sammeldienst. */
  const quellen = mitKlasse(wurzel, "sa-tab-bild").map((k) => k.getAttribute("src"));
  assert.deepEqual(quellen, [eigenes, "https://amazon.de/favicon.ico"]);

  /* Der Fremdhost taucht nirgends auf, auch nicht als Attribut. */
  const attribute = alleKnoten(wurzel).flatMap((k) => Object.values(k.attribute || {}));
  assert.ok(!attribute.some((w) => String(w).includes("wanze.example")));
  assert.ok(!attribute.some((w) => /javascript:/i.test(String(w))));
  assert.ok(!attribute.some((w) => /^data:text\/html/i.test(String(w))));

  /* Und das eigene Zeichen ist wirklich eines. */
  const zeichen = mitKlasse(wurzel, "sa-tab-zeichen").map((k) => k.textContent);
  assert.deepEqual(zeichen, ["B", "O", "B", "A"]);
});

test("S2b: faviconQuelle erteilt nie eine Erlaubnis, die ohne sie nicht dastuende", () => {
  /* Ueber alle Formen, die ein fremder Seitenkopf liefern kann: Es kommt
     entweder ein Bild aus derselben Adresse oder ein eigenes Zeichen heraus,
     niemals ein Ziel auf einem fremden Wirt. */
  const wirt = "https://ebay.de/artikel";
  const proben = [
    "https://tracker.example/p.gif",
    "http://ebay.de.boese.example/f.ico",
    "//ebay.de/favicon.ico",
    "javascript:fetch('https://x')",
    "data:text/html;base64,AAAA",
    "chrome://favicon/https://ebay.de",
    "",
    null,
    undefined,
    42,
  ];
  for (const roh of proben) {
    const raus = startseite.faviconQuelle({ id: 1, url: wirt, favIconUrl: roh });
    assert.equal(raus.art, "zeichen", `haette ein Bild geliefert: ${String(roh)}`);
  }
  /* Gegenprobe: Was durchgeht, geht woertlich durch. */
  const gut = startseite.faviconQuelle({ id: 1, url: wirt, favIconUrl: "https://ebay.de/f.ico" });
  assert.deepEqual(gut, { art: "bild", quelle: "https://ebay.de/f.ico" });
});

/* ------------------------------------------------------------------ *
 * S3 — Fremdtext bleibt Text
 * ------------------------------------------------------------------ */

test("S3: Ein Tab-Titel wird angezeigt, nie eingebaut", async () => {
  const boese = '<img src=x onerror="alert(1)"> Warenkorb';
  const { wurzel, dok } = await startseiteBauen({
    tabs: [{ id: 7, url: "https://geizhals.de/x", title: boese }],
  });

  assert.deepEqual(dok.verstoesse, [], "innerHTML wird an keiner Stelle gesetzt");
  const titel = eins(wurzel, "sa-tab-titel").textContent;
  assert.ok(titel.includes("<img"), "der Titel steht woertlich da");

  /* Steuerzeichen sind der billigste Weg, einem Vorleser etwas anderes sagen
     zu lassen, als dasteht. `saeubern` nimmt sie heraus. */
  const getarnt = `Waren${String.fromCodePoint(0x200b)}korb${String.fromCodePoint(0x202e)}!`;
  const mitSteuer = await startseiteBauen({
    tabs: [{ id: 7, url: "https://geizhals.de/x", title: getarnt }],
  });
  const sauber = eins(mitSteuer.wurzel, "sa-tab-titel").textContent;
  assert.ok(
    ![...sauber].some((z) => {
      const c = z.codePointAt(0);
      return c < 32 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f);
    }),
    `Steuerzeichen im Titel: ${JSON.stringify(sauber)}`
  );
});

/* ------------------------------------------------------------------ *
 * S4 — die Statuskarte
 * ------------------------------------------------------------------ */

test("S4: standSetzen faerbt den Punkt, nennt den Agenten und zeigt den Trennknopf", async () => {
  const { griff, wurzel } = await startseiteBauen();

  /* Anfangszustand, bevor irgendjemand etwas gesetzt hat. */
  assert.equal(eins(wurzel, "sa-punkt").className, "sa-punkt");
  assert.equal(eins(wurzel, "sa-trennen").hidden, true, "ohne Verbindung kein Trennknopf");

  griff.standSetzen({ verbunden: true, tab: { id: 7, url: "https://ebay.de/", title: "eBay" }, agent: "SMarTrCEO" });
  assert.equal(eins(wurzel, "sa-punkt").className, "sa-punkt an", "gruener Punkt");
  assert.equal(eins(wurzel, "sa-start-ziel").textContent, "eBay");
  assert.equal(eins(wurzel, "sa-start-agentname").textContent, "SMarTrCEO");
  assert.equal(eins(wurzel, "sa-start-agent").hidden, false);
  assert.equal(eins(wurzel, "sa-trennen").hidden, false);

  griff.standSetzen({ verbunden: false });
  assert.equal(eins(wurzel, "sa-punkt").className, "sa-punkt");
  assert.equal(eins(wurzel, "sa-start-ziel").textContent, "");
  assert.equal(eins(wurzel, "sa-start-agent").hidden, true, "der Agentenname bleibt nicht stehen");
  assert.equal(eins(wurzel, "sa-trennen").hidden, true);
});

test("S4b: Es gibt genau EINEN Weg zur Statuskarte, und der geht ueber den Griff", async () => {
  /*
   * Hier stand bis zum 14.08.2026 „Die freie Funktion standSetzen trifft die
   * zuletzt gebaute Startseite", und dieser Pruefsatz war gruen.
   *
   * Befund Abnahme 14.08.2026 (VERBINDUNG-6): Diese freie Funktion hat im
   * ganzen Baum niemand gerufen. Ein grep ueber src/ ohne pruefung fand
   * ausschliesslich `griff.standSetzen` in panel.js. Der Kommentar ueber der
   * Ausfuhr behauptete das Gegenteil, naemlich die Seitenleiste rufe sie aus
   * ihrem Nachrichtenempfaenger heraus. Damit lag ein gruener Pruefsatz ueber
   * einer Funktion, die im Produktivweg nie laeuft, und zwar ausgerechnet in
   * der Datei, deren tote Statusanzeige die Runde davor gemeldet hat.
   *
   * Die Ausfuhr ist weg, und dieser Satz haelt fest, dass sie weg BLEIBT: Ein
   * zweiter Weg zur selben Anzeige waere eine zweite Wahrheit darueber, was
   * verbunden ist. Dass der EINE Weg wirklich laeuft, misst
   * seitenleiste.test.mjs (T3, ZZM7, C4, VB*) am echten Modul im
   * Produktivweg — hier steht nur, dass es keinen zweiten gibt.
   */
  assert.equal(
    typeof startseite.standSetzen,
    "undefined",
    "eine freie Anzeige neben dem Griff ist eine zweite Wahrheit ueber denselben Zustand",
  );
  assert.equal(typeof startseite._zuruecksetzen, "undefined", "und ihr Modulgedaechtnis auch");

  /* Und die Gegenprobe, dass es den EINEN Weg gibt und er wirklich trifft:
     Zwei getrennt gebaute Startseiten steuern sich nicht gegenseitig. */
  const a = await startseiteBauen();
  const b = await startseiteBauen();
  a.griff.standSetzen({ verbunden: true, tab: { id: 7, url: "https://ebay.de/", title: "eBay" } });
  assert.equal(eins(a.wurzel, "sa-punkt").className, "sa-punkt an");
  assert.equal(eins(b.wurzel, "sa-punkt").className, "sa-punkt", "die zweite Seite bleibt unberuehrt");
});

/* ------------------------------------------------------------------ *
 * S5 — der Weg zum Verbinden
 * ------------------------------------------------------------------ */

test("S5: Der Klick reicht genau den gemeinten Tab weiter", async () => {
  const { wurzel, gerufen } = await startseiteBauen({
    tabs: [
      { id: 7, url: "https://geizhals.de/", title: "Geizhals" },
      { id: 9, url: "https://ebay.de/", title: "eBay" },
    ],
  });
  const knoepfe = mitKlasse(wurzel, "sa-tab-verbinden");
  assert.equal(knoepfe.length, 2);
  await knoepfe[1].ausloesen("click");
  assert.equal(gerufen.verbinden.length, 1);
  assert.equal(gerufen.verbinden[0].id, 9);
});

test("S5b: Ein Dienst, der wirft, wird zu einer Aussage und nicht zu einem Absturz", async () => {
  const { wurzel } = await startseiteBauen({
    verbinden: async () => {
      throw new Error("Leitung tot");
    },
  });
  await eins(wurzel, "sa-tab-verbinden").ausloesen("click");
  const hinweis = eins(wurzel, "sa-start-hinweis");
  assert.equal(hinweis.hidden, false);
  assert.ok(hinweis.textContent.length > 10, "und es ist ein Satz, kein Code");
});

test("S5c: Eine benannte Absage steht woertlich da, statt durch einen Allgemeinplatz ersetzt zu werden", async () => {
  const { wurzel } = await startseiteBauen({
    verbinden: async () => ({ ok: false, satz: "Fuer diese Seite fehlt die Freigabe des Browsers." }),
  });
  await eins(wurzel, "sa-tab-verbinden").ausloesen("click");
  assert.equal(
    eins(wurzel, "sa-start-hinweis").textContent,
    "Fuer diese Seite fehlt die Freigabe des Browsers."
  );
});

test("S5d: Ein Dienst, der fehlt, laesst den Knopf weg statt ihn abzuschalten", async () => {
  const { wurzel } = await startseiteBauen({ verbinden: null, trennen: null });
  assert.equal(mitKlasse(wurzel, "sa-tab-verbinden").length, 0);
  assert.equal(mitKlasse(wurzel, "sa-trennen").length, 0);
  /* Nirgends im Baum steht ein abgeschaltetes Bedienelement. */
  for (const k of alleKnoten(wurzel)) {
    assert.equal(k.getAttribute("disabled"), null, "kein ausgegrauter Schalter");
    assert.notEqual(k.disabled, true);
  }
});

test("S5e: Der Trennknopf ruft trennen und verschwindet erst mit dem neuen Stand", async () => {
  const { griff, wurzel, gerufen } = await startseiteBauen();
  griff.standSetzen({ verbunden: true, tab: NORMAL, agent: "SMarTrCEO" });
  await eins(wurzel, "sa-trennen").ausloesen("click");
  assert.equal(gerufen.trennen, 1);
  /* Solange niemand einen neuen Stand meldet, behauptet die Oberflaeche
     keine Trennung. */
  assert.equal(eins(wurzel, "sa-trennen").hidden, false);
  griff.standSetzen({ verbunden: false });
  assert.equal(eins(wurzel, "sa-trennen").hidden, true);
});

/* ------------------------------------------------------------------ *
 * S6 — es gibt keinen stummen Ausgang
 * ------------------------------------------------------------------ */

test("S6: Bricht das Holen der Tabs, steht ein Satz da und keine leere Liste", async () => {
  const { wurzel, griff } = await startseiteBauen({
    tabsHolen: async () => {
      throw new Error("kein Zugriff");
    },
  });
  assert.equal(mitKlasse(wurzel, "sa-tab").length, 0);
  const hinweis = eins(wurzel, "sa-start-hinweis");
  assert.equal(hinweis.hidden, false);
  assert.equal(hinweis.getAttribute("data-i18n"), "start_tabs_nicht_geladen");
  assert.ok(griff.ok, "aufbauen selbst wirft nicht");
});

test("S6b: Sind alle Tabs gesperrt, sagt die Startseite das, statt leer dazustehen", async () => {
  const { wurzel } = await startseiteBauen({
    tabs: [{ id: 1, url: "chrome://extensions", title: "x" }],
  });
  const hinweis = eins(wurzel, "sa-start-hinweis");
  assert.equal(hinweis.hidden, false);
  assert.equal(hinweis.getAttribute("data-i18n"), "start_leer");
});

test("S6c: Ohne Anker gibt aufbauen eine Antwort und wirft nicht", () => {
  for (const nichts of [null, undefined, {}, 42, "x"]) {
    const raus = startseite.aufbauen(nichts, {});
    assert.equal(raus.ok, false);
    assert.equal(raus.grund, "kein_anker");
  }
});

/* ------------------------------------------------------------------ *
 * S7 — Deckel und Sprache
 * ------------------------------------------------------------------ */

test("S7: Die Liste wird gedeckelt", async () => {
  const viele = [];
  for (let i = 0; i < startseite.TABS_HOECHSTENS + 25; i++) {
    viele.push({ id: i + 1, url: `https://nummer${i}.example/`, title: `Tab ${i}` });
  }
  const { wurzel } = await startseiteBauen({ tabs: viele });
  assert.equal(mitKlasse(wurzel, "sa-tab").length, startseite.TABS_HOECHSTENS);
});

test("S7b: Jeder feste Text traegt eine Sprachmarke, und keiner traegt einen Gedankenstrich", async () => {
  const { griff, wurzel } = await startseiteBauen();
  griff.standSetzen({ verbunden: true, tab: NORMAL, agent: "SMarTrCEO" });

  const marken = alleKnoten(wurzel)
    .map((k) => k.getAttribute("data-i18n"))
    .filter(Boolean);
  assert.ok(marken.length >= 5, "die feste Beschriftung ist ausgezeichnet");
  for (const m of marken) {
    assert.match(m, /^start_[a-z0-9_]*$/, `Schluessel ausserhalb des Bereichs: ${m}`);
  }

  /* Der Inhaber laesst sich die Oberflaeche vorlesen, und ein Gedankenstrich
     wird als Pause gelesen, die den Satz zerreisst. */
  for (const t of sichtbareTexte(wurzel)) {
    assert.ok(!/[—–]/.test(t), `Gedankenstrich im Text: ${t}`);
  }
});

test("S7c: Die Beschriftung des Verbindungsknopfes nennt das Ziel fuer den Bildschirmleser", async () => {
  const { wurzel } = await startseiteBauen({
    tabs: [{ id: 9, url: "https://ebay.de/", title: "eBay" }],
  });
  assert.equal(eins(wurzel, "sa-tab-verbinden").getAttribute("aria-label"), "Verbinden mit ebay.de");
});
