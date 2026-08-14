/*
 * SMarTrChrome — die Selektor-Kaskade (Vertrag v3.5 §7.1).
 *
 * Ein KLASSISCHES Skript, kein Modul. Es schreibt nach
 * `globalThis.SMARTR_SELEKTOR` und wird vor `rekorder.js` und vor `overlay.js`
 * eingespielt.
 *
 * Warum diese Bauform ausdrücklich hier steht: Inhaltsskripte können
 * `src/net/*.js` nicht importieren. Genau daran ist die Verdeckungswache am
 * 11.08.2026 gescheitert — sie lag in einem Modul, das im Klickweg niemand
 * rufen konnte. 372 Prüfsätze waren grün, ausgeliefert wurde trotzdem ein
 * Klick durch einen deckenden Überzug. Ein klassisches Skript mit einem
 * globalen Namen ist die Lehre daraus: Wer es benutzen will, findet es.
 *
 * Was diese Datei leistet: Sie beschreibt ein Element der fremden Seite so,
 * dass es in einer Woche noch zu finden ist. Das ist die ganze Frage eines
 * aufgezeichneten Ablaufs — ein Ablauf wird EINMAL aufgenommen und danach
 * immer wieder abgespielt, und zwar gegen eine Seite, die zwischendurch neu
 * gebaut wurde.
 *
 * Die Asymmetrie, an der sich die Regeln hier ausrichten, und die den
 * Zweifelsfall entscheidet: Ein weggeworfener guter Anker kostet einen
 * schwächeren Anker weiter unten in der Kaskade — die Kaskade trägt das. Ein
 * behaltener Zufallsanker kostet beim nächsten Build der fremden Seite den
 * ganzen Schritt. Also fliegt im Zweifel raus.
 */

