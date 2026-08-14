/*
 * SMarTrChrome — gespeicherte Abläufe (Vertrag v3.5 §7.3).
 *
 * Ein Ablauf ist eine aufgezeichnete Reihe von Schritten, die der Mensch
 * selbst einmal gemacht hat und danach wieder abspielen lässt. Er liegt in
 * `chrome.storage.local` unter `sa_workflows`.
 *
 * Der Satz, an dem sich diese ganze Datei ausrichtet:
 *
 *   **Die Wiedergabe geht durch dieselbe Befehlsschleife wie ein
 *   Agentenbefehl.** Sie umgeht weder Modus noch Guardrails noch
 *   Bereichsprüfung noch Verdeckungswache. Ein Ablauf ist eine Reihe von
 *   Befehlen, keine zweite Tür.
 *
 * Daraus folgt die Bauart von `workflowPruefen`: eine **Positivliste**, und
 * zwar auf jeder Ebene. Unbekannte Schritttypen, unbekannte Felder und
 * Platzhalter, die nirgends erklärt sind, fallen als benannte Absage heraus
 * und nicht stillschweigend weg.
 *
 * Warum das so streng sein muss und nicht bloss ordentlich ist: Ein Ablauf
 * wird EINMAL angesehen und danach immer wieder abgespielt. Ein Feld, das beim
 * Speichern still verschwindet, fehlt beim zwanzigsten Abspielen genauso, und
 * niemand sucht den Fehler dann noch im Speichern. Ein Schritttyp, den niemand
 * geprüft hat, ist ein Ausführungspfad, den niemand geprüft hat — die offene
 * Menge ist hier die eigentliche Gefahr, nicht der einzelne falsche Wert.
 *
 * Und die Zusage, die aus §7.2 herüberreicht und hier nur noch bewahrt wird:
 * In ein Geheimfeld wird kein Wert aufgezeichnet. An seiner Stelle steht der
 * Schritt `user_input_required`. Diese Datei kann das nicht erzwingen, sie
 * kennt die Seite nicht — aber sie kennt den Schritttyp, und sie lässt ihn
 * ohne Begründung nicht durch.
 */

import {
  GRENZEN,
  PARAM_NAME_MUSTER,
  SCROLL_MENGEN,
  SCROLL_RICHTUNGEN,
  WORKFLOW_ID_MUSTER,
  adresseZerlegen,
  paramsPruefen,
  saeubern,
} from "./befehle.js";

/* Der Ablageschlüssel (§7.3). */
export const WERKSTATT_ABLAGE = "sa_workflows";
export const WORKFLOW_VERSION = 1;

/*
 * Wo die LAUFENDE Aufzeichnung liegt (§7.2), nachgetragen am 14.08.2026.
 *
 * `chrome.storage.local` und nicht `session`: Eine Aufzeichnung führt über
 * Seitenwechsel, und dabei stirbt das Inhaltsskript — es muss sich beim
 * Wiedereinspielen selbst wiederfinden. `session` scheidet aus, weil
 * `chrome.storage.session` für Inhaltsskripte ohne `setAccessLevel`
 * verschlossen ist.
 *
 * `content/rekorder.js` trägt denselben Namen als eigenes Literal, weil ein
 * Inhaltsskript `src/net/*.js` nicht importieren kann. Wer ihn hier ändert,
 * ändert ihn dort mit.
 */
export const REKORDER_ABLAGE = "sa_rekorder";

/*
 * Die Schritttypen. Mehr nicht.
 *
 * Sie sind die Spiegelung dessen, was der Rekorder aufzeichnet (§7.2) und was
 * der Ausführer wirklich kann. Ein Typ hier ohne Weg dort wäre ein Ablauf, der
 * die Freigabe durchläuft und dann ins Leere greift.
 */
export const SCHRITT_TYPEN = Object.freeze([
  "navigate", "click", "dblclick", "input", "select",
  "scroll", "key", "wait", "user_input_required",
]);

/* Worauf ein `navigate` oder ein `wait` warten darf. Geschlossene Menge aus
   demselben Grund wie oben. */
export const WARTE_ARTEN = Object.freeze(["load", "domcontentloaded", "networkidle", "idle"]);

/* Die Tasten, die der Rekorder aufzeichnet (§7.2: „keydown nur für Enter und
   Tab"). Jede weitere Taste wäre eine Tastatureingabe ohne sichtbares Feld,
   und damit eine Eingabe, die der Mensch in der Rückfrage nicht lesen kann. */
export const TASTEN = Object.freeze(["Enter", "Tab"]);

