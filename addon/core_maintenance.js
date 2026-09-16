import {receive, send, sendLocal} from "./proxy.js";
import {
    isContentNode,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK,
    NODE_TYPE_NOTES,
    DEFAULT_SHELF_UUID
} from "./storage.js";
import {cloudShelf} from "./plugin_cloud_shelf.js";
import {filesShelf} from "./plugin_files_shelf.js";
import {Node} from "./storage_entities.js";
import {Database} from "./storage_database.js";
import {settings} from "./settings.js";
import {helperApp} from "./helper_app.js";
import {Export} from "./import.js";
import {FORMAT_DEFAULT_SHELF_UUID, UnmarshallerJSONScrapbook} from "./marshaller_json_scrapbook.js";
import {isDeepEqual} from "./utils.js";
import {browserShelf} from "./plugin_browser_shelf.js";
import {clearStorageDivergence} from "./storage_divergence.js";

receive.resetCloud = async message => {
    if (!cloudShelf.isAuthenticated())
        return false;

    send.startProcessingIndication({noWait: true});

    await cloudShelf.reset();

    send.stopProcessingIndication();

    return true;
}

receive.resetScrapyard = async message => {
    send.startProcessingIndication({noWait: true});

    await Database.wipeEverything();
    await settings.last_sync_date(null);
    await clearStorageDivergence();

    if (settings.enable_files_shelf())
        await filesShelf.createIfMissing();

    if (settings.cloud_enabled())
        await cloudShelf.createIfMissing();

    if (settings.show_firefox_bookmarks())
        /*await*/ browserShelf.reconcileBrowserBookmarksDB();

    send.stopProcessingIndication();

    if (!settings.storage_mode_internal())
        return sendLocal.performSync();
}

receive.computeStatistics = async message => {
    let items = 0;
    let bookmarks = 0;
    let archives = 0;
    let notes = 0
    let size = 0;

    send.startProcessingIndication();

    await Node.iterate(node => {
        if (isContentNode(node))
            items += 1;

        if (node.type === NODE_TYPE_BOOKMARK)
            bookmarks += 1;

        if (node.type === NODE_TYPE_ARCHIVE) {
            archives += 1;
            size += node.size || 0;
        }

        if (node.type === NODE_TYPE_NOTES) {
            notes += 1;
            size += node.size || 0;
        }
    });

    send.stopProcessingIndication();

    return {items, bookmarks, archives, notes, size};
}

receive.getOrphanedItems = async message => {
    const helper = await helperApp.probe(true);

    if (helper) {
        await settings.load();
        const params = {data_path: helperApp.dataPath()};
        return await helperApp.fetchJSON_postJSON("/storage/get_orphaned_items", params);
    }
};

receive.rebuildItemIndex = async message => {
    const helper = await helperApp.probe(true);

    if (helper) {
        await settings.load();
        const params = {data_path: helperApp.dataPath()};
        return await helperApp.postJSON("/storage/rebuild_item_index", params);
    }
};

receive.compareDatabaseStorage = async message => {
    const helper = await helperApp.probe(true);

    if (helper) {
        await settings.load();
        const params = {data_path: helperApp.dataPath()};
        const storedNodes = await helperApp.fetchJSON_postJSON("/storage/debug_get_stored_node_instances", params);
        const nodes = await Export.nodes("everything");
        const unmarshaller = new UnmarshallerJSONScrapbook();

        const idbKeys = new Set(nodes.map(n => n.uuid === DEFAULT_SHELF_UUID? FORMAT_DEFAULT_SHELF_UUID: n.uuid));
        const storageKeys = new Set(Object.keys(storedNodes));

        let result = idbKeys.size === storageKeys.size && [...idbKeys].every(x => storageKeys.has(x));

        if (!result) {
            for (const node of [...nodes]) {
                if (node.uuid === DEFAULT_SHELF_UUID)
                    node.uuid = FORMAT_DEFAULT_SHELF_UUID;

                if (storedNodes[node.uuid]) {
                    nodes.splice(nodes.indexOf(node), 1);
                    delete storedNodes[node.uuid];
                }
            }

            console.log("Nodes only in IDB:");
            console.log(nodes);
            console.log("Nodes only in storage:")
            console.log(storedNodes);

            return result;
        }

        for (const node of nodes) {
            if (node.uuid === DEFAULT_SHELF_UUID)
                continue;

            const storedObjects = storedNodes[node.uuid];

            if (storedObjects) {
                let indexItem = unmarshaller.unconvertNode(storedObjects.db_item);
                indexItem = unmarshaller.deserializeNode(indexItem);
                await unmarshaller.findParentInIDB(indexItem)

                let objectItem = unmarshaller.unconvertNode(storedObjects.object_item);
                objectItem = unmarshaller.deserializeNode(objectItem);
                await unmarshaller.findParentInIDB(objectItem)

                delete node.id;
                delete node.icon;
                delete node.tag_list;

                if (node.tags === "")
                    delete node.tags;

                if (!isDeepEqual(node, indexItem, true) || !isDeepEqual(node, objectItem, true)) {
                    console.log("Objects do not match:\nIDB object:");
                    console.log(node);
                    console.log("Index object:");
                    console.log(indexItem);
                    console.log("File object:");
                    console.log(objectItem);

                    result = false;
                }
            }
            else {
                console.log("No corresponding storage item for object:");
                console.log(node);

                result = false;
            }
        }

        return result;
    }
};
