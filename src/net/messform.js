/*
 * SMarTrChrome — der Mantel um die gemeinsame Messform.
 *
 * Diese Datei enthält KEINE Regel. Sie holt, was `src/gemeinsam/messform.js`
 * an `globalThis` gehängt hat, und reicht es benannt weiter, damit die
 * Netzseite `import { messtext } from "./messform.js"` schreiben kann.
 *
 * Warum die Regeln nicht hier stehen: Die Inhaltsskripte laufen als
 * klassische Skripte in der besuchten Seite und können `src/net/*.js` nicht
 * importieren. Eine Regel, die hier stünde, müsste dort abgeschrieben
 * werden — und zwei Abschriften derselben Sicherheitszusage sind der Fehler,
 * den Festlegung F4 verbietet und der im Bestand schon dreimal aufgetreten
 * ist. Die Begründung in voller Länge steht im Kopf der gemeinsamen Datei.
 *
 * Der Import ohne Namen führt die Datei aus; sie hat weder `import` noch
 * `export` und ist deshalb zugleich ein gültiges ES-Modul und ein gültiges
 * Inhaltsskript.
 */

import "../gemeinsam/messform.js";

/*
 * Fehlt die Quelle, wird hier geworfen, und zwar beim Laden.
 *
 * Das ist die strengere Antwort und die gewollte: Ohne Messform gäbe es keine
 * Normalisierung, und ohne Normalisierung entscheidet die besuchte Seite
 * selbst, ob eine harte Klasse greift. Ein Dienstarbeiter, der gar nicht
 * erst startet, ist besser als einer, der ohne seine Wache arbeitet — das ist
 * dieselbe Lesart wie „ohne Wache keine Bedienung" beim Einspielen.
 */
const QUELLE = globalThis.SMARTR_MESSFORM;
if (!QUELLE) {
  throw new Error("messform: die gemeinsame Quelle hat sich nicht an globalThis gehängt");
}

export const messtext = QUELLE.messtext;
export const messtextLuecke = QUELLE.messtextLuecke;
export const messrand = QUELLE.messrand;
export const messvarianten = QUELLE.messvarianten;
export const messweg = QUELLE.messweg;
export const gleicherText = QUELLE.gleicherText;
export const anzeigeform = QUELLE.anzeigeform;
export const ohneUnsichtbare = QUELLE.ohneUnsichtbare;
export const steuerzeichenGlaetten = QUELLE.steuerzeichenGlaetten;
export const WEG_RUNDEN = QUELLE.WEG_RUNDEN;

/* Für die Prüfsätze: dieselbe eingefrorene Tafel, die auch in der Seite
   steht. Wer sie hier misst, misst die Fassung, mit der die Seite arbeitet. */
export const MESSFORM = QUELLE;
