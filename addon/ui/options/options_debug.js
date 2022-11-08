import {setSaveCheckHandler} from "../options.js";
import {settings} from "../../settings.js";
import {helperApp} from "../../helper_app.js";

export async function load() {
    $("a.settings-menu-item[href='#debug']").show();

    $("#debug-browser-version").text(navigator.userAgent);
    $("#debug-addon-version").text(browser.runtime.getManifest().version);
    $("#debug-internal-storage-mode").text(settings.storage_mode_internal()? "Yes": "No");
    $("#debug-unpacked-archives").text(settings.save_unpacked_archives()? "Yes": "No");

    const addonID = browser.runtime.getManifest().applications?.gecko?.id;
    const consoleURL = `about:devtools-toolbox?id=${addonID}&type=extension`
    $("#debug-log-url").text(consoleURL)

    setSaveCheckHandler("option-enable-helper-app-logging", "enable_helper_app_logging");
    $("#option-enable-helper-app-logging").prop("checked", settings.enable_helper_app_logging());

    $("#helper-app-log-link").prop("href", helperApp.url("/backend_log"));
}

