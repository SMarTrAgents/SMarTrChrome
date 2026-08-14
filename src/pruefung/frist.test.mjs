/*
 * Prüfung der Sitzungsfrist in net/link.js.
 *
 * Aufruf:  node --test src/pruefung/frist.test.mjs
 *
 * Der Befund vom 11.08.2026: Das Ende einer Sitzung hing an `Date.now()`, also
 * an der Uhr des Rechners. Wer sie zurückstellt, verlängert die Sitzung. Wer
 * sie vorstellt, oder wessen Rechner aus dem Ruhezustand aufwacht, beendet sie
 * zu früh. Beides ist eine Sicherheitsfrage: Die Frist ist das einzige
 * Versprechen, das die Sitzung von allein einlöst, ohne dass jemand auf den
 * Stopp-Knopf drückt.
 *
 * Deshalb misst diese Datei mit einer FREMD GESTELLTEN Uhr. `Date.now` und
 * `performance.now` werden hier von Hand geführt: Nur so lässt sich ein
 * Rücksprung der Wanduhr überhaupt herstellen, und nur so ist der Unterschied
 * zwischen „uhrunabhängig" und „hängt an der Uhr" messbar. Eine Prüfung, die
 * echte Zeit vergehen lässt, könnte genau diesen Unterschied nie zeigen.
 *
 * Was hier NICHT geprüft wird: der Handschlag selbst. Er braucht einen echten
 * Relay und einen echten WebSocket, dafür gibt es test_connect.py. Geprüft
 * wird die Rechnung, an der der Handschlag hängt, und der Wecker, der sie
 * durchsetzt.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { attrappeSetzen } from "./chrome-attrappe.mjs";

/* Die Attrappe muss stehen, BEVOR die Module geladen werden: dienste.js liest
   die Fassung beim Laden aus dem Manifest. */
attrappeSetzen();

/* ------------------------------------------------------------------ *
 * Die gestellte Uhr
 *
 * Zwei getrennte Zeiger, weil genau ihr Auseinanderlaufen der Prüfgegenstand
 * ist: `wanduhr` ist Date.now() und darf springen, `zaehler` ist
 * performance.now() und geht nur vorwärts.
 * ------------------------------------------------------------------ */

const echtDateNow = Date.now;
const echtPerformance = globalThis.performance;

let wanduhr = 1_760_000_000_000; // ein fester Zeitpunkt, damit nichts von heute abhängt
let zaehler = 5_000; // der Dienstprozess läuft seit fünf Sekunden

Date.now = () => wanduhr;
globalThis.performance = { now: () => zaehler };

/** Beide Zeiger laufen normal weiter. */
function zeitVergeht(ms) {
  wanduhr += ms;
  zaehler += ms;
}

/** Nur die Wanduhr springt. Der Zähler bleibt, wo er ist. */
function uhrSpringt(ms) {
  wanduhr += ms;
}

const {
  dauerBestimmen,
  ankerNeu,
  budgetVon,
  verbrauchMessen,
  restMs,
  fristAbgelaufen,
  sitzungMitFrist,
  LEBEN_KENNUNG,
  wacheLaufen,
  verbinden,
  verlaengernMit,
  trennen,
} = await import("../net/link.js");

/* Der Widerruf beim Relay ist eine zusätzliche Sicherung und darf in dieser
   Prüfung ins Leere laufen. Ohne diese Zeile griffe er auf das echte Netz. */
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => "application/json" },
  async json() {
    return {};
  },
});

const MINUTE = 60_000;

/** Eine laufende Sitzung, so wie `auth_ok` sie anlegt. */
function sitzungAnlegen(budgetMs = 30 * MINUTE, zusatz = {}) {
  return {
    code: "s-1",
    stufe: "read",
    bereich: ["geizhals.de"],
    modus: "tab",
    schrittmodus: "confirm_each",
    budgetMs,
    ...ankerNeu(0, wanduhr, zaehler),
    endetUm: wanduhr + budgetMs,
    leerlaufSekunden: 0,
    begonnenUm: wanduhr,
    ursprungMuster: null,
    tabId: 7,
    ...zusatz,
  };
}

