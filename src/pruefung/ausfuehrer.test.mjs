/*
 * Prüfung des Ausführers.
 *
 * Aufruf:  node --test src/pruefung/
 *
 * Die Prüfungen sind nach dem gebaut, was schiefgehen kann, nicht nach dem,
 * was gutgeht. Der Leitsatz dieser Runde — „kein Weg darf ohne Antwort enden"
 * — ist eine Zusicherung über ALLE Wege; deshalb steht am Ende ein Durchlauf,
 * der einen Strauß kaputter Rahmen durchschickt und für jeden einzelnen einen
 * `result`-Rahmen verlangt.
 *
 * Was hier NICHT geprüft wird und auch nicht geprüft werden kann: das
 * Seitenskript selbst (es braucht ein echtes DOM) und der Handschlag mit dem
 * Relay (er braucht einen echten Relay — dafür gibt es test_connect.py).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { attrappeSetzen, anDieSeite, anDasPanel } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, BEVOR die Module geladen werden: dienste.js liest
   die Fassung beim Laden aus dem Manifest. */
attrappeSetzen();

const {
  BEFEHLE,
  GRENZEN,
  saeubern,
  kennungPruefen,
  stufeReicht,
  hostAus,
  bereichPasst,
  knotenPruefen,
  textbaumBauen,
  rahmenDeckeln,
  parameterPruefen,
  frageZusatz,
  tippVorschau,
  adressVorschau,
  refPruefen,
} = await import("../net/befehle.js");

const { befehlAusfuehren, zaehlerNeu, laufBeenden } = await import("../net/ausfuehrer.js");
const { schliessgrund } = await import("../net/link.js");

/* ------------------------------------------------------------------ *
 * Gemeinsames Gerüst
 * ------------------------------------------------------------------ */

const SITZUNG = {
  stufe: "read",
  modus: "tab",
  bereich: ["geizhals.de"],
  schrittmodus: "confirm_each",
  tabId: 7,
  endetUm: Date.now() + 600000,
};

/* `active` und `status` gehören zum Tab, seit es `screenshot` und `navigate`
   gibt: Das Bild wird nur vom Tab im Vordergrund genommen, und nach einem
   Wechsel wird auf „complete" gewartet. */
const TAB = {
  id: 7,
  url: "https://geizhals.de/warenkorb",
  title: "Warenkorb",
  active: true,
  status: "complete",
  windowId: 3,
};

const KNOTEN = [
  { art: "bereich", rolle: "navigation", name: "Hauptmenü", tiefe: 0 },
  { art: "element", ref: "e1", rolle: "link", name: "Startseite", wert: null, zustand: ["visible"], tiefe: 1 },
  { art: "element", ref: "e2", rolle: "button", name: "Zur Kasse", wert: null, zustand: ["disabled"], tiefe: 1 },
  { art: "text", rolle: "p", name: "Zwischensumme: 428,90 Euro", tiefe: 1 },
];

function seiteStandard(n) {
  switch (n.typ) {
    case "overlay:ping":
      return { ok: true };
    case "overlay:baum":
      return { ok: true, epoche: "s1.abcd", knoten: KNOTEN, ausgelassen: { ausserhalb: 3 } };
    case "overlay:zustand":
      return {
        ok: true, readyState: "complete", scrollY: 0, scrollHeight: 4000,
        viewportHeight: 900, atTop: true, atBottom: false,
        epoche: "s1.abcd", elementCount: 2,
      };
    case "overlay:scrollen":
      return { ok: true, scrolledBy: 810, atTop: false, atBottom: false };
    case "overlay:nachschlagen":
      return {
        ok: true, rolle: "button", name: "Zur Kasse",
        rect: { left: 10, top: 20, width: 100, height: 40 }, mitte: { x: 60, y: 40 },
      };
    case "overlay:zeiger":
      return { ok: true };
    case "overlay:auslesen":
      return {
        ok: true,
        treffer: [
          { ref: "e2", rolle: "button", name: "Zur Kasse", wert: "428,90 Euro" },
        ],
      };
    case "overlay:warten":
      return { ok: true, erfuellt: true, wartezeitMs: 120 };
    case "overlay:auswaehlen":
      return { ok: true, rolle: "combobox", name: "Größe", gewaehlt: "XL" };
    default:
      return { ok: false, fehler: "unbekannte_nachricht" };
  }
}

const panelSagtJa = (n) => (n.typ === "link:schritt-freigabe" ? { ja: true } : { ok: true });
const panelSagtNein = (n) => (n.typ === "link:schritt-freigabe" ? { ja: false } : { ok: true });
const panelIstBesetzt = (n) =>
  n.typ === "link:schritt-freigabe" ? { ja: false, besetzt: true } : { ok: true };

async function laufen(rahmen, {
  sitzung = SITZUNG,
  tab = TAB,
  seite = seiteStandard,
  panel = panelSagtJa,
  neu = true,
  browserSagtNein = null,
  browserSchweigt = null,
  bildDatenUrl = null,
  verlauf = null,
  umleitungNach = null,
} = {}) {
  /* Der Tab wird KOPIERT: `tabs.update` und `tabs.goBack` verändern ihn, und
     ein Prüflauf, der den nächsten beeinflusst, misst irgendwann sich selbst. */
  const angaben = {
    tab: tab ? { ...tab } : tab,
    seiteAntwortet: seite,
    panelAntwortet: panel,
  };
  if (browserSagtNein) angaben.browserSagtNein = browserSagtNein;
  if (browserSchweigt) angaben.browserSchweigt = browserSchweigt;
  if (bildDatenUrl) angaben.bildDatenUrl = bildDatenUrl;
  if (verlauf) angaben.verlauf = verlauf;
  if (umleitungNach) angaben.umleitungNach = umleitungNach;
  const { spur } = attrappeSetzen(angaben);
  if (neu) zaehlerNeu();
  const ergebnis = await befehlAusfuehren(rahmen, sitzung);
  return { ergebnis, spur };
}

/** Alles, was an den Browser selbst ging — für „ist nie passiert". */
function anDenBrowser(spur) {
  return spur.filter((e) => String(e.wohin).startsWith("tabs.")).map((e) => e.wohin);
}

/** Die letzte Nachricht dieser Art an die Seite. */
function nachricht(spur, typ) {
  return [...spur].reverse().find((e) => e.wohin === "seite" && e.nachricht.typ === typ)?.nachricht;
}

/** Die Freigabefrage, die dem Menschen gestellt wurde. */
function freigabefrage(spur) {
  return spur.find((e) => e.wohin === "panel" && e.nachricht.typ === "link:schritt-freigabe")?.nachricht;
}

/** Jede Antwort ist ein Ergebnisrahmen mit derselben Kennung. */
function istErgebnisrahmen(ergebnis, id, cmd) {
  assert.equal(ergebnis.type, "result", "type muss 'result' sein");
  assert.equal(ergebnis.id, id, "die Kennung muss dieselbe sein");
  if (cmd !== undefined) assert.equal(ergebnis.cmd, cmd);
  assert.equal(typeof ergebnis.success, "boolean");
  if (ergebnis.success === false) {
    assert.equal(typeof ergebnis.error.code, "string");
    assert.ok(ergebnis.error.message.length > 0, "jeder Fehler hat einen Satz für den Menschen");
  }
}

/* ------------------------------------------------------------------ *
 * 1. Die reinen Entscheidungen (befehle.js)
 * ------------------------------------------------------------------ */

test("Kennung: nur nichtleere Zeichenketten bis 64 Zeichen", () => {
  assert.equal(kennungPruefen("c-7"), "c-7");
  assert.equal(kennungPruefen("x".repeat(64)), "x".repeat(64));
  assert.equal(kennungPruefen("x".repeat(65)), null);
  assert.equal(kennungPruefen(""), null);
  assert.equal(kennungPruefen(42), null);
  assert.equal(kennungPruefen(undefined), null);
});

test("Stufe: unbekannter Befehl reicht nie, unbekannte Stufe auch nicht", () => {
  assert.equal(stufeReicht("read", "readPage"), true);
  assert.equal(stufeReicht("write", "readPage"), true);
  assert.equal(stufeReicht("read", "click"), false, "click steht nicht auf der Positivliste");
  assert.equal(stufeReicht("read", "eval"), false);
  assert.equal(stufeReicht("read", "read_file"), false, "Relay-Befehl des Desktops, hier gesperrt");
  assert.equal(stufeReicht("", "readPage"), false);
  assert.equal(stufeReicht(undefined, "readPage"), false);
});

test("Host: Wurzelpunkt ist bedeutungslos, leere Marke ist keiner", () => {
  assert.equal(hostAus("https://geizhals.de./preis"), "geizhals.de");
  assert.equal(hostAus("https://GEIZHALS.de/x"), "geizhals.de");
  assert.equal(hostAus("https://geizhals..de/x"), null);
  assert.equal(hostAus("javascript:alert(1)"), null);
  assert.equal(hostAus("file:///etc/passwd"), null);
  assert.equal(hostAus("chrome://settings"), null);
  assert.equal(hostAus(""), null);
});

test("Bereich: leere Liste ist keine Erlaubnis, sondern das Gegenteil", () => {
  assert.equal(bereichPasst("https://geizhals.de/x", { modus: "tab", bereich: [] }), false);
  assert.equal(bereichPasst("https://geizhals.de/x", { modus: "domains", bereich: [] }), false);
  assert.equal(bereichPasst("https://geizhals.de/x", {}), false);
});

test("Bereich: 'nur dieser Tab' ist genau ein Host, ohne Platzhalter", () => {
  const s = { modus: "tab", bereich: ["geizhals.de"] };
  assert.equal(bereichPasst("https://geizhals.de/warenkorb", s), true);
  assert.equal(bereichPasst("https://geizhals.de./warenkorb", s), true);
  assert.equal(bereichPasst("https://www.geizhals.de/warenkorb", s), false);
  assert.equal(bereichPasst("https://boese.de/geizhals.de", s), false);
});

test("Bereich: Platzhalter nur vor einer registrierbaren Domain", () => {
  const s = { modus: "domains", bereich: ["*.geizhals.de", "example.com"] };
  assert.equal(bereichPasst("https://www.geizhals.de/x", s), true);
  assert.equal(bereichPasst("https://geizhals.de/x", s), true);
  assert.equal(bereichPasst("https://example.com/x", s), true);
  assert.equal(bereichPasst("https://boesegeizhals.de/x", s), false);
  assert.equal(bereichPasst("https://irgendwas.de/x", { modus: "domains", bereich: ["*.de"] }), false);
  assert.equal(bereichPasst("https://irgendwas.de/x", { modus: "domains", bereich: ["*"] }), false);
});

test("Säubern: Steuerzeichen raus, in der Mitte gekürzt", () => {
  assert.equal(saeubern("Hallo\0​ Welt\n\n"), "Hallo Welt");
  assert.equal(saeubern("Rechts‮slinks"), "Rechts slinks");
  const lang = saeubern("A".repeat(50) + "MITTE" + "B".repeat(50), 20);
  assert.equal(lang.length, 20);
  assert.ok(lang.includes("…"));
  assert.ok(lang.startsWith("A"));
  assert.ok(lang.endsWith("B"));
});

test("Knoten: unbekannte Zustände fallen weg, Elemente ohne Referenz auch", () => {
  const k = knotenPruefen({
    art: "element", ref: "e1", rolle: "button", name: "Kaufen",
    zustand: ["disabled", "ich_bin_erfunden", "visible"], tiefe: 9,
  });
  assert.deepEqual(k.zustand, ["disabled", "visible"]);
  assert.equal(k.tiefe, 3, "Tiefe wird gedeckelt, nicht übernommen");

  assert.equal(knotenPruefen({ art: "element", rolle: "button", name: "x" }), null);
  assert.equal(knotenPruefen({ art: "element", ref: "boese", rolle: "b", name: "x" }), null);
  assert.equal(knotenPruefen({ art: "erfunden", name: "x" }), null);
  assert.equal(knotenPruefen({ art: "text", name: "   " }), null);
  assert.equal(knotenPruefen(null), null);
});

test("Textbaum: Kopfzeile, Referenzen, abweichende Zustände", () => {
  const b = textbaumBauen(KNOTEN, { url: "https://geizhals.de/x", titel: "Warenkorb", epoche: "s1.abcd" });
  assert.equal(b.elementCount, 2);
  assert.ok(b.text.startsWith("### SEITE  https://geizhals.de/x"));
  assert.ok(b.text.includes("[s1.abcd · 2 Elemente]"));
  assert.ok(b.text.includes('e2  button "Zur Kasse" [deaktiviert]'));
  assert.ok(!b.text.includes("[sichtbar]"), "der Normalfall steht nicht im Text");
  assert.ok(b.text.includes('text "Zwischensumme'));
  assert.equal(b.truncated, false);
});

