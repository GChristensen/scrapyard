// <canvas>: the pixels become a background image.

import {MARK} from "../../shared/constants.js";
import {isHTML} from "./common.js";

const FIXED = "background-attachment: scroll !important; background-blend-mode: normal !important; "
    + "background-clip: content-box !important; background-color: transparent !important; "
    + "background-origin: content-box !important; background-position: center center !important; "
    + "background-repeat: no-repeat !important; background-size: 100% 100% !important;";

/** @type {import("../../shared/types.js").ElementRule[]} */
export const canvasRules = [
    {
        name: "canvas",
        match: el => el.localName === "canvas" && isHTML(el),

        serialize(el, ctx, tag) {
            let dataUrl = el.getAttribute(MARK.canvasDataUri);

            if (!dataUrl) {
                try {
                    dataUrl = el.toDataURL("image/png", "");
                }
                catch (e) {
                    dataUrl = null;   /* tainted */
                }
            }

            tag.remove(MARK.canvasDataUri);

            if (dataUrl)
                tag.appendStyle(MARK.cssCanvasImage + " background-image: url(" + dataUrl + ") !important; " + FIXED);
            else
                tag.appendStyle(MARK.cssCanvasDirty);
        }
    }
];
