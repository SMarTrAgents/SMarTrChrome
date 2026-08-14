/*
 * Prüfung der Bereichswache im Ausführer (net/ausfuehrer.js).
 *
 * Aufruf:  node --test src/pruefung/
 *
 * Der Befund vom 11.08.2026, Stufe HOCH: Der Bereich wurde geprüft, BEVOR der
 * Mensch gefragt wurde. Zwischen dem Ja und der Ausführung liegt Menschenzeit,
 * und in dieser Zeit kann der Tab woanders stehen — die Seite leitet sich
 * selbst weiter, ein Formular geht ab, ein Zeitgeber springt, oder der Mensch
 * wechselt selbst. Danach wurde der Tab weiterbenutzt, als hätte niemand
 * hingesehen. Am teuersten beim Bild: `captureVisibleTab` nimmt den GANZEN
 * sichtbaren Tab auf, es gibt keinen Ausschnitt, und das Bild geht an die
 * Cloud.
 *
 * Diese Prüfungen messen deshalb drei Dinge und nicht eines:
 *
 *  1. Dass abgelehnt wird — mit dem GENAUEN Satz, nicht mit „irgendeinem
 *     Fehler".
 *  2. Dass die Tat wirklich unterbleibt. Gemessen wird an der Chrome-Attrappe:
 *     `captureVisibleTab` darf im Fall der Abwanderung NIE gerufen worden sein,
 *     und dasselbe gilt für jeden anderen Befehl mit seinem eigenen Weg.
 *  3. Dass die Ablehnung selbst nichts verrät. Eine Absage, die die neue
 *     Adresse nennt, hat gerade gesagt, wo der Mensch gerade ist — sie wäre
 *     dann selbst das Leck, das sie verhindern soll.
 *
 * Und die Gegenprobe steht überall daneben: Derselbe Wirt auf einer anderen
 * Unterseite muss weiterhin durchgehen. Eine Wache, die alles ablehnt, ist
 * keine Wache, sondern ein kaputter Befehl.
 *
 * Nachgemessen durch Mutation am 11.08.2026 — die Wache wurde probeweise
 * wieder herausgenommen, einzeln und ganz:
 *
 *   Wache aus der Befehlsschleife  → „JEDER Befehl bricht ab" wird rot.
 *   Wache aus `wahrnehmenGesichert`→ die drei Prüfsätze aus Abschnitt 3 werden rot.
 *   Wache aus `tuExtract`          → „dasselbe für extract" wird rot.
 *   Wache aus der Bildleiter       → „anderer Tab nach vorn" und
 *                                    „zwischen zwei Stufen" werden rot.
 *   ALLE vier heraus (Stand vor der Reparatur) → 9 von 12 rot; grün bleiben
 *   genau die drei Gegenproben, die grün bleiben MÜSSEN.
 *
 * Die beiden Wachen in der Schleife und in der Bildleiter decken einander beim
 * Bild ab: Wer nur eine von beiden entfernt, färbt den ersten Prüfsatz noch
 * nicht rot. Das ist Absicht (zwei Netze statt einem) und der Grund, warum die
 * Mutationsprobe hier auch den Zustand vor der Reparatur kennt.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen, anDieSeite } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, BEVOR die Module geladen werden. */
attrappeSetzen();

const { BEFEHLE, GRENZEN } = await import("../net/befehle.js");
const { befehlAusfuehren, zaehlerNeu } = await import("../net/ausfuehrer.js");

/* ------------------------------------------------------------------ *
 * Die Sätze, auf die es ankommt.
 *
 * Bewusst hier abgeschrieben und nicht aus ausfuehrer.js importiert: Der Text
 * im Quelltext ist der Prüfling, nicht der Maßstab. Wer ihn umformuliert, muss
 * hier vorbeikommen und sich fragen, ob der neue Satz dasselbe verspricht.
 * ------------------------------------------------------------------ */

const SATZ_ABGEWANDERT =
  "Dieser Tab hat seit der Freigabe die Seite gewechselt. Ich arbeite hier nicht weiter, und ich sage auch nicht, wo er jetzt steht.";
