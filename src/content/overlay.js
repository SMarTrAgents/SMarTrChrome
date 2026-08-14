/*
 * SMarTrChrome Beta — Overlay in der Seite.
 *
 * Zeichnet den grünen Rahmen um die Seitenfläche, den Agentenzeiger mit
 * Signalring und das Hinweis-Schild. Nimmt die Notbremse entgegen.
 *
 * Seit der Ausführer steht, liefert es zusätzlich die Wahrnehmung: den
 * Textbaum der Seite, den Zustand des Tabs, den Bildlauf und das Auflösen
 * einer Referenz für den Agentenzeiger.
 *
 * Seit der Bedienstufe (29.07.2026) kann dieses Skript auf Anweisung des
 * Ausführers auch klicken, tippen und auswählen, gezielt einzelne Felder
 * auslesen und auf die Seite warten — aber ausschließlich auf ein Element,
 * das der Mensch in der Einzelfreigabe bestätigt hat. Von sich aus verändert
 * es die Seite weiterhin nicht; der Bildlauf bleibt das, was ein Mensch mit
 * dem Rad auch täte.
 *
 * Inhalte von Geheimfeldern — Passwort, Karte, Einmalcode — werden nie
 * ausgelesen, auch nicht für den eigenen Agenten (spec-01 V10). Der Name des
 * Feldes darf stehen bleiben, sein Inhalt nie.
 *
 * Seit 14.08.2026 geht jede Handlung an einem Element durch die Klickwache in
 * `src/content/klickwache.js` (`globalThis.SMARTR_KLICKWACHE`). Sie wird VOR
 * dieser Datei eingespielt. Fehlt sie, wird nicht bedient: Der Befund vom
 * 11.08.2026 war eine fertige, geprüfte und nirgends gerufene Wache, und ein
 * Weg, der bei fehlender Prüfung durchwinkt, wäre genau derselbe Weg noch
 * einmal.
 */

