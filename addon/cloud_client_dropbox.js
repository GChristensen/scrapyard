import {settings} from "./settings.js";
import DropboxAuth from "./lib/dropbox/auth.js";
import Dropbox from "./lib/dropbox/dropbox.js"
import {chunk, sleep} from "./utils.js";
import {
    CloudClientBase,
    CloudConflictError,
    CloudError,
    CloudItemNotFoundError,
    CloudRetryableError,
    parseRetryAfter
} from "./cloud_client_base.js";

const APP_KEY = "0y7co3j1k4oc7up";

// Dropbox does not accept uploads larger than 150 MiB in a single request
const SIMPLE_UPLOAD_LIMIT = 64 * 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024;
const DELETE_BATCH_SIZE = 1000;
const JOB_POLL_INTERVAL = 1000;

const NOT_AUTHORIZED_MESSAGE = "Dropbox is not authorized.";

export class DropboxClient extends CloudClientBase {
    constructor() {
        super()
        this.ID = "dropbox";
        this.dbxAuth = new DropboxAuth({clientId: APP_KEY});
        this.dbx = new Dropbox({auth: this.dbxAuth});
    }

    isAuthenticated() {
        return !!settings.dropbox_refresh_token();
    }

    _loadRefreshToken() {
        return settings.dropbox_refresh_token();
    }

    _storeRefreshToken(refreshToken) {
        return settings.dropbox_refresh_token(refreshToken);
    }

    _setRefreshToken(refreshToken) {
        this.dbxAuth.setRefreshToken(refreshToken);
        this.dbxAuth.setAccessToken(undefined);
        this.dbxAuth.setAccessTokenExpiresAt(undefined);
    }

    _resetCredentials() {
        this._setRefreshToken(undefined);
    }

    _getAuthorizationUrl() {
        return this.dbxAuth.getAuthenticationUrl(CloudClientBase.REDIRECT_URL, undefined,
            'code', 'offline', undefined, undefined, true);
    }

    async _obtainRefreshToken(url) {
        const code = new URL(url).searchParams.get("code");
        let response = await this.dbxAuth.getAccessTokenFromCode(CloudClientBase.REDIRECT_URL, code);
        const refreshToken = response.result.refresh_token;
        this.dbxAuth.setRefreshToken(refreshToken);

        await this._storeRefreshToken(refreshToken);
        await this._notifyAuthenticated(refreshToken);

        if (settings.dropbox___dbat())
            settings.dropbox___dbat(null);
    }

    _translateError(e) {
        if (e instanceof CloudError)
            return e;

        const status = e?.status;

        if (!status)
            return super._translateError(e);

        const summary = e.error?.error_summary || (typeof e.error === "string"? e.error: "");

        if (status === 409) {
            if (summary.includes("not_found"))
                return new CloudItemNotFoundError(summary, e);
            if (summary.includes("conflict"))
                return new CloudConflictError(summary, e);
        }
        else if (status === 401) {
            if (summary.startsWith("expired_access_token")) {
                this.dbxAuth.setAccessToken(undefined);
                return new CloudRetryableError(summary, 0, e);
            }
            return new CloudError(NOT_AUTHORIZED_MESSAGE, e);
        }
        else if (status === 400 && /invalid_grant/.test(JSON.stringify(e.error)))
            return new CloudError(NOT_AUTHORIZED_MESSAGE, e);
        else if (status === 429 || status === 408 || status >= 500) {
            const retryAfter = e.error?.error?.retry_after !== undefined
                ? e.error.error.retry_after * 1000
                : parseRetryAfter(e.headers?.get?.("Retry-After"));

            return new CloudRetryableError(`Dropbox request failed: ${summary || status}`, retryAfter, e);
        }

        return new CloudError(`Dropbox request failed: ${summary || status}`, e);
    }

    // the SDK modifies the arguments, so they are copied on each attempt
    _request(method, args) {
        if (!this.dbxAuth.getRefreshToken())
            return Promise.reject(new CloudError(NOT_AUTHORIZED_MESSAGE));

        return this._withRetry(() => this.dbx[method]({...args}));
    }

    async downloadFile(path, binary) {
        const {result: {fileBlob}} = await this._request("filesDownload", {path});
        return binary? fileBlob.arrayBuffer(): fileBlob.text();
    }

    async downloadFileVersioned(path) {
        const {result} = await this._request("filesDownload", {path});

        return {
            content: await result.fileBlob.text(),
            version: result.rev,
            modified: new Date(result.server_modified)
        };
    }

    uploadFile(path, data) {
        return this._upload(path, data, {mode: "overwrite", mute: true});
    }

    // without a version the file is created only if it does not exist
    uploadFileVersioned(path, data, version) {
        const mode = version? {".tag": "update", update: version}: "add";
        return this._upload(path, data, {mode, mute: true, autorename: false, strict_conflict: true});
    }

    async _upload(path, data, options) {
        const blob = data instanceof Blob? data: new Blob([data]);
        let result;

        if (blob.size <= SIMPLE_UPLOAD_LIMIT)
            ({result} = await this._request("filesUpload", {path, contents: blob, ...options}));
        else
            result = await this._uploadSession(path, blob, options);

        return {version: result.rev, modified: new Date(result.server_modified)};
    }

    async _uploadSession(path, blob, options) {
        const firstChunk = blob.slice(0, UPLOAD_CHUNK_SIZE);
        const {result: {session_id}} =
            await this._request("filesUploadSessionStart", {contents: firstChunk, close: false});

        let offset = firstChunk.size;

        while (blob.size - offset > UPLOAD_CHUNK_SIZE) {
            const contents = blob.slice(offset, offset + UPLOAD_CHUNK_SIZE);
            await this._request("filesUploadSessionAppendV2", {cursor: {session_id, offset}, close: false, contents});
            offset += contents.size;
        }

        const {result} = await this._request("filesUploadSessionFinish", {
            cursor: {session_id, offset},
            commit: {path, ...options},
            contents: blob.slice(offset)
        });

        return result;
    }

    async deleteFile(path) {
        await this._request("filesDeleteV2", {path});
    }

    async deleteAssets(uuids) {
        for (const uuidChunk of chunk(uuids, DELETE_BATCH_SIZE)) {
            try {
                const entries = uuidChunk.map(uuid => ({path: this._getObjectDirectory(uuid)}));
                let {result} = await this._request("filesDeleteBatch", {entries});
                const async_job_id = result.async_job_id;

                while (result[".tag"] === "async_job_id" || result[".tag"] === "in_progress") {
                    await sleep(JOB_POLL_INTERVAL);
                    ({result} = await this._request("filesDeleteBatchCheck", {async_job_id}));
                }

                // failures of individual entries (e.g., not found) are ignored
                if (result[".tag"] === "failed")
                    console.error("Dropbox batch deletion failed", result);
            }
            catch (e) {
                console.error(e);
            }
        }
    }

    async share(path, filename, content) {
        if (!await this.authenticate())
            throw new CloudError(NOT_AUTHORIZED_MESSAGE);

        return this._upload(path + this._replaceSpecialChars(filename), content, {
            mode: "add",
            autorename: true,
            mute: false,
            strict_conflict: false
        });
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
            const {result: meta} = await this._request("filesGetMetadata", {path: this._getIndexPath()});

            if (meta?.server_modified)
                return new Date(meta.server_modified);
        }
        catch (e) {
            if (!(e instanceof CloudItemNotFoundError))
                throw e;
        }

        return null;
    }
}

export let dropboxClient = new DropboxClient();
