/*
 * Prüfung des Manifests, Stand 10.08.2026.
 *
 * WARUM es diese Datei gibt: 221 Prüfsätze standen grün, und trotzdem lagen
 * zwei Blocker offen. Beide lagen nicht im Quelltext, sondern im
 * manifest.json, und dorthin hat nie ein Prüfsatz geschaut.
 *
 *  1. Die Beschreibung war 142 Zeichen lang. Der Web Store nimmt höchstens
 *     132 (developer.chrome.com/docs/extensions/reference/manifest/description).
 *     Die Einreichung scheitert daran, bevor überhaupt ein Prüfsatz läuft.
 *  2. "activeTab" fehlte in den Rechten. chrome.tabs.captureVisibleTab wirft
 *     ohne dieses Recht auf JEDER Seite, der Befehl screenshot war damit tot.
 *     (Stand 15.08.2026: Der Bildweg holt sein Seitenrecht inzwischen vor der
 *     Sitzung über chrome.permissions.request, siehe net/rechte.js. "activeTab"
 *     flog deshalb als unbenutzt wieder aus dem Manifest — die beiden
 *     Prüfsätze zu den Rechten messen seitdem BEIDE Richtungen.)
 *
 * Warum kein bestehender Prüfsatz das finden konnte: Die Chrome-Attrappe
 * (chrome-attrappe.mjs) liefert captureVisibleTab immer ein Bild, egal was im
 * Manifest steht. Sie bildet die Rechteprüfung des Browsers nicht ab und kann
 * es auch gar nicht. Diese Datei misst deshalb bewusst NICHT gegen die
 * Attrappe, sondern gegen die Wirklichkeit auf der Platte: das echte
 * manifest.json gegen den echten Quelltext unter src/.
 *
 * Grundsatz für alles hier: keine fest eingetippte Liste dessen, was der Code
 * heute benutzt. Die Ableitung liest den Quelltext. Kommt morgen eine
 * Schnittstelle dazu und ihr Recht fehlt, schlägt der Prüfsatz von allein an,
 * ohne dass jemand daran denken muss.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

/* Der Weg zur Wurzel geht über die eigene Dateilage, nicht über das
   Arbeitsverzeichnis: Nur so misst eine KOPIE des Baums auch wirklich ihre
   eigene Kopie des Manifests und nicht versehentlich das Original. */
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST_PFAD = join(WURZEL, "manifest.json");

const manifest = JSON.parse(await readFile(MANIFEST_PFAD, "utf8"));

const kurz = (pfad) => relative(WURZEL, pfad);

/* ------------------------------------------------------------------ *
 * Quelltext einlesen
 * ------------------------------------------------------------------ */

const QUELLENDUNGEN = [".js", ".mjs", ".html"];

/* src/pruefung/ bleibt draußen. Sonst zählte die Attrappe selbst als
   "benutzte Schnittstelle" und die Ableitung verlangte Rechte für Aufrufe,
   die es in der Erweiterung gar nicht gibt. */
const AUSGENOMMEN = new Set(["pruefung", "node_modules"]);

async function quelldateienSammeln(ordner) {
  const gefunden = [];
  for (const eintrag of await readdir(ordner, { withFileTypes: true })) {
    const pfad = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) {
      if (AUSGENOMMEN.has(eintrag.name)) continue;
      gefunden.push(...(await quelldateienSammeln(pfad)));
    } else if (QUELLENDUNGEN.some((endung) => eintrag.name.endsWith(endung))) {
      gefunden.push(pfad);
    }
  }
  return gefunden;
}

/* Reine Kommentarzeilen fliegen raus. Grund: In diesem Baum erklären lange
   Kopfkommentare, WARUM etwas so gebaut ist, und nennen dabei Schnittstellen
   im Fließtext ("nicht in chrome.storage.local"). Eine Erwähnung ist keine
   Benutzung. Ein vollständiges Entfernen von Kommentaren wäre hier gefährlich,
   weil "//" auch mitten in Adressen wie https://... steht, deshalb nur der
   sichere Fall: Zeilen, die mit *, // oder /* beginnen. */
function ohneKommentarzeilen(text) {
  return text
    .split("\n")
    .filter((zeile) => {
      const anfang = zeile.trimStart();
      return !(anfang.startsWith("*") || anfang.startsWith("//") || anfang.startsWith("/*"));
    })
    .join("\n");
}

