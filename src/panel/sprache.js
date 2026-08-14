/*
 * SMarTrChrome — Sprache der Oberfläche (Vertrag v3.5 §12).
 *
 * Warum es diese Datei gibt: Bis 0.5.3 war die Seitenleiste fest deutsch, die
 * Anmeldekarte eingeschlossen. Befund vom 09.08.2026: Das trifft jeden Käufer,
 * der über SEOClerks kommt, und zwar an der ersten Karte, die er überhaupt
 * sieht. Eine Erweiterung, die auf Englisch verkauft wird und auf Deutsch nach
 * der Anmeldung fragt, hat ihren Kunden an genau dieser Stelle verloren.
 *
 * Zwei Wege führen hier zusammen:
 *
 *  - `textEinsetzen(wurzel)` für alles, was schon als Text im HTML steht. Es
 *    löst `data-i18n` und `data-i18n-attr` auf.
 *  - `t(schluessel, notfall, …)` für Sätze, die erst im Quelltext entstehen.
 *
 * Der zweite Parameter von `t` ist der deutsche Notfalltext, und er ist keine
 * Bequemlichkeit: `chrome.i18n.getMessage` gibt für einen unbekannten
 * Schlüssel die LEERE Zeichenkette zurück, keinen Fehler. Ohne Notfalltext
 * wäre eine Lücke im Katalog eine leere Stelle auf dem Bildschirm, und wer
 * sich die Leiste vorlesen lässt, hörte dort schlicht nichts. Dieselbe Regel
 * gilt in `textEinsetzen`: Fehlt der Schlüssel, bleibt der Text stehen, der im
 * HTML steht. `pruefung/sprache.test.mjs` hält jeden Notfalltext gegen
 * `_locales/de/messages.json`, damit die beiden nicht auseinanderlaufen.
 *
 * Was hier ausdrücklich NICHT hineingehört: die Sätze an den Agenten aus
 * `net/ausfuehrer.js` und `net/befehle.js`. Sie sind Protokolltext, kein
 * Oberflächentext, und 372 Prüfsätze messen sie wörtlich (Vertrag §12,
 * ausdrückliche Grenze).
 */

/* ------------------------------------------------------------------ *
 * Zugang zum Katalog
 * ------------------------------------------------------------------ */

/**
 * `chrome.i18n`, oder null.
 *
 * Über `globalThis` und nicht über den blanken Namen `chrome`: In einer
 * Prüfung ohne Attrappe wäre `chrome` ein ReferenceError, und eine
 * Sprachschicht, die beim Fehlen des Browsers wirft, nähme der Oberfläche
 * jeden Text statt nur die Übersetzung.
 */
function sprachdienst() {
  try {
    const c = globalThis.chrome;
    return c && c.i18n && typeof c.i18n.getMessage === "function" ? c.i18n : null;
  } catch (_) {
    return null;
  }
}

/** `$1` … `$9` füllen. Von hinten, damit `$1` nicht in `$10` hineinschneidet. */
function werteEinsetzen(text, werte) {
  let s = String(text);
  for (let i = werte.length; i >= 1; i -= 1) {
    s = s.split(`$${i}`).join(String(werte[i - 1]));
  }
  return s;
}

/**
 * Der Katalogtext zu einem Schlüssel, oder die leere Zeichenkette.
 *
 * Ohne Notfall und ohne Ausweichen: Genau diese Rückgabe ist die Stelle, an
 * der `textEinsetzen` erkennt, dass es den Bestandstext stehen lassen muss.
 */
export function ausKatalog(schluessel, werte = []) {
  const dienst = sprachdienst();
  if (!dienst || typeof schluessel !== "string" || !schluessel) return "";
  try {
    const text = dienst.getMessage(schluessel, werte.map((w) => String(w)));
    return typeof text === "string" ? text : "";
  } catch (_) {
    return "";
  }
}

/**
 * Ein Text der Oberfläche.
 *
 * @param {string} schluessel  Katalogschlüssel, Form `^[a-z][a-z0-9_]*$`
 * @param {string} notfall     die deutsche Fassung, wortgleich mit dem Katalog
 * @param {...(string|number)} werte  füllen `$1`, `$2`, …
 * @returns {string} immer eine Zeichenkette, nie undefined, wirft nie
 */
export function t(schluessel, notfall = "", ...werte) {
  const ausDemKatalog = ausKatalog(schluessel, werte);
  if (ausDemKatalog) return ausDemKatalog;
  return werteEinsetzen(String(notfall == null ? "" : notfall), werte);
}

