/*
 * Prüfung der GESTALTFORM in `src/content/geheim.js`.
 *
 * Aufruf:  cd src && node --test "pruefung/geheim-gestalt.test.mjs"
 *
 * ====================================================================
 * WOZU DIESE DATEI DA IST
 * ====================================================================
 *
 * Nachabnahme 0.6.0 vom 15.08.2026, Fund mit Schwere BLOCKER: Die
 * Geheimerkennung normalisierte nicht. `kernVon` strippte nur Weissraum,
 * Punkt, Bindestrich und Schrägstrich, `ziffernketten` zog nur an
 * Leerzeichen und Bindestrich zusammen — und der Skeptiker hat ACHT
 * Schreibweisen belegt, mit denen eine Kartennummer oder ein Einmalcode an
 * `textHarmlos`/`wertHarmlos` vorbei in den gespeicherten Ablauf lief:
 * Unterstrich, Komma, Mittelpunkt U+00B7, geschützter Bindestrich U+2011,
 * einzeln unterstrichene Ziffern, Vollbreiten-Ziffern, nullbreit getrennte
 * Ziffern und gemischt vollbreit/schmal. Das ist die B6/TEACH-2-Leckklasse,
 * wieder offen durch die Trenner/Unicode-Tür — dieselbe Fehlerklasse wie
 * AUTOMODUS-1: Es wird gemessen, ohne vorher zu normalisieren.
 *
 * Repariert ist das in `gestaltform` (Vollbreiten-Ziffern auf ASCII, NFKC,
 * Format- und Nullbreitenzeichen ersatzlos weg), in `NUMMERN_TRENNER` (die
 * Familie der Nummerngliederer statt vier Einzelzeichen) und in
 * `ziffernketten` (Fusion an JEDEM einzelnen Nicht-Ziffern-Zeichen, mit
 * zwei Deckeln für den Alltag).
 *
 * Diese Datei misst DREIERLEI, und alle drei gehören zusammen:
 *
 *   1. Jede der acht belegten Umgehungen ist zu. Nicht „eine davon", alle —
 *      der Angreifer sucht sich sein Zeichen aus.
 *   2. Was vorher harmlos war, bleibt harmlos. Eine Wache, die jeden Preis,
 *      jede Uhrzeit und jedes Datum frisst, wird abgeschaltet statt gelesen,
 *      und eine abgeschaltete Wache ist die schlechteste von allen.
 *   3. Die Unsichtbaren-Tabelle hier und die in `messform.js` laufen nicht
 *      auseinander. Es sind zwei Abschriften (der Teach-Modus spielt
 *      `geheim.js` ohne `messform.js` ein, REKORDER_DATEIEN in `worker.js`),
 *      und zwei Abschriften ohne Drift-Wache sind genau der Befund, den
 *      Festlegung F4 abgeschafft hat.
 *
 * Mutationsdisziplin: Jeder Satz hier war ROT am Stand vor der Reparatur
 * (gemessen am 15.08.2026 gegen die Fassung ohne `gestaltform`) und ist
 * GRÜN am reparierten Stand. Wer die Reparatur zurückdreht, sieht G1, G2
 * und G6 fallen.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const GEHEIM_QUELLE = new URL("../content/geheim.js", import.meta.url);
const MESSFORM_QUELLE = new URL("../gemeinsam/messform.js", import.meta.url);

/**
 * Lädt `geheim.js` (und auf Wunsch `messform.js`) in einen frischen
 * Sandkasten — denselben Weg, den `chrome.scripting.executeScript` geht:
 * klassisches Skript, `globalThis`, kein Import.
 *
 * @param {{kaputtesNormalize?: boolean}} angaben `kaputtesNormalize` stellt
 *        die Seite nach, die `String.prototype.normalize` überschrieben hat
 *        — die Gestaltprüfung muss auch dann fallen dürfen, nur nicht offen
 *        stehen (Vollbreiten-Ziffern werden von Hand gefaltet).
 */
