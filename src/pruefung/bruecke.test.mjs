/*
 * Prüfung der Brücke: `net/link.js` und `background/worker.js` (Vertrag v3.5).
 *
 * Aufruf:  node --test src/pruefung/bruecke.test.mjs
 *
 * Diese Datei misst vier Zusagen, und sie misst sie AM PRODUKTIVWEG. Das ist
 * die Lehre vom 11.08.2026: Damals lagen achtzehn grüne Prüfsätze über einer
 * Verdeckungswache, die im ausgelieferten Klickweg niemand rief. Eine Zusage,
 * die nur ihre eigene Funktion kennt, sagt nichts über die Erweiterung aus.
 * Deshalb geht hier jeder Satz durch `verbinden()`, durch den echten
 * Handschlag, durch den echten Nachrichtenhörer des Dienstarbeiters.
 *
 *   1. **Sichtbarkeit (§8.4).** Beginnt eine Cloud-Sitzung, stehen alle drei
 *      Zeichen: Zeile in der Seitenleiste, Abzeichen am Symbol, EINE
 *      Systemmeldung. Gemessen wird nicht an einem Beispiel, sondern über
 *      alle Wege, auf denen eine Sitzung überhaupt entstehen kann.
 *   2. **Not-Aus (§5).** Erst kappen, dann melden. Der Prüfsatz lässt den
 *      Relay NIE antworten und misst, dass trotzdem schon nichts mehr läuft.
 *   3. **Kein stilles Warten (§8.4).** Tab weg oder Frist um heisst Absage,
 *      nicht Warteschlange.
 *   4. **Die Nachrichten aus §6.** Je Nachricht ein Satz, der belegt, dass ein
 *      Inhaltsskript sie nicht absetzen kann.
 *
 * Was hier NICHT geprüft wird: die Sitzungsfrist. Sie hat ihre eigene Datei
 * (`frist.test.mjs`) mit einer von Hand geführten Uhr. Zwei Fassungen derselben
 * Messung wären eine Fassung zu viel.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, BEVOR die Module geladen werden: dienste.js liest
   die Fassung beim Laden aus dem Manifest. */
let welt = attrappeSetzen();

const link = await import("../net/link.js");
const chat = await import("../net/chat.js");
const ausfuehrer = await import("../net/ausfuehrer.js");
const protokollbuch = await import("../net/protokollbuch.js");
const werkstatt = await import("../net/werkstatt.js");
const { MODUS_ABLAGE } = await import("../net/befehle.js");
const { REKORDER_ABLAGE } = await import("../net/werkstatt.js");

/* Der Dienstarbeiter wird EINMAL geladen. Sein Nachrichtenhörer wird dabei
   angemeldet; ihn greifen wir hier ab und rufen ihn selbst, genau so, wie
   Chrome es täte. Ein zweiter Import brächte keinen zweiten Hörer — Module
   werden einmal ausgewertet, und das ist gut so: Gemessen wird der Hörer, den
   die Erweiterung wirklich anmeldet. */
await import("../background/worker.js");
const hoerer = welt.chrome.runtime.onMessage._zuhoerer[0];
assert.equal(typeof hoerer, "function", "Der Dienstarbeiter meldet einen Nachrichtenhörer an.");

/*
 * Dieselben zwei Griffe für die beiden anderen Eingänge in denselben
 * Produktivweg. Sie werden hier abgegriffen und nicht nachgebaut, weil ein
 * nachgebauter Hörer nichts über die ausgelieferte Erweiterung sagt: Gemessen
 * wird, was der Dienstarbeiter bei Chrome WIRKLICH anmeldet.
 *
 *  - `tabs.onUpdated` ist die Zeile, an der Befund H6 hängt (Aufzeichnung über
 *    einen Seitenwechsel hinweg). Fehlt sie, gibt es hier keine Funktion,
 *    und die Prüfsätze dazu werden rot, statt still zu verschwinden.
 *  - `commands.onCommand` ist der dritte Not-Aus-Weg (Alt+Umschalt+S).
 */
const tabsAktualisiert = welt.chrome.tabs.onUpdated._zuhoerer[0];
assert.equal(
  typeof tabsAktualisiert,
  "function",
  "Der Dienstarbeiter hört auf `tabs.onUpdated` — ohne diese Anmeldung kann die Aufzeichnung keinen Seitenwechsel überleben.",
);
const tastenkuerzel = welt.chrome.commands.onCommand._zuhoerer[0];
assert.equal(typeof tastenkuerzel, "function", "Und auf das Tastenkürzel.");

/* ------------------------------------------------------------------ *
 * Werkzeug
 * ------------------------------------------------------------------ */

const MINUTE = 60_000;
const TAG_MS = 24 * 60 * 60 * 1000;

/** Die Leitung zum Relay, von Hand geführt. */
class DrahtAttrappe {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(adresse, unterprotokolle) {
    this.adresse = adresse;
    this.angeboten = unterprotokolle;
    this.protocol = "";
    this.readyState = DrahtAttrappe.CONNECTING;
    this.gesendet = [];
    this.geschlossen = null;
    DrahtAttrappe.letzte = this;
  }
  send(text) {
    this.gesendet.push(JSON.parse(text));
  }
  close(code, grund) {
    this.readyState = DrahtAttrappe.CLOSED;
    this.geschlossen = { code, grund };
  }
  oeffnen(protokoll = "smartrlink.v2") {
    this.readyState = DrahtAttrappe.OPEN;
    this.protocol = protokoll;
    if (this.onopen) this.onopen();
  }
  empfangen(rahmen) {
    return this.onmessage ? this.onmessage({ data: JSON.stringify(rahmen) }) : undefined;
  }
}

/* Was der Widerruf beim Relay gemacht hat. Er ist eine zusätzliche Sicherung
   und läuft in dieser Prüfung ins Leere — aber er soll belegbar STATTFINDEN. */
let widerrufe = [];

/** Eine frische Welt: neue Ablage, neue Spur, neuer Browser. */
function weltNeu(zusatz = {}) {
  welt = attrappeSetzen(zusatz);
  widerrufe = [];
  globalThis.WebSocket = DrahtAttrappe;
  globalThis.fetch = async (adresse, angaben) => {
    widerrufe.push({ adresse: String(adresse), angaben });
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      async json() {
        return {};
      },
    };
  };
  /* Der Wecker wird mitgeschrieben. Ohne diese Fassung liesse sich „an den
     BESTEHENDEN Wecker gehängt, nicht an einen zweiten" nicht messen. */
  welt.wecker = [];
  welt.chrome.alarms = {
    async create(name, angaben) {
      welt.wecker.push({ name, angaben });
    },
    async clear(name) {
      welt.wecker = welt.wecker.filter((w) => w.name !== name);
      return true;
    },
    onAlarm: { addListener: () => {} },
  };
  return welt;
}

weltNeu();

/**
 * Eine Sitzung, wirklich aufgebaut: über `verbinden()` und den echten
 * Handschlag. Alles Weitere misst an ihr.
 */
async function sitzungAufbauen({
  agent = null,
  code = "sitzung-1",
  tabId = 7,
  stufe = "read",
  expiry = 1800,
} = {}) {
  globalThis.WebSocket = DrahtAttrappe;
  const laeuft = link.verbinden({ ticket: "einweg-ticket", ausweis: "ausweis", tabId });
  const draht = DrahtAttrappe.letzte;
  draht.oeffnen();
  const rahmen = {
    type: "auth_ok",
    code,
    access: stufe,
    allow: ["geizhals.de"],
    mode: "tab",
    step_mode: "confirm_each",
    expiry,
  };
  if (agent !== null) rahmen.agent = agent;
  await draht.empfangen(rahmen);
  await laeuft;
  return draht;
}

/** Die drei Zeichen aus §8.4, so wie die Spur sie sieht. */
function zeichen(ab = 0) {
  const teil = welt.spur.slice(ab);
  return {
    zeile: teil.filter(
      (e) => e.wohin === "panel" && e.nachricht && e.nachricht.typ === "link:cloud-sitzung" && e.nachricht.an === true
    ),
    aus: teil.filter(
      (e) => e.wohin === "panel" && e.nachricht && e.nachricht.typ === "link:cloud-sitzung" && e.nachricht.an === false
    ),
    abzeichen: teil.filter((e) => e.wohin === "action.setBadgeText" && e.text),
    abzeichenWeg: teil.filter((e) => e.wohin === "action.setBadgeText" && !e.text),
    meldung: teil.filter((e) => e.wohin === "notifications.create"),
  };
}

/** Behauptet: Hier hat eine Cloud-Sitzung begonnen, und man sieht es dreifach. */
function dreiZeichenStehen(ab, wo) {
  const z = zeichen(ab);
  assert.ok(z.zeile.length >= 1, `${wo}: Die Seitenleiste bekommt die Dauerzeile.`);
  assert.ok(z.abzeichen.length >= 1, `${wo}: Am Symbol steht ein Abzeichen.`);
  assert.equal(z.meldung.length, 1, `${wo}: Es gibt genau eine Systemmeldung zum Start.`);
  return z;
}

