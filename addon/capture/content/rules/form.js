// Form state: <input> values and checks, <textarea> text, <option> selection (the live state wins).

import {escapeText} from "../core/tag.js";
import {isHTML} from "./common.js";
import {syncInputValue} from "./image.js";

/** @type {import("../../shared/types.js").ElementRule[]} */
export const formRules = [
    {
        name: "input",
        match: el => el.localName === "input" && isHTML(el),

        serialize(el, ctx, tag) {
            syncInputValue(el, tag);
        }
    },
    {
        name: "textarea",
        match: el => el.localName === "textarea" && isHTML(el),

        serialize(el, ctx, tag) {
            tag.text = escapeText(el.value);
        }
    },
    {
        name: "option",
        match: el => el.localName === "option" && isHTML(el),

        serialize(el, ctx, tag) {
            if (el.selected)
                tag.set("selected", "");
            else
                tag.remove("selected");
        }
    }
];
