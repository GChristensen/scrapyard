import IDBStorage from "./storage_idb.js";
import {indexWords} from "./utils_html.js";
import {notes2html} from "./notes_render.js";
import {
    CLOUD_SHELF_ID,
    DEFAULT_POSITION, DEFAULT_SHELF_ID,
    DONE_SHELF_NAME, ENTITY_BLOB, ENTITY_COMMENTS, ENTITY_COMMENTS_INDEX, ENTITY_EXPORT_ITEM, ENTITY_ICON, ENTITY_INDEX,
    ENTITY_NODE, ENTITY_NOTES, ENTITY_NOTES_INDEX, FIREFOX_SHELF_ID,
    isContainer, NODE_TYPE_GROUP, NODE_TYPE_SHELF, NODE_TYPE_UNLISTED,
    sanitizeNode,
    TODO_SHELF_NAME,
    TODO_STATE_DONE
} from "./storage.js";
import UUID from "./lib/uuid.js";

export default class BookmarkStorage {
    constructor(type) {
        switch (type) {
            case IDBStorage.STORAGE_TYPE_ID:
                this.db = new IDBStorage();
                break;
        }
    }

    async addNode(node, resetOrder = true, resetDates = true, newUUID = true) {
        if (resetOrder)
            node.pos = DEFAULT_POSITION;

        if (newUUID)
            node.uuid = UUID.numeric();

        if (resetDates) {
            node.date_added = new Date();
            node.date_modified = node.date_added;
        }

        node.id = await this.db.add(ENTITY_NODE, sanitizeNode(node));
        return node;
    }

    isNodeExists(uuid) {
        return this.db.existsBy(ENTITY_NODE, "uuid", uuid);
    }

    getNode(id, isUUID = false) {
        if (isUUID)
            return this.db.getBy(ENTITY_NODE, "uuid", id);
        else
            return this.db.get(ENTITY_NODE, id);
    }

    getNodes(ids) {
        return this.db.getAll(ENTITY_NODE, ids)
    }

    getNodeIds() {
        return this.db.getIds(ENTITY_NODE);
    }

    getExternalNode(externalId, kind) {
        return this.db.getBy2(ENTITY_NODE, "external_id", externalId, "external", kind);
    }

    getExternalNodes(kind) {
        return this.db.getAllBy(ENTITY_NODE, "external", kind);
    }

    // async isExternalNodeExists(externalId, kind) {
    //     return this.db.existsBy2(ENTITY_NODE, "external_id", externalId, "external", kind);
    // }

    async deleteExternalNodes(kind) {
        return this.deleteNodesLowLevel(await this.db.getIdsBy(ENTITY_NODE, "external", kind));
    }

    async deleteMissingExternalNodes(externalIds, kind) {
        return this.deleteNodesLowLevel(await this.db.getMissingIdsBy2(ENTITY_NODE, "external", kind, "external_id", externalIds));
    }

    getChildNodes(id) {
        return this.db.getAllBy(ENTITY_NODE, "parent_id", id);
    }

    async updateNodes(nodes, ids) {
        if (typeof nodes === "function") {
            const postprocess = node => {
                nodes(node)
                node.date_modified = new Date();
                sanitizeNode(node);
            };

            await this.db.modifyAll(ENTITY_NODE, ids, postprocess);
        }
        else {
            for (let node of nodes) {
                node.date_modified = new Date();
                await this.db.modify(ENTITY_NODE, sanitizeNode(node));
            }
        }
    }

    async updateNode(node, resetDate = true) {
        if (node?.id) {
            if (resetDate)
                node.date_modified = new Date();
            await this.db.update(ENTITY_NODE, sanitizeNode(node));
        }
        return node;
    }

    iterateNodes(iterator, filter) {
        return this.db.iterate(ENTITY_NODE, iterator, filter);
    }

    filterNodes(filter) {
        return this.db.filter(ENTITY_NODE, filter);
    }