/* Die Felder eines Ablaufs. */
export const WORKFLOW_FELDER = Object.freeze([
  "id", "name", "beschreibung", "version", "created", "params", "steps",
]);

/* Felder, die jeder Schritt tragen darf.

   `beschreibung` steht hier, weil §7.4 sie braucht: Bricht die ganze Kaskade,
   meldet der Ausführer `workflow_step_failed` MIT der Beschreibung des
   gesuchten Elements, damit der Agent selbst ein Ziel benennen kann. Ohne ein
   Feld dafür wäre die Selbstheilung eine Zusage ohne Datengrundlage. */
export const SCHRITT_FELDER_IMMER = Object.freeze(["type", "beschreibung", "screenshot"]);

/* Und die Felder je Typ. */
export const SCHRITT_FELDER = Object.freeze({
  navigate: Object.freeze(["url", "wait"]),
  click: Object.freeze(["selector_cascade"]),
  dblclick: Object.freeze(["selector_cascade"]),
  input: Object.freeze(["selector_cascade", "value", "clear", "submit"]),
  select: Object.freeze(["selector_cascade", "value", "label", "index"]),
  scroll: Object.freeze(["selector_cascade", "direction", "amount"]),
  key: Object.freeze(["key"]),
  wait: Object.freeze(["ms", "until"]),
  user_input_required: Object.freeze(["reason"]),
});

/* Grenzen. Sie stehen hier und nicht verstreut in den Zweigen, damit ein
   Prüfsatz sie messen kann und ein Mensch sie an einer Stelle findet. */
export const WERKSTATT_GRENZEN = Object.freeze({
  namenZeichen: 120,
  beschreibungZeichen: 400,
  ankerJeSchritt: 8,
  ankerZeichen: 400,
  wertZeichen: 2000,
  schritteHoechstens: GRENZEN.schritteDeckel,
  ablaeufeHoechstens: 100,
  wartenMsHoechstens: GRENZEN.schrittFristMs,
});

/* Ein Platzhalter im Text eines Schrittes. Global, weil ein Schritt mehrere
   tragen darf. */
const PLATZHALTER = /\{\{([^{}]*)\}\}/g;

function absage(code, satz, hinweis = "") {
  return { ok: false, code, satz, hinweis };
}

function istText(w) {
  return typeof w === "string";
}

/* --------------------------------------------------------------------- *
 * Prüfen
 * --------------------------------------------------------------------- */

/**
 * Alle Platzhalter, die in dieser Zeichenkette stehen.
 *
 * Auch die kaputten: `{{ }}` und `{{a b}}` kommen als Namen zurück, damit sie
 * an der Prüfung scheitern statt unbemerkt als Text stehen zu bleiben. Ein
 * `{{`, das nie ersetzt wird, landet sonst wörtlich in einem Formularfeld.
 */
function platzhalterFinden(text) {
  const raus = [];
  PLATZHALTER.lastIndex = 0;
  let treffer;
  while ((treffer = PLATZHALTER.exec(String(text))) !== null) raus.push(treffer[1]);
  return raus;
}

/** Jede Zeichenkette in einem Schritt, samt Feldnamen für die Fehlermeldung. */
function texteImSchritt(schritt) {
  const raus = [];
  for (const [feld, wert] of Object.entries(schritt)) {
    if (istText(wert)) raus.push([feld, wert]);
    else if (Array.isArray(wert)) {
      wert.forEach((e, i) => { if (istText(e)) raus.push([`${feld}[${i}]`, e]); });
    }
  }
  return raus;
}

function ankerPruefen(schritt, nr) {
  const kaskade = schritt.selector_cascade;
  if (!Array.isArray(kaskade) || !kaskade.length) {
    return absage("anker_fehlt", `Schritt ${nr} hat keinen Anker, an dem das Element zu finden wäre.`,
      "`selector_cascade` mitgeben, eine nichtleere Liste von Zeichenketten.");
  }
  if (kaskade.length > WERKSTATT_GRENZEN.ankerJeSchritt) {
    return absage("anker_zu_viele", `Schritt ${nr} hat ${kaskade.length} Anker, ich nehme höchstens ${WERKSTATT_GRENZEN.ankerJeSchritt}.`,
      "Die schwächsten Anker weglassen, die Kaskade ist nach Stärke sortiert.");
  }
  for (const anker of kaskade) {
    if (!istText(anker) || !anker.trim()) {
      return absage("anker_ungueltig", `Schritt ${nr} trägt einen Anker, der keiner ist.`,
        "Alle Einträge in `selector_cascade` als nichtleere Zeichenketten mitgeben.");
    }
    if (anker.length > WERKSTATT_GRENZEN.ankerZeichen) {
      return absage("anker_ungueltig", `Ein Anker in Schritt ${nr} ist länger als ${WERKSTATT_GRENZEN.ankerZeichen} Zeichen.`,
        "Kürzer fassen, ein Anker dieser Länge findet beim nächsten Umbau der Seite ohnehin nichts mehr.");
    }
  }
  return { ok: true };
}

