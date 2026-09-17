// URL helpers shared by discovery, loading and serialization. DOM-free.

/**
 * A URL that may be fetched and substituted: not data:, blob:, moz-extension:, fragment-only or empty.
 * @param {string} url
 * @returns {boolean}
 */
export function isReplaceable(url) {
    if (typeof url !== "string" || url === "")
        return false;

    const head = url.slice(0, 14).toLowerCase();

    return !(head.startsWith("data:") || head.startsWith("blob:") || head.startsWith("moz-extension:") || url[0] === "#");
}

/**
 * @param {string} url
 * @param {string} base
 * @returns {string|null} absolute URL or null when the base or the url is invalid
 */
export function resolve(url, base) {
    try {
        return new URL(url, base).href;
    }
    catch (e) {
        return null;
    }
}

/**
 * @param {string} url
 * @returns {string}
 */
export function stripFragment(url) {
    const i = url.indexOf("#");
    return i >= 0? url.slice(0, i): url;
}

/**
 * @param {string} url
 * @returns {string} the fragment including "#", or ""
 */
export function fragmentOf(url) {
    const i = url.indexOf("#");
    return i >= 0? url.slice(i): "";
}

/**
 * Absolute URL; a URL pointing into the same document with a fragment is reduced to the fragment.
 * @param {string} url
 * @param {string} base
 * @param {string} documentURI
 * @returns {string}
 */
export function adjust(url, base, documentURI) {
    if (base == null)
        return url;

    const location = resolve(url, base);

    if (location == null)
        return url;

    const i = location.indexOf("#");

    if (i < 0)
        return location;

    return location.slice(0, i) === documentURI? location.slice(i): location;
}

/**
 * The value emitted for a URL that was not saved.
 * @param {string} url
 * @param {string} base
 * @param {string} documentURI
 * @param {boolean} removeUnsavedUrls
 * @returns {string}
 */
export function unsaved(url, base, documentURI, removeUnsavedUrls) {
    return removeUnsavedUrls? "": adjust(url, base, documentURI);
}

/**
 * Removes the CSS escapes of "&", ":" and "=" (each with an optional trailing space).
 * @param {string} url
 * @returns {string}
 */
export function stripCssEscapes(url) {
    return url
        .replace(/\\26 ?/g, "&")
        .replace(/\\3[Aa] ?/g, ":")
        .replace(/\\3[Dd] ?/g, "=");
}

/**
 * Strips one leading and one trailing quote character.
 * @param {string} s
 * @returns {string}
 */
export function removeQuotes(s) {
    if (s[0] === "\"" || s[0] === "'")
        s = s.slice(1);

    if (s.endsWith("\"") || s.endsWith("'"))
        s = s.slice(0, -1);

    return s;
}

/**
 * Relative path from one archive file to another ("index.html" -> "resources/a.png" is "resources/a.png",
 * "frames/0-1.html" -> "resources/a.png" is "../resources/a.png").
 * @param {string} fromFile
 * @param {string} toFile
 * @returns {string}
 */
export function relativePath(fromFile, toFile) {
    const from = fromFile.split("/").slice(0, -1);
    const to = toFile.split("/");

    let common = 0;
    while (common < from.length && common < to.length - 1 && from[common] === to[common])
        common++;

    const up = from.length - common;

    return "../".repeat(up) + to.slice(common).join("/");
}

/**
 * @param {string} s
 * @returns {string} s with regex metacharacters escaped
 */
export function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
