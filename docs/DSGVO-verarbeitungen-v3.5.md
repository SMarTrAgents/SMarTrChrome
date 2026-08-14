# Verarbeitungstätigkeiten SMarTrChrome 0.6.0

**Zuarbeit für die Rechtsdokumente von smartragents.ai. Stand 14.08.2026.**

Was hier steht, ist am Quelltext abgelesen und nicht am Plan. Wo der Code etwas
anderes tut, als vorgesehen war, steht es hier so, wie der Code es tut.

**Der Rahmen, der über allem steht:** Alle sieben Ablagen dieser Fassung liegen
in `chrome.storage` im Browserprofil auf dem Rechner des Nutzers. Keine davon
wird an einen Server der Plattform übertragen, keine wird gesichert, keine wird
synchronisiert. `chrome.storage.sync` wird nirgends benutzt. Wer die Erweiterung
entfernt, entfernt alle sieben.

Neu gegenüber der Vorfassung sind die Nummern 1 bis 5. Nummer 6 und 7 stehen
zur Vollständigkeit dabei, weil die Rechtsdokumente sie ohnehin nennen müssen.

---

## 1. Protokollbuch der Fernaktionen

**Was wird verarbeitet.** Je Aktion, die aus der Ferne kommt, genau ein Eintrag
mit sechs Feldern: Zeitstempel in Millisekunden, Name des Agenten, Name des
Kommandos, Zieladresse, Ergebnis, Aktionsklassen.

Die Zieladresse wird auf ihren Ort gekürzt, also Schema, Wirt, Port und Pfad.
**Der Frageteil und die Sprungmarke fallen weg**, denn dort stehen Suchbegriffe,
Sitzungsmarken und Einmalschlüssel: `?token=…` ist Inhalt, nicht Ort. Das
Ergebnis ist eine unserer eigenen Fehlerkennungen oder das Wort „gelungen",
baulich passt in dieses Feld kein Satz von einer fremden Seite. **Der
Seiteninhalt wird nicht gespeichert**, weder Text noch Formularwerte noch
Überschriften.

**Wozu.** Auskunft an den Nutzer: Wer einem Agenten seinen Browser leiht, muss
hinterher nachsehen können, was in seinem Namen geschehen ist. Ohne dieses Buch
ist die Einzelfreigabe die einzige Auskunft, die er je bekommt, und die ist nach
zehn Sekunden vorbei.

**Wo gespeichert.** `chrome.storage.local`, Schlüssel `sa_protokollbuch`.
Ausschliesslich lokal.

**Wie lange.** Voreinstellung 30 Tage. Die Dauer ist in der Seitenleiste
einstellbar, zwischen 0 und 365 Tagen, und liegt in `sa_buch_tage`. Zweite
Grenze: höchstens 2.000 Einträge, der älteste fällt zuerst heraus.

**Wie gelöscht.** Automatisch, an dem Wecker, der alle 30 Sekunden ohnehin läuft:
Er liest die eingestellte Dauer und löscht alles, was älter ist. Von Hand: In der
Ansicht „Protokollbuch" die Dauer auf 0 setzen und merken lassen, dann ist das
Buch sofort leer. Gelöscht wird wirklich, nicht ausgeblendet, und die Erweiterung
meldet die Zahl der entfernten Einträge zurück.

**Hinweis.** Der Nutzer kann das Buch als JSON ausgeben. Der Text landet in
einem Feld zum Kopieren, die Erweiterung führt keine Berechtigung `downloads`
und schreibt keine Datei.

## 2. Aufgezeichnete Abläufe (Teach-Modus)

**Was wird verarbeitet.** Ein Ablauf, den der Nutzer selbst aufgezeichnet hat:
Kennung, Name, Beschreibung, Zeitpunkt der Aufzeichnung, Namen der Platzhalter
und die Schritte. Ein Schritt trägt seinen Typ und je nach Typ eine Zieladresse,
eine Selektor-Kaskade, einen eingetippten Wert, eine Auswahl, eine Richtung, eine
Wartezeit.

Zwei Felder sind personenbezogen, und zwar unabhängig davon, ob es beabsichtigt
war:

- **Die Selektor-Kaskade kann sichtbaren Seitentext enthalten.** Der vierte Anker
  ist ein Textanker der Form `text=Erneut einstellen`, höchstens 80 Zeichen.
- **Ein eingetippter Wert wird gespeichert.** Wer beim Aufzeichnen eine
  Artikelnummer, eine Anschrift oder einen Suchbegriff eintippt, hat ihn danach
  im Ablauf stehen, höchstens 2.000 Zeichen je Schritt.

