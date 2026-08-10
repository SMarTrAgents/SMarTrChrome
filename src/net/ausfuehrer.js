/*
 * SMarTrChrome — der Ausführer.
 *
 * Das ist die Stelle, an der ein Befehl des Agenten wirklich etwas tut. Bis zu
 * dieser Runde gab es sie nicht: Der Relay legte eine Wartestelle an, schickte
 * den Befehl und wartete auf einen `result`-Rahmen — und die Erweiterung reichte
 * ihn nur als Nachricht an die Seitenleiste weiter, wo niemand antwortete.
 * Jeder einzelne Befehl lief damit in die Zeitüberschreitung.
 *
 * Die eine Regel, aus der alles Übrige folgt:
 *
 *   **Kein Weg darf ohne Antwort enden.**
 *
 * Nicht bei einem unbekannten Befehl, nicht bei fehlender Freigabe, nicht bei
 * einer geschlossenen Seitenleiste, nicht bei einem Fehler im Ausführer selbst.
 * Wer keine Antwort schickt, lässt den Agenten in eine Frist laufen, die er
 * nicht deuten kann: „keine Antwort vom Browser" heißt für ihn gleichzeitig
 * „die Seite braucht länger" und „der Mensch hat abgelehnt" und „die
 * Erweiterung ist kaputt". Eine Ablehnung ist eine Aussage. Stille ist keine.
 *
 * Fünf Grenzen, die vor jeder Ausführung stehen — in dieser Reihenfolge, jede
 * bricht ab:
 *
 *   1. **Positivliste.** Nur was in `BEFEHLE` steht, wird überhaupt betrachtet.
 *   2. **Stufe.** Die Erweiterung prüft sie selbst noch einmal; der Server darf
 *      einschränken, nie erweitern (spec-01 §5.4).
 *   3. **Bereich.** Nicht das Ziel im Befehl, sondern die Adresse, auf der der
 *      Tab GERADE steht. Der Relay kann sie nicht kennen.
 *   4. **Parameter.** Was der Befehl tun soll, muss im Rahmen stehen und nicht
 *      aus einer Voreinstellung stammen (befehle.js, `parameterPruefen`). Diese
 *      Grenze steht ausdrücklich VOR der Freigabe: Erst fragen und dann selbst
 *      ablehnen hieße, den Menschen etwas bestätigen zu lassen, das nie
 *      stattfindet.
 *   5. **Freigabe.** Jeder Schritt geht durch die Rückfrage in der
 *      Seitenleiste, bevor er ausgeführt wird.
 *
 * Und eine Regel für die Anzeige, die aus dem Bestand kommt und hier gilt wie
 * überall: Text von der besuchten Seite kommt NIE in die Freigabefrage und wird
 * NIE vorgelesen. Er steht abgesetzt daneben (`quelle`), gekürzt und von
 * Steuerzeichen befreit.
 */

import {
  BEFEHLE,
  GRENZEN,
  FRIST_PUFFER_MS,
  AUSFUEHRUNG_RESERVE_MS,
  WARTE_BEDINGUNGEN,
  kennungPruefen,
  stufeReicht,
  bereichPasst,
  hostAus,
  saeubern,
  textbaumBauen,
  rahmenDeckeln,
  parameterPruefen,
  frageZusatz,
  refPruefen,
} from "./befehle.js";
import { anSeite, overlaySicherstellen, tabAdresse } from "./seite.js";
/* Der Markenfilter des Chatwegs gilt auch hier: Der Satz des Agenten aus dem
   Befehlsrahmen landet in der Freigabekarte UND wird vorgelesen. Ohne diesen
   Import stand „A0" auf der prominentesten Fläche der Erweiterung, genau an
   der Stelle, an der jeder Schritt einzeln vorgelesen wird. Vier Eintritts-
   punkte waren gedeckt, dieser fünfte nicht. */
import { entmarken } from "./chat.js";

/* --------------------------------------------------------------------- *
 * Zustand des Ausführers. Alles im Modul, nichts auf Platte: Stirbt der
 * Service Worker, stirbt die Sitzung mit ihm — dann gibt es auch nichts mehr
 * zu zählen.
 * --------------------------------------------------------------------- */

let generation = 0; // wechselt bei jedem Sitzungsanfang und -ende
let aktiv = false; // läuft gerade eine Sitzung, in der ausgeführt werden darf?
let kette = Promise.resolve(); // Befehle laufen einer nach dem anderen
let wartende = 0;
const zaehler = { gesamt: 0, zeiten: [] };

/** Beim Sitzungsanfang: Zähler auf null, alte Läufe entwerten. */
export function zaehlerNeu() {
  generation += 1;
  aktiv = true;
  zaehler.gesamt = 0;
  zaehler.zeiten = [];
  wartende = 0;
  kette = Promise.resolve();
}

/**
 * Beim Sitzungsende: Was noch in der Warteschlange steht, wird nicht mehr
 * ausgeführt. Es bekommt trotzdem eine Antwort — die Leitung ist in diesem
 * Moment vielleicht noch offen, und wenn nicht, kostet der Versuch nichts.
 *
 * Die Marke `aktiv` ist hier das Tragende und nicht die Generationsnummer:
 * Ein Befehl, der NACH dem Ende eintrifft, bekäme sonst die neue Nummer und
 * liefe damit als „aktuell" durch. Eine beendete Sitzung führt nichts mehr
 * aus — auch keinen Befehl, der eine Millisekunde zu spät kommt.
 */
export function laufBeenden() {
  generation += 1;
  aktiv = false;
}

/* --------------------------------------------------------------------- *
 * Rahmenbau
 * --------------------------------------------------------------------- */

function meta(begonnen, tabId, zusatz = {}) {
  return {
    tookMs: Date.now() - begonnen,
    tabId: Number.isInteger(tabId) ? tabId : null,
    clientTime: new Date().toISOString(),
    ...zusatz,
  };
}

function gelungen(id, cmd, data, m) {
  return rahmenDeckeln({ type: "result", id, cmd, success: true, data, meta: m });
}

/*
 * Der Fehlerrahmen. `success: false` ist eine Beobachtung, kein Auftragsende
 * (spec-01 §3.6.4) — der Agent bekommt sie ins Modell und darf anders planen.
 * `message` ist der Satz für den Menschen und wird auf der Agentenseite
 * vorgelesen; `hint` sagt, was stattdessen ginge.
 */
function misslungen(id, cmd, code, message, { retryable = false, hint = null, data = null, m = null } = {}) {
  const rahmen = {
    type: "result",
    id,
    cmd,
    success: false,
    error: { code, message, retryable },
    meta: m || meta(Date.now(), null),
  };
  if (hint) rahmen.error.hint = hint;
  if (data) rahmen.data = data;
  return rahmenDeckeln(rahmen);
}

/* --------------------------------------------------------------------- *
 * Absagen des Inhaltsskripts
 *
 * Der Befund vom 29.07.2026 (M1, M4, M5) — und er stand in fünf Fehlertabellen
 * gleichzeitig: Kennungen, die das Inhaltsskript senden KANN, fehlten dort, und
 * der Vorgabezweig log für sie. `select` beantwortete `feld_geheim` mit dem Code
 * `tab_gone`, dem Satz „Ich konnte auf dieser Seite nichts auswählen." und
 * `retryable: true`. Der Agent erfuhr weder, dass es an einem Geheimfeld lag,
 * noch dass die Verweigerung dauerhaft ist — er las, der Tab sei weg, und wurde
 * zum Wiederholen eingeladen. Das ergibt eine Schleife, in der der Mensch jedes
 * Mal neu gefragt wird und jedes Mal dasselbe scheitert.
 *
 * Zwei Regeln, die daraus folgen und für JEDE dieser Tabellen gelten:
 *
 *  1. **Wer antwortet, lebt.** Hat das Inhaltsskript geantwortet — und sei es
 *     mit einer Absage —, dann ist der Tab erreichbar. `tab_gone` ist in diesem
 *     Fall eine Falschaussage. Der Vorgabezweig `stumm` unten gilt deshalb nur
 *     dort, wo GAR KEINE Antwort kam.
 *  2. **`retryable` ist eine Zusage, keine Höflichkeit.** Es heißt: „derselbe
 *     Aufruf kann beim zweiten Mal gelingen". Ein Geheimfeld, eine Option, die
 *     es nicht gibt, eine Seite ohne messbare Ruhe — nichts davon ändert sich
 *     durch Wiederholen. Steht dort trotzdem `true`, baut der Agent eine
 *     Schleife auf Kosten des Menschen.
 *
 * Und die dritte Regel, die diese Funktion selbst durchsetzt: Eine Kennung, für
 * die es hier keinen Satz gibt, ist ein Fehler bei UNS und wird als solcher
 * benannt — nicht als toter Tab. Dass es sie nicht geben darf, prüft
 * ausfuehrer.test.mjs gegen overlay.js selbst.
 * --------------------------------------------------------------------- */

/**
 * @param {{id:string, cmd:string, meta:Function}} ziel
 * @param {boolean} geantwortet  hat die Seite überhaupt geantwortet?
 * @param {string}  kennung      ihre Fehlerkennung
 * @param {object}  texte        Kennung → [code, satz, hinweis, wiederholbar]
 * @param {{code:string, satz:string, hinweis:string}} stumm  wenn nichts kam
 */
function absageBenennen(ziel, geantwortet, kennung, texte, stumm) {
  /* `kennung` kommt aus einer fremden Seite. `texte[kennung]` allein fände auch
     `constructor` oder `toString` — und stolperte dann beim Auspacken. Gefragt
     wird deshalb nach dem EIGENEN Eintrag, nicht nach irgendeiner Eigenschaft. */
  const eintrag = Object.prototype.hasOwnProperty.call(texte, kennung) ? texte[kennung] : null;
  if (eintrag) {
    const [code, satz, hinweis, nochmal] = eintrag;
    return misslungen(ziel.id, ziel.cmd, code, satz, {
      retryable: nochmal === true,
      hint: hinweis,
      m: ziel.meta(),
    });
  }
  if (geantwortet) {
    return misslungen(ziel.id, ziel.cmd, "client_fehler",
      `${stumm.satz} Das Inhaltsskript hat einen Grund genannt, den diese Fassung nicht kennt.`,
      {
        retryable: false,
        hint: "Den Nutzer bitten, die Erweiterung zu aktualisieren — Inhaltsskript und Ausführer sind auseinandergelaufen.",
        m: ziel.meta(),
      });
  }
  return misslungen(ziel.id, ziel.cmd, stumm.code, stumm.satz,
    { retryable: true, hint: stumm.hinweis, m: ziel.meta() });
}

