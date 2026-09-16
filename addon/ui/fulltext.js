import {send} from "../proxy.js"
import {settings} from "../settings.js";
import {
    assembleUnpackedContent,
    fixDocumentEncoding, injectCSS,
    instantiateIFramesRecursive,
    parseHtml,
    phraseMatcher,
    rebuildIFramesRecursive
} from "../utils_html.js";
import {getActiveTab, showNotification} from "../utils_browser.js";
import {ShelfList} from "./shelf_list.js";
import {Bookmark} from "../bookmarks_bookmark.js";
import {Archive, Icon, Notes} from "../storage_entities.js";
import {systemInitialization} from "../bookmarks_init.js";
import {ProgressCounter, sleep} from "../utils.js";
import {helperApp} from "../helper_app.js";
import {RDF_EXTERNAL_TYPE, NODE_TYPE_NOTES} from "../storage.js";
import {notes2html} from "../notes_render.js";

const IGNORE_PUNCTUATION = ",-–—‒'\"+=".split("");

let shelfList;

window.addEventListener('DOMContentLoaded', () => {
    const searchScopePlaceholderDiv = $("#search-scope-placeholder");
    searchScopePlaceholderDiv.css("width", ShelfList.getStoredWidth("fulltext") || ShelfList.DEFAULT_WIDTH);
    searchScopePlaceholderDiv.show();
});

$(init);

async function init() {
    await systemInitialization;

    shelfList = new ShelfList("#search-scope", {
        maxHeight: settings.shelf_list_height() || settings.default.shelf_list_height,
        _prefix: "fulltext"
    });

    await shelfList.initDefault()

    $("#search-button").on("click", e => performSearch());
    $("#search-query").on("keydown", e => {if (e.originalEvent.code === "Enter") performSearch();});
}

let searching;
let searchQuery;
let previewURL;
let resultsFound;

async function previewResult(query, node) {
    if (node.__notes_search)
        return previewNotes(query, node);
    if (Archive.isUnpacked(node))
        return previewUnpackedResult(query, node);
    else
        return previewPackedResult(query, node);
}

async function previewPackedResult(query, node) {
    const archive = await Archive.get(node);
    const content = await Archive.reify(archive);
    const doc = parseHtml(content);
    const [iframeDocs, topIframes] = instantiateIFramesRecursive(doc);
    const mark = new Mark(doc.body);

    for (const iframeDoc of iframeDocs)
        await markDoc(query, iframeDoc)

    rebuildIFramesRecursive(doc, topIframes);

    mark.mark(query, {
        iframes: true,
        acrossElements: true,
        separateWordSearch: false,
        ignorePunctuation: IGNORE_PUNCTUATION,
        done: () => displayDocument(doc, node)
    });
}

function displayDocument(doc, node) {
    fixDocumentEncoding(doc);
    $(doc.head).append("<style>mark {background-color: #ffff00 !important;}</style>");
    let html = doc.documentElement.outerHTML;

    if (previewURL)
        URL.revokeObjectURL(previewURL);

    let object = new Blob([html], {type: "text/html"});
    previewURL = URL.createObjectURL(object);
    displayURL(previewURL, node);
}

async function previewUnpackedResult(query, node) {
    let url = node.external === RDF_EXTERNAL_TYPE
        ? `/rdf/browse/${node.uuid}`
        : `/browse/${node.uuid}`;

    url += `?highlight=${encodeURIComponent(query)}`;

    const previewURL = await helperApp.signedURL(url);
    displayURL(previewURL, node);
}

async function previewNotes(query, node) {
    const notes = await Notes.get(node);
    const html = notes2html(notes);
    const doc = parseHtml(html);
    const mark = new Mark(doc.body);

    injectCSS(browser.runtime.getURL("/lib/quill/quill.snow.css"), doc);
    injectCSS(browser.runtime.getURL("/lib/org/org.css"), doc);
    injectCSS(browser.runtime.getURL("/ui/notes.css"), doc);

    mark.mark(query, {
        iframes: true,
        acrossElements: true,
        separateWordSearch: false,
        ignorePunctuation: IGNORE_PUNCTUATION,
        done: () => displayDocument(doc, node)
    });
}

