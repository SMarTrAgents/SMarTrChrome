/*
 * Prüfung von `src/net/befehle.js` — die beiden Schutztüren, die am
 * 11.08.2026 aufgefallen sind.
 *
 * 1. **Die Herunterstufung.** `bereichPasst` verglich nur den Wirt. Eine
 *    Freigabe für `https://bank.de` deckte damit `http://bank.de`: für das
 *    Auge dieselbe Adresse, in Wahrheit eine offene Leitung. Geprüft wird
 *    hier nicht „irgendeine Ablehnung", sondern der genaue Satz, den der
 *    Mensch zu hören bekommt — ein Schutz, dessen Satz sich beiläufig ändert,
 *    hört beiläufig auf, geprüft zu sein.
 *
 * 2. **Der Klick ins Blaue.** Vor einem Klick sah niemand nach, ob an der
 *    Stelle des Ziels wirklich das Ziel liegt. Liegt ein Zustimmungsfenster
 *    darüber, klickt der Agent auf etwas anderes, als der Mensch gesehen und
 *    freigegeben hat. Hier wird deshalb zweierlei gemessen: die Absage UND
 *    dass der Auslöser des Klicks kein einziges Mal gelaufen ist. Eine
 *    Ablehnung, nach der trotzdem geklickt wird, ist keine.
 *
 * Zu jeder Sperre steht ein Gegentest daneben. Eine Sperre ohne Gegentest ist
 * von „lehnt alles ab" nicht zu unterscheiden, und „lehnt alles ab" ist kein
 * Produkt.
 */

import test from "node:test";
import assert from "node:assert/strict";

const {
  hostAus,
  adresseZerlegen,
  eintragZerlegen,
  freigabeSchema,
  bereichPasst,
  bereichBefund,
  parameterPruefen,
  klickZielFrei,
  klickFreigeben,
  zielAmPunkt,
  KLICK_ABSAGEN,
} = await import("../net/befehle.js");

/* ------------------------------------------------------------------ *
 * Hilfen
 * ------------------------------------------------------------------ */

/* Eine Sitzung, wie sie nach `auth_ok` im Speicher steht: `bereich` sind die
   Wirte aus `allow`, `ursprungMuster` ist das Recht, das der Mensch im
   Browser wirklich erteilt hat — die einzige Stelle, an der ein Schema
   überhaupt vorkommt. */
function sitzung(bereich, { modus = "domains", ursprungMuster = null } = {}) {
  return { modus, bereich, ursprungMuster };
}

const HTTPS_BANK = sitzung(["bank.de"], { modus: "tab", ursprungMuster: "https://bank.de/*" });

function navigieren(url, s) {
  return parameterPruefen("navigate", { url }, { sitzung: s });
}

/* ------------------------------------------------------------------ *
 * Eine Attrappe des Seitenbaums, gerade groß genug für den
 * Verdeckungstest: Elemente mit Fläche, eine Stapelreihenfolge und
 * `elementFromPoint`, das den obersten Treffer zurückgibt — so, wie der
 * Browser selbst auswählt, wer den Klick bekommt.
 * ------------------------------------------------------------------ */

function element(tag, { x = 0, y = 0, breite = 100, hoehe = 40, zeiger = "auto" } = {}) {
  return {
    tagName: tag.toUpperCase(),
    parentNode: null,
    shadowRoot: null,
    __rahmen: { left: x, top: y, width: breite, height: hoehe },
    __stil: { pointerEvents: zeiger },
    getBoundingClientRect() {
      const r = this.__rahmen;
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    },
  };
}

/* `document` oder eine offene Schattenwurzel. Beide können dasselbe: an einem
   Punkt nachsehen. Der Unterschied ist allein, wer über `host` darüber liegt. */
function wurzel({ host = null } = {}) {
  const stapel = [];
  return {
    host,
    stapel,
    /* Später hinzugefügt heißt: liegt weiter oben. Genau so entscheidet auch
       der Browser bei gleicher Stapelebene. */
    hinzu(el, elternteil = null) {
      el.parentNode = elternteil;
      stapel.push(el);
      return el;
    },
    elementFromPoint(x, y) {
      for (let i = stapel.length - 1; i >= 0; i--) {
        const el = stapel[i];
        if (el.__stil.pointerEvents === "none") continue;
        const r = el.__rahmen;
        if (x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height) return el;
      }
      return null;
    },
  };
}

