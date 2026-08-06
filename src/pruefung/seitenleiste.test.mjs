/*
 * Prüfung der drei Befunde aus dem ersten echten Test des Inhabers
 * (28.07.2026).
 *
 * Was an dem Tag passiert ist: Die Seitenleiste war auf dem Tab
 * `cloud.smartragents.ai` offen. Der Verbindungsdialog bot dort sogar „Diese
 * Website (https://cloud.smartragents.ai)" als Geltungsbereich an — eine
 * Auswahl, die nach DRAHTFORMAT §7.3 garantiert scheitern muss. Nach
 * „Verbinden" kam eine rote Meldung, die klang, als hätte der Nutzer etwas
 * falsch gemacht. Daneben stand „Guthaben: —" ohne jede Erklärung.
 *
 * Drei Zusagen werden hier festgehalten:
 *
 *  1. Der gesperrte Ursprung wird VOR dem Dialog erkannt, mit Grund — und die
 *     drei möglichen Lagen (Regel Cloud, Regel Browser, Ablehnung durch den
 *     Menschen) haben drei unterscheidbare Sätze.
 *  2. Ein fehlender Ausweis führt zu einer Erklärung mit Weg, nie zu einem
 *     Strich.
 *  3. Die Oberfläche bietet nur an, was gebaut ist — „Bedienen" ist
 *     weggelassen, nicht ausgegraut.
 *
 * Zwei Arten von Prüfsätzen stehen in dieser Datei, und sie sind streng
 * getrennt:
 *
 *  - Was die Seitenleiste ANBIETET, steht in panel.html — dort ist die
 *    Textsuche der richtige Weg, denn das HTML ist die Aussage selbst.
 *  - Was die Seitenleiste TUT, wird gefahren: `panel.js` läuft ab dem
 *    Abschnitt „Die Seitenleiste im Betrieb" wirklich, in einem eigenen
 *    `document` — wie es overlay.test.mjs seit jeher für das Seitenskript tut.
 *    Der Grund steht dort ausführlich: Eine Textsuche belegt kein Verhalten.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, bevor net/* geladen wird: dienste.js liest beim
   Laden das Manifest. */
attrappeSetzen({ panelAntwortet: null });

const rechte = await import("../net/rechte.js");
const erklaerungen = await import("../panel/erklaerungen.js");

const quelle = await readFile(new URL("../panel/panel.js", import.meta.url), "utf8");
const html = await readFile(new URL("../panel/panel.html", import.meta.url), "utf8");

/* Ein Abschnitt des Quelltextes, von einer Funktion bis zur nächsten. So
   prüfen die Zusagen die Stelle, an der sie gelten, statt die ganze Datei. */
function abschnitt(anfang, ende) {
  const von = quelle.indexOf(anfang);
  assert.ok(von >= 0, `nicht gefunden: ${anfang}`);
  const bis = ende ? quelle.indexOf(ende, von) : -1;
  return quelle.slice(von, bis > von ? bis : undefined);
}

/* ------------------------------------------------------------------ *
 * Fehler 1 — der gesperrte Ursprung, früh und mit Grund
 * ------------------------------------------------------------------ */

test("sperrgrund unterscheidet die Regel der Cloud von der Regel des Browsers", () => {
  /* Der Freigabe-Ursprung selbst und jede Unterdomäne (DRAHTFORMAT §7.3). */
  assert.equal(rechte.sperrgrund("https://cloud.smartragents.ai/"), "cloud");
  assert.equal(rechte.sperrgrund("https://cloud.smartragents.ai/chat?x=1"), "cloud");
  assert.equal(rechte.sperrgrund("https://beta.cloud.smartragents.ai/"), "cloud");
  assert.equal(rechte.sperrgrund("https://CLOUD.SMARTRAGENTS.AI/"), "cloud");

  /* Alles, was dem Browser selbst gehört — anderer Satz, andere Lage. */
  assert.equal(rechte.sperrgrund("chrome://extensions"), "browser");
  assert.equal(rechte.sperrgrund("about:blank"), "browser");
  assert.equal(rechte.sperrgrund("file:///home/tongie/notiz.txt"), "browser");
  assert.equal(rechte.sperrgrund("chrome-extension://abcd/src/panel/panel.html"), "browser");
  assert.equal(rechte.sperrgrund("devtools://devtools/bundled/inspector.html"), "browser");
  assert.equal(rechte.sperrgrund(""), "browser");
  assert.equal(rechte.sperrgrund(null), "browser");

  /* Eine ganz gewöhnliche Seite ist nicht gesperrt. */
  assert.equal(rechte.sperrgrund("https://geizhals.de/warenkorb"), null);
  assert.equal(rechte.sperrgrund("http://localhost:5173/"), null);

  /* Eine Domain, die den gesperrten Namen nur enthält, ist nicht er selbst. */
  assert.equal(rechte.sperrgrund("https://cloud.smartragents.ai.beispiel.de/"), null);
});

test("istGesperrterUrsprung bleibt genau die Ja/Nein-Frage zu sperrgrund", () => {
  for (const url of [
    "https://cloud.smartragents.ai/",
    "https://beta.cloud.smartragents.ai/",
    "chrome://extensions",
    "file:///tmp/x",
    "about:blank",
    "",
    "https://geizhals.de/warenkorb",
    "http://localhost:5173/",
  ]) {
    assert.equal(
      rechte.istGesperrterUrsprung(url),
      rechte.sperrgrund(url) !== null,
      `zwei Antworten auf dieselbe Sperre: ${url}`
    );
  }
});

test("Die Bereichsauswahl bietet den gesperrten Host nie als Ziel an", () => {
  assert.equal(rechte.bereichHost("https://cloud.smartragents.ai"), "");
  assert.equal(rechte.bereichHost("https://beta.cloud.smartragents.ai"), "");
  assert.equal(rechte.bereichHost("chrome://extensions"), "");
  assert.equal(rechte.bereichHost(""), "");
  assert.equal(rechte.bereichHost("https://Geizhals.DE"), "geizhals.de");

  /* Und der Vorschlag der Seitenleiste holt seinen Host genau dort — nicht
     mehr direkt aus der URL, wo die Sperre fehlen könnte. */
  const vorschlag = abschnitt("function geltungsbereichVorschlag", "function klartextVon");
  assert.ok(vorschlag.includes("rechte.bereichHost(zustand.ursprung)"));
  assert.ok(
    !vorschlag.includes("new URL(zustand.ursprung).hostname"),
    "der Host darf nicht an der Sperre vorbei gebildet werden"
  );
});

test("Die drei Fälle haben drei unterscheidbare Sätze — und keiner macht einen Vorwurf", () => {
  const cloud = erklaerungen.SPERRE.cloud;
  const browser = erklaerungen.SPERRE.browser;
  const abgelehnt = erklaerungen.FREIGABE_ABGELEHNT;

  const texte = [cloud.text, browser.text, abgelehnt.text];
  assert.equal(new Set(texte).size, 3, "drei Lagen brauchen drei Sätze");
  assert.equal(
    new Set([cloud.titel, browser.titel, abgelehnt.titel]).size,
    3,
    "drei Lagen brauchen drei Überschriften"
  );

  /* Die Cloud-Sperre wird als Absicht erklärt, nicht als Panne — und sie sagt,
     was der Mensch stattdessen tun kann. */
  assert.match(cloud.text, /Absicht/);
  assert.match(cloud.text, /selbst eine Freigabe erteilen/);
  assert.match(cloud.text, /anderen Tab/);

  /* Die Browser-Seiten bekommen ihren eigenen Satz. */
  assert.match(browser.text, /gehört dem Browser selbst/);

  /* Und die Ablehnung bleibt eine Entscheidung des Menschen. */
  assert.match(abgelehnt.text, /abgelehnt/);
  assert.match(abgelehnt.text, /das ist in Ordnung/i);
  assert.match(abgelehnt.text, /neu versuchen/);

  /* Kein Satz nennt sich Fehler oder Störung: Zwei davon sind Regeln, der
     dritte ist eine Entscheidung. */
  for (const t of texte) {
    assert.ok(!/fehler|störung|ungültig/i.test(t), `klingt nach Defekt: ${t}`);
  }

  /* Der alte Pauschalsatz ist restlos weg. */
  assert.ok(
    !quelle.includes("Ohne die Freigabe für diese Seite kann ich nichts anzeigen"),
    "der Satz vom 28.07. darf nicht mehr im Quelltext stehen"
  );
});

test("panel.js: Die Sperre wird geprüft, BEVOR der Dialog erscheint", () => {
  const dialog = abschnitt("async function dialogVorbereiten", "/* ------");
  const beiSperrgrund = dialog.indexOf("rechte.sperrgrund");
  const beimDialog = dialog.indexOf('setzeZustand("dialog")');
  const beimUrsprung = dialog.indexOf('$("ursprung").textContent');
  assert.ok(beiSperrgrund >= 0, "dialogVorbereiten muss den Ursprung prüfen");
  assert.ok(beimDialog > beiSperrgrund, "erst prüfen, dann den Dialog zeigen");
  assert.ok(
    beimUrsprung > beiSperrgrund,
    "der gesperrte Host darf nie in die Bereichsauswahl geschrieben werden"
  );
  assert.ok(dialog.includes("erklaerkarteZeigen(SPERRE"), "gesperrt = Erklärung, nicht Dialog");

  /* Und die Erklärung geht nicht durch die rote Störungszeile. */
  const karte = abschnitt("function erklaerkarteZeigen", "/* ------");
  assert.ok(karte.includes("stoerung(null)"), "die Erklärkarte räumt eine alte Störung weg");
  assert.ok(karte.includes("ansagen("), "die Erklärung wird vorgelesen");
});

test("panel.js: Verbinden prüft die Sperre vor der Chrome-Abfrage", () => {
  const verbinden = abschnitt("async function verbinden()", "function zweckText");
  const beiSperrgrund = verbinden.indexOf("rechte.sperrgrund");
  const beiRechten = verbinden.indexOf("seitenrechteHolen()");
  assert.ok(beiSperrgrund >= 0 && beiSperrgrund < beiRechten, "erst die Regel, dann Chrome fragen");
  /* Erst wenn die Sperre ausgeschlossen ist, heißt ein Nein von Chrome wirklich
     „der Mensch hat abgelehnt". */
  assert.ok(verbinden.includes("erklaerkarteZeigen(FREIGABE_ABGELEHNT"));
});

/* ------------------------------------------------------------------ *
 * Fehler 2 — der fehlende Ausweis erklärt sich
 * ------------------------------------------------------------------ */

