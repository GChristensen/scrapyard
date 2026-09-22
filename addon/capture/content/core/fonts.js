// @font-face parsing, loaded-font matching and the font file selection policy. DOM-free.

import {removeQuotes, isReplaceable} from "../../shared/url.js";
import {RX_FONT_SRC, RX_FONT_URL, unescapeValue} from "./css.js";

const WEIGHTS = new Set(["normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700",
    "800", "900"]);
const STRETCHES = new Set(["normal", "ultra-condensed", "extra-condensed", "condensed", "semi-condensed",
    "semi-expanded", "expanded", "extra-expanded", "ultra-expanded"]);
const STYLES = new Set(["normal", "italic", "oblique"]);

/* one compiled regex per descriptor instead of one per @font-face block */
const RX_DESCRIPTOR = {
    "font-weight": /font-weight\s*:\s*([^\s;}]*)/i,
    "font-style": /font-style\s*:\s*([^\s;}]*)/i,
    "font-stretch": /font-stretch\s*:\s*([^\s;}]*)/i
};

/* the normalized form of a loadedFonts array, which is the same array for every face of a run */
const NORMALIZED = new WeakMap();

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
    const match = block.match(RX_DESCRIPTOR[name]);

    if (!match)
        return "normal";

    const value = match[1].toLowerCase();

    return valid.has(value)? value: "normal";
}

/**
 * @param {FontFaceDescriptor} face
 * @param {Array<{family: string, weight: string, style: string, stretch: string}>} loadedFonts
 * @returns {boolean} some loaded font matches all four descriptors
 */
export function matchesLoadedFont(face, loadedFonts) {
    const fonts = loadedFonts || [];
    let normalized = NORMALIZED.get(fonts);

    if (!normalized) {
        normalized = fonts.map(font => ({family: removeQuotes(font.family).toLowerCase(),
            weight: font.weight, style: font.style, stretch: font.stretch}));

        try {
            NORMALIZED.set(fonts, normalized);
        }
        catch (e) {
            /* not an object key (an empty default): recomputed, which costs nothing */
        }
    }

    for (const font of normalized)
        if (font.family === face.family && font.weight === face.weight
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
    if (url.includes(".woff")) return "woff";   /* .woff2 already returned above */
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
    const urlRegex = new RegExp(RX_FONT_URL.source, RX_FONT_URL.flags);   /* hoisted out of the loop */
    let src;

    while ((src = srcRegex.exec(block)) != null) {
        urlRegex.lastIndex = 0;
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