const SATZ_TAB_WEG = "Der Tab, den ich steuern durfte, ist nicht mehr da.";
const SATZ_NICHT_VORN =
  "Dieser Tab steht gerade nicht im Vordergrund. Ich fotografiere nicht, was ich nicht steuern darf.";

/* Die fremde Adresse. Sie ist absichtlich sprechend: Taucht diese Zeichenkette
   irgendwo in der Antwort oder im Protokoll auf, ist das Leck belegt. */
const FREMD = "https://bank.example/konto/umsaetze";
const FREMDE_MARKE = "bank.example";

/* ------------------------------------------------------------------ *
 * Gerüst
 * ------------------------------------------------------------------ */

const SITZUNG = {
  stufe: "read",
  modus: "tab",
  bereich: ["geizhals.de"],
  schrittmodus: "confirm_each",
  tabId: 7,
  endetUm: Date.now() + 600000,
};

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
  { art: "element", ref: "e2", rolle: "button", name: "Zur Kasse", wert: null, zustand: ["visible"], tiefe: 1 },
];

function seiteBedient(n) {
  switch (n.typ) {
    case "overlay:ping":
      return { ok: true };
    case "overlay:baum":
      return { ok: true, epoche: "s1.abcd", knoten: KNOTEN, ausgelassen: {} };
    case "overlay:zustand":
      return {
        ok: true, readyState: "complete", scrollY: 0, scrollHeight: 4000,
        viewportHeight: 900, atTop: true, atBottom: false,
        epoche: "s1.abcd", elementCount: 1,
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
    case "overlay:arbeitszeiger":
      return { ok: true };
    case "overlay:auslesen":
      return { ok: true, treffer: [{ ref: "e2", rolle: "button", name: "Zur Kasse", wert: "428,90 Euro" }] };
    case "overlay:warten":
      return { ok: true, erfuellt: true, wartezeitMs: 120 };
    case "overlay:klicken":
      return { ok: true, rolle: "button", name: "Zur Kasse" };
    case "overlay:tippen":
      return { ok: true, rolle: "textbox", name: "Suche", laenge: 5, abgesendet: false };
    case "overlay:auswaehlen":
      return { ok: true, rolle: "combobox", name: "Größe", gewaehlt: "XL" };
    default:
      return { ok: false, fehler: "unbekannte_nachricht" };
  }
}

/* Die vollständigen Parametersätze aller dreizehn Befehle. */
const VOLLSTAENDIG = {
  readPage: {},
  snapshot: {},
  get_state: {},
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

/* Woran man sieht, dass dieser Befehl WIRKLICH stattgefunden hat. Das ist der
   Kern jeder dieser Prüfungen: „success: false" allein belegt nichts, solange
   nicht feststeht, dass die Seite oder der Browser nie angefasst wurde. */
const TAT = {
  readPage: "overlay:baum",
  snapshot: "overlay:baum",
  get_state: "overlay:zustand",
  highlight: "overlay:zeiger",
  click: "overlay:klicken",
  type: "overlay:tippen",
  select: "overlay:auswaehlen",
  scroll: "overlay:scrollen",
  extract: "overlay:auslesen",
  waitFor: "overlay:warten",
  screenshot: "tabs.captureVisibleTab",
  navigate: "tabs.update",
  back: "tabs.goBack",
};

/**
 * Ein Lauf mit Haken an genau den Stellen, an denen die Wirklichkeit
 * umspringen kann.
 *
 * `beiFreigabe` läuft im Augenblick des Ja — das ist der Fall aus dem Befund.
 * `beiNachricht` läuft, sobald eine bestimmte Nachricht die Seite erreicht;
 * damit lässt sich der zweite Fall bauen, in dem erst der Schritt selbst die
 * Seite zum Wechseln bringt.
 */
async function laufen(rahmen, {
  sitzung = SITZUNG,
  tab = TAB,
  seite = seiteBedient,
  beiFreigabe = null,
  beiNachricht = null,
  beiBild = null,
} = {}) {
  /* Der Tab wird kopiert und dann absichtlich verändert: Genau diese Kopie ist
     das, was `chrome.tabs.get` zurückgibt. */
  const derTab = { ...tab };
  let gefragt = false;

  const panel = (n) => {
    if (n.typ === "link:schritt-freigabe") {
      gefragt = true;
      if (beiFreigabe) beiFreigabe(derTab);
      return { ja: true };
    }
    return { ok: true };
  };
  const seiteMitHaken = (n) => {
    if (beiNachricht) beiNachricht(n, derTab);
    return seite(n);
  };

  const angaben = { tab: derTab, seiteAntwortet: seiteMitHaken, panelAntwortet: panel };
  if (beiBild) angaben.bildDatenUrl = (a) => beiBild(a, derTab);

  const { spur } = attrappeSetzen(angaben);
  zaehlerNeu();
  const ergebnis = await befehlAusfuehren(rahmen, sitzung);
  return { ergebnis, spur, tab: derTab, gefragt: () => gefragt };
}

/** Alles, was an den Browser selbst ging. */
const anDenBrowser = (spur) => spur.filter((e) => String(e.wohin).startsWith("tabs.")).map((e) => e.wohin);

/** Hat dieser Befehl seinen eigenen Weg genommen? */
function tatGeschehen(spur, cmd) {
  const marke = TAT[cmd];
  return marke.startsWith("overlay:") ? anDieSeite(spur).includes(marke) : anDenBrowser(spur).includes(marke);
}

/** Jede Antwort ist ein Ergebnisrahmen mit derselben Kennung, auch im Sturz. */
function istErgebnisrahmen(ergebnis, id, cmd) {
  assert.equal(ergebnis.type, "result");
  assert.equal(ergebnis.id, id);
  assert.equal(ergebnis.cmd, cmd);
  assert.equal(typeof ergebnis.success, "boolean");
  if (ergebnis.success === false) assert.ok(ergebnis.error.message.length > 0);
}

/** Nirgends darf die neue Adresse stehen — weder im Rahmen noch im Protokoll. */
function nichtsVerraten(ergebnis, spur, wo) {
  const alles = JSON.stringify(ergebnis) + JSON.stringify(spur);
  assert.ok(!alles.includes(FREMDE_MARKE),
    `${wo}: die neue Adresse steht in der Antwort oder im Protokoll — die Ablehnung ist selbst das Leck`);
}

/* ------------------------------------------------------------------ *
 * 1. Der Befund selbst: das Bild
 * ------------------------------------------------------------------ */

test("Wache — Freigabe für Wirt A, bei der Aufnahme steht der Tab bei Wirt B", async () => {
  const { ergebnis, spur, gefragt } = await laufen(
    { id: "wa-1", cmd: "screenshot", screenshotReason: "canvas", reason: "Ich sehe mir die Seite an." },
    { beiFreigabe: (t) => { t.url = FREMD; } }
  );

  istErgebnisrahmen(ergebnis, "wa-1", "screenshot");
  assert.equal(gefragt(), true, "der Mensch wurde gefragt, sonst misst dieser Prüfsatz den falschen Zweig");
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "scope_violation_local");
  assert.equal(ergebnis.error.message, SATZ_ABGEWANDERT);
  assert.equal(ergebnis.error.retryable, false, "wiederholen hilft nicht, solange der Tab dort steht");
  assert.equal(ergebnis.data, undefined, "kein Bild im Rahmen");

  assert.ok(!anDenBrowser(spur).includes("tabs.captureVisibleTab"),
    "captureVisibleTab wurde gerufen, obwohl der Tab abgewandert war");
  nichtsVerraten(ergebnis, spur, "screenshot");
});

test("Wache — derselbe Wirt auf einer anderen Unterseite wird weiterhin aufgenommen", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "wa-2", cmd: "screenshot", screenshotReason: "canvas", reason: "Ich sehe mir die Seite an." },
    { beiFreigabe: (t) => { t.url = "https://geizhals.de/kasse"; t.title = "Kasse"; } }
  );

  assert.equal(ergebnis.success, true, "die Wache fängt zu viel: ein Unterseitenwechsel ist keine Abwanderung");
  assert.ok(ergebnis.data.image.dataB64.length > 0);
  assert.ok(anDenBrowser(spur).includes("tabs.captureVisibleTab"));
});

