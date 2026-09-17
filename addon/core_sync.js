import {receive, send, sendLocal} from "./proxy.js";
import {SCRAPYARD_SYNC_METADATA, settings} from "./settings.js";
import {Archive, Node} from "./storage_entities.js";
import {HELPER_APP_v2_IS_REQUIRED, helperApp} from "./helper_app.js";
import {ACTION_ICONS, CONTEXT_BACKGROUND, getContextType, showNotification} from "./utils_browser.js";
import {DEFAULT_SHELF_UUID, NON_SYNCHRONIZED_EXTERNALS, JSON_SCRAPBOOK_VERSION} from "./storage.js";
import {chunk, ProgressCounter} from "./utils.js";
import {MarshallerSync, UnmarshallerSync} from "./marshaller_sync.js";
import {Database} from "./storage_database.js";
import {undoManager} from "./bookmarks_undo.js";
import {
    clearStorageDivergence,
    getStorageDivergence,
    resetStorageRecoveryAttempts,
    scheduleStorageRecovery,
    setStorageRecovery
} from "./storage_divergence.js";
import {uploadPendingArchives} from "./storage_uploads.js";
import {isNodePending} from "./storage_pending.js";

const SYNC_NODE_CHUNK_SIZE = 10;

// in the server mode the storage is shared with other browsers, whose changes are picked up periodically
const SERVER_SYNC_ALARM_NAME = "scrapyard-server-sync";
const SERVER_SYNC_ALARM_PERIOD = 10; // minutes

let syncing = false;

receive.checkSyncDirectory = async message => {
    try {
        send.startProcessingIndication();
        const helper = await helperApp.hasVersion("2.0", HELPER_APP_v2_IS_REQUIRED);

        if (helper) {
            const status = await helperApp.fetchJSON_postJSON("/storage/check_directory", {
                data_path: message.path
            });

            if (status)
                return status.status;
        }
    }
    finally {
        send.stopProcessingIndication();
    }
};

// restores the internal storage from the backend storage after failed writes,
// and uploads the archives kept in the browser after failed uploads
async function recoverStorage() {
    await settings.load();

    if (settings.storage_mode_internal())
        return;

    if (await getStorageDivergence())
        return sendLocal.performSync({verbose: false});

    if (await Archive.idb.hasPendingUploads())
        return uploadPendingArchives();
}

async function isRecoveryRequired() {
    await settings.load();

    return !settings.storage_mode_internal()
        && (!!await getStorageDivergence() || await Archive.idb.hasPendingUploads());
}

setStorageRecovery(recoverStorage, isRecoveryRequired);

// The restore is performed when the backend is available again. In the server mode the storage is shared
// with other browsers, so the local data is refreshed on every (re)connection regardless of the divergence:
// the changes made by other browsers while the server was unreachable would be missed otherwise.
async function onBackendConnected() {
    await settings.load();
    resetStorageRecoveryAttempts();

    if (settings.storage_mode_server())
        return sendLocal.performSync({verbose: false});

    return recoverStorage();
}

helperApp.addConnectionListener(onBackendConnected);

// pending restores and uploads are resumed after the browser is restarted
isRecoveryRequired()
    .then(required => required && scheduleStorageRecovery())
    .catch(e => console.error(e));

// The periodic synchronization in the server mode: the storage is synchronized only if it has been modified
// since the last synchronization (the index metadata timestamp changes on every write, including the own ones,
// which results in a synchronization without changes at most once per period).
async function performPeriodicSync() {
    await settings.load();

    if (!settings.storage_mode_server() || syncing || !helperApp.port)
        return;

    const storageMetadata = await getStorageMetadata(helperApp.dataPath(), false);
    const dbMetadata = await settings.get(SCRAPYARD_SYNC_METADATA);

    if (storageMetadata && storageMetadata.timestamp !== dbMetadata?.timestamp)
        return sendLocal.performSync({verbose: false});
}