/**
 * Einen einzelnen Schritt prüfen.
 *
 * @returns {{ok:true, schritt:object} | {ok:false, code, satz, hinweis}}
 */
function schrittPruefen(roh, nr, params) {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) {
    return absage("schritt_ungueltig", `Schritt ${nr} ist kein Schritt.`,
      "Ein Objekt mit dem Feld `type` mitgeben.");
  }
  const typ = roh.type;
  if (!SCHRITT_TYPEN.includes(typ)) {
    return absage("schritt_unbekannt",
      typ === undefined
        ? `Schritt ${nr} sagt nicht, was er tut.`
        : `Den Schritttyp „${saeubern(typ, 40)}" kenne ich nicht.`,
      `Möglich sind: ${SCHRITT_TYPEN.join(", ")}.`);
  }

  const erlaubt = [...SCHRITT_FELDER_IMMER, ...SCHRITT_FELDER[typ]];
  for (const feld of Object.keys(roh)) {
    if (!erlaubt.includes(feld)) {
      return absage("schritt_feld_unbekannt",
        `Schritt ${nr} (${typ}) trägt das Feld „${saeubern(feld, 40)}", das ich dort nicht kenne.`,
        `Erlaubt sind: ${erlaubt.join(", ")}.`);
    }
  }

  const schritt = { type: typ };
  if (roh.beschreibung !== undefined && roh.beschreibung !== null) {
    if (!istText(roh.beschreibung)) {
      return absage("schritt_ungueltig", `Die Beschreibung von Schritt ${nr} ist kein Text.`, "Eine Zeichenkette mitgeben.");
    }
    schritt.beschreibung = saeubern(roh.beschreibung, WERKSTATT_GRENZEN.beschreibungZeichen);
  }
  if (roh.screenshot !== undefined && roh.screenshot !== null) {
    if (!istText(roh.screenshot) || !/^[a-z0-9_.-]{1,64}$/i.test(roh.screenshot)) {
      return absage("schritt_ungueltig", `Der Bildname in Schritt ${nr} taugt nicht als Dateiname.`,
        "Buchstaben, Ziffern, Punkt, Strich und Unterstrich, höchstens 64 Zeichen.");
    }
    schritt.screenshot = roh.screenshot;
  }

  switch (typ) {
    case "navigate": {
      if (!istText(roh.url) || !roh.url.trim()) {
        return absage("schritt_unvollstaendig", `Schritt ${nr} soll eine Adresse aufrufen und nennt keine.`,
          "`url` mitgeben, eine vollständige Adresse mit https://.");
      }
      /* Die Adresse wird hier NICHT gegen den freigegebenen Bereich gehalten.
         Das ist Absicht: Der Bereich gilt je Sitzung und steht beim Speichern
         eines Ablaufs noch gar nicht fest. Geprüft wird beim Abspielen, in
         `parameterPruefen` und in `bereichBefund`, also an genau der Stelle,
         an der die Sitzung bekannt ist. Hier zu prüfen hiesse, einen Ablauf
         nach dem Aufheben der Freigabe für ungültig zu erklären.

         Das SCHEMA dagegen gehört hierher (Nachtrag 14.08.2026, Verzahnung).
         Es hängt nicht an der Sitzung, und ein Ablauf mit
         `{"type":"navigate","url":"javascript:…"}` ist keine Navigation,
         sondern fremder Code mit einem Sprungbrett. Die Seitenleiste hat das
         am Einlesetor abgefangen; ein Ablauf, der aus dem Rekorder oder aus
         einer anderen Ecke in die Ablage kommt, wäre daran vorbeigelaufen.
         Deshalb steht die Prüfung jetzt in der Positivliste selbst, durch die
         JEDER Ablauf muss. */
      const adresse = roh.url.trim();
      if (adresse.includes("{{")) {
        /* Ein Platzhalter macht die Adresse erst beim Abspielen vollständig.
           Was hier feststehen MUSS, ist das Schema: Ein Platzhalter ganz vorn
           könnte sonst jedes beliebige werden. */
        if (!/^https?:\/\//i.test(adresse)) {
          return absage("adresse_ungueltig",
            `Schritt ${nr} setzt die Adresse aus einem Wert zusammen und fängt nicht mit https:// an.`,
            "Die Adresse muss mit https:// oder http:// beginnen, der Platzhalter steht dahinter.");
        }
      } else if (!adresseZerlegen(adresse)) {
        return absage("adresse_ungueltig",
          `Schritt ${nr} nennt eine Adresse, die ich nicht aufrufe: ${saeubern(adresse, 80)}`,
          "Erlaubt sind ausschliesslich https:// und http://.");
      }
      schritt.url = adresse;
      if (roh.wait !== undefined && roh.wait !== null) {
        if (!WARTE_ARTEN.includes(roh.wait)) {
          return absage("schritt_ungueltig", `Auf „${saeubern(roh.wait, 40)}" kann ich nicht warten.`,
            `Möglich sind: ${WARTE_ARTEN.join(", ")}.`);
        }
        schritt.wait = roh.wait;
      }
      break;
    }

    case "click":
    case "dblclick": {
      const anker = ankerPruefen(roh, nr);
      if (!anker.ok) return anker;
      schritt.selector_cascade = roh.selector_cascade.map((a) => a.trim());
      break;
    }

    case "input": {
      const anker = ankerPruefen(roh, nr);
      if (!anker.ok) return anker;
      if (!istText(roh.value)) {
        return absage("schritt_unvollstaendig", `Schritt ${nr} soll etwas eintippen und nennt nicht was.`,
          "`value` mitgeben, auch der leere Text ist einer.");
      }
      if (roh.value.length > WERKSTATT_GRENZEN.wertZeichen) {
        return absage("schritt_ungueltig", `Der Text in Schritt ${nr} ist länger als ${WERKSTATT_GRENZEN.wertZeichen} Zeichen.`,
          "In mehrere Schritte aufteilen.");
      }
      for (const feld of ["clear", "submit"]) {
        if (roh[feld] !== undefined && roh[feld] !== null) {
          if (typeof roh[feld] !== "boolean") {
            return absage("schritt_ungueltig", `\`${feld}\` in Schritt ${nr} ist ein Ja/Nein-Feld.`, "true oder false mitgeben.");
          }
          schritt[feld] = roh[feld];
        }
      }
      schritt.selector_cascade = roh.selector_cascade.map((a) => a.trim());
      schritt.value = roh.value;
      break;
    }

    case "select": {
      const anker = ankerPruefen(roh, nr);
      if (!anker.ok) return anker;
      /* Genau ein Weg, wie in `parameterPruefen`. Zwei Angaben können auf zwei
         verschiedene Optionen zeigen, und eine davon zu bevorzugen wäre eine
         Wahl, die niemand getroffen hat. */
      const wege = ["value", "label", "index"].filter((f) => roh[f] !== undefined && roh[f] !== null);
      if (wege.length !== 1) {
        return absage("schritt_unvollstaendig",
          wege.length ? `Schritt ${nr} nennt ${wege.length} Wege zur Auswahl (${wege.join(", ")}).` : `Schritt ${nr} sagt nicht, was ausgewählt werden soll.`,
          "Genau eines mitgeben: value, label oder index.");
      }
      if (wege[0] === "index") {
        if (!Number.isInteger(roh.index) || roh.index < 0 || roh.index > 999) {
          return absage("schritt_ungueltig", `Der Index in Schritt ${nr} ist keine Nummer einer Option.`, "Eine ganze Zahl ab 0 mitgeben.");
        }
        schritt.index = roh.index;
      } else {
        if (!istText(roh[wege[0]]) || !roh[wege[0]].trim()) {
          return absage("schritt_ungueltig", `Die Auswahl in Schritt ${nr} war keine brauchbare Angabe.`, "Eine nichtleere Zeichenkette mitgeben.");
        }
        schritt[wege[0]] = roh[wege[0]];
      }
      schritt.selector_cascade = roh.selector_cascade.map((a) => a.trim());
      break;
    }

    case "scroll": {
      if (roh.selector_cascade !== undefined && roh.selector_cascade !== null) {
        const anker = ankerPruefen(roh, nr);
        if (!anker.ok) return anker;
        schritt.selector_cascade = roh.selector_cascade.map((a) => a.trim());
      } else {
        /* Derselbe Befund wie am 29.07.2026 bei `scroll`: Eine fehlende
           Richtung wird nicht stillschweigend „nach unten". Ein Ablauf, der
           in die falsche Richtung rollt und Erfolg meldet, ist schlimmer als
           einer, der abbricht. */
        if (!SCROLL_RICHTUNGEN.has(roh.direction)) {
          return absage("schritt_unvollstaendig", `Schritt ${nr} soll rollen und nennt keine Richtung.`,
            `\`direction\` mitgeben: ${[...SCROLL_RICHTUNGEN].join(", ")} — oder \`selector_cascade\`, um zu einem Element zu rollen.`);
        }
        schritt.direction = roh.direction;
      }
      if (roh.amount !== undefined && roh.amount !== null) {
        const zahl = typeof roh.amount === "number";
        if (zahl && (!Number.isFinite(roh.amount) || roh.amount <= 0 || roh.amount > GRENZEN.scrollPixel)) {
          return absage("schritt_ungueltig", `Die Schrittweite in Schritt ${nr} ergibt keinen Bildlauf.`,
            `Eine Pixelzahl zwischen 1 und ${GRENZEN.scrollPixel} — oder ${[...SCROLL_MENGEN].join(", ")}.`);
        }
        if (!zahl && !SCROLL_MENGEN.has(roh.amount)) {
          return absage("schritt_ungueltig", `Die Schrittweite in Schritt ${nr} kenne ich nicht.`,
            `Möglich sind: ${[...SCROLL_MENGEN].join(", ")} oder eine Pixelzahl.`);
        }
        schritt.amount = zahl ? Math.round(roh.amount) : roh.amount;
      }
      break;
    }

    case "key": {
      if (!TASTEN.includes(roh.key)) {
        return absage("schritt_ungueltig",
          roh.key === undefined ? `Schritt ${nr} nennt keine Taste.` : `Die Taste „${saeubern(roh.key, 40)}" zeichne ich nicht auf.`,
          `Möglich sind: ${TASTEN.join(", ")}.`);
      }
      schritt.key = roh.key;
      break;
    }

    case "wait": {
      const hatMs = roh.ms !== undefined && roh.ms !== null;
      const hatBis = roh.until !== undefined && roh.until !== null;
      if (!hatMs && !hatBis) {
        return absage("schritt_unvollstaendig", `Schritt ${nr} soll warten und sagt nicht worauf.`,
          `\`ms\` mitgeben oder \`until\`: ${WARTE_ARTEN.join(", ")}.`);
      }
      if (hatMs) {
        if (!Number.isFinite(roh.ms) || roh.ms <= 0 || roh.ms > WERKSTATT_GRENZEN.wartenMsHoechstens) {
          return absage("schritt_ungueltig", `Die Wartezeit in Schritt ${nr} liegt ausserhalb dessen, was ich warte.`,
            `Zwischen 1 und ${WERKSTATT_GRENZEN.wartenMsHoechstens} Millisekunden.`);
        }
        schritt.ms = Math.round(roh.ms);
      }
      if (hatBis) {
        if (!WARTE_ARTEN.includes(roh.until)) {
          return absage("schritt_ungueltig", `Auf „${saeubern(roh.until, 40)}" kann ich nicht warten.`,
            `Möglich sind: ${WARTE_ARTEN.join(", ")}.`);
        }
        schritt.until = roh.until;
      }
      break;
    }

    case "user_input_required": {
      /* Der Schritt, der aus §7.2 kommt: Hier hat der Rekorder ein Geheimfeld
         gesehen und ABSICHTLICH nichts aufgezeichnet. Die Begründung ist
         Pflicht, weil sie das Einzige ist, was der Mensch beim Abspielen zu
         sehen bekommt: Er muss wissen, warum der Ablauf stehen bleibt. */
      if (!istText(roh.reason) || !roh.reason.trim()) {
        return absage("schritt_unvollstaendig", `Schritt ${nr} hält an und sagt nicht warum.`,
          "`reason` mitgeben, zum Beispiel \"Login/2FA\".");
      }
      schritt.reason = saeubern(roh.reason, WERKSTATT_GRENZEN.beschreibungZeichen);
      break;
    }

    default:
      /* Nicht erreichbar: Die Positivliste steht oben. Die Zeile bleibt, damit
         ein neuer Typ ohne Zweig nicht als leerer Schritt durchgeht. */
      return absage("schritt_unbekannt", `Für den Schritttyp „${saeubern(typ, 40)}" fehlt die Prüfung.`,
        `Möglich sind: ${SCHRITT_TYPEN.join(", ")}.`);
  }

  /* Zuletzt die Platzhalter: Jeder muss in `params` erklärt sein. Ein
     `{{artikelnr}}`, das der Ablauf nirgends erklärt, wird beim Abspielen
     entweder wörtlich eingetippt oder mit einem fremden Wert gefüllt. Beides
     ist ein Ablauf, der etwas anderes tut, als er zeigt. */
  for (const [feld, text] of texteImSchritt(schritt)) {
    for (const name of platzhalterFinden(text)) {
      if (!PARAM_NAME_MUSTER.test(name)) {
        return absage("platzhalter_ungueltig", `In Schritt ${nr} steht ein Platzhalter, dessen Name keiner ist.`,
          "Namen aus Buchstaben, Ziffern und Unterstrich, zum Beispiel {{artikelnummer}}.");
      }
      if (!params.includes(name)) {
        return absage("platzhalter_unbekannt",
          `Schritt ${nr} setzt „${name}" ein, im Feld ${feld}, und dieser Wert steht nicht in der Liste params.`,
          "Den Namen in `params` des Ablaufs aufnehmen oder den Platzhalter entfernen.");
      }
    }
  }

  return { ok: true, schritt };
}

