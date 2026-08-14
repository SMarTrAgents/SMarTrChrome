/*
 * Prüfung der GATTUNG, nicht der Stelle.
 *
 * Aufruf:  cd src && node --test "pruefung/gattung.test.mjs"
 *
 * ====================================================================
 * WOZU DIESE DATEI DA IST
 * ====================================================================
 *
 * Diese Erweiterung ist zweimal an derselben Sache vorbeigelaufen, und beide
 * Male sah es nach Fortschritt aus:
 *
 *   - Am 11.08.2026 lag eine fertige, grün geprüfte Verdeckungswache im
 *     Bestand, die im Klickweg NIRGENDS eingebaut war. 372 Prüfsätze grün,
 *     der Klick ging durch einen deckenden Überzug.
 *   - Am 14.08.2026 waren 809 Prüfsätze grün, und die Gegenlesung fand
 *     sieben Wege, auf denen die als „nie abschaltbar" zugesagten harten
 *     Klassen im Modus `auto` schweigen. `befehle.test.mjs:1153` sagt wörtlich
 *     zu, der Elementname werde nicht gekürzt, bevor er gemessen wird — und
 *     ruft dafür `klassenBestimmen` DIREKT auf, während die Kürzung an der
 *     Aufrufstelle davor steht.
 *
 * Die erste Runde der Reparaturen schloss 41 von 42 gemeldeten Stellen. Die
 * Nachabnahme fand danach 36 Funde, 35 davon neu — dieselben sechs
 * Fehlerarten an ANDEREN Aufrufstellen. Eine Zahl grüner Sätze misst also
 * nichts, solange jeder Satz eine Stelle prüft.
 *
 * Deshalb prüft diese Datei die KLASSE:
 *
 *     Es wird verglichen, ohne vorher zu normalisieren,
 *     und es wird gekürzt, bevor gemessen wird.
 *
 * Sie hat zwei Teile, und die Arbeitsteilung zwischen ihnen ist Absicht:
 *
 *   TEIL A — DIE MATRIX. Jedes harte Klassenwort mal jede Verschleierung,
 *     gemessen über den PRODUKTIVWEG: Befehlsrahmen rein, Attrappe der Seite,
 *     Modus `auto` am Browser und am Server, gemessen wird an der Spur, ob
 *     gefragt wurde und ob die Tat unterblieben ist. Kein einziger Aufruf von
 *     `klassenBestimmen` — genau dieser Abkürzung verdankt die Erweiterung
 *     ihren grünen Prüfsatz über eine offene Tür.
 *
 *   TEIL B — DIE POSITIVLISTE. Teil A findet, was jemand HEUTE versucht.
 *     Teil B findet, was jemand MORGEN baut: Er liest die Quelldateien als
 *     Text und macht rot, sobald eine Kürzung, ein `pathname` oder ein
 *     Vergleich ohne Messform an einer Stelle NEU entsteht, die niemand
 *     eingetragen und begründet hat.
 *
 * ====================================================================
 * WARUM EINE POSITIVLISTE UND KEINE VERBOTSLISTE
 * ====================================================================
 *
 * Eine Verbotsliste („dieses Muster darf nicht vorkommen") ist genau die
 * Bauform, an der `WORTE_ZULASSEN` gescheitert ist: Wer sein Wort nicht in
 * der Liste findet, hat die Wache aus. Sie schützt gegen das, was schon
 * einmal passiert ist, und gegen nichts sonst.
 *
 * Eine Positivliste dreht die Beweislast um. Sie sagt nicht „das ist
 * verboten", sondern „jede Stelle dieser Bauform muss hier stehen, mit einer
 * Begründung im Klartext". Damit ist eine NEUE Stelle rot, bevor irgendwer
 * ahnt, dass sie gefährlich ist — und der nächste Mensch muss eine
 * Entscheidung treffen und sie aufschreiben, statt stillschweigend
 * vorbeigelassen zu werden. Genau das hat am 11. und am 14.08. gefehlt: Nicht
 * das Wissen, sondern der Zwang, hinzusehen.
 *
 * WER HIER ROT WIRD UND EINE NEUE STELLE GEBAUT HAT, macht Folgendes: Er
 * trägt sie in die passende Liste ein (`KUERZUNGEN`, `PFADE`, `VERGLEICHE`),
 * schreibt in `grund` in einem ganzen Satz, warum diese Stelle die Messung
 * NICHT aushebelt — und wenn er das nicht schreiben kann, hat er seinen
 * Befund gefunden. Ein Eintrag ist keine Genehmigung, sondern eine
 * Behauptung, für die jemand mit seinem Namen geradesteht.
 *
 * Was hier ausdrücklich NICHT rot wird: ein Eintrag, dessen Stelle
 * verschwunden ist. Eine Stelle, die es nicht mehr gibt, ist keine Umgehung,
 * und ein Prüfsatz, der beim AUFRÄUMEN rot wird, erzieht zum Nicht-Aufräumen.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { attrappeSetzen, anDieSeite } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, BEVOR die Module geladen werden: `dienste.js`
   liest die Fassung beim Laden aus dem Manifest. */
attrappeSetzen();

const { MODUS_ABLAGE, GRENZEN, saeubern } = await import("../net/befehle.js");
const { befehlAusfuehren, zaehlerNeu } = await import("../net/ausfuehrer.js");

/* ==================================================================== *
 * TEIL A — Die Matrix über den Produktivweg
 * ==================================================================== */

const TAB = {
  id: 7,
  url: "https://geizhals.de/warenkorb",
  title: "Warenkorb",
  active: true,
  status: "complete",
  windowId: 3,
};

/* Vollzugriff UND Automatik, an beiden Enden. Ein Prüfsatz, der im
   Handbetrieb misst, ist grün, weil dort immer gefragt wird — und belegt
   damit über die Automatik nichts. */
const AUTO = {
  stufe: "write",
  modus: "tab",
  bereich: ["geizhals.de"],
  schrittmodus: "auto",
  tabId: 7,
  endetUm: Date.now() + 600000,
};

const KNOTEN = [
  { art: "element", ref: "e2", rolle: "button", name: "Weiter", wert: null, zustand: ["visible"], tiefe: 1 },
];

/** Ein Modusstand, wie ihn die Seitenleiste in `chrome.storage.session` legt. */
function modusAblage(tabId, modus) {
  return { [MODUS_ABLAGE]: { version: 1, tabs: { [String(tabId)]: modus }, schritte: {} } };
}

/**
 * Die Seite, wie der Ausführer sie sieht.
 *
 * `name`, `rolle` und die Bauform sind das, was die BESUCHTE SEITE liefert —
 * also genau der Text, über den in dieser Datei gestritten wird.
 */
