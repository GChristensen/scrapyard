import {Node} from "./storage_entities.js";
import {MarshallerJSONScrapbook} from "./marshaller_json_scrapbook.js";
import {StorageProxy} from "./storage_proxy.js";
import {clearNodePending} from "./storage_pending.js";

export class NodeProxy extends StorageProxy {
    #marshaller = new MarshallerJSONScrapbook();

    async _add(node) {
        const result = await this.wrapped._add(node);

        await this.#persistNode(node);

        return result;
    }

    async put(node) {
        const result = await this.wrapped.put(node);

        await this.#persistNode(node);

        return result;
    }

    async update(node, resetDateModified = true, upsert = false) {
        const result = await this.wrapped.update(node, resetDateModified);

        if (Array.isArray(node))
            await this.#updateNodes(node);
        else {
            await this.#updateNode(node, upsert);

            // the node is added to the storage, the synchronization may process it as any other node
            if (upsert)
                clearNodePending(node);
        }

        return result;
    }

    async batchUpdate(updater, ids) {
        const result = await this.wrapped.batchUpdate(updater, ids);
        const nodes = await Node.get(ids);

        await this.#updateNodes(nodes);

        return result;
    }

    async unpersist(node) {
        return this.#unpersistNode(node);
    }

    async deleteShallow(nodes) {
        const result = await this.wrapped.deleteShallow(nodes);

        await this.#deleteNodesShallow(nodes);

        return result;
    }

    async deleteDependencies(nodes) {
        const result = await this.wrapped.deleteDependencies(nodes);

        await this.#deleteNodeContent(nodes);

        return result;
    }

    async #persistNode(node) {
        const adapter = this.adapter(node);

        if (adapter) {
            node = this.#marshaller.serializeNode(node);
            node = await this.#marshaller.convertNode(node);

            const params = {
                node: node
            };

            return adapter.persistNode(params);
        }
    }

    async #updateNode(node, upsert) {
        const adapter = this.adapter(node);

        if (adapter) {
            const params = {
                remove_fields: Object.keys(node).filter(k => node.hasOwnProperty(k) && node[k] === undefined)
            };

            if (upsert)
                params.upsert = true;

            if (!node.uuid)
                node.uuid = await Node.getUUIDFromId(node.id);

            node = this.#marshaller.serializeNode(node);
            params.node = await this.#marshaller.convertNode(node);

            return adapter.updateNode(params);
        }
    }

    async #updateNodes(nodes) {
        const adapter = this.adapter(nodes);

        if (adapter) {
            const params = {
                remove_fields: nodes.map(node =>
                    Object.keys(node).filter(k => node.hasOwnProperty(k) && node[k] === undefined))
            };

            params.nodes = await Promise.all(nodes.map(async node => {
                node = this.#marshaller.serializeNode(node);
                node = await this.#marshaller.convertNode(node);
                return node;
            }));

            return adapter.updateNodes(params);
        }
    }

    // The deleted nodes are the full subtrees of the selected items. The roots of the subtrees are also passed
    // separately (root_uuids), so a backend shared by several browsers can resolve the subtrees against the actual
    // state of the storage, which may differ from the local one; older backends ignore the field.
    #deletionParams(nodes) {
        const ids = new Set(nodes.map(n => n.id));

        return {
            node_uuids: nodes.map(n => n.uuid),
            root_uuids: nodes.filter(n => !ids.has(n.parent_id)).map(n => n.uuid)
        };
    }

    async #unpersistNode(node) {
        const adapter = this.adapter(node);

        if (adapter)
            return adapter.deleteNodes(this.#deletionParams([node]));
    }

    async #deleteNodesShallow(nodes) {
        if (!Array.isArray(nodes))
            nodes = [nodes];

        const adapter = this.adapter(nodes);

        if (adapter)
            return adapter.deleteNodesShallow(this.#deletionParams(nodes));
    }

    async #deleteNodeContent(nodes) {
        if (!Array.isArray(nodes))
            nodes = [nodes];

        const adapter = this.adapter(nodes);

        if (adapter)
            return adapter.deleteNodeContent(this.#deletionParams(nodes));
    }
}