test.after(() => {
  Date.now = echtDateNow;
  globalThis.performance = echtPerformance;
});

/*
 * Nach jedem Satz wird eine etwaige Sitzung beendet.
 *
 * Das ist nicht Ordnungsliebe, sondern Voraussetzung dafür, dass diese Datei
 * überhaupt rot werden KANN: Eine laufende Sitzung hält einen Herzschlag über
 * `setInterval` am Leben. Scheitert eine Behauptung mittendrin, käme der
 * Prüflauf ohne diese Zeilen nie zum Ende, und ein Lauf, der hängt, sagt
 * niemandem, was kaputt ist.
 */
test.afterEach(async () => {
  await trennen("nutzer");
});

/* ------------------------------------------------------------------ *
 * Erst der Beweis, dass die gestellte Uhr überhaupt ankommt
 *
 * Ohne diesen Prüfsatz wäre alles Folgende ein leeres Versprechen: Griffe der
 * Quelltext an der Attrappe vorbei auf die echte Uhr, blieben die Sprünge
 * unten wirkungslos und jede Prüfung grün.
 * ------------------------------------------------------------------ */

test("die gestellte Uhr wird von link.js wirklich benutzt", () => {
  const s = sitzungAnlegen(10 * MINUTE);
  assert.equal(restMs(s), 10 * MINUTE, "Am Anfang ist die ganze Dauer übrig.");
  zeitVergeht(4 * MINUTE);
  assert.equal(
    restMs(s),
    6 * MINUTE,
    "Vier Minuten sind vergangen, sechs müssen übrig sein. Kommt hier etwas anderes heraus, " +
      "misst der Quelltext nicht mit der Uhr dieser Prüfung.",
  );
});

/* ------------------------------------------------------------------ *
 * a) Die Wanduhr springt zurück
 * ------------------------------------------------------------------ */

test("Uhr zwei Stunden zurück: die Sitzung endet trotzdem pünktlich", () => {
  const s = sitzungAnlegen(30 * MINUTE);

  /* 20 Minuten laufen normal. */
  zeitVergeht(20 * MINUTE);
  assert.equal(fristAbgelaufen(s), false, "Nach 20 von 30 Minuten läuft die Sitzung noch.");

  /* Jetzt stellt jemand die Systemzeit um zwei Stunden zurück. Nach der alten
     Rechnung (`Date.now() >= endetUm`) hätte die Sitzung damit zwei Stunden
     geschenkt bekommen. */
  uhrSpringt(-2 * 60 * MINUTE);
  assert.ok(
    Date.now() < s.endetUm,
    "Vorbedingung: Nach dem Rücksprung liegt die Wanduhr vor dem alten Endzeitpunkt. " +
      "Ohne diese Lage prüft der Satz unten nichts.",
  );
  assert.equal(
    restMs(s),
    10 * MINUTE,
    "Ein Rücksprung der Wanduhr darf keine Sekunde schenken. Übrig sind weiter 10 Minuten.",
  );

  /* Die restlichen 10 Minuten der DAUER laufen ab, die Wanduhr steht dabei
     immer noch zwei Stunden vor dem alten Endzeitpunkt. */
  zeitVergeht(10 * MINUTE);
  assert.ok(
    Date.now() < s.endetUm,
    "Vorbedingung: Die Wanduhr hat den alten Endzeitpunkt immer noch nicht erreicht.",
  );
  assert.equal(
    fristAbgelaufen(s),
    true,
    "Die vereinbarten 30 Minuten sind verbraucht. Die Sitzung ist beendet, auch wenn die " +
      "zurückgestellte Wanduhr etwas anderes behauptet.",
  );
  assert.equal(restMs(s), 0, "Und es ist nichts mehr übrig.");
});

/* ------------------------------------------------------------------ *
 * b) Die Wanduhr springt vor
 * ------------------------------------------------------------------ */

