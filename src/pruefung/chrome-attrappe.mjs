/*
 * Eine Attrappe der Chrome-Schnittstellen, so klein wie möglich.
 *
 * Sie ersetzt genau die Aufrufe, die der Ausführer wirklich macht — nicht
 * mehr. Was hier fehlt, fällt im Test als „ist keine Funktion" auf, und das
 * ist erwünscht: Eine Attrappe, die alles kann, verbirgt, was der Code
 * wirklich anfasst.
 *
 * Zwei Eigenschaften, auf die es ankommt:
 *
 *  1. `tabs.sendMessage` und `runtime.sendMessage` LEHNEN ab, wenn niemand
 *     zuhört — genau wie Chrome. Der Ausführer muss auch dann antworten.
 *  2. Jeder Aufruf wird protokolliert. Damit lässt sich prüfen, was NICHT
 *     passiert ist: dass eine abgelehnte Freigabe die Seite nie erreicht hat,
 *     dass ein Befehl außerhalb des Bereichs nie eingespielt wurde.
 */

export function attrappeSetzen({
  tab = { id: 7, url: "https://geizhals.de/warenkorb", title: "Warenkorb", active: true, status: "complete", windowId: 3 },
  seiteAntwortet = () => ({ ok: true }),
  panelAntwortet = null, // null = keine Seitenleiste offen
  /* Der Browser darf auch nein sagen. `browserSagtNein` ist die Menge der
     Aufrufe, die werfen sollen — so lässt sich prüfen, dass „kein Verlauf"
     (goBack) und „kein Bild" (captureVisibleTab) eine Aussage werden und nicht
     eine stille Erfolgsmeldung. */
  browserSagtNein = new Set(),
  /* …und er darf auch gar nicht antworten. `browserSchweigt` ist die Menge der
     Aufrufe, die nie zurückkommen. Damit lässt sich das letzte Netz prüfen: Der
     Wecker des Befehls muss eine Aussage liefern, auch wenn der Browser selbst
     hängt — sonst wartet der Agent bis zur Frist des Relays. */
  browserSchweigt = new Set(),
  /* Das Bild, das `captureVisibleTab` liefert. Auch eine FUNKTION der
     Aufnahmeangaben ist erlaubt: Ein echter Browser liefert bei niedrigerer
     Qualität ein kleineres Bild, und ohne diesen Zusammenhang ließe sich die
     Qualitätsleiter aus M7 nicht prüfen — eine feste Zeichenkette wäre bei
     jeder Stufe gleich groß und damit genau die Prüfung, die auch ohne den Fix
     grün bleibt. */
  bildDatenUrl = `data:image/jpeg;base64,${"A".repeat(64)}`,
  /* Die Vorgeschichte des Tabs. Leer heißt: `goBack` landet, wo es ist — das
     echte „es gibt nichts zurück" ist `browserSagtNein: ["goBack"]`, weil
     Chrome dort wirft statt still zu bleiben. */
  verlauf = [],
  /* Wo der Tab nach einem Wechsel WIRKLICH landet. Damit lässt sich prüfen,
     was der Ausführer nicht wissen kann, wenn er den Befehl absetzt: Eine
     Weiterleitung kann aus einer freigegebenen Adresse eine fremde machen. */
  umleitungNach = null,
} = {}) {
  const spur = [];
  const zurueck = Array.isArray(verlauf) ? [...verlauf] : [];
  const platzt = (name) =>
    browserSagtNein instanceof Set ? browserSagtNein.has(name) : !!(browserSagtNein || {})[name];
  const schweigt = (name) =>
    browserSchweigt instanceof Set ? browserSchweigt.has(name) : !!(browserSchweigt || {})[name];

  /* Ein Ereignisanschluss wie chrome.*.addListener — die Prüfung greift die
     registrierten Zuhörer über `_zuhoerer` ab und ruft sie selbst auf. */
  const ereignis = () => {
    const zuhoerer = [];
    return { addListener: (f) => zuhoerer.push(f), _zuhoerer: zuhoerer };
  };

  const chrome = {
    runtime: {
      id: "abcdefghijklmnopabcdefghijklmnop",
      getManifest: () => ({ version: "0.2.0", host_permissions: [] }),
      async sendMessage(nachricht) {
        spur.push({ wohin: "panel", nachricht });
        if (!panelAntwortet) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }
        return panelAntwortet(nachricht);
      },
      onInstalled: ereignis(),
      onStartup: ereignis(),
      onMessage: ereignis(),
      onMessageExternal: ereignis(),
    },
    tabs: {
      async get(tabId) {
        spur.push({ wohin: "tabs.get", tabId });
        if (!tab || tab.id !== tabId) throw new Error("No tab with id");
        return tab;
      },
      async create(angaben) {
        spur.push({ wohin: "tabs.create", angaben });
        return { id: 99, ...angaben };
      },
      /* Ortswechsel. Der Tab merkt sich die neue Adresse — sonst ließe sich
         nicht prüfen, dass der Ausführer NACH dem Wechsel noch einmal gegen
         den Bereich prüft. Der Ladezustand steht sofort auf "complete": Das
         Warten selbst hat seine eigene Prüfung, hier geht es um den Weg. */
      async update(tabId, angaben) {
        spur.push({ wohin: "tabs.update", tabId, angaben });
        if (platzt("update")) throw new Error("Cannot navigate");
        if (!tab || tab.id !== tabId) throw new Error("No tab with id");
        if (angaben && typeof angaben.url === "string") tab.url = angaben.url;
        if (umleitungNach) tab.url = umleitungNach;
        tab.status = "complete";
        return tab;
      },
      async goBack(tabId) {
        spur.push({ wohin: "tabs.goBack", tabId });
        if (platzt("goBack")) throw new Error("Cannot find a next page in history.");
        if (!tab || tab.id !== tabId) throw new Error("No tab with id");
        if (zurueck.length) tab.url = zurueck.pop();
        if (umleitungNach) tab.url = umleitungNach;
        tab.status = "complete";
        return undefined;
      },
      async captureVisibleTab(windowId, angaben) {
        spur.push({ wohin: "tabs.captureVisibleTab", windowId, angaben });
        if (platzt("captureVisibleTab")) throw new Error("Cannot access contents of the page");
        if (schweigt("captureVisibleTab")) return new Promise(() => {});
        return typeof bildDatenUrl === "function" ? bildDatenUrl(angaben || {}) : bildDatenUrl;
      },
      async sendMessage(tabId, nachricht) {
        spur.push({ wohin: "seite", tabId, nachricht });
        if (!tab || tab.id !== tabId) throw new Error("kein Empfänger");
        return seiteAntwortet(nachricht);
      },
    },
    sidePanel: {
      setPanelBehavior: async () => {},
    },
    commands: { onCommand: ereignis() },
    scripting: {
      async executeScript(auftrag) {
        spur.push({ wohin: "executeScript", auftrag });
        return [{ result: null }];
      },
    },
    storage: {
      session: { async get() { return {}; }, async set() {}, async remove() {} },
      local: { async get() { return {}; }, async set() {}, async remove() {} },
    },
    permissions: {
      async getAll() { return { origins: [] }; },
      async request() { return true; },
      async remove() { return true; },
    },
    alarms: { async create() {}, async clear() {}, onAlarm: ereignis() },
  };

  globalThis.chrome = chrome;
  return { chrome, spur };
}

/** Alles, was an die Seite ging — für Prüfungen der Art „ist nie passiert". */
export function anDieSeite(spur) {
  return spur.filter((e) => e.wohin === "seite").map((e) => e.nachricht.typ);
}

/** Alles, was an die Seitenleiste ging. */
export function anDasPanel(spur) {
  return spur.filter((e) => e.wohin === "panel").map((e) => e.nachricht.typ);
}