test("Wache — ist der Tab nach der Freigabe verschwunden, gibt es eine Aussage statt eines Sturzes", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "wa-3", cmd: "screenshot", screenshotReason: "canvas", reason: "Ich sehe mir die Seite an." },
    /* Die Kennung wechseln heißt für die Attrappe dasselbe wie für Chrome:
       Zu Tab 7 gibt es nichts mehr. */
    { beiFreigabe: (t) => { t.id = 999; } }
  );

  istErgebnisrahmen(ergebnis, "wa-3", "screenshot");
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "tab_gone");
  assert.equal(ergebnis.error.message, SATZ_TAB_WEG);
  assert.ok(!anDenBrowser(spur).includes("tabs.captureVisibleTab"));
});

test("Wache — kommt ein anderer Tab nach vorn, wird nicht fotografiert, aber weiter gelesen", async () => {
  /* Der Bildweg braucht den Vordergrund, weil `captureVisibleTab` immer den
     aktiven Tab des Fensters nimmt. Alles andere darf seit 0.5.2 im
     Hintergrund laufen — beides steht hier nebeneinander, damit aus dem Schutz
     des Bildes keine stille Rücknahme des Hintergrundbetriebs wird. */
  const bild = await laufen(
    { id: "wa-4", cmd: "screenshot", screenshotReason: "canvas", reason: "Ich sehe mir die Seite an." },
    { beiFreigabe: (t) => { t.active = false; } }
  );
  assert.equal(bild.ergebnis.success, false);
  assert.equal(bild.ergebnis.error.code, "tab_nicht_im_vordergrund");
  assert.equal(bild.ergebnis.error.message, SATZ_NICHT_VORN);
  assert.ok(!anDenBrowser(bild.spur).includes("tabs.captureVisibleTab"));

  const gelesen = await laufen(
    { id: "wa-5", cmd: "readPage", reason: "Ich lese die Seite." },
    { beiFreigabe: (t) => { t.active = false; } }
  );
  assert.equal(gelesen.ergebnis.success, true, "Lesen im Hintergrund bleibt erlaubt");
  assert.ok(gelesen.ergebnis.data.snapshot.text.length > 0);
});

