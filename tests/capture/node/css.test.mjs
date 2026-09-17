import assert from "node:assert/strict";
import {tokenize, rewrite, findImports, findImageUrls, rewriteImageUrls, unescapeValue, expandInset,
    commentFontDisplay, escapeStyleEnd} from "../../../addon/capture/content/core/css.js";

const SHEET = `
@import url("a.css");
@import 'b.css';
@import c.css;
/* url(inside-comment.png) */
.x { background: url(real.png); content: "url(in-string.png)"; }
.y { background: url( 'quoted.png' ) }
@font-face { font-family: "F"; src: url(f.woff2) format("woff2"), url(f.woff) format("woff"); font-display: swap; }
.z { content: 'it\\'s url(single.png)'; }
`;

export const tests = {
    "tokenizer ignores URLs inside strings and comments"() {
        const tokens = tokenize(SHEET);
        const urls = tokens.filter(t => t.type === "url").map(t => t.value);
        assert.deepEqual(urls, ["real.png", "'quoted.png'"]);

        const imports = tokens.filter(t => t.type === "import").map(t => t.value);
        assert.deepEqual(imports, ["\"a.css\"", "'b.css'", "c.css"]);

        assert.equal(tokens.filter(t => t.type === "fontface").length, 1);
        assert.equal(tokens.filter(t => t.type === "comment").length, 1);
        assert.equal(tokens.filter(t => t.type === "string").length, 2);
    },

    "findImports handles bare, quoted and url() forms"() {
        assert.deepEqual(findImports(SHEET), ["a.css", "b.css", "c.css"]);
        assert.deepEqual(findImports("@import url(x.css) screen;"), []);   // media query form is not matched (as today)
        assert.deepEqual(findImports("@import url( \"y.css\" );"), ["y.css"]);
    },

    "findImageUrls (no string/comment awareness, as the computed-style scan)"() {
        assert.deepEqual(findImageUrls("url(a.png) url(\"b.png\") none url( 'c.png' )"), ["a.png", "b.png", "c.png"]);
    },

    "rewrite leaves strings and comments untouched"() {
        const out = rewrite(SHEET, token => {
            if (token.type === "url")
                return token.lead + "url(X)";
            if (token.type === "import")
                return token.lead + "/*I*/";
            return token.match;
        });
        assert.ok(out.includes("/* url(inside-comment.png) */"));
        assert.ok(out.includes("\"url(in-string.png)\""));
        assert.ok(out.includes("background: url(X)"));
        assert.ok(out.includes("background: url(X) }"));
        assert.ok(!out.includes("@import"));
        assert.ok(out.includes("url(f.woff2)"), "font-face blocks are returned as a whole");
    },

    "rewriteImageUrls keeps originals for null"() {
        const out = rewriteImageUrls("a: url(x.png); b: url('y.png')", (url, lead) => url === "x.png"? lead + "url(Z)": null);
        assert.equal(out, "a: url(Z); b: url('y.png')");
    },

    "unescapeValue"() {
        assert.equal(unescapeValue("a\\26 b"), "a& b");   // the trailing space is not consumed, as today
        assert.equal(unescapeValue("\\\"q\\\""), "\"q\"");
        assert.equal(unescapeValue("\\110000"), "�");
    },

    "expandInset"() {
        assert.equal(expandInset(".a{inset: 0;}"), ".a{top: 0; right: 0; bottom: 0; left: 0;}");
        assert.equal(expandInset(".a{inset: 1px 2px;}"), ".a{top: 1px; right: 2px; bottom: 1px; left: 2px;}");
        assert.equal(expandInset(".a{inset: 1px 2px 3px;}"), ".a{top: 1px; right: 2px; bottom: 3px; left: 2px;}");
        assert.equal(expandInset(".a{color: red; inset: 1px 2px 3px 4px;}"), ".a{color: red; top: 1px; right: 2px; bottom: 3px; left: 4px;}");
    },

    "commentFontDisplay"() {
        const block = "{ src: url(a.woff); font-display: swap; }";
        assert.equal(commentFontDisplay(block, v => `/*fd=${v}*/`), "{ src: url(a.woff); /*fd=swap*/ }");
    },

    "escapeStyleEnd"() {
        assert.equal(escapeStyleEnd("a{content:'</style>'}"), "a{content:'<\\/style>'}");
    }
};
