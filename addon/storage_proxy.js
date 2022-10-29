import {StorageAdapterDisk} from "./storage_adapter_disk.js";
import {StorageAdapterCloud} from "./storage_adapter_cloud.js";
import {CLOUD_EXTERNAL_TYPE, RDF_EXTERNAL_TYPE} from "./storage.js";
import {StorageAdapterRDF} from "./storage_adapter_rdf.js";
import {nullProxy} from "./proxy.js";
import {settings} from "./settings.js";

export class StorageProxy {
    static _adapterDisk = new StorageAdapterDisk();
    static _adapterCloud = new StorageAdapterCloud();
    static _adapterRDF = new StorageAdapterRDF();

    static setCloudProvider(provider) {
        this._adapterCloud.setProvider(provider);
    }

    adapter(node) {
        if (Array.isArray(node)) {
            const distinctExternals = node
                .map(n => n.external)
                .filter((v, i, a) => a.indexOf(v) === i);

            if (distinctExternals.length > 1)
                throw new Error("Operation on nodes from shelves with heterogeneous storage.");

            node = node?.[0];
        }

        if (!node)
            return;

        if (node.external === CLOUD_EXTERNAL_TYPE)
            return StorageProxy._adapterCloud;
        else if (node.external === RDF_EXTERNAL_TYPE)
            return StorageProxy._adapterRDF;
        else if (!node.external) {
            if (settings.storage_mode_internal())
                return {internalStorage: true};
            else
                return StorageProxy._adapterDisk;
        }
    }

}