const QUELLDATEIEN = await quelldateienSammeln(join(WURZEL, "src"));
const QUELLTEXT = new Map();
for (const pfad of QUELLDATEIEN) {
  QUELLTEXT.set(pfad, ohneKommentarzeilen(await readFile(pfad, "utf8")));
}

/** name der Schnittstelle -> Menge der Dateien, die sie benutzen. */
function benutzteSchnittstellen() {
  const gefunden = new Map();
  for (const [pfad, code] of QUELLTEXT) {
    for (const treffer of code.matchAll(/\bchrome\.([A-Za-z][A-Za-z0-9]*)/g)) {
      const name = treffer[1];
      if (!gefunden.has(name)) gefunden.set(name, new Set());
      gefunden.get(name).add(kurz(pfad));
    }
  }
  return gefunden;
}

const BENUTZT = benutzteSchnittstellen();

/* Schnittstellen, die Chrome OHNE Eintrag unter "permissions" herausgibt.
   Bewusst als Ausnahmeliste gebaut und nicht andersherum: Alles, was hier
   nicht steht, muss unter seinem eigenen Namen im Manifest stehen, auch das,
   was es heute noch gar nicht gibt. Eine Liste der erlaubten Benutzungen wäre
   genau der Prüfsatz, der bei der nächsten Erweiterung still grün bleibt.
   chrome.action und chrome.commands brauchen kein Recht, sondern ihren
   eigenen Manifest-Schlüssel, den prüft weiter unten ein eigener Prüfsatz. */
const OHNE_RECHT = new Set([
  "runtime",
  "i18n",
  "extension",
  "action",
  "commands",
  "permissions",
  "dom",
]);

/* ------------------------------------------------------------------ *
 * Texte, die ein Mensch zu sehen oder zu hören bekommt
 * ------------------------------------------------------------------ */

function menschentexte() {
  const texte = [];
  const nimm = (ort, wert) => {
    if (typeof wert === "string" && wert.length > 0) texte.push({ ort, text: wert });
  };
  nimm("name", manifest.name);
  nimm("short_name", manifest.short_name);
  nimm("description", manifest.description);
  nimm("action.default_title", manifest.action && manifest.action.default_title);
  for (const [befehl, angaben] of Object.entries(manifest.commands || {})) {
    nimm(`commands.${befehl}.description`, angaben && angaben.description);
  }
  return texte;
}

/* Halbgeviert, Geviert und ihre Verwandten. Der Inhaber lässt sich alles
   vorlesen, und die Sprachausgabe spricht diese Zeichen als Wort aus. Ein
   Komma tut dasselbe, ohne dass jemand "Gedankenstrich" hört. */
const GEDANKENSTRICH = /[‐‑‒–—―−]/;
/* Ein Bindestrich zwischen zwei Leerzeichen ist derselbe Fall in billig. */
const BINDESTRICH_FREISTEHEND = /\s-\s/;

/* Bekannte Ersatzschreibungen, jede im Wortzusammenhang und nicht als bloßes
   "ae/oe/ue/ss". Ein Muster auf zwei Buchstaben schlüge bei "Baum", "Feuer"
   oder "Klasse" an und wäre nach der ersten Fehlmeldung abgeschaltet, also
   wertlos. Die Wortstämme hier kommen in richtig geschriebenem Deutsch nicht
   vor. Wo es doch ein ehrliches Wort mit derselben Buchstabenfolge gibt
   (Grossist, Weissagung), grenzt ein Blick auf das nächste Stück Wort ab.
   Lieber ein Muster weniger als eine Fehlmeldung bei einem harmlosen Wort. */
