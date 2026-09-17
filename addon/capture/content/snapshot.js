// Live-state snapshot and self-serialization of one frame document, run by every frame on request.

import {MARK} from "../shared/constants.js";

/**
 * Records state only the live document can provide into transient attributes:
 * CSS-in-JS rules, blob: images and videos, canvas pixels.
 * @param {Document} doc
 */
export function annotateLiveState(doc) {
    doc.querySelectorAll("style").forEach(element => {
        if (element.disabled)
            return;

        try {
            const rules = divergentSheetRules(element);

            if (rules != null)
                element.setAttribute(MARK.sheetRules, rules);
        }
        catch (e) {
            /* cross-origin sheet or no sheet */
        }
    });

    doc.querySelectorAll("img").forEach(element => {
        if (element.currentSrc.startsWith("blob:")) {
            const dataUrl = createCanvasDataURL(element);

            if (dataUrl !== "")
                element.setAttribute(MARK.blobDataUri, dataUrl);
        }
    });

    doc.querySelectorAll("video").forEach(element => {
        if (!element.hasAttribute("poster") && element.currentSrc.startsWith("blob:")) {
            const dataUrl = createCanvasDataURL(element);

            if (dataUrl !== "")
                element.setAttribute(MARK.blobDataUri, dataUrl);
        }
    });

    doc.querySelectorAll("canvas").forEach(element => {
        try {
            const dataUrl = element.toDataURL("image/png", "");

            if (dataUrl !== "")
                element.setAttribute(MARK.canvasDataUri, dataUrl);
        }
        catch (e) {
            /* tainted */
        }
    });
}

/**
 * The rules of a <style> element's sheet when they diverge from its textContent (CSS-in-JS libraries),
 * else null. Divergence is detected by instantiating a duplicate element with the same text and comparing
 * rule counts. Throws for cross-origin sheets.
 * @param {HTMLStyleElement} element
 * @returns {string|null}
 */
export function divergentSheetRules(element) {
    const doc = element.ownerDocument;
    const duplicate = doc.createElement("style");
    duplicate.textContent = element.textContent;
    doc.body.appendChild(duplicate);
    const duplicateSheet = duplicate.sheet;
    duplicate.remove();

    if (duplicateSheet.cssRules.length === element.sheet.cssRules.length)
        return null;

    let css = "";

    for (let i = 0; i < element.sheet.cssRules.length; i++)
        css += element.sheet.cssRules[i].cssText + "\n";

    return css;
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