test("Wache — auch zwischen zwei Stufen der Qualitätsleiter wird noch einmal hingesehen", async () => {
  /* Die erste Aufnahme ist zu groß, also nimmt der Ausführer gröber noch einmal
     auf. Genau in diesem Augenblick wandert der Tab ab: Die zweite Aufnahme
     darf es nicht mehr geben. */
  let aufnahmen = 0;
  const { ergebnis, spur } = await laufen(
    { id: "wa-6", cmd: "screenshot", screenshotReason: "empty_ax", reason: "Der Textbaum blieb leer." },
    {
      beiBild: (_angaben, t) => {
        aufnahmen += 1;
        t.url = FREMD;
        return `data:image/jpeg;base64,${"A".repeat(GRENZEN.bildZeichen + 10)}`;
      },
    }
  );

  assert.ok(GRENZEN.bildQualitaeten.length > 1, "ohne Leiter misst dieser Prüfsatz nichts");
  assert.equal(aufnahmen, 1, "es wurde ein zweites Mal fotografiert, nachdem der Tab abgewandert war");
  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "scope_violation_local");
  assert.equal(ergebnis.error.message, SATZ_ABGEWANDERT);
  nichtsVerraten(ergebnis, spur, "Qualitätsleiter");
});

/* ------------------------------------------------------------------ *
 * 2. Dasselbe Muster in ALLEN Befehlen
 *
 * Das Bild war der teuerste Fall, nicht der einzige. Jeder Befehl prüfte den
 * Bereich vor der Freigabe und benutzte den Tab danach. Deshalb wird hier
 * jeder einzeln durchgespielt — eine stellvertretende Prüfung ließe genau den
 * Zustand vom 11.08. zu, in dem einer gesichert ist und zwölf nicht.
 * ------------------------------------------------------------------ */

function rahmenFuer(cmd, marke) {
  return { id: `${marke}-${cmd}`, cmd, reason: "Ich mache das jetzt.", ...(VOLLSTAENDIG[cmd] || {}) };
}

