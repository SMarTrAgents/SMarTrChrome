/*
 * SMarTrChrome — die Werkbank (Vertrag v3.5, Feature 3, §4, §7.3, §8.3).
 *
 * Drei Dinge liegen hier, weil sie derselbe Gedanke sind: Was der Mensch
 * einmal einstellt und danach ohne Rueckfrage laufen laesst.
 *
 *   - die gespeicherten Ablaeufe (`net/werkstatt.js`)
 *   - die Einstellungsmatrix aus Agent, Domain und Aktionsklasse
 *     (`net/matrix.js`)
 *   - das Protokollbuch der Fernaktionen (`net/protokollbuch.js`)
 *
 * Diese Datei erfindet kein einziges eigenes Speicherformat. Sie ist
 * Oberflaeche und sonst nichts: Jede Aenderung geht durch die Pruefung des
 * jeweiligen Moduls, und was dort durchfaellt, wird benannt abgelehnt.
 *
 * Die gefaehrlichste Stelle ist das Einlesen einer fremden JSON-Datei, und sie
 * traegt deshalb die schaerfste Zusage dieser Datei:
 *
 *   **Ganz oder gar nicht.** Ein Ablauf, der `workflowPruefen` nicht besteht,
 *   laesst die GANZE Datei durchfallen. Es wird nichts uebernommen, kein
 *   Feld gerettet, kein Schritt weggelassen. Der Grund ist die Lebensdauer:
 *   Ein Ablauf wird einmal angesehen und danach zwanzigmal abgespielt. Was
 *   beim Einlesen still verschwindet, fehlt beim zwanzigsten Abspielen
 *   genauso, und dann sucht den Fehler niemand mehr beim Einlesen.
 *
 * Und eine Zusage zur Darstellung, die aus dem Bestand kommt:
 * **Was nicht gilt, wird weggelassen, nicht ausgegraut.** Harte Klassen
 * (§3) tauchen in der Domain-Freischaltung ueberhaupt nicht auf, denn sie sind
 * nicht abschaltbar. Ein Schalter, der nichts schaltet, ist eine Luege ueber
 * die eigene Einstellung.
 *
 * Die Voreinstellung ist ueberall AUS. Wer eine Matrix baut, die im Zweifel
 * erlaubt, hat keine gebaut.
 *
 * Der Text dieser Oberflaeche wird vorgelesen: kurze Saetze, Du-Ansprache,
 * Kommas statt Gedankenstrichen. Fremdtext geht durch `saeubern` und
 * ausschliesslich ueber `textContent`, nie ueber `innerHTML`.
 */

import { t } from "./sprache.js";
import {
  GRENZEN,
  PARAM_NAME_MUSTER,
  WEICH,
  adresseZerlegen,
  saeubern,
} from "../net/befehle.js";
import {
  AGENTEN,
  AGENT_KLASSEN,
  hostMuster,
  matrixLesen,
  matrixSchreiben,
} from "../net/matrix.js";
import {
  SCHRITT_TYPEN,
  WERKSTATT_GRENZEN,
  WORKFLOW_VERSION,
  platzhalterFuellen,
  workflowLoeschen,
  workflowPruefen,
  workflowSchreiben,
  workflowsLesen,
} from "../net/werkstatt.js";
import {
  AUFBEWAHRUNG_ABLAGE,
  AUFBEWAHRUNG_STANDARD_TAGE,
  aufraeumen as buchAufraeumen,
  ausgeben as buchAusgeben,
  lesen as buchEintraegeLesen,
} from "../net/protokollbuch.js";

/*
 * Wo die Aufbewahrungsdauer des Protokollbuchs steht.
 *
 * Der Vertrag verlangt sie einstellbar (§8.3), nennt aber keinen Schluessel.
 * Seit dem 14.08.2026 steht er bei der Ablage, die er betrifft
 * (`net/protokollbuch.js`), und wird von dort geholt: Ein Ablageschluessel,
 * den zwei Gebiete verschieden nennen, ist eine Einstellung, die niemand
 * wiederfindet — und der 30-Sekunden-Wecker las genau deshalb die
 * Voreinstellung statt des eingestellten Wertes.
 */
export const BUCH_TAGE_ABLAGE = AUFBEWAHRUNG_ABLAGE;

/** Wie lange das Buch hoechstens aufbewahrt. Ein Jahr ist mehr, als jemand
    ueberblickt, und ein Buch ohne Ende ist kein Buch, sondern ein Archiv. */
export const BUCH_TAGE_HOECHSTENS = 365;

/* Wie viele Buchzeilen die Ansicht zeigt. Das Buch selbst haelt bis zu 2.000
   Eintraege; sie alle in den Seitenbaum zu haengen, macht die Seitenleiste
   langsam und hilft niemandem beim Nachsehen. */
export const BUCH_ZEILEN = 200;

export const WERKBANK_STIL = `
.sa-werkbank { display: flex; flex-direction: column; gap: 16px; }
.sa-wb-abschnitt { display: flex; flex-direction: column; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  background: var(--sa-karte, rgba(255,255,255,.05)); }
.sa-wb-liste { list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 6px; }
.sa-wb-zeile { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.sa-wb-name { font-weight: 600; flex: 1 1 10ch; }
.sa-wb-klein { font-size: .85em; opacity: .78; }
.sa-wb-hinweis { margin: 0; }
.sa-wb-hinweis.absage { color: var(--sa-warn, #ffb454); }
.sa-wb-feld { display: flex; flex-direction: column; gap: 2px; }
.sa-wb-schritte { list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 4px; }
.sa-wb-schritt { display: flex; align-items: baseline; gap: 6px; }
.sa-wb-schritt-text { flex: 1 1 10ch; overflow: hidden; text-overflow: ellipsis; }
.sa-wb-gitter { display: flex; flex-wrap: wrap; gap: 10px; }
.sa-wb-schalter { display: inline-flex; align-items: center; gap: 4px; }
.sa-buch { list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 4px; }
.sa-buch-zeile { display: flex; gap: 8px; flex-wrap: wrap; font-size: .9em; }
.sa-buch-zeit { opacity: .75; font-variant-numeric: tabular-nums; }
.sa-buch-ort { flex: 1 1 12ch; overflow: hidden; text-overflow: ellipsis; }
.sa-wb-ausgabe { width: 100%; min-height: 6em; font-family: monospace; }
`;

function absage(code, satz, hinweis = "") {
  return { ok: false, code, satz, hinweis };
}

/* --------------------------------------------------------------------- *
 * Reine Arbeit an Ablaeufen
 *
 * Alles hier gibt einen NEUEN Ablauf zurueck und aendert den alten nicht. Wer
 * einen Schritt verschiebt und dabei die Pruefung nicht besteht, soll den
 * Ablauf haben, den er vorher hatte, und nicht einen halb verschobenen.
 * --------------------------------------------------------------------- */

/**
 * Die Adresse eines `navigate`-Schrittes.
 *
 * Diese Pruefung ist STRENGER als `workflowPruefen` und ausschliesslich
 * strenger, sie erteilt an keiner Stelle eine Erlaubnis. `werkstatt.js` prueft
 * die Adresse mit Absicht nicht, weil der freigegebene Bereich beim Speichern
 * noch nicht feststeht (§7.3). Das Schema steht aber fest, und zwar immer:
 * `javascript:`, `data:` und `chrome:` sind keine Orte, an die ein Ablauf
 * navigieren darf, heute nicht und mit keiner Freigabe.
 *
 * Sie steht am Einlesetor und nicht in `werkstatt.js`, weil eine
 * hereingereichte Datei Fremdtext ist, ein aufgezeichneter Ablauf dagegen aus
 * dem Browser selbst stammt. Gemeldet ist das als Vorschlag an A-REGELN.
 */
