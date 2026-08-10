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
import { alteRechteAufraeumen } from "../net/rechte.js";
import { overlaySicherstellen } from "../net/seite.js";
import { CLOUD_URSPRUNG } from "../net/dienste.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
  /* Nach Installation oder Aktualisierung gibt es keine laufende Sitzung.
     Also darf es auch kein Seitenrecht geben. */
  alteRechteAufraeumen().catch(() => {});
  abzeichenAus();
});

/* Beim Browserstart dasselbe: Was jetzt noch an Erteilungen liegt, stammt aus
   einem Vorgang, der nicht sauber zu Ende gekommen ist — Absturz des Panels,
   getöteter Worker, hart geschlossener Browser. */
chrome.runtime.onStartup.addListener(() => {
  alteRechteAufraeumen().catch(() => {});
  abzeichenAus();
});

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
