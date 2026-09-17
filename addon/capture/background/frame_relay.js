// Broadcasts capture.frames.request to every frame of a tab and aggregates the capture.frames.reply messages,
// counted against webNavigation.getAllFrames() with a timeout.

import {MESSAGE} from "../shared/constants.js";
import {log} from "../shared/log.js";

/** @typedef {import("../shared/types.js").FrameSnapshot} FrameSnapshot */

/** @type {Map<number, {replies: FrameSnapshot[], expected: number, finish: () => void}>} */
const collectors = new Map();

browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== MESSAGE.framesReply)
        return;

    const collector = collectors.get(sender?.tab?.id);

    if (!collector)
        return;

    collector.replies.push({
        key: message.key,
        url: message.url,
        html: message.html || "",
        fonts: message.fonts || [],
        index: message.index,
        links: message.links
    });

    if (collector.replies.length >= collector.expected)
        collector.finish();
});

/**
 * @param {number} tabId
 * @param {object} request
 * @param {{index?: boolean, links?: boolean}} [request.extras]
 * @param {boolean} [request.snapshot]   serialize each frame's document
 * @param {boolean} [request.annotate]   record live state into transient attributes
 * @param {number} [request.timeout]     ms
 * @returns {Promise<{frames: FrameSnapshot[], expected: number}>}
 */
export async function collectFrames(tabId, request) {
    if (collectors.has(tabId))
        collectors.get(tabId).finish();

    let expected = Infinity;

    try {
        const frames = await browser.webNavigation.getAllFrames({tabId});

        if (Array.isArray(frames) && frames.length > 0)
            expected = frames.length;
    }
    catch (e) {
        log("debug", "getAllFrames failed", e);
    }

    const timeout = Number.isFinite(request.timeout)? request.timeout: 1500;

    return new Promise(resolve => {
        const collector = {
            replies: [],
            expected,
            finish() {
                clearTimeout(timer);

                if (collectors.get(tabId) === collector)
                    collectors.delete(tabId);

                resolve({frames: collector.replies, expected: Number.isFinite(expected)? expected: collector.replies.length});
            }
        };

        const timer = setTimeout(() => collector.finish(), timeout);
        collectors.set(tabId, collector);

        const message = {type: MESSAGE.framesRequest, extras: request.extras || {}, snapshot: !!request.snapshot,
            annotate: !!request.annotate};

        Promise.resolve(browser.tabs.sendMessage(tabId, message)).catch(e => log("debug", "frames request", e?.message));
    });
}
