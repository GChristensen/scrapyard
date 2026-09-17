import {helperApp, isStaleItemError} from "./helper_app.js";
import {settings} from "./settings.js";
import {ARCHIVE_TYPE_TEXT} from "./storage.js";
import {markStorageDiverged, scheduleConflictSync} from "./storage_divergence.js";

// a request to an unreachable backend (e.g., a VPN that is down) may hang for many minutes otherwise
const REQUEST_TIMEOUT = 120000;
// uploads of archive content may be large
const UPLOAD_TIMEOUT = 600000;

// modifications rejected with 409 because the local copy of the item is stale (see scheduleConflictSync)
const STALE_ITEM_PATHS = ["/storage/persist_node", "/storage/update_node", "/storage/update_nodes"];

export class StorageAdapterDisk {
    async _postJSON(path, fields) {
        try {
            fields.data_path = helperApp.dataPath();

            if (fields.data_path)
                return helperApp.postJSON(path, fields, {timeout: REQUEST_TIMEOUT});
        }
        catch (e) {
            console.error(e);
        }
    }

    async _fetchJSON(path, fields) {
        try {
            fields.data_path = helperApp.dataPath();

            if (fields.data_path) {
                const response = await helperApp.postJSON(path, fields, {timeout: REQUEST_TIMEOUT});

                if (response.ok)
                    return response.json();
            }
        }
        catch (e) {
            console.error(e);
        }
    }

    // Performs a modification of the storage. Unlike _postJSON, throws if the request has failed.
    // diverges: the internal storage has already been modified, so a failure leaves it diverged from the backend
    // storage, which is marked to restore the internal storage later. The writes that are performed before
    // the internal storage is modified (e.g., archive content and notes, which are not stored internally)
    // do not mark the divergence, so a rejected write does not cause a needless restore.
    async _write(path, fields, form = false, diverges = true) {
        fields.data_path = helperApp.dataPath();

        if (!fields.data_path)
            return;

        let response;

        try {
            response = await this._request(() => form
                ? helperApp.post(path, fields, {timeout: UPLOAD_TIMEOUT})
                : helperApp.postJSON(path, fields, {timeout: REQUEST_TIMEOUT}));

            if (!response.ok)
                throw await helperApp.errorFromResponse(response);
        }
        catch (e) {
            if (isStaleItemError(e) && STALE_ITEM_PATHS.includes(path))
                scheduleConflictSync(e);
            else if (diverges)
                await markStorageDiverged(e);

            throw e;
        }

        return response;
    }

    async _request(f) {
        try {
            return await f();
        }
        catch (e) {
            const backend = helperApp.isServerMode()? "server": "backend application";
            throw new Error(`Can not connect to the ${backend}: ${e.message}`);
        }
    }

    // Performs a read request. Returns undefined if the object does not exist (404) and throws
    // on connection and backend errors, so an unavailable backend is not mistaken for missing content.
    async _read(path, params) {
        params.data_path = helperApp.dataPath();

        if (!params.data_path)
            return;

        const response = await this._request(() => helperApp.postJSON(path, params, {timeout: REQUEST_TIMEOUT}));

        if (response.ok)
            return response;
        else if (response.status === 404)
            return;
        else
            throw await helperApp.errorFromResponse(response);
    }

    accepts(node) {
        return node && !node.external;
    }

    async getParams(node) {
        return {};
    }

    async persistNode(params) {
        return this._write("/storage/persist_node", params);
    }

    async updateNode(params) {
        return this._write("/storage/update_node", params);
    }

    async updateNodes(params) {
        return this._write("/storage/update_nodes", params);
    }

    async deleteNodes(params) {
        return this._write("/storage/delete_nodes", params);
    }

    async deleteNodesShallow(params) {
        return this._write("/storage/delete_nodes_shallow", params);
    }

    async deleteNodeContent(params) {
        return this._write("/storage/delete_node_content", params);
    }

    async persistIcon(params) {
        return this._write("/storage/persist_icon", params);
    }

    async persistArchiveIndex(params) {
        return this._write("/storage/persist_archive_index", params);
    }

    // the internal storage is modified after the content is uploaded (see ArchiveProxy)
    async persistArchive(params) {
        const content = params.content;

        //delete params.content;
        //await this._postJSON("/storage/persist_archive_object", params);

        const fields = {
            content: new Blob([content]),
            contains: params.contains,
            uuid: params.uuid
        };

        return this._write(`/storage/persist_archive_content`, fields, true, false);
    }

    async getArchiveSize(params) {
        try {
            const response = await this._read("/storage/get_archive_size", params);

            if (response)
                return response.json();
        }
        catch (e) {
            // the size is informational
            console.error(e);
        }
    }

    async fetchArchiveContent(params) {
        const node = params.node;
        delete params.node;
        //archive = archive || await this._fetchJSON("/storage/fetch_archive_object", params);

        const response = await this._read(`/storage/fetch_archive_content`, params);

        if (response) {
            let content = await response.arrayBuffer();

            if (!node.contains || node.contains === ARCHIVE_TYPE_TEXT) {
                const decoder = new TextDecoder();
                content = decoder.decode(content);
            }

            return content;
        }
    }

    async fetchArchiveFile(params) {
        const response = await this._read(`/storage/fetch_archive_file`, params);

        if (response) {
            let content = await response.arrayBuffer();
            const decoder = new TextDecoder();
            return decoder.decode(content);
        }
    }

    // files of unpacked archives are not stored internally
    async saveArchiveFile(params) {
        params.content = new Blob([params.content]);
        params.compute_index = true;

        const response = await this._write(`/storage/save_archive_file`, params, true, false);

        if (response)
            return response.json();
    }

    async persistNotesIndex(params) {
        return this._write("/storage/persist_notes_index", params);
    }

    // notes are not stored internally, a failed save is retried by the notes editor
    async persistNotes(params) {
        return this._write("/storage/persist_notes", params, false, false);
    }

    // returns undefined only if there are no notes, throws if the notes could not be fetched,
    // so an unavailable backend is not mistaken for empty notes that could be overwritten
    async fetchNotes(params) {
        const response = await this._read("/storage/fetch_notes", params);

        if (response)
            return response.json();
    }

    async persistCommentsIndex(params) {
        return this._write("/storage/persist_comments_index", params);
    }

    async persistComments(params) {
        return this._write("/storage/persist_comments", params);
    }

    async fetchComments(params) {
        return this._fetchJSON("/storage/fetch_comments", params);
    }
}
