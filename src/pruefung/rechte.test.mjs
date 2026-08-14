/*
 * Prüfung der Seitenrechte (net/rechte.js) — Stand 11.08.2026.
 *
 * WARUM es diese Datei gibt: In rechte.js standen zwei Sicherungen, auf die
 * sich das ganze Produkt verlässt, und KEIN Prüfsatz hat sie gemessen. Beide
 * Mutationsproben blieben grün, also hätte ihr Verschwinden niemandem etwas
 * gesagt:
 *
 *  1. Die Sperre der eigenen Hosts in `musterErlaubt`. Sie ist die letzte
 *     Prüfung vor `chrome.permissions.request`. Gemessen wurde bisher nur
 *     `sperrgrund` (seitenleiste.test.mjs) — das ist die Sperre EINE Ebene
 *     höher, in der Seitenleiste. Die zweite Kopie in der Seitenleiste hielt
 *     jede Panel-Prüfung grün, während die tragende Sperre in rechte.js
 *     ungemessen blieb. Deshalb misst diese Datei `musterErlaubt` und
 *     `rechtHolen` direkt und ohne Panel.
 *  2. `alteRechteAufraeumen`. Räumt sie nicht, behält die Erweiterung dauerhaft
 *     Zugriff auf Seiten, für die ein Mensch einmal Ja gesagt hat.
 *
 * Grundsatz hier: Es wird gefahren, nicht gelesen. Jeder Prüfsatz ruft die
 * Funktion auf und misst den genauen Wert oder den genauen Aufruf an Chrome.
 * Eine Textsuche im Quelltext belegt bei einer Sicherung gar nichts.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, bevor net/* geladen wird: dienste.js liest beim
   Laden das Manifest. Sie darf danach nicht ersetzt werden, weil worker.js
   seine Zuhörer auf genau dieser Instanz registriert. */
const { chrome } = attrappeSetzen({ panelAntwortet: null });

const rechte = await import("../net/rechte.js");

/* Die echten Manifest-Rechte dieser Erweiterung. Sie stehen hier als das,
   was sie im Test sind: die Vorgabe an die Attrappe, nicht die Wahrheit über
   das Produkt. Was das echte manifest.json sagt, prüft manifest.test.mjs. */
const FESTE_RECHTE = ["https://api.smartragents.ai/*", "https://connect.smartragents.ai/*"];

/*
 * Eine Rechteverwaltung, die mitschreibt.
 *
 * `request` und `remove` protokollieren jeden Aufruf. Damit lässt sich das
 * Wichtigste prüfen: was NICHT passiert ist. Eine Sperre, die den Browser
 * trotzdem fragt und erst dessen Antwort verwirft, wäre keine Sperre.
 */
function rechteverwaltung({
  erteilt = [],
  festeRechte = FESTE_RECHTE,
  requestAntwort = true,
  removeAntwort = () => true,
  getAllWirft = false,
  manifestWirft = false,
} = {}) {
  const angefragt = [];
  const entfernt = [];
  chrome.runtime.getManifest = () => {
    if (manifestWirft) throw new Error("kein Manifest");
    return { version: "0.5.2", host_permissions: festeRechte };
  };
  chrome.permissions = {
    async getAll() {
      if (getAllWirft) throw new Error("keine Rechteauskunft");
      return { permissions: ["storage"], origins: [...erteilt] };
    },
    async request(angaben) {
      angefragt.push(...angaben.origins);
      return requestAntwort;
    },
    async remove(angaben) {
      entfernt.push(...angaben.origins);
      const antwort = removeAntwort(angaben.origins[0]);
      if (antwort instanceof Error) throw antwort;
      return antwort;
    },
  };
  return { angefragt, entfernt };
}

/* ------------------------------------------------------------------ *
 * Sicherung 1 — die Sperre der eigenen Hosts
 * ------------------------------------------------------------------ */

test("R1 — musterErlaubt sperrt den Freigabe-Ursprung selbst", () => {
  assert.equal(
    rechte.musterErlaubt("https://cloud.smartragents.ai/*"),
    false,
    "für die Freigabeseite selbst darf nie ein Seitenrecht angefragt werden (DRAHTFORMAT §7.3)"
  );
});

