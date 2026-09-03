import {fetchWithTimeout} from "./utils_io.js";
import {Archive} from "./storage_entities.js";

var entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
};

export function escapeHtml(string) {
    return String(string).replace(/[&<>"'`=\/]/g, s => entityMap[s]);
}

export function escapeCSS(string) {
    return String(string).replace(/[<>]/g, s => entityMap[s]);
}

export function unescapeHtml(string) {
    return string.replace(/&amp;/g, '&')
                 .replace(/&quot;/g, '\"')
                 .replace(/&lt;/g, '<')
                 .replace(/&gt;/g, '>')
                 .replace(/&nbsp;/g, ' ')
                 .replace(/&#39;/g, "'");
}

export function parseHtml(htmlText) {
    let doc = document.implementation.createHTMLDocument("")
        , doc_elt = doc.documentElement
        , first_elt;

    doc_elt.innerHTML = htmlText;
    first_elt = doc_elt.firstElementChild;

    if (doc_elt.childElementCount === 1
        && first_elt.localName.toLowerCase() === "html") {
        doc.replaceChild(first_elt, doc_elt);
    }

    return doc;
}

export function clearDocumentEncoding(doc) {
    let meta = doc.querySelector("meta[http-equiv='content-type' i]")
        || doc.querySelector("meta[charset]");

    if (meta)
        meta.parentNode.removeChild(meta);
}

export function fixDocumentEncoding(doc) {
    clearDocumentEncoding(doc);
    $(doc.getElementsByTagName("head")[0]).prepend(`<meta charset="utf-8">`);
}

export function isElementInViewport(el) {
    var rect = el.getBoundingClientRect();

    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}

export function injectCSS(file, doc) {
    if (!doc)
        doc = document;

    let link = doc.querySelector(`link[href="${file}]"`);

    if (!link) {
        link = doc.createElement("link");
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = file;
        link.media = "all";
        doc.head.appendChild(link);
    }
}

export function getThemeVar(v) {
    let vars = document.querySelector(":root");
    if (vars) {
        let style = window.getComputedStyle(vars);
        return style.getPropertyValue(v);
    }
}

export function applyInlineStyles(element, recursive = true, exclude) {

    let matchRules = function (el) {
        let sheets = Array.from(document.styleSheets);
        if (exclude)
            sheets = sheets.filter(s => !exclude.some(e => s.href?.endsWith(e)));
        let ret = [];
        for (let sheet of sheets) {
            let rules = sheet.rules || sheet.cssRules;
            for (let r in rules) {
                if (rules[r].selectorText?.includes("*"))
                    continue;
                if (el.localName === "pre" && el.matches(rules[r].selectorText)) {
                    console.log(rules[r].selectorText)
                }
                if (el.matches(rules[r].selectorText)) {
                    ret.push(rules[r]);
                }
            }
        }
        return ret;
    }

    const matches = matchRules(element);

    // we need to preserve any pre-existing inline styles.
    let srcRules = document.createElement(element.tagName).style;
    srcRules.cssText = element.style.cssText;

    matches.forEach(rule => {
        for (let prop of rule.style) {

            let val = srcRules.getPropertyValue(prop) || rule.style.getPropertyValue(prop);
            let priority = rule.style.getPropertyPriority(prop);

            element.style.setProperty(prop, val, priority);
        }
    });

    if (recursive) {
        Array.from(element.children).forEach(child => {
            applyInlineStyles(child, recursive, exclude);
        });
    }
}

export function indexString(string) {
    return createIndex(string, t => t);
}

export function indexHTML(string) {
    return createIndex(string, removeTags)
}

function createIndex(string, textExtractor) {
    try {
        string = textExtractor(string);
        string = string.replace(/\n/g, " ")
            .replace(/(?:\p{Z}|[^\p{L}-])+/ug, " ");

        let words = string.split(" ")
            .filter(s => s && s.length > 2)
            .map(s => s.toLocaleLowerCase())

        return Array.from(new Set(words));
    }
    catch (e) {
        console.error(e)
        console.log("Index creation has failed.")
        return [];
    }
}

export function instantiateIFramesRecursive(doc, parser, acc = [], topIFrames) {
    const invocation = !parser;
    if (invocation)
        parser = new DOMParser();

    const iframes = doc.querySelectorAll("iframe");

    if (invocation)
        topIFrames = iframes;

    iframes.forEach(
        function (iframe) {
            const html = iframe.srcdoc;
            if (html) {
                const iframeDoc = parseHtml(html);
                iframe.__doc = iframeDoc;
                acc.push(iframeDoc);
                instantiateIFramesRecursive(iframeDoc, parser, acc, topIFrames);
            }
        });

    return [acc, topIFrames];
}

export function rebuildIFramesRecursive(doc, topIFrames) {
    topIFrames.forEach(iframe => {
        if (iframe.__doc) {
            rebuildIFramesRecursive(iframe.__doc, iframe.__doc.querySelectorAll("iframe"));
            iframe.srcdoc = iframe.__doc.documentElement.outerHTML;
        }
    })
}

export async function buildIFramesRecursive(node, doc, topIFrames, acc = []) {
    for (let i = 0; i < topIFrames.length; ++i) {
        const iframe = topIFrames[i];

        let iframeHTML = iframe.srcdoc;

        if (!iframeHTML && iframe.src && !iframe.src.startsWith("http"))
            iframeHTML = await Archive.getFile(node, iframe.src);

        if (iframeHTML) {
            const iframeDoc = parseHtml(iframeHTML);
            await buildIFramesRecursive(node, iframeDoc, iframeDoc.querySelectorAll("iframe"), acc);
            iframe.__doc = iframeDoc;
            acc.push(iframeDoc);
        }
    }

    return [acc, topIFrames];
}

export async function assembleUnpackedIndex(node) {
    const indexHTML = await Archive.getFile(node, "index.html");

    if (indexHTML) {
        const doc = parseHtml(indexHTML);
        const iframes = doc.querySelectorAll("iframe");
        const [iframeDocs] = await buildIFramesRecursive(node, doc, iframes);
        return [doc, ...iframeDocs];
    }
}

const RX_IFRAME_TAG = /<iframe\s[^>]*>/ig;
const RX_SRCDOC_ATTR = /\ssrcdoc\s*=/i;
const RX_SRC_ATTR = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

// The string counterpart of assembleUnpackedIndex, for the paths that only need the text of an
// unpacked archive: returns the HTML of its index and of every local file it embeds, without
// building a single document. Iframes with srcdoc are left alone, since removeTags inlines those.
export async function assembleUnpackedContent(node, file = "index.html", acc = [], visited = new Set()) {
    if (visited.has(file))
        return acc;

    visited.add(file);

    const html = await Archive.getFile(node, file);

    if (typeof html !== "string")
        return acc;

    acc.push(html);

    for (const tag of html.match(RX_IFRAME_TAG) || []) {
        if (RX_SRCDOC_ATTR.test(tag))
            continue;

        const src = tag.match(RX_SRC_ATTR);
        const path = src? (src[1] ?? src[2] ?? src[3]): null;

        if (path && !path.startsWith("http"))
            await assembleUnpackedContent(node, unescapeHtml(path), acc, visited);
    }

    return acc;
}

const RX_IFRAME_SRCDOC = /<iframe[^>]*\ssrcdoc=(?:"([^"]*)"|'([^']*)')[^>]*>/igs;
const RX_REFERENCE = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/ig;

// Only the references that produce letters need to be decoded precisely, since createIndex
// discards everything else anyway. An unknown name degrades to a space, as it always has.
// The case of a name is irrelevant here, because the indexed words are lowercased.
const NAMED_REFERENCES = {
    amp:    "&", lt:     "<", gt:     ">", quot:   '"', apos:   "'", nbsp:   " ",
    agrave: "à", aacute: "á", acirc:  "â", atilde: "ã", auml:   "ä", aring:  "å",
    aelig:  "æ", ccedil: "ç", egrave: "è", eacute: "é", ecirc:  "ê", euml:   "ë",
    igrave: "ì", iacute: "í", icirc:  "î", iuml:   "ï", eth:    "ð", ntilde: "ñ",
    ograve: "ò", oacute: "ó", ocirc:  "ô", otilde: "õ", ouml:   "ö", oslash: "ø",
    ugrave: "ù", uacute: "ú", ucirc:  "û", uuml:   "ü", yacute: "ý", yuml:   "ÿ",
    thorn:  "þ", szlig:  "ß", oelig:  "œ", scaron: "š", fnof:   "ƒ", micro:  "µ"
};

// The text level elements, which may occur inside a word: `re<b>cord</b>` is one word and has to
// stay one, so these are dropped without a trace. Everything else becomes a space, because the
// text on the two sides of it belongs to separate words even when nothing is rendered between
// them: `<p>foo</p><p>bar</p>` is not `foobar`, which is what Node.textContent would produce.
// Absent here on purpose: `br` and `img`, which do separate words, and `rt`, whose content is a
// ruby annotation rather than a part of the surrounding text.
const INLINE_TAGS = new Set([
    "a", "abbr", "acronym", "b", "bdi", "bdo", "big", "cite", "code", "data", "del", "dfn", "em",
    "font", "i", "ins", "kbd", "mark", "nobr", "q", "s", "samp", "small", "span", "strike",
    "strong", "sub", "sup", "time", "tt", "u", "var", "wbr"
]);

// Extracts the plain text of an HTML string without the DOM API, which is unavailable in the
// MV3 service worker. Character references are decoded, and the tags are erased or turned into a
// word boundary depending on their level, so the words of the resulting index are neither damaged
// nor invented.
function removeTags(string) {
    return string
        // the content of srcdoc is escaped, so it has to be decoded before its own tags are removed
        .replace(RX_IFRAME_SRCDOC, (m, doubleQuoted, singleQuoted) =>
            ` ${inlined(removeTags(decodeReferences(doubleQuoted ?? singleQuoted)))} `)
        .replace(/<title.*?<\/title>/igs, " ")
        .replace(/<style.*?<\/style>/igs, " ")
        .replace(/<script.*?<\/script>/igs, " ")
        .replace(/<[^>]+>/gs, replaceTag)
        // the references are decoded last: a decoded '<' should not be taken for a tag
        .replace(RX_REFERENCE, decodeReference);
}

function replaceTag(tag) {
    // an end tag separates the words no less than its start tag does, so both are looked up alike
    let start = tag.charCodeAt(1) === 47? 2: 1;
    let end = start;

    // a name ends at whitespace, at the slash of an empty element tag, or at the closing bracket;
    // a comment or a doctype yields a name that is in no case inline, and so becomes a space
    while (end < tag.length) {
        const c = tag.charCodeAt(end);

        if (c <= 32 || c === 47 || c === 62)
            break;

        end += 1;
    }

    return INLINE_TAGS.has(tag.substring(start, end).toLowerCase())? "": " ";
}

// keeps the markup characters of an already processed fragment from being
// interpreted for the second time in the enclosing document
function inlined(text) {
    return text.replace(/[<>&]/g, " ");
}

function decodeReferences(string) {
    return string.replace(RX_REFERENCE, decodeReference);
}

function decodeReference(match, reference) {
    if (reference[0] === "#") {
        const code = reference[1] === "x" || reference[1] === "X"
            ? parseInt(reference.substring(2), 16)
            : parseInt(reference.substring(1), 10);

        // NaN fails the comparison along with the out of range code points
        return code > 0 && code <= 0x10FFFF? String.fromCodePoint(code): " ";
    }

    return NAMED_REFERENCES[reference.toLowerCase()] || " ";
}

// Reduces markup text and a query to the same shape so a phrase can be found across tags and
// punctuation, which is what mark.js approximates with acrossElements and ignorePunctuation.
// Punctuation is dropped rather than turned into a separator, so that "dont" still finds
// "don't" and "email" still finds "e-mail"; only whitespace separates words, which keeps
// "foo bar" from matching "foo,bar" exactly as the mark.js regexes do.
function normalizeForMatching(string) {
    return string.toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/ug, "")
        .replace(/\s+/ug, " ")
        .trim();
}

// Counts the occurrences of a phrase in an HTML string without building a document. The query is
// normalized once, so the matcher can be reused across the documents of an entire search.
export function phraseMatcher(query) {
    const phrase = normalizeForMatching(query || "");

    return {
        count(html) {
            if (!phrase || typeof html !== "string")
                return 0;

            const text = normalizeForMatching(removeTags(html));
            let count = 0;

            // the matches are non-overlapping and left to right, as they are in mark.js
            for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + phrase.length))
                count += 1;

            return count;
        }
    };
}

export async function isHTMLLink(url, timeout = 10000) {
    let response;

    try {
        response = await fetchWithTimeout(url, {method: "head"});
    } catch (e) {
        console.error(e);
    }

    if (response?.ok) {
        const contentType = response.headers.get("content-type");
        return !!(contentType && contentType.toLowerCase().startsWith("text/html"));
    }
}

export class RDFNamespaces {
    //NS_NC;
    NS_RDF;
    NS_SCRAPBOOK;

    resolver;

    constructor(doc) {
        const rootAttrs = Object.values(doc.documentElement.attributes);
        const namespaces = rootAttrs.map(a => [a.localName, a.prefix === "xmlns"? a.value: null]);
        const namespaceMap = new Map(namespaces);
        this.resolver = ns => namespaceMap.get(ns);

        //this.NS_NC = this.resolver("NC");
        this.NS_RDF = this.resolver("RDF");
        this.NS_SCRAPBOOK = namespaces.find(ns => (/NS\d+/i).test(ns[0]))[1];
    }
}