function displayURL(previewURL, node) {
    $(`#found-items td`).css("background-color", "transparent");
    $(`#row_${node.id} .result-row`).css("background-color", "#DDDDDD");

    // the frame is navigated rather than recreated: rebuilding the element tears the
    // preview down to an empty box first, which is what makes it blink between results
    previewFrame().src = previewURL;
}

function previewFrame() {
    let frame = document.getElementById("search-preview-content");

    if (!frame) {
        frame = document.createElement("iframe");
        frame.id = "search-preview-content";
        frame.className = "search-preview-content";
        document.getElementById("search-preview").appendChild(frame);
    }

    return frame;
}

async function markDoc(query, doc) {
    const mark = new Mark(doc);

    let resolveResult;
    const promise = new Promise(resolve => resolveResult = resolve);

    mark.mark(query, {
        iframes: true,
        acrossElements: true,
        separateWordSearch: false,
        ignorePunctuation: IGNORE_PUNCTUATION,
        done: () => resolveResult()
    });

    return promise;
}

async function appendSearchResult(query, node, occurrences) {
    const foundItems = $("#found-items");
    const fallbackIcon = "/icons/globe.svg";

    let icon = node.icon;
    if (node.__notes_search)
        icon = "/icons/notes.svg"
    else if (node.stored_icon)
        icon = await Icon.get(node);

    if (!icon)
        icon = fallbackIcon;

    let html = `<tr  id="row_${node.id}">
                  <td class="result-actions">
                    <div class="cell-content">
                      <img id="select_${node.id}" class="result-action-icon" src="../icons/tree-select.svg" title="Select"/>
                      <img id="open_this_tab_${node.id}" class="result-action-icon" src="../icons/open-link-this-tab.svg" title="Open in this tab"/>
                      <img id="open_${node.id}" class="result-action-icon" src="../icons/open-link.svg" title="Open in new tab"/>&nbsp;
                    </div>
                  </td>
                  <td id="item_${node.id}" class="search-result result-row">
                   <div class="cell-content">
                      <img id="icon_${node.id}" class="result-icon" src="${icon}"/>
                     <span id="title_${node.id}" class="result-title">${node.name}</span>
                   </div>
                 </td>
                 <td id="occurrences_${node.id}" class="occurrences result-row">
                   <div class="cell-content">${occurrences} ${occurrences === 1 ? " occurrence" : " occurrences"}</div>
                 </td>
               </tr>`;

    foundItems.append(html);

    if (!node.stored_icon && node.icon) {
        let image = new Image();
        image.onerror = e => {
            $(`#icon_${node.id}`).prop("src", fallbackIcon);
        };
        image.src = icon;
    }

    const preview = () => previewResult(query, node).catch(e => {
        console.error(e);
        showNotification(`Can not display the content: ${e.message}`);
    });

    $(`#item_${node.id}`).click(e => preview());
    $(`#occurrences_${node.id}`).click(e => preview());
    $(`#select_${node.id}`).click(e => send.selectNode({node}));
    $(`#open_this_tab_${node.id}`).click(async e => send.browseNode({node, tab: await getActiveTab(), preserveHistory: true}));
    $(`#open_${node.id}`).click(e => send.browseNode({node}));

    ++resultsFound;
    updateResultCount();
}

async function countSearch(query, nodes) {
    const progressCounter = new ProgressCounter(nodes.length, "fullTextSearchProgress");
    const matcher = phraseMatcher(query);

    setSearchProgressTotal(nodes.length);

    for (const node of nodes) {
        if (!searching)
            break;

        let total = 0;

        try {
            for (const content of await getSearchableContent(node))
                total += matcher.count(content);
        }
        catch (e) {
            console.error(e);
        }

        progressCounter.incrementAndNotify();
        advanceSearchProgress();

        if (total > 0)
            await appendSearchResult(query, node, total);
    }

    stopSearch(progressCounter);
}