/** Der Nachrichtenweg des Dienstarbeiters, so wie Chrome ihn ruft. */
function anWorker(nachricht, absender = { id: welt.chrome.runtime.id }) {
  return new Promise((fertig) => {
    let beantwortet = false;
    const antwort = (wert) => {
      if (beantwortet) return;
      beantwortet = true;
      fertig(wert);
    };
    const weiter = hoerer(nachricht, absender, antwort);
    if (weiter !== true && !beantwortet) {
      fertig(undefined);
    }
  });
}

/** Ein Absender, wie ihn Chrome für ein Inhaltsskript setzt. */
function ausDemTab(tabId = 7) {
  return { id: welt.chrome.runtime.id, tab: { id: tabId }, url: "https://fremde-seite.example/" };
}

/** Ein paar Runden der Ereignisschleife, ohne echte Zeit verstreichen zu lassen. */
async function runden(anzahl = 6) {
  for (let i = 0; i < anzahl; i += 1) await new Promise((f) => setImmediate(f));
}

/*
 * Ein Alltags-Ausweis, wie er in `chrome.storage.session` liegt.
 *
 * Er wird gebraucht, damit der Widerruf beim Relay überhaupt losgehen KANN:
 * Nach einem Neustart des Dienstarbeiters ist der Modulspeicher leer, und die
 * Ablage ist dann die einzige Quelle. Ohne diesen Satz misst der Prüfsatz
 * unten nur, dass nichts passiert.
 */
function ausweisAblage() {
  const rumpf = Buffer.from(
    JSON.stringify({ sub: "nutzer-1", email: "pruefung@example.org", exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString("base64url");
  const token = `kopf.${rumpf}.zeichen`;
  return { sa_ausweis: { token, laeuftAbUm: (Math.floor(Date.now() / 1000) + 3600) * 1000 } };
}

/** Ein Sitzungssatz, wie ihn ein Dienstarbeiter hinterlässt, der gestorben ist. */
function sitzungAusFremdemLeben(zusatz = {}) {
  const jetzt = Date.now();
  return {
    code: "s-fremd",
    stufe: "read",
    bereich: ["geizhals.de"],
    modus: "tab",
    schrittmodus: "confirm_each",
    budgetMs: 30 * MINUTE,
    verbrauchtMs: 0,
    ankerMonoton: 0,
    ankerUhr: jetzt,
    ankerLeben: "ein-anderes-leben",
    endetUm: jetzt + 30 * MINUTE,
    leerlaufSekunden: 0,
    begonnenUm: jetzt,
    ursprungMuster: null,
    tabId: 7,
    agent: "SMarTrCEO",
    ...zusatz,
  };
}

/*
 * Ein Gateway, das eine Chat-Antwort NIE fertig meldet.
 *
 * Genau diese Lage misst Befund B9: Der Botengang läuft, der Mensch drückt den
 * Not-Aus, und die Frage ist, ob danach noch abgefragt wird. Zurückgegeben wird
 * die Liste aller Rufe, damit sich `/chat/cancel` zählen lässt — „null Mal" war
 * der gemessene Zustand vom 14.08.2026.
 */
function chatGatewayStellen() {
  const rufe = [];
  globalThis.fetch = async (adresse, angaben) => {
    const weg = String(adresse);
    rufe.push({ weg, angaben });
    const antwort = (daten) => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      async json() {
        return daten;
      },
    });
    if (weg.includes("/api/v1/chat/message")) return antwort({ task_id: "t-1", context_id: "c-1" });
    if (weg.includes("/api/v1/chat/poll/")) return antwort({ status: "processing", steps: [] });
    return antwort({});
  };
  return rufe;
}

/** Wie oft ein Weg gerufen wurde. */
const rufeAuf = (rufe, stueck) => rufe.filter((r) => r.weg.includes(stueck)).length;

/* Ein englischer Katalog. Er ist der ganze Prüfstand für Befund M10: Kommt der
   Satz aus dem Katalog, steht hier Englisches; steht er als Literal im
   Quelltext, kommt Deutsches. Dazwischen gibt es nichts. */
const KATALOG_EN = {
  ext_symbol_sitzung: { message: "SMarTrChrome, cloud session active" },
  ext_symbol_sitzung_agent: {
    message: "SMarTrChrome, cloud session active, $1 is steering this browser",
  },
  ext_meldung_titel: { message: "Cloud session active" },
  ext_meldung_text: {
    message: "An agent is now steering this browser. To stop, press Alt, Shift and S.",
  },
  ext_meldung_text_agent: {
    message: "$1 is now steering this browser. To stop, press Alt, Shift and S.",
  },
};

/** Eine laufende Aufzeichnung, so wie `content/rekorder.js` sie ablegt. */
function aufnahmeAblage(laeuft = true) {
  return {
    [REKORDER_ABLAGE]: {
      version: 1,
      laeuft,
      bildNr: 0,
      schritte: [{ type: "click", selector_cascade: ["[data-testid='relist']"] }],
    },
  };
}

test.afterEach(async () => {
  /* Ohne diese Zeile hielte ein laufender Herzschlag (`setInterval`) den
     Prüflauf offen, und ein Lauf, der hängt, sagt niemandem, was kaputt ist. */
  await link.trennen("nutzer");
  /* Dasselbe für den Botengang des Chats: Sein Abfragetakt ist eine echte
     Zeitschaltung, und `chat.js` hält seinen Lauf im Modulspeicher, der die
     Weltwechsel dieser Datei überlebt. */
  await chat.chatAbbrechen();
});

/* ================================================================== *
 * 1. Sichtbarkeit (§8.4)
 * ================================================================== */

test("Sichtbarkeit: der Start einer Cloud-Sitzung setzt alle drei Zeichen", async () => {
  weltNeu();
  const ab = welt.spur.length;
  await sitzungAufbauen({ agent: "SMarTrCEO" });

  const z = dreiZeichenStehen(ab, "Handschlag mit Agentennamen");
  assert.equal(z.zeile[0].nachricht.agent, "SMarTrCEO", "In der Zeile steht, WER steuert.");
  assert.equal(z.meldung[0].angaben.title, "Cloud-Sitzung aktiv");
  assert.match(
    z.meldung[0].angaben.message,
    /^SMarTrCEO steuert jetzt diesen Browser\./,
    "Die Systemmeldung nennt den Agenten.",
  );
  assert.ok(
    !z.meldung[0].angaben.message.includes(" — "),
    "Kein Gedankenstrich in einem Satz, der vorgelesen wird.",
  );
});

test("Sichtbarkeit: es gibt keinen Weg in eine Cloud-Sitzung ohne die drei Zeichen", async () => {
  /*
   * Gemessen wird eine EIGENSCHAFT, nicht ein Beispiel: Über alle Wege, auf
   * denen in dieser Erweiterung eine Cloud-Sitzung entstehen kann, stehen
   * hinterher alle drei Zeichen. Die Wege sind der Handschlag mit und ohne
   * Agentennamen und der Leitungstausch, der beim Relay eine neue Sitzung
   * ergibt. Ein vierter Weg müsste durch `sitzungSchreiben` gehen, und genau
   * dort hängen die Zeichen.
   */
  const wege = [
    {
      name: "Handschlag ohne Agentennamen",
      async lauf() {
        await sitzungAufbauen({ agent: null, code: "ohne-agent" });
      },
    },
    {
      name: "Handschlag mit Agentennamen",
      async lauf() {
        await sitzungAufbauen({ agent: "SMarTrTrader", code: "mit-agent" });
      },
    },
    {
      name: "Leitungstausch mit neuer Sitzung",
      async lauf() {
        const alt = await sitzungAufbauen({ agent: "SMarTrCEO", code: "sitzung-eins" });
        const ab = welt.spur.length;
        const laeuft = link.verlaengernMit({ ticket: "zweites-ticket", ausweis: "ausweis" });
        let neu = DrahtAttrappe.letzte;
        for (let i = 0; i < 100 && neu === alt; i += 1) {
          await new Promise((f) => setImmediate(f));
          neu = DrahtAttrappe.letzte;
        }
        neu.oeffnen();
        await neu.empfangen({
          type: "auth_ok",
          code: "sitzung-zwei",
          access: "read",
          allow: ["geizhals.de"],
          mode: "tab",
          step_mode: "confirm_each",
          expiry: 1800,
          agent: "SMarTrItgott",
        });
        await laeuft;
        return ab;
      },
    },
  ];

  for (const weg of wege) {
    weltNeu();
    const ab = welt.spur.length;
    const abNachher = await weg.lauf();
    dreiZeichenStehen(typeof abNachher === "number" ? abNachher : ab, weg.name);
    await link.trennen("nutzer");
  }
});

test("Sichtbarkeit: ohne die Berechtigung `notifications` beginnt die Sitzung trotzdem", async () => {
  /* Am 14.08.2026 fehlt `notifications` im Manifest (gemeldet an A-SPRACHE).
     Dann ist `chrome.notifications` schlicht nicht da. Eine fehlende
     Berechtigung darf eine Sitzung nicht verhindern und darf vor allem nicht
     die beiden anderen Zeichen mitreissen. */
  weltNeu();
  delete welt.chrome.notifications;
  const ab = welt.spur.length;
  await sitzungAufbauen({ agent: "SMarTrCEO" });

  const z = zeichen(ab);
  assert.ok(z.zeile.length >= 1, "Die Dauerzeile steht.");
  assert.ok(z.abzeichen.length >= 1, "Das Abzeichen steht.");
  assert.equal(z.meldung.length, 0, "Eine Systemmeldung kann es ohne Berechtigung nicht geben.");
  const stand = await link.zustand();
  assert.equal(stand.verbunden, true, "Und die Sitzung läuft.");
});

test("Sichtbarkeit: der Name wird nachgetragen, wenn er erst mit dem ersten Befehl kommt", async () => {
  weltNeu();
  const ab = welt.spur.length;
  const draht = await sitzungAufbauen({ agent: null });
  const nachStart = zeichen(ab);
  assert.equal(nachStart.zeile[0].nachricht.agent, "", "Ohne Angabe steht kein Name da, auch kein erfundener.");
  assert.equal(nachStart.meldung.length, 1, "Die Systemmeldung lief einmal.");

  const abBefehl = welt.spur.length;
  await draht.empfangen({ id: "b1", cmd: "snapshot", reason: "Ich sehe auf der Seite nach.", agent: "SMarTrCEO" });

  const nachBefehl = zeichen(abBefehl);
  assert.equal(nachBefehl.zeile.length, 1, "Die Zeile wird genau einmal nachgeführt.");
  assert.equal(nachBefehl.zeile[0].nachricht.agent, "SMarTrCEO", "Und jetzt steht der Name darin.");
  assert.equal(
    nachBefehl.meldung.length,
    0,
    "Aber es gibt keine zweite Systemmeldung. Eine Sitzung, ein Piepser.",
  );
});

test("Sichtbarkeit: der Agentenname kommt aus dem Rahmen und wird nie erfunden", async () => {
  /*
   * Gemessen an einer Absage der Brücke selbst (Tab weg): Nur dort schreibt
   * diese Datei den Eintrag, und nur dort lässt sich also messen, WAS sie aus
   * dem Rahmen genommen hat. Trägt der Rahmen einen Namen, steht er im Buch.
   * Trägt er keinen, bleibt das Feld leer — es wird keiner erfunden, weder aus
   * der Sitzung noch aus der Positivliste.
   */
  weltNeu();
  const ohne = await sitzungAufbauen({ agent: null, tabId: 99 });
  await ohne.empfangen({ id: "b1", cmd: "snapshot", reason: "Ich sehe nach." });
  let eintraege = await protokollbuch.lesen();
  assert.equal(eintraege.length, 1, "Die abgesagte Fernaktion steht im Buch.");
  assert.equal(eintraege[0].agent, "", "Ohne Agentennamen bleibt das Feld leer.");
  await link.trennen("nutzer");

  weltNeu();
  const mit = await sitzungAufbauen({ agent: null, tabId: 99 });
  await mit.empfangen({ id: "b2", cmd: "snapshot", reason: "Ich sehe nach.", agent: "SMarTrTrader" });
  eintraege = await protokollbuch.lesen();
  assert.equal(eintraege[0].agent, "SMarTrTrader", "Steht er im Rahmen, steht er im Buch.");
});

test("Sichtbarkeit: das Ende nimmt alle drei Zeichen wieder weg", async () => {
  weltNeu();
  await sitzungAufbauen({ agent: "SMarTrCEO" });
  const ab = welt.spur.length;
  await link.trennen("nutzer");

  const z = zeichen(ab);
  assert.equal(z.aus.length >= 1, true, "Die Seitenleiste erfährt, dass die Zeile weg kann.");
  assert.ok(z.abzeichenWeg.length >= 1, "Das Abzeichen wird geleert.");
  assert.ok(
    welt.spur.slice(ab).some((e) => e.wohin === "notifications.clear"),
    "Und die Systemmeldung wird weggeräumt.",
  );
});

/* ================================================================== *
 * 2. Not-Aus (§5)
 * ================================================================== */

test("Not-Aus: gekappt wird zuerst, ohne auf die Antwort des Relays zu warten", async () => {
  /*
   * Der schärfste Fall: Der Relay antwortet NIE. Läge das Kappen hinter dem
   * Widerruf, liefe der Agent hier bis zum Sankt-Nimmerleins-Tag weiter.
   *
   * Gemessen wird an der Wirkung, nicht am Namen der Funktion: `laufAbbrechen`
   * entsteht in derselben Runde in `ausfuehrer.js`. Ob die Brücke sie oder den
   * Bestand `laufBeenden` erwischt, ist gleichgültig, solange danach nichts
   * mehr ausgeführt wird.
   */
  weltNeu();
  await sitzungAufbauen({ agent: "SMarTrCEO", code: "s-notaus" });
  globalThis.fetch = () => new Promise(() => {}); // der Relay schweigt für immer

  const vorher = await ausfuehrer.befehlAusfuehren(
    { id: "v1", cmd: "snapshot", reason: "Ich sehe nach." },
    {}
  );
  assert.notEqual(
    vorher.error && vorher.error.code,
    "session_beendet",
    "Vorbedingung: Vor der Notbremse führt der Ausführer noch aus.",
  );

  /* KEIN await: Der Prüfsatz misst genau den Augenblick, in dem der Widerruf
     noch offen ist. */
  const laeuft = link.trennen("notbremse");
  laeuft.catch(() => {});

  const nachher = await ausfuehrer.befehlAusfuehren(
    { id: "n1", cmd: "snapshot", reason: "Ich sehe nach." },
    {}
  );
  assert.equal(
    nachher.error && nachher.error.code,
    "session_beendet",
    "Der Lauf ist gekappt, obwohl der Relay noch nicht geantwortet hat.",
  );

  await runden();
  const ablage = await welt.chrome.storage.session.get("link_sitzung");
  assert.deepEqual(ablage, {}, "Und die Sitzung ist lokal beendet, ohne eine einzige Netzrunde abzuwarten.");

  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => "" }, async json() { return {}; } });
});

