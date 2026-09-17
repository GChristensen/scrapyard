import assert from "node:assert/strict";
import {ResourceStore} from "../../../addon/capture/content/core/resource_store.js";

const DOC = "https://site/page.html";

function image(url, extra = {}) {
    return {url, baseURI: DOC, kind: "image", expectedMime: "image/png", charset: "", ...extra};
}

export const tests = {
    "dedup by URL without fragment, refs counted"() {
        const store = new ResourceStore(DOC);
        const a = store.remember(image("a.png#x"));
        const b = store.remember(image("https://site/a.png#y"));
        assert.equal(a.isNew, true);
        assert.equal(b.isNew, false);
        assert.equal(a.resource, b.resource);
        assert.equal(a.resource.url, "https://site/a.png");
        assert.equal(a.resource.refs.html, 2);
        assert.equal(a.resource.id, 0);
        assert.equal(store.size, 1);
    },

    "self-references and non-replaceable URLs are rejected"() {
        const store = new ResourceStore(DOC);
        assert.equal(store.remember(image("page.html#top")).resource, null);
        assert.equal(store.remember(image("data:image/png;base64,AA")).resource, null);
        assert.equal(store.remember(image("#frag")).resource, null);
        assert.equal(store.remember(image("")).resource, null);
        assert.equal(store.remember({url: "x.png", baseURI: null, kind: "image", expectedMime: "image/png"}).resource, null);
        assert.equal(store.size, 0);
    },

    "css refs and frame keys, forFrame"() {
        const store = new ResourceStore(DOC);
        store.remember(image("bg.png", {fromCss: true, frameKey: "0"}));
        store.remember(image("bg.png", {fromCss: true, frameKey: "0-1"}));
        store.remember(image("bg.png"));
        const r = store.get("bg.png", DOC);
        assert.equal(r.refs.css, 2);
        assert.equal(r.refs.html, 1);
        assert.deepEqual([...r.refs.frames].sort(), ["0", "0-1"]);
        assert.deepEqual(store.forFrame("0-1").map(r => r.url), ["https://site/bg.png"]);
        assert.deepEqual(store.forFrame("0-2"), []);
    },

    "pending, loaded, failures, byKind"() {
        const store = new ResourceStore(DOC);
        const {resource: a} = store.remember(image("a.png"));
        const {resource: b} = store.remember({url: "s.css", baseURI: DOC, kind: "stylesheet", expectedMime: "text/css", charset: "utf-8"});
        assert.equal(store.pending().length, 2);
        a.status = "success";
        b.status = "failure";
        b.reason = "network";
        assert.equal(store.pending().length, 0);
        assert.equal(store.loaded("a.png", DOC), a);
        assert.equal(store.loaded("s.css", DOC), null);
        assert.deepEqual(store.failures(), [b]);
        assert.deepEqual(store.byKind("stylesheet"), [b]);
        assert.equal(store.all().length, 2);
    },

    "referrer is the base without fragment"() {
        const store = new ResourceStore(DOC);
        const {resource} = store.remember(image("a.png", {baseURI: DOC + "#frag"}));
        assert.equal(resource.referrer, DOC);
    }
};
