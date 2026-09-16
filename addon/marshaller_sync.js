import {Archive, Comments, Icon, Node, Notes} from "./storage_entities.js";
import {
    FORMAT_DEFAULT_SHELF_UUID,
    MarshallerJSONScrapbook,
    UnmarshallerJSONScrapbook
} from "./marshaller_json_scrapbook.js";
import {helperApp} from "./helper_app.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import {settings} from "./settings.js";
import {DEFAULT_SHELF_UUID, nodeHasSomeContent} from "./storage.js";


export class MarshallerSync extends MarshallerJSONScrapbook {
    _id2uuid = new Map();

    createSyncNode(node) {
        const syncNode = {
            id: node.id,
            uuid: node.uuid,
            parent_id: node.parent_id,
            date_modified: node.date_modified,
            content_modified: node.content_modified
        };

        if (syncNode.date_modified && syncNode.date_modified instanceof Date)
            syncNode.date_modified = syncNode.date_modified.getTime();
        else
            syncNode.date_modified = 0;

        if (!node.content_modified && nodeHasSomeContent(node))
            syncNode.content_modified = syncNode.date_modified;
        else if (syncNode.content_modified)
            syncNode.content_modified = syncNode.content_modified.getTime();

        this._id2uuid.set(syncNode.id, syncNode.uuid);

        if (syncNode.parent_id) {
            syncNode.parent = this._id2uuid.get(syncNode.parent_id);
            delete syncNode.parent_id;
        }
        delete syncNode.id;

        if (syncNode.uuid === DEFAULT_SHELF_UUID)
            syncNode.date_modified = 0;

        this.convertUUIDsToFormat(syncNode);

        return syncNode;
    }

//     async marshal(syncNode) {
//         const node = await Node.getByUUID(syncNode.uuid);
//         await this._resetExportedNodeDates(syncNode, node);
//
//         let content;
//         let exportedNode;
//
//         if (syncNode.push_content) {
//             content = await this.serializeContent(node);
//             exportedNode = content.node;
//         }
//         else
//             exportedNode = this.serializeNode(node);
//
//         delete exportedNode.id;
//         exportedNode.parent_id = syncNode.parent_id;
//
//         const payload = {node: JSON.stringify(exportedNode)};
//
//         if (!this.isContentEmpty(content))
//             payload.content = this._serializeExportedContent(content);
//
//         const resp = await this._backend.post("/sync/push_node", payload);
//
//         if (!resp.ok)
//             throw new Error(`Sync marshaling HTTP error: ${resp.status}`);
//     }
//
//     async _resetExportedNodeDates(syncNode, node) {
//         if (this._initial) {
//             // reset the date_modified to force import by other clients
//             // of the nodes merged at the initial synchronization
//             node.date_modified = new Date();
//             if (node.content_modified || syncNode.content_modified)
//                 node.content_modified = node.date_modified;
//
//             await Node.update(node, false);
//         }
//
//         if (node.uuid === DEFAULT_SHELF_UUID) {
//             node.date_added = 0;
//             node.date_modified = 0;
//         }
//     }
//
//     _serializeExportedContent(content) {
//         let result;
//
//         const header = {sync: "Scrapyard", version: <!!!!!>};
//         result = JSON.stringify(header);
//
//         if (content.icon)
//             result += "\n" + JSON.stringify({icon: content.icon});
//         else
//             result += "\n{}";
//
//         delete content.node;
//         delete content.icon;
//         if (Object.keys(content).length)
//             result += "\n" + JSON.stringify(content);
//
//         return result;
//     }
}

export class UnmarshallerSync extends UnmarshallerJSONScrapbook {
    constructor() {
        super();
        this.setSyncMode();
    }

    async unmarshall(syncNodes) {
        const payload = await helperApp.fetchJSON_postJSON("/storage/sync_pull_objects", {
            data_path: helperApp.dataPath(),
            sync_nodes: JSON.stringify(syncNodes)
        });

        let success = true;

        for (const object of payload)
            try {
                await this.unmarshallNode(object);
            } catch (e) {
                success = false;
                console.error(e);
            }

        return success;
    }

    async unmarshallNode(object) {
        if (!object.item || object.item.uuid === FORMAT_DEFAULT_SHELF_UUID)
            return;

        let {item: node, icon, comments, archive_index, notes_index} = object;

        node = await this.unconvertNode(node);
        node = this.deserializeNode(node);
        await this.findParentInIDB(node);

        if (icon) {
            icon = this.unconvertIcon(icon);
            node.icon = await Icon.computeHash(icon.data_url);
        }

        node = await Bookmark.idb.import(node, this._sync);

        if (icon)
            await Icon.idb.import.add(node, icon.data_url);

        if (comments) {
            comments = this.unconvertComments(comments);
            await Comments.idb.import.add(node, comments.text);
        }

        if (archive_index) {
            archive_index = this.unconvertIndex(archive_index);
            await Archive.idb.import.storeIndex(node, archive_index.words);
        }

        if (notes_index) {
            notes_index = this.unconvertIndex(notes_index);
            await Notes.idb.import.storeIndex(node, notes_index.words);
        }
    }
}
