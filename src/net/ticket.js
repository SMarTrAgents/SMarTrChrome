/*
 * SMarTrChrome — der Freigabeweg.
 *
 * Hier entsteht die Befugnis, und zwar ausdrücklich nicht in der Erweiterung.
 * Der Ablauf hat vier Schritte (spec-01, 3.2 bis 3.4):
 *
 *   1. Die Erweiterung fragt eine Sitzung an und bekommt ein Kennwort
 *      (`verify_word`) und einen Abholschlüssel (`redeem_key`).
 *   2. Dasselbe Kennwort steht auf einer Seite in der echten Cloud, in der
 *      echten Adressleiste. Stimmen die beiden nicht überein, ist ein Dritter
 *      im Spiel — und der Nutzer sieht das, bevor irgendetwas passiert.
 *   3. Der Nutzer gibt dort frei. Stufe, Dauer und Bereich setzt er dort,
 *      nicht hier. Die Erweiterung kann sie nicht beeinflussen.
 *   4. Die Erweiterung holt das Ticket GENAU EINMAL ab, über
 *      POST /api/v1/link/redeem und nur mit dem `redeem_key`.
 *
 * Punkt 4 war bis zum Drahtformat falsch gebaut: Abgefragt wurde der
 * Anzeige-Endpunkt GET /request/{rid}, und der liefert nie ein Ticket
 * (DRAHTFORMAT E10). Der `redeem_key` ist das Stück, das die Freigabeseite
 * nicht bekommt — ohne ihn könnte ein Skript im Web-Ursprung das Ticket
 * abholen, und genau dorthin darf es nie gelangen (§7.2).
 *
 * Das Kennwort wird buchstabiert angesagt. Sechs zufällige Zeichen sind für
 * jemanden, der schlecht sieht, sonst nicht übertragbar. Deshalb enthält das
 * Alphabet kein I, kein L, kein O, keine Null und keine Eins — die vier
 * Verwechslungen, die beim Hören und beim Vergleichen wirklich vorkommen.
 */

import {
  anfragen,
  warten,
  CLOUD_URSPRUNG,
  KLIENT,
  VERSION,
  NetzFehler,
} from "./dienste.js";

/* Dasselbe Alphabet, aus dem der Relay seine Sitzungscodes zieht
   (smartrbrowser/server/app.py, CODE_ALPHABET). */
export const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const KENNWORT_LAENGE = 6;

/* Deutsches Funkalphabet nach DIN 5009. I, L und O fehlen hier, weil sie im
   Alphabet oben gar nicht vorkommen — was nicht auftreten kann, braucht auch
   kein Buchstabierwort. */
const FUNK = {
  A: "Anton", B: "Berta", C: "Cäsar", D: "Dora", E: "Emil", F: "Friedrich",
  G: "Gustav", H: "Heinrich", J: "Julius", K: "Kaufmann", M: "Martha",
  N: "Nordpol", P: "Paula", Q: "Quelle", R: "Richard", S: "Samuel",
  T: "Theodor", U: "Ulrich", V: "Viktor", W: "Wilhelm", X: "Xanthippe",
  Y: "Ypsilon", Z: "Zacharias",
};

const ZIFFER = {
  2: "zwei", 3: "drei", 4: "vier", 5: "fünf",
  6: "sechs", 7: "sieben", 8: "acht", 9: "neun",
};

/* Abstand zwischen zwei Abfragen und die Obergrenze — 2 Sekunden, höchstens
   75 Versuche (DRAHTFORMAT §3.4 und §10). Der Vorgang selbst lebt 120
   Sekunden; die Abfrage hört danach von selbst auf. */
const ABFRAGE_ABSTAND_MS = 2000;
const ABFRAGE_HOECHSTENS = 75;

/* Lebensdauer eines Vorgangs, falls der Server sie nicht nennt (§10). */
const ANTRAG_SEKUNDEN = 120;

/* Anfragen, deren Ticket bereits abgeholt wurde. Ein zweiter Abruf würde
   ohnehin abgewiesen — aber er soll gar nicht erst stattfinden, damit ein
   Programmfehler in der Oberfläche kein Ticket verbrennen kann. */
const verbraucht = new Set();

