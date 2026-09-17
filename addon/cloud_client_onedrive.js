import {
    CloudClientBase,
    CloudConflictError,
    CloudError,
    CloudItemNotFoundError,
    CloudRetryableError,
    parseRetryAfter
} from "./cloud_client_base.js";
import {PKCE} from "./lib/PKCE.js";
import {settings} from "./settings.js";

const GRAPH_API_ENDPOINT = "https://graph.microsoft.com/v1.0";

const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 32 * 320 * 1024; // must be a multiple of 320 KiB
const ACCESS_TOKEN_EXPIRATION_MARGIN = 60 * 1000;

// token endpoint errors that mean the refresh token is no longer valid
const INVALID_GRANT_ERRORS = ["invalid_grant", "interaction_required", "unauthorized_client", "invalid_client"];

const NOT_AUTHORIZED_MESSAGE = "OneDrive is not authorized.";

async function toBytes(data) {
    if (typeof data === "string")
        return new TextEncoder().encode(data);
    else if (data instanceof Blob)
        return new Uint8Array(await data.arrayBuffer());
    else if (data instanceof ArrayBuffer)
        return new Uint8Array(data);
    else if (ArrayBuffer.isView(data))
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    throw new CloudError("Unsupported upload data type.");
}

function versionOf(driveItem) {
    return {version: driveItem.eTag, modified: new Date(driveItem.lastModifiedDateTime)};
}

export class OneDriveClient extends CloudClientBase {
    constructor() {
        super()
        this.ID = "onedrive"
        this._pkce = new PKCE({
            client_id: "c4d0a237-f00c-41a4-ac9f-f7aa4d88e857",
            redirect_uri: 'https://gchristensen.github.io/scrapyard',
            authorization_endpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
            token_endpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
            requested_scopes: 'offline_access User.Read Files.ReadWrite Files.ReadWrite.AppFolder',
        });
    }

    isAuthenticated() {
        return !!settings.onedrive_refresh_token();
    }

    _loadRefreshToken() {
        return settings.onedrive_refresh_token();
    }

    _storeRefreshToken(refreshToken) {
        return settings.onedrive_refresh_token(refreshToken);
    }

    _setRefreshToken(refreshToken) {
        this._refreshToken = refreshToken;
        this._accessToken = null;
    }

    _resetCredentials() {
        this._refreshToken = null;
        this._accessToken = null;
    }

    _getAuthorizationUrl() {
        return this._pkce.getAuthorizationUrl();
    }

    async _applyTokens(response) {
        if (response.access_token) {
            this._accessToken = response.access_token;
            this._accessTokenExpires = Date.now() + response.expires_in * 1000;

            // the refresh token is not necessarily rotated
            if (response.refresh_token && response.refresh_token !== this._refreshToken) {
                this._refreshToken = response.refresh_token;
                await this._storeRefreshToken(this._refreshToken);
            }
        }
        else if (INVALID_GRANT_ERRORS.includes(response.error)) {
            console.error(response);
            this._resetCredentials();
            await this._storeRefreshToken(null);
            throw new CloudError(NOT_AUTHORIZED_MESSAGE);
        }
        else
            throw new CloudRetryableError(`OneDrive authorization error: ${response.error || "unknown"}`);
    }

    async _obtainRefreshToken(url) {
        const response = await this._pkce.exchangeForAccessToken(url);

        if (!response.refresh_token)
            throw new CloudError(`OneDrive authorization error: ${response.error || "no refresh token"}`);

        this._refreshToken = null;
        await this._applyTokens(response);
        await this._notifyAuthenticated(this._refreshToken);
    }

    async _getAccessToken() {
        if (this._accessToken && this._accessTokenExpires - ACCESS_TOKEN_EXPIRATION_MARGIN > Date.now())
            return this._accessToken;

        if (!this._refreshToken)
            throw new CloudError(NOT_AUTHORIZED_MESSAGE);

        // simultaneous requests share a single refresh
        if (!this._refreshPromise)
            this._refreshPromise = this._pkce.refreshAccessToken(this._refreshToken)
                .then(response => this._applyTokens(response))
                .finally(() => this._refreshPromise = null);

        await this._refreshPromise;

        if (!this._accessToken)
            throw new CloudError(NOT_AUTHORIZED_MESSAGE);

        return this._accessToken;
    }

    _translateError(e) {
        if (e instanceof CloudError)
            return e;
        else if (e instanceof SyntaxError) // a non-JSON response of the token endpoint
            return new CloudRetryableError(`OneDrive request failed: ${e.message}`, undefined, e);

        return super._translateError(e);
    }

    async _responseError(response) {
        let body;
        try {
            body = await response.json();
        } catch (e) {}

        const status = response.status;
        const code = body?.error?.code;
        const message = `OneDrive request failed: ${body?.error?.message || code || status}`;

        if (status === 404 || code === "itemNotFound")
            return new CloudItemNotFoundError(message);
        else if (status === 409 || status === 412)
            return new CloudConflictError(message);
        else if (status === 401) {
            this._accessToken = null;
            return new CloudRetryableError(message, 0);
        }
        else if (status === 429 || status === 408 || status >= 500)
            return new CloudRetryableError(message, parseRetryAfter(response.headers.get("Retry-After")));

        return new CloudError(message);
    }

