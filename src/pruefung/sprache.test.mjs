/*
 * Prüfung der Zweisprachigkeit (Vertrag v3.5 §12).
 *
 * WARUM es diese Datei gibt, und warum sie so misst, wie sie misst:
 *
 * `chrome.i18n.getMessage` gibt für einen unbekannten Schlüssel die LEERE
 * Zeichenkette zurück. Nicht `undefined`, nicht eine Ausnahme, nichts, was
 * irgendwo aufschlüge. Eine Lücke im Katalog ist deshalb im Betrieb eine leere
 * Stelle auf dem Bildschirm, und für jemanden, der sich die Seitenleiste
 * vorlesen lässt, ist sie schlicht Stille. Diese Lücke MUSS ein Prüfsatz
 * finden, nicht der Kunde.
 *
 * Gemessen wird deshalb gegen die Wirklichkeit auf der Platte, nicht gegen
 * eine eingetippte Liste: die beiden Kataloge unter `_locales` gegen den
 * echten Quelltext der Oberfläche und gegen das echte `manifest.json`. Kommt
 * morgen ein Satz dazu und sein Schlüssel fehlt, schlägt das hier von allein
 * an, ohne dass jemand daran denken muss. Eine fest eingetippte Sollmenge wäre
 * genau der Prüfsatz, der beim nächsten Umbau still grün bleibt.
 *
 * Der zweite Parameter von `t(schluessel, notfall, …)` ist die deutsche
 * Fassung im Quelltext. Er ist der Notfalltext, falls der Katalog schweigt,
 * und zugleich die Stelle, an der ein Mensch den Satz redigiert. Damit die
 * beiden nicht auseinanderlaufen, hält Prüfsatz L4 jeden Notfalltext wörtlich
 * gegen `_locales/de/messages.json`.
 *
 * Ausdrücklich NICHT gemessen wird hier, was an den Agenten geht
 * (`net/ausfuehrer.js`, `net/befehle.js`). Das ist Protokolltext, kein
 * Oberflächentext, und 372 Prüfsätze messen ihn wörtlich (Vertrag §12,
 * ausdrückliche Grenze).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

/* Der Weg zur Wurzel geht über die eigene Dateilage und nicht über das
   Arbeitsverzeichnis: Nur so misst eine KOPIE des Baums ihre eigene Kopie. */
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SPRACHEN = ["de", "en"];

/** Jede Oberflächendatei, in der ein Katalogschlüssel stehen darf. */
const OBERFLAECHE_JS = [
  "src/panel/sprache.js",
  "src/panel/panel.js",
  "src/panel/erklaerungen.js",
  "src/panel/startseite.js",
  "src/panel/werkbank.js",
  "src/content/overlay.js",
  /* Befund M10 vom 14.08.2026: `net/link.js` fehlte in dieser Liste. Der
     Symboltitel und die Systemmeldung aus §8.4 standen darin als deutsche
     Literale, und 733 grüne Prüfsätze haben es nicht bemerkt, weil niemand
     hinsah. Die Datei ist nur zum Teil Oberfläche, siehe `PROTOKOLLRUFE`. */
  "src/net/link.js",
];

/*
 * Dateien, die KEINE Oberfläche sind, aber trotzdem Katalogtext tragen.
 *
 * Befund vom 14.08.2026, und er ist derselbe wie M10, nur eine Datei weiter:
 * `net/ausfuehrer.js` ruft `katalog(schluessel, rueckfall)` für die zwei
 * Systemmeldungen, die den abwesenden Menschen erreichen — den Ruf nach einer
 * Freigabe und die Meldung über die angehaltene Automatik. Beide Schlüssel
 * standen in keinem Katalog, und 929 grüne Prüfsätze haben es nicht bemerkt,
 * weil die Datei in keiner Liste stand. In der englischen Oberfläche wäre
 * dort deutscher Text erschienen.
 *
 * Warum eine EIGENE Liste und nicht einfach ein Eintrag oben: `ausfuehrer.js`
 * ist voll von `absage("code", "Satz für den Agenten")`, und die Sätze bleiben
 * nach §12 ausdrücklich deutsch. Der allgemeine Abtaster würde sie alle für
 * Katalogschlüssel halten. Hier zählt deshalb nur, was wirklich durch den
 * Katalog geht: der benannte Ruf `katalog(`.
 */
const NUR_KATALOGRUFE = ["src/net/ausfuehrer.js"];

