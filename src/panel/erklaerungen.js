/*
 * SMarTrChrome — die Sätze, mit denen die Seitenleiste erklärt, warum etwas
 * nicht geht.
 *
 * Warum sie in einer eigenen Datei stehen und nicht mitten im panel.js:
 *
 *  1. `panel.js` hängt am DOM und lässt sich in der Prüfung nicht laden. Die
 *     Texte hier lassen sich laden — und damit prüfen, dass die Fälle
 *     wirklich unterscheidbar sind und nicht drei Varianten desselben
 *     Pauschalsatzes.
 *  2. Es sind Zusagen an den Nutzer, keine Ablaufsteuerung. Sie werden
 *     redigiert, nicht umprogrammiert.
 *
 * Drei Regeln, die diesen Texten ihre Form geben (Befund Inhaber 28.07.2026):
 *
 *  - Eine Regel ist kein Fehler. Wo die Erweiterung aus Absicht nicht
 *    arbeitet, steht keine Störung, sondern eine Erklärung — und sie sagt,
 *    was der Mensch stattdessen tun kann.
 *  - Kein Satz macht dem Nutzer einen Vorwurf und keiner tut so, als wäre
 *    etwas kaputt, das absichtlich so ist.
 *  - Jeder Satz nennt den nächsten Schritt. Ein „geht nicht" ohne Weg ist für
 *    jemanden, der vorlesen lässt, eine Sackgasse.
 *
 * Seit v3.5 (Vertrag §12) geht jeder dieser Sätze durch `t()`. Der deutsche
 * Wortlaut bleibt als zweiter Parameter im Quelltext stehen, und das ist
 * Absicht: `chrome.i18n.getMessage` gibt für einen fehlenden Schlüssel die
 * leere Zeichenkette zurück, also stünde hier sonst eine Erklärkarte ohne
 * Erklärung. `pruefung/sprache.test.mjs` hält Wortlaut und Katalog Zeile für
 * Zeile gegeneinander.
 */

import { t } from "./sprache.js";

/*
 * Die Sprachschicht wird hier durchgereicht, und zwar aus einem messbaren
 * Grund: Der Pruefstand von A-PANEL (pruefung/seitenleiste.test.mjs, Funktion
 * `alsSkript`) faehrt panel.js als klassisches Skript und ersetzt jede
 * Einfuhrzeile durch eine Attrappe. Fuer einen Pfad ohne Attrappe bricht er ab,
 * und `./sprache.js` hat dort keine — die Datei gehoert A-PANEL, nicht
 * A-SPRACHE. Bis dort eine Attrappe steht (siehe Bericht, `fremdbedarf`), holt
 * panel.js seine Worte und seine Sprachschicht aus derselben Tuer. Inhaltlich
 * passt das: Diese Datei IST die Textdatei der Seitenleiste.
 */
export { t, textEinsetzen, spracheAnwenden, sprechsprache, sprachkennung } from "./sprache.js";

/*
 * Warum die Erweiterung auf dieser Seite nicht arbeitet.
 * Die Schlüssel sind die Rückgabewerte von `net/rechte.js` → `sperrgrund`.
 */
export const SPERRE = {
  cloud: {
    titel: t("sperre_cloud_titel", "Hier arbeite ich nicht, verbunden sind wir trotzdem"),
    text: t(
      "sperre_cloud_text",
      "Deine Anmeldung bekomme ich von dieser Seite automatisch; Konto und Guthaben sind " +
        "verbunden, da musst du nichts tun. Nur ARBEITEN darf ich auf der SMarTrAgents-Seite " +
        "selbst nicht. Das ist Absicht, damit sich niemand über diese Seite selbst eine " +
        "Freigabe erteilen kann. Öffne die Seite, die ich für dich bedienen oder lesen soll, " +
        "in einem anderen Tab und drücke dort auf Mit diesem Tab verbinden.",
    ),
    knopf: t("sperre_cloud_knopf", "Verstanden"),
  },
  browser: {
    titel: t("sperre_browser_titel", "Diese Seite gehört dem Browser"),
    text: t(
      "sperre_browser_text",
      "Diese Art von Seite kann ich nicht lesen. Sie gehört dem Browser selbst. Öffne die " +
        "Seite, die ich für dich lesen soll, in einem normalen Tab und drücke dort auf " +
        "Mit diesem Tab verbinden.",
    ),
    knopf: t("sperre_browser_knopf", "Verstanden"),
  },
};

