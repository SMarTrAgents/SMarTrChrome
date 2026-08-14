/*
 * Prüfung der Klickwache — und zwar BEIDER Fassungen gegeneinander.
 *
 * Warum es diese Datei gibt: Am 11.08.2026 lag die Verdeckungswache fertig in
 * `src/net/befehle.js`, mit achtzehn grünen Prüfstellen darüber, und der
 * ausgelieferte Klickweg rief sie nirgends. Die Lehre daraus ist der Einbau in
 * `src/content/overlay.js` (gemessen in `overlay.test.mjs`), die Lehre aus dem
 * Einbau ist diese Datei: Es gibt die Logik jetzt zweimal — einmal als Modul
 * für den Hintergrunddienst, einmal als klassisches Skript für die fremde
 * Seite, weil ein Inhaltsskript `src/net/*.js` nicht importieren kann.
 *
 * Zwei Wachen, die in sechs Wochen verschieden entscheiden, sind schlimmer als
 * eine: Der Prüfstand misst dann die eine und der Kunde bekommt die andere.
 * Deshalb wird hier NICHT jede Fassung für sich geprüft, sondern jeder Fall
 * durch beide gefahren und das Ergebnis verglichen. Weicht eine Zeile ab, ist
 * diese Datei rot, ohne dass jemand sie anfasst.
 *
 * Der eine erlaubte Unterschied ist der Rückgabewert einer Absage: `befehle.js`
 * liefert den fertigen Satz für den Agenten, `klickwache.js` nur den NAMEN.
 * Genau dieser Zusammenhang wird mitgemessen — über `KLICK_ABSAGEN`, die
 * Tabelle, die beide verbindet.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import {
  KLICK_ABSAGEN,
  klickZielFrei as freiAusModul,
  klickFreigeben as freigebenAusModul,
  zielAmPunkt as punktAusModul,
  gehoertZuZiel as gehoertAusModul,
} from "../net/befehle.js";

const QUELLE = new URL("../content/klickwache.js", import.meta.url);

/* Das klassische Skript wird geladen, wie Chrome es lädt: in einen eigenen
   globalen Rahmen, ohne Modulsystem. Was es an `globalThis` hängt, ist das,
   was `overlay.js` später vorfindet — nichts anderes wird hier gemessen.
   Die Attrappe der Chrome-Schnittstellen (`chrome-attrappe.mjs`) hilft hier
   nicht: Diese Datei fasst keine einzige Chrome-Schnittstelle an, sie braucht
   einen Seitenbaum. Der steht deshalb weiter unten, klein und örtlich. */
const quelltext = await readFile(QUELLE, "utf8");

function wacheLaden() {
  const rahmen = { console };
  rahmen.globalThis = rahmen;
  vm.createContext(rahmen);
  vm.runInContext(quelltext, rahmen, { filename: "klickwache.js" });
  assert.ok(rahmen.SMARTR_KLICKWACHE, "klickwache.js muss an globalThis.SMARTR_KLICKWACHE hängen");
  return rahmen.SMARTR_KLICKWACHE;
}

const WACHE = wacheLaden();

/* ------------------------------------------------------------------ *
 * Ein winziger Seitenbaum — nur so viel, wie die Wache anfasst.
 *
 * Gemessen wird an Rechtecken und einer Stapelreihenfolge, nicht an einem
 * echten Layout: Die Wache selbst rechnet nichts aus, sie fragt
 * `elementFromPoint` und vergleicht Knoten. Genau diese zwei Dinge bildet der
 * Baum hier nach.
 * ------------------------------------------------------------------ */

let nummer = 0;

function knoten(tag, { rect = { left: 0, top: 0, width: 100, height: 40 }, z = 0, eltern = null } = {}) {
  const el = {
    __nr: ++nummer,
    __z: z,
    tagName: tag.toUpperCase(),
    parentNode: eltern,
    shadowRoot: null,
    getBoundingClientRect: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }),
  };
  return el;
}

/* Die Auswahl, die ein Browser an einem Punkt trifft: Wer den Punkt überdeckt,
   kommt in Frage; es gewinnt die höchste Ebene, bei gleicher Ebene der spätere
   Knoten im Baum. */
