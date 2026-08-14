/*
 * SMarTrChrome — die geschlossene Befehlsliste und alles, was sich ohne
 * Browser entscheiden lässt.
 *
 * Warum diese Datei getrennt vom Ausführer steht: Hier liegt nichts, was
 * `chrome.*` braucht. Damit ist der gesamte Entscheidungsteil — welcher Befehl
 * überhaupt existiert, welche Stufe er verlangt, ob ein Ziel im freigegebenen
 * Bereich liegt, wie groß ein Textbaum werden darf — ohne Browser prüfbar.
 * Ein Gate, das man nicht prüfen kann, ist ein Gate, das man nicht hat.
 *
 * Drei Grundsätze, die jede Zeile hier bestimmen:
 *
 *  1. **Positivliste.** Was nicht in `BEFEHLE` steht, wird nicht ausgeführt —
 *     ganz gleich, was der Relay für erlaubt hält. Der Relay lässt jeden
 *     unbekannten Befehl auf die Stufe `full` fallen; `read_file` und
 *     `list_dir` stehen dort dagegen auf `read` und kämen in einer
 *     Lesesitzung durch (werkzeuge.md §4.3). Dass heute nichts passiert,
 *     hängt allein daran, dass die Erweiterung diese Befehle nicht kennt.
 *     Das ist eine Verteidigungslinie zu wenig — hier steht sie ausdrücklich.
 *  2. **Der Server darf die Stufe nur einschränken, nie erweitern.** Die
 *     Erweiterung prüft die Stufe selbst noch einmal (spec-01 §5.4), nach dem
 *     Vorbild des Desktop-Clients (`connector.rs`, „Client vertraut dem Server
 *     nicht").
 *  3. **Alles, was von der Seite kommt, ist unbekannter Text.** Rollen, Namen
 *     und Zustände werden hier gefiltert, gekürzt und von Steuerzeichen
 *     befreit, bevor irgendetwas davon in einen Rahmen für den Agenten gerät.
 */

/*
 * Die EINE Messform. Sie steht unter `src/gemeinsam/`, weil dieselbe Datei
 * auch als klassisches Inhaltsskript in die besuchte Seite gespielt wird —
 * ein Inhaltsskript kann `src/net/*.js` nicht importieren, und zwei
 * Abschriften derselben Sicherheitszusage sind seit Festlegung F4 verboten.
 * Die vollständige Begründung steht im Kopf jener Datei.
 */
import { messtext, messrand, messvarianten, messweg, anzeigeform } from "./messform.js";

/* --------------------------------------------------------------------- *
 * Die Befehlstabelle
 *
 * `stufe`  — Mindeststufe der Sitzung (DRAHTFORMAT §5.3: aus `auth_ok`).
 * `frist`  — eigene Uhr der Erweiterung in Millisekunden. Sie läuft immer
 *            FRÜHER ab als die des Relays (spec-01 §3.9), damit im Zweifel ein
 *            sprechender Fehler ankommt statt eines nackten Zeitablaufs.
 *
 *            Das ist ausschließlich MASCHINENZEIT: wie lange der Browser
 *            arbeiten darf, nachdem der Mensch zugestimmt hat. Die Bedenkzeit
 *            des Menschen steht nicht hier, sondern in `GRENZEN.bedenkzeitMs` —
 *            Befund M3 vom 29.07.2026, siehe dort.
 * `freigabe` — „schritt" = Rückfrage im Schrittmodus, „immer" = Rückfrage auch
 *            in der Automatik.
 *
 *            Bis 0.5.1 stand hier überall „immer", auch bei `readPage` und
 *            `scroll`. Das war als vorübergehende Strenge gedacht und hatte
 *            zwei Wirkungen, die niemand wollte: Der Schrittmodus der Sitzung
 *            war damit wirkungslos, und bei geschlossener Seitenleiste
 *            scheiterte JEDER Befehl an `grant_required`, auch reines Lesen.
 *            Arbeit im Hintergrund war dadurch baulich unmöglich.
 *
 *            Seit 0.5.2 steht überall „schritt". Damit entscheidet allein der
 *            Schrittmodus der Sitzung, und der ist doppelt gesichert: Der
 *            Mensch muss „selbständig" ausdrücklich wählen, und die Gegenstelle
 *            muss den Selbständig-Modus überhaupt erteilen, sonst fällt die
 *            Sitzung dort auf Einzelfreigabe zurück. Wer
 *            nichts wählt, wird weiterhin bei jedem Schritt gefragt.
 *            Unberührt davon bleibt, was gar nicht erst gehen darf: Passwort-,
 *            Karten- und Einmalcodefelder werden nie ausgelesen und nie
 *            befüllt, in keinem Modus (spec-01 V10).
 * `tut`    — der Satz, mit dem der Mensch gefragt wird. Er stammt aus unseren
 *            eigenen Worten; Text von der besuchten Seite kommt dort nie hinein.
 *
 * Seit dem Ausbau vom 29.07.2026 gibt es die Stufe „Bedienen": `click` und
 * `type` stehen auf der Liste, mit Stufe `write` und Freigabe „immer" — jeder
 * einzelne Klick und jede Eingabe geht durch die Rückfrage beim Menschen,
 * unabhängig vom Schrittmodus der Sitzung. Das ist der Entscheid des Inhabers
 * vom 28.07.: Die Verbindung ist einfach, die Schutztür ist die Einzelfreigabe.
 *
 * Nachtrag vom 29.07.2026 (zweiter Teil): Die Liste ist jetzt vollständig —
 * `extract`, `waitFor`, `screenshot`, `navigate`, `back` und `select` sind
 * dazugekommen. Damit kennt die Erweiterung genau die dreizehn Namen, die der
 * Relay durchlässt, und keinen mehr.
 *
 * Drei Namen aus spec-01 §5.2 stehen hier ERSATZLOS gestrichen, und zwar mit
 * derselben Begründung, die auch im Relay und im Werkzeug steht:
 *
 *   `newTab`/`closeTab` — Eine Sitzung kennt genau einen Tab und genau einen
 *       Host (`allow = [tab_host]`). Ein zweiter Tab hätte kein Ziel, das der
 *       Mensch je freigegeben hat; ein `closeTab` hätte nichts, was ihm gehört.
 *   `propose` — überflüssig, weil die Erweiterung JEDEN einzelnen Schritt
 *       selbst beim Menschen erfragt. Zwei Rückfragen für einen Schritt sind
 *       eine zu viel: Wer zweimal gefragt wird, liest beim zweiten Mal nicht
 *       mehr mit.
 */
export const BEFEHLE = {
  /* Der Textbaum der Seite. `readPage` ist der Name der Agentenseite
     (werkzeuge.md §4.6), `snapshot` der Name, den der Relay heute schon auf
     Stufe `read` führt (app.py REQUIRED). Beide meinen dasselbe; zwei Namen
     für eine Sache sind hier kein Fehler, sondern die Brücke zwischen einer
     Tabelle, die schon steht, und einer, die noch kommt. */
  readPage: { stufe: "read", frist: 25000, freigabe: "schritt", tut: "die Seite lesen" },
  snapshot: { stufe: "read", frist: 25000, freigabe: "schritt", tut: "die Seite lesen" },

  /* Zustand melden: Adresse, Titel, Bildlaufstand, Größe der letzten
     Wahrnehmung. Kein Seitentext, keine Feldinhalte. */
  get_state: { stufe: "read", frist: 15000, freigabe: "schritt", tut: "den Zustand dieses Tabs melden" },

  /* Bildlauf. Danach immer eine neue Wahrnehmung — durch Nachladen entsteht in
     der Regel eine neue Epoche (spec-01 §5.2). */
  scroll: { stufe: "read", frist: 10000, freigabe: "schritt", tut: "auf der Seite scrollen" },

  /* Zeigen: der Agentenzeiger wandert auf ein Element der letzten Wahrnehmung.
     Das ist der einzige Befehl, der auf der Seite überhaupt sichtbar wird —
     und er verändert nichts an ihr. */
  highlight: { stufe: "read", frist: 20000, freigabe: "schritt", tut: "dir ein Element auf der Seite zeigen" },

  /* Gezielt ablesen statt alles lesen. `extract` ist KEINE Skriptausführung
     (spec-01 §5.2): Es liest ausschließlich aus der bereits erhobenen
     Wahrnehmung und sieht nichts, was `readPage` nicht auch sähe. Der Nutzen
     ist ein Kostennutzen — 12 Zeilen statt 3.000 Tokens Baum. */
  extract: { stufe: "read", frist: 25000, freigabe: "schritt", tut: "einzelne Angaben von der Seite ablesen" },

  /* Warten. Die längste Frist der Tabelle, weil Warten die einzige Handlung
     ist, deren Zweck das Vergehen von Zeit ist. Genau eine Bedingung, nie ein
     Prädikat als Skript — das wäre `eval` durch die Hintertür (spec-01 V4). */
  waitFor: { stufe: "read", frist: 60000, freigabe: "schritt", tut: "auf der Seite auf etwas warten" },

  /* Der Notausgang, nicht der Regelweg (spec-01 §4.7). Ein Bild kostet ein
     Vielfaches eines Textbaums und sagt weniger; deshalb verlangt dieser Befehl
     als einziger einen benannten Anlass. */
  screenshot: { stufe: "read", frist: 30000, freigabe: "schritt", tut: "ein Bild vom sichtbaren Ausschnitt aufnehmen" },

  /* Ortswechsel. Stufe `read`, weil der Relay das seit jeher so führt
     (RELAY:41) — die eigentliche Schranke ist nicht die Stufe, sondern der
     Bereich: Die Zieladresse wird VOR der Frage geprüft (ausfuehrer.js), damit
     der Mensch nie eine Adresse bestätigt, die danach abgelehnt wird. */
  navigate: { stufe: "read", frist: 45000, freigabe: "schritt", tut: "eine andere Adresse aufrufen" },
  back: { stufe: "read", frist: 30000, freigabe: "schritt", tut: "eine Seite zurückgehen" },

  /* Bedienen. Alle drei verändern die Seite — deshalb Stufe `write` und
     Freigabe „immer": kein Schrittmodus schaltet die Rückfrage hier ab. Das
     Ziel wird VOR der Frage nachgeschlagen (ausfuehrer.js), damit der Mensch
     einem konkreten Element zustimmt, nicht einer Absicht. */
  click: { stufe: "write", frist: 20000, freigabe: "schritt", tut: "für dich klicken" },
  type: { stufe: "write", frist: 25000, freigabe: "schritt", tut: "für dich in ein Feld tippen" },
  select: { stufe: "write", frist: 15000, freigabe: "schritt", tut: "für dich eine Auswahl treffen" },

  /* Einen gespeicherten Ablauf abspielen (Vertrag v3.5 §8.2).
     Die längste Frist der Tabelle, weil hier nicht ein Schritt geschieht,
     sondern eine Reihe davon.

     Was dieser Eintrag ausdrücklich NICHT ist: eine zweite Tür. Die Wiedergabe
     geht Schritt für Schritt durch dieselbe Befehlsschleife wie ein
     Agentenbefehl, also durch Modus, Klassifizierer, Bereichsprüfung und
     Verdeckungswache. Ein Ablauf ist eine Reihe von Befehlen, kein
     Freifahrschein — und deshalb bleibt auch hier `freigabe: "schritt"`. */
  run_workflow: {
    stufe: "write",
    frist: 120000,
    freigabe: "schritt",
    tut: "einen gespeicherten Ablauf abspielen",
  },
};

/* Der Sicherheitsabstand zur Uhr des Relays. Unsere Antwort muss vor seinem
   Zeitablauf ankommen, sonst bekommt der Agent statt einer Aussage nur
   „keine Antwort vom Browser". */
export const FRIST_PUFFER_MS = 1500;

/* Was noch übrig bleiben muss, damit die Ausführung nach einer Freigabe
   überhaupt noch stattfinden kann. Läuft die Frage länger, wird sie
   abgebrochen — mit Antwort. */
export const AUSFUEHRUNG_RESERVE_MS = 3000;

export const RANG = { read: 1, write: 2, full: 3 };

/*
 * Grenzen. Sie stehen hier und nicht im Seitenskript, weil das Seitenskript in
 * einer fremden Seite läuft: Was von dort kommt, wird gemessen, nicht geglaubt.
 * Ein Textbaum, der den Agenten erschlägt, ist kein Sicherheitsproblem, aber
 * ein Kostenproblem — und ein Rahmen, der den WebSocket sprengt, ist beides.
 */
export const GRENZEN = {
  refs: 120, // Bedienelemente mit Referenz je Wahrnehmung
  textknoten: 40, // reine Textzeilen je Wahrnehmung
  nameZeichen: 120,
  wertZeichen: 200,
  baumZeichen: 12000, // ≈ 3.000 Tokens
  rahmenZeichen: 128 * 1024, // halb so viel wie spec-01 §3.6.4 erlaubt
  knotenRoh: 400, // was das Seitenskript höchstens liefern darf
  befehleJeSitzung: 300, // Spiegel des Relay-Deckels (DRAHTFORMAT §6)
  befehleJeFenster: 30,
  fensterMs: 60000,
  warteschlange: 4,

  /* Die Bedenkzeit des Menschen — und warum sie NICHT aus `frist` kommt.

     Befund vom 29.07.2026 (M3): Die Frist des Befehls war zugleich die
     Bedenkzeit des Menschen. Die Rückfrage bekam `frist − FRIST_PUFFER_MS −
     AUSFUEHRUNG_RESERVE_MS`; bei `select` (15 s) blieben dem Inhaber rund 10,5
     Sekunden, bei `scroll` (10 s) rund 5,5 — um eine vorgelesene Frage zu HÖREN
     und zu entscheiden. Wer länger brauchte, bekam `grant_required`, und die
     Karte wurde ihm unter der Hand eingezogen (`link:freigabe-zurueckziehen`).

     Die Zahlen in `frist` stammen aus spec-01 §5.2 und sind als Budget der
     MASCHINE gerechnet. Menschenzeit ist etwas anderes: Die Frage muss
     gesprochen, gehört und beantwortet werden. 30 Sekunden sind die längste
     Frage, die diese Fassung stellt (Tippen mit 400 Zeichen Vorschau ≈ 30 s
     Vorlesezeit), plus die Entscheidung.

     Das ist ein MINDESTMASS, keine Obergrenze: Wo die eigene Frist des Befehls
     schon mehr hergibt (`waitFor`, `navigate`), bleibt es dabei. */
  bedenkzeitMs: 30000,

  /* Der Deckel über allem: Bedenkzeit PLUS Maschinenzeit.

     Der Relay wartet je Befehl voreingestellt 60 Sekunden
     (`REST_DEFAULT_TIMEOUT`, server/app.py) und schickt dem Agenten danach
     `timeout_keine_antwort_vom_browser`. Wer später antwortet, HAT den Schritt
     trotzdem ausgeführt — der Agent hört aber, es sei nichts passiert. Ein
     Schritt, der stattgefunden hat und als nicht stattgefunden gemeldet wird,
     ist die schlimmste Sorte Falschaussage; deshalb bleibt die Summe darunter.

     Er kürzt die Bedenkzeit NICHT — sie soll nie kürzer werden als bisher. Er
     begrenzt allein die Gutschrift, die der Maschine nach der Antwort des
     Menschen zurückgegeben wird (ausfuehrer.js). */
  gesamtfristMs: 55000,

  /* Ablesen (`extract`). Die Zahlen stammen aus spec-01 §5.2; `extraktZeichen`
     ist unsere eigene Bremse: Auch 60 kurze Zeilen sind Seitentext, und
     Seitentext wird gemessen, nicht geglaubt. */
  extraktRefs: 60,
  extraktFelder: 10,
  extraktZeichen: 8000,

  /* Bildlauf: die größte Pixelzahl, die ein `amount` nennen darf. Spiegel des
     Deckels in content/overlay.js — dort wird geklemmt, hier wird abgelehnt.
     Abgelehnt ist besser, weil ein geklemmter Wert eine Handlung ausführt, die
     so niemand angefordert hat. */
  scrollPixel: 3000,

  /* Tippen. `tippZeichen` spiegelt den Schnitt in content/overlay.js. Er steht
     hier ein zweites Mal, weil die Frage an den Menschen VOR der Ausführung
     steht: Er soll nicht 2.000 Zeichen bestätigen und 3.000 abgeschickt
     bekommen. Läuft eine Seite einmal auseinander, gilt die strengere Zahl. */
  tippZeichen: 2000,

  /* Wie viel vom Text in der Freigabefrage steht. Befund vom 29.07.2026: Es
     waren 120 Zeichen von bis zu 2.000, in der Mitte gekürzt — der Mensch
     bestätigte damit etwas, das er nie gesehen hat. 400 Zeichen sind rund 30
     Sekunden Vorlesezeit; das ist die Grenze, an der eine Frage noch eine Frage
     ist und keine Vorlesung. Was darüber liegt, wird nicht verschwiegen,
     sondern gezählt: „… und weitere N Zeichen". */
  tippFrageZeichen: 400,

  /* Wie viel von der ZIELADRESSE in der Freigabefrage steht. Befund vom
     29.07.2026 (M2): `navigate` zeigte Host und Pfad — `?…` und `#…` fielen
     ersatzlos weg. `https://shop.example/konto/loeschen?bestaetigt=ja` ergab
     „Ziel: shop.example/konto/loeschen." Der Mensch bestätigte einen
     Ortswechsel, dessen wirksamen Teil er nie gesehen hat; die Bereichsprüfung
     fängt das nicht ab, weil sie nur den Host prüft.

     160 Zeichen sind rund 12 Sekunden Vorlesezeit — genug für jede Adresse, die
     ein Mensch noch prüfen kann, und kurz genug, dass die Frage eine Frage
     bleibt. Was darüber liegt, wird gezählt wie beim Tippen, nicht
     verschwiegen. */
  adresseFrageZeichen: 160,

  /* Bilder. `bildZeichen` ist der Deckel für die Base64-Nutzlast allein und
     liegt unter `rahmenZeichen`: Ein Bild, das den Rahmen sprengt, würde von
     `rahmenDeckeln` zu einer Absage ohne Bild — dann lieber gleich eine
     ehrliche Absage MIT Begründung. Base64 plus der übrige Rahmen bleiben mit
     110 KiB sicher unter den 128 KiB von `rahmenZeichen`.

     Befund vom 29.07.2026 (M7): 90 KiB Base64 sind rund 67 KiB JPEG. Ein
     Ausschnitt von 1920×1080 bei Qualität 40 liegt typischerweise darüber, auf
     einem HiDPI-Schirm deutlich — der Notausgang stand damit die meiste Zeit
     zu, und zwar mit einer ehrlichen, aber ausweglosen Meldung. Deshalb jetzt
     eine LEITER statt einer einzigen Stufe: Passt die erste Aufnahme nicht,
     wird dieselbe Ansicht schlechter aufgelöst noch einmal genommen. Ein
     Notausgang muss lesbar sein, nicht schön; erst wenn auch die unterste Stufe
     nicht passt, wird abgesagt. */
  bildZeichen: 110 * 1024,
  bildQualitaeten: [40, 22, 10],

  /* Der Auftrag als Ganzes (Vertrag v3.5 §5).

     Bis v3.4 gab es nur Deckel je Sitzung und je Zeitfenster. Beide zählen
     Befehle, keiner zählt einen AUFTRAG: Ein Agent, der sich verrannt hat,
     durfte 300 Schritte lang danebengreifen, solange er langsam genug war.
     Ein Auftrag, der sich im Kreis dreht, wird nicht besser, wenn man ihn
     laufen lässt — er wird nur teurer und richtet länger etwas an.

     `schritteJeAuftrag` ist in der Seitenleiste einstellbar, `schritteDeckel`
     ist die Grenze, über die auch der Mensch nicht hinauskommt: Wer 5.000
     Schritte einstellen darf, hat den Deckel abgeschafft, ohne es zu merken. */
  schritteJeAuftrag: 50,
  schritteDeckel: 500,

  /* Wie oft dieselbe Marke hintereinander stehen darf, bevor angehalten und
     gefragt wird (`schrittMarke`, Fehlercode `loop_detected`). Drei, weil zwei
     auch ein legitimer Wiederholversuch nach einem Nachladen sein kann. */
  schleifeGleich: 3,

  /* Zeitablauf je Schritt INNERHALB eines Auftrags. Er liegt über der Frist
     der meisten Einzelbefehle und unter der des Relays: Ein Schritt, der
     hängt, hält den ganzen Auftrag auf, und das soll er auch, aber nicht
     endlos. */
  schrittFristMs: 60000,

  /* Die Werte, die ein `run_workflow` einsetzen darf (§8.2). 20 Einträge und
     200 Zeichen sind reichlich für Artikelnummern und Suchbegriffe und zu
     wenig, um einen ganzen Seitentext durch einen Platzhalter zu schleusen. */
  workflowParams: 20,
  workflowParamZeichen: 200,
};

