# VERTRAG SMarTrChrome v3.5

**Verbindlich fuer die Bauarbeit v3.5. Stand 14.08.2026.**

Warum es dieses Dokument gibt: Am 26./27.07.2026 haben drei Seiten gleichzeitig
gebaut und sich die Feldnamen jeweils selbst ausgesucht; die Gegenprobe fand
fuenf belegte Bruchstellen. Diesmal bauen ACHT Seiten gleichzeitig. Also steht
vorher fest, wer welche Datei anfasst und wie die Namen heissen.

`DRAHTFORMAT.md` bleibt die Wahrheitsquelle fuer alles, was ueber die Leitung
geht. Dieses Dokument ergaenzt es um das, was v3.5 neu einfuehrt, und
widerspricht ihm nirgends.

---

## 1. Dateibesitz — wer schreibt was

**Reihenfolge:** A-REGELN laeuft **allein und zuerst**. Jede andere Datei
importiert aus `befehle.js`, `matrix.js`, `werkstatt.js` oder
`protokollbuch.js`; wuerde daran gleichzeitig gebaut, pruefte jeder gegen einen
Stand, den es zehn Sekunden spaeter nicht mehr gibt. Danach laufen die sieben
uebrigen Gebiete gleichzeitig, weil sie sich nicht mehr beruehren.

**Regel ohne Ausnahme: Niemand schreibt in eine Datei, die ihm nicht gehoert.**
Wer etwas in fremdem Gebiet braucht, verlaesst sich auf die hier festgelegte
Schnittstelle und meldet die Abweichung im Bericht, statt sie selbst zu
reparieren.

| Kuerzel | Besitzt ausschliesslich |
|---|---|
| **A-REGELN** (Stufe 0, laeuft ALLEIN und ZUERST) | `src/net/befehle.js`, `src/net/matrix.js` (NEU), `src/net/werkstatt.js` (NEU), `src/net/protokollbuch.js` (NEU), `src/pruefung/befehle.test.mjs`, `src/pruefung/matrix.test.mjs` (NEU), `src/pruefung/werkstatt.test.mjs` (NEU), `src/pruefung/protokollbuch.test.mjs` (NEU) |
| **A-AUSFUEHRER** | `src/net/ausfuehrer.js`, `src/pruefung/ausfuehrer.test.mjs`, `src/pruefung/ausfuehrer-bereichswache.test.mjs` |
| **A-KLICKWACHE** | `src/content/klickwache.js` (NEU), `src/content/overlay.js`, `src/net/seite.js`, `src/pruefung/overlay.test.mjs`, `src/pruefung/klickwache.test.mjs` (NEU) |
| **A-REKORDER** | `src/content/selektor.js` (NEU), `src/content/rekorder.js` (NEU), `src/pruefung/selektor.test.mjs` (NEU), `src/pruefung/rekorder.test.mjs` (NEU) |
| **A-BRUECKE** | `src/net/link.js`, `src/background/worker.js`, `src/pruefung/bruecke.test.mjs` (NEU) |
| **A-PANEL** | `src/panel/panel.html`, `src/panel/panel.css`, `src/panel/panel.js`, `src/panel/erklaerungen.js`, `src/pruefung/seitenleiste.test.mjs` |
| **A-WERKBANK** | `src/panel/startseite.js` (NEU), `src/panel/werkbank.js` (NEU), `src/pruefung/startseite.test.mjs` (NEU), `src/pruefung/werkbank.test.mjs` (NEU) |
| **A-RELAY** | `/home/tongie/smartrbrowser/server/app.py`, `/home/tongie/smartrbrowser/server/test_connect.py` |
| **A-SPRACHE** (Stufe 3) | `_locales/**`, `src/panel/sprache.js` (NEU), `manifest.json`, `src/pruefung/sprache.test.mjs` (NEU) und die i18n-Auszeichnung in ALLEN Oberflaechendateien |
| **A-DOKU** (Stufe 4) | `README.md`, `CHANGELOG.md`, `docs/**` |

### 1.1 Gemeinsames Werkzeug, das NIEMANDEM gehoert

`src/pruefung/chrome-attrappe.mjs` ist bereits aufgeruestet und wird von keinem
Bau-Agenten mehr angefasst. Sie kann ab jetzt:

