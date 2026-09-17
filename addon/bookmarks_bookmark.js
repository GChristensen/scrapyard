import {EntityManager} from "./bookmarks.js";
import {
    byDateAddedDesc,
    byPosition,
    DEFAULT_SHELF_UUID,
    DONE_SHELF_NAME,
    nodeHasSomeContent, isVirtualShelf,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK,
    NODE_TYPE_FOLDER, NODE_TYPE_NOTES,
    NODE_TYPE_SEPARATOR,
    NODE_TYPE_SHELF, NON_IMPORTABLE_SHELVES,
    TODO_SHELF_NAME, DEFAULT_POSITION,
    RDF_EXTERNAL_TYPE, EVERYTHING_SHELF_NAME, ARCHIVE_TYPE_FILES
} from "./storage.js";
import {indexString} from "./utils_html.js";
import {Query} from "./storage_query.js";
import {Path} from "./path.js";
import {Folder} from "./bookmarks_folder.js";
import {ishellConnector} from "./plugin_ishell.js";
import {cleanObject, getMimetypeByExt} from "./utils.js";
import {getFaviconFromContent} from "./favicon.js";
import {Archive, Comments, Icon, Node, Notes} from "./storage_entities.js";
import {undoManager} from "./bookmarks_undo.js";
import {showNotification} from "./utils_browser.js";

export class BookmarkManager extends EntityManager {
    _Node;

    static newInstance() {
        const instance = new BookmarkManager();

        instance.idb = new BookmarkManager();

        return instance;
    }

    configure() {
        this._Node = Node;
        this.idb._Node = Node.idb;
    }

    _splitTags(tags, separator = ",") {
        if (tags && typeof tags === "string")
            return tags.split(separator)
                .filter(t => !!t)
                .map(t => t.trim())
                .map(t => t.toLocaleUpperCase());

        return tags;
    }

    setTentativeId(node) {
        node.__tentative_id = "tentative_" + Math.floor(Math.random() * 1000);
        return node.__tentative_id;
    }

    async add(data, nodeType = NODE_TYPE_BOOKMARK) {
        if (data.parent_id)
            data.parent_id = parseInt(data.parent_id);
        else
            throw new Error("No bookmark parent id");

        const parent = await Node.get(data.parent_id);

        if (nodeType === NODE_TYPE_BOOKMARK && parent.external === RDF_EXTERNAL_TYPE)
            throw new Error("Only archives could be added to an RDF file.");

        data.external = parent.external;
        data.name = await this.ensureUniqueName(data.parent_id, data.name);

        data.type = nodeType;
        if (data.tags)
            data.tag_list = this._splitTags(data.tags);
        //await this.addTags(data.tag_list);

        const [iconId, dataUrl] = await this.storeIcon(data);

        const node = await this._Node.add(data);

        if (iconId) {
            await Icon.update(iconId, {node_id: node.id});
            // the icon is stored before the node receives its content_modified date,
            // so other browsers that synchronize the node always find the icon in the storage
            await Icon.persist(node, dataUrl);
            await this._Node.updateContentModified(node);
        }

        await this.plugins.createBookmark(node, parent);

        return node;
    }

    async addSeparator(parentId, name = "-") {
        const parent = await Node.get(parentId);
        const options = {
            name,
            type: NODE_TYPE_SEPARATOR,
            parent_id: parentId,
            external: parent.external
        };

        let node = await this._Node.add(options);

        try {
            await this.plugins.createBookmark(node, parent);
        }
        catch (e) {
            console.error(e);
        }

        return node;
    }

    async addNotes(parentId, name) {
        let folder = await Node.get(parentId);
        let node = await this._Node.add({
            parent_id: parentId,
            name: name,
            //has_notes: true,
            type: NODE_TYPE_NOTES,
            external: folder.external
        });

        try {
            await this.plugins.createBookmark(node, folder);
        }
        catch (e) {
            console.error(e);
        }

        return node;
    }

