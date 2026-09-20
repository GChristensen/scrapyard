import {isContainerNode} from "./storage.js";
import {Node} from "./storage_entities.js";
import {Query} from "./storage_query.js";

// a proxy class that calls handlers of the registered external backends if they are implemented
// an external backend may have the "initialize" method which is called after the settings are loaded
// the corresponding backend is chosen by the first found value of the "external" field in any argument
export class PluginContainer {
    constructor() {
        this.externalBackends = {};

        this._addHandler("createBookmarkFolder");
        this._addHandler("createBookmark");
        this._addHandler("renameBookmark");
        this._addHandler("moveBookmarks");
        this._addHandler("validateCopy");
        this._addHandler("beforeBookmarkCopied")
        this._addHandler("copyBookmarks");
        this._addHandler("deleteBookmarks");
        this._addHandler("updateBookmark");
        this._addHandler("updateBookmarks");
        this._addHandler("reorderBookmarks");
        this._addHandler("storeBookmarkData");
        this._addHandler("updateBookmarkData");
        this._addHandler("storeBookmarkNotes");
        this._addHandler("storeBookmarkComments");
    }

    registerPlugin(name, backend) {
        if (backend.initialize)
            backend.initialize();
        this.externalBackends[name] = backend;
    }

    unregisterExternalBackend(name) {
        delete this.externalBackends[name];
    }

    _addHandler(methodName) {
        const handler = async (...args) => {
            const external = this._findExternal(args);

            if (external) {
                const backend = this.externalBackends[external];
                if (backend[methodName])
                    await backend[methodName].apply(backend, args);
            }
        };

        const proto = Object.getPrototypeOf(this);
        proto[methodName] = handler;
    }

    // A node of a regular shelf carries the property with an undefined value, as it is assigned from
    // its parent. Such a node must not end the search: the backend of the items is looked up in the
    // remaining arguments, which is how moving items out of an external shelf reaches its plugin.
    _findExternal(args) {
        for (const arg of args) {
            if (Array.isArray(arg)) {
                const node = arg.find(n => n.hasOwnProperty("external"));

                if (node)
                    return node.external;
            }
            else if (arg?.external)
                return arg.external;
        }
    }
}

export let plugins = new PluginContainer();

// the base class for high-level bookmarking entities: Bookmark, Shelf, etc.
export class EntityManager {
    constructor() {
        this.plugins = plugins;
    }

    async traverse(root, visitor) {
        let doTraverse = async (parent, root) => {
            await visitor(parent, root);
            let children = isContainerNode(root)
                ? await Node.getChildren(root.id)
                : null;
            if (children)
                for (let c of children)
                    await doTraverse(root, c);
        };

        return doTraverse(null, root);
    }

    async ensureUniqueName(parentId, name, oldName) {
        if (!name)
            return "";

        let children;

        if (parentId)
            children = (await Node.getChildren(parentId)).map(c => c.name);
        else
            children = (await Query.allShelves()).map(c => c.name);

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
}