test("R2 — musterErlaubt sperrt jede Unterdomäne des Freigabe-Ursprungs", () => {
  assert.equal(rechte.musterErlaubt("https://beta.cloud.smartragents.ai/*"), false);
  assert.equal(rechte.musterErlaubt("https://a.b.cloud.smartragents.ai/*"), false);
});

test("R3 — musterErlaubt sperrt auch Gateway und Relay", () => {
  /* Auf beiden steht ein FESTES Manifest-Recht. Ein Agent, der dort Skripte
     einspielen dürfte, läse die Antworten des eigenen Kontos mit, ohne dass
     ein Mensch jemals etwas freigegeben hätte. */
  assert.equal(rechte.musterErlaubt("https://api.smartragents.ai/*"), false);
  assert.equal(rechte.musterErlaubt("https://connect.smartragents.ai/*"), false);
  assert.equal(rechte.musterErlaubt("https://ws.connect.smartragents.ai/*"), false);
});

test("R4 — Grossschreibung hebt die Sperre nicht auf", () => {
  assert.equal(rechte.musterErlaubt("https://CLOUD.SMARTRAGENTS.AI/*"), false);
  assert.equal(rechte.musterErlaubt("https://Beta.Cloud.SmartrAgents.ai/*"), false);
});

test("R5 — der Wurzelpunkt hebt die Sperre nicht auf", () => {
  /* `cloud.smartragents.ai.` ist im DNS derselbe Server. `new URL()` behält
     den Punkt, und `u.origin` trägt ihn in das Muster hinein (panel.js,
     ursprungAus). Ohne diese Zeile holte sich die Erweiterung auf einem Tab
     unter https://cloud.smartragents.ai./ das Skriptrecht auf der eigenen
     Freigabeseite. */
  assert.equal(rechte.musterErlaubt("https://cloud.smartragents.ai./*"), false);
  assert.equal(rechte.musterErlaubt("https://api.smartragents.ai./*"), false);
  assert.equal(rechte.musterErlaubt("https://beta.cloud.smartragents.ai./*"), false);
});

test("R6 — http statt https hebt die Sperre nicht auf", () => {
  assert.equal(rechte.musterErlaubt("http://cloud.smartragents.ai/*"), false);
  assert.equal(rechte.musterErlaubt("http://beta.cloud.smartragents.ai./*"), false);
});

test("R7 — ein Port hebt die Sperre nicht auf", () => {
  assert.equal(rechte.musterErlaubt("https://cloud.smartragents.ai:443/*"), false);
  assert.equal(rechte.musterErlaubt("https://cloud.smartragents.ai:8443/*"), false);
});

test("R8 — eine kodierte Schreibweise hebt die Sperre nicht auf", () => {
  /* `%2E` ist ein Punkt. Für einen nackten Zeichenkettenvergleich sieht der
     Host fremd aus, gemeint ist unsere Seite. Was kein sauberer Hostname ist,
     wird deshalb gar nicht erst angefragt. */
  assert.equal(rechte.musterErlaubt("https://cloud%2Esmartragents.ai/*"), false);
  assert.equal(rechte.musterErlaubt("https://cloud.smartragents%2Eai/*"), false);
  assert.equal(rechte.musterErlaubt("https://boese.de@cloud.smartragents.ai/*"), false);
  assert.equal(rechte.musterErlaubt("https://cloud..smartragents.ai/*"), false);
});

test("R9 — ein Platzhaltermuster wird nie angefragt", () => {
  /* optional_host_permissions enthält https://*./* — ein Platzhalter würde
     den gesperrten Ursprung stillschweigend mit einschließen. */
  assert.equal(rechte.musterErlaubt("https://*/*"), false);
  assert.equal(rechte.musterErlaubt("https://*.smartragents.ai/*"), false);
  assert.equal(rechte.musterErlaubt("<all_urls>"), false);
  assert.equal(rechte.musterErlaubt(""), false);
  assert.equal(rechte.musterErlaubt(null), false);
  assert.equal(rechte.musterErlaubt("https://geizhals.de/preis/*"), false);
});

