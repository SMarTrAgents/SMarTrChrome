/*
 * SMarTrChrome — das Protokollbuch der Fernaktionen (Vertrag v3.5 §8.3).
 *
 * Jede Aktion, die aus der Ferne kommt, bekommt genau einen Eintrag:
 * Zeitstempel, Agent, Kommando, Zieladresse, Ergebnis. Er liegt in
 * `chrome.storage.local` unter `sa_protokollbuch`.
 *
 * Warum es dieses Buch gibt: Ein Mensch, der einem Agenten seinen Browser
 * leiht, muss hinterher nachsehen können, was in seinem Namen geschehen ist.
 * Ohne diese Möglichkeit ist die Einzelfreigabe die einzige Auskunft, die er
 * je bekommt, und die ist nach zehn Sekunden vorbei.
 *
 * Und warum es so wenig enthält:
 *
 *   **Die Adresse wird gespeichert, der Seiteninhalt nicht.**
 *
 * Das ist keine Kür, sondern der Grund, warum das Buch überhaupt geführt
 * werden darf. Ein Protokoll, das den Seitentext mitschreibt, ist eine zweite
 * Kopie fremder Daten in einem Speicher, den niemand mehr aufräumt — mit
 * Warenkörben, Krankenkassennachrichten und dem halben Postfach darin. Deshalb
 * ist jedes Feld dieser Datei eine Positivliste, und deshalb ist `aufraeumen`
 * kein Vorschlag, sondern löscht wirklich.
 *
 * Aus demselben Grund fällt die Abfragezeichenkette der Adresse weg. Sie ist
 * der Teil, in dem Suchbegriffe, Sitzungsmarken und Einmalschlüssel stehen;
 * `?token=…` ist Inhalt, nicht Ort. Wer wissen will, was genau geschah, liest
 * das Kommando, nicht die Adresse.
 */

import { BEFEHLE, KLASSEN, adresseZerlegen, saeubern } from "./befehle.js";
import { AGENTEN } from "./matrix.js";

/* Der Ablageschlüssel (§8.3). */
export const BUCH_ABLAGE = "sa_protokollbuch";
export const BUCH_VERSION = 1;

/** Wie lange ein Eintrag steht, wenn niemand etwas anderes sagt (§8.3). */
export const AUFBEWAHRUNG_STANDARD_TAGE = 30;

/*
 * Wo die eingestellte Aufbewahrungsdauer steht.
 *
 * §8.3 verlangt sie einstellbar, nennt aber keinen Schlüssel. Er steht deshalb
 * hier, bei der Ablage, die er betrifft — und nicht in der Seitenleiste, die
 * ihn setzt. Befund vom 14.08.2026 (Verzahnung): Er stand zuerst nur in
 * `panel/werkbank.js`. Damit galt die eingestellte Dauer genau in dem
 * Augenblick, in dem der Mensch auf den Knopf drückte; der 30-Sekunden-Wecker
 * räumte danach wieder mit der Voreinstellung von 30 Tagen auf.
 */
export const AUFBEWAHRUNG_ABLAGE = "sa_buch_tage";

/**
 * Die eingestellte Aufbewahrungsdauer, gemessen. Wirft nie.
 *
 * Was in der Ablage steht, kommt aus der Seitenleiste. Ein unlesbarer Wert
 * ergibt die Voreinstellung, nie „unbegrenzt": Ein Buch, das versehentlich
 * ewig steht, ist genau die Datensammlung, die §8.3 verhindern soll.
 */
export async function aufbewahrungLesen() {
  try {
    const daten = await chrome.storage.local.get(AUFBEWAHRUNG_ABLAGE);
    const tage = Number(daten && daten[AUFBEWAHRUNG_ABLAGE]);
    if (!Number.isFinite(tage) || tage < 0) return AUFBEWAHRUNG_STANDARD_TAGE;
    return Math.min(Math.floor(tage), 3650);
  } catch (_) {
    return AUFBEWAHRUNG_STANDARD_TAGE;
  }
}

/* Wie viele Einträge das Buch höchstens trägt.

   Der Deckel ist die zweite Bremse neben der Frist. `aufraeumen` läuft am
   30-Sekunden-Wecker mit, aber ein Agent, der in einer Stunde zehntausend
   Schritte macht, füllt den Speicher schneller, als eine Tagesfrist ihn
   leert — und ein voller Speicher lässt auch die Sitzung nicht mehr
   schreiben. Ältestes fällt zuerst. */
