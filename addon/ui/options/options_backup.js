import {send} from "../../proxy.js";
import {settings} from "../../settings.js";
import {confirm} from "../dialog.js";
import {selectricRefresh, ShelfList, simpleSelectric} from "../shelf_list.js";
import {formatBytes, toHHMMSS} from "../../utils.js";
import {showNotification} from "../../utils_browser.js";
import {CLOUD_SHELF_NAME, DONE_SHELF_NAME, EVERYTHING_SHELF_NAME, BROWSER_SHELF_NAME, TODO_SHELF_NAME} from "../../storage.js";
import {Query} from "../../storage_query.js";

export class BackupManager {
    constructor() {
        const backupDirectoryPathInput = $("#backup-directory-path");

        backupDirectoryPathInput.val(settings.backup_directory_path());

        if (settings.storage_mode_server()) {
            // in the server mode backups are stored in the BACKUP_PATH directory on the server
            $("#backup-dir-title").text("Backup Subdirectory on the Server");
            $("#backup-directory-path-container .tips").html("A subdirectory of the server backup directory "
                + "(BACKUP_PATH).<br>Leave empty to use the backup directory itself.");
            backupDirectoryPathInput.attr("placeholder", "optional");
        }

        let pathTimeout;
        backupDirectoryPathInput.on("input", e => {
            clearTimeout(pathTimeout);
            pathTimeout = setTimeout(async () => {
                await settings.load();
                settings.backup_directory_path(e.target.value);
                this.listBackups();
            }, 1000)
        });

        let filterTimeout;
        $("#backup-filter").on("input", e => {
            clearTimeout(filterTimeout);
            filterTimeout = setTimeout(() => {
                this.filterBackups(e.target.value);
            }, 1000)
        });

        $("#backup-directory-path-refresh").on("click", e => this.listBackups());

        $("#backup-button").on("click", async e => this.backupSelectedShelf());

        const compressBackupCheck = $("#compress-backup");
        compressBackupCheck.prop("checked", settings.enable_backup_compression());
        compressBackupCheck.on("change", e => {
            settings.load();
            settings.enable_backup_compression(e.target.checked)
        })

        this.shelfList = new ShelfList("#backup-shelf", {
            maxHeight: settings.shelf_list_height() || settings.default.shelf_list_height,
            _prefix: "backup"
        });

        this.shelfList.initDefault();

        this.backupTree = $("#backup-tree").jstree({
            plugins: ["wholerow", "contextmenu"],
            core: {
                worker: false,
                animation: 0,
                multiple: true,
                themes: {
                    name: "default",
                    dots: false,
                    icons: true,
                },
                check_callback: true
            },
            contextmenu: {
                show_at_node: false,
                items: this.backupTreeContextMenu.bind(this)
            }
        }).jstree(true);
    }

    async init() {
        const helper = await send.helperAppHasVersion({version: "0.4"});

        if (helper) {
            await this.listBackups();
            $("#backup-button").attr("disabled", false);
        }
        else {
            if (settings.storage_mode_server())
                this.setStatus(`<div>Can not connect to the Scrapyard <a href="#settings">server</a></div>`);
            else
                this.setStatus(`<div>Scrapyard <a href="#backend">backend application</a> is required</div>`);
            $("#backup-button").attr("disabled", true);
        }
    }

    backupTreeContextMenu(jnode) {
        if (this.backupIsInProcess || this.restoreIsInProcess)
            return null;

        let notRestorable = () => {
            const selected = this.backupTree.get_selected(true);
            const name = jnode.data.name.toLowerCase();
            return name === BROWSER_SHELF_NAME || name === CLOUD_SHELF_NAME
                || name === TODO_SHELF_NAME.toLowerCase() || name === DONE_SHELF_NAME.toLowerCase()
                || selected?.length > 1;
        };

        return {
            restore: {
                label: "Restore",
                _disabled: notRestorable(),
                action: () => this.restoreSelectedShelf(jnode)
            },
            restoreAsSeparateShelf: {
                label: "Restore as a Separate Shelf",
                _disabled: this.backupTree.get_selected(true).length > 1,
                action: () => this.restoreSelectedShelf(jnode, true)
            },
            delete: {
                separator_before: true,
                label: "Delete",
                action: () => setTimeout(() => this.deleteSelectedBackups())
            },
        };
    }