// Returns the content of a node as HTML strings. Only their text is needed to count the
// occurrences, and parsing every archive into a document to obtain it is what made the
// search slow; the marking of the previewed document is a separate matter.
async function getSearchableContent(node) {
    if (node.__notes_search) {
        const notes = await Notes.get(node);
        return notes? [notes2html(notes)]: [];
    }
    else if (Archive.isUnpacked(node))
        return assembleUnpackedContent(node);
    else {
        const archive = await Archive.get(node);
        const content = archive? await Archive.reify(archive): null;

        // a binary archive (a PDF or an image) reifies into an array buffer, which has no text
        return typeof content === "string"? [content]: [];
    }
}

async function performSearch() {
    if (!searching) {
        searchQuery = $("#search-query").val().trim();

        if (!searchQuery)
            return;

        searching = true;
        $("#search-button").val("Cancel");

        resultsFound = 0;
        updateResultCount();
        startSearchProgress();

        $("title").text("Full Text Search: " + searchQuery);

        send.startProcessingIndication({noWait: true});

        let nodes = await Bookmark.list({
            search: searchQuery,
            content: true,
            index: "content",
            partial: true,
            order: "date_desc",
            path: shelfList.selectedShelfName
        });

        const noteNodes = await Bookmark.list({
            search: searchQuery,
            content: true,
            index: "notes",
            partial: true,
            order: "date_desc",
            path: shelfList.selectedShelfName
        });

        noteNodes.forEach(n => n.__notes_search = true);

        nodes = [...noteNodes, ...nodes];

        $("#found-items").empty();
        previewFrame().src = "about:blank";

        countSearch(searchQuery, nodes);
    }
    else
        searching = false;
}

function stopSearch(progressCounter) {
    searching = false;
    $("#search-button").val("Search");
    send.stopProcessingIndication();
    progressCounter.finish();
    stopSearchProgress();
    updateResultCount();

    if (searchQuery !== $("#search-query").val())
        performSearch();
}

function updateResultCount() {
    if (searching)
        $("#search-result-count").text(`searching… ${resultsFound} found`);
    else if (resultsFound === 0)
        $("#search-result-count").text("not found");
    else
        $("#search-result-count").text(`${resultsFound} ${resultsFound === 1? "result": "results"} found`);
}

// The page has to indicate its own progress: the ProgressCounter messages that the search
// sends are received by the sidebar, which is a different document and is not necessarily
// even open, so nothing of them is visible here.
const PROGRESS_DELAY_MS = 200;

let progressTimeout;
let progressTotal;
let progressDone;

function startSearchProgress() {
    progressTotal = 0;
    progressDone = 0;
    renderSearchProgress();

    // a search that completes at once should not flash the bar on and off
    clearTimeout(progressTimeout);
    progressTimeout = setTimeout(() => $("#search-progress").show(), PROGRESS_DELAY_MS);
}

function setSearchProgressTotal(total) {
    progressTotal = total;
    renderSearchProgress();
}

function advanceSearchProgress() {
    progressDone += 1;
    renderSearchProgress();
}

function stopSearchProgress() {
    clearTimeout(progressTimeout);

    const bar = $("#search-progress");

    if (bar.is(":visible")) {
        // let the bar run out rather than vanish half way, as the sidebar one does
        bar.css("width", "100%");
        progressTimeout = setTimeout(() => bar.hide().css("width", 0), 200);
    }
    else
        bar.hide().css("width", 0);
}

function renderSearchProgress() {
    const progress = progressTotal? (progressDone / progressTotal) * 100: 0;

    // the bar keeps a visible stub from the outset, so that the index query and a slow
    // first archive do not look like a stall
    $("#search-progress").css("width", `${Math.max(progress, 2)}%`);
}
