// waitForLoad: the readiness wait must be bounded. prepare.js is DOM-free at module level and takes the
// document and its window as arguments, so the three outcomes can be driven with plain objects.

import assert from "node:assert/strict";
import {waitForLoad, delay} from "../../../addon/capture/content/prepare.js";
import {setDebug} from "../../../addon/capture/shared/log.js";

setDebug(false);   /* the timeout path logs a warning */

/** A document that never becomes "complete", and its window. */
function stalledDocument() {
    const listeners = [];

    const win = {
        addEventListener: (type, fn) => listeners.push([type, fn]),
        removeEventListener: (type, fn) => {
            const i = listeners.findIndex(([t, f]) => t === type && f === fn);

            if (i >= 0)
                listeners.splice(i, 1);
        }
    };

    return {doc: {readyState: "interactive", defaultView: win}, listeners};
}

export const tests = {
    "resolves at once for a document that is already complete"() {
        return waitForLoad({readyState: "complete"}, undefined, 10000);
    },

    async "gives up on a page that never finishes loading"() {
        const {doc, listeners} = stalledDocument();
        const started = Date.now();

        /* raced, so that losing the bound fails the test instead of hanging the whole suite */
        const watchdog = delay(3000).then(() => { throw new Error("waitForLoad never returned: the bound is gone"); });

        await Promise.race([waitForLoad(doc, undefined, 30), watchdog]);

        assert.ok(Date.now() - started >= 25, "returned before the timeout expired");
        assert.equal(listeners.length, 0, "the load listener was not removed");
    },

    async "waits forever when no timeout is given (the behaviour before the bound)"() {
        const {doc} = stalledDocument();
        let settled = false;

        waitForLoad(doc, undefined, 0).then(() => settled = true, () => settled = true);
        await delay(40);

        assert.equal(settled, false, "a zero timeout must not bound the wait");
    },

    async "resolves when the load event arrives before the timeout"() {
        const {doc, listeners} = stalledDocument();
        const promise = waitForLoad(doc, undefined, 5000);

        doc.readyState = "complete";
        listeners.filter(([type]) => type === "load").forEach(([, fn]) => fn());

        await promise;
        assert.equal(listeners.length, 0);
    },

    async "an abort still wins over the timeout"() {
        const {doc, listeners} = stalledDocument();
        const controller = new AbortController();
        const promise = waitForLoad(doc, controller.signal, 5000);

        controller.abort();

        await assert.rejects(promise, error => error.name === "AbortError");
        assert.equal(listeners.length, 0);
    }
};
