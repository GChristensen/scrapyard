import {settings} from "./settings.js";
import {
    getActiveTab,
    hasCSRPermission,
    injectCSSFile,
    injectScriptFile,
    showNotification,
    isHTMLTab, askCSRPermission, ACTION_ICONS
} from "./utils_browser.js";
import {capitalize, getMimetypeByExt, sleep} from "./utils.js";
import {send, sendLocal} from "./proxy.js";
import {
    ARCHIVE_TYPE_FILES, CHROME_BOOKMARK_TOOLBAR,
    DEFAULT_SHELF_ID,
    FIREFOX_BOOKMARK_TOOLBAR,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK
} from "./storage.js";
import {fetchText, fetchWithTimeout} from "./utils_io.js";
import {Node} from "./storage_entities.js";
import {getFaviconFromContent, getFaviconFromTab} from "./favicon.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import * as crawler from "./crawler.js";
import {Folder} from "./bookmarks_folder.js";
import {isHTMLLink, parseHtml} from "./utils_html.js";
import {getSidebarWindow, toggleSidebarWindow} from "./utils_sidebar.js";
import {helperApp} from "./helper_app.js";

const SCRAPYARD_FOLDER_NAME = "Scrapyard";

export function formatShelfName(name) {
    if (name && settings.capitalize_builtin_shelf_names())
        return capitalize(name);

    return name;
}

export function isSpecialPage(url) {
    return (url.startsWith("about:")
        || url.startsWith("view-source:") || url.startsWith("moz-extension:")
        || url.startsWith("https://addons.mozilla.org") || url.startsWith("https://support.mozilla.org")
        || url.startsWith("chrome:") || url.startsWith("chrome-extension:")
        || url.startsWith("https://chrome.google.com/webstore")
        || url.startsWith(helperApp.url("/")));
}

export function notifySpecialPage() {
    showNotification("Scrapyard cannot be used with special or already captured pages.");
}

export async function getTabMetadata(tab) {
    const result = {
        name: tab.title,
        uri:  tab.url
    };

    const favicon = await getFaviconFromTab(tab);
    if (favicon)
        result.icon = favicon;

    return result;
}

export async function getActiveTabMetadata() {
    const tab = await getActiveTab();
    return await getTabMetadata(tab);
}

export async function captureTab(tab, bookmark) {
    if (isSpecialPage(tab.url))
        notifySpecialPage();
    else {
        if (await isHTMLTab(tab))
            await captureHTMLTab(tab, bookmark)
        else
            await captureNonHTMLTab(tab, bookmark);
    }
}

async function extractSelection(tab, bookmark) {
    const frames = await browser.webNavigation.getAllFrames({tabId: tab.id});
    let selection;

    for (let frame of frames) {
        try {
            await injectScriptFile(tab.id, {file: "/content_selection.js", frameId: frame.frameId});
            selection = await browser.tabs.sendMessage(
                tab.id,
                {type: "CAPTURE_SELECTION", options: bookmark},
                {frameId: frame.frameId}
            );

            if (selection)
                break;
        } catch (e) {
            console.error(e);
        }
    }

    return selection;
}

async function captureHTMLTab(tab, bookmark) {
    if (!_BACKGROUND_PAGE)
        await injectScriptFile(tab.id, {file: "/lib/browser-polyfill.js", allFrames: true});

    let response;
    const selection = await extractSelection(tab, bookmark);
    try { response = await startSavePageCapture(tab, bookmark, selection); } catch (e) {}

    if (typeof response == "undefined") { /* no response received - content script not loaded in active tab */
        let onScriptInitialized = async (message, sender) => {
            if (message.type === "CAPTURE_SCRIPT_INITIALIZED" && tab.id === sender.tab.id) {
                browser.runtime.onMessage.removeListener(onScriptInitialized);

                try {
                    response = await startSavePageCapture(tab, bookmark, selection);
                } catch (e) {
                    console.error(e);
                }

                if (typeof response == "undefined")
                    showNotification("Cannot initialize the capture script, please retry.");
            }
        };
        browser.runtime.onMessage.addListener(onScriptInitialized);

        await injectSavePageScripts(tab)
    }
}

