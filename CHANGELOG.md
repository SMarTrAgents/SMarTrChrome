# Änderungen

Alle Fassungen von SMarTrChrome, neueste zuerst. Der wichtigste Abschnitt jeder
Fassung ist **Was nicht geht**. Er steht hier und nicht in der Ankündigung.

---

## 0.6.0, 14.08.2026 — Modi, Teach-Modus, Remote Bridge

Die Fassung, die aus einem Assistenten mit Einzelfreigabe ein Werkzeug macht,
das der Mensch einstellen kann. Gebaut nach `docs/VERTRAG-v3.5.md`.

**Stand der Auslieferung: nichts ist ausgeliefert.** Der Arbeitsstand liegt
lokal, der Relay ist lokal geändert und nicht neu gestartet. Siehe
`docs/OFFEN-v3.5.md`.

### Neu

- **Drei Betriebsmodi, je Tab.** „Jeder Schritt einzeln", „Mitdenken" und
  „Selbständig", umschaltbar in der Seitenleiste, Voreinstellung „Mitdenken".
  Der Modus stirbt mit dem Browser, ein Modus, der einen Neustart überlebt,
  wäre eine Vollmacht, an die sich niemand erinnert.
- **Aktionsklassen und ihr Riegel.** Jeder Schritt wird vor der Ausführung
  eingeordnet: lesen, bedienen, navigieren, senden, formular, tab_neu, datei,
  geheim, zahlung, unwiderruflich, berechtigung, captcha. Die letzten sechs
  sind hart, sie fragen in **jedem** Modus, auch im selbständigen. Ein CAPTCHA
  wird nie gelöst, sondern an den Menschen übergeben.
- **Domainregeln und Agentenmatrix.** Je Website lassen sich die weichen
  Klassen freischalten, Hosts lassen sich sperren, und je Agent lässt sich
  einstellen, was er auf welcher Website darf. Voreinstellung ist überall aus.
- **Schrittlimit und Schleifenbremse.** Ein Auftrag hat 50 Schritte,
  einstellbar bis 500. Dreimal dieselbe Aktion auf demselben Seitenzustand hält
  an und fragt, in jedem Modus, mit `loop_detected`. Beide Bremsen beenden
  nichts, sie fragen.
- **Not-Aus, der zuerst kappt.** Der Stoppknopf hängt an der Sitzung und nicht
  am Bildschirmausschnitt, dazu kommt ein Knopf im Schild in der Seite. Zwischen
  dem Druck und dem Zustand „nichts läuft mehr" liegt weniger als eine Sekunde,
  und zwar ohne auf eine Antwort des Relays zu warten.
- **Verdeckungswache im Klickweg.** Der Auslieferungsblocker vom 11.08.2026 ist
  zu: Die Wache liegt jetzt als klassisches Skript in `src/content/klickwache.js`,
  wird vor `overlay.js` eingespielt und in `click`, `type` und `select` wirklich
  gerufen. Fehlt sie, wird gar nicht bedient.
- **Teach-Modus.** Aufnahme starten, die Arbeit einmal selbst machen, Aufnahme
  beenden: Daraus entsteht ein Ablauf mit einer Selektor-Kaskade je Schritt.
  In ein Passwort-, PIN-, TAN- oder Einmalcodefeld wird **kein Wert**
  aufgezeichnet, dort entsteht ein Halt für den Menschen.
- **Werkbank in der Seitenleiste.** Abläufe ansehen, abspielen, löschen,
  ausgeben und einlesen, dazu die Domainregeln und die Agentenmatrix.
- **Der Befehl `run_workflow`.** Ein gespeicherter Ablauf, angestossen vom
  Agenten oder aus der Werkbank. Die Wiedergabe geht Schritt für Schritt durch
  dieselbe Befehlsschleife wie ein Agentenbefehl, also durch Modus,
  Klassifizierer, Bereichsprüfung und Verdeckungswache. Ein Ablauf ist eine
  Reihe von Befehlen, keine zweite Tür.
- **Remote Bridge mit Agentenkennung.** Der Befehlsrahmen trägt neu `agent`.
  Er kommt vom Relay, nicht vom Client, und wird gegen eine Positivliste
  gehalten. Was nicht darauf steht, wird mit `agent_not_permitted` abgelehnt.
