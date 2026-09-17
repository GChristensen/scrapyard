// @font-face parsing, loaded-font matching and the font file selection policy. DOM-free.

import {removeQuotes, isReplaceable} from "../../shared/url.js";
import {RX_FONT_SRC, RX_FONT_URL, unescapeValue} from "./css.js";

const WEIGHTS = ["normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
const STRETCHES = ["normal", "ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "semi-expanded",
    "expanded", "extra-expanded", "ultra-expanded"];
const STYLES = ["normal", "italic", "oblique"];

/**
 * @typedef {object} FontFaceDescriptor
 * @property {string} family   unescaped, quotes removed, lowercase ("" when absent)
 * @property {string} weight
 * @property {string} style
 * @property {string} stretch
 */

/**
 * @param {string} block  the {...} block of a @font-face rule
 * @returns {FontFaceDescriptor}
 */
export function parseFontFace(block) {
    const familyMatch = block.match(/font-family\s*:\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s;}]+(?: [^\s;}]+)*))/i);
    const family = familyMatch? removeQuotes(unescapeValue(familyMatch[1])).toLowerCase(): "";

    return {
        family,
        weight: descriptor(block, "font-weight", WEIGHTS),
        style: descriptor(block, "font-style", STYLES),
        stretch: descriptor(block, "font-stretch", STRETCHES)
    };
}

function descriptor(block, name, valid) {
    const match = block.match(new RegExp(name + "\\s*:\\s*([^\\s;}]*)", "i"));

    if (!match)
        return "normal";

    const value = match[1].toLowerCase();

    return valid.includes(value)? value: "normal";
}

/**
 * @param {FontFaceDescriptor} face
 * @param {Array<{family: string, weight: string, style: string, stretch: string}>} loadedFonts
 * @returns {boolean} some loaded font matches all four descriptors
 */
export function matchesLoadedFont(face, loadedFonts) {
    for (const font of loadedFonts || [])
        if (removeQuotes(font.family).toLowerCase() === face.family && font.weight === face.weight
                && font.style === face.style && font.stretch === face.stretch)
            return true;

    return false;
}

/**
 * The file type of a font source from its format() hint, else from the URL; "" when unknown.
 * @param {string} url
 * @param {string|undefined} format  the content of format(...) or undefined
 * @returns {"woff2"|"woff"|"ttf"|"otf"|""}
 */
export function fontFileType(url, format) {
    if (typeof format !== "undefined") {
        format = format.replace(/"/g, "'");

        if (format.includes("'woff2'")) return "woff2";
        if (format.includes("'woff'")) return "woff";
        if (format.includes("'truetype'")) return "ttf";
        if (format.includes("'opentype'")) return "otf";

        return "";
    }

    if (url.includes(".woff2")) return "woff2";
    if (url.includes(".woff") && !url.includes(".woff2")) return "woff";
    if (url.includes(".ttf")) return "ttf";
    if (url.includes(".otf")) return "otf";

    return "";
}

/**
 * The font file URLs to remember for a @font-face block, by policy:
 *   "used": the first typed file only (what the browser itself uses);
 *   "woff": the first file plus any woff file (loads in every browser), stop once a woff was found;
 *   "all":  every typed file.
 * @param {string} block
 * @param {"used"|"woff"|"all"} policy
 * @returns {string[]} URLs, quotes removed, not resolved, in order
 */
export function selectFontFiles(block, policy) {
    const includeAll = policy === "all";
    const includeWoff = policy === "woff";
    const result = [];

    let usedFound = false;
    let woffFound = false;

    const satisfied = () => !includeAll && (woffFound || (!includeWoff && usedFound));

    const srcRegex = new RegExp(RX_FONT_SRC.source, RX_FONT_SRC.flags);
    let src;

    while ((src = srcRegex.exec(block)) != null) {
        const urlRegex = new RegExp(RX_FONT_URL.source, RX_FONT_URL.flags);
        let m;

        while ((m = urlRegex.exec(src[1])) != null) {
            const url = removeQuotes(m[1]);

            if (!isReplaceable(url))
                continue;

            const type = fontFileType(url, m[2]);

            if (type !== "") {
                if (!usedFound) {
                    usedFound = true;

                    if (type === "woff")
                        woffFound = true;

                    result.push(url);
                }
                else if (includeWoff && type === "woff") {
                    woffFound = true;
                    result.push(url);
                }
                else if (includeAll)
                    result.push(url);
            }

            if (satisfied())
                break;
        }

        if (satisfied())
            break;
    }

    return result;
}
