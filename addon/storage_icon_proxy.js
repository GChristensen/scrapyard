import {MarshallerJSONScrapbook} from "./marshaller_json_scrapbook.js";
import {StorageProxy} from "./storage_proxy.js";
import {Icon} from "./storage_entities.js";

export class IconProxy extends StorageProxy {
    #marshaller = new MarshallerJSONScrapbook();

    async add(node, dataUrl) {
        // the icon is stored before the node is updated with the new content_modified date (see IconIDB.add),
        // so other browsers that synchronize the node always find the icon in the storage
        if (node.uuid)
            await this.#persistIcon(node, dataUrl);

        return this.wrapped.add(node, dataUrl);
    }

    async persist(node, dataUrl) {
        await this.#persistIcon(node, dataUrl);
    }

    async #persistIcon(node, dataUrl) {
        const adapter = this.adapter(node);

        if (adapter) {
            let icon = this.wrapped.entity(node, dataUrl);
            icon = this.#marshaller.convertIcon(icon);

            const params = {
                uuid: node.uuid,
                icon_json: JSON.stringify(icon)
            };

            return adapter.persistIcon(params);
        }
    }
}