/** `katalog("schluessel", "Notfalltext")` — der benannte Weg in den Katalog. */
function katalogRufeAusJs(rohquelle) {
  const quelle = ohneKommentare(rohquelle);
  const gefunden = [];
  const muster = /\bkatalog\(\s*"([a-z][a-z0-9_]*)"\s*,/g;
  let treffer;
  while ((treffer = muster.exec(quelle)) !== null) {
    const text = literalLesen(quelle, treffer.index + treffer[0].length);
    gefunden.push({ schluessel: treffer[1], text });
  }
  return gefunden;
}

const OBERFLAECHE_HTML = ["src/panel/panel.html"];

const KATALOG = new Map();
for (const sprache of SPRACHEN) {
  KATALOG.set(
    sprache,
    JSON.parse(await readFile(join(WURZEL, "_locales", sprache, "messages.json"), "utf8")),
  );
}
const MANIFEST = JSON.parse(await readFile(join(WURZEL, "manifest.json"), "utf8"));

const QUELLE = new Map();
for (const pfad of [...OBERFLAECHE_JS, ...NUR_KATALOGRUFE, ...OBERFLAECHE_HTML]) {
  QUELLE.set(pfad, await readFile(join(WURZEL, pfad), "utf8"));
}

/* ------------------------------------------------------------------ *
 * Die Ableitung: Schlüssel und deutsche Fassung aus dem Quelltext
 * ------------------------------------------------------------------ */

/* Ein Schlüssel nach §12, und zwar mit mindestens einem Unterstrich: Das ist
   das Bereichspräfix, und ohne diese Forderung hielte die Ableitung jedes
   gewöhnliche Wort in einer Aufzählung für einen Schlüssel. */
const SCHLUESSELFORM = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/**
 * Kommentare entfernen, Zeichenketten aber unangetastet lassen.
 *
 * Ohne diesen Schritt liest die Ableitung Wörter aus Fließtext mit: In
 * `content/overlay.js` steht in einem Kommentar die Aufzählung
 * `"areaCode", "promo_code", …`, und die sah wie ein Katalogpaar aus. Ein
 * einfaches Streichen aller Blockkommentare wäre gefährlich, weil deren
 * Anfangszeichen auch in Adressmustern vorkommt; deshalb läuft hier ein
 * kleiner Abtaster, der weiß, ob er gerade in einer Zeichenkette steht.
 */
function ohneKommentare(quelle) {
  let raus = "";
  let i = 0;
  let inZeichenkette = null;
  while (i < quelle.length) {
    const z = quelle[i];
    const naechstes = quelle[i + 1];
    if (inZeichenkette) {
      raus += z;
      if (z === "\\") { raus += naechstes ?? ""; i += 2; continue; }
      if (z === inZeichenkette) inZeichenkette = null;
      i += 1;
      continue;
    }
    if (z === '"' || z === "'" || z === "`") { inZeichenkette = z; raus += z; i += 1; continue; }
    if (z === "/" && naechstes === "/") {
      while (i < quelle.length && quelle[i] !== "\n") i += 1;
      continue;
    }
    if (z === "/" && naechstes === "*") {
      i += 2;
      while (i < quelle.length && !(quelle[i] === "*" && quelle[i + 1] === "/")) i += 1;
      i += 2;
      raus += " ";
      continue;
    }
    raus += z;
    i += 1;
  }
  return raus;
}

/** Ein Zeichenkettenliteral ab `von` lesen, `+`-Ketten eingeschlossen. */
function literalLesen(text, von) {
  let i = von;
  let ergebnis = "";
  let gelesen = false;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    const anfuehrung = text[i];
    if (anfuehrung !== '"' && anfuehrung !== "'") break;
    i += 1;
    while (i < text.length) {
      const z = text[i];
      if (z === "\\") {
        const naechstes = text[i + 1];
        ergebnis += naechstes === "n" ? "\n" : naechstes === "t" ? "\t" : naechstes;
        i += 2;
        continue;
      }
      if (z === anfuehrung) { i += 1; break; }
      ergebnis += z;
      i += 1;
    }
    gelesen = true;
    let j = i;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    if (text[j] === "+") { i = j + 1; continue; }
    break;
  }
  return gelesen ? ergebnis : null;
}

/**
 * Alle Paare `"schluessel", "deutsche Fassung"` aus einer Quelldatei.
 *
 * Das ist keine Bequemlichkeit, sondern die Form, die dieser Bestand überall
 * benutzt: `t("k", "Text")`, `spr("k", "Text")`, `beschriften(el, "k", "Text")`,
 * `sagen("k", "Text")`, `knopfBauen(neu, "klasse", "k", "Text", …)` und die
 * Merkmalstabelle in panel.js. In jedem dieser Fälle folgt auf den Schlüssel
 * unmittelbar sein deutscher Satz.
 */
/*
 * Die Rufe, deren erster Wert ein Code für die Maschine ist, kein Schlüssel.
 *
 * `absage(` steht seit dem Bestand hier (werkbank.js). Am 14.08.2026 kamen
 * `absageRahmen(` und `new NetzFehler(` aus `net/link.js` dazu: Beide tragen
 * einen Fehlercode und den deutschen Protokollsatz, der laut §12 deutsch
 * bleibt, weil 372 Prüfsätze ihn woertlich messen.
 */