function startSavePageCapture(tab, bookmark, selection) {
    if (settings.save_unpacked_archives())
        bookmark.contains = ARCHIVE_TYPE_FILES;

    return browser.tabs.sendMessage(tab.id, {
        type: "performAction",
        menuaction: 1,
        saveditems: 2,
        bookmark,
        selection
    });
}

async function injectSavePageScripts(tab, onError) {
    if (!await hasCSRPermission())
        return;

    try {
        try {
            await injectScriptFile(tab.id, {file: "/savepage/content-frame.js", allFrames: true});
            await injectScriptFile(tab.id, {file: "/savepage/content-fontface.js", allFrames: true});
        } catch (e) {
            console.error(e);
        }

        await injectScriptFile(tab.id, {file: "/savepage/content.js"});
    }
    catch (e) {
        console.error(e);

        if (onError)
            onError(e);
    }
}

async function captureNonHTMLTab(tab, bookmark) {
    if (/^file:/i.exec(tab.url) && settings.platform.firefox) {
        showNotification("Firefox version of Scrapyard can not be used with file:// URLs.");
        return;
    }

    try {
        const headers = {"Cache-Control": "no-store"};
        const response = await fetchWithTimeout(tab.url, {timeout: 60000, headers});

        if (response.ok) {
            let contentType = response.headers.get("content-type");

            if (!contentType)
                contentType = getMimetypeByExt(new URL(tab.url).pathname) || "application/pdf";

            bookmark.content_type = contentType;

            await Bookmark.storeArchive(bookmark, await response.arrayBuffer(), contentType);
        }
    }
    catch (e) {
        console.error(e);
    }

    finalizeCapture(bookmark);
}

export function finalizeCapture(bookmark) {
    if (bookmark?.__automation && bookmark?.select)
        send.bookmarkCreated({node: bookmark});
    else if (bookmark && !bookmark.__automation && !bookmark.__type_change)
        send.bookmarkAdded({node: bookmark});
}

export async function archiveBookmark(node) {
    const bookmark = await Node.get(node.id);
    bookmark.type = NODE_TYPE_ARCHIVE;
    await Node.idb.update(bookmark); // storage updated in Archive.add

    const isHTML = await isHTMLLink(bookmark.uri);
    if (isHTML === true) {
        bookmark.__type_change = true;
        await packPage(bookmark.uri, bookmark, () => null, () => null, false);
    }
    else if (isHTML === false) {
        let response;
        try {
            response = await fetchWithTimeout(bookmark.uri);
        } catch (e) {
            console.error(e);
        }

        if (response.ok)
           await Bookmark.storeArchive(bookmark, await response.arrayBuffer(), response.headers.get("content-type"));
    }
}

export async function showSiteCaptureOptions(tab, bookmark) {
    try {
        if (!_BACKGROUND_PAGE)
            await injectScriptFile(tab.id, {file: "/lib/browser-polyfill.js", allFrames: true});

        await injectScriptFile(tab.id, {file: "/savepage/content-frame.js", allFrames: true});
        await injectCSSFile(tab.id, {file: "/ui/site_capture_content.css"});
        await injectScriptFile(tab.id, {file: "/ui/site_capture_content.js", frameId: 0});
        browser.tabs.sendMessage(tab.id, {type: "storeBookmark", bookmark});
    } catch (e) {
        console.error(e);
    }
}

export async function performSiteCapture(bookmark) {
    if (crawler.initialize(bookmark)) {
        const folder = await Folder.addSite(bookmark.parent_id, bookmark.name);
        bookmark.parent_id = folder.id;

        sendLocal.createArchive({node: bookmark});
    }
}

export function startCrawling(bookmark) {
    bookmark.__site_capture.level = 0;

    crawler.crawl(bookmark);

    send.startProcessingIndication({noWait: true});
    send.toggleAbortMenu({show: true});
}

export function abortCrawling() {
    crawler.abort();
}

