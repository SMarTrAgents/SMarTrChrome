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
 */

import { istGesperrterUrsprung } from "./rechte.js";

/* Die Inhaltsskripte. Sie stehen hier als Liste, damit sie nur an einer Stelle
   gepflegt werden — im Manifest stehen sie bewusst nicht: Eingespielt wird
   erst, wenn eine Sitzung besteht, nicht schon beim Besuch einer Seite.
   Die Reihenfolge ist verbindlich. `overlay.js` findet beim Start vor, was vor
   ihm steht; ein Inhaltsskript kann `src/net/*.js` nicht importieren, und genau
   daran ist die Verdeckungswache am 11.08.2026 gescheitert — sie lag in einem
   Modul, das im Klickweg niemand rufen konnte. */
const OVERLAY_DATEIEN = [
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
   dieselbe Wache noch einmal, `overlay.js` bricht an seinem eigenen Riegel ab. */
const PFLICHT_DATEIEN = ["src/content/klickwache.js", "src/content/overlay.js"];

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
 * Eine Nachricht an das Inhaltsskript, mit Frist.
 *
 * @returns {{ok:true, antwort:object} | {ok:false, fehler:string}}
 */
export async function anSeite(tabId, nachricht, frist = 8000) {
  if (!Number.isInteger(tabId)) return { ok: false, fehler: "tab_unbekannt" };

  let uhr = null;
  const uhrenLauf = new Promise((fertig) => {
    uhr = setTimeout(() => fertig({ ok: false, fehler: "frist" }), Math.max(250, frist));
  });
  const nachrichtenLauf = chrome.tabs
    .sendMessage(tabId, nachricht)
    .then((antwort) =>
      antwort && typeof antwort === "object"
        ? { ok: true, antwort }
        : { ok: false, fehler: "keine_antwort" }
    )
    .catch(() => ({ ok: false, fehler: "kein_empfaenger" }));

  try {
    return await Promise.race([nachrichtenLauf, uhrenLauf]);
  } finally {
    if (uhr) clearTimeout(uhr);
  }
}

/**
 * Skripte in einen Tab einspielen. Wirft nie — der Aufrufer bekommt eine
 * Aussage, mit der er weiterarbeiten kann.
 *
 * @returns {Promise<boolean>}
 */
async function einspielen(tabId, dateien) {
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
export async function overlaySicherstellen(tabId) {
  const adresse = await tabAdresse(tabId);
  if (adresse === null) return { ok: false, fehler: "tab_gone" };
  if (istGesperrterUrsprung(adresse)) return { ok: false, fehler: "ursprung_gesperrt" };

  const ping = await anSeite(tabId, { typ: "overlay:ping" }, 2000);
  if (ping.ok && ping.antwort.ok) return { ok: true, schonDa: true };

  if (!(await einspielen(tabId, OVERLAY_DATEIEN))) {
    /* Kein Recht für diesen Ursprung, Seite nicht einspielbar (Chrome Web
       Store, PDF-Betrachter, Fehlerseite) — oder eine Datei der Kür fehlt. Der
       Pflichtteil bekommt deshalb einen eigenen Anlauf; scheitert auch der,
       gilt für den Aufrufer dasselbe: hier kann nicht gearbeitet werden. */
    if (!(await einspielen(tabId, PFLICHT_DATEIEN))) {
      return { ok: false, fehler: "einspielen_fehlgeschlagen" };
    }
  }

  const nachPruefung = await anSeite(tabId, { typ: "overlay:ping" }, 2000);
  if (nachPruefung.ok && nachPruefung.antwort.ok) return { ok: true, schonDa: false };
  return { ok: false, fehler: "einspielen_fehlgeschlagen" };
}
