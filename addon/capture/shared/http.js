// Content-Type parsing and the mixed-content rule, used by both the content loader and the background fallback.

/**
 * @param {string|null|undefined} header  Content-Type header value
 * @returns {{mime: string, charset: string}} lowercase; "" when absent
 */
export function parseContentType(header) {
    const value = header || "";

    const mimeMatch = value.match(/([^;]+)/);
    const mime = mimeMatch? mimeMatch[1].trim().toLowerCase(): "";

    const charsetMatch = value.match(/;\s*charset=([^;]+)/i);
    const charset = charsetMatch? charsetMatch[1].trim().replace(/^["']|["']$/g, "").toLowerCase(): "";

    return {mime, charset};
}

/**
 * The resource may be requested without violating mixed-content rules.
 * @param {string} url        absolute resource URL
 * @param {string} referrer   base URI of the discovering document
 * @param {string} pageScheme protocol of the top document ("https:")
 * @returns {boolean}
 */
export function isSafeContent(url, referrer, pageScheme) {
    return url.startsWith("https:")
        || (url.startsWith("http:") && (referrer || "").startsWith("http:") && pageScheme === "http:")
        || (url.startsWith("file:") && pageScheme === "file:");   /* local pages reference local files */
}

/**
 * @param {string} url
 * @param {string} referrer
 * @param {string} pageScheme
 * @returns {boolean}
 */
export function isMixedContent(url, referrer, pageScheme) {
    return url.startsWith("http:") && ((referrer || "").startsWith("https:") || pageScheme === "https:");
}

/**
 * @param {{url: string, referrer: string, passive: boolean}} resource
 * @param {string} pageScheme
 * @param {boolean} allowPassiveMixedContent
 * @returns {boolean}
 */
export function isLoadAllowed(resource, pageScheme, allowPassiveMixedContent) {
    if (isSafeContent(resource.url, resource.referrer, pageScheme))
        return true;

    return isMixedContent(resource.url, resource.referrer, pageScheme) && !!resource.passive && !!allowPassiveMixedContent;
}