export async function packPage(url, bookmark, initializer, resolver, hide_tab) {
    return new Promise(async (resolve, reject) => {
        let initializationListener;
        let changedTab;
        let packing;

        let completionListener = function (message, sender, sendResponse) {
            if (message.type === "storePageHtml" && message.bookmark.__tab_id === packingTab.id) {
                removeListeners();
                browser.tabs.remove(packingTab?.id);

                resolve(resolver(message, changedTab));
            }
        };

        let tabRemovedListener = function (tabId) {
            if (tabId === changedTab.id) {
                removeListeners();
                const message = {bookmark};
                resolve(resolver(message, changedTab));
            }
        };

        browser.runtime.onMessage.addListener(completionListener);

        var tabUpdateListener = async (id, changed, tab) => {
            if (!changedTab && id === packingTab.id)
                changedTab = tab;
            if (id === packingTab.id && changed.favIconUrl)
                changedTab.favIconUrl = changed.favIconUrl;
            if (id === packingTab.id && changed.title)
                changedTab.title = changed.title;
            if (id === packingTab.id && changed.status === "complete") { // may be invoked several times
                if (packing)
                    return;
                packing = true;

                initializationListener = async function (message, sender, sendResponse) {
                    if (message.type === "CAPTURE_SCRIPT_INITIALIZED" && sender.tab.id === packingTab.id) {
                        if (initializer)
                            await initializer(bookmark, tab);
                        bookmark.__tab_id = packingTab.id;

                        try {
                            await startSavePageCapture(packingTab, bookmark);
                        } catch (e) {
                            console.error(e);
                            reject(e);
                        }
                    }
                };

                browser.runtime.onMessage.addListener(initializationListener);

                if (!_BACKGROUND_PAGE)
                    await injectScriptFile(packingTab.id, {file: "/lib/browser-polyfill.js", allFrames: true});

                await injectSavePageScripts(packingTab, reject);
            }
        };

        function removeListeners() {
            browser.tabs.onUpdated.removeListener(tabUpdateListener);
            browser.tabs.onRemoved.removeListener(tabRemovedListener);
            browser.runtime.onMessage.removeListener(completionListener);
            browser.runtime.onMessage.removeListener(initializationListener);
        }

        browser.tabs.onUpdated.addListener(tabUpdateListener);
        browser.tabs.onRemoved.addListener(tabRemovedListener);

        var packingTab = await browser.tabs.create({url: url, active: false});

        if (hide_tab)
            browser.tabs.hide(packingTab.id)
    });
}

export async function packUrl(url, hide_tab) {
    return packPage(url, {}, b => b.__url_packing = true, m => m.html, hide_tab);
}

export async function packUrlExt(url, hide_tab) {
    let resolver = (m, t) => ({html: m.html, title: url.endsWith(t.title)? undefined: t.title, icon: t.favIconUrl});
    return packPage(url, {}, b => b.__url_packing = true, resolver, hide_tab);
}

export function addBookmarkOnCommand(command) {
    let type = command === "archive_to_default_shelf"? NODE_TYPE_ARCHIVE: NODE_TYPE_BOOKMARK;

    if (settings.platform.firefox)
        addBookmarkOnCommandFirefox(type);
    else
        addBookmarkOnCommandNonFirefox(type);
}

function addBookmarkOnCommandFirefox(type) {
    if (localStorage.getItem("option-open-sidebar-from-shortcut") === "open") {
        localStorage.setItem("sidebar-select-shelf", DEFAULT_SHELF_ID);
        browser.sidebarAction.open();
    }

    if (type === NODE_TYPE_ARCHIVE)
        askCSRPermission() // requires non-async function
            .then(response => {
                if (response)
                    addBookmarkOnCommandSendPayload(type);
            })
            .catch(e => console.error(e));
    else
        addBookmarkOnCommandSendPayload(type);
}

async function addBookmarkOnCommandNonFirefox(type) {
    const payload = await getActiveTabMetadata();
    await addBookmarkOnCommandSendPayload(type, payload);

    await settings.load();
    if (settings.open_sidebar_from_shortcut()) {
        const window = await getSidebarWindow();
        if (!window) {
            await browser.storage.session.set({"sidebar-select-shelf": DEFAULT_SHELF_ID});
            await toggleSidebarWindow();
        }
    }
}