/** Dasselbe, aber direkt aus einer Antwort von `anSeite`. */
function absageDerSeite(lage, antwort, texte, stumm) {
  const geantwortet = antwort.ok === true;
  const kennung = geantwortet ? String((antwort.antwort && antwort.antwort.fehler) || "") : "";
  return absageBenennen(lage, geantwortet, kennung, texte, stumm);
}

/* Die Absagen, die aus dem Auflösen einer Referenz kommen (`overlay:nachschlagen`
   und alles, was darauf aufsetzt). Sie stehen an einer Stelle, weil sie in vier
   Befehlen dieselben sind — und weil zwei Abschriften voneinander schon dreimal
   auseinandergelaufen sind. */
const REF_ABSAGEN = {
  stale_ref: ["stale_ref", "Diese Referenz gehört zu einer älteren Wahrnehmung.",
    "`readPage` aufrufen und die neuen Referenzen verwenden.", true],
  element_not_found: ["element_not_found", "Das Element gibt es auf der Seite nicht mehr.",
    "`readPage` aufrufen.", true],
  element_not_visible: ["element_not_visible", "Das Element ist gerade nicht sichtbar.",
    "Erst `scroll` zu dem Element, dann noch einmal.", true],
};

/* --------------------------------------------------------------------- *
 * Der Weg zur Seitenleiste
 * --------------------------------------------------------------------- */

/* Eine Meldung an die Seitenleiste. Ist sie zu, geht sie ins Leere — das ist
   kein Fehler und wird deshalb verschluckt. */
function melden(nachricht) {
  chrome.runtime.sendMessage(nachricht).catch(() => {});
}

/**
 * Die Rückfrage beim Menschen.
 *
 * Fail-closed in jeder Richtung: Antwortet die Seitenleiste nicht, ist sie
 * nicht da oder läuft die Frist ab, gilt das als Ablehnung. Eine Freigabe, die
 * niemand erteilt hat, gibt es nicht.
 *
 * @returns {"ja"|"nein"|"besetzt"|"keine_stelle"|"frist"}
 */
async function freigabeFragen({ frage, quelle, cmd, id, frist }) {
  let uhr = null;
  const uhrenLauf = new Promise((fertig) => {
    uhr = setTimeout(() => fertig("frist"), Math.max(1000, frist));
  });
  const fragenLauf = chrome.runtime
    /* `frist` geht mit: Die Freigabekarte zeigt eine Restzeit, und panel.js
       rechnet sie sonst selbst aus `BEFEHLE[cmd].frist` aus. Seit die
       Bedenkzeit nicht mehr aus der Befehlsfrist stammt (M3), wäre diese
       Rechnung falsch — und eine Restzeit, die nicht stimmt, ist schlimmer als
       gar keine. */
    .sendMessage({ typ: "link:schritt-freigabe", frage, quelle, cmd, id, frist })
    .then((antwort) => {
      if (antwort && antwort.ja === true) return "ja";
      /* „Besetzt" ist ausdrücklich KEIN Nein: Die Seitenleiste hatte gerade
         eine andere Frage offen. Das als Ablehnung auszugeben hieße, dem
         Nutzer eine Entscheidung zuzuschreiben, die er nie getroffen hat. */
      if (antwort && antwort.besetzt === true) return "besetzt";
      return "nein";
    })
    .catch(() => "keine_stelle");

  try {
    return await Promise.race([fragenLauf, uhrenLauf]);
  } finally {
    if (uhr) clearTimeout(uhr);
    /* Läuft unsere Frist ab, während der Mensch noch überlegt, muss die Karte
       weg — sonst beantwortet er eine Frage, auf die niemand mehr wartet
       (spec-01 §3.6.3, „Verspätete Freigabe"). */
    melden({ typ: "link:freigabe-zurueckziehen", id });
  }
}

/* --------------------------------------------------------------------- *
 * Die einzelnen Befehle
 *
 * Die Lesebefehle verändern die Seite nicht; der Agentenzeiger und der grüne
 * Rahmen liegen im geschlossenen Schattenbaum der Erweiterung. `click`, `type`
 * und `select` verändern die Seite — sie stehen auf Stufe `write`, und jeder
 * einzelne Schritt geht durch die Rückfrage beim Menschen (befehle.js,
 * Freigabe „immer").
 *
 * `navigate` und `back` sind der Sonderfall dazwischen: Sie verändern die Seite
 * nicht, aber sie wechseln sie — und nach einem Wechsel gilt nichts mehr, was
 * vorher galt. Weder die Referenzen noch das Inhaltsskript noch die Zusage,
 * dass diese Adresse freigegeben ist. Deshalb hat ihr Nachlauf eine eigene
 * Funktion (`nachDemWechsel`) und prüft dort alles noch einmal.
 *
 * Jede Ausführung nimmt ihre Parameter aus `lage.plan` und nie mehr direkt aus
 * dem Rahmen: Was im Plan steht, ist geprüft; was im Rahmen steht, ist eine
 * Behauptung des Relays.
 * --------------------------------------------------------------------- */

/*
 * Was der Ausführer sich selbst zurückhält, wenn er die Seite fragt.
 *
 * Beim Nachmessen am 29.07.2026 gefunden: Wo ein Aufruf an die Seite die GANZE
 * Restfrist bekam, liefen zwei Uhren auf dieselbe Millisekunde — die des
 * Aufrufs und der Wecker des Befehls. Wer gewann, war Zufall (gemessen: rund
 * jeder zwanzigste Lauf ging anders aus). Gewann der Wecker, bekam der Agent
 * `settle_timeout` („Die Seite ist in der Frist nicht fertig geworden") statt
 * der genauen Aussage des Befehls — und bei `click`, `type` und `select` sogar
 * dann, wenn der Schritt längst stattgefunden hatte und nur die Wahrnehmung
 * danach hing. Ein Schritt, der geschehen ist und als nicht geschehen gemeldet
 * wird, ist die schlimmste Sorte Falschaussage.
 *
 * Der Abstand sorgt dafür, dass immer der Befehl antwortet und der Wecker das
 * bleibt, was er sein soll: das letzte Netz.
 */
const SEITEN_RESERVE_MS = 1500;

/** Die Wahrnehmung erheben und in den Textbaum verwandeln. */
async function wahrnehmen(tabId, kopf, frist, offscreen = false) {
  const antwort = await anSeite(tabId, { typ: "overlay:baum", offscreen: offscreen === true }, frist);
  /* `geantwortet` bleibt erhalten und wird nicht mit der Kennung verrechnet:
     „die Seite hat sich gemeldet und konnte nicht" ist etwas anderes als „von
     der Seite kam gar nichts". Vorher fiel beides auf denselben Satz zusammen. */
  if (!antwort.ok) return { ok: false, geantwortet: false, fehler: antwort.fehler };
  if (!antwort.antwort.ok) {
    return { ok: false, geantwortet: true, fehler: String(antwort.antwort.fehler || "") };
  }
  const roh = antwort.antwort;
  const baum = textbaumBauen(roh.knoten, {
    /* Adresse und Titel kommen vom Browser, nicht aus der Seite. Eine Seite,
       die ihren eigenen Namen in die Kopfzeile schreiben darf, kann dem
       Agenten vorspielen, er stünde woanders. */
    url: kopf.url,
    titel: kopf.titel,
    epoche: roh.epoche,
  });
  return {
    ok: true,
    snapshot: {
      epoch: saeubern(roh.epoche, 24),
      url: kopf.url,
      title: saeubern(kopf.titel, 120),
      text: baum.text,
      elementCount: baum.elementCount,
      truncated: baum.truncated,
    },
    ausgelassen: baum.ausgelassen,
  };
}

async function tuReadPage(rahmen, lage) {
  /* `includeOffscreen` ist der einzige Parameter, den diese Fassung von
     `readPage` kennt. `mode` reicht der Relay bewusst nicht durch (dasselbe
     Wort heißt in der Sitzung „tab|domains"), und ein Ausschnitt ist die
     Aufgabe von `extract` — beides wird in `parameterPruefen` benannt
     abgelehnt statt hier stillschweigend zur ganzen Seite. */
  const w = await wahrnehmen(lage.tabId, lage.kopf, lage.seitenfrist(), lage.plan.offscreen === true);
  if (!w.ok) {
    return absageBenennen(lage, w.geantwortet === true, w.fehler, {
      /* `leer` heißt: Das Inhaltsskript hat es versucht und ist dabei
         hängengeblieben. Der Code bleibt `snapshot_unavailable` — genau der
         Fall, für den spec-01 §3.8 den Bild-Notausgang nennt. */
      leer: ["snapshot_unavailable", "Das Inhaltsskript ist beim Erfassen dieser Seite nicht durchgekommen.",
        "Kurz warten und `readPage` noch einmal versuchen. Bleibt es dabei, ist `screenshot` mit `screenshotReason: \"empty_ax\"` der Notausgang.", true],
    }, {
      code: "snapshot_unavailable",
      satz: "Ich konnte die Seite gerade nicht lesen.",
      hinweis: "Kurz warten und noch einmal versuchen.",
    });
  }
  return gelungen(lage.id, lage.cmd, { snapshot: w.snapshot }, lage.meta({ truncation: w.snapshot.truncated }));
}