    metaToJsTreeNode(node) {
        const jnode = {};
        let date = new Date(node.timestamp);
        date = date.toISOString().split("T")[0];
        let comment = node.comment? `<span class="backup-comment">${node.comment}</span>`: "";

        node.name = node.name || node.title;
        node.alt_name = `${node.name} [${date}]`;

        jnode.id = `${node.uuid}-${node.timestamp}`;
        jnode.text = `<b>${node.name}</b> [${date}] ${comment}`;
        jnode.icon = "/icons/shelf.svg";
        jnode.data = node;
        jnode.parent = "#"

        const fileSize = "File size: " + formatBytes(node.file_size);
        const tooltip = node.comment? node.comment + "\x0A" + fileSize: fileSize;

        jnode.li_attr = {
            class: "show_tooltip",
            title: tooltip
        };

        return jnode;
    }

    setStatus(html) {
        $("#backup-status").html(html);
    }

    updateTime() {
        let delta = Date.now() - this.processingTime;
        $("#backup-processing-time").text(toHHMMSS(delta));
    }

    updateOverallSize() {
        if (this.overallBackupSize)
            $("#backup-overall-file-size").html(`<b>Overall backup size:</b> ${formatBytes(this.overallBackupSize)}`);
        else
            $("#backup-overall-file-size").html("&nbsp;");
    }

    backupDirectory() {
        return settings.backup_directory_path() || "";
    }

    async listBackups() {
        if (!this.listingBackups) {
            const directory = this.backupDirectory();
            let error = false;

            try {
                this.listingBackups = true;
                this.setStatus("Loading backups...");

                let backups = await send.listBackups({directory});
                if (backups) {
                    this.availableBackups = [];
                    for (let [k, v] of Object.entries(backups)) {
                        v.file = k;
                        this.availableBackups.push(v);
                    }

                    this.overallBackupSize = this.availableBackups.reduce((a, b) => a + b.file_size, 0);

                    this.availableBackups.sort((a, b) => b.timestamp - a.timestamp);
                    this.availableBackups = this.availableBackups.map(n => this.metaToJsTreeNode(n));

                    this.backupTree.settings.core.data = this.availableBackups;
                    this.backupTree.refresh(true);

                    this.updateOverallSize();
                }
                else {
                    this.backupTree.settings.core.data = [];
                    this.backupTree.refresh(true);
                }
            }
            catch (e) {
                error = true;
                this.setStatus("Error connecting the backend application.");
            }
            finally {
                this.listingBackups = false;
                if (!error)
                    this.setStatus("Ready");
            }
        }
    }

    filterBackups(text) {
        if (text) {
            text = text.toLowerCase();
            this.backupTree.settings.core.data =
                this.availableBackups.filter(b => b.text.replace(/<[^>]+>/g, "").toLowerCase().includes(text));
            this.backupTree.refresh(true);
        }
        else {
            this.backupTree.settings.core.data = this.availableBackups;
            this.backupTree.refresh(true);
        }
    }

    async backupSelectedShelf() {
        await settings.load();

        if (!settings.storage_mode_server() && !settings.backup_directory_path()) {
            showNotification("Please, specify backup directory path.")
            return;
        }

        this.setStatus(`<div id="backup-progress-container">Progress:<progress id="backup-progress-bar"
                                        max="100" value="0" style="margin-left: 10px; flex-grow: 1;"/></div>
                                   <div id="backup-processing-time" style="margin-right: 15px">00:00</div>`);

        this.processingTime = Date.now();
        this.processingInterval = setInterval(() => this.updateTime(), 1000);
        send.startProcessingIndication({noWait: true});

        const compress = !!$("#compress-backup:checked").length;

        let exportListener = message => {
            if (message.type === "exportProgress") {
                if (message.finished) {
                    if (compress) {
                        $("#backup-progress-container").remove();
                        $("#backup-status").prepend(`<span>Compressing...</span>`);
                    }
                }
                else
                    $("#backup-progress-bar").val(message.progress);
            }
        };

        browser.runtime.onMessage.addListener(exportListener);

        try {
            this.backupIsInProcess = true;
            $("#backup-button").prop("disabled", true);

            await send.backupShelf({
                directory: this.backupDirectory(),
                shelf: this.shelfList.selectedShelfName,
                comment: $("#backup-comment").val(),
                compress,
                method: settings.backup_compression_method() || "DEFLATE",
                level: settings.backup_compression_level() || "5"
            });

            await this.listBackups();
        }
        catch (e) {
            console.error(e);
            showNotification("Backup has failed: " + e.message);
        }
        finally {
            browser.runtime.onMessage.removeListener(exportListener);
            $("#backup-button").prop("disabled", false);
            clearInterval(this.processingInterval);
            send.stopProcessingIndication();
            this.backupIsInProcess = false;
            this.setStatus("Ready");
        }
    }