function sitzungFuer(cmd) {
  return BEFEHLE[cmd].stufe === "write" ? { ...SITZUNG, stufe: "write" } : SITZUNG;
}

test("Wache — JEDER Befehl bricht ab, wenn der Tab nach der Freigabe abgewandert ist", async () => {
  const geprueft = [];
  for (const cmd of Object.keys(BEFEHLE)) {
    assert.ok(TAT[cmd], `${cmd}: für diesen Befehl fehlt hier der Nachweis, was seine Tat ist`);
    const { ergebnis, spur, gefragt } = await laufen(rahmenFuer(cmd, "wb"), {
      sitzung: sitzungFuer(cmd),
      beiFreigabe: (t) => { t.url = FREMD; },
    });

    istErgebnisrahmen(ergebnis, `wb-${cmd}`, cmd);
    assert.equal(gefragt(), true, `${cmd}: der Mensch wurde gar nicht gefragt`);
    assert.equal(ergebnis.success, false, `${cmd}: lief durch, obwohl der Tab abgewandert war`);
    assert.equal(ergebnis.error.code, "scope_violation_local", cmd);
    assert.equal(ergebnis.error.message, SATZ_ABGEWANDERT, cmd);

    assert.ok(!tatGeschehen(spur, cmd),
      `${cmd}: ${TAT[cmd]} hat die fremde Seite trotzdem erreicht`);
    /* Nicht einmal die Anzeige fährt über eine Seite, die nie freigegeben
       wurde: Die Wache steht VOR dem Arbeitszeiger. */
    assert.ok(!anDieSeite(spur).includes("overlay:arbeitszeiger"), cmd);
    nichtsVerraten(ergebnis, spur, cmd);
    geprueft.push(cmd);
  }
  assert.equal(geprueft.length, Object.keys(BEFEHLE).length);
  assert.ok(geprueft.length >= 13, "es sind weniger Befehle geprüft worden als erwartet");
});

test("Wache — JEDER Befehl läuft weiter, wenn nur die Unterseite gewechselt hat", async () => {
  /* Die Gegenprobe zum vorigen Prüfsatz. Ohne sie wäre eine Wache, die
     grundsätzlich ablehnt, ebenfalls grün. */
  for (const cmd of Object.keys(BEFEHLE)) {
    const { ergebnis, spur } = await laufen(rahmenFuer(cmd, "wc"), {
      sitzung: sitzungFuer(cmd),
      beiFreigabe: (t) => { t.url = "https://geizhals.de/kasse"; t.title = "Kasse"; },
    });

    assert.equal(ergebnis.success, true,
      `${cmd}: abgelehnt, obwohl derselbe Wirt nur eine andere Unterseite zeigt (${ergebnis.error && ergebnis.error.message})`);
    assert.ok(tatGeschehen(spur, cmd), `${cmd}: ${TAT[cmd]} hat gar nicht stattgefunden`);
  }
});

test("Wache — die Wahrnehmung trägt die Adresse, auf der der Tab beim Lesen wirklich steht", async () => {
  /* Kein Nebenschauplatz: Wenn der Kopf aus der Messung VOR der Freigabe
     stammt, liest der Agent eine Seite unter dem Namen einer anderen. */
  const { ergebnis } = await laufen(
    { id: "wd-1", cmd: "readPage", reason: "Ich lese die Seite." },
    { beiFreigabe: (t) => { t.url = "https://geizhals.de/kasse"; t.title = "Kasse"; } }
  );
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.data.snapshot.url, "https://geizhals.de/kasse");
  assert.equal(ergebnis.data.snapshot.title, "Kasse");
});

/* ------------------------------------------------------------------ *
 * 3. Wenn der Schritt selbst die Seite wechseln lässt
 *
 * Der Fall, den die Wache in der Befehlsschleife nicht sehen kann: Sie hat
 * gemessen, dann ist alles richtig, und ERST DANN bringt der eigene Klick die
 * Seite zum Wechseln. Die Wahrnehmung danach läse die neue Seite.
 * ------------------------------------------------------------------ */

