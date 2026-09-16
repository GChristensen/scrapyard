import {settings} from "./settings.js";
import {Archive, Node} from "./storage_entities.js";
import {showNotification} from "./utils_browser.js";
import {isTransientError} from "./helper_app.js";
import {indexHTML} from "./utils_html.js";

// Archives that could not be uploaded to the backend storage are kept in the browser (see ArchiveProxy)
// and uploaded here when the backend is available again. This should be done before the internal storage is
// reset by synchronization, which would delete them.

let uploading;

// returns true if no archives remain pending
export async function uploadPendingArchives() {
    if (settings.storage_mode_internal())
        return true;

    if (!uploading)
        uploading = uploadArchives().finally(() => uploading = undefined);

    return uploading;
}

async function uploadArchives() {
    const pending = await Archive.idb.getPendingUploads();
    let uploaded = 0;

    for (const archive of pending) {
        const node = await Node.get(archive.node_id);

        if (!node) { // the bookmark has been deleted
            await Archive.idb.removePendingUpload({id: archive.node_id});
            continue;
        }

        try {
            // the node itself might have not been stored
            await Node.update(node, false);
            await Archive.uploadPendingArchive(node, archive);

            // The index is not stored locally if the capture has failed before indexing (ArchiveIDB.add stores it
            // after the node update, which also fails without a connection), so it is rebuilt from a text archive
            // in the same way as in ArchiveIDB.add. It is stored both locally and in the backend storage, from where
            // it is restored by the synchronization that resets the internal storage.
            let words = (await Archive.fetchIndex(node))?.words;

            if (!words && typeof archive.object === "string" && !archive.byte_length)
                words = indexHTML(archive.object);

            if (words)
                await Archive.storeIndex(node, words);

            await Archive.updateContentModified(node, archive);
            await Archive.idb.removePendingUpload(node);
            ++uploaded;
        }
        catch (e) {
            console.error(e);

            if (isTransientError(e))
                return false;

            // a retry would not succeed, and the pending archive should not block synchronization forever
            await Archive.idb.removePendingUpload(node);
            showNotification(`The archive "${node.name}" saved in the browser could not be uploaded `
                + `and is discarded: ${e.message}`);
        }
    }

    if (uploaded)
        showNotification(`${uploaded} archive${uploaded > 1? "s": ""} saved in the browser `
            + `${uploaded > 1? "have": "has"} been uploaded.`);

    return true;
}
