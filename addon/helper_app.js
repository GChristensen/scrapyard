import UUID from "./uuid.js";
import {settings} from "./settings.js";
import {CONTEXT_BACKGROUND, getContextType, hasCSRPermission, showNotification} from "./utils_browser.js";
import {send} from "./proxy.js"
import {WebSocketPort} from "./helper_app_ws.js";

export const HELPER_APP_v2_IS_REQUIRED = "Scrapyard backend application v2.0+ is required.";
export const HELPER_APP_v2_1_IS_REQUIRED = "Scrapyard backend application v2.1+ is required.";

// the value passed as data_path in the server mode, the server uses its own data path
export const SERVER_DATA_PATH = "@server";

// delays of attempts to reconnect to a server after the connection is lost
const SERVER_RECONNECT_MIN_DELAY = 5000;
const SERVER_RECONNECT_MAX_DELAY = 60000;

class HelperApp {
    #auth;
    #externalEventHandlers = {};
    #connectionListeners = [];
    #serverConnected;
    #reconnectTimeout;
    #reconnectDelay = SERVER_RECONNECT_MIN_DELAY;
    #loginPromise;

    constructor() {
        this.auth = UUID.numeric();
        this.version = undefined;
        // server mode session token
        this.sessionToken = undefined;
        this.serverError = undefined;
    }

    get auth() {
        return this.#auth;
    }

    set auth(uuid) {
        this.#auth = uuid;
        this.authHeader = "Basic " + btoa("default:" + uuid);
    }

    isServerMode() {
        return !!settings.storage_mode_server();
    }

    serverURL() {
        return (settings.backend_server_url() || "").trim().replace(/\/+$/, "");
    }

    dataPath() {
        if (this.isServerMode())
            return SERVER_DATA_PATH;
        else
            return settings.data_folder_path();
    }

    async getPort() {
        if (this.port) {
            return this.port;
        }
        else {
            const attempt = this.port = new Promise(async (resolve, reject) => {
                await settings.load();

                // a disconnect of a previous port (e.g., after reset) should not affect the current one
                const isCurrent = port => this.port === attempt || this.port === port;

                const fail = port => {
                    resolve(null);

                    if (isCurrent(port)) {
                        this.port = null;
                        this._setServerConnected(false);
                    }
                };

                let port;

                if (this.isServerMode()) {
                    port = await this._openServerPort();

                    if (!port) {
                        fail();
                        return;
                    }
                }
                else
                    port = browser.runtime.connectNative("scrapyard_helper");

                port.onDisconnect.addListener(error => fail(port));

                let initListener = async response => {
                    response = JSON.parse(response);
                    if (response.type === "INITIALIZED") {
                        port.onMessage.removeListener(initListener);

                        await this._onInitialized(response, port);
                        this._setServerConnected(true);

                        resolve(port);
                    }
                }

                port.onMessage.addListener(initListener);

                try {
                    port.postMessage(this._initializationMessage());
                }
                catch (e) {
                    //console.error(e, e.name)
                    fail(port);
                }
            });

            return this.port;
        }
    }

    // tracks the state of the connection to a server, notifies the UI, and reconnects after the connection is lost,
    // so the UI indication is cleared and pending restores of the internal storage are performed
    _setServerConnected(connected) {
        if (!this.isServerMode())
            return;

        clearTimeout(this.#reconnectTimeout);

        if (connected)
            this.#reconnectDelay = SERVER_RECONNECT_MIN_DELAY;
        else {
            this.#reconnectTimeout = setTimeout(() => this._reconnect(), this.#reconnectDelay);
            this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, SERVER_RECONNECT_MAX_DELAY);
        }

        if (this.#serverConnected !== connected) {
            this.#serverConnected = connected;
            send.serverConnectionChanged({connected}).catch(() => {}); // no open pages are listening
        }
    }

    async _reconnect() {
        await settings.load();

        if (this.isServerMode() && !this.port)
            await this.probe();
    }

    serverConnectionErrorMessage() {
        return ("Can not connect to the Scrapyard server. " + (this.serverError || "")).trim();
    }

    _initializationMessage() {
        if (this.isServerMode())
            return {
                type: "INITIALIZE",
                token: this.sessionToken
            };
        else
            return {
                type: "INITIALIZE",
                port: settings.helper_port_number(),
                auth: this.auth,
                logging: !!settings.enable_helper_app_logging()
            };
    }

