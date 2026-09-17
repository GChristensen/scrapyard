// Accepts capture ports and dispatches their messages to the session registered for the sender's tab.
// One session per tab; a second port for the same tab is refused with capture.failed {error: "busy"}.

import {PORT_NAME, MESSAGE} from "../shared/constants.js";
import {log} from "../shared/log.js";

/** @type {Map<number, CaptureSession>} */
const sessions = new Map();

/**
 * @typedef {object} SessionHandlers
 * @property {(payload: object) => Promise<object>} load
 * @property {(payload: object) => Promise<object>} write
 * @property {(payload: object) => Promise<object>} collectFrames
 * @property {(progress: object) => void} [progress]
 */

export class CaptureSession {
    /**
     * @param {number} tabId
     * @param {SessionHandlers} handlers
     */
    constructor(tabId, handlers) {
        this.tabId = tabId;
        this.handlers = handlers;
        this.port = null;
        this.settled = false;
        this.promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }

    /** @param {object} result */
    resolve(result) {
        if (!this.settled) {
            this.settled = true;
            this._resolve(result);
        }

        this.close();
    }

    /** @param {Error} error */
    reject(error) {
        if (!this.settled) {
            this.settled = true;
            this._reject(error);
        }

        this.close();
    }

    /** Releases the tab and disconnects the port. */
    close() {
        if (sessions.get(this.tabId) === this)
            sessions.delete(this.tabId);

        if (this.port) {
            const port = this.port;
            this.port = null;

            try { port.disconnect(); } catch (e) { /* already gone */ }
        }
    }

    /** Sends a notification to the content side. */
    notify(type, payload) {
        if (this.port)
            try { this.port.postMessage({type, payload}); } catch (e) { log("error", e); }
    }

    _attach(port) {
        this.port = port;

        port.onMessage.addListener(message => this._onMessage(message));

        port.onDisconnect.addListener(() => {
            if (this.port === port) {
                this.port = null;
                this.reject(new Error("The capture port was disconnected"));
            }
        });
    }

    _onMessage(message) {
        if (!message || typeof message !== "object")
            return;

        const {id, type, payload} = message;

        if (id != null) {
            this._request(type, payload || {})
                .then(reply => this._reply(id, {reply}), error => {
                    log("error", "request failed", type, error);
                    this._reply(id, {error: {message: error?.message || String(error), reason: error?.reason}});
                });
            return;
        }

        switch (type) {
            case MESSAGE.progress:
                if (this.handlers.progress)
                    try { this.handlers.progress(payload); } catch (e) { log("error", e); }
                break;

            case MESSAGE.done:
                this.resolve(payload?.result);
                break;

            case MESSAGE.failed: {
                const info = payload?.error || {};
                const error = new Error(info.message || "The capture failed");
                error.name = info.name || "CaptureError";
                error.remoteStack = info.stack;
                this.reject(error);
                break;
            }

            default:
                log("debug", "unhandled port notification", type);
        }
    }

    _reply(id, body) {
        if (this.port)
            try { this.port.postMessage({id, ...body}); } catch (e) { log("error", e); }
    }

    async _request(type, payload) {
        switch (type) {
            case MESSAGE.load:
                return this.handlers.load(payload);
            case MESSAGE.write:
                return this.handlers.write(payload);
            case MESSAGE.framesCollect:
                return this.handlers.collectFrames(payload);
            case MESSAGE.dump:
                log("info", "dump", payload);
                return {ok: true};
            default:
                throw new Error("Unknown capture request: " + type);
        }
    }
}

/**
 * Registers a session for a tab; rejects when one is already active.
 * @param {number} tabId
 * @param {SessionHandlers} handlers
 * @returns {CaptureSession}
 */
export function openSession(tabId, handlers) {
    if (sessions.has(tabId))
        throw new Error("A capture is already running in this tab");

    const session = new CaptureSession(tabId, handlers);
    sessions.set(tabId, session);

    return session;
}

/**
 * @param {number} tabId
 * @returns {CaptureSession|null}
 */
export function sessionOf(tabId) {
    return sessions.get(tabId) || null;
}

browser.runtime.onConnect.addListener(port => {
    if (port.name !== PORT_NAME)
        return;

    const tabId = port.sender?.tab?.id;
    const session = tabId != null? sessions.get(tabId): null;

    // other extension pages that import this module (sidebar, popup) receive the port too: only the context
    // that owns the session answers
    if (!session)
        return;

    if (session.port) {
        try {
            port.postMessage({type: MESSAGE.failed, payload: {error: {name: "CaptureError", message: "busy"}}});
            port.disconnect();
        }
        catch (e) {
            /* ignore */
        }

        return;
    }

    session._attach(port);
});
