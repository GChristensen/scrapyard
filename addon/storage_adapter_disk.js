import {helperApp} from "./helper_app.js";
import {settings} from "./settings.js";
import {ARCHIVE_TYPE_TEXT} from "./storage.js";
import {markStorageDiverged} from "./storage_divergence.js";

export class StorageAdapterDisk {
    async _postJSON(path, fields) {
        try {
            fields.data_path = helperApp.dataPath();

            if (fields.data_path)
                return helperApp.postJSON(path, fields);
        }
        catch (e) {
            console.error(e);
        }
    }

    async _fetchJSON(path, fields) {
        try {
            fields.data_path = helperApp.dataPath();

            if (fields.data_path) {
                const response = await helperApp.postJSON(path, fields);

                if (response.ok)
                    return response.json();
            }
        }
        catch (e) {
            console.error(e);
        }
    }

    // Performs a modification of the storage. Unlike _postJSON, throws if the request has failed,
    // and marks the internal storage as diverged from the backend storage, which is already modified.
    async _write(path, fields, form = false) {
        fields.data_path = helperApp.dataPath();

        if (!fields.data_path)
            return;

        let response;

        try {
            response = await this._request(() => form
                ? helperApp.post(path, fields)
                : helperApp.postJSON(path, fields));

            if (!response.ok)
                throw new Error(`Backend error ${response.status} (${response.statusText})`);
        }
        catch (e) {
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
            throw new Error("Can not connect to the backend application: " + e.message);
        }
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

    async persistArchive(params) {
        const content = params.content;

        //delete params.content;
        //await this._postJSON("/storage/persist_archive_object", params);

        const fields = {
            content: new Blob([content]),
            contains: params.contains,
            uuid: params.uuid
        };

        return this._write(`/storage/persist_archive_content`, fields, true);
    }

    async getArchiveSize(params) {
        const response = await this._postJSON("/storage/get_archive_size", params);

        if (response.ok)
            return response.json();
    }

    async fetchArchiveContent(params) {
        const node = params.node;
        delete params.node;
        //archive = archive || await this._fetchJSON("/storage/fetch_archive_object", params);

        params.data_path = helperApp.dataPath();

        try {
            const response = await helperApp.postJSON(`/storage/fetch_archive_content`, params);

            if (response.ok) {
                let content = await response.arrayBuffer();

                if (!node.contains || node.contains === ARCHIVE_TYPE_TEXT) {
                    const decoder = new TextDecoder();
                    content = decoder.decode(content);
                }

                return content;
            }

        } catch (e) {
            console.error(e);
        }
    }

    async fetchArchiveFile(params) {
        params.data_path = helperApp.dataPath();

        try {
            const response = await helperApp.postJSON(`/storage/fetch_archive_file`, params);

            if (response.ok) {
                let content = await response.arrayBuffer();
                const decoder = new TextDecoder();
                return decoder.decode(content);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async saveArchiveFile(params) {
        params.content = new Blob([params.content]);
        params.compute_index = true;

        const response = await this._write(`/storage/save_archive_file`, params, true);

        if (response)
            return response.json();
    }

    async persistNotesIndex(params) {
        return this._write("/storage/persist_notes_index", params);
    }

    async persistNotes(params) {
        return this._write("/storage/persist_notes", params);
    }

    // returns undefined only if there are no notes, throws if the notes could not be fetched,
    // so an unavailable backend is not mistaken for empty notes that could be overwritten
    async fetchNotes(params) {
        params.data_path = helperApp.dataPath();

        if (!params.data_path)
            return;

        const response = await this._request(() => helperApp.postJSON("/storage/fetch_notes", params));

        if (response.ok)
            return response.json();
        else if (response.status === 404)
            return;
        else
            throw new Error(`Backend error ${response.status} (${response.statusText})`);
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