    async _selectAllChildrenOf(node, children, preorder, level) {
        let directChildren = await this.db.getAllBy(ENTITY_NODE, "parent_id", node.id);

        if (directChildren.length) {
            if (preorder)
                directChildren.sort((a, b) => a.pos - b.pos);

            for (let child of directChildren) {
                if (level !== undefined)
                    child.__level = level;

                children.push(child);

                if (isContainer(child))
                    await this._selectAllChildrenOf(child, children, preorder, level !== undefined? level + 1: undefined);
            }
        }
    }

    async queryFullSubtree(ids, return_ids, preorder, level) {
        if (!Array.isArray(ids))
            ids = [ids];

        let nodes = await this.getNodes(ids);
        let children = [];

        if (preorder)
            nodes.sort((a, b) => a.pos - b.pos);

        for (let node of nodes) {
            if (node) {
                if (level !== undefined)
                    node.__level = level;

                children.push(node);

                if (isContainer(node))
                    await this._selectAllChildrenOf(node, children, preorder, level !== undefined? level + 1: undefined);
            }
        }

        if (children.length && return_ids)
            return children.map(n => n.id);

        return children;
    }

    async _selectDirectChildrenIdsOf(id, children) {
        await this.db.getIdsBy(ENTITY_NODE, "parent_id", id, children);
    }

    async _selectAllChildrenIdsOf(id, children) {
        let directChildren = await this.db.getAllBy(ENTITY_NODE, "parent_id", id);
        directChildren = directChildren.map(n => [n.id, isContainer(n)]);

        if (directChildren.length) {
            for (let child of directChildren) {
                children.push(child[0]);
                if (child[1])
                    await this._selectAllChildrenIdsOf(child[0], children);
            }
        }
    }

    async queryFullSubtreeIds(ids) {
        if (!Array.isArray(ids))
            ids = [ids];

        let children = [];

        for (let id of ids) {
            children.push(id);
            await this._selectAllChildrenIdsOf(id, children);
        }

        return children;
    }

    async queryNodes(group, options) {
        let {search, tags, date, date2, period, types, path, limit, depth, order} = options;
        let searchrx = search? new RegExp(search, "i"): null;
        let subtree;

        const todoShelf = path?.toUpperCase() === TODO_SHELF_NAME;
        const doneShelf = path?.toUpperCase() === DONE_SHELF_NAME;

        if (group) {
            subtree = [];

            if (depth === "group")
                await this._selectDirectChildrenIdsOf(group.id, subtree);
            else if (depth === "root+subtree") {
                await this._selectAllChildrenIdsOf(group.id, subtree);
                subtree.push(group.id);
            }
            else // "subtree"
                await this._selectAllChildrenIdsOf(group.id, subtree);
        }

        if (date) {
            date = (new Date(date)).getTime();
            date2 = (new Date(date2)).getTime();
            if (isNaN(date))
                date = null;
            if (isNaN(date2))
                date2 = null;
            if (date && (period === "before" || period === "after"))
                period = period === "after" ? 1 : -1;
            else if (date && date2 && period === "between")
                period = 2;
            else
                period = 0;
        }

        let filterf = node => {
            let result = path && !todoShelf && !doneShelf? !!group: true;

            if (types)
                result = result && types.some(t => t == node.type);

            if (todoShelf)
                result = result && node.todo_state && node.todo_state < TODO_STATE_DONE;
            else if (doneShelf)
                result = result && node.todo_state && node.todo_state >= TODO_STATE_DONE;

            if (search)
                result = result && (searchrx.test(node.name) || searchrx.test(node.uri));
            else if (tags) {
                if (node.tag_list) {
                    let intersection = tags.filter(value => node.tag_list.some(t => t.startsWith(value)));
                    result = result && intersection.length > 0;
                }
                else
                    result = false;
            }
            else if (date) {
                const nodeMillis = node.date_added?.getTime? node.date_added.getTime(): undefined;

                if (nodeMillis) {
                    let nodeDate = new Date(nodeMillis);
                    nodeDate.setUTCHours(0, 0, 0, 0);
                    nodeDate = nodeDate.getTime();

                    if (period === 0)
                        result = result && date === nodeDate;
                    else if (period === 1)
                        result = result && date < nodeDate;
                    else if (period === -1)
                        result = result && date > nodeDate;
                    else if (period === 2)
                        result = result && nodeDate >= date && nodeDate <= date2;
                }
                else
                    result = false;
            }

            return result;
        };

        let nodes;

        if (subtree)
            nodes = await this.db.filterIds(ENTITY_NODE, filterf, subtree, limit);
        else
            nodes = await this.db.filter(ENTITY_NODE, filterf, limit);

        if (order === "custom")
            nodes.sort((a, b) => a.pos - b.pos);

        return nodes;
    }