- **echte Ablage**: `storage.session` und `storage.local` speichern wirklich,
  getrennte Toepfe, `get` mit Zeichenkette / Liste / Voreinstellungsobjekt /
  ohne Angabe, dazu `set`, `remove`, `clear`. Startinhalt ueber `ablageSession`
  und `ablageLocal`.
- `tabs.query` ueber `alleTabs`, plus `onUpdated`, `onRemoved`, `onActivated`
- `chrome.action` (Abzeichen und Titel), `chrome.notifications`
- `chrome.i18n.getMessage` mit eigenem Katalog ueber `katalog`

Alles landet in `spur`, wie gehabt. Wer trotzdem etwas vermisst, baut es
**lokal in seiner eigenen Pruefdatei** nach und meldet es im Bericht.

`manifest.json` gehoert bis Stufe 3 NIEMANDEM. Wer eine neue Berechtigung
braucht, schreibt sie in seinen Bericht; A-SPRACHE traegt sie nach.

---

## 2. Betriebsmodi

```js
// src/net/befehle.js
export const MODI = Object.freeze(["manual", "assist", "auto"]);
export const MODUS_STANDARD = "assist";
```

Der Modus gilt **je Tab**, nicht global. Ablage `chrome.storage.session`,
Schluessel `sa_modus`, Form:

```json
{ "version": 1, "tabs": { "42": "assist" }, "schritte": { "42": 3 }, "grenze": 50 }
```

Er stirbt mit dem Browser. Ein Modus, der einen Neustart ueberlebt, waere eine
Vollmacht, an die sich niemand erinnert.

**Nachtrag 14.08.2026 (Verzahnung), Bedeutung der Felder:** `schritte` je Tab
ist der bisher VERBRAUCHTE Zaehler, `grenze` das in der Seitenleiste
eingestellte Schrittlimit (§5, gedeckelt auf `GRENZEN.schritteDeckel` = 500).
Das stand vorher nicht da, und es standen zwei Fassungen derselben Ablage
nebeneinander: Fuer `background/worker.js` war `schritte[42]` das eingestellte
Limit, fuer `net/ausfuehrer.js` der Zaehler. Wer in der Seitenleiste 200
Schritte einstellte, schrieb damit „200 Schritte sind schon gelaufen", und der
naechste Befehl waere mit `step_limit` gestorben. Ab jetzt gilt:

**Gelesen und geschrieben wird `sa_modus` ausschliesslich in
`src/net/ausfuehrer.js`** (`modusStand`, `modusSetzen`, `schrittZaehlen`). Der
Dienstarbeiter reicht `modus:setzen` und `modus:stand?` nur durch. Nach aussen,
in den Nachrichten aus §6, heisst das Limit weiterhin `schritte` — so liest es
die Seitenleiste.

---

## 3. Aktionsklassen

```js
// src/net/befehle.js
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
```

### 3.1 Der Klassifizierer

```js
/**
 * @param {string} cmd    Befehlsname aus BEFEHLE
 * @param {object} plan   geprueftes Ergebnis aus parameterPruefen
 * @param {object|null} ziel  {ref, name, rolle, rect, mitte} oder null
 * @param {object} kopf   {url, titel}
 * @returns {{klassen: string[], hart: string|null, weich: string[], grund: string}}
 */
export function klassenBestimmen(cmd, plan, ziel, kopf)
```

**Die Asymmetrie, die diesen Klassifizierer sicher macht, und die in einem
Pruefsatz stehen MUSS:** Er liest Text von der besuchten Seite (Elementnamen,
Adresse). Seitentext wird gemessen, nicht geglaubt — deshalb darf ein Treffer
ausschliesslich **mehr** Rueckfrage ausloesen, niemals weniger. Ein Fehlalarm
kostet eine Rueckfrage. Ein uebersehener Treffer faellt auf das zurueck, was der
Modus ohnehin getan haette. Keine Zeile in diesem Klassifizierer darf eine
Freigabe erteilen.

Erkennungsgrundlage: `saeubern()`, kleingeschrieben, Wortlisten **deutsch und
englisch**. Die Listen stehen als benannte Konstanten (`WORTE_ZAHLUNG`,
`WORTE_UNWIDERRUFLICH`, …), damit ein Pruefsatz sie wortweise messen kann.