export const EINTRAEGE_HOECHSTENS = 2000;

const TAG_MS = 24 * 60 * 60 * 1000;

/* Die Felder eines Eintrags. Mehr wird nicht gespeichert, und zwar auch dann
   nicht, wenn der Aufrufer mehr mitgibt: Diese Liste IST die
   Datenminimierung. Ein Feld, das nur „meistens" weggelassen wird, ist
   gespeichert. */
const EINTRAG_FELDER = Object.freeze(["zeit", "agent", "cmd", "url", "ergebnis", "klassen"]);

/**
 * Die Adresse, auf ihren Ort verkürzt: Schema, Wirt, Port, Pfad.
 *
 * Abfrage und Marke fallen weg (siehe Kopf der Datei). Ist die Adresse keine,
 * die diese Erweiterung überhaupt anfassen würde, bleibt das Feld leer — ein
 * Buch, in dem `javascript:…` steht, hätte fremden Code gespeichert.
 */
function ortAus(roh) {
  const z = adresseZerlegen(roh);
  if (!z) return "";
  let pfad = "";
  try {
    pfad = new URL(String(roh)).pathname || "";
  } catch (_) {
    pfad = "";
  }
  return saeubern(`${z.schema}://${z.host}${z.port ? `:${z.port}` : ""}${pfad}`, 200);
}

/**
 * Der Name des Agenten.
 *
 * Steht er auf der Positivliste, wird er unverändert übernommen. Steht er
 * nicht darauf, wird er nicht verschwiegen, sondern entschärft: Dass ein
 * fremder Name angeklopft hat, ist genau die Zeile, die man später sucht.
 * Erlaubt sind dieselben Zeichen, auf die auch der Relay säubert
 * (`[A-Za-z]{1,32}`, §11), erweitert um Ziffern und Strich für den Fall, dass
 * ein späterer Dienst so heisst.
 */
function agentAus(roh) {
  const name = String(roh || "");
  if (AGENTEN.includes(name)) return name;
  return saeubern(name, 32).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
}

/**
 * Das Kommando.
 *
 * Bekannte Befehle stehen wörtlich da. Ein unbekannter wird auf die Zeichen
 * eines Befehlsnamens beschnitten — ein abgelehnter Befehl gehört ins Buch,
 * sein Name ist aber Fremdtext, bis er auf der Liste steht.
 */
function cmdAus(roh) {
  const cmd = String(roh || "");
  if (Object.prototype.hasOwnProperty.call(BEFEHLE, cmd)) return cmd;
  return saeubern(cmd, 40).replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
}

/**
 * Das Ergebnis.
 *
 * Nur Kleinbuchstaben, Ziffern und Unterstrich, höchstens 40 Zeichen — das ist
 * die Form unserer eigenen Fehlercodes (§10) und der Wörter „gelungen" und
 * „abgelehnt". Baulich passt in dieses Feld damit kein Satz von einer fremden
 * Seite, auch dann nicht, wenn ein späterer Aufrufer einen hineinreicht.
 */
function ergebnisAus(roh) {
  return saeubern(roh, 60).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
}

/** Was in der Ablage steht, in einer Form, mit der sich rechnen lässt. */
async function buchLesen() {
  try {
    const daten = await chrome.storage.local.get(BUCH_ABLAGE);
    const roh = daten && daten[BUCH_ABLAGE];
    if (!Array.isArray(roh)) return [];
    return roh.filter((e) => e && typeof e === "object" && Number.isFinite(e.zeit));
  } catch (_) {
    return [];
  }
}

async function buchSchreiben(eintraege) {
  try {
    await chrome.storage.local.set({ [BUCH_ABLAGE]: eintraege });
    return true;
  } catch (_) {
    /* Ein Buch, das sich nicht schreiben lässt, hält keine Sitzung an. Es ist
       eine Auskunft, kein Gate — und ein Gate, das an einem vollen Speicher
       hängt, wäre eine Erweiterung, die bei vollem Speicher nichts mehr tut. */
    return false;
  }
}

/**
 * Einen Eintrag schreiben.
 *
 * @param {object} roh { zeit, agent, cmd, url, ergebnis, klassen }
 * @returns {Promise<{ok:boolean, eintrag:object}>}
 *
 * Wirft nie und gibt immer den Eintrag zurück, den es geschrieben HÄTTE —
 * damit der Aufrufer ihn anzeigen kann, auch wenn die Ablage streikt.
 */
