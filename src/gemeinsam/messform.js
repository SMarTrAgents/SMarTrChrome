/*
 * SMarTrChrome — die EINE Messform, für beide Seiten der Erweiterung.
 *
 * ====================================================================
 * WARUM ES DIESE DATEI GIBT
 * ====================================================================
 *
 * Abnahme vom 14.08.2026, Funde AUTOMODUS-1, AUTOMODUS-3 und AUTOMODUS-4.
 * Drei Fenster, eine Fehlerklasse:
 *
 *     Es wird verglichen, ohne vorher zu normalisieren,
 *     und es wird gekürzt, bevor gemessen wird.
 *
 * Gemessen wurde, in der Fassung davor:
 *
 *   - Ein Knopf mit dem barrierefreien Namen „Jetzt kau<U+200B>fen" liest sich
 *     für Auge und Vorleser als „Jetzt kaufen". `saeubern` ersetzte das
 *     unsichtbare Zeichen durch ein LEERZEICHEN, `flachmachen` machte aus
 *     jedem Nicht-Alphanumerischen ebenfalls ein Leerzeichen — übrig blieb
 *     „jetzt kau fen", das Wort „kaufen" stand nirgends, `hart=null`, und der
 *     Klick lief im Modus `auto` ohne eine einzige Rückfrage. Dasselbe mit
 *     U+00AD (weicher Trennstrich) und U+2060 (Wortverbinder), die in der
 *     Liste überhaupt fehlten, und dasselbe für `loeschen`, `captcha` und ein
 *     Feld namens „Passwort".
 *   - `navigate` auf `https://shop.de/%6Basse/%62ezahlen` lief im Modus `auto`
 *     ohne Rückfrage durch, die unkodierte Fassung `/kasse/bezahlen` fragte.
 *     `new URL().pathname` dekodiert Prozentfolgen nicht; der Server tut es
 *     sehr wohl, es ist dieselbe Seite.
 *   - `navigate` auf `https://shop.de/#/kasse/bezahlen` ebenso: `u.hash` fiel
 *     ganz weg, obwohl bei Vue-, Angular- und älteren React-Oberflächen der
 *     ganze Weg im Fragment steht.
 *
 * Die Lehre ist keine über einzelne Zeichen und keine über Prozentzeichen,
 * sondern über die Richtung: **Die besuchte Seite darf nicht selbst
 * entscheiden, ob eine Wache greift.** Sie liefert den Text, also muss der
 * Text vor jedem Vergleich in eine Form gebracht werden, die die Seite nicht
 * frei wählen kann.
 *
 * ====================================================================
 * WARUM SIE SO GEBAUT IST, WIE SIE GEBAUT IST
 * ====================================================================
 *
 * Der Klassifizierer läuft im Dienstarbeiter (ES-Modul unter `src/net/`).
 * `geheim.js`, `klickwache.js`, `selektor.js` und `overlay.js` laufen als
 * KLASSISCHE Inhaltsskripte in der fremden Seite und können `src/net/*.js`
 * nicht importieren. Genau daran ist die Verdeckungswache am 11.08.2026
 * gescheitert: Sie lag in einem Modul, das im Klickweg niemand rufen konnte,
 * war grün geprüft und wirkungslos ausgeliefert.
 *
 * Zwei Abschriften derselben Sicherheitszusage sind ausdrücklich verboten
 * (Festlegung F4, siehe Kopf von `src/net/seite.js`): Dieselbe
 * Geheimfeld-Erkennung stand zweimal im Bestand, „wer eine der Listen ändert,
 * ändert beide" — und genau das ist nicht geschehen. Fünf Lecks waren die
 * Folge.
 *
 * Deshalb steht hier EINE Datei, die auf beiden Seiten läuft:
 *
 *   - Sie ist ein KLASSISCHES Skript ohne `import` und ohne `export` und
 *     hängt sich an `globalThis.SMARTR_MESSFORM`. Damit kann Chrome sie über
 *     `chrome.scripting.executeScript` in eine Seite spielen (Liste in
 *     `src/net/seite.js`, sie steht dort ganz vorn).
 *   - Eine Datei ohne `import`/`export` ist zugleich ein gültiges ES-Modul.
 *     Der Dienstarbeiter lädt sie über den dünnen Mantel
 *     `src/net/messform.js`, der nichts tut, als das Ergebnis vom
 *     `globalThis` abzuholen und benannt weiterzureichen.
 *
 * Erwogen und verworfen:
 *
 *   - **Zwei Fassungen, eine je Seite.** Das ist der Fehler, den F4 verbietet,
 *     und er ist im Bestand schon dreimal aufgetreten.
 *   - **Eine `.mjs`-Datei, die das Inhaltsskript nachlädt.** Ein Inhaltsskript
 *     darf in einer fremden Seite keinen dynamischen Import auf eine
 *     Erweiterungsdatei fahren, ohne sie unter `web_accessible_resources` für
 *     JEDE Seite lesbar zu machen. Eine Sicherheitszusage, die die besuchte
 *     Seite abrufen darf, ist eine, die sie auch untersuchen darf.
 *   - **Alles in `befehle.js` lassen und die Inhaltsskripte per Nachricht
 *     fragen.** Der Klickweg liegt IN der Seite und muss ohne Runde über den
 *     Dienstarbeiter entscheiden können; eine Wache mit Netzlaufzeit ist im
 *     Zweifel gar keine.
 *
 * ====================================================================
 * DIE ROLLENTEILUNG, UND SIE IST DER KERN
 * ====================================================================
 *
 *   `anzeigeform` (und `saeubern` in `befehle.js`, das darauf aufsetzt)
 *       ist für die ANZEIGE und das Protokoll. Dort wird gekürzt, denn eine
 *       Frage, die dreitausend Zeichen vorliest, wird nicht gelesen.
 *
 *   `messtext` / `messweg`
 *       sind für die MESSUNG. Dort wird NIE gekürzt, in keiner Länge, aus
 *       keinem Grund. Eine Sicherheitsprüfung kürzt ihren Eingang nicht
 *       (Befund H1 vom 14.08.2026: Das Wort „kasse" stand in der
 *       weggeschnittenen Mitte).
 *
 * Der Unterschied im Umgang mit unsichtbaren Zeichen ist bewusst KEIN
 * Unterschied mehr, und das ist eine Änderung gegenüber der Fassung davor:
 * Beide Formen entfernen sie ERSATZLOS.
 *
 * Die alte Begründung lautete, ein weggelassenes Zeichen ließe die Anzeige
 * lügen, deshalb sei das Leerzeichen richtig. Das gilt für echte
 * Steuerzeichen — ein Zeilenumbruch trennt sichtbar, und ihn ersatzlos zu
 * entfernen klebte zwei Wörter zusammen, die nebeneinander standen. Für
 * Zeichen OHNE EIGENE BREITE ist es falsch herum: Die Seite zeigt dem
 * Menschen „Jetzt kaufen", und die Erweiterung schriebe ihm „Jetzt kau fen"
 * in die Rückfrage. Das ist die Anzeige, die lügt. Deshalb:
 *
 *   - Zeichen ohne eigene Breite (Nullbreiten, Formatzeichen,
 *     Schreibrichtungsmarken, Markierungszeichen) → ERSATZLOS weg.
 *   - Zeichen, die eine Lücke oder einen Umbruch BEDEUTEN (C0/C1,
 *     Zeilen- und Absatztrenner) → ein Leerzeichen.
 *
 * Nur so misst der Klassifizierer denselben Text, den der Mensch liest — und
 * nur so wirkt die Reparatur auch dann, wenn der Name die Anzeigeform schon
 * durchlaufen hat, bevor er gemessen wird (`ausfuehrer.js`, Nachschlag beim
 * Klick).
 */