test("Fehlender Ausweis: Erklärung mit Weg statt eines Strichs", () => {
  for (const lage of ["laedt", "uebergabe_fehlt", "keine_anmeldung"]) {
    const text = erklaerungen.GUTHABEN_LAGETEXT[lage];
    assert.ok(text, `keine Auskunft für die Lage ${lage}`);
    assert.ok(!text.includes("—"), `ein Strich ist keine Auskunft: ${text}`);
  }
  assert.equal(
    new Set(Object.values(erklaerungen.GUTHABEN_LAGETEXT)).size,
    3,
    "drei Lagen, drei Auskünfte"
  );

  /* „angemeldet, aber Übergabe fehlt" ist etwas anderes als „nicht
     angemeldet" — und nur der erste Fall wird durch ein Neuladen gelöst. */
  const uebergabe = erklaerungen.AUSWEIS_FEHLT.uebergabe_fehlt;
  const keine = erklaerungen.AUSWEIS_FEHLT.keine_anmeldung;
  assert.notEqual(uebergabe.text, keine.text);
  assert.match(uebergabe.text, /noch nicht/);
  assert.match(uebergabe.text, /neu \(F5\)|F5/);
  assert.match(uebergabe.knopf, /neu laden/i);
  assert.match(keine.text, /Anmelde/i);

  /* Die Guthabenzeile zeigt die Lage, nicht den Strich. */
  const anzeigen = abschnitt("function guthabenAnzeigen", "/*");
  assert.ok(anzeigen.includes("GUTHABEN_LAGETEXT[guthabenLage]"));
  assert.ok(!anzeigen.includes("—"), "in der Guthabenzeile steht kein Strich mehr");
  assert.ok(!html.includes("Guthaben: — GT"), "auch nicht als Anfangswert im HTML");
});

test("panel.js: Die Lage wird am offenen Cloud-Tab unterschieden, ohne in ihn hineinzusehen", () => {
  const finden = abschnitt("async function cloudTabFinden", "/*");
  assert.ok(finden.includes("chrome.tabs.query"), "der offene Tab wird gesucht …");
  assert.ok(finden.includes("CLOUD_URSPRUNG"), "… und zwar am Cloud-Ursprung");
  assert.ok(
    !quelle.includes("chrome.scripting") && !quelle.includes("executeScript"),
    "in den Cloud-Ursprung wird nie hineingesehen (DRAHTFORMAT §7.3)"
  );

  const erklaeren = abschnitt("async function ausweisFehltErklaeren", "async function cloudTabNeuLaden");
  assert.ok(erklaeren.includes("AUSWEIS_FEHLT[guthabenLage]"));
  assert.ok(erklaeren.includes('setzeZustand("anmeldung")'), "ohne Cloud-Tab: die Anmeldekarte");
  assert.ok(erklaeren.includes("cloudTabNeuLaden"), "mit Cloud-Tab: der Knopf, der ihn neu lädt");
  assert.ok(
    erklaeren.includes("zustand.sitzung"),
    "eine laufende Sitzung wird nie von einer Erklärung überblendet"
  );

  /* Neu laden braucht kein Skriptrecht — es lädt die Seite, es liest sie nicht. */
  const neuLaden = abschnitt("async function cloudTabNeuLaden", "async function guthabenLaden");
  assert.ok(neuLaden.includes("chrome.tabs.reload"));
  assert.ok(!neuLaden.includes("permissions.request"));
});

test("panel.js: Kommt der Ausweis herüber, wird das Guthaben in jedem Zustand nachgeladen", () => {
  const block = abschnitt('n.typ === "konto:ausweis"', 'n.typ === "konto:abgemeldet"');
  assert.ok(
    !block.includes('n.typ === "konto:ausweis" && app.dataset.state === "anmeldung"'),
    "die Übernahme darf nicht mehr an der Anmeldemaske hängen"
  );
  assert.ok(block.includes("guthabenLaden()"), "nach der Übernahme wird das Guthaben nachgeholt");
});

/* ------------------------------------------------------------------ *
 * Fehler 3 — angeboten wird nur, was gebaut ist.
 * Seit dem 29.07.2026 ist BEIDES gebaut (E16 + Ausführer click/type):
 * Die Auswahlen sind zurück und versprechen nichts, was gekürzt wird.
 * ------------------------------------------------------------------ */

test("panel.html: Stufe und Dauer sind echte Auswahlen — beide Stufen sind gebaut", () => {
  assert.ok(html.includes('name="stufe"'), "die Stufenauswahl gibt es wieder");
  assert.ok(html.includes('value="write"'), "Bedienen wird angeboten");
  assert.ok(html.includes('value="read"'), "Zusehen bleibt die Vorgabe");
  assert.match(html, /name="stufe" value="read" checked/, "vorausgewählt ist die schwächste Stufe");
  assert.match(html, /Bedienen/);

  assert.ok(html.includes('name="dauer"'), "die Dauerauswahl gibt es wieder");
  const sichtbar = html.replace(/<!--[\s\S]*?-->/g, "");
  assert.match(sichtbar, /10 Minuten/);
  assert.match(sichtbar, /30 Minuten/);
  assert.match(sichtbar, /60 Minuten/);
  assert.match(sichtbar, /Unbegrenzt/);
  assert.match(html, /name="dauer" value="600" checked/, "vorausgewählt ist die kürzeste Dauer");

  /* Die Zusagen, die in jeder Stufe gelten. */
  assert.match(html, /Jeden Schritt bestätigst du einzeln/);
  assert.match(html, /Anmelden machst du selbst/);
  assert.match(html, /<strong>Nur dieser eine Tab<\/strong>/);
});

test("panel.js: Antrag, Zusammenfassung und Auswahl sind EINE Wahrheit", () => {
  assert.ok(quelle.includes('gewaehlt("dauer")'), "die Dauer kommt aus der Auswahl");
  assert.ok(quelle.includes('gewaehlt("stufe")'), "die Stufe kommt aus der Auswahl");
  assert.ok(!quelle.includes('gewaehlt("bereich")'), "der Bereich bleibt fest: nur dieser Tab");

  const vorschlag = abschnitt("function geltungsbereichVorschlag", "function klartextVon");
  assert.ok(vorschlag.includes("access: gewaehlteStufe()"));
  assert.ok(vorschlag.includes("duration: dauer.sekunden"));
  assert.ok(vorschlag.includes('mode: "tab"'));

  /* Was der Dialog zusammenfasst, muss dasselbe sein, was er beantragt —
     sonst ist die Zusammenfassung eine zweite Wahrheit. */
  const fassung = abschnitt("function zusammenfassen", "async function dialogVorbereiten");
  assert.ok(fassung.includes("gewaehlteDauer()"));
  assert.ok(fassung.includes("in diesem einen Tab"));

  /* „Unbegrenzt" ist Verlängerung durch die Erweiterung, keine Sitzung ohne
     Ende: Der Antrag trägt immer eine endliche Dauer. */
  assert.ok(quelle.includes("VERLAENGERUNGS_DAUER"));
  assert.ok(quelle.includes("verlaengern"), "die Verlängerung existiert");
  assert.ok(quelle.includes('typ: "link:verlaengern"'), "und läuft über den Service Worker");
});

test("panel.js: die Sitzung wird an den Agenten gebunden (G4)", () => {
  assert.ok(quelle.includes("/api/v1/link/session/bind"), "der Bind-Aufruf existiert");
  const bindung = abschnitt("async function agentenBindung", "function zweckText");
  assert.ok(bindung.includes("browserKontext"));
  /* Während einer gebundenen Sitzung gehen Fragen an den Browser-Auftrag. */
  assert.ok(quelle.includes("anBrowser ? zustand.browserKontext : zustand.chatKontext"));
  /* Der write-Anzeigetext bleibt vollständig. */
  assert.ok(quelle.includes("write:"), "STUFENTEXT.write bleibt bestehen");
  assert.ok(quelle.includes('gewuenscht.access === "write"'), "zweckText kennt write weiter");
});


/* ================================================================== *
 * Die Seitenleiste im Betrieb
 *
 * Warum dieser Abschnitt anders aussieht als der obige: Die Befunde aus dem
 * Auftragsweg (29.07.2026) sind Zusagen über VERHALTEN — „ein Nein beendet
 * den Schritt und nicht die Sitzung", „die Wartezeile ist weg, bevor auf
 * irgendetwas gewartet wird". Solche Sätze lassen sich im Quelltext nicht
 * belegen. Die Gegenlesung hat es vorgeführt: Fünf plausible
 * Verschlechterungen liefen durch die Textsuchen, die hier vorher standen,
 * ohne dass ein Satz rot wurde. Eine Prüfung, die auch ohne den Fix grün
 * bleibt, ist keine.
 *
 * Also läuft `panel.js` hier wirklich — in einem eigenen `document`, wie es
 * overlay.test.mjs seit jeher für das Seitenskript tut. Die Attrappe bildet
 * nur nach, was die Seitenleiste wirklich anfasst, und ist an zwei Stellen
 * absichtlich streng:
 *
 *  - `getElementById` kennt ausschließlich Kennungen, die in panel.html
 *    wirklich stehen. Eine Attrappe, die jedes Element erfindet, prüfte die
 *    Seitenleiste gegen eine Seite, die es nicht gibt.
 *  - Jeder Weg zum Hintergrunddienst wird mitgeschrieben. Damit lässt sich
 *    prüfen, was NICHT passiert ist — dass ein Nein zu einem Schritt keine
 *    Trennung auslöst.
 *
 * Ersetzt werden nur die Einfuhrzeilen; alles andere an panel.js läuft
 * unverändert. Was die Attrappe nicht kann, kann sie sichtbar nicht: Layout,
 * Bildschirmleser und Stimme bleiben Sache des Handlaufs am Gerät.
 * ================================================================== */

const befehle = await import("../net/befehle.js");

/* Nur Kennungen, die panel.html wirklich trägt. */
const IDS_IM_HTML = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((t) => t[1]));

/* Und welche davon im HTML das Attribut `hidden` tragen, also beim Laden
   unsichtbar sind.
 *
 * Warum das hier stehen muss: Die Attrappe gab jedem frisch erfundenen Element
 * `hidden = false` mit — unabhängig davon, was in panel.html steht. Damit war
 * jede Zusage der Form „das wird erst gezeigt, wenn …" unprüfbar, denn der
 * Ausgangszustand war schon der gezeigte. Aufgefallen am 06.08.2026 beim
 * Umzug von #vorfuehrung aus #leer heraus: Der erste Prüfsatz maß die
 * Attrappe statt der Seitenleiste. */
const VERSTECKT_IM_HTML = new Set(
  [...html.matchAll(/<[a-zA-Z][^>]*>/g)]
    .map((t) => t[0])
    .filter((tag) => /\shidden(?=[\s/>])/.test(tag))
    .map((tag) => /\sid="([^"]+)"/.exec(tag)?.[1])
    .filter(Boolean)
);
assert.ok(VERSTECKT_IM_HTML.has("dialog"), "Gegenprobe: der Dialog ist im HTML verborgen");
assert.ok(!VERSTECKT_IM_HTML.has("leer"), "Gegenprobe: der Leerzustand ist es nicht");

/* Steuerzeichen, Nullbreiten und Schreibrichtungsmarken — der billigste Weg,
   ein Protokoll oder einen Vorleser etwas anderes sagen zu lassen, als dasteht.
   Aus Zahlen gebaut, damit in dieser Datei kein einziges davon wirklich steht. */
const steuerzeichenDrin = (text) =>
  [...String(text)].some((z) => {
    const c = z.codePointAt(0);
    return c < 32 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f);
  });

/* Ein Element des Seitenbaums. `textContent` verhält sich wie im Browser:
   Setzen wirft die Kinder weg, Lesen setzt sie wieder zusammen — sonst ließe
   sich `protokollieren()` (Kopf als <strong>, Rest als Text) nicht lesen. */