| Klasse | Loest aus bei |
|---|---|
| `lesen` | `readPage`, `snapshot`, `get_state`, `scroll`, `extract`, `waitFor`, `screenshot`, `highlight` |
| `bedienen` | `click`, `type`, `select` |
| `navigieren` | `navigate`, `back` |
| `geheim` | `type` in ein Feld mit Rolle/Name aus `WORTE_GEHEIM` (passwort, password, pin, otp, 2fa, einmalcode, tan, cvv, code); `click` auf ein Element in einem Formular, das ein Geheimfeld enthaelt (Anmelde-Absenden) |
| `zahlung` | Name oder Adresspfad trifft `WORTE_ZAHLUNG` (kasse, checkout, bezahlen, kaufen, bestellen, ueberweisen, pay, order, purchase, iban) |
| `unwiderruflich` | `WORTE_UNWIDERRUFLICH` (loeschen, entfernen, kuendigen, schliessen, deaktivieren, widerrufen, delete, remove, cancel, deactivate, terminate) |
| `datei` | Ziel ist `input[type=file]`, oder Name/Adresse trifft `WORTE_DATEI` (download, herunterladen, hochladen, upload, datei waehlen) |
| `berechtigung` | `WORTE_BERECHTIGUNG` (kamera, mikrofon, standort, benachrichtigung, camera, microphone, location, notification) in Verbindung mit `zulassen`/`erlauben`/`allow` |
| `captcha` | Ziel oder Adresse trifft `WORTE_CAPTCHA` (captcha, recaptcha, hcaptcha, turnstile, „ich bin kein roboter", „i am not a robot") |
| `senden` | `click` auf `WORTE_SENDEN` (senden, absenden, abschicken, veroeffentlichen, posten, kommentieren, antworten, send, submit, post, publish, reply, tweet) |
| `formular` | `type` mit `absenden: true`; `click` auf ein Element mit Rolle `button` und `type=submit` |
| `tab_neu` | reserviert; heute traegt kein Befehl diese Klasse. Sie steht im Vertrag, weil die Einstellungsmatrix sie zeigt und eine Matrix mit einem toten Schalter luegt. Ein Pruefsatz haelt fest, dass sie heute nie ausgeloest wird. |

`captcha` ist ein Sonderfall und wird als solcher behandelt: Ein Treffer heisst
**nie** „automatisch loesen", sondern immer „an den Menschen uebergeben". Der
Ausfuehrer sagt bei `captcha` auch nach einem Ja nichts weiter zu, als den Zeiger
zu setzen.

### 3.2 Die Entscheidungstabelle

```js
/**
 * @returns {{fragen: boolean, sperren: boolean, code: string|null, grund: string}}
 */
export function freigabeNoetig(modus, befund, regeln)
// regeln = { gesperrt: boolean, frei: string[] }  (aus net/matrix.js, je Host)
```

| Lage | `manual` | `assist` | `auto` |
|---|---|---|---|
| Host auf der Sperrliste | fragen | fragen (faellt auf `manual`) | fragen (faellt auf `manual`) |
| harte Klasse | fragen | fragen | **fragen** |
| weiche Klasse, Domain NICHT freigeschaltet | fragen | fragen | fragen |
| weiche Klasse, Domain freigeschaltet | fragen | fragen | durchlaufen |
| `bedienen` / `navigieren` | fragen | durchlaufen | durchlaufen |
| `lesen` | fragen | durchlaufen | durchlaufen |

Der Unterschied zwischen `assist` und `auto` ist damit genau einer: `auto` laesst
die je Domain freigeschalteten weichen Klassen durch. Sonst nichts. Wer das
Etikett `auto` liest, soll nicht mehr bekommen, als es verspricht.

---

## 4. Domainregeln und Agentenmatrix — `src/net/matrix.js`

Ablage `chrome.storage.local`, Schluessel `sa_matrix`. `local` und nicht
`session`, weil eine Einstellungsmatrix ihren Sinn verliert, wenn sie bei jedem
Browserstart leer ist. Sie enthaelt **keine** Ausweise und **keine** Tokens.