**Ausdrücklich nicht gespeichert:** der Inhalt von Geheimfeldern. Trifft der
Rekorder ein Feld, dessen Rolle oder Name auf Passwort, PIN, TAN, CVV, OTP oder
Einmalcode deutet, liest er den Wert gar nicht erst aus. An dieser Stelle
entsteht ein Halt mit der Begründung „Login/2FA", an dem der Ablauf beim
Abspielen stehen bleibt und den Menschen bittet.

**Wozu.** Wiederkehrende Arbeit einmal vormachen und danach abspielen lassen.

**Wo gespeichert.** `chrome.storage.local`, Schlüssel `sa_workflows` für die
fertigen Abläufe, `sa_rekorder` für die gerade laufende Aufzeichnung.
Ausschliesslich lokal. Höchstens 100 Abläufe zu je 500 Schritten.

**Wie lange.** Fertige Abläufe bleiben, bis der Nutzer sie löscht, sie haben
keine Frist. Die laufende Aufzeichnung überlebt einen Seitenwechsel, damit sie
über mehrere Seiten führen kann, **aber keinen Browserstart**.

**Wie gelöscht.** Fertige Abläufe: Knopf „Löschen" je Ablauf in der Werkbank.
Laufende Aufzeichnung: automatisch bei jedem Browserstart und bei jeder
Installation oder Aktualisierung der Erweiterung.

**Hinweis für die Datenschutzerklärung.** Ein Ablauf verlässt den Rechner nur
dann, wenn der Nutzer ihn selbst über den Knopf „Ausgeben" kopiert und
weitergibt. Der Agent bekommt beim Abspielen die Kennung des Ablaufs und im
Fehlerfall die Beschreibung und die Anker des gescheiterten Schrittes, nicht den
ganzen Ablauf.

## 3. Miniaturbilder einer Aufzeichnung

Die datenintensivste Verarbeitung dieser Fassung. Sie gehört ausdrücklich in die
Rechtsdokumente.

**Was wird verarbeitet.** Zu einem aufgezeichneten Schritt eine JPEG-Aufnahme
des **sichtbaren Ausschnitts** des vorderen Tabs, also alles, was in diesem
Augenblick im Tab zu sehen ist. Dazu Bildtyp, Qualitätsstufe, das Rechteck des
angeklickten Elements, eine laufende Nummer, der Anlass und der Zeitpunkt.

Aufgenommen wird nur mit dem Anlass `user_request`, also nur, weil der Mensch
selbst eine Aufzeichnung gestartet hat. Nicht aufgenommen wird von gesperrten
Ursprüngen und dann, wenn der Tab nicht im Vordergrund steht: Ein Bild vom
falschen Tab wäre schlimmer als keines.

**Wozu.** Wiedererkennung: Der Mensch soll in der Werkbank sehen, an welcher
Stelle der Seite ein Schritt stattfand.

**Wo gespeichert.** `chrome.storage.local`, Schlüssel `sa_rekorder_bilder`.
Ausschliesslich lokal, höchstens 60 Bilder und zusammen höchstens 4 MiB. Die
Qualität wird stufenweise gesenkt, bis ein Bild in die Grenze passt, und passt
es auch dann nicht, entsteht kein halbes Bild, sondern gar keines.

**Wie lange.** Bis zum nächsten Browserstart. Sie gehören zur laufenden
Aufzeichnung und teilen deren Lebensdauer.

**Wie gelöscht.** Automatisch bei jedem Browserstart und bei jeder Installation
oder Aktualisierung, zusammen mit `sa_rekorder`.

**Hinweis, ehrlich.** Ein Bild kann personenbezogene Daten Dritter zeigen, wenn
sie im Augenblick der Aufnahme auf der Seite standen, zum Beispiel Namen in einer
Nachrichtenliste. Deshalb die kurze Frist und die enge Grenze. Angezeigt werden
die Bilder heute noch nirgends, die Werkbank zeigt zu einem Ablauf kein Bild an.
Sie werden also derzeit aufgenommen, gespeichert und ungenutzt wieder gelöscht,
siehe `docs/OFFEN-v3.5.md`.

## 4. Domainregeln und Agentenmatrix

**Was wird verarbeitet.** Hostnamen, die der Nutzer selbst eingetragen hat: die
Websites, auf denen er weiche Aktionsklassen freigeschaltet hat, die Websites auf
seiner Sperrliste, und je Agent die Websites samt der Klassen, die dieser Agent
dort haben darf. Der Personenbezug liegt in der Liste selbst, sie sagt etwas
darüber, welche Dienste der Nutzer benutzt.