const PROTOKOLLRUFE = [
  /absage\(\s*$/,
  /absageRahmen\(\s*[A-Za-z_$][\w$]*\s*,\s*$/,
  /new\s+NetzFehler\(\s*$/,
];

function paareAusJs(rohquelle) {
  const quelle = ohneKommentare(rohquelle);
  const gefunden = [];
  const muster = /"([a-z][a-z0-9_]*)"\s*,/g;
  let treffer;
  while ((treffer = muster.exec(quelle)) !== null) {
    const schluessel = treffer[1];
    if (!SCHLUESSELFORM.test(schluessel)) continue;
    /* Nicht jedes Paar `"wort", "Satz"` ist ein Katalogeintrag. Diese Rufe
       tragen einen MASCHINENCODE an erster Stelle und einen Satz, der nach
       §12 ausdrücklich deutsch bleibt, weil er an den Agenten geht und nicht
       an einen Menschen. Stünden sie hier drin, würde L2 rot an genau den
       Sätzen, die niemand übersetzen darf. */
    const davor = quelle.slice(Math.max(0, treffer.index - 60), treffer.index);
    if (PROTOKOLLRUFE.some((form) => form.test(davor))) continue;
    const text = literalLesen(quelle, treffer.index + treffer[0].length);
    if (text === null) continue;
    gefunden.push({ schluessel, text });
  }
  return gefunden;
}

/**
 * Alle `data-i18n`-Schlüssel samt sichtbarem Text aus dem HTML.
 *
 * Gelesen wird der letzte Textknoten mit Inhalt, weil `textSetzen` in
 * `panel/sprache.js` genau den ersetzt. Wären es zwei verschiedene Regeln,
 * behauptete dieser Prüfsatz eine Übereinstimmung, die es im Betrieb nicht
 * gibt.
 */
function paareAusHtml(html) {
  const gefunden = [];
  const muster = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>/g;
  let treffer;
  while ((treffer = muster.exec(html)) !== null) {
    const [ganz, tag, schluessel] = treffer;
    const ende = html.indexOf(`</${tag}>`, treffer.index + ganz.length);
    const innen = ende < 0 ? "" : html.slice(treffer.index + ganz.length, ende);
    const stuecke = innen
      .split(/<[^>]*>/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    gefunden.push({ schluessel, text: stuecke.length ? stuecke[stuecke.length - 1] : "" });
  }
  return gefunden;
}

/** Alle Schlüssel aus `data-i18n-attr="merkmal:schluessel,…"`. */
function merkmalsSchluessel(quelle) {
  const gefunden = [];
  for (const treffer of ohneKommentare(quelle).matchAll(/data-i18n-attr"?,?\s*"?([a-z-]+:[a-z0-9_]+(?:,[a-z-]+:[a-z0-9_]+)*)"/g)) {
    for (const stueck of treffer[1].split(",")) {
      const teil = stueck.split(":")[1];
      if (teil) gefunden.push(teil.trim());
    }
  }
  return gefunden;
}

/** Alle `__MSG_…__`-Verweise aus dem Manifest. */
function manifestSchluessel() {
  const gefunden = [];
  const gehe = (wert) => {
    if (typeof wert === "string") {
      for (const treffer of wert.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) gefunden.push(treffer[1]);
      return;
    }
    if (Array.isArray(wert)) return wert.forEach(gehe);
    if (wert && typeof wert === "object") Object.values(wert).forEach(gehe);
  };
  gehe(MANIFEST);
  return gefunden;
}

/** schluessel -> { texte: Set<string>, orte: Set<string> } */
function verwendungen() {
  const alle = new Map();
  const nimm = (schluessel, text, ort) => {
    if (!alle.has(schluessel)) alle.set(schluessel, { texte: new Set(), orte: new Set() });
    const eintrag = alle.get(schluessel);
    eintrag.orte.add(ort);
    /* Ein leerer Text ist keine Aussage über den Wortlaut: In panel.html gibt
       es Elemente, die ihren Schlüssel tragen und ihren Inhalt erst vom
       Quelltext bekommen (#modus-auskunft, #modus-riegel). */
    if (typeof text === "string" && text !== "") eintrag.texte.add(text);
  };
  for (const pfad of OBERFLAECHE_JS) {
    const quelle = QUELLE.get(pfad);
    for (const p of paareAusJs(quelle)) nimm(p.schluessel, p.text, pfad);
    for (const s of merkmalsSchluessel(quelle)) nimm(s, null, pfad);
  }
  for (const pfad of NUR_KATALOGRUFE) {
    for (const p of katalogRufeAusJs(QUELLE.get(pfad))) nimm(p.schluessel, p.text, pfad);
  }
  for (const pfad of OBERFLAECHE_HTML) {
    for (const p of paareAusHtml(QUELLE.get(pfad))) nimm(p.schluessel, p.text, pfad);
  }
  for (const s of manifestSchluessel()) nimm(s, null, "manifest.json");
  return alle;
}

const VERWENDET = verwendungen();

/* ------------------------------------------------------------------ *
 * L0 — Die Ableitung selbst muss messbar sein
 *
 * Ohne diese beiden bliebe alles Folgende grün, sobald das Einlesen kaputt
 * ist: Eine leere Menge besteht jeden Vergleich.
 * ------------------------------------------------------------------ */

test("L0a — Die Ableitung liest wirklich Quelltext und findet die bekannten Bauformen wieder", () => {
  assert.ok(VERWENDET.size >= 200, `nur ${VERWENDET.size} Schlüssel gefunden, das kann nicht stimmen`);
  /* Je eine Stelle aus jeder Bauform, die die Ableitung beherrschen muss. */
  for (const [schluessel, wo] of [
    ["kopf_verbinden_tab", "src/panel/panel.html"],      // data-i18n im HTML
    ["sperre_cloud_titel", "src/panel/erklaerungen.js"], // t(...) mit Notfalltext
    ["start_verbinden", "src/panel/startseite.js"],      // beschriften(el, k, text)
    ["werkbank_loeschen", "src/panel/werkbank.js"],      // knopfBauen(...)
    ["overlay_notaus", "src/content/overlay.js"],        // spr(...) im Inhaltsskript
    ["kopf_menue", "src/panel/panel.js"],                // Merkmalstabelle
    ["ext_beschreibung", "manifest.json"],               // __MSG_…__
  ]) {
    assert.ok(VERWENDET.has(schluessel), `„${schluessel}" wird nicht gefunden, die Ableitung ist kaputt`);
    assert.ok(
      VERWENDET.get(schluessel).orte.has(wo),
      `„${schluessel}" wird nicht in ${wo} gefunden, sondern in ${[...VERWENDET.get(schluessel).orte].join(", ")}`,
    );
  }
});

test("L0b — Die Ableitung liest KEINE Wörter aus Kommentaren mit", () => {
  /* Der belegte Fall: In content/overlay.js steht die Aufzählung
     `"areaCode", "promo_code", "gutscheincode"` in einem Kommentar über die
     Erkennung von Geheimfeldern. Ohne den Abtaster stand „promo_code" als
     Katalogschlüssel im Bericht und fehlte dann im englischen Katalog. */
  assert.equal(VERWENDET.has("promo_code"), false, "ein Wort aus einem Kommentar gilt als Schlüssel");
  const probe = paareAusJs('/* "falsch_positiv", "Text aus dem Kommentar" */\nt("echt_positiv", "Text");');
  assert.deepEqual(
    probe.map((p) => p.schluessel),
    ["echt_positiv"],
    "der Abtaster für Kommentare greift nicht",
  );
});

/* ------------------------------------------------------------------ *
 * L1 — Beide Kataloge, ein Schlüsselsatz
 * ------------------------------------------------------------------ */

test("L1 — Deutsch und Englisch haben denselben Schlüsselsatz, in beide Richtungen", () => {
  const de = new Set(Object.keys(KATALOG.get("de")));
  const en = new Set(Object.keys(KATALOG.get("en")));
  assert.ok(de.size >= 200, `der deutsche Katalog hat nur ${de.size} Einträge`);

  const fehltEn = [...de].filter((k) => !en.has(k)).sort();
  const fehltDe = [...en].filter((k) => !de.has(k)).sort();
  assert.deepEqual(
    fehltEn,
    [],
    `Diese Schlüssel fehlen im Englischen. Chrome zeigt dort eine LEERE Stelle, keinen Fehler: ${fehltEn.join(", ")}`,
  );
  assert.deepEqual(
    fehltDe,
    [],
    `Diese Schlüssel fehlen im Deutschen, also im default_locale: ${fehltDe.join(", ")}`,
  );
});

test("L1b — Kein Eintrag ist leer, und jeder Schlüssel folgt der Form aus §12", () => {
  for (const sprache of SPRACHEN) {
    const katalog = KATALOG.get(sprache);
    for (const [schluessel, eintrag] of Object.entries(katalog)) {
      assert.match(schluessel, /^[a-z][a-z0-9_]*$/, `${sprache}: „${schluessel}" folgt nicht §12`);
      assert.equal(
        typeof (eintrag && eintrag.message),
        "string",
        `${sprache}/${schluessel}: kein Feld „message"`,
      );
      assert.ok(
        eintrag.message.trim().length > 0,
        `${sprache}/${schluessel}: leerer Text ist dasselbe wie ein fehlender Schlüssel`,
      );
    }
  }
});

test("L1c — Die Platzhalter stimmen zwischen den Sprachen überein", () => {
  /* Ein `$1`, das in der Übersetzung fehlt, verschluckt eine Zahl oder einen
     Namen, den der Satz verspricht. Die REIHENFOLGE darf sich unterscheiden,
     denn der Satzbau tut es auch; die Menge darf es nicht. */
  const de = KATALOG.get("de");
  const en = KATALOG.get("en");
  const platzhalter = (s) => [...new Set([...s.matchAll(/\$(\d)/g)].map((t) => t[1]))].sort();
  const abweichung = [];
  for (const schluessel of Object.keys(de)) {
    const a = platzhalter(de[schluessel].message);
    const b = platzhalter(en[schluessel].message);
    if (a.join() !== b.join()) abweichung.push(`${schluessel}: de=${a.join()} en=${b.join()}`);
  }
  assert.deepEqual(abweichung, [], `Platzhalter laufen auseinander: ${abweichung.join(" | ")}`);
});

/* ------------------------------------------------------------------ *
 * L2/L3 — Kein Schlüssel ohne Verwendung, keine Verwendung ohne Schlüssel
 * ------------------------------------------------------------------ */

test("L2 — Jede Verwendung im Quelltext hat einen Schlüssel im Katalog", () => {
  const de = KATALOG.get("de");
  const fehlend = [...VERWENDET.entries()]
    .filter(([schluessel]) => !Object.hasOwn(de, schluessel))
    .map(([schluessel, eintrag]) => `${schluessel} (${[...eintrag.orte].join(", ")})`)
    .sort();
  assert.deepEqual(
    fehlend,
    [],
    `Diese Schlüssel benutzt die Oberfläche, im Katalog stehen sie nicht. In Chrome ist das ` +
      `eine leere Stelle und kein Fehler: ${fehlend.join(" | ")}`,
  );
});

test("L3 — Jeder Schlüssel im Katalog wird auch wirklich benutzt", () => {
  const unbenutzt = Object.keys(KATALOG.get("de"))
    .filter((schluessel) => !VERWENDET.has(schluessel))
    .sort();
  assert.deepEqual(
    unbenutzt,
    [],
    `Diese Schlüssel stehen im Katalog, ruft aber niemand. Sie sind entweder tot oder ihre ` +
      `Verwendung ist beim Umbau verlorengegangen: ${unbenutzt.join(", ")}`,
  );
});

test("L4 — Der Notfalltext im Quelltext ist wortgleich mit dem deutschen Katalog", () => {
  /* Der Notfalltext ist die Fassung, die ein Mensch redigiert, und die
     Fassung, die im Betrieb erscheint, wenn der Katalog schweigt. Laufen die
     beiden auseinander, zeigt dieselbe Erweiterung je nach Lage zwei
     verschiedene Sätze, und niemand merkt, welcher gerade gilt. */
  const de = KATALOG.get("de");
  const abweichung = [];
  for (const [schluessel, eintrag] of VERWENDET) {
    if (!Object.hasOwn(de, schluessel)) continue;
    for (const text of eintrag.texte) {
      if (text !== de[schluessel].message) {
        abweichung.push(
          `${schluessel} (${[...eintrag.orte].join(", ")}):\n  Quelltext: ${JSON.stringify(text)}\n  Katalog:   ${JSON.stringify(de[schluessel].message)}`,
        );
      }
    }
  }
  assert.deepEqual(abweichung, [], `Quelltext und Katalog sagen Verschiedenes:\n${abweichung.join("\n")}`);
});

/* ------------------------------------------------------------------ *
 * L5 — Deutsch mit echten Umlauten, und ohne Gedankenstriche
 *
 * Diese beiden Zusagen standen bisher in manifest.test.mjs und galten dort für
 * Name, Beschreibung, Symboltitel und Tastenkürzel. Seit die vier über
 * `__MSG_…__` laufen, misst jener Prüfsatz nur noch Platzhalter. Die Zusage
 * wandert deshalb hierher, und zwar für den ganzen Katalog statt für vier
 * Zeilen.
 * ------------------------------------------------------------------ */

const GEDANKENSTRICH = /[‐‑‒–—―−]/;
const BINDESTRICH_FREISTEHEND = /\s-\s/;

/* Wortstämme, die in richtig geschriebenem Deutsch nicht vorkommen. Kein
   Muster auf blankes „ae/oe/ue/ss": Das schlüge bei „Baum", „Feuer" und
   „Klasse" an und wäre nach der ersten Fehlmeldung abgeschaltet. */
const ERSATZSCHREIBUNGEN = [
  [/waehl/i, "wähl"], [/aender/i, "änder"], [/naechst/i, "nächst"],
  [/spaeter/i, "später"], [/erklaer/i, "erklär"], [/bestaetig/i, "bestätig"],
  [/zaehl/i, "zähl"], [/faell/i, "fäll"], [/laeuf/i, "läuf"], [/laess/i, "läss"],
  [/haeng/i, "häng"], [/oeffn/i, "öffn"], [/koenn/i, "könn"], [/moecht/i, "möcht"],
  [/hoer/i, "hör"], [/groess/i, "größ"], [/stoer/i, "stör"], [/loesch/i, "lösch"],
  [/schoen/i, "schön"], [/fuer/i, "für"], [/ueber/i, "über"], [/zurueck/i, "zurück"],
  [/muess/i, "müss"], [/duerf/i, "dürf"], [/gruen/i, "grün"], [/pruef/i, "prüf"],
  [/fuehr/i, "führ"], [/schluessel/i, "schlüssel"], [/gueltig/i, "gültig"],
  [/kuerz/i, "kürz"], [/stueck/i, "stück"], [/wuensch/i, "wünsch"],
  [/drueck/i, "drück"], [/ablaeuf/i, "abläuf"], [/eintraeg/i, "einträg"],
  [/rueckfrage/i, "rückfrage"], [/hinzufueg/i, "hinzufüg"],
  [/gross(?!ist)/i, "groß"], [/weiss(?!ag)/i, "weiß"], [/heisst/i, "heißt"],
  [/schliess/i, "schließ"], [/liess/i, "ließ"], [/strasse/i, "straße"],
];

test("L5a — Der deutsche Katalog schreibt echte Umlaute", () => {
  const treffer = [];
  for (const [schluessel, eintrag] of Object.entries(KATALOG.get("de"))) {
    for (const [muster, richtig] of ERSATZSCHREIBUNGEN) {
      if (muster.test(eintrag.message)) {
        treffer.push(`${schluessel}: ${muster.source} (gemeint ist „${richtig}") in ${JSON.stringify(eintrag.message)}`);
      }
    }
  }
  assert.deepEqual(
    treffer,
    [],
    `Ersatzschreibungen gehören nicht in Kundentexte, sie werden auch falsch vorgelesen: ${treffer.join(" | ")}`,
  );
});

test("L5b — Die Erkennung der Ersatzschreibungen greift wirklich", () => {
  /* Sonst wäre L5a ein leeres Versprechen. */
  const finde = (wort) => ERSATZSCHREIBUNGEN.filter(([m]) => m.test(wort)).length;
  for (const wort of ["waehlt", "ueber", "zurueck", "Ablaeufe", "gross", "schliessen"]) {
    assert.ok(finde(wort) > 0, `„${wort}" ist eine Ersatzschreibung und wird nicht erkannt`);
  }
  /* Und sie darf harmlose Wörter nicht anfassen, sonst wird sie abgeschaltet
     und schützt danach gar nichts mehr. */
  for (const wort of ["Baum", "Feuer", "Steuer", "Klasse", "Adresse", "Browser", "Maus", "Weissagung", "Grossist"]) {
    assert.equal(finde(wort), 0, `„${wort}" ist richtig geschrieben und darf nicht anschlagen`);
  }
});

test("L5c — Kein Gedankenstrich in einem Text, der vorgelesen wird", () => {
  /* Der Inhaber lässt sich die Oberfläche vorlesen, und die Sprachausgabe
     spricht diese Zeichen als Wort oder als Pause, die den Satz zerreißt. */
  const treffer = [];
  for (const sprache of SPRACHEN) {
    for (const [schluessel, eintrag] of Object.entries(KATALOG.get(sprache))) {
      if (GEDANKENSTRICH.test(eintrag.message) || BINDESTRICH_FREISTEHEND.test(eintrag.message)) {
        treffer.push(`${sprache}/${schluessel}: ${JSON.stringify(eintrag.message)}`);
      }
    }
  }
  assert.deepEqual(treffer, [], `Bitte Kommas statt Gedankenstrichen: ${treffer.join(" | ")}`);
});

/* ------------------------------------------------------------------ *
 * L6 — Das Manifest
 * ------------------------------------------------------------------ */

test("L6a — Das Manifest hat default_locale und holt Name und Beschreibung aus dem Katalog", () => {
  assert.equal(MANIFEST.default_locale, "de", "ohne default_locale lädt Chrome die Erweiterung mit _locales gar nicht");
  assert.match(MANIFEST.name, /^__MSG_[a-z0-9_]+__$/, "der Name kommt aus dem Katalog");
  assert.match(MANIFEST.description, /^__MSG_[a-z0-9_]+__$/, "die Beschreibung kommt aus dem Katalog");
  /* Und die vier Texte, die ein Mensch am Symbol und im Store liest, sind
     wirklich alle übersetzt. Ein einzelner vergessener Eintrag stünde beim
     englischen Kunden auf Deutsch da. */
  for (const [ort, wert] of [
    ["action.default_title", MANIFEST.action && MANIFEST.action.default_title],
    ["commands.notbremse.description", MANIFEST.commands && MANIFEST.commands.notbremse && MANIFEST.commands.notbremse.description],
  ]) {
    assert.match(String(wert), /^__MSG_[a-z0-9_]+__$/, `${ort} steht noch fest in einer Sprache da`);
  }
});

test("L6b — Die Beschreibung bleibt in JEDER Sprache unter 132 Zeichen", () => {
  /* Der Web Store nimmt höchstens 132 (developer.chrome.com/docs/extensions/
     reference/manifest/description). Bis 0.5.x maß das manifest.test.mjs am
     Manifest selbst; dort steht jetzt nur noch der Platzhalter, also muss die
     Zusage hier am Katalog hängen. Sonst scheitert die Einreichung erst beim
     Hochladen der englischen Fassung. */
  const schluessel = MANIFEST.description.replace(/^__MSG_|__$/g, "");
  for (const sprache of SPRACHEN) {
    const text = KATALOG.get(sprache)[schluessel].message;
    assert.ok(
      text.length <= 132,
      `${sprache}: description hat ${text.length} Zeichen, erlaubt sind 132. Text: ${JSON.stringify(text)}`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * L7 — Die Sprachschicht arbeitet, und die Oberfläche benutzt sie
 * ------------------------------------------------------------------ */

test("L7a — t() nimmt den Katalog, wenn er antwortet, und den Notfalltext, wenn er schweigt", async () => {
  attrappeSetzen({ katalog: { kopf_stopp: "Stop", zeit_minuten: "$1 minutes" } });
  const { t } = await import("../panel/sprache.js");

  assert.equal(t("kopf_stopp", "Stopp"), "Stop", "der Katalog gewinnt");
  assert.equal(t("zeit_minuten", "$1 Minuten", 7), "7 minutes", "und füllt seine Platzhalter");
  /* Der ganze Punkt der Sache: Ein fehlender Schlüssel darf keine leere
     Stelle werden. Chrome liefert dafür "" und keinen Fehler. */
  assert.equal(t("gibt_es_nicht", "Ersatztext"), "Ersatztext");
  assert.equal(t("gibt_es_nicht", "Noch $1 Minuten", 3), "Noch 3 Minuten");
  assert.equal(t("gibt_es_nicht", ""), "", "und wirft auch bei leerem Notfall nicht");
});

test("L7b — textEinsetzen ersetzt Text und Merkmale, ohne Kindelemente wegzuwerfen", async () => {
  attrappeSetzen({
    katalog: {
      kopf_stopp: "Stop",
      werkbank_oeffnen: "Rules and workflows …",
      werkbank_json_feld: "JSON of the workflows",
    },
  });
  const { textEinsetzen } = await import("../panel/sprache.js");

  /* Eine kleine Nachbildung, die genau das kann, worauf es hier ankommt:
     Kindknoten, Textknoten und Merkmale. Ein ganzes DOM wäre hier mehr
     Attrappe als Prüfung. */
  const bauen = (tag) => ({
    tagName: tag.toUpperCase(),
    merkmale: new Map(),
    childNodes: [],
    getAttribute(n) { return this.merkmale.has(n) ? this.merkmale.get(n) : null; },
    setAttribute(n, w) { this.merkmale.set(n, w); },
    set textContent(w) { this.childNodes = [{ nodeType: 3, nodeValue: w }]; },
    get textContent() { return this.childNodes.map((k) => k.nodeValue ?? "").join(""); },
  });
  const text = (w) => ({ nodeType: 3, nodeValue: w });

  const knopf = bauen("button");
  knopf.setAttribute("data-i18n", "werkbank_oeffnen");
  const haken = bauen("span");
  knopf.childNodes = [text("\n  "), haken, text(" Regeln und Abläufe …\n")];

  const feld = bauen("textarea");
  feld.setAttribute("aria-label", "JSON der Abläufe");
  feld.setAttribute("data-i18n-attr", "aria-label:werkbank_json_feld");

  const ohneEintrag = bauen("button");
  ohneEintrag.setAttribute("data-i18n", "gibt_es_nicht");
  ohneEintrag.childNodes = [text("Bleibt stehen")];

  const alle = [knopf, feld, ohneEintrag];
  const wurzel = {
    querySelectorAll(sel) {
      const merkmal = sel.slice(1, -1);
      return alle.filter((el) => el.getAttribute(merkmal) !== null);
    },
  };

  const bilanz = textEinsetzen(wurzel);
  assert.equal(bilanz.texte, 1, "ein Text ersetzt");
  assert.equal(bilanz.merkmale, 1, "ein Merkmal ersetzt");
  assert.equal(knopf.textContent, "\n   Rules and workflows …\n", "der Rand bleibt, der Satz wechselt");
  assert.ok(knopf.childNodes.includes(haken), "das Kindelement überlebt das Einsetzen");
  assert.equal(feld.getAttribute("aria-label"), "JSON of the workflows");
  assert.equal(ohneEintrag.textContent, "Bleibt stehen", "ohne Katalogeintrag bleibt der Bestandstext stehen");
});

test("L7c — Die Sprachmarke kommt aus dem Katalog und nicht aus der Browsersprache", async () => {
  /* Der Unterschied ist keine Feinheit: Für eine Sprache ohne eigenen Ordner
     unter `_locales/` fällt Chrome auf `default_locale` zurück, `getUILanguage`
     meldet aber weiter die Browsersprache. Stünde die in `<html lang>`, läse
     ein Bildschirmleser deutsche Sätze mit fremder Aussprache vor, und
     `SpeechSynthesisUtterance.lang` griffe zur falschen Stimme. */
  attrappeSetzen({ katalog: { sprache_code: "en", sprache_sprechcode: "en-US" } });
  const { sprachkennung, sprechsprache, sprachmarkeSetzen } = await import("../panel/sprache.js");

  assert.equal(sprachkennung(), "en");
  assert.equal(sprechsprache(), "en-US");

  const dokument = { documentElement: { merkmale: {}, setAttribute(n, w) { this.merkmale[n] = w; } } };
  assert.equal(sprachmarkeSetzen(dokument), "en");
  assert.equal(dokument.documentElement.merkmale.lang, "en");

  /* Gegenprobe ohne Katalog: Dann bleibt es beim Deutschen, statt dass die
     Marke leer wird. */
  attrappeSetzen({ katalog: {} });
  assert.equal(sprachkennung(), "de");
  assert.equal(sprechsprache(), "de-DE");
});

test("L7e — Meinen Katalog und Browser dieselbe Sprache, gewinnt die feinere Angabe des Browsers", async () => {
  /* Die Attrappe meldet fest "de" als Browsersprache. Für diesen Fall wird sie
     hier örtlich überschrieben, wie es §1.1 des Vertrages ausdrücklich
     vorsieht: Was sie nicht kann, baut die eigene Prüfdatei nach. */
  const { sprechsprache } = await import("../panel/sprache.js");

  attrappeSetzen({ katalog: { sprache_sprechcode: "en-US" } });
  globalThis.chrome.i18n.getUILanguage = () => "en-GB";
  assert.equal(sprechsprache(), "en-GB", "ein britischer Browser bekommt eine britische Stimme");

  /* Und der Fall, um den es wirklich geht: Chrome fällt für eine Sprache ohne
     eigenen Ordner auf `default_locale` zurück und meldet trotzdem weiter die
     Browsersprache. Eine französische Stimme darf deutsche Sätze nicht
     vorlesen. */
  attrappeSetzen({ katalog: { sprache_sprechcode: "de-DE" } });
  globalThis.chrome.i18n.getUILanguage = () => "fr-FR";
  assert.equal(sprechsprache(), "de-DE");

  /* Ohne Auskunft des Browsers bleibt es beim Katalog, statt dass die Marke
     leer wird und die Sprachausgabe irgendeine Stimme nimmt. */
  globalThis.chrome.i18n.getUILanguage = () => { throw new Error("kein Anschluss"); };
  assert.equal(sprechsprache(), "de-DE");
});

test("L7d — Beide Kataloge nennen ihre eigene Sprache, und zwar richtig", () => {
  for (const [sprache, code, sprechcode] of [["de", "de", "de-DE"], ["en", "en", "en-US"]]) {
    const katalog = KATALOG.get(sprache);
    assert.equal(katalog.sprache_code.message, code, `${sprache}: sprache_code ist falsch`);
    assert.equal(katalog.sprache_sprechcode.message, sprechcode, `${sprache}: sprache_sprechcode ist falsch`);
  }
});

/* ------------------------------------------------------------------ *
 * L8 — Der Anschluss im Produktivweg
 *
 * Der teuerste Befund dieses Projekts ist der vom 11.08.2026: 18 grüne
 * Prüfsätze über einer Verdeckungswache, die im ausgelieferten Klickweg
 * nirgends gerufen wurde. Deshalb misst dieser Abschnitt nicht, ob die
 * Sprachschicht funktioniert, sondern ob die Oberfläche sie ANFASST.
 * ------------------------------------------------------------------ */

test("L8a — Die Seitenleiste wendet die Sprache beim Start wirklich an", () => {
  const quelle = QUELLE.get("src/panel/panel.js");
  for (const aufruf of ["spracheAnwenden(document);", "merkmaleUebersetzen();", "zusatztexteUebersetzen();"]) {
    assert.ok(quelle.includes(aufruf), `panel.js ruft „${aufruf}" nirgends`);
  }
  /* Und zwar vor dem ersten Bildschirmzustand: Eine Leiste, die erst deutsch
     dasteht und dann umspringt, ist für jemanden, der vorlesen lässt, zwei
     verschiedene Oberflächen. */
  assert.ok(
    quelle.indexOf("spracheAnwenden(document);") < quelle.indexOf('setzeZustand("bereit");'),
    "die Sprache muss stehen, bevor der erste Zustand gezeigt wird",
  );
  /* Die fremden Ansichten (Startseite, Werkbank, Matrix, Buch) entstehen erst
     zur Laufzeit. Ohne diesen Aufruf bliebe `data-i18n-attr` dort tot. */
  assert.match(
    quelle,
    /function ankerBauen[\s\S]*?textEinsetzen\(wurzel\);/,
    "ankerBauen muss die eingebaute Ansicht übersetzen",
  );
});

test("L8b — Die Sprachausgabe nimmt die Sprachmarke des Katalogs", () => {
  /* Bis 0.5.3 stand in `sprich()` fest `s.lang = "de-DE"`. Eine englische
     Oberfläche wäre damit von einer deutschen Stimme buchstabiert worden, und
     Vorlesen ist der Haupt-Bedienweg des Inhabers. */
  const quelle = QUELLE.get("src/panel/panel.js");
  assert.ok(quelle.includes("s.lang = sprechsprache();"), "sprich() setzt die Sprachmarke nicht aus dem Katalog");
  assert.ok(!/s\.lang\s*=\s*"de-DE"/.test(quelle), "die feste Sprachmarke steht wieder im Quelltext");
});

test("L8c — Die Anmeldekarte steht vollständig im Katalog", () => {
  /* Befund 09.08.2026: Der Login war fest deutsch, und er ist die erste Karte,
     die ein Käufer über SEOClerks überhaupt zu sehen bekommt. Gemessen wird
     deshalb genau diese Karte, Feld für Feld. */
  const de = KATALOG.get("de");
  const en = KATALOG.get("en");
  const html = QUELLE.get("src/panel/panel.html");
  const von = html.indexOf('<section id="anmeldung"');
  assert.ok(von > 0, "die Anmeldekarte steht nicht mehr in panel.html");
  const karte = html.slice(von, html.indexOf("</section>", von));

  const schluessel = [...karte.matchAll(/data-i18n="([^"]+)"/g)].map((t) => t[1]);
  assert.ok(schluessel.length >= 6, `die Anmeldekarte trägt nur ${schluessel.length} Schlüssel`);
  for (const s of schluessel) {
    assert.ok(Object.hasOwn(de, s), `Anmeldekarte: ${s} fehlt im deutschen Katalog`);
    assert.ok(Object.hasOwn(en, s), `Anmeldekarte: ${s} fehlt im englischen Katalog`);
    assert.notEqual(
      de[s].message,
      en[s].message,
      `Anmeldekarte: ${s} steht in beiden Sprachen gleich da, das ist keine Übersetzung`,
    );
  }
  /* Und die Zusage, die auf dieser Karte am meisten zählt, steht auch in der
     englischen Fassung: Hier wird nie ein Passwort getippt. */
  assert.match(en.dialog_anmeldung_hinweis.message, /password/i);
});

test("L8d — Die Zusage aus dem Riegel überlebt die Übersetzung", () => {
  /* MODUS_RIEGEL nennt jede einzelne harte Klasse aus `net/befehle.js` → HART.
     Das ist keine Aufzählung um der Vollständigkeit willen, sondern die Zusage
     selbst: Was dort nicht steht, könnte ein Mensch für abgeschaltet halten.
     Eine englische Fassung, die eine davon weglässt, hebt sie auf. */
  const en = KATALOG.get("en").modus_riegel.message.toLowerCase();
  for (const wort of ["payment", "password", "delet", "file", "permission", "captcha"]) {
    assert.ok(en.includes(wort), `die englische Fassung des Riegels nennt „${wort}" nicht: ${en}`);
  }
});

test("L8e — Der Knopfname im Sperrtext heißt in beiden Sprachen wie der Knopf", () => {
  /* Dieselbe Zusage, die A-PANEL für die deutsche Fassung misst: Wer sich die
     Erklärung vorlesen lässt, sucht danach genau den Knopf, den sie nennt.
     Eine Übersetzung, die den Satz übersetzt und den Knopf vergisst, schickt
     ihn auf die Suche nach etwas, das es nicht gibt. */
  for (const sprache of SPRACHEN) {
    const katalog = KATALOG.get(sprache);
    const knopf = katalog.kopf_verbinden_tab.message;
    for (const schluessel of ["sperre_cloud_text", "sperre_browser_text"]) {
      assert.ok(
        katalog[schluessel].message.includes(knopf),
        `${sprache}/${schluessel} nennt den Knopf nicht beim Namen („${knopf}")`,
      );
    }
  }
});