    async import(data, sync) {
        if (data.uuid === DEFAULT_SHELF_UUID)
            return;

        if (data.type !== NODE_TYPE_SHELF)
            data.parent_id = data.parent_id || (await Folder.getOrCreateByPath(data.path)).id;

        data = Object.assign({}, data);

        if (data.tags)
            data.tag_list = this._splitTags(data.tags);
        //this.addTags(data.tag_list);

        const exists = await Node.exists(data);
        let forceNewUuid = data.uuid && (!sync && (exists || NON_IMPORTABLE_SHELVES.some(uuid => uuid === data.uuid)));

        const now = new Date();

        if (!data.date_added)
            data.date_added = now;

        // sync uses date_modified field to track changes, so this field should be updated on a regular import,
        // but it should not be touched when performing a sync import
        if (!sync) {
            data.date_modified = now;
            if (data.content_modified || nodeHasSomeContent(data))
                data.content_modified = data.date_modified;
        }

        if (!data.uuid || forceNewUuid)
            Node.setUUID(data);

        let result;

        if (sync && exists) {
            const node = await Node.getByUUID(data.uuid);
            data.id = node.id;

            // the icon is present only if the content is pulled, otherwise the local value is retained,
            // unless the icon has been removed in the storage (which is reflected by stored_icon)
            if (!data.icon && !!node.stored_icon === !!data.stored_icon)
                data.icon = node.icon;

            // the record is replaced, so the fields removed in the storage are removed locally as well
            result = this._Node.put(data);
        }
        else
            result = this._Node.import(data);

        return result;
    }

    async update(data) {
        let update = {};
        Object.assign(update, data);

        //update.name = await this.ensureUniqueName(update.parent_id, update.name)

        if (data.tags)
            update.tag_list = this._splitTags(update.tags);
        //this.addTags(update.tag_list);

        await this.plugins.updateBookmark(update);

        return this._Node.update(update);
    }

    clean(bookmark) {
        cleanObject(bookmark, true);

        if (!bookmark.name)
            bookmark.name = "";
    }

    async list(options //{search, // filter by node name or URL
                       // path,   // filter by hierarchical node group path (string), the first item in the path is a name of a shelf
                       // tags,   // filter for node tags (string, containing comma separated list)
                       // date,   // filter nodes by date
                       // date2,  // the second date in query
                       // period, // chronological period: "between", "before", "after"
                       // types,  // filter for node types (array of integers)
                       // limit,  // limit for the returned record number
                       // depth,  // specify depth of search: "group" (sic!, a folder, used in external api), "subtree" or "root+subtree"
                       // order   // order mode to sort the output if specified: "custom", "todo", "date_desc"
                       // content // search in content instead of node name (boolean)
                       // index   // index to use: "content", "comments", "notes"
                       // partial // partially match words (boolean)
                       //}
    ) {
        const path = options.path || EVERYTHING_SHELF_NAME;
        let folder = isVirtualShelf(path)? null: await Folder.getByPath(path);

        if (!options.depth)
            options.depth = "subtree";

        if (options.tags)
            options.tags = this._splitTags(options.tags);

        let result;

        if (options.content && options.search) {
            const search = indexString(options.search);

            let subtree;
            if (path) {
                subtree = [];

                if (path.toLowerCase() === EVERYTHING_SHELF_NAME)
                    subtree = null;
                else if (path.toUpperCase() === TODO_SHELF_NAME)
                    subtree = (await Query.todo()).map(n => n.id);
                else if (path.toUpperCase() === DONE_SHELF_NAME)
                    subtree = (await Query.done()).map(n => n.id);
                else
                    await Query.selectAllChildrenIdsOf(folder.id, subtree);
            }

            result = await Query.nodesByIndex(subtree, search, options.index, options.partial);
        }
        else {
            result = await Query.nodes(folder, options);
        }

        if (path?.toUpperCase() === TODO_SHELF_NAME || path?.toUpperCase() === DONE_SHELF_NAME) {
            for (let node of result) {
                node.__extended_todo = true;
                let pathList = await Path.compute(node);

                node.__path = [];
                for (let i = 0; i < pathList.length - 1; ++i) {
                    node.__path.push(pathList[i].name)
                }
            }
        }

        result.forEach(n => n.__filtering = true);

        if (options.order === "custom")
            result.sort(byPosition);
        else if (options.order === "date_desc")
            result.sort(byDateAddedDesc);

        return result;
    }

    async reorder(positions, posProperty = "pos") {
        try {
            await this.plugins.reorderBookmarks(positions);
        }
        catch (e) {
            console.error(e);
        }

        const id2pos = new Map(positions.map(n => [n.id, n[posProperty]]));
        await this._Node.batchUpdate(n => n[posProperty] = id2pos.get(n.id), Array.from(id2pos.keys()));
    }

