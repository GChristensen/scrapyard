// Extracts a single image and its metadata from a gallery page with the selectors configured on the gallery shelf.
// A selector that is not configured is skipped and its field is omitted from the result. A selector containing "/"
// or "(" is taken for an XPath expression (e.g. "//div[@class='prompt']" or "(//img)[1]/@src") and evaluated with
// document.evaluate instead of querySelector; anything else is a plain CSS selector. This does misfire on a CSS
// selector that happens to use a parenthesized pseudo-class, such as ":nth-child(2)" or ":not(.x)" - such a
// selector must be phrased as XPath instead, since there is no separate escape hatch for it.

(() => {
    // the script may be injected into the same page more than once
    if (window.__scrapyardGalleryExtractor)
        return;

    window.__scrapyardGalleryExtractor = true;

    const URL_ATTRIBUTES = ["src", "href", "data-src", "data-original", "content"];

    function isXPathSelector(selector) {
        return selector.includes("/");
    }

    function absoluteURL(url) {
        try {
            return new URL(url, location.href).href;
        }
        catch (e) {
            return undefined;
        }
    }

    // Collects every text node under `node` into `parts`, one entry per node. Used instead of `node.textContent`
    // (which simply concatenates them) so that text split across several tags with no whitespace between them in
    // the markup - e.g. "<div>Foo<span>Bar</span></div>" - doesn't come out glued together as "FooBar".
    function collectTextParts(node, parts) {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE)
            parts.push(node.data);
        else if (node.nodeType === Node.ATTRIBUTE_NODE)
            parts.push(node.value);
        else
            for (const child of node.childNodes)
                collectTextParts(child, parts);
    }

    // The text of a node (element, attribute or text node - anything document.evaluate can return), with a space
    // inserted at every tag boundary rather than none. Whitespace already in the markup is collapsed along with the
    // inserted spaces, so this doesn't add doubled-up spacing where tags were already separated by some.
    function nodeText(node) {
        const parts = [];
        collectTextParts(node, parts);

        const text = parts.join(" ").replace(/\s+/g, " ").trim();
        return text || undefined;
    }

    // `value` is only read from form controls: on other elements it may hold something else entirely, such as the
    // ordinal of an <li>.
    function elementText(element) {
        const isFormControl = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
                                || element instanceof HTMLSelectElement;

        return isFormControl? (element.value.trim() || undefined): nodeText(element);
    }

    // An URL may be carried by an attribute of the matched element, by a descendant link, or - when the selector
    // matches an element such as a <div> holding the address as text - by the element text itself. The text fallback
    // is only used where a single URL is expected, so that a resource caption is not mistaken for an address.
    function elementURL(element, allowText) {
        for (const attribute of URL_ATTRIBUTES) {
            const value = element.getAttribute?.(attribute)?.trim();

            if (value)
                return absoluteURL(value);
        }

        // <img srcset> without a src: take the first candidate
        const srcset = element.getAttribute?.("srcset")?.trim();
        if (srcset) {
            const candidate = srcset.split(",")[0]?.trim().split(/\s+/)[0];

            if (candidate)
                return absoluteURL(candidate);
        }

        const descendant = element.querySelector?.("a[href], img[src]");
        if (descendant)
            return absoluteURL(descendant.getAttribute("href") || descendant.getAttribute("src"));

        if (!allowText)
            return undefined;

        const text = elementText(element);
        return text? absoluteURL(text): undefined;
    }

    function queryFirst(selector) {
        if (!selector?.trim())
            return null;

        try {
            return document.querySelector(selector);
        }
        catch (e) {
            console.error("Scrapyard: invalid gallery selector", selector, e);
            return null;
        }
    }

    function queryAll(selector) {
        if (!selector?.trim())
            return [];

        try {
            return Array.from(document.querySelectorAll(selector));
        }
        catch (e) {
            console.error("Scrapyard: invalid gallery selector", selector, e);
            return [];
        }
    }

    // Every node an XPath expression matches, in document order. A snapshot (rather than an iterator) is used so
    // that a result count is available up front. The expression may select elements, attributes or text nodes -
    // textContent below returns a meaningful string for all of them.
    function evaluateXPath(selector) {
        try {
            const snapshot = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const nodes = [];

            for (let i = 0; i < snapshot.snapshotLength; i++)
                nodes.push(snapshot.snapshotItem(i));

            return nodes;
        }
        catch (e) {
            console.error("Scrapyard: invalid gallery XPath selector", selector, e);
            return [];
        }
    }

    // Joins the text of every node an XPath expression matches, one per line - each line itself space-joined across
    // tag boundaries by nodeText(), same as elementText() does for CSS matches. A single match is returned as a
    // plain (single-line) string, so this also serves as the "one value" case.
    function xpathText(selector) {
        const lines = evaluateXPath(selector).map(nodeText).filter(Boolean);

        return lines.length? lines.join("\n"): undefined;
    }

    // Resolves a selector that is expected to yield a single URL (the image, its thumbnail). CSS selectors keep the
    // element-based extraction (attribute, descendant link, or element text as a last resort); an XPath match is
    // taken as the URL text itself, so the expression is expected to select the attribute or text node directly
    // (e.g. "//img[@class='main']/@src").
    function extractURLField(selector) {
        if (!selector?.trim())
            return undefined;

        if (isXPathSelector(selector)) {
            const text = xpathText(selector);
            return text? absoluteURL(text): undefined;
        }

        const element = queryFirst(selector);
        return element? elementURL(element, true): undefined;
    }

    // Resolves a selector that is expected to yield a single block of text (the prompt). A CSS selector uses only
    // its first match, as before; an XPath selector that happens to match several nodes has them all joined, one
    // per line, rather than silently keeping only the first.
    function extractTextField(selector) {
        if (!selector?.trim())
            return undefined;

        if (isXPathSelector(selector))
            return xpathText(selector);

        const element = queryFirst(selector);
        return element? elementText(element): undefined;
    }

    // Resolves the resources selector. A CSS selector keeps matching every element and pairing each with a name and
    // an address, as before. An XPath selector instead yields the joined text of every match, one per line, with no
    // separate address per entry - the two modes produce a differently shaped value (a list of {name, url} versus a
    // single string), which is why the caller stores whatever comes back under the same field either way.
    function extractResourcesField(selector) {
        if (!selector?.trim())
            return undefined;

        if (isXPathSelector(selector))
            return xpathText(selector);

        const resources = queryAll(selector)
            .map(element => ({name: elementText(element), url: elementURL(element, false)}))
            .filter(resource => resource.name || resource.url);

        return resources.length? resources: undefined;
    }

    function extractGalleryItem(selectors) {
        const result = {};

        const image = extractURLField(selectors?.image_url);
        if (image)
            result.image_url = image;

        const thumb = extractURLField(selectors?.image_thumb_url);
        if (thumb)
            result.image_thumb_url = thumb;

        const prompt = extractTextField(selectors?.image_prompt);
        if (prompt)
            result.image_prompt = prompt;

        const negativePrompt = extractTextField(selectors?.image_negative_prompt);
        if (negativePrompt)
            result.image_negative_prompt = negativePrompt;

        const resources = extractResourcesField(selectors?.image_resources);
        if (resources)
            result.image_resources = resources;

        return result;
    }

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case "EXTRACT_GALLERY_ITEM":
                sendResponse(extractGalleryItem(message.selectors));
                break;
        }
    });
})();
