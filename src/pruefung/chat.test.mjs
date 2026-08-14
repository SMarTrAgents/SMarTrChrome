/*
 * Prüfung des Agenten-Chats (Auftrag 3) — die Zustandsmaschine aus
 * net/chat.js, gefahren gegen eine Netz-Attrappe.
 *
 * Was hier zugesichert wird:
 *
 *  - Jede Chat-Anfrage trägt die Kopfzeile `X-Client: smartrchrome-app`.
 *    Das ist die Bedingung des Gateway-Zugangstors (`_chat_access_gate`):
 *    Ohne aktives Abo kommen nur Clients mit `-app`-Endung durch. Die
 *    Erweiterung schickt nie `agent_profile`; `model_id` trägt allein den
 *    Antwortmodus: Normal Mode = kein model_id (das alte Verhalten),
 *    SMarTrMode = die feste Kennung "ollama/smartr".
 *  - Die Abfrageschleife: processing → warten, done → Text, error → der
 *    Satz des Servers. Takt und Obergrenze sind einstellbar (mockbar).
 *  - Fehlertexte nach der Regel vom 28.07.: Sie sagen, wer schuld ist.
 *  - Guthaben kommt vom Server und wird nach jeder Antwort neu geholt —
 *    es gibt keinen lokalen Rechenweg mehr.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

attrappeSetzen();

const chat = await import("../net/chat.js");
const { NetzFehler } = await import("../net/dienste.js");

/* ------------------------------------------------------------------ *
 * Netz-Attrappe
 * ------------------------------------------------------------------ */

function antwortJson(status, daten) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => daten,
  };
}

function netzSetzen(plan) {
  const anfragen = [];
  globalThis.fetch = async (url, optionen = {}) => {
    const pfad = new URL(url).pathname;
    const eintrag = { pfad, optionen, koerper: null };
    if (optionen.body) eintrag.koerper = JSON.parse(optionen.body);
    anfragen.push(eintrag);
    const antworter = plan[pfad];
    if (!antworter) return antwortJson(404, { success: false, error: "not_found" });
    const [status, daten] = await antworter(eintrag, anfragen);
    return antwortJson(status, daten);
  };
  return anfragen;
}

/* ------------------------------------------------------------------ *
 * Das Zugangstor: X-Client
 * ------------------------------------------------------------------ */

test("frageSenden: X-Client endet auf -app, Ausweis als Bearer, kein Modellwunsch", async () => {
  const anfragen = netzSetzen({
    "/api/v1/chat/message": async () => [200, { status: "processing", task_id: "t1", context_id: "c1" }],
  });

  const start = await chat.frageSenden({ text: "Hallo", contextId: "c1", ausweis: "tok" });
  assert.equal(start.taskId, "t1");
  assert.equal(start.contextId, "c1");

  const a = anfragen[0];
  assert.equal(a.optionen.headers["X-Client"], chat.CHAT_KLIENT);
  assert.match(chat.CHAT_KLIENT, /-app$/, "das Gateway-Tor verlangt die -app-Endung");
  assert.equal(a.optionen.headers.Authorization, "Bearer tok");
  assert.equal(a.koerper.text, "Hallo");
  assert.equal(a.koerper.context_id, "c1");
  /* Kein Agentenprofil, keine Modellwahl — der freie Modus des Tors, und
     nebenbei: kein Modellname verlässt oder erreicht diese Erweiterung. */
  assert.ok(!("agent_profile" in a.koerper));
  assert.ok(!("model_id" in a.koerper));
});

/* ------------------------------------------------------------------ *
 * Der Antwortmodus auf der Leitung (06.08.2026)
 *
 * Drahtwahrheit, am Live-Gateway gemessen: Der Modus reist als Body-Feld
 * `model_id` — ein „mode“-Feld würde ignoriert. Normal Mode heißt KEIN
 * model_id, SMarTrMode heißt model_id "ollama/smartr".
 * ------------------------------------------------------------------ */

