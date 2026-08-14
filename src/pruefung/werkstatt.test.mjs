/*
 * Prüfung von `src/net/werkstatt.js` — die gespeicherten Abläufe
 * (Vertrag v3.5 §7.3).
 *
 * Drei Zusagen tragen diese Datei:
 *
 *   1. **Positivliste.** Unbekannte Schritttypen, unbekannte Felder und
 *      Platzhalter, die nirgends erklärt sind, fallen als BENANNTE Absage
 *      heraus. Nicht stillschweigend weg: Ein Ablauf wird einmal angesehen
 *      und danach zwanzigmal abgespielt, und ein Feld, das beim Speichern
 *      still verschwindet, fehlt beim zwanzigsten Mal genauso.
 *   2. **Genau ein Durchgang beim Einsetzen.** Ein Wert, der selbst wie ein
 *      Platzhalter aussieht, löst keine zweite Runde aus. Sonst dürfte, wer
 *      einen Wert setzen darf, jeden anderen Wert lesen.
 *   3. **Die Ablage speichert wirklich.** Gemessen wird gegen die echte
 *      Ablage der Attrappe, nicht gegen den Rückgabewert der Funktion.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

const {
  SCHRITT_TYPEN,
  WERKSTATT_ABLAGE,
  WERKSTATT_GRENZEN,
  WORKFLOW_FELDER,
  platzhalterFuellen,
  workflowHolen,
  workflowLoeschen,
  workflowPruefen,
  workflowSchreiben,
  workflowsLesen,
} = await import("../net/werkstatt.js");

/* Der Ablauf aus dem Vertrag, Wort für Wort. Wenn das Beispiel des Vertrages
   nicht durch die eigene Prüfung kommt, stimmt eines von beiden nicht. */
const WF = {
  id: "wf_ebay_relist",
  name: "eBay: Artikel neu einstellen",
  beschreibung: "",
  version: 1,
  created: "2026-08-14T10:00:00Z",
  params: ["artikelnummer"],
  steps: [
    { type: "navigate", url: "https://www.ebay.de/sh/lst/ended", wait: "networkidle" },
    { type: "click", selector_cascade: ["[data-testid='relist']", "text=Erneut einstellen"], screenshot: "s1.webp" },
    { type: "input", selector_cascade: ["#itemnr"], value: "{{artikelnummer}}" },
    { type: "user_input_required", reason: "Login/2FA" },
  ],
};

const kopie = (o) => JSON.parse(JSON.stringify(o));

async function ausAblage(chrome) {
  const d = await chrome.storage.local.get(WERKSTATT_ABLAGE);
  return d[WERKSTATT_ABLAGE];
}

test("W1 — Das Beispiel aus dem Vertrag kommt durch die eigene Prüfung", () => {
  const e = workflowPruefen(WF);
  assert.equal(e.ok, true, e.satz);
  assert.equal(e.workflow.id, "wf_ebay_relist");
  assert.equal(e.workflow.name, "eBay: Artikel neu einstellen");
  assert.deepEqual(e.workflow.params, ["artikelnummer"]);
  assert.equal(e.workflow.steps.length, 4);
  assert.equal(e.workflow.steps[1].screenshot, "s1.webp");
  assert.equal(e.workflow.steps[3].reason, "Login/2FA");
  /* Alle Schritttypen des Vertrages sind gebaut, keiner mehr. */
  assert.deepEqual([...SCHRITT_TYPEN], [
    "navigate", "click", "dblclick", "input", "select",
    "scroll", "key", "wait", "user_input_required",
  ]);
});