test("Not-Aus: die Sitzung endet auch, wenn der Widerruf scheitert", async () => {
  weltNeu();
  await sitzungAufbauen({ code: "s-fehler" });
  globalThis.fetch = async () => {
    throw new Error("Netz weg");
  };

  await link.trennen("notbremse");
  const ablage = await welt.chrome.storage.session.get("link_sitzung");
  assert.deepEqual(ablage, {}, "Ein scheiternder Widerruf hält die Sitzung nicht am Leben.");
  const stand = await link.zustand();
  assert.equal(stand.verbunden, false, "Und nach aussen ist nichts mehr verbunden.");
});

test("Not-Aus: der Widerruf beim Relay findet statt, nach dem Kappen", async () => {
  weltNeu();
  await sitzungAufbauen({ code: "s-widerruf" });
  await link.trennen("notbremse");

  assert.equal(widerrufe.length, 1, "Der Relay wird genau einmal um den Widerruf gebeten.");
  assert.match(widerrufe[0].adresse, /\/api\/v1\/browser\/disconnect$/, "Und zwar beim Relay, nicht beim Gateway.");
  const rumpf = JSON.parse(widerrufe[0].angaben.body);
  assert.equal(rumpf.code, "s-widerruf", "Mit der Kennung der Sitzung, die enden soll.");
});

test("Not-Aus: der Cloud-Auftrag hört mit auf, auf allen drei Wegen", async () => {
  /*
   * Befund B9 vom 14.08.2026, gemessen am echten Nachrichtenhörer: Nach
   * `{typ:"notbremse", quelle:"schild"}` lief der Cloud-Auftrag weiter. Drei
   * weitere Abfragen auf `/chat/poll/t-1`, `/chat/cancel` null Mal,
   * `chatZustand()` meldete weiter `{laeuft:true}`. Die Cloud-Hälfte der Zusage
   * aus §5 war gar nicht gebaut.
   *
   * Verschärfend und deshalb hier mitgemessen: Der Wecker `smartrchat-wache`
   * und der Schlüssel `chat_lauf` überlebten den Not-Aus. `chat.wacheLaufen`
   * hätte das Abholen nach dem nächsten Start des Dienstarbeiters WIEDER
   * AUFGENOMMEN. Ein Not-Aus, den ein Wecker zurücknimmt, ist keiner.
   *
   * Gemessen wird über alle drei Eingänge, weil es drei Stellen im Quelltext
   * sind. Ein Prüfsatz auf einen davon liesse die anderen zwei genau so
   * zurück, wie sie am 14.08. waren.
   */
  const wege = [
    {
      name: "Schild im Tab",
      async lauf() {
        await anWorker({ typ: "notbremse", quelle: "schild" }, ausDemTab(7));
      },
    },
    {
      name: "Stoppknopf der Seitenleiste",
      async lauf() {
        await anWorker({ typ: "link:notaus", grund: "seitenleiste" });
      },
    },
    {
      name: "Tastenkürzel",
      async lauf() {
        tastenkuerzel("notbremse");
      },
    },
  ];

  for (const weg of wege) {
    weltNeu();
    await chat.chatAbbrechen(); /* Rest aus dem vorigen Durchgang */
    const rufe = chatGatewayStellen();
    await sitzungAufbauen({ agent: "SMarTrCEO", code: "s-cloud" });

    const start = await chat.chatStarten({ text: "Was steht hier?", ausweis: "ausweis" });
    assert.equal(start.ok, true, `${weg.name}: Vorbedingung, der Botengang ist losgeschickt.`);
    await runden(10);
    assert.equal(
      (await chat.chatZustand()).laeuft,
      true,
      `${weg.name}: Vorbedingung, er läuft.`,
    );
    assert.ok(rufeAuf(rufe, "/chat/poll/") >= 1, `${weg.name}: Vorbedingung, es wird abgefragt.`);
    assert.ok(
      welt.wecker.some((w) => w.name === chat.CHAT_WECKER_NAME),
      `${weg.name}: Vorbedingung, der Chat-Wecker steht.`,
    );

    const abfragenVorher = rufeAuf(rufe, "/chat/poll/");
    await weg.lauf();
    await runden(20);

    assert.equal(
      (await chat.chatZustand()).laeuft,
      false,
      `${weg.name}: Nach dem Not-Aus läuft kein Botengang mehr.`,
    );
    assert.equal(
      rufeAuf(rufe, "/chat/cancel"),
      1,
      `${weg.name}: Der Auftrag wird beim Server gestoppt, genau einmal.`,
    );
    assert.deepEqual(
      await welt.chrome.storage.session.get("chat_lauf"),
      {},
      `${weg.name}: Der abgelegte Botengang ist weg, sonst holt die Wache die Antwort nach dem nächsten Start weiter ab.`,
    );
    assert.ok(
      !welt.wecker.some((w) => w.name === chat.CHAT_WECKER_NAME),
      `${weg.name}: Der Chat-Wecker ist gelöscht.`,
    );

    /* Und die Messung, die der Befund wörtlich nennt: Es wird nicht weiter
       abgefragt. Der Takt liegt bei zwei Sekunden, also wird hier wirklich
       gewartet — eine kürzere Frist würde nichts messen. */
    await new Promise((f) => setTimeout(f, 2300));
    assert.equal(
      rufeAuf(rufe, "/chat/poll/"),
      abfragenVorher,
      `${weg.name}: Nach dem Not-Aus kommt keine einzige Abfrage mehr.`,
    );
  }
});

