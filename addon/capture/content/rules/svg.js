// SVG <a>, <use> and the other href-bearing SVG elements.

import {MARK, MIME, HREF_SVG_ELEMENTS} from "../../shared/constants.js";
import {isSVG, isReplaceable, substitute, adjustOf} from "./common.js";

function hrefOf(el) {
    return el.getAttribute("href") || el.getAttribute("xlink:href");
}

function baseHref(el) {
    try {
        return el.href.baseVal;
    }
    catch (e) {
        return hrefOf(el);
    }
}

/** Sets href (dropping an xlink:href in place) and keeps the original in data-scrapyard-href. */
function setHref(tag, original, value) {
    tag.set(MARK.original("href"), original);

    if (tag.has("xlink:href") && !tag.has("href"))
        tag.rename("xlink:href", "href");

    tag.set("href", value);
}

function discoverHref(el, ctx) {
    const original = hrefOf(el);

    if (!original)
        return;

    const adjusted = adjustOf(original, ctx);

    if (adjusted[0] !== "#" && isReplaceable(baseHref(el)))
        ctx.store.remember({url: baseHref(el), baseURI: ctx.baseURI, kind: "svg", expectedMime: MIME.svg, charset: ""});
}

/** @type {import("../../shared/types.js").ElementRule[]} */
export const svgRules = [
    {
        name: "svg-a",
        match: el => el.localName === "a" && isSVG(el),

        serialize(el, ctx, tag) {
            const original = hrefOf(el);

            if (!original)
                return;

            const adjusted = adjustOf(original, ctx);

            if (adjusted !== original)
                setHref(tag, original, adjusted);
        }
    },
    {
        name: "svg-use",
        match: el => el.localName === "use" && isSVG(el),

        discover: discoverHref,

        serialize(el, ctx, tag) {
            const original = hrefOf(el);

            if (!original)
                return;

            const adjusted = adjustOf(original, ctx);

            if (adjusted[0] === "#") {   /* fragment only */
                if (adjusted !== original)
                    setHref(tag, original, adjusted);

                return;
            }

            const href = baseHref(el);

            if (!isReplaceable(href))
                return;

            const resource = ctx.store.loaded(href, ctx.baseURI);
            const text = resource && resource.text != null? resource.text: "";
            const doc = new DOMParser().parseFromString(text, "text/html");
            let element;
            let value;

            if (href.includes("#")) {   /* SVG 1.1 & SVG 2: insert the fragment element and descendants */
                const fragment = href.slice(href.indexOf("#") + 1);
                element = doc.getElementById(fragment);
                value = (element && element.localName === "symbol")? "#" + fragment: "";
            }
            else {   /* SVG 2, no fragment: insert the root <svg> element and descendants */
                element = doc.body.children[0];
                value = "";
            }

            if (element) {
                if (resource)
                    resource.replaced++;

                setHref(tag, original, value);
                tag.afterEnd = MARK.symbolInsert + element.outerHTML;
            }
        }
    },
    {
        name: "svg-href",
        match: el => isSVG(el) && HREF_SVG_ELEMENTS.includes(el.localName),

        discover: discoverHref,

        serialize(el, ctx, tag) {
            const original = hrefOf(el);

            if (!original)
                return;

            const adjusted = adjustOf(original, ctx);

            if (adjusted[0] === "#") {
                if (adjusted !== original)
                    setHref(tag, original, adjusted);

                return;
            }

            if (isReplaceable(baseHref(el))) {
                const value = substitute(original, ctx);

                if (value !== original)
                    setHref(tag, original, value);
            }
        }
    }
];