test("W2 — Ein unbekannter Schritttyp ist eine benannte Absage, kein stilles Weglassen", () => {
  for (const typ of ["eval", "script", "fetch", "screenshot", "Click", "", null, undefined, 7]) {
    const wf = kopie(WF);
    wf.steps = [{ type: typ, selector_cascade: ["#a"] }];
    const e = workflowPruefen(wf);
    assert.equal(e.ok, false, String(typ));
    assert.equal(e.code, "schritt_unbekannt", String(typ));
    assert.ok(e.satz.length > 0 && e.hinweis.length > 0, String(typ));
    assert.ok(e.hinweis.includes("navigate"), String(typ));
  }
  /* Gegentest: jeder Typ der Liste kommt mit vollständigen Feldern durch. */
  const vollstaendig = {
    navigate: { type: "navigate", url: "https://x.example/" },
    click: { type: "click", selector_cascade: ["#a"] },
    dblclick: { type: "dblclick", selector_cascade: ["#a"] },
    input: { type: "input", selector_cascade: ["#a"], value: "x" },
    select: { type: "select", selector_cascade: ["#a"], label: "Deutschland" },
    scroll: { type: "scroll", direction: "down", amount: "page" },
    key: { type: "key", key: "Enter" },
    wait: { type: "wait", ms: 500 },
    user_input_required: { type: "user_input_required", reason: "Login/2FA" },
  };
  for (const typ of SCHRITT_TYPEN) {
    const wf = { ...kopie(WF), params: [], steps: [vollstaendig[typ]] };
    const e = workflowPruefen(wf);
    assert.equal(e.ok, true, `${typ}: ${e.satz || ""}`);
  }
});

test("W3 — Unbekannte Felder fallen benannt heraus, oben wie im Schritt", () => {
  const oben = workflowPruefen({ ...kopie(WF), tags: ["ebay"] });
  assert.equal(oben.ok, false);
  assert.equal(oben.code, "feld_unbekannt");
  assert.ok(oben.satz.includes("tags"));

  const wf = kopie(WF);
  wf.steps[1].javascript = "alert(1)";
  const drin = workflowPruefen(wf);
  assert.equal(drin.ok, false);
  assert.equal(drin.code, "schritt_feld_unbekannt");
  assert.ok(drin.satz.includes("javascript"));

  /* Auch ein Feld, das es an einem ANDEREN Schritttyp gibt: `url` gehört zu
     `navigate`, nicht zum Klick. */
  const wf2 = kopie(WF);
  wf2.steps[1].url = "https://woanders.example/";
  assert.equal(workflowPruefen(wf2).code, "schritt_feld_unbekannt");

  assert.deepEqual([...WORKFLOW_FELDER], ["id", "name", "beschreibung", "version", "created", "params", "steps"]);
});

test("W4 — Ein Platzhalter, den `params` nicht kennt, hält den Ablauf auf", () => {
  const wf = kopie(WF);
  wf.steps[2].value = "{{artikelnummer}} und {{gutschein}}";
  const e = workflowPruefen(wf);
  assert.equal(e.ok, false);
  assert.equal(e.code, "platzhalter_unbekannt");
  assert.ok(e.satz.includes("gutschein"));

  /* Auch in einem Feld, an das man nicht denkt: der Anker. Ein `{{x}}`, das
     nie ersetzt wird, landet sonst wörtlich als Suchausdruck auf der Seite. */
  const wf2 = kopie(WF);
  wf2.steps[1].selector_cascade = ["[data-id='{{fremd}}']"];
  assert.equal(workflowPruefen(wf2).code, "platzhalter_unbekannt");

  /* Und ein Platzhalter, dessen Name keiner ist. */
  const wf3 = kopie(WF);
  wf3.steps[2].value = "{{ }}";
  assert.equal(workflowPruefen(wf3).code, "platzhalter_ungueltig");

  /* Gegentest: derselbe Ablauf mit erklärtem Platzhalter geht durch. */
  const wf4 = kopie(WF);
  wf4.params = ["artikelnummer", "gutschein"];
  wf4.steps[2].value = "{{artikelnummer}} und {{gutschein}}";
  assert.equal(workflowPruefen(wf4).ok, true);
});

