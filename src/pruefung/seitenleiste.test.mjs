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
  /* Die Wahl des Menschen geht in den Antrag, aber uebersetzt: Auf der Leitung
     gibt es nur read und write, waehrend die Oberflaeche drei Moeglichkeiten
     anbietet. "Vollzugriff" ist write mit Selbstaendig-Modus. Geprueft wird
     deshalb, dass BEIDE Felder aus derselben Wahl entstehen und keines fest
     verdrahtet ist. */
  assert.ok(vorschlag.includes("access: stufeAufDerLeitung(wahl)"),
    "die Stufe entsteht aus der Wahl, nicht aus einem festen Wert");
  assert.ok(vorschlag.includes("step_mode: schrittmodusAus(wahl)"),
    "der Schrittmodus entsteht aus derselben Wahl");
  assert.ok(vorschlag.includes("const wahl = gewaehlteStufe()"),
    "und beide lesen dieselbe Quelle");
  assert.ok(!/step_mode: "auto"/.test(quelle),
    "der Selbstaendig-Modus darf nirgends fest verdrahtet sein");
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
const messform = await import("../net/messform.js");

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

/*
 * Was in welcher Karte steht — Ueberschrift und Inhalt, aus panel.html gelesen.
 *
 * Warum das hier stehen muss: Die Nachbildung kannte bisher nur lose
 * Einzelelemente ohne jede Verwandtschaft. Damit war die Frage „steht der Fokus
 * noch in dieser Karte?" unbeantwortbar, und die Ueberschrift, auf die die
 * Seitenleiste ihn beim Kartenwechsel setzt, gab es ueberhaupt nicht. Ein
 * Pruefsatz haette dann nur die Attrappe gemessen und nicht die Seitenleiste.
 */
const KARTE_IM_HTML = new Map();
for (const t of html.matchAll(/<section id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)) {
  const kopf = /<h2([^>]*)>([\s\S]*?)<\/h2>/.exec(t[2]);
  KARTE_IM_HTML.set(t[1], {
    /* Ueberschriften MIT Kennung entstehen ohnehin als eigenes Element; nur
       die namenlosen muss die Nachbildung selbst anlegen. */
    ueberschrift: kopf && !/\sid="/.test(kopf[1]) ? kopf[2].trim() : null,
    kinder: [...t[2].matchAll(/\sid="([^"]+)"/g)].map((k) => k[1]),
  });
}
const H2_KENNUNGEN = new Set([...html.matchAll(/<h2 id="([^"]+)"/g)].map((t) => t[1]));

/*
 * Welches Element eine Kennung in panel.html wirklich ist.
 *
 * Die Nachbildung gab bisher jedem Element `div`. Damit war die Zusage „ein
 * Knopf braucht kein tabindex und darf deshalb nicht aus der Tabulatorreihe
 * fallen" unpruefbar, denn ein div braucht sehr wohl eines — der Pruefsatz
 * haette den Unterschied gar nicht sehen koennen, um den es geht.
 */
const TAG_IM_HTML = new Map(
  [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)(?=[\s>])[^>]*?\sid="([^"]+)"/g)].map((t) => [
    t[2],
    t[1],
  ])
);
assert.equal(TAG_IM_HTML.get("freigabe-nein"), "button", "Gegenprobe: Ablehnen ist ein Knopf");
assert.equal(TAG_IM_HTML.get("eingabe"), "textarea", "Gegenprobe: das Eingabefeld ist ein Textfeld");
assert.equal(TAG_IM_HTML.get("erklaer-titel"), "h2", "Gegenprobe: die Erklaerung hat eine Ueberschrift");
assert.equal(TAG_IM_HTML.get("sitzungsleiste"), "div", "Gegenprobe: die Sitzungsleiste ist keiner von beiden");

assert.equal(
  KARTE_IM_HTML.get("dialog")?.ueberschrift,
  "Verbindung über SMarTrLink",
  "Gegenprobe: die Ueberschrift der Dialogkarte kommt aus panel.html"
);
assert.ok(
  KARTE_IM_HTML.get("freigabe")?.kinder.includes("freigabe-nein"),
  "Gegenprobe: der Ablehnen-Knopf steht wirklich in der Freigabekarte"
);
assert.ok(H2_KENNUNGEN.has("erklaer-titel"), "Gegenprobe: die Erklaerkarte hat eine benannte Ueberschrift");

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
/* Wo der Fokus gerade steht. Der Browser fuehrt das als document.activeElement,
   die Nachbildung fuehrt es hier, damit Pruefsaetze die Fokusfuehrung wirklich
   messen koennen statt sie nur zu behaupten. */