    async _openServerPort() {
        if (!this.serverURL()) {
            this.serverError = "The server URL is not specified.";
            return null;
        }

        // the WebSocket is (re)connected after browser startup or a disconnect, which is usually caused by
        // a server restart that invalidates sessions, so a new session is always obtained
        if (!await this._login())
            return null;

        const url = this.serverURL().replace(/^http/i, "ws") + "/ws";

        try {
            return new WebSocketPort(url);
        }
        catch (e) {
            console.error(e);
            this.serverError = "Can not connect to the server.";
        }
    }

    // exchanges the server key for a session token
    async _login() {
        if (this.#loginPromise)
            return this.#loginPromise;

        this.#loginPromise = (async () => {
            this.sessionToken = undefined;

            try {
                const response = await globalThis.fetch(this.serverURL() + "/auth/session", {
                    method: "POST",
                    headers: {"Authorization": "Bearer " + (settings.backend_server_key() || "")}
                });

                if (response.ok) {
                    const session = await response.json();
                    this.sessionToken = session.token;
                    this.serverError = undefined;
                    return true;
                }
                else if (response.status === 401)
                    this.serverError = "The server key is invalid.";
                else if (response.status === 429)
                    this.serverError = "Too many failed authentication attempts, please try again later.";
                else
                    this.serverError = `Server error ${response.status} (${response.statusText}).`;
            }
            catch (e) {
                console.error(e);
                this.serverError = "Make sure that the server is running and reachable. If it uses a self-signed TLS certificate, "
                    + "open the server URL in a browser tab and accept the certificate.";
            }

            return false;
        })();