if (getContextType() === CONTEXT_BACKGROUND) {
    browser.alarms.get(SERVER_SYNC_ALARM_NAME)
        .then(alarm => alarm || browser.alarms.create(SERVER_SYNC_ALARM_NAME, {periodInMinutes: SERVER_SYNC_ALARM_PERIOD}))
        .catch(e => console.error(e));

    browser.alarms.onAlarm.addListener(alarm => {
        if (alarm.name === SERVER_SYNC_ALARM_NAME)
            performPeriodicSync().catch(e => console.error(e));
    });
}

receive.performSync = async message => {
    // the flag is set synchronously, so concurrent requests (e.g., the startup synchronization and the one
    // triggered by the backend connection) do not pass the check during the asynchronous preparations
    if (syncing)
        return;

    let synced;

    syncing = true;
    send.startProcessingIndication();

    try {
        synced = await performSync(message?.verbose !== false);
    }
    finally {
        syncing = false;
        send.stopProcessingIndication();

        if (synced)
            send.shelvesChanged();
    }
};

async function performSync(verbose) {
    let result;

    await settings.load();

    const syncDirectory = helperApp.dataPath();

    if (!syncDirectory || !await helperApp.probe(verbose))
        return;

    // archives kept in the browser after failed uploads would be lost if the database is reset
    if (!await uploadPendingArchives()) {
        if (verbose)
            showNotification("Synchronization is postponed until the archives saved in the browser are uploaded.");
        return;
    }

    // failed writes have left the internal storage diverged from the backend storage,
    // it is reset and populated from the backend storage
    const divergence = await getStorageDivergence();

    let storageMetadata = await getStorageMetadata(syncDirectory, verbose);

    if (storageMetadata) {
        const dbMetadata = divergence? null: await settings.get(SCRAPYARD_SYNC_METADATA);
        const reset = isDatabaseResetRequired(storageMetadata, dbMetadata);

        // the operations are computed before the database is reset, so it is not left empty
        // if the backend becomes unavailable
        const syncOperations = await computeSync(syncDirectory, reset);

        if (syncOperations) {
            if (reset)
                await resetDatabase();

            const {changes, errors} = await syncWithStorage(syncOperations, syncDirectory);
            result = changes;

            try {
                await helperApp.fetch("/storage/sync_close_session");
            }
            catch (e) {
                console.error(e);
            }

            await settings.set(SCRAPYARD_SYNC_METADATA, storageMetadata);

            if (divergence) {
                const storage = helperApp.isServerMode()? "server": "disk storage";

                if (errors) {
                    showNotification(`The local data could not be completely restored from the ${storage}, `
                        + "restoring will be retried.");
                    scheduleStorageRecovery();
                }
                else {
                    await clearStorageDivergence(divergence);
                    showNotification(`Unsaved changes have been discarded, the local data is restored from the ${storage}.`);
                }

                result = true;
            }
        }
        else if (verbose)
            showNotification("Synchronization could not be performed because of an error.");
    }

    return result;
}

async function getStorageMetadata(syncDirectory, verbose = true) {
    let storageMetadata
    try {
        storageMetadata = await helperApp.fetchJSON_postJSON("/storage/get_metadata", {
            data_path: syncDirectory
        });
    } catch (e) {
        console.error(e);
    }

    if (!storageMetadata || storageMetadata.error === "error") {
        verbose && showNotification("Synchronization error.");
        return;
    }
    else if (storageMetadata.error === "empty" || !storageMetadata.entities) {
        verbose && showNotification("The disk storage is missing or empty.\n"
                            + "If you are just starting to work with Scrapyard, please create a bookmark to mute this message.");
        return;
    }
    else if (storageMetadata.type !== "index") {
        verbose && showNotification("Unknown storage format type.");
        return;
    }
    else if (typeof storageMetadata.version === "number" && storageMetadata.version > JSON_SCRAPBOOK_VERSION) {
        verbose && showNotification("Unknown storage format version.");
        return;
    }

    return storageMetadata;
}

// if the database is going to be reset, the operations are computed as for an empty database
async function computeSync(syncDirectory, reset) {
    const syncNodes = reset? []: await getNodesForSync();

    const syncParams = {
        data_path: syncDirectory,
        nodes: JSON.stringify(syncNodes),
        last_sync_date: (!reset && settings.last_sync_date()) || -1
    };

    let syncOperations;
    try {
        syncOperations = await helperApp.fetchJSON_postJSON("/storage/sync_compute", syncParams);
    } catch (e) {
        console.error(e);
    }
    return syncOperations;
}

