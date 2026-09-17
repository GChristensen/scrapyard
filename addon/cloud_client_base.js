import {CloudStorage} from "./cloud_node_db.js";
import {send} from "./proxy.js";
import {sleep} from "./utils.js";

const OBJECT_DIRECTORY = "objects";
const NODE_OBJECT_FILE = "item.json";
const ICON_OBJECT_FILE = "icon.json";
const ARCHIVE_INDEX_OBJECT_FILE = "archive_index.json";
const ARCHIVE_OBJECT_FILE = "archive.json";
const ARCHIVE_CONTENT_FILE = "archive_content.blob";
const NOTES_INDEX_OBJECT_FILE = "notes_index.json";
const NOTES_OBJECT_FILE = "notes.json";
const COMMENTS_INDEX_OBJECT_FILE = "comments_index.json";
const COMMENTS_OBJECT_FILE = "comments.json";

const MAX_RETRIES = 4;
const MAX_RETRY_DELAY = 60 * 1000;

// the number of simultaneous requests to a cloud provider
export const CLOUD_CONCURRENCY = 4;

export class CloudError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = "CloudError";

        if (cause)
            this.cause = cause;
    }
}

export class CloudItemNotFoundError extends CloudError {
    constructor(message, cause) {
        super(message || "Cloud item not found.", cause);
        this.name = "CloudItemNotFoundError";
    }
}

// a conditional write has been rejected because the item was modified by someone else
export class CloudConflictError extends CloudError {
    constructor(message, cause) {
        super(message || "Cloud item was modified concurrently.", cause);
        this.name = "CloudConflictError";
    }
}

// a transient error, the request may succeed if repeated; retryAfter is in milliseconds
export class CloudRetryableError extends CloudError {
    constructor(message, retryAfter, cause) {
        super(message, cause);
        this.name = "CloudRetryableError";
        this.retryAfter = retryAfter;
    }
}

export function parseRetryAfter(value) {
    if (value === undefined || value === null || value === "")
        return undefined;

    const seconds = Number(value);
    if (!isNaN(seconds))
        return seconds * 1000;

    const date = Date.parse(value);
    if (!isNaN(date))
        return Math.max(0, date - Date.now());
}

function retryDelay(attempt, retryAfter) {
    if (retryAfter !== undefined)
        return Math.min(retryAfter, MAX_RETRY_DELAY);

    return Math.min(1000 * 2 ** attempt + Math.random() * 500, MAX_RETRY_DELAY);
}

function isNetworkError(e) {
    return e instanceof TypeError && /fetch|network/i.test(e.message);
}

// applies an async function to the items with a limited number of simultaneous calls,
// all calls are completed before the first error is rethrown
export async function mapConcurrently(items, limit, f) {
    const results = new Array(items.length);
    let error, next = 0;

    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            try {
                results[i] = await f(items[i], i);
            }
            catch (e) {
                error = error || e;
            }
        }
    };

    await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));

    if (error)
        throw error;

    return results;
}

export class CloudClientBase {
    static CLOUD_SHELF_PATH = "/Cloud";
    static CLOUD_SHELF_INDEX = "cloud.jsbk";
    static REDIRECT_URL = "https://gchristensen.github.io/scrapyard/";

    // called with the modification times of the cloud index before and after it is persisted
    onIndexPersisted;

    constructor() {
        this._assetMethods = this._createAssetMethods();
    }

    get assets() {
        return this._assetMethods;
    }

    initialize() {
        const refreshToken = this._loadRefreshToken();

        if (refreshToken)
            this._setRefreshToken(refreshToken);

        // credentials are obtained or discarded in the options page, other contexts are notified
        browser.runtime.onMessage.addListener(request => {
            if (request.type === `${this.ID}Authenticated`)
                this._setRefreshToken(request.refreshToken);
            else if (request.type === "cloudSignedOut" && request.provider === this.ID)
                this._resetCredentials();
        });
    }

    async signOut() {
        this._resetCredentials();
        await this._storeRefreshToken(null);

        try {
            await send.cloudSignedOut({provider: this.ID});
        } catch (e) {
            console.error(e);
        }
    }

    async _notifyAuthenticated(refreshToken) {
        try {
            await send[`${this.ID}Authenticated`]({refreshToken});
        } catch (e) {
            console.error(e);
        }
    }

