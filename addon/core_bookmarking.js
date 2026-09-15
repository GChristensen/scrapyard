import {formatBytes, getMimetypeByExt} from "./utils.js";
import {receive, send, sendLocal} from "./proxy.js";
import {
    BROWSER_EXTERNAL_TYPE,
    CLOUD_SHELF_ID,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK,
    NODE_TYPE_NOTES,
    UNDO_DELETE,
    UNDO_REORDER
} from "./storage.js";
import {askCSRPermission, getActiveTab, gettingStarted, showNotification, updateTabURL} from "./utils_browser.js";
import {HELPER_APP_v2_IS_REQUIRED, helperApp} from "./helper_app.js";
import {settings} from "./settings.js";
import {
    captureTab,
    finalizeCapture,
    isSpecialPage,
    notifySpecialPage,
    packUrlExt,
    showSiteCaptureOptions,
    performSiteCapture,
    startCrawling,
    abortCrawling,
    archiveBookmark, addToBookmarksToolbar
} from "./bookmarking.js";
import {fetchText} from "./utils_io.js";
import {TODO} from "./bookmarks_todo.js";
import {Folder} from "./bookmarks_folder.js";
import {Shelf} from "./bookmarks_shelf.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import {Archive, Node} from "./storage_entities.js";
import {undoManager} from "./bookmarks_undo.js";
import {browseNodeBackground} from "./browse.js";
import UUID from "./uuid.js";
import {ensureSidebarHost} from "./utils_sidebar.js";
import {getFaviconFromContent, getFaviconFromTab} from "./favicon.js";

async function canUseBookmarking() {
    return settings.storage_mode_internal() || await helperApp.hasVersion("2.0", HELPER_APP_v2_IS_REQUIRED);
}

receive.createShelf = message => Shelf.add(message.name);

receive.createFolder = message => Folder.add(message.parent, message.name);

receive.renameFolder = message => Folder.rename(message.id, message.name);

receive.addSeparator = message => Bookmark.addSeparator(message.parent_id, message.name);

receive.createBookmark = async message => {
    if (!settings.storage_mode_internal() && !settings.data_folder_path())
        return gettingStarted();

    if (!await canUseBookmarking())
        return;

    const node = message.node;

    if (isSpecialPage(node.uri))
        return notifySpecialPage();

    async function addBookmark() {
        try {
            const bookmark = await Bookmark.add(node, NODE_TYPE_BOOKMARK);

            if (settings.add_to_bookmarks_toolbar())
                await addToBookmarksToolbar(bookmark);

            send.bookmarkAdded({node: bookmark});
            return bookmark;
        }
        catch (e) {
            showNotification(e.message);
            send.bookmarkCreationFailed({node});
        }
    }

    Bookmark.setTentativeId(node);
    node.type = NODE_TYPE_BOOKMARK; // needed for beforeBookmarkAdded
    return send.beforeBookmarkAdded({node})
        .then(addBookmark)
        .catch(addBookmark);
};

receive.updateBookmark = message => Bookmark.update(message.node);

receive.createArchive = async message => {
    if (!settings.storage_mode_internal() && !settings.data_folder_path())
        return gettingStarted();

    if (!await canUseBookmarking())
        return;

    const node = message.node;
    const tab = message.tab || await getActiveTab();

    if (isSpecialPage(node.uri))
        return notifySpecialPage();

    async function addBookmark() {
        try {
            const bookmark = await Bookmark.idb.add(node, NODE_TYPE_ARCHIVE); // added to the storage on archive content update

            if (settings.add_to_bookmarks_toolbar())
                await addToBookmarksToolbar(bookmark);

            bookmark.__tab_id = tab.id;
            captureTab(tab, bookmark); // !sic
            return bookmark;
        }
        catch (e) {
            showNotification(e.message);
            send.bookmarkCreationFailed({node});
        }
    }

    if (node.__crawl && !node.__site_capture) {
        const tab = await getActiveTab();
        showSiteCaptureOptions(tab, node);
        return;
    }

    Bookmark.setTentativeId(node);
    node.type = NODE_TYPE_ARCHIVE; // needed for beforeBookmarkAdded
    return send.beforeBookmarkAdded({node: node})
        .then(addBookmark)
        .catch(addBookmark);
};

receive.archiveBookmarks = async message => {
    if (!await canUseBookmarking())
        return;

    send.startProcessingIndication();

    try {
        for (const node of message.nodes) {
            if (node.type === NODE_TYPE_BOOKMARK)
                await archiveBookmark(node);
        }
    }
    finally {
        send.nodesUpdated();
        send.stopProcessingIndication();
    }
};

