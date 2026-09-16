import {browserShelf} from "./plugin_browser_shelf.js";
import {settings} from "./settings.js";
import {cloudShelf} from "./plugin_cloud_shelf.js";
import {helperApp} from "./helper_app.js";
import {receive} from "./proxy.js";
import {filesShelf} from "./plugin_files_shelf.js";

receive.uiLockGet = message => {
    browserShelf.getUILock();
};

receive.uiLockRelease = message => {
    browserShelf.releaseUILock();
};

receive.memorizeUIBookmarks = message => {
    browserShelf.lockUIBookmarks(message.bookmarks, message.category);
}

receive.getListenerLockState = message => {
    return browserShelf.isLockedByListeners();
};

receive.reconcileBrowserBookmarkDb = async message => {
    await settings.load()
    browserShelf.reconcileBrowserBookmarksDB();
};

receive.reconcileCloudBookmarkDb = async message => {
    await settings.load();
    cloudShelf.reconcileCloudBookmarksDB(message.verbose);
};

receive.enableCloudBackgroundSync = async message => {
    cloudShelf.enableBackgroundSync(message.enable);
};

receive.addFilesDirectory = async message => {
    return filesShelf.addDirectory(message.options);
};

receive.reconcileExternalFiles = async message => {
    return filesShelf.reconcileExternalFiles();
};

receive.openWithEditor = async message => {
    return filesShelf.openWithEditor(message.node);
};

receive.browseOrgWikiReference = message => {
    return filesShelf.openExternalLink(message.link, message.node);
};

receive.helperAppProbe = message => {
    return helperApp.probe(message.verbose);
};

receive.helperAppGetVersion = async message => {
    await helperApp.probe();
    return helperApp.getVersion();
};

receive.helperAppHasVersion = async message => {
    return helperApp.hasVersion(message.version, message.alert);
};

receive.helperAppReset = message => {
    return helperApp.reset();
};

receive.helperAppGetBackgroundAuth = message => {
    return helperApp.getBackgroundAuth(message?.staleToken);
};

