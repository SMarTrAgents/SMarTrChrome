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
 *            In dieser Fassung steht überall „immer", auch bei `readPage` und
 *            `scroll`, für die spec-01 §5.2 „nie" vorsieht. Das ist bewusst
 *            strenger: Solange die Erweiterung neu ist, soll kein Schritt an
 *            der Rückfrage vorbei. Der Schrittmodus der Sitzung wird trotzdem
 *            ausgewertet — er bleibt der Weg, auf dem sich das später öffnet,
 *            ohne dass jemand eine zweite Tabelle pflegen muss.
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
  readPage: { stufe: "read", frist: 25000, freigabe: "immer", tut: "die Seite lesen" },
  snapshot: { stufe: "read", frist: 25000, freigabe: "immer", tut: "die Seite lesen" },

  /* Zustand melden: Adresse, Titel, Bildlaufstand, Größe der letzten
     Wahrnehmung. Kein Seitentext, keine Feldinhalte. */
  get_state: { stufe: "read", frist: 15000, freigabe: "immer", tut: "den Zustand dieses Tabs melden" },

  /* Bildlauf. Danach immer eine neue Wahrnehmung — durch Nachladen entsteht in
     der Regel eine neue Epoche (spec-01 §5.2). */
  scroll: { stufe: "read", frist: 10000, freigabe: "immer", tut: "auf der Seite scrollen" },

  /* Zeigen: der Agentenzeiger wandert auf ein Element der letzten Wahrnehmung.
     Das ist der einzige Befehl, der auf der Seite überhaupt sichtbar wird —
     und er verändert nichts an ihr. */
  highlight: { stufe: "read", frist: 20000, freigabe: "immer", tut: "dir ein Element auf der Seite zeigen" },

  /* Gezielt ablesen statt alles lesen. `extract` ist KEINE Skriptausführung
     (spec-01 §5.2): Es liest ausschließlich aus der bereits erhobenen
     Wahrnehmung und sieht nichts, was `readPage` nicht auch sähe. Der Nutzen
     ist ein Kostennutzen — 12 Zeilen statt 3.000 Tokens Baum. */
  extract: { stufe: "read", frist: 25000, freigabe: "immer", tut: "einzelne Angaben von der Seite ablesen" },

  /* Warten. Die längste Frist der Tabelle, weil Warten die einzige Handlung
     ist, deren Zweck das Vergehen von Zeit ist. Genau eine Bedingung, nie ein
     Prädikat als Skript — das wäre `eval` durch die Hintertür (spec-01 V4). */
  waitFor: { stufe: "read", frist: 60000, freigabe: "immer", tut: "auf der Seite auf etwas warten" },

  /* Der Notausgang, nicht der Regelweg (spec-01 §4.7). Ein Bild kostet ein
     Vielfaches eines Textbaums und sagt weniger; deshalb verlangt dieser Befehl
     als einziger einen benannten Anlass. */
  screenshot: { stufe: "read", frist: 30000, freigabe: "immer", tut: "ein Bild vom sichtbaren Ausschnitt aufnehmen" },

  /* Ortswechsel. Stufe `read`, weil der Relay das seit jeher so führt
     (RELAY:41) — die eigentliche Schranke ist nicht die Stufe, sondern der
     Bereich: Die Zieladresse wird VOR der Frage geprüft (ausfuehrer.js), damit
     der Mensch nie eine Adresse bestätigt, die danach abgelehnt wird. */
  navigate: { stufe: "read", frist: 45000, freigabe: "immer", tut: "eine andere Adresse aufrufen" },
  back: { stufe: "read", frist: 30000, freigabe: "immer", tut: "eine Seite zurückgehen" },

  /* Bedienen. Alle drei verändern die Seite — deshalb Stufe `write` und
     Freigabe „immer": kein Schrittmodus schaltet die Rückfrage hier ab. Das
     Ziel wird VOR der Frage nachgeschlagen (ausfuehrer.js), damit der Mensch
     einem konkreten Element zustimmt, nicht einer Absicht. */
  click: { stufe: "write", frist: 20000, freigabe: "immer", tut: "für dich klicken" },
  type: { stufe: "write", frist: 25000, freigabe: "immer", tut: "für dich in ein Feld tippen" },
  select: { stufe: "write", frist: 15000, freigabe: "immer", tut: "für dich eine Auswahl treffen" },
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