/*
 * Die Abholschlüssel — rid → redeem_key.
 *
 * Ausdrücklich im Modulspeicher und NIRGENDWO sonst (DRAHTFORMAT §11,
 * Erweiterung 6). Nicht in chrome.storage.local, nicht in
 * chrome.storage.session: Der Schlüssel ist 120 Sekunden lang das einzige
 * Geheimnis, das die Erweiterung von der Freigabeseite unterscheidet. Stirbt
 * der Speicher, ist der Vorgang verloren — das ist der billigere Schaden.
 */
const abholschluessel = new Map();

/* 43 Zeichen Base64url, 256 Bit (§2). Ein Schlüssel, der anders aussieht,
   stammt nicht aus einer Ticketausgabe, der wir folgen sollten. */
function schluesselGueltig(wert) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(wert || ""));
}

export function kennwortGueltig(wort) {
  const s = String(wort || "");
  if (s.length !== KENNWORT_LAENGE) return false;
  for (const zeichen of s) if (!ALPHABET.includes(zeichen)) return false;
  return true;
}

/* Für den Bildschirm und für aria-label: „Q. M. R. T. 4. X." Die Punkte
   zwingen jeden Bildschirmleser, einzeln zu lesen statt zu raten. */
export function buchstabiert(wort) {
  return String(wort || "").split("").join(". ") + ".";
}

/* Für die Ansage: „Q wie Quelle, M wie Martha, …, vier, …" */
export function ansageText(wort) {
  return String(wort || "")
    .split("")
    .map((z) => (FUNK[z] ? `${z} wie ${FUNK[z]}` : ZIFFER[z] || z))
    .join(", ");
}

/*
 * Die Freigabeseite. Bevorzugt wird die Adresse, die das Gateway mitgibt —
 * aber nur, wenn sie zum Cloud-Ursprung gehört. Eine Adresse, die uns der
 * Server nennt, ungeprüft in einem Tab zu öffnen, wäre genau der bequeme Weg,
 * den die Vorgabe verbietet. Ohne brauchbare Angabe bauen wir sie selbst
 * (DRAHTFORMAT §3.1).
 */
export function freigabeAdresse(rid, vorschlag) {
  if (typeof vorschlag === "string" && vorschlag.startsWith(`${CLOUD_URSPRUNG}/`)) {
    return vorschlag;
  }
  return `${CLOUD_URSPRUNG}/link/confirm?rid=${encodeURIComponent(rid)}`;
}

/*
 * Phase A — Sitzung anfragen.
 *
 * Was hier unter `requested` steht, ist ein Vorschlag und nichts weiter.
 * Die Freigabeseite belegt ihre Bedienelemente aus `preselect` vor und zeigt
 * unseren Wunsch nur als Zitat (DRAHTFORMAT E8) — wir können sie nicht
 * beeinflussen, und das ist der Sinn der Übung.
 */
async function anfordern({ ausweis, zweck, gewuenscht, signal }) {
  const antwort = await anfragen("/api/v1/link/request", {
    methode: "POST",
    ausweis,
    signal,
    koerper: {
      client: KLIENT,
      version: VERSION,
      extension_id: chrome.runtime.id,
      purpose: String(zweck || "").slice(0, 300),
      requested: {
        access: gewuenscht.access === "write" ? "write" : "read",
        duration: Number(gewuenscht.duration) || 600,
        mode: gewuenscht.mode === "domains" ? "domains" : "tab",
        allow: Array.isArray(gewuenscht.allow) ? gewuenscht.allow.map(String) : [],
        tab_host: String(gewuenscht.tab_host || ""),
        step_mode: gewuenscht.step_mode === "auto" ? "auto" : "confirm_each",
      },
    },
  });

  const rid = String(antwort.rid || "");
  const kennwort = String(antwort.verify_word || "");
  const schluessel = String(antwort.redeem_key || "");
  /* Sofortfreigabe (Lesestufe): Der Server antwortet direkt mit
     `state: "approved"` — ohne Kennwort, ohne Freigabeseite. Dann gibt es
     nichts zu vergleichen und nichts zu öffnen; das Ticket wird sofort über
     /redeem abgeholt. Der Kennwortweg bleibt für alles andere bestehen. */
  const sofort = String(antwort.state || "") === "approved";
  if (!rid || (!sofort && !kennwortGueltig(kennwort))) {
    throw new NetzFehler(
      "antwort_unbrauchbar",
      "Unser Dienst hat mir kein gültiges Kennwort geschickt. Aus Sicherheitsgründen baue ich dann keine Verbindung auf."
    );
  }
  /* Ohne Abholschlüssel gäbe es später kein Ticket. Das jetzt zu merken ist
     ehrlicher, als den Nutzer erst 120 Sekunden warten zu lassen. */
  if (!schluesselGueltig(schluessel)) {
    throw new NetzFehler(
      "antwort_unbrauchbar",
      "Unser Dienst hat mir den Schlüssel für die Freigabe nicht mitgegeben. Aus Sicherheitsgründen baue ich dann keine Verbindung auf."
    );
  }
  abholschluessel.set(rid, schluessel);

  return {
    rid,
    sofort,
    kennwort,
    /* Die Ansage des Servers hat Vorrang: Sie ist die Fassung, die auch die
       Freigabeseite vorliest — zwei verschiedene Buchstabierungen desselben
       Kennworts wären für jemanden, der vergleicht, ein Alarmzeichen ohne
       Anlass. Fehlt sie, buchstabieren wir selbst. */
    ansage: String(antwort.verify_word_spoken || "") || ansageText(kennwort),
    adresse: freigabeAdresse(rid, antwort.confirm_url),
    gueltigSekunden: Number(antwort.expires_in) || ANTRAG_SEKUNDEN,
  };
}