test("Uhr springt vor: die Sitzung endet nicht vorzeitig", () => {
  const s = sitzungAnlegen(30 * MINUTE);
  zeitVergeht(5 * MINUTE);

  /* Zeitumstellung, NTP-Sprung oder Aufwachen aus dem Ruhezustand: Die
     Wanduhr steht plötzlich drei Stunden weiter, der Dienstprozess lief die
     ganze Zeit durch. */
  uhrSpringt(3 * 60 * MINUTE);
  assert.ok(
    Date.now() > s.endetUm,
    "Vorbedingung: Nach dem Sprung liegt die Wanduhr hinter dem Endzeitpunkt. " +
      "Genau hier hätte die alte Rechnung abgebrochen.",
  );
  assert.equal(
    fristAbgelaufen(s),
    false,
    "Von der Dauer sind erst 5 von 30 Minuten verbraucht. Ein Sprung der Wanduhr beendet " +
      "die Sitzung nicht.",
  );
  assert.equal(restMs(s), 25 * MINUTE, "Übrig sind weiter 25 Minuten.");

  /* Und die Anzeige lügt auch nicht: Sie folgt der Dauer, nicht dem alten
     Zeitpunkt. */
  assert.equal(
    sitzungMitFrist(s).endetUm,
    Date.now() + 25 * MINUTE,
    "Die Restzeit für die Karte wird aus der Dauer hergeleitet, nicht aus dem alten Endzeitpunkt.",
  );
});

/* ------------------------------------------------------------------ *
 * c) und d) `expires_at` ist die zweite Grenze
 * ------------------------------------------------------------------ */

test("expires_at VOR dem Dauerende: das frühere gewinnt", () => {
  const budget = dauerBestimmen(
    { expiry: 1800, expires_at: new Date(wanduhr + 10 * MINUTE).toISOString() },
    wanduhr,
  );
  assert.equal(
    budget,
    10 * MINUTE,
    "Der Server nennt 30 Minuten Dauer, sein Endzeitpunkt liegt aber schon in 10 Minuten. " +
      "Es gilt der frühere von beiden.",
  );

  const s = sitzungAnlegen(budget);
  zeitVergeht(10 * MINUTE);
  assert.equal(fristAbgelaufen(s), true, "Nach 10 Minuten ist die Sitzung beendet, nicht nach 30.");
});

test("expires_at NACH dem Dauerende: die Dauer gewinnt, der Server verlängert nicht", () => {
  const budget = dauerBestimmen(
    { expiry: 600, expires_at: new Date(wanduhr + 4 * 60 * MINUTE).toISOString() },
    wanduhr,
  );
  assert.equal(
    budget,
    10 * MINUTE,
    "Der Server nennt 10 Minuten Dauer und einen Endzeitpunkt in vier Stunden. " +
      "Verlängern darf er nicht, es bleiben 10 Minuten.",
  );

  const s = sitzungAnlegen(budget);
  zeitVergeht(10 * MINUTE);
  assert.equal(
    fristAbgelaufen(s),
    true,
    "Nach 10 Minuten ist die Sitzung beendet. Der spätere Endzeitpunkt des Servers hält sie nicht offen.",
  );
});

test("expires_at allein trägt die Frist, ein vergangenes expires_at trägt keine", () => {
  /* Nennt der Server nur den Zeitpunkt, ist er die einzige Angabe. */
  assert.equal(
    dauerBestimmen({ expires_at: new Date(wanduhr + 15 * MINUTE).toISOString() }, wanduhr),
    15 * MINUTE,
    "Ohne `expiry` wird aus `expires_at` die Dauer.",
  );
  /* Liegt er in der Vergangenheit, ist die Sitzung schon vorbei, bevor sie
     beginnt. Aus null Dauer baut `verbinden` keine Verbindung auf. */
  assert.equal(
    dauerBestimmen({ expiry: 1800, expires_at: new Date(wanduhr - MINUTE).toISOString() }, wanduhr),
    0,
    "Ein Endzeitpunkt in der Vergangenheit ergibt keine Dauer.",
  );
  assert.equal(dauerBestimmen({ expiry: 0 }, wanduhr), 0, "Dauer null ist keine Frist.");
  assert.equal(dauerBestimmen({}, wanduhr), 0, "Ohne jede Angabe gibt es keine Frist.");
});

