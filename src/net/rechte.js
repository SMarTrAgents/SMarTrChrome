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
 *      (background/worker.js, onInstalled und onStartup) — für den Fall, dass
 *      er selbst mitgestorben ist.
 *   3. Stirbt nur der Dienstprozess, ohne dass der Browser neu startet, fängt
 *      die Wache in net/link.js den Rest ab: Sie findet eine gespeicherte
 *      Sitzung ohne Leitung vor und beendet sie samt Recht.
 *
 * Die Seitenleiste räumt zusätzlich auf. Das ist Gürtel und Hosenträger, nicht
 * die tragende Sicherung.
 *
 * Zweiter Auftrag dieser Datei: die eigenen Hosts bleiben gesperrt
 * (DRAHTFORMAT §7.3). Eine Erweiterung mit Skriptrecht auf
 * cloud.smartragents.ai könnte die Herkunftsbindung von POST /confirm
 * aushebeln, weil ihre Anfragen dann echte Anfragen dieses Ursprungs wären.
 * Dasselbe gilt für api. und connect.: Auf diesen beiden steht ohnehin ein
 * festes Manifest-Recht, ein Agent, der dort Skripte einspielen dürfte, könnte
 * also ohne jede weitere Freigabe die Antworten des eigenen Kontos mitlesen.
 * Die Sperre steht hier fail-closed: Was nicht eindeutig ein einzelner,
 * erlaubter Ursprung ist, wird gar nicht erst angefragt.
 */

import { CLOUD_URSPRUNG, GATEWAY_BASIS, RELAY_BASIS } from "./dienste.js";

/*
 * Die Hosts, für die es niemals ein Seitenrecht gibt — weder fest, noch
 * optional, noch zur Laufzeit.
 *
 * Sie werden aus den Adressen in dienste.js abgeleitet und nicht daneben noch
 * einmal eingetippt. Zieht der Betrieb eine Adresse um, zieht die Sperre mit;
 * eine zweite Liste würde genau dann auseinanderlaufen, wenn es darauf ankommt.
 */
const GESPERRTE_HOSTS = Object.freeze(
  [CLOUD_URSPRUNG, GATEWAY_BASIS, RELAY_BASIS].map((u) => new URL(u).hostname.toLowerCase())
);

/*
 * Was in einem Hostnamen stehen darf, damit wir ihn überhaupt vergleichen.
 *
 * Bewusst eng: Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich. Alles
 * andere — Prozentzeichen, Klammeraffe, Leerzeichen, Umlaute im Klartext —
 * ist in einem Chrome-Trefferbild kein gültiger Host und wäre hier nur ein Weg,
 * am Vergleich vorbeizukommen. `https://cloud%2Esmartragents.ai/*` sieht für
 * einen naiven Zeichenkettenvergleich fremd aus und meint doch unsere Seite.
 */
const HOSTZEICHEN = /^[a-z0-9._-]+$/;

/*
 * Ein Hostname auf seine eine, vergleichbare Form.
 *
 * Rückgabe "" heißt: nicht vergleichbar. Jeder Aufrufer behandelt das als
 * gesperrt, denn ein Host, den wir nicht lesen können, ist keiner, für den wir
 * ein Skriptrecht anfragen wollen.
 *
 * Drei Dinge passieren hier, und jedes hat einen echten Fall hinter sich:
 *
 *  - Kleinschreibung. `https://CLOUD.SMARTRAGENTS.AI/` ist derselbe Server.
 *  - Der Wurzelpunkt fällt weg. `cloud.smartragents.ai.` ist im DNS derselbe
 *    Name, und `new URL()` behält den Punkt bei. Ohne diese Zeile käme ein Tab
 *    auf `https://cloud.smartragents.ai./` als ganz gewöhnliche Webseite durch,
 *    und die Erweiterung würde sich das Skriptrecht auf der Freigabeseite
 *    holen. Genau das darf §7.3 nicht zulassen.
 *  - Ein leeres Namensglied (`cloud..smartragents.ai`) ist kein Hostname,
 *    sondern ein Versuch. Es gibt "" zurück, also gesperrt.
 */
function hostNormalisieren(roh) {
  let host = String(roh || "").trim().toLowerCase();
  /* Eine IPv6-Adresse steht in eckigen Klammern und kann keiner unserer Hosts
     sein. Sie geht unverändert durch, damit `http://[::1]/` weiter eine ganz
     normale Seite bleibt und nicht plötzlich „gehört dem Browser" heißt. */
  if (host.startsWith("[") && host.endsWith("]")) return host;
  while (host.endsWith(".")) host = host.slice(0, -1);
  if (!host) return "";
  if (host.includes("..")) return "";
  if (!HOSTZEICHEN.test(host)) return "";
  return host;
}

/*
 * Gehört dieser Host uns?
 *
 * Zwei Fälle, und sie sind nicht dasselbe:
 *
 *   - der Host selbst (`cloud.smartragents.ai`),
 *   - jede Unterdomäne davon (`beta.cloud.smartragents.ai`).
 *
 * Was ausdrücklich NICHT dazugehört: `cloud.smartragents.ai.angreifer.de`.
 * Der Name fängt nur so an, der Server gehört jemand anderem. Deshalb der
 * Punkt vor dem Vergleich — ohne ihn wäre die Sperre zu breit und würde
 * fremde Seiten sperren, die harmlos sind.
 */