async function tuGetState(rahmen, lage) {
  const antwort = await anSeite(lage.tabId, { typ: "overlay:zustand" }, lage.seitenfrist());
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      /* Die Seite hat geantwortet, aber ihr eigenes Ablesen ist gescheitert.
         Das als `tab_gone` zu melden, war eine Falschaussage: Wer antwortet,
         lebt. */
      leer: ["seitenskript_fehler", "Das Inhaltsskript kann den Zustand dieses Tabs gerade nicht ablesen.",
        "`readPage` versuchen — es geht einen anderen Weg durch dieselbe Seite.", true],
    }, {
      code: "tab_gone",
      satz: "Ich erreiche diesen Tab gerade nicht.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }
  const z = antwort.antwort;
  return gelungen(lage.id, lage.cmd, {
    state: {
      url: lage.kopf.url,
      title: saeubern(lage.kopf.titel, 120),
      /* Ladezustand, Bildlaufstand, Größe — nichts vom Inhalt. Wer den Inhalt
         will, ruft `readPage` und geht dafür durch dieselbe Freigabe. */
      readyState: saeubern(z.readyState, 20),
      scrollY: Number(z.scrollY) || 0,
      scrollHeight: Number(z.scrollHeight) || 0,
      viewportHeight: Number(z.viewportHeight) || 0,
      atTop: !!z.atTop,
      atBottom: !!z.atBottom,
      epoch: saeubern(z.epoche, 24),
      elementCount: Number(z.elementCount) || 0,
      access: lage.sitzung.stufe,
      mode: lage.sitzung.modus,
      allow: Array.isArray(lage.sitzung.bereich) ? lage.sitzung.bereich.slice(0, 10) : [],
      secondsLeft: Math.max(0, Math.round((Number(lage.sitzung.endetUm) - Date.now()) / 1000)),
    },
  }, lage.meta());
}

/*
 * Bildlauf. Richtung und Weite stehen im Plan — geprüft, bevor der Mensch
 * gefragt wurde (befehle.js, `parameterPruefen`). Vorher stand hier
 * `String(rahmen.direction || "down")`: Jeder Aufruf ohne Richtung scrollte
 * nach unten und meldete Erfolg. Diese Zeile gibt es nicht mehr, und sie darf
 * in keiner Gestalt zurückkommen.
 */
async function tuScroll(rahmen, lage) {
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:scrollen",
      richtung: lage.plan.richtung,
      menge: lage.plan.menge,
      ref: lage.plan.ref,
      epoche: lage.epoche,
    },
    Math.max(1000, lage.restfrist() - 2000)
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      stale_ref: REF_ABSAGEN.stale_ref,
      /* Die Referenz war gültig, das Element ist aber aus der Seite
         verschwunden. Vorher fiel dieser Fall auf `tab_gone` — der Agent las,
         der Tab sei weg, obwohl die Seite geantwortet hatte. */
      element_not_found: ["element_not_found", "Das Element, zu dem ich scrollen sollte, gibt es auf der Seite nicht mehr.",
        "`readPage` aufrufen — oder mit `direction` scrollen statt zu einem Element.", true],
    }, {
      code: "tab_gone",
      satz: "Ich konnte auf dieser Seite nicht scrollen.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }
  const s = antwort.antwort;

  /* Nach dem Bildlauf immer eine neue Wahrnehmung: Durch Nachladen entsteht in
     der Regel eine neue Epoche, und der Agent soll dafür keinen zweiten Umlauf
     brauchen (spec-01 §5.2). Kommt sie nicht zustande, ist das Scrollen
     trotzdem gelungen — dann geht die Antwort ohne Wahrnehmung raus. */
  const w = await wahrnehmen(lage.tabId, lage.kopf, lage.seitenfrist());
  const daten = {
    scrolledBy: Number(s.scrolledBy) || 0,
    atTop: !!s.atTop,
    atBottom: !!s.atBottom,
  };
  if (w.ok) daten.snapshot = w.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta());
}

/*
 * Den Agentenzeiger ans Ziel setzen, bevor geklickt, getippt oder ausgewählt
 * wird. Steht NACH der Freigabe (die tu-Wege laufen nur nach dem Ja), also darf
 * er die Maus bewegen — ein abgelehnter Schritt tut es nie. So sieht der Mensch
 * bei JEDER Handlung, wohin gegriffen wird, nicht nur beim reinen Zeigen.
 * Beste-Kraft: Misslingt das Setzen, wird der eigentliche Schritt trotzdem
 * versucht — der Zeiger ist Anzeige, keine Bedingung.
 */
async function zeigerZeigen(lage) {
  const ziel = lage.ziel;
  if (!ziel || !ziel.mitte) return;
  await anSeite(
    lage.tabId,
    {
      typ: "overlay:zeiger",
      x: ziel.mitte.x,
      y: ziel.mitte.y,
      beschriftung: ziel.name,
      rect: ziel.rect,
    },
    Math.max(1000, lage.seitenfrist())
  ).catch(() => {});
}

/*
 * Der Arbeitszeiger: eine sichtbare Bewegung für Schritte OHNE Ziel.
 *
 * Gemessen am 10.08.2026: Von den zehn Befehlen der Lesestufe bewegte genau
 * einer den Zeiger, nämlich `highlight` — und der auch nur, wenn der Agent die
 * Epoche der letzten Wahrnehmung mitschickte. Wer lesen, blättern oder warten
 * ließ, sah den grünen Rahmen und sonst nichts. Für einen Menschen ist „der
 * Rahmen steht, aber nichts bewegt sich" von „kaputt" nicht zu unterscheiden,
 * und genau so wurde es gemeldet.
 *
 * Die Oberfläche verspricht auf der Lesestufe wörtlich „lesen, blättern,
 * zeigen". Diese Funktion löst das ein: Sie schickt ein Muster an die Seite,
 * die daraus eine Bewegung im Sichtfenster zeichnet. Sie trägt keinerlei
 * Seiteninhalt und braucht keine Referenz, ist also auf jeder Stufe und in
 * jedem Zustand erlaubt.
 *
 * Beste-Kraft wie beim Zielzeiger: Misslingt es, läuft der Schritt trotzdem.
 */
const ARBEITSMUSTER = {
  readPage: "lesen",
  snapshot: "lesen",
  get_state: "prüfen",
  extract: "ablesen",
  scroll: "blättern",
  waitFor: "warten",
  screenshot: "aufnehmen",
  navigate: "wechseln",
  back: "zurück",
};

async function arbeitsZeigerFahren(tabId, cmd, frist) {
  const muster = ARBEITSMUSTER[cmd];
  if (!muster) return;
  await anSeite(tabId, { typ: "overlay:arbeitszeiger", muster }, Math.max(800, frist || 1500))
    .catch(() => {});
}

async function tuHighlight(rahmen, lage) {
  const ziel = lage.ziel; // vor der Freigabe nachgeschlagen, siehe unten
  const gesetzt = await anSeite(
    lage.tabId,
    {
      typ: "overlay:zeiger",
      x: ziel.mitte.x,
      y: ziel.mitte.y,
      beschriftung: ziel.name,
      rect: ziel.rect,
    },
    lage.seitenfrist()
  );
  if (!gesetzt.ok) {
    return misslungen(lage.id, lage.cmd, "tab_gone",
      "Ich konnte den Zeiger auf dieser Seite nicht setzen.",
      { retryable: true, m: lage.meta() });
  }
  return gelungen(lage.id, lage.cmd, {
    shown: { ref: ziel.ref, role: saeubern(ziel.rolle, 40), name: saeubern(ziel.name, GRENZEN.nameZeichen) },
  }, lage.meta());
}

/*
 * Klicken. Das Ziel steht in `lage.ziel` — vor der Freigabe nachgeschlagen,
 * damit der Mensch einem konkreten Element zugestimmt hat. Das Seitenskript
 * antwortet VOR dem Klick (overlay.js): Löst der Klick eine Navigation aus,
 * wäre die Antwort sonst verloren. Deshalb gilt: Antwort da = Klick ausgelöst,
 * und die neue Wahrnehmung danach ist Zugabe, keine Bedingung.
 */
async function tuClick(rahmen, lage) {
  const ziel = lage.ziel;
  await zeigerZeigen(lage);
  const antwort = await anSeite(
    lage.tabId,
    { typ: "overlay:klicken", ref: ziel.ref, epoche: lage.epoche },
    Math.max(1000, lage.restfrist() - 4000)
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      ...REF_ABSAGEN,
      element_not_visible: ["element_not_visible", "Das Element ist gerade nicht sichtbar.",
        "Erst `scroll`, dann noch einmal klicken.", true],
    }, {
      code: "tab_gone",
      satz: "Ich konnte auf dieser Seite nicht klicken.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }

  /* Nach dem Klick eine neue Wahrnehmung — die Seite hat sich vermutlich
     verändert. Nach einer Navigation ist das Inhaltsskript weg; dann geht die
     Antwort ohne Wahrnehmung raus, und der Agent ruft `readPage` selbst. */
  await new Promise((r) => setTimeout(r, 600));
  const w = await wahrnehmen(lage.tabId, lage.kopf, lage.seitenfrist()).catch(() => ({ ok: false }));
  const daten = {
    clicked: { ref: ziel.ref, role: saeubern(ziel.rolle, 40), name: saeubern(ziel.name, GRENZEN.nameZeichen) },
  };
  if (w && w.ok) daten.snapshot = w.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta());
}

/* Tippen. Nie in Geheimfelder (overlay.js prüft dieselbe Liste, nach der es
   deren Inhalt nicht ausliest) — Anmelden bleibt Sache des Menschen.

   `absenden` (auf dem Draht `submit`) löst nach der Eingabe Enter im Feld aus.
   Es steht im Plan und damit auch in der Frage an den Menschen: Absenden ist
   der Schritt, der aus einer Eingabe eine Handlung macht — wer nur „tippen"
   bestätigt hat, hat nicht „abschicken" bestätigt. */