test("W5 — Kennung, Name und Schritte sind Pflicht", () => {
  const faelle = [
    ["id_ungueltig", { ...kopie(WF), id: "ebay_relist" }],
    ["id_ungueltig", { ...kopie(WF), id: "wf_EBAY" }],
    ["id_ungueltig", { ...kopie(WF), id: undefined }],
    ["name_fehlt", { ...kopie(WF), name: "" }],
    ["name_fehlt", { ...kopie(WF), name: undefined }],
    ["schritte_fehlen", { ...kopie(WF), steps: [] }],
    ["schritte_fehlen", { ...kopie(WF), steps: "nein" }],
    ["version_ungueltig", { ...kopie(WF), version: 9 }],
    ["params_ungueltig", { ...kopie(WF), params: "artikelnummer" }],
    ["params_ungueltig", { ...kopie(WF), params: ["artikel nummer"] }],
    ["workflow_ungueltig", null],
    ["workflow_ungueltig", []],
  ];
  for (const [code, roh] of faelle) {
    const e = workflowPruefen(roh);
    assert.equal(e.ok, false, code);
    assert.equal(e.code, code, `${code}: bekam ${e.code} (${e.satz})`);
  }
  /* Der Schritt, der aus §7.2 kommt: Er hält an, weil dort ein Geheimfeld
     stand. Ohne Begründung wüsste der Mensch nicht, warum. */
  const ohneGrund = kopie(WF);
  ohneGrund.steps[3] = { type: "user_input_required" };
  assert.equal(workflowPruefen(ohneGrund).code, "schritt_unvollstaendig");
});

test("W6 — Die Schritte tragen dieselben Grenzen wie die Einzelbefehle", () => {
  const mit = (schritt) => workflowPruefen({ ...kopie(WF), params: [], steps: [schritt] });

  assert.equal(mit({ type: "click", selector_cascade: [] }).code, "anker_fehlt");
  assert.equal(mit({ type: "click", selector_cascade: ["#a", ""] }).code, "anker_ungueltig");
  assert.equal(mit({ type: "click", selector_cascade: new Array(9).fill("#a") }).code, "anker_zu_viele");
  /* Der Befund vom 29.07.2026: Eine fehlende Richtung wird nicht
     stillschweigend „nach unten". */
  assert.equal(mit({ type: "scroll" }).code, "schritt_unvollstaendig");
  assert.equal(mit({ type: "scroll", direction: "links" }).code, "schritt_unvollstaendig");
  assert.equal(mit({ type: "scroll", direction: "down", amount: 99999 }).code, "schritt_ungueltig");
  assert.equal(mit({ type: "select", selector_cascade: ["#a"] }).code, "schritt_unvollstaendig");
  assert.equal(mit({ type: "select", selector_cascade: ["#a"], value: "a", index: 1 }).code, "schritt_unvollstaendig");
  assert.equal(mit({ type: "key", key: "F12" }).code, "schritt_ungueltig");
  assert.equal(mit({ type: "wait" }).code, "schritt_unvollstaendig");
  assert.equal(mit({ type: "wait", ms: 999999 }).code, "schritt_ungueltig");
  assert.equal(mit({ type: "navigate" }).code, "schritt_unvollstaendig");
  assert.equal(mit({ type: "navigate", url: "https://x.example/", wait: "sofort" }).code, "schritt_ungueltig");
  assert.equal(mit({ type: "input", selector_cascade: ["#a"] }).code, "schritt_unvollstaendig");
  assert.equal(mit({ type: "input", selector_cascade: ["#a"], value: "x".repeat(2001) }).code, "schritt_ungueltig");
  assert.equal(mit({ type: "click", selector_cascade: ["#a"], screenshot: "../../etc/passwd" }).code, "schritt_ungueltig");

  const zuViele = { ...kopie(WF), params: [], steps: new Array(WERKSTATT_GRENZEN.schritteHoechstens + 1).fill({ type: "key", key: "Tab" }) };
  assert.equal(workflowPruefen(zuViele).code, "zu_viele_schritte");
});

