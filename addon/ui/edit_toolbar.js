$(document).ready(async function () {
    const scrapyardNotFound = !!$("meta[name='scrapyard-not-found']").length;

    if (scrapyardNotFound) {
        await configureNotFoundTransition();
    }
    else {
        const toolbar = new EditToolbar();

        $(window).on("beforeunload", e => {
            if (toolbar._unsavedChanges)
                e.preventDefault();
        })
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------------------------------------------------

const CONTAINER_HEIGHT = 44;
const MARKER_COUNT = 8;

const TOOLBAR_ICON_PATHS = {
    save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8",
    edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
    help: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    eraser: "M20 20H8l-4-4a2 2 0 0 1 0-2.8L13.2 4a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L11 20M9 8l7 7",
    marker: "m9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
    notes: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M8 13h8M8 17h5",
    globe: "M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    out: "M7 17 17 7M8 7h9v9",
    info: "M12 11v5M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    close: "M18 6 6 18M6 6l12 12"
};

const toolbarIcon = name =>
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TOOLBAR_ICON_PATHS[name]}"/></svg>`;

/** the archive uuid is the second to last segment of the archive page URL, evaluate it at the point of use */
function archiveUuid() {
    return location.href.split("/").at(-2);
}

function isDescendant(parent, child) {
    var node = child;
    while (node != null) {
        if (node == parent) {
            return true;
        }
        node = node.parentNode;
    }
    return false;
}

function getDocType(doc) {
    const doctype = doc.doctype;
    let result = "";

    if (doctype)
        result = '<!DOCTYPE ' + doctype.name + (doctype.publicId ? ' PUBLIC "' + doctype.publicId + '"' : '') +
            ((doctype.systemId && !doctype.publicId) ? ' SYSTEM' : '') + (doctype.systemId ? ' "' + doctype.systemId + '"' : '') + '>\n';

    return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Marker pen
// ---------------------------------------------------------------------------------------------------------------------

function getTextNodesBetween(rootNode, startNode, endNode) {
    var pastStartNode = false, reachedEndNode = false, textNodes = [];

    function getTextNodes(node) {
        if (node == startNode) {
            pastStartNode = true;
        } else if (node == endNode) {
            reachedEndNode = true;
        } else if (node.nodeType == 3) {
            if (pastStartNode && !reachedEndNode && !/^\s*$/.test(node.nodeValue)) {
                textNodes.push(node);
            }
        } else {
            for (var i = 0, len = node.childNodes.length; !reachedEndNode && i < len; ++i) {
                getTextNodes(node.childNodes[i]);
            }
        }
    }

    if (startNode != endNode)
        getTextNodes(rootNode);
    return textNodes;
}

function surround(txnode, tag, cls, start_offset, end_offset) {
    var textRange = document.createRange();
    var el = document.createElement(tag);
    el.className = cls;
    if (Number.isInteger(start_offset) && Number.isInteger(end_offset)) {
        textRange.setStart(txnode, start_offset);
        textRange.setEnd(txnode, end_offset);
    } else {
        textRange.selectNodeContents(txnode);
    }
    textRange.surroundContents(el); /* only work for selection  within textnode */
    textRange.detach()
    return el;
}

function getCurrSelection() {
    var selection = {}
    selection.range = window.getSelection().getRangeAt(0);
    selection.parent = selection.range.commonAncestorContainer; /* element */

    /* these can be only text nodes for selection made by user */
    selection.start = selection.range.startContainer; /* textnode */
    selection.end = selection.range.endContainer; /* textnode */

    return selection;
}

function clearMarkPen() {
    var selection = getCurrSelection()
    $(selection.parent).find(".scrapyard-mark-pen").each(function () {
        if (selection.range.intersectsNode(this))
            $(this).replaceWith($(this).text());
    });
}

function mark(hlclass) {
    var hltag = "span";
    hlclass = "scrapyard-mark-pen " + hlclass;

    var selection = getCurrSelection()

    try {
        /* there are maybe text nodes between start and end (range cross more than one tag) */
        getTextNodesBetween(selection.parent, selection.start, selection.end).forEach(function (tn) {
            surround(tn, hltag, hlclass)
        });

        /* surround edges */
        if (selection.start == selection.end) {
            /** range in single text node */
            var span = surround(selection.start, hltag, hlclass, selection.range.startOffset, selection.range.endOffset);
            if (span && span.firstChild) {
                selection.range.setStart(span.firstChild, 0);
                selection.range.setEnd(span.firstChild, span.firstChild.nodeValue.length);
            }
        }
        else {
            var span1 = surround(selection.start, hltag, hlclass, selection.range.startOffset, selection.start.nodeValue.length);
            var span2 = surround(selection.end, hltag, hlclass, 0, selection.range.endOffset);
            if (span1 && span2 && span1.firstChild && span2.firstChild) {
                selection.range.setStart(span1.firstChild, 0);
                selection.range.setEnd(span2.firstChild, span2.firstChild.nodeValue.length);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The toolbar
// ---------------------------------------------------------------------------------------------------------------------

class EditToolbar {
    #tabId;

    _unsavedChanges = false;
    _contentEditing = false;
    _toolbarHidden = false;
    _documentMarginBottom;

    /** DOM Eraser state: `last` is the element currently under the cursor */
    erasing = false;
    last = null;
    targetBorder;

    rootContainer;
    shadowRoot;
    editBar;
    menu;

    constructor() {
        this.targetBorder = $("<div id='scrapyard-dom-eraser-border'>").appendTo(document.body);
        this.buildTools()

        window.addEventListener("mousedown", e => this._onWindowMouseDown(e));
        window.addEventListener("mousemove", e => this._onWindowMouseMove(e));
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Building the toolbar
    // -----------------------------------------------------------------------------------------------------------------

    buildTools() {
        this._documentMarginBottom = document.body.style.marginBottom;

        this._createShadowHost();

        this._addBrand();
        this._addSaveButton();
        this._addEditDocButton();
        this._addCaretBrowsingHelp();
        this._addEraserButton();
        this._addSeparator();

        this._addMarkerPen();
        this._addAutoOpenSwitch();

        const uuid = archiveUuid();

        this._addSeparator();
        this._addNotesButton(uuid);
        this._addSeparator();

        const originalURLLink = this._addOriginalURL(uuid);
        this._addGoButton(originalURLLink);
        this._addPageInfoButton();
        this._addHideButton();

        this._installToggleShortcut();

        loadInternalResources(this.shadowRoot);

        this._applyInitialVisibility();
    }

    _createShadowHost() {
        this.rootContainer = $(`<div id="scrapyard-edit-bar-container"></div>`).appendTo(document.body)[0];

        this.shadowRoot = this.rootContainer.attachShadow({mode: 'open'});
        this.shadowRoot.innerHTML = `
            <style id="scrapyard-toolbar-style"></style>
            <div id="scrapyard-edit-bar">`;

        this.editBar = $("#scrapyard-edit-bar", this.shadowRoot)[0];
    }

    _append(html) {
        return $(html).appendTo(this.editBar);
    }

    _addSeparator() {
        this._append(`<span class="scrapyard-sep"></span>`);
    }

    _addBrand() {
        this._append(`<div class="scrapyard-brand"><img id="scrapyard-icon" src=""><b id="scrapyard-brand">Scrapyard</b></div>`);
    }

    _addSaveButton() {
        this._append(`<button id="scrapyard-save-doc-button" type="button" class="scrapyard-btn scrapyard-primary">
                          ${toolbarIcon("save")}<span>Save</span></button>`)
            .on("click", e => {
                this._unsavedChanges = false;
                this.saveDoc();
            });
    }

    _addEditDocButton() {
        this._append(`<button id="scrapyard-edit-doc-button" type="button" class="scrapyard-btn">
                          ${toolbarIcon("edit")}<span>Edit document</span></button>`)
            .on("click", e => {
                this._contentEditing = !this._contentEditing;
                $(e.currentTarget).toggleClass("scrapyard-on", this._contentEditing)
                    .find("span").text(this._contentEditing ? "Finish editing" : "Edit document");

                document.designMode = document.designMode === "on"? "off": "on";

                $("#scrapyard-dom-eraser-button", this.editBar).prop("disabled", this._contentEditing);
            });
    }

    _addCaretBrowsingHelp() {
        this._append(`<span class="scrapyard-rel">
                          <button type="button" class="scrapyard-btn scrapyard-ghost scrapyard-icon-btn"
                                  aria-label="Help: press F7 to turn on caret browsing">${toolbarIcon("help")}</button>
                          <span class="scrapyard-pop scrapyard-tip scrapyard-tip-left">Press F7 to turn on caret browsing.</span>
                      </span>`);
    }

    _addEraserButton() {
        this._append(`<button id="scrapyard-dom-eraser-button" type="button" class="scrapyard-btn">
                          ${toolbarIcon("eraser")}<span>DOM Eraser</span></button>`)
            .on("click", e => {
                this.erasing = !this.erasing;
                this.toggleDomEraser(this.erasing)
                $(e.currentTarget).toggleClass("scrapyard-on", this.erasing).prop("disabled", false);
            });
    }

    _addMarkerPen() {
        const markerWrap = this._append(`<span class="scrapyard-rel"></span>`);

        $(`<button id="scrapyard-marker-button" type="button" class="scrapyard-btn">
               ${toolbarIcon("marker")}<span>Marker pen</span></button>`)
            .appendTo(markerWrap)
            .on("click", e => {
                this.setMenuOpen(!$(this.menu).is(":visible"));
            });

        const menu = $(`<div id="scrapyard-marker-menu" class="scrapyard-pop"></div>`).appendTo(markerWrap);
        const appendMenu = html => $(html).appendTo(menu);
        this.menu = menu[0];

        appendMenu(`<div class="scrapyard-menu-item-wrapper scrapyard-menu-clear">
                        ${toolbarIcon("eraser")}<span>Clear markers</span>
                    </div>`)
            .on("mousedown", e => {
                e.preventDefault()

                this.setMenuOpen(false);
                if (this.isSelectionPresent()) {
                    clearMarkPen();
                    this.deselect();
                }
                else
                    alert("No active selection.");
            });

        appendMenu(`<hr>`);

        for (let i = 1; i <= MARKER_COUNT; ++i) {
            appendMenu(`<div class="scrapyard-menu-item-wrapper">
                            <div class="scrapyard-menu-item"><span class="scrapyard-marker-${i}">Example text</span></div>
                        </div>`)
                .on("mousedown", e => {
                    e.preventDefault()

                    this.setMenuOpen(false);
                    if (this.isSelectionPresent()) {
                        mark(`scrapyard-marker-${i}`);
                        this._unsavedChanges = true;
                        this.deselect();
                    }
                    else
                        alert("No active selection.");
                });
        }
    }

    _addAutoOpenSwitch() {
        const autoOpenCheck = this._append(`<label class="scrapyard-switch">
                                                <input id="scrapyard-auto-open-check" type="checkbox"><i></i>Auto open
                                            </label>`).find("input")[0];

        $(document).on('mouseup', e => {
            if (autoOpenCheck.checked && this.isSelectionPresent())
                $("#scrapyard-marker-button", this.shadowRoot).click();
        })
        $(document).on('mousedown', e => {
            if (autoOpenCheck.checked && this.isSelectionPresent() && $(this.menu).is(":visible") && e.target !== this.menu)
                this.setMenuOpen(false);
        });
    }

    _addNotesButton(uuid) {
        this._append(`<button id="scrapyard-view-notes" type="button" class="scrapyard-btn">
                          ${toolbarIcon("notes")}<span>Notes</span></button>`)
            .on("click", async e => {
                if ($("#scrapyard-notes-frame").length)
                    this._closeNotes();
                else {
                    const notesPageURL = browser.runtime.getURL("/ui/notes_iframe.html")
                        + "#" + uuid + ":" + this.#tabId;

                    $(document.body).prepend(`<iframe id="scrapyard-notes-frame" src="${notesPageURL}"/>
                                              <div id="scrapyard-notes-dim"></div>`)
                        .addClass("scrapyard-no-overflow");
                }
            });

        browser.runtime.onMessage.addListener(message => {
            if (message.type === "SCRAPYARD_CLOSE_NOTES")
                this._closeNotes();
        });
    }

    _closeNotes() {
        $("#scrapyard-notes-frame").remove();
        $("#scrapyard-notes-dim").remove();
        $(document.body).removeClass("scrapyard-no-overflow");
    }

    /** returns the link element the "go" button clicks */
    _addOriginalURL(uuid) {
        this._append(`<span id="scrapyard-original-url-label">Original</span>`);
        const urlBox = this._append(`<div class="scrapyard-url" title="Original URL">${toolbarIcon("globe")}
                                         <span id="scrapyard-original-url-text"></span></div>`);
        const originalURLText = $("#scrapyard-original-url-text", urlBox)[0];
        const originalURLLink = this._append(`<a id="scrapyard-original-url-link" target="_blank" href="#"></a>`)[0];

        browser.runtime.sendMessage({
            type: "getBookmarkInfo",
            uuid
        }).then(node => {
            this.#tabId = node.__tab_id;
            originalURLText.textContent = node?.uri || "";
            urlBox.attr("title", node?.uri || "Original URL");
            originalURLLink.href = node?.uri || "#";
            $("#scrapyard-page-info", this.editBar).html(this.formatPageInfo(node));
        });

        return originalURLLink;
    }

    _addGoButton(originalURLLink) {
        this._append(`<button id="scrapyard-go-button" type="button" class="scrapyard-btn scrapyard-ghost scrapyard-icon-btn"
                              aria-label="Open original page" title="Open original page">${toolbarIcon("out")}</button>`)
            .on("click", e => {
                if (originalURLLink.href !== "#")
                    originalURLLink.click();
            });
    }

    _addPageInfoButton() {
        this._append(`<span class="scrapyard-rel">
                          <button type="button" class="scrapyard-btn scrapyard-ghost scrapyard-icon-btn"
                                  aria-label="Page info">${toolbarIcon("info")}</button>
                          <span id="scrapyard-page-info" class="scrapyard-pop scrapyard-tip scrapyard-tip-right"></span>
                      </span>`);
    }

    _addHideButton() {
        this._append(`<button id="scrapyard-hide-button" type="button" class="scrapyard-btn scrapyard-ghost scrapyard-icon-btn"
                              aria-label="Hide toolbar" title="Hide toolbar">${toolbarIcon("close")}</button>`)
            .on("click", e => {
                this._exitEraserIfActive();

                this._toolbarHidden = true;
                document.body.style.marginBottom = this._documentMarginBottom;
                $(this.rootContainer).hide();
            });
    }

    _installToggleShortcut() {
        $(document).on("keydown", e => {
            if (e.code === "KeyT" && e.ctrlKey && e.altKey) {
                const willHide = !this._toolbarHidden;
                if (willHide)
                    this._exitEraserIfActive();

                $(this.rootContainer).toggle();
                this._toolbarHidden = !this._toolbarHidden;
                document.body.style.marginBottom =
                    this._toolbarHidden
                        ? this._documentMarginBottom
                        : `${CONTAINER_HEIGHT + 10}px`;
            }
        });
    }

    _applyInitialVisibility() {
        browser.runtime.sendMessage({type: "getHideToolbarSetting"})
            .then(hide => {
                this._toolbarHidden = hide;
                if (!this._toolbarHidden) {
                    setTimeout(() => {
                        document.body.style.marginBottom = `${CONTAINER_HEIGHT + 10}px`;
                        this.rootContainer.style.display = "block"
                    }, 300);
                }
            });
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Page-level mouse handling (DOM Eraser and closing the marker menu)
    // -----------------------------------------------------------------------------------------------------------------

    _onWindowMouseDown(e) {
        if (e.button === 0) {
            /** remove dom node by cleaner */
            if (!isDescendant(this.rootContainer, e.target) && this.last && this.erasing) {
                e.preventDefault();
                this.last.parentNode.removeChild(this.last);
                this.last = null;
                /** check next hover target after current target removed */
                var em = new Event('mousemove');
                em.pageX = e.pageX;
                em.pageY = e.pageY;
                window.dispatchEvent(em);
            }
            /** hide marker-pen menu when click somewhere */
            if (!e.composedPath().some(n => n.id === "scrapyard-marker-button")) {
                if ($(this.menu).is(":visible")) {
                    e.preventDefault();
                    this.setMenuOpen(false);
                }
            }
        }
    }

    _onWindowMouseMove(e) {
        /** hover dom node by cleaner */
        if (this.erasing) {

            var dom = document.elementFromPoint(e.pageX, e.pageY - window.scrollY);
            if (dom && !isDescendant(this.rootContainer, dom)) {
                if (dom !== document.body && $(document.body).closest(dom).length === 0) {
                    this.last = dom;
                    var r = dom.getBoundingClientRect();
                    this.targetBorder.css("pointer-events", "none");
                    this.targetBorder.css("box-sizing", "border-box");
                    this.targetBorder.css({
                        border: "2px solid #f00",
                        position: "absolute",
                        left: parseInt(r.left) + "px",
                        top: parseInt(r.top + window.scrollY) + "px",
                        width: r.width + "px",
                        height: r.height + "px",
                        zIndex: 2147483646
                    });
                    this.targetBorder.show();
                }
                else {
                    this.targetBorder.hide();
                    // document.body or ancestors
                }
            }
            else {
                /** cursor is over the toolbar itself (or no element under it), clear any stale border */
                this.last = null;
                this.targetBorder.hide();
            }
        }
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Selection and marker menu
    // -----------------------------------------------------------------------------------------------------------------

    isSelectionPresent() {
        let selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            return !selection.getRangeAt(0).collapsed;
        }
        return false;
    }

    deselect() {
        let selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            selection.collapseToStart();
        }
    }

    setMenuOpen(open) {
        $(this.menu).toggle(open);
        $("#scrapyard-marker-button", this.shadowRoot).toggleClass("scrapyard-on", open);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // DOM Eraser
    // -----------------------------------------------------------------------------------------------------------------

    toggleDomEraser(on) {
        this.last = null;
        this.erasing = on;
        this.targetBorder.hide();
        $(this.editBar).find("button").not("#scrapyard-save-doc-button").prop("disabled", on);
        document.body.style.cursor = this.erasing? "crosshair": "";
    }

    /** if the toolbar is hidden while DOM Eraser is still on, turn it off instead of leaving it dangling */
    _exitEraserIfActive() {
        if (this.erasing) {
            this.erasing = false;
            this.toggleDomEraser(false);
            $("#scrapyard-dom-eraser-button", this.editBar).removeClass("scrapyard-on");
        }
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Saving and page info
    // -----------------------------------------------------------------------------------------------------------------

    formatPageInfo(node) {
        let html = "";

        if (node?.__formatted_date)
            html += `<b>Added on:</b> ${node?.__formatted_date}`;

        if (node?.__formatted_date && node?.__formatted_size)
            html += ", ";

        if (node?.__formatted_size)
            html += `<b>Size:</b> ${node?.__formatted_size}`;

        if (!html)
            html = "&lt;no data&gt;";

        return html;
    }

    _fixDocumentEncoding(doc) {
        let meta = doc.querySelector("meta[http-equiv='content-type' i]")
            || doc.querySelector("meta[charset]");

        if (meta)
            meta.parentNode.removeChild(meta);

        $(doc.getElementsByTagName("head")[0]).prepend(`<meta charset="utf-8">`);
    }

    async saveDoc() {
        let saveButton = $("#scrapyard-save-doc-button", this.shadowRoot);
        saveButton.addClass("scrapyard-flash-button");

        setTimeout(() => saveButton.removeClass("scrapyard-flash-button"),1000);

        let doc = document.documentElement.cloneNode(true);
        $(`#scrapyard-edit-bar-container, #scrapyard-dom-eraser-border`, doc).remove();
        /** the DOM Eraser cursor is transient UI state, must not leak into the saved archive */
        $(doc).find("body").css("cursor", "");

        this._fixDocumentEncoding(doc);

        const uuid = archiveUuid();
        const html = getDocType(document) + doc.outerHTML;

        try {
            await browser.runtime.sendMessage({type: "updateArchive", uuid, data: html});
        }
        catch (e) {
            console.error(e);
            this._unsavedChanges = true;
            alert("Error saving the archive: " + e.message);
            return;
        }

        const node = await browser.runtime.sendMessage({type: "getBookmarkInfo", uuid});
        $("#scrapyard-page-info", this.editBar).html(this.formatPageInfo(node))
    }
}

async function loadInternalResources(shadowRoot) {
    // in MV3 resources marked as web accessible in the manifest become unavailable in the addon scripts
    // so, we need to unmark them as web accessible and load them explicitly in the content script
    const toolbarCSS = browser.runtime.sendMessage({
        type: "loadInternalResource",
        path: "ui/edit_toolbar.css"
    });

    const svgLogo = browser.runtime.sendMessage({
        type: "loadInternalResource",
        path: "icons/scrapyard.svg"
    })

    await Promise.all([toolbarCSS, svgLogo]);

    $("#scrapyard-toolbar-style", shadowRoot).text(await toolbarCSS);

    $("#scrapyard-icon", shadowRoot).prop("src", `data:image/svg+xml,${encodeURIComponent(await svgLogo)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// "Not found" and expired-link pages
// ---------------------------------------------------------------------------------------------------------------------

async function configureNotFoundTransition() {
    const SCRAPYARD_SETTINGS_KEY = "scrapyard-settings";
    const settings = (await browser.storage.local.get(SCRAPYARD_SETTINGS_KEY))?.[SCRAPYARD_SETTINGS_KEY];

    if (document.querySelector("meta[name='scrapyard-link-expired']")) {
        configureLinkExpired();
        return;
    }

    if (settings?.transition_to_disk) {
        const notFoundWrapperDiv = document.getElementById("not-found-wrapper");
        const notFoundTextDiv = document.getElementById("not-found-text");
        notFoundTextDiv.textContent = "TRANSITION REQUIRED";

        const notFoundImg = document.getElementById("not-found-image");
        notFoundImg.parentElement.removeChild(notFoundImg);

        const transitionLink = document.createElement("a");
        transitionLink.setAttribute("style", "font-family: Arial, sans-serif;");
        transitionLink.textContent = "Transition Guide";
        transitionLink.addEventListener("click", e => {
            e.preventDefault();

            browser.runtime.sendMessage({
                type: "browseNode",
                node: {
                    type: 3,
                    uri: browser.runtime.getURL("/ui/options.html#transition")
                }
            });
        });
        transitionLink.href = "#";
        notFoundWrapperDiv.appendChild(transitionLink);
    }
}

// a signed server URL of an archive has expired or is invalid, the archive could be reopened with a new URL
function configureLinkExpired() {
    const uuid = location.href.split("?")[0].split("/").at(-2);
    const notFoundWrapperDiv = document.getElementById("not-found-wrapper");
    const notFoundImg = document.getElementById("not-found-image");
    notFoundImg?.parentElement.removeChild(notFoundImg);

    const reopenLink = document.createElement("a");
    reopenLink.setAttribute("style", "font-family: Arial, sans-serif;");
    reopenLink.textContent = "Open the archive again";
    reopenLink.href = "#";
    reopenLink.addEventListener("click", async e => {
        e.preventDefault();

        try {
            const node = await browser.runtime.sendMessage({type: "getBookmarkInfo", uuid});

            if (node)
                await browser.runtime.sendMessage({type: "browseNode", node, tab: {id: node.__tab_id}});
        }
        catch (e) {
            console.error(e);
            alert("Can not open the archive: " + e.message);
        }
    });

    notFoundWrapperDiv.appendChild(reopenLink);
}

console.log("==> edit_toolbar.js loaded")
