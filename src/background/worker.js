/*
 * SMarTrChrome Beta — Service Worker.
 *
 * Aufgaben: Seitenleiste öffnen, Overlay in den Tab einspielen, Notbremse
 * weiterreichen — und seit dem Netzumbau die SMarTrLink-Verbindung halten.
 *
 * Warum die Verbindung hier liegt und nicht in der Seitenleiste: Die
 * Seitenleiste ist zu, sobald der Nutzer sie schließt. Eine laufende
 * Steuersitzung darf nicht davon abhängen, wo gerade ein Fenster offen ist.
 *
 * Rechte und Sitzungsdaten hält dieser Worker trotzdem nicht dauerhaft: Alles
 * liegt in chrome.storage.session und stirbt mit dem Browser. Stirbt der
 * Worker selbst, endet die Sitzung — sie wird nicht heimlich nachgebaut.
 *
 * Und weil sie endet, enden auch die Seitenrechte. Deshalb räumt dieser
 * Worker bei jedem Start alle Erteilungen weg, die nicht im Manifest stehen
 * (siehe net/rechte.js): Eine Erteilung, die einen Neustart überlebt, wäre
 * ein Recht ohne Sitzung — und damit ein Recht, das niemand mehr sieht.
 */

import * as link from "../net/link.js";
import * as chat from "../net/chat.js";
import * as konto from "../net/konto.js";
import * as werkstatt from "../net/werkstatt.js";
import * as protokollbuch from "../net/protokollbuch.js";
/* Der Ausführer als Modul, nicht als benanntes Feld: `run_workflow` bekommt
   seine Ausführung in derselben Runde (Vertrag v3.5 §8.2). Fehlt sie noch,
   soll der Dienstarbeiter trotzdem laden und eine Aussage liefern, statt gar
   nicht erst zu starten. */
import * as ausfuehrer from "../net/ausfuehrer.js";
import { alteRechteAufraeumen } from "../net/rechte.js";
import { overlaySicherstellen, anSeite } from "../net/seite.js";
import { CLOUD_URSPRUNG } from "../net/dienste.js";
import { MODI, MODUS_STANDARD, MODUS_ABLAGE, GRENZEN } from "../net/befehle.js";
import { REKORDER_ABLAGE } from "../net/werkstatt.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
  /* Nach Installation oder Aktualisierung gibt es keine laufende Sitzung.
     Also darf es auch kein Seitenrecht geben. */
  alteRechteAufraeumen().catch(() => {});
  aufzeichnungAufraeumen().catch(() => {});
  abzeichenAus();
});

/* Beim Browserstart dasselbe: Was jetzt noch an Erteilungen liegt, stammt aus
   einem Vorgang, der nicht sauber zu Ende gekommen ist — Absturz des Panels,
   getöteter Worker, hart geschlossener Browser. */
chrome.runtime.onStartup.addListener(() => {
  alteRechteAufraeumen().catch(() => {});
  aufzeichnungAufraeumen().catch(() => {});
  abzeichenAus();
});

/*
 * Reste einer Aufzeichnung wegräumen (§7.2, Ablage `sa_rekorder`).
 *
 * Sie liegt in `chrome.storage.local`, weil sie einen Seitenwechsel überleben
 * muss. Einen BROWSERSTART darf sie nicht überleben: Danach ist das
 * Inhaltsskript weg, die Seitenleiste zu, und die Schritte gehören zu Seiten,
 * die niemand mehr offen hat. Eine Aufzeichnung, die sich stumm wieder
 * einschaltet, ist eine Mitschrift, um die niemand gebeten hat.
 *
 * Ausdrücklich NICHT bei jedem Start des Dienstarbeiters: MV3 beendet ihn im
 * Leerlauf, und eine laufende Aufzeichnung wäre nach dreissig Sekunden weg.
 * Deshalb hängt es an `onStartup` und `onInstalled`, nicht am Modulrumpf.
 */
async function aufzeichnungAufraeumen() {
  try {
    await chrome.storage.local.remove(REKORDER_ABLAGE);
  } catch (_) {
    /* Ohne Ablage gibt es auch keinen Rest. */
  }
  await ausfuehrer.rekorderBilderLeeren().catch(() => {});
}

/* Das LIVE-Abzeichen am Symbol ist browserweite Oberfläche und überlebt einen
   Neustart des Hintergrunddienstes. Läuft keine Sitzung mehr, muss es weg —
   sonst behauptet das Symbol eine Steuerung, die es nicht gibt. */
