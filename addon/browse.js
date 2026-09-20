import {
    CLOUD_EXTERNAL_TYPE,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK, NODE_TYPE_FILE,
    NODE_TYPE_FOLDER,
    NODE_TYPE_NOTES,
    NODE_TYPE_SHELF,
    RDF_EXTERNAL_TYPE
} from "./storage.js";
import {Archive, Node} from "./storage_entities.js";
import {Query} from "./storage_query.js";
import {
    injectCSSFile,
    injectScriptFile,
    openContainerTab,
    openPage, showNotification,
    updateTabURL
} from "./utils_browser.js";
import {settings} from "./settings.js";
import {HELPER_APP_v2_1_IS_REQUIRED, HELPER_APP_v2_IS_REQUIRED, helperApp} from "./helper_app.js";
import {send, sendLocal} from "./proxy.js";
import {rdfShelf} from "./plugin_rdf_shelf.js";
import {Bookmark} from "./bookmarks_bookmark.js"

function configureArchiveTab(node, archiveTab) {
    var tabUpdateListener = async (id, changed, tab) => {
        if (tab.id === archiveTab.id) {
            if (changed?.hasOwnProperty("attention"))
                return;

            if (changed.status === "complete")
                await configureArchivePage(tab, node);
        }
    };

    browser.tabs.onUpdated.addListener(tabUpdateListener);

    function tabRemoveListener(tabId) {
        if (tabId === archiveTab.id) {
            if (settings.storage_mode_internal())
                revokeTrackedObjectURLs(tabId);

            browser.tabs.onRemoved.removeListener(tabRemoveListener);
            browser.tabs.onUpdated.removeListener(tabUpdateListener);
        }
    }

    browser.tabs.onRemoved.addListener(tabRemoveListener);
}

async function configureArchivePage(tab, node) {
    if (node.external === CLOUD_EXTERNAL_TYPE && Archive.isUnpacked(node))
        return;

    await injectCSSFile(tab.id, {file: "ui/edit_toolbar.css"});
    await injectScriptFile(tab.id, {file: "lib/jquery.js", frameId: 0});
    if (!_BACKGROUND_PAGE)
        await injectScriptFile(tab.id, {file: "lib/browser-polyfill.js", frameId: 0});
    await injectScriptFile(tab.id, {file: "ui/edit_toolbar.js", frameId: 0});

    if ((tab.url?.startsWith("blob:") || helperApp.isArchiveURL(tab.url))
            && settings.open_bookmark_in_active_tab()) {
        const uuid = tab.url.split("/").at(-2);
        node = await Node.getByUUID(uuid);
    }
    else if (settings.open_bookmark_in_active_tab())
        node = undefined;

    if (node && await Bookmark.isSitePage(node))
        await configureSiteLinks(node, tab);
}

async function configureSiteLinks(node, tab) {
    await injectScriptFile(tab.id, {file: "content_site.js", allFrames: true});
    const siteMap = await buildSiteMap(node);
    browser.tabs.sendMessage(tab.id, {type: "CONFIGURE_SITE_LINKS", siteMap, useProtocol: _BACKGROUND_PAGE});
}

async function buildSiteMap(node) {
    const archives = await listSiteArchives(node);
    return archives.reduce((acc, n) => {
        acc[n.uri] = n.uuid;
        return acc;
    }, {});
}

function openURL(url, options, newtabf = openPage) {
    if (options?.tab)
        return updateTabURL(options.tab, url, options.preserveHistory);

    return newtabf(url, options?.container);
}

const NOTES_PAGE = "ui/notes.html";

// tabs are matched in script, match patterns are unreliable for extension pages and ignore the fragment
async function findNotesTab(uuid) {
    const base = browser.runtime.getURL(NOTES_PAGE);
    const tabs = await browser.tabs.query({});

    return tabs.find(t => {
        const url = t.url || t.pendingUrl;
        if (!url?.startsWith(base))
            return false;

        try {
            const {pathname, hash} = new URL(url);
            return pathname.endsWith("/" + NOTES_PAGE) && hash === "#" + uuid;
        } catch (e) {
            return false;
        }
    });
}

// notes are opened in a single tab: an already open tab is focused instead of being navigated,
// so the pending changes in its editor are not interrupted
export async function browseNotes(uuid, options) {
    const existing = await findNotesTab(uuid);

    if (existing) {
        await browser.tabs.update(existing.id, {active: true});
        await browser.windows.update(existing.windowId, {focused: true});

        if (options?.edit)
            browser.tabs.sendMessage(existing.id, {type: "SCRAPYARD_NOTES_EDIT"}).catch(() => {});

        // a redirecting reference page has no use once the notes are shown
        if (options?.closeTab && options.tab && options.tab.id !== existing.id)
            await browser.tabs.remove(options.tab.id);

        return existing;
    }

    const edit = options?.edit? "?edit": "";
    return openURL(`${NOTES_PAGE}${edit}#${uuid}`, options);
}

function browseBookmark(node, options) {
    let url = node.uri;
    if (url) {
        try {
            new URL(url);
        } catch (e) {
            url = "http://" + url;
        }

        if (options)
            options.container = options.container || node.container;
        else
            options = {container: node.container};

        return openURL(url, options, openContainerTab);
    }
}

var archiveTabs = {};

function trackArchiveTab(tabId, url) {
    let urls = archiveTabs[tabId];
    if (!urls) {
        urls = new Set([url]);
        archiveTabs[tabId] = urls;
    }
    else
        urls.add(url);
}

function isArchiveTabTracked(tabId) {
    return !!archiveTabs[tabId];
}

