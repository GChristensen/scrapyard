// Frame keys: "0" for the top frame, "0-1" for its second subframe, "0-1-0" for that frame's first subframe.
// Computed by walking from a window up to window.top, prepending the index of the window in parent.frames.

import {MARK} from "../shared/constants.js";

/**
 * @param {Window} win
 * @returns {string}
 */
export function frameKeyOf(win) {
    let key = "";
    let current = win;
    let parent = current.parent;

    while (current !== win.top) {
        let i;

        for (i = 0; i < parent.frames.length; i++)
            if (parent.frames[i] === current)
                break;

        key = "-" + i + key;
        current = parent;
        parent = parent.parent;
    }

    return "0" + key;
}

/**
 * Stamps every reachable same-origin iframe/frame element of the document (recursively) with its key.
 * Cross-origin children are stamped by their own script instance.
 * @param {Document} doc
 */
export function identifyFrames(doc) {
    stamp(doc.documentElement);
}

function stamp(element) {
    if (!element)
        return;

    if (element.localName === "iframe" || element.localName === "frame") {
        try {
            const win = element.contentWindow;

            if (win)
                element.setAttribute(MARK.key, frameKeyOf(win));

            if (element.contentDocument && element.contentDocument.documentElement)   /* may be loading */
                stamp(element.contentDocument.documentElement);
        }
        catch (e) {
            /* cross-origin */
        }
    }
    else {
        for (let i = 0; i < element.children.length; i++)
            if (element.children[i] != null)   /* in case the page is not fully loaded */
                stamp(element.children[i]);
    }
}

/**
 * @param {Element} el  an iframe/frame element
 * @returns {string|null} the key stamped on the element (new or old vocabulary)
 */
export function frameKeyAttribute(el) {
    return el.getAttribute(MARK.key) || el.getAttribute(MARK.oldKey);
}
