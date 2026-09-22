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
    "token type comes from the matched alternation, not from the token text"() {
        /* leading whitespace, mixed case and a @font-face block whose text starts far from its keyword */
        const css = [
            "  @import 'a.css';",
            "@IMPORT url(b.css);",
            "@font-face { font-family: x; src: URL('f.woff2') format('woff2'); }",
            "div { background: URL( c.png ); }",
            "/* url(comment.png) */",
            "p::after { content: 'url(string.png)'; }"
        ].join("\n");

        const types = tokenize(css).map(t => t.type);

        assert.deepEqual(types, ["import", "import", "fontface", "url", "comment", "string"]);

        const tokens = tokenize(css);
        assert.equal(tokens[0].lead, " ");                       // the space before @import is captured
        assert.equal(tokens[0].value, "'a.css'");
        assert.equal(tokens[1].value, "b.css");
        assert.ok(tokens[2].value.startsWith("{"));              // the whole block
        assert.equal(tokens[3].value, "c.png");
        assert.equal(tokens[4].value, "/* url(comment.png) */"); // comments keep their own text
    },

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

// The four-pass implementation expandInset() replaced. Kept here so the single-pass version is checked against
// the behaviour it is meant to preserve, not only against hand-written expectations.
function expandInsetReference(css) {
    css = css.replace(/([{;]\s*)inset\s*:\s*([^\s]+)\s*;/gi, "$1top: $2; right: $2; bottom: $2; left: $2;");
    css = css.replace(/([{;]\s*)inset\s*:\s*([^\s]+)\s+([^\s]+)\s*;/gi, "$1top: $2; right: $3; bottom: $2; left: $3;");
    css = css.replace(/([{;]\s*)inset\s*:\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*;/gi, "$1top: $2; right: $3; bottom: $4; left: $3;");
    css = css.replace(/([{;]\s*)inset\s*:\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*;/gi, "$1top: $2; right: $3; bottom: $4; left: $5;");
    return css;
}

const INSET_CASES = [
    "a { inset: 5px; }",
    "a { inset: 1px 2px; }",
    "a { inset: 1px 2px 3px; }",
    "a { inset: 1px 2px 3px 4px; }",
    "a { color: red; inset: 0; top: 1px; }",
    "a { inset : 10% auto ; }",
    "a{inset:0 0 0 0;}",
    "a { inset: calc(1px+2px) 2px; }",
    "a { insetter: 1px; }",
    "a { outline: inset; }",
    ".inset { color: red; }",
    "a { inset: 1px 2px 3px 4px 5px; }",
    "a { color: red; }",
    "@media screen { b { inset: 2em 3em; } }"
];

tests["expandInset matches the four-pass implementation it replaced"] = () => {
    for (const css of INSET_CASES)
        assert.equal(expandInset(css), expandInsetReference(css), "differs for: " + css);

    /* and the whole corpus concatenated, so one rule cannot disturb the next */
    const all = INSET_CASES.join("\n");
    assert.equal(expandInset(all), expandInsetReference(all));
};

tests["expandInset expands each shorthand arity"] = () => {
    assert.equal(expandInset("a { inset: 5px; }"), "a { top: 5px; right: 5px; bottom: 5px; left: 5px; }");
    assert.equal(expandInset("a { inset: 1px 2px; }"), "a { top: 1px; right: 2px; bottom: 1px; left: 2px; }");
    assert.equal(expandInset("a { inset: 1px 2px 3px; }"), "a { top: 1px; right: 2px; bottom: 3px; left: 2px; }");
    assert.equal(expandInset("a { inset: 1px 2px 3px 4px; }"), "a { top: 1px; right: 2px; bottom: 3px; left: 4px; }");
    assert.equal(expandInset("a { color: red; }"), "a { color: red; }");
};