/* ------------------------------------------------------------------ *
 * e) Der Dienstarbeiter hat zwischendurch geschlafen
 * ------------------------------------------------------------------ */

test("der Dienstarbeiter schlief: die verbrauchte Zeit geht nicht verloren", () => {
  /* Ausgangslage: 30 Minuten Dauer, 8 Minuten sind gelaufen und beim letzten
     Weckerschlag festgeschrieben worden. Dann stirbt der Dienstprozess. */
  const s = sitzungAnlegen(30 * MINUTE);
  zeitVergeht(8 * MINUTE);
  const festgeschrieben = { ...s, ...ankerNeu(verbrauchMessen(s), wanduhr, zaehler) };
  assert.equal(festgeschrieben.verbrauchtMs, 8 * MINUTE, "Acht Minuten stehen in der Ablage.");

  /* Der Prozess schläft 12 Minuten. Danach wacht er wieder auf: Sein
     `performance.now()` beginnt bei null, und der Anker gehört einem anderen
     Leben. Nachgestellt wird das über eine fremde Lebenskennung und einen
     Zähler, der ganz von vorn anfängt. */
  const geschlafen = { ...festgeschrieben, ankerLeben: "ein-anderes-leben" };
  wanduhr += 12 * MINUTE;
  zaehler = 3_000; // der neue Prozess läuft seit drei Sekunden

  assert.equal(
    verbrauchMessen(geschlafen),
    20 * MINUTE,
    "Acht Minuten vor dem Schlaf plus zwölf Minuten Schlaf. Der Schlaf ist keine geschenkte Zeit.",
  );
  assert.equal(restMs(geschlafen), 10 * MINUTE, "Übrig sind zehn Minuten.");

  /* Und die Gegenprobe: Wird währenddessen die Wanduhr zurückgestellt, zählt
     wenigstens die Laufzeit des neuen Prozesses. Verloren geht der bereits
     festgeschriebene Verbrauch nie. */
  wanduhr -= 60 * MINUTE;
  assert.equal(
    verbrauchMessen(geschlafen),
    8 * MINUTE + 3_000,
    "Eine zurückgestellte Wanduhr macht aus acht verbrauchten Minuten keine null, " +
      "und die Laufzeit des neuen Prozesses zählt weiter mit.",
  );
});

test("im selben Leben zählt allein die monotone Uhr, nicht die Wanduhr", () => {
  const s = sitzungAnlegen(30 * MINUTE);
  assert.equal(s.ankerLeben, LEBEN_KENNUNG, "Der Anker gehört diesem Dienstprozess.");
  zeitVergeht(3 * MINUTE);
  uhrSpringt(90 * MINUTE);
  assert.equal(
    verbrauchMessen(s),
    3 * MINUTE,
    "Der Sprung der Wanduhr wird nicht mitgezählt, solange derselbe Prozess läuft.",
  );
});

/* ------------------------------------------------------------------ *
 * f) Verlängern setzt die Rechnung nicht zurück
 * ------------------------------------------------------------------ */

test("Altbestand ohne Dauer: die Frist wird aus den alten Feldern hergeleitet", () => {
  /* Sitzungssätze aus der Zeit vor dieser Runde kennen `budgetMs` nicht. Sie
     dürfen deshalb nicht plötzlich ohne Frist dastehen. */
  const alt = {
    endetUm: wanduhr + 20 * MINUTE,
    begonnenUm: wanduhr - 10 * MINUTE,
  };
  assert.equal(budgetVon(alt), 30 * MINUTE, "Aus Beginn und Ende wird die Dauer.");
  assert.equal(budgetVon(null), 0, "Ohne Sitzung gibt es keine Dauer.");
});

