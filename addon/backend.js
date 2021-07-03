import {settings} from "./settings.js"
import IDBStorage from "./storage_idb.js";
import BookmarkStorage from "./storage_bookmarks.js";
import {rdfBackend} from "./backend_rdf.js";
import {cloudBackend} from "./backend_cloud.js";
import {browserBackend} from "./backend_browser.js";
import {cleanObject, computeSHA1, getMimetypeExt} from "./utils.js";
import {ishellBackend} from "./backend_ishell.js";

import {
    isContainer,
    isEndpoint,
    CLOUD_SHELF_ID,
    DEFAULT_POSITION,
    DEFAULT_SHELF_NAME,
    DEFAULT_SHELF_UUID,
    DONE_SHELF_NAME,
    EVERYTHING,
    FIREFOX_BOOKMARK_MOBILE,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK,
    NODE_TYPE_GROUP,
    NODE_TYPE_NOTES,
    NODE_TYPE_SEPARATOR,
    NODE_TYPE_SHELF,
    NODE_TYPE_UNLISTED,
    SPECIAL_UUIDS,
    TODO_SHELF_NAME
} from "./storage.js";
import {readBlob} from "./utils_io.js";
import {getFavicon} from "./favicon.js";
import {indexWords} from "./utils_html.js";

// a proxy class that calls handlers of the registered external backends if they are implemented
// an external backend may have the "initialize" method which is called after the settings are loaded
class ExternalEventProvider {
    constructor() {
        this.externalBackends = {};

        this._addHandler("createBookmarkFolder");
        this._addHandler("createBookmark");
        this._addHandler("renameBookmark");
        this._addHandler("moveBookmarks");
        this._addHandler("copyBookmarks");
        this._addHandler("deleteBookmarks");
        this._addHandler("updateBookmark");
        this._addHandler("updateBookmarks");
        this._addHandler("reorderBookmarks");
        this._addHandler("storeBookmarkData");
        this._addHandler("updateBookmarkData");
        this._addHandler("storeBookmarkNotes");
        this._addHandler("storeBookmarkComments");
        this._addHandler("invalidateCompletion");
    }

    registerExternalBackend(name, backend) {
        if (backend.initialize)
            backend.initialize();
        this.externalBackends[name] = backend;
    }

    unregisterExternalBackend(name) {
        delete this.externalBackends[name];
    }

    _addHandler(methodName) {
        const handler = async (...args) => {
            for (let backend of Object.values(this.externalBackends)) {
                if (backend[methodName])
                    await backend[methodName].apply(backend, args);
            }
        };

        const proto = Object.getPrototypeOf(this);
        proto[methodName] = handler;
    }
}

export class Backend extends BookmarkStorage {

    constructor() {
        super(IDBStorage.STORAGE_TYPE_ID);

        this.externalEvents = new ExternalEventProvider();

        this.externalEvents.registerExternalBackend("browser", browserBackend);
        this.externalEvents.registerExternalBackend("cloud", cloudBackend);
        this.externalEvents.registerExternalBackend("rdf", rdfBackend);
        this.externalEvents.registerExternalBackend("ishell", ishellBackend);
    }

    expandPath(path) {
        let background = browser.extension.getBackgroundPage();

        if (path && path.startsWith("~"))
            return path.replace("~", DEFAULT_SHELF_NAME);
        // the following values are got during reconciliation in browser backend and may vary
        // depending on the browser UI language
        else if (path && path.startsWith("@@") && background._unfiledBookmarkPath)
            return path.replace("@@", background._unfiledBookmarkPath);
        else if (path && path.startsWith("@") && background._browserBookmarkPath)
            return path.replace("@", background._browserBookmarkPath);

        return path;
    }