test("Textbaum: Deckel greifen und die Auslassung wird gezählt", () => {
  const viele = [];
  for (let i = 1; i <= 300; i++) {
    viele.push({ art: "element", ref: `e${i}`, rolle: "link", name: `Ziel ${i}`, zustand: [], tiefe: 0 });
  }
  for (let i = 0; i < 100; i++) {
    viele.push({ art: "text", rolle: "p", name: `Absatz ${i}`, tiefe: 0 });
  }
  const b = textbaumBauen(viele, { url: "https://geizhals.de/", titel: "x", epoche: "s2.abcd" });
  assert.equal(b.elementCount, GRENZEN.refs);
  assert.ok(b.text.includes("weitere Bedienelemente ausgelassen"));
  assert.ok(b.text.includes("Textzeilen ausgelassen"));
  assert.equal(b.truncated, "leicht");
  assert.ok(b.text.length <= GRENZEN.baumZeichen + 200);
});

test("Textbaum: harter Schnitt, wenn die Zeichen nicht reichen", () => {
  const riesig = [];
  for (let i = 1; i <= 120; i++) {
    riesig.push({
      art: "element", ref: `e${i}`, rolle: "link",
      name: "L".repeat(300), zustand: [], tiefe: 0,
    });
  }
  const b = textbaumBauen(riesig, { url: "https://geizhals.de/", titel: "x", epoche: "s3.abcd" });
  assert.ok(b.text.length <= GRENZEN.baumZeichen + 40);
  assert.ok(b.text.includes("abgeschnitten"));
  assert.equal(b.truncated, "schwer");
  assert.ok(!b.text.includes("L".repeat(200)), "Namen werden auf 120 Zeichen gekürzt");
});

test("Rahmendeckel: erst der Seitentext, dann die ganze Wahrnehmung", () => {
  const gross = {
    type: "result", id: "c-1", cmd: "readPage", success: true,
    data: { snapshot: { epoch: "s1", text: "X".repeat(5000), url: "u", title: "t" } },
    meta: { tookMs: 1 },
  };
  const g = rahmenDeckeln(JSON.parse(JSON.stringify(gross)), 1000);
  assert.equal(g.id, "c-1");
  assert.ok(JSON.stringify(g).length <= 1000);

  /* Passt selbst die Kennung nicht mehr, geht die Antwort trotzdem raus —
     nur ohne Wahrnehmung. */
  const winzig = rahmenDeckeln(JSON.parse(JSON.stringify(gross)), 60);
  assert.equal(winzig.type, "result");
  assert.equal(winzig.id, "c-1");
  assert.equal(winzig.success, false);
  assert.equal(winzig.error.code, "rahmen_zu_gross");
});

/* ------------------------------------------------------------------ *
 * 2. Die Schleife: jeder Weg endet mit einer Antwort
 * ------------------------------------------------------------------ */

test("Unbekannter Befehl: Absage mit Namen, ohne die Seite anzufassen", async () => {
  const { ergebnis, spur } = await laufen({ id: "c-1", cmd: "eval", reason: "Ich rechne kurz." });
  istErgebnisrahmen(ergebnis, "c-1", "eval");
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "not_supported");
  assert.ok(ergebnis.error.hint.includes("readPage"));
  assert.deepEqual(anDieSeite(spur), [], "eine Absage erreicht die Seite nie");
});

/*
 * Die Liste ist geschlossen — und drei Namen aus spec-01 §5.2 stehen ERSATZLOS
 * darauf: `newTab` und `closeTab` haben in einer Sitzung mit genau einem Tab
 * und genau einem Host kein Ziel, das je freigegeben wurde; `propose` ist
 * überflüssig, weil jeder einzelne Schritt ohnehin durch die Rückfrage geht.
 * Diese Prüfung ist die Stelle, an der das Streichen nachweisbar bleibt.
 */
test("Gestrichene und fremde Befehle bleiben draußen — auch die aus spec-01", async () => {
  for (const cmd of ["newTab", "closeTab", "propose",
                     "read_file", "list_dir", "write_file", "terminal", "maintenance", "eval"]) {
    const { ergebnis, spur } = await laufen({ id: `c-${cmd}`, cmd, reason: "Ich möchte das tun." });
    istErgebnisrahmen(ergebnis, `c-${cmd}`, cmd);
    assert.equal(ergebnis.success, false, `${cmd} darf nicht gelingen`);
    assert.equal(ergebnis.error.code, "not_supported", cmd);
    assert.deepEqual(anDieSeite(spur), [], `${cmd} erreicht die Seite nie`);
  }
});

test("Bedienen braucht die Bedienstufe: click/type/select scheitern auf read — ohne die Seite anzufassen", async () => {
  for (const cmd of ["click", "type", "select"]) {
    const { ergebnis, spur } = await laufen({
      id: `c-${cmd}`, cmd, ref: "e2", snapshotEpoch: "s1.abcd",
      text: "hallo", value: "XL", reason: "Ich möchte das tun.",
    });
    istErgebnisrahmen(ergebnis, `c-${cmd}`, cmd);
    assert.equal(ergebnis.success, false, `${cmd} darf auf read nicht gelingen`);
    assert.equal(ergebnis.error.code, "stufe_zu_niedrig", cmd);
    assert.deepEqual(anDieSeite(spur), [], `${cmd} erreicht die Seite nie`);
  }
});

test("type: der zu schreibende Text steht in der Freigabefrage — Passwortfelder bleiben tabu", async () => {
  const seite = (n) => {
    if (n.typ === "overlay:tippen") return { ok: true, rolle: "textbox", name: "Suche", laenge: 5 };
    return seiteStandard(n);
  };
  const { spur } = await laufen(
    { id: "c-t1", cmd: "type", ref: "e2", snapshotEpoch: "s1.abcd", text: "hallo", reason: "Ich fülle die Suche aus." },
    { sitzung: { ...SITZUNG, stufe: "write" }, seite }
  );
  const frage = spur.find((e) => e.wohin === "panel" && e.nachricht.typ === "link:schritt-freigabe");
  assert.ok(frage, "der Mensch wird gefragt");
  assert.ok(frage.nachricht.frage.includes("hallo"), "der Text steht in der Frage");

  /* Und das Geheimfeld: Die Seite lehnt ab, der Agent bekommt eine Aussage. */
  const geheim = (n) =>
    n.typ === "overlay:tippen" ? { ok: false, fehler: "feld_geheim" } : seiteStandard(n);
  const { ergebnis } = await laufen(
    { id: "c-t2", cmd: "type", ref: "e2", snapshotEpoch: "s1.abcd", text: "geheim123", reason: "Ich melde dich an." },
    { sitzung: { ...SITZUNG, stufe: "write" }, seite: geheim }
  );
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "user_declined");
  assert.ok(ergebnis.error.message.includes("Passwort"));
});

test("Ohne 'reason' wird nichts ausgeführt — der Satz wird vorgelesen", async () => {
  for (const reason of [undefined, "", "   ", 42, null]) {
    const { ergebnis, spur } = await laufen({ id: "c-2", cmd: "readPage", reason });
    istErgebnisrahmen(ergebnis, "c-2", "readPage");
    assert.equal(ergebnis.error.code, "reason_required");
    assert.deepEqual(anDieSeite(spur), []);
  }
});

test("Stufe: der Server darf einschränken, nie erweitern", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "c-3", cmd: "readPage", reason: "Ich lese die Seite." },
    { sitzung: { ...SITZUNG, stufe: "" } }
  );
  assert.equal(ergebnis.error.code, "stufe_zu_niedrig");
  assert.deepEqual(anDieSeite(spur), []);
});

test("Bereich: steht der Tab woanders, wird nicht gelesen", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "c-4", cmd: "readPage", reason: "Ich lese die Seite." },
    { tab: { id: 7, url: "https://boese.de/falle", title: "Falle" } }
  );
  assert.equal(ergebnis.error.code, "scope_violation_local");
  assert.deepEqual(anDieSeite(spur), [], "die fremde Seite wird nicht einmal angesprochen");
  assert.ok(!anDasPanel(spur).includes("link:schritt-freigabe"), "und der Mensch wird nicht gefragt");
});

test("Bereich: auch ein anderes Schema ist außerhalb", async () => {
  const { ergebnis } = await laufen(
    { id: "c-5", cmd: "readPage", reason: "Ich lese die Seite." },
    { tab: { id: 7, url: "chrome://settings", title: "Einstellungen" } }
  );
  assert.equal(ergebnis.error.code, "scope_violation_local");
});

test("Kein Tab mehr: Absage statt Stille", async () => {
  const { ergebnis } = await laufen(
    { id: "c-6", cmd: "readPage", reason: "Ich lese die Seite." },
    { tab: null }
  );
  istErgebnisrahmen(ergebnis, "c-6", "readPage");
  assert.equal(ergebnis.error.code, "tab_gone");
});

test("Ablehnung ist eine gültige Antwort und kein Fehler dieser Erweiterung", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "c-7", cmd: "readPage", reason: "Ich lese die Seite." },
    { panel: panelSagtNein }
  );
  istErgebnisrahmen(ergebnis, "c-7", "readPage");
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "user_declined");
  assert.equal(ergebnis.error.retryable, false);
  assert.ok(ergebnis.error.hint.includes("kein Fehler"));
  assert.ok(!anDieSeite(spur).includes("overlay:baum"), "nach einem Nein wird nicht gelesen");
});

test("Keine Seitenleiste offen: keine Freigabe, keine Ausführung, aber eine Antwort", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "c-8", cmd: "readPage", reason: "Ich lese die Seite." },
    { panel: null }
  );
  assert.equal(ergebnis.error.code, "grant_required");
  assert.ok(!anDieSeite(spur).includes("overlay:baum"));
});

test("Seitenleiste besetzt ist kein Nein des Menschen", async () => {
  const { ergebnis } = await laufen(
    { id: "c-9", cmd: "readPage", reason: "Ich lese die Seite." },
    { panel: panelIstBesetzt }
  );
  assert.equal(ergebnis.error.code, "grant_required");
  assert.notEqual(ergebnis.error.code, "user_declined");
  assert.ok(ergebnis.error.message.includes("andere Frage"));
});

test("Die Freigabefrage enthält den Satz des Agenten — Seitentext nur daneben", async () => {
  const { spur } = await laufen({
    id: "c-10", cmd: "highlight", ref: "e2", snapshotEpoch: "s1.abcd",
    reason: "Ich zeige dir den Knopf zur Kasse.",
  });
  const frage = spur.find((e) => e.wohin === "panel" && e.nachricht.typ === "link:schritt-freigabe");
  assert.ok(frage, "es wird gefragt");
  assert.ok(frage.nachricht.frage.includes("Ich zeige dir den Knopf zur Kasse."));
  assert.ok(
    !frage.nachricht.frage.includes("Zur Kasse"),
    "der Name des Elements steht NICHT in der Frage"
  );
  assert.equal(frage.nachricht.quelle, "Zur Kasse", "sondern abgesetzt in 'quelle'");
});

/* ------------------------------------------------------------------ *
 * 3. Die vier lesenden Befehle
 * ------------------------------------------------------------------ */

test("Auch im Automatikmodus wird gefragt — in dieser Fassung ausnahmslos", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "c-10b", cmd: "readPage", reason: "Ich lese die Seite." },
    { sitzung: { ...SITZUNG, schrittmodus: "auto" }, panel: panelSagtNein }
  );
  assert.ok(anDasPanel(spur).includes("link:schritt-freigabe"));
  assert.equal(ergebnis.error.code, "user_declined");
});

test("readPage liefert den Textbaum", async () => {
  const { ergebnis, spur } = await laufen({
    id: "c-11", cmd: "readPage", reason: "Ich sehe mir die Seite an.",
  });
  istErgebnisrahmen(ergebnis, "c-11", "readPage");
  assert.equal(ergebnis.success, true);
  const s = ergebnis.data.snapshot;
  assert.equal(s.epoch, "s1.abcd");
  assert.equal(s.url, TAB.url, "die Adresse kommt vom Browser, nicht aus der Seite");
  assert.equal(s.title, "Warenkorb");
  assert.equal(s.elementCount, 2);
  assert.ok(s.text.includes('e2  button "Zur Kasse"'));
  assert.ok(anDieSeite(spur).includes("overlay:baum"));
  assert.ok(anDieSeite(spur).includes("overlay:ping"), "der Rahmen wird vorher sichergestellt");
});

