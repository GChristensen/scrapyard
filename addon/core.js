import {systemInitialization} from "./bookmarks_init.js";
import {browserBackend} from "./backend_browser.js";
import {cloudBackend} from "./backend_cloud_shelf.js";
import {receive, receiveExternal, send, sendLocal} from "./proxy.js";
import {settings} from "./settings.js";
import * as search from "./search.js";
import * as bookmarking from "./core_bookmarking.js";
import * as imports from "./core_import.js";
import * as share from "./core_share.js";
import * as backup from "./core_backup.js"
import * as backends from "./core_backends.js";
import * as repair from "./core_maintenance.js";
import * as ishell from "./core_ishell.js";
import * as automation from "./core_automation.js";
import * as sync from "./core_sync.js";
import {getActiveTabMetadata} from "./bookmarking.js";
import {DEFAULT_SHELF_ID} from "./storage.js";

receiveExternal.startListener(true);
receive.startListener(true);

(async () => {
    await systemInitialization;

    if (await navigator.storage.persist()) {
        search.initializeOmnibox();
        // TODO: somehow should be done on the addon load in MV3
        await browserBackend.reconcileBrowserBookmarksDB();
        await cloudBackend.enableBackgroundSync(settings.cloud_background_sync());

        if (settings.background_sync())
            await sendLocal.enableBackgroundSync({enable: true});

        // TODO: somehow should be done on the addon load in MV3
        if (settings.sync_on_startup())
            sendLocal.performSync();

        console.log("==> core.js loaded");
    }
})();

browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        return {
            requestHeaders: details.requestHeaders.filter(x => !originWithId(x))
        }
    },
    {urls: ["<all_urls>"]},
    ["blocking", "requestHeaders"]
);

// remove the Origin header from add-on fetch requests
function originWithId(header) {
    return header.name.toLowerCase() === 'origin' && header.value.startsWith('moz-extension://');
}

browser.commands.onCommand.addListener(function(command) {
    let action = "createBookmark";
    if (command === "archive_to_default_shelf")
        action = "createArchive";

    if (localStorage.getItem("option-open-sidebar-from-shortcut") === "open")
        browser.sidebarAction.open();

    addBookmark(action);
});

async function addBookmark(event) {
    const payload = await getActiveTabMetadata();
    payload.parent_id = DEFAULT_SHELF_ID;

    return sendLocal[event]({data: payload});
}