function seiteMit({ name = "Weiter", rolle = "button", marke = "button", feldtyp = "", formularGeheim = false } = {}) {
  return (n) => {
    switch (n.typ) {
      case "overlay:ping":
        return { ok: true };
      case "overlay:baum":
        return { ok: true, epoche: "s1.abcd", knoten: KNOTEN, ausgelassen: {} };
      case "overlay:zustand":
        return {
          ok: true, readyState: "complete", scrollY: 0, scrollHeight: 4000,
          viewportHeight: 900, atTop: true, atBottom: false, epoche: "s1.abcd", elementCount: 1,
        };
      case "overlay:nachschlagen":
        return {
          ok: true, name, rolle, marke, feldtyp, formularGeheim,
          rect: { left: 10, top: 20, width: 100, height: 40 }, mitte: { x: 60, y: 40 },
        };
      case "overlay:klicken":
        return { ok: true, rolle, name };
      case "overlay:tippen":
        return { ok: true, rolle, name, laenge: 5, abgesendet: false };
      case "overlay:zeiger":
        return { ok: true };
      default:
        return { ok: true };
    }
  };
}

/* Die Seitenleiste ist offen und sagt NEIN. Damit ist an der Spur zweierlei
   ablesbar: dass gefragt wurde, und dass die Tat unterblieben ist. Ein „Ja"
   würde nur zeigen, dass gefragt wurde. */
const panelSagtNein = (n) => (n.typ === "link:schritt-freigabe" ? { ja: false } : { ok: true });

let laufNummer = 0;

/** Ein Befehl über den ganzen Weg, im Modus `auto`. */
async function imAutomatikmodus(rahmen, seite) {
  laufNummer += 1;
  const { spur } = attrappeSetzen({
    tab: { ...TAB },
    seiteAntwortet: seite,
    panelAntwortet: panelSagtNein,
    ablageLocal: {},
    ablageSession: modusAblage(7, "auto"),
  });
  zaehlerNeu();
  const ergebnis = await befehlAusfuehren({ id: `g-${laufNummer}`, ...rahmen }, AUTO);
  const frage = spur.find((e) => e.wohin === "panel" && e.nachricht.typ === "link:schritt-freigabe");
  return {
    ergebnis,
    spur,
    frage: frage ? frage.nachricht : null,
    anDieSeiteGegangen: anDieSeite(spur),
    anDenBrowser: spur.filter((e) => String(e.wohin).startsWith("tabs.")).map((e) => e.wohin),
  };
}

/* ------------------------------------------------------------------ *
 * Die Verschleierungen
 *
 * Jede von ihnen ist ein Weg, dasselbe Wort so zu schreiben, dass ein Mensch
 * es liest und ein Vergleich es nicht findet. Sie stehen als benannte
 * Funktionen da, damit die Fehlermeldung sagt, WELCHE davon durchgekommen
 * ist.
 * ------------------------------------------------------------------ */

/** Ein Zeichen mitten ins Wort, an eine Stelle, die kein Wortanfang ist. */
function mittendrin(wort, zeichen) {
  const i = Math.max(1, Math.floor(wort.length / 2));
  return `${wort.slice(0, i)}${zeichen}${wort.slice(i)}`;
}

const BREIT = new Map();
for (let c = 97; c <= 122; c++) BREIT.set(String.fromCharCode(c), String.fromCharCode(0xff41 + c - 97));
const KAPITAELCHEN = new Map(Object.entries({
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ", j: "ᴊ",
  k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ꞯ", r: "ʀ", s: "ꜱ", t: "ᴛ",
  u: "ᴜ", v: "ᴠ", w: "ᴡ", y: "ʏ", z: "ᴢ",
}));
const umschreiben = (wort, tafel) =>
  [...wort.toLowerCase()].map((z) => tafel.get(z) || z).join("");

/*
 * Die Verschleierungen für einen NAMEN, den die Seite liefert.
 *
 * `satzteil` sagt, welchen Satz der Mensch zu hören bekommt. Er ist bei einer
 * Ausnahme ein anderer, und die ist der offene Befund AUTOMODUS-2 (siehe
 * dort).
 */
const NAMENSTRICKS = [
  {
    kennung: "nullbreite",
    was: "ein Nullbreiten-Leerzeichen mitten im Wort (U+200B)",
    bauen: (w) => mittendrin(w, "​"),
  },
  {
    kennung: "weichesTrennzeichen",
    was: "ein weicher Trennstrich mitten im Wort (U+00AD)",
    bauen: (w) => mittendrin(w, "­"),
  },
  {
    kennung: "wortfuger",
    was: "ein Wortverbinder mitten im Wort (U+2060)",
    bauen: (w) => mittendrin(w, "⁠"),
  },
  {
    kennung: "schreibrichtung",
    was: "eine Schreibrichtungsmarke mitten im Wort (U+202E)",
    bauen: (w) => mittendrin(w, "‮"),
  },
  {
    kennung: "bytefolgemarke",
    was: "eine Bytefolgemarke mitten im Wort (U+FEFF)",
    bauen: (w) => mittendrin(w, "﻿"),
  },
  {
    kennung: "grossklein",
    was: "gemischte Gross- und Kleinschreibung",
    bauen: (w) => [...w].map((z, i) => (i % 2 ? z.toUpperCase() : z)).join(""),
  },
  {
    kennung: "breitzeichen",
    was: "Breitzeichen statt gewöhnlicher Buchstaben (NFKC)",
    bauen: (w) => umschreiben(w, BREIT),
  },
  {
    kennung: "kapitaelchen",
    was: "Kapitälchen statt gewöhnlicher Buchstaben (NFKC faltet sie NICHT)",
    bauen: (w) => umschreiben(w, KAPITAELCHEN),
  },
  {
    kennung: "fuellung",
    was: "200 Zeichen Füllung um das Wort herum",
    bauen: (w) => `${"Angebot ".repeat(13)}${w}${" Angebot".repeat(13)}`,
    /*
     * DIE EINE AUSNAHME, und sie ist ehrlich aufgeschrieben.
     *
     * Der Name ist hier 200 Zeichen lang und wird an der Aufrufstelle
     * `ausfuehrer.js` mit `saeubern(..., GRENZEN.nameZeichen)` auf 120
     * gekürzt, BEVOR der Klassifizierer ihn sieht — und `saeubern` schneidet
     * die MITTE heraus, also genau das Wort. Das ist Befund AUTOMODUS-2, er
     * gehört dem Gebiet Ausführer und ist in `fundament.md` als Fremdbedarf
     * gemeldet.
     *
     * Was hier gemessen wird, ist deshalb NICHT die Klasse `zahlung`, sondern
     * die Wache dagegen: `kuerzungsspur` erkennt in `befehle.js` den
     * Fingerabdruck unserer eigenen Kürzung und `freigabeNoetig` fragt
     * daraufhin auch in der Automatik. Nicht gemessen heisst nicht gefunden,
     * und nicht gefunden heisst nicht durchgewinkt.
     *
     * Wird AUTOMODUS-2 im Ausführer repariert, greift wieder die Klasse
     * selbst, und dieser Satz misst dann einen Satz mehr statt einen weniger:
     * `satzteil` ist deshalb bewusst weich formuliert und deckt beide Sätze.
     */
    satzteil: null,
  },
];

/* Die Verschleierungen für eine ADRESSE. Sie wählt der Agent, nicht die
   Seite — und deshalb ist sie der billigste Weg von allen: Ein Agent, der
   sich seine Zieladresse selbst schreibt, schreibt sie auch prozentkodiert. */
