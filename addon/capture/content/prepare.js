// The prepare stage: readiness wait, encoding meta removal, lock overlay, selection container, saved-page detection.

import {MARK} from "../shared/constants.js";
import {log} from "../shared/log.js";

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(abortError());

        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        function onAbort() {
            clearTimeout(timer);
            reject(abortError());
        }

        signal?.addEventListener("abort", onAbort, {once: true});
    });
}

/** @returns {Error} a DOMException-like AbortError */
export function abortError() {
    const error = new Error("The capture was aborted");
    error.name = "AbortError";
    return error;
}

/**
 * Resolves when document.readyState is "complete", or when the timeout expires.
 *
 * A single stalled subresource keeps readyState at "interactive" indefinitely, and the load event a page like
 * that never fires used to hold the whole capture in the prepare stage with no error and no diagnostic. On
 * expiry the capture proceeds with the document as it stands: a partially loaded page is a far better outcome
 * than a hang, and every reference that could not be saved is recorded with a reason anyway.
 *
 * @param {Document} doc
 * @param {AbortSignal} [signal]
 * @param {number} [timeout]  ms; 0 waits forever
 */
export function waitForLoad(doc, signal, timeout = 0) {
    if (doc.readyState === "complete")
        return Promise.resolve();

    return new Promise((resolve, reject) => {
        const win = doc.defaultView;
        const timer = timeout > 0? setTimeout(onTimeout, timeout): null;

        function done() {
            clearTimeout(timer);
            win.removeEventListener("load", onLoad);
            signal?.removeEventListener("abort", onAbort);
        }

        function onLoad() {
            if (doc.readyState === "complete") {
                done();
                resolve();
            }
        }

        function onTimeout() {
            log("warn", "the page did not finish loading within", timeout / 1000,
                "s; capturing it in the state it is in (readyState:", doc.readyState + ")");
            done();
            resolve();
        }

        function onAbort() {
            done();
            reject(abortError());
        }

        win.addEventListener("load", onLoad, false);
        signal?.addEventListener("abort", onAbort, {once: true});

        onLoad();
    });
}

/**
 * Removes the encoding declarations from the live document: the output always declares UTF-8 itself.
 * @param {Document} doc
 */
export function clearDocumentEncoding(doc) {
    doc.querySelectorAll("meta[http-equiv='content-type' i], meta[charset]").forEach(meta => meta.remove());
}

/**
 * Inserts the full-viewport lock overlay as the first body child (idempotent).
 * @param {Document} doc
 * @param {string} iconUrl
 */
export function lock(doc, iconUrl) {
    const body = doc.body;

    if (!body || doc.getElementById(MARK.overlay))
        return;

    const overlay = doc.createElement("div");
    overlay.id = MARK.overlay;

    const style = overlay.style;
    style.zIndex = "2147483647";
    style.margin = "0";
    style.padding = "0";
    style.width = "100%";
    style.height = "100%";
    style.backgroundColor = "#9995";
    style.position = "fixed";
    style.left = style.right = "0";
    style.bottom = style.top = "0";
    style.display = "flex";
    style.alignItems = "center";
    style.justifyContent = "center";

    // an <object> would be blocked by strict page CSPs (object-src); <img> loads under the more permissive img-src
    if (iconUrl) {
        const image = doc.createElement("img");
        image.setAttribute("src", iconUrl);
        overlay.appendChild(image);
    }

    body.insertBefore(overlay, body.firstChild);
}

/**
 * Removes the lock overlay.
 * @param {Document} doc
 */
export function unlock(doc) {
    const overlay = doc.getElementById(MARK.overlay);

    if (overlay)
        overlay.remove();
}

/**
 * Appends a hidden container holding the selection fragment; frames inside get a random fragment on their src
 * so they get frame keys of their own.
 * @param {Document} doc
 * @param {string} html
 * @returns {HTMLElement}
 */
export function createSelectionRoot(doc, html) {
    const root = doc.createElement("div");
    root.style.display = "none";
    root.innerHTML = html;
    doc.body.appendChild(root);

    root.querySelectorAll("iframe, frame").forEach(frame => {
        frame.src = frame.src + "#" + Math.floor((Math.random() * 1000000) + 1);
    });

    return root;
}

/**
 * @param {Document} doc
 * @returns {{url: string}|null} the original URL when the document is a page saved by this engine
 */
export function detectSavedPage(doc) {
    const meta = doc.querySelector(`meta[name='${MARK.metaUrl}']`) || doc.querySelector(`meta[name='${MARK.oldMetaUrl}']`);

    return meta? {url: meta.getAttribute("content") || doc.URL}: null;
}
