import assert from "node:assert/strict";
import {defaultOptions, normalizeOptions, publicOptions} from "../../../addon/capture/shared/options.js";
import {parseContentType, isLoadAllowed} from "../../../addon/capture/shared/http.js";

export const tests = {
    "the lazy scroll bound is always a bound"() {
        /* the loop must never be talked into running forever: 0 and "unlimited" both clamp to one screen */
        assert.equal(normalizeOptions({lazyLoadScrollScreens: 0}).lazyLoadScrollScreens, 1);
        assert.equal(normalizeOptions({lazyLoadScrollScreens: -10}).lazyLoadScrollScreens, 1);
        assert.equal(normalizeOptions({lazyLoadScrollScreens: 1000}).lazyLoadScrollScreens, 100);
        assert.equal(normalizeOptions({lazyLoadScrollScreens: Infinity}).lazyLoadScrollScreens, 5);
        assert.equal(normalizeOptions({lazyLoadScrollScreens: "nope"}).lazyLoadScrollScreens, 5);
        assert.equal(normalizeOptions({lazyLoadScrollScreens: "7"}).lazyLoadScrollScreens, 7);
        assert.equal(normalizeOptions({lazyLoadScrollScreens: 4.6}).lazyLoadScrollScreens, 5);
        assert.equal(defaultOptions().lazyLoadScrollScreens, 5);
    },

    "the run is bounded even when nothing else bounds it"() {
        /* both are safety nets: neither may be switched off by passing something silly */
        assert.equal(defaultOptions().loadTimeout, 15);
        assert.equal(defaultOptions().maxCaptureTime, 600);
        assert.equal(normalizeOptions({loadTimeout: 0}).loadTimeout, 1);
        assert.equal(normalizeOptions({loadTimeout: -1}).loadTimeout, 1);
        assert.equal(normalizeOptions({loadTimeout: 99999}).loadTimeout, 600);
        assert.equal(normalizeOptions({maxCaptureTime: 0}).maxCaptureTime, 60);
        assert.equal(normalizeOptions({maxCaptureTime: 99999}).maxCaptureTime, 7200);
        assert.equal(normalizeOptions({maxCaptureTime: "nope"}).maxCaptureTime, 600);
    },

    "concurrency default and range"() {
        /* 6, not higher: 12 made some sites answer 429 */
        assert.equal(defaultOptions().concurrency, 6);
        assert.equal(normalizeOptions({concurrency: 200}).concurrency, 64);
        assert.equal(normalizeOptions({concurrency: "16"}).concurrency, 16);
        assert.equal(normalizeOptions({}).concurrency, 6);
    },

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