function knoten(tag = "div", id = "") {
  const el = {
    tagName: String(tag).toUpperCase(),
    id,
    kinder: [],
    _text: "",
    dataset: {},
    style: {},
    attribute: {},
    zuhoerer: new Map(),
    hidden: false,
    disabled: false,
    value: "",
    placeholder: "",
    className: "",
    fokusse: 0,
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
    append(...teile) {
      for (const t of teile) el.kinder.push(t);
    },
    replaceChildren(...teile) {
      el.kinder.length = 0;
      for (const t of teile) el.kinder.push(t);
    },
    querySelector: () => null,
    closest: () => null,
    focus() {
      el.fokusse += 1;
    },
    scrollIntoView() {},
    addEventListener(art, f) {
      if (!el.zuhoerer.has(art)) el.zuhoerer.set(art, []);
      el.zuhoerer.get(art).push(f);
    },
    /* Was ein Klick auslöst — samt der Rückgabe jedes Zuhörers, damit ein
       asynchroner Zuhörer abgewartet werden kann. */
    ausloesen(art, ereignis = {}) {
      return (el.zuhoerer.get(art) || []).map((f) => f({ target: el, ...ereignis }));
    },
  };
  Object.defineProperty(el, "textContent", {
    get: () => el._text + el.kinder.map((k) => (typeof k === "string" ? k : k.textContent)).join(""),
    set(wert) {
      el._text = String(wert);
      el.kinder.length = 0;
    },
  });
  Object.defineProperty(el, "childElementCount", {
    get: () => el.kinder.filter((k) => typeof k !== "string").length,
  });
  return el;
}

/* Die Einfuhrzeilen durch Attrappen ersetzen. Eine neue Einfuhr, für die hier
   nichts bereitsteht, lässt den Lauf scheitern — stillschweigend `undefined`
   einzusetzen hieße, eine Prüfung gegen eine Seitenleiste zu fahren, die es so
   nicht gibt. */
const EINFUHR_ZEILE =
  /^import\s+(?:(\*\s+as\s+([A-Za-z_$][\w$]*))|(\{[\s\S]*?\})|([A-Za-z_$][\w$]*))\s+from\s+"([^"]+)";$/gm;

/* Der Anhang holt heraus, was `const` im Skript sonst verschlösse. Fehlt einer
   der Namen, scheitert der Lauf laut — das ist erwünscht. */
const ANHANG = `
;globalThis.__seitenleiste = {
  zustand, sitzungAnzeigen, agentenBindung, beenden, schrittZeigen, antwortfristMs,
  chatWartenZeigen, PLATZHALTER_TAB, PLATZHALTER_GESPRAECH, setzeZustand,
};
`;

function alsSkript(quelltext, einfuhr) {
  const umgebaut = quelltext.replace(
    EINFUHR_ZEILE,
    (_treffer, _stern, name, klammer, standard, pfad) => {
      assert.ok(Object.hasOwn(einfuhr, pfad), `keine Attrappe für ${pfad}`);
      const ziel = `__einfuhr[${JSON.stringify(pfad)}]`;
      if (name) return `const ${name} = ${ziel};`;
      if (klammer) return `const ${klammer.replace(/\s+/g, " ")} = ${ziel};`;
      return `const ${standard} = ${ziel}.default;`;
    }
  );
  assert.ok(!/^import\s/m.test(umgebaut), "eine neue Einfuhrzeile ist ungeprüft geblieben");
  return umgebaut + ANHANG;
}

/**
 * Die Seitenleiste starten und in Betrieb nehmen.
 *
 * Nach der Rückkehr ist der Start durch: Zustandsfrage an den Dienst,
 * Guthaben, Gesprächszustand. Was danach passiert, hat der Test ausgelöst.
 */