/*
 * Geschlossene Zustandsmenge (spec-01 §4.3.1). Geschlossen, weil eine offene
 * Menge bedeutet, dass Seiteninhalt in ein Feld gerät, das der Agent als
 * Zustand liest — und damit als Tatsache statt als Behauptung. Unbekannte
 * Zustände werden verworfen, nicht durchgereicht.
 */
export const ZUSTAENDE = new Set([
  "enabled", "disabled", "readonly", "required", "invalid", "focused",
  "checked", "unchecked", "mixed", "expanded", "collapsed", "selected",
  "visible", "offscreen", "covered", "busy", "modal",
]);

/* Zustände, die der Normalfall sind und deshalb nicht im Text auftauchen
   (spec-01 §4.4, Regel 3: `[deaktiviert]` steht da, `[aktiviert]` nicht). */
const ZUSTAND_STILL = new Set(["enabled", "visible"]);

const ZUSTAND_TEXT = {
  disabled: "deaktiviert",
  readonly: "nur lesbar",
  required: "pflicht",
  invalid: "fehlerhaft",
  focused: "im Fokus",
  checked: "angehakt",
  unchecked: "nicht angehakt",
  mixed: "teilweise",
  expanded: "aufgeklappt",
  collapsed: "zugeklappt",
  selected: "ausgewählt",
  offscreen: "außerhalb des sichtbaren Bereichs",
  covered: "verdeckt",
  busy: "lädt",
  modal: "modal",
};

/**
 * Fremdtext in eine Form bringen, die man gefahrlos ANZEIGEN, protokollieren
 * und weitergeben kann. Gekürzt wird in der Mitte: Anfang und Ende sind für
 * das Wiedererkennen entscheidend (spec-01 §4.8, K2).
 *
 * ====================================================================
 * DIE ROLLENTEILUNG — sie ist der Kern der Reparatur vom 14.08.2026
 * ====================================================================
 *
 * `saeubern` ist für die ANZEIGE. Dort ist die Kürzung richtig: Eine Frage,
 * die dreitausend Zeichen vorliest, wird nicht gehört, und ein Protokoll, in
 * das eine ganze Seite passt, ist keines.
 *
 * `messtext` und `messweg` (`../gemeinsam/messform.js`) sind für die MESSUNG.
 * Dort wird NIE gekürzt, in keiner Länge, aus keinem Grund — Befund H1:
 * `flachmachen` kürzte in der Mitte, und das Wort „kasse" stand genau dort.
 *
 *     Eine Sicherheitsprüfung kürzt ihren Eingang nicht.
 *
 * Wer diese Funktion vor einer Messung ruft, hebelt die Messung aus. Genau
 * das ist Befund AUTOMODUS-2: `ausfuehrer.js` kürzt den Elementnamen auf 120
 * Zeichen, bevor der Klassifizierer ihn sieht — ein Knopf mit 208 Zeichen
 * Namen, in dessen Mitte „kaufen" steht, lief damit im Modus `auto` ohne
 * Rückfrage. Deshalb hält `src/pruefung/gattung.test.mjs` eine Positivliste
 * über jede Kürzung im Bestand: Eine neue Fundstelle ist rot, bis jemand sie
 * einträgt und begründet.
 *
 * ====================================================================
 * WAS SICH AM 14.08.2026 GEÄNDERT HAT: unsichtbare Zeichen fallen weg
 * ====================================================================
 *
 * Bis dahin stand hier `.replace(STEUERZEICHEN, " ")` über einer Liste, die
 * Nullbreiten und Schreibrichtungsmarken enthielt. Aus „Jetzt kau<U+200B>fen"
 * wurde damit „Jetzt kau fen" — und das war nicht nur eine schlechte Anzeige,
 * sondern das Ende der Wache: Der Ausführer ruft `saeubern` auf den
 * Elementnamen, BEVOR der Klassifizierer ihn misst. Das Wort „kaufen" war
 * schon zerschnitten, als gemessen wurde (AUTOMODUS-1).
 *
 * Die alte Begründung — ein weggelassenes Zeichen liesse die Anzeige lügen —
 * gilt für Steuerzeichen und nicht für Zeichen ohne eigene Breite. Die Seite
 * zeigt dem Menschen „Jetzt kaufen"; ihm „Jetzt kau fen" vorzulesen ist die
 * Lüge. Deshalb gilt ab jetzt in BEIDEN Formen dieselbe Regel, und sie steht
 * genau einmal im Bestand (`ohneUnsichtbare` / `steuerzeichenGlaetten` in
 * `../gemeinsam/messform.js`):
 *
 *   - keine eigene Breite  → ersatzlos weg
 *   - bedeutet eine Lücke  → ein Leerzeichen
 */
export function saeubern(roh, grenze = GRENZEN.nameZeichen) {
  const s = anzeigeform(roh);
  if (s.length <= grenze) return s;
  if (grenze <= 1) return "…";
  const kopf = Math.ceil((grenze - 1) / 2);
  const fuss = grenze - 1 - kopf;
  return `${s.slice(0, kopf)}…${fuss > 0 ? s.slice(s.length - fuss) : ""}`;
}

/**
 * Trägt dieser Text die Spur UNSERER eigenen Kürzung?
 *
 * Die Laufzeit-Gegenwache zu Befund AUTOMODUS-2, und sie ist ausdrücklich
 * eine Wache über die KLASSE und nicht über die eine Aufrufstelle: Wer immer
 * einen Namen kürzt, bevor er gemessen wird — heute `ausfuehrer.js:3057`,
 * morgen eine Stelle, die es noch nicht gibt —, liefert hier einen Text ab,
 * dessen Mitte fehlt. Was fehlt, kann nicht gemessen werden, und was nicht
 * gemessen werden kann, wird nicht durchgewinkt.
 *
 * Erkannt wird der Fingerabdruck von `saeubern` selbst und nicht bloss ein
 * Auslassungszeichen: `saeubern` setzt GENAU EIN „…" an die Stelle
 * `ceil((laenge - 1) / 2)` des Ergebnisses, unabhängig davon, mit welcher
 * Grenze gekürzt wurde. Damit greift die Erkennung für jede Grenze und
 * verschont die häufigen Namen, die selbst auf „…" enden („Mehr laden…",
 * „Weitere Optionen…") — dort steht das Zeichen am Ende und nicht in der
 * Mitte.
 *
 * Die Untergrenze von 20 Zeichen hält kurze Namen heraus, in denen ein
 * mittiges „…" Zufall sein kann („ab…cd"). Gekürzt wird im Bestand mit 20,
 * 40, 60, 80, 120 und 200 Zeichen; darunter gibt es keine Kürzung, die diese
 * Spur hinterlassen könnte.
 *
 * Ein Fehlalarm kostet eine Rückfrage. Ein übersehener Fall kostet den Kauf.
 */
export function kuerzungsspur(roh) {
  const s = String(roh ?? "");
  if (s.length < 20) return false;
  const erste = s.indexOf("…");
  if (erste < 0) return false;
  if (s.lastIndexOf("…") !== erste) return false; // mehr als eines: nicht unsere Form
  return erste === Math.ceil((s.length - 1) / 2);
}

/**
 * Nachschlagen mit einem Schlüssel, der von aussen kommt.
 *
 * Befund vom 14.08.2026 (H2), und er ist ein Muster und kein Einzelfall: In
 * `ausfuehrer.js` stand `SERVER_MODUS[schrittmodus] || "manual"` über einem
 * gewöhnlichen Objektliteral. Jedes solche Literal erbt von
 * `Object.prototype`, also liefern `constructor`, `toString`, `valueOf`,
 * `hasOwnProperty` und `__proto__` eine Funktion — und eine Funktion ist wahr.
 * Damit griff das `|| "manual"` nicht, und die Zusage „der Serverwert
 * schränkt ein, er erweitert nie" war für jeden unbekannten Wert falsch:
 * Gemessen wurde `schrittmodus=constructor` mit lokalem `auto` und NULL
 * Rückfragen beim Klick.
 *
 * Diese Funktion ist die Antwort darauf, und zwar an jeder Stelle im Gebiet,
 * an der ein Schlüssel aus einem Rahmen, einer Sitzung, einer Ablage oder
 * einer besuchten Seite stammt. Sie fragt nach dem EIGENEN Eintrag, nie nach
 * irgendeiner Eigenschaft, und gibt sonst `undefined` — damit jedes `||`
 * dahinter wieder das tut, wonach es aussieht.
 *
 * @param {object} tabelle
 * @param {*} schluessel
 */
export function eigen(tabelle, schluessel) {
  if (!tabelle || typeof schluessel !== "string") return undefined;
  return Object.prototype.hasOwnProperty.call(tabelle, schluessel) ? tabelle[schluessel] : undefined;
}

/**
 * Zwei Texte vergleichbar machen (Festlegung F3, Ausführerseite).
 *
 * Dieselbe flache Form, in der auch die Wortlisten messen: kleingeschrieben,
 * ohne Umlaute, ohne Satzzeichen, mit je einem Leerzeichen am Rand. Die
 * Randleerzeichen machen aus einem `includes` einen Wortvergleich, und genau
 * den braucht der Ausführer, wenn er den Namen des gefundenen Elements gegen
 * die Beschreibung des Ablaufschrittes hält.
 */
export function vergleichsform(roh) {
  return flachmachen(roh);
}

/**
 * Die Befehlskennung aus dem Rahmen. DRAHTFORMAT §6: nichtleere Zeichenkette,
 * höchstens 64 Zeichen. Der Relay setzt sie selbst, wenn der Agent keine
 * mitgibt — eine unbrauchbare Kennung kann es hier also gar nicht geben,
 * es sei denn, am anderen Ende spricht nicht der Relay.
 *
 * @returns {string|null}
 */
export function kennungPruefen(roh) {
  if (typeof roh !== "string") return null;
  if (!roh.length || roh.length > 64) return null;
  return roh;
}

/**
 * Reicht die Stufe der Sitzung für diesen Befehl?
 *
 * Fail-closed an zwei Stellen: Ein unbekannter Befehl reicht nie (er hat keine
 * Stufe, also auch keine erfüllbare), und eine unbekannte Stufe hat Rang 0.
 */
export function stufeReicht(stufe, cmd) {
  /* Beide Schlüssel kommen von aussen: `cmd` aus dem Befehlsrahmen, `stufe`
     aus der Sitzung des Relays. Über einem Objektliteral fänden sie sonst
     `constructor` und Verwandte (Befund H2 vom 14.08.2026). Hier war es
     bislang nur zufällig ungefährlich — eine geerbte Funktion überlebte den
     Zahlenvergleich nicht. Zufall ist keine Prüfung. */
  const eintrag = eigen(BEFEHLE, cmd);
  if (!eintrag) return false;
  /* Ein Befehl, dessen eigene Stufe niemand lesen kann, reicht nie — sonst
     wäre eine unbekannte Stufe die niedrigste statt der höchsten. */
  const noetig = eigen(RANG, eintrag.stufe);
  if (!Number.isFinite(noetig)) return false;
  return (eigen(RANG, stufe) || 0) >= noetig;
}

/* --------------------------------------------------------------------- *
 * Adressen und der freigegebene Bereich
 *
 * Befund vom 11.08.2026: `bereichPasst` verglich ausschließlich den Wirt und
 * ließ das Schema fallen. Eine Freigabe für `https://bank.de` deckte damit
 * klaglos `http://bank.de` — für das Auge dieselbe Adresse, in Wahrheit eine
 * unverschlüsselte Leitung, die jeder im selben Netz mitliest UND verändert.
 * Das ist die klassische Herunterstufung: Sie braucht keinen fremden Wirt,
 * ihr genügt ein fehlendes „s".
 *
 * Ab hier ist deshalb alles eine Positivliste. Nicht „was verboten ist, fliegt
 * raus", sondern „was nicht ausdrücklich erlaubt ist, kommt nicht durch":
 *
 *   Schema      nur `https:` und `http:`. Damit sind `javascript:`, `data:`,
 *               `blob:`, `file:`, `chrome:` und `chrome-extension:` in einem
 *               Satz erledigt, ohne Sperrliste, die man zu ergänzen vergessen
 *               kann. Und `https` wird nie zu `http`.
 *   Wirt        nur Kleinbuchstaben, Ziffern, Bindestrich und Punkt; jede
 *               Marke 1 bis 63 Zeichen, ohne Bindestrich am Rand; der ganze
 *               Name höchstens 253 Zeichen. Der Wurzelpunkt fällt weg
 *               (RFC 1034 §3.1), Großschreibung wird kleingeschrieben.
 *   Nutzername  verboten. `https://bank.de@angreifer.de` führt zu
 *               `angreifer.de`, liest sich aber wie die Bank. Eine Adresse,
 *               die etwas anderes tut, als sie sagt, rufen wir nicht auf.
 *   Port        nur der voreingestellte, es sei denn, die Freigabe nennt den
 *               Port selbst. Ein anderer Port ist ein anderer Dienst.
 *   Punycode    `xn--` gilt nur, wo die Freigabe genau diesen Namen nennt,
 *               nie unter einem Platzhalter. Gemischte Schriften sehen im
 *               Klartext aus wie lateinische Buchstaben, und wer
 *               `*.example.de` freigibt, hat `xn--bnk-bld.example.de` nicht
 *               gemeint.
 *
 * Warum umgekehrt, also von `http` auf `https`, erlaubt bleibt: Eine
 * Aufwertung nimmt dem Mitleser die Leitung weg, sie gibt niemandem Macht
 * dazu. Wirt, Port und Pfad bleiben dieselben, nur die Strecke wird
 * verschlossen. Wer den offenen Weg freigegeben hat, hat den geschlossenen
 * erst recht freigegeben, und eine Erweiterung, die eine Verschlüsselung
 * ablehnt, weil niemand sie ausdrücklich verlangt hat, schützt niemanden.
 *
 * Zerlegt wird ausschließlich mit `new URL`. Eigene Zeichenkettenarbeit an
 * Adressen ist der Ursprung fast jeder Herunterstufung: Der Browser liest die
 * Adresse anders als die selbstgebaute Suche, und maßgeblich ist der Browser.
 * --------------------------------------------------------------------- */

