// Emulates the runtime.Port interface over a WebSocket connection to a remotely hosted backend.
// Incoming messages are passed to listeners as JSON strings, as they are delivered by native messaging.

const PING_INTERVAL = 20000;

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
    #disconnected = false;

    constructor(url) {
        this.onMessage = new PortEvent();
        this.onDisconnect = new PortEvent();

        this.#ws = new WebSocket(url);

        this.#ws.onopen = () => {
            for (const message of this.#queue)
                this.#ws.send(message);
            this.#queue = [];

            this.#pingTimer = setInterval(() => this.postMessage({type: "PING"}), PING_INTERVAL);
        };

        this.#ws.onmessage = event => {
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

        this.#ws.onclose = () => this.#onClose();
        this.#ws.onerror = () => this.#onClose();
    }

    #onClose() {
        clearInterval(this.#pingTimer);

        if (!this.#disconnected) {
            this.#disconnected = true;
            this.onDisconnect.dispatch(this);
        }
    }

    postMessage(message) {
        const data = JSON.stringify(message);

        if (this.#ws.readyState === WebSocket.OPEN)
            this.#ws.send(data);
        else if (this.#ws.readyState === WebSocket.CONNECTING)
            this.#queue.push(data);
        else
            throw new Error("Attempt to postMessage on disconnected port");
    }

    disconnect() {
        this.#ws.close();
    }
}
