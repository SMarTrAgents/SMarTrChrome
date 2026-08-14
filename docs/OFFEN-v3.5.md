# Offene Punkte v3.5

**Stand 14.08.2026, nach der Bauarbeit von zehn Gebieten. Zusammengetragen aus
den Berichten der Bau-Agenten, jeder Punkt mit Ursache und Ort.**

Was hier steht, steht nicht in der Ankündigung. Diese Liste ist die Antwort auf
den Befund vom 11.08.2026: An dem Tag lagen 18 grüne Prüfsätze über einer Wache,
die im ausgelieferten Klickweg niemand rief. Grün heisst gemessen, nicht
eingebaut, und der Unterschied gehört aufgeschrieben.

**Der Stand in einem Satz:** 809 Prüfsätze sind grün, und nichts davon ist
ausgeliefert.

**Nachtrag 14.08.2026, nachmittags.** Über den 733 grünen Prüfsätzen des
Vormittags fand eine Gegenlesung 31 Befunde, davon neun Blocker, und keiner
davon war rot geworden. Vier Gebiete haben repariert, danach war die
Verzahnungsprüfung an drei Stellen rot — an genau den Nähten zwischen ihnen.
Was seither geschlossen ist, steht in `CHANGELOG.md`; was hier steht, ist
weiterhin offen.

---

## 1. Auslieferung

### 1.1 Nichts ist commitet, nichts ist gepusht
Der ganze Arbeitsstand liegt uncommitted in `/home/tongie/SMarTrChrome`:
17 geänderte und 29 neue Dateien. Gemeldet von A-VERZAHNUNG, nachgezählt am
14.08.2026.

### 1.2 Der Relay ist nur lokal geändert
`/home/tongie/smartrbrowser/server/app.py` wächst rein additiv von 1723 auf 1877
Zeilen, `test_connect.py` um 43 Prüfsätze, 366 von 366 grün. **Kein ssh, kein
scp, kein docker, kein Neustart**, wie beauftragt. Die Änderungsliste mit der
bindenden Reihenfolge liegt im Bericht von A-RELAY: erst die Konstanten, dann
die Tabellen, dann die Rechenwege, zuletzt die Aufrufstellen. Die untere Stelle
liest die obere Konstante, ein halb kopierter Stand fällt erst beim ersten
Befehl auf und nicht beim Start.

### 1.3 Der Relay muss vor der Erweiterung stehen
Relay neu und Erweiterung alt ist folgenlos. Umgekehrt entstehen lauter
Absagen: `run_workflow` fällt am alten `REQUIRED` auf `full` und wird mit
`stufe_zu_niedrig` abgewiesen, `params` fällt aus dem Rahmen, `agent` fehlt,
`assist` kommt nie an. Keine falschen Erfolge, aber auch keine Abläufe.

## 2. Gebaut und gemessen, aber ohne Wirkung, bis draussen etwas nachzieht

Diese vier Punkte liegen ausserhalb dieses Baums. Ohne sie ist v3.5 auf der
Leitung halb.

### 2.1 `assist` entsteht nie
`/home/tongie/$SMarTrAgents/Deploy/smartrlink-ticket/ticket.py`: `SCHRITTMODI`
(Z86) kennt `assist` nicht, und die Sitzungsfreigabe (Z893 bis Z906) setzt
`step_mode` hart auf `confirm_each`. **Folge:** Der Umschalter in der
Seitenleiste kann nur einschränken, nie erweitern. In einer Sitzung mit
Einzelfreigabe gilt deshalb „jeder Schritt einzeln", ganz gleich, was der
Schalter zeigt. Erst bei Vollzugriff entscheidet er wirklich. Gemeldet von
A-RELAY und A-VERZAHNUNG.

### 2.2 Die Agentenmatrix hat nichts zu prüfen
Gateway, `POST /api/v1/link/session/bind` (E17, Bridge-Token): Der Anspruch
`agent` mit dem Namen des gebundenen Agenten wird nicht signiert. `agent_aus_ausweis`
liest genau diesen Anspruch, aus dem Rumpf darf der Name nicht kommen, das wäre
eine Selbstauskunft. **Folge:** Das Feld bleibt leer, die gebaute und gemessene
Matrix greift nirgends. Ein Rahmen ohne `agent` läuft bewusst weiter, sonst wäre
der Mensch auf dem Alltagsweg ausgesperrt.

