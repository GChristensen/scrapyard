// The CSS engine: the master tokenizer and the secondary regexes.
// Quoted strings and comments are matched-and-ignored in the same pass so URLs inside them are never touched.
// DOM-free.

import {removeQuotes} from "../../shared/url.js";

/** Rewriting form of the master regex: captures the optional leading space before each construct. */
export const MASTER = new RegExp(
    /(?:( ?)@import\s*(?:url\(\s*)?((?:"[^"]+")|(?:'[^']+')|(?:[^\s);]+))(?:\s*\))?\s*;)|/.source +   // p1 p2  @import
    /(?:( ?)@font-face\s*({[^}]*}))|/.source +                                                      // p3 p4  @font-face block
    /(?:( ?)url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\))|/.source +                          // p5 p6  url()
    /(?:"(?:\\"|[^"])*")|/.source +                                                                 // double-quoted string (ignored)
    /(?:'(?:\\'|[^'])*')|/.source +                                                                 // single-quoted string (ignored)
    /(?:\/\*(?:\*[^\/]|[^\*])*?\*\/)/.source,                                                        // comment (ignored)
    "gi");

export const RX_IMPORT = /@import\s*(?:url\(\s*)?((?:"[^"]+")|(?:'[^']+')|(?:[^\s);]+))(?:\s*\))?\s*;/gi;
export const RX_IMAGE_URL = /( ?)url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\)/gi;
export const RX_FONT_SRC = /src:([^;}]*)[;}]/gi;
export const RX_FONT_URL = /url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\)(?:\s+format\(([^)]*)\))?/gi;
export const RX_FONT_DISPLAY = /font-display\s*:\s*([^\s;}]*)\s*;?/gi;
export const RX_CSS_ESCAPE = /\\(?:([0-9A-Fa-f]{1,6})|(.))/g;

/**
 * @typedef {object} CssToken
 * @property {"import"|"fontface"|"url"|"string"|"comment"} type
 * @property {string} match   the whole matched text
 * @property {string} lead    the optional leading space captured before the construct ("" for string/comment)
 * @property {string} value   import: the URL (quotes kept); fontface: the {...} block; url: the URL (quotes kept)
 * @property {number} index   offset in the source
 */

/**
 * @param {string} css
 * @returns {CssToken[]}
 */
export function tokenize(css) {
    const tokens = [];
    const regex = new RegExp(MASTER.source, MASTER.flags);
    let m;

    while ((m = regex.exec(css)) != null) {
        tokens.push(classify(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m.index));

        if (m[0].length === 0)
            regex.lastIndex++;
    }

    return tokens;
}

/**
 * String.replace with the master regex; strings and comments are returned unchanged.
 * @param {string} css
 * @param {(token: CssToken) => string} fn
 * @returns {string}
 */
export function rewrite(css, fn) {
    const regex = new RegExp(MASTER.source, MASTER.flags);

    return css.replace(regex, (match, p1, p2, p3, p4, p5, p6, offset) => {
        const token = classify(match, p1, p2, p3, p4, p5, p6, offset);

        if (token.type === "string" || token.type === "comment")
            return match;

        return fn(token);
    });
}

// Which alternation of MASTER matched is already unambiguous from its value group: p2, p4 and p6 are
// non-optional inside their branch, so each is undefined exactly when that branch did not participate (both
// in exec() and in a replace() callback). Reading them beats re-inspecting the matched text, which for a
// @font-face block or a long string meant copying the whole token just to look at its first ten characters.
function classify(match, p1, p2, p3, p4, p5, p6, index) {
    if (p2 !== undefined)
        return {type: "import", match, lead: p1 || "", value: p2, index};
    if (p4 !== undefined)
        return {type: "fontface", match, lead: p3 || "", value: p4, index};
    if (p6 !== undefined)
        return {type: "url", match, lead: p5 || "", value: p6, index};
    if (match[0] === "/")
        return {type: "comment", match, lead: "", value: match, index};

    return {type: "string", match, lead: "", value: match, index};
}