        try {
            return await this.#loginPromise;
        }
        finally {
            this.#loginPromise = undefined;
        }
    }

    async _refreshSession() {
        if (getContextType() === CONTEXT_BACKGROUND)
            return this._login();
        else {
            const auth = await send.helperAppGetBackgroundAuth({staleToken: this.sessionToken || null});
            this._setBackgroundAuth(auth);
            return !!this.sessionToken;
        }
    }

    // staleToken: a token rejected by the server in a foreground context
    async getBackgroundAuth(staleToken) {
        await settings.load();

        if (this.isServerMode()) {
            if (!this.sessionToken || (staleToken !== undefined && staleToken === this.sessionToken))
                await this._login();

            return {token: this.sessionToken};
        }

        return this.auth;
    }

    _setBackgroundAuth(auth) {
        if (auth && typeof auth === "object")
            this.sessionToken = auth.token;
        else if (auth)
            this.auth = auth;
    }

    // drops the server connection and session after the connection settings are changed
    async reset() {
        await settings.load();

        const port = await this.port;
        this.port = null;
        this.sessionToken = undefined;
        this.version = undefined;

        if (port instanceof WebSocketPort)
            port.disconnect();
    }

    async _onInitialized(msg, port) {
        this.port = port;
        this.version = msg.version;
        port.onMessage.addListener(HelperApp._incomingMessages.bind(this));

        if (msg.error === "address_in_use")
            showNotification(`The backend application HTTP port ${settings.helper_port_number()} is not available.`);
        else
            for (const listener of this.#connectionListeners)
                Promise.resolve()
                    .then(() => listener())
                    .catch(e => console.error(e));
    }

    // the listener is called in the background context when the connection to the backend is (re)established
    addConnectionListener(listener) {
        this.#connectionListeners.push(listener);
    }

    async probe(verbose) {
        if (getContextType() === CONTEXT_BACKGROUND)
            return this._probe(verbose);
        else
            return send.helperAppProbe({verbose});
    }

    async _probe(verbose = false) {
        if (!await hasCSRPermission())
            return false;

        const port = await this.getPort();

        if (!port && verbose) {
            if (this.isServerMode())
                showNotification({message: this.serverConnectionErrorMessage()});
            else
                showNotification({message: "Can not connect to the backend application."})
        }

        return !!port;
    }

    getVersion() {
        if (getContextType() !== CONTEXT_BACKGROUND)
            throw new Error("Can not call this method in the foreground context.");

        if (this.port) {
            if (!this.version)
                return "0.1";
            return this.version;
        }
    }

    async hasVersion(version, msg) {
        if (getContextType() === CONTEXT_BACKGROUND)
            return this._hasVersion(version, msg);
        else
            return send.helperAppHasVersion({version, alert: msg});
    }

    async _hasVersion(version, msg) {
        if (!(await this.probe())) {
            if (msg)
                showNotification(this.isServerMode()? this.serverConnectionErrorMessage(): msg);
            return false;
        }

        // messages refer to the backend application, which is a server in the server mode
        if (msg && this.isServerMode())
            msg = msg.replace(/backend application/g, "server");

        let installed = this.getVersion();

        if (installed) {
            if (installed.startsWith(version))
                return true;

            version = version.split(".").map(d => parseInt(d));
            installed = installed.split(".").map(d => parseInt(d));
            installed.length = version.length;

            for (let i = 0; i < version.length; ++i) {
                if (installed[i] > version[i])
                    return true;
                else if (installed[i] < version[i])
                    break;
            }

            if (msg)
                showNotification(msg);
            return false;
        }
    }

    static async _incomingMessages(msg) {
        const port = await this.getPort();
        msg = JSON.parse(msg);

        const handler = this.#externalEventHandlers[msg.type];

        if (handler) {
            const response = await handler(msg);

            if (response !== undefined)
                port.postMessage(response);
        }
    }

    addMessageHandler(name, handler) {
        this.#externalEventHandlers[name] = handler;
    }

    url(path) {
        if (this.isServerMode())
            return `${this.serverURL()}${path}`;
        else
            return `http://localhost:${settings.helper_port_number()}${path}`;
    }

    // true if the URL points to an archive served by the backend
    isArchiveURL(url) {
        if (!url?.startsWith(this.url("/")))
            return false;

        const path = url.substring(this.url("").length).replace(/^\/s\/[^/]+/, "");
        return path.startsWith("/browse/") || path.startsWith("/rdf/browse/");
    }

    // returns an URL that could be opened in a browser tab, in the server mode such URLs are signed
    async signedURL(path) {
        if (!this.isServerMode())
            return this.url(path);

        const response = await this.fetchJSON_postJSON("/auth/sign_url", {path});

        if (response?.url)
            return this.url(response.url);
        else
            throw new Error("Can not sign the server URL.");
    }

    _injectAuth(init) {
        init = init || {};
        init.headers = init.headers || {};

        if (this.isServerMode())
            init.headers["Authorization"] = "Bearer " + this.sessionToken;
        else
            init.headers["Authorization"] = this.authHeader;

        return init;
    }

    async _handleHTTPError(response) {
        if (response.status === 204 || response.status === 404)
            return null;
        else {
            const errorMessage = `Scrapyard native client error ${response.status} (${response.statusText})\n`;
            console.error(errorMessage, await response.text());
            throw {httpError: {status: response.status, statusText: response.statusText}};
        }
    }

    async fetch(path, init) {
        if (this.isServerMode() && !this.sessionToken)
            await this._refreshSession();

        init = this._injectAuth(init);
        let response = await globalThis.fetch(this.url(path), init);

        // the session may expire or the server may be restarted
        if (response.status === 401 && this.isServerMode() && await this._refreshSession()) {
            init = this._injectAuth(init);
            response = await globalThis.fetch(this.url(path), init);
        }

        return response;
    }

    async post(path, fields) {
        let form = new FormData();

        for (let [k, v] of Object.entries(fields)) {
            if (v instanceof Blob)
                form.append(k, v, k);
            else {
                v = v + "";
                form.append(k, v);
            }
        }

        const init = {method: "POST", body: form};

        return this.fetch(path, init);
    }

    async postJSON(path, fields) {
        const init = {
            method: "POST",
            body: JSON.stringify(fields),
            headers: {"content-type": "application/json"}
        };

        return this.fetch(path, init);
    }

    async fetchText(path, init) {
        let response = await this.fetch(path, init);

        if (response.ok)
            return response.text();
        else
            return this._handleHTTPError(response);
    }

    async fetchJSON(path, init) {
        let response = await this.fetch(path, init);

        if (response.ok)
            return response.json();
        else
            return this._handleHTTPError(response);
    }


    async fetchJSON_postJSON(path, fields) {
        let response = await this.postJSON(path, fields);

        if (response.ok)
            return response.json();
        else
            return this._handleHTTPError(response);
    }
}

export const helperApp = new HelperApp();

if (getContextType() !== CONTEXT_BACKGROUND) {
    send.helperAppGetBackgroundAuth().then(auth => helperApp._setBackgroundAuth(auth));
}
