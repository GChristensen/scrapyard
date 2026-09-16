import UUID from "./uuid.js";
import {settings} from "./settings.js";
import {CONTEXT_BACKGROUND, getContextType, hasCSRPermission, showNotification} from "./utils_browser.js";
import {send} from "./proxy.js"
import {WebSocketPort, WS_CLOSE_POLICY_VIOLATION} from "./helper_app_ws.js";

export const HELPER_APP_v2_IS_REQUIRED = "Scrapyard backend application v2.0+ is required.";
export const HELPER_APP_v2_1_IS_REQUIRED = "Scrapyard backend application v2.1+ is required.";

// the value passed as data_path in the server mode, the server uses its own data path
export const SERVER_DATA_PATH = "@server";

// delays of attempts to reconnect to a server after the connection is lost
const SERVER_RECONNECT_MIN_DELAY = 5000;
const SERVER_RECONNECT_MAX_DELAY = 60000;
// the delay of reconnection after the server has rejected an expired session token
const SERVER_RECONNECT_QUICK_DELAY = 500;

// a server that is unreachable (e.g., a VPN is down) may not respond at all, so all operations that wait for
// the connection are bounded by these timeouts
const SERVER_LOGIN_TIMEOUT = 15000;
const SERVER_CONNECT_TIMEOUT = 15000;
const SERVER_CONTROL_REQUEST_TIMEOUT = 30000;

export class HTTPError extends Error {
    constructor(response, details) {
        super(httpErrorMessage(response) + (details? `: ${details}`: "."));
        this.name = "HTTPError";
        this.httpError = {status: response.status, statusText: response.statusText};
    }
}

// true if a failed request may succeed later (connection errors, server errors, rate limiting, etc.),
// false if it is rejected by the backend (e.g., the request body is too large for a reverse proxy)
export function isTransientError(error) {
    if (!(error instanceof HTTPError))
        return true;

    const status = error.httpError.status;
    return status >= 500 || [401, 408, 409, 425, 429].includes(status);
}

export function httpErrorMessage(response) {
    const source = helperApp.isServerMode()? "Server": "Backend";
    const statusText = response.statusText? ` (${response.statusText})`: "";
    return `${source} error ${response.status}${statusText}`;
}

class HelperApp {
    #auth;
    #externalEventHandlers = {};
    #connectionListeners = [];
    #serverConnected;
    #reconnectTimeout;
    #reconnectDelay = SERVER_RECONNECT_MIN_DELAY;
    #loginPromise;
    // the server key is rejected, automatic reconnection is suspended until the settings are changed
    // or the connection is requested by the user, so a stale key does not trigger the brute-force protection
    #authRejected = false;
    // the server has temporarily blocked authentication attempts
    #authBlockedUntil = 0;

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
                let initialized = false;
                let initTimeout;

