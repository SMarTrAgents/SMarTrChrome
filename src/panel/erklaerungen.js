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
 */

/*
 * Warum die Erweiterung auf dieser Seite nicht arbeitet.
 * Die Schlüssel sind die Rückgabewerte von `net/rechte.js` → `sperrgrund`.
 */
export const SPERRE = {
  cloud: {
    titel: "Hier arbeite ich nicht, verbunden sind wir trotzdem",
    text:
      "Deine Anmeldung bekomme ich von dieser Seite automatisch; Konto und Guthaben sind " +
      "verbunden, da musst du nichts tun. Nur ARBEITEN darf ich auf der SMarTrAgents-Seite " +
      "selbst nicht. Das ist Absicht, damit sich niemand über diese Seite selbst eine " +
      "Freigabe erteilen kann. Öffne die Seite, die ich für dich bedienen oder lesen soll, " +
      "in einem anderen Tab und drücke dort auf Verbindung aufbauen.",
    knopf: "Verstanden",
  },
  browser: {
    titel: "Diese Seite gehört dem Browser",
    text:
      "Diese Art von Seite kann ich nicht lesen. Sie gehört dem Browser selbst. Öffne die " +
      "Seite, die ich für dich lesen soll, in einem normalen Tab und drücke dort auf " +
      "Verbindung aufbauen.",
    knopf: "Verstanden",
  },
};

/*
 * Der dritte Fall, und der einzige, in dem wirklich der Mensch entschieden
 * hat: Chrome hat gefragt, er hat Nein gesagt. Das ist weder Regel noch
 * Defekt — und wird deshalb auch nicht als Fehler benannt.
 */
export const FREIGABE_ABGELEHNT = {
  titel: "Freigabe abgelehnt",
  text:
    "Du hast die Freigabe für diese Seite abgelehnt. Ohne sie kann ich die Seite nicht lesen. " +
    "Das ist in Ordnung, du kannst es jederzeit neu versuchen.",
  knopf: "Noch einmal versuchen",
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
    titel: "Mir fehlt deine Anmeldung",
    text:
      "Ich habe deine Anmeldung noch nicht. Lade den SMarTrAgents-Tab einmal neu (F5), dann " +
      "bekomme ich sie automatisch.",
    knopf: "SMarTrAgents-Tab neu laden",
  },
  keine_anmeldung: {
    titel: "Zuerst anmelden",
    text:
      "Ich habe deine Anmeldung noch nicht, und es ist auch kein SMarTrAgents-Tab offen. " +
      "Melde dich in der Cloud an. Ich öffne dir auf Wunsch die Anmeldeseite.",
    knopf: "Anmeldeseite öffnen",
  },
};

/*
 * Was in der Guthabenzeile steht, solange keine Zahl da ist. Jede Lage hat
 * ihren eigenen Satz; ein Strich für alle drei wäre wieder das Verschweigen.
 */
export const GUTHABEN_LAGETEXT = {
  laedt: "Guthaben: wird geholt …",
  uebergabe_fehlt: "Guthaben: Anmeldung fehlt noch",
  keine_anmeldung: "Guthaben: nicht angemeldet",
};
