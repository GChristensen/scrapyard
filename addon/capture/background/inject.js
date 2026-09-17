// Script injection. The stubs are the only engine files passed to executeScript; each one loads its ES module
// graph with import() and evaluates to a promise, so executeScript resolves only after the listeners exist.

const POLYFILL = "lib/browser-polyfill.js";
const FONTFACE = "capture/content/fontface.js";
const FRAME_STUB = "capture/content/frame_stub.js";
const STUB = "capture/content/stub.js";

function hasBackgroundPage() {
    try {
        return !!browser.runtime.getManifest().background?.page;
    }
    catch (e) {
        return true;
    }
}

/**
 * @param {number} tabId
 * @param {string} file       extension-relative path without a leading slash
 * @param {{allFrames?: boolean, frameId?: number}} target
 */
async function execute(tabId, file, target) {
    if (browser.scripting) {
        const scriptTarget = {tabId};

        if (target.allFrames)
            scriptTarget.allFrames = true;
        else
            scriptTarget.frameIds = [target.frameId ?? 0];

        return browser.scripting.executeScript({target: scriptTarget, files: [file]});
    }

    const details = {file: "/" + file};

    if (target.allFrames)
        details.allFrames = true;
    else
        details.frameId = target.frameId ?? 0;

    return browser.tabs.executeScript(tabId, details);
}

/**
 * Injects a file into every frame of the tab one frame at a time, so a frame that refuses injection (an extension
 * page such as the site-capture dialog, a sandboxed or privileged frame) does not fail the others.
 * @param {number} tabId
 * @param {string} file
 */
async function executeInAllFrames(tabId, file) {
    let frames = null;

    try {
        frames = await browser.webNavigation.getAllFrames({tabId});
    }
    catch (e) {
        /* no webNavigation: fall back to one call */
    }

    if (!Array.isArray(frames) || frames.length === 0) {
        try {
            await execute(tabId, file, {allFrames: true});
        }
        catch (e) {
            console.error(e);
        }

        return;
    }

    await Promise.all(frames.map(frame =>
        execute(tabId, file, {frameId: frame.frameId}).catch(() => { /* inaccessible frame */ })));
}

/**
 * Injects the per-frame listener into every frame of the tab (idempotent).
 * @param {number} tabId
 */
export async function injectFrameScripts(tabId) {
    if (!hasBackgroundPage())   /* Chrome: the polyfill provides the promise-based browser API */
        await executeInAllFrames(tabId, POLYFILL);

    await executeInAllFrames(tabId, FRAME_STUB);
}

/**
 * Injects everything a capture needs: polyfill (Chrome), FontFace interceptor and per-frame listener into all
 * frames, the engine entry into the top frame (idempotent). Only a failure in the top frame rejects.
 * @param {number} tabId
 */
export async function injectCaptureScripts(tabId) {
    if (!hasBackgroundPage()) {
        await execute(tabId, POLYFILL, {frameId: 0});
        await executeInAllFrames(tabId, POLYFILL);
    }

    await executeInAllFrames(tabId, FONTFACE);
    await executeInAllFrames(tabId, FRAME_STUB);
    await execute(tabId, STUB, {frameId: 0});
}
