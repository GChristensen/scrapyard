// Live-state snapshot and self-serialization of one frame document, run by every frame on request.

import {MARK} from "../shared/constants.js";

/**
 * Records state only the live document can provide into transient attributes:
 * CSS-in-JS rules, blob: images and videos, canvas pixels.
 * @param {Document} doc
 */
export function annotateLiveState(doc) {
    /* one traversal for all four element families; the branches are independent, so document order is fine */
    doc.querySelectorAll("style, img, video, canvas").forEach(element => {
        switch (element.localName) {
            case "style":
                annotateStyle(element);
                break;

            case "img":
                if (element.currentSrc.startsWith("blob:"))
                    annotateBlob(element);

                break;

            case "video":
                if (!element.hasAttribute("poster") && element.currentSrc.startsWith("blob:"))
                    annotateBlob(element);

                break;

            case "canvas":
                try {
                    const dataUrl = element.toDataURL("image/png", "");

                    if (dataUrl !== "")
                        element.setAttribute(MARK.canvasDataUri, dataUrl);
                }
                catch (e) {
                    /* tainted */
                }

                break;
        }
    });
}

/**
 * Records the divergent rules of a <style>, or marks it as checked-and-not-divergent. The negative result is
 * worth recording too: without it both passes recompute it, and the computation is a full CSS re-parse plus a
 * live insert and removal, i.e. two whole-document style invalidations (see divergentSheetRules).
 * @param {HTMLStyleElement} element
 */
function annotateStyle(element) {
    if (element.disabled)
        return;

    try {
        const rules = divergentSheetRules(element);

        element.setAttribute(rules != null? MARK.sheetRules: MARK.sheetChecked, rules != null? rules: "");
    }
    catch (e) {
        /* cross-origin sheet or no sheet: the passes fall back to textContent, which is what "checked" means */
        element.setAttribute(MARK.sheetChecked, "");
    }
}

function annotateBlob(element) {
    const dataUrl = createCanvasDataURL(element);

    if (dataUrl !== "")
        element.setAttribute(MARK.blobDataUri, dataUrl);
}

/**
 * The rules of a <style> element's sheet when they diverge from its textContent (CSS-in-JS libraries),
 * else null. Divergence is detected by instantiating a duplicate element with the same text and comparing
 * rule counts. Throws for cross-origin sheets.
 * @param {HTMLStyleElement} element
 * @returns {string|null}
 */
export function divergentSheetRules(element) {
    /* read the live rule count first: it throws for a cross-origin sheet, and the caller discards everything
       this function does in that case, so there is no point building the duplicate before finding out */
    const liveCount = element.sheet.cssRules.length;
    const doc = element.ownerDocument;
    const duplicate = doc.createElement("style");
    duplicate.textContent = element.textContent;
    doc.body.appendChild(duplicate);
    const duplicateSheet = duplicate.sheet;
    duplicate.remove();

    if (duplicateSheet.cssRules.length === liveCount)
        return null;

    const rules = element.sheet.cssRules;
    const parts = [];

    for (let i = 0; i < rules.length; i++)
        parts.push(rules[i].cssText, "\n");

    return parts.join("");
}

/**
 * @param {HTMLImageElement|HTMLVideoElement} element
 * @returns {string} PNG data URL of the element drawn on a canvas, or "" on a taint error
 */
export function createCanvasDataURL(element) {
    const canvas = element.ownerDocument.createElement("canvas");
    canvas.width = element.clientWidth;
    canvas.height = element.clientHeight;

    try {
        const context = canvas.getContext("2d");
        context.drawImage(element, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png", "");
    }
    catch (e) {
        return "";
    }
}

/**
 * @param {DocumentType|null} doctype
 * @returns {string} "<!DOCTYPE name[ PUBLIC "publicId"][ SYSTEM][ "systemId"]>" or ""
 */
export function serializeDoctype(doctype) {
    if (doctype == null)
        return "";

    return "<!DOCTYPE " + doctype.name
        + (doctype.publicId? " PUBLIC \"" + doctype.publicId + "\"": "")
        + ((doctype.systemId && !doctype.publicId)? " SYSTEM": "")
        + (doctype.systemId? " \"" + doctype.systemId + "\"": "")
        + ">";
}

/**
 * doctype + outerHTML with <base href="baseURI"> spliced right after the <head...> start tag.
 * @param {Document} doc
 * @returns {string}
 */
export function serializeDocument(doc) {
    let html = serializeDoctype(doc.doctype) + doc.documentElement.outerHTML;

    return html.replace(/<head([^>]*)>/, "<head$1><base href=\"" + doc.baseURI + "\">");
}

/**
 * @param {Document} doc
 * @returns {Array<{family: string, weight: string, style: string, stretch: string}>} fonts with status "loaded"
 */
export function loadedFontsOf(doc) {
    const result = [];

    try {
        doc.fonts.forEach(font => {
            if (font.status === "loaded")
                result.push({family: font.family, weight: font.weight, style: font.style, stretch: font.stretch});
        });
    }
    catch (e) {
        /* no CSS Font Loading API */
    }

    return result;
}

/**
 * Removes the transient snapshot attributes from a live document (best effort).
 * @param {Document} doc
 */
export function removeTransientAttributes(doc) {
    try {
        const selector = MARK.transient.map(name => "[" + name + "]").join(",");

        doc.querySelectorAll(selector).forEach(element => {
            for (const name of MARK.transient)
                element.removeAttribute(name);
        });
    }
    catch (e) {
        /* ignore */
    }
}
