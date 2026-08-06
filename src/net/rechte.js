/*
 * SMarTrChrome — die Seitenrechte.
 *
 * Warum diese Datei überhaupt existiert:
 *
 * `chrome.permissions.request` erzeugt eine DAUERHAFTE Erteilung. Sie überlebt
 * das Sitzungsende, das Schließen der Seitenleiste, den Absturz des Panels und
 * den Neustart des Browsers. Bisher wurde sie an drei Stellen in der
 * Seitenleiste zurückgenommen — also genau dort, wo sie am wenigsten sicher
 * erreicht wird: Stirbt das Panel auf irgendeinem anderen Weg, bleibt das
 * Recht bestehen, und die Erweiterung darf danach ohne jede Sitzung auf einer
 * fremden Seite Skripte ausführen.
 *
 * Deshalb liegt die Rücknahme jetzt hier, und diese Datei wird von den
 * Stellen benutzt, die die Sitzung wirklich überleben:
 *
 *   1. Der Hintergrunddienst nimmt das Recht beim Sitzungsende zurück
 *      (net/link.js, aufraeumen) — auch dann, wenn das Panel längst weg ist.
 *   2. Der Hintergrunddienst räumt beim Start alle Alt-Erteilungen weg
 *      (background/worker.js) — für den Fall, dass er selbst mitgestorben ist.
 *
 * Die Seitenleiste räumt zusätzlich auf. Das ist Gürtel und Hosenträger, nicht
 * die tragende Sicherung.
 *
 * Zweiter Auftrag dieser Datei: der Ursprung der Freigabeseite bleibt gesperrt
 * (DRAHTFORMAT §7.3). Eine Erweiterung mit Skriptrecht auf
 * cloud.smartragents.ai könnte die Herkunftsbindung von POST /confirm
 * aushebeln, weil ihre Anfragen dann echte Anfragen dieses Ursprungs wären.
 * Die Sperre steht hier fail-closed: Was nicht eindeutig ein einzelner,
 * erlaubter Ursprung ist, wird gar nicht erst angefragt.
 */

import { CLOUD_URSPRUNG } from "./dienste.js";

/* Der Host, für den es niemals ein Recht gibt — weder fest, noch optional,
   noch zur Laufzeit. */
const GESPERRTER_HOST = new URL(CLOUD_URSPRUNG).hostname;

/* Die fest im Manifest stehenden Rechte. Sie kommen aus dem Manifest selbst
   und nicht aus einer zweiten Liste — zwei Listen, die auseinanderlaufen,
   sind der Fehler, den dieses Projekt schon einmal bezahlt hat. Diese Rechte
   sind nicht entziehbar und dürfen beim Aufräumen nicht mitgenommen werden. */
function festeRechte() {
  try {
    const m = chrome.runtime.getManifest();
    return new Set(Array.isArray(m.host_permissions) ? m.host_permissions : []);
  } catch (_) {
    return new Set();
  }
}

/*
 * Prüft ein Muster, bevor es angefragt wird.
 *
 * Erlaubt ist ausschließlich die Form `https://ein.host/*` (oder `http://`)
 * mit einem konkreten Host ohne Platzhalter. Grund: `optional_host_permissions`
 * enthält `https://*./*`, und ein Platzhaltermuster würde den gesperrten
 * Ursprung stillschweigend mit einschließen. Chrome kennt keine
 * Ausnahmemuster — die Ausnahme muss deshalb hier im Code stehen.
 */