receive.updateArchive = message => Bookmark.updateArchive(message.uuid, message.data);

receive.createNotes = async message => {
    if (!settings.storage_mode_internal() && !settings.data_folder_path())
        return gettingStarted();

    if (!await canUseBookmarking())
        return;

    const node = message.node;

    async function addNotes() {
        try {
            const bookmark = await Bookmark.addNotes(node.parent_id, node.name);

            if (settings.add_to_bookmarks_toolbar())
                await addToBookmarksToolbar(bookmark);

            send.bookmarkAdded({node: bookmark});
            return bookmark;
        }
        catch (e) {
            showNotification(e.message);
            send.bookmarkCreationFailed({node});
        }
    }

    Bookmark.setTentativeId(node);
    node.type = NODE_TYPE_NOTES; // needed for beforeBookmarkAdded

    return send.beforeBookmarkAdded({node})
        .then(addNotes)
        .catch(addNotes);
};

receive.captureHighlightedTabs = async message => {
    const options = message.options;
    const highlightedTabs = await browser.tabs.query({highlighted: true, currentWindow: true});
    let parentNode;

    if (options.type === NODE_TYPE_ARCHIVE) {
        parentNode = await Node.get(options.parent_id);

        if (parentNode.external === BROWSER_EXTERNAL_TYPE) {
            showNotification({title: "Warning", message: "Only bookmarks are saved to the browser bookmarks folder."});
        }
    }

    if (highlightedTabs.length === 1)
        return captureBookmarkForTab(highlightedTabs[0], message.options, parentNode);
    else
        for (const tab of highlightedTabs) {
            const node = {...message.options};

            node.uri = tab.url;
            node.name = tab.title;
            node.icon = await getFaviconFromTab(tab);

            await captureBookmarkForTab(tab, node, parentNode);
        }
} ;

async function captureBookmarkForTab(tab, node, parentNode) {
    if (node.type === NODE_TYPE_ARCHIVE) {
        if (parentNode?.external === BROWSER_EXTERNAL_TYPE)
            return sendLocal.createBookmark({node});
        else
            return sendLocal.createArchive({node, tab});
    }
    else
        return sendLocal.createBookmark({node});
}

receive.setTODOState = message => TODO.setState(message.nodes);

receive.getBookmarkInfo = async (message, sender) => {
    const node = await Node.getByUUID(message.uuid);

    node.__formatted_size = node.size ? formatBytes(node.size) : null;
    node.__formatted_date = node.date_added
        ? node.date_added.toString().replace(/:[^:]*$/, "")
        : null;
    node.__tab_id = sender.tab.id;

    return node;
};

receive.closeNotes = async message => browser.tabs.sendMessage(message.tabId, {type: "SCRAPYARD_CLOSE_NOTES"});

receive.getHideToolbarSetting = async message => {
    await settings.load();
    return settings.do_not_show_archive_toolbar();
};

receive.copyNodes = async message => {
    if (!await canUseBookmarking())
        return;

    return Bookmark.copy(message.node_ids, message.dest_id, message.move_last);
};

receive.shareToCloud = async message => {
    if (!await canUseBookmarking())
        return;

    return Bookmark.copy(message.node_ids, CLOUD_SHELF_ID, true);
}

receive.moveNodes = async message => {
    if (!await canUseBookmarking())
        return;

    return Bookmark.move(message.node_ids, message.dest_id, message.move_last);
};

receive.deleteNodes = async message => {
    if (!await canUseBookmarking())
        return;

    return Bookmark.delete(message.node_ids);
};

receive.softDeleteNodes = async message => {
    if (!await canUseBookmarking())
        return;

    return Bookmark.softDelete(message.node_ids);
};

receive.reorderNodes = async message => {
    if (!await canUseBookmarking())
        return;

    return Bookmark.reorder(message.positions, message.posProperty);
};

receive.reorderNodesUndoable = async message => {
    if (!await canUseBookmarking())
        return;

    return Bookmark.reorderUndoable(message.positions, message.oldPositions, message.posProperty);
};