function stapel(elemente) {
  return {
    elementFromPoint(x, y) {
      let bester = null;
      elemente.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return;
        const z = Number(el.__z) || 0;
        if (!bester || z > bester.z || (z === bester.z && i > bester.i)) bester = { el, z, i };
      });
      return bester ? bester.el : null;
    },
  };
}

const SICHTFELD = { breite: 1280, hoehe: 900 };
const STIL_NORMAL = () => ({ pointerEvents: "auto" });
const STIL_TAUB = () => ({ pointerEvents: "none" });

/* ------------------------------------------------------------------ *
 * Die Fälle. Jeder wird durch BEIDE Fassungen gefahren.
 * ------------------------------------------------------------------ */

function fall(was, bauen) {
  return { was, bauen };
}

const FAELLE = [
  fall("kein Ziel: null", () => ({ ziel: null, umgebung: {} })),
  fall("kein Ziel: ein Ding ohne Rechteck", () => ({ ziel: { tagName: "DIV" }, umgebung: {} })),
  fall("kein Ziel: getBoundingClientRect ist keine Funktion", () => ({
    ziel: { getBoundingClientRect: 42 },
    umgebung: {},
  })),
  fall("keine Fläche: das Rechteck wirft", () => ({
    ziel: {
      tagName: "BUTTON",
      getBoundingClientRect() {
        throw new Error("kein Layout");
      },
    },
    umgebung: { dokument: stapel([]), sichtfeld: SICHTFELD, stil: STIL_NORMAL },
  })),
  fall("keine Fläche: Breite null", () => {
    const ziel = knoten("button", { rect: { left: 10, top: 10, width: 0, height: 30 } });
    return { ziel, umgebung: { dokument: stapel([ziel]), sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("keine Fläche: Höhe null", () => {
    const ziel = knoten("button", { rect: { left: 10, top: 10, width: 80, height: 0 } });
    return { ziel, umgebung: { dokument: stapel([ziel]), sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("keine Fläche: Maße sind keine Zahlen", () => {
    const ziel = knoten("button", { rect: { left: NaN, top: 0, width: NaN, height: NaN } });
    return { ziel, umgebung: { dokument: stapel([ziel]), sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("außerhalb: unter dem Sichtfeld", () => {
    const ziel = knoten("a", { rect: { left: 10, top: 5000, width: 100, height: 20 } });
    return { ziel, umgebung: { dokument: stapel([ziel]), sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("außerhalb: über dem Sichtfeld", () => {
    const ziel = knoten("a", { rect: { left: 10, top: -400, width: 100, height: 20 } });
    return { ziel, umgebung: { dokument: stapel([ziel]), sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("außerhalb: rechts daneben", () => {
    const ziel = knoten("a", { rect: { left: 4000, top: 10, width: 100, height: 20 } });
    return { ziel, umgebung: { dokument: stapel([ziel]), sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("klicktaub: das Ziel nimmt selbst keine Zeigerereignisse an", () => {
    const ziel = knoten("button", { rect: { left: 10, top: 10, width: 100, height: 40 } });
    return { ziel, umgebung: { dokument: stapel([ziel]), sichtfeld: SICHTFELD, stil: STIL_TAUB } };
  }),
  fall("klicktaub bleibt unentschieden, wenn die Stilabfrage wirft", () => {
    const ziel = knoten("button", { rect: { left: 10, top: 10, width: 100, height: 40 } });
    return {
      ziel,
      umgebung: {
        dokument: stapel([ziel]),
        sichtfeld: SICHTFELD,
        stil: () => {
          throw new Error("kein Stil");
        },
      },
    };
  }),
  fall("leer: gar kein Dokument in der Umgebung", () => {
    const ziel = knoten("button");
    return { ziel, umgebung: { sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("leer: das Dokument kann kein elementFromPoint", () => {
    const ziel = knoten("button");
    return { ziel, umgebung: { dokument: {}, sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("leer: an der Stelle liegt nichts", () => {
    const ziel = knoten("button", { rect: { left: 10, top: 10, width: 100, height: 40 } });
    return { ziel, umgebung: { dokument: stapel([]), sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("leer: elementFromPoint wirft", () => {
    const ziel = knoten("button");
    return {
      ziel,
      umgebung: {
        dokument: {
          elementFromPoint() {
            throw new Error("kaputt");
          },
        },
        sichtfeld: SICHTFELD,
        stil: STIL_NORMAL,
      },
    };
  }),
  fall("frei: an der Stelle liegt das Ziel selbst", () => {
    const ziel = knoten("button", { rect: { left: 40, top: 60, width: 200, height: 40 } });
    return { ziel, umgebung: { dokument: stapel([ziel]), sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("frei: an der Stelle liegt ein Kind des Ziels", () => {
    const ziel = knoten("button", { rect: { left: 40, top: 60, width: 200, height: 40 } });
    const beschriftung = knoten("span", { rect: { left: 40, top: 60, width: 200, height: 40 }, z: 1, eltern: ziel });
    return {
      ziel,
      umgebung: { dokument: stapel([ziel, beschriftung]), sichtfeld: SICHTFELD, stil: STIL_NORMAL },
    };
  }),
  fall("frei: der Knopf liegt im offenen Schattenbaum des Ziels", () => {
    const ziel = knoten("smartr-banner", { rect: { left: 0, top: 0, width: 400, height: 200 } });
    const innen = knoten("button", { rect: { left: 100, top: 60, width: 200, height: 40 } });
    innen.host = ziel; // so hängt ein Schattenkind an seinem Wirt
    ziel.shadowRoot = stapel([innen]);
    return { ziel, umgebung: { dokument: stapel([ziel]), sichtfeld: SICHTFELD, stil: STIL_NORMAL } };
  }),
  fall("verdeckt: ein durchsichtiger Überzug über der ganzen Seite", () => {
    const ziel = knoten("button", { rect: { left: 40, top: 240, width: 120, height: 38 } });
    const ueberzug = knoten("div", { rect: { left: 0, top: 0, width: 1280, height: 900 }, z: 999999 });
    return {
      ziel,
      umgebung: { dokument: stapel([ziel, ueberzug]), sichtfeld: SICHTFELD, stil: STIL_NORMAL },
    };
  }),
  fall("verdeckt: ein deckendes Banner auf der höchsten Ebene", () => {
    const ziel = knoten("button", { rect: { left: 40, top: 240, width: 120, height: 38 } });
    const banner = knoten("aside", { rect: { left: 0, top: 0, width: 1280, height: 900 }, z: 2147483647 });
    return {
      ziel,
      umgebung: { dokument: stapel([ziel, banner]), sichtfeld: SICHTFELD, stil: STIL_NORMAL },
    };
  }),
  fall("verdeckt: der Name des Überzugs trägt Steuerzeichen und ist zu lang", () => {
    const ziel = knoten("button", { rect: { left: 40, top: 240, width: 120, height: 38 } });
    const ueberzug = knoten(`d‮iv-${"x".repeat(80)}`, {
      rect: { left: 0, top: 0, width: 1280, height: 900 },
      z: 10,
    });
    return {
      ziel,
      umgebung: { dokument: stapel([ziel, ueberzug]), sichtfeld: SICHTFELD, stil: STIL_NORMAL },
    };
  }),
  fall("verdeckt: der Überzug hat gar keinen brauchbaren Namen", () => {
    const ziel = knoten("button", { rect: { left: 40, top: 240, width: 120, height: 38 } });
    const ueberzug = knoten("...", { rect: { left: 0, top: 0, width: 1280, height: 900 }, z: 10 });
    return {
      ziel,
      umgebung: { dokument: stapel([ziel, ueberzug]), sichtfeld: SICHTFELD, stil: STIL_NORMAL },
    };
  }),
  fall("verdeckt: das Zustimmungsfenster liegt im Schattenbaum eines fremden Wirts", () => {
    const ziel = knoten("button", { rect: { left: 40, top: 240, width: 120, height: 38 } });
    const fremd = knoten("cmp-host", { rect: { left: 0, top: 0, width: 1280, height: 900 }, z: 5 });
    const knopfDrin = knoten("button", { rect: { left: 0, top: 0, width: 1280, height: 900 } });
    knopfDrin.host = fremd;
    fremd.shadowRoot = stapel([knopfDrin]);
    return {
      ziel,
      umgebung: { dokument: stapel([ziel, fremd]), sichtfeld: SICHTFELD, stil: STIL_NORMAL },
    };
  }),
  fall("ohne Sichtfeld trägt elementFromPoint den Fall allein", () => {
    const ziel = knoten("a", { rect: { left: 10, top: 5000, width: 100, height: 20 } });
    return { ziel, umgebung: { dokument: stapel([ziel]), stil: STIL_NORMAL } };
  }),
  fall("ein halbes Sichtfeld zählt nicht als Sichtfeld", () => {
    const ziel = knoten("a", { rect: { left: 10, top: 5000, width: 100, height: 20 } });
    return {
      ziel,
      umgebung: { dokument: stapel([ziel]), sichtfeld: { breite: 1280 }, stil: STIL_NORMAL },
    };
  }),
  fall("ohne Stilabfrage wird pointer-events nicht geraten", () => {
    const ziel = knoten("button", { rect: { left: 40, top: 60, width: 200, height: 40 } });
    return { ziel, umgebung: { dokument: stapel([ziel]), sichtfeld: SICHTFELD } };
  }),
];

/* Ergebnisse aus dem vm-Rahmen tragen dessen eigenen Objekt-Prototyp, und
   `deepStrictEqual` vergleicht den mit. Reine Datenobjekte werden deshalb vor
   dem Vergleich hierher zurückgeholt. Knoten des Seitenbaums bleiben, was sie
   sind: Sie stammen ohnehin von hier, und genau ihre Gleichheit als Knoten ist
   die Aussage — nicht die ihrer Felder. */
function heimholen(wert) {
  if (Array.isArray(wert)) return wert.map(heimholen);
  if (!wert || typeof wert !== "object") return wert;
  if (wert.tagName || typeof wert.getBoundingClientRect === "function") return wert;
  const raus = {};
  for (const [name, inhalt] of Object.entries(wert)) raus[name] = heimholen(inhalt);
  return raus;
}

/* Der eine erlaubte Unterschied: Das Modul liefert den Satz für den Agenten,
   das Inhaltsskript den Namen. `KLICK_ABSAGEN` ist die Tabelle dazwischen —
   wer sie umschreibt, wird hier rot. */
function gleichwertig(ausModul, rohAusSkript, was) {
  const ausSkript = heimholen(rohAusSkript);
  if (ausSkript.ok === true) {
    assert.equal(ausModul.ok, true, `${was}: das Skript gibt frei, das Modul nicht`);
    assert.deepEqual(ausModul.punkt, ausSkript.punkt, `${was}: verschiedene Klickpunkte`);
    assert.equal(ausModul.gefunden, ausSkript.gefunden, `${was}: verschiedene Elemente am Punkt`);
    return ausSkript;
  }
  assert.equal(ausModul.ok, false, `${was}: das Skript sagt ab, das Modul gibt frei`);
  const name = ausSkript.name;
  assert.ok(
    KLICK_ABSAGEN[name],
    `${was}: die Wache nennt eine Absage, die es in befehle.js nicht gibt: ${name}`
  );
  const erwartet = { ok: false, ...KLICK_ABSAGEN[name] };
  if ("darueber" in ausSkript) erwartet.darueber = ausSkript.darueber;
  assert.deepEqual(ausModul, erwartet, `${was}: die beiden Fassungen entscheiden verschieden`);
  return ausSkript;
}

test("Beide Fassungen entscheiden in jedem Fall dasselbe", () => {
  for (const { was, bauen } of FAELLE) {
    const { ziel, umgebung } = bauen();
    gleichwertig(freiAusModul(ziel, umgebung), WACHE.klickZielFrei(ziel, umgebung), was);
  }
});

test("Die Fälle treffen wirklich jede Absage — sonst misst der Vergleich nichts", () => {
  /* Ein Gleichheitsvergleich über lauter freigegebenen Fällen wäre grün und
     wertlos. Deshalb zuerst: Kommt jede Absage der Tabelle überhaupt vor? */
  const gesehen = new Set();
  let freigaben = 0;
  for (const { bauen } of FAELLE) {
    const { ziel, umgebung } = bauen();
    const a = WACHE.klickZielFrei(ziel, umgebung);
    if (a.ok) freigaben += 1;
    else gesehen.add(a.name);
  }
  assert.deepEqual(
    [...gesehen].sort(),
    Object.keys(KLICK_ABSAGEN).sort(),
    "es fehlen Fälle für einzelne Absagen der Tabelle"
  );
  assert.ok(freigaben >= 3, `zu wenige freigegebene Fälle: ${freigaben}`);
});

test("Die vier Werkzeuge hängen an globalThis, und zwar als Funktionen", () => {
  for (const name of ["zielAmPunkt", "gehoertZuZiel", "klickZielFrei", "klickFreigeben"]) {
    assert.equal(typeof WACHE[name], "function", `${name} fehlt in globalThis.SMARTR_KLICKWACHE`);
  }
  /* Ein zweites Einspielen darf die Wache nicht zerbrechen: `seite.js` spielt
     nach jeder Navigation erneut ein, und ein Fehler dabei nähme dem Klickweg
     seine Wache. */
  const nochmal = wacheLaden();
  assert.equal(typeof nochmal.klickFreigeben, "function");
});

test("Das Inhaltsskript trägt den Namen der Absage, nicht den Satz für den Agenten", () => {
  /* Warum das eine eigene Prüfung ist: Der Satz geht an den Agenten und wird
     dort gemessen. Ein Inhaltsskript läuft in einer fremden Seite; was von dort
     kommt, ist Behauptung, nicht Tatsache. Sätze werden deshalb erst im
     Ausführer gesetzt, und dieser Prüfsatz hält fest, dass sie es auch bleiben. */
  const ziel = knoten("button", { rect: { left: 40, top: 240, width: 120, height: 38 } });
  const ueberzug = knoten("div", { rect: { left: 0, top: 0, width: 1280, height: 900 }, z: 9 });
  const a = WACHE.klickZielFrei(ziel, {
    dokument: stapel([ziel, ueberzug]),
    sichtfeld: SICHTFELD,
    stil: STIL_NORMAL,
  });
  assert.deepEqual(heimholen(a), { ok: false, name: "verdeckt", darueber: "div" });
  for (const feld of ["satz", "hinweis", "code", "retryable"]) {
    assert.ok(!(feld in a), `die Absage aus der Seite trägt ${feld} und damit Text für den Agenten`);
  }
});

test("zielAmPunkt: beide steigen gleich weit durch offene Schattenbäume", () => {
  /* Eine Kette aus 25 Wirten. Beide Fassungen müssen an derselben Stelle
     aufhören, sonst sieht die eine Wache ein anderes Element als die andere. */
  const kette = [];
  for (let i = 0; i < 25; i++) kette.push(knoten(`ebene-${i}`));
  for (let i = 0; i < kette.length - 1; i++) kette[i].shadowRoot = stapel([kette[i + 1]]);
  const dokument = stapel([kette[0]]);
  /* Alle Rechtecke stehen aufeinander, damit der Punkt in jeder Ebene trifft. */
  const x = 10;
  const y = 10;
  assert.equal(punktAusModul(dokument, x, y), WACHE.zielAmPunkt(dokument, x, y));
  assert.equal(WACHE.zielAmPunkt(dokument, x, y), kette[19], "nach zwanzig Ebenen ist Schluss");

  /* Ein Wirt, der sich selbst zurückgibt: Beide müssen anhalten statt zu kreisen. */
  const selbst = knoten("schleife");
  selbst.shadowRoot = { elementFromPoint: () => selbst };
  const einer = stapel([selbst]);
  assert.equal(punktAusModul(einer, x, y), WACHE.zielAmPunkt(einer, x, y));
  assert.equal(WACHE.zielAmPunkt(einer, x, y), selbst);

  /* Und die leeren Fälle. */
  assert.equal(WACHE.zielAmPunkt(null, x, y), punktAusModul(null, x, y));
  assert.equal(WACHE.zielAmPunkt({}, x, y), punktAusModul({}, x, y));
});

test("gehoertZuZiel: beide gehen denselben Weg nach oben", () => {
  const ziel = knoten("button");
  const kind = knoten("span", { eltern: ziel });
  const enkel = knoten("b", { eltern: kind });
  const fremd = knoten("div");
  const imSchatten = knoten("button");
  imSchatten.host = ziel;

  const ring = knoten("div");
  ring.parentNode = ring; // eine Seite, die sich selbst als Elternteil ausgibt

  const paare = [
    [ziel, ziel, true],
    [ziel, kind, true],
    [ziel, enkel, true],
    [ziel, imSchatten, true],
    [ziel, fremd, false],
    [ziel, null, false],
    [null, kind, false],
    [null, null, false],
    [ziel, ring, false],
  ];
  for (const [z, k, erwartet] of paare) {
    const a = gehoertAusModul(z, k);
    const b = WACHE.gehoertZuZiel(z, k);
    assert.equal(a, b, "die beiden Fassungen antworten verschieden");
    assert.equal(b, erwartet);
  }
});

test("klickFreigeben: der Auslöser läuft ausschließlich bei einer Freigabe", () => {
  for (const { was, bauen } of FAELLE) {
    const a = bauen();
    const b = bauen();
    const laeufeModul = [];
    const laeufeSkript = [];
    const ausModul = freigebenAusModul(a.ziel, a.umgebung, (p) => laeufeModul.push(p));
    const ausSkript = WACHE.klickFreigeben(b.ziel, b.umgebung, (p) => laeufeSkript.push(p));

    assert.equal(
      laeufeModul.length,
      laeufeSkript.length,
      `${was}: die eine Fassung löst aus, die andere nicht`
    );
    assert.equal(
      laeufeSkript.length,
      ausSkript.ok ? 1 : 0,
      `${was}: der Auslöser lief ${laeufeSkript.length} mal, freigegeben war ${ausSkript.ok}`
    );
    if (ausSkript.ok) {
      assert.deepEqual(
        heimholen(laeufeSkript[0]),
        heimholen(ausSkript.punkt),
        `${was}: der Auslöser bekommt den Klickpunkt`
      );
      assert.deepEqual(laeufeModul[0], heimholen(laeufeSkript[0]), `${was}: verschiedene Klickpunkte`);
    }
  }
});

test("klickFreigeben: ohne brauchbaren Auslöser wird nichts geworfen", () => {
  /* Ein Wurf hier wäre der schlimmste Ausgang: Der Agent wartet, und die
     Absage, die ihm zusteht, käme nie an. */
  const ziel = knoten("button", { rect: { left: 40, top: 60, width: 200, height: 40 } });
  const umgebung = { dokument: stapel([ziel]), sichtfeld: SICHTFELD, stil: STIL_NORMAL };
  for (const ausloeser of [undefined, null, 42, "klick", {}]) {
    const a = WACHE.klickFreigeben(ziel, umgebung, ausloeser);
    assert.equal(a.ok, true);
    assert.deepEqual(heimholen(a), freigebenAusModul(ziel, umgebung, ausloeser));
  }
});

test("Nichts wirft, was auch immer hereingereicht wird", () => {
  const wild = [
    undefined, null, 0, "", "ziel", 42, true, [], {},
    { getBoundingClientRect: () => null },
    { getBoundingClientRect: () => ({ width: 10, height: 10, left: 0, top: 0 }) },
  ];
  for (const ziel of wild) {
    for (const umgebung of [undefined, null, {}, { dokument: null }, { sichtfeld: null }, { stil: null }]) {
      let a;
      let b;
      assert.doesNotThrow(() => {
        a = WACHE.klickZielFrei(ziel, umgebung || undefined);
      }, `klickwache.js wirft bei ${JSON.stringify(ziel)}`);
      assert.doesNotThrow(() => {
        b = freiAusModul(ziel, umgebung || undefined);
      }, `befehle.js wirft bei ${JSON.stringify(ziel)}`);
      gleichwertig(b, a, `wilde Eingabe ${String(ziel)}`);
    }
  }
});
