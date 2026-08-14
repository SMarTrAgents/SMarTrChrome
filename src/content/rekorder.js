/*
 * SMarTrChrome — der Aufzeichner des Teach-Modus (Vertrag v3.5 §7.2).
 *
 * Ein KLASSISCHES Skript, kein Modul, und es braucht `selektor.js` vor sich.
 * Der Grund steht dort ausführlich: Inhaltsskripte können `src/net/*.js` nicht
 * importieren, und eine Wache in einem Modul, das im Klickweg niemand rufen
 * kann, ist am 11.08.2026 grün geprüft und ungenutzt ausgeliefert worden.
 *
 * Was hier passiert: Der Mensch macht einen Vorgang EINMAL von Hand, und
 * dieses Skript schreibt mit, was er getan hat — als Schrittliste im Format
 * aus §7.3, die `werkstatt.js` unverändert annimmt.
 *
 * Drei Bauentscheidungen, die keine Geschmacksfragen sind:
 *
 *  1. **Erfassungsphase.** Jeder Hörer hängt mit `capture: true` am Fenster.
 *     Eine Seite, die in ihrem eigenen Hörer `stopPropagation()` ruft — und
 *     das tut jede zweite Anmeldemaske —, schaltet damit sonst die ganze
 *     Aufzeichnung ab, ohne dass jemand etwas merkt. In der Erfassungsphase
 *     ist dieses Skript vor der Seite dran.
 *
 *  2. **Nur echte Eingaben.** `isTrusted` unterscheidet den Menschen von
 *     einem Skript. Ohne diese Zeile zeichnet der Rekorder die Klicks des
 *     eigenen Agenten mit auf (`overlay.js` sendet echte Ereignisketten) und
 *     jeden Klick, den die Seite selbst auslöst. Ein Ablauf, der die eigenen
 *     Schritte nochmal enthält, spielt sie beim nächsten Mal doppelt ab.
 *
 *  3. **Geheimfelder werden nicht gelesen.** Nicht „gelesen und dann
 *     verworfen", sondern gar nicht erst angefasst (§7.2). An die Stelle
 *     tritt der Schritt `user_input_required` mit der Begründung
 *     „Login/2FA". Die Erkennung ist dieselbe wie in `overlay.js`; sie steht
 *     hier ein zweites Mal, weil ein Inhaltsskript nichts importieren kann.
 *     Beide Listen gehören zusammen und müssen zusammen gepflegt werden.
 */