/* Die vollständigen Parametersätze aller Befehle. Sie stehen an einer Stelle,
   damit jede Prüfung, die „einmal alles" braucht, dieselben nimmt. */
const VOLLSTAENDIG = {
  highlight: { ref: "e2", snapshotEpoch: "s1.abcd" },
  click: { ref: "e2", snapshotEpoch: "s1.abcd" },
  type: { ref: "e2", snapshotEpoch: "s1.abcd", text: "hallo" },
  select: { ref: "e2", snapshotEpoch: "s1.abcd", value: "XL" },
  scroll: { direction: "down", amount: "page" },
  extract: { refs: ["e2"], snapshotEpoch: "s1.abcd" },
  waitFor: { textPresent: "Warenkorb", waitSeconds: 2 },
  screenshot: { screenshotReason: "canvas" },
  navigate: { url: "https://geizhals.de/kasse" },
  back: {},
};

const seiteBedient = (n) => {
  if (n.typ === "overlay:klicken") return { ok: true, rolle: "button", name: "Zur Kasse" };
  if (n.typ === "overlay:tippen") return { ok: true, rolle: "textbox", name: "Suche", laenge: 5, abgesendet: false };
  return seiteStandard(n);
};

test("Zu jedem Befehl der Tabelle gibt es auch eine Ausführung", async () => {
  const zusatz = VOLLSTAENDIG;
  const seite = seiteBedient;
  for (const cmd of Object.keys(BEFEHLE)) {
    const sitzung = BEFEHLE[cmd].stufe === "write" ? { ...SITZUNG, stufe: "write" } : SITZUNG;
    const { ergebnis } = await laufen({
      id: `t-${cmd}`, cmd, reason: "Ich mache das jetzt.", ...(zusatz[cmd] || {}),
    }, { sitzung, seite });
    istErgebnisrahmen(ergebnis, `t-${cmd}`, cmd);
    assert.equal(ergebnis.success, true, `${cmd} hat keine Ausführung`);
  }
});

test("snapshot ist derselbe Weg unter dem Namen des Relays", async () => {
  const { ergebnis } = await laufen({ id: "c-12", cmd: "snapshot", reason: "Ich lese." });
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.cmd, "snapshot");
  assert.ok(ergebnis.data.snapshot.text.length > 0);
});

test("get_state meldet den Zustand, nicht den Inhalt", async () => {
  const { ergebnis } = await laufen({ id: "c-13", cmd: "get_state", reason: "Ich sehe nach, wo wir stehen." });
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.data.state.readyState, "complete");
  assert.equal(ergebnis.data.state.atTop, true);
  assert.equal(ergebnis.data.state.access, "read");
  assert.deepEqual(ergebnis.data.state.allow, ["geizhals.de"]);
  assert.equal(ergebnis.data.snapshot, undefined, "get_state liefert keinen Seitentext");
});

test("scroll scrollt und liefert die neue Wahrnehmung gleich mit", async () => {
  const { ergebnis, spur } = await laufen({
    id: "c-14", cmd: "scroll", direction: "down", amount: "page",
    reason: "Ich blättere eine Seite weiter.",
  });
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.data.scrolledBy, 810);
  assert.equal(ergebnis.data.atBottom, false);
  assert.ok(ergebnis.data.snapshot.text.length > 0, "nach dem Bildlauf eine neue Wahrnehmung");
  const gesendet = anDieSeite(spur);
  assert.ok(gesendet.indexOf("overlay:scrollen") < gesendet.indexOf("overlay:baum"));
});

test("highlight setzt den Agentenzeiger auf das Element", async () => {
  const { ergebnis, spur } = await laufen({
    id: "c-15", cmd: "highlight", ref: "e2", snapshotEpoch: "s1.abcd",
    reason: "Ich zeige dir, wo es weitergeht.",
  });
  assert.equal(ergebnis.success, true);
  assert.deepEqual(ergebnis.data.shown, { ref: "e2", role: "button", name: "Zur Kasse" });
  const zeiger = spur.find((e) => e.wohin === "seite" && e.nachricht.typ === "overlay:zeiger");
  assert.ok(zeiger, "der Zeiger wird gesetzt");
  assert.deepEqual(zeiger.nachricht.rect, { left: 10, top: 20, width: 100, height: 40 });
});

test("highlight mit alter Epoche zeigt nichts und fragt gar nicht erst", async () => {
  const seite = (n) =>
    n.typ === "overlay:nachschlagen" ? { ok: false, fehler: "stale_ref" } : seiteStandard(n);
  const { ergebnis, spur } = await laufen(
    { id: "c-16", cmd: "highlight", ref: "e2", snapshotEpoch: "s0.alt", reason: "Ich zeige dir etwas." },
    { seite }
  );
  assert.equal(ergebnis.error.code, "stale_ref");
  assert.equal(ergebnis.error.retryable, true);
  assert.ok(!anDasPanel(spur).includes("link:schritt-freigabe"),
    "der Mensch wird nicht gefragt, wenn gar nicht feststeht, worauf gezeigt würde");
  assert.ok(!anDieSeite(spur).includes("overlay:zeiger"));
});

test("Antwortet das Seitenskript nicht, gibt es trotzdem eine Aussage", async () => {
  const seite = (n) => (n.typ === "overlay:baum" ? { ok: false, fehler: "leer" } : seiteStandard(n));
  const { ergebnis } = await laufen(
    { id: "c-17", cmd: "readPage", reason: "Ich lese." },
    { seite }
  );
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "snapshot_unavailable");
  assert.equal(ergebnis.error.retryable, true);
});

/* ------------------------------------------------------------------ *
 * 3b. Die Parameter — der Befund F1 und alles, was daran hängt
 *
 * Der Kern in einem Satz: Ein fehlender Parameter, der bestimmt, WAS
 * geschieht, darf nie stillschweigend zur Voreinstellung werden. Die erste
 * Prüfung hier ist ohne den Fix rot — sie ist genau der Fall, der monatelang
 * „Erfolg" gemeldet hat, während die Seite in die falsche Richtung lief.
 * ------------------------------------------------------------------ */

test("F1: scroll ohne Richtung scrollt nicht heimlich nach unten", async () => {
  const { ergebnis, spur } = await laufen({
    id: "p-1", cmd: "scroll", amount: "page", reason: "Ich blättere weiter.",
  });
  istErgebnisrahmen(ergebnis, "p-1", "scroll");
  assert.equal(ergebnis.success, false, "ohne Richtung darf kein Erfolg gemeldet werden");
  assert.equal(ergebnis.error.code, "param_ungueltig");
  assert.ok(ergebnis.error.hint.includes("down"), "der Hinweis nennt die möglichen Richtungen");
  assert.ok(!anDieSeite(spur).includes("overlay:scrollen"), "und es wird nirgendwohin gescrollt");
  assert.ok(!anDasPanel(spur).includes("link:schritt-freigabe"),
    "der Mensch wird nicht um Erlaubnis für einen Schritt gebeten, den es gar nicht gibt");
});

test("F1: die Richtung kommt so an der Seite an, wie sie gesendet wurde", async () => {
  for (const richtung of ["down", "up", "top", "bottom"]) {
    const { ergebnis, spur } = await laufen({
      id: `p-2-${richtung}`, cmd: "scroll", direction: richtung, reason: "Ich blättere.",
    });
    assert.equal(ergebnis.success, true, richtung);
    assert.equal(nachricht(spur, "overlay:scrollen").richtung, richtung, richtung);
  }
});

test("F1: unbekannte oder widersprüchliche Schrittweiten werden benannt abgelehnt", async () => {
  /* `-800` ist der heikelste Fall: Das Seitenskript nimmt den Betrag und
     scrollte damit 800 Pixel nach UNTEN, obwohl das Vorzeichen das Gegenteil
     sagt. Eine zweite, widersprüchliche Richtungsangabe wird abgelehnt. */
  for (const amount of ["riesig", -800, 0, 99999, "800", true]) {
    const { ergebnis, spur } = await laufen({
      id: "p-3", cmd: "scroll", direction: "down", amount, reason: "Ich blättere.",
    });
    assert.equal(ergebnis.success, false, `amount ${JSON.stringify(amount)} darf nicht durchgehen`);
    assert.equal(ergebnis.error.code, "param_ungueltig", JSON.stringify(amount));
    assert.ok(!anDieSeite(spur).includes("overlay:scrollen"), JSON.stringify(amount));
  }
});

test("F1: zu einem Element scrollen braucht keine Richtung — sie steht im Ort", async () => {
  const { ergebnis, spur } = await laufen({
    id: "p-4", cmd: "scroll", ref: "e2", snapshotEpoch: "s1.abcd",
    reason: "Ich hole den Knopf ins Bild.",
  });
  assert.equal(ergebnis.success, true);
  const n = nachricht(spur, "overlay:scrollen");
  assert.equal(n.ref, "e2");
  assert.equal(n.richtung, null, "keine erfundene Richtung im Rahmen an die Seite");
});

test("F1: ein Bildlaufbereich, den es nicht gibt, wird nicht zum Fensterscrollen", async () => {
  const { ergebnis, spur } = await laufen({
    id: "p-5", cmd: "scroll", direction: "down", container: "e9", reason: "Ich scrolle die Liste.",
  });
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "not_supported");
  assert.ok(ergebnis.error.hint.includes("ref"), "der Hinweis nennt den Weg, der funktioniert");
  assert.ok(!anDieSeite(spur).includes("overlay:scrollen"));
});

test("Parameter werden geprüft, BEVOR der Mensch gefragt wird", async () => {
  /* Sonst bestätigt der Inhaber einen Schritt, den die Erweiterung
     anschließend selbst ablehnt — und lernt, dass seine Zustimmung nichts
     bedeutet. Ein Querschnitt durch alle Befehle mit fehlender Pflichtangabe. */
  const faelle = [
    { cmd: "waitFor", code: "param_ungueltig" },
    { cmd: "extract", code: "param_ungueltig" },
    { cmd: "screenshot", code: "screenshot_not_justified" },
    { cmd: "navigate", code: "param_ungueltig" },
    { cmd: "select", code: "param_ungueltig", ref: "e2", stufe: "write" },
    { cmd: "click", code: "param_ungueltig", stufe: "write" },
    { cmd: "type", code: "param_ungueltig", ref: "e2", stufe: "write" },
  ];
  for (const fall of faelle) {
    const sitzung = fall.stufe ? { ...SITZUNG, stufe: fall.stufe } : SITZUNG;
    const { ergebnis, spur } = await laufen(
      { id: `p-6-${fall.cmd}`, cmd: fall.cmd, ref: fall.ref, reason: "Ich mache das jetzt." },
      { sitzung }
    );
    assert.equal(ergebnis.success, false, fall.cmd);
    assert.equal(ergebnis.error.code, fall.code, fall.cmd);
    assert.ok(ergebnis.error.message.length > 0, fall.cmd);
    assert.ok(!anDasPanel(spur).includes("link:schritt-freigabe"), `${fall.cmd} fragt vor der Prüfung`);
    assert.deepEqual(anDenBrowser(spur).filter((w) => w !== "tabs.get"), [], fall.cmd);
  }
});

