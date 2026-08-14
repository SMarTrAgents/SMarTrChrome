/*
 * SMarTrChrome — die Startseite der Seitenleiste (Vertrag v3.5, Feature 2).
 *
 * Sie beantwortet die erste Frage, die ein Mensch beim Oeffnen der
 * Seitenleiste hat: Was ist gerade verbunden, und was koennte ich verbinden?
 *
 * Zwei Zusagen tragen diese Datei, und beide werden gemessen:
 *
 *   1. **Ein Tab mit gesperrtem Ursprung steht nicht in der Liste.** Nicht
 *      ausgegraut, nicht mit einem Hinweis versehen, sondern weggelassen.
 *      Die Sperre kommt aus `rechte.sperrgrund` und nirgends sonst; zwei
 *      Stellen, die dieselbe Sperre verschieden lesen, sind der Ursprung fast
 *      jeder Herunterstufung. Befund vom 28.07.2026: Der Verbindungsdialog bot
 *      `cloud.smartragents.ai` als Geltungsbereich an, obwohl dort garantiert
 *      nichts laufen kann. Ein Angebot, das nicht einloesbar ist, ist kein
 *      Angebot, sondern eine Falle.
 *
 *   2. **Kein Bild wird von einer fremden Adresse nachgeladen, die wir uns
 *      selbst ausgedacht haben.** Das Sinnbild kommt ausschliesslich aus
 *      `tab.favIconUrl`, also aus dem, was der Browser ohnehin schon hat.
 *      Gebaut wird nie eine Adresse — kein `https://host/favicon.ico`, kein
 *      Dienst, der Sinnbilder sammelt. Ein solcher Dienst bekaeme mit jedem
 *      Oeffnen der Seitenleiste die Liste aller offenen Tabs, und das waere
 *      ein Datenabfluss, den niemand bestellt hat. Fehlt das Feld oder zeigt
 *      es woandershin als der Tab selbst, steht dort ein eigenes Zeichen.
 *
 * Der Text dieser Oberflaeche wird vorgelesen. Deshalb Kommas statt
 * Gedankenstrichen, kurze Saetze und Du-Ansprache. Und deshalb steht nirgends,
 * was gerade NICHT geht: Der Trennknopf ist weg, solange nichts verbunden ist,
 * statt ausgegraut dazustehen.
 *
 * Fremdtext, der hier ankommt (Tab-Titel, Adressen), geht durch `saeubern` und
 * wird ausschliesslich ueber `textContent` gesetzt. Kein `innerHTML`, an
 * keiner Stelle: Ein Tab-Titel ist Text von einer fremden Seite, und Seitentext
 * wird gemessen, nicht geglaubt.
 */

import { hostAus, saeubern } from "../net/befehle.js";
import { t } from "./sprache.js";
import { istGesperrterUrsprung } from "../net/rechte.js";

/* Wie viel vom Tab-Titel in der Zeile steht. Rund 80 Zeichen sind eine Zeile,
   die sich vorlesen laesst, ohne dass die Frage darunter verlorengeht. */
export const TITEL_ZEICHEN = 80;

/* Wie viele Tabs die Liste hoechstens zeigt. Wer 200 Tabs offen hat, findet
   seinen gesuchten nicht dadurch, dass alle 200 dastehen. */
export const TABS_HOECHSTENS = 60;

/*
 * Der Stil kommt eingebettet mit.
 *
 * Grund: `panel.css` gehoert A-PANEL, und ein Modul, das seine Darstellung aus
 * einer fremden Datei holt, ist beim naechsten Umbau dort unsichtbar kaputt.
 * Alle Farben kommen aus den Variablen der Seitenleiste, damit die Startseite
 * nicht neben dem Rest steht; fehlt eine, greift der Ersatzwert.
 */
