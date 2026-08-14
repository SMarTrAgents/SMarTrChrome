# SMarTrChrome

**SMarTrAgents im Browser, Mensch mit Maschine.**
Ein Chrome-Assistent, der deine Seite *sichtbar mitbedient*: Du übernimmst den
Login, der Agent macht den Rest, und du bestimmst, wie selbständig er dabei
arbeitet.

> _SMarTrAgents in your browser. An agent that visibly operates the page
> together with you: you handle the login, it does the rest, and you decide how
> much it may do on its own._

Teil der [smartragents.ai](https://smartragents.ai)-Plattform. Manifest V3,
Fassung 0.6.0, Deutsch und Englisch.

---

## Was es kann

- **Sichtbar bedienen.** Ein Agentenzeiger fährt zu jedem Ziel, ein Ring zeigt
  den Klick, ein farbiger Rahmen umgibt die gesteuerte Seite, und der Reiter
  trägt ein Zeichen. Du siehst jederzeit, *dass* und *wo* gearbeitet wird.
- **Lesen, blättern, zeigen, klicken, tippen, auswählen, warten, aufnehmen,
  Adresse wechseln** und gespeicherte Abläufe abspielen: vierzehn Befehle,
  mehr kennt die Erweiterung nicht.
- **Drei Modi**, je Tab einstellbar. Du entscheidest, wie viel gefragt wird.
- **Teach-Modus.** Einmal selbst vormachen, danach abspielen lassen.
- **Protokollbuch.** Was in deinem Namen geschah, kannst du hinterher nachlesen.
- **Vorlesen** ist ein vollwertiger Bedienweg, nicht nur Beiwerk.

## Die drei Modi

Der Modus gilt **je Tab** und stirbt mit dem Browser. Ein Modus, der einen
Neustart überlebt, wäre eine Vollmacht, an die sich niemand erinnert.

| Modus | Was er tut |
|---|---|
| **Jeder Schritt einzeln** | Ich frage dich vor jedem Schritt, auch vor dem Lesen einer Seite. |
| **Mitdenken** (Voreinstellung) | Lesen, Klicken, Tippen und Blättern erledige ich allein, alles Weitere lege ich dir vor. |
| **Selbständig** | Zusätzlich erledige ich das, was du für diese Website ausdrücklich freigeschaltet hast, ohne Rückfrage. |

Der Unterschied zwischen „Mitdenken" und „Selbständig" ist genau einer: Im
selbständigen Modus laufen die Klassen durch, die du für **diese** Website
freigeschaltet hast, also Absenden, Formulare, neuer Tab. Sonst nichts. Wer das
Etikett liest, soll nicht mehr bekommen, als es verspricht.

**Der Riegel gilt in jedem Modus:** Zahlungen, Passwörter, Löschungen, Dateien,
Browser-Berechtigungen und CAPTCHAs lege ich dir immer vor, auch im
selbständigen Modus. Ein CAPTCHA wird nie gelöst, sondern an dich übergeben.

## Verbinden, ein Klick

Oben in der Seitenleiste steht **„Mit diesem Tab verbinden"**. Ein Klick, und
die Verbindung zum offenen Tab steht. Darunter liegt eine Tabliste, falls der
Tab in einem anderen Fenster steht.

Wer Dauer und Geltung selbst wählen will, öffnet daneben **„Dauer und Geltung
ändern"**, das ist der alte Dialog mit Stufe, Dauer und Geltungsbereich.

**Der Stoppknopf hängt an der Sitzung,** nicht am Bildschirmausschnitt. Er ist
in jedem Zustand da, dazu zweimal `Esc` in der Seite, `Alt+Umschalt+S` als
Tastenkürzel und ein Stoppknopf im Schild in der Seite selbst. Zwischen dem
Druck und dem Zustand „nichts läuft mehr" liegt weniger als eine Sekunde, und
zwar bevor irgendjemand benachrichtigt wird. Erst kappen, dann melden.

## Teach-Modus

In der Werkbank, erreichbar über das Menü:

1. **Aufnahme starten.**
2. Die Arbeit einmal selbst machen, im Tab, wie immer.
3. **Aufnahme beenden.** Daraus entsteht ein Ablauf mit einer Selektor-Kaskade
   je Schritt: erst das Datenmerkmal, dann die Beschriftung, dann ein stabiler
   CSS-Pfad, dann der Text, zuletzt XPath. Bricht ein Anker, greift der
   nächste.
4. Ablauf benennen, speichern, abspielen.

**In ein Passwort-, PIN-, TAN- oder Einmalcodefeld wird kein Wert
aufgezeichnet.** An seiner Stelle steht ein Halt: Der Ablauf bleibt stehen und
bittet dich, dich selbst anzumelden. Der Rekorder liest den Wert gar nicht erst
aus, er überschreibt ihn nicht nachträglich.

**Ein Ablauf ist keine zweite Tür.** Die Wiedergabe geht Schritt für Schritt
durch dieselbe Befehlsschleife wie ein Agentenbefehl, also durch Modus,
Aktionsklassen, Bereichsprüfung und Verdeckungswache.

Das Format eines Ablaufs steht als echtes JSON-Schema in
[`docs/schema-workflow.json`](docs/schema-workflow.json).

## Remote Bridge

Ein Agent aus der Cloud kann denselben Browser steuern wie du, über
`connect.smartragents.ai`. Dafür gilt:

- **Der Befehl trägt den Namen des Agenten.** Er kommt vom Relay, nie vom
  Client, und wird gegen eine Positivliste gehalten. Was nicht darauf steht,
  wird abgelehnt.
- **Die Agentenmatrix** sagt je Agent und je Website, was er dort darf.
  Voreinstellung ist überall aus.
- **Eine laufende Cloud-Sitzung ist dreifach sichtbar:** Dauerzeile in der
  Seitenleiste, Abzeichen am Symbol, Systemmeldung beim Start.
- **Offline heisst Absage, nicht Warteschlange.** Ein Steuerbefehl, der eine
  Stunde später ausgeführt wird, ist ein anderer Befehl.

Das Format auf der Leitung steht als echtes JSON-Schema in
[`docs/schema-fernprotokoll.json`](docs/schema-fernprotokoll.json), die
vollständige Wahrheit über den Handschlag in
[`docs/DRAHTFORMAT.md`](docs/DRAHTFORMAT.md).

## Protokollbuch

Jede Fernaktion bekommt genau einen Eintrag: Zeit, Agent, Kommando,
Zieladresse, Ergebnis, Aktionsklassen. Zu lesen und auszugeben über das Menü.

**Die Adresse wird gespeichert, der Seiteninhalt nicht,** und aus der Adresse
fällt der Frageteil weg, denn dort stehen Suchbegriffe, Sitzungsmarken und
Einmalschlüssel. Das ist keine Kür, sondern der Grund, warum das Buch überhaupt
geführt werden darf.

Ein Eintrag steht voreingestellt 30 Tage. Die Dauer ist einstellbar, und wer
dort 0 einträgt, hat das Buch geleert, sofort und wirklich, nicht nur
ausgeblendet. Alles bleibt auf deinem Rechner. Was genau verarbeitet wird, steht
in
[`docs/DSGVO-verarbeitungen-v3.5.md`](docs/DSGVO-verarbeitungen-v3.5.md).

## Sicherheit zuerst

Das ist kein Zusatz, sondern die Bauordnung:

- **Der Riegel steht in jedem Modus.** Zahlung, Geheimfeld, Löschung, Datei,
  Berechtigung, CAPTCHA gehen immer an den Menschen.
- **Jede Sitzung ist neu.** Es gibt keinen gespeicherten Zustand „verbunden",
  der einen Browserstart überlebt, und kein Recht, das über das Sitzungsende
  hinaus bestehen bleibt, browserseitig erzwungen über
  `chrome.permissions.request` und `remove`.
- **Passwörter, Kartendaten, Einmalcodes** liest und tippt der Agent nie.
  Anmelden bleibt deine Sache.
- **Ein abgelehnter Schritt bewegt nichts** auf der Seite.
- **Ein verdecktes Ziel wird nicht geklickt.** Liegt ein anderes Element über
  dem Ziel, kommt eine Absage statt eines Klicks ins Blaue.
- **Ein Auftrag, der sich im Kreis dreht, hält an und fragt.** Dreimal dieselbe
  Aktion auf demselben Seitenzustand, und der Schritt geht zurück an dich.
- **Text von der Seite wird gemessen, nicht geglaubt.** Er kann immer nur mehr
  Rückfrage auslösen, niemals weniger. Findet sich darin der Versuch, dem
  Agenten neue Anweisungen unterzuschieben, fällt der selbständige Modus zurück
  auf „Mitdenken".
- **Kein `eval`, kein Fernladen von Code.**

## Was heute noch nicht geht

Ehrlich und mit Datum in [`docs/OFFEN-v3.5.md`](docs/OFFEN-v3.5.md). Das
Wichtigste in einem Satz: Diese Fassung ist **nicht ausgeliefert**, der Relay
muss vor der Erweiterung stehen, und bis dahin ist der mittlere Modus über die
Leitung nicht erreichbar.

## Installieren (Entwicklerfassung)

1. Dieses Verzeichnis herunterladen.
2. In Chrome `chrome://extensions` öffnen, **Entwicklermodus** einschalten.
3. **„Entpackte Erweiterung laden"** und diesen Ordner auswählen.
4. Auf [cloud.smartragents.ai](https://cloud.smartragents.ai) anmelden, dann in
   der Seitenleiste auf „Mit diesem Tab verbinden".

## Prüfen

Die Zusicherungen oben sind nicht nur beschrieben, sie sind geprüft:

```bash
cd src && node --test "pruefung/*.test.mjs"
```

809 Prüfsätze, 809 grün, Stand 14.08.2026. Jeder so gebaut, dass er gegen die
*halbe* Verschlechterung rot wird, nicht nur gegen das Löschen. Sicherheit, die
man nachmessen kann.

Eine Zahl grüner Prüfsätze ist dabei kein Beleg für sich. Am Vormittag des
14.08.2026 standen hier 733, und eine Gegenlesung fand danach 31 Befunde, davon
neun schwer. Keiner war rot geworden, weil jedes Gebiet sich selbst gegen eine
Attrappe seines Nachbarn geprüft hat und die Naht dazwischen nirgends. Dafür
gibt es `src/pruefung/verzahnung.test.mjs`: Dort laufen die echten
Inhaltsskripte, der echte Nachrichtenhörer des Hintergrunddienstes und die
echte Ablage miteinander.

## Aufbau

```
manifest.json           Manifest V3
_locales/               Deutsch und Englisch, je 334 Schlüssel
src/panel/              Die Seitenleiste (Chat, Freigaben, Modus)
  startseite.js         Tabliste und Verbindungskarte
  werkbank.js           Abläufe, Domainregeln, Agentenmatrix, Protokollbuch
  sprache.js            data-i18n einsetzen
src/content/            In der fremden Seite, klassische Skripte
  geheim.js             Die eine Quelle: Was ist ein Geheimfeld
  overlay.js            Rahmen, Agentenzeiger, Wahrnehmung
  klickwache.js         Verdeckungswache vor jedem Klick
  selektor.js           Selektor-Kaskade
  rekorder.js           Aufzeichnung für den Teach-Modus
src/net/                Ohne Browser prüfbar, wo es geht
  befehle.js            Befehlsliste, Klassen, Freigabeentscheidung
  ausfuehrer.js         Die Befehlsschleife
  matrix.js             Domainregeln und Agentenmatrix
  werkstatt.js          Gespeicherte Abläufe
  protokollbuch.js      Das Buch der Fernaktionen
  link.js               Leitung zum Relay
src/background/         Service Worker
src/pruefung/           node:test-Prüfsätze
  verzahnung.test.mjs   Die Nähte zwischen den Gebieten, echte Skripte
docs/                   Vertrag, Drahtformat, Schemata, Migration, Offene Punkte
```

## Dokumente

- [`docs/VERTRAG-v3.5.md`](docs/VERTRAG-v3.5.md) — der Schnittstellenvertrag
- [`docs/DRAHTFORMAT.md`](docs/DRAHTFORMAT.md) — die Leitung, Wahrheitsquelle
- [`docs/MIGRATION-v3-zu-v3.5.md`](docs/MIGRATION-v3-zu-v3.5.md) — Umstieg
- [`docs/schema-workflow.json`](docs/schema-workflow.json) — Format eines Ablaufs
- [`docs/schema-fernprotokoll.json`](docs/schema-fernprotokoll.json) — Format auf der Leitung
- [`docs/DSGVO-verarbeitungen-v3.5.md`](docs/DSGVO-verarbeitungen-v3.5.md) — was verarbeitet wird
- [`docs/OFFEN-v3.5.md`](docs/OFFEN-v3.5.md) — was nicht geht
- [`CHANGELOG.md`](CHANGELOG.md) — was sich geändert hat

---

MIT-Lizenz. Ein Werk von **smartragents.ai × Fable 5** (AKATONGIE).
Leitgedanke: **Mensch mit Maschine.**