async function panelStarten({
  ausweis = { token: "ausweis-fuer-die-pruefung", name: "Prüfung" },
  workerAntworten = {},
  bindKontext = "browser-kontext-1",
  bindFehler = false,
  tab = { id: 7, url: "https://geizhals.de/warenkorb", title: "Warenkorb" },
  /* Der Inhalt von chrome.storage.local beim Start — so sieht die
     Seitenleiste aus, die eben wieder geöffnet wurde. */
  speicher = {},
} = {}) {
  const spur = []; // an den Hintergrunddienst
  const anTabSpur = []; // an das Seitenskript
  const bindSpur = []; // an das Gateway (nur /bind)
  const gesprochen = []; // was die Stimme wirklich gesagt hat
  const uhren = new Set();
  const hoerer = [];
  const elemente = new Map();
  let heutigerAusweis = ausweis;

  const vorleseKnoepfe = [...html.matchAll(/data-vorlesen="([^"]+)"/g)].map((t) => {
    const k = knoten("button");
    k.dataset.vorlesen = t[1];
    return k;
  });

  /* Die Ablage dieses Geräts. Früher stand hier eine Attrappe, die auf jedes
     `get` ein leeres Objekt gab und jedes `set` verschluckte — mit ihr wäre
     jede Zusage über „die Wahl übersteht das Schließen" unprüfbar gewesen,
     denn nichts, was gemerkt wird, käme je zurück. */
  const ablage = { ...speicher };
  const selektoren = []; // jede Abfrage an document.querySelector, im Wortlaut

  /* Die Auswahlfelder des Dialogs, aus panel.html gelesen — mit echtem
     Gruppenverhalten: Wer eines auf `checked` setzt, nimmt den Haken bei allen
     Geschwistern desselben Namens weg. Ohne dieses Verhalten hinterließe eine
     wiederhergestellte Wahl zwei gesetzte Knöpfe gleichzeitig, `gewaehlt()`
     träfe den erstbesten — und der Prüfsatz bemerkte den Fehler nicht. */
  const radioFelder = [];
  for (const t of html.matchAll(/<input type="radio" name="([^"]+)" value="([^"]+)"( checked)?>/g)) {
    const feld = { name: t[1], value: t[2], _checked: !!t[3] };
    Object.defineProperty(feld, "checked", {
      get: () => feld._checked,
      set(an) {
        feld._checked = !!an;
        if (an) {
          for (const g of radioFelder) if (g !== feld && g.name === feld.name) g._checked = false;
        }
      },
    });
    radioFelder.push(feld);
  }
  assert.ok(radioFelder.length >= 6, "panel.html muss Dauer- und Stufenauswahl tragen");

  const doc = {
    getElementById(id) {
      assert.ok(IDS_IM_HTML.has(id), `panel.html kennt kein Element mit der Kennung „${id}"`);
      if (!elemente.has(id)) {
        const neu = knoten("div", id);
        /* Der Ausgangszustand kommt aus panel.html, nicht aus der Attrappe. */
        neu.hidden = VERSTECKT_IM_HTML.has(id);
        elemente.set(id, neu);
      }
      return elemente.get(id);
    },
    createElement: (tag) => knoten(tag),
    querySelectorAll: (wahl) => (wahl === "[data-vorlesen]" ? vorleseKnoepfe : []),
    querySelector: (wahl) => {
      /* Jeder Selektor wird mitgeschrieben. Nur so lässt sich prüfen, was
         GAR NICHT erst gebaut wurde: Ein Wert aus der Ablage, den die
         Seitenleiste ablehnt, darf nicht einmal als Selektor entstehen.
         Diese Attrappe ist strenger als ein Browser und würde eine
         Selektorliste ohnehin nicht auflösen — sie kann also nicht zeigen,
         dass eine Einschleusung wirkungslos BLIEBE. Sie kann nur zeigen,
         dass es keinen Versuch gab, und genau das ist die Zusage. */
      selektoren.push(String(wahl));
      const angehakt = /^input\[name="([^"]+)"\]:checked$/.exec(wahl);
      if (angehakt) return radioFelder.find((r) => r.name === angehakt[1] && r.checked) || null;
      /* Der Weg, auf dem eine gemerkte Wahl wiederhergestellt wird. Gibt es
         den Wert nicht, kommt `null` zurück — genau wie im Browser, und genau
         das braucht auswahlSetzen() für seinen fail-closed-Ausgang. */
      const nachWert = /^input\[name="([^"]+)"\]\[value="([^"]+)"\]$/.exec(wahl);
      if (nachWert) {
        return radioFelder.find((r) => r.name === nachWert[1] && r.value === nachWert[2]) || null;
      }
      return null;
    },
    addEventListener() {},
  };

  const uhrMerken = (kennung) => {
    uhren.add(kennung);
    return kennung;
  };

  const sandbox = {
    console,
    URL,
    AbortController,
    document: doc,
    setTimeout: (f, ms, ...rest) => uhrMerken(setTimeout(f, ms, ...rest)),
    clearTimeout: (k) => {
      uhren.delete(k);
      clearTimeout(k);
    },
    setInterval: (f, ms, ...rest) => uhrMerken(setInterval(f, ms, ...rest)),
    clearInterval: (k) => {
      uhren.delete(k);
      clearInterval(k);
    },
    performance: { now: () => Date.now() },
    speechSynthesis: {
      /* `cancel()` bricht ab, was gerade gesprochen wird — genau der Schaden,
         den eine Ansage über eine offene Frage anrichtet. Er wird gezählt. */
      abbrueche: 0,
      cancel() {
        sandbox.speechSynthesis.abbrueche += 1;
      },
      speak(a) {
        gesprochen.push(a.text);
      },
    },
    SpeechSynthesisUtterance: class {
      constructor(text) {
        this.text = text;
      }
    },
    chrome: {
      runtime: {
        onMessage: { addListener: (f) => hoerer.push(f) },
        async sendMessage(nachricht) {
          spur.push(nachricht);
          if (Object.hasOwn(workerAntworten, nachricht.typ)) return workerAntworten[nachricht.typ];
          return { ok: true };
        },
      },
      tabs: {
        async query(angaben) {
          /* Die Suche nach dem Cloud-Tab trägt eine Adresse; die nach dem
             aktiven Tab nicht. Ein Cloud-Tab ist hier nie offen. */
          return angaben && angaben.url ? [] : [tab];
        },
        async sendMessage(tabId, nachricht) {
          anTabSpur.push(nachricht);
          /* Das Seitenskript antwortet auf `overlay:lesen` mit dem, was es
             gefunden hat — der Beispielauftrag hängt daran. */
          if (nachricht.typ === "overlay:lesen") {
            return {
              ok: true,
              elemente: [
                { name: "Zur Kasse", rolle: "button", mitte: { x: 10, y: 20 }, rect: {} },
              ],
            };
          }
          return { ok: true };
        },
        async update() {},
        async reload() {},
      },
      storage: {
        local: {
          async get(schluessel) {
            const raus = {};
            for (const s of [].concat(schluessel ?? Object.keys(ablage))) {
              if (Object.hasOwn(ablage, s)) raus[s] = ablage[s];
            }
            return raus;
          },
          async set(werte) {
            Object.assign(ablage, werte);
          },
        },
        session: { async get() { return {}; }, async set() {}, async remove() {} },
      },
      permissions: {
        async request() { return true; },
        async remove() { return true; },
        async getAll() { return { origins: [] }; },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};

  const einfuhr = {
    "../net/konto.js": {
      async ausweisBesorgen() {
        return heutigerAusweis;
      },
      async ausweisVerwerfen() {
        heutigerAusweis = null;
      },
      async anmeldeseiteOeffnen() {},
      ausweisBeschreiben: () => "Angemeldet für die Prüfung.",
    },
    "../net/ticket.js": {
      buchstabiert: (wort) => String(wort).split("").join(" "),
      async freigabeDurchlaufen() {
        return { ticket: "ticket-attrappe" };
      },
      async freigabeseiteOeffnen() {},
    },
    "../net/rechte.js": rechte,
    "../net/chat.js": {
      CHAT_KLIENT: "smartrchrome-app",
      async guthabenHolen() {
        return { balance: 12345 };
      },
      async verlaufLaden() {
        return [];
      },
      async aktiveHolen() {
        return [];
      },
    },
    "../net/dienste.js": {
      CLOUD_URSPRUNG: "https://cloud.smartragents.ai",
      async anfragen(pfad, angaben) {
        bindSpur.push({ pfad, angaben });
        if (bindFehler) throw new Error("bind_fehlgeschlagen");
        return { context_id: bindKontext };
      },
    },
    "./erklaerungen.js": erklaerungen,
    /* Die Befehlstabelle steht bereit, obwohl die Seitenleiste sie seit dem
       Fix an der Restzeit nicht mehr einführt: Holt jemand die geratene Zahl
       zurück, soll die Prüfung an der Zahl scheitern (V6) und nicht schon am
       Laden — eine Fehlermeldung, die den Befund nennt, ist mehr wert als eine
       aufgeräumte Attrappe. */
    "../net/befehle.js": befehle,
  };
  sandbox.__einfuhr = einfuhr;

  vm.createContext(sandbox);
  vm.runInContext(alsSkript(quelle, einfuhr), sandbox, { filename: "panel.js" });

  const inneres = sandbox.__seitenleiste;
  assert.ok(inneres, "panel.js muss sich starten lassen");

  /* Ein Durchlauf der Warteschlange: Danach ist der Start der Seitenleiste
     durch (Zustandsfrage, Guthaben, Gesprächszustand). */
  const gleich = () => new Promise((f) => setTimeout(f, 0));
  await gleich();
  await gleich();

  const el = (id) => doc.getElementById(id);

  return {
    zustand: inneres.zustand,
    f: inneres,
    el,
    gesprochen,
    /* Was auf diesem Gerät gemerkt ist — der Stand NACH allem, was der Test
       ausgelöst hat. */
    ablage,
    selektoren,
    /* Eine Auswahl treffen wie ein Mensch: Haken setzen, dann das
       change-Ereignis des Dialogs auslösen. Beides gehört zusammen; wer nur
       den Haken setzt, prüft an der Bedienung vorbei. */
    async waehlen(name, wert) {
      const feld = radioFelder.find((r) => r.name === name && r.value === wert);
      assert.ok(feld, `panel.html bietet ${name}=${wert} nicht an`);
      feld.checked = true;
      await Promise.all(el("dialog").ausloesen("change", { target: feld }));
    },
    gewaehlt: (name) => radioFelder.find((r) => r.name === name && r.checked)?.value ?? null,
    /* Eine Freigabefrage stellen, wie der Ausführer sie stellt. Die Zusage
       lautet: Es gibt keinen Weg, auf dem die Seitenleiste stumm bleibt. */
    frageStellen(nachricht) {
      return new Promise((fertig, scheitern) => {
        const wecker = uhrMerken(
          setTimeout(() => scheitern(new Error(`keine Antwort auf ${nachricht.typ}`)), 5000)
        );
        for (const h of hoerer) {
          h(nachricht, {}, (antwort) => {
            uhren.delete(wecker);
            clearTimeout(wecker);
            /* Chrome kopiert jede Nachricht zwischen den Welten; der Umweg
               über JSON bildet das nach — und macht die Antwort mit dem
               gewöhnlichen Vergleich prüfbar, obwohl sie aus dem eigenen
               Kontext der Seitenleiste stammt. */
            fertig(JSON.parse(JSON.stringify(antwort)));
          });
        }
      });
    },
    /* Eine gewöhnliche Meldung des Dienstes an die Seitenleiste. */
    melden(nachricht) {
      for (const h of hoerer) h(nachricht, {}, () => {});
    },
    async klick(id) {
      await Promise.all(el(id).ausloesen("click"));
    },
    /* Eine laufende Sitzung, so wie der Server sie erteilt. Der Tab steht
       vorher fest — beim echten Weg setzt ihn der Verbindungsdialog, und ohne
       ihn ginge nichts an das Seitenskript. */
    async sitzungHerstellen(anders = {}) {
      inneres.zustand.tabId = tab.id;
      inneres.zustand.ursprung = new URL(tab.url).origin;
      inneres.zustand.ursprungMuster = `${new URL(tab.url).origin}/*`;
      await inneres.sitzungAnzeigen({
        stufe: "write",
        code: "AB12CD",
        endetUm: Date.now() + 600000,
        modus: "tab",
        bereich: ["geizhals.de"],
        schrittmodus: "confirm_each",
        ...anders,
      });
    },
    protokoll: () => el("protokoll").kinder.map((k) => k.textContent),
    verlauf: () => el("verlauf").kinder.map((k) => k.textContent),
    anWorker: () => spur.map((n) => n.typ),
    /* Dieselbe Spur mit allen Feldern — für Zusagen über das, was MITREIST
       (z. B. der Antwortmodus an chat:senden), nicht nur über den Typ. */
    anWorkerVoll: () => spur.map((n) => ({ ...n })),
    anTab: () => anTabSpur.map((n) => n.typ),
    bindAufrufe: () => bindSpur,
    spurLeeren: () => {
      spur.length = 0;
      bindSpur.length = 0;
      gesprochen.length = 0;
    },
    stimmabbrueche: () => sandbox.speechSynthesis.abbrueche,
    aufraeumen() {
      for (const k of uhren) {
        clearTimeout(k);
        clearInterval(k);
      }
      uhren.clear();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Die fünf Befunde aus dem Auftragsweg (29.07.2026) — gefahren.
 * ------------------------------------------------------------------ */

test("V0 — Der Verbindungsweg endet mit einer Sitzung, die dem Agenten gehört", async (t) => {
  const p = await panelStarten({
    bindKontext: "erster-auftrag",
    workerAntworten: {
      "link:verbinden": {
        ok: true,
        sitzung: {
          stufe: "read",
          code: "AA11BB",
          endetUm: Date.now() + 600000,
          modus: "tab",
          bereich: ["geizhals.de"],
          schrittmodus: "confirm_each",
        },
      },
    },
  });
  t.after(p.aufraeumen);

  await p.klick("verbinden-start");
  assert.equal(p.el("app").dataset.state, "dialog", "der Dialog steht");
  assert.equal(p.el("ursprung").textContent, "https://geizhals.de");

  await p.klick("verbinden");
  assert.equal(p.el("app").dataset.state, "aktiv");
  assert.ok(p.zustand.sitzung, "die Sitzung kommt vom Server, nicht aus dem Dialog");
  assert.ok(p.anWorker().includes("overlay:einspielen"), "erst der Rahmen auf der Seite");
  assert.ok(p.anWorker().includes("link:verbinden"), "dann die Leitung");

  /* Und zuletzt die Bindung: Ohne sie wäre die Verbindung nur Anzeige — der
     Agent hätte die Freigabe, aber keine Hände (G4). */
  assert.equal(p.bindAufrufe().length, 1);
  assert.equal(p.bindAufrufe()[0].angaben.koerper.code, "AA11BB");
  assert.equal(p.bindAufrufe()[0].angaben.koerper.step_mode, "confirm_each");
  assert.equal(p.zustand.browserKontext, "erster-auftrag");
  assert.equal(p.el("eingabe").placeholder, p.f.PLATZHALTER_TAB);
});

test("V0b — Der Dialog öffnet kompakt; Dauer und Stufe stehen hinter einem Klick", async (t) => {
  /* Der übliche Weg ist zwei Klicks ohne Entscheidung: aufbauen, herstellen.
     Die drei Angaben sind eingeklappt und die gemerkte Wahl vorbelegt.
     Prüfsatz gegen die halbe Mutation: Ohne das Einklappen in dialogVorbereiten
     oder ohne den Umschalter wird er rot. */
  const p = await panelStarten();
  t.after(p.aufraeumen);

  await p.klick("verbinden-start");
  assert.equal(p.el("app").dataset.state, "dialog", "der Dialog steht");
  assert.equal(p.el("dialog-mehr").hidden, true, "Dauer und Stufe sind zuerst eingeklappt");
  assert.equal(p.el("einstellungen-aendern").getAttribute("aria-expanded"), "false");

  await p.klick("einstellungen-aendern");
  assert.equal(p.el("dialog-mehr").hidden, false, "ein Klick klappt Dauer und Stufe auf");
  assert.equal(p.el("einstellungen-aendern").getAttribute("aria-expanded"), "true");
  /* Der Verbindungsweg selbst (klick verbinden → Sitzung) und die Radios sind
     von V0 und den Auswahl-Tests abgedeckt; hier zählt nur das Ein- und
     Ausklappen. */
});

test("V1 — Ablehnen beendet den Schritt, nicht die Sitzung", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.spurLeeren();

  const antwort = p.frageStellen({
    typ: "link:schritt-freigabe",
    frage: "Für dich klicken? Der Agent sagt: „Ich lege den Artikel in den Korb.“",
    quelle: "Zur Kasse",
    cmd: "click",
    id: "b1",
  });
  assert.equal(p.el("freigabe").hidden, false, "die Frage steht offen");

  await p.klick("freigabe-nein");
  assert.deepEqual(await antwort, { ja: false }, "der Ausführer bekommt ein Nein");

  /* Der Kern des Befundes: Die Sitzung überlebt das Nein. */
  assert.ok(p.zustand.sitzung, "ein Nein zu einem Schritt beendet die Sitzung nicht");
  assert.ok(!p.anWorker().includes("link:trennen"), "und trennt die Verbindung nicht");
  assert.equal(p.el("freigabe").hidden, true, "die Karte ist weg");
  assert.equal(p.el("sitzungscode").hidden, false, "die Sitzungsleiste steht weiter");

  /* Und der Mensch erfährt, was sein Nein bewirkt hat — sichtbar und hörbar. */
  assert.ok(
    p.protokoll().some((z) => z.startsWith("Abgelehnt")),
    "die Ablehnung steht im Protokoll"
  );
  assert.ok(
    p.gesprochen.some((s) => /Verbindung bleibt bestehen/.test(s)),
    "und wird vorgelesen, samt der Auskunft, dass die Sitzung weiterläuft"
  );

  /* Beendet wird über Stopp — dort und nur dort. */
  await p.klick("stopp");
  assert.equal(p.zustand.sitzung, null, "der Stopp-Knopf beendet weiterhin");
  assert.ok(p.anWorker().includes("link:trennen"));
});

test("V2 — Beenden löst den Wartezustand auf, bevor es auf irgendetwas wartet", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.f.chatWartenZeigen(true, "browser");
  assert.equal(p.el("kostenhinweis").textContent, "Niemand arbeitet …");
  p.spurLeeren();

  const fertig = p.f.beenden("nutzer");

  /* Hier steht die Zusage „noch vor jedem await": Wer Stopp drückt, darf
     nicht noch einen Takt lang lesen, dass gearbeitet wird. Geprüft wird
     synchron — nach dem Aufruf, vor dem ersten Warten. */
  assert.equal(p.zustand.chatLaeuft, false, "die Wartezeile ist sofort aufgelöst");
  assert.equal(p.el("kostenhinweis").textContent, "", "und nicht erst nach dem Netzverkehr");
  assert.equal(p.el("senden").disabled, false, "das Senden ist sofort wieder möglich");

  await fertig;
  assert.deepEqual(
    p.anWorker(),
    ["link:trennen", "chat:neu"],
    "erst die Leitung kappen, dann den Browser-Auftrag stoppen"
  );
  assert.ok(p.anTab().includes("overlay:aus"), "der Rahmen auf der Seite geht weg");
});

test("V2b — Ein gewöhnliches Gespräch überlebt das Ende der Steuerung", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.f.chatWartenZeigen(true, "gespraech");
  p.spurLeeren();

  await p.f.beenden("nutzer");
  assert.ok(
    !p.anWorker().includes("chat:neu"),
    "gestoppt wird nur, was zur Sitzung gehört — eine gewöhnliche Frage nicht"
  );
});

test("V3 — Neues Gespräch bindet die laufende Sitzung neu an den Agenten", async (t) => {
  const p = await panelStarten({ bindKontext: "frischer-auftrag" });
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.zustand.browserKontext = "alter-auftrag";
  p.spurLeeren();

  await p.klick("neu");

  assert.ok(p.zustand.sitzung, "die Browsersitzung bleibt: Gespräch und Steuerung sind getrennt");
  assert.ok(!p.anWorker().includes("link:trennen"));
  assert.ok(p.anWorker().includes("chat:neu"), "der laufende Botengang wird gestoppt");

  /* Der Kern des Befundes: Der Agent bekommt wieder Hände. */
  assert.equal(p.bindAufrufe().length, 1, "es wird genau einmal neu gebunden");
  assert.equal(p.bindAufrufe()[0].pfad, "/api/v1/link/session/bind");
  assert.equal(
    p.bindAufrufe()[0].angaben.koerper.context_id,
    "",
    "mit leerem Kontext: der alte gehört zum alten Gespräch"
  );
  assert.equal(p.bindAufrufe()[0].angaben.koerper.code, "AB12CD");
  assert.equal(p.zustand.browserKontext, "frischer-auftrag");
  assert.equal(p.el("eingabe").placeholder, p.f.PLATZHALTER_TAB, "und das Eingabefeld sagt es");
  assert.ok(
    p.verlauf().some((b) => /Hände für diesen Tab/.test(b)),
    "der Mensch liest, dass der Agent wieder zugreifen kann"
  );
});

test("V4 — Was der Agent tut, steht entschärft im Protokoll", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);

  p.f.schrittZeigen({
    art: "tool_call",
    werkzeug: "click",
    text: `Ich klicke${String.fromCharCode(7)} jetzt${String.fromCharCode(0x200b)} auf ${"A".repeat(400)}`,
  });
  const zeile = p.protokoll().at(-1);
  assert.ok(zeile.startsWith("Werkzeug click: "), `unerwarteter Kopf: ${zeile}`);
  assert.ok(
    !steuerzeichenDrin(zeile),
    "Steuerzeichen und Nullbreiten kommen nie ins Protokoll"
  );
  assert.ok(zeile.endsWith("…"), "zu langer Text wird gekürzt und die Kürzung ist zu sehen");
  assert.ok(zeile.length <= 200, `die Zeile ist ungekürzt durchgelaufen: ${zeile.length} Zeichen`);

  /* Die Wartezeile bekommt die Kurzfassung — sie ist die einzige Stelle, die
     immer sichtbar ist. */
  p.f.chatWartenZeigen(true, "browser");
  p.f.schrittZeigen({ art: "thinking", text: "B".repeat(200) });
  assert.ok(p.el("kostenhinweis").textContent.length <= 90);
  assert.ok(p.el("kostenhinweis").textContent.startsWith("Niemand arbeitet:"));

  /* Eine Art, die es nicht gibt, bleibt eine Zeile — und wird nie zum
     Eintrag des Object-Prototyps. */
  p.f.schrittZeigen({ art: "constructor", text: "etwas" });
  assert.equal(p.protokoll().at(-1), "Arbeitet: etwas");
});

