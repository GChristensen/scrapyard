// The host-facing API of the capture engine: captureTab(), unlockTab(), collectTabLinks().
// Importing this module registers the port server and the frame relay.

import {MESSAGE} from "../shared/constants.js";
import {normalizeOptions} from "../shared/options.js";
import {fromBase64} from "../shared/bytes.js";
import {log, setDebug} from "../shared/log.js";
import {injectCaptureScripts, injectFrameScripts} from "./inject.js";
import {openSession} from "./port_server.js";
import {collectFrames} from "./frame_relay.js";
import {loadResource} from "./fallback_loader.js";
import {createArchiveWriter} from "./file_writer.js";

/** @typedef {import("../shared/types.js").CaptureOptions} CaptureOptions */
/** @typedef {import("../shared/types.js").CaptureResult} CaptureResult */
/** @typedef {import("../shared/types.js").CaptureProgress} CaptureProgress */
/** @typedef {import("../shared/types.js").FileWriter} FileWriter */

export {setDebug as setCaptureDebug};

/**
 * @param {number} tabId
 * @param {object} request
 * @param {Partial<CaptureOptions>} request.options
 * @param {"packed"|"unpacked"} request.mode
 * @param {FileWriter} [request.writer]        required in unpacked mode
 * @param {string} [request.selection]
 * @param {{index?: boolean, links?: boolean}} [request.extras]
 * @param {AbortSignal} [request.signal]
 * @param {(p: CaptureProgress) => void} [request.onProgress]
 * @param {boolean} [request.debug]
 * @returns {Promise<CaptureResult>}
 */
export async function captureTab(tabId, request) {
    const options = normalizeOptions(request.options);
    const mode = request.mode === "unpacked"? "unpacked": "packed";

    if (mode === "unpacked" && !request.writer)
        throw new Error("A FileWriter is required in unpacked mode");

    const writer = request.writer? createArchiveWriter(request.writer): null;
    const signal = request.signal;

    const session = openSession(tabId, {
        progress: request.onProgress,

        load: payload => loadResource(payload, {
            incognito: options.incognito,
            allowPassiveMixedContent: options.allowPassiveMixedContent,
            writer,
            signal
        }),

        write: async payload => {
            if (!writer)
                throw new Error("No writer in packed mode");

            if (payload.kind === "resource") {
                const file = {mime: payload.mime, url: payload.url, hash: payload.hash};

                if (payload.encoding === "base64")
                    file.bytes = fromBase64(payload.data || "");
                else
                    file.text = payload.data || "";

                return writer.writeResource(file);
            }

            return writer.writeFile({path: payload.path, data: payload.data || "", mime: payload.mime});
        },

        collectFrames: payload => collectFrames(tabId, payload)
    });

    const onRemoved = removedId => {
        if (removedId === tabId)
            session.reject(new Error("The tab was closed during the capture"));
    };

    const onAbort = () => {
        session.notify(MESSAGE.abort, {});
        Promise.resolve(browser.tabs.sendMessage(tabId, {type: MESSAGE.abort}, {frameId: 0})).catch(() => {});
        const error = new Error("The capture was aborted");
        error.name = "AbortError";
        session.reject(error);
    };

    browser.tabs.onRemoved.addListener(onRemoved);
    signal?.addEventListener("abort", onAbort, {once: true});

    try {
        if (signal?.aborted)
            onAbort();

        await injectCaptureScripts(tabId);

        const ack = await browser.tabs.sendMessage(tabId, {
            type: MESSAGE.start,
            options,
            mode,
            selection: request.selection,
            extras: request.extras || {},
            debug: !!request.debug
        }, {frameId: 0});

        if (!ack || !ack.accepted)
            throw new Error("The capture was not accepted: " + (ack?.error || "no response from the content script"));

        const result = await session.promise;

        if (writer)
            await writer.flush();

        return result;
    }
    catch (e) {
        session.reject(e);
        throw e;
    }
    finally {
        browser.tabs.onRemoved.removeListener(onRemoved);
        signal?.removeEventListener("abort", onAbort);
        session.close();
    }
}

/**
 * Tells the content side to remove the lock overlay.
 * @param {number} tabId
 */
export async function unlockTab(tabId) {
    try {
        await browser.tabs.sendMessage(tabId, {type: MESSAGE.unlock}, {frameId: 0});
    }
    catch (e) {
        log("debug", "unlock", e?.message);
    }
}

/**
 * Injects the per-frame scripts and returns the outgoing links of every frame (site-capture options page).
 * @param {number} tabId
 * @param {number} [timeout]  ms
 * @returns {Promise<{url: string, links: Array<{url: string, text: string}>}>}
 */
export async function collectTabLinks(tabId, timeout = 1500) {
    await injectFrameScripts(tabId);

    const {frames} = await collectFrames(tabId, {extras: {links: true}, snapshot: false, annotate: false, timeout});
    const top = frames.find(frame => frame.key === "0");

    return {
        url: top? top.url: "",
        links: frames.flatMap(frame => frame.links || [])
    };
}