    // the response body is read inside the retry loop, so an interrupted download is repeated
    async _fetch(url, params = {}, read = response => response, authorize = true) {
        return this._withRetry(async () => {
            const headers = {...params.headers};

            if (authorize)
                headers["Authorization"] = `Bearer ${await this._getAccessToken()}`;

            const response = await fetch(url, {...params, headers});

            if (!response.ok)
                throw await this._responseError(response);

            return read(response);
        });
    }

    _makeRequest(path, params, read) {
        return this._fetch(`${GRAPH_API_ENDPOINT}${path}`, params, read);
    }

    _makeJSONRequest(path, params) {
        return this._makeRequest(path, params, response => response.json());
    }

    _getDrivePath(path) {
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        return `/me/drive/special/approot:${encodedPath}`;
    }

    // conflictBehavior: replace, fail, rename; eTag: replace only if the item has not been modified
    async _upload(requestPath, data, conflictBehavior = "replace", eTag) {
        const bytes = await toBytes(data);
        const conditionHeaders = eTag? {"If-Match": eTag}: {};

        if (bytes.byteLength <= SIMPLE_UPLOAD_LIMIT) {
            const url = `${requestPath}:/content?@microsoft.graph.conflictBehavior=${conflictBehavior}`;
            const headers = {"Content-Type": "application/octet-stream", ...conditionHeaders};
            const driveItem = await this._makeJSONRequest(url, {method: "PUT", body: bytes, headers});

            return versionOf(driveItem);
        }
        else
            return this._uploadLargeFile(requestPath, bytes, conflictBehavior, conditionHeaders);
    }

    async _uploadLargeFile(requestPath, bytes, conflictBehavior, conditionHeaders) {
        const session = await this._makeJSONRequest(requestPath + ":/createUploadSession", {
            method: "POST",
            body: JSON.stringify({item: {"@microsoft.graph.conflictBehavior": conflictBehavior}}),
            headers: {"Content-Type": "application/json", ...conditionHeaders}
        });

        try {
            let driveItem;

            for (let start = 0; start < bytes.byteLength; start += UPLOAD_CHUNK_SIZE) {
                const end = Math.min(start + UPLOAD_CHUNK_SIZE, bytes.byteLength);
                const chunk = bytes.subarray(start, end);
                driveItem = await this._sendSessionBytes(session.uploadUrl, chunk, start, end - 1, bytes.byteLength);
            }

            if (!driveItem?.eTag)
                throw new CloudError("OneDrive upload session is not completed.");

            return versionOf(driveItem);
        }
        catch (e) {
            fetch(session.uploadUrl, {method: "DELETE"}).catch(() => {});
            throw e;
        }
    }

    // the upload URL is pre-authorized and must not receive the Authorization header
    _sendSessionBytes(url, bytes, start, end, size) {
        const headers = {"Content-Range": `bytes ${start}-${end}/${size}`};

        // returns the drive item when the upload is completed
        return this._fetch(url, {method: "PUT", body: bytes, headers},
            response => response.status === 202? null: response.json(), false);
    }

    uploadFile(path, data) {
        return this._upload(this._getDrivePath(path), data);
    }

    // without a version the file is created only if it does not exist
    uploadFileVersioned(path, data, version) {
        const requestPath = this._getDrivePath(path);

        if (version)
            return this._upload(requestPath, data, "replace", version);
        else
            return this._upload(requestPath, data, "fail");
    }

    downloadFile(path, binary) {
        const requestPath = this._getDrivePath(path) + ":/content";
        return this._makeRequest(requestPath, undefined, response => binary? response.arrayBuffer(): response.text());
    }

    async downloadFileVersioned(path) {
        // the item metadata is obtained first, so the content is not older than the version
        const driveItem = await this._makeJSONRequest(this._getDrivePath(path));
        const downloadUrl = driveItem["@microsoft.graph.downloadUrl"];

        let content;
        if (downloadUrl)
            content = await this._fetch(downloadUrl, undefined, response => response.text(), false);
        else
            content = await this.downloadFile(path);

        return {content, ...versionOf(driveItem)};
    }

    async deleteFile(path) {
        await this._makeRequest(this._getDrivePath(path), {method: "DELETE"});
    }

    async share(path, filename, content) {
        if (!await this.authenticate())
            throw new CloudError(NOT_AUTHORIZED_MESSAGE);

        if (path === "/")
            path = "";

        filename = this._replaceSpecialChars(filename);
        const requestPath = this._getDrivePath(`${path}/${filename}`);
        return this._upload(requestPath, content, "rename");
    };

    async reset() {
        try {
            await this.deleteFile(CloudClientBase.CLOUD_SHELF_PATH);
        }
        catch (e) {
            if (!(e instanceof CloudItemNotFoundError))
                throw e;
        }
    }

    // returns null if the index does not exist
    async getLastModified() {
        try {
            const driveItem = await this._makeJSONRequest(this._getDrivePath(this._getIndexPath()));
            return new Date(driveItem.lastModifiedDateTime);
        }
        catch (e) {
            if (!(e instanceof CloudItemNotFoundError))
                throw e;
        }

        return null;
    }
}

export let oneDriveClient = new OneDriveClient();
