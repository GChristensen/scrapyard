// PackedSink: one self-contained HTML string; resources become data URIs, linked stylesheets <style>,
// subframes srcdoc (iframes) or data:text/html (frames).

import {MARK} from "../../shared/constants.js";
import {toBase64} from "../../shared/bytes.js";
import {escapeStyleEnd} from "../core/css.js";
import {escapeAttribute} from "../core/tag.js";
import {newlineIndent} from "../passes/serialize.js";
import {headPrefix} from "../rules/head.js";

/** @typedef {import("../../shared/types.js").Resource} Resource */
/** @typedef {import("../context.js").CaptureContext} CaptureContext */

export class PackedSink {
    /** @param {import("../../shared/types.js").CaptureOptions} options */
    constructor(options) {
        this.options = options;
        this.maxSize = options.maxResourceSize * 1024 * 1024;
    }

    /** @param {CaptureContext} ctx */
    begin(ctx) {
        ctx.out = ["﻿"];   /* UTF-8 byte order mark, as today */
        ctx.documentPath = null;
    }

    /** @param {import("../core/resource_store.js").ResourceStore} store */
    async beforeSerialize(store) {
        /* nothing to write ahead of time */
    }

    /**
     * @param {Resource} resource  a loaded resource
     * @param {CaptureContext} ctx
     * @param {string} [fragment]
     * @returns {string|null} the data URI, null when the size policy refuses
     */
    locate(resource, ctx, fragment = "") {
        if (resource.status !== "success")
            return null;

        if (resource.text != null)
            return "data:" + resource.mime + ";charset=utf-8," + encodeURIComponent(resource.text) + fragment;

        if (!resource.bytes)
            return null;

        const count = resource.refs.html + resource.refs.css;

        if (resource.size * count > this.maxSize)   /* skip large and/or repeated resources */
            return null;

        return "data:" + resource.mime + ";base64," + toBase64(resource.bytes) + fragment;
    }

    /**
     * @param {Resource} resource
     * @param {CaptureContext} ctx
     * @returns {string|null} a CSS variable name (merged images) or a data URI
     */
    locateCssImage(resource, ctx) {
        if (this.options.mergeCssImages && resource.bytes) {
            if (!resource.refs.frames.has(ctx.frameKey))
                return null;

            if (!this._withinMergedSize(resource))
                return null;

            return MARK.cssVariable(resource.id);
        }

        return this.locate(resource, ctx, "");
    }

    _withinMergedSize(resource) {
        /* each frame pays for the variable once, HTML references pay each */
        const count = resource.refs.html + resource.refs.frames.size;
        return resource.size * count <= this.maxSize;
    }

    /**
     * <link rel=stylesheet> becomes <style data-scrapyard-href="..."> holding the rewritten sheet.
     * @param {import("../core/tag.js").Tag} tag
     * @param {HTMLLinkElement} el
     * @param {Resource} sheet
     * @param {string} rewritten
     * @param {CaptureContext} ctx
     */
    async emitLinkedStylesheet(tag, el, sheet, rewritten, ctx) {
        const href = el.getAttribute("href");
        const type = el.getAttribute("type");
        const media = el.getAttribute("media");

        tag.name = "style";

        for (const [name] of tag.attributes())
            tag.remove(name);

        tag.set(MARK.original("href"), href);

        if (type)
            tag.set("type", type);

        if (media)
            tag.set("media", media);

        tag.text = escapeStyleEnd(rewritten);
    }

    /**
     * The <style id="scrapyard-cssvariables"> of a frame: one variable per merged CSS image used in it.
     * @param {CaptureContext} ctx
     * @returns {string}
     */
    emitHeadExtras(ctx) {
        if (!this.options.mergeCssImages)
            return "";

        const prefix = headPrefix(ctx);
        let variables = "";

        for (const resource of ctx.store.forFrame(ctx.frameKey)) {
            if (resource.status !== "success" || !resource.bytes || !this._withinMergedSize(resource))
                continue;

            variables += prefix + "    " + MARK.cssVariable(resource.id) + ": url(data:" + resource.mime + ";base64,"
                + toBase64(resource.bytes) + ");";
        }

        if (variables === "")
            return "";

        let html = prefix + "<style id=\"" + MARK.cssVariables + "\">";
        html += prefix + "  :root {";
        html += variables;
        html += prefix + "  }";
        html += prefix + "</style>";

        return html;
    }

    /**
     * @param {Element} el
     * @param {CaptureContext} childCtx
     * @param {CaptureContext} ctx
     * @returns {string|null}
     */
    childDocumentPath(el, childCtx, ctx) {
        return null;
    }

    /**
     * @param {import("../core/tag.js").Tag} tag
     * @param {Element} el
     * @param {CaptureContext} childCtx
     * @param {string} html
     * @param {CaptureContext} ctx
     * @param {object} state
     */
    async emitFrame(tag, el, childCtx, html, ctx, state) {
        emitPackedFrame(tag, el, childCtx, html, ctx, state);
    }

    /**
     * @param {CaptureContext} ctx
     * @param {object} manifest
     * @returns {Promise<{html: string}>}
     */
    async finish(ctx, manifest) {
        const shrink = ctx.run.shrink;

        if (shrink) {
            /* the emitted <html> and <body> start tags get the style attributes of the unshrunk page */
            for (let i = 0; i < ctx.out.length; i++) {
                if (ctx.out[i].startsWith("<html"))
                    ctx.out[i] = ctx.out[i].replace(/ style="(?:\\"|[^"])*"/, " style=\"" + escapeAttribute(shrink.htmlCssText) + "\"");
                else if (ctx.out[i].startsWith("<body")) {
                    ctx.out[i] = ctx.out[i].replace(/ style="(?:\\"|[^"])*"/, " style=\"" + escapeAttribute(shrink.bodyCssText) + "\"");
                    break;
                }
            }
        }

        const html = ctx.out.join("");
        ctx.out = [];

        return {html};
    }
}

/**
 * The packed frame rules, also used by the unpacked sink for frames without src.
 * @param {import("../core/tag.js").Tag} tag
 * @param {Element} el
 * @param {CaptureContext} childCtx
 * @param {string} html
 * @param {CaptureContext} ctx
 * @param {object} state
 */
export function emitPackedFrame(tag, el, childCtx, html, ctx, state) {
    tag.set(childCtx.crossFrame? MARK.crossOrigin: MARK.sameOrigin, "");

    if (el.localName === "iframe") {
        let text = html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

        if (ctx.options.prettyPrint && ctx.depth === 0 && !ctx.savedPage) {
            const indent = (state?.indent || 0) + 2;
            text = text.replace(/\n/g, newlineIndent(indent));
            text = newlineIndent(indent) + MARK.srcdocBegin + newlineIndent(indent) + text + newlineIndent(indent) + MARK.srcdocEnd;
        }

        tag.preserve("srcdoc");
        tag.set("srcdoc", text);

        if (el.hasAttribute("src")) {
            tag.preserve("src");
            tag.set("src", "");   /* an iframe with both srcdoc and src uses srcdoc */
        }
    }
    else {
        tag.preserve("src");
        tag.set("src", "data:text/html;charset=utf-8," + encodeURIComponent(html));
    }
}