### 2.3 Kein Agent kann `run_workflow` bauen
`/home/tongie/$SMarTrAgents/Deploy/smartrlink-agentenseite/usr/agents/smartr-browser/tools/smartrbrowser.py`:
Die Werkzeugtabelle kennt den Befehl nicht. Der Relay lässt ihn durch, gebaut
werden kann er nicht. Nötig sind Stufe `write`, Frist 120, die Felder
`workflowId` und `params`.

### 2.4 Falscher Erfolg auf der Desktopschiene
`connector.rs` beantwortet einen unbekannten Browserbefehl auf einer
`full`-Sitzung mit `success: true` und `dispatched: true`. Ein `run_workflow` an
eine Desktopsitzung ergibt damit einen Erfolg, der keiner ist. Die Datei war
niemandem zugeteilt und wurde nicht angefasst. Vor der Änderung war derselbe Weg
über die Stufe `full` bereits erreichbar, das Problem ist also älter als v3.5.

### 2.5 Der interne Aufrufer kann keinen Agenten nennen
Der Weg über `X-Internal-Key` trägt keinen Agentennamen. Dafür bräuchte es einen
Namen für die Kopfzeile, und der steht im Drahtformat nicht. Ein Feldname wird
nicht geraten.

### 2.6 Die zweite Fassung des Drahtformats
`docs/DRAHTFORMAT.md` in diesem Baum hat den Nachtrag zu v3.5 bekommen
(§13). Die Kopie unter `/home/tongie/$SMarTrAgents/Docs/SMarTrChrome/DRAHTFORMAT.md`
liegt ausserhalb dieses Gebiets und ist damit nicht mehr wortgleich. Wer sie
pflegt, zieht §13 nach.

## 3. Offen innerhalb der Erweiterung

### 3.1 Zwei Schritttypen ohne Befehl
Der Rekorder zeichnet für Enter und Tab einen Schritt vom Typ `key` auf
(`src/content/rekorder.js:783`), und `BEFEHLE` hat dafür keinen Eintrag.
`dblclick` steht in `SCHRITT_TYPEN`, wird aber von keinem Ereignisweg erzeugt.
Beide bleiben beim Abspielen mit einer benannten Absage stehen, ausdrücklich
nicht stillschweigend als Klick. **Empfohlene Reihenfolge der Prüfung:** (a) Der
Rekorder faltet ein Enter in den vorangehenden `input`-Schritt als `submit: true`,
das Feld gibt es bereits und der Ausführer kann es, dann braucht es gar keinen
neuen Befehl. (b) Sonst `key` als Befehl anlegen, aber zusammen mit
DRAHTFORMAT, `app.py` und `smartrbrowser.py` in einer Runde. Ein Client-Befehl,
den die drei nicht kennen, wäre genau die Bruchstelle, die dieser Vertrag
beseitigen sollte.

### 3.2 Die Selbstheilung ist halb
Bricht die ganze Kaskade, meldet der Ausführer `workflow_step_failed` mit
Beschreibung, Ankern und Textbaum, gemessen in `verzahnung.test.mjs` (V-d2). Das
**Zurückschreiben** der vom Agenten genannten neuen Kaskade in den Ablauf fehlt.
Dafür braucht es einen eigenen Befehl auf dem Draht.

### 3.3 Die Minutenbremse passt nicht zu Abläufen
Ein Ablauf mit mehr als dreissig Schritten läuft in `GRENZEN.befehleJeFenster`
(30 je 60 Sekunden) und endet mit `workflow_step_failed` und `budget_exceeded`.
Der Deckel wurde für Einzelbefehle gerechnet, nicht für Abspielvorgänge. Dazu
passt der Befund von A-RELAY: Der Relay bucht 50 Schritte je Ablauf, zwei Abläufe
in derselben Minute sind damit nicht möglich, sechs erschöpfen die Sitzung. Und
er sieht die Einstellung des Menschen nie: Wer das Schrittlimit auf 500 stellt,
wird vom Relay zu niedrig gebucht, bindend ist dann der Deckel der Erweiterung.

### 3.4 Die Miniaturbilder werden nirgends angezeigt
Der Weg von der Seite bis in die Ablage ist gebaut und gemessen (V-h), die
Werkbank zeigt zu einem Ablauf aber kein Bild. Die Bilder werden also derzeit
aufgenommen, gespeichert und ungenutzt wieder gelöscht.