/* Die einzigen Schemata, die überhaupt in Frage kommen. */
export const SCHEMATA = new Set(["https", "http"]);

/* Ein Wirtsname, wie ihn `new URL` nach der IDNA-Umwandlung liefert: reines
   ASCII. Was hier nicht hineinpasst, ist kein Name, den wir vergleichen. */
const MARKE_MUSTER = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function wirtSauber(roh) {
  let host = String(roh || "").toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1); // Wurzelpunkt, RFC 1034 §3.1
  if (!host || host.length > 253) return null;
  const marken = host.split(".");
  if (marken.some((m) => !MARKE_MUSTER.test(m))) return null;
  return host;
}

function hatPunycode(host) {
  return String(host || "").split(".").some((m) => m.startsWith("xn--"));
}

/**
 * Eine Adresse in ihre drei Vergleichsstücke zerlegen: Schema, Wirt, Port.
 *
 * `null` heißt: Diese Adresse wird nicht angefasst. Es gibt keinen Zweifelsfall,
 * der durchgereicht wird.
 *
 * @returns {{schema:string, host:string, port:string}|null}
 */
export function adresseZerlegen(adresse) {
  let u;
  try {
    u = new URL(String(adresse ?? ""));
  } catch (_) {
    return null;
  }
  const schema = u.protocol.replace(/:$/, "").toLowerCase();
  if (!SCHEMATA.has(schema)) return null;
  /* Nutzername oder Kennwort im Ort: Die Adresse zeigt vorne den Namen, den
     der Mensch lesen soll, und geht hinten zu einem anderen Wirt. */
  if (u.username || u.password) return null;
  const host = wirtSauber(u.hostname);
  if (!host) return null;
  /* `u.port` ist leer, wenn der voreingestellte Port gemeint ist — Chrome
     entfernt `:443` bei https und `:80` bei http von selbst. */
  return { schema, host, port: u.port || "" };
}

/**
 * Host einer Adresse — klein, ohne Wurzelpunkt, nur http/https.
 *
 * Bleibt als eigener Name bestehen, weil der Ausführer und die Freigabefrage
 * nur den Wirt brauchen. Die Prüfung dahinter ist seit dem 11.08.2026
 * dieselbe wie beim Bereich: `adresseZerlegen`.
 *
 * @returns {string|null}
 */
export function hostAus(adresse) {
  const z = adresseZerlegen(adresse);
  return z ? z.host : null;
}

/**
 * Einen Eintrag der Freigabeliste zerlegen.
 *
 * Erlaubt sind `bank.de`, `*.bank.de`, `bank.de:8443` und dieselben Formen mit
 * vorangestelltem `https://` oder `http://`. Alles andere ist kein Eintrag.
 *
 * @returns {{schema:(string|null), host:string, port:string, platzhalter:boolean}|null}
 */
export function eintragZerlegen(roh) {
  let s = String(roh ?? "").trim().toLowerCase();
  if (!s) return null;

  let schema = null;
  const mitSchema = /^(https?):\/\//.exec(s);
  if (mitSchema) {
    schema = mitSchema[1];
    s = s.slice(mitSchema[0].length);
  } else if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    return null; // ein fremdes Schema im Eintrag ist keine Wirtsangabe
  }

  s = s.replace(/\/.*$/, ""); // ein Pfad im Eintrag sagt über den Wirt nichts
  if (s.includes("@")) return null; // Nutzername auch hier nie

  let port = "";
  const mitPort = /:([0-9]{1,5})$/.exec(s);
  if (mitPort) {
    port = mitPort[1];
    s = s.slice(0, mitPort.index);
  } else if (s.includes(":")) {
    return null;
  }
  /* Der voreingestellte Port ist kein eigener Port: `https://bank.de:443` und
     `https://bank.de` sind derselbe Dienst, und `new URL` schreibt ihn beim
     Ziel gar nicht erst hin. */
  if (schema && port === (schema === "https" ? "443" : "80")) port = "";

  if (s.endsWith(".")) s = s.slice(0, -1);
  const platzhalter = s.startsWith("*.");
  const rumpf = platzhalter ? s.slice(2) : s;
  const host = wirtSauber(rumpf);
  if (!host) return null;
  /* `*.de` wäre eine ganze Länderendung, `*` das halbe Netz. Ein Platzhalter
     braucht mindestens einen eigenen Namen unter der Endung. */
  if (platzhalter && host.split(".").length < 2) return null;

  return { schema, host, port, platzhalter };
}

/**
 * Das Schema, das der Mensch im Browser wirklich freigegeben hat.
 *
 * Quelle ist das Ursprungsmuster der Sitzung (`https://bank.de/*`) — genau
 * jene Zeichenkette, mit der die Erweiterung ihr Zugriffsrecht auf diese Seite
 * beantragt hat. Es ist die einzige Stelle, an der ein Schema überhaupt
 * auftaucht: Die `allow`-Liste des Relays führt nur Wirte.
 *
 * @returns {string|null} „https", „http" oder null, wenn nichts bekannt ist
 */
export function freigabeSchema(sitzung) {
  const m = /^(https?):\/\//.exec(String((sitzung && sitzung.ursprungMuster) || "").toLowerCase());
  return m && SCHEMATA.has(m[1]) ? m[1] : null;
}

/** Deckt das freigegebene Schema das Schema des Ziels? */
function schemaReicht(freigegeben, ziel) {
  if (!freigegeben) return true; // nichts bekannt: der Eintrag entscheidet allein
  if (freigegeben === "https") return ziel === "https";
  return SCHEMATA.has(ziel); // http freigegeben: http und https
}

function wirtPasst(eintrag, ziel) {
  if (!eintrag.platzhalter) return ziel.host === eintrag.host;
  /* Unter einem Platzhalter kein Punycode: `xn--bnk-bld.example.de` ist
     formal eine Unterseite von `example.de`, liest sich im Klartext aber wie
     ein ganz anderer Name. Wer den Namen wirklich meint, gibt ihn frei. */
  if (hatPunycode(ziel.host) && !hatPunycode(eintrag.host)) return false;
  return ziel.host === eintrag.host || ziel.host.endsWith(`.${eintrag.host}`);
}

/**
 * Liegt diese Adresse im freigegebenen Bereich, und wenn nicht, woran lag es?
 *
 * Der Relay prüft die Ziele, die IM BEFEHL stehen. Er kann aber nicht wissen,
 * wo der Tab gerade steht: Der Mensch kann in der Zwischenzeit selbst
 * weitergeklickt haben, oder die Seite hat sich selbst weitergeleitet. Ohne
 * diese zweite Prüfung läse der Agent den Inhalt einer Seite, die nie
 * freigegeben wurde. Deshalb wird VOR jedem Befehl die aktuelle Adresse des
 * Tabs gemessen, nicht die, die beim Verbinden galt.
 *
 * Eine leere Bereichsliste ist hier KEINE Erlaubnis, sondern das Gegenteil
 * (DRAHTFORMAT E7): Sie kann nur aus einem Fehler stammen, und im Fehlerfall
 * wird nichts gelesen.
 *
 * Der Grund wird mitgegeben, weil ein Mensch bei „bank.de liegt außerhalb der
 * Freigabe" nichts versteht, wenn er bank.de freigegeben hat. Er muss hören,
 * dass es an der fehlenden Verschlüsselung liegt.
 *
 * @returns {{ok:true, ziel:object} | {ok:false, grund:string, ziel:(object|null)}}
 */
export function bereichBefund(adresse, sitzung) {
  const ziel = adresseZerlegen(adresse);
  if (!ziel) return { ok: false, grund: "adresse", ziel: null };

  const liste = Array.isArray(sitzung && sitzung.bereich) ? sitzung.bereich : [];
  if (!liste.length) return { ok: false, grund: "bereich", ziel };

  /* „Nur dieser Tab" heißt: genau dieser eine Wirt, ohne Platzhalter. */
  const roh = (sitzung && sitzung.modus) === "tab" ? liste.slice(0, 1) : liste;
  const eintraege = roh
    .map(eintragZerlegen)
    .filter((e) => e && !((sitzung && sitzung.modus) === "tab" && e.platzhalter));
  if (!eintraege.length) return { ok: false, grund: "bereich", ziel };

  /* In dieser Reihenfolge, damit der Grund der engste ist, der noch stimmt:
     erst der Wirt, dann der Port, zuletzt das Schema. */
  const amWirt = eintraege.filter((e) => wirtPasst(e, ziel));
  if (!amWirt.length) return { ok: false, grund: "bereich", ziel };

  const amPort = amWirt.filter((e) => (e.port || "") === (ziel.port || ""));
  if (!amPort.length) return { ok: false, grund: "port", ziel };

  if (!amPort.some((e) => schemaReicht(e.schema, ziel.schema))) {
    return { ok: false, grund: "schema", ziel };
  }
  if (!schemaReicht(freigabeSchema(sitzung), ziel.schema)) {
    return { ok: false, grund: "schema", ziel };
  }
  return { ok: true, ziel };
}

/** Die Ja/Nein-Form von `bereichBefund` für alle Aufrufer, die nur das brauchen. */
export function bereichPasst(adresse, sitzung) {
  return bereichBefund(adresse, sitzung).ok;
}

/* --------------------------------------------------------------------- *
 * Die Parameter
 *
 * Der Befund vom 29.07.2026, aus dem dieser ganze Abschnitt entstanden ist:
 * `scroll` las seine Richtung als `String(rahmen.direction || "down")`. Der
 * Relay verwarf das Feld ohnehin, also scrollte jeder Aufruf nach unten — und
 * meldete Erfolg. Ein Agent, der „nach oben" wollte, bekam „gelungen" zurück
 * und plante auf einer Seite weiter, die sich in die andere Richtung bewegt
 * hatte. Das ist schlimmer als ein Fehler: Es ist eine Falschaussage.
 *
 * Daraus die Regel, die für JEDEN Befehl gilt:
 *
 *   **Ein fehlender Parameter, der bestimmt, WAS geschieht, wird nie
 *   stillschweigend zur Voreinstellung. Er ist eine benannte Absage wert.**
 *
 * Eine Voreinstellung ist nur dort erlaubt, wo sie das Ergebnis nicht
 * umkehrt — `amount` bestimmt, wie WEIT gescrollt wird, nicht wohin; `clear`
 * ist in spec-01 §5.2 ausdrücklich mit `true` vorbelegt. Beides steht unten
 * mit dieser Begründung.
 *
 * Und der zweite Grund, warum dieser Abschnitt hier steht und nicht im
 * Ausführer: Geprüft wird VOR der Rückfrage beim Menschen. Wer erst fragt und
 * dann selbst ablehnt, lässt den Inhaber etwas bestätigen, das nie stattfindet.
 * --------------------------------------------------------------------- */

/* Die Richtungen, die das Seitenskript wirklich kennt (content/overlay.js).
   Alles andere ist keine Richtung, sondern ein Tippfehler mit Wirkung. */
export const SCROLL_RICHTUNGEN = new Set(["down", "up", "top", "bottom"]);
export const SCROLL_MENGEN = new Set(["page", "half"]);

/* Genau eine dieser Bedingungen darf ein `waitFor` tragen. Die Reihenfolge ist
   die aus spec-01 §5.2 und zugleich die, in der Fehlermeldungen sie aufzählen. */
export const WARTE_BEDINGUNGEN = ["textPresent", "refGone", "refVisible", "urlMatches", "idle"];

/* Der Anlassschlüssel eines Bildes (spec-01 §5.2, auf dem Draht
   `screenshotReason` — werkzeuge.md §4.5, weil `reason` schon der Satz für den
   Menschen ist). Ohne Anlass keine Aufnahme: Ein Bild ist der Notausgang. */
export const BILD_ANLAESSE = new Set(["canvas", "empty_ax", "repeated_failure", "user_request"]);

/* Referenzen haben genau eine Form (spec-01 §4.5) — dieselbe, die
   `knotenPruefen` beim Bau der Wahrnehmung vergibt. Eine leere Referenz, die
   bis zum Seitenskript durchläuft, kommt dort als „stale_ref" zurück; der
   Agent sucht dann einen Fehler in seiner Epoche statt in seinem Rahmen. */
const REF_MUSTER = /^e[0-9]{1,4}$/;

export function refPruefen(roh) {
  return typeof roh === "string" && REF_MUSTER.test(roh) ? roh : null;
}

/** Eine benannte Absage. `param_ungueltig` steht für „der Rahmen war falsch
    gebaut" — nicht wiederholbar, denn derselbe Rahmen wird beim zweiten Mal
    nicht besser. Der Hinweis sagt, wie er richtig aussieht. */
function absage(satz, hinweis, code = "param_ungueltig") {
  return { ok: false, code, satz, hinweis, retryable: false };
}

function fehltDas(wert) {
  return wert === undefined || wert === null;
}

/**
 * Die Vorschau des zu tippenden Textes für die Freigabefrage.
 *
 * Nicht in der Mitte gekürzt wie Fremdtext (`saeubern`): Beim Wiedererkennen
 * einer Seitenüberschrift helfen Anfang UND Ende, bei einem Text, der gleich
 * geschrieben wird, zählt der Anfang — und was fehlt, wird gezählt statt
 * angedeutet.
 */
export function tippVorschau(text, grenze = GRENZEN.tippFrageZeichen) {
  const sauber = saeubern(text, Number.MAX_SAFE_INTEGER);
  if (sauber.length <= grenze) return { gezeigt: sauber, rest: 0 };
  return { gezeigt: sauber.slice(0, grenze), rest: sauber.length - grenze };
}

/**
 * Die Vorschau der Zieladresse für die Freigabefrage (M2).
 *
 * Sie zeigt Host, Pfad, Abfragezeichenkette UND Marke. Der Teil hinter dem
 * Fragezeichen ist bei einem Ortswechsel genau der, der etwas auslöst —
 * `?bestaetigt=ja` ist die Handlung, `/konto/loeschen` nur der Ort. Ihn
 * wegzulassen hieß, den Menschen den harmlosen Teil bestätigen zu lassen.
 *
 * Die Adresse stammt aus dem Rahmen des AGENTEN, nicht von der besuchten
 * Seite — deshalb darf sie überhaupt in die Frage. Entschärft wird sie
 * trotzdem, und zwar in zwei Linien:
 *
 *  1. Gezeigt wird die GEPRÜFTE Adresse aus `new URL`, nie die rohe
 *     Zeichenkette. Der URL-Standard kodiert Steuerzeichen, Nullbreiten und
 *     Schreibrichtungsmarken in Pfad, Abfrage und Marke prozentweise und weist
 *     einen Host mit solchen Zeichen ganz ab. Nachgemessen: `?q=a‮b` wird
 *     zu `?q=a%E2%80%AEb` — sichtbar, aber wirkungslos.
 *  2. `saeubern` dahinter. Es ist heute nicht das, was schützt, sondern das,
 *     was schützt, falls diese Funktion einmal ohne `new URL` auskommen soll.
 *     Eine zweite Linie kostet hier nichts.
 *
 * Gekürzt wird wie beim Tippen: vorn beginnend, und der Rest wird gezählt statt
 * angedeutet. In der Mitte zu kürzen wäre hier falsch — eine Adresse liest man
 * von links, und ein „…" mittendrin verbirgt genau die Stelle, an der aus einem
 * Ort eine Handlung wird.
 */
export function adressVorschau(adresse, grenze = GRENZEN.adresseFrageZeichen) {
  const host = hostAus(adresse);
  if (!host) return { gezeigt: "", rest: 0 };
  const u = new URL(String(adresse));
  const pfad = u.pathname === "/" ? "" : u.pathname;
  const sauber = saeubern(`${host}${pfad}${u.search}${u.hash}`, Number.MAX_SAFE_INTEGER);
  if (sauber.length <= grenze) return { gezeigt: sauber, rest: 0 };
  return { gezeigt: sauber.slice(0, grenze), rest: sauber.length - grenze };
}

const WARTE_FRAGE = {
  textPresent: (w) => `dass „${saeubern(w, 60)}" auf der Seite steht`,
  refGone: (w) => `dass ${w} verschwindet`,
  refVisible: (w) => `dass ${w} sichtbar wird`,
  urlMatches: (w) => `dass die Adresse zu „${saeubern(w, 60)}" passt`,
  idle: () => "dass die Seite zur Ruhe kommt",
};

/**
 * Alle Parameter eines Befehls prüfen, bevor irgendetwas geschieht.
 *
 * @param {string} cmd
 * @param {object} rahmen  der Befehlsrahmen vom Relay (unvertraut)
 * @param {object} lage    { sitzung, fristMs }
 * @returns {{ok:true, plan:object} | {ok:false, code:string, satz:string, hinweis:string, retryable:boolean}}
 */