```json
{
  "version": 1,
  "domains": {
    "ebay.de": { "frei": ["senden", "formular"] }
  },
  "gesperrt": ["*.sparkasse.de", "bank.de"],
  "agenten": {
    "SMarTrTrader": { "tradingview.com": ["lesen"] },
    "SMarTrCEO":    { "ebay.de": ["lesen", "bedienen", "workflow"] }
  }
}
```

```js
export const AGENTEN = Object.freeze([
  "SMarTrCEO", "SMarTrItgott", "SMarTrMarketing", "SMarTrContent",
  "SMarTrHRGott", "SMarTrTrader", "SMarTrInfluencer", "SMarTrSocialMedia",
  "SMarTrPenTester",
]);

export async function matrixLesen()                     // -> Objekt oben, immer vollstaendig
export async function matrixSchreiben(neu)              // prueft gegen Schema, wirft nie
export async function regelnFuer(host)                  // -> { gesperrt: boolean, frei: string[] }
export async function agentDarf(agent, host, klasse)    // -> boolean, Voreinstellung FALSE
export function hostMuster(muster, host)                // Platzhalter `*.` nur ganz vorn
```

**Voreinstellung: alles aus.** `agentDarf` gibt fuer einen unbekannten Agenten,
einen unbekannten Host oder eine unbekannte Klasse `false` zurueck. Eine Matrix,
die im Zweifel erlaubt, ist keine.

---

## 5. Schrittlimit, Schleife, Not-Aus

```js
// src/net/befehle.js, in GRENZEN ergaenzen
schritteJeAuftrag: 50,   // konfigurierbar in der Seitenleiste, Deckel 500
schleifeGleich: 3,       // identische Aktion auf identischem Zustand
schrittFristMs: 60000,   // Zeitablauf je Schritt im Auftrag
```

Der Fingerabdruck eines Schrittes, an dem die Schleife erkannt wird:

```js
export function schrittMarke(cmd, plan, kopf, bildlauf)
// -> `${cmd}|${stabilJson(plan)}|${kopf.url}|${bildlauf.y}`
```

Drei gleiche Marken hintereinander → **anhalten und fragen**, in JEDEM Modus,
Fehlercode `loop_detected`. Ein Auftrag, der sich im Kreis dreht, wird nicht
schneller, wenn man ihn laufen laesst.

### Not-Aus

Der Weg heisst weiterhin `notbremse` (Bestand: Esc Esc im Inhaltsskript,
`Alt+Umschalt+S` als Tastenkuerzel, `link.trennen("notbremse")`). Neu kommt
dazu:

- `src/net/ausfuehrer.js` exportiert `laufAbbrechen()`: setzt `aktiv = false`,
  zaehlt `generation` hoch, beantwortet alle wartenden Befehle mit
  `session_beendet` und leert die Warteschlange.
- `src/net/link.js` ruft in `trennen()` zuerst `laufAbbrechen()`, dann den
  Widerruf beim Relay, dann `protokollbuch.eintragen()`.
- Der Stoppknopf steht in der Seitenleiste **und** als Schild im Tab
  (`overlay:notaus-knopf`, sendet `notbremse` mit `quelle: "schild"`).

**Zusage, die ein Pruefsatz messen muss:** Zwischen dem Ereignis und dem
Zustand „nichts laeuft mehr" liegt weniger als eine Sekunde, und zwar ohne auf
eine Antwort des Relays zu warten. Erst kappen, dann melden.

---

## 6. Nachrichten zwischen den Teilen

Neue Namen, alle mit Praefix, damit sie nicht mit dem Bestand kollidieren.

