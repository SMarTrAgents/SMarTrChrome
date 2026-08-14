/*
 * Prüfung von `src/net/matrix.js` — die Domainregeln und die Agentenmatrix
 * (Vertrag v3.5 §4).
 *
 * Zwei Zusagen tragen diese Datei, und beide werden hier gegen die echte
 * Ablage der Attrappe gemessen, nicht gegen einen Nachbau:
 *
 *   1. **Voreinstellung ist alles aus.** Unbekannter Agent, unbekannter Host,
 *      unbekannte Klasse: `false`. Eine Matrix, die im Zweifel erlaubt, ist
 *      keine.
 *   2. **Ein gesperrter Host wird durch KEINE Eintragung wieder frei.** Wer
 *      sperrt und danach freischaltet, hat sich widersprochen, und im
 *      Widerspruch gilt die Sperre.
 *
 * Zu jeder Sperre steht ein Gegentest daneben. Eine Matrix, die alles ablehnt,
 * ist von einer richtigen nicht zu unterscheiden und ist kein Produkt.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

const {
  AGENTEN,
  AGENT_KLASSEN,
  MATRIX_ABLAGE,
  MATRIX_VERSION,
  agentDarf,
  hostMuster,
  matrixLesen,
  matrixPruefen,
  matrixSchreiben,
  regelnFuer,
} = await import("../net/matrix.js");

/* Was wirklich in der Ablage steht. Nicht der Rückgabewert der Funktion —
   der Befund vom 11.08.2026 in seiner allgemeinen Form lautet: Gemessen wird
   die Wirkung, nicht die Absicht. */
function ausAblage(chrome) {
  return chrome.storage.local.get(MATRIX_ABLAGE).then((d) => d[MATRIX_ABLAGE]);
}

const VOLL = {
  version: 1,
  domains: { "ebay.de": { frei: ["senden", "formular"] } },
  gesperrt: ["*.sparkasse.de", "bank.de"],
  agenten: {
    SMarTrTrader: { "tradingview.com": ["lesen"] },
    SMarTrCEO: { "ebay.de": ["lesen", "bedienen", "workflow"] },
  },
};

test("M1 — Ohne Eintragung ist alles aus, und die Matrix ist trotzdem vollständig", async () => {
  attrappeSetzen();
  const m = await matrixLesen();
  assert.deepEqual(m, { version: MATRIX_VERSION, domains: {}, gesperrt: [], agenten: {} });

  /* Kein Aufrufer trifft auf `undefined`, und niemand darf etwas. */
  const regeln = await regelnFuer("ebay.de");
  assert.deepEqual(regeln, { gesperrt: false, frei: [] });
  for (const agent of AGENTEN) {
    for (const klasse of AGENT_KLASSEN) {
      assert.equal(await agentDarf(agent, "ebay.de", klasse), false, `${agent}/${klasse}`);
    }
  }
});

test("M2 — Auch ohne Browser gibt es eine Antwort, keine Ausnahme", async () => {
  /* Der Hintergrunddienst stirbt und wird neu gestartet; in dem Augenblick
     kann `chrome.storage` fehlen. Eine Ausnahme hier risse den ganzen Befehl
     mit, statt ihn abzulehnen. */
  const vorher = globalThis.chrome;
  globalThis.chrome = undefined;
  try {
    assert.deepEqual(await matrixLesen(), { version: MATRIX_VERSION, domains: {}, gesperrt: [], agenten: {} });
    assert.deepEqual(await regelnFuer("ebay.de"), { gesperrt: false, frei: [] });
    assert.equal(await agentDarf("SMarTrCEO", "ebay.de", "lesen"), false);
    const e = await matrixSchreiben(VOLL);
    assert.equal(e.ok, false);
    assert.equal(e.code, "ablage_fehler");
    assert.ok(e.satz.length > 0 && e.hinweis.length > 0);
  } finally {
    globalThis.chrome = vorher;
  }
});

