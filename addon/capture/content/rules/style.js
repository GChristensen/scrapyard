// <style> and <link rel=stylesheet>: pass 1 discovery of external sheets, pass 2 scanning of their text,
// pass 3 rewriting.

import {MARK, MIME, ZOOMPAGE_STYLE_IDS, DARKREADER_CLASS} from "../../shared/constants.js";
import {findImports, expandInset} from "../core/css.js";
import {scanStylesheet, rewriteStylesheet} from "../core/stylesheet.js";
import {divergentSheetRules} from "../snapshot.js";
import {isHTML, insideSVG, isReplaceable, unsavedOf} from "./common.js";

/**
 * @param {HTMLLinkElement} el
 * @returns {boolean}
 */
export function isStylesheetLink(el) {
    return el.localName === "link" && isHTML(el) && !insideSVG(el)
        && (el.rel || "").toLowerCase().includes("stylesheet") && !!el.getAttribute("href");
}

/**
 * The CSS a <style> element effectively applies: the snapshot's sheet rules when CSS-in-JS diverged, else a live
 * divergence test, else the text content.
 * @param {HTMLStyleElement} el
 * @param {import("../context.js").CaptureContext} ctx
 * @returns {string}
 */
export function effectiveCss(el, ctx) {
    if (el.hasAttribute(MARK.sheetRules))
        return el.getAttribute(MARK.sheetRules);

    if (!ctx.crossFrame) {
        try {
            const rules = divergentSheetRules(el);

            if (rules != null)
                return rules;
        }
        catch (e) {
            /* sheet.cssRules does not exist or cross-origin style sheet */
        }
    }

    return el.textContent;
}

/** @type {import("../../shared/types.js").ElementRule[]} */
export const styleRules = [
    {
        name: "style",
        match: el => el.localName === "style" && isHTML(el),

        discoverStyles(el, ctx) {
            if (el.disabled)
                return;

            for (const url of findImports(el.textContent))
                ctx.store.remember({url, baseURI: ctx.baseURI, kind: "stylesheet", expectedMime: MIME.css,
                    charset: ctx.characterSet});
        },

        discover(el, ctx) {
            if (!el.disabled)
                scanStylesheet(effectiveCss(el, ctx), ctx.baseURI, ctx, []);
        },

        serialize(el, ctx, tag) {
            if (ZOOMPAGE_STYLE_IDS.includes(el.id))   /* Zoom Page WE */
                return tag.drop();

            if ((el.getAttribute("class") || "").includes(DARKREADER_CLASS))   /* Dark Reader */
                return tag.drop();

            tag.remove(MARK.sheetRules);

            if (el.disabled) {
                tag.set(MARK.disabled, "");
                tag.text = "";
                return;
            }

            let css = effectiveCss(el, ctx);

            if (ctx.isFirefox)
                css = expandInset(css);

            tag.text = rewriteStylesheet(css, ctx.baseURI, ctx.documentURI, ctx, []);
        }
    },
    {
        name: "link-stylesheet",
        match: isStylesheetLink,

        discoverStyles(el, ctx) {
            if (el.disabled || !isReplaceable(el.href))
                return;

            ctx.store.remember({url: el.href, baseURI: ctx.baseURI, kind: "stylesheet", expectedMime: MIME.css,
                charset: el.charset || ctx.characterSet});
        },

        discover(el, ctx) {
            if (el.disabled || !isReplaceable(el.href))
                return;

            const sheet = ctx.store.loaded(el.href, ctx.baseURI);

            if (sheet)
                scanStylesheet(sheet.text || "", sheet.url, ctx, [sheet.url]);
        },

        async serialize(el, ctx, tag) {
            tag.text = "";

            if (el.disabled) {
                tag.set(MARK.disabled, "");
                tag.preserve("href");
                tag.set("href", "");
                return;
            }

            const sheet = isReplaceable(el.href)? ctx.store.loaded(el.href, ctx.baseURI): null;

            if (!sheet) {
                tag.replace("href", unsavedOf(el.getAttribute("href"), ctx));
                return;
            }

            let css = sheet.text || "";

            if (ctx.isFirefox)
                css = expandInset(css);

            const rewritten = rewriteStylesheet(css, sheet.url, sheet.url, ctx, [sheet.url]);

            await ctx.sink.emitLinkedStylesheet(tag, el, sheet, rewritten, ctx);
            sheet.replaced++;
        }
    }
];