receive.storePageHtml = message => {
    if (message.bookmark.__url_packing)
        return;

    return Bookmark.storeArchive(message.bookmark, message.html, "text/html", message.bookmark.__index)
        .then(() => {
            if (!message.bookmark.__mute_ui) {
                browser.tabs.sendMessage(message.bookmark.__tab_id, {type: "UNLOCK_DOCUMENT"});

                finalizeCapture(message.bookmark);

                if (message.bookmark.__crawl)
                    startCrawling(message.bookmark);
            }
        })
        .catch(e => {
            console.error(e);
            if (!message.bookmark.__mute_ui) {
                chrome.tabs.sendMessage(message.bookmark.__tab_id, {type: "UNLOCK_DOCUMENT"});
                showNotification("Error archiving page.");
            }
        });
};

receive.addNotes = message => Bookmark.addNotes(message.parent_id, message.name);

receive.storeNotes = message => Bookmark.storeNotes(message.options, message.property_change);

receive.uploadFiles = async message => {
    send.startProcessingIndication();

    try {
        const helper = await helperApp.hasVersion("0.4", `Scrapyard backend application v0.4+ is required for this feature.`);

        if (helper) {
            const fileUUID = UUID.numeric();
            await helperApp.post(`/serve/set_path/${fileUUID}`, {path: message.file_name});

            //const uuids = await helperApp.fetchJSON("/upload/open_file_dialog");
            const uuids = {[fileUUID]: message.file_name};

            for (const [uuid, file] of Object.entries(uuids)) {
                const url = helperApp.url(`/serve/file/${uuid}/`);
                const isHtml = /\.html?$/i.test(file);

                let bookmark = {uri: "", parent_id: message.parent_id};

                bookmark.name = file.replaceAll("\\", "/").split("/");
                bookmark.name = bookmark.name[bookmark.name.length - 1];

                let content;
                let contentType = getMimetypeByExt(file);

                try {
                    if (isHtml) {
                        const page = await packUrlExt(url);
                        bookmark.name = page.title || bookmark.name;
                        bookmark.icon = page.icon;
                        content = page.html;
                    }
                    else {
                        const response = await fetch(url);
                        if (response.ok) {
                            contentType = response.headers.get("content-type") || contentType;
                            content = await response.arrayBuffer();
                        }
                    }

                    bookmark = await Bookmark.add(bookmark, NODE_TYPE_ARCHIVE);
                    if (content)
                        await Bookmark.storeArchive(bookmark, content, contentType);
                    else
                        throw new Error();
                } catch (e) {
                    console.error(e);
                    showNotification(`Can not upload ${bookmark.name}`);
                }

                await helperApp.fetch(`/serve/release_path/${uuid}`);
            }
            if (Object.entries(uuids).length)
                send.nodesUpdated();
        }
    }
    finally {
        send.stopProcessingIndication();
    }
}

// receive.browseNode = async message => {
//     return browseNode(message.node, message);
// };

receive.browseNode = async message => {
    if (!_BACKGROUND_PAGE && settings.storage_mode_internal()) {
        const hostWindowId = await ensureSidebarHost();
        return send.browseNodeSidebar({...message, hostWindowId});
    }
    else
        return browseNodeBackground(message.node, message);
};

receive.browseNotes = message => {
    (message.tab
        ? updateTabURL(message.tab, "ui/notes.html#" + message.uuid, false)
        : browser.tabs.create({"url": "ui/notes.html#" + message.uuid}));
};

receive.browseOrgReference = message => {
    location.href = message.link;
};

receive.loadInternalResource = async message => {
    const url = browser.runtime.getURL(message.path);
    return await fetchText(url);
};

receive.abortRequested = message => {
    abortCrawling();
};

receive.replyFrameSiteCapture = (message, sender) => {
    browser.tabs.sendMessage(sender.tab.id, message);
};

receive.cancelSiteCapture = (message, sender) => {
    browser.tabs.sendMessage(sender.tab.id, message);
};

receive.continueSiteCapture = (message, sender) => {
    browser.tabs.sendMessage(sender.tab.id, message);
};

receive.performSiteCapture = (message, sender) => {
    performSiteCapture(message.bookmark);
};

receive.performUndo = async message => {
    send.startProcessingIndication();
    try {
        const result = await undoManager.undo();

        switch (result.operation) {
            case UNDO_DELETE:
                send.nodesImported({shelf: result.shelf});
            break;
            case UNDO_REORDER:
                send.nodesImported({shelf: result.shelf});
            break;
        }
    }
    finally {
        send.stopProcessingIndication();
    }
};

receive.saveResource = async message => {
    return Archive.saveFile(message.node, message.filename, message.content);
};