test("frageSenden im SMarTrMode sendet model_id ollama/smartr", async () => {
  const anfragen = netzSetzen({
    "/api/v1/chat/message": async () => [200, { status: "processing", task_id: "tm1", context_id: "cm1" }],
  });
  await chat.frageSenden({ text: "Hallo", contextId: "cm1", ausweis: "tok", modus: "smartr" });
  const a = anfragen[0];
  assert.equal(a.koerper.model_id, "ollama/smartr");
  /* Auch im SMarTrMode: kein Agentenprofil und kein erfundenes mode-Feld. */
  assert.ok(!("agent_profile" in a.koerper));
  assert.ok(!("mode" in a.koerper));
});

test("frageSenden mit ausdrücklichem modus normal sendet WEITERHIN kein model_id", async () => {
  const anfragen = netzSetzen({
    "/api/v1/chat/message": async () => [200, { status: "processing", task_id: "tm2", context_id: "cm2" }],
  });
  await chat.frageSenden({ text: "Hallo", ausweis: "tok", modus: "normal" });
  assert.ok(!("model_id" in anfragen[0].koerper), "Normal Mode ist das heutige Verhalten: kein Modellwunsch");
});

/* ------------------------------------------------------------------ *
 * Die Abfrageschleife
 * ------------------------------------------------------------------ */

test("antwortAbholen: processing, processing, done → Text", async () => {
  let zaehler = 0;
  const anfragen = netzSetzen({
    "/api/v1/chat/poll/t2": async () => {
      zaehler += 1;
      if (zaehler < 3) return [200, { status: "processing" }];
      return [200, { status: "done", response: "Hier ist deine Antwort.", context_id: "c2" }];
    },
  });

  const takte = [];
  const ergebnis = await chat.antwortAbholen({
    taskId: "t2",
    ausweis: "tok",
    taktMs: 1,
    aufTakt: (t) => takte.push(t.versuch),
  });

  assert.equal(ergebnis.text, "Hier ist deine Antwort.");
  assert.equal(ergebnis.contextId, "c2");
  assert.equal(anfragen.length, 3);
  assert.deepEqual(takte, [1, 2]);
  assert.equal(anfragen[0].optionen.headers["X-Client"], chat.CHAT_KLIENT);
});

test("antwortAbholen: error-Status → der Satz des Servers erreicht den Aufrufer", async () => {
  netzSetzen({
    "/api/v1/chat/poll/t3": async () => [200, {
      status: "error", error: "unknown_task",
      message: "Verbindung zum Auftrag verloren (Dienst neu gestartet). Bitte den Chat neu laden.",
    }],
  });
  await assert.rejects(
    chat.antwortAbholen({ taskId: "t3", ausweis: "tok", taktMs: 1 }),
    (f) => f instanceof NetzFehler && /Verbindung zum Auftrag verloren/.test(f.klartext)
  );
});

test("antwortAbholen: leere done-Antwort und unbekannter Zustand sind Fehler bei uns", async () => {
  netzSetzen({ "/api/v1/chat/poll/t4": async () => [200, { status: "done", response: "" }] });
  await assert.rejects(
    chat.antwortAbholen({ taskId: "t4", ausweis: "tok", taktMs: 1 }),
    (f) => /liegt an uns/.test(f.klartext)
  );

  netzSetzen({ "/api/v1/chat/poll/t5": async () => [200, { status: "quark" }] });
  await assert.rejects(
    chat.antwortAbholen({ taskId: "t5", ausweis: "tok", taktMs: 1 }),
    (f) => f.kennung === "antwort_unbrauchbar"
  );
});

test("antwortAbholen: Obergrenze erreicht → ehrlicher Fristsatz, keine Endlosschleife", async () => {
  const anfragen = netzSetzen({
    "/api/v1/chat/poll/t6": async () => [200, { status: "processing" }],
  });
  await assert.rejects(
    chat.antwortAbholen({ taskId: "t6", ausweis: "tok", taktMs: 1, hoechstens: 4 }),
    (f) => f.kennung === "frist" && /liegt an uns/.test(f.klartext)
  );
  assert.equal(anfragen.length, 4);
});