export const START_STIL = `
.sa-start { display: flex; flex-direction: column; gap: 12px; }
.sa-start-stand { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 12px; border-radius: 10px;
  background: var(--sa-karte, rgba(255,255,255,.06)); }
.sa-punkt { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto;
  background: var(--sa-grau, #7a7a7a); }
.sa-punkt.an { background: var(--sa-gruen, #2ecc71); }
.sa-start-satz { margin: 0; flex: 1 1 12ch; }
.sa-start-ziel { font-weight: 600; }
.sa-start-agent { margin: 0; width: 100%; opacity: .85; font-size: .92em; }
.sa-tabs { list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 6px; }
.sa-tab { display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 8px;
  background: var(--sa-karte, rgba(255,255,255,.05)); }
.sa-tab-bild { width: 16px; height: 16px; flex: 0 0 auto; border-radius: 3px; }
.sa-tab-zeichen { width: 16px; height: 16px; flex: 0 0 auto; border-radius: 3px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; line-height: 1;
  background: var(--sa-akzent, #00e5ff); color: #04202a; }
.sa-tab-text { flex: 1 1 8ch; min-width: 0; display: flex; flex-direction: column; }
.sa-tab-titel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sa-tab-host { font-size: .85em; opacity: .75; }
.sa-start-hinweis { margin: 0; opacity: .85; }
`;

/**
 * Der Host eines Tabs, klein und ohne Schema, oder "".
 *
 * Geht ueber `hostAus` und damit ueber dieselbe Zerlegung wie der Ausfuehrer.
 * Eine zweite Lesart derselben Adresse waere eine zweite Wahrheit darueber,
 * wo ein Tab steht.
 */
export function tabHost(tab) {
  return hostAus(tab && tab.url) || "";
}

/**
 * Darf dieser Tab in der Liste stehen?
 *
 * Nein bei fehlender Kennung, nein bei gesperrtem Ursprung. Die Sperre gilt
 * ausdrucklich in beide Richtungen: Was hier nicht steht, kann auch nicht aus
 * Versehen verbunden werden.
 */
export function tabAnzeigbar(tab) {
  if (!tab || typeof tab !== "object") return false;
  if (!Number.isInteger(tab.id)) return false;
  if (istGesperrterUrsprung(tab.url)) return false;
  return !!tabHost(tab);
}

/**
 * Woher das Sinnbild eines Tabs kommt.
 *
 * @returns {{art:"bild", quelle:string} | {art:"zeichen", zeichen:string}}
 *
 * Erlaubt sind genau zwei Faelle:
 *
 *   `data:image/…`  — steht bereits im Speicher, kostet keine Anfrage und
 *                     verraet damit niemandem, dass die Seitenleiste offen ist.
 *   `https://` oder `http://` auf DEMSELBEN Wirt wie der Tab — die Seite, die
 *                     ohnehin gerade offen ist, erfaehrt nichts, was sie nicht
 *                     schon weiss.
 *
 * Alles andere wird zum eigenen Zeichen. Der Fall, um den es dabei geht, ist
 * nicht theoretisch: `favIconUrl` kommt aus dem Kopf einer fremden Seite, und
 * eine Seite darf dort jede Adresse hineinschreiben. Zeigte die Seitenleiste
 * sie an, meldete sich beim Oeffnen der Leiste ein fremder Server, einmal je
 * offenem Tab. Das ist kein Sinnbild mehr, das ist eine Wanze.
 */
export function faviconQuelle(tab) {
  const host = tabHost(tab);
  const zeichen = { art: "zeichen", zeichen: (host.replace(/^www\./, "")[0] || "?").toUpperCase() };
  const roh = tab && typeof tab.favIconUrl === "string" ? tab.favIconUrl.trim() : "";
  if (!roh) return zeichen;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml);/i.test(roh)) {
    return { art: "bild", quelle: roh };
  }
  const eigen = hostAus(roh);
  if (eigen && host && eigen === host) return { art: "bild", quelle: roh };
  return zeichen;
}

/* Die zuletzt gebaute Startseite. `standSetzen` ist im Vertrag als freie
   Funktion beschrieben, die Seitenleiste ruft sie ohne Griff — also merkt sich
   das Modul, welche Startseite gemeint ist. */
let letzte = null;

function macher(wurzel) {
  const dok = (wurzel && wurzel.ownerDocument) || globalThis.document;
  return (tag, klasse = "", text = "") => {
    const el = dok.createElement(tag);
    if (klasse) el.className = klasse;
    /* Immer textContent. Fremdtext wird angezeigt, nicht ausgefuehrt. */
    if (text) el.textContent = text;
    return el;
  };
}