async function addBookmarkOnCommandSendPayload(type, payload) {
    if (!payload)
        payload = await getActiveTabMetadata();

    payload.type = type;
    payload.parent_id = DEFAULT_SHELF_ID;

    return sendLocal.captureHighlightedTabs({options: payload});
}

export async function createBookmarkFromURL (url, parentId) {
    let options = {
        parent_id: parentId,
        uri: url,
        name: "Untitled"
    };

    if (!/^https?:\/\/.*/.exec(options.uri))
        options.uri = "http://" + options.uri;

    sendLocal.startProcessingIndication();

    try {
        const html = await fetchText(options.uri);

        let doc;
        if (html)
            doc = parseHtml(html);

        if (doc) {
            const title = doc.getElementsByTagName("title")[0]?.textContent;
            options.name = title || options.uri;

            const icon = await getFaviconFromContent(options.uri, doc);
            if (icon)
                options.icon = icon;
        }
    }
    catch (e) {
        console.error(e);
    }

    const bookmark = await Bookmark.add(options, NODE_TYPE_BOOKMARK);
    await sendLocal.stopProcessingIndication();
    sendLocal.bookmarkCreated({node: bookmark});
}

export async function addToBookmarksToolbar(node) {
    let scrapyardFolder = await findScrapyardBookmarkFolder();

    if (!scrapyardFolder)
        scrapyardFolder = await createScrapyardBookmarkFolder();

    await browser.bookmarks.create({
        parentId: scrapyardFolder.id,
        title: node.name,
        url: createScrapyardToolbarReference(node.uuid),
        index: 0
    });

    const maxReferences = settings.number_of_bookmarks_toolbar_references();

    if (maxReferences) {
        const references = await browser.bookmarks.getChildren(scrapyardFolder.id);

        if (references.length > maxReferences) {
            const refsToDelete = references.slice(maxReferences, references.length);

            for (const ref of refsToDelete)
                browser.bookmarks.remove(ref.id);
        }
    }
}

async function findScrapyardBookmarkFolder() {
    const scrapyardFolders = await browser.bookmarks.search({title: SCRAPYARD_FOLDER_NAME});

    return scrapyardFolders.find(f => !f.url &&
        (settings.platform.firefox && f.parentId === FIREFOX_BOOKMARK_TOOLBAR
            || settings.platform.chrome && f.parentId === CHROME_BOOKMARK_TOOLBAR));
}

async function createScrapyardBookmarkFolder() {
    let parentId = FIREFOX_BOOKMARK_TOOLBAR;

    if (settings.platform.chrome)
        parentId = "1";

    const options = {
        parentId: parentId,
        title: SCRAPYARD_FOLDER_NAME
    };

    if (settings.platform.firefox)
        options.type = "folder";

    return browser.bookmarks.create(options);
}

export function createScrapyardToolbarReference(uuid = "") {
    let referenceURL = `ext+scrapyard://${uuid}`;

    return browser.runtime.getURL(`/reference.html?toolbar#${referenceURL}`);
}

export async function removeFromBookmarksToolbar(uuid) {
    const scrapyardFolder = await findScrapyardBookmarkFolder();

    if (scrapyardFolder) {
        const references = await browser.bookmarks.getChildren(scrapyardFolder.id);
        const refToRemove = references.find(r => r.url.endsWith(uuid));

        if (refToRemove)
            return browser.bookmarks.remove(refToRemove.id);
    }
}

export async function setBookmarkedActionIcon(url) {
    const action = _MANIFEST_V3? browser.action: browser.browserAction;

    if (!url)
        url = (await getActiveTab())?.url;

    if (await Node.urlExists(url)) {
        if (settings.platform.firefox)
            action.setIcon({path: "/icons/scrapyard-star.svg"});
        else
            action.setIcon({path: "/icons/scrapyard-star.png"});
    }
    else {
        if (settings.platform.firefox)
            action.setIcon({path: "/icons/scrapyard.svg"});
        else
            action.setIcon({path: ACTION_ICONS});
    }
}