function abzeichenAus() {
  try {
    chrome.action.setBadgeText({ text: "" });
  } catch (_) {
    /* ohne action-API bleibt der grüne Rahmen im Tab das Hauptsignal */
  }
}

/*
 * Bei JEDEM Start dieses Dienstarbeiters, nicht nur bei Installation und
 * Browserstart.
 *
 * MV3 beendet den Dienstarbeiter im Leerlauf. Wacht er wieder auf, ist die
 * Leitung zum Relay tot, die Sitzung in der Ablage aber noch da. Bis zum
 * 14.08.2026 fiel das erst dem 30-Sekunden-Wecker auf — und nur, wenn es ihn
 * überhaupt noch gab. `anlaufPruefen` beendet eine solche Sitzung sofort und
 * ehrlich, mit Widerruf beim Relay, und nimmt das Abzeichen weg. Es baut
 * ausdrücklich nichts wieder auf: Die Freigabe galt einer Verbindung, nicht
 * dem Recht, sie nachzubilden.
 *
 * Der Aufruf steht im Modulrumpf und damit im Produktivweg jedes Starts.
 */
link.anlaufPruefen().catch(() => {});

/* ------------------------------------------------------------------ *
 * Der Betriebsmodus je Tab (Vertrag v3.5 §2)
 *
 * Ablage `chrome.storage.session`, Schlüssel `sa_modus`. Er stirbt mit dem
 * Browser: Ein Modus, der einen Neustart überlebt, wäre eine Vollmacht, an die
 * sich niemand erinnert.
 *
 * **Gelesen und geschrieben wird die Ablage ausschliesslich in
 * `net/ausfuehrer.js`.** Dieser Dienstarbeiter reicht `modus:setzen` und
 * `modus:stand?` nur durch.
 *
 * Befund vom 14.08.2026 (Verzahnung): Bis hierher standen zwei Fassungen
 * derselben Ablage nebeneinander, und sie lasen dasselbe Feld verschieden. Für
 * diesen Dienstarbeiter war `schritte[42]` das eingestellte LIMIT, für den
 * Ausführer der bisher verbrauchte ZÄHLER. Wer in der Seitenleiste 200 Schritte
 * einstellte, schrieb damit „200 Schritte sind schon gelaufen" — der nächste
 * Befehl wäre mit `step_limit` gestorben. Deshalb hat die Ablage ab jetzt genau
 * einen Leser und einen Schreiber. Das eingestellte Limit heisst dort `grenze`,
 * der Zähler bleibt `schritte`.
 *
 * Nach aussen, in den Nachrichten aus §6, heisst das Limit weiterhin
 * `schritte` — so steht es im Vertrag, und so liest es die Seitenleiste.
 * ------------------------------------------------------------------ */

/** Was für diesen Tab gilt. Ohne Eintrag die Voreinstellung, nie „auto". */
async function modusStand(tabId) {
  const stand = await ausfuehrer.modusStand(tabId);
  return {
    modus: MODI.includes(stand.modus) ? stand.modus : MODUS_STANDARD,
    /* Das Limit, das für diesen Tab gilt. Der Vertrag nennt dieses Feld in
       `modus:stand?` `schritte`. */
    schritte: Number.isFinite(stand.grenze) ? stand.grenze : GRENZEN.schritteJeAuftrag,
    /* Was davon verbraucht ist. Neu und freiwillig: Die Seitenleiste kann
       damit anzeigen, wie weit ein Auftrag ist, ohne dafür raten zu müssen. */
    getan: Number.isFinite(stand.schritte) ? stand.schritte : 0,
  };
}

/**
 * Den Modus eines Tabs setzen.
 *
 * @returns {Promise<{ok:true, modus:string, schritte:number} | {ok:false, kennung:string, klartext:string}>}
 *
 * Ein unbekannter Modus wird abgelehnt und nicht auf die Voreinstellung
 * gebogen: Wer „auto" tippt und „assist" bekommt, glaubt, er habe etwas
 * eingestellt. Umgekehrt wäre eine stillschweigende Erhöhung noch schlimmer.
 */
