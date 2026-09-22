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
    stamp(doc);
}

// querySelectorAll finds the frame elements of one document natively; it does not cross into a subdocument, so
// the recursion is per document rather than per element. Like the element walk it replaces, this does not
// descend into shadow roots.
function stamp(doc) {
    if (!doc || !doc.documentElement)   /* in case the page is not fully loaded */
        return;

    for (const element of doc.querySelectorAll("iframe, frame")) {
        try {
            const win = element.contentWindow;

            if (win)
                element.setAttribute(MARK.key, frameKeyOf(win));

            stamp(element.contentDocument);
        }
        catch (e) {
            /* cross-origin */
        }
    }
}

/**
 * Whether the top frame can reach this window's document directly, which is exactly when it walks the live
 * document instead of a serialized snapshot (see resolveFrame in frames.js).
 *
 * Every ancestor is tested, not just window.top: in an A -> B(cross-origin) -> A nesting the innermost frame
 * shares an origin with the top but the top cannot reach it through B, so it does need to send its html. Any
 * failure answers false, so the fallback is always "the snapshot is needed".
 *
 * @param {Window} win
 * @returns {boolean}
 */
export function reachableFromTop(win) {
    try {
        let current = win;

        while (current !== current.top) {
            if (!current.parent.document)   /* throws when the parent is of another origin */
                return false;

            current = current.parent;
        }

        return true;
    }
    catch (e) {
        return false;
    }
}

/**
 * @param {Element} el  an iframe/frame element
 * @returns {string|null} the key stamped on the element (new or old vocabulary)
 */
export function frameKeyAttribute(el) {
    return el.getAttribute(MARK.key) || el.getAttribute(MARK.oldKey);
}
