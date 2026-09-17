// <script>: saved only when the option is on, in same-origin frames that have a src; otherwise neutered.

import {MARK, MIME} from "../../shared/constants.js";
import {isHTML, isReplaceable, substitute} from "./common.js";

function saving(ctx) {
    return ctx.options.scripts && !ctx.crossFrame && !ctx.noSrcFrame;
}

function neuter(el, tag) {
    if (el.hasAttribute("type"))
        tag.preserve("type");
    else
        tag.set(MARK.original("type"), "");

    tag.set("type", "text/plain");
}

/** @type {import("../../shared/types.js").ElementRule[]} */
export const scriptRules = [
    {
        name: "script",
        match: el => el.localName === "script" && isHTML(el),

        discover(el, ctx) {
            if (!saving(ctx) || !el.getAttribute("src") || !isReplaceable(el.src))
                return;

            ctx.store.remember({url: el.src, baseURI: ctx.baseURI, kind: "script", expectedMime: MIME.javascript,
                charset: el.charset || ctx.characterSet});
        },

        serialize(el, ctx, tag) {
            const src = el.getAttribute("src");

            if (saving(ctx)) {
                if (src) {
                    if (isReplaceable(el.src))
                        tag.replace("src", substitute(src, ctx));

                    tag.text = "";
                }
                else
                    tag.text = el.textContent;   /* internal script, raw */

                if (!ctx.options.executeScripts)
                    neuter(el, tag);

                return;
            }

            if (src) {
                tag.preserve("src");
                tag.remove("src");   /* src="" would be invalid HTML */
                tag.text = "";
            }
            else
                tag.text = el.textContent;   /* kept as raw text, neutered below (directive 10.4) */

            neuter(el, tag);
        }
    }
];