function adressenPruefen(wf) {
  const steps = Array.isArray(wf && wf.steps) ? wf.steps : [];
  for (let i = 0; i < steps.length; i++) {
    const schritt = steps[i];
    if (!schritt || schritt.type !== "navigate") continue;
    const url = String(schritt.url || "");
    /* Ein Platzhalter macht die Adresse erst beim Abspielen vollstaendig. Was
       hier feststehen MUSS, ist das Schema, denn ein Platzhalter ganz vorn
       koennte sonst jedes beliebige werden. */
    if (url.includes("{{")) {
      if (!/^https?:\/\//i.test(url)) {
        return absage("adresse_ungueltig",
          `Schritt ${i + 1} setzt die Adresse aus einem Wert zusammen und faengt nicht mit https:// an.`,
          "Die Adresse muss mit https:// oder http:// beginnen, der Platzhalter steht dahinter.");
      }
      continue;
    }
    if (!adresseZerlegen(url)) {
      return absage("adresse_ungueltig",
        `Schritt ${i + 1} nennt eine Adresse, die ich nicht aufrufe: ${saeubern(url, 80)}`,
        "Erlaubt sind ausschliesslich https:// und http://.");
    }
  }
  return { ok: true };
}

/**
 * Eine fremde JSON-Datei einlesen.
 *
 * @returns {{ok:true, workflows:Array}|{ok:false, code, satz, hinweis, stelle?}}
 *
 * Ganz oder gar nicht, siehe Kopf der Datei. Wirft nie, auch nicht bei
 * kaputtem JSON: Der Mensch hat eine Datei hereingegeben und bekommt einen
 * Satz zu hoeren, keine rote Zeile in einer Entwicklerkonsole.
 */
export function einlesen(roh) {
  let daten;
  try {
    daten = JSON.parse(String(roh ?? ""));
  } catch (_) {
    return absage("json_kaputt", "Das ist kein JSON, das ich lesen kann.",
      "Die Datei noch einmal ausgeben lassen und vollstaendig hereinkopieren.");
  }

  let liste;
  if (Array.isArray(daten)) liste = daten;
  else if (daten && typeof daten === "object" && Array.isArray(daten.workflows)) liste = daten.workflows;
  else if (daten && typeof daten === "object") liste = [daten];
  else {
    return absage("datei_ungueltig", "In dieser Datei steht kein Ablauf.",
      "Erwartet wird ein Ablauf, eine Liste von Ablaeufen oder ein Objekt mit dem Feld workflows.");
  }

  if (!liste.length) {
    return absage("datei_leer", "In dieser Datei steht kein Ablauf.",
      "Eine Datei mit mindestens einem Ablauf hereingeben.");
  }
  if (liste.length > WERKSTATT_GRENZEN.ablaeufeHoechstens) {
    return absage("zu_viele_ablaeufe",
      `Die Datei enthaelt ${liste.length} Ablaeufe, ich nehme hoechstens ${WERKSTATT_GRENZEN.ablaeufeHoechstens}.`,
      "Die Datei aufteilen.");
  }

  const workflows = [];
  const kennungen = new Set();
  for (let i = 0; i < liste.length; i++) {
    const geprueft = workflowPruefen(liste[i]);
    if (!geprueft.ok) {
      return {
        ok: false,
        code: geprueft.code,
        satz: `Ablauf ${i + 1} nehme ich nicht: ${geprueft.satz}`,
        hinweis: geprueft.hinweis,
        stelle: i + 1,
      };
    }
    const adressen = adressenPruefen(geprueft.workflow);
    if (!adressen.ok) {
      return {
        ok: false,
        code: adressen.code,
        satz: `Ablauf ${i + 1} nehme ich nicht: ${adressen.satz}`,
        hinweis: adressen.hinweis,
        stelle: i + 1,
      };
    }
    /* Zwei Ablaeufe mit derselben Kennung sind kein Zusatz, sondern eine
       Ueberschreibung, die niemand angeordnet hat: Der zweite verdraengt den
       ersten beim Speichern, und der Mensch sieht am Ende einen Ablauf
       weniger, als er hereingegeben hat. */
    if (kennungen.has(geprueft.workflow.id)) {
      return absage("id_doppelt",
        `Die Kennung ${geprueft.workflow.id} steht in dieser Datei zweimal.`,
        "Jede Kennung darf nur einmal vorkommen.");
    }
    kennungen.add(geprueft.workflow.id);
    workflows.push(geprueft.workflow);
  }
  return { ok: true, workflows };
}

/**
 * Ablaeufe als JSON-Zeichenkette ausgeben.
 *
 * Was herauskommt, geht durch `einlesen` wieder herein. Das ist keine
 * Bequemlichkeit, sondern die einzige Art, wie ein Mensch seine Arbeit
 * sichern kann, ohne sie beim Zurueckholen zu verlieren.
 */
export function ausgebenText(workflows) {
  const rein = [];
  for (const wf of Array.isArray(workflows) ? workflows : []) {
    const geprueft = workflowPruefen(wf);
    if (geprueft.ok) rein.push(geprueft.workflow);
  }
  return JSON.stringify(
    { version: WORKFLOW_VERSION, erzeugt: new Date().toISOString(), workflows: rein },
    null,
    2
  );
}

/**
 * Namen und Beschreibung aendern.
 *
 * Das Ergebnis geht durch `workflowPruefen` und ist damit entweder ein
 * gueltiger Ablauf oder eine benannte Absage. Ein leerer Name kommt so gar
 * nicht erst in die Ablage.
 */
export function benennen(wf, name, beschreibung) {
  const geprueft = workflowPruefen(wf);
  if (!geprueft.ok) return geprueft;
  return workflowPruefen({
    ...geprueft.workflow,
    name: String(name ?? ""),
    beschreibung: beschreibung === undefined ? geprueft.workflow.beschreibung : String(beschreibung ?? ""),
  });
}

/**
 * Einen Schritt um eine Stelle verschieben.
 *
 * @param {"hoch"|"runter"} richtung
 */
export function schrittVerschieben(wf, index, richtung) {
  const geprueft = workflowPruefen(wf);
  if (!geprueft.ok) return geprueft;
  const steps = [...geprueft.workflow.steps];
  const ziel = richtung === "hoch" ? index - 1 : index + 1;
  if (!Number.isInteger(index) || index < 0 || index >= steps.length || ziel < 0 || ziel >= steps.length) {
    return absage("schritt_nicht_da", "Dorthin laesst sich dieser Schritt nicht schieben.",
      "Der erste Schritt kann nicht hoeher, der letzte nicht tiefer.");
  }
  const merk = steps[index];
  steps[index] = steps[ziel];
  steps[ziel] = merk;
  return workflowPruefen({ ...geprueft.workflow, steps });
}

/** Einen Schritt loeschen. Der letzte bleibt stehen. */
export function schrittLoeschen(wf, index) {
  const geprueft = workflowPruefen(wf);
  if (!geprueft.ok) return geprueft;
  const steps = [...geprueft.workflow.steps];
  if (!Number.isInteger(index) || index < 0 || index >= steps.length) {
    return absage("schritt_nicht_da", "Diesen Schritt gibt es in dem Ablauf nicht.",
      "Die Liste ist inzwischen eine andere, sieh sie dir noch einmal an.");
  }
  if (steps.length === 1) {
    /* Ein Ablauf ohne Schritte faellt in `workflowPruefen` durch. Ihn hier
       entstehen zu lassen hiesse, dem Menschen einen Ablauf zu zeigen, den er
       nicht mehr speichern kann. */
    return absage("letzter_schritt", "Der letzte Schritt bleibt stehen, sonst waere es kein Ablauf mehr.",
      "Loesch lieber den ganzen Ablauf.");
  }
  steps.splice(index, 1);
  return workflowPruefen({ ...geprueft.workflow, steps });
}

/**
 * Die Platzhalter eines Ablaufs pflegen.
 *
 * Einen Namen zu entfernen, der noch in einem Schritt steht, faellt in
 * `workflowPruefen` mit `platzhalter_unbekannt` durch. Genau so soll es sein:
 * Der Ablauf tippte den Platzhalter sonst woertlich in ein Formular.
 */
export function platzhalterSetzen(wf, namen) {
  const geprueft = workflowPruefen(wf);
  if (!geprueft.ok) return geprueft;
  const params = [];
  for (const roh of Array.isArray(namen) ? namen : []) {
    const name = String(roh ?? "").trim();
    if (!name) continue;
    if (!PARAM_NAME_MUSTER.test(name)) {
      return absage("params_ungueltig", `„${saeubern(name, 40)}" ist kein Name fuer einen Wert.`,
        "Buchstaben, Ziffern und Unterstrich, hoechstens 40 Zeichen.");
    }
    if (!params.includes(name)) params.push(name);
  }
  if (params.length > GRENZEN.workflowParams) {
    return absage("params_ungueltig",
      `Das sind ${params.length} Werte, ich nehme hoechstens ${GRENZEN.workflowParams}.`,
      `Hoechstens ${GRENZEN.workflowParams} Platzhalter je Ablauf.`);
  }
  return workflowPruefen({ ...geprueft.workflow, params });
}

