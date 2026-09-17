// The capture port: the only channel between the content side and the background during a run.
// Wire format: requests {id, type, payload} answered by {id, reply} or {id, error: {message}};
// notifications {type, payload} in both directions.

import {PORT_NAME} from "../shared/constants.js";
import {log} from "../shared/log.js";

/**
 * @typedef {object} CapturePort
 * @property {(type: string, payload?: object) => Promise<any>} request
 * @property {(type: string, payload?: object) => void} notify
 * @property {(type: string, handler: (payload: any, message: object) => void) => void} on
 * @property {(handler: () => void) => void} onDisconnect
 * @property {() => void} disconnect
 * @property {boolean} connected
 */

/**
 * @returns {CapturePort}
 */
export function openPort() {
    const api = globalThis.browser || globalThis.chrome;
    const raw = api.runtime.connect({name: PORT_NAME});
    const pending = new Map();
    const handlers = new Map();
    const disconnectHandlers = [];
    let nextId = 1;
    let connected = true;

    raw.onMessage.addListener(message => {
        if (!message || typeof message !== "object")
            return;

        if (message.id != null && pending.has(message.id)) {
            const {resolve, reject} = pending.get(message.id);
            pending.delete(message.id);

            if (message.error)
                reject(Object.assign(new Error(message.error.message || String(message.error)), {reason: message.error.reason}));
            else
                resolve(message.reply);

            return;
        }

        const handler = handlers.get(message.type);

        if (handler)
            handler(message.payload, message);
        else
            log("debug", "unhandled port message", message.type);
    });

    raw.onDisconnect.addListener(() => {
        connected = false;

        for (const {reject} of pending.values())
            reject(new Error("The capture port was disconnected"));

        pending.clear();

        for (const handler of disconnectHandlers)
            try { handler(); } catch (e) { log("error", e); }
    });

    return {
        request(type, payload = {}) {
            return new Promise((resolve, reject) => {
                if (!connected)
                    return reject(new Error("The capture port is closed"));

                const id = nextId++;
                pending.set(id, {resolve, reject});

                try {
                    raw.postMessage({id, type, payload});
                }
                catch (e) {
                    pending.delete(id);
                    reject(e);
                }
            });
        },

        notify(type, payload = {}) {
            if (connected)
                try { raw.postMessage({type, payload}); } catch (e) { log("error", e); }
        },

        on(type, handler) {
            handlers.set(type, handler);
        },

        onDisconnect(handler) {
            disconnectHandlers.push(handler);
        },

        disconnect() {
            if (connected) {
                connected = false;
                try { raw.disconnect(); } catch (e) { /* already gone */ }
            }
        },

        get connected() {
            return connected;
        }
    };
}
