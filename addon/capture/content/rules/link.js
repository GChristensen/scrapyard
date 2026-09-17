// Other <link> elements (icons, prefetch family, everything else), <link> inside SVG, <a> and <area>.

import {MIME} from "../../shared/constants.js";
import {resolve} from "../../shared/url.js";
import {isHTML, insideSVG, isReplaceable, substitute, unsavedOf, adjustOf} from "./common.js";
import {isStylesheetLink} from "./style.js";

const PREFETCH_RELS = ["dns-prefetch", "preconnect", "prefetch", "preload", "prerender"];

function isIconLink(el) {
    const rel = (el.rel || "").toLowerCase();
    return (rel === "icon" || rel === "shortcut icon") && !!el.getAttribute("href");
}

/** @type {import("../../shared/types.js").ElementRule[]} */
export const linkRules = [
    {
        name: "link-in-svg",
        match: el => el.localName === "link" && insideSVG(el),

        serialize(el, ctx, tag) {
            /* <link> is invalid inside <svg>; it is not void there, so the parser nests the following siblings in it */
            tag.unwrap();
        }
    },
    {
        name: "link",
        match: el => el.localName === "link" && isHTML(el) && !isStylesheetLink(el),

        discover(el, ctx) {
            if (!isIconLink(el) || !isReplaceable(el.href))
                return;

            ctx.store.remember({url: el.href, baseURI: ctx.baseURI, kind: "icon", expectedMime: MIME.icon, charset: ""});

            if (ctx.firstIcon === "") {
                const location = resolve(el.href, ctx.baseURI);

                if (location != null)
                    ctx.firstIcon = location;
            }
        },

        serialize(el, ctx, tag) {
            const href = el.getAttribute("href");

            if (isIconLink(el)) {
                if (isReplaceable(el.href))
                    tag.replace("href", substitute(href, ctx));

                return;
            }

            if (href == null)
                return;

            const rel = (el.rel || "").toLowerCase();

            if (PREFETCH_RELS.some(r => rel.includes(r))) {
                tag.preserve("href");
                tag.set("href", "");
                return;
            }

            tag.replace("href", unsavedOf(href, ctx));
        }
    },
    {
        name: "anchor",
        match: el => (el.localName === "a" && isHTML(el)) || el.localName === "area",

        serialize(el, ctx, tag) {
            const href = el.getAttribute("href");

            if (href)
                tag.replace("href", adjustOf(href, ctx));
        }
    }
];
