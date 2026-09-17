// UnpackedSink: a directory. index.html, frames/<key>.html, resources/<hash>.<ext>, archive.json; resources are
// referenced by relative path. Every write goes through the port to the background's FileWriter.

import {MARK, MESSAGE, MIME} from "../../shared/constants.js";
import {relativePath} from "../../shared/url.js";
import {sha256hex, utf8Encode} from "../../shared/bytes.js";
import {log} from "../../shared/log.js";
import {emitPackedFrame} from "./packed.js";

/** @typedef {import("../../shared/types.js").Resource} Resource */
/** @typedef {import("../context.js").CaptureContext} CaptureContext */

export class UnpackedSink {
    /**
     * @param {import("../../shared/types.js").CaptureOptions} options
     * @param {import("../port.js").CapturePort} port
     */
    constructor(options, port) {
        this.options = options;
        this.port = port;
    }

    /** @param {CaptureContext} ctx */
    begin(ctx) {
        ctx.out = [];
        ctx.documentPath = "index.html";
    }

    /**
     * Text resources (scripts, tracks, SVG documents) are written before serialization so locate() stays
     * synchronous; binary resources were written by the loader; stylesheets are inlined or rewritten.
     * @param {import("../core/resource_store.js").ResourceStore} store
     */
    async beforeSerialize(store) {
        for (const resource of store.all()) {
            if (resource.status !== "success" || resource.path || resource.text == null || resource.kind === "stylesheet")
                continue;

            try {
                const bytes = utf8Encode(resource.text);
                const hash = await sha256hex(bytes);
                const reply = await this.port.request(MESSAGE.write, {kind: "resource", mime: resource.mime,
                    encoding: "text", data: resource.text, hash, url: resource.url});

                resource.hash = hash;
                resource.path = reply.path;
            }
            catch (e) {
                log("error", "write failed", resource.url, e);
                resource.status = "failure";
                resource.reason = "write";
            }
        }
    }

    /**
     * @param {Resource} resource
     * @param {CaptureContext} ctx
     * @param {string} [fragment]
     * @returns {string|null} the path relative to the document being serialized
     */
    locate(resource, ctx, fragment = "") {
        if (resource.status !== "success" || !resource.path)
            return null;

        return relativePath(ctx.documentPath || "index.html", resource.path) + fragment;
    }

    /**
     * @param {Resource} resource
     * @param {CaptureContext} ctx
     * @returns {string|null}
     */
    locateCssImage(resource, ctx) {
        return this.locate(resource, ctx, "");
    }

    /**
     * <link rel=stylesheet> keeps its form; the rewritten sheet becomes a .css resource file.
     * @param {import("../core/tag.js").Tag} tag
     * @param {HTMLLinkElement} el
     * @param {Resource} sheet
     * @param {string} rewritten
     * @param {CaptureContext} ctx
     */
    async emitLinkedStylesheet(tag, el, sheet, rewritten, ctx) {
        const hash = await sha256hex(utf8Encode(rewritten));
        const reply = await this.port.request(MESSAGE.write, {kind: "resource", mime: MIME.css, encoding: "text",
            data: rewritten, hash, url: sheet.url});

        tag.replace("href", relativePath(ctx.documentPath, reply.path));
        tag.text = "";
    }

    /** @param {CaptureContext} ctx */
    emitHeadExtras(ctx) {
        return "";
    }

    /**
     * Frames with a src attribute get their own file; the others are inlined as srcdoc into the parent file.
     * @param {Element} el
     * @param {CaptureContext} childCtx
     * @param {CaptureContext} ctx
     * @returns {string}
     */
    childDocumentPath(el, childCtx, ctx) {
        return el.hasAttribute("src")? "frames/" + childCtx.frameKey + ".html": ctx.documentPath;
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
        if (!el.hasAttribute("src")) {
            emitPackedFrame(tag, el, childCtx, html, ctx, state);
            return;
        }

        const reply = await this.port.request(MESSAGE.write, {kind: "frame", path: childCtx.documentPath,
            mime: MIME.html, encoding: "text", data: html});

        tag.set(childCtx.crossFrame? MARK.crossOrigin: MARK.sameOrigin, "");
        tag.replace("src", relativePath(ctx.documentPath, reply.path));
    }

    /**
     * Writes index.html and archive.json.
     * @param {CaptureContext} ctx
     * @param {object} manifest
     * @returns {Promise<{html: string}>}
     */
    async finish(ctx, manifest) {
        const html = ctx.out.join("");
        ctx.out = [];

        await this.port.request(MESSAGE.write, {kind: "index", path: "index.html", mime: MIME.html, encoding: "text", data: html});
        await this.port.request(MESSAGE.write, {kind: "manifest", path: "archive.json", mime: "application/json",
            encoding: "text", data: JSON.stringify(manifest, null, 2)});

        return {html};
    }
}