    _normalizePath(path) {
        if (path) {
            path = path.trim();
            path = path.replace("\\", "/");
            if (path.startsWith("/"))
                path = path.replace(/^\//, "");
            else if (!path)
                path = DEFAULT_SHELF_NAME;

            return path;
        }
        else
            return DEFAULT_SHELF_NAME;
    }

    _splitPath(path) {
        return this._normalizePath(path).split("/").filter(n => !!n);
    }

    async computePath(id, isUUID = false) {
        let path = [];
        let node = await this.getNode(id, isUUID);

        while (node) {
            path.push(node);
            if (node.parent_id)
                node = await this.getNode(node.parent_id);
            else
                node = null;
        }

        return path.reverse();
    }

    _splitTags(tags, separator = ",") {
        if (tags && typeof tags === "string")
            return tags.split(separator)
                .filter(t => !!t)
                .map(t => t.trim())
                .map(t => t.toLocaleUpperCase());

        return tags;
    }

    _blob2Array(blob) {
        let byteArray = new Uint8Array(blob.byte_length);
        for (let i = 0; i < blob.data.length; ++i)
            byteArray[i] = blob.data.charCodeAt(i);
        return byteArray;
    }

    async reifyBlob(blob, binarystring = false) {
        let result;

        if (!blob)
            return null;

        if (blob.byte_length) {
            if (blob.data) {
                if (binarystring)
                    result = blob.data;
                else
                    result = this._blob2Array(blob);
            }
            else if (blob.object) {
                if (binarystring)
                    result = await readBlob(blob.object, "binarystring")
                else
                    result = await readBlob(blob.object, "binary")
            }
        }
        else {
            if (blob.data)
                result = blob.data;
            else if (blob.object)
                result = await readBlob(blob.object, "text");
        }

        return result;
    }

    listShelves() {
        return this.queryShelf()
    }

    async listShelfContent(shelf) {
        let nodes = [];

        if (shelf === EVERYTHING) {
            nodes = await this.getNodes();
            nodes = nodes.filter(n => !(n._unlisted || n.type === NODE_TYPE_UNLISTED));
        }
        else {
            let shelfNode = await this.queryShelf(shelf);
            nodes = await this.queryFullSubtree(shelfNode.id);
        }

        if (nodes)
            nodes.sort((a, b) => a.pos - b.pos);

        return nodes;
    }

    listGroups() {
        return backend.queryGroups(true);
    }

    async listNodes(options //{search, // filter by node name or URL
                            // path,   // filter by hierarchical node group path (string), the first item in the path is a name of a shelf
                            // tags,   // filter for node tags (string, containing comma separated list)
                            // date,   // filter nodes by date
                            // date2,  // the second date in query
                            // period, // chronological period: "" (exact date), "before", "after"
                            // types,  // filter for node types (array of integers)
                            // limit,  // limit for the returned record number
                            // depth,  // specify depth of search: "group", "subtree" or "root+subtree"
                            // order   // order mode to sort the output if specified: "custom", "todo"
                            // content // search in content instead of node name (boolean)
                            // index   // index to use: "content", "comments", "notes"
                            //}
              ) {
        let group = options.path && options.path !== TODO_SHELF_NAME && options.path !== DONE_SHELF_NAME
            ? await this.queryGroup(options.path)
            : null;

        if (!options.depth)
            options.depth = "subtree";

        if (options.tags)
            options.tags = this._splitTags(options.tags);

        let result;

        if (options.content && options.search) {
            const search = indexWords(options.search, false);

            let subtree;
            if (options.path) {
                subtree = [];

                if (options.path.toLowerCase() === EVERYTHING)
                    subtree = null;
                else if (options.path.toUpperCase() === TODO_SHELF_NAME)
                    subtree = (await this.queryTODO()).map(n => n.id);
                else if (options.path.toUpperCase() === DONE_SHELF_NAME)
                    subtree = (await this.queryDONE()).map(n => n.id);
                else
                    await this._selectAllChildrenIdsOf(group.id, subtree);
            }

            result = await this.filterByContent(subtree, search, options.index);
        }
        else {
            result = await this.queryNodes(group, options);
        }

        if (options.path && (options.path.toUpperCase() === TODO_SHELF_NAME
                || options.path.toUpperCase() === DONE_SHELF_NAME)) {
            for (let node of result) {
                node.__extended_todo = true;
                let path = await this.computePath(node.id);

                node.__path = [];
                for (let i = 0; i < path.length - 1; ++i) {
                    node.__path.push(path[i].name)
                }
            }
        }

        result.forEach(n => n.__filtering = true);

        return result;
    }

    async listExportedNodes(shelf, computeLevel) {
        const isShelfName = typeof shelf === "string";
        let nodes;

        if (isShelfName && shelf.toUpperCase() === TODO_SHELF_NAME) {
            nodes = await this.listTODO();
            if (computeLevel)
                nodes.forEach(n => n.__level = 1)
            return nodes;
        }
        else if (isShelfName && shelf.toUpperCase() === DONE_SHELF_NAME) {
            nodes = await this.listDONE();
            if (computeLevel)
                nodes.forEach(n => n.__level = 1)
            return nodes;
        }

        const everything = isShelfName && shelf === EVERYTHING;

        if (!everything && isShelfName)
            shelf = await this.queryShelf(shelf);

        let level = computeLevel? (everything? 1: 0): undefined;

        if (everything) {
            const shelves = await this.queryShelf();
            const cloud = shelves.find(s => s.id === CLOUD_SHELF_ID);
            if (cloud)
                shelves.splice(shelves.indexOf(cloud), 1);
            nodes = await this.queryFullSubtree(shelves.map(s => s.id), false, true, level);
        }
        else {
            nodes = await this.queryFullSubtree(shelf.id, false, true, level);
            nodes.shift();
        }

        const mobileBookmarks = nodes.find(n => n.external_id === FIREFOX_BOOKMARK_MOBILE);
        if (mobileBookmarks) {
            const mobileSubtree = nodes.filter(n => n.parent_id === mobileBookmarks.id);
            for (const n of mobileSubtree)
                nodes.splice(nodes.indexOf(n), 1);
            nodes.splice(nodes.indexOf(mobileBookmarks), 1);
        }

        return nodes;
    }

    async reorderNodes(positions) {
        try {
            await this.externalEvents.reorderBookmarks(positions);
        }
        catch (e) {
            console.error(e);
        }

        const id2pos = new Map(positions.map(n => [n.id, n.pos]));
        await this.updateNodes(n => n.pos = id2pos.get(n.id), Array.from(id2pos.keys()));
    }

    async setTODOState(states) {
        await this.updateNodes(states);
        return this.externalEvents.updateBookmarks(states);
    }

    async listTODO() {
        let todo = await this.queryTODO();
        todo.reverse();
        todo.sort((a, b) => a.todo_state - b.todo_state);

        let now = new Date();
        now.setUTCHours(0, 0, 0, 0);

        for (let node of todo) {
            let todo_date;

            if (node.todo_date && node.todo_date != "")
            try {
                todo_date = new Date(node.todo_date);
                todo_date.setUTCHours(0, 0, 0, 0);
            } catch (e) {
            }

            if (todo_date && now >= todo_date)
                node.__overdue = true;

            let path = await this.computePath(node.id);

            node.__path = [];
            for (let i = 0; i < path.length - 1; ++i) {
                node.__path.push(path[i].name)
            }

            node.__extended_todo = true;
        }

        return todo.filter(n => n.__overdue).concat(todo.filter(n => !n.__overdue));
    }

    async listDONE() {
        let done = await this.queryDONE();

        for (let node of done) {
            let path = await this.computePath(node.id);

            node.__path = [];
            for (let i = 0; i < path.length - 1; ++i) {
                node.__path.push(path[i].name)
            }

            node.__extended_todo = true;
        }

        return done;
    }

    // returns map of groups the function was able to find in the path
    async _queryGroups(pathList) {
        pathList = pathList.slice(0);

        let groups = {};
        let shelfName = pathList.shift();
        let shelf = await this.queryShelf(shelfName);

        if (shelf)
            groups[shelf.name.toLocaleLowerCase()] = shelf;
        else
            return {};

        let parent = shelf;
        for (let name of pathList) {
            if (parent) {
                let group = await this.queryGroup(parent.id, name);
                groups[name.toLocaleLowerCase()] = group;
                parent = group;
            }
            else
                break;
        }

        return groups;
    }

    // returns the last group in path if it exists
    async queryGroup(path) {
        let pathList = this._splitPath(path);
        let groups = await this._queryGroups(pathList);

        return groups[pathList[pathList.length - 1].toLocaleLowerCase()];
    }

    // creates all non-existent groups
    async getGroupByPath(path) {
        let pathList = this._splitPath(path);
        let groups = await this._queryGroups(pathList);
        let shelfName = pathList.shift();
        let parent = groups[shelfName.toLowerCase()];

        if (!parent) {
            parent = await this.addNode({
                name: shelfName,
                type: NODE_TYPE_SHELF
            });
            this.externalEvents.invalidateCompletion();
        }

        for (let name of pathList) {
            let group = groups[name.toLowerCase()];

            if (group) {
                parent = group;
            }
            else {
                let node = await this.addNode({
                    parent_id: parent.id,
                    name: name,
                    type: NODE_TYPE_GROUP
                });

                try {
                    await this.externalEvents.createBookmarkFolder(node, parent);
                    this.externalEvents.invalidateCompletion();
                }
                catch (e) {
                    console.error(e);
                }

                parent = node;
            }
        }

        return parent;
    }

    async ensureUnique(parentId, name, oldName) {
        if (!name)
            return "";

        let children;

        if (parentId)
            children = (await this.getChildNodes(parentId)).map(c => c.name);
        else
            children = (await this.queryShelf()).map(c => c.name);

        children = children.filter(c => !!c);

        if (oldName)
            children = children.filter(c => c !== oldName);

        children = children.map(c => c.toLocaleUpperCase());

        let uname = name.toLocaleUpperCase();
        let original = name;
        let n = 1;

        let m = original.match(/.*( \(\d+\))$/);

        if (m)
            original = original.replace(m[1], "");

        while (children.some(c => c === uname)) {
            name = original + " (" + n + ")";
            uname = name.toLocaleUpperCase();
            n += 1
        }

        return name;
    }

    async createGroup(parent, name, nodeType = NODE_TYPE_GROUP) {
        if (parent && typeof parent === "number")
            parent = await this.getNode(parent);

        let node = await this.addNode({
            name: await this.ensureUnique(parent?.id, name),
            type: nodeType,
            parent_id: parent?.id
        });

        //node = this._sanitizeNode(node);

        try {
            this.externalEvents.invalidateCompletion();

            if (parent)
                await this.externalEvents.createBookmarkFolder(node, parent);
        }
        catch (e) {
            console.error(e);
        }

        return node;
    }

    async renameGroup(id, newName) {
        let group = await this.getNode(id);

        if (group.name !== newName) {
            if (group.name.toLocaleUpperCase() !== newName.toLocaleUpperCase())
                group.name = await this.ensureUnique(group.parent_id, newName, group.name);
            else
                group.name = newName;

            try {
                await this.externalEvents.renameBookmark(group);
                this.externalEvents.invalidateCompletion();
            }
            catch (e) {
                console.error(e);
            }

            await this.updateNode(group);
        }
        return group;
    }

    async addSeparator(parentId) {
        const options = {
            name: "-",
            type: NODE_TYPE_SEPARATOR,
            parent_id: parentId
        };

        let node = await this.addNode(options);

        try {
            await this.externalEvents.createBookmark(node, await backend.getNode(parentId));
        }
        catch (e) {
            console.log(e);
        }

        return node;
    }

    async moveNodes(ids, destId, moveLast) {
        let nodes = await this.getNodes(ids);

        try {
            await this.externalEvents.moveBookmarks(nodes, destId);
        }
        catch (e) {
            console.error(e);
        }

        for (let n of nodes) {
            n.parent_id = destId;
            n.name = await this.ensureUnique(destId, n.name);

            if (moveLast)
                n.pos = DEFAULT_POSITION;

            await this.updateNode(n);
        }

        if (nodes.some(n => n.type === NODE_TYPE_GROUP))
            this.externalEvents.invalidateCompletion();

        return this.queryFullSubtree(ids, false, true);
    }

    async copyNodes(ids, destId, moveLast) {
        let all_nodes = await this.queryFullSubtree(ids, false, true);
        let new_nodes = [];

        for (let n of all_nodes) {
            let old_id = n.old_id = n.id;

            if (ids.some(id => id === old_id)) {
                n.parent_id = destId;
                n.name = await this.ensureUnique(destId, n.name);
            }
            else {
                let new_parent = new_nodes.find(nn => nn.old_id === n.parent_id);
                if (new_parent)
                    n.parent_id = new_parent.id;
            }

            delete n.id;
            delete n.date_modified;

            if (moveLast && ids.some(id => id === n.old_id))
                n.pos = DEFAULT_POSITION;

            new_nodes.push(Object.assign(n, await this.addNode(n, false)));

            try {
                if (isEndpoint(n) && n.type !== NODE_TYPE_SEPARATOR) {
                    let notes = await this.fetchNotes(old_id);
                    if (notes) {
                        delete notes.id;
                        notes.node_id = n.id;
                        await this.storeIndexedNotes(notes);
                        notes = null;
                    }

                    let comments = await this.fetchComments(old_id);
                    if (comments) {
                        await this.storeIndexedComments(n.id, comments);
                        comments = null;
                    }

                    if (n.stored_icon) {
                        let icon = await this.fetchIcon(old_id);
                        if (icon) {
                            await this.storeIconLowLevel(n.id, icon);
                        }
                    }
                }

                if (n.type === NODE_TYPE_ARCHIVE) {
                    let blob = await this.fetchBlob(old_id);
                    if (blob) {
                        let index = await this.fetchIndex(old_id);
                        await this.storeIndexedBlob(n.id, blob.data || blob.object, blob.type, blob.byte_length, index);
                        blob = null;
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }

        let top_nodes = new_nodes.filter(n => ids.some(id => id === n.old_id));

        try {
            await this.externalEvents.copyBookmarks(top_nodes, destId);

            if (top_nodes.some(n => n.type === NODE_TYPE_GROUP))
                this.externalEvents.invalidateCompletion();
        }
        catch (e) {
            console.error(e);
        }

        return new_nodes;
    }

    async deleteNodes(ids) {
        let all_nodes = await this.queryFullSubtree(ids);

        try {
            await this.externalEvents.deleteBookmarks(all_nodes);
        }
        catch (e) {
            console.error(e);
        }

        await this.deleteNodesLowLevel(all_nodes.map(n => n.id));

        if (all_nodes.some(n => n.type === NODE_TYPE_GROUP || n.type === NODE_TYPE_SHELF))
            this.externalEvents.invalidateCompletion();
    }

    async deleteChildNodes(id) {
        let all_nodes = await this.queryFullSubtree(id);

        await this.deleteNodesLowLevel(all_nodes.map(n => n.id).filter(i => i !== id));

        this.externalEvents.invalidateCompletion();
    }

    async traverse(root, visitor) {
        let doTraverse = async (parent, root) => {
            await visitor(parent, root);
            let children = isContainer(root)
                ? await this.getChildNodes(root.id)
                : null;
            if (children)
                for (let c of children)
                    await doTraverse(root, c);
        };

        return doTraverse(null, root);
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

                const id = await this.storeIconLowLevel(node.id, iconUrl);

                return [id, iconUrl];
            }
        };

        const updateNode = async (node, iconUrl) => {
            node.stored_icon = true;
            node.icon = "hash:" + (await computeSHA1(iconUrl));
            if (node.id)
                await this.updateNode(node);
        };

        if (node.icon) {
            try {
                if (node.icon.startsWith("data:")) {
                    const id = await this.storeIconLowLevel(node.id, node.icon);
                    await updateNode(node, node.icon);
                    return id;
                }
                else {
                    if (iconData && contentType) {
                        const [id, iconUrl] = await convertAndStore(iconData, contentType);
                        await updateNode(node, iconUrl);
                        return id;
                    }
                    else {
                        try {
                            const response = await fetch(node.icon);

                            if (response.ok) {
                                let type = response.headers.get("content-type");

                                if (!type) {
                                    let iconUrl = new URL(node.icon);
                                    type = getMimetypeExt(iconUrl.pathname);
                                }

                                if (type.startsWith("image")) {
                                    const buffer = await response.arrayBuffer();
                                    if (buffer.byteLength) {
                                        const [id, iconUrl] = await convertAndStore(buffer, type);
                                        await updateNode(node, iconUrl);
                                        return id;
                                    }
                                }
                            }
                        }
                        catch (e) {
                            node.icon = undefined;
                            node.stored_icon = undefined;
                            if (node.id)
                                await this.updateNode(node);
                            console.error(e);
                        }
                    }
                }
            }
            catch (e) {
                console.error(e);
            }
        }
    }

    async storeIconFromURI(node) {
        try {
            node.icon = await getFavicon(node.uri);
            await this.storeIcon(node);
        } catch (e) {
            console.error(e);
        }
    }

    setTentativeId(node) {
        node.__tentative_id = "tentative_" + Math.floor(Math.random() * 1000);
        return node.__tentative_id;
    }

    async addBookmark(data, nodeType = NODE_TYPE_BOOKMARK) {
        let group, parentId;

        if (data.parent_id)
            parentId = data.parent_id = parseInt(data.parent_id);
        else
            throw new Error("No bookmark parent id");

        if (!group)
            group = await this.getNode(parentId);

        data.name = await this.ensureUnique(data.parent_id, data.name);

        data.type = nodeType;
        data.tag_list = this._splitTags(data.tags);
        //await this.addTags(data.tag_list);

        const iconId = await this.storeIcon(data);
        const node = await this.addNode(data);

        if (iconId)
            await this.updateIcon(iconId, {node_id: node.id});

        await this.externalEvents.createBookmark(node, group);

        return node;
    }

    async importBookmark(data) {
        if (data.uuid === DEFAULT_SHELF_UUID)
            return;

        if (data.type !== NODE_TYPE_SHELF)
            data.parent_id = data.parent_id || (await this.getGroupByPath(data.path)).id;

        data = Object.assign({}, data);

        data.tag_list = this._splitTags(data.tags);
        //this.addTags(data.tag_list);

        let forceNewUuid = data.uuid
            && ((await this.isNodeExists(data.uuid)) || SPECIAL_UUIDS.some(uuid => uuid === data.uuid));

        if (!data.date_added || !data.date_modified) {
            const now = new Date();

            if (!data.date_added)
                data.date_added = now;

            if (!data.date_modified)
                data.date_modified = now;
        }

        return this.addNode(data, false, false, !data.uuid || forceNewUuid);
    }

    async updateBookmark(data) {
        let update = {};
        Object.assign(update, data);

        //update.name = await this.ensureUnique(update.parent_id, update.name)

        update.tag_list = this._splitTags(update.tags);
        //this.addTags(update.tag_list);

        await this.externalEvents.updateBookmark(update);

        return this.updateNode(update);
    }

    cleanBookmark(bookmark) {
        cleanObject(bookmark, true);

        if (!bookmark.name)
            bookmark.name = "";
    }

    async storeBlob(nodeId, data, contentType) {
        await this.storeIndexedBlob(nodeId, data, contentType);
        await this.externalEvents.storeBookmarkData(nodeId, data, contentType);
    }

    async updateBlob(nodeId, data) {
        await this.updateBlobLowLevel(nodeId, data);
        await this.updateIndex(nodeId, indexWords(data));
        await this.externalEvents.updateBookmarkData(nodeId, data);
    }

    async addNotes(parentId, name) {
        let node = await this.addNode({
            parent_id: parentId,
            name: name,
            //has_notes: true,
            type: NODE_TYPE_NOTES
        });

        let group = await this.getNode(parentId);

        try {
            await this.externalEvents.createBookmark(node, group);
        }
        catch (e) {
            console.error(e);
        }

        return node;
    }

    async storeNotes(options) {
        await this.storeIndexedNotes(options);
        await this.externalEvents.storeBookmarkNotes(options);
    }

    async storeComments(nodeId, comments) {
        await this.storeIndexedComments(nodeId, comments);
        await this.externalEvents.storeBookmarkComments(nodeId, comments);
    }
}

export let backend = new Promise(async resolve => {
    await settings.load();
    backend = new Backend();
    resolve(backend);
});

