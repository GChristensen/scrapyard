// Marker vocabulary, element lists and MIME tables of the capture engine.
// Every marker name written into a saved page comes from MARK; no other file spells them out.

/** Returned by a rule's serialize hook (or set by tag.drop()) to emit nothing for the element. */
export const SKIP = Symbol("scrapyard-capture-skip");

/** Returned by a pass-3 visitor to emit the element but none of its children. */
export const SKIP_CHILDREN = Symbol("scrapyard-capture-skip-children");

const PREFIX = "scrapyard";
const OLD_PREFIX = "savepage";

export const MARK = Object.freeze({
    prefix: PREFIX,
    oldPrefix: OLD_PREFIX,

    /* attributes */
    key: `data-${PREFIX}-key`,
    oldKey: `data-${OLD_PREFIX}-key`,
    original: name => `data-${PREFIX}-${name}`,          // original attribute value holder
    sameOrigin: `data-${PREFIX}-sameorigin`,
    crossOrigin: `data-${PREFIX}-crossorigin`,
    nonMetadata: `data-${PREFIX}-nonmetadata`,
    disabled: `data-${PREFIX}-disabled`,
    shadowRoot: `data-${PREFIX}-shadowroot`,
    sheetRules: `data-${PREFIX}-sheetrules`,
    blobDataUri: `data-${PREFIX}-blobdatauri`,
    canvasDataUri: `data-${PREFIX}-canvasdatauri`,
    fontFace: `data-${PREFIX}-fontface`,
    siteHref: `data-${PREFIX}-href`,
    loading: `data-${PREFIX}-loading`,

    /* transient attributes removed from the output and the live DOM */
    transient: [`data-${PREFIX}-key`, `data-${PREFIX}-sheetrules`, `data-${PREFIX}-blobdatauri`, `data-${PREFIX}-canvasdatauri`],

    /* CSS comments */
    cssUrl: url => `/*${PREFIX}-url=${url}*/`,
    cssImportUrl: url => `/*${PREFIX}-import-url=${url}*/`,
    cssFontDisplay: value => `/*${PREFIX}-font-display=${value}*/`,
    cssCanvasImage: `/*${PREFIX}-canvas-image*/`,
    cssCanvasDirty: `/*${PREFIX}-canvas-dirty*/`,
    cssRehide: `/*${PREFIX}-rehide*/`,
    cssRemove: `/*${PREFIX}-remove*/`,

    /* HTML comments */
    htmlRemove: tag => `<!--${PREFIX}-${tag}-remove-->`,
    srcdocBegin: `<!--${PREFIX}-srcdoc-begin-->`,
    srcdocEnd: `<!--${PREFIX}-srcdoc-end-->`,
    symbolInsert: `<!--${PREFIX}-symbol-insert-->`,
    oldSummary: "SAVE PAGE WE",

    /* meta names */
    metaUrl: `${PREFIX}-url`,
    metaTitle: `${PREFIX}-title`,
    metaPubDate: `${PREFIX}-pubdate`,
    metaFrom: `${PREFIX}-from`,
    metaDate: `${PREFIX}-date`,
    metaState: `${PREFIX}-state`,
    metaVersion: `${PREFIX}-version`,
    oldMetaUrl: `${OLD_PREFIX}-url`,

    /* element ids */
    cssVariables: `${PREFIX}-cssvariables`,
    shadowLoader: `${PREFIX}-shadowloader`,
    overlay: `${PREFIX}-waiting`,

    /* CSS variables and the shadow loader function */
    cssVariable: id => `--${PREFIX}-url-${id}`,
    shadowLoaderFunction: `${PREFIX}_ShadowLoader`,

    /* id/name prefixes of leftovers from previous saves, skipped at depth 0 */
    leftoverPrefixes: [PREFIX, OLD_PREFIX]
});

/** HTML Living Standard 3.2.5.2.1 Metadata Content */
export const METADATA_ELEMENTS = Object.freeze(["base", "link", "meta", "noscript", "script", "style", "template", "title"]);

/** W3C HTML5 2011 4.3 Elements + menuitem */
export const VOID_ELEMENTS = Object.freeze(["area", "base", "br", "col", "command", "embed", "frame", "hr", "img", "input",
    "keygen", "link", "menuitem", "meta", "param", "source", "track", "wbr"]);

/** never removed although display: none */
export const RETAIN_ELEMENTS = Object.freeze(["html", "head", "body", "base", "command", "link", "meta", "noscript",
    "script", "style", "template", "title"]);

/** W3C HTML5 2014 10.3.1 Hidden Elements: never rehidden */
export const HIDDEN_BY_DEFAULT = Object.freeze(["area", "base", "datalist", "head", "link", "meta", "param", "rp",
    "script", "source", "style", "template", "track", "title"]);

/** HTML & SVG elements with built-in shadow DOM (their shadow roots are never walked) */
export const BUILTIN_SHADOW = Object.freeze(["audio", "video", "use"]);

/** SVG 1.1 & SVG 2 elements that can have an xlink:href or href attribute (<a> handled separately) */
export const HREF_SVG_ELEMENTS = Object.freeze(["altGlyph", "animate", "animateColor", "animateMotion", "animateTransform",
    "cursor", "discard", "feImage", "filter", "font-face-uri", "glyphRef", "image", "linearGradient", "mpath", "pattern",
    "radialGradient", "script", "set", "textPath", "tref", "use"]);

/** <style> elements injected by other extensions, dropped from the output */
export const ZOOMPAGE_STYLE_IDS = Object.freeze(["zoompage-pageload-style", "zoompage-zoomlevel-style", "zoompage-fontsize-style"]);
export const DARKREADER_CLASS = "darkreader";

/** attribute never serialized (Zoom Page WE) */
export const DROPPED_ATTRIBUTES = Object.freeze(["zoompage-fontsize"]);

/** expected MIME types treated as binary in the accept step */
export const BINARY_MIMES = Object.freeze(["application/font-woff", "image/png", "image/jpeg", "image/gif",
    "image/vnd.microsoft.icon", "audio/mpeg", "video/mp4", "application/pdf", "application/octet-stream"]);

/** See Mozilla source/dom/base/nsContentUtils.cpp for the list of supported JavaScript MIME types */
export const JAVASCRIPT_MIMES = Object.freeze(["text/javascript", "text/ecmascript", "application/javascript",
    "application/ecmascript", "application/x-javascript", "application/x-ecmascript", "text/javascript1.0",
    "text/javascript1.1", "text/javascript1.2", "text/javascript1.3", "text/javascript1.4", "text/javascript1.5",
    "text/x-ecmascript", "text/x-javascript"]);

export const MIME = Object.freeze({
    css: "text/css",
    javascript: "text/javascript",
    vtt: "text/vtt",
    svg: "image/svg+xml",
    png: "image/png",
    icon: "image/vnd.microsoft.icon",
    woff: "application/font-woff",
    audio: "audio/mpeg",
    video: "video/mp4",
    octetStream: "application/octet-stream",
    html: "text/html"
});

export const PORT_NAME = "scrapyard-capture";

export const MESSAGE = Object.freeze({
    start: "capture.start",
    abort: "capture.abort",
    unlock: "capture.unlock",
    ready: "capture.ready",
    framesRequest: "capture.frames.request",
    framesReply: "capture.frames.reply",
    framesCollect: "capture.frames.collect",
    load: "capture.load",
    write: "capture.write",
    progress: "capture.progress",
    done: "capture.done",
    failed: "capture.failed",
    dump: "capture.dump"
});

export const ARCHIVE_FORMAT = "scrapyard-archive/1";
