import {send} from "./proxy.js";
import {completeStreamRequest, helperApp, streamContent} from "./helper_app.js";
import {isVirtualShelf} from "./storage.js";
import {receive} from "./proxy.js"
import UUID from "./uuid.js";
import {sleep} from "./utils.js";
import {Export, Import} from "./import.js";
import {Query} from "./storage_query.js";
import {LineStream} from "./utils_io.js";

receive.listBackups = message => {
    let form = new FormData();
    form.append("directory", message.directory);

    return helperApp.fetchJSON(`/backup/list`, {method: "POST", body: form});
};

receive.backupShelf = async message => {
    let shelf, shelfName, shelfUUID;

    if (isVirtualShelf(message.shelf))
        shelf = shelfUUID = shelfName = message.shelf;
    else {
        shelf = await Query.shelf(message.shelf);
        shelfUUID = shelf.uuid;
        shelfName = shelf.name;
    }

    let nodes = await Export.nodes(shelf);

    let backupFile = `${UUID.date()}_${shelfUUID}.jsonl`

    const port = await helperApp.getPort();

    if (!port)
        throw new Error(helperApp.isServerMode()
            ? helperApp.serverConnectionErrorMessage()
            : "Can not connect to the backend application.");

    // the content is streamed over the port and received by the HTTP request, which completes after the stream
    // is finished; the stream id prevents content of a failed backup from being received by a subsequent one
    const stream = String(UUID.numeric());

    const process = helperApp.post("/backup/initialize", {
        directory: message.directory,
        file: backupFile,
        compress: message.compress,
        method: message.method,
        level: message.level,
        stream
    });

    const file = {
        append: async function (text) {
            port.postMessage({
                type: "BACKUP_PUSH_TEXT",
                stream,
                text: text
            })
        }
    };

    await sleep(50);

    const exportError = await streamContent(port, stream, "BACKUP", async () => {
        const exporter = Export.create("json")
            .setName(shelfName)
            .setUUID(shelfUUID)
            .setComment(message.comment)
            .setReportProgress(true)
            .setMuteSidebar(true)
            .setObjects(nodes)
            .setStream(file)
            .build();

        await exporter.export();
    });

    await completeStreamRequest(process, exportError);
};

receive.restoreShelf = async message => {
    send.startProcessingIndication({noWait: true});

    let error;
    let shelf;

    try {
        const response = await helperApp.post("/restore/initialize", {
            directory: message.directory,
            file: message.meta.file
        });

        if (!response.ok)
            throw await helperApp.errorFromResponse(response);

        const Reader = class {
            async* lines() {
                while (true) {
                    const response = await helperApp.fetch("/restore/get_line");
                    if (response.ok) {
                        const line = await response.text();
                        if (line)
                            yield line;
                        else
                            break;
                    }
                    else
                        throw await helperApp.errorFromResponse(response);
                }
            }
        };

        const shelfName = message.new_shelf? message.meta.alt_name: message.meta.name;
        const importer = Import.create("json")
            .setName(shelfName)
            .setReportProgress(true)
            .setMuteSidebar(true)
            .setStream(new LineStream(new Reader()))
            .build();

        shelf = await Import.transaction(importer);
    } catch (e) {
        console.log(e.stack);
        error = e;
    }
    finally {
        try {
            await helperApp.fetch("/restore/finalize");
        }
        catch (e) {
            // the backend closes the backup file on the next restore
            console.error(e);
        }

        send.stopProcessingIndication();
        send.nodesImported({shelf});
    }

    if (error)
        throw error;
};

receive.deleteBackup = async message => {
    send.startProcessingIndication({noWait: true});

    try {
        const response = await helperApp.post("/backup/delete", {
            directory: message.directory,
            file: message.meta.file
        });

        if (!response.ok)
            throw await helperApp.errorFromResponse(response);
    } catch (e) {
        console.error(e);
        return false;
    }
    finally {
        send.stopProcessingIndication();
    }

    return true;
}
