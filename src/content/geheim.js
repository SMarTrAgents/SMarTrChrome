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
 *
 * ------------------------------------------------------------------------
 * NACHTRAG 14.08.2026, zweite Abnahme (TEACH-1 bis TEACH-4 und TEACH-7).
 *
 * Die Richtung stimmte, die MESSUNG nicht. Jede Formprüfung lief gegen die
 * GANZE Zeichenkette, und ein Geheimnis tritt fast nie allein auf, sondern
 * in einem Satz. Gemessen am echten Rekorderlauf:
 *
 *   - `textHarmlos("849271")` war falsch, `textHarmlos("Dein Code lautet
 *     849271")` aber wahr. Derselbe Code landete danach im Textanker, in der
 *     Beschreibung und im Etikett eines `select`-Schrittes. Dasselbe für
 *     „Ihre Kartennummer 4111111111111111".
 *   - `harmlosBeleg` prüfte `flach.includes(wort)` über die ganze
 *     Etikettzeile. „Wir haben dir eine E-Mail geschickt, trag die sechs
 *     Ziffern hier ein" enthält „mail", also galt das Feld als belegt
 *     harmlos, und der Einmalcode wurde als `value` gespeichert — obwohl im
 *     selben Formular ein `type=password` stand.
 *   - Die Formprüfung kannte nur reine Ziffern, Luhn und `^[A-Z0-9]{6,12}$`.
 *     Durch kamen `a3f9c2`, `sk-live-9f3a2b`, `a1b2c-3d4e5` — also genau die
 *     Wiederherstellungsschlüssel, die GitHub, Discord und die
 *     Authenticator-Verfahren ausgeben.
 *
 * Vier Sätze halten das ab hier zusammen:
 *
 *   1. Gesucht wird als TEILKETTE. Eine Ziffernkette, eine Luhn-Nummer und
 *      ein Mischcode zählen auch mitten im Satz (`geheimGestalt`).
 *   2. Ein Beleg ist eine BEZEICHNUNG, kein Wort in einem Satz. Ein Etikett
 *      aus dreizehn Wörtern benennt kein Feld, es erklärt eine Seite.
 *   3. Neben einem Geheimfeld muss auch die GESTALT des Wertes harmlos sein.
 *      „julian" bleibt „julian", „849271" wird zur Übergabe an den Menschen.
 *   4. Wo nur noch der Elementname übrig bleibt, sagt `beschreibungVon` das
 *      (`OHNE_NAMEN`), statt still „input" zu antworten. Zwei verschiedene
 *      Felder hiessen sonst beide „input", und die Identitätswache aus F3
 *      verglich zwei Namen, die keine sind.
 *
 * Gemessen wird jede dieser vier Zusagen über den Produktivweg in
 * `pruefung/rekorder.test.mjs` und `pruefung/selektor.test.mjs`.
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

  /* Die Vorsilbe, mit der `beschreibungVon` sagt: Was hier steht, ist der
     ELEMENTNAME und kein Name. Sie steht als Vorsilbe und nicht als eigenes
     Feld, weil die Beschreibung durch `chrome.runtime.sendMessage`, durch
     `sa_workflows` und durch `schritt.beschreibung` läuft — überall dort ist
     sie eine Zeichenkette, und ein zweites Feld wäre auf jedem dieser Wege
     einzeln nachzuziehen. Ein Feld, das nur an einer Stelle mitwandert, ist
     genau die Art Zusage, die am 11.08.2026 grün geprüft und ungenutzt
     ausgeliefert wurde. */
  const OHNE_NAMEN = "ohne-namen:";

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

  /* Eingebettet in einen längeren Text zählt erst die FÜNFTE Stelle.
     Der Unterschied ist gemessen und keine Bequemlichkeit: Eine
     vierstellige Ziffernkette mitten in einem Satz ist eine Jahreszahl, ein
     Preis oder eine Hausnummer („Angebot vom 14.08.2026 bearbeiten"), und
     wer sie verwirft, verliert die Beschreibung jedes zweiten Knopfes und
     bekommt dafür eine Rückfrage, die nichts schützt. Allein stehend bleibt
     dieselbe Kette bei vier Stellen ein Code — dort steht kein Satz drum
     herum, der sie erklären könnte. */
  const ZIFFERN_EINGEBETTET = 5;

  /* Ab wann Ziffergruppen als EINE Nummer gelesen werden: gleich lange
     Gruppen ab drei Stellen. „4111 1111 1111 1111" ist eine Kartennummer,
     „14 08 2026" sind drei Zahlen, und „12 34" sind zwei. */
  const GRUPPE_MINDEST = 3;

  /* Nachtrag 15.08.2026 (Nachabnahme 0.6.0): An Leerzeichen und Bindestrich
     fusionieren wie bisher schon ZWEI Gruppen („849 271" ist der Einmalcode,
     wie ihn jede 2FA-Seite anzeigt). Jeder ANDERE Trenner braucht drei —
     sonst würde aus „100.000 Euro" und „100,000" im Fliesstext ein Code, und
     eine Wache, die jeden zweiten Preis frisst, wird abgeschaltet statt
     gelesen. Eine Kartennummer hat vier Gruppen, ein gegliederter Einmalcode
     mindestens drei; beide liegen über dieser Schwelle. */
  const GRUPPE_FREMDTRENNER_MINDEST = 3;

  /* Wie lang ein Merkmal höchstens sein darf, damit es noch eine BEZEICHNUNG
     ist und nicht ein Satz. Befund TEACH-3 vom 14.08.2026: „Wir haben dir
     eine E-Mail geschickt, trag die sechs Ziffern hier ein" enthält „mail"
     und gab damit einen Einmalcode frei. Ein Feld heisst „E-Mail", es heisst
     nicht in dreizehn Wörtern. */
  const BEZEICHNUNG_WOERTER = 6;
  const BEZEICHNUNG_ZEICHEN = 60;

  /* Ein Wiederherstellungsschlüssel wird in gleich langen Gruppen ausgegeben
     („abcd efgh ijkl mnop"). Vier Gruppen sind das Mindeste, das man von
     einem Satz unterscheiden kann. */
  const GRUPPENKETTE_MINDEST = 4;

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

  /* Feldarten, die sich selbst erklären, weil sie die GESTALT des Inhalts
     festlegen: In ein `type=date` passt kein Einmalcode. `text` und `number`
     stehen bewusst NICHT dabei — ein Einmalcode ist beides. */
  const HARMLOS_TYP = new Set([
    "email", "url", "date", "datetime-local",
    "month", "week", "time", "color",
  ]);

  /* Befund TEACH-7 vom 14.08.2026: `type="tel"` war ein bedingungsloser
     Beleg, und `<input id="s" type="tel" value="849271">` ergab
     `{"ok":true,"wert":"849271","beleg":"feldtyp"}`. Auf Bestätigungs- und
     Zahlungsmasken ist `tel` die übliche Wahl, weil sie die Zifferntastatur
     öffnet — über den INHALT sagt sie damit nichts, sie sagt etwas über die
     Tastatur. Dasselbe gilt für `search`: Es beschreibt, wo das Feld steht,
     nicht was darin liegt.
     Beide sind ab hier gar kein Beleg mehr. Sie brauchen dafür auch keine
     eigene Regel: Ein Feld, das wirklich ein Telefonfeld ist, heisst
     „telefon", „mobil" oder „handy" und ist damit über seine BEZEICHNUNG
     belegt — denselben Weg gehen alle anderen Felder auch. Ein Feld, das nur
     `tel` heisst, ist eine Tastaturwahl und kein Nachweis. */

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

  /**
   * Benennt dieser Text ein Geheimnis?
   *
   * Die Wörterfrage aus `geheim()`, herausgezogen und benannt. Sie steht hier
   * einzeln, weil sie ab dem 14.08.2026 an einer zweiten Stelle gebraucht
   * wird: `rekorder.js` fragt sie für den NAMEN eines Adressparameters
   * (`?token=…`, `#access_token=…`). Zwei Abschriften derselben Wortlisten
   * wären genau der Befund, den Festlegung F4 abgeschafft hat — also eine
   * Funktion, zwei Aufrufer.
   *
   * @param {string} text ein einzelnes Merkmal, nie mehrere aneinandergehängt
   * @returns {boolean}
   */
  function bezeichnungGeheim(text) {
    for (const wort of woerterVon(text)) {
      if (GEHEIM_WORT.has(wort)) return true;
    }
    const flach = flachVon(text);
    if (!flach) return false;
    if (GEHEIM_TEIL.some((t) => flach.includes(t))) return true;
    return codeGeheim(flach);
  }

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

    /* Jedes Merkmal für sich, wie die Wortstücke auch: Eine Beschriftung
       „Gutscheincode" darf ein Feld namens „cvv" nicht harmlos machen. */
    for (const beschrift of merkmaleVon(el)) {
      if (bezeichnungGeheim(beschrift)) return true;
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
    if (mass > CODE_KASTEN_HOECHSTENS) return false;
    const art = feldTyp(el);
    const nurZiffern =
      art === "number" ||
      merkmal(el, "inputmode").toLowerCase() === "numeric" ||
      /\\d|\[0-9\]/.test(merkmal(el, "pattern"));
    if (!nurZiffern) return false;
    if (mass) return true;
    /* Befund TEACH-7 vom 14.08.2026: `kastenMass` gibt ohne `maxlength` 0
       zurück, `codeKasten` stieg deshalb sofort mit false aus, und ein Feld
       ohne Längenbegrenzung gab jeden kurzen Zahlencode frei. `maxlength` ist
       aber die Kür, nicht die Pflicht — die halbe Netzwelt setzt statt dessen
       nur `inputmode="numeric"`.
       Ohne Längenbegrenzung zählt deshalb der zweite Hinweis: eine
       ausdrückliche Zifferntastatur ODER ein Muster, das eine feste Länge
       verlangt. Eine Mengenangabe (`type=number`) fällt bewusst NICHT
       darunter — sie ist der Alltag jedes Warenkorbs, und ihre Zahl ist
       kurz. */
    if (merkmal(el, "inputmode").toLowerCase() === "numeric") return true;
    return /\{\s*\d+\s*(,\s*\d*\s*)?\}/.test(merkmal(el, "pattern"));
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

  /* Spiegel der Unsichtbaren-Tabelle aus `src/gemeinsam/messform.js`,
     erweitert um die echten Steuerzeichen (C0/C1) — OHNE die
     Weissraum-Zeichen \t \n \v \f \r: Die bedeuten eine sichtbare Lücke und
     bleiben Weissraum; alles andere hier hat keine Breite und fällt
     ersatzlos weg. Die Tabelle steht hier ein zweites Mal, weil der
     Teach-Modus `geheim.js` OHNE `messform.js` einspielt (REKORDER_DATEIEN
     in `worker.js`): Eine Gestaltprüfung, die dort nach `SMARTR_MESSFORM`
     griffe, griffe genau im Teach-Modus ins Leere — die Bauform vom
     11.08.2026, grün geprüft und im Betrieb tot. Der Prüfsatz
     `geheim-gestalt.test.mjs` hält beide Tabellen gegeneinander: Fehlt hier
     ein Zeichen, das `messform.js` als unsichtbar führt, wird er rot. */
  const GESTALT_UNSICHTBAR = new RegExp(
    "[\\u0000-\\u0008\\u000e-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c" +
      "\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180e\\u200b-\\u200f\\u202a-\\u202e" +
      "\\u2060-\\u2064\\u2066-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\ufff9-\\ufffb\\uffa0]" +
      "|[\\u{e0000}-\\u{e0fff}]",
    "gu"
  );

  /* Die Vollbreiten-Ziffern von Hand statt allein über NFKC: `normalize`
     kann eine fremde Seite überschrieben haben, und die belegten Umgehungen
     der Nachabnahme 0.6.0 hängen an genau dieser Faltung. Der Abstand ist
     im Standard fest: U+FF10 „０“ liegt 0xFEE0 über U+0030 „0“. */
  const VOLLBREIT_ZIFFER = /[\uff10-\uff19]/g;

  /**
   * Die Form, in der eine GESTALT gemessen wird.
   *
   * Nachtrag 15.08.2026 (Nachabnahme 0.6.0): Jede Formprüfung dieser Datei
   * lief gegen den ROHEN Text, und die Seite durfte sich ihre Schreibweise
   * aussuchen — Vollbreiten-Ziffern („８４９２７１“), nullbreit getrennte
   * Ziffern und Formatzeichen liefen an `kernVon` und `ziffernketten` vorbei
   * in den gespeicherten Ablauf. Dieselbe Fehlerklasse wie AUTOMODUS-1: Es
   * wird gemessen, ohne vorher zu normalisieren.
   *
   * Deshalb läuft ab hier ALLES, was eine Gestalt misst, zuerst durch diese
   * Form: Vollbreiten-Ziffern auf ASCII, NFKC für den Rest der
   * Kompatibilitätszeichen, Format- und Nullbreiten-Zeichen ersatzlos weg.
   * Sie ersetzt ausdrücklich NICHT die Wortmessung aus `messform.js` — dort
   * geht es um WÖRTER (Kleinschreibung, Umlautersatz, sichtgleiche
   * Buchstaben), hier um ZIFFERNGESTALTEN, und der Teach-Modus spielt diese
   * Datei ohne `messform.js` ein.
   *
   * @param {string} roh
   * @returns {string}
   */
  function gestaltform(roh) {
    let s = String(roh == null ? "" : roh);
    if (!s) return "";
    s = s.replace(VOLLBREIT_ZIFFER, (z) => String.fromCharCode(z.charCodeAt(0) - 0xfee0));
    try {
      if (typeof s.normalize === "function") s = s.normalize("NFKC");
    } catch (_) {
      /* Ohne Faltung weitermessen: weniger gefaltet ist schlechter als
         gefaltet, aber die Ziffern oben sind schon gefaltet, und die Trenner
         unten fallen trotzdem. */
    }
    return s.replace(GESTALT_UNSICHTBAR, "");
  }

  /* Trenner, die eine Kartennummer oder einen Code lesbar machen sollen. Sie
     gehören nicht zum Wert, also fallen sie vor der Messung heraus.

     Nachtrag 15.08.2026 (Nachabnahme 0.6.0): Hier standen nur Weissraum,
     Punkt, Bindestrich und Schrägstrich — und belegt durchgerutscht sind
     der Unterstrich („4111_1111_1111_1111“), das Komma, der Mittelpunkt
     U+00B7 und der geschützte Bindestrich U+2011. Ab jetzt steht die
     FAMILIE: alles, womit ein Mensch oder eine Seite eine Nummer gliedert —
     Weissraum, Punkt, Komma, Unterstrich, Schrägstrich, die Apostrophe
     (Schweizer Tausendergliederung), Aufzählungs- und Mittelpunkte und die
     Bindestrich-Familie U+2010–U+2015 samt Minus U+2212.

     Bewusst NICHT dabei: der Doppelpunkt („12:45“ ist eine Uhrzeit, und ein
     Fahrplan besteht aus Uhrzeiten) und die Klammern („(030) 1234“ ist eine
     Telefonnummer). Wer sie als Trenner missbraucht, läuft in die
     Gruppenregel von `ziffernketten`: Drei und mehr gleich lange Gruppen
     fusionieren dort an JEDEM Zeichen. */
  const NUMMERN_TRENNER = new RegExp(
    "[\\s.,\\-/_'\u2018\u2019\u0060\u00b4\u00b7\u2022\u2027\u2219\u22c5\u2010-\u2015\u2212]",
    "g"
  );

  const kernVon = (roh) => gestaltform(roh).replace(NUMMERN_TRENNER, "");

  /**
   * Alle Ziffernketten eines Textes, in der Lesart, in der ein Mensch sie
   * schreibt.
   *
   * Gleich lange Gruppen ab drei Stellen werden zusammengezogen, alles andere
   * bleibt getrennt. Ohne diese Unterscheidung wäre „4111 1111 1111 1111"
   * vier harmlose Zahlen und „14.08.2026" ein achtstelliger Code — also
   * genau verkehrt herum.
   *
   * @param {string} text
   * @returns {string[]} die Ketten, ohne Trenner
   */
  function ziffernketten(text) {
    const raus = [];
    /* Nachtrag 15.08.2026 (Nachabnahme 0.6.0): Zusammengezogen wird an JEDEM
       einzelnen Nicht-Ziffern-Zeichen, nicht mehr nur an Leerzeichen und
       Bindestrich — „4111,1111,1111,1111“ ist dieselbe Kartennummer. Die
       Trennerwahl liegt sonst bei der Seite, und eine Wache, deren
       Zeichenliste der Angreifer aussucht, ist keine. Zwei Deckel halten den
       Alltag drin: Gruppen UNGLEICHER Länge bleiben getrennt (das Datum
       „14.08.2026“, der Preis „1.234,56“), und bei jedem Trenner ausser
       Leerzeichen und Bindestrich braucht es DREI gleiche Gruppen
       (`GRUPPE_FREMDTRENNER_MINDEST`), damit „100.000 Euro“ ein Preis
       bleibt. Ein Zeichen ausserhalb der Grundebene (ein Emoji als Zierde)
       zählt über sein Ersatzpaar ebenfalls als EIN Trenner. */
    const gruppen =
      gestaltform(text).match(
        /[0-9]+(?:(?:[\ud800-\udbff][\udc00-\udfff]|[^0-9A-Za-zÄÖÜäöüß])[0-9]+)*/g
      ) || [];
    for (const gruppe of gruppen) {
      const teile = gruppe.split(/[^0-9]+/).filter(Boolean);
      const gleichLang = teile.every((t) => t.length === teile[0].length);
      /* Nur Ziffern, Leerzeichen und Bindestrich: die Gliederung des
         Alltags — dort genügen wie bisher zwei Gruppen. */
      const alltag = !/[^0-9 \-]/.test(gruppe);
      const mindestGruppen = alltag ? 2 : GRUPPE_FREMDTRENNER_MINDEST;
      if (teile.length >= mindestGruppen && gleichLang && teile[0].length >= GRUPPE_MINDEST) {
        raus.push(teile.join(""));
        continue;
      }
      for (const t of teile) raus.push(t);
    }
    return raus;
  }

  /**
   * Hat dieses EINE Wort die Gestalt eines Codes?
   *
   * Befund TEACH-4 vom 14.08.2026: Erkannt wurden nur reine Ziffern, Luhn und
   * `^[A-Z0-9]{6,12}$`. Durch kamen `a3f9c2`, `sk-live-9f3a2b`,
   * `a1b2c-3d4e5`, `8s7d6f5g`, `kl4us-2026` — die übliche Ausgabe eines
   * Wiederherstellungsschlüssels.
   *
   * Die Regel, die sie alle fasst, ohne halbe Seiten mitzunehmen: Ziffern und
   * Buchstaben wechseln sich ab, es gibt also MEHRERE getrennte Ziffernläufe.
   * Ein Wort mit einer Zahl am Ende hat genau einen — „iPhone13",
   * „Windows10", „MP3-Player", „hunter2" bleiben damit stehen. Das ist eine
   * ausgeschriebene Entscheidung und keine Lücke: Ein Passwort dieser Gestalt
   * hängt am Feld (`type=password`, `name=pw`, kein Beleg) und nicht an
   * seiner Schreibweise, und die Anker der halben Seite wegzuwerfen, kostet
   * jedes Abspielen.
   *
   * @param {string} roh ein einzelnes Wort, nie ein Satz
   * @returns {string|null} Name der Regel, die zugeschlagen hat
   */
  function tokenGestalt(roh) {
    const kern = kernVon(roh);
    if (kern.length < 6) return null;
    if (!/[A-Za-z]/.test(kern)) return null; // reine Ziffern: eigene Regel
    /* Der Einmalcode in Grossbuchstaben und Ziffern, wie ihn Authenticator
       und Wiederherstellungsschlüssel ausgeben: „A3F9C2", „7KD4-9PX2". */
    if (/^[A-Z0-9]{6,12}$/.test(kern) && /[0-9]/.test(kern) && /[A-Z]/.test(kern)) {
      return "grosscode";
    }
    if ((kern.match(/[0-9]+/g) || []).length >= 2) return "mischcode";
    return null;
  }

  /**
   * Steckt in diesem Text ein Geheimnis — und wenn ja, welcher Art?
   *
   * Befund B6 vom 14.08.2026: Auf einer 2FA-Seite wurde
   * `<span class="otp-anzeige">849271</span>` zum Anker `text=849271` und zur
   * `beschreibung` „849271", und `<button data-code="849271">` zum Anker
   * `[data-code="849271"]`. Der Textanker kannte KEINERLEI Geheimprüfung.
   *
   * Befund TEACH-2 vom 14.08.2026, dieselbe Stelle ein zweites Mal: Die
   * Reparatur zu B6 mass die GANZE Kette. „849271" war verboten, „Dein Code
   * lautet 849271" erlaubt — und genau so steht ein Code auf einer Seite.
   * Deshalb wird ab hier als TEILKETTE gesucht.
   *
   * Jede Regel trägt ihren Namen, damit ein Prüfsatz sie einzeln halten kann
   * statt nur das Ergebnis (dieselbe Bauart wie `ZUFALL_REGELN` in
   * `selektor.js`).
   *
   * @param {string} text
   * @returns {string|null} null heisst: nichts dagegen
   */
  function geheimGestalt(text) {
    const s = String(text == null ? "" : text).trim();
    if (!s) return null; // nichts da, nichts zu verraten
    const kern = kernVon(s);
    /* Die ganze Kette allein: hier zählt schon die vierte Stelle. */
    if (/^[0-9]+$/.test(kern)) {
      if (kern.length >= ZIFFERN_MINDEST && kern.length <= ZIFFERN_HOECHSTENS) return "ziffernkette";
    }
    if (luhnGueltig(kern)) return "kartennummer";
    /* Und jede Kette IM Text, ab der fünften Stelle. Die Prüfziffer zählt
       auch hier: Eine Kartennummer mitten in einem Satz ist eine
       Kartennummer. */
    for (const kette of ziffernketten(s)) {
      if (luhnGueltig(kette)) return "kartennummer";
      if (kette.length >= ZIFFERN_EINGEBETTET) return "ziffernkette";
    }
    for (const wort of s.split(/\s+/)) {
      const regel = tokenGestalt(wort);
      if (regel) return regel;
    }
    return null;
  }

  /**
   * Darf dieser Text in einen Anker, eine Beschreibung oder ein Etikett?
   *
   * Ein Anker weniger kostet einen schwächeren Anker weiter unten in der
   * Kaskade. Ein Einmalcode im Ablauf kostet das Konto.
   *
   * @param {string} text
   * @returns {boolean} wahr, wenn nichts dagegen spricht
   */
  function textHarmlos(text) {
    return geheimGestalt(text) === null;
  }

  /**
   * Die Gestalt eines FELDINHALTS.
   *
   * Sie ist nicht dieselbe Frage wie die eines Textes, und der Unterschied
   * ist die eigentliche Arbeit dieser Datei: Eine reine Ziffernkette IST der
   * Inhalt einer Artikelnummer, einer Bestellnummer und einer Postleitzahl.
   * Wer sie im Wert verbietet, hat den Teach-Modus abgeschafft, nicht
   * gesichert — deshalb entscheidet über reine Ziffern weiterhin das FELD
   * (`geheim`, `zifferngruppe`, `codeKasten`) und nicht der Wert.
   *
   * Was der Wert allein entscheidet, ist alles, was keine Zahl mehr ist: die
   * Luhn-Prüfziffer, der Mischcode und die Gruppenkette eines
   * Wiederherstellungsschlüssels.
   *
   * @param {string} roh
   * @returns {string|null} Name der Regel, oder null
   */
  function wertGestalt(roh) {
    const s = String(roh == null ? "" : roh).trim();
    if (!s) return null;
    if (luhnGueltig(kernVon(s))) return "kartennummer";
    for (const kette of ziffernketten(s)) {
      if (luhnGueltig(kette)) return "kartennummer";
    }
    for (const wort of s.split(/\s+/)) {
      const regel = tokenGestalt(wort);
      if (regel) return regel;
    }
    if (gruppenkette(s)) return "gruppenkette";
    return null;
  }

  /**
   * Spricht das ein Mensch aus?
   *
   * Kein Vokal, oder drei Mitlaute am Stück. Dieselbe Frage wie `vokallos` in
   * `selektor.js`, nur eine Stufe genauer: „efgh" trägt ein „e" und ist
   * trotzdem kein Wort. Was ein Mensch nicht aussprechen kann, hat auch
   * keiner vergeben.
   */
  const unaussprechbar = (t) =>
    !/[aeiouyäöü]/i.test(t) || /[bcdfghjklmnpqrstvwxzß]{3,}/i.test(t);

  /**
   * Vier und mehr gleich lange Gruppen, von denen die meisten kein Wort sind:
   * die Ausgabe eines Wiederherstellungsschlüssels („abcd efgh ijkl mnop",
   * „x7f2 k9p3 q8r1 m5n2").
   *
   * Die Gleichlänge allein genügt nicht: „Haus Baum Ball Wald" sind ebenfalls
   * vier gleich lange Gruppen. Den Unterschied macht, ob ein Mensch sie
   * aussprechen würde.
   *
   * Was diese Regel NICHT fängt und auch nicht fangen kann, steht hier, damit
   * es niemand für erledigt hält: eine aufgeschriebene Merkwortfolge aus
   * echten Wörtern („abandon ability able about"). Sie ist von einem Satz an
   * ihrer Gestalt nicht zu unterscheiden. Dagegen schützt das FELD und nicht
   * der Wert — „seed", „recovery", „wiederherstell" gehören in `GEHEIM_TEIL`,
   * sobald jemand eine Maske dieser Art misst.
   */
  function gruppenkette(text) {
    const teile = gestaltform(text).trim().split(/[\s\-]+/).filter(Boolean);
    if (teile.length < GRUPPENKETTE_MINDEST) return false;
    if (!teile.every((t) => /^[A-Za-z0-9]{3,8}$/.test(t))) return false;
    if (!teile.every((t) => t.length === teile[0].length)) return false;
    return teile.filter(unaussprechbar).length * 2 >= teile.length;
  }

  /**
   * Darf dieser FELDINHALT in einen gespeicherten Ablauf?
   *
   * @param {string} roh
   * @returns {boolean}
   */
  function wertHarmlos(roh) {
    return wertGestalt(roh) === null;
  }

  /* ------------------------------------------------------------------ *
   * Der Beleg — und nur er gibt frei
   * ------------------------------------------------------------------ */

  /**
   * Ist dieses Merkmal eine BEZEICHNUNG — also etwas, das ein Feld benennt?
   *
   * Befund TEACH-3 vom 14.08.2026: `harmlosBeleg` prüfte `flach.includes(wort)`
   * über die ganze Etikettzeile. Die Beschriftung „Wir haben dir eine E-Mail
   * geschickt, trag die sechs Ziffern hier ein" enthält „mail", also galt das
   * Feld als belegt harmlos, und `wertFreigeben` schrieb den Einmalcode als
   * `value` in den Ablauf.
   *
   * Ein Feld heisst „E-Mail". Es heisst nicht in dreizehn Wörtern. Was so
   * lang ist, erklärt eine Seite, und eine Erklärung ist kein Nachweis.
   *
   * Die Lücke kostet hier ausdrücklich nichts als eine Rückfrage: Ein Feld
   * mit einem erklärenden Satz statt eines Namens wird `user_input_required`,
   * und der Mensch füllt es beim Abspielen einmal aus.
   */
  function bezeichnungTaugt(text) {
    const woerter = woerterVon(text);
    if (!woerter.length || woerter.length > BEZEICHNUNG_WOERTER) return false;
    return flachVon(text).length <= BEZEICHNUNG_ZEICHEN;
  }

  /**
   * Trägt diese Bezeichnung ein Wort aus `HARMLOS_WORT`?
   *
   * Gesucht wird das Wortstück INNERHALB eines einzelnen Wortes und nicht in
   * der zusammengezogenen Zeile. „artikelnummer" trägt „artikel", das soll
   * so sein. „Alp Assistent" ergäbe zusammengezogen „pass" — ein Fund, den es
   * nicht gibt, und in der anderen Richtung genau derselbe Fehler wie oben.
   */
  function harmlosWortIn(text) {
    for (const wort of woerterVon(text)) {
      for (const stueck of HARMLOS_WORT) {
        if (wort.includes(stueck)) return stueck;
      }
    }
    return "";
  }

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
      if (!bezeichnungTaugt(beschrift)) continue;
      const treffer = harmlosWortIn(beschrift);
      if (treffer) return { quelle: "beschriftung", wert: treffer };
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
    /* Auch diese Frage wird VOR dem Lesen beantwortet, obwohl sie erst weiter
       unten noch einmal gebraucht wird. Sie hängt am Baum und nicht am Wert,
       und zweimal denselben Abschnitt abzulaufen kostet auf einer grossen
       Seite mehr als eine Zeile hier. */
    const nebenGeheimnis = imGeheimAbschnitt(el);
    /* Ein Feld ohne Nachweis im Umfeld eines Geheimnisses ist der Einmalcode
       neben dem Passwort. Ein Feld ohne Nachweis irgendwo sonst ist das
       Passwortfeld nach dem Klick aufs Auge (`name="pw"`, `type=text`). In
       beiden Fällen übernimmt der Mensch. */
    if (!beleg) {
      return { ok: false, grund: nebenGeheimnis ? "abschnitt_geheim" : "unbelegt" };
    }

    const roh = angaben.wert === undefined ? wertLesen(el) : String(angaben.wert);
    const kern = kernVon(roh);
    /* Auch ein belegtes Feld kann eine Kartennummer, einen
       Wiederherstellungsschlüssel oder einen Mischcode tragen: Ein Shop, der
       seine Zahlungsmaske aus demselben Bauteil baut wie seine Adressmaske,
       nennt das Feld dann „nummer". Die Prüfziffer und die Gestalt sagen es
       trotzdem (Befund TEACH-4: `a1b2c-3d4e5` stand mit
       `"beleg":"beschriftung"` im Ablauf). */
    const gestalt = wertGestalt(roh);
    if (gestalt) return { ok: false, grund: gestalt === "kartennummer" ? "kartennummer" : "wertgestalt" };
    /* Und die Bauform des Kästchens sagt es auch dann, wenn der Name harmlos
       klingt: Ein kurzes Feld, das nur Ziffern annimmt, mit einer reinen
       Ziffernkette darin, ist ein Code. Eine Bestellnummer in einem Feld ohne
       Zifferntastatur bleibt davon unberührt. */
    if (/^[0-9]+$/.test(kern) && kern.length >= ZIFFERN_MINDEST && codeKasten(el)) {
      return { ok: false, grund: "codegestalt" };
    }
    /* Befund TEACH-3 vom 14.08.2026: Der Riegel `abschnitt_geheim` griff
       ausdrücklich NUR bei Feldern OHNE Beleg. Ein Feld mit der Beschriftung
       „Bestellung bestaetigen" trug damit den Einmalcode in den Ablauf,
       obwohl im selben `<form>` ein `type=password` stand.
       Neben einem Geheimfeld muss deshalb auch die Gestalt des Wertes
       harmlos sein — und dort zählt die reine Ziffernkette mit, die ein Feld
       an jeder anderen Stelle der Seite tragen dürfte. Der Grund steht
       daneben: Wer neben einem Passwortfeld sechs Ziffern eintippt, tippt
       keine Bestellnummer.
       Was der Mensch dort wirklich schreibt, bleibt: „julian" ist auch neben
       einem Passwortfeld ein Benutzername (gemessen in R4 und R36). */
    if (nebenGeheimnis && !textHarmlos(roh)) {
      return { ok: false, grund: "abschnitt_geheim" };
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
  function beschreibungBefund(el, grenze = BESCHREIBUNG_ZEICHEN) {
    if (!el || el.nodeType !== 1) return { text: "", quelle: "kein_element", benannt: false };
    const kandidaten = [
      ["aria-label", merkmal(el, "aria-label")],
      ["title", merkmal(el, "title")],
    ];
    const doc = dokument();
    const bez = merkmal(el, "aria-labelledby");
    if (bez && doc && typeof doc.getElementById === "function") {
      for (const id of bez.split(/\s+/)) {
        try {
          const n = id && doc.getElementById(id);
          if (n) kandidaten.push(["aria-labelledby", n.textContent || ""]);
        } catch (_) {
          /* kein Etikett unter dieser Kennung */
        }
      }
    }
    /* Befund TEACH-1 vom 14.08.2026: Genau hier fehlten `label[for]` und das
       umschliessende `<label>` — beim häufigsten Formularbau überhaupt. Zwei
       verschiedene Felder hiessen dann beide „input", `vergleichsform` machte
       daraus auf beiden Seiten " input ", und die Identitätswache aus F3 ging
       durch: Die Artikelnummer wurde ins Titelfeld getippt, und der Ablauf
       meldete Erfolg.
       Gelesen wird dieselbe Beschriftung, die `beschriftungVon` schon immer
       gelesen hat. Zwei Etikettbegriffe in einer Datei waren der Fehler; ab
       hier ist es einer. */
    for (const etikett of beschriftungVon(el)) kandidaten.push(["beschriftung", etikett]);
    if (!traegtInhalt(el)) kandidaten.push(["text", el.textContent || ""]);
    kandidaten.push(
      ["placeholder", merkmal(el, "placeholder")],
      ["alt", merkmal(el, "alt")],
      ["name", merkmal(el, "name")]
    );
    for (const [quelle, roh] of kandidaten) {
      const s = kuerzen(roh, grenze);
      if (!s) continue;
      /* Gemessen wird der UNGEKÜRZTE Text, zurückgegeben der gekürzte.
         Andersherum wäre die Kürzung die Wache: Ein Einmalcode hinter Zeichen
         400 fiele bei der Kürzung heraus und der Rest ginge als „harmlos"
         durch — dieselbe Bauform wie AUTOMODUS-2 vom selben Tag.
         Der Befund B6 an genau dieser Stelle: Die Beschreibung des
         Einmalcode-Feldes WAR der Einmalcode. */
      if (!textHarmlos(roh)) continue;
      return { text: s, quelle, benannt: true };
    }
    return { text: kuerzen(marke(el).toLowerCase(), grenze), quelle: "marke", benannt: false };
  }

  function beschreibungVon(el, grenze = BESCHREIBUNG_ZEICHEN) {
    const befund = beschreibungBefund(el, grenze);
    if (befund.benannt) return befund.text;
    if (!befund.text) return "";
    /* Der Elementname ist KEIN Name, und ab hier sagt die Antwort das auch.
       Vorher stand hier still „input" oder „button" — auf beiden Seiten des
       Identitätsvergleichs aus F3 dasselbe Wort, und die Wache verglich zwei
       Namen, die keine sind (Befund TEACH-1, zweimal gemessen: das falsche
       Eingabefeld und die falsche Tabellenzeile).
       Ein Wort, das nicht vorkommen kann: Ein echter Name mit einem
       Doppelpunkt darin behält ihn, aber keiner beginnt mit „ohne-namen:". */
    return `${OHNE_NAMEN}${befund.text}`;
  }

  /**
   * Sagt dieser Name „ich habe keinen Namen"?
   *
   * Für jeden, der einen aufgezeichneten Namen gegen einen frisch gelesenen
   * hält: Zwei namenlose Elemente sind nicht dasselbe Element, sie sind zwei
   * Elemente ohne Namen. Wer sie trotzdem gleichsetzt, hat die Wache
   * abgeschaltet.
   */
  function namenlos(text) {
    return String(text == null ? "" : text).startsWith(OHNE_NAMEN);
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
    wertHarmlos,
    /* Beide Gestaltprüfungen geben den NAMEN der Regel zurück, die
       zugeschlagen hat. Ein Prüfsatz, der nur das Ergebnis misst, kann nicht
       unterscheiden, ob die richtige Regel gegriffen hat oder eine andere
       zufällig auch — dieselbe Bauart wie `ZUFALL_REGELN` in `selektor.js`. */
    geheimGestalt,
    wertGestalt,
    ziffernketten,
    tokenGestalt,
    gestaltform,
    bezeichnungGeheim,
    bezeichnungTaugt,
    luhnGueltig,
    beschreibungVon,
    beschreibungBefund,
    namenlos,
    beschriftungVon,
    traegtInhalt,
    VERBOT_GRUND,
    OHNE_NAMEN,
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