test("Not-Aus: das Zeichen erreicht den Tab auch bei geschlossener Seitenleiste", async () => {
  /*
   * Festlegung F2: Der Dienstarbeiter sendet `overlay:gestoppt` selbst. Bis zum
   * 14.08.2026 tat das ausschliesslich die Seitenleiste (panel.js). War sie zu
   * — und genau dafür gibt es das Auge am Symbol —, blieb im Tab der grüne
   * Rahmen stehen, obwohl nichts mehr lief.
   *
   * Gemessen wird ohne Seitenleiste: `panelAntwortet` ist null, jede Nachricht
   * dorthin läuft ins Leere, so wie in Chrome.
   */
  for (const weg of ["schild", "seitenleiste", "tastenkuerzel"]) {
    weltNeu();
    await sitzungAufbauen({ agent: "SMarTrCEO", code: "s-schild", tabId: 7 });
    const ab = welt.spur.length;

    if (weg === "schild") await anWorker({ typ: "notbremse", quelle: "schild" }, ausDemTab(7));
    else if (weg === "seitenleiste") await anWorker({ typ: "link:notaus", grund: "seitenleiste" });
    else tastenkuerzel("notbremse");
    await runden(20);

    const anDenTab = welt.spur
      .slice(ab)
      .filter((e) => e.wohin === "seite" && e.nachricht.typ === "overlay:gestoppt");
    assert.equal(anDenTab.length, 1, `${weg}: Im Tab steht „gestoppt", genau einmal.`);
    assert.equal(anDenTab[0].tabId, 7, `${weg}: und zwar im Tab, für den freigegeben war.`);
  }
});

test("Not-Aus: das Ende bekommt seine Zeile im Buch", async () => {
  weltNeu();
  await sitzungAufbauen({ agent: "SMarTrCEO", code: "s-buch" });
  await link.trennen("notbremse");

  const eintraege = await protokollbuch.lesen();
  const ende = eintraege.filter((e) => e.cmd === "disconnect");
  assert.equal(ende.length, 1, "Genau eine Zeile für das Ende.");
  assert.equal(ende[0].ergebnis, "notbremse", "Und sie sagt, warum Schluss war.");
  assert.equal(ende[0].agent, "SMarTrCEO", "Mit dem Agenten, dem die Sitzung gehörte.");
});

/* ================================================================== *
 * 3. Kein stilles Warten (§8.4)
 * ================================================================== */

test("Kein stilles Warten: ist der Tab weg, kommt eine Absage statt einer Warteschlange", async () => {
  weltNeu();
  /* Tab 99 gibt es in dieser Welt nicht: Die Attrappe kennt nur Tab 7. */
  const draht = await sitzungAufbauen({ agent: "SMarTrCEO", tabId: 99 });
  const abSeite = welt.spur.filter((e) => e.wohin === "seite").length;

  await draht.empfangen({ id: "b1", cmd: "snapshot", reason: "Ich sehe nach.", agent: "SMarTrCEO" });

  const antwort = draht.gesendet.find((r) => r.type === "result" && r.id === "b1");
  assert.ok(antwort, "Der Agent bekommt eine Antwort, und zwar sofort.");
  assert.equal(antwort.success, false);
  assert.equal(antwort.error.code, "tab_gone");
  assert.ok(
    antwort.error.message.includes("nicht mehr da"),
    "Im Klartext steht, was los ist, nicht eine Fehlernummer.",
  );
  assert.equal(
    welt.spur.filter((e) => e.wohin === "seite").length,
    abSeite,
    "Und es ist nichts an irgendeine Seite gegangen. Der Befehl wurde nicht aufgehoben, sondern abgesagt.",
  );

  const eintraege = await protokollbuch.lesen();
  assert.equal(eintraege.length, 1, "Auch die Absage steht im Buch.");
  assert.equal(eintraege[0].ergebnis, "tab_gone");
});

test("Kein stilles Warten: die abgelaufene Frist sagt ab, beendet und wird gebucht", async () => {
  /* Eine Sitzung mit einer Dauer von zwei Millisekunden. Sie ist vorbei, bevor
     der Befehl eintrifft — derselbe Zustand wie nach dreissig verstrichenen
     Minuten, nur ohne dreissig Minuten zu warten. */
  weltNeu();
  const draht = await sitzungAufbauen({ agent: "SMarTrCEO", code: "s-frist", expiry: 0.002 });
  await new Promise((f) => setTimeout(f, 20));

  await draht.empfangen({ id: "b1", cmd: "snapshot", reason: "Ich sehe nach.", agent: "SMarTrCEO" });

  const antwort = draht.gesendet.find((r) => r.type === "result" && r.id === "b1");
  assert.ok(antwort, "Der Agent bekommt eine Antwort, statt in seine eigene Frist zu laufen.");
  assert.equal(antwort.error.code, "frist_abgelaufen");
  assert.equal((await link.zustand()).verbunden, false, "Und die Sitzung ist damit beendet.");

  const eintraege = await protokollbuch.lesen();
  const abgelaufen = eintraege.filter((e) => e.ergebnis === "frist_abgelaufen");
  assert.equal(abgelaufen.length, 1, "Auch die Absage wegen Zeitablauf steht genau einmal im Buch.");
});

test("Kein stilles Warten: eine Fernaktion, eine Zeile im Buch, mit Ort statt Inhalt", async () => {
  /*
   * §8.3 sagt „genau einen Eintrag". Gemessen wird der ganze Weg, nicht die
   * Buchführung dieser Datei allein: Ein Befehl, der den Ausführer erreicht,
   * wird DORT gebucht (sein Eintrag trägt die Aktionsklassen). Die Brücke bucht
   * nur, was den Ausführer nie erreicht hat. Zwei Zeilen für einen Befehl wären
   * derselbe Fehler wie keine.
   */
  weltNeu();
  const draht = await sitzungAufbauen({ agent: "SMarTrCEO" });
  welt.chrome.tabs.get = async () => ({
    id: 7,
    url: "https://geizhals.de/warenkorb?token=streng-geheim#stelle",
    title: "Warenkorb",
    active: true,
    status: "complete",
    windowId: 3,
  });

  await draht.empfangen({ id: "b1", cmd: "snapshot", reason: "Ich sehe nach.", agent: "SMarTrCEO" });
  await draht.empfangen({ id: "b2", cmd: "snapshot", reason: "Ich sehe noch einmal nach.", agent: "SMarTrCEO" });

  const eintraege = await protokollbuch.lesen();
  assert.ok(
    eintraege.length <= 2,
    "Zwei Fernaktionen ergeben höchstens zwei Zeilen. Mehr hiesse: Die Brücke bucht doppelt.",
  );
  assert.equal(
    eintraege.length,
    2,
    "Und mindestens zwei: Je Fernaktion eine Zeile. Fehlen sie, bucht der Ausführer nicht mehr (ausfuehrer.js).",
  );
  for (const e of eintraege) {
    assert.equal(e.cmd, "snapshot");
    assert.equal(
      e.url,
      "https://geizhals.de/warenkorb",
      "Der Ort steht im Buch, die Abfragezeichenkette nicht. Dort stehen Marken und Einmalschlüssel.",
    );
  }
});