function revokeTrackedObjectURLs(tabId) {
    const objectURLs = archiveTabs[tabId];

    if (objectURLs) {
        delete archiveTabs[tabId];

        for (const url of objectURLs)
            if (url.startsWith("blob:"))
                URL.revokeObjectURL(url);
    }
}

async function browseArchiveIDB(node, options) {
    if (node.__tentative)
        return;

    if (node.external === RDF_EXTERNAL_TYPE)
        return browseRDFArchive(node, options);

    const archive = await Archive.get(node);
    if (archive) {
        let objectURL = await getBlobURL(archive);

        if (objectURL) {
            const archiveURL = objectURL + "#/" + node.uuid + "/";
            const archiveTab = await openURL(archiveURL, options);
            const tabTracked = isArchiveTabTracked(archiveTab.id);

            // configureArchiveTab depends on the tracked url
            trackArchiveTab(archiveTab.id, objectURL);

            if (!tabTracked)
                configureArchiveTab(node, archiveTab);
        }
    }
    else
        showNotification({message: "No data is stored."});
}

async function browseRDFArchive(node, options) {
    const helper = await helperApp.hasVersion("2.0", HELPER_APP_v2_IS_REQUIRED);

    if (helper) {
        const url = await helperApp.signedURL(`/rdf/browse/${node.uuid}/`);
        return openURL(url, options);
    }
}

async function getBlobURL(archive) {
    if (archive.data) { // legacy string content
        let object = new Blob([await Archive.reify(archive)],
            {type: archive.type? archive.type: "text/html"});
        return URL.createObjectURL(object);
    }
    else
        return URL.createObjectURL(archive.object);
}

async function browseArchiveHelper(node, options) {
    if (node.__tentative)
        return;

    const helper = await helperApp.hasVersion("2.0", HELPER_APP_v2_IS_REQUIRED);

    if (helper) {
        let urlPrefix = "";
        if (node.external === RDF_EXTERNAL_TYPE)
            urlPrefix = "/rdf";

        const archiveURL = await helperApp.signedURL(`${urlPrefix}/browse/${node.uuid}/`);
        const archiveTab = await openURL(archiveURL, options);
        return configureArchiveTab(node, archiveTab);
    }
}

helperApp.addMessageHandler("REQUEST_ARCHIVE", onRequestArchiveMessage);

export async function onRequestArchiveMessage(msg) {
    const result = {type: "ARCHIVE_INFO", kind: "empty"};

    try {
        const node = await Node.getByUUID(msg.uuid);

        if (node) {
            result.data_path = helperApp.dataPath() || null;

            if (node.external === CLOUD_EXTERNAL_TYPE) {
                try {
                    const archive = await Archive.get(node);

                    if (archive) {
                        const content = await Archive.reify(archive, true);

                        result.kind = "content";
                        result.name = node.name;
                        result.uuid = node.uuid;
                        result.content_type = node.content_type || "text/html";
                        result.content = content;
                        result.contains = node.contains || null;
                    }
                } catch (e) {
                    console.error(e);
                }
            }
            else {
                result.kind = "metadata";
                result.name = node.name;
                result.content_type = node.content_type || "text/html";
                result.contains = node.contains || null;
            }
        }
    } catch (e) {
        console.error(e);
    }

    return result;
}

helperApp.addMessageHandler("REQUEST_RDF_PATH", onRequestRdfPathMessage);

export async function onRequestRdfPathMessage(msg) {
    try {
        const node = await Node.getByUUID(msg.uuid);

        if (node) {
            const path = await rdfShelf.getRDFArchiveDir(node);

            return {
                type: "RDF_PATH",
                uuid: node.uuid,
                rdf_archive_path: path
            };
        }
    } catch (e) {
        console.error(e);
    }
}

async function browseFolder(node, options) {
    if (node.__filtering)
        send.selectNode({node, open: true, forceScroll: true});
    else if (node.gallery)
        return openURL("ui/gallery.html#" + node.uuid, options);
    else if (node.site) {
        const archives = await listSiteArchives(node);
        const page = archives[0];
        if (page)
            return browseNode(page, options);
    }
}

async function listSiteArchives(node) {
    const parentId = node.type === NODE_TYPE_ARCHIVE? node.parent_id: node.id;
    const parent = await Node.get(parentId);
    const pages = await Query.fullSubtree(parent.id, true);
    return pages.filter(n => n.type === NODE_TYPE_ARCHIVE);
}

async function browseFile(node) {
    const helper = await helperApp.hasVersion("2.1", HELPER_APP_v2_1_IS_REQUIRED);

    if (helper) {
        return helperApp.postJSON("/files/shell_open_asset", {
            path: node.uri
        });
    }
}

export async function browseNodeBackground(node, options) {
    switch (node.type) {
        case NODE_TYPE_BOOKMARK:
            return browseBookmark(node, options);

        case NODE_TYPE_ARCHIVE:
            if (settings.storage_mode_internal())
                return browseArchiveIDB(node, options);
            else
                return browseArchiveHelper(node, options);

        case NODE_TYPE_NOTES:
            return browseNotes(node.uuid, options);

        case NODE_TYPE_FOLDER:
            return browseFolder(node, options);

        // only gallery shelves are clickable in the tree
        case NODE_TYPE_SHELF:
            if (node.gallery)
                return openURL("ui/gallery.html#" + node.uuid, options);
            return;

        case NODE_TYPE_FILE:
            return browseFile(node);
    }
}

export async function browseNode(node) {
    if (!_BACKGROUND_PAGE && settings.storage_mode_internal())
        return sendLocal.browseNode({node});
    else
        return browseNodeBackground(node);
}