/**
 * Ein Text mit Sprachmarke, und zwar gleich in der Sprache des Nutzers.
 *
 * Die Marke bleibt am Element stehen, obwohl der Text hier schon gesetzt
 * wird: `textEinsetzen` zieht sie beim naechsten Aufbau nach, und ein
 * Pruefsatz misst an ihr, dass ueberhaupt jeder feste Text einen Schluessel
 * hat. `text` ist die deutsche Fassung und zugleich der Notfalltext, falls im
 * Katalog ein Schluessel fehlt: Chrome gibt dort die leere Zeichenkette
 * zurueck, und eine leere Beschriftung waere schlimmer als eine
 * unuebersetzte.
 */
function beschriften(el, schluessel, text, werte = []) {
  el.setAttribute("data-i18n", schluessel);
  el.textContent = t(schluessel, text, ...werte);
  return el;
}

/**
 * Die Startseite in den Anker bauen.
 *
 * @param {object} wurzel   das Element `#startseite` aus panel.html
 * @param {object} dienste  { tabsHolen, verbinden, trennen }
 * @returns {object} Griff mit `standSetzen`, `tabsLaden`, `bereit`
 *
 * Wirft nie. Fehlt ein Dienst, bleibt der zugehoerige Knopf weg, statt beim
 * Druck ins Leere zu greifen: Ein Knopf, der nichts tut, ist schlimmer als
 * keiner, weil der Mensch danach glaubt, er habe etwas ausgeloest.
 */