/* Die beiden Sätze zum Verlängern stehen weiter unten, bei den Prüfungen mit
   echter Leitung: Was `verlaengernMit` mit der Rechnung macht, lässt sich nur
   an `verlaengernMit` selbst messen. Eine Nachrechnung im Prüfsatz wäre eine
   zweite Fassung desselben Gedankens und bliebe grün, wenn die erste bricht. */

/* ------------------------------------------------------------------ *
 * g) Der ganze Weg: Handschlag, Wecker, Ende
 *
 * Die Sätze oben messen die Rechnung. Die folgenden messen, dass sie jemand
 * anwendet — ohne sie könnte die Rechnung stimmen und die Sitzung trotzdem
 * weiterlaufen. Dafür braucht es eine Leitung, also eine Attrappe des
 * WebSockets, und eine Ablage, die sich etwas merkt (die Chrome-Attrappe
 * vergisst absichtlich alles).
 * ------------------------------------------------------------------ */

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
  /** So meldet sich der Relay: erst das Unterprotokoll, dann die Rahmen. */
  oeffnen(protokoll = "smartrlink.v2") {
    this.readyState = DrahtAttrappe.OPEN;
    this.protocol = protokoll;
    if (this.onopen) this.onopen();
  }
  empfangen(rahmen) {
    return this.onmessage ? this.onmessage({ data: JSON.stringify(rahmen) }) : undefined;
  }
}

/** Eine Ablage, die sich etwas merkt. */
function ablageStellen(inhalt = {}) {
  const topf = { ...inhalt };
  globalThis.chrome.storage.session = {
    async get(schluessel) {
      return schluessel in topf ? { [schluessel]: topf[schluessel] } : {};
    },
    async set(daten) {
      Object.assign(topf, daten);
    },
    async remove(schluessel) {
      delete topf[schluessel];
    },
  };
  return topf;
}

/**
 * Baut eine Sitzung wirklich auf, über `verbinden` und den echten Handschlag.
 * `auth_ok` bekommt keinen `code`, damit der Widerruf beim Server unterbleibt
 * — geprüft wird hier die Frist, nicht die Notbremse.
 */
async function aufbauen(authZusatz = {}) {
  const topf = ablageStellen();
  const gemeldet = [];
  globalThis.chrome.runtime.sendMessage = async (nachricht) => {
    gemeldet.push(nachricht);
  };
  globalThis.WebSocket = DrahtAttrappe;

  const laeuft = verbinden({ ticket: "einweg-ticket", ausweis: "ausweis" });
  const draht = DrahtAttrappe.letzte;
  draht.oeffnen();
  await draht.empfangen({
    type: "auth_ok",
    code: "",
    access: "read",
    allow: ["geizhals.de"],
    mode: "tab",
    step_mode: "confirm_each",
    expiry: 1800,
    ...authZusatz,
  });
  const stand = await laeuft;
  return { topf, gemeldet, draht, stand };
}

test("der Handschlag legt eine Dauer an, keine Uhrzeit", async () => {
  const { topf, draht } = await aufbauen();
  const s = topf.link_sitzung;
  assert.equal(s.budgetMs, 30 * MINUTE, "Aus expiry 1800 werden 30 Minuten Dauer.");
  assert.equal(s.verbrauchtMs, 0, "Verbraucht ist noch nichts.");
  assert.equal(s.ankerLeben, LEBEN_KENNUNG, "Der Anker gehört diesem Dienstprozess.");
  assert.equal(s.endetUm, wanduhr + 30 * MINUTE, "Und `endetUm` folgt der Dauer.");
  assert.deepEqual(
    draht.angeboten,
    ["smartrlink.v2", "einweg-ticket"],
    "Das Einweg-Ticket steht als letztes Unterprotokoll.",
  );
  await trennen("nutzer");
});

test("der Handschlag nimmt das frühere von Dauer und expires_at", async () => {
  /* Der Server bietet 30 Minuten an, nennt aber einen Endzeitpunkt in 10.
     Verkürzen darf er, also gelten 10 Minuten. */
  const { topf } = await aufbauen({ expires_at: new Date(wanduhr + 10 * MINUTE).toISOString() });
  assert.equal(topf.link_sitzung.budgetMs, 10 * MINUTE, "Das frühere Ende gewinnt.");
  await trennen("nutzer");
});