/* ================================================================== *
 * 3b. Die Sprache der beiden Zeichen ausserhalb der Seitenleiste (§12)
 * ================================================================== */

test("Sprache: Symboltitel und Systemmeldung kommen aus dem Katalog", async () => {
  /*
   * Befund M10 vom 14.08.2026, gemessen mit `--lang=en-US`: Beide Sätze kamen
   * deutsch, weil sie als Literale im Quelltext standen und an `_locales`
   * vorbeiliefen. Einem englischsprachigen Menschen mit geschlossener
   * Seitenleiste blieb damit kein lesbares Zeichen ausser dem Abzeichen.
   *
   * Der Katalog hier ist englisch. Kommt der Satz aus dem Katalog, steht
   * Englisches da; steht er im Quelltext, steht Deutsches da. Dazwischen gibt
   * es nichts, und genau deshalb misst dieser Prüfsatz die Sache selbst.
   */
  weltNeu({ katalog: KATALOG_EN });
  let ab = welt.spur.length;
  await sitzungAufbauen({ agent: "SMarTrCEO" });

  const z = zeichen(ab);
  assert.equal(z.meldung.length, 1, "Vorbedingung: Die Systemmeldung lief.");
  assert.equal(z.meldung[0].angaben.title, "Cloud session active", "Der Titel kommt aus dem Katalog.");
  assert.equal(
    z.meldung[0].angaben.message,
    "SMarTrCEO is now steering this browser. To stop, press Alt, Shift and S.",
    "Der Satz auch, mitsamt eingesetztem Agentennamen.",
  );

  const titel = welt.spur.slice(ab).filter((e) => e.wohin === "action.setTitle");
  assert.ok(titel.length >= 1, "Der Titel am Symbol wird gesetzt.");
  assert.equal(
    titel[titel.length - 1].title,
    "SMarTrChrome, cloud session active, SMarTrCEO is steering this browser",
    "Und er kommt aus dem Katalog, nicht aus dem Quelltext.",
  );
  await link.trennen("nutzer");

  /* Und ohne Agentennamen der zweite Schlüssel, nicht ein zusammengebauter
     Satz mit einer Lücke darin. */
  weltNeu({ katalog: KATALOG_EN });
  ab = welt.spur.length;
  await sitzungAufbauen({ agent: null, code: "ohne-namen" });
  assert.equal(
    zeichen(ab).meldung[0].angaben.message,
    "An agent is now steering this browser. To stop, press Alt, Shift and S.",
  );
  assert.equal(
    welt.spur.slice(ab).filter((e) => e.wohin === "action.setTitle").pop().title,
    "SMarTrChrome, cloud session active",
  );
});

test("Sprache: nach dem Sitzungsende steht wieder der Titel aus dem Manifest", async () => {
  /*
   * Der zweite Teil von M10: `titelSetzen` schrieb im AUS-Fall den deutschen
   * Satz „SMarTrChrome, Niemand oeffnen" fest und überschrieb damit dauerhaft
   * den Titel aus dem Manifest — der steht dort als `__MSG_ext_symbol_titel__`
   * und ist längst übersetzt. Die leere Zeichenkette ist der einzige Weg, ihn
   * zurückzugeben; jeder eigene Satz an dieser Stelle wäre eine zweite,
   * unübersetzte Fassung daneben.
   */
  weltNeu({ katalog: KATALOG_EN });
  await sitzungAufbauen({ agent: "SMarTrCEO" });
  const ab = welt.spur.length;
  await link.trennen("nutzer");

  const titel = welt.spur.slice(ab).filter((e) => e.wohin === "action.setTitle");
  assert.ok(titel.length >= 1, "Das Ende setzt den Titel zurück.");
  assert.equal(
    titel[titel.length - 1].title,
    "",
    "Leer heisst: Chrome nimmt wieder den übersetzten Titel aus dem Manifest.",
  );
});

/* ================================================================== *
 * 3c. Die Aufzeichnung überlebt den Seitenwechsel (Befund H6)
 * ================================================================== */

test("Aufzeichnung: nach einem Seitenwechsel wird der Aufzeichner im Produktivweg neu eingespielt", async () => {
  /*
   * Befund H6 vom 14.08.2026: `REKORDER_DATEIEN` wurde nur in `rekorderSenden`
   * benutzt, und das lief nur für `rekorder:start` und `rekorder:stop`. Die
   * ganze Wiederaufnahme aus `sa_rekorder` hing damit an einer Funktion, die im
   * Produktivweg nie an die Reihe kam. Ein Ablauf über mehrere Seiten verlor
   * beim ERSTEN Wechsel alles Weitere, lautlos.
   *
   * Deshalb geht dieser Prüfsatz nicht selbst einspielen — genau das machte den
   * bisherigen Satz R17 grün. Er ruft den Hörer, den der Dienstarbeiter bei
   * Chrome angemeldet hat, so wie Chrome ihn bei einer Navigation ruft.
   */
  const gefragt = [];
  /* Wie viele Einspielungen es VOR dem Seitenwechsel gab. Alles davor gehört
     zum alten Dokument; das neue antwortet erst, wenn es neu bestückt ist. */
  let vorDemWechsel = 0;
  weltNeu({
    ablageLocal: aufnahmeAblage(true),
    seiteAntwortet: (n) => {
      gefragt.push(n.typ);
      const eingespielt = welt.spur.filter((e) => e.wohin === "executeScript").length;
      /* Nach einem Seitenwechsel ist das Inhaltsskript weg. Chrome lehnt eine
         Nachricht an ein Dokument ohne Empfänger ab. */
      if (eingespielt <= vorDemWechsel) throw new Error("kein Empfänger");
      return { ok: true, laeuft: true };
    },
  });

  /* Der Mensch startet die Aufzeichnung, auf dem Weg der Seitenleiste. */
  const gestartet = await anWorker({ typ: "rekorder:start", tabId: 7 });
  assert.equal(gestartet.ok, true, "Vorbedingung: Die Aufzeichnung läuft in Tab 7.");
  vorDemWechsel = welt.spur.filter((e) => e.wohin === "executeScript").length;
  assert.equal(vorDemWechsel, 1, "Vorbedingung: Dafür wurde einmal eingespielt.");

  /* Und jetzt der Seitenwechsel. Gerufen wird der Hörer, den der
     Dienstarbeiter bei Chrome angemeldet hat, mit den Angaben, die Chrome
     mitgibt. Dieser Prüfsatz spielt ausdrücklich NICHT selbst ein. */
  tabsAktualisiert(7, { status: "loading", url: "https://www.ebay.de/sh/lst/ended" }, { id: 7 });
  await runden(25);

  assert.ok(
    gefragt.includes("rekorder:ping"),
    "Gefragt wird zuerst, ob dort schon jemand aufzeichnet.",
  );
  const eingespielt = welt.spur.filter((e) => e.wohin === "executeScript");
  assert.equal(eingespielt.length, 2, "Und weil niemand antwortet, wird neu eingespielt.");
  assert.deepEqual(
    eingespielt[1].auftrag.files,
    ["src/content/geheim.js", "src/content/selektor.js", "src/content/rekorder.js"],
    "Die Reihenfolge bleibt verbindlich: `geheim.js` zuerst, dann `selektor.js`, das schreibt, was `rekorder.js` braucht.",
  );
  assert.equal(eingespielt[1].auftrag.target.tabId, 7, "In den Tab, in dem aufgezeichnet wird.");

  /* Ein FREMDER Tab bekommt nichts. Ohne diese Grenze würde aus der Reparatur
     ein Mitschnitt: `content/rekorder.js` nimmt eine gemerkte Aufzeichnung in
     jedem Dokument wieder auf, in das es eingespielt wird. */
  vorDemWechsel = eingespielt.length;
  tabsAktualisiert(9, { status: "loading", url: "https://bank.example/konto" }, { id: 9 });
  await runden(25);
  assert.equal(
    welt.spur.filter((e) => e.wohin === "executeScript").length,
    2,
    "In einen anderen Tab wird nichts eingespielt, auch nicht versuchsweise.",
  );

  /* Und nach dem Beenden zieht auch der eigene Tab nichts mehr nach. */
  await anWorker({ typ: "rekorder:stop", tabId: 7 });
  const nachStop = welt.spur.filter((e) => e.wohin === "executeScript").length;
  tabsAktualisiert(7, { status: "loading", url: "https://www.ebay.de/" }, { id: 7 });
  await runden(25);
  assert.equal(
    welt.spur.filter((e) => e.wohin === "executeScript").length,
    nachStop,
    "Nach dem Beenden zeichnet nichts mehr nach, auch wenn die Ablage noch dasteht.",
  );
});

test("Aufzeichnung: läuft keine, spielt ein Seitenwechsel auch nichts ein", async () => {
  /*
   * Die andere Hälfte derselben Zusage. Eine Erweiterung, die nach jedem
   * Seitenwechsel einen Mitschreiber einspielt, wäre ein Mitschnitt, um den
   * niemand gebeten hat. Gemessen wird beides: gar keine Ablage und eine
   * Ablage, in der die Aufnahme beendet dasteht.
   */
  for (const lage of ["ohne Ablage", "Aufnahme beendet"]) {
    weltNeu(lage === "ohne Ablage" ? {} : { ablageLocal: aufnahmeAblage(false) });
    tabsAktualisiert(7, { status: "loading", url: "https://www.ebay.de/" }, { id: 7 });
    await runden(25);

    assert.equal(
      welt.spur.filter((e) => e.wohin === "executeScript").length,
      0,
      `${lage}: Es wird nichts eingespielt.`,
    );
    assert.equal(
      welt.spur.filter((e) => e.wohin === "seite").length,
      0,
      `${lage}: Und es wird auch nicht nachgefragt.`,
    );
  }
});

