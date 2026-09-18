import {defaultOptions} from "./capture/shared/options.js";
import {fetchText} from "./utils_io.js";
import {settings} from "./settings.js";

export const CAPTURE_SETTINGS_KEY = "savepage-settings";

/** Defaults of the stored keys the options page edits. */
export const CAPTURE_SETTINGS_DEFAULTS = Object.freeze({
    "options-retaincrossframes": true,
    "options-removeunsavedurls": true,
    "options-loadshadow": true,
    "options-savehtmlimagesall": true,
    "options-savehtmlaudiovideo": true,
    "options-savehtmlobjectembed": true,
    "options-savecssimagesall": true,
    "options-savecssfontswoff": true,
    "options-savecssfontsall": true,
    "options-savescripts": false,
    "options-executescripts": true,
    "options-removeelements": true,
    "options-rehideelements": true,
    "options-mergecssimages": true,
    "options-formathtml": false,
    "options-maxframedepth": 5,
    "options-maxresourcesize": 50,
    "options-maxresourcetime": 30,
    "options-allowpassive": false,
    "options-crossorigin": 0,
    "options-lazyloadtype": "0",
    "options-lazyloadscrolltime": 0.2,
    "options-lazyloadshrinktime": 0.5,
    "options-loadlazyimages": true,
    "options-savedelaytime": 0
});

/**
 * @returns {Promise<object>} the stored capture settings with defaults for missing keys
 */
export async function loadCaptureSettings() {
    const stored = (await browser.storage.local.get(CAPTURE_SETTINGS_KEY))?.[CAPTURE_SETTINGS_KEY] || {};
    return {...CAPTURE_SETTINGS_DEFAULTS, ...stored};
}

const REFERER = {0: "strict", 1: "origin", 2: "origin-path"};
const LAZY_LOAD = {"0": "none", "1": "scroll", "2": "shrink"};

/**
 * @param {object} stored  the capture settings object
 * @returns {object} the engine options without the host-only fields
 */
export function mapCaptureSettings(stored) {
    const s = {...CAPTURE_SETTINGS_DEFAULTS, ...stored};
    const defaults = defaultOptions();
    const fonts = s["options-savecssfontsall"]? "all": (s["options-savecssfontswoff"]? "woff": "used");
    const hidden = s["options-removeelements"]? "remove": (s["options-rehideelements"]? "rehide": "keep");

    return {
        images: s["options-savehtmlimagesall"]? "all": "displayed",
        cssImages: s["options-savecssimagesall"]? "all": "displayed",
        fonts,
        audioVideo: !!s["options-savehtmlaudiovideo"],
        objectEmbed: !!s["options-savehtmlobjectembed"],
        scripts: !!s["options-savescripts"],
        executeScripts: !!s["options-executescripts"],
        crossOriginFrames: !!s["options-retaincrossframes"],
        maxFrameDepth: +s["options-maxframedepth"],
        shadowDom: !!s["options-loadshadow"],
        hiddenElements: hidden,
        removeUnsavedUrls: !!s["options-removeunsavedurls"],
        prettyPrint: !!s["options-formathtml"],
        mergeCssImages: !!s["options-mergecssimages"],
        maxResourceSize: +s["options-maxresourcesize"],
        maxResourceTime: +s["options-maxresourcetime"],
        allowPassiveMixedContent: !!s["options-allowpassive"],
        referer: REFERER[+s["options-crossorigin"]] || defaults.referer,
        lazyLoad: LAZY_LOAD[String(s["options-lazyloadtype"])] || "none",
        lazyLoadScrollTime: +s["options-lazyloadscrolltime"],
        lazyLoadShrinkTime: +s["options-lazyloadshrinktime"],
        lazyImages: !!s["options-loadlazyimages"],
        startDelay: +s["options-savedelaytime"]
    };
}

/**
 * The complete CaptureOptions for capturing a tab.
 * @param {object} tab  browser.tabs.Tab
 * @returns {Promise<object>}
 */
export async function buildCaptureOptions(tab) {
    await settings.load();

    const options = mapCaptureSettings(await loadCaptureSettings());

    options.lockIconUrl = browser.runtime.getURL("icons/lock.svg");
    options.version = browser.runtime.getManifest().version;
    options.isFirefox = !!settings.platform?.firefox;
    options.incognito = !!tab?.incognito;
    options.shadowLoaderSource = "";

    if (options.shadowDom) {
        try {
            options.shadowLoaderSource = await fetchText(browser.runtime.getURL("capture/page/shadow_loader.js")) || "";
        }
        catch (e) {
            console.error(e);
        }
    }

    return options;
}