    async reorderUndoable(positions, oldPositions, posProperty = "pos") {
        await undoManager.pushReordered(oldPositions, posProperty);
        return this.reorder(positions, posProperty);
    }

    async move(ids, destId, moveLast) {
        const dest = await Node.get(destId);
        const nodes = await Node.get(ids);

        try {
            await this.plugins.moveBookmarks(dest, nodes);
        }
        catch (e) {
            console.error(e);

            if (e.name === "EScrapyardPluginError")
                throw e;
        }

        // a check for circular references
        const ascendants = new Set(await Query.ascendantIdsOf(dest));
        ascendants.add(destId);

        for (const node of nodes)
            if (ascendants.has(node.id)) {
                const error = new Error("A circular reference while moving nodes");
                error.name = "EScrapyardCircularReference";
                throw error;
            }

        for (let n of nodes) {
            n.parent_id = destId;
            n.name = await this.ensureUniqueName(destId, n.name);

            if (moveLast)
                n.pos = DEFAULT_POSITION;

            await this._Node.update(n);
        }

        if (nodes.some(n => n.type === NODE_TYPE_FOLDER))
            ishellConnector.invalidateCompletion();

        return Query.fullSubtree(ids, true);
    }

    async copy(ids, destId, moveLast) {
        const dest = await Node.get(destId);
        let sourceNodes = await Query.fullSubtree(ids, true);
        let newNodes = [];
        let contentErrors = 0;

        for (let newNode of sourceNodes) {
            const sourceNode = {...newNode};
            const sourceNodeId = newNode.source_node_id = newNode.id;

            if (ids.some(id => id === sourceNodeId)) {
                newNode.parent_id = destId;
                newNode.name = await this.ensureUniqueName(destId, newNode.name);
            }
            else {
                let newParent = newNodes.find(nn => nn.source_node_id === newNode.parent_id);
                if (newParent)
                    newNode.parent_id = newParent.id;
            }

            delete newNode.id;
            delete newNode.date_modified;

            if (moveLast && ids.some(id => id === newNode.source_node_id))
                newNode.pos = DEFAULT_POSITION;

            await this.plugins.beforeBookmarkCopied(dest, newNode);

            newNodes.push(Object.assign(newNode, await this._Node.add(newNode)));

            try {
                await this.copyContent(sourceNode, newNode);
            } catch (e) {
                console.error(e);
                ++contentErrors;
            }
        }

        if (contentErrors)
            showNotification(`The content of ${contentErrors} item${contentErrors > 1? "s": ""} could not be copied, `
                + `the copies may be incomplete.`);

        let rootNodes = newNodes.filter(n => ids.some(id => id === n.source_node_id));

        try {
            await this.plugins.copyBookmarks(dest, rootNodes);

            if (rootNodes.some(n => n.type === NODE_TYPE_FOLDER))
                ishellConnector.invalidateCompletion();
        }
        catch (e) {
            console.error(e);
        }

        return newNodes;
    }

    async copyContent(sourceNode, newNode) {
        if (sourceNode.stored_icon) {
            let icon = await Icon.get(sourceNode);
            if (icon)
                await Icon.add(newNode, icon);
        }

        if (sourceNode.type === NODE_TYPE_ARCHIVE) {
            let archive = await Archive.get(sourceNode);

            if (archive) {
                const index = await Archive.fetchIndex(sourceNode);
                await Archive.add(newNode, archive, index);
            }
        }

        if (sourceNode.has_notes) {
            let notes = await Notes.get(sourceNode);
            if (notes) {
                delete notes.id;
                notes.node_id = newNode.id;
                await Notes.add(newNode, notes);
            }
        }

        if (sourceNode.has_comments) {
            let comments = await Comments.get(sourceNode);
            if (comments)
                await Comments.add(newNode, comments);
        }
    }

    async _delete(nodes, deletef) {
        try {
            await this.plugins.deleteBookmarks(nodes);
        }
        catch (e) {
            console.error(e);
        }

        await deletef(nodes);

        if (nodes.some(n => n.type === NODE_TYPE_FOLDER || n.type === NODE_TYPE_SHELF))
            ishellConnector.invalidateCompletion();
    }

    async _hardDelete(nodes) {
        return this._delete(nodes, nodes => this._Node.delete(nodes));
    }

    async delete(ids) {
        const nodes = await Query.fullSubtree(ids);

        return this._hardDelete(nodes);
    }