test("antwortAbholen: Abbruchsignal beendet die Schleife als „abgebrochen“", async () => {
  const abbruch = new AbortController();
  netzSetzen({
    "/api/v1/chat/poll/t7": async () => {
      abbruch.abort();
      return [200, { status: "processing" }];
    },
  });
  await assert.rejects(
    chat.antwortAbholen({ taskId: "t7", ausweis: "tok", taktMs: 1, signal: abbruch.signal }),
    (f) => f.kennung === "abgebrochen"
  );
});

/* ------------------------------------------------------------------ *
 * Ehrliche Fehlertexte (Auftrag 2 im Chat)
 * ------------------------------------------------------------------ */

test("chatFehlerText: 402 nennt Guthaben/Abo, 404 nennt „noch nicht eingerichtet“", () => {
  const zuWenig = chat.chatFehlerText(new NetzFehler("kein_abo", "x", 402));
  assert.match(zuWenig, /Guthaben oder Abo/);
  assert.ok(!/versuche es noch einmal/i.test(zuWenig));

  const fehlt = chat.chatFehlerText(new NetzFehler("nicht_da", "x", 404));
  assert.match(fehlt, /noch nicht eingerichtet/);
  assert.match(fehlt, /nichts falsch/i);

  const doppelt = chat.chatFehlerText(new NetzFehler("processing_in_progress", "x", 409));
  assert.match(doppelt, /vorigen Frage/);
});

/* ------------------------------------------------------------------ *
 * Der ganze Botengang im Worker-Modul
 * ------------------------------------------------------------------ */

function aufNachricht(spur, typ, frist = 2000) {
  return new Promise((fertig, kaputt) => {
    const start = Date.now();
    const uhr = setInterval(() => {
      const treffer = spur.find((e) => e.wohin === "panel" && e.nachricht.typ === typ);
      if (treffer) {
        clearInterval(uhr);
        fertig(treffer.nachricht);
      } else if (Date.now() - start > frist) {
        clearInterval(uhr);
        kaputt(new Error(`keine ${typ}-Nachricht`));
      }
    }, 5);
  });
}

test("chatStarten: sofortige Auftragsnummer, chat:antwort als Laufzeitnachricht", async () => {
  const { spur } = attrappeSetzen({ panelAntwortet: null });
  netzSetzen({
    "/api/v1/chat/message": async () => [200, { status: "processing", task_id: "t8", context_id: "c8" }],
    "/api/v1/chat/poll/t8": async () => [200, { status: "done", response: "Fertig gedacht.", context_id: "c8" }],
  });

  const start = await chat.chatStarten({ text: "Denk nach", contextId: null, ausweis: "tok" });
  assert.equal(start.ok, true);
  assert.equal(start.taskId, "t8");
  assert.equal(start.contextId, "c8");

  const nachricht = await aufNachricht(spur, "chat:antwort");
  assert.equal(nachricht.ok, true);
  assert.equal(nachricht.text, "Fertig gedacht.");
  assert.equal(nachricht.contextId, "c8");

  /* Danach ist der Botengang beendet — die nächste Frage darf sofort los. */
  const zustand = await chat.chatZustand();
  assert.equal(zustand.laeuft, false);
});

test("chatStarten reicht den Modus bis in den Netz-Body durch", async () => {
  const { spur } = attrappeSetzen({ panelAntwortet: null });
  const anfragen = netzSetzen({
    "/api/v1/chat/message": async () => [200, { status: "processing", task_id: "tm3", context_id: "cm3" }],
    "/api/v1/chat/poll/tm3": async () => [200, { status: "done", response: "Fertig.", context_id: "cm3" }],
  });

  const start = await chat.chatStarten({ text: "Hallo", contextId: null, ausweis: "tok", modus: "smartr" });
  assert.equal(start.ok, true);
  assert.equal(anfragen[0].koerper.model_id, "ollama/smartr");

  /* Den Botengang sauber zu Ende bringen, damit die nächste Prüfung frei ist. */
  await aufNachricht(spur, "chat:antwort");
  const zustand = await chat.chatZustand();
  assert.equal(zustand.laeuft, false);
});