async function tuType(rahmen, lage) {
  const text = lage.plan.text;
  await zeigerZeigen(lage);
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:tippen",
      ref: lage.ziel.ref,
      epoche: lage.epoche,
      text,
      leeren: lage.plan.leeren,
      absenden: lage.plan.absenden,
    },
    Math.max(1000, lage.restfrist() - 4000)
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      ...REF_ABSAGEN,
      element_not_visible: ["element_not_visible", "Das Feld ist gerade nicht sichtbar.",
        "Erst `scroll`, dann noch einmal tippen.", true],
      feld_geheim: ["user_declined", "In Passwort- und Geheimfelder tippe ich nicht. Das übernimmt der Mensch selbst.",
        "Den Nutzer bitten, das Feld selbst auszufüllen.", false],
      /* Kein `retryable` mehr: Ein Element, das kein Eingabefeld ist, wird beim
         zweiten Versuch auch keins — dieselbe Begründung wie bei
         `kein_auswahlfeld` in `tuSelect`. */
      kein_eingabefeld: ["element_not_found", "Dieses Element ist kein Eingabefeld.",
        "`readPage` aufrufen und ein Feld mit Rolle textbox wählen.", false],
      eingabe_fehlgeschlagen: ["settle_timeout", "Die Eingabe ist auf dieser Seite nicht angekommen.",
        "Noch einmal versuchen oder den Nutzer bitten, das Feld selbst auszufüllen.", true],
    }, {
      code: "tab_gone",
      satz: "Ich konnte in dieses Feld nicht tippen.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }

  const w = await wahrnehmen(lage.tabId, lage.kopf, lage.seitenfrist()).catch(() => ({ ok: false }));
  /* Die Form stammt aus spec-01 §5.2 und ist genau die, die das Werkzeug auf
     der Agentenseite liest (`browser_tool.py::_erfolgstext`): `length` und
     `submitted` stehen NEBEN `typed`, nicht darin. Vorher lag `length` innen —
     der Agent bekam „? Zeichen eingegeben" zu lesen und wusste nie, ob seine
     Eingabe angekommen war.

     Nur die Länge, nie der Text: Sonst stünde das Eingetippte über den Umweg
     Werkzeugprotokoll doch wieder im Verlauf. */
  const daten = {
    typed: {
      ref: lage.ziel.ref,
      name: saeubern(lage.ziel.name, GRENZEN.nameZeichen),
    },
    length: Number(antwort.antwort.laenge) || text.length,
    submitted: antwort.antwort.abgesendet === true,
  };
  if (w && w.ok) daten.snapshot = w.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta());
}

/*
 * Auswählen. Der Mensch hat in der Frage gelesen, WAS gewählt wird (der Wert
 * kommt aus dem Rahmen des Agenten), und WORAN — der Name des Auswahlfelds
 * steht abgesetzt in `quelle`, weil er von der Seite stammt.
 */
async function tuSelect(rahmen, lage) {
  const plan = lage.plan;
  await zeigerZeigen(lage);
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:auswaehlen",
      ref: plan.ref,
      epoche: lage.epoche,
      wert: plan.wert,
      etikett: plan.etikett,
      index: plan.index,
    },
    Math.max(1000, lage.restfrist() - 4000)
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    /* „Noch einmal versuchen" (das letzte Feld je Zeile) steht nur da, wo ein
       zweiter Versuch hilft: Eine Option, die es nicht gibt, entsteht durch
       Wiederholen nicht — und ein Element, das kein Auswahlfeld ist, wird auch
       keins. */
    return absageDerSeite(lage, antwort, {
      ...REF_ABSAGEN,
      element_not_visible: ["element_not_visible", "Das Auswahlfeld ist gerade nicht sichtbar.",
        "Erst `scroll`, dann noch einmal auswählen.", true],
      kein_auswahlfeld: ["element_not_found", "Dieses Element ist kein Auswahlfeld.",
        "`readPage` aufrufen und ein Feld mit Rolle combobox oder listbox wählen.", false],
      /* Befund M1 vom 29.07.2026: Diese Zeile fehlte. overlay.js weist Geheim-
         und Zahlungsfelder (Ablaufmonat, Kartenart) ausdrücklich mit
         `feld_geheim` ab; ohne Eintrag griff der Vorgabezweig und meldete
         `tab_gone`, „Ich konnte auf dieser Seite nichts auswählen." und
         `retryable: true` — der Tab lebte, die Verweigerung war dauerhaft, und
         der Agent wurde zum Wiederholen eingeladen. `tuType` macht denselben
         Fall an derselben Stelle seit jeher richtig; hier steht jetzt dasselbe
         Wort mit demselben Code. */
      feld_geheim: ["user_declined", "In Passwort- und Geheimfeldern wähle ich nichts aus — Ablaufmonat und Kartenart gehören dazu. Das übernimmt der Mensch selbst.",
        "Den Nutzer bitten, die Auswahl selbst zu treffen.", false],
      /* Eigener Code aus spec-01 §5.2: Die Option gibt es nicht. Das ist eine
         Beobachtung über die Seite, kein Fehler des Rahmens — der Agent sieht
         in der neuen Wahrnehmung, welche Optionen es wirklich gibt. */
      auswahl_nicht_gefunden: ["option_not_found", "Diese Option gibt es in dem Auswahlfeld nicht.",
        "`readPage` aufrufen und aus den vorhandenen Optionen wählen.", false],
    }, {
      code: "tab_gone",
      satz: "Ich konnte auf dieser Seite nichts auswählen.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }

  const a = antwort.antwort;
  const w = await wahrnehmen(lage.tabId, lage.kopf, lage.seitenfrist()).catch(() => ({ ok: false }));
  const daten = {
    selected: {
      ref: plan.ref,
      role: saeubern(a.rolle, 40),
      name: saeubern(a.name, GRENZEN.nameZeichen),
      /* `gewaehlt` kommt von der Seite und wird wie jeder Seitentext gemessen,
         gekürzt und von Steuerzeichen befreit. */
      value: a.gewaehlt === null || a.gewaehlt === undefined ? null : saeubern(a.gewaehlt, GRENZEN.wertZeichen),
    },
  };
  if (w && w.ok) daten.snapshot = w.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta());
}

/*
 * Ablesen. `extract` ist die billige Schwester von `readPage`: Es liest aus
 * derselben Wahrnehmung, liefert aber nur die Zeilen, nach denen gefragt wurde.
 * Alles, was zurückkommt, ist Seitentext und geht deshalb durch dieselbe
 * Säuberung und dieselben Deckel wie der Textbaum.
 */
async function tuExtract(rahmen, lage) {
  const plan = lage.plan;
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:auslesen",
      refs: plan.refs,
      region: plan.region,
      felder: plan.felder,
      epoche: lage.epoche,
    },
    Math.max(1000, lage.restfrist() - 2000)
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      stale_ref: ["stale_ref", "Diese Referenzen gehören zu einer älteren Wahrnehmung.",
        "`readPage` aufrufen und die neuen Referenzen verwenden.", true],
      element_not_found: ["element_not_found", "Diese Stelle gibt es auf der Seite nicht mehr.",
        "`readPage` aufrufen.", true],
      /* Befund M5 vom 29.07.2026: Beide Zeilen fehlten und fielen auf
         `snapshot_unavailable` mit „Kurz warten und noch einmal versuchen" —
         Warten hilft in keinem der beiden Fälle.

         `element_not_visible` ist der Alltagsfall: overlay.js bricht das GANZE
         Auslesen ab, sobald eine einzige der genannten Referenzen außerhalb des
         Sichtfelds liegt. Lücken auszuliefern wäre schlimmer, aber der Agent
         muss den nächsten Schritt erfahren, und der heißt `scroll`. */
      element_not_visible: ["element_not_visible", "Mindestens eine der genannten Stellen liegt außerhalb des sichtbaren Bereichs. Dann lese ich gar nichts ab — sonst bekämst du Lücken, die wie ein Ergebnis aussehen.",
        "Erst `scroll` zu der Stelle, dann noch einmal ablesen — oder weniger Referenzen auf einmal.", false],
      bereich_nicht_gefunden: ["region_not_found", "Diesen Bereich gibt es auf dieser Seite nicht.",
        "`readPage` aufrufen und einen Bereich daraus nehmen — zum Beispiel nav, main, header, footer oder form.", false],
      /* Kann nur ankommen, wenn Rahmen und Seite auseinanderlaufen:
         `parameterPruefen` lässt einen Aufruf ohne `refs` und ohne `region` gar
         nicht erst durch. Ein Satz steht hier trotzdem — ein Weg ohne Antwort
         ist auch dann einer, wenn er unerreichbar scheint. */
      nichts_angefragt: ["param_ungueltig", "Auf der Seite kam keine Angabe an, WAS abgelesen werden soll.",
        "`refs` (Liste von Referenzen) oder `region` (ein Bereich) mitsenden.", false],
    }, {
      code: "snapshot_unavailable",
      satz: "Ich konnte von dieser Seite nichts ablesen.",
      hinweis: "Kurz warten und noch einmal versuchen.",
    });
  }

  const treffer = Array.isArray(antwort.antwort.treffer) ? antwort.antwort.treffer : [];
  const zeilen = [];
  let zeichen = 0;
  let ausgelassen = plan.ausgelassen || 0;

  for (const t of treffer) {
    /* Auch ein unbrauchbarer Eintrag wird gezählt: Ein Agent, der nicht weiß,
       dass er unvollständig sieht, behauptet Dinge über Teile, die er nie
       hatte (spec-01 §4.8, derselbe Grundsatz wie beim Textbaum). */
    if (!t || typeof t !== "object") {
      ausgelassen += 1;
      continue;
    }
    if (zeilen.length >= GRENZEN.extraktRefs || zeichen >= GRENZEN.extraktZeichen) {
      ausgelassen += 1;
      continue;
    }
    const name = saeubern(t.name, GRENZEN.nameZeichen);
    const wert = t.wert === null || t.wert === undefined ? null : saeubern(t.wert, GRENZEN.wertZeichen);
    zeichen += name.length + (wert ? wert.length : 0);
    zeilen.push({
      ref: refPruefen(t.ref),
      role: saeubern(t.rolle, 40),
      name,
      value: wert,
    });
  }

  if (!zeilen.length) {
    /* Eine leere Ernte ist kein Fehler der Erweiterung, sondern eine Aussage
       über die Seite: An der genannten Stelle stand nichts. */
    return misslungen(lage.id, lage.cmd, "nothing_extracted",
      "An dieser Stelle war nichts abzulesen.",
      { retryable: true, hint: "`readPage` aufrufen und sehen, welche Referenzen es wirklich gibt.", m: lage.meta() });
  }

  return gelungen(lage.id, lage.cmd, {
    rows: zeilen,
    rowCount: zeilen.length,
    truncated: ausgelassen > 0,
    omitted: ausgelassen,
  }, lage.meta());
}

