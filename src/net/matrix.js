/*
 * SMarTrChrome — die Domainregeln und die Agentenmatrix (Vertrag v3.5 §4).
 *
 * Was hier liegt, ist die Antwort auf zwei Fragen, die vorher niemand stellen
 * konnte:
 *
 *   1. Was darf auf DIESER Seite ohne Rückfrage laufen?
 *   2. Was darf DIESER Agent auf dieser Seite überhaupt?
 *
 * Beides steht in `chrome.storage.local`, unter `sa_matrix`, und zwar
 * ausdrücklich nicht in `session`: Eine Einstellungsmatrix, die bei jedem
 * Browserstart leer ist, ist keine Einstellung, sondern eine Frage, die man
 * jeden Morgen neu beantwortet. Ausweise und Tokens liegen weiterhin
 * ausschliesslich in `session` (net/konto.js) und haben hier nichts verloren.
 *
 * Der Grundsatz, aus dem sich jede Zeile dieser Datei ergibt:
 *
 *   **Voreinstellung ist alles aus.** `agentDarf` gibt für einen unbekannten
 *   Agenten, einen unbekannten Host oder eine unbekannte Klasse `false`
 *   zurück. Eine Matrix, die im Zweifel erlaubt, ist keine.
 *
 * Und die zweite Zusage, die aus dem ersten folgt und die ein Prüfsatz misst:
 * **Ein gesperrter Host wird durch KEINE Eintragung wieder frei.** Wer
 * `*.sparkasse.de` sperrt und danach demselben Host etwas freischaltet, hat
 * die Sperre nicht aufgehoben, er hat sich widersprochen — und im Widerspruch
 * gilt die Sperre.
 *
 * Warum Lesen und Schreiben verschieden streng sind:
 *
 *   `matrixSchreiben` ist ganz oder gar nicht. Was ein Mensch einträgt, wird
 *   vollständig geprüft und im Fehlerfall benannt abgelehnt; still die Hälfte
 *   zu speichern hiesse, ihn glauben zu lassen, er habe etwas eingerichtet.
 *
 *   `matrixLesen` rettet dagegen, was zu retten ist, und zwar in genau einer
 *   Richtung: Eine unbrauchbare ERLAUBNIS fällt weg, eine unbrauchbare SPERRE
 *   fällt nicht auf, sondern bleibt, soweit ihre Einträge lesbar sind. Ein
 *   beschädigter Speicher darf niemals mehr erlauben als ein leerer.
 */

import { KLASSEN, WEICH, eintragZerlegen, saeubern } from "./befehle.js";

/* Der Ablageschlüssel (§4). Er steht genau einmal im ganzen Bestand. */
export const MATRIX_ABLAGE = "sa_matrix";
export const MATRIX_VERSION = 1;

/*
 * Die Positivliste der Agenten (§8.1).
 *
 * Was nicht darin steht, ist kein Agent. Der Name kommt vom Relay und damit
 * aus einer Quelle, die wir nicht selbst schreiben; er wird deshalb genauso
 * behandelt wie jeder andere Fremdtext: gemessen, nicht geglaubt.
 *
 * `SMarTrBrowser` steht seit dem 15.08.2026 darauf: Das Gateway signiert ab
 * diesem Tag den Anspruch `agent="SMarTrBrowser"` im Bridge-Token (Profil
 * smartr-browser, DRAHTFORMAT §13.4), und der Relay trägt ihn in jeden
 * Befehlsrahmen. Ohne diesen Eintrag stürbe damit JEDER Cloud-Befehl an
 * `agent_not_permitted`. Sonderrechte hat der Name nicht: Die Agentenmatrix
 * gilt für ihn wie für jeden anderen, und ab Werk ist sie leer.
 */
export const AGENTEN = Object.freeze([
  "SMarTrCEO", "SMarTrItgott", "SMarTrMarketing", "SMarTrContent",
  "SMarTrHRGott", "SMarTrTrader", "SMarTrInfluencer", "SMarTrSocialMedia",
  "SMarTrPenTester", "SMarTrBrowser",
]);

