// <html> (doctype) and <head> (encoding meta, favicon, sink extras, shadow loader, provenance metas).

import {MARK} from "../../shared/constants.js";
import {publicOptions} from "../../shared/options.js";
import {escapeAttribute} from "../core/tag.js";
import {serializeDoctype} from "../snapshot.js";
import {isHTML, substitute} from "./common.js";

/**
 * The line prefix of head injections.
 * @param {import("../context.js").CaptureContext} ctx
 * @returns {string}
 */
export function headPrefix(ctx) {
    return (ctx.options.prettyPrint && ctx.depth === 0)? "\n    ": "\n";
}

/** @type {import("../../shared/types.js").ElementRule[]} */
export const headRules = [
    {
        name: "html",
        match: el => el.localName === "html" && isHTML(el),

        serialize(el, ctx, tag) {
            const doctype = serializeDoctype(el.ownerDocument.doctype);

            if (doctype)
                tag.before = doctype + "\n";
        }
    },
    {
        name: "head",
        match: el => el.localName === "head" && isHTML(el),

        serialize(el, ctx, tag) {
            const prefix = headPrefix(ctx);

            /* with the live-document meta removal this guarantees the UTF-8 output reads back correctly */
            tag.after = prefix + "<meta charset=\"utf-8\">";

            /* the first favicon of the document head, else the favicon of the website root */
            // the root favicon is only a guess: it is emitted only when it exists
            const icon = ctx.firstIcon || (ctx.rootIcon && ctx.store.loaded(ctx.rootIcon, ctx.baseURI)? ctx.rootIcon: "");

            if (ctx.depth === 0 && icon) {
                const location = icon;
                const value = substitute(location, ctx);

                tag.after += prefix + "<link rel=\"icon\" " + MARK.original("href") + "=\"" + escapeAttribute(location)
                    + "\" href=\"" + escapeAttribute(value) + "\">";
            }

            let extras = ctx.sink.emitHeadExtras(ctx) || "";

            if (ctx.depth === 0) {
                if (ctx.options.shadowDom)
                    extras += shadowLoaderScript(ctx, prefix);

                extras += provenanceMetas(ctx, prefix);
            }

            tag.beforeEnd = extras;
        }
    }
];

function shadowLoaderScript(ctx, prefix) {
    let html = prefix + "<script id=\"" + MARK.shadowLoader + "\" type=\"application/javascript\">";
    html += prefix + "  \"use strict\";";
    html += prefix + "  window.addEventListener(\"DOMContentLoaded\",";
    html += prefix + "  function(event) {";
    html += prefix + "    " + MARK.shadowLoaderFunction + "(" + ctx.options.maxFrameDepth + ");";
    html += prefix + "  },false);";
    html += prefix + "  " + (ctx.options.shadowLoaderSource || "");
    html += prefix + "</script>";

    return html;
}

function provenanceMetas(ctx, prefix) {
    const doc = ctx.doc;
    const pageUrl = ctx.savedPage? ctx.savedPage.url: doc.URL;
    const state = Object.entries(publicOptions(ctx.options)).map(([key, value]) => key + "=" + value + ";").join(" ");

    const meta = (name, value) => prefix + "<meta name=\"" + name + "\" content=\"" + escapeAttribute(value) + "\">";

    return meta(MARK.metaUrl, safeDecode(pageUrl))
        + meta(MARK.metaTitle, doc.title)
        + meta(MARK.metaPubDate, publicationDate(doc))
        + meta(MARK.metaFrom, safeDecode(doc.URL))
        + meta(MARK.metaDate, new Date().toString())
        + meta(MARK.metaState, state)
        + meta(MARK.metaVersion, ctx.options.version || "");
}

function safeDecode(url) {
    try {
        return decodeURIComponent(url);
    }
    catch (e) {
        return url;
    }
}

/**
 * The publication date mined from Open Graph, RDFa, microdata, JSON-LD or <time datetime>, formatted as today.
 * @param {Document} doc
 * @returns {string}
 */
export function publicationDate(doc) {
    let element;
    let text = null;

    if ((element = doc.querySelector("meta[property='article:published_time'][content]")) != null)
        text = element.getAttribute("content");
    else if ((element = doc.querySelector("meta[property='datePublished'][content]")) != null)
        text = element.getAttribute("content");
    else if ((element = doc.querySelector("meta[itemprop='datePublished'][content]")) != null)
        text = element.getAttribute("content");
    else if ((element = doc.querySelector("script[type='application/ld+json']")) != null) {
        const match = element.textContent.match(/"datePublished"\s*:\s*"([^"]*)"/);
        text = match? match[1]: null;
    }
    else if ((element = doc.querySelector("time[datetime]")) != null)
        text = element.getAttribute("datetime");

    try {
        if (!text)
            throw false;

        const zoneMatch = text.match(/(Z|(-|\+)\d\d:?\d\d)$/);
        const zone = zoneMatch? (zoneMatch[1] === "Z"? " GMT+0000": " GMT" + zoneMatch[1].replace(":", "")): "";
        const date = new Date(text.replace(/(Z|(-|\+)\d\d:?\d\d)$/, ""));
        const formatted = date.toString();

        if (formatted === "Invalid Date")
            throw false;

        return formatted.substr(0, 24) + zone;
    }
    catch (e) {
        return "Unknown";
    }
}
