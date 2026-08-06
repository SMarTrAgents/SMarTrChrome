/*
 * SMarTrChrome — Anmeldung, und zwar ausschließlich als Ausweis.
 *
 * Der Grundsatz, aus dem diese Datei folgt (spec-01, 1.1): Identität ist
 * keine Steuerbefugnis. Wer angemeldet ist, darf deswegen noch lange nicht
 * den Browser fernsteuern. Das Token beantwortet hier genau eine Frage —
 * „wer bist du?" — und sonst keine. Die Befugnis entsteht erst durch das
 * Einweg-Ticket in ticket.js.
 *
 * Deshalb gibt es in dieser Erweiterung kein Passwortfeld. Nicht „noch
 * nicht", sondern nie. Eine Erweiterung gilt als kompromittierbar; ein
 * Passwort, das durch sie hindurchläuft, wäre damit auch kompromittiert.
 * Stattdessen wird das Token einer bereits angemeldeten Cloud-Sitzung
 * übernommen — derselbe Weg, den der SMarTrBrowser-Desktop-Client geht.
 *
 * Abgelegt wird nur in chrome.storage.session. Der stirbt mit dem Browser.
 * chrome.storage.local darf dieses Token unter keinen Umständen sehen —
 * sonst überlebte ein Anmeldenachweis den Neustart, und das ist genau das,
 * was die Vorgabe „jede Sitzung neu" verbietet.
 *
 * WIE das Token hierher kommt, hat sich mit dem Drahtformat geändert, und der
 * Grund ist keine Bequemlichkeit, sondern die Herkunftsbindung:
 *
 * Früher las die Erweiterung `localStorage['sa_token']` aus einem offenen
 * Cloud-Tab — per Skripteinspielung, also mit `host_permissions` für
 * cloud.smartragents.ai. Genau dieses Recht ist jetzt verboten (DRAHTFORMAT
 * E12, §7.3): Wer in einem Ursprung Skripte ausführen darf, kann von dort aus
 * `POST /api/v1/link/confirm` absetzen, und diese Anfrage trägt dann echte,
 * nicht fälschbare `Origin:`- und `Sec-Fetch-Site:`-Kopfzeilen dieses
 * Ursprungs. Die ganze Freigabeprüfung wäre damit hinfällig — die Erweiterung
 * könnte sich selbst die Befugnis erteilen, die ein Mensch erteilen soll.
 *
 * Deshalb ist die Richtung jetzt umgedreht: Die Erweiterung HOLT das Token
 * nicht, die Cloud-Seite REICHT es herüber, über
 * `chrome.runtime.sendMessage(<extension_id>, …)` und den Manifest-Eintrag
 * `externally_connectable`. Dieser Kanal gibt der Erweiterung kein einziges
 * Recht im Web-Ursprung; er lässt nur die Seite von sich aus sprechen. Der
 * Hintergrunddienst nimmt die Übergabe entgegen (background/worker.js) und
 * legt sie mit `ausweisUebernehmen` hier ab.
 */

import { CLOUD_URSPRUNG, NetzFehler } from "./dienste.js";

/*
 * Der Übergabekanal. Die Cloud-Seite ruft
 *
 *   chrome.runtime.sendMessage(<extension_id>,
 *     { typ: "smartrlink:ausweis", token: localStorage.getItem("sa_token") })
 *
 * und beim Abmelden dasselbe mit `typ: "smartrlink:abmelden"`. Mehr kann sie
 * über diesen Kanal nicht — er nimmt genau diese zwei Nachrichten an.
 */
export const UEBERGABE_AUSWEIS = "smartrlink:ausweis";
export const UEBERGABE_ABMELDEN = "smartrlink:abmelden";

/* Schlüssel in chrome.storage.session — nur hier, nirgends sonst. */
const ABLAGE = "sa_ausweis";

/* Sicherheitsabstand: ein Token, das in weniger als einer halben Minute
   abläuft, ist für einen mehrstufigen Freigabeweg schon jetzt wertlos. */
const RESTZEIT_MINDESTENS_MS = 30000;

/*
 * Liest den Rumpf eines JWT, ohne ihn zu prüfen.
 *
 * Bewusst ohne Signaturprüfung: Die Erweiterung kann das gar nicht, und sie
 * soll es auch nicht. Der Server entscheidet über Gültigkeit. Hier geht es
 * nur darum, dem Nutzer sagen zu können, wer angemeldet ist, und ein sicher
 * abgelaufenes Token gar nicht erst zu verschicken.
 */
