import {send} from "../../proxy.js";
import {settings} from "../../settings.js";
import {showNotification} from "../../utils_browser.js";
import {alert, confirm, showDlg} from "../dialog.js";
import {formatBytes} from "../../utils.js";
import {DiskStorage} from "../../storage_external.js";

function configureAutomationPanel() {
    $("#option-enable-automation").prop("checked", settings.enable_automation());
    $("#option-extension-whitelist").val(settings.extension_whitelist()?.join(", "));

    $("#option-enable-automation").on("change", async e => {
        await settings.load();
        settings.enable_automation(e.target.checked);
    });

    $("#option-extension-whitelist").on("input", async e => {
        await settings.load();

        if (e.target.value) {
            let ids = e.target.value.split(",").map(s => s.trim()).filter(s => !!s);
            if (ids.length)
                settings.extension_whitelist(ids);
            else
                settings.extension_whitelist(null);
        }
        else
            settings.extension_whitelist(null);
    });
}

function configureMaintenancePanel() {
    $("#option-repair-icons").prop("checked", settings.repair_icons());
    $("#option-repair-icons").on("change", async e => {
        await settings.load();
        settings.repair_icons(e.target.checked);
    });

    $("#option-enable-debug").prop("checked", settings.debug_mode());
    $("#option-enable-debug").on("change", async e => {
        await settings.load();
        settings.debug_mode(e.target.checked);
    });

    $("#statistics-link").on("click", async e => {
        e.preventDefault();

        const statistics = await send.computeStatistics();

        let html = `<table class="stats-table">
                    <tr><td>Items:</td><td>${statistics.items}</td></tr>
                    <tr><td>Bookmarks:</td><td>${statistics.bookmarks}</td></tr>
                    <tr><td>Archives:</td><td>${statistics.archives}</td></tr>
                    <tr><td>Notes:</td><td>${statistics.notes}</td></tr>
                    <tr><td>Archived content:</td><td>${formatBytes(statistics.size)}</td></tr>
                    </table>`

        alert("Statistics", html);
    });

    // $("#reset-cloud-link").on("click", async e => {
    //     e.preventDefault();
    //
    //     if (await confirm("Warning", "This will remove all contents of the Cloud shelf. Continue?")) {
    //         let success = await send.resetCloud();
    //
    //         if (!success)
    //             showNotification("Error accessing cloud.")
    //     }
    // });

    $("#reset-scrapyard-link").on("click", async e => {
        e.preventDefault();

        if (await confirm("Warning",
            "This will reset the Scrapyard browser internal storage. Continue?"))
            await send.resetScrapyard();
    });

    $("#remove-orphaned-link").on("click", async e => {
        e.preventDefault();

        if (settings.storage_mode_internal())
            return;

        const orphanedItems = await send.getOrphanedItems();

        if (orphanedItems?.length) {
            const message = `${orphanedItems.length} orphaned items found. Remove?`
            if (await showDlg("confirm", {title: "Orphaned Items", message})) {
                await send.startProcessingIndication();

                try {
                    await DiskStorage.deleteOrphanedItems(orphanedItems);
                }
                finally {
                    await send.stopProcessingIndication();
                }
            }
        }
        else
            return showDlg("alert", {title: "Orphaned Items", message: "No orphaned items found."});
    });

    $("#rebuild-item-index-link").on("click", async e => {
        e.preventDefault();

        if (settings.storage_mode_internal())
            return;

        const message = `This will restore orphaned items. Continue?`
        if (await showDlg("confirm", {title: "Rebuild Item Index", message})) {
            await send.startProcessingIndication();

            try {
                await send.rebuildItemIndex();
            }
            finally {
                await send.stopProcessingIndication();
                send.performSync();
            }
        }

    });

    if (settings.transition_to_disk())
        $("#backup-link-wrapper").hide();

    $("#compare-database-storage-link").on("click", async e => {
        e.preventDefault();

        await send.startProcessingIndication();

        try {
            const result = await send.compareDatabaseStorage();

            if (result)
                await alert("DB Comparison", "IDB and storage are identical.");
            else
                await alert("DB Comparison", "IDB and storage are NOT identical.")
        }
        finally {
            await send.stopProcessingIndication();
        }
    });

    if (settings.debug_mode())
        $("#compare-database-storage").show()
}

function configureImpExpPanel() {
    $("#export-settings-link").click(async e => {
        e.preventDefault();

        const exported = {};
        exported.addon = "Scrapyard";
        exported.version = browser.runtime.getManifest().version;

        const now = new Date();
        exported.timestamp = now.getTime();
        exported.date = now.toString();

        const settings = await browser.storage.local.get() || {};

        if (settings["scrapyard-settings"]) {
            delete settings["scrapyard-settings"]["ishell_presents"];
            delete settings["scrapyard-settings"]["dropbox_refresh_token"];
            delete settings["scrapyard-settings"]["onedrive_refresh_token"];
            delete settings["scrapyard-settings"]["pending_announcement"];
        }

        settings["localstorage-settings"] = {
            "editor-font-size": localStorage.getItem("editor-font-size"),
            "notes-font-size": localStorage.getItem("notes-font-size"),
            "scrapyard-sidebar-theme": localStorage.getItem("scrapyard-sidebar-theme")
        };

        Object.assign(exported, settings);

        // download link
        const file = new Blob([JSON.stringify(exported, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(file);
        const isoDate = now.toISOString().split("T")[0];
        const filename = `scrapyard-settings-${isoDate}.json`

        const download = await browser.downloads.download({url: url, filename: filename, saveAs: true});

        const download_listener = delta => {
            if (delta.id === download && delta.state && delta.state.current === "complete") {
                browser.downloads.onChanged.removeListener(download_listener);
                URL.revokeObjectURL(url);
            }
        };
        browser.downloads.onChanged.addListener(download_listener);
    });

    $("#import-settings-link").click((e) => {
        e.preventDefault();
        $("#import-settings-file-picker").click();
    });

    $("#import-settings-file-picker").change(async e => {
        if (e.target.files.length > 0) {
            let reader = new FileReader();
            reader.onload = async function(re) {
                const imported = JSON.parse(re.target.result);

                if (imported.addon !== "Scrapyard") {
                    showNotification("Export format is not supported.");
                    return;
                }

                // versioned operations here

                delete imported.addon;
                delete imported.version;

                const localStorageSettings = imported["localstorage-settings"];

                if (localStorageSettings["editor-font-size"])
                    localStorage.setItem("editor-font-size", localStorageSettings["editor-font-size"]);

                if (localStorageSettings["notes-font-size"])
                    localStorage.setItem("notes-font-size", localStorageSettings["notes-font-size"]);

                if (localStorageSettings["scrapyard-sidebar-theme"])
                    localStorage.setItem("scrapyard-sidebar-theme", localStorageSettings["scrapyard-sidebar-theme"]);

                delete imported["localstorage-settings"];

                let scrapyardSettings = await browser.storage.local.get() || {};
                Object.assign(scrapyardSettings["savepage-settings"], imported["savepage-settings"]);
                Object.assign(scrapyardSettings["scrapyard-settings"], imported["scrapyard-settings"]);

                await browser.storage.local.set(scrapyardSettings);

                await settings.load();

                // propagate to localstorage
                if (settings.platform.firefox && settings.open_sidebar_from_shortcut())
                    settings.open_sidebar_from_shortcut(true);

                browser.runtime.reload();
            };
            reader.readAsText(e.target.files[0]);
        }
    });

}

export async function load() {
    configureMaintenancePanel();
    configureAutomationPanel();
    configureImpExpPanel();
}