- **Eine Cloud-Sitzung ist dreifach sichtbar.** Dauerzeile in der Seitenleiste,
  Abzeichen am Symbol, Systemmeldung beim Start.
- **Protokollbuch.** Jede Fernaktion bekommt genau einen Eintrag: Zeit, Agent,
  Kommando, Zieladresse, Ergebnis, Klassen. Der Seiteninhalt wird nicht
  gespeichert. Voreinstellung der Aufbewahrung sind 30 Tage, einstellbar, und
  aufgeräumt wird wirklich, nicht nur ausgeblendet.
- **Abwehr von Prompt-Einschleusung.** Steht im Textbaum der Versuch, dem
  Agenten neue Anweisungen unterzuschieben, fällt der selbständige Modus auf
  „Mitdenken" zurück und sagt es dem Menschen. Die Sitzung endet nicht, eine
  Seite mit diesem Text kann auch ein Blogartikel über Einschleusung sein.
- **Ein Klick zur Verbindung.** Der Knopf „Mit diesem Tab verbinden" steht ganz
  oben und führt in einem einzigen Klick zur aktiven Verbindung mit dem offenen
  Tab. Darunter steht eine Tabliste als Weg in ein anderes Fenster.
- **Zwei Sprachen.** Deutsch und Englisch, je 329 Schlüssel, ohne Lücke.
  `default_locale` ist Deutsch.
- **Neue Fehlercodes an den Agenten:** `element_covered`, `guardrail_blocked`,
  `step_limit`, `loop_detected`, `agent_not_permitted`, `workflow_not_found`,
  `workflow_step_failed`.

### Geändert

- **Im selbständigen Modus wird trotzdem gefragt, wenn es darauf ankommt.** Bis
  0.5.2 lief bei Vollzugriff jeder Klick und jede Eingabe ohne Rückfrage durch.
  Ein Klick auf „Kostenpflichtig bestellen" oder „Konto löschen" geht jetzt in
  jedem Modus zurück an den Menschen.
- **Der Modus des Servers kann nur einschränken, nie erweitern.** Der Wert aus
  der Sitzung und der Schalter in der Seitenleiste werden verrechnet, es gilt
  der kleinere von beiden. Ein unbekannter Wert gilt als „jeder Schritt
  einzeln".
- **Die Ablage `sa_modus` hat nur noch eine Lesart.** Bis zum 14.08.2026 hielt
  der Dienstarbeiter das Feld `schritte` für das eingestellte Limit und der
  Ausführer für den verbrauchten Zähler. Wer 200 Schritte einstellte, schrieb
  damit „200 Schritte sind schon gelaufen". Gelesen und geschrieben wird die
  Ablage jetzt ausschliesslich in `src/net/ausfuehrer.js`.
- **Der Parameter von `run_workflow` heisst auf dem Draht `workflowId`.** Der
  Befehlsrahmen trägt `id` bereits als Kennung des Auftrags, unter der der Relay
  auf die Antwort wartet, und beide liegen im selben flachen Rahmen.
- **Die Protokollzeile trägt mehr:** `{ text, cmd, zeit, ergebnis }` statt nur
  `text`, damit in der Seitenleiste die echte Ausführungszeit steht und nicht
  der Ankunftszeitpunkt.
- **Der Rahmen in der Seite färbt sich nach Modus,** und das Schild nennt den
  Modus in Worten.
- **Der alte Verbindungsdialog** bleibt als „Dauer und Geltung ändern"
  erreichbar, er ist nur nicht mehr der erste Schritt.
- **`manifest.json`** steht auf 0.6.0, hat `default_locale` und die Berechtigung
  `notifications`, die die Systemmeldung beim Sitzungsstart braucht.
- **Der Aufnahmerest wird beim Browserstart weggeräumt,** ausdrücklich nicht bei
  jedem Start des Dienstarbeiters: Manifest V3 beendet den im Leerlauf, und eine
  laufende Aufzeichnung wäre sonst nach dreissig Sekunden weg.
- **Der Not-Aus beendet jetzt zwei Dinge statt einem.** Bis dahin kappte er die
  Browsersteuerung, der laufende Cloud-Auftrag lief weiter. Er wird jetzt beim
  Server mit gestoppt, und der Wecker, der das Abholen nach einem Neustart des
  Dienstarbeiters wieder aufgenommen hätte, wird weggeräumt. Das merkt ein
  Mensch, deshalb steht es hier: Nach dem Stopp kommt auch keine Antwort aus dem
  Gespräch mehr nach.
