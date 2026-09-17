import assert from "node:assert/strict";
import {defaultOptions, normalizeOptions, publicOptions} from "../../../addon/capture/shared/options.js";
import {parseContentType, isLoadAllowed} from "../../../addon/capture/shared/http.js";

export const tests = {
    "normalizeOptions fills defaults and rejects invalid values"() {
        const o = normalizeOptions({images: "displayed", fonts: "nope", maxFrameDepth: "3", concurrency: 0,
            scripts: true, executeScripts: "yes", version: "2.3", lazyLoad: "shrink"});
        assert.equal(o.images, "displayed");
        assert.equal(o.fonts, "all");
        assert.equal(o.maxFrameDepth, 3);
        assert.equal(o.concurrency, 1);
        assert.equal(o.scripts, true);
        assert.equal(o.executeScripts, true);
        assert.equal(o.version, "2.3");
        assert.equal(o.lazyLoad, "shrink");
        assert.deepEqual(normalizeOptions(null), defaultOptions());
        assert.deepEqual(normalizeOptions(undefined), defaultOptions());
    },

    "publicOptions drops host-only fields"() {
        const p = publicOptions(defaultOptions());
        assert.equal("lockIconUrl" in p, false);
        assert.equal("shadowLoaderSource" in p, false);
        assert.equal("isFirefox" in p, false);
        assert.equal("images" in p, true);
    },

    "parseContentType"() {
        assert.deepEqual(parseContentType("text/CSS; charset=UTF-8"), {mime: "text/css", charset: "utf-8"});
        assert.deepEqual(parseContentType("image/png"), {mime: "image/png", charset: ""});
        assert.deepEqual(parseContentType(null), {mime: "", charset: ""});
        assert.deepEqual(parseContentType("text/html;charset=\"iso-8859-1\""), {mime: "text/html", charset: "iso-8859-1"});
    },

    "mixed-content rule"() {
        const r = (url, referrer, passive = false) => ({url, referrer, passive});
        assert.equal(isLoadAllowed(r("https://x/a.png", "https://x/"), "https:", false), true);
        assert.equal(isLoadAllowed(r("http://x/a.png", "http://x/"), "http:", false), true);
        assert.equal(isLoadAllowed(r("http://x/a.png", "https://x/"), "https:", false), false);
        assert.equal(isLoadAllowed(r("http://x/a.png", "https://x/", true), "https:", true), true);
        assert.equal(isLoadAllowed(r("http://x/a.png", "https://x/", true), "https:", false), false);
        assert.equal(isLoadAllowed(r("http://x/a.png", "http://x/"), "https:", false), false);
        assert.equal(isLoadAllowed(r("file:///a.png", "file:///b.html"), "file:", false), true, "local files of a local page");
        assert.equal(isLoadAllowed(r("file:///a.png", "https://x/"), "https:", false), false);
    }
};
