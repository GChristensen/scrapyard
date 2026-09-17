import {StorageAdapterDisk} from "./storage_adapter_disk.js";
import {settings} from "./settings.js";
import {StorageProxy} from "./storage_proxy.js";
import {CLOUD_EXTERNAL_TYPE} from "./storage.js";
import {CONTEXT_BACKGROUND, getContextType} from "./utils_browser.js";
import {receive} from "./proxy.js";
import {sleep} from "./utils.js";
import {httpErrorMessage} from "./helper_app.js";

const BATCH_CLOSE_ATTEMPTS = 3;
const BATCH_CLOSE_RETRY_DELAY = 2000;

class StorageDisk extends StorageAdapterDisk {
    // throws if the storage could not be wiped, so an import that replaces everything does not proceed
    // and leave the old and the new items mixed in the storage
    wipeStorage() {
        if (!settings.storage_mode_internal())
            return this._write("/storage/wipe", {});
    }

    openBatchSession() {
        if (!settings.storage_mode_internal())
            return this._postJSON("/storage/open_batch_session", {});
    }

    // Is called in finally blocks and does not throw, so the error of the batch operation is not masked.
    // A session that could not be closed is saved and closed by the backend after an idle timeout.
    // force: closes the session even if it has been opened by others (e.g., a stuck session cancelled by the user)
    async closeBatchSession(force = false) {
        if (settings.storage_mode_internal())
            return;

        for (let attempt = 1; ; ++attempt) {
            try {
                const response = await this._postJSON("/storage/close_batch_session", force? {force}: {});

                if (!response || response.ok)
                    return;

                throw new Error(httpErrorMessage(response));
            }
            catch (e) {
                if (attempt >= BATCH_CLOSE_ATTEMPTS) {
                    console.error("Can not close the batch session", e);
                    return;
                }

                await sleep(BATCH_CLOSE_RETRY_DELAY);
            }
        }
    }

    async isBatchSessionOpen() {
        if (!settings.storage_mode_internal()) {
            try {
                const response = await this._postJSON("/storage/is_batch_session_open", {});

                if (response?.ok) {
                    const json = await response.json();
                    return json.result;
                }
            }
            catch (e) {
                console.error(e);
            }
        }
    }

    async deleteOrphanedItems(orphanedItems) {
        if (!settings.storage_mode_internal())
            return this._postJSON("/storage/delete_orphaned_items", {node_uuids: orphanedItems});
    }
}

export const DiskStorage = new StorageDisk();

class StorageCloud {
    async openBatchSession() {
        return StorageProxy.cloudAdapter.openBatchSession();
    }

    async closeBatchSession() {
        return StorageProxy.cloudAdapter.closeBatchSession();
    }
}

export const CloudStorage = new StorageCloud();

class StorageExternal {
    async openBatchSession(referenceNode) {
        await DiskStorage.openBatchSession();

        if (referenceNode.external === CLOUD_EXTERNAL_TYPE)
            await CloudStorage.openBatchSession();
    }

    async closeBatchSession(referenceNode, force = false) {
        await DiskStorage.closeBatchSession(force);

        if (referenceNode.external === CLOUD_EXTERNAL_TYPE)
            await CloudStorage.closeBatchSession();
    }

    async isBatchSessionOpen() {
        return DiskStorage.isBatchSessionOpen();
    }
}

export const ExternalStorage = new StorageExternal();

if (getContextType() === CONTEXT_BACKGROUND) {
    receive.openCloudBatchSession = message => {
        return CloudStorage.openBatchSession();
    };

    receive.closeCloudBatchSession = message => {
        return CloudStorage.closeBatchSession();
    };
}