    // returns nodes containing only the all given words
    async filterByContent(ids, words, index) {
        let indexType = ENTITY_INDEX;
        let matches = {};
        let allMatchedNodes = [];
        let wordCount = {};

        switch (index) {
            case "notes":
                indexType = ENTITY_NOTES_INDEX;
                break;
            case "comments":
                indexType = ENTITY_COMMENTS_INDEX;
                break;
        }

        for (let word of words) {
            let matched_nodes = matches[word] = await this.db.queryIndex(indexType, "words", word, "node_id", ids);

            allMatchedNodes = [...allMatchedNodes, ...matched_nodes]
                .filter((w, i, a) => a.indexOf(w) === i); // distinct
        }

        for (let n of allMatchedNodes) {
            wordCount[n] = 0;

            for (let word of words) {
                if (matches[word].some(i => i === n))
                    wordCount[n] += 1;
            }
        }

        if (ids)
            return this.getNodes(ids.filter(id => wordCount[id] === words.length));
        else {
            let nodesWithAllWords = [];

            for (const [id, count] of Object.entries(wordCount)) {
                if (count === words.length)
                    nodesWithAllWords.push(parseInt(id));
            }

            return this.getNodes(nodesWithAllWords);
        }
    }

    async deleteNodesLowLevel(ids) {
        if (!Array.isArray(ids))
            ids = [ids];

        await this.db.deleteReferencedEntity(ENTITY_BLOB, "node_id", ids);
        await this.db.deleteReferencedEntity(ENTITY_ICON, "node_id", ids);
        await this.db.deleteReferencedEntity(ENTITY_INDEX, "node_id", ids);
        await this.db.deleteReferencedEntity(ENTITY_NOTES, "node_id", ids);
        await this.db.deleteReferencedEntity(ENTITY_NOTES_INDEX, "node_id", ids);
        await this.db.deleteReferencedEntity(ENTITY_COMMENTS, "node_id", ids);
        await this.db.deleteReferencedEntity(ENTITY_COMMENTS_INDEX, "node_id", ids);

        await this.db.deleteIds(ENTITY_NODE, ids);
    }

    async wipeEverything() {
        const retain = [DEFAULT_SHELF_ID, FIREFOX_SHELF_ID, CLOUD_SHELF_ID,
            ...(await this.queryFullSubtree(FIREFOX_SHELF_ID, true)),
            ...(await this.queryFullSubtree(CLOUD_SHELF_ID, true))];

        await this.db.wipeReferencedEntity(ENTITY_BLOB, "node_id", retain);
        await this.db.wipeReferencedEntity(ENTITY_ICON, "node_id", retain);
        await this.db.wipeReferencedEntity(ENTITY_INDEX, "node_id", retain);
        await this.db.wipeReferencedEntity(ENTITY_NOTES, "node_id", retain);
        await this.db.wipeReferencedEntity(ENTITY_NOTES_INDEX, "node_id", retain);
        await this.db.wipeReferencedEntity(ENTITY_COMMENTS, "node_id", retain);
        await this.db.wipeReferencedEntity(ENTITY_COMMENTS_INDEX, "node_id", retain);

        await this.db.wipeReferencedEntity(ENTITY_NODE, "id", retain);
    }

    async queryShelf(name) {
        if (name) {
            name = name.toLocaleUpperCase();
            return this.db.getByPredicate(ENTITY_NODE, "type", NODE_TYPE_SHELF,
                    n => !n.parent_id && name === n.name.toLocaleUpperCase())
        }
        else
            return this.db.getAllByPredicate(ENTITY_NODE, "type", NODE_TYPE_SHELF, n => !n.parent_id);
    }

