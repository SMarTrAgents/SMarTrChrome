# DRAHTFORMAT SMarTrChrome / SMarTrLink

**Verbindlich. Stand 2026-07-27 (Nachtrag Reparaturrunde 3).**

Der Nachtrag ist an sieben Stellen eingearbeitet: E13 (Client-Positivliste),
E14 (halb angemeldete Ausweise), §4.2 (was ein Alltags-Ausweis ist), §5.1
Schritt 1 (genau zwei Unterprotokolle), §6 (Befehlsausweis = Eigentumsnachweis,
`id`, Wurzelpunkt), §6.1 (vollständige Fehlerliste des Relays) und §8 (die
bisher fehlenden Schließgründe). Jede dieser Stellen verschärft, was der Relay
ohnehin tut oder tun muss; die Begründung steht jeweils dabei.

Dieses Dokument legt fest, was zwischen den vier Bausteinen wirklich über die
Leitung geht. Es ist die **einzige** Quelle für Feldnamen, Endpunkte, Rahmen und
Fehlercodes. Wo `spec-01-protokoll.md` und `spec-02-sicherheit.md` sich
widersprechen, gilt dieses Dokument — die Spezifikationen bleiben als Begründung
lesenswert, sind aber für das Drahtformat nicht mehr maßgeblich.

Wer danach baut, muss die Spezifikationen nicht gelesen haben.

Die vier Seiten:

| Baustein | Datei | Rolle |
|---|---|---|
| Erweiterung | `$SMarTrAgents/smartrchrome/src/net/*.js` | stellt den Antrag, hält die Sitzung |
| Freigabeseite | `$SMarTrAgents/Cloud/cloud-frontend/src/{lib/linkConfirm.ts,components/LinkConfirm.tsx}` | der Mensch entscheidet hier |
| Ticketausgabe | `$SMarTrAgents/Deploy/smartrlink-ticket/ticket.py` | stellt das Einweg-Ticket aus |
| Relay | `/home/tongie/smartrbrowser/server/app.py` | führt die Sitzung, erzwingt die Grenzen |

Fünfter Beteiligter, der **nicht** angefasst wird:
`/home/tongie/smartrbrowser/src-tauri/src/connector.rs` — der produktive
Desktop-Client. Jede Festlegung hier ist so gewählt, dass er unverändert
weiterläuft. Wo das begründungsbedürftig ist, steht es dabei.

---

## 0. Warum es dieses Dokument gibt

Am 26./27.07. haben drei Seiten gleichzeitig gebaut und sich die Feldnamen
jeweils selbst ausgesucht. Die Gegenprobe hat fünf belegte Bruchstellen gefunden.
Alle fünf werden hier entschieden — plus drei weitere, die beim Zusammenlesen
auffielen und denselben Schaden anrichten würden.

---

## 1. Entscheidungen

Jede Zeile ist eine Festlegung, keine Empfehlung. Die Begründung steht dahinter.

### E0 — Die Leitung spricht Englisch, der Quelltext Deutsch

**Festlegung:** Feldnamen auf der Leitung (JSON, JWT-Ansprüche, HTTP-Rümpfe)
sind englisch und `snake_case`. Bezeichner, Kommentare und Fehlertexte für
Menschen sind deutsch.

**Warum:** Die Hälfte der Feldnamen (`type`, `access`, `duration`, `code`,
`expires_at`) ist Bestand und kann nicht umbenannt werden, ohne den
Desktop-Client zu brechen — eine halb deutsche Leitung wäre genau die
Uneinheitlichkeit, die dieses Dokument beseitigen soll.

**Folge:** `erbeten` → `requested`, `vorbelegung` → `preselect`,
`grenzen` → `limits`, `kennwort` → `verify_word`, `zweck` → `purpose`,
`ansage` → `verify_word_spoken`, `kennwort_laenge` → `verify_word_len`,
`verbleibende_versuche` → `attempts_left`.

---

### E1 — Der Antrag heißt `requested` (Befund a)

**Festlegung:** Das Objekt mit dem Wunsch der Erweiterung heißt in **beide**
Richtungen `requested`. `erbeten` und `entwurf` gibt es auf der Leitung nicht
mehr.

**Warum:** `requested` ist der Name, den die Erweiterung heute schon **sendet**
und den die Ticketausgabe beim Eingang schon **liest** — ein Wort für eine Sache
in beiden Richtungen kostet genau eine Zeile in `ticket.py` und keine Zeile im
Frontend.

**Folge:** `ticket.py:679` `"erbeten": entwurf` → `"requested": entwurf`.
`linkConfirm.ts:238` darf die Ausweichnamen (`o.entwurf`, `o.granted`) fallen
lassen; sie zu behalten wäre eine Einladung, den Fehler zu wiederholen.

---

### E2 — Handschlag: Ticket ins Unterprotokoll, Ausweis in den `auth`-Rahmen (Befund b)

**Festlegung:**

* Das **Einweg-Ticket** steht als **letztes** Element der WebSocket-Unterprotokollliste:
  `["smartrlink.v2", "<TICKET-JWT>"]`.
* Der **Alltags-Ausweis** steht im `auth`-Rahmen im Feld `ausweis`.
* Der Relay prüft beide und verlangt denselben Nutzer (`ticket.sub == ausweis.sub`).
* `?token=` bleibt der Weg der **Altschiene** und nimmt **nur** Alltags-Token an.

**Warum:** Das Ticket lebt 60 Sekunden, ist einmal einlösbar und auf Stufe, Dauer
und Adressen begrenzt — landet es in einem Proxy-Zugriffslog, ist es dort längst
tot; der Alltags-Ausweis gilt 24 Stunden für das ganze Konto und darf deshalb
niemals in einer Kopfzeile stehen, sondern nur im verschlüsselten Rumpf.

**Warum es den Desktop nicht bricht:** Er bietet kein Unterprotokoll an und
schickt `?token=`. Die Ticketschiene wird ausschließlich durch ein vorhandenes
Unterprotokoll ausgelöst; ohne Unterprotokoll ändert sich für ihn nichts.

**Warum der Relay nichts umbauen muss:** Er nimmt bereits das letzte
Unterprotokoll-Element als Token (`app.py:550-553`). Neu ist nur die Prüfung des
`ausweis`-Feldes.

**Abgrenzung zur Empfehlung in `ABNAHME-UND-CUTOVER.md` §1.4 Punkt 1:** Dort
steht „Ticket im Unterprotokoll **und** Alltags-Ausweis". Beide in die Kopfzeile
zu legen erfüllt zwar auch die Doppelprüfung, setzt aber den langlebigen Ausweis
der Protokollierung aus. E2 ist die strengere Variante derselben Empfehlung.

**Zusätzlich, fail-closed:**

* Ein Ticket (`aud = smartr-connect`) in `?token=` → Abweisung `4400 ticket_im_query`.
* Ein Alltags-Token im Unterprotokoll → Abweisung `4400 token_im_unterprotokoll`.
* Unterprotokoll **und** `?token=` gleichzeitig → `4400 protocol_error`. Zwei
  Ausweise in einer Verbindung heißt, dass eine Seite rät, welcher gilt.
* Unterprotokollliste ohne `smartrlink.v2` → `4400 protocol_error`.
* Kein `ausweis` im `auth`-Rahmen auf der Ticketschiene → `4401 ausweis_fehlt`.
* `ticket.sub != ausweis.sub` → `4401 ausweis_fremd`.

Die Schienenwahl in einem Satz: **Ein Unterprotokoll bedeutet Ticketschiene, kein
Unterprotokoll bedeutet Altschiene.** Es gibt keinen dritten Fall und keine
Mischung.

---

### E3 — Der Nachweis heißt `reauth.assertion` (Befund c)

**Festlegung:** `reauth` ist ein Objekt mit `method` (heute nur `"password"`) und
`assertion` (der Nachweis selbst). `reauth.password` gibt es nicht.

**Warum:** Dasselbe Feld trägt später eine WebAuthn-Signatur oder einen
Einmalcode; ein Feldname `password` wäre an dem Tag falsch und müsste erneut
umbenannt werden — außerdem heftet sich kein Passwortspeicher und keine
Protokollheuristik an einen JSON-Schlüssel namens `assertion`.

---

### E4 — `scope` ist `smartrlink-ticket` (Befund d)

**Festlegung:** Der JWT-Anspruch `scope` des Einweg-Tickets trägt genau den Wert
`"smartrlink-ticket"`. `"smartrlink-control"` wird **nirgends mehr** ausgestellt
und **nirgends mehr** akzeptiert; der Aliasname im Relay entfällt.

**Warum:** Der Anspruch benennt, **was das Token ist** (eine einmalige
Eintrittskarte), nicht, was es später erlaubt, und `smartrlink-ticket` ist der
Wert im wörtlichen Anspruchssatz von spec-01 §3.4, den der Relay bereits als
Hauptwert führt — ein zweiter geduldeter Name bedeutet, dass zwei Listen
gleichzeitig gepflegt werden müssen, und genau daran ist gestern alles gescheitert.

**Folge:** `ticket.py:60` `TICKET_SCOPE = "smartrlink-ticket"`;
`app.py:65-66` `TICKET_SCOPE_ALIAS`/`TICKET_SCOPES` entfallen.
Die Sperre in `ticket.py:363` (ein Steuerticket ist kein Anmeldenachweis) muss
gegen den neuen Wert vergleichen.

---

### E5 — Schließcodes: 4409 = Leerlauf, 4410 = Widerruf (Befund e)

**Festlegung:** Es gilt durchgängig die Tabelle aus spec-01 §3.5, siehe §8.

**Warum:** So ist der Relay gebaut (`app.py:97-98`) und so steht es in der
Textausgabe der Erweiterung (`link.js:67-68`) — die andere Reihenfolge zu wählen
hieße, zwei laufende Bausteine zu ändern, um eine Tabelle zu retten, die niemand
implementiert hat.

---

### E6 — `scope` bedeutet nur noch eines. Der Geltungsbereich ist flach

**Festlegung:** Das Wort `scope` bezeichnet ausschließlich den JWT-Anspruch aus
E4. Der Geltungsbereich einer Sitzung wird überall mit **drei flachen Feldern**
beschrieben:

| Feld | Typ | Bedeutung |
|---|---|---|
| `mode` | `"tab"` \| `"domains"` | „nur der eine Tab" oder „diese Adressen" |
| `allow` | `string[]` | Hostnamen, ASCII/Punycode, klein, optional `*.` davor |
| `tab_host` | `string` | Host des Tabs, aus dem der Antrag kam |

**Warum:** `scope` hieß bisher gleichzeitig eine Liste (`auth_ok`), ein Objekt
(HTTP) und eine Zeichenkette (JWT); `linkConfirm.ts:245-255` trägt bereits eine
Fallunterscheidung für zwei Formen desselben Feldes — drei Bedeutungen für ein
Wort sind keine Namensfrage mehr, sondern ein Fehler mit Ankündigung.

**Folge:** Ein Objekt `{mode, domains}` gibt es nicht mehr, `scp` und `sites`
gibt es nicht, `domains` heißt überall `allow`.

---

### E7 — `allow` ist auf der Ticketschiene nie leer

**Festlegung:** Bei `mode: "tab"` enthält `allow` **genau einen** Eintrag: den
`tab_host` ohne Platzhalter. Ein Ticket mit leerem `allow` wird vom Relay mit
`4400 allow_leer` abgewiesen.

**Warum:** Der Relay prüft den Geltungsbereich nur, wenn `sess.allow` gefüllt ist
(`app.py:742`) — ein leeres `allow` ist heute **keine** Beschränkung, sondern die
Aufhebung jeder Beschränkung, und „nur dieser Tab" wäre damit die weiteste
Freigabe im System statt der engsten.

**Folge:** Kann die Erweiterung keinen `tab_host` nennen (z. B. `chrome://`), ist
der Antrag im Modus `tab` ungültig: `400 tab_host_fehlt`.

---

### E8 — Der Wunsch wird nie zur Freigabe

*(Gilt für den manuellen Weg. Auf der Lesestufe entscheidet seit E15 kein
Mensch mehr — dort ersetzt der Serverdeckel diese Festlegung: der
Antragsteller bekommt statt seines Wunsches das Minimum.)*

**Festlegung:**

1. `GET /api/v1/link/request/{rid}` liefert `requested` **und** `preselect`.
   `preselect` ist immer `{access:"read", duration:600, mode:"tab", allow:[],
   step_mode:"confirm_each"}`.