const SICHTFELD = { breite: 1000, hoehe: 800 };

function umgebungAus(dokument) {
  return { dokument, sichtfeld: SICHTFELD, stil: (el) => el.__stil };
}

/* ------------------------------------------------------------------ *
 * Auftrag 1 — das Schema gehört in den Vergleich
 * ------------------------------------------------------------------ */

test("A1 — Eine https-Freigabe deckt kein http, mit genau diesem Satz", () => {
  const e = navigieren("http://bank.de/konto", HTTPS_BANK);
  assert.equal(e.ok, false);
  assert.equal(e.code, "scope_violation_local");
  assert.equal(
    e.satz,
    "Die Adresse bank.de soll unverschlüsselt aufgerufen werden, freigegeben ist sie nur verschlüsselt. Diese Herabstufung mache ich nicht mit."
  );
  assert.equal(
    e.hinweis,
    "Dieselbe Adresse mit https:// aufrufen. Über http läse jeder im selben Netz mit, und ändern könnte er die Seite auch."
  );
  assert.equal(e.retryable, false);
  /* Und dieselbe Adresse als Standort des Tabs: Der Ausführer misst vor jedem
     Befehl, wo der Tab wirklich steht. Eine Weiterleitung auf http darf dort
     genauso wenig durchgehen. */
  assert.equal(bereichPasst("http://bank.de/konto", HTTPS_BANK), false);
  assert.equal(bereichBefund("http://bank.de/konto", HTTPS_BANK).grund, "schema");
});

test("A2 — Gegentest: dieselbe Adresse über https ist erlaubt", () => {
  const e = navigieren("https://bank.de/konto", HTTPS_BANK);
  assert.equal(e.ok, true);
  assert.equal(e.plan.host, "bank.de");
  assert.equal(bereichPasst("https://bank.de/konto", HTTPS_BANK), true);
  /* Auch die Unterseiten, mit Abfrage und Marke: Der Bereich ist der Wirt,
     nicht der Pfad. */
  assert.equal(bereichPasst("https://bank.de/konto/uebersicht?seite=2#tabelle", HTTPS_BANK), true);
});

test("A3 — Ein Eintrag darf das Schema selbst nennen, und dann gilt es", () => {
  const nurHttps = sitzung(["https://bank.de"]);
  assert.equal(bereichPasst("https://bank.de/x", nurHttps), true);
  assert.equal(bereichPasst("http://bank.de/x", nurHttps), false);
  assert.equal(bereichBefund("http://bank.de/x", nurHttps).grund, "schema");
});

test("A4 — Aufwertung ist erlaubt: http freigegeben, https aufgerufen", () => {
  /* Begründung im Quelltext: Verschlüsseln nimmt dem Mitleser die Leitung weg,
     es gibt niemandem Macht dazu. Wirt, Port und Pfad bleiben dieselben. */
  const offen = sitzung(["intranet.example"], { ursprungMuster: "http://intranet.example/*" });
  assert.equal(bereichPasst("https://intranet.example/x", offen), true);
  assert.equal(bereichPasst("http://intranet.example/x", offen), true);
  assert.equal(freigabeSchema(offen), "http");
  assert.equal(freigabeSchema(HTTPS_BANK), "https");
  assert.equal(freigabeSchema({}), null);
});

test("A5 — Nutzername im Ort: `https://bank.de@angreifer.de` ist keine Adresse", () => {
  const beute = "https://bank.de@angreifer.de/anmelden";
  assert.equal(hostAus(beute), null);
  assert.equal(adresseZerlegen(beute), null);
  assert.equal(bereichPasst(beute, HTTPS_BANK), false);
  assert.equal(bereichPasst(beute, sitzung(["angreifer.de"])), false);
  const e = navigieren(beute, HTTPS_BANK);
  assert.equal(e.ok, false);
  assert.equal(e.satz, "Das ist keine Adresse, die ich aufrufen kann.");
  /* Gegentest: derselbe Wirt ohne Nutzername ist eine ganz gewöhnliche
     Adresse — abgelehnt wird die Täuschung, nicht das Zeichen. */
  assert.equal(hostAus("https://angreifer.de/anmelden"), "angreifer.de");
});

