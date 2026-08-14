/*
 * Prüfung von `src/net/protokollbuch.js` — das Buch der Fernaktionen
 * (Vertrag v3.5 §8.3) — und, seit dem 14.08.2026, des Not-Aus im
 * Dienstarbeiter (`src/background/worker.js`, Vertrag v3.5 §5).
 *
 * Zwei Zusagen für das Buch, und beide werden gegen die ECHTE Ablage der
 * Attrappe gemessen, nicht gegen den Rückgabewert der Funktion:
 *
 *   1. **`aufraeumen` löscht wirklich.** Eine Aufbewahrungsfrist, die den
 *      Eintrag nur ausblendet, ist keine Frist, sondern eine
 *      Anzeigeeinstellung.
 *   2. **Kein Seiteninhalt im Buch, nur die Adresse.** Das ist der Grund,
 *      warum dieses Buch überhaupt geführt werden darf. Ein Protokoll, das
 *      den Seitentext mitschreibt, ist eine zweite Kopie fremder Daten in
 *      einem Speicher, den niemand mehr aufräumt.
 *
 * Warum der Not-Aus des Dienstarbeiters hier dazugekommen ist: Er wird
 * gemessen wie das Buch, nämlich an der ECHTEN Ablage und über den echten
 * Nachrichtenhörer, und er braucht dieselbe Chrome-Attrappe. Ein zweiter
 * Aufbau daneben wäre eine zweite Abschrift derselben Welt — genau die
 * Bauform, gegen die Festlegung F4 steht. Der Abschnitt beginnt weiter unten
 * mit einer eigenen Überschrift.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen, anDieSeite } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, BEVOR die Module geladen werden: `dienste.js`
   liest die Fassung beim Laden aus dem Manifest, und `worker.js` meldet im
   Modulrumpf seine Ereignishörer an. */
let welt = attrappeSetzen();

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

const { REKORDER_ABLAGE, REKORDER_TAB_ABLAGE } = await import("../net/werkstatt.js");
const { REKORDER_BILD_ABLAGE } = await import("../net/ausfuehrer.js");
const { AGENTEN } = await import("../net/matrix.js");

/* Der Dienstarbeiter wird EINMAL geladen. Sein Nachrichtenhörer und sein
   `tabs.onUpdated`-Hörer werden dabei angemeldet; beide greifen wir hier ab
   und rufen sie selbst, genau so, wie Chrome es täte. Gemessen wird damit,
   was die Erweiterung WIRKLICH anmeldet, und nicht ein Nachbau daneben. */
await import("../background/worker.js");
const HOERER = welt.chrome.runtime.onMessage._zuhoerer[0];
assert.equal(typeof HOERER, "function", "Der Dienstarbeiter meldet einen Nachrichtenhörer an.");
const SEITENWECHSEL = welt.chrome.tabs.onUpdated._zuhoerer[0];
assert.equal(typeof SEITENWECHSEL, "function", "Der Dienstarbeiter hört auf tabs.onUpdated.");

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

/* ==================================================================== *
 * Der Not-Aus im Dienstarbeiter (Vertrag v3.5 §5)
 *
 * Befund NOTAUS-5 vom 14.08.2026, am echten Nachrichtenhörer und am echten
 * `tabs.onUpdated`-Hörer gemessen: `notbremseAusloesen` kappte die
 * Browsersteuerung und den Cloud-Auftrag, liess die AUFZEICHNUNG aber
 * unberührt. Danach blieb `sa_rekorder {laeuft:true}` in `storage.local` und
 * `sa_rekorder_tab` in `storage.session` stehen; beim nächsten Seitenwechsel
 * spielte der Dienstarbeiter den Aufzeichner wieder in die Seite ein, und
 * `rekorder:bild` lief weiter bis `captureVisibleTab` durch — eine Aufnahme
 * des ganzen sichtbaren Tabs, abgelegt unter `sa_rekorder_bilder`.
 *
 * `storage.local` überlebt jeden Neustart des Dienstarbeiters; geräumt wurde
 * erst bei `onStartup`. Ein Mensch, der Esc Esc drückt, weil er nicht mehr
 * will, dass mitgeschrieben wird, bekam weiter Bilder seiner Seiten in die
 * Ablage.
 *
 * Gemessen wird ausschliesslich über den Produktivweg: die Nachricht
 * `{typ:"notbremse"}` aus dem Tab, so wie `content/overlay.js` sie sendet.
 * ==================================================================== */

const NOTAUS_TAB = {
  id: 7,
  url: "https://laden.example/kasse",
  title: "Kasse",
  active: true,
  status: "complete",
  windowId: 3,
};

