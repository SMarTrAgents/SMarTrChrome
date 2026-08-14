# Umstieg von v3 auf v3.5

**Für Nutzer der Fassungen 0.5.x und für alle, die den Relay oder einen Agenten
betreiben. Stand 14.08.2026.**

Kurz: Es gibt keine Datenwanderung. Nichts, was du in der alten Fassung
gespeichert hattest, muss umgeschrieben werden. Was du neu einstellen kannst,
steht unten, und was du neu einstellen **musst**, ist genau eine Sache: nichts.
Die Voreinstellungen sind so gewählt, dass die Erweiterung ohne dein Zutun
vorsichtiger ist als vorher, nicht mutiger.

---

## 1. Was du sofort merkst

**Die Seitenleiste sieht anders aus.** Ganz oben steht ein einzelner Knopf
„Mit diesem Tab verbinden". Ein Klick genügt. Der alte Dialog mit Stufe, Dauer
und Geltungsbereich ist nicht verschwunden, er heisst jetzt „Dauer und Geltung
ändern" und steht daneben.

**Darunter steht ein Umschalter mit drei Stufen.** Er ist neu, er gilt je Tab,
und er steht auf „Mitdenken". Was die drei Stufen bedeuten, sagt die Zeile
darunter, und darunter steht der Riegel: Zahlungen, Passwörter, Löschungen,
Dateien, Browser-Berechtigungen und CAPTCHAs kommen in jeder Stufe zurück zu
dir.

**Der Stoppknopf ist immer da.** Bisher hing er an der Sitzungsleiste und war
weg, sobald die zugeklappt war. Jetzt hängt er an der Sitzung selbst, dazu
kommt ein Stoppknopf im Schild in der Seite.

**Der Rahmen um die Seite hat jetzt eine Bedeutung.** Seine Farbe zeigt den
Modus, und das Schild nennt ihn in Worten.

**Im Menü stehen zwei neue Punkte:** „Regeln und Abläufe" und „Protokollbuch".

## 2. Was mit deiner laufenden Sitzung passiert

**Sie endet.** Das ist keine Nebenwirkung des Umstiegs, sondern die Bauordnung:
Bei Installation und Aktualisierung räumt die Erweiterung alle Seitenrechte weg,
nimmt das Abzeichen ab und löscht Reste einer Aufzeichnung. Eine Sitzung, die
ein Update überlebt, wäre eine Vollmacht, an die sich niemand erinnert.

Nach dem Umstieg also: neu verbinden. Das ist jetzt ein Klick.

**Chrome kann beim Aktualisieren nachfragen,** weil die Erweiterung mit dieser
Fassung die Berechtigung `notifications` führt. Sie ist für genau eine Sache da:
die Meldung, wenn eine Cloud-Sitzung beginnt. Solange du nicht zustimmst, bleibt
die Erweiterung abgeschaltet, das ist Chromes Verhalten bei einer neuen
Pflichtberechtigung und nicht unseres.

## 3. Was du neu einstellen kannst

Alles davon ist freiwillig. Die Voreinstellung ist überall die vorsichtige.

| Einstellung | Wo | Voreinstellung |
|---|---|---|
| Betriebsmodus je Tab | Seitenleiste, Umschalter | Mitdenken |
| Weiche Klassen je Website freischalten (Absenden, Formulare, neuer Tab) | Menü, Regeln und Abläufe | überall aus |
| Websites sperren | Menü, Regeln und Abläufe | leer |
| Was ein einzelner Agent auf einer Website darf | Menü, Regeln und Abläufe | überall aus |
| Aufbewahrungsdauer des Protokollbuchs | Menü, Protokollbuch | 30 Tage |

**Der wichtigste Satz zu den Domainregeln:** Sie schalten nichts frei, was der
Riegel abfängt. Wer `senden` für `ebay.de` freischaltet, erlaubt damit im
selbständigen Modus das Absenden eines Formulars auf ebay.de, und sonst nichts.
Zahlungen, Geheimfelder und Löschungen bleiben Rückfragen.

## 4. Was sich im Verhalten geändert hat, und was dich überraschen kann