const fokusStand = { aktiv: null, koerper: null };

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
    _disabled: false,
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
    /* Sucht in den eigenen Kindern nach einer Klasse oder nach einem Element
       dieses Namens. Vorher gab diese Stelle ausnahmslos null zurueck, damit
       fand `menueOeffnen` nie einen Menuepunkt und die ganze Fokusfuehrung des
       Menues war unpruefbar; seit dem 11.08.2026 sucht die Seitenleiste dazu
       die Ueberschrift ihrer Karten (`querySelector("h2")`), und ohne diesen
       Zweig faende sie sie nie. Mehr als diese zwei Formen kann die
       Nachbildung weiterhin nicht, und das ist Absicht: ein unbekannter
       Selektor bleibt null statt still etwas Falsches zu liefern. */
    querySelector: (wahl) => {
      const w = String(wahl || "");
      const nachKlasse = w.startsWith(".");
      const nachNamen = /^[a-z][a-z0-9]*$/.test(w);
      if (!nachKlasse && !nachNamen) return null;
      const passt = (k) =>
        nachKlasse
          ? String(k.className || "").split(/\s+/).includes(w.slice(1))
          : String(k.tagName || "").toUpperCase() === w.toUpperCase();
      for (const k of el.kinder) {
        if (typeof k === "string") continue;
        if (passt(k)) return k;
        const tiefer = typeof k.querySelector === "function" ? k.querySelector(w) : null;
        if (tiefer) return tiefer;
      }
      return null;
    },
    closest: () => null,
    /* Enthaelt dieser Knoten den anderen? Der Browser kann das, die Nachbildung
       konnte es nicht, und deshalb war jede Zusicherung ueber die Fokusfuehrung
       hier blind. `contains(el)` ist im Browser wahr fuer den Knoten selbst. */
    contains(anderer) {
      if (!anderer) return false;
      if (anderer === el) return true;
      return el.kinder.some((k) => (typeof k.contains === "function" ? k.contains(anderer) : k === anderer));
    },
    focus() {
      el.fokusse += 1;
      fokusStand.aktiv = el;
    },
    /* Ein programmatischer Klick. Der Browser kann das an jedem Element, die
       Nachbildung brauchte es fuer den Ausgabe-Knopf des Protokollbuchs: Er
       loest den Verweis mit der data-Adresse aus, und ohne diesen Weg waere
       nicht zu messen, dass die Datei wirklich angeboten wird. */
    click() {
      el.klicks += 1;
      return el.ausloesen("click");
    },
    klicks: 0,
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
  /* Ein abgeschaltetes Element haelt den Fokus nicht — der Browser gibt ihn in
     dem Augenblick an den Seitenkoerper zurueck. Genau das passiert dem
     Beispielauftrag: Er schaltet seinen eigenen Knopf ab, waehrend der Mensch
     darauf steht. Ohne diesen Nachbau bliebe der Fokus in der Nachbildung
     seelenruhig auf einem toten Knopf liegen, und die Zusage „danach steht er
     wieder auf dem Knopf" waere nicht zu messen. */
  Object.defineProperty(el, "disabled", {
    get: () => el._disabled,
    set(an) {
      el._disabled = !!an;
      if (el._disabled && fokusStand.aktiv === el) fokusStand.aktiv = fokusStand.koerper;
    },
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
  kennwortZeigen,
  protokollieren, zeitStempel,
  tabsAuffrischen, waehlbareTabs, tabVerbindenMit, tabVerbinden,
  tabListeSelbstZeichnen, verbindungswegZeichnen, sitzungsTab,
  modusSetzen, modusHolen, modusSpiegeln, modusTabId,
  cloudSitzungZeigen, notAus,
  werkbankOeffnen, buchOeffnen, buchAusgeben,
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
  /* Alle offenen Tabs. `null` heisst: nur der eine oben. Ohne diese Angabe
     liesse sich die Tab-Liste nicht pruefen — sie ist der einzige Weg zu einem
     ANDEREN Fenster, und ein Weg ohne Pruefsatz verschwindet beim naechsten
     Umbau still. */
  alleTabs = null,
  /* Was src/panel/startseite.js und src/panel/werkbank.js beisteuern. Beide
     Dateien gehoeren A-WERKBANK (Vertrag §1); hier steht, WAS die
     Seitenleiste von ihnen ruft. Leer heisst: die Seitenleiste zeichnet
     selbst, und genau das muss sie koennen. */
  startseiteModul = {},
  werkbankModul = {},
  /*
   * Ob die Cloud auf dem Weg zum Ticket ein Kennwort verlangt.
   *
   * Befund Abnahme 14.08.2026 (N2): Die Attrappe gab bis dahin ausnahmslos
   * sofort ein Ticket zurueck und liess damit genau die Stelle weg, an der ein
   * Mensch im echten Chrome noch einmal etwas tun muss — im anderen Tab
   * vergleichen und freigeben. Ein Pruefsatz ueber „genau EIN Klick" ueber
   * einer Attrappe, die das Nachfragen wegnimmt, misst die Attrappe.
   */
  freigabeMitKennwort = false,
} = {}) {
  const spur = []; // an den Hintergrunddienst
  const anTabSpur = []; // an das Seitenskript
  const bindSpur = []; // an das Gateway (nur /bind)
  const gesprochen = []; // was die Stimme wirklich gesagt hat
  /* Was WIRKLICH beantragt wurde. Der Wunsch (`gewuenscht`) entsteht tief in
     geltungsbereichVorschlag() und verlässt die Seitenleiste nur hier, auf dem
     Weg zur Freigabeseite. Ihn hier abzugreifen ist der einzige Weg, die
     Stufenwahl zu MESSEN statt sie im Quelltext nachzulesen. */
  const ticketSpur = [];
  /* Jede Rückgabe eines Seitenrechts. Das Recht ist das, was der Agent
     wirklich in der Hand hat — ob es zurückgegeben wurde, ist deshalb keine
     Frage des Aussehens, sondern die Frage, ob er noch arbeiten kann. */
  const rechteZurueck = [];
  /*
   * Was der BROWSER und die Cloud selbst noch fragen, nachdem der Mensch in
   * der Seitenleiste gedrueckt hat.
   *
   * Ohne diese Liste war „genau EIN Klick" eine halbe Wahrheit: Gezaehlt wurden
   * die Klicks in der Seitenleiste, und die beiden Stellen, an denen der Mensch
   * im echten Chrome trotzdem noch einmal drueckt, hatte die Attrappe
   * weggenommen (`permissions.request` sagt zu allem sofort ja, das Ticket kam
   * ohne Kennwort). Gemessen wird ab jetzt beides getrennt: die Klicks HIER und
   * die Fragen DORT. Eine ehrliche Zwei ist mehr wert als eine gemessene Eins.
   */
  const browserFragen = [];
  /* Was am FENSTER hängt (pagehide, keydown). Bis zum 10.08.2026 verschluckte
     diese Attrappe jeden Fensterzuhörer — damit war ausgerechnet der Weg
     unprüfbar, auf dem die Seitenleiste bisher die Sitzung abriss. */
  const fensterHoerer = new Map();
  const uhren = new Set();
  const hoerer = [];
  const elemente = new Map();
  let heutigerAusweis = ausweis;
  /* Die Reihenfolge der Aufrufe, auf die es beim einen Klick ankommt.
     `chrome.permissions.request` verlangt eine Nutzergeste, und die ist nach
     dem ersten await verbraucht: Steht vor ihr eine Tab-Abfrage, ist der Klick
     im echten Chrome wirkungslos. Das laesst sich nur an der REIHENFOLGE
     messen, nicht am Ergebnis — die Attrappe sagt zu allem ja. */
  const aufrufe = [];
  /* Was an den Tabs haengt. Der Browser meldet Wechsel, die Seitenleiste muss
     ihren Bestand danach nachziehen; ohne diese Anschluesse waere das nicht zu
     fahren. */
  const tabHoerer = new Map([
    ["onActivated", []],
    ["onUpdated", []],
    ["onRemoved", []],
  ]);
  const tabAnschluss = (art) => ({ addListener: (f) => tabHoerer.get(art).push(f) });
  let klickZahl = 0;

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

  /* Der Seitenkoerper. Im Browser liegt der Fokus beim Laden auf ihm, und
     „auf `body`" ist die ganze Krankheit, um die es bei der Fokusfuehrung geht.
     Ohne ihn stuende hier `null`, und ein Pruefsatz haette nichts, wogegen er
     „nicht auf body" messen koennte. */
  const koerper = knoten("body");
  fokusStand.aktiv = koerper;
  fokusStand.koerper = koerper;

  const doc = {
    body: koerper,
    getElementById(id) {
      assert.ok(IDS_IM_HTML.has(id), `panel.html kennt kein Element mit der Kennung „${id}"`);
      if (!elemente.has(id)) {
        const neu = knoten(TAG_IM_HTML.get(id) || "div", id);
        neu.ownerDocument = doc;
        /* Der Ausgangszustand kommt aus panel.html, nicht aus der Attrappe. */
        neu.hidden = VERSTECKT_IM_HTML.has(id);
        /* Erst ablegen, dann fuellen: Die Kinder holen sich ihre Geschwister
           ueber denselben Weg, und ohne diese Reihenfolge liefe er im Kreis. */
        elemente.set(id, neu);
        /* Das Menue traegt in panel.html Menuepunkte. Ohne sie kann kein
           Pruefsatz sehen, wohin der Fokus beim Oeffnen wandert. */
        if (id === "menue") {
          const punkt = knoten("button", "menue-punkt-1");
          punkt.className = "menue-punkt";
          neu.appendChild(punkt);
        }
        /* Eine Karte bekommt ihre Ueberschrift und ihren Inhalt, so wie sie in
           panel.html darin stehen. */
        const karte = KARTE_IM_HTML.get(id);
        if (karte) {
          if (karte.ueberschrift) {
            const kopf = knoten("h2");
            kopf.textContent = karte.ueberschrift;
            neu.appendChild(kopf);
          }
          for (const kind of karte.kinder) neu.appendChild(doc.getElementById(kind));
        }
      }
      return elemente.get(id);
    },
    createElement: (tag) => {
      const neu = knoten(tag);
      /* Wie im Browser: Jedes Element kennt sein Dokument. Fremde Ansichten
         (src/panel/startseite.js, src/panel/werkbank.js) holen sich darueber
         ihren `createElement` — ohne diese Zeile faenden sie keines und
         fielen still auf die Ersatzfassung zurueck, und der Pruefsatz maesse
         dann die Ersatzfassung statt der Uebergabe. */
      neu.ownerDocument = doc;
      return neu;
    },
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
    get activeElement() {
      return fokusStand.aktiv;
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
          if (Object.hasOwn(workerAntworten, nachricht.typ)) {
            const antwort = workerAntworten[nachricht.typ];
            /* Eine Funktion darf je Aufruf etwas anderes sagen — genau das tut
               der Hintergrunddienst: Der erste `link:verbinden` bekommt die
               Sitzung, der zweite ein „schon verbunden". Ohne diesen Weg liesse
               sich der Wettlauf aus B8 gar nicht fahren, und ein Wettlauf, den
               niemand fahren kann, hat keinen Pruefsatz. */
            return typeof antwort === "function" ? antwort(nachricht) : antwort;
          }
          return { ok: true };
        },
      },
      tabs: {
        onActivated: tabAnschluss("onActivated"),
        onUpdated: tabAnschluss("onUpdated"),
        onRemoved: tabAnschluss("onRemoved"),
        async query(angaben) {
          aufrufe.push("tabs.query");
          /* Die Suche nach dem Cloud-Tab trägt eine Adresse; die nach dem
             aktiven Tab nicht. Ein Cloud-Tab ist hier nie offen. */
          const a = angaben || {};
          if (a.url) return [];
          const liste = Array.isArray(alleTabs) ? alleTabs : [tab];
          if (a.active) {
            const aktive = liste.filter((t) => t && t.active);
            return aktive.length ? aktive : [tab];
          }
          return liste;
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
  sandbox.window.addEventListener = (art, f) => {
    if (!fensterHoerer.has(art)) fensterHoerer.set(art, []);
    fensterHoerer.get(art).push(f);
  };

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
      async freigabeDurchlaufen(angaben) {
        ticketSpur.push(angaben || {});
        /* Verlangt die Cloud ein Kennwort, muss der Mensch in einem ZWEITEN
           Tab vergleichen und freigeben. Das ist keine Kleinigkeit am Rand,
           das ist der zweite Handgriff im ganzen Weg — und ohne ihn misst
           „ein Klick" an der Wirklichkeit vorbei (N2). */
        if (freigabeMitKennwort && typeof angaben?.aufKennwort === "function") {
          browserFragen.push("freigabeseite-in-der-cloud");
          angaben.aufKennwort({
            kennwort: "K7RM2X",
            buchstabiert: "K 7 R M 2 X",
            ansage: "Kaufmann sieben Richard Martha zwei Xanthippe",
            adresse: "https://cloud.smartragents.ai/link/freigabe?t=probe",
          });
        }
        return { ticket: "ticket-attrappe" };
      },
      async freigabeseiteOeffnen() {},
    },
    /* Die echten Rechte, nur mit einem Zähler an der Rückgabe. Ein Ersatz
       wäre hier falsch: `rechtHolen` entscheidet mit der Sperre aus §7.3 über
       den ganzen Verbindungsweg, und den soll die Prüfung fahren, nicht
       nachbilden. */
    "../net/rechte.js": {
      ...rechte,
      /* Nur mitschreiben, sonst unveraendert: Die Chrome-Abfrage ist die
         Stelle, an der die Nutzergeste verbraucht wird. Ihr Platz in der
         Reihenfolge IST die Zusage (Prüfsatz E2). */
      async rechtHolen(muster) {
        aufrufe.push("permissions.request");
        /* Chrome zeigt hier seinen eigenen Dialog. Die Attrappe sagt sofort ja,
           der Mensch tut es nicht — also wird die Frage wenigstens gezaehlt und
           benannt (N2). */
        browserFragen.push("chrome-freigabe-fuer-diese-seite");
        return rechte.rechtHolen(muster);
      },
      async rechtZurueckgeben(muster) {
        rechteZurueck.push(muster ?? null);
        return rechte.rechtZurueckgeben(muster);
      },
    },
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
    /* Die gemeinsame Messform, unveraendert und echt. Sie ist die EINE Fassung
       dafuer, was ein unsichtbares Zeichen in einem Fremdtext bedeutet; eine
       Attrappe hier hiesse, panel.js gegen eine Regel zu messen, die es im
       Betrieb nicht gibt. */
    "../net/messform.js": messform,
    /* Beide Dateien gehoeren A-WERKBANK und entstehen in derselben Stufe.
       Leer ist hier der HAERTERE Fall: Er misst, dass die Seitenleiste auch
       dann eine Liste hinstellt, wenn dort noch nichts steht. */
    "./startseite.js": startseiteModul,
    "./werkbank.js": werkbankModul,
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
    /* Wo der Fokus wirklich steht — und der Seitenkoerper zum Vergleich, denn
       „auf body" ist der Befund, gegen den hier gemessen wird. */
    fokus: () => doc.activeElement,
    koerper,
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
    /* Jeder Klick wird gezaehlt. Der Zaehler ist der einzige ehrliche Weg, die
       Zusage „hoechstens EIN Klick bis zur aktiven Verbindung" zu messen: Ob
       ein Weg kurz ist, sieht man nicht am Quelltext, sondern daran, wie oft
       ein Mensch druecken muss. */
    async klick(id) {
      klickZahl += 1;
      await Promise.all(el(id).ausloesen("click"));
    },
    klicks: () => klickZahl,
    klicksZuruecksetzen: () => {
      klickZahl = 0;
    },
    /* Ein Klick auf ein Element, das die Seitenleiste selbst gebaut hat — die
       Zeilen der Tab-Liste zum Beispiel. Zaehlt genauso mit. */
    async klickAuf(element) {
      klickZahl += 1;
      await Promise.all(element.ausloesen("click"));
    },
    /* Die Reihenfolge der Aufrufe seit dem letzten Leeren. */
    aufrufe: () => [...aufrufe],
    aufrufeLeeren: () => {
      aufrufe.length = 0;
    },
    /* Ein Ereignis an den Tabs ausloesen, wie der Browser es meldet. */
    async tabEreignis(art, ...angaben) {
      const liste = tabHoerer.get(art) || [];
      assert.ok(liste.length, `auf „${art}" hoert in der Seitenleiste niemand`);
      await Promise.all(liste.map((f) => f(...angaben)));
      /* tabsAuffrischen laeuft asynchron weiter; ein Durchlauf der
         Warteschlange genuegt, damit die Liste danach steht. */
      await new Promise((f) => setTimeout(f, 0));
      await new Promise((f) => setTimeout(f, 0));
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
    /*
     * Der SATZ einer Protokollzeile, ohne den Zeitstempel.
     *
     * Seit dem 14.08.2026 traegt jede Zeile ein <time> (Vertrag §6). Der
     * Zeitstempel hat seinen eigenen Pruefsatz (P2); wo es um den Wortlaut der
     * Meldung geht, wird der Wortlaut gemessen und nicht die Uhrzeit davor.
     * `protokoll()` bleibt daneben stehen und liefert die ganze Zeile — nichts
     * wird versteckt, es wird nur getrennt gemessen.
     */
    protokollSatz: () =>
      el("protokoll").kinder.map((li) =>
        li.kinder
          .filter((k) => typeof k === "string" || String(k.tagName).toUpperCase() !== "TIME")
          .map((k) => (typeof k === "string" ? k : k.textContent))
          .join("")
          .trim()
      ),
    /* Die <time>-Elemente je Zeile — Anzahl, sichtbarer Text und das
       maschinenlesbare `datetime`. */
    protokollZeiten: () =>
      el("protokoll").kinder.map((li) =>
        li.kinder.filter((k) => typeof k !== "string" && String(k.tagName).toUpperCase() === "TIME")
      ),
    verlauf: () => el("verlauf").kinder.map((k) => k.textContent),
    anWorker: () => spur.map((n) => n.typ),
    /* Dieselbe Spur mit allen Feldern — für Zusagen über das, was MITREIST
       (z. B. der Antwortmodus an chat:senden), nicht nur über den Typ. */
    anWorkerVoll: () => spur.map((n) => ({ ...n })),
    anTab: () => anTabSpur.map((n) => n.typ),
    bindAufrufe: () => bindSpur,
    /* Die Anträge, die wirklich auf den Weg zur Freigabeseite gegangen sind. */
    antraege: () => ticketSpur,
    /* Wie oft die Seitenleiste ein Seitenrecht zurückgegeben hat. */
    rechteRueckgaben: () => rechteZurueck.length,
    /* Was Browser und Cloud selbst noch fragen, in der Reihenfolge, in der sie
       fragen. Das ist der ehrliche Teil der Zusage „ein Klick" (N2). */
    browserFragen: () => [...browserFragen],
    browserFragenLeeren: () => {
      browserFragen.length = 0;
    },
    /* Ein Ereignis am Fenster auslösen — pagehide ist der Weg, auf dem die
       Seitenleiste verschwindet. Gibt es dafür gar keinen Zuhörer mehr, ist
       das schon der Befund. */
    async fensterEreignis(art, ereignis = {}) {
      const liste = fensterHoerer.get(art) || [];
      assert.ok(liste.length, `auf „${art}" hört in der Seitenleiste niemand`);
      await Promise.all(liste.map((f) => f(ereignis)));
    },
    spurLeeren: () => {
      spur.length = 0;
      bindSpur.length = 0;
      gesprochen.length = 0;
    },
    /* Alles auf null, auch der Weg zur Seite und die Rechte-Rückgaben. Als
       eigener Weg neben spurLeeren(), damit kein bestehender Prüfsatz seine
       Vorgeschichte verliert. */
    alleSpurenLeeren: () => {
      spur.length = 0;
      bindSpur.length = 0;
      gesprochen.length = 0;
      anTabSpur.length = 0;
      ticketSpur.length = 0;
      rechteZurueck.length = 0;
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
    /* Der Satz, nicht die Zeile: Seit dem 14.08.2026 steht die Uhrzeit davor
       (Vertrag §6), gemessen wird hier weiterhin der Wortlaut. */
    p.protokollSatz().some((z) => z.startsWith("Abgelehnt")),
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
  /* Der Satz, nicht die Zeile: Seit dem 14.08.2026 steht die Uhrzeit davor
     (Vertrag §6). Sie hat ihren eigenen Prüfsatz (P2), gemessen wird hier
     unverändert der Wortlaut der Meldung. */
  const zeile = p.protokollSatz().at(-1);
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
  assert.equal(p.protokollSatz().at(-1), "Arbeitet: etwas");
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

  /*
   * Geändert am 14.08.2026, und zwar begründet.
   *
   * Hier stand: „vor dem Dialog steht noch die Vorgabe aus dem HTML", gemessen
   * als `gewaehlt("dauer") === "600"`. Das war eine Zusage über einen inneren
   * Zwischenstand, keine über den Menschen — und sie stand dem Befund M8 im
   * Weg: Der eine Klick beantragt die gemerkte Stufe, bis hin zu Vollzugriff,
   * und muss sie deshalb NENNEN, bevor er gedrückt wird. Nennen kann sie nur,
   * wer sie kennt, und zwei Lesarten derselben Ablage wären zwei Wahrheiten.
   * Also wird die gemerkte Wahl seit dem 14.08.2026 schon beim Laden
   * hergestellt (einstellungenLaden → auswahlHerstellen), und Anzeige wie
   * Antrag lesen danach dieselben Felder.
   *
   * Was die Zusage IMMER war, bleibt und wird darunter unverändert gemessen:
   * Der Dialog zeigt die gemerkte Wahl, und die Zusammenfassung liest sie vor.
   */
  assert.equal(zweite.gewaehlt("dauer"), "3600", "die gemerkte Wahl steht schon vor dem Dialog");
  assert.equal(
    zweite.el("verbinden-stufe").textContent.startsWith("Bedienen"),
    true,
    "und der eine Klick nennt sie, bevor er gedrückt wird (M8)"
  );
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

/*
 * Fokusfuehrung des Menues.
 *
 * Vorlesen ist der Haupt-Bedienweg des Inhabers, die Fokusfuehrung entscheidet
 * also darueber, wo ein Bildschirmleser nach dem Schliessen weiterliest. Beim
 * Schliessen wurde das Menue schlicht versteckt, waehrend der Fokus noch in
 * einem seiner Punkte stand: Er fiel damit auf den Seitenanfang statt auf den
 * Knopf, den der Mensch gerade gedrueckt hatte. Gemessen wird beides, das
 * Hineinwandern beim Oeffnen und das Zurueckgeben beim Schliessen.
 */
test("Menue — der Fokus wandert hinein und kommt beim Schliessen zurueck", async (t) => {
  const p = await panelStarten({});
  t.after(p.aufraeumen);

  const knopfVorher = p.el("menue-knopf").fokusse;
  await p.klick("menue-knopf");
  assert.equal(p.el("menue").hidden, false, "Vorbedingung: das Menue ist offen");
  assert.equal(
    p.el("menue").getAttribute("aria-expanded"),
    null,
    "das aria-expanded gehoert an den Knopf, nicht an das Menue"
  );
  assert.equal(p.el("menue-knopf").getAttribute("aria-expanded"), "true", "der Knopf meldet den offenen Zustand");

  /* Jetzt schliessen. Der Fokus steht in einem Menuepunkt, weil menueOeffnen
     ihn dorthin gesetzt hat. */
  await p.klick("menue-knopf");
  assert.equal(p.el("menue").hidden, true, "das Menue ist wieder zu");
  assert.ok(
    p.el("menue-knopf").fokusse > knopfVorher,
    "beim Schliessen muss der Fokus auf den Menue-Knopf zurueckgegeben werden"
  );
  assert.equal(p.el("menue-knopf").getAttribute("aria-expanded"), "false", "der Knopf meldet den geschlossenen Zustand");
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
  /* Gemessen wird der Knopf, der WIRKLICH verbindet. Seit dem 14.08.2026 ist
     das #verbinden-tab: #verbinden-start führt nur noch in den Dialog für
     Dauer und Geltung. Wer sich die Sperr-Erklärung vorlesen lässt und dann
     „Dauer und Geltung ändern" drückte, käme nicht ans Ziel — die Aufforderung
     muss den Regelweg nennen, nicht die Ausnahme. */
  const knopf = /<button id="verbinden-tab"[^>]*>\s*([^<]+?)\s*<\/button>/.exec(html);
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

/* ================================================================== *
 * Die Stufe „Vollzugriff" und das Ende der Reißleine
 * (Inhaber-Entscheid 10.08.2026)
 *
 * Zwei Entscheidungen, die zusammengehören: Erst wenn der Mensch eine Stufe
 * wählen kann, in der der Agent nicht bei jedem Schritt fragt, ergibt es
 * überhaupt einen Sinn, dass die Seitenleiste die Sitzung nicht mehr beim
 * Schließen abreißt. Vorher war Arbeit im Hintergrund baulich unmöglich.
 *
 * Beide Zusagen sind Zusagen über VERHALTEN und werden deshalb gefahren. Der
 * Antrag, den die Seitenleiste stellt, verlässt sie an genau einer Stelle: auf
 * dem Weg zur Freigabeseite (ticket.freigabeDurchlaufen). Dort wird er
 * abgegriffen — im Quelltext nachgelesen wäre er nur eine Behauptung.
 * ================================================================== */

const sitzungAntwort = () => ({
  ok: true,
  sitzung: {
    stufe: "write",
    code: "VV11WW",
    endetUm: Date.now() + 600000,
    modus: "tab",
    bereich: ["geizhals.de"],
    schrittmodus: "confirm_each",
  },
});

/**
 * Den ganzen Verbindungsweg mit einer Stufe fahren und den Antrag zurückgeben,
 * der dabei wirklich entstanden ist. `stufe === null` heißt: nichts wählen —
 * der übliche Zwei-Klick-Weg mit der Vorbelegung aus panel.html.
 */
async function antragMitStufe(t, stufe) {
  const p = await panelStarten({ workerAntworten: { "link:verbinden": sitzungAntwort() } });
  t.after(p.aufraeumen);
  await p.klick("verbinden-start");
  if (stufe !== null) await p.waehlen("stufe", stufe);
  await p.klick("verbinden");
  assert.equal(p.el("app").dataset.state, "aktiv", "Vorbedingung: der Weg lief durch");
  assert.equal(p.antraege().length, 1, "genau ein Antrag geht zur Freigabeseite");
  return p.antraege()[0].gewuenscht;
}

test("S1 — Jede der drei Stufen erzeugt genau den Antrag, den sie verspricht", async (t) => {
  /* a) Zusehen bleibt Zusehen. */
  const lesen = await antragMitStufe(t, "read");
  assert.equal(lesen.access, "read");
  assert.equal(lesen.step_mode, "confirm_each");

  /* b) Bedienen darf klicken und tippen — und fragt trotzdem bei jedem
     Schritt. Das ist der Unterschied zu Vollzugriff, und er ist der ganze
     Grund, warum es drei Knöpfe gibt und nicht zwei. */
  const bedienen = await antragMitStufe(t, "write");
  assert.equal(bedienen.access, "write");
  assert.equal(bedienen.step_mode, "confirm_each");

  /* c) Vollzugriff ist auf der Leitung dieselbe Stufe wie Bedienen, nur ohne
     Einzelfreigabe. `full` wird ausdrücklich NICHT beantragt: Was `full` dort
     zusätzlich freigäbe, sind eval, terminal und maintenance — Befehle, die
     diese Erweiterung gar nicht kennt. Ein Antrag darauf wäre entweder
     wirkungslos oder gefährlich, und beides ist keine Wahl. */
  const voll = await antragMitStufe(t, "voll");
  assert.equal(voll.access, "write", "die Leitung kennt kein drittes Wort für diese Stufe");
  assert.equal(voll.step_mode, "auto", "genau das ist der Unterschied: keine Einzelfreigabe");

  /* Drei Wahlen, drei Anträge. Fällt eine der drei mit einer anderen
     zusammen, hat der Mensch einen Knopf ohne Wirkung gedrückt — und das ist
     schlimmer als ein fehlender Knopf. */
  const paare = [lesen, bedienen, voll].map((g) => `${g.access}/${g.step_mode}`);
  assert.equal(new Set(paare).size, 3, `drei Stufen, aber nur ${new Set(paare).size} Anträge: ${paare}`);
  assert.ok(
    !paare.some((s) => s.startsWith("full/")),
    "die Erweiterung beantragt die Stufe full nie — sie hat keinen einzigen Befehl daraus"
  );

  /* Und der Selbständig-Modus entsteht wirklich aus der Wahl, nicht aus der
     Dauer oder dem Bereich: Alles andere ist bei allen dreien gleich. */
  for (const g of [lesen, bedienen, voll]) {
    assert.equal(g.mode, "tab");
    /* Über die Realmgrenze der Sandbox hinweg wird der Inhalt verglichen, nicht
       der Bauplan: Die Liste stammt aus dem eigenen Kontext von panel.js. */
    assert.deepEqual([...g.allow], ["geizhals.de"]);
  }
});

test("S2 — Vorbelegt bleibt die schwächste der angebotenen Stufen", async (t) => {
  /* d) Der übliche Weg ist zwei Klicks ohne Entscheidung. Wer nichts wählt,
     bekommt die schwächste Stufe — nicht die zuletzt hinzugefügte. */
  const vorgabe = await antragMitStufe(t, null);
  assert.equal(vorgabe.access, "read", "ohne Wahl wird nur zugesehen");
  assert.equal(vorgabe.step_mode, "confirm_each", "und jeder Schritt einzeln bestätigt");

  /* Gemessen wird „die schwächste", nicht „read": Die Vorbelegung wird gegen
     die Rangfolge der WIRKLICH angebotenen Knöpfe geprüft. Ein neuer, noch
     stärkerer Knopf mit Haken fiele hier durch, ein umbenannter nicht. */
  const RANG = { read: 0, write: 1, voll: 2 };
  const knoepfe = [...html.matchAll(/<input type="radio" name="stufe" value="([^"]+)"([^>]*)>/g)]
    .map((tr) => ({ wert: tr[1], gehakt: /\bchecked\b/.test(tr[2]) }));
  assert.deepEqual(
    knoepfe.map((k) => k.wert).sort(),
    ["read", "voll", "write"],
    "angeboten werden genau die drei gebauten Stufen"
  );
  for (const k of knoepfe) {
    assert.ok(Object.hasOwn(RANG, k.wert), `unbekannte Stufe im Dialog: ${k.wert}`);
  }
  const schwaechste = knoepfe.map((k) => k.wert).sort((a, b) => RANG[a] - RANG[b])[0];
  assert.deepEqual(
    knoepfe.filter((k) => k.gehakt).map((k) => k.wert),
    [schwaechste],
    "genau ein Haken, und er sitzt auf der schwächsten angebotenen Stufe"
  );
});

test("S3 — Die Stufenwahl steht VOR dem Aufklapper, nicht darin", () => {
  /* e) Bis zum 10.08.2026 lag die Stufe hinter „Dauer und Geltung ändern" und
     war mit „Nur zusehen" vorbelegt: Der übliche Zwei-Klick-Weg endete damit
     ausnahmslos in einer Lesesitzung. Gemessen wird die Reihenfolge der
     Stellen im Text, nicht das bloße Vorkommen — „steht irgendwo im HTML" war
     schon vorher wahr, als sie eingeklappt war. */
  const dialogAb = html.indexOf('<section id="dialog"');
  assert.ok(dialogAb >= 0, "die Dialogkarte muss in panel.html stehen");

  const aufklapper = html.indexOf('id="einstellungen-aendern"', dialogAb);
  const mehrAuf = html.indexOf('<div id="dialog-mehr"', dialogAb);
  const mehrZu = html.indexOf("/#dialog-mehr", mehrAuf);
  assert.ok(aufklapper > dialogAb, "der Aufklapper-Knopf gehört in die Dialogkarte");
  assert.ok(mehrAuf > aufklapper, "der eingeklappte Teil folgt seinem Knopf");
  assert.ok(mehrZu > mehrAuf, "der eingeklappte Teil hat ein Ende");
  assert.match(
    html.slice(aufklapper, mehrAuf),
    /Dauer und Geltung ändern/,
    "Gegenprobe: es ist wirklich der Aufklapper, der hier gemessen wird"
  );

  const stellen = (name) => [...html.matchAll(new RegExp(`name="${name}"`, "g"))].map((tr) => tr.index);

  const stufen = stellen("stufe");
  assert.equal(stufen.length, 3, `drei Stufenknöpfe erwartet, gefunden: ${stufen.length}`);
  for (const i of stufen) {
    assert.ok(
      i > dialogAb && i < aufklapper,
      "jede Stufe steht vor dem Aufklapper, ist also ohne Aufklappen zu sehen"
    );
    assert.ok(!(i > mehrAuf && i < mehrZu), "und keine liegt im eingeklappten Teil");
  }

  /* Gegenprobe, damit der Satz oben etwas misst: Die Dauer liegt sehr wohl im
     eingeklappten Teil. Wäre der Aufklapper leer oder verschwunden, stünden
     die Stufen trivial davor. */
  const dauern = stellen("dauer");
  assert.ok(dauern.length >= 4, "die Dauerauswahl gibt es weiterhin");
  for (const i of dauern) {
    assert.ok(i > mehrAuf && i < mehrZu, "die Dauer bleibt hinter dem Aufklapper");
  }
});

test("S4 — Das Etikett „Vollzugriff“ verspricht nichts, was nicht gilt", async (t) => {
  /* f) Vollzugriff heißt: bedienen dürfen UND nicht bei jedem Schritt gefragt
     werden. Es heißt NICHT, dass der Agent Passwörter tippt oder sich
     anmeldet — das kann und darf er nicht, und ein Etikett, das es andeutet,
     wäre die teuerste Unwahrheit im ganzen Dialog. */
  const etikett = /<input type="radio" name="stufe" value="voll"[^>]*>\s*([^<]+)/.exec(html);
  assert.ok(etikett, "die Stufe „voll“ muss in panel.html angeboten werden");

  /* Was der Mensch nach der Wahl WIRKLICH zu lesen bekommt — gefahren, nicht
     aus dem Quelltext abgeschrieben. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.klick("verbinden-start");
  await p.waehlen("stufe", "voll");
  const fassung = p.el("zusammenfassung").textContent;
  assert.match(
    fassung,
    /selbständig weiterarbeiten/,
    "Gegenprobe: die Zusammenfassung spricht wirklich von der Vollzugriff-Wahl"
  );

  const vollBlock = abschnitt("  voll: {", "};");
  const ZU_VIEL_VERSPROCHEN = [
    [/passwor|passwör|kennwort/i, "Passwörter"],
    [/\bmeldet? (sich|dich) an\b/i, "sich anmelden"],
    [/\bloggt? (sich|dich) ein\b/i, "sich einloggen"],
    [/\b(darf|kann|übernimmt)[^.]{0,60}\banmeld/i, "die Anmeldung übernehmen"],
  ];
  for (const text of [etikett[1].trim(), fassung, vollBlock]) {
    for (const [muster, was] of ZU_VIEL_VERSPROCHEN) {
      assert.ok(!muster.test(text), `Vollzugriff verspricht „${was}“: ${text}`);
    }
  }

  /* Und der Vorbehalt steht nicht irgendwo, sondern bei der Wahl selbst: Wer
     sich die Seite vorlesen lässt, hört ihn im selben Atemzug mit den drei
     Knöpfen. */
  const feldAb = html.lastIndexOf("<fieldset", html.indexOf('name="stufe"'));
  const feld = html.slice(feldAb, html.indexOf("</fieldset>", feldAb));
  assert.match(feld, /name="stufe" value="voll"/, "Gegenprobe: es ist das Feld mit den Stufen");
  assert.match(feld, /Passwörter tippt der Agent nie/);
  assert.match(feld, /Anmelden machst du selbst/);
  assert.match(
    vollBlock,
    /Anmelden\s+(machst|übernimmst)\s+du\s+selbst/,
    "auch die Ansage zur Stufe sagt, was beim Menschen bleibt"
  );
});

test("S5 — Die Seitenleiste ist nicht mehr die Reißleine", async (t) => {
  /* g) und i) — Vorher riss das Schließen der Leiste dem Agenten mitten im
     Auftrag die Sitzung weg, samt Seitenrecht und Rahmen. Zusammen mit der
     Einzelfreigabe war damit jede Arbeit im Hintergrund baulich unmöglich. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.alleSpurenLeeren();

  await p.fensterEreignis("pagehide");

  assert.ok(
    !p.anWorker().includes("link:trennen"),
    "das Schließen der Leiste beendet die Sitzung nicht mehr"
  );
  assert.ok(p.zustand.sitzung, "die Sitzung gehört dem Hintergrunddienst und läuft weiter");
  assert.equal(
    p.rechteRueckgaben(),
    0,
    "und das Seitenrecht bleibt: ohne es könnte der Agent nichts mehr tun"
  );
  assert.ok(
    !p.anTab().includes("overlay:aus"),
    "der Rahmen bleibt gerade dann stehen, wenn niemand zusieht — er sagt „hier arbeitet eine Maschine“"
  );
  assert.ok(!p.anTab().includes("overlay:gestoppt"), "und er wird auch nicht auf „gestoppt“ gestellt");

  /* Gegenprobe. Ohne sie wäre oben nur belegt, dass diese Attrappe nichts
     misst: Über Stopp passiert weiterhin genau das, was pagehide nicht mehr
     tut. */
  await p.f.beenden("nutzer");
  assert.ok(p.anWorker().includes("link:trennen"), "Stopp trennt sehr wohl");
  assert.ok(p.rechteRueckgaben() > 0, "Stopp gibt das Seitenrecht zurück");
  assert.ok(p.anTab().includes("overlay:aus"), "und Stopp nimmt den Rahmen weg");
});

test("S6 — Die Leiste meldet nur noch, ob jemand zusieht", async (t) => {
  /* h) Statt der Trennung geht eine Auskunft an den Hintergrunddienst: Beim
     Öffnen sieht wieder jemand zu, beim Schließen nicht mehr. Was ohne
     Aufsicht noch erlaubt ist, entscheidet dann der Dienst — nicht das
     Verschwinden eines Fensters. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  const beimStart = p.anWorkerVoll().filter((n) => n.typ === "link:unbeaufsichtigt");
  assert.equal(beimStart.length, 1, "beim Öffnen genau eine Meldung");
  assert.equal(beimStart[0].an, false, "und sie sagt: es sieht wieder jemand zu");

  /* Sie steht vorn. Fragt die Leiste erst nach dem Zustand und meldet sich
     danach, hat der Dienst dazwischen eine laufende Sitzung als
     unbeaufsichtigt geführt, obwohl die Leiste schon offen war. */
  const reihe = p.anWorker();
  assert.ok(
    reihe.indexOf("link:unbeaufsichtigt") >= 0 &&
      reihe.indexOf("link:unbeaufsichtigt") < reihe.indexOf("link:zustand?"),
    `die Meldung kommt vor der Zustandsfrage, gemessen: ${reihe}`
  );

  p.alleSpurenLeeren();
  await p.fensterEreignis("pagehide");

  const beimSchliessen = p.anWorkerVoll().filter((n) => n.typ === "link:unbeaufsichtigt");
  assert.equal(beimSchliessen.length, 1, "beim Schließen genau eine Meldung");
  assert.equal(beimSchliessen[0].an, true, "und sie sagt: jetzt sieht niemand mehr zu");
  assert.equal(
    beimSchliessen[0].tabId,
    7,
    "samt Tab — ohne ihn wüsste der Dienst nicht, welche Arbeit unbeaufsichtigt ist"
  );
});

/* ================================================================== *
 * Fokusfuehrung (Befund 10.08.2026, panel.js)
 *
 * Der Befund: Beim Kartenwechsel wurde der Fokus nirgends gesetzt, er fiel auf
 * `body`. Fuer den Inhaber ist Vorlesen der Haupt-Bedienweg, und ein Fokus auf
 * `body` heisst dort: Der Vorleser sagt nichts, der Mensch weiss nicht, dass
 * sich etwas geaendert hat, und muss sich mit der Tabulatortaste neu durch die
 * ganze Leiste arbeiten.
 *
 * Alle Saetze hier werden GEFAHREN. Eine Textsuche nach „focus()" belegt
 * nichts: Sie bliebe auch dann gruen, wenn der Aufruf ein verstecktes Element
 * traefe, wenn er auf der falschen Karte landete oder wenn er dem Menschen den
 * Fokus mitten im Satz aus dem Eingabefeld risse. Gemessen wird deshalb, WO
 * der Fokus danach wirklich steht, und zwar namentlich.
 *
 * Jeder Satz ist gegen die halbe Aenderung geprueft: Nimmt man die jeweilige
 * Sicherung heraus, wird genau er rot (Mutationsprobe im Bericht).
 * ================================================================== */

test("F1 — Der Kartenwechsel setzt den Fokus auf die Ueberschrift, nicht auf body", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);

  /* Beim Oeffnen wird nichts angefasst: Niemand hat um die Leiste gebeten,
     und ein Fokussprung beim Laden waere ein Ueberfall. */
  assert.equal(p.fokus(), p.koerper, "Vorbedingung: beim Start liegt der Fokus auf body");

  await p.klick("verbinden-start");
  assert.equal(p.el("app").dataset.state, "dialog", "Vorbedingung: die Dialogkarte steht");

  const kopf = p.el("dialog").querySelector("h2");
  assert.ok(kopf, "Gegenprobe: die Dialogkarte hat wirklich eine Ueberschrift");
  assert.notEqual(p.fokus(), p.koerper, "auf body sagt der Vorleser nichts");
  assert.equal(p.fokus(), kopf, "der Fokus steht auf der Ueberschrift der neuen Karte");
  assert.equal(
    p.fokus().textContent,
    "Verbindung über SMarTrLink",
    "und zwar auf der, die zur gezeigten Karte gehoert"
  );
  assert.equal(
    kopf.getAttribute("tabindex"),
    "-1",
    "eine Ueberschrift nimmt den Fokus nur mit tabindex an; -1 haelt sie aus der Tabulatorreihe heraus"
  );

  /* Zurueck in den Ruhezustand: Mit der Karte verschwindet der Knopf, den der
     Mensch gerade gedrueckt hat. Bleibt der Fokus dort, faellt er auf body. */
  await p.klick("dialog-abbrechen");
  assert.equal(p.el("app").dataset.state, "bereit", "Vorbedingung: der Ruhezustand steht");
  assert.notEqual(p.fokus(), p.koerper);
  assert.equal(
    /* Seit dem 14.08.2026 ist der naechste Schritt der eine Klick selbst und
       nicht mehr der Weg in den Dialog: #verbinden-tab verbindet, ohne dass
       noch etwas dazwischensteht. */
    p.fokus(),
    p.el("verbinden-tab"),
    "im Ruhezustand steht er auf dem Weg zur Verbindung, dem naechsten Schritt"
  );
});

test("F2 — Auch Anmeldung und Erklaerung sagen, wo der Mensch gelandet ist", async (t) => {
  /* Ohne Ausweis fuehrt schon der Start in die Anmeldekarte. */
  const ohne = await panelStarten({ ausweis: null });
  t.after(ohne.aufraeumen);
  assert.equal(ohne.el("app").dataset.state, "anmeldung", "Vorbedingung: die Anmeldekarte steht");
  assert.notEqual(ohne.fokus(), ohne.koerper);
  assert.equal(ohne.fokus().textContent, "Zuerst anmelden");

  /* Die Erklaerkarte kommt auf einem gesperrten Ursprung (DRAHTFORMAT §7.3).
     Ihre Ueberschrift traegt eine Kennung, sie ist also namentlich pruefbar —
     und ihr Text wechselt mit der Lage, steht hier also nicht fest. */
  const gesperrt = await panelStarten({
    tab: { id: 9, url: "https://cloud.smartragents.ai/chat", title: "Cloud" },
  });
  t.after(gesperrt.aufraeumen);

  await gesperrt.klick("verbinden-start");
  assert.equal(gesperrt.el("app").dataset.state, "erklaerung", "Vorbedingung: die Erklaerkarte steht");
  assert.equal(gesperrt.fokus(), gesperrt.el("erklaer-titel"), "der Fokus steht auf ihrer Ueberschrift");
  assert.equal(
    gesperrt.fokus().textContent,
    erklaerungen.SPERRE.cloud.titel,
    "und die traegt die Ueberschrift GENAU dieser Lage"
  );

  await gesperrt.klick("erklaer-zurueck");
  assert.equal(gesperrt.fokus(), gesperrt.el("verbinden-tab"), "der Zurueck-Knopf nimmt den Fokus mit");
});

test("F3 — Die Kennwortkarte holt den Fokus zu sich", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);

  /* Genau der Rueckruf, mit dem der Freigabeweg die Karte aufmacht. */
  p.f.kennwortZeigen({
    kennwort: "AB12CD",
    buchstabiert: "Anton Berta eins zwei Caesar Dora",
    ansage: "Anton Berta eins zwei Caesar Dora",
    adresse: "https://cloud.smartragents.ai/freigabe/xyz",
  });

  assert.equal(p.el("app").dataset.state, "kennwort", "Vorbedingung: die Kennwortkarte steht");
  assert.notEqual(p.fokus(), p.koerper);
  assert.equal(p.fokus().textContent, "Kennwort für die Freigabe");
});

test("F4 — Die Freigabekarte gibt den Fokus zurueck, wo er herkam", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  /* Der Mensch steht auf dem Beispielauftrag, als der Agent fragt. Die Karte
     ist der einzige Teil der Leiste, der ungefragt dazwischentritt. */
  p.el("vorschlag").focus();
  const antwort = p.frageStellen({
    typ: "link:schritt-freigabe",
    frage: "Für dich klicken?",
    quelle: "Zur Kasse",
    cmd: "click",
    id: "f4",
  });

  assert.equal(p.fokus(), p.el("freigabe-nein"), "vorausgewaehlt UND fokussiert ist Ablehnen");
  assert.equal(
    p.el("freigabe-nein").getAttribute("tabindex"),
    null,
    "ein Knopf braucht kein tabindex und darf dadurch nicht aus der Tabulatorreihe fallen"
  );

  await p.klick("freigabe-ja");
  assert.deepEqual(await antwort, { ja: true });
  assert.equal(p.el("freigabe").hidden, true, "Vorbedingung: die Karte ist weg");
  assert.notEqual(p.fokus(), p.koerper, "ohne Rueckgabe faellt der Fokus mit der Karte auf body");
  assert.equal(
    p.fokus(),
    p.el("vorschlag"),
    "er kehrt an die Stelle zurueck, an der der Mensch stand"
  );

  /* Und beim Stopp mitten in einer offenen Frage genauso: Dort raeumt beenden()
     die Karte weg, nicht freigabeSchliessen(). */
  p.el("vorschlag").focus();
  const zweite = p.frageStellen({
    typ: "link:schritt-freigabe",
    frage: "Noch einmal klicken?",
    cmd: "click",
    id: "f4b",
  });
  assert.equal(p.fokus(), p.el("freigabe-nein"), "Vorbedingung: die Frage hat den Fokus");
  await p.klick("stopp");
  assert.equal((await zweite).ja, false);
  assert.notEqual(p.fokus(), p.koerper, "auch das Beenden laesst den Fokus nicht auf body liegen");
});

test("F5 — Wer tippt, behaelt den Fokus — und erfaehrt es trotzdem", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  /* Der Mensch schreibt gerade eine Frage. */
  p.el("eingabe").focus();

  const antwort = p.frageStellen({
    typ: "link:schritt-freigabe",
    frage: "Für dich klicken?",
    quelle: "Zur Kasse",
    cmd: "click",
    id: "f5",
  });
  assert.equal(
    p.fokus(),
    p.el("eingabe"),
    "die Freigabekarte reisst den Fokus nicht aus dem Eingabefeld; die Eingabetaste wuerde sonst ablehnen"
  );
  assert.equal(p.el("freigabe").hidden, false, "verschwiegen wird sie deshalb nicht");
  assert.match(
    p.el("ansage").textContent,
    /Freigeben oder ablehnen\?/,
    "und sie steht in der Ansagezone, wo der Vorleser sie findet"
  );

  await p.klick("freigabe-nein");
  await antwort;
  assert.equal(p.fokus(), p.el("eingabe"), "auch beim Schliessen bleibt der Fokus beim Menschen");

  /* Dasselbe beim Kartenwechsel: Waehrend des Tippens laeuft die Anmeldung ab,
     die Anmeldekarte kommt von selbst. */
  p.melden({ typ: "chat:antwort", ok: false, kennung: "anmeldung", klartext: "abgelaufen" });
  await new Promise((f) => setTimeout(f, 0));
  assert.equal(p.el("app").dataset.state, "anmeldung", "Vorbedingung: die Anmeldekarte kam von selbst");
  assert.equal(p.fokus(), p.el("eingabe"), "sie nimmt dem Tippenden den Fokus nicht weg");
  assert.match(
    p.el("ansage").textContent,
    /Anmeldung gilt nicht mehr/,
    "dafuer sagt es die Ansagezone — verschwiegen wird der Wechsel nie"
  );
});

test("F6 — Sitzungsstart und Sitzungsende lassen den Fokus nicht auf body", async (t) => {
  const p = await panelStarten({ workerAntworten: { "link:verbinden": sitzungAntwort() } });
  t.after(p.aufraeumen);

  await p.klick("verbinden-start");
  await p.klick("verbinden");
  assert.equal(p.el("app").dataset.state, "aktiv", "Vorbedingung: die Sitzung laeuft");
  assert.notEqual(p.fokus(), p.koerper);
  assert.equal(
    p.fokus(),
    p.el("sitzungsleiste"),
    "die Sitzungsleiste traegt Stufe, Restzeit und die Notbremse — dorthin gehoert der Fokus"
  );
  assert.equal(p.el("sitzungsleiste").getAttribute("tabindex"), "-1");

  await p.klick("stopp");
  await warteAufZustand(p, "bereit");
  assert.notEqual(p.fokus(), p.koerper, "mit der Sitzungsleiste verschwindet der Stopp-Knopf samt Fokus");
  assert.equal(p.fokus(), p.el("verbinden-tab"));
});

