import {
    CLOUD_SHELF_UUID,
    NODE_TYPE_SHELF,
    createJSONScrapBookMeta,
    updateJSONScrapBookMeta,
    JSON_SCRAPBOOK_FOLDERS
} from "./storage.js";
import UUID from "./uuid.js";

export class CloudStorage {
    constructor() {
        this._objects = new Map();
        // the provider-specific version and modification time of the downloaded index
        this.version = undefined;
        this.lastModified = undefined;
    }

    static deserialize(jsonLines) {
        const storage = new CloudStorage();

        const lines = jsonLines.split("\n").filter(s => !!s);
        storage._meta = lines.length? JSON.parse(lines.shift()): {};

        if (lines.length > 0) {
            for (const line of lines) {
                const object = JSON.parse(line);
                storage._objects.set(object.uuid, object);
            }
        }

        return storage;
    }

    serialize() {
        const hasMeta = !!this._meta;
        this._meta = this._meta || createJSONScrapBookMeta("cloud");

        if (!hasMeta)
            this._meta.uuid = UUID.numeric();

        const objects = this._treeSortObjects();

        updateJSONScrapBookMeta(this._meta, objects.length);

        let lines = [JSON.stringify(this._meta)];
        lines = [...lines, ...objects.map(o => JSON.stringify(o))];
        return lines.join("\n");
    }

    _sanitized(object) {
        object = {...object};

        delete object.external;
        delete object.external_id;

        return object;
    }

    addNode(object) {
        if (object.type !== NODE_TYPE_SHELF)
            this._objects.set(object.uuid, this._sanitized(object));
    }

    getNode(uuid) {
        return this._objects.get(uuid);
    }

    updateNode(object) {
        if (object.type !== NODE_TYPE_SHELF) {
            const existing = this._objects.get(object.uuid);

            if (existing) {
                const node = existing;
                Object.assign(node, object);
                this.addNode(node);
            }
            else
                this.addNode(object);
        }
    }

    deleteNodes(nodes) {
        if (!Array.isArray(nodes))
            nodes = [nodes];

        for (let node of nodes)
            this._objects.delete(node.uuid);
    }

    get meta() {
        return this._meta;
    }

    get nodes() {
        return Array.from(this._objects.values());
    }

    get sortedNodes() {
        return this._treeSortObjects();
    }

    // objects are ordered parents first; objects unreachable from the shelf root are not included
    _treeSortObjects() {
        const children = new Map();

        for (const object of this._objects.values()) {
            const siblings = children.get(object.parent);

            if (siblings)
                siblings.push(object);
            else
                children.set(object.parent, [object]);
        }

        const result = [];
        const visited = new Set();
        const stack = [...(children.get(CLOUD_SHELF_UUID) || [])].reverse();

        while (stack.length) {
            const object = stack.pop();

            if (visited.has(object.uuid))
                continue;

            visited.add(object.uuid);
            result.push(object);

            const objectChildren = children.get(object.uuid);
            if (objectChildren)
                for (let i = objectChildren.length - 1; i >= 0; --i)
                    stack.push(objectChildren[i]);
        }

        if (result.length < this._objects.size)
            console.warn(`Cloud index: ${this._objects.size - result.length} orphaned item(s) are omitted`);

        return result;
    }
}