test("R10 — die Sperre bleibt eng: ein fremder Host mit unserem Namen darf", () => {
  /* cloud.smartragents.ai.angreifer.de gehört jemand anderem. Eine Sperre,
     die hier zuschlägt, wäre zu breit und sperrte harmlose Seiten aus. */
  assert.equal(rechte.musterErlaubt("https://cloud.smartragents.ai.angreifer.de/*"), true);
  assert.equal(rechte.musterErlaubt("https://nichtcloud.smartragents.ai.de/*"), true);
  assert.equal(rechte.musterErlaubt("https://geizhals.de/*"), true);
  assert.equal(rechte.musterErlaubt("http://localhost/*"), true);
});

test("R11 — rechtHolen fragt den Browser für einen eigenen Host GAR NICHT", () => {
  /* Der Kern der Sicherung: Es reicht nicht, die Antwort des Browsers zu
     verwerfen. Die Frage darf nicht gestellt werden — sonst stünde vor dem
     Menschen ein Chrome-Dialog, der ein Ja für unsere eigene Oberfläche
     anbietet. */
  const { angefragt } = rechteverwaltung({ requestAntwort: true });
  const gesperrt = [
    "https://cloud.smartragents.ai/*",
    "https://cloud.smartragents.ai./*",
    "https://CLOUD.SMARTRAGENTS.AI/*",
    "https://beta.cloud.smartragents.ai/*",
    "https://api.smartragents.ai/*",
    "https://connect.smartragents.ai/*",
    "http://cloud.smartragents.ai/*",
    "https://*/*",
  ];
  return Promise.all(gesperrt.map((m) => rechte.rechtHolen(m))).then((ergebnisse) => {
    for (let i = 0; i < gesperrt.length; i++) {
      assert.equal(ergebnisse[i], false, `rechtHolen muss ${gesperrt[i]} ablehnen`);
    }
    assert.deepEqual(
      angefragt,
      [],
      "chrome.permissions.request darf für einen eigenen Host nie aufgerufen werden"
    );
  });
});

test("R12 — rechtHolen fragt für eine gewöhnliche Seite genau einmal", () => {
  const { angefragt } = rechteverwaltung({ requestAntwort: true });
  return rechte.rechtHolen("https://geizhals.de/*").then((erteilt) => {
    assert.equal(erteilt, true);
    assert.deepEqual(angefragt, ["https://geizhals.de/*"]);
  });
});

test("R13 — sagt der Mensch nein, ist das Ergebnis nein und nichts weiter", () => {
  const { angefragt } = rechteverwaltung({ requestAntwort: false });
  return rechte.rechtHolen("https://geizhals.de/*").then((erteilt) => {
    assert.equal(erteilt, false);
    assert.deepEqual(angefragt, ["https://geizhals.de/*"]);
  });
});

test("R14 — sperrgrund nennt für unsere eigenen Hosts den Grund „cloud“", () => {
  assert.equal(rechte.sperrgrund("https://cloud.smartragents.ai/"), "cloud");
  assert.equal(rechte.sperrgrund("https://cloud.smartragents.ai./"), "cloud");
  assert.equal(rechte.sperrgrund("https://CLOUD.SMARTRAGENTS.AI./chat"), "cloud");
  assert.equal(rechte.sperrgrund("https://api.smartragents.ai/api/v1/link/status"), "cloud");
  assert.equal(rechte.sperrgrund("https://connect.smartragents.ai/ws/browser"), "cloud");
  assert.equal(rechte.sperrgrund("https://beta.cloud.smartragents.ai:8443/"), "cloud");
});

test("R15 — sperrgrund lässt gewöhnliche Seiten in Ruhe", () => {
  assert.equal(rechte.sperrgrund("https://cloud.smartragents.ai.angreifer.de/"), null);
  assert.equal(rechte.sperrgrund("https://geizhals.de/warenkorb"), null);
  assert.equal(rechte.sperrgrund("http://localhost:5173/"), null);
  /* IPv6 bleibt eine ganz normale Seite und nicht „gehört dem Browser". */
  assert.equal(rechte.sperrgrund("http://[::1]:5173/"), null);
});