test("eine Sitzung ohne klares Ende wird nicht angenommen", async () => {
  ablageStellen();
  globalThis.chrome.runtime.sendMessage = async () => {};
  globalThis.WebSocket = DrahtAttrappe;

  const laeuft = verbinden({ ticket: "einweg-ticket", ausweis: "ausweis" });
  const draht = DrahtAttrappe.letzte;
  draht.oeffnen();
  await draht.empfangen({ type: "auth_ok", code: "", access: "read", expiry: 0 });

  await assert.rejects(
    laeuft,
    (fehler) => {
      assert.equal(fehler.kennung, "ohne_ende");
      assert.equal(
        fehler.klartext,
        "Unser Dienst wollte eine Verbindung ohne klares Ende aufbauen. Das lasse ich nicht zu.",
      );
      return true;
    },
    "Ohne Dauer und ohne Endzeitpunkt kommt keine Sitzung zustande.",
  );
});

test("der Wecker beendet die Sitzung, wenn die Dauer verbraucht ist", async () => {
  const { topf, gemeldet } = await aufbauen();

  /* Erst 29 Minuten: Die Sitzung muss stehenbleiben, und der Wecker muss den
     Verbrauch festschreiben. Ohne dieses Festschreiben ginge er verloren,
     sobald der Dienstprozess einschläft. */
  zeitVergeht(29 * MINUTE);
  await wacheLaufen();
  assert.ok(topf.link_sitzung, "Nach 29 von 30 Minuten läuft die Sitzung weiter.");
  assert.equal(
    topf.link_sitzung.verbrauchtMs,
    29 * MINUTE,
    "Der Wecker schreibt den Verbrauch fest.",
  );
  assert.equal(
    topf.link_sitzung.endetUm,
    wanduhr + MINUTE,
    "Und er führt die Anzeigezeit nach, damit die Karte keine Restzeit erfindet.",
  );

  /* Jetzt stellt jemand die Wanduhr um zwei Stunden zurück und lässt die
     letzte Minute der Dauer verstreichen. */
  const vorherigesEnde = topf.link_sitzung.endetUm;
  uhrSpringt(-2 * 60 * MINUTE);
  zeitVergeht(MINUTE);
  assert.ok(
    Date.now() < vorherigesEnde,
    "Vorbedingung: Die zurückgestellte Wanduhr liegt vor dem gespeicherten Endzeitpunkt.",
  );

  const vorher = gemeldet.length;
  await wacheLaufen();

  assert.equal(
    topf.link_sitzung,
    undefined,
    "Die vereinbarte Zeit ist um, also ist die Sitzung aus der Ablage verschwunden. " +
      "Eine zurückgestellte Wanduhr hält sie nicht am Leben.",
  );
  const ende = gemeldet
    .slice(vorher)
    .filter((n) => n && n.typ === "link:zustand" && n.verbunden === false);
  assert.equal(ende.length, 1, "Der Mensch wird genau einmal über das Ende unterrichtet.");
  assert.equal(
    ende[0].klartext,
    "Die vereinbarte Zeit ist um. Die Verbindung ist beendet.",
    "Und er hört den Satz, der erklärt, warum Schluss ist, nicht den von der abgerissenen Leitung.",
  );
});

/* ------------------------------------------------------------------ *
 * h) Verlängern setzt die Rechnung nur zurück, wenn der Mensch verlängert hat
 * ------------------------------------------------------------------ */

/** Wartet, bis `verlaengernMit` eine neue Leitung aufgebaut hat. */
async function neueLeitungAbwarten(vorher, versuche = 100) {
  for (let i = 0; i < versuche; i += 1) {
    if (DrahtAttrappe.letzte !== vorher) return DrahtAttrappe.letzte;
    await new Promise((fertig) => setImmediate(fertig));
  }
  throw new Error("Es wurde keine neue Leitung aufgebaut.");
}

