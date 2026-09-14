if (typeof browser === "undefined")
    globalThis.browser = chrome;

const _MANIFEST = chrome.runtime.getManifest();

globalThis._ADDON_VERSION = _MANIFEST.version;

globalThis._MANIFEST_VERSION = _MANIFEST.manifest_version;

globalThis._MANIFEST_V3 = globalThis._MANIFEST_VERSION === 3;

globalThis._BACKGROUND_PAGE = !!_MANIFEST.background?.page;

globalThis._SIDEBAR = !!globalThis.browser.sidebarAction;

globalThis._SIDE_PANEL = !globalThis._SIDEBAR && !!globalThis.browser.sidePanel;

globalThis._log = console.log.bind(console);

globalThis._tm = (name = "timer") => console.time(name);

globalThis._te = (name = "timer") => console.timeEnd(name);

globalThis._tr = console.trace.bind(console);