/*
 * Warten. Die Erweiterung wartet, nicht der Agent — das spart eine ganze
 * Modellrunde je Sekunde Geduld.
 *
 * Läuft die Zeit ab, ohne dass die Bedingung eintritt, ist das `wait_timeout`
 * MIT Wahrnehmung (spec-01 §5.2): Der Agent muss sehen können, worauf er
 * vergeblich gewartet hat, sonst wartet er gleich noch einmal.
 */
async function tuWaitFor(rahmen, lage) {
  const plan = lage.plan;
  /* Der Plan kennt die Frist des Befehls; hier zählt, was nach der Rückfrage
     beim Menschen davon übrig ist. Ein Wecker, der nach der Antwort losgeht,
     ist kein Wecker. */
  const wartenMs = Math.max(500, Math.min(plan.wartenMs, lage.restfrist() - 3000));
  const antwort = await anSeite(
    lage.tabId,
    {
      typ: "overlay:warten",
      bedingung: plan.bedingung,
      wert: plan.wert,
      epoche: lage.epoche,
      fristMs: wartenMs,
    },
    wartenMs + 1500
  );
  if (!antwort.ok || !antwort.antwort.ok) {
    return absageDerSeite(lage, antwort, {
      stale_ref: ["stale_ref", "Diese Referenz gehört zu einer älteren Wahrnehmung.",
        "`readPage` aufrufen und die neue Referenz verwenden.", true],
      element_not_found: ["element_not_found", "Das Element gibt es auf der Seite nicht mehr.",
        "`readPage` aufrufen.", true],
      /* Befund M4 vom 29.07.2026: Diese drei Zeilen fehlten und fielen auf
         `tab_gone` / „Ich konnte auf dieser Seite nicht warten." mit
         `retryable: true`.

         `ruhe_nicht_messbar` ist der praktische Fall: Ohne MutationObserver
         lässt sich Ruhe auf dieser Seite nicht messen — und wird es auch beim
         zehnten Versuch nicht. Der Agent hörte „der Tab ist weg, versuch es
         nochmal" und wartete in einer Schleife auf etwas, das nie messbar
         wird. */
      ruhe_nicht_messbar: ["idle_not_measurable", "Auf dieser Seite lässt sich Ruhe nicht messen — dem Browser fehlt dafür der Beobachter.",
        `Auf etwas Sichtbares warten statt auf Ruhe: ${WARTE_BEDINGUNGEN.filter((b) => b !== "idle").join(", ")}.`, false],
      unbekannte_bedingung: ["param_ungueltig", "Diese Wartebedingung kennt das Inhaltsskript nicht.",
        `Genau eine mitsenden: ${WARTE_BEDINGUNGEN.join(", ")}.`, false],
      wert_fehlt: ["param_ungueltig", "Zu dieser Wartebedingung kam auf der Seite kein Wert an.",
        "`textPresent` und `urlMatches` brauchen den Text, auf den gewartet wird.", false],
      leer: ["seitenskript_fehler", "Das Warten ist auf dieser Seite fehlgeschlagen.",
        "Mit `readPage` nachsehen, wie die Seite jetzt aussieht — oder auf eine andere Bedingung warten.", true],
    }, {
      code: "tab_gone",
      satz: "Ich konnte auf dieser Seite nicht warten.",
      hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
    });
  }

  const erfuellt = antwort.antwort.erfuellt === true;
  const w = await wahrnehmen(lage.tabId, lage.kopf, lage.seitenfrist()).catch(() => ({ ok: false }));
  const daten = {
    satisfied: erfuellt,
    waitedMs: Number(antwort.antwort.wartezeitMs) || 0,
    condition: plan.bedingung,
  };
  if (w && w.ok) daten.snapshot = w.snapshot;

  if (!erfuellt) {
    return misslungen(lage.id, lage.cmd, "wait_timeout",
      "In der Wartezeit ist das nicht eingetreten.",
      {
        retryable: true,
        hint: "Die mitgelieferte Wahrnehmung zeigt, wie die Seite jetzt aussieht — vielleicht ist es eine andere Bedingung.",
        data: daten,
        m: lage.meta({ gedeckelt: plan.gedeckelt === true }),
      });
  }
  return gelungen(lage.id, lage.cmd, daten, lage.meta({ gedeckelt: plan.gedeckelt === true }));
}

/*
 * Das Bild. Der Notausgang, und deshalb an drei Stellen misstrauisch:
 *
 *  1. `captureVisibleTab` nimmt den SICHTBAREN Tab eines Fensters auf — nicht
 *     den Tab, den wir übergeben. Steht unser Tab im Hintergrund, fotografiert
 *     der Aufruf eine fremde Seite, die nie freigegeben wurde. Das ist keine
 *     Randfrage, sondern der kürzeste Weg an der Bereichsprüfung vorbei.
 *  2. Ein Bild als Base64 sprengt den Rahmendeckel mühelos. Ein abgeschnittenes
 *     Bild ist aber kein Bild, sondern Datenmüll mit Erfolgsmeldung — also
 *     lieber eine ehrliche Absage.
 *  3. Ohne Wahrnehmung. Sie zusätzlich mitzuschicken verdoppelte die Nutzlast
 *     genau dort, wo sie ohnehin am größten ist; `readPage` steht dem Agenten
 *     einen Befehl später offen.
 */
async function tuScreenshot(rahmen, lage) {
  let tab = null;
  try {
    tab = await chrome.tabs.get(lage.tabId);
  } catch (_) {
    tab = null;
  }
  if (!tab) {
    return misslungen(lage.id, lage.cmd, "tab_gone",
      "Der Tab, den ich aufnehmen durfte, ist nicht mehr da.", { m: lage.meta() });
  }
  if (tab.active !== true) {
    return misslungen(lage.id, lage.cmd, "tab_nicht_im_vordergrund",
      "Dieser Tab steht gerade nicht im Vordergrund. Ich fotografiere nicht, was ich nicht steuern darf.",
      {
        retryable: true,
        hint: "Den Nutzer bitten, den Tab nach vorn zu holen — oder `readPage` nehmen, das geht auch im Hintergrund.",
        m: lage.meta(),
      });
  }

  /*
   * Die Leiter (Befund M7 vom 29.07.2026). Vorher gab es genau eine Stufe:
   * Qualität 40, Deckel 90 KiB Base64 ≈ 67 KiB JPEG. Ein Ausschnitt von
   * 1920×1080 liegt typischerweise darüber, auf einem HiDPI-Schirm deutlich —
   * der Notausgang stand damit die meiste Zeit zu, und zwar mit einer
   * ehrlichen, aber ausweglosen Meldung.
   *
   * Jetzt wird dieselbe Ansicht bei Bedarf gröber noch einmal aufgenommen. Ein
   * Notausgang muss lesbar sein, nicht schön. Erst wenn auch die unterste Stufe
   * nicht passt, wird abgesagt — und die Absage sagt dann, was versucht wurde.
   *
   * Verkleinern statt gröber komprimieren wäre der stärkere Hebel, braucht im
   * Hintergrunddienst aber `OffscreenCanvas` und `createImageBitmap`; beides
   * ist hier ungeprüft, und ungeprüfter Code auf dem Notausgang ist kein
   * Notausgang. Die Leiter ist der Teil, der sich ohne Browser prüfen lässt.
   */
  const stufen = Array.isArray(GRENZEN.bildQualitaeten) && GRENZEN.bildQualitaeten.length
    ? GRENZEN.bildQualitaeten
    : [40];
  let b64 = "";
  let mime = "image/jpeg";
  let qualitaet = stufen[stufen.length - 1];

  for (const stufe of stufen) {
    let datenUrl = null;
    try {
      datenUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: stufe,
      });
    } catch (fehler) {
      return misslungen(lage.id, lage.cmd, "snapshot_unavailable",
        "Von dieser Seite kann ich kein Bild aufnehmen.",
        {
          retryable: true,
          hint: "`readPage` liefert dasselbe als Text — und liest sich für den Nutzer auch vor.",
          m: lage.meta(),
        });
    }

    const komma = typeof datenUrl === "string" ? datenUrl.indexOf(",") : -1;
    if (komma < 0 || !datenUrl.startsWith("data:image/")) {
      return misslungen(lage.id, lage.cmd, "snapshot_unavailable",
        "Die Aufnahme ist leer geblieben.",
        { retryable: true, hint: "Noch einmal versuchen oder `readPage` nehmen.", m: lage.meta() });
    }

    b64 = datenUrl.slice(komma + 1);
    mime = (/^data:([^;,]+)/.exec(datenUrl) || [])[1] || "image/jpeg";
    qualitaet = stufe;
    if (b64.length <= GRENZEN.bildZeichen) break;
  }

  const fuellzeichen = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;

  if (b64.length > GRENZEN.bildZeichen) {
    return misslungen(lage.id, lage.cmd, "screenshot_zu_gross",
      `Das Bild ist auch in der gröbsten Stufe (Qualität ${qualitaet}) zu groß für die Leitung. Ich habe es verworfen, statt dir die Hälfte zu schicken.`,
      {
        retryable: false,
        hint: "`readPage` nehmen — oder den Nutzer bitten, das Fenster kleiner zu machen; dann passt auch die Aufnahme.",
        m: lage.meta(),
      });
  }

  return gelungen(lage.id, lage.cmd, {
    image: {
      mime,
      /* Welche Stufe der Leiter es geworden ist. Ein Bild bei Qualität 10 ist
         etwas anderes als eines bei 40 — wer darauf etwas liest, soll wissen,
         wie grob es war. */
      quality: qualitaet,
      /* Breite und Höhe fehlen bewusst: Im Hintergrunddienst gibt es kein DOM,
         mit dem sie sich messen ließen, und eine geratene Zahl wäre schlimmer
         als keine. Die Byte-Zahl dagegen ist gerechnet — Base64 trägt vier
         Zeichen je drei Byte, die Füllzeichen am Ende zählen nicht mit. */
      bytes: Math.floor((b64.length * 3) / 4) - fuellzeichen,
      dataB64: b64,
    },
    reason: lage.plan.anlass,
  }, lage.meta());
}

