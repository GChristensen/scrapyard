// All-frames entry point: answers capture.frames.request with the frame's key, live-state snapshot and extras.
// Evaluated once per content-script realm; the listener is registered at module load.

import {MESSAGE} from "../shared/constants.js";
import {log} from "../shared/log.js";
import {frameKeyOf, identifyFrames} from "./frame_keys.js";
import {annotateLiveState, serializeDocument, loadedFontsOf} from "./snapshot.js";
import {indexWords, collectLinks} from "./extras.js";

const api = globalThis.browser || globalThis.chrome;

api.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== MESSAGE.framesRequest)
        return;

    try {
        identifyFrames(document);

        if (message.annotate)
            annotateLiveState(document);

        const reply = {
            type: MESSAGE.framesReply,
            key: frameKeyOf(window),
            url: document.baseURI,
            html: message.snapshot? serializeDocument(document): "",
            fonts: loadedFontsOf(document)
        };

        if (message.extras?.index)
            reply.index = indexWords(document.body);

        if (message.extras?.links)
            reply.links = collectLinks(document);

        Promise.resolve(api.runtime.sendMessage(reply)).catch(() => {});
    }
    catch (e) {
        log("error", e);
    }
});
