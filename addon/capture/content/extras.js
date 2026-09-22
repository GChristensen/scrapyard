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
        // A TreeWalker that rejects <style> and <script> collects the same text as cloning the whole body and
        // removing those elements, without duplicating every node of the document first. The words then go
        // straight into the Set instead of through three full-size intermediate arrays.
        const doc = body.ownerDocument;
        const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (node.nodeType === 1)
                    return (node.localName === "style" || node.localName === "script")
                        ? NodeFilter.FILTER_REJECT: NodeFilter.FILTER_SKIP;

                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const parts = [];

        while (walker.nextNode())
            parts.push(walker.currentNode.data);

        const text = parts.join("")
            .replace(/\n/g, " ")
            .replace(/(?:\p{Z}|[^\p{L}-])+/ug, " ");

        const words = new Set();

        for (const word of text.split(" "))
            if (word.length > 2)
                words.add(word.toLocaleLowerCase());

        return Array.from(words);
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