    async restoreSelectedShelf(jnode, newShelf) {
        const shelves = await Query.allShelves();
        const backupName = newShelf? jnode.data.alt_name: jnode.data.name;

        shelves.push({name: EVERYTHING_SHELF_NAME});

        if (shelves.find(s => s.name.toLowerCase() === backupName.toLowerCase())) {
            if (!await confirm("Warning", `This will replace "${backupName}". Continue?`))
                return;
        }

        const PROGRESS_BAR_HTML = `Progress: <progress id=\"backup-progress-bar\" max=\"100\"
                                               value=\"0\" style=\"margin-left: 10px; flex-grow: 1;\"/>`;

        let progressIndication = false;
        let importListener = message => {
            if (message.type === "importProgress") {
                if (!progressIndication) {
                    $("#backup-progress-container").html(PROGRESS_BAR_HTML);
                    progressIndication = true;
                }
                const bar = $("#backup-progress-bar");
                bar.val(message.progress);
            }
        };

        browser.runtime.onMessage.addListener(importListener);

        this.processingTime = Date.now();
        this.processingInterval = setInterval(() => this.updateTime(), 1000);

        const statusHTML =
            settings.undo_failed_imports()
                ? "Initializing..."
                : PROGRESS_BAR_HTML;

        this.setStatus(`<div id="backup-progress-container">${statusHTML}</div>
                              <div id="backup-processing-time" style="margin-right: 15px">00:00</div>`);

        try {
            this.restoreIsInProcess = true;
            $("#backup-button").prop("disabled", true);

            await send.restoreShelf({
                directory: this.backupDirectory(),
                meta: jnode.data,
                new_shelf: newShelf
            });
        }
        catch (e) {
            console.error(e);
            showNotification("Restore has failed: " + e.message);
        }
        finally {
            browser.runtime.onMessage.removeListener(importListener);
            $("#backup-button").prop("disabled", false);
            clearInterval(this.processingInterval);
            this.restoreIsInProcess = false;
            this.setStatus("Ready");
        }
    }

    async deleteSelectedBackups() {
        if (!await confirm("Warning", "Delete the selected backups?"))
            return;

        const selected = this.backupTree.get_selected(true);

        for (let jnode of selected) {
            const success = await send.deleteBackup({
                directory: this.backupDirectory(),
                meta: jnode.data
            });

            if (success) {
                this.overallBackupSize -= jnode.data.file_size;
                this.backupTree.delete_node(jnode);
            }
        }

        this.updateOverallSize();
    }

}

function configureBackupCompressionPanel() {
    const compMethod = $("#option-compression-method").val(settings.backup_compression_method() || "DEFLATE");
    const compLevel = $("#option-compression-level").val(settings.backup_compression_level() || "5");

    $("#option-compression-method option[value='EMPTY']").remove();
    $("#option-compression-level option[value='EMPTY']").remove();

    simpleSelectric(compMethod);
    selectricRefresh(compMethod);
    simpleSelectric(compLevel);
    selectricRefresh(compLevel);

    $("#option-compression-method").on("change", async e => {
        await settings.load();
        settings.backup_compression_method(e.target.value)
    });
    $("#option-compression-level").on("change", async  e => {
        await settings.load();
        settings.backup_compression_level(parseInt(e.target.value))
    });
}

export function load() {
    $("a.settings-menu-item[href='#backup']").show();
    configureBackupCompressionPanel();

    new BackupManager().init();
}
