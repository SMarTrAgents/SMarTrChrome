/*
 * SMarTrChrome — gemeinsame Netzgrundlage.
 *
 * Warum eine eigene Datei: Adressen, Fristen und Fehlertexte dürfen nicht an
 * drei Stellen leicht verschieden stehen. Zieht der Betrieb eine Adresse um,
 * ist hier genau eine Zeile zu ändern — nicht drei Dateien zu durchsuchen.
 *
 * Zwei Regeln, die dieser Datei ihre Form geben:
 *
 *  - Jede Anfrage hat eine Frist. Ohne Frist wartet die Erweiterung stumm,
 *    und stummes Warten ist für jemanden, der schlecht sieht, nicht von
 *    „kaputt" zu unterscheiden.
 *  - Jeder Fehler hat einen Satz in der Sprache von Niemand: kein Fachwort,
 *    keine Nummer, und immer der nächste Schritt. Die technische Kennung
 *    bleibt trotzdem am Fehler hängen, damit der Aufrufer unterscheiden kann.
 */

/*
 * Drei Adressen, drei Rollen — und sie sind bewusst nicht dieselbe
 * (DRAHTFORMAT E12).
 *
 * CLOUD_URSPRUNG ist der Ursprung der Freigabeseite. Er ist der Anker der
 * Herkunftsbindung: Nur wer wirklich dort läuft, darf freigeben. Genau deshalb
 * darf die Erweiterung in diesem Ursprung KEINE Skripte ausführen — hätte sie
 * die Berechtigung, wären ihre eigenen Anfragen echte Anfragen dieses
 * Ursprungs, und jede Kopfzeilenprüfung wäre wertlos (DRAHTFORMAT §7.3).
 * Die Erweiterung öffnet ihn ausschließlich als Tab; chrome.tabs.create
 * braucht dafür keine Berechtigung.
 *
 * GATEWAY_BASIS ist der Weg für den Freigabeweg (/api/v1/link/*),
 * RELAY_BASIS der Weg für die Sitzung (/api/v1/browser/*). Beide sind im
 * Manifest freigegeben, cloud.smartragents.ai ist es nicht.
 */
export const CLOUD_URSPRUNG = "https://cloud.smartragents.ai";
export const GATEWAY_BASIS = "https://api.smartragents.ai";
export const RELAY_BASIS = "https://connect.smartragents.ai";

/* SMarTrLink-Relay. Kein ?token= im URL — Anmeldedaten haben in Zugriffslogs
   und Proxy-Historien nichts verloren (spec-01, V9). Das Einweg-Ticket steht
   im Unterprotokoll, hinter UNTERPROTOKOLL (DRAHTFORMAT E2). */
export const RELAY_WS = "wss://connect.smartragents.ai/ws/browser";
export const UNTERPROTOKOLL = "smartrlink.v2";

export const KLIENT = "smartrchrome";
export const VERSION = chrome.runtime.getManifest().version;

/* Was diese Erweiterung dem Relay über sich zusagen darf. Bewusst kurz:
   hier steht nur, was wirklich gebaut ist. Sobald die Werkzeugschicht steht,
   kommen ax_snapshot und grant_v1 dazu — nicht vorher. */
export const FAEHIGKEITEN = ["event_v1"];

/* Fristen in Millisekunden. */
export const FRIST_ANFRAGE = 12000;
export const FRIST_AUTH = 20000; // Der Relay wartet 20 s auf den auth-Frame.
export const HERZSCHLAG_MS = 20000; // unter der 30-s-Leerlauffrist des Service Workers

export class NetzFehler extends Error {
  constructor(kennung, klartext, status = 0) {
    super(`${kennung}: ${klartext}`);
    this.name = "NetzFehler";
    this.kennung = kennung;
    this.klartext = klartext;
    this.status = status;
  }
}

const TEXTE = {
  abgebrochen: "Ich habe abgebrochen. Es ist nichts passiert.",
  frist: "Unser Dienst antwortet gerade nicht. Ich habe aufgehört zu warten, damit du nicht hängen bleibst.",
  netz: "Ich erreiche unseren Dienst gerade nicht. Prüfe bitte deine Internetverbindung und versuche es noch einmal.",
  unerwartet: "Unser Dienst hat mir etwas geantwortet, mit dem ich nichts anfangen kann. Bitte versuche es später noch einmal.",
  nicht_da: "Die Browsersteuerung ist bei uns noch nicht eingerichtet. Ich kann darum noch keine Verbindung aufbauen.",
  anmeldung: "Deine Anmeldung gilt nicht mehr. Melde dich bitte in der Cloud neu an, dann geht es weiter.",
  kein_abo: "Für die Browsersteuerung brauchst du ein laufendes Abo. In der Cloud kannst du eines buchen.",
  fremd: "Dieser Browser darf die Steuerung nicht anfragen.",
  agb: "Es gibt neue Nutzungsbedingungen. Bitte bestätige sie einmal in der Cloud, dann versuche ich es erneut.",
  zu_oft: "Das waren gerade zu viele Versuche kurz hintereinander. Warte bitte eine Minute.",
  weg: "Die Anfrage ist abgelaufen. Bitte baue die Verbindung noch einmal neu auf.",
  serverfehler: "Bei uns ist gerade etwas schiefgegangen. Bitte versuche es in ein paar Minuten noch einmal.",
};

