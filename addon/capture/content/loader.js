// The content-side resource loader: in-page fetch first, the background fallback over the port second,
// then the accept step that validates and decodes the payload. Loads run through a bounded pool.

import {isLoadAllowed, parseContentType} from "../shared/http.js";
import {BINARY_MIMES, JAVASCRIPT_MIMES, MIME, MESSAGE} from "../shared/constants.js";
import {decodeText, cssCharsetOf, fromBase64, toBase64, sha256hex} from "../shared/bytes.js";
import {findImports} from "./core/css.js";
import {log} from "../shared/log.js";
import {abortError} from "./prepare.js";

/** @typedef {import("../shared/types.js").Resource} Resource */

const BINARY_KINDS = ["font", "image", "icon", "audio", "video", "object"];

export class Loader {
    /**
     * @param {object} env
     * @param {import("./core/resource_store.js").ResourceStore} env.store
     * @param {import("../shared/types.js").CaptureOptions} env.options
     * @param {import("./port.js").CapturePort} env.port
     * @param {"packed"|"unpacked"} env.mode
     * @param {string} env.pageScheme
     * @param {AbortSignal} env.signal
     * @param {(done: number, total: number) => void} [env.onProgress]
     */
    constructor(env) {
        this.store = env.store;
        this.options = env.options;
        this.port = env.port;
        this.mode = env.mode;
        this.pageScheme = env.pageScheme;
        this.signal = env.signal;
        this.onProgress = env.onProgress || (() => {});
        this.done = 0;
    }

    /** Loads every pending resource, including the ones appended while loading (CSS imports). */
    async loadAll() {
        for (;;) {
            const pending = this.store.pending();

            if (pending.length === 0)
                break;

            await this._pool(pending, this.options.concurrency, resource => this._loadOne(resource));
        }
    }

    async _pool(items, size, fn) {
        const queue = items.slice();
        const total = this.done + queue.length;

        const worker = async () => {
            while (queue.length) {
                if (this.signal?.aborted)
                    throw abortError();

                const item = queue.shift();

                try {
                    await fn(item);
                }
                catch (e) {
                    if (e?.name === "AbortError")
                        throw e;

                    log("error", "load failed", item.url, e);
                    this._fail(item, "send");
                }

                this.done++;
                this.onProgress(this.done, total);
            }
        };

        await Promise.all(Array.from({length: Math.max(1, size)}, worker));
    }

    _fail(resource, reason) {
        resource.status = "failure";
        resource.reason = reason;
        log("debug", "resource failed", reason, resource.url);
    }

    async _loadOne(resource) {
        resource.status = "loading";

        if (!isLoadAllowed(resource, this.pageScheme, this.options.allowPassiveMixedContent))
            return this._fail(resource, "mixed");

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.options.maxResourceTime * 1000);
        const onAbort = () => controller.abort();
        this.signal?.addEventListener("abort", onAbort, {once: true});

        try {
            const referrerPolicy = (this.options.referer === "strict" || this.options.incognito)
                ? "strict-origin-when-cross-origin": "no-referrer-when-downgrade";

            const response = await fetch(resource.url, {method: "GET", mode: "cors", cache: "no-cache",
                referrer: resource.referrer, referrerPolicy, signal: controller.signal});

            log("debug", "fetch", response.status, resource.url);

            if (response.status === 200) {
                const maxSize = this.options.maxResourceSize * 1024 * 1024;
                const contentLength = +(response.headers.get("Content-Length") || 0);

                if (contentLength > maxSize)
                    return this._fail(resource, "maxsize");

                const {mime, charset} = parseContentType(response.headers.get("Content-Type"));
                const bytes = new Uint8Array(await response.arrayBuffer());

                if (bytes.length > maxSize)
                    return this._fail(resource, "maxsize");

                return this.accept(resource, bytes, mime, charset);
            }
        }
        catch (e) {
            if (e?.name === "AbortError") {
                if (this.signal?.aborted)
                    throw abortError();

                return this._fail(resource, "maxtime");
            }

            log("debug", "fetch error, using the background", resource.url, e?.message);
        }
        finally {
            clearTimeout(timer);
            this.signal?.removeEventListener("abort", onAbort);
        }

        return this._fallback(resource);
    }

    /** Non-200 or a thrown fetch error: the background loads the resource with its own referer control. */
    async _fallback(resource) {
        if (resource.kind === "font")   /* fonts must be loaded with CORS, which the background cannot guarantee */
            return this._fail(resource, "corsfail");

        const write = this.mode === "unpacked" && BINARY_KINDS.includes(resource.kind);

        const reply = await this.port.request(MESSAGE.load, {
            url: resource.url,
            referrer: resource.referrer,
            referer: this.options.referer,
            passive: resource.passive,
            pageScheme: this.pageScheme,
            maxSize: this.options.maxResourceSize,
            maxTime: this.options.maxResourceTime,
            expectedKind: resource.kind,
            write
        });

        if (!reply || !reply.ok)
            return this._fail(resource, reply?.reason || "send");

        if (reply.path) {
            resource.hash = reply.hash;
            resource.path = reply.path;
            resource.size = reply.size;
            resource.mime = reply.mime || resource.expectedMime;
            resource.charset = "";
            resource.bytes = null;
            resource.status = "success";
            return;
        }

        return this.accept(resource, fromBase64(reply.data || ""), reply.mime || "", reply.charset || "");
    }

    /**
     * Validates and stores a payload according to the expected MIME type of the resource.
     * @param {Resource} resource
     * @param {Uint8Array} bytes
     * @param {string} mime     actual mime ("" when unknown)
     * @param {string} charset  actual charset ("" when unknown)
     */
    async accept(resource, bytes, mime, charset) {
        const expected = resource.expectedMime;
        resource.size = bytes.length;

        /* an expected SVG that is not served as SVG (an <image href> to a PNG) is binary as well */
        if ((BINARY_MIMES.includes(expected) || expected === MIME.svg) && mime !== MIME.svg) {
            resource.bytes = bytes;
            resource.mime = mime || expected;
            resource.charset = "";
        }
        else {
            const isSvg = mime === MIME.svg;

            if (expected === MIME.javascript && !isSvg && !JAVASCRIPT_MIMES.includes(mime))
                return this._fail(resource, "mime");

            if (expected === MIME.css && mime !== MIME.css)
                return this._fail(resource, "mime");

            let label = resource.charset;

            if (expected === MIME.css) {
                const declared = cssCharsetOf(bytes);

                if (declared)
                    label = declared;
            }

            if (charset)
                label = charset;

            const decoded = decodeText(bytes, label);

            resource.mime = mime || expected;
            resource.charset = decoded.charset;
            resource.text = decoded.text;
            resource.bytes = null;

            if (expected === MIME.css)
                for (const url of findImports(resource.text))
                    this.store.remember({url, baseURI: resource.url, kind: "stylesheet", expectedMime: MIME.css,
                        charset: resource.charset});
        }

        resource.status = "success";
        resource.reason = "";

        if (this.mode === "unpacked" && resource.bytes)
            await this._writeBinary(resource);
    }

    async _writeBinary(resource) {
        try {
            const hash = await sha256hex(resource.bytes);
            const reply = await this.port.request(MESSAGE.write, {kind: "resource", mime: resource.mime,
                encoding: "base64", data: toBase64(resource.bytes), hash, url: resource.url});

            resource.hash = hash;
            resource.path = reply.path;
            resource.bytes = null;
        }
        catch (e) {
            log("error", "write failed", resource.url, e);
            resource.bytes = null;
            this._fail(resource, "write");
        }
    }
}