(() => {
  if (window.__smartrchromeOverlay) return;

  /* ------------------------------------------------------------------ *
   * Die gemeinsame Messform (`src/gemeinsam/messform.js`).
   *
   * Sie wird VOR dieser Datei eingespielt und steht in beiden Einspiellisten
   * von `src/net/seite.js` ganz vorn, im Pflichtteil wie in der Kür. Fehlt
   * sie, wird gar nicht erst eingespielt — lieber nicht arbeiten als in einer
   * anderen Form messen als der Dienst.
   *
   * Warum diese Datei sie überhaupt braucht, obwohl hier keine Wache steht:
   * Vier Vergleiche in dieser Datei entscheiden, WORAUF gehandelt wird — auf
   * welche Option einer Auswahlliste, auf welches Element hinter einem
   * Etikett, ob eine Wartebedingung eingetreten ist. Bis zum 14.08.2026
   * verglichen sie mit `toLowerCase()`. Eine Seite, die in ihre Beschriftung
   * ein Zeichen ohne Breite streut, bestimmt damit selbst, welche Option der
   * Agent wählt, obwohl der Mensch beide gleich liest.
   *
   * Eine eigene Abschrift der Regel gibt es hier ausdrücklich NICHT
   * (Festlegung F4): `content/klickwache.js` hatte eine, und es hat genau
   * EINE Änderung gebraucht, bis die beiden Fassungen verschieden entschieden.
   * ------------------------------------------------------------------ */
  const MF = globalThis.SMARTR_MESSFORM || null;

  /** Zwei Texte meinen dasselbe. Ohne Messform: nein, nie. */
  const textGleich = (a, b) => (MF ? MF.gleicherText(a, b) === true : false);

  /**
   * Der gesuchte Text steckt im ganzen — beide in der Messform.
   *
   * Fehlt die Messform, oder bleibt vom gesuchten Text nach dem Messen nichts
   * übrig, ist die Antwort nein. Ein leerer Suchtext steckt in JEDEM Text,
   * und „passt überall" wäre hier keine Milde, sondern eine Auswahl, die die
   * Seite trifft.
   */
  const textEnthaelt = (ganzes, teil) => {
    if (!MF) return false;
    const gesucht = MF.messtext(teil);
    if (!gesucht) return false;
    return MF.messtext(ganzes).includes(gesucht);
  };

  const GRUEN = "#2aff2a";
  const DUNKEL = "#030612";
  const CYAN = "#00d4ff";
  const ROT = "#ff5d73";
  const GRAU = "#8b95a7";

  const WIRT_ID = "smartrchrome-host";

  /* Jede Deklaration mit !important, und display/visibility/opacity ausdrücklich
     dazu. Grund, im echten Chrome gemessen: Ohne !important genügte der Seite
     ein `#smartrchrome-host{display:none!important}` oder schlicht
     `*{display:none!important}`, um den grünen Rahmen, das Schild und den
     Agentenzeiger vollständig abzuschalten — der Agent bediente weiter, nur
     eben unsichtbar. Damit fiel genau die Zusage, für die es dieses Overlay
     gibt. Ein Inline-Stil mit !important steht in der Autoren-Kaskade über
     jeder Regel aus einem Seiten-Stylesheet, auch über deren !important. Die
     Deckkraft des Rahmens wird davon nicht berührt, die steuert `data-an` im
     Schattenbaum.
     Nachgezogen 11.08.2026: `transform:none` setzt die EINZELNEN
     Transform-Eigenschaften nicht zurück — ein `scale:0` der Seite blieb
     wirksam und schrumpfte das ganze Overlay auf nichts. Ebenso hatten
     `clip`, `mask`, `mix-blend-mode`, `content-visibility` und eine Breite von
     null freie Bahn; jede einzelne dieser Angaben macht das Zeichen unsichtbar,
     ohne display, visibility oder opacity anzufassen. `animation` und
     `transition` stehen dazu, damit die Seite die Deckkraft nicht an der
     Kaskade vorbei wegfahren kann.
     Richtiggestellt am 14.08.2026: Der Satz „das deckt auch schlicht
     `*{display:none!important}` ab" stimmte NICHT, im echten Chrome gemessen
     (Funktionstest 0.5.3, F-2). `*` trifft auch `html` und `body`, und ein
     unsichtbarer Vorfahre schlägt jeden Inline-Stil des Kindes. Abgewehrt wird
     der gezielte Angriff `#smartrchrome-host{…}`; der Rundumschlag nimmt die
     Seite mitsamt Zeichen weg, und weil dann auch kein bedienbares Element mehr
     dasteht, entsteht daraus kein blindes Bedienen, sondern ein blindes
     Fenster. Der Wirt liegt auf der höchsten Ebene und hängt an <html> nach
     <body>: Bei gleichem z-index gewinnt damit die Baumreihenfolge.
     Der Stil steht als Konstante, weil der Wächter ihn wieder herstellen muss,
     wenn ein Seitenskript ihn überschreibt. */
  const WIRT_STIL =
    "position:fixed !important;inset:0 !important;z-index:2147483647 !important;" +
    "width:auto !important;height:auto !important;" +
    "max-width:none !important;max-height:none !important;" +
    "pointer-events:none !important;border:0 !important;margin:0 !important;" +
    "padding:0 !important;display:block !important;visibility:visible !important;" +
    "opacity:1 !important;clip-path:none !important;clip:auto !important;" +
    "mask:none !important;transform:none !important;scale:none !important;" +
    "rotate:none !important;translate:none !important;filter:none !important;" +
    "mix-blend-mode:normal !important;content-visibility:visible !important;" +
    "animation:none !important;transition:none !important;contain:none !important;";

  /* Die Angaben, an denen der Wächter erkennt, ob der Stil noch steht. Bewusst
     nur solche, deren Wert kein Browser umschreibt: Ein Vergleich auf den
     ganzen cssText wäre nach der ersten Normalisierung durch Chrome („0" wird
     „0px") dauerhaft ungleich — der Wächter würde endlos reparieren und die
     Sitzung als Angriff beenden, obwohl niemand angreift. */
  const WIRT_PFLICHT = [
    ["display", "block"],
    ["visibility", "visible"],
    ["opacity", "1"],
    ["position", "fixed"],
    ["z-index", "2147483647"],
    ["pointer-events", "none"],
  ];

  const host = document.createElement("div");
  host.id = WIRT_ID;
  host.style.cssText = WIRT_STIL;
  const root = host.attachShadow({ mode: "closed" });

  const stil = new CSSStyleSheet();
  stil.replaceSync(`
    :host, * { box-sizing: border-box; }
    .rahmen {
      position: fixed; inset: 0; pointer-events: none;
      forced-color-adjust: none;
      box-shadow:
        inset 0 0 0 4px ${GRUEN},
        inset 0 0 0 7px rgba(3,6,18,.92),
        inset 0 0 22px 4px rgba(42,255,42,.30);
      opacity: 0; transition: opacity .18s linear;
    }
    .rahmen[data-an="1"] { opacity: 1; }
    .rahmen[data-gross="1"] {
      box-shadow:
        inset 0 0 0 8px ${GRUEN},
        inset 0 0 0 12px rgba(3,6,18,.94),
        inset 0 0 30px 6px rgba(42,255,42,.34);
    }
    .rahmen[data-zustand="gestoppt"] {
      box-shadow:
        inset 0 0 0 6px ${ROT},
        inset 0 0 0 10px rgba(3,6,18,.94);
    }
    /* Tot heißt tot: Ein Overlay, das seine Erweiterung verloren hat, darf sich
       nicht weiter als lebendes Versprechen ausgeben. Grau statt grün, und
       gestrichelt am Schild, damit man es auch ohne Farbe unterscheidet.
       Der Selektor trägt data-an ausdrücklich mit: Sonst ist er genauso
       spezifisch wie die Atem-Regel weiter unten, die später steht und damit
       gewinnen würde. Ein totes Overlay atmete dann weiter grün. */
    .rahmen[data-an="1"][data-zustand="tot"] {
      box-shadow:
        inset 0 0 0 5px ${GRAU},
        inset 0 0 0 9px rgba(3,6,18,.94);
      animation: none;
    }
    @media (prefers-reduced-motion: no-preference) {
      .rahmen[data-an="1"] { animation: atmen 2.4s ease-in-out infinite; }
      @keyframes atmen {
        0%,100% { filter: drop-shadow(0 0 0 rgba(42,255,42,0)); }
        50%     { filter: drop-shadow(0 0 6px rgba(42,255,42,.45)); }
      }
      /* Die Automatik atmet in ihrer eigenen Farbe. Ein blauer Rahmen mit
         grünem Schein wäre zwei Aussagen auf einmal.
         Das :not([data-zustand]) ist kein Schmuck: Diese Regel steht später im
         Blatt als die für das tote und das gestoppte Zeichen und ist genauso
         spezifisch — sie würde dort sonst gewinnen. */
      .rahmen[data-an="1"][data-modus="auto"]:not([data-zustand]) {
        animation: atmenAuto 2.4s ease-in-out infinite;
      }
      @keyframes atmenAuto {
        0%,100% { filter: drop-shadow(0 0 0 rgba(91,141,239,0)); }
        50%     { filter: drop-shadow(0 0 7px rgba(91,141,239,.55)); }
      }
    }

    .schild {
      position: fixed; top: 14px; left: 14px;
      display: flex; align-items: center; gap: 8px;
      max-width: min(70vw, 620px);
      padding: 10px 14px; border-radius: 10px;
      background: rgba(3,6,18,.94); border: 2px solid ${GRUEN};
      color: #f1f5f9; font: 600 16px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
      pointer-events: none; opacity: 0; transition: opacity .18s linear;
    }
    .schild[data-an="1"] { opacity: 1; }
    .schild[data-zustand="gestoppt"] { border-color: ${ROT}; }
    .schild[data-zustand="tot"] { border-color: ${GRAU}; border-style: dashed; }
    .schild .punkt {
      width: 12px; height: 12px; border-radius: 50%;
      background: ${GRUEN}; box-shadow: 0 0 0 2px ${DUNKEL};
      flex: 0 0 auto;
    }
    .schild[data-zustand="gestoppt"] .punkt { background: ${ROT}; }
    .schild[data-zustand="tot"] .punkt { background: ${GRAU}; }

    /* Der Not-Aus im Schild. Maße, Farbe und Durchlässigkeit stehen inline mit
       !important (siehe NOTAUS_STIL), damit kein Blatt der Seite die Reißleine
       wegschalten kann. Hier steht nur, was ohnehin niemand von außen erreicht:
       die Spur für die Tastatur. Sie ist Pflicht, nicht Zierde — dieser Knopf
       ist der einzige Weg, den ein Mensch ohne Anleitung findet. */
    .notaus:focus-visible { outline: 3px solid #ffffff; outline-offset: 2px; }

    .zeiger {
      position: absolute; left: 0; top: 0;
      width: 16px; height: 16px; border-radius: 50%;
      background: ${CYAN};
      box-shadow:
        0 0 0 4px  ${DUNKEL},
        0 0 0 7px  #ffffff,
        0 0 0 10px ${GRUEN},
        0 0 0 12px ${DUNKEL},
        0 0 24px 10px rgba(0,212,255,.28);
      opacity: 0;
      transform: translate3d(-100px,-100px,0);
      will-change: transform;
    }
    .zeiger[data-an="1"] { opacity: 1; }
    .zeiger[data-gross="1"] {
      width: 32px; height: 32px;
      box-shadow:
        0 0 0 7px  ${DUNKEL},
        0 0 0 12px #ffffff,
        0 0 0 18px ${GRUEN},
        0 0 0 21px ${DUNKEL},
        0 0 34px 16px rgba(0,212,255,.30);
    }
    @media (prefers-reduced-motion: no-preference) {
      .zeiger { transition: transform .32s cubic-bezier(.22,.61,.36,1); }
      /* Beim Nachführen im Bildlauf muss der Zeiger sofort stehen, wo er
         hingehört. Mit der Gleitbewegung liefe er dem Element hinterher und
         zeigte währenddessen auf etwas anderes. */
      .zeiger[data-folgt="1"] { transition: none; }
    }

    .fahne {
      position: absolute; left: 0; top: 0;
      padding: 7px 11px; border-radius: 10px;
      background: rgba(3,6,18,.94); border: 2px solid ${CYAN};
      color: #f1f5f9; font: 600 16px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
      max-width: 360px; opacity: 0;
      transform: translate3d(-100px,-100px,0);
    }
    .fahne[data-an="1"] { opacity: 1; }
    .fahne[data-gross="1"] { font-size: 20px; border-width: 3px; }

    .ziel {
      position: absolute; border-radius: 6px;
      box-shadow: 0 0 0 3px ${CYAN}, 0 0 0 6px ${DUNKEL};
      opacity: 0; transition: opacity .16s linear;
    }
    .ziel[data-an="1"] { opacity: 1; }

    /* Der Klick-Puls: ein Ring, der am Ort der Handlung kurz aufgeht. Er sagt
       dem Menschen „hier ist gerade etwas passiert" — der Zeiger sagt „hierhin
       schaue ich", der Puls sagt „jetzt". */
    .puls {
      position: absolute; left: 0; top: 0;
      width: 18px; height: 18px; margin: -9px 0 0 -9px;
      border-radius: 50%; border: 3px solid ${CYAN};
      opacity: 0; pointer-events: none;
    }
    /* Die Grundregel für den ausgelösten Puls steht AUSSERHALB jeder
       Bewegungs-Abfrage. Bis 0.5.2 lag sie ausschließlich in
       "prefers-reduced-motion: no-preference" — wer Bewegung abgestellt hat,
       sah beim Klick also gar nichts, und das ist genau die Gruppe, die auf
       eine ruhige, deutliche Anzeige angewiesen ist. Ohne Bewegung bleibt eine
       kurze, stehende Hervorhebung stehen, bis das Skript sie nach 650 ms
       wieder abschaltet. */
    .puls[data-an="1"] {
      opacity: 1;
      width: 46px; height: 46px; margin: -23px 0 0 -23px;
      border-width: 4px; background: rgba(0,212,255,.22);
    }
    @media (prefers-reduced-motion: no-preference) {
      /* Mit Bewegung übernimmt der aufgehende Ring. "forwards" hält ihn am
         Ende auf unsichtbar, sonst blitzte die stehende Hervorhebung nach dem
         Auslaufen noch einmal auf. */
      .puls[data-an="1"] {
        width: 18px; height: 18px; margin: -9px 0 0 -9px;
        border-width: 3px; background: transparent;
        animation: pulsRing .6s ease-out 1 forwards;
      }
      @keyframes pulsRing {
        0%   { opacity: .95; transform: scale(1); }
        100% { opacity: 0;   transform: scale(3.6); }
      }
    }
  `);
  root.adoptedStyleSheets = [stil];

  const rahmen = document.createElement("div");
  rahmen.className = "rahmen";
  const schild = document.createElement("div");
  schild.className = "schild";
  /* Die Teile des Schildes entstehen als Knoten und nicht mehr aus innerHTML.
     Grund: Der Punkt trägt seit dem Auto-Rahmen eine eigene Farbe, und der
     Not-Aus-Knopf braucht einen Ereignishörer. Beides geht an einer
     Zeichenkette nicht, ohne sie danach wieder aufzusuchen. */
  const punktZeichen = document.createElement("span");
  punktZeichen.className = "punkt";
  const textZeichen = document.createElement("span");
  textZeichen.className = "text";
  const zeiger = document.createElement("div");
  zeiger.className = "zeiger";
  const fahne = document.createElement("div");
  fahne.className = "fahne";
  const ziel = document.createElement("div");
  ziel.className = "ziel";
  const puls = document.createElement("div");
  puls.className = "puls";

  /* ------------------------------------------------------------------ *
   * Der Not-Aus im Schild.
   *
   * Bis 0.5.2 lag die Reißleine an zwei Stellen, an denen sie im Ernstfall
   * nicht liegt: in der Seitenleiste, die geschlossen sein kann, und auf der
   * Tastatur (Esc Esc), die man kennen muss. Sichtbar war im Tab nur die
   * Aufforderung, sie zu drücken. Ein Stoppknopf, den man sieht, ist kein
   * Beiwerk: Er ist der einzige Weg, den ein Mensch ohne Anleitung findet.
   *
   * Zwei Dinge machen ihn treffbar, auch wenn die Seite eigene Überzüge legt:
   * Der Wirt liegt auf der höchsten Ebene, die Chrome kennt, und hängt an
   * <html> NACH <body> — bei gleichem z-index gewinnt damit die Baumreihenfolge
   * (im echten Chrome am 10.08.2026 gemessen: fremdes Element mit
   * z-index 2147483647 darüber, Schild weiterhin sichtbar). Und der Wirt selbst
   * bleibt durchlässig (`pointer-events:none`), damit die Seite bedienbar
   * bleibt; genau EIN Knoten nimmt Zeigerereignisse an, dieser hier.
   *
   * Der Stil steht inline mit !important, aus demselben Grund wie am Wirt:
   * Ein Blatt der Seite darf die Reißleine nicht wegschalten können.
   * ------------------------------------------------------------------ */
  const NOTAUS_STIL =
    "pointer-events:auto !important;cursor:pointer !important;" +
    "display:inline-flex !important;align-items:center !important;" +
    "visibility:visible !important;opacity:1 !important;" +
    "margin:0 0 0 6px !important;padding:7px 12px !important;" +
    "min-width:74px !important;min-height:34px !important;" +
    "justify-content:center !important;" +
    "border:2px solid " + ROT + " !important;border-radius:8px !important;" +
    "background:" + ROT + " !important;color:#0b0f1a !important;" +
    "font:700 15px/1 system-ui, -apple-system, \"Segoe UI\", sans-serif !important;" +
    "letter-spacing:.04em !important;text-transform:none !important;" +
    "box-shadow:0 0 0 2px rgba(3,6,18,.94) !important;" +
    "clip-path:none !important;transform:none !important;filter:none !important;";

  /* ------------------------------------------------------------------ *
   * Sprache (Vertrag §12)
   *
   * Ein Inhaltsskript kann `src/panel/sprache.js` nicht einfuehren — es ist
   * kein Modul, und genau daran ist die Verdeckungswache am 11.08.2026
   * gescheitert. `chrome.i18n.getMessage` steht hier aber sehr wohl zur
   * Verfuegung, also geht der Weg direkt darueber.
   *
   * `notfall` ist die deutsche Fassung und keine Bequemlichkeit: Fehlt der
   * Schluessel, gibt Chrome die leere Zeichenkette zurueck. Ein Schild ohne
   * Text saehe aus wie ein totes Schild, und das ist die eine Anzeige, an der
   * ein Mensch ablesen soll, dass hier eine Maschine arbeitet.
   * ------------------------------------------------------------------ */
  const spr = (schluessel, notfall, ...werte) => {
    let text = "";
    try {
      text = chrome.i18n.getMessage(schluessel, werte.map(String)) || "";
    } catch (_) {
      text = "";
    }
    if (!text) {
      text = notfall;
      for (let i = werte.length; i >= 1; i -= 1) {
        text = text.split("$" + i).join(String(werte[i - 1]));
      }
    }
    return text;
  };

  const notaus = document.createElement("button");
  notaus.className = "notaus";
  notaus.setAttribute("type", "button");
  const NOTAUS_MARKE = spr("overlay_notaus_marke", "Stopp, die Steuerung sofort beenden");
  notaus.setAttribute("aria-label", NOTAUS_MARKE);
  notaus.setAttribute("title", NOTAUS_MARKE);
  notaus.textContent = spr("overlay_notaus", "STOPP");
  notaus.style.cssText = NOTAUS_STIL;

  /* Der Knopf nimmt Klicks an — deshalb darf es ihn nur geben, solange das
     Schild wirklich steht. Ein unsichtbarer Knopf, der weiter Zeigerereignisse
     schluckt, wäre ein Loch in der Seite des Menschen, und zwar genau an der
     Stelle, an der eben noch etwas stand. */
  const notausZeigen = (an) => {
    try {
      notaus.style.setProperty("display", an ? "inline-flex" : "none", "important");
      notaus.style.setProperty("pointer-events", an ? "auto" : "none", "important");
    } catch (_) {}
  };
  notausZeigen(false);

  schild.append(punktZeichen, textZeichen, notaus);
  root.append(rahmen, ziel, puls, zeiger, fahne, schild);
  document.documentElement.appendChild(host);

  let gross = false;

  /* Ist das Overlay tot, nimmt es keinen Befehl mehr an und gibt sich auch
     nicht mehr als lebend aus. Tot wird es aus genau zwei Gründen: Die
     Erweiterung hinter ihm ist weg, oder die Seite hat sein Zeichen so oft
     entfernt, dass Weiterkämpfen eine unsichtbare Sitzung bedeuten würde. */
  let overlayTot = false;

  /* Das Titel-Präfix ist das einzige Zeichen, das ein gesteuerter Tab auch im
     Hintergrund trägt (die Tab-Leiste kann eine Erweiterung nicht einfärben).
     Beste-Kraft: Seiten, die ihren Titel selbst laufend neu schreiben (SPAs),
     überschreiben es — dafür trägt der Dienst zusätzlich das Abzeichen LIVE am
     Symbol. Für gewöhnliche Seiten beantwortet es die Frage „welcher Tab wird
     bedient" auf einen Blick. */
  const TITEL_PRAEFIX = "🐇▶ ";
  let titelVorher = null;

  const grossSetzen = (an) => {
    gross = !!an;
    for (const el of [rahmen, zeiger, fahne]) {
      if (gross) el.setAttribute("data-gross", "1");
      else el.removeAttribute("data-gross");
    }
  };

  /* ------------------------------------------------------------------ *
   * Der Betriebsmodus am Zeichen (VERTRAG v3.5 §6, `overlay:modus`).
   *
   * Warum die Automatik eine eigene Farbe bekommt: In `assist` fragt jeder
   * Schritt, der etwas verändert. In `auto` laufen die je Domain
   * freigeschalteten weichen Klassen ohne Rückfrage durch. Das ist von außen
   * genau dann zu unterscheiden, wenn es am Rahmen steht, und nicht erst,
   * wenn etwas passiert ist, das der Mensch nicht wollte.
   *
   * Grün bleibt grün: `manual` und `assist` behalten das Zeichen, das der
   * Mensch seit der ersten Fassung kennt. Nur die Automatik trägt den
   * Markenverlauf — eine neue Farbe für eine neue Lage, nicht drei Farben für
   * drei Namen.
   *
   * Gefärbt wird inline und mit !important, aus demselben Grund wie am Wirt:
   * Ein Blatt der Seite darf das Zeichen nicht umfärben oder abschalten
   * (Befund 10.08.2026). Das data-Merkmal steht zusätzlich da, damit das
   * Stylesheet im Schattenbaum daran hängen kann. */
  const MODI_ANZEIGE = {
    manual: spr("overlay_modus_manual", "Handbetrieb"),
    assist: spr("overlay_modus_assist", "Begleitet"),
    auto: spr("overlay_modus_auto", "Automatik"),
  };
  const MODUS_VERLAUF = "linear-gradient(90deg, #4CC2F1 0%, #5B8DEF 50%, #8D7CF6 100%)";
  const MODUS_MITTE = "#5B8DEF";
  const SCHILD_GRUNDTEXT = spr("overlay_schild_grund", "SMarTrAgent steuert diesen Tab, Esc Esc = Stopp");

  let modusJetzt = "assist";
  let schildBasis = SCHILD_GRUNDTEXT;

  const schildSchreiben = () => {
    const wort = MODI_ANZEIGE[modusJetzt] || MODI_ANZEIGE.assist;
    schildText(spr("overlay_schild_zeile", "$1, $2", wort, schildBasis));
  };

  /* Die Farbe der Automatik wieder abnehmen. Das braucht es an drei Stellen,
     und die dritte ist der Grund, warum es eine eigene Funktion ist: Ein
     Inline-Stil mit !important schlägt auch das eigene Stylesheet im
     Schattenbaum. Bliebe der Verlauf stehen, trüge ein GESTOPPTES oder totes
     Zeichen weiterhin die Farbe der laufenden Automatik — und genau dann
     stimmt sie nicht mehr. */
  const modusFarbenLoeschen = () => {
    try {
      for (const eigenschaft of ["border", "border-image-source", "border-image-slice", "box-shadow"]) {
        rahmen.style.removeProperty(eigenschaft);
      }
      schild.style.removeProperty("border-color");
      punktZeichen.style.removeProperty("background-image");
    } catch (_) {}
  };

  const modusFaerben = () => {
    rahmen.setAttribute("data-modus", modusJetzt);
    schild.setAttribute("data-modus", modusJetzt);
    if (modusJetzt !== "auto") {
      modusFarbenLoeschen();
      return;
    }
    try {
      /* Ein Verlauf lässt sich nicht als box-shadow malen, wohl aber als
         Rahmenbild. Der dunkle Innenring bleibt als Schatten stehen, damit
         die Kante auch auf hellen Seiten steht. */
      rahmen.style.setProperty("border", "8px solid transparent", "important");
      rahmen.style.setProperty("border-image-source", MODUS_VERLAUF, "important");
      rahmen.style.setProperty("border-image-slice", "1", "important");
      rahmen.style.setProperty("box-shadow", "inset 0 0 0 4px rgba(3,6,18,.92)", "important");
      schild.style.setProperty("border-color", MODUS_MITTE, "important");
      punktZeichen.style.setProperty("background-image", MODUS_VERLAUF, "important");
    } catch (_) {
      /* Ein Browser, der einzelne Eigenschaften nicht kennt, bekommt weiterhin
         das grüne Zeichen. Farbe ist eine Zugabe, das Zeichen selbst nicht. */
    }
  };

  const modusSetzen = (roh) => {
    const modus = String(roh || "");
    if (!MODI_ANZEIGE[modus]) return false;
    modusJetzt = modus;
    modusFaerben();
    schildSchreiben();
    return true;
  };

  const anzeigen = (an, text) => {
    if (overlayTot) return;
    rahmen.setAttribute("data-an", an ? "1" : "0");
    schild.setAttribute("data-an", an ? "1" : "0");
    if (text) schildBasis = text;
    if (an) schildSchreiben();
    notausZeigen(an);
    /* Der Wächter läuft genau so lange, wie das Zeichen etwas verspricht.
       Ohne laufende Sitzung gibt es nichts zu bewachen, und kein fremdes Blatt
       soll einen Beobachter mitschleppen, den niemand braucht. */
    if (an) waechterStarten();
    else waechterStoppen();
    if (an) {
      try {
        const jetzt = document.title || "";
        if (titelVorher === null && !jetzt.startsWith(TITEL_PRAEFIX)) {
          titelVorher = jetzt;
          document.title = TITEL_PRAEFIX + jetzt;
        }
      } catch (_) { /* Seiten ohne title-Zugriff: nur der Rahmen zeigt es an. */ }
    } else {
      /* Dieselbe Zeile wie im Not-Aus, und aus demselben Grund gefunden:
         `overlay:aus` schaltete Zeiger und Fahne auf 0, der Takt des
         Arbeitszeigers lief weiter und schaltete sie 420 ms später wieder
         ein. Das ist der Befund NOTAUS-3 an einer zweiten Tür — ein Zeichen,
         das nach dem Ende der Sitzung weiterwandert, behauptet eine
         Steuerung, die es nicht mehr gibt. Gemeldet war nur die eine Tür;
         gebaut ist die Kappung an der einen Stelle, durch die beide gehen. */
      takteKappen();
      zeiger.setAttribute("data-an", "0");
      fahne.setAttribute("data-an", "0");
      ziel.setAttribute("data-an", "0");
      puls.setAttribute("data-an", "0");
      zielBezug = null;
      if (titelVorher !== null) {
        try { document.title = titelVorher; } catch (_) {}
        titelVorher = null;
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * Die Taktverwaltung — die EINE Stelle, die der Not-Aus kappt.
   *
   * Befund NOTAUS-3/NOTAUS-4 vom 14.08.2026, am echten Skript gemessen und
   * nicht vermutet: `gestoppt()` setzte Zeiger, Fahne und Ziel auf 0 und
   * rührte den Takt darunter nicht an. `arbeitsZeiger` läuft als
   * `setInterval` alle 420 ms; 420 ms nach `overlay:gestoppt` stand der Zeiger
   * wieder auf `data-an="1"` und wanderte weiter, während das Schild
   * „GESTOPPT, der Agent steuert nicht mehr" zeigte — bis zu 1,7 Sekunden,
   * deutlich über der Sekunde aus §5. Dieselbe Bauform in der Warteschleife
   * von `overlay:warten`: Sie stellte sich per `setTimeout` selbst neu und las
   * bis zu eine Minute nach dem Not-Aus weiter den Seitentext.
   *
   * Der Fehler war NICHT, dass an einer Stelle ein `clearInterval` fehlte. Der
   * Fehler war, dass es überhaupt einzelne Stellen gab: Wer den nächsten Takt
   * baut, muss daran denken, ihn auch in `gestoppt()` einzutragen — und beim
   * übernächsten denkt niemand mehr daran. Deshalb gibt es ab jetzt keinen
   * nackten `setTimeout` und kein nacktes `setInterval` mehr in dieser Datei.
   * Jeder Takt meldet sich hier an, und `takteKappen()` ist die eine Zeile,
   * die alle zugleich löscht.
   *
   * Zwei Sicherungen statt einer, weil die zweite nichts kostet:
   *
   *   1. `clearTimeout`/`clearInterval` nimmt den Takt aus der Warteschlange.
   *   2. Jeder Rückruf merkt sich den Stand des Zählers `taktStand` und tut
   *      nichts mehr, wenn dazwischen gekappt wurde. Das trägt auch dann,
   *      wenn ein Rückruf schon fällig war, als der Not-Aus kam — und genau
   *      dieser Augenblick ist der schlechteste: Ein Klick, der erst NACH der
   *      Antwort ausgelöst wird (siehe „Bedienen"), liegt in diesem Fenster.
   *
   * Was hier ausdrücklich NICHT mit hineingehört: der Beobachter des Wächters
   * am Wirt. Er hält das Zeichen sichtbar, und nach dem Not-Aus ist das Schild
   * „GESTOPPT" das einzige, was der Mensch mit geschlossener Seitenleiste noch
   * sieht. Ihn zu kappen hiesse, ausgerechnet die Anzeige des Not-Aus
   * angreifbar zu machen. Er endet mit `anzeigen(false)`.
   * ------------------------------------------------------------------ */

  let taktStand = 0;
  const takte = new Set();

  /** Jeden laufenden Takt löschen. Die eine Zeile, die der Not-Aus ruft. */
  const takteKappen = () => {
    taktStand += 1;
    for (const abbrechen of [...takte]) {
      try { abbrechen(); } catch (_) {}
    }
    takte.clear();
    /* Und die beiden Griffe, die diese Datei selbst aufbewahrt. Sie zeigten
       sonst auf einen Takt, den es nicht mehr gibt, und `arbeitsZeiger`
       entschiede beim nächsten Ruf an einem toten Griff, ob es etwas
       abzubrechen gibt. Zwei Wahrheiten über denselben Takt sind eine zu
       viel. */
    arbeitsLauf = null;
    pulsUhr = null;
  };

  /* Zwei Wege, einen Takt loszuwerden, und der Unterschied ist wichtig:
     `kappen()` bricht ihn ab, `abmelden()` nimmt ihn nur aus der Verwaltung.
     Wer ein `taktFremd` gemeldet hat, dessen Abbruch selbst eine Handlung ist
     — eine Absage an den Agenten etwa —, darf sie beim regulären Ende nicht
     versehentlich auslösen. */
  const taktGriff = (abbrechen) => ({
    kappen() {
      takte.delete(abbrechen);
      try { abbrechen(); } catch (_) {}
    },
    abmelden() {
      takte.delete(abbrechen);
    },
  });

  /** Ein einmaliger Takt. Ersetzt `setTimeout` in dieser Datei. */
  const taktEinmal = (tun, ms) => {
    const stand = taktStand;
    let abbrechen = null;
    const id = setTimeout(() => {
      if (abbrechen) takte.delete(abbrechen);
      /* Dazwischen kam der Not-Aus: nicht mehr anfassen, nichts mehr zeigen. */
      if (stand !== taktStand) return;
      tun();
    }, ms);
    abbrechen = () => { try { clearTimeout(id); } catch (_) {} };
    takte.add(abbrechen);
    return taktGriff(abbrechen);
  };

  /** Ein wiederkehrender Takt. Ersetzt `setInterval` in dieser Datei. */
  const taktLaufend = (tun, ms) => {
    const stand = taktStand;
    let abbrechen = null;
    const id = setInterval(() => {
      if (stand !== taktStand) {
        if (abbrechen) { takte.delete(abbrechen); abbrechen(); }
        return;
      }
      tun();
    }, ms);
    abbrechen = () => { try { clearInterval(id); } catch (_) {} };
    takte.add(abbrechen);
    return taktGriff(abbrechen);
  };

  /* Alles andere, was der Not-Aus abbrechen muss und was kein Zeitgeber ist —
     ein `MutationObserver` etwa, oder eine Zusage, die noch aussteht. */
  const taktFremd = (abbrechen) => {
    takte.add(abbrechen);
    return taktGriff(abbrechen);
  };

  const gestoppt = () => {
    if (overlayTot) return;
    /* ERST kappen, dann zeigen. Ein Schild, das „GESTOPPT" sagt, während der
       Zeiger im nächsten Takt weiterwandert, ist die falsche Auskunft im
       schlechtesten Augenblick — für jemanden, der schlecht sieht und sich auf
       die Bewegung verlässt, ist die Bewegung die Aussage und nicht der Text.
       Diese eine Zeile beendet zugleich die Warteschleife, den Arbeitszeiger,
       den Puls und jeden Klick, der nach seiner Antwort noch aussteht. */
    takteKappen();
    zielBezug = null;
    /* Ein gestopptes Zeichen ist rot, in jedem Modus. Bliebe die Farbe der
       Automatik stehen, sagte der Rahmen weiter „hier läuft etwas allein". */
    modusFarbenLoeschen();
    rahmen.setAttribute("data-zustand", "gestoppt");
    schild.setAttribute("data-zustand", "gestoppt");
    schildText(spr("overlay_gestoppt", "GESTOPPT, der Agent steuert nicht mehr"));
    zeiger.setAttribute("data-an", "0");
    fahne.setAttribute("data-an", "0");
    ziel.setAttribute("data-an", "0");
    /* Der Ring am Klickpunkt gehörte bis 14.08.2026 nicht dazu. Sein Takt
       schaltete ihn 650 ms später ab — kappt man den Takt, ohne den Ring
       abzuschalten, bliebe er stehen. Ein leuchtender Klickring auf einem
       gestoppten Zeichen behauptet, hier sei gerade geklickt worden. */
    puls.setAttribute("data-an", "0");
    /* Der eigene Nachlauf des Schildes ist selbst ein Takt: Kommt der Not-Aus
       ein zweites Mal, ersetzt er den ersten, statt sich daneben zu stellen. */
    taktEinmal(() => {
      rahmen.removeAttribute("data-zustand");
      schild.removeAttribute("data-zustand");
      anzeigen(false);
    }, 2200);
  };

  /* ------------------------------------------------------------------ *
   * Der Wächter am Wirt.
   *
   * Der Stil mit !important hält das CSS der Seite auf. Gegen ein Skript der
   * Seite hilft er nicht: `document.getElementById("smartrchrome-host")
   * .remove()` nimmt den Knoten schlicht aus dem Baum, ein appendChild an eine
   * andere Stelle verschiebt ihn aus dem Sichtfenster, und `host.style
   * .display = "none"` überschreibt den Inline-Stil an derselben Stelle, an der
   * er steht. In allen drei Fällen bediente der Agent weiter, nur eben
   * unsichtbar — dasselbe gebrochene Versprechen wie beim CSS.
   *
   * Drei Fallen, an die dieser Wächter sich hält:
   *
   *   1. Keine Schleife mit sich selbst. Das Wiedereinsetzen erzeugt selbst
   *      eine Änderung. Deshalb wird nie „auf eine Meldung hin repariert",
   *      sondern immer erst der Ist-Zustand geprüft: Steht der Wirt richtig,
   *      tut der Rückruf nichts, und die eigene Reparatur läuft nach genau
   *      einem Durchgang aus.
   *   2. Kein teurer Baumvergleich. Beobachtet werden nur die direkten Kinder
   *      von <html> und die Attribute des einen eigenen Knotens. Die Meldungen
   *      selbst werden gar nicht durchgesehen; die Prüfung sind sechs
   *      Eigenschaftsabfragen mit fester Laufzeit, unabhängig von der Größe der
   *      Seite.
   *   3. Kein endloser Kampf. Wer dreimal kurz hintereinander das Zeichen
   *      wegnimmt, greift an. Dann wird die Sitzung beendet, statt weiter zu
   *      reparieren: Lieber keine Sitzung als eine unsichtbare.
   * ------------------------------------------------------------------ */

  const WAECHTER_GRENZE = 3;      // so viele Eingriffe
  const WAECHTER_FENSTER = 4000;  // in so vielen Millisekunden sind ein Angriff

  const ANGRIFF_SATZ = spr(
    "overlay_angriff",
    "Diese Seite entfernt das Sichtzeichen immer wieder, deshalb ist die Sitzung jetzt beendet.",
  );
  const KONTEXT_SATZ = spr(
    "overlay_kontext_weg",
    "Die Verbindung zur Erweiterung ist weg, die Sitzung ist damit ohnehin beendet.",
  );

  let beobachter = null;
  let eingriffe = [];

  /* Wahr, wenn der Erweiterungskontext weg ist: Erweiterung neu geladen,
     aktualisiert oder abgeschaltet. Danach wirft jeder Aufruf von
     chrome.runtime, und zwar synchron. */
  const kontextWeg = () => {
    try {
      return !(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return true;
    }
  };

  const schildText = (text) => {
    try {
      const n = schild.querySelector(".text");
      if (n) n.textContent = text;
    } catch (_) {}
  };

  /* Das Overlay für tot erklären und das auch zeigen. Ein totes Overlay, das
     weiter grün leuchtet, wäre die schlimmste aller Lagen: Der Mensch liest
     „ich sehe alles" und niemand sieht mehr etwas. */
  const totMelden = (satz) => {
    /* Der erste Grund gewinnt. Eine später eintrudelnde Absage darf die
       Erklärung, die der Mensch schon liest, nicht durch eine andere
       ersetzen. */
    if (overlayTot) return;
    overlayTot = true;
    waechterStoppen();
    /* Dieselbe eine Zeile wie im Not-Aus. Bis 14.08.2026 stand hier ein
       einzelnes `clearInterval` für den Arbeitszeiger — genau die Bauform,
       die den Befund erzeugt hat: Die Warteschleife und der ausstehende Klick
       liefen weiter, obwohl das Overlay tot war und nichts mehr zeigen
       konnte. Ein totes Overlay, das noch klickt, ist der schlimmste Fall. */
    takteKappen();
    zielBezug = null;
    /* Ein totes Zeichen hat keinen Betriebsmodus mehr: weder die Farbe noch
       das Merkmal, an dem das Stylesheet sie festmacht. Sonst atmete ein
       totes Overlay weiter in der Farbe einer Automatik, die nicht läuft. */
    modusFarbenLoeschen();
    try {
      rahmen.removeAttribute("data-modus");
      schild.removeAttribute("data-modus");
    } catch (_) {}
    try {
      rahmen.setAttribute("data-an", "1");
      rahmen.setAttribute("data-zustand", "tot");
      schild.setAttribute("data-an", "1");
      schild.setAttribute("data-zustand", "tot");
      schildText(satz);
      for (const el of [zeiger, fahne, ziel, puls]) el.setAttribute("data-an", "0");
      /* Ein totes Zeichen bekommt keine Reißleine: Es gibt nichts mehr zu
         stoppen, und ein Knopf, der nichts tut, ist ein falsches Versprechen. */
      notausZeigen(false);
    } catch (_) {}
    /* Der Titel gehört wieder der Seite: Das Präfix verspricht einen
       gesteuerten Tab, und gesteuert wird hier nichts mehr. */
    if (titelVorher !== null) {
      try { document.title = titelVorher; } catch (_) {}
      titelVorher = null;
    }
  };

  /* Die Notbremse ziehen. Der Rückgabewert sagt, ob die Meldung den Dienst
     überhaupt erreicht hat — still werfen darf dieser Weg nie. */
  const notbremseSenden = (quelle) => {
    if (kontextWeg()) return false;
    try {
      const p = chrome.runtime.sendMessage({ typ: "notbremse", quelle });
      /* Chrome antwortet je nach Fassung mit einem Versprechen. Eine
         abgewiesene Zusage ist derselbe Befund wie ein synchroner Wurf. */
      if (p && typeof p.catch === "function") p.catch(() => totMelden(KONTEXT_SATZ));
      return true;
    } catch (_) {
      return false;
    }
  };

  /* Der Wirt sitzt falsch, wenn er aus dem Baum genommen oder verschoben
     wurde. Beides ist eine Abfrage von Eigenschaften, keine Suche. */
  const wirtSitztFalsch = () => {
    try {
      if (host.isConnected !== true) return true;
      return host.parentNode !== document.documentElement;
    } catch (_) {
      return true;
    }
  };

  const stilSitztFalsch = () => {
    try {
      const s = host.style;
      if (!s || typeof s.getPropertyValue !== "function") return false;
      for (const [eigenschaft, wert] of WIRT_PFLICHT) {
        if (s.getPropertyValue(eigenschaft) !== wert) return true;
        if (s.getPropertyPriority(eigenschaft) !== "important") return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  };

  /* Ein Eingriff der Seite. Zählt im rollenden Fenster mit und meldet, ob das
     Maß voll ist. */
  const eingriffZaehlen = () => {
    const jetzt = performance.now();
    eingriffe = eingriffe.filter((t) => jetzt - t < WAECHTER_FENSTER);
    eingriffe.push(jetzt);
    return eingriffe.length >= WAECHTER_GRENZE;
  };

  const sitzungBeenden = (satz) => {
    notbremseSenden("overlay-entfernt");
    totMelden(satz);
  };

  /* Der Rückruf. Sieht die Meldungen bewusst nicht an — er prüft den
     Ist-Zustand und ist damit gegen seine eigenen Änderungen immun.
     `heiltGerade` ist der zweite Riegel gegen die Schleife: Das
     Wiedereinsetzen meldet sich beim selben Beobachter, und ohne Riegel würde
     ein Wiedereinsetzen, das nicht greift, sich selbst endlos nachrufen. */
  let heiltGerade = false;
  const nachsehen = () => {
    if (overlayTot || heiltGerade) return;
    heiltGerade = true;
    try {
      heilen();
    } finally {
      heiltGerade = false;
    }
  };

  const heilen = () => {
    const weg = wirtSitztFalsch();
    const entstellt = !weg && stilSitztFalsch();
    if (!weg && !entstellt) return;

    let wiederDa = true;
    if (weg) {
      try {
        host.style.cssText = WIRT_STIL;
        host.id = WIRT_ID;
        document.documentElement.appendChild(host);
      } catch (_) {}
      wiederDa = !wirtSitztFalsch();
    } else {
      try { host.style.cssText = WIRT_STIL; } catch (_) {}
      wiederDa = !stilSitztFalsch();
    }

    /* Zwei Gründe, jetzt Schluss zu machen: Das Maß ist voll, oder der Wirt
       kommt gar nicht mehr zurück. Im zweiten Fall gibt es nichts mehr zu
       reparieren, und eine Sitzung ohne Zeichen darf es nicht geben. Dass
       dieser zweite Fall sofort greift und nicht erst beim dritten Mal, ist
       Absicht: Ein Zeichen, das nicht wiederkommt, kommt auch beim dritten
       Versuch nicht wieder. */
    const volles = eingriffZaehlen();
    if (!wiederDa || volles) sitzungBeenden(ANGRIFF_SATZ);
  };

  const waechterStarten = () => {
    if (beobachter || overlayTot) return;
    if (typeof MutationObserver !== "function") return;
    try {
      beobachter = new MutationObserver(nachsehen);
      /* Nur die direkten Kinder von <html>: Der Wirt hängt dort, und dort
         allein kann er verschwinden. Ohne `subtree` meldet der Beobachter
         nichts von dem, was die Seite in ihrem Körper tut. */
      beobachter.observe(document.documentElement, { childList: true });
      /* Und die Attribute des eigenen Knotens, gegen `host.style.display =
         "none"` aus einem Seitenskript. */
      beobachter.observe(host, {
        attributes: true,
        attributeFilter: ["style", "id", "class"],
      });
    } catch (_) {
      beobachter = null;
    }
  };

  function waechterStoppen() {
    if (!beobachter) return;
    try { beobachter.disconnect(); } catch (_) {}
    beobachter = null;
    eingriffe = [];
  }

  const zeigerAuf = (x, y, beschriftung) => {
    const versatz = gross ? 32 : 16;
    zeiger.setAttribute("data-an", "1");
    zeiger.style.transform = `translate3d(${x - versatz / 2}px, ${y - versatz / 2}px, 0)`;
    if (beschriftung) {
      fahne.textContent = beschriftung;
      fahne.setAttribute("data-an", "1");
      fahne.style.transform = `translate3d(${x + versatz}px, ${y + versatz}px, 0)`;
    } else {
      fahne.setAttribute("data-an", "0");
    }
  };

  /*
   * Der Arbeitszeiger.
   *
   * Bis 0.5.1 bewegte sich auf der Lesestufe nichts: Von zehn möglichen
   * Befehlen bewegte genau einer den Zeiger. Wer lesen oder blättern ließ, sah
   * den grünen Rahmen und sonst nichts, und das ist von „kaputt" nicht zu
   * unterscheiden. Hier fährt der Zeiger jetzt auch dann, wenn es gar kein
   * Element gibt, auf das er zeigen könnte.
   *
   * Die Bahn entsteht ausschließlich aus den Maßen des Sichtfensters, nie aus
   * Seiteninhalt. Das Muster ist ein Wort, kein Text von der Seite, und es
   * steht an der Fahne, damit der Mensch liest, was gerade geschieht.
   */
  const arbeitsBahn = {
    lesen: [[0.12, 0.18], [0.72, 0.26], [0.14, 0.42], [0.68, 0.5]],
    ablesen: [[0.2, 0.3], [0.6, 0.34], [0.3, 0.52]],
    prüfen: [[0.5, 0.2], [0.5, 0.45]],
    blättern: [[0.86, 0.25], [0.86, 0.65]],
    warten: [[0.5, 0.4], [0.53, 0.4], [0.5, 0.4]],
    aufnehmen: [[0.5, 0.5]],
    wechseln: [[0.3, 0.08], [0.5, 0.08]],
    zurück: [[0.06, 0.08], [0.06, 0.12]],
  };
  let arbeitsLauf = null;
  /* Den eigenen Takt anhalten — an EINER Stelle, damit „läuft er noch" und
     „habe ich ihn gelöscht" nicht auseinanderlaufen können. */
  const arbeitsHalt = () => {
    if (arbeitsLauf) arbeitsLauf.kappen();
    arbeitsLauf = null;
  };
  const arbeitsZeiger = (muster) => {
    const bahn = arbeitsBahn[muster] || arbeitsBahn.lesen;
    arbeitsHalt();
    const b = innerWidth, h = innerHeight;
    let i = 0;
    const schritt = () => {
      if (i >= bahn.length) {
        arbeitsHalt();
        return;
      }
      const [ax, ay] = bahn[i++];
      zeigerAuf(Math.round(b * ax), Math.round(h * ay), muster);
    };
    schritt();
    /* Über die Taktverwaltung und nicht über ein nacktes `setInterval`: Genau
       dieser Takt hat den Zeiger 420 ms nach dem Not-Aus wieder eingeschaltet
       (Befund NOTAUS-3). */
    arbeitsLauf = taktLaufend(schritt, 420);
  };

  const zielRahmen = (r) => {
    if (!r) { ziel.setAttribute("data-an", "0"); return; }
    /* Der Wirt ist position:fixed — also Sichtfenster-Koordinaten verwenden,
       ohne Scroll-Versatz. Sonst wandert der Zielrahmen auf gescrollten Seiten. */
    ziel.style.left = `${r.left}px`;
    ziel.style.top = `${r.top}px`;
    ziel.style.width = `${r.width}px`;
    ziel.style.height = `${r.height}px`;
    ziel.setAttribute("data-an", "1");
  };

  /* ------------------------------------------------------------------ *
   * Dem Bildlauf folgen.
   *
   * Der Zielrahmen und der Zeiger stehen in Sichtfenster-Koordinaten, weil der
   * Wirt fixiert ist. Genau deshalb zeigten sie bis 0.5.2 nach jedem Bildlauf
   * auf die falsche Stelle: Das Element wandert mit dem Inhalt, der Rahmen
   * blieb stehen. Der Mensch sah einen Rahmen um „Abmelden" und gab in
   * Wahrheit „Bestellen" frei — eine Freigabe, die etwas anderes meint als
   * das, was sie zeigt, ist keine.
   *
   * Gemerkt wird der Bildlaufstand zum Zeitpunkt der Anzeige; nachgeführt wird
   * um genau die Differenz. Das ist kein Nachmessen am Element, sondern eine
   * Subtraktion, und es kostet vier Schreibvorgänge ohne einen einzigen
   * Layout-Lesevorgang.
   * ------------------------------------------------------------------ */

  let zielBezug = null;

  const bildlaufstand = () => ({
    x: Number(window.scrollX) || 0,
    y: Number(window.scrollY) || 0,
  });

  const bezugMerken = (n) => {
    zeiger.removeAttribute("data-folgt");
    if (!n || !n.rect) { zielBezug = null; return; }
    const s = bildlaufstand();
    zielBezug = {
      rect: { left: n.rect.left, top: n.rect.top, width: n.rect.width, height: n.rect.height },
      x: Number(n.x),
      y: Number(n.y),
      beschriftung: n.beschriftung,
      scrollX: s.x,
      scrollY: s.y,
      /* Der zuletzt angewandte Versatz. Er spart die Schreibvorgänge bei
         Ereignissen ohne Bewegung, ohne die Rechnung zu verfälschen: Gerechnet
         wird immer vom Bezugspunkt, nie Schritt für Schritt. Ein
         Schritt-für-Schritt-Versatz liefe mit jeder Rundung weiter weg. */
      dx: 0,
      dy: 0,
    };
  };

  const zielNachfuehren = () => {
    if (!zielBezug || overlayTot) return;
    const s = bildlaufstand();
    const dx = s.x - zielBezug.scrollX;
    const dy = s.y - zielBezug.scrollY;
    if (dx === zielBezug.dx && dy === zielBezug.dy) return;
    zielBezug.dx = dx;
    zielBezug.dy = dy;
    const r = zielBezug.rect;
    ziel.style.left = `${r.left - dx}px`;
    ziel.style.top = `${r.top - dy}px`;
    ziel.style.width = `${r.width}px`;
    ziel.style.height = `${r.height}px`;
    if (Number.isFinite(zielBezug.x) && Number.isFinite(zielBezug.y)) {
      zeiger.setAttribute("data-folgt", "1");
      zeigerAuf(zielBezug.x - dx, zielBezug.y - dy, zielBezug.beschriftung);
    }
  };

  /* Ein Ring am Ort der Handlung. Wird bei jedem Klick ausgelöst, damit der
     Mensch sieht, DASS gerade etwas geschieht — nicht nur, wohin gezeigt wird. */
  let pulsUhr = null;
  const klickPuls = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    puls.style.left = `${x}px`;
    puls.style.top = `${y}px`;
    /* Neu auslösen: Attribut kurz weg, ein Reflow, wieder dran — sonst spielt
       die Animation beim zweiten Klick auf dieselbe Stelle nicht noch einmal. */
    puls.setAttribute("data-an", "0");
    void puls.offsetWidth;
    puls.setAttribute("data-an", "1");
    if (pulsUhr) pulsUhr.kappen();
    /* Auch dieser Takt geht über die Verwaltung. Er schaltet den Ring nur AB,
       richtet also für sich genommen keinen Schaden an — aber ein Takt, der
       „harmlos" heisst und deshalb an der Verwaltung vorbeiläuft, ist der
       nächste, den beim übernächsten Umbau niemand mehr findet. Abgeschaltet
       wird der Ring beim Not-Aus in `gestoppt()` ausdrücklich. */
    pulsUhr = taktEinmal(() => puls.setAttribute("data-an", "0"), 650);
  };


  /* Sichtbare, benannte Elemente einsammeln — rein lesend. */
  const seiteLesen = (grenze = 12) => {
    const auswahl = "a[href], button, input, select, textarea, [role=button], [role=link]";
    const treffer = [];
    let nr = 0;
    for (const el of sammle(auswahl)) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const stil = getComputedStyle(el);
      if (stil.visibility === "hidden" || stil.display === "none") continue;
      const name =
        (el.getAttribute("aria-label") ||
          el.innerText ||
          el.value ||
          el.getAttribute("title") ||
          el.getAttribute("placeholder") ||
          "").trim().replace(/\s+/g, " ").slice(0, 80);
      if (!name) continue;
      treffer.push({
        ref: `e${++nr}`,
        rolle: el.getAttribute("role") || el.tagName.toLowerCase(),
        name,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        mitte: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      });
      if (treffer.length >= grenze) break;
    }
    return treffer;
  };

  /* ------------------------------------------------------------------ *
   * Wahrnehmung — der Textbaum der Seite.
   *
   * Dieses Skript liest nur. Es klickt nichts, tippt nichts und schreibt
   * nichts; es leitet Rolle, Name und Zustand aus dem DOM ab. Der Debugger
   * wird dafür bewusst NICHT angehängt: Reines Lesen kommt ohne die
   * weitreichendste Berechtigung aus, die Chrome kennt, und ohne Warnleiste
   * (spec-01 §4.2). Der Preis ist eine etwas schlechtere Wahrnehmung — kein
   * berechneter AX-Name, keine geschlossenen Schattenbäume, keine fremden
   * Rahmenseiten. Das ist der richtige Preis. OFFENE Schattenbäume dagegen
   * werden seit 06.08.2026 betreten (`sammle`): dort rendern die üblichen
   * Zustimmungsbanner, und an die kommt jedes Skript ohnehin heran.
   *
   * Was hier NICHT entschieden wird: wie viel davon der Agent zu sehen
   * bekommt. Die Deckel liegen im Hintergrunddienst (net/befehle.js), weil
   * dieses Skript in einer fremden Seite läuft — was von hier kommt, wird
   * dort gemessen, nicht geglaubt.
   * ------------------------------------------------------------------ */

  const BEREICHE =
    "header, nav, main, aside, footer, form, dialog, [role=banner], [role=navigation]," +
    "[role=main], [role=complementary], [role=contentinfo], [role=search], [role=form]," +
    "[role=region], [role=dialog]";
  const ELEMENTE =
    "a[href], button, input, select, textarea, summary, [role=button], [role=link]," +
    "[role=checkbox], [role=radio], [role=switch], [role=textbox], [role=combobox]," +
    "[role=searchbox], [role=menuitem], [role=tab], [role=option]";
  const TEXTE = "h1, h2, h3, h4, h5, h6, p, li, td, th, dt, dd, figcaption, blockquote";

  /* Wie viele Knoten überhaupt angefasst werden. Eine Seite mit 200.000
     Elementen darf den Tab nicht anhalten — die Zahl ist kein Deckel für den
     Agenten, sondern einer für den Rechner des Nutzers. */
  const ABTASTGRENZE = 4000;
  const ROHGRENZE = 400;

  /* Elemente einsammeln — aus dem Dokument und aus OFFENEN Schattenbäumen.
     Viele deutsche Zustimmungsbanner (Usercentrics u. a.) und moderne
     Web-Components rendern in einer offenen Schatten-Wurzel. document.
     querySelectorAll sieht dort nicht hinein — das Banner war damit weder
     lesbar noch klickbar, und die Alltagsaufgabe „akzeptiere das Banner und
     such X" scheiterte am ersten Schritt.
     Betreten wird nur, was offen ist: el.shadowRoot ist bei geschlossenen
     Schattenbäumen null, an die kommt kein Skript — auch dieses nicht. Der
     eigene Wirt (#smartrchrome-host) wird übersprungen; sein Schatten ist
     ohnehin geschlossen. getBoundingClientRect liefert über Schattengrenzen
     hinweg Sichtfenster-Koordinaten, Zeiger und Rahmen stimmen also weiter.
     Der Deckel gehört dem Rechner des Nutzers: mehr als das Vierfache der
     ABTASTGRENZE wird nicht abgetastet — der Rest der Seite bleibt dann
     ungesehen, wie er es vorher auch war. */
  const sammle = (auswahl) => {
    const deckel = ABTASTGRENZE * 4;
    const treffer = [];
    const wurzeln = [document];
    let abgetastet = 0;
    while (wurzeln.length) {
      const wurzel = wurzeln.shift();
      /* Erst die Treffer dieser Wurzel einsammeln, dann nach weiteren
         Schatten-Wurzeln suchen — so bleibt auf riesigen Seiten wenigstens
         die Sicht auf das Dokument vollständig, bevor der Deckel greift. */
      let gefunden = [];
      try {
        gefunden = wurzel.querySelectorAll(auswahl);
      } catch (_) {
        continue;
      }
      for (const el of gefunden) {
        if (++abgetastet > deckel) return treffer;
        treffer.push(el);
      }
      let kandidaten = [];
      try {
        kandidaten = wurzel.querySelectorAll("*");
      } catch (_) {
        continue;
      }
      for (const el of kandidaten) {
        if (++abgetastet > deckel) return treffer;
        if (el.id === "smartrchrome-host") continue;
        if (el.shadowRoot) wurzeln.push(el.shadowRoot);
      }
    }
    return treffer;
  };

  /* ------------------------------------------------------------------ *
   * Geheimfelder — die Erkennung steht nicht mehr hier
   *
   * Bis zum 14.08.2026 stand an dieser Stelle eine vollständige Fassung der
   * Erkennung, und in `content/rekorder.js` stand dieselbe ein zweites Mal,
   * Wort für Wort abgeschrieben, mit dem Kommentar „wer eine der Listen
   * ändert, ändert beide". Genau das ist nicht geschehen, und `selektor.js`
   * hatte gar keine. Die Abnahme hat fünf Lecks gemessen, die alle in
   * `sa_workflows` gelandet sind.
   *
   * Ab Festlegung F4 gibt es genau eine Quelle: `content/geheim.js`, als
   * erste Datei eingespielt, erreichbar über `globalThis.SMARTR_GEHEIM`.
   *
   * Fehlt sie, gilt hier jedes Feld als geheim. Das ist kein Notausgang,
   * sondern die einzige ehrliche Antwort: Ohne Erkennung ist unbekannt, was
   * in einem Feld steht, und „unbekannt" heisst in dieser Erweiterung nicht
   * lesen und nicht hineintippen. Laut ist es auch — jede Absage heisst dann
   * `feld_geheim`, und das fällt in der ersten Minute auf.
   * ------------------------------------------------------------------ */

  const geheimQuelle = () => globalThis.SMARTR_GEHEIM;

  const geheim = (el) => {
    const G = geheimQuelle();
    if (!G || typeof G.geheim !== "function") {
      /* Ohne die eine Quelle: alles, was einen Inhalt tragen kann, ist geheim. */
      const tag = el && el.tagName;
      return (
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        !!(el && el.isContentEditable === true)
      );
    }
    try {
      return G.geheim(el) === true;
    } catch (_) {
      return true;
    }
  };

  /* Epochen. Referenzen gehören zu genau einer Wahrnehmung; eine neue macht
     die alte ungültig (spec-01 §4.5, I3). Vorgehalten werden die zwei
     jüngsten — mehr wäre die Einladung, mit einer alten Sicht auf eine neue
     Seite zu zeigen.

     Die Kennung trägt eine Zufallsmarke dieses Dokuments. Ohne sie hieße die
     erste Wahrnehmung nach jeder Navigation wieder „s1" — und eine Referenz
     aus der alten Seite zeigte auf ein Element der neuen. */
  const DOKUMENTMARKE = Math.random().toString(36).slice(2, 6);
  const epochen = new Map();
  let epochenNr = 0;

  const sichtbar = (el, r) => {
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };

  const rolleVon = (el) => {
    const ausdruecklich = (el.getAttribute("role") || "").trim().toLowerCase();
    if (ausdruecklich) return ausdruecklich.split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const art = (el.getAttribute("type") || "text").toLowerCase();
      if (art === "checkbox") return "checkbox";
      if (art === "radio") return "radio";
      if (art === "search") return "searchbox";
      if (["button", "submit", "reset", "image"].includes(art)) return "button";
      if (art === "range") return "slider";
      if (art === "number") return "spinbutton";
      return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return `heading${tag[1]}`;
    return tag;
  };

  const nameVon = (el) => {
    const beschriftet = el.getAttribute("aria-labelledby");
    if (beschriftet) {
      const teile = beschriftet
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => n.textContent || "");
      if (teile.join(" ").trim()) return teile.join(" ");
    }
    /* Befund vom 14.08.2026 (Verzahnung): `geheim()` und `wertVon()` decken den
       WERT eines Feldes ab, den Namen nicht. Bei einem <div contenteditable>
       mit Geheiminhalt hat `wertVon` den Wert richtig verweigert, derselbe
       getippte Text stand aber als `name` im Textbaum und ging so an den
       Agenten. Der Inhalt eines Elements, das Inhalt trägt, ist nie seine
       Beschriftung — dieselbe Trennung, die `beschriftungVon` in
       `content/geheim.js` begründet. Seit Festlegung F4 vom 14.08.2026 gibt
       es die Erkennung genau einmal, und beide Seiten fragen sie. */
    const inhaltIstGeheim = geheim(el);
    const kandidaten = [
      el.getAttribute("aria-label"),
      el.tagName === "INPUT" || el.tagName === "TEXTAREA" || inhaltIstGeheim
        ? null
        : el.innerText,
      el.getAttribute("title"),
      el.getAttribute("placeholder"),
      el.getAttribute("alt"),
    ];
    for (const k of kandidaten) {
      if (k && String(k).trim()) return String(k);
    }
    /* Zuletzt das zugehörige <label> — es steht oft neben dem Feld, nicht darin. */
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && l.textContent.trim()) return l.textContent;
    }
    return "";
  };

  const wertVon = (el) => {
    if (geheim(el)) return null; // nie, aus keinem Grund
    const tag = el.tagName;
    if (tag === "SELECT") {
      const gewaehlt = el.options && el.options[el.selectedIndex];
      return gewaehlt ? gewaehlt.text : null;
    }
    if (tag === "INPUT") {
      const art = (el.getAttribute("type") || "text").toLowerCase();
      if (["checkbox", "radio", "button", "submit", "reset", "image", "file"].includes(art)) {
        return null;
      }
      return el.value || null;
    }
    if (tag === "TEXTAREA") return el.value || null;
    return null;
  };

  /* Nur Zustände aus der geschlossenen Menge (spec-01 §4.3.1). Was hier nicht
     steht, wird verworfen — eine offene Menge wäre ein Weg, Seiteninhalt als
     Tatsache in den Agenten zu bringen. */
  const zustandVon = (el, drin) => {
    const z = [];
    if (el.disabled || el.getAttribute("aria-disabled") === "true") z.push("disabled");
    if (el.readOnly) z.push("readonly");
    if (el.required || el.getAttribute("aria-required") === "true") z.push("required");
    if (el.getAttribute("aria-invalid") === "true") z.push("invalid");
    if (el === document.activeElement) z.push("focused");
    if (typeof el.checked === "boolean" && (el.type === "checkbox" || el.type === "radio")) {
      z.push(el.checked ? "checked" : "unchecked");
    }
    const auf = el.getAttribute("aria-expanded");
    if (auf === "true") z.push("expanded");
    else if (auf === "false") z.push("collapsed");
    if (el.getAttribute("aria-selected") === "true") z.push("selected");
    if (el.getAttribute("aria-busy") === "true") z.push("busy");
    if (!drin) z.push("offscreen");
    return z;
  };

  const bereichstiefe = (el) => {
    let tiefe = 0;
    let p = el.parentElement;
    while (p && tiefe < 3) {
      if (p.matches && p.matches(BEREICHE)) tiefe += 1;
      p = p.parentElement;
    }
    return tiefe;
  };

  /* Eigener Text eines Knotens — ohne den Text seiner Kinder. Ohne diese
     Einschränkung stünde der Inhalt einer Seite fünfmal im Baum, einmal je
     Verschachtelungsebene. */
  const eigenerText = (el) => {
    let s = "";
    for (const k of el.childNodes) {
      if (k.nodeType === 3) s += k.nodeValue;
    }
    return s.trim();
  };

  /**
   * Die Wahrnehmung erheben.
   *
   * `offscreen` = false heißt: höchstens eine Bildschirmhöhe über und unter
   * dem sichtbaren Bereich. Der Rest wird gezählt und gemeldet, aber nicht
   * geliefert — dafür gibt es `scroll`.
   */
  const baumErheben = ({ offscreen = false } = {}) => {
    const spielraum = (offscreen ? 6 : 1) * innerHeight;
    const knoten = [];
    const tabelle = new Map();
    let nr = 0;
    let angefasst = 0;
    let ausgelassenAusserhalb = 0;

    const alle = sammle(`${BEREICHE}, ${ELEMENTE}, ${TEXTE}`);
    for (const el of alle) {
      if (++angefasst > ABTASTGRENZE) break;
      if (knoten.length >= ROHGRENZE) break;
      if (el.id === "smartrchrome-host" || el.closest("#smartrchrome-host")) continue;

      const istElement = el.matches(ELEMENTE);
      const istBereich = !istElement && el.matches(BEREICHE);

      const r = el.getBoundingClientRect();
      if (!istBereich && !sichtbar(el, r)) continue;

      const imFenster = r.bottom >= 0 && r.top <= innerHeight;
      const inReichweite = r.bottom >= -spielraum && r.top <= innerHeight + spielraum;
      if (!istBereich && !inReichweite) {
        if (istElement) ausgelassenAusserhalb += 1;
        continue;
      }

      const tiefe = bereichstiefe(el);

      if (istElement) {
        const name = nameVon(el).slice(0, 200);
        const wert = wertVon(el);
        if (!name && !wert) continue; // ohne Namen und ohne Wert nicht bedienbar
        const ref = `e${++nr}`;
        knoten.push({
          art: "element",
          ref,
          rolle: rolleVon(el),
          name,
          wert: wert ? String(wert).slice(0, 300) : null,
          zustand: zustandVon(el, imFenster),
          tiefe,
        });
        tabelle.set(ref, el);
        continue;
      }

      if (istBereich) {
        knoten.push({
          art: "bereich",
          rolle: rolleVon(el),
          name: (el.getAttribute("aria-label") || "").slice(0, 200),
          tiefe,
        });
        continue;
      }

      const text = eigenerText(el);
      if (!text) continue;
      knoten.push({ art: "text", rolle: rolleVon(el), name: text.slice(0, 200), tiefe });
    }

    const epoche = `s${++epochenNr}.${DOKUMENTMARKE}`;
    epochen.set(epoche, tabelle);
    /* Nur die zwei jüngsten Epochen bleiben stehen. */
    for (const alt of [...epochen.keys()].slice(0, -2)) epochen.delete(alt);

    return {
      ok: true,
      epoche,
      knoten,
      ausgelassen: { ausserhalb: ausgelassenAusserhalb, abgetastet: angefasst },
    };
  };

  /* Die Bauform eines Elements: HTML-Marke, sein `type`-Merkmal und ob das
     Formular, in dem es steht, ein Geheimfeld enthält.
     Warum das mitgeht: Der Klassifizierer in `befehle.js` (VERTRAG v3.5 §3.1)
     erkennt vier seiner zwölf Auslöser sonst nur am Wort — `input[type=file]`,
     `type=submit`, ein Passwortfeld ohne Beschriftung und das Absenden einer
     Anmeldemaske. Am Wort erkannt heisst: eine fremde Seite entscheidet über
     die Rückfrage, indem sie ihren Knopf anders beschriftet.
     Es sind ausschliesslich Angaben über die BAUFORM. Ein Formular meldet,
     DASS es ein Geheimfeld enthält, nie was darin steht. */
  const bauformVon = (el) => {
    /* Befund M5 vom 14.08.2026: Hier stand `el.closest("form")` und sonst
       nichts. Eine Anmeldemaske ohne `<form>`, also der Normalfall in React
       und Vue, meldete damit immer `false` — und der Vertragsfall aus §3.1
       („click auf ein Element in einem Formular, das ein Geheimfeld enthält")
       feuerte dort nie. Das Passwort stand im Feld, und der Absendeklick ging
       im Modus `auto` stumm durch.

       Gefragt wird jetzt `content/geheim.js` (F4): Es läuft die Elternkette
       ab, gedeckelt auf vier Ebenen und mit Halt an `<body>`, und ein
       ausdrücklicher Abschnitt beendet die Suche. Ein Fehlalarm kostet nach
       §3.1 eine Rückfrage, ein übersehener Treffer den Anmeldeklick — die
       Asymmetrie zeigt, in welche Richtung diese Prüfung irren darf. */
    let formularGeheim = false;
    const G = geheimQuelle();
    try {
      if (G && typeof G.imGeheimAbschnitt === "function") {
        formularGeheim = G.imGeheimAbschnitt(el) === true || geheim(el) === true;
      } else {
        /* Ohne die eine Quelle ist jedes Feld geheim (siehe oben), also auch
           jedes Umfeld. Weniger zu behaupten wäre eine Freigabe aus Unwissen. */
        formularGeheim = true;
      }
    } catch (_) {
      /* Kein Zugriff, keine Aussage. Fehlt die Angabe, fällt der Befund milder
         aus und nie strenger — deshalb ist sie freiwillig und nicht Bedingung. */
    }
    return {
      marke: String(el.tagName || "").toLowerCase(),
      /* `feldtyp` und nicht `typ`: In den Nachrichten dieser Erweiterung heisst
         `typ` immer die Art der Nachricht selbst. */
      feldtyp: String(el.getAttribute("type") || "").toLowerCase(),
      formularGeheim,
    };
  };

  /* Eine Referenz auflösen. Fail-closed: unbekannte Epoche, verschwundenes
     oder unsichtbares Element ergeben eine benannte Absage, nie ein geratenes
     Ersatzelement. Ein Zeiger, der auf das falsche Element zeigt, ist
     schlimmer als gar keiner. */
  const nachschlagen = (ref, epoche) => {
    const tabelle = epoche ? epochen.get(epoche) : null;
    if (!tabelle) return { ok: false, fehler: "stale_ref" };
    const el = tabelle.get(String(ref || ""));
    if (!el || !el.isConnected) return { ok: false, fehler: "element_not_found" };
    const r = el.getBoundingClientRect();
    if (!sichtbar(el, r) || r.bottom < 0 || r.top > innerHeight) {
      return { ok: false, fehler: "element_not_visible" };
    }
    return {
      ok: true,
      rolle: rolleVon(el),
      name: nameVon(el).slice(0, 200),
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      mitte: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      ...bauformVon(el),
    };
  };

  /* ------------------------------------------------------------------ *
   * Ankerkaskade → Referenz (VERTRAG v3.5 §7.1, Nachricht `overlay:kaskade`).
   *
   * Ohne diesen Weg ist kein aufgezeichneter Ablauf abspielbar: Ein Workflow
   * trägt Anker, die Befehlsschleife braucht eine Referenz. Bis zum 14.08.2026
   * antwortete die Seite hier mit `unbekannte_nachricht`; der Ausführer meldete
   * sauber `workflow_step_failed` nach §7.4, aber KEIN Ablauf mit
   * click/input/select/scroll lief.
   *
   * Referenz UND Epoche kommen zusammen zurück. Eine Referenz ohne ihre Epoche
   * ist eine Zahl, die auf der nächsten Wahrnehmung etwas anderes bedeutet.
   * ------------------------------------------------------------------ */

  const juengsteEpoche = () => [...epochen.keys()].slice(-1)[0] || null;

  /* Eine Referenz, die in dieser Tabelle noch frei ist. Sie muss dem Muster des
     Drahtformats folgen (`/^e[0-9]{1,4}$/`, `refPruefen` in befehle.js) — eine
     eigene Schreibweise wie „k1" würde der Ausführer zu Recht verwerfen. */
  const frischeRef = (tabelle) => {
    let hoechste = 0;
    for (const ref of tabelle.keys()) {
      const t = /^e([0-9]{1,4})$/.exec(ref);
      if (t) hoechste = Math.max(hoechste, Number(t[1]));
    }
    return hoechste < 9999 ? `e${hoechste + 1}` : null;
  };

  const kaskadeZuRef = (kaskade) => {
    const selektor = globalThis.SMARTR_SELEKTOR;
    /* `selektor.js` gehört dem Teach-Modus und steht in der Kür der
       Einspielliste (net/seite.js). Fehlt sie, gilt dasselbe wie bei einem
       Anker, der nichts trifft: Der Schritt ist nicht abspielbar. Eine eigene
       Kennung dafür hätte der Ausführer nicht im Vertrag stehen. */
    if (!selektor || typeof selektor.kaskadeAufloesen !== "function") {
      return { ok: false, fehler: "kaskade_gebrochen" };
    }
    if (!Array.isArray(kaskade) || !kaskade.length) {
      return { ok: false, fehler: "kaskade_gebrochen" };
    }

    let treffer = null;
    try {
      treffer = selektor.kaskadeAufloesen(kaskade, document);
    } catch (_) {
      treffer = null;
    }
    if (!treffer || treffer.ok !== true || !treffer.el) {
      return { ok: false, fehler: "kaskade_gebrochen" };
    }

    /* Aufgelöst wird gegen die JÜNGSTE Wahrnehmung. Steht noch keine, oder
       kennt sie das Element nicht (es lag ausserhalb des Sichtfelds, oder die
       Seite hat es seither nachgeladen), wird einmal neu wahrgenommen. Das ist
       genau das, was ein `readPage` auch täte, und es ist der einzige Weg, zu
       einer Referenz zu kommen, die auf der Gegenseite etwas bedeutet. */
    let epoche = juengsteEpoche();
    let tabelle = epoche ? epochen.get(epoche) : null;
    let ref = tabelle ? refZuElement(tabelle, treffer.el) : null;

    if (!ref) {
      try {
        baumErheben({ offscreen: true });
      } catch (_) {
        /* Eine gescheiterte Wahrnehmung nimmt die alte nicht mit. */
      }
      epoche = juengsteEpoche();
      tabelle = epoche ? epochen.get(epoche) : null;
      ref = tabelle ? refZuElement(tabelle, treffer.el) : null;
    }
    if (!tabelle || !epoche) return { ok: false, fehler: "kaskade_gebrochen" };

    if (!ref) {
      /* Der Anker trifft ein Element, das die Wahrnehmung nicht aufführt — ein
         Knopf ohne Namen zum Beispiel. Es hier einzutragen ist ehrlicher als
         abzusagen: Der Anker hat getroffen, und was danach kommt (Sichtbarkeit,
         Verdeckungswache, Geheimfeld), prüft der Bedienweg ohnehin selbst. */
      ref = frischeRef(tabelle);
      if (!ref) return { ok: false, fehler: "kaskade_gebrochen" };
      tabelle.set(ref, treffer.el);
    }

    return {
      ok: true,
      ref,
      epoche,
      /* Festlegung F3 vom 14.08.2026: Name und Rolle gehören in diese
         Antwort, damit der Ausführer die IDENTITÄT gegenhalten kann und nicht
         nur die Eindeutigkeit.
         Befund B7: Ein Anker aus nichts als Elementname und Stellenangabe
         (`input:nth-of-type(1)`, und der XPath kann nichts anderes) trifft
         nach einem Umbau weiter GENAU EIN Element, nur eben ein anderes. Die
         Antwort hiess `ok:true`, getroffen wurde `name=titel`, und die
         Artikelnummer landete im Titelfeld — der Ablauf brach nicht ab, er
         tippte falsch und meldete Erfolg.
         Der Name kommt aus `content/geheim.js`, also aus derselben Funktion,
         mit der `rekorder.js` `schritt.beschreibung` gebaut hat. Zwei
         Funktionen, die den Namen verschieden bilden, meldeten einen
         Unterschied, wo keiner ist. */
      name: kaskadeName(treffer.el),
      rolle: rolleVon(treffer.el),
      /* Welcher Anker getroffen hat, gehört in die Antwort: Nur so kann die
         Werkbank später anzeigen, dass Anker 1 gebrochen ist und Anker 2 trägt
         (§7.4). Der Anker ist ein Selektor aus der eigenen Aufzeichnung, kein
         Seitentext. */
      anker: typeof treffer.anker === "string" ? treffer.anker.slice(0, 200) : "",
      stelle: Number.isInteger(treffer.stelle) ? treffer.stelle : 0,
    };
  };

  /* Der Name, den F3 vergleicht. Er wird bewusst NICHT mit `nameVon` gebildet:
     `nameVon` baut den Namen für den Textbaum, `beschreibungVon` den für den
     Ablauf, und verglichen wird gegen `schritt.beschreibung` aus dem Ablauf. */
  const kaskadeName = (el) => {
    const G = geheimQuelle();
    if (G && typeof G.beschreibungVon === "function") {
      try {
        return String(G.beschreibungVon(el) || "").slice(0, 200);
      } catch (_) {
        /* dann der Weg des Textbaums */
      }
    }
    try {
      return nameVon(el).slice(0, 200);
    } catch (_) {
      return "";
    }
  };

  const refZuElement = (tabelle, el) => {
    for (const [ref, kandidat] of tabelle) {
      if (kandidat === el) return ref;
    }
    return null;
  };

  /* ------------------------------------------------------------------ *
   * Bedienen — klicken und tippen.
   *
   * Beide Wege lösen die Referenz über `nachschlagen` auf: unbekannte Epoche,
   * verschwundenes oder unsichtbares Element ergeben eine benannte Absage,
   * nie ein geratenes Ersatzelement. Ein Klick auf das falsche Element ist
   * schlimmer als gar keiner.
   *
   * Der Klick wird NACH der Antwort ausgelöst (`taktEinmal(..., 0)`): Löst er
   * eine Navigation aus, stirbt dieses Skript mit der Seite — die Antwort wäre
   * sonst nie abgeschickt, und der Agent läse „keine Antwort vom Browser",
   * obwohl der Klick stattgefunden hat.
   *
   * Genau dieses Fenster gehört seit 14.08.2026 der Taktverwaltung, und das
   * ist keine Aufräumarbeit: Zwischen der Antwort und dem Klick liegt ein
   * ganzer Durchlauf der Warteschlange, und die Reissleine wird in eben
   * diesem Augenblick gezogen — der Mensch sieht das Ziel und will es nicht.
   * Ein `setTimeout`, das niemand kappen kann, hätte hier NACH dem Not-Aus
   * geklickt, getippt, ausgewählt oder ein Formular abgeschickt. Das ist die
   * teuerste Erscheinungsform derselben Klasse wie der weiterlaufende
   * Arbeitszeiger: Dort log eine Anzeige, hier handelte die Erweiterung.
   *
   * In Geheimfelder (Passwort, Karte, Einmalcode) wird nie getippt — dieselbe
   * Liste, nach der ihr Inhalt nie ausgelesen wird (spec-01 V10). Anmelden
   * bleibt Sache des Menschen.
   * ------------------------------------------------------------------ */

  const elementAus = (ref, epoche) => {
    const treffer = nachschlagen(ref, epoche);
    if (!treffer.ok) return { ok: false, fehler: treffer.fehler };
    const tabelle = epochen.get(epoche);
    const el = tabelle && tabelle.get(String(ref));
    if (!el || !el.isConnected) return { ok: false, fehler: "element_not_found" };
    return { ok: true, el, treffer };
  };

  /* Die Umgebung, die die Klickwache braucht. Sie sieht selbst keinen Browser;
     Dokument, Sichtfeld und Stilabfrage werden hereingereicht, damit dieselbe
     Logik im Prüfstand gefahren werden kann wie in der Seite.
     `getComputedStyle` wird eingepackt und nicht als blanke Referenz gereicht:
     Losgelöst von ihrem Fenster wirft sie in Chrome „Illegal invocation", und
     der Wurf liefe in den try der Wache. Aus dem Test auf `pointer-events`
     würde dann ein stilles Nichts — die teuerste Sorte Fehler, weil alles
     weiterhin grün aussieht. */
  const wacheUmgebung = () => ({
    dokument: document,
    sichtfeld: { breite: innerWidth, hoehe: innerHeight },
    stil: (el) => getComputedStyle(el),
  });

  /*
   * Der einzige Weg, auf dem dieses Skript ein Element der Seite anfasst.
   *
   * Befund vom 11.08.2026: Die Verdeckungswache lag fertig in befehle.js, mit
   * achtzehn grünen Prüfstellen darüber, und der Klickweg rief sie nirgends.
   * Über einem freigegebenen „Jetzt kaufen" lag ein ganzseitiger Überzug,
   * elementFromPoint gab eindeutig den Überzug zurück, und die Erweiterung
   * klickte trotzdem und meldete Erfolg. Deshalb geht ab hier jede Handlung an
   * einem Element durch `klickFreigeben`, und zwar als AUSLÖSER: Wer die Absage
   * übersehen könnte, könnte trotzdem klicken; wer den Auslöser abgibt, kann es
   * nicht.
   *
   * Fehlt die Wache, wird nicht gehandelt. Ohne Wache keine Bedienung ist die
   * einzige Lesart, die den Befund wirklich schließt: Eine Bedienung, die bei
   * fehlender Prüfung durchwinkt, ist genau die Bedienung von vorher.
   */
  const durchDieWache = (el, ausloesen) => {
    const wache = globalThis.SMARTR_KLICKWACHE;
    if (!wache || typeof wache.klickFreigeben !== "function") {
      return { ok: false, fehler: "wache_fehlt" };
    }
    const frei = wache.klickFreigeben(el, wacheUmgebung(), ausloesen);
    if (frei && frei.ok === true) return { ok: true, punkt: frei.punkt };

    /* Die Namen der Wache in die Kennungen übersetzen, die der Ausführer in
       Sätze für den Agenten fasst. Der Satz steht dort und nicht hier: Dieses
       Skript läuft in einer fremden Seite, und was von hier kommt, wird dort
       gemessen und nicht geglaubt. */
    const name = (frei && frei.name) || "leer";
    const absage =
      name === "kein_ziel"
        ? { ok: false, fehler: "element_not_found" }
        : name === "verdeckt"
          ? { ok: false, fehler: "element_covered" }
          : { ok: false, fehler: "element_not_visible" };
    absage.wache = name;
    if (frei && frei.darueber) absage.darueber = frei.darueber;
    return absage;
  };

  const klicken = ({ ref, epoche }) => {
    const z = elementAus(ref, epoche);
    if (!z.ok) return { ok: false, fehler: z.fehler };
    const { el, treffer } = z;
    const frei = durchDieWache(el, (punkt) => {
      /* Der Puls am Klickpunkt sagt „jetzt ist etwas passiert". Den Zeiger
         selbst setzt der Ausführer per overlay:zeiger, BEVOR dieser Klick
         kommt — so ist die Bewegung über die Spur prüfbar und geschieht nur
         nach dem Ja. Der Puls steht hier im Auslöser und nicht davor: Er soll
         nur dann aufgehen, wenn wirklich geklickt wird. */
      klickPuls(punkt.x, punkt.y);
      /* Erst antworten, dann klicken — siehe Kopf dieses Abschnitts. */
      taktEinmal(() => {
        try {
          el.focus({ preventScroll: true });
          echterKlick(el);
        } catch (_) {
          /* Ein fehlgeschlagener Klick nach der Antwort ist nicht mehr meldbar;
             der Agent sieht es an der nächsten Wahrnehmung. */
        }
      }, 0);
    });
    if (!frei.ok) return frei;
    return { ok: true, rolle: treffer.rolle, name: treffer.name };
  };

  /* Ein echter Klick, nicht nur el.click(). Viele moderne Bedienelemente
     (eigene Menüs, Aufklapper, Schalter aus Web-Frameworks) hören auf
     pointerdown/mousedown, nicht auf das schlichte click-Ereignis. Bis 0.4.1
     löste die Erweiterung nur focus()+click() aus und traf diese Elemente
     nicht. Jetzt läuft die Kette, die ein Mausklick eines Menschen auch
     auslöst — am Ende steht weiterhin el.click(), damit voreingestellte
     Standardhandlungen (Links, Formularknöpfe) sicher greifen. */
  const echterKlick = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const gemein = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, button: 0, buttons: 1,
    };
    const zeigerGemein = { ...gemein, pointerId: 1, pointerType: "mouse", isPrimary: true };
    try {
      el.dispatchEvent(new PointerEvent("pointerover", zeigerGemein));
      el.dispatchEvent(new PointerEvent("pointerenter", { ...zeigerGemein, bubbles: false }));
      el.dispatchEvent(new MouseEvent("mouseover", gemein));
      el.dispatchEvent(new PointerEvent("pointermove", zeigerGemein));
      el.dispatchEvent(new MouseEvent("mousemove", gemein));
      el.dispatchEvent(new PointerEvent("pointerdown", zeigerGemein));
      el.dispatchEvent(new MouseEvent("mousedown", gemein));
      el.dispatchEvent(new PointerEvent("pointerup", { ...zeigerGemein, buttons: 0 }));
      el.dispatchEvent(new MouseEvent("mouseup", { ...gemein, buttons: 0 }));
    } catch (_) {
      /* Ältere Chrome-Fassungen oder Elemente ohne PointerEvent-Unterstützung:
         Der abschließende el.click() unten trägt den Standardfall trotzdem. */
    }
    el.click();
  };

  /* Absenden. Wie beim Klick NACH der Antwort: Ein abgeschicktes Formular
     navigiert, und mit der Seite stirbt dieses Skript — die Antwort wäre sonst
     nie abgeschickt. `abgesendet:true` heißt deshalb „das Absenden ist
     ausgelöst", nicht „die Seite hat es schon verarbeitet".
     Und wie beim Klick über die Taktverwaltung: Ein Formular, das eine
     halbe Warteschlange nach dem Not-Aus noch abgeschickt wird, ist die
     folgenschwerste Handlung, die diese Datei kennt. */
  const absendenAusloesen = (el) => {
    taktEinmal(() => {
      try {
        for (const art of ["keydown", "keypress", "keyup"]) {
          el.dispatchEvent(
            new KeyboardEvent(art, {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
            })
          );
        }
      } catch (_) {
        /* Nach der Antwort nicht mehr meldbar — der Agent sieht es an der
           nächsten Wahrnehmung. */
      }
      try {
        /* Viele Formulare hören nicht auf Enter, sondern nur auf das Absenden
           selbst. requestSubmit statt submit, damit die Seite ihre eigene
           Prüfung behält. */
        const form = el.form || (el.closest ? el.closest("form") : null);
        if (form && typeof form.requestSubmit === "function") form.requestSubmit();
      } catch (_) {}
    }, 0);
  };

  /*
   * Tippen geht durch dieselbe Wache wie Klicken.
   *
   * Die Entscheidung dahinter, und der Grund dafür: Wer in ein verdecktes Feld
   * tippt, tippt genauso ins Falsche. Der Mensch hat in der Einzelfreigabe ein
   * Feld gesehen und ihm zugestimmt; liegt darüber ein Zustimmungsfenster oder
   * eine Bannerleiste, dann hat er einer Lage zugestimmt, die es nicht gibt.
   * Der Schaden ist ein anderer als beim Klick, aber er ist derselbe Bruch: Die
   * Freigabe meint etwas anderes, als sie zeigt. Und ein Feld, das kein Mensch
   * anklicken könnte, ist auch keines, in das eine Erweiterung schreiben darf.
   *
   * Die Prüfung auf Geheimfelder steht bewusst DAVOR: Sie gilt unbedingt. Ein
   * Passwortfeld bleibt auch dann verboten, wenn gar nichts darüber liegt, und
   * die Absage dafür heißt `feld_geheim` und nicht `element_covered`.
   */
  const tippen = ({ ref, epoche, text, leeren, absenden }) => {
    const z = elementAus(ref, epoche);
    if (!z.ok) return { ok: false, fehler: z.fehler };
    const { el, treffer } = z;
    if (geheim(el)) return { ok: false, fehler: "feld_geheim" };

    let ergebnis = { ok: false, fehler: "kein_eingabefeld" };
    const frei = durchDieWache(el, () => {
      ergebnis = tippenAusfuehren(el, treffer, { text, leeren, absenden });
    });
    if (!frei.ok) return frei;
    return ergebnis;
  };

  const tippenAusfuehren = (el, treffer, { text, leeren, absenden }) => {
    const wert = String(text == null ? "" : text).slice(0, 2000);
    const tag = el.tagName;
    const abgesendet = absenden === true;

    if (tag === "INPUT" || tag === "TEXTAREA") {
      /* Der native Setter, damit auch Seiten mit eigenem Zustand (React & Co.)
         die Eingabe sehen; danach die Ereignisse, die eine echte Eingabe auch
         auslöst. */
      try {
        el.focus({ preventScroll: true });
        const setter = Object.getOwnPropertyDescriptor(
          tag === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
          "value"
        );
        const neu = leeren === false ? `${el.value || ""}${wert}` : wert;
        if (setter && setter.set) setter.set.call(el, neu);
        else el.value = neu;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (_) {
        return { ok: false, fehler: "eingabe_fehlgeschlagen" };
      }
      if (abgesendet) absendenAusloesen(el);
      return { ok: true, rolle: treffer.rolle, name: treffer.name, laenge: wert.length, abgesendet };
    }

    if (el.isContentEditable) {
      try {
        el.focus({ preventScroll: true });
        if (leeren !== false) el.textContent = "";
        el.textContent = `${el.textContent || ""}${wert}`;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      } catch (_) {
        return { ok: false, fehler: "eingabe_fehlgeschlagen" };
      }
      if (abgesendet) absendenAusloesen(el);
      return { ok: true, rolle: treffer.rolle, name: treffer.name, laenge: wert.length, abgesendet };
    }

    return { ok: false, fehler: "kein_eingabefeld" };
  };

  /* ------------------------------------------------------------------ *
   * Auswählen — Listen, Ankreuz- und Optionsfelder.
   *
   * Bis hierher war eine Auswahlliste für den Agenten eine Sackgasse: lesen ja,
   * bedienen nein. Auch dieser Weg löst die Referenz über `nachschlagen` auf
   * und ist fail-closed — eine Option, die nicht eindeutig gemeint ist, wird
   * nicht geraten.
   *
   * Geheimfelder bleiben außen vor, mit demselben Grund wie beim Tippen:
   * Ablaufmonat und Kartenart sind Listen, und sie auszufüllen ist Ausfüllen
   * einer Zahlung. Deshalb steht hier `feld_geheim` — dasselbe Wort, das der
   * Ausführer beim Tippen schon kennt.
   * ------------------------------------------------------------------ */

  const AUS_WORTE = new Set([
    "false", "0", "aus", "off", "nein", "no", "unchecked", "abgewaehlt", "abgewählt",
  ]);

  const sollAn = (wert) => {
    if (wert === undefined || wert === null || wert === "") return true;
    if (wert === true || wert === false) return wert;
    return !AUS_WORTE.has(String(wert).trim().toLowerCase());
  };

  const optionstext = (o) =>
    String(o.text != null ? o.text : o.textContent || "").trim();

  /* Wert, Etikett, Stelle — in dieser Reihenfolge, weil der Wert das ist, was
     die Seite selbst benutzt. Ein Teiltreffer zählt nur, wenn er eindeutig ist:
     „Rot" darf nicht zwischen „Rot" und „Rotbraun" raten. */
  const optionFinden = (el, { wert, etikett, index }) => {
    const alle = Array.from(el.options || []);
    const waehlbar = alle.filter((o) => o && !o.disabled);
    if (!alle.length) return null;

    if (index !== undefined && index !== null && index !== "") {
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i >= alle.length) return null;
      return alle[i].disabled ? null : alle[i];
    }

    if (wert !== undefined && wert !== null && wert !== "") {
      const s = String(wert).trim();
      const genau = waehlbar.find((o) => String(o.value) === s);
      if (genau) return genau;
      const egal = waehlbar.find((o) => String(o.value).toLowerCase() === s.toLowerCase());
      if (egal) return egal;
    }

    /*
     * Die Option über ihren TEXT — den die Seite schreibt.
     *
     * Bis zum 14.08.2026 stand hier `optionstext(o).toLowerCase() === s`. Eine
     * Liste mit „Express" und „Exprеss" (mit kyrillischem е) sieht für den
     * Menschen wie zweimal dasselbe aus; für den Vergleich waren es zwei
     * verschiedene Werte, und welche der beiden der Agent traf, bestimmte die
     * Seite. Ab jetzt misst beide Seiten dieselbe Messform.
     *
     * Und weil die Messform genau das zusammenfaltet, kann der genaue Treffer
     * jetzt MEHRDEUTIG sein — das war er vorher nie. `find` nähme dann
     * stillschweigend die erste Option, also wieder die, die die Seite
     * vorn hingestellt hat. Mehrdeutig heisst deshalb: keine Auswahl. Lieber
     * benannt absagen als das Falsche anklicken.
     */
    if (etikett !== undefined && etikett !== null && etikett !== "") {
      const genau = waehlbar.filter((o) => textGleich(optionstext(o), etikett));
      if (genau.length === 1) return genau[0];
      if (genau.length > 1) return null;
      const teil = waehlbar.filter((o) => textEnthaelt(optionstext(o), etikett));
      if (teil.length === 1) return teil[0];
    }

    return null;
  };

  /* Auch das Auswählen geht durch die Wache, und aus demselben Grund wie das
     Tippen: Ein Ankreuzfeld wird über einen echten `click` bedient, und eine
     Liste, die unter einem Zustimmungsfenster liegt, hat der Mensch nicht
     gesehen, als er zustimmte. Die Reihenfolge ist dieselbe: Geheimes bleibt
     unbedingt verboten, danach entscheidet die Wache. */
  const auswaehlen = ({ ref, epoche, wert, etikett, index }) => {
    const z = elementAus(ref, epoche);
    if (!z.ok) return { ok: false, fehler: z.fehler };
    const { el, treffer } = z;
    if (geheim(el)) return { ok: false, fehler: "feld_geheim" };

    let ergebnis = { ok: false, fehler: "kein_auswahlfeld" };
    const frei = durchDieWache(el, () => {
      ergebnis = auswaehlenAusfuehren(el, treffer, { wert, etikett, index });
    });
    if (!frei.ok) return frei;
    return ergebnis;
  };

  const auswaehlenAusfuehren = (el, treffer, { wert, etikett, index }) => {
    const rolle = treffer.rolle;

    if (el.tagName === "SELECT") {
      const option = optionFinden(el, { wert, etikett, index });
      if (!option) return { ok: false, fehler: "auswahl_nicht_gefunden" };
      const gewaehlt = (optionstext(option) || String(option.value || "")).slice(0, 200);
      /* Erst antworten, dann setzen: Sprach- und Sortierlisten navigieren im
         change-Ereignis. Dann stirbt dieses Skript mit der Seite — dieselbe
         Überlegung wie beim Klick, und deshalb auch derselbe Weg über die
         Taktverwaltung: Der Not-Aus muss diese Auswahl noch abbestellen
         können. */
      taktEinmal(() => {
        try {
          el.focus({ preventScroll: true });
          /* Bei -1 hat sich die Liste seit der Antwort geändert. Dann die
             Option selbst setzen — selectedIndex = -1 würde ALLES abwählen. */
          const stelle = Array.from(el.options || []).indexOf(option);
          if (el.multiple || stelle < 0) option.selected = true;
          else el.selectedIndex = stelle;
          /* input UND change, damit auch Seiten mit eigenem Zustand
             (React & Co.) die Auswahl sehen. */
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (_) {}
      }, 0);
      return { ok: true, rolle, name: treffer.name, gewaehlt };
    }

    if (rolle === "checkbox" || rolle === "switch" || rolle === "radio") {
      const nativ = el.tagName === "INPUT";
      const ist = nativ ? el.checked === true : el.getAttribute("aria-checked") === "true";
      const soll = sollAn(wert);
      if (rolle === "radio" && !soll) {
        /* Ein Optionsfeld wählt man nicht ab, man wählt ein anderes. Lieber
           benannt absagen als so tun, als sei es geschehen. */
        return { ok: false, fehler: "auswahl_nicht_gefunden" };
      }
      const gewaehlt = soll ? "checked" : "unchecked";
      if (ist === soll) return { ok: true, rolle, name: treffer.name, gewaehlt };
      /* Auch hier über die Taktverwaltung: Ein Häkchen, das nach dem Not-Aus
         gesetzt wird, ist eine Zustimmung, die niemand gegeben hat. */
      taktEinmal(() => {
        try {
          el.focus({ preventScroll: true });
          /* Der Weg, den ein Mensch auch nimmt — er löst alle Ereignisse aus,
             die die Seite erwartet, und respektiert ein umschließendes label. */
          el.click();
        } catch (_) {}
      }, 0);
      return { ok: true, rolle, name: treffer.name, gewaehlt };
    }

    return { ok: false, fehler: "kein_auswahlfeld" };
  };

  const amBoden = () =>
    Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 2;

  const scrollen = ({ richtung, menge, ref, epoche }) => {
    const vorher = scrollY;

    if (ref) {
      const treffer = nachschlagen(ref, epoche);
      if (!treffer.ok && treffer.fehler === "stale_ref") return { ok: false, fehler: "stale_ref" };
      const tabelle = epoche ? epochen.get(epoche) : null;
      const el = tabelle && tabelle.get(String(ref));
      if (!el || !el.isConnected) return { ok: false, fehler: "element_not_found" };
      el.scrollIntoView({ block: "center", behavior: "auto" });
      zielNachfuehren();
      return { ok: true, scrolledBy: scrollY - vorher, atTop: scrollY <= 0, atBottom: amBoden() };
    }

    if (richtung === "top") scrollTo({ top: 0, behavior: "auto" });
    else if (richtung === "bottom") {
      scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
    } else {
      let schritt;
      if (typeof menge === "number" && Number.isFinite(menge)) {
        schritt = Math.min(3000, Math.max(0, Math.abs(menge)));
      } else if (menge === "half") schritt = Math.round(innerHeight / 2);
      else schritt = Math.round(innerHeight * 0.9);
      scrollBy({ top: richtung === "up" ? -schritt : schritt, behavior: "auto" });
    }
    /* Der Agent hat gescrollt, also wandert auch das freigegebene Element.
       Der Rahmen wandert mit, ohne auf ein Scroll-Ereignis zu warten. */
    zielNachfuehren();
    return { ok: true, scrolledBy: scrollY - vorher, atTop: scrollY <= 0, atBottom: amBoden() };
  };

  /* ------------------------------------------------------------------ *
   * Warten — bis die Seite so weit ist.
   *
   * Ohne diesen Weg bliebe dem Agenten nur, blind noch einmal zu lesen. Eine
   * abgelaufene Frist ist hier KEIN Fehler: „nicht erfüllt" ist ein Ergebnis,
   * und der Agent darf daraus etwas anderes schließen als aus einer Absage.
   *
   * Der Deckel auf der Frist ist keiner für den Agenten, sondern einer für die
   * Seite des Menschen: Ein Zeitgeber, der eine Stunde läuft, ist ein Leck.
   * ------------------------------------------------------------------ */

  const BEDINGUNGEN = new Set(["textPresent", "refGone", "refVisible", "urlMatches", "idle"]);
  const WARTE_TAKT = 1000; // Poll im Sekundentakt

  /* Befund M3 der Gegenlesung: Hier standen 30 Sekunden — weniger, als der
     Rahmen selbst anfordert. `waitFor` hat in net/befehle.js eine Frist von
     60 Sekunden; abzüglich der Puffer schickt der Ausführer daraus bis zu ~55
     Sekunden hierher. Alles darüber wurde kommentarlos gekappt, und die Antwort
     {ok:true, erfuellt:false} las sich am anderen Ende wie „ich habe die volle
     Zeit gewartet". Der Agent gab damit auf einer langsamen Kassenseite einen
     richtigen Plan auf, obwohl noch Budget da war.
     Der Deckel bleibt — er gehört der Seite des Menschen, nicht dem Agenten —,
     aber er liegt jetzt auf der längsten Frist der Befehlstabelle. Innerhalb
     dessen, was der Rahmen überhaupt anfordern kann, kürzt diese Seite nichts
     mehr. Und wenn doch gekürzt wird, steht es in der Antwort (`gedeckelt`). */
  const WARTE_HOECHSTFRIST = 60000;
  const RUHEZEIT = 600; // „idle" = so lange keine Änderung mehr am Baum

  const istEigen = (n) => {
    try {
      return n === host || (typeof host.contains === "function" && host.contains(n));
    } catch (_) {
      return false;
    }
  };

  const jetztUrl = () => {
    try {
      return String(location.href || "");
    } catch (_) {
      return "";
    }
  };

  const seitentext = () => {
    try {
      const w = document.body || document.documentElement;
      return String((w && (w.innerText || w.textContent)) || "");
    } catch (_) {
      return "";
    }
  };

  const warten = (n, antwort) => {
    const bedingung = String(n.bedingung || "");
    const wert = n.wert;
    if (!BEDINGUNGEN.has(bedingung)) {
      antwort({ ok: false, fehler: "unbekannte_bedingung" });
      return;
    }
    if (
      (bedingung === "textPresent" || bedingung === "urlMatches") &&
      !(typeof wert === "string" && wert.trim())
    ) {
      antwort({ ok: false, fehler: "wert_fehlt" });
      return;
    }

    /* refGone und refVisible sprechen über ein Element aus einer Wahrnehmung.
       Fail-closed wie beim Nachschlagen: Eine fremde Epoche beantworten wir
       nicht, und eine Referenz, die es nie gab, gilt nicht als „verschwunden". */
    let tabelle = null;
    if (bedingung === "refGone" || bedingung === "refVisible") {
      tabelle = n.epoche ? epochen.get(n.epoche) : null;
      if (!tabelle) {
        antwort({ ok: false, fehler: "stale_ref" });
        return;
      }
      if (!tabelle.has(String(wert || ""))) {
        antwort({ ok: false, fehler: "element_not_found" });
        return;
      }
    }

    const start = performance.now();
    const gewuenscht = Math.max(0, Number(n.fristMs) || 0) || 5000;
    const frist = Math.min(WARTE_HOECHSTFRIST, gewuenscht);
    /* Eine Kürzung, die niemand erfährt, ist eine Lüge über die Wartezeit
       (Befund M3). Beides geht deshalb in JEDE Antwort dieses Weges. */
    const gedeckelt = gewuenscht > frist;

    let letzteAenderung = start;
    let beobachter = null;
    if (bedingung === "idle") {
      if (typeof MutationObserver !== "function") {
        /* Ohne Beobachter wäre jede Ruhe geraten — und geraten wird hier nicht. */
        antwort({ ok: false, fehler: "ruhe_nicht_messbar" });
        return;
      }
      try {
        beobachter = new MutationObserver((eintraege) => {
          for (const e of eintraege) {
            /* Die eigene Anzeige ist keine Bewegung der Seite. */
            if (e && istEigen(e.target)) continue;
            letzteAenderung = performance.now();
            return;
          }
        });
        beobachter.observe(document.documentElement, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
      } catch (_) {
        antwort({ ok: false, fehler: "ruhe_nicht_messbar" });
        return;
      }
    }

    const pruefen = () => {
      switch (bedingung) {
        /* Der Text des AGENTEN im Text der SEITE, beides in der Messform.
           Vorher `toLowerCase().includes(...)`: Eine Seite, die in ihr „Ihre
           Bestellung ist eingegangen" ein Zeichen ohne Breite streut, liess
           die Wartebedingung nie eintreten. Das kostet keine Wache, aber eine
           volle Frist — und danach schliesst der Agent aus „nicht
           eingetreten" das Falsche. */
        case "textPresent":
          return textEnthaelt(seitentext(), wert);
        /* Die Adresse bleibt ausdrücklich beim schlichten Vergleich. Die
           Messform faltet sichtgleiche Fremdbuchstaben zusammen — auf einen
           WIRTSNAMEN angewandt wäre das ein Loch in der Gegenrichtung:
           `bаnk.de` mit kyrillischem а ist eine ANDERE Seite. */
        case "urlMatches":
          return jetztUrl().toLowerCase().includes(String(wert).trim().toLowerCase());
        case "refGone": {
          const el = tabelle.get(String(wert));
          return !el || !el.isConnected;
        }
        case "refVisible": {
          const el = tabelle.get(String(wert));
          if (!el || !el.isConnected) return false;
          const r = el.getBoundingClientRect();
          return sichtbar(el, r) && r.bottom >= 0 && r.top <= innerHeight;
        }
        case "idle":
          return performance.now() - letzteAenderung >= RUHEZEIT;
        default:
          return false;
      }
    };

    let uhr = null;
    /* Der Beobachter der Ruhe hängt an `document.documentElement` mit
       `subtree`. Er ist ein Takt wie jeder andere — nur einer, der von der
       Seite getaktet wird statt von der Uhr — und gehört deshalb in dieselbe
       Verwaltung. Ohne ihn dort lief er nach dem Not-Aus bis zur eigenen
       Frist weiter (Befund NOTAUS-4). */
    let beobachterGriff = null;
    const beobachterAus = () => {
      if (!beobachter) return;
      try { beobachter.disconnect(); } catch (_) {}
      beobachter = null;
    };
    if (beobachter) beobachterGriff = taktFremd(beobachterAus);

    const aufraeumen = () => {
      if (uhr) uhr.kappen();
      uhr = null;
      if (beobachterGriff) beobachterGriff.kappen();
      else beobachterAus();
      beobachterGriff = null;
    };

    const beenden = (erfuellt) => {
      aufraeumen();
      antwort({
        ok: true,
        erfuellt,
        wartezeitMs: Math.round(performance.now() - start),
        fristMs: frist,
        gedeckelt,
      });
    };

    /*
     * Der Not-Aus beendet die Warteschleife SOFORT — und zwar mit einer
     * Antwort und nicht mit Stille.
     *
     * Zwei Zusagen stossen hier aneinander: „nach dem Not-Aus liest diese
     * Seite nichts mehr" und „es gibt keinen Weg, auf dem dieses Skript stumm
     * bleibt". Beide gelten. Die Schleife hört auf zu lesen, und der Aufrufer
     * bekommt eine benannte Absage statt eines `erfuellt:false`, das wie ein
     * abgelaufenes Warten aussähe. `gestoppt` ist kein Ergebnis der Seite,
     * sondern das Ende der Sitzung, und der Agent darf daraus etwas anderes
     * schliessen als aus einer verstrichenen Frist.
     */
    const abgebrochen = () => {
      aufraeumen();
      antwort({
        ok: false,
        fehler: "gestoppt",
        wartezeitMs: Math.round(performance.now() - start),
        fristMs: frist,
        gedeckelt,
      });
    };
    const notaus = taktFremd(abgebrochen);
    /* Die eigene Anmeldung wieder abmelden, wenn die Schleife regulär endet:
       Sonst hinge an der Verwaltung eine Zusage, die längst beantwortet ist,
       und der nächste Not-Aus riefe `antwort` ein zweites Mal. Dass die
       Klammer im Nachrichtenhörer das abfängt, ist kein Grund, es hier
       falsch zu machen. */
    const fertigMelden = (tun) => (...w) => { notaus.abmelden(); tun(...w); };
    const beendenEinmal = fertigMelden(beenden);

    const runde = () => {
      let erfuellt = false;
      try {
        erfuellt = pruefen() === true;
      } catch (_) {
        erfuellt = false;
      }
      if (erfuellt) return beendenEinmal(true);
      const rest = frist - (performance.now() - start);
      if (rest <= 0) return beendenEinmal(false);
      uhr = taktEinmal(runde, Math.min(WARTE_TAKT, Math.max(10, rest)));
    };
    runde();
  };

  /* ------------------------------------------------------------------ *
   * Auslesen — gezielt statt alles.
   *
   * Gelesen wird ausschließlich aus einer Wahrnehmung: Was dort nicht stand,
   * gibt dieser Weg auch nicht heraus. Damit liest der Agent nie an der Sicht
   * vorbei, auf die sich die Freigabe des Menschen bezogen hat — und jede
   * zurückgegebene Referenz gehört zu einer Epoche, die er kennt.
   *
   * Für Geheimfelder gilt hier dasselbe wie überall: Der Name bleibt, der
   * Inhalt nie (spec-01 V10).
   * ------------------------------------------------------------------ */

  const AUSLESEGRENZE = 100;

  /* Ein Bereich wird über seine Rolle oder seine Beschriftung gefunden. Die
     Namen aus HTML und aus ARIA meinen dasselbe — „nav" und „navigation"
     dürfen den Agenten nicht auseinanderdividieren. */
  const BEREICHSSCHLUESSEL = {
    nav: "nav", navigation: "nav",
    header: "header", banner: "header",
    footer: "footer", contentinfo: "footer",
    aside: "aside", complementary: "aside",
    main: "main", form: "form", search: "search", dialog: "dialog",
    section: "region", region: "region",
  };
  const bereichsschluessel = (s) => {
    const k = String(s || "").trim().toLowerCase();
    return BEREICHSSCHLUESSEL[k] || k;
  };

  const bereichFinden = (name) => {
    const gesucht = bereichsschluessel(name);
    for (const el of document.querySelectorAll(BEREICHE)) {
      if (el.matches && !el.matches(BEREICHE)) continue;
      if (bereichsschluessel(rolleVon(el)) === gesucht) return el;
      /* Das Etikett schreibt die SEITE, der Suchtext kommt vom Agenten — also
         beides durch die Messform. Vorher zwei `toLowerCase()`: Ein Zeichen
         ohne Breite im `aria-label` genügte, damit der gesuchte Bereich nicht
         gefunden wird. */
      if (textEnthaelt(el.getAttribute("aria-label") || "", name)) return el;
    }
    return null;
  };

  /* Über die Elternkette statt über contains: Sie trägt auch dann, wenn der
     Bereich aus einer Attrappe kommt — und sie kann nicht in eine Schleife
     laufen. */
  const imBereich = (el, bereich) => {
    let p = el.parentElement;
    let tiefe = 0;
    while (p && tiefe++ < 60) {
      if (p === bereich) return true;
      p = p.parentElement;
    }
    return false;
  };

  const auslesen = ({ refs, region, felder, epoche }) => {
    const tabelle = epoche ? epochen.get(epoche) : null;
    if (!tabelle) return { ok: false, fehler: "stale_ref" };

    const eintrag = (ref, el) => {
      const w = wertVon(el);
      return {
        ref,
        rolle: rolleVon(el),
        name: nameVon(el).slice(0, 200),
        wert: w == null ? null : String(w).slice(0, 300),
      };
    };

    /* Ausdrücklich genannte Referenzen: Jede einzelne ist eine Zusage des
       Agenten, dass es sie gibt. Stimmt eine nicht, ist die ganze Antwort
       falsch — dann lieber benannt absagen als Lücken ausliefern. */
    const liste = Array.isArray(refs) ? refs : refs ? [refs] : [];
    if (liste.length) {
      const treffer = [];
      for (const r of liste.slice(0, AUSLESEGRENZE)) {
        const el = tabelle.get(String(r || ""));
        if (!el || !el.isConnected) return { ok: false, fehler: "element_not_found" };
        const rect = el.getBoundingClientRect();
        if (!sichtbar(el, rect) || rect.bottom < 0 || rect.top > innerHeight) {
          return { ok: false, fehler: "element_not_visible" };
        }
        treffer.push(eintrag(String(r), el));
      }
      return { ok: true, treffer };
    }

    /* Roh aufbewahrt und erst beim Vergleich gemessen — die Messform gehört an
       die Stelle des Vergleichs und nicht an die des Einsammelns, sonst stünde
       hier eine zweite, halbe Fassung derselben Regel. */
    const namen = (Array.isArray(felder) ? felder : felder ? [felder] : [])
      .map((f) => String(f || ""))
      .filter((f) => f.trim() !== "");
    const hatRegion = typeof region === "string" && region.trim() !== "";
    if (!hatRegion && !namen.length) return { ok: false, fehler: "nichts_angefragt" };

    let bereich = null;
    if (hatRegion) {
      bereich = bereichFinden(region);
      if (!bereich) return { ok: false, fehler: "bereich_nicht_gefunden" };
    }

    const treffer = [];
    for (const [ref, el] of tabelle) {
      if (treffer.length >= AUSLESEGRENZE) break;
      if (!el || !el.isConnected) continue;
      if (!sichtbar(el, el.getBoundingClientRect())) continue;
      if (bereich && !imBereich(el, bereich)) continue;
      const name = nameVon(el);
      /* Der Filter des AGENTEN gegen den Namen von der SEITE, beides in der
         Messform. Ein verfehlter Filter liefert weniger Treffer und nie mehr
         Rechte — die Richtung ist also die erlaubte —, aber „weniger Treffer"
         heisst hier: Der Agent liest das Feld nicht, auf das es ankommt, und
         welches das ist, entschiede sonst die Seite. */
      if (namen.length && !namen.some((f) => textEnthaelt(name, f))) continue;
      treffer.push(eintrag(ref, el));
    }
    return { ok: true, treffer };
  };

  const zustandMelden = () => ({
    ok: true,
    readyState: document.readyState,
    scrollY: Math.round(scrollY),
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: innerHeight,
    atTop: scrollY <= 0,
    atBottom: amBoden(),
    epoche: [...epochen.keys()].slice(-1)[0] || "",
    elementCount: (epochen.get([...epochen.keys()].slice(-1)[0]) || new Map()).size,
  });

  /* Notbremse: zweimal Escape in 800 ms.
   *
   * Befund 10.08.2026: Ist der Erweiterungskontext weg — Erweiterung neu
   * geladen, aktualisiert oder abgeschaltet —, wirft `chrome.runtime
   * .sendMessage` synchron („Extension context invalidated"). Der Wurf lief
   * aus dem Ereignishörer heraus in die Konsole der Seite, die niemand offen
   * hat. Der Mensch drückte zweimal Escape, sah nichts, und glaubte, gestoppt
   * zu haben. Die Wahrheit ist die umgekehrte: Ohne Erweiterung kann diese
   * Seite gar nichts mehr steuern, die Sitzung ist längst vorbei, aber genau
   * das muss er auch lesen können.
   *
   * Die Rückmeldung steht bewusst IM Overlay und nicht in der Seitenleiste:
   * Die kann geschlossen sein, und ohne Erweiterung ist sie ohnehin stumm. */
  let letztesEsc = 0;
  const aufTaste = (e) => {
    if (!e || e.key !== "Escape") return;
    const jetzt = performance.now();
    if (jetzt - letztesEsc < 800) {
      letztesEsc = 0;
      if (!notbremseSenden("esc-esc")) {
        totMelden(KONTEXT_SATZ);
        return;
      }
      /* Befund M6 vom 14.08.2026: Hier fehlte `gestoppt()`, anders als im
         Knopf-Zweig ein paar Zeilen weiter unten. Zusammen mit dem Befund,
         dass `overlay:gestoppt` bis dahin nur aus der Seitenleiste kam, hiess
         das: Bei geschlossener Seitenleiste sagte das Schild weiter „steuert
         diesen Tab", während der Klick noch landete. Wer stoppt, will sehen,
         dass gestoppt ist, und nicht auf eine Leitung warten. Erst kappen,
         dann melden. */
      gestoppt();
    } else {
      letztesEsc = jetzt;
    }
  };
  window.addEventListener("keydown", aufTaste, true);

  /* Der Stoppknopf im Schild. Er meldet dieselbe Notbremse wie Esc Esc, nur mit
     eigener Quelle (VERTRAG v3.5 §5: `overlay:notaus-knopf`, gesendet als
     `notbremse` mit `quelle: "schild"`).
     Erst kappen, dann melden: Das Zeichen springt sofort auf GESTOPPT, ohne auf
     eine Antwort des Dienstes zu warten. Wer stoppt, will sehen, dass gestoppt
     ist, und nicht auf eine Leitung warten. Erreicht die Meldung den Dienst
     gar nicht, ist die Erweiterung weg — dann ist die Sitzung ohnehin vorbei,
     und genau das steht dann im Schild. */
  const notausGedrueckt = (e) => {
    try {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    } catch (_) {}
    if (!notbremseSenden("schild")) {
      totMelden(KONTEXT_SATZ);
      return;
    }
    gestoppt();
  };
  try {
    notaus.addEventListener("click", notausGedrueckt, true);
    /* Auch auf pointerdown: Eine Seite, die ihre eigenen Klicks abfängt, darf
       die Reißleine nicht verschlucken. Ein doppeltes Auslösen kostet nichts,
       der Dienst beendet dieselbe Sitzung zweimal. */
    notaus.addEventListener("pointerdown", notausGedrueckt, true);
  } catch (_) {
    /* Ohne Ereignishörer bleibt Esc Esc. Ein Knopf, der nicht hört, wird
       weiter unten nicht angezeigt — er säße sonst als Versprechen da. */
    try { notaus.style.setProperty("display", "none", "important"); } catch (_) {}
  }

  /* Scrollt der Mensch selbst, wandert das freigegebene Element genauso wie
     beim Bildlauf des Agenten. `passive` sagt Chrome zu, dass hier nichts
     abgefangen wird — der Bildlauf der Seite bleibt flüssig. */
  window.addEventListener("scroll", zielNachfuehren, { passive: true, capture: true });

  chrome.runtime.onMessage.addListener((n, _absender, antwort) => {
    /* Live-Blocker vom 14.08.2026: `rekorderSenden` (worker.js) fragt ZUERST
       den Tab, ob dort schon ein Rekorder läuft, und spielt ihn nur ein, wenn
       niemand antwortet. Läuft eine Agentensitzung, hängt dieses Overlay im
       Tab und beantwortete `rekorder:start` in seinem Vorgabezweig mit
       `unbekannte_nachricht`. Der Worker las das als Erfolg, spielte den
       Rekorder nie ein, und der Mensch bekam einen Startknopf, der nichts tut.
       Deshalb: Auf alles mit Präfix `rekorder:` antwortet dieses Skript nicht,
       sondern gibt die Nachricht frei. Zuständig ist `rekorder.js`. */
    if (typeof n?.typ === "string" && n.typ.startsWith("rekorder:")) return false;

    /* Ein totes Overlay nimmt nichts mehr an. Es könnte den Befehl zwar
       ausführen, aber nicht mehr zeigen — und unsichtbar bedienen ist genau
       das, was hier nie passieren darf. Die Absage ist benannt, damit der
       Ausführer sie von „Tab weg" unterscheiden kann. */
    if (overlayTot) {
      antwort({ ok: false, fehler: "overlay_tot" });
      return true;
    }
    switch (n.typ) {
      case "overlay:an":
        grossSetzen(n.gross);
        anzeigen(true, n.text || SCHILD_GRUNDTEXT);
        antwort({ ok: true });
        break;
      case "overlay:aus":
        anzeigen(false);
        antwort({ ok: true });
        break;
      case "overlay:gestoppt":
        gestoppt();
        antwort({ ok: true });
        break;
      case "overlay:gross":
        grossSetzen(n.gross);
        antwort({ ok: true });
        break;
      /* Der Betriebsmodus am Zeichen (VERTRAG v3.5 §6). Ein unbekannter Wert
         ändert nichts und sagt genau das: Ein Rahmen, der eine Lage behauptet,
         die niemand gesetzt hat, wäre schlimmer als ein unveränderter. Deshalb
         steht in der Antwort, was jetzt wirklich zu sehen ist. */
      case "overlay:modus":
        antwort({ ok: true, gesetzt: modusSetzen(n.modus), modus: modusJetzt });
        break;
      case "overlay:zeiger":
        bezugMerken(n);
        zeigerAuf(n.x, n.y, n.beschriftung);
        zielRahmen(n.rect || null);
        antwort({ ok: true });
        break;
      /* Arbeit ohne Ziel sichtbar machen. Trägt kein Element und keinen
         Seiteninhalt, nur ein Muster — deshalb auf jeder Stufe erlaubt. */
      case "overlay:arbeitszeiger":
        arbeitsZeiger(String(n.muster || "arbeiten"));
        antwort({ ok: true });
        break;
      case "overlay:lesen":
        antwort({ ok: true, elemente: seiteLesen(n.grenze || 12), titel: document.title });
        break;
      /* Ab hier die Wege des Ausführers. Jeder einzelne antwortet in JEDEM
         Fall — auch mit einer Absage. Bleibt einer stumm, wartet am anderen
         Ende der Agent, bis seine Frist abläuft. */
      case "overlay:baum":
        try {
          antwort(baumErheben({ offscreen: n.offscreen === true }));
        } catch (fehler) {
          antwort({ ok: false, fehler: "leer" });
        }
        break;
      case "overlay:nachschlagen":
        try {
          antwort(nachschlagen(n.ref, n.epoche));
        } catch (fehler) {
          antwort({ ok: false, fehler: "element_not_found" });
        }
        break;
      /* Der Weg, ohne den kein aufgezeichneter Ablauf abspielbar ist (§7.1).
         Er bedient nichts und bewegt nichts — er beantwortet nur die Frage
         „welches Element ist das heute". */
      case "overlay:kaskade":
        try {
          antwort(kaskadeZuRef(n.kaskade));
        } catch (fehler) {
          antwort({ ok: false, fehler: "kaskade_gebrochen" });
        }
        break;
      case "overlay:scrollen":
        try {
          antwort(scrollen(n));
        } catch (fehler) {
          antwort({ ok: false, fehler: "element_not_found" });
        }
        break;
      case "overlay:klicken":
        try {
          antwort(klicken(n));
        } catch (fehler) {
          antwort({ ok: false, fehler: "element_not_found" });
        }
        break;
      case "overlay:tippen":
        try {
          antwort(tippen(n));
        } catch (fehler) {
          antwort({ ok: false, fehler: "eingabe_fehlgeschlagen" });
        }
        break;
      case "overlay:auswaehlen":
        try {
          antwort(auswaehlen(n));
        } catch (fehler) {
          antwort({ ok: false, fehler: "element_not_found" });
        }
        break;
      case "overlay:warten": {
        /* Der einzige Weg, der später antwortet. Die Klammer sorgt dafür, dass
           er genau einmal antwortet — ein zweiter Ruf auf `antwort` wäre in
           Chrome ein Fehler und in der Wirkung Stille. */
        let raus = false;
        const einmal = (a) => {
          if (raus) return;
          raus = true;
          antwort(a);
        };
        try {
          warten(n, einmal);
        } catch (fehler) {
          einmal({ ok: false, fehler: "leer" });
        }
        break;
      }
      case "overlay:auslesen":
        try {
          antwort(auslesen(n));
        } catch (fehler) {
          antwort({ ok: false, fehler: "element_not_found" });
        }
        break;
      case "overlay:zustand":
        try {
          antwort(zustandMelden());
        } catch (fehler) {
          antwort({ ok: false, fehler: "leer" });
        }
        break;
      case "overlay:ping":
        antwort({ ok: true });
        break;
      default:
        antwort({ ok: false, fehler: "unbekannte_nachricht" });
    }
    return true;
  });

  window.__smartrchromeOverlay = true;
})();