    async softDelete(ids) {
        const nodes = await Query.fullSubtree(ids);

        if (nodes.some(n => n.external === RDF_EXTERNAL_TYPE))
            return this._hardDelete(nodes);

        return this._delete(nodes, this._undoDelete.bind(this));
    }

    async _undoDelete(nodes, ids) {
        await undoManager.pushDeleted(ids, nodes);

        return this._Node.deleteShallow(nodes);
    }

    async deleteChildren(id) {
        let all_nodes = await Query.fullSubtree(id);

        await this._Node.delete(all_nodes.filter(n => n.id !== id));

        ishellConnector.invalidateCompletion();
    }

    async restore(node) {
        await this._Node.put(node);

        if (node.parent_id) {
            const parent = await Node.get(node.parent_id);
            await this.plugins.createBookmark(node, parent);
        }
    }

    async storeIcon(node, iconData, contentType) {
        const convertAndStore = async (iconData, contentType) => {
            if (iconData.byteLength && contentType && contentType.startsWith("image")) {
                const byteArray = new Uint8Array(iconData);

                let binaryString = "";
                for (let i = 0; i < byteArray.byteLength; i++)
                    binaryString += String.fromCharCode(byteArray[i]);

                contentType = contentType.split(";")[0];

                let iconUrl = `data:${contentType};base64,${btoa(binaryString)}`;

                const id = await Icon.import.add(node, iconUrl);

                return [id, iconUrl];
            }
        };

        const updateNode = async (node, iconUrl) => {
            node.stored_icon = true;
            node.icon = await Icon.computeHash(iconUrl);
            if (node.id)
                await this._Node.updateContentModified(node);
        };

        let iconId;
        let dataUrl;

        if (node.icon) {
            try {
                if (node.icon.startsWith("data:")) {
                    iconId = await Icon.import.add(node, node.icon);
                    dataUrl = node.icon;
                    await updateNode(node, node.icon);
                }
                else {
                    if (iconData && contentType) {
                        const [id, iconUrl] = await convertAndStore(iconData, contentType);
                        await updateNode(node, iconUrl);
                        iconId = id;
                        dataUrl = iconUrl;
                    }
                    else {
                        try {
                            const response = await fetch(node.icon);

                            if (response.ok) {
                                let type = response.headers.get("content-type");

                                if (!type) {
                                    let iconUrl = new URL(node.icon);
                                    type = getMimetypeByExt(iconUrl.pathname);
                                }

                                if (type.startsWith("image")) {
                                    const buffer = await response.arrayBuffer();
                                    if (buffer.byteLength) {
                                        const [id, iconUrl] = await convertAndStore(buffer, type);
                                        await updateNode(node, iconUrl);
                                        iconId = id;
                                        dataUrl = iconUrl;
                                    }
                                }
                            }
                        }
                        catch (e) {
                            node.icon = undefined;
                            node.stored_icon = undefined;
                            if (node.id)
                                await this._Node.update(node);
                            console.error(e);
                        }
                    }
                }
            }
            catch (e) {
                console.error(e);
            }
        }

        return [iconId, dataUrl];
    }

    async storeIconFromURI(node) {
        try {
            node.icon = await getFaviconFromContent(node.uri);
            await this.storeIcon(node);
        } catch (e) {
            console.error(e);
        }
    }

    async storeArchive(node, data, contentType, index) {
        const archive = Archive.entity(node, data, contentType);

        if (node.contains === ARCHIVE_TYPE_FILES) {
            await Archive.storeIndex(node, index.words);
            await Archive.saveFile(node, "index.html", data);
            await Archive.updateContentModified(node, archive, true);
        }
        else
            await Archive.add(node, archive, index);

        await this.plugins.storeBookmarkData(node, data, contentType);
    }

    async updateArchive(uuid, data) {
        const node = await Node.getByUUID(uuid);
        await Archive.updateHTML(node, data);
        await this.plugins.updateBookmarkData(node, data);
    }

    async storeNotes(options, propertyChange) {
        const node = await Node.get(options.node_id);
        await Notes.add(node, options, propertyChange);
        await this.plugins.storeBookmarkNotes(node, options, propertyChange);
    }

    async storeComments(nodeId, comments) {
        const node = await Node.get(nodeId);
        await Comments.add(node, comments);
        await this.plugins.storeBookmarkComments(node, comments);
    }

    async isSitePage(node) {
        const parent = await Node.get(node.parent_id);
        return parent.site;
    }
}

export let Bookmark = BookmarkManager.newInstance();