test("W7 — Platzhalter einsetzen, und KEINE zweite Runde", () => {
  const wf = kopie(WF);
  wf.params = ["artikelnummer", "gutschein"];
  wf.steps[2].value = "{{artikelnummer}}";
  wf.steps.push({ type: "input", selector_cascade: ["#code"], value: "Code: {{gutschein}}" });

  const e = platzhalterFuellen(wf, { artikelnummer: "{{gutschein}}", gutschein: "GEHEIM" });
  assert.equal(e.ok, true, e.satz);
  /* Der Kern: Der Wert sieht selbst wie ein Platzhalter aus und bleibt
     trotzdem Text. Würde ein zweiter Durchgang laufen, stünde hier „GEHEIM",
     und wer einen Wert setzen darf, könnte jeden anderen lesen. */
  assert.equal(e.workflow.steps[2].value, "{{gutschein}}");
  assert.equal(e.workflow.steps[4].value, "Code: GEHEIM");

  /* Ersetzt wird in JEDEM Textfeld, auch im Anker, damit nirgends ein
     ungefülltes `{{` stehen bleibt. */
  const wf2 = kopie(WF);
  wf2.steps[1].selector_cascade = ["[data-id='{{artikelnummer}}']", "text=Erneut"];
  const f = platzhalterFuellen(wf2, { artikelnummer: "4711" });
  assert.equal(f.ok, true, f.satz);
  assert.deepEqual(f.workflow.steps[1].selector_cascade, ["[data-id='4711']", "text=Erneut"]);
  /* Der ursprüngliche Ablauf bleibt unberührt: Er wird wieder abgespielt, und
     zwar mit anderen Werten. */
  assert.equal(wf2.steps[1].selector_cascade[0], "[data-id='{{artikelnummer}}']");
});

test("W8 — Fehlende und überzählige Werte sind benannte Absagen", () => {
  const fehlt = platzhalterFuellen(WF, {});
  assert.equal(fehlt.ok, false);
  assert.equal(fehlt.code, "platzhalter_fehlt");
  assert.ok(fehlt.satz.includes("artikelnummer"));

  const zuviel = platzhalterFuellen(WF, { artikelnummer: "1", gutschein: "x" });
  assert.equal(zuviel.ok, false);
  assert.equal(zuviel.code, "params_unbekannt");
  assert.ok(zuviel.satz.includes("gutschein"));

  /* Werte, die keine Zeichenketten sind, werden nicht umgedeutet. */
  const falsch = platzhalterFuellen(WF, { artikelnummer: 4711 });
  assert.equal(falsch.ok, false);
  assert.equal(falsch.code, "params_ungueltig");

  /* Und ein kaputter Ablauf wird gar nicht erst gefüllt. */
  const kaputt = platzhalterFuellen({ ...kopie(WF), steps: [{ type: "eval" }] }, { artikelnummer: "1" });
  assert.equal(kaputt.ok, false);
  assert.equal(kaputt.code, "schritt_unbekannt");
});

test("W9 — Schreiben, Holen, Löschen gehen wirklich durch die Ablage", async () => {
  const { chrome } = attrappeSetzen();

  const leer = await workflowsLesen();
  assert.deepEqual(leer, []);
  const nichts = await workflowHolen("wf_ebay_relist");
  assert.equal(nichts.ok, false);
  assert.equal(nichts.code, "workflow_not_found");

  const e = await workflowSchreiben(WF);
  assert.equal(e.ok, true, e.satz);
  const roh = await ausAblage(chrome);
  assert.ok(Array.isArray(roh) && roh.length === 1, "nichts geschrieben");
  assert.equal(roh[0].id, "wf_ebay_relist");

  /* Derselbe Name ersetzt, er verdoppelt nicht. */
  const zweite = await workflowSchreiben({ ...kopie(WF), name: "eBay: neu einstellen, Fassung 2" });
  assert.equal(zweite.ok, true);
  const nachher = await ausAblage(chrome);
  assert.equal(nachher.length, 1);
  assert.equal(nachher[0].name, "eBay: neu einstellen, Fassung 2");

  const geholt = await workflowHolen("wf_ebay_relist");
  assert.equal(geholt.ok, true);
  assert.equal(geholt.workflow.steps.length, 4);

  const weg = await workflowLoeschen("wf_ebay_relist");
  assert.equal(weg.ok, true);
  assert.deepEqual(await ausAblage(chrome), []);
  assert.deepEqual(await workflowsLesen(), []);
  assert.equal((await workflowLoeschen("wf_ebay_relist")).code, "workflow_not_found");
});