/*
 * Was einem Agenten je Host zugestanden werden kann.
 *
 * Die Aktionsklassen aus §3 plus `workflow`, weil ein gespeicherter Ablauf
 * keine Aktionsklasse ist, sondern eine eigene Befugnis: Ein Agent, der lesen
 * und bedienen darf, darf damit noch lange nicht eine aufgezeichnete Kette von
 * zwanzig Schritten anstossen. Der Vertrag zeigt diese Befugnis in seinem
 * Beispiel (§4), also steht sie hier ausdrücklich in der Liste und nicht
 * beiläufig daneben.
 */
export const AGENT_KLASSEN = Object.freeze([...KLASSEN, "workflow"]);

/* Wie viele Einträge eine Matrix höchstens trägt. Nicht aus Sorge um den
   Speicher, sondern weil eine Liste, die niemand mehr überblickt, keine
   Einstellung mehr ist, sondern ein Zustand. */
const HOECHSTENS_GESPERRT = 200;
const HOECHSTENS_DOMAINS = 500;
const HOECHSTENS_HOSTS_JE_AGENT = 200;

/** Die leere Matrix. Vollständig, damit kein Aufrufer auf `undefined` trifft. */
function leereMatrix() {
  return { version: MATRIX_VERSION, domains: {}, gesperrt: [], agenten: {} };
}

/**
 * Der Host, nach dem gefragt wird: klein, ohne Wurzelpunkt, ohne Platzhalter.
 *
 * Gemessen wird mit `eintragZerlegen` aus befehle.js und nicht mit eigener
 * Zeichenkettenarbeit. Das ist dieselbe Begründung wie dort: Zwei Stellen, die
 * Adressen verschieden lesen, sind der Ursprung fast jeder Herunterstufung.
 *
 * Eine ganze Adresse ist als Frage erlaubt und wird auf ihren Wirt
 * zurückgeführt (`https://ebay.de/kasse` → `ebay.de`). Der Grund ist nicht
 * Bequemlichkeit, sondern die Fehlerrichtung: Wer hier eine Adresse hereingibt
 * und ein "" zurückbekäme, sähe jede Seite als gesperrt, und eine Sperre, die
 * aus einem Formatfehler entsteht, sucht niemand an der richtigen Stelle.
 *
 * Ein PLATZHALTER ist als Frage nie erlaubt. `*.bank.de` ist kein Ort, an dem
 * ein Tab stehen kann, sondern eine Regel, und eine Regel gegen eine Regel zu
 * halten hiesse, die Sperrliste sich selbst beantworten zu lassen.
 *
 * @returns {string} der Name oder "" für „nicht vergleichbar"
 */
function hostRein(roh) {
  if (typeof roh !== "string") return "";
  const e = eintragZerlegen(roh);
  if (!e || e.platzhalter) return "";
  return e.host;
}

/**
 * Ein Muster, wie es in `gesperrt` oder als Domainschlüssel stehen darf:
 * `bank.de` oder `*.bank.de`, sonst nichts.
 *
 * `*` allein und `*.de` fallen bereits in `eintragZerlegen` heraus — das eine
 * wäre das halbe Netz, das andere eine ganze Länderendung. Ein Port oder ein
 * Schema im Muster wird hier abgelehnt statt stillschweigend ignoriert: Wer
 * `https://bank.de:8443` sperren will, meint etwas Genaueres, als diese Matrix
 * ausdrücken kann, und soll das hören.
 *
 * @returns {{host:string, platzhalter:boolean}|null}
 */
function musterZerlegen(roh) {
  if (typeof roh !== "string") return null;
  /* Ein Pfad im Muster wird NICHT stillschweigend abgeschnitten, sondern
     abgelehnt. `eintragZerlegen` schneidet ihn weg, weil ein Pfad über den
     Wirt nichts sagt — hier wäre genau das die Gefahr: Wer `ebay.de/verkaufen`
     freischaltet, meint eine Ecke seiner Seite und bekäme die ganze. Eine
     Erlaubnis, die breiter ausfällt als das, was der Mensch getippt hat, ist
     die eine Sorte Fehler, die diese Datei nicht machen darf. */
  if (roh.includes("/")) return null;
  const e = eintragZerlegen(roh);
  if (!e || e.port || e.schema) return null;
  return { host: e.host, platzhalter: e.platzhalter };
}

function hatPunycode(host) {
  return String(host || "").split(".").some((m) => m.startsWith("xn--"));
}

