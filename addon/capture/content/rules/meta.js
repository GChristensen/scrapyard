// <meta http-equiv=content-security-policy>: the saved page must not enforce the original CSP against its
// data URIs / relative files.

/** @type {import("../../shared/types.js").ElementRule[]} */
export const metaRules = [
    {
        // the output declares UTF-8 itself (rules/head.js); the live top document loses these in prepare, subframes
        // and parsed snapshots still have them
        name: "meta-encoding",
        match: el => el.localName === "meta"
            && (el.hasAttribute("charset") || (el.getAttribute("http-equiv") || "").toLowerCase() === "content-type"),

        serialize(el, ctx, tag) {
            return tag.drop();
        }
    },
    {
        name: "meta-csp",
        match: el => el.localName === "meta" && (el.getAttribute("http-equiv") || "").toLowerCase() === "content-security-policy",

        serialize(el, ctx, tag) {
            tag.preserve("content");
            tag.set("content", "");
        }
    }
];
