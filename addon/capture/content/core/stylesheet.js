// Discovery in stylesheet text (pass 2) and rewriting (pass 3). DOM-free: the context only supplies the store,
// the options, the frame key, the loaded fonts and the sink's locate functions.

import {tokenize, rewrite, commentFontDisplay, rewriteFontUrls, rewriteImageUrls, expandInset} from "./css.js";
import {parseFontFace, matchesLoadedFont, selectFontFiles} from "./fonts.js";
import {isReplaceable, removeQuotes, stripCssEscapes, adjust, unsaved, resolve, fragmentOf} from "../../shared/url.js";
import {MARK, MIME} from "../../shared/constants.js";

/**
 * @typedef {object} StyleContext
 * @property {import("./resource_store.js").ResourceStore} store
 * @property {import("../../shared/types.js").CaptureOptions} options
 * @property {boolean} crossFrame
 * @property {string} frameKey
 * @property {Array} loadedFonts
 * @property {{locate: Function, locateCssImage: Function}} sink
 */

/**
 * Remembers the fonts and images referenced by a stylesheet (pass 2), recursing into loaded @imports.
 * @param {string} css
 * @param {string} baseURI
 * @param {StyleContext} ctx
 * @param {string[]} importStack  URLs of the sheets being scanned (cycle guard)
 */
export function scanStylesheet(css, baseURI, ctx, importStack) {
    for (const token of tokenize(css)) {
        if (token.type === "import") {
            const url = removeQuotes(token.value);

            if (!isReplaceable(url))
                continue;

            const sheet = ctx.store.loaded(url, baseURI);

            if (sheet && !importStack.includes(sheet.url)) {
                importStack.push(sheet.url);
                scanStylesheet(sheet.text || "", sheet.url, ctx, importStack);
                importStack.pop();
            }
        }
        else if (token.type === "fontface") {
            const face = parseFontFace(token.value);

            if (matchesLoadedFont(face, ctx.loadedFonts))
                for (const url of selectFontFiles(token.value, ctx.options.fonts))
                    ctx.store.remember({url, baseURI, kind: "font", expectedMime: MIME.woff, charset: ""});
        }
        else if (token.type === "url") {
            if (ctx.options.cssImages === "all" || ctx.crossFrame)
                rememberCssImage(removeQuotes(token.value), baseURI, ctx);
        }
    }
}

/**
 * Remembers one CSS image URL (style attributes, computed styles, stylesheet text).
 * @param {string} url
 * @param {string} baseURI
 * @param {StyleContext} ctx
 */
export function rememberCssImage(url, baseURI, ctx) {
    if (!isReplaceable(url))
        return;

    ctx.store.remember({url: stripCssEscapes(url), baseURI, kind: "image", expectedMime: MIME.png, charset: "",
        passive: false, fromCss: true, frameKey: ctx.frameKey});
}

/**
 * Rewrites a stylesheet for the output (pass 3): loaded @imports are inlined, font and image URLs are replaced
 * through the sink, each with a marker comment holding the original.
 * @param {string} css
 * @param {string} baseURI
 * @param {string} documentURI
 * @param {StyleContext} ctx
 * @param {string[]} importStack
 * @returns {string}
 */
export function rewriteStylesheet(css, baseURI, documentURI, ctx, importStack) {
    return rewrite(css, token => {
        if (token.type === "import")
            return rewriteImport(token, baseURI, documentURI, ctx, importStack);

        if (token.type === "fontface") {
            const block = commentFontDisplay(token.match, MARK.cssFontDisplay);

            return rewriteFontUrls(block, (url, lead) => locateFont(url, lead, baseURI, documentURI, ctx));
        }

        if (token.type === "url") {
            const replacement = locateImage(removeQuotes(token.value), token.lead, baseURI, documentURI, ctx);
            return replacement == null? token.match: replacement;
        }

        return token.match;
    });
}

function rewriteImport(token, baseURI, documentURI, ctx, importStack) {
    const url = removeQuotes(token.value);
    const lead = token.lead;

    if (!isReplaceable(url))
        return token.match;

    const sheet = ctx.store.loaded(url, baseURI);

    if (sheet && !importStack.includes(sheet.url)) {
        importStack.push(sheet.url);
        const inner = rewriteStylesheet(sheet.text || "", sheet.url, sheet.url, ctx, importStack);
        importStack.pop();
        sheet.replaced++;

        return lead + MARK.cssImportUrl(url) + lead + inner;
    }

    if (ctx.options.removeUnsavedUrls)
        return lead + MARK.cssImportUrl(url) + lead;

    const adjusted = adjust(url, baseURI, documentURI);

    if (adjusted !== url)
        return token.match.replace(url, adjusted).replace(/(@import)/i, MARK.cssImportUrl(url) + lead + "$1");

    return token.match;
}

function locateFont(url, lead, baseURI, documentURI, ctx) {
    if (!isReplaceable(url))
        return null;

    const resource = ctx.store.loaded(url, baseURI);
    const resolved = resolve(url, baseURI);
    let value = resource? ctx.sink.locate(resource, ctx, resolved? fragmentOf(resolved): ""): null;

    if (value != null)
        resource.replaced++;
    else
        value = unsaved(url, baseURI, documentURI, ctx.options.removeUnsavedUrls);

    const marker = value === url? lead: lead + MARK.cssUrl(url) + lead;

    return marker + "url(" + value + ")";
}

function locateImage(url, lead, baseURI, documentURI, ctx) {
    if (!isReplaceable(url))
        return null;

    const clean = stripCssEscapes(url);
    const resource = ctx.store.loaded(clean, baseURI);
    let value = resource? ctx.sink.locateCssImage(resource, ctx): null;

    if (value != null)
        resource.replaced++;
    else
        value = unsaved(clean, baseURI, documentURI, ctx.options.removeUnsavedUrls);

    const marker = value === url? lead: lead + MARK.cssUrl(url) + lead;
    const fn = value.startsWith("--")? "var": "url";

    return marker + fn + "(" + value + ")";
}

/**
 * Rewrites the image URLs of a style attribute (with the inset expansion on Firefox).
 * @param {string} css
 * @param {string} baseURI
 * @param {string} documentURI
 * @param {StyleContext} ctx
 * @returns {string}
 */
export function rewriteInlineStyle(css, baseURI, documentURI, ctx) {
    if (ctx.options.isFirefox)
        css = expandInset(css);

    return rewriteImageUrls(css, (url, lead) => locateImage(url, lead, baseURI, documentURI, ctx));
}
