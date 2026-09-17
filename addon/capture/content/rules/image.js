// <body background>, <img>, <input type=image>, <source srcset> inside <picture>.

import {MARK, MIME} from "../../shared/constants.js";
import {createCanvasDataURL} from "../snapshot.js";
import {isHTML, isReplaceable, substitute, substituteAttribute, unsavedOf, imageGate} from "./common.js";

/**
 * The current source of an image with both workarounds: Firefox reports an empty currentSrc in cross-origin
 * frames, Chrome reports a wrong fragment for SVG images; both fall back to the src attribute.
 * @param {HTMLImageElement} el
 * @returns {string}
 */
export function currentSrcOf(el) {
    const current = el.currentSrc || "";

    if (current === "" || current.includes("#"))
        return el.getAttribute("src")? el.src: "";

    return current;
}

function isInputImage(el) {
    return el.localName === "input" && isHTML(el) && (el.type || "").toLowerCase() === "image" && !!el.getAttribute("src");
}

/** @type {import("../../shared/types.js").ElementRule[]} */
export const imageRules = [
    {
        name: "body",
        match: el => el.localName === "body" && isHTML(el),

        discover(el, ctx) {
            if (el.getAttribute("background") && imageGate(el, ctx) && isReplaceable(el.background))
                ctx.store.remember({url: el.background, baseURI: ctx.baseURI, kind: "image", expectedMime: MIME.png, charset: ""});
        },

        serialize(el, ctx, tag) {
            substituteAttribute(el, tag, "background", el.background, ctx);
        }
    },
    {
        name: "img",
        match: el => el.localName === "img" && isHTML(el),

        discover(el, ctx) {
            const current = currentSrcOf(el);

            if (current === "" || !imageGate(el, ctx) || !isReplaceable(current))
                return;

            const passive = !((el.parentElement && el.parentElement.localName === "picture")
                || el.hasAttribute("srcset") || el.hasAttribute("crossorigin"));

            ctx.store.remember({url: current, baseURI: ctx.baseURI, kind: "image", expectedMime: MIME.png, charset: "", passive});
        },

        serialize(el, ctx, tag) {
            const style = ctx.options.hiddenElements === "remove"? ctx.computed(el): null;
            const visible = style == null
                || (style.getPropertyValue("visibility") !== "hidden" && style.getPropertyValue("opacity") !== "0");

            if (!visible) {
                /* images hidden by the page, page editors or content blockers: keep the box, drop the sources */
                const width = style.getPropertyValue("width");
                const height = style.getPropertyValue("height");

                tag.appendStyle(MARK.cssRemove + " width: " + width + " !important; height: " + height + " !important;");
                tag.remove("src");
                tag.remove("srcset");
                tag.remove(MARK.blobDataUri);
                return;
            }

            const current = currentSrcOf(el);
            const src = el.getAttribute("src");

            if (current !== "") {
                if (isReplaceable(current)) {
                    if (current !== src)
                        tag.set(MARK.original("currentsrc"), current);

                    tag.preserve("src");
                    tag.set("src", substitute(current, ctx));
                }
                else if (current.slice(0, 5).toLowerCase() === "data:")
                    tag.replace("src", current);
                else if (el.hasAttribute(MARK.blobDataUri) || current.startsWith("blob:")) {
                    let dataUrl = el.getAttribute(MARK.blobDataUri) || createCanvasDataURL(el);

                    if (dataUrl === "")
                        dataUrl = unsavedOf(src || current, ctx);

                    if (current !== src)
                        tag.set(MARK.original("currentsrc"), current);

                    tag.preserve("src");
                    tag.set("src", dataUrl);
                }
            }

            tag.remove(MARK.blobDataUri);

            if (el.getAttribute("srcset")) {
                /* currentSrc may be one of these URLs; the others are unsaved */
                tag.preserve("srcset");
                tag.set("srcset", "");
            }
        }
    },
    {
        name: "input-image",
        match: isInputImage,

        discover(el, ctx) {
            if (imageGate(el, ctx) && isReplaceable(el.src))
                ctx.store.remember({url: el.src, baseURI: ctx.baseURI, kind: "image", expectedMime: MIME.png, charset: ""});
        },

        serialize(el, ctx, tag) {
            substituteAttribute(el, tag, "src", el.src, ctx);
            syncInputValue(el, tag);
        }
    },
    {
        name: "picture-source",
        match: el => el.localName === "source" && isHTML(el) && el.parentElement != null && el.parentElement.localName === "picture",

        serialize(el, ctx, tag) {
            if (el.getAttribute("srcset")) {
                tag.preserve("srcset");
                tag.set("srcset", "");
            }
        }
    }
];

/**
 * Reinstates the live value/checked state of an <input> (shared with rules/form.js).
 * @param {HTMLInputElement} el
 * @param {import("../core/tag.js").Tag} tag
 */
export function syncInputValue(el, tag) {
    const type = (el.type || "").toLowerCase();

    if (type === "file" || type === "password")
        tag.set("value", "");   /* maintain security */
    else if (type === "checkbox" || type === "radio") {
        if (el.checked)
            tag.set("checked", "");
        else
            tag.remove("checked");
    }
    else
        tag.set("value", el.value);
}
