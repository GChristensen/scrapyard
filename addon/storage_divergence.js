import {helperApp} from "./helper_app.js";
import {showNotification} from "./utils_browser.js";
import {sendLocal} from "./proxy.js";

// Changes are written to the browser internal storage first and to the backend storage afterward.
// If a backend write fails, the internal storage diverges from the backend storage, which is the source of truth.
// Such a state is marked here, and the internal storage is restored from the backend storage by the next
// synchronization (see core_sync.js). The restore is attempted after the connection to the backend is
// (re)established, and periodically, because a write may also fail while the connection remains open
// (e.g., a reverse proxy error).
//
// The same retry mechanism uploads the archives that are kept in the browser after failed uploads
// (see storage_uploads.js), which do not require a restore of the internal storage.

const STORAGE_DIVERGED_KEY = "scrapyard-storage-diverged";
const NOTIFICATION_INTERVAL = 30000;
const RECOVERY_MIN_DELAY = 30000;
const RECOVERY_MAX_DELAY = 5 * 60000;
// automatic restores are suspended after this number of consecutive attempts that have not cleared the divergence
// (e.g., a write keeps failing right after each restore); a restore is still performed on reconnection
// and by a manual synchronization
const RECOVERY_MAX_ATTEMPTS = 10;
// several stale writes usually belong to one operation, the refresh is performed after the last of them
const CONFLICT_SYNC_DELAY = 3000;

let lastNotificationTime = 0;
let recovery;
let recoveryRequired;
let recoveryTimeout;
let recoveryDelay = RECOVERY_MIN_DELAY;
let recoveryAttempts = 0;
let conflictSyncTimeout;

export async function markStorageDiverged(error) {
    console.error(error);

    try {
        await browser.storage.local.set({[STORAGE_DIVERGED_KEY]: Date.now()});
    }
    catch (e) {
        console.error(e);
    }

    // a failed operation usually consists of several writes
    if (Date.now() - lastNotificationTime > NOTIFICATION_INTERVAL) {
        lastNotificationTime = Date.now();

        const storage = helperApp.isServerMode()? "server": "disk storage";
        showNotification({message: `Changes could not be saved to the ${storage}: ${error.message}\n`
                + `The local data will be restored from the ${storage} when it is available.`});
    }

    // a new failure restarts the suspended automatic restores
    recoveryAttempts = 0;
    scheduleStorageRecovery();
}

// The backend has rejected a modification of an item that has been deleted (or whose parent folder has been deleted)
// in the storage, e.g., by another browser. The storage is not modified, so the internal storage is not diverged,
// its stale copy of the item is removed by an ordinary synchronization.
export function scheduleConflictSync(error) {
    console.error(error);

    if (Date.now() - lastNotificationTime > NOTIFICATION_INTERVAL) {
        lastNotificationTime = Date.now();

        showNotification({message: "The item has been deleted or moved in the storage (probably by another browser), "
                + "the local data will be refreshed."});
    }

    clearTimeout(conflictSyncTimeout);
    conflictSyncTimeout = setTimeout(() => {
        conflictSyncTimeout = undefined;
        sendLocal.performSync({verbose: false}).catch(e => console.error(e));
    }, CONFLICT_SYNC_DELAY);
}

// returns the time of the latest failed write, or undefined
export async function getStorageDivergence() {
    const object = await browser.storage.local.get(STORAGE_DIVERGED_KEY);
    return object?.[STORAGE_DIVERGED_KEY];
}

// clears the mark only if no writes have failed since the given time was obtained
export async function clearStorageDivergence(divergence) {
    if (divergence === undefined || await getStorageDivergence() === divergence)
        await browser.storage.local.remove(STORAGE_DIVERGED_KEY);
}

// recoveryF restores the internal storage and uploads pending archives, requiredF tells if there is anything to do;
// they are registered in the background context
export function setStorageRecovery(recoveryF, requiredF) {
    recovery = recoveryF;
    recoveryRequired = requiredF;
}

export function resetStorageRecoveryAttempts() {
    recoveryAttempts = 0;
}

// retries the restore of the internal storage with increasing delays until the divergence is cleared
export function scheduleStorageRecovery() {
    if (!recovery || recoveryTimeout)
        return;

    if (recoveryAttempts >= RECOVERY_MAX_ATTEMPTS) {
        console.error("Automatic restore of the internal storage is suspended after repeated failures.");
        return;
    }

    recoveryTimeout = setTimeout(async () => {
        recoveryAttempts += 1;

        try {
            await recovery();
        }
        catch (e) {
            console.error(e);
        }

        recoveryTimeout = undefined;

        let required = true;

        try {
            required = recoveryRequired? await recoveryRequired(): await getStorageDivergence();
        }
        catch (e) {
            console.error(e);
        }

        if (required) {
            recoveryDelay = Math.min(recoveryDelay * 2, RECOVERY_MAX_DELAY);
            scheduleStorageRecovery();
        }
        else {
            recoveryDelay = RECOVERY_MIN_DELAY;
            recoveryAttempts = 0;
        }
    }, recoveryDelay);
}
