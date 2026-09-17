// PageCapture: pipeline orchestration, progress and abort handling.

import {ARCHIVE_FORMAT, MESSAGE} from "../shared/constants.js";
import {publicOptions} from "../shared/options.js";
import {log} from "../shared/log.js";
import {ResourceStore} from "./core/resource_store.js";
import {CaptureContext} from "./context.js";
import {waitForLoad, delay, clearDocumentEncoding, lock, unlock, createSelectionRoot, detectSavedPage, abortError} from "./prepare.js";
import {forceLazyContent, forceLazyImages, undoShrink} from "./lazy.js";
import {quirksFor} from "./quirks.js";
import {buildFrameTable} from "./frames.js";
import {loadedFontsOf, removeTransientAttributes} from "./snapshot.js";
import {collectLinks, indexWords} from "./extras.js";
import {Loader} from "./loader.js";
import {discoverStyles} from "./passes/discover_styles.js";
import {discoverResources} from "./passes/discover_resources.js";
import {serializeDocument} from "./passes/serialize.js";
import {PackedSink} from "./sinks/packed.js";
import {UnpackedSink} from "./sinks/unpacked.js";

/** @typedef {import("../shared/types.js").CaptureOptions} CaptureOptions */
/** @typedef {import("../shared/types.js").CaptureResult} CaptureResult */
/** @typedef {import("../shared/types.js").CaptureProgress} CaptureProgress */

export class PageCapture {
    /**
     * @param {Document} document        the top document of the tab
     * @param {CaptureOptions} options   already normalized by the host
     * @param {object} env
     * @param {import("./port.js").CapturePort} env.port
     * @param {AbortSignal} env.signal
     * @param {(progress: CaptureProgress) => void} [env.onProgress]
     */
    constructor(document, options, env) {
        this.document = document;
        this.window = document.defaultView;
        this.options = options;
        this.port = env.port;
        this.signal = env.signal;
        this.onProgress = env.onProgress || (() => {});
        this.timing = {start: Date.now(), stages: {}};
        this._stageStart = 0;
        this._stage = null;
    }