test("A6 — Großschreibung und Wurzelpunkt sind derselbe Name, auf beiden Seiten", () => {
  assert.equal(bereichPasst("https://BANK.DE/x", HTTPS_BANK), true);
  assert.equal(bereichPasst("https://bank.de./x", HTTPS_BANK), true);
  assert.equal(bereichPasst("https://BANK.de./x", HTTPS_BANK), true);
  const grossImEintrag = sitzung(["BANK.DE."], { ursprungMuster: "https://bank.de/*" });
  assert.equal(bereichPasst("https://bank.de/x", grossImEintrag), true);
  /* Und der Gegentest, damit die Nachsicht nicht zur Blindheit wird. */
  assert.equal(bereichPasst("https://bank.de.angreifer.de/x", HTTPS_BANK), false);
});

test("A7 — Punycode gilt nur, wo die Freigabe genau diesen Namen nennt", () => {
  const getarnt = "https://xn--bnk-bld.example.de/x";
  assert.equal(bereichPasst(getarnt, sitzung(["*.example.de"])), false);
  assert.equal(bereichBefund(getarnt, sitzung(["*.example.de"])).grund, "bereich");
  assert.equal(bereichPasst(getarnt, sitzung(["xn--bnk-bld.example.de"])), true);
  /* Gegentest: eine gewöhnliche Unterseite unter demselben Platzhalter. */
  assert.equal(bereichPasst("https://shop.example.de/x", sitzung(["*.example.de"])), true);
  /* Und ein Platzhalter, der selbst Punycode trägt, deckt seine Unterseiten. */
  assert.equal(
    bereichPasst("https://shop.xn--mnchen-3ya.de/x", sitzung(["*.xn--mnchen-3ya.de"])),
    true
  );
});

test("A8 — Gemischte Schriften sehen aus wie bank.de und sind es nicht", () => {
  /* Das zweite Zeichen ist ein kyrillisches а. `new URL` wandelt den Namen in
     Punycode um, und danach ist der Unterschied nicht mehr zu übersehen. */
  const kyrillisch = "https://bаnk.de/konto";
  assert.equal(hostAus(kyrillisch), "xn--bnk-6cd.de");
  assert.notEqual(hostAus(kyrillisch), "bank.de");
  assert.equal(bereichPasst(kyrillisch, HTTPS_BANK), false);
  const e = navigieren(kyrillisch, HTTPS_BANK);
  assert.equal(e.ok, false);
  assert.equal(e.satz, "Die Adresse xn--bnk-6cd.de liegt außerhalb der Freigabe. Dorthin gehe ich nicht.");
});

test("A9 — Ein anderer Port ist ein anderer Dienst, mit genau diesem Satz", () => {
  const e = navigieren("https://bank.de:8443/konto", HTTPS_BANK);
  assert.equal(e.ok, false);
  assert.equal(e.code, "scope_violation_local");
  assert.equal(
    e.satz,
    "Die Adresse bank.de soll über den Port 8443 aufgerufen werden, und dieser Port ist nicht freigegeben. Dorthin gehe ich nicht."
  );
  assert.equal(bereichPasst("https://bank.de:8443/konto", HTTPS_BANK), false);
  /* Gegentest 1: Der voreingestellte Port ist kein eigener Port. */
  assert.equal(bereichPasst("https://bank.de:443/konto", HTTPS_BANK), true);
  /* Gegentest 2: Nennt die Freigabe den Port, gilt er. */
  const mitPort = sitzung(["bank.de:8443"], { ursprungMuster: "https://bank.de:8443/*" });
  assert.equal(bereichPasst("https://bank.de:8443/konto", mitPort), true);
  assert.equal(bereichPasst("https://bank.de/konto", mitPort), false);
});

test("A10 — Nur https und http, alles andere ist keine Adresse", () => {
  for (const beute of [
    "javascript:alert(1)",
    "javascript:fetch('https://bank.de')",
    "data:text/html,<h1>bank.de</h1>",
    "blob:https://bank.de/0f1a-2b3c",
    "file:///etc/passwd",
    "chrome://settings/passwords",
    "chrome-extension://abcdefghijklmnop/panel.html",
    "about:blank",
    "ftp://bank.de/x",
    "ws://bank.de/x",
  ]) {
    assert.equal(hostAus(beute), null, beute);
    assert.equal(adresseZerlegen(beute), null, beute);
    assert.equal(bereichPasst(beute, HTTPS_BANK), false, beute);
    const e = navigieren(beute, HTTPS_BANK);
    assert.equal(e.ok, false, beute);
    assert.equal(e.satz, "Das ist keine Adresse, die ich aufrufen kann.", beute);
  }
});