test("chatStarten ohne Ausweis: Anmeldung statt kryptischem Fehler", async () => {
  attrappeSetzen();
  const antwort = await chat.chatStarten({ text: "Hallo", ausweis: null });
  assert.equal(antwort.ok, false);
  assert.equal(antwort.kennung, "anmeldung");
});

/* ------------------------------------------------------------------ *
 * Der Wiedereintritt nach `await` (Befund NOTAUS-1 vom 14.08.2026)
 *
 * DER GRUNDSATZ, den diese Gruppe misst:
 *
 *   **Nach einem Not-Aus darf kein Weg mehr etwas WIEDERHERSTELLEN, auch
 *   nicht ein Weg, der VOR dem Not-Aus begonnen hat.**
 *
 * Die Sätze über den Nachrichtenhörer stehen in `bruecke.test.mjs`; hier wird
 * gemessen, was dort nicht sichtbar ist: WIE der Stopp beim Server aussieht.
 * Ohne die Kopfzeile `X-Client` weist das Zugangstor des Gateways ihn ab, und
 * dann läuft der Auftrag weiter, obwohl die Netzspur einen Stopp zeigt.
 * ------------------------------------------------------------------ */

/** Ein paar Runden der Ereignisschleife, ohne echte Zeit verstreichen zu lassen. */
async function runden(anzahl = 10) {
  for (let i = 0; i < anzahl; i += 1) await new Promise((f) => setImmediate(f));
}

test("Not-Aus in der offenen Frage: kein Botengang, und der Auftrag wird beim Server gestoppt", async () => {
  attrappeSetzen({ panelAntwortet: null });
  await chat.chatAbbrechen(); /* Rest aus einem vorigen Durchgang */

  let frageLoslassen = null;
  const anfragen = netzSetzen({
    "/api/v1/chat/message": async () => {
      /* Das Gateway lässt sich Zeit. Bis zu FRIST_ANFRAGE = 12 Sekunden — und
         genau dieses Fenster ist der Befund. */
      await new Promise((f) => {
        frageLoslassen = f;
      });
      return [200, { status: "processing", task_id: "t-stopp", context_id: "c-stopp" }];
    },
    "/api/v1/chat/poll/t-stopp": async () => [200, { status: "processing", steps: [] }],
    "/api/v1/chat/cancel": async () => [200, { ok: true }],
  });

  const start = chat.chatStarten({ text: "Was steht hier?", ausweis: "tok" });
  await runden();
  assert.equal(typeof frageLoslassen, "function", "Vorbedingung: Der POST steht noch offen.");

  /* Die Reissleine, während die Frage unterwegs ist. In diesem Augenblick gibt
     es NICHTS abzubrechen: `lauf` ist null, `chat_lauf` leer. Genau das ist der
     Befund, und deshalb steht hier eine Vorbedingung und keine Zusage. */
  await chat.chatAbbrechen();
  assert.equal(
    anfragen.filter((a) => a.pfad === "/api/v1/chat/cancel").length,
    0,
    "Vorbedingung: `chatAbbrechen` findet nichts, es geht von dort kein Stopp hinaus.",
  );

  /* Und JETZT erst antwortet das Gateway. */
  frageLoslassen();
  const ergebnis = await start;
  await runden(20);

  assert.equal(ergebnis.ok, false, "Es entsteht kein Auftrag.");
  assert.equal(ergebnis.kennung, "abgebrochen", "Und der Grund wird benannt.");
  assert.ok(
    !ergebnis.klartext.includes(" — "),
    "Kein Gedankenstrich in einem Satz, der vorgelesen wird.",
  );
  assert.equal((await chat.chatZustand()).laeuft, false, "Es läuft kein Botengang.");
  assert.equal(
    anfragen.filter((a) => a.pfad.startsWith("/api/v1/chat/poll/")).length,
    0,
    "Es wird kein einziges Mal abgefragt.",
  );

  const stopps = anfragen.filter((a) => a.pfad === "/api/v1/chat/cancel");
  assert.equal(stopps.length, 1, "Der Auftrag wird beim Server gestoppt, genau einmal.");
  assert.equal(
    stopps[0].koerper.context_id,
    "c-stopp",
    "Mit der Kennung, die der Server soeben vergeben hat — sie kennt nur dieser Aufruf.",
  );
  assert.equal(
    stopps[0].optionen.headers["X-Client"],
    chat.CHAT_KLIENT,
    "Und mit der Kopfzeile, ohne die das Zugangstor den Stopp abweist.",
  );
  assert.equal(stopps[0].optionen.method, "POST", "Ein Stopp ist ein POST, kein GET.");
});