**Im Vollzugriff wird wieder gefragt.** Bis 0.5.2 lief in einer Sitzung mit
Vollzugriff jeder Klick und jede Eingabe ohne Rückfrage durch. Ein Klick auf
„Kostenpflichtig bestellen", auf ein Passwortfeld oder auf „Konto löschen" geht
jetzt zurück an dich, auch im selbständigen Modus. Wer bisher lange Ketten ohne
Rückfrage gewohnt war, bekommt an genau diesen Stellen wieder eine Frage. Das
ist Absicht.

**Ein Auftrag hat jetzt ein Ende.** 50 Schritte, einstellbar bis 500. Danach
wird gefragt, nicht abgebrochen. Ebenso bei dreimal derselben Aktion auf
demselben Seitenzustand.

**Ein verdecktes Ziel wird nicht mehr geklickt.** Liegt ein Zustimmungsbanner
über dem Knopf, kommt eine Absage mit `element_covered`, statt dass der Klick
im Banner landet. Bis 0.5.3 war die Wache gebaut und im Klickweg nirgends
eingebaut, das war der Auslieferungsblocker vom 11.08.2026.

## 5. Die Sätze an den Agenten bleiben deutsch

Die Oberfläche gibt es ab dieser Fassung auf Deutsch und auf Englisch. Chrome
wählt nach der Browsersprache, ohne Ordner für deine Sprache fällt es auf
Deutsch zurück.

**Die Sätze, die an den Agenten gehen, bleiben deutsch, auch wenn die Oberfläche
englisch steht.** Das ist eine Entscheidung und kein vergessener Rest. Gemeint
sind die Sätze in `src/net/ausfuehrer.js` und `src/net/befehle.js`, also das,
was im Antwortrahmen unter `error.message` und `error.hint` an den Agenten geht,
zum Beispiel „In Passwort- und Geheimfelder tippe ich nicht. Das übernimmt der
Mensch selbst."

Drei Gründe, in dieser Reihenfolge:

1. **Es ist Protokolltext, keine Oberfläche.** Diese Sätze gehen an ein
   Sprachmodell, nicht auf einen Bildschirm. Der Agent liest sie, versteht sie
   und plant danach anders. Er ist zweisprachig, und er antwortet dem Menschen
   in dessen Sprache, unabhängig davon, in welcher Sprache er die Absage gehört
   hat.
2. **372 Prüfsätze messen sie wörtlich.** Sie messen nicht, dass irgendein Satz
   kommt, sondern welcher, weil genau das der Unterschied zwischen einer
   ehrlichen und einer irreführenden Absage ist. Eine Übersetzung würde jede
   dieser Messungen aufheben, ohne dass ein Mensch etwas davon sieht. Wir hätten
   die Zusage nicht mehr gemessen und trotzdem behauptet.
3. **Ein Satz, der die Sprache wechselt, ist ein anderer Satz.** Solange nicht
   alle drei Quellen gemeinsam wandern, also Ausführer, Befehlsliste und die
   Absagen aus Werkbank und Rekorder, entstünde eine Ansicht, in der jede zweite
   Absage die Sprache wechselt. Ein halber Weg ist hier schlechter als keiner.

Sichtbar für einen englischsprachigen Nutzer ist davon nichts, mit einer
Ausnahme: Der Satz im Schild in der gesteuerten Seite wird heute noch fest
deutsch gesetzt. Der englische Schlüssel liegt bereit, siehe
`docs/OFFEN-v3.5.md`.

## 6. Für Betreiber: die Reihenfolge des Rollouts

**Der Relay muss vor der Erweiterung stehen.** In dieser Richtung ist die
Umstellung folgenlos, in der anderen nicht.

| Lage | Was passiert |
|---|---|
| Relay neu, Erweiterung alt | Folgenlos. `agent` ist ein zusätzliches Feld im Rahmen, das eine alte Erweiterung ignoriert. `run_workflow` beantwortet sie mit `not_supported`. `assist` entsteht nur aus einem Ticket, das es heute nicht ausstellt. |
| Relay alt, Erweiterung neu | Lauter Absagen. `run_workflow` fällt am alten `REQUIRED` auf `full` und wird mit `stufe_zu_niedrig` abgewiesen, `params` fällt aus dem Rahmen, `agent` fehlt, `assist` kommt nie an. Keine falschen Erfolge, aber auch keine Abläufe. |

