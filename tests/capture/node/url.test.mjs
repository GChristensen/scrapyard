import assert from "node:assert/strict";
import {isReplaceable, resolve, stripFragment, fragmentOf, adjust, unsaved, stripCssEscapes, removeQuotes, relativePath}
    from "../../../addon/capture/shared/url.js";

export const tests = {
    "isReplaceable rejects data, blob, moz-extension, fragment and empty"() {
        assert.equal(isReplaceable("data:image/png;base64,AAA"), false);
        assert.equal(isReplaceable("DATA:text/plain,x"), false);
        assert.equal(isReplaceable("blob:https://a/b"), false);
        assert.equal(isReplaceable("moz-extension://x/y"), false);
        assert.equal(isReplaceable("#top"), false);
        assert.equal(isReplaceable(""), false);
        assert.equal(isReplaceable("https://a/b.png"), true);
        assert.equal(isReplaceable("b.png"), true);
        assert.equal(isReplaceable("chrome-extension://x/y"), true);
    },

    "resolve returns absolute or null"() {
        assert.equal(resolve("b.png", "https://a/x/y.html"), "https://a/x/b.png");
        assert.equal(resolve("../b.png", "https://a/x/y.html"), "https://a/b.png");
        assert.equal(resolve("b.png", null), null);
        assert.equal(resolve("b.png", "not a url"), null);
    },

    "fragments"() {
        assert.equal(stripFragment("https://a/b#c"), "https://a/b");
        assert.equal(stripFragment("https://a/b"), "https://a/b");
        assert.equal(fragmentOf("https://a/b#c"), "#c");
        assert.equal(fragmentOf("https://a/b"), "");
    },

    "adjust makes absolute, fragment-only for the same document"() {
        assert.equal(adjust("b.html", "https://a/x/y.html", "https://a/x/y.html"), "https://a/x/b.html");
        assert.equal(adjust("#top", "https://a/x/y.html", "https://a/x/y.html"), "#top");
        assert.equal(adjust("y.html#top", "https://a/x/y.html", "https://a/x/y.html"), "#top");
        assert.equal(adjust("z.html#top", "https://a/x/y.html", "https://a/x/y.html"), "https://a/x/z.html#top");
        assert.equal(adjust("b.html", null, "https://a/x/y.html"), "b.html");
    },

    "unsaved"() {
        assert.equal(unsaved("b.png", "https://a/", "https://a/", true), "");
        assert.equal(unsaved("b.png", "https://a/", "https://a/", false), "https://a/b.png");
    },

    "stripCssEscapes"() {
        assert.equal(stripCssEscapes("a\\26 b\\3A c\\3d d"), "a&b:c=d");
        assert.equal(stripCssEscapes("a\\26b"), "a&b");
    },

    "removeQuotes"() {
        assert.equal(removeQuotes("\"a\""), "a");
        assert.equal(removeQuotes("'a'"), "a");
        assert.equal(removeQuotes("a"), "a");
        assert.equal(removeQuotes("\"a"), "a");
    },

    "relativePath"() {
        assert.equal(relativePath("index.html", "resources/a.png"), "resources/a.png");
        assert.equal(relativePath("frames/0-1.html", "resources/a.png"), "../resources/a.png");
        assert.equal(relativePath("frames/0-1.html", "frames/0-1-0.html"), "0-1-0.html");
        assert.equal(relativePath("index.html", "frames/0-1.html"), "frames/0-1.html");
    }
};