    async queryUnlisted(name) {
        if (name) {
            name = name.toLocaleUpperCase();
            return this.db.getByPredicate(ENTITY_NODE, "type", NODE_TYPE_UNLISTED, n => name === n.name.toLocaleUpperCase())
        }
        else
            return this.db.getAllBy(ENTITY_NODE, "type", NODE_TYPE_UNLISTED);
    }

    queryGroup(parentId, name) {
        name = name.toLocaleUpperCase();
        return this.db.getByPredicate(ENTITY_NODE, "parent_id", parentId, n => name === n.name.toLocaleUpperCase())
    }

    async queryGroups(sort = false) {
        const nodes = await this.db.getAllByAnyOf(ENTITY_NODE, "type", [NODE_TYPE_SHELF, NODE_TYPE_GROUP]);

        if (sort)
            return nodes.sort((a, b) => a.pos - b.pos);

        return nodes;
    }

    queryTODO() {
        return this.db.getBelow(ENTITY_NODE, "todo_state", TODO_STATE_DONE);
    }

    queryDONE() {
        return this.db.getAboveOrEqual(ENTITY_NODE, "todo_state", TODO_STATE_DONE);
    }

    async storeIndex(nodeId, words) {
        return this.db.add(ENTITY_INDEX, {
            node_id: nodeId,
            words: words
        });
    }

    async updateIndex(nodeId, words) {
        if (await this.db.existsBy(ENTITY_INDEX, "node_id", nodeId))
            return this.db.modifyReferencedEntity(ENTITY_INDEX, "node_id", nodeId, {
                words: words
            });
        else
            return this.storeIndex(nodeId, words);
    }

    async fetchIndex(nodeId) {
        return this.db.getBy(ENTITY_INDEX, "node_id", nodeId);
    }

    // at first all objects were stored as plain strings
    // modern implementation stores objects in blobs
    async storeBlobLowLevel(nodeId, data, contentType, byteLength) {
        if (typeof data !== "string" && data.byteLength)
            byteLength = data.byteLength;
        else if (typeof data === "string" && byteLength) {
            let byteArray = new Uint8Array(byteLength);
            for (let i = 0; i < data.length; ++i)
                byteArray[i] = data.charCodeAt(i);
            data = byteArray;
        }

        let object = data instanceof Blob? data: new Blob([data], {type: contentType});

        let options = {
            node_id: nodeId,
            // data, // legacy string content, may present in existing records
            object, // new blob content
            byte_length: byteLength, // presence of this field indicates that the the object is binary
            type: contentType || "text/html"
        };

        await this.db.add(ENTITY_BLOB, options);

        const node = {id: nodeId, size: object.size, content_type: contentType};
        await this.updateNode(node);
    }

    // used only for text/html edited content
    async updateBlobLowLevel(nodeId, data) {
        const object = new Blob([data], {type: "text/html"});

        await this.db.modifyReferencedEntity(ENTITY_BLOB, "node_id", nodeId, {
            object,
            data: undefined // undefined removes fields from IDB
        });

        const node = {id: nodeId, size: object.size};
        await this.updateNode(node);
    }

    async storeIndexedBlob(nodeId, data, contentType, byteLength, index) {
        await this.storeBlobLowLevel(nodeId, data, contentType, byteLength);

        if (index?.words)
            await this.storeIndex(nodeId, index.words);
        else if (typeof data === "string" && !byteLength)
            await this.storeIndex(nodeId, indexWords(data));
    }

    async fetchBlob(nodeId) {
        return this.db.getBy(ENTITY_BLOB, "node_id", nodeId);
    }

    async deleteBlob(nodeId) {
        await this.db.deleteReferencedEntity(ENTITY_BLOB, "node_id", nodeId);
        await this.db.deleteReferencedEntity(ENTITY_INDEX, "node_id", nodeId);
    }

    async storeNotesLowLevel(options) {
        if (await this.db.existsBy(ENTITY_NOTES, "node_id", options.node_id))
            await this.db.modifyReferencedEntity(ENTITY_NOTES, "node_id", options.node_id, options);
        else
            await this.db.add(ENTITY_NOTES, options);

        await this.updateNode({id: options.node_id, has_notes: !!options.content});
    }