/* ------------------------------------------------------------------ *
 * Text ins Dokument einsetzen
 * ------------------------------------------------------------------ */

/*
 * Welche Merkmale `data-i18n-attr` beschreiben darf.
 *
 * Eine Positivliste und keine Sperrliste: `data-i18n-attr` nimmt einen
 * Merkmalsnamen aus dem Dokument entgegen und schreibt ihn anschliessend
 * selbst. Mit einer Sperrliste wäre jedes Merkmal erlaubt, an das beim
 * Schreiben dieser Zeile niemand gedacht hat, `href` und `formaction`
 * eingeschlossen. Was hier nicht steht, wird übergangen; alles hier ist reiner
 * Text für einen Menschen oder einen Bildschirmleser.
 */
const MERKMALE_ERLAUBT = Object.freeze(new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "placeholder",
  "alt",
  "label",
  "download",
]));

/*
 * Text einsetzen, ohne die Kindelemente wegzuwerfen.
 *
 * Ein blankes `textContent = …` wäre der kürzere Weg und der falsche: In
 * panel.html trägt zum Beispiel `#menue-werkbank` den Schlüssel am Knopf selbst
 * und enthält daneben das Hakenfeld `<span class="haken">`. Der Schlüssel sitzt
 * dort, weil Prüfsatz I1 (A-PANEL) ihn genau an der Kennung verlangt; ein
 * `textContent` hätte den Haken entfernt und die Menüpunkte gegeneinander
 * verschoben.
 *
 * Ersetzt wird deshalb der letzte Textknoten mit echtem Inhalt, und zwar unter
 * Beibehaltung seiner Leerzeichen am Rand. Alle weiteren Textknoten mit Inhalt
 * werden geleert, damit kein zweiter Satz stehen bleibt. Hat das Element gar
 * keinen Textknoten, bekommt es einen.
 */
function textSetzen(el, text) {
  let knoten = [];
  try {
    knoten = Array.from(el.childNodes || []).filter(
      (k) => k && k.nodeType === 3 && String(k.nodeValue || "").trim() !== "",
    );
  } catch (_) {
    knoten = [];
  }
  if (!knoten.length) {
    el.textContent = text;
    return;
  }
  const letzter = knoten[knoten.length - 1];
  for (const k of knoten) if (k !== letzter) k.nodeValue = "";
  const roh = String(letzter.nodeValue || "");
  const vorn = (roh.match(/^\s*/) || [""])[0];
  const hinten = (roh.match(/\s*$/) || [""])[0];
  letzter.nodeValue = `${vorn}${text}${hinten}`;
}

/** Alle Elemente unter (und einschliesslich) `wurzel` mit einem Merkmal. */
function mitMerkmal(wurzel, merkmal) {
  const gefunden = [];
  try {
    if (typeof wurzel.getAttribute === "function" && wurzel.getAttribute(merkmal) !== null) {
      gefunden.push(wurzel);
    }
    if (typeof wurzel.querySelectorAll === "function") {
      gefunden.push(...wurzel.querySelectorAll(`[${merkmal}]`));
    }
  } catch (_) {
    /* Ein Baum, den niemand durchsuchen kann, hat auch keine Texte. */
  }
  return gefunden;
}

/**
 * `data-i18n` und `data-i18n-attr` unter `wurzel` auflösen.
 *
 * Fehlt ein Schlüssel im Katalog, bleibt der Bestandstext stehen. Das ist der
 * Grund, warum die deutschen Sätze im HTML stehen bleiben und nicht durch
 * leere Elemente ersetzt worden sind: Ein fehlender Schlüssel darf höchstens
 * eine fehlende Übersetzung sein, nie eine leere Oberfläche.
 *
 * @param {Element|Document} wurzel
 * @returns {{texte:number, merkmale:number}} was wirklich ersetzt wurde
 */