test("M3 — `agentDarf` sagt Nein zu unbekanntem Agenten, Host und Klasse", async () => {
  attrappeSetzen({ ablageLocal: { [MATRIX_ABLAGE]: VOLL } });

  /* Der Gegentest zuerst, damit „lehnt alles ab" auffiele. */
  assert.equal(await agentDarf("SMarTrCEO", "ebay.de", "lesen"), true);
  assert.equal(await agentDarf("SMarTrCEO", "ebay.de", "workflow"), true);
  assert.equal(await agentDarf("SMarTrTrader", "tradingview.com", "lesen"), true);

  /* Unbekannter Agent. Der Name kommt vom Relay, also aus einer Quelle, die
     wir nicht selbst schreiben. */
  for (const agent of ["", null, undefined, "a0", "SMarTrCeo", "smartrceo", "SMarTrTraderX", "__proto__", "constructor"]) {
    assert.equal(await agentDarf(agent, "ebay.de", "lesen"), false, String(agent));
  }
  /* Unbekannter Host. */
  for (const host of ["", null, "amazon.de", "ebay.de.angreifer.de", "*.ebay.de", "javascript:alert(1)", "ebay..de", "-ebay.de"]) {
    assert.equal(await agentDarf("SMarTrCEO", host, "lesen"), false, String(host));
  }
  /* Unbekannte Klasse. */
  for (const klasse of ["", null, "alles", "full", "LESEN", "toString", "__proto__"]) {
    assert.equal(await agentDarf("SMarTrCEO", "ebay.de", klasse), false, String(klasse));
  }
  /* Und eine Klasse, die dieser Agent auf diesem Host nicht hat. */
  assert.equal(await agentDarf("SMarTrTrader", "tradingview.com", "bedienen"), false);
  assert.equal(await agentDarf("SMarTrTrader", "ebay.de", "lesen"), false);
});

test("M4 — Ein gesperrter Host wird durch KEINE Eintragung wieder frei", async () => {
  /* Der Widerspruch, den ein Mensch versehentlich einträgt: derselbe Host
     gesperrt UND freigeschaltet UND einem Agenten zugestanden. */
  attrappeSetzen({
    ablageLocal: {
      [MATRIX_ABLAGE]: {
        version: 1,
        domains: { "bank.de": { frei: ["senden", "formular"] }, "sub.sparkasse.de": { frei: ["senden"] } },
        gesperrt: ["bank.de", "*.sparkasse.de"],
        agenten: { SMarTrCEO: { "bank.de": ["lesen", "bedienen", "workflow"], "sub.sparkasse.de": ["lesen"] } },
      },
    },
  });

  for (const host of ["bank.de", "sub.sparkasse.de", "www.sub.sparkasse.de", "sparkasse.de"]) {
    const regeln = await regelnFuer(host);
    assert.equal(regeln.gesperrt, true, host);
    assert.deepEqual(regeln.frei, [], `${host}: eine Sperre mit Ausnahmen ist keine Sperre`);
    for (const klasse of AGENT_KLASSEN) {
      assert.equal(await agentDarf("SMarTrCEO", host, klasse), false, `${host}/${klasse}`);
    }
  }

  /* Gegentest: ein Host, der nur ähnlich heisst, ist nicht gesperrt. */
  const fremd = await regelnFuer("bank.de.angreifer.de");
  assert.equal(fremd.gesperrt, false);
  assert.equal((await regelnFuer("meine-bank.de")).gesperrt, false);
});

test("M5 — `hostMuster`: der Platzhalter gilt nur ganz vorn und nie allein", async () => {
  assert.equal(hostMuster("bank.de", "bank.de"), true);
  assert.equal(hostMuster("BANK.DE.", "bank.de"), true);
  assert.equal(hostMuster("bank.de", "shop.bank.de"), false);
  assert.equal(hostMuster("*.bank.de", "shop.bank.de"), true);
  assert.equal(hostMuster("*.bank.de", "a.b.bank.de"), true);
  assert.equal(hostMuster("*.bank.de", "bank.de"), true);
  assert.equal(hostMuster("*.bank.de", "bank.de.angreifer.de"), false);
  assert.equal(hostMuster("*.bank.de", "meinebank.de"), false);

  /* Was kein Muster ist, passt auf nichts. `*` wäre das halbe Netz, `*.de`
     eine ganze Länderendung, und ein Platzhalter in der Mitte ist keiner. */
  for (const muster of ["*", "*.de", "*.", "**", "bank.*", "ba*nk.de", "", null, undefined, "https://bank.de", "bank.de:8443", "bank.de/konto", "bank..de", 7]) {
    assert.equal(hostMuster(muster, "bank.de"), false, String(muster));
    assert.equal(hostMuster(muster, "shop.bank.de"), false, String(muster));
  }
  /* Und eine Frage, die selbst ein Muster ist, wird nicht beantwortet: Sonst
     beantwortete sich die Sperrliste selbst. */
  assert.equal(hostMuster("*.bank.de", "*.bank.de"), false);
  assert.equal(hostMuster("bank.de", "*.bank.de"), false);

  /* Unter einem Platzhalter kein Punycode: `xn--bnk-bld.example.de` liest sich
     im Klartext wie ein ganz anderer Name. Dieselbe Regel wie in
     `bereichBefund`, und sie muss dieselbe bleiben. */
  assert.equal(hostMuster("*.example.de", "xn--bnk-bld.example.de"), false);
  assert.equal(hostMuster("xn--bnk-bld.example.de", "xn--bnk-bld.example.de"), true);
  assert.equal(hostMuster("*.xn--mnchen-3ya.de", "shop.xn--mnchen-3ya.de"), true);
});