| Nachricht | Von → Nach | Nutzlast |
|---|---|---|
| `modus:setzen` | Panel → Worker | `{ tabId, modus }` |
| `modus:stand?` | Panel → Worker | `{ tabId }` → `{ modus, schritte }` |
| `link:protokoll` | Ausfuehrer → Panel | **erweitert**: `{ text, cmd, zeit, ergebnis }` (`zeit` = ms seit Epoche; `text` bleibt Pflicht und abwaertskompatibel) |
| `link:cloud-sitzung` | Bruecke → Panel | `{ an, agent }` |
| `link:notaus` | Panel → Worker | `{ grund }` |
| `overlay:modus` | Ausfuehrer → Seite | `{ modus }` — faerbt Rahmen und Schild |
| `overlay:notaus-knopf` | Seite → Worker | `{ quelle: "schild" }` (als `notbremse`) |
| `rekorder:start` | Panel → Worker → Seite | `{ tabId }` |
| `rekorder:stop` | Panel → Worker → Seite | `{ tabId }` → `{ schritte: [...] }` |
| `rekorder:stand` | Seite → Panel | `{ anzahl, laeuft }` |
| `rekorder:bild` | Seite → Worker | `{ typ, name, nr, anlass: "user_request", rect }` |
| `werkbank:liste` | Panel → Worker | `{}` → `{ workflows: [...] }` |
| `werkbank:schreiben` | Panel → Worker | `{ workflow }` |
| `werkbank:loeschen` | Panel → Worker | `{ id }` |
| `werkbank:spielen` | Panel → Worker | `{ id, params }` |
| `buch:lesen` | Panel → Worker | `{ von, bis }` → `{ eintraege: [...] }` |
| `buch:ausgeben` | Panel → Worker | `{}` → `{ json }` |

Alle neuen Nachrichten an den Worker durchlaufen `ausEigenerOberflaeche()`.
Ohne Ausnahme. `notbremse`, `rekorder:stand` und `rekorder:bild` sind die
einzigen, die aus einem Tab kommen duerfen.

**Nachtrag 14.08.2026 (Verzahnung):** `rekorder:bild` kam bis dahin in dieser
Tabelle nicht vor, obwohl `content/rekorder.js` sie sendet. Sie darf aus einem
Tab kommen, weil sie nichts einstellt und nichts ausloest: Das Inhaltsskript
nennt Name, Nummer und Rechteck, die Aufnahme selbst macht der Ausfuehrer ueber
`captureVisibleTab` mit seiner Qualitaetsleiter. Der Tab kommt dabei von Chrome
(`absender.tab.id`) und ausdruecklich NICHT aus der Nutzlast, und der Ausfuehrer
prueft zusaetzlich, dass dieser Tab vorn steht: `captureVisibleTab` nimmt den
sichtbaren Tab eines Fensters auf, nicht den genannten. Die Bilder liegen in
`chrome.storage.local` unter `sa_rekorder_bilder`, gedeckelt auf 60 Bilder und
4 MiB; ein Bild, das nicht mehr passt, wird abgesagt und nicht halb gespeichert.

---

## 7. Teach-Modus

### 7.1 Selektor-Kaskade — `src/content/selektor.js`

Ein **klassisches Skript**, kein Modul. Es schreibt nach
`globalThis.SMARTR_SELEKTOR` und wird vor `rekorder.js` und vor `overlay.js`
eingespielt. Grund: Inhaltsskripte koennen `src/net/*.js` nicht importieren.
Genau daran ist die Verdeckungswache am 11.08. gescheitert — sie lag in einem
Modul, das niemand rufen konnte. Diese Bauform ist die Lehre daraus.

```js
globalThis.SMARTR_SELEKTOR = {
  /** @returns {string[]} Kaskade, staerkster Anker zuerst */
  kaskadeBauen(el),
  /** @returns {{ok:true, el} | {ok:false, fehler:string}} */
  kaskadeAufloesen(kaskade, wurzel = document),
};
```

Reihenfolge der Kaskade, verbindlich:

1. `[data-testid="…"]`, `[data-test="…"]`, `[data-cy="…"]`, sonstige `data-*`
2. `[aria-label="…"]` zusammen mit der Rolle
3. stabiler CSS-Pfad (id, dann Klassen ohne Zufallsanteil, hoechstens 4 Ebenen)
4. Textanker `text=…` (genauer Text, hoechstens 80 Zeichen)
5. XPath als letzter Ausweg

`kaskadeBauen` gibt **immer mindestens einen** Eintrag zurueck. Klassennamen mit
Zufallsanteil (`/[a-z]+-[a-z0-9]{5,}/`, Hash-artige Ketten) fliegen raus, sonst
bricht der Workflow beim naechsten Build der fremden Seite.

