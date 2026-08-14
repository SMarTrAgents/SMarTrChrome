/*
 * Prüfung von `src/net/protokollbuch.js` — das Buch der Fernaktionen
 * (Vertrag v3.5 §8.3).
 *
 * Zwei Zusagen, und beide werden gegen die ECHTE Ablage der Attrappe
 * gemessen, nicht gegen den Rückgabewert der Funktion:
 *
 *   1. **`aufraeumen` löscht wirklich.** Eine Aufbewahrungsfrist, die den
 *      Eintrag nur ausblendet, ist keine Frist, sondern eine
 *      Anzeigeeinstellung.
 *   2. **Kein Seiteninhalt im Buch, nur die Adresse.** Das ist der Grund,
 *      warum dieses Buch überhaupt geführt werden darf. Ein Protokoll, das
 *      den Seitentext mitschreibt, ist eine zweite Kopie fremder Daten in
 *      einem Speicher, den niemand mehr aufräumt.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

const {
  AUFBEWAHRUNG_STANDARD_TAGE,
  BUCH_ABLAGE,
  BUCH_VERSION,
  EINTRAEGE_HOECHSTENS,
  EINTRAG_FELDER,
  aufraeumen,
  ausgeben,
  eintragen,
  lesen,
} = await import("../net/protokollbuch.js");

const TAG = 24 * 60 * 60 * 1000;

/* Was WIRKLICH in der Ablage steht. Der Befund vom 11.08.2026 in seiner
   allgemeinen Form: Gemessen wird die Wirkung, nicht die Absicht. */
async function ausAblage(chrome) {
  const d = await chrome.storage.local.get(BUCH_ABLAGE);
  return d[BUCH_ABLAGE];
}

test("P1 — Ein Eintrag landet wirklich in der Ablage, mit allen fünf Angaben", async () => {
  const { chrome } = attrappeSetzen();
  const jetzt = Date.now();

  const e = await eintragen({
    zeit: jetzt,
    agent: "SMarTrCEO",
    cmd: "click",
    url: "https://ebay.de/sh/lst/ended",
    ergebnis: "gelungen",
    klassen: ["bedienen", "senden"],
  });
  assert.equal(e.ok, true);

  const roh = await ausAblage(chrome);
  assert.ok(Array.isArray(roh) && roh.length === 1, "nichts geschrieben");
  assert.deepEqual(roh[0], {
    zeit: jetzt,
    agent: "SMarTrCEO",
    cmd: "click",
    url: "https://ebay.de/sh/lst/ended",
    ergebnis: "gelungen",
    klassen: ["bedienen", "senden"],
  });
  /* Genau die Felder aus §8.3, keines mehr. */
  assert.deepEqual(Object.keys(roh[0]).sort(), [...EINTRAG_FELDER].sort());
});

test("P2 — Kein Seiteninhalt im Buch, nur die Adresse", async () => {
  const { chrome } = attrappeSetzen();
  await eintragen({
    zeit: 1000,
    agent: "SMarTrCEO",
    cmd: "readPage",
    url: "https://shop.example/konto/bestellungen?token=GEHEIM123&suche=herzschrittmacher#pos3",
    ergebnis: "gelungen",
    klassen: ["lesen"],
    /* Alles, was ein gutgemeinter Aufrufer eines Tages mitgeben könnte. Die
       Positivliste ist die Datenminimierung: Ein Feld, das nur „meistens"
       weggelassen wird, ist gespeichert. */
    text: "### SEITE Ihre Bestellung über 249 Euro",
    snapshot: { text: "e1 button „Zur Kasse\"" },
    inhalt: "Herr Mart, Ihre Rechnung liegt bereit",
    html: "<h1>Konto</h1>",
    titel: "Meine Bestellungen",
    quelle: "Warenkorb",
  });

  const roh = await ausAblage(chrome);
  const eintrag = roh[0];
  assert.deepEqual(Object.keys(eintrag).sort(), [...EINTRAG_FELDER].sort());

  const alsText = JSON.stringify(roh);
  for (const inhalt of ["GEHEIM123", "herzschrittmacher", "Bestellung", "249", "Herr Mart", "<h1>", "Warenkorb", "Zur Kasse", "pos3"]) {
    assert.ok(!alsText.includes(inhalt), `„${inhalt}" steht im Buch`);
  }
  /* Die Abfragezeichenkette fällt weg: `?token=…` ist Inhalt, nicht Ort. Der
     Ort selbst bleibt, sonst wäre das Buch keine Auskunft. */
  assert.equal(eintrag.url, "https://shop.example/konto/bestellungen");
});