test("M6 — Schreiben und Lesen gehen wirklich durch die Ablage", async () => {
  const { chrome } = attrappeSetzen();
  const e = await matrixSchreiben(VOLL);
  assert.equal(e.ok, true);

  /* Gemessen an dem, was WIRKLICH in der Ablage liegt. */
  const roh = await ausAblage(chrome);
  assert.ok(roh, "nichts geschrieben");
  assert.deepEqual(roh.gesperrt, ["*.sparkasse.de", "bank.de"]);
  assert.deepEqual(roh.domains["ebay.de"], { frei: ["senden", "formular"] });

  const gelesen = await matrixLesen();
  assert.deepEqual(gelesen.agenten.SMarTrCEO, { "ebay.de": ["lesen", "bedienen", "workflow"] });
  assert.equal(gelesen.version, MATRIX_VERSION);

  const regeln = await regelnFuer("ebay.de");
  assert.deepEqual(regeln, { gesperrt: false, frei: ["senden", "formular"] });
});

test("M7 — Was der Mensch einträgt, wird ganz geprüft oder ganz abgelehnt", async () => {
  const schlecht = [
    ["kein Objekt", null],
    ["Liste", []],
    ["unbekanntes Feld", { ...VOLL, erlaubt: true }],
    ["fremde Fassung", { ...VOLL, version: 2 }],
    ["Sperrliste ist keine Liste", { gesperrt: "bank.de" }],
    ["Sperrmuster taugt nicht", { gesperrt: ["*"] }],
    ["Sperrmuster mit Port", { gesperrt: ["bank.de:8443"] }],
    ["Domain ist kein Host", { domains: { "*": { frei: [] } } }],
    ["Domaineintrag mit fremdem Feld", { domains: { "ebay.de": { frei: [], immer: true } } }],
    ["harte Klasse freigeschaltet", { domains: { "ebay.de": { frei: ["zahlung"] } } }],
    ["erfundene Klasse", { domains: { "ebay.de": { frei: ["alles"] } } }],
    ["unbekannter Agent", { agenten: { A0: { "ebay.de": ["lesen"] } } }],
    ["Agent ohne Objekt", { agenten: { SMarTrCEO: ["lesen"] } }],
    ["erfundene Befugnis", { agenten: { SMarTrCEO: { "ebay.de": ["full"] } } }],
  ];

  for (const [was, roh] of schlecht) {
    const { chrome } = attrappeSetzen();
    const e = await matrixSchreiben(roh);
    assert.equal(e.ok, false, was);
    assert.equal(typeof e.code, "string", was);
    assert.ok(e.satz.length > 0, was);
    assert.ok(e.hinweis.length > 0, `${was}: ohne Hinweis weiss der Mensch nicht, was er ändern soll`);
    /* Und der eigentliche Punkt: Es wurde NICHTS gespeichert. Eine halbe
       Matrix wäre schlimmer als gar keine, weil der Mensch glaubte, er habe
       etwas eingerichtet. */
    assert.equal(await ausAblage(chrome), undefined, `${was}: trotzdem geschrieben`);
  }

  /* Gegentest: Die harte Klasse wird abgelehnt, die weiche geht durch. */
  attrappeSetzen();
  assert.equal((await matrixSchreiben({ domains: { "ebay.de": { frei: ["senden"] } } })).ok, true);
  assert.equal(matrixPruefen({ domains: { "ebay.de": { frei: ["geheim"] } } }).code, "klasse_ungueltig");
});