/*
 * Phase C — abholen, genau einmal, über POST /api/v1/link/redeem.
 *
 * Der Endpunkt ist zugleich die Statusabfrage: Solange der Mensch nicht
 * entschieden hat, antwortet er `pending` und verbraucht nichts. Erst mit
 * `approved` liefert er das Ticket, und das Ausliefern und Verbrennen sind
 * beim Server eine einzige Schreiboperation (DRAHTFORMAT §3.4).
 */
async function abholen({ rid, ausweis, signal, aufWarten }) {
  if (verbraucht.has(rid)) {
    throw new NetzFehler(
      "schon_abgeholt",
      "Diese Freigabe habe ich bereits benutzt. Bitte baue die Verbindung neu auf."
    );
  }
  const schluessel = abholschluessel.get(rid);
  if (!schluessel) {
    throw new NetzFehler(
      "kein_schluessel",
      "Mir fehlt der Schlüssel zu dieser Freigabe. Bitte baue die Verbindung noch einmal neu auf."
    );
  }

  /* Jedes Ende dieses Vorgangs ist endgültig: Der Schlüssel wird nicht
     wiederverwendet, und drei falsche Versuche verbrennen beim Server die
     Freigabe (§7.2). Wir lassen es gar nicht so weit kommen. */
  const abschliessen = () => {
    verbraucht.add(rid);
    abholschluessel.delete(rid);
  };

  for (let versuch = 1; versuch <= ABFRAGE_HOECHSTENS; versuch += 1) {
    let antwort;
    try {
      antwort = await anfragen("/api/v1/link/redeem", {
        methode: "POST",
        ausweis,
        signal,
        koerper: { rid, redeem_key: schluessel },
      });
    } catch (fehler) {
      if (fehler instanceof NetzFehler && fehler.status === 410) {
        /* Abgelaufen oder schon abgeholt. Beides ist ein Ende, kein Grund
           weiterzufragen. */
        abschliessen();
        throw new NetzFehler(
          "abgelaufen",
          "Die Freigabe ist abgelaufen oder wurde schon benutzt. Bitte baue die Verbindung noch einmal neu auf."
        );
      }
      if (fehler instanceof NetzFehler && fehler.status === 403) {
        /* Herkunft oder Schlüssel stimmen nicht. Weiterprobieren würde beim
           dritten Mal die Freigabe verbrennen — also hört es hier auf. */
        abschliessen();
        throw new NetzFehler(
          "herkunft",
          "Diese Freigabe gehört nicht zu dieser Erweiterung. Bitte baue die Verbindung noch einmal neu auf."
        );
      }
      /* Ein Abbruch durch den Nutzer ist kein Fehlschlag des Vorgangs — der
         Schlüssel bleibt liegen, damit ein erneuter Anlauf möglich ist. */
      if (fehler instanceof NetzFehler && fehler.kennung === "abgebrochen") throw fehler;
      abschliessen();
      throw fehler;
    }

    const zustand = String(antwort.state || "");

    if (zustand === "approved") {
      const ticket = String(antwort.ticket || "");
      /* Ab hier ist der Vorgang verbraucht — auch wenn unten noch etwas
         schiefgeht. Ein zweiter Anlauf holt kein Ticket mehr. */
      abschliessen();
      if (!ticket) {
        throw new NetzFehler(
          "kein_ticket",
          "Die Freigabe ist da, aber der Schein dazu fehlt. Bitte baue die Verbindung noch einmal neu auf."
        );
      }
      /* `granted` ist ausschließlich Anzeige. Was die Erweiterung wirklich
         darf, steht in `auth_ok` und nirgends sonst (DRAHTFORMAT §3.4/§5.3). */
      const erteilt = antwort.granted || {};
      return {
        ticket,
        erteilt: {
          access: erteilt.access === "write" ? "write" : "read",
          duration: Number(erteilt.duration) || 0,
          mode: erteilt.mode === "domains" ? "domains" : "tab",
          allow: Array.isArray(erteilt.allow) ? erteilt.allow.map(String) : [],
          step_mode: erteilt.step_mode === "auto" ? "auto" : "confirm_each",
        },
      };
    }

    if (zustand === "denied") {
      abschliessen();
      throw new NetzFehler(
        "abgelehnt",
        "Die Freigabe wurde abgelehnt. Es ist keine Verbindung entstanden."
      );
    }

    if (zustand === "expired") {
      abschliessen();
      throw new NetzFehler(
        "abgelaufen",
        "Die Freigabe ist abgelaufen. Bitte baue die Verbindung noch einmal neu auf."
      );
    }

    if (zustand === "consumed") {
      abschliessen();
      throw new NetzFehler(
        "schon_abgeholt",
        "Diese Freigabe wurde schon benutzt. Bitte baue die Verbindung neu auf."
      );
    }

    if (typeof aufWarten === "function") {
      aufWarten({ versuch, restSekunden: Number(antwort.remaining) || null });
    }
    await warten(ABFRAGE_ABSTAND_MS, signal);
  }

  abschliessen();
  throw new NetzFehler(
    "keine_freigabe",
    "Ich habe auf deine Freigabe gewartet, sie kam aber nicht. Es ist keine Verbindung entstanden."
  );
}