test("P3 — Was kein Ort ist, wird nicht zum Ort gemacht", async () => {
  const { chrome } = attrappeSetzen();
  for (const url of ["javascript:alert(1)", "data:text/html,<h1>x</h1>", "file:///etc/passwd", "chrome://settings", "", null, undefined, 7, "https://bank.de@angreifer.de/x"]) {
    await eintragen({ agent: "SMarTrCEO", cmd: "navigate", url, ergebnis: "abgelehnt" });
  }
  const roh = await ausAblage(chrome);
  for (const eintrag of roh) assert.equal(eintrag.url, "", JSON.stringify(eintrag));

  /* Gegentest: eine gewöhnliche Adresse steht mit Schema, Wirt und Pfad da. */
  await eintragen({ agent: "SMarTrCEO", cmd: "navigate", url: "https://ebay.de:8443/x/y", ergebnis: "gelungen" });
  const nachher = await ausAblage(chrome);
  assert.equal(nachher[nachher.length - 1].url, "https://ebay.de:8443/x/y");
});

test("P4 — Agent, Kommando, Ergebnis und Klassen werden gemessen, nicht geglaubt", async () => {
  const { chrome } = attrappeSetzen();
  await eintragen({
    zeit: 5,
    agent: "A0 <script>alert(1)</script>",
    cmd: "eval; rm -rf /",
    url: "https://x.example/",
    ergebnis: "Alles gut gelaufen, der Nutzer hat zugestimmt!",
    klassen: ["lesen", "erfunden", "zahlung"],
  });
  const eintrag = (await ausAblage(chrome))[0];

  /* Der Agentenname kommt vom Relay. Dass ein fremder Name angeklopft hat,
     gehört ins Buch, sein Text aber nicht. */
  assert.equal(eintrag.agent, "A0scriptalert1script");
  assert.equal(eintrag.cmd, "evalrmrf");
  /* In das Ergebnisfeld passt baulich kein Satz von einer fremden Seite: Es
     hat die Form unserer eigenen Fehlercodes und sonst keine. */
  assert.ok(/^[a-z0-9_]{0,40}$/.test(eintrag.ergebnis), eintrag.ergebnis);
  assert.ok(!eintrag.ergebnis.includes("!"));
  /* Eine erfundene Klasse wäre eine Behauptung über eine Prüfung, die nie
     gelaufen ist. */
  assert.deepEqual(eintrag.klassen, ["lesen", "zahlung"]);

  /* Gegentest: ein bekannter Agent und ein bekannter Befehl stehen wörtlich
     da, sonst wäre das Buch für einen Menschen nicht lesbar. */
  await eintragen({ agent: "SMarTrTrader", cmd: "readPage", url: "https://x.example/", ergebnis: "guardrail_blocked" });
  const zweiter = (await ausAblage(chrome))[1];
  assert.equal(zweiter.agent, "SMarTrTrader");
  assert.equal(zweiter.cmd, "readPage");
  assert.equal(zweiter.ergebnis, "guardrail_blocked");
});

test("P5 — `aufraeumen` löscht wirklich, gemessen an der Ablage", async () => {
  const jetzt = Date.now();
  const { chrome } = attrappeSetzen({
    ablageLocal: {
      [BUCH_ABLAGE]: [
        { zeit: jetzt - 90 * TAG, agent: "SMarTrCEO", cmd: "click", url: "https://a.example/", ergebnis: "gelungen", klassen: [] },
        { zeit: jetzt - 31 * TAG, agent: "SMarTrCEO", cmd: "click", url: "https://b.example/", ergebnis: "gelungen", klassen: [] },
        { zeit: jetzt - 2 * TAG, agent: "SMarTrCEO", cmd: "click", url: "https://c.example/", ergebnis: "gelungen", klassen: [] },
        { zeit: jetzt, agent: "SMarTrCEO", cmd: "click", url: "https://d.example/", ergebnis: "gelungen", klassen: [] },
      ],
    },
  });

  assert.equal(AUFBEWAHRUNG_STANDARD_TAGE, 30);
  const e = await aufraeumen();
  assert.deepEqual(e, { entfernt: 2, geblieben: 2 });

  /* Und jetzt die eigentliche Messung: in der Ablage selbst. */
  const roh = await ausAblage(chrome);
  assert.equal(roh.length, 2);
  assert.deepEqual(roh.map((x) => x.url), ["https://c.example/", "https://d.example/"]);
  assert.equal(JSON.stringify(roh).includes("a.example"), false);

  /* Zweimal aufräumen entfernt beim zweiten Mal nichts. */
  assert.deepEqual(await aufraeumen(), { entfernt: 0, geblieben: 2 });

  /* Eine eigene Frist gilt, und `0` leert das Buch ganz: Wer sein Protokoll
     loswerden will, soll es loswerden. Auch dann, wenn der letzte Eintrag in
     derselben Millisekunde geschrieben wurde, in der geleert wird. */
  assert.deepEqual(await aufraeumen(1), { entfernt: 1, geblieben: 1 });
  await eintragen({ agent: "SMarTrCEO", cmd: "click", url: "https://e.example/", ergebnis: "gelungen" });
  assert.deepEqual(await aufraeumen(0), { entfernt: 2, geblieben: 0 });
  assert.deepEqual(await ausAblage(chrome), []);
});