/**
 * Passt dieser Host auf dieses Muster?
 *
 * Der Platzhalter `*.` gilt ausschliesslich ganz vorn und nie als
 * alleinstehendes `*`. Unter einem Platzhalter kein Punycode: Der Name
 * `xn--bnk-bld.example.de` ist formal eine Unterseite von `example.de`, liest
 * sich im Klartext aber wie ein ganz anderer Name. Wer ihn wirklich meint,
 * schreibt ihn hin. Dieselbe Regel gilt in `bereichBefund` (befehle.js), und
 * sie muss dieselbe bleiben: Zwei Wahrheiten über denselben Namen sind eine zu
 * viel.
 */
export function hostMuster(muster, host) {
  const m = musterZerlegen(muster);
  const z = hostRein(host);
  if (!m || !z) return false;
  if (!m.platzhalter) return z === m.host;
  if (hatPunycode(z) && !hatPunycode(m.host)) return false;
  return z === m.host || z.endsWith(`.${m.host}`);
}

/* --------------------------------------------------------------------- *
 * Prüfen und Säubern
 * --------------------------------------------------------------------- */

/* Die Felder, die es überhaupt gibt. Ein unbekanntes Feld ist kein Zusatz,
   sondern ein Missverständnis über die Form — und ein Missverständnis, das
   still gespeichert wird, fällt erst auf, wenn es etwas nicht sperrt. */
const MATRIX_FELDER = Object.freeze(["version", "domains", "gesperrt", "agenten"]);
const DOMAIN_FELDER = Object.freeze(["frei"]);

function absage(code, satz, hinweis) {
  return { ok: false, code, satz, hinweis };
}

/**
 * Die strenge Prüfung für das Schreiben.
 *
 * @returns {{ok:true, matrix:object} | {ok:false, code:string, satz:string, hinweis:string}}
 */
