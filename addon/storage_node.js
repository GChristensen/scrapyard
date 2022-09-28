import {EntityIDB} from "./storage_idb.js";
import {NODE_PROPERTIES} from "./storage.js";
import UUID from "./uuid.js";
import {delegateProxy} from "./proxy.js";
import {NodeProxy} from "./storage_node_proxy.js";
import {StorageAdapterDisk} from "./storage_adapter_disk.js";

export class NodeIDB extends EntityIDB {
    static newInstance() {
        const instance = new NodeIDB();

        // bypass the disk proxy
        instance.idb = new NodeIDB();

        return delegateProxy(new NodeProxy(new StorageAdapterDisk()), instance);
    }

    static newInstance_transition() {
        const instance = new NodeIDB();

        instance.idb = new NodeIDB();

        return instance;
    }

    resetDates(node) {
        node.date_added = new Date();
        node.date_modified = node.date_added;
    }

    setUUID(node) {
        node.uuid = UUID.numeric();
    }

    strip(node) {
        delete node.tag_list;
    }

    async getIdFromUUID(uuid) {
        let node = await this._db.nodes.where("uuid").equals(uuid).first();
        return node?.id;
    }

    async getUUIDFromId(id) {
        let node = await this._db.nodes.where("id").equals(id).first();
        return node?.uuid;
    }

    sanitize(node) {
        for (let key of Object.keys(node)) {
            if (!NODE_PROPERTIES.some(k => k === key))
                delete node[key];
        }

        return node;
    }

    sanitized(node) {
        node = Object.assign({}, node);
        return this.sanitize(node);
    }

    async add(node) {
        delete node.pos;
        this.setUUID(node);
        this.resetDates(node);

        node.id = await this._add(node);
        return node;
    }

    async import(node) {
        node.id = await this._add(node);
        return node;
    }

    async _add(node) {
        return this._db.nodes.add(this.sanitized(node))
    }

    async put(node) {
        await this._db.nodes.put(this.sanitized(node));
        return node;
    }

    // retains node in IDB, but removes from storage
    async unpersist(node) {
        // NOP, used in proxy
    }

    exists(node) {
        if (!node.uuid)
            return false;

        return this._db.nodes.where("uuid").equals(node.uuid).count();
    }

    async get(ids) {
        if (!ids)
            return this._db.nodes.toArray();

        if (Array.isArray(ids))
            return this._db.nodes.where("id").anyOf(ids).toArray();
        else
            return this._db.nodes.where("id").equals(ids).first();
    }

    async getByUUID(uuid) {
        return this._db.nodes.where("uuid").equals(uuid).first();
    }

    getChildren(id) {
        return this._db.nodes.where("parent_id").equals(id).toArray();
    }

    async update(node, resetDateModified = true) {
        if (Array.isArray(node)) {
            for (let node_ of node)
                await this.update(node_, resetDateModified)
        }
        else if (node?.id) {
            if (resetDateModified)
                node.date_modified = new Date();

            await this._db.nodes.update(node.id, this.sanitized(node));
        }
        else {
            console.error("Updating a node without id or a null reference", node);
        }

        return node;
    }

    async batchUpdate(updater, ids) {
        const withPostprocessing = node => {
            updater(node)
            node.date_modified = new Date();
            this.sanitize(node);
        };

        if (ids)
            this._db.nodes.where("id").anyOf(ids).modify(withPostprocessing)
        else
            await this._db.nodes.toCollection().modify(withPostprocessing);
    }

    async updateContentModified(node) {
        node.date_modified = new Date();
        node.content_modified = node.date_modified;

        return this.update(node, false);
    }

    iterate(iterator, filter) {
        if (filter)
            return this._db.nodes.filter(filter).each(iterator);
        else
            return this._db.nodes.each(iterator);
    }

    filter(filter) {
        return this._db.nodes.filter(filter).toArray();
    }

    async delete(nodes) {
        if (!Array.isArray(nodes))
            nodes = [nodes];

        await this.deleteDependencies(nodes);

        return this.deleteShallow(nodes);
    }

    async deleteShallow(nodes) {
        if (!Array.isArray(nodes))
            nodes = [nodes];

        const ids = nodes.map(n => n.id);
        return this._db.nodes.bulkDelete(ids);
    }

    async deleteDependencies(nodes) {
        if (!Array.isArray(nodes))
            nodes = [nodes];

        const ids = nodes.map(n => n.id);
        await this._db.blobs?.where("node_id").anyOf(ids).delete();
        await this._db.notes?.where("node_id").anyOf(ids).delete();
        await this._db.icons?.where("node_id").anyOf(ids).delete();
        await this._db.comments?.where("node_id").anyOf(ids).delete();
        await this._db.index?.where("node_id").anyOf(ids).delete();
        await this._db.index_notes?.where("node_id").anyOf(ids).delete();
        await this._db.index_comments?.where("node_id").anyOf(ids).delete();
    }
}