function laden({ kaputtesNormalize = false, mitMessform = false } = {}) {
  const sandkasten = {};
  vm.createContext(sandkasten);
  vm.runInContext("var globalThis = this;", sandkasten);
  if (kaputtesNormalize) {
    vm.runInContext(
      'String.prototype.normalize = function () { throw new Error("von der Seite zerlegt"); };',
      sandkasten
    );
  }
  if (mitMessform) {
    vm.runInContext(readFileSync(MESSFORM_QUELLE, "utf8"), sandkasten, {
      filename: "messform.js",
    });
  }
  vm.runInContext(readFileSync(GEHEIM_QUELLE, "utf8"), sandkasten, { filename: "geheim.js" });
  assert.ok(sandkasten.SMARTR_GEHEIM, "geheim.js muss globalThis.SMARTR_GEHEIM setzen");
  return sandkasten;
}

/* Die acht belegten Umgehungen der Nachabnahme, wörtlich aus dem Fund. Die
   unsichtbaren Zeichen stehen als Escape, damit ein Editor sie nicht beim
   Speichern „aufräumt" und der Satz still etwas anderes misst. */
const UMGEHUNGEN = [
  ["4111_1111_1111_1111", "Karte mit Unterstrich"],
  ["4111,1111,1111,1111", "Karte mit Komma"],
  ["4111·1111·1111·1111", "Karte mit Mittelpunkt U+00B7"],
  ["4111‑1111‑1111‑1111", "Karte mit geschütztem Bindestrich U+2011"],
  ["8_4_9_2_7_1", "Einmalcode, Ziffern einzeln unterstrichen"],
  ["８４９２７１", "Einmalcode in Vollbreiten-Ziffern"],
  ["8​4​9​2​7​1", "Einmalcode, nullbreit getrennt U+200B"],
  ["４111 1111 1111 1111", "Karte gemischt vollbreit/schmal"],
];

test("G1: alle acht belegten Umgehungen sind zu — als Text UND im Satz", () => {
  const G = laden().SMARTR_GEHEIM;

  for (const [text, name] of UMGEHUNGEN) {
    assert.equal(G.textHarmlos(text), false, `${name}: läuft weiter in Anker/Beschreibung`);
    /* Und als Teilkette mitten im Satz (die TEACH-2-Regel gilt auch für die
       neuen Trenner): Eine 2FA-Seite schreibt ihren Code nie allein hin.
       Ausgenommen ist nur die einzeln getrennte Ziffernfolge: „8_4_9_2_7_1"
       misst mitten im Satz dasselbe wie „8 4 9 2 7 1" schon immer — die
       Fusion braucht Gruppen ab drei Stellen, sonst wäre jede Gliederung
       „1.2.3" ein Code. Allein stehend fallen beide (oben gemessen). */
    if (text === "8_4_9_2_7_1") continue;
    assert.equal(
      G.textHarmlos(`Dein Code lautet ${text} danke`),
      false,
      `${name}: läuft als Teilkette im Satz durch`
    );
  }

  /* Die Kartenvarianten müssen auch als FELDWERT fallen, und zwar über die
     Prüfziffer — ein belegtes Feld darf trotzdem keine Kartennummer tragen
     (Befund TEACH-4, jetzt in jeder Schreibweise). */
  for (const karte of [
    "4111_1111_1111_1111",
    "4111,1111,1111,1111",
    "4111·1111·1111·1111",
    "4111‑1111‑1111‑1111",
    "４111 1111 1111 1111",
  ]) {
    assert.equal(G.wertGestalt(karte), "kartennummer", `Wert: ${JSON.stringify(karte)}`);
  }
});

