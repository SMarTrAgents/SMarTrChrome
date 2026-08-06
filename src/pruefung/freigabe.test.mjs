/*
 * Prüfung des Freigabewegs (Auftrag 1) und der ehrlichen Fehlertexte
 * (Auftrag 2) — Stand 28.07.2026.
 *
 * Auftrag 1: Antwortet der Server auf POST /link/request bei Lesestufe sofort
 * mit `state: "approved"`, gibt es kein Kennwort und keine Freigabeseite —
 * die Erweiterung holt das Ticket direkt über /redeem ab. Der Kennwortweg
 * bleibt für alles andere unverändert bestehen.
 *
 * Auftrag 2: Der konkrete Grund eines Fehlschlags (z. B. 404 = serverseitig
 * noch nicht eingerichtet) muss die Störungszeile der Seitenleiste erreichen.
 * Die Seitenleiste zeigt wörtlich an, was `klartext` sagt (panel.js,
 * stoerung/aufbauAbbrechen) — geprüft wird deshalb der Text, der dort ankommt.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, BEVOR die Module geladen werden — und sie darf
   danach nicht ersetzt werden: worker.js registriert seine Zuhörer auf genau
   dieser Instanz. */
const { chrome, spur } = attrappeSetzen({ panelAntwortet: null });

const ticket = await import("../net/ticket.js");
const { NetzFehler } = await import("../net/dienste.js");
await import("../background/worker.js");

/* ------------------------------------------------------------------ *
 * Netz-Attrappe: beantwortet Pfade aus einem Plan.
 * ------------------------------------------------------------------ */

function netzSetzen(plan) {
  const anfragen = [];
  globalThis.fetch = async (url, optionen = {}) => {
    const pfad = new URL(url).pathname;
    anfragen.push({ pfad, optionen });
    const antworter = plan[pfad];
    if (!antworter) return antwortJson(404, { success: false, error: "not_found" });
    const [status, daten] = await antworter({ pfad, optionen, anfragen });
    return antwortJson(status, daten);
  };
  return anfragen;
}

function antwortJson(status, daten) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => daten,
  };
}

const SCHLUESSEL = "pX6OlD5masRPfnc531nc9PbU8fm-SG4uzX0Osk2CbYw";
let ridNr = 0;
const neueRid = () => `lr_TEST${String(ridNr++).padStart(2, "0")}AAAAAAAAAAAAAAAAAA`;

const GEWUENSCHT = {
  access: "read",
  duration: 600,
  mode: "tab",
  allow: ["geizhals.de"],
  tab_host: "geizhals.de",
  step_mode: "confirm_each",
};

const tabsGeoeffnet = () => spur.filter((e) => e.wohin === "tabs.create").length;

/* ------------------------------------------------------------------ *
 * Auftrag 1 — die Sofortfreigabe der Lesestufe
 * ------------------------------------------------------------------ */

test("approved bei /request: kein Kennwort, kein Tab — Ticket direkt über /redeem", async () => {
  const rid = neueRid();
  netzSetzen({
    "/api/v1/link/request": async () => [201, {
      success: true, rid, state: "approved",
      granted: { access: "read", mode: "tab", duration: 600, allow: ["geizhals.de"] },
      redeem_key: SCHLUESSEL,
    }],
    "/api/v1/link/redeem": async () => [200, {
      rid, state: "approved", ticket: "eyJ.test.ticket", ticket_expires_in: 60,
      granted: { access: "read", duration: 600, mode: "tab", allow: ["geizhals.de"], step_mode: "confirm_each" },
    }],
  });

  const tabsVorher = tabsGeoeffnet();
  let kennwortGezeigt = 0;

  const ergebnis = await ticket.freigabeDurchlaufen({
    ausweis: "alltags-token",
    zweck: "Prüfung",
    gewuenscht: GEWUENSCHT,
    aufKennwort: () => { kennwortGezeigt += 1; },
  });

  assert.equal(ergebnis.ticket, "eyJ.test.ticket");
  assert.equal(ergebnis.sofort, true);
  assert.equal(ergebnis.kennwort, "");
  /* Die Kennwortkarte hängt in der Seitenleiste ausschließlich am
     aufKennwort-Rückruf — wird er nie gerufen, erscheint sie nie. */
  assert.equal(kennwortGezeigt, 0, "aufKennwort darf bei approved nie gerufen werden");
  assert.equal(tabsGeoeffnet(), tabsVorher, "kein Freigabeseiten-Tab bei approved");
});