test("F7 — Eine Stoerung steht in genau EINER Vorlesezone", async (t) => {
  /* Die Zusage: Was einmal passiert, wird einmal gesagt. `#stoerung` traegt
     role="alert" und ist damit selbst schon eine Vorlesezone, und zwar die
     dringlichste im Dokument. Derselbe Satz zusaetzlich in `#ansage`
     (role="status") heisst: Der Bildschirmleser liest ihn zweimal. Genau
     dieser Fund ist bei den Sprechblasen schon einmal ausgebaut worden. */
  assert.match(html, /id="stoerung"[^>]*role="alert"/, "Gegenprobe: die Stoerungszeile spricht selbst");
  assert.match(html, /id="ansage"[^>]*aria-live="polite"/, "Gegenprobe: die Ansagezone auch");

  const p = await panelStarten({ bindFehler: true });
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.el("ansage").textContent = "";
  p.spurLeeren();

  await p.f.agentenBindung();

  const satz = p.el("stoerung").textContent;
  assert.match(satz, /dem Agenten nicht übergeben/, "Vorbedingung: die Stoerung steht sichtbar da");
  assert.equal(p.el("stoerung").hidden, false);
  assert.equal(p.el("ansage").textContent, "", "die zweite Vorlesezone bleibt leer");
  assert.equal(
    p.gesprochen.filter((s) => s === satz).length,
    1,
    "gesprochen wird der Satz genau einmal, nicht zweimal und nicht keinmal"
  );
  assert.equal(p.zustand.letzteRede, satz, "und der 🔊-Knopf kennt ihn weiterhin");

  /* Gegenprobe, damit oben nicht bloss „die Ansagezone ist tot" gemessen wird:
     Was KEINE eigene Vorlesezone hat, steht sehr wohl weiter darin. */
  await p.klick("modus-smartr");
  assert.equal(p.el("ansage").textContent, "SMarTr Modus.");
});

test("F8 — Die Restzeit tickt nicht in einer Vorlesezone", async (t) => {
  /* Die Sitzungsleiste ist eine Vorlesezone, und tick() schreibt jede Sekunde
     eine neue Zahl hinein. Ohne Deckel liest ein Bildschirmleser im
     Sekundentakt die Uhr vor und uebertoent damit genau das, worauf es
     ankommt: die Freigabefrage und jede Ansage. Dieselbe Entscheidung ist bei
     der Antwortuhr der Freigabekarte schon getroffen (panel.html,
     aria-live="off" an #freigabe-rest). */
  assert.match(html, /id="sitzungsleiste"[^>]*role="status"/, "Gegenprobe: die Leiste spricht von selbst");

  const p = await panelStarten();
  t.after(p.aufraeumen);
  assert.equal(
    p.el("rest").getAttribute("aria-live"),
    "off",
    "die Uhr in der Sitzungsleiste darf nicht im Sekundentakt vorgelesen werden"
  );

  /* Die Warnungen bleiben: Still ist die Uhr, nicht die Sitzung. */
  await p.sitzungHerstellen({ endetUm: Date.now() + 61000 });
  await new Promise((f) => setTimeout(f, 1100));
  assert.match(
    p.gesprochen.join(" "),
    /Noch eine Minute/,
    "die Minutenwarnung kommt weiterhin als eigene Ansage"
  );
});

test("F9 — Der Beispielauftrag holt den Fokus zurueck, den er selbst verloren hat", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  /* Der Mensch drueckt den Knopf, steht also darauf. */
  p.el("vorschlag").focus();
  const lauf = p.klick("vorschlag");
  await new Promise((f) => setTimeout(f, 0));

  /* Der Auftrag schaltet den Knopf ab, solange er laeuft — und ein
     abgeschaltetes Element haelt den Fokus nicht. */
  assert.equal(p.el("vorschlag").disabled, true, "Vorbedingung: der Knopf ist abgeschaltet");
  assert.equal(p.fokus(), p.el("freigabe-nein"), "die erste Frage steht und hat den Fokus");

  await p.klick("freigabe-nein");
  await lauf;

  assert.equal(p.el("vorschlag").disabled, false, "Vorbedingung: der Auftrag ist zu Ende");
  assert.notEqual(p.fokus(), p.koerper, "sonst bleibt der Fokus auf body liegen und der Vorleser schweigt");
  assert.equal(p.fokus(), p.el("vorschlag"), "er steht wieder auf dem Knopf, den der Mensch gedrueckt hat");
});

/* ================================================================== *
 * v3.5 — Startseite, Betriebsmodus, Not-Aus, Live-Protokoll
 * (Auftrag A-PANEL, 14.08.2026)
 *
 * Alle Saetze hier werden GEFAHREN. Der teuerste Befund dieses Projektes ist
 * der vom 11.08.2026: 18 gruene Pruefsaetze ueber einer Verdeckungswache, die
 * im ausgelieferten Klickweg nirgends gerufen wurde. Deshalb misst jeder Satz
 * unten den Weg, den ein Mensch wirklich geht — Knopf druecken, Ereignis
 * eintreffen lassen —, und keiner ruft eine Funktion, die sonst niemand ruft.
 * ================================================================== */

/* Ein Tabbestand, wie ihn ein echter Browser hat: der aktive Tab, ein zweites
   Fenster, der eigene Freigabe-Ursprung und eine Browserseite. Die letzten
   beiden sind der Punkt — sie duerfen in der Liste nicht auftauchen. */
const TABS_GEMISCHT = () => [
  { id: 7, url: "https://geizhals.de/warenkorb", title: "Warenkorb", active: true, favIconUrl: "https://geizhals.de/favicon.ico" },
  { id: 8, url: "https://www.ebay.de/sh/lst/active", title: "eBay, aktive Angebote" },
  { id: 9, url: "https://cloud.smartragents.ai/dashboard", title: "SMarTrAgents" },
  { id: 10, url: "chrome://extensions", title: "Erweiterungen" },
];

/* ------------------------------------------------------------------ *
 * E — der eine Klick
 * ------------------------------------------------------------------ */

test("E1 — In der Seitenleiste ist es EIN Klick, und der Browser fragt danach selbst", async (t) => {
  /*
   * Umgeschrieben am 14.08.2026 (Befund N2 der Abnahme).
   *
   * Vorher stand hier ausschliesslich `klicks() === 1`, gemessen gegen zwei
   * ausgesprochen freundliche Attrappen: `permissions.request` sagte sofort ja,
   * und das Ticket kam ohne Kennwort. Das sind genau die beiden Stellen, an
   * denen ein Mensch im echten Chrome noch einmal etwas tun muss. Eine
   * gemessene Eins ueber einer Attrappe, die das Nachfragen wegnimmt, ist eine
   * Zahl ueber die Attrappe und nicht ueber den Weg.
   *
   * Gemessen werden ab jetzt beide Seiten getrennt, und beide werden benannt:
   * die Klicks IN DER SEITENLEISTE, und die Fragen, die BROWSER UND CLOUD
   * danach selbst stellen. Die Zusage lautet damit ehrlich: ein Klick hier,
   * plus die Freigabe, die Chrome fuer diese Seite verlangt, und, wenn die
   * Cloud es verlangt, das Kennwort im anderen Tab.
   */
  const p = await panelStarten({ workerAntworten: { "link:verbinden": sitzungAntwort() } });
  t.after(p.aufraeumen);

  assert.equal(p.el("app").dataset.state, "bereit", "Vorbedingung: die Leiste ist eben aufgegangen");
  assert.equal(p.el("verbindungsleiste").hidden, false, "Vorbedingung: der Weg steht above the fold");
  assert.equal(p.el("verbinden-tab").hidden, false, "Vorbedingung: der Knopf ist sichtbar");
  assert.equal(p.el("verbinden-tab").disabled, false, "Vorbedingung: er ist auch bedienbar");
  p.klicksZuruecksetzen();
  p.browserFragenLeeren();

  await p.klick("verbinden-tab");

  assert.equal(p.el("app").dataset.state, "aktiv", "nach dem einen Klick steht die Verbindung");
  assert.ok(p.zustand.sitzung, "und zwar wirklich, nicht nur auf dem Bildschirm");
  assert.equal(p.klicks(), 1, `gezaehlt wurden ${p.klicks()} Klicks in der Leiste, erlaubt ist genau einer`);

  /* Und das, was der Browser selbst noch fragt, steht mit Namen da, statt
     unter den Tisch zu fallen. */
  assert.deepEqual(
    p.browserFragen(),
    ["chrome-freigabe-fuer-diese-seite"],
    "auf der Lesestufe fragt danach genau eine Stelle noch einmal: Chrome selbst"
  );

  /* Verlangt die Cloud eine Rueckfrage, sind es zwei — und die Kennwortkarte
     steht dann wirklich da, statt dass der Weg unbemerkt daran vorbeilaeuft. */
  const r = await panelStarten({
    freigabeMitKennwort: true,
    workerAntworten: { "link:verbinden": sitzungAntwort() },
  });
  t.after(r.aufraeumen);
  r.klicksZuruecksetzen();
  r.browserFragenLeeren();
  await r.klick("verbinden-tab");
  assert.equal(r.klicks(), 1, "in der Leiste bleibt es trotzdem bei einem Klick");
  assert.deepEqual(
    r.browserFragen(),
    ["chrome-freigabe-fuer-diese-seite", "freigabeseite-in-der-cloud"],
    "mit Rueckfrage der Cloud sind es zwei Stellen, und beide heissen beim Namen"
  );
  assert.equal(
    r.el("kennwort-wert").textContent,
    "K7RM2X",
    "das Kennwort steht wirklich in der Karte, der Mensch vergleicht es im anderen Tab"
  );
  assert.equal(r.el("app").dataset.state, "aktiv", "und danach steht die Verbindung");

  /* Gegenprobe, damit die Zahl oben etwas misst: Der alte Weg ueber den Dialog
     braucht weiterhin mehr als einen Klick. Waere der Zaehler blind, kaeme
     hier dieselbe Eins heraus. */
  const q = await panelStarten({ workerAntworten: { "link:verbinden": sitzungAntwort() } });
  t.after(q.aufraeumen);
  q.klicksZuruecksetzen();
  await q.klick("verbinden-start");
  assert.equal(q.el("app").dataset.state, "dialog", "der Dialog ist der Weg fuer Dauer und Geltung");
  await q.klick("verbinden");
  assert.equal(q.el("app").dataset.state, "aktiv");
  assert.ok(q.klicks() > 1, "der Dialogweg kostet mehr als einen Klick — sonst zaehlt der Zaehler nicht");
});

test("E2 — Der eine Klick fragt Chrome, bevor er irgendetwas abwartet", async (t) => {
  /* `chrome.permissions.request` verlangt eine Nutzergeste, und die ist nach
     dem ersten await verbraucht (Bestand, seitenrechteHolen). Ein Klick, der
     den Tab erst nachschlaegt, verliert sie, bevor er fragt — im echten Chrome
     waere er dann wirkungslos, in jeder Attrappe sieht er richtig aus. Messbar
     ist das ausschliesslich an der REIHENFOLGE der Aufrufe. */
  const p = await panelStarten({ workerAntworten: { "link:verbinden": sitzungAntwort() } });
  t.after(p.aufraeumen);
  p.aufrufeLeeren();

  await p.klick("verbinden-tab");

  const reihe = p.aufrufe();
  assert.ok(reihe.includes("permissions.request"), "Vorbedingung: Chrome wird ueberhaupt gefragt");
  assert.equal(
    reihe[0],
    "permissions.request",
    `vor der Chrome-Abfrage steht ein Abwarten: ${reihe.join(" → ")}`
  );
});

test("E3 — Der eine Klick verbindet mit dem Tab, der wirklich offen ist", async (t) => {
  const p = await panelStarten({
    alleTabs: TABS_GEMISCHT(),
    workerAntworten: { "link:verbinden": sitzungAntwort() },
  });
  t.after(p.aufraeumen);

  await p.klick("verbinden-tab");

  assert.equal(p.zustand.tabId, 7, "der aktive Tab, nicht irgendeiner aus der Liste");
  assert.equal(p.zustand.ursprung, "https://geizhals.de");
  const antrag = p.antraege().at(-1).gewuenscht;
  assert.equal(antrag.tab_host, "geizhals.de");
  assert.deepEqual([...antrag.allow], ["geizhals.de"], "der Bereich ist genau dieser eine Host");

  /* Und der Antrag ist DERSELBE wie ueber den Dialog. Zwei Wege mit zwei
     Vorbelegungen waeren zwei Wahrheiten: Der Mensch bekaeme je nach Knopf
     eine andere Sitzung, ohne dass ihm jemand den Unterschied sagt. */
  const ueberDialog = await antragMitStufe(t, null);
  assert.equal(antrag.access, ueberDialog.access, "dieselbe Stufe");
  assert.equal(antrag.step_mode, ueberDialog.step_mode, "derselbe Schrittmodus");
  assert.equal(antrag.duration, ueberDialog.duration, "dieselbe Dauer");
});

test("E4 — Auf einem gesperrten Ursprung entsteht kein Antrag, sondern eine Erklaerung", async (t) => {
  for (const [url, lage] of [
    ["https://cloud.smartragents.ai/dashboard", "cloud"],
    ["chrome://extensions", "browser"],
  ]) {
    const p = await panelStarten({
      tab: { id: 7, url, title: "gesperrt", active: true },
      workerAntworten: { "link:verbinden": sitzungAntwort() },
    });
    t.after(p.aufraeumen);
    p.alleSpurenLeeren();

    await p.klick("verbinden-tab");

    assert.equal(p.el("app").dataset.state, "erklaerung", `${url}: die Regel wird erklaert`);
    assert.equal(
      p.el("erklaer-titel").textContent,
      erklaerungen.SPERRE[lage].titel,
      `${url}: und zwar mit dem Satz GENAU dieser Lage`
    );
    assert.equal(p.antraege().length, 0, `${url}: es geht kein Antrag auf den Weg`);
    assert.equal(p.zustand.sitzung, null, "und es entsteht keine Sitzung");
    assert.equal(p.el("stoerung").hidden, true, "eine Regel ist kein Fehler und steht nicht in Rot");
  }
});

test("E5 — Laeuft eine Sitzung, baut der eine Klick keine zweite auf", async (t) => {
  const p = await panelStarten({ workerAntworten: { "link:verbinden": sitzungAntwort() } });
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.alleSpurenLeeren();

  await p.f.tabVerbinden();

  assert.equal(p.antraege().length, 0, "kein zweiter Antrag, solange der erste laeuft");
  assert.equal(p.rechteRueckgaben(), 0, "und dem laufenden Agenten wird kein Seitenrecht weggenommen");
  assert.equal(p.el("app").dataset.state, "aktiv", "der Stopp-Knopf bleibt, wo er war");
  assert.match(p.el("ansage").textContent, /Beende sie mit Stopp/, "und der Mensch hoert, warum");
});

test("E6 — Auch durch die echte Startseite bleibt es ein Klick mit heiler Nutzergeste", async (t) => {
  /*
   * Der Weg, den ein Mensch im ausgelieferten Stand wirklich geht: Die Zeilen
   * baut src/panel/startseite.js, gedrueckt wird ihr Knopf. Genau hier lag der
   * Befund vom 11.08.2026 — eine Wache, die gemessen war und im Klickweg
   * nirgends gerufen wurde. Deshalb wird hier durch das ECHTE Modul geklickt
   * und nicht durch eine Attrappe.
   */
  const echt = await import("../panel/startseite.js");
  const p = await panelStarten({
    alleTabs: TABS_GEMISCHT(),
    startseiteModul: echt,
    workerAntworten: { "link:verbinden": sitzungAntwort() },
  });
  t.after(p.aufraeumen);
  await new Promise((f) => setTimeout(f, 0));

  const knopf = p.el("startseite").querySelector(".sa-tab-verbinden");
  assert.ok(knopf, "Vorbedingung: die echte Startseite hat eine Zeile mit Knopf");
  p.klicksZuruecksetzen();
  p.aufrufeLeeren();

  await p.klickAuf(knopf);
  await new Promise((f) => setTimeout(f, 0));

  assert.equal(p.klicks(), 1, "ein Klick, eine Verbindung");
  assert.equal(p.el("app").dataset.state, "aktiv");
  assert.ok(p.zustand.sitzung, "und sie ist wirklich entstanden");
  assert.equal(
    p.aufrufe()[0],
    "permissions.request",
    `die Nutzergeste ist unterwegs verbraucht worden: ${p.aufrufe().join(" → ")}`
  );
});

/* ================================================================== *
 * ZZ — die Funde der Abnahme vom 14.08.2026, gefahren
 *
 * Jeder Satz hier faehrt den Weg, den ein Mensch wirklich geht, und jeder ist
 * gegengeprobt worden: Reparatur zurueckgebaut, rot gemessen, wieder
 * eingebaut, gruen gemessen. Was die Gegenprobe rot gemacht hat, steht beim
 * jeweiligen Satz.
 * ================================================================== */

/* Eine Sitzungsantwort, die beim ZWEITEN Anlauf zur Absage wird — so wie der
   Hintergrunddienst es tut, wenn schon eine Leitung steht. */
function verbindenZweimal() {
  let runde = 0;
  return () => {
    runde += 1;
    return runde === 1 ? sitzungAntwort() : { ok: false, klartext: "Es läuft schon eine Verbindung." };
  };
}

test("ZZ13 — Der zweite Klick waehrend des Aufbaus nimmt dem ersten nichts weg", async (t) => {
  /*
   * Der BLOCKER B8, gemessen am 14.08.2026: Klick auf „Mit diesem Tab
   * verbinden", nach 0,3 s noch einmal geklickt, weil sichtbar nichts
   * passierte. Lauf A bekam die Sitzung, Lauf B bekam `schon_verbunden` und
   * lief in aufbauAbbrechen — `overlay:aus` an den Tab UND
   * `seitenrechteZurueckgeben` fuer genau den Ursprung, auf dem A arbeitete.
   * Endstand: Chip „Aktiv, Nur zusehen", Sitzungsleiste sichtbar, dabei
   * rechteZurueckgegeben=1, anTab=[overlay:an, overlay:aus], kein
   * link:trennen. Der Mensch liest „Aktiv", der Agent hat sein Recht auf die
   * Seite verloren, und die Sitzung laeuft am Dienst weiter.
   *
   * Zwei Klicks OHNE Abwarten dazwischen, also genau der Wettlauf. Dass der
   * Knopf nach dem ersten Klick abgeschaltet ist, hilft hier absichtlich
   * nicht: Die Nachbildung loest den zweiten Klick trotzdem aus, damit der
   * Riegel selbst gemessen wird und nicht die Freundlichkeit des Browsers.
   */
  const p = await panelStarten({ workerAntworten: { "link:verbinden": verbindenZweimal() } });
  t.after(p.aufraeumen);
  p.alleSpurenLeeren();

  const ersterLauf = p.klick("verbinden-tab");
  const zweiterLauf = p.klick("verbinden-tab");
  await Promise.all([ersterLauf, zweiterLauf]);

  assert.ok(p.zustand.sitzung, "die Sitzung des ersten Laufs steht");
  assert.equal(p.el("app").dataset.state, "aktiv");
  assert.equal(
    p.anWorkerVoll().filter((n) => n.typ === "link:verbinden").length,
    1,
    "es geht genau EIN link:verbinden hinaus"
  );
  assert.equal(p.antraege().length, 1, "und genau ein Antrag auf die Freigabeseite");

  /* Das Entscheidende: Was der Agent WIRKLICH in der Hand hat. */
  assert.equal(
    p.rechteRueckgaben(),
    0,
    "dem laufenden Agenten wird sein Seitenrecht nicht weggenommen"
  );
  assert.deepEqual(
    p.anTab(),
    ["overlay:an"],
    `am Tab passiert genau das eine, was passieren soll: ${p.anTab().join(" → ")}`
  );
  assert.ok(!p.anWorker().includes("link:trennen"), "und getrennt wird nichts");

  /* Und die Anzeige sagt dasselbe wie der Zustand, in beide Richtungen. */
  assert.match(p.el("zustand-text").textContent, /^Aktiv/, "der Chip sagt aktiv");
  assert.equal(p.el("sitzungsleiste").hidden, false, "und der Stopp-Knopf steht da");
});

test("ZZ13b — Auch der Dialogknopf startet keinen zweiten Lauf neben dem ersten", async (t) => {
  /* Derselbe Riegel, zweiter Eingang: `verbinden()` haengt auch am
     Dialogknopf, und ein Riegel, der nur an einer Tuer sitzt, ist keiner. */
  const p = await panelStarten({ workerAntworten: { "link:verbinden": verbindenZweimal() } });
  t.after(p.aufraeumen);
  await p.klick("verbinden-start");
  p.alleSpurenLeeren();

  const a = p.klick("verbinden");
  const b = p.klick("verbinden");
  await Promise.all([a, b]);

  assert.ok(p.zustand.sitzung, "eine Sitzung ist entstanden");
  assert.equal(p.antraege().length, 1, "aber nur eine");
  assert.equal(p.rechteRueckgaben(), 0, "und kein Seitenrecht geht verloren");
  assert.deepEqual(p.anTab(), ["overlay:an"]);
});

test("ZZ11 — Zwischen Klick und Sitzung sieht der Mensch, dass gearbeitet wird", async (t) => {
  /*
   * Fund H3, gemessen am 14.08.2026 mit einem Dienstarbeiter, der 300 ms
   * braucht, also dem MV3-Regelfall Kaltstart: 50 ms nach dem Klick waren
   * Chip, Knopf, Karten und Stoerungszeile unveraendert. Die einzige Meldung
   * ging nach `#ansage`, und das ist per panel.css auf ein Pixel geklippt,
   * also ausschliesslich fuer den Bildschirmleser da. Wer sieht, sah nichts,
   * drueckte noch einmal, und daraus wurde der Blocker B8.
   */
  let loesen;
  const langsamerDienst = new Promise((f) => {
    loesen = f;
  });
  const p = await panelStarten({ workerAntworten: { "link:verbinden": () => langsamerDienst } });
  t.after(p.aufraeumen);

  const vorher = {
    chip: p.el("zustand-text").textContent,
    knopf: p.el("verbinden-tab").disabled,
  };
  assert.equal(vorher.knopf, false, "Vorbedingung: vorher ist der Knopf bedienbar");

  const lauf = p.klick("verbinden-tab");
  /* Ein Takt der Warteschlange — das Gegenstueck zu den gemessenen 50 ms. */
  await new Promise((f) => setTimeout(f, 0));
  await new Promise((f) => setTimeout(f, 0));

  assert.equal(p.zustand.sitzung, null, "Vorbedingung: die Sitzung gibt es noch nicht");
  assert.notEqual(p.el("zustand-text").textContent, vorher.chip, "der Chip hat sich geruehrt");
  assert.match(
    p.el("zustand-text").textContent,
    /Verbindung her/,
    `der Chip sagt, was laeuft: „${p.el("zustand-text").textContent}"`
  );
  assert.equal(p.el("verbinden-tab").disabled, true, "der Knopf loest nichts mehr aus, und das sieht man");
  assert.equal(p.el("app").dataset.aufbau, "laeuft", "und die Flaeche traegt den Zustand fuer das Auge");
  assert.match(p.el("verbinden-hinweis").textContent, /Verbindung her/, "die Zeile daneben sagt es in Worten");

  loesen(sitzungAntwort());
  await lauf;

  assert.equal(p.el("app").dataset.state, "aktiv", "danach steht die Verbindung");
  assert.equal(p.el("verbinden-tab").disabled, false, "und der Knopf ist wieder, was er war");
  assert.equal(p.el("app").dataset.aufbau, "", "die Arbeitsanzeige geht mit");
});

test("ZZ11b — Scheitert der Aufbau, geht die Arbeitsanzeige trotzdem weg", async (t) => {
  /* Eine Anzeige, die nur beim Gelingen zurueckgesetzt wird, laesst den Knopf
     nach dem ersten Fehlschlag fuer immer abgeschaltet stehen. */
  const p = await panelStarten({
    workerAntworten: { "link:verbinden": { ok: false, klartext: "Der Dienst mag nicht." } },
  });
  t.after(p.aufraeumen);

  await p.klick("verbinden-tab");

  assert.equal(p.zustand.sitzung, null, "Vorbedingung: es ist wirklich nichts entstanden");
  assert.equal(p.el("verbinden-tab").disabled, false, "der Weg zurueck steht offen");
  assert.equal(p.el("app").dataset.aufbau, "");
  assert.match(p.el("stoerung").textContent, /Der Dienst mag nicht/, "und der Grund steht sichtbar da");
  assert.match(p.el("zustand-text").textContent, /Angemeldet/, "der Chip sagt wieder die Wahrheit");
});

test("ZZ9 — Mit dem Sitzungsende geht die Anzeige, und zwar sofort", async (t) => {
  /*
   * Fund H4, gemessen am 14.08.2026 fuer Stopp, „abgelaufen" und „verloren":
   * `zustand.sitzung` war schon null und das Seitenrecht zurueckgegeben,
   * waehrend die Leiste noch bei +608 ms „Aktiv, Nur zusehen" zeigte, samt
   * gruener Sitzungsleiste mit Stopp-Knopf und Tabkarte mit gruenem Punkt.
   * Erst bei +1509 ms wurde daraus „Angemeldet, bereit", und in genau diesem
   * Fenster war der Weg zurueck nicht begehbar.
   *
   * Gemessen wird deshalb OHNE jedes Warten: Der Zustand muss schon vor dem
   * ersten await stimmen. Ein Pruefsatz, der auf den Zustand wartet, koennte
   * den Fund gar nicht sehen.
   */
  for (const grund of ["nutzer", "abgelaufen", "verloren", "notbremse"]) {
    const p = await panelStarten();
    t.after(p.aufraeumen);
    await p.sitzungHerstellen();
    assert.equal(p.el("app").dataset.state, "aktiv", `${grund}: Vorbedingung, es laeuft etwas`);

    const lauf = p.f.beenden(grund);

    assert.equal(p.zustand.sitzung, null, `${grund}: die Sitzung ist zu Ende`);
    assert.equal(p.el("app").dataset.state, "bereit", `${grund}: und die Anzeige sagt es sofort`);
    assert.equal(p.el("sitzungsleiste").hidden, true, `${grund}: keine Sitzungsleiste ohne Sitzung`);
    assert.equal(p.el("tabkarte").hidden, true, `${grund}: und keine Tabkarte mit gruenem Punkt`);
    assert.match(
      p.el("zustand-text").textContent,
      /Angemeldet/,
      `${grund}: der Chip sagt nicht mehr „Aktiv": „${p.el("zustand-text").textContent}"`
    );
    assert.equal(
      p.el("verbindungsleiste").hidden,
      false,
      `${grund}: und der Weg zurueck ist im selben Augenblick begehbar`
    );

    await lauf;
    assert.equal(p.el("app").dataset.state, "bereit", `${grund}: und er bleibt es auch danach`);
  }
});

