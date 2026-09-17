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
import {getSidebarWindow, openSidePanel, toggleSidebarWindow} from "./utils_sidebar.js";
import {helperApp} from "./helper_app.js";
import {Archive} from "./storage_entities.js";
import {buildCaptureOptions} from "./capture_options.js";
import * as captureEngine from "./capture/background/service.js";

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
    if (!await hasCSRPermission())
        return;

    if (!_BACKGROUND_PAGE)
        await injectScriptFile(tab.id, {file: "/lib/browser-polyfill.js", allFrames: true});

    const selection = await extractSelection(tab, bookmark);
    let result;

    try {
        result = await runPageCapture(tab, bookmark, selection);
    }
    catch (e) {
        console.error(e);
        captureEngine.unlockTab(tab.id);
        showNotification("Cannot capture the page, please retry.");
        return;
    }

    await storeCapturedPage(bookmark, result, tab.id);
}

// Runs the capture engine on a tab; the archive is not stored here.
async function runPageCapture(tab, bookmark, selection) {
    // packUrl/packUrlExt pass a placeholder object with no node to write files to
    const unpacked = settings.save_unpacked_archives() && !bookmark.__url_packing && !!bookmark.uuid;

    if (unpacked)
        bookmark.contains = ARCHIVE_TYPE_FILES;

    const request = {
        options: await buildCaptureOptions(tab),
        mode: unpacked? "unpacked": "packed",
        selection,
        extras: {index: true, links: !!bookmark.__site_capture}
    };

    if (unpacked)
        request.writer = {write: file => Archive.saveFile(bookmark, file.path, file.bytes)};

    const result = await captureEngine.captureTab(tab.id, request);

    // consumers of the bookmark object (crawler, automation) read the index and the links from it
    bookmark.__index = {words: result.index || []};

    if (bookmark.__site_capture)
        bookmark.__site_capture.links = result.links || [];

    if (result.failures?.length)
        console.log(`Scrapyard: ${result.failures.length} of ${result.manifest.resources.length} resources were not saved`,
            result.failures);

    return result;
}

// Stores the result of a capture and finishes the UI choreography (formerly the storePageHtml message handler).
async function storeCapturedPage(bookmark, result, tabId) {
    try {
        await Bookmark.storeArchive(bookmark, result.html, "text/html", bookmark.__index);

        if (!bookmark.__mute_ui) {
            if (tabId != null)
                captureEngine.unlockTab(tabId);

            finalizeCapture(bookmark);

            if (bookmark.__crawl)
                startCrawling(bookmark);
        }
    }
    catch (e) {
        console.error(e);

        if (!bookmark.__mute_ui) {
            if (tabId != null)
                captureEngine.unlockTab(tabId);

            showNotification("Error archiving page.");
        }
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

// Opens the URL in a background tab, waits for it to load, captures it and closes the tab.
// The resolver receives {html, bookmark} (html is absent when the tab was closed prematurely) and the tab.
export async function packPage(url, bookmark, initializer, resolver, hide_tab) {
    const packingTab = await browser.tabs.create({url: url, active: false});

    if (hide_tab)
        browser.tabs.hide(packingTab.id);

    let changedTab = packingTab;

    try {
        changedTab = await waitForTabComplete(packingTab.id);

        if (initializer)
            await initializer(bookmark, changedTab);

        const result = await runPageCapture(changedTab, bookmark);

        if (!bookmark.__url_packing) // archiveBookmark: the page is stored here, the callers of packUrl store it themselves
            await storeCapturedPage(bookmark, result, null);

        try { // the title and the favicon may have changed after the load event
            changedTab = await browser.tabs.get(packingTab.id);
        } catch (e) {}

        return resolver({html: result.html, bookmark, result}, changedTab);
    }
    catch (e) {
        if (e?.message?.includes("tab was closed"))
            return resolver({bookmark}, changedTab);

        throw e;
    }
    finally {
        browser.tabs.remove(packingTab.id).catch(() => {});
    }
}

// Resolves with the latest tab object once the tab has loaded; rejects when the tab is closed before that.
function waitForTabComplete(tabId) {
    return new Promise((resolve, reject) => {
        let latestTab;

        const onUpdated = (id, changed, tab) => {
            if (id !== tabId)
                return;

            latestTab = latestTab || tab;

            if (changed.favIconUrl)
                latestTab.favIconUrl = changed.favIconUrl;

            if (changed.title)
                latestTab.title = changed.title;

            if (changed.status === "complete") { // may be invoked several times
                removeListeners();
                resolve(latestTab);
            }
        };

        const onRemoved = id => {
            if (id === tabId) {
                removeListeners();
                reject(new Error("The tab was closed before the page loaded"));
            }
        };

        function removeListeners() {
            browser.tabs.onUpdated.removeListener(onUpdated);
            browser.tabs.onRemoved.removeListener(onRemoved);
        }

        browser.tabs.onUpdated.addListener(onUpdated);
        browser.tabs.onRemoved.addListener(onRemoved);

        browser.tabs.get(tabId).then(tab => {
            latestTab = latestTab || tab;

            if (tab.status === "complete") {
                removeListeners();
                resolve(latestTab);
            }
        }).catch(onRemoved.bind(null, tabId));
    });
}

export async function packUrl(url, hide_tab) {
    return packPage(url, {}, b => b.__url_packing = true, m => m.html, hide_tab);
}

export async function packUrlExt(url, hide_tab) {
    let resolver = (m, t) => ({html: m.html, title: url.endsWith(t.title)? undefined: t.title, icon: t.favIconUrl});
    return packPage(url, {}, b => b.__url_packing = true, resolver, hide_tab);
}

export function addBookmarkOnCommand(command, tab) {
    let type = command === "archive_to_default_shelf"? NODE_TYPE_ARCHIVE: NODE_TYPE_BOOKMARK;

    if (settings.platform.firefox)
        addBookmarkOnCommandFirefox(type);
    else if (_SIDE_PANEL)
        addBookmarkOnCommandSidePanel(type, tab);
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

// requires non-async function: the side panel could be opened only in response to a user gesture
function addBookmarkOnCommandSidePanel(type, tab) {
    if (settings.open_sidebar_from_shortcut()) {
        browser.storage.session.set({"sidebar-select-shelf": DEFAULT_SHELF_ID});
        openSidePanel(tab?.windowId);
    }

    getActiveTabMetadata()
        .then(payload => addBookmarkOnCommandSendPayload(type, payload))
        .catch(e => console.error(e));
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