const WEGTRICKS = [
  {
    kennung: "roh",
    was: "die Adresse, wie sie dasteht",
    bauen: (pfad) => `https://geizhals.de${pfad}`,
  },
  {
    kennung: "prozent",
    was: "der erste Buchstabe jedes Wortes prozentkodiert",
    bauen: (pfad) =>
      `https://geizhals.de${pfad.replace(/([a-z])([a-z]{2,})/g, (_, a, rest) =>
        `%${a.charCodeAt(0).toString(16).toUpperCase()}${rest}`)}`,
  },
  {
    kennung: "doppeltProzent",
    was: "zweifach prozentkodiert",
    bauen: (pfad) =>
      `https://geizhals.de${pfad.replace(/([a-z])([a-z]{2,})/g, (_, a, rest) =>
        `%25${a.charCodeAt(0).toString(16).toUpperCase()}${rest}`)}`,
  },
  {
    kennung: "hashroute",
    was: "der ganze Weg im Fragment (Einzelseiten-Anwendung)",
    bauen: (pfad) => `https://geizhals.de/#${pfad}`,
  },
  {
    kennung: "fuellung",
    was: "250 Zeichen Füllung vor und hinter dem Wort",
    bauen: (pfad) => `https://geizhals.de/${"a".repeat(250)}${pfad}/${"b".repeat(250)}`,
  },
  {
    kennung: "grossklein",
    was: "Grossschreibung im Pfad",
    bauen: (pfad) => `https://geizhals.de${pfad.toUpperCase()}`,
  },
  {
    kennung: "unsichtbar",
    was: "ein Nullbreiten-Leerzeichen mitten im Wort der Adresse",
    bauen: (pfad) => `https://geizhals.de${pfad.replace(/([a-z]{2})([a-z]{2,})/, "$1​$2")}`,
  },
];

/* ------------------------------------------------------------------ *
 * Die harten Klassen und ihre Träger
 * ------------------------------------------------------------------ */

/** Alle sechs harten Klassen, getragen von einem NAMEN der Seite. */
const NAMENSFAELLE = [
  { klasse: "zahlung", wort: "kaufen", cmd: "click", umfeld: "Jetzt %s" },
  { klasse: "unwiderruflich", wort: "loeschen", cmd: "click", umfeld: "Konto %s" },
  { klasse: "datei", wort: "hochladen", cmd: "click", umfeld: "Datei %s" },
  { klasse: "berechtigung", wort: "kamera", cmd: "click", umfeld: "%s aktivieren" },
  { klasse: "captcha", wort: "captcha", cmd: "click", umfeld: "Das %s lösen" },
  { klasse: "geheim", wort: "passwort", cmd: "type", umfeld: "Ihr %s" },
];

/** Die vier harten Klassen, die auch an einer ADRESSE hängen (§3.1). */
const WEGFAELLE = [
  { klasse: "zahlung", pfad: "/kasse/bezahlen" },
  { klasse: "unwiderruflich", pfad: "/konto/loeschen" },
  { klasse: "datei", pfad: "/download/rechnung" },
  { klasse: "captcha", pfad: "/recaptcha/pruefung" },
];

const RAHMEN_JE_BEFEHL = {
  click: { cmd: "click", reason: "Ich klicke.", ref: "e2", snapshotEpoch: "s1.abcd" },
  type: { cmd: "type", reason: "Ich tippe.", ref: "e2", snapshotEpoch: "s1.abcd", text: "abc123" },
};

const TAT_JE_BEFEHL = { click: "overlay:klicken", type: "overlay:tippen" };

/*
 * Der Kern von Teil A.
 *
 * Ein Prüfsatz je Verschleierung, nicht einer für alles: Läuft eine davon
 * durch, soll die Fehlermeldung sie beim Namen nennen und nicht „irgendwo in
 * 54 Fällen" sagen.
 */
for (const trick of NAMENSTRICKS) {
  test(`Matrix Name/${trick.kennung}: ${trick.was} schaltet keine harte Klasse ab`, async () => {
    for (const fall of NAMENSFAELLE) {
      const name = fall.umfeld.replace("%s", trick.bauen(fall.wort));
      const lauf = await imAutomatikmodus(
        RAHMEN_JE_BEFEHL[fall.cmd],
        seiteMit({ name, rolle: fall.cmd === "type" ? "textbox" : "button" })
      );
      const wo = `${fall.klasse} / ${trick.kennung}`;

      assert.ok(lauf.frage, `${wo}: in der Automatik wurde nicht gefragt`);
      assert.equal(lauf.ergebnis.success, false, `${wo}: der Schritt lief trotzdem`);
      assert.equal(lauf.ergebnis.error.code, "guardrail_blocked", wo);
      assert.ok(
        !lauf.anDieSeiteGegangen.includes(TAT_JE_BEFEHL[fall.cmd]),
        `${wo}: die Tat fand trotz Ablehnung statt`
      );
      /* Der Satz, den der Mensch hört, muss die Rückfrage begründen — sonst
         wäre auch eine Fassung grün, die aus einem beliebigen anderen Grund
         anhält. */
      assert.ok(
        /nie abschaltbar|schon gekürzt/.test(lauf.frage.frage),
        `${wo}: die Frage nennt keinen Guardrail-Grund: ${lauf.frage.frage}`
      );
    }
  });
}

test("Matrix Name: die Gegenprobe — dieselben Tricks an einem harmlosen Wort halten nichts an", async () => {
  /*
   * Ohne diesen Satz wäre die ganze Matrix auch über einer Fassung grün, die
   * schlicht immer fragt — und die wäre kein Produkt: Der Modus `auto` heisst
   * „arbeitet eine mehrstufige Aufgabe ohne Einzelbestätigungen ab".
   *
   * Gemessen wird mit demselben Umfeld und denselben Verschleierungen, nur
   * mit einem Wort, das auf keiner Liste steht.
   */
  for (const trick of NAMENSTRICKS) {
    if (trick.kennung === "fuellung") continue; // eigener Satz, siehe unten
    const name = `Zum ${trick.bauen("angebot")} springen`;
    const lauf = await imAutomatikmodus(RAHMEN_JE_BEFEHL.click, seiteMit({ name }));
    assert.ok(!lauf.frage, `${trick.kennung}: ein harmloses Wort löste eine Rückfrage aus`);
    assert.equal(lauf.ergebnis.success, true, `${trick.kennung}: der Schritt lief nicht`);
    assert.ok(lauf.anDieSeiteGegangen.includes("overlay:klicken"), trick.kennung);
  }
});