/*
 * Der dritte Fall, und der einzige, in dem wirklich der Mensch entschieden
 * hat: Chrome hat gefragt, er hat Nein gesagt. Das ist weder Regel noch
 * Defekt — und wird deshalb auch nicht als Fehler benannt.
 */
export const FREIGABE_ABGELEHNT = {
  titel: t("freigabe_abgelehnt_titel", "Freigabe abgelehnt"),
  text: t(
    "freigabe_abgelehnt_text",
    "Du hast die Freigabe für diese Seite abgelehnt. Ohne sie kann ich die Seite nicht lesen. " +
      "Das ist in Ordnung, du kannst es jederzeit neu versuchen.",
  ),
  knopf: t("freigabe_abgelehnt_knopf", "Noch einmal versuchen"),
};

/*
 * Der fehlende Ausweis, in zwei Lagen — und das ist der ganze Punkt.
 *
 * Die Cloud-Seite reicht den Ausweis beim Laden herüber (siehe net/konto.js).
 * Wer die Erweiterung installiert, WÄHREND der Cloud-Tab schon offen ist,
 * bekommt deshalb nie einen — obwohl er angemeldet ist. Beides sieht in der
 * Ablage gleich aus, ist für den Menschen aber etwas völlig anderes:
 *
 *   uebergabe_fehlt  — ein Cloud-Tab ist offen. Vermutlich angemeldet, nur die
 *                      Übergabe hat nie stattgefunden. Ein Neuladen genügt.
 *   keine_anmeldung  — kein Cloud-Tab offen. Aus Sicht der Erweiterung ist
 *                      niemand angemeldet; dafür gibt es die Anmeldekarte.
 *
 * Was hier NICHT steht: ein Strich. „Guthaben: —" ist keine Auskunft, sondern
 * das Verschweigen einer.
 */
export const AUSWEIS_FEHLT = {
  uebergabe_fehlt: {
    titel: t("ausweis_uebergabe_titel", "Mir fehlt deine Anmeldung"),
    text: t(
      "ausweis_uebergabe_text",
      "Ich habe deine Anmeldung noch nicht. Lade den SMarTrAgents-Tab einmal neu (F5), dann " +
        "bekomme ich sie automatisch.",
    ),
    knopf: t("ausweis_uebergabe_knopf", "SMarTrAgents-Tab neu laden"),
  },
  keine_anmeldung: {
    titel: t("ausweis_keine_titel", "Zuerst anmelden"),
    text: t(
      "ausweis_keine_text",
      "Ich habe deine Anmeldung noch nicht, und es ist auch kein SMarTrAgents-Tab offen. " +
        "Melde dich in der Cloud an. Ich öffne dir auf Wunsch die Anmeldeseite.",
    ),
    knopf: t("ausweis_keine_knopf", "Anmeldeseite öffnen"),
  },
};

/*
 * Was in der Guthabenzeile steht, solange keine Zahl da ist. Jede Lage hat
 * ihren eigenen Satz; ein Strich für alle drei wäre wieder das Verschweigen.
 *
 * `laedt` teilt sich den Schlüssel mit dem Anfangswert in panel.html: Dort
 * steht derselbe Satz, und zwei Schlüssel für einen Satz wären zwei Orte zum
 * Redigieren.
 */
export const GUTHABEN_LAGETEXT = {
  laedt: t("kopf_guthaben_laedt", "Guthaben: wird geholt …"),
  uebergabe_fehlt: t("kopf_guthaben_uebergabe", "Guthaben: Anmeldung fehlt noch"),
  keine_anmeldung: t("kopf_guthaben_keine", "Guthaben: nicht angemeldet"),
};

/*
 * Die drei Betriebsmodi in den Worten, die der Mensch zu hören bekommt.
 *
 * Die Schlüssel sind die drei Werte aus `net/befehle.js` → `MODI`; sie werden
 * hier nicht noch einmal eingetippt, sondern von `panel.js` gegen jene Liste
 * gehalten. Ein Modus ohne Text wäre ein Knopf ohne Aussage, ein Text ohne
 * Modus ein Versprechen ohne Gegenstück.
 *
 * Warum die Texte hier stehen und nicht im panel.js: Sie sind Zusagen, und
 * eine Zusage muss sich messen lassen, ohne dass ein Bildschirm dafür laufen
 * muss (siehe Kopf dieser Datei).
 *
 * `auskunft` sagt, was der Modus WIRKLICH ändert, und nichts darüber hinaus.
 * Der Unterschied zwischen `assist` und `auto` ist nach Vertrag §3.2 genau
 * einer: `auto` lässt die je Domain freigeschalteten weichen Klassen durch.
 * Sonst nichts. Ein Etikett, das mehr andeutet, wäre die teuerste Unwahrheit
 * in dieser Oberfläche.
 *
 * Die Etiketten teilen sich ihren Katalogschlüssel mit den drei Knöpfen in
 * panel.html. Das ist gewollt: Es ist derselbe Text am selben Schalter, und
 * zwei Schlüssel dafür wären zwei Fassungen desselben Wortes.
 */