test("V5 — Eine Schrittmeldung übertönt die offene Freigabefrage nicht", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  /* Die härteste Stufe: Hier spricht jede Ansage von selbst. */
  p.zustand.vorlesen = "alles";
  p.spurLeeren();

  const antwort = p.frageStellen({
    typ: "link:schritt-freigabe",
    frage: "Für dich klicken? Der Agent sagt: „Ich lege den Artikel in den Korb.“",
    quelle: "Zur Kasse",
    cmd: "click",
    id: "b2",
  });
  const frageAnsage = p.el("ansage").textContent;
  assert.match(frageAnsage, /Freigeben oder ablehnen\?/);
  const stimmen = p.gesprochen.length;
  const abbrueche = p.stimmabbrueche();

  /* Der Schritt zu genau diesem Befehl trifft im nächsten Takt ein — mit der
     Karte zusammen (net/chat.js, CHAT_TAKT_MS = 2000). */
  p.f.schrittZeigen({ art: "tool_call", werkzeug: "click", text: "Ich klicke gleich" });

  assert.equal(p.el("ansage").textContent, frageAnsage, "die Live-Region gehört der Frage");
  assert.equal(p.zustand.letzteRede, frageAnsage, "der 🔊-Knopf liest die Frage, nicht den Schritt");
  assert.equal(p.gesprochen.length, stimmen, "keine zweite Stimme über die laufende Frage");
  assert.equal(p.stimmabbrueche(), abbrueche, "und kein Abbruch mitten im Satz");
  assert.ok(
    p.protokoll().at(-1).includes("Werkzeug click"),
    "im Protokoll steht der Schritt trotzdem — verschwiegen wird er nie"
  );

  await p.klick("freigabe-ja");
  await antwort;

  /* Ohne offene Frage sagt der Schritt wieder Bescheid: Der 🔊-Knopf muss
     jederzeit sagen können, woran der Agent gerade ist. */
  p.f.schrittZeigen({ art: "thinking", text: "Ich überlege" });
  assert.notEqual(p.el("ansage").textContent, frageAnsage);
  assert.equal(p.zustand.letzteRede, "Überlegt: Ich überlege");
  assert.equal(p.gesprochen.length, stimmen + 1);
});

test("V6 — Die Restzeit wird nie geraten", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);

  /* Sagt der Ausführer die verbleibende Zeit, gilt genau seine Zahl. Er ist
     der Einzige, der weiß, wie viel von der Frist schon verbraucht ist. */
  assert.equal(p.f.antwortfristMs({ cmd: "click", frist: 9000 }), 9000);
  assert.equal(p.f.antwortfristMs({ cmd: "type", frist: 12345.6 }), 12346);

  /* Sagt er sie nicht, gibt es keine Uhr — auch nicht für einen Befehl, dessen
     Tabellenfrist die Seitenleiste kennt. Denn die Tabellenzahl steht am
     ANFANG des Befehls; bis zur Frage sind Wahrnehmung und Nachschlagen
     vergangen. Sie wäre immer zu groß, und eine Restzeit, die nicht stimmt,
     ist schlimmer als gar keine. */
  for (const cmd of Object.keys(befehle.BEFEHLE)) {
    assert.equal(p.f.antwortfristMs({ cmd }), 0, `${cmd}: geratene Restzeit`);
  }
  assert.equal(p.f.antwortfristMs({ cmd: "unbekannt" }), 0);
  assert.equal(p.f.antwortfristMs({ cmd: "click", frist: -3 }), 0);
  assert.equal(p.f.antwortfristMs({ cmd: "click", frist: "gleich" }), 0);
  assert.equal(p.f.antwortfristMs({}), 0);
  assert.equal(p.f.antwortfristMs(null), 0);
});

test("V7 — Ohne Frist steht in der Karte eine ehrliche Angabe statt einer Zahl", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.spurLeeren();

  const ohne = p.frageStellen({
    typ: "link:schritt-freigabe",
    frage: "Für dich klicken?",
    quelle: "Zur Kasse",
    cmd: "click",
    id: "b3",
  });
  const zeile = p.el("freigabe-rest-text").textContent;
  assert.equal(p.el("freigabe-rest").hidden, false, "eine Absage ist eine Aussage: die Zeile bleibt");
  assert.ok(!/\d/.test(zeile), `keine Zahl, die niemand kennt: ${zeile}`);
  assert.match(zeile, /weiß ich (hier )?nicht/);
  assert.equal(
    p.el("freigabe-balken").hidden,
    true,
    "ein Balken ohne bekannte Gesamtzeit wäre eine erfundene Anzeige"
  );
  /* Und der Hauptbedienweg erfährt es: Was man nur sieht, hat den Inhaber
     nicht erreicht. */
  assert.match(p.zustand.letzteRede, /antworte am besten sofort/);
  await p.klick("freigabe-nein");
  await ohne;

  /* Mit echter Frist läuft die Uhr — und zeigt genau die Zahl des Ausführers. */
  const mit = p.frageStellen({
    typ: "link:schritt-freigabe",
    frage: "Noch einmal klicken?",
    cmd: "click",
    id: "b4",
    frist: 9000,
  });
  assert.match(p.el("freigabe-rest-text").textContent, /^Noch 9 Sekunden/);
  assert.equal(p.el("freigabe-rest").hidden, false);
  assert.equal(p.el("freigabe-balken").hidden, false, "jetzt sagt der Balken die Wahrheit");
  assert.ok(
    !/weiß ich/.test(p.zustand.letzteRede),
    "und der Satz über die unbekannte Zeit entfällt"
  );
  await p.klick("freigabe-nein");
  await mit;
  assert.equal(p.el("freigabe-rest").hidden, true, "danach ist die Uhr weg");
});

test("V7d — Der Beispielauftrag wartet ohne Uhr und behauptet auch keine", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.spurLeeren();

  const lauf = p.klick("vorschlag");
  await new Promise((f) => setTimeout(f, 0));

  /* Diese Frage wartet in der Seitenleiste selbst — es gibt keinen Ausführer
     mit einer Frist. Also steht dort weder eine Zahl noch der Satz über eine
     unbekannte Zeit: Beides wäre eine Aussage über etwas, das es nicht gibt. */
  assert.equal(p.el("freigabe").hidden, false, "die Frage steht");
  assert.equal(p.el("freigabe-rest").hidden, true, "es wartet keine Uhr, also steht dort nichts");
  assert.ok(!/weiß ich/.test(p.zustand.letzteRede), `keine erfundene Zeit: ${p.zustand.letzteRede}`);

  await p.klick("freigabe-nein");
  await lauf;
});