/* --------------------------------------------------------------------- *
 * Ortswechsel
 *
 * `navigate` und `back` haben denselben Nachlauf, und er ist der eigentliche
 * Inhalt beider Befehle: Nach einem Wechsel ist das Inhaltsskript WEG. Der
 * grüne Rahmen wäre verschwunden, und der Agent läse eine Seite, auf der der
 * Mensch nicht sieht, dass gelesen wird. Also: warten, bis der Tab fertig ist,
 * die neue Adresse gegen den Bereich prüfen, den Rahmen neu einspielen — und
 * erst dann wahrnehmen.
 * --------------------------------------------------------------------- */

/**
 * Warten, bis der Tab geladen hat — mit eigener Uhr statt blindem Schlafen.
 *
 * Ein festes `setTimeout(2000)` wäre auf einer schnellen Seite Verschwendung
 * und auf einer langsamen zu wenig; deshalb wird gefragt statt geschätzt.
 *
 * Trägt der Tab überhaupt kein `status`, gilt er als fertig, statt bis zur
 * Frist zu warten: Die verbindliche Bereitschaftsprüfung ist ohnehin der Ping
 * auf das Inhaltsskript (`overlaySicherstellen`), nicht dieses Feld. Und läuft
 * die Frist ab, während die Seite noch lädt, ist auch das kein Abbruch — die
 * Antwort geht mit `statusHint: "loading"` heraus, damit der Agent weiß, dass
 * er ein Zwischenbild sieht.
 */
async function tabFertigAbwarten(tabId, fristMs) {
  const ende = Date.now() + Math.max(500, fristMs);
  for (;;) {
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      return { ok: false, fehler: "tab_gone" };
    }
    if (!tab) return { ok: false, fehler: "tab_gone" };
    if (tab.status === undefined || tab.status === "complete") return { ok: true, tab };
    if (Date.now() >= ende) return { ok: false, fehler: "frist", tab };
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Schaltet den grünen Rahmen an, wenn das Inhaltsskript gerade neu eingespielt
 * wurde. Ein frisch eingespieltes Overlay startet unsichtbar (opacity 0), erst
 * `overlay:an` setzt `data-an` und damit die Deckkraft.
 *
 * Diese Funktion gibt es, weil es die Stelle ZWEIMAL braucht und sie beim
 * ersten Mal nur an einer von beiden stand: Schritt 7 der Befehlsschleife hatte
 * sie, der gemeinsame Nachlauf von `navigate` und `back` nicht. Ein Agent, der
 * einmal selbst navigierte, arbeitete danach für den Rest der Sitzung ohne
 * Rahmen, ohne Schild und ohne Titel-Präfix — denn beim nächsten Befehl meldet
 * `overlaySicherstellen` `schonDa: true` und der Zweig greift nie mehr. Genau
 * die Regression „nichts passiert sichtbar", die für behoben erklärt war, stand
 * über den Ortswechsel wieder offen. Zwei Aufrufer, eine Quelle: so können die
 * beiden Stellen nicht erneut auseinanderlaufen.
 */
async function rahmenWiederAnschalten(tabId, overlay) {
  if (!overlay || overlay.schonDa) return;
  const gross = await grosseSichtLesen();
  await anSeite(tabId, {
    typ: "overlay:an",
    gross,
    text: "SMarTrAgent steuert diesen Tab, Esc Esc = Stopp",
  }, 2000).catch(() => {});
}

/**
 * Der gemeinsame Nachlauf von `navigate` und `back`.
 *
 * @returns {{ok:true, kopf:object, snapshot:object|null, fertig:boolean}
 *          |{ok:false, code:string, satz:string, hinweis:string|null, retryable:boolean}}
 */
async function nachDemWechsel(lage, fristMs) {
  const fertig = await tabFertigAbwarten(lage.tabId, fristMs);
  if (!fertig.ok && fertig.fehler === "tab_gone") {
    return { ok: false, code: "tab_gone", satz: "Der Tab ist beim Wechsel verschwunden.", hinweis: null, retryable: false };
  }

  const adresse = await tabAdresse(lage.tabId);
  if (!adresse) {
    return { ok: false, code: "tab_gone", satz: "Der Tab ist beim Wechsel verschwunden.", hinweis: null, retryable: false };
  }

  /* Die Adresse NACH dem Wechsel. Eine Weiterleitung kann aus einer
     freigegebenen Adresse eine fremde machen — geprüft wird deshalb, wo der Tab
     wirklich steht, nicht wohin er sollte.

     Abweichung von spec-01 §5.2, bewusst: Dort steht, der Tab werde in diesem
     Fall auf `about:blank` gesetzt. Das zerstört dem Menschen seinen Tab, ohne
     ihn zu fragen — der Schutz besteht aber darin, NICHT ZU LESEN, nicht darin,
     etwas kaputtzumachen. Die Seite bleibt stehen, der Agent bekommt eine
     Absage, und jeder folgende Befehl scheitert ohnehin an derselben Prüfung
     (Schritt 6 der Schleife). */
  if (!bereichPasst(adresse, lage.sitzung)) {
    melden({ typ: "link:protokoll", text: "Der Tab steht nach dem Wechsel außerhalb der Freigabe — ich lese hier nicht." });
    return {
      ok: false,
      code: "scope_violation_local",
      satz: "Nach dem Wechsel steht dieser Tab auf einer Seite, die nicht freigegeben ist. Ich lese sie nicht.",
      hinweis: "Den Nutzer bitten, zurückzuwechseln oder eine neue Freigabe zu erteilen.",
      retryable: false,
    };
  }

  const overlay = await overlaySicherstellen(lage.tabId);
  if (!overlay.ok) {
    return {
      ok: false,
      code: "snapshot_unavailable",
      satz: overlay.fehler === "ursprung_gesperrt"
        ? "Auf dieser Seite arbeite ich grundsätzlich nicht."
        : "Ich kann auf der neuen Seite den grünen Rahmen nicht anzeigen. Ohne ihn arbeite ich nicht.",
      hinweis: "Den Nutzer bitten, eine gewöhnliche Webseite zu öffnen.",
      retryable: overlay.fehler !== "ursprung_gesperrt",
    };
  }

  /* Vor der Wahrnehmung, nicht danach: schon der erste Blick auf die neue Seite
     soll unter sichtbarem Rahmen geschehen. */
  await rahmenWiederAnschalten(lage.tabId, overlay);

  const kopf = { url: adresse, titel: await tabTitel(lage.tabId) };
  const w = await wahrnehmen(lage.tabId, kopf, lage.seitenfrist()).catch(() => ({ ok: false }));
  return { ok: true, kopf, snapshot: w && w.ok ? w.snapshot : null, fertig: fertig.ok };
}

function wechselAbsage(lage, nachlauf) {
  return misslungen(lage.id, lage.cmd, nachlauf.code, nachlauf.satz, {
    retryable: nachlauf.retryable === true,
    hint: nachlauf.hinweis,
    m: lage.meta(),
  });
}

async function tuNavigate(rahmen, lage) {
  const plan = lage.plan;
  try {
    await chrome.tabs.update(lage.tabId, { url: plan.url });
  } catch (fehler) {
    return misslungen(lage.id, lage.cmd, "navigation_failed",
      "Diese Adresse ließ sich nicht aufrufen.",
      { retryable: true, hint: "Adresse prüfen oder den Nutzer bitten, die Seite selbst zu öffnen.", m: lage.meta() });
  }

  const nachlauf = await nachDemWechsel(lage, Math.max(1000, lage.restfrist() - 6000));
  if (!nachlauf.ok) return wechselAbsage(lage, nachlauf);

  const daten = {
    url: nachlauf.kopf.url,
    title: saeubern(nachlauf.kopf.titel, 120),
    /* Weitergeleitet heißt: ein anderer HOST. Ein angehängter Schrägstrich ist
       keine Weiterleitung, und ein Agent, dem man das als eine verkauft, sucht
       den Fehler an der falschen Stelle. */
    redirected: hostAus(nachlauf.kopf.url) !== plan.host,
    statusHint: nachlauf.fertig ? "complete" : "loading",
  };
  if (nachlauf.snapshot) daten.snapshot = nachlauf.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta({ settled: nachlauf.fertig }));
}

async function tuBack(rahmen, lage) {
  try {
    await chrome.tabs.goBack(lage.tabId);
  } catch (fehler) {
    /* Chrome lehnt hier zwei sehr verschiedene Dinge mit einem Wurf ab. Welches
       von beiden es war, lässt sich billig nachsehen — und der Unterschied ist
       für den Agenten der zwischen „anders planen" und „aufhören". */
    const daNoch = await tabAdresse(lage.tabId);
    if (!daNoch) {
      return misslungen(lage.id, lage.cmd, "tab_gone",
        "Der Tab, den ich steuern durfte, ist nicht mehr da.", { m: lage.meta() });
    }
    return misslungen(lage.id, lage.cmd, "no_history",
      "Hier gibt es keine Seite zurück — dieser Tab hat keine Vorgeschichte.",
      {
        retryable: false,
        hint: "Das ist kein Fehler. Mit `navigate` ein Ziel nennen oder den Nutzer fragen, wohin es gehen soll.",
        m: lage.meta(),
      });
  }

  const nachlauf = await nachDemWechsel(lage, Math.max(1000, lage.restfrist() - 5000));
  if (!nachlauf.ok) return wechselAbsage(lage, nachlauf);

  const daten = {
    url: nachlauf.kopf.url,
    title: saeubern(nachlauf.kopf.titel, 120),
    statusHint: nachlauf.fertig ? "complete" : "loading",
  };
  if (nachlauf.snapshot) daten.snapshot = nachlauf.snapshot;
  return gelungen(lage.id, lage.cmd, daten, lage.meta({ settled: nachlauf.fertig }));
}

