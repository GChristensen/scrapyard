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
import {CLOUD_CONCURRENCY, CloudError} from "./cloud_client_base.js";
import {StorageProxy} from "./storage_proxy.js";
import {UnmarshallerCloud} from "./marshaller_cloud.js";

const CLOUD_SYNC_ALARM_NAME = "cloud-sync-alarm";
const CLOUD_SYNC_ALARM_PERIOD = 60;
// the number of nodes which content is downloaded simultaneously during reconciliation
const CLOUD_SYNC_CONCURRENCY = CLOUD_CONCURRENCY;

export const CLOUD_ERROR_MESSAGE = "Error accessing cloud.";

export class CloudShelfPlugin {
    constructor() {
    }

    initialize() {
        for (const client of [dropboxClient, oneDriveClient]) {
            client.initialize();
            client.onIndexPersisted = (previous, current) => this._onIndexPersisted(previous, current);
        }

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
        try {
            await this._provider.reset();
        }
        catch (e) {
            console.error(e);
            showNotification(e instanceof CloudError? e.message: CLOUD_ERROR_MESSAGE);
        }
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

    // the modification time of the cloud shelf node is the modification time of the last reconciled cloud index
    _isSameModificationTime(date1, date2) {
        return (date1?.getTime() ?? null) === (date2?.getTime() ?? null);
    }

    async _setReconciledModificationTime(cloudShelfNode, lastModified) {
        cloudShelfNode.date_modified = lastModified || null;
        await Node.idb.update(cloudShelfNode, false);
    }

    // the index persisted by this browser does not need to be reconciled, unless it contained
    // changes from elsewhere that have not been reconciled yet
    async _onIndexPersisted(previousModified, currentModified) {
        const cloudShelfNode = await Node.get(CLOUD_SHELF_ID);

        if (cloudShelfNode && this._isSameModificationTime(cloudShelfNode.date_modified, previousModified))
            await this._setReconciledModificationTime(cloudShelfNode, currentModified);
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

            let remoteLastModified;
            try {
                remoteLastModified = await this.getRemoteLastModified();
            }
            catch (e) {
                console.error(e);
                if (verbose)
                    showNotification(e instanceof CloudError? e.message: CLOUD_ERROR_MESSAGE);
                return;
            }

            if (this._isSameModificationTime(cloudShelfNode.date_modified, remoteLastModified))
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
                const failures = await this._unmarshalObjects(objects);

                // the index is reconciled again on the next synchronization if some items have failed
                if (failures)
                    console.error(`cloud reconciliation: ${failures} item(s) have failed`);
                else
                    await this._setReconciledModificationTime(cloudShelfNode, remoteDB.lastModified);

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

    // node content is downloaded concurrently, but nodes are stored in order, so parents are stored before children
    async _unmarshalObjects(objects) {
        const progressCounter = new ProgressCounter(objects.length, "cloudSyncProgress");
        const pending = [];
        let failures = 0;

        const storeNext = async () => {
            const {prepared, error} = await pending.shift();

            try {
                if (error)
                    throw error;

                await this._unmarshaller.store(prepared);
                progressCounter.incrementAndNotify();
            }
            catch (e) {
                failures += 1;
                console.error(e);
            }
        };

        for (const object of objects) {
            pending.push(this._unmarshaller.prepare(this._provider, object)
                .then(prepared => ({prepared}), error => ({error})));

            if (pending.length >= CLOUD_SYNC_CONCURRENCY)
                await storeNext();
        }

        while (pending.length)
            await storeNext();

        progressCounter.finish();

        return failures;
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