const ERSATZSCHREIBUNGEN = [
  { muster: /waehl/i, richtig: "wähl" },
  { muster: /waehr/i, richtig: "währ" },
  { muster: /aender/i, richtig: "änder" },
  { muster: /aehnlich/i, richtig: "ähnlich" },
  { muster: /naechst/i, richtig: "nächst" },
  { muster: /spaeter/i, richtig: "später" },
  { muster: /erklaer/i, richtig: "erklär" },
  { muster: /bestaetig/i, richtig: "bestätig" },
  { muster: /taeglich/i, richtig: "täglich" },
  { muster: /staendig/i, richtig: "ständig" },
  { muster: /zaehl/i, richtig: "zähl" },
  { muster: /faell/i, richtig: "fäll" },
  { muster: /laeuf/i, richtig: "läuf" },
  { muster: /laess/i, richtig: "läss" },
  { muster: /haeng/i, richtig: "häng" },
  { muster: /oeffn/i, richtig: "öffn" },
  { muster: /koenn/i, richtig: "könn" },
  { muster: /moeg/i, richtig: "mög" },
  { muster: /moecht/i, richtig: "möcht" },
  { muster: /hoer/i, richtig: "hör" },
  { muster: /woert/i, richtig: "wört" },
  { muster: /groess/i, richtig: "größ" },
  { muster: /stoer/i, richtig: "stör" },
  { muster: /loesch/i, richtig: "lösch" },
  { muster: /loesung/i, richtig: "lösung" },
  { muster: /schoen/i, richtig: "schön" },
  { muster: /foerder/i, richtig: "förder" },
  { muster: /fuer/i, richtig: "für" },
  { muster: /ueber/i, richtig: "über" },
  { muster: /zurueck/i, richtig: "zurück" },
  { muster: /muess/i, richtig: "müss" },
  { muster: /duerf/i, richtig: "dürf" },
  { muster: /gruen/i, richtig: "grün" },
  { muster: /pruef/i, richtig: "prüf" },
  { muster: /fuehr/i, richtig: "führ" },
  { muster: /natuerlich/i, richtig: "natürlich" },
  { muster: /schluessel/i, richtig: "schlüssel" },
  { muster: /unterstuetz/i, richtig: "unterstütz" },
  { muster: /verfueg/i, richtig: "verfüg" },
  { muster: /gueltig/i, richtig: "gültig" },
  { muster: /kuerz/i, richtig: "kürz" },
  { muster: /stueck/i, richtig: "stück" },
  { muster: /glueck/i, richtig: "glück" },
  { muster: /wuensch/i, richtig: "wünsch" },
  { muster: /drueck/i, richtig: "drück" },
  { muster: /\btuer/i, richtig: "tür" },
  /* "Grossist" ist richtig geschrieben, "gross" nicht. */
  { muster: /gross(?!ist)/i, richtig: "groß" },
  /* "Weissagung" ist richtig geschrieben, "weisst/weisse" nicht. */
  { muster: /weiss(?!ag)/i, richtig: "weiß" },
  { muster: /heisst/i, richtig: "heißt" },
  { muster: /schliess/i, richtig: "schließ" },
  { muster: /fliess/i, richtig: "fließ" },
  { muster: /geniess/i, richtig: "genieß" },
  { muster: /strasse/i, richtig: "straße" },
  { muster: /massnahme/i, richtig: "maßnahme" },
  { muster: /draussen/i, richtig: "draußen" },
  { muster: /spass/i, richtig: "spaß" },
];

function ersatzschreibungenFinden(text) {
  return ERSATZSCHREIBUNGEN.filter(({ muster }) => muster.test(text)).map(
    ({ muster, richtig }) => `${muster.source} (gemeint ist "${richtig}")`,
  );
}

/* ------------------------------------------------------------------ *
 * Die Ableitung selbst muss messbar sein
 *
 * Ohne diese beiden Prüfsätze wäre alles Folgende ein Scheinprüfsatz: Findet
 * das Einlesen keine Datei mehr, ist jede Menge leer und alle Vergleiche
 * bleiben grün, obwohl niemand mehr etwas prüft.
 * ------------------------------------------------------------------ */

test("die Ableitung liest wirklich Quelltext ein, und zwar nicht die Attrappe", () => {
  assert.ok(
    QUELLDATEIEN.length >= 5,
    `Unter src/ wurden nur ${QUELLDATEIEN.length} Quelldateien gefunden. Dann prüft hier nichts mehr.`,
  );
  const attrappen = QUELLDATEIEN.map(kurz).filter((p) => p.includes("pruefung"));
  assert.deepEqual(
    attrappen,
    [],
    "Prüfdateien dürfen nicht in die Ableitung geraten, sonst gelten die Aufrufe der Attrappe als Benutzung.",
  );
});