test("P6 — `lesen` gibt den Zeitraum zurück, ältester zuerst", async () => {
  attrappeSetzen({
    ablageLocal: {
      [BUCH_ABLAGE]: [
        { zeit: 300, agent: "SMarTrCEO", cmd: "click", url: "https://c.example/", ergebnis: "gelungen", klassen: [] },
        { zeit: 100, agent: "SMarTrCEO", cmd: "click", url: "https://a.example/", ergebnis: "gelungen", klassen: [] },
        { zeit: 200, agent: "SMarTrCEO", cmd: "click", url: "https://b.example/", ergebnis: "gelungen", klassen: [] },
        { zeit: "gestern", agent: "SMarTrCEO", cmd: "click", url: "https://x.example/", ergebnis: "gelungen", klassen: [] },
      ],
    },
  });
  assert.deepEqual((await lesen()).map((e) => e.zeit), [100, 200, 300]);
  assert.deepEqual((await lesen({ von: 150 })).map((e) => e.zeit), [200, 300]);
  assert.deepEqual((await lesen({ bis: 250 })).map((e) => e.zeit), [100, 200]);
  assert.deepEqual((await lesen({ von: 150, bis: 250 })).map((e) => e.zeit), [200]);
  assert.deepEqual(await lesen({ von: 9000 }), []);
});

test("P7 — `ausgeben` liefert eine lesbare JSON-Datei", async () => {
  attrappeSetzen();
  await eintragen({ zeit: 1, agent: "SMarTrCEO", cmd: "click", url: "https://a.example/x", ergebnis: "gelungen", klassen: ["bedienen"] });
  const text = await ausgeben();
  const gelesen = JSON.parse(text);
  assert.equal(gelesen.version, BUCH_VERSION);
  assert.equal(typeof gelesen.erzeugt, "string");
  assert.equal(gelesen.eintraege.length, 1);
  assert.equal(gelesen.eintraege[0].url, "https://a.example/x");

  /* Ein leeres Buch ist auch eine Datei, keine Ausnahme. */
  attrappeSetzen();
  assert.deepEqual(JSON.parse(await ausgeben()).eintraege, []);
});

test("P8 — Der Deckel greift, und das Älteste fällt zuerst", async () => {
  const jetzt = Date.now();
  const voll = [];
  for (let i = 0; i < EINTRAEGE_HOECHSTENS; i++) {
    voll.push({ zeit: jetzt - (EINTRAEGE_HOECHSTENS - i) * 1000, agent: "SMarTrCEO", cmd: "click", url: `https://a.example/${i}`, ergebnis: "gelungen", klassen: [] });
  }
  const { chrome } = attrappeSetzen({ ablageLocal: { [BUCH_ABLAGE]: voll } });

  await eintragen({ zeit: jetzt, agent: "SMarTrCEO", cmd: "click", url: "https://neu.example/", ergebnis: "gelungen" });
  const roh = await ausAblage(chrome);
  assert.equal(roh.length, EINTRAEGE_HOECHSTENS);
  assert.equal(roh[roh.length - 1].url, "https://neu.example/");
  /* Der älteste ist weg, der zweitälteste steht vorn. */
  assert.equal(roh[0].url, "https://a.example/1");
});

test("P9 — Ohne Browser gibt es eine Antwort, keine Ausnahme", async () => {
  const vorher = globalThis.chrome;
  globalThis.chrome = undefined;
  try {
    /* Das Buch ist eine Auskunft, kein Gate. Ein Gate, das an einem vollen
       Speicher hängt, wäre eine Erweiterung, die bei vollem Speicher nichts
       mehr tut. */
    const e = await eintragen({ agent: "SMarTrCEO", cmd: "click", url: "https://a.example/", ergebnis: "gelungen" });
    assert.equal(e.ok, false);
    assert.equal(e.eintrag.cmd, "click");
    assert.deepEqual(await lesen(), []);
    assert.deepEqual(await aufraeumen(), { entfernt: 0, geblieben: 0 });
    assert.equal(JSON.parse(await ausgeben()).eintraege.length, 0);
  } finally {
    globalThis.chrome = vorher;
  }
});

test("P10 — Ohne Zeitangabe steht die jetzige da", async () => {
  const { chrome } = attrappeSetzen();
  const vorher = Date.now();
  await eintragen({ agent: "SMarTrCEO", cmd: "click", url: "https://a.example/", ergebnis: "gelungen" });
  const eintrag = (await ausAblage(chrome))[0];
  assert.ok(eintrag.zeit >= vorher && eintrag.zeit <= Date.now());
  /* Ein Eintrag ohne Zeit wäre einer, den `aufraeumen` nie erwischt. */
  for (const zeit of ["gestern", -5, NaN, null]) {
    attrappeSetzen();
    await eintragen({ zeit, agent: "SMarTrCEO", cmd: "click", url: "https://a.example/", ergebnis: "gelungen" });
    const e2 = (await ausAblage(globalThis.chrome))[0];
    assert.ok(Number.isFinite(e2.zeit) && e2.zeit > 0, String(zeit));
  }
});