test("A11 — Wirtsnamen, die keine sind", () => {
  assert.equal(hostAus("https://bank..de/x"), null);
  assert.equal(hostAus("https://-bank.de/x"), null);
  assert.equal(hostAus("https://bank-.de/x"), null);
  assert.equal(hostAus(`https://${"a".repeat(64)}.de/x`), null);
  assert.equal(hostAus(""), null);
  assert.equal(hostAus(null), null);
  assert.equal(hostAus("bank.de/x"), null); // ohne Schema ist es keine Adresse
  /* Gegentests: das sind Namen. */
  assert.equal(hostAus(`https://${"a".repeat(63)}.de/x`), `${"a".repeat(63)}.de`);
  assert.equal(hostAus("https://my-bank.de/x"), "my-bank.de");
  assert.equal(hostAus("https://a1.bank.de/x"), "a1.bank.de");
});

test("A12 — Einträge, die keine Wirtsangabe sind, erlauben nichts", () => {
  assert.equal(eintragZerlegen("*"), null);
  assert.equal(eintragZerlegen("*.de"), null);
  assert.equal(eintragZerlegen(""), null);
  assert.equal(eintragZerlegen("javascript://bank.de"), null);
  assert.equal(eintragZerlegen("bank.de@angreifer.de"), null);
  assert.equal(bereichPasst("https://bank.de/x", sitzung(["*"])), false);
  assert.equal(bereichPasst("https://bank.de/x", sitzung(["*.de"])), false);
  assert.equal(bereichPasst("https://bank.de/x", sitzung([])), false);
  assert.equal(bereichPasst("https://bank.de/x", {}), false);
  /* Gegentest: ein Eintrag mit Pfad meint trotzdem seinen Wirt. */
  const e = eintragZerlegen("https://bank.de/konto");
  assert.deepEqual(e, { schema: "https", host: "bank.de", port: "", platzhalter: false });
});

test("A13 — Im Tab-Modus zählt genau ein Wirt, ohne Platzhalter", () => {
  const nurTab = sitzung(["*.bank.de"], { modus: "tab", ursprungMuster: "https://bank.de/*" });
  assert.equal(bereichPasst("https://shop.bank.de/x", nurTab), false);
  assert.equal(bereichPasst("https://bank.de/x", sitzung(["bank.de", "angreifer.de"], { modus: "tab" })), true);
  assert.equal(bereichPasst("https://angreifer.de/x", sitzung(["bank.de", "angreifer.de"], { modus: "tab" })), false);
  /* Gegentest: derselbe Platzhalter im Domänen-Modus deckt die Unterseite. */
  assert.equal(bereichPasst("https://shop.bank.de/x", sitzung(["*.bank.de"])), true);
});

/* ------------------------------------------------------------------ *
 * Auftrag 2 — vor dem Klick nachsehen, wer den Klick bekäme
 * ------------------------------------------------------------------ */

test("V1 — Liegt etwas über dem Ziel, wird nicht geklickt, und der Satz sagt es", () => {
  const dok = wurzel();
  const knopf = dok.hinzu(element("button", { x: 100, y: 200, breite: 200, hoehe: 50 }));
  /* Das Zustimmungsfenster kommt später, liegt also oben — genau der Fall aus
     dem Alltag: Der Mensch sieht den Knopf im Zielrahmen, der Browser gäbe
     den Klick dem Banner. */
  dok.hinzu(element("div", { x: 0, y: 150, breite: 1000, hoehe: 200 }));

  let geklickt = 0;
  const e = klickFreigeben(knopf, umgebungAus(dok), () => { geklickt += 1; });

  assert.equal(e.ok, false);
  assert.equal(e.code, "element_covered");
  assert.equal(
    e.satz,
    "Über dem Ziel liegt ein anderes Element. Ich klicke nicht, denn der Klick träfe dieses andere Element und nicht das, was der Mensch freigegeben hat."
  );
  assert.equal(
    e.hinweis,
    "Meist ist es eine Bannerleiste oder ein Zustimmungsfenster. Es zuerst schließen, dann `readPage` neu lesen und den Klick wiederholen."
  );
  assert.equal(e.retryable, true);
  assert.equal(e.darueber, "div");
  /* Der Kern des Ganzen: Der Klick hat NICHT stattgefunden. */
  assert.equal(geklickt, 0);
});

