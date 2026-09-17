// The frame table built from snapshots, and same-origin / cross-origin resolution of frame elements.

import {frameKeyAttribute} from "./frame_keys.js";
import {loadedFontsOf} from "./snapshot.js";
import {log} from "../shared/log.js";

/** @typedef {import("../shared/types.js").FrameSnapshot} FrameSnapshot */
/** @typedef {import("./context.js").CaptureContext} CaptureContext */

/**
 * @param {FrameSnapshot[]} snapshots
 * @returns {Map<string, FrameSnapshot>}
 */
export function buildFrameTable(snapshots) {
    const table = new Map();

    for (const snapshot of snapshots || [])
        if (snapshot && typeof snapshot.key === "string" && !table.has(snapshot.key))
            table.set(snapshot.key, snapshot);

    return table;
}

/**
 * @param {Element} el  iframe or frame element
 * @param {CaptureContext} ctx
 * @returns {boolean} the frame has no src (and no srcdoc for iframes): scripts are never saved inside
 */
export function noSrcFrameOf(el, ctx) {
    if (el.localName === "iframe")
        return ctx.noSrcFrame || (!el.getAttribute("src") && !el.getAttribute("srcdoc"));

    return ctx.noSrcFrame || !el.getAttribute("src");
}

/**
 * The child context of a frame element: the live document when same-origin, the parsed snapshot when
 * cross-origin (and the option allows), null otherwise or beyond the depth limit.
 * @param {Element} el
 * @param {CaptureContext} ctx
 * @returns {CaptureContext|null}
 */
export function resolveFrame(el, ctx) {
    if (ctx.depth >= ctx.options.maxFrameDepth)
        return null;

    const frameKey = frameKeyAttribute(el);
    const noSrcFrame = noSrcFrameOf(el, ctx);

    try {
        const doc = el.contentDocument;

        if (doc && doc.documentElement) {   /* in case the page is not fully loaded */
            return ctx.child({
                doc,
                win: el.contentWindow,
                frameKey: frameKey || (ctx.frameKey + "-u" + (ctx.run.unkeyedFrames++)),   /* created after injection */
                crossFrame: false,
                loadedFonts: ctx.crossFrame? []: loadedFontsOf(doc),
                noSrcFrame
            });
        }

        if (doc)
            return null;
    }
    catch (e) {
        /* cross-origin access */
    }

    if (!ctx.options.crossOriginFrames || !frameKey)
        return null;

    const snapshot = ctx.frames.get(frameKey);

    if (!snapshot || !snapshot.html) {
        log("debug", "no snapshot for frame", frameKey);
        return null;
    }

    const doc = new DOMParser().parseFromString(snapshot.html, "text/html");

    return ctx.child({
        doc,
        win: null,
        frameKey,
        crossFrame: true,
        loadedFonts: snapshot.fonts || [],
        noSrcFrame
    });
}