2. Die Freigabeseite belegt ihre Bedienelemente **ausschließlich** aus
   `preselect`. `requested` wird als Zitat angezeigt („Die Erweiterung bittet
   um …"), nie als Vorauswahl, nie als Anweisung.
3. Fehlt ein Feld im Rumpf von `POST /confirm`, ergänzt die Ticketausgabe es aus
   `preselect` — **niemals** aus `requested`.
4. `reauth` ist bei **jeder** Freigabe Pflicht, nicht nur bei `write` (siehe E9).

**Warum:** Punkt 3 ist der eigentliche Befund: `ticket.py:737-740` setzt heute
den Wunsch der Erweiterung als Vorgabe ein, wenn die Seite ein Feld wegläßt —
damit entscheidet bei jedem Übertragungsfehler der Antragsteller über seine
eigene Befugnis.

**Folge:** `LinkConfirm.tsx:398/476-480` darf `antrag.*` nicht mehr als
Absendewert verwenden; abgesendet wird, was der Mensch eingestellt hat.

**Was der Mensch darf:** hochsetzen bis an die harten Deckel aus `limits` — es
ist seine Entscheidung. Bei `allow` ist der Spielraum enger: erlaubt sind nur
Einträge aus `requested.allow` sowie `tab_host` und `*.tab_host`. Eine hier frei
erfundene fremde Adresse wäre eine Freigabe für eine Seite, die der Mensch in
diesem Moment gar nicht vor sich hat.

---

### E9 — Herkunftsbindung, und `reauth` immer

*(Gilt für den manuellen Weg, also alles oberhalb von read. Die Lesestufe
wird seit E15 ohne Freigabeseite bewilligt — dort gibt es weder `confirm`
noch `reauth`; was stattdessen trägt, steht in E15.)*

**Festlegung:** siehe §7 im Einzelnen. Kurz:

* `POST /confirm` wird nur aus dem Web-Ursprung angenommen.
* `POST /redeem` wird nur von der antragstellenden Erweiterung angenommen, und
  zwar mit einem Geheimnis, das die Freigabeseite nie zu sehen bekommt
  (`redeem_key`).
* `reauth` ist bei jeder Freigabe Pflicht.

**Warum `reauth` immer:** Das Kennwort (`verify_word`) zeigt die Erweiterung
selbst an — es ist vor ihr kein Geheimnis und hält sie deshalb nicht davon ab,
sich selbst freizugeben; das Kontopasswort ist das einzige Stück, das sie nicht
hat. Preis: eine Passworteingabe je Sitzung, höchstens einmal pro Stunde. Wird
bezahlt.

---

### E10 — Das Ticket wird bei `POST /redeem` abgeholt, nicht beim Anzeigen

**Festlegung:** `GET /api/v1/link/request/{rid}` liefert **nie** ein Ticket und
verbraucht **nichts**; er darf beliebig oft gerufen werden.
Das Ticket kommt ausschließlich aus `POST /api/v1/link/redeem`.

**Warum:** Die Erweiterung fragt heute den Anzeige-Endpunkt ab und erwartet dort
ein `ticket` (`ticket.js:147-176`), das dieser Endpunkt nie liefert — die
Freigabe würde also selbst dann scheitern, wenn alle Namen stimmten. Umgekehrt
trägt die Freigabeseite einen Kommentar, sie dürfe nur einmal laden, weil ein
zweiter Abruf das Ticket verbrenne (`LinkConfirm.tsx:310-311`); auch das stimmt
nicht und kostet nur Robustheit.

---

### E11 — Leerlaufkappung: an für Tickets, aus für den Desktop

**Festlegung:** Die Leerlaufkappung läuft immer, aber `idle_limit` ist auf der
Altschiene `0` (= aus) und auf der Ticketschiene der Wert aus dem Ticket
(Vorgabe **600 s**, am 05.08.2026 vom Inhaber von 180 s angehoben, nachdem die
Frist eine laufende Sitzung nach 182 s beendet hatte, siehe
`PLAN-VERBESSERUNGEN-20260805.md`). `CONNECT_IDLE_ENFORCE` entfällt.

**Warum:** Der Desktop hält die Leitung mit einem WS-Protokoll-Ping wach, der
keine Anwendungstätigkeit erzeugt — eine scharfe Kappung würde ausgerechnet den
produktiven Client trennen (`app.py:465-477`); mit `idle_limit = 0` für die
Altschiene ist er sicher und die neue Schiene trotzdem gedeckelt.

**Folge:** `app.py:71` `LEGACY_IDLE_DEFAULT = 0`, `app.py:70`
`TICKET_IDLE_DEFAULT = 600` (seit 05.08.2026, vorher 180; heute `IDLE_TIMEOUT`
in `ticket.py:84`).

---

### E12 — Wer welche Adresse ruft

**Festlegung:**

| Aufrufer | Basis | wofür |
|---|---|---|
| Erweiterung | `https://api.smartragents.ai` | `/api/v1/link/*` |
| Erweiterung | `https://connect.smartragents.ai` | `/ws/browser`, `/api/v1/browser/*` |
| Freigabeseite | eigener Ursprung, relativ | `/api/v1/link/*` |
| Freigabeseite (Ziel) | `https://cloud.smartragents.ai` | die Seite selbst |

**Warum:** Der Web-Ursprung der Freigabeseite ist der Anker der Herkunftsbindung
(§7). Behält die Erweiterung `https://cloud.smartragents.ai/*` in
`host_permissions`, darf sie in genau diesem Ursprung Skripte ausführen und die
Bindung ist wertlos — deshalb ruft sie das Gateway über `api.` und öffnet die
Freigabeseite nur als Tab (`chrome.tabs.create` braucht keine Berechtigung).

**Folge:** `manifest.json` — `https://cloud.smartragents.ai/*` aus
`host_permissions` streichen. `dienste.js` — `GATEWAY_BASIS =
"https://api.smartragents.ai"`, zusätzlich `RELAY_BASIS =
"https://connect.smartragents.ai"`. `link.js:343` ruft `disconnect` auf
`RELAY_BASIS`, nicht auf dem Gateway.

---

### E13 — Der Stufendeckel ist eine Positivliste bekannter Clients

**Festlegung:** Der Relay führt eine Positivliste `client → höchste Stufe`. Sie
enthält heute genau einen Eintrag: `smartrchrome → write`. Der Anspruch `client`
wird vor dem Nachschlagen kleingeschrieben. Ein Client, der **nicht** auf der
Liste steht — auch ein fehlender —, bekommt keine Sitzung:
`4400 client_unbekannt`.

**Warum:** Vorher stand dort eine Negativliste, und wer nicht daraufstand, hatte
gar keinen Deckel. Am 27.07. live nachgewiesen: `client: "SMARTRCHROME"` in
Großbuchstaben, `client: "beliebig"` und `client: "smartrbrowser"` ergaben
jeweils `access: "full"` — und damit standen `terminal` und `eval` über die
Brücke offen. Ein Deckel, der bei jedem unbekannten Namen ausfällt, deckelt
nichts.

**Warum es den Desktop nicht bricht:** Die Liste gilt ausschließlich für die
Ticketschiene. Der Desktop fährt auf der Altschiene, hat dort keinen Deckel
(§5.2) und stellt gar kein Ticket aus. `smartrbrowser` steht bewusst **nicht**
auf der Liste: §3.1 lässt nur `smartrchrome` Tickets beantragen, also ist ein
Ticket auf einen anderen Namen entweder ein Fehler der Ticketausgabe oder ein
Versuch.

---

### E14 — Eine halbe Anmeldung ist kein Ausweis

**Festlegung:** Ein Alltags-Ausweis, dessen `amr` eine der Marken
`mfa-pending` oder `mfa-setup` trägt, wird vom Relay überall abgewiesen: auf der
Altschiene (`?token=`), als `ausweis` im `auth`-Rahmen der Ticketschiene und als
`Authorization: Bearer` an jedem HTTP-Endpunkt. WebSocket: `4401 unauthorized`.
HTTP: `401 invalid_token`.

**Warum:** Der Gateway stellt diese Tokens mit **demselben** `JWT_SECRET` aus wie
die fertigen Ausweise (`gateway_live_20260727.py:695` `["pwd","mfa-pending"]`,
Zeile 711 `["pwd","mfa-setup"]`) und weist sie danach selbst überall zurück
(`auth_user_terms:517-522`, `auth_enroll:538-543`). Der Relay nahm sie an — damit
öffnete das halbe Login eine volle Steuersitzung, und der zweite Faktor war für
den gefährlichsten Weg ins System der einzige, den man überspringen konnte.

**Warum hier ausnahmsweise eine Negativliste steht:** `amr` zählt
**abgeschlossene** Faktoren auf, und das halbe Token trägt den bereits
abgeschlossenen ersten Faktor (`pwd`) mit. Eine Positivliste über Faktoren
könnte `["pwd"]` und `["pwd","mfa-pending"]` deshalb gar nicht unterscheiden —
die Marke ist das einzige unterscheidende Merkmal. Es ist dieselbe Marke, auf die
der Gateway prüft; damit bleiben beide Seiten von selbst synchron, und ein
künftiger Anmeldeweg (`passkey`, `google`, `apple`, …) sperrt niemanden aus.

**Folge:** Kommt im Gateway je ein dritter Zwischenzustand dazu, gehört er in
dieselbe Liste. `test_connect.py` liest den Gateway-Quelltext und schlägt an,
wenn dort eine `mfa-`Marke auftaucht, die der Relay nicht kennt.

---

### E15 — Sitzungsfreigabe: Die Lesestufe wird sofort bewilligt

**Festlegung:** Ein Antrag mit `requested.access: "read"` und gesetztem
`tab_host` wird von `POST /request` **sofort** bewilligt, wenn der Ausweis
vollständig ist (E14) und die Erweiterung auf der Positivliste steht. Die
Antwort trägt `state: "approved"`, den gedeckelten `granted`-Block und den
`redeem_key` — **kein** `verify_word`, **keine** `confirm_url`. Der Server
deckelt selbst und unverhandelbar: `access: "read"`, `duration` höchstens
600 s, `mode: "tab"`, `allow: [tab_host]`, `step_mode: "confirm_each"`.
Alles oberhalb von read geht unverändert den manuellen Weg über die
Freigabeseite (§3.3, §7.1, E8, E9).

**Warum:** Entscheid des Inhabers vom 28.07.2026, bewusst und nach
Sicherheitshinweis getroffen: Der Weg über Kennwort-Abtippen plus
Kontopasswort war schon für den Gründer nicht ohne Anleitung zu schaffen —
für Kunden wäre er eine Ausschluss-Hürde. Eine Schutztür, durch die niemand
mehr geht, schützt niemanden.

**Was den Weg trotzdem trägt (die verbleibenden Schichten):**
1. Der Ausweis muss **vollständig** sein — `mfa-pending`/`mfa-setup` bekommen
   nichts (E14), AGB-Sperre und Kontingent laufen über dieselben Prüfer wie
   zuvor, fail-closed.
2. Die Positivliste `LINK_EXT_IDS` (§3.1) und die Ratenbremse (§10) gelten
   unverändert; Sitzungsfreigaben zählen zu den offenen Vorgängen.
3. Der Serverdeckel ersetzt E8: Wo kein Mensch mehr entscheidet, bekommt der
   Antragsteller nicht seinen Wunsch, sondern das Minimum — lesen, kurz, nur
   der Tab, jeder Schritt einzeln.
4. Das Ticket kommt weiter nur aus `POST /redeem` mit `redeem_key` und
   Erweiterungs-Herkunft (E10, §7.2) — die einzige, jetzt wichtigste Bindung
   an die antragstellende Erweiterung.
5. Die Einzelbefehl-Freigaben der Erweiterung (jeder Schritt wird angesagt
   und bestätigt, §5.5) und die Notbremsen bleiben unangetastet. Sie sind die
   eigentliche Schutztür: Die Verbindung allein kann nichts anfassen.

**Was bewusst aufgegeben wird:** Für die Lesestufe gibt es keine
Herkunftsbindung der Bewilligung (§7.1 hat keinen Gegenstand mehr, es gibt
keine Bewilligung als eigenen Schritt), kein Kennwort und keinen zweiten
Nachweis. Wer den vollständigen Alltags-Ausweis eines Nutzers besitzt, kann
eine Lesesitzung eröffnen, deren Befehle der Nutzer dann einzeln sieht.

**Folge:** `GET /request/{rid}` meldet `reauth_required` nur noch bei
`state: "pending"`. Eine `POST /confirm` auf einen sitzungsbewilligten
Vorgang antwortet `409 antrag_bereits_entschieden` und erzeugt nie ein
zweites Ticket.

---

### E16 — Die Sitzungsfreigabe gilt für beide Stufen und die Wunschdauer

**Festlegung:** E15 wird erweitert. Nicht mehr die *Stufe* entscheidet, ob ein
Antrag sofort bewilligt wird, sondern der *Geltungsbereich*: Ein Antrag mit
`mode: "tab"` und gesetztem `tab_host` wird sofort bewilligt — für `read`
**und** für `write`. Die gewünschte `duration` wird gewährt, gedeckelt auf
`MAX_DURATION` (3600 s) statt auf `STANDARD_DURATION` (600 s). Unverändert
unverhandelbar bleiben: `mode: "tab"`, `allow: [tab_host]`,
`step_mode: "confirm_each"`. `full` bleibt für `smartrchrome` gesperrt (E13).
Ein Antrag mit `mode: "domains"` oder ohne `tab_host` geht weiter den
manuellen Weg über die Freigabeseite.

**Warum:** Entscheid des Inhabers vom 29.07.2026. Die Lesestufe allein macht
die Erweiterung zu einem Vorleser, nicht zu einem Bediener — und eine
Zehn-Minuten-Sitzung reicht für keinen echten Auftrag. Der Schutz sitzt nicht
in der Stufe, sondern in der **Einzelfreigabe je Befehl**: Der Agent kann auch
auf `write` keinen Schritt tun, den der Mensch nicht vorgelesen bekommen und
einzeln bestätigt hat.

**Was den Weg trägt:** dieselben fünf Schichten wie in E15 — vollständiger
Ausweis (E14), Positivliste `LINK_EXT_IDS`, Ratenbremse, `redeem_key`-Bindung
(E10), Einzelbefehl-Freigaben und Notbremsen. Dazu kommt: Die Erweiterung
beherrscht auf `write` genau zwei zusätzliche Befehle (`click`, `type`), und
`type` verweigert jedes Geheimfeld (Passwort, Karte, Einmalcode) — Anmelden
bleibt beim Menschen.

**„Unbegrenzt" ist keine Sitzung ohne Ende.** Der Antrag trägt immer eine
endliche Dauer. Was der Dialog „Unbegrenzt" nennt, ist die Zusage der
Erweiterung, vor Ablauf einen **vollständigen neuen Freigabeweg** zu gehen
(Antrag → Ticket → neue Leitung) und die alte Leitung erst danach zu
schließen. Ein stilles Wiederverbinden nach dem Tod des Service Workers gibt
es weiterhin nicht.

---

### E17 — Die Sitzung wird an einen Agentenauftrag gebunden

**Festlegung:** `POST /api/v1/link/session/bind` mit `{code, context_id?,
step_mode?}` und dem Alltags-Ausweis in der `Authorization`-Kopfzeile.
Der Gateway (1) bestätigt die Sitzung beim Relay über
`GET /api/v1/browser/status/{code}` — **mit dem Ausweis des Aufrufers**, damit
der Relay selbst prüft, wem der Code gehört; (2) signiert ein Bridge-Token
(§4 werkzeuge.md: `aud: smartr-connect`, `scope: smartrlink-bridge`, `code`,
`exp` = Sitzungsende); (3) legt über `session_set` im Kundencontainer einen
Auftragskontext mit dem Profil `smartr-browser` an und hinterlegt dort den
Sitzungsschein; (4) trägt den Kontext in `chat_contexts` ein. Antwort:
`{success, context_id, code, access, expires_at_epoch}`. Ein erneuter Aufruf
**mit** `context_id` bindet denselben Auftrag an eine neue Sitzung — das ist
der Weg der Verlängerung aus E16.

**Warum:** Ohne diesen Schritt war „verbunden" eine Anzeige ohne Wirkung. Der
Sitzungsschein erreichte nie einen Agenten, und der Sitzungscode musste von
Hand in den Chat getippt werden (Runbook 28.07., „bewusst noch nicht gebaut").

**Der Bridge-Ausweis am Relay:** `token_lesen` liest `scope:
smartrlink-bridge` als Nutzer-Ausweis (`ist_ticket = False`) und verlangt
einen nichtleeren `code`-Anspruch; `rest_caller` weist jeden Rumpf ab, dessen
`code` nicht dem gebundenen entspricht. Damit gilt: Ein Bridge-Token
**befehligt** genau eine Sitzung und kann **keine eröffnen**. Der interne
Dienstschlüssel `CONNECT_INTERNAL_KEY` kommt dabei nie in einen
Kundencontainer (Auflage aus `Cloud/TASK-SMarTrITGott-SMarTrLink-Bridge.md`).

> ⚠️ **Der Satz „kann keine eröffnen" war zunächst eine Behauptung ohne
> Prüfung — siehe E18, Abschnitt „Die Korrektur an E17".** Er stimmt erst,
> seit die Altschiene nur noch zweckfreie Ausweise annimmt.

---

### E18 — Ein Wortschatz für alle vier Schichten

**Der Anlass:** Die Gegenprobe vom 29.07.2026 hat gemessen, was von einem
Befehl der Agentenseite wirklich beim Browser ankommt. Ergebnis: Von
`{"cmd":"click","ref":"e12","snapshotEpoch":"s3.ab"}` überlebten `cmd`, `id`
und `reason`. Alles andere fiel an der Feldpositivliste des Relays
(`BEFEHLSFELDER`) heraus, weil die vollständig aus der Desktop-Welt stammte
(`selector`, `dx`, `dy`, `js`, `path`, `command`) und für das referenzbasierte
Modell der Erweiterung nie nachgezogen worden war.

Die Folge war nicht ein fehlendes Feature, sondern ein **stiller Fehlschlag**:
Die Erweiterung schlug eine leere Referenz nach und antwortete „Diese Referenz
gehört zu einer älteren Wahrnehmung" — eine Begründung, die auf eine veraltete
Seitensicht zeigte statt auf die Wahrheit. Bei `scroll` war es schlimmer: Dort
fielen `direction` und `amount` weg, die Erweiterung nahm ihre Voreinstellung
„nach unten" und meldete **Erfolg**. Ein Befehl, der etwas anderes tut als
verlangt und das nicht sagt, ist schlimmer als einer, der scheitert.

**Festlegung 1 — die Befehlsliste ist auf allen vier Schichten dieselbe.**
Schichten sind: Werkzeugtabelle der Agentenseite, `REQUIRED` im Relay,
`BEFEHLE` der Erweiterung, `AUSFUEHRUNG` der Erweiterung.

| Stufe | Befehle |
|---|---|
| `read` | `readPage`, `snapshot` (Alias), `get_state`, `scroll`, `highlight`, `extract`, `waitFor`, `screenshot`, `navigate`, `back` |
| `write` | `click`, `type`, `select` |

`full` bleibt für `smartrchrome` gesperrt (E13). Ein Name, der in `REQUIRED`
fehlt, gilt als `full` und wird garantiert abgewiesen — ein fehlender Eintrag
ist deshalb kein Loch in einer Tabelle, sondern ein toter Befehl, für den der
Agent dem Menschen fälschlich fehlende Rechte meldet.

**Ersatzlos gestrichen**, überall mit derselben Begründung:

* `newTab` / `closeTab` — Eine Sitzung kennt genau einen Tab und genau einen
  Host (`allow = [tab_host]`). Ein zweiter Tab wäre ein Ziel, das nie jemand
  freigegeben hat.
* `propose` — Die Erweiterung erfragt **jeden** Schritt selbst beim Menschen.
  Eine zweite Rückfrage davor ist eine zu viel: Wer zweimal gefragt wird,
  liest beim zweiten Mal nicht mehr mit. (Der Weg war ohnehin tot: Der Relay
  kannte `propose` nicht und wies ihn als Vollzugriff ab.)

**Festlegung 2 — der Wortschatz auf der Leitung.** `BEFEHLSFELDER` führt
zusätzlich zum Bestand: `ref`, `refs`, `region`, `fields`, `snapshotEpoch`,
`direction`, `amount`, `container`, `clear`, `submit`, `value`, `index`,
`includeOffscreen`, `area`, `screenshotReason`, `waitSeconds`, `textPresent`,
`refGone`, `refVisible`, `urlMatches`, `idle`.

Das erweitert die Angriffsfläche nicht: Jedes dieser Felder wird in der
Erweiterung gegen eine geschlossene Menge geprüft, und `url`/`target` bleiben
die einzigen Felder, die der Relay auf Schema und Bereich prüft (`ZIELFELDER`).

**Bewusst draußen**, damit die Entscheidung nicht später als Versehen gelesen
wird:

* `at`, `button`, `modifiers` — Unser Modell ist referenzbasiert. Ein Klick auf
  Bildschirmkoordinaten lässt sich dem Menschen in der Freigabefrage nicht
  beschreiben; was er nicht beschreiben kann, kann er nicht freigeben.
* `tabId`, `active` — siehe `newTab`/`closeTab`.
* `mode` — heißt in der Sitzung `tab|domains`. Ein Wort mit zwei Bedeutungen
  ist der Fehler, den dieses Projekt schon einmal bezahlt hat.

**Festlegung 3 — keine stillen Vorgaben.** Ein Parameter, der die *Richtung*
einer Handlung bestimmt, darf nie zur Voreinstellung werden, wenn er fehlt.
`scroll` ohne `direction` ist eine benannte Absage, kein Bildlauf nach unten.

**Die Korrektur an E17.** E17 sagte zu, ein Bridge-Ausweis könne keine Sitzung
eröffnen. Das stimmte nicht: Er trägt `ist_ticket = False` und fiel damit auf
der **Altschiene** (`?token=`) durch dieselbe Tür wie ein Alltags-Ausweis — und
dort nennt der `auth`-Rahmen Stufe und Dauer selbst. Ein Token, das nur Befehle
an *eine* laufende Sitzung schicken durfte, eröffnete so eine neue mit `full`,
acht Stunden, ohne Bereichsgrenze und ohne Leerlaufkappung.

Die Regel steht jetzt als **Positivliste** und nicht als Ausnahme für einen
Namen: Auf der Altschiene wird ausschließlich der nackte Alltags-Ausweis
angenommen — ein Token **ohne** `scope`. Der Alltags-Ausweis des Gateways führt
keinen (`make_jwt`); jeder künftige Zweck-Ausweis ist damit von selbst
ausgeschlossen, ohne dass jemand daran denken muss. Dieselbe Prüfung gilt für
das Feld `ausweis` im `auth`-Rahmen der Ticketschiene.

**Festlegung 4 — die Tabellen dürfen nicht mehr auseinanderlaufen.**
`test_connect.py` liest die Werkzeugtabelle der Agentenseite und hält sie gegen
`REQUIRED` und `BEFEHLSFELDER`. Ein Befehl, den das Werkzeug anbietet und der
Relay abweisen würde, lässt die Prüfung scheitern — und zwar mit dem Namen des
Befehls im Klartext. Zweimal ist dieses Projekt an auseinandergelaufenen
Tabellen gescheitert; das Nachziehen von Hand ist damit keine Regel mehr,
sondern eine Prüfung.

**Festlegung 5 — die Sitzungsauskunft nennt ihre Herkunft.**
`GET /api/v1/browser/status/{code}` liefert zusätzlich `step_mode` und
`schiene` (`"ticket"` oder `"alt"`). Der Grund ist derselbe wie überall in
diesem Dokument: Auf der **Altschiene** nennt der Client Stufe und Dauer im
`auth`-Rahmen selbst und darf bis `full` und acht Stunden gehen. Wer diese
Auskunft für eine Ticketsitzung hält und ihre Werte weiterreicht — etwa in
einen Sitzungsschein nach E17 — umgeht damit den Clientdeckel
`smartrchrome: write`. Die Schiene zu kennen ist billiger, als ihre Folgen
einzeln zu klemmen. `step_mode` fehlte ebenfalls, obwohl die Sitzung das Feld
führt; ohne es fiel E17 fail-closed auf `confirm_each` zurück, und der erteilte
Schrittmodus erreichte den Agenten nie.

**Was daran zu lernen war:** Die End-zu-Ende-Probe vom 29.07. war grün,
während jeder Klick des Agenten scheiterte. Sie bestätigte, dass ein Befehl
*ankommt*, und sah nie nach, ob sein *Ziel* mitkommt — die Attrappe las den
Rahmen nicht. Eine Probe, die den Rahmeninhalt nicht prüft, beweist nichts.

Dieselbe Lehre ein zweites Mal, eine Schicht höher: Eine Prüfung, die im
Quelltext nach einer Zeichenkette sucht, belegt keine Eigenschaft. Die
Gegenlesung hat fünf naheliegende Verschlechterungen an der Seitenleiste
vorgenommen — einen Aufruf hinter ein `await` geschoben, eine Konstante
verdreht, einen Zweig auf `false` gesetzt — und alle Prüfungen blieben grün.
Rot wurde nur der glatte Komplettrückbau. Prüfsätze werden deshalb ab hier
gegen die **naheliegende halbe** Verschlechterung gemessen, nicht gegen das
Löschen.

---

## 2. Namensverzeichnis

Ein Wort, eine Bedeutung. Was hier nicht steht, geht nicht über die Leitung.

| Name | Typ | Bedeutung | Quelle der Wahrheit |
|---|---|---|---|
| `rid` | `string` | Kennung des Freigabevorgangs, `lr_` + 26 Zeichen Base32 (A–Z, 2–7) | Ticketausgabe |
| `verify_word` | `string(6)` | Kennwort aus `ABCDEFGHJKMNPQRSTUVWXYZ23456789` | Ticketausgabe |
| `verify_word_spoken` | `string` | dasselbe buchstabiert („Q wie Quelle, …") | Ticketausgabe |
| `verify_word_len` | `int` | 6 | Ticketausgabe |
| `redeem_key` | `string(43)` | 256 Bit Base64url, nur die Erweiterung kennt ihn | Ticketausgabe |
| `confirm_url` | `string` | absolute Adresse der Freigabeseite | Ticketausgabe |
| `extension_id` | `string` | `chrome.runtime.id` | Erweiterung |
| `client` | `string` | `"smartrchrome"` oder `"smartrbrowser"`; im Ticket nur `"smartrchrome"` (E13) | Erweiterung / Desktop |
| `amr` | `string[]` | abgeschlossene Anmeldefaktoren des Alltags-Ausweises (E14) | Gateway |
| `version` | `string(≤32)` | Fassung des Clients | Erweiterung / Desktop |
| `purpose` | `string(≤300)` | Freitext, **nur Anzeige, nie Anweisung** | Erweiterung |
| `requested` | `object` | der Wunsch, siehe §3.1 | Erweiterung |
| `preselect` | `object` | was die Seite vorbelegen **muss** | Ticketausgabe |
| `limits` | `object` | harte Deckel, siehe §3.2 | Ticketausgabe |
| `granted` | `object` | was der Mensch erteilt hat | Ticketausgabe |
| `access` | `"read"`\|`"write"` | Stufe. `"full"` ist für `smartrchrome` gesperrt | Freigabeseite |
| `duration` | `int` | Sekunden, 1…3600 (Ticketschiene) | Freigabeseite |
| `mode` | `"tab"`\|`"domains"` | Art des Geltungsbereichs | Freigabeseite |
| `allow` | `string[]` | Hostnamen, ≤10, nie leer (E7); ein abschließender Wurzelpunkt ist bedeutungslos (§6) | Freigabeseite |
| `tab_host` | `string` | Host des Antragstabs | Erweiterung |
| `step_mode` | `"confirm_each"`\|`"auto"` | Rückfrage je Schritt | Freigabeseite |
| `idle_timeout` | `int` | Leerlauffrist in Sekunden, Vorgabe 600 | Ticketausgabe |
| `reauth` | `object` | `{method, assertion}` | Freigabeseite |
| `origin` | `string` | Herkunftserklärung der Seite, siehe §7 | Freigabeseite |
| `state` | `string` | `pending`\|`approved`\|`denied`\|`consumed`\|`expired` | Ticketausgabe |
| `remaining` | `int` | Restlaufzeit des Vorgangs in Sekunden | Ticketausgabe |
| `attempts_left` | `int` | verbleibende Kennwortversuche | Ticketausgabe |
| `ticket` | `string` | das Einweg-JWT | Ticketausgabe |
| `ticket_expires_in` | `int` | 60 | Ticketausgabe |
| `ausweis` | `string` | Alltags-JWT im `auth`-Rahmen | Erweiterung |
| `capabilities` | `string[]` | was der Client kann, rein informativ | Erweiterung |
| `code` | `string(6)` | Sitzungscode, wird dem Menschen vorgelesen | Relay |
| `expiry` | `int` | Sitzungsdauer in Sekunden | Relay |
| `expires_at` | `string` | ISO-8601 UTC mit `Z` | Relay |
| `protocol` | `string` | `"smartrlink.v2"` | Relay |
| `success` | `bool` | Ergebnis eines Befehls / einer HTTP-Antwort | beide |
| `error` | `string` | Maschinenkennung des Fehlers | beide |
| `hinweis` | `string` | ein Satz für den Menschen, wird vorgelesen | beide |

**Verboten** (nicht senden, nicht lesen, nicht als Ausweichname dulden):
`erbeten`, `entwurf`, `kennwort`, `phrase`, `zweck`, `ansage`, `vorbelegung`,
`grenzen`, `kennwort_laenge`, `verbleibende_versuche`, `scope` als Adressliste
oder Objekt, `domains`, `sites`, `scp`, `acc`, `dur`, `idl`, `stp`, `cl`,
`origin_hint`, `scope_mode`, `reauth.password`, `state: "confirmed"`,
`ext_id` (im HTTP-Rumpf; im JWT heißt der Anspruch `ext`).

---

## 3. Der Freigabeweg (HTTP)

Alle vier Endpunkte liegen unter `/api/v1/link/`. Alle verlangen
`Authorization: Bearer <Alltags-Ausweis>`. Alle Fehler haben die Form

```json
{ "success": false, "error": "<kennung>", "hinweis": "<Satz für den Menschen>" }
```

`hinweis` kann fehlen; `error` nie.

### 3.1 `POST /api/v1/link/request` — Antrag stellen

Ruft **nur** die Erweiterung, gegen `https://api.smartragents.ai`.

Kopfzeilen: `Authorization`, `Content-Type: application/json`.
Vom Browser gesetzt: `Origin: chrome-extension://<extension_id>`.

Rumpf:

```json
{
  "client": "smartrchrome",
  "version": "0.1.0",
  "extension_id": "abcdefghijklmnopabcdefghijklmnop",
  "purpose": "Preise auf geizhals.de vergleichen",
  "requested": {
    "access": "read",
    "duration": 600,
    "mode": "domains",
    "allow": ["geizhals.de", "www.geizhals.de"],
    "tab_host": "geizhals.de",
    "step_mode": "confirm_each"
  }
}
```

Regeln:

* `client` muss `"smartrchrome"` sein, sonst `403 client_unbekannt`.
* `extension_id` muss in `LINK_EXT_IDS` stehen, sonst `403 extension_unknown`.
  Ist `LINK_EXT_IDS` leer, wird **jeder** Antrag abgelehnt — ohne Zulassungsliste
  werden keine Tickets ausgestellt.
* `requested.allow` höchstens 10 Einträge, jeder ein Hostname (kein Schema, kein
  Pfad, kein Doppelpunkt), Platzhalter nur als `*.` vor einer registrierbaren
  Domain. `*.de`, `*.co.uk` → `400 bereich_zu_weit`.
* `mode: "tab"` ohne `tab_host` → `400 tab_host_fehlt` (E7).
* `mode: "domains"` mit leerem `allow` → `400 bereich_leer`.
* `access: "full"` → `403 stufe_fuer_client_gesperrt`.
* `duration` außerhalb 1…3600 → `400 dauer_ausserhalb_deckel`.
* Höchstens 3 offene Vorgänge je Nutzer, höchstens 10 Anträge je 10 Minuten,
  sonst `429 too_many_requests`.

Antwort `201` — **Lesestufe mit `tab_host` (E15, Sitzungsfreigabe):**

```json
{
  "rid": "lr_VTFJZF742VZOZ46RTFWW6ZOKIU",
  "state": "approved",
  "granted": {
    "access": "read", "duration": 600, "mode": "tab",
    "allow": ["geizhals.de"], "step_mode": "confirm_each", "idle_timeout": 600
  },
  "redeem_key": "pX6OlD5masRPfnc531nc9PbU8fm-SG4uzX0Osk2CbYw",
  "expires_in": 120
}
```

Die Erweiterung ruft dann direkt `POST /redeem` — es gibt nichts anzuzeigen
und nichts abzutippen.

Antwort `201` — **alles oberhalb von read (manueller Weg):**

```json
{
  "rid": "lr_VTFJZF742VZOZ46RTFWW6ZOKIU",
  "state": "pending",
  "verify_word": "QMRT4X",
  "verify_word_spoken": "Q wie Quelle, M wie Martha, R wie Richard, T wie Theodor, vier, X wie Xanthippe",
  "confirm_url": "https://cloud.smartragents.ai/link/confirm?rid=lr_VTFJZF742VZOZ46RTFWW6ZOKIU",
  "redeem_key": "pX6OlD5masRPfnc531nc9PbU8fm-SG4uzX0Osk2CbYw",
  "expires_in": 120
}
```

`redeem_key` wird **nur hier** ausgeliefert. Die Ticketausgabe speichert nur
seinen SHA-256-Abdruck. Die Erweiterung hält ihn im Modulspeicher, nie in
`chrome.storage.local`.

`confirm_url` zeigt immer auf `https://cloud.smartragents.ai`. Die Erweiterung
öffnet die Adresse nur, wenn sie mit genau diesem Ursprung beginnt; sonst baut
sie sich selbst `https://cloud.smartragents.ai/link/confirm?rid=…`.

### 3.2 `GET /api/v1/link/request/{rid}` — Vorgang anzeigen

Ruft **nur** die Freigabeseite, relativ zum eigenen Ursprung. Verbraucht nichts,
liefert nie `verify_word`, nie `redeem_key`, nie `ticket`. Darf wiederholt
gerufen werden.

Antwort `200`:

```json
{
  "rid": "lr_VTFJZF742VZOZ46RTFWW6ZOKIU",
  "state": "pending",
  "client": "smartrchrome",
  "version": "0.1.0",
  "extension_id": "abcdefghijklmnopabcdefghijklmnop",
  "purpose": "Preise auf geizhals.de vergleichen",
  "requested": {
    "access": "read", "duration": 600, "mode": "domains",
    "allow": ["geizhals.de", "www.geizhals.de"],
    "tab_host": "geizhals.de", "step_mode": "confirm_each"
  },
  "preselect": {
    "access": "read", "duration": 600, "mode": "tab",
    "allow": [], "step_mode": "confirm_each"
  },
  "limits": {
    "access": ["read", "write"],
    "min_duration": 1, "max_duration": 3600,
    "max_allow": 10, "auto_enabled": false, "idle_timeout": 600
  },
  "verify_word_len": 6,
  "attempts_left": 3,
  "reauth_required": true,
  "remaining": 96
}
```

`reauth_required` ist `true` nur bei `state: "pending"` — ein
sitzungsbewilligter Vorgang (E15) ist bereits entschieden, die Seite darf
dann kein Passwortfeld anbieten.

Fehler: `404 antrag_unbekannt` (auch bei fremdem Vorgang — die Antwort darf nicht
verraten, dass es ihn gibt), `410 antrag_abgelaufen`.

### 3.3 `POST /api/v1/link/confirm` — freigeben oder ablehnen

Ruft **nur** die Freigabeseite. Herkunftsbindung nach §7.

Rumpf beim Freigeben:

```json
{
  "rid": "lr_VTFJZF742VZOZ46RTFWW6ZOKIU",
  "confirm": true,
  "origin": "https://cloud.smartragents.ai",
  "verify_word": "QMRT4X",
  "access": "read",
  "duration": 600,
  "mode": "tab",
  "allow": ["geizhals.de"],
  "step_mode": "confirm_each",
  "reauth": { "method": "password", "assertion": "<Kontopasswort>" }
}
```

Rumpf beim Ablehnen — ohne Kennwort, ohne `reauth`, immer möglich:

```json
{ "rid": "…", "confirm": false, "origin": "https://cloud.smartragents.ai", "reason": "user_cancelled" }
```

Prüfreihenfolge in der Ticketausgabe (jede Stufe bricht ab):

1. Herkunft (§7) → sonst `403 herkunft_ungueltig`, Vorgang wird auf `denied` gesetzt.
2. Identität und Eigentum am Vorgang → `404 antrag_unbekannt`.
3. Zustand `pending` → sonst `409 antrag_bereits_entschieden` / `410 antrag_abgelaufen`.
4. `confirm: false` → sofort `denied`, fertig.
5. Erratensperre (10 Fehlversuche je Nutzer / 10 Min) → `429 too_many_requests`.
6. `verify_word` (Groß/Klein egal, Leerzeichen und Bindestriche werden entfernt)
   → `403 kennwort_falsch`; nach 3 Fehlversuchen ist der Vorgang verbrannt.
7. Fehlende Felder aus `preselect` ergänzen (E8), dann prüfen:
   `access`/`duration`/`step_mode` gegen `limits`,
   `allow` ⊆ `requested.allow` ∪ {`tab_host`, `*.tab_host`} → sonst
   `403 bereich_erweitert`.
8. `reauth` (immer) → sonst `403 reauth_erforderlich`. Ohne eingehängten Prüfer
   gibt es keine Freigabe.
9. Bei `mode: "tab"`: `allow` wird auf `[tab_host]` gesetzt (E7).
10. Ticket bauen, Vorgang atomar von `pending` auf `approved` schreiben.

Antwort `200`:

```json
{
  "rid": "…",
  "state": "approved",
  "granted": {
    "access": "read", "duration": 600, "mode": "tab",
    "allow": ["geizhals.de"], "step_mode": "confirm_each", "idle_timeout": 600
  },
  "ticket_expires_in": 60,
  "hinweis": "Die Erweiterung holt den Schein jetzt ab. Du kannst dieses Fenster schließen."
}
```

Das Ticket selbst steht **nicht** in dieser Antwort. Es darf nie in den Tab
gelangen, weil dort jedes Skript des Ursprungs mitlesen könnte.

### 3.4 `POST /api/v1/link/redeem` — Ticket abholen, genau einmal

Ruft **nur** die Erweiterung, gegen `https://api.smartragents.ai`.
Herkunftsbindung nach §7.

Rumpf: `{ "rid": "…", "redeem_key": "…" }`

Antworten:

| Lage | Status | Rumpf |
|---|---|---|
| noch offen | 200 | `{"rid":"…","state":"pending","remaining":72}` |
| abgelehnt | 200 | `{"rid":"…","state":"denied","reason":"nutzer_abgelehnt"}` |
| freigegeben | 200 | `{"rid":"…","state":"approved","ticket":"eyJ…","ticket_expires_in":60,"granted":{…}}` |
| schon abgeholt | 410 | `{"success":false,"error":"ticket_bereits_abgeholt"}` |
| abgelaufen | 410 | `{"success":false,"error":"antrag_abgelaufen"}` |
| falsche Herkunft/Schlüssel | 403 | `{"success":false,"error":"herkunft_ungueltig"}` |

Das Verbrennen und das Ausliefern sind **eine** Schreiboperation: nur wer die
Zeile von `approved` wegbewegt, bekommt das Ticket.

`granted` aus dieser Antwort dient **ausschließlich der Anzeige**. Was die
Erweiterung tun darf, steht in `auth_ok` (§5.3) — nirgends sonst.

**Abfragetakt:** alle 2 Sekunden, höchstens 75 Versuche, Abbruch spätestens bei
`expires_in` aus §3.1. Der Vorgang lebt 120 Sekunden.

---

## 4. Das Einweg-Ticket

HS256, signiert mit demselben `JWT_SECRET` wie Gateway und Relay.

```json
{
  "iss": "smartr-gateway",
  "aud": "smartr-connect",
  "sub": "42",
  "scope": "smartrlink-ticket",
  "jti": "tk_S5YBZXGHLKE2NH7MJCPI76EXGU",
  "iat": 1785283200,
  "exp": 1785283260,
  "rid": "lr_VTFJZF742VZOZ46RTFWW6ZOKIU",
  "tnt": "tenant-7",
  "ext": "abcdefghijklmnopabcdefghijklmnop",
  "client": "smartrchrome",
  "access": "read",
  "duration": 600,
  "idle_timeout": 600,
  "step_mode": "confirm_each",
  "mode": "tab",
  "allow": ["geizhals.de"]
}
```

* `exp = iat + 60`. Länger lebt kein Ticket.
* Kurznamen (`acc`, `dur`, `idl`, `stp`, `scp`, `cl`) gibt es nicht mehr (E0).
* Pflichtansprüche: `sub`, `aud`, `scope`, `jti`, `exp`, `client`, `access`,
  `duration`, `idle_timeout`, `mode`, `allow`. Fehlt einer → `4400`.
* Der Relay nimmt Stufe, Dauer, Leerlauffrist, Modus und Adressen
  **ausschließlich** von hier. Der `auth`-Rahmen darf sie nicht behaupten.
* `client` wird vor dem Nachschlagen kleingeschrieben und muss auf der
  Positivliste stehen (E13), sonst `4400 client_unbekannt`.

## 4.2 Der Alltags-Ausweis

Der Ausweis, den der Gateway nach abgeschlossener Anmeldung ausstellt. Er ist
gültig für den Relay, wenn **alle** vier Punkte zutreffen:

1. HS256 mit dem gemeinsamen `JWT_SECRET`, Signatur gültig.
2. **Kein** `aud` — ein Token mit fremder Zielgruppe ist hier keines, ein Token
   mit `aud: smartr-connect` ist ein Ticket und kein Ausweis.
3. `exp` vorhanden und nicht abgelaufen. Der Gateway setzt `exp` immer
   (`make_jwt`, `gateway_live_20260727.py:483-486`); ein Token ohne Ablauf kann
   nur handgebaut sein.
4. `amr` enthält **keine** der Marken `mfa-pending`, `mfa-setup` (E14).

Wo er auftritt: `?token=` der Altschiene (§5.2), `ausweis` im `auth`-Rahmen der
Ticketschiene (§5.1 Schritt 7), `Authorization: Bearer` an allen HTTP-Endpunkten
(§3, §6). Die vier Punkte gelten an **jeder** dieser Stellen gleich — eine
Prüfung, die an einer Stelle fehlt, ist die Stelle, die benutzt wird.

---

## 5. Der WebSocket-Handschlag

Adresse: `wss://connect.smartragents.ai/ws/browser`

### 5.1 Schritt für Schritt — Ticketschiene (SMarTrChrome)

1. **Die Erweiterung öffnet die Verbindung** und bietet genau zwei
   Unterprotokolle an, in dieser Reihenfolge:
   `["smartrlink.v2", "<TICKET-JWT>"]`.
   Kein `?token=` in der Adresse — beides zusammen ist `4400 protocol_error`.
   Der Relay setzt „genau zwei, in dieser Reihenfolge" **durch**: eine Liste mit
   einem, drei oder mehr Elementen ist `4400 protocol_error`, ebenso eine, deren
   erstes Element nicht `smartrlink.v2` ist. (Verschärfung 27.07.: Vorher genügte
   „`smartrlink.v2` steht irgendwo, das letzte Element ist das Ticket" — welches
   Element der Ausweis ist, hing damit an der Reihenfolge des Clients, und ein
   drittes Element blieb ungeprüft stehen.)
2. **Der Relay liest das Token** als zweites Element der Unterprotokollliste.
3. **Der Relay prüft die Signatur** und erkennt an `aud = smartr-connect` die
   Ticketschiene. Falsches `aud`, falsches `scope`, abgelaufen, fehlendes `jti`
   → `4401 unauthorized`. Ein Token ohne `aud` im Unterprotokoll →
   `4400 token_im_unterprotokoll`.
4. **Der Relay verbrennt das `jti`** — vor dem ersten Rahmen, damit der
   Wiedereinlöseschutz nicht davon abhängt, dass der Client den Handschlag zu
   Ende führt. Zweite Einlösung → `4401 ticket_replayed`. Die Verbrauchsliste
   hält 900 Sekunden.
5. **Der Relay bestätigt den Handschlag** und echot als Unterprotokoll genau
   `smartrlink.v2` — nie das Ticket. Ohne Echo bricht der Browser ab.
6. **Die Erweiterung sendet innerhalb von 20 Sekunden den `auth`-Rahmen:**

   ```json
   {
     "type": "auth",
     "client": "smartrchrome",
     "version": "0.1.0",
     "ausweis": "<Alltags-JWT>",
     "capabilities": ["event_v1"]
   }
   ```

   `access`, `duration`, `mode`, `allow`, `step_mode` sind hier **verboten**.
   Stehen sie drin → `4400 protocol_error`. Kein Rahmen oder kein `type: "auth"`
   innerhalb von 20 s → `4400 protocol_error`.
7. **Der Relay prüft den Ausweis** nach §4.2 (Signatur, kein `aud`, `exp`, `amr`
   ohne `mfa-pending`/`mfa-setup`) und verlangt `ausweis.sub == ticket.sub`.
   Fehlt er → `4401 ausweis_fehlt`. Anderer Nutzer → `4401 ausweis_fremd`.
   Halbe Anmeldung → `4401 unauthorized` (E14).
8. **Der Relay setzt die Sitzung aus dem Ticket auf:** Stufe, Dauer (gedeckelt
   auf 3600 s), Leerlauffrist, Modus, Adressliste, Schrittmodus. Unbekannter oder
   fehlender `client` → `4400 client_unbekannt` (E13). `duration = 0`
   → `4400 duration_zero_forbidden`. `allow` leer → `4400 allow_leer`.
   Stufe über dem Deckel des Clients → `4400 access_level_forbidden`.
9. **Der Relay vergibt den sechsstelligen `code`** und antwortet mit `auth_ok`
   (§5.3).
10. **Die Erweiterung prüft `auth_ok`:** Ohne verwertbares Ende
    (`expires_at` in der Vergangenheit oder `expiry <= 0`) legt sie auf. Eine
    Steuersitzung ohne klares Ende nimmt sie nicht an.

### 5.2 Schritt für Schritt — Altschiene (Desktop-SMarTrBrowser, unverändert)

1. Der Client öffnet `wss://…/ws/browser?token=<Alltags-JWT>` und bietet
   **kein** Unterprotokoll an.
2. Der Relay erkennt an fehlendem `aud`, dass es die Altschiene ist. Ein Ticket
   in `?token=` → `4400 ticket_im_query`.
3. Der Relay akzeptiert ohne Unterprotokoll-Echo.
4. Der Client sendet:

   ```json
   { "type": "auth", "client": "smartrbrowser", "version": "…",
     "access": "read", "duration": 0 }
   ```
5. Stufe und Dauer kommen hier aus dem Rahmen. `duration <= 0` oder
   `> 28800` ergibt **28800** (8 Stunden) — nicht „ewig", aber auch kein Fehler.
   Das ist die einzige Stelle, an der ein Client seine eigene Befugnis behauptet;
   sie bleibt bestehen, weil der Desktop-Client sie so sendet.
6. `ausweis` wird hier nicht verlangt und nicht gelesen.
7. `idle_limit = 0` — keine Leerlaufkappung (E11).
8. `auth_ok` in der kurzen Form (§5.3).

### 5.3 `auth_ok`

Ticketschiene:

```json
{
  "type": "auth_ok",
  "code": "QMRT4X",
  "access": "read",
  "expiry": 600,
  "expires_at": "2026-07-27T14:22:31Z",
  "idle_timeout": 600,
  "mode": "tab",
  "allow": ["geizhals.de"],
  "step_mode": "confirm_each",
  "protocol": "smartrlink.v2"
}
```

Altschiene — nur die ersten fünf Felder.

**`auth_ok` ist die einzige Quelle der Befugnis für die Erweiterung.** Nicht das
`granted` aus `/redeem`, nicht der Inhalt des Tickets, den sie selbst auslesen
könnte. Weicht `auth_ok` vom `granted` ab, gilt `auth_ok`, und die Erweiterung
zeigt den tatsächlichen Umfang an.

### 5.4 Rahmen im Betrieb

Relay → Client (Befehl):

```json
{ "id": "c-7", "cmd": "navigate", "url": "https://geizhals.de/x" }
```

Client → Relay:

| Rahmen | Form | Wirkung |
|---|---|---|
| Ergebnis | `{"type":"result","id":"c-7","cmd":"navigate","success":true, …}` | setzt die Tätigkeitsmarke zurück |
| Ereignis | `{"type":"event","name":"…", …}` | setzt die Tätigkeitsmarke zurück |
| Herzschlag | `{"type":"ping","ts":1785283210}` | hält Leitung und Service Worker, **keine Tätigkeit** |
| Ende | `{"type":"disconnect","reason":"user_revoked"}` | beendet die Sitzung |

Relay → Client (Ende): `{"type":"disconnect","reason":"<grund>"}`, unmittelbar
gefolgt vom Schließcode aus §8.

Der Relay beantwortet `ping` **nicht** mit `pong`. Ein Client darf auf `pong`
nicht warten. `pong` bleibt als eingehender Rahmen zulässig und wird verworfen.

Der Befehlsname im `result` wird für das Protokoll **nicht** verwendet — der
Relay protokolliert den Befehl, den er selbst gesendet hat, weil der Name in der
Antwort fälschbar ist.

### 5.5 Was SMarTrChrome auf einen Befehl antwortet (Nachtrag 27.07., Runde 4)

Bisher stand hier nur, dass ein `result`-Rahmen zurückkommt. Die Erweiterung ist
an drei Stellen **strenger** als das; die Verschärfungen stehen hier, weil die
Gegenseite sie kennen muss, um sie zu übersetzen.

1. **Auf jeden Befehlsrahmen folgt genau ein `result`-Rahmen mit derselben
   `id` — ausnahmslos.** Auch auf einen unbekannten Befehl, auch bei einer
   Ablehnung durch den Menschen, auch bei einem Fehler in der Erweiterung
   selbst. *Warum:* Der Relay legt vor dem Senden eine Wartestelle an
   (`app.py`); ohne Antwort läuft jeder Befehl in `timeout_keine_antwort_vom_
   browser`, und der Agent kann „der Mensch hat abgelehnt" nicht von „der
   Browser ist tot" unterscheiden.

2. **`reason` ist Pflicht.** Fehlt der Satz für den Menschen oder ist er keine
   Zeichenkette, antwortet die Erweiterung mit `success: false`,
   `error.code = "reason_required"` und führt nichts aus. *Warum:* Der Satz
   wird vorgelesen — ohne ihn gibt der Inhaber etwas frei, das er nicht gehört
   hat.

3. **Geschlossene Befehlsliste, unabhängig von `REQUIRED` im Relay.** Was die
   Erweiterung nicht kennt, beantwortet sie mit
   `error.code = "not_supported"`. *Warum:* `read_file` und `list_dir` stehen
   im Relay auf Stufe `read` und kämen in einer Lesesitzung durch; dass nichts
   passiert, hing bisher allein daran, dass die Erweiterung sie nicht kennt.
   Eine Positivliste macht daraus eine Grenze statt eines Zufalls.

Fassung 0.2.0 führt die lesenden Befehle `readPage`, `snapshot`, `get_state`,
`scroll` und `highlight`. **Offen für den Relay (Baustelle A):** `readPage` und
`highlight` fehlen in `REQUIRED` und fallen dort auf `full` — sie werden also
abgewiesen, bevor sie die Erweiterung erreichen. Nötig sind die Zeilen
`"readPage": "read"` und `"highlight": "read"`; `snapshot`, `get_state` und
`scroll` stehen bereits richtig.

Der Ergebnisrahmen folgt spec-01 §3.6.4:
`{type, id, cmd, success, data?, error?{code,message,retryable,hint?}, meta}`.
`error.message` ist der Satz für den Menschen, `error.code` die Kennung für die
Maschine. `success: false` ist eine Beobachtung, kein Auftragsende.

---

## 6. Der Relay als HTTP-Dienst

Basis `https://connect.smartragents.ai`. Alle Fehler in der Form aus §3.

### `POST /api/v1/browser/command` und `POST /api/v1/browser/exec`

Identisches Verhalten; zwei Namen aus Bestandsgründen.

**Ausweis — genau zwei sind zugelassen und sonst keiner:**

| Ausweis | Wer | Eigentumsnachweis |
|---|---|---|
| `X-Internal-Key` | Agenten-Infrastruktur | ohne `user_id` im Rumpf zählt der Code allein; mit `user_id` muss sie zur Sitzung passen |
| `Authorization: Bearer <Alltags-Ausweis>` (§4.2) | der Mensch bzw. sein Tenant-Agent | `sub` **muss** der Eigentümer der Sitzung sein |

Ein **Ticket** wird hier mit `403 ticket_nicht_fuer_befehle` abgewiesen — ein
Verbindungsticket eröffnet eine Sitzung, es ist kein Befehlsausweis. Ein
vorhandener, aber **falscher** `X-Internal-Key` fällt nicht auf den Bearer
zurück, sondern ist `401 internal_key_ungueltig`: Wer zwei Ausweise anlegt, von
denen einer nicht stimmt, bekommt keine zweite Chance.

Das gilt auf **beiden** Schienen gleich. Insbesondere ist der Alltags-Ausweis des
Eigentümers auch auf einer **Ticketsitzung** zugelassen. (Klarstellung 27.07.:
Der Relay wies dort jeden Aufrufer ohne `X-Internal-Key` mit 403 ab; damit konnte
der Tenant-Agent die gerade freigegebene Sitzung gar nicht bedienen. Die Grenze
ist der Eigentumsnachweis, nicht die Schiene — der Ausweis eines fremden Kontos
bleibt `403 code_gehoert_anderem_nutzer`.)

Rumpf: `{"code":"QMRT4X","cmd":"navigate","url":"…","timeout":60,"id":"…"}`.
Übernommen wird nur, was auf der Positivliste der Argumentfelder steht (`url`,
`target`, `selector`, `text`, `label`, `dx`, `dy`, `js`, `path`, `content`,
`command`, `task`, `arg`, `reason`); alles andere fällt weg. `cmd` und `id` setzt
der Server zuletzt, `type` entsteht nie. `user_id` nur für interne Aufrufer.

**`reason` (Nachtrag 27.07., Widerspruch aufgelöst):** §5.5 Punkt 2 erklärt den
Satz zur Pflicht, diese Liste hatte ihn weggelassen — der Relay hat ihn deshalb
aus jedem Rahmen entfernt, und der Ausführer der Erweiterung hat jeden Befehl mit
`reason_required` zurückgewiesen. Daran ist der erste Durchstich gescheitert.
`reason` steht jetzt auf der Liste. Der Relay deckelt ihn auf 200 Zeichen und
entfernt Steuerzeichen (`reason_saeubern`): Der Satz wird dem Menschen
vorgelesen, und ein Text mit eingebetteten Zeilenumbrüchen oder in Romanlänge
macht die Freigabefrage unbrauchbar. Ein leerer Satz fällt aus dem Rahmen.
Die Verwechslungsgefahr mit dem `reason` eines `disconnect`-Rahmens besteht
nicht: Ein Befehlsrahmen trägt nie ein `type`, und der Client verteilt
ausschließlich danach (`link.js:512`).

**Stufen der Agentenseiten-Namen (Nachtrag 27.07.):** `readPage` und `highlight`
stehen jetzt mit Stufe `read` in der Befehlstabelle des Relays. Ohne Eintrag
stuft `required_for` einen unbekannten Namen auf `full` ein — dann wären genau
die beiden Lesebefehle gesperrt, die der Ausführer heute beherrscht.

**`id`:** darf mitgegeben werden, muss aber eine nichtleere Zeichenkette von
höchstens 64 Zeichen sein (`400 id_ungueltig`) und darf in dieser Sitzung nicht
schon auf eine Antwort warten (`409 id_bereits_in_gebrauch`). Ohne Vorgabe
vergibt der Server. (Verschärfung 27.07.: Die Kennung wurde ungeprüft übernommen;
zwei Aufrufer mit derselben `id` überschrieben sich die Wartestelle, und der
erste wartete danach auf eine Antwort, die dem zweiten zugestellt wurde.)

**Ziele:** Ein Rumpf kann mehrere Zieladressen tragen — `url` **und** `target`.
Geprüft werden **alle**, gegen Schema (`http`/`https`) und gegen `allow`; ein
einziges Ziel außerhalb der Grenze verwirft den ganzen Befehl. (Verschärfung
27.07.: Geprüft wurde nur das erste gefüllte Feld, weitergereicht wurden beide —
`url` auf einen freigegebenen Host und `target` auf ein verbotenes ging live
durch.) Beim Vergleich ist ein abschließender Wurzelpunkt bedeutungslos:
`geizhals.de.` und `geizhals.de` sind derselbe Name (RFC 1034 §3.1). Ein Host mit
leerer Marke (`geizhals..de`) ist `403 ziel_ohne_host`.

**Der Wirtsname ist eine Positivliste** (Verschärfung Runde 4, live nachgewiesen
am 27.07.): Zugelassen sind ausschließlich Buchstaben, Ziffern, Bindestrich und
Punkt; jede Marke 1–63 Zeichen, keine leere Marke, insgesamt höchstens 253
Zeichen. Ein Port ist erlaubt, aber nur als ASCII-Ziffernfolge 1–65535. Alles
andere ist `403 wirtsname_ungueltig`: Rückwärtsschrägstrich und seine kodierten
Formen (`%5c`), `@` und damit Anmeldedaten in der Adresse, eckige Klammern und
damit IPv6-Literale, Unterstrich, jedes Zeichen jenseits von ASCII. Internationale
Namen gehören in Punycode-Schreibweise (`xn--…`) hierher.

*Warum so eng:* Bei `allow=['*.geizhals.de']` ging `https://evil.com\.geizhals.de/x`
mit `200` durch und der Befehl erreichte den Client. Pythons `urlsplit` liest den
Wirtsnamen als `evil.com\.geizhals.de` — das endet auf `.geizhals.de` und lag
damit im Bereich; ein Browser beendet die Autorität am Rückwärtsschrägstrich und
landet bei `evil.com`. Dieselbe Familie: `%5c`, Klammer- und Doppelpunktformen,
gemischte Schreibweisen, Unicode-Normalisierung. Die Grenze ist nicht, den Browser
nachzubauen, sondern die Menge der zugelassenen Adressen so klein zu machen, dass
beide Leser gar nicht mehr auseinandergehen können. Der Relay prüft die
Roh-Adresse **vor** dem Zerlegen, schneidet die Autorität selbst heraus und macht
danach die Gegenprobe mit `urlsplit`; wo die beiden Leser sich uneins sind, ist
das ebenfalls `403 wirtsname_ungueltig`. Eine unzerlegbare Adresse (`http://[`,
`https://[garbage/x`) ist eine Abweisung, nie ein Serverfehler — vorher schlug
der `ValueError` bis `HTTP 500` durch.

**Weitergereicht wird, was geprüft wurde.** Der Relay setzt in den Rahmen für den
Client genau die Zeichenkette, über die er entschieden hat: ohne Tabulator und
Zeilenumbruch (die entfernt jeder Leser) und ohne die Randzeichen U+0000–U+0020
(die schneidet jeder Browser ab). Unicode-Leerraum wie U+00A0 wird **nicht**
abgeschnitten — Python täte es, ein Browser nicht, und dann prüfte der Relay eine
Adresse, die der Client so nie sieht. Ein Zielfeld ohne geprüften Wert erreicht
den Client überhaupt nicht. Vorher wurde `wert.strip()` geprüft und `wert`
weitergereicht — zwei Zeichenketten, eine Entscheidung.

C0-Steuerzeichen und `DEL` sind in der ganzen Adresse verboten
(`403 wirtsname_ungueltig`), das **Leerzeichen** dagegen nur in der Autorität:
Hinter ihr kann es die Grenze nicht mehr verschieben, und ein Suchbegriff mit
Leerzeichen ist kein Angriff.

Der **Sitzungscode** wird nur in ASCII großgeschrieben. `str.upper()` ist
unicodefähig ('ſ' → 'S', 'ﬅ' → 'FT'); damit ließ sich dieselbe Sitzung unter
Schreibweisen ansprechen, die nie vergeben wurden. `cmd` muss eine nichtleere
Zeichenkette sein (`400 code_und_cmd_erforderlich`) — aus einem Objekt machte
`str()` einen Befehlsnamen, den die Stufentabelle nicht kennt und den der Client
trotzdem zu sehen bekam.

Antwort: der `result`-Rahmen des Clients, unverändert.

Zeitüberschreitung antwortet bewusst mit **200** und
`{"success":false,"timeout":true,"error":"timeout_keine_antwort_vom_browser"}`,
weil Cloudflare 5xx-Rümpfe durch HTML ersetzt.

Ratengrenzen je Sitzung: 30 Befehle je 60 s, davon höchstens 10 `navigate`,
insgesamt 300 je Sitzung. Der Sitzungsdeckel beendet die Sitzung mit `4429`.

### `POST /api/v1/browser/disconnect`

Rumpf `{"code":"QMRT4X","reason":"user_revoked"}`. Ohne `code` werden alle
Sitzungen des anfragenden Nutzers beendet. Wiederholter Aufruf ist gutmütig:
`{"success":true,"status":"already_ended","codes":[]}`. Die Notbremse darf nie
an einem 404 hängenbleiben.

### `GET /api/v1/browser/status/{code}`

`200`: `{"connected":true,"access":"read","expires_at":"…Z",
"expires_at_epoch":1785283351,"client":"smartrchrome","mode":"tab",
"allow":["geizhals.de"],"idle_timeout":600,"pending":0}`
`410`: Code bekannt, Sitzung vorbei. `404`: unbekannt oder fremd.

### `GET /health`

`{"ok":true,"sessions":3}`

### 6.1 Fehlerkennungen des Relays — vollständig

Die Liste ist abschließend: Was der Relay über die Leitung schickt, steht hier.
Sie wurde am 27.07. ergänzt, weil ein Teil der Kennungen im Code stand und in
keinem Dokument — eine Kennung, die die Gegenseite nicht kennt, kann sie auch
nicht übersetzen. `test_connect.py` hält beide Richtungen zusammen: jede Kennung
aus dem Quelltext muss hier stehen, und jede hier genannte muss auffindbar sein.

| Status | `error` | Wann |
|---|---|---|
| 400 | `invalid_json` | Rumpf ist kein JSON-Objekt |
| 400 | `code_und_cmd_erforderlich` | `code` oder `cmd` fehlt |
| 400 | `ziel_fehlt` | `navigate` ohne Zieladresse |
| 400 | `id_ungueltig` | `id` keine Zeichenkette, leer oder > 64 Zeichen |
| 400 | `code_oder_user_id_erforderlich` | `/disconnect` intern ohne beides |
| 401 | `unauthorized` | kein Ausweis |
| 401 | `invalid_token` | Ausweis unlesbar, abgelaufen, ohne `exp` oder halbe Anmeldung (E14) |
| 401 | `internal_key_ungueltig` | `X-Internal-Key` vorhanden, aber falsch |
| 403 | `ticket_nicht_fuer_befehle` | Ticket als `Authorization: Bearer` |
| 403 | `code_gehoert_anderem_nutzer` | Ausweis gehört nicht dem Sitzungseigentümer |
| 403 | `stufe_zu_niedrig` | Befehl verlangt eine höhere Stufe als die Sitzung hat |
| 403 | `schema_nicht_erlaubt` | Ziel ist weder `http` noch `https` |
| 403 | `ziel_ohne_host` | Ziel ohne erkennbaren Host oder mit leerer Marke |
| 403 | `wirtsname_ungueltig` | Wirtsname außerhalb der Positivliste, unzerlegbar, oder zwei Leser lesen ihn verschieden |
| 403 | `ziel_ungueltig` | Zielfeld ist keine Zeichenkette |
| 403 | `ausserhalb_des_bereichs` | ein Ziel liegt außerhalb von `allow` |
| 404 | `code_unbekannt_oder_getrennt` | keine offene Sitzung zu diesem Code |
| 404 | `code_unbekannt` | `/disconnect`: Code nie vergeben oder fremd |
| 409 | `id_bereits_in_gebrauch` | `id` wartet in dieser Sitzung schon auf Antwort |
| 410 | `session_abgelaufen` | vereinbarte Dauer vorbei |
| 410 | `session_abgelaufen_oder_beendet` | `/status`: Code bekannt, Sitzung vorbei |
| 410 | `session_getrennt` | Verbindung zum Client weg |
| 429 | `ratenbegrenzt` | Minuten- oder Navigationsgrenze, Feld `limit` nennt welche: `minutenlimit`, `navigationslimit`, `sitzungslimit` |
| 429 | `ratenbegrenzt_sitzung_beendet` | Sitzungsdeckel von 300 Befehlen, Sitzung endet mit `4429` |
| 200 | `timeout_keine_antwort_vom_browser` | Zeitüberschreitung, siehe oben |

---

## 7. Herkunftsbindung

**Das Problem:** `verify_word` zeigt die Erweiterung selbst an, und den
Alltags-Ausweis hat sie ebenfalls. Ohne zusätzliche Bindung kann sie
`POST /confirm` selbst absenden und sich damit die Befugnis erteilen, die ein
Mensch erteilen sollte.

### 7.1 Bei `POST /confirm` — nur der Web-Ursprung darf freigeben

*(Betrifft nur den manuellen Weg oberhalb von read. Die Lesestufe hat seit
E15 keinen Bewilligungsschritt mehr, den man binden könnte — dort trägt
allein §7.2.)*

**Was die Seite mitschickt:**

| Woher | Feld/Kopfzeile | Wert |
|---|---|---|
| Rumpf, ausdrücklich | `origin` | `"https://cloud.smartragents.ai"` |
| Rumpf, ausdrücklich | `reauth` | `{"method":"password","assertion":"<Kontopasswort>"}` |
| Browser, nicht fälschbar | `Origin` | `https://cloud.smartragents.ai` |
| Browser, nicht fälschbar | `Sec-Fetch-Site` | `same-origin` |
| Browser, nicht fälschbar | `Sec-Fetch-Mode` | `cors` |
| Seite | `Authorization` | `Bearer <Alltags-Ausweis>` |

`Origin` und `Sec-Fetch-*` stehen auf der Liste der verbotenen Kopfzeilennamen —
Seitenskript und Erweiterung können sie nicht setzen; der Browser setzt sie. Bei
einem `POST` sendet der Browser `Origin` auch bei gleichem Ursprung.

**Was die Ticketausgabe prüft** (in dieser Reihenfolge, jeder Fehlschlag ist
`403 herkunft_ungueltig`):

1. `Origin` ist vorhanden und **byteweise gleich** `LINK_CONFIRM_ORIGIN`
   (`https://cloud.smartragents.ai`). Kein Kopf → Ablehnung. Kein Schalter, der
   das lockert.
2. Rumpffeld `origin` ist vorhanden und gleich dem `Origin`-Kopf. Fehlt es →
   Ablehnung. Die ausdrückliche Erklärung bringt keine zusätzliche kryptografische
   Stärke, aber sie macht aus einer stillen Kopfzeilenprüfung eine Zusage, die
   im Protokoll und im Test sichtbar ist.
3. `Sec-Fetch-Site` ist, falls vorhanden, `same-origin`; `Sec-Fetch-Mode` ist,
   falls vorhanden, `cors`.
4. `Origin` beginnt nicht mit `chrome-extension://` — dieselbe Ablehnung wie in
   Schritt 1, aber mit eigenem Protokollsatz, weil genau dieser Fall der
   Angriffsversuch ist, den man sehen will.

**Folge eines Fehlschlags:** Der Vorgang wird sofort auf `denied` gesetzt und mit
`herkunft_verletzt`, dem gesehenen Ursprung und der `extension_id`
protokolliert. Ein Versuch verbrennt die Freigabe — er wird nicht wiederholbar.

### 7.2 Bei `POST /redeem` — nur die antragstellende Erweiterung darf abholen

**Was die Erweiterung mitschickt:** `redeem_key` im Rumpf; der Browser setzt
`Origin: chrome-extension://<extension_id>`.

**Was die Ticketausgabe prüft:**

1. `redeem_key` stimmt gegen den gespeicherten SHA-256-Abdruck
   (`compare_digest`). **Das ist die harte Bedingung.**
2. `Origin` ist `chrome-extension://` + der beim Antrag gespeicherten
   `extension_id`. Zusätzliche Bedingung.

**Warum ein eigener Schlüssel und nicht nur der Ursprung:** Die Freigabeseite hat
denselben Alltags-Ausweis und kennt die `rid` aus ihrer eigenen Adresszeile —
ohne `redeem_key` könnte ein Skript im Web-Ursprung das Ticket abholen, und
genau dorthin darf es nie gelangen. Der Schlüssel wird ausschließlich in der
Antwort auf `POST /request` ausgeliefert, die nur die Erweiterung stellt.

Drei Fehlversuche mit falschem `redeem_key` setzen den Vorgang auf `denied`. Eine
verlorene Freigabe ist der kleinere Schaden als ein geratenes Ticket.

### 7.3 Bedingungen, ohne die die Bindung nichts wert ist

Diese drei Punkte sind Teil des Drahtformats, weil die Bindung sonst nur so
aussieht, als bestünde sie:

1. **Die Erweiterung hat keine Berechtigung für den Web-Ursprung.**
   `https://cloud.smartragents.ai/*` steht nicht in `host_permissions` (E12).
   Eine Erweiterung, die im Freigabe-Ursprung Skripte ausführen darf, kann jede
   Kopfzeilenprüfung umgehen, weil ihre Anfragen dann echte Anfragen dieses
   Ursprungs sind.
2. **Die Erweiterung fordert diesen Ursprung auch zur Laufzeit nie an.** Der
   Aufruf, der optionale Berechtigungen anfragt, filtert
   `cloud.smartragents.ai` heraus, und die Ausführungsschicht verweigert jede
   Einspritzung in einen Tab dieses Ursprungs.
3. **Die Freigabeseite läuft nur als eigenständiger Tab.** Sie bricht ab, wenn
   `window.top !== window`, und die Auslieferung setzt für `/link/confirm`
   `Content-Security-Policy: frame-ancestors 'none'`.

### 7.4 Was die Bindung nicht leistet

Sie hindert einen Angreifer nicht, der den Alltags-Ausweis **außerhalb** des
Browsers besitzt und die Kopfzeilen frei setzt. Dagegen stehen `verify_word`
(steht auf einem anderen Gerät als der gestohlene Ausweis) und `reauth`
(Kontopasswort, das im Ausweis nicht enthalten ist). Das ist die ehrliche
Grenze; sie wird hier genannt, damit niemand sie später für einen Fehler hält.

---

## 8. Schließcodes und Gründe (WebSocket)

| Code | `reason` | Ursache |
|---|---|---|
| 1000 | — | normales Ende durch den Client |
| **4400** | `protocol_error` | erster Rahmen kein `auth`, oder > 20 s, oder verbotenes Feld im Rahmen, oder Unterprotokoll **und** `?token=`, oder die Unterprotokollliste ist nicht genau `["smartrlink.v2", "<TICKET>"]` (§5.1 Schritt 1) |
| 4400 | `client_unbekannt` | `client` fehlt oder steht nicht auf der Positivliste (E13) |
| 4400 | `duration_zero_forbidden` | `duration = 0` im Ticket |
| 4400 | `access_level_forbidden` | Stufe über dem Deckel des Clients (`full` für `smartrchrome`) |
| 4400 | `access_ungueltig` / `duration_ungueltig` | Anspruch fehlt oder ist unlesbar |
| 4400 | `modus_ungueltig` | `mode` fehlt oder ist weder `tab` noch `domains` |
| 4400 | `idle_timeout_ungueltig` | `idle_timeout` fehlt oder ist unlesbar |
| 4400 | `allow_leer` | Ticket ohne Adressliste (E7) |
| 4400 | `allow_ungueltig` | Eintrag ist kein Wirtsname nach der Positivliste aus §6 (optional mit vorangestelltem `*.`) — also Schema, Pfad, Doppelpunkt, Leerzeichen, Rückwärtsschrägstrich, Nicht-ASCII, blankes `*`, leere Marke |
| 4400 | `allow_zu_weit` | Platzhalter vor einer einzelnen Marke (`*.de`) |
| 4400 | `allow_zu_gross` | mehr als 10 Adressen, oder `mode: "tab"` mit ≠ 1 Adresse |
| 4400 | `ticket_im_query` | Ticket in `?token=` statt im Unterprotokoll |
| 4400 | `token_im_unterprotokoll` | Alltags-Token im Unterprotokoll statt in `?token=` |
| **4401** | `unauthorized` | Signatur, `aud`, `scope` oder Ablauf des Tickets falsch; Ausweis nach §4.2 ungültig, insbesondere halbe Anmeldung (E14) |
| 4401 | `ticket_replayed` | `jti` bereits verbraucht |
| 4401 | `ausweis_fehlt` | Ticketschiene ohne `ausweis` im `auth`-Rahmen |
| 4401 | `ausweis_fremd` | `ausweis.sub != ticket.sub` |
| **4408** | `session_expired` | vereinbarte Dauer abgelaufen |
| **4409** | `session_idle` | Leerlauffrist überschritten (E5, E11) |
| **4410** | `revoked_by_user` | Notbremse, `POST /disconnect` |
| **4429** | `rate_limited` | Sitzungsdeckel von 300 Befehlen erreicht |

Klartexte der Erweiterung zu diesen Codes (`link.js:61-71`) bleiben, wie sie
sind — sie stimmen mit dieser Tabelle überein.

---

## 9. HTTP-Fehlerkennungen

| Status | `error` | Wo |
|---|---|---|
| 400 | `invalid_json` | alle |
| 400 | `stufe_unbekannt`, `dauer_ungueltig`, `dauer_ausserhalb_deckel`, `modus_unbekannt` | request, confirm |
| 400 | `bereich_ungueltig`, `bereich_zu_weit`, `bereich_zu_gross`, `bereich_leer`, `tab_host_fehlt` | request, confirm |
| 401 | `unauthorized` | alle |
| 402 | `kontingent` | request (Abo/Guthaben fehlt) |
| 403 | `client_unbekannt`, `extension_unknown` | request |
| 403 | `stufe_fuer_client_gesperrt`, `modus_noch_gesperrt` | request, confirm |
| 403 | `herkunft_ungueltig` | confirm, redeem |
| 403 | `kennwort_falsch`, `reauth_erforderlich`, `bereich_erweitert` | confirm |
| 404 | `antrag_unbekannt` | request/{rid}, confirm, redeem |
| 409 | `antrag_bereits_entschieden` | confirm |
| 410 | `antrag_abgelaufen`, `ticket_bereits_abgeholt` | request/{rid}, confirm, redeem |
| 429 | `too_many_requests` | request, confirm |
| 451 | `agb` | request (Nutzungsbedingungen offen) |

Die Erweiterung übersetzt nach Status, nicht nach Kennung
(`dienste.js:70-87`) — die Kennung wird nur mitgeführt, nie angezeigt.

---

## 10. Feste Werte

| Wert | Größe | Gilt für |
|---|---|---|
| Kennwortalphabet | `ABCDEFGHJKMNPQRSTUVWXYZ23456789` | Kennwort und Sitzungscode |
| Kennwortlänge | 6 | `verify_word` |
| Sitzungscode | 6 | `code` |
| Lebensdauer des Antrags | 120 s | `rid` |
| Lebensdauer des Tickets | 60 s | `exp - iat` |
| Verbrauchsliste `jti` | 900 s | Relay |
| Abfragetakt `/redeem` | 2 s, ≤ 75 Versuche | Erweiterung |
| Vorbelegte Dauer | 600 s | `preselect.duration` |
| Höchstdauer Ticketschiene | 3600 s | `limits.max_duration` |
| Höchstdauer Altschiene | 28800 s | Desktop |
| Leerlauffrist Ticketschiene | 600 s | `idle_timeout` |
| Leerlauffrist Altschiene | 0 (aus) | Desktop |
| Adressen je Sitzung | ≤ 10 | `allow` |
| Kennwortversuche je Vorgang | 3 | `attempts_left` |
| Kennwortversuche je Nutzer | 10 / 10 min | Erratensperre |
| Offene Vorgänge je Nutzer | 3 | Ticketausgabe |
| Anträge je Nutzer | 10 / 10 min | Ticketausgabe |
| Befehle je Sitzung | 30/60 s, davon 10 `navigate`, 300 gesamt | Relay |
| Frist für den `auth`-Rahmen | 20 s | Relay |
| Herzschlag der Erweiterung | 20 s | Service Worker |

---

## 11. Was jede Seite jetzt ändern muss

Keine Empfehlung — das ist die Abnahmeliste.

**Relay (`smartrbrowser/server/app.py`)**
1. `TICKET_SCOPE_ALIAS`/`TICKET_SCOPES` streichen, `scope` nur noch `smartrlink-ticket` (E4).
2. Ticket in `?token=` → `4400 ticket_im_query`; Alltags-Token im Unterprotokoll → `4400 token_im_unterprotokoll` (E2).
3. `ausweis` aus dem `auth`-Rahmen prüfen, `sub`-Gleichheit erzwingen (E2).
4. Verbotene Felder im `auth`-Rahmen der Ticketschiene → `4400` (E2, Schritt 6).
5. Anspruch `idle_timeout` statt `idle`/`idl` lesen; Pflichtansprüche erzwingen (§4).
6. Leeres `allow` → `4400 allow_leer` (E7).
7. `auth_ok`: `scope` → `allow`, dazu `mode` und `step_mode` (E6, §5.3).
8. `/status`: `scope` → `allow`, `mode` ergänzen.
9. `LEGACY_IDLE_DEFAULT = 0`, `TICKET_IDLE_DEFAULT = 600`, `CONNECT_IDLE_ENFORCE` entfällt (E11).
10. Positivliste `TICKET_CLIENT_DECKEL` statt Negativliste, `client`
    kleingeschrieben, unbekannt/fehlend → `4400 client_unbekannt` (E13).
11. `amr` mit `mfa-pending`/`mfa-setup` überall abweisen (E14, §4.2).
12. Alle Zielfelder eines Rumpfes prüfen, nicht nur das erste (§6).
13. Befehlsausweis = Eigentumsnachweis, nicht Schiene; falscher
    `X-Internal-Key` fällt nicht auf den Bearer zurück (§6).
14. `id` aus dem Rumpf prüfen und auf Kollision testen; Unterprotokollliste
    genau zweielementig; Wurzelpunkt beim Hostvergleich ausgleichen (§6, §5.1).

**Ticketausgabe (`Deploy/smartrlink-ticket/ticket.py`)**
1. `TICKET_SCOPE = "smartrlink-ticket"`, auch in der Sperre gegen Anmeldung mit Ticket (E4).
2. `erbeten` → `requested`, `vorbelegung` → `preselect`, `grenzen` → `limits`,
   `kennwort*` → `verify_word*`, `zweck` → `purpose`, `ansage` → `verify_word_spoken` (E0, E1).
3. Geltungsbereich flach: `mode`/`allow`/`tab_host`; `pruefe_bereich` gibt keine
   Objekte mit `domains` mehr zurück (E6).
4. Fehlende Felder in `/confirm` aus `preselect` ergänzen, nicht aus `requested` (E8).
5. `reauth` bei jeder Freigabe verlangen; Feld `assertion` (E3, E9).
6. Herkunftsbindung in `/confirm` und `/redeem` (§7), `redeem_key` erzeugen,
   hashen, prüfen.
7. Bei `mode: "tab"` `allow = [tab_host]` setzen (E7); `tab_host` fehlt → 400.
8. Kurznamen im Ticket streichen, `idle_timeout` und `step_mode` als Pflicht (§4).

**Erweiterung (`smartrchrome/src/net/*.js`, `manifest.json`)**
1. `cloud.smartragents.ai` aus `host_permissions`; `GATEWAY_BASIS` = `api.…`,
   `RELAY_BASIS` = `connect.…`; `disconnect` gegen `RELAY_BASIS` (E12).
2. Ticket ins Unterprotokoll (letztes Element), `ausweis` in den `auth`-Rahmen;
   `ticket` verschwindet aus dem Rahmen (E2).
3. Abholen über `POST /api/v1/link/redeem` mit `redeem_key` statt über den
   Anzeige-Endpunkt (E10).
4. `requested` mit `mode`/`allow`/`tab_host`/`step_mode` senden (E6).
5. `auth_ok` auswerten: `allow` statt `scope`, `mode` und `step_mode` übernehmen;
   `bereichAus()` entfällt (E6, §5.3).
6. `redeem_key` nur im Modulspeicher halten, nie in `chrome.storage`.
7. Antragslebensdauer 120 s statt 180 s als Rückfallwert.

**Freigabeseite (`Cloud/cloud-frontend/src/{lib/linkConfirm.ts,components/LinkConfirm.tsx,api/client.ts}`)**
1. `normalizeLinkRequest` liest nur noch `requested`; Ausweichnamen streichen (E1).
2. Bedienelemente aus `preselect` vorbelegen, `requested` nur zitieren (E8).
3. Absenden, was der Mensch eingestellt hat — nicht `antrag.*` (E8).
4. `origin` im Rumpf mitsenden (§7.1).
5. `reauth: {method:"password", assertion:…}` immer, nicht nur bei `write` (E3, E9).
6. `mode`/`allow` flach senden, `scope`/`scope_mode` streichen (E6).
7. `state: "confirmed"` aus der Übersetzung entfernen — es gibt nur `approved`.
8. Abbruch, wenn `window.top !== window` (§7.3).
9. Der Kommentar „genau einmal laden, sonst verbrennt das Ticket" ist falsch und
   kommt weg (E10).

---

## 12. Prüfsätze für die Abnahme

Diese Sätze sind die Übersetzung dieses Dokuments in Prüfungen. Sie gehören in
`test_ticket.py`, `test_connect.py` und die Frontend-Tests.

1. Desktop-Fall: `?token=<Alltags-JWT>`, kein Unterprotokoll, `duration: 0` →
   Sitzung über 28800 s, `idle_limit = 0`, `auth_ok` ohne `allow`.
2. Ticket in `?token=` → `4400 ticket_im_query`.
3. Alltags-Token als letztes Unterprotokoll → `4400 token_im_unterprotokoll`.
4. Ticketschiene ohne `ausweis` → `4401 ausweis_fehlt`.
5. `ausweis` eines anderen Nutzers → `4401 ausweis_fremd`.
6. Zweites Verbinden mit demselben Ticket → `4401 ticket_replayed`.
7. Ticket mit leerem `allow` → `4400 allow_leer`.
8. `auth`-Rahmen der Ticketschiene mit `access` → `4400 protocol_error`.
9. `GET /request/{rid}` liefert `preselect.access == "read"`,
   `preselect.duration == 600`, `preselect.mode == "tab"` — unabhängig davon,
   was `requested` sagt.
10. `POST /confirm` ohne `access` erteilt `read`, nicht den Wunsch.
11. `POST /confirm` mit `Origin: chrome-extension://…` → `403 herkunft_ungueltig`,
    Vorgang danach `denied`.
12. `POST /confirm` ohne `Origin`-Kopf → `403 herkunft_ungueltig`.
13. `POST /confirm` ohne `reauth` → `403 reauth_erforderlich`, auch bei `read`.
14. `POST /confirm` mit `allow: ["fremde.de"]` → `403 bereich_erweitert`.
15. `POST /redeem` ohne `redeem_key` → `403 herkunft_ungueltig`, Vorgang bleibt
    beim ersten und zweiten Versuch `approved`, beim dritten `denied`.
16. `POST /redeem` zweimal erfolgreich → beim zweiten Mal `410 ticket_bereits_abgeholt`.
17. `GET /request/{rid}` zehnmal → zehnmal `200`, danach ist `/redeem` weiterhin
    möglich.
18. Freigabe mit `mode: "tab"` → Ticket enthält `allow: [tab_host]`, nicht `[]`.
19. Leerlauf auf der Ticketschiene → `4409 session_idle`; Widerruf → `4410 revoked_by_user`.
20. Ein Ticket als `Authorization: Bearer` an `/api/v1/browser/command` →
    `403 ticket_nicht_fuer_befehle`.

Nachtrag Reparaturrunde 3 (alle in `test_connect.py`):

21. Befehl mit `url` auf einen freigegebenen Host **und** `target` auf ein
    verbotenes → `403 ausserhalb_des_bereichs`, nichts erreicht den Client.
    Dasselbe mit `target: "javascript:…"` → `403 schema_nicht_erlaubt`.
22. Ticket mit `client: "SMARTRCHROME"` und `access: "full"` →
    `4400 access_level_forbidden`; mit `client: "beliebig"`,
    `"smartrbrowser"` oder ohne `client` → `4400 client_unbekannt`, auch bei
    `access: "read"`.
23. Alltags-Ausweis mit `amr: ["pwd","mfa-pending"]` bzw. `["pwd","mfa-setup"]`
    → `4401 unauthorized` auf beiden Schienen und `401 invalid_token` an
    `/command`, `/exec`, `/status`, `/disconnect`. Gegenprobe: `["pwd"]`,
    `["pwd","totp"]`, `["passkey"]`, `["google"]` bleiben gültig.
24. Befehl an eine Ticketsitzung mit dem Alltags-Ausweis des **Eigentümers** →
    `200`; mit dem eines anderen Kontos → `403 code_gehoert_anderem_nutzer`;
    mit einem Ticket → `403 ticket_nicht_fuer_befehle`.
25. Zwei Befehle mit derselben `id` → der zweite `409 id_bereits_in_gebrauch`,
    die Wartestelle des ersten bleibt unberührt. `id: 42`, `id: ""` oder länger
    als 64 Zeichen → `400 id_ungueltig`.
26. Unterprotokollliste mit drei Elementen oder vertauschter Reihenfolge →
    `4400 protocol_error`.
27. `https://geizhals.de./preis` bei `allow: ["geizhals.de"]` → `200`;
    `https://geizhals..de/x` → `403 ziel_ohne_host`.
28. Jede Fehlerkennung und jeder Schließgrund im Quelltext des Relays steht in
    §6.1 bzw. §8 — und umgekehrt. Das gilt auch für die Werte des Feldes
    `limit` bei `429`.

Nachtrag Reparaturrunde 4 — Adressen sicher lesen (alle in `test_connect.py`):

29. Bei `allow: ["*.geizhals.de"]` erreicht keine der folgenden Adressen den
    Client: `https://evil.com\.geizhals.de/x`, dieselbe mit `%5c`/`%5C`/`%252f`,
    mit Port dahinter, in gemischter Schreibweise, mit `@` in beide Richtungen,
    mit Vollbreitenbuchstabe, ideografischem Punkt, Bruchstrich oder
    Unterstrich. Antwort ist `403`, das Prüfprotokoll trägt die Abweisung.
30. `http://[`, `https://[garbage/x`, `http://[::1]\x`, `https://gei℀zhals.de/x`
    → `403`, nie `500`. Die reine Zielprüfung wirft bei keiner dieser Adressen.
31. Gegenprobe: `geizhals.de`, `www.geizhals.de`, `GeizHals.DE`, `geizhals.de.`,
    `geizhals.de:8443`, `192.168.1.1:80`, `xn--gizhals-p4a.de` bleiben offen.
    Marke mit 63 Zeichen ja, mit 64 nein; 254 Zeichen gesamt nein.
32. Port nur als ASCII-Ziffernfolge: `:0`, `:99999`, `:80a`, `:٨٠`, `:80:90`,
    `:-1` → `403 wirtsname_ungueltig`.
33. Der Client bekommt die geprüfte Adresse: `" \thttps://geizhals.de/pre\nis\r "`
    kommt als `https://geizhals.de/preis` an. `" https://geizhals.de/x"` →
    `403 schema_nicht_erlaubt` (Python schnitte U+00A0 weg, ein Browser nicht).
    Ein Zielfeld ohne geprüften Wert fehlt im Rahmen ganz.
34. Steuerzeichen im Inneren einer Adresse → `403 wirtsname_ungueltig`; ein
    Leerzeichen im Suchbegriff bleibt zulässig.
35. Ticket mit `allow: ["geizhals.de\evil.com"]`, `["evil.com%5c.geizhals.de"]`,
    `["geizhäls.de"]`, `["geizhals..de"]`, `["*."]` → `4400 allow_ungueltig`.
36. Sitzungscode `"r6a00ſ"` trifft die Sitzung `R6A00S` **nicht**
    (`404 code_unbekannt_oder_getrennt`), `"r6a00s"` trifft sie.
37. `cmd` als Objekt, Liste oder Zahl → `400 code_und_cmd_erforderlich`.

---

## 13. Nachtrag 14.08.2026 — was v3.5 auf der Leitung ändert

Vier Ergänzungen, alle rein additiv. Sie widersprechen nichts von dem, was oben
steht; wo eine Tabelle länger wird, steht hier, um welche Zeile. Der
Schnittstellenvertrag dazu ist `docs/VERTRAG-v3.5.md`, die maschinenlesbare Form
`docs/schema-fernprotokoll.json`.

### 13.1 `step_mode` kennt einen dritten Wert: `assist`

Zu §5.3 (`auth_ok`), §4 (Ticket) und §10 (Feste Werte).

`step_mode` führte bisher `confirm_each` und `auto`. Neu kommt `assist` dazu,
der mittlere Stand: Lesen, Klicken, Tippen und Blättern laufen durch, alles
Weitere geht als Rückfrage an den Menschen. **Unbekannte Werte fallen weiterhin
auf `confirm_each`**, in dieser Richtung und in keiner anderen.

Der Wert kann nur aus einem signierten Ticket kommen. Die Erweiterung verrechnet
ihn mit dem Modus, den der Mensch in der Seitenleiste eingestellt hat, und es
gilt der **kleinere von beiden**: Der Server kann einschränken, nie erweitern.

*Stand der Umsetzung:* Der Relay nimmt `assist` an. Die Ticketausgabe stellt ihn
noch nicht aus, siehe `docs/OFFEN-v3.5.md` §2.1.

### 13.2 Ein neuer Befehl: `run_workflow` (Stufe `write`)

Zu E18, Festlegung 1. Die Tabelle wird um eine Zeile länger:

| Stufe | Befehle |
|---|---|
| `write` | `click`, `type`, `select`, **`run_workflow`** |

`run_workflow` spielt einen Ablauf ab, den der Mensch selbst aufgezeichnet hat.
Frist 120 Sekunden, das ist die längste der Tabelle, weil hier nicht ein Schritt
geschieht, sondern eine Reihe davon.

**Was er ausdrücklich nicht ist: eine zweite Tür.** Jeder Schritt geht durch
dieselbe Befehlsschleife wie ein Agentenbefehl, also durch Modus,
Aktionsklassen, Bereichsprüfung und Verdeckungswache. Deshalb steht auch hier
die Rückfrage beim Menschen, und deshalb gilt für die Schritte das
Schrittbudget der Sitzung.

Alle vier Schichten müssen die Zeile führen. `REQUIRED` im Relay hat sie,
`BEFEHLE` und `AUSFUEHRUNG` der Erweiterung haben sie, die **Werkzeugtabelle der
Agentenseite hat sie noch nicht**, ohne sie kann kein Agent den Befehl bauen,
siehe `docs/OFFEN-v3.5.md` §2.3.

### 13.3 `BEFEHLSFELDER` wächst um `workflowId` und `params`

Zu E18, Festlegung 2.

| Feld | Form | Wozu |
|---|---|---|
| `workflowId` | `^wf_[a-z0-9_]{1,40}$` | Welcher Ablauf abgespielt wird |
| `params` | flaches Objekt, ausschliesslich Zeichenketten, höchstens 20 Einträge zu je 200 Zeichen | Die Werte für die Platzhalter des Ablaufs |

**Der Ablauf heisst `workflowId` und ausdrücklich nicht `id`.** Der
Befehlsrahmen trägt `id` bereits als Korrelationskennung des Auftrags, unter der
der Relay auf die Antwort wartet (§5.4, `befehls_id`, höchstens 64 Zeichen, 409
bei Doppelbelegung). Beide lägen im selben flachen Rahmen: Wer den Ablauf
ebenfalls `id` nennt, überschreibt die Kennung des Auftrags, und wer sie
weglässt, bekommt seine servergenerierte Auftragskennung gegen
`^wf_[a-z0-9_]{1,40}$` gehalten und eine Absage. Der Befehl wäre in keiner
Fassung aufrufbar gewesen. Gefunden am 14.08.2026 beim Bauen.

Die Erweiterung nimmt `workflowId`, wenn es dasteht, sonst `id`. Die zweite
Lesart bleibt für den lokalen Weg aus der Seitenleiste, auf dem es keine zweite
Kennung gibt.

Zahlen und Wahrheitswerte in `params` werden **abgelehnt und nicht umgedeutet**.
Das ist derselbe Befund wie bei `scroll` am 29.07.2026: Wer `12345` still zu
`"12345"` macht, bekommt beim nächsten Mal `null` und tippt „null" in ein
Formularfeld.

### 13.4 Der Befehlsrahmen trägt ein Serverfeld `agent`

Zu §5.4 (Rahmen im Betrieb).

```json
{ "id": "c-7", "cmd": "navigate", "agent": "SMarTrCEO", "url": "https://geizhals.de/x" }
```

`agent` nennt den Agenten, in dessen Namen der Befehl läuft. **Er kommt vom
Relay, nie aus dem Rumpf des Aufrufers**, denn ein Name aus dem Rumpf wäre eine
Selbstauskunft und damit keine Auskunft. Quelle ist der aufrufende Dienst
beziehungsweise der Anspruch `agent` im Bridge-Token aus E17, gesäubert auf
`[A-Za-z]{1,32}`, sonst leer.

Die Erweiterung hält den Namen gegen ihre eigene Positivliste. Was nicht darauf
steht, wird mit `agent_not_permitted` abgelehnt und nicht auf gut Glück
ausgeführt. **Ein Rahmen ohne `agent` läuft weiter**, und zwar ausdrücklich: §6
lässt auch den Alltags-Ausweis des Sitzungseigentümers als Befehlsausweis zu,
und der trägt keinen Agentennamen. Dort fährt der Mensch selbst.

*Stand der Umsetzung:* Das Bridge-Token trägt den Anspruch seit dem 15.08.2026:
Das Gateway signiert `agent="SMarTrBrowser"` im Profil smartr-browser, der Relay
trägt ihn in jeden Befehlsrahmen, und der Name steht seit Fassung 0.6.1 auf der
Positivliste der Erweiterung (`src/net/matrix.js`, `AGENTEN`). Die Agentenmatrix
gilt für ihn wie für jeden anderen Namen, ab Werk ist sie leer.

### 13.5 Neue Fehlerkennungen der Erweiterung

Zu §5.5. Sie gehen an den Agenten und stehen damit hier.

| Kennung | Bedeutung | wiederholbar |
|---|---|---|
| `element_covered` | Über dem Ziel liegt ein anderes Element, geklickt wird nicht | ja |
| `guardrail_blocked` | Harte Aktionsklasse, Host auf der Sperrliste oder Ablehnung | nein |
| `step_limit` | Das Schrittlimit des Auftrags ist erreicht, der Mensch wird gefragt | nein |
| `loop_detected` | Dieselbe Aktion auf demselben Seitenzustand, dreimal | nein |
| `agent_not_permitted` | Die Matrix erlaubt diesem Agenten das hier nicht | nein |
| `workflow_not_found` | Kein Ablauf mit dieser Kennung | nein |
| `workflow_step_failed` | Ein Schritt des Ablaufs ist gescheitert | nein |

`workflow_step_failed` ist eine Einladung und kein Endpunkt: Der Rahmen trägt in
`data` die Nummer des Schrittes, seinen Typ, die Beschreibung des gesuchten
Elements, die Anker und den aktuellen Textbaum, damit der Agent selbst ein Ziel
benennen kann. Eine Absage, die nur „Schritt 4 ist gescheitert" sagt, macht aus
einem verschobenen Knopf einen verlorenen Ablauf.

**Nachtrag 14.08.2026 (Festlegung F3), `data.stepError.code`.** Der äussere Code
bleibt in jedem Fall `workflow_step_failed`. Woran ein Schritt gescheitert ist,
steht in `data.stepError.code`, und dort gibt es seit v3.5 zwei Kennungen für
die Ankersuche:

| `stepError.code` | Bedeutung | was dem Agenten hilft |
|---|---|---|
| `kaskade_gebrochen` | Kein Anker des Schrittes trifft noch ein Element | Eine neue Referenz aus dem mitgelieferten Textbaum benennen |
| `kaskade_falsches_ziel` | Ein Anker trifft, aber ein ANDERES Element als das aufgezeichnete | Die fremde Seite ist umgebaut, der Schritt gehört neu aufgezeichnet |

Warum zwei Namen und nicht einer: Bei der einen Lage hilft eine neue Referenz,
bei der anderen nicht. Beides unter einem Namen zu melden hiesse, dem Agenten
zwei sehr verschiedene Lagen als dieselbe zu verkaufen — und ein Ablauf, der
zuverlässig das Falsche trifft, ist gefährlicher als einer, der abbricht.

Zusätzlich kann `meta` die Warnung `injection_suspected` tragen. Sie steht
absichtlich **nicht** im Fehler: Der Schritt hat stattgefunden, das Gelesene ist
echt, und nur seine Herkunft ist verdächtig. Der Modus `auto` fällt dabei auf
`assist` zurück, die Sitzung endet nicht. Das gemeldete Muster ist immer eines
aus unserer eigenen Liste, nie der Fremdtext, in dem es stand.