/** Eine Nachricht durch den ECHTEN Hörer des Dienstarbeiters schicken. */
function anWorker(nachricht, absender = { id: "abcdefghijklmnopabcdefghijklmnop" }) {
  return new Promise((fertig) => {
    let kam = false;
    const weiter = HOERER(nachricht, absender, (a) => {
      kam = true;
      fertig(a);
    });
    /* `false` heisst „hier kommt keine Antwort" — dann ist das Ausbleiben das
       Ergebnis und kein Hänger. */
    if (weiter !== true && !kam) fertig(undefined);
  });
}

/* Der Not-Aus antwortet sofort und arbeitet danach weiter (erst kappen, dann
   melden). Diese Runden geben den Zusagen dahinter Zeit, ohne echte Zeit zu
   verbrauchen — gewartet wird auf die Warteschlange, nicht auf die Uhr. */
async function ruhe(runden = 30) {
  for (let i = 0; i < runden; i += 1) await new Promise((f) => setTimeout(f, 0));
}

/** Eine Welt mit laufender Aufzeichnung im Tab 7. */
function mitAufzeichnung(zusatz = {}) {
  welt = attrappeSetzen({
    tab: { ...NOTAUS_TAB },
    ablageLocal: {
      [REKORDER_ABLAGE]: { version: 1, laeuft: true, bildNr: 2, schritte: [{ type: "click" }] },
      [REKORDER_BILD_ABLAGE]: { version: 1, bilder: { "s1.webp": { dataB64: "QUJD" } }, zuletzt: Date.now() },
    },
    ablageSession: { [REKORDER_TAB_ABLAGE]: 7 },
    bildDatenUrl: "data:image/jpeg;base64,QUJD",
    ...zusatz,
  });
  return welt;
}

test("N1 — Der Not-Aus beendet die laufende Aufzeichnung, gemessen an der Ablage", async () => {
  mitAufzeichnung();
  const ausDemTab = { id: welt.chrome.runtime.id, tab: { id: 7 } };

  const antwort = await anWorker({ typ: "notbremse", quelle: "schild" }, ausDemTab);
  assert.deepEqual(antwort, { ok: true }, "der Not-Aus antwortet sofort, ohne auf irgendetwas zu warten");
  await ruhe();

  const lokal = await welt.chrome.storage.local.get(REKORDER_ABLAGE);
  assert.equal(lokal[REKORDER_ABLAGE], undefined,
    "sa_rekorder muss weg sein — es überlebt sonst jeden Neustart des Dienstarbeiters");
  const sitzung = await welt.chrome.storage.session.get(REKORDER_TAB_ABLAGE);
  assert.equal(sitzung[REKORDER_TAB_ABLAGE], undefined,
    "und die Tabnotiz dazu, an der die Neueinspielung hängt");
  const bilder = await welt.chrome.storage.local.get(REKORDER_BILD_ABLAGE);
  assert.equal(bilder[REKORDER_BILD_ABLAGE], undefined,
    "auch der Bildvorrat: es sind Aufnahmen ganzer Seiten des Menschen");

  assert.ok(anDieSeite(welt.spur).includes("rekorder:stop"),
    "dem Mitschreiber im laufenden Dokument wird gesagt, dass Schluss ist");
  assert.ok(anDieSeite(welt.spur).includes("overlay:gestoppt"),
    "und das Zeichen im Tab sagt es weiterhin auch");
  assert.equal(
    welt.spur.filter((e) => e.wohin === "executeScript").length,
    0,
    "der Not-Aus spielt NICHTS in die Seite ein — auch keinen Aufzeichner, der aufhören soll"
  );
});

test("N2 — Nach dem Not-Aus zieht kein Seitenwechsel den Aufzeichner mehr nach", async () => {
  /* Der Weg, an dem der Befund hängt: `tabs.onUpdated` mit `status:"loading"`.
     Vor der Reparatur spielte der Dienstarbeiter hier geheim.js, selektor.js
     und rekorder.js in die neue Seite ein — die Erweiterung führte also NACH
     dem Abbruch Code in eine fremde Seite ein. */
  mitAufzeichnung();
  const ausDemTab = { id: welt.chrome.runtime.id, tab: { id: 7 } };

  /* Erst die Gegenprobe: Solange die Aufzeichnung läuft, wird nachgezogen. */
  SEITENWECHSEL(7, { status: "loading" }, welt.chrome.tabs);
  await ruhe();
  assert.ok(
    anDieSeite(welt.spur).includes("rekorder:ping"),
    "ohne Not-Aus fragt der Dienstarbeiter beim Seitenwechsel nach dem Aufzeichner"
  );

  await anWorker({ typ: "notbremse", quelle: "esc-esc" }, ausDemTab);
  await ruhe();
  const ab = welt.spur.length;

  SEITENWECHSEL(7, { status: "loading" }, welt.chrome.tabs);
  await ruhe();
  const danach = welt.spur.slice(ab);
  assert.equal(
    danach.filter((e) => e.wohin === "executeScript").length,
    0,
    "nach dem Not-Aus wird nichts mehr in die Seite eingespielt"
  );
  assert.equal(
    danach.filter((e) => e.wohin === "seite" && e.nachricht.typ === "rekorder:ping").length,
    0,
    "und es wird auch nicht mehr gefragt: es läuft keine Aufzeichnung mehr"
  );
});