test("Matrix Name/fuellung: ein LANGER harmloser Name läuft durch, seit der Ausführer ungekürzt misst", async () => {
  /*
   * Dieser Satz hat am 14.08.2026 seine Aussage gewechselt, und das gehört
   * aufgeschrieben statt stillschweigend nachgezogen.
   *
   * Als die Stufe 0 ihn geschrieben hat, kürzte `ausfuehrer.js` den Namen auf
   * `GRENZEN.nameZeichen`, BEVOR `klassenBestimmen` ihn sah (AUTOMODUS-2), und
   * `kuerzungsspur` liess deshalb auch bei einem harmlosen langen Namen fragen
   * — ein Fehlalarm, aber die erlaubte Richtung. Seit der Reparatur im
   * Ausführer gehen Messeingänge ungekürzt hinein, gekürzt wird nur noch in
   * `anzeigename` für die Anzeige. Damit ist der Fehlalarm weg, und genau das
   * misst dieser Satz.
   *
   * Die Wache selbst bleibt: Sie steht im Satz darunter, gegen einen Namen,
   * der die Spur unserer Kürzung schon mitbringt. Zwei Sätze, weil es zwei
   * Aussagen sind — „der Alltag fragt nicht mehr" und „die Wache greift
   * trotzdem noch".
   */
  const langerName = `Zum ${"sehr ".repeat(40)}Angebot springen`;
  assert.ok(langerName.length > GRENZEN.nameZeichen, "die Probe muss die Grenze wirklich überschreiten");
  const lauf = await imAutomatikmodus(RAHMEN_JE_BEFEHL.click, seiteMit({ name: langerName }));

  assert.ok(!lauf.frage, "ein langer, harmloser Name darf in der Automatik keine Rückfrage auslösen");
  assert.equal(lauf.ergebnis.success, true, "der Schritt lief nicht");
  assert.ok(lauf.anDieSeiteGegangen.includes("overlay:klicken"), "es wurde gar nicht geklickt");
});

test("Matrix Name/fuellung: ein Name mit der Spur UNSERER Kürzung hält an, auch in der Automatik", async () => {
  /*
   * Die Gattungswache zu AUTOMODUS-2, und sie misst über den Produktivweg.
   *
   * Die Aufrufstelle in `ausfuehrer.js` ist repariert. Der Grund für diesen
   * Satz ist, dass die Reparatur einer STELLE die KLASSE nicht schliesst:
   * Kürzt morgen irgendwer irgendwo wieder einen Namen, bevor er gemessen
   * wird, erkennt `kuerzungsspur` den Fingerabdruck unserer eigenen Kürzung
   * und lässt fragen. Deshalb reicht die Seite hier einen Namen herein, der
   * die Spur schon trägt — genau so, wie er ankäme, wenn die Kürzung
   * zurückkehrt.
   *
   * Der Name ist ABSICHTLICH harmlos: Stünde ein Wachwort darin, fragte die
   * Wache aus dem anderen Grund, und dieser Satz wäre grün, ohne zu messen,
   * was er zu messen behauptet.
   */
  const mitSpur = saeubern(`Zum ${"sehr ".repeat(40)}Angebot springen`, GRENZEN.nameZeichen);
  assert.ok(mitSpur.includes("…"), "die Probe muss die Spur unserer Kürzung wirklich tragen");
  assert.ok(!/kauf|zahl|lösch|loesch/i.test(mitSpur), "die Probe muss harmlos sein, sonst misst der Satz die falsche Wache");

  const lauf = await imAutomatikmodus(RAHMEN_JE_BEFEHL.click, seiteMit({ name: mitSpur }));
  assert.ok(lauf.frage, "ein gekürzt gemessener Name muss anhalten");
  assert.ok(lauf.frage.frage.includes("schon gekürzt"), lauf.frage.frage);
});


for (const trick of WEGTRICKS) {
  test(`Matrix Adresse/${trick.kennung}: ${trick.was} schaltet keine harte Klasse ab`, async () => {
    for (const fall of WEGFAELLE) {
      const url = trick.bauen(fall.pfad);
      const lauf = await imAutomatikmodus(
        { cmd: "navigate", reason: "Ich wechsle den Ort.", url },
        seiteMit({})
      );
      const wo = `${fall.klasse} / ${trick.kennung} / ${url.slice(0, 70)}`;

      assert.ok(lauf.frage, `${wo}: in der Automatik wurde nicht gefragt`);
      assert.equal(lauf.ergebnis.success, false, `${wo}: der Ortswechsel lief trotzdem`);
      assert.equal(lauf.ergebnis.error.code, "guardrail_blocked", wo);
      assert.ok(!lauf.anDenBrowser.includes("tabs.update"), `${wo}: der Tab wurde trotzdem bewegt`);
      assert.ok(lauf.frage.frage.includes("nie abschaltbar"), `${wo}: ${lauf.frage.frage}`);
    }
  });
}

test("Matrix Adresse: die Gegenprobe — dieselben Tricks an einem harmlosen Pfad halten nichts an", async () => {
  for (const trick of WEGTRICKS) {
    const url = trick.bauen("/angebote/liste");
    const lauf = await imAutomatikmodus(
      { cmd: "navigate", reason: "Ich wechsle den Ort.", url },
      seiteMit({})
    );
    assert.ok(!lauf.frage, `${trick.kennung}: ein harmloser Pfad löste eine Rückfrage aus (${url.slice(0, 70)})`);
    assert.equal(lauf.ergebnis.success, true, `${trick.kennung}: der Ortswechsel lief nicht`);
  }
});

test("Matrix: die Herkunft wird weiter gemessen, auch verschleiert", async () => {
  /*
   * Der Klassifizierer misst BEIDE Adressen: wo der Tab steht und wohin der
   * Schritt ihn bringt (Befund B1). Eine Reparatur, die eine Messung
   * wegnimmt, um eine andere zu ergänzen, ist keine — deshalb steht hier die
   * Gegenrichtung: ein Klick auf einer Seite, deren Weg im FRAGMENT steht.
   *
   * Das ist zugleich die zweite Hälfte von AUTOMODUS-4: „Dieselbe Lücke
   * trifft auch `click` auf einer Seite, die unter #/kasse steht."
   */
  laufNummer += 1;
  const { spur } = attrappeSetzen({
    tab: { ...TAB, url: "https://geizhals.de/#/kasse/bezahlen" },
    seiteAntwortet: seiteMit({ name: "Weiter" }),
    panelAntwortet: panelSagtNein,
    ablageLocal: {},
    ablageSession: modusAblage(7, "auto"),
  });
  zaehlerNeu();
  const ergebnis = await befehlAusfuehren({ id: `g-${laufNummer}`, ...RAHMEN_JE_BEFEHL.click }, AUTO);
  const frage = spur.find((e) => e.wohin === "panel" && e.nachricht.typ === "link:schritt-freigabe");

  assert.ok(frage, "ein Klick auf einer Kassenseite mit Hash-Weg lief ohne Rückfrage");
  assert.equal(ergebnis.error.code, "guardrail_blocked");
  assert.ok(!anDieSeite(spur).includes("overlay:klicken"), "der Klick fand trotzdem statt");
});

/* ==================================================================== *
 * TEIL B — Die Positivliste als Quelltextsuche
 * ==================================================================== */

/* Die Dateien, über die Teil B wacht. Alles, was Text von der besuchten Seite
   anfasst, steht hier — die Seitenleiste und der Hintergrunddienst nicht:
   Dort wird angezeigt, nicht gemessen. */