/* Die Tabelle der Ausführungen. Sie muss zu `BEFEHLE` passen — ein Eintrag
   dort ohne Eintrag hier wäre ein Befehl, der die Freigabe durchläuft und dann
   an `AUSFUEHRUNG[cmd] is not a function` stirbt. Die Prüfung „Zu jedem Befehl
   der Tabelle gibt es auch eine Ausführung" hält beide Listen zusammen. */
const AUSFUEHRUNG = {
  readPage: tuReadPage,
  snapshot: tuReadPage,
  get_state: tuGetState,
  scroll: tuScroll,
  highlight: tuHighlight,
  extract: tuExtract,
  waitFor: tuWaitFor,
  screenshot: tuScreenshot,
  navigate: tuNavigate,
  back: tuBack,
  click: tuClick,
  type: tuType,
  select: tuSelect,
};

/* --------------------------------------------------------------------- *
 * Die Schleife
 * --------------------------------------------------------------------- */

function rateFrei() {
  const jetzt = Date.now();
  zaehler.zeiten = zaehler.zeiten.filter((t) => jetzt - t < GRENZEN.fensterMs);
  if (zaehler.gesamt >= GRENZEN.befehleJeSitzung) return "sitzung";
  if (zaehler.zeiten.length >= GRENZEN.befehleJeFenster) return "fenster";
  return null;
}

/**
 * Ein Befehl vom Relay — geprüft, freigegeben, ausgeführt, beantwortet.
 *
 * Diese Funktion wirft nie. Sie gibt immer einen `result`-Rahmen zurück, und
 * zwar mit derselben `id`, die der Relay gesendet hat. Ist die Kennung
 * unbrauchbar, geht die Antwort trotzdem raus — der Relay wirft sie dann weg,
 * und das ist billiger, als wenn ein Aufrufer wartet.
 */
export async function befehlAusfuehren(rahmen, sitzung) {
  const begonnen = Date.now();
  const id = kennungPruefen(rahmen && rahmen.id) || "";
  const cmd = typeof rahmen?.cmd === "string" ? rahmen.cmd.slice(0, 40) : "";
  const meineGeneration = generation;

  if (wartende >= GRENZEN.warteschlange) {
    return misslungen(id, cmd, "busy",
      "Ich arbeite gerade einen Schritt ab und komme nicht hinterher.",
      { retryable: true, hint: "Einen Schritt nach dem anderen senden.", m: meta(begonnen, sitzung && sitzung.tabId) });
  }

  wartende += 1;
  const meins = kette.then(() =>
    einzeln(rahmen, sitzung, { id, cmd, begonnen, meineGeneration }).catch((fehler) =>
      /* Der letzte Fangnetz-Zweig. Was hier ankommt, ist ein Fehler in dieser
         Erweiterung — der Agent bekommt trotzdem eine Antwort, sonst wäre ein
         Programmfehler bei uns für ihn nicht von einem toten Browser zu
         unterscheiden. */
      misslungen(id, cmd, "client_fehler",
        "In der Erweiterung ist etwas schiefgegangen. Der Schritt wurde nicht ausgeführt.",
        { retryable: true, hint: String(fehler && fehler.message ? fehler.message : fehler).slice(0, 120), m: meta(begonnen, sitzung && sitzung.tabId) })
    )
  );
  kette = meins.then(
    () => undefined,
    () => undefined
  );
  try {
    return await meins;
  } finally {
    wartende -= 1;
  }
}