test("die Ableitung findet die Schnittstellen wieder, die der Code nachweislich benutzt", () => {
  /* Diese fünf stehen im Quelltext. Wären sie plötzlich nicht mehr in der
     Ableitung, hätte das Einlesen einen Fehler und nicht der Code. */
  for (const name of ["sidePanel", "scripting", "storage", "tabs", "alarms"]) {
    assert.ok(
      BENUTZT.has(name),
      `chrome.${name} steht im Quelltext, die Ableitung sieht es aber nicht. Das Einlesen ist kaputt.`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * a) Die Beschreibung muss durch den Web Store passen
 * ------------------------------------------------------------------ */

test("description ist höchstens 132 Zeichen lang, sonst nimmt der Web Store sie nicht", () => {
  assert.equal(typeof manifest.description, "string", "Ohne description gibt es keine Einreichung.");
  assert.ok(manifest.description.length > 0, "Eine leere description ist auch keine.");
  /* Gemessen wird schlicht die Länge der Zeichenkette, also in UTF-16-Einheiten,
     genau wie Chrome selbst zählt. */
  assert.ok(
    manifest.description.length <= 132,
    `description hat ${manifest.description.length} Zeichen, erlaubt sind 132. ` +
      `Der Web Store weist die Einreichung ab. Text: ${JSON.stringify(manifest.description)}`,
  );
});

/* ------------------------------------------------------------------ *
 * b) Jede benutzte Schnittstelle braucht ihr Recht
 * ------------------------------------------------------------------ */

test("jede benutzte chrome-Schnittstelle hat ihr Recht im Manifest", () => {
  const rechte = new Set(manifest.permissions || []);
  const fehlend = [];
  for (const [name, dateien] of BENUTZT) {
    if (OHNE_RECHT.has(name)) continue;
    if (!rechte.has(name)) {
      fehlend.push(`${name} (benutzt in ${[...dateien].sort().join(", ")})`);
    }
  }
  assert.deepEqual(
    fehlend,
    [],
    `Diese Schnittstellen benutzt der Quelltext, ohne dass das Recht im Manifest steht. ` +
      `Chrome wirft dann zur Laufzeit, und zwar erst beim Kunden: ${fehlend.join(" | ")}`,
  );
});

test("captureVisibleTab im Quelltext verlangt einen Weg zum Seitenrecht im Manifest", () => {
  /* Der teuerste Fehler dieses Projekts: Es gab keinen Weg zum Recht, und der
     Befehl screenshot war auf JEDER Seite tot. Die Attrappe merkt davon
     nichts, weil sie immer ein Bild liefert.

     Bis zum 15.08.2026 verlangte dieser Prüfsatz "activeTab". Die Nachabnahme
     der 0.6.0 hat gemessen, dass kein Codeweg activeTab braucht: Jede Aufnahme
     und jedes Einspielen läuft über das Seitenrecht, das die Sitzung vorher
     per chrome.permissions.request holt (net/rechte.js, gerufen aus der
     Seitenleiste). Dafür müssen die breiten Muster unter
     optional_host_permissions stehen UND der Holer im Quelltext liegen —
     eines allein nimmt keine Seite auf. "activeTab" bliebe ein gültiger
     dritter Weg, aber nur mit Begründung, siehe den Prüfsatz darunter. */
  const nutzer = [...QUELLTEXT]
    .filter(([, code]) => /chrome\.tabs\s*\.\s*captureVisibleTab/.test(code))
    .map(([pfad]) => kurz(pfad));

  assert.ok(
    nutzer.length > 0,
    "Niemand ruft mehr captureVisibleTab. Dann gehört dieser Prüfsatz gestrichen, nicht übergangen.",
  );

  const rechte = new Set(manifest.permissions || []);
  const gastgeber = new Set(manifest.host_permissions || []);
  const wahlweise = new Set(manifest.optional_host_permissions || []);
  const musterBreit =
    wahlweise.has("<all_urls>") ||
    (wahlweise.has("https://*/*") && wahlweise.has("http://*/*"));
  const holerDa = [...QUELLTEXT.values()].some((code) =>
    /chrome\.permissions\s*\.\s*request/.test(code),
  );
  assert.ok(
    rechte.has("activeTab") || gastgeber.has("<all_urls>") || (musterBreit && holerDa),
    `${nutzer.join(", ")} ruft chrome.tabs.captureVisibleTab, das Manifest bietet aber keinen ` +
      `Weg zum Seitenrecht: weder "activeTab" unter permissions noch "<all_urls>" unter ` +
      `host_permissions noch die breiten Muster unter optional_host_permissions samt ` +
      `chrome.permissions.request im Quelltext. Der Befehl screenshot scheitert damit auf jeder Seite.`,
  );
});

test("kein Recht im Manifest, das kein Quelltext benutzt", () => {
  /* Die Gegenrichtung zur Ableitung oben, Nachabnahme 0.6.0 vom 15.08.2026:
     "activeTab" stand unter permissions, und kein einziger Codeweg brauchte
     es — Bild und Einspielen laufen über das vorher erteilte Seitenrecht
     (net/rechte.js). Der Web Store verlangt im Dashboard für JEDES Recht eine
     Begründung, und für ein unbenutztes gibt es keine. Die eigene
     Least-Privilege-Linie (auf "downloads" wird ausdrücklich verzichtet)
     gilt in beide Richtungen.

     Manche Rechte tauchen nie als chrome.<name> im Quelltext auf, weil sie
     nur das Verhalten des Browsers ändern (activeTab, background, …). Wer so
     eines einträgt, trägt es HIER mit Begründung und Fundstelle ein — sonst
     schlägt der Prüfsatz an, und genau das soll er. */
  const WIRKT_OHNE_AUFRUF = new Map([
    /* derzeit leer */
  ]);
  const unbenutzt = (manifest.permissions || [])
    .filter((recht) => !WIRKT_OHNE_AUFRUF.has(recht) && !BENUTZT.has(recht))
    .sort();
  assert.deepEqual(
    unbenutzt,
    [],
    `Diese Rechte stehen im Manifest, aber kein Quelltext benutzt sie. Entweder streichen ` +
      `oder mit Begründung in die Ausnahmeliste dieses Prüfsatzes aufnehmen: ${unbenutzt.join(", ")}`,
  );
  /* Und der Beweis, dass die Messung greift: Ein untergeschobenes, unbenutztes
     Recht muss auffallen, sonst ist der Prüfsatz ein leeres Versprechen. */
  const probe = ["activeTab", ...(manifest.permissions || [])].filter(
    (recht) => !WIRKT_OHNE_AUFRUF.has(recht) && !BENUTZT.has(recht),
  );
  assert.deepEqual(probe, ["activeTab"], "die Erkennung unbenutzter Rechte greift nicht");
});

test("chrome.action und chrome.commands haben ihren Manifest-Schlüssel", () => {
  /* Diese beiden brauchen kein Recht, sondern einen eigenen Eintrag. Ohne ihn
     gibt es das Symbol nicht und die Notbremse hat keine Tastenkombination. */
  if (BENUTZT.has("action")) {
    assert.ok(manifest.action, 'chrome.action wird benutzt, "action" fehlt aber im Manifest.');
  }
  if (BENUTZT.has("commands")) {
    assert.ok(
      manifest.commands && Object.keys(manifest.commands).length > 0,
      'chrome.commands wird benutzt, "commands" ist im Manifest aber leer oder fehlt.',
    );
  }
});

/* ------------------------------------------------------------------ *
 * c) Kein Gedankenstrich in dem, was vorgelesen wird
 * ------------------------------------------------------------------ */

test("kein Gedankenstrich in den Texten, die ein Mensch zu hören bekommt", () => {
  const treffer = menschentexte()
    .filter(({ text }) => GEDANKENSTRICH.test(text) || BINDESTRICH_FREISTEHEND.test(text))
    .map(({ ort, text }) => `${ort}: ${JSON.stringify(text)}`);
  assert.deepEqual(
    treffer,
    [],
    `Die Sprachausgabe spricht einen Gedankenstrich als Wort aus. Bitte durch ein Komma ` +
      `ersetzen: ${treffer.join(" | ")}`,
  );
});

test("die Erkennung des Gedankenstrichs greift wirklich", () => {
  /* Sonst wäre der Prüfsatz darüber ein leeres Versprechen. */
  assert.ok(GEDANKENSTRICH.test("SMarTrChrome — Niemand öffnen"), "Geviert wird nicht erkannt.");
  assert.ok(GEDANKENSTRICH.test("Notbremse – sofort beenden"), "Halbgeviert wird nicht erkannt.");
  assert.ok(BINDESTRICH_FREISTEHEND.test("Notbremse - sofort beenden"), "Freistehender Bindestrich wird nicht erkannt.");
  /* Ein Bindestrich IM Wort ist erlaubt und darf nicht anschlagen. */
  assert.equal(GEDANKENSTRICH.test("Web-Store"), false);
  assert.equal(BINDESTRICH_FREISTEHEND.test("Web-Store"), false);
});

/* ------------------------------------------------------------------ *
 * d) Echte Umlaute statt Ersatzschreibungen
 * ------------------------------------------------------------------ */

test("echte Umlaute in den Texten, die ein Mensch zu sehen bekommt", () => {
  const treffer = [];
  for (const { ort, text } of menschentexte()) {
    for (const grund of ersatzschreibungenFinden(text)) {
      treffer.push(`${ort}: ${grund} in ${JSON.stringify(text)}`);
    }
  }
  assert.deepEqual(
    treffer,
    [],
    `Ersatzschreibungen gehören nicht in Kundentexte, sie werden auch falsch vorgelesen: ${treffer.join(" | ")}`,
  );
});

test("die Erkennung der Ersatzschreibungen trifft die richtigen und verschont harmlose Wörter", () => {
  /* Erst der Beweis, dass sie überhaupt etwas fängt, sonst wäre der Prüfsatz
     darüber wertlos. Genau diese Wörter standen in der alten Beschreibung. */
  for (const wort of ["waehlt", "Passwoerter", "ueber", "zurueck", "gross", "schliessen"]) {
    assert.ok(
      ersatzschreibungenFinden(wort).length > 0,
      `"${wort}" ist eine Ersatzschreibung und wird nicht erkannt.`,
    );
  }
  /* Und dann der Beweis, dass sie nicht bei jedem harmlosen Wort anschlägt.
     Eine Erkennung mit Fehlmeldungen wird nach dem ersten Ärger abgeschaltet
     und schützt danach gar nichts mehr. */
  const harmlos = [
    "Baum", "Feuer", "Steuer", "Abenteuer", "Neuerung", "Sauerstoff",
    "Klasse", "Adresse", "Passage", "Muster", "Browser", "Beta",
    "Fussel", "Weissagung", "Grossist", "Aussendung", "Maus",
    "SMarTrChrome Beta", "Niemand öffnen", "Agentensitzung sofort beenden",
  ];
  for (const wort of harmlos) {
    assert.deepEqual(
      ersatzschreibungenFinden(wort),
      [],
      `"${wort}" ist richtig geschrieben und darf nicht anschlagen.`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * e) Alle genannten Dateien gibt es auch
 * ------------------------------------------------------------------ */

/** Jeder Wert im Manifest, der wie ein Dateiname aussieht, mit seinem Ort. */
function dateiangaben() {
  const gefunden = [];
  const gehe = (wert, ort) => {
    if (typeof wert === "string") {
      /* Adressen und Musterangaben sind keine Dateien. */
      if (/^(https?:|chrome-extension:|<|\*)/.test(wert)) return;
      if (/\.(png|jpg|jpeg|gif|svg|html|js|css|json|woff2?)$/i.test(wert)) {
        gefunden.push({ ort, wert });
      }
      return;
    }
    if (Array.isArray(wert)) {
      wert.forEach((eintrag, nr) => gehe(eintrag, `${ort}[${nr}]`));
      return;
    }
    if (wert && typeof wert === "object") {
      for (const [schluessel, eintrag] of Object.entries(wert)) {
        gehe(eintrag, ort ? `${ort}.${schluessel}` : schluessel);
      }
    }
  };
  gehe(manifest, "");
  return gefunden;
}

test("jede im Manifest genannte Datei liegt auch wirklich im Paket", async () => {
  const angaben = dateiangaben();
  /* Ohne diesen Halt bliebe der Prüfsatz grün, wenn die Suche nichts mehr
     findet, also genau dann, wenn sie kaputt ist. */
  assert.ok(
    angaben.length >= 5,
    `Im Manifest wurden nur ${angaben.length} Dateiangaben gefunden. Die Suche stimmt nicht mehr.`,
  );

  const fehlend = [];
  for (const { ort, wert } of angaben) {
    try {
      const angabe = await stat(join(WURZEL, wert));
      if (!angabe.isFile()) fehlend.push(`${ort}: ${wert} (ist keine Datei)`);
      else if (angabe.size === 0) fehlend.push(`${ort}: ${wert} (ist leer)`);
    } catch {
      fehlend.push(`${ort}: ${wert} (fehlt)`);
    }
  }
  assert.deepEqual(
    fehlend,
    [],
    `Chrome verweigert das Laden der Erweiterung, wenn eine genannte Datei fehlt: ${fehlend.join(" | ")}`,
  );
});

test("die Angaben, auf die es beim Laden ankommt, stehen überhaupt im Manifest", () => {
  /* Der Prüfsatz darüber sagt nur, dass genannte Dateien existieren. Fiele der
     Eintrag ganz weg, hätte er nichts zu prüfen und bliebe grün. */
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.background && manifest.background.service_worker, "background.service_worker fehlt.");
  assert.ok(manifest.side_panel && manifest.side_panel.default_path, "side_panel.default_path fehlt.");
  for (const groesse of ["16", "48", "128"]) {
    assert.ok(manifest.icons && manifest.icons[groesse], `Symbol ${groesse} fehlt unter icons.`);
  }
});