async function modusSetzen(tabId, modus, schritte) {
  if (!Number.isInteger(tabId)) {
    return {
      ok: false,
      kennung: "tab_unbekannt",
      klartext: "Zu dieser Einstellung fehlt der Tab, für den sie gelten soll.",
    };
  }
  if (!MODI.includes(modus)) {
    return {
      ok: false,
      kennung: "modus_unbekannt",
      klartext: `Diesen Modus kenne ich nicht. Möglich sind ${MODI.join(", ")}.`,
    };
  }

  /* Das Schrittlimit ist in der Seitenleiste einstellbar (§5), der Deckel von
     500 ist es nicht. Durchgesetzt wird er dort, wo die Ablage geschrieben
     wird, damit er nicht an zwei Stellen steht. */
  const ergebnis = await ausfuehrer.modusSetzen(tabId, modus, schritte);
  if (!ergebnis.ok) {
    return {
      ok: false,
      kennung: "ablage_fehler",
      klartext: "Die Einstellung liess sich nicht merken. Bitte versuche es noch einmal.",
    };
  }
  return { ok: true, ...(await modusStand(tabId)) };
}

/*
 * Overlay bei Bedarf einspielen. Braucht die Freigabe für diesen Ursprung,
 * die der Nutzer im Verbindungsdialog erteilt hat.
 *
 * Der Weg selbst liegt seit dem Ausführer in `net/seite.js` — er wird jetzt
 * von zwei Stellen gebraucht: von der Seitenleiste beim Aufbau und vor jedem
 * Befehl des Agenten, weil das Inhaltsskript jede Navigation nicht überlebt.
 * Zwei Kopien desselben Weges wären zwei Stellen, an denen die Sperre des
 * Freigabe-Ursprungs (DRAHTFORMAT §7.3, Punkt 2) fehlen kann.
 */

/*
 * Kommt diese Nachricht aus unserer eigenen Oberfläche — Seitenleiste oder
 * Menü — und nicht aus einem Tab?
 *
 * `absender.tab` ist gesetzt, sobald ein Inhaltsskript spricht; bei der
 * Seitenleiste fehlt es. Chrome füllt beide Felder selbst, keins davon ist aus
 * der Seite heraus setzbar.
 *
 * Warum das gebraucht wird: `overlay:einspielen` und `link:verbinden` sind
 * Befehle mit Reichweite. Ersterer spielt ein Skript in eine frei gewählte
 * `tabId` — ein Inhaltsskript könnte sich damit aus dem Tab, in dem es steckt,
 * in jeden anderen ausbreiten. Overlay.js sendet ausschließlich `notbremse`
 * (overlay.js:235); alles Übrige stammt aus der Seitenleiste. Also wird genau
 * das zur Bedingung — eine Positivliste, keine Aufzählung des Verbotenen.
 */
function ausEigenerOberflaeche(absender) {
  return !!absender && absender.id === chrome.runtime.id && !absender.tab;
}

/* Ein Satz für alle Absagen dieser Art, damit sie überall gleich klingen. Ein
   zweiter Versuch hilft hier nicht, also wird er auch nicht empfohlen
   (Regel Inhaber 28.07.2026). */
const ABSAGE_ABSENDER = Object.freeze({
  ok: false,
  kennung: "absender_ungueltig",
  klartext:
    "Diese Anfrage kam nicht aus der Seitenleiste. Aus Sicherheitsgründen habe ich sie verworfen.",
});

/*
 * Das Aufzeichnungsskript (§7.1, §7.2).
 *
 * Es steht bewusst nicht im Manifest: Eingespielt wird erst, wenn der Mensch
 * die Aufzeichnung startet, nicht schon beim Besuch einer Seite. Erst wird
 * gefragt, ob schon jemand da ist; antwortet niemand, wird eingespielt und
 * genau einmal nachgefragt. Die Reihenfolge der Dateien ist verbindlich:
 * `selektor.js` schreibt nach `globalThis.SMARTR_SELEKTOR` und muss vor
 * `rekorder.js` laufen.
 */
const REKORDER_DATEIEN = ["src/content/selektor.js", "src/content/rekorder.js"];

async function rekorderSenden(tabId, nachricht) {
  if (!Number.isInteger(tabId)) return { ok: false, fehler: "tab_unbekannt" };

  const erster = await anSeite(tabId, nachricht, 4000);
  if (erster.ok) return erster;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: REKORDER_DATEIEN,
    });
  } catch (_) {
    /* Kein Recht für diesen Ursprung, oder eine Seite, in die Chrome nichts
       einspielt (Web Store, PDF-Betrachter, Fehlerseite). Für den Aufrufer ist
       das dasselbe: Hier kann nicht aufgezeichnet werden. */
    return { ok: false, fehler: "einspielen_fehlgeschlagen" };
  }
  return anSeite(tabId, nachricht, 4000);
}