test("R16 — bereichHost nennt keinen eigenen Host, auch nicht mit Wurzelpunkt", () => {
  assert.equal(rechte.bereichHost("https://cloud.smartragents.ai/"), "");
  assert.equal(rechte.bereichHost("https://cloud.smartragents.ai./"), "");
  assert.equal(rechte.bereichHost("https://api.smartragents.ai/"), "");
  assert.equal(rechte.bereichHost("https://connect.smartragents.ai/"), "");
  assert.equal(rechte.bereichHost("https://Geizhals.DE"), "geizhals.de");
  assert.equal(rechte.bereichHost("https://geizhals.de./"), "geizhals.de");
});

test("R17 — istGesperrterUrsprung bleibt die Ja/Nein-Frage zu sperrgrund", () => {
  for (const url of [
    "https://cloud.smartragents.ai./",
    "https://api.smartragents.ai/",
    "https://geizhals.de/",
    "chrome://extensions",
    "",
  ]) {
    assert.equal(
      rechte.istGesperrterUrsprung(url),
      rechte.sperrgrund(url) !== null,
      `istGesperrterUrsprung und sperrgrund dürfen bei ${url} nicht auseinanderlaufen`
    );
  }
});

/* ------------------------------------------------------------------ *
 * Sicherung 2 — die Rückgabe der Rechte beim Start
 * ------------------------------------------------------------------ */

test("R18 — alteRechteAufraeumen gibt jede Erteilung zurück, die nicht im Manifest steht", () => {
  const { entfernt } = rechteverwaltung({
    erteilt: [...FESTE_RECHTE, "https://geizhals.de/*", "https://amazon.de/*"],
  });
  return rechte.alteRechteAufraeumen().then((weg) => {
    assert.deepEqual(weg, ["https://geizhals.de/*", "https://amazon.de/*"]);
    assert.deepEqual(entfernt, ["https://geizhals.de/*", "https://amazon.de/*"]);
  });
});

test("R19 — alteRechteAufraeumen fasst die festen Manifest-Rechte nie an", () => {
  const { entfernt } = rechteverwaltung({
    erteilt: [...FESTE_RECHTE, "https://geizhals.de/*"],
  });
  return rechte.alteRechteAufraeumen().then(() => {
    for (const fest of FESTE_RECHTE) {
      assert.ok(
        !entfernt.includes(fest),
        `${fest} steht im Manifest und darf nicht zurückgegeben werden`
      );
    }
  });
});

test("R20 — eine störrische Erteilung darf die übrigen nicht liegen lassen", () => {
  /* chrome.permissions.remove ist alles-oder-nichts. Wurden früher alle Muster
     in EINEM Aufruf zurückgegeben, ließ ein einziger Eintrag, den der Browser
     nicht hergibt, auch alle anderen stehen — die Aufräumfunktion war genau
     dann wirkungslos, wenn wirklich etwas aufzuräumen war. */
  const { entfernt } = rechteverwaltung({
    erteilt: ["https://stoerrisch.de/*", "https://geizhals.de/*", "https://amazon.de/*"],
    removeAntwort: (muster) =>
      muster === "https://stoerrisch.de/*" ? new Error("Cannot remove required permission") : true,
  });
  return rechte.alteRechteAufraeumen().then((weg) => {
    assert.deepEqual(
      entfernt,
      ["https://stoerrisch.de/*", "https://geizhals.de/*", "https://amazon.de/*"],
      "nach dem Fehlschlag muss der Aufräumer weitermachen"
    );
    assert.deepEqual(
      weg,
      ["https://geizhals.de/*", "https://amazon.de/*"],
      "gemeldet wird nur, was wirklich weg ist"
    );
  });
});

test("R21 — was der Browser nicht hergibt, wird nicht als weggeräumt gemeldet", () => {
  rechteverwaltung({
    erteilt: ["https://geizhals.de/*"],
    removeAntwort: () => false,
  });
  return rechte.alteRechteAufraeumen().then((weg) => {
    assert.deepEqual(weg, [], "ein Rückgabewert, der mehr behauptet als geschehen ist, ist eine Lüge");
  });
});

