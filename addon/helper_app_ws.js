// Emulates the runtime.Port interface over a WebSocket connection to a remotely hosted backend.
// Incoming messages are passed to listeners as JSON strings, as they are delivered by native messaging.

const PING_INTERVAL = 20000;
// the server answers each PING with PONG, a connection that has not received anything for this time
// is considered broken (e.g., half-open after sleep or a network change) and is closed
const PONG_TIMEOUT = PING_INTERVAL * 2 + 5000;

// the WebSocket close code used by the server when the session token is rejected
export const WS_CLOSE_POLICY_VIOLATION = 1008;

class PortEvent {
    #listeners = [];

    addListener(listener) {
        this.#listeners.push(listener);
    }

    removeListener(listener) {
        this.#listeners = this.#listeners.filter(l => l !== listener);
    }

    dispatch(...args) {
        for (const listener of [...this.#listeners])
            try {
                listener(...args);
            } catch (e) {
                console.error(e);
            }
    }
}

export class WebSocketPort {
    #ws;
    #queue = [];
    #pingTimer;
    #lastMessageTime;
    #disconnected = false;

    constructor(url) {
        this.onMessage = new PortEvent();
        this.onDisconnect = new PortEvent();
        this.opened = false;
        // the close code and reason of the connection, if it was closed by the server
        this.closeCode = undefined;
        this.closeReason = undefined;

        this.#ws = new WebSocket(url);

        this.#ws.onopen = () => {
            this.opened = true;
            this.#lastMessageTime = Date.now();

            for (const message of this.#queue)
                this.#ws.send(message);
            this.#queue = [];

            this.#pingTimer = setInterval(() => this.#ping(), PING_INTERVAL);
        };

        this.#ws.onmessage = event => {
            this.#lastMessageTime = Date.now();

            let message;

            try {
                message = JSON.parse(event.data);
            } catch (e) {
                console.error(e);
                return;
            }

            if (typeof message !== "string")
                message = JSON.stringify(message);

            this.onMessage.dispatch(message);
        };

        this.#ws.onclose = event => {
            this.closeCode = event.code;
            this.closeReason = event.reason;
            this.#onClose();
        };
        this.#ws.onerror = () => this.#onClose();
    }

    #ping() {
        if (Date.now() - this.#lastMessageTime > PONG_TIMEOUT) {
            console.error("No response from the Scrapyard server, closing the connection");
            this.disconnect();
            return;
        }

        try {
            this.postMessage({type: "PING"});
        }
        catch (e) {
            console.error(e);
        }
    }

    #onClose() {
        clearInterval(this.#pingTimer);

        if (!this.#disconnected) {
            this.#disconnected = true;
            this.onDisconnect.dispatch(this);
        }
    }

    get connected() {
        return !this.#disconnected;
    }

    postMessage(message) {
        const data = JSON.stringify(message);

        if (this.#disconnected)
            throw new Error("Attempt to postMessage on disconnected port");
        else if (this.#ws.readyState === WebSocket.OPEN)
            this.#ws.send(data);
        else if (this.#ws.readyState === WebSocket.CONNECTING)
            this.#queue.push(data);
        else
            throw new Error("Attempt to postMessage on disconnected port");
    }

    // the disconnection is reported immediately, the closing handshake of a broken connection may take minutes
    disconnect() {
        try {
            this.#ws.close();
        }
        catch (e) {
            console.error(e);
        }

        this.#onClose();
    }
}