**Ausdrücklich nicht enthalten:** Ausweise, Tokens, Kennwörter, Seiteninhalte.

**Wozu.** Voreinstellungen für die Rückfragen. Ohne diese Liste fragt die
Erweiterung bei allem nach, das ist der Auslieferungszustand.

**Wo gespeichert.** `chrome.storage.local`, Schlüssel `sa_matrix`. Ausschliesslich
lokal, `local` und nicht `session`, weil eine Einstellungsmatrix ihren Sinn
verliert, wenn sie bei jedem Browserstart leer ist.

**Wie lange.** Bis der Nutzer sie ändert, keine Frist.

**Wie gelöscht.** In der Werkbank, Ansicht „Regeln und Abläufe": Adresse
entfernen, Sperrliste leeren, Agenteneintrag leeren, danach speichern.

## 5. Betriebsmodus je Tab

**Was wird verarbeitet.** Je offenem Tab die Tab-Kennung von Chrome, der
gewählte Modus, der verbrauchte Schrittzähler und das eingestellte Schrittlimit.
Keine Adresse, kein Titel, kein Inhalt.

**Wozu.** Die Entscheidung, ob vor einem Schritt gefragt wird.

**Wo gespeichert.** `chrome.storage.session`, Schlüssel `sa_modus`.

**Wie lange.** Bis zum Ende der Browsersitzung. Ein Modus, der einen Neustart
überlebt, wäre eine Vollmacht, an die sich niemand erinnert.

**Wie gelöscht.** Von Chrome selbst beim Schliessen des Browsers. Der
Schrittzähler wird ausserdem zu Beginn jedes neuen Auftrags geleert. Die
Zuordnung Tab zu Modus bleibt bis zum Browserende stehen, auch wenn der Tab
inzwischen geschlossen wurde, sie enthält dann eine Zahl ohne Bezug.

## 6. Übertragung an Relay und Agent, unverändert im Umfang

Keine neue Verarbeitung, aber der Vollständigkeit halber, weil v3.5 ein Feld
hinzufügt.

**Was wird übertragen.** Während einer laufenden Sitzung und nur auf einen
einzelnen Befehl hin: der Textbaum der freigegebenen Seite, also Rollen, Namen
und Zustände der Bedienelemente sowie Textzeilen, dazu Adresse und Titel des
Tabs, und auf ausdrückliches Verlangen mit benanntem Anlass ein Bild des
sichtbaren Ausschnitts. Neu in v3.5: der Name des Agenten im Befehlsrahmen, er
kommt vom Relay und ist keine Angabe über den Nutzer.

**Wozu.** Damit der Agent die Seite bedienen kann, für die der Nutzer die
Freigabe erteilt hat.

**Wo gespeichert.** In der Erweiterung nirgends. Die Aufbewahrung auf der
Gegenseite richtet sich nach den Regeln der Plattform, nicht nach diesem
Dokument.

**Wie lange.** Die Sitzung endet spätestens mit ihrer Frist, bei Leerlauf früher,
bei Not-Aus sofort.

**Wie gelöscht.** Trennen, Not-Aus, Browserstart. Die Sitzung überlebt keinen
Browserstart, und die erteilten Seitenrechte werden beim Ende zurückgegeben.

## 7. Anmeldung an der Plattform, unverändert

**Was wird verarbeitet.** Der Ausweis des angemeldeten Kontos.

**Wozu.** Anmeldung an cloud.smartragents.ai und Erteilung der Sitzung.

**Wo gespeichert.** `chrome.storage.session`, Schlüssel `sa_ausweis`.

**Wie lange.** Bis zum Ende der Browsersitzung oder bis zum Abmelden.

**Wie gelöscht.** Abmelden in der Seitenleiste, Schliessen des Browsers,
Entfernen der Erweiterung.

---

## Was für den Web Store daraus folgt

Für die Angaben zum Datenverkehr im Chrome Web Store sind drei Sätze
massgeblich, und alle drei sind am Code belegt:

1. Die Erweiterung **verkauft keine Daten und gibt keine an Dritte weiter**.
2. Alles aus den Nummern 1 bis 5 bleibt **auf dem Rechner des Nutzers**.
3. Übertragen wird ausschliesslich das, was für den vom Nutzer freigegebenen
   Schritt gebraucht wird, und zwar an den Dienst, den der Nutzer selbst
   verbunden hat.

---

*SMarTrAgents.ai by ₳K₳ŦØŇǤƗɆ with Fable 5*