/**
 * Einen ganzen Ablauf prüfen.
 *
 * @returns {{ok:true, workflow:object} | {ok:false, code:string, satz:string, hinweis:string}}
 */
export function workflowPruefen(roh) {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) {
    return absage("workflow_ungueltig", "Das ist kein Ablauf.",
      "Ein Objekt mit `id`, `name` und `steps` mitgeben.");
  }
  for (const feld of Object.keys(roh)) {
    if (!WORKFLOW_FELDER.includes(feld)) {
      return absage("feld_unbekannt", `Das Feld „${saeubern(feld, 40)}" kenne ich in einem Ablauf nicht.`,
        `Erlaubt sind: ${WORKFLOW_FELDER.join(", ")}.`);
    }
  }

  const id = istText(roh.id) ? roh.id.trim() : "";
  if (!WORKFLOW_ID_MUSTER.test(id)) {
    return absage("id_ungueltig",
      roh.id === undefined ? "Dem Ablauf fehlt die Kennung." : "Diese Kennung hat nicht die Form, die eine Ablaufkennung hat.",
      "`id` wie `wf_ebay_relist`: `wf_`, dann Kleinbuchstaben, Ziffern oder Unterstriche.");
  }

  const name = istText(roh.name) ? saeubern(roh.name, WERKSTATT_GRENZEN.namenZeichen) : "";
  if (!name) {
    return absage("name_fehlt", "Dem Ablauf fehlt der Name.",
      "`name` mitgeben. Er ist das, was der Mensch in der Rückfrage zu hören bekommt.");
  }

  if (roh.version !== undefined && roh.version !== null && roh.version !== WORKFLOW_VERSION) {
    return absage("version_ungueltig", "Dieser Ablauf trägt eine Fassung, die ich nicht kenne.",
      `Zurzeit gilt version ${WORKFLOW_VERSION}.`);
  }

  const params = [];
  if (roh.params !== undefined && roh.params !== null) {
    if (!Array.isArray(roh.params)) {
      return absage("params_ungueltig", "`params` war keine Liste von Namen.",
        "Eine Liste mitgeben, zum Beispiel [\"artikelnummer\"].");
    }
    if (roh.params.length > GRENZEN.workflowParams) {
      return absage("params_ungueltig", `Der Ablauf will ${roh.params.length} Werte, ich nehme höchstens ${GRENZEN.workflowParams}.`,
        `Höchstens ${GRENZEN.workflowParams} Platzhalter je Ablauf.`);
    }
    for (const name2 of roh.params) {
      if (!istText(name2) || !PARAM_NAME_MUSTER.test(name2)) {
        return absage("params_ungueltig", `„${saeubern(name2, 40)}" ist kein Name für einen Wert.`,
          "Namen aus Buchstaben, Ziffern und Unterstrich, höchstens 40 Zeichen.");
      }
      if (!params.includes(name2)) params.push(name2);
    }
  }

  if (!Array.isArray(roh.steps) || !roh.steps.length) {
    return absage("schritte_fehlen", "Der Ablauf hat keine Schritte.",
      "Mindestens einen Schritt mitgeben, sonst ist es kein Ablauf.");
  }
  if (roh.steps.length > WERKSTATT_GRENZEN.schritteHoechstens) {
    return absage("zu_viele_schritte",
      `Der Ablauf hat ${roh.steps.length} Schritte, mehr als ${WERKSTATT_GRENZEN.schritteHoechstens} spiele ich nicht ab.`,
      "In mehrere Abläufe aufteilen.");
  }

  const steps = [];
  for (let i = 0; i < roh.steps.length; i++) {
    const geprueft = schrittPruefen(roh.steps[i], i + 1, params);
    if (!geprueft.ok) return geprueft;
    steps.push(geprueft.schritt);
  }

  const workflow = {
    id,
    name,
    beschreibung: istText(roh.beschreibung) ? saeubern(roh.beschreibung, WERKSTATT_GRENZEN.beschreibungZeichen) : "",
    version: WORKFLOW_VERSION,
    created: istText(roh.created) && roh.created.trim() ? saeubern(roh.created, 40) : "",
    params,
    steps,
  };
  return { ok: true, workflow };
}