export function matrixPruefen(roh) {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) {
    return absage("matrix_ungueltig", "Das ist keine Einstellungsmatrix.",
      "Ein Objekt mit den Feldern version, domains, gesperrt und agenten mitgeben.");
  }
  for (const feld of Object.keys(roh)) {
    if (!MATRIX_FELDER.includes(feld)) {
      return absage("feld_unbekannt", `Das Feld „${saeubern(feld, 40)}" kenne ich in der Matrix nicht.`,
        `Erlaubt sind: ${MATRIX_FELDER.join(", ")}.`);
    }
  }

  const matrix = leereMatrix();

  if (roh.version !== undefined && roh.version !== null && roh.version !== MATRIX_VERSION) {
    return absage("version_ungueltig", "Diese Matrix trägt eine Fassung, die ich nicht kenne.",
      `Zurzeit gilt version ${MATRIX_VERSION}.`);
  }

  /* gesperrt */
  if (roh.gesperrt !== undefined && roh.gesperrt !== null) {
    if (!Array.isArray(roh.gesperrt)) {
      return absage("gesperrt_ungueltig", "`gesperrt` war keine Liste.",
        "Eine Liste von Hosts mitgeben, zum Beispiel [\"*.sparkasse.de\"].");
    }
    if (roh.gesperrt.length > HOECHSTENS_GESPERRT) {
      return absage("zu_viele", `Die Sperrliste hat ${roh.gesperrt.length} Einträge, ich nehme höchstens ${HOECHSTENS_GESPERRT}.`,
        "Einträge zusammenfassen, zum Beispiel über `*.name.de`.");
    }
    for (const eintrag of roh.gesperrt) {
      if (!musterZerlegen(eintrag)) {
        return absage("host_ungueltig", `„${saeubern(eintrag, 60)}" ist keine Hostangabe, die ich sperren kann.`,
          "Erlaubt sind `bank.de` und `*.bank.de`, ohne Schema und ohne Port.");
      }
      const sauber = String(eintrag).trim().toLowerCase();
      if (!matrix.gesperrt.includes(sauber)) matrix.gesperrt.push(sauber);
    }
  }

  /* domains */
  if (roh.domains !== undefined && roh.domains !== null) {
    if (typeof roh.domains !== "object" || Array.isArray(roh.domains)) {
      return absage("domains_ungueltig", "`domains` war kein Satz von Hosts.",
        "Ein Objekt mitgeben, zum Beispiel {\"ebay.de\": {\"frei\": [\"senden\"]}}.");
    }
    const namen = Object.keys(roh.domains);
    if (namen.length > HOECHSTENS_DOMAINS) {
      return absage("zu_viele", `Die Domainliste hat ${namen.length} Einträge, ich nehme höchstens ${HOECHSTENS_DOMAINS}.`,
        "Nicht mehr gebrauchte Hosts entfernen.");
    }
    for (const name of namen) {
      const m = musterZerlegen(name);
      if (!m) {
        return absage("host_ungueltig", `„${saeubern(name, 60)}" ist keine Hostangabe.`,
          "Erlaubt sind `ebay.de` und `*.ebay.de`, ohne Schema und ohne Port.");
      }
      const wert = roh.domains[name];
      if (!wert || typeof wert !== "object" || Array.isArray(wert)) {
        return absage("domain_ungueltig", `Der Eintrag zu „${saeubern(name, 60)}" hat nicht die Form eines Eintrags.`,
          "Ein Objekt mit dem Feld `frei` mitgeben.");
      }
      for (const feld of Object.keys(wert)) {
        if (!DOMAIN_FELDER.includes(feld)) {
          return absage("feld_unbekannt", `Das Feld „${saeubern(feld, 40)}" kenne ich in einem Domaineintrag nicht.`,
            `Erlaubt ist: ${DOMAIN_FELDER.join(", ")}.`);
        }
      }
      const frei = [];
      if (wert.frei !== undefined && wert.frei !== null) {
        if (!Array.isArray(wert.frei)) {
          return absage("frei_ungueltig", `\`frei\` bei „${saeubern(name, 60)}" war keine Liste.`,
            `Eine Liste weicher Klassen mitgeben: ${[...WEICH].join(", ")}.`);
        }
        for (const klasse of wert.frei) {
          /* Eine harte Klasse hier anzunehmen und später wegzufiltern wäre die
             gefährlichste Art von Nachsicht: Der Mensch sähe „Zahlung
             freigeschaltet" in seiner eigenen Einstellung stehen und glaubte
             es. Harte Klassen sind nicht abschaltbar, und das muss er hören. */
          if (!WEICH.has(klasse)) {
            return absage("klasse_ungueltig", `„${saeubern(klasse, 40)}" lässt sich nicht je Domain freischalten.`,
              `Freischaltbar sind nur die weichen Klassen: ${[...WEICH].join(", ")}.`);
          }
          if (!frei.includes(klasse)) frei.push(klasse);
        }
      }
      matrix.domains[String(name).trim().toLowerCase()] = { frei };
    }
  }

  /* agenten */
  if (roh.agenten !== undefined && roh.agenten !== null) {
    if (typeof roh.agenten !== "object" || Array.isArray(roh.agenten)) {
      return absage("agenten_ungueltig", "`agenten` war kein Satz von Agenten.",
        "Ein Objekt mitgeben, zum Beispiel {\"SMarTrTrader\": {\"tradingview.com\": [\"lesen\"]}}.");
    }
    for (const agent of Object.keys(roh.agenten)) {
      if (!AGENTEN.includes(agent)) {
        return absage("agent_unbekannt", `„${saeubern(agent, 40)}" steht nicht auf der Liste der Agenten.`,
          `Möglich sind: ${AGENTEN.join(", ")}.`);
      }
      const hosts = roh.agenten[agent];
      if (!hosts || typeof hosts !== "object" || Array.isArray(hosts)) {
        return absage("agent_ungueltig", `Der Eintrag zu „${agent}" hat nicht die Form eines Eintrags.`,
          "Ein Objekt Host zu Klassenliste mitgeben.");
      }
      const namen = Object.keys(hosts);
      if (namen.length > HOECHSTENS_HOSTS_JE_AGENT) {
        return absage("zu_viele", `„${agent}" hat ${namen.length} Hosts, ich nehme höchstens ${HOECHSTENS_HOSTS_JE_AGENT}.`,
          "Nicht mehr gebrauchte Hosts entfernen.");
      }
      const je = {};
      for (const name of namen) {
        if (!musterZerlegen(name)) {
          return absage("host_ungueltig", `„${saeubern(name, 60)}" ist keine Hostangabe.`,
            "Erlaubt sind `ebay.de` und `*.ebay.de`, ohne Schema und ohne Port.");
        }
        const liste = hosts[name];
        if (!Array.isArray(liste)) {
          return absage("klassen_ungueltig", `Die Angabe zu „${saeubern(name, 60)}" war keine Liste.`,
            `Eine Liste mitgeben: ${AGENT_KLASSEN.join(", ")}.`);
        }
        const rein = [];
        for (const klasse of liste) {
          if (!AGENT_KLASSEN.includes(klasse)) {
            return absage("klasse_ungueltig", `„${saeubern(klasse, 40)}" ist keine Befugnis, die ich kenne.`,
              `Möglich sind: ${AGENT_KLASSEN.join(", ")}.`);
          }
          if (!rein.includes(klasse)) rein.push(klasse);
        }
        je[String(name).trim().toLowerCase()] = rein;
      }
      matrix.agenten[agent] = je;
    }
  }

  return { ok: true, matrix };
}

