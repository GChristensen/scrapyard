// Lazy-load forcing: the scroll and shrink methods

import {MARK} from "../shared/constants.js";
import {delay} from "./prepare.js";
import {log} from "../shared/log.js";

/** @typedef {import("../shared/types.js").CaptureOptions} CaptureOptions */

/**
 * @typedef {object} ShrinkState
 * @property {string} htmlCssText
 * @property {string} bodyCssText
 * @property {number} scrollY
 */

/**
 * @param {Window} win
 * @param {CaptureOptions} options
 * @param {AbortSignal} [signal]
 * @returns {Promise<ShrinkState|null>} the state to undo after serialization when the shrink method ran
 */
export async function forceLazyContent(win, options, signal) {
    if (options.lazyLoad === "scroll") {
        await scrollPage(win, options.lazyLoadScrollTime * 1000, signal);
        return null;
    }

    if (options.lazyLoad === "shrink")
        return shrinkPage(win, options.lazyLoadShrinkTime * 1000, signal);

    return null;
}

async function scrollPage(win, stepTime, signal) {
    const doc = win.document;
    const start = performance.now();
    const originalScrollY = win.scrollY;
    let scrollY = 0;

    win.scrollTo(0, scrollY);

    await delay(stepTime, signal);   /* allow time for first lazy loads to complete */

    while (scrollY < doc.documentElement.scrollHeight) {
        scrollY += win.innerHeight;
        win.scrollTo(0, scrollY);
        await delay(stepTime, signal);   /* allow time for some more lazy loads to complete */
    }

    win.scrollTo(0, doc.documentElement.scrollHeight - win.innerHeight - 10);
    win.scrollTo(0, doc.documentElement.scrollHeight);

    await delay(500 + stepTime, signal);   /* allow time for final lazy loads to complete */

    log("debug", "lazy load (scroll) time", (performance.now() - start) / 1000, "s");

    win.scrollTo(0, originalScrollY);
}

async function shrinkPage(win, checkTime, signal) {
    const doc = win.document;
    const start = performance.now();

    /** @type {ShrinkState} */
    const state = {
        htmlCssText: doc.documentElement.style.cssText,
        bodyCssText: doc.body.style.cssText,
        scrollY: win.scrollY
    };

    try {
        const scaleX = 400 / doc.body.scrollWidth;
        const scaleY = 0.025;
        const originX = win.innerWidth / 2;
        const originY = 10;

        win.scrollTo(0, doc.body.scrollHeight);   /* trigger lazy load scripts in page */
        win.scrollTo(0, 0);

        doc.documentElement.style.setProperty("background", "#FFFFFF", "important");
        doc.body.style.setProperty("transform", "scaleX(" + scaleX + ") scaleY(" + scaleY + ")", "important");
        doc.body.style.setProperty("visibility", "hidden", "important");

        await delay(500 + checkTime, signal);   /* allow time for the page to settle after the scroll */

        doc.body.style.removeProperty("visibility");
        doc.body.style.setProperty("transform-origin", originX + "px " + originY + "px", "important");

        let lastScrollHeight = doc.body.scrollHeight;

        win.scrollTo(0, doc.body.scrollHeight);   /* trigger lazy load scripts in page */
        win.scrollTo(0, 0);

        await delay(500 + checkTime, signal);   /* allow time for first lazy loads to complete */

        while (doc.body.scrollHeight > lastScrollHeight && doc.body.scrollHeight * scaleY < win.innerHeight) {
            lastScrollHeight = doc.body.scrollHeight;
            win.scrollTo(0, doc.body.scrollHeight);
            win.scrollTo(0, 0);
            await delay(checkTime, signal);   /* allow time for some more lazy loads to complete */
        }

        win.scrollTo(0, doc.body.scrollHeight);
        win.scrollTo(0, 0);

        await delay(500 + checkTime, signal);   /* allow time for final lazy loads to complete */

        log("debug", "lazy load (shrink) time", (performance.now() - start) / 1000, "s");
    }
    catch (e) {
        undoShrink(win, state);
        throw e;
    }

    return state;
}

/**
 * Restores the live document after the shrink method.
 * @param {Window} win
 * @param {ShrinkState} state
 */
export function undoShrink(win, state) {
    const doc = win.document;
    doc.documentElement.style.cssText = state.htmlCssText;
    doc.body.style.cssText = state.bodyCssText;
    win.scrollTo(0, state.scrollY);
}

/**
 * Promotes loading="lazy" and the data attributes of common lazy-load libraries so the images load.
 * @param {Document} doc
 */
export function forceLazyImages(doc) {
    doc.querySelectorAll("img").forEach(element => {
        if (element.getAttribute("loading") === "lazy") {
            element.removeAttribute("loading");
            element.setAttribute(MARK.loading, "lazy");
        }

        /* changes are the same as if the page was scrolled by the user */

        if (element.getAttribute("data-src")) element.setAttribute("src", element.getAttribute("data-src"));
        else if (element.getAttribute("data-original")) element.setAttribute("src", element.getAttribute("data-original"));
        else if (element.getAttribute("data-normal")) element.setAttribute("src", element.getAttribute("data-normal"));

        if (element.getAttribute("data-srcset")) element.setAttribute("srcset", element.getAttribute("data-srcset"));
        else if (element.getAttribute("data-original-set")) element.setAttribute("srcset", element.getAttribute("data-original-set"));
    });
}