test("G2: jede Schreibweise hat dieselbe Gestalt wie ihre ASCII-Form", () => {
  /* Die allgemeine Fassung von G1: Nicht die acht Zeichen sind die Zusage,
     sondern die Gleichheit — eine Schreibweise, die ein Mensch als dieselbe
     Nummer liest, bekommt dieselbe Antwort wie die glatte Form. Damit ist
     auch das NÄCHSTE Trennzeichen gemessen, nicht nur die belegten. */
  const G = laden().SMARTR_GEHEIM;

  const paare = [
    ["4111_1111_1111_1111", "4111 1111 1111 1111"],
    ["4111,1111,1111,1111", "4111 1111 1111 1111"],
    ["4111·1111·1111·1111", "4111-1111-1111-1111"],
    ["4111‑1111‑1111‑1111", "4111-1111-1111-1111"],
    ["8_4_9_2_7_1", "8 4 9 2 7 1"],
    ["８４９２７１", "849271"],
    ["8​4​9​2​7​1", "849271"],
    ["４111 1111 1111 1111", "4111 1111 1111 1111"],
  ];
  for (const [krumm, glatt] of paare) {
    assert.equal(
      G.geheimGestalt(krumm),
      G.geheimGestalt(glatt),
      `Text: ${JSON.stringify(krumm)} misst anders als ${JSON.stringify(glatt)}`
    );
    assert.equal(
      G.wertGestalt(krumm),
      G.wertGestalt(glatt),
      `Wert: ${JSON.stringify(krumm)} misst anders als ${JSON.stringify(glatt)}`
    );
  }

  /* Ausgeschrieben, damit es niemand für ein Loch hält: `wertHarmlos` sagt
     für „8_4_9_2_7_1" dasselbe wie für „849271" — nämlich ja. Über reine
     Ziffern im WERT entscheidet das Feld (`geheim`, `zifferngruppe`,
     `codeKasten`), nicht die Schreibweise; das ist die Kopfzusage von
     `wertGestalt`, ohne die der Teach-Modus keine Artikelnummer mehr
     speichern dürfte. Die Zusage hier ist die GLEICHHEIT der Antworten. */
  assert.equal(G.wertHarmlos("8_4_9_2_7_1"), G.wertHarmlos("849271"));
});

test("G3: was vorher harmlos war, bleibt harmlos", () => {
  const G = laden().SMARTR_GEHEIM;

  /* Die gepinnten grünen Fälle aus rekorder.test.mjs R45 und
     selektor.test.mjs S23/S29, wörtlich übernommen … */
  for (const gut of [
    "Angebot vom 14.08.2026 bearbeiten",
    "Angebot vom 14.08.2026",
    "Seite 12",
    "Preis 1299 Euro",
    "iPhone13",
    "MP3-Player",
    "col-md-6",
    "btn-primary",
    "relist",
    "Erneut einstellen",
  ]) {
    assert.equal(G.textHarmlos(gut), true, `„${gut}" muss durchgehen`);
  }

  /* … und die Grenzfälle, die die neuen Trenner am ehesten träfen: Preise,
     Uhrzeiten, Datums- und Versionsangaben, Telefonnummern. Jeder dieser
     Sätze war am alten Stand grün und hätte mit einer Fusion „an jedem
     Trenner, ab zwei Gruppen" verloren. */
  for (const gut of [
    "Preis 100.000 Euro", // deutscher Tausenderpunkt: zwei Gruppen, kein Code
    "100,000 views", // englisches Tausenderkomma
    "1.234,56 EUR", // Preis mit Punkt und Komma: ungleiche Gruppen
    "3,99", // Dezimalkomma
    "Abfahrt 12:45 Uhr", // Uhrzeit: Doppelpunkt ist kein Nummerntrenner
    "Termin 12:34:56", // drei Gruppen, aber unter drei Stellen
    "(030) 1234", // Telefon-Grenzfall: Klammern trennen, sie gliedern nicht
    "Tel. 030 / 1234", // mehrzeichiger Trenner bleibt eine Grenze
    "Version 10.11.12", // Versionsnummer: Gruppen unter drei Stellen
    "IP 192.168.178.1", // ungleich lange Gruppen bleiben getrennt
    "Artikel 4711, 4712 und 4713", // Aufzählung: „, " sind zwei Zeichen
  ]) {
    assert.equal(G.textHarmlos(gut), true, `„${gut}" muss durchgehen`);
  }

  /* Ein Wert bleibt ein Wert: reine Ziffern entscheidet weiter das Feld. */
  assert.equal(G.wertGestalt("9988776655"), null);
});