test("Parameterprüfung ohne Browser: die Absagen sind benannt und einzeln", () => {
  const s = { modus: "tab", bereich: ["geizhals.de"] };
  const nein = (cmd, rahmen) => parameterPruefen(cmd, rahmen, { sitzung: s, fristMs: 20000 });

  assert.equal(nein("scroll", {}).code, "param_ungueltig");
  assert.equal(nein("waitFor", { textPresent: "a", idle: true }).ok, false, "zwei Bedingungen sind keine");
  assert.equal(nein("waitFor", { idle: false }).ok, false, "idle:false ist keine Bedingung");
  assert.equal(nein("waitFor", { refGone: "kein_ref" }).ok, false);
  assert.equal(nein("extract", { refs: ["e1"], region: "e2" }).ok, false, "refs und region zugleich");
  assert.equal(nein("extract", { refs: ["e1", "boese"] }).ok, false, "kein Eintrag wird still verworfen");
  assert.equal(nein("select", { ref: "e2", value: "a", index: 3 }).ok, false, "zwei Wege sind keine Wahl");
  assert.equal(nein("type", { ref: "e2", text: "x", clear: "ja" }).ok, false, "clear ist ein Ja/Nein-Feld");
  assert.equal(nein("type", { ref: "e2", text: "x", submit: 1 }).ok, false, "submit auch");
  assert.equal(nein("screenshot", { screenshotReason: "weil" }).code, "screenshot_not_justified");
  assert.equal(nein("readPage", { region: "e2" }).code, "not_supported");

  /* Und die Gegenprobe: Was richtig gebaut ist, kommt als Plan durch. */
  const gut = parameterPruefen("waitFor", { urlMatches: "*/kasse", waitSeconds: 5 }, { sitzung: s, fristMs: 20000 });
  assert.equal(gut.ok, true);
  assert.equal(gut.plan.bedingung, "urlMatches");
  assert.equal(gut.plan.wartenMs, 5000);
  const gedeckelt = parameterPruefen("waitFor", { idle: true, waitSeconds: 600 }, { sitzung: s, fristMs: 20000 });
  assert.equal(gedeckelt.plan.wartenMs, 20000, "länger als die eigene Frist wird nicht gewartet");
  assert.equal(gedeckelt.plan.gedeckelt, true, "und der Agent erfährt, dass gedeckelt wurde");

  assert.equal(refPruefen("e12"), "e12");
  assert.equal(refPruefen("e"), null);
  assert.equal(refPruefen("<script>"), null);
});

/* ------------------------------------------------------------------ *
 * 3c. Der Befund F2: der Mensch bestätigt, was er auch gesehen hat
 * ------------------------------------------------------------------ */

test("F2: der ganze Text steht in der Frage, solange er vorlesbar ist", async () => {
  const text = "B".repeat(200);
  const { spur } = await laufen(
    { id: "q-1", cmd: "type", ref: "e2", snapshotEpoch: "s1.abcd", text, reason: "Ich fülle das Feld." },
    { sitzung: { ...SITZUNG, stufe: "write" }, seite: seiteBedient }
  );
  const frage = freigabefrage(spur);
  assert.ok(frage.frage.includes(text), "200 Zeichen wurden früher bei 120 abgeschnitten");
  assert.ok(!frage.frage.includes("weitere"), "und es wird nichts angedeutet, was da ist");
});

test("F2: was nicht mehr in die Frage passt, wird gezählt statt verschwiegen", async () => {
  const text = "C".repeat(GRENZEN.tippFrageZeichen + 200);
  const { spur } = await laufen(
    { id: "q-2", cmd: "type", ref: "e2", snapshotEpoch: "s1.abcd", text, reason: "Ich schreibe den Text." },
    { sitzung: { ...SITZUNG, stufe: "write" }, seite: seiteBedient }
  );
  const frage = freigabefrage(spur).frage;
  assert.ok(frage.includes("C".repeat(GRENZEN.tippFrageZeichen)), "der Anfang steht vollständig da");
  assert.ok(frage.includes("und weitere 200 Zeichen"), "und der Rest wird beziffert");
  /* Vorgelesen wird die Frage — sie darf nicht zur Vorlesung werden. */
  assert.ok(frage.length < 900, "die Frage bleibt hörbar kurz");
});

test("F2: Vorschau kürzt vorn, nicht in der Mitte — und zählt genau", () => {
  const v = tippVorschau("D".repeat(500), 400);
  assert.equal(v.gezeigt.length, 400);
  assert.equal(v.rest, 100);
  assert.equal(tippVorschau("kurz", 400).rest, 0);
  /* Steuerzeichen kommen auch hier nicht durch: Die Frage wird vorgelesen. */
  assert.equal(tippVorschau("a\0b\nc", 400).gezeigt, "a b c");
});

test("Absenden und Anhängen stehen in der Frage — und gehen so an die Seite", async () => {
  const { ergebnis, spur } = await laufen(
    {
      id: "q-3", cmd: "type", ref: "e2", snapshotEpoch: "s1.abcd",
      text: "Kaffeemühle", clear: false, submit: true, reason: "Ich suche danach.",
    },
    {
      sitzung: { ...SITZUNG, stufe: "write" },
      seite: (n) =>
        n.typ === "overlay:tippen"
          ? { ok: true, rolle: "textbox", name: "Suche", laenge: 11, abgesendet: true }
          : seiteStandard(n),
    }
  );
  const frage = freigabefrage(spur).frage;
  assert.ok(frage.includes("anhängen"), "der Mensch erfährt, dass nichts gelöscht wird");
  assert.ok(frage.includes("absenden"), "und dass die Eingabe abgeschickt wird");
  const n = nachricht(spur, "overlay:tippen");
  assert.equal(n.leeren, false);
  assert.equal(n.absenden, true);
  /* `length` und `submitted` stehen neben `typed` — genau dort, wo das
     Werkzeug auf der Agentenseite sie liest (browser_tool.py). */
  assert.equal(ergebnis.data.submitted, true);
  assert.equal(ergebnis.data.length, 11);
  assert.equal(ergebnis.data.typed.text, undefined, "der Text selbst kommt nie zurück");
  assert.equal(JSON.stringify(ergebnis).includes("Kaffeemühle"), false,
    "das Eingetippte kommt nirgends im Rahmen zurück");
});

/* ------------------------------------------------------------------ *
 * 3d. Die sechs neuen Befehle
 * ------------------------------------------------------------------ */

test("Jeder Befehl geht durch die Rückfrage — und ein Nein hält ihn wirklich auf", async () => {
  const handelnd = [
    "overlay:scrollen", "overlay:klicken", "overlay:tippen", "overlay:auswaehlen",
    "overlay:warten", "overlay:auslesen", "overlay:baum", "overlay:zeiger",
  ];
  for (const cmd of Object.keys(BEFEHLE)) {
    const sitzung = BEFEHLE[cmd].stufe === "write" ? { ...SITZUNG, stufe: "write" } : SITZUNG;
    const { ergebnis, spur } = await laufen(
      { id: `r-${cmd}`, cmd, reason: "Ich mache das jetzt.", ...(VOLLSTAENDIG[cmd] || {}) },
      { sitzung, seite: seiteBedient, panel: panelSagtNein }
    );
    assert.ok(freigabefrage(spur), `${cmd} fragt den Menschen nicht`);
    assert.equal(ergebnis.error.code, "user_declined", cmd);
    for (const tot of handelnd) {
      assert.ok(!anDieSeite(spur).includes(tot), `${cmd}: ${tot} trotz Ablehnung`);
    }
    assert.deepEqual(anDenBrowser(spur).filter((w) => w !== "tabs.get"), [],
      `${cmd} fasst den Browser trotz Ablehnung an`);
  }
});

test("navigate ruft die Adresse auf und liefert die neue Wahrnehmung", async () => {
  const { ergebnis, spur } = await laufen({
    id: "n-1", cmd: "navigate", url: "https://geizhals.de/kasse",
    reason: "Ich gehe zur Kasse.",
  });
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.data.url, "https://geizhals.de/kasse");
  assert.equal(ergebnis.data.redirected, false);
  assert.ok(ergebnis.data.snapshot.text.length > 0, "nach dem Wechsel wird neu wahrgenommen");
  const gesendet = anDieSeite(spur);
  assert.ok(gesendet.includes("overlay:ping"), "der grüne Rahmen wird nach dem Wechsel neu sichergestellt");
  assert.ok(gesendet.lastIndexOf("overlay:ping") < gesendet.lastIndexOf("overlay:baum"),
    "erst der Rahmen, dann das Lesen");
  const frage = freigabefrage(spur).frage;
  assert.ok(frage.includes("geizhals.de/kasse"), "der Mensch sieht, wohin es geht");
});

/* ------------------------------------------------------------------ *
 * 3e. Sichtbarkeit — der Mensch muss die Bedienung im Fenster sehen
 *
 * Der Befund vom 06.08.2026: Bis 0.4.1 fuhr die Maus nur beim reinen Zeigen,
 * und der grüne Rahmen erlosch nach jeder Navigation für immer. Beides ist die
 * Ursache der Meldung „nichts passiert sichtbar". Diese Prüfsätze werden gegen
 * den alten Stand rot (halbe Mutation): Wer die Zeigerzeile oder die
 * Rahmen-Wiederherstellung entfernt, färbt sie.
 * ------------------------------------------------------------------ */

test("Sichtbarkeit: klicken fährt zuerst den Zeiger ans Ziel, dann klickt es", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "sz-1", cmd: "click", reason: "Ich klicke auf Zur Kasse.", ...VOLLSTAENDIG.click },
    { sitzung: { ...SITZUNG, stufe: "write" }, seite: seiteBedient }
  );
  assert.equal(ergebnis.success, true);
  const gesendet = anDieSeite(spur);
  assert.ok(gesendet.includes("overlay:zeiger"), "der Agentenzeiger wird sichtbar gesetzt");
  assert.ok(gesendet.includes("overlay:klicken"), "und dann wird geklickt");
  assert.ok(
    gesendet.indexOf("overlay:zeiger") < gesendet.lastIndexOf("overlay:klicken"),
    "erst der sichtbare Zeiger, dann der Klick"
  );
});

test("Invariante: JEDER Befehl trägt freigabe 'immer' — es gibt keinen fragefreien Pfad", () => {
  /* brauchtFreigabe = eintrag.freigabe === "immer" || schrittmodus !== "auto".
     Solange ALLE Befehle "immer" tragen, ist der auto-Zweig tot und jeder
     Schritt geht durch die Rückfrage — das ist die zentrale Sicherheitszusage
     (TESTPROMPT Punkt 1). Ein künftiger Eintrag mit "schritt" oder "nie" würde
     im Automatikmodus stumm durchlaufen; dieser Prüfsatz fängt ihn hier ab. */
  for (const cmd of Object.keys(BEFEHLE)) {
    assert.equal(BEFEHLE[cmd].freigabe, "immer",
      `${cmd} muss freigabe:"immer" tragen, sonst entsteht ein fragefreier Pfad`);
  }
});

test("Sichtbarkeit: auch tippen und auswählen zeigen zuerst den Zeiger", async () => {
  for (const cmd of ["type", "select"]) {
    const { ergebnis, spur } = await laufen(
      { id: `sz-${cmd}`, cmd, reason: "Ich mache das jetzt.", ...VOLLSTAENDIG[cmd] },
      { sitzung: { ...SITZUNG, stufe: "write" }, seite: seiteBedient }
    );
    assert.equal(ergebnis.success, true, cmd);
    assert.ok(anDieSeite(spur).includes("overlay:zeiger"), `${cmd} fährt den Zeiger ans Ziel`);
  }
});

test("Sichtbarkeit: nach einer Neu-Einspielung wird der grüne Rahmen wieder angeschaltet", async () => {
  /* Erstes overlay:ping schlägt fehl (Seite frisch, Skript noch nicht da),
     danach ist es da — genau die Lage nach einer Navigation. */
  let pings = 0;
  const seiteFrisch = (n) => {
    if (n.typ === "overlay:ping") {
      pings += 1;
      return pings === 1 ? { ok: false } : { ok: true };
    }
    return seiteBedient(n);
  };
  const { ergebnis, spur } = await laufen(
    { id: "sr-1", cmd: "readPage", reason: "Ich lese die Seite." },
    { seite: seiteFrisch }
  );
  assert.equal(ergebnis.success, true);
  const gesendet = anDieSeite(spur);
  assert.ok(gesendet.includes("overlay:an"),
    "der grüne Rahmen wird nach der Neu-Einspielung wieder angeschaltet");
  assert.ok(spur.some((e) => e.wohin === "executeScript"),
    "das Overlay wurde wirklich neu eingespielt");
});

test("Sichtbarkeit: war der Rahmen schon da, wird er NICHT doppelt angeschaltet", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "sr-2", cmd: "readPage", reason: "Ich lese die Seite." },
    { seite: seiteBedient }
  );
  assert.equal(ergebnis.success, true);
  assert.ok(!anDieSeite(spur).includes("overlay:an"),
    "ohne Neu-Einspielung bleibt der laufende Rahmen unberührt");
});

test("navigate außerhalb des Bereichs wird abgelehnt, BEVOR jemand zustimmt", async () => {
  const { ergebnis, spur } = await laufen({
    id: "n-2", cmd: "navigate", url: "https://boese.de/falle", reason: "Ich sehe dort nach.",
  });
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "scope_violation_local");
  assert.ok(ergebnis.error.message.includes("boese.de"));
  assert.ok(ergebnis.error.hint.includes("geizhals.de"), "die Absage sagt, was stattdessen ginge");
  assert.ok(!anDasPanel(spur).includes("link:schritt-freigabe"),
    "sonst bestätigt der Mensch eine Adresse, die danach abgelehnt wird");
  assert.ok(!anDenBrowser(spur).includes("tabs.update"));
});