test("Not-Aus kurz vor der Antwort: sie wird nicht mehr zugestellt", async () => {
  /*
   * Dieselbe Klasse, selbst gefunden, am Ausgang statt am Eingang:
   * `weiterAbholen` meldet die fertige Antwort an die Seitenleiste. Fällt der
   * Not-Aus in die letzte Abfrage, ist das eine Antwort, auf die niemand mehr
   * wartet — und `chatAbbrechen` sagt selbst, dass so eine „weder ankommen noch
   * weiterkosten" soll. Ohne die Marke käme sie an, und `laufEnde()` räumte
   * dabei einen Botengang ab, der inzwischen jemand anderem gehört.
   */
  const { spur } = attrappeSetzen({ panelAntwortet: null });
  await chat.chatAbbrechen();

  let abgebrochen = false;
  netzSetzen({
    "/api/v1/chat/message": async () => [
      200,
      { status: "processing", task_id: "t-spaet", context_id: "c-spaet" },
    ],
    "/api/v1/chat/poll/t-spaet": async () => {
      /* Der Not-Aus fällt genau in diese Abfrage. */
      if (!abgebrochen) {
        abgebrochen = true;
        await chat.chatAbbrechen();
      }
      return [200, { status: "done", response: "Fertig gedacht.", context_id: "c-spaet" }];
    },
    "/api/v1/chat/cancel": async () => [200, { ok: true }],
  });

  const start = await chat.chatStarten({ text: "Denk nach", ausweis: "tok" });
  assert.equal(start.ok, true, "Vorbedingung: Der Botengang ging los.");
  await runden(30);

  assert.equal(
    spur.filter((e) => e.wohin === "panel" && e.nachricht && e.nachricht.typ === "chat:antwort").length,
    0,
    "Nach dem Not-Aus wird keine Antwort mehr zugestellt.",
  );
  assert.equal((await chat.chatZustand()).laeuft, false, "Und es läuft nichts mehr.");
});

/* ------------------------------------------------------------------ *
 * Guthaben — echt, und nach jeder Antwort frisch
 * ------------------------------------------------------------------ */

test("guthabenHolen liest die echten Serverfelder (used, balance, quota, tier)", async () => {
  const anfragen = netzSetzen({
    "/api/v1/user/tokens": async () => [200, { used: 1200, balance: 23800, quota: 25000, tier: "starter" }],
  });
  const stand = await chat.guthabenHolen("tok");
  assert.deepEqual(stand, { balance: 23800, used: 1200, quota: 25000, tier: "starter" });
  assert.equal(anfragen[0].optionen.headers.Authorization, "Bearer tok");
});

test("Guthaben-Nachladen nach Antwort: der neue Serverstand gewinnt, nichts wird lokal gerechnet", async () => {
  /* Der Ablauf der Seitenleiste: Antwort fertig → guthabenLaden() → neuer
     Abruf. Hier die Zusicherung der Netzschicht: Jeder Abruf liefert den
     aktuellen Serverwert unverändert — Abzüge passieren ausschließlich dort. */
  let stand = 25000;
  netzSetzen({
    "/api/v1/user/tokens": async () => [200, { used: 25000 - stand, balance: stand, quota: 25000, tier: "starter" }],
  });
  const vorher = await chat.guthabenHolen("tok");
  assert.equal(vorher.balance, 25000);
  stand = 24310; /* der Server hat die Antwort abgerechnet */
  const nachher = await chat.guthabenHolen("tok");
  assert.equal(nachher.balance, 24310);
});

