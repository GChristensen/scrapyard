// Per-frame extras: the word index of the body and the outgoing links (used by full-text search and site capture).

import {MARK} from "../shared/constants.js";

/**
 * @param {HTMLElement|null|undefined} body
 * @returns {string[]} lowercase words longer than 2 characters, deduplicated, in order
 */
export function indexWords(body) {
    if (!body)
        return [];

    try {
        const clone = body.cloneNode(true);

        clone.querySelectorAll("style, script").forEach(element => element.remove());

        const text = clone.textContent
            .replace(/\n/g, " ")
            .replace(/(?:\p{Z}|[^\p{L}-])+/ug, " ");

        const words = text.split(" ")
            .filter(s => s && s.length > 2)
            .map(s => s.toLocaleLowerCase());

        return Array.from(new Set(words));
    }
    catch (e) {
        console.error(e);
        return [];
    }
}

/**
 * Every <a> whose href starts with "http"; the element is stamped with data-scrapyard-href for site capture.
 * @param {ParentNode} root
 * @returns {Array<{url: string, text: string}>}
 */
export function collectLinks(root) {
    const links = [];

    root.querySelectorAll("a").forEach(element => {
        const url = element.href;

        if (typeof url === "string" && url.startsWith("http")) {
            element.setAttribute(MARK.siteHref, url);
            links.push({url, text: element.textContent});
        }
    });

    return links;
}