(() => {
  "use strict";

  /* Ein zweites Einspielen darf die bestehende Fassung nicht ersetzen: In
     einer laufenden Sitzung halten Klickwache und Overlay Ergebnisse aus
     dieser Fassung, und zwei Fassungen mitten in einem Klickweg wären zwei
     Wahrheiten über denselben Namen. Dieselbe Regel wie in `geheim.js`. */
  if (globalThis.SMARTR_MESSFORM) return;

  /* ------------------------------------------------------------------ *
   * Zeichenklassen
   * ------------------------------------------------------------------ */

  /*
   * Zeichen OHNE eigene Breite. Sie werden ersatzlos entfernt.
   *
   * Die Liste ist absichtlich weit gefasst und enthält auch das, was heute
   * niemand benutzt: Sie ist die Antwort auf einen Angreifer, der sich sein
   * Zeichen aussuchen darf, und ein fehlendes Zeichen kostet hier eine ganze
   * Wache. Ein zu viel entferntes Zeichen kostet nichts — keines davon hat
   * eine sichtbare Breite.
   *
   *   U+00AD            weicher Trennstrich (fehlte, AUTOMODUS-1)
   *   U+034F            Zeichenverbinder
   *   U+061C            arabische Schreibrichtungsmarke
   *   U+115F U+1160     Hangul-Füller (unsichtbar, aber „Buchstabe")
   *   U+17B4 U+17B5     Khmer-Vokalzeichen ohne Darstellung
   *   U+180B–U+180E     mongolische Variantenwähler und Vokaltrenner
   *   U+200B–U+200F     Nullbreiten und Schreibrichtungsmarken (AUTOMODUS-1)
   *   U+202A–U+202E     Schreibrichtungs-Überschreibung
   *   U+2060–U+2064     Wortverbinder und unsichtbare Rechenzeichen (fehlte)
   *   U+2066–U+206F     Schreibrichtungs-Isolate und veraltete Formatzeichen
   *   U+3164 U+FFA0     Hangul-Füllzeichen (Breite null, sieht aus wie Lücke)
   *   U+FE00–U+FE0F     Variantenwähler
   *   U+FEFF            Bytefolgemarke
   *   U+FFF9–U+FFFB     Zwischenzeilen-Anmerkung
   *   U+E0000–U+E0FFF   Etikettzeichen und Variantenwähler-Ergänzung; der
   *                     bekannteste Schmuggelweg überhaupt, weil kein
   *                     Anzeigeprogramm sie darstellt.
   */
  const UNSICHTBAR = new RegExp(
    "[\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180e" +
      "\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f" +
      "\\u3164\\ufe00-\\ufe0f\\ufeff\\ufff9-\\ufffb\\uffa0]" +
      "|[\\u{e0000}-\\u{e0fff}]",
    "gu"
  );

  /*
   * Echte Steuerzeichen. Sie bedeuten eine Lücke oder einen Umbruch und
   * werden deshalb zu EINEM Leerzeichen — hier wäre das ersatzlose Entfernen
   * die Lüge, weil „Zeile1\nZeile2" nicht „Zeile1Zeile2" ist.
   */
  const STEUERZEICHEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

  /*
   * Was NFKC nicht faltet und ein Mensch trotzdem als den Buchstaben liest.
   *
   * NFKC nimmt uns die Breitzeichen (ｋａｕｆｅｎ), die mathematischen
   * Fettbuchstaben (𝐤𝐚𝐮𝐟𝐞𝐧), die eingekreisten (ⓚ), die Ligaturen (ﬀ) und
   * die hochgestellten (ᴬ) ab — gemessen, nicht vermutet.
   *
   * Es faltet NICHT:
   *
   *   1. **Kapitälchen.** „ᴋᴀᴜꜰᴇɴ" hat in Unicode keine
   *      Kompatibilitätszerlegung; jedes dieser Zeichen ist offiziell ein
   *      eigener Buchstabe des Lautschriftalphabets. Für das Auge ist es das
   *      Wort.
   *   2. **Sichtgleiche Buchstaben anderer Schriften.** Das kyrillische „а"
   *      (U+0430) und das lateinische „a" sind in jeder Schriftart
   *      dieselbe Figur.
   *
   * Beides ist dieselbe Klasse wie das Nullbreiten-Zeichen: Die Seite wählt
   * eine Schreibweise, die ein Mensch als das Wort liest und ein Vergleich
   * nicht. Deshalb wird nachgefaltet.
   *
   * Der Preis ist bekannt und bewusst in Kauf genommen: Russischer oder
   * griechischer Fließtext wird dabei zu lateinisch aussehendem Zeug, und
   * daraus kann im seltenen Fall ein Wort der Wachlisten entstehen. Das
   * kostet eine Rückfrage. Ein übersehenes „ᴋᴀᴜꜰᴇɴ" kostet eine Bestellung.
   *
   * Aufgenommen ist nur, was in üblichen Schriftarten WIRKLICH dieselbe Figur
   * ist. „в" (U+0432) steht bewusst NICHT hier: Es sieht aus wie ein großes B
   * und nicht wie ein kleines, und eine Faltung nach Augenmaß wäre der Anfang
   * einer Liste, die niemand mehr begründen kann.
   */
  const SICHTGLEICH = new Map(Object.entries({
    /* Kapitälchen (Lautschriftalphabet). „x" hat kein Kapitälchen in Unicode. */
    "ᴀ": "a", "ʙ": "b", "ᴄ": "c", "ᴅ": "d", "ᴇ": "e",
    "ꜰ": "f", "ɢ": "g", "ʜ": "h", "ɪ": "i", "ᴊ": "j",
    "ᴋ": "k", "ʟ": "l", "ᴍ": "m", "ɴ": "n", "ᴏ": "o",
    "ᴘ": "p", "ꞯ": "q", "ʀ": "r", "ꜱ": "s", "ᴛ": "t",
    "ᴜ": "u", "ᴠ": "v", "ᴡ": "w", "ʏ": "y", "ᴢ": "z",
    /* Lautschrift, die als gewöhnlicher Kleinbuchstabe durchgeht. */
    "ɡ": "g",
    /* Kyrillisch, Kleinbuchstaben (Großbuchstaben sind vorher schon
       kleingeschrieben worden, deshalb steht hier nur die kleine Form). */
    "а": "a", "е": "e", "к": "k", "м": "m", "н": "h",
    "о": "o", "р": "p", "с": "c", "т": "t", "у": "y",
    "х": "x", "ѕ": "s", "і": "i", "ј": "j", "ѵ": "v",
    "ԁ": "d", "ԛ": "q", "ԝ": "w", "һ": "h",
    /* Griechisch, nur die Figuren, die sich mit dem lateinischen Buchstaben
       nicht unterscheiden lassen. */
    "ο": "o", "ρ": "p", "ν": "v", "κ": "k", "ι": "i",
    "υ": "u", "χ": "x", "τ": "t", "ε": "e", "α": "a",
  }));

  const SICHTGLEICH_MUSTER = new RegExp(`[${[...SICHTGLEICH.keys()].join("")}]`, "g");

  /*
   * Umlaute und Eszett in die Schreibweise der Wortlisten.
   *
   * Sie standen bis zum 14.08.2026 in `befehle.js` und sind hierher gezogen,
   * damit es sie genau einmal gibt: Die Inhaltsseite misst denselben Namen
   * wie der Klassifizierer, und zwei Tabellen für dieselbe Frage laufen
   * auseinander, sobald jemand eine ändert.
   */
  const UMLAUT_ERSATZ = [
    [/ä/g, "ae"], [/ö/g, "oe"], [/ü/g, "ue"], [/ß/g, "ss"],
    [/á|à|â|å/g, "a"], [/é|è|ê/g, "e"], [/í|ì|î/g, "i"], [/ó|ò|ô/g, "o"], [/ú|ù|û/g, "u"],
  ];

  /* Wie oft eine Adresse höchstens ausgepackt wird. Der Deckel steht gegen
     eine Adresse, die sich selbst tausendfach kodiert und den Dienstarbeiter
     im Kreis laufen liesse; drei Runden decken jede Kodierung ab, die je in
     freier Wildbahn beobachtet wurde. */
  const WEG_RUNDEN = 3;

  /* ------------------------------------------------------------------ *
   * Bausteine
   * ------------------------------------------------------------------ */

  /** Alles, was keine eigene Breite hat, ersatzlos raus. */
  function ohneUnsichtbare(s) {
    return s.replace(UNSICHTBAR, "");
  }

  /** Echte Steuerzeichen zu je einem Leerzeichen. */
  function steuerzeichenGlaetten(s) {
    return s.replace(STEUERZEICHEN, " ");
  }

  /**
   * Unicode-Normalform NFKC, ohne je zu werfen.
   *
   * `normalize` wirft nur bei einem unbekannten Formnamen, und der steht hier
   * fest. Der Rückfall bleibt trotzdem stehen: Diese Datei läuft in einer
   * fremden Seite, und eine Seite darf `String.prototype.normalize`
   * überschrieben haben. Dann wird ohne Faltung weitergemessen — weniger
   * gefaltet ist schlechter als gefaltet, aber immer noch besser als gar
   * keine Messung.
   */
  function normalisieren(s) {
    try {
      return s.normalize("NFKC");
    } catch (_) {
      return s;
    }
  }

  /**
   * Die Form, in der ein von der Seite gelieferter Text ANGEZEIGT und
   * protokolliert wird: ohne unsichtbare Zeichen, ohne Steuerzeichen, mit
   * genau einem Leerzeichen zwischen den Wörtern, ohne Rand.
   *
   * Ausdrücklich OHNE Kürzung — die gehört dem Aufrufer, weil nur er weiß,
   * wieviel Platz er hat (`saeubern` in `befehle.js`).
   * Ausdrücklich OHNE NFKC und ohne Kleinschreibung: Angezeigt wird, was
   * dasteht, und ein Name in Breitzeichen soll in der Rückfrage auch so
   * aussehen wie auf der Seite.
   */
  function anzeigeform(roh) {
    return steuerzeichenGlaetten(ohneUnsichtbare(String(roh ?? "")))
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Die gemeinsame Werkbank hinter `messtext` und `messtextLuecke`.
   *
   * Reihenfolge, und jede Stufe hat ihren Grund:
   *
   *   1. unsichtbare Zeichen behandeln (siehe `ersatz`) — das steht VOR der
   *      Normalform, damit ein Trennzeichen mitten in einer Zeichenfolge die
   *      Zusammensetzung nicht verhindert („e" + Trenner + Akzent wird zu
   *      „é" und danach zu „e").
   *   2. Steuerzeichen zu einem Leerzeichen — sie bedeuten eine Lücke.
   *   3. NFKC — Breitzeichen, mathematische Buchstaben, Ligaturen,
   *      eingekreiste und hochgestellte Zeichen fallen auf ihren Buchstaben.
   *   4. Kleinschreibung.
   *   5. Nachfaltung dessen, was NFKC nicht faltet (Kapitälchen,
   *      sichtgleiche Buchstaben fremder Schriften).
   *   6. Umlautersatz in die Schreibweise der Wortlisten.
   *   7. alles Nicht-Alphanumerische zu einem Leerzeichen, Rand ab.
   *
   * Und was hier NICHT steht: eine Längengrenze. Keine, nirgends, nie.
   *
   * @param {*} roh
   * @param {string} ersatz  was an die Stelle eines unsichtbaren Zeichens tritt
   */
  function formen(roh, ersatz) {
    const s0 = String(roh ?? "");
    if (!s0) return "";
    let s = steuerzeichenGlaetten(s0.replace(UNSICHTBAR, ersatz));
    s = normalisieren(s).toLowerCase();
    /* Nach der Kleinschreibung, damit die Tabelle nur die kleinen Formen
       kennen muss — „КАССЕ" ist an dieser Stelle schon „кассе". */
    s = s.replace(SICHTGLEICH_MUSTER, (z) => SICHTGLEICH.get(z) || z);
    for (const [muster, ersatzWort] of UMLAUT_ERSATZ) s = s.replace(muster, ersatzWort);
    return s.replace(/[^a-z0-9]+/g, " ").trim();
  }

  /**
   * Die Form, in der GEMESSEN wird — die kanonische.
   *
   * Unsichtbare Zeichen fallen ERSATZLOS weg. Das ist die Lesart des Auges:
   * Die Seite zeigt „Jetzt kaufen", also wird „jetzt kaufen" gemessen und
   * nicht „jetzt kau fen" (AUTOMODUS-1).
   *
   * @returns {string} kleingeschrieben, ohne Rand; "" wenn nichts übrig ist
   */
  function messtext(roh) {
    return formen(roh, "");
  }

  /**
   * Dieselbe Form, aber mit der ANDEREN Lesart: Jedes unsichtbare Zeichen
   * gilt als Lücke.
   *
   * Warum es beide braucht, und zwar nebeneinander: Ein unsichtbares Zeichen
   * kann ein Wort ZUSAMMENKLEBEN, das der Vergleich getrennt sucht
   * („ignore<U+200B>previous<U+200B>instructions" ist für eine Wortsuche mit
   * Leerzeichen nur ein einziges langes Wort), und es kann ein Wort
   * ZERSCHNEIDEN, das der Vergleich zusammen sucht („kau<U+200B>fen"). Wer
   * sich für eine der beiden Lesarten entscheidet, macht die jeweils andere
   * zum offenen Weg vorbei.
   *
   * Deshalb misst `messvarianten` beide, und die Wortsuche findet ihr Wort,
   * wenn es in EINER von ihnen steht. Das ist dieselbe Regel wie bei
   * `messweg`: Die zweite Lesart tritt nicht an die Stelle der ersten,
   * sondern neben sie.
   */
  function messtextLuecke(roh) {
    return formen(roh, " ");
  }

  /** `messtext` mit je einem Leerzeichen am Rand, oder "" bei leerem Ergebnis. */
  function randen(t) {
    return t ? ` ${t} ` : "";
  }

  /**
   * `messtext` mit je einem Leerzeichen am Rand — die Form, in der nach einem
   * ganzen WORT gesucht wird.
   *
   * Die Randleerzeichen sind kein Schönheitsfehler: Sie machen aus der Suche
   * nach `" pin "` eine Suche nach dem ganzen Wort, auch am Anfang und am
   * Ende der Zeichenkette. Ohne sie steckte „pin" in „shipping" und „act as"
   * in „contract as agreed".
   *
   * @returns {string} " text " oder "" bei leerem Ergebnis
   */
  function messrand(roh) {
    return randen(messtext(roh));
  }

  /**
   * BEIDE Lesarten desselben Textes, jede mit Rand, ohne Doppelung.
   *
   * Das ist die Form, in der eine Wortliste sucht: Ein Wort gilt als
   * gefunden, wenn es in EINER der Lesarten steht. Die Begründung steht bei
   * `messtextLuecke` — ein unsichtbares Zeichen kann trennen UND kleben, und
   * wer sich für eine Lesart entscheidet, macht die andere zum Weg vorbei.
   *
   * Fast immer ist das genau ein Eintrag: Ohne unsichtbare Zeichen sind beide
   * Lesarten dieselbe.
   *
   * @returns {string[]} keine, eine oder zwei Formen, jede mit Rand
   */
  function messvarianten(roh) {
    const a = messtext(roh);
    const b = messtextLuecke(roh);
    if (!a && !b) return [];
    if (!b || b === a) return [randen(a)];
    if (!a) return [randen(b)];
    return [randen(a), randen(b)];
  }

  /**
   * Eine Prozentfolge auspacken — auch dann, wenn die Adresse daneben eine
   * kaputte Folge trägt.
   *
   * `decodeURIComponent` wirft bei der ersten ungültigen Folge und lässt die
   * GANZE Adresse unentpackt. Ein Angreifer schriebe also einfach ein „%zz"
   * ans Ende und hätte die Auspackung abgeschaltet — dieselbe Bauform wie
   * das Nullbreiten-Zeichen im Knopfnamen. Deshalb der zweite Anlauf: jede
   * zusammenhängende, gültige Folge für sich, der Rest bleibt stehen.
   */
  function einmalAuspacken(s) {
    try {
      return decodeURIComponent(s);
    } catch (_) {
      /* weiter unten, Stück für Stück */
    }
    return s.replace(/(?:%[0-9a-fA-F]{2})+/g, (folge) => {
      try {
        return decodeURIComponent(folge);
      } catch (_) {
        return folge;
      }
    });
  }

  /** Auspacken, bis sich nichts mehr ändert — höchstens `WEG_RUNDEN` mal. */
  function auspacken(s) {
    let d = s;
    for (let runde = 0; runde < WEG_RUNDEN; runde++) {
      if (!d.includes("%")) break;
      const n = einmalAuspacken(d);
      if (n === d) break;
      d = n;
    }
    return d;
  }

  /**
   * Der Adresstext, den der Klassifizierer misst.
   *
   * Enthalten sind Pfad, Suche UND Fragment (AUTOMODUS-4: bei
   * Einzelseiten-Anwendungen steht der ganze Weg im Fragment), jedes davon
   * zusätzlich ausgepackt (AUTOMODUS-3: `new URL().pathname` dekodiert
   * Prozentfolgen nicht, der Server sehr wohl).
   *
   * Die rohe Form bleibt ZUSÄTZLICH stehen und wird nicht ersetzt: Eine
   * Reparatur, die eine Messung wegnimmt, um eine andere zu ergänzen, ist
   * keine. Ein Pfad, der roh ein Wachwort trägt und ausgepackt keines mehr,
   * wäre sonst der nächste Weg vorbei.
   *
   * Bewusst OHNE den Wirt: Der Vertrag nennt in §3.1 den „Adresspfad". Ein
   * Wirt namens `paypal.de` macht aus einem Lesebefehl keine Zahlung, ein
   * Pfad `/checkout/zahlung` sehr wohl.
   *
   * Lässt sich die Adresse nicht zerlegen, wird sie GANZ genommen — mehr Text
   * heißt hier mehr Rückfrage, und das ist die erlaubte Richtung.
   */
  function messweg(roh) {
    const s = String(roh ?? "");
    if (!s) return "";
    let teile;
    try {
      const u = new URL(s);
      teile = `${u.pathname} ${u.search} ${u.hash}`;
    } catch (_) {
      teile = s;
    }
    const offen = auspacken(teile);
    return offen === teile ? teile : `${teile} ${offen}`;
  }

  /**
   * Sind das zwei Schreibweisen desselben Textes?
   *
   * Verglichen wird das GANZE — kein `includes`, kein `startsWith`. Ein
   * Vergleich auf Enthaltensein beantwortet die Frage „ist das noch dasselbe
   * Element" mit „ja" für einen Namen, der den alten nur enthält, und genau
   * damit tauscht eine Seite das Ziel unter einer erteilten Freigabe aus.
   *
   * Zwei leere Texte gelten ausdrücklich als NICHT gleich. Das ist die
   * strengere Antwort und die richtige: Diese Funktion soll Gleichheit
   * BELEGEN, und aus zwei Namen, die es nicht gibt, folgt kein Beleg. Wer
   * zwei fehlende Namen als Übereinstimmung zählte, hätte eine Wache, die ein
   * Element ohne Namen gegen jedes andere Element ohne Namen durchlässt.
   *
   * @returns {boolean}
   */
  function gleicherText(a, b) {
    const x = messtext(a);
    if (!x) return false;
    return x === messtext(b);
  }

  globalThis.SMARTR_MESSFORM = Object.freeze({
    messtext,
    messtextLuecke,
    messrand,
    messvarianten,
    messweg,
    gleicherText,
    anzeigeform,
    ohneUnsichtbare,
    steuerzeichenGlaetten,
    WEG_RUNDEN,
    /* Offen für die Prüfsätze: Welche Zeichen als unsichtbar gelten und was
       nachgefaltet wird, ist die einzige Regel hier, die man am Ergebnis
       nicht ablesen kann. Ein fehlendes Zeichen sieht aus wie ein Zeichen,
       das nie jemand geschrieben hat. Als Kopien, damit ein Aufrufer die
       Tabelle der Wache nicht umschreiben kann. */
    unsichtbareZeichen: () => new RegExp(UNSICHTBAR.source, UNSICHTBAR.flags),
    steuerzeichen: () => new RegExp(STEUERZEICHEN.source, STEUERZEICHEN.flags),
    sichtgleich: () => new Map(SICHTGLEICH),
  });
})();