/*
 * Der ganze Weg in einem Aufruf.
 *
 * `aufKennwort` wird gerufen, sobald das Kennwort feststeht — und zwar bevor
 * der Freigabe-Tab aufgeht. Der Nutzer soll es gelesen und gehört haben,
 * ehe ihm der Browser den Fokus wegnimmt.
 */
export async function freigabeDurchlaufen({
  ausweis,
  zweck,
  gewuenscht,
  aufKennwort,
  aufWarten,
  signal,
}) {
  const antrag = await anfordern({ ausweis, zweck, gewuenscht, signal });

  /* Sofortfreigabe: kein Kennwort anzeigen, keinen Tab öffnen — direkt
     abholen. Der Kennwortweg darunter bleibt unangetastet; er trägt weiterhin
     jede Freigabe, die der Server nicht sofort erteilt (Schreibstufen). */
  if (antrag.sofort) {
    const ergebnis = await abholen({ rid: antrag.rid, ausweis, signal, aufWarten });
    return { ...ergebnis, rid: antrag.rid, kennwort: "", sofort: true };
  }

  if (typeof aufKennwort === "function") {
    aufKennwort({
      kennwort: antrag.kennwort,
      buchstabiert: buchstabiert(antrag.kennwort),
      ansage: antrag.ansage,
      adresse: antrag.adresse,
      gueltigSekunden: antrag.gueltigSekunden,
    });
  }

  await freigabeseiteOeffnen(antrag.adresse);

  const ergebnis = await abholen({ rid: antrag.rid, ausweis, signal, aufWarten });
  return { ...ergebnis, rid: antrag.rid, kennwort: antrag.kennwort, sofort: false };
}

/* Getrennt aufrufbar, damit der Nutzer die Seite erneut öffnen kann, wenn
   er den Tab versehentlich geschlossen hat. Die laufende Abfrage bleibt
   davon unberührt. */
export async function freigabeseiteOeffnen(adresse) {
  try {
    await chrome.tabs.create({ url: adresse, active: true });
  } catch (_) {
    throw new NetzFehler(
      "kein_tab",
      "Ich konnte die Freigabeseite nicht öffnen. Öffne bitte selbst cloud.smartragents.ai und gib die Verbindung dort frei."
    );
  }
}