function rumpfLesen(token) {
  const teile = String(token || "").split(".");
  if (teile.length !== 3) return null;
  try {
    const roh = atob(teile[1].replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(roh, (z) => z.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    return null;
  }
}

function ausweisAus(token) {
  const rumpf = rumpfLesen(token);
  if (!rumpf || !rumpf.sub) return null;
  /* Ein Alltags-Ausweis hat KEIN `aud`; `aud: "smartr-connect"` kennzeichnet
     das Einweg-Ticket (DRAHTFORMAT §5.1, Schritt 7). Ein Ticket als Ausweis
     abzulegen wäre der Kurzschluss, den der Relay ohnehin mit 4401 beendet —
     wir lassen ihn hier gar nicht erst entstehen. */
  if (rumpf.aud !== undefined && rumpf.aud !== null) return null;
  const laeuftAbUm = Number.isFinite(rumpf.exp) ? rumpf.exp * 1000 : 0;
  if (laeuftAbUm && laeuftAbUm - Date.now() < RESTZEIT_MINDESTENS_MS) return null;
  return {
    token,
    sub: String(rumpf.sub),
    name: String(rumpf.email || rumpf.username || rumpf.name || ""),
    laeuftAbUm,
  };
}

/* Was in der Sitzungsablage liegt — oder nichts, wenn es abgelaufen ist. */
export async function ausweisAusAblage() {
  try {
    const daten = await chrome.storage.session.get(ABLAGE);
    const gemerkt = daten[ABLAGE];
    if (!gemerkt || !gemerkt.token) return null;
    const geprueft = ausweisAus(gemerkt.token);
    if (!geprueft) {
      await ausweisVerwerfen();
      return null;
    }
    return geprueft;
  } catch (_) {
    return null;
  }
}

/*
 * Nimmt ein Token entgegen, das die Cloud-Seite herübergereicht hat.
 *
 * Aufgerufen wird das ausschließlich vom Hintergrunddienst, nachdem der den
 * Absender geprüft hat. Was hier passiert, ist die zweite Hälfte derselben
 * Prüfung: Ein Token, das kein brauchbarer Alltags-Ausweis ist, wird nicht
 * abgelegt. Lieber keine Anmeldung als eine, auf die man sich nicht verlassen
 * kann.
 */
export async function ausweisUebernehmen(token) {
  const geprueft = ausweisAus(token);
  if (!geprueft) return null;
  try {
    await chrome.storage.session.set({
      [ABLAGE]: { token: geprueft.token, laeuftAbUm: geprueft.laeuftAbUm },
    });
  } catch (_) {
    /* Ohne Ablage bleibt der Ausweis für diesen einen Vorgang nutzbar; beim
       nächsten muss die Cloud-Seite ihn erneut reichen. Sichere Richtung. */
  }
  return geprueft;
}

/*
 * Der Ausweis für diesen Vorgang — aus der Sitzungsablage und sonst nirgendwo
 * her.
 *
 * Es gibt hier bewusst keinen zweiten Weg mehr. Die Erweiterung greift nicht
 * in den Cloud-Ursprung hinein (siehe Kopf dieser Datei); liegt nichts in der
 * Ablage, ist der Nutzer aus Sicht der Erweiterung nicht angemeldet. Das ist
 * keine Ausnahme, sondern eine Tatsache — der Aufrufer zeigt dann den Weg zur
 * Anmeldung.
 */
export async function ausweisBesorgen() {
  return ausweisAusAblage();
}

export async function ausweisVerwerfen() {
  try {
    await chrome.storage.session.remove(ABLAGE);
  } catch (_) {
    /* Nichts zu tun: Was nicht gelöscht werden kann, war auch nicht da. */
  }
}

/*
 * Öffnet die Anmeldeseite. Der Nutzer meldet sich dort selbst an — in der
 * echten Adressleiste, in der echten Cloud-Sitzung. Danach holt er die
 * Verbindung in der Seitenleiste erneut an.
 */
export async function anmeldeseiteOeffnen() {
  try {
    await chrome.tabs.create({ url: `${CLOUD_URSPRUNG}/`, active: true });
  } catch (_) {
    throw new NetzFehler(
      "kein_tab",
      "Ich konnte die Anmeldeseite nicht öffnen. Öffne bitte selbst cloud.smartragents.ai und melde dich dort an."
    );
  }
}

/* Für die Anzeige: „Angemeldet als …" ohne technische Angaben. */
export function ausweisBeschreiben(ausweis) {
  if (!ausweis) return "Nicht angemeldet.";
  return ausweis.name ? `Angemeldet als ${ausweis.name}.` : "Angemeldet.";
}
