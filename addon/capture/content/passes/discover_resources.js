// Pass 2: everything else. Computed-style images of displayed elements (or all stylesheet images), style
// attribute images, then the element rules' discover hooks; the root favicon fallback at the end of <head>.

import {MIME} from "../../shared/constants.js";
import {resolve} from "../../shared/url.js";
import {findImageUrls} from "../core/css.js";
import {rememberCssImage} from "../core/stylesheet.js";
import {walk} from "../walker.js";
import {ruleFor} from "../rules/registry.js";

/** @typedef {import("../context.js").CaptureContext} CaptureContext */

const ELEMENT_PROPERTIES = ["background-image", "border-image-source", "list-style-image", "cursor", "filter",
    "clip-path", "mask-image", "-webkit-mask-image"];
const PSEUDO_PROPERTIES = [...ELEMENT_PROPERTIES, "content"];
const FIRST_LETTER_PROPERTIES = ["background-image", "border-image-source"];
const FIRST_LINE_PROPERTIES = ["background-image"];

function computedImages(el, ctx) {
    let css = "";

    const collect = (pseudo, properties) => {
        const style = ctx.computed(el, pseudo);

        if (style)
            for (const property of properties)
                css += style.getPropertyValue(property) + " ";
    };

    collect(null, ELEMENT_PROPERTIES);
    collect("::before", PSEUDO_PROPERTIES);
    collect("::after", PSEUDO_PROPERTIES);
    collect("::first-letter", FIRST_LETTER_PROPERTIES);
    collect("::first-line", FIRST_LINE_PROPERTIES);

    return css;
}

const visitor = {
    enter(el, ctx) {
        /* external images referenced in the computed style of displayed elements */
        if (ctx.options.cssImages === "displayed" && !ctx.crossFrame && ctx.displayed(el))
            for (const url of findImageUrls(computedImages(el, ctx)))
                rememberCssImage(url, ctx.baseURI, ctx);

        /* external images referenced in the style attribute */
        if (el.hasAttribute("style") && (ctx.options.cssImages === "all" || ctx.crossFrame))
            for (const url of findImageUrls(el.getAttribute("style")))
                rememberCssImage(url, ctx.baseURI, ctx);

        const rule = ruleFor(el);

        if (rule && rule.discover)
            rule.discover(el, ctx);
    },

    leave(el, ctx) {
        /* remember the favicon of the website root when the document head has none */
        if (el.localName === "head" && ctx.depth === 0 && ctx.firstIcon === "") {
            ctx.store.remember({url: "/favicon.ico", baseURI: ctx.baseURI, kind: "icon", expectedMime: MIME.icon, charset: ""});

            const location = resolve("/favicon.ico", ctx.baseURI);

            if (location != null)
                ctx.rootIcon = location;
        }
    },

    async frame(el, childCtx) {
        if (childCtx)
            await walk(childCtx, childCtx.doc.documentElement, visitor);
    }
};

/**
 * @param {CaptureContext} ctx  the top context
 */
export async function discoverResources(ctx) {
    await walk(ctx, ctx.doc.documentElement, visitor);
}