/* Statuscode → Klartext. Der Katalog folgt spec-01, Abschnitt 3.2. */
function fehlerAus(status, daten) {
  const kennungen = {
    401: ["anmeldung", TEXTE.anmeldung],
    402: ["kein_abo", TEXTE.kein_abo],
    403: ["fremd", TEXTE.fremd],
    404: ["nicht_da", TEXTE.nicht_da],
    410: ["weg", TEXTE.weg],
    429: ["zu_oft", TEXTE.zu_oft],
    451: ["agb", TEXTE.agb],
  };
  const treffer = kennungen[status];
  if (treffer) return new NetzFehler(treffer[0], treffer[1], status);
  if (status >= 500) return new NetzFehler("serverfehler", TEXTE.serverfehler, status);
  /* Alles Übrige ist aus Sicht des Nutzers dasselbe: der Weg steht noch nicht.
     Die Kennung des Servers wird nur mitgeführt, nie angezeigt. */
  const kennung = (daten && (daten.error || daten.detail)) || "unerwartet";
  return new NetzFehler(String(kennung), TEXTE.unerwartet, status);
}

/*
 * Eine Anfrage ans Gateway (den Freigabeweg unter /api/v1/link/*).
 *
 * Der Relay wird hier bewusst nicht bedient: Der einzige Aufruf dorthin ist
 * der Widerruf, und der darf nie eine Ausnahme werfen und nie an einer
 * Inhaltsart hängenbleiben. Er steht deshalb als nacktes `fetch` in link.js.
 *
 * `ausweis` ist das Alltags-Token aus der Cloud-Sitzung. Es dient
 * ausschließlich der Identifikation — es begründet keine Steuerbefugnis.
 * Die entsteht erst durch das Einweg-Ticket (siehe ticket.js).
 */
export async function anfragen(
  pfad,
  {
    methode = "GET",
    koerper = null,
    ausweis = null,
    frist = FRIST_ANFRAGE,
    signal = null,
    kopfzeilen = null,
  } = {}
) {
  if (signal && signal.aborted) throw new NetzFehler("abgebrochen", TEXTE.abgebrochen);

  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort("frist"), frist);
  const weiterreichen = () => abbruch.abort("abgebrochen");
  if (signal) signal.addEventListener("abort", weiterreichen, { once: true });

  const kopf = { Accept: "application/json" };
  if (koerper) kopf["Content-Type"] = "application/json";
  if (ausweis) kopf.Authorization = `Bearer ${ausweis}`;
  /* Zusätzliche Kopfzeilen des Aufrufers — z. B. `X-Client` für das
     Chat-Zugangstor des Gateways. Sie überschreiben keine der drei festen
     Zeilen oben; wer Authorization setzen will, benutzt `ausweis`. */
  if (kopfzeilen && typeof kopfzeilen === "object") {
    for (const [name, wert] of Object.entries(kopfzeilen)) {
      if (name in kopf || name.toLowerCase() === "authorization") continue;
      kopf[name] = String(wert);
    }
  }

  let antwort;
  try {
    antwort = await fetch(`${GATEWAY_BASIS}${pfad}`, {
      method: methode,
      headers: kopf,
      body: koerper ? JSON.stringify(koerper) : undefined,
      signal: abbruch.signal,
      cache: "no-store",
      /* Die Erweiterung weist sich nur mit dem Ausweis aus, nie mit den
         Keksen der Cloud-Sitzung. Sonst wäre sie ein zweiter Weg in ein
         angemeldetes Konto, und genau das soll sie nicht sein. */
      credentials: "omit",
      redirect: "follow",
    });
  } catch (fehler) {
    if (signal && signal.aborted) throw new NetzFehler("abgebrochen", TEXTE.abgebrochen);
    if (abbruch.signal.reason === "frist") throw new NetzFehler("frist", TEXTE.frist);
    throw new NetzFehler("netz", TEXTE.netz);
  } finally {
    clearTimeout(uhr);
    if (signal) signal.removeEventListener("abort", weiterreichen);
  }

  /* Cloudflare ersetzt Fehlerrümpfe durch HTML. Wer das blind als JSON liest,
     bekommt eine Ausnahme statt einer Aussage — deshalb erst den Typ prüfen. */
  const art = antwort.headers.get("content-type") || "";
  const daten = art.includes("json") ? await antwort.json().catch(() => null) : null;

  if (!antwort.ok) throw fehlerAus(antwort.status, daten);
  if (daten === null) throw new NetzFehler("unerwartet", TEXTE.unerwartet, antwort.status);
  return daten;
}

/* Wartet, bricht aber sofort ab, wenn der Nutzer abbricht. Ohne das würde
   eine abgebrochene Freigabe noch bis zum nächsten Takt weiterlaufen. */
export function warten(ms, signal) {
  return new Promise((fertig, fehler) => {
    if (signal && signal.aborted) {
      fehler(new NetzFehler("abgebrochen", TEXTE.abgebrochen));
      return;
    }
    const uhr = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", abbrechen);
      fertig();
    }, ms);
    const abbrechen = () => {
      clearTimeout(uhr);
      fehler(new NetzFehler("abgebrochen", TEXTE.abgebrochen));
    };
    if (signal) signal.addEventListener("abort", abbrechen, { once: true });
  });
}