/* ================================================================== *
 * 4. Der Dienstarbeiter nach einem Neustart (MV3)
 * ================================================================== */

test("Neustart: eine Sitzung aus einem fremden Leben wird ehrlich beendet, nicht wieder aufgebaut", async () => {
  /*
   * MV3 beendet den Dienstarbeiter im Leerlauf. Wacht er wieder auf, beginnt
   * sein Modulspeicher bei null, die Leitung ist weg — in der Ablage steht die
   * Sitzung aber noch. Erkannt wird das an `ankerLeben`.
   *
   * Wieder aufgebaut wird ausdrücklich nichts: Der Mensch hat eine Verbindung
   * freigegeben, nicht das Recht, sie nachzubilden.
   */
  weltNeu({
    ablageSession: { link_sitzung: sitzungAusFremdemLeben(), ...ausweisAblage() },
  });
  const ab = welt.spur.length;

  const ergebnis = await link.anlaufPruefen();
  assert.deepEqual(
    { gefunden: ergebnis.gefunden, beendet: ergebnis.beendet },
    { gefunden: true, beendet: true },
    "Der Anlauf findet die verwaiste Sitzung und beendet sie.",
  );

  const ablage = await welt.chrome.storage.session.get("link_sitzung");
  assert.deepEqual(ablage, {}, "Sie ist aus der Ablage verschwunden.");
  assert.equal(DrahtAttrappe.letzte && DrahtAttrappe.letzte.readyState, DrahtAttrappe.CLOSED,
    "Es wurde keine neue Leitung aufgebaut.");

  const z = zeichen(ab);
  assert.ok(z.abzeichenWeg.length >= 1, "Das Abzeichen behauptet keine Steuerung mehr.");
  assert.ok(
    welt.spur.slice(ab).some((e) => e.wohin === "panel" && e.nachricht.typ === "link:zustand" && e.nachricht.verbunden === false),
    "Die Seitenleiste erfährt, dass Schluss ist.",
  );
  assert.equal(widerrufe.length, 1, "Und der Relay erfährt es auch, sonst hielte er die Sitzung bis zur Frist offen.");
});

test("Neustart: eine Sitzung aus DIESEM Leben rührt der Anlauf nicht an", async () => {
  weltNeu();
  await sitzungAufbauen({ agent: "SMarTrCEO", code: "s-eigen" });

  const ergebnis = await link.anlaufPruefen();
  assert.equal(ergebnis.beendet, false, "Die eigene, laufende Sitzung wird nicht abgeräumt.");
  const stand = await link.zustand();
  assert.equal(stand.verbunden, true, "Sie läuft weiter.");
  await link.trennen("nutzer");

  /* Und dasselbe an der Lebenskennung allein, ohne Leitung und ohne
     Modulspeicher: Ein Anlauf, der jede Sitzung abräumt, die er findet, wäre
     eine Notbremse mit Zufallsauslöser. */
  weltNeu({
    ablageSession: {
      link_sitzung: sitzungAusFremdemLeben({ ankerLeben: link.LEBEN_KENNUNG, code: "s-selbst" }),
    },
  });
  const zweiter = await link.anlaufPruefen();
  assert.equal(zweiter.beendet, false, "Was diesem Leben gehört, bleibt stehen.");
  const ablage = await welt.chrome.storage.session.get("link_sitzung");
  assert.equal(ablage.link_sitzung.code, "s-selbst", "Der Sitzungssatz liegt unverändert da.");
});

test("Neustart: ohne Sitzung nimmt der Anlauf das Abzeichen weg", async () => {
  weltNeu();
  const ab = welt.spur.length;
  const ergebnis = await link.anlaufPruefen();
  assert.equal(ergebnis.gefunden, false);
  assert.ok(
    zeichen(ab).abzeichenWeg.length >= 1,
    "Ein Abzeichen, das einen Neustart überlebt, behauptet eine Sitzung, die es nicht gibt.",
  );
});

test("Das Buch: JEDES Sitzungsende bekommt seine Zeile, nicht nur das eine über `trennen`", async () => {
  /*
   * Befund N3 vom 14.08.2026: Die Zeile stand in `trennen()`, also auf einem
   * von sechs Wegen. Der `disconnect`-Rahmen des Relays, das `onclose` der
   * Leitung, die gescheiterte Verlängerung, die Wache ohne Leitung und die
   * verwaiste Sitzung aus einem fremden Leben gingen ohne Eintrag durch
   * `sitzungBeenden`. Ein Buch mit Lücken ist als Nachweis wertlos, und es sind
   * gerade die Enden, die der Mensch NICHT selbst ausgelöst hat, nach denen er
   * später sucht.
   *
   * Gemessen wird deshalb über alle Wege, auf denen eine Sitzung in dieser
   * Erweiterung enden kann, und nicht an einem Beispiel.
   */
  const wege = [
    {
      name: "Der Mensch drückt Stopp",
      ergebnis: "notbremse",
      async lauf() {
        await link.trennen("notbremse");
      },
    },
    {
      name: "Der Relay schliesst selbst",
      ergebnis: "relay",
      async lauf(draht) {
        await draht.empfangen({ type: "disconnect", reason: "session_idle" });
      },
    },
    {
      name: "Die Leitung fällt weg",
      ergebnis: "getrennt",
      async lauf(draht) {
        await draht.onclose({ code: 4409 });
      },
    },
    {
      name: "Die Wache findet keine Leitung mehr",
      ergebnis: "verloren",
      async lauf(draht) {
        draht.readyState = DrahtAttrappe.CLOSED;
        await link.wacheLaufen();
      },
    },
    {
      name: "Die Frist ist um",
      ergebnis: "abgelaufen",
      expiry: 0.002,
      async lauf() {
        await new Promise((f) => setTimeout(f, 20));
        await link.wacheLaufen();
      },
    },
    {
      name: "Die Verlängerung scheitert",
      ergebnis: "verloren",
      async lauf(alt) {
        const laeuft = link.verlaengernMit({ ticket: "zweites-ticket", ausweis: "ausweis" });
        laeuft.catch(() => {});
        let neu = DrahtAttrappe.letzte;
        for (let i = 0; i < 100 && neu === alt; i += 1) {
          await new Promise((f) => setImmediate(f));
          neu = DrahtAttrappe.letzte;
        }
        neu.oeffnen();
        await neu.empfangen({ type: "disconnect", reason: "unauthorized" });
        await neu.onclose({ code: 4401 });
        await laeuft.catch(() => {});
      },
    },
  ];

  for (const weg of wege) {
    weltNeu();
    const draht = await sitzungAufbauen({
      agent: "SMarTrCEO",
      code: "s-ende",
      expiry: weg.expiry || 1800,
    });
    assert.deepEqual(await protokollbuch.lesen(), [], `${weg.name}: Vorbedingung, das Buch ist leer.`);

    await weg.lauf(draht);
    await runden(10);

    const enden = (await protokollbuch.lesen()).filter((e) => e.cmd === "disconnect");
    assert.equal(enden.length, 1, `${weg.name}: genau eine Zeile für das Ende, nicht null und nicht zwei.`);
    assert.equal(enden[0].ergebnis, weg.ergebnis, `${weg.name}: und sie sagt, warum Schluss war.`);
    assert.equal(enden[0].agent, "SMarTrCEO", `${weg.name}: mit dem Agenten, dem die Sitzung gehörte.`);
    assert.equal((await link.zustand()).verbunden, false, `${weg.name}: und die Sitzung ist wirklich beendet.`);
  }

  /* Und die Gegenprobe zur Gegenprobe: Der siebte Weg, die verwaiste Sitzung
     aus einem fremden Leben, geht durch dieselbe Stelle. */
  weltNeu({ ablageSession: { link_sitzung: sitzungAusFremdemLeben(), ...ausweisAblage() } });
  await link.anlaufPruefen();
  const verwaist = (await protokollbuch.lesen()).filter((e) => e.cmd === "disconnect");
  assert.equal(verwaist.length, 1, "Auch die verwaiste Sitzung wird gebucht.");
  assert.equal(verwaist[0].ergebnis, "verloren");
});

test("Das Buch: ein Aufruf ins Leere erfindet kein Sitzungsende", async () => {
  /* Die Kehrseite von N3. Der Not-Aus darf gedrückt werden, wenn nichts läuft
     — und dann steht auch nichts im Buch. Eine Zeile ohne Sitzung wäre eine
     Behauptung über etwas, das nie stattgefunden hat. */
  weltNeu();
  await link.trennen("notbremse");
  await link.trennen("nutzer");
  assert.deepEqual(await protokollbuch.lesen(), [], "Kein Ende, keine Zeile.");
});

