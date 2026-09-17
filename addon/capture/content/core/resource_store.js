// The resource table of a capture run: one Resource per URL (fragment stripped), discovery order. DOM-free.

import {isReplaceable, resolve, stripFragment} from "../../shared/url.js";

/** @typedef {import("../../shared/types.js").Resource} Resource */
/** @typedef {import("../../shared/types.js").RememberRequest} RememberRequest */
/** @typedef {import("../../shared/types.js").ResourceKind} ResourceKind */

export class ResourceStore {
    /** @param {string} documentURL  URL of the top document; self-references are rejected */
    constructor(documentURL = "") {
        /** @type {Resource[]} */
        this._list = [];
        /** @type {Map<string, Resource>} */
        this._byUrl = new Map();
        this._documentURL = stripFragment(documentURL || "");
    }

    /**
     * @param {RememberRequest} request
     * @returns {{resource: Resource|null, isNew: boolean}}
     */
    remember(request) {
        const url = this.key(request.url, request.baseURI);

        if (url == null)
            return {resource: null, isNew: false};

        const existing = this._byUrl.get(url);

        if (existing) {
            this._count(existing, request);
            return {resource: existing, isNew: false};
        }

        /** @type {Resource} */
        const resource = {
            id: this._list.length,
            url,
            referrer: stripFragment(request.baseURI),
            kind: request.kind,
            expectedMime: request.expectedMime,
            mime: request.expectedMime,
            charset: request.charset || "",
            passive: !!request.passive,
            status: "pending",
            reason: "",
            bytes: null,
            text: null,
            size: 0,
            refs: {html: 0, css: 0, frames: new Set()},
            replaced: 0,
            hash: null,
            path: null
        };

        this._count(resource, request);
        this._list.push(resource);
        this._byUrl.set(url, resource);

        return {resource, isNew: true};
    }

    _count(resource, request) {
        if (request.fromCss) {
            resource.refs.css++;

            if (request.frameKey != null)
                resource.refs.frames.add(request.frameKey);
        }
        else
            resource.refs.html++;
    }

    /**
     * The identity key of a URL: resolved against the base, fragment stripped; null when not replaceable,
     * unresolvable, empty, or a self-reference.
     * @param {string} url
     * @param {string} baseURI
     * @returns {string|null}
     */
    key(url, baseURI) {
        if (!isReplaceable(url) || baseURI == null)
            return null;

        const location = resolve(url, baseURI);

        if (location == null)
            return null;

        const key = stripFragment(location);

        if (key === "" || key === stripFragment(baseURI) || key === this._documentURL)
            return null;

        return key;
    }

    /**
     * @param {string} url
     * @param {string} baseURI
     * @returns {Resource|null}
     */
    get(url, baseURI) {
        const key = this.key(url, baseURI);
        return key == null? null: (this._byUrl.get(key) || null);
    }

    /**
     * @param {string} url
     * @param {string} baseURI
     * @returns {Resource|null} the resource only if it loaded successfully
     */
    loaded(url, baseURI) {
        const resource = this.get(url, baseURI);
        return resource && resource.status === "success"? resource: null;
    }

    /** @returns {Resource[]} */
    pending() {
        return this._list.filter(r => r.status === "pending");
    }

    /** @returns {Resource[]} */
    all() {
        return this._list.slice();
    }

    /**
     * @param {ResourceKind} kind
     * @returns {Resource[]}
     */
    byKind(kind) {
        return this._list.filter(r => r.kind === kind);
    }

    /** @returns {Resource[]} */
    failures() {
        return this._list.filter(r => r.status === "failure");
    }

    /**
     * @param {string} frameKey
     * @returns {Resource[]} resources referenced from CSS in that frame (merged CSS variables)
     */
    forFrame(frameKey) {
        return this._list.filter(r => r.refs.frames.has(frameKey));
    }

    /** @returns {number} */
    get size() {
        return this._list.length;
    }
}