test("verlaufLaden bildet Rollen auf die zwei Sprecher ab und wirft Leeres weg", async () => {
  netzSetzen({
    "/api/v1/chat/history/c9": async () => [200, {
      context_id: "c9",
      messages: [
        { role: "user", content: "Was kostet das?" },
        { role: "assistant", content: "Das sehen wir gleich." },
        { role: "assistant", content: "   " },
      ],
    }],
  });
  const nachrichten = await chat.verlaufLaden({ contextId: "c9", ausweis: "tok" });
  assert.deepEqual(nachrichten, [
    { wer: "du", text: "Was kostet das?" },
    { wer: "niemand", text: "Das sehen wir gleich." },
  ]);
});


/* ------------------------------------------------------------------ *
 * Die Schritte des Agenten (Befund 29.07.2026)
 *
 * Das Gateway liefert bei jeder Abfrage mit, was der Agent gerade tut. Diese
 * Datei warf es weg — der Mensch sah bis zu zehn Minuten „Niemand arbeitet …"
 * und sonst nichts. Für jemanden, der sich alles vorlesen lässt, ist das von
 * „hängt" nicht zu unterscheiden.
 * ------------------------------------------------------------------ */

test("schritteLesen: nur bekannte Arten, gedeckelt, ohne Steuerzeichen", () => {
  const r = chat.schritteLesen([
    { type: "tool_call", text: "  liest die  Seite \n\n", tool: "smartrbrowser" },
    { type: "erfunden", text: "x".repeat(400) },
    { type: "agent", text: "   " },
    null,
    "kein objekt",
  ]);
  assert.equal(r.length, 2, "leere und unbrauchbare Einträge fallen weg");
  assert.deepEqual(r[0], { art: "tool_call", text: "liest die Seite", werkzeug: "smartrbrowser" });
  assert.equal(r[1].art, "info", "eine unbekannte Art wird nicht durchgereicht");
  assert.equal(r[1].text.length, 160, "gedeckelt");
});

test("schritteLesen: der Richtungsumkehrer wird entschärft", () => {
  /* \u202e zeigt eine Zeile rückwärts an: aus „exe.gnuhcer" wird sichtbar
     „rechnung.exe". Ein Werkzeugergebnis kann Seitentext enthalten, und der
     Mensch liest die Protokollzeile. */
  const [s] = chat.schritteLesen([{ type: "info", text: "Datei: \u202eexe.gnuhcer" }]);
  assert.ok(!/[\u202a-\u202e\u2066-\u2069]/.test(s.text), "kein Richtungszeichen bleibt stehen");
});

test("schritteLesen: nimmt nur die jüngsten Schritte, nicht das ganze Protokoll", () => {
  const viele = Array.from({ length: 200 }, (_, i) => ({ type: "info", text: `Schritt ${i}` }));
  const r = chat.schritteLesen(viele);
  assert.ok(r.length <= 40, `höchstens 40, waren ${r.length}`);
  assert.equal(r[r.length - 1].text, "Schritt 199", "die jüngsten, nicht die ältesten");
});

test("schritteLesen: was kein Feld hat, ergibt eine leere Liste statt einer Ausnahme", () => {
  for (const roh of [undefined, null, "text", 42, {}]) {
    assert.deepEqual(chat.schritteLesen(roh), []);
  }
});

/* ------------------------------------------------------------------ *
 * entmarken — der Framework-Name darf NIRGENDS zu lesen sein
 *
 * Befund 06.08.2026: „A0: Calling LLM…" stand im Chat, weil die Live-Schritte
 * ungefiltert durchliefen. Diese Prüfsätze werden gegen den alten Stand rot:
 * ohne entmarken() bleibt „A0" stehen.
 * ------------------------------------------------------------------ */

