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

  /* Wie weit vor einem Bild geschaut wird. Beide Zahlen sind Deckel für den
     Rechner des Nutzers und nicht für die Wache: Wird einer erreicht, wird
     KEIN Bild angefordert. Eine Seite, die zu gross zum Ansehen ist, ist
     nicht deshalb harmlos. */
  const BILD_FELDER_HOECHSTENS = 200;
  const BILD_TEXT_ZEICHEN = 200000;

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
   * Die Geheimerkennung — sie steht nicht mehr hier
   *
   * Bis zum 14.08.2026 stand an dieser Stelle eine Zwillingsfassung der
   * Erkennung aus `content/overlay.js`, Wort für Wort abgeschrieben, mit dem
   * Kommentar „wer eine der Listen ändert, ändert beide". Genau das ist nicht
   * geschehen. Die Abnahme hat drei Lecks gemessen, die alle drei in
   * `sa_workflows` gelandet sind: sechs Kästchen eines Einmalcodes, eine
   * Kartennummer im Branchenfeld `name="pan"` und ein Passwortfeld nach dem
   * Klick aufs Auge (`type=text`, `name="pw"`).
   *
   * Ab Festlegung F4 gibt es genau eine Quelle: `content/geheim.js`, als
   * erste Datei eingespielt, erreichbar über `globalThis.SMARTR_GEHEIM`. Sie
   * entscheidet nicht mehr, was NICHT gespeichert wird, sondern was
   * nachweislich harmlos ist — alles andere wird zu `user_input_required`.
   * ------------------------------------------------------------------ */

  const quelle = () => globalThis.SMARTR_GEHEIM;

  /* Ohne die eine Quelle wird nichts aufgezeichnet. Das ist kein Notausgang,
     sondern die Zusage selbst: Eine Aufnahme ohne Geheimerkennung schreibt
     alles mit, was in einem Feld steht. Lieber gar keine Aufnahme als eine,
     die man erst hinterher liest. */
  const geheimBereit = () => {
    const G = quelle();
    return !!(G && typeof G.wertFreigeben === "function" && typeof G.geheimUmfeld === "function");
  };

  const geheim = (el) => {
    const G = quelle();
    if (!G || typeof G.geheim !== "function") return true; // im Zweifel geheim
    try {
      return G.geheim(el) === true;
    } catch (_) {
      return true;
    }
  };

  const geheimUmfeld = (el) => {
    const G = quelle();
    if (!G || typeof G.geheimUmfeld !== "function") return true;
    try {
      return G.geheimUmfeld(el) === true;
    } catch (_) {
      return true;
    }
  };

  /* ------------------------------------------------------------------ *
   * Kleinkram
   * ------------------------------------------------------------------ */

  const merkmal = (el, name) => {
    try {
      const w = el.getAttribute(name);
      return typeof w === "string" ? w : "";
    } catch (_) {
      return "";
    }
  };

  /* Darf dieser Text in den Ablauf? Dieselbe Frage und dieselbe Antwort wie
     in `selektor.js` — beide fragen `content/geheim.js`. Fehlt sie, wird
     nicht geraten (Befund B6, 14.08.2026). */
  const textOffen = (text) => {
    const G = quelle();
    if (!G || typeof G.textHarmlos !== "function") return false;
    try {
      return G.textHarmlos(text) === true;
    } catch (_) {
      return false;
    }
  };

  /* Darf dieser FELDINHALT in den Ablauf? Die andere Hälfte derselben Frage,
     und ausdrücklich nicht dieselbe Antwort: Eine reine Ziffernkette IST der
     Inhalt einer Artikelnummer. Entschieden wird auch das in
     `content/geheim.js`; fehlt sie, wird nicht geraten. */
  const wertOffen = (roh) => {
    const G = quelle();
    if (!G || typeof G.wertHarmlos !== "function") return false;
    try {
      return G.wertHarmlos(roh) === true;
    } catch (_) {
      return false;
    }
  };

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

  /**
   * Der Name des Elements für die Rückfrage, für die Selbstheilung (§7.4) und
   * ab Festlegung F3 für den Identitätsvergleich.
   *
   * Gebaut wird sie in `content/geheim.js`, und das aus zwei Gründen.
   * Erstens ist die Beschreibung eine Leckstelle: Befund B6 vom 14.08.2026
   * hat den Einmalcode einer 2FA-Seite genau hier herausgetragen
   * („beschreibung":"849271"), weil der Text IM Element ungeprüft übernommen
   * wurde. Zweitens antwortet `overlay:kaskade` ab F3 mit `name`, und der
   * Ausführer hält ihn gegen genau dieses Feld. Zwei Funktionen, die den
   * Namen verschieden bilden, meldeten einen Unterschied, wo keiner ist.
   *
   * Fehlt die Quelle, bleibt der Elementname. Er sagt wenig und verrät
   * nichts — und ohne Quelle läuft ohnehin keine Aufnahme.
   */
  function beschreibungVon(el) {
    const G = quelle();
    if (G && typeof G.beschreibungVon === "function") {
      try {
        return G.beschreibungVon(el, BESCHREIBUNG_ZEICHEN);
      } catch (_) {
        /* dann gar keine Beschreibung, siehe unten */
      }
    }
    /* Vorher stand hier der nackte Elementname („input", „button"). Genau der
       war Befund TEACH-1 vom 14.08.2026: Zwei verschiedene Felder hiessen
       beide „input", der Identitätsvergleich aus F3 fand keinen Unterschied,
       und die Artikelnummer wurde ins Titelfeld getippt.
       Ohne die eine Quelle wird deshalb kein Name mehr erfunden. Ein Schritt
       ohne Beschreibung sagt „ich weiss nicht, wie das Element heisst"; ein
       Schritt mit „input" behauptet einen Namen. Der Fall ist ohnehin
       theoretisch: Ohne `content/geheim.js` startet gar keine Aufnahme
       (`geheimBereit`). */
    return "";
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

  /* Prozentzeichen zurückdrehen, so weit es geht. Eine Seite, die ihren
     Einmalcode als `%38%34%39%32%37%31` in die Adresse schreibt, hat ihn
     immer noch in der Adresse. Misslingt das Zurückdrehen, wird die rohe
     Fassung gemessen und nicht die halbe. */
  function ausgepackt(roh) {
    let s = String(roh == null ? "" : roh);
    for (let runde = 0; runde < 3 && /%[0-9a-fA-F]{2}/.test(s); runde++) {
      try {
        const naechste = decodeURIComponent(s);
        if (naechste === s) break;
        s = naechste;
      } catch (_) {
        break;
      }
    }
    return s;
  }

  /**
   * Trägt dieses Stück Adresse ein Geheimnis?
   *
   * Gefragt wird beides, der NAME des Parameters und sein WERT, und beide in
   * ausgepackter Fassung. Für den Namen gilt dieselbe Wortliste, mit der ein
   * Feld als geheim erkannt wird (`?token=`, `?otp=`, `?code=`, `#id_token=`);
   * für den Wert die Gestaltprüfung eines Feldinhalts und nicht die eines
   * Textes. Der Unterschied ist gemessen: `https://www.ebay.de/itm/123456789012`
   * ist der Alltag dieses Produkts, und wer reine Ziffern in einer Adresse
   * verbietet, schickt jedes Abspielen auf die Startseite.
   */
  function adressteilGeheim(stueck) {
    const G = quelle();
    if (!G || typeof G.bezeichnungGeheim !== "function") return true; // im Zweifel weg
    const roh = String(stueck == null ? "" : stueck);
    const trennung = roh.indexOf("=");
    const name = trennung < 0 ? "" : ausgepackt(roh.slice(0, trennung));
    const wert = trennung < 0 ? ausgepackt(roh) : ausgepackt(roh.slice(trennung + 1));
    try {
      if (name && G.bezeichnungGeheim(name) === true) return true;
    } catch (_) {
      return true;
    }
    return !wertOffen(wert);
  }

  /**
   * Die Adresse, wie sie in den Ablauf darf.
   *
   * Befund derselben Bauart wie TEACH-2, an einer Stelle, die noch niemand
   * gemessen hat: `navigate` schrieb `location.href` ungeprüft in den Ablauf.
   * Ein Bestätigungslink aus der E-Mail (`?token=…`), eine
   * OAuth-Rückleitung (`#access_token=…`) und ein Zurücksetzen-Link
   * (`?code=…`) sind genau das, worüber ein Mensch beim Aufzeichnen geht, und
   * sie lagen danach unverschlüsselt in `sa_workflows`.
   *
   * Weggeworfen wird so wenig wie möglich: nur der einzelne Parameter, der
   * nicht durchgeht. Pfad und Wirt bleiben immer stehen, denn ohne sie findet
   * der Ablauf seine Seite nicht wieder, und ein Schritt, der auf die falsche
   * Seite führt, ist schlimmer als einer, dem ein Parameter fehlt.
   *
   * @returns {{url: string, gekuerzt: boolean}}
   */
  function adresseFuerAblauf(roh) {
    const ganz = String(roh == null ? "" : roh);
    const raute = ganz.indexOf("#");
    const ohneRaute = raute < 0 ? ganz : ganz.slice(0, raute);
    const fragment = raute < 0 ? "" : ganz.slice(raute + 1);
    const frage = ohneRaute.indexOf("?");
    const basis = frage < 0 ? ohneRaute : ohneRaute.slice(0, frage);
    const suche = frage < 0 ? "" : ohneRaute.slice(frage + 1);

    let gekuerzt = false;
    const sieben = (teil) => {
      if (!teil) return "";
      const stuecke = teil.split("&");
      const bleibt = stuecke.filter((s) => {
        if (!s) return false;
        if (adressteilGeheim(s)) {
          gekuerzt = true;
          return false;
        }
        return true;
      });
      return bleibt.join("&");
    };

    const neueSuche = sieben(suche);
    const neuesFragment = sieben(fragment);
    let url = basis;
    if (neueSuche) url += `?${neueSuche}`;
    if (neuesFragment) url += `#${neuesFragment}`;
    return { url, gekuerzt };
  }

  function adresse() {
    try {
      return String(location.href || "");
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

  /**
   * Darf gerade ein Bild des sichtbaren Tabs angefordert werden?
   *
   * Befund TEACH-8 vom 14.08.2026: Zu jedem Klick- und Auswahlschritt wurde
   * ein JPEG des GANZEN sichtbaren Tabs nach `chrome.storage.local`
   * geschrieben, ohne jede Geheimprüfung. Gemessen: Der Klick auf den
   * Hinweistext einer 2FA-Seite ergab `"screenshot": "s1.webp"` — eine
   * Bildanforderung genau in dem Augenblick, in dem der Einmalcode auf dem
   * Schirm stand. `geheimUmfeld` schützt nur Elemente IM Geheimabschnitt;
   * jeder Klick daneben, etwa auf ein Zustimmungshäkchen, ging durch.
   *
   * Ein Bild ist keine Zeile im Ablauf, sondern ein Abbild des Bildschirms:
   * Die Wache dafür kann nicht am angeklickten Element hängen, sie muss die
   * SEITE ansehen. Drei Fragen, jede mit einem eigenen Grund:
   *
   *  1. Steht auf dieser Seite ein Geheimfeld oder eine Reihe von
   *     Codekästchen? Dann ist es eine Anmelde-, 2FA- oder Zahlungsmaske,
   *     und was darauf zu sehen ist, gehört nicht auf die Platte.
   *  2. Steht im SICHTBAREN Text irgendwo eine Kartennummer, ein Mischcode
   *     oder ein Wiederherstellungsschlüssel? Dann zeigt der Bildschirm ihn
   *     gerade. Gemessen wird hier mit der Wertregel und nicht mit der
   *     Textregel: Eine Preisliste voller Zahlen ist kein Geheimnis, sonst
   *     gäbe es auf keiner echten Seite je wieder ein Bild.
   *  3. Und im Abschnitt um das angeklickte Element herum gilt die strenge
   *     Textregel, denn dort schaut der Mensch gerade hin — das ist die
   *     Stelle, an der der Einmalcode steht, wenn er auf „Kopieren" drückt.
   *
   * Ein Bild weniger kostet ein Vorschaubild, das heute ohnehin niemand
   * anzeigt (OFFEN 3.4). Ein Bild zu viel kostet den Einmalcode als JPEG.
   */
  function bildErlaubt(el) {
    const G = quelle();
    if (!G || typeof G.geheim !== "function") return false;
    try {
      const felder = Array.prototype.slice.call(
        document.querySelectorAll("input, textarea, select"),
        0,
        BILD_FELDER_HOECHSTENS
      );
      for (const feld of felder) {
        if (G.geheim(feld) === true) return false;
        if (typeof G.zifferngruppe === "function" && G.zifferngruppe(feld) === true) return false;
      }
      const koerper = document.body || document.documentElement;
      const text = String((koerper && koerper.textContent) || "");
      if (text.length > BILD_TEXT_ZEICHEN) return false;
      if (!wertOffen(text)) return false;
      if (typeof G.abschnitteVon === "function") {
        for (const abschnitt of G.abschnitteVon(el)) {
          if (!textOffen(String(abschnitt.textContent || ""))) return false;
        }
      }
      return true;
    } catch (_) {
      return false;
    }
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
    /* Das Bild wird angefordert, wenn die Seite es zulässt. Die Frage steht
       HIER und nicht im Ausführer: Nur dieses Skript sieht, was auf der Seite
       steht, und der Ausführer prüft Name, Tab, Ursprung, Grösse und Anzahl,
       aber nie den Inhalt (Befund TEACH-8). */
    if (angaben.bild && angaben.el && bildErlaubt(angaben.el)) {
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
    const roh = adresse();
    if (!roh || !/^https?:/i.test(roh)) return null;
    /* Gemessen wird die GANZE Adresse, gekürzt wird danach. Andersherum wäre
       die Kürzung die Wache, und ein Bestätigungslink von 2200 Zeichen fiele
       genau hinter dem Deckel auseinander (dieselbe Bauform wie
       AUTOMODUS-2). */
    const gesiebt = adresseFuerAblauf(roh);
    const url = kuerzen(gesiebt.url, ADRESSE_ZEICHEN);
    if (!url) return null;
    for (let i = schritte.length - 1; i >= 0; i--) {
      if (schritte[i].type === "navigate") {
        if (schritte[i].url === url) return null;
        break;
      }
    }
    const schritt = { type: "navigate", url, wait: "load" };
    if (gesiebt.gekuerzt) {
      /* Ein weggelassener Parameter wird gesagt und nicht verschwiegen. Beim
         Abspielen kann derselbe Link ohnehin kein zweites Mal gelten, ein
         Einmalcode ist einmalig; der Mensch weiss dann, warum der Schritt
         woanders landet. */
      schritt.beschreibung =
        "Die Adresse wurde ohne einen ihrer Parameter aufgezeichnet, weil darin ein Geheimnis stand.";
    }
    return schrittHinzu(schritt);
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
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const art = merkmal(el, "type").toLowerCase() || "text";
      /* Ankreuzfelder, Dateiwahl und Knöpfe sind kein Tippen. Der Klick
         darauf ist schon aufgezeichnet, ihr „Wert" wäre entweder ein
         Wahrheitswert oder ein erfundener Dateipfad. */
      if (["checkbox", "radio", "file", "submit", "button", "reset", "image", "range"].includes(art)) return;
    } else if (el.isContentEditable !== true) {
      return;
    }

    /* Die eine Frage, und sie steht VOR jedem Zugriff auf den Wert.
     *
     * Befund B5 vom 14.08.2026: Hier stand `wert = el.value`, sobald das Feld
     * nicht in einer bekannten Geheimliste stand. Was die Liste nicht kannte,
     * lag danach im Klartext in `sa_workflows` — drei gemessene Fälle: die
     * sechs Kästchen eines Einmalcodes, die Kartennummer im Branchenfeld
     * `name="pan"` und das Passwortfeld nach dem Klick aufs Auge.
     *
     * `wertFreigeben` dreht die Beweislast um (F4): Es liest den Wert erst,
     * wenn Bauform, Umfeld, Feldreihe und Harmlos-Beleg durch sind. Was es
     * nicht belegen kann, wird `user_input_required` — ein Schritt, den der
     * Mensch beim Abspielen einmal ausfüllt. */
    const G = quelle();
    const befund = G && typeof G.wertFreigeben === "function"
      ? G.wertFreigeben(el)
      : { ok: false, grund: "geheim_fehlt" };
    if (!befund || befund.ok !== true) {
      menschUebernimmt();
      return;
    }
    const kurz = kuerzen(befund.wert, WERT_ZEICHEN);

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
    /* Auch das Etikett einer Option geht durch dieselbe Prüfung wie ein
       Textanker (Befund B6): Eine Liste „Ihre gespeicherten Karten" trägt in
       ihren Optionen die Kartennummern. Fällt das Etikett heraus, bleibt die
       Stelle in der Liste — die verrät nichts.
       Gemessen wird der UNGEKÜRZTE Text und gespeichert der gekürzte. Vorher
       war es umgekehrt, und damit entschied die Länge der Option über die
       Prüfung: Eine Kartennummer hinter Zeichen 200 fiel bei der Kürzung
       heraus, der Rest ging als harmlos durch, und ein angeschnittenes
       Geheimnis ist immer noch eines (dieselbe Bauform wie AUTOMODUS-2 vom
       selben Tag). */
    const rohEtikett = option ? String(option.text == null ? "" : option.text) : "";
    const etikett = rohEtikett && textOffen(rohEtikett) ? kuerzen(rohEtikett, ETIKETT_ZEICHEN) : "";
    const rohWert = option && typeof option.value === "string" ? option.value.trim() : "";
    const wert = rohWert && textOffen(rohWert) ? kuerzen(rohWert, WERT_ZEICHEN) : "";
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
    if (!geheimBereit()) {
      /* Befund B5/B6 vom 14.08.2026 und Festlegung F4: Ohne
         `content/geheim.js` gäbe es keine Geheimerkennung, und eine Aufnahme
         ohne Geheimerkennung schreibt Passwörter mit. Lieber gar keine
         Aufnahme als eine, die man erst hinterher liest. */
      return {
        ok: false,
        fehler: "geheim_fehlt",
        satz: "Die Aufnahme kann nicht starten, weil der Schutz für Passwortfelder in dieser Seite fehlt.",
        hinweis: "Den Tab neu laden. Bleibt es dabei, wurde geheim.js nicht vor rekorder.js eingespielt.",
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
     dieselbe Frage stellen muss. `geheim` und `geheimUmfeld` reichen nur
     durch, entschieden wird in `content/geheim.js` — zwei Fassungen derselben
     Erkennung waren der Befund, den F4 abgeschafft hat. */
  globalThis.SMARTR_REKORDER = Object.freeze({
    geheim,
    geheimUmfeld,
    geheimBereit,
    textOffen,
    beschreibungVon,
    stand,
    VERBOT_GRUND,
  });

  window.__smartrchromeRekorder = true;
  wiederaufnehmen();
})();