### 7.2 Aufzeichnung — `src/content/rekorder.js`

Ablage der LAUFENDEN Aufzeichnung: `chrome.storage.local`, Schluessel
`sa_rekorder` (Nachtrag 14.08.2026). `local` und nicht `session`, aus zwei
Gruenden: Eine Aufzeichnung fuehrt ueber Seitenwechsel, und dabei stirbt das
Inhaltsskript — es muss sich beim Wiedereinspielen selbst wiederfinden. Und
`chrome.storage.session` ist fuer Inhaltsskripte ohne `setAccessLevel`
verschlossen. Der Schluessel steht als `REKORDER_ABLAGE` in
`src/net/werkstatt.js`; `content/rekorder.js` traegt ihn als eigenes Literal,
weil ein Inhaltsskript `src/net/*.js` nicht importieren kann.

Einen **Browserstart** darf die Aufzeichnung nicht ueberleben: Danach ist das
Inhaltsskript weg, die Seitenleiste zu, und die Schritte gehoeren zu Seiten, die
niemand mehr offen hat. `background/worker.js` raeumt `sa_rekorder` und
`sa_rekorder_bilder` deshalb bei `onStartup` und `onInstalled` weg,
ausdruecklich NICHT bei jedem Start des Dienstarbeiters — MV3 beendet den im
Leerlauf, und eine laufende Aufzeichnung waere nach dreissig Sekunden weg.

Klassisches Skript. Zeichnet auf: `click`, `dblclick`, `input`, `change` auf
`select`, `scroll` (gedrosselt, 250 ms), `keydown` nur fuer Enter und Tab,
Navigation, sowie automatisch erkannte Wartezeiten (DOM 500 ms ruhig).

**Verbot ohne Ausnahme:** In ein Feld, das `geheim()` erfuellt (dieselbe Liste
wie `overlay.js`), wird **kein Wert** aufgezeichnet. An seiner Stelle entsteht
`{ "type": "user_input_required", "reason": "Login/2FA" }`. Der Rekorder liest
den Wert gar nicht erst aus, er ueberschreibt ihn nicht nachtraeglich.

### 7.3 Workflow-Format — `src/net/werkstatt.js`

Ablage `chrome.storage.local`, Schluessel `sa_workflows`.

```json
{
  "id": "wf_ebay_relist",
  "name": "eBay: Artikel neu einstellen",
  "beschreibung": "",
  "version": 1,
  "created": "2026-08-14T10:00:00Z",
  "params": ["artikelnummer"],
  "steps": [
    { "type": "navigate", "url": "https://www.ebay.de/…", "wait": "networkidle" },
    { "type": "click", "selector_cascade": ["[data-testid='relist']", "text=Erneut einstellen"], "screenshot": "s1.webp" },
    { "type": "input", "selector_cascade": ["#itemnr"], "value": "{{artikelnummer}}" },
    { "type": "user_input_required", "reason": "Login/2FA" }
  ]
}
```

```js
export function workflowPruefen(roh)   // -> {ok:true, workflow} | {ok:false, code, satz}
export async function workflowsLesen()
export async function workflowSchreiben(wf)
export async function workflowLoeschen(id)
export function platzhalterFuellen(wf, params)  // {{name}} -> Wert, unbekannt = Absage
```

Schritttypen: `navigate`, `click`, `dblclick`, `input`, `select`, `scroll`,
`key`, `wait`, `user_input_required`. Mehr nicht — eine offene Menge waere ein
Ausfuehrungspfad, den niemand geprueft hat.

**Die Wiedergabe geht durch dieselbe Befehlsschleife wie ein Agentenbefehl.**
Sie umgeht weder Modus noch Guardrails noch Bereichspruefung noch
Verdeckungswache. Ein Workflow ist eine Reihe von Befehlen, keine zweite Tuer.

### 7.4 Selbstheilung

Bricht die ganze Kaskade, entsteht `{ok:false, fehler:"kaskade_gebrochen"}`. Der
Ausfuehrer meldet dem Agenten `workflow_step_failed` **mit** der Beschreibung des
gesuchten Elements und dem gekuerzten Textbaum, damit der Agent selbst ein Ziel
benennen kann. Findet er eines, wird die neue Kaskade in den Workflow
zurueckgeschrieben — sichtbar, mit Zeitstempel im Protokollbuch.

