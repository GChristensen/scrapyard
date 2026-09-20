import {receive} from "./proxy.js";
import {isBuiltInShelf} from "./storage.js";
import {Import} from "./import.js";
import {ishellConnector} from "./plugin_ishell.js";

// The RDF importer is given a file path read by the backend and needs no DOM, unlike the importers
// of the other formats, which receive a non-serializable File and therefore have to be hosted by
// the sidebar on Chrome. It runs in the background in every browser, so importing does not depend
// on an open sidebar being addressed by its window.
receive.importRdfFile = async message => {
    const shelf = isBuiltInShelf(message.file_name)? message.file_name.toLocaleLowerCase(): message.file_name;
    const importerBuilder = Import.create("rdf");

    importerBuilder.setName(shelf);
    importerBuilder.setReportProgress(true);
    // the importer is not in the sidebar, so it notifies it with messages
    importerBuilder.setSidebarContext(false);
    importerBuilder.setStream(message.file);
    importerBuilder.setNumberOfThreads(message.threads);
    importerBuilder.setQuickImport(message.quick);
    importerBuilder.setCreateIndex(message.createIndex);

    const importer = importerBuilder.build();

    const invalidationState = ishellConnector.isInvalidationEnabled();
    ishellConnector.enableInvalidation(false);

    // the acknowledgement lets the sender tell a finished import from a message no context handled
    return Import.transaction(importer)
        .then(() => ({imported: true}))
        .finally(() => {
            ishellConnector.enableInvalidation(invalidationState);
            ishellConnector.invalidateCompletion();
        });
};