    /**
     * @param {object} run
     * @param {"packed"|"unpacked"} run.mode
     * @param {string} [run.selection]
     * @param {{index?: boolean, links?: boolean}} [run.extras]
     * @returns {Promise<CaptureResult>}
     */
    async run(run) {
        const mode = run.mode === "unpacked"? "unpacked": "packed";
        const extras = {index: !!run.extras?.index, links: !!run.extras?.links};
        const doc = this.document;
        const options = this.options;

        /** state shared by every context of the run */
        const shared = {mode, selectionRoot: null, skipRestOfBody: false, shrink: null, frames: [], unkeyedFrames: 0};

        try {
            /* prepare */
            this._enter("prepare");
            await waitForLoad(doc, this.signal);

            if (options.startDelay > 0)
                await delay(options.startDelay * 1000, this.signal);

            const quirks = quirksFor(this.window.location);
            quirks.prepare(doc);
            clearDocumentEncoding(doc);

            if (options.lockOverlay)
                lock(doc, options.lockIconUrl);

            if (run.selection)
                shared.selectionRoot = createSelectionRoot(doc, run.selection);

            const savedPage = detectSavedPage(doc);

            /* lazy */
            this._enter("lazy");

            if (options.lazyLoad !== "none")
                shared.shrink = await forceLazyContent(this.window, options, this.signal);

            if (options.lazyImages)
                forceLazyImages(doc);

            /* frames */
            this._enter("frames");
            const collected = await this.port.request(MESSAGE.framesCollect, {
                extras, snapshot: options.crossOriginFrames, annotate: true, timeout: options.frameReplyTimeout});
            this._check();

            const snapshots = collected?.frames || [];
            const frames = buildFrameTable(snapshots);
            let top = frames.get("0");

            log("debug", "frames", snapshots.length, "of", collected?.expected);

            if (!top) {
                /* the top frame's reply came too late: compute its part locally */
                log("warn", "no reply from the top frame within", options.frameReplyTimeout, "ms");
                top = {key: "0", url: doc.baseURI, html: "", fonts: loadedFontsOf(doc)};

                if (extras.index)
                    top.index = indexWords(doc.body);

                if (extras.links)
                    top.links = collectLinks(doc);

                snapshots.unshift(top);
                frames.set("0", top);
            }

            const store = new ResourceStore(doc.URL);
            const sink = mode === "unpacked"? new UnpackedSink(options, this.port): new PackedSink(options);

            const ctx = new CaptureContext({
                doc, win: this.window, frameKey: "0", depth: 0, crossFrame: false, noSrcFrame: false,
                loadedFonts: top.fonts || [],
                options, store, sink, quirks, savedPage, frames, run: shared
            });

            /* styles */
            this._enter("styles");
            await discoverStyles(ctx);

            const loader = new Loader({store, options, port: this.port, mode, pageScheme: new URL(doc.baseURI).protocol,
                signal: this.signal, onProgress: (done, total) => this._progress("load", done, total)});

            this._enter("load");
            await loader.loadAll();

            /* resources */
            this._enter("resources");
            await discoverResources(ctx);

            this._enter("load");
            await loader.loadAll();

            /* serialize */
            this._enter("serialize");
            await sink.beforeSerialize(store);
            sink.begin(ctx);
            shared.frames.push({key: "0", url: doc.baseURI, path: ctx.documentPath || undefined});
            await serializeDocument(ctx);

            /* write */
            this._enter("write");
            const manifest = this._manifest(mode, store, shared.frames);
            const output = await sink.finish(ctx, manifest);

            /* done */
            this._enter("done");
            this._restore(shared);

            const result = {
                mode,
                html: output.html,
                url: safeDecode(doc.URL),
                title: doc.title,
                manifest,
                failures: store.failures().map(r => ({url: r.url, reason: r.reason, kind: r.kind})),
                timing: this.timing
            };

            if (extras.index)
                result.index = Array.from(new Set(snapshots.flatMap(s => s.index || [])));

            if (extras.links)
                result.links = shared.selectionRoot? collectLinks(shared.selectionRoot): snapshots.flatMap(s => s.links || []);

            if (shared.selectionRoot)
                shared.selectionRoot.remove();

            this._progress("done", 1, 1);

            return result;
        }
        catch (e) {
            this._restore(shared);

            if (shared.selectionRoot)
                shared.selectionRoot.remove();

            unlock(doc);
            throw e;
        }
    }

    /** Removes the lock overlay; called by the host after the archive is stored. */
    unlock() {
        unlock(this.document);
    }

    _restore(shared) {
        if (shared.shrink) {
            try { undoShrink(this.window, shared.shrink); } catch (e) { log("error", e); }
            shared.shrink = null;
        }

        removeTransientAttributes(this.document);
    }

    _check() {
        if (this.signal?.aborted)
            throw abortError();
    }

    _enter(stage) {
        this._check();

        const now = performance.now();

        if (this._stage)
            this.timing.stages[this._stage] = (this.timing.stages[this._stage] || 0) + Math.round(now - this._stageStart);

        this._stage = stage;
        this._stageStart = now;
        this._progress(stage, 0, 0);
    }

    _progress(stage, done, total) {
        try {
            this.onProgress({stage, done, total});
        }
        catch (e) {
            log("error", e);
        }
    }

    _manifest(mode, store, frames) {
        const doc = this.document;

        return {
            format: ARCHIVE_FORMAT,
            url: doc.URL,
            title: doc.title,
            captured: new Date().toISOString(),
            engine: this.options.version || "",
            mode,
            options: publicOptions(this.options),
            frames: frames.slice(),
            resources: store.all().map(resource => {
                const entry = {
                    url: resource.url,
                    referrer: resource.referrer,
                    kind: resource.kind,
                    mime: resource.mime,
                    charset: resource.charset,
                    size: resource.size,
                    status: resource.status === "success"? "success": "failure",
                    refs: {html: resource.refs.html, css: resource.refs.css, frames: Array.from(resource.refs.frames)}
                };

                if (resource.hash)
                    entry.sha256 = resource.hash;

                if (resource.path)
                    entry.path = resource.path;

                if (resource.status !== "success")
                    entry.reason = resource.reason || "unknown";

                return entry;
            })
        };
    }
}

function safeDecode(url) {
    try {
        return decodeURIComponent(url);
    }
    catch (e) {
        return url;
    }
}