test("M8 — Ein beschädigter Speicher erlaubt nie mehr als ein leerer", async () => {
  /* Beim LESEN wird gerettet, was zu retten ist, und zwar nur in Richtung
     „weniger Erlaubnis": Eine unbrauchbare Erlaubnis fällt weg, eine
     unbrauchbare Sperre nimmt die brauchbaren nicht mit. Ein Ausfall, der
     Sperren aufhebt, wäre der schlechteste denkbare Ausfall. */
  attrappeSetzen({
    ablageLocal: {
      [MATRIX_ABLAGE]: {
        version: 1,
        erlaubtAlles: true,
        gesperrt: ["*.sparkasse.de", "*", 7, "bank.de/konto", "bank.de"],
        domains: {
          "ebay.de": { frei: ["senden", "zahlung", "geheim", "erfunden"] },
          "*": { frei: ["senden"] },
          "kaputt.de": "ja",
        },
        agenten: {
          SMarTrCEO: { "ebay.de": ["lesen", "full", "workflow"] },
          Fremder: { "ebay.de": ["lesen"] },
        },
      },
    },
  });

  const m = await matrixLesen();
  assert.deepEqual(m.gesperrt, ["*.sparkasse.de", "bank.de"]);
  assert.deepEqual(Object.keys(m.domains), ["ebay.de"]);
  assert.deepEqual(m.domains["ebay.de"].frei, ["senden"]);
  assert.deepEqual(Object.keys(m.agenten), ["SMarTrCEO"]);
  assert.deepEqual(m.agenten.SMarTrCEO["ebay.de"], ["lesen", "workflow"]);
  assert.equal(m.erlaubtAlles, undefined);

  assert.equal(await agentDarf("SMarTrCEO", "ebay.de", "full"), false);
  assert.equal(await agentDarf("Fremder", "ebay.de", "lesen"), false);
  assert.equal((await regelnFuer("bank.de")).gesperrt, true);
  assert.deepEqual((await regelnFuer("ebay.de")).frei, ["senden"]);

  /* Und ganz kaputt heisst leer, nicht offen. */
  for (const muell of ["kaputt", 7, [], null]) {
    attrappeSetzen({ ablageLocal: { [MATRIX_ABLAGE]: muell } });
    const leer = await matrixLesen();
    assert.deepEqual(leer.domains, {}, String(muell));
    assert.deepEqual(leer.agenten, {}, String(muell));
    assert.equal(await agentDarf("SMarTrCEO", "ebay.de", "lesen"), false, String(muell));
  }
});

test("M9 — Ein Host, den niemand lesen kann, gilt als gesperrt", async () => {
  attrappeSetzen({ ablageLocal: { [MATRIX_ABLAGE]: VOLL } });
  for (const host of ["", null, undefined, "*", "*.ebay.de", "ebay..de", "javascript:alert(1)", "a".repeat(300)]) {
    assert.deepEqual(await regelnFuer(host), { gesperrt: true, frei: [] }, String(host));
  }
  /* Gegentest: eine ganze Adresse ist als Frage erlaubt und wird auf ihren
     Wirt zurückgeführt. Sonst sähe der Ausführer jede Seite als gesperrt, und
     eine Sperre aus einem Formatfehler sucht niemand an der richtigen Stelle. */
  assert.deepEqual(await regelnFuer("https://ebay.de/kasse"), { gesperrt: false, frei: ["senden", "formular"] });
  assert.deepEqual(await regelnFuer("EBAY.DE."), { gesperrt: false, frei: ["senden", "formular"] });
});

test("M10 — Ein Domainmuster gilt auch für Unterseiten, und `frei` bleibt weich", async () => {
  attrappeSetzen();
  const e = await matrixSchreiben({
    domains: { "*.ebay.de": { frei: ["senden"] }, "ebay.de": { frei: ["formular"] } },
  });
  assert.equal(e.ok, true);
  /* Beide Einträge treffen auf `ebay.de`, und was der Mensch geschrieben hat,
     gilt zusammen. */
  const apex = await regelnFuer("ebay.de");
  assert.equal(apex.gesperrt, false);
  assert.deepEqual([...apex.frei].sort(), ["formular", "senden"]);
  assert.deepEqual((await regelnFuer("www.ebay.de")).frei, ["senden"]);
  assert.deepEqual((await regelnFuer("ebay.com")).frei, []);
  for (const k of apex.frei) assert.ok(["senden", "formular", "tab_neu"].includes(k), k);
});
