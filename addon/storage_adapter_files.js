import {helperApp} from "./helper_app.js";
import {ARCHIVE_TYPE_TEXT, FILES_EXTERNAL_TYPE} from "./storage.js";

export class StorageAdapterFiles {
    async _postJSON(path, fields) {
        try {
            return helperApp.postJSON(path, fields);
        }
        catch (e) {
            console.error(e);
        }
    }

    async _fetchJSON(path, fields) {
        try {
            const response = await helperApp.postJSON(path, fields);

            if (response.ok)
                return response.json();
        }
        catch (e) {
            console.error(e);
        }
    }

    #getNotesFormat(path) {
        path = path.toLowerCase();

        if (path.endsWith(".org"))
            return "org";
        else if (path.endsWith(".md"))
            return "markdown";
        else
            return "text";
    }

    accepts(node) {
        return node && node.external === FILES_EXTERNAL_TYPE;
    }

    async getParams(node) {
        return {
            path: node.external_id
        };
    }

    async persistNotes(params) {
        try {
            return helperApp.postJSON(`/files/save_file_text`, params);
        } catch (e) {
            console.error(e);
        }
    }

    async fetchNotes(params) {
        try {
            const response = await helperApp.postJSON(`/files/fetch_file_text`, params);

            if (response.ok) {
                const notes = {__file_as_notes: true};

                notes.content = await response.text();
                notes.format = this.#getNotesFormat(params.path);

                return notes;
            }
        } catch (e) {
            console.error(e);
        }
    }

    async fetchArchiveContent(params) {
        const node = params.node;
        delete params.node;

        try {
            const response = await helperApp.postJSON(`/files/fetch_file_bytes`, params);

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
}