test("navigate nimmt keine Adresse, die gar keine Webadresse ist", async () => {
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "chrome://settings", "geizhals.de", "", 42]) {
    const { ergebnis, spur } = await laufen({
      id: "n-3", cmd: "navigate", url, reason: "Ich rufe das auf.",
    });
    assert.equal(ergebnis.success, false, String(url));
    assert.ok(!anDenBrowser(spur).includes("tabs.update"), String(url));
  }
});

test("navigate: eine Weiterleitung aus dem Bereich heraus wird nach dem Wechsel gefasst", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "n-4", cmd: "navigate", url: "https://geizhals.de/kasse", reason: "Ich gehe zur Kasse." },
    { umleitungNach: "https://tracker.example/weiter" }
  );
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "scope_violation_local");
  assert.ok(!anDieSeite(spur).includes("overlay:baum"), "die fremde Seite wird nicht gelesen");
});

test("navigate: sagt der Browser nein, ist das eine Aussage", async () => {
  const { ergebnis } = await laufen(
    { id: "n-5", cmd: "navigate", url: "https://geizhals.de/kasse", reason: "Ich gehe zur Kasse." },
    { browserSagtNein: new Set(["update"]) }
  );
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "navigation_failed");
  assert.equal(ergebnis.error.retryable, true);
});

test("back geht zurück und nimmt die Seite danach neu wahr", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "b-1", cmd: "back", reason: "Ich gehe zur Liste zurück." },
    { verlauf: ["https://geizhals.de/liste"] }
  );
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.data.url, "https://geizhals.de/liste");
  assert.ok(ergebnis.data.snapshot.text.length > 0);
  assert.ok(anDenBrowser(spur).includes("tabs.goBack"));
});

test("back ohne Vorgeschichte ist eine Aussage, kein Fehler der Erweiterung", async () => {
  const { ergebnis } = await laufen(
    { id: "b-2", cmd: "back", reason: "Ich gehe zurück." },
    { browserSagtNein: new Set(["goBack"]) }
  );
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "no_history");
  assert.ok(ergebnis.error.message.includes("keine Seite zurück"));
  assert.ok(ergebnis.error.hint.includes("kein Fehler"));
});

test("back auf eine Seite außerhalb des Bereichs liest nichts", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "b-3", cmd: "back", reason: "Ich gehe zurück." },
    { umleitungNach: "https://boese.de/vorher" }
  );
  assert.equal(ergebnis.error.code, "scope_violation_local");
  assert.ok(!anDieSeite(spur).includes("overlay:baum"));
});

test("extract liest gezielt und säubert, was von der Seite kommt", async () => {
  const seite = (n) =>
    n.typ === "overlay:auslesen"
      ? {
          ok: true,
          treffer: [
            { ref: "e2", rolle: "button", name: "Zur\0Kasse", wert: "428,90 Euro" },
            { ref: "e3", rolle: "text", name: "Preis", wert: "X".repeat(500) },
          ],
        }
      : seiteStandard(n);
  const { ergebnis, spur } = await laufen(
    { id: "x-1", cmd: "extract", refs: ["e2", "e3"], fields: ["preis"], snapshotEpoch: "s1.abcd", reason: "Ich lese die Preise ab." },
    { seite }
  );
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.data.rowCount, 2);
  assert.equal(ergebnis.data.rows[0].name, "Zur Kasse", "Steuerzeichen kommen nicht durch");
  assert.ok(ergebnis.data.rows[1].value.length <= GRENZEN.wertZeichen, "Werte werden gedeckelt");
  const n = nachricht(spur, "overlay:auslesen");
  assert.deepEqual(n.refs, ["e2", "e3"]);
  assert.deepEqual(n.felder, ["preis"]);
  assert.equal(n.epoche, "s1.abcd");
});

test("extract: mehr Referenzen als der Deckel — gekürzt und benannt", async () => {
  const viele = [];
  for (let i = 1; i <= GRENZEN.extraktRefs + 10; i++) viele.push(`e${i}`);
  const { ergebnis, spur } = await laufen({
    id: "x-2", cmd: "extract", refs: viele, snapshotEpoch: "s1.abcd", reason: "Ich lese die Liste ab.",
  });
  assert.equal(ergebnis.success, true);
  assert.equal(nachricht(spur, "overlay:auslesen").refs.length, GRENZEN.extraktRefs);
  assert.equal(ergebnis.data.truncated, true);
  assert.equal(ergebnis.data.omitted, 10, "der Agent erfährt, wie viel fehlt");
});

test("extract: eine leere Ernte ist eine Aussage über die Seite", async () => {
  const seite = (n) => (n.typ === "overlay:auslesen" ? { ok: true, treffer: [] } : seiteStandard(n));
  const { ergebnis } = await laufen(
    { id: "x-3", cmd: "extract", region: "e2", snapshotEpoch: "s1.abcd", reason: "Ich lese den Kasten ab." },
    { seite }
  );
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "nothing_extracted");
  assert.equal(ergebnis.error.retryable, true);
});

test("extract: eine Absage der Seite wird durchgereicht, nicht verschluckt", async () => {
  const seite = (n) =>
    n.typ === "overlay:auslesen" ? { ok: false, fehler: "stale_ref" } : seiteStandard(n);
  const { ergebnis } = await laufen(
    { id: "x-4", cmd: "extract", refs: ["e2"], snapshotEpoch: "s0.alt", reason: "Ich lese ab." },
    { seite }
  );
  assert.equal(ergebnis.error.code, "stale_ref");
  assert.ok(ergebnis.error.hint.includes("readPage"));
});

test("waitFor wartet auf genau eine Bedingung und meldet, worauf", async () => {
  const { ergebnis, spur } = await laufen({
    id: "w-1", cmd: "waitFor", textPresent: "Vielen Dank", waitSeconds: 3,
    reason: "Ich warte auf die Bestätigung.",
  });
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.data.satisfied, true);
  assert.equal(ergebnis.data.condition, "textPresent");
  assert.equal(ergebnis.data.waitedMs, 120);
  assert.ok(ergebnis.data.snapshot.text.length > 0);
  const n = nachricht(spur, "overlay:warten");
  assert.equal(n.bedingung, "textPresent");
  assert.equal(n.wert, "Vielen Dank");
  assert.ok(n.fristMs <= 3000, "die Wartezeit wird auf die eigene Frist gedeckelt");
  assert.ok(freigabefrage(spur).frage.includes("Vielen Dank"), "der Mensch sieht, worauf gewartet wird");
});

test("waitFor: nicht eingetreten heißt wait_timeout MIT Wahrnehmung", async () => {
  const seite = (n) =>
    n.typ === "overlay:warten" ? { ok: true, erfuellt: false, wartezeitMs: 3000 } : seiteStandard(n);
  const { ergebnis } = await laufen(
    { id: "w-2", cmd: "waitFor", refVisible: "e2", waitSeconds: 3, reason: "Ich warte auf den Knopf." },
    { seite }
  );
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "wait_timeout");
  assert.equal(ergebnis.error.retryable, true);
  assert.ok(ergebnis.data.snapshot.text.length > 0, "der Agent sieht, worauf er vergeblich gewartet hat");
  assert.equal(ergebnis.data.satisfied, false);
});

test("waitFor: eine Absage der Seite wird durchgereicht, nicht als Erfolg gedeutet", async () => {
  const seite = (n) =>
    n.typ === "overlay:warten" ? { ok: false, fehler: "stale_ref" } : seiteStandard(n);
  const { ergebnis } = await laufen(
    { id: "w-4", cmd: "waitFor", refGone: "e2", waitSeconds: 2, reason: "Ich warte, bis der Kasten weg ist." },
    { seite }
  );
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "stale_ref");
  assert.ok(ergebnis.error.hint.includes("readPage"));
});

test("waitFor: keine oder zwei Bedingungen sind eine benannte Absage", async () => {
  for (const rahmen of [{}, { textPresent: "a", idle: true }, { textPresent: "   " }]) {
    const { ergebnis, spur } = await laufen({
      id: "w-3", cmd: "waitFor", ...rahmen, reason: "Ich warte.",
    });
    assert.equal(ergebnis.success, false, JSON.stringify(rahmen));
    assert.equal(ergebnis.error.code, "param_ungueltig", JSON.stringify(rahmen));
    assert.ok(!anDieSeite(spur).includes("overlay:warten"), JSON.stringify(rahmen));
  }
});

test("screenshot nimmt nur mit Anlass auf — und nur vom Tab im Vordergrund", async () => {
  const { ergebnis, spur } = await laufen({
    id: "s-1", cmd: "screenshot", screenshotReason: "canvas",
    reason: "Die Seite ist eine Zeichenfläche, ich sehe sonst nichts.",
  });
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.data.image.mime, "image/jpeg");
  assert.ok(ergebnis.data.image.dataB64.length > 0);
  assert.equal(ergebnis.data.reason, "canvas");
  const auftrag = spur.find((e) => e.wohin === "tabs.captureVisibleTab");
  assert.equal(auftrag.windowId, 3, "das Bild kommt aus dem Fenster unseres Tabs");
  assert.equal(auftrag.angaben.format, "jpeg", "JPEG, weil PNG den Rahmen sprengt");

  /* Ohne Anlass: keine Aufnahme, keine Frage. */
  const ohne = await laufen({ id: "s-2", cmd: "screenshot", reason: "Ich sehe mal nach." });
  assert.equal(ohne.ergebnis.error.code, "screenshot_not_justified");
  assert.ok(!anDenBrowser(ohne.spur).includes("tabs.captureVisibleTab"));

  /* Im Hintergrund: Der Aufruf fotografierte sonst eine fremde Seite. */
  const hinten = await laufen(
    { id: "s-3", cmd: "screenshot", screenshotReason: "user_request", reason: "Der Nutzer will ein Bild." },
    { tab: { ...TAB, active: false } }
  );
  assert.equal(hinten.ergebnis.error.code, "tab_nicht_im_vordergrund");
  assert.ok(!anDenBrowser(hinten.spur).includes("tabs.captureVisibleTab"),
    "es wird nicht fotografiert, was nicht freigegeben ist");
});

test("screenshot: ein zu großes Bild wird ehrlich abgesagt statt halb geschickt", async () => {
  const { ergebnis } = await laufen(
    { id: "s-4", cmd: "screenshot", screenshotReason: "empty_ax", reason: "Der Textbaum blieb leer." },
    { bildDatenUrl: `data:image/jpeg;base64,${"A".repeat(GRENZEN.bildZeichen + 10)}` }
  );
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "screenshot_zu_gross");
  assert.ok(ergebnis.error.hint.includes("readPage"));
  assert.equal(ergebnis.data, undefined, "kein abgeschnittenes Bild im Rahmen");
});

test("screenshot: sagt der Browser nein, kommt trotzdem eine Aussage", async () => {
  const { ergebnis } = await laufen(
    { id: "s-5", cmd: "screenshot", screenshotReason: "repeated_failure", reason: "Ich komme sonst nicht weiter." },
    { browserSagtNein: new Set(["captureVisibleTab"]) }
  );
  assert.equal(ergebnis.error.code, "snapshot_unavailable");
  assert.ok(ergebnis.error.hint.includes("readPage"));
});

test("select wählt aus — und der Mensch sieht in der Frage, WAS gewählt wird", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "v-1", cmd: "select", ref: "e2", snapshotEpoch: "s1.abcd", value: "XL", reason: "Ich stelle die Größe ein." },
    { sitzung: { ...SITZUNG, stufe: "write" } }
  );
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.data.selected.value, "XL");
  assert.equal(ergebnis.data.selected.role, "combobox");
  const frage = freigabefrage(spur);
  assert.ok(frage.frage.includes("XL"), "der Wert stammt vom Agenten und darf in der Frage stehen");
  assert.equal(frage.quelle, "Zur Kasse", "der Name des Feldes kommt von der Seite und steht daneben");
  assert.ok(!frage.frage.includes("Zur Kasse"), "Seitentext gehört nie in die Frage");
  const n = nachricht(spur, "overlay:auswaehlen");
  assert.equal(n.wert, "XL");
  assert.equal(n.etikett, null);
  assert.equal(n.index, null);
});

