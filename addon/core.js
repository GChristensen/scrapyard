import {grantPersistenceQuota, startupLatch} from "./utils_browser.js";
import {receive, receiveExternal, sendLocal} from "./proxy.js";
import {systemInitialization} from "./bookmarks_init.js";
import {browserShelf} from "./plugin_browser_shelf.js";
import {cloudShelf} from "./plugin_cloud_shelf.js";
import {addBookmarkOnCommand, setBookmarkedActionIcon} from "./bookmarking.js";
import {openSidePanel, toggleSidebarWindow} from "./utils_sidebar.js";
import {undoManager} from "./bookmarks_undo.js";
import {helperApp} from "./helper_app.js";
import {settings} from "./settings.js";
import * as search from "./search.js";
import "./core_bookmarking.js";
import "./core_share.js";
import "./core_backup.js"
import "./core_backends.js";
import "./core_maintenance.js";
import "./core_ishell.js";
import "./core_automation.js";
import "./core_sync.js";
import "./core_transition.js";
import "./capture/background/service.js"; // registers the capture port server and the frame relay
import {filesShelf} from "./plugin_files_shelf.js";

if (_BACKGROUND_PAGE)
    import("./core_import.js");

if (_BACKGROUND_PAGE && _MANIFEST_V3)
    import("./mv3_persistent.js");

receiveExternal.startListener(true);
receive.startListener(true);

(async () => {
    if (await grantPersistenceQuota()) {
        await systemInitialization;

        await startupLatch(performStartupInitialization);
    }
})();

async function performStartupInitialization() {
    search.initializeOmnibox();

    await browserShelf.reconcileBrowserBookmarksDB();

    if (settings.enable_files_shelf()) {
        await filesShelf.createIfMissing();
    }

    if (settings.cloud_enabled()) {
        await cloudShelf.createIfMissing();
        await cloudShelf.enableBackgroundSync(settings.cloud_background_sync());
    }

    if (!settings.storage_mode_internal())
        await helperApp.probe();

    await undoManager.commit();

    if (settings.storage_mode_server()
            || !settings.storage_mode_internal() && settings.synchronize_storage_at_startup())
        await sendLocal.performSync();

    console.log("==> core.js initialized");
}

if (browser.webRequest) {
    // remove the Origin header from add-on fetch requests
    function originWithId(header) {
        return header.name.toLowerCase() === 'origin' && header.value.startsWith('moz-extension://');
    }

    browser.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            return {
                requestHeaders: details.requestHeaders.filter(x => !originWithId(x))
            }
        },
        {urls: ["<all_urls>"]},
        ["blocking", "requestHeaders"]
    );
}

browser.commands.onCommand.addListener(function(command, tab) {
    if (command === "toggle_sidebar_window") {
        if (_SIDE_PANEL)
            openSidePanel(tab?.windowId);
        else if (!_SIDEBAR)
            toggleSidebarWindow();
    }
    else
        addBookmarkOnCommand(command, tab);
});

browser.tabs.onActivated.addListener(async activeInfo => {
    const tab = await browser.tabs.get(activeInfo.tabId);
    return setBookmarkedActionIcon(tab.url);
});

browser.tabs.onUpdated.addListener(async (tabId, changed, tab) => {
    if (tab.status === "complete")
        return setBookmarkedActionIcon(tab.url);
});

console.log("==> core.js loaded");