test("W10 — Ein kaputter Ablauf kommt gar nicht erst in die Ablage", async () => {
  const { chrome } = attrappeSetzen();
  const e = await workflowSchreiben({ ...kopie(WF), steps: [{ type: "eval", code: "alert(1)" }] });
  assert.equal(e.ok, false);
  assert.equal(e.code, "schritt_unbekannt");
  assert.equal(await ausAblage(chrome), undefined, "trotzdem geschrieben");

  /* Und was von Hand in die Ablage geschrieben wurde, wird beim Lesen
     gemessen: Ein Ablauf, der die Prüfung nicht besteht, wird nicht
     angeboten, denn abspielen liesse er sich ohnehin nicht. */
  attrappeSetzen({
    ablageLocal: {
      [WERKSTATT_ABLAGE]: [
        { id: "wf_gut", name: "Gut", version: 1, params: [], steps: [{ type: "key", key: "Tab" }] },
        { id: "wf_boese", name: "Böse", version: 1, params: [], steps: [{ type: "eval", code: "x" }] },
        "kaputt",
      ],
    },
  });
  const alle = await workflowsLesen();
  assert.deepEqual(alle.map((w) => w.id), ["wf_gut"]);
});

test("W11 — Ohne Browser gibt es eine Antwort, keine Ausnahme", async () => {
  const vorher = globalThis.chrome;
  globalThis.chrome = undefined;
  try {
    assert.deepEqual(await workflowsLesen(), []);
    const e = await workflowSchreiben(WF);
    assert.equal(e.ok, false);
    assert.equal(e.code, "ablage_fehler");
    assert.equal((await workflowHolen("wf_ebay_relist")).code, "workflow_not_found");
    assert.equal((await workflowLoeschen("wf_ebay_relist")).code, "workflow_not_found");
  } finally {
    globalThis.chrome = vorher;
  }
});

test("W12 — Der Zeitstempel entsteht beim Speichern, nicht beim Prüfen", () => {
  /* Prüfen muss zweimal dasselbe ergeben, auch eine Sekunde später. Sonst
     wäre eine Prüfung nicht wiederholbar, und eine nicht wiederholbare
     Prüfung ist keine Messung. */
  const ohne = { ...kopie(WF) };
  delete ohne.created;
  const a = workflowPruefen(ohne);
  const b = workflowPruefen(ohne);
  assert.deepEqual(a.workflow, b.workflow);
  assert.equal(a.workflow.created, "");
});

test("W13 — Ein `navigate` mit fremdem Schema kommt gar nicht erst in die Ablage", () => {
  /* Nachtrag 14.08.2026 (Verzahnung): Die Schemaprüfung stand nur am
     Einlesetor der Seitenleiste. Ein Ablauf, der aus dem Rekorder oder aus
     einer anderen Ecke geschrieben wird, wäre daran vorbeigelaufen — und
     `{"type":"navigate","url":"javascript:…"}` ist keine Navigation, sondern
     fremder Code mit einem Sprungbrett. Geprüft wird deshalb in der
     Positivliste selbst, durch die JEDER Ablauf muss. */
  for (const boese of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "chrome://settings",
    "  javascript:alert(1)  ",
  ]) {
    const wf = kopie(WF);
    wf.steps = [{ type: "navigate", url: boese }];
    const e = workflowPruefen(wf);
    assert.equal(e.ok, false, `durchgelassen: ${boese}`);
    assert.equal(e.code, "adresse_ungueltig", boese);
    assert.ok(e.satz, "mit einem Satz für den Menschen");
  }

  /* Und die Gegenprobe: https und http gehen weiterhin, ein Platzhalter
     dahinter auch. */
  for (const gut of [
    "https://www.ebay.de/sh/lst/active",
    "http://intern.example/liste",
    "https://www.ebay.de/itm/{{artikelnummer}}",
  ]) {
    const wf = kopie(WF);
    wf.steps = [{ type: "navigate", url: gut }];
    assert.equal(workflowPruefen(wf).ok, true, `abgelehnt: ${gut}`);
  }

  /* Ein Platzhalter GANZ VORN bleibt draussen: Er könnte jedes Schema werden. */
  const vorn = kopie(WF);
  vorn.steps = [{ type: "navigate", url: "{{ziel}}/kasse" }];
  const e = workflowPruefen(vorn);
  assert.equal(e.ok, false);
  assert.equal(e.code, "adresse_ungueltig");
});
