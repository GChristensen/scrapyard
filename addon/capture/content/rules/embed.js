// <object data> and <embed src>.

import {MIME} from "../../shared/constants.js";
import {isHTML, isReplaceable, substituteAttribute} from "./common.js";

/** @type {import("../../shared/types.js").ElementRule[]} */
export const embedRules = [
    {
        name: "object",
        match: el => el.localName === "object" && isHTML(el),

        discover(el, ctx) {
            if (el.getAttribute("data") && ctx.options.objectEmbed && isReplaceable(el.data))
                ctx.store.remember({url: el.data, baseURI: ctx.baseURI, kind: "object", expectedMime: MIME.octetStream, charset: ""});
        },

        serialize(el, ctx, tag) {
            substituteAttribute(el, tag, "data", el.data, ctx);
        }
    },
    {
        name: "embed",
        match: el => el.localName === "embed" && isHTML(el),

        discover(el, ctx) {
            if (el.getAttribute("src") && ctx.options.objectEmbed && isReplaceable(el.src))
                ctx.store.remember({url: el.src, baseURI: ctx.baseURI, kind: "object", expectedMime: MIME.octetStream, charset: ""});
        },

        serialize(el, ctx, tag) {
            substituteAttribute(el, tag, "src", el.src, ctx);
        }
    }
];