**Nachtrag 14.08.2026 (Befund M3), das Wegräumen ist repariert.** Bis dahin
geschah es nur bei `onStartup` und `onInstalled`; wer den Browser tagelang
offen lässt, sammelte die Bilder mehrerer Aufzeichnungen an, bis zu 60 JPEGs
des ganzen sichtbaren Tabs und 4 MiB. Jetzt räumt `background/worker.js` bei
`rekorder:start` und `rekorder:stop` mit auf, dazu kommt eine Verfallszeit von
zwei Stunden im Bildweg selbst. Gemessen in `verzahnung.test.mjs` V-i3. Offen
bleibt allein die Anzeige.

### 3.5 Das Schrittlimit hat kein Bedienelement
Der Deckel auf `GRENZEN.schritteDeckel` (500) ist gebaut und gemessen
(`ausfuehrer.js:271` und `:322`), aber `panel.js` sendet über `modus:setzen`
heute nur den Modus und nie eine Grenze. Der Weg ist offen, der Knopf fehlt.

### 3.6 Zwei Nachrichten ohne Absender
`worker.js` beantwortet `werkbank:schreiben` und `werkbank:loeschen`, und
niemand sendet sie: `src/panel/werkbank.js` schreibt über die Modulimporte
direkt in `chrome.storage.local`. Beide Wege funktionieren und sind gemessen,
und beide gehen durch dieselbe Prüfung `workflowPruefen` in
`src/net/werkstatt.js` — es sind zwei Aufrufer einer Regel, nicht zwei Regeln.
Vertrag §6 nennt sie seit dem 14.08.2026 ausdrücklich als zweiten Weg, damit
Vertrag und Code dasselbe sagen. Ob die Werkbank umstellt, bleibt offen.

**Erledigt am 14.08.2026, nachmittags:** `rekorder:ping` hatte hier ebenfalls
gestanden. Es hat seit Befund H6 einen Absender, nämlich `rekorderNachziehen`
in `background/worker.js` — die Stelle, die den Aufzeichner nach einem
Seitenwechsel nachzieht. Gemessen in `bruecke.test.mjs`.

**Und die Gattung dazu ist jetzt gemessen:** `verzahnung.test.mjs` V-k legt
jeden `overlay:`-Namen, den der Auslieferungsstand losschickt, den ECHTEN
Hörern von `overlay.js` und des Dienstarbeiters vor. Ein Name ohne Empfänger
wird damit rot, statt sich als sauber gemeldeter `workflow_step_failed` zu
tarnen. Genau so ist `overlay:kaskade` durch 733 grüne Prüfsätze gekommen.

### 3.7 Was der Rekorder nicht sieht
- Nur der oberste Rahmen wird aufgezeichnet, `worker.js` spielt mit
  `allFrames: false` ein. Klicks in einem eingebetteten Rahmen entstehen nicht
  als Schritt.
- Ein Bildlauf **innerhalb** eines rollbaren Behälters wird nicht aufgezeichnet,
  gemessen wird die Seitenposition.
- Eine Seite, die ständig selbst arbeitet, zum Beispiel eine Uhr im Sekundentakt,
  erreicht die DOM-Ruhe nie. Dann entsteht kein Warteschritt.

### 3.8 Der Klassifizierer sieht bei `navigate` die falsche Adresse
`klassenBestimmen` bekommt als Kopf die Adresse, auf der der Tab **jetzt** steht,
nicht das Ziel. Ein `navigate` nach `/checkout` wird deshalb nicht als `zahlung`
erkannt. Die Zieladresse steht dem Menschen in der Frage, eine Guardrail-Frage
löst sie nicht aus. Eine strengere Lesart wäre möglich und gehört zu A-REGELN.

### 3.9 Der Bildlaufstand der Schleifenmarke ist grob
Er stammt aus `get_state` und `scroll`, also aus den zwei Befehlen, die ihn
ohnehin berichten. Bei allen anderen bleibt er stehen. Die Schleifenerkennung
fällt dadurch strenger aus, also eine Rückfrage mehr, nie milder.