test("N3 — Nach dem Not-Aus entsteht kein Bild mehr, und keines wird abgelegt", async () => {
  /*
   * Die zweite Hälfte desselben Befundes. Gemessen wurde damals EINE Aufnahme
   * nach dem Not-Aus. Der Riegel sitzt am Nachrichtenhörer, also an der Grenze
   * zur fremden Seite: Erreicht das `rekorder:stop` den Mitschreiber nicht
   * mehr — hängender Tab, Seite mitten im Wechsel —, schickt er weiter Bilder,
   * und dann muss hier Schluss sein.
   */
  /* Eine harmlose Warenseite: `rekorderBild` nimmt von heiklen Seiten
     grundsätzlich kein Bild auf, und diese Prüfung misst den Not-Aus und nicht
     jene Sperre. */
  mitAufzeichnung({ tab: { ...NOTAUS_TAB, url: "https://laden.example/produkte/ssd-2tb", title: "SSD 2TB" } });
  const ausDemTab = { id: welt.chrome.runtime.id, tab: { id: 7 } };

  /* Gegenprobe: Solange die Aufzeichnung läuft, entsteht das Bild. */
  const vorher = await anWorker(
    { typ: "rekorder:bild", name: "s2.webp", nr: 2, anlass: "user_request" },
    ausDemTab
  );
  assert.equal(vorher.ok, true, `ohne Not-Aus muss das Bild entstehen: ${JSON.stringify(vorher)}`);

  await anWorker({ typ: "notbremse", quelle: "schild" }, ausDemTab);
  await ruhe();
  const ab = welt.spur.length;

  const nachher = await anWorker(
    { typ: "rekorder:bild", name: "s3.webp", nr: 3, anlass: "user_request" },
    ausDemTab
  );
  assert.equal(nachher.ok, false, "nach dem Not-Aus entsteht kein Bild mehr");
  assert.equal(nachher.kennung, "keine_aufnahme", "und die Absage sagt, warum");
  assert.ok(nachher.klartext, "mit einem Satz für den Menschen");
  assert.equal(
    welt.spur.slice(ab).filter((e) => e.wohin === "tabs.captureVisibleTab").length,
    0,
    "und der Browser wird gar nicht erst gefragt"
  );
  const bilder = await welt.chrome.storage.local.get(REKORDER_BILD_ABLAGE);
  assert.equal(bilder[REKORDER_BILD_ABLAGE], undefined, "nichts davon liegt in der Ablage");
});

test("N4 — Der Not-Aus lässt keinen Wecker stehen, der das Abholen wieder aufnimmt", async () => {
  /*
   * Befund B9 in seiner gefährlichsten Form: `smartrchat-wache` und
   * `smartrlink-wache` überlebten den Not-Aus, und `wacheLaufen` nahm das
   * Abholen nach dem nächsten Start des Dienstarbeiters WIEDER AUF. Ein
   * Not-Aus, den ein Wecker rückgängig macht, ist keiner.
   *
   * Dass dieser Satz überhaupt etwas misst, ist selbst eine Reparatur
   * (NOTAUS-6): In `chrome-attrappe.mjs` waren `alarms.create` und
   * `alarms.clear` bis zum 14.08.2026 leere Funktionen, die nichts
   * mitschrieben. Über diese Attrappe war „der Wecker ist gelöscht" gar nicht
   * messbar — wer es nicht wusste, schrieb einen grünen Prüfsatz, der nichts
   * mass.
   */
  mitAufzeichnung();
  await welt.chrome.alarms.create("smartrlink-wache", { periodInMinutes: 0.5 });
  await welt.chrome.alarms.create("smartrchat-wache", { periodInMinutes: 0.5 });
  assert.deepEqual(
    (await welt.chrome.alarms.getAll()).map((w) => w.name).sort(),
    ["smartrchat-wache", "smartrlink-wache"],
    "die Attrappe muss Wecker überhaupt merken, sonst misst dieser Satz nichts"
  );

  await anWorker({ typ: "notbremse", quelle: "tastenkuerzel" }, { id: welt.chrome.runtime.id, tab: { id: 7 } });
  await ruhe();

  assert.deepEqual(
    await welt.chrome.alarms.getAll(),
    [],
    "nach dem Not-Aus steht kein Wecker mehr, der etwas wieder aufnehmen könnte"
  );
});

