import {MarshallerJSONScrapbook, UnmarshallerJSONScrapbook} from "./marshaller_json_scrapbook.js";
import {Archive} from "./storage_entities.js";
import {StorageProxy} from "./storage_proxy.js";
import {settings} from "./settings.js";
import {showNotification} from "./utils_browser.js";
import {isTransientError} from "./helper_app.js";
import {scheduleStorageRecovery} from "./storage_divergence.js";

export class ArchiveProxy extends StorageProxy {
    #marshaller = new MarshallerJSONScrapbook();
    #unmarshaller = new UnmarshallerJSONScrapbook();

    async storeIndex(node, words) {
        const result = await this.wrapped.storeIndex(node, words);

        await this.#persistArchiveIndex(node, words);

        return result;
    }

    async _add(node, archive) {
        return this.#persistArchive(node, archive);
    }

    async get(node) {
        return this.#fetchArchive(node);
    }

    async getSize(node) {
        return this.#getArchiveSize(node);
    }

    async getFile(node, file) {
        return this.#fetchArchiveFile(node, file);
    }

    async saveFile(node, file, content) {
        return this.#saveArchiveFile(node, file, content);
    }

    async #persistArchiveIndex(node, words) {
        const adapter = this.adapter(node);

        if (adapter) {
            let index = this.wrapped.indexEntity(node, words);
            index = await this.#marshaller.convertIndex(index);

            const params = {
                uuid: node.uuid,
                index_json: JSON.stringify(index)
            };

            return adapter.persistArchiveIndex(params);
        }
    }

    async #persistArchive(node, archive) {
        const adapter = this.adapter(node);

        if (adapter) {
            try {
                await this.#uploadArchive(adapter, node, archive);
            }
            catch (e) {
                // the only copy of a captured page is kept locally until it is uploaded,
                // unless the backend has rejected it, and a retry would not succeed
                if (adapter === StorageProxy._adapterDisk && isTransientError(e) && await this.#retainArchive(node, archive))
                    showNotification(`The archive "${node.name}" is saved in the browser and will be uploaded `
                        + `when the ${helperStorageName()} is available.`);
                else
                    throw e;
            }
        }
        else if (settings.storage_mode_internal())
            return Archive.idb.add(node, archive);

        return archive;
    }

    async #uploadArchive(adapter, node, archive) {
        const content = await Archive.reify(archive);
        archive = await this.#marshaller.convertArchive(archive);

        delete archive.content;

        const params = {
            uuid: node.uuid,
            archive_json: JSON.stringify(archive),
            content: content,
            contains: node.contains,
            // an adapter that stores the archive by its location rather than by uuid needs its path
            ...await adapter.getParams(node)
        };

        await adapter.persistArchive(params);
    }

    async #retainArchive(node, archive) {
        try {
            await this.wrapped._add(node, {...archive});
            // the upload is retried when the backend is available (see storage_uploads.js)
            scheduleStorageRecovery();
            return true;
        }
        catch (e) {
            console.error(e);
        }
    }

    // uploads an archive retained after a failed upload, throws on failure
    async uploadPendingArchive(node, archive) {
        const adapter = this.adapter(node);

        if (adapter === StorageProxy._adapterDisk)
            await this.#uploadArchive(adapter, node, archive);
    }

    async #saveArchiveFile(node, file, content) {
        const adapter = this.adapter(node);

        if (adapter)
            return adapter.saveArchiveFile({uuid: node.uuid, file, content, ...await adapter.getParams(node)});
    }

    async #fetchArchive(node) {
        const adapter = this.adapter(node);

        if (adapter === StorageProxy._adapterDisk) {
            const pending = await this.wrapped.get(node);

            if (pending)
                return pending;
        }

        if (adapter) {
            const content = await adapter.fetchArchiveContent({
                node,
                uuid: node.uuid,
                ...await adapter.getParams(node)
            });

            if (content)
                return Archive.entity(node, content, node.content_type);
        }
        else if (settings.storage_mode_internal())
            return Archive.idb.get(node);
    }

    async #fetchArchiveFile(node, file) {
        const adapter = this.adapter(node);

        if (adapter)
            return adapter.fetchArchiveFile({uuid: node.uuid, file, ...await adapter.getParams(node)});
    }

    async #getArchiveSize(node) {
        const adapter = this.adapter(node);

        if (adapter)
            return adapter.getArchiveSize({uuid: node.uuid, ...await adapter.getParams(node)});
    }
}


function helperStorageName() {
    return settings.storage_mode_server()? "server": "backend application";
}