test("ZZ9b — Die Schlussansage kommt trotzdem, sie kommt nur nach dem Bildwechsel", async (t) => {
  /* Die Verzoegerung von 1200 ms war damit begruendet, dass die Schlussansage
     nicht von einem Bildwechsel ueberholt wird. Sie faellt weg, die Ansage
     nicht: Sie steht als Blase im Verlauf und wird gesprochen. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.spurLeeren();

  await p.f.beenden("nutzer");

  assert.ok(
    p.verlauf().some((b) => /Beendet/.test(b)),
    `die Schlussansage steht im Verlauf: ${p.verlauf().join(" | ")}`
  );
  assert.ok(
    p.gesprochen.some((s) => /Beendet/.test(s)),
    "und sie wird gesprochen"
  );
});

test("ZZM7 — Die Statuskarte der Startseite ist waehrend der Sitzung wirklich zu sehen", async (t) => {
  /*
   * Fund M7: Der Zweig `verbunden=true` in startseite.js wurde ausschliesslich
   * in ein Element gemalt, das in genau diesem Augenblick versteckt war —
   * panel.js deckte `#startseite` zu, sobald eine Sitzung lief. Gemessen und
   * nie gesehen, also der Befund vom 11.08.2026 in neuer Gestalt.
   *
   * Gefahren wird durch das ECHTE Modul, nicht durch eine Attrappe.
   */
  const echt = await import("../panel/startseite.js");
  const p = await panelStarten({
    alleTabs: TABS_GEMISCHT(),
    startseiteModul: echt,
    workerAntworten: { "link:verbinden": sitzungAntwort() },
  });
  t.after(p.aufraeumen);
  await new Promise((f) => setTimeout(f, 0));

  const start = p.el("startseite");
  assert.equal(start.hidden, false, "Vorbedingung: im Ruhezustand steht sie da");
  assert.equal(start.querySelector("ul").hidden, false, "Vorbedingung: mit ihrer Tabliste");

  await p.klick("verbinden-tab");

  assert.ok(p.zustand.sitzung, "Vorbedingung: es laeuft wirklich eine Sitzung");
  assert.equal(start.hidden, false, "die Startseite ist waehrend der Sitzung NICHT zugedeckt");
  assert.equal(
    start.querySelector("span").className,
    "sa-punkt an",
    "und der Punkt darin ist wirklich gruen"
  );
  const ziel = start.querySelector("div").querySelector("p").textContent;
  assert.match(ziel, /Verbunden mit/, `die Karte nennt die Lage: „${ziel}"`);
  assert.match(ziel, /Warenkorb/, "und den Tab, um den es geht");
  assert.equal(
    start.querySelector("ul").hidden,
    true,
    "die Tabliste geht dafuer: sie waere der Weg zu einem zweiten Antrag, und den gibt es nicht"
  );

  /* Gegenprobe: Ohne Sitzung ist es genau umgekehrt, und zwar sofort. */
  await p.f.beenden("nutzer");
  assert.equal(start.hidden, false, "im Ruhezustand steht sie weiter da");
  assert.equal(start.querySelector("ul").hidden, false, "jetzt wieder mit Tabliste");
  assert.equal(start.querySelector("span").className, "sa-punkt", "und ohne gruenen Punkt");
});

test("ZZM8 — Der eine Klick nennt die Stufe, die er beantragt, bevor er gedrueckt wird", async (t) => {
  /*
   * Fund M8: „Mit diesem Tab verbinden" beantragt die zuletzt gemerkte Stufe,
   * bis hin zu Vollzugriff, und vor dem Klick stand nirgends auf der
   * Startseite, welche das ist. Wer einmal Vollzugriff gewaehlt hatte, bekam
   * ihn danach mit einem Klick wieder, ohne ihn zu lesen.
   *
   * Gemessen wird beides zusammen: was DASTEHT und was danach WIRKLICH
   * beantragt wird. Eine Anzeige, die nicht am Antrag haengt, waere nur eine
   * zweite Behauptung.
   */
  const faelle = [
    [null, "Nur zusehen", "read", "confirm_each"],
    ["write", "Bedienen", "write", "confirm_each"],
    ["voll", "Vollzugriff", "write", "auto"],
  ];
  for (const [gemerkt, wort, access, schrittmodus] of faelle) {
    const p = await panelStarten({
      speicher: gemerkt ? { wahlStufe: gemerkt } : {},
      workerAntworten: { "link:verbinden": sitzungAntwort() },
    });
    t.after(p.aufraeumen);

    const zeile = p.el("verbinden-stufe").textContent;
    assert.ok(
      zeile.startsWith(wort),
      `gemerkt „${gemerkt}": am Knopf steht nicht die Stufe, die er beantragt: „${zeile}"`
    );
    /* Und es steht dieselbe Zusage dabei wie im Dialog (Regel aus S4): Das
       Etikett verspricht nichts, was nicht gilt. */
    if (gemerkt) {
      assert.match(zeile, /Anmelden machst du selbst/, `gemerkt „${gemerkt}": der Vorbehalt fehlt`);
    }
    for (const muster of [/passwor|passwör|kennwort/i, /\bmeldet? (sich|dich) an\b/i]) {
      assert.ok(!muster.test(zeile), `die Zeile verspricht zu viel: „${zeile}"`);
    }

    await p.klick("verbinden-tab");
    const antrag = p.antraege().at(-1).gewuenscht;
    assert.equal(antrag.access, access, `gemerkt „${gemerkt}": beantragt wurde etwas anderes`);
    assert.equal(antrag.step_mode, schrittmodus, `gemerkt „${gemerkt}": anderer Schrittmodus`);
  }

  /* Und die Zeile folgt der Wahl im Dialog, ohne dass jemand neu laedt. */
  const q = await panelStarten({ workerAntworten: { "link:verbinden": sitzungAntwort() } });
  t.after(q.aufraeumen);
  await q.klick("verbinden-start");
  await q.waehlen("stufe", "voll");
  assert.ok(
    q.el("verbinden-stufe").textContent.startsWith("Vollzugriff"),
    `nach der Wahl steht am Knopf: „${q.el("verbinden-stufe").textContent}"`
  );
});

test("ZZN1 — Ohne Ziel verspricht der eine Klick nichts", async (t) => {
  /*
   * Fund N1: `setzeZustand("bereit")` stand vor `tabsAuffrischen()`, und
   * dazwischen war `zustand.aktuellerTab` noch null. Der Knopf stand da,
   * loeste aber nur `erklaerkarteZeigen(SPERRE.browser)` aus — also die
   * Auskunft „das ist eine Browserseite" ueber einen Tab, den niemand
   * angesehen hat.
   */
  const ohne = await panelStarten({ alleTabs: [], tab: null });
  t.after(ohne.aufraeumen);
  assert.equal(ohne.zustand.aktuellerTab, null, "Vorbedingung: es gibt kein Ziel");
  assert.equal(ohne.el("verbindungsleiste").hidden, false, "der Weg steht trotzdem sichtbar da");
  assert.equal(ohne.el("verbinden-tab").disabled, true, "aber der Knopf verspricht nichts");

  const mit = await panelStarten({ alleTabs: TABS_GEMISCHT() });
  t.after(mit.aufraeumen);
  assert.ok(mit.zustand.aktuellerTab, "Gegenprobe: hier gibt es ein Ziel");
  assert.equal(mit.el("verbinden-tab").disabled, false, "und dann ist der Knopf bedienbar");
});

/* ------------------------------------------------------------------ *
 * T — die Tab-Liste und die Statuskarte
 * ------------------------------------------------------------------ */

/* Die Zeilen, die in der Liste wirklich stehen — samt ihrem sichtbaren Text. */
const listenZeilen = (p) => p.el("startseite-liste").kinder.filter((k) => typeof k !== "string");

test("T1 — Die Liste zeigt die offenen Tabs und den gesperrten Ursprung NICHT", async (t) => {
  const p = await panelStarten({ alleTabs: TABS_GEMISCHT() });
  t.after(p.aufraeumen);

  const zeilen = listenZeilen(p);
  const texte = zeilen.map((z) => z.textContent);
  assert.equal(zeilen.length, 2, `erwartet zwei waehlbare Tabs, gefunden: ${texte.join(" | ")}`);
  assert.ok(texte.some((s) => s.includes("geizhals.de")), "der aktive Tab steht drin");
  assert.ok(texte.some((s) => s.includes("ebay.de")), "das andere Fenster auch — dafuer gibt es die Liste");

  /* Der Punkt der ganzen Liste: Was net/rechte.js sperrt, erscheint hier gar
     nicht erst. Ein Ziel anzubieten, das garantiert scheitert, ist keine
     Auswahl, sondern eine Falle (Befund 28.07.2026). */
  assert.ok(
    !texte.some((s) => s.includes("smartragents.ai")),
    "der Freigabe-Ursprung steht nie zur Auswahl (DRAHTFORMAT §7.3)"
  );
  assert.ok(!texte.some((s) => s.includes("Erweiterungen")), "und eine Browserseite auch nicht");

  /* Gegenprobe gegen eine Liste, die schlicht alles verschluckt: Die Sperre
     wird BENUTZT, nicht nachgebaut — dieselbe Auskunft entscheidet hier und im
     Verbindungsweg. */
  assert.equal(rechte.sperrgrund("https://cloud.smartragents.ai/x"), "cloud");
  assert.equal(rechte.sperrgrund("https://www.ebay.de/sh/lst/active"), null);
});

test("T2 — Ein Klick in der Liste verbindet mit GENAU diesem Tab", async (t) => {
  const p = await panelStarten({
    alleTabs: TABS_GEMISCHT(),
    workerAntworten: { "link:verbinden": sitzungAntwort() },
  });
  t.after(p.aufraeumen);

  const ebay = listenZeilen(p).find((z) => z.textContent.includes("ebay.de"));
  assert.ok(ebay, "Vorbedingung: das andere Fenster steht in der Liste");
  p.klicksZuruecksetzen();
  p.aufrufeLeeren();

  await p.klickAuf(ebay);

  assert.equal(p.klicks(), 1, "auch der Weg ins andere Fenster kostet genau einen Klick");
  assert.equal(p.zustand.tabId, 8, "verbunden wird der angeklickte Tab, nicht der aktive");
  assert.equal(p.zustand.ursprung, "https://www.ebay.de");
  assert.equal(p.antraege().at(-1).gewuenscht.tab_host, "www.ebay.de");
  assert.equal(
    p.aufrufe()[0],
    "permissions.request",
    "auch hier wird Chrome gefragt, bevor irgendetwas abgewartet wird"
  );
});

test("T3 — startseite.js wird im Produktivweg gerufen; fehlt sie, zeichnet die Leiste selbst", async (t) => {
  /*
   * Der Anker gehoert A-PANEL, die Liste zeichnet A-WERKBANK (Vertrag §1).
   * Gemessen wird gegen das ECHTE Modul, nicht gegen eine Erfindung: Ein
   * Pruefsatz gegen eine ausgedachte Schnittstelle waere genau der Befund vom
   * 11.08.2026 in neuer Gestalt — gruen, und im ausgelieferten Weg ruft
   * niemand irgendetwas.
   */
  const echt = await import("../panel/startseite.js");
  const gerufen = [];
  const p = await panelStarten({
    alleTabs: TABS_GEMISCHT(),
    startseiteModul: {
      ...echt,
      aufbauen(wurzel, dienste) {
        gerufen.push({ wurzel, dienste });
        return echt.aufbauen(wurzel, dienste);
      },
    },
  });
  t.after(p.aufraeumen);
  await new Promise((f) => setTimeout(f, 0));

  assert.equal(gerufen.length, 1, "startseite.js wird genau einmal in den Anker gebaut");
  /*
   * Hier stand bis zum 14.08.2026 `p.el("startseite")`, also der ganze
   * Abschnitt. Die Erwartung ist geaendert, und zwar aus einem Befund und
   * nicht aus Bequemlichkeit (VERBINDUNG-5):
   *
   * `startseite.aufbauen` raeumt seinen Anker mit `replaceChildren()` leer. Auf
   * dem Abschnitt traf das zwei Knoten, die dem Modul nicht gehoeren — die
   * Ueberschrift `#startseite-titel`, auf die das `aria-labelledby` des
   * Abschnitts zeigt, und `#startseite-liste`, den Anker der Ersatzfassung in
   * panel.js. Gemessen wurde, dass nach dem Aufbau kein Knoten mit Kennung
   * mehr im Abschnitt stand: Der Bereich hatte danach keinen Namen mehr fuer
   * den Bildschirmleser, und die Ersatzfassung waere auf
   * `null.replaceChildren()` gelaufen, mitten in verbindungswegZeichnen(), das
   * auch in beenden() vor `link:trennen` steht.
   *
   * Der Anker ist deshalb das innere `#startseite-liste`. Was das Modul leert,
   * gehoert ab jetzt ihm allein.
   */
  assert.equal(
    gerufen[0].wurzel,
    p.el("startseite-liste"),
    "gebaut wird in #startseite-liste, nicht in den Abschnitt darum herum",
  );
  for (const dienst of ["tabsHolen", "verbinden", "trennen"]) {
    assert.equal(typeof gerufen[0].dienste[dienst], "function", `der Dienst ${dienst} fehlt`);
  }
  /* Die Liste, die das Modul bekommt, ist die BEREINIGTE: Der gesperrte
     Ursprung steht auch dann nicht darin, wenn das Modul selbst nicht
     filterte. */
  const uebergeben = await gerufen[0].dienste.tabsHolen();
  assert.deepEqual(uebergeben.map((x) => x.id), [7, 8]);
  assert.ok(p.el("startseite").childElementCount > 0, "und der Anker ist danach wirklich gefuellt");

  /* Ohne Modul bleibt der Anker trotzdem beantwortet — das misst T1 fuer den
     Regelfall, hier der leere: ein Satz mit dem naechsten Schritt statt einer
     Leerstelle. */
  const leer = await panelStarten({
    alleTabs: [{ id: 9, url: "https://cloud.smartragents.ai/x", title: "SMarTrAgents", active: true }],
  });
  t.after(leer.aufraeumen);
  const zeilen = listenZeilen(leer);
  assert.equal(zeilen.length, 1, "eine Zeile, und die erklaert die Lage");
  assert.equal(zeilen[0].textContent, erklaerungen.TAB_LISTE.leer.text);
});

test("T4 — Die Statuskarte nennt Titel, Adresse und Favicon des verbundenen Tabs", async (t) => {
  /*
   * Gefahren mit dem ECHTEN Startseiten-Modul, und das ist seit dem 14.08.2026
   * die Zusage selbst und nicht nur Bequemlichkeit: WELCHE Favicon-Adresse
   * geladen werden darf, entscheidet `startseite.faviconQuelle` und sonst
   * niemand (Festlegung F4). panel.js trug bis dahin eine zweite, schwaechere
   * Fassung derselben Regel — jede `https:`-Adresse war gut genug. Fehlt die
   * Regel, laedt die Tabkarte gar kein Bild; das misst T4c.
   */
  const echt = await import("../panel/startseite.js");
  const p = await panelStarten({ alleTabs: TABS_GEMISCHT(), startseiteModul: echt });
  t.after(p.aufraeumen);
  assert.equal(p.el("tabkarte").hidden, true, "Vorbedingung: ohne Sitzung keine Karte");

  await p.sitzungHerstellen();

  assert.equal(p.el("tabkarte").hidden, false, "mit der Sitzung steht die Karte da");
  assert.equal(p.el("tabkarte-titel").textContent, "Warenkorb");
  assert.equal(p.el("tabkarte-adresse").textContent, "geizhals.de");
  assert.equal(p.el("tabkarte-bild").getAttribute("src"), "https://geizhals.de/favicon.ico");
  assert.equal(p.el("tabkarte-bild").hidden, false);
  assert.equal(p.el("tabkarte-glyph").hidden, true, "das Ersatzzeichen weicht dem echten Symbol");

  /* Und der Weg zurueck steht daneben, nicht in einem Menue. */
  await p.klick("trennen");
  await warteAufZustand(p, "bereit");
  assert.equal(p.zustand.sitzung, null, "Trennen beendet die Sitzung");
  assert.equal(p.el("tabkarte").hidden, true, "und raeumt die Karte weg");
});

test("T4b — Ohne Favicon steht das Ersatzzeichen da, keine Luecke", async (t) => {
  const p = await panelStarten({
    alleTabs: [{ id: 7, url: "https://geizhals.de/warenkorb", title: "Warenkorb", active: true }],
  });
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  assert.equal(p.el("tabkarte-bild").hidden, true);
  assert.equal(p.el("tabkarte-bild").getAttribute("src"), null, "kein leeres src, das der Browser laedt");
  assert.equal(p.el("tabkarte-glyph").hidden, false);
  assert.equal(p.el("tabkarte-titel").textContent, "Warenkorb", "der Titel steht trotzdem da");
});

test("T4c — Die Tabkarte laedt kein Sinnbild von einer FREMDEN Adresse", async (t) => {
  /*
   * Selbst gefunden am 14.08.2026, dieselbe Fehlerart wie F4 in klickwache.js:
   * Zwei Stellen lasen dieselbe Sicherheitszusage verschieden. startseite.js
   * laesst nur `data:image/…` und denselben Wirt wie der Tab durch und nennt
   * alles andere ausdruecklich eine Wanze — `favIconUrl` kommt aus dem Kopf
   * einer fremden Seite, und eine Seite darf dort jede Adresse
   * hineinschreiben. panel.js pruefte nur `^https?://` und lud damit genau
   * das: Beim Aufbau der Karte meldete sich ein fremder Server und erfuhr,
   * dass die Seitenleiste offen ist.
   *
   * Gegenprobe: Mit `/^https?:\/\//.test(t.favIconUrl)` in tabkarteZeichnen
   * ist dieser Satz rot.
   */
  const echt = await import("../panel/startseite.js");
  const fremd = {
    id: 7,
    url: "https://geizhals.de/warenkorb",
    title: "Warenkorb",
    active: true,
    favIconUrl: "https://wanze.example/px.png",
  };
  const p = await panelStarten({ alleTabs: [fremd], tab: fremd, startseiteModul: echt });
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  assert.equal(p.el("tabkarte-bild").getAttribute("src"), null, "die fremde Adresse wird nie geladen");
  assert.equal(p.el("tabkarte-bild").hidden, true);
  assert.equal(p.el("tabkarte-glyph").hidden, false, "stattdessen steht das Ersatzzeichen da");
  /* Gegenprobe zur Regel selbst: Sie sagt hier wirklich Nein, und beim eigenen
     Wirt Ja. Beide Antworten kommen aus DERSELBEN Funktion. */
  assert.equal(echt.faviconQuelle(fremd).art, "zeichen");
  assert.equal(
    echt.faviconQuelle({ ...fremd, favIconUrl: "https://geizhals.de/favicon.ico" }).art,
    "bild",
  );
});

test("T4d — Derselbe Tabtitel heisst in beiden Karten gleich", async (t) => {
  /*
   * Selbst gefunden am 14.08.2026, und es ist die Fehlerart dieser Runde in
   * ihrer leisesten Gestalt: Zwei Anzeigeflaechen zeigten denselben Wert nach
   * zwei verschiedenen Regeln. Die Tabkarte ging durch `zitat` in panel.js,
   * die Statuskarte durch `saeubern` in startseite.js — und seit `saeubern`
   * auf die gemeinsame `anzeigeform` umgestellt ist, entscheiden die beiden
   * verschieden: Ein Nullbreitenzeichen wurde hier zu einem LEERZEICHEN und
   * dort ersatzlos entfernt. Auf demselben Bildschirm standen damit
   * „Waren korb" und „Warenkorb" fuer einen Tab, und das eingefuegte
   * Leerzeichen erfindet eine Wortgrenze, die es nie gab.
   *
   * Gegenprobe: Mit der eigenen Abschrift in `zitat` ist dieser Satz rot.
   */
  const echt = await import("../panel/startseite.js");
  /* Aus Zahlen gebaut, damit in dieser Datei kein unsichtbares Zeichen steht. */
  const unsichtbar = String.fromCharCode(0x200b);
  const tab = {
    id: 7,
    url: "https://geizhals.de/warenkorb",
    title: `Waren${unsichtbar}korb`,
    active: true,
  };
  const p = await panelStarten({ alleTabs: [tab], tab, startseiteModul: echt });
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  const inDerTabkarte = p.el("tabkarte-titel").textContent;
  const inDerStatuskarte = p.el("startseite").querySelector(".sa-start-ziel").textContent;
  assert.equal(
    inDerTabkarte,
    inDerStatuskarte,
    `zwei Namen fuer einen Tab: „${inDerTabkarte}" und „${inDerStatuskarte}"`,
  );
  assert.equal(inDerTabkarte, "Warenkorb", "und zwar der Name, den der Mensch auf der Seite liest");
});

test("T5 — Ein Tabwechsel zieht Liste, Hinweis und Modus nach", async (t) => {
  const tabs = TABS_GEMISCHT();
  const p = await panelStarten({ alleTabs: tabs });
  t.after(p.aufraeumen);
  assert.equal(p.zustand.aktuellerTab.id, 7, "Vorbedingung: der Warenkorb ist aktiv");
  assert.match(p.el("verbinden-hinweis").textContent, /Warenkorb/, "der Hinweis nennt den Tab beim Namen");

  /* Der Mensch wechselt das Fenster. Ohne diesen Nachzug verbaende der eine
     Klick danach mit dem Tab von vorhin — mit dem, den der Mensch gerade NICHT
     ansieht. */
  tabs[0].active = false;
  tabs[1].active = true;
  p.spurLeeren();
  await p.tabEreignis("onActivated", { tabId: 8, windowId: 3 });

  assert.equal(p.zustand.aktuellerTab.id, 8, "der Bestand folgt dem Wechsel");
  assert.match(p.el("verbinden-hinweis").textContent, /eBay/, "und der Hinweis sagt es");
  assert.ok(
    p.anWorkerVoll().some((n) => n.typ === "modus:stand?" && n.tabId === 8),
    "der Modus gilt je Tab, also wird er fuer den neuen Tab nachgefragt"
  );
});

/* ------------------------------------------------------------------ *
 * MO — der Betriebsmodus (Vertrag §2)
 * ------------------------------------------------------------------ */

test("MO1 — Drei Stufen, drei Etiketten, und vorbelegt ist das Mitdenken", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);

  /* Die Stufen kommen aus dem Vertrag, nicht aus der Oberflaeche. Kaeme eine
     dazu, ohne dass sie einen Knopf bekommt, wird dieser Satz rot — und nicht
     erst der Mensch, der sie vermisst. */
  assert.deepEqual([...befehle.MODI], ["manual", "assist", "auto"]);
  for (const m of befehle.MODI) {
    assert.ok(IDS_IM_HTML.has(`modus-${m}`), `die Stufe ${m} braucht einen Knopf in panel.html`);
  }
  const etiketten = befehle.MODI.map((m) => erklaerungen.MODUS_TEXT[m].etikett);
  assert.deepEqual(etiketten, ["Jeder Schritt einzeln", "Mitdenken", "Selbständig"]);
  for (const m of befehle.MODI) {
    const inHtml = new RegExp(`<button id="modus-${m}"[^>]*>\\s*([^<]+?)\\s*</button>`).exec(html);
    assert.ok(inHtml, `der Knopf fuer ${m} muss in panel.html stehen`);
    assert.equal(
      inHtml[1],
      erklaerungen.MODUS_TEXT[m].etikett,
      "Knopf und Text sagen dasselbe Wort — sonst sucht der Vorleser einen Knopf, den es nicht gibt"
    );
  }

  assert.equal(p.zustand.modus, befehle.MODUS_STANDARD, "Voreinstellung nach dem Update");
  assert.equal(p.zustand.modus, "assist");
  assert.equal(p.el("modus-assist").getAttribute("aria-checked"), "true");
  assert.equal(p.el("modus-manual").getAttribute("aria-checked"), "false");
  assert.equal(p.el("modus-auto").getAttribute("aria-checked"), "false");
  assert.equal(p.el("modus-chip").textContent, "Mitdenken", "der Chip spiegelt denselben Modus");
});

test("MO2 — Die Wahl laeuft uebers Popup an der Pille, geht je Tab an den Dienst und spiegelt sich ueberall", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  p.spurLeeren();

  /* Der Weg des Menschen seit 0.6.3: Die Pille an der Eingabekarte oeffnet
     das Popup, die Wahl darin ist DIESELBE Bedienung wie vorher im
     Dauerblock — dieselben Knoepfe, derselbe Handler, derselbe Weg zur
     Ablage (modus:setzen an den Dienst, der sa_modus fuehrt). */
  await p.klick("modus-chip");
  assert.equal(p.el("modus-dialog").hidden, false, "die Pille oeffnet die Moduswahl");
  await p.klick("modus-auto");

  const gesetzt = p.anWorkerVoll().filter((n) => n.typ === "modus:setzen");
  assert.equal(gesetzt.length, 1, "genau eine Meldung an den Dienst");
  assert.equal(gesetzt[0].modus, "auto");
  assert.equal(gesetzt[0].tabId, 7, "und zwar fuer DIESEN Tab — der Modus gilt je Tab (Vertrag §2)");
  assert.equal(p.zustand.modus, "auto");
  assert.equal(p.el("modus-auto").getAttribute("aria-checked"), "true");
  assert.equal(p.el("modus-assist").getAttribute("aria-checked"), "false", "genau ein Haken, nicht zwei");
  /* Nach der Wahl schliesst das Popup von selbst — die Wahl ist getroffen,
     eine offene Karte darueber waere nur ein Hindernis vor dem Chatfeld. */
  assert.equal(p.el("modus-dialog").hidden, true, "nach der Wahl schliesst das Popup");
  assert.equal(p.el("modus-chip").textContent, "Selbständig", "die Pille traegt den neuen Wortlaut");
  assert.match(
    p.el("modus-chip").getAttribute("aria-label") || "",
    /Selbständig/,
    "und ihr zugaenglicher Name traegt ihn auch — nicht nur ein Wort ohne Frage"
  );
  assert.equal(
    p.el("modus-auskunft").textContent,
    erklaerungen.MODUS_TEXT.auto.auskunft,
    "und die Auskunft im Popup wechselt mit"
  );
  /* Die Ansage laeuft wie vor dem Umbau: Etikett und Auskunft, beim
     Selbstaendig-Modus mit dem Riegel im selben Atemzug (modusSetzen). */
  assert.ok(
    p.gesprochen.some((s) => s.includes(erklaerungen.MODUS_TEXT.auto.etikett)),
    `die Wahl wurde nicht angesagt: ${p.gesprochen.join(" | ")}`
  );

  /* Der Umschalter ist EIN Halt in der Tabulatorreihe, nicht drei. */
  assert.equal(p.el("modus-auto").getAttribute("tabindex"), "0");
  assert.equal(p.el("modus-assist").getAttribute("tabindex"), "-1");
});

test("MO3 — Ein Modus, den es nicht gibt, aendert nichts", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.klick("modus-auto");
  p.spurLeeren();

  for (const unfug of ["full", "AUTO", "", null, {}, "constructor"]) {
    const gesetzt = await p.f.modusSetzen(unfug);
    assert.equal(gesetzt, false, `„${String(unfug)}" darf nicht durchkommen`);
  }
  assert.equal(p.zustand.modus, "auto", "der zuletzt gewaehlte Modus steht unveraendert");
  assert.equal(
    p.anWorkerVoll().filter((n) => n.typ === "modus:setzen").length,
    0,
    "und es geht keine Meldung an den Dienst, die niemand gewaehlt hat"
  );
});