/*
 * Einen gespeicherten Ablauf abspielen (§7.3).
 *
 * **Durch dieselbe Befehlsschleife wie ein Agentenbefehl.** Das ist keine
 * Bequemlichkeit, sondern die Bedingung, unter der es diesen Knopf überhaupt
 * geben darf: Ein Workflow ist eine Reihe von Befehlen, keine zweite Tür. Er
 * umgeht weder Modus noch Freigabe noch Bereichsprüfung noch Verdeckungswache,
 * weil er denselben Weg nimmt und nicht einen eigenen daneben.
 *
 * Einen `agent` trägt dieser Rahmen NICHT. Hier steuert kein Agent, hier hat
 * ein Mensch auf „Abspielen" gedrückt, und ein erfundener Agentenname stünde
 * hinterher im Protokollbuch als Tatsache.
 */
async function ablaufSpielen(id, params) {
  const kennung = typeof id === "string" ? id : "";
  if (typeof ausfuehrer.befehlAusfuehren !== "function") {
    return {
      ok: false,
      kennung: "nicht_gebaut",
      klartext: "Abläufe abspielen kann diese Fassung noch nicht.",
    };
  }

  const sitzung = await link.zustand();
  const ergebnis = await ausfuehrer.befehlAusfuehren(
    {
      /* Die Kennung des Ablaufs ist zugleich die Kennung dieses Laufes. Der
         Weg über den Relay hat dafür zwei getrennte Felder; hier ist keiner
         dazwischen, der eine zweite vergeben könnte. */
      id: kennung,
      cmd: "run_workflow",
      /* Der Satz, der dem Menschen vorgelesen wird. Er ist Pflicht, und er
         stammt an dieser Stelle von uns, weil kein Agent gefragt hat. */
      reason: `Ich spiele den gespeicherten Ablauf ${kennung} ab.`,
      params: params && typeof params === "object" && !Array.isArray(params) ? params : {},
    },
    sitzung && sitzung.verbunden ? sitzung : {}
  );

  return {
    ok: !!(ergebnis && ergebnis.success),
    kennung: ergebnis && ergebnis.error ? ergebnis.error.code : null,
    klartext:
      ergebnis && ergebnis.error
        ? ergebnis.error.message
        : "Der Ablauf ist durchgelaufen.",
    daten: (ergebnis && ergebnis.data) || null,
  };
}