test("R22 — ohne lesbares Manifest bleiben Gateway und Relay trotzdem stehen", () => {
  /* Ohne die zweite Bedingung über den Hostnamen wäre die Liste der festen
     Rechte leer, und der Aufräumer versuchte, sich selbst das Gateway und den
     Relay zu entziehen. */
  const { entfernt } = rechteverwaltung({
    erteilt: [...FESTE_RECHTE, "https://geizhals.de/*"],
    manifestWirft: true,
  });
  return rechte.alteRechteAufraeumen().then((weg) => {
    assert.deepEqual(entfernt, ["https://geizhals.de/*"]);
    assert.deepEqual(weg, ["https://geizhals.de/*"]);
  });
});

test("R23 — liegt nichts herum, wird auch nichts angefasst", () => {
  const { entfernt } = rechteverwaltung({ erteilt: [...FESTE_RECHTE] });
  return rechte.alteRechteAufraeumen().then((weg) => {
    assert.deepEqual(weg, []);
    assert.deepEqual(entfernt, []);
  });
});

test("R24 — schweigt die Rechteauskunft, wird nichts entfernt und nichts behauptet", () => {
  const { entfernt } = rechteverwaltung({ getAllWirft: true });
  return rechte.alteRechteAufraeumen().then((weg) => {
    assert.deepEqual(weg, []);
    assert.deepEqual(entfernt, []);
  });
});

test("R25 — eine Erteilung auf einem eigenen Host mit Port bleibt unangetastet", () => {
  const { entfernt } = rechteverwaltung({
    erteilt: ["https://api.smartragents.ai:443/*", "https://geizhals.de/*"],
    festeRechte: [],
  });
  return rechte.alteRechteAufraeumen().then((weg) => {
    assert.deepEqual(entfernt, ["https://geizhals.de/*"]);
    assert.deepEqual(weg, ["https://geizhals.de/*"]);
  });
});

/* ------------------------------------------------------------------ *
 * Der Start selbst — räumt der Hintergrunddienst wirklich auf?
 * ------------------------------------------------------------------ */

/*
 * Der Zuhörer wird GEFAHREN, nicht gelesen.
 *
 * Was hier gemessen wird, ist die Kette, auf der die ganze Datei ruht:
 * Browserstart oder Aktualisierung → Zuhörer in worker.js →
 * alteRechteAufraeumen → chrome.permissions.remove. Fällt irgendwo in dieser
 * Kette ein Glied weg, bleibt ein Seitenrecht ohne Sitzung liegen, und genau
 * das sieht danach niemand mehr.
 */
await import("../background/worker.js");

async function zuhoererFahren(ereignis) {
  const { entfernt } = rechteverwaltung({
    erteilt: [...FESTE_RECHTE, "https://geizhals.de/*"],
  });
  const zuhoerer = chrome.runtime[ereignis]._zuhoerer;
  assert.ok(zuhoerer.length > 0, `worker.js muss einen Zuhörer für ${ereignis} registrieren`);
  for (const z of zuhoerer) z({ reason: "update" });
  /* Die Zuhörer arbeiten ohne await weiter; ein Durchlauf der Warteschlange
     genügt, weil die Attrappe sofort antwortet. */
  await new Promise((fertig) => setTimeout(fertig, 0));
  await new Promise((fertig) => setTimeout(fertig, 0));
  return entfernt;
}

test("R26 — beim Browserstart wird jedes alte Seitenrecht zurückgegeben", async () => {
  const entfernt = await zuhoererFahren("onStartup");
  assert.deepEqual(
    entfernt,
    ["https://geizhals.de/*"],
    "eine Erteilung, die einen Neustart überlebt, wäre ein Recht ohne Sitzung"
  );
});

test("R27 — nach Installation oder Aktualisierung ebenso", async () => {
  const entfernt = await zuhoererFahren("onInstalled");
  assert.deepEqual(entfernt, ["https://geizhals.de/*"]);
});