const QUELLEN = [
  "../gemeinsam/messform.js",
  "../net/befehle.js",
  "../net/ausfuehrer.js",
  "../net/seite.js",
  "../net/matrix.js",
  "../net/protokollbuch.js",
  "../net/werkstatt.js",
  "../net/link.js",
  "../content/geheim.js",
  "../content/klickwache.js",
  "../content/selektor.js",
  "../content/overlay.js",
  "../content/rekorder.js",
];

/*
 * Reine Kommentarzeilen fliegen raus.
 *
 * In diesem Baum erklären lange Kopfkommentare, WARUM etwas so gebaut ist,
 * und nennen dabei die Muster, gegen die hier gewacht wird — diese Datei
 * selbst ist das beste Beispiel. Eine Erwähnung ist keine Benutzung.
 * (Dieselbe Bauform und dieselbe Begründung wie in `manifest.test.mjs`.)
 */
function zeilenOhneKommentare(pfad) {
  const roh = readFileSync(new URL(pfad, import.meta.url), "utf8");
  return roh.split("\n").map((zeile, i) => ({ datei: pfad.replace("../", "src/"), nr: i + 1, text: zeile }))
    .filter(({ text }) => {
      const anfang = text.trimStart();
      return anfang && !(anfang.startsWith("*") || anfang.startsWith("//") || anfang.startsWith("/*"));
    });
}

const ZEILEN = QUELLEN.flatMap(zeilenOhneKommentare);

/**
 * Der gemeinsame Prüfkern beider Listen.
 *
 * @param {function} trifft   welche Zeilen die gesuchte Bauform tragen
 * @param {Array} liste       die Positivliste
 * @param {string} was        wie die Bauform in der Fehlermeldung heisst
 */
function nurWasEingetragenIst(trifft, liste, was) {
  const offen = [];
  for (const zeile of ZEILEN) {
    if (!trifft(zeile)) continue;
    const eintrag = liste.find((e) => e.datei === zeile.datei && zeile.text.includes(e.muster));
    if (!eintrag) offen.push(`${zeile.datei}:${zeile.nr}  ${zeile.text.trim()}`);
  }
  assert.deepEqual(
    offen,
    [],
    `${was}: diese Stellen stehen in keiner Positivliste.\n` +
      `Wer sie gebaut hat, trägt sie ein und schreibt in „grund" einen ganzen Satz dazu, ` +
      `warum sie die Messung nicht aushebelt. Kann er das nicht schreiben, hat er seinen Befund gefunden.\n` +
      offen.join("\n")
  );
}

/* Jede Positivliste muss auch selbst sauber sein: Zwei Einträge mit demselben
   Muster in derselben Datei bedeuten, dass einer von beiden nichts mehr
   deckt, und ein Eintrag ohne Begründung ist keiner. */
function listePruefen(liste, name) {
  const gesehen = new Set();
  for (const e of liste) {
    const schluessel = `${e.datei}|${e.muster}`;
    assert.ok(!gesehen.has(schluessel), `${name}: doppelter Eintrag ${schluessel}`);
    gesehen.add(schluessel);
    assert.ok(e.grund && e.grund.length > 40, `${name}: ${schluessel} hat keine Begründung im Klartext`);
  }
}

/* ------------------------------------------------------------------ *
 * B1 — Kürzung eines NAMENS
 *
 * Die Bauform aus Befund H1 und AUTOMODUS-2. Gewacht wird über genau das,
 * was der Klassifizierer misst: den Namen, die Rolle, die Marke und den
 * Feldtyp des Ziels. Wer eines davon kürzt, kürzt einen Eingang einer
 * Sicherheitsprüfung, und das ist immer eine Entscheidung und nie eine
 * Nebensache.
 * ------------------------------------------------------------------ */