test("G4: die Gruppenregel fusioniert an jedem Zeichen — ab drei gleichen Gruppen", () => {
  const G = laden().SMARTR_GEHEIM;

  /* Wer den Doppelpunkt oder die Klammer als Trenner missbraucht, gewinnt
     nichts: Ab drei gleich langen Gruppen zieht `ziffernketten` an JEDEM
     einzelnen Zeichen zusammen. Uhrzeiten überstehen das, weil ihre Gruppen
     unter `GRUPPE_MINDEST` liegen (G3 misst sie). */
  for (const boese of [
    "4111:1111:1111:1111",
    "4111.1111.1111.1111",
    "Karte 4111.1111.1111.1111 gespeichert",
    "4111(1111(1111(1111",
    "Dein Code lautet 4111_1111_1111_1111",
  ]) {
    assert.equal(G.textHarmlos(boese), false, `„${boese}" läuft durch`);
  }

  /* Die gepinnte Lesart aus R45 steht dabei unverändert: */
  assert.deepEqual(Array.from(G.ziffernketten("4111 1111 1111 1111")), ["4111111111111111"]);
  assert.deepEqual(Array.from(G.ziffernketten("14.08.2026")), ["14", "08", "2026"]);
  assert.deepEqual(Array.from(G.ziffernketten("849 271")), ["849271"]);
  /* Und die neue: dieselbe Karte, anderer Trenner, dieselbe Kette. */
  assert.deepEqual(Array.from(G.ziffernketten("4111,1111,1111,1111")), ["4111111111111111"]);
  /* Zwei Gruppen an einem Fremdtrenner fusionieren NICHT — das ist der
     Deckel, der „100.000" schützt (Begründung an GRUPPE_FREMDTRENNER_MINDEST). */
  assert.deepEqual(Array.from(G.ziffernketten("100.000")), ["100", "000"]);
});

test("G5: die Unsichtbaren-Tabelle läuft nicht von messform.js weg", () => {
  /* Zwei Abschriften derselben Zeichenliste sind erlaubt worden, weil der
     Teach-Modus `geheim.js` ohne `messform.js` einspielt — aber nur mit
     dieser Wache: Jedes Zeichen, das `messform.js` als unsichtbar führt,
     muss auch in der Gestaltform von `geheim.js` ersatzlos verschwinden.
     Fehlt eines, steht hier, welches. */
  const sandkasten = laden({ mitMessform: true });
  const G = sandkasten.SMARTR_GEHEIM;
  const M = sandkasten.SMARTR_MESSFORM;

  const muster = M.unsichtbareZeichen();
  const einzeln = new RegExp(muster.source, muster.flags.replace("g", ""));
  let geprueft = 0;
  for (let cp = 0; cp <= 0xffff; cp++) {
    const zeichen = String.fromCharCode(cp);
    if (!einzeln.test(zeichen)) continue;
    geprueft += 1;
    assert.equal(
      G.gestaltform(`84${zeichen}92${zeichen}71`),
      "849271",
      `U+${cp.toString(16).toUpperCase().padStart(4, "0")} überlebt die Gestaltform`
    );
  }
  assert.ok(geprueft > 50, `nur ${geprueft} unsichtbare Zeichen gefunden — die Tabelle fehlt?`);

  /* Die Etikettzeichen-Ebene (U+E0000 ff., der bekannteste Schmuggelweg)
     stichprobenweise — sie liegt ausserhalb der BMP-Schleife oben. */
  for (const cp of [0xe0001, 0xe0041, 0xe007f]) {
    const zeichen = String.fromCodePoint(cp);
    assert.equal(G.gestaltform(`84${zeichen}92${zeichen}71`), "849271");
    assert.equal(G.textHarmlos(`84${zeichen}92${zeichen}71`), false);
  }
});

test("G6: Vollbreiten-Ziffern fallen auch, wenn die Seite normalize zerlegt hat", () => {
  /* `String.prototype.normalize` gehört der Seite, und eine Wache, die an
     einer überschreibbaren Funktion hängt, gehört ihr damit auch. Die
     Vollbreiten-Ziffern werden deshalb von Hand gefaltet (fester Abstand
     0xFEE0), und der geschützte Bindestrich hängt an der eigenen
     Trennerliste, nicht an NFKC. Fällt NFKC, fällt weniger Faltung — aber
     keine der acht belegten Umgehungen geht wieder auf. */
  const G = laden({ kaputtesNormalize: true }).SMARTR_GEHEIM;

  for (const [text, name] of UMGEHUNGEN) {
    assert.equal(G.textHarmlos(text), false, `${name}: offen, sobald normalize fehlt`);
  }
  assert.equal(G.wertGestalt("４111 1111 1111 1111"), "kartennummer");

  /* Und die Gegenrichtung: Harmloses bleibt auch ohne NFKC harmlos. */
  assert.equal(G.textHarmlos("Angebot vom 14.08.2026 bearbeiten"), true);
  assert.equal(G.textHarmlos("Preis 100.000 Euro"), true);
});