test("select: Beschriftung und Nummer sind eigene Wege, aber nie zwei zugleich", async () => {
  const { spur } = await laufen(
    { id: "v-2", cmd: "select", ref: "e2", snapshotEpoch: "s1.abcd", label: "Groß", reason: "Ich wähle die Größe." },
    { sitzung: { ...SITZUNG, stufe: "write" } }
  );
  assert.equal(nachricht(spur, "overlay:auswaehlen").etikett, "Groß");

  const beides = await laufen(
    { id: "v-3", cmd: "select", ref: "e2", snapshotEpoch: "s1.abcd", value: "XL", index: 2, reason: "Ich wähle." },
    { sitzung: { ...SITZUNG, stufe: "write" } }
  );
  assert.equal(beides.ergebnis.error.code, "param_ungueltig");
  assert.ok(!anDieSeite(beides.spur).includes("overlay:auswaehlen"));
});

test("select: gibt es die Option nicht, sagt der Agent es dem Nutzer", async () => {
  const seite = (n) =>
    n.typ === "overlay:auswaehlen" ? { ok: false, fehler: "auswahl_nicht_gefunden" } : seiteStandard(n);
  const { ergebnis } = await laufen(
    { id: "v-4", cmd: "select", ref: "e2", snapshotEpoch: "s1.abcd", value: "XXL", reason: "Ich wähle die Größe." },
    { sitzung: { ...SITZUNG, stufe: "write" }, seite }
  );
  assert.equal(ergebnis.error.code, "option_not_found");
  assert.ok(ergebnis.error.hint.includes("readPage"));

  const keinFeld = (n) =>
    n.typ === "overlay:auswaehlen" ? { ok: false, fehler: "kein_auswahlfeld" } : seiteStandard(n);
  const zweiter = await laufen(
    { id: "v-5", cmd: "select", ref: "e2", snapshotEpoch: "s1.abcd", value: "XL", reason: "Ich wähle." },
    { sitzung: { ...SITZUNG, stufe: "write" }, seite: keinFeld }
  );
  assert.equal(zweiter.ergebnis.error.code, "element_not_found");
  assert.ok(zweiter.ergebnis.error.message.includes("kein Auswahlfeld"));
});

/* ------------------------------------------------------------------ *
 * 3e. Die Nachlese vom 29.07.2026 (M1–M7)
 *
 * Der Befund hinter dieser ganzen Runde: Prüfungen, die auch OHNE den Fix grün
 * bleiben. Die Absage-Prüfungen oben setzten jeweils genau die Kennungen ein,
 * die ohnehin schon in den Tabellen standen — sie bestätigten die Tabelle gegen
 * sich selbst. Deshalb steht am Ende dieses Abschnitts eine Prüfung, die die
 * Kennungen aus overlay.js LIEST statt sie abzuschreiben (M6).
 * ------------------------------------------------------------------ */

test("M1: select in ein Geheimfeld ist eine dauerhafte Absage, kein toter Tab", async () => {
  /* Vorher: kein Eintrag in der Tabelle → `tab_gone`, „Ich konnte auf dieser
     Seite nichts auswählen." und `retryable: true`. Der Tab lebte, die
     Verweigerung war dauerhaft, und der Agent wurde zum Wiederholen eingeladen
     — eine Schleife, in der der Mensch jedes Mal neu gefragt wird. */
  const seite = (n) =>
    n.typ === "overlay:auswaehlen" ? { ok: false, fehler: "feld_geheim" } : seiteStandard(n);
  const { ergebnis } = await laufen(
    {
      id: "m1-1", cmd: "select", ref: "e2", snapshotEpoch: "s1.abcd", label: "12 / 2029",
      reason: "Ich stelle den Ablaufmonat der Karte ein.",
    },
    { sitzung: { ...SITZUNG, stufe: "write" }, seite }
  );
  assert.equal(ergebnis.error.code, "user_declined", "es ist eine Verweigerung, kein Transportfehler");
  assert.equal(ergebnis.error.retryable, false, "ein zweiter Versuch scheitert genauso");
  assert.notEqual(ergebnis.error.code, "tab_gone", "die Seite hat geantwortet — der Tab lebt");
  assert.ok(/Geheimfeld/i.test(ergebnis.error.message), "der Agent erfährt, WORAN es lag");
  assert.ok(ergebnis.error.hint.includes("Nutzer"), "und wer es stattdessen tut");

  /* Dieselbe Kennung, derselbe Fall, dieselbe Antwort — `tuType` war das
     Vorbild, und die beiden dürfen nicht wieder auseinanderlaufen. */
  const beimTippen = await laufen(
    {
      id: "m1-2", cmd: "type", ref: "e2", snapshotEpoch: "s1.abcd", text: "4111",
      reason: "Ich fülle die Kartennummer aus.",
    },
    {
      sitzung: { ...SITZUNG, stufe: "write" },
      seite: (n) => (n.typ === "overlay:tippen" ? { ok: false, fehler: "feld_geheim" } : seiteBedient(n)),
    }
  );
  assert.equal(beimTippen.ergebnis.error.code, ergebnis.error.code, "Tippen und Auswählen sagen dasselbe");
  assert.equal(beimTippen.ergebnis.error.retryable, ergebnis.error.retryable);
});

test("M2: die Freigabefrage nennt die Abfragezeichenkette, nicht nur den Pfad", async () => {
  /* `?bestaetigt=ja` ist der Teil, der etwas auslöst — `/konto/loeschen` ist
     nur der Ort. Vorher fiel er ersatzlos weg, und die Bereichsprüfung fängt
     ihn nicht ab: Sie prüft den Host. */
  const { spur } = await laufen({
    id: "m2-1", cmd: "navigate",
    url: "https://geizhals.de/konto/loeschen?bestaetigt=ja#sofort",
    reason: "Ich rufe die Seite auf.",
  });
  const frage = freigabefrage(spur).frage;
  assert.ok(frage.includes("geizhals.de/konto/loeschen"), "der Ort steht da");
  assert.ok(frage.includes("?bestaetigt=ja"), "und die Abfragezeichenkette auch");
  assert.ok(frage.includes("#sofort"), "die Marke ebenfalls");
});

test("M2: eine überlange Adresse wird gezählt, nicht stillschweigend gekürzt", () => {
  const lang = `https://geizhals.de/suche?q=${"a".repeat(400)}`;
  const v = adressVorschau(lang);
  assert.equal(v.gezeigt.length, GRENZEN.adresseFrageZeichen, "vorn beginnend gekürzt");
  assert.ok(v.rest > 0);
  assert.ok(
    frageZusatz("navigate", { anzeige: v.gezeigt, anzeigeRest: v.rest })
      .includes(`und weitere ${v.rest} Zeichen`),
    "was fehlt, wird beziffert — wie beim Tippen (F2)"
  );
  /* Die Frage wird vorgelesen — in ihr darf kein Zeichen stehen, das einen
     Vorleser etwas anderes sagen lässt, als dasteht. Gezeigt wird deshalb die
     GEPRÜFTE Adresse aus `new URL` und nie die Zeichenkette des Agenten: Der
     URL-Standard kodiert Schreibrichtungsmarken und Steuerzeichen prozentweise
     und weist einen Host mit solchen Zeichen ganz ab. Geprüft wird das
     Ergebnis, nicht der Weg dorthin. */
  const marke = adressVorschau("https://geizhals.de/x?q=a\u202Ebc");
  assert.ok(marke.gezeigt.startsWith("geizhals.de"),
    "gezeigt wird die geprüfte Adresse, nicht die Zeichenkette des Agenten");
  assert.ok(
    !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/
      .test(marke.gezeigt),
    "keine Steuerzeichen und keine Schreibrichtungsmarken in der vorgelesenen Frage"
  );
  assert.ok(marke.gezeigt.includes("%E2%80%AE"), "die Marke steht harmlos und sichtbar da");
  assert.equal(adressVorschau("https://geizhals.de/").gezeigt, "geizhals.de");
});

test("M3: die Bedenkzeit des Menschen ist Menschenzeit, nicht die Frist des Befehls", async () => {
  /* Vorher bekam der Inhaber `frist − Puffer − Reserve`: bei `select` rund 10,5
     Sekunden, bei `scroll` rund 5,5 — um eine vorgelesene Frage zu HÖREN und zu
     entscheiden. */
  for (const cmd of ["scroll", "select", "get_state"]) {
    const sitzung = BEFEHLE[cmd].stufe === "write" ? { ...SITZUNG, stufe: "write" } : SITZUNG;
    const { spur } = await laufen(
      { id: `m3-${cmd}`, cmd, reason: "Ich mache das jetzt.", ...(VOLLSTAENDIG[cmd] || {}) },
      { sitzung, seite: seiteBedient }
    );
    const frage = freigabefrage(spur);
    assert.equal(typeof frage.frist, "number",
      `${cmd}: ohne mitgeschickte Frist rechnet die Seitenleiste selbst — und käme auf die alte Zahl`);
    assert.ok(frage.frist >= GRENZEN.bedenkzeitMs,
      `${cmd}: nur ${frage.frist} ms zum Zuhören und Entscheiden`);
  }
});

test("M3: ein Befehl mit kurzer Frist wird trotzdem gefragt — und danach ausgeführt", async () => {
  const alt = BEFEHLE.scroll.frist;
  /* 4000 − 1500 Puffer − 3000 Reserve = −500: Vorher gab es hier gar keine
     Frage, sondern sofort „Für die Rückfrage blieb keine Zeit mehr". */
  BEFEHLE.scroll.frist = 4000;
  try {
    const { ergebnis, spur } = await laufen({
      id: "m3-kurz", cmd: "scroll", direction: "down", reason: "Ich blättere weiter.",
    });
    assert.ok(freigabefrage(spur), "der Mensch wird gefragt statt abgewiesen");
    assert.equal(ergebnis.success, true, "und der Schritt findet danach wirklich statt");
  } finally {
    BEFEHLE.scroll.frist = alt;
  }
});

test("M3: was der Mensch zum Nachdenken braucht, fehlt der Maschine nicht", async () => {
  /* `waitFor` sagt der Seite, wie lange sie warten soll. Daran lässt sich
     ablesen, ob die Bedenkzeit das Budget der Maschine aufgefressen hat — sonst
     wäre die längere Bedenkzeit nur eine längere Art, `settle_timeout` zu
     sagen. */
  const alt = BEFEHLE.waitFor.frist;
  BEFEHLE.waitFor.frist = 8000;
  try {
    const panel = async (n) => {
      if (n.typ !== "link:schritt-freigabe") return { ok: true };
      await new Promise((r) => setTimeout(r, 1500));
      return { ja: true };
    };
    const { ergebnis, spur } = await laufen(
      { id: "m3-gutschrift", cmd: "waitFor", textPresent: "fertig", waitSeconds: 5, reason: "Ich warte." },
      { panel }
    );
    assert.equal(ergebnis.success, true);
    const n = nachricht(spur, "overlay:warten");
    assert.ok(n.fristMs >= 3000,
      `nach 1,5 s Bedenkzeit blieben nur ${n.fristMs} ms Wartezeit — die Bedenkzeit wurde der Maschine abgezogen`);
  } finally {
    BEFEHLE.waitFor.frist = alt;
  }
});

test("M3: was länger wartet als der Relay, wird gar nicht erst gefragt", async () => {
  /* Die andere Seite desselben Deckels: Wer die Frage nach Ablauf der
     Relay-Frist stellt, lässt den Menschen über einen Schritt entscheiden,
     dessen Ergebnis niemand mehr hört. */
  const alt = GRENZEN.gesamtfristMs;
  GRENZEN.gesamtfristMs = 0; // damit gilt jeder Befehl als „schon zu spät"
  try {
    const { ergebnis, spur } = await laufen({
      id: "m3-spaet", cmd: "get_state", reason: "Ich sehe nach.",
    });
    assert.equal(ergebnis.success, false);
    assert.equal(ergebnis.error.code, "settle_timeout");
    assert.ok(ergebnis.error.hint, "auch diese Absage nennt den nächsten Schritt");
    assert.ok(!anDasPanel(spur).includes("link:schritt-freigabe"),
      "es wird nicht gefragt, wenn die Antwort ohnehin zu spät käme");
  } finally {
    GRENZEN.gesamtfristMs = alt;
  }
});

