/*
 * SMarTrChrome — der Draht zur besuchten Seite.
 *
 * Alles, was zwischen Hintergrunddienst und Inhaltsskript läuft, geht durch
 * diese Datei. Vorher stand das Einspielen im Service Worker und das Sprechen
 * mit dem Tab in der Seitenleiste; damit gab es zwei Wege in eine fremde Seite
 * und nur einen davon mit Prüfung.
 *
 * Drei Eigenschaften, die diese Datei zusagt:
 *
 *  1. **Der Freigabe-Ursprung bleibt gesperrt.** In einen Tab von
 *     `cloud.smartragents.ai` wird niemals eingespielt und niemals gesprochen
 *     (DRAHTFORMAT §7.3, Punkt 2). Ein Skript, das dort liefe, spräche mit der
 *     Stimme dieses Ursprungs — und die Herkunftsbindung von `POST /confirm`
 *     wäre wertlos.
 *  2. **Jede Nachricht hat eine Frist.** `chrome.tabs.sendMessage` kann in
 *     einer hängenden Seite beliebig lange offen bleiben. Wer darauf ohne Uhr
 *     wartet, lässt den Agenten in seinen Zeitablauf laufen, statt ihm zu
 *     antworten.
 *  3. **Kein Fehler wird geworfen.** Jede Funktion hier gibt ein Ergebnis
 *     zurück, das der Aufrufer in eine Antwort verwandeln kann. Der Ausführer
 *     darf keinen Weg haben, auf dem er stumm endet.
 *  4. **Nach dem Not-Aus verlässt nichts mehr die Erweiterung in Richtung
 *     Seite.** Befund vom 14.08.2026 (B3): `anSeite` kannte kein
 *     Abbruchsignal. Gewann der Not-Aus das Rennen im Ausführer, lief der
 *     Verlierer weiter — gemessen wurde ein `overlay:klicken`, das 16996 ms
 *     NACH dem Kappen an die Seite ging, während der Agent längst
 *     `session_beendet` gelesen hatte. Ein Abbruch, der die Antwort abbricht,
 *     aber nicht die Handlung, ist kein Abbruch, sondern eine Vertuschung.
 *     Deshalb nimmt jede Funktion hier ein `AbortSignal` (Festlegung F1) und
 *     fragt es VOR dem Absenden, nicht nur danach.
 */

import { istGesperrterUrsprung } from "./rechte.js";

/* Die Inhaltsskripte. Sie stehen hier als Liste, damit sie nur an einer Stelle
   gepflegt werden — im Manifest stehen sie bewusst nicht: Eingespielt wird
   erst, wenn eine Sitzung besteht, nicht schon beim Besuch einer Seite.
   Die Reihenfolge ist verbindlich. `overlay.js` findet beim Start vor, was vor
   ihm steht; ein Inhaltsskript kann `src/net/*.js` nicht importieren, und genau
   daran ist die Verdeckungswache am 11.08.2026 gescheitert — sie lag in einem
   Modul, das im Klickweg niemand rufen konnte.

   `messform.js` steht noch davor (14.08.2026, Funde AUTOMODUS-1/3/4). Sie
   ist die EINE Messform: Unicode-Normalform, unsichtbare Zeichen ersatzlos
   weg, kein Kürzen vor einer Messung. Der Klassifizierer im Dienstarbeiter
   benutzt dieselbe Datei über den Mantel `src/net/messform.js`. Sie liegt
   unter `src/gemeinsam/` und nicht unter `src/content/`, weil sie eben nicht
   der Inhaltsseite gehört, sondern beiden — wer sie ändert, ändert die
   Messung auf BEIDEN Seiten, und genau das ist der Zweck.

   `geheim.js` steht ganz vorn unter den Inhaltsskripten (Festlegung F4 vom
   14.08.2026). Bis dahin
   trugen `overlay.js` und `rekorder.js` je eine eigene Abschrift derselben
   Geheimfeld-Erkennung; zwei Abschriften einer Sicherheitszusage sind schon
   dreimal auseinandergelaufen, und hier hinge an der Abweichung, ob ein
   Passwort mitgeschrieben wird. Eine Quelle, und sie muss stehen, bevor
   irgendjemand sie fragt. */