test("V7c — Läuft die Uhr ab, entscheidet sie nichts", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  let beantwortet = false;
  const offen = p.frageStellen({
    typ: "link:schritt-freigabe",
    frage: "Für dich klicken?",
    cmd: "click",
    id: "b6",
    /* Knapp über einer Sekunde: Die Uhr schlägt einmal und läuft dann in den
       Nullpunkt — der Augenblick, in dem sie eine Entscheidung treffen könnte. */
    frist: 1100,
  });
  offen.then(() => {
    beantwortet = true;
  });
  await new Promise((f) => setTimeout(f, 2300));

  /* Ein „Nein" von der Uhr wäre eine Entscheidung, die der Mensch nie
     getroffen hat — und der Ausführer unterscheidet Ablehnung und Zeitablauf
     ausdrücklich. Weggeräumt wird die Karte von dem, der wirklich aufgehört
     hat zu warten. */
  assert.equal(beantwortet, false, "die Uhr gibt keine Antwort");
  assert.equal(p.el("freigabe").hidden, false, "und räumt die Frage nicht weg");
  assert.ok(p.zustand.freigabeLaeuft, "sie wartet weiter auf den Menschen");
  assert.match(p.el("freigabe-rest-text").textContent, /gleich um/);

  p.melden({ typ: "link:freigabe-zurueckziehen", id: "b6" });
  assert.equal((await offen).ja, false);
});

test("V7b — Läuft die Frist ab, verschwindet die Karte nicht kommentarlos", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.spurLeeren();

  const offen = p.frageStellen({
    typ: "link:schritt-freigabe",
    frage: "Für dich klicken?",
    cmd: "click",
    id: "b5",
  });
  p.melden({ typ: "link:freigabe-zurueckziehen", id: "b5" });
  assert.deepEqual(await offen, { ja: false }, "der Ausführer bekommt kein Ja");
  assert.equal(p.el("freigabe").hidden, true);
  assert.ok(p.protokoll().some((z) => /Abgelaufen/.test(z)));
  assert.ok(
    p.verlauf().some((b) => /nicht länger auf deine Antwort gewartet/.test(b)),
    "der Ablauf steht sichtbar im Gespräch, nicht nur im Protokoll"
  );
  assert.ok(p.gesprochen.some((s) => /nicht länger gewartet/.test(s)), "und wird vorgelesen");
  assert.ok(p.zustand.sitzung, "die Sitzung läuft weiter — nicht passiert ist nur dieser Schritt");
});

test("V8 — Nach dem Wiederöffnen bekommt die laufende Sitzung wieder Hände", async (t) => {
  const p = await panelStarten({
    bindKontext: "wieder-gebunden",
    workerAntworten: {
      "link:zustand?": {
        verbunden: true,
        stufe: "write",
        code: "ZZ99YY",
        endetUm: Date.now() + 600000,
        modus: "tab",
        bereich: ["geizhals.de"],
        schrittmodus: "confirm_each",
      },
    },
  });
  t.after(p.aufraeumen);

  assert.ok(p.zustand.sitzung, "die laufende Sitzung wird wieder angezeigt");
  assert.equal(p.el("zustand-text").textContent, "Aktiv · Bedienen");

  /* Der Kern des Befundes: „Aktiv" darf nicht behaupten, was der Agent nicht
     kann. Der Browser-Auftrag lebte nur im Fenster, das der Nutzer geschlossen
     hat — also wird er neu gebunden. */
  assert.equal(p.bindAufrufe().length, 1, "die Sitzung wird neu an den Agenten gebunden");
  assert.equal(p.bindAufrufe()[0].angaben.koerper.code, "ZZ99YY");
  assert.equal(p.zustand.browserKontext, "wieder-gebunden");
  assert.equal(p.el("eingabe").placeholder, p.f.PLATZHALTER_TAB, "die nächste Frage geht an den Tab");
  assert.equal(p.el("stoerung").hidden, true, "und es gibt nichts zu beklagen");

  /* Die Anzeige hängt nicht mehr an der Reihenfolge des Starts: Die
     Sitzungsanzeige zieht den Platzhalter selbst nach. */
  p.el("eingabe").placeholder = "irgendwas";
  await p.sitzungHerstellen();
  assert.equal(p.el("eingabe").placeholder, p.f.PLATZHALTER_TAB);
});

test("V9 — Kann die Bindung nicht entstehen, sagt die Seitenleiste es", async (t) => {
  const p = await panelStarten({
    bindFehler: true,
    workerAntworten: {
      "link:zustand?": {
        verbunden: true,
        stufe: "write",
        code: "ZZ99YY",
        endetUm: Date.now() + 600000,
        modus: "tab",
        bereich: ["geizhals.de"],
        schrittmodus: "confirm_each",
      },
    },
  });
  t.after(p.aufraeumen);

  assert.ok(p.zustand.sitzung, "die Sitzung selbst gehört dem Dienst und läuft weiter");
  assert.equal(p.zustand.browserKontext, null);
  assert.equal(p.el("stoerung").hidden, false, "ein toter Weg wird nie verschwiegen");
  assert.match(p.el("stoerung").textContent, /dem Agenten nicht übergeben/);
  assert.equal(
    p.el("eingabe").placeholder,
    p.f.PLATZHALTER_GESPRAECH,
    "der Platzhalter sagt die Wahrheit, nicht das Gewünschte"
  );
  assert.ok(
    p.gesprochen.some((s) => /dem Agenten nicht übergeben/.test(s)),
    "und der Hauptbedienweg hört es"
  );

  /* Ohne Anmeldung dieselbe Wahrheit auf dem anderen Weg: benannt, nicht
     verschwiegen. */
  const ohne = await panelStarten({
    ausweis: null,
    workerAntworten: {
      "link:zustand?": {
        verbunden: true,
        stufe: "read",
        code: "ZZ99YY",
        endetUm: Date.now() + 600000,
        modus: "tab",
        bereich: ["geizhals.de"],
      },
    },
  });
  t.after(ohne.aufraeumen);
  assert.equal(ohne.zustand.browserKontext, null);
  assert.equal(ohne.el("eingabe").placeholder, ohne.f.PLATZHALTER_GESPRAECH);
  assert.equal(ohne.el("stoerung").hidden, false);
  assert.equal(ohne.bindAufrufe().length, 0, "ohne Ausweis wird gar nicht erst gefragt");

  /* Und der stille Ausgang ist zu. Er wird hier für sich geprüft, weil beim
     Start zufällig auch die Guthabenzeile etwas sagt — die Bindung selbst
     muss es sagen, sonst hinge die Aussage an einer fremden Reihenfolge. */
  ohne.zustand.browserKontext = "alter-auftrag";
  ohne.el("stoerung").textContent = "";
  ohne.el("stoerung").hidden = true;
  await ohne.f.agentenBindung();
  assert.equal(ohne.zustand.browserKontext, null, "der tote Auftrag wird weggeräumt");
  assert.equal(ohne.el("stoerung").hidden, false, "kein Weg endet ohne Antwort");
  assert.match(ohne.el("stoerung").textContent, /Anmeldung/);
  assert.equal(ohne.el("eingabe").placeholder, ohne.f.PLATZHALTER_GESPRAECH);
});

/* ------------------------------------------------------------------ *
 * Was die Seitenleiste ANBIETET — hier ist panel.html die Aussage selbst.
 * ------------------------------------------------------------------ */

test("panel.html: Die Restzeit tickt nie in einer Live-Region", () => {
  assert.ok(html.includes('id="freigabe-rest"'), "die Restzeit steht in der Karte");
  assert.match(
    html,
    /id="freigabe-rest"[^>]*aria-live="off"/,
    "ein Sekundentakt in einer assertiven Live-Region würde die Frage übertönen"
  );
  assert.ok(html.includes('id="freigabe-balken"'), "der Balken ist einzeln abschaltbar");
  /* Die Karte selbst bleibt assertiv: Die Frage ist das Dringendste, was die
     Seitenleiste je zu sagen hat. */
  assert.match(html, /id="freigabe"[^>]*aria-live="assertive"/);
});

test("panel.html: Das Eingabefeld startet mit demselben Satz wie der Quelltext", () => {
  const ausJs = quelle.match(/PLATZHALTER_GESPRAECH = "([^"]+)"/)[1];
  assert.ok(html.includes(`placeholder="${ausJs}"`), "HTML und Quelltext sagen dasselbe");
  assert.match(quelle, /PLATZHALTER_TAB = "[^"]*diesem Tab[^"]*"/);
});

/* ------------------------------------------------------------------ *
 * Befunde vom 05.08.2026 — gefahren, nicht im Quelltext nachgelesen.
 * ------------------------------------------------------------------ */

test("W1 — Verfällt der Ausweis bei laufender Sitzung, bleibt der Stopp-Knopf", async (t) => {
  const p = await panelStarten({
    workerAntworten: {
      "link:verbinden": {
        ok: true,
        sitzung: {
          stufe: "write",
          code: "CC33DD",
          endetUm: Date.now() + 600000,
          modus: "tab",
          bereich: ["geizhals.de"],
          schrittmodus: "confirm_each",
        },
      },
    },
  });
  t.after(p.aufraeumen);

  await p.klick("verbinden-start");
  await p.klick("verbinden");
  assert.equal(p.el("app").dataset.state, "aktiv", "Vorbedingung: die Sitzung läuft");

  /* Genau die Lage, die den Fehler auslöste: Der Ausweis verfällt, die
     Anmeldekarte erscheint, der Mensch bricht sie ab. Die Sitzung läuft
     derweil weiter und der Agent behält seine Rechte auf dem Tab. */
  await p.klick("anmeldung-abbrechen");

  assert.equal(
    p.el("app").dataset.state,
    "aktiv",
    "die Sitzung läuft weiter, also bleibt der Zustand aktiv"
  );
  assert.ok(p.zustand.sitzung, "die Sitzung wurde nicht stillschweigend vergessen");
  assert.equal(
    p.el("sitzungsleiste").hidden,
    false,
    "der Stopp-Knopf MUSS erreichbar bleiben, sonst hat der Mensch keine Notbremse mehr"
  );
});

test("W2 — In dieser Lage wird KEIN zweiter Verbindungsaufbau angeboten", async (t) => {
  const p = await panelStarten({
    workerAntworten: {
      "link:verbinden": {
        ok: true,
        sitzung: {
          stufe: "write",
          code: "EE55FF",
          endetUm: Date.now() + 600000,
          modus: "tab",
          bereich: ["geizhals.de"],
          schrittmodus: "confirm_each",
        },
      },
    },
  });
  t.after(p.aufraeumen);

  assert.equal(
    p.el("verbindungsleiste").hidden,
    false,
    "im Ruhezustand steht der Weg zur Verbindung sichtbar da"
  );

  await p.klick("verbinden-start");
  await p.klick("verbinden");
  assert.equal(
    p.el("verbindungsleiste").hidden,
    true,
    "läuft eine Sitzung, führt der Weg über Stopp und nicht über einen zweiten Antrag"
  );

  await p.klick("anmeldung-abbrechen");
  assert.equal(
    p.el("verbindungsleiste").hidden,
    true,
    "auch nach abgebrochener Anmeldung kein zweiter Antrag, solange die erste Sitzung Rechte hält"
  );
});