export function parameterPruefen(cmd, rahmen = {}, lage = {}) {
  const r = rahmen || {};

  switch (cmd) {
    /* ------------------------------------------------------------- */
    case "readPage":
    case "snapshot": {
      if (!fehltDas(r.includeOffscreen) && typeof r.includeOffscreen !== "boolean") {
        return absage(
          "`includeOffscreen` ist ein Ja/Nein-Feld.",
          "true oder false mitsenden — oder ganz weglassen."
        );
      }
      /* `region` gehört zu `extract`. Hier stillschweigend die ganze Seite zu
         lesen wäre genau der Fehler, den F1 beschreibt: Der Agent bekäme mehr,
         als er verlangt hat, und hielte es für seinen Ausschnitt. */
      if (!fehltDas(r.region)) {
        return absage(
          "Einen Ausschnitt kann `readPage` in dieser Fassung nicht lesen.",
          "`extract` mit `region` nehmen — das liest genau diesen Bereich.",
          "not_supported"
        );
      }
      return { ok: true, plan: { offscreen: r.includeOffscreen === true } };
    }

    /* ------------------------------------------------------------- */
    case "get_state":
      return { ok: true, plan: {} };

    /* ------------------------------------------------------------- */
    case "scroll": {
      /* Ein eigener Bildlaufbereich ist nicht gebaut. Ihn zu ignorieren hieße,
         stattdessen das Fenster zu scrollen und Erfolg zu melden — dieselbe
         Falschaussage wie bei der fehlenden Richtung. */
      if (!fehltDas(r.container)) {
        return absage(
          "Einen eigenen Bildlaufbereich kann ich nicht scrollen.",
          "Mit `ref` zu einem Element scrollen — der Bereich folgt dann von selbst.",
          "not_supported"
        );
      }

      if (!fehltDas(r.ref)) {
        const ref = refPruefen(r.ref);
        if (!ref) {
          return absage(
            "Diese Referenz hat nicht die Form, die eine Referenz hat.",
            "`ref` aus der letzten Wahrnehmung nehmen, zum Beispiel `e12`."
          );
        }
        /* Zu einem Element scrollen: Die Richtung ergibt sich aus dem Ort des
           Elements, sie darf hier fehlen. */
        return { ok: true, plan: { ref, richtung: null, menge: null } };
      }

      if (typeof r.direction !== "string" || !SCROLL_RICHTUNGEN.has(r.direction)) {
        return absage(
          fehltDas(r.direction)
            ? "Zum Scrollen fehlt die Richtung."
            : "Diese Bildlaufrichtung kenne ich nicht.",
          `\`direction\` mitsenden: ${[...SCROLL_RICHTUNGEN].join(", ")} — oder \`ref\`, um zu einem Element zu scrollen.`
        );
      }

      /* `amount` darf fehlen: Es bestimmt die Weite, nicht die Richtung. Eine
         ganze Seite ist die Einheit, in der auch ein Mensch blättert. */
      let menge = "page";
      if (!fehltDas(r.amount)) {
        if (typeof r.amount === "number") {
          if (!Number.isFinite(r.amount) || r.amount <= 0 || r.amount > GRENZEN.scrollPixel) {
            return absage(
              "Diese Schrittweite ergibt keinen Bildlauf.",
              `\`amount\` als Pixelzahl zwischen 1 und ${GRENZEN.scrollPixel} — oder page/half.`
            );
          }
          menge = Math.round(r.amount);
        } else if (typeof r.amount === "string" && SCROLL_MENGEN.has(r.amount)) {
          menge = r.amount;
        } else {
          /* Auch "800" als Zeichenkette landet hier. Umzudeuten wäre bequem und
             falsch: Der nächste Aufruf schickte dann "acht" und bekäme 0. */
          return absage(
            "Diese Schrittweite kenne ich nicht.",
            `\`amount\`: ${[...SCROLL_MENGEN].join(", ")} oder eine Pixelzahl bis ${GRENZEN.scrollPixel}.`
          );
        }
      }
      return { ok: true, plan: { ref: null, richtung: r.direction, menge } };
    }

    /* ------------------------------------------------------------- */
    case "highlight":
    case "click": {
      const ref = refPruefen(r.ref);
      if (!ref) {
        return absage(
          fehltDas(r.ref) ? "Dazu fehlt die Referenz des Elements." : "Diese Referenz hat nicht die Form, die eine Referenz hat.",
          "`readPage` aufrufen und eine Referenz aus der Wahrnehmung nehmen, zum Beispiel `e12`."
        );
      }
      return { ok: true, plan: { ref } };
    }

    /* ------------------------------------------------------------- */
    case "type": {
      const ref = refPruefen(r.ref);
      if (!ref) {
        return absage(
          fehltDas(r.ref) ? "Zum Tippen fehlt das Feld." : "Diese Referenz hat nicht die Form, die eine Referenz hat.",
          "`readPage` aufrufen und ein Feld mit Rolle textbox wählen."
        );
      }
      if (typeof r.text !== "string") {
        return absage("Zum Tippen fehlt der Text.", "`text` mitsenden — auch der leere Text ist einer.");
      }
      if (r.text.length > GRENZEN.tippZeichen) {
        return absage(
          `Der Text ist länger als die ${GRENZEN.tippZeichen} Zeichen, die in ein Feld gehen.`,
          "In kürzere Eingaben aufteilen."
        );
      }
      if (!fehltDas(r.clear) && typeof r.clear !== "boolean") {
        return absage("`clear` ist ein Ja/Nein-Feld.", "true (Feld leeren, Vorgabe) oder false (anhängen).");
      }
      if (!fehltDas(r.submit) && typeof r.submit !== "boolean") {
        return absage("`submit` ist ein Ja/Nein-Feld.", "true (nach der Eingabe Enter) oder false (Vorgabe).");
      }
      /* `clear` ist in spec-01 §5.2 mit `true` vorbelegt — eine Vorgabe, die
         das Ergebnis nicht umkehrt, sondern den Normalfall trifft. Weicht der
         Agent davon ab, steht es in der Frage an den Menschen. */
      return {
        ok: true,
        plan: { ref, text: r.text, leeren: r.clear !== false, absenden: r.submit === true },
      };
    }

    /* ------------------------------------------------------------- */
    case "select": {
      const ref = refPruefen(r.ref);
      if (!ref) {
        return absage(
          fehltDas(r.ref) ? "Zum Auswählen fehlt das Auswahlfeld." : "Diese Referenz hat nicht die Form, die eine Referenz hat.",
          "`readPage` aufrufen und ein Feld mit Rolle combobox oder listbox wählen."
        );
      }

      const wege = [];
      if (!fehltDas(r.value)) {
        if (typeof r.value !== "string" || !r.value.trim()) {
          return absage("`value` war keine brauchbare Angabe.", "Den Wert der Option als Zeichenkette mitsenden.");
        }
        wege.push({ art: "wert", wert: r.value, anzeige: `„${saeubern(r.value, 80)}"` });
      }
      if (!fehltDas(r.label)) {
        if (typeof r.label !== "string" || !r.label.trim()) {
          return absage("`label` war keine brauchbare Angabe.", "Die sichtbare Beschriftung der Option mitsenden.");
        }
        wege.push({ art: "etikett", wert: r.label, anzeige: `„${saeubern(r.label, 80)}"` });
      }
      if (!fehltDas(r.index)) {
        if (!Number.isInteger(r.index) || r.index < 0 || r.index > 999) {
          return absage("`index` war keine Nummer einer Option.", "Eine ganze Zahl ab 0 mitsenden.");
        }
        wege.push({ art: "index", wert: r.index, anzeige: `die Option mit der Nummer ${r.index}` });
      }

      if (!wege.length) {
        return absage(
          "Zum Auswählen fehlt, WAS gewählt werden soll.",
          "Genau eines mitsenden: `value`, `label` oder `index`."
        );
      }
      if (wege.length > 1) {
        /* Zwei Angaben können auf zwei verschiedene Optionen zeigen. Eine davon
           zu bevorzugen wäre eine Wahl, die niemand getroffen hat. */
        return absage(
          `Ich habe ${wege.length} Angaben zur Auswahl bekommen (${wege.map((w) => w.art).join(", ")}).`,
          "Genau eine mitsenden: `value`, `label` oder `index`."
        );
      }

      const weg = wege[0];
      return {
        ok: true,
        plan: {
          ref,
          art: weg.art,
          wert: weg.art === "wert" ? weg.wert : null,
          etikett: weg.art === "etikett" ? weg.wert : null,
          index: weg.art === "index" ? weg.wert : null,
          anzeige: weg.anzeige,
        },
      };
    }

    /* ------------------------------------------------------------- */
    case "navigate": {
      const url = typeof r.url === "string" ? r.url.trim() : "";
      const host = hostAus(url);
      if (!host) {
        return absage(
          "Das ist keine Adresse, die ich aufrufen kann.",
          "`url` mitsenden: eine vollständige Adresse mit https:// — kein javascript:, data:, file: oder chrome:."
        );
      }
      /* Die Bereichsprüfung steht VOR der Freigabefrage. Andernfalls bestätigte
         der Mensch eine Adresse, die die Erweiterung danach selbst ablehnt —
         und lernte, dass seine Zustimmung nichts bedeutet. */
      const befund = bereichBefund(url, lage.sitzung);
      if (!befund.ok) {
        const erlaubt = Array.isArray(lage.sitzung && lage.sitzung.bereich)
          ? lage.sitzung.bereich.slice(0, 3).map((e) => saeubern(e, 60)).join(", ")
          : "";
        /* Der Grund muss der wahre sein. „bank.de liegt außerhalb der Freigabe"
           ist für einen Menschen, der bank.de freigegeben hat, keine Auskunft,
           sondern ein Rätsel — und wer das Rätsel nicht löst, hält die
           Erweiterung für kaputt statt die Adresse für falsch. */
        if (befund.grund === "schema") {
          return {
            ok: false,
            code: "scope_violation_local",
            satz: `Die Adresse ${saeubern(host, 60)} soll unverschlüsselt aufgerufen werden, freigegeben ist sie nur verschlüsselt. Diese Herabstufung mache ich nicht mit.`,
            hinweis: "Dieselbe Adresse mit https:// aufrufen. Über http läse jeder im selben Netz mit, und ändern könnte er die Seite auch.",
            retryable: false,
          };
        }
        if (befund.grund === "port") {
          return {
            ok: false,
            code: "scope_violation_local",
            satz: `Die Adresse ${saeubern(host, 60)} soll über den Port ${saeubern(befund.ziel.port, 8)} aufgerufen werden, und dieser Port ist nicht freigegeben. Dorthin gehe ich nicht.`,
            hinweis: "Ein anderer Port ist ein anderer Dienst. Den Nutzer um eine Freigabe für genau diesen Port bitten.",
            retryable: false,
          };
        }
        return {
          ok: false,
          code: "scope_violation_local",
          satz: `Die Adresse ${saeubern(host, 60)} liegt außerhalb der Freigabe. Dorthin gehe ich nicht.`,
          hinweis: erlaubt
            ? `Freigegeben ist: ${erlaubt}. Innerhalb davon rufe ich jede Adresse auf; für alles andere braucht es eine neue Freigabe des Nutzers.`
            : "Den Nutzer um eine Freigabe für diesen Bereich bitten.",
          retryable: false,
        };
      }
      /* Die Frage nennt die GANZE Adresse, nicht nur Host und Pfad (M2). Was
         nicht mehr hineinpasst, wird gezählt — siehe `adressVorschau`. */
      const v = adressVorschau(url);
      return {
        ok: true,
        plan: { url, host, anzeige: v.gezeigt, anzeigeRest: v.rest },
      };
    }

    /* ------------------------------------------------------------- */
    case "back":
      /* Ohne Parameter — und deshalb ohne Prüfung. Die Adresse, auf der der Tab
         danach steht, kennt niemand vorher; sie wird nach dem Wechsel geprüft
         (ausfuehrer.js). */
      return { ok: true, plan: {} };

    /* ------------------------------------------------------------- */
    case "extract": {
      const hatRefs = !fehltDas(r.refs);
      const hatRegion = !fehltDas(r.region);
      if (hatRefs && hatRegion) {
        return absage(
          "Ich habe sowohl Referenzen als auch einen Bereich bekommen.",
          "Genau eines mitsenden: `refs` (Liste) oder `region` (ein Container)."
        );
      }
      if (!hatRefs && !hatRegion) {
        return absage(
          "Zum Ablesen fehlt, WAS gelesen werden soll.",
          "`refs` (Liste von Referenzen) oder `region` (Referenz eines Containers) mitsenden."
        );
      }

      let refs = null;
      let ausgelassen = 0;
      let region = null;

      if (hatRefs) {
        if (!Array.isArray(r.refs) || !r.refs.length) {
          return absage("`refs` war keine Liste mit Referenzen.", "Eine nichtleere Liste mitsenden, zum Beispiel [\"e3\",\"e4\"].");
        }
        const geprueft = r.refs.map(refPruefen);
        const schlecht = geprueft.findIndex((x) => x === null);
        if (schlecht >= 0) {
          /* Schlechte Einträge stillschweigend zu verwerfen hieße: Der Agent
             bekommt weniger Zeilen, als er verlangt hat, und hält die Lücke für
             ein Ergebnis der Seite. */
          return absage(
            `Der ${schlecht + 1}. Eintrag in \`refs\` ist keine Referenz.`,
            "Nur Referenzen aus der letzten Wahrnehmung mitsenden, zum Beispiel `e12`."
          );
        }
        refs = geprueft.slice(0, GRENZEN.extraktRefs);
        ausgelassen = geprueft.length - refs.length;
      } else {
        region = refPruefen(r.region);
        if (!region) {
          return absage(
            "`region` ist keine Referenz.",
            "Die Referenz eines Containers aus der letzten Wahrnehmung mitsenden."
          );
        }
      }

      let felder = null;
      if (!fehltDas(r.fields)) {
        if (!Array.isArray(r.fields)) {
          return absage("`fields` war keine Liste.", "Eine Liste gewünschter Feldnamen mitsenden — oder das Feld weglassen.");
        }
        const sauber = r.fields
          .filter((f) => typeof f === "string" && f.trim())
          .map((f) => saeubern(f, 40))
          .slice(0, GRENZEN.extraktFelder);
        if (!sauber.length) {
          return absage("`fields` enthielt keinen brauchbaren Feldnamen.", "Feldnamen als Zeichenketten mitsenden — oder das Feld weglassen.");
        }
        felder = sauber;
      }

      return { ok: true, plan: { refs, region, felder, ausgelassen } };
    }

    /* ------------------------------------------------------------- */
    case "waitFor": {
      const gesetzt = [];
      for (const name of WARTE_BEDINGUNGEN) {
        const wert = r[name];
        if (fehltDas(wert)) continue;

        if (name === "idle") {
          /* `idle: false` ist keine Bedingung, sondern das Gegenteil einer —
             es zählt wie „nicht gesetzt". `idle: "ja"` dagegen ist ein Rahmen,
             der etwas anderes meint, als er sagt. */
          if (wert === true) gesetzt.push({ name, wert: true });
          else if (wert !== false) {
            return absage("`idle` ist ein Ja/Nein-Feld.", "true mitsenden, um auf Ruhe zu warten.");
          }
          continue;
        }

        if (name === "refGone" || name === "refVisible") {
          const ref = refPruefen(wert);
          if (!ref) {
            return absage(`\`${name}\` ist keine Referenz.`, "Eine Referenz aus der letzten Wahrnehmung mitsenden, zum Beispiel `e12`.");
          }
          gesetzt.push({ name, wert: ref });
          continue;
        }

        if (typeof wert !== "string" || !wert.trim()) {
          return absage(`\`${name}\` war leer.`, "Den Text mitsenden, auf den gewartet werden soll.");
        }
        gesetzt.push({ name, wert: saeubern(wert, 200) });
      }

      if (!gesetzt.length) {
        return absage(
          "Zum Warten fehlt die Bedingung.",
          `Genau eine mitsenden: ${WARTE_BEDINGUNGEN.join(", ")}.`
        );
      }
      if (gesetzt.length > 1) {
        /* Mehrere Bedingungen wären ein Und oder ein Oder — und welches davon,
           stünde nirgends. Raten hieße hier: eine Sekunde später behauptet die
           Erweiterung etwas über einen Zustand, auf den sie nie gewartet hat. */
        return absage(
          `Ich habe ${gesetzt.length} Bedingungen bekommen (${gesetzt.map((g) => g.name).join(", ")}).`,
          `Genau eine mitsenden: ${WARTE_BEDINGUNGEN.join(", ")}.`
        );
      }

      /* Die eigene Frist ist die Obergrenze. Länger zu warten, als der Relay
         wartet, hieße: Die Antwort käme nach dem Zeitablauf — also nie. */
      const deckel = Math.max(1000, Number(lage.fristMs) || 0);
      let wartenMs = deckel;
      let gedeckelt = false;
      if (!fehltDas(r.waitSeconds)) {
        if (typeof r.waitSeconds !== "number" || !Number.isFinite(r.waitSeconds) || r.waitSeconds <= 0) {
          return absage("`waitSeconds` war keine Wartezeit.", "Eine Sekundenzahl größer als 0 mitsenden.");
        }
        const gewuenscht = Math.round(r.waitSeconds * 1000);
        wartenMs = Math.min(deckel, gewuenscht);
        gedeckelt = gewuenscht > wartenMs;
      }

      const g = gesetzt[0];
      return {
        ok: true,
        plan: { bedingung: g.name, wert: g.wert, wartenMs, gedeckelt },
      };
    }

    /* ------------------------------------------------------------- */
    case "screenshot": {
      const anlass = typeof r.screenshotReason === "string" ? r.screenshotReason.trim() : "";
      if (!anlass || !BILD_ANLAESSE.has(anlass)) {
        /* Pflichtfeld ohne Vorgabe. Ein Bild ist teuer und zeigt alles, was auf
           dem Schirm steht — wer es will, muss sagen, warum. */
        return {
          ok: false,
          code: "screenshot_not_justified",
          satz: anlass
            ? "Diesen Anlass für ein Bild kenne ich nicht."
            : "Ohne benannten Anlass nehme ich kein Bild auf.",
          hinweis: `\`screenshotReason\` mitsenden: ${[...BILD_ANLAESSE].join(", ")}. Für gewöhnliches Lesen ist \`readPage\` der Weg.`,
          retryable: false,
        };
      }
      if (!fehltDas(r.area) && r.area !== "viewport") {
        return absage(
          "Aufnehmen kann ich nur den sichtbaren Ausschnitt.",
          "`area: \"viewport\"` — für ein einzelnes Element sind `highlight` und `extract` da.",
          "not_supported"
        );
      }
      return { ok: true, plan: { anlass, bereich: "viewport" } };
    }

    /* ------------------------------------------------------------- */
    case "run_workflow": {
      /* Die Kennung ist eng gefasst, weil sie zum Schlüssel in der Ablage
         wird: Was hier durchkommt, landet in `sa_workflows` und wird später
         zum Abspielen wieder herausgesucht. Ein Name mit Punkten, Schrägstrich
         oder Leerzeichen wäre ein Schlüssel, den zwei Stellen verschieden
         lesen — und der Ablauf, der dann läuft, wäre nicht der, den der Mensch
         gemeint hat. */
      const id = typeof r.id === "string" ? r.id.trim() : "";
      if (!WORKFLOW_ID_MUSTER.test(id)) {
        return absage(
          fehltDas(r.id)
            ? "Zum Abspielen fehlt die Kennung des Ablaufs."
            : "Diese Kennung hat nicht die Form, die eine Ablaufkennung hat.",
          "`id` mitsenden, zum Beispiel `wf_ebay_relist`: `wf_`, dann Kleinbuchstaben, Ziffern oder Unterstriche."
        );
      }
      const werte = paramsPruefen(r.params);
      if (!werte.ok) return absage(werte.satz, werte.hinweis);
      /* Ob es diesen Ablauf überhaupt gibt und ob seine Platzhalter zu den
         Werten passen, entscheidet `werkstatt.js` — dort liegt die Ablage.
         Hier wird nur der Rahmen geprüft, und zwar VOR der Frage an den
         Menschen, damit er nichts bestätigt, das danach an einem Tippfehler
         in der Kennung scheitert. */
      return {
        ok: true,
        plan: { id, params: werte.params, anzahl: Object.keys(werte.params).length },
      };
    }

    /* ------------------------------------------------------------- */
    default:
      /* Unbekannte Befehle kommen hier gar nicht an — die Positivliste steht
         vorher. Diese Zeile ist die Zusicherung, dass ein neuer Eintrag in
         `BEFEHLE` ohne Prüfung trotzdem einen Plan hat statt `undefined`. */
      return { ok: true, plan: {} };
  }
}