(() => {
  "use strict";

  if (window.__smartrchromeRekorder) return;

  /* ------------------------------------------------------------------ *
   * Zahlen, alle an einer Stelle
   * ------------------------------------------------------------------ */

  /* §7.2: Bildlauf gedrosselt, Wartezeit aus 500 ms DOM-Ruhe. */
  const BILDLAUF_MS = 250;
  const RUHE_MS = 500;

  /* Ein Bildlauf unter vier Pixeln ist kein Schritt, sondern ein Wackeln des
     Fingers auf dem Rollrad. */
  const BILDLAUF_MINDEST = 4;

  /* Spiegel von `WERKSTATT_GRENZEN` und `GRENZEN` aus `src/net/`. Sie stehen
     hier ein zweites Mal, weil ein Inhaltsskript nicht importieren kann —
     und sie stehen als benannte Zahlen, damit ein Prüfsatz sie halten kann.
     Wandern die Grenzen dort, wandern sie hier mit; ein Schritt jenseits
     davon würde in `workflowPruefen` als Absage enden, und der Mensch hätte
     eine Aufnahme gemacht, die sich nicht speichern lässt. */
  const SCHRITTE_HOECHSTENS = 500; // GRENZEN.schritteDeckel
  const WERT_ZEICHEN = 2000; // WERKSTATT_GRENZEN.wertZeichen
  const BESCHREIBUNG_ZEICHEN = 400; // WERKSTATT_GRENZEN.beschreibungZeichen
  const SCROLL_PIXEL = 3000; // GRENZEN.scrollPixel
  const ETIKETT_ZEICHEN = 200;
  const ADRESSE_ZEICHEN = 2000;

  /* Der Anlass eines Bildes aus `BILD_ANLAESSE` (befehle.js). Eine Aufnahme
     im Teach-Modus geschieht, weil ein Mensch sie angefordert hat — deshalb
     `user_request` und kein neuer Anlass. Eine zweite Liste von Anlässen
     wäre eine zweite Wahrheit über denselben Draht. */
  const BILD_ANLASS = "user_request";

  /* §7.2 wörtlich: die Begründung, die an die Stelle des Geheimnisses tritt. */
  const VERBOT_GRUND = "Login/2FA";

  /* Der Ablageschlüssel der laufenden Aufnahme. `local` und nicht `session`,
     weil `chrome.storage.session` für Inhaltsskripte standardmäßig
     verschlossen ist — den Zugang öffnet `setAccessLevel`, und das steht dem
     Worker zu, nicht uns.

     Warum überhaupt eine Ablage: Ein aufgezeichneter Ablauf führt über
     Seitenwechsel, der Schritttyp `navigate` steht nicht umsonst im Format.
     Beim Seitenwechsel stirbt dieses Skript samt seiner Schrittliste und wird
     im neuen Dokument frisch eingespielt. Ohne Ablage wäre jede Aufnahme, die
     eine Seite weitergeht, still verloren — und still verloren ist die
     schlechteste Art, etwas zu verlieren. */
  /* Derselbe Schlüssel steht als `REKORDER_ABLAGE` in `src/net/werkstatt.js`.
     Er steht hier ein zweites Mal, weil ein Inhaltsskript `src/net/*.js` nicht
     importieren kann; wer ihn dort ändert, ändert ihn hier mit. */
  const ABLAGE = "sa_rekorder";
  const ABLAGE_VERSION = 1;

  const WIRT_ID = "smartrchrome-rekorder";

  /* Jede Deklaration mit !important, dazu alles, womit sich ein Zeichen sonst
     unsichtbar machen lässt. Das ist keine Vorsicht auf Verdacht, sondern der
     nachgezogene Befund vom 11.08.2026 aus `overlay.js`: `transform:none`
     setzt `scale` NICHT zurück, und `clip`, `mask`, `mix-blend-mode`,
     `content-visibility`, `animation` und `transition` machen ein Zeichen
     unsichtbar, ohne display, visibility oder opacity anzufassen. Ein Inline-
     Stil mit !important steht über jeder Regel aus einem Seiten-Stylesheet.

     Warum das hier genauso streng sein muss wie beim Agentenrahmen: Eine
     Aufzeichnung, die läuft, ohne dass man es sieht, ist ein Mitschnitt. */
  const WIRT_STIL =
    "position:fixed !important;top:12px !important;right:12px !important;" +
    "left:auto !important;bottom:auto !important;" +
    "width:auto !important;height:auto !important;" +
    "max-width:none !important;max-height:none !important;" +
    "z-index:2147483646 !important;pointer-events:none !important;" +
    "margin:0 !important;padding:0 !important;border:0 !important;" +
    "display:block !important;visibility:visible !important;opacity:1 !important;" +
    "clip-path:none !important;clip:auto !important;mask:none !important;" +
    "transform:none !important;scale:none !important;rotate:none !important;" +
    "translate:none !important;filter:none !important;" +
    "mix-blend-mode:normal !important;content-visibility:visible !important;" +
    "animation:none !important;transition:none !important;contain:none !important;";

  const SCHILD_STIL =
    "display:flex !important;align-items:center !important;gap:8px !important;" +
    "font:600 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif !important;" +
    "color:#ffffff !important;background:#0b1020 !important;" +
    "border:2px solid #ff5d73 !important;border-radius:999px !important;" +
    "padding:6px 14px !important;white-space:nowrap !important;" +
    "box-shadow:0 2px 12px rgba(0,0,0,.45) !important;" +
    "visibility:visible !important;opacity:1 !important;";

  /* ------------------------------------------------------------------ *
   * Die Geheimerkennung — Zwilling von `geheim()` in content/overlay.js
   * ------------------------------------------------------------------ */

  /* Die standardisierten Autocomplete-Marken (WHATWG HTML 4.10.18.7). Die
     ganze cc-Familie zählt dazu: Nummer, Ablauf, Prüfziffer und Inhaber sind
     zusammen die Zahlung. */
  const GEHEIME_MARKEN = new Set(["current-password", "new-password", "one-time-code"]);

  /* Wörter, die für sich allein stehen müssen. „pin" steckt in „shipping",
     „tan" in „Standort". */
  const GEHEIM_WORT = new Set([
    "pin", "pins", "tan", "tans", "itan", "mtan", "puk",
    "cvc", "cvv", "csc", "otp", "iban", "bic",
  ]);

  /* Wortstücke, die auch mitten im Wort geheim bleiben. */
  const GEHEIM_TEIL = [
    "pass", "pwd", "kennwort", "geheim", "secret", "token", "einmal",
    "card", "karte", "kredit", "credit",
    "pruefziff", "prüfziff", "pruefnummer", "prüfnummer",
    "sicherheitscode", "sicherheitsfrage", "sicherheitsnummer",
    "ccnum", "ccexp", "cccsc", "ccname", "cctype",
  ];

  /* Befund M2 der Gegenlesung in `overlay.js`: „code" allein sagt nicht,
     welcher Code gemeint ist, sein Nachbar sagt es. Ohne diese Ausnahmen
     galten Postleitzahl, Ländervorwahl und Gutscheincode als Geheimnis. */
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

  const codeGeheim = (flach) => {
    if (!flach.includes("code")) return false;
    let rest = flach;
    for (const nachbar of CODE_HARMLOS) {
      rest = rest.split(`${nachbar}code`).join("|").split(`code${nachbar}`).join("|");
    }
    return rest.includes("code");
  };

  const woerterVon = (s) =>
    String(s || "")
      .replace(/([a-zäöüß0-9])([A-ZÄÖÜ])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-zäöüß0-9]+/)
      .filter(Boolean);

  const flachVon = (s) => String(s || "").toLowerCase().replace(/[^a-zäöüß0-9]+/g, "");

  const merkmal = (el, name) => {
    try {
      const w = el.getAttribute(name);
      return typeof w === "string" ? w : "";
    } catch (_) {
      return "";
    }
  };

  /* Die Beschriftung eines Feldes, ausdrücklich OHNE seinen Inhalt. Der Text
     IM Element sagt nichts darüber, ob das Feld geheim ist; das Etikett davor
     schon. Jedes Stück bleibt für sich: aneinandergehängt ergäben „Alp" und
     „Assistent" das Wortstück „pass". */
  const beschriftungVon = (el) => {
    const teile = [merkmal(el, "aria-label"), merkmal(el, "title"), merkmal(el, "placeholder")];
    const bez = merkmal(el, "aria-labelledby");
    if (bez) {
      for (const id of bez.split(/\s+/)) {
        const n = id && document.getElementById(id);
        if (n) teile.push(n.textContent || "");
      }
    }
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) teile.push(l.textContent || "");
      } catch (_) {
        /* Eine Kennung, die kein gültiger Selektor wird, hat kein Etikett.
           Das ist kein Grund, die ganze Erkennung fallen zu lassen. */
      }
    }
    if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && typeof el.closest === "function") {
      const um = el.closest("label");
      if (um) teile.push(um.textContent || "");
    }
    return teile.filter(Boolean);
  };

  /**
   * Trägt dieses Element ein Geheimnis?
   *
   * Wortgleich mit `geheim()` in `content/overlay.js` (Befund S5 und M2
   * dort). Wer eine der Listen ändert, ändert beide, sonst liest der Rekorder
   * etwas mit, das die Wahrnehmung längst verweigert.
   */
  function geheim(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    const kannInhalt =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
    if (!kannInhalt) return false;

    if (merkmal(el, "type").toLowerCase() === "password") return true;
    if (String(el.type || "").toLowerCase() === "password") return true;

    for (const marke of merkmal(el, "autocomplete").toLowerCase().split(/\s+/)) {
      if (!marke) continue;
      if (GEHEIME_MARKEN.has(marke)) return true;
      if (marke.startsWith("cc-")) return true;
    }

    const merkmale = [
      el.name || "",
      el.id || "",
      merkmal(el, "name"),
      merkmal(el, "autocomplete"),
      ...beschriftungVon(el),
    ];

    for (const m of merkmale) {
      for (const wort of woerterVon(m)) {
        if (GEHEIM_WORT.has(wort)) return true;
      }
      const flach = flachVon(m);
      if (flach && GEHEIM_TEIL.some((t) => flach.includes(t))) return true;
      if (flach && codeGeheim(flach)) return true;
    }
    return false;
  }

  /**
   * Gehört dieses Element zum Umfeld eines Geheimnisses?
   *
   * Das Feld selbst, und dazu der Knopf, der ein Formular mit einem
   * Geheimfeld absendet — das ist die Anmeldung. §3.1 zieht dieselbe Grenze
   * für den Klassifizierer („click auf ein Element in einem Formular, das ein
   * Geheimfeld enthält").
   *
   * Warum der Knopf mitzählt, obwohl er selbst nichts Geheimes trägt: Ein
   * aufgezeichneter Ablauf, der eine Anmeldemaske absendet, versucht beim
   * Abspielen eine Anmeldung ohne Passwort. Das ist im besten Fall ein
   * Fehlversuch und im schlechteren einer von dreien, nach denen das Konto
   * gesperrt ist. Anmelden bleibt Sache des Menschen.
   */
  function geheimUmfeld(el) {
    if (!el || el.nodeType !== 1) return false;
    if (geheim(el)) return true;
    if (typeof el.closest !== "function") return false;
    let form = null;
    try {
      form = el.closest("form");
    } catch (_) {
      form = null;
    }
    if (!form || typeof form.querySelectorAll !== "function") return false;
    let felder = [];
    try {
      felder = Array.from(form.querySelectorAll("input, textarea, select"));
    } catch (_) {
      return false;
    }
    if (!felder.some((f) => geheim(f))) return false;
    /* Nur die Absendewege des Formulars, nicht jeder Klick darin. Ein Klick
       auf „Passwort vergessen" ist kein Anmeldeversuch. */
    const tag = el.tagName;
    const art = merkmal(el, "type").toLowerCase();
    if (tag === "BUTTON" && art !== "button" && art !== "reset") return true;
    if (tag === "INPUT" && (art === "submit" || art === "image")) return true;
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Kleinkram
   * ------------------------------------------------------------------ */

  const jetzt = () =>
    typeof performance !== "undefined" && performance && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  /* Dieselbe Liste wie `STEUERZEICHEN` in `befehle.js`. Was in einen Ablauf
     geschrieben wird, hat ein Mensch später zu lesen oder vorgelesen zu
     bekommen; unsichtbare Steuerzeichen sind dort das, was man nicht hört. */
  const STEUERZEICHEN =
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

  function kuerzen(roh, grenze) {
    const s = String(roh == null ? "" : roh)
      .replace(STEUERZEICHEN, " ")
      .replace(/\s+/g, " ")
      .trim();
    return s.length <= grenze ? s : `${s.slice(0, grenze - 1)}…`;
  }

  /* Trägt dieses Element einen Inhalt, der nicht sein Name ist? Die Antwort
     kommt aus `selektor.js`, damit Anker und Beschreibung dieselbe Grenze
     ziehen. Fehlt sie, steht dieselbe Regel hier noch einmal. */
  function traegtInhalt(el) {
    const S = globalThis.SMARTR_SELEKTOR;
    if (S && typeof S.traegtInhalt === "function") {
      try {
        return S.traegtInhalt(el) === true;
      } catch (_) {
        /* dann von Hand */
      }
    }
    const tag = el && el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (!!el && el.isContentEditable === true);
  }

  /**
   * Der Name des Elements für die Rückfrage und für die Selbstheilung (§7.4).
   *
   * Ausdrücklich ohne Inhalt: Bei allem, was etwas trägt — Eingabefeld,
   * Auswahlliste, bearbeitbarer Bereich —, ist der Text IM Element das
   * Getippte. Es in die Beschreibung zu schreiben wäre genau der Weg an §7.2
   * vorbei, den diese Datei verschliessen soll.
   */
  function beschreibungVon(el) {
    const kandidaten = [merkmal(el, "aria-label"), merkmal(el, "title")];
    const bez = merkmal(el, "aria-labelledby");
    if (bez) {
      for (const id of bez.split(/\s+/)) {
        const n = id && document.getElementById(id);
        if (n) kandidaten.push(n.textContent || "");
      }
    }
    if (!traegtInhalt(el)) kandidaten.push(el.textContent || "");
    kandidaten.push(merkmal(el, "placeholder"), merkmal(el, "alt"), merkmal(el, "name"));
    for (const k of kandidaten) {
      const s = kuerzen(k, BESCHREIBUNG_ZEICHEN);
      if (s) return s;
    }
    return kuerzen(String(el.tagName || "").toLowerCase(), BESCHREIBUNG_ZEICHEN);
  }

  function rechteckVon(el) {
    try {
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.round(r.left)),
        y: Math.max(0, Math.round(r.top)),
        width: Math.max(0, Math.round(r.width)),
        height: Math.max(0, Math.round(r.height)),
      };
    } catch (_) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
  }

  function adresse() {
    try {
      return kuerzen(location.href, ADRESSE_ZEICHEN);
    } catch (_) {
      return "";
    }
  }

  function seitenY() {
    try {
      if (typeof window.scrollY === "number") return Math.round(window.scrollY);
      const d = document.documentElement;
      return d && typeof d.scrollTop === "number" ? Math.round(d.scrollTop) : 0;
    } catch (_) {
      return 0;
    }
  }

  function amEnde(y) {
    try {
      const d = document.documentElement;
      const hoehe = (d && d.scrollHeight) || 0;
      const sicht = typeof window.innerHeight === "number" ? window.innerHeight : 0;
      return hoehe > 0 && sicht > 0 && hoehe - (y + sicht) <= 2;
    } catch (_) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Zustand
   * ------------------------------------------------------------------ */

  let laeuft = false;
  let schritte = [];
  let bildNr = 0;
  let letzter = null; // { schritt, el, zeit } — nur intern, nie im Ablauf
  let letzteY = 0;
  let bildlaufUhr = null;
  let ruheUhr = null;
  let arbeitSeit = 0;
  let arbeitGesehen = false;
  let wirt = null;
  let schild = null;
  let beobachter = null;
  let hoerer = [];

  /* ------------------------------------------------------------------ *
   * Das Zeichen in der Seite
   * ------------------------------------------------------------------ */

  function zeichenText() {
    if (!schild) return;
    const n = schritte.length;
    schild.textContent = `● Aufnahme läuft, ${n === 1 ? "1 Schritt" : `${n} Schritte`}`;
  }

  function zeichenZeigen() {
    try {
      if (wirt && wirt.isConnected) {
        zeichenText();
        return;
      }
      wirt = document.createElement("div");
      wirt.id = WIRT_ID;
      wirt.style.cssText = WIRT_STIL;
      /* Geschlossen: Die Seite kommt an den Inhalt nicht heran, auch nicht
         über einen Griff auf den Wirt. Sie kann das Zeichen weder umschreiben
         noch seinen Stil kapern. */
      const schatten = wirt.attachShadow({ mode: "closed" });
      schild = document.createElement("div");
      schild.style.cssText = SCHILD_STIL;
      schatten.appendChild(schild);
      zeichenText();
      (document.body || document.documentElement).appendChild(wirt);
    } catch (_) {
      /* Ohne Zeichen wird trotzdem aufgezeichnet. Der Mensch sieht die
         Aufnahme dann in der Seitenleiste, die den Stand ohnehin bekommt. */
      wirt = null;
      schild = null;
    }
  }

  function zeichenNehmen() {
    try {
      if (wirt && typeof wirt.remove === "function") wirt.remove();
      else if (wirt && wirt.parentNode) wirt.parentNode.removeChild(wirt);
    } catch (_) {
      /* schon weg */
    }
    wirt = null;
    schild = null;
  }

  /* Hat ein Seitenskript den Wirt aus dem Baum genommen, kommt er zurück.
     Läuft am Beobachter mit, der ohnehin für die DOM-Ruhe hängt. */
  function zeichenNachziehen() {
    if (!laeuft || !wirt) return;
    if (wirt.isConnected) return;
    wirt = null;
    schild = null;
    zeichenZeigen();
  }

  /* ------------------------------------------------------------------ *
   * Nachrichten nach draussen
   * ------------------------------------------------------------------ */

  /* Niemand muss zuhören. Ist die Seitenleiste zu, lehnt Chrome die Nachricht
     ab („Receiving end does not exist"), als Versprechen wie als Ausnahme.
     Beides wird hier geschluckt: Eine Aufnahme darf nicht daran scheitern,
     dass gerade kein Fenster offen ist. */
  function melden(nachricht) {
    try {
      const zurueck = chrome.runtime.sendMessage(nachricht);
      if (zurueck && typeof zurueck.catch === "function") zurueck.catch(() => {});
    } catch (_) {
      /* Kontext weg oder niemand da. */
    }
  }

  function standMelden() {
    zeichenText();
    melden({ typ: "rekorder:stand", anzahl: schritte.length, laeuft });
  }

  /* Das Miniaturbild: Dieses Skript nennt Name, Rechteck und Anlass, die
     Aufnahme selbst macht der Ausführer über `captureVisibleTab` — mit seiner
     Qualitätsleiter aus Befund M7 vom 29.07.2026. Ein zweiter Bildweg im
     Inhaltsskript wäre dieselbe Frage ein zweites Mal, nur ungeprüft. */
  function bildMelden(name, el, nr) {
    melden({
      typ: "rekorder:bild",
      name,
      nr,
      anlass: BILD_ANLASS,
      rect: rechteckVon(el),
    });
  }

  /* ------------------------------------------------------------------ *
   * Ablage
   * ------------------------------------------------------------------ */

  function ablageSichern() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      const zurueck = chrome.storage.local.set({
        [ABLAGE]: { version: ABLAGE_VERSION, laeuft, bildNr, schritte },
      });
      if (zurueck && typeof zurueck.catch === "function") zurueck.catch(() => {});
    } catch (_) {
      /* Ohne Ablage lebt die Aufnahme nur bis zum nächsten Seitenwechsel. */
    }
  }

  function ablageLeeren() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      const zurueck = chrome.storage.local.remove(ABLAGE);
      if (zurueck && typeof zurueck.catch === "function") zurueck.catch(() => {});
    } catch (_) {
      /* nichts zu leeren */
    }
  }

  /* ------------------------------------------------------------------ *
   * Schritte
   * ------------------------------------------------------------------ */

  /**
   * Die geprüfte Kaskade für ein Element.
   *
   * Gebaut wird in `selektor.js`, und dort wird JEDER Anker gegen den Baum
   * gemessen. Trotzdem wird hier noch einmal aufgelöst, Anker für Anker, und
   * zwar aus einem Grund, der nicht Misstrauen heisst: Bauen und Auflösen
   * sind zwei Wege, und der XPath geht gar nicht durch die Messung beim Bauen
   * — er wird immer angehängt. Ein Element in einem geschlossenen
   * Schattenbaum findet sein eigener XPath nie wieder, und ein Anker, der das
   * Element JETZT nicht findet, findet es in einer Woche erst recht nicht.
   *
   * Findet kein einziger Anker zurück, bleibt der schwächste stehen: Ein
   * Schritt mit einem zweifelhaften Anker scheitert beim Abspielen laut, mit
   * `workflow_step_failed` und der Beschreibung des Elements, und §7.4 kann
   * ihn heilen. Ein Schritt, der gar nicht erst aufgezeichnet wird, fehlt
   * still — und still fehlen ist das Schlimmere.
   */
  function kaskadeFuer(el) {
    const S = globalThis.SMARTR_SELEKTOR;
    if (!S || typeof S.kaskadeBauen !== "function") return [];
    try {
      const gebaut = S.kaskadeBauen(el);
      const roh = Array.isArray(gebaut) ? Array.prototype.slice.call(gebaut) : [];
      if (!roh.length || typeof S.kaskadeAufloesen !== "function") return roh;
      const raum = el.ownerDocument || document;
      const geprueft = roh.filter((anker) => {
        const erg = S.kaskadeAufloesen([anker], raum);
        return !!erg && erg.ok === true && erg.el === el;
      });
      return geprueft.length ? geprueft : roh.slice(-1);
    } catch (_) {
      return [];
    }
  }

  /**
   * Einen Schritt anhängen.
   *
   * @param {object} schritt Rohbau im Format aus §7.3
   * @param {{el?:Element, bild?:boolean}} angaben
   * @returns {object|null} der eingetragene Schritt, oder null
   *
   * Gibt null zurück, statt zu werfen: Ein Ereignis, aus dem kein Schritt
   * wird, ist kein Grund, die Aufnahme zu beenden.
   */
  function schrittHinzu(schritt, angaben = {}) {
    if (schritte.length >= SCHRITTE_HOECHSTENS) return null;
    if (angaben.el) {
      const kaskade = kaskadeFuer(angaben.el);
      /* Ohne Anker kein Schritt: `werkstatt.js` lehnt ihn mit `anker_fehlt`
         ab, und ein Ablauf, der beim Speichern zerbricht, ist schlimmer als
         ein Schritt, der gar nicht erst entsteht. */
      if (!kaskade.length) return null;
      schritt.selector_cascade = kaskade;
      const bez = beschreibungVon(angaben.el);
      if (bez) schritt.beschreibung = bez;
    }
    if (angaben.bild && angaben.el) {
      bildNr += 1;
      schritt.screenshot = `s${bildNr}.webp`;
      bildMelden(schritt.screenshot, angaben.el, schritte.length + 1);
    }
    schritte.push(schritt);
    letzter = { schritt, el: angaben.el || null, zeit: jetzt() };
    /* Nach jedem Schritt zählt die Ruhe neu: Was die Seite jetzt tut, ist die
       Folge dieses Schrittes. */
    arbeitSeit = 0;
    arbeitGesehen = false;
    standMelden();
    ablageSichern();
    return schritt;
  }

  /**
   * Die Stelle, an der der Mensch übernimmt (§7.2).
   *
   * Hier wird KEIN Wert gelesen, auch nicht, um ihn danach zu verwerfen. Der
   * Aufrufer kommt gar nicht erst an `el.value` vorbei — deshalb steht diese
   * Abzweigung in jedem Ereignisweg VOR dem Auslesen und nicht danach.
   */
  function menschUebernimmt() {
    const vorher = schritte[schritte.length - 1];
    /* Ein zweiter Tastendruck ins selbe Feld ist dieselbe Übergabe. */
    if (vorher && vorher.type === "user_input_required") return vorher;
    return schrittHinzu({ type: "user_input_required", reason: VERBOT_GRUND });
  }

  function navigationMerken() {
    const url = adresse();
    if (!url || !/^https?:/i.test(url)) return null;
    for (let i = schritte.length - 1; i >= 0; i--) {
      if (schritte[i].type === "navigate") {
        if (schritte[i].url === url) return null;
        break;
      }
    }
    return schrittHinzu({ type: "navigate", url, wait: "load" });
  }

  /* ------------------------------------------------------------------ *
   * Ereignisse
   * ------------------------------------------------------------------ */

  function eigenesZeichen(knoten) {
    let el = knoten && knoten.nodeType === 1 ? knoten : knoten && knoten.parentElement;
    let tiefe = 0;
    while (el && el.nodeType === 1 && tiefe < 200) {
      const id = el.id || merkmal(el, "id");
      if (id === WIRT_ID || id === "smartrchrome-host") return true;
      el = el.parentElement;
      tiefe += 1;
    }
    return false;
  }

  function aufnahmefaehig(e) {
    if (!laeuft) return false;
    if (!e) return false;
    /* Nur der Mensch. Die Ereignisketten des eigenen Agenten (overlay.js) und
       alles, was die Seite selbst auslöst, tragen isTrusted === false. */
    if (e.isTrusted !== true) return false;
    if (schritte.length >= SCHRITTE_HOECHSTENS) return false;
    const el = e.target;
    if (!el || el.nodeType !== 1) return false;
    if (eigenesZeichen(el)) return false;
    return true;
  }

  function aufZeigen(e, typ) {
    if (!aufnahmefaehig(e)) return;
    const el = e.target;
    if (geheimUmfeld(el)) {
      menschUebernimmt();
      return;
    }
    if (typ === "dblclick") {
      /* Ein Doppelklick kommt im Browser NACH zwei Klicks. Beide stehen zu
         lassen hiesse, beim Abspielen dreimal zu klicken. */
      const vorher = schritte[schritte.length - 1];
      if (vorher && vorher.type === "click" && letzter && letzter.el === el) {
        schritte.pop();
        /* Auch die Bildnummer geht zurück, sonst fordert die Aufnahme ein
           Bild an, auf das kein Schritt mehr zeigt. */
        if (vorher.screenshot === `s${bildNr}.webp`) bildNr -= 1;
      }
    }
    schrittHinzu({ type: typ }, { el, bild: true });
  }

  function aufEingabe(e) {
    if (!aufnahmefaehig(e)) return;
    const el = e.target;
    /* Die Abzweigung steht VOR jedem Zugriff auf den Wert. Das ist der ganze
       Unterschied zwischen „wird nicht aufgezeichnet" und „wird gelesen und
       dann weggelassen". */
    if (geheimUmfeld(el)) {
      menschUebernimmt();
      return;
    }
    const tag = el.tagName;
    let wert = null;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const art = merkmal(el, "type").toLowerCase() || "text";
      /* Ankreuzfelder, Dateiwahl und Knöpfe sind kein Tippen. Der Klick
         darauf ist schon aufgezeichnet, ihr „Wert" wäre entweder ein
         Wahrheitswert oder ein erfundener Dateipfad. */
      if (["checkbox", "radio", "file", "submit", "button", "reset", "image", "range"].includes(art)) return;
      wert = el.value == null ? "" : String(el.value);
    } else if (el.isContentEditable === true) {
      wert = el.textContent == null ? "" : String(el.textContent);
    } else {
      return;
    }
    const kurz = kuerzen(wert, WERT_ZEICHEN);

    /* Jeder Tastendruck ist ein `input`-Ereignis. Aufgezeichnet wird der
       Stand des Feldes, nicht die Reise dorthin. */
    const vorher = schritte[schritte.length - 1];
    if (vorher && vorher.type === "input" && letzter && letzter.el === el) {
      vorher.value = kurz;
      letzter.zeit = jetzt();
      standMelden();
      ablageSichern();
      return;
    }
    /* `clear` steht auf true, weil aufgezeichnet wird, was am Ende IM Feld
       steht. Ohne Leeren hinge der neue Wert beim Abspielen an dem, was das
       Formular vorbelegt hatte. */
    schrittHinzu({ type: "input", value: kurz, clear: true }, { el });
  }

  function aufWechsel(e) {
    if (!aufnahmefaehig(e)) return;
    const el = e.target;
    /* §7.2: `change` nur für Auswahllisten. Bei einem Textfeld ist `change`
       das Verlassen des Feldes und damit ein zweiter Schritt für dieselbe
       Eingabe. */
    if (el.tagName !== "SELECT") return;
    if (geheimUmfeld(el)) {
      menschUebernimmt();
      return;
    }
    const schritt = { type: "select" };
    let option = null;
    try {
      option = el.options && el.options[el.selectedIndex];
    } catch (_) {
      option = null;
    }
    const etikett = option ? kuerzen(option.text, ETIKETT_ZEICHEN) : "";
    const wert = option && typeof option.value === "string" ? option.value.trim() : "";
    /* Genau ein Weg, sonst lehnt `workflowPruefen` den Schritt ab. Das
       Etikett zuerst: Es ist das, was der Mensch gesehen hat und was ihm in
       der Rückfrage vorgelesen wird. */
    if (etikett) schritt.label = etikett;
    else if (wert) schritt.value = wert;
    else schritt.index = Math.max(0, Number(el.selectedIndex) || 0);
    schrittHinzu(schritt, { el, bild: true });
  }

  function aufTaste(e) {
    if (!aufnahmefaehig(e)) return;
    /* §7.2: nur Enter und Tab. Jede weitere Taste wäre eine Eingabe ohne
       sichtbares Feld — und in einem Passwortfeld wäre sie der Wert selbst,
       Zeichen für Zeichen. */
    if (e.key !== "Enter" && e.key !== "Tab") return;
    if (geheimUmfeld(e.target)) {
      menschUebernimmt();
      return;
    }
    schrittHinzu({ type: "key", key: e.key });
  }

  function bildlaufBuchen() {
    bildlaufUhr = null;
    if (!laeuft) return;
    const y = seitenY();
    const weg = y - letzteY;
    if (Math.abs(weg) < BILDLAUF_MINDEST) return;
    letzteY = y;

    const schritt = { type: "scroll" };
    if (y === 0) {
      schritt.direction = "top";
    } else if (amEnde(y)) {
      schritt.direction = "bottom";
    } else {
      schritt.direction = weg > 0 ? "down" : "up";
      schritt.amount = Math.min(SCROLL_PIXEL, Math.abs(weg));
    }

    /* Zwei Bildläufe in dieselbe Richtung sind eine Bewegung. Sie zu
       addieren hält den Ablauf kurz und spielt sich genauso ab. */
    const vorher = schritte[schritte.length - 1];
    if (
      vorher &&
      vorher.type === "scroll" &&
      vorher.direction === schritt.direction &&
      typeof vorher.amount === "number" &&
      typeof schritt.amount === "number"
    ) {
      vorher.amount = Math.min(SCROLL_PIXEL, vorher.amount + schritt.amount);
      standMelden();
      ablageSichern();
      return;
    }
    schrittHinzu(schritt);
  }

  function aufBildlauf() {
    if (!laeuft) return;
    /* §7.2: gedrosselt auf 250 ms. Ohne Drossel entstünde je Rollrad-Raste
       ein Schritt, und das Schrittlimit wäre nach einer Bildschirmseite
       erreicht. Gebucht wird am Ende des Fensters die NETTO-Bewegung, ein
       Vor und Zurück ist keine. */
    if (bildlaufUhr !== null) return;
    bildlaufUhr = setTimeout(bildlaufBuchen, BILDLAUF_MS);
  }

  function knotenliste(roh) {
    if (!roh) return [];
    try {
      return Array.prototype.slice.call(roh);
    } catch (_) {
      return [];
    }
  }

  function fremdeAenderung(eintraege) {
    for (const r of eintraege || []) {
      if (!r) continue;
      if (r.target && eigenesZeichen(r.target)) continue;
      const bewegt = [...knotenliste(r.addedNodes), ...knotenliste(r.removedNodes)];
      if (bewegt.length && bewegt.every((n) => eigenesZeichen(n))) continue;
      return true;
    }
    return false;
  }

  function ruheBuchen() {
    ruheUhr = null;
    if (!laeuft || !arbeitGesehen) return;
    const dauer = Math.max(1, Math.round(jetzt() - arbeitSeit));
    arbeitGesehen = false;
    arbeitSeit = 0;
    /* Eine Wartezeit ohne vorangehenden Schritt beschreibt nichts: Die Seite
       hat sich von selbst bewegt, eine Uhr, ein Banner, ein Nachladen. Und
       hinter einem `navigate` steht das Warten schon im Schritt. */
    const vorher = schritte[schritte.length - 1];
    if (!vorher || vorher.type === "wait" || vorher.type === "navigate") return;
    schrittHinzu({
      type: "wait",
      until: "idle",
      beschreibung: `Die Seite hat nach dem vorigen Schritt ${dauer} Millisekunden gearbeitet.`,
    });
  }

  function aufAenderung(eintraege) {
    zeichenNachziehen();
    if (!laeuft) return;
    if (!fremdeAenderung(eintraege)) return;
    arbeitGesehen = true;
    if (!arbeitSeit) arbeitSeit = jetzt();
    if (ruheUhr !== null) clearTimeout(ruheUhr);
    /* §7.2: 500 ms ohne Änderung heisst „die Seite ist fertig". */
    ruheUhr = setTimeout(ruheBuchen, RUHE_MS);
  }

  function aufOrtswechsel() {
    if (!laeuft) return;
    navigationMerken();
  }

  /* ------------------------------------------------------------------ *
   * Hörer an und ab
   * ------------------------------------------------------------------ */

  /* Die beiden Zeigerwege teilen sich eine Funktion. Damit
     `removeEventListener` später dieselbe Kennung sieht, wird sie einmal
     gebaut und gemerkt — eine frisch gebaute Pfeilfunktion wäre ein anderer
     Hörer, und der alte bliebe für immer hängen. */
  const zeigerHoerer = {};
  function zeigerWeg(typ) {
    if (!zeigerHoerer[typ]) zeigerHoerer[typ] = (e) => aufZeigen(e, typ);
    return zeigerHoerer[typ];
  }

  function hoerenAn() {
    if (hoerer.length) return;
    /* ALLE in der Erfassungsphase. Siehe Kopf der Datei: Eine Seite, die
       `stopPropagation()` ruft, schaltet sonst die Aufzeichnung ab. */
    const paare = [
      ["click", zeigerWeg("click")],
      ["dblclick", zeigerWeg("dblclick")],
      ["input", aufEingabe],
      ["change", aufWechsel],
      ["keydown", aufTaste],
      ["scroll", aufBildlauf],
      ["popstate", aufOrtswechsel],
      ["hashchange", aufOrtswechsel],
    ];
    for (const [name, fn] of paare) {
      /* `passive` nur beim Bildlauf: Dort sagt es dem Browser zu, dass hier
         nichts abgefangen wird, und hält das Rollen flüssig. */
      const o = name === "scroll" ? { capture: true, passive: true } : { capture: true };
      try {
        window.addEventListener(name, fn, o);
        hoerer.push([name, fn, o]);
      } catch (_) {
        /* Ein Ereignis, das dieser Rahmen nicht kennt, ist kein Grund
           aufzuhören. */
      }
    }
    try {
      beobachter = new MutationObserver(aufAenderung);
      beobachter.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    } catch (_) {
      beobachter = null;
    }
  }

  function hoerenAb() {
    for (const [name, fn, o] of hoerer) {
      try {
        window.removeEventListener(name, fn, o);
      } catch (_) {
        /* schon ab */
      }
    }
    hoerer = [];
    try {
      if (beobachter) beobachter.disconnect();
    } catch (_) {
      /* schon getrennt */
    }
    beobachter = null;
    if (bildlaufUhr !== null) {
      clearTimeout(bildlaufUhr);
      bildlaufUhr = null;
    }
    if (ruheUhr !== null) {
      clearTimeout(ruheUhr);
      ruheUhr = null;
    }
  }

  /* ------------------------------------------------------------------ *
   * Start, Stopp, Stand
   * ------------------------------------------------------------------ */

  function starten() {
    const S = globalThis.SMARTR_SELEKTOR;
    if (!S || typeof S.kaskadeBauen !== "function") {
      /* Eine Absage mit Begründung und Hinweis, keine Ausnahme: Am anderen
         Ende wartet die Seitenleiste auf eine Aussage. */
      return {
        ok: false,
        fehler: "selektor_fehlt",
        satz: "Die Aufnahme kann nicht starten, weil die Selektor-Kaskade in dieser Seite fehlt.",
        hinweis: "Den Tab neu laden. Bleibt es dabei, wurde selektor.js nicht vor rekorder.js eingespielt.",
      };
    }
    if (laeuft) return { ok: true, laeuft: true, anzahl: schritte.length, schon: true };

    laeuft = true;
    schritte = [];
    bildNr = 0;
    letzter = null;
    letzteY = seitenY();
    arbeitSeit = 0;
    arbeitGesehen = false;
    hoerenAn();
    zeichenZeigen();
    /* Ein Ablauf fängt dort an, wo der Mensch stand. Ohne diesen Schritt
       spielte er auf der Seite ab, die gerade zufällig offen ist. */
    navigationMerken();
    standMelden();
    ablageSichern();
    return { ok: true, laeuft: true, anzahl: schritte.length };
  }

  function stoppen() {
    hoerenAb();
    zeichenNehmen();
    const raus = schritte.map((s) => ({ ...s }));
    const lief = laeuft;
    laeuft = false;
    letzter = null;
    schritte = [];
    bildNr = 0;
    ablageLeeren();
    melden({ typ: "rekorder:stand", anzahl: 0, laeuft: false });
    const antwort = { ok: true, laeuft: false, anzahl: raus.length, schritte: raus };
    if (!raus.length) {
      antwort.satz = lief
        ? "Die Aufnahme ist beendet, aufgezeichnet wurde nichts."
        : "Es lief keine Aufnahme, aufgezeichnet wurde nichts.";
    }
    return antwort;
  }

  function stand() {
    return {
      ok: true,
      laeuft,
      anzahl: schritte.length,
      voll: schritte.length >= SCHRITTE_HOECHSTENS,
    };
  }

  /* ------------------------------------------------------------------ *
   * Wiederaufnahme nach einem Seitenwechsel
   * ------------------------------------------------------------------ */

  function wiederaufnehmen() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      const zurueck = chrome.storage.local.get(ABLAGE);
      if (!zurueck || typeof zurueck.then !== "function") return;
      zurueck
        .then((daten) => {
          const gemerkt = daten && daten[ABLAGE];
          if (!gemerkt || gemerkt.laeuft !== true || !Array.isArray(gemerkt.schritte)) return;
          if (laeuft) return; // in diesem Dokument wurde schon gestartet
          laeuft = true;
          schritte = gemerkt.schritte;
          bildNr = Number(gemerkt.bildNr) || 0;
          letzter = null;
          letzteY = seitenY();
          hoerenAn();
          zeichenZeigen();
          /* Der Seitenwechsel selbst ist ein Schritt. Aufgezeichnet wird er
             hier, im neuen Dokument — im alten war das Skript beim Verlassen
             schon nicht mehr da. */
          navigationMerken();
          standMelden();
          ablageSichern();
        })
        .catch(() => {});
    } catch (_) {
      /* Ohne Ablage bleibt die Aufnahme auf dieses Dokument beschränkt. */
    }
  }

  /* ------------------------------------------------------------------ *
   * Der Eintritt in den Produktivweg
   * ------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((n, _absender, antwort) => {
    /* Jeder Weg antwortet, in jedem Fall. Bleibt einer stumm, wartet die
       Seitenleiste, bis ihre Frist abläuft, und der Mensch sieht einen Knopf,
       der nichts tut. */
    const typ = n && n.typ;
    try {
      switch (typ) {
        case "rekorder:start":
          antwort(starten());
          break;
        case "rekorder:stop":
          antwort(stoppen());
          break;
        case "rekorder:stand":
          antwort(stand());
          break;
        case "rekorder:ping":
          antwort({ ok: true, laeuft });
          break;
        default:
          /* Nicht unsere Nachricht. `false` heisst: Hier kommt keine Antwort,
             ein anderer Hörer ist dran. Wer hier antworten würde, nähme
             `overlay.js` im selben Tab jede Antwort weg. */
          return false;
      }
    } catch (fehler) {
      antwort({
        ok: false,
        fehler: "rekorder_gestoert",
        satz: "Die Aufnahme konnte diesen Schritt nicht beantworten.",
        hinweis: "Aufnahme beenden und noch einmal starten.",
      });
    }
    return true;
  });

  /* Für die Prüfsätze und für den Fall, dass ein anderes Inhaltsskript
     dieselbe Frage stellen muss: Die Geheimerkennung ist die einzige Regel
     hier, deren Ergebnis man dem Ablauf nicht ansieht — ein nicht
     aufgezeichneter Wert sieht aus wie ein Wert, den es nie gab. */
  globalThis.SMARTR_REKORDER = Object.freeze({ geheim, geheimUmfeld, stand, VERBOT_GRUND });

  window.__smartrchromeRekorder = true;
  wiederaufnehmen();
})();