---

## 8. Remote Bridge

### 8.1 Agentenkennung

Der Befehlsrahmen traegt neu `agent`. Er kommt vom Relay, nicht vom Client, und
wird gegen die Positivliste `AGENTEN` geprueft. Was nicht darin steht, ist kein
Agent: Der Befehl wird mit `agent_not_permitted` abgelehnt, nicht auf gut Glueck
ausgefuehrt.

### 8.2 Neuer Befehl `run_workflow`

```js
run_workflow: { stufe: "write", frist: 120000, freigabe: "schritt",
                tut: "einen gespeicherten Ablauf abspielen" },
```

Parameter: `{ workflowId: string, params: object }`. `parameterPruefen` prueft
die Kennung gegen `/^wf_[a-z0-9_]{1,40}$/` und die Platzhalter gegen
`wf.params`.

**Nachtrag 14.08.2026 (Verzahnung), Feldname:** Der Parameter heisst auf dem
Draht `workflowId` und nicht `id`. Grund: Der Befehlsrahmen traegt `id` bereits
als Korrelationskennung des Auftrags, unter der der Relay auf die Antwort
wartet, und beide liegen im selben flachen Rahmen. Wer den Ablauf ebenfalls `id`
nennt, ueberschreibt die Kennung des Auftrags. Der Ausfuehrer nimmt
`workflowId`, wenn es dasteht, sonst `id` — die zweite Lesart bleibt fuer den
lokalen Weg aus der Seitenleiste, auf dem es keine zweite Kennung gibt.
`DRAHTFORMAT.md` und die Werkzeugtabelle des Agenten fuehren den Namen nach
(A-RELAY, A-DOKU).

### 8.3 Protokollbuch — `src/net/protokollbuch.js`

Ablage `chrome.storage.local`, Schluessel `sa_protokollbuch`.

```js
export async function eintragen({ zeit, agent, cmd, url, ergebnis, klassen })
export async function lesen({ von = 0, bis = Infinity } = {})
export async function ausgeben()          // -> JSON-Zeichenkette zum Herunterladen
export async function aufraeumen(tage = 30)
export const AUFBEWAHRUNG_STANDARD_TAGE = 30;
```

Jede Fernaktion bekommt genau einen Eintrag: Zeitstempel, Agent, Kommando,
Zieladresse, Ergebnis. `aufraeumen()` laeuft am bestehenden 30-Sekunden-Wecker
mit. Die Adresse wird gespeichert, der Seiteninhalt **nicht** — Datenminimierung
ist hier keine Kuer, sondern der Grund, warum das Buch ueberhaupt gefuehrt werden
darf.

### 8.4 Sichtbarkeit

Laeuft eine Cloud-Sitzung, gilt alles drei gleichzeitig:

1. Dauerzeile in der Seitenleiste „Cloud-Sitzung aktiv: [Agentname]"
2. Abzeichen am Symbol
3. Eine System-Meldung beim **Start** der Sitzung (`chrome.notifications`,
   Berechtigung `notifications` noetig — A-BRUECKE meldet sie an A-SPRACHE)

Offline heisst Absage, nicht Warteschlange: Ein Steuerbefehl, der eine Stunde
spaeter ausgefuehrt wird, ist ein anderer Befehl.

---

## 9. Abwehr von Prompt-Einschleusung

```js
// src/net/befehle.js
export function einschleusungVerdacht(text)  // -> {verdacht: boolean, muster: string|null}
```

Muster (Liste als benannte Konstante, DE und EN): „ignore previous
instructions", „disregard all", „system prompt", „du bist jetzt", „vergiss alle
vorherigen", „neue anweisung", „act as", „you are now".

Ein Treffer im Textbaum haelt den Modus `auto` an, faellt auf `assist` zurueck
und sagt es dem Menschen. Er beendet die Sitzung **nicht** — eine Seite, die
diesen Text zeigt, kann auch schlicht ein Blogartikel ueber Einschleusung sein.

---

## 10. Neue Fehlercodes

Sie gehen an den Agenten und stehen damit im Drahtformat.