/* ------------------------------------------------------------------ *
 * M2 und M3 aus dem Plan vom 05.08.2026 — gefahren, nicht nachgelesen.
 *
 * Diese Sätze halten fest, was am 06.08. gebaut wurde. Jeder einzelne ist
 * gegen die HALBE Änderung gemessen worden, nicht gegen das Löschen der
 * Stelle: Ein Prüfsatz, der nur beim vollständigen Entfernen rot wird, hätte
 * die Regression an ticket.py am 04.08. auch nicht gefangen.
 * ------------------------------------------------------------------ */

/* Eine Sprechblase, wie sie ein geführtes Gespräch hinterlässt. Ihr Vorhandensein
   ist die ganze Bedingung, an der #leer verschwindet (setzeZustand). */
const blaseAnlegen = (p) => p.el("verlauf").appendChild(knoten("div"));

/* beenden() lässt die Anzeige absichtlich 1200 ms stehen, damit die
   Schlussansage nicht mitten im Satz von einem Bildwechsel überholt wird.
   Hier wird darauf gewartet statt mit einer festen Zahl geschlafen — sonst
   entscheidet die Tagesform der Maschine über das Ergebnis. */
async function warteAufZustand(p, name, msMax = 4000) {
  const bis = Date.now() + msMax;
  while (p.el("app").dataset.state !== name && Date.now() < bis) {
    await new Promise((f) => setTimeout(f, 20));
  }
  assert.equal(p.el("app").dataset.state, name, `der Zustand „${name}" wurde nie erreicht`);
}

test("M2a — Der Weg zur Verbindung überlebt die erste Sprechblase", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);

  assert.equal(p.el("verbindungsleiste").hidden, false, "Vorbedingung: im Ruhezustand sichtbar");

  /* Genau der Vorgang, an dem der Knopf bis 0.4.0 verschwand: Sobald ein
     Gespräch existiert, verdrängt der Verlauf den Leerzustand — und mit ihm
     verschwand früher der einzige sichtbare Verbinden-Knopf. */
  blaseAnlegen(p);
  await p.klick("verbinden-start");
  await p.klick("dialog-abbrechen");

  assert.equal(p.el("leer").hidden, true, "Vorbedingung: der Verlauf hat den Leerzustand verdrängt");
  assert.equal(
    p.el("verbindungsleiste").hidden,
    false,
    "der Weg zur Verbindung MUSS trotzdem stehen bleiben, sonst ist er nur noch im Menü zu finden"
  );
});

test("M2b — Neues Gespräch holt die Begrüßung zurück", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);

  blaseAnlegen(p);
  await p.klick("verbinden-start");
  await p.klick("dialog-abbrechen");
  assert.equal(p.el("leer").hidden, true, "Vorbedingung: der Leerzustand ist verdrängt");

  await p.klick("neu");

  assert.equal(p.el("verlauf").childElementCount, 0, "der Verlauf ist geleert");
  assert.equal(
    p.el("leer").hidden,
    false,
    "nach dem Leeren muss die Begrüßung zurück — sonst bleibt die Hauptfläche schlicht leer"
  );
});

test("M2c — Der Beispielauftrag lebt mit der Sitzung, nicht mit dem Leerzustand", async (t) => {
  const p = await panelStarten({
    workerAntworten: {
      "link:verbinden": {
        ok: true,
        sitzung: {
          stufe: "read",
          code: "AA11BB",
          endetUm: Date.now() + 600000,
          modus: "tab",
          bereich: ["geizhals.de"],
          schrittmodus: "confirm_each",
        },
      },
    },
  });
  t.after(p.aufraeumen);

  assert.equal(p.el("vorschlag").hidden, true, "ohne Sitzung gibt es nichts vorzuführen");

  await p.klick("verbinden-start");
  await p.klick("verbinden");
  assert.equal(p.el("app").dataset.state, "aktiv", "Vorbedingung: die Sitzung läuft");
  assert.equal(
    p.el("vorschlag").hidden,
    false,
    "in der laufenden Sitzung MUSS der Beispielauftrag erreichbar sein — in #leer war er es nie"
  );

  await p.klick("stopp");
  await warteAufZustand(p, "bereit");
  assert.equal(
    p.el("vorschlag").hidden,
    true,
    "mit der Sitzung geht er wieder; sonst zeigt er auf einen Tab, auf dem nichts mehr erlaubt ist"
  );
});

test("M2d — Die Vorführung steht bei der Störung und geht mit ihr", async (t) => {
  const p = await panelStarten({
    workerAntworten: { "overlay:einspielen": { ok: false } },
  });
  t.after(p.aufraeumen);

  assert.equal(p.el("vorfuehrung").hidden, true, "ohne Fehlversuch wird nichts angeboten");

  /* Ein Fehlversuch setzt zwangsläufig einen Gesprächsverlauf voraus — genau
     die Lage, in der #leer weg ist. Bis 0.4.0 wohnte dieser Ausweg dort. */
  blaseAnlegen(p);
  await p.klick("verbinden-start");
  await p.klick("verbinden");

  assert.equal(p.el("stoerung").hidden, false, "Vorbedingung: der Aufbau ist gescheitert");
  assert.equal(p.el("leer").hidden, true, "Vorbedingung: der Leerzustand ist verdrängt");
  assert.equal(
    p.el("vorfuehrung").hidden,
    false,
    "der Ausweg aus der Störung MUSS sichtbar sein, sonst steht nur die rote Zeile da"
  );

  /* Ist die Störung weg, ist ihr Ausweg gegenstandslos. */
  await p.klick("verbinden-start");
  assert.equal(p.el("stoerung").hidden, true, "der neue Anlauf räumt die Störung ab");
  assert.equal(p.el("vorfuehrung").hidden, true, "und nimmt ihren Ausweg mit");
});

/* ------------------------------------------------------------------ *
 * M3 — das Panel sagt die Wahrheit über Dauer und Leerlauffrist.
 *
 * Die Werte kommen aus dem Schein des Servers, NICHT aus einer Annahme über
 * dessen Fassung. Deshalb prüft jeder Satz hier mindestens zwei verschiedene
 * Zahlenpaare: Eine fest verdrahtete Ansage („bekommen hast du 10 Minuten",
 * „nach drei Minuten") käme durch einen einzelnen Fall durch.
 * ------------------------------------------------------------------ */

async function verbindenMit({ wunsch, bewilligtSekunden, leerlaufSekunden }) {
  const p = await panelStarten({
    workerAntworten: {
      "link:verbinden": {
        ok: true,
        sitzung: {
          stufe: "read",
          code: "CD34EF",
          endetUm: Date.now() + bewilligtSekunden * 1000,
          modus: "tab",
          bereich: ["geizhals.de"],
          schrittmodus: "confirm_each",
          ...(leerlaufSekunden === undefined ? {} : { leerlaufSekunden }),
        },
      },
    },
  });
  await p.klick("verbinden-start");
  await p.waehlen("dauer", wunsch);
  await p.klick("verbinden");
  assert.equal(p.el("app").dataset.state, "aktiv", "Vorbedingung: die Sitzung läuft");
  return p;
}

test("M3a — Kürzt der Server die Dauer, wird der WIRKLICH bewilligte Wert angesagt", async (t) => {
  /* Fall eins: 60 gewünscht, 10 bewilligt. Genau die Lage vom 04.08.2026. */
  const eins = await verbindenMit({ wunsch: "3600", bewilligtSekunden: 600 });
  t.after(eins.aufraeumen);
  assert.match(
    eins.gesprochen.join(" "),
    /Du hast 60 Minuten gewählt, bekommen hast du 10 Minuten\./,
    "die Kürzung muss angesagt werden, und zwar mit beiden Zahlen"
  );

  /* Fall zwei: anderer BEWILLIGTER Wert. Wer die zweite Zahl fest verdrahtet,
     stirbt hier. */
  const zwei = await verbindenMit({ wunsch: "3600", bewilligtSekunden: 1800 });
  t.after(zwei.aufraeumen);
  assert.match(
    zwei.gesprochen.join(" "),
    /Du hast 60 Minuten gewählt, bekommen hast du 30 Minuten\./,
    "der bewilligte Wert wird gemessen, nicht behauptet"
  );

  /* Fall drei: anderer GEWÜNSCHTER Wert. Wer die erste Zahl fest verdrahtet,
     stirbt hier. Beide Fälle braucht es einzeln — mit nur einem Wunschwert
     käme ein hart geschriebenes „60 Minuten" ungestraft durch, gemessen am
     06.08.2026. */
  const drei = await verbindenMit({ wunsch: "1800", bewilligtSekunden: 600 });
  t.after(drei.aufraeumen);
  assert.match(
    drei.gesprochen.join(" "),
    /Du hast 30 Minuten gewählt, bekommen hast du 10 Minuten\./,
    "auch der gewünschte Wert wird gelesen, nicht angenommen"
  );
});

test("M3b — Hält der Server die Dauer, wird keine Kürzung erfunden", async (t) => {
  /* Gewährt der Server die volle gewünschte Dauer, darf die Seitenleiste keine
     Kürzung ansagen. Ein fest verdrahteter Vorbehalt wäre dann die nächste
     Unwahrheit, nur mit umgekehrtem Vorzeichen. */
  const p = await verbindenMit({ wunsch: "3600", bewilligtSekunden: 3600 });
  t.after(p.aufraeumen);

  assert.doesNotMatch(
    p.gesprochen.join(" "),
    /bekommen hast du/,
    "wird die volle Dauer gewährt, darf keine Kürzung angesagt werden"
  );
});

test("M3c — Die Leerlauffrist wird mit dem Wert aus dem Schein angesagt", async (t) => {
  /* Die Leerlauffrist kommt aus dem Schein des Servers (idle_timeout), nicht aus
     einer fest verdrahteten Zahl. Die Ansage nennt genau diesen Wert. */
  const heute = await verbindenMit({
    wunsch: "3600",
    bewilligtSekunden: 3600,
    leerlaufSekunden: 600,
  });
  t.after(heute.aufraeumen);
  assert.match(
    heute.gesprochen.join(" "),
    /Ohne Auftrag endet die Verbindung nach 10 Minuten von selbst\./,
    "der Wert kommt aus dem Schein"
  );

  /* Der alte Wert. Wer die Zahl fest verdrahtet, fällt an einem der beiden
     Fälle durch — an welchem, hängt davon ab, welche Zahl er verdrahtet. */
  const frueher = await verbindenMit({
    wunsch: "3600",
    bewilligtSekunden: 3600,
    leerlaufSekunden: 180,
  });
  t.after(frueher.aufraeumen);
  assert.match(
    frueher.gesprochen.join(" "),
    /Ohne Auftrag endet die Verbindung nach 3 Minuten von selbst\./,
    "ändert der Server die Frist, ändert sich die Ansage mit"
  );
});

test("M3d — Ohne Frist im Schein wird keine erfunden", async (t) => {
  const p = await verbindenMit({ wunsch: "3600", bewilligtSekunden: 3600 });
  t.after(p.aufraeumen);

  assert.doesNotMatch(
    p.gesprochen.join(" "),
    /Ohne Auftrag endet die Verbindung/,
    "trägt der Schein keine Frist, schweigt das Panel darüber"
  );
});