test("M4: waitFor kennt die Absagen des Inhaltsskripts beim Namen", async () => {
  /* `ruhe_nicht_messbar` ist der praktische Fall: Der Agent hörte „der Tab ist
     weg, versuch es nochmal" und wartete in einer Schleife auf etwas, das nie
     messbar wird. */
  const faelle = {
    ruhe_nicht_messbar: "idle_not_measurable",
    unbekannte_bedingung: "param_ungueltig",
    wert_fehlt: "param_ungueltig",
  };
  for (const [kennung, code] of Object.entries(faelle)) {
    const seite = (n) =>
      n.typ === "overlay:warten" ? { ok: false, fehler: kennung } : seiteStandard(n);
    const { ergebnis } = await laufen(
      { id: `m4-${kennung}`, cmd: "waitFor", idle: true, waitSeconds: 2, reason: "Ich warte." },
      { seite }
    );
    assert.equal(ergebnis.error.code, code, kennung);
    assert.equal(ergebnis.error.retryable, false, `${kennung}: lädt zur Schleife ein`);
    assert.ok(ergebnis.error.hint, `${kennung}: keine Absage ohne nächsten Schritt`);
  }
  /* Und der Hinweis führt aus der Sackgasse heraus: auf etwas Sichtbares
     warten statt auf Ruhe. */
  const ruhe = (n) =>
    n.typ === "overlay:warten" ? { ok: false, fehler: "ruhe_nicht_messbar" } : seiteStandard(n);
  const { ergebnis } = await laufen(
    { id: "m4-weg", cmd: "waitFor", idle: true, waitSeconds: 2, reason: "Ich warte." },
    { seite: ruhe }
  );
  assert.ok(ergebnis.error.hint.includes("textPresent"));
  assert.ok(!ergebnis.error.hint.includes("idle"), "die Sackgasse wird nicht noch einmal empfohlen");
});

test("M5: extract nennt bei unsichtbaren Stellen den Weg, der wirklich hilft", async () => {
  /* overlay.js bricht das GANZE Auslesen ab, sobald eine einzige Referenz
     außerhalb des Sichtfelds liegt. Vorher stand dort „Kurz warten und noch
     einmal versuchen" — Warten hilft in diesem Fall nie. */
  const seite = (n) =>
    n.typ === "overlay:auslesen" ? { ok: false, fehler: "element_not_visible" } : seiteStandard(n);
  const { ergebnis } = await laufen(
    { id: "m5-1", cmd: "extract", refs: ["e2"], snapshotEpoch: "s1.abcd", reason: "Ich lese den Preis ab." },
    { seite }
  );
  assert.equal(ergebnis.error.code, "element_not_visible");
  assert.equal(ergebnis.error.retryable, false, "Warten ändert an der Sichtbarkeit nichts");
  assert.ok(ergebnis.error.hint.includes("scroll"), "der nächste Schritt steht da");
  assert.ok(!ergebnis.error.hint.includes("Kurz warten"));

  const bereich = (n) =>
    n.typ === "overlay:auslesen" ? { ok: false, fehler: "bereich_nicht_gefunden" } : seiteStandard(n);
  const zweiter = await laufen(
    { id: "m5-2", cmd: "extract", region: "e2", snapshotEpoch: "s1.abcd", reason: "Ich lese den Kasten ab." },
    { seite: bereich }
  );
  assert.equal(zweiter.ergebnis.error.code, "region_not_found");
  assert.equal(zweiter.ergebnis.error.retryable, false, "der Bereich entsteht durch Warten nicht");
  assert.ok(zweiter.ergebnis.error.hint.includes("readPage"));
});

test("M7: passt das Bild nicht, wird es gröber aufgenommen statt abgesagt", async () => {
  /* Vorher gab es genau eine Stufe. 90 KiB Base64 ≈ 67 KiB JPEG — ein
     Ausschnitt von 1920×1080 bei Qualität 40 liegt typischerweise darüber, auf
     einem HiDPI-Schirm deutlich. Der Notausgang stand damit die meiste Zeit zu. */
  const bildDatenUrl = (angaben) => {
    const laenge = angaben.quality >= 40
      ? GRENZEN.bildZeichen + 1000
      : Math.floor(GRENZEN.bildZeichen / 2);
    return `data:image/jpeg;base64,${"A".repeat(laenge)}`;
  };
  const { ergebnis, spur } = await laufen(
    { id: "m7-1", cmd: "screenshot", screenshotReason: "canvas", reason: "Die Seite ist eine Zeichenfläche." },
    { bildDatenUrl }
  );
  assert.equal(ergebnis.success, true, "der Notausgang steht offen");
  const aufnahmen = spur.filter((e) => e.wohin === "tabs.captureVisibleTab");
  assert.ok(aufnahmen.length >= 2, "es wurde eine zweite, gröbere Stufe versucht");
  assert.ok(aufnahmen[1].angaben.quality < aufnahmen[0].angaben.quality,
    "und zwar wirklich gröber, nicht noch einmal dasselbe");
  assert.equal(ergebnis.data.image.quality, aufnahmen[aufnahmen.length - 1].angaben.quality,
    "der Agent erfährt, wie grob das Bild ist");
});

test("M7: ein Bild am Deckel passt noch durch die Leitung", async () => {
  /* Der Deckel für das Bild und der Deckel für den Rahmen sind zwei Zahlen, die
     zueinander passen müssen: Ein Bild, das gerade noch erlaubt ist, darf
     `rahmenDeckeln` nicht in eine Absage ohne Bild verwandeln. */
  const { ergebnis } = await laufen(
    { id: "m7-2", cmd: "screenshot", screenshotReason: "empty_ax", reason: "Der Textbaum blieb leer." },
    { bildDatenUrl: `data:image/jpeg;base64,${"A".repeat(GRENZEN.bildZeichen)}` }
  );
  assert.equal(ergebnis.success, true, "das größte erlaubte Bild kommt an");
  assert.ok(JSON.stringify(ergebnis).length <= GRENZEN.rahmenZeichen,
    "und der fertige Rahmen bleibt unter dem Rahmendeckel");
});

/* ------------------------------------------------------------------ *
 * M6 — die Prüflücke, aus der M1, M4 und M5 überhaupt entstehen konnten.
 *
 * Keine Prüfung verlangte, dass jede Fehlerkennung, die das Inhaltsskript
 * senden KANN, im Ausführer eine Entsprechung hat. Zwei gepflegte Listen laufen
 * auseinander; dieses Projekt hat das schon dreimal bezahlt.
 *
 * Deshalb wird die eine Liste hier nicht abgeschrieben, sondern GELESEN — aus
 * overlay.js selbst. Kommt dort eine Kennung dazu, für die keine tu*-Funktion
 * einen Satz hat, wird diese Prüfung rot, ohne dass jemand sie anfasst.
 * ------------------------------------------------------------------ */

const OVERLAY_QUELLE = readFileSync(new URL("../content/overlay.js", import.meta.url), "utf8");
const AUSFUEHRER_QUELLE = readFileSync(new URL("../net/ausfuehrer.js", import.meta.url), "utf8");

/**
 * Welche Fehlerkennungen overlay.js je Nachrichtenart senden kann.
 *
 * Gelesen wird der Quelltext, nicht eine Abschrift davon. Die Regel für das
 * Weiterreichen ist die, die im Code wirklich steht: Wer `fehler: x.fehler`
 * zurückgibt, reicht ALLE Kennungen der Bausteine durch, die er aufruft; wer
 * nur einzelne Zeichenketten prüft (`treffer.fehler === "stale_ref"` in
 * `scrollen`), reicht auch nur seine eigenen weiter.
 */