    async storeIndexedNotes(options) {
        await this.storeNotesLowLevel(options);

        if (options.content) {
            let words;

            if (options.format === "delta" && options.html)
                words = indexWords(options.html);
            else {
                if (options.format === "text")
                    words = indexWords(options.content, false);
                else {
                    let html = notes2html(options);
                    if (html)
                        words = indexWords(html);
                }
            }

            if (words)
                await this.updateNotesIndex(options.node_id, words);
            else
                await this.updateNotesIndex(options.node_id, []);
        }
        else
            await this.updateNotesIndex(options.node_id, []);
    }

    async fetchNotes(nodeId) {
        return this.db.getBy(ENTITY_NOTES, "node_id", nodeId);
    }

    async updateNotesIndex(nodeId, words) {
        if (await this.db.existsBy(ENTITY_NOTES_INDEX, "node_id", nodeId))
            return this.db.modifyReferencedEntity(ENTITY_NOTES_INDEX, "node_id", nodeId, {
                words: words
            });
        else
            return this.db.add(ENTITY_NOTES_INDEX, {
                node_id: nodeId,
                words: words
            });
    }

    async storeCommentsLowLevel(nodeId, comments) {
        if (!comments)
            comments = undefined;

        if (await this.db.existsBy(ENTITY_COMMENTS, "node_id", nodeId))
            await this.db.modifyReferencedEntity(ENTITY_COMMENTS, "node_id", nodeId, {comments});
        else
            await this.db.add(ENTITY_COMMENTS, {node_id: nodeId, comments});

        const node = {id: nodeId, has_comments: !!comments};
        await this.updateNode(node);
    }

    async storeIndexedComments(nodeId, comments) {
        await this.storeCommentsLowLevel(nodeId, comments);

        if (comments) {
            let words = indexWords(comments, false);
            await this.updateCommentIndex(nodeId, words);
        }
        else
            await this.updateCommentIndex(nodeId, []);
    }

    async fetchComments(nodeId) {
        let record = await this.db.getBy(ENTITY_COMMENTS, "node_id", nodeId);
        return record?.comments;
    }

    async updateCommentIndex(nodeId, words) {
        if (await this.db.existsBy(ENTITY_COMMENTS_INDEX, "node_id", nodeId))
            return this.db.modifyReferencedEntity(ENTITY_COMMENTS_INDEX, "node_id", nodeId, {
                words: words
            });
        else
            return this.db.add(ENTITY_COMMENTS_INDEX, {
                node_id: nodeId,
                words: words
            });
    }

    // async addTags(tags) {
    //     if (tags)
    //         for (let tag of tags) {
    //             if (!await this.db.existsBy(ENTITY_TAG, "node_id", nodeId))
    //                 return this.db.add(ENTITY_TAG, {name: tag});
    //         }
    // }

    // async queryTags() {
    //     return this.db.getAll(ENTITY_TAG);
    // }

    async storeIconLowLevel(nodeId, dataUrl) {
        if (await this.db.existsBy(ENTITY_ICON, "node_id", nodeId))
            return this.db.modifyReferencedEntity(ENTITY_ICON, "node_id", nodeId, {
                data_url: dataUrl
            });
        else
            return this.db.add(ENTITY_ICON, {
                node_id: nodeId,
                data_url: dataUrl
            });
    }

    async updateIcon(iconId, options) {
        options.id = iconId;
        await this.db.update(ENTITY_ICON, options);
    }

    async fetchIcon(nodeId) {
        const icon = await this.db.getBy(ENTITY_ICON, "node_id", nodeId);

        if (icon)
            return icon.data_url;

        return null;
    }

    cleanExportStorage() {
        return this.db.clear(ENTITY_EXPORT_ITEM);
    }

    putExportBlob(processId, blob) {
        return this.db.add(ENTITY_EXPORT_ITEM, {
            process_id: processId,
            blob
        });
    }

    async getExportBlobs(processId) {
        const blobs = await this.db.getAllBySorting(ENTITY_EXPORT_ITEM, "process_id", processId, "id");
        return blobs.map(b => b.blob);
    }

    cleanExportBlobs(processId) {
        return this.db.deleteReferencedEntity(ENTITY_EXPORT_ITEM, "process_id", processId);
    }

}
