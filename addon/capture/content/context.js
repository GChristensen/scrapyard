// CaptureContext: the per-document state of a capture run (top document, each same-origin subframe, each
// parsed cross-origin snapshot). Everything a pass needs to look at an element lives here.

import {BUILTIN_SHADOW, MARK} from "../shared/constants.js";

/** @typedef {import("../shared/types.js").CaptureOptions} CaptureOptions */
/** @typedef {import("../shared/types.js").FrameSnapshot} FrameSnapshot */

export class CaptureContext {
    /**
     * @param {object} fields
     * @param {Document} fields.doc
     * @param {Window|null} fields.win           null for cross-origin snapshots
     * @param {string} fields.frameKey
     * @param {number} fields.depth
     * @param {boolean} fields.crossFrame
     * @param {boolean} fields.noSrcFrame
     * @param {Array} fields.loadedFonts
     * @param {CaptureOptions} fields.options
     * @param {import("./core/resource_store.js").ResourceStore} fields.store
     * @param {object} fields.sink
     * @param {object} fields.quirks
     * @param {{url: string}|null} fields.savedPage
     * @param {Map<string, FrameSnapshot>} fields.frames
     * @param {object} fields.run                state shared by every context of the run
     * @param {CaptureContext|null} [fields.parent]
     */
    constructor(fields) {
        this.doc = fields.doc;
        this.win = fields.win;
        this.frameKey = fields.frameKey;
        this.depth = fields.depth;
        this.crossFrame = !!fields.crossFrame;
        this.noSrcFrame = !!fields.noSrcFrame;
        this.loadedFonts = fields.loadedFonts || [];
        this.options = fields.options;
        this.store = fields.store;
        this.sink = fields.sink;
        this.quirks = fields.quirks;
        this.savedPage = fields.savedPage || null;
        this.frames = fields.frames;
        this.run = fields.run;
        this.parent = fields.parent || null;
        this.isFirefox = !!fields.options.isFirefox;

        /** @type {string[]} output strings of this document (owned by the sink) */
        this.out = [];
        /** archive-relative path of this document (unpacked mode) */
        this.documentPath = null;
        /** first <link rel=icon> location seen in this document */
        this.firstIcon = "";
        /** /favicon.ico fallback location */
        this.rootIcon = "";
    }

    get baseURI() {
        return this.doc.baseURI;
    }

    get documentURI() {
        return this.doc.documentURI;
    }

    get characterSet() {
        return this.doc.characterSet;
    }

    /** @returns {"packed"|"unpacked"} */
    get mode() {
        return this.run.mode;
    }

    /**
     * @param {Element} el
     * @returns {boolean} true in cross-frame contexts, else computed display != none (the overlay is never displayed)
     */
    displayed(el) {
        if (this.crossFrame)
            return true;

        if (el.id === MARK.overlay)
            return false;

        const style = this.computed(el);

        return style == null || style.getPropertyValue("display") !== "none";
    }

    /**
     * @param {Element} el
     * @param {string} [pseudo]
     * @returns {CSSStyleDeclaration|null} null in cross-frame contexts
     */
    computed(el, pseudo) {
        if (this.crossFrame || !this.win)
            return null;

        try {
            return this.win.getComputedStyle(el, pseudo || null);
        }
        catch (e) {
            return null;
        }
    }

    /**
     * @param {Element} el
     * @returns {ShadowRoot|null} the open or closed shadow root, null for elements with built-in shadow DOM
     */
    shadowRootOf(el) {
        if (BUILTIN_SHADOW.includes(el.localName))
            return null;

        if (el.shadowRoot)
            return el.shadowRoot;

        try {
            if (this.isFirefox)
                return el.openOrClosedShadowRoot || null;

            const dom = globalThis.chrome?.dom;

            if (dom && el.namespaceURI === "http://www.w3.org/1999/xhtml")
                return dom.openOrClosedShadowRoot(el) || null;
        }
        catch (e) {
            /* not supported */
        }

        return null;
    }

    /**
     * A child context for a subframe document.
     * @param {object} fields  {doc, win, frameKey, crossFrame, loadedFonts, noSrcFrame}
     * @returns {CaptureContext}
     */
    child(fields) {
        return new CaptureContext({
            doc: fields.doc,
            win: fields.win,
            frameKey: fields.frameKey,
            depth: this.depth + 1,
            crossFrame: this.crossFrame || !!fields.crossFrame,
            noSrcFrame: fields.noSrcFrame,
            loadedFonts: fields.loadedFonts,
            options: this.options,
            store: this.store,
            sink: this.sink,
            quirks: this.quirks,
            savedPage: this.savedPage,
            frames: this.frames,
            run: this.run,
            parent: this
        });
    }
}