test("Wache — ein Klick, der aus dem Bereich hinausführt, liefert keine Wahrnehmung der neuen Seite", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "we-1", cmd: "click", ref: "e2", snapshotEpoch: "s1.abcd", reason: "Ich klicke auf Zur Kasse." },
    {
      sitzung: { ...SITZUNG, stufe: "write" },
      beiNachricht: (n, t) => { if (n.typ === "overlay:klicken") t.url = FREMD; },
    }
  );

  /* Der Klick hat stattgefunden — ihn nachträglich als gescheitert zu melden
     wäre die schlimmere Falschaussage. Nur die Zugabe entfällt. */
  assert.equal(ergebnis.success, true);
  assert.equal(ergebnis.data.clicked.ref, "e2");
  assert.equal(ergebnis.data.snapshot, undefined,
    "die Wahrnehmung der neuen, nie freigegebenen Seite ging an die Cloud");
  assert.ok(!anDieSeite(spur).includes("overlay:baum"),
    "die fremde Seite wurde nicht einmal gefragt");
  nichtsVerraten(ergebnis, spur, "click");
});

test("Wache — eine Weiterleitung im Augenblick des Arbeitszeigers stoppt readPage", async () => {
  /* Die Wache der Befehlsschleife ist hier schon durch: Der Tab wandert erst
     ab, während der Zeiger fährt. Gefasst wird das allein von der Wache VOR
     der Wahrnehmung. */
  const { ergebnis, spur } = await laufen(
    { id: "we-2", cmd: "readPage", reason: "Ich lese die Seite." },
    { beiNachricht: (n, t) => { if (n.typ === "overlay:arbeitszeiger") t.url = FREMD; } }
  );

  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "scope_violation_local");
  assert.equal(ergebnis.error.message, SATZ_ABGEWANDERT);
  assert.ok(!anDieSeite(spur).includes("overlay:baum"),
    "die fremde Seite wurde gelesen");
  nichtsVerraten(ergebnis, spur, "readPage");
});

test("Wache — dasselbe für extract, das seinen Text ohne Wahrnehmung ausliefert", async () => {
  const { ergebnis, spur } = await laufen(
    { id: "we-3", cmd: "extract", refs: ["e2"], snapshotEpoch: "s1.abcd", reason: "Ich lese den Preis ab." },
    { beiNachricht: (n, t) => { if (n.typ === "overlay:arbeitszeiger") t.url = FREMD; } }
  );

  assert.equal(ergebnis.success, false);
  assert.equal(ergebnis.error.code, "scope_violation_local");
  assert.equal(ergebnis.error.message, SATZ_ABGEWANDERT);
  assert.ok(!anDieSeite(spur).includes("overlay:auslesen"),
    "von der fremden Seite wurde abgelesen");
  nichtsVerraten(ergebnis, spur, "extract");
});

test("Wache — auch nach scroll, type und select bleibt die Wahrnehmung der fremden Seite aus", async () => {
  const faelle = [
    { cmd: "scroll", rahmen: { direction: "down", amount: "page" }, tat: "overlay:scrollen" },
    { cmd: "type", rahmen: { ref: "e2", snapshotEpoch: "s1.abcd", text: "hallo" }, tat: "overlay:tippen" },
    { cmd: "select", rahmen: { ref: "e2", snapshotEpoch: "s1.abcd", value: "XL" }, tat: "overlay:auswaehlen" },
  ];
  for (const fall of faelle) {
    const { ergebnis, spur } = await laufen(
      { id: `we-4-${fall.cmd}`, cmd: fall.cmd, reason: "Ich mache das jetzt.", ...fall.rahmen },
      {
        sitzung: { ...SITZUNG, stufe: "write" },
        beiNachricht: (n, t) => { if (n.typ === fall.tat) t.url = FREMD; },
      }
    );

    assert.equal(ergebnis.success, true, fall.cmd);
    assert.equal(ergebnis.data.snapshot, undefined,
      `${fall.cmd}: die Wahrnehmung der fremden Seite ging trotzdem raus`);
    assert.ok(!anDieSeite(spur).includes("overlay:baum"), fall.cmd);
    nichtsVerraten(ergebnis, spur, fall.cmd);
  }
});