/**
 * Einen Ablauf verdoppeln.
 *
 * @param {string[]} vorhandene  die schon vergebenen Kennungen
 *
 * Die neue Kennung wird gesucht, nicht geraten: Eine Kopie, die eine
 * bestehende Kennung traegt, ueberschriebe beim Speichern das Original, und
 * dann waere aus „verdoppeln" ein Loeschen geworden.
 */
export function duplizieren(wf, vorhandene = []) {
  const geprueft = workflowPruefen(wf);
  if (!geprueft.ok) return geprueft;
  const alt = geprueft.workflow;
  const genommen = new Set(Array.isArray(vorhandene) ? vorhandene : []);

  /* `wf_` plus hoechstens 40 Zeichen (WORKFLOW_ID_MUSTER). `_kopie99` braucht
     acht davon, also bleiben 32 fuer den Rumpf. */
  const rumpf = alt.id.slice(3, 3 + 32);
  let kennung = `wf_${rumpf}_kopie`;
  let n = 2;
  while (genommen.has(kennung)) {
    if (n > 99) {
      return absage("zu_viele_kopien", "Von diesem Ablauf gibt es schon sehr viele Kopien.",
        "Eine davon umbenennen oder loeschen.");
    }
    kennung = `wf_${rumpf}_kopie${n}`;
    n += 1;
  }

  const name = `${saeubern(alt.name, WERKSTATT_GRENZEN.namenZeichen - 8)} (Kopie)`;
  /* Der Zeitstempel faellt weg: Die Kopie entsteht jetzt und nicht damals.
     `workflowSchreiben` setzt ihn beim Speichern. */
  return workflowPruefen({ ...alt, id: kennung, name, created: "" });
}

/* --------------------------------------------------------------------- *
 * Bauhilfen fuer den Seitenbaum
 * --------------------------------------------------------------------- */

function macher(wurzel) {
  const dok = (wurzel && wurzel.ownerDocument) || globalThis.document;
  return (tag, klasse = "", text = "") => {
    const el = dok.createElement(tag);
    if (klasse) el.className = klasse;
    if (text) el.textContent = text;
    return el;
  };
}

/**
 * Ein Text mit Sprachmarke, und zwar gleich in der Sprache des Nutzers.
 *
 * `text` ist die deutsche Fassung UND der Notfalltext: Fehlt der Schluessel
 * im Katalog, gibt Chrome die leere Zeichenkette zurueck, und eine leere
 * Beschriftung waere schlimmer als eine unuebersetzte. `werte` fuellt `$1`,
 * `$2`, … — ohne sie muesste der Satz vorher zusammengesetzt werden, und
 * dann liesse er sich nicht mehr uebersetzen.
 */
function beschriften(el, schluessel, text, werte = []) {
  el.setAttribute("data-i18n", schluessel);
  el.textContent = t(schluessel, text, ...werte);
  return el;
}

function knopfBauen(neu, klasse, schluessel, text, tun) {
  const k = neu("button", klasse);
  k.setAttribute("type", "button");
  beschriften(k, schluessel, text);
  k.addEventListener("click", tun);
  return k;
}

/**
 * Ein Zeitpunkt, wie ein Mensch ihn liest, in der Zeit seines Rechners.
 *
 * Nicht ISO: `2023-11-14T22:13:20Z` ist beim Vorlesen eine Zumutung und steht
 * ausserdem in einer Zeitzone, in der der Inhaber nicht lebt. Das Buch ist
 * eine Auskunft an ihn, kein Maschinenformat, und die Sortierung liegt
 * ohnehin in der Reihenfolge der Zeilen.
 */
