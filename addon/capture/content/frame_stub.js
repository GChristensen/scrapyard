// Classic script injected into all frames: loads the per-frame listener as ES modules.
import(chrome.runtime.getURL("capture/content/frame_entry.js")).then(() => true);