const OVERLAY_DATEIEN = [
  "src/gemeinsam/messform.js",
  "src/content/geheim.js",
  "src/content/klickwache.js",
  "src/content/selektor.js",
  "src/content/overlay.js",
];

/* Ohne diese zwei gibt es keine Bedienung: `overlay.js` bedient, und
   `klickwache.js` ist der einzige Weg, auf dem es das darf.
   `selektor.js` gehört dem Teach-Modus und entsteht in einem anderen Gebiet.
   Fehlt sie, wird die ganze Einspielung von Chrome abgelehnt — dann stünde die
   Erweiterung ohne Zeichen und ohne Wache in der Seite, wegen einer Datei, die
   für Klicken gar nicht gebraucht wird. Deshalb der zweite Anlauf mit dem
   Pflichtteil. Ein zweites Einspielen ist harmlos: `klickwache.js` schreibt
   dieselbe Wache noch einmal, `overlay.js` bricht an seinem eigenen Riegel ab.

   `messform.js` gehört aus demselben Grund in den Pflichtteil wie `geheim.js`
   und steht auch dort ganz vorn: Ohne sie misst die Seite Namen in einer
   Form, die die Seite selbst wählen darf. Lieber gar nicht arbeiten als ohne
   die Zusage arbeiten, die diese Datei trägt.

   `geheim.js` gehört ausdrücklich in den Pflichtteil und nicht in die Kür:
   Ohne sie wüsste `overlay.js` nicht, welches Feld ein Geheimfeld ist, und
   würde in ein Passwortfeld tippen. Das ist dieselbe harte Lesart wie bei der
   Verdeckungswache, ohne Wache keine Bedienung — lieber gar nicht arbeiten
   als ohne die Zusage arbeiten, die diese Datei trägt. */
const PFLICHT_DATEIEN = [
  "src/gemeinsam/messform.js",
  "src/content/geheim.js",
  "src/content/klickwache.js",
  "src/content/overlay.js",
];