export const MODUS_TEXT = {
  manual: {
    etikett: t("modus_manual", "Jeder Schritt einzeln"),
    auskunft: t(
      "modus_manual_auskunft",
      "Ich frage dich vor jedem Schritt, auch vor dem Lesen einer Seite.",
    ),
  },
  assist: {
    etikett: t("modus_assist", "Mitdenken"),
    auskunft: t(
      "modus_assist_auskunft",
      "Lesen, Klicken, Tippen und Blättern erledige ich allein, alles Weitere lege ich dir vor.",
    ),
  },
  auto: {
    etikett: t("modus_auto", "Selbständig"),
    auskunft: t(
      "modus_auto_auskunft",
      "Zusätzlich erledige ich das, was du für diese Website ausdrücklich freigeschaltet hast, ohne Rückfrage.",
    ),
  },
};

/*
 * Der Riegel, der in JEDEM Modus gilt — auch im selbständigen.
 *
 * Er steht bewusst neben dem Umschalter und nicht in einer Fußnote: Wer sich
 * die Seitenleiste vorlesen lässt, hört ihn dann im selben Atemzug mit den
 * drei Knöpfen. Genau diese Regel hat der Prüfsatz S4 für das Etikett
 * „Vollzugriff" schon einmal festgehalten.
 *
 * Der Satz nennt jede einzelne harte Klasse aus `net/befehle.js` → `HART`.
 * Das ist keine Aufzählung um der Vollständigkeit willen, sondern die Zusage
 * selbst: Was hier nicht steht, könnte der Mensch für abgeschaltet halten. Ein
 * Prüfsatz hält Klasse für Klasse dagegen, damit eine neue harte Klasse nicht
 * still an diesem Satz vorbeiwächst. Für die Übersetzung heißt das: Auch die
 * englische Fassung nennt alle sechs, sonst hebt sie die Zusage auf.
 */
export const MODUS_RIEGEL = t(
  "modus_riegel",
  "Zahlungen, Passwörter, Löschungen, Dateien, Browser-Berechtigungen und CAPTCHAs " +
    "lege ich dir in jedem Modus vor, auch im selbständigen.",
);

/*
 * Wer die Notbremse gezogen hat.
 *
 * Der Stopp ist in jedem Fall derselbe; nur der Satz sagt, wo gedrückt wurde.
 * Warum das zählt: Seit v3.5 gibt es den Stoppknopf im Schild am Tab
 * (`quelle: "schild"`), und wer ihn drückt, sieht die Seitenleiste
 * möglicherweise gar nicht. Bekäme er dort denselben Satz wie bei einem
 * Ablauf der Zeit, wüsste er nicht, ob sein Druck angekommen ist.
 * Ein Absender, der hier fehlt, endet im allgemeinen Satz aus `beenden` —
 * eine unbekannte Quelle darf keine Notbremse verschlucken.
 */
export const NOTBREMSE_SAETZE = Object.freeze({
  schild: t("notaus_schild", "Gestoppt über den Knopf im Tab. Der Agent steuert nicht mehr."),
  "esc-esc": t("notaus_esc", "Gestoppt mit Escape Escape. Der Agent steuert nicht mehr."),
  tastenkuerzel: t("notaus_tastenkuerzel", "Gestoppt über das Tastenkürzel. Der Agent steuert nicht mehr."),
  seitenleiste: t("notaus_seitenleiste", "Gestoppt. Der Agent steuert nicht mehr."),
});

/*
 * Was an der Stelle der Tab-Liste steht, wenn dort nichts zu wählen ist.
 *
 * Ein leerer Anker wäre ein Weg ohne Antwort: Der Mensch sieht eine
 * Überschrift und darunter nichts und weiß nicht, ob die Liste lädt, leer ist
 * oder kaputt. Beide Sätze nennen den nächsten Schritt.
 */
export const TAB_LISTE = {
  leer: {
    titel: t("tabliste_leer_titel", "Andere Fenster"),
    text: t(
      "tabliste_leer_text",
      "Gerade ist kein weiterer Tab offen, den ich bedienen könnte. Öffne die Seite, um die " +
        "es geht, in einem Tab; danach steht sie hier.",
    ),
  },
};