test("nur die Leitung getauscht: die Rechnung läuft weiter", async () => {
  /* Der Relay meldet auf den zweiten Handschlag DIESELBE Sitzung, gleicher
     `code`. Dann hat niemand etwas neu bewilligt, und die verbrauchte Zeit
     bleibt verbraucht. Sonst wäre „verlängern" ein Weg, die Frist beliebig
     oft von vorn beginnen zu lassen. */
  const { topf, draht } = await aufbauen({ code: "sitzung-eins" });
  zeitVergeht(25 * MINUTE);

  const laeuft = verlaengernMit({ ticket: "zweites-ticket", ausweis: "ausweis" });
  const neu = await neueLeitungAbwarten(draht);
  neu.oeffnen();
  /* Der Relay bietet dabei wieder volle 30 Minuten an. */
  await neu.empfangen({
    type: "auth_ok",
    code: "sitzung-eins",
    access: "read",
    allow: ["geizhals.de"],
    mode: "tab",
    step_mode: "confirm_each",
    expiry: 1800,
  });
  await laeuft;

  assert.equal(
    topf.link_sitzung.verbrauchtMs,
    25 * MINUTE,
    "Die 25 verbrauchten Minuten bleiben verbraucht.",
  );
  assert.equal(
    restMs(topf.link_sitzung),
    5 * MINUTE,
    "Es bleiben die 5 Minuten, die übrig waren. Der Relay kann auf derselben Sitzung nicht verlängern.",
  );

  zeitVergeht(5 * MINUTE);
  await wacheLaufen();
  assert.equal(topf.link_sitzung, undefined, "Und nach diesen 5 Minuten ist Schluss.");
});

test("hat der Mensch wirklich verlängert, beginnt die Rechnung von vorn", async () => {
  /* Der Unterschied zum Satz darüber ist der neue `code`: Ein vollständiger
     Freigabeweg mit frischem Einweg-Ticket führt beim Relay zu einer NEUEN
     Sitzung. Nur dann darf die Rechnung bei null anfangen. */
  const { topf, draht } = await aufbauen({ code: "sitzung-eins" });
  zeitVergeht(25 * MINUTE);

  const laeuft = verlaengernMit({ ticket: "zweites-ticket", ausweis: "ausweis" });
  const neu = await neueLeitungAbwarten(draht);
  neu.oeffnen();
  await neu.empfangen({
    type: "auth_ok",
    code: "sitzung-zwei",
    access: "read",
    allow: ["geizhals.de"],
    mode: "tab",
    step_mode: "confirm_each",
    expiry: 1800,
  });
  await laeuft;

  assert.equal(topf.link_sitzung.code, "sitzung-zwei", "Es ist eine andere Sitzung.");
  assert.equal(topf.link_sitzung.verbrauchtMs, 0, "Die neue Sitzung beginnt bei null.");
  assert.equal(restMs(topf.link_sitzung), 30 * MINUTE, "Und sie hat die vollen 30 Minuten.");
  await trennen("nutzer");
});

test("nach Ablauf der Dauer wird kein Befehl mehr ausgeführt", async () => {
  const { topf, draht } = await aufbauen();

  /* Die Dauer ist verbraucht, der nächste Befehl des Agenten trifft aber noch
     vor dem nächsten Weckerschlag ein. */
  zeitVergeht(31 * MINUTE);
  await draht.empfangen({ id: "b1", cmd: "read_page" });

  const antwort = draht.gesendet.find((r) => r.type === "result" && r.id === "b1");
  assert.ok(antwort, "Der Agent bekommt trotzdem eine Antwort, sonst wartet er bis zu seiner Frist.");
  assert.equal(antwort.success, false, "Ausgeführt wird nichts mehr.");
  assert.equal(antwort.error.code, "frist_abgelaufen");
  assert.equal(
    antwort.error.message,
    "Die vereinbarte Zeit ist um. Die Verbindung ist beendet.",
    "Und im Klartext steht, warum.",
  );
  assert.equal(topf.link_sitzung, undefined, "Die Sitzung ist damit beendet.");
});
