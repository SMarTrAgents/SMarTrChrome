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
 */

(() => {
  if (window.__smartrchromeOverlay) return;

  const GRUEN = "#2aff2a";
  const DUNKEL = "#030612";
  const CYAN = "#00d4ff";
  const ROT = "#ff5d73";

  const host = document.createElement("div");
  host.id = "smartrchrome-host";
  /* Jede Deklaration mit !important, und display/visibility/opacity ausdrücklich
     dazu. Grund, im echten Chrome gemessen: Ohne !important genügte der Seite
     ein `#smartrchrome-host{display:none!important}` oder schlicht
     `*{display:none!important}`, um den grünen Rahmen, das Schild und den
     Agentenzeiger vollständig abzuschalten — der Agent bediente weiter, nur
     eben unsichtbar. Damit fiel genau die Zusage, für die es dieses Overlay
     gibt. Ein Inline-Stil mit !important steht in der Autoren-Kaskade über
     jeder Regel aus einem Seiten-Stylesheet, auch über deren !important. Die
     Deckkraft des Rahmens wird davon nicht berührt, die steuert `data-an` im
     Schattenbaum. */
  host.style.cssText =
    "position:fixed !important;inset:0 !important;z-index:2147483647 !important;" +
    "pointer-events:none !important;border:0 !important;margin:0 !important;" +
    "padding:0 !important;display:block !important;visibility:visible !important;" +
    "opacity:1 !important;clip-path:none !important;transform:none !important;" +
    "filter:none !important;contain:none !important;";
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
    @media (prefers-reduced-motion: no-preference) {
      .rahmen[data-an="1"] { animation: atmen 2.4s ease-in-out infinite; }
      @keyframes atmen {
        0%,100% { filter: drop-shadow(0 0 0 rgba(42,255,42,0)); }
        50%     { filter: drop-shadow(0 0 6px rgba(42,255,42,.45)); }
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
    .schild .punkt {
      width: 12px; height: 12px; border-radius: 50%;
      background: ${GRUEN}; box-shadow: 0 0 0 2px ${DUNKEL};
      flex: 0 0 auto;
    }
    .schild[data-zustand="gestoppt"] .punkt { background: ${ROT}; }

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
    @media (prefers-reduced-motion: no-preference) {
      .puls[data-an="1"] { animation: pulsRing .6s ease-out 1; }
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
  schild.innerHTML =
    '<span class="punkt"></span><span class="text"></span>';
  const zeiger = document.createElement("div");
  zeiger.className = "zeiger";
  const fahne = document.createElement("div");
  fahne.className = "fahne";
  const ziel = document.createElement("div");
  ziel.className = "ziel";
  const puls = document.createElement("div");
  puls.className = "puls";
  root.append(rahmen, ziel, puls, zeiger, fahne, schild);
  document.documentElement.appendChild(host);

  let gross = false;

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

  const anzeigen = (an, text) => {
    rahmen.setAttribute("data-an", an ? "1" : "0");
    schild.setAttribute("data-an", an ? "1" : "0");
    if (text) schild.querySelector(".text").textContent = text;
    if (an) {
      try {
        const jetzt = document.title || "";
        if (titelVorher === null && !jetzt.startsWith(TITEL_PRAEFIX)) {
          titelVorher = jetzt;
          document.title = TITEL_PRAEFIX + jetzt;
        }
      } catch (_) { /* Seiten ohne title-Zugriff: nur der Rahmen zeigt es an. */ }
    } else {
      zeiger.setAttribute("data-an", "0");
      fahne.setAttribute("data-an", "0");
      ziel.setAttribute("data-an", "0");
      puls.setAttribute("data-an", "0");
      if (titelVorher !== null) {
        try { document.title = titelVorher; } catch (_) {}
        titelVorher = null;
      }
    }
  };

  const gestoppt = () => {
    rahmen.setAttribute("data-zustand", "gestoppt");
    schild.setAttribute("data-zustand", "gestoppt");
    schild.querySelector(".text").textContent = "GESTOPPT, der Agent steuert nicht mehr";
    zeiger.setAttribute("data-an", "0");
    fahne.setAttribute("data-an", "0");
    ziel.setAttribute("data-an", "0");
    setTimeout(() => {
      rahmen.removeAttribute("data-zustand");
      schild.removeAttribute("data-zustand");
      anzeigen(false);
    }, 2200);
  };

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
  const arbeitsZeiger = (muster) => {
    const bahn = arbeitsBahn[muster] || arbeitsBahn.lesen;
    if (arbeitsLauf) { clearInterval(arbeitsLauf); arbeitsLauf = null; }
    const b = innerWidth, h = innerHeight;
    let i = 0;
    const schritt = () => {
      if (i >= bahn.length) {
        clearInterval(arbeitsLauf); arbeitsLauf = null;
        return;
      }
      const [ax, ay] = bahn[i++];
      zeigerAuf(Math.round(b * ax), Math.round(h * ay), muster);
    };
    schritt();
    arbeitsLauf = setInterval(schritt, 420);
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
    if (pulsUhr) clearTimeout(pulsUhr);
    pulsUhr = setTimeout(() => puls.setAttribute("data-an", "0"), 650);
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

  /* Felder, deren Inhalt diese Erweiterung nie ausliest — auch nicht, um ihn
     dem eigenen Agenten zu zeigen (spec-01 V10). Der Name des Feldes darf
     stehen bleiben („Passwort"), der Inhalt nie. Seit der Bedienstufe hängt
     dieselbe Liste zusätzlich vor dem Tippen: Anmelden bleibt Sache des
     Menschen.
     Befund S5: Die frühere Fassung war eine einzige Suche über name+id+
     autocomplete. Sie kannte weder PIN noch TAN noch die standardisierten
     Karten-Marken — ein Feld mit autocomplete="cc-number" ging glatt durch.
     Deshalb jetzt drei getrennte Prüfungen: die Marken als Marken, die Wörter
     als Wörter, und die Beschriftung neben dem Feld. */

  /* Die standardisierten Autocomplete-Marken (WHATWG HTML 4.10.18.7). Sie sind
     eine Liste von Marken, keine Freitextzeile — also Marke für Marke
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

  /* Befund M2 der Gegenlesung: „code" stand bis dahin in der Liste oben — und
     war damit das Wortstück mit den meisten falschen Freunden. Gemessen am
     echten Skript galten <input name="postcode">, <input name="country_code">,
     "areaCode", "promo_code", "gutscheincode" und "currency_code" alle als
     Geheimnis: Der Agent konnte die Postleitzahl einer Bestellung weder lesen
     noch ausfüllen, und die Länderwahl war eine Sackgasse mit Wiederholschleife
     (Befund M1).
     Ein „code" allein sagt nicht, um welchen Code es geht — sein Nachbar sagt
     es. Deshalb entscheidet ab hier das Wort DIREKT daneben, und nur das:
     „postcode" ist die Post, „securitycode" ist die Karte. Fail-closed bleibt
     es trotzdem — entschärft wird nur, was hier ausdrücklich steht; der nackte
     „code" einer Zwei-Faktoren-Seite und jeder unbekannte Nachbar sind geheim. */
  const CODE_HARMLOS = [
    "post", "postal", "zip", "plz",                 // Postleitzahl
    "country", "land", "laender", "länder", "iso",  // Länderkennung
    "area", "dial", "vorwahl",                      // Telefonvorwahl
    "lang", "language", "sprache", "locale",        // Sprachkennung
    "currency", "waehrung", "währung",              // Währungskennung
    "promo", "coupon", "gutschein", "rabatt", "aktions", "discount", "voucher",
    "produkt", "product", "artikel", "sku", "store", "filiale", "shop",
    "bar", "qr", "farb", "color",                   // Strichcode, Farbcode
  ];
  /* Bewusst NICHT harmlos: „phone" und „tel". „phone_code" ist auf Anmeldeseiten
     mindestens so oft der Code aus der SMS wie die Ländervorwahl — und im
     Zweifel gilt geheim. Die Vorwahl heißt in der Praxis „country_code",
     „dial_code" oder „area_code" und bleibt darüber lesbar. Ebenso wenig
     harmlos: „invite" und „referral" — ein Einladungscode ist eine Eintrittskarte,
     kein Ortsname. */

  /* Wahr, wenn in diesem Merkmal ein „code" steht, den kein harmloser Nachbar
     erklärt. Entschärft wird ausschließlich die Fuge selbst („postcode",
     „codepost") — steht der Code an einem anderen Wort, greift die Ausnahme
     nicht: „phone_verification_code" bleibt geheim, „phone_country_code" nicht. */
  const codeGeheim = (flach) => {
    if (!flach.includes("code")) return false;
    let rest = flach;
    for (const nachbar of CODE_HARMLOS) {
      rest = rest.split(`${nachbar}code`).join("|").split(`code${nachbar}`).join("|");
    }
    return rest.includes("code");
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
    const kandidaten = [
      el.getAttribute("aria-label"),
      el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? null : el.innerText,
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

  /* Die Beschriftung eines Feldes — ausdrücklich OHNE seinen Inhalt. Der Text
     IM Element (die Optionen einer Liste, die getippten Zeichen) sagt nichts
     darüber, ob das Feld geheim ist; das Etikett davor schon. Ohne diese
     Trennung wäre eine Zahlungsart-Liste mit der Option „Kreditkarte" geheim. */
  const beschriftungVon = (el) => {
    const teile = [
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.getAttribute("placeholder") || "",
    ];
    const bez = el.getAttribute("aria-labelledby");
    if (bez) {
      for (const id of bez.split(/\s+/)) {
        const n = id && document.getElementById(id);
        if (n) teile.push(n.textContent || "");
      }
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) teile.push(l.textContent || "");
    }
    /* Das umschließende <label> nur bei Eingabefeldern: Bei einer Liste stünden
       sonst deren Optionen mit im Etikett. */
    if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el.closest) {
      const um = el.closest("label");
      if (um) teile.push(um.textContent || "");
    }
    /* Jedes Stück bleibt für sich: Aneinandergehängt ergäben „Alp" und
       „Assistent" das Wortstück „pass" — ein Fund, den es nicht gibt. */
    return teile.filter(Boolean);
  };

  /* „ccNumber", „cc_number" und „cc-number" sind dasselbe Feld. Für die Wörter
     wird an Fugen und Groß/Klein getrennt, für die Wortstücke bleibt das
     Merkmal am Stück — sonst fände „ccnum" die Marke „cc-number" nicht. */
  const woerterVon = (s) =>
    String(s || "")
      .replace(/([a-zäöüß0-9])([A-ZÄÖÜ])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-zäöüß0-9]+/)
      .filter(Boolean);

  const flachVon = (s) =>
    String(s || "").toLowerCase().replace(/[^a-zäöüß0-9]+/g, "");

  const geheim = (el) => {
    /* Nur Dinge, die überhaupt einen Inhalt tragen oder einen annehmen können.
       Ein Absatz mit dem Wort „Passwort" ist kein Geheimfeld. */
    const tag = el.tagName;
    const traegtInhalt =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
    if (!traegtInhalt) return false;

    if ((el.getAttribute("type") || "").toLowerCase() === "password") return true;
    if (String(el.type || "").toLowerCase() === "password") return true;

    for (const marke of String(el.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/)) {
      if (!marke) continue;
      if (GEHEIME_MARKEN.has(marke)) return true;
      if (marke.startsWith("cc-")) return true; // die ganze Karten-Familie
    }

    const merkmale = [
      el.name || "",
      el.id || "",
      el.getAttribute("name") || "",
      el.getAttribute("autocomplete") || "",
      ...beschriftungVon(el),
    ];

    for (const m of merkmale) {
      for (const wort of woerterVon(m)) {
        if (GEHEIM_WORT.has(wort)) return true;
      }
      const flach = flachVon(m);
      if (flach && GEHEIM_TEIL.some((t) => flach.includes(t))) return true;
      /* Jedes Merkmal für sich, wie die Wortstücke auch: Eine Beschriftung
         „Gutscheincode" darf ein Feld namens „cvv" nicht harmlos machen. */
      if (flach && codeGeheim(flach)) return true;
    }
    return false;
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
    };
  };

  /* ------------------------------------------------------------------ *
   * Bedienen — klicken und tippen.
   *
   * Beide Wege lösen die Referenz über `nachschlagen` auf: unbekannte Epoche,
   * verschwundenes oder unsichtbares Element ergeben eine benannte Absage,
   * nie ein geratenes Ersatzelement. Ein Klick auf das falsche Element ist
   * schlimmer als gar keiner.
   *
   * Der Klick wird NACH der Antwort ausgelöst (setTimeout 0): Löst er eine
   * Navigation aus, stirbt dieses Skript mit der Seite — die Antwort wäre
   * sonst nie abgeschickt, und der Agent läse „keine Antwort vom Browser",
   * obwohl der Klick stattgefunden hat.
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

  const klicken = ({ ref, epoche }) => {
    const z = elementAus(ref, epoche);
    if (!z.ok) return { ok: false, fehler: z.fehler };
    const { el, treffer } = z;
    /* Der Puls am Klickpunkt sagt „jetzt ist etwas passiert". Den Zeiger selbst
       setzt der Ausführer per overlay:zeiger, BEVOR dieser Klick kommt — so ist
       die Bewegung über die Spur prüfbar und geschieht nur nach dem Ja. */
    klickPuls(treffer.mitte && treffer.mitte.x, treffer.mitte && treffer.mitte.y);
    /* Erst antworten, dann klicken — siehe Kopf dieses Abschnitts. */
    setTimeout(() => {
      try {
        el.focus({ preventScroll: true });
        echterKlick(el);
      } catch (_) {
        /* Ein fehlgeschlagener Klick nach der Antwort ist nicht mehr meldbar;
           der Agent sieht es an der nächsten Wahrnehmung. */
      }
    }, 0);
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
     ausgelöst", nicht „die Seite hat es schon verarbeitet". */
  const absendenAusloesen = (el) => {
    setTimeout(() => {
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

  const tippen = ({ ref, epoche, text, leeren, absenden }) => {
    const z = elementAus(ref, epoche);
    if (!z.ok) return { ok: false, fehler: z.fehler };
    const { el, treffer } = z;
    if (geheim(el)) return { ok: false, fehler: "feld_geheim" };

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

    if (etikett !== undefined && etikett !== null && etikett !== "") {
      const s = String(etikett).trim().toLowerCase();
      const genau = waehlbar.find((o) => optionstext(o).toLowerCase() === s);
      if (genau) return genau;
      const teil = waehlbar.filter((o) => optionstext(o).toLowerCase().includes(s));
      if (teil.length === 1) return teil[0];
    }

    return null;
  };

  const auswaehlen = ({ ref, epoche, wert, etikett, index }) => {
    const z = elementAus(ref, epoche);
    if (!z.ok) return { ok: false, fehler: z.fehler };
    const { el, treffer } = z;
    if (geheim(el)) return { ok: false, fehler: "feld_geheim" };
    const rolle = treffer.rolle;

    if (el.tagName === "SELECT") {
      const option = optionFinden(el, { wert, etikett, index });
      if (!option) return { ok: false, fehler: "auswahl_nicht_gefunden" };
      const gewaehlt = (optionstext(option) || String(option.value || "")).slice(0, 200);
      /* Erst antworten, dann setzen: Sprach- und Sortierlisten navigieren im
         change-Ereignis. Dann stirbt dieses Skript mit der Seite — dieselbe
         Überlegung wie beim Klick. */
      setTimeout(() => {
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
      setTimeout(() => {
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
        case "textPresent":
          return seitentext().toLowerCase().includes(String(wert).trim().toLowerCase());
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
    const beenden = (erfuellt) => {
      if (uhr) clearTimeout(uhr);
      if (beobachter) {
        try {
          beobachter.disconnect();
        } catch (_) {}
      }
      antwort({
        ok: true,
        erfuellt,
        wartezeitMs: Math.round(performance.now() - start),
        fristMs: frist,
        gedeckelt,
      });
    };

    const runde = () => {
      let erfuellt = false;
      try {
        erfuellt = pruefen() === true;
      } catch (_) {
        erfuellt = false;
      }
      if (erfuellt) return beenden(true);
      const rest = frist - (performance.now() - start);
      if (rest <= 0) return beenden(false);
      uhr = setTimeout(runde, Math.min(WARTE_TAKT, Math.max(10, rest)));
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
    const etikettSuche = String(name || "").trim().toLowerCase();
    for (const el of document.querySelectorAll(BEREICHE)) {
      if (el.matches && !el.matches(BEREICHE)) continue;
      if (bereichsschluessel(rolleVon(el)) === gesucht) return el;
      const etikett = (el.getAttribute("aria-label") || "").toLowerCase();
      if (etikett && etikettSuche && etikett.includes(etikettSuche)) return el;
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

    const namen = (Array.isArray(felder) ? felder : felder ? [felder] : [])
      .map((f) => String(f || "").trim().toLowerCase())
      .filter(Boolean);
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
      if (namen.length && !namen.some((f) => name.toLowerCase().includes(f))) continue;
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

  /* Notbremse: zweimal Escape in 800 ms. */
  let letztesEsc = 0;
  const aufTaste = (e) => {
    if (e.key !== "Escape") return;
    const jetzt = performance.now();
    if (jetzt - letztesEsc < 800) {
      letztesEsc = 0;
      chrome.runtime.sendMessage({ typ: "notbremse", quelle: "esc-esc" });
    } else {
      letztesEsc = jetzt;
    }
  };
  window.addEventListener("keydown", aufTaste, true);

  chrome.runtime.onMessage.addListener((n, _absender, antwort) => {
    switch (n.typ) {
      case "overlay:an":
        grossSetzen(n.gross);
        anzeigen(true, n.text || "SMarTrAgent steuert diesen Tab, Esc Esc = Stopp");
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
      case "overlay:zeiger":
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