/* --------------------------------------------------------------------- *
 * Platzhalter einsetzen
 * --------------------------------------------------------------------- */

/**
 * Die Werte in einen Ablauf einsetzen.
 *
 * @returns {{ok:true, workflow:object} | {ok:false, code:string, satz:string, hinweis:string}}
 *
 * **Genau ein Durchgang, und zwar baulich.** Ersetzt wird über `String.replace`
 * mit einer Funktion; die ersetzt an jeder Fundstelle des Musters im
 * URSPRÜNGLICHEN Text und sieht das Eingesetzte nie wieder an. Der Wert
 * `{{gutschein}}` bleibt deshalb der Text `{{gutschein}}` und wird nicht zu
 * dessen Inhalt.
 *
 * Das ist kein Schönheitsfehler, den man auch anders lösen könnte: Ein zweiter
 * Durchgang wäre eine Auswertung von Werten, die aus dem Rahmen des Agenten
 * stammen — also genau die Hintertür, die `eval` wäre, nur in klein. Wer einen
 * Wert setzen darf, dürfte damit jeden anderen Wert lesen.
 */
export function platzhalterFuellen(wf, params) {
  const geprueft = workflowPruefen(wf);
  if (!geprueft.ok) return geprueft;
  const workflow = geprueft.workflow;

  const werte = paramsPruefen(params);
  if (!werte.ok) return absage("params_ungueltig", werte.satz, werte.hinweis);

  /* Ein Wert, den der Ablauf gar nicht kennt, wird nicht stillschweigend
     weggeworfen. Er ist der sichtbare Teil eines Missverständnisses: Entweder
     hat der Agent den falschen Ablauf gemeint, oder der Ablauf hat sich
     geändert. Beides will man hören, bevor zwanzig Schritte laufen. */
  for (const name of Object.keys(werte.params)) {
    if (!workflow.params.includes(name)) {
      return absage("params_unbekannt", `Der Ablauf „${workflow.name}" kennt keinen Wert namens „${name}".`,
        workflow.params.length
          ? `Er erwartet: ${workflow.params.join(", ")}.`
          : "Er erwartet gar keine Werte.");
    }
  }
  for (const name of workflow.params) {
    if (!Object.prototype.hasOwnProperty.call(werte.params, name)) {
      return absage("platzhalter_fehlt", `Für „${name}" fehlt der Wert.`,
        `Der Ablauf „${workflow.name}" braucht: ${workflow.params.join(", ")}.`);
    }
  }

  let fehlt = null;
  const einsetzen = (text) =>
    String(text).replace(PLATZHALTER, (ganz, name) => {
      if (Object.prototype.hasOwnProperty.call(werte.params, name)) return werte.params[name];
      /* Nicht erreichbar, solange `workflowPruefen` davorsteht — aber diese
         Funktion ist öffentlich, und eine öffentliche Funktion, die im
         Zweifelsfall den Platzhalter wörtlich stehen lässt, tippt ihn
         irgendwann in ein Formular. */
      if (!fehlt) fehlt = name;
      return ganz;
    });

  const steps = workflow.steps.map((schritt) => {
    const neu = { ...schritt };
    for (const [feld, wert] of Object.entries(schritt)) {
      if (istText(wert)) neu[feld] = einsetzen(wert);
      else if (Array.isArray(wert)) neu[feld] = wert.map((e) => (istText(e) ? einsetzen(e) : e));
    }
    return neu;
  });

  if (fehlt) {
    return absage("platzhalter_unbekannt", `Der Platzhalter „${saeubern(fehlt, 40)}" ist in diesem Ablauf nirgends erklärt.`,
      "Den Namen in `params` des Ablaufs aufnehmen oder den Platzhalter entfernen.");
  }

  return { ok: true, workflow: { ...workflow, steps } };
}