    async authenticate() {
        if (this.isAuthenticated())
            return true;

        let authTabId;
        let removeListeners;

        const redirectURL = new Promise(resolve => {
            const finish = url => {
                removeListeners();
                resolve(url);
            };

            const onUpdated = (id, changed) => {
                if (id === authTabId && changed.url?.startsWith(CloudClientBase.REDIRECT_URL)) {
                    finish(changed.url);
                    browser.tabs.remove(id).catch(e => console.error(e));
                }
            };

            // the user has closed the authorization tab
            const onRemoved = id => {
                if (id === authTabId)
                    finish(null);
            };

            removeListeners = () => {
                browser.tabs.onUpdated.removeListener(onUpdated);
                browser.tabs.onRemoved.removeListener(onRemoved);
            };

            browser.tabs.onUpdated.addListener(onUpdated);
            browser.tabs.onRemoved.addListener(onRemoved);
        });

        try {
            const authTab = await browser.tabs.create({url: await this._getAuthorizationUrl()});
            authTabId = authTab.id;
        } catch (e) {
            removeListeners();
            console.error(e);
            return false;
        }

        const url = await redirectURL;

        if (!url || !new URL(url).searchParams.get("code"))
            return false;

        try {
            await this._obtainRefreshToken(url);
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    // repeats the action on transient errors, translates provider-specific errors to CloudError
    async _withRetry(action) {
        for (let attempt = 0; ; ++attempt) {
            try {
                return await action();
            }
            catch (e) {
                const error = this._translateError(e);

                if (!(error instanceof CloudRetryableError) || attempt >= MAX_RETRIES)
                    throw error;

                await sleep(retryDelay(attempt, error.retryAfter));
            }
        }
    }

    _translateError(e) {
        if (isNetworkError(e))
            return new CloudRetryableError(`Can not connect to the cloud: ${e.message}`, undefined, e);

        return e;
    }

    _getIndexPath() {
        return `${CloudClientBase.CLOUD_SHELF_PATH}/${CloudClientBase.CLOUD_SHELF_INDEX}`;
    }

    _getObjectDirectory(uuid) {
        return `${CloudClientBase.CLOUD_SHELF_PATH}/${OBJECT_DIRECTORY}/${uuid}`;
    }

    _getAssetPath(uuid, asset) {
        return `${CloudClientBase.CLOUD_SHELF_PATH}/${OBJECT_DIRECTORY}/${uuid}/${asset}`;
    }

    // returns undefined if the file does not exist
    async _downloadOptionalFile(path, binary) {
        try {
            return await this.downloadFile(path, binary);
        }
        catch (e) {
            if (e instanceof CloudItemNotFoundError)
                return undefined;
            throw e;
        }
    }

    _createAssetMethods() {
        const storeAsset = asset => (uuid, data) => this.uploadFile(this._getAssetPath(uuid, asset), data);

        const fetchAsset = (asset, binary) =>
            uuid => this._downloadOptionalFile(this._getAssetPath(uuid, asset), binary);

        let methods = {};

        methods.storeNode = storeAsset(NODE_OBJECT_FILE);

        methods.storeNotes = storeAsset(NOTES_OBJECT_FILE);
        methods.fetchNotes = fetchAsset(NOTES_OBJECT_FILE);
        methods.storeNotesIndex = storeAsset(NOTES_INDEX_OBJECT_FILE);
        methods.fetchNotesIndex = fetchAsset(NOTES_INDEX_OBJECT_FILE);

        methods.storeArchiveObject = storeAsset(ARCHIVE_OBJECT_FILE);
        methods.fetchArchiveObject = fetchAsset(ARCHIVE_OBJECT_FILE);
        methods.storeArchiveContent = storeAsset(ARCHIVE_CONTENT_FILE);
        methods.fetchArchiveContent = fetchAsset(ARCHIVE_CONTENT_FILE, true);
        methods.storeArchiveFile = (uuid, data, file) => this.uploadFile(this._getAssetPath(uuid, file), data);
        methods.fetchArchiveFile = (uuid, file) => this._downloadOptionalFile(this._getAssetPath(uuid, file), true);
        methods.storeArchiveIndex = storeAsset(ARCHIVE_INDEX_OBJECT_FILE);
        methods.fetchArchiveIndex = fetchAsset(ARCHIVE_INDEX_OBJECT_FILE);

        methods.storeIcon = storeAsset(ICON_OBJECT_FILE);
        methods.fetchIcon = fetchAsset(ICON_OBJECT_FILE);

        methods.storeComments = storeAsset(COMMENTS_OBJECT_FILE);
        methods.fetchComments = fetchAsset(COMMENTS_OBJECT_FILE);
        methods.storeCommentsIndex = storeAsset(COMMENTS_INDEX_OBJECT_FILE);
        methods.fetchCommentsIndex = fetchAsset(COMMENTS_INDEX_OBJECT_FILE);

        return methods;
    }

    // a failure leaves only orphaned files in the cloud, so it is not propagated
    async deleteAssets(uuids) {
        await mapConcurrently(uuids, CLOUD_CONCURRENCY, async uuid => {
            try {
                await this.deleteFile(this._getObjectDirectory(uuid));
            } catch (e) {
                if (!(e instanceof CloudItemNotFoundError))
                    console.error(e);
            }
        });
    }

    async downloadDB() {
        let storage;

        try {
            const {content, version, modified} = await this.downloadFileVersioned(this._getIndexPath());

            try {
                storage = CloudStorage.deserialize(content);
            } catch (e) {
                throw new CloudError("The cloud index is corrupted.", e);
            }

            storage.version = version;
            storage.lastModified = modified;
        }
        catch (e) {
            if (e instanceof CloudItemNotFoundError)
                storage = new CloudStorage();
            else
                throw e;
        }

        Object.assign(storage, this._assetMethods);

        return storage;
    }

    // throws CloudConflictError if the index was modified after it has been downloaded
    async persistDB(db) {
        const content = db.serialize();
        const previousModified = db.lastModified;
        const result = await this.uploadFileVersioned(this._getIndexPath(), content, db.version);

        db.version = result.version;
        db.lastModified = result.modified;

        if (this.onIndexPersisted)
            try {
                await this.onIndexPersisted(previousModified, result.modified);
            } catch (e) {
                console.error(e);
            }
    }

    _replaceSpecialChars(filename) {
        return filename.replace(/[\\\/:*?"<>|\[\]()^#%&!@:+={}'~]/g, "_");
    }
}