test("pending-Weg unverändert: Kennwort wird gezeigt, Freigabeseite geöffnet", async () => {
  const rid = neueRid();
  netzSetzen({
    "/api/v1/link/request": async () => [201, {
      rid, verify_word: "QMRT4X",
      verify_word_spoken: "Q wie Quelle, M wie Martha, R wie Richard, T wie Theodor, vier, X wie Xanthippe",
      confirm_url: `https://cloud.smartragents.ai/link/confirm?rid=${rid}`,
      redeem_key: SCHLUESSEL, expires_in: 120,
    }],
    "/api/v1/link/redeem": async () => [200, {
      rid, state: "approved", ticket: "eyJ.pending.ticket",
      granted: { access: "write", duration: 600, mode: "tab", allow: ["geizhals.de"], step_mode: "confirm_each" },
    }],
  });

  const tabsVorher = tabsGeoeffnet();
  let kennwort = null;

  const ergebnis = await ticket.freigabeDurchlaufen({
    ausweis: "alltags-token",
    zweck: "Prüfung",
    gewuenscht: { ...GEWUENSCHT, access: "write" },
    aufKennwort: (k) => { kennwort = k; },
  });

  assert.equal(ergebnis.ticket, "eyJ.pending.ticket");
  assert.equal(ergebnis.sofort, false);
  assert.equal(kennwort.kennwort, "QMRT4X");
  assert.equal(tabsGeoeffnet(), tabsVorher + 1, "die Freigabeseite muss aufgehen");
});

test("approved ohne redeem_key ist unbrauchbar — fail-closed", async () => {
  netzSetzen({
    "/api/v1/link/request": async () => [201, {
      rid: neueRid(), state: "approved",
      granted: { access: "read" },
    }],
  });
  await assert.rejects(
    ticket.freigabeDurchlaufen({ ausweis: "t", zweck: "", gewuenscht: GEWUENSCHT }),
    (f) => f instanceof NetzFehler && f.kennung === "antwort_unbrauchbar"
  );
});

/* ------------------------------------------------------------------ *
 * Auftrag 2 — der konkrete Grund erreicht die Störungszeile
 * ------------------------------------------------------------------ */

test("404 bei /request: der Klartext sagt „noch nicht eingerichtet“ und macht dem Nutzer keinen Vorwurf", async () => {
  netzSetzen({}); /* alles 404 */
  await assert.rejects(
    ticket.freigabeDurchlaufen({ ausweis: "t", zweck: "", gewuenscht: GEWUENSCHT }),
    (f) => {
      assert.ok(f instanceof NetzFehler);
      /* Genau dieser Klartext läuft in panel.js über klartextVon() wörtlich
         in stoerung() und damit in Anzeige UND Sprachausgabe. */
      assert.match(f.klartext, /noch nicht eingerichtet/);
      assert.ok(!/versuche es noch einmal/i.test(f.klartext),
        "kein „versuche es noch einmal“, wenn ein zweiter Versuch nichts ändert");
      return true;
    }
  );
});

test("Worker reicht den konkreten Grund durch (link:verbinden)", async () => {
  const zuhoerer = chrome.runtime.onMessage._zuhoerer;
  assert.ok(zuhoerer.length > 0, "worker.js muss Zuhörer registriert haben");

  const senden = (nachricht, absender) =>
    new Promise((fertig) => {
      for (const z of zuhoerer) {
        const offen = z(nachricht, absender, fertig);
        if (offen) return;
      }
      fertig(null);
    });

  const eigene = { id: chrome.runtime.id }; /* Seitenleiste: kein tab */

  /* Unvollständige Freigabe: Der Grund aus link.js muss ankommen — nicht der
     alte Pauschalsatz „Bitte versuche es noch einmal". */
  const antwort = await senden({ typ: "link:verbinden", ticket: null, ausweis: null }, eigene);
  assert.equal(antwort.ok, false);
  assert.match(antwort.klartext, /Mir fehlt die Freigabe/);
  assert.ok(!/Bitte versuche es noch einmal/.test(antwort.klartext));

  /* Fremder Absender: ehrlich benannt, ohne Wiederholungs-Empfehlung. */
  const fremd = await senden(
    { typ: "link:verbinden", ticket: "x", ausweis: "y" },
    { id: chrome.runtime.id, tab: { id: 7 } }
  );
  assert.equal(fremd.ok, false);
  assert.match(fremd.klartext, /nicht aus der Seitenleiste/);
});

