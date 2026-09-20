// Loads the addon module graph in Node with the browser surface stubbed, to see whether the
// circular imports around plugin_rdf_shelf.js blow up at module evaluation time.
const noop = () => {};
const listener = {addListener: noop, removeListener: noop, hasListener: () => false};

const chromeStub = new Proxy({
    runtime: {
        getManifest: () => ({version: "2.3.0.1", manifest_version: 3, background: {service_worker: "x.js"}}),
        getURL: p => "chrome-extension://stub/" + String(p).replace(/^\//, ""),
        onMessage: listener,
        onMessageExternal: listener,
        onInstalled: listener,
        connectNative: () => ({onMessage: listener, onDisconnect: listener, postMessage: noop}),
        id: "stub",
        getContexts: async () => [],
    },
    storage: {local: {get: async () => ({}), set: async () => {}, remove: async () => {}}, session: {onChanged: listener, get: async () => ({}), set: async () => {}}, onChanged: listener},
    windows: {onFocusChanged: listener, WINDOW_ID_CURRENT: -2},
    tabs: {onUpdated: listener, onRemoved: listener, onActivated: listener, onCreated: listener},
    bookmarks: {onCreated: listener, onRemoved: listener, onChanged: listener, onMoved: listener},
    alarms: {onAlarm: listener, create: noop},
    action: {setIcon: noop, setBadgeText: noop},
    contextMenus: {onClicked: listener, create: noop, removeAll: noop},
    notifications: {onClicked: listener, onButtonClicked: noop},
    commands: {onCommand: listener},
    webRequest: {onBeforeSendHeaders: listener, onHeadersReceived: listener},
    idle: {onStateChanged: listener},
    permissions: {contains: async () => true},
    i18n: {getMessage: () => ""},
}, {
    get(t, k) {
        if (k in t) return t[k];
        return new Proxy({}, {get: () => noop});
    }
});

globalThis.chrome = chromeStub;
globalThis.browser = chromeStub;
globalThis.self = globalThis;
globalThis.window = {location: {pathname: "/ui/sidebar.html"}, addEventListener: noop};
globalThis.localStorage = {getItem: () => null, setItem: noop, removeItem: noop};
globalThis.indexedDB = {open: () => ({}), databases: async () => []};


await import("./addon/global.js");

const target = process.argv[2] || "./addon/plugin_rdf_shelf.js";

try {
    const m = await import(target);
    console.log("LOADED OK:", target);
    console.log("  exports:", Object.keys(m).join(", ").slice(0, 200));
} catch (e) {
    console.log("FAILED:", target);
    console.log("  " + e.constructor.name + ": " + e.message);
    const frames = (e.stack || "").split("\n").slice(1, 6)
        .filter(l => l.includes("addon"));
    for (const f of frames) console.log("   " + f.trim());
}