                const fail = port => {
                    clearTimeout(initTimeout);
                    resolve(null);

                    if (isCurrent(port)) {
                        this.port = null;

                        if (port instanceof WebSocketPort && !initialized)
                            this._onServerConnectionFailure(port);

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

                    initTimeout = setTimeout(() => {
                        if (!initialized) {
                            this.serverError = "The server has not responded in time.";
                            port.disconnect();
                        }
                    }, SERVER_CONNECT_TIMEOUT);
                }
                else
                    port = browser.runtime.connectNative("scrapyard_helper");

                port.onDisconnect.addListener(error => fail(port));

                let initListener = async response => {
                    response = JSON.parse(response);
                    if (response.type === "INITIALIZED") {
                        initialized = true;
                        clearTimeout(initTimeout);
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

    // explains why a WebSocket connection has been closed before initialization
    _onServerConnectionFailure(port) {
        if (port.closeCode === WS_CLOSE_POLICY_VIOLATION) {
            if (port.closeReason === "Unauthorized") {
                // the session has expired or the server has been restarted, a new session is obtained
                this.sessionToken = undefined;
                this.serverError = "The server session has expired.";
                this.#reconnectDelay = SERVER_RECONNECT_QUICK_DELAY;
            }
            else
                this.serverError = `The server has closed the connection: ${port.closeReason || "unknown reason"}.`;
        }
        else if (!port.opened && !this.serverError)
            this.serverError = "Can not establish a WebSocket connection. "
                + "Make sure that the reverse proxy (if any) supports WebSockets.";
    }

    // tracks the state of the connection to a server, notifies the UI, and reconnects after the connection is lost,
    // so the UI indication is cleared and pending restores of the internal storage are performed
    _setServerConnected(connected) {
        if (!this.isServerMode())
            return;

        clearTimeout(this.#reconnectTimeout);

        if (connected)
            this.#reconnectDelay = SERVER_RECONNECT_MIN_DELAY;
        else if (!this.#authRejected) {
            const delay = Math.max(this.#reconnectDelay, this.#authBlockedUntil - Date.now());
            this.#reconnectTimeout = setTimeout(() => this._reconnect(), delay);
            this.#reconnectDelay = Math.max(SERVER_RECONNECT_MIN_DELAY,
                Math.min(this.#reconnectDelay * 2, SERVER_RECONNECT_MAX_DELAY));
        }

        if (this.#serverConnected !== connected) {
            this.#serverConnected = connected;
            send.serverConnectionChanged({connected}).catch(() => {}); // no open pages are listening
        }
    }

    async _reconnect() {
        await settings.load();

        if (this.isServerMode() && !this.port) {
            if (await hasCSRPermission())
                await this.probe();
            else
                this._setServerConnected(false);
        }
    }

    serverConnectionErrorMessage(details = this.serverError) {
        return ("Can not connect to the Scrapyard server. " + (details || "")).trim();
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

        // The background reuses its session, so the tokens obtained by foreground contexts remain bound to
        // the connection; if the session has expired, the server closes the connection and a new session is obtained.
        // A port opened in a foreground context (e.g., an export in MV3) uses a separate session, because a session
        // has only one connection, and the connection of the background should not be replaced.
        const reuseSession = getContextType() === CONTEXT_BACKGROUND && this.sessionToken;

        if (!reuseSession && !await this._login())
            return null;

        const url = this.serverURL().replace(/^http/i, "ws") + "/ws";

        try {
            this.serverError = undefined;
            return new WebSocketPort(url);
        }
        catch (e) {
            console.error(e);
            this.serverError = "Can not connect to the server: " + e.message;
        }
    }

    // exchanges the server key for a session token
    async _login() {
        if (this.#loginPromise)
            return this.#loginPromise;

        if (this.#authRejected) {
            this.serverError = "The server key is invalid.";
            return false;
        }

        if (Date.now() < this.#authBlockedUntil) {
            this.serverError = "Too many failed authentication attempts, please try again later.";
            return false;
        }

        this.#loginPromise = (async () => {
            this.sessionToken = undefined;

            try {
                const response = await this._fetchWithTimeout(this.serverURL() + "/auth/session", {
                    method: "POST",
                    headers: {"Authorization": "Bearer " + (settings.backend_server_key() || "")},
                    timeout: SERVER_LOGIN_TIMEOUT
                });

                if (response.ok) {
                    const session = await response.json();
                    this.sessionToken = session.token;
                    this.serverError = undefined;
                    return true;
                }
                else if (response.status === 401) {
                    this.#authRejected = true;
                    this.serverError = "The server key is invalid.";
                }
                else if (response.status === 429) {
                    const retryAfter = parseInt(response.headers.get("Retry-After")) || 60;
                    this.#authBlockedUntil = Date.now() + retryAfter * 1000;
                    this.serverError = "Too many failed authentication attempts, please try again later.";
                }
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

            return {token: this.sessionToken, error: this.serverError};
        }

        return this.auth;
    }

    _setBackgroundAuth(auth) {
        if (auth && typeof auth === "object") {
            this.sessionToken = auth.token;
            this.serverError = auth.error;
        }
        else if (auth)
            this.auth = auth;
    }

    // drops the server connection and session after the connection settings are changed
    async reset() {
        await settings.load();

        const port = await this.port;
        this.port = null;
        this.sessionToken = undefined;
        this.serverError = undefined;
        this.version = undefined;
        this.#authRejected = false;
        this.#reconnectDelay = SERVER_RECONNECT_MIN_DELAY;
        clearTimeout(this.#reconnectTimeout);

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

    // verbose probes are requested by the user and retry the authentication even if the key has been rejected
    async probe(verbose) {
        if (getContextType() === CONTEXT_BACKGROUND)
            return this._probe(verbose);
        else
            return send.helperAppProbe({verbose});
    }

    async _probe(verbose = false) {
        if (!await hasCSRPermission())
            return false;

        if (verbose && !this.port)
            this.#authRejected = false;

        const port = await this.getPort();

        if (!port && verbose) {
            if (this.isServerMode())
                showNotification({message: this.serverConnectionErrorMessage()});
            else
                showNotification({message: "Can not connect to the backend application."})
        }

        return !!port;
    }

    getServerError() {
        return this.serverError;
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
        try {
            msg = JSON.parse(msg);

            const handler = this.#externalEventHandlers[msg.type];

            if (handler) {
                const response = await handler(msg);

                if (response !== undefined) {
                    // the id allows the backend to match the response to the request
                    if (msg.id !== undefined && response && typeof response === "object")
                        response.id = msg.id;

                    const port = await this.getPort();
                    port?.postMessage(response);
                }
            }
        }
        catch (e) {
            console.error(e);
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

        let response;

        try {
            response = await this.fetchJSON_postJSON("/auth/sign_url", {path}, {timeout: SERVER_CONTROL_REQUEST_TIMEOUT});
        }
        catch (e) {
            console.error(e);

            if (e instanceof HTTPError)
                throw new Error(`Can not sign the server URL. ${e.message}`);
            else
                throw new Error(this.serverConnectionErrorMessage(e.message));
        }

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

    // creates an error that includes a short plain text description returned by the backend, if any
    async errorFromResponse(response) {
        let details;

        try {
            const text = (await response.text()).trim();

            if (text && text.length <= 300 && !text.startsWith("<"))
                details = text;
        }
        catch (e) {
            console.error(e);
        }

        return new HTTPError(response, details);
    }

    async _handleHTTPError(response) {
        if (response.status === 204 || response.status === 404)
            return null;
        else {
            const error = await this.errorFromResponse(response);
            console.error(error);
            throw error;
        }
    }

    async _parseJSON(response) {
        const text = await response.text();

        try {
            return JSON.parse(text);
        }
        catch (e) {
            console.error(e, text.substring(0, 300));
            throw new Error("Invalid response from the " + (this.isServerMode()? "server": "backend application")
                + ". Make sure that the server URL and the reverse proxy (if any) are configured correctly.");
        }
    }

    // init.timeout: an optional request timeout in milliseconds (the response body is not covered)
    async _fetchWithTimeout(url, init) {
        if (!init?.timeout || init.signal)
            return globalThis.fetch(url, init);

        const {timeout, ...rest} = init;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            return await globalThis.fetch(url, {...rest, signal: controller.signal});
        }
        catch (e) {
            if (e.name === "AbortError")
                throw new Error("The " + (this.isServerMode()? "server": "backend application") + " has not responded in time.");
            throw e;
        }
        finally {
            clearTimeout(timer);
        }
    }

    async fetch(path, init) {
        let sessionRefreshed = false;

        if (this.isServerMode() && !this.sessionToken) {
            sessionRefreshed = true;

            if (!await this._refreshSession())
                throw new Error(this.serverConnectionErrorMessage());
        }

        init = this._injectAuth(init);
        let response = await this._fetchWithTimeout(this.url(path), init);

        // the session may expire or the server may be restarted,
        // a session obtained just now is not refreshed again, so an invalid key costs only one authentication attempt
        if (response.status === 401 && this.isServerMode() && !sessionRefreshed) {
            if (await this._refreshSession()) {
                init = this._injectAuth(init);
                response = await this._fetchWithTimeout(this.url(path), init);
            }
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

    async postJSON(path, fields, init) {
        init = {
            ...init,
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
            return this._parseJSON(response);
        else
            return this._handleHTTPError(response);
    }


    async fetchJSON_postJSON(path, fields, init) {
        let response = await this.postJSON(path, fields, init);

        if (response.ok)
            return this._parseJSON(response);
        else
            return this._handleHTTPError(response);
    }
}

// Streams content produced by the given function and finishes the stream, or aborts it on error,
// so the backend discards incomplete content. Returns the error of the operation, if any.
export async function streamContent(port, stream, messagePrefix, produce) {
    let error;

    try {
        await produce();
    }
    catch (e) {
        console.error(e);
        error = e;
    }

    try {
        if (error)
            port.postMessage({type: `${messagePrefix}_ABORT`, stream});

        // older backends do not support aborting
        port.postMessage({type: `${messagePrefix}_FINISH`, stream});
    }
    catch (e) {
        console.error(e);
        error = error || e;
    }

    return error;
}

// waits for the HTTP request that receives the streamed content and reports the first error
export async function completeStreamRequest(request, streamError) {
    let response, requestError;

    try {
        response = await request;

        if (!response.ok)
            requestError = await helperApp.errorFromResponse(response);
    }
    catch (e) {
        requestError = e;
    }

    const error = streamError || requestError;

    if (error)
        throw error;

    return response;
}

export const helperApp = new HelperApp();

if (getContextType() !== CONTEXT_BACKGROUND) {
    send.helperAppGetBackgroundAuth()
        .then(auth => helperApp._setBackgroundAuth(auth))
        .catch(e => console.error(e));
}