/* --------------------------------------------------------------------- *
 * Ablage
 * --------------------------------------------------------------------- */

/**
 * Alle gespeicherten Abläufe.
 *
 * Wirft nie. Ein Eintrag, der die Prüfung nicht besteht, kommt nicht mit: Er
 * liesse sich ohnehin nicht abspielen, und ihn mitzuführen hiesse, ihn in der
 * Werkbank anzubieten. Über `workflowSchreiben` kann so ein Eintrag gar nicht
 * erst entstehen; er kann nur aus einem von Hand veränderten Speicher kommen.
 *
 * @returns {Promise<Array<object>>}
 */
export async function workflowsLesen() {
  let roh = null;
  try {
    const daten = await chrome.storage.local.get(WERKSTATT_ABLAGE);
    roh = daten && daten[WERKSTATT_ABLAGE];
  } catch (_) {
    return [];
  }
  if (!Array.isArray(roh)) return [];
  const raus = [];
  for (const eintrag of roh.slice(0, WERKSTATT_GRENZEN.ablaeufeHoechstens)) {
    const geprueft = workflowPruefen(eintrag);
    if (geprueft.ok) raus.push(geprueft.workflow);
  }
  return raus;
}

/**
 * Einen Ablauf holen.
 *
 * @returns {{ok:true, workflow:object} | {ok:false, code:"workflow_not_found", satz:string, hinweis:string}}
 *
 * Der Fehlercode ist der aus §10 und geht damit unverändert an den Agenten
 * weiter. Er soll hören, dass es diesen Ablauf nicht gibt, und nicht, dass
 * irgendetwas schiefging.
 */