test("MO4 — Beim Oeffnen gilt der Stand des Dienstes, sonst die Voreinstellung", async (t) => {
  /* Die Wahrheit ueber den Modus liegt im Hintergrunddienst (storage.session,
     sa_modus). Die Leiste zeigt sie an, sie erfindet sie nicht. */
  const echt = await panelStarten({ workerAntworten: { "modus:stand?": { modus: "manual", schritte: 50 } } });
  t.after(echt.aufraeumen);
  assert.equal(echt.zustand.modus, "manual", "der Dienst sagt manual, also steht manual da");
  assert.equal(echt.el("modus-manual").getAttribute("aria-checked"), "true");

  /* Und ein Wert, den niemand lesen kann, faellt auf die Voreinstellung
     zurueck — nicht auf die staerkste Stufe und nicht auf die zuletzt
     angezeigte. */
  for (const unfug of [{ modus: "vollgas" }, { modus: 7 }, {}, null]) {
    const p = await panelStarten({ workerAntworten: { "modus:stand?": unfug } });
    t.after(p.aufraeumen);
    assert.equal(p.zustand.modus, befehle.MODUS_STANDARD, `bei ${JSON.stringify(unfug)}`);
  }
});

test("MO5 — Das Etikett „Selbständig“ verspricht nichts, was nicht gilt", async (t) => {
  /*
   * Derselbe Satz wie S4 für „Vollzugriff", nur für den Modus `auto`.
   *
   * Er misst nicht Beispiele, sondern die Eigenschaft: JEDE harte Klasse aus
   * net/befehle.js wird auch in der Automatik gefragt (Vertrag §3.2), und
   * JEDE kommt im Riegel neben dem Umschalter vor. Kommt eine harte Klasse
   * dazu, ohne dass der Text sie nennt, wird dieser Satz rot — und nicht erst
   * der Mensch, der glaubte, sie sei abgeschaltet.
   */
  const regelnOffen = { gesperrt: false, frei: [...befehle.WEICH] };
  for (const klasse of befehle.HART) {
    const e = befehle.freigabeNoetig("auto", { klassen: [klasse], hart: klasse, weich: [] }, regelnOffen);
    assert.equal(e.fragen, true, `im Modus auto wird ${klasse} trotzdem gefragt`);
  }
  /* Gegenprobe, damit oben nicht schlicht „auto fragt immer" gemessen wird:
     Eine freigeschaltete weiche Klasse laeuft dort wirklich durch — genau das
     ist der ganze Unterschied zwischen assist und auto. */
  const weich = befehle.freigabeNoetig("auto", { klassen: ["senden"], hart: null, weich: ["senden"] }, regelnOffen);
  assert.equal(weich.fragen, false, "sonst haette der Modus keine Wirkung und das Etikett keinen Sinn");

  const RIEGEL_WORT = {
    zahlung: /zahlung/i,
    geheim: /passw(o|ö)r/i,
    unwiderruflich: /l(ö|oe)sch/i,
    datei: /datei/i,
    berechtigung: /berechtigung/i,
    captcha: /captcha/i,
  };
  for (const klasse of befehle.HART) {
    assert.ok(RIEGEL_WORT[klasse], `fuer die harte Klasse ${klasse} fehlt hier das Wort`);
    assert.match(
      erklaerungen.MODUS_RIEGEL,
      RIEGEL_WORT[klasse],
      `der Riegel neben dem Umschalter verschweigt ${klasse}`
    );
  }

  /* Was der Mensch nach der Wahl WIRKLICH liest — gefahren, nicht abgeschrieben. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.klick("modus-auto");
  const auskunft = p.el("modus-auskunft").textContent;
  const riegel = p.el("modus-riegel").textContent;
  assert.equal(riegel, erklaerungen.MODUS_RIEGEL, "der Riegel steht sichtbar da, in jedem Modus");
  assert.match(auskunft, /freigeschaltet/, "Gegenprobe: es ist wirklich die Auskunft zu `auto`");

  const ZU_VIEL_VERSPROCHEN = [
    [/passwor|passwör|kennwort/i, "Passwörter"],
    [/\bmeldet? (sich|dich) an\b/i, "sich anmelden"],
    [/\balles\b[^.]{0,20}\bohne\b/i, "alles ohne Rückfrage"],
    [/\bfragt? (nie|nichts)\b/i, "nie zu fragen"],
  ];
  for (const text of [erklaerungen.MODUS_TEXT.auto.etikett, auskunft]) {
    for (const [muster, was] of ZU_VIEL_VERSPROCHEN) {
      assert.ok(!muster.test(text), `„Selbständig“ verspricht „${was}“: ${text}`);
    }
  }

  /* Und wer sich vorlesen laesst, hoert die Grenze im selben Atemzug mit der
     Wahl — nicht erst, wenn er die Seite mit der Tabulatortaste abgeht. */
  assert.ok(
    p.gesprochen.some((s) => s.includes(erklaerungen.MODUS_RIEGEL)),
    `der Riegel wurde bei der Wahl nicht gesprochen: ${p.gesprochen.join(" | ")}`
  );
});

test("MO6 — Der Riegel steht BEI der Wahl im Popup, nicht in einer Fussnote", () => {
  /* Gemessen wird die Stelle im Text, nicht das blosse Vorkommen: „steht
     irgendwo in panel.html" war schon wahr, als er in der Fusszeile stand.
     Dieselbe Messung wie bei S3 — seit 0.6.3 im Popup #modus-dialog, denn
     der Dauerblock ist weg (Befund Inhaber 15.08.2026). */
  const bereichAb = html.indexOf('<section id="modus-dialog"');
  const bereichBis = html.indexOf("</section>", bereichAb);
  assert.ok(bereichAb >= 0 && bereichBis > bereichAb, "die Moduswahl braucht ihren eigenen Dialog");

  const dialogTag = /<section id="modus-dialog"[^>]*>/.exec(html);
  assert.match(dialogTag[0], /role="dialog"/, "er sagt, was er ist");
  assert.match(dialogTag[0], /aria-labelledby="modus-titel"/, "und traegt seinen Namen");

  const titel = html.indexOf('id="modus-titel"', bereichAb);
  const wahl = html.indexOf('id="modus-wahl"', bereichAb);
  const auskunft = html.indexOf('id="modus-auskunft"', bereichAb);
  const riegel = html.indexOf('id="modus-riegel"', bereichAb);
  assert.ok(titel > bereichAb && titel < bereichBis, "die Ueberschrift steht darin");
  assert.ok(wahl > titel && wahl < bereichBis, "der Umschalter danach");
  assert.ok(auskunft > wahl && auskunft < bereichBis, "die Auskunft folgt");
  assert.ok(riegel > auskunft && riegel < bereichBis,
    "und der Riegel unmittelbar danach, im selben Dialog — wer waehlt, hoert ihn im selben Atemzug");

  /* Der Riegel ist nie einzeln versteckt: Er gilt in jedem Modus, also darf
     ihn kein Modus zudecken. Der Dialog selbst beginnt zu — er ist ein
     Popup, kein Dauerblock. */
  assert.ok(!VERSTECKT_IM_HTML.has("modus-riegel"), "der Riegel haengt nur am Dialog, nicht an einem eigenen hidden");
  assert.ok(VERSTECKT_IM_HTML.has("modus-dialog"), "das Popup beginnt verborgen");
});

test("MO7 — Die Pille oeffnet die Moduswahl, der Fokus wandert hinein und beim Schliessen auf die Pille zurueck", async (t) => {
  /* Dasselbe Muster wie BB7 am Beibringen-Dialog: EIN Popup-Verhalten fuer
     beide Knoepfe der Werkzeugzeile, keine zweite Fokusregel. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  assert.equal(p.el("modus-dialog").hidden, true, "Vorbedingung: das Popup beginnt zu");

  await p.klick("modus-chip");
  assert.equal(p.el("modus-dialog").hidden, false, "die Pille oeffnet das Popup");
  assert.equal(p.el("modus-chip").getAttribute("aria-expanded"), "true", "und sagt das auch");
  /* Der Fokus steht auf der Ueberschrift — der Vorleser sagt damit zuerst,
     WO man gelandet ist (dieselbe Regel wie bei den Karten, ueberschriftVon). */
  assert.equal(p.fokus(), p.el("modus-titel"), "der Fokus wandert in das Popup, auf die Ueberschrift");

  /* Ein einzelnes Escape schliesst — und der Fokus kehrt auf die Pille
     zurueck, nicht auf body: Auf body bleibt der Vorleser stumm. */
  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.equal(p.el("modus-dialog").hidden, true, "ein einzelnes Escape schliesst das Popup");
  assert.equal(p.el("modus-chip").getAttribute("aria-expanded"), "false");
  assert.equal(p.fokus(), p.el("modus-chip"), "der Fokus steht wieder auf der Pille");
  assert.notEqual(p.fokus(), p.koerper, "und faellt nie auf body");

  /* Die Pille ist auch der Weg zu: Ein zweiter Druck schliesst, wie am
     Menue-Knopf — samt Fokusrueckgabe. */
  await p.klick("modus-chip");
  assert.equal(p.el("modus-dialog").hidden, false);
  await p.klick("modus-chip");
  assert.equal(p.el("modus-dialog").hidden, true, "dieselbe Pille schliesst wieder");
  assert.equal(p.fokus(), p.el("modus-chip"));

  /* Und nach einer WAHL schliesst das Popup von selbst: Die Pille traegt den
     neuen Wortlaut, der Fokus kehrt zu ihr zurueck — der Mensch steht wieder
     da, wo er angefangen hat, direkt neben dem Chatfeld. */
  await p.klick("modus-chip");
  await p.klick("modus-manual");
  assert.equal(p.el("modus-dialog").hidden, true, "nach der Wahl schliesst das Popup von selbst");
  assert.equal(p.el("modus-chip").textContent, "Jeder Schritt einzeln", "die Pille traegt den neuen Wortlaut");
  assert.equal(p.fokus(), p.el("modus-chip"), "und der Fokus kehrt auf die Pille zurueck");
});

test("MO8 — Das Popup-Escape der Moduswahl laesst die Notbremse ganz: es stiehlt ihr keinen Schlag und schenkt ihr keinen", async (t) => {
  /* Dasselbe Muster wie BB8: Ein Dialog, der den ersten Schlag schluckte,
     machte aus Esc Esc drei Schlaege; einer, der ihn mitbraechte, stoppte
     die Sitzung beim blossen Schliessen. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  assert.ok(p.zustand.sitzung, "Vorbedingung: es laeuft eine Sitzung");
  await p.klick("modus-chip");
  assert.equal(p.el("modus-dialog").hidden, false, "Vorbedingung: das Popup ist offen");
  p.alleSpurenLeeren();

  /* Schlag 1 schliesst NUR das Popup. Die Sitzung lebt weiter. */
  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.equal(p.el("modus-dialog").hidden, true, "das erste Escape schliesst das Popup");
  assert.ok(p.zustand.sitzung, "und beendet keine Sitzung");
  assert.ok(!p.anWorker().includes("link:notaus"), "kein Not-Aus beim blossen Schliessen");

  /* Schlag 2, unmittelbar danach: Wuerde das Popup-Escape als erster Schlag
     der Notbremse mitgezaehlt, feuerte JETZT der Not-Aus. */
  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.ok(p.zustand.sitzung, "das Schliessen des Popups zaehlt nicht als erster Schlag der Notbremse");
  assert.ok(!p.anWorker().includes("link:notaus"));

  /* Schlag 3: Jetzt sind es zwei ECHTE Schlaege kurz hintereinander — die
     Notbremse funktioniert nach dem Popup genau wie vorher (N3). */
  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.equal(p.zustand.sitzung, null, "Esc Esc bleibt die Notbremse");
  const reihe = p.anWorker();
  assert.ok(reihe.indexOf("link:notaus") < reihe.indexOf("link:trennen"), "auf demselben Weg wie der Knopf");
  assert.equal(p.anWorkerVoll().find((n) => n.typ === "link:notaus").grund, "esc");
});

test("MO9 — Genau EIN Bedienelement fuer den Modus, und zwischen Sitzungsleiste und Gespraechsflaeche steht kein Dauerblock", () => {
  /* Die eine Stelle ist die Pille an der Eingabekarte. Der Dauerbereich der
     0.6.2 („Wie selbstaendig soll ich arbeiten?" samt Knopfreihe, Auskunft
     und Riegel) ist restlos weg — nicht versteckt, sondern nicht mehr da
     (Befund Inhaber 15.08.2026: „button einmal reicht"). */
  assert.equal(
    [...html.matchAll(/aria-controls="modus-dialog"/g)].length,
    1,
    "genau ein Element oeffnet die Moduswahl"
  );
  const pille = /<button id="modus-chip"[^>]*>/.exec(html);
  assert.ok(pille, "die Pille ist ein echter <button>, keine Klickspanne");
  assert.equal(TAG_IM_HTML.get("modus-chip"), "button");
  assert.match(pille[0], /aria-controls="modus-dialog"/, "und genau sie ist dieses eine Element");
  assert.match(pille[0], /aria-haspopup="dialog"/, "sie kuendigt das Popup an");
  assert.match(pille[0], /aria-expanded="false"/, "und beginnt zu");
  assert.ok(!/role=/.test(pille[0]), "role=button bringt das Element selbst mit — und radio traegt sie nie");

  assert.ok(!html.includes('id="modus-bereich"'), "die alte obere Sektion existiert nicht mehr im Dauerlayout");
  assert.equal(
    [...html.matchAll(/role="radiogroup" aria-labelledby="modus-titel"/g)].length,
    1,
    "eine radiogroup fuer den Modus, keine zweite Fassung"
  );

  /* Zwischen Sitzungsleiste und Gespraechsflaeche beginnt ALLES verborgen:
     Jeder Dauerblock dort drueckt das Chatfeld unter den Bildschirmrand,
     und der Merksatz des Inhabers ist Abnahmekriterium — das Eingabefeld
     muss IMMER sichtbar sein. */
  const leisteAb = html.indexOf('id="sitzungsleiste"');
  const flaecheAb = html.indexOf('<main id="flaeche"');
  assert.ok(leisteAb >= 0 && flaecheAb > leisteAb, "Sitzungsleiste und Gespraechsflaeche stehen in dieser Reihenfolge");
  const dazwischen = html
    .slice(html.indexOf("</div>", leisteAb), flaecheAb)
    .replace(/<!--[\s\S]*?-->/g, "");
  for (const tr of dazwischen.matchAll(/<section id="([^"]+)"/g)) {
    assert.ok(VERSTECKT_IM_HTML.has(tr[1]), `#${tr[1]} steht als Dauerblock zwischen Sitzungsleiste und Gespraechsflaeche`);
  }
  /* Auch ausserhalb der Karten darf dort nichts Sichtbares wohnen — was
     bleibt, sind Elemente, die im HTML selbst `hidden` tragen. */
  const ohneKarten = dazwischen.replace(/<section[\s\S]*?<\/section>/g, "");
  for (const tr of ohneKarten.matchAll(/<[a-zA-Z][^>]*\sid="([^"]+)"[^>]*>/g)) {
    assert.ok(VERSTECKT_IM_HTML.has(tr[1]), `#${tr[1]} steht als Dauerblock zwischen Sitzungsleiste und Gespraechsflaeche`);
  }
});

/* ------------------------------------------------------------------ *
 * N — der Not-Aus (Vertrag §5)
 * ------------------------------------------------------------------ */

test("N1 — Solange eine Sitzung laeuft, verschwindet der Stopp-Knopf in KEINEM Zustand", async (t) => {
  /*
   * Bis 0.5.2 hing die Sitzungsleiste allein am Zustand `aktiv`. Jede Karte,
   * die waehrend einer laufenden Sitzung erscheinen kann — die Kennwortkarte
   * bei der Selbsterneuerung, die Erklaerkarte, die Anmeldung —, nahm dem
   * Menschen damit die Notbremse weg, waehrend der Agent seine Rechte auf dem
   * Tab behielt. Gefahren wird deshalb JEDER Zustand, nicht nur der eine, der
   * damals aufgefallen ist.
   */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  assert.ok(p.zustand.sitzung, "Vorbedingung: es laeuft wirklich etwas");

  for (const name of ["bereit", "dialog", "anmeldung", "kennwort", "erklaerung", "werkbank", "buch", "aktiv"]) {
    p.f.setzeZustand(name);
    assert.equal(
      p.el("sitzungsleiste").hidden,
      false,
      `im Zustand „${name}" ist die Notbremse verschwunden`
    );
    assert.equal(p.el("stopp").hidden, false, `im Zustand „${name}" ist der Stopp-Knopf verborgen`);
  }

  /* Gegenprobe, damit oben nicht schlicht „immer sichtbar" gemessen wird:
     Ohne Sitzung gibt es nichts zu stoppen, und dann steht die Leiste auch
     nicht da. */
  await p.f.beenden("nutzer");
  await warteAufZustand(p, "bereit");
  assert.equal(p.el("sitzungsleiste").hidden, true, "ohne Sitzung keine Leiste");
});

test("N2 — Der Not-Aus meldet zuerst und wartet auf nichts", async (t) => {
  /* Vertrag §5: Zwischen dem Ereignis und „nichts laeuft mehr" liegt weniger
     als eine Sekunde, und zwar ohne auf eine Antwort des Relays zu warten.
     Erst kappen, dann melden. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.alleSpurenLeeren();

  await p.klick("stopp");

  const reihe = p.anWorker();
  assert.ok(reihe.includes("link:notaus"), "der Not-Aus meldet sich beim Dienst (Vertrag §6)");
  assert.ok(
    reihe.indexOf("link:notaus") < reihe.indexOf("link:trennen"),
    `erst kappen, dann melden — gemessen: ${reihe.join(" → ")}`
  );
  const meldung = p.anWorkerVoll().find((n) => n.typ === "link:notaus");
  assert.equal(meldung.grund, "notbremse");
  assert.equal(p.zustand.sitzung, null, "und die Sitzung ist hier sofort zu Ende");
  assert.ok(p.anTab().includes("overlay:gestoppt"), "im Tab steht „gestoppt“ und nicht „aus“");
  assert.ok(p.rechteRueckgaben() > 0, "das Seitenrecht geht zurueck");
});

test("N3 — Zweimal Escape in der Seitenleiste bricht ab, einmal nicht", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.alleSpurenLeeren();

  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.ok(p.zustand.sitzung, "ein einzelnes Escape beendet nichts — sonst waere jede Karte ein Risiko");
  assert.ok(!p.anWorker().includes("link:notaus"));

  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.equal(p.zustand.sitzung, null, "zweimal kurz hintereinander beendet sofort");
  const reihe = p.anWorker();
  assert.ok(reihe.indexOf("link:notaus") < reihe.indexOf("link:trennen"), "auf demselben Weg wie der Knopf");
  assert.equal(p.anWorkerVoll().find((n) => n.typ === "link:notaus").grund, "esc");

  /* Und eine Taste, die nicht Escape heisst, tut gar nichts. */
  const q = await panelStarten();
  t.after(q.aufraeumen);
  await q.sitzungHerstellen();
  await q.fensterEreignis("keydown", { key: "e" });
  await q.fensterEreignis("keydown", { key: "e" });
  assert.ok(q.zustand.sitzung, "nur Escape ist die Notbremse");
});

/* ------------------------------------------------------------------ *
 * P — das Live-Protokoll (Vertrag §6)
 * ------------------------------------------------------------------ */

test("P1 — Jede Protokollzeile traegt genau einen Zeitstempel in <time>", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  p.melden({ typ: "link:protokoll", text: "Lese die Seite: Bedienelemente einsammeln" });
  p.melden({ typ: "link:protokoll", text: "Erledigt: click", cmd: "click", ergebnis: "ok" });

  const zeiten = p.protokollZeiten();
  assert.equal(zeiten.length, 2, "Vorbedingung: zwei Zeilen");
  for (const [i, liste] of zeiten.entries()) {
    assert.equal(liste.length, 1, `Zeile ${i + 1} braucht genau ein <time>`);
    assert.match(liste[0].textContent, /^\d{2}:\d{2}:\d{2}$/, "sichtbar als Uhrzeit");
    assert.match(
      liste[0].getAttribute("datetime"),
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      "und maschinenlesbar im datetime, sonst liest ein Bildschirmleser Ziffern statt einer Zeit"
    );
  }
});

test("P2 — Der Zeitstempel kommt aus der Meldung, nicht aus der Ankunft", async (t) => {
  /* `zeit` stammt vom Ausfuehrer, also von der Stelle, die den Schritt wirklich
     getan hat. Wuerde hier die Ankunftszeit stehen, waere jede Zeile um die
     Laufzeit der Meldung falsch — und ein Protokoll, das die Reihenfolge
     verschiebt, ist schlimmer als keines. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  /* Ein Zeitpunkt, der sicher in der Vergangenheit liegt — sonst misst der
     Vergleich unten die Uhr des Pruefrechners statt den Fix. */
  const damals = Date.now() - 3600_000;
  p.melden({ typ: "link:protokoll", text: "Erledigt: click", cmd: "click", zeit: damals });
  const uhr = p.protokollZeiten().at(-1)[0];
  assert.equal(uhr.getAttribute("datetime"), new Date(damals).toISOString());

  /* Ohne Angabe wird nichts geraten, sondern der Augenblick genommen — und der
     liegt sichtbar nach der alten Meldung. */
  p.melden({ typ: "link:protokoll", text: "Erledigt: type" });
  const jetzt = Date.parse(p.protokollZeiten().at(-1)[0].getAttribute("datetime"));
  assert.ok(jetzt > damals, "eine Zeile ohne Zeitangabe bekommt die eigene, keine erfundene");
  assert.ok(Math.abs(jetzt - Date.now()) < 5000, "und zwar den Augenblick, nicht irgendeine Zahl");

  /* Eine unbrauchbare Angabe fuehrt nicht zu „Invalid Date" auf dem
     Bildschirm — fail-closed wie ueberall. */
  for (const unfug of ["gestern", -1, 0, {}, NaN]) {
    p.melden({ typ: "link:protokoll", text: "Erledigt: scroll", zeit: unfug });
    const gesetzt = Date.parse(p.protokollZeiten().at(-1)[0].getAttribute("datetime"));
    assert.ok(Number.isFinite(gesetzt), `„${String(unfug)}" ergibt keine lesbare Zeit`);
  }
});

test("P3 — Befehl und Ergebnis stehen am Element, nicht im vorgelesenen Satz", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  p.melden({
    typ: "link:protokoll",
    text: "Erledigt: click",
    cmd: "click",
    ergebnis: "ok",
    zeit: Date.now(),
  });
  const li = p.el("protokoll").kinder.at(-1);
  assert.equal(li.getAttribute("data-cmd"), "click");
  assert.equal(li.getAttribute("data-ergebnis"), "ok");
  assert.equal(
    p.protokollSatz().at(-1),
    "Erledigt: click",
    "der Satz bleibt der Satz — „Erledigt: click, ok“ sagt einem Menschen nichts mehr"
  );

  /* Auch diese beiden Felder kommen von aussen und werden entschaerft. */
  p.melden({
    typ: "link:protokoll",
    text: "Erledigt: type",
    cmd: `cl${String.fromCharCode(7)}ick${"X".repeat(200)}`,
    ergebnis: `ok${String.fromCharCode(0x200b)}`,
  });
  const zwei = p.el("protokoll").kinder.at(-1);
  assert.ok(!steuerzeichenDrin(zwei.getAttribute("data-cmd")));
  assert.ok(!steuerzeichenDrin(zwei.getAttribute("data-ergebnis")));
  assert.ok(zwei.getAttribute("data-cmd").length <= 41, "gedeckelt wie jeder Fremdtext");

  /* Und eine blanke Zeichenkette bleibt gueltig: Der Bestand ruft diese Stelle
     an einem Dutzend Orten so auf (Vertrag §6, „text bleibt Pflicht und
     abwaertskompatibel"). */
  p.f.protokollieren("Verlängert: die Freigabe läuft weiter");
  assert.equal(p.protokollSatz().at(-1), "Verlängert: die Freigabe läuft weiter");
  assert.equal(p.protokollZeiten().at(-1).length, 1, "und bekommt trotzdem ihre Uhrzeit");
});

test("P4 — Der Sekundentakt des Protokolls uebertoent die Freigabekarte nicht", async (t) => {
  /* Dieselbe Regel wie F7 und F8: Was im Sekundentakt eintrifft, gehoert in
     keine Vorlesezone. Die Freigabefrage ist das Dringendste, was diese Leiste
     zu sagen hat; ein Protokoll, das dazwischenspricht, kostet genau sie. */
  assert.match(html, /id="protokoll"[^>]*aria-live="off"/, "das Protokoll spricht nicht von selbst");
  assert.match(html, /id="protokoll"[^>]*role="log"/, "es sagt trotzdem, was es ist");

  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.zustand.vorlesen = "alles";
  p.spurLeeren();

  const antwort = p.frageStellen({
    typ: "link:schritt-freigabe",
    frage: "Für dich klicken?",
    quelle: "Zur Kasse",
    cmd: "click",
    id: "b9",
  });
  const frageAnsage = p.el("ansage").textContent;
  const stimmen = p.gesprochen.length;
  const abbrueche = p.stimmabbrueche();

  for (let i = 0; i < 5; i += 1) {
    p.melden({ typ: "link:protokoll", text: `Erledigt: schritt ${i}`, cmd: "click", zeit: Date.now() });
  }

  assert.equal(p.el("ansage").textContent, frageAnsage, "die Live-Region gehoert der Frage");
  assert.equal(p.zustand.letzteRede, frageAnsage, "und der 🔊-Knopf liest die Frage");
  assert.equal(p.gesprochen.length, stimmen, "keine zweite Stimme ueber die laufende Frage");
  assert.equal(p.stimmabbrueche(), abbrueche, "und kein Abbruch mitten im Satz");
  assert.equal(p.protokollSatz().length, 5, "verschwiegen wird trotzdem nichts");

  await p.klick("freigabe-ja");
  await antwort;
});

/* ------------------------------------------------------------------ *
 * C — die Cloud-Sitzung (Vertrag §8.4)
 * ------------------------------------------------------------------ */

test("C1 — Die Dauerzeile steht da, solange die Cloud-Sitzung laeuft", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  assert.equal(p.el("cloud-zeile").hidden, true, "Vorbedingung: ohne Fernsitzung keine Zeile");

  p.melden({ typ: "link:cloud-sitzung", an: true, agent: "SMarTrCEO" });

  assert.equal(p.el("cloud-zeile").hidden, false, "sie erscheint");
  assert.equal(p.el("cloud-agent").textContent, "SMarTrCEO", "und nennt den Agenten beim Namen");
  assert.equal(p.zustand.cloudAgent, "SMarTrCEO");
  assert.match(html, /id="cloud-zeile"/, "Gegenprobe: die Zeile steht wirklich in panel.html");
  assert.ok(
    html.indexOf('id="cloud-zeile"') < html.indexOf('<main id="flaeche"'),
    "und zwar oben, nicht unter dem Gespraech"
  );

  /* Sie bleibt stehen. Eine Fernsitzung, die man nur beim Start sieht, ist
     genau die Lage, die §8.4 ausschliesst. */
  p.f.setzeZustand("dialog");
  assert.equal(p.el("cloud-zeile").hidden, false, "auch beim Kartenwechsel");
  p.f.setzeZustand("bereit");
  assert.equal(p.el("cloud-zeile").hidden, false);

  p.melden({ typ: "link:cloud-sitzung", an: false });
  assert.equal(p.el("cloud-zeile").hidden, true, "erst die Abmeldung raeumt sie weg");
  assert.equal(p.zustand.cloudAgent, null);
});

