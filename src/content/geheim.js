/*
 * SMarTrChrome — die eine Quelle für Geheimnisse (VERTRAG v3.5, Festlegung F4
 * vom 14.08.2026).
 *
 * Ein KLASSISCHES Skript, kein Modul. Es schreibt nach
 * `globalThis.SMARTR_GEHEIM` und wird als ERSTE Datei in die Seite gespielt,
 * vor `klickwache.js`, `selektor.js`, `overlay.js` und `rekorder.js`. Grund
 * ist derselbe wie dort: Ein Inhaltsskript kann `src/net/*.js` nicht
 * importieren, und eine Wache in einem Modul, das niemand rufen kann, ist am
 * 11.08.2026 grün geprüft und ungenutzt ausgeliefert worden.
 *
 * WARUM ES DIESE DATEI GIBT — Befund vom 14.08.2026 (B5 und B6 der Abnahme).
 *
 * Dieselbe Erkennung stand zweimal im Bestand, in `overlay.js` und in
 * `rekorder.js`, Wort für Wort abgeschrieben, mit dem Kommentar „wer eine der
 * Listen ändert, ändert beide". Genau das ist nicht geschehen, und
 * `selektor.js` hatte gar keine. Gemessen wurden fünf Lecks:
 *
 *   1. Sechs Kästchen eines Einmalcodes (`name="d1"`, „Ziffer 1") ergaben je
 *      einen Schritt `{"type":"input","value":"8"}`, auch in einem Formular
 *      mit einem echten Passwortfeld.
 *   2. Eine Kartennummer im Branchenfeld `name="pan"` ergab
 *      `"value":"4111111111111111"`.
 *   3. Ein Passwortfeld, das nach dem Klick aufs Auge `type=text` trägt und
 *      `name="pw"` heisst, ergab `"value":"hunter2"`.
 *   4. Der sichtbare Einmalcode wurde zum Textanker `text=849271`.
 *   5. Und derselbe Code stand als `beschreibung` im Schritt.
 *
 * Alle fünf bestanden `workflowPruefen` und lagen danach unverschlüsselt in
 * `sa_workflows`. Die Zusage „Passwörter nie" steht wörtlich in der
 * Beschreibung im Chrome Web Store.
 *
 * DIE URSACHE WAR NICHT EIN FEHLENDES WORT, SONDERN DIE RICHTUNG.
 *
 * Eine Wortliste entschied darüber, was NICHT gespeichert wird. Damit war
 * alles Unbekannte gespeichert, und eine Sicherheitszusage hing an der
 * Vollständigkeit einer Liste, die niemand vollständig halten kann. Ab hier
 * gilt die andere Richtung:
 *
 *     Was nicht nachweislich harmlos ist, wird nicht gespeichert.
 *
 * Die Asymmetrie dahinter ist dieselbe wie in §3.1 für den Klassifizierer:
 * Ein zu Unrecht verweigerter Wert kostet EINEN Schritt
 * `user_input_required`, den ein Mensch beim Abspielen einmal ausfüllt. Ein
 * zu Unrecht gespeicherter Wert kostet ein Passwort auf der Platte. Deshalb
 * dürfen die Listen hier nur in je eine Richtung wirken:
 *
 *   - `GEHEIM_*` kann ausschliesslich VERWEIGERN. Ein fehlendes Wort kostet
 *     nichts, weil hinter der Wortprüfung noch Umfeld und Wertgestalt stehen.
 *   - `HARMLOS_*` kann ausschliesslich FREIGEBEN, und zwar erst, nachdem
 *     Bauform, Umfeld und Wertgestalt den Wert schon durchgelassen haben. Ein
 *     fehlendes Wort kostet hier eine Rückfrage, kein Geheimnis.
 *
 * Die Reihenfolge der Prüfungen ist deshalb Teil der Sicherheitszusage und
 * keine Geschmacksfrage: erst verweigern, dann belegen. „phone_country_code"
 * ist harmlos, „phone_verification_code" nicht, und beide tragen das Wort
 * „phone" — entschieden wird das in `geheim()`, lange bevor irgendein
 * Harmlos-Beleg zum Zuge kommt.
 *
 * WAS DIESE DATEI AUSDRÜCKLICH NICHT TUT: Sie liest keinen Wert, um ihn
 * danach zu verwerfen. `wertFreigeben` prüft alles, was ohne den Wert zu
 * prüfen ist, ZUERST — Bauform, `autocomplete`, Umfeld, Feldreihe und den
 * Harmlos-Beleg. Erst wenn all das durch ist, wird gelesen. Ein Passwortfeld
 * wird damit nie angefasst, und das ist der Unterschied, den §7.2 wörtlich
 * macht.
 */