async function einzeln(rahmen, sitzung, { id, cmd, begonnen, meineGeneration }) {
  const tabId = sitzung && Number.isInteger(sitzung.tabId) ? sitzung.tabId : null;
  const m = (zusatz) => meta(begonnen, tabId, zusatz);

  /* Die Uhr, an der die AUSFÜHRUNG hängt. Sie beginnt beim Eintreffen des
     Befehls — und wird um die Zeit zurückgestellt, die der Mensch für seine
     Antwort gebraucht hat (Schritt 10, Befund M3). `begonnen` selbst bleibt
     unangetastet: `meta.tookMs` soll sagen, wie lange es WIRKLICH gedauert hat,
     nicht wie lange die Maschine daran gearbeitet hat. */
  let uhrBeginn = begonnen;

  /* 0. Lebt die Sitzung noch, für die dieser Befehl gedacht war? */
  if (!aktiv || meineGeneration !== generation) {
    return misslungen(id, cmd, "session_beendet",
      "Die Browsersitzung ist beendet. Ich führe nichts mehr aus.",
      { m: m() });
  }

  /* 1. Positivliste. Ein unbekannter Befehl wird abgelehnt und benannt — nicht
        stillschweigend verschluckt und nicht auf gut Glück versucht. */
  const eintrag = BEFEHLE[cmd];
  if (!eintrag) {
    return misslungen(id, cmd, "not_supported",
      cmd
        ? `Den Befehl „${saeubern(cmd, 40)}" kann diese Erweiterung nicht.`
        : "Der Rahmen trug keinen Befehl.",
      {
        hint: `Möglich sind zurzeit: ${Object.keys(BEFEHLE).join(", ")}.`,
        m: m(),
      });
  }

  /* 2. Der Satz für den Menschen ist Pflicht. Er wird vorgelesen; ohne ihn
        wüsste der Inhaber nicht, wofür er gerade freigibt. Das ist eine
        Barrierefreiheits-Erzwingung im Protokoll, keine Höflichkeit
        (spec-01 §3.6.2). */
  const grund = typeof (rahmen && rahmen.reason) === "string" ? entmarken(saeubern(rahmen.reason, 200)) : "";
  if (!grund) {
    return misslungen(id, cmd, "reason_required",
      "Zu diesem Schritt fehlt der Satz, der dem Menschen vorgelesen wird.",
      { hint: "`reason` mitsenden: ein Satz in Alltagssprache, was du tust und warum.", m: m() });
  }

  /* 3. Deckel. Der Relay zählt selbst (DRAHTFORMAT §6); diese Zählung ist die
        zweite und greift auch dann, wenn der Relay eine andere Meinung hat. */
  const rate = rateFrei();
  if (rate) {
    return misslungen(id, cmd, "budget_exceeded",
      rate === "sitzung"
        ? "Diese Sitzung hat ihr Befehlskontingent aufgebraucht."
        : "Das waren zu viele Befehle in kurzer Zeit.",
      { retryable: rate === "fenster", m: m() });
  }
  zaehler.gesamt += 1;
  zaehler.zeiten.push(Date.now());

  /* 4. Stufe. Der Server darf einschränken, nie erweitern. */
  if (!stufeReicht(sitzung && sitzung.stufe, cmd)) {
    return misslungen(id, cmd, "stufe_zu_niedrig",
      `Diese Sitzung darf nur zusehen. „${saeubern(cmd, 40)}" braucht mehr Rechte.`,
      { hint: "Dem Nutzer sagen, was du bräuchtest — er kann eine neue Sitzung freigeben.", m: m() });
  }

  /* 5. Der Tab. */
  if (tabId === null) {
    return misslungen(id, cmd, "tab_gone",
      "Zu dieser Sitzung gehört kein Tab mehr.", { m: m() });
  }
  const adresse = await tabAdresse(tabId);
  if (!adresse) {
    return misslungen(id, cmd, "tab_gone",
      "Der Tab, den ich steuern durfte, ist nicht mehr da.", { m: m() });
  }

  /* 6. Bereich — gemessen an der Adresse, auf der der Tab JETZT steht.
        Der Relay prüft die Ziele im Befehl; wohin der Mensch oder die Seite
        selbst inzwischen gewechselt ist, kann er nicht wissen. Ohne diese
        Prüfung läse der Agent eine Seite, die nie freigegeben wurde. */
  if (!bereichPasst(adresse, sitzung)) {
    return misslungen(id, cmd, "scope_violation_local",
      "Dieser Tab steht auf einer Seite, die nicht freigegeben ist. Ich lese sie nicht.",
      { hint: "Den Nutzer bitten, den Tab zurückzuwechseln oder eine neue Freigabe zu erteilen.", m: m() });
  }

  /* 7. Der Rahmen muss stehen, bevor gelesen wird. Ohne ihn sieht der Mensch
        nicht, dass gerade auf seiner Seite gearbeitet wird — und dann wird
        nicht gearbeitet. */
  const overlay = await overlaySicherstellen(tabId);
  if (!overlay.ok) {
    return misslungen(id, cmd, "snapshot_unavailable",
      overlay.fehler === "ursprung_gesperrt"
        ? "Auf dieser Seite arbeite ich grundsätzlich nicht."
        : "Ich kann auf dieser Seite den grünen Rahmen nicht anzeigen. Ohne ihn arbeite ich nicht.",
      { retryable: overlay.fehler !== "ursprung_gesperrt", m: m() });
  }

  /* War das Overlay gerade neu einzuspielen, ist der grüne Rahmen aus: Nach
     jeder Navigation stirbt das alte Skript, das neue startet unsichtbar
     (opacity 0). Bis 0.4.1 schaltete es danach niemand wieder an — deshalb war
     die Seite nach dem ersten Seitenwechsel unsichtbar bedient. Das ist der
     Kern der Meldung „nichts passiert sichtbar". Jetzt wird der Rahmen bei
     jeder Neu-Einspielung wiederhergestellt. */
  await rahmenWiederAnschalten(tabId, overlay);

  const kopf = { url: adresse, titel: await tabTitel(tabId) };

  /* 8. Die Parameter — geprüft, BEVOR gefragt wird.
        Zwei Gründe, und beide sind Befunde:
        (a) `scroll` machte aus einer fehlenden Richtung stillschweigend „nach
            unten" und meldete Erfolg. Ein fehlender Parameter, der bestimmt,
            WAS geschieht, ist ab hier eine benannte Absage.
        (b) Bei `navigate` muss die Zieladresse vor der Frage gegen den Bereich
            stehen. Sonst bestätigt der Mensch eine Adresse, die die Erweiterung
            danach selbst ablehnt — und lernt, dass seine Zustimmung nichts
            bedeutet. */
  const gepruefte = parameterPruefen(cmd, rahmen, {
    sitzung,
    fristMs: Math.max(1000, frist(eintrag, uhrBeginn) - AUSFUEHRUNG_RESERVE_MS),
  });
  if (!gepruefte.ok) {
    return misslungen(id, cmd, gepruefte.code, gepruefte.satz,
      { retryable: gepruefte.retryable === true, hint: gepruefte.hinweis, m: m() });
  }
  const plan = gepruefte.plan;

  /* 9. Bei „zeigen", „klicken", „tippen" und „auswählen" muss vor der Frage
        feststehen, WORAUF gezielt wird — sonst könnte der Mensch nur einer
        Absicht zustimmen, nicht einem Schritt. Nachgeschlagen wird nur; die
        Seite bleibt an dieser Stelle unberührt. */
  let ziel = null;
  const epoche = typeof rahmen.snapshotEpoch === "string" ? rahmen.snapshotEpoch : null;
  if (cmd === "highlight" || cmd === "click" || cmd === "type" || cmd === "select") {
    const ref = plan.ref;
    const nachschlag = await anSeite(
      tabId,
      {
        typ: "overlay:nachschlagen",
        ref,
        epoche,
      },
      6000
    );
    if (!nachschlag.ok || !nachschlag.antwort.ok) {
      return absageDerSeite({ id, cmd, meta: m }, nachschlag, {
        ...REF_ABSAGEN,
        element_not_visible: ["element_not_visible", "Das Element ist gerade nicht sichtbar.",
          "Erst `scroll` zu dem Element, dann noch einmal zeigen.", true],
      }, {
        code: "tab_gone",
        satz: "Ich erreiche den Tab gerade nicht.",
        hinweis: "Den Nutzer bitten, den Tab offen zu lassen, und es noch einmal versuchen.",
      });
    }
    ziel = {
      ref,
      name: saeubern(nachschlag.antwort.name, GRENZEN.nameZeichen),
      rolle: saeubern(nachschlag.antwort.rolle, 40),
      rect: nachschlag.antwort.rect,
      mitte: nachschlag.antwort.mitte,
    };
    /* Der Zeiger wird hier BEWUSST noch nicht gesetzt. Ein abgelehnter Schritt
       darf nichts auf der Seite bewegen, auch nicht den Agentenzeiger — das
       wäre ein `highlight` ohne Freigabe. Sichtbar wird das Ziel erst nach dem
       Ja, in der Ausführung (overlay.js: zeigerAufTreffer in klicken/tippen/
       auswählen). Prüfsatz: „overlay:zeiger trotz Ablehnung" muss ausbleiben. */
  }

  /* 10. Die Freigabe. Sie steht vor der Ausführung, nicht in ihr.
        Die Frage besteht aus unseren eigenen Worten und dem Satz des Agenten.
        Der Name des Elements ist Text von der Seite — er geht in `quelle`,
        wird abgesetzt angezeigt und nicht vorgelesen. */
  const brauchtFreigabe =
    eintrag.freigabe === "immer" ||
    (sitzung && sitzung.schrittmodus) !== "auto";

  if (brauchtFreigabe) {
    /* Wartet dieser Befehl schon länger in der Schlange, als der Relay
       überhaupt auf eine Antwort wartet, ist die Frage sinnlos: Der Mensch
       entschiede über einen Schritt, dessen Ergebnis niemand mehr hört. */
    if (Date.now() - begonnen >= GRENZEN.gesamtfristMs) {
      return misslungen(id, cmd, "settle_timeout",
        "Bis zur Rückfrage war die Zeit schon um.",
        { retryable: true, hint: "Den Schritt noch einmal senden.", m: m() });
    }

    /* Die Bedenkzeit ist Menschenzeit, nicht Maschinenzeit (Befund M3,
       Begründung in befehle.js bei `GRENZEN.bedenkzeitMs`). Sie ist mindestens
       so lang wie dort angegeben — und nie kürzer als das, was die eigene Frist
       des Befehls ohnehin hergäbe. */
    const bedenkzeit = Math.max(
      GRENZEN.bedenkzeitMs,
      frist(eintrag, uhrBeginn) - AUSFUEHRUNG_RESERVE_MS
    );

    /* Was genau geschieht, gehört in die Frage: der Text beim Tippen, die
       Option beim Auswählen, die Adresse beim Wechsel. Alles davon stammt vom
       Agenten, nicht von der besuchten Seite (befehle.js, `frageZusatz`). */
    const zusatz = frageZusatz(cmd, plan);
    const gefragtUm = Date.now();
    const antwort = await freigabeFragen({
      frage: `${eintrag.tut.charAt(0).toUpperCase()}${eintrag.tut.slice(1)}? Der Agent sagt: „${grund}"${zusatz}`,
      quelle: ziel ? ziel.name : "",
      cmd,
      id,
      frist: bedenkzeit,
    });

    /* Die Zeit, die der Mensch gebraucht hat, bekommt die Maschine zurück.
       Sonst wäre die längere Bedenkzeit nur eine längere Art, `settle_timeout`
       zu sagen: Bei `scroll` (10 s Frist) hätte nach 25 Sekunden Nachdenken
       niemand mehr gescrollt. Gedeckelt auf `GRENZEN.gesamtfristMs`, damit die
       Antwort den Relay noch erreicht — ein Schritt, der stattgefunden hat und
       als nicht stattgefunden gemeldet wird, wäre schlimmer als beides. */
    uhrBeginn += Math.min(
      Date.now() - gefragtUm,
      Math.max(0, GRENZEN.gesamtfristMs - eintrag.frist)
    );

    if (antwort === "nein") {
      melden({ typ: "link:protokoll", text: `Abgelehnt: ${eintrag.tut}` });
      /* Eine Ablehnung ist eine gültige Antwort und kein Fehler dieser
         Erweiterung. Sie geht als Beobachtung zurück; der Auftrag läuft
         weiter, der Agent plant anders. */
      return misslungen(id, cmd, "user_declined",
        "Der Nutzer hat diesen Schritt abgelehnt.",
        { hint: "Das ist kein Fehler. Plane anders oder frage den Nutzer, was er stattdessen möchte.", m: m() });
    }
    if (antwort !== "ja") {
      melden({ typ: "link:protokoll", text: `Ohne Antwort geblieben: ${eintrag.tut}` });
      const saetze = {
        keine_stelle: "Es war kein Fenster offen, in dem der Nutzer hätte zustimmen können.",
        besetzt: "Der Nutzer beantwortet gerade eine andere Frage.",
        frist: "Der Nutzer hat in der Zeit nicht geantwortet.",
      };
      return misslungen(id, cmd, "grant_required", saetze[antwort] || saetze.frist,
        { retryable: true, hint: "Erneut fragen oder den Auftrag zusammenfassen.", m: m() });
    }
  }

  /* 11. Und erst jetzt die Ausführung. */
  if (!aktiv || meineGeneration !== generation) {
    return misslungen(id, cmd, "session_beendet",
      "Die Browsersitzung wurde beendet, während ich gefragt habe.", { m: m() });
  }

  melden({ typ: "link:protokoll", text: `${eintrag.tut}: ${grund}` });

  const lage = {
    id,
    cmd,
    tabId,
    sitzung,
    kopf,
    ziel,
    plan,
    epoche,
    meta: m,
    restfrist: () => Math.max(1000, frist(eintrag, uhrBeginn)),
    /* Für jeden Aufruf an die Seite: dieselbe Restfrist, aber mit Abstand zum
       eigenen Wecker (siehe `SEITEN_RESERVE_MS`). */
    seitenfrist: () => Math.max(1000, frist(eintrag, uhrBeginn) - SEITEN_RESERVE_MS),
  };

  /* Die Uhr wird nach dem Rennen gelöscht. Ein stehengelassener Wecker hält
     den Service Worker am Leben, obwohl längst nichts mehr zu tun ist — und
     bei 25 Sekunden je Befehl summiert sich das zu einer Erweiterung, die nie
     schlafen geht. */
  let wecker = null;
  const uhr = new Promise((fertig) => {
    wecker = setTimeout(() => fertig(null), Math.max(1500, frist(eintrag, uhrBeginn)));
  });
  /* Sichtbar machen, dass jetzt gearbeitet wird — bei JEDEM Befehl, nicht nur
     bei denen mit Ziel. Steht nach der Freigabe und vor der Ausführung, genau
     wie der Zielzeiger: Ein abgelehnter Schritt bewegt weiterhin nichts. */
  await arbeitsZeigerFahren(tabId, cmd, lage.seitenfrist());

  let ergebnis;
  try {
    ergebnis = await Promise.race([AUSFUEHRUNG[cmd](rahmen, lage), uhr]);
  } finally {
    if (wecker) clearTimeout(wecker);
  }
  if (ergebnis) return ergebnis;

  /* Unsere Uhr läuft vor der des Relays ab. Damit bekommt der Agent eine
     Aussage statt eines nackten „keine Antwort vom Browser" (spec-01 §3.9). */
  return misslungen(id, cmd, "settle_timeout",
    "Die Seite ist in der Frist nicht fertig geworden.",
    { retryable: true, hint: "Kurz warten und noch einmal versuchen.", m: m() });
}

/* Wie lange dieser Befehl insgesamt haben darf — gerechnet ab seinem Eintreffen,
   nicht ab dem Beginn der Ausführung. Wartezeit in der Schlange ist Zeit, die
   der Relay ebenfalls mitzählt. */
function frist(eintrag, begonnen) {
  return eintrag.frist - FRIST_PUFFER_MS - (Date.now() - begonnen);
}

async function tabTitel(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return (tab && tab.title) || "";
  } catch (_) {
    return "";
  }
}

/* Die Einstellung „Große Sichtbarkeit" liegt im lokalen Speicher (Vorgabe an).
   Der Ausführer läuft im Hintergrunddienst und liest sie von dort, damit ein
   nach einer Navigation neu eingespielter Rahmen dieselbe Größe trägt wie der,
   den die Seitenleiste beim Sitzungsstart gesetzt hat. */
async function grosseSichtLesen() {
  try {
    const d = await chrome.storage.local.get("grosseSicht");
    return d.grosseSicht !== false;
  } catch (_) {
    return true;
  }
}
