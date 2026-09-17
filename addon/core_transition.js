import {EVERYTHING_SHELF_NAME, NODE_TYPE_ARCHIVE, CLOUD_SHELF_NAME, CLOUD_SHELF_ID} from "./storage.js";
import {Node, Archive, Comments, Icon, Notes} from "./storage_entities.js";
import {HELPER_APP_v2_IS_REQUIRED, helperApp} from "./helper_app.js";
import {showNotification} from "./utils_browser.js";
import {receive, send} from "./proxy.js";
import {Export} from "./import.js";
import {ProgressCounter} from "./utils.js";
import {settings} from "./settings.js";
import {Query} from "./storage_query.js";
import UUID from "./uuid.js";
import {DiskStorage} from "./storage_external.js";
import {indexHTML} from "./utils_html.js";

receive.transferContentToDisk = async message => {
    if (!helperApp.dataPath()) {
        showNotification("Data folder path is not set.");
        return;
    }

    const helper = await helperApp.hasVersion("2.0", HELPER_APP_v2_IS_REQUIRED);

    if (!helper)
        return;

    send.startProcessingIndication({noWait: true});

    const nodes = await collectNodes();
    const progressCounter = new ProgressCounter(nodes.length, "exportProgress");

    try {
        await DiskStorage.openBatchSession();

        for (const node of nodes) {
            await transferNode(node);
            progressCounter.incrementAndNotify();
        }

        await settings.transition_to_disk(false);
        showNotification("Content transfer finished.");
        return true;
    } catch (e) {
        console.error(e);
        showNotification("Content transfer finished with errors.");
        return false;
    }
    finally {
        await DiskStorage.closeBatchSession();
        send.stopProcessingIndication();
        await progressCounter.finish();
    }
};

async function collectNodes() {
    let nodes = await Export.nodes(EVERYTHING_SHELF_NAME);

    if (settings.cloud_enabled()) {
        let cloudShelf = await Node.get(CLOUD_SHELF_ID);

        if (cloudShelf) {
            const cloudNodes = await Query.fullSubtree(cloudShelf.id);
            cloudShelf = cloudNodes.find(n => n.id === CLOUD_SHELF_ID);

            for (const cloudNode of cloudNodes) {
                delete cloudNode.external;
                delete cloudNode.external_id;
            }

            cloudShelf.uuid = UUID.numeric();
            cloudShelf.name = CLOUD_SHELF_NAME + " (transferred)";
            cloudShelf.date_modifed = cloudShelf.date_added;

            nodes = [...nodes, ...cloudNodes];
        }
    }

    return nodes;
}

async function transferNode(node) {
    // awaited: the nodes should reach the storage in the tree order, parents first
    await Node.put(node);

    if (node.stored_icon) {
        let icon = await Icon.idb.import.get(node);
        if (icon)
            await Icon.add(node, icon);
    }

    if (node.type === NODE_TYPE_ARCHIVE) {
        let archive = await Archive.idb.import.get(node);

        if (archive) {
            if (!archive.byte_length) {
                const content = await Archive.reify(archive);
                const index = indexHTML(content);
                await Archive.storeIndex(node, index);
            }

            await Archive.add(node, archive);
        }
    }

    if (node.has_notes) {
        let notes = await Notes.idb.import.get(node);
        if (notes)
            await Notes.add(node, notes);
    }

    if (node.has_comments) {
        let comments = await Comments.idb.import.get(node);
        if (comments)
            await Comments.add(node, comments);
    }
}
