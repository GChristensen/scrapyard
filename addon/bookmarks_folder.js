import {Query} from "./storage_query.js";
import {Path} from "./path.js";
import {EntityManager} from "./bookmarks.js";
import {NODE_TYPE_FOLDER, NODE_TYPE_SHELF} from "./storage.js";
import {ishellConnector} from "./plugin_ishell.js";
import {Node} from "./storage_entities.js";

class FolderManager extends EntityManager {
    #Node;

    static newInstance() {
        const instance = new FolderManager();

        instance.idb = new FolderManager();

        return instance;
    }

    configure() {
        this.#Node = Node;
        this.idb.#Node = Node.idb;
    }

    async add(parent, name, nodeType = NODE_TYPE_FOLDER) {
        if (parent && typeof parent === "number")
            parent = await this.#Node.get(parent);

        return this._addNode({
            name,
            type: nodeType,
            parent_id: parent?.id
        }, parent);
    }

    async addSite(parentId, name) {
        const parent = await this.#Node.get(parentId);

        return this._addNode({
            name,
            type: NODE_TYPE_FOLDER,
            parent_id: parentId,
            site: true
        }, parent);
    }

    // Only the folders directly under a gallery shelf are galleries; deeper folders are ordinary folders.
    // Applied wherever a folder is created, including the paths auto-created for the automation and iShell APIs.
    _inheritGallery(node, parent) {
        if (node.type === NODE_TYPE_FOLDER && parent?.type === NODE_TYPE_SHELF && parent.gallery)
            node.gallery = true;

        return node;
    }

    async _addNode(node, parent) {
        node.name = await this.ensureUniqueName(parent?.id, node.name);
        node.external = parent?.external;
        this._inheritGallery(node, parent);

        node = await this.#Node.add(node);

        try {
            ishellConnector.invalidateCompletion();

            if (parent)
                await this.plugins.createBookmarkFolder(node, parent);
        }
        catch (e) {
            console.error(e);
        }

        return node;
    }

    // returns map of folders the function was able to find in the path
    async _queryFolders(pathList) {
        pathList = [...pathList];

        let folders = [];
        let shelfName = pathList.shift();
        let shelf = await Query.shelf(shelfName);

        if (shelf)
            folders.push(shelf);
        else
            return [];

        let parent = shelf;
        for (let name of pathList) {
            if (parent) {
                let folder = await Query.subfolder(parent.id, name);
                folders.push(folder);
                parent = folder;
            }
            else
                break;
        }

        return folders;
    }

    // returns the last folder in the path if it exists
    async getByPath(path) {
        let pathList = Path.split(path);
        let folders = await this._queryFolders(pathList);

        return folders.at(-1);
    }

    // creates all non-existent folders in the path
    async getOrCreateByPath(path) {
        let pathList = Path.split(path);
        let folders = await this._queryFolders(pathList);
        let shelfName = pathList.shift();
        let parent = folders.shift();

        if (!parent) {
            parent = await this.#Node.add({
                name: shelfName,
                type: NODE_TYPE_SHELF
            });
            ishellConnector.invalidateCompletion();
        }

        let ctr = 0;
        for (let name of pathList) {
            let folder = folders[ctr++];

            if (folder) {
                parent = folder;
            }
            else {
                let node = await this.#Node.add(this._inheritGallery({
                    parent_id: parent.id,
                    external: parent.external,
                    name: name,
                    type: NODE_TYPE_FOLDER
                }, parent));

                try {
                    await this.plugins.createBookmarkFolder(node, parent);
                    ishellConnector.invalidateCompletion();
                }
                catch (e) {
                    console.error(e);
                }

                parent = node;
            }
        }

        return parent;
    }

    async rename(id, newName) {
        let folder = await Node.get(id);

        if (folder.name !== newName) {
            if (folder.name.toLocaleUpperCase() !== newName.toLocaleUpperCase())
                folder.name = await this.ensureUniqueName(folder.parent_id, newName, folder.name);
            else
                folder.name = newName;

            try {
                await this.plugins.renameBookmark(folder);
                ishellConnector.invalidateCompletion();
            }
            catch (e) {
                console.error(e);
            }

            await this.#Node.update(folder);
        }
        return folder;
    }

}

export let Folder = FolderManager.newInstance();