function kennungenAusOverlay() {
  const marken = [...OVERLAY_QUELLE.matchAll(/^ {2}(?:const|let|function) ([A-Za-z_$][\w$]*)/gm)]
    .map((m) => ({ name: m[1], von: m.index }));
  for (let i = 0; i < marken.length; i++) {
    marken[i].text = OVERLAY_QUELLE.slice(
      marken[i].von,
      i + 1 < marken.length ? marken[i + 1].von : OVERLAY_QUELLE.length
    );
  }
  const namen = new Set(marken.map((b) => b.name));
  const nachName = new Map(marken.map((b) => [b.name, b]));

  const eigene = (text) => new Set([...text.matchAll(/fehler:\s*"([a-z_]+)"/g)].map((m) => m[1]));
  const gerufen = (text, selbst) =>
    [...namen].filter((n) => n !== selbst && new RegExp(`\\b${n}\\s*\\(`).test(text));
  const reichtDurch = (text) => /fehler:\s*[A-Za-z_$][\w$]*\.fehler/.test(text);

  const codesVon = (name, gesehen = new Set()) => {
    if (gesehen.has(name) || !nachName.has(name)) return new Set();
    gesehen.add(name);
    const b = nachName.get(name);
    const raus = eigene(b.text);
    if (reichtDurch(b.text)) {
      for (const d of gerufen(b.text, name)) for (const c of codesVon(d, gesehen)) raus.add(c);
    }
    return raus;
  };

  const jeTyp = new Map();
  const faelle = OVERLAY_QUELLE.matchAll(
    /^ {6}case "(overlay:[a-z]+)":([\s\S]*?)(?=^ {6}(?:case "|default:))/gm
  );
  for (const f of faelle) {
    const raus = eigene(f[2]);
    for (const n of gerufen(f[2], null)) for (const c of codesVon(n)) raus.add(c);
    jeTyp.set(f[1], [...raus].sort());
  }
  return jeTyp;
}

/* Welcher Befehl den jeweiligen Weg zur Seite geht. Die Zuordnung steht hier,
   die LISTE der Wege nicht: Welche Wege der Ausführer benutzt, wird unten aus
   ausfuehrer.js gelesen — ein neuer Weg ohne Eintrag hier fällt auf. */
const KANAL_BEFEHL = {
  "overlay:baum": "readPage",
  "overlay:zustand": "get_state",
  "overlay:nachschlagen": "highlight",
  "overlay:scrollen": "scroll",
  "overlay:klicken": "click",
  "overlay:tippen": "type",
  "overlay:auswaehlen": "select",
  "overlay:auslesen": "extract",
  "overlay:warten": "waitFor",
};

/** Was der Ausführer antwortet, wenn die Seite auf diesem Weg so absagt. */
async function absageDurchspielen(typ, kennung) {
  const cmd = KANAL_BEFEHL[typ];
  const sitzung = BEFEHLE[cmd].stufe === "write" ? { ...SITZUNG, stufe: "write" } : SITZUNG;
  const seite = (n) => (n.typ === typ ? { ok: false, fehler: kennung } : seiteBedient(n));
  const { ergebnis } = await laufen(
    { id: `m6-${cmd}`, cmd, reason: "Ich mache das jetzt.", ...(VOLLSTAENDIG[cmd] || {}) },
    { sitzung, seite }
  );
  return ergebnis;
}

test("M6: jede Kennung, die das Inhaltsskript senden kann, hat im Ausführer einen Satz", async () => {
  const jeTyp = kennungenAusOverlay();

  /* Zuerst die Lesehilfe selbst prüfen: Eine Auswertung, die aus Versehen
     nichts findet, wäre die bequemste Art, diese Prüfung grün zu halten. */
  const alle = new Set([...jeTyp.values()].flat());
  assert.ok(alle.size >= 10, `nur ${alle.size} Kennungen in overlay.js gefunden — die Auswertung greift nicht`);
  assert.ok([...jeTyp.values()].filter((c) => c.length).length >= 6, "zu wenige Wege mit Absagen gefunden");

  /* Und dann: Benutzt der Ausführer einen Weg, der absagen kann, ohne dass ihn
     hier jemand durchspielt? */
  const benutzt = new Set(
    [...AUSFUEHRER_QUELLE.matchAll(/typ:\s*"(overlay:[a-z]+)"/g)].map((m) => m[1])
  );
  for (const typ of benutzt) {
    if (!(jeTyp.get(typ) || []).length) continue; // overlay:ping, overlay:zeiger sagen nie ab
    assert.ok(KANAL_BEFEHL[typ], `${typ} kann absagen, wird hier aber nicht durchgespielt`);
  }

  for (const [typ, cmd] of Object.entries(KANAL_BEFEHL)) {
    const kennungen = jeTyp.get(typ) || [];
    assert.ok(kennungen.length, `für ${typ} wurde keine einzige Kennung gefunden`);

    /* Der Vergleichsmassstab: die Antwort auf eine Kennung, die es NICHT gibt.
       Jede echte Kennung muss davon abweichen — sonst hat der Ausführer sie gar
       nicht erkannt, sondern nur den Vorgabezweig genommen. */
    const vorgabe = await absageDurchspielen(typ, "kennung_die_es_nicht_gibt");

    /* Die Kennung kommt aus einer fremden Seite. Namen aus dem Grundgerüst von
       JavaScript dürfen in der Fehlertabelle nichts treffen: Sie müssen genau
       dieselbe Antwort ergeben wie jede andere unbekannte Kennung — und nicht
       den Fangnetz-Zweig, weil beim Auspacken einer geerbten Eigenschaft etwas
       geworfen wurde. */
    for (const gemein of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const e = await absageDurchspielen(typ, gemein);
      assert.equal(e.type, "result", `${typ}/${gemein}: keine Antwort`);
      assert.equal(e.success, false, `${typ}/${gemein}`);
      assert.equal(e.error.message, vorgabe.error.message,
        `${typ}/${gemein}: wird wie eine Eigenschaft des Grundgerüsts behandelt statt wie eine unbekannte Kennung`);
    }

    for (const kennung of kennungen) {
      const e = await absageDurchspielen(typ, kennung);
      const wo = `${typ}/${kennung} (${cmd})`;
      assert.equal(e.success, false, wo);
      assert.ok(e.error && e.error.message, `${wo}: ohne Satz für den Menschen`);
      assert.equal(typeof e.error.retryable, "boolean", `${wo}: ohne Aussage über Wiederholen`);
      assert.ok(e.error.hint, `${wo}: Absage ohne nächsten Schritt`);
      /* Wer antwortet, lebt: Das Inhaltsskript hat gesprochen, also ist der Tab
         erreichbar. `tab_gone` wäre hier eine Falschaussage — genau die, die
         `select` bei `feld_geheim` gemacht hat. */
      assert.notEqual(e.error.code, "tab_gone", `${wo}: die Seite hat geantwortet, der Tab lebt`);
      assert.notEqual(
        e.error.message, vorgabe.error.message,
        `${wo}: kein eigener Satz — hier springt der Vorgabezweig ein`
      );
    }
  }
});

test("Der Zusatz zur Freigabefrage kommt nie von der besuchten Seite", () => {
  /* Reine Prüfung ohne Browser: Was `frageZusatz` baut, stammt ausschließlich
     aus dem Plan — und der stammt aus dem Rahmen des Agenten. */
  assert.equal(frageZusatz("get_state", {}), "");
  assert.ok(frageZusatz("navigate", { anzeige: "geizhals.de/kasse" }).includes("geizhals.de/kasse"));
  assert.ok(frageZusatz("select", { anzeige: "„XL\"" }).includes("XL"));
  assert.ok(frageZusatz("waitFor", { bedingung: "idle", wert: true }).includes("zur Ruhe"));
  assert.equal(frageZusatz("type", null), "");
  /* Der leere Text ist kein Tippen, sondern ein Löschen — und wird so gefragt. */
  assert.ok(frageZusatz("type", { text: "", leeren: true, absenden: false }).includes("Feld leeren"));
});

/* ------------------------------------------------------------------ *
 * 4. Deckel, Fristen, Sitzungsende
 * ------------------------------------------------------------------ */

test("Befehlsdeckel je Zeitfenster greift", async () => {
  attrappeSetzen({ tab: TAB, seiteAntwortet: seiteStandard, panelAntwortet: panelSagtJa });
  zaehlerNeu();
  let letztes;
  for (let i = 0; i < GRENZEN.befehleJeFenster + 1; i++) {
    letztes = await befehlAusfuehren(
      { id: `d-${i}`, cmd: "get_state", reason: "Ich sehe nach." },
      SITZUNG
    );
  }
  assert.equal(letztes.success, false);
  assert.equal(letztes.error.code, "budget_exceeded");
  assert.equal(letztes.error.retryable, true);
});

test("Nach dem Sitzungsende wird nichts mehr ausgeführt — aber geantwortet", async () => {
  attrappeSetzen({ tab: TAB, seiteAntwortet: seiteStandard, panelAntwortet: panelSagtJa });
  zaehlerNeu();
  laufBeenden();
  const ergebnis = await befehlAusfuehren(
    { id: "e-1", cmd: "readPage", reason: "Ich lese." },
    SITZUNG
  );
  istErgebnisrahmen(ergebnis, "e-1", "readPage");
  assert.equal(ergebnis.error.code, "session_beendet");
});

test("Unsere Uhr läuft vor der des Relays ab", async () => {
  const alt = BEFEHLE.get_state.frist;
  BEFEHLE.get_state.frist = 3000; // 3000 − 1500 Puffer = 1500 ms eigene Frist
  try {
    const seite = (n) =>
      n.typ === "overlay:zustand" ? new Promise(() => {}) : seiteStandard(n);
    const begonnen = Date.now();
    const { ergebnis } = await laufen(
      { id: "f-1", cmd: "get_state", reason: "Ich sehe nach." },
      { seite }
    );
    /* Der Befehl antwortet selbst und nennt, woran es lag. Bis zum 29.07.2026
       lief hier ein Rennen: Der Aufruf an die Seite und der Wecker des Befehls
       endeten auf derselben Millisekunde, und mal gewann der eine, mal der
       andere. Seit `SEITEN_RESERVE_MS` gewinnt immer der Befehl — der Wecker
       ist das letzte Netz, nicht der Regelweg. */
    assert.equal(ergebnis.error.code, "tab_gone");
    assert.ok(ergebnis.error.retryable, "der Tab kann beim nächsten Mal antworten");
    assert.ok(Date.now() - begonnen < 3000, "die Antwort kommt vor der Frist des Relays");
  } finally {
    BEFEHLE.get_state.frist = alt;
  }
});

test("Und wenn der Browser selbst hängt, antwortet der Wecker", async () => {
  /* Das letzte Netz: Hier gibt es keinen Aufruf an die Seite, der zuerst
     aufgeben könnte — `captureVisibleTab` kommt einfach nie zurück. Ohne den
     Wecker wartete der Agent bis zur Frist des Relays und bekäme dann „keine
     Antwort vom Browser" statt einer Aussage. */
  const alt = BEFEHLE.screenshot.frist;
  BEFEHLE.screenshot.frist = 3000;
  try {
    const begonnen = Date.now();
    const { ergebnis } = await laufen(
      { id: "f-3", cmd: "screenshot", screenshotReason: "canvas", reason: "Ich sehe sonst nichts." },
      { browserSchweigt: new Set(["captureVisibleTab"]) }
    );
    assert.equal(ergebnis.error.code, "settle_timeout");
    assert.ok(ergebnis.error.message.length > 0);
    assert.ok(Date.now() - begonnen < 3000, "die Antwort kommt vor der Frist des Relays");
  } finally {
    BEFEHLE.screenshot.frist = alt;
  }
});

test("Antwortet der Mensch nicht, wird die Frage zurückgezogen", async () => {
  /* Die Bedenkzeit wird für diesen Lauf heruntergesetzt: Sie ist seit M3
     bewusst lang (30 s) und hat mit dieser Zusicherung nichts zu tun — geprüft
     wird, was NACH ihrem Ablauf geschieht, nicht wie lang sie ist. */
  const alteBedenkzeit = GRENZEN.bedenkzeitMs;
  const alteFrist = BEFEHLE.get_state.frist;
  GRENZEN.bedenkzeitMs = 1000;
  BEFEHLE.get_state.frist = 5000; // 5000 − 1500 − 3000 = 500 → es gilt die Bedenkzeit
  try {
    const panel = (n) =>
      n.typ === "link:schritt-freigabe" ? new Promise(() => {}) : { ok: true };
    const { ergebnis, spur } = await laufen(
      { id: "f-2", cmd: "get_state", reason: "Ich sehe nach." },
      { panel }
    );
    assert.equal(ergebnis.error.code, "grant_required");
    assert.ok(anDasPanel(spur).includes("link:freigabe-zurueckziehen"),
      "die Karte wird zurückgezogen, damit niemand ins Leere zustimmt");
  } finally {
    GRENZEN.bedenkzeitMs = alteBedenkzeit;
    BEFEHLE.get_state.frist = alteFrist;
  }
});

/* ------------------------------------------------------------------ *
 * 5. Die Zusicherung selbst: kein Weg ohne Antwort
 * ------------------------------------------------------------------ */

test("Jeder denkbare Rahmen bekommt einen Ergebnisrahmen zurück", async () => {
  const rahmen = [
    { id: "g-1", cmd: "readPage", reason: "Ich lese." },
    { id: "g-2", cmd: "eval", reason: "Ich rechne." },
    { id: "g-3", cmd: "", reason: "Nichts." },
    { id: "g-4", reason: "Ohne Befehl." },
    { id: "g-5", cmd: "readPage" },
    { id: "g-6", cmd: "highlight", reason: "Ich zeige." },
    { id: "g-7", cmd: "scroll", direction: "seitwärts", amount: -99999, reason: "Ich scrolle." },
    { id: "g-8", cmd: "get_state", reason: "x".repeat(5000) },
    { id: "g-9", cmd: "x".repeat(500), reason: "Langer Name." },
    { id: "", cmd: "readPage", reason: "Ohne Kennung." },
    { cmd: "readPage", reason: "Gar keine Kennung." },
    { id: "g-10", cmd: null, reason: null },
    {},
  ];
  for (const r of rahmen) {
    const { ergebnis } = await laufen(r, { panel: panelSagtJa });
    assert.equal(ergebnis.type, "result", `kein Ergebnisrahmen für ${JSON.stringify(r)}`);
    assert.equal(typeof ergebnis.id, "string");
    assert.equal(typeof ergebnis.success, "boolean");
    if (!ergebnis.success) {
      assert.ok(ergebnis.error && ergebnis.error.code, `ohne Fehlerkennung: ${JSON.stringify(r)}`);
      assert.ok(ergebnis.error.message, `ohne Satz für den Menschen: ${JSON.stringify(r)}`);
    }
  }
});

test("Auch ein Fehler in der Seitenschicht endet mit einer Antwort", async () => {
  const seite = () => {
    throw new Error("die Attrappe platzt");
  };
  const { ergebnis } = await laufen(
    { id: "h-1", cmd: "readPage", reason: "Ich lese." },
    { seite }
  );
  istErgebnisrahmen(ergebnis, "h-1", "readPage");
  assert.equal(ergebnis.success, false);
});

/* ------------------------------------------------------------------ *
 * 6. Der Schließgrund des Relays
 * ------------------------------------------------------------------ */

test("Schließgrund: der Grund schlägt den Code", () => {
  assert.equal(
    schliessgrund(4400, "ticket_replayed"),
    "Diese Freigabe war schon verbraucht. Jede Verbindung braucht eine eigene. Bitte gib neu frei."
  );
  assert.ok(schliessgrund(4401, "ausweis_fremd").includes("verschiedenen Konten"));
  assert.ok(schliessgrund(4400, "client_unbekannt").includes("nicht zugelassen"));
  assert.ok(schliessgrund(4409, "session_idle").includes("längere Zeit nichts passiert"));
});

test("Schließgrund: unbekannter Grund fällt auf den Code zurück, nie auf eine Kennung", () => {
  const text = schliessgrund(4408, "irgendwas_neues");
  assert.equal(text, "Die vereinbarte Zeit ist um. Die Verbindung ist beendet.");
  assert.ok(!text.includes("irgendwas_neues"), "Kennungen sind nichts für Menschen");

  const ohne = schliessgrund(1006, null);
  assert.ok(ohne.includes("abgerissen"));
});

test("Schließgrund: jeder Grund aus DRAHTFORMAT §8 hat einen Satz", () => {
  const gruende = [
    "protocol_error", "client_unbekannt", "duration_zero_forbidden", "access_level_forbidden",
    "access_ungueltig", "duration_ungueltig", "modus_ungueltig", "idle_timeout_ungueltig",
    "allow_leer", "allow_ungueltig", "allow_zu_weit", "allow_zu_gross", "ticket_im_query",
    "token_im_unterprotokoll", "unauthorized", "ticket_replayed", "ausweis_fehlt",
    "ausweis_fremd", "session_expired", "session_idle", "revoked_by_user", "rate_limited",
  ];
  for (const g of gruende) {
    /* Ein unbekannter Code, damit wirklich der Grund antwortet und nicht die
       Code-Tabelle einspringt. */
    const text = schliessgrund(4999, g);
    assert.ok(text.length > 10, `${g} hat keinen Satz`);
    assert.ok(!text.includes("abgerissen"), `${g} fällt auf den Vorgabesatz zurück`);
  }
});