/* ==================================================================== *
 * Der Agentenname in `link:zustand?` (Befund BRUECKE-1 / H5)
 *
 * Die Seitenleiste holt sich hier ihren Zustand zurück, wenn sie neu aufgeht.
 * Ohne den Agentennamen blieb die Dauerzeile aus §8.4 nach dem Wiederöffnen
 * still weg: `link.js` sendet `link:cloud-sitzung` nur beim START der
 * Sitzung, und den Start hat eine geschlossene Seitenleiste nie gehört.
 *
 * Gesäubert wird gegen die Positivliste `AGENTEN` aus `net/matrix.js` und
 * nicht bloss auf erlaubte Zeichen. Der Name kommt vom Relay (§8.1), also von
 * aussen; was nicht auf der Liste steht, ist kein Agent, und eine Dauerzeile
 * „Cloud-Sitzung aktiv: Buchhaltung" wäre eine Behauptung, die diese
 * Erweiterung nicht belegen kann. Kein Name, kein Feld, keine Zeile.
 * ==================================================================== */

/**
 * Eine Welt mit einer Sitzung in der Ablage, unter dem genannten Agenten.
 *
 * `net/link.js` hält die gelesene Sitzung im MODULSPEICHER — sie stirbt mit
 * dem Dienstarbeiter und wird genau deshalb nicht bei jeder Frage neu aus der
 * Ablage geholt. Ohne das Trennen davor läse der nächste Prüfsatz die Sitzung
 * des vorigen, und die ganze Reihe unten wäre eine Prüfung des Zwischen-
 * speichers statt der Positivliste.
 */
async function mitSitzung(agent) {
  await anWorker({ typ: "link:trennen", grund: "nutzer" }, { id: welt.chrome.runtime.id });
  await ruhe(5);
  welt = attrappeSetzen({
    tab: { ...NOTAUS_TAB },
    ablageSession: {
      link_sitzung: {
        code: "sitzung-1",
        stufe: "read",
        tabId: 7,
        agent,
        endetUm: Date.now() + 600000,
        ursprungMuster: "https://laden.example/*",
      },
    },
  });
  return welt;
}

test("N5 — `link:zustand?` gibt den Agentennamen mit, damit die Dauerzeile zurückkommt", async () => {
  await mitSitzung("SMarTrCEO");
  const stand = await anWorker({ typ: "link:zustand?" }, { id: welt.chrome.runtime.id });
  assert.equal(stand.agent, "SMarTrCEO", "ohne dieses Feld bleibt die Dauerzeile nach dem Wiederöffnen weg");
  assert.equal(stand.code, "sitzung-1", "und der übrige Zustand kommt unverändert mit");
});

test("N6 — Ein Name, der nicht auf der Positivliste steht, kommt gar nicht erst an", async () => {
  /* Die Gegenprobe, und der eigentliche Sinn der Positivliste: Der Name kommt
     vom Relay. Ein durchgereichter Fantasiename stünde als Tatsache in der
     Oberfläche. */
  for (const erfunden of ["Buchhaltung", "smartrceo", "SMarTr CEO", "<script>", "SMarTrCEO\u200b", ""]) {
    await mitSitzung(erfunden);
    const stand = await anWorker({ typ: "link:zustand?" }, { id: welt.chrome.runtime.id });
    assert.equal(
      Object.prototype.hasOwnProperty.call(stand, "agent"),
      false,
      `„${erfunden}" darf kein Feld ergeben: kein Name, kein Feld, keine Zeile`
    );
  }
  /* Leerraum am Rand ist KEIN anderer Agent: Er wird abgeschnitten und der
     Name danach gegen die Liste gehalten. Das ist die eine erlaubte Milderung,
     und sie steht hier ausdrücklich, damit niemand sie für ein Versehen hält. */
  await mitSitzung("  SMarTrCEO  ");
  assert.equal(
    (await anWorker({ typ: "link:zustand?" }, { id: welt.chrome.runtime.id })).agent,
    "SMarTrCEO",
    "Leerraum am Rand macht aus einem Agenten keinen anderen"
  );

  /* Und die Liste selbst ist die EINE Quelle — sie wird importiert und nicht
     abgeschrieben. Steht ein Name darauf, kommt er durch. */
  for (const echt of AGENTEN) {
    await mitSitzung(echt);
    const stand = await anWorker({ typ: "link:zustand?" }, { id: welt.chrome.runtime.id });
    assert.equal(stand.agent, echt, `${echt} steht auf der Liste und muss durchkommen`);
  }
});

test("N7 — Aus einer fremden Seite kommt gar kein Zustand, auch kein Agentenname", async () => {
  await mitSitzung("SMarTrCEO");
  const stand = await anWorker({ typ: "link:zustand?" }, { id: welt.chrome.runtime.id, tab: { id: 7 } });
  assert.deepEqual(stand, { verbunden: false }, "eine fremde Seite erfährt nichts über die Sitzung");
});