/**
 * The URLs of every @import rule in the text (quotes removed, not resolved).
 * @param {string} css
 * @returns {string[]}
 */
export function findImports(css) {
    const result = [];
    const regex = new RegExp(RX_IMPORT.source, RX_IMPORT.flags);
    let m;

    while ((m = regex.exec(css)) != null)
        result.push(removeQuotes(m[1]));

    return result;
}

/**
 * The URLs of every url() in the text (quotes removed, not resolved); used for computed styles and style attributes.
 * @param {string} css
 * @returns {string[]}
 */
export function findImageUrls(css) {
    const result = [];
    const regex = new RegExp(RX_IMAGE_URL.source, RX_IMAGE_URL.flags);
    let m;

    while ((m = regex.exec(css)) != null)
        result.push(removeQuotes(m[2]));

    return result;
}

/**
 * Rewrites every url() in a style attribute; fn receives the URL (quotes removed) and returns the replacement
 * for the whole url(...) construct without the leading space, or null to keep the original.
 * @param {string} css
 * @param {(url: string, lead: string) => string|null} fn
 * @returns {string}
 */
export function rewriteImageUrls(css, fn) {
    const regex = new RegExp(RX_IMAGE_URL.source, RX_IMAGE_URL.flags);

    return css.replace(regex, (match, lead, value) => {
        const replacement = fn(removeQuotes(value), lead || "");
        return replacement == null? match: replacement;
    });
}

/**
 * Unescapes CSS escape sequences (\26 -> "&", \" -> "\"").
 * @param {string} value
 * @returns {string}
 */
export function unescapeValue(value) {
    return value.replace(RX_CSS_ESCAPE, (match, hexDigits, char) => {
        if (char)
            return char;

        const codepoint = parseInt(hexDigits, 16);

        if (codepoint === 0 || codepoint > 0x10FFFF || (codepoint >= 0xD800 && codepoint <= 0xDFFF))
            return "�";

        return String.fromCodePoint(codepoint);
    });
}

/**
 * The CSS inset shorthand is supported by Firefox but not by Chrome: enumerate it as top/right/bottom/left.
 * @param {string} css
 * @returns {string}
 */
const RX_INSET = /([{;]\s*)inset\s*:\s*([^\s;]+)(?:\s+([^\s;]+))?(?:\s+([^\s;]+))?(?:\s+([^\s;]+))?\s*;/gi;

export function expandInset(css) {
    if (css.indexOf("inset") < 0)   /* the overwhelmingly common case on a large sheet */
        return css;

    // one pass over the sheet instead of four. The delimiter before "inset" is kept; the four arms below are
    // the one-, two-, three- and four-value forms of the shorthand, exactly as the four regexes expressed them.
    return css.replace(RX_INSET, (match, lead, top, right, bottom, left) => {
        if (right === undefined)
            right = bottom = left = top;
        else if (bottom === undefined) {
            bottom = top;
            left = right;
        }
        else if (left === undefined)
            left = right;

        return lead + "top: " + top + "; right: " + right + "; bottom: " + bottom + "; left: " + left + ";";
    });
}

/**
 * Comments out font-display inside a @font-face block (avoids Chrome using the fallback font).
 * @param {string} block
 * @param {(value: string) => string} marker
 * @returns {string}
 */
export function commentFontDisplay(block, marker) {
    return block.replace(new RegExp(RX_FONT_DISPLAY.source, RX_FONT_DISPLAY.flags), (match, value) => marker(value));
}

/**
 * Rewrites every url() of a @font-face block; fn receives the URL (quotes removed) and the leading space and
 * returns the replacement for the whole construct, or null to keep the original.
 * @param {string} block
 * @param {(url: string, lead: string) => string|null} fn
 * @returns {string}
 */
export function rewriteFontUrls(block, fn) {
    return rewriteImageUrls(block, fn);
}

/**
 * Escapes "</style>" so a stylesheet can be embedded in a <style> element.
 * @param {string} css
 * @returns {string}
 */
export function escapeStyleEnd(css) {
    return css.replace(/<\/style>/gi, "<\\/style>");
}
