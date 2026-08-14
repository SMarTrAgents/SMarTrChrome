/*
 * SMarTrChrome — die Verdeckungswache, dort wo geklickt wird.
 *
 * Befund vom 11.08.2026, im echten Chrome gemessen: Die Wache lag fertig in
 * `src/net/befehle.js`, mit achtzehn grünen Prüfstellen darüber, und der
 * ausgelieferte Klickweg rief sie nirgends. Über einem freigegebenen „Jetzt
 * kaufen" lag ein ganzseitiger Überzug, `document.elementFromPoint` gab
 * eindeutig den Überzug zurück, und die Erweiterung klickte trotzdem und
 * meldete Erfolg. Der Mensch gibt „Warenkorb" frei und drückt „Alle Cookies
 * annehmen", oder Schlimmeres.
 *
 * Der Grund für den Fehlschlag war eine Bauform, keine Nachlässigkeit:
 * `overlay.js` ist ein klassisches Inhaltsskript und kann `src/net/*.js`
 * überhaupt nicht importieren. Deshalb steht die Wache ab jetzt HIER, in
 * derselben Bauform wie das Overlay selbst, und hängt sich an
 * `globalThis.SMARTR_KLICKWACHE`. Eingespielt wird sie VOR `overlay.js`
 * (`src/net/seite.js`), damit sie da ist, bevor der erste Befehl ankommt.
 *
 * Die Logik ist buchstabengetreu dieselbe wie in `befehle.js`. Zwei Wachen mit
 * zwei Meinungen wären schlimmer als eine; deshalb misst
 * `src/pruefung/klickwache.test.mjs` beide Fassungen an denselben Fällen
 * gegeneinander und wird rot, sobald sie auseinanderlaufen.
 *
 * Der einzige Unterschied ist der Rückgabewert einer Absage: Hier steht der
 * NAME der Absage, nicht der fertige Satz. Der Satz geht an den Agenten und
 * gehört damit in `ausfuehrer.js`; dieses Skript läuft in einer fremden Seite,
 * und was von hier kommt, wird dort gemessen und nicht geglaubt.
 */

