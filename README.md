# SMarTrChrome

**SMarTrAgents im Browser — Mensch mit Maschine.**
Ein Chrome-Assistent, der deine Seite *sichtbar mitbedient*: Du übernimmst den
Login, der Agent macht den Rest, und **jeden einzelnen Schritt gibst du frei**.

> _SMarTrAgents in your browser. An agent that visibly operates the page
> together with you: you handle the login, it does the rest, and you approve
> every single step._

Teil der [smartragents.ai](https://smartragents.ai)-Plattform. Manifest V3.

---

## Was es kann

- **Sichtbar bedienen.** Ein Agentenzeiger fährt zu jedem Ziel, ein Ring zeigt
  den Klick, ein grüner Rahmen umgibt die gesteuerte Seite, und der Reiter trägt
  ein Zeichen. Du siehst jederzeit, *dass* und *wo* gearbeitet wird.
- **Lesen, blättern, zeigen, klicken, tippen, auswählen** — dreizehn Befehle,
  jeder einzeln bestätigt.
- **Antwortmodus** direkt im Chat: *Normal Mode* oder *SMarTrMode*.
- **Cookie-Banner** in offenen Shadow-DOMs werden erkannt und bedienbar.
- **Vorlesen** ist ein vollwertiger Bedienweg, nicht nur Beiwerk.

## Sicherheit zuerst

Das ist kein Zusatz, sondern die Bauordnung:

- **Jeder Schritt geht durch deine Freigabe.** Es gibt keinen Sammel-Freigeben-Knopf.
- **Jede Sitzung ist neu.** Es gibt keinen gespeicherten Zustand „verbunden",
  der einen Browserstart überlebt, und kein Recht, das über das Sitzungsende
  hinaus bestehen bleibt — browserseitig erzwungen über
  `chrome.permissions.request` / `remove`.
- **Passwörter, Kartendaten, Einmalcodes** liest und tippt der Agent nie.
  Anmelden bleibt deine Sache.
- **Ein abgelehnter Schritt bewegt nichts** auf der Seite.
- **Notbremse:** zweimal `Esc` oder `Alt+Umschalt+S` beendet sofort und gibt
  alle Rechte zurück.

## Installieren (Entwicklerfassung)

1. Dieses Verzeichnis herunterladen.
2. In Chrome `chrome://extensions` öffnen, **Entwicklermodus** einschalten.
3. **„Entpackte Erweiterung laden"** und diesen Ordner auswählen.
4. Auf [cloud.smartragents.ai](https://cloud.smartragents.ai) anmelden, dann in
   der Seitenleiste verbinden.

## Prüfen

Die Zusicherungen oben sind nicht nur beschrieben, sie sind geprüft:

```bash
cd src && node --test
```

Über 200 Prüfsätze, jeder so gebaut, dass er gegen die *halbe* Verschlechterung
rot wird — nicht nur gegen das Löschen. Sicherheit, die man nachmessen kann.

## Aufbau

```
manifest.json          Manifest V3
src/panel/             Die Seitenleiste (Niemand-Chat, Freigaben, Modus)
src/content/overlay.js Rahmen, Agentenzeiger und Wahrnehmung in der Seite
src/net/               Verbindung, Ausführer, Chat, Rechte
src/background/         Service Worker
src/pruefung/           node:test-Prüfsätze
```

---

MIT-Lizenz. Ein Werk von **smartragents.ai × Fable 5** (AKATONGIE).
Leitgedanke: **Mensch mit Maschine.**