/** Die aktuelle Adresse eines Tabs — oder null, wenn es ihn nicht mehr gibt. */
export async function tabAdresse(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return (tab && tab.url) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Eine Nachricht an das Inhaltsskript, mit Frist und Abbruchsignal.
 *
 * Die Reihenfolge der beiden ersten Zeilen ist die ganze Zusage aus Punkt 4
 * im Kopf dieser Datei: Ist das Signal schon gebrochen, wird gar nicht erst
 * gesendet. Erst zu senden und danach das Ergebnis wegzuwerfen wäre die
 * Fassung vom 14.08.2026 — der Agent las `session_beendet`, und die Seite
 * bekam den Klick trotzdem.
 *
 * @param {number} tabId
 * @param {object} nachricht
 * @param {number} frist
 * @param {{signal?: AbortSignal}} wahl  Festlegung F1
 * @returns {{ok:true, antwort:object} | {ok:false, fehler:string}}
 */
export async function anSeite(tabId, nachricht, frist = 8000, { signal = null } = {}) {
  if (!Number.isInteger(tabId)) return { ok: false, fehler: "tab_unbekannt" };
  if (signal && signal.aborted === true) return { ok: false, fehler: "abgebrochen" };

  let uhr = null;
  const uhrenLauf = new Promise((fertig) => {
    uhr = setTimeout(() => fertig({ ok: false, fehler: "frist" }), Math.max(250, frist));
  });

  /* Der Abbruch steht IM Rennen und nicht daneben. Ein Merkzeichen, das
     irgendwer nach der Antwort der Seite abfragen müsste, wirkte erst, wenn
     diese Seite antwortet — und eine hängende Seite antwortet nie. */
  let horcher = null;
  const abbruchLauf = signal
    ? new Promise((fertig) => {
        horcher = () => fertig({ ok: false, fehler: "abgebrochen" });
        signal.addEventListener("abort", horcher, { once: true });
      })
    : null;

  const nachrichtenLauf = chrome.tabs
    .sendMessage(tabId, nachricht)
    .then((antwort) =>
      antwort && typeof antwort === "object"
        ? { ok: true, antwort }
        : { ok: false, fehler: "keine_antwort" }
    )
    .catch(() => ({ ok: false, fehler: "kein_empfaenger" }));

  const laeufe = [nachrichtenLauf, uhrenLauf];
  if (abbruchLauf) laeufe.push(abbruchLauf);

  try {
    return await Promise.race(laeufe);
  } finally {
    if (uhr) clearTimeout(uhr);
    /* Der Horcher muss weg, auch wenn niemand abgebrochen hat: Das Signal
       lebt so lange wie die ganze Sitzung, und ein Horcher je Nachricht wäre
       nach ein paar hundert Befehlen eine Liste, die niemand mehr leert. */
    if (signal && horcher) signal.removeEventListener("abort", horcher);
  }
}

/**
 * Skripte in einen Tab einspielen. Wirft nie — der Aufrufer bekommt eine
 * Aussage, mit der er weiterarbeiten kann.
 *
 * @returns {Promise<boolean>}
 */
async function einspielen(tabId, dateien, signal) {
  /* Auch das Einspielen ist ein Weg in die fremde Seite, und nach dem Not-Aus
     geht dort nichts mehr hin (Befund vom 14.08.2026, B3). */
  if (signal && signal.aborted === true) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: dateien,
    });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Sicherstellen, dass das Overlay in diesem Tab läuft.
 *
 * Nach jeder Navigation ist das Inhaltsskript weg — der Rahmen wäre also
 * verschwunden und der Agent läse eine Seite, auf der der Mensch gar nicht
 * sieht, dass gelesen wird. Deshalb wird vor jedem Befehl nachgesehen und
 * gegebenenfalls neu eingespielt.
 *
 * @returns {{ok:true, schonDa:boolean} | {ok:false, fehler:string}}
 */
export async function overlaySicherstellen(tabId, { signal = null } = {}) {
  if (signal && signal.aborted === true) return { ok: false, fehler: "abgebrochen" };
  const adresse = await tabAdresse(tabId);
  if (adresse === null) return { ok: false, fehler: "tab_gone" };
  if (istGesperrterUrsprung(adresse)) return { ok: false, fehler: "ursprung_gesperrt" };

  const ping = await anSeite(tabId, { typ: "overlay:ping" }, 2000, { signal });
  if (ping.ok && ping.antwort.ok) return { ok: true, schonDa: true };

  if (!(await einspielen(tabId, OVERLAY_DATEIEN, signal))) {
    /* Kein Recht für diesen Ursprung, Seite nicht einspielbar (Chrome Web
       Store, PDF-Betrachter, Fehlerseite) — oder eine Datei der Kür fehlt. Der
       Pflichtteil bekommt deshalb einen eigenen Anlauf; scheitert auch der,
       gilt für den Aufrufer dasselbe: hier kann nicht gearbeitet werden. */
    if (!(await einspielen(tabId, PFLICHT_DATEIEN, signal))) {
      return { ok: false, fehler: signal && signal.aborted === true ? "abgebrochen" : "einspielen_fehlgeschlagen" };
    }
  }

  const nachPruefung = await anSeite(tabId, { typ: "overlay:ping" }, 2000, { signal });
  if (nachPruefung.ok && nachPruefung.antwort.ok) return { ok: true, schonDa: false };
  return { ok: false, fehler: "einspielen_fehlgeschlagen" };
}