**Zurücknehmen** heisst beim Relay: eine Datei zurückkopieren und neu starten.
Laufende Sitzungen sterben dabei ohnehin, weil der Start jede verbundene Zeile
auf getrennt setzt.

**Vier Dinge fehlen ausserhalb dieses Baums,** ohne sie bleibt v3.5 auf der
Leitung halb. Sie stehen mit Datei und Begründung in `docs/OFFEN-v3.5.md`:
`ticket.py` kennt `assist` nicht, das Bridge-Token trägt keinen `agent`, die
Werkzeugtabelle der Agentenseite kennt `run_workflow` nicht, und der
Desktop-Verbinder meldet einen unbekannten Browserbefehl als Erfolg.

## 7. Für Agentenbauer: was sich auf der Leitung ändert

- **Neuer Befehl `run_workflow`,** Stufe `write`, Frist 120 Sekunden.
- **Der Parameter heisst `workflowId`, nicht `id`.** `id` ist im selben flachen
  Rahmen bereits die Kennung des Auftrags, unter der der Relay auf die Antwort
  wartet. Wer den Ablauf `id` nennt, überschreibt sie.
- **`params` ist flach und trägt ausschliesslich Zeichenketten.** Zahlen und
  Wahrheitswerte werden abgelehnt und nicht umgedeutet, höchstens 20 Einträge
  zu je 200 Zeichen.
- **Neues Rahmenfeld `agent`,** gesetzt vom Relay, geprüft gegen eine
  Positivliste. Ein Rahmen ohne `agent` läuft weiter, denn auf dem Alltagsweg
  fährt der Mensch selbst.
- **`step_mode` kennt neu `assist`.** Unbekannte Werte fallen weiterhin auf
  `confirm_each`.
- **Neue Fehlercodes:** `element_covered`, `guardrail_blocked`, `step_limit`,
  `loop_detected`, `agent_not_permitted`, `workflow_not_found`,
  `workflow_step_failed`.
- **`workflow_step_failed` ist eine Einladung, kein Endpunkt.** Der Rahmen trägt
  die Beschreibung des gesuchten Elements, die Anker und den Textbaum, damit der
  Agent selbst ein Ziel benennen kann. Das Zurückschreiben der neuen Kaskade in
  den Ablauf gibt es noch nicht.

Die genauen Formen stehen in `docs/schema-fernprotokoll.json` und
`docs/schema-workflow.json`.

## 8. Was in der Ablage liegt, und wie du es wieder loswirst

Neu angelegt werden diese Schlüssel, alle in deinem Browserprofil, keiner
davon geht an einen Server:

| Schlüssel | Ablage | Inhalt |
|---|---|---|
| `sa_modus` | session | Modus je Tab, Schrittzähler, Schrittlimit |
| `sa_matrix` | local | Domainregeln und Agentenmatrix |
| `sa_workflows` | local | gespeicherte Abläufe |
| `sa_rekorder` | local | die laufende Aufzeichnung |
| `sa_rekorder_bilder` | local | Miniaturbilder einer Aufzeichnung |
| `sa_protokollbuch` | local | das Protokollbuch |
| `sa_buch_tage` | local | eingestellte Aufbewahrungsdauer |

Die Schlüssel aus dem Bestand, `sa_ausweis` und die Sitzungsdaten, sind
unverändert. Es gibt nichts umzuschreiben.

**Zurück auf eine alte Fassung:** Die alte Fassung ignoriert die neuen
Schlüssel, sie stören nicht. Wer sie wirklich loswerden will, entfernt die
Erweiterung, damit ist das ganze Profil weg. Einzeln geht es über das
Protokollbuch (Aufbewahrungsdauer auf 0 setzen und merken lassen) und über die
Werkbank (Ablauf löschen). Was du dort löschst, ist gelöscht und nicht
ausgeblendet.

---

*SMarTrAgents.ai by ₳K₳ŦØŇǤƗɆ with Fable 5*