test("entmarken: A0, agent-zero und /a0-Pfade verschwinden, echte Wörter bleiben", () => {
  assert.equal(chat.entmarken("A0: Calling LLM..."), "SMarTrAgent: Calling LLM...");
  assert.equal(chat.entmarken("icon://construction A0: Using tool 'smartrbrowser'"),
    "SMarTrAgent: Using tool 'smartrbrowser'");
  assert.equal(chat.entmarken("agent zero denkt nach"), "SMarTrAgent denkt nach");
  assert.equal(chat.entmarken("agent-zero denkt nach"), "SMarTrAgent denkt nach");
  assert.equal(chat.entmarken("liegt im /a0/tmp Ordner"), "liegt im /sa/tmp Ordner");
  assert.equal(chat.entmarken("a0 antwortet"), "SMarTrAgent antwortet");
  /* Kein falscher Treffer: Zusammensetzungen mit Unterstrich und Zahlen bleiben. */
  assert.equal(chat.entmarken("das Plugin _a0_connector"), "das Plugin _a0_connector");
  assert.equal(chat.entmarken("Version A01 und A0x"), "Version A01 und A0x");
});

test("entmarken: icon:// verschwindet auch mitten im Text, nach Umbruch und mehrfach", () => {
  /* Mehrzeilige done-Antworten und Verläufe tragen icon:// nicht nur am Anfang.
     Prüfsatz gegen den alten, nur am Zeilenanfang verankerten Filter (rot). */
  assert.ok(!/icon:\/\//.test(chat.entmarken("Text mitten icon://drin Ende")),
    "kein icon:// mitten im Text");
  assert.ok(!/icon:\/\//.test(chat.entmarken("Zeile1\nicon://y weiter")),
    "kein icon:// nach einem Zeilenumbruch");
  assert.ok(!/icon:\/\//.test(chat.entmarken("icon://a Anfang icon://b zweitens")),
    "auch das zweite icon:// verschwindet");
  /* Wörter kleben nicht zusammen: die trennende Leerstelle bleibt. */
  assert.equal(chat.entmarken("Text mitten icon://drin Ende"), "Text mitten Ende");
});

test("schritteLesen entfernt den Framework-Namen aus den Live-Schritten", () => {
  const [s] = chat.schritteLesen([
    { type: "agent", text: "icon://construction A0: Using tool 'browser'", tool: "browser" },
  ]);
  assert.ok(!/\bA0\b/.test(s.text), "kein A0 im angezeigten Schritt");
  assert.ok(!/icon:\/\//.test(s.text), "kein icon://-Präfix bleibt stehen");
  assert.ok(s.text.startsWith("SMarTrAgent:"), "der Produktname steht davor");
});

test("antwortAbholen meldet jeden Schritt genau EINMAL", async () => {
  /* Das Gateway liefert bei jeder Abfrage die GANZE Liste. Wer sie ungefiltert
     weitergibt, schreibt dieselbe Zeile alle zwei Sekunden neu ins Protokoll. */
  const laeufe = [
    { status: "processing", steps: [{ type: "info", text: "eins" }] },
    { status: "processing", steps: [{ type: "info", text: "eins" }, { type: "info", text: "zwei" }] },
    {
      status: "done", response: "fertig", context_id: "c1",
      steps: [{ type: "info", text: "eins" }, { type: "info", text: "zwei" }, { type: "info", text: "drei" }],
    },
  ];
  let n = 0;
  netzSetzen({ "/api/v1/chat/poll/t-schritte": async () => [200, laeufe[Math.min(n++, 2)]] });

  const gemeldet = [];
  const echt = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = async (n2) => {
    if (n2 && n2.typ === "chat:schritte") for (const x of n2.schritte) gemeldet.push(x.text);
    return { ok: true };
  };
  try {
    await chat.antwortAbholen({ taskId: "t-schritte", ausweis: "tok", taktMs: 1 });
  } finally {
    chrome.runtime.sendMessage = echt;
  }

  assert.deepEqual(gemeldet, ["eins", "zwei", "drei"], "jeder Schritt genau einmal, in Reihenfolge");
});