test("C2 — Der Agentenname wird entschaerft und nie gesprochen", async (t) => {
  /* Der Name kommt vom Relay und damit von aussen. Er geht deshalb durch
     dieselbe Entschaerfung wie jeder Fremdtext und wird nie in einen Satz
     eingebaut, den die Stimme spricht — genau die Regel, die im Bestand fuer
     die Beschriftungen der besuchten Seite gilt. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  p.zustand.vorlesen = "alles";
  p.el("ansage").textContent = "";
  p.spurLeeren();

  const boese = `SMarTr${String.fromCharCode(7)}CEO${String.fromCharCode(0x200b)}${"X".repeat(200)}`;
  p.melden({ typ: "link:cloud-sitzung", an: true, agent: boese });

  const gezeigt = p.el("cloud-agent").textContent;
  assert.ok(!steuerzeichenDrin(gezeigt), "Steuerzeichen und Nullbreiten kommen nie in die Zeile");
  assert.ok(gezeigt.length <= 41, `der Name wird gedeckelt, gemessen: ${gezeigt.length}`);
  assert.equal(p.el("ansage").textContent, "", "die Vorlesezone bleibt der Sitzung, nicht dem Namen");
  assert.equal(p.gesprochen.length, 0, "und gesprochen wird der Fremdname nie");
});

test("C3 — Das Ende der Tab-Sitzung raeumt die Cloud-Sitzung nicht weg", async (t) => {
  /* Zwei verschiedene Dinge: Die Steuersitzung gehoert diesem Tab, die
     Cloud-Sitzung laeuft in der Cloud. Sie hier stillschweigend zu verstecken
     hiesse, dem Menschen eine laufende Fernsitzung zu verschweigen. */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  p.melden({ typ: "link:cloud-sitzung", an: true, agent: "SMarTrTrader" });

  await p.f.beenden("nutzer");
  await warteAufZustand(p, "bereit");

  assert.equal(p.zustand.sitzung, null, "Vorbedingung: die Steuersitzung ist zu Ende");
  assert.equal(p.el("cloud-zeile").hidden, false, "die Fernsitzung steht weiterhin da");
  assert.equal(p.el("cloud-agent").textContent, "SMarTrTrader");
});

test("C4 — Nach dem Wiederoeffnen steht die Dauerzeile wieder da, nicht nur beim Start", async (t) => {
  /*
   * Fund H5 der Abnahme vom 14.08.2026: `zustandNachfragen()` stellte Sitzung,
   * Tab und Ursprung wieder her, rief `cloudSitzungZeigen` aber nie. Einziger
   * Aufrufer war der Nachrichtenhoerer, und `link.js` sendet
   * `link:cloud-sitzung` nur beim START der Sitzung. Gemessen wurde:
   * `link:zustand?` liefert `{verbunden:true, agent:"SMarTrCEO"}`,
   * `zustand.sitzung` steht, aber `#cloud-zeile.hidden === true`,
   * `#cloud-agent === ""` und „Am Werk:" auf der Startseite leer.
   *
   * Vertrag §8.4 verlangt die drei Zeichen, solange die Sitzung LAEUFT, nicht
   * nur im Augenblick ihres Starts. Gefahren wird durch das echte
   * Startseiten-Modul, damit auch die zweite Anzeige wirklich gemessen ist.
   */
  const echt = await import("../panel/startseite.js");
  const p = await panelStarten({
    startseiteModul: echt,
    workerAntworten: {
      "link:zustand?": {
        verbunden: true,
        tabId: 7,
        ursprungMuster: "https://geizhals.de/*",
        agent: "SMarTrCEO",
        stufe: "write",
        code: "AB12CD",
        endetUm: Date.now() + 600000,
        modus: "tab",
        bereich: ["geizhals.de"],
        schrittmodus: "confirm_each",
      },
    },
  });
  t.after(p.aufraeumen);
  await new Promise((f) => setTimeout(f, 0));

  assert.ok(p.zustand.sitzung, "Vorbedingung: die Sitzung ist wiederhergestellt");
  assert.equal(p.el("cloud-zeile").hidden, false, "die Dauerzeile steht da (§8.4, Punkt 1)");
  assert.equal(p.el("cloud-agent").textContent, "SMarTrCEO", "und sie nennt den Agenten");
  assert.equal(p.zustand.cloudAgent, "SMarTrCEO");

  /* Und dieselbe Auskunft auf der Startseite, wo sie „Am Werk:" heisst. */
  const agentZeile = p.el("startseite").querySelector(".sa-start-agent");
  assert.ok(agentZeile, "Vorbedingung: die echte Startseite ist gebaut");
  assert.equal(agentZeile.hidden, false, "die Zeile Am Werk bleibt nicht leer");
  assert.match(agentZeile.textContent, /SMarTrCEO/);

  /* Gegenprobe: Meldet der Dienst keinen Agenten, wird auch keiner behauptet.
     Eine Dauerzeile ohne Namen behauptete eine Fernsitzung, von der niemand
     weiss, wem sie gehoert. */
  const q = await panelStarten({
    startseiteModul: echt,
    workerAntworten: {
      "link:zustand?": {
        verbunden: true,
        tabId: 7,
        ursprungMuster: "https://geizhals.de/*",
        stufe: "read",
        code: "CD34EF",
        endetUm: Date.now() + 600000,
        modus: "tab",
        bereich: ["geizhals.de"],
        schrittmodus: "confirm_each",
      },
    },
  });
  t.after(q.aufraeumen);
  await new Promise((f) => setTimeout(f, 0));
  assert.ok(q.zustand.sitzung, "Vorbedingung: auch hier laeuft eine Sitzung");
  assert.equal(q.el("cloud-zeile").hidden, true, "ohne Agentennamen keine Dauerzeile");
  assert.equal(q.zustand.cloudAgent, null);
});

/* ------------------------------------------------------------------ *
 * WB — Regeln, Ablaeufe und Protokollbuch (Vertrag §4 und §8.3)
 * ------------------------------------------------------------------ */

test("WB1 — Beide Ansichten sind erreichbar und holen ihre Daten beim Dienst", async (t) => {
  const p = await panelStarten({
    workerAntworten: {
      "werkbank:liste": { workflows: [{ id: "wf_ebay_relist", name: "eBay: Artikel neu einstellen" }] },
      "buch:lesen": { eintraege: [{ zeit: Date.now(), agent: "SMarTrCEO", cmd: "click", url: "https://ebay.de/x" }] },
    },
  });
  t.after(p.aufraeumen);

  await p.klick("menue-knopf");
  await p.klick("menue-werkbank");
  assert.equal(p.el("app").dataset.state, "werkbank");
  assert.equal(p.el("werkbank").hidden, false);
  assert.ok(p.anWorker().includes("werkbank:liste"), "die Liste kommt vom Dienst, nicht aus der Leiste");
  assert.match(p.el("werkbank-inhalt").textContent, /eBay/, "und steht wirklich in der Ansicht");

  await p.klick("werkbank-zurueck");
  assert.equal(p.el("app").dataset.state, "bereit");

  p.spurLeeren();
  await p.klick("menue-knopf");
  await p.klick("menue-buch");
  assert.equal(p.el("app").dataset.state, "buch");
  const gelesen = p.anWorkerVoll().find((n) => n.typ === "buch:lesen");
  assert.ok(gelesen, "das Protokollbuch wird gelesen");
  assert.equal(gelesen.von, 0);
  assert.ok(Number.isFinite(gelesen.bis), "und der Zeitraum ist eine Zahl, keine Unendlichkeit auf der Leitung");
  assert.match(p.el("buch-inhalt").textContent, /SMarTrCEO/);
});

test("WB2 — werkbank.js wird im Produktivweg gerufen; fehlt sie, zeichnet die Leiste selbst", async (t) => {
  /* Wie T3: gemessen wird gegen das ECHTE Modul und seine echte Schnittstelle,
     nicht gegen eine ausgedachte. */
  const echt = await import("../panel/werkbank.js");
  const gerufen = [];
  const p = await panelStarten({
    werkbankModul: {
      ...echt,
      aufbauen(wurzel, dienste) {
        gerufen.push({ was: "werkbank", wurzel, dienste });
        return echt.aufbauen(wurzel, dienste);
      },
      matrixAufbauen(wurzel) {
        gerufen.push({ was: "matrix", wurzel, dienste: {} });
        return echt.matrixAufbauen(wurzel);
      },
      buchAufbauen(wurzel, dienste) {
        gerufen.push({ was: "buch", wurzel, dienste });
        return echt.buchAufbauen(wurzel, dienste);
      },
    },
  });
  t.after(p.aufraeumen);

  await p.klick("menue-knopf");
  await p.klick("menue-werkbank");

  const werkbankRuf = gerufen.find((g) => g.was === "werkbank");
  const matrixRuf = gerufen.find((g) => g.was === "matrix");
  assert.ok(werkbankRuf, "die Ablaufverwaltung wird gebaut (Vertrag §7.3)");
  assert.ok(matrixRuf, "und die Regeln je Domain daneben (Vertrag §4)");
  assert.equal(werkbankRuf.wurzel, p.el("werkbank-inhalt"));
  assert.equal(matrixRuf.wurzel, p.el("matrix-inhalt"));
  assert.notEqual(
    werkbankRuf.wurzel,
    matrixRuf.wurzel,
    "zwei Ansichten, zwei Anker — eine gemeinsame Wurzel raeumte die andere weg"
  );
  assert.equal(typeof werkbankRuf.dienste.spielen, "function", "ohne `spielen` liefe kein Ablauf");
  assert.equal(typeof werkbankRuf.dienste.ausgeben, "function", "und ohne `ausgeben` gaebe es keinen Weg heraus");

  /* Der Ablauf laeuft ueber den Dienst, nicht an ihm vorbei (Vertrag §6). */
  p.spurLeeren();
  await werkbankRuf.dienste.spielen("wf_ebay_relist", { artikelnummer: "1" });
  const gespielt = p.anWorkerVoll().find((n) => n.typ === "werkbank:spielen");
  assert.ok(gespielt, "werkbank:spielen geht wirklich an den Dienst");
  assert.equal(gespielt.id, "wf_ebay_relist");

  await p.klick("menue-knopf");
  await p.klick("menue-buch");
  const buchRuf = gerufen.find((g) => g.was === "buch");
  assert.ok(buchRuf, "das Protokollbuch wird gebaut (Vertrag §8.3)");
  assert.equal(buchRuf.wurzel, p.el("buch-inhalt"));
  assert.equal(typeof buchRuf.dienste.ausgeben, "function");

  /* Und ohne Modul steht trotzdem etwas da. Ein leerer Anker waere ein Weg
     ohne Antwort. */
  const q = await panelStarten({ workerAntworten: { "buch:lesen": { eintraege: [] } } });
  t.after(q.aufraeumen);
  await q.f.buchOeffnen();
  assert.ok(q.el("buch-inhalt").textContent.length > 0, "auch die leere Lage bekommt einen Satz");
  assert.match(q.el("buch-inhalt").textContent, /Protokollbuch/);
});

test("WB3 — Der Ausgabe-Knopf macht aus dem Buch eine Datei, ohne neue Berechtigung", async (t) => {
  const inhalt = JSON.stringify([{ zeit: 1, agent: "SMarTrCEO", cmd: "click" }]);
  const p = await panelStarten({ workerAntworten: { "buch:ausgeben": { json: inhalt } } });
  t.after(p.aufraeumen);
  await p.klick("menue-knopf");
  await p.klick("menue-buch");
  assert.equal(p.el("buch-datei").hidden, true, "Vorbedingung: noch keine Datei");

  await p.klick("buch-ausgeben");

  const verweis = p.el("buch-datei");
  assert.equal(verweis.hidden, false, "der Verweis bleibt sichtbar stehen");
  const adresse = verweis.getAttribute("href");
  assert.ok(adresse.startsWith("data:application/json;charset=utf-8,"), `unerwartete Adresse: ${adresse}`);
  assert.equal(
    decodeURIComponent(adresse.slice("data:application/json;charset=utf-8,".length)),
    inhalt,
    "und traegt genau das, was der Dienst ausgegeben hat"
  );
  assert.match(verweis.getAttribute("download"), /^smartrchrome-protokollbuch-.*\.json$/);
  assert.equal(verweis.klicks, 1, "der Knopf loest den Verweis auch wirklich aus");

  /* Der Weg braucht keine neue Pflichtberechtigung: eine data-Adresse, kein
     chrome.downloads. Eine Berechtigung fuer einen Knopf, der einmal im Monat
     gedrueckt wird, waere zu teuer. */
  assert.ok(!/chrome\s*\.\s*downloads\s*\./.test(quelle), "kein Aufruf der Download-Schnittstelle");
  const manifest = JSON.parse(await readFile(new URL("../../manifest.json", import.meta.url), "utf8"));
  assert.ok(
    !manifest.permissions.includes("downloads"),
    "und keine neue Pflichtberechtigung im Manifest — sie stuende im Installationsdialog"
  );
});

test("WB4 — Kommt kein Buch zurueck, gibt es eine Absage statt eines toten Knopfes", async (t) => {
  for (const antwort of [{ json: "" }, {}, null]) {
    const p = await panelStarten({ workerAntworten: { "buch:ausgeben": antwort } });
    t.after(p.aufraeumen);
    await p.f.buchOeffnen();
    p.el("stoerung").textContent = "";

    const gelungen = await p.f.buchAusgeben();

    assert.equal(gelungen, false, `bei ${JSON.stringify(antwort)} wird nichts behauptet`);
    assert.equal(p.el("buch-datei").hidden, true, "und kein Verweis auf eine Datei, die es nicht gibt");
    assert.ok(
      !String(p.el("buch-datei").getAttribute("href") || "").startsWith("data:"),
      "und keine Adresse, hinter der eine Datei stehen soll, die es nicht gibt"
    );
    assert.match(p.el("stoerung").textContent, /Protokollbuch/, "der Mensch erfaehrt, dass es nicht ging");
    assert.equal(p.el("stoerung").hidden, false);
  }
});

/* ------------------------------------------------------------------ *
 * BB — Beibringen: Knopf unten an der Eingabekarte, Inhalt im Popup-Dialog
 * (15.08.2026 abends als Knopf in der Modus-Zeile gebaut; seit 0.6.3 sitzt
 * der Knopf unten neben der Modus-Pille, denn die obere Sektion ist weg —
 * Befund des Inhabers vom 15.08.2026 mit Bildschirmfoto: der Dauerblock
 * drueckte das Chatfeld unter den Bildschirmrand, und der Knopf ragte
 * abgeschnitten aus der Zeile)
 *
 * Die Zusagen, die hier gemessen werden:
 *
 *  1. Der Einstieg ist ein Knopf neben der Modus-Pille in der
 *     Werkzeugzeile — KEIN role="radio", denn er ist kein Modus — und
 *     WIRKLICH verdrahtet (die Lehre der 0.5.3: gebaut und nirgends
 *     eingebaut ist ein Blocker).
 *  2. Der Dialog traegt exakt den Inhalt der bisherigen Karte, mit den
 *     Woertern und Schluesseln der Werkbank; staendig sichtbar ist er nicht.
 *  3. Keine zweite Logikfassung (Festlegung F4): Start und Ende laufen durch
 *     die Funktionen der Werkbank, und `rekorder:start`/`rekorder:stop`
 *     stehen im ganzen panel.js an genau EINER Stelle.
 *  4. Alle Ansichten zeigen denselben Zustand aus derselben Quelle — auch
 *     der Knopf selbst, wenn der Dialog zu ist (Punkt UND Wortlaut,
 *     WCAG 1.4.1).
 *  5. Fokusfuehrung wie am Menue; ein einzelnes Escape schliesst den Dialog,
 *     ohne der Notbremse (Esc Esc) einen Schlag zu stehlen oder zu schenken.
 *  6. Waehrend einer laufenden Cloud-Sitzung gilt die Regel der Werkbank —
 *     und die ist gemessen KEINE: werkbank.js, worker.js und rekorder.js
 *     halten den Rekorder nirgends an der Sitzung an, also tut es dieser
 *     Einstieg auch nicht.
 * ------------------------------------------------------------------ */

test("BB1 — Der Einstieg ist ein Knopf neben der Modus-Pille, der Inhalt wohnt im Dialog und nicht mehr im Dauerlayout", () => {
  /* Der Knopf steht UNTEN an der Eingabekarte, in der Werkzeugzeile neben
     der Modus-Pille — dort, wo der Mensch ohnehin arbeitet (Befund Inhaber
     15.08.2026: oben ein Knopf und unten eine Anzeige waren zwei Orte fuer
     eine Sache). Er steht VOR dem Antwortmodus-Umschalter und nicht darin:
     Beibringen ist keine Modellwahl. */
  const formAb = html.indexOf('<form id="chatform"');
  const formBis = html.indexOf("</form>", formAb);
  const pilleAb = html.indexOf('id="modus-chip"', formAb);
  const knopfAb = html.indexOf('id="beibringen-knopf"', formAb);
  const gruppeAb = html.indexOf('id="chat-modus"', formAb);
  assert.ok(formAb >= 0 && knopfAb > formAb && knopfAb < formBis,
    "der Knopf steht in der Eingabekarte, nicht mehr oben im Dauerlayout");
  assert.ok(pilleAb > formAb && pilleAb < knopfAb, "und zwar neben der Modus-Pille, nach ihr");
  assert.ok(gruppeAb > knopfAb, "und VOR dem Antwortmodus-Umschalter, nicht darin");
  assert.equal(html.indexOf('id="beibringen-knopf"'), knopfAb, "den Knopf gibt es nur einmal");

  const knopfTag = /<button id="beibringen-knopf"[^>]*>/.exec(html);
  assert.ok(knopfTag, "der Einstieg ist ein echter <button>, keine Klickspanne");
  assert.equal(TAG_IM_HTML.get("beibringen-knopf"), "button");
  assert.ok(!/role=/.test(knopfTag[0]), "role=button bringt das Element selbst mit — und radio traegt er nie");
  assert.match(knopfTag[0], /aria-haspopup="dialog"/, "der Knopf kuendigt den Dialog an");
  assert.match(knopfTag[0], /aria-controls="beibringen-dialog"/, "und sagt, welchen");
  assert.match(knopfTag[0], /aria-expanded="false"/, "und beginnt zu");
  assert.match(knopfTag[0], /class="modus-chip beibringen-knopf"/,
    "dieselbe Pillen-Optik und dasselbe 44-Pixel-Bedienziel wie die Modus-Pille (.modus-chip)");

  /* Der Knopf traegt seinen eigenen Zustand: Punkt (reine Zier) und ein Feld
     fuer den Wortlaut — die Anzeige bei GESCHLOSSENEM Dialog (WCAG 1.4.1). */
  const knopfBis = html.indexOf("</button>", knopfAb);
  const knopfInnen = html.slice(knopfAb, knopfBis);
  assert.match(knopfInnen, /class="beibringen-punkt" aria-hidden="true"/, "der Punkt am Knopf ist reine Zier");
  assert.match(knopfInnen, /id="beibringen-knopf-stand"/, "und das Wortfeld ist da");
  assert.ok(VERSTECKT_IM_HTML.has("beibringen-knopf-stand"), "es beginnt leer und verborgen");
  /* Sein Wort kommt aus DEMSELBEN Schluessel wie der Dialogtitel, nur ueber
     zusatztexteUebersetzen — ein data-i18n hier waere derselbe Schluessel
     zweimal im HTML (Pruefsatz I1). */
  assert.ok(!/id="beibringen-knopf-wort"[^>]*data-i18n/.test(html), "kein doppelter Schluessel im HTML");
  const zusatz = abschnitt("function zusatztexteUebersetzen", "spracheAnwenden(document);");
  assert.ok(zusatz.includes('t("werkbank_beibringen_titel", "Beibringen")'),
    "der Knopf holt sein Wort aus dem Schluessel des Dialogtitels");

  /* Die Karte der 0.6.1 steht nicht mehr staendig im Layout: Es gibt sie
     nicht mehr, ihr Inhalt wohnt im Dialog — und der beginnt verborgen. */
  assert.ok(!html.includes('id="beibringen-bereich"'), "die staendig sichtbare Karte ist weg");
  assert.ok(VERSTECKT_IM_HTML.has("beibringen-dialog"), "der Dialog beginnt verborgen");
  const dialogTag = /<section id="beibringen-dialog"[^>]*>/.exec(html);
  assert.ok(dialogTag, "der Dialog fehlt");
  assert.match(dialogTag[0], /role="dialog"/, "er sagt, was er ist");
  assert.match(dialogTag[0], /aria-labelledby="beibringen-titel"/, "und traegt seinen Namen");

  /* Der Dialog traegt EXAKT den Inhalt der bisherigen Karte: Titel,
     Erklaersatz, Zustandszeile, beide Aufnahme-Knoepfe, Ergebniszeile, Weg
     zur Werkbank — mit den Katalogschluesseln der Werkbank. */
  const dialogAb = html.indexOf('<section id="beibringen-dialog"');
  const dialogBis = html.indexOf("</section>", dialogAb);
  const dialog = html.slice(dialogAb, dialogBis);
  assert.match(dialog, /id="beibringen-titel"[^>]*data-i18n="werkbank_beibringen_titel"/, "der Titel");
  assert.match(dialog, /data-i18n="werkbank_beibringen_hinweis"/, "der Erklaersatz");

  /* Der Aufnahmezustand ist Punkt UND Wortlaut (WCAG 1.4.1): Der Punkt ist
     fuer den Bildschirmleser unsichtbar, das Wort traegt die Aussage. */
  const stand = /<p id="beibringen-stand"[^>]*>([\s\S]*?)<\/p>/.exec(dialog);
  assert.ok(stand, "die Zustandszeile fehlt");
  assert.match(stand[1], /aria-hidden="true"/, "der Punkt ist reine Zier und als solche markiert");
  assert.match(stand[1], /id="beibringen-wort"[^>]*data-i18n="werkbank_aufnahme_aus"/,
    "das Wort daneben traegt denselben Schluessel wie der Zaehler der Werkbank");

  /* Dieselben Katalogschluessel wie die Knoepfe der Werkbank: zwei Ansichten,
     ein Wortlaut. Und beide sind echte Knoepfe, keine Klickspannen. */
  assert.equal(TAG_IM_HTML.get("beibringen-start"), "button");
  assert.equal(TAG_IM_HTML.get("beibringen-stop"), "button");
  assert.match(dialog, /id="beibringen-start"[^>]*data-i18n="werkbank_aufnahme_start"/);
  assert.match(dialog, /id="beibringen-stop"[^>]*data-i18n="werkbank_aufnahme_stop"/);

  /* Die Ergebniszeile ist KEINE zweite Vorlesezone (F7): gesprochen wird ueber
     die Ansage. Und der Weg zur Werkbank erscheint erst, wenn dort wirklich
     ein Ablauf liegt — weggelassen, nicht ausgegraut. */
  const ergebnis = /<p id="beibringen-ergebnis"[^>]*>/.exec(dialog);
  assert.ok(ergebnis, "die Ergebniszeile fehlt");
  assert.ok(!/aria-live|role=/.test(ergebnis[0]), "keine zweite Vorlesezone neben der Ansage");
  assert.ok(VERSTECKT_IM_HTML.has("beibringen-ergebnis"), "die Ergebniszeile beginnt leer");
  assert.ok(VERSTECKT_IM_HTML.has("beibringen-werkbank"), "der Weg zur Werkbank beginnt verborgen");
});

test("BB2 — Aufnahme starten laeuft durch die Werkbank, und beide Ansichten zeigen denselben Stand", async (t) => {
  /* Frische globale Ablage: Die ECHTE Werkbank liest und schreibt ueber die
     globale Attrappe, nicht ueber die Sandbox der Seitenleiste. */
  attrappeSetzen({ panelAntwortet: null });
  const echt = await import("../panel/werkbank.js");
  const p = await panelStarten({
    werkbankModul: echt,
    workerAntworten: { "rekorder:start": { ok: true, anzahl: 0 } },
  });
  t.after(p.aufraeumen);

  /* Der Weg des Menschen: erst den Dialog oeffnen, dann starten. */
  await p.klick("beibringen-knopf");
  assert.equal(p.el("beibringen-dialog").hidden, false, "der Knopf oeffnet den Dialog");
  await p.klick("beibringen-start");

  /* Der Weg zum Dienst ist derselbe wie aus der Werkbank: dieselbe Nachricht,
     derselbe Tab (Rueckfallwert; das wahre Ziel kennt der Dienstarbeiter aus
     seiner Tabnotiz `sa_rekorder_tab`). */
  const start = p.anWorkerVoll().find((n) => n.typ === "rekorder:start");
  assert.ok(start, "rekorder:start erreicht den Dienst");
  assert.equal(start.tabId, 7, "und nennt den Tab, den der Mensch vor sich hat");

  /* Der Zustand steht als Wortlaut da, nicht nur als Farbe (WCAG 1.4.1). */
  assert.equal(p.el("beibringen-stand").dataset.laeuft, "ja");
  assert.equal(p.el("beibringen-wort").textContent, "Aufnahme läuft, 0 Schritte.");
  assert.equal(
    p.el("ansage").textContent,
    "Die Aufnahme läuft. Mach jetzt im Tab, was der Ablauf können soll.",
    "und die Ansage sagt, was jetzt zu tun ist"
  );

  /* `rekorder:stand` aus dem Tab zieht BEIDE Ansichten nach — eine Quelle.
     Der Zaehler der Werkbank ist der eine Knoten, der die geteilten
     Katalogschluessel traegt; gesucht wird ueber den ganzen Anker, damit der
     Pruefsatz nicht an der Baureihenfolge der Abschnitte haengt. */
  p.melden({ typ: "rekorder:stand", anzahl: 3, laeuft: true });
  assert.equal(p.el("beibringen-wort").textContent, "Aufnahme läuft, 3 Schritte.");
  const alleKnoten = (el, raus = []) => {
    for (const k of el.kinder || []) {
      if (typeof k === "string") continue;
      raus.push(k);
      alleKnoten(k, raus);
    }
    return raus;
  };
  const zaehlerSchluessel = ["werkbank_aufnahme_aus", "aufnahme_laeuft_einer", "aufnahme_laeuft_viele"];
  const werkbankZaehler = alleKnoten(p.el("werkbank-inhalt")).find(
    (k) => typeof k.getAttribute === "function" && zaehlerSchluessel.includes(k.getAttribute("data-i18n"))
  );
  assert.ok(werkbankZaehler, "die Werkbank hat ihren Zaehler");
  assert.equal(werkbankZaehler.textContent, "Aufnahme läuft, 3 Schritte.",
    "beide Ansichten sagen woertlich dasselbe");

  /* Ein Schrittzaehler von genau 1 spricht in der Einzahl — in beiden. */
  p.melden({ typ: "rekorder:stand", anzahl: 1, laeuft: true });
  assert.equal(p.el("beibringen-wort").textContent, "Aufnahme läuft, 1 Schritt.");
  assert.equal(werkbankZaehler.textContent, "Aufnahme läuft, 1 Schritt.");

  /* Und das Ende der Aufnahme kommt genauso in beiden an. */
  p.melden({ typ: "rekorder:stand", anzahl: 0, laeuft: false });
  assert.equal(p.el("beibringen-stand").dataset.laeuft, "nein");
  assert.equal(p.el("beibringen-wort").textContent, "Es läuft keine Aufnahme.");
  assert.equal(werkbankZaehler.textContent, "Es läuft keine Aufnahme.");
});