async function getNodesForSync() {
    const syncNodes = [];
    const marshaller = new MarshallerSync();

    await Node.iterate(node => {
        const nonSyncable = node.external && NON_SYNCHRONIZED_EXTERNALS.some(ex => ex === node.external);

        // the nodes with a capture in progress are not in the storage yet and are not reported to it,
        // otherwise they would be deleted as absent in the storage
        if (!nonSyncable && !isNodePending(node)) {
            const syncNode = marshaller.createSyncNode(node);
            syncNodes.push(syncNode);
        }
    });

    return syncNodes;
}

function isDatabaseResetRequired(storageMetadata, dbMetadata) {
    return storageMetadata.uuid !== dbMetadata?.uuid
        || storageMetadata.timestamp < dbMetadata?.timestamp
        || storageMetadata.version !== dbMetadata?.version;
}

async function resetDatabase() {
    await undoManager.commit();
    await Database.wipeImportable();
    await settings.last_sync_date(null);
}

async function syncWithStorage(syncOperations, syncDirectory) {
    const result = {changes: false, errors: false};

    if (areChangesPresent(syncOperations)) {
        const action = _MANIFEST_V3? browser.action: browser.browserAction;

        if (settings.platform.firefox)
            action.setIcon({path: "/icons/action-sync.svg"});
        else
            action.setIcon({path: "/icons/action-sync.png"});

        try {
            result.errors = await performOperations(syncOperations, syncDirectory);
        } finally {
            if (settings.platform.firefox)
                action.setIcon({path: "/icons/scrapyard.svg"});
            else
                action.setIcon({path: ACTION_ICONS});
        }

        result.changes = true;
    }

    return result;
}

function areChangesPresent(syncOperations) {
    //console.log(syncOperations);

    const changes = syncOperations.push.length
        || syncOperations.pull.length
        || syncOperations.delete.length
        || syncOperations.delete_in_storage.length;

    return !!changes;
}

async function performOperations(syncOperations, syncDirectory) {
    await helperApp.fetchJSON_postJSON("/storage/sync_open_session", {data_path: syncDirectory});

    let errors = false;

    // try {
    //     await deleteStorageNodes(syncOperations.delete_in_storage);
    // }
    // catch (e) {
    //     errors = true;
    //     console.error(e);
    // }

    const total = syncOperations.push.length
        + Math.floor(syncOperations.pull.length / SYNC_NODE_CHUNK_SIZE)
        /*+ syncOperations.delete.length*/;
    const progress = new ProgressCounter(total, "syncProgress");

    // const syncMarshaller = new MarshallerSync();
    // for (const syncNode of syncOperations.push)
    //     try {
    //         await syncMarshaller.marshal(syncNode);
    //         progress.incrementAndNotify();
    //     }
    //     catch (e) {
    //         errors = true;
    //         console.error(e);
    //     }

    const syncUnmarshaller = new UnmarshallerSync();
    for (const syncNodes of chunk(syncOperations.pull, SYNC_NODE_CHUNK_SIZE))
        try {
            const success = await syncUnmarshaller.unmarshall(syncNodes)
            progress.incrementAndNotify();

            if (!success)
                errors = true;
        } catch (e) {
            errors = true;
            console.error(e);
        }

    await deleteNodes(syncOperations.delete);

    progress.finish();

    await settings.load();
    settings.last_sync_date(Date.now());

    if (errors)
        showNotification("Synchronization finished with errors.");

    return errors;
}

async function deleteStorageNodes(syncNodes) {
    if (syncNodes.length)
        await helperApp.post("/storage/sync_delete_nodes", {nodes: JSON.stringify(syncNodes)});
}

async function deleteNodes(syncNodes) {
    for (const syncNode of syncNodes)
        try {
            if (syncNode.uuid === DEFAULT_SHELF_UUID || isNodePending(syncNode))
                continue;
            const node = await Node.getByUUID(syncNode.uuid)
            await Node.idb.delete(node)
        }
        catch (e) {
            console.error(e);
        }
}