test("M3e — Dauer und Stufe überstehen das Schließen der Seitenleiste", async (t) => {
  const erste = await panelStarten();
  t.after(erste.aufraeumen);

  await erste.klick("verbinden-start");
  await erste.waehlen("dauer", "3600");
  await erste.waehlen("stufe", "write");

  assert.equal(erste.ablage.wahlDauer, "3600", "die Wahl wird beim Wählen gemerkt");
  assert.equal(erste.ablage.wahlStufe, "write");

  /* Die Seitenleiste wird geschlossen und neu geöffnet: neues Dokument, neuer
     Lauf von panel.js, dieselbe Ablage. */
  const zweite = await panelStarten({ speicher: erste.ablage });
  t.after(zweite.aufraeumen);

  assert.equal(zweite.gewaehlt("dauer"), "600", "vor dem Dialog steht noch die Vorgabe aus dem HTML");
  await zweite.klick("verbinden-start");

  assert.equal(zweite.gewaehlt("dauer"), "3600", "die gemerkte Dauer ist wieder vorausgewählt");
  assert.equal(zweite.gewaehlt("stufe"), "write", "und die gemerkte Stufe auch");
  assert.match(
    zweite.el("zusammenfassung").textContent,
    /60 Minuten/,
    "die Zusammenfassung liest vor, was wirklich beantragt wird — nicht die Vorgabe"
  );
});

test("M3f — Ein gemerkter Wert, den es nicht mehr gibt, fällt auf die Vorgabe zurück", async (t) => {
  /* `1200` stand bis 0.4.0 in DAUERTEXT, einen Knopf dazu gab es nie.
     `full` ist eine Stufe, die diese Erweiterung nicht anbietet und der
     Server nicht kennt. Beides darf aus der Ablage nicht in den Antrag
     durchschlagen — auch dann nicht, wenn es jemand dort hineinschreibt. */
  const p = await panelStarten({ speicher: { wahlDauer: "1200", wahlStufe: "full" } });
  t.after(p.aufraeumen);

  await p.klick("verbinden-start");

  assert.equal(p.gewaehlt("dauer"), "600", "unbekannte Dauer → kürzeste Vorgabe");
  assert.equal(p.gewaehlt("stufe"), "read", "unbekannte Stufe → schwächste Vorgabe");
});

test("M3g — Aus der Ablage kommt kein Selektor, sondern höchstens ein Wert", async (t) => {
  /* Der gemerkte Wert wandert in einen Selektor. Er wird deshalb nicht
     entschärft, sondern abgelehnt, wenn er nicht harmlos ist.
     Geprüft wird, dass der gebastelte Wert GAR NICHT erst zu einem Selektor
     wird — nicht, dass der Selektor folgenlos bliebe. Das Zweite könnte diese
     Attrappe nicht ehrlich zeigen, sie löst Selektorlisten nicht auf. */
  const gebastelt = '"], input[name="stufe"][value="write';
  const p = await panelStarten({ speicher: { wahlStufe: gebastelt, wahlDauer: "3600" } });
  t.after(p.aufraeumen);

  await p.klick("verbinden-start");

  assert.ok(
    !p.selektoren.some((s) => s.includes(gebastelt)),
    "ein Wert, der kein schlichtes Wort ist, darf nicht einmal als Selektor entstehen"
  );
  assert.equal(p.gewaehlt("stufe"), "read", "die Stufe bleibt auf der schwächsten Vorgabe");
  assert.equal(p.gewaehlt("dauer"), "3600", "der harmlose Wert daneben gilt weiterhin");
});

test("M2e — Läuft eine Sitzung, bietet KEIN Zustand einen zweiten Aufbau an", async (t) => {
  const p = await panelStarten({
    workerAntworten: {
      "link:verbinden": {
        ok: true,
        sitzung: {
          stufe: "write",
          code: "FF66AA",
          endetUm: Date.now() + 600000,
          modus: "tab",
          bereich: ["geizhals.de"],
          schrittmodus: "confirm_each",
        },
      },
    },
  });
  t.after(p.aufraeumen);

  await p.klick("verbinden-start");
  await p.klick("verbinden");
  assert.ok(p.zustand.sitzung, "Vorbedingung: eine Sitzung läuft");

  /*
   * Hier wird die Zusage selbst gefahren, nicht ein einzelner Bedienweg.
   *
   * Grund: Die Bedingung `|| !!zustand.sitzung` in setzeZustand ist die
   * ZWEITE Sperre. Die erste sind die Aufrufer, die bei laufender Sitzung
   * gar nicht erst auf `bereit` schalten. Am 06.08.2026 gegen die halbe
   * Änderung gemessen: Streicht man die zweite Sperre, bleibt jeder
   * Bedienweg grün — sie fängt nur, was ein künftiger Aufrufer falsch macht.
   * Ein Prüfsatz, der nur Bedienwege abfährt, kann sie deshalb nicht halten.
   */
  for (const name of ["bereit", "dialog", "anmeldung", "kennwort", "erklaerung", "aktiv"]) {
    p.f.setzeZustand(name);
    assert.equal(
      p.el("verbindungsleiste").hidden,
      true,
      `im Zustand „${name}" darf bei laufender Sitzung kein zweiter Aufbau angeboten werden`
    );
  }
});

test("M2f — Der Menüpunkt öffnet während einer Sitzung keinen zweiten Antrag", async (t) => {
  const p = await panelStarten({
    workerAntworten: {
      "link:verbinden": {
        ok: true,
        sitzung: {
          stufe: "write",
          code: "BB77CC",
          endetUm: Date.now() + 600000,
          modus: "tab",
          bereich: ["geizhals.de"],
          schrittmodus: "confirm_each",
        },
      },
    },
  });
  t.after(p.aufraeumen);

  await p.klick("verbinden-start");
  await p.klick("verbinden");
  assert.equal(p.el("app").dataset.state, "aktiv", "Vorbedingung: die Sitzung läuft");

  /* Der Menüpunkt ist der einzige Weg, der die Verbindungsleiste umgeht.
     Über ihn war der gemeinsame Abbruchweg während einer laufenden Sitzung
     erreichbar — und der gibt die Seitenrechte zurück. */
  await p.klick("menue-verbinden");

  assert.equal(
    p.el("app").dataset.state,
    "aktiv",
    "der Dialog darf sich bei laufender Sitzung nicht öffnen"
  );
  assert.equal(p.el("dialog").hidden, true, "und die Dialogkarte bleibt zu");
  assert.match(
    p.gesprochen.join(" "),
    /Es läuft schon eine Verbindung\./,
    "statt eines zweiten Antrags kommt der Weg über Stopp — und er wird gesagt"
  );
});

test("M2g — Knopfname und vorgelesene Aufforderung sind dasselbe Wort", () => {
  /* Der Wortlaut des Knopfes ist die Aussage selbst; hier ist die Textsuche
     der richtige Weg (siehe Kopf dieser Datei). Geprüft wird nicht, DASS ein
     bestimmter Text dasteht, sondern dass alle Stellen denselben Namen nennen
     — der Prüfsatz überlebt also eine Umbenennung des Knopfes. */
  const knopf = /<button id="verbinden-start"[^>]*>\s*([^<]+?)\s*<\/button>/.exec(html);
  assert.ok(knopf, "der Knopf zum Verbinden muss in panel.html stehen");
  const name = knopf[1];

  /* Zusammengesetzte Zeichenketten wieder zusammensetzen, sonst zerreißt ein
     Zeilenumbruch im Quelltext den Satz mitten im Knopfnamen. */
  const flach = (t) => String(t).replace(/"\s*\+\s*"/g, "");
  const texte = [flach(quelle), ...Object.values(erklaerungen.SPERRE).map((s) => s.text)].join("\n");

  const stellen = [...texte.matchAll(/drücke dort auf ([^."]+)\./g)].map((t) => t[1].trim());
  assert.ok(stellen.length >= 3, `die Aufforderung steht an ${stellen.length} Stellen, erwartet 3`);
  for (const stelle of stellen) {
    assert.equal(
      stelle,
      name,
      `„${stelle}" heißt der Knopf nicht — wer vorlesen lässt, sucht dann einen Knopf, den es nicht gibt`
    );
  }
});

/* ------------------------------------------------------------------ *
 * Der Antwortmodus (06.08.2026) — Normal Mode / SMarTrMode, gefahren.
 *
 * Zwei Modi, beide Produktnamen der Cloud; Smartest ist WEGGELASSEN, nicht
 * ausgegraut. Der Modus reist als Feld `modus` an chat:senden — der Worker
 * macht daraus die model_id auf der Leitung (net/chat.js). Hier wird die
 * Bedienung gefahren: wählen, ansagen, merken, mitschicken.
 * ------------------------------------------------------------------ */

test("Antwortmodus — die Wahl wird angesagt, gemerkt und reist mit chat:senden", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);

  /* Vorgabe ist der Normal Mode — er ist das heutige Verhalten. */
  assert.equal(p.zustand.chatModus, "normal");
  assert.equal(p.el("modus-normal").getAttribute("aria-pressed"), "true");
  assert.equal(p.el("modus-smartr").getAttribute("aria-pressed"), "false");

  await p.klick("modus-smartr");
  assert.equal(p.el("modus-smartr").getAttribute("aria-pressed"), "true");
  assert.equal(p.el("modus-normal").getAttribute("aria-pressed"), "false");
  assert.equal(p.ablage.chatModus, "smartr", "die Wahl ist auf diesem Gerät gemerkt");
  /* Angesagt ohne Gedankenstrich — Vorlesen ist der Haupt-Bedienweg. */
  assert.equal(p.el("ansage").textContent, "SMarTr Modus.");

  p.el("eingabe").value = "Hallo Niemand";
  await Promise.all(p.el("chatform").ausloesen("submit", { preventDefault() {} }));
  const senden = p.anWorkerVoll().find((n) => n.typ === "chat:senden");
  assert.ok(senden, "die Frage ging an den Hintergrunddienst");
  assert.equal(senden.modus, "smartr", "der gewählte Modus reist mit");

  /* Und zurück: Der Wechsel auf Normal wird ebenso angesagt und gesendet. */
  await p.klick("modus-normal");
  assert.equal(p.el("ansage").textContent, "Normal Modus.");
  assert.equal(p.ablage.chatModus, "normal");
});

test("Antwortmodus — ein wieder geöffnetes Panel stellt die gemerkte Wahl her", async (t) => {
  const p = await panelStarten({ speicher: { chatModus: "smartr" } });
  t.after(p.aufraeumen);

  assert.equal(p.zustand.chatModus, "smartr", "die Wahl übersteht das Schließen");
  assert.equal(p.el("modus-smartr").getAttribute("aria-pressed"), "true");
  assert.equal(p.el("modus-normal").getAttribute("aria-pressed"), "false");

  p.el("eingabe").value = "Weiter geht es";
  await Promise.all(p.el("chatform").ausloesen("submit", { preventDefault() {} }));
  const senden = p.anWorkerVoll().find((n) => n.typ === "chat:senden");
  assert.equal(senden.modus, "smartr", "auch die erste Frage nach dem Öffnen fährt die gemerkte Wahl");

  /* Fail-closed: Ein erfundener Wert in der Ablage fällt auf Normal zurück. */
  const q = await panelStarten({ speicher: { chatModus: "smartest" } });
  t.after(q.aufraeumen);
  assert.equal(q.zustand.chatModus, "normal", "nur die zwei gebauten Modi kommen zurück");
});