### 3.10 Zwei Stellen in der Seitenleiste, die sich überlagern
`src/panel/startseite.js` räumt beim Aufbau `#startseite` leer, die dort
hinterlegte Überschrift und die Ersatzliste kommen im Produktivbetrieb nicht zum
Zug und bleiben als Ersatzfassung stehen. Und die Startseite zeichnet eine eigene
Statuskarte mit Trennen-Knopf, während die Seitenleiste die Verbindung ohnehin in
`#tabkarte` zeigt. Gehört einmal aufgeräumt.

### 3.11 Der eine Klick beantragt die schwächste Stufe
Vorbelegt ist `read`. Ob der Regelweg stärker vorbelegt sein soll, ist eine
Entscheidung des Inhabers und keine Bauentscheidung.

### 3.12 Das Ausgeben schreibt keine Datei
Weder Protokollbuch noch Ablauf landen als Datei auf der Platte, der Text steht
in einem Feld zum Kopieren. Wer eine echte Datei will, meldet `downloads` als
neue Berechtigung an. Ein Dienst `ausgeben(text, dateiname)` kann das später
übernehmen, die Stelle ist vorbereitet.

## 4. Sprache

### 4.1 Siebzehn Absagesätze bleiben deutsch
Dreizehn aus `src/panel/werkbank.js` und vier aus `src/content/rekorder.js`. Sie
gehen denselben Weg wie die Sätze aus `net/werkstatt.js` und `net/matrix.js`, und
die sind Protokolltext aus fremdem Gebiet. Entweder wandern alle Quellen
gemeinsam in den Katalog, oder keine. Ein halber Weg wäre eine Ansicht, in der
jede zweite Absage die Sprache wechselt.

### 4.2 Ein Satz auf der Kundenseite ist noch fest deutsch
`src/net/ausfuehrer.js:1820` setzt in `overlay:an` den Text „SMarTrAgent steuert
diesen Tab, Esc Esc = Stopp". Der Schlüssel `overlay_schild_grund` liegt in
beiden Katalogen bereit, und `overlay.js` benutzt ihn bereits. Das ist der
einzige sichtbare Satz, der in der englischen Oberfläche deutsch bleibt.

### 4.3 Die Übersetzung ist nicht gegengelesen
Vor der Einreichung im Web Store sollte ein englischer Muttersprachler über
`_locales/en/messages.json` gehen, besonders über die vier langen Sätze
`dialog_fussnote`, `sperre_cloud_text`, `fehler_bindung_ausweis` und
`modus_riegel`.

