import {receive, send} from "./proxy.js";
import {settings} from "./settings.js";
import {dropboxClient} from "./cloud_client_dropbox.js";
import {oneDriveClient} from "./cloud_client_onedrive.js";
import {
    CLOUD_EXTERNAL_TYPE,
    CLOUD_SHELF_ID,
    CLOUD_SHELF_NAME,
    NODE_TYPE_SHELF,
    isContainerNode, CLOUD_SHELF_UUID
} from "./storage.js";
import {CONTEXT_BACKGROUND, getContextType, showNotification} from "./utils_browser.js";
import {ExternalNode} from "./storage_node_external.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import {Node} from "./storage_entities.js";
import {ProgressCounter, sleep} from "./utils.js";
import {CloudError} from "./cloud_client_base.js";
import {StorageProxy} from "./storage_proxy.js";
import {UnmarshallerCloud} from "./marshaller_cloud.js";

const CLOUD_SYNC_ALARM_NAME = "cloud-sync-alarm";
const CLOUD_SYNC_ALARM_PERIOD = 60;

export const CLOUD_ERROR_MESSAGE = "Error accessing cloud.";

export class CloudShelfPlugin {
    constructor() {
    }

    initialize() {
        dropboxClient.initialize();
        oneDriveClient.initialize();
        this.selectProvider(settings.active_cloud_provider())
        this._unmarshaller = new UnmarshallerCloud();
    }

    selectProvider(providerID) {
        if (providerID === oneDriveClient.ID)
            this._provider = oneDriveClient;
        else
            this._provider = dropboxClient;

        StorageProxy.setCloudProvider(this._provider);
    }

    async reset() {
        await this._provider.reset();
    }

    newCloudRootNode() {
        return {id: CLOUD_SHELF_ID,
                pos: -2,
                name: CLOUD_SHELF_NAME,
                uuid: CLOUD_SHELF_UUID,
                type: NODE_TYPE_SHELF,
                external: CLOUD_EXTERNAL_TYPE};
    }

    getRemoteLastModified() {
        return this._provider.getLastModified();
    }

    async withCloudDB(f, fe) {
        try {
            let db = await this._provider.downloadDB();
            await f(db);
            await this._provider.persistDB(db);
        }
        catch (e) {
            console.error(e);
            if (fe) fe(e);
        }
    }

    isAuthenticated() {
        return this._provider.isAuthenticated();
    }

    authenticate() {
        return this._provider.authenticate();
    }

    signOut() {
        return this._provider.signOut();
    }

    async createBookmarkFolder(node, parent) {
        if (settings.cloud_enabled())
            return this.createBookmark(node, parent);
    }

    async createBookmark(node, parent) {
        if (settings.cloud_enabled())
            await this._createBookmarkInternal(node, parent)
    }

    async _createBookmarkInternal(node) {
        try {
            node.external = CLOUD_EXTERNAL_TYPE;
            node.external_id = node.uuid;
            await Node.idb.update(node);
        }
        catch (e) {
            console.error(e);
        }
    }

    async moveBookmarks(dest, nodes) {
        if (!settings.cloud_enabled())
            return;

        this._checkForReconciliation();

        let cloudNodes = nodes.filter(n => n.external === CLOUD_EXTERNAL_TYPE);
        let otherNodes = nodes.filter(n => n.external !== CLOUD_EXTERNAL_TYPE);

        // the source content is deleted only after it has been copied, so a failed read does not lose it
        if (dest.external === CLOUD_EXTERNAL_TYPE) {
            try {
                for (const n of otherNodes) {
                    if (isContainerNode(n)) {
                        return await Bookmark.traverse(n, async (parent, node) => {
                            await this._moveNodeToCloud(dest, node);
                            await this._createBookmarkInternal(node);
                        });
                    }
                    else {
                        await this._moveNodeToCloud(dest, n);
                        await this._createBookmarkInternal(n);
                    }
                }
            }
            catch (e) {
                showNotification(`Can not move items to the cloud: ${e.message}`);
                throw e;
            }
        } else {
            for (const n of otherNodes) {
                try {
                    if (isContainerNode(n)) {
                        await Bookmark.traverse(n, async (parent, node) => {
                            await this._moveNodeToDisk(dest, node);
                        });
                    }
                    else {
                        await this._moveNodeToDisk(dest, n);
                    }
                }
                catch (e) {
                    console.error(e);
                    showNotification(`Can not move items from the cloud: ${e.message}`);
                }
            }
        }
    }

    _checkForReconciliation() {
        if (this._reconciling) {
            const error = new Error("Adding bookmarks during cloud reconciliation.");
            error.name = "EScrapyardPluginError";
            showNotification("Please wait until refresh is finished.");
            throw error;
        }
    }

