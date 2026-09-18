import {setSaveCheckHandler} from "../options.js";
import {settings} from "../../settings.js";
import {helperApp} from "../../helper_app.js";
import {send} from "../../proxy.js";
import {alert} from "../dialog.js";

export async function load() {
    $("a.settings-menu-item[href='#debug']").show();

    $("#debug-browser-version").text(navigator.userAgent);
    $("#debug-addon-version").text(browser.runtime.getManifest().version);
    $("#debug-internal-storage-mode").text(settings.storage_mode_internal()? "Yes": "No");
    $("#debug-server-storage-mode").text(settings.storage_mode_server()? "Yes": "No");
    $("#debug-unpacked-archives").text(settings.save_unpacked_archives()? "Yes": "No");

    const addonID = browser.runtime.getManifest().applications?.gecko?.id;
    const consoleURL = `about:devtools-toolbox?id=${addonID}&type=extension`
    $("#debug-log-url").text(consoleURL)

    setSaveCheckHandler("option-enable-helper-app-logging", "enable_helper_app_logging");
    $("#option-enable-helper-app-logging").prop("checked", settings.enable_helper_app_logging());

    helperApp.signedURL("/backend_log")
        .then(url => $("#helper-app-log-link").prop("href", url))
        .catch(e => {
            console.error(e);
            $("#helper-app-log-link").prop("href", "#").attr("title", e.message);
        });

    $("#compare-database-storage-link").on("click", async e => {
        e.preventDefault();

        await send.startProcessingIndication();

        try {
            const result = await send.compareDatabaseStorage();

            if (result)
                await alert("DB Comparison", "Internal and external storages are identical.");
            else
                await alert("DB Comparison", "Internal and external storages are NOT identical.")
        }
        finally {
            await send.stopProcessingIndication();
        }
    });
}

