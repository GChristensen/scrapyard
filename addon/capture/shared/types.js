// JSDoc typedefs of the capture engine's data model. This module holds no runtime code;
// other modules reference the types with
//     /** @typedef {import("../shared/types.js").Resource} Resource */

/**
 * @typedef {"stylesheet"|"font"|"image"|"icon"|"audio"|"video"|"script"|"track"|"svg"|"object"} ResourceKind
 */

/**
 * @typedef {object} Resource
 * @property {number}  id            sequential, 0-based, discovery order (stable for the run)
 * @property {string}  url           absolute, fragment stripped: the identity key
 * @property {string}  referrer      base URI of the discovering document, fragment stripped
 * @property {ResourceKind} kind
 * @property {string}  expectedMime  guessed at discovery; drives validation and decoding
 * @property {string}  mime          actual Content-Type mime, or expectedMime if none
 * @property {string}  charset       "" for binary; lowercase charset name for text
 * @property {boolean} passive       eligible as passive mixed content
 * @property {"pending"|"loading"|"success"|"failure"} status
 * @property {string}  reason        failure reason or ""
 * @property {Uint8Array|null} bytes binary payload (null for text, and after an unpacked write)
 * @property {string|null} text      decoded text payload (stylesheet, script, track, svg-as-text)
 * @property {number}  size          byte length
 * @property {{html: number, css: number, frames: Set<string>}} refs  reference counts
 * @property {number}  replaced      substitutions performed in pass 3 (diagnostics)
 * @property {string|null} hash      sha256 hex (unpacked mode)
 * @property {string|null} path      archive-relative path assigned by the sink (unpacked mode)
 */

/**
 * @typedef {object} RememberRequest
 * @property {string} url
 * @property {string} baseURI
 * @property {ResourceKind} kind
 * @property {string} expectedMime
 * @property {string} [charset]
 * @property {boolean} [passive]
 * @property {string} [frameKey]
 * @property {boolean} [fromCss]
 */

/**
 * @typedef {object} CaptureOptions
 * @property {"all"|"displayed"} images
 * @property {"all"|"displayed"} cssImages
 * @property {"used"|"woff"|"all"} fonts
 * @property {boolean} audioVideo
 * @property {boolean} objectEmbed
 * @property {boolean} scripts
 * @property {boolean} executeScripts
 * @property {boolean} crossOriginFrames
 * @property {number} maxFrameDepth
 * @property {boolean} shadowDom
 * @property {"remove"|"rehide"|"keep"} hiddenElements
 * @property {boolean} removeUnsavedUrls
 * @property {boolean} prettyPrint
 * @property {boolean} mergeCssImages
 * @property {number} maxResourceSize     MB
 * @property {number} maxResourceTime     seconds
 * @property {boolean} allowPassiveMixedContent
 * @property {"strict"|"origin"|"origin-path"} referer
 * @property {number} concurrency
 * @property {"none"|"scroll"|"shrink"} lazyLoad
 * @property {number} lazyLoadScrollTime  seconds
 * @property {number} lazyLoadShrinkTime  seconds
 * @property {boolean} lazyImages
 * @property {number} startDelay          seconds
 * @property {number} frameReplyTimeout   ms
 * @property {boolean} lockOverlay
 * @property {string} lockIconUrl
 * @property {string} version
 * @property {string} shadowLoaderSource
 * @property {boolean} isFirefox
 * @property {boolean} incognito
 */

/**
 * @typedef {object} FrameSnapshot
 * @property {string} key        "0", "0-1", "0-1-0" ...
 * @property {string} url        document.baseURI of the frame
 * @property {string} html       doctype + outerHTML with <base href> spliced after <head...>
 * @property {Array<{family: string, weight: string, style: string, stretch: string}>} fonts
 * @property {string[]} [index]  words of the frame body
 * @property {Array<{url: string, text: string}>} [links]  outgoing http(s) links
 */

/**
 * @typedef {object} CaptureProgress
 * @property {"prepare"|"lazy"|"frames"|"styles"|"load"|"resources"|"serialize"|"write"|"done"} stage
 * @property {number} done
 * @property {number} total
 */

/**
 * @typedef {object} ManifestResource
 * @property {string} url
 * @property {string} referrer
 * @property {ResourceKind} kind
 * @property {string} mime
 * @property {string} charset
 * @property {number} size
 * @property {string} [sha256]
 * @property {string} [path]
 * @property {"success"|"failure"} status
 * @property {string} [reason]
 * @property {{html: number, css: number, frames: string[]}} refs
 */

/**
 * @typedef {object} ArchiveManifest
 * @property {"scrapyard-archive/1"} format
 * @property {string} url
 * @property {string} title
 * @property {string} captured    ISO date
 * @property {string} engine      options.version
 * @property {"packed"|"unpacked"} mode
 * @property {object} options     effective CaptureOptions minus host-only fields
 * @property {Array<{key: string, url: string, path?: string, crossOrigin?: boolean}>} frames
 * @property {ManifestResource[]} resources
 */

/**
 * @typedef {object} CaptureResult
 * @property {"packed"|"unpacked"} mode
 * @property {string} [html]           the whole document (packed mode; unpacked mode: the text of index.html)
 * @property {string} url              document.URL (decoded, as written to the meta)
 * @property {string} title
 * @property {ArchiveManifest} manifest
 * @property {string[]} [index]        union of all frames' words, deduplicated
 * @property {Array<{url: string, text: string}>} [links]
 * @property {Array<{url: string, reason: string, kind: ResourceKind}>} failures
 * @property {{start: number, stages: Object<string, number>}} timing
 */

/**
 * @typedef {object} ElementRule
 * @property {string} name
 * @property {(el: Element) => boolean} match
 * @property {(el: Element, ctx: object) => void} [discoverStyles]  pass 1
 * @property {(el: Element, ctx: object) => void} [discover]        pass 2
 * @property {(el: Element, ctx: object, tag: object) => (symbol|{replacement: string}|void)} [serialize]  pass 3
 */

/**
 * @typedef {object} FileWriter
 * @property {(file: {path: string, bytes: Uint8Array|string, mime: string}) => Promise<void>} write
 */

export {};
