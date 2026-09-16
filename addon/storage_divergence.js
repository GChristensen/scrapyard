import {helperApp} from "./helper_app.js";
import {showNotification} from "./utils_browser.js";

// Changes are written to the browser internal storage first and to the backend storage afterward.
// If a backend write fails, the internal storage diverges from the backend storage, which is the source of truth.
// Such a state is marked here, and the internal storage is restored from the backend storage by the next
// synchronization (see core_sync.js). The restore is attempted after the connection to the backend is
// (re)established, and periodically, because a write may also fail while the connection remains open
// (e.g., a reverse proxy error).

const STORAGE_DIVERGED_KEY = "scrapyard-storage-diverged";
const NOTIFICATION_INTERVAL = 30000;
const RECOVERY_MIN_DELAY = 30000;
const RECOVERY_MAX_DELAY = 5 * 60000;

let lastNotificationTime = 0;
let recovery;
let recoveryTimeout;
let recoveryDelay = RECOVERY_MIN_DELAY;

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

    scheduleStorageRecovery();
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

// the function restores the internal storage, it is registered in the background context
export function setStorageRecovery(f) {
    recovery = f;
}

// retries the restore of the internal storage with increasing delays until the divergence is cleared
export function scheduleStorageRecovery() {
    if (!recovery || recoveryTimeout)
        return;

    recoveryTimeout = setTimeout(async () => {
        try {
            await recovery();
        }
        catch (e) {
            console.error(e);
        }

        recoveryTimeout = undefined;

        if (await getStorageDivergence()) {
            recoveryDelay = Math.min(recoveryDelay * 2, RECOVERY_MAX_DELAY);
            scheduleStorageRecovery();
        }
        else
            recoveryDelay = RECOVERY_MIN_DELAY;
    }, recoveryDelay);
}