/* Steuerzeichen, Nullbreiten und Schreibrichtungsmarken. Sie sind der billigste
   Weg, einen Vorleser oder ein Protokoll etwas anderes sagen zu lassen, als
   dasteht. */
const STEUERZEICHEN =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Fremdtext in eine Form bringen, die man gefahrlos anzeigen, protokollieren
 * und weitergeben kann. Gekürzt wird in der Mitte: Anfang und Ende sind für
 * das Wiedererkennen entscheidend (spec-01 §4.8, K2).
 */
export function saeubern(roh, grenze = GRENZEN.nameZeichen) {
  const s = String(roh ?? "")
    .replace(STEUERZEICHEN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= grenze) return s;
  if (grenze <= 1) return "…";
  const kopf = Math.ceil((grenze - 1) / 2);
  const fuss = grenze - 1 - kopf;
  return `${s.slice(0, kopf)}…${fuss > 0 ? s.slice(s.length - fuss) : ""}`;
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
  const eintrag = BEFEHLE[cmd];
  if (!eintrag) return false;
  return (RANG[stufe] || 0) >= RANG[eintrag.stufe];
}

/**
 * Host einer Adresse — klein, ohne Wurzelpunkt, nur http/https.
 *
 * Der abschließende Wurzelpunkt ist bedeutungslos (RFC 1034 §3.1,
 * DRAHTFORMAT §6): `geizhals.de.` und `geizhals.de` sind derselbe Name. Ein
 * Host mit leerer Marke (`geizhals..de`) ist dagegen keiner.
 *
 * @returns {string|null}
 */
export function hostAus(adresse) {
  let u;
  try {
    u = new URL(String(adresse ?? ""));
  } catch (_) {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  let host = u.hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host) return null;
  if (host.split(".").some((marke) => marke === "")) return null;
  return host;
}

/**
 * Liegt diese Adresse im freigegebenen Bereich?
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
 */
export function bereichPasst(adresse, sitzung) {
  const host = hostAus(adresse);
  if (!host) return false;
  const liste = Array.isArray(sitzung && sitzung.bereich) ? sitzung.bereich : [];
  if (!liste.length) return false;

  /* „Nur dieser Tab" heißt: genau dieser eine Host, ohne Platzhalter. */
  if ((sitzung && sitzung.modus) === "tab") {
    const eins = String(liste[0] || "").toLowerCase().replace(/\.$/, "");
    return !!eins && eins === host;
  }

  return liste.some((eintrag) => {
    const e = String(eintrag || "").toLowerCase().replace(/\.$/, "");
    if (!e) return false;
    if (e.startsWith("*.")) {
      const wurzel = e.slice(2);
      if (!wurzel || wurzel.split(".").length < 2) return false; // `*.de` ist zu weit
      return host === wurzel || host.endsWith(`.${wurzel}`);
    }
    return host === e;
  });
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
      if (!bereichPasst(url, lage.sitzung)) {
        const erlaubt = Array.isArray(lage.sitzung && lage.sitzung.bereich)
          ? lage.sitzung.bereich.slice(0, 3).map((e) => saeubern(e, 60)).join(", ")
          : "";
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
    s += plan.absenden ? " — und die Eingabe dann absenden." : ".";
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
    const satz = WARTE_FRAGE[plan.bedingung];
    return satz ? ` Er wartet darauf, ${satz(plan.wert)}.` : "";
  }
  return "";
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
  const anhang = sichtbar.length
    ? ` [${sichtbar.map((z) => ZUSTAND_TEXT[z] || z).join(", ")}]`
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
 * @param {Array} rohknoten  Knoten aus dem Seitenskript (unvertraut)
 * @param {object} kopf      { url, titel, epoche }
 * @returns {{text:string, elementCount:number, truncated:(false|string), ausgelassen:object}}
 */
export function textbaumBauen(rohknoten, kopf = {}) {
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

  return { text, elementCount: elemente, truncated: stufe, ausgelassen };
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