export function aufbauen(wurzel, dienste = {}) {
  if (!wurzel || typeof wurzel.appendChild !== "function") {
    return { ok: false, grund: "kein_anker" };
  }
  const { tabsHolen, verbinden, trennen } = dienste || {};
  const neu = macher(wurzel);

  wurzel.replaceChildren();

  const stil = neu("style");
  stil.textContent = START_STIL;
  wurzel.appendChild(stil);

  const rahmen = neu("div", "sa-start");
  wurzel.appendChild(rahmen);

  /* ---------------- Statuskarte ---------------- */
  const standKarte = neu("div", "sa-start-stand");
  const punkt = neu("span", "sa-punkt");
  punkt.setAttribute("aria-hidden", "true");
  const standSatz = neu("p", "sa-start-satz");
  const standWort = neu("span");
  const standZiel = neu("span", "sa-start-ziel");
  standSatz.appendChild(standWort);
  standSatz.appendChild(neu("span", "", " "));
  standSatz.appendChild(standZiel);
  const agentZeile = neu("p", "sa-start-agent");
  const agentWort = neu("span");
  const agentName = neu("span", "sa-start-agentname");
  agentZeile.appendChild(agentWort);
  agentZeile.appendChild(neu("span", "", " "));
  agentZeile.appendChild(agentName);
  const trennKnopf = neu("button", "sa-trennen");
  trennKnopf.setAttribute("type", "button");
  beschriften(trennKnopf, "start_trennen", "Verbindung beenden");
  trennKnopf.hidden = true;
  standKarte.appendChild(punkt);
  standKarte.appendChild(standSatz);
  standKarte.appendChild(agentZeile);
  if (typeof trennen === "function") {
    standKarte.appendChild(trennKnopf);
    trennKnopf.addEventListener("click", async () => {
      /* Der Knopf verschwindet nicht von selbst. Erst wenn die Seitenleiste
         den neuen Stand meldet, faellt er weg — sonst behauptete die
         Oberflaeche eine Trennung, die vielleicht gar nicht stattfand. */
      try {
        await trennen();
      } catch (_) {
        hinweisSetzen("start_trennen_ging_nicht",
          "Das Beenden kam gerade nicht durch, versuch es noch einmal.");
      }
    });
  }
  rahmen.appendChild(standKarte);

  /* ---------------- Tabliste ---------------- */
  const listeKopf = neu("div", "sa-start-kopf");
  const titel = neu("h3");
  beschriften(titel, "start_titel", "Deine offenen Tabs");
  listeKopf.appendChild(titel);
  const frischKnopf = neu("button", "sa-auffrischen");
  frischKnopf.setAttribute("type", "button");
  beschriften(frischKnopf, "start_aktualisieren", "Liste auffrischen");
  if (typeof tabsHolen === "function") {
    frischKnopf.addEventListener("click", () => tabsLaden());
    listeKopf.appendChild(frischKnopf);
  }
  rahmen.appendChild(listeKopf);

  const hinweis = neu("p", "sa-start-hinweis");
  hinweis.hidden = true;
  rahmen.appendChild(hinweis);

  const liste = neu("ul", "sa-tabs");
  liste.setAttribute("aria-live", "polite");
  rahmen.appendChild(liste);

  /**
   * Die Hinweiszeile setzen.
   *
   * Ohne Schluessel steht der Satz woertlich da. Das ist der Weg fuer Saetze,
   * die aus einem anderen Modul kommen: Sie mit einem fremden Sprachschluessel
   * zu versehen hiesse, dass A-SPRACHE spaeter einen allgemeinen Satz darueber
   * legt und der Grund verlorengeht.
   */
  function hinweisSetzen(schluessel, text) {
    if (!text) {
      hinweis.hidden = true;
      hinweis.textContent = "";
      hinweis.removeAttribute("data-i18n");
      return;
    }
    if (schluessel) beschriften(hinweis, schluessel, text);
    else {
      hinweis.removeAttribute("data-i18n");
      hinweis.textContent = text;
    }
    hinweis.hidden = false;
  }

  /**
   * Die Tabs anzeigen.
   *
   * Der Filter steht hier und nicht beim Aufrufer: Wer die Liste baut,
   * entscheidet, was darin steht. Ein Aufrufer, der das Filtern vergisst,
   * bekaeme sonst eine Liste mit gesperrten Zielen.
   */
  function tabsZeigen(tabs) {
    const brauchbar = (Array.isArray(tabs) ? tabs : [])
      .filter(tabAnzeigbar)
      .slice(0, TABS_HOECHSTENS);

    liste.replaceChildren();
    if (!brauchbar.length) {
      hinweisSetzen("start_leer", "Hier ist gerade kein Tab, den ich verbinden kann.");
      return brauchbar;
    }
    hinweisSetzen(null, "");

    for (const tab of brauchbar) {
      const zeile = neu("li", "sa-tab");
      const bild = faviconQuelle(tab);
      if (bild.art === "bild") {
        const img = neu("img", "sa-tab-bild");
        img.setAttribute("src", bild.quelle);
        img.setAttribute("alt", "");
        img.setAttribute("aria-hidden", "true");
        zeile.appendChild(img);
      } else {
        const marke = neu("span", "sa-tab-zeichen", bild.zeichen);
        marke.setAttribute("aria-hidden", "true");
        zeile.appendChild(marke);
      }

      const text = neu("div", "sa-tab-text");
      const host = tabHost(tab);
      text.appendChild(neu("span", "sa-tab-titel", saeubern(tab.title, TITEL_ZEICHEN) || host));
      text.appendChild(neu("span", "sa-tab-host", host));
      zeile.appendChild(text);

      if (typeof verbinden === "function") {
        const knopf = neu("button", "sa-tab-verbinden");
        knopf.setAttribute("type", "button");
        /* Der Name des Ziels steht in der Beschriftung fuer den Bildschirmleser
           mit drin: „Verbinden" allein ist in einer Liste von zehn Zeilen keine
           Auskunft darueber, womit. */
        knopf.setAttribute("aria-label", t("start_verbinden_mit", "Verbinden mit $1", host));
        beschriften(knopf, "start_verbinden", "Verbinden");
        knopf.addEventListener("click", () => verbindenMit(tab));
        zeile.appendChild(knopf);
      }
      liste.appendChild(zeile);
    }
    return brauchbar;
  }

  /**
   * Einen Tab verbinden.
   *
   * Die Sperre wird ein zweites Mal geprueft, obwohl der Tab aus der
   * gefilterten Liste kommt. Grund ist der Zeitablauf: Zwischen dem Bauen der
   * Zeile und dem Klick koennen Minuten liegen, und der Tab kann in der Zeit
   * woandershin gewandert sein.
   */
  async function verbindenMit(tab) {
    if (typeof verbinden !== "function") return { ok: false, code: "kein_dienst" };
    if (!tabAnzeigbar(tab)) {
      hinweisSetzen("start_tab_gesperrt",
        "Dieser Tab hat sich seit dem Aufbau der Liste geändert, frisch die Liste bitte auf.");
      return { ok: false, code: "gesperrt" };
    }
    try {
      const antwort = await verbinden(tab);
      if (antwort && antwort.ok === false) {
        if (antwort.satz) hinweisSetzen(null, String(antwort.satz));
        else hinweisSetzen("start_verbinden_ging_nicht",
          "Das Verbinden kam gerade nicht durch, versuch es noch einmal.");
        return antwort;
      }
      hinweisSetzen(null, "");
      return antwort || { ok: true };
    } catch (_) {
      /* Ein geworfener Fehler waere hier eine Antwort, die niemand bekommt.
         Der Mensch steht vor einem Knopf, der nichts gesagt hat. */
      hinweisSetzen("start_verbinden_ging_nicht",
        "Das Verbinden kam gerade nicht durch, versuch es noch einmal.");
      return { ok: false, code: "verbinden_fehler" };
    }
  }

  /** Die Tabs neu holen. Wirft nie, sagt aber immer etwas. */
  async function tabsLaden() {
    if (typeof tabsHolen !== "function") return tabsZeigen([]);
    try {
      const tabs = await tabsHolen();
      return tabsZeigen(tabs);
    } catch (_) {
      liste.replaceChildren();
      hinweisSetzen("start_tabs_nicht_geladen",
        "Die Liste der Tabs war gerade nicht zu bekommen, frisch sie bitte auf.");
      return [];
    }
  }

  /**
   * Den Verbindungsstand anzeigen.
   *
   * @param {{verbunden:boolean, tab:object, agent:string}} stand
   *
   * Was nicht gilt, wird weggelassen: Ohne Verbindung ist der Trennknopf weg
   * und die Agentenzeile leer. Ein ausgegrauter Knopf waere ein Versprechen,
   * das die Oberflaeche nicht halten kann.
   */
  function standSetzenIntern(stand = {}) {
    const verbunden = !!(stand && stand.verbunden);
    const tab = stand && stand.tab ? stand.tab : null;
    const agent = stand && typeof stand.agent === "string" ? saeubern(stand.agent, 40) : "";

    punkt.className = verbunden ? "sa-punkt an" : "sa-punkt";
    if (verbunden) {
      beschriften(standWort, "start_stand_verbunden", "Verbunden mit");
      standZiel.textContent = tab
        ? saeubern(tab.title, TITEL_ZEICHEN) || tabHost(tab)
        : "";
    } else {
      beschriften(standWort, "start_stand_frei", "Wähle einen Tab, dann geht es los.");
      standZiel.textContent = "";
    }

    if (verbunden && agent) {
      beschriften(agentWort, "start_agent", "Am Werk:");
      agentName.textContent = agent;
      agentZeile.hidden = false;
    } else {
      agentWort.textContent = "";
      agentWort.removeAttribute("data-i18n");
      agentName.textContent = "";
      agentZeile.hidden = true;
    }

    trennKnopf.hidden = !verbunden;
    return { verbunden, agent };
  }

  const griff = {
    ok: true,
    wurzel,
    liste,
    hinweis,
    standKarte,
    trennKnopf,
    punkt,
    standSetzen: standSetzenIntern,
    tabsZeigen,
    tabsLaden,
    verbindenMit,
  };
  letzte = griff;

  /* Der Anfangszustand steht, bevor die erste Antwort da ist: Eine leere
     Seitenleiste, die nichts sagt, sieht aus wie eine kaputte. */
  standSetzenIntern({ verbunden: false });
  griff.bereit = tabsLaden();
  return griff;
}

/**
 * Den Verbindungsstand der zuletzt gebauten Startseite setzen.
 *
 * Der Vertrag beschreibt diese Funktion als freie Funktion des Moduls, weil
 * die Seitenleiste sie aus ihrem Nachrichtenempfaenger heraus ruft und dort
 * keinen Griff zur Hand hat.
 *
 * Wirft nie. Gibt es keine Startseite, kommt `false` zurueck, und zwar still:
 * Der Verbindungsstand ist eine Anzeige, kein Gate.
 */
export function standSetzen(stand) {
  if (!letzte || typeof letzte.standSetzen !== "function") return false;
  letzte.standSetzen(stand);
  return true;
}

/* Nur fuer Pruefsaetze: den gemerkten Griff wieder wegnehmen, damit ein Lauf
   nicht den Stand des vorigen sieht. */
export function _zuruecksetzen() {
  letzte = null;
}
