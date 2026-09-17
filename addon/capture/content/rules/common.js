// Helpers shared by the element rules.

import {isReplaceable, resolve, fragmentOf, adjust, unsaved} from "../../shared/url.js";

/** @typedef {import("../context.js").CaptureContext} CaptureContext */

const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {Element} el
 * @returns {boolean}
 */
export function isHTML(el) {
    // a namespace test, not instanceof: elements of same-origin subframes belong to another realm
    return el.namespaceURI === HTML_NS;
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
export function isSVG(el) {
    return el.namespaceURI === SVG_NS;
}

/**
 * @param {Element} el
 * @returns {boolean} the parent is an SVG element (<link> is invalid there)
 */
export function insideSVG(el) {
    return el.parentElement != null && isSVG(el.parentElement);
}

/**
 * The value to emit for a resource URL: the sink's location of the loaded resource (fragment kept), else the
 * unsaved form. Counts the substitution.
 * @param {string} url   the attribute value (or a currentSrc)
 * @param {CaptureContext} ctx
 * @returns {string}
 */
export function substitute(url, ctx) {
    const resource = ctx.store.loaded(url, ctx.baseURI);

    if (resource) {
        const resolved = resolve(url, ctx.baseURI);
        const located = ctx.sink.locate(resource, ctx, resolved? fragmentOf(resolved): "");

        if (located != null) {
            resource.replaced++;
            return located;
        }
    }

    return unsavedOf(url, ctx);
}

/**
 * @param {string} url
 * @param {CaptureContext} ctx
 * @returns {string}
 */
export function unsavedOf(url, ctx) {
    return unsaved(url, ctx.baseURI, ctx.documentURI, ctx.options.removeUnsavedUrls);
}

/**
 * @param {string} url
 * @param {CaptureContext} ctx
 * @returns {string}
 */
export function adjustOf(url, ctx) {
    return adjust(url, ctx.baseURI, ctx.documentURI);
}

/**
 * Replaces a URL attribute by its substitution when the attribute is present and replaceable.
 * @param {Element} el
 * @param {import("../core/tag.js").Tag} tag
 * @param {string} attribute
 * @param {string} property   the resolved property to test (el.src, el.href, ...)
 * @param {CaptureContext} ctx
 */
export function substituteAttribute(el, tag, attribute, property, ctx) {
    const original = el.getAttribute(attribute);

    if (original && isReplaceable(property))
        tag.replace(attribute, substitute(original, ctx));
}

/** @returns {boolean} the HTML image gate: all images, or the element is displayed */
export function imageGate(el, ctx) {
    return ctx.options.images === "all" || ctx.displayed(el);
}

export {isReplaceable};