export function musterErlaubt(muster) {
  const s = String(muster || "");
  const treffer = /^(https?):\/\/([^/*:]+)\/\*$/.exec(s);
  if (!treffer) return false;
  const host = treffer[2].toLowerCase();
  if (host === GESPERRTER_HOST) return false;
  /* Auch jede Unterdomäne des Freigabe-Ursprungs bleibt außen vor. */
  if (host.endsWith(`.${GESPERRTER_HOST}`)) return false;
  return true;
}

/*
 * WARUM eine Adresse gesperrt ist — nicht nur DASS sie es ist.
 *
 * Beide Gründe führen zum selben Nein, aber sie sind für den Menschen zwei
 * verschiedene Sätze, und ein gemeinsamer Satz wäre für beide falsch:
 *
 *   "cloud"   — der Freigabe-Ursprung samt Unterdomänen (DRAHTFORMAT §7.3,
 *               Punkt 2). Das ist kein Defekt, sondern die Regel, die
 *               verhindert, dass sich die Erweiterung über die eigene Seite
 *               selbst eine Befugnis erteilt.
 *   "browser"  — alles, was keine gewöhnliche Webseite ist: `chrome://`,
 *               `about:`, `file://`, Erweiterungsseiten, unlesbare Adressen.
 *               Dort gibt es für niemanden Skriptrechte, auch nicht für uns.
 *
 * Im Zweifel „gesperrt": Diese Auskunft entscheidet mit, ob fremder Code in
 * eine Seite kommt, und dabei ist ein zu strenges Nein billiger als ein zu
 * großzügiges Ja.
 *
 * @returns {"cloud"|"browser"|null} null heißt: eine ganz normale Webseite.
 */
export function sperrgrund(url) {
  let u;
  try {
    u = new URL(String(url || ""));
  } catch (_) {
    return "browser";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "browser";
  const host = u.hostname.toLowerCase();
  if (!host) return "browser";
  if (host === GESPERRTER_HOST || host.endsWith(`.${GESPERRTER_HOST}`)) return "cloud";
  return null;
}

/*
 * Für die Ausführungsschicht: Darf in diesen Tab nichts eingespielt werden?
 *
 * Die Entscheidung steht in `sperrgrund` — hier bleibt nur die Ja/Nein-Frage,
 * die der Ausführer stellt. Zwei getrennte Prüfungen wären zwei Stellen, an
 * denen dieselbe Sperre auseinanderlaufen könnte.
 */
export function istGesperrterUrsprung(url) {
  return sperrgrund(url) !== null;
}

/*
 * Der Host, den der Geltungsbereich einer Sitzung nennen darf — oder "".
 *
 * Ein gesperrter Host darf nie in `allow` landen: Was die Erweiterung dort
 * nicht ausführen darf, darf sie auch nicht als Ziel vorschlagen. Sonst stünde
 * auf der Freigabeseite ein Bereich, den ein Mensch bestätigen könnte, obwohl
 * er garantiert nicht bedienbar ist.
 */
export function bereichHost(ursprung) {
  if (sperrgrund(ursprung)) return "";
  try {
    return new URL(String(ursprung)).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

/*
 * Das Recht für eine Seite holen. Muss im selben Klick geschehen wie die
 * Nutzergeste — nach dem ersten `await` ist sie verbraucht.
 */
export async function rechtHolen(muster) {
  if (!musterErlaubt(muster)) return false;
  try {
    return await chrome.permissions.request({ origins: [muster] });
  } catch (_) {
    return false;
  }
}

/* Das Recht zurückgeben. Gutmütig: Was nicht da ist, muss nicht weg. */
export async function rechtZurueckgeben(muster) {
  if (!muster) return;
  try {
    await chrome.permissions.remove({ origins: [String(muster)] });
  } catch (_) {
    /* Ein festes Manifest-Recht lässt sich nicht entziehen, und ein nie
       erteiltes auch nicht. Beides ist kein Fehlerfall. */
  }
}

/*
 * Beim Start: jede Erteilung wegräumen, die nicht im Manifest steht.
 *
 * Läuft der Hintergrunddienst an, gibt es per Definition keine laufende
 * Sitzung — die stirbt mit ihm (siehe net/link.js). Also darf es auch kein
 * Seitenrecht mehr geben. Was hier noch liegt, ist ein Rest aus einem
 * Vorgang, der nicht sauber zu Ende gekommen ist.
 */
export async function alteRechteAufraeumen() {
  const fest = festeRechte();
  let vorhanden;
  try {
    vorhanden = await chrome.permissions.getAll();
  } catch (_) {
    return [];
  }
  const zuviel = (vorhanden && Array.isArray(vorhanden.origins) ? vorhanden.origins : []).filter(
    (o) => !fest.has(o)
  );
  if (!zuviel.length) return [];
  try {
    await chrome.permissions.remove({ origins: zuviel });
  } catch (_) {
    /* Bleibt etwas liegen, ist es beim nächsten Start wieder dran. */
  }
  return zuviel;
}
