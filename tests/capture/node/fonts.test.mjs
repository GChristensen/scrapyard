import assert from "node:assert/strict";
import {parseFontFace, matchesLoadedFont, fontFileType, selectFontFiles} from "../../../addon/capture/content/core/fonts.js";

const BLOCK = `{
    font-family: "My Font";
    font-weight: bold;
    font-style: italic;
    src: url(a.eot);
    src: url(a.eot?#iefix) format("embedded-opentype"), url("a.woff2") format("woff2"), url('a.woff') format("woff"), url(a.ttf) format("truetype");
}`;

export const tests = {
    "parseFontFace with defaults for invalid values"() {
        assert.deepEqual(parseFontFace(BLOCK), {family: "my font", weight: "bold", style: "italic", stretch: "normal"});
        assert.deepEqual(parseFontFace("{ font-family: Foo\\ Bar; font-weight: 450; font-stretch: condensed; }"),
            {family: "foo bar", weight: "normal", style: "normal", stretch: "condensed"});
        assert.equal(parseFontFace("{ src: url(x.woff) }").family, "");
    },

    "matchesLoadedFont compares all four descriptors"() {
        const face = parseFontFace(BLOCK);
        assert.equal(matchesLoadedFont(face, [{family: "\"My Font\"", weight: "bold", style: "italic", stretch: "normal"}]), true);
        assert.equal(matchesLoadedFont(face, [{family: "My Font", weight: "normal", style: "italic", stretch: "normal"}]), false);
        assert.equal(matchesLoadedFont(face, []), false);
    },

    "fontFileType from format hints and extensions"() {
        assert.equal(fontFileType("x", "\"woff2\""), "woff2");
        assert.equal(fontFileType("x", "'woff'"), "woff");
        assert.equal(fontFileType("x", "'truetype'"), "ttf");
        assert.equal(fontFileType("x", "'opentype'"), "otf");
        assert.equal(fontFileType("x", "'embedded-opentype'"), "");
        assert.equal(fontFileType("a.woff2", undefined), "woff2");
        assert.equal(fontFileType("a.woff", undefined), "woff");
        assert.equal(fontFileType("a.ttf?x", undefined), "ttf");
        assert.equal(fontFileType("a.otf", undefined), "otf");
        assert.equal(fontFileType("a.eot", undefined), "");
    },

    "selectFontFiles: used"() {
        assert.deepEqual(selectFontFiles(BLOCK, "used"), ["a.woff2"]);
    },

    "selectFontFiles: woff (first file plus the woff, then stop)"() {
        assert.deepEqual(selectFontFiles(BLOCK, "woff"), ["a.woff2", "a.woff"]);
        // first file already woff: stop immediately
        assert.deepEqual(selectFontFiles("{ src: url(b.woff), url(b.ttf); }", "woff"), ["b.woff"]);
    },

    "selectFontFiles: all"() {
        assert.deepEqual(selectFontFiles(BLOCK, "all"), ["a.woff2", "a.woff", "a.ttf"]);
    },

    "selectFontFiles: multiple src lists and data urls"() {
        const block = "{ src: url(data:font/woff;base64,AAA) format('woff'); src: url(c.ttf); }";
        assert.deepEqual(selectFontFiles(block, "used"), ["c.ttf"]);
    }
};
