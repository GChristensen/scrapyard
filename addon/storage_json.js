import UUID from "./lib/uuid.js";
import {DEFAULT_POSITION, NODE_PROPERTIES} from "./storage.js";

const JSON_PROPERTIES = ["notes_format",
                         "notes_align",
                         "notes_width",
                         "content_type",
                         "byte_length",
                         "icon_data",
                         ...NODE_PROPERTIES];

export class JSONStorage {
    constructor(meta) {
        this.meta = meta || {};
        this.meta.next_id = 1;
        this.meta.date = new Date().getTime();
        this.objects = [];
    }

    static fromJSON(json) {
        let storage = new JSONStorage();
        storage.objects = JSON.parse(json);

        storage.meta = storage.objects.length? storage.objects.shift() || {}: {};

        if (!storage.meta.next_id)
            storage.meta.next_id = 1;

        if (!storage.meta.date)
            storage.meta.date = new Date().getTime();

        return storage;
    }

    serialize() {
        this.meta.date = new Date().getTime();
        return JSON.stringify([this.meta, ...this.objects], null, 1);
    }

    _sanitizeNode(node) {
        node = Object.assign({}, node);

        for (let key of Object.keys(node)) {
            if (node[key] === 0 && JSON_PROPERTIES.some(k => k === key))
                continue;

            if (!node[key] || !JSON_PROPERTIES.some(k => k === key))
                delete node[key];
        }

        return node;
    }

    _sanitizeDate(date) {
        if (date) {
            let result;

            if (date instanceof Date)
                result = date.getTime()
            else
                result = new Date(date).getTime();

            if (!isNaN(result))
                return result;
        }

        return new Date().getTime();
    }

    async addNode(datum, resetOrder = true) {
        datum = this._sanitizeNode(datum);

        if (resetOrder)
            datum.pos = DEFAULT_POSITION;

        datum.uuid = UUID.numeric();

        let now = new Date().getTime();

        if (!datum.date_added)
            datum.date_added = now;
        else
            datum.date_added = this._sanitizeDate(datum.date_added);

        if (!datum.date_modified)
            datum.date_modified = now;
        else
            datum.date_modified = this._sanitizeDate(datum.date_modified);

        datum.id = this.meta.next_id++;
        this.objects.push(datum);

        return datum;
    }

    async getNode(id, isUUID = false) {
        if (isUUID)
            return this.objects.find(n => n.uuid === id);

        return this.objects.find(n => n.id == id);
    }

    getNodes(ids) {
        return this.objects.filter(n => ids.some(id => id == n.id));
    }

    async updateNode(node, updatePos = false) {
        if (node) {
            node = Object.assign({}, node);

            delete node.id;
            delete node.parent_id;
            delete node.external;
            delete node.external_id;

            if (!updatePos)
                delete node.pos;

            let existing = this.objects.find(n => n.uuid === node.uuid);
            let index = this.objects.indexOf(existing);

            if (existing) {
                existing = Object.assign(existing, node);
                existing = this._sanitizeNode(existing);
                existing.date_added = this._sanitizeDate(existing.date_added);
                existing.date_modified = new Date().getTime();
                this.objects[index] = existing;
                return existing;
            }
        }
    }

    async updateNodes(nodes) {
        for (let node of nodes)
            this.updateNode(node);
    }

    async deleteNodes(nodes) {
        if (!Array.isArray(nodes))
            nodes = [nodes];

        for (let node of nodes) {
            let existing = this.objects.find(n => n.uuid === node.uuid);
            if (existing)
                this.objects.splice(this.objects.indexOf(existing), 1);
        }
    }

    async moveNode(node, dest, root) {
        let existing = this.objects.find(n => n.uuid === node.uuid);
        if (existing) {
            let cloud_dest = root;

            if (!root || dest.id !== root.id)
                cloud_dest = this.objects.find(n => n.uuid === dest.uuid);

            existing.pos = node.pos;
            existing.parent_id = cloud_dest.id;
        }
    }

    async queryNodes() {
        return this.objects;
    }
}