    async _moveNodeToCloud(dest, storedNode) {
        const nodeJSON = JSON.stringify(storedNode);
        await this._provider.assets.storeNode(storedNode.uuid, nodeJSON);
        const cloudNode = {...storedNode};
        cloudNode.external = CLOUD_EXTERNAL_TYPE;
        await Bookmark.copyContent(storedNode, cloudNode);
        return Node.unpersist(storedNode);
    }

    async _moveNodeToDisk(dest, cloudNode) {
        const storedNode = {...cloudNode};
        storedNode.external = dest.external;
        await Bookmark.copyContent(cloudNode, storedNode);
        await Node.unpersist(cloudNode);
        cloudNode.external = dest.external;
    }

    async beforeBookmarkCopied(dest, node) {
        this._checkForReconciliation();

        if (dest.external !== CLOUD_EXTERNAL_TYPE && node.external === CLOUD_EXTERNAL_TYPE) {
            if (dest.external)
                node.external = dest.external;
            else
                delete node.external;
            delete node.external_id;
        }
        else if (dest.external === CLOUD_EXTERNAL_TYPE && node.external !== CLOUD_EXTERNAL_TYPE) {
            node.external = CLOUD_EXTERNAL_TYPE;
            node.external_id = node.uuid;
        }
    }

    async _isRemoteDBModified(cloudShelfNode) {
        const remoteLastModified = await this.getRemoteLastModified();
        const modified = cloudShelfNode.date_modified?.getTime() !== remoteLastModified?.getTime();

        if (modified) {
            cloudShelfNode.date_modified = remoteLastModified;
            await Node.idb.update(cloudShelfNode, false);
        }

        return modified;
    }

    async createCloudShelf() {
        const node = this.newCloudRootNode();
        Node.resetDates(node);
        return Node.idb.import(node);
    }

    async createIfMissing() {
        if (!await Node.get(CLOUD_SHELF_ID))
            return this.createCloudShelf();
    }

    // should only be called in the background script through a message
    async reconcileCloudBookmarksDB(verbose) {
        if (this._reconciling || settings.transition_to_disk())
            return;

        this._reconciling = true;
        try {
            await this._reconcileCloudBookmarksDB(verbose);
        }
        finally {
            this._reconciling = false;
        }
    }

    async _reconcileCloudBookmarksDB(verbose) {
        await settings.load();

        if (settings.cloud_enabled()) {
            let beginTime = Date.now();
            let cloudShelfNode = await Node.get(CLOUD_SHELF_ID);

            if (!cloudShelfNode) {
                cloudShelfNode = await this.createCloudShelf();
                try {await send.shelvesChanged()} catch (e) {console.error(e)}
            }

            if (!await this._isRemoteDBModified(cloudShelfNode))
                return;

            send.cloudSyncStart();

            try {
                const remoteDB = await this._provider.downloadDB();
                let remoteIDs = remoteDB.nodes.map(n => {
                    n.external_id = n.uuid;
                    n.external = CLOUD_EXTERNAL_TYPE;
                    return n.external_id;
                });

                await ExternalNode.idb.deleteMissingIn(remoteIDs, CLOUD_EXTERNAL_TYPE);

                const objects = remoteDB.sortedNodes;
                const progressCounter = new ProgressCounter(objects.length, "cloudSyncProgress");
                for (const object of objects)
                    try {
                        await this._unmarshaller.unmarshal(this._provider, object);
                        progressCounter.incrementAndNotify();
                    }
                    catch (e) {
                        console.error(e);
                    }
                progressCounter.finish();

                console.log("cloud reconciliation time: " + ((new Date().getTime() - beginTime) / 1000) + "s");

                send.cloudSyncEnd();
                send.externalNodesReady();
            }
            catch (e) {
                if (e instanceof CloudError)
                    showNotification(e.message)
                else
                    showNotification(CLOUD_ERROR_MESSAGE);

                send.cloudSyncEnd();
                console.error(e);
            }
        }
        else {
            await ExternalNode.idb.delete(CLOUD_EXTERNAL_TYPE);
            send.shelvesChanged();
        }
    }

    async enableBackgroundSync(enable) {
        if (enable) {
            const alarm = await browser.alarms.get(CLOUD_SYNC_ALARM_NAME);
            if (!alarm)
                browser.alarms.create(CLOUD_SYNC_ALARM_NAME, {periodInMinutes: CLOUD_SYNC_ALARM_PERIOD});
        }
        else {
            browser.alarms.clear(CLOUD_SYNC_ALARM_NAME);
        }
    }
}

export let cloudShelf = new CloudShelfPlugin();

if (getContextType() === CONTEXT_BACKGROUND) {
    browser.alarms.onAlarm.addListener(alarm => {
        if (alarm.name === CLOUD_SYNC_ALARM_NAME)
            cloudShelf.reconcileCloudBookmarksDB();
    });

    receive.cloudProviderChanged = message => {
        cloudShelf.selectProvider(message.provider);
    };
}