function istEigenerHost(host) {
  if (!host) return false;
  return GESPERRTE_HOSTS.some((eigen) => host === eigen || host.endsWith(`.${eigen}`));
}

/* Der Host aus einem Trefferbild `schema://host/*`, oder "". */
function musterHost(muster) {
  const treffer = /^https?:\/\/([^/*]+)\/\*$/.exec(String(muster || "").trim());
  if (!treffer) return "";
  /* Ein Port gehört nicht zum Namen: `api.smartragents.ai:443` ist derselbe
     Host wie `api.smartragents.ai` und darf beim Aufräumen nicht als fremd
     durchgehen. */
  const ohnePort = treffer[1].replace(/:\d+$/, "");
  return hostNormalisieren(ohnePort);
}

/* Die fest im Manifest stehenden Rechte. Sie kommen aus dem Manifest selbst
   und nicht aus einer zweiten Liste — zwei Listen, die auseinanderlaufen,
   sind der Fehler, den dieses Projekt schon einmal bezahlt hat. Diese Rechte
   sind nicht entziehbar und dürfen beim Aufräumen nicht mitgenommen werden. */
function festeRechte() {
  try {
    const m = chrome.runtime.getManifest();
    const liste = Array.isArray(m.host_permissions) ? m.host_permissions : [];
    return new Set(liste.map((o) => String(o).trim().toLowerCase()));
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
 *
 * Das ist die LETZTE Prüfung vor `chrome.permissions.request`. Die
 * Seitenleiste fragt vorher schon `sperrgrund` und würde einen gesperrten
 * Ursprung gar nicht erst anbieten; verlassen darf sich diese Stelle darauf
 * nicht. Ein zweiter Aufrufer, ein umgebauter Dialog oder eine Nachricht aus
 * einer anderen Ecke der Erweiterung kämen sonst an der einzigen Sperre vorbei,
 * die wirklich vor dem Browser steht.
 */
export function musterErlaubt(muster) {
  const s = String(muster || "");
  const treffer = /^(https?):\/\/([^/*:]+)\/\*$/.exec(s);
  if (!treffer) return false;
  const host = hostNormalisieren(treffer[2]);
  if (!host) return false;
  if (istEigenerHost(host)) return false;
  return true;
}

/*
 * WARUM eine Adresse gesperrt ist — nicht nur DASS sie es ist.
 *
 * Beide Gründe führen zum selben Nein, aber sie sind für den Menschen zwei
 * verschiedene Sätze, und ein gemeinsamer Satz wäre für beide falsch:
 *
 *   "cloud"   — unsere eigenen Hosts samt Unterdomänen (DRAHTFORMAT §7.3,
 *               Punkt 2): die Freigabeseite, das Gateway und der Relay. Das
 *               ist kein Defekt, sondern die Regel, die verhindert, dass sich
 *               die Erweiterung über die eigene Seite selbst eine Befugnis
 *               erteilt oder an das eigene Konto geht.
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
  const host = hostNormalisieren(u.hostname);
  if (!host) return "browser";
  if (istEigenerHost(host)) return "cloud";
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
    return hostNormalisieren(new URL(String(ursprung)).hostname);
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
 *
 * Zwei Entscheidungen, die diese Funktion tragen:
 *
 *  1. JEDES Muster wird EINZELN zurückgegeben, nicht alle in einem Aufruf.
 *     `chrome.permissions.remove` ist alles-oder-nichts: Ein einziger Eintrag,
 *     den der Browser nicht hergibt, ließe sonst auch alle anderen liegen —
 *     die Aufräumfunktion wäre genau dann wirkungslos, wenn wirklich etwas
 *     aufzuräumen ist.
 *  2. Die eigenen Hosts werden nie angefasst, und zwar nicht nur, weil sie im
 *     Manifest stehen, sondern zusätzlich über ihren Namen. Wirft
 *     `getManifest()` einmal nicht, wäre die Liste der festen Rechte leer, und
 *     ohne diese zweite Bedingung würde der Aufräumer versuchen, sich selbst
 *     das Gateway und den Relay zu entziehen.
 *
 * @returns {Promise<string[]>} die Muster, die WIRKLICH weg sind. Nicht die,
 *   die weg sollten: Ein Rückgabewert, der mehr behauptet als geschehen ist,
 *   wäre der Anfang des nächsten unbemerkten Rechts.
 */
export async function alteRechteAufraeumen() {
  const fest = festeRechte();
  let vorhanden;
  try {
    vorhanden = await chrome.permissions.getAll();
  } catch (_) {
    return [];
  }
  const erteilt = vorhanden && Array.isArray(vorhanden.origins) ? vorhanden.origins : [];
  const zuviel = erteilt.filter((o) => {
    if (typeof o !== "string" || !o.trim()) return false;
    if (fest.has(o.trim().toLowerCase())) return false;
    if (istEigenerHost(musterHost(o))) return false;
    return true;
  });

  const weg = [];
  for (const muster of zuviel) {
    let entfernt = false;
    try {
      entfernt = await chrome.permissions.remove({ origins: [muster] });
    } catch (_) {
      /* Bleibt eins liegen, ist es beim nächsten Start wieder dran. Die
         übrigen dürfen darunter nicht leiden, deshalb geht die Schleife
         weiter. */
      entfernt = false;
    }
    if (entfernt === true) weg.push(muster);
  }
  return weg;
}