| Code | Bedeutung |
|---|---|
| `element_covered` | Ueber dem Ziel liegt ein anderes Element (Bestand, ab jetzt erreichbar) |
| `guardrail_blocked` | Harte Aktionsklasse, Host auf der Sperrliste oder Ablehnung |
| `step_limit` | Das Schrittlimit des Auftrags ist erreicht |
| `loop_detected` | Dieselbe Aktion auf demselben Zustand, dreimal |
| `agent_not_permitted` | Die Matrix erlaubt diesem Agenten das hier nicht |
| `workflow_not_found` | Kein Ablauf mit dieser Kennung |
| `workflow_step_failed` | Ein Schritt des Ablaufs ist gescheitert |
| `injection_suspected` | Einschleusungsmuster im Textbaum, `auto` angehalten |

---

## 11. Relay — `/home/tongie/smartrbrowser/server/app.py`

1. `REQUIRED["run_workflow"] = "write"`.
2. `befehlsrahmen_bauen` reicht `agent` durch. Quelle ist der aufrufende
   Dienst, gesaeubert auf `[A-Za-z]{1,32}`, sonst leer. Der Client prueft
   zusaetzlich gegen seine Positivliste.
3. `step_mode` kennt heute `auto` und `confirm_each`. Neu kommt `assist` dazu;
   unbekannte Werte fallen weiterhin auf `confirm_each`.
4. `AUTH_RAHMEN_VERBOTEN` bleibt unveraendert — der Client darf diese Felder
   weiterhin nicht selbst setzen.
5. Jede Aenderung bekommt einen Pruefsatz in `server/test_connect.py`.

**Nichts wird ausgeliefert.** A-RELAY aendert ausschliesslich die lokale Quelle
und schreibt eine Aenderungsliste. Der Gang nach Helsinki ist eine eigene
Entscheidung des Inhabers.

---

## 12. Sprache

- `manifest.json`: `"default_locale": "de"`, Name und Beschreibung ueber
  `__MSG_…__`.
- `_locales/de/messages.json` und `_locales/en/messages.json`, gleicher
  Schluesselsatz, keine Luecken.
- Schluessel: `^[a-z][a-z0-9_]*$`, Praefix nach Bereich (`kopf_`, `dialog_`,
  `freigabe_`, `modus_`, `werkbank_`, `buch_`, `fehler_`).
- HTML traegt `data-i18n="schluessel"` und
  `data-i18n-attr="aria-label:schluessel,title:schluessel"`.
  `src/panel/sprache.js` setzt beim Laden ein: `textEinsetzen(wurzel)`.
- Deutsch mit **echten Umlauten**. In der Oberflaeche Kommas statt
  Gedankenstrichen, weil vorgelesen wird.

**Ausdrueckliche Grenze:** Die Saetze, die an den **Agenten** gehen
(`ausfuehrer.js`, `befehle.js`), bleiben deutsch und unveraendert. Sie sind
Protokolltext, nicht Oberflaeche, und 372 Pruefsaetze messen sie woertlich. Eine
Uebersetzung wuerde jede dieser Messungen aufheben, ohne dass ein Mensch etwas
davon sieht. Das steht als Migrationshinweis in der Doku.

---

## 13. Was jede Bauarbeit einhaelt

1. **Kein Prueflauf ueber einer Funktion, die niemand ruft.** Wer eine Wache
   baut, weist im Bericht die Zeile nach, an der sie im Produktivweg gerufen
   wird. Das ist der Befund vom 11.08.2026 und die teuerste Lehre dieses
   Projektes.
2. `node --test "pruefung/*.test.mjs"` aus `src/` laeuft am Ende gruen. Die 372
   bestehenden Pruefsaetze bleiben gruen; wer einen aendern muss, begruendet es.
3. Kein `eval`, kein Fernladen von Code, keine neue Pflichtberechtigung ohne
   Meldung.
4. Kommentare in der Tonlage des Bestandes: Sie sagen **warum**, nicht was, und
   nennen Befunde mit Datum.
5. Kein Fehler wird geworfen, wo eine Antwort hingehoert.

*SMarTrAgents.ai by ₳K₳ŦØŇǤƗɆ with Fable 5*