/**
 * Die nachsichtige Fassung für das Lesen: Was lesbar ist, bleibt, der Rest
 * fällt weg — und zwar nur in Richtung „weniger Erlaubnis".
 *
 * Sie ist ausdrücklich NICHT dasselbe wie `matrixPruefen`. Ein beschädigter
 * Speicher soll nicht die ganze Matrix wegwerfen, denn dabei gingen auch die
 * Sperren verloren, und ein Ausfall, der Sperren aufhebt, ist der schlechteste
 * denkbare Ausfall.
 */
function matrixSaeubern(roh) {
  const matrix = leereMatrix();
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return matrix;

  if (Array.isArray(roh.gesperrt)) {
    for (const eintrag of roh.gesperrt.slice(0, HOECHSTENS_GESPERRT)) {
      if (!musterZerlegen(eintrag)) continue;
      const sauber = String(eintrag).trim().toLowerCase();
      if (!matrix.gesperrt.includes(sauber)) matrix.gesperrt.push(sauber);
    }
  }

  if (roh.domains && typeof roh.domains === "object" && !Array.isArray(roh.domains)) {
    for (const name of Object.keys(roh.domains).slice(0, HOECHSTENS_DOMAINS)) {
      if (!musterZerlegen(name)) continue;
      const wert = roh.domains[name];
      if (!wert || typeof wert !== "object" || Array.isArray(wert)) continue;
      const frei = (Array.isArray(wert.frei) ? wert.frei : []).filter((k) => WEICH.has(k));
      matrix.domains[String(name).trim().toLowerCase()] = { frei: [...new Set(frei)] };
    }
  }

  if (roh.agenten && typeof roh.agenten === "object" && !Array.isArray(roh.agenten)) {
    for (const agent of Object.keys(roh.agenten)) {
      if (!AGENTEN.includes(agent)) continue;
      const hosts = roh.agenten[agent];
      if (!hosts || typeof hosts !== "object" || Array.isArray(hosts)) continue;
      const je = {};
      for (const name of Object.keys(hosts).slice(0, HOECHSTENS_HOSTS_JE_AGENT)) {
        if (!musterZerlegen(name)) continue;
        const liste = Array.isArray(hosts[name]) ? hosts[name] : [];
        je[String(name).trim().toLowerCase()] = [...new Set(liste.filter((k) => AGENT_KLASSEN.includes(k)))];
      }
      matrix.agenten[agent] = je;
    }
  }

  return matrix;
}

/* --------------------------------------------------------------------- *
 * Ablage
 * --------------------------------------------------------------------- */

/**
 * Die ganze Matrix, immer vollständig.
 *
 * Wirft nie. Ohne Ablage gibt es die leere Matrix, und die leere Matrix
 * erlaubt nichts — das ist die richtige Antwort auf „ich weiss es nicht".
 */
export async function matrixLesen() {
  try {
    const daten = await chrome.storage.local.get(MATRIX_ABLAGE);
    return matrixSaeubern(daten && daten[MATRIX_ABLAGE]);
  } catch (_) {
    return leereMatrix();
  }
}

/**
 * Die ganze Matrix ersetzen.
 *
 * @returns {{ok:true, matrix:object} | {ok:false, code:string, satz:string, hinweis:string}}
 *
 * Wirft nie, auch nicht, wenn die Ablage selbst versagt: Der Aufrufer ist die
 * Seitenleiste, und ein Mensch, der auf „Speichern" drückt, bekommt einen
 * Satz zu hören, keine rote Zeile in einer Entwicklerkonsole.
 */
