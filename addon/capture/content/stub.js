// Classic script injected into the top frame: loads the engine as ES modules.
// The completion value must be structured-clonable, so the module namespace is never returned.
import(chrome.runtime.getURL("capture/content/entry.js")).then(() => true);