test("Der 30-Sekunden-Wecker räumt das Protokollbuch mit auf, und es bleibt bei einem Wecker", async () => {
  const alt = Date.now() - 40 * TAG_MS;
  weltNeu({
    ablageLocal: {
      sa_protokollbuch: [
        { zeit: alt, agent: "SMarTrCEO", cmd: "snapshot", url: "https://geizhals.de/", ergebnis: "gelungen", klassen: [] },
        { zeit: Date.now(), agent: "SMarTrCEO", cmd: "snapshot", url: "https://geizhals.de/", ergebnis: "gelungen", klassen: [] },
      ],
    },
  });

  await sitzungAufbauen({ code: "s-wecker" });
  const weckerNamen = new Set(welt.wecker.map((w) => w.name));
  assert.deepEqual(
    [...weckerNamen],
    [link.WECKER_NAME],
    "Die Sitzung legt genau einen Wecker an, den bestehenden.",
  );

  const vorher = await protokollbuch.lesen();
  assert.equal(vorher.length, 2, "Vorbedingung: zwei Einträge, einer davon 40 Tage alt.");

  await link.wacheLaufen();

  const nachher = await protokollbuch.lesen();
  assert.equal(nachher.length, 1, "Der Weckerschlag hat den alten Eintrag wirklich gelöscht.");
  assert.ok(nachher[0].zeit > alt, "Übrig ist der junge.");
  assert.deepEqual(
    [...new Set(welt.wecker.map((w) => w.name))],
    [link.WECKER_NAME],
    "Und es ist kein zweiter Wecker dazugekommen. Ein zweiter Takt wäre ein zweiter Grund, den Dienstarbeiter zu wecken.",
  );
});

/* ================================================================== *
 * 5. Die Nachrichten aus §6 — je eine, die ein Inhaltsskript nicht absetzen kann
 *
 * `absender.tab` setzt Chrome selbst; aus einer Seite heraus ist es nicht
 * fälschbar. Genau daran hängt die Positivliste `ausEigenerOberflaeche`.
 * Gemessen wird jedes Mal beides: die Absage UND dass nichts passiert ist.
 * Eine Absage, nach der die Wirkung trotzdem eintritt, wäre die schlimmste
 * Sorte grüner Prüfsatz.
 * ================================================================== */

test("§6 `modus:setzen` kann ein Inhaltsskript nicht absetzen", async () => {
  weltNeu();
  const antwort = await anWorker({ typ: "modus:setzen", tabId: 7, modus: "auto" }, ausDemTab());
  assert.equal(antwort.ok, false);
  assert.equal(antwort.kennung, "absender_ungueltig");

  const ablage = await welt.chrome.storage.session.get(MODUS_ABLAGE);
  assert.deepEqual(ablage, {}, "Und es steht kein Modus in der Ablage. Eine Seite schaltet sich nicht selbst frei.");
});

test("§6 `modus:setzen` aus der Seitenleiste wirkt wirklich, und der Deckel hält", async () => {
  weltNeu();
  const antwort = await anWorker({ typ: "modus:setzen", tabId: 7, modus: "auto", schritte: 5000 });
  assert.equal(antwort.ok, true);
  assert.equal(antwort.modus, "auto");
  assert.equal(antwort.schritte, 500, "Der Deckel aus befehle.js gilt, auch wenn die Seitenleiste mehr will.");

  const ablage = await welt.chrome.storage.session.get(MODUS_ABLAGE);
  assert.equal(ablage[MODUS_ABLAGE].tabs["7"], "auto", "Gemessen an der echten Ablage, nicht am Rückgabewert.");

  const unbekannt = await anWorker({ typ: "modus:setzen", tabId: 7, modus: "vollgas" });
  assert.equal(unbekannt.ok, false, "Ein unbekannter Modus wird abgelehnt.");
  const danach = await welt.chrome.storage.session.get(MODUS_ABLAGE);
  assert.equal(danach[MODUS_ABLAGE].tabs["7"], "auto", "Und er biegt den bestehenden nicht still um.");
});

test("§6 `modus:stand?` verrät einem Inhaltsskript nichts", async () => {
  weltNeu();
  await anWorker({ typ: "modus:setzen", tabId: 7, modus: "auto" });

  const ausTab = await anWorker({ typ: "modus:stand?", tabId: 7 }, ausDemTab());
  assert.equal(ausTab.modus, "assist", "Die Seite bekommt die Voreinstellung, nicht den echten Stand.");

  const ausPanel = await anWorker({ typ: "modus:stand?", tabId: 7 });
  assert.equal(ausPanel.modus, "auto", "Die eigene Oberfläche bekommt die Wahrheit.");
  assert.equal(ausPanel.schritte, 50, "Ohne eigene Angabe gilt das Schrittlimit aus befehle.js.");
});

test("§6 `link:notaus` kann ein Inhaltsskript nicht absetzen", async () => {
  weltNeu();
  await sitzungAufbauen({ code: "s-notaus-fremd" });

  const antwort = await anWorker({ typ: "link:notaus", grund: "seite" }, ausDemTab());
  assert.equal(antwort.ok, false);
  assert.equal(antwort.kennung, "absender_ungueltig");
  const stand = await link.zustand();
  assert.equal(stand.verbunden, true, "Die Sitzung läuft weiter.");

  /* Aus der Seitenleiste beendet dieselbe Nachricht sie sofort. */
  await anWorker({ typ: "link:notaus", grund: "knopf" });
  await runden();
  assert.equal((await link.zustand()).verbunden, false, "Aus der eigenen Oberfläche wirkt sie.");
});

test("§6 `notbremse` DARF aus dem Tab kommen, das ist die eine Ausnahme", async () => {
  weltNeu();
  await sitzungAufbauen({ code: "s-esc" });

  const antwort = await anWorker({ typ: "notbremse", quelle: "schild" }, ausDemTab());
  assert.equal(antwort.ok, true, "Esc Esc im Tab und der Stoppknopf im Schild müssen wirken.");
  await runden();
  assert.equal((await link.zustand()).verbunden, false, "Und sie wirken wirklich.");
});

test("§6 `rekorder:start` kann ein Inhaltsskript nicht absetzen", async () => {
  weltNeu();
  const antwort = await anWorker({ typ: "rekorder:start", tabId: 7 }, ausDemTab());
  assert.equal(antwort.ok, false);
  assert.equal(antwort.kennung, "absender_ungueltig");
  assert.equal(
    welt.spur.filter((e) => e.wohin === "seite").length,
    0,
    "Es ist nichts an eine Seite gegangen. Eine Seite startet keine Aufzeichnung in einem Tab.",
  );
  assert.equal(
    welt.spur.filter((e) => e.wohin === "executeScript").length,
    0,
    "Und eingespielt wurde auch nichts.",
  );
});

test("§6 `rekorder:stop` kann ein Inhaltsskript nicht absetzen", async () => {
  weltNeu();
  const antwort = await anWorker({ typ: "rekorder:stop", tabId: 7 }, ausDemTab());
  assert.equal(antwort.ok, false);
  assert.equal(antwort.kennung, "absender_ungueltig");
  assert.equal(welt.spur.filter((e) => e.wohin === "seite").length, 0, "Nichts an die Seite.");
});

test("§6 `rekorder:start` aus der Seitenleiste geht an den Tab, mit Selektor vor Rekorder", async () => {
  const gesehen = [];
  weltNeu({
    seiteAntwortet: (nachricht) => {
      gesehen.push(nachricht.typ);
      /* Beim ersten Mal ist noch kein Aufzeichnungsskript da: Chrome lehnt ab.
         Das ist der Weg, auf dem eingespielt wird. */
      if (gesehen.length === 1) throw new Error("kein Empfänger");
      return { ok: true, laeuft: true };
    },
  });

  const antwort = await anWorker({ typ: "rekorder:start", tabId: 7 });
  assert.equal(antwort.ok, true, "Der Tab bestätigt.");

  const eingespielt = welt.spur.filter((e) => e.wohin === "executeScript");
  assert.equal(eingespielt.length, 1, "Eingespielt wird genau einmal, nachdem niemand geantwortet hat.");
  assert.deepEqual(
    eingespielt[0].auftrag.files,
    /* Geändert am 14.08.2026, und begründet: `geheim.js` steht seit Festlegung
       F4 an erster Stelle. Ohne sie sagt `rekorder.js` mit `geheim_fehlt` ab,
       der Teach-Modus startet gar nicht (rekorder.test.mjs R35) — der alte
       Erwartungswert hat die Fassung gemessen, in der der Teach-Modus im
       Betrieb tot war. */
    ["src/content/geheim.js", "src/content/selektor.js", "src/content/rekorder.js"],
    "Die Reihenfolge ist verbindlich: `geheim.js` vor `selektor.js` vor `rekorder.js`.",
  );
});

test("§6 `rekorder:stand` DARF aus dem Tab kommen und geht in die Seitenleiste", async () => {
  weltNeu();
  const ab = welt.spur.length;
  const antwort = await anWorker({ typ: "rekorder:stand", anzahl: 12, laeuft: true }, ausDemTab(7));
  assert.equal(antwort.ok, true);

  const weiter = welt.spur
    .slice(ab)
    .filter((e) => e.wohin === "panel" && e.nachricht.typ === "rekorder:stand");
  assert.equal(weiter.length, 1, "Die Seitenleiste erfährt den Stand.");
  assert.equal(weiter[0].nachricht.anzahl, 12);
  assert.equal(weiter[0].nachricht.tabId, 7, "Aus welchem Tab, setzt Chrome, nicht die Seite.");
});

