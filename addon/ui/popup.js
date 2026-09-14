import {
    byName,
    DEFAULT_SHELF_NAME,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK,
    NODE_TYPE_SHELF,
    NODE_TYPE_FOLDER,
    BROWSER_EXTERNAL_TYPE
} from "../storage.js";
import {askCSRPermission, getActiveTab, showNotification} from "../utils_browser.js";
import {selectricRefresh, simpleSelectric} from "./shelf_list.js";
import {systemInitialization} from "../bookmarks_init.js";
import {getFaviconFromTab} from "../favicon.js";
import {Query} from "../storage_query.js";
import {BookmarkTree} from "./tree.js";
import {send} from "../proxy.js";
import {openSidePanel, toggleSidebarWindow} from "../utils_sidebar.js";
import {isSpecialPage} from "../bookmarking.js";
import {settings} from "../settings.js";

let tree;
let bookmarkFolderSelect;
let folderHistory;
let crawlerMode;
let windowId;

$(init);

async function init() {
    await systemInitialization;

    let nodes = await Query.allFolders();

    if (settings.sort_shelves_in_popup())
        nodes = sortShelves(nodes);

    tree = new BookmarkTree("#treeview", true);
    bookmarkFolderSelect = simpleSelectric("#bookmark-folder");
    folderHistory = loadFolderHistory(nodes);

    $("#bookmark-tags").focus();
    initBookmarkFolderSelect(bookmarkFolderSelect, folderHistory);
    tree.update(nodes);

    await saveActiveTabProperties();

    if (_SIDE_PANEL)
        windowId = (await browser.windows.getCurrent()).id;

    $("#new-shelf").on("click", () => createNewFolder(NODE_TYPE_SHELF));
    $("#new-folder").on("click", () => createNewFolder(NODE_TYPE_FOLDER));
    $("#crawler-check").on("click", switchCrawlerMode);
    $("#treeview").on("select_node.jstree", onTreeFolderSelected);
    $("#sidebar-toggle").on("click", toggleSidebar);
    $("#create-bookmark").on("click", async () => await addBookmark(NODE_TYPE_BOOKMARK));
    $("#create-archive").on("click", async e => await addBookmark(NODE_TYPE_ARCHIVE));
    bookmarkFolderSelect.on("change", () => tree.selectNode(bookmarkFolderSelect.val(), false, true));
}

function sortShelves(nodes) {
    const shelves = nodes.filter(n => n.type === NODE_TYPE_SHELF);
    const otherNodes = nodes.filter(n => n.type !== NODE_TYPE_SHELF);

    shelves.sort((a, b) => a.id - b.id);

    const builtinShelves = shelves.filter(n => n.id < 2);
    const userShelves = shelves.filter(n => n.id > 1);

    userShelves.sort(byName);

    return [...builtinShelves, ...userShelves, ...otherNodes];
}

function loadFolderHistory(nodes) {
    let folderHistory = localStorage.getItem("popup-folder-history");

    if (folderHistory && folderHistory !== "null")
        folderHistory = JSON.parse(folderHistory).filter(h => nodes.some(n => n.id == h.id));
    else if (!folderHistory || folderHistory === "null")
        folderHistory = [];

    return folderHistory;
}

function saveFolderHistory(nodeId, text, history) {
    if (nodeId) {
        let folderHistory = history.slice(0);
        let existing = folderHistory.find(h => h.id == nodeId);

        if (existing)
            folderHistory.splice(folderHistory.indexOf(existing), 1);

        folderHistory = [{id: nodeId, text: text}, ...folderHistory].slice(0, 10);
        localStorage.setItem("popup-folder-history", JSON.stringify(folderHistory));
    }
}

function initBookmarkFolderSelect(bookmarkFolderSelect, folderHistory) {
    bookmarkFolderSelect.empty();

    if (folderHistory?.length)
        for (let item of folderHistory)
            bookmarkFolderSelect.append(`<option class='folder-label' value='${item.id}'>${item.text}</option>`);
    else
        bookmarkFolderSelect.append(`<option class='folder-label' value='1'>${DEFAULT_SHELF_NAME}</option>`);

    selectricRefresh(bookmarkFolderSelect);
}

function onTreeFolderSelected(e, {node: jnode}) {
    let existing = $(`#bookmark-folder option[value='${jnode.id}']`);

    if (!existing.length) {
        $("#bookmark-folder option[data-tentative='true']").remove();
        bookmarkFolderSelect.prepend(`<option class='folder-label' data-tentative='true' selected
                                                    value='${jnode.id}'>${jnode.text}</option>`)
        selectricRefresh(bookmarkFolderSelect)
    }

    bookmarkFolderSelect.val(jnode.id);
    selectricRefresh(bookmarkFolderSelect)
}

async function createNewFolder(type) {
    const folder = await tree.createNewFolderUnderSelection("$new_node$", type);

    if (folder) {
        let newOption = $(`#bookmark-folder option[value='$new_node$']`);
        newOption.text(folder.name);
        newOption.val(folder.id);
        bookmarkFolderSelect.val(folder.id);
        selectricRefresh(bookmarkFolderSelect)
    }
}

function switchCrawlerMode(e) {
    if (e.target.src.endsWith("mode-page.svg")) {
        e.target.src = "../icons/mode-site.svg";
        $("#create-archive").val("Archive Site");
        crawlerMode = true;
    }
    else {
        e.target.src = "../icons/mode-page.svg"
        $("#create-archive").val("Archive");
        crawlerMode = false;
    }
}

async function saveActiveTabProperties() {
    const activeTab = await getActiveTab();
    const highlightedTabs = await browser.tabs.query({highlighted: true, currentWindow: true});

    if (activeTab && highlightedTabs.length === 1) {
        $("#bookmark-name").val(activeTab.title);
        $("#bookmark-url").val(activeTab.url);

        let favicon;
        if (!isSpecialPage(activeTab.url))
            favicon = await getFaviconFromTab(activeTab);

        if (favicon)
            $("#bookmark-icon").val(favicon);
    }
}

async function addBookmark(nodeType) {
    const parentNodeId = $("#bookmark-folder").val();
    let parentNode = tree.adjustBookmarkingTarget(parentNodeId);
    saveFolderHistory(parentNode.id + "", parentNode.name, folderHistory);

    const payload = {
        type: nodeType,
        name: $("#bookmark-name").val(),
        uri:  $("#bookmark-url").val(),
        tags: $("#bookmark-tags").val(),
        icon: $("#bookmark-icon").val(),
        parent_id: parentNode.id,
        __crawl: crawlerMode
    };

    let canProceed = true;
    if (nodeType === NODE_TYPE_ARCHIVE)
        if (!await askCSRPermission())
            canProceed = false;

    if (canProceed)
        await send.captureHighlightedTabs({options: payload});

    window.close();
}

function toggleSidebar() {
    if (browser.sidebarAction)
        browser.sidebarAction.toggle();
    else if (_SIDE_PANEL) {
        openSidePanel(windowId).then(() => window.close());
    }
    else
        toggleSidebarWindow();
}

console.log("==> popup.js loaded");