/**
 * Der Zusatz zur Freigabefrage: WAS genau gleich geschieht.
 *
 * Alles hier stammt aus dem Rahmen des Agenten, nichts von der besuchten Seite.
 * Das ist die Bedingung dafür, dass es überhaupt in der Frage stehen darf —
 * Seitentext geht ausschließlich abgesetzt in `quelle` und wird nicht
 * vorgelesen (spec-01 §4.4.1).
 */
export function frageZusatz(cmd, plan) {
  if (!plan) return "";

  if (cmd === "type") {
    const v = tippVorschau(plan.text);
    /* Der leere Text mit `clear` ist kein Tippen, sondern ein Löschen. Ihn als
       „Er will schreiben: ,'" zu zeigen, wäre die Frage, bei der niemand
       versteht, wofür er zustimmt. */
    if (!v.gezeigt && plan.leeren) {
      return plan.absenden ? " Er will das Feld leeren und absenden." : " Er will das Feld leeren.";
    }
    const anfang = plan.leeren ? "Er will schreiben" : "Er will an den vorhandenen Text anhängen";
    let s = ` ${anfang}: „${v.gezeigt}"`;
    if (v.rest) s += ` … und weitere ${v.rest} Zeichen`;
    /* Komma statt Gedankenstrich: dieser Zusatz wird dem Menschen vorgelesen,
       und ein Gedankenstrich wird als Wort gesprochen. */
    s += plan.absenden ? ", und die Eingabe dann absenden." : ".";
    return s;
  }
  if (cmd === "select") return ` Er will ${plan.anzeige} auswählen.`;
  if (cmd === "navigate") {
    /* Auch hier gilt F2: Was nicht mehr in die Frage passt, wird beziffert und
       nicht verschwiegen. Eine Adresse, von der man nicht weiß, dass sie
       weitergeht, ist eine andere Adresse. */
    let s = ` Ziel: ${plan.anzeige}`;
    if (plan.anzeigeRest) s += ` … und weitere ${plan.anzeigeRest} Zeichen`;
    return `${s}.`;
  }
  if (cmd === "waitFor") {
    /* `eigen` und nicht der nackte Zugriff (H2 vom 14.08.2026): Die Bedingung
       ist hier zwar schon geprüft, aber diese Zeile RUFT, was sie findet —
       und `WARTE_FRAGE["constructor"]` fände eine Funktion. */
    const satz = eigen(WARTE_FRAGE, plan.bedingung);
    return typeof satz === "function" ? ` Er wartet darauf, ${satz(plan.wert)}.` : "";
  }
  if (cmd === "run_workflow") {
    /* WELCHER Ablauf gleich läuft, gehört in die Frage. „Einen gespeicherten
       Ablauf abspielen?" allein ist keine Frage, sondern eine Ankündigung:
       Der Mensch hat womöglich zwölf Abläufe, und einer davon stellt eBay-
       Artikel neu ein, während ein anderer ein Konto schließt.

       Der Name kommt aus der Werkbank des Menschen, nicht von der besuchten
       Seite. Steht er nicht im Plan, weil die Ablage noch nicht befragt wurde,
       nennt die Frage die Kennung, denn eine Kennung ist mehr als nichts. */
    const wie = plan.name
      ? `„${saeubern(plan.name, 80)}"`
      : `mit der Kennung ${saeubern(plan.id, 60)}`;
    let s = ` Er will den gespeicherten Ablauf ${wie} abspielen`;
    if (plan.schritte) s += `, ${plan.schritte} Schritte`;
    if (plan.anzahl) s += `, und dafür ${plan.anzahl} ${plan.anzahl === 1 ? "Wert" : "Werte"} einsetzen`;
    return `${s}.`;
  }
  return "";
}

/* --------------------------------------------------------------------- *
 * Betriebsmodi, Aktionsklassen und die Entscheidung „fragen oder nicht"
 * (Vertrag v3.5 §2, §3)
 *
 * Warum das hier steht und nicht im Ausführer: Es ist die Stelle, an der
 * entschieden wird, ob ein Mensch gefragt wird. Genau diese Stelle muss ohne
 * Browser prüfbar sein — dasselbe Argument wie im Kopf der Datei, nur mit
 * höherem Einsatz.
 *
 * Und die Regel, die über dem ganzen Abschnitt steht:
 *
 *   **Der Klassifizierer liest Text von der besuchten Seite. Ein Treffer darf
 *   ausschliesslich MEHR Rückfrage auslösen, niemals weniger.**
 *
 * Das ist keine Stilfrage, sondern der Grund, warum man Seitentext überhaupt
 * lesen darf. Ein Fehlalarm kostet eine Rückfrage. Ein übersehener Treffer
 * fällt auf das zurück, was der Modus ohnehin getan hätte. Würde ein Treffer
 * dagegen eine Klasse ENTFERNEN, dann hätte die besuchte Seite einen Weg,
 * sich selbst freizuschalten: Es genügte, das richtige Wort irgendwo
 * hinzuschreiben. Deshalb ist `klassenBestimmen` rein additiv gebaut, und
 * deshalb misst ein Prüfsatz genau das und nicht nur einzelne Beispiele.
 * --------------------------------------------------------------------- */

export const MODI = Object.freeze(["manual", "assist", "auto"]);
export const MODUS_STANDARD = "assist";

/* Der Modus gilt je Tab und liegt in `chrome.storage.session` (§2). Der
   Schlüssel steht hier, damit ihn nicht drei Dateien getrennt eintippen; die
   Ablage selbst rührt diese Datei nicht an, sie sieht keinen Browser. */
export const MODUS_ABLAGE = "sa_modus";

export const KLASSEN = Object.freeze([
  "lesen", "bedienen", "navigieren",
  "senden", "formular", "tab_neu",
  "datei", "geheim", "zahlung", "unwiderruflich", "berechtigung", "captcha",
]);

/** Nie abschaltbar. Auch im Modus `auto` wird hier gefragt. */
export const HART = Object.freeze(new Set(
  ["datei", "geheim", "zahlung", "unwiderruflich", "berechtigung", "captcha"]));

/** Je Domain freischaltbar. Voreinstellung: aus. */
export const WEICH = Object.freeze(new Set(["senden", "formular", "tab_neu"]));

/* Wie eine Klasse in einem Satz heisst, der einem Menschen vorgelesen wird. */
const KLASSE_TEXT = Object.freeze({
  lesen: "Lesen",
  bedienen: "Bedienen",
  navigieren: "Ein Ortswechsel",
  senden: "Etwas absenden",
  formular: "Ein Formular abschicken",
  tab_neu: "Ein neuer Tab",
  datei: "Eine Datei",
  geheim: "Ein Geheimnis",
  zahlung: "Eine Zahlung",
  unwiderruflich: "Etwas Unwiderrufliches",
  berechtigung: "Eine Browser-Berechtigung",
  captcha: "Ein Menschentest",
});

/*
 * Die Wortlisten.
 *
 * Sie stehen als benannte Konstanten da, damit ein Prüfsatz sie wortweise
 * messen kann. Eine Liste, die mitten in einer Funktion steht, ändert sich
 * beiläufig, und ein Schutz, der sich beiläufig ändert, hört beiläufig auf,
 * geprüft zu sein.
 *
 * Geschrieben sind sie in der Ersatzschreibweise (ae, oe, ue, ss) und
 * kleingeschrieben. Der Grund ist die Gegenseite: `flachmachen` bringt den
 * Seitentext in genau dieselbe Form, bevor verglichen wird. „Löschen",
 * „LÖSCHEN" und „Loeschen" sind für einen Menschen dasselbe Wort, und für
 * einen Angreifer wäre der Unterschied sonst der billigste Weg vorbei.
 *
 * Deutsch UND englisch, weil die halbe Netzoberfläche englisch beschriftet
 * ist, auch auf deutschen Seiten („Checkout", „Submit", „Delete account").
 */

/* Wie lang ein Wort sein muss, damit es auch MITTEN in einem Wort zählt.

   Befund M2 der Gegenlesung vom 29.07.2026, hier in seiner allgemeinen Form:
   „pin" steckt in „shipping", „tan" in „Standort", „code" in „Postleitzahl-
   code". Kurze Wörter als Wortstück zu suchen, macht aus einer Erkennung eine
   Dauerwarnung, und eine Dauerwarnung wird weggeklickt. Lange Wörter dagegen
   MÜSSEN als Wortstück zählen, weil Deutsch zusammensetzt: „Kontolöschung",
   „Sofortüberweisung", „Dateiauswahl". */
const WORT_IM_WORT_AB = 5;

export const WORTE_ZAHLUNG = Object.freeze([
  "kasse", "checkout", "bezahlen", "zahlung", "zahlungsart", "kaufen",
  "bestellen", "bestellung", "ueberweisen", "ueberweisung", "lastschrift",
  "abbuchen", "kreditkarte", "creditcard", "rechnung",
  "pay", "payment", "billing", "order", "purchase", "buy", "iban",
]);

export const WORTE_UNWIDERRUFLICH = Object.freeze([
  "loeschen", "loeschung", "entfernen", "kuendigen", "kuendigung",
  "schliessen", "deaktivieren", "widerrufen", "verwerfen", "unwiderruflich",
  "endgueltig", "zuruecksetzen",
  "delete", "remove", "cancel", "deactivate", "terminate", "revoke", "wipe",
]);

export const WORTE_GEHEIM = Object.freeze([
  "passwort", "kennwort", "passphrase", "password", "passcode",
  "pin", "otp", "2fa", "mfa", "tan", "itan", "mtan", "puk",
  "einmalcode", "einmalkennwort", "bestaetigungscode", "verifizierungscode",
  "sicherheitscode", "sicherheitsnummer", "pruefziffer",
  "cvv", "cvc", "csc", "code", "secret", "geheim", "credential", "authenticator",
]);

export const WORTE_DATEI = Object.freeze([
  "datei", "dateien", "dateiauswahl", "datei waehlen", "datei auswaehlen",
  "hochladen", "herunterladen", "anhang", "anlage", "speichern unter",
  "upload", "download", "file", "attachment",
]);

export const WORTE_BERECHTIGUNG = Object.freeze([
  "kamera", "mikrofon", "standort", "benachrichtigung", "benachrichtigungen",
  "zwischenablage", "bewegungssensor",
  "camera", "microphone", "location", "notification", "notifications",
  "clipboard", "geolocation",
]);

/*
 * Der zweite Halbsatz einer Berechtigungsfrage — und ausdrücklich KEINE
 * Bedingung mehr.
 *
 * Befund vom 14.08.2026 (M1). Bis dahin galt: `berechtigung` entsteht nur,
 * wenn ein Wort aus `WORTE_BERECHTIGUNG` UND eines aus dieser Liste dasteht.
 * Diese Liste kannte „zulassen, erlauben, gestatten, zustimmen, allow, grant,
 * enable" und nicht „aktivieren, einschalten, freigeben, an". „Kamera
 * aktivieren" ergab damit `klassen=[bedienen]` und `fragen=false`.
 *
 * Die Reparatur ist nicht das fehlende Wort, sondern die Bauform. Die Frage
 * war: Darf eine HARTE Klasse überhaupt eine zweite Liste als Bedingung
 * haben? Nein. `HART` heisst „nie abschaltbar, auch in der Automatik" —
 * und eine Bedingung, die aus einer Wortliste kommt, ist ein Schalter: Wer
 * sein Wort nicht in der Liste findet, hat die Wache aus. Ein UND zwischen
 * zwei Listen ist zudem doppelt so leicht zu verfehlen wie eine, denn schon
 * eine Lücke in einer der beiden genügt.
 *
 * Ab jetzt löst `WORTE_BERECHTIGUNG` allein aus. Diese Liste bleibt und wird
 * gepflegt, aber sie entscheidet nichts mehr — sie schärft nur noch den
 * Grund, den der Mensch vorgelesen bekommt. Der Preis ist eine Rückfrage bei
 * einem Elektronikhändler, der eine Kamera verkauft, und das ist genau die
 * erlaubte Richtung: Ein Fehlalarm kostet eine Frage, ein übersehener Treffer
 * kostet die Kamera.
 */
export const WORTE_ZULASSEN = Object.freeze([
  "zulassen", "erlauben", "gestatten", "zustimmen", "freigeben", "freigabe",
  "aktivieren", "einschalten", "anschalten", "bestaetigen",
  "allow", "grant", "enable", "activate", "turn on", "accept",
]);

export const WORTE_CAPTCHA = Object.freeze([
  "captcha", "recaptcha", "hcaptcha", "turnstile",
  "ich bin kein roboter", "i am not a robot", "verify you are human",
]);

export const WORTE_SENDEN = Object.freeze([
  "senden", "absenden", "abschicken", "veroeffentlichen", "posten",
  "kommentieren", "antworten", "bewerben", "abgeben",
  "send", "submit", "post", "publish", "reply", "tweet",
]);

/* Die Muster der Prompt-Einschleusung (§9), DE und EN.

   Sie sind bewusst kurz gehalten: Ein Muster, das eine ganze Anweisung
   wörtlich verlangt, findet nur die Einschleusung, die aus demselben Lehrbuch
   stammt. Ein Treffer beendet nichts, er hält den Modus `auto` an — eine
   Seite, auf der dieser Text steht, kann auch schlicht ein Blogartikel über
   Einschleusung sein. */
export const WORTE_EINSCHLEUSUNG = Object.freeze([
  "ignore previous instructions", "ignore all previous", "disregard all",
  "disregard previous", "system prompt", "act as", "you are now",
  "new instructions", "override your",
  "vergiss alle vorherigen", "vergiss deine anweisungen",
  "ignoriere alle vorherigen", "ignoriere die vorherigen",
  "neue anweisung", "du bist jetzt", "systemanweisung", "systemprompt",
]);

