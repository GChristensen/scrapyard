import assert from "node:assert/strict";
import {Tag, escapeText} from "../../../addon/capture/content/core/tag.js";
import {SKIP} from "../../../addon/capture/shared/constants.js";

export const tests = {
    "attribute order and quoting"() {
        const tag = new Tag("img", [["src", "a.png"], ["alt", "say \"hi\""]]);
        assert.equal(tag.startTag(), "<img src=\"a.png\" alt=\"say &quot;hi&quot;\">");
        assert.equal(tag.endTag(), "");
        assert.equal(new Tag("div").endTag(), "</div>");
    },

    "set keeps position, appends otherwise; remove"() {
        const tag = new Tag("a", [["href", "x"], ["class", "c"]]);
        tag.set("href", "y");
        tag.set("id", "i");
        assert.equal(tag.startTag(), "<a href=\"y\" class=\"c\" id=\"i\">");
        tag.remove("class");
        assert.equal(tag.startTag(), "<a href=\"y\" id=\"i\">");
        assert.equal(tag.has("class"), false);
        assert.equal(tag.get("href"), "y");
        assert.equal(tag.get("nope"), null);
    },

    "preserve and replace semantics"() {
        const tag = new Tag("img", [["src", "a.png"]]);
        tag.replace("src", "a.png");
        assert.equal(tag.has("data-scrapyard-src"), false, "unchanged value is not preserved");
        tag.replace("src", "data:x");
        assert.equal(tag.get("data-scrapyard-src"), "a.png");
        assert.equal(tag.get("src"), "data:x");

        const noAttr = new Tag("img");
        noAttr.replace("src", "data:y");
        assert.equal(noAttr.has("data-scrapyard-src"), false, "absent attribute is not preserved by replace");
        assert.equal(noAttr.get("src"), "data:y");

        noAttr.preserve("nope");
        assert.equal(noAttr.has("data-scrapyard-nope"), false);
        noAttr.preserve("src");
        assert.equal(noAttr.get("data-scrapyard-src"), "data:y");
    },

    "appendStyle separators"() {
        assert.equal(new Tag("p").appendStyle("x: 1;").get("style"), "x: 1;");
        assert.equal(new Tag("p", [["style", "a: 1"]]).appendStyle("x: 1;").get("style"), "a: 1; x: 1;");
        assert.equal(new Tag("p", [["style", "a: 1;"]]).appendStyle("x: 1;").get("style"), "a: 1; x: 1;");
        assert.equal(new Tag("p", [["style", "a: 1; "]]).appendStyle("x: 1;").get("style"), "a: 1;  x: 1;");
        assert.equal(new Tag("p", [["style", "a: 1"]]).prependStyle("/*m*/ x: 1;").get("style"), "/*m*/ x: 1; a: 1");
    },

    "void elements and drop"() {
        assert.equal(new Tag("br").isVoid, true);
        assert.equal(new Tag("span").isVoid, false);
        const tag = new Tag("style");
        assert.equal(tag.drop(), SKIP);
        assert.equal(tag.dropped, true);
    },

    "escapeText"() {
        assert.equal(escapeText("a<b>&c"), "a&lt;b&gt;&amp;c");
    },

    "Tag.from reads DOM-like elements and drops zoompage-fontsize"() {
        const element = {
            localName: "div",
            attributes: [{name: "id", value: "x"}, {name: "zoompage-fontsize", value: "1"}, {name: "class", value: "y"}]
        };
        assert.equal(Tag.from(element).startTag(), "<div id=\"x\" class=\"y\">");
    }
};