(() => {
  "use strict";

  /* Ein zweites Einspielen darf die bestehende Erkennung nicht ersetzen:
     `overlay.js`, `rekorder.js` und `selektor.js` halten Ergebnisse aus
     dieser Fassung, und zwei Fassungen mitten in einer Aufnahme wären zwei
     Wahrheiten über dasselbe Feld. */
  if (globalThis.SMARTR_GEHEIM) return;

  /* §7.2 wörtlich: die Begründung, die an die Stelle des Geheimnisses tritt. */
  const VERBOT_GRUND = "Login/2FA";

  /* Spiegel von `WERKSTATT_GRENZEN.beschreibungZeichen` aus
     `src/net/werkstatt.js`. Die Zahl steht hier ein zweites Mal, weil ein
     Inhaltsskript nicht importieren kann; wandert sie dort, wandert sie hier
     mit, sonst lehnt `workflowPruefen` einen Schritt ab, den der Mensch
     gerade erst aufgezeichnet hat. */
  const BESCHREIBUNG_ZEICHEN = 400;

  /* Wie weit nach oben ein Abschnitt reicht, wenn die Seite keinen
     ausdrücklichen gesetzt hat. Vier Ebenen sind die Hülle einer Maske, nicht
     die halbe Seite — ein Abschnitt, der bis zum `<body>` reicht, erklärte
     jedes Feld der Seite für geheim und wäre damit keine Aussage mehr. */
  const ABSCHNITT_EBENEN = 4;

  /* Wie viele Felder je Abschnitt angesehen werden. Eine Preistabelle mit
     tausend Zeilen darf die Wahrnehmung nicht anhalten. */
  const ABSCHNITT_FELDER_HOECHSTENS = 80;

  /* Ab hier hört ein Abschnitt auf. Über diesen Marken steht nur noch die
     ganze Seite. */
  const ABSCHNITT_HALT = new Set(["BODY", "HTML", "HEAD"]);

  /* Diese Marken ziehen die Grenze selbst: Wer ein `<form>` oder ein
     `<fieldset>` setzt, hat gesagt, was zusammengehört. Darüber hinaus wird
     nicht weitergesucht. */
  const ABSCHNITT_MARKE = new Set([
    "FORM", "FIELDSET", "SECTION", "DIALOG", "ARTICLE", "ASIDE", "NAV", "MAIN", "TABLE",
  ]);

  /* Eine Reihe gleichartiger Kästchen mit einem oder zwei Zeichen ist der
     Einmalcode. Drei genügen als Reihe; sechs sind der Alltag. */
  const KASTEN_ZEICHEN_HOECHSTENS = 2;
  const REIHE_MINDEST = 3;

  /* Ein einzelnes Kästchen für einen Code fasst sechs bis acht Ziffern.
     Zwölf ist grosszügig und liegt noch unter jeder Kartennummer. */
  const CODE_KASTEN_HOECHSTENS = 12;

  /* Eine reine Ziffernkette ab vier Stellen ist ein Code und keine Hausnummer.
     Nach oben endet es bei 24, weil darüber keine Kennung mehr steht, sondern
     eine Messreihe. */
  const ZIFFERN_MINDEST = 4;
  const ZIFFERN_HOECHSTENS = 24;

  /* Kartennummern nach ISO/IEC 7812: 13 bis 19 Stellen mit gültiger
     Luhn-Prüfziffer. */
  const KARTE_MINDEST = 13;
  const KARTE_HOECHSTENS = 19;

  /* ------------------------------------------------------------------ *
   * Was verweigert — die Listen, deren Lücke nichts kostet
   * ------------------------------------------------------------------ */

  /* Die standardisierten Autocomplete-Marken (WHATWG HTML 4.10.18.7). Sie
     sind eine Liste von Marken, keine Freitextzeile, also Marke für Marke
     vergleichen. Die ganze cc-Familie zählt dazu: Nummer, Ablauf, Prüfziffer
     und Karteninhaber sind zusammen die Zahlung. */
  const GEHEIME_MARKEN = new Set(["current-password", "new-password", "one-time-code"]);

  /* Wörter, die für sich allein stehen müssen. „pin" steckt in „shipping",
     „tan" in „Standort" — als Wortstück wären sie eine Abschaltung statt einer
     Erkennung. */
  const GEHEIM_WORT = new Set([
    "pin", "pins", "tan", "tans", "itan", "mtan", "puk",
    "cvc", "cvv", "csc", "otp", "iban", "bic",
  ]);

  /* Wortstücke, die auch mitten in einem Wort geheim bleiben — „Kartennummer",
     „Einmalkennwort", „Prüfziffer". */
  const GEHEIM_TEIL = [
    "pass", "pwd", "kennwort", "geheim", "secret", "token", "einmal",
    "card", "karte", "kredit", "credit",
    "pruefziff", "prüfziff", "pruefnummer", "prüfnummer",
    "sicherheitscode", "sicherheitsfrage", "sicherheitsnummer",
    "ccnum", "ccexp", "cccsc", "ccname", "cctype",
  ];

  /* Befund M2 der Gegenlesung vom 06.08.2026: „code" allein sagt nicht, um
     welchen Code es geht, sein Nachbar sagt es. Ohne diese Ausnahmen galten
     Postleitzahl, Ländervorwahl und Gutscheincode als Geheimnis, und der
     Agent konnte eine Bestellung nicht ausfüllen.
     Entschärft wird ausschliesslich die Fuge selbst („postcode", „codepost");
     steht der Code an einem anderen Wort, greift die Ausnahme nicht:
     „phone_verification_code" bleibt geheim, „phone_country_code" nicht. */
  const CODE_HARMLOS = [
    "post", "postal", "zip", "plz",
    "country", "land", "laender", "länder", "iso",
    "area", "dial", "vorwahl",
    "lang", "language", "sprache", "locale",
    "currency", "waehrung", "währung",
    "promo", "coupon", "gutschein", "rabatt", "aktions", "discount", "voucher",
    "produkt", "product", "artikel", "sku", "store", "filiale", "shop",
    "bar", "qr", "farb", "color",
  ];
  /* Bewusst NICHT harmlos: „phone" und „tel". „phone_code" ist auf
     Anmeldeseiten mindestens so oft der Code aus der SMS wie die
     Ländervorwahl. Ebenso wenig harmlos: „invite" und „referral" — ein
     Einladungscode ist eine Eintrittskarte, kein Ortsname. */

  /* ------------------------------------------------------------------ *
   * Was freigibt — die Listen, deren Lücke eine Rückfrage kostet
   * ------------------------------------------------------------------ */

  /* Feldarten, die sich selbst erklären. `text` und `number` stehen bewusst
     NICHT dabei: Ein Einmalcode ist beides. */
  const HARMLOS_TYP = new Set([
    "email", "url", "tel", "search", "date", "datetime-local",
    "month", "week", "time", "color",
  ]);

  /* Autocomplete-Marken aus demselben Standard wie die geheimen, nur von der
     anderen Seite. Wer sein Feld so auszeichnet, hat gesagt, was darin steht. */
  const HARMLOS_MARKEN = new Set([
    "username", "email", "name", "given-name", "additional-name", "family-name",
    "nickname", "honorific-prefix", "honorific-suffix", "organization",
    "organization-title", "street-address", "address-line1", "address-line2",
    "address-line3", "address-level1", "address-level2", "address-level3",
    "address-level4", "postal-code", "country", "country-name", "url", "photo",
    "bday", "bday-day", "bday-month", "bday-year", "sex", "language",
    "tel", "tel-national", "tel-area-code", "tel-local", "tel-extension",
    "impp", "shipping", "billing",
  ]);

  /* Wortstücke, die ein Feld als gewöhnliches Formularfeld ausweisen.
     Bewusst als Wortstücke und nicht als Wörter: „artikelnummer",
     „lieferadresse" und „produktbeschreibung" sollen tragen.
     Bewusst OHNE kurze Silben wie „art" oder „ort": „art" steckt in
     „Kartennummer" und „ort" in „Passwort". Eine Freigabe darf nie an einem
     Zufallstreffer hängen — auch wenn `geheim()` beide längst vorher
     verweigert hätte. */
  const HARMLOS_WORT = [
    /* Person und Kontakt */
    "name", "vorname", "nachname", "anrede", "benutzer", "nutzer", "user",
    "kunde", "customer", "firma", "company", "organisation", "abteilung",
    "email", "mail", "telefon", "phone", "mobil", "handy", "fax",
    /* Anschrift */
    "adresse", "address", "strasse", "straße", "street", "hausnummer",
    "plz", "postleit", "postal", "zip", "stadt", "city", "wohnort", "standort",
    "land", "country", "region", "bundesland", "state", "etage", "zusatz",
    /* Handel */
    "artikel", "produkt", "product", "sku", "ean", "isbn", "gtin", "asin",
    "menge", "anzahl", "quantity", "preis", "price", "waehrung", "währung",
    "currency", "versand", "shipping", "lieferung", "delivery", "bestell",
    "order", "rechnung", "invoice", "gutschein", "coupon", "promo", "rabatt",
    "discount", "voucher", "marke", "brand", "hersteller", "modell", "model",
    "zustand", "condition", "kategorie", "category", "groesse", "größe",
    "size", "gewicht", "weight", "farbe", "color",
    /* Inhalt und Bedienung */
    "titel", "title", "betreff", "subject", "beschreib", "description",
    "kommentar", "comment", "nachricht", "message", "notiz", "note",
    "suche", "search", "query", "filter", "sortier", "datum", "date",
    "jahr", "monat", "url", "link", "webseite", "website", "domain",
    "sprache", "language", "locale",
  ];

  /* ------------------------------------------------------------------ *
   * Kleinkram
   * ------------------------------------------------------------------ */

  const dokument = () => {
    try {
      return typeof document !== "undefined" ? document : null;
    } catch (_) {
      return null;
    }
  };

  function merkmal(el, name) {
    try {
      const w = el.getAttribute(name);
      return typeof w === "string" ? w : "";
    } catch (_) {
      return "";
    }
  }

  function marke(el) {
    return String((el && el.tagName) || "").toUpperCase();
  }

  /* „ccNumber", „cc_number" und „cc-number" sind dasselbe Feld. Für die Wörter
     wird an Fugen und Gross/Klein getrennt, für die Wortstücke bleibt das
     Merkmal am Stück — sonst fände „ccnum" die Marke „cc-number" nicht. */
  const woerterVon = (s) =>
    String(s || "")
      .replace(/([a-zäöüß0-9])([A-ZÄÖÜ])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-zäöüß0-9]+/)
      .filter(Boolean);

  const flachVon = (s) => String(s || "").toLowerCase().replace(/[^a-zäöüß0-9]+/g, "");

  /* Wahr, wenn in diesem Merkmal ein „code" steht, den kein harmloser Nachbar
     erklärt. */
  const codeGeheim = (flach) => {
    if (!flach.includes("code")) return false;
    let rest = flach;
    for (const nachbar of CODE_HARMLOS) {
      rest = rest.split(`${nachbar}code`).join("|").split(`code${nachbar}`).join("|");
    }
    return rest.includes("code");
  };

  /** Kann dieses Element überhaupt einen Inhalt tragen? */
  function traegtInhalt(el) {
    if (!el || el.nodeType !== 1) return false;
    const m = marke(el);
    return m === "INPUT" || m === "TEXTAREA" || m === "SELECT" || el.isContentEditable === true;
  }

  const feldTyp = (el) => {
    const ausMerkmal = merkmal(el, "type").toLowerCase();
    if (ausMerkmal) return ausMerkmal;
    try {
      return String(el.type || "").toLowerCase();
    } catch (_) {
      return "";
    }
  };

  const markenVon = (el) =>
    merkmal(el, "autocomplete").toLowerCase().split(/\s+/).filter(Boolean);

  /* Die Beschriftung eines Feldes, ausdrücklich OHNE seinen Inhalt. Der Text
     IM Element (die Optionen einer Liste, die getippten Zeichen) sagt nichts
     darüber, ob das Feld geheim ist; das Etikett davor schon. Ohne diese
     Trennung wäre eine Zahlungsart-Liste mit der Option „Kreditkarte" geheim.
     Jedes Stück bleibt für sich: aneinandergehängt ergäben „Alp" und
     „Assistent" das Wortstück „pass" — ein Fund, den es nicht gibt. */
  function beschriftungVon(el) {
    const teile = [merkmal(el, "aria-label"), merkmal(el, "title"), merkmal(el, "placeholder")];
    const doc = dokument();
    const bez = merkmal(el, "aria-labelledby");
    if (bez && doc && typeof doc.getElementById === "function") {
      for (const id of bez.split(/\s+/)) {
        try {
          const n = id && doc.getElementById(id);
          if (n) teile.push(n.textContent || "");
        } catch (_) {
          /* Eine Kennung, die es nicht gibt, ist kein Grund aufzuhören. */
        }
      }
    }
    let eigeneId = "";
    try {
      eigeneId = el.id || merkmal(el, "id");
    } catch (_) {
      eigeneId = "";
    }
    if (eigeneId && doc && typeof doc.querySelector === "function") {
      try {
        const roh =
          typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function"
            ? CSS.escape(eigeneId)
            : eigeneId;
        const l = doc.querySelector(`label[for="${roh}"]`);
        if (l) teile.push(l.textContent || "");
      } catch (_) {
        /* Eine Kennung, die kein gültiger Selektor wird, hat kein Etikett.
           Das ist kein Grund, die ganze Erkennung fallen zu lassen. */
      }
    }
    /* Das umschliessende <label> nur bei Eingabefeldern: Bei einer Liste
       stünden sonst deren Optionen mit im Etikett. */
    const m = marke(el);
    if ((m === "INPUT" || m === "TEXTAREA") && typeof el.closest === "function") {
      try {
        const um = el.closest("label");
        if (um) teile.push(um.textContent || "");
      } catch (_) {
        /* kein Etikett */
      }
    }
    return teile.filter(Boolean);
  }

  /* Alles, woran ein Feld sich selbst benennt. Der Inhalt gehört
     ausdrücklich nicht dazu. */
  function merkmaleVon(el) {
    let name = "";
    let id = "";
    try {
      name = el.name || "";
      id = el.id || "";
    } catch (_) {
      /* Attrappen ohne diese Eigenschaften */
    }
    return [
      name,
      id,
      merkmal(el, "name"),
      merkmal(el, "id"),
      merkmal(el, "autocomplete"),
      merkmal(el, "alt"),
      ...beschriftungVon(el),
    ].filter(Boolean);
  }

  /* ------------------------------------------------------------------ *
   * Die Verweigerung — Bauform
   * ------------------------------------------------------------------ */

  /**
   * Trägt dieses Element ein Geheimnis?
   *
   * Die Bauform zuerst, dann die standardisierten Marken, dann die Wörter.
   * Was hier zuschlägt, ist ohne jede Gegenrede geheim: Kein Harmlos-Beleg
   * hebt eine dieser drei Prüfungen auf.
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function geheim(el) {
    if (!traegtInhalt(el)) return false;

    if (feldTyp(el) === "password") return true;

    for (const m of markenVon(el)) {
      if (GEHEIME_MARKEN.has(m)) return true;
      if (m.startsWith("cc-")) return true; // die ganze Karten-Familie
    }

    for (const beschrift of merkmaleVon(el)) {
      for (const wort of woerterVon(beschrift)) {
        if (GEHEIM_WORT.has(wort)) return true;
      }
      const flach = flachVon(beschrift);
      if (!flach) continue;
      if (GEHEIM_TEIL.some((t) => flach.includes(t))) return true;
      /* Jedes Merkmal für sich, wie die Wortstücke auch: Eine Beschriftung
         „Gutscheincode" darf ein Feld namens „cvv" nicht harmlos machen. */
      if (codeGeheim(flach)) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Die Verweigerung — Umfeld
   * ------------------------------------------------------------------ */

  /**
   * Die Abschnitte, in denen dieses Element steht.
   *
   * Befund M5 vom 14.08.2026: `formularGeheim` in `overlay.js` fragte
   * ausschliesslich `closest("form")`. Eine Anmeldemaske ohne `<form>`, also
   * der Normalfall in React und Vue, meldete damit immer `false`, und der
   * Vertragsfall aus §3.1 („click auf ein Element in einem Formular, das ein
   * Geheimfeld enthält") feuerte dort nie. Das Passwort stand im Feld, und
   * der Absendeklick ging im Modus `auto` stumm durch.
   *
   * Deshalb wird jetzt die Elternkette abgelaufen, gedeckelt und mit Halt an
   * `<body>`: Ein ausdrücklicher Abschnitt (`form`, `fieldset`, `section`, …)
   * beendet die Suche, sonst reichen vier Ebenen. Vier Ebenen sind die Hülle
   * einer Maske; die halbe Seite als Abschnitt wäre keine Aussage mehr.
   */
  function abschnitteVon(el) {
    const raus = [];
    let p = null;
    try {
      p = el && el.parentElement;
    } catch (_) {
      p = null;
    }
    let ebene = 0;
    while (p && p.nodeType === 1 && ebene < ABSCHNITT_EBENEN) {
      const m = marke(p);
      if (ABSCHNITT_HALT.has(m)) break;
      raus.push(p);
      if (ABSCHNITT_MARKE.has(m)) break;
      try {
        p = p.parentElement;
      } catch (_) {
        break;
      }
      ebene += 1;
    }
    return raus;
  }

  function felderIn(abschnitt) {
    try {
      if (!abschnitt || typeof abschnitt.querySelectorAll !== "function") return [];
      const liste = abschnitt.querySelectorAll("input, textarea, select");
      return Array.prototype.slice.call(liste, 0, ABSCHNITT_FELDER_HOECHSTENS);
    } catch (_) {
      return [];
    }
  }

  /**
   * Steht dieses Element in einem Abschnitt, der ein Geheimfeld enthält?
   *
   * Nicht „im selben Formular", sondern „im selben Abschnitt" — genau das war
   * der Unterschied zwischen einer Anmeldemaske mit `<form>` und derselben
   * Maske in React.
   */
  function imGeheimAbschnitt(el) {
    if (!el || el.nodeType !== 1) return false;
    for (const abschnitt of abschnitteVon(el)) {
      for (const feld of felderIn(abschnitt)) {
        if (feld !== el && geheim(feld)) return true;
      }
    }
    return false;
  }

  /**
   * Gehört dieses Element zum Umfeld eines Geheimnisses?
   *
   * Das Feld selbst, und dazu der Weg, auf dem eine Maske mit Geheimfeld
   * abgeschickt wird. §3.1 zieht dieselbe Grenze für den Klassifizierer.
   *
   * Warum der Knopf mitzählt, obwohl er selbst nichts Geheimes trägt: Ein
   * aufgezeichneter Ablauf, der eine Anmeldemaske absendet, versucht beim
   * Abspielen eine Anmeldung ohne Passwort. Das ist im besten Fall ein
   * Fehlversuch und im schlechteren einer von dreien, nach denen das Konto
   * gesperrt ist. Anmelden bleibt Sache des Menschen.
   *
   * Ein Klick auf „Passwort vergessen" ist dagegen kein Anmeldeversuch und
   * bleibt deshalb draussen.
   */
  function geheimUmfeld(el) {
    if (!el || el.nodeType !== 1) return false;
    if (geheim(el)) return true;
    if (!imGeheimAbschnitt(el)) return false;
    const m = marke(el);
    const art = feldTyp(el);
    if (m === "BUTTON" && art !== "button" && art !== "reset") return true;
    if (m === "INPUT" && (art === "submit" || art === "image")) return true;
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Die Verweigerung — die Reihe gleichartiger Kästchen
   * ------------------------------------------------------------------ */

  const kastenMass = (el) => {
    const roh = Number(merkmal(el, "maxlength"));
    return Number.isFinite(roh) && roh > 0 ? roh : 0;
  };

  /**
   * Ist dieses Feld ein kurzes Kästchen, das nur Ziffern annimmt?
   *
   * Das ist die Bauform eines Codes und keine Frage der Beschriftung. Sie
   * greift erst NACH dem Harmlos-Beleg und entzieht ihn wieder: Ein Shop, der
   * sein Bestätigungsfeld „bestellnummer" nennt, hat es trotzdem auf sechs
   * Ziffern begrenzt und `inputmode="numeric"` gesetzt.
   */
  function codeKasten(el) {
    const mass = kastenMass(el);
    if (!mass || mass > CODE_KASTEN_HOECHSTENS) return false;
    const art = feldTyp(el);
    if (art === "number") return true;
    if (merkmal(el, "inputmode").toLowerCase() === "numeric") return true;
    return /\\d|\[0-9\]/.test(merkmal(el, "pattern"));
  }

  /**
   * Steht dieses Feld in einer Reihe gleichartiger Kästchen?
   *
   * Das ist die Bauform des Einmalcodes, und sie ist an keinem Wort zu
   * erkennen: Sechs `<input maxlength="1" name="d1" … name="d6">` heissen auf
   * jeder Seite anders. Erkennbar ist die REIHE — drei und mehr Kästchen mit
   * demselben winzigen Fassungsvermögen im selben Abschnitt.
   *
   * Befund B5 vom 14.08.2026: Diese sechs Kästchen ergaben je einen Schritt
   * `{"type":"input","value":"8"}`, und zusammengesetzt stand der Einmalcode
   * im Ablauf.
   */
  function zifferngruppe(el) {
    if (marke(el) !== "INPUT") return false;
    const meins = kastenMass(el);
    if (!meins || meins > KASTEN_ZEICHEN_HOECHSTENS) return false;
    for (const abschnitt of abschnitteVon(el)) {
      let gleiche = 0;
      for (const feld of felderIn(abschnitt)) {
        if (marke(feld) !== "INPUT") continue;
        if (kastenMass(feld) !== meins) continue;
        gleiche += 1;
      }
      if (gleiche >= REIHE_MINDEST) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Die Verweigerung — die Gestalt des Wertes
   * ------------------------------------------------------------------ */

  /** Die Luhn-Prüfziffer, an der jede Kartennummer hängt (ISO/IEC 7812). */
  function luhnGueltig(ziffern) {
    const s = String(ziffern == null ? "" : ziffern);
    if (!/^[0-9]+$/.test(s)) return false;
    if (s.length < KARTE_MINDEST || s.length > KARTE_HOECHSTENS) return false;
    let summe = 0;
    let doppelt = false;
    for (let i = s.length - 1; i >= 0; i--) {
      let z = s.charCodeAt(i) - 48;
      if (doppelt) {
        z *= 2;
        if (z > 9) z -= 9;
      }
      summe += z;
      doppelt = !doppelt;
    }
    return summe % 10 === 0;
  }

  /* Trenner, die eine Kartennummer oder einen Code lesbar machen sollen. Sie
     gehören nicht zum Wert, also fallen sie vor der Messung heraus. */
  const kernVon = (roh) => String(roh == null ? "" : roh).replace(/[\s.\-/ ]/g, "");

  /**
   * Darf dieser Text in einen Anker, eine Beschreibung oder einen Ablauf?
   *
   * Befund B6 vom 14.08.2026: Auf einer 2FA-Seite wurde
   * `<span class="otp-anzeige">849271</span>` zum Anker `text=849271` und zur
   * `beschreibung` „849271", und `<button data-code="849271">` zum Anker
   * `[data-code="849271"]`. Der Textanker kannte KEINERLEI Geheimprüfung, und
   * das Datenmerkmal liess reine Ziffernketten durch, weil die
   * Zufallserkennung in `selektor.js` Ziffernabschnitte als Ordnungszahlen
   * überspringt — zu Recht für `col-md-6`, verheerend für einen Einmalcode.
   *
   * Ein Anker weniger kostet einen schwächeren Anker weiter unten in der
   * Kaskade. Ein Einmalcode im Ablauf kostet das Konto.
   *
   * @param {string} text
   * @returns {boolean} wahr, wenn nichts dagegen spricht
   */
  function textHarmlos(text) {
    const s = String(text == null ? "" : text).trim();
    if (!s) return true; // nichts da, nichts zu verraten
    const kern = kernVon(s);
    if (/^[0-9]+$/.test(kern)) {
      if (kern.length >= ZIFFERN_MINDEST && kern.length <= ZIFFERN_HOECHSTENS) return false;
    }
    if (luhnGueltig(kern)) return false;
    /* Der Einmalcode in Grossbuchstaben und Ziffern, wie ihn Authenticator und
       Wiederherstellungsschlüssel ausgeben: „A3F9C2", „7KD4-9PX2". Ein Wort
       ohne Ziffern fällt nicht darunter, ein Satz ebenso wenig. */
    if (/^[A-Z0-9]{6,12}$/.test(kern) && /[0-9]/.test(kern) && /[A-Z]/.test(kern)) return false;
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Der Beleg — und nur er gibt frei
   * ------------------------------------------------------------------ */

  /**
   * Womit weist dieses Feld nach, dass es ein gewöhnliches Formularfeld ist?
   *
   * @returns {{quelle: string, wert: string}|null} null heisst: kein Nachweis
   */
  function harmlosBeleg(el) {
    const typ = feldTyp(el);
    if (HARMLOS_TYP.has(typ)) return { quelle: "feldtyp", wert: typ };
    for (const m of markenVon(el)) {
      if (HARMLOS_MARKEN.has(m)) return { quelle: "autocomplete", wert: m };
    }
    for (const beschrift of merkmaleVon(el)) {
      const flach = flachVon(beschrift);
      if (!flach) continue;
      for (const wort of HARMLOS_WORT) {
        if (flach.includes(wort)) return { quelle: "beschriftung", wert: wort };
      }
    }
    return null;
  }

  /* Erst hier wird gelesen, und nur hier. Jede Verweigerung oben kommt ohne
     diesen Zugriff aus — das ist der Unterschied, den §7.2 zwischen „wird
     nicht aufgezeichnet" und „wird gelesen und dann weggelassen" macht. */
  function wertLesen(el) {
    try {
      if (el.isContentEditable === true && marke(el) !== "INPUT" && marke(el) !== "TEXTAREA") {
        return el.textContent == null ? "" : String(el.textContent);
      }
      return el.value == null ? "" : String(el.value);
    } catch (_) {
      return "";
    }
  }

  /**
   * Darf der Inhalt dieses Feldes in einen gespeicherten Ablauf?
   *
   * Die eine Frage, um die es in dieser Datei geht. Die Reihenfolge ist Teil
   * der Zusage: Alles, was ohne den Wert zu entscheiden ist, wird ZUERST
   * entschieden. Der Wert wird erst gelesen, wenn Bauform, Umfeld, Feldreihe
   * und Beleg schon durch sind.
   *
   * @param {Element} el
   * @param {{wert?: string}} angaben `wert` nur für Prüfstände, die den Wert
   *        selbst mitbringen; im Betrieb liest diese Datei ihn selbst.
   * @returns {{ok:true, wert:string, beleg:string} | {ok:false, grund:string}}
   *
   * Wirft nie. Der Aufrufer bekommt eine Aussage, aus der er entweder einen
   * Wert oder einen Schritt `user_input_required` macht.
   */
  function wertFreigeben(el, angaben = {}) {
    if (!traegtInhalt(el)) return { ok: false, grund: "kein_feld" };
    if (geheim(el)) return { ok: false, grund: "feld_geheim" };
    if (geheimUmfeld(el)) return { ok: false, grund: "umfeld_geheim" };
    if (zifferngruppe(el)) return { ok: false, grund: "zifferngruppe" };

    const beleg = harmlosBeleg(el);
    /* Ein Feld ohne Nachweis im Umfeld eines Geheimnisses ist der Einmalcode
       neben dem Passwort. Ein Feld ohne Nachweis irgendwo sonst ist das
       Passwortfeld nach dem Klick aufs Auge (`name="pw"`, `type=text`). In
       beiden Fällen übernimmt der Mensch. */
    if (!beleg) {
      return { ok: false, grund: imGeheimAbschnitt(el) ? "abschnitt_geheim" : "unbelegt" };
    }

    const roh = angaben.wert === undefined ? wertLesen(el) : String(angaben.wert);
    const kern = kernVon(roh);
    /* Auch ein belegtes Feld kann eine Kartennummer tragen: Ein Shop, der
       seine Zahlungsmaske aus demselben Bauteil baut wie seine Adressmaske,
       nennt das Feld dann „nummer". Die Luhn-Prüfziffer sagt es trotzdem. */
    if (luhnGueltig(kern)) return { ok: false, grund: "kartennummer" };
    /* Und die Bauform des Kästchens sagt es auch dann, wenn der Name harmlos
       klingt: Ein kurzes Feld, das nur Ziffern annimmt, mit einer reinen
       Ziffernkette darin, ist ein Code. Eine Bestellnummer in einem Feld ohne
       Längenbegrenzung bleibt davon unberührt. */
    if (/^[0-9]+$/.test(kern) && kern.length >= ZIFFERN_MINDEST && codeKasten(el)) {
      return { ok: false, grund: "codegestalt" };
    }
    return { ok: true, wert: roh, beleg: beleg.quelle };
  }

  /* ------------------------------------------------------------------ *
   * Der Name eines Elements — für die Rückfrage und für die Identität
   * ------------------------------------------------------------------ */

  /* Dieselbe Liste wie `STEUERZEICHEN` in `befehle.js`. Was in einen Ablauf
     geschrieben wird, hat ein Mensch später zu lesen oder vorgelesen zu
     bekommen. */
  const STEUERZEICHEN =
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

  function kuerzen(roh, grenze) {
    const s = String(roh == null ? "" : roh)
      .replace(STEUERZEICHEN, " ")
      .replace(/\s+/g, " ")
      .trim();
    return s.length <= grenze ? s : `${s.slice(0, grenze - 1)}…`;
  }

  /**
   * Wie heisst dieses Element für einen Menschen?
   *
   * Sie steht hier und nicht in `rekorder.js`, aus zwei Gründen. Erstens ist
   * die Beschreibung eine Leckstelle: Befund B6 hat den Einmalcode genau hier
   * herausgetragen, also gehört sie hinter dieselbe Prüfung wie der Anker.
   * Zweitens ist sie ab Festlegung F3 vom 14.08.2026 der Vergleichspartner
   * für die Identität: `overlay:kaskade` antwortet mit `name`, der Ausführer
   * hält ihn gegen `schritt.beschreibung` des Ablaufs. Beide Seiten müssen
   * denselben Namen bilden, sonst meldet der Vergleich einen Unterschied, wo
   * nur zwei Funktionen verschieden geraten haben.
   *
   * Ausdrücklich ohne Inhalt: Bei allem, was etwas trägt — Eingabefeld,
   * Auswahlliste, bearbeitbarer Bereich —, ist der Text IM Element das
   * Getippte.
   */
  function beschreibungVon(el, grenze = BESCHREIBUNG_ZEICHEN) {
    if (!el || el.nodeType !== 1) return "";
    const kandidaten = [merkmal(el, "aria-label"), merkmal(el, "title")];
    const doc = dokument();
    const bez = merkmal(el, "aria-labelledby");
    if (bez && doc && typeof doc.getElementById === "function") {
      for (const id of bez.split(/\s+/)) {
        try {
          const n = id && doc.getElementById(id);
          if (n) kandidaten.push(n.textContent || "");
        } catch (_) {
          /* kein Etikett unter dieser Kennung */
        }
      }
    }
    if (!traegtInhalt(el)) kandidaten.push(el.textContent || "");
    kandidaten.push(merkmal(el, "placeholder"), merkmal(el, "alt"), merkmal(el, "name"));
    for (const k of kandidaten) {
      const s = kuerzen(k, grenze);
      if (!s) continue;
      /* Der Befund B6 an genau dieser Stelle: Die Beschreibung des
         Einmalcode-Feldes WAR der Einmalcode. */
      if (!textHarmlos(s)) continue;
      return s;
    }
    return kuerzen(marke(el).toLowerCase(), grenze);
  }

  globalThis.SMARTR_GEHEIM = Object.freeze({
    geheim,
    geheimUmfeld,
    imGeheimAbschnitt,
    abschnitteVon,
    zifferngruppe,
    codeKasten,
    wertFreigeben,
    harmlosBeleg,
    textHarmlos,
    luhnGueltig,
    beschreibungVon,
    beschriftungVon,
    traegtInhalt,
    VERBOT_GRUND,
    BESCHREIBUNG_ZEICHEN,
    /* Offen für die Prüfsätze: Die Listen sind die einzige Regel hier, die man
       am Ergebnis nicht ablesen kann — ein nicht aufgezeichneter Wert sieht
       aus wie ein Wert, den es nie gab. */
    GEHEIME_MARKEN,
    GEHEIM_WORT,
    GEHEIM_TEIL,
    CODE_HARMLOS,
    HARMLOS_TYP,
    HARMLOS_MARKEN,
    HARMLOS_WORT,
  });
})();