/**
 * Fremdtext in die eine Form bringen, in der verglichen wird.
 *
 * Die Regel selbst steht nicht mehr hier, sondern in `messrand`
 * (`../gemeinsam/messform.js`) — dieselbe Datei, die auch als Inhaltsskript
 * in der besuchten Seite läuft. Diese Funktion bleibt als Name stehen, weil
 * der ganze Klassifizierer sie so nennt.
 *
 * Was `messrand` liefert und warum:
 *
 *  1. **Unsichtbare Zeichen fallen ersatzlos weg** (Befund AUTOMODUS-1 vom
 *     14.08.2026). Vorher machte `saeubern` daraus ein Leerzeichen und diese
 *     Funktion aus jedem Nicht-Alphanumerischen ebenfalls eines: „Jetzt
 *     kau<U+200B>fen" wurde zu „jetzt kau fen", das Wort „kaufen" stand
 *     nirgends, und der Klick lief im Modus `auto` ohne Rückfrage. U+00AD
 *     und U+2060 fehlten in der Liste sogar ganz.
 *  2. **Unicode-Normalform NFKC und Nachfaltung** — „ｋａｕｆｅｎ" und
 *     „ᴋᴀᴜꜰᴇɴ" sind für einen Menschen das Wort, für einen Vergleich waren
 *     sie es nicht.
 *  3. **Randleerzeichen**, damit aus der Suche nach `" pin "` eine Suche nach
 *     dem ganzen Wort wird, auch am Anfang und am Ende.
 *  4. **Ohne Längengrenze**, und das ist der Befund H1 vom 14.08.2026. Bis
 *     dahin stand hier `grenze = 400`, und `saeubern` kürzt in der MITTE:
 *     Kopf und Fuss bleiben, die Mitte fällt weg. Gemessen wurde ein Klick
 *     auf „Weiter" unter `https://shop.de/kasse/bezahlen` mit einer Rückfrage
 *     — und derselbe Klick unter `https://shop.de/<250 Zeichen>/kasse/<250
 *     Zeichen>` mit KEINER: Das Wort „kasse" stand in der weggeschnittenen
 *     Mitte.
 *
 *     Damit bestimmte die besuchte Seite selbst, ob eine als nie abschaltbar
 *     zugesagte Wache greift; es genügte eine lange Adresse. Die Lehre ist
 *     keine über Zahlen, sondern über die Bauform:
 *
 *       **Eine Sicherheitsprüfung kürzt ihren Eingang nicht.**
 *
 *     Gekürzt wird ausschliesslich dort, wo Text ANGEZEIGT oder gespeichert
 *     wird (`saeubern` mit seinen Deckeln). Was gemessen wird, wird ganz
 *     gemessen. Teuer ist das nicht: Gesucht werden ein paar Dutzend kurze
 *     Wörter in einer Adresse oder einem Elementnamen, und
 *     `einschleusungVerdacht` liest aus demselben Grund seit jeher den ganzen
 *     Textbaum.
 */
function flachmachen(roh) {
  return messrand(roh);
}

/**
 * Welches Wort der Liste steht in diesem Text?
 *
 * Gesucht wird in BEIDEN Lesarten des Textes (`messvarianten`): einmal mit
 * unsichtbaren Zeichen ersatzlos entfernt, einmal mit ihnen als Lücke. Ein
 * Nullbreiten-Zeichen kann ein Wort zerschneiden („kau<U+200B>fen") UND zwei
 * Wörter zusammenkleben („ignore<U+200B>previous"); wer sich für eine der
 * beiden Lesarten entscheidet, macht die andere zum offenen Weg vorbei
 * (Befund AUTOMODUS-1 und seine Kehrseite, gemessen an E1). Ein Treffer in
 * EINER Lesart genügt — mehr Rückfrage ist hier die erlaubte Richtung.
 *
 * @returns {string|null} das Wort aus UNSERER Liste, nie der Fremdtext selbst
 */
function wortTreffer(text, worte) {
  const formen = messvarianten(text);
  if (!formen.length) return null;
  for (const wort of worte) {
    for (const flach of formen) {
      if (wort.length >= WORT_IM_WORT_AB) {
        if (flach.includes(wort)) return wort;
      } else if (flach.includes(` ${wort} `)) {
        return wort;
      }
    }
  }
  return null;
}

/* Die Grundklasse eines Befehls (§3.1, Zeilen `lesen`, `bedienen`,
   `navigieren`). `run_workflow` steht hier ABSICHTLICH nicht: Der Vertrag
   ordnet ihm keine Klasse zu, und eine selbst erfundene wäre entweder zu
   milde oder eine Behauptung über Schritte, die noch niemand gesehen hat.
   Ohne Klasse fragt `freigabeNoetig` in jedem Modus, und das ist für einen
   Befehl, der eine ganze Reihe von Schritten anstösst, die richtige Antwort. */
const GRUNDKLASSE = Object.freeze({
  readPage: "lesen", snapshot: "lesen", get_state: "lesen", scroll: "lesen",
  extract: "lesen", waitFor: "lesen", screenshot: "lesen", highlight: "lesen",
  click: "bedienen", type: "bedienen", select: "bedienen",
  navigate: "navigieren", back: "navigieren",
});

/*
 * Der Weg einer Adresse in der Form, in der er GEMESSEN wird.
 *
 * Die Regel steht in `messweg` (`../gemeinsam/messform.js`), damit sie auch
 * der Inhaltsseite zur Verfügung steht und es sie genau einmal gibt. Sie
 * liefert Pfad, Suche UND Fragment, jedes davon zusätzlich prozentausgepackt,
 * und die rohe Form bleibt daneben stehen.
 *
 * Zwei Befunde vom 14.08.2026 stecken darin:
 *
 *   AUTOMODUS-3: Hier stand `u.pathname`, und `new URL().pathname` dekodiert
 *   Prozentfolgen NICHT. `navigate` auf `https://shop.de/%6Basse/%62ezahlen`
 *   lief im Modus `auto` ohne Rückfrage durch, die unkodierte Fassung
 *   `/kasse/bezahlen` fragte — obwohl der Server dieselbe Seite ausliefert.
 *
 *   AUTOMODUS-4: `u.hash` fiel ganz weg. `https://shop.de/#/konto/loeschen`
 *   trug damit für den Klassifizierer nur einen Schrägstrich, obwohl bei
 *   Einzelseiten-Anwendungen (Vue, Angular, ältere React-Oberflächen) der
 *   ganze Weg im Fragment steht und der Agent die Adresse selbst wählt.
 *
 * Unverändert: Der Wirt bleibt draussen. Der Vertrag nennt in §3.1
 * ausdrücklich den „Adresspfad" — ein Wirt namens `paypal.de` macht aus einem
 * Lesebefehl keine Zahlung, ein Pfad `/checkout/zahlung` sehr wohl. Und lässt
 * sich die Adresse nicht zerlegen, wird sie ganz genommen: mehr Text heisst
 * hier mehr Rückfrage, und das ist die erlaubte Richtung.
 */
function wegVon(roh) {
  return messweg(roh);
}

/*
 * Der Adresstext, den der Klassifizierer misst: wo der Tab steht UND wohin
 * dieser Schritt ihn bringt.
 *
 * Befund vom 14.08.2026 (B1). Bis dahin las diese Funktion ausschliesslich
 * `kopf.url`, und der Ausführer stellte dort die Adresse hinein, auf der der
 * Tab GERADE steht. Bei `navigate` wurde damit die Seite gemessen, die
 * verlassen wird, und nie das Ziel: Ein Tab auf `https://shop.de/artikel/12345`
 * durfte in der Automatik ohne eine einzige Rückfrage
 * `https://shop.de/order/confirm?buy=1` aufrufen. Ein Ein-Klick-Kauf per GET
 * war damit stumm auslösbar, ebenso `/kasse/bezahlen`,
 * `/konto/loeschen?bestaetigen=1` und `/download/rechnung.exe`.
 *
 * Gemessen werden jetzt BEIDE, und die Herkunft bleibt ausdrücklich drin: Die
 * Reparatur einer fehlenden Messung darf nicht darin bestehen, eine andere
 * wegzunehmen. Ein Ortswechsel weg von der Kassenseite fragt damit weiterhin
 * — eine Rückfrage zu viel ist die erlaubte Richtung, eine zu wenig nicht.
 *
 * `back` trägt hier nichts ein, denn es HAT kein Ziel: Wohin der Verlauf
 * führt, weiss vor dem Sprung niemand, auch der Browser sagt es nicht. Etwas
 * zu erfinden wäre schlimmer als nichts, deshalb misst `back` die Herkunft und
 * die zweite Wache greift nach dem Sprung (ausfuehrer.js, `nachDemWechsel`):
 * Dort steht die neue Adresse wirklich fest, und dort wird sie gegen Bereich
 * und Sperrliste gehalten, bevor irgendetwas gelesen wird.
 */
function adressText(kopf) {
  const hier = wegVon(kopf && kopf.url);
  const hin = wegVon(kopf && kopf.ziel);
  if (!hin) return hier;
  return hier ? `${hier} ${hin}` : hin;
}

/**
 * Welche Aktionsklassen trägt dieser Schritt?
 *
 * @param {string} cmd    Befehlsname aus BEFEHLE
 * @param {object} plan   geprüftes Ergebnis aus parameterPruefen
 * @param {object|null} ziel  {ref, name, rolle, rect, mitte} oder null
 * @param {object} kopf   {url, titel, ziel} — `url` ist, wo der Tab steht,
 *                        `ziel` ist, wohin dieser Schritt ihn bringt (B1)
 * @returns {{klassen: string[], hart: string|null, weich: string[], grund: string}}
 *
 * Aus dem Ziel werden zusätzlich drei Angaben gelesen, wenn sie da sind. Sie
 * sind alle optional, weil dieselbe Funktion auch mit einer alten Wahrnehmung
 * arbeiten muss; fehlen sie, fällt der Befund milder aus, nie strenger:
 *
 *   `ziel.marke`          Name des HTML-Elements, kleingeschrieben
 *   `ziel.typ`            das `type`-Merkmal (`file`, `submit`, `password`)
 *   `ziel.formularGeheim` true, wenn das Formular des Ziels ein Geheimfeld
 *                         enthält (das Anmelde-Absenden aus §3.1)
 */
export function klassenBestimmen(cmd, plan, ziel, kopf) {
  /* Klasse -> woran sie erkannt wurde. Es wird ausschliesslich hinzugefügt;
     es gibt in dieser Funktion keine Zeile, die etwas herausnimmt. Genau das
     ist die Zusage, die der Prüfsatz misst. */
  const gefunden = new Map();
  const merken = (klasse, woran) => {
    if (!gefunden.has(klasse)) gefunden.set(klasse, woran);
  };

  const befehl = typeof cmd === "string" ? cmd : "";
  const p = plan && typeof plan === "object" ? plan : {};
  const z = ziel && typeof ziel === "object" ? ziel : null;

  /* `befehl` kommt aus dem Rahmen des Relays, also mit `eigen` (H2). */
  const grundklasse = eigen(GRUNDKLASSE, befehl);
  if (grundklasse) merken(grundklasse, "am Befehl selbst");

  /* Rolle, Marke und Feldtyp gehen durch DIESELBE Messform wie die Wörter.
     Ein blosses `toLowerCase()` verglich hier gegen unsere festen Vokabeln
     („button", „input", „password"), und die besuchte Seite liefert diese
     Angaben — ein unsichtbares Zeichen darin, und `typ === "password"` ist
     falsch. Das ist dieselbe Klasse wie AUTOMODUS-1, nur an einem Vergleich
     auf Gleichheit statt an einer Wortsuche. `messtext` kostet hier nichts:
     „button", „input", „file", „submit" und „password" gehen unverändert
     hindurch. */
  const rolle = z ? messtext(z.rolle) : "";
  const marke = z ? messtext(z.marke) : "";
  const typ = z ? messtext(z.typ) : "";
  const zielText = z ? `${z.name || ""} ${z.rolle || ""}` : "";
  const wegText = adressText(kopf);
  const beides = `${zielText} ${wegText}`;
  /* Die Adresse, auf die dieser Schritt zusteuert — bei `navigate` das Ziel,
     sonst leer. Sie steht getrennt, weil bei einem Ortswechsel die Adresse
     selbst die HANDLUNG ist und nicht bloss der Ort, an dem gelesen wird. */
  const hinText = wegVon(kopf && kopf.ziel);

  /* geheim — Tippen in ein Geheimfeld, und der Klick, der ein Anmeldeformular
     absendet. Der zweite Fall ist der, den man vergisst: Das Passwort steht
     schon im Feld, geklickt wird auf einen Knopf namens „Weiter". */
  if (befehl === "type") {
    const t = wortTreffer(zielText, WORTE_GEHEIM);
    if (t) merken("geheim", `am Wort „${t}"`);
    if (typ === "password") merken("geheim", "an einem Passwortfeld");
  }
  if (befehl === "click" && z && z.formularGeheim === true) {
    merken("geheim", "an einem Formular mit einem Geheimfeld");
  }

  /* zahlung — Name ODER Adresspfad. Auf einer Kassenseite ist auch das Lesen
     eine Rückfrage wert: Was dort steht, ist der Warenkorb eines Menschen. */
  const zahlung = wortTreffer(beides, WORTE_ZAHLUNG);
  if (zahlung) merken("zahlung", `am Wort „${zahlung}"`);

  /* unwiderruflich — am Ziel und an der ZIELadresse, nie an der Herkunft.
     Eine Kontoübersicht unter `/konto/verwalten` ist keine Kündigung, und
     deshalb zählt die Adresse, auf der man ohnehin schon steht, hier nicht.
     Ein Aufruf von `/konto/loeschen?bestaetigen=1` ist die Kündigung selbst:
     Bei einem Ortswechsel ist die Adresse die Handlung, und sie wird vom
     Agenten gewählt, nicht vom Menschen. Befund vom 14.08.2026 (B1), zweiter
     Teil — der erste Anlauf mass nur `zahlung`, `datei` und `captcha` neu und
     liess genau diesen Fall stehen. */
  const weg = wortTreffer(hinText ? `${zielText} ${hinText}` : zielText, WORTE_UNWIDERRUFLICH);
  if (weg) merken("unwiderruflich", `am Wort „${weg}"`);

  /* datei — die Bauform des Elements zählt zuerst. `input[type=file]` öffnet
     den Dateiwähler des Betriebssystems, und was dort passiert, sieht diese
     Erweiterung nicht mehr. */
  if (marke === "input" && typ === "file") merken("datei", "an einem Dateifeld");
  const datei = wortTreffer(beides, WORTE_DATEI);
  if (datei) merken("datei", `am Wort „${datei}"`);

  /* berechtigung — am Berechtigungswort allein (Befund M1 vom 14.08.2026,
     Begründung bei `WORTE_ZULASSEN`). Der zweite Halbsatz macht den Grund
     genauer, er macht die Klasse nicht mehr möglich oder unmöglich. */
  const recht = wortTreffer(zielText, WORTE_BERECHTIGUNG);
  if (recht) {
    const halbsatz = wortTreffer(zielText, WORTE_ZULASSEN);
    merken("berechtigung", halbsatz ? `an den Worten „${recht}" und „${halbsatz}"` : `am Wort „${recht}"`);
  }

  /* captcha — Ziel oder Adresse. Ein Treffer heisst nie „automatisch lösen",
     sondern immer „an den Menschen übergeben" (§3.1). */
  const captcha = wortTreffer(beides, WORTE_CAPTCHA);
  if (captcha) merken("captcha", `am Wort „${captcha}"`);

  /* senden — nur beim Klick. Ein Feld, das „Antworten" heisst, ist ein Feld;
     der Knopf daneben ist die Handlung. */
  if (befehl === "click") {
    const senden = wortTreffer(zielText, WORTE_SENDEN);
    if (senden) merken("senden", `am Wort „${senden}"`);
  }

  /* formular — Tippen mit Absenden, und der Absendeknopf selbst. */
  if (befehl === "type" && p.absenden === true) merken("formular", "am Absenden der Eingabe");
  if (befehl === "click" && rolle === "button" && typ === "submit") {
    merken("formular", "an einem Absendeknopf");
  }

  /* `tab_neu` steht in KLASSEN und in der Einstellungsmatrix, wird aber von
     keinem Befehl ausgelöst: Eine Sitzung kennt genau einen Tab (siehe Kopf
     von BEFEHLE). Die Klasse bleibt, weil eine Matrix mit einem toten
     Schalter lügt; dass sie heute nie ausgelöst wird, hält ein Prüfsatz fest. */

  const klassen = KLASSEN.filter((k) => gefunden.has(k));
  const hart = klassen.find((k) => HART.has(k)) || null;
  const weich = klassen.filter((k) => WEICH.has(k));

  /* Der Grund nennt UNSER Wort, nie den Fremdtext, in dem es stand. Das ist
     der Unterschied zwischen „erkannt an ,kasse'" und dem Vorlesen einer
     fremden Überschrift, und es ist derselbe Grundsatz wie überall hier:
     Seitentext geht nicht in die Frage an den Menschen. */
  /* War der Text, den wir gerade gemessen haben, schon gekürzt, als er hier
     ankam? Dann ist die Messung unvollständig, und Unvollständigkeit ist
     kein Grund zum Durchwinken (Befund AUTOMODUS-2, Begründung bei
     `kuerzungsspur`). Gemessen wird an allem, was von der SEITE stammt; was
     der Agent selbst schickt, kürzt niemand vor der Messung. */
  const unvollstaendig = z ? kuerzungsspur(z.name) || kuerzungsspur(z.rolle) : false;

  const grund = klassen.length
    ? `Erkannt: ${klassen.map((k) => `${KLASSE_TEXT[k]} ${gefunden.get(k)}`).join(", ")}.`
    : "Diesem Schritt konnte ich keine Klasse zuordnen.";

  return { klassen, hart, weich, grund, unvollstaendig };
}