### 4.4 Zwei Kleinigkeiten im Katalog
Das `aria-label` des Adressfeldes je Agent trägt den Agentennamen („Adresse für
SMarTrTrader") und braucht einen Schlüssel mit Platzhalter. Und die Präfixe
`start_`, `matrix_` und `wb_` stehen in Vertrag §12 nicht, sie halten das Muster
aber ein und sind eigene Bereiche.

## 5. Was am Gerät nachzumessen bleibt

Nichts davon ist im echten Chrome geprüft. Die Nachbildungen in den Prüfsätzen
ersetzen das nicht und behaupten es auch nicht.

- **Verdeckung in geschlossenen Schattenbäumen und in fremden Rahmen (iframes).**
  Der Funktionstest 0.5.3 hat das offengelassen, weil ohne Einbau nichts
  Prüfbares da war. Jetzt ist es da und gehört auf den Prüfstand.
- **Der Modusrahmen mit `border-image`:** Sieht er im echten Chrome so aus wie
  gedacht?
- **Der Stoppknopf im Schild:** Bleibt er unter einem fremden Überzug wirklich
  klickbar?
- **F-2 aus dem Funktionstest bleibt offen:** Ein `*{display:none!important}` der
  Seite löscht das Zeichen, ohne dass die Sitzung endet. Der Wächter misst die
  tatsächliche Sichtbarkeit des Wirts weiterhin nicht. Gehört in eine eigene
  Runde.
- **Layout, Bildschirmleser und Vorlesen der Seitenleiste,** dazu der
  Markenverlauf und die 44-Pixel-Trefferflächen.
- **Der Teach-Modus an echten Anmeldemasken,** an echten Schattenbäumen und
  echtem Layout.
- **Ein Lauf mit `--lang=en-US`** über CDP `Extensions.loadUnpacked`: Lädt die
  Erweiterung mit `default_locale` überhaupt, steht `<html lang>` auf `en`, und
  spricht die Sprachausgabe englisch?

## 6. Kleinigkeiten, die niemanden aufhalten

- Der Kommentar in `background/worker.js:205` verweist auf `overlay.js:235` als
  Stelle, an der die Notbremse gesendet wird. Die Zeilennummer stimmt nicht
  mehr, und es gibt inzwischen zwei Absender, Esc Esc und den Schildknopf.
- `pruefung/overlay.test.mjs` lädt seit dieser Runde `net/seite.js` und damit
  `rechte.js` und `dienste.js`. Bricht dort jemand etwas, fällt es in einer
  fremden Datei auf. Das ist gewollt, aber es ist eine neue Abhängigkeit.
- In `pruefung/manifest.test.mjs` sehen die zwei Prüfsätze zu Gedankenstrichen
  und Ersatzschreibungen jetzt nur noch `__MSG_…__` und messen dort nichts mehr.
  Die Zusage ist nicht verloren, sie ist umgezogen: `sprache.test.mjs` L5a und
  L5c messen sie für den ganzen Katalog statt für vier Zeilen.

## 7. Entscheidungen, die während des Bauens getroffen wurden

Sie sind nicht offen, aber sie stehen in keinem Vertrag und müssen bekannt sein.

- **`run_workflow` trägt absichtlich keine Aktionsklasse,** weil §3.1 ihm keine
  zuordnet. Folge: Es wird dafür in **jedem** Modus gefragt. Das ist die sichere
  Richtung.
- **Der Parameter des Ablaufs heisst auf dem Draht `workflowId`.** Der
  Befehlsrahmen trägt `id` bereits als Kennung des Auftrags. Der Ausführer nimmt
  `workflowId`, wenn es dasteht, sonst `id`, und die zweite Lesart bleibt für den
  lokalen Weg aus der Seitenleiste.
- **Neu erfundene Schrittfelder,** weil der Vertrag sie nicht nennt und niemand
  ohne sie bauen kann: `key` (Enter, Tab), `ms` und `until` beim Warten, `clear`
  und `submit` beim Eintippen, `beschreibung` an jedem Schritt für die
  Selbstheilung, dazu `WARTE_ARTEN` mit `load`, `domcontentloaded`, `networkidle`
  und `idle`.
- **Neue Ablageschlüssel,** die der Vertrag nicht nennt: `sa_rekorder` für die
  laufende Aufzeichnung, `sa_rekorder_bilder` für ihre Bilder, `sa_buch_tage` für
  die Aufbewahrungsdauer des Protokollbuchs.
- **`sperren` in `freigabeNoetig`** ist genau dann wahr, wenn die Sperrliste
  greift. `fragen` bleibt daneben wahr, der Mensch darf im Augenblick trotzdem
  Ja sagen.

## 8. Beim Bauen gefunden und noch in derselben Runde geschlossen

Damit niemand danach sucht:

- `aufraeumen(0)` liess einen Eintrag stehen, der in derselben Millisekunde
  geschrieben wurde. Ein Knopf, der bei schnellem Rechner einen Eintrag
  übriglässt, ist kein Knopf zum Leeren.
- Ein leeres Dauerfeld im Protokollbuch hätte wegen `Number("")` als null Tage
  gegolten und das ganze Buch gelöscht.
- `workflowPruefen` liess eine `javascript:`-Adresse in einem `navigate`-Schritt
  durch. Die Schemaprüfung steht jetzt in der Positivliste selbst, durch die
  jeder Ablauf muss.
- `overlay:kaskade` und `rekorder:bild` hatten je einen Sender und keinen
  Empfänger. Ohne den ersten war kein Ablauf mit `click`, `input`, `select` oder
  `scroll` abspielbar.
- `overlay.js` beantwortete `rekorder:`-Nachrichten und blockierte damit das
  Einspielen des Rekorders bei laufender Sitzung.
- Die Ablage `sa_modus` wurde von `worker.js` und `ausfuehrer.js` verschieden
  ausgelegt, dort Limit, hier Zähler. Ein eingestelltes Schrittlimit wäre damit
  sofort zu einem `step_limit` geworden.
- Der Inhalt eines bearbeitbaren Geheimfeldes ging als `name` an den Agenten.
- Ein Pfad in einem Matrixmuster hätte eine Erlaubnis breiter gemacht als das,
  was der Mensch getippt hat.
- Ein doppelter Bucheintrag, weil Brücke und Ausführer beide buchten.

---

*SMarTrAgents.ai by ₳K₳ŦØŇǤƗɆ with Fable 5*