export async function eintragen(roh) {
  const r = roh && typeof roh === "object" ? roh : {};
  const zeit = Number.isFinite(r.zeit) && r.zeit > 0 ? Math.round(r.zeit) : Date.now();

  const eintrag = {
    zeit,
    agent: agentAus(r.agent),
    cmd: cmdAus(r.cmd),
    url: ortAus(r.url),
    ergebnis: ergebnisAus(r.ergebnis),
    /* Nur die Klassen, die es gibt. Eine erfundene Klasse im Buch wäre eine
       Behauptung über eine Prüfung, die nie gelaufen ist. */
    klassen: (Array.isArray(r.klassen) ? r.klassen : []).filter((k) => KLASSEN.includes(k)),
  };

  const alle = await buchLesen();
  alle.push(eintrag);
  /* Ältestes zuerst hinaus, und zwar nach der Zeit und nicht nach der
     Reihenfolge des Einfügens: Ein Eintrag, der mit einem alten Zeitstempel
     nachgereicht wird, soll nicht einen jüngeren verdrängen. */
  alle.sort((a, b) => a.zeit - b.zeit);
  const behalten = alle.length > EINTRAEGE_HOECHSTENS
    ? alle.slice(alle.length - EINTRAEGE_HOECHSTENS)
    : alle;

  const ok = await buchSchreiben(behalten);
  return { ok, eintrag };
}

/**
 * Die Einträge eines Zeitraums, ältester zuerst.
 *
 * @returns {Promise<Array<object>>}
 */
export async function lesen({ von = 0, bis = Infinity } = {}) {
  const abZeit = Number.isFinite(von) ? von : 0;
  const bisZeit = Number.isFinite(bis) ? bis : Infinity;
  const alle = await buchLesen();
  return alle
    .filter((e) => e.zeit >= abZeit && e.zeit <= bisZeit)
    .sort((a, b) => a.zeit - b.zeit);
}

/**
 * Das ganze Buch als JSON-Zeichenkette zum Herunterladen.
 *
 * Wirft nie: Im schlimmsten Fall kommt ein leeres Buch heraus. Ein Mensch, der
 * auf „Ausgeben" drückt, bekommt eine Datei, nicht eine rote Zeile.
 */
export async function ausgeben() {
  const eintraege = await lesen();
  try {
    return JSON.stringify(
      { version: BUCH_VERSION, erzeugt: new Date().toISOString(), eintraege },
      null,
      2
    );
  } catch (_) {
    return JSON.stringify({ version: BUCH_VERSION, erzeugt: new Date().toISOString(), eintraege: [] });
  }
}

/**
 * Alles löschen, was älter ist als `tage`.
 *
 * @returns {Promise<{entfernt:number, geblieben:number}>}
 *
 * Sie löscht wirklich, sie markiert nicht. Eine Aufbewahrungsfrist, die den
 * Eintrag nur ausblendet, ist keine Frist, sondern eine Anzeigeeinstellung —
 * und ein Prüfsatz misst das gegen die echte Ablage.
 *
 * `tage: 0` löscht alles. Das ist gewollt und der Weg für den Knopf „Buch
 * leeren": Wer sein Protokoll loswerden will, soll es loswerden.
 */
export async function aufraeumen(tage = AUFBEWAHRUNG_STANDARD_TAGE) {
  const zahl = Number(tage);
  const frist = Number.isFinite(zahl) && zahl >= 0 ? zahl : AUFBEWAHRUNG_STANDARD_TAGE;
  /* Null Tage heisst „alles", und zwar ausdrücklich und nicht über die
     Rechnung: `Date.now() - 0` liesse einen Eintrag stehen, der in derselben
     Millisekunde geschrieben wurde. Ein Knopf „Buch leeren", der einen Eintrag
     übriglässt, weil der Rechner schnell war, ist kein Knopf „Buch leeren". */
  const grenze = frist <= 0 ? Infinity : Date.now() - frist * TAG_MS;

  const alle = await buchLesen();
  const bleibt = alle.filter((e) => e.zeit >= grenze);
  const entfernt = alle.length - bleibt.length;
  if (entfernt > 0) await buchSchreiben(bleibt);
  return { entfernt, geblieben: bleibt.length };
}

/* Die Feldliste steht auch nach aussen zur Verfügung: Die Seitenleiste zeigt
   das Buch an, und sie soll dieselbe Liste benutzen und nicht eine zweite
   danebenstellen. */
export { EINTRAG_FELDER };