test("V2 — Gegentest: ein freies Ziel wird geklickt, genau einmal, in seiner Mitte", () => {
  const dok = wurzel();
  const knopf = dok.hinzu(element("button", { x: 100, y: 200, breite: 200, hoehe: 50 }));

  const punkte = [];
  const e = klickFreigeben(knopf, umgebungAus(dok), (p) => punkte.push(p));

  assert.equal(e.ok, true);
  assert.deepEqual(e.punkt, { x: 200, y: 225 });
  assert.equal(e.gefunden, knopf);
  assert.deepEqual(punkte, [{ x: 200, y: 225 }]);
});

test("V3 — Ein durchsichtiger Überzug über der ganzen Seite ist eine Verdeckung", () => {
  const dok = wurzel();
  const knopf = dok.hinzu(element("a", { x: 10, y: 10, breite: 80, hoehe: 20 }));
  dok.hinzu(element("div", { x: 0, y: 0, breite: 1000, hoehe: 800 }));

  let geklickt = 0;
  const e = klickFreigeben(knopf, umgebungAus(dok), () => { geklickt += 1; });
  assert.equal(e.code, "element_covered");
  assert.equal(e.satz, KLICK_ABSAGEN.verdeckt.satz);
  assert.equal(geklickt, 0);
});

test("V4 — Ein Kind des Ziels an der Stelle ist keine Verdeckung", () => {
  /* Der Alltagsfall schlechthin: ein Knopf mit einem `span` darin. Wer hier
     stur auf Gleichheit prüft, lehnt jeden zweiten Klick der Welt ab. */
  const dok = wurzel();
  const knopf = dok.hinzu(element("button", { x: 0, y: 0, breite: 200, hoehe: 40 }));
  dok.hinzu(element("span", { x: 20, y: 8, breite: 160, hoehe: 24 }), knopf);

  let geklickt = 0;
  const e = klickFreigeben(knopf, umgebungAus(dok), () => { geklickt += 1; });
  assert.equal(e.ok, true);
  assert.equal(geklickt, 1);
});

test("V5 — Im offenen Schattenbaum wird abgestiegen statt abgelehnt", () => {
  /* `document.elementFromPoint` bleibt am Wirt stehen und liefert die
     Web-Komponente. Ohne den Abstieg verweigerte die Erweiterung genau die
     Zustimmungsbanner, für die der Schattenbaum überhaupt betreten wird. */
  const dok = wurzel();
  const wirt = dok.hinzu(element("smartr-banner", { x: 0, y: 0, breite: 400, hoehe: 100 }));
  const schatten = wurzel({ host: wirt });
  wirt.shadowRoot = schatten;
  const knopf = schatten.hinzu(element("button", { x: 10, y: 10, breite: 120, hoehe: 40 }));

  assert.equal(zielAmPunkt(dok, 70, 30), knopf);

  let geklickt = 0;
  const e = klickFreigeben(knopf, umgebungAus(dok), () => { geklickt += 1; });
  assert.equal(e.ok, true);
  assert.equal(geklickt, 1);

  /* Und die Gegenprobe im selben Baum: Liegt im Schatten etwas über dem
     Knopf, gilt dieselbe Absage wie im Dokument. */
  schatten.hinzu(element("div", { x: 0, y: 0, breite: 400, hoehe: 100 }));
  let nochmal = 0;
  const f = klickFreigeben(knopf, umgebungAus(dok), () => { nochmal += 1; });
  assert.equal(f.code, "element_covered");
  assert.equal(nochmal, 0);
});

