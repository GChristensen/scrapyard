// <audio>, <video>, <source> inside them, <track>.

import {MARK, MIME} from "../../shared/constants.js";
import {createCanvasDataURL} from "../snapshot.js";
import {isHTML, isReplaceable, substitute, substituteAttribute, unsavedOf, imageGate} from "./common.js";

function isMediaSource(el) {
    return el.localName === "source" && isHTML(el) && el.parentElement != null
        && (el.parentElement.localName === "audio" || el.parentElement.localName === "video");
}

function rememberMedia(el, url, kind, ctx, passive) {
    if (isReplaceable(url))
        ctx.store.remember({url, baseURI: ctx.baseURI, kind, expectedMime: kind === "audio"? MIME.audio: MIME.video,
            charset: "", passive});
}

/** @type {import("../../shared/types.js").ElementRule[]} */
export const mediaRules = [
    {
        name: "audio",
        match: el => el.localName === "audio" && isHTML(el),

        discover(el, ctx) {
            if (el.getAttribute("src") && el.src === el.currentSrc && ctx.options.audioVideo)
                rememberMedia(el, el.src, "audio", ctx, !el.hasAttribute("crossorigin"));
        },

        serialize(el, ctx, tag) {
            serializeMediaSrc(el, ctx, tag);
        }
    },
    {
        name: "video",
        match: el => el.localName === "video" && isHTML(el),

        discover(el, ctx) {
            if (el.getAttribute("src") && el.src === el.currentSrc && ctx.options.audioVideo)
                rememberMedia(el, el.src, "video", ctx, !el.hasAttribute("crossorigin"));

            if (el.getAttribute("poster") && ctx.options.audioVideo && imageGate(el, ctx) && isReplaceable(el.poster))
                ctx.store.remember({url: el.poster, baseURI: ctx.baseURI, kind: "image", expectedMime: MIME.png, charset: ""});
        },

        serialize(el, ctx, tag) {
            serializeMediaSrc(el, ctx, tag);

            if (el.getAttribute("poster"))
                substituteAttribute(el, tag, "poster", el.poster, ctx);
            else if (el.hasAttribute(MARK.blobDataUri) || (el.src || "").startsWith("blob:")) {
                /* a blob: video: the snapshot frame becomes the poster */
                const dataUrl = el.getAttribute(MARK.blobDataUri) || createCanvasDataURL(el);

                if (dataUrl) {
                    tag.set(MARK.original("poster"), "");
                    tag.set("poster", dataUrl);
                }
            }

            tag.remove(MARK.blobDataUri);
        }
    },
    {
        name: "media-source",
        match: isMediaSource,

        discover(el, ctx) {
            if (el.getAttribute("src") && el.src === el.parentElement.currentSrc && ctx.options.audioVideo)
                rememberMedia(el, el.src, el.parentElement.localName, ctx, !el.parentElement.hasAttribute("crossorigin"));
        },

        serialize(el, ctx, tag) {
            const src = el.getAttribute("src");

            if (!src)
                return;

            if (el.src === el.parentElement.currentSrc) {
                if (isReplaceable(el.src))
                    tag.replace("src", substitute(src, ctx));
            }
            else
                tag.replace("src", unsavedOf(src, ctx));
        }
    },
    {
        name: "track",
        match: el => el.localName === "track" && isHTML(el),

        discover(el, ctx) {
            if (el.getAttribute("src") && ctx.options.audioVideo && isReplaceable(el.src))
                ctx.store.remember({url: el.src, baseURI: ctx.baseURI, kind: "track", expectedMime: MIME.vtt,
                    charset: ctx.characterSet});
        },

        serialize(el, ctx, tag) {
            substituteAttribute(el, tag, "src", el.src, ctx);
        }
    }
];

function serializeMediaSrc(el, ctx, tag) {
    const src = el.getAttribute("src");

    if (!src)
        return;

    if (el.src === el.currentSrc) {
        if (isReplaceable(el.src))
            tag.replace("src", substitute(src, ctx));
        else if (el.src.startsWith("blob:"))
            tag.replace("src", unsavedOf(src, ctx));
    }
    else
        tag.replace("src", unsavedOf(src, ctx));
}