test("BB3 — Aufnahme beenden speichert ueber die Werkbank, sagt wo der Ablauf liegt, und der Knopf fuehrt hin", async (t) => {
  /* Frische globale Ablage — hier wird wirklich gespeichert. */
  attrappeSetzen({ panelAntwortet: null });
  const echt = await import("../panel/werkbank.js");
  const schritte = [{ type: "navigate", url: "https://geizhals.de/warenkorb" }];
  const p = await panelStarten({
    werkbankModul: echt,
    workerAntworten: {
      "rekorder:start": { ok: true, anzahl: 0 },
      "rekorder:stop": { ok: true, anzahl: 1, schritte },
    },
  });
  t.after(p.aufraeumen);

  await p.klick("beibringen-knopf");
  await p.klick("beibringen-start");
  await p.klick("beibringen-stop");

  const stop = p.anWorkerVoll().find((n) => n.typ === "rekorder:stop");
  assert.ok(stop, "rekorder:stop erreicht den Dienst");

  /* Gespeichert hat die WERKBANK (Festlegung F4): Der Ablauf liegt in der
     Ablage, gegangen durch workflowPruefen und adressenPruefen — nicht durch
     eine zweite Fassung in panel.js. */
  const daten = await globalThis.chrome.storage.local.get("sa_workflows");
  const ablaeufe = daten.sa_workflows || [];
  assert.equal(ablaeufe.length, 1, "genau ein neuer Ablauf liegt in der Ablage");
  assert.match(ablaeufe[0].id, /^wf_a/, "mit der Kennung, die die Werkbank vergibt");
  assert.match(ablaeufe[0].name, /^Aufnahme vom /, "und dem Namen, den die Werkbank baut");
  assert.equal(ablaeufe[0].steps.length, 1);
  assert.equal(ablaeufe[0].steps[0].url, "https://geizhals.de/warenkorb");

  /* Der Satz danach sagt, WO der Ablauf liegt — und der Knopf fuehrt hin. */
  assert.equal(p.el("beibringen-ergebnis").hidden, false);
  assert.equal(
    p.el("beibringen-ergebnis").textContent,
    "Aufgezeichnet. Der neue Ablauf liegt in der Werkbank, dort kannst du ihn ansehen, umbenennen und abspielen."
  );
  assert.equal(p.el("beibringen-werkbank").hidden, false, "der Weg zur Werkbank steht offen");
  assert.equal(p.el("beibringen-stand").dataset.laeuft, "nein", "und die Aufnahme ist sichtbar beendet");

  await p.klick("beibringen-werkbank");
  assert.equal(p.el("app").dataset.state, "werkbank", "der Knopf oeffnet wirklich die Werkbank");
  assert.equal(p.el("werkbank").hidden, false);
  /* Beim Wechsel in die Werkbank geht der Dialog zu: Dort stehen dieselben
     Knoepfe mit demselben Zaehler, und zwei sichtbare aria-live-Zonen mit
     demselben Satz waeren der Sprechblasen-Fund (F7) in neuer Gestalt. */
  assert.equal(p.el("beibringen-dialog").hidden, true, "der Dialog weicht der Werkbank");

  await p.klick("werkbank-zurueck");
  assert.equal(p.el("beibringen-knopf").hidden, false, "der Einstieg an der Eingabekarte steht immer da");
});

test("BB4 — Absagen kommen woertlich aus dem Bestand, eine leere Aufnahme behauptet keinen Ablauf", async (t) => {
  attrappeSetzen({ panelAntwortet: null });
  const echt = await import("../panel/werkbank.js");

  /* Die leere Aufnahme: beendet ist beendet, aber es liegt nichts vor — also
     kein Satz ueber einen Ablauf und KEIN Knopf zu einem, den es nicht gibt. */
  const leer = await panelStarten({
    werkbankModul: echt,
    workerAntworten: { "rekorder:stop": { ok: true, anzahl: 0, schritte: [] } },
  });
  t.after(leer.aufraeumen);
  await leer.klick("beibringen-knopf");
  await leer.klick("beibringen-stop");
  assert.equal(leer.el("beibringen-ergebnis").textContent, "Die Aufnahme ist beendet, aufgezeichnet wurde nichts.");
  assert.equal(leer.el("beibringen-werkbank").hidden, true, "kein Weg zu einem Ablauf, den es nicht gibt");

  /* Die Absage des Dienstes steht woertlich da — derselbe Klartext, den auch
     die Werkbank zeigt, keine zweite Formulierung. */
  const satz = "Auf dieser Seite kann ich nicht aufzeichnen. Öffne bitte eine gewöhnliche Webseite und versuche es dort.";
  const absage = await panelStarten({
    werkbankModul: echt,
    workerAntworten: { "rekorder:start": { ok: false, kennung: "kein_empfaenger", klartext: satz } },
  });
  t.after(absage.aufraeumen);
  await absage.klick("beibringen-knopf");
  await absage.klick("beibringen-start");
  assert.equal(absage.el("beibringen-ergebnis").textContent, satz);
  assert.match(absage.el("beibringen-ergebnis").className, /absage/, "als Absage abgesetzt, nicht als Erfolg");
  assert.notEqual(absage.el("beibringen-stand").dataset.laeuft, "ja", "und es wird keine Aufnahme behauptet");
  assert.equal(absage.el("ansage").textContent, satz, "die Absage wird auch angesagt");

  /* Fehlt die Werkbank ganz, faellt es sicher zu: derselbe Satz wie ihre
     eigene Absage `kein_dienst`, kein toter Knopf, keine Ausnahme. */
  const ohne = await panelStarten({});
  t.after(ohne.aufraeumen);
  await ohne.klick("beibringen-knopf");
  await ohne.klick("beibringen-start");
  assert.equal(ohne.el("beibringen-ergebnis").textContent, "Aufzeichnen kann diese Fassung hier nicht.");
});

test("BB5 — Waehrend einer laufenden Cloud-Sitzung gilt die Regel der Werkbank: keine Sperre", async (t) => {
  /* Gemessen am 15.08.2026: werkbank.js, worker.js und rekorder.js halten den
     Rekorder nirgends an einer laufenden Sitzung an — es gibt keine solche
     Regel und keinen Absagetext. Der neue Einstieg erfindet auch keine. Ein
     Riegel, den nur eine der beiden Ansichten haette, waere eine zweite
     Logikfassung (F4) — genau die verbotene Bauform. */
  attrappeSetzen({ panelAntwortet: null });
  const echt = await import("../panel/werkbank.js");
  const p = await panelStarten({
    werkbankModul: echt,
    workerAntworten: { "rekorder:start": { ok: true, anzahl: 0 } },
  });
  t.after(p.aufraeumen);

  await p.sitzungHerstellen();
  assert.ok(p.zustand.sitzung, "Vorbedingung: es laeuft eine Sitzung");
  assert.equal(p.el("beibringen-knopf").hidden, false, "der Einstieg bleibt auch jetzt stehen");

  await p.klick("beibringen-knopf");
  assert.equal(p.el("beibringen-dialog").hidden, false, "und der Dialog geht auch jetzt auf");
  await p.klick("beibringen-start");
  assert.ok(p.anWorker().includes("rekorder:start"), "der Start geht durch, wie in der Werkbank");
  assert.equal(p.el("beibringen-stand").dataset.laeuft, "ja");
});

test("BB6 — Keine zweite Logikfassung: rekorder:start und rekorder:stop stehen an genau EINER Stelle", () => {
  /* Festlegung F4 als Quelltextzusage: Beide Nachrichten entstehen einzig in
     den Diensten von werkbankGriffHolen — der Stelle, durch die Werkbank UND
     Beibringen-Einstieg gehen. Eine zweite Sendestelle waere der Anfang von
     zwei Fassungen, die auseinanderlaufen. */
  assert.equal(quelle.split('typ: "rekorder:start"').length - 1, 1);
  assert.equal(quelle.split('typ: "rekorder:stop"').length - 1, 1);
  const griffQuelle = abschnitt("function werkbankGriffHolen", "async function werkbankOeffnen");
  assert.ok(griffQuelle.includes('typ: "rekorder:start"'), "der Start wohnt in werkbankGriffHolen");
  assert.ok(griffQuelle.includes('typ: "rekorder:stop"'), "das Ende auch");

  /* Und die Knoepfe des Einstiegs rufen die Funktionen der WERKBANK, keine
     eigenen: aufnahmeStarten und aufnahmeBeenden am Griff. */
  const starten = abschnitt("async function beibringenStarten", "async function beibringenBeenden");
  assert.ok(starten.includes("griff.aufnahmeStarten()"), "Start laeuft ueber die Werkbank");
  const beenden = abschnitt("async function beibringenBeenden", "/* ---");
  assert.ok(beenden.includes("griff.aufnahmeBeenden()"), "Beenden laeuft ueber die Werkbank");
});

test("BB7 — Der Knopf oeffnet den Dialog, der Fokus wandert hinein und beim Schliessen auf den Knopf zurueck", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  /* Den Anfangswert von aria-expanded misst BB1 im HTML — die Nachbildung
     hier kennt nur die Merkmale, die panel.js selbst setzt. */
  assert.equal(p.el("beibringen-dialog").hidden, true, "Vorbedingung: der Dialog beginnt zu");

  await p.klick("beibringen-knopf");
  assert.equal(p.el("beibringen-dialog").hidden, false, "der Knopf oeffnet den Dialog");
  assert.equal(p.el("beibringen-knopf").getAttribute("aria-expanded"), "true", "und sagt das auch");
  /* Der Fokus steht auf der Ueberschrift — der Vorleser sagt damit zuerst,
     WO man gelandet ist (dieselbe Regel wie bei den Karten, ueberschriftVon). */
  assert.equal(p.fokus(), p.el("beibringen-titel"), "der Fokus wandert in den Dialog, auf die Ueberschrift");

  /* Ein einzelnes Escape schliesst — und der Fokus kehrt auf den Knopf
     zurueck, nicht auf body: Auf body bleibt der Vorleser stumm, und der
     Mensch muesste sich neu durch die ganze Leiste tabben (Befund
     10.08.2026, dieselbe Fuehrung wie am Menue). */
  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.equal(p.el("beibringen-dialog").hidden, true, "ein einzelnes Escape schliesst den Dialog");
  assert.equal(p.el("beibringen-knopf").getAttribute("aria-expanded"), "false");
  assert.equal(p.fokus(), p.el("beibringen-knopf"), "der Fokus steht wieder auf dem Beibringen-Knopf");
  assert.notEqual(p.fokus(), p.koerper, "und faellt nie auf body");

  /* Der Knopf ist auch der Weg zu: Ein zweiter Druck schliesst, wie am
     Menue-Knopf — samt Fokusrueckgabe. */
  await p.klick("beibringen-knopf");
  assert.equal(p.el("beibringen-dialog").hidden, false);
  await p.klick("beibringen-knopf");
  assert.equal(p.el("beibringen-dialog").hidden, true, "derselbe Knopf schliesst wieder");
  assert.equal(p.fokus(), p.el("beibringen-knopf"));
});

test("BB8 — Das Dialog-Escape laesst die Notbremse ganz: es stiehlt ihr keinen Schlag und schenkt ihr keinen", async (t) => {
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  assert.ok(p.zustand.sitzung, "Vorbedingung: es laeuft eine Sitzung");
  await p.klick("beibringen-knopf");
  assert.equal(p.el("beibringen-dialog").hidden, false, "Vorbedingung: der Dialog ist offen");
  p.alleSpurenLeeren();

  /* Schlag 1 schliesst NUR den Dialog. Die Sitzung lebt weiter. */
  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.equal(p.el("beibringen-dialog").hidden, true, "das erste Escape schliesst den Dialog");
  assert.ok(p.zustand.sitzung, "und beendet keine Sitzung");
  assert.ok(!p.anWorker().includes("link:notaus"), "kein Not-Aus beim blossen Schliessen");

  /* Schlag 2, unmittelbar danach: Wuerde das Dialog-Escape als erster Schlag
     der Notbremse mitgezaehlt, feuerte JETZT der Not-Aus — ein Stopp, um den
     niemand gebeten hat. */
  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.ok(p.zustand.sitzung, "das Schliessen des Dialogs zaehlt nicht als erster Schlag der Notbremse");
  assert.ok(!p.anWorker().includes("link:notaus"));

  /* Schlag 3: Jetzt sind es zwei ECHTE Schlaege kurz hintereinander — die
     Notbremse funktioniert nach dem Dialog genau wie vorher (N3). Ein
     Dialog-Escape, das sie verschluckte, liesse diesen Schlag verpuffen. */
  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.equal(p.zustand.sitzung, null, "Esc Esc bleibt die Notbremse");
  const reihe = p.anWorker();
  assert.ok(reihe.indexOf("link:notaus") < reihe.indexOf("link:trennen"), "auf demselben Weg wie der Knopf");
  assert.equal(p.anWorkerVoll().find((n) => n.typ === "link:notaus").grund, "esc");
});

test("BB9 — Laeuft eine Aufnahme, zeigt der Knopf sie auch bei geschlossenem Dialog: Punkt UND Wortlaut", async (t) => {
  attrappeSetzen({ panelAntwortet: null });
  const echt = await import("../panel/werkbank.js");
  const p = await panelStarten({
    werkbankModul: echt,
    workerAntworten: { "rekorder:start": { ok: true, anzahl: 0 } },
  });
  t.after(p.aufraeumen);

  /* Vor der Aufnahme behauptet der Knopf keine: weggelassen, nicht
     ausgegraut. */
  assert.notEqual(p.el("beibringen-knopf").dataset.laeuft, "ja");
  assert.equal(p.el("beibringen-knopf-stand").hidden, true, "kein Wortfeld ohne Aufnahme");

  await p.klick("beibringen-knopf");
  await p.klick("beibringen-start");
  /* Dialog zu — die Aufnahme laeuft weiter, und der Knopf ist jetzt die
     einzige sichtbare Stelle dafuer (WCAG 1.4.1: Punkt als Zweitsignal, das
     Wort traegt die Aussage). */
  await p.fensterEreignis("keydown", { key: "Escape" });
  assert.equal(p.el("beibringen-dialog").hidden, true, "Vorbedingung: der Dialog ist zu");
  assert.equal(p.el("beibringen-knopf").dataset.laeuft, "ja", "der Punkt am Knopf sagt: es laeuft");
  assert.equal(p.el("beibringen-knopf-stand").hidden, false);
  assert.equal(p.el("beibringen-knopf-stand").textContent, "Aufnahme läuft, 0 Schritte.",
    "und der Wortlaut steht daneben, nicht nur Farbe");

  /* `rekorder:stand` aus dem Tab zieht den Knopf mit nach — derselbe
     Empfaenger, EINE Quelle fuer alle Ansichten (F4). */
  p.melden({ typ: "rekorder:stand", anzahl: 4, laeuft: true });
  assert.equal(p.el("beibringen-knopf-stand").textContent, "Aufnahme läuft, 4 Schritte.");
  assert.equal(p.el("beibringen-wort").textContent, "Aufnahme läuft, 4 Schritte.",
    "der Dialog traegt denselben Stand fuer das naechste Oeffnen");

  /* Endet die Aufnahme, verschwindet die Anzeige am Knopf restlos: „Aufnahme
     laeuft" neben einem stillen Punkt waere eine Falschaussage. */
  p.melden({ typ: "rekorder:stand", anzahl: 0, laeuft: false });
  assert.notEqual(p.el("beibringen-knopf").dataset.laeuft, "ja");
  assert.equal(p.el("beibringen-knopf-stand").hidden, true);
  assert.equal(p.el("beibringen-knopf-stand").textContent, "", "kein alter Wortlaut bleibt am Knopf stehen");
});

/* ------------------------------------------------------------------ *
 * I — Sprache (Vertrag §12)
 * ------------------------------------------------------------------ */

test("I1 — Jeder neue sichtbare Text ist katalogfaehig ausgezeichnet", () => {
  /* Den Katalog fuellt A-SPRACHE in Stufe 3. Was hier gemessen wird, ist die
     Vorarbeit: dass es zu jedem neuen Text einen Schluessel GIBT und dass die
     Schluessel der Form aus §12 folgen. Ohne diesen Satz faende A-SPRACHE eine
     Oberflaeche vor, in der ein Dutzend Saetze still auf Deutsch bleiben. */
  const schluessel = [...html.matchAll(/data-i18n(?:-attr)?="([^"]+)"/g)].map((tr) => tr[1]);
  assert.ok(schluessel.length >= 20, `erwartet mindestens 20 Auszeichnungen, gefunden: ${schluessel.length}`);

  const BEREICHE = ["kopf", "dialog", "freigabe", "modus", "werkbank", "buch", "fehler"];
  for (const s of schluessel) {
    assert.match(s, /^[a-z][a-z0-9_]*$/, `„${s}" folgt nicht der Form aus §12`);
    assert.ok(
      BEREICHE.some((b) => s.startsWith(`${b}_`)),
      `„${s}" traegt kein Bereichspraefix aus §12 (${BEREICHE.join(", ")})`
    );
  }
  assert.equal(new Set(schluessel).size, schluessel.length, "kein Schluessel steht zweimal an zwei Texten");

  /* Und die Stellen, die v3.5 neu bringt, sind wirklich dabei. Eine Liste ohne
     Gegenprobe waere nur die Aussage „irgendwas ist ausgezeichnet". */
  const mitSchluessel = new Set(
    [...html.matchAll(/<[a-zA-Z][^>]*\sid="([^"]+)"[^>]*data-i18n="/g)].map((tr) => tr[1])
  );
  for (const id of [
    "verbinden-tab",
    "verbinden-hinweis",
    "verbinden-start",
    "trennen",
    "stopp",
    "menue-werkbank",
    "menue-buch",
    "modus-titel",
    "modus-manual",
    "modus-assist",
    "modus-auto",
    "modus-auskunft",
    "modus-riegel",
    "startseite-titel",
    "werkbank-titel",
    "buch-titel",
    "buch-ausgeben",
  ]) {
    assert.ok(mitSchluessel.has(id), `#${id} traegt keinen Katalogschluessel`);
  }
});

test("T6 — Ein Ereignis waehrend eines laufenden Abgleichs wird nachgeholt, nicht verschluckt", async (t) => {
  /* Chrome feuert onUpdated je Tab mehrfach. Ein Ereignis, das waehrend eines
     laufenden Abgleichs eintrifft, darf nicht schlicht verfallen: Sonst bliebe
     der aktuelle Tab veraltet, und der eine Klick verbaende danach mit dem Tab
     von vorhin, also mit dem, den der Mensch gerade NICHT ansieht.
     Gemessen wird die Zahl der Abgleiche, nicht das Ergebnis — das Ergebnis
     kaeme in dieser Nachbildung auch ohne das Nachholen zufaellig richtig
     heraus, und ein Pruefsatz, der zufaellig gruen ist, ist keiner. */
  const tabs = TABS_GEMISCHT();
  const p = await panelStarten({ alleTabs: tabs });
  t.after(p.aufraeumen);
  p.aufrufeLeeren();

  const erstes = p.f.tabsAuffrischen();
  tabs[0].active = false;
  tabs[1].active = true;
  const zweites = p.f.tabsAuffrischen();
  await erstes;
  await zweites;
  await new Promise((f) => setTimeout(f, 0));

  const runden = p.aufrufe().filter((a) => a === "tabs.query").length;
  assert.ok(
    runden >= 4,
    `zwei Ereignisse, aber nur ${runden / 2} Abgleich(e): das zweite ist verfallen`
  );
  assert.equal(p.zustand.aktuellerTab.id, 8, "und der Bestand steht danach auf dem neuen Tab");
  assert.match(p.el("verbinden-hinweis").textContent, /eBay/);
});

/* ================================================================== *
 * VB — die Anzeige liest aus der Quelle, der sie gehoert
 *
 * Die Fehlerart hinter den Funden VERBINDUNG-1 bis VERBINDUNG-7 der Abnahme
 * vom 14.08.2026 ist EINE, und sie hat zwei Haelften:
 *
 *   1. Ein Anzeigewert kam aus einer anderen Quelle als der Zustand, dem er
 *      gehoert — die Statuskarte nannte den AKTIVEN Tab statt des
 *      SITZUNGStabs, und sie tat es aus einem Wert, der schon vor dem Gelingen
 *      gesetzt und nach dem Scheitern nie weggeraeumt wurde.
 *   2. Ein Zustandswechsel zog nicht alle vier Anzeigeflaechen nach: Chip,
 *      Hinweiszeile, Tabkarte und Statuskarte der Startseite. Drei von vier war
 *      die Regel, und die vierte war jedes Mal die, um die es ging.
 *
 * Jeder Satz hier faehrt den Weg, den ein Mensch wirklich geht, jeder faehrt
 * durch das ECHTE Startseiten-Modul, und jeder ist gegengeprobt worden:
 * Reparatur zurueckgebaut, rot gemessen, wieder eingebaut, gruen gemessen. Was
 * die Gegenprobe rot gemacht hat, steht beim jeweiligen Satz.
 * ================================================================== */

/* Alle Knoten unter einem Element — die Nachbildung kann `querySelectorAll`
   nicht, und fuer „wie viele Knoepfe stehen da" braucht es mehr als den
   ersten Treffer. */
function alleKnotenUnter(el, raus = []) {
  raus.push(el);
  for (const k of el.kinder || []) if (typeof k !== "string") alleKnotenUnter(k, raus);
  return raus;
}

function mitKlasseUnter(el, klasse) {
  return alleKnotenUnter(el).filter((k) => String(k.className || "").split(/\s+/).includes(klasse));
}

/**
 * Die Statuskarte der ECHTEN Startseite, so wie ein Mensch sie liest.
 *
 * Gelesen wird aus dem Baum, den src/panel/startseite.js wirklich gebaut hat,
 * und nicht aus einer Rueckgabe: Was der Mensch sieht, steht im Baum.
 */
function startkarte(p) {
  const wurzel = p.el("startseite");
  const stand = wurzel.querySelector(".sa-start-stand");
  const liste = wurzel.querySelector("ul");
  return {
    stand,
    punkt: stand ? stand.querySelector(".sa-punkt").className : null,
    satz: stand ? stand.querySelector(".sa-start-satz").textContent : null,
    trennenVersteckt: stand ? stand.querySelector(".sa-trennen").hidden : null,
    listeVersteckt: liste ? liste.hidden : null,
    verbindenKnoepfe: mitKlasseUnter(wurzel, "sa-tab-verbinden").length,
  };
}

/* Eine Seitenleiste mit dem echten Startseiten-Modul. */
async function mitEchterStartseite(angaben = {}) {
  const echt = await import("../panel/startseite.js");
  const p = await panelStarten({ startseiteModul: echt, ...angaben });
  /* Zwei Takte: Der Aufbau der Startseite haengt an `tabsHolen`. */
  await new Promise((f) => setTimeout(f, 0));
  await new Promise((f) => setTimeout(f, 0));
  return p;
}

/* Eine laufende Sitzung, wie der Dienst sie beim Wiederoeffnen meldet. */
const laufendeSitzung = (anders = {}) => ({
  verbunden: true,
  tabId: 8,
  ursprungMuster: "https://www.ebay.de/*",
  stufe: "write",
  code: "AB12CD",
  endetUm: Date.now() + 600000,
  modus: "tab",
  bereich: ["www.ebay.de"],
  schrittmodus: "confirm_each",
  ...anders,
});

test("VB1 — Die Karten nennen den Tab der SITZUNG, nie den gerade aktiven", async (t) => {
  /*
   * BLOCKER VERBINDUNG-1, zweimal gemessen. Die Statuskarte las
   * `zustand.verbundenerTab || zustand.aktuellerTab`, und `verbundenerTab` wird
   * beim Wiederoeffnen nur gesetzt, wenn der laufende Tab zufaellig der aktive
   * ist. Sonst fiel die Anzeige auf den aktiven Tab zurueck.
   *
   * Der gemessene Fall: Dienst meldet eine laufende Sitzung auf Tab 8
   * (www.ebay.de), aktiv ist chrome://extensions. Ergebnis war
   * „Verbunden mit Erweiterungen", Tabkarte „Erweiterungen" / „extensions",
   * gruener Punkt. Die Leiste behauptete damit eine Steuerung auf einer Seite,
   * die rechte.sperrgrund() ausdruecklich verweigert, und geheilt haette das
   * erst das naechste Tabereignis.
   *
   * Gegenprobe: Mit `zustand.verbundenerTab || zustand.aktuellerTab` in
   * tabkarteZeichnen und startseitenStand ist dieser Satz rot.
   */
  const tabs = [
    { id: 8, url: "https://www.ebay.de/sh/lst/active", title: "eBay, aktive Angebote" },
    { id: 10, url: "chrome://extensions", title: "Erweiterungen", active: true },
  ];
  const p = await mitEchterStartseite({
    alleTabs: tabs,
    tab: tabs[1],
    workerAntworten: { "link:zustand?": laufendeSitzung() },
  });
  t.after(p.aufraeumen);

  assert.ok(p.zustand.sitzung, "Vorbedingung: die Sitzung ist wiederhergestellt");
  assert.equal(p.zustand.tabId, 8, "Vorbedingung: sie gehoert Tab 8");
  assert.equal(p.zustand.aktuellerTab.id, 10, "Vorbedingung: angesehen wird ein ganz anderer");

  assert.equal(p.el("tabkarte-titel").textContent, "eBay, aktive Angebote");
  assert.equal(p.el("tabkarte-adresse").textContent, "www.ebay.de");

  const karte = startkarte(p);
  assert.match(karte.satz, /eBay/, `die Statuskarte nennt den Sitzungstab: „${karte.satz}"`);
  assert.ok(
    !/Erweiterungen/.test(karte.satz),
    `die Leiste behauptet eine Steuerung auf einer Browserseite: „${karte.satz}"`,
  );
  /* Und die Gegenprobe zur Sperre selbst: Auf dieser Seite koennte gar nichts
     laufen. Ein Name, den der Verbindungsweg verweigern wuerde, darf in der
     Statuskarte nie stehen. */
  assert.equal(rechte.sperrgrund("chrome://extensions"), "browser");
});

test("VB2 — Ein gescheiterter Anlauf benennt nicht die naechste Sitzung", async (t) => {
  /*
   * VERBINDUNG-2, gemessen: `tabVerbindenMit` setzte `zustand.verbundenerTab`,
   * bevor feststand, ob die Verbindung ueberhaupt zustande kommt, und
   * aufbauAbbrechen raeumte die Angabe nirgends weg. Klick auf die eBay-Zeile
   * (Tab 8) scheitert am Dienst, danach Verbindung ueber den Dialogweg auf den
   * aktiven Tab 7: `zustand.tabId` = 7, `overlay:an` geht wirklich an Tab 7 —
   * und die Karten sagten „eBay, aktive Angebote". Der Mensch liest, der Agent
   * arbeite auf eBay, waehrend er auf geizhals.de klickt.
   *
   * Der Dialogweg ist Absicht und nicht Bequemlichkeit: Er setzt `tabId`, aber
   * nicht `verbundenerTab`, und genau darin lag der Fund. Ueber den
   * Ein-Klick-Weg haette der zweite Anlauf den alten Wert zufaellig
   * ueberschrieben und den Fehler zugedeckt.
   *
   * Gegenprobe: Ohne das Wegraeumen in aufbauAbbrechen UND ohne die Pruefung
   * der Kennung in tabZuKennung ist dieser Satz rot.
   */
  let runde = 0;
  const p = await mitEchterStartseite({
    alleTabs: TABS_GEMISCHT(),
    workerAntworten: {
      "link:verbinden": () => {
        runde += 1;
        return runde === 1 ? { ok: false, klartext: "Der Dienst mag nicht." } : sitzungAntwort();
      },
    },
  });
  t.after(p.aufraeumen);

  const ebay = mitKlasseUnter(p.el("startseite"), "sa-tab").find((z) => /ebay/.test(z.textContent));
  assert.ok(ebay, "Vorbedingung: das andere Fenster steht in der echten Liste");
  await p.klickAuf(ebay.querySelector(".sa-tab-verbinden"));

  assert.equal(p.zustand.sitzung, null, "Vorbedingung: der erste Anlauf ist wirklich gescheitert");
  assert.equal(p.zustand.verbundenerTab, null, "und er laesst keinen Tab zurueck, den er nie bekommen hat");

  await p.klick("verbinden-start");
  await p.klick("verbinden");

  assert.ok(p.zustand.sitzung, "Vorbedingung: die zweite Verbindung steht");
  assert.equal(p.zustand.tabId, 7, "Vorbedingung: und zwar auf dem aktiven Tab");
  assert.equal(p.el("tabkarte-titel").textContent, "Warenkorb");
  const karte = startkarte(p);
  assert.match(karte.satz, /Warenkorb/, `die Statuskarte folgt der Sitzung: „${karte.satz}"`);
  assert.ok(!/eBay/.test(karte.satz), `der gescheiterte Anlauf spricht weiter mit: „${karte.satz}"`);
});