export function textEinsetzen(wurzel = globalThis.document) {
  const bilanz = { texte: 0, merkmale: 0 };
  if (!wurzel) return bilanz;

  for (const el of mitMerkmal(wurzel, "data-i18n")) {
    const schluessel = el.getAttribute("data-i18n");
    const text = ausKatalog(schluessel);
    if (!text) continue;
    textSetzen(el, text);
    bilanz.texte += 1;
  }

  for (const el of mitMerkmal(wurzel, "data-i18n-attr")) {
    const angabe = String(el.getAttribute("data-i18n-attr") || "");
    for (const stueck of angabe.split(",")) {
      const [merkmalRoh, schluesselRoh] = stueck.split(":");
      const merkmal = String(merkmalRoh || "").trim().toLowerCase();
      const schluessel = String(schluesselRoh || "").trim();
      if (!MERKMALE_ERLAUBT.has(merkmal) || !schluessel) continue;
      const text = ausKatalog(schluessel);
      if (!text) continue;
      try {
        el.setAttribute(merkmal, text);
        bilanz.merkmale += 1;
      } catch (_) {
        /* Ein Element, das sein Merkmal nicht annimmt, behält den alten Text. */
      }
    }
  }

  return bilanz;
}

/* ------------------------------------------------------------------ *
 * Welche Sprache läuft hier eigentlich
 * ------------------------------------------------------------------ */

/**
 * Die Sprache, die Chrome dem Browser des Nutzers meldet, z. B. "en-GB".
 *
 * Das ist die Sprache des MENSCHEN und ausdrücklich nicht die des Katalogs.
 * Beides auseinanderzuhalten ist der Punkt: Für eine Sprache ohne eigenen
 * Ordner unter `_locales/` fällt Chrome auf `default_locale` zurück, meldet
 * hier aber weiterhin die Browsersprache.
 */
export function browsersprache() {
  const dienst = sprachdienst();
  try {
    const roh = dienst && typeof dienst.getUILanguage === "function" ? dienst.getUILanguage() : "";
    return typeof roh === "string" ? roh : "";
  } catch (_) {
    return "";
  }
}

/**
 * Die Sprache, in der die Oberfläche WIRKLICH dasteht.
 *
 * Sie kommt aus dem Katalog selbst (`sprache_code`) und nicht aus
 * `getUILanguage`. Grund: Ein französischer Browser bekommt mangels Ordner den
 * deutschen Katalog, `getUILanguage` sagt trotzdem "fr". Stünde das dann in
 * `<html lang>`, läse ein Bildschirmleser deutsche Sätze mit französischer
 * Aussprache vor. Gemessen wird deshalb, was angekommen ist, nicht, was
 * bestellt war.
 */
export function sprachkennung() {
  return t("sprache_code", "de");
}

/**
 * Die Sprachmarke für die Sprachausgabe, z. B. "de-DE".
 *
 * Vorlesen ist der Haupt-Bedienweg des Inhabers, und `SpeechSynthesisUtterance`
 * wählt seine Stimme über `lang`. Bis 0.5.3 stand dort fest "de-DE": Eine
 * englische Oberfläche wäre damit von einer deutschen Stimme buchstabiert
 * worden.
 *
 * Grundlage ist der Katalog und nicht der Browser. Nur wenn beide DIESELBE
 * Sprache meinen, gewinnt die feinere Angabe des Browsers: Ein britischer
 * Browser bekommt den englischen Katalog, und dann darf die Stimme auch
 * britisch sein. Andersherum spräche sonst eine französische Stimme deutsche
 * Sätze, weil Chrome für Französisch mangels Ordner auf `default_locale`
 * zurückfällt.
 */
export function sprechsprache() {
  const ausDemKatalog = t("sprache_sprechcode", "de-DE");
  const vomBrowser = browsersprache();
  const sprache = String(ausDemKatalog).split("-")[0].toLowerCase();
  if (sprache && vomBrowser.toLowerCase().startsWith(`${sprache}-`)) return vomBrowser;
  return ausDemKatalog;
}

/**
 * `<html lang>` auf die Sprache setzen, die wirklich dasteht.
 *
 * @returns {string} die gesetzte Kennung, oder "" wenn es kein Dokument gibt
 */
export function sprachmarkeSetzen(dokument = globalThis.document) {
  const kennung = sprachkennung();
  try {
    if (dokument && dokument.documentElement && kennung) {
      dokument.documentElement.setAttribute("lang", kennung);
      return kennung;
    }
  } catch (_) {
    /* Ohne Dokument bleibt die Marke aus dem HTML stehen. */
  }
  return "";
}

/**
 * Der eine Aufruf, den die Oberfläche beim Start macht.
 *
 * Sprachmarke und Text in einem Zug, damit keine Seitenleiste entsteht, in der
 * das eine gesetzt und das andere vergessen wurde.
 */
export function spracheAnwenden(dokument = globalThis.document) {
  const kennung = sprachmarkeSetzen(dokument);
  const bilanz = textEinsetzen(dokument);
  return { kennung, ...bilanz };
}