test("Worker: chat:senden gegen fehlenden Endpunkt → „noch nicht eingerichtet“ für den Chat", async () => {
  netzSetzen({}); /* /api/v1/chat/message existiert nicht → 404 */
  const zuhoerer = chrome.runtime.onMessage._zuhoerer;
  const senden = (nachricht, absender) =>
    new Promise((fertig) => {
      for (const z of zuhoerer) {
        const offen = z(nachricht, absender, fertig);
        if (offen) return;
      }
      fertig(null);
    });

  const antwort = await senden(
    { typ: "chat:senden", text: "Hallo", ausweis: "alltags-token" },
    { id: chrome.runtime.id }
  );
  assert.equal(antwort.ok, false);
  assert.match(antwort.klartext, /noch nicht eingerichtet/);
  assert.match(antwort.klartext, /nichts falsch/i);
});

test("Worker: chat:senden reicht den SMarTrMode als model_id bis in den Netz-Body durch", async () => {
  /* Drahtwahrheit vom 06.08.2026: Der Modus reist als Body-Feld model_id von
     POST /chat/message. Der Worker muss n.modus an chatStarten weitergeben —
     ohne die Weitergabe bliebe der Body leer und dieser Satz würde rot. */
  const anfragen = netzSetzen({
    "/api/v1/chat/message": async () => [201, { status: "processing", task_id: "tw1", context_id: "cw1" }],
    "/api/v1/chat/poll/tw1": async () => [200, { status: "done", response: "Fertig.", context_id: "cw1" }],
  });
  const zuhoerer = chrome.runtime.onMessage._zuhoerer;
  const senden = (nachricht, absender) =>
    new Promise((fertig) => {
      for (const z of zuhoerer) {
        const offen = z(nachricht, absender, fertig);
        if (offen) return;
      }
      fertig(null);
    });

  const antwort = await senden(
    { typ: "chat:senden", text: "Hallo", ausweis: "alltags-token", modus: "smartr" },
    { id: chrome.runtime.id }
  );
  assert.equal(antwort.ok, true);

  const nachricht = anfragen.find((a) => a.pfad === "/api/v1/chat/message");
  assert.ok(nachricht, "die Frage hat das Gateway erreicht");
  const koerper = JSON.parse(nachricht.optionen.body);
  assert.equal(koerper.model_id, "ollama/smartr");

  /* Den Botengang zu Ende kommen lassen, damit kein Lauf in die nächste
     Prüfung hineinragt. */
  const frist = Date.now() + 2000;
  const chat = await import("../net/chat.js");
  while ((await chat.chatZustand()).laeuft) {
    if (Date.now() > frist) throw new Error("der Botengang endet nicht");
    await new Promise((f) => setTimeout(f, 5));
  }
});

/* ------------------------------------------------------------------ *
 * Die Seitenleiste selbst (Quelltextzusagen — panel.js hängt am DOM und
 * lässt sich hier nicht laden; diese Zusagen halten die Verdrahtung fest).
 * ------------------------------------------------------------------ */

test("panel.js: Kennwortkarte nur noch über kennwortZeigen; kein Demo-Guthaben mehr", async () => {
  const quelle = await readFile(new URL("../panel/panel.js", import.meta.url), "utf8");

  /* Genau EIN Weg in den Kennwort-Zustand — der Rückruf mit echtem Kennwort. */
  const treffer = quelle.match(/setzeZustand\("kennwort"\)/g) || [];
  assert.equal(treffer.length, 1, "setzeZustand(\"kennwort\") darf nur in kennwortZeigen stehen");
  const kennwortZeigen = quelle.slice(quelle.indexOf("function kennwortZeigen"));
  assert.ok(kennwortZeigen.includes('setzeZustand("kennwort")'));

  /* Das Demo-Guthaben ist restlos weg: kein Startwert, kein Abbuchen,
     kein Faktor-Rechnen, kein Reset-Menüpunkt. */
  assert.ok(!quelle.includes("GUTHABEN_START"));
  assert.ok(!quelle.includes("abbuchen("));
  assert.ok(!quelle.includes("kostenFuer"));
  assert.ok(!quelle.includes("menue-reset"));

  /* Der Chat hängt nicht mehr an der Browser-Sitzung … */
  assert.ok(!quelle.includes("Dafür baue ich erst die Verbindung auf"));
  /* … und nach jeder fertigen Antwort wird das echte Guthaben neu geladen. */
  const antwortBlock = quelle.slice(quelle.indexOf('n.typ === "chat:antwort"'));
  assert.ok(antwortBlock.slice(0, 600).includes("guthabenLaden()"));

  const html = await readFile(new URL("../panel/panel.html", import.meta.url), "utf8");
  assert.ok(!html.includes("menue-reset"), "der Menüpunkt ist weggelassen, nicht ausgegraut");
  assert.ok(!html.includes("Demo-Guthaben"));
});
