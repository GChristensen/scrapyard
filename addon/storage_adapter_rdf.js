import {helperApp} from "./helper_app.js";
import {rdfShelf} from "./plugin_rdf_shelf.js";
import {RDF_EXTERNAL_TYPE} from "./storage.js";

// the page of an unpacked ScrapBook archive
const RDF_INDEX_FILE = "index.html";

export class StorageAdapterRDF {
    // Performs a modification of the RDF directory. Throws if the request has failed, so a
    // captured page that could not be written is reported instead of being silently lost.
    async _write(path, fields, form = false) {
        let response;

        try {
            response = form
                ? await helperApp.post(path, fields)
                : await helperApp.postJSON(path, fields);
        }
        catch (e) {
            const backend = helperApp.isServerMode()? "server": "backend application";
            throw new Error(`Can not connect to the ${backend}: ${e.message}`);
        }

        if (!response.ok)
            throw await helperApp.errorFromResponse(response);

        return response;
    }

    accepts(node) {
        return node && node.external === RDF_EXTERNAL_TYPE;
    }

    async getParams(node) {
        return {
            rdf_archive_path: await rdfShelf.getRDFArchiveDir(node)
        };
    }

    async fetchArchiveFile(params) {
        // the node is only used to select the adapter, it does not belong in the request
        delete params.node;

        try {
            const response = await helperApp.postJSON(`/rdf/fetch_archive_file`, params);

            if (response.ok) {
                let content = await response.arrayBuffer();
                const decoder = new TextDecoder();
                return decoder.decode(content);
            }
        } catch (e) {
            console.error(e);
        }
    }

    // An unpacked archive is carried as a zip of its directory, which is what persistArchive expects
    // of an item that contains files; returning its page alone would both lose the resource files
    // and make the receiving storage fail to unpack it.
    async fetchArchiveContent(params) {
        delete params.node;

        try {
            const response = await helperApp.postJSON(`/rdf/fetch_archive_content`, params);

            if (response.ok)
                return response.arrayBuffer();
        } catch (e) {
            console.error(e);
        }
    }

    // Stores an archive copied into the RDF shelf. An unpacked one arrives as a zip of its
    // directory and is extracted into the item directory; a packed one becomes its page.
    async persistArchive(params) {
        const fields = {
            content: new Blob([params.content]),
            contains: params.contains,
            rdf_archive_path: params.rdf_archive_path
        };

        return this._write(`/rdf/persist_archive_content`, fields, true);
    }

    async saveArchiveFile(params) {
        params.content = new Blob([params.content]);

        // building the word index parses every page of the archive, so it is requested once the
        // capture has written its page, not for each of the resource files it saves beforehand
        if (params.file === RDF_INDEX_FILE)
            params.compute_index = true;

        const response = await this._write(`/rdf/save_archive_file`, params, true);

        return response.json();
    }

    async persistComments(params) {
        return this._write("/rdf/persist_comments", params);
    }
}
