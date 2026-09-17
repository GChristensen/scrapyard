// THE ordered list of element rules. Specific rules (SVG <use>) come before general ones (SVG href elements).

import {styleRules} from "./style.js";
import {linkRules} from "./link.js";
import {metaRules} from "./meta.js";
import {scriptRules} from "./script.js";
import {imageRules} from "./image.js";
import {mediaRules} from "./media.js";
import {embedRules} from "./embed.js";
import {formRules} from "./form.js";
import {canvasRules} from "./canvas.js";
import {svgRules} from "./svg.js";
import {headRules} from "./head.js";

/** @type {ReadonlyArray<import("../../shared/types.js").ElementRule>} */
export const RULES = Object.freeze([
    ...styleRules,
    ...linkRules,
    ...metaRules,
    ...scriptRules,
    ...imageRules,
    ...mediaRules,
    ...embedRules,
    ...formRules,
    ...canvasRules,
    ...svgRules,
    ...headRules
]);
