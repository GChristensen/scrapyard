// <iframe> and <frame> in the output. The serializer walks the child document into its own output array and
// hands the text to the sink; this module holds the element-level fallbacks.

import {unsavedOf} from "./common.js";

/**
 * A frame element whose document could not be captured (depth cap, unresolvable, snapshot missing).
 * An iframe keeps its srcdoc/src semantics with the src blanked (as today); a frame gets an unsaved src.
 * @param {Element} el
 * @param {import("../core/tag.js").Tag} tag
 * @param {import("../context.js").CaptureContext} ctx
 */
export function emitFrameFallback(el, tag, ctx) {
    const src = el.getAttribute("src");

    if (!src)
        return;

    if (el.localName === "iframe") {
        tag.preserve("src");
        tag.set("src", "");
    }
    else
        tag.replace("src", unsavedOf(src, ctx));
}

/**
 * The manifest entry of a captured frame.
 * @param {import("../context.js").CaptureContext} childCtx
 * @returns {{key: string, url: string, path?: string, crossOrigin?: boolean}}
 */
export function frameManifestEntry(childCtx) {
    const entry = {key: childCtx.frameKey, url: childCtx.baseURI};

    if (childCtx.documentPath)
        entry.path = childCtx.documentPath;

    if (childCtx.crossFrame)
        entry.crossOrigin = true;

    return entry;
}

/** @type {import("../../shared/types.js").ElementRule[]} */
export const frameRules = [];