(() => {
  "use strict";

  /* Ein zweites Einspielen darf die bestehende Kaskade nicht ersetzen: Der
     Rekorder hält Anker aus dieser Fassung, und eine zweite Fassung mit
     anderen Regeln mitten in einer Aufnahme wäre ein Ablauf aus zwei
     Handschriften. */
  if (globalThis.SMARTR_SELEKTOR) return;

  /* Höchstens sechs Anker, obwohl `werkstatt.js` acht durchlässt
     (WERKSTATT_GRENZEN.ankerJeSchritt). Die Lücke ist Absicht: §7.4 schreibt
     einen selbstgeheilten Anker in den Ablauf zurück, und ein Ablauf, der beim
     Heilen an der eigenen Obergrenze anschlägt, heilt genau einmal nicht. */
  const KASKADE_HOECHSTENS = 6;

  /* §7.1: Textanker mit genauem Text, höchstens 80 Zeichen. */
  const TEXT_ZEICHEN = 80;

  /* §7.1: stabiler CSS-Pfad über höchstens 4 Ebenen. Mehr Ebenen heisst mehr
     fremdes Gerüst im Anker, und fremdes Gerüst ist das, was sich ändert. */
  const PFAD_EBENEN = 4;

  /* Zwei Klassen je Ebene genügen zur Unterscheidung. Jede weitere ist eine
     zusätzliche Stelle, an der die fremde Seite den Anker brechen kann. */
  const KLASSEN_JE_EBENE = 2;

  /* Der Textanker wird durch Ablaufen des Baums aufgelöst. Auf einer grossen
     Seite sind das leicht 50.000 Knoten; ein Deckel hält den Weg berechenbar,
     und ein Element jenseits davon ist ohnehin über Anker 1 bis 3 zu finden. */
  const TEXT_KNOTEN_HOECHSTENS = 5000;

  /* Wie lang der Wert eines Merkmals sein darf, das in einen Anker eingebaut
     wird. Ein 400 Zeichen langes `aria-label` ist kein Anker, sondern ein
     Absatz, der beim nächsten Redaktionsschluss anders lautet. */
  const WERT_ZEICHEN = 100;

  /* §7.1, Reihenfolge innerhalb der Datenmerkmale. Diese drei sind gesetzt,
     weil sie von Menschen für genau diesen Zweck vergeben werden. */
  const DATEN_ZUERST = ["data-testid", "data-test", "data-cy"];

  /* Merkmale, die die BEDEUTUNG eines Elements tragen und deshalb einen Umbau
     des Layouts überleben.

     Befund B7 vom 14.08.2026: `name` stand in keiner Kaskade. Bei
     `<input id="input-4f3a2b9c" name="artikelnummer" class="css-9k2j1h">`
     fielen Kennung und Klasse zu Recht als Zufall heraus, und übrig blieben
     `input:nth-of-type(1)` und der XPath — zwei Anker, die beide nur die
     STELLE zählen. Ein Feld davor eingeschoben, und der Ablauf tippte die
     Artikelnummer ins Titelfeld und meldete Erfolg. Der `name` eines Feldes
     wechselt dagegen nicht, wenn die Seite neu gebaut wird: Er steht im
     Formular, das abgeschickt wird. */
  const STABILE_MERKMALE = ["name", "alt"];

  /* Datenmerkmale, die zwar `data-` heissen, aber vom Rahmenwerk stammen und
     bei jedem Build neu gewürfelt werden. Sie sehen wie ein Anker aus und sind
     das Gegenteil davon. */
  const DATEN_VERBOTEN = new Set([
    "data-reactid", "data-react-checksum", "data-server-rendered",
    "data-hydrate", "data-key", "data-index", "data-nr", "data-pos",
  ]);
  const DATEN_VERBOTEN_PRAEFIX = [
    "data-v-",       // Vue, Kennung des Bauteil-Bereichs, wechselt mit dem Build
    "data-ng-",      // Angular
    "data-react",
    "data-emotion",
    "data-styled",
    "data-svelte",
    "data-sentry",
    "data-gtm",
  ];

  /*
   * Die Zufallserkennung — benannte Regeln, keine Bauchentscheidung.
   *
   * §7.1 nennt `/[a-z]+-[a-z0-9]{5,}/` als Beispiel. Wörtlich angewandt fiele
   * damit auch `btn-primary` und `main-content` heraus, und der CSS-Pfad
   * bestünde nur noch aus nackten Elementnamen. Gemessen wird deshalb je
   * Namensabschnitt, und jede Regel trägt einen Namen, damit ein Prüfsatz sie
   * einzeln halten kann statt nur das Ergebnis.
   */
  const ZUFALL_REGELN = Object.freeze([
    /* Ein ganzer Hash als Name. Alles jenseits von 24 Zeichen ist kein Wort
       mehr, das ein Mensch vergeben hat. */
    { name: "zu_lang", ganz: true, pruefen: (s) => s.length > 24 },

    /* Die bekannten Erzeuger von Stilklassen. `css-1x2y3z`, `sc-bdVaJa`,
       `jss142`, `emotion-9f2a`: Der Präfix ist stabil, alles dahinter nicht. */
    {
      name: "praefix_hash",
      ganz: true,
      pruefen: (s) => /^(css|sc|jss|jsx|emotion|styled|svelte|glamor|makeStyles|ember)[-_]?[A-Za-z0-9]{3,}$/.test(s),
    },

    /* Buchstaben und Ziffern gemischt. Ausgenommen ist der kleine Zähler am
       Ende (`col6`, `h1`, `item12`) — das ist eine Ordnungszahl und kein
       Zufall. Drei Ziffern und mehr sind wieder eine Kennung. */
    {
      name: "ziffernmix",
      ganz: false,
      pruefen: (s) =>
        s.length >= 5 && /[A-Za-z]/.test(s) && /[0-9]/.test(s) && !/^[A-Za-z]+[0-9]{1,2}$/.test(s),
    },

    /* Eine Hexkette, wie sie aus Prüfsummen und Kennungen fällt. */
    { name: "hexkette", ganz: false, pruefen: (s) => /^[0-9a-f]{6,}$/i.test(s) },

    /* Kein einziger Vokal auf fünf Zeichen. Das spricht kein Mensch aus, also
       hat es auch keiner vergeben. */
    {
      name: "vokallos",
      ganz: false,
      pruefen: (s) => s.length >= 5 && !/[aeiouäöüyAEIOUÄÖÜY]/.test(s),
    },

    /* Kurzsilben in Grossschreibung, das Muster der Stilrahmenwerke:
       `bdVaJa`, `XyAbCd`. Drei Silben und mehr, und keine davon länger als
       zwei Zeichen — ein Wort sieht anders aus. */
    {
      name: "kurzsilben",
      ganz: false,
      pruefen: (s) => {
        const silben = s.split(/(?=[A-Z])/).filter(Boolean);
        return silben.length >= 3 && silben.every((t) => t.length <= 2);
      },
    },
  ]);

  /**
   * Trägt dieser Name einen Zufallsanteil?
   *
   * @param {string} name Klassenname, Kennung oder Merkmalswert
   * @returns {{zufall: boolean, regel: string|null}} die Regel, die zugeschlagen hat
   */
  function klasseZufaellig(name) {
    const s = String(name == null ? "" : name).trim();
    if (!s) return { zufall: false, regel: null };
    for (const regel of ZUFALL_REGELN) {
      if (regel.ganz && regel.pruefen(s)) return { zufall: true, regel: regel.name };
    }
    /* Abschnittsweise: `col-md-6` zerfällt in `col`, `md`, `6` und bleibt
       damit stehen, `header-a1b2c3` fällt am Abschnitt `a1b2c3`. Reine
       Ziffernabschnitte sind Ordnungszahlen und werden übersprungen. */
    for (const abschnitt of s.split(/[-_]+/).filter(Boolean)) {
      if (/^[0-9]+$/.test(abschnitt)) continue;
      for (const regel of ZUFALL_REGELN) {
        if (!regel.ganz && regel.pruefen(abschnitt)) return { zufall: true, regel: regel.name };
      }
    }
    return { zufall: false, regel: null };
  }

  /**
   * Taugt dieser Name als Kennung oder Klasse in einem Selektor?
   *
   * Bewusst eng: Wer `CSS.escape` braucht, um in einen Selektor zu passen,
   * trägt ohnehin Zeichen, die kein Mensch vergeben hat — Reacts `:r3:`,
   * Tailwinds `md:flex`. Ein Anker, der Maskierung braucht, ist kein stabiler
   * Anker, und die Maskierung selbst wäre eine zweite Stelle zum Danebengreifen.
   */
  function nameTaugt(name) {
    return typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name);
  }

  /**
   * Darf dieser Text überhaupt in einen Anker?
   *
   * Befund B6 vom 14.08.2026: Auf einer 2FA-Seite wurde
   * `<span class="otp-anzeige">849271</span>` zum Anker `text=849271` und
   * `<button data-code="849271">` zum Anker `[data-code="849271"]`. Der
   * Textanker kannte KEINERLEI Geheimprüfung, und `klasseZufaellig`
   * überspringt reine Ziffernabschnitte ausdrücklich als Ordnungszahlen — zu
   * Recht für `col-md-6`, verheerend für einen Einmalcode. Die Zufallsfrage
   * und die Geheimfrage sind eben zwei Fragen; die eine schützt den Anker vor
   * dem nächsten Build, die andere den Menschen vor seiner eigenen Ablage.
   *
   * Entschieden wird das in `content/geheim.js`, der einen Quelle (F4).
   * Fehlt sie, wird nicht geraten: Dann kommt kein Text mit einer Ziffer mehr
   * in einen Anker. Das kostet Anker, und Anker kosten weniger als ein Code
   * in `sa_workflows`.
   */
  function textOffen(text) {
    const G = globalThis.SMARTR_GEHEIM;
    if (!G || typeof G.textHarmlos !== "function") {
      return !/[0-9]/.test(String(text == null ? "" : text));
    }
    try {
      return G.textHarmlos(text) === true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Taugt dieser Merkmalswert als Inhalt eines Attributselektors?
   *
   * Anführungszeichen und Rückstriche fallen heraus, weil der Anker sie
   * maskieren müsste; Zeilenumbrüche, weil sie im Selektor nichts zu suchen
   * haben. Ein zufällig aussehender Wert fällt aus demselben Grund heraus wie
   * eine Zufallsklasse, ein codeförmiger aus dem Grund von Befund B6.
   */
  function wertTaugt(wert) {
    if (typeof wert !== "string") return false;
    const s = wert.trim();
    if (!s || s.length > WERT_ZEICHEN) return false;
    if (/["'\\\n\r\t]/.test(s)) return false;
    if (!textOffen(s)) return false;
    return !klasseZufaellig(s).zufall;
  }

  function istElement(el) {
    return !!el && typeof el === "object" && el.nodeType === 1 && typeof el.tagName === "string";
  }

  function tagVon(el) {
    return String(el.tagName || "").toLowerCase();
  }

  function merkmal(el, name) {
    try {
      const w = el.getAttribute(name);
      return typeof w === "string" ? w : "";
    } catch (_) {
      return "";
    }
  }

  /* Der Inhalt eines Feldes ist NICHT sein Text. Ein `<input>` trägt das
     Getippte, ein `<select>` seine Optionen, ein bearbeitbarer Bereich das
     Geschriebene — daraus einen Textanker zu bauen hiesse, den Inhalt in den
     Anker zu schreiben. Das wäre bei einem Geheimfeld genau der Weg, den §7.2
     verbietet, und bei jedem anderen Feld ein Anker, der beim nächsten
     Abspielen nicht mehr passt. */
  function traegtInhalt(el) {
    const tag = String(el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
  }

  function dokumentVon(wurzel) {
    if (!wurzel) return typeof document !== "undefined" ? document : null;
    return wurzel.ownerDocument || wurzel;
  }

  function normText(roh) {
    return String(roh == null ? "" : roh).replace(/\s+/g, " ").trim();
  }

  /** Ist `b` ein Nachfahre von `a`? Ohne `contains`, das gibt es nicht überall. */
  function enthaelt(a, b) {
    let k = b && b.parentElement;
    while (k) {
      if (k === a) return true;
      k = k.parentElement;
    }
    return false;
  }

  /**
   * Trifft dieser Selektor genau dieses eine Element?
   *
   * Der Kern der ganzen Datei: Ein Anker, der zwei Elemente trifft, klickt
   * beim Abspielen auf das falsche. Deshalb wird jeder Anker gegen die
   * Wurzel gemessen, bevor er in die Kaskade kommt — gemessen, nicht
   * geschätzt. Ein ungültiger Selektor lässt `querySelectorAll` werfen; das
   * ist hier keine Ausnahme, sondern schlicht „trifft nicht".
   */
  function eindeutig(selektor, el, wurzel) {
    try {
      const treffer = wurzel.querySelectorAll(selektor);
      return treffer.length === 1 && treffer[0] === el;
    } catch (_) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Anker 1 — Datenmerkmale
   * ------------------------------------------------------------------ */

  function datenMerkmale(el) {
    let liste = [];
    try {
      liste = Array.from(el.attributes || []);
    } catch (_) {
      liste = [];
    }
    const raus = [];
    for (const a of liste) {
      const name = String((a && a.name) || "").toLowerCase();
      if (!name.startsWith("data-")) continue;
      if (DATEN_VERBOTEN.has(name)) continue;
      if (DATEN_VERBOTEN_PRAEFIX.some((p) => name.startsWith(p))) continue;
      const wert = typeof a.value === "string" ? a.value : "";
      if (!wertTaugt(wert)) continue;
      raus.push({ name, wert });
    }
    /* Erst die drei aus §7.1, in ihrer Reihenfolge, dann der Rest in der
       Reihenfolge, in der die Seite sie trägt. */
    raus.sort((x, y) => {
      const a = DATEN_ZUERST.indexOf(x.name);
      const b = DATEN_ZUERST.indexOf(y.name);
      return (a < 0 ? DATEN_ZUERST.length : a) - (b < 0 ? DATEN_ZUERST.length : b);
    });
    return raus;
  }

  /* ------------------------------------------------------------------ *
   * Anker 3 — stabiler CSS-Pfad
   * ------------------------------------------------------------------ */

  /* Auch Klasse und Kennung gehen durch die Geheimprüfung. Eine Seite, die
     ihren Einmalcode als `id="849271"` an das Feld schreibt, ist keine
     Erfindung, sondern die naheliegende Bauart einer Kästchenreihe (Befund
     B6, 14.08.2026). */
  function klassenVon(el) {
    return merkmal(el, "class")
      .split(/\s+/)
      .filter(Boolean)
      .filter((k) => nameTaugt(k) && textOffen(k) && !klasseZufaellig(k).zufall);
  }

  function kennungTaugt(el) {
    const id = merkmal(el, "id");
    return nameTaugt(id) && textOffen(id) && !klasseZufaellig(id).zufall ? id : "";
  }

  /** Die Stelle unter den Geschwistern desselben Elementnamens, ab 1. */
  function stelleUnterGleichen(el) {
    const eltern = el.parentElement;
    if (!eltern) return 1;
    let kinder = [];
    try {
      kinder = Array.from(eltern.children || []);
    } catch (_) {
      kinder = [];
    }
    const tag = tagVon(el);
    let nr = 0;
    for (const kind of kinder) {
      if (tagVon(kind) !== tag) continue;
      nr += 1;
      if (kind === el) return nr;
    }
    return 1;
  }

  /** Ein Glied des Pfades: Elementname, stabile Klassen, notfalls die Stelle. */
  function pfadGlied(el) {
    const tag = tagVon(el);
    const klassen = klassenVon(el).slice(0, KLASSEN_JE_EBENE);
    let glied = tag + klassen.map((k) => `.${k}`).join("");
    const eltern = el.parentElement;
    if (!eltern) return glied;
    /* Die Stelle kommt nur dazu, wenn der Anker sonst mehrdeutig wäre. Sie ist
       das schwächste Stück im Pfad: Ein eingeschobenes Geschwisterelement
       verschiebt sie, ohne dass sich am Ziel etwas geändert hätte. */
    let geschwister = [];
    try {
      geschwister = Array.from(eltern.children || []);
    } catch (_) {
      geschwister = [];
    }
    const gleiche = geschwister.filter((g) => {
      if (tagVon(g) !== tag) return false;
      if (!klassen.length) return true;
      const seine = klassenVon(g);
      return klassen.every((k) => seine.includes(k));
    });
    if (gleiche.length > 1) glied += `:nth-of-type(${stelleUnterGleichen(el)})`;
    return glied;
  }

  /**
   * Nennt dieser Pfad irgendein Merkmal, oder zählt er nur Stellen?
   *
   * Befund B7 vom 14.08.2026: `pfadBauen` durfte einen Anker aus nichts als
   * Elementname und Stellenangabe bauen, `input:nth-of-type(1)`. Nach einer
   * Layout-Änderung trifft der weiter GENAU EIN Element, nur ein anderes, und
   * `kaskadeAufloesen` prüfte ausschliesslich Eindeutigkeit. Gemessen wurde:
   * ein Feld `titel` davor eingeschoben, Antwort `ok:true`, getroffen wurde
   * `name=titel`, und die Artikelnummer landete im Titelfeld. Der Ablauf
   * brach nicht ab, er tippte ins falsche Feld und meldete Erfolg.
   *
   * Ein Anker, der nur aus Elementname und Stellenangabe besteht, ist kein
   * Anker, sondern eine Wette. Für den XPath ist das ausdrücklich in Kauf
   * genommen — er steht als letzter Ausweg ganz unten, und die Identität hält
   * ab Festlegung F3 der Ausführer dagegen. Ein CSS-Pfad, der dasselbe kann,
   * stünde dagegen WEIT OBEN in der Kaskade und verdrängte den Textanker.
   */
  const pfadTraegtMerkmal = (pfad) => /[#.\[]/.test(String(pfad || ""));

  /**
   * Der kürzeste eindeutige Pfad, höchstens vier Ebenen tief.
   *
   * Gebaut wird von unten nach oben und nach jeder Ebene gemessen: Sobald der
   * Pfad eindeutig ist UND ein Merkmal nennt, hört er auf. Ein kürzerer Pfad
   * überlebt mehr Umbauten, weil er weniger fremdes Gerüst nennt. Ist er
   * eindeutig, nennt aber nur Stellen, wird weiter nach oben gesucht: Eine
   * Ebene höher steht vielleicht eine Klasse, die den Pfad trägt.
   */
  function pfadBauen(el, wurzel) {
    const eigene = kennungTaugt(el);
    if (eigene && eindeutig(`#${eigene}`, el, wurzel)) return `#${eigene}`;

    const teile = [];
    let knoten = el;
    for (let ebene = 0; ebene < PFAD_EBENEN && istElement(knoten); ebene++) {
      if (ebene > 0) {
        const id = kennungTaugt(knoten);
        if (id) {
          teile.unshift(`#${id}`);
          const mitId = teile.join(" > ");
          return eindeutig(mitId, el, wurzel) ? mitId : null;
        }
      }
      teile.unshift(pfadGlied(knoten));
      const jetzt = teile.join(" > ");
      if (eindeutig(jetzt, el, wurzel) && pfadTraegtMerkmal(jetzt)) return jetzt;
      knoten = knoten.parentElement;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Anker 5 — XPath
   * ------------------------------------------------------------------ */

  /**
   * Der letzte Ausweg. Er trifft immer und hält am wenigsten aus — genau
   * deshalb steht er unten und nicht oben.
   */
  function xpfadBauen(el) {
    const teile = [];
    let knoten = el;
    let tiefe = 0;
    while (istElement(knoten) && tiefe < 200) {
      teile.unshift(`${tagVon(knoten)}[${stelleUnterGleichen(knoten)}]`);
      knoten = knoten.parentElement;
      tiefe += 1;
    }
    return `/${teile.join("/")}`;
  }

  /* ------------------------------------------------------------------ *
   * Bauen
   * ------------------------------------------------------------------ */

  /**
   * Die Kaskade für ein Element, stärkster Anker zuerst (§7.1).
   *
   * @param {Element} el
   * @returns {string[]} mindestens ein Eintrag, solange `el` ein Element ist
   *
   * Für ein Element bricht sie nie ab: Der XPath steht immer am Ende, auch
   * wenn kein einziges Merkmal der Seite etwas hergab. Ist das Übergebene
   * gar kein Element, kommt die leere Liste zurück — ein erfundener Anker
   * wäre schlimmer als keiner, weil er beim Abspielen auf irgendetwas zeigt.
   */
  function kaskadeBauen(el) {
    if (!istElement(el)) return [];
    try {
      const wurzel = el.ownerDocument || (typeof document !== "undefined" ? document : null);
      const kaskade = [];
      const merken = (anker) => {
        if (!anker || kaskade.includes(anker)) return;
        if (kaskade.length >= KASKADE_HOECHSTENS - 1) return; // Platz für den XPath
        kaskade.push(anker);
      };
      const merkenWennEindeutig = (anker) => {
        if (!anker || kaskade.includes(anker)) return false;
        if (!wurzel || !eindeutig(anker, el, wurzel)) return false;
        merken(anker);
        return true;
      };

      /* 1. Datenmerkmale. Der Elementname kommt davor, wenn das Merkmal allein
            nicht eindeutig ist — zwei Listeneinträge mit demselben
            `data-testid` sind auf echten Seiten die Regel, nicht die Ausnahme. */
      for (const { name, wert } of datenMerkmale(el)) {
        const nackt = `[${name}="${wert}"]`;
        if (merkenWennEindeutig(nackt)) continue;
        merkenWennEindeutig(`${tagVon(el)}${nackt}`);
      }

      /* 2. `aria-label` zusammen mit der Rolle. Die ausdrückliche Rolle zuerst,
            sonst der Elementname als seine stillschweigende Rolle. */
      const label = merkmal(el, "aria-label");
      if (wertTaugt(label)) {
        const rolle = merkmal(el, "role").trim().toLowerCase().split(/\s+/)[0];
        const mitRolle = rolle
          ? `[role="${rolle}"][aria-label="${label}"]`
          : `${tagVon(el)}[aria-label="${label}"]`;
        merkenWennEindeutig(mitRolle);
        /* Ohne Rolle hinterher: Wechselt die Seite die Rolle des Knopfes,
           trägt die Beschriftung den Schritt allein weiter. */
        merkenWennEindeutig(`[aria-label="${label}"]`);
      }

      /* 2b. Stabile Merkmale, allen voran `name` (Befund B7, 14.08.2026).
             Sie stehen vor dem CSS-Pfad, weil sie die Bedeutung des Elements
             nennen und nicht seinen Platz im Gerüst: Ein `name` wandert nicht,
             wenn die Seite neu gebaut wird, eine Stellenangabe schon. */
      for (const name of STABILE_MERKMALE) {
        const wert = merkmal(el, name);
        if (!wertTaugt(wert)) continue;
        const nackt = `[${name}="${wert}"]`;
        /* Mit Elementname zuerst: Ein Optionsfeld und sein verstecktes
           Gegenstück tragen denselben `name`, und der nackte Selektor träfe
           beide. */
        if (merkenWennEindeutig(`${tagVon(el)}${nackt}`)) continue;
        merkenWennEindeutig(nackt);
      }

      /* 3. Stabiler CSS-Pfad. */
      if (wurzel) merkenWennEindeutig(pfadBauen(el, wurzel));

      /* 4. Textanker. Ohne Eindeutigkeitsprüfung über `querySelectorAll` —
            er ist kein CSS. Geprüft wird mit demselben Weg, der ihn später
            auflöst, damit Bauen und Auflösen nicht auseinanderlaufen.
            Befund B6 vom 14.08.2026: Genau hier stand der Einmalcode einer
            2FA-Seite als `text=849271`. Ein sichtbarer Text ist eben nicht
            deshalb harmlos, weil er sichtbar ist. */
      if (!traegtInhalt(el)) {
        const text = normText(el.textContent);
        if (
          text &&
          text.length <= TEXT_ZEICHEN &&
          textOffen(text) &&
          wurzel &&
          textAufloesen(text, wurzel) === el
        ) {
          merken(`text=${text}`);
        }
      }

      /* 5. XPath, immer. */
      kaskade.push(xpfadBauen(el));
      return kaskade;
    } catch (_) {
      /* Auch der Notausgang gibt einen Anker zurück: Ein Schritt ohne Anker
         wäre in `werkstatt.js` die Absage `anker_fehlt` und damit ein
         verlorener Aufnahmeschritt. */
      try {
        return [xpfadBauen(el)];
      } catch (__) {
        return [];
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Auflösen
   * ------------------------------------------------------------------ */

  function textAufloesen(text, wurzel) {
    const ziel = normText(text);
    if (!ziel) return null;
    let alle = [];
    try {
      alle = wurzel.querySelectorAll("*");
    } catch (_) {
      return null;
    }
    const grenze = Math.min(alle.length, TEXT_KNOTEN_HOECHSTENS);
    const treffer = [];
    for (let i = 0; i < grenze; i++) {
      const el = alle[i];
      if (!istElement(el) || traegtInhalt(el)) continue;
      if (normText(el.textContent) === ziel) treffer.push(el);
    }
    if (!treffer.length) return null;
    /* Der innerste Treffer ist der gemeinte: Der Text steht auch in jedem
       Vorfahren. */
    const innerste = treffer.filter((t) => !treffer.some((a) => a !== t && enthaelt(t, a)));
    /* Zwei gleich benannte Knöpfe sind keine Entscheidung, die diese Datei
       treffen darf. Sie meldet nichts und lässt den nächsten Anker ran —
       auf den falschen Knopf zu klicken wäre der teurere Fehler. */
    return innerste.length === 1 ? innerste[0] : null;
  }

  function xpfadAufloesen(pfad, wurzel) {
    const doc = dokumentVon(wurzel);
    if (!doc || typeof doc.evaluate !== "function") return null;
    try {
      /* 9 ist FIRST_ORDERED_NODE_TYPE. Die Zahl steht hier und nicht
         `XPathResult.FIRST_ORDERED_NODE_TYPE`, weil dieses Skript auch in
         Rahmen läuft, in denen `XPathResult` nicht im globalen Namensraum
         steht — eine geworfene Ausnahme wäre an dieser Stelle ein
         verschwundener Anker. */
      const erg = doc.evaluate(pfad, wurzel, null, 9, null);
      const knoten = erg && erg.singleNodeValue;
      return istElement(knoten) ? knoten : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Die Kaskade der Reihe nach probieren.
   *
   * @param {string[]} kaskade
   * @param {Document|Element} wurzel
   * @returns {{ok:true, el:Element, anker:string, stelle:number}
   *          |{ok:false, fehler:string, versucht:number}}
   *
   * Gemeldet wird, WELCHER Anker getroffen hat. Das ist keine Zierde: §7.4
   * schreibt eine geheilte Kaskade in den Ablauf zurück, und ohne die Stelle
   * wüsste niemand, ob der stärkste Anker noch trägt oder ob der Ablauf seit
   * Wochen am XPath hängt und beim nächsten Umbau ausfällt.
   *
   * Wirft nie. Ein kaputter Selektor aus einem von Hand veränderten Ablauf ist
   * hier keine Ausnahme, sondern ein Anker, der nicht trifft.
   */
  function kaskadeAufloesen(kaskade, wurzel) {
    const raum = wurzel || (typeof document !== "undefined" ? document : null);
    if (!Array.isArray(kaskade) || !kaskade.length) {
      return { ok: false, fehler: "anker_fehlt", versucht: 0 };
    }
    if (!raum) return { ok: false, fehler: "kaskade_gebrochen", versucht: 0 };

    let versucht = 0;
    for (let stelle = 0; stelle < kaskade.length; stelle++) {
      const anker = kaskade[stelle];
      if (typeof anker !== "string" || !anker.trim()) continue;
      versucht += 1;
      let treffer = null;
      if (anker.startsWith("text=")) {
        treffer = textAufloesen(anker.slice(5), raum);
      } else if (anker.startsWith("/") || anker.startsWith("(")) {
        treffer = xpfadAufloesen(anker, raum);
      } else {
        try {
          const alle = raum.querySelectorAll(anker);
          /* Auch beim Auflösen gilt Eindeutigkeit. Ein Anker, der nach einem
             Umbau plötzlich zwei Elemente trifft, hat seine Aussage verloren;
             das erste zu nehmen wäre geraten. */
          treffer = alle.length === 1 ? alle[0] : null;
        } catch (_) {
          treffer = null;
        }
      }
      if (istElement(treffer)) {
        return { ok: true, el: treffer, anker, stelle };
      }
    }
    /* Der Name aus §7.4. Der Ausführer meldet daraufhin
       `workflow_step_failed` mit der Beschreibung des gesuchten Elements. */
    return { ok: false, fehler: "kaskade_gebrochen", versucht };
  }

  globalThis.SMARTR_SELEKTOR = Object.freeze({
    kaskadeBauen,
    kaskadeAufloesen,
    /* Offen für den Rekorder und für die Prüfsätze. Die Zufallserkennung ist
       die einzige Regel hier, die man nicht am Ergebnis ablesen kann — eine
       weggeworfene Klasse sieht aus wie eine, die es nie gab. */
    klasseZufaellig,
    nameTaugt,
    wertTaugt,
    textOffen,
    pfadTraegtMerkmal,
    traegtInhalt,
    STABILE_MERKMALE,
    ZUFALL_REGELN,
    KASKADE_HOECHSTENS,
    TEXT_ZEICHEN,
    PFAD_EBENEN,
  });
})();