- **Das Zeichen im Tab kommt jetzt vom Dienstarbeiter selbst.** Vorher schickte
  es allein die Seitenleiste. War sie zu, blieb im Tab der grüne Rahmen stehen,
  obwohl nichts mehr lief. Sie darf es weiterhin zusätzlich tun, sie ist nur
  nicht mehr der einzige Weg.
- **„Abspielen" sagt ohne Verbindung vorher ab.** Der Knopf in der Werkbank
  konnte ohne Sitzung baulich nichts tun und antwortete trotzdem mit einem Satz
  über eine beendete Sitzung, die es nie gegeben hatte. Jetzt sagt er es vorher,
  mit der Kennung `keine_sitzung`, und nennt den Weg zur Verbindung.
- **Neuer Ablageschlüssel `sa_rekorder_tab`** in `chrome.storage.session`. Er
  hält fest, in welchem Tab die laufende Aufzeichnung begonnen hat. Ohne ihn
  hätte die Wiederaufnahme nach einem Seitenwechsel in jedem Tab gegriffen, in
  dem gerade eine Seite lädt, und aus einer Reparatur wäre ein Mitschnitt
  geworden. Er stirbt mit dem Browser.
- **Die Bilder einer Aufzeichnung werden beim Start und beim Ende der Aufnahme
  weggeräumt,** nicht mehr nur beim Browserstart. Wer den Browser tagelang offen
  lässt, sammelte sonst die Bilder mehrerer Aufnahmen an, und eine neue Aufnahme
  konnte Bilder der vorigen erben.
- **Der Symboltitel und die Systemmeldung kommen aus dem Sprachkatalog.** Sie
  standen als deutsche Sätze fest im Quelltext; wer die Erweiterung auf Englisch
  benutzt, las und hörte dort weiter Deutsch.

### Was nicht geht

Der wichtigste Abschnitt. Vollständig mit Datum und Ursache in
`docs/OFFEN-v3.5.md`.

1. **Nichts ist ausgeliefert und nichts ist commitet.** Der Arbeitsstand liegt
   uncommitted in `/home/tongie/SMarTrChrome`.
2. **Der Relay ist nur lokal geändert.** Solange er alt steht, fällt
   `run_workflow` dort auf die Stufe `full` und wird abgewiesen, `params` fällt
   aus dem Rahmen, und `agent` kommt nie an. Der Relay muss vor der Erweiterung
   stehen, umgekehrt entstehen lauter Absagen.
3. **Der mittlere Modus ist über die Leitung heute unerreichbar.** Die
   Ticketausgabe kennt `assist` nicht und stellt entweder Einzelfreigabe oder
   Vollzugriff aus. Bei einer Einzelfreigabe-Sitzung gilt deshalb „jeder Schritt
   einzeln", ganz gleich, was der Schalter zeigt. Erst bei Vollzugriff
   entscheidet der Schalter wirklich.
4. **Die Agentenmatrix hat heute nichts zu prüfen.** Das Bridge-Token trägt
   keinen Anspruch `agent`, das Feld bleibt leer, und ein Rahmen ohne `agent`
   läuft bewusst weiter, damit der Mensch selbst nicht ausgesperrt wird.
5. **Kein Agent kann `run_workflow` bauen.** Die Werkzeugtabelle der
   Agentenseite kennt den Befehl nicht.
6. **Zwei Schritttypen bleiben beim Abspielen stehen.** Für `key` (Enter, Tab)
   und `dblclick` gibt es keinen Befehl. Der Ablauf hält dort mit einer
   benannten Absage an, statt stillschweigend etwas anderes zu tun.
7. **Ein Ablauf mit mehr als dreissig Schritten läuft in die Minutenbremse**
   und endet mit `workflow_step_failed` und `budget_exceeded`. Der Relay bucht
   ausserdem 50 Schritte je Ablauf, zwei Abläufe in derselben Minute sind damit
   nicht möglich.
