// Top-frame entry point: answers capture.start / capture.abort / capture.unlock from the host.
// Evaluated once per content-script realm; the listener is registered at module load.

import {MESSAGE} from "../shared/constants.js";
import {normalizeOptions} from "../shared/options.js";
import {log, setDebug} from "../shared/log.js";
import {openPort} from "./port.js";
import {PageCapture} from "./capture.js";
import {unlock} from "./prepare.js";

const PORT_LINGER_MS = 30000;

/** @type {{controller: AbortController, port: import("./port.js").CapturePort}|null} */
let active = null;

(globalThis.browser || globalThis.chrome).runtime.onMessage.addListener((message, sender) => {
    if (!message || typeof message.type !== "string")
        return;

    switch (message.type) {
        case MESSAGE.start:
            return start(message);

        case MESSAGE.abort:
            if (active)
                active.controller.abort();
            return;

        case MESSAGE.unlock:
            unlock(document);
            return;
    }
});

async function start(message) {
    if (active)
        return {accepted: false, error: "busy"};

    setDebug(!!message.debug);

    const options = normalizeOptions(message.options);
    const controller = new AbortController();
    const port = openPort();

    active = {controller, port};

    port.on(MESSAGE.abort, () => controller.abort());
    port.onDisconnect(() => {
        if (active && active.port === port) {
            controller.abort();
            active = null;
        }
    });

    const capture = new PageCapture(document, options, {
        port,
        signal: controller.signal,
        onProgress: progress => port.notify(MESSAGE.progress, progress)
    });

    (async () => {
        try {
            const result = await capture.run({mode: message.mode, selection: message.selection, extras: message.extras});
            port.notify(MESSAGE.done, {result});
        }
        catch (e) {
            log("error", e);
            port.notify(MESSAGE.failed, {error: {name: e?.name || "Error", message: e?.message || String(e), stack: e?.stack}});
        }
        finally {
            if (active && active.port === port)
                active = null;

            /* the background disconnects after taking the result; this is the fallback */
            setTimeout(() => port.disconnect(), PORT_LINGER_MS);
        }
    })();

    return {accepted: true};
}