const NAME_GEKUERZT = /\b(name|rolle|role|marke|typ|feldtyp|beschriftung)[A-Za-z]*\s*[:=]\s*(saeubern|kuerzen)\s*\(/;

const KUERZUNGEN = [
  {
    datei: "src/net/befehle.js",
    muster: "const name = saeubern(roh.name, GRENZEN.nameZeichen)",
    grund:
      "knotenPruefen baut den Textbaum, den der AGENT liest, nicht den Text, den der Klassifizierer misst. " +
      "Der Deckel ist hier der Sinn der Sache: Ohne ihn passte eine ganze Seite in eine Wahrnehmung.",
  },
  {
    datei: "src/net/befehle.js",
    muster: "const rolle = saeubern(roh.rolle, 40)",
    grund:
      "Dieselbe Stelle wie darüber, dieselbe Begründung: Anzeige im Textbaum. Die Rolle, die der " +
      "Klassifizierer misst, kommt aus dem Nachschlag beim Klick und nicht von hier.",
  },
  {
    datei: "src/net/befehle.js",
    muster: "const marke = saeubern(gefunden.tagName",
    grund:
      "Der Verdeckungstest vergleicht die Marke des getroffenen Knotens mit unseren eigenen Vokabeln " +
      "und misst kein Wachwort. 40 Zeichen sind für jeden HTML-Elementnamen mehr als genug.",
  },
  {
    datei: "src/content/klickwache.js",
    muster: "const marke = anzeigename(gefunden.tagName",
    grund:
      "Dieselbe Zeile in der Seite, mit derselben Begründung: Vergleich gegen unsere eigenen Vokabeln, " +
      "kein Wachwort. Bis zum 14.08.2026 stand hier eine eigene Abschrift von saeubern samt eigener " +
      "Zeichenliste; sie ist an diesem Tag von der Messform abgewichen und hat klickwache.test.mjs rot " +
      "gemacht. Jetzt holt anzeigename die Form aus der einen Quelle (F4).",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "anzeigename: saeubern(nachschlag.antwort.name, GRENZEN.nameZeichen)",
    grund:
      "AUTOMODUS-2, GESCHLOSSEN am 14.08.2026. Hier stand die Kürzung, die den Namen traf, BEVOR " +
      "klassenBestimmen ihn sah. Sie heisst jetzt anzeigename und ist damit auch im Namen von der " +
      "Messung getrennt: Der Messeingang ist der ungekürzte Name, gekürzt wird nur, was angezeigt " +
      "und protokolliert wird. Der Eintrag bleibt stehen, weil die Kürzung selbst geblieben ist — " +
      "sie hat nur ihren Platz gewechselt, und wer sie zurückschiebt, soll hier lesen warum.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "rolle: saeubern(nachschlag.antwort.rolle, 40)",
    grund:
      "Dieselbe Aufrufstelle wie darüber. Die Rolle geht in denselben Messtext ein; 40 Zeichen " +
      "überschreitet keine ARIA-Rolle, und ein längerer Wert wäre keine Rolle, sondern Fliesstext.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "marke: saeubern(nachschlag.antwort.marke, 20)",
    grund:
      "Die Marke ist ein HTML-Elementname und wird auf Gleichheit gegen unsere eigenen Vokabeln " +
      "geprüft (input, button). 20 Zeichen decken jeden davon; ein längerer Wert kann keiner sein.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "typ: saeubern(nachschlag.antwort.feldtyp, 20)",
    grund:
      "Der Feldtyp wird auf Gleichheit gegen password, file und submit geprüft. Alle drei sind kürzer " +
      "als 20 Zeichen, und was länger ist, ist keiner der drei.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "name: saeubern(lage.ziel.name, GRENZEN.nameZeichen)",
    grund:
      "Der Name in der Antwort an den Agenten und im Protokollbuch, also Anzeige. Gemessen wurde " +
      "vorher, an anderer Stelle; diese Zeile entscheidet nichts.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "name: saeubern(a.name, GRENZEN.nameZeichen)",
    grund:
      "Die Trefferliste von extract geht an den Agenten. Anzeige, keine Messung — und ohne Deckel " +
      "passte hier eine ganze Seite in einen Rahmen.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "const name = saeubern(t.name, GRENZEN.nameZeichen)",
    grund: "Dieselbe Trefferliste, dieselbe Begründung: Anzeige für den Agenten.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "const name = saeubern(antwort.antwort.name, GRENZEN.nameZeichen)",
    grund:
      "Die Rückmeldung nach der ausgeführten Tat. Sie steht NACH der Freigabe und nach jeder Messung; " +
      "was hier gekürzt wird, hat nichts mehr zu entscheiden.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "const rolle = saeubern(antwort.antwort.rolle, 40)",
    grund: "Dieselbe Rückmeldung, dieselbe Begründung.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "name: saeubern(wf.name, 120)",
    grund:
      "Der Name eines gespeicherten Ablaufs. Er stammt vom Menschen aus der Werkbank und nicht von " +
      "der besuchten Seite, und er wird angezeigt, nicht gemessen.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "shown: { ref: ziel.ref, role: saeubern(ziel.rolle, 40)",
    grund:
      "Die Rückmeldung von highlight an den Agenten. Sie steht NACH der Freigabe und nach jeder " +
      "Messung; was hier gekürzt wird, entscheidet nichts mehr.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "clicked: { ref: ziel.ref, role: saeubern(ziel.rolle, 40)",
    grund:
      "Die Rückmeldung nach dem ausgeführten Klick, an den Agenten und ins Protokollbuch. Dieselbe " +
      "Begründung wie eine Zeile darüber: Anzeige, keine Messung.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "role: saeubern(a.rolle, 40)",
    grund:
      "Die Rolle in der Trefferliste von extract. Sie geht an den Agenten; ohne Deckel passte hier " +
      "eine ganze Seite in einen Rahmen.",
  },
  {
    datei: "src/net/ausfuehrer.js",
    muster: "role: saeubern(t.rolle, 40)",
    grund: "Dieselbe Trefferliste, dieselbe Begründung: Anzeige für den Agenten.",
  },
  {
    datei: "src/content/geheim.js",
    muster: "return kuerzen(marke(el).toLowerCase(), grenze)",
    grund:
      "Der Rückfall der Beschreibung eines Feldes, wenn kein Etikett zu finden war: der HTML-" +
      "Elementname. Er geht in die Aufnahme der Werkbank, nicht in eine Wache.",
  },
  {
    datei: "src/content/rekorder.js",
    muster: "return kuerzen(String((el && el.tagName)",
    grund:
      "Dieselbe Bauform in der Aufnahme: der Elementname als letzter Rückfall einer Beschreibung. " +
      "Beschreibungen werden angezeigt und abgespielt, nicht gegen Wachlisten gehalten.",
  },
];

test("B1 — jede Kürzung eines gemessenen Namens steht mit Begründung in der Positivliste", () => {
  listePruefen(KUERZUNGEN, "KUERZUNGEN");
  nurWasEingetragenIst((z) => NAME_GEKUERZT.test(z.text), KUERZUNGEN, "Gekürzter Name");
});

test("B1 — die Messung selbst kürzt nirgends", () => {
  /*
   * Die Gegenrichtung zur Liste oben, und die härtere Zusage: In den
   * Funktionen, die MESSEN, darf überhaupt keine Kürzung stehen — kein
   * Deckel, kein `slice`, kein `GRENZEN`. Nicht „nur an eingetragenen
   * Stellen", sondern gar nicht.
   *
   * Gemessen wird am Quelltext der gemeinsamen Messform: Sie ist die eine
   * Datei, durch die jeder Vergleich läuft.
   */
  const quelle = readFileSync(new URL("../gemeinsam/messform.js", import.meta.url), "utf8");
  const koerper = quelle
    .split("\n")
    .filter((z) => {
      const a = z.trimStart();
      return a && !(a.startsWith("*") || a.startsWith("//") || a.startsWith("/*"));
    })
    .join("\n");

  for (const verboten of ["GRENZEN", "saeubern", ".slice(", ".substring(", ".substr(", "nameZeichen"]) {
    assert.ok(
      !koerper.includes(verboten),
      `messform.js enthält „${verboten}" — die Messform kürzt ihren Eingang nicht, in keiner Länge`
    );
  }

  /* Und die Zusage misst auch wirklich etwas: 100.000 Zeichen um das Wort
     herum ändern am Ergebnis nichts. */
  const { messrand } = globalThis.SMARTR_MESSFORM;
  const riesig = `${"x".repeat(100000)} kasse ${"y".repeat(100000)}`;
  assert.ok(messrand(riesig).includes(" kasse "), "die Messform hat den Text doch beschnitten");
});

/* ------------------------------------------------------------------ *
 * B2 — `new URL(...).pathname`
 *
 * Die Bauform aus AUTOMODUS-3 und AUTOMODUS-4: `pathname` dekodiert
 * Prozentfolgen nicht, `search` und `hash` fehlen. Wer eine Adresse für eine
 * ENTSCHEIDUNG zerlegt, benutzt `messweg` — sonst misst er weniger, als der
 * Server ausliefert.
 * ------------------------------------------------------------------ */

const PFAD_ZERLEGT = /\.pathname\b/;

const PFADE = [
  {
    datei: "src/gemeinsam/messform.js",
    muster: "teile = `${u.pathname} ${u.search} ${u.hash}`",
    grund:
      "Das IST messweg — die eine Stelle, an der eine Adresse für eine Messung zerlegt werden darf. " +
      "Sie nimmt Pfad, Suche UND Fragment und packt jede Prozentfolge aus, mehrfach.",
  },
  {
    datei: "src/net/befehle.js",
    muster: "const pfad = u.pathname === \"/\" ? \"\" : u.pathname",
    grund:
      "adressVorschau baut den Satz, mit dem der Mensch nach einem Ortswechsel gefragt wird. Reine " +
      "Anzeige: Hier soll die Adresse so dastehen, wie der Agent sie geschickt hat, denn genau die " +
      "wird gleich aufgerufen. Ausgepackt wird sie in messweg, das daneben läuft.",
  },
  {
    datei: "src/net/protokollbuch.js",
    muster: "pfad = new URL(String(roh)).pathname",
    grund:
      "Das Protokollbuch hält fest, WO etwas geschah, für den Menschen zum Nachlesen. Es entscheidet " +
      "nichts und wird von niemandem gegen eine Wortliste gehalten.",
  },
];

test("B2 — eine Adresse wird nur in messweg für eine Entscheidung zerlegt", () => {
  listePruefen(PFADE, "PFADE");
  nurWasEingetragenIst((z) => PFAD_ZERLEGT.test(z.text), PFADE, "Adresszerlegung über pathname");
});

test("B2 — messweg misst Pfad, Suche und Fragment, roh UND ausgepackt", () => {
  /* Die Gegenprobe zur Quelltextsuche: dass die eine erlaubte Stelle auch
     wirklich das tut, was der Eintrag behauptet. */
  const { messweg } = globalThis.SMARTR_MESSFORM;
  const gemessen = messweg("https://shop.de/%6Basse/x?y=%62ezahlen#/konto/l%C3%B6schen");
  for (const teil of ["kasse", "bezahlen", "schen", "%6Basse"]) {
    assert.ok(gemessen.includes(teil), `„${teil}" fehlt in „${gemessen}"`);
  }
  /* Eine kaputte Folge daneben darf das Auspacken nicht abschalten — sonst
     genügte ein angehängtes „%zz". */
  assert.ok(messweg("https://shop.de/%6Basse%zz").includes("kasse"));
});

/* ------------------------------------------------------------------ *
 * B3 — Vergleich ohne Messform
 *
 * Die allgemeinste Gestalt der Klasse: Ein Text von der besuchten Seite wird
 * kleingeschrieben und dann verglichen. `toLowerCase()` allein nimmt weder
 * die unsichtbaren Zeichen weg noch die Breitzeichen, die Kapitälchen oder
 * die kyrillischen Zwillinge — die Seite darf sich ihre Schreibweise also
 * weiter aussuchen.
 *
 * Erlaubt ist es nur dort, wo in derselben Zeile die Messform steht, oder in
 * der Liste darunter.
 * ------------------------------------------------------------------ */

const VERGLEICH_OHNE_MESSFORM = (zeile) =>
  /\.toLowerCase\(\)/.test(zeile.text) &&
  /\b(name|titel|title|label|etikett|beschriftung|text|rolle|role|marke|tagName|optionstext|seitentext)\b/i.test(zeile.text) &&
  !/messtext|messrand|messvarianten|gleicherText|vergleichsform|flachmachen/.test(zeile.text);

const VERGLEICHE = [
  {
    datei: "src/net/befehle.js",
    muster: "const rolle = saeubern(roh.rolle, 40).toLowerCase()",
    grund:
      "knotenPruefen normiert die Rolle für den TEXTBAUM, den der Agent liest. Der Klassifizierer " +
      "misst die Rolle an anderer Stelle und dort mit messtext.",
  },
  {
    datei: "src/net/matrix.js",
    muster: "matrix.domains[String(name).trim().toLowerCase()]",
    grund:
      "Ein Domainname aus der Einstellungsmatrix, den der MENSCH eingetippt hat. Domains werden " +
      "ohnehin über hostAus und die Bereichsprüfung geführt, nicht über die Messform für Fliesstext.",
  },
  {
    datei: "src/net/matrix.js",
    muster: "je[String(name).trim().toLowerCase()]",
    grund: "Dieselbe Einstellungsmatrix, dieselbe Begründung: Domainname vom Menschen, nicht von der Seite.",
  },
  {
    datei: "src/net/rechte.js",
    muster: "new URL(u).hostname.toLowerCase()",
    grund:
      "Die drei eigenen Ursprünge der Erweiterung, aus fest verdrahteten Konstanten. Kein Fremdtext, " +
      "und ein Wirtsname hat keine unsichtbaren Zeichen — URL wirft dort vorher.",
  },
  {
    datei: "src/net/dienste.js",
    muster: "name.toLowerCase() === \"authorization\"",
    grund:
      "Ein HTTP-Kopfzeilenname aus unserem eigenen Code, gegen eine feste Vokabel geprüft. Er stammt " +
      "nicht von der besuchten Seite.",
  },
  {
    datei: "src/content/overlay.js",
    muster: "rolle: el.getAttribute(\"role\") || el.tagName.toLowerCase()",
    grund:
      "Die Rolle wird hier nur EINGESAMMELT und weitergereicht; gemessen wird sie im Dienstarbeiter " +
      "mit messtext. Eine zweite Normierung hier wäre eine zweite Fassung derselben Regel (F4).",
  },
  {
    datei: "src/content/overlay.js",
    muster: "const ausdruecklich = (el.getAttribute(\"role\") || \"\").trim().toLowerCase()",
    grund:
      "Die ausdrücklich gesetzte ARIA-Rolle beim Einsammeln der Bauform. Sie wird gegen unsere eigene " +
      "Rollenliste gehalten und im Dienstarbeiter mit messtext gemessen, bevor daraus eine Klasse wird.",
  },
  {
    datei: "src/content/overlay.js",
    muster: "const s = String(etikett).trim().toLowerCase()",
    grund:
      "OFFENE STELLE: die Suchseite desselben Vergleichs wie bei optionstext. Der Wert stammt hier " +
      "vom AGENTEN; die Seite steht auf der anderen Seite des Vergleichs. Umbau auf gleicherText " +
      "gehört dem Gebiet Overlay (Fremdbedarf im Merkzettel fundament.md).",
  },
  {
    datei: "src/content/overlay.js",
    muster: "const tag = el.tagName.toLowerCase()",
    grund:
      "Der HTML-Elementname für die Auswahl der Bauform, gegen unsere eigenen Vokabeln. tagName " +
      "liefert der Browser, nicht das Markup der Seite.",
  },
  {
    datei: "src/content/overlay.js",
    muster: "marke: String(el.tagName || \"\").toLowerCase()",
    grund: "Dieselbe Marke, dieselbe Begründung: vom Browser, gegen unsere Vokabeln.",
  },
  {
    datei: "src/content/overlay.js",
    muster: "const art = (el.getAttribute(\"type\") || \"text\").toLowerCase()",
    grund:
      "Das type-Merkmal eines Feldes. Es wird im Dienstarbeiter mit messtext gemessen, bevor daraus " +
      "eine harte Klasse wird; hier steht nur das Einsammeln.",
  },
  {
    datei: "src/content/overlay.js",
    muster: "const genau = waehlbar.find((o) => optionstext(o).toLowerCase() === s)",
    grund:
      "OFFENE STELLE, festgehalten und nicht genehmigt: Die Option einer Auswahlliste wird nach ihrem " +
      "Text gesucht, den die Seite schreibt. Das entscheidet keine Wache, aber es entscheidet, WELCHE " +
      "Option gewählt wird — der Umbau auf gleicherText gehört dem Gebiet Overlay und steht im " +
      "Merkzettel fundament.md als Fremdbedarf.",
  },
  {
    datei: "src/content/overlay.js",
    muster: "const teil = waehlbar.filter((o) => optionstext(o).toLowerCase().includes(s))",
    grund: "Dieselbe Auswahlliste, dieselbe offene Stelle, derselbe Fremdbedarf.",
  },
  {
    datei: "src/content/overlay.js",
    muster: "return seitentext().toLowerCase().includes(String(wert).trim().toLowerCase())",
    grund:
      "OFFENE STELLE: waitFor mit textPresent sucht Text des AGENTEN im Text der SEITE. Eine Seite, " +
      "die ein unsichtbares Zeichen einstreut, lässt die Wartebedingung nie eintreten — das kostet " +
      "eine Frist, keine Wache. Umbau auf messtext gehört dem Gebiet Overlay (Fremdbedarf).",
  },
  {
    datei: "src/content/overlay.js",
    muster: "const etikettSuche = String(name || \"\").trim().toLowerCase()",
    grund:
      "OFFENE STELLE: Ein Element wird über sein Etikett gesucht. Findet die Suche nichts, endet der " +
      "Befehl mit einer Absage und nicht mit einer stillen Tat; die Richtung ist also die erlaubte. " +
      "Umbau auf messtext gehört dem Gebiet Overlay (Fremdbedarf).",
  },
  {
    datei: "src/content/overlay.js",
    muster: "const etikett = (el.getAttribute(\"aria-label\") || \"\").toLowerCase()",
    grund: "Dieselbe Etikettsuche, dieselbe offene Stelle, derselbe Fremdbedarf.",
  },
  {
    datei: "src/content/overlay.js",
    muster: "if (namen.length && !namen.some((f) => name.toLowerCase().includes(f))) continue",
    grund:
      "Ein Filter, mit dem der AGENT die Trefferliste von extract eingrenzt. Beide Seiten des " +
      "Vergleichs sind hier nicht die Wache; ein verfehlter Filter liefert weniger Treffer, nie mehr Rechte.",
  },
  {
    datei: "src/content/selektor.js",
    muster: "return String(el.tagName || \"\").toLowerCase()",
    grund: "Der Elementname für den Anker des Teach-Modus, vom Browser geliefert, gegen unsere Vokabeln.",
  },
  {
    datei: "src/content/selektor.js",
    muster: "const name = String((a && a.name) || \"\").toLowerCase()",
    grund:
      "Der Name eines MERKMALS (id, class, data-…), nicht der Name eines Elements. Er wird gegen " +
      "unsere eigene Liste brauchbarer Merkmale gehalten.",
  },
  {
    datei: "src/content/selektor.js",
    muster: "const rolle = merkmal(el, \"role\").trim().toLowerCase()",
    grund: "Die ARIA-Rolle für den Anker, gegen unsere eigene Rollenliste. Keine Wache.",
  },
  {
    datei: "src/content/rekorder.js",
    muster: "const art = merkmal(el, \"type\").toLowerCase()",
    grund:
      "Das type-Merkmal in der Aufnahme, gegen unsere eigenen Vokabeln. Die Geheimfeld-Entscheidung " +
      "trifft geheim.js und nicht diese Zeile.",
  },
  {
    datei: "src/content/rekorder.js",
    muster: "return kuerzen(String((el && el.tagName)",
    grund:
      "Der Elementname als letzter Rückfall einer Beschreibung. Steht auch in KUERZUNGEN und dort " +
      "ausführlicher begründet.",
  },
  {
    datei: "src/content/geheim.js",
    muster: "return kuerzen(marke(el).toLowerCase(), grenze)",
    grund:
      "Derselbe Rückfall in der einen Quelle für Geheimnisse. Steht auch in KUERZUNGEN und dort " +
      "ausführlicher begründet.",
  },
  {
    datei: "src/content/geheim.js",
    muster: "text: kuerzen(marke(el).toLowerCase(), grenze)",
    grund:
      "Dieselbe Zeile wie der Eintrag darüber, nur seit dem 14.08.2026 anders geschrieben: " +
      "beschreibungVon gibt jetzt einen Befund mit Quelle zurück, damit der Rückfall auf den " +
      "Elementnamen als solcher erkennbar ist. Befund TEACH-1: Zwei verschiedene Felder hiessen " +
      "beide input, und die Identitätswache aus F3 verglich zwei Namen, die keine sind. Der " +
      "Elementname kommt vom Browser und nicht aus dem Markup der Seite; gemessen wird er " +
      "nirgends, er wird nur genannt, und ab jetzt mit der Vorsilbe ohne-namen als das " +
      "gekennzeichnet, was er ist. Der Eintrag darüber deckt die alte Schreibweise und ist damit " +
      "leer, er darf beim nächsten Aufräumen weg.",
  },
];

test("B3 — ein Vergleich an Seitentext steht mit Begründung in der Positivliste", () => {
  listePruefen(VERGLEICHE, "VERGLEICHE");
  nurWasEingetragenIst(VERGLEICH_OHNE_MESSFORM, VERGLEICHE, "Vergleich ohne Messform");
});

/* ------------------------------------------------------------------ *
 * B4 — Die Wachen selbst müssen dastehen
 *
 * Die Positivlisten oben finden neue Umgehungen. Dieser Satz findet das
 * Gegenteil: dass jemand die Wache AUSBAUT und alles grün bleibt, weil kein
 * Muster mehr da ist, über das man sich streiten könnte. Genau so ist die
 * Verdeckungswache am 11.08.2026 aus dem Klickweg verschwunden.
 * ------------------------------------------------------------------ */

test("B4 — die Messform ist im Klassifizierer und in der Seite wirklich eingebaut", () => {
  const befehle = readFileSync(new URL("../net/befehle.js", import.meta.url), "utf8");
  assert.ok(befehle.includes('from "./messform.js"'), "befehle.js benutzt die gemeinsame Messform nicht");
  assert.ok(/function flachmachen\(roh\) \{\s*return messrand\(roh\);/.test(befehle),
    "flachmachen misst nicht mehr über messrand");
  assert.ok(/function wegVon\(roh\) \{\s*return messweg\(roh\);/.test(befehle),
    "wegVon misst nicht mehr über messweg");
  assert.ok(befehle.includes("kuerzungsspur(z.name)"),
    "klassenBestimmen erkennt einen vorher gekürzten Namen nicht mehr");
  assert.ok(befehle.includes("b.unvollstaendig === true"),
    "freigabeNoetig fragt bei unvollständiger Messung nicht mehr");

  const seite = readFileSync(new URL("../net/seite.js", import.meta.url), "utf8");
  const listen = seite.match(/const (OVERLAY_DATEIEN|PFLICHT_DATEIEN) = \[[^\]]*\]/g) || [];
  assert.equal(listen.length, 2, "die beiden Einspiellisten sind nicht mehr zu finden");
  for (const liste of listen) {
    assert.ok(
      liste.includes("src/gemeinsam/messform.js"),
      "die Messform fehlt in einer Einspielliste — dann misst die Seite in einer anderen Form als der Dienst"
    );
    const zeilen = liste.split("\n").filter((z) => z.includes("src/"));
    assert.ok(
      zeilen[0].includes("messform.js"),
      "die Messform muss ganz vorn stehen: Wer sie fragt, muss sie vorfinden"
    );
  }
});