chrome.runtime.onMessage.addListener((n, absender, antwort) => {
  if (!n || typeof n.typ !== "string") return false;

  if (n.typ === "overlay:einspielen") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({ ok: false, fehler: "absender_ungueltig" });
      return false;
    }
    overlaySicherstellen(n.tabId).then(antwort);
    return true;
  }

  if (n.typ === "notbremse") {
    /* Kommt aus der Seite (Esc Esc). Die Seitenleiste entscheidet, was das
       für die Anzeige bedeutet — die Verbindung wird hier sofort gekappt,
       ohne auf sie zu warten. */
    link.trennen("notbremse").catch(() => {});
    chrome.runtime
      .sendMessage({ typ: "notbremse:an-panel", quelle: n.quelle, tabId: absender?.tab?.id })
      .catch(() => {});
    antwort({ ok: true });
    return true;
  }

  /* Die Seitenleiste hat Ausweis und Ticket besorgt und übergibt beides.
     Das Ticket wird nie gespeichert — es lebt nur in dieser Nachricht und
     in der einen Minute, die es gültig ist. `ursprungMuster` kommt mit,
     damit der Worker das Seitenrecht auch dann zurückgeben kann, wenn die
     Seitenleiste das Sitzungsende nicht mehr erlebt. */
  if (n.typ === "link:verbinden") {
    if (!ausEigenerOberflaeche(absender)) {
      /* Ehrlich benennen, was passiert ist: Der Absender war nicht die
         eigene Oberfläche. Ein zweiter Versuch hilft hier nicht — also wird
         er auch nicht empfohlen (Regel Inhaber 28.07.). */
      antwort({
        ok: false,
        kennung: "absender_ungueltig",
        klartext:
          "Diese Anfrage kam nicht aus der Seitenleiste. Aus Sicherheitsgründen habe ich sie verworfen.",
      });
      return false;
    }
    link
      .verbinden({
        ticket: n.ticket,
        ausweis: n.ausweis,
        ursprungMuster: n.ursprungMuster || null,
        /* Der Tab, in dem gearbeitet werden darf. Er kommt aus der eigenen
           Oberfläche — die Prüfung oben stellt sicher, dass hier kein
           Inhaltsskript einen fremden Tab benennen kann. */
        tabId: Number.isInteger(n.tabId) ? n.tabId : null,
      })
      .then((sitzung) => antwort({ ok: true, sitzung }))
      .catch((fehler) =>
        /* Der konkrete Grund reist mit bis in die Störungszeile der
           Seitenleiste. Nur wenn wirklich keiner da ist, bleibt der ehrliche
           Satz, dass es an der Erweiterung lag — nicht am Nutzer. */
        antwort({
          ok: false,
          kennung: (fehler && fehler.kennung) || "unerwartet",
          klartext:
            fehler && fehler.klartext
              ? fehler.klartext
              : "In der Erweiterung ist etwas schiefgegangen. Die Verbindung ist nicht zustande gekommen — das liegt an uns, nicht an dir.",
        })
      );
    return true;
  }

  /* Der Chat: Frage an den Agenten losschicken. Das Abholen der Antwort
     läuft hier im Worker weiter (net/chat.js), auch wenn die Seitenleiste
     zwischendurch zugeht — sie bekommt das Ergebnis als `chat:antwort`. */
  if (n.typ === "chat:senden") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({
        ok: false,
        kennung: "absender_ungueltig",
        klartext:
          "Diese Anfrage kam nicht aus der Seitenleiste. Aus Sicherheitsgründen habe ich sie verworfen.",
      });
      return false;
    }
    chat
      /* Der Modus kommt aus der Seitenleiste und reist bis in den Netz-Body
         (net/chat.js): Normal Mode = kein model_id, SMarTrMode = die feste
         Kennung. Ohne Angabe bleibt es beim Normal Mode. */
      .chatStarten({
        text: n.text,
        contextId: n.contextId || null,
        ausweis: n.ausweis || null,
        modus: n.modus || "normal",
      })
      .then(antwort)
      .catch(() =>
        antwort({
          ok: false,
          kennung: "unerwartet",
          klartext:
            "In der Erweiterung ist etwas schiefgegangen. Deine Frage ist nicht angekommen — das liegt an uns, nicht an dir.",
        })
      );
    return true;
  }

  /* Ein beim Server noch offener Auftrag, den die Seitenleiste über
     GET /chat/active gefunden hat, kommt zurück in die Obhut des Workers. */
  if (n.typ === "chat:fortsetzen") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({ ok: false });
      return false;
    }
    chat
      .chatFortsetzen({ taskId: n.taskId, contextId: n.contextId || null, ausweis: n.ausweis || null })
      .then(antwort)
      .catch(() => antwort({ ok: false }));
    return true;
  }

  if (n.typ === "chat:zustand?") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({ laeuft: false });
      return false;
    }
    chat.chatZustand().then(antwort);
    return true;
  }

  /* Neues Gespräch: laufenden Botengang beenden, Auftrag beim Server
     stoppen. Abrüsten darf großzügiger sein als Anrüsten — aber auch das
     nur aus der eigenen Oberfläche. */
  if (n.typ === "chat:neu") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({ ok: false });
      return false;
    }
    chat.chatAbbrechen().then(antwort);
    return true;
  }

  /* Verlängern („Unbegrenzt"): Die Seitenleiste hat einen vollständigen
     Freigabeweg durchlaufen und übergibt das frische Ticket. Dieselbe
     Absenderprüfung wie beim Verbinden — es ist derselbe Rang von Befehl. */
  if (n.typ === "link:verlaengern") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({
        ok: false,
        kennung: "absender_ungueltig",
        klartext:
          "Diese Anfrage kam nicht aus der Seitenleiste. Aus Sicherheitsgründen habe ich sie verworfen.",
      });
      return false;
    }
    link
      .verlaengernMit({ ticket: n.ticket, ausweis: n.ausweis })
      .then((sitzung) => antwort({ ok: true, sitzung }))
      .catch((fehler) =>
        antwort({
          ok: false,
          kennung: (fehler && fehler.kennung) || "unerwartet",
          klartext:
            fehler && fehler.klartext
              ? fehler.klartext
              : "Die Verlängerung ist fehlgeschlagen. Die Verbindung endet zur angezeigten Zeit.",
        })
      );
    return true;
  }

  /* Trennen ist eine Abrüstung und darf deshalb großzügiger sein als
     Verbinden — aber der Widerruf beim Relay reist mit dem Ausweis, und den
     nimmt der Worker nur aus der eigenen Oberfläche entgegen. */
  if (n.typ === "link:trennen") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({ ok: false });
      return false;
    }
    link
      .trennen(n.grund || "nutzer", n.ausweis || null)
      .then(() => antwort({ ok: true }))
      .catch(() => antwort({ ok: false }));
    return true;
  }

  if (n.typ === "link:zustand?") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({ verbunden: false });
      return false;
    }
    link.zustand().then(antwort);
    return true;
  }

  /*
   * Die Seitenleiste ist zugegangen oder wieder aufgegangen. Das ist eine
   * Zustandsmeldung, keine Anweisung: Die Sitzung läuft weiter, nur sieht
   * gerade niemand zu. Der Dienst merkt es sich, damit die Freigabe je Schritt
   * weiß, dass sie niemanden erreicht, und damit das Symbol es anzeigen kann.
   */
  if (n.typ === "link:unbeaufsichtigt") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({ ok: false });
      return false;
    }
    link
      .unbeaufsichtigtSetzen(n.an === true)
      .then(() => antwort({ ok: true }))
      .catch(() => antwort({ ok: false }));
    return true;
  }

  /* ---------------------------------------------------------------- *
   * Die Nachrichten aus Vertrag v3.5 §6
   *
   * Jede einzelne davon durchläuft `ausEigenerOberflaeche()`. Ohne Ausnahme:
   * `notbremse` und `rekorder:stand` sind die beiden, die aus einem Tab kommen
   * dürfen, und sie stehen an ihrer eigenen Stelle. Alles Übrige stellt etwas
   * ein, spielt etwas ab oder gibt etwas heraus — eine besuchte Seite darf
   * nichts davon.
   *
   * Warum das eine Positivliste ist und keine Aufzählung des Verbotenen: Ein
   * Inhaltsskript läuft in einer fremden Seite. Was von dort kommt, wird
   * gemessen, nicht geglaubt. `absender.tab` setzt Chrome selbst, aus der Seite
   * heraus ist es nicht fälschbar.
   * ---------------------------------------------------------------- */

  if (n.typ === "modus:setzen") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort(ABSAGE_ABSENDER);
      return false;
    }
    modusSetzen(n.tabId, n.modus, n.schritte)
      .then(antwort)
      .catch(() =>
        antwort({
          ok: false,
          kennung: "unerwartet",
          klartext:
            "In der Erweiterung ist etwas schiefgegangen. Die Einstellung ist nicht angekommen, das liegt an uns.",
        })
      );
    return true;
  }

  if (n.typ === "modus:stand?") {
    if (!ausEigenerOberflaeche(absender)) {
      /* Auch die Auskunft ist eine Auskunft. Sie verrät, wie weit dieser
         Browser gerade freigeschaltet ist, und geht deshalb nur an die eigene
         Oberfläche. Die Voreinstellung ist die vorsichtige. */
      antwort({ modus: MODUS_STANDARD, schritte: GRENZEN.schritteJeAuftrag });
      return false;
    }
    modusStand(Number.isInteger(n.tabId) ? n.tabId : -1)
      .then(antwort)
      .catch(() => antwort({ modus: MODUS_STANDARD, schritte: GRENZEN.schritteJeAuftrag }));
    return true;
  }

  /* Der Stoppknopf der Seitenleiste. Derselbe Weg wie Esc Esc im Tab und
     Alt+Umschalt+S, nur mit einem anderen Absender. */
  if (n.typ === "link:notaus") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort(ABSAGE_ABSENDER);
      return false;
    }
    link.trennen("notbremse").catch(() => {});
    chrome.runtime
      .sendMessage({ typ: "notbremse:an-panel", quelle: n.grund || "seitenleiste" })
      .catch(() => {});
    antwort({ ok: true });
    return true;
  }

  if (n.typ === "rekorder:start" || n.typ === "rekorder:stop") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort(ABSAGE_ABSENDER);
      return false;
    }
    rekorderSenden(n.tabId, { typ: n.typ, tabId: n.tabId })
      .then((lage) => {
        if (!lage.ok) {
          antwort({
            ok: false,
            kennung: lage.fehler || "kein_empfaenger",
            klartext:
              "Auf dieser Seite kann ich nicht aufzeichnen. Öffne bitte eine gewöhnliche Webseite und versuche es dort.",
          });
          return;
        }
        antwort({ ok: true, ...(lage.antwort || {}) });
      })
      .catch(() =>
        antwort({
          ok: false,
          kennung: "unerwartet",
          klartext: "In der Erweiterung ist etwas schiefgegangen. Die Aufzeichnung läuft nicht, das liegt an uns.",
        })
      );
    return true;
  }

  /* Das Miniaturbild zu einem aufgezeichneten Schritt (§7.2).
   *
   * Sie ist die DRITTE Nachricht, die aus einem Tab kommen darf, neben
   * `notbremse` und `rekorder:stand`. Sie darf es, weil sie nichts einstellt
   * und nichts auslöst: Der Rekorder nennt Name, Nummer und Rechteck, die
   * Aufnahme macht der Ausführer.
   *
   * Der Tab kommt von Chrome (`absender.tab.id`) und ausdrücklich NICHT aus
   * der Nutzlast. Sonst könnte ein Inhaltsskript im Hintergrund die Seite
   * fotografieren lassen, die gerade vorn steht — `captureVisibleTab` nimmt
   * den sichtbaren Tab auf, nicht den genannten. Der Ausführer prüft das ein
   * zweites Mal, unmittelbar vor der Aufnahme. */
  if (n.typ === "rekorder:bild") {
    const ausTab = absender && absender.tab ? absender.tab.id : null;
    if (!Number.isInteger(ausTab)) {
      /* Aus der Seitenleiste kommt kein Bild: Dort steht keine Aufzeichnung,
         die eines brauchte. */
      antwort(ABSAGE_ABSENDER);
      return false;
    }
    ausfuehrer
      .rekorderBild(ausTab, { name: n.name, nr: n.nr, anlass: n.anlass, rect: n.rect })
      .then(antwort)
      .catch(() =>
        antwort({
          ok: false,
          kennung: "unerwartet",
          klartext: "Das Bild ist nicht entstanden, das liegt an uns.",
        })
      );
    return true;
  }

  /* Der Zählerstand der Aufzeichnung kommt AUS dem Tab und gehört in die
     Seitenleiste. Er ist neben `notbremse` und `rekorder:bild` die einzige
     Nachricht, die ein Inhaltsskript absetzen darf: Sie stellt nichts ein und
     löst nichts aus, sie sagt nur, wie viele Schritte bisher aufgezeichnet
     wurden. */
  if (n.typ === "rekorder:stand") {
    chrome.runtime
      .sendMessage({
        typ: "rekorder:stand",
        anzahl: Number.isFinite(Number(n.anzahl)) ? Math.max(0, Math.floor(Number(n.anzahl))) : 0,
        laeuft: n.laeuft === true,
        /* Aus welchem Tab, setzt Chrome, nicht die Seite. */
        tabId: absender && absender.tab ? absender.tab.id : null,
      })
      .catch(() => {});
    antwort({ ok: true });
    return true;
  }

  if (n.typ === "werkbank:liste") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({ workflows: [] });
      return false;
    }
    werkstatt
      .workflowsLesen()
      .then((workflows) => antwort({ workflows }))
      .catch(() => antwort({ workflows: [] }));
    return true;
  }

  if (n.typ === "werkbank:schreiben") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort(ABSAGE_ABSENDER);
      return false;
    }
    werkstatt
      .workflowSchreiben(n.workflow)
      .then((ergebnis) =>
        antwort(
          ergebnis.ok
            ? { ok: true, workflow: ergebnis.workflow }
            : { ok: false, kennung: ergebnis.code, klartext: ergebnis.satz, hinweis: ergebnis.hinweis }
        )
      )
      .catch(() =>
        antwort({
          ok: false,
          kennung: "unerwartet",
          klartext: "In der Erweiterung ist etwas schiefgegangen. Der Ablauf ist nicht gespeichert, das liegt an uns.",
        })
      );
    return true;
  }

  if (n.typ === "werkbank:loeschen") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort(ABSAGE_ABSENDER);
      return false;
    }
    werkstatt
      .workflowLoeschen(typeof n.id === "string" ? n.id : "")
      .then((ergebnis) =>
        antwort(
          ergebnis.ok
            ? { ok: true, id: ergebnis.id }
            : { ok: false, kennung: ergebnis.code, klartext: ergebnis.satz, hinweis: ergebnis.hinweis }
        )
      )
      .catch(() =>
        antwort({
          ok: false,
          kennung: "unerwartet",
          klartext: "In der Erweiterung ist etwas schiefgegangen. Der Ablauf steht noch da, das liegt an uns.",
        })
      );
    return true;
  }

  if (n.typ === "werkbank:spielen") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort(ABSAGE_ABSENDER);
      return false;
    }
    ablaufSpielen(n.id, n.params)
      .then(antwort)
      .catch(() =>
        antwort({
          ok: false,
          kennung: "unerwartet",
          klartext: "In der Erweiterung ist etwas schiefgegangen. Der Ablauf ist nicht gelaufen, das liegt an uns.",
        })
      );
    return true;
  }

  if (n.typ === "buch:lesen") {
    if (!ausEigenerOberflaeche(absender)) {
      /* Das Buch nennt Adressen, auf denen gearbeitet wurde. Eine besuchte
         Seite erführe daraus, wo der Mensch sonst noch war. */
      antwort({ eintraege: [] });
      return false;
    }
    protokollbuch
      .lesen({
        von: Number.isFinite(Number(n.von)) ? Number(n.von) : 0,
        bis: Number.isFinite(Number(n.bis)) ? Number(n.bis) : Infinity,
      })
      .then((eintraege) => antwort({ eintraege }))
      .catch(() => antwort({ eintraege: [] }));
    return true;
  }

  if (n.typ === "buch:ausgeben") {
    if (!ausEigenerOberflaeche(absender)) {
      antwort({ json: "" });
      return false;
    }
    protokollbuch
      .ausgeben()
      .then((json) => antwort({ json }))
      .catch(() => antwort({ json: "" }));
    return true;
  }

  return false;
});