8. **Die Selbstheilung ist halb.** Bricht die ganze Kaskade, bekommt der Agent
   Beschreibung, Anker und Textbaum und kann ein neues Ziel benennen. Das
   Zurückschreiben der neuen Kaskade in den Ablauf fehlt, dafür braucht es einen
   eigenen Befehl auf dem Draht.
9. **Miniaturbilder werden aufgenommen und gespeichert, aber nirgends
   angezeigt.** Die Werkbank zeigt zu einem Ablauf noch kein Bild.
10. **Das Schrittlimit hat keinen Knopf.** Der Weg ist gebaut und gedeckelt, die
    Seitenleiste sendet aber nur den Modus und nie eine Grenze.
11. **Nur der oberste Rahmen wird aufgezeichnet.** Klicks in einem eingebetteten
    Rahmen entstehen nicht als Schritt, und ein Bildlauf innerhalb eines
    rollbaren Behälters wird nicht aufgezeichnet.
12. **Nichts davon ist im echten Chrome nachgemessen.** Offen bleiben
    ausdrücklich: Verdeckung in geschlossenen Schattenbäumen und in fremden
    Rahmen, das Aussehen des Modusrahmens, die Klickbarkeit des Stoppknopfes
    unter einem fremden Überzug, der Befund F-2 (ein `*{display:none!important}`
    der Seite löscht das Zeichen, ohne dass die Sitzung endet), Layout und
    Vorlesen der Seitenleiste, und der Teach-Modus an echten Anmeldemasken.
13. **Die englische Fassung ist nicht gegengelesen,** und siebzehn Absagesätze
    aus der Werkbank und dem Rekorder bleiben deutsch.
14. **Das Ausgeben schreibt keine Datei.** Der Text landet in einem Feld zum
    Kopieren, weil die Erweiterung ohne die Berechtigung `downloads` auskommt.

### Prüfung

809 Prüfsätze, 809 grün, gemessen am 14.08.2026 mit
`cd src && node --test "pruefung/*.test.mjs"`. Die 372 Prüfsätze der Vorfassung
bleiben grün; die Erwartungen, die nachgezogen wurden, tragen ihre Begründung
an Ort und Stelle.

Zur Zahl gehört eine Einordnung, sonst ist sie eine Beruhigung statt einer
Aussage: Am Vormittag des 14.08.2026 standen hier 733 grüne Prüfsätze, und eine
Gegenlesung fand danach 31 Befunde, davon neun Blocker. Keiner davon war rot
geworden. Die Naht zwischen den Gebieten war nirgends gemessen — jedes Gebiet
prüfte sich selbst gegen eine Attrappe des Nachbarn. Die Datei
`src/pruefung/verzahnung.test.mjs` ist die Antwort darauf: Sie lässt die echten
Inhaltsskripte, den echten Nachrichtenhörer des Dienstarbeiters und die echte
Ablage miteinander laufen. Eine Zahl grüner Prüfsätze sagt nichts darüber, ob
sie das Richtige messen.

Der Relay hat seine eigene Prüfung, `server/test_connect.py`, dort sind 366 von
366 grün, davon 43 neu. Er liegt in einem anderen Baum und läuft nicht mit.

---

## 0.5.2, 10.08.2026 — sichtbarer Zeiger, Vollzugriff, Arbeit im Hintergrund

- Arbeitszeiger in der Seite, Vollzugriff als `write` und `auto`.
- Die Seitenleiste ist nicht mehr die Reissleine: Ein geschlossenes Panel
  beendet die Sitzung nicht mehr.
- 258 Prüfsätze, dazu 18 Handgriffe im echten Chrome.
- Was nicht ging: `LINK_AUTO_MODUS` am Gateway, und der Browser-Agent nutzte
  seinen eigenen Browser nicht als Quelle.

## 0.5.1, 10.08.2026 — drei Blocker zu, Sichtbarkeit gegen Seiten-CSS gehärtet

- Rahmen, Zeiger und Schild überstehen feindliches Seiten-CSS.
- Was nicht ging: die Verdeckungswache war gebaut und im Klickweg nirgends
  eingebaut. Das war der Auslieferungsblocker vom 11.08.2026.

## 0.5.0, 06.08.2026 — sichtbare, gemeinsame Browser-Bedienung

- Erste Fassung mit Agentenzeiger, grünem Rahmen, Einzelfreigabe je Schritt und
  dreizehn Befehlen.
