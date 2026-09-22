// The rule registry: the tag index must agree with the linear scan it replaces, and every rule's declared
// tags must cover every element its match() accepts.

import assert from "node:assert/strict";
import {RULES} from "../../../addon/capture/content/rules/index.js";
import {ruleFor, ruleForLinear} from "../../../addon/capture/content/rules/registry.js";
import {HREF_SVG_ELEMENTS} from "../../../addon/capture/shared/constants.js";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

/** A duck-typed element: the rules read localName, namespaceURI, parentElement, getAttribute and a few IDL props. */
function element(localName, fields = {}) {
    const attributes = fields.attributes || {};

    return {
        localName,
        namespaceURI: fields.namespaceURI || HTML_NS,
        parentElement: fields.parentElement || null,
        getAttribute: name => (name in attributes? attributes[name]: null),
        hasAttribute: name => name in attributes,
        ...fields.props
    };
}

// Every tag the rules are meant to handle, written out independently of what the rules declare: deriving this
// from rule.tags would make the corpus blind to exactly the mistake these tests exist to catch.
const VOCABULARY = [
    "html", "head", "body", "style", "link", "meta", "script", "img", "input", "textarea", "option",
    "source", "audio", "video", "track", "object", "embed", "canvas", "a", "area", "picture",
    ...HREF_SVG_ELEMENTS,
    /* tags no rule claims */
    "div", "span", "p", "li", "td", "section", "svg", "symbol", "text", "g", "defs"
];

/** Every tag of the vocabulary and every tag any rule claims, in the shapes the non-trivial matchers look at. */
function corpus() {
    const tags = new Set(VOCABULARY);

    for (const rule of RULES)
        for (const tag of rule.tags || [])
            tags.add(tag);

    const picture = element("picture");
    const audio = element("audio");
    const svgParent = element("g", {namespaceURI: SVG_NS});
    const elements = [];

    for (const tag of tags)
        for (const ns of [HTML_NS, SVG_NS])
            for (const parent of [null, picture, audio, svgParent]) {
                elements.push(element(tag, {namespaceURI: ns, parentElement: parent}));
                elements.push(element(tag, {namespaceURI: ns, parentElement: parent,
                    attributes: {href: "/a", src: "/b", "http-equiv": "content-security-policy", charset: "utf-8"},
                    props: {rel: "stylesheet", type: "image", href: "/a", src: "/b"}}));
                elements.push(element(tag, {namespaceURI: ns, parentElement: parent,
                    attributes: {href: "/a", src: "/b"}, props: {rel: "icon", type: "text"}}));
            }

    return elements;
}

export const tests = {
    "every rule declares the tags its match can accept"() {
        for (const rule of RULES) {
            assert.ok(Array.isArray(rule.tags) && rule.tags.length > 0,
                `rule "${rule.name}" declares no tags; the registry would fall back to a linear scan`);

            for (const tag of rule.tags)
                assert.equal(typeof tag, "string", `rule "${rule.name}" has a non-string tag`);
        }
    },

    "the tag index returns exactly what the linear scan returns"() {
        for (const el of corpus()) {
            const indexed = ruleFor(el);
            const linear = ruleForLinear(el);

            assert.equal(indexed?.name ?? null, linear?.name ?? null,
                `disagreement on <${el.localName}> in ${el.namespaceURI}: `
                + `index says ${indexed?.name ?? "null"}, scan says ${linear?.name ?? "null"}`);
        }
    },

    "no rule matches an element whose localName it did not declare"() {
        for (const el of corpus())
            for (const rule of RULES)
                if (rule.match(el))
                    assert.ok(rule.tags.includes(el.localName),
                        `rule "${rule.name}" matches <${el.localName}> but does not declare that tag`);
    },

    "the svg href rule declares the shared element list"() {
        const rule = RULES.find(r => r.name === "svg-href");
        assert.deepEqual([...rule.tags], [...HREF_SVG_ELEMENTS]);
    },

    "rules that share a tag keep their order from the list"() {
        const order = RULES.map(r => r.name);
        const svgUse = order.indexOf("svg-use");
        const svgHref = order.indexOf("svg-href");

        /* both claim "use"; the specific rule must win */
        assert.ok(svgUse < svgHref);
        assert.equal(ruleFor(element("use", {namespaceURI: SVG_NS})).name, "svg-use");

        /* both claim "link"; link-stylesheet is tried first */
        assert.ok(order.indexOf("link-stylesheet") < order.indexOf("link-in-svg"));
    }
};
