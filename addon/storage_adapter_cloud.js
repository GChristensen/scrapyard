import {ARCHIVE_TYPE_FILES, ARCHIVE_TYPE_TEXT, CLOUD_EXTERNAL_TYPE, UNPACKED_ARCHIVE_DIRECTORY} from "./storage.js";
import {CONTEXT_BACKGROUND, getContextType} from "./utils_browser.js";
import {unzip} from "./lib/unzipit.js";
import {send} from "./proxy.js";

export class StorageAdapterCloud {
    _provider;
    _batchCloudDB;

    setProvider(provider) {
        this._provider = provider;
    }

    async withCloudDB(f, fe) {
        if (this._batchCloudDB) {
            try {
                await f(this._batchCloudDB);
            } catch (e) {
                console.error(e);
                if (fe) fe(e);
            }
        }
        else {
            try {
                let db = await this._provider.downloadDB();
                await f(db);
                await this._provider.persistDB(db);
            } catch (e) {
                console.error(e);
                if (fe) fe(e);
            }
        }
    }

    async #openBatchSession() {
        this._batchCloudDB = await this._provider.downloadDB();
    }

    async openBatchSession() {
        if (getContextType() === CONTEXT_BACKGROUND)
            return this.#openBatchSession();
        else
            return send.openCloudBatchSession();
    }

    async #closeBatchSession() {
        try {
            await this._provider.persistDB(this._batchCloudDB);
        }
        finally {
            this._batchCloudDB = undefined;
        }
    }

    async closeBatchSession() {
        if (getContextType() === CONTEXT_BACKGROUND)
            return this.#closeBatchSession();
        else
            return send.closeCloudBatchSession();
    }

    accepts(node) {
        return node && node.external === CLOUD_EXTERNAL_TYPE;
    }

    async getParams(node) {
        return {};
    }

    async _persistNodeObject(node) {
        const nodeJSON = JSON.stringify(node);
        await this._provider.assets.storeNode(node.uuid, nodeJSON);
    }

    async persistNode(params) {
        await this._persistNodeObject(params.node);
        return this.withCloudDB(db => db.addNode(params.node));
    }

    async updateNode(params) {
        return this.withCloudDB(db => {
            db.updateNode(params.node);
            const node = db.getNode(params.node.uuid);
            return this._persistNodeObject(node);
        });
    }

    async updateNodes(params) {
        return this.withCloudDB(async db => {
            for (const node of params.nodes) {
                db.updateNode(node);
                const updatedNode = db.getNode(node.uuid);
                await this._persistNodeObject(updatedNode);
            }
        });
    }

    async deleteNodes(params) {
        await this.deleteNodesShallow(params);
        await this.deleteNodeContent(params);
    }

    async deleteNodesShallow(params) {
        return this.withCloudDB(db => {
            const nodes = params.node_uuids.map(uuid => ({uuid}));
            db.deleteNodes(nodes);
        });
    }

    async deleteNodeContent(params) {
        return this._provider.deleteAssets(params.node_uuids);
    }

    async persistIcon(params) {
        return this._provider.assets.storeIcon(params.uuid, params.icon_json);
    }

    async persistArchiveIndex(params) {
        return this._provider.assets.storeArchiveIndex(params.uuid, params.index_json);
    }

    async persistArchive(params) {
        //await this._provider.assets.storeArchiveObject(params.uuid, params.archive_json);

        if (params.contains === ARCHIVE_TYPE_FILES) {
            const {entries} = await unzip(params.content);

            for (const [name, entry] of Object.entries(entries)) {
                const filePath = `${UNPACKED_ARCHIVE_DIRECTORY}/${name.startsWith("/")? name.substring(1): name}`;
                const bytes = await entry.arrayBuffer();
                await this._provider.assets.storeArchiveFile(params.uuid, bytes, filePath);
            }

            return this._provider.assets.storeArchiveContent(params.uuid, params.content);
        }
        else
            return this._provider.assets.storeArchiveContent(params.uuid, params.content);
    }

    async getArchiveSize(params) {

    }

    async fetchArchiveContent(params) {
        const node = params.node;
        //archive = archive || await this._provider.assets.fetchArchiveObject(params.uuid);

        let content = await this._provider.assets.fetchArchiveContent(params.uuid);

        //archive = JSON.parse(archive);

        if (!node.contains || node.contains === ARCHIVE_TYPE_TEXT) {
            const decoder = new TextDecoder();
            content = decoder.decode(content);
        }

        return content;
    }

    async fetchArchiveFile(params) {
        const fileName = `${UNPACKED_ARCHIVE_DIRECTORY}/${params.file}`;
        let content = await this._provider.assets.fetchArchiveFile(params.uuid, fileName);

        if (content) {
            const decoder = new TextDecoder();
            content = decoder.decode(content);
        }

        return content;
    }

    async persistNotesIndex(params) {
        return this._provider.assets.storeNotesIndex(params.uuid, params.index_json);
    }

    async persistNotes(params) {
        return this._provider.assets.storeNotes(params.uuid, params.notes_json);
    }

    async fetchNotes(params) {
        const json = await this._provider.assets.fetchNotes(params.uuid);
        if (json)
            return JSON.parse(json);
    }

    async persistCommentsIndex(params) {
        return this._provider.assets.storeCommentsIndex(params.uuid, params.index_json);
    }

    async persistComments(params) {
        return this._provider.assets.storeComments(params.uuid, params.comments_json);
    }

    async fetchComments(params) {
        const json = await this._provider.assets.fetchComments(params.uuid);
        if (json)
            return JSON.parse(json);
    }
}

