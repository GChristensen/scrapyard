// CaptureOptions defaults and normalization (see types.js for the field list).

/** @typedef {import("./types.js").CaptureOptions} CaptureOptions */

const ENUMS = {
    images: ["all", "displayed"],
    cssImages: ["all", "displayed"],
    fonts: ["used", "woff", "all"],
    hiddenElements: ["remove", "rehide", "keep"],
    referer: ["strict", "origin", "origin-path"],
    lazyLoad: ["none", "scroll", "shrink"]
};

const NUMBERS = {
    maxFrameDepth: {min: 0, max: 100, integer: true},
    maxResourceSize: {min: 0, max: 100000},
    maxResourceTime: {min: 0, max: 100000},
    concurrency: {min: 1, max: 64, integer: true},
    lazyLoadScrollTime: {min: 0, max: 60},
    lazyLoadShrinkTime: {min: 0, max: 60},
    startDelay: {min: 0, max: 600},
    frameReplyTimeout: {min: 0, max: 60000, integer: true}
};

const BOOLEANS = ["audioVideo", "objectEmbed", "scripts", "executeScripts", "crossOriginFrames", "shadowDom",
    "removeUnsavedUrls", "prettyPrint", "mergeCssImages", "allowPassiveMixedContent", "lazyImages", "lockOverlay",
    "isFirefox", "incognito"];

const STRINGS = ["lockIconUrl", "version", "shadowLoaderSource"];

/** Host-only fields, left out of the archive manifest. */
export const HOST_ONLY_OPTIONS = Object.freeze(["lockIconUrl", "shadowLoaderSource", "isFirefox", "incognito", "version"]);

/** @returns {CaptureOptions} */
export function defaultOptions() {
    return {
        images: "all",
        cssImages: "all",
        fonts: "all",
        audioVideo: true,
        objectEmbed: true,
        scripts: false,
        executeScripts: true,
        crossOriginFrames: true,
        maxFrameDepth: 5,
        shadowDom: false,
        hiddenElements: "remove",
        removeUnsavedUrls: true,
        prettyPrint: false,
        mergeCssImages: true,
        maxResourceSize: 50,
        maxResourceTime: 30,
        allowPassiveMixedContent: false,
        referer: "strict",
        concurrency: 6,
        lazyLoad: "none",
        lazyLoadScrollTime: 0.2,
        lazyLoadShrinkTime: 0.5,
        lazyImages: true,
        startDelay: 0,
        frameReplyTimeout: 1500,
        lockOverlay: true,
        lockIconUrl: "",
        version: "",
        shadowLoaderSource: "",
        isFirefox: false,
        incognito: false
    };
}

/**
 * Fills missing fields with defaults and coerces invalid values to their defaults.
 * @param {Partial<CaptureOptions>|null|undefined} o
 * @returns {CaptureOptions}
 */
export function normalizeOptions(o) {
    const defaults = defaultOptions();
    const result = {...defaults};
    const source = o && typeof o === "object"? o: {};

    for (const [key, values] of Object.entries(ENUMS))
        if (values.includes(source[key]))
            result[key] = source[key];

    for (const [key, spec] of Object.entries(NUMBERS)) {
        let value = Number(source[key]);

        if (source[key] !== undefined && source[key] !== null && Number.isFinite(value)) {
            if (spec.integer)
                value = Math.round(value);

            result[key] = Math.min(spec.max, Math.max(spec.min, value));
        }
    }

    for (const key of BOOLEANS)
        if (typeof source[key] === "boolean")
            result[key] = source[key];

    for (const key of STRINGS)
        if (typeof source[key] === "string")
            result[key] = source[key];

    return result;
}

/**
 * The options as written to the archive manifest and the scrapyard-state meta.
 * @param {CaptureOptions} options
 * @returns {object}
 */
export function publicOptions(options) {
    const result = {};

    for (const [key, value] of Object.entries(options))
        if (!HOST_ONLY_OPTIONS.includes(key))
            result[key] = value;

    return result;
}