/*
 * Der Übergabekanal für den Alltags-Ausweis.
 *
 * Nur die Cloud-Seite kann hier sprechen (Manifest: `externally_connectable`),
 * und sie spricht von sich aus — die Erweiterung holt nichts. Genau darum
 * geht es: Ein Skriptrecht der Erweiterung im Cloud-Ursprung würde die
 * Herkunftsbindung von POST /confirm wertlos machen (DRAHTFORMAT §7.3), ein
 * Kanal in diese Richtung tut das nicht.
 *
 * Geprüft wird trotzdem: Chrome liefert `sender.origin` selbst; er ist nicht
 * fälschbar. Alles, was nicht byteweise der Cloud-Ursprung ist, fliegt raus.
 */
chrome.runtime.onMessageExternal.addListener((n, absender, antwort) => {
  if (!absender || absender.origin !== CLOUD_URSPRUNG) {
    antwort({ ok: false, error: "herkunft_ungueltig" });
    return false;
  }

  if (!n || typeof n.typ !== "string") {
    antwort({ ok: false, error: "unbekannt" });
    return false;
  }

  if (n.typ === konto.UEBERGABE_AUSWEIS) {
    /* Nur eine Zeichenkette kommt überhaupt in die Prüfung. Alles andere wäre
       ein Aufrufer, der etwas anderes meint als wir — und stillschweigend
       nach Text zu wandeln, was keiner ist, hieße raten. */
    if (typeof n.token !== "string") {
      antwort({ ok: false, error: "token_ungueltig" });
      return false;
    }
    konto
      .ausweisUebernehmen(n.token)
      .then((ausweis) => {
        if (ausweis) chrome.runtime.sendMessage({ typ: "konto:ausweis" }).catch(() => {});
        antwort({ ok: !!ausweis });
      })
      .catch(() => antwort({ ok: false }));
    return true;
  }

  if (n.typ === konto.UEBERGABE_ABMELDEN) {
    konto
      .ausweisVerwerfen()
      .then(() => {
        /* Die Seitenleiste hält den Ausweis auch in ihrem eigenen Zustand.
           Ohne diese Nachricht zeigte sie nach dem Abmelden weiter
           „Angemeldet als …" und schickte ein Token los, das die Ablage
           gerade verlassen hat. Gelöscht ist erst, was überall gelöscht ist. */
        chrome.runtime.sendMessage({ typ: "konto:abgemeldet" }).catch(() => {});
        antwort({ ok: true });
      })
      .catch(() => antwort({ ok: false }));
    return true;
  }

  antwort({ ok: false, error: "unbekannt" });
  return false;
});

/* Der Wecker ist das Netz unter dem Herzschlag: Er baut nichts wieder auf,
   er stellt nur fest, ob die Verbindung noch steht. */
chrome.alarms.onAlarm.addListener((wecker) => {
  if (wecker.name === link.WECKER_NAME) link.wacheLaufen().catch(() => {});
  if (wecker.name === chat.CHAT_WECKER_NAME) chat.wacheLaufen().catch(() => {});
});

chrome.commands.onCommand.addListener((befehl) => {
  if (befehl === "notbremse") {
    link.trennen("notbremse").catch(() => {});
    chrome.runtime
      .sendMessage({ typ: "notbremse:an-panel", quelle: "tastenkuerzel" })
      .catch(() => {});
  }
});
