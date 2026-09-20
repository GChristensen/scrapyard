import {isBuiltInShelf} from "./storage.js";
import {LineStream, LineReader, readFile} from "./utils_io.js";
import {ishellConnector} from "./plugin_ishell.js";
import {settings} from "./settings.js";
import {receive} from "./proxy.js";
import {Import, Export} from "./import.js";
import {completeStreamRequest, helperApp, streamContent} from "./helper_app.js";
import {showNotification} from "./utils_browser.js";
import {sleep} from "./utils.js";
import UUID from "./uuid.js";
import {ExportArea} from "./storage_export.js";

receive.importFile = async message => {
    const shelf = isBuiltInShelf(message.file_name)? message.file_name.toLocaleLowerCase(): message.file_name;
    const format = message.file_ext.toLowerCase();
    const importerBuilder = Import.create(format);

    if (importerBuilder) {
        importerBuilder.setName(shelf)
        importerBuilder.setReportProgress(true);
        importerBuilder.setSidebarContext(!_BACKGROUND_PAGE);

        switch (format) {
            case "json":
            case "jsonl":
            case "jsbk":
                importerBuilder.setStream(new LineStream(new LineReader(message.file)));
                break;
            case "org":
            case "html":
                importerBuilder.setStream(await readFile(message.file));
                break;
            case "rdf":
                importerBuilder.setStream(message.file);
                importerBuilder.setNumberOfThreads(message.threads);
                importerBuilder.setQuickImport(message.quick);
                importerBuilder.setCreateIndex(message.createIndex);
                break;
        }

        const importer = importerBuilder.build();

        let invalidationState = ishellConnector.isInvalidationEnabled();
        ishellConnector.enableInvalidation(false);
        // the acknowledgement lets the sender tell a finished import from a message that no context
        // has handled: on Chrome the handler lives in the sidebar and is addressed by window
        return Import.transaction(importer)
            .then(() => ({imported: true}))
            .finally(() => {
                ishellConnector.enableInvalidation(invalidationState);
                ishellConnector.invalidateCompletion();
            });
    }
};

receive.exportFile = async message => {
    let shelf = message.shelf;
    let shelfName = message.shelf;

    if (typeof shelf === "string") {
        shelfName = shelf;

        if (isBuiltInShelf(shelfName))
            shelfName = shelfName.toLocaleLowerCase();
    }
    else
        shelfName = shelf.name;

    let format = message.format || "json";

    let shallowExport = false;
    if (format === "org_links") {
        shallowExport = true;
        format = "org";
    }

    let fileExt = ".jsbk";
    if (format === "org")
        fileExt = ".org";

    const fileName = message.fileName.replace(/[\\\/:*?"<>|^#%&!@+={}'~]/g, "_") + fileExt;

    let nodes = await Export.nodes(shelf, format === "org");

    const exportBuilder = Export.create(format)
        .setName(shelfName)
        .setUUID(message.uuid)
        .setLinksOnly(shallowExport)
        .setReportProgress(true)
        .setObjects(nodes)
        .setSidebarContext(!_BACKGROUND_PAGE);


    if (settings.storage_mode_internal())
        await exportStandalone(exportBuilder, fileName, format);
    else
        await exportWithHelperApp(exportBuilder, fileName, format);
};

async function exportWithHelperApp(exportBuilder, fileName, format) {
    const port = await helperApp.getPort();

    if (!port)
        throw new Error(helperApp.isServerMode()
            ? helperApp.serverConnectionErrorMessage()
            : "Can not connect to the backend application.");

    // the exported file is identified by the stream id, see core_backup.js
    const stream = String(UUID.numeric());
    const initialization = helperApp.fetch(`/export/initialize?stream=${stream}`);

    const file = {
        append: async function (text) {
            port.postMessage({
                type: "EXPORT_PUSH_TEXT",
                stream,
                text: text
            })
        }
    };

    await sleep(50);

    const exportError = await streamContent(port, stream, "EXPORT", async () => {
        exportBuilder.setStream(file);
        const exporter = exportBuilder.build();
        await exporter.export();
    });

    await completeStreamRequest(initialization, exportError);

    const finalize = () => helperApp.fetch(`/export/finalize?stream=${stream}`).catch(e => console.error(e));
    let download;

    try {
        const url = await helperApp.signedURL(`/export/download?stream=${stream}`);
        download = await browser.downloads.download({url: url, filename: fileName, saveAs: true});
    } catch (e) {
        console.error(e);
        finalize();

        // the download is cancelled by the user
        if (!/cancel/i.test(e.message))
            throw e;
    }

    if (download) {
        let download_listener = delta => {
            if (delta.id === download) {
                if (delta.state && delta.state.current === "complete" || delta.error) {
                    browser.downloads.onChanged.removeListener(download_listener);
                    finalize();

                    if (delta.error && delta.error.current !== "USER_CANCELED")
                        showNotification(`Export download has failed: ${delta.error.current}`);
                }
            }
        };
        browser.downloads.onChanged.addListener(download_listener);
    }
}

async function exportStandalone(exportBuilder, fileName, format) {
    const MAX_BLOB_SIZE = 1024 * 1024 * 10; // ~20 mb of UTF-16
    const exportId = UUID.numeric();

    let file = {
        content: [],
        size: 0,
        append: async function (text) { // store intermediate export results to IDB
            this.content.push(text);
            this.size += text.length;

            if (this.size >= MAX_BLOB_SIZE) {
                await ExportArea.addBlob(exportId, new Blob(this.content, {type: "text/plain"}));
                this.content = [];
                this.size = 0;
            }
        },
        flush: async function () {
            if (this.size && this.content.length)
                await ExportArea.addBlob(exportId, new Blob(this.content, {type: "text/plain"}));
        }
    };

    await ExportArea.wipe();
    exportBuilder.setStream(file);
    const exporter = exportBuilder.build();
    await exporter.export();
    await file.flush();

    const mimeType = format === "json"? "application/json": "text/plain";
    let blob = new Blob(await ExportArea.getBlobs(exportId), {type: mimeType});
    let url = URL.createObjectURL(blob);
    let download;

    try {
        download = await browser.downloads.download({url: url, filename: fileName, saveAs: true});
    } catch (e) {
        console.error(e);
        ExportArea.removeBlobs(exportId);
    }

    if (download) {
        let download_listener = delta => {
            if (delta.id === download) {
                if (delta.state && delta.state.current === "complete" || delta.error) {
                    browser.downloads.onChanged.removeListener(download_listener);
                    URL.revokeObjectURL(url);
                    ExportArea.removeBlobs(exportId);
                }
            }
        };
        browser.downloads.onChanged.addListener(download_listener);
    }
}