test("V6 — Außerhalb des sichtbaren Ausschnitts wird nicht geklickt", () => {
  const dok = wurzel();
  const knopf = dok.hinzu(element("button", { x: 100, y: 2400, breite: 200, hoehe: 50 }));

  let geklickt = 0;
  const e = klickFreigeben(knopf, umgebungAus(dok), () => { geklickt += 1; });
  assert.equal(e.code, "element_not_visible");
  assert.equal(
    e.satz,
    "Das Ziel liegt außerhalb des sichtbaren Ausschnitts. Auf etwas, das niemand sieht, klicke ich nicht."
  );
  assert.equal(
    e.hinweis,
    "Erst mit `scroll` und der Referenz des Elements dorthin rollen, dann den Klick wiederholen."
  );
  assert.equal(geklickt, 0);

  /* Auch nach oben und nach links hinaus, und der Gegentest am Rand. */
  const oben = dok.hinzu(element("button", { x: 100, y: -80, breite: 200, hoehe: 50 }));
  assert.equal(klickZielFrei(oben, umgebungAus(dok)).code, "element_not_visible");
  const links = dok.hinzu(element("button", { x: -300, y: 100, breite: 200, hoehe: 50 }));
  assert.equal(klickZielFrei(links, umgebungAus(dok)).code, "element_not_visible");
  const drin = dok.hinzu(element("button", { x: 900, y: 700, breite: 90, hoehe: 90 }));
  assert.equal(klickZielFrei(drin, umgebungAus(dok)).ok, true);
});

test("V7 — Ein Ziel mit abgeschalteten Zeigerereignissen bekommt seinen eigenen Satz", () => {
  const dok = wurzel();
  const unten = dok.hinzu(element("div", { x: 0, y: 0, breite: 400, hoehe: 100 }));
  const taub = dok.hinzu(element("span", { x: 10, y: 10, breite: 100, hoehe: 20, zeiger: "none" }));
  assert.equal(unten.tagName, "DIV");

  let geklickt = 0;
  const e = klickFreigeben(taub, umgebungAus(dok), () => { geklickt += 1; });
  assert.equal(e.code, "element_not_visible");
  assert.equal(
    e.satz,
    "Das Ziel nimmt selbst keine Klicks an, seine Zeigerereignisse sind abgeschaltet."
  );
  assert.equal(geklickt, 0);
  /* Gegentest: dasselbe Element mit gewöhnlichen Zeigerereignissen geht. */
  taub.__stil.pointerEvents = "auto";
  assert.equal(klickZielFrei(taub, umgebungAus(dok)).ok, true);
});

test("V8 — Ohne Fläche, ohne Element, ohne Dokument wird nichts ausgelöst", () => {
  const dok = wurzel();
  const platt = dok.hinzu(element("button", { x: 10, y: 10, breite: 0, hoehe: 0 }));

  let geklickt = 0;
  const a = klickFreigeben(platt, umgebungAus(dok), () => { geklickt += 1; });
  assert.equal(a.code, "element_not_visible");
  assert.equal(a.satz, "Das Ziel hat auf der Seite keine Fläche, auf die man klicken könnte.");

  const b = klickFreigeben(null, umgebungAus(dok), () => { geklickt += 1; });
  assert.equal(b.code, "element_not_found");
  assert.equal(b.satz, "Das Element, auf das ich klicken sollte, gibt es auf der Seite nicht mehr.");

  /* Ohne Dokument kann niemand nachsehen. Ein Test, der bei fehlendem Werkzeug
     durchwinkt, ist genau der Test, den man weglassen kann. */
  const knopf = element("button", { x: 10, y: 10, breite: 50, hoehe: 20 });
  const c = klickFreigeben(knopf, { sichtfeld: SICHTFELD }, () => { geklickt += 1; });
  assert.equal(c.code, "element_not_visible");
  assert.equal(c.satz, "An der Stelle des Ziels nimmt kein Element einen Klick an.");

  assert.equal(geklickt, 0);
});

test("V9 — Liegt an der Stelle gar nichts, gilt dasselbe", () => {
  /* Das Ziel behauptet eine Fläche, an der im Baum nichts steht: Die Seite hat
     sich zwischen Wahrnehmung und Klick bewegt. */
  const dok = wurzel();
  const geist = element("button", { x: 500, y: 500, breite: 100, hoehe: 40 });

  let geklickt = 0;
  const e = klickFreigeben(geist, umgebungAus(dok), () => { geklickt += 1; });
  assert.equal(e.code, "element_not_visible");
  assert.equal(e.satz, KLICK_ABSAGEN.leer.satz);
  assert.equal(e.retryable, true);
  assert.equal(geklickt, 0);
});