/**
 * Muss der Mensch gefragt werden?
 *
 * @param {string} modus   einer aus MODI
 * @param {object} befund  Ergebnis aus `klassenBestimmen`
 * @param {object} regeln  { gesperrt: boolean, frei: string[] } aus net/matrix.js
 * @returns {{fragen: boolean, sperren: boolean, code: string|null, grund: string}}
 *
 * `sperren` heisst: Die Sperrliste greift, dieser Host fällt in jedem Modus
 * auf Handbetrieb zurück. Der Aufrufer darf hier von sich aus gar nichts tun.
 * `fragen` bleibt trotzdem true, weil der Mensch in diesem Augenblick immer
 * noch Ja sagen darf — es ist seine Bank, nicht unsere.
 *
 * Der Unterschied zwischen `assist` und `auto` ist genau einer: `auto` lässt
 * die je Domain freigeschalteten weichen Klassen durch. Sonst nichts. Wer das
 * Etikett `auto` liest, soll nicht mehr bekommen, als es verspricht.
 */
export function freigabeNoetig(modus, befund, regeln) {
  /* Ein unbekannter Modus wird zu `manual` und nicht zur Voreinstellung.
     `assist` wäre die bequeme Wahl und die falsche: Ein Modus, den niemand
     lesen kann, ist ein Modus, den niemand gesetzt hat. */
  const m = MODI.includes(modus) ? modus : "manual";
  const b = befund && typeof befund === "object" ? befund : {};
  const r = regeln && typeof regeln === "object" ? regeln : {};

  /* Der Befund wird nicht geglaubt, sondern gemessen. Alle drei Felder werden
     zusammengeworfen und danach gegen HART und WEICH gehalten.

     Der Grund ist derselbe wie überall hier: Ein Befund, der eine harte Klasse
     unter `weich` führte oder sie in `klassen` stehen liesse, ohne sie in
     `hart` zu nennen, wäre freischaltbar und damit abschaltbar. Diese Funktion
     ist die letzte Stelle vor der Ausführung; sie darf sich auf die Sorgfalt
     ihres Aufrufers nicht verlassen. */
  const roh = new Set(
    [
      ...(Array.isArray(b.klassen) ? b.klassen : []),
      ...(Array.isArray(b.weich) ? b.weich : []),
      b.hart,
    ].filter((k) => typeof k === "string")
  );
  const klassen = KLASSEN.filter((k) => roh.has(k));
  const hart = klassen.find((k) => HART.has(k)) || null;
  const weich = klassen.filter((k) => WEICH.has(k));
  const frei = (Array.isArray(r.frei) ? r.frei : []).filter((k) => WEICH.has(k));

  if (r.gesperrt === true) {
    return {
      fragen: true,
      sperren: true,
      code: "guardrail_blocked",
      grund: "Diese Seite steht auf der Sperrliste, hier frage ich in jedem Modus.",
    };
  }

  if (hart) {
    return {
      fragen: true,
      sperren: false,
      code: "guardrail_blocked",
      grund: `${KLASSE_TEXT[hart]} ist nie abschaltbar, hier frage ich auch in der Automatik.`,
    };
  }

  /* Die Messung war unvollständig — der Name des Ziels trug die Spur unserer
     eigenen Kürzung, als er gemessen wurde (`kuerzungsspur`). Was in der
     weggeschnittenen Mitte stand, weiss niemand; „nichts gefunden" heisst
     hier „nicht nachgesehen". Deshalb wird gefragt, auch in der Automatik.

     Diese Prüfung steht NACH `hart`, weil eine erkannte harte Klasse den
     genaueren Satz trägt: Wer beides hat, soll den Grund hören, der wirklich
     etwas benennt. Sie steht VOR den weichen Klassen, weil sie sich im
     Gegensatz zu ihnen nicht freischalten lässt. */
  if (b.unvollstaendig === true) {
    return {
      fragen: true,
      sperren: false,
      code: "guardrail_blocked",
      grund: "Der Name des Ziels war schon gekürzt, als ich ihn gemessen habe. Was in der Mitte stand, konnte ich nicht prüfen, deshalb frage ich auch in der Automatik.",
    };
  }

  const zu = weich.filter((k) => !frei.includes(k));
  if (zu.length) {
    return {
      fragen: true,
      sperren: false,
      code: "guardrail_blocked",
      grund: `${KLASSE_TEXT[zu[0]]} ist für diese Seite nicht freigeschaltet.`,
    };
  }

  if (m === "manual") {
    return {
      fragen: true,
      sperren: false,
      code: null,
      grund: "Im Handbetrieb frage ich bei jedem Schritt.",
    };
  }

  if (weich.length) {
    if (m === "auto") {
      return {
        fragen: false,
        sperren: false,
        code: null,
        grund: "Diese Klasse ist für diese Seite freigeschaltet, und der Modus ist Automatik.",
      };
    }
    return {
      fragen: true,
      sperren: false,
      code: null,
      grund: "In der Mitarbeit frage ich auch bei freigeschalteten Klassen.",
    };
  }

  /* Ohne erkannte Klasse wird gefragt. `run_workflow` läuft hier hinein, und
     jeder Befehl, den eine spätere Fassung hinzufügt, ohne an diese Tabelle
     zu denken. Ein neuer Befehl, der still durchläuft, wäre genau die Lücke,
     die niemand bemerkt. */
  const bekannt = klassen.some((k) => k === "lesen" || k === "bedienen" || k === "navigieren");
  if (!bekannt) {
    return {
      fragen: true,
      sperren: false,
      code: null,
      grund: "Diesem Schritt konnte ich keine Klasse zuordnen, deshalb frage ich lieber nach.",
    };
  }

  return {
    fragen: false,
    sperren: false,
    code: null,
    grund: "Lesen, Bedienen und Ortswechsel laufen in diesem Modus durch.",
  };
}

/* --------------------------------------------------------------------- *
 * Schleifenerkennung und Platzhalterwerte (§5, §8.2)
 * --------------------------------------------------------------------- */

/**
 * JSON mit sortierten Schlüsseln.
 *
 * Warum sortiert: Die Marke eines Schrittes wird mit der des vorigen
 * verglichen. Zwei Pläne mit denselben Werten in anderer Reihenfolge sind
 * derselbe Schritt, und eine Schleifenerkennung, die das nicht sieht, erkennt
 * keine einzige Schleife.
 *
 * Sie wirft nie: Ein Plan, der sich nicht abbilden lässt, ergibt „null" und
 * damit eine Marke, die zwar grob, aber vorhanden ist. Eine Ausnahme an dieser
 * Stelle würde einen laufenden Auftrag abbrechen, weil die WACHE stolpert.
 */
export function stabilJson(wert) {
  const sortiert = (w, tiefe) => {
    if (tiefe > 8) return "…"; // schneidet auch Ringe ab, ohne sie zu suchen
    if (w === undefined) return null;
    if (w === null || typeof w !== "object") return w;
    if (Array.isArray(w)) return w.map((e) => sortiert(e, tiefe + 1));
    const raus = {};
    for (const k of Object.keys(w).sort()) raus[k] = sortiert(w[k], tiefe + 1);
    return raus;
  };
  try {
    const t = JSON.stringify(sortiert(wert, 0));
    return typeof t === "string" ? t : "null";
  } catch (_) {
    return "null";
  }
}

/**
 * Der Fingerabdruck eines Schrittes (§5).
 *
 * Der Bildlaufstand gehört dazu, weil dieselbe Aktion an einer anderen Stelle
 * der Seite eine andere Aktion ist: Dreimal „auf den nächsten Knopf klicken"
 * mit wanderndem Bildlauf ist Arbeit, dreimal ohne ist eine Schleife. Er wird
 * auf ganze Pixel gerundet — ein Bildlauf, der um ein Zehntelpixel zittert,
 * darf die Erkennung nicht aushebeln.
 */
export function schrittMarke(cmd, plan, kopf, bildlauf) {
  const c = typeof cmd === "string" ? cmd : "";
  const url = String((kopf && kopf.url) || "");
  const roh = Number(bildlauf && bildlauf.y);
  const y = Number.isFinite(roh) ? Math.round(roh) : 0;
  return `${c}|${stabilJson(plan)}|${url}|${y}`;
}

/* Die Kennung eines Ablaufs und die Namen seiner Platzhalter. Beide stehen
   hier und nicht in werkstatt.js, weil `parameterPruefen` sie braucht und
   zwei Muster für dieselbe Sache auseinanderlaufen, sobald jemand eines
   ändert. */
export const WORKFLOW_ID_MUSTER = /^wf_[a-z0-9_]{1,40}$/;
export const PARAM_NAME_MUSTER = /^[a-zA-Z0-9_]{1,40}$/;

/**
 * Die Werte für einen Ablauf: ein flaches Objekt aus Zeichenketten (§8.2).
 *
 * Zahlen und Wahrheitswerte werden nicht umgedeutet, sondern abgelehnt. Das
 * ist derselbe Befund wie bei `scroll` am 29.07.2026: Wer `12345` still zu
 * „12345" macht, bekommt beim nächsten Mal `null` und tippt „null" in ein
 * Formularfeld.
 *
 * @returns {{ok:true, params:object} | {ok:false, satz:string, hinweis:string}}
 */
export function paramsPruefen(roh) {
  if (fehltDas(roh)) return { ok: true, params: {} };
  if (typeof roh !== "object" || Array.isArray(roh)) {
    return {
      ok: false,
      satz: "`params` war kein Satz von Werten.",
      hinweis: "Ein flaches Objekt mitsenden, zum Beispiel {\"artikelnummer\": \"123\"} — oder das Feld weglassen.",
    };
  }
  const namen = Object.keys(roh);
  if (namen.length > GRENZEN.workflowParams) {
    return {
      ok: false,
      satz: `Ich habe ${namen.length} Werte bekommen, mehr als ${GRENZEN.workflowParams} nehme ich nicht an.`,
      hinweis: `Höchstens ${GRENZEN.workflowParams} Einträge mitsenden.`,
    };
  }
  const params = {};
  for (const name of namen) {
    if (!PARAM_NAME_MUSTER.test(name)) {
      return {
        ok: false,
        satz: `„${saeubern(name, 40)}" ist kein Name für einen Wert.`,
        hinweis: "Namen aus Buchstaben, Ziffern und Unterstrich, höchstens 40 Zeichen.",
      };
    }
    const wert = roh[name];
    if (typeof wert !== "string") {
      return {
        ok: false,
        satz: `Der Wert für „${saeubern(name, 40)}" war keine Zeichenkette.`,
        hinweis: "Alle Werte als Zeichenketten mitsenden, auch Zahlen.",
      };
    }
    if (wert.length > GRENZEN.workflowParamZeichen) {
      return {
        ok: false,
        satz: `Der Wert für „${saeubern(name, 40)}" ist länger als die ${GRENZEN.workflowParamZeichen} Zeichen, die ich annehme.`,
        hinweis: "Kürzer fassen, oder den langen Text über `type` in das Feld schreiben.",
      };
    }
    params[name] = wert;
  }
  return { ok: true, params };
}

/* --------------------------------------------------------------------- *
 * Abwehr von Prompt-Einschleusung (§9)
 * --------------------------------------------------------------------- */

/**
 * Steht in diesem Text der Versuch, dem Agenten neue Anweisungen zu geben?
 *
 * Ein Treffer hält den Modus `auto` an und fällt auf `assist` zurück; er
 * beendet die Sitzung NICHT. Die Erweiterung liest hier fremden Fliesstext,
 * und fremder Fliesstext darf über eine laufende Arbeit nicht endgültig
 * entscheiden: „Ignore previous instructions" steht auch in jedem zweiten
 * Artikel über Prompt-Einschleusung.
 *
 * @returns {{verdacht: boolean, muster: string|null}}
 */
export function einschleusungVerdacht(text) {
  /* Ohne Längengrenze: Gesucht wird im ganzen Textbaum, und ein Satz, der bei
     Zeichen 400 abgeschnitten wird, ist genau der Satz, den ein Angreifer ans
     Ende schreibt. Seit dem Befund H1 vom 14.08.2026 gilt das für JEDE Messung
     an Fremdtext, und `flachmachen` kürzt deshalb gar nicht mehr. */
  /* In BEIDEN Lesarten, aus demselben Grund wie in `wortTreffer`:
     „ignore<U+200B>previous<U+200B>instructions" ist in der einen Lesart ein
     einziges langes Wort und in der anderen der Satz. */
  const formen = messvarianten(text);
  if (!formen.length) return { verdacht: false, muster: null };
  /* Verglichen wird mit Leerzeichen an beiden Rändern, nicht als blosses
     Wortstück. Sonst steckt „act as" in „contract as agreed", und ein
     Kaufvertrag hielte den Automatikmodus an. `flachmachen` setzt an beide
     Enden ein Leerzeichen, damit auch das erste und das letzte Wort so
     gefunden werden. */
  for (const muster of WORTE_EINSCHLEUSUNG) {
    for (const flach of formen) {
      if (flach.includes(` ${muster} `)) return { verdacht: true, muster };
    }
  }
  return { verdacht: false, muster: null };
}

/* --------------------------------------------------------------------- *
 * Der Verdeckungstest vor dem Klick
 *
 * Befund vom 11.08.2026: Vor einem Klick wurde nur nachgeschlagen, OB es das
 * Element noch gibt und ob es eine Fläche hat. Niemand sah nach, ob an dieser
 * Fläche wirklich das Element liegt. Liegt etwas darüber, eine Bannerleiste,
 * ein Zustimmungsfenster, ein durchsichtiger Überzug über der ganzen Seite,
 * dann bekommt der Klick das obere Element, und der Mensch hat das untere
 * gesehen und freigegeben. Das ist keine Ungenauigkeit, das ist eine
 * Falschaussage mit Wirkung: Der Mensch stimmt „Warenkorb" zu und drückt
 * „Alle Cookies annehmen", oder Schlimmeres.
 *
 * Der Test ist der, den auch ein Mensch machen würde: an der Stelle
 * nachsehen, auf die gleich geklickt wird. `document.elementFromPoint` gibt
 * genau das Element zurück, das den Klick an diesem Punkt bekäme — dieselbe
 * Auswahl, die der Browser selbst trifft, samt Stapelreihenfolge,
 * Durchsichtigkeit und `pointer-events`. Selbst zu rechnen wäre wieder die
 * eigene Zeichenkettenarbeit von oben, nur in Geometrie.
 *
 * Drei Feinheiten, an denen ein naiver Vergleich scheitert:
 *
 *  1. **Offene Schattenbäume.** `document.elementFromPoint` bleibt am Wirt
 *     stehen und liefert die Web-Komponente, nicht den Knopf darin. Ein
 *     Vergleich mit dem Ziel schlüge dann fehl, obwohl nichts verdeckt ist,
 *     und die Erweiterung verweigerte genau die Zustimmungsbanner, für die
 *     der Schattenbaum überhaupt betreten wird. Deshalb wird abgestiegen,
 *     solange eine OFFENE Wurzel da ist. Geschlossene Wurzeln haben kein
 *     `shadowRoot`, dorthin kommt auch dieses Skript nicht.
 *  2. **Außerhalb des Sichtfelds.** `elementFromPoint` kennt nur den
 *     sichtbaren Ausschnitt und gibt außerhalb `null`. Ohne eigene Prüfung
 *     hieße das „da liegt nichts", und der wahre Satz ist ein anderer: Das
 *     Ziel ist gar nicht auf dem Schirm.
 *  3. **`pointer-events: none`.** Ein solches Ziel nimmt selbst keinen Klick
 *     an, der Punkt gehört dem Element darunter. Das ist keine Verdeckung,
 *     sondern das Gegenteil, und es verdient seinen eigenen Satz.
 *
 * Diese Datei sieht keinen Browser: Dokument, Sichtfeld und Stilabfrage werden
 * hereingereicht. Das ist derselbe Grund wie im Kopf der Datei — ein Gate, das
 * man nicht prüfen kann, ist ein Gate, das man nicht hat.
 * --------------------------------------------------------------------- */

/* Wie tief in Schattenbäume abgestiegen wird. Eine Seite, die sich selbst
   tausendfach verschachtelt, hält den Tab nicht an. */
const SCHATTEN_TIEFE = 20;

/* Die Absagen des Verdeckungstests. Sie stehen als Tabelle da, weil jeder Satz
   wörtlich in einem Prüfsatz steht: Ein Schutz, dessen Satz sich beiläufig
   ändert, ist ein Schutz, dessen Prüfung beiläufig aufhört zu messen. */