test("VB3 — Die Vorfuehrung zieht alle vier Anzeigeflaechen nach und nennt sich beim Namen", async (t) => {
  /*
   * VERBINDUNG-3, gemessen: `vorfuehrungStarten()` setzte `zustand.sitzung` und
   * schaltete auf `aktiv`, rief aber nie `verbindungswegZeichnen()`. Zusammen
   * mit der M7-Reparatur (die Startseite bleibt bei laufender Sitzung stehen)
   * war die veraltete Statuskarte damit SICHTBAR: Chip „Vorfuehrung · Nur
   * zusehen" und Sitzungsleiste — und daneben ein grauer Punkt mit „Waehle
   * einen Tab, dann geht es los.", die Tabliste mit zwei bedienbaren
   * Verbinden-Knoepfen und eine Tabkarte mit gruenem Punkt und LEEREM Titel.
   * Ein Loch, das die Reparatur selbst gerissen hat.
   *
   * Zweitens sagt die Karte jetzt „Vorfuehrung" und nicht „Verbunden mit":
   * Eine Vorfuehrung ist eine Sitzung der Oberflaeche und keine Steuerung, und
   * eine Karte, die neben einem Chip „Vorfuehrung" das Wort „Verbunden"
   * schreibt, ist derselbe Widerspruch zweier Anzeigeflaechen, nur leiser.
   *
   * Gegenprobe: Ohne verbindungswegZeichnen() in vorfuehrungStarten ist dieser
   * Satz rot (grauer Punkt, „Waehle einen Tab", leerer Tabkartentitel).
   */
  const p = await mitEchterStartseite({
    alleTabs: TABS_GEMISCHT(),
    workerAntworten: { "link:verbinden": { ok: false, klartext: "Der Dienst mag nicht." } },
  });
  t.after(p.aufraeumen);

  await p.klick("verbinden-tab");
  assert.equal(p.zustand.sitzung, null, "Vorbedingung: der Anlauf ist gescheitert");
  assert.equal(p.el("vorfuehrung").hidden, false, "Vorbedingung: die Vorfuehrung wird angeboten");

  await p.klick("vorfuehrung");

  assert.ok(p.zustand.sitzung, "Vorbedingung: die Vorfuehrung laeuft");
  assert.equal(p.zustand.sitzung.vorfuehrung, true);
  assert.equal(p.el("app").dataset.state, "aktiv");

  /* 1. und 2.: Chip und Sitzungsleiste — die beiden, die schon vorher stimmten. */
  assert.match(p.el("zustand-text").textContent, /Vorführung/);
  assert.equal(p.el("sitzungsleiste").hidden, false);

  /* 3.: die Tabkarte, bis dahin gruener Punkt ueber leerem Titel. */
  assert.equal(p.el("tabkarte").hidden, false);
  assert.equal(p.el("tabkarte-titel").textContent, "Warenkorb", "keine leere Karte neben einem gruenen Punkt");

  /* 4.: die Statuskarte der Startseite, um die es im Kriterium geht. */
  const karte = startkarte(p);
  assert.equal(karte.punkt, "sa-punkt probe", "die Vorfuehrung traegt nicht das Gruen einer echten Sitzung");
  assert.match(karte.satz, /Vorführung/, `die Karte nennt sie beim Namen: „${karte.satz}"`);
  assert.ok(!/Verbunden/.test(karte.satz), `eine Vorfuehrung ist keine Verbindung: „${karte.satz}"`);
  assert.ok(!/Wähle einen Tab/.test(karte.satz), `die Karte steht auf dem Stand von vorhin: „${karte.satz}"`);
  assert.equal(karte.listeVersteckt, true, "und die Einladung zu einem zweiten Antrag ist weg");
});

test("VB4 — Zwischen Klick und Sitzung sagt auch die Statuskarte, dass gearbeitet wird", async (t) => {
  /*
   * VERBINDUNG-4, gemessen mit haengendem `link:verbinden`, also dem
   * MV3-Kaltstartfall: Chip „Ich stelle die Verbindung her …", Hinweiszeile
   * dasselbe, #verbinden-tab abgeschaltet — und im selben Augenblick
   * Startseitenkarte mit grauem Punkt und „Waehle einen Tab, dann geht es
   * los.", Tabliste sichtbar, zwei Verbinden-Knoepfe, davon null abgeschaltet.
   * Zwei Statusflaechen nebeneinander sagten das Gegenteil voneinander, und die
   * stehengebliebene lud zum zweiten Klick ein. Der Riegel faengt ihn, die
   * Anzeige tat es nicht.
   *
   * Gegenprobe: Ohne startseiteZeichnen() in aufbauSpiegeln ist dieser Satz rot.
   */
  let loesen;
  const langsam = new Promise((f) => {
    loesen = f;
  });
  const p = await mitEchterStartseite({
    alleTabs: TABS_GEMISCHT(),
    workerAntworten: { "link:verbinden": () => langsam },
  });
  t.after(p.aufraeumen);

  assert.equal(startkarte(p).punkt, "sa-punkt", "Vorbedingung: vorher steht die Karte auf frei");

  const lauf = p.klick("verbinden-tab");
  await new Promise((f) => setTimeout(f, 0));
  await new Promise((f) => setTimeout(f, 0));

  assert.equal(p.zustand.sitzung, null, "Vorbedingung: die Sitzung gibt es noch nicht");
  const karte = startkarte(p);
  assert.equal(karte.punkt, "sa-punkt baut", "der Punkt zeigt die Arbeit, und nicht die Ruhe");
  assert.match(karte.satz, /Verbindung her/, `die Karte sagt dasselbe wie der Chip: „${karte.satz}"`);
  assert.equal(
    p.el("zustand-text").textContent.includes("Verbindung her"),
    true,
    "Gegenprobe: der Chip sagt es auch, und zwar mit demselben Satz",
  );
  assert.equal(karte.listeVersteckt, true, "und die Liste laedt nicht zum zweiten Klick ein");
  assert.equal(karte.trennenVersteckt, true, "beenden laesst sich hier noch nichts");

  loesen(sitzungAntwort());
  await lauf;

  const danach = startkarte(p);
  assert.equal(danach.punkt, "sa-punkt an", "danach ist es eine echte Sitzung");
  assert.match(danach.satz, /Verbunden mit/, `und die Karte sagt es: „${danach.satz}"`);
});

test("VB4b — Scheitert der Aufbau, geht auch die Statuskarte zurueck", async (t) => {
  /* Die andere Haelfte von VERBINDUNG-4: Eine Arbeitsanzeige, die nur beim
     Gelingen zurueckgeht, laesst die Karte fuer immer auf „Ich stelle die
     Verbindung her …" stehen, waehrend nichts mehr laeuft. */
  const p = await mitEchterStartseite({
    alleTabs: TABS_GEMISCHT(),
    workerAntworten: { "link:verbinden": { ok: false, klartext: "Der Dienst mag nicht." } },
  });
  t.after(p.aufraeumen);

  await p.klick("verbinden-tab");

  const karte = startkarte(p);
  assert.equal(p.zustand.sitzung, null, "Vorbedingung: es ist nichts entstanden");
  assert.equal(karte.punkt, "sa-punkt", "die Karte steht wieder auf frei");
  assert.match(karte.satz, /Wähle einen Tab/, `und sagt, wie es weitergeht: „${karte.satz}"`);
  assert.equal(karte.listeVersteckt, false, "die Liste ist der Weg zurueck und steht wieder da");
});

test("VB5 — Der Aufbau der Startseite laesst den Namen des Bereichs stehen", async (t) => {
  /*
   * VERBINDUNG-5, gemessen: `aufbauen()` ruft `wurzel.replaceChildren()`. Als
   * Anker bekam es `#startseite`, und darin standen zwei Knoten, die ihm nicht
   * gehoeren — `#startseite-titel`, auf das das `aria-labelledby` des
   * Abschnitts zeigt, und `#startseite-liste`, der Anker der Ersatzfassung in
   * panel.js. Nach dem Aufbau trug `#startseite` keinen einzigen Knoten mit
   * Kennung mehr: Der Bereich verlor seinen Namen fuer den Bildschirmleser,
   * und Vorlesen ist der Hauptbedienweg des Inhabers.
   *
   * Gegenprobe: Mit `$("startseite")` als Anker in startseiteZeichnen ist
   * dieser Satz rot.
   */
  const p = await mitEchterStartseite({ alleTabs: TABS_GEMISCHT() });
  t.after(p.aufraeumen);

  const kinder = p.el("startseite").kinder.filter((k) => typeof k !== "string");
  assert.ok(
    kinder.some((k) => k.id === "startseite-titel"),
    "die Ueberschrift, auf die aria-labelledby zeigt, ist aus dem Dokument geflogen",
  );
  assert.ok(
    kinder.some((k) => k.id === "startseite-liste"),
    "und der Anker der Ersatzfassung mit ihr",
  );
  assert.match(
    html,
    /<section id="startseite"[^>]*aria-labelledby="startseite-titel"/,
    "Gegenprobe: der Abschnitt holt seinen Namen wirklich von dort",
  );
  /* Das Modul hat trotzdem wirklich gezeichnet, der Anker ist nicht bloss
     unberuehrt geblieben. */
  assert.ok(p.el("startseite").querySelector(".sa-start-stand"), "die echte Startseite steht darin");
  /* Fuer das Auge weicht die Ueberschrift, weil das Modul seine eigene
     mitbringt; als Name des Abschnitts gilt sie weiter. */
  assert.match(p.el("startseite-titel").className, /\bsr\b/, "zwei Ueberschriften uebereinander");

  /* Und ohne Modul bleibt sie sichtbar: Dann ist sie die einzige, die die
     Ersatzliste hat. */
  const ersatz = await panelStarten({ alleTabs: TABS_GEMISCHT() });
  t.after(ersatz.aufraeumen);
  assert.equal(ersatz.el("startseite-titel").className, "startseite-titel");
});

test("VB5b — Ohne Anker zeichnet die Ersatzfassung nichts und wirft nichts", async (t) => {
  /*
   * Der zweite Riegel zu VERBINDUNG-5, und er ist der teurere Teil des Fundes:
   * Ist `#startseite-liste` einmal aus dem Dokument geworfen, liefert
   * `getElementById` im Browser `null`, und die Ersatzfassung lief auf
   * `null.replaceChildren()`. Diese Ausnahme reisst `verbindungswegZeichnen()`
   * mit — und das steht in `beenden()` VOR `link:trennen`. Der Preis waere ein
   * Mensch ohne Stopp.
   *
   * Gefahren wird hier ausnahmsweise die Funktion selbst und nicht der
   * Produktivweg: Die Nachbildung legt jedes Element mit Kennung von sich aus
   * an, sie kann einen fehlenden Anker gar nicht darstellen. Der Riegel gilt
   * fuer den Browser, und dort ist er messbar nur so beschreibbar.
   */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  for (const kein of [null, undefined, {}]) {
    assert.doesNotThrow(() => p.f.tabListeSelbstZeichnen(kein, { tabs: [], aufWaehlen: () => {} }));
  }
  /* Gegenprobe: Mit einem Anker zeichnet dieselbe Funktion wirklich. */
  p.f.tabListeSelbstZeichnen(p.el("startseite-liste"), {
    tabs: [{ id: 7, url: "https://geizhals.de/warenkorb", title: "Warenkorb" }],
    aufWaehlen: () => {},
  });
  assert.equal(listenZeilen(p).length, 1);
});

test("VB6 — Verschwindet der Tab der Sitzung, nennt ihn die Leiste nicht weiter", async (t) => {
  /*
   * VERBINDUNG-7, gemessen: `tabsAuffrischen()` ueberschrieb
   * `zustand.verbundenerTab` nur, wenn der Tab noch im Bestand stand. Sitzung
   * auf Tab 8, dann onRemoved fuer Tab 8 — Ergebnis unveraendert:
   * Startseitenkarte gruener Punkt und „Verbunden mit eBay, aktive Angebote",
   * Tabkarte „eBay, aktive Angebote", Chip „Aktiv · Bedienen". Die Leiste
   * nannte als Ziel einen Tab, den es nicht mehr gab.
   *
   * Was hier NICHT behauptet wird: dass die Sitzung damit endet. Das entscheidet
   * der Hintergrunddienst, und an `chrome.tabs.onRemoved` haengt dort heute
   * niemand (steht als Fremdbedarf). Diese Leiste hoert auf, einen Namen zu
   * nennen, den sie nicht mehr belegen kann.
   *
   * Gegenprobe: Mit `if (gefunden)` in tabsAuffrischen ist dieser Satz rot.
   */
  /* Verbunden wird ueber die echte Zeile im anderen Fenster, also den Weg, auf
     dem die Leiste den Tab-Datensatz wirklich in die Hand bekommt. Nur so
     misst dieser Satz das Wegraeumen in tabsAuffrischen und nicht bloss die
     Kennungspruefung in tabZuKennung, die schon VB1 misst. */
  const tabs = TABS_GEMISCHT();
  const p = await mitEchterStartseite({
    alleTabs: tabs,
    workerAntworten: { "link:verbinden": sitzungAntwort() },
  });
  t.after(p.aufraeumen);

  const ebayZeile = mitKlasseUnter(p.el("startseite"), "sa-tab").find((z) => /ebay/.test(z.textContent));
  assert.ok(ebayZeile, "Vorbedingung: das andere Fenster steht in der echten Liste");
  await p.klickAuf(ebayZeile.querySelector(".sa-tab-verbinden"));

  assert.ok(p.zustand.sitzung, "Vorbedingung: die Sitzung steht");
  assert.equal(p.zustand.tabId, 8, "Vorbedingung: die Sitzung haengt an Tab 8");
  assert.equal(p.zustand.verbundenerTab && p.zustand.verbundenerTab.id, 8, "Vorbedingung: sein Datensatz auch");
  assert.match(startkarte(p).satz, /eBay/, "Vorbedingung: und die Karte nennt ihn");

  tabs.splice(
    tabs.findIndex((x) => x.id === 8),
    1,
  );
  await p.tabEreignis("onRemoved", 8, { windowId: 1, isWindowClosing: false });

  assert.equal(p.zustand.verbundenerTab, null, "der Datensatz eines Tabs, den es nicht gibt");
  const karte = startkarte(p);
  assert.ok(!/eBay/.test(karte.satz), `die Karte nennt einen Tab, den es nicht mehr gibt: „${karte.satz}"`);
  assert.match(karte.satz, /Verbunden/, `die Sitzung selbst laeuft weiter und wird auch so genannt: „${karte.satz}"`);
  assert.equal(
    p.el("tabkarte-titel").textContent,
    "www.ebay.de",
    "die Tabkarte faellt auf den Ursprung zurueck, fuer den der Mensch freigegeben hat",
  );
});

test("VB7 — Der Modus gilt dem Tab, den der Mensch ansieht, nicht dem Anlauf von vorhin", async (t) => {
  /*
   * Dieselbe Fehlerart an einer Stelle, die kein Fund genannt hat, selbst
   * gefunden beim Durchgehen aller Leser von `zustand.tabId`: `modusTabId()`
   * gab die Kennung zurueck, sobald sie eine Zahl war — und sie ueberlebt einen
   * gescheiterten Anlauf und einen geschlossenen Dialog. Der Kommentar darueber
   * beschrieb die richtige Regel („Laeuft eine Sitzung, ist es ihrer; sonst der
   * Tab, mit dem der eine Klick verbinden wuerde"), der Code hielt sie nicht
   * ein. Folge: Wer nach einem Fehlversuch den Betriebsmodus umstellte, stellte
   * ihn fuer den Tab von vorhin um — und der Umschalter daneben sprach ueber
   * einen Tab, den der Mensch gar nicht ansieht. Das ist Vertrag §2, und der
   * Modus ist die Stufe, die entscheidet, wieviel ohne Rueckfrage geschieht.
   *
   * Gegenprobe: Ohne die Bedingung `zustand.sitzung || zustand.aufbau !== null`
   * in modusTabId ist dieser Satz rot (tabId 8 statt 7).
   */
  const p = await mitEchterStartseite({
    alleTabs: TABS_GEMISCHT(),
    workerAntworten: { "link:verbinden": { ok: false, klartext: "Der Dienst mag nicht." } },
  });
  t.after(p.aufraeumen);

  const ebay = mitKlasseUnter(p.el("startseite"), "sa-tab").find((z) => /ebay/.test(z.textContent));
  await p.klickAuf(ebay.querySelector(".sa-tab-verbinden"));
  assert.equal(p.zustand.sitzung, null, "Vorbedingung: der Anlauf auf Tab 8 ist gescheitert");
  assert.equal(p.zustand.tabId, 8, "Vorbedingung: seine Kennung steht noch, sie ist das Ziel des Versuchs");

  p.spurLeeren();
  await p.klick("modus-auto");

  const gesetzt = p.anWorkerVoll().filter((n) => n.typ === "modus:setzen");
  assert.equal(gesetzt.length, 1, "genau eine Meldung an den Dienst");
  assert.equal(gesetzt[0].tabId, 7, "und zwar fuer den Tab, den der Mensch ansieht");

  /* Gegenprobe: Laeuft eine Sitzung, gilt SIE und nicht der aktive Tab. */
  const q = await mitEchterStartseite({
    alleTabs: TABS_GEMISCHT(),
    workerAntworten: { "link:zustand?": laufendeSitzung() },
  });
  t.after(q.aufraeumen);
  assert.equal(q.zustand.tabId, 8, "Vorbedingung: die Sitzung haengt an Tab 8");
  assert.equal(q.zustand.aktuellerTab.id, 7, "Vorbedingung: angesehen wird Tab 7");
  q.spurLeeren();
  await q.klick("modus-auto");
  assert.equal(
    q.anWorkerVoll().filter((n) => n.typ === "modus:setzen")[0].tabId,
    8,
    "der Modus der laufenden Sitzung gehoert ihrem Tab",
  );
});

test("VB8 — Ohne Agentennamen steht kein haengender Doppelpunkt da", async (t) => {
  /*
   * BRUECKE-6, gemessen: `link:cloud-sitzung` mit `an:true, agent:""` ->
   * `#cloud-zeile.hidden=false`, `#cloud-agent.textContent=""`. Sichtbar blieb
   * „Cloud-Sitzung aktiv:" und danach nichts. Da der Name im Alltagsfall leer
   * ist (BRUECKE-7: jeder Rahmen MIT Agentennamen stirbt heute an
   * `agent_not_permitted`), ist das der Normalzustand und nicht der
   * Ausnahmefall; ein Bildschirmleser liest den Doppelpunkt und dann Stille.
   *
   * Gegenprobe: Mit dem festen Satz aus panel.html ist dieser Satz rot.
   */
  const p = await panelStarten();
  t.after(p.aufraeumen);

  p.melden({ typ: "link:cloud-sitzung", an: true, agent: "" });

  assert.equal(p.el("cloud-zeile").hidden, false, "dass eine Fernsitzung laeuft, steht weiterhin da");
  assert.equal(p.el("cloud-wort").textContent, "Cloud-Sitzung aktiv", "ohne Namen kein Doppelpunkt");
  assert.equal(p.el("cloud-agent").textContent, "", "und kein Name, den niemand belegt hat");
  assert.equal(p.el("cloud-agent").hidden, true, "das leere Feld steht auch nicht als Luecke da");
  assert.equal(p.zustand.cloudAgent, null);

  /* Mit Namen bleibt alles, wie es war — der Doppelpunkt gehoert zum Namen. */
  p.melden({ typ: "link:cloud-sitzung", an: true, agent: "SMarTrCEO" });
  assert.equal(p.el("cloud-wort").textContent, "Cloud-Sitzung aktiv:");
  assert.equal(p.el("cloud-agent").textContent, "SMarTrCEO");
  assert.equal(p.el("cloud-agent").hidden, false);
});

test("VB9 — Beim Wiederoeffnen behauptet die Leiste keine Fernsitzung, die ihr niemand gemeldet hat", async (t) => {
  /*
   * BRUECKE-1, halb geschlossen, und die andere Haelfte steht als Fremdbedarf.
   *
   * Gemessen: `link:zustand?` liefert heute weder `agent` noch eine Angabe,
   * DASS es eine Cloud-Sitzung ist — worker.js:732 gibt den Namen nur heraus,
   * wenn er in AGENTEN steht, und ein Rahmen MIT Agentennamen stirbt an
   * `agent_not_permitted`, weil die Matrix ab Werk leer ist. Die arbeitende
   * Sitzung hat also keinen Namen, und nach dem Wiederoeffnen fehlte die
   * Dauerzeile aus §8.4 vollstaendig.
   *
   * Was diese Leiste tun kann, tut sie: Sie nimmt beide Auskuenfte entgegen
   * — `cloud` sagt DASS, `agent` sagt WER — und erfindet keine von beiden.
   * Ohne Auskunft keine Zeile und keine Behauptung.
   *
   * Gegenprobe: Mit `cloudSitzungZeigen(!!agent, agent)` ist die erste Haelfte
   * dieses Satzes rot.
   */
  const ohne = await panelStarten({
    workerAntworten: { "link:zustand?": laufendeSitzung() },
  });
  t.after(ohne.aufraeumen);
  assert.ok(ohne.zustand.sitzung, "Vorbedingung: es laeuft eine Sitzung");
  assert.equal(ohne.el("cloud-zeile").hidden, true, "ohne jede Auskunft keine Dauerzeile");
  assert.equal(ohne.zustand.cloudAgent, null);

  /* Sagt der Dienst, DASS es eine Fernsitzung ist, steht sie da — auch ohne
     Namen, denn genau das ist der arbeitsfaehige Betriebsfall. */
  const mit = await panelStarten({
    workerAntworten: { "link:zustand?": laufendeSitzung({ cloud: true }) },
  });
  t.after(mit.aufraeumen);
  assert.equal(mit.el("cloud-zeile").hidden, false, "die Dauerzeile aus §8.4 steht wieder da");
  assert.equal(mit.el("cloud-wort").textContent, "Cloud-Sitzung aktiv", "ohne Namen ohne Doppelpunkt");
  assert.equal(mit.el("cloud-agent").hidden, true);
  assert.equal(mit.zustand.cloudAgent, null, "und ein Name wird trotzdem nicht erfunden");
});

test("VB10 — Auch die Freigabefrage selbst wird entschaerft, bevor sie dasteht und gesprochen wird", async (t) => {
  /*
   * Selbst gefunden am 14.08.2026, beim Durchgehen jeder Stelle, an der ein
   * Anzeigewert aus einer Nachricht kommt: `link:schritt-freigabe` reichte
   * `n.frage` roh in die Karte und in die Ansage. Dass darin nie Text von der
   * besuchten Seite steht, ist eine Zusage des Absenders und keine Eigenschaft
   * dieser Anzeige — und sie ist die einzige, die VORGELESEN wird und an der
   * eine Entscheidung haengt.
   *
   * Gegenprobe: Mit `String(n.frage || …)` ist dieser Satz rot.
   */
  const p = await panelStarten();
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();

  /* Aus Zahlen gebaut, damit in dieser Datei kein einziges davon steht. */
  const bell = String.fromCharCode(7);
  const nullbreite = String.fromCharCode(0x200b);
  const richtungsmarke = String.fromCharCode(0x202e);
  const frage = `Soll ich${bell} auf ${nullbreite}Kaufen${richtungsmarke} klicken?${"X".repeat(500)}`;

  const antwort = p.frageStellen({ typ: "link:schritt-freigabe", frage, quelle: "Kaufen", frist: 9000 });

  const gezeigt = p.el("freigabe-text").textContent;
  assert.ok(!steuerzeichenDrin(gezeigt), `Steuerzeichen in der Freigabefrage: ${JSON.stringify(gezeigt)}`);
  assert.ok(gezeigt.length <= 301, `die Frage wird gedeckelt, gemessen: ${gezeigt.length}`);
  assert.match(gezeigt, /^Soll ich auf Kaufen klicken\?/, "und der Satz bleibt der, den der Mensch lesen soll");
  assert.ok(
    !steuerzeichenDrin(p.el("ansage").textContent),
    "und was vorgelesen wird, traegt sie erst recht nicht",
  );

  await p.klick("freigabe-nein");
  assert.equal((await antwort).ja, false, "Gegenprobe: die Karte beantwortet die Frage weiterhin");
});

test("VB11 — Eine fremde Ansicht, die wirft, nimmt dem Menschen nicht den Stopp", async (t) => {
  /*
   * Selbst gefunden am 14.08.2026, als Gegenstueck zur zweiten Haelfte von
   * VERBINDUNG-5: `startseiteZeichnen()` laeuft in `verbindungswegZeichnen()`,
   * und das steht in `beenden()` VOR `link:trennen`. Eine Ausnahme aus
   * src/panel/startseite.js — einer Datei, die einem anderen Bereich gehoert —
   * riss damit den ganzen Abbau mit: kein `link:trennen` an den Dienst, kein
   * `overlay:aus` an den Tab, kein Seitenrecht zurueck. Der Mensch drueckt
   * Stopp, und der Agent behaelt seine Rechte.
   *
   * Gegenprobe: Ohne das try/catch in startseiteZeichnen ist dieser Satz rot.
   */
  const echt = await import("../panel/startseite.js");
  let boese = false;
  const p = await panelStarten({
    alleTabs: TABS_GEMISCHT(),
    startseiteModul: {
      ...echt,
      aufbauen(wurzel, dienste) {
        const griff = echt.aufbauen(wurzel, dienste);
        const echterStand = griff.standSetzen;
        griff.standSetzen = (stand) => {
          if (boese) throw new Error("die fremde Ansicht ist kaputt");
          return echterStand(stand);
        };
        return griff;
      },
    },
  });
  t.after(p.aufraeumen);
  await p.sitzungHerstellen();
  assert.ok(p.zustand.sitzung, "Vorbedingung: es laeuft etwas");
  p.alleSpurenLeeren();

  boese = true;
  await p.f.beenden("nutzer");

  assert.equal(p.zustand.sitzung, null, "die Sitzung ist wirklich beendet");
  assert.ok(p.anWorker().includes("link:trennen"), `der Dienst hat das Ende erfahren: ${p.anWorker().join(", ")}`);
  assert.ok(p.anTab().includes("overlay:aus"), "der Rahmen geht von der Seite");
  assert.ok(p.rechteRueckgaben() > 0, "und das Seitenrecht geht zurueck");
  assert.equal(p.el("app").dataset.state, "bereit", "die Anzeige steht auf dem Ruhezustand");
});