export function zeitSatz(ms) {
  const d = new Date(Number(ms) || 0);
  const zwei = (n) => String(n).padStart(2, "0");
  return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${d.getFullYear()}, ${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
}

/** Ein Schritt in einem Satz, kurz genug zum Vorlesen. */
export function schrittSatz(schritt) {
  if (!schritt || typeof schritt !== "object") return "";
  const typ = String(schritt.type || "");
  switch (typ) {
    case "navigate": return `Adresse aufrufen: ${saeubern(schritt.url, 60)}`;
    case "click": return `Klicken auf ${saeubern(schritt.selector_cascade && schritt.selector_cascade[0], 60)}`;
    case "dblclick": return `Doppelklick auf ${saeubern(schritt.selector_cascade && schritt.selector_cascade[0], 60)}`;
    case "input": return `Eintippen: ${saeubern(schritt.value, 40)}`;
    case "select": return `Auswaehlen: ${saeubern(schritt.value ?? schritt.label ?? schritt.index, 40)}`;
    case "scroll": return `Rollen ${saeubern(schritt.direction || "zu einem Element", 30)}`;
    case "key": return `Taste ${saeubern(schritt.key, 10)}`;
    case "wait": return `Warten ${saeubern(schritt.until || `${schritt.ms} ms`, 30)}`;
    case "user_input_required": return `Anhalten, du bist dran: ${saeubern(schritt.reason, 60)}`;
    default: return saeubern(typ, 40);
  }
}

/* --------------------------------------------------------------------- *
 * Die Ablaufverwaltung
 * --------------------------------------------------------------------- */

/**
 * Die Werkbank in den Anker bauen.
 *
 * @param {object} wurzel   das Element `#werkbank` aus panel.html
 * @param {object} dienste  { spielen, ausgeben }
 * @returns {object} Griff mit `laden`, `bereit` und den inneren Funktionen
 *
 * `spielen(id, params)` schickt `werkbank:spielen` an den Worker. `ausgeben`
 * ist freiwillig: Fehlt es, landet die JSON-Zeichenkette in einem Textfeld,
 * aus dem der Mensch sie herauskopieren kann. Ein Herunterladen braeuchte die
 * Berechtigung `downloads`, und eine Pflichtberechtigung fuer eine
 * Bequemlichkeit ist keine gute Rechnung.
 */
export function aufbauen(wurzel, dienste = {}) {
  if (!wurzel || typeof wurzel.appendChild !== "function") {
    return { ok: false, grund: "kein_anker" };
  }
  const { spielen, ausgeben } = dienste || {};
  const neu = macher(wurzel);

  wurzel.replaceChildren();
  const stil = neu("style");
  stil.textContent = WERKBANK_STIL;
  wurzel.appendChild(stil);

  const rahmen = neu("div", "sa-werkbank");
  wurzel.appendChild(rahmen);

  const zustand = { ablaeufe: [], offen: null, werteFeld: null };

  /* ---- Abschnitt: Ablaeufe ---- */
  const abschnitt = neu("section", "sa-wb-abschnitt");
  const titel = neu("h3");
  /* Nicht `werkbank_titel`: Den Schluessel traegt schon die Ueberschrift der
     Karte in panel.html, und derselbe Schluessel mit zwei Texten waere ein
     Katalog, der sich selbst widerspricht. */
  beschriften(titel, "werkbank_liste_titel", "Deine Abläufe");
  abschnitt.appendChild(titel);

  const hinweis = neu("p", "sa-wb-hinweis");
  hinweis.setAttribute("aria-live", "polite");
  hinweis.hidden = true;
  abschnitt.appendChild(hinweis);

  const liste = neu("ul", "sa-wb-liste");
  abschnitt.appendChild(liste);

  const werkstatt = neu("div", "sa-wb-werkstatt");
  werkstatt.hidden = true;
  abschnitt.appendChild(werkstatt);
  rahmen.appendChild(abschnitt);

  /* ---- Abschnitt: Aufzeichnen (§7.2) ----
   *
   * Ohne diese zwei Knoepfe gibt es keinen Weg vom Menschen in den
   * Teach-Modus: `worker.js` beantwortet `rekorder:start` und `rekorder:stop`
   * seit dem 14.08.2026, die Seite antwortet, aber bis hierher sendete kein
   * Bedienelement die Nachricht. Genau die Sorte gruener Weg, die am 11.08.2026
   * einen Auslieferungsblocker ergeben hat.
   *
   * Der Zaehler daneben ist keine Zierde: Eine Aufnahme, die man nicht sieht,
   * ist eine Mitschrift, von der der Mensch nicht weiss, dass sie laeuft. Er
   * steht auch im Tab (Zeichen ● in `rekorder.js`), hier steht er ein zweites
   * Mal, weil die Seitenleiste offen sein kann, waehrend der Tab es nicht ist.
   */
  const aufnahme = neu("section", "sa-wb-abschnitt");
  const aufnahmeTitel = neu("h3");
  beschriften(aufnahmeTitel, "werkbank_aufnahme_titel", "Aufzeichnen");
  aufnahme.appendChild(aufnahmeTitel);

  const aufnahmeStand = neu("p", "sa-wb-klein");
  aufnahmeStand.setAttribute("aria-live", "polite");
  beschriften(aufnahmeStand, "werkbank_aufnahme_aus", "Es läuft keine Aufnahme.");
  aufnahme.appendChild(aufnahmeStand);

  const aufnahmeKnoepfe = neu("div", "sa-wb-gitter");
  const knopfStart = knopfBauen(
    neu, "sa-wb-aufnahme-start", "werkbank_aufnahme_start", "Aufnahme starten", () => aufnahmeStarten()
  );
  const knopfStop = knopfBauen(
    neu, "sa-wb-aufnahme-stop", "werkbank_aufnahme_stop", "Aufnahme beenden", () => aufnahmeBeenden()
  );
  aufnahmeKnoepfe.appendChild(knopfStart);
  aufnahmeKnoepfe.appendChild(knopfStop);
  aufnahme.appendChild(aufnahmeKnoepfe);
  /* Ohne die Dienste gibt es diesen Abschnitt gar nicht. Ein Knopf, der
     nachweislich nichts ausloesen kann, gehoert weggelassen und nicht
     ausgegraut (Regel Inhaber: keine Negativtexte in Kunden-Oberflaechen). */
  if (typeof dienste.aufnahmeStart === "function" && typeof dienste.aufnahmeStop === "function") {
    rahmen.appendChild(aufnahme);
  }

  /* ---- Abschnitt: Ausgeben und Einlesen ---- */
  const austausch = neu("section", "sa-wb-abschnitt");
  const austauschTitel = neu("h3");
  beschriften(austauschTitel, "werkbank_austausch_titel", "Sichern und zurückholen");
  austausch.appendChild(austauschTitel);

  const feld = neu("textarea", "sa-wb-ausgabe");
  feld.setAttribute("aria-label", t("werkbank_json_feld", "JSON der Abläufe"));
  feld.setAttribute("data-i18n-attr", "aria-label:werkbank_json_feld");
  austausch.appendChild(feld);

  const austauschKnoepfe = neu("div", "sa-wb-gitter");
  austauschKnoepfe.appendChild(
    knopfBauen(neu, "sa-wb-ausgeben", "werkbank_ausgeben", "Alle ausgeben", () => alleAusgeben())
  );
  austauschKnoepfe.appendChild(
    knopfBauen(neu, "sa-wb-einlesen", "werkbank_einlesen", "Aus dem Feld einlesen", () => ausDemFeldEinlesen())
  );
  austausch.appendChild(austauschKnoepfe);
  rahmen.appendChild(austausch);

  /* ---- Abschnitt: Einstellungsmatrix ---- */
  const matrixAnker = neu("section", "sa-wb-abschnitt");
  rahmen.appendChild(matrixAnker);
  const matrix = matrixAufbauen(matrixAnker);

  /* ------------------------------------------------------------------ */

  function sagen(schluessel, text, absageAn = false, werte = []) {
    if (!text) {
      hinweis.hidden = true;
      hinweis.textContent = "";
      hinweis.className = "sa-wb-hinweis";
      hinweis.removeAttribute("data-i18n");
      return;
    }
    hinweis.className = absageAn ? "sa-wb-hinweis absage" : "sa-wb-hinweis";
    if (schluessel) beschriften(hinweis, schluessel, text, werte);
    else {
      /* Saetze aus `werkstatt.js` und `matrix.js` sind Protokolltext und
         tragen keinen Sprachschluessel. Sie stehen woertlich da, statt durch
         einen allgemeinen Satz ersetzt zu werden, der nichts erklaert. */
      hinweis.removeAttribute("data-i18n");
      hinweis.textContent = text;
    }
    hinweis.hidden = false;
  }

  function absageSagen(antwort) {
    const satz = antwort && antwort.satz ? antwort.satz : "Das hat gerade nicht geklappt.";
    const zusatz = antwort && antwort.hinweis ? ` ${antwort.hinweis}` : "";
    sagen(null, `${satz}${zusatz}`, true);
  }

  /** Alles aus der Ablage holen und anzeigen. Wirft nie. */
  async function laden() {
    try {
      zustand.ablaeufe = await workflowsLesen();
    } catch (_) {
      zustand.ablaeufe = [];
      sagen("werkbank_nicht_geladen", "Die Abläufe waren gerade nicht zu lesen, versuch es noch einmal.", true);
    }
    zeichnen();
    return zustand.ablaeufe;
  }

  function zeichnen() {
    liste.replaceChildren();
    if (!zustand.ablaeufe.length) {
      const leer = neu("li", "sa-wb-klein");
      beschriften(leer, "werkbank_leer", "Hier ist noch kein Ablauf. Zeichne einen auf, dann steht er hier.");
      liste.appendChild(leer);
    }
    for (const wf of zustand.ablaeufe) {
      const zeile = neu("li", "sa-wb-zeile");
      zeile.appendChild(neu("span", "sa-wb-name", wf.name));
      zeile.appendChild(neu("span", "sa-wb-klein", `${wf.steps.length} Schritte`));
      zeile.appendChild(
        knopfBauen(neu, "sa-wb-oeffnen", "werkbank_ablauf_oeffnen", "Öffnen", () => oeffnen(wf.id))
      );
      if (typeof spielen === "function") {
        zeile.appendChild(
          knopfBauen(neu, "sa-wb-spielen", "werkbank_spielen", "Abspielen", () => abspielen(wf.id))
        );
      }
      zeile.appendChild(
        knopfBauen(neu, "sa-wb-kopieren", "werkbank_kopieren", "Verdoppeln", () => verdoppeln(wf.id))
      );
      zeile.appendChild(
        knopfBauen(neu, "sa-wb-loeschen", "werkbank_loeschen", "Löschen", () => entfernen(wf.id))
      );
      liste.appendChild(zeile);
    }
    werkstattZeichnen();
  }

  function holen(id) {
    return zustand.ablaeufe.find((w) => w.id === id) || null;
  }

  function oeffnen(id) {
    zustand.offen = zustand.offen === id ? null : id;
    werkstattZeichnen();
  }

  /** Ein geaendertes Stueck speichern und die Liste auffrischen. */
  async function sichern(neuerWf) {
    const antwort = await workflowSchreiben(neuerWf);
    if (!antwort.ok) {
      absageSagen(antwort);
      return antwort;
    }
    sagen("werkbank_gesichert", "Gespeichert.");
    await laden();
    return antwort;
  }

  function werkstattZeichnen() {
    werkstatt.replaceChildren();
    const wf = zustand.offen ? holen(zustand.offen) : null;
    if (!wf) {
      werkstatt.hidden = true;
      return;
    }
    werkstatt.hidden = false;

    /* Name und Beschreibung */
    const nameFeld = neu("div", "sa-wb-feld");
    const nameSchild = neu("label");
    beschriften(nameSchild, "werkbank_name", "Name");
    const nameEingabe = neu("input", "sa-wb-name-eingabe");
    nameEingabe.value = wf.name;
    nameEingabe.addEventListener("change", async () => {
      const gebaut = benennen(wf, nameEingabe.value, undefined);
      if (!gebaut.ok) return absageSagen(gebaut);
      await sichern(gebaut.workflow);
    });
    nameFeld.appendChild(nameSchild);
    nameFeld.appendChild(nameEingabe);
    werkstatt.appendChild(nameFeld);

    const beschreibFeld = neu("div", "sa-wb-feld");
    const beschreibSchild = neu("label");
    beschriften(beschreibSchild, "werkbank_beschreibung", "Beschreibung");
    const beschreibEingabe = neu("input", "sa-wb-beschreibung-eingabe");
    beschreibEingabe.value = wf.beschreibung;
    beschreibEingabe.addEventListener("change", async () => {
      const gebaut = benennen(wf, wf.name, beschreibEingabe.value);
      if (!gebaut.ok) return absageSagen(gebaut);
      await sichern(gebaut.workflow);
    });
    beschreibFeld.appendChild(beschreibSchild);
    beschreibFeld.appendChild(beschreibEingabe);
    werkstatt.appendChild(beschreibFeld);

    /* Platzhalter */
    const paramFeld = neu("div", "sa-wb-feld");
    const paramSchild = neu("label");
    beschriften(paramSchild, "werkbank_platzhalter", "Werte, die der Ablauf braucht, mit Komma getrennt");
    const paramEingabe = neu("input", "sa-wb-params");
    paramEingabe.value = wf.params.join(", ");
    paramEingabe.addEventListener("change", async () => {
      const gebaut = platzhalterSetzen(wf, String(paramEingabe.value || "").split(","));
      if (!gebaut.ok) return absageSagen(gebaut);
      await sichern(gebaut.workflow);
    });
    paramFeld.appendChild(paramSchild);
    paramFeld.appendChild(paramEingabe);
    werkstatt.appendChild(paramFeld);

    /* Schritte */
    const schritteListe = neu("ul", "sa-wb-schritte");
    wf.steps.forEach((schritt, i) => {
      const zeile = neu("li", "sa-wb-schritt");
      zeile.appendChild(neu("span", "sa-wb-schritt-nr", `${i + 1}.`));
      zeile.appendChild(neu("span", "sa-wb-schritt-text", schrittSatz(schritt)));
      if (i > 0) {
        zeile.appendChild(
          knopfBauen(neu, "sa-wb-hoch", "werkbank_hoch", "Nach oben", () => verschieben(wf.id, i, "hoch"))
        );
      }
      if (i < wf.steps.length - 1) {
        zeile.appendChild(
          knopfBauen(neu, "sa-wb-runter", "werkbank_runter", "Nach unten", () => verschieben(wf.id, i, "runter"))
        );
      }
      if (wf.steps.length > 1) {
        /* Beim letzten verbliebenen Schritt steht der Knopf gar nicht erst da,
           statt dazustehen und beim Druck abzusagen. */
        zeile.appendChild(
          knopfBauen(neu, "sa-wb-schritt-weg", "werkbank_schritt_weg", "Weg damit", () => schrittWeg(wf.id, i))
        );
      }
      schritteListe.appendChild(zeile);
    });
    werkstatt.appendChild(schritteListe);

    /* Werte fuer das Abspielen */
    if (wf.params.length && typeof spielen === "function") {
      const werteFeld = neu("div", "sa-wb-feld");
      const werteSchild = neu("label");
      beschriften(werteSchild, "werkbank_werte", "Werte für diesen Lauf, Name gleich Wert je Zeile");
      const werteEingabe = neu("textarea", "sa-wb-werte");
      werteEingabe.value = wf.params.map((p) => `${p}=`).join("\n");
      werteFeld.appendChild(werteSchild);
      werteFeld.appendChild(werteEingabe);
      werkstatt.appendChild(werteFeld);
      zustand.werteFeld = werteEingabe;
    } else {
      zustand.werteFeld = null;
    }

    werkstatt.appendChild(
      knopfBauen(neu, "sa-wb-einzeln-ausgeben", "werkbank_einzeln_ausgeben", "Diesen Ablauf ausgeben",
        () => einzelnAusgeben(wf.id))
    );
  }

  async function verschieben(id, i, richtung) {
    const wf = holen(id);
    if (!wf) return sagen("werkbank_weg", "Diesen Ablauf gibt es nicht mehr.", true);
    const gebaut = schrittVerschieben(wf, i, richtung);
    if (!gebaut.ok) return absageSagen(gebaut);
    return sichern(gebaut.workflow);
  }

  async function schrittWeg(id, i) {
    const wf = holen(id);
    if (!wf) return sagen("werkbank_weg", "Diesen Ablauf gibt es nicht mehr.", true);
    const gebaut = schrittLoeschen(wf, i);
    if (!gebaut.ok) return absageSagen(gebaut);
    return sichern(gebaut.workflow);
  }

  async function verdoppeln(id) {
    const wf = holen(id);
    if (!wf) return sagen("werkbank_weg", "Diesen Ablauf gibt es nicht mehr.", true);
    const gebaut = duplizieren(wf, zustand.ablaeufe.map((w) => w.id));
    if (!gebaut.ok) return absageSagen(gebaut);
    return sichern(gebaut.workflow);
  }

  async function entfernen(id) {
    const antwort = await workflowLoeschen(id);
    if (!antwort.ok) {
      absageSagen(antwort);
      return antwort;
    }
    if (zustand.offen === id) zustand.offen = null;
    sagen("werkbank_geloescht", "Gelöscht.");
    await laden();
    return antwort;
  }

  /** Die Werte aus dem Textfeld, Name gleich Wert je Zeile. */
  function werteLesen() {
    const werte = {};
    const roh = zustand.werteFeld ? String(zustand.werteFeld.value || "") : "";
    for (const zeile of roh.split("\n")) {
      const stelle = zeile.indexOf("=");
      if (stelle < 0) continue;
      const name = zeile.slice(0, stelle).trim();
      if (!name) continue;
      werte[name] = zeile.slice(stelle + 1).trim();
    }
    return werte;
  }

  /**
   * Einen Ablauf abspielen.
   *
   * Die Werte gehen VOR dem Absenden durch `platzhalterFuellen`. Nicht, weil
   * der Worker sie nicht pruefen wuerde, sondern weil der Mensch, der sie
   * gerade getippt hat, den Satz dazu hier bekommt und nicht als Fehlercode
   * aus der Ferne.
   */
  async function abspielen(id) {
    if (typeof spielen !== "function") return { ok: false, code: "kein_dienst" };
    const wf = holen(id);
    if (!wf) {
      sagen("werkbank_weg", "Diesen Ablauf gibt es nicht mehr.", true);
      return { ok: false, code: "workflow_not_found" };
    }
    const params = zustand.offen === id ? werteLesen() : {};
    const gefuellt = platzhalterFuellen(wf, params);
    if (!gefuellt.ok) {
      absageSagen(gefuellt);
      return gefuellt;
    }
    try {
      const antwort = await spielen(wf.id, params);
      if (antwort && antwort.ok === false) {
        absageSagen(antwort);
        return antwort;
      }
      sagen("werkbank_laeuft", "Der Ablauf ist unterwegs, jeden Schritt gibst du frei wie sonst auch.");
      return antwort || { ok: true };
    } catch (_) {
      sagen("werkbank_nicht_gestartet", "Der Ablauf kam gerade nicht durch, versuch es noch einmal.", true);
      return { ok: false, code: "spielen_fehler" };
    }
  }

  /** Die JSON-Zeichenkette hinlegen: an den Dienst, sonst ins Textfeld. */
  async function textHinlegen(text, dateiname) {
    feld.value = text;
    if (typeof ausgeben === "function") {
      try {
        await ausgeben(text, dateiname);
      } catch (_) {
        /* Bleibt der Weg nach draussen zu, steht der Text immer noch im Feld.
           Eine Ausgabe, die nur scheitert, waere keine. */
        sagen("werkbank_ausgabe_im_feld", "Der Text steht im Feld, du kannst ihn von dort kopieren.");
      }
    }
    return text;
  }

  async function alleAusgeben() {
    const text = ausgebenText(zustand.ablaeufe);
    sagen("werkbank_ausgegeben", "Fertig, der Text steht im Feld.");
    return textHinlegen(text, "smartrchrome-ablaeufe.json");
  }

  async function einzelnAusgeben(id) {
    const wf = holen(id);
    if (!wf) return sagen("werkbank_weg", "Diesen Ablauf gibt es nicht mehr.", true);
    const text = ausgebenText([wf]);
    sagen("werkbank_ausgegeben", "Fertig, der Text steht im Feld.");
    return textHinlegen(text, `${wf.id}.json`);
  }

  /**
   * Den Inhalt des Feldes einlesen.
   *
   * Ganz oder gar nicht: Faellt ein Ablauf durch, wird KEINER gespeichert.
   * Deshalb steht die Pruefung vollstaendig vor dem ersten Schreiben.
   */
  async function ausDemFeldEinlesen() {
    const geprueft = einlesen(feld.value);
    if (!geprueft.ok) {
      absageSagen(geprueft);
      return geprueft;
    }
    const geschrieben = [];
    for (const wf of geprueft.workflows) {
      const antwort = await workflowSchreiben(wf);
      if (!antwort.ok) {
        absageSagen(antwort);
        await laden();
        return antwort;
      }
      geschrieben.push(antwort.workflow.id);
    }
    sagen("werkbank_eingelesen", "Eingelesen, $1 Abläufe stehen jetzt hier.", false, [geschrieben.length]);
    await laden();
    return { ok: true, ids: geschrieben };
  }

  /* ------------------------------------------------------------------ *
   * Aufzeichnen (§7.2)
   *
   * Der Weg ist absichtlich derselbe wie beim Einlesen aus dem Feld: Was der
   * Rekorder liefert, geht durch `workflowPruefen` und `adressenPruefen`, ganz
   * oder gar nicht. Eine Aufzeichnung ist eine Quelle wie jede andere, und
   * kein Ablauf kommt in die Ablage, ohne durch die Positivliste gegangen zu
   * sein.
   * ------------------------------------------------------------------ */

  /** Wie die Aufnahme gerade steht. Sie wird angezeigt, nicht behauptet. */
  function aufnahmeStandSetzen({ anzahl = 0, laeuft = false } = {}) {
    const zahl = Number.isFinite(Number(anzahl)) ? Math.max(0, Math.floor(Number(anzahl))) : 0;
    if (laeuft) {
      aufnahmeStand.removeAttribute("data-i18n");
      aufnahmeStand.textContent =
        zahl === 1 ? "Aufnahme laeuft, 1 Schritt." : `Aufnahme laeuft, ${zahl} Schritte.`;
    } else {
      beschriften(aufnahmeStand, "werkbank_aufnahme_aus", "Es läuft keine Aufnahme.");
    }
    return { anzahl: zahl, laeuft };
  }

  async function aufnahmeStarten() {
    if (typeof dienste.aufnahmeStart !== "function") {
      return absage("kein_dienst", "Aufzeichnen kann diese Fassung hier nicht.");
    }
    let antwort = null;
    try {
      antwort = await dienste.aufnahmeStart();
    } catch (_) {
      antwort = null;
    }
    if (!antwort || antwort.ok !== true) {
      const satz = (antwort && (antwort.klartext || antwort.satz)) ||
        "Auf dieser Seite kann ich nicht aufzeichnen.";
      sagen(null, satz, true);
      return { ok: false, satz };
    }
    aufnahmeStandSetzen({ anzahl: Number(antwort.anzahl) || 0, laeuft: true });
    sagen("werkbank_aufnahme_laeuft", "Die Aufnahme läuft. Mach jetzt im Tab, was der Ablauf können soll.");
    return { ok: true };
  }

  /**
   * Die Aufnahme beenden und das Ergebnis als Ablauf speichern.
   *
   * Ein Name muss sein, sonst faellt `workflowPruefen` mit einer Absage durch,
   * die der Mensch nicht versteht. Er entsteht hier aus Datum und Uhrzeit und
   * ist in der Liste sofort umbenennbar.
   */
  async function aufnahmeBeenden() {
    if (typeof dienste.aufnahmeStop !== "function") {
      return absage("kein_dienst", "Aufzeichnen kann diese Fassung hier nicht.");
    }
    let antwort = null;
    try {
      antwort = await dienste.aufnahmeStop();
    } catch (_) {
      antwort = null;
    }
    aufnahmeStandSetzen({ anzahl: 0, laeuft: false });
    if (!antwort || antwort.ok !== true) {
      const satz = (antwort && (antwort.klartext || antwort.satz)) ||
        "Die Aufnahme liess sich nicht beenden.";
      sagen(null, satz, true);
      return { ok: false, satz };
    }
    const schritte = Array.isArray(antwort.schritte) ? antwort.schritte : [];
    if (!schritte.length) {
      sagen("werkbank_aufnahme_leer", "Die Aufnahme ist beendet, aufgezeichnet wurde nichts.");
      return { ok: true, leer: true };
    }

    const jetzt = new Date();
    const roh = {
      id: `wf_a${Date.now().toString(36).toLowerCase()}`,
      name: `Aufnahme vom ${zeitSatz(jetzt.getTime())}`,
      version: WORKFLOW_VERSION,
      params: [],
      steps: schritte,
    };
    const geprueft = workflowPruefen(roh);
    if (!geprueft.ok) {
      absageSagen(geprueft);
      return geprueft;
    }
    const adressen = adressenPruefen(geprueft.workflow);
    if (!adressen.ok) {
      absageSagen(adressen);
      return adressen;
    }
    const geschrieben = await workflowSchreiben(geprueft.workflow);
    if (!geschrieben.ok) {
      absageSagen(geschrieben);
      return geschrieben;
    }
    sagen("werkbank_aufnahme_fertig", "Aufgezeichnet, $1 Schritte stehen als neuer Ablauf hier.", false, [schritte.length]);
    await laden();
    return geschrieben;
  }

  const griff = {
    ok: true,
    wurzel,
    liste,
    hinweis,
    werkstatt,
    feld,
    matrix,
    zustand,
    laden,
    oeffnen,
    abspielen,
    verdoppeln,
    entfernen,
    verschieben,
    schrittWeg,
    alleAusgeben,
    einzelnAusgeben,
    ausDemFeldEinlesen,
    /* Die Seitenleiste reicht `rekorder:stand` hierher durch. Der Zaehler
       kommt aus dem Tab und wird angezeigt, nicht geglaubt: Er stellt nichts
       ein und loest nichts aus. */
    aufnahmeStandSetzen,
    aufnahmeStarten,
    aufnahmeBeenden,
    aufnahmeStand,
    knopfAufnahmeStart: knopfStart,
    knopfAufnahmeStop: knopfStop,
  };
  griff.bereit = laden();
  return griff;
}

/* --------------------------------------------------------------------- *
 * Die Einstellungsmatrix (§4)
 * --------------------------------------------------------------------- */

/**
 * Die Matrix in den Anker bauen.
 *
 * @returns {object} Griff mit `laden`, `speichern`, `entwurf`
 *
 * Gearbeitet wird an einem ENTWURF im Speicher; erst „Speichern" schickt ihn
 * durch `matrixSchreiben`. Das ist Absicht: `matrixSchreiben` ist ganz oder
 * gar nicht, und ein Haken, der einzeln geschrieben wuerde, koennte eine
 * Absage ausloesen, waehrend der Haken schon dasteht.
 */
export function matrixAufbauen(wurzel) {
  if (!wurzel || typeof wurzel.appendChild !== "function") {
    return { ok: false, grund: "kein_anker" };
  }
  const neu = macher(wurzel);
  wurzel.replaceChildren();

  const titel = neu("h3");
  beschriften(titel, "matrix_titel", "Was ohne Rückfrage laufen darf");
  wurzel.appendChild(titel);

  const einleitung = neu("p", "sa-wb-klein");
  beschriften(einleitung, "matrix_einleitung",
    "Alles hier ist zu Anfang aus. Was du einschaltest, gilt nur für die Adresse, die daneben steht.");
  wurzel.appendChild(einleitung);

  const hinweis = neu("p", "sa-wb-hinweis");
  hinweis.setAttribute("aria-live", "polite");
  hinweis.hidden = true;
  wurzel.appendChild(hinweis);

  /* Sperrliste */
  const sperrFeld = neu("div", "sa-wb-feld");
  const sperrSchild = neu("label");
  beschriften(sperrSchild, "matrix_sperrliste", "Adressen, die tabu bleiben, eine je Zeile");
  const sperrEingabe = neu("textarea", "sa-matrix-gesperrt");
  sperrFeld.appendChild(sperrSchild);
  sperrFeld.appendChild(sperrEingabe);
  wurzel.appendChild(sperrFeld);

  /* Domains */
  const domainTitel = neu("h4");
  beschriften(domainTitel, "matrix_domains", "Adressen, auf denen mehr ohne Rückfrage laufen darf");
  wurzel.appendChild(domainTitel);
  const domainListe = neu("ul", "sa-wb-liste");
  wurzel.appendChild(domainListe);

  const domainNeu = neu("div", "sa-wb-zeile");
  const domainEingabe = neu("input", "sa-matrix-domain-neu");
  domainEingabe.setAttribute("aria-label", t("matrix_domain_neu", "Adresse hinzufügen"));
  domainEingabe.setAttribute("data-i18n-attr", "aria-label:matrix_domain_neu");
  domainNeu.appendChild(domainEingabe);
  domainNeu.appendChild(
    knopfBauen(neu, "sa-matrix-domain-dazu", "matrix_domain_dazu", "Adresse aufnehmen", () => {
      const name = String(domainEingabe.value || "").trim().toLowerCase();
      if (!name) return;
      if (!entwurf.domains[name]) entwurf.domains[name] = { frei: [] };
      domainEingabe.value = "";
      zeichnen();
    })
  );
  wurzel.appendChild(domainNeu);

  /* Agenten */
  const agentTitel = neu("h4");
  beschriften(agentTitel, "matrix_agenten", "Was ein einzelner Agent wo darf");
  wurzel.appendChild(agentTitel);
  const agentListe = neu("div", "sa-matrix-agenten");
  wurzel.appendChild(agentListe);

  const knoepfe = neu("div", "sa-wb-gitter");
  knoepfe.appendChild(
    knopfBauen(neu, "sa-matrix-speichern", "matrix_speichern", "Einstellung speichern", () => speichern())
  );
  wurzel.appendChild(knoepfe);

  let entwurf = { version: 1, domains: {}, gesperrt: [], agenten: {} };

  function sagen(schluessel, text, absageAn = false, werte = []) {
    if (!text) {
      hinweis.hidden = true;
      hinweis.textContent = "";
      hinweis.removeAttribute("data-i18n");
      return;
    }
    hinweis.className = absageAn ? "sa-wb-hinweis absage" : "sa-wb-hinweis";
    if (schluessel) beschriften(hinweis, schluessel, text, werte);
    else {
      hinweis.removeAttribute("data-i18n");
      hinweis.textContent = text;
    }
    hinweis.hidden = false;
  }

  function gesperrtHier(host) {
    return entwurf.gesperrt.some((muster) => hostMuster(muster, host));
  }

  function schalterBauen(beschriftung, an, umschalten) {
    const huelle = neu("label", "sa-wb-schalter");
    const kasten = neu("input", "");
    kasten.setAttribute("type", "checkbox");
    kasten.checked = !!an;
    kasten.addEventListener("change", () => umschalten(!!kasten.checked));
    huelle.appendChild(kasten);
    huelle.appendChild(neu("span", "", beschriftung));
    return huelle;
  }

  function zeichnen() {
    sperrEingabe.value = entwurf.gesperrt.join("\n");

    domainListe.replaceChildren();
    const namen = Object.keys(entwurf.domains);
    if (!namen.length) {
      const leer = neu("li", "sa-wb-klein");
      beschriften(leer, "matrix_domains_leer",
        "Noch keine Adresse. Ohne Eintrag fragt die Erweiterung bei allem nach, und das ist die sichere Seite.");
      domainListe.appendChild(leer);
    }
    for (const name of namen) {
      const zeile = neu("li", "sa-wb-zeile");
      zeile.appendChild(neu("span", "sa-wb-name", name));
      if (gesperrtHier(name)) {
        /* Ein Schalter, der neben einer Sperre steht, schaltet nichts: Die
           Sperre ist in `regelnFuer` das letzte Wort. Er steht deshalb gar
           nicht erst da, und an seiner Stelle steht der Grund. */
        const wort = neu("span", "sa-wb-klein");
        beschriften(wort, "matrix_steht_gesperrt", "Diese Adresse steht auf deiner Sperrliste.");
        zeile.appendChild(wort);
      } else {
        /* NUR die weichen Klassen. Harte Klassen sind nicht abschaltbar (§3),
           und ein Schalter fuer „Zahlung" liesse den Menschen glauben, er
           haette sie freigeschaltet. */
        for (const klasse of WEICH) {
          const an = entwurf.domains[name].frei.includes(klasse);
          zeile.appendChild(schalterBauen(klasse, an, (jetzt) => {
            const frei = new Set(entwurf.domains[name].frei);
            if (jetzt) frei.add(klasse);
            else frei.delete(klasse);
            entwurf.domains[name].frei = [...frei];
          }));
        }
      }
      zeile.appendChild(
        knopfBauen(neu, "sa-matrix-domain-weg", "matrix_domain_weg", "Adresse entfernen", () => {
          delete entwurf.domains[name];
          zeichnen();
        })
      );
      domainListe.appendChild(zeile);
    }

    agentListe.replaceChildren();
    for (const agent of AGENTEN) {
      const je = entwurf.agenten[agent] || {};
      const hosts = Object.keys(je);
      const block = neu("div", "sa-matrix-agent");
      block.appendChild(neu("h5", "", agent));
      if (!hosts.length) {
        const leer = neu("p", "sa-wb-klein");
        beschriften(leer, "matrix_agent_leer", "Für diesen Agenten ist noch nichts eingetragen.");
        block.appendChild(leer);
      }
      for (const host of hosts) {
        const zeile = neu("div", "sa-wb-zeile");
        zeile.appendChild(neu("span", "sa-wb-name", host));
        if (gesperrtHier(host)) {
          const wort = neu("span", "sa-wb-klein");
          beschriften(wort, "matrix_steht_gesperrt", "Diese Adresse steht auf deiner Sperrliste.");
          zeile.appendChild(wort);
        } else {
          for (const klasse of AGENT_KLASSEN) {
            const an = je[host].includes(klasse);
            zeile.appendChild(schalterBauen(klasse, an, (jetzt) => {
              const satz = new Set(je[host]);
              if (jetzt) satz.add(klasse);
              else satz.delete(klasse);
              je[host] = [...satz];
              entwurf.agenten[agent] = je;
            }));
          }
        }
        block.appendChild(zeile);
      }
      const dazuFeld = neu("input", "sa-matrix-agent-host");
      dazuFeld.setAttribute("aria-label", t("matrix_agent_adresse", "Adresse für $1", agent));
      block.appendChild(dazuFeld);
      block.appendChild(
        knopfBauen(neu, "sa-matrix-agent-dazu", "matrix_agent_dazu", "Adresse aufnehmen", () => {
          const host = String(dazuFeld.value || "").trim().toLowerCase();
          if (!host) return;
          const satz = entwurf.agenten[agent] || {};
          if (!satz[host]) satz[host] = [];
          entwurf.agenten[agent] = satz;
          dazuFeld.value = "";
          zeichnen();
        })
      );
      agentListe.appendChild(block);
    }
  }

  /** Die Sperrliste aus dem Textfeld in den Entwurf holen. */
  function sperrlisteUebernehmen() {
    entwurf.gesperrt = String(sperrEingabe.value || "")
      .split("\n")
      .map((z) => z.trim().toLowerCase())
      .filter(Boolean);
  }

  async function laden() {
    try {
      entwurf = await matrixLesen();
    } catch (_) {
      entwurf = { version: 1, domains: {}, gesperrt: [], agenten: {} };
    }
    zeichnen();
    return entwurf;
  }

  /**
   * Den Entwurf speichern.
   *
   * `matrixSchreiben` prueft ganz oder gar nicht. Eine Absage wird woertlich
   * gezeigt: Sie nennt den Eintrag, an dem es haengt, und ein allgemeiner Satz
   * an ihrer Stelle liesse den Menschen suchen.
   */
  async function speichern() {
    sperrlisteUebernehmen();
    const antwort = await matrixSchreiben(entwurf);
    if (!antwort.ok) {
      sagen(null, `${antwort.satz} ${antwort.hinweis || ""}`.trim(), true);
      return antwort;
    }
    entwurf = antwort.matrix;
    zeichnen();
    sagen("matrix_gespeichert", "Gespeichert.");
    return antwort;
  }

  const griff = {
    ok: true,
    wurzel,
    hinweis,
    sperrEingabe,
    domainListe,
    agentListe,
    laden,
    speichern,
    zeichnen,
    entwurf: () => entwurf,
  };
  griff.bereit = laden();
  return griff;
}

/* --------------------------------------------------------------------- *
 * Das Protokollbuch (§8.3)
 * --------------------------------------------------------------------- */

/**
 * Das Protokollbuch in den Anker bauen.
 *
 * @param {object} wurzel   das Element `#buch` aus panel.html
 * @param {object} dienste  { ausgeben }
 *
 * Gezeigt werden genau die sechs Felder, die das Buch fuehrt: Zeitstempel,
 * Agent, Kommando, Zieladresse, Ergebnis, Klassen. Mehr steht dort nicht, und
 * das ist der Grund, warum das Buch ueberhaupt gefuehrt werden darf.
 */
export function buchAufbauen(wurzel, dienste = {}) {
  if (!wurzel || typeof wurzel.appendChild !== "function") {
    return { ok: false, grund: "kein_anker" };
  }
  const { ausgeben } = dienste || {};
  const neu = macher(wurzel);
  wurzel.replaceChildren();

  const stil = neu("style");
  stil.textContent = WERKBANK_STIL;
  wurzel.appendChild(stil);

  const titel = neu("h3");
  beschriften(titel, "buch_ansicht_titel", "Was in deinem Namen geschehen ist");
  wurzel.appendChild(titel);

  const hinweis = neu("p", "sa-wb-hinweis");
  hinweis.setAttribute("aria-live", "polite");
  hinweis.hidden = true;
  wurzel.appendChild(hinweis);

  const fristFeld = neu("div", "sa-wb-feld");
  const fristSchild = neu("label");
  beschriften(fristSchild, "buch_frist", "So viele Tage bleibt ein Eintrag stehen");
  const fristEingabe = neu("input", "sa-buch-tage");
  fristEingabe.setAttribute("type", "number");
  fristEingabe.setAttribute("min", "0");
  fristEingabe.setAttribute("max", String(BUCH_TAGE_HOECHSTENS));
  fristEingabe.value = String(AUFBEWAHRUNG_STANDARD_TAGE);
  fristFeld.appendChild(fristSchild);
  fristFeld.appendChild(fristEingabe);
  wurzel.appendChild(fristFeld);

  const liste = neu("ul", "sa-buch");
  wurzel.appendChild(liste);

  const feld = neu("textarea", "sa-wb-ausgabe");
  feld.setAttribute("aria-label", t("buch_json_feld", "JSON des Protokollbuchs"));
  feld.setAttribute("data-i18n-attr", "aria-label:buch_json_feld");
  wurzel.appendChild(feld);

  const knoepfe = neu("div", "sa-wb-gitter");
  knoepfe.appendChild(
    knopfBauen(neu, "sa-buch-ausgeben", "buch_ansicht_ausgeben", "Buch ausgeben", () => buchAusgabe())
  );
  knoepfe.appendChild(
    knopfBauen(neu, "sa-buch-frist-speichern", "buch_frist_speichern", "Dauer merken", () => fristSpeichern())
  );
  knoepfe.appendChild(
    knopfBauen(neu, "sa-buch-auffrischen", "buch_auffrischen", "Auffrischen", () => laden())
  );
  wurzel.appendChild(knoepfe);

  function sagen(schluessel, text, absageAn = false, werte = []) {
    if (!text) {
      hinweis.hidden = true;
      hinweis.textContent = "";
      hinweis.removeAttribute("data-i18n");
      return;
    }
    hinweis.className = absageAn ? "sa-wb-hinweis absage" : "sa-wb-hinweis";
    if (schluessel) beschriften(hinweis, schluessel, text, werte);
    else {
      hinweis.removeAttribute("data-i18n");
      hinweis.textContent = text;
    }
    hinweis.hidden = false;
  }

  /** Die gemerkte Aufbewahrungsdauer, sonst die Voreinstellung. */
  async function tageLesen() {
    try {
      const daten = await chrome.storage.local.get(BUCH_TAGE_ABLAGE);
      const wert = Number(daten && daten[BUCH_TAGE_ABLAGE]);
      if (Number.isFinite(wert) && wert >= 0 && wert <= BUCH_TAGE_HOECHSTENS) return Math.round(wert);
    } catch (_) {
      /* Ohne Ablage gilt die Voreinstellung. Eine Aufbewahrungsdauer, die bei
         einem Lesefehler auf „unendlich" fiele, waere das Gegenteil von dem,
         was der Mensch eingestellt hat. */
    }
    return AUFBEWAHRUNG_STANDARD_TAGE;
  }

  async function fristSpeichern() {
    /* Befund beim Bauen am 14.08.2026: `Number("")` ist 0, und null Tage
       heisst „alles loeschen". Ein Mensch, der das Feld leert und auf „Dauer
       merken" drueckt, haette damit sein ganzes Protokollbuch verloren, ohne
       je eine Null getippt zu haben. Null muss GETIPPT sein, sonst ist sie
       keine Angabe, sondern ein leeres Feld. */
    const roh = String(fristEingabe.value ?? "").trim();
    const wert = /^[0-9]{1,4}$/.test(roh) ? Number(roh) : NaN;
    if (!Number.isFinite(wert) || wert < 0 || wert > BUCH_TAGE_HOECHSTENS) {
      sagen("buch_frist_ungueltig",
        "Trag eine Zahl zwischen 0 und $1 ein.", true, [BUCH_TAGE_HOECHSTENS]);
      return { ok: false, code: "frist_ungueltig" };
    }
    const tage = Math.round(wert);
    try {
      await chrome.storage.local.set({ [BUCH_TAGE_ABLAGE]: tage });
    } catch (_) {
      sagen("buch_frist_nicht_gemerkt", "Die Dauer ließ sich gerade nicht merken, versuch es noch einmal.", true);
      return { ok: false, code: "ablage_fehler" };
    }
    /* Gemerkt UND angewandt. Eine Aufbewahrungsfrist, die erst beim naechsten
       Wecker greift, laesst genau das stehen, was der Mensch loswerden
       wollte. */
    const geraeumt = await buchAufraeumen(tage);
    sagen("buch_frist_gemerkt", "Gemerkt, $1 Einträge sind weg.", false, [geraeumt.entfernt]);
    await laden();
    return { ok: true, tage, ...geraeumt };
  }

  async function laden() {
    fristEingabe.value = String(await tageLesen());
    let eintraege = [];
    try {
      eintraege = await buchEintraegeLesen();
    } catch (_) {
      sagen("buch_nicht_geladen", "Das Buch war gerade nicht zu lesen, versuch es noch einmal.", true);
    }
    liste.replaceChildren();
    if (!eintraege.length) {
      const leer = neu("li", "sa-wb-klein");
      beschriften(leer, "buch_leer", "Hier steht noch nichts. Es war noch kein Agent an deinem Browser.");
      liste.appendChild(leer);
      return eintraege;
    }
    /* Juengstes zuerst: Wer nachsieht, sucht fast immer das, was eben war. */
    for (const e of [...eintraege].reverse().slice(0, BUCH_ZEILEN)) {
      const zeile = neu("li", "sa-buch-zeile");
      zeile.appendChild(neu("span", "sa-buch-zeit", zeitSatz(e.zeit)));
      zeile.appendChild(neu("span", "sa-buch-agent", e.agent || ""));
      zeile.appendChild(neu("span", "sa-buch-cmd", e.cmd || ""));
      zeile.appendChild(neu("span", "sa-buch-ort", e.url || ""));
      zeile.appendChild(neu("span", "sa-buch-ergebnis", e.ergebnis || ""));
      liste.appendChild(zeile);
    }
    return eintraege;
  }

  /**
   * Das Buch ausgeben.
   *
   * Die Zeichenkette kommt aus `protokollbuch.ausgeben()` und wird hier nicht
   * noch einmal zusammengebaut: Zwei Stellen, die dasselbe Buch verschieden
   * schreiben, sind zwei Auskuenfte ueber denselben Vorgang.
   */
  async function buchAusgabe() {
    const text = await buchAusgeben();
    feld.value = text;
    if (typeof ausgeben === "function") {
      try {
        await ausgeben(text, "smartrchrome-protokollbuch.json");
      } catch (_) {
        sagen("buch_ausgabe_im_feld", "Der Text steht im Feld, du kannst ihn von dort kopieren.");
        return text;
      }
    }
    sagen("buch_ausgegeben", "Fertig, der Text steht im Feld.");
    return text;
  }

  const griff = {
    ok: true,
    wurzel,
    liste,
    hinweis,
    feld,
    fristEingabe,
    laden,
    fristSpeichern,
    buchAusgabe,
    tageLesen,
  };
  griff.bereit = laden();
  return griff;
}

/* Die Schritttypen stehen auch nach aussen bereit: Der Rekorder und die
   Werkbank sollen dieselbe Liste zeigen und nicht zwei nebeneinander. */
export { SCHRITT_TYPEN };