export const KLICK_ABSAGEN = {
  kein_ziel: {
    code: "element_not_found",
    satz: "Das Element, auf das ich klicken sollte, gibt es auf der Seite nicht mehr.",
    hinweis: "`readPage` neu aufrufen und die Referenz aus der neuen Wahrnehmung nehmen.",
    retryable: false,
  },
  keine_flaeche: {
    code: "element_not_visible",
    satz: "Das Ziel hat auf der Seite keine Fläche, auf die man klicken könnte.",
    hinweis: "`readPage` neu aufrufen. Was keine Fläche hat, ist meist aufgeklappt oder ausgeblendet.",
    retryable: true,
  },
  ausserhalb: {
    code: "element_not_visible",
    satz: "Das Ziel liegt außerhalb des sichtbaren Ausschnitts. Auf etwas, das niemand sieht, klicke ich nicht.",
    hinweis: "Erst mit `scroll` und der Referenz des Elements dorthin rollen, dann den Klick wiederholen.",
    retryable: true,
  },
  klicktaub: {
    code: "element_not_visible",
    satz: "Das Ziel nimmt selbst keine Klicks an, seine Zeigerereignisse sind abgeschaltet.",
    hinweis: "Das Element, das den Klick wirklich annimmt, ist ein anderes. `readPage` neu aufrufen und es dort suchen.",
    retryable: false,
  },
  leer: {
    code: "element_not_visible",
    satz: "An der Stelle des Ziels nimmt kein Element einen Klick an.",
    hinweis: "`readPage` neu aufrufen, die Seite hat sich seit der Wahrnehmung bewegt.",
    retryable: true,
  },
  verdeckt: {
    code: "element_covered",
    satz: "Über dem Ziel liegt ein anderes Element. Ich klicke nicht, denn der Klick träfe dieses andere Element und nicht das, was der Mensch freigegeben hat.",
    hinweis: "Meist ist es eine Bannerleiste oder ein Zustimmungsfenster. Es zuerst schließen, dann `readPage` neu lesen und den Klick wiederholen.",
    retryable: true,
  },
};

function klickAbsage(name, zusatz = {}) {
  return { ok: false, ...KLICK_ABSAGEN[name], ...zusatz };
}

/**
 * Welches Element bekäme an diesem Punkt den Klick?
 *
 * Steigt durch offene Schattenbäume durch, weil `elementFromPoint` an jeder
 * Schattengrenze am Wirt stehen bleibt.
 *
 * @param {object} wurzel  `document` oder eine offene `shadowRoot`
 * @returns {object|null}
 */
export function zielAmPunkt(wurzel, x, y) {
  let gefunden = null;
  let hier = wurzel;
  for (let tiefe = 0; tiefe < SCHATTEN_TIEFE; tiefe++) {
    if (!hier || typeof hier.elementFromPoint !== "function") break;
    let treffer = null;
    try {
      treffer = hier.elementFromPoint(x, y);
    } catch (_) {
      treffer = null;
    }
    if (!treffer || treffer === gefunden) break;
    gefunden = treffer;
    hier = gefunden.shadowRoot || null; // nur OFFENE Wurzeln haben eine
  }
  return gefunden;
}

/**
 * Ist `knoten` das Ziel selbst oder ein Kind davon?
 *
 * Aufwärts statt `ziel.contains(knoten)`, weil `contains` an der
 * Schattengrenze aufhört: Ein Knopf IN der offenen Wurzel einer Komponente
 * wäre sonst „nicht enthalten", obwohl der Klick genau dort hingehört. Über
 * `host` geht es weiter, und das ist derselbe Weg, den auch `composedPath`
 * eines echten Ereignisses nimmt.
 */
export function gehoertZuZiel(ziel, knoten) {
  if (!ziel || !knoten) return false;
  let n = knoten;
  for (let i = 0; i < 200 && n; i++) {
    if (n === ziel) return true;
    n = n.parentNode || n.host || null;
  }
  return false;
}

/**
 * Der Verdeckungstest selbst.
 *
 * @param {object} ziel        das Element, dem der Mensch zugestimmt hat
 * @param {object} umgebung    { dokument, sichtfeld:{breite,hoehe}, stil }
 *                             `stil` ist `getComputedStyle`, hereingereicht.
 * @returns {{ok:true, punkt:{x:number,y:number}, gefunden:object}
 *          |{ok:false, code:string, satz:string, hinweis:string, retryable:boolean}}
 */
export function klickZielFrei(ziel, umgebung = {}) {
  if (!ziel || typeof ziel.getBoundingClientRect !== "function") {
    return klickAbsage("kein_ziel");
  }

  let r = null;
  try {
    r = ziel.getBoundingClientRect();
  } catch (_) {
    r = null;
  }
  if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height) || r.width <= 0 || r.height <= 0) {
    return klickAbsage("keine_flaeche");
  }

  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return klickAbsage("keine_flaeche");

  /* Das Sichtfeld, wenn es genannt ist. Fehlt es, trägt `elementFromPoint` den
     Fall allein: Außerhalb liefert es `null`, und daraus wird eine Absage —
     nur mit dem allgemeineren Satz. */
  const sicht = umgebung.sichtfeld || {};
  const breite = Number(sicht.breite);
  const hoehe = Number(sicht.hoehe);
  if (Number.isFinite(breite) && Number.isFinite(hoehe)) {
    if (x < 0 || y < 0 || x >= breite || y >= hoehe) return klickAbsage("ausserhalb");
  }

  /* Ein Ziel, das selbst keine Zeigerereignisse annimmt, ist nicht verdeckt,
     sondern durchlässig. Der Unterschied gehört in den Satz, sonst sucht der
     Agent ein Banner, das es gar nicht gibt. */
  if (typeof umgebung.stil === "function") {
    let stil = null;
    try {
      stil = umgebung.stil(ziel);
    } catch (_) {
      stil = null;
    }
    if (stil && String(stil.pointerEvents || "") === "none") return klickAbsage("klicktaub");
  }

  const dokument = umgebung.dokument;
  if (!dokument || typeof dokument.elementFromPoint !== "function") {
    /* Ohne Nachsehen keine Freigabe. Ein Test, der bei fehlendem Werkzeug
       durchwinkt, ist genau der Test, den man weglassen kann. */
    return klickAbsage("leer");
  }

  const gefunden = zielAmPunkt(dokument, x, y);
  if (!gefunden) return klickAbsage("leer");
  if (gehoertZuZiel(ziel, gefunden)) return { ok: true, punkt: { x, y }, gefunden };

  /* Was oben liegt, wird gemeldet, aber nicht in den Satz gehoben: Es ist
     Text von der besuchten Seite. Der Name des HTML-Elements genügt zur
     Fehlersuche und trägt keinen Fremdtext. */
  const marke = saeubern(gefunden.tagName || gefunden.nodeName || "", 40)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  return klickAbsage("verdeckt", { darueber: marke || null });
}

/**
 * Klicken, aber nur, wenn der Punkt wirklich dem Ziel gehört.
 *
 * Der Auslöser wird hereingereicht und ausschließlich hier aufgerufen. Das ist
 * der Unterschied zwischen einer Prüfung, die berät, und einer, die schützt:
 * Wer die Absage übersehen könnte, könnte trotzdem klicken; wer den Auslöser
 * abgibt, kann es nicht.
 */
export function klickFreigeben(ziel, umgebung, ausloesen) {
  const frei = klickZielFrei(ziel, umgebung);
  if (!frei.ok) return frei;
  if (typeof ausloesen === "function") ausloesen(frei.punkt);
  return frei;
}

/* --------------------------------------------------------------------- *
 * Der Textbaum
 * --------------------------------------------------------------------- */

/**
 * Einen rohen Knoten aus dem Seitenskript in die kanonische Form bringen.
 * Alles, was nicht passt, fällt weg — es gibt keinen Zweifelsfall, der
 * durchgereicht wird.
 *
 * @returns {object|null}
 */
export function knotenPruefen(roh) {
  if (!roh || typeof roh !== "object") return null;
  const art = roh.art;
  if (art !== "bereich" && art !== "element" && art !== "text") return null;

  const name = saeubern(roh.name, GRENZEN.nameZeichen);
  const rolle = saeubern(roh.rolle, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (art === "text" && !name) return null;
  if (art === "element" && !rolle) return null;

  let ref = null;
  if (art === "element") {
    ref = typeof roh.ref === "string" && /^e[0-9]{1,4}$/.test(roh.ref) ? roh.ref : null;
    if (!ref) return null; // Ein Bedienelement ohne Adresse ist für den Agenten wertlos.
  }

  const tiefe = Number.isInteger(roh.tiefe) ? Math.min(3, Math.max(0, roh.tiefe)) : 0;
  const wert =
    roh.wert === null || roh.wert === undefined ? null : saeubern(roh.wert, GRENZEN.wertZeichen);

  const zustand = Array.isArray(roh.zustand)
    ? [...new Set(roh.zustand.filter((z) => typeof z === "string" && ZUSTAENDE.has(z)))]
    : [];

  return { art, ref, rolle, name, wert: wert || null, zustand, tiefe };
}

function zeileBauen(k) {
  const einzug = "  ".repeat(k.tiefe);
  if (k.art === "bereich") {
    return `${einzug}${k.rolle || "bereich"}${k.name ? ` "${k.name}"` : ""}`;
  }
  if (k.art === "text") {
    return `${einzug}text "${k.name}"`;
  }
  const sichtbar = k.zustand.filter((z) => !ZUSTAND_STILL.has(z));
  /* Die Zustandsnamen kommen aus der besuchten Seite. Ohne `eigen` fände
     `ZUSTAND_TEXT["constructor"]` eine Funktion, und deren Quelltext stünde
     im Textbaum, den der Agent liest (H2 vom 14.08.2026). */
  const anhang = sichtbar.length
    ? ` [${sichtbar.map((z) => {
        const t = eigen(ZUSTAND_TEXT, z);
        return typeof t === "string" ? t : z;
      }).join(", ")}]`
    : "";
  const wert = k.wert !== null ? ` = "${k.wert}"` : "";
  return `${einzug}${k.ref}  ${k.rolle}${k.name ? ` "${k.name}"` : ""}${wert}${anhang}`;
}

/**
 * Aus geprüften Knoten den Text bauen, den der Agent wirklich sieht.
 *
 * Die Kürzung ist bewusst deterministisch und in dieser Reihenfolge
 * (spec-01 §4.8): erst die Bedienelemente über dem Deckel, dann die reinen
 * Textzeilen, zuletzt ein harter Schnitt. Nach jeder Stufe wird neu gemessen.
 * Jede Auslassung wird gezählt und benannt — ein Agent, der nicht weiß, dass
 * er unvollständig sieht, behauptet Dinge über Teile, die er nie hatte.
 *
 * ====================================================================
 * `text` IST NICHT DER MESSEINGANG — dafür stehen `volltext` und
 * `einschleusung` daneben (14.08.2026, zweite Runde)
 * ====================================================================
 *
 * `text` ist gekürzt, und zwar dreifach: 400 rohe Knoten, 120 Zeichen je Name,
 * 12.000 Zeichen im Ganzen. Für den Agenten ist das richtig. Für eine MESSUNG
 * ist es genau die Bauform, an der H1 und AUTOMODUS-2 hängen: Was in der
 * weggeschnittenen Mitte stand, wird nicht gefunden, und nicht gefunden heisst
 * hier „die Automatik läuft weiter".
 *
 * Gemessen wird an diesem Baum die Prompt-Einschleusung (§9). Ein Satz
 * „ignore previous instructions" hinter Zeichen 12.000 oder in der 401.
 * Zeile war damit unsichtbar — und eine Seite bestimmt selbst, wie lang sie
 * ist. Deshalb liefert diese Funktion zwei Felder mehr:
 *
 *   `volltext`      alle Namen und Werte der ROHEN Knoten, ohne jede Kürzung,
 *                   ohne Deckel, ohne Auslassung.
 *   `einschleusung` das Ergebnis von `einschleusungVerdacht` über genau
 *                   diesen `volltext`.
 *
 * Wer auf Einschleusung prüft, nimmt `einschleusung` und nicht `text`. Das
 * Feld steht fertig da, damit an der Aufrufstelle nichts mehr zu entscheiden
 * bleibt: Eine Wache, bei der der Aufrufer die richtige Zeichenkette
 * aussuchen muss, sucht irgendwann die falsche.
 *
 * @param {Array} rohknoten  Knoten aus dem Seitenskript (unvertraut)
 * @param {object} kopf      { url, titel, epoche }
 * @returns {{text:string, volltext:string, einschleusung:object, elementCount:number, truncated:(false|string), ausgelassen:object}}
 */
export function textbaumBauen(rohknoten, kopf = {}) {
  /* VOR jeder Kürzung und aus den ROHEN Knoten: Was hier hineingeht, hat
     weder den Deckel von 400 Knoten noch den von 120 Zeichen je Name
     gesehen. */
  const volltext = (Array.isArray(rohknoten) ? rohknoten : [])
    .map((k) => (k && typeof k === "object" ? `${k.name ?? ""} ${k.wert ?? ""}` : ""))
    .join(" ");

  const alle = (Array.isArray(rohknoten) ? rohknoten : [])
    .slice(0, GRENZEN.knotenRoh)
    .map(knotenPruefen)
    .filter(Boolean);

  const ausgelassen = { elemente: 0, texte: 0, zeichen: 0 };
  let elemente = 0;
  let texte = 0;
  const behalten = [];

  for (const k of alle) {
    if (k.art === "element") {
      if (elemente >= GRENZEN.refs) {
        ausgelassen.elemente += 1;
        continue;
      }
      elemente += 1;
    } else if (k.art === "text") {
      if (texte >= GRENZEN.textknoten) {
        ausgelassen.texte += 1;
        continue;
      }
      texte += 1;
    }
    behalten.push(k);
  }

  const kopfzeile =
    `### SEITE  ${saeubern(kopf.url, 200) || "(unbekannt)"}  ` +
    `„${saeubern(kopf.titel, 120)}"  [${saeubern(kopf.epoche, 24) || "s?"} · ${elemente} Elemente]`;

  const zusammenbauen = (knoten, mitText) => {
    const zeilen = [kopfzeile];
    for (const k of knoten) {
      if (!mitText && k.art === "text") continue;
      zeilen.push(zeileBauen(k));
    }
    if (ausgelassen.elemente) {
      zeilen.push(`… ${ausgelassen.elemente} weitere Bedienelemente ausgelassen`);
    }
    const fehlendeTexte = ausgelassen.texte + (mitText ? 0 : texte);
    if (fehlendeTexte) zeilen.push(`… ${fehlendeTexte} Textzeilen ausgelassen`);
    return zeilen.join("\n");
  };

  let text = zusammenbauen(behalten, true);
  let stufe = ausgelassen.elemente || ausgelassen.texte ? "leicht" : false;

  if (text.length > GRENZEN.baumZeichen) {
    text = zusammenbauen(behalten, false);
    stufe = "stark";
  }
  if (text.length > GRENZEN.baumZeichen) {
    ausgelassen.zeichen = text.length - GRENZEN.baumZeichen;
    text = `${text.slice(0, GRENZEN.baumZeichen)}\n… hier abgeschnitten`;
    stufe = "schwer";
  }

  return {
    text,
    volltext,
    einschleusung: einschleusungVerdacht(volltext),
    elementCount: elemente,
    truncated: stufe,
    ausgelassen,
  };
}

/**
 * Den fertigen Rahmen auf eine Größe bringen, die über die Leitung passt.
 *
 * Gekürzt wird ausschließlich der Seitentext — er ist das einzige Feld, dessen
 * Größe von einer fremden Seite bestimmt wird. Kennung, Befehl und
 * Fehlerangabe bleiben unangetastet: Ein Rahmen, dem die Kennung fehlt, ist
 * für den Relay kein Rahmen mehr, sondern Müll, und der Agent wartet weiter.
 */
export function rahmenDeckeln(rahmen, grenze = GRENZEN.rahmenZeichen) {
  let text = JSON.stringify(rahmen);
  if (text.length <= grenze) return rahmen;

  const schnappschuss = rahmen && rahmen.data && rahmen.data.snapshot;
  if (schnappschuss && typeof schnappschuss.text === "string") {
    const zuviel = text.length - grenze;
    const neu = Math.max(0, schnappschuss.text.length - zuviel - 64);
    schnappschuss.text = `${schnappschuss.text.slice(0, neu)}\n… hier abgeschnitten`;
    schnappschuss.truncated = "schwer";
    text = JSON.stringify(rahmen);
  }
  if (text.length <= grenze) return rahmen;

  /* Reicht auch das nicht, geht die Wahrnehmung ganz verloren — aber die
     Antwort geht raus. Ohne Antwort hinge der Agent bis zum Zeitablauf. */
  return {
    type: "result",
    id: rahmen.id,
    cmd: rahmen.cmd,
    success: false,
    error: {
      code: "rahmen_zu_gross",
      message: "Die Antwort war zu groß für die Leitung. Ich habe sie verworfen.",
      retryable: true,
      hint: "Mit `scroll` einen kleineren Ausschnitt lesen.",
    },
    meta: rahmen.meta,
  };
}