export async function matrixSchreiben(neu) {
  const geprueft = matrixPruefen(neu);
  if (!geprueft.ok) return geprueft;
  try {
    await chrome.storage.local.set({ [MATRIX_ABLAGE]: geprueft.matrix });
  } catch (_) {
    return absage("ablage_fehler", "Die Einstellung liess sich nicht speichern.",
      "Noch einmal versuchen. Bleibt es dabei, ist der Speicher des Browsers voll.");
  }
  return { ok: true, matrix: geprueft.matrix };
}

/**
 * Was auf diesem Host gilt.
 *
 * @returns {{gesperrt:boolean, frei:string[]}}
 *
 * Zwei Zusagen stecken hier drin, und beide werden gemessen:
 *
 *  1. Ein Host, den wir nicht lesen können, gilt als gesperrt. Das ist kein
 *     Übereifer: Der einzige Weg, wie hier ein unlesbarer Name ankommt, ist
 *     eine Adresse, die auch `bereichBefund` schon abgelehnt hätte.
 *  2. Ein gesperrter Host hat KEINE freigeschalteten Klassen, ganz gleich, was
 *     unter `domains` steht. Die Sperre ist das letzte Wort.
 */
export async function regelnFuer(host) {
  const z = hostRein(host);
  if (!z) return { gesperrt: true, frei: [] };

  const matrix = await matrixLesen();
  const gesperrt = matrix.gesperrt.some((muster) => hostMuster(muster, z));
  if (gesperrt) return { gesperrt: true, frei: [] };

  const frei = new Set();
  for (const [name, eintrag] of Object.entries(matrix.domains)) {
    if (!hostMuster(name, z)) continue;
    for (const klasse of eintrag.frei) if (WEICH.has(klasse)) frei.add(klasse);
  }
  return { gesperrt: false, frei: [...frei] };
}

/**
 * Darf dieser Agent auf diesem Host das hier?
 *
 * Voreinstellung FALSE, an jeder einzelnen Stelle: unbekannter Agent,
 * unlesbarer Host, unbekannte Klasse, kein Eintrag, gesperrter Host. Es gibt
 * in dieser Funktion keinen Weg, der bei fehlendem Wissen `true` ergibt.
 */
export async function agentDarf(agent, host, klasse) {
  if (!AGENTEN.includes(agent)) return false;
  if (!AGENT_KLASSEN.includes(klasse)) return false;
  const z = hostRein(host);
  if (!z) return false;

  const matrix = await matrixLesen();
  /* Die Sperrliste zuerst, und ohne Ausweg: Kein Eintrag unter `agenten` hebt
     sie auf. Sonst wäre die Sperre eine Empfehlung. */
  if (matrix.gesperrt.some((muster) => hostMuster(muster, z))) return false;

  const je = matrix.agenten[agent];
  if (!je) return false;
  for (const [name, liste] of Object.entries(je)) {
    if (hostMuster(name, z) && liste.includes(klasse)) return true;
  }
  return false;
}

/**
 * Hat der Mensch für DIESEN Agenten ausdrücklich eine Matrix gepflegt?
 *
 * Der Unterschied, den diese Frage trägt (Leitsatz des Inhabers 15.08.2026,
 * „die Sitzung ist die Freigabe"): Eine LEERE Matrix ist keine Einstellung,
 * sondern die Abwesenheit einer Einstellung. Wer die Sitzung für einen Host
 * und eine Stufe ausdrücklich freigegeben hat, soll nicht zusätzlich von einer
 * leeren Tabelle überstimmt werden. Hat der Mensch dagegen für diesen Agenten
 * ETWAS eingetragen, dann meint er es so, und die Matrix gilt streng wie bisher
 * (`agentDarf`). Diese Funktion beantwortet nur „gibt es überhaupt einen
 * Eintrag", nie „was ist erlaubt" — das trennt die Frage nach dem OB von der
 * nach dem WAS, wie an jeder anderen Stelle dieses Gebietes.
 *
 * Die Sperrliste bleibt davon unberührt: Sie greift in `regelnFuer` /
 * `freigabeNoetig` und erzwingt in JEDEM Modus eine Frage, ganz gleich, ob für
 * den Agenten ein Eintrag steht.
 *
 * @returns {Promise<boolean>} true, wenn `agenten[agent]` mindestens einen Host trägt
 */
export async function agentHatEintrag(agent) {
  if (!AGENTEN.includes(agent)) return false;
  const matrix = await matrixLesen();
  const je = matrix.agenten[agent];
  return !!je && Object.keys(je).length > 0;
}