export async function workflowHolen(id) {
  const alle = await workflowsLesen();
  const treffer = alle.find((w) => w.id === id);
  if (!treffer) {
    return absage("workflow_not_found", `Einen Ablauf mit der Kennung ${saeubern(id, 60)} habe ich nicht gespeichert.`,
      alle.length ? `Gespeichert sind: ${alle.map((w) => w.id).slice(0, 10).join(", ")}.` : "Es ist noch kein Ablauf gespeichert.");
  }
  return { ok: true, workflow: treffer };
}

/**
 * Einen Ablauf speichern oder ersetzen.
 *
 * @returns {{ok:true, workflow:object} | {ok:false, code, satz, hinweis}}
 */
export async function workflowSchreiben(wf) {
  const geprueft = workflowPruefen(wf);
  if (!geprueft.ok) return geprueft;
  const workflow = geprueft.workflow;
  /* Der Zeitstempel entsteht beim Speichern und nicht beim Prüfen: Prüfen soll
     zweimal dasselbe Ergebnis liefern, auch eine Sekunde später. */
  if (!workflow.created) workflow.created = new Date().toISOString();

  const alle = await workflowsLesen();
  const stelle = alle.findIndex((w) => w.id === workflow.id);
  if (stelle >= 0) alle[stelle] = workflow;
  else alle.push(workflow);

  if (alle.length > WERKSTATT_GRENZEN.ablaeufeHoechstens) {
    return absage("zu_viele_ablaeufe",
      `Mehr als ${WERKSTATT_GRENZEN.ablaeufeHoechstens} Abläufe verwalte ich nicht.`,
      "Einen nicht mehr gebrauchten Ablauf löschen.");
  }

  try {
    await chrome.storage.local.set({ [WERKSTATT_ABLAGE]: alle });
  } catch (_) {
    return absage("ablage_fehler", "Der Ablauf liess sich nicht speichern.",
      "Noch einmal versuchen. Bleibt es dabei, ist der Speicher des Browsers voll.");
  }
  return { ok: true, workflow };
}

/**
 * Einen Ablauf löschen.
 *
 * @returns {{ok:true, id:string} | {ok:false, code, satz, hinweis}}
 */
export async function workflowLoeschen(id) {
  const alle = await workflowsLesen();
  const bleibt = alle.filter((w) => w.id !== id);
  if (bleibt.length === alle.length) {
    return absage("workflow_not_found", `Einen Ablauf mit der Kennung ${saeubern(id, 60)} habe ich nicht gespeichert.`,
      "Nichts zu tun.");
  }
  try {
    await chrome.storage.local.set({ [WERKSTATT_ABLAGE]: bleibt });
  } catch (_) {
    return absage("ablage_fehler", "Der Ablauf liess sich nicht löschen.",
      "Noch einmal versuchen.");
  }
  return { ok: true, id };
}