test("§6 `werkbank:liste` verrät einem Inhaltsskript nichts", async () => {
  weltNeu({
    ablageLocal: {
      sa_workflows: [
        { id: "wf_test", name: "Ein Ablauf", version: 1, steps: [{ type: "wait", ms: 100 }] },
      ],
    },
  });

  const ausTab = await anWorker({ typ: "werkbank:liste" }, ausDemTab());
  assert.deepEqual(ausTab.workflows, [], "Die Seite erfährt nicht, welche Abläufe gespeichert sind.");

  const ausPanel = await anWorker({ typ: "werkbank:liste" });
  assert.equal(ausPanel.workflows.length, 1, "Die eigene Oberfläche bekommt die Liste.");
  assert.equal(ausPanel.workflows[0].id, "wf_test");
});

test("§6 `werkbank:schreiben` kann ein Inhaltsskript nicht absetzen", async () => {
  weltNeu();
  const antwort = await anWorker(
    {
      typ: "werkbank:schreiben",
      workflow: { id: "wf_fremd", name: "Untergeschoben", version: 1, steps: [{ type: "wait", ms: 100 }] },
    },
    ausDemTab()
  );
  assert.equal(antwort.ok, false);
  assert.equal(antwort.kennung, "absender_ungueltig");

  const gespeichert = await werkstatt.workflowsLesen();
  assert.deepEqual(gespeichert, [], "Und in der Ablage steht nichts. Eine Seite schreibt keine Abläufe.");
});

test("§6 `werkbank:schreiben` und `werkbank:loeschen` wirken aus der Seitenleiste wirklich", async () => {
  weltNeu();
  const wf = { id: "wf_echt", name: "Echter Ablauf", version: 1, steps: [{ type: "wait", ms: 100 }] };

  const geschrieben = await anWorker({ typ: "werkbank:schreiben", workflow: wf });
  assert.equal(geschrieben.ok, true);
  assert.equal((await werkstatt.workflowsLesen()).length, 1, "Gemessen an der echten Ablage.");

  const geloescht = await anWorker({ typ: "werkbank:loeschen", id: "wf_echt" });
  assert.equal(geloescht.ok, true);
  assert.deepEqual(await werkstatt.workflowsLesen(), [], "Und weg ist weg.");
});

test("§6 `werkbank:loeschen` kann ein Inhaltsskript nicht absetzen", async () => {
  weltNeu({
    ablageLocal: {
      sa_workflows: [{ id: "wf_bleibt", name: "Bleibt", version: 1, steps: [{ type: "wait", ms: 100 }] }],
    },
  });

  const antwort = await anWorker({ typ: "werkbank:loeschen", id: "wf_bleibt" }, ausDemTab());
  assert.equal(antwort.ok, false);
  assert.equal(antwort.kennung, "absender_ungueltig");
  assert.equal((await werkstatt.workflowsLesen()).length, 1, "Der Ablauf steht noch da.");
});

test("§6 `werkbank:spielen` kann ein Inhaltsskript nicht absetzen", async () => {
  weltNeu();
  const antwort = await anWorker({ typ: "werkbank:spielen", id: "wf_test", params: {} }, ausDemTab());
  assert.equal(antwort.ok, false);
  assert.equal(antwort.kennung, "absender_ungueltig");
  assert.equal(
    welt.spur.filter((e) => e.wohin === "seite").length,
    0,
    "Es ist kein Schritt an eine Seite gegangen.",
  );
});

test("§6 `werkbank:spielen` sagt ohne Verbindung vorher, was fehlt", async () => {
  /*
   * Befund M11 vom 14.08.2026: Ohne Cloud-Sitzung reichte `ablaufSpielen` `{}`
   * weiter und gab die Antwort der Befehlsschleife zurück, „Die Browsersitzung
   * ist beendet". Der Satz sprach von einer Sitzung, die es nie gegeben hatte,
   * und der Knopf konnte in dieser Lage baulich nie etwas tun. Der Vertrag
   * lässt zwei Wege zu: wirklich abspielen oder vorher ehrlich sagen, was
   * fehlt. Gebaut ist der zweite.
   *
   * Die eigentliche Messung steht unten am Buch: Jede Fernaktion, die die
   * Befehlsschleife ERREICHT, bekommt dort ihre Zeile (§8.3), auch die
   * abgelehnte. Bleibt das Buch leer, war der Weg schon davor zu Ende — und
   * genau das soll er sein.
   */
  weltNeu();
  await link.trennen("nutzer");
  const antwort = await anWorker({ typ: "werkbank:spielen", id: "wf_test", params: {} });

  assert.equal(antwort.ok, false, "Ohne Verbindung wird nichts abgespielt.");

  /* Zuerst die Sache selbst, dann erst die Beschriftung: Der Versuch hat gar
     nicht stattgefunden. Jede Fernaktion, die die Befehlsschleife erreicht,
     bekommt dort ihre Zeile, auch die abgelehnte. */
  assert.deepEqual(
    await protokollbuch.lesen(),
    [],
    "Die Befehlsschleife wurde gar nicht erst bemüht: Sie bucht jede Antwort, auch die abgelehnte.",
  );
  assert.equal(
    welt.spur.filter((e) => e.wohin === "seite").length,
    0,
    "Und an keine Seite ist etwas gegangen.",
  );

  assert.equal(antwort.kennung, "keine_sitzung", "Die Absage benennt, was wirklich fehlt.");
  assert.ok(antwort.klartext, "Der Mensch bekommt einen Satz, keine Nummer.");
  assert.ok(
    !/beendet/i.test(antwort.klartext),
    "Und der Satz redet nicht von einer Sitzung, die es nie gab.",
  );
  assert.ok(
    !antwort.klartext.includes(" — "),
    "Kommas statt Gedankenstrichen, der Satz wird vorgelesen.",
  );
  assert.match(antwort.klartext, /verbinde/i, "Er nennt den Weg, der weiterführt.");
});

test("§6 `werkbank:spielen` geht mit Verbindung durch dieselbe Befehlsschleife, nicht durch eine zweite Tür", async () => {
  /*
   * Die andere Hälfte: Was durchkommt, nimmt denselben Weg wie ein
   * Agentenbefehl. Ein Knopf in der Seitenleiste mit eigenem Ausführungspfad
   * wäre genau die zweite Tür, die §7.3 verbietet. Gemessen wird an der Zeile,
   * die ausschliesslich die Befehlsschleife schreibt.
   */
  weltNeu();
  await sitzungAufbauen({ agent: null, code: "s-spielen", stufe: "write" });

  const antwort = await anWorker({ typ: "werkbank:spielen", id: "wf_gibtsnicht", params: {} });
  assert.equal(antwort.ok, false, "Einen Ablauf, den es nicht gibt, spielt niemand ab.");
  assert.ok(antwort.klartext, "Und auch hier ein Satz, keine Nummer.");

  const eintraege = await protokollbuch.lesen();
  assert.equal(eintraege.length, 1, "Die Wiedergabe ist eine Fernaktion und bekommt ihre Zeile.");
  assert.equal(eintraege[0].cmd, "run_workflow", "Geschrieben hat sie die Befehlsschleife.");
  assert.equal(eintraege[0].agent, "", "Ohne Agent: hier hat ein Mensch gedrückt, kein Agent gesteuert.");
});

test("§6 `buch:lesen` verrät einem Inhaltsskript nichts", async () => {
  const jetzt = Date.now();
  weltNeu({
    ablageLocal: {
      sa_protokollbuch: [
        { zeit: jetzt, agent: "SMarTrCEO", cmd: "snapshot", url: "https://bank.example/konto", ergebnis: "gelungen", klassen: [] },
      ],
    },
  });

  const ausTab = await anWorker({ typ: "buch:lesen", von: 0, bis: Infinity }, ausDemTab());
  assert.deepEqual(
    ausTab.eintraege,
    [],
    "Das Buch nennt Adressen. Eine besuchte Seite erführe daraus, wo der Mensch sonst noch war.",
  );

  const ausPanel = await anWorker({ typ: "buch:lesen" });
  assert.equal(ausPanel.eintraege.length, 1, "Die eigene Oberfläche bekommt es.");
});

test("§6 `buch:ausgeben` verrät einem Inhaltsskript nichts", async () => {
  const jetzt = Date.now();
  weltNeu({
    ablageLocal: {
      sa_protokollbuch: [
        { zeit: jetzt, agent: "SMarTrCEO", cmd: "snapshot", url: "https://bank.example/konto", ergebnis: "gelungen", klassen: [] },
      ],
    },
  });

  const ausTab = await anWorker({ typ: "buch:ausgeben" }, ausDemTab());
  assert.equal(ausTab.json, "", "Kein Auszug für eine besuchte Seite.");

  const ausPanel = await anWorker({ typ: "buch:ausgeben" });
  const daten = JSON.parse(ausPanel.json);
  assert.equal(daten.eintraege.length, 1, "Die eigene Oberfläche bekommt die Datei.");
  assert.equal(daten.version, 1);
});