(() => {
  /* Wie tief in Schattenbäume abgestiegen wird. Eine Seite, die sich selbst
     tausendfach verschachtelt, hält den Tab nicht an. */
  const SCHATTEN_TIEFE = 20;

  /**
   * Fremdtext in eine Form bringen, die man gefahrlos anzeigen und
   * protokollieren kann. Gekürzt wird in der Mitte: Anfang und Ende sind für
   * das Wiedererkennen entscheidend (spec-01 §4.8, K2).
   *
   * Befund vom 14.08.2026: Hier stand bis heute eine eigene Abschrift von
   * `saeubern` samt eigener Zeichenliste, „wortgleich aus befehle.js". Genau
   * das ist am selben Tag auseinandergelaufen: Die Messform entfernt Zeichen
   * ohne eigene Breite seither ERSATZLOS, diese Abschrift ersetzte sie
   * weiterhin durch ein Leerzeichen, und damit kürzten die beiden Fassungen an
   * verschiedenen Stellen. `klickwache.test.mjs` ist daran rot geworden, und
   * das ist der einzige Grund, warum es diese Datei gibt.
   *
   * Deshalb kommt die Form ab jetzt aus der einen Quelle
   * (`src/gemeinsam/messform.js`, eingespielt VOR dieser Datei, siehe
   * `src/net/seite.js`). Eine zweite Abschrift wird hier nicht mehr
   * nachgezogen, sondern es gibt sie nicht mehr — Festlegung F4.
   */
  function anzeigename(roh, grenze) {
    const messform = globalThis.SMARTR_MESSFORM;
    /* Fehlt die eine Quelle, wird hier NICHTS ersatzweise gesäubert. Ein
       zweiter Säuberer wäre wieder die Abschrift, die dieser Kommentar gerade
       abschafft. Der Name ist reine Fehlersuche und trägt keine Entscheidung;
       ihn wegzulassen ist die ehrliche Antwort, ihn zu erfinden nicht. */
    if (!messform || typeof messform.anzeigeform !== "function") return "";
    const s = messform.anzeigeform(roh);
    if (s.length <= grenze) return s;
    if (grenze <= 1) return "…";
    const kopf = Math.ceil((grenze - 1) / 2);
    const fuss = grenze - 1 - kopf;
    return `${s.slice(0, kopf)}…${fuss > 0 ? s.slice(s.length - fuss) : ""}`;
  }

  /* Die Namen der Absagen. Sie stehen als Menge da, weil `ausfuehrer.js` sie in
     Sätze übersetzt: Kommt hier einer dazu, den dort niemand kennt, ist das ein
     stiller Verlust der Erklärung. */
  const ABSAGEN = ["kein_ziel", "keine_flaeche", "ausserhalb", "klicktaub", "leer", "verdeckt"];

  function absage(name, zusatz = {}) {
    return { ok: false, name, ...zusatz };
  }

  /**
   * Welches Element bekäme an diesem Punkt den Klick?
   *
   * Steigt durch offene Schattenbäume durch, weil `elementFromPoint` an jeder
   * Schattengrenze am Wirt stehen bleibt.
   *
   * @param {object} wurzel  `document` oder eine offene `shadowRoot`
   * @returns {object|null}
   */
  function zielAmPunkt(wurzel, x, y) {
    let gefunden = null;
    let hier = wurzel;
    for (let tiefe = 0; tiefe < SCHATTEN_TIEFE; tiefe++) {
      if (!hier || typeof hier.elementFromPoint !== "function") break;
      let treffer = null;
      try {
        treffer = hier.elementFromPoint(x, y);
      } catch (_) {
        treffer = null;
      }
      if (!treffer || treffer === gefunden) break;
      gefunden = treffer;
      hier = gefunden.shadowRoot || null; // nur OFFENE Wurzeln haben eine
    }
    return gefunden;
  }

  /**
   * Ist `knoten` das Ziel selbst oder ein Kind davon?
   *
   * Aufwärts statt `ziel.contains(knoten)`, weil `contains` an der
   * Schattengrenze aufhört: Ein Knopf IN der offenen Wurzel einer Komponente
   * wäre sonst „nicht enthalten", obwohl der Klick genau dort hingehört. Über
   * `host` geht es weiter, und das ist derselbe Weg, den auch `composedPath`
   * eines echten Ereignisses nimmt.
   */
  function gehoertZuZiel(ziel, knoten) {
    if (!ziel || !knoten) return false;
    let n = knoten;
    for (let i = 0; i < 200 && n; i++) {
      if (n === ziel) return true;
      n = n.parentNode || n.host || null;
    }
    return false;
  }

  /**
   * Der Verdeckungstest selbst.
   *
   * @param {object} ziel        das Element, dem der Mensch zugestimmt hat
   * @param {object} umgebung    { dokument, sichtfeld:{breite,hoehe}, stil }
   *                             `stil` ist `getComputedStyle`, hereingereicht.
   * @returns {{ok:true, punkt:{x:number,y:number}, gefunden:object}
   *          |{ok:false, name:string, darueber?:string}}
   */
  function klickZielFrei(ziel, umgebung = {}) {
    if (!ziel || typeof ziel.getBoundingClientRect !== "function") {
      return absage("kein_ziel");
    }

    let r = null;
    try {
      r = ziel.getBoundingClientRect();
    } catch (_) {
      r = null;
    }
    if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height) || r.width <= 0 || r.height <= 0) {
      return absage("keine_flaeche");
    }

    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return absage("keine_flaeche");

    /* Das Sichtfeld, wenn es genannt ist. Fehlt es, trägt `elementFromPoint`
       den Fall allein: Außerhalb liefert es `null`, und daraus wird eine
       Absage — nur mit dem allgemeineren Satz. */
    const sicht = umgebung.sichtfeld || {};
    const breite = Number(sicht.breite);
    const hoehe = Number(sicht.hoehe);
    if (Number.isFinite(breite) && Number.isFinite(hoehe)) {
      if (x < 0 || y < 0 || x >= breite || y >= hoehe) return absage("ausserhalb");
    }

    /* Ein Ziel, das selbst keine Zeigerereignisse annimmt, ist nicht verdeckt,
       sondern durchlässig. Der Unterschied gehört in den Satz, sonst sucht der
       Agent ein Banner, das es gar nicht gibt. */
    if (typeof umgebung.stil === "function") {
      let stil = null;
      try {
        stil = umgebung.stil(ziel);
      } catch (_) {
        stil = null;
      }
      if (stil && String(stil.pointerEvents || "") === "none") return absage("klicktaub");
    }

    const dokument = umgebung.dokument;
    if (!dokument || typeof dokument.elementFromPoint !== "function") {
      /* Ohne Nachsehen keine Freigabe. Ein Test, der bei fehlendem Werkzeug
         durchwinkt, ist genau der Test, den man weglassen kann. */
      return absage("leer");
    }

    const gefunden = zielAmPunkt(dokument, x, y);
    if (!gefunden) return absage("leer");
    if (gehoertZuZiel(ziel, gefunden)) return { ok: true, punkt: { x, y }, gefunden };

    /* Was oben liegt, wird gemeldet, aber nicht in den Satz gehoben: Es ist
       Text von der besuchten Seite. Der Name des HTML-Elements genügt zur
       Fehlersuche und trägt keinen Fremdtext. */
    const marke = anzeigename(gefunden.tagName || gefunden.nodeName || "", 40)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    return absage("verdeckt", { darueber: marke || null });
  }

  /**
   * Klicken, aber nur, wenn der Punkt wirklich dem Ziel gehört.
   *
   * Der Auslöser wird hereingereicht und ausschließlich hier aufgerufen. Das
   * ist der Unterschied zwischen einer Prüfung, die berät, und einer, die
   * schützt: Wer die Absage übersehen könnte, könnte trotzdem klicken; wer den
   * Auslöser abgibt, kann es nicht.
   */
  function klickFreigeben(ziel, umgebung, ausloesen) {
    const frei = klickZielFrei(ziel, umgebung);
    if (!frei.ok) return frei;
    if (typeof ausloesen === "function") ausloesen(frei.punkt);
    return frei;
  }

  globalThis.SMARTR_KLICKWACHE = Object.freeze({
    ABSAGEN: Object.freeze(ABSAGEN.slice()),
    zielAmPunkt,
    gehoertZuZiel,
    klickZielFrei,
    klickFreigeben,
  });
})();
