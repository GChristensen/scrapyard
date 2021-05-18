class Edit_toolbar {
    constructor() {
        var self = this;
        this.$cap = $("<div>").appendTo(document.body);
        this.buildTools()

        window.addEventListener("mousedown", function (e) {
            if (e.button == 0) {
                /** remove dom node by cleaner */
                if(!isDescendant(self.div, e.target) /** out of toolbar */
                    && self.last && self.editing){
                    e.preventDefault();
                    self.last.parentNode.removeChild(self.last);
                    self.last=null;
                    /** check next hover target after current target removed */
                    var em = new Event('mousemove');
                    em.pageX = e.pageX;
                    em.pageY = e.pageY;
                    window.dispatchEvent(em);
                }
                /** hide marker-pen menu when click somewhere */
                if (!$(e.target).hasClass("mark-pen-btn")) {
                    if ($(self.menu).is(":visible")) {
                        e.preventDefault();
                        $(self.menu).hide();
                    }
                }
            }
        });

        window.addEventListener("mousemove", function(e){
            /** hover dom node by cleaner */
            if(self.editing){

                var dom = document.elementFromPoint(e.pageX, e.pageY - window.scrollY);
                if(dom && !isDescendant(self.rootContainer, dom)){
                    if(dom != document.body && $(document.body).closest(dom).length == 0){
                        self.last = dom;
                        var r = dom.getBoundingClientRect();
                        self.$cap.css("pointer-events", "none");
                        self.$cap.css("box-sizing", "border-box");
                        self.$cap.css({border: "2px solid #f00",
                            position: "absolute",
                            left: parseInt(r.left)+"px",
                            top: parseInt(r.top + window.scrollY)+"px",
                            width:r.width+"px",
                            height:r.height+"px",
                            zIndex: 2147483646});
                        self.$cap.show();
                    }else{
                        self.$cap.hide();
                        // document.body or ancestors
                    }
                }
            }
        });
    }

    isSelectionPresent() {
        var selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            return !selection.getRangeAt(0).collapsed;
        }
        return false;
    }

    deselect() {
        var selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            selection.collapseToStart();
        }
    }

    toggleDomEdit(on) {
        this.last = null;
        this.editing = on;
        this.$cap.hide();
        $(this.editBar).find("input[type=button]").prop("disabled", on);
        document.body.style.cursor = this.editing? "crosshair": "";
    }

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

    saveDoc() {
        let btn = $("#scrapyard-save-doc-button", this.shadowRoot);
        btn.addClass("flash-button");

        setTimeout(function() {
            btn.removeClass("flash-button");
        },1000);

        let doc = document.documentElement.cloneNode(true);
        let bar = doc.querySelector(".scrapyard-edit-bar-container");

        if (bar)
            bar.parentNode.removeChild(bar);

        let chars = doc.querySelector("meta[http-equiv='content-type' i]");
        if (chars) {
            chars.parentNode.removeChild(chars);
            chars.setAttribute("content", "text/html; charset=utf-8");
            doc.getElementsByTagName("head")[0].prepend(chars);
        }
        else {
            chars = doc.querySelector("meta[charset]");

            if (chars) {
                chars.parentNode.removeChild(chars);
                chars.setAttribute("charset", "utf-8");
                doc.getElementsByTagName("head")[0].prepend(chars);
            }
            else {
                chars = document.createElement("meta");
                chars.setAttribute("http-equiv", 'Content-Type');
                chars.setAttribute("content", "text/html; charset=utf-8");
                doc.getElementsByTagName("head")[0].prepend(chars);
            }
        }

        browser.runtime.sendMessage({
            type: 'UPDATE_ARCHIVE',
            id: parseInt(location.hash.split(":")[1]),
            data: "<!DOCTYPE html>" + doc.outerHTML
        }).then(() => {
            browser.runtime.sendMessage({
                type: 'GET_BOOKMARK_INFO',
                uuid: location.hash.split(":")[0].substring(1),
                id: parseInt(location.hash.split(":")[1])
            }).then(node => {
                $("#page-info", this.editBar).html(this.formatPageInfo(node))
            });
        });
    }

    buildTools() {
        const TOOLBAR_HEIGHT = 26;
        let scrapyardHideToolbar = false;


        var self = this;
        var editing = false;
        var contentEditing = false;
        var extension_id = browser.i18n.getMessage("@@extension_id");

        /** toolbar */
        var rootContainer = document.createElement("div");
        rootContainer.style.display = "none";
        rootContainer.style.position = "fixed";
        rootContainer.style.left = "0";
        rootContainer.style.right = "0";
        rootContainer.style.bottom = "0";
        rootContainer.style.zIndex = "2147483647";
        rootContainer.style.width = "100%";
        rootContainer.style.height = "42px";
        rootContainer.style.margin = "0";
        rootContainer.style.padding = "0";
        rootContainer.className = "scrapyard-edit-bar-container";
        document.body.appendChild(rootContainer);
        this.rootContainer = rootContainer;

        var editBar = document.createElement("div");
        editBar.className = "scrapyard-edit-bar";
        //editBar.setAttribute("part", "scrapyard-edit-bar");
        editBar.style.height = `${TOOLBAR_HEIGHT}px`;
        let shadow = rootContainer.attachShadow({mode: 'open'});
        this.shadowRoot = shadow;
        shadow.innerHTML = `
            <style>
                @import url('${browser.runtime.getURL("ui/edit_toobar.css")}')
            </style>
        `;

        shadow.appendChild(editBar);
        this.editBar = editBar;

        /** icon */
        var img = document.createElement("img");
        img.id = "scrapyard-icon"
        img.src = `moz-extension://${extension_id}/icons/scrapyard.svg`;
        img.setAttribute("width", "20px");
        img.setAttribute("height", "20px");
        editBar.appendChild(img);
        editBar.innerHTML += " <b id='scrapyard-brand'>Scrapyard</b>&nbsp;&nbsp;";

        /** body */
        if (!scrapyardHideToolbar)
            document.body.style.marginBottom = `${TOOLBAR_HEIGHT * 2}px !important`;

        /** save button */
        var btn = document.createElement("input");
        btn.id = "scrapyard-save-doc-button"
        btn.type = "button";
        btn.className = "yellow-button"
        btn.value = chrome.i18n.getMessage("save");
        editBar.appendChild(btn);
        btn.addEventListener("click", function () {
            self._unsavedChanges = false;
            self.saveDoc();
        });

        /** edit document button */
        var btn = document.createElement("input");
        btn.type = "button";
        btn.id = "btn-edit-document";
        btn.className = "blue-button";
        btn.style.width = "81px";
        btn.value = chrome.i18n.getMessage("MODIFY_DOM_ON");
        editBar.appendChild(btn);
        btn.addEventListener("click", function () {
            contentEditing = !contentEditing;
            this.className = contentEditing? "yellow-button": "blue-button";
            this.value = chrome.i18n.getMessage(contentEditing ? "MODIFY_DOM_OFF" : "MODIFY_DOM_ON");

            document.designMode = document.designMode === "on"? "off": "on";
        });

        $(editBar).append(`<div style="position: relative;"><i class="help-mark"></i><span class="tips hide">
                         To remove content, text-select it (including images and other media) and press Del key on keyboard.
                         It is also possible to type something in. Press F7 to turn on caret browsing.
                       </span></div>`);

        /** modify dom button */
        var btn = document.createElement("input");
        btn.type = "button";
        btn.id = "btn-dom-eraser";
        btn.className = "blue-button";
        btn.value = "DOM Eraser";
        editBar.appendChild(btn);
        btn.addEventListener("click", function () {
            editing = !editing;
            self.toggleDomEdit(editing)
            this.className = editing? "yellow-button": "blue-button";
            $(this).prop("disabled", false);
        });

        /** mark pen button */
        var btn = document.createElement("input");
        btn.type = "button";
        btn.className = "blue-button mark-pen-btn"
        btn.value = chrome.i18n.getMessage("MARK_PEN");
        editBar.appendChild(btn);
        btn.addEventListener("click", function () {
            $(self.menu).toggle();
            var rect_div = self.editBar.getBoundingClientRect();
            var rect_btn = this.getBoundingClientRect();
            $(self.menu).css("bottom", (rect_div.bottom - rect_btn.top) + "px");
            $(self.menu).css("left", rect_btn.left + "px");
        });

        /** mark pen menu */
        var $m = $("<div>").appendTo(this.editBar);
        $m.css({
            position: 'absolute',
            zIndex: 2147483646,
            border: "1px solid #999",
            background: "#fff",
            display: "none",
            boxShadow: "5px 5px 5px #888888",
            borderWidth: "1px 1px 0px 1px"
        });

        /** marker cleaner */
        var $item = $("<div>").appendTo($m).css({
            height: "14px",
            color: "#333",
            cursor: "pointer",
            borderBottom: "1px solid #999",
            padding: "8px 20px",
            verticalAlign: "middle"
        }).bind("mousedown", e => {
            e.preventDefault()
            $(self.menu).hide();
            if (self.isSelectionPresent()) {
                clearMarkPen();
                this.deselect();
            } else {
                alert("No active selection.");
            }
        });
        $(`<div class='scrapyard-menu-item'>Clear Markers</div>`).appendTo($item).css({
            height: "14px",
            lineHeight: "14px",
            minWidth: "200px"
        });

        /** markers */
        for (let child of ["scrapyard-marker-1", "scrapyard-marker-2", "scrapyard-marker-3", "scrapyard-marker-4",
            "scrapyard-marker-5", "scrapyard-marker-6", "scrapyard-marker-7", "scrapyard-marker-8"]) {
            var $item = $("<div>").appendTo($m).css({
                height: "14px",
                color: "#333",
                cursor: "pointer",
                borderBottom: "1px solid #999",
                padding: "8px 20px",
                verticalAlign: "middle"
            }).bind("mousedown", e => {
                e.preventDefault()
                $(self.menu).hide();
                if (self.isSelectionPresent()) {
                    mark(child);
                    self._unsavedChanges = true;
                    this.deselect();
                } else {
                    alert("No active selection.");
                }
            });
            $(`<div class='scrapyard-menu-item ${child}'>Example Text</div>`).appendTo($item).css({
                height: "14px",
                lineHeight: "14px",
                minWidth: "200px"
            });
        }
        this.menu = $m[0];

        /** auto-open check */
        var autoOpenCheck = document.createElement("input");
        autoOpenCheck.type = "checkbox";
        autoOpenCheck.id = "scrapyard-auto-open-check";
        autoOpenCheck.name = "auto-open-check";
        editBar.appendChild(autoOpenCheck);

        document.addEventListener('mouseup', e => {
            if (autoOpenCheck.checked && this.isSelectionPresent()) {
                $(".mark-pen-btn", self.shadowRoot).click();
            }
        });
        document.addEventListener('mousedown', e => {
            if (autoOpenCheck.checked && this.isSelectionPresent() && $(self.menu).is(":visible")
                && e.target !== self.menu) {
                $(self.menu).hide();
            }
        });

        $(editBar).append("<label for='scrapyard-auto-open-check'>Auto open</label>");


        /** notes button */
        var btn = document.createElement("input");
        btn.type = "button";
        btn.id = "view-notes";
        btn.className = "blue-button";
        btn.value = chrome.i18n.getMessage("NOTES");
        editBar.appendChild(btn);
        btn.addEventListener("click", function () {
            var ifrm = $("#notes-ifrm");
            if (ifrm.length) {
                ifrm.remove();
                $("#notes-container").remove();
                $(document.body).removeClass("scrapyard-no-overflow");
            }
            else {
                if (location.origin.startsWith("http")) {
                    browser.runtime.sendMessage({
                        type: 'BROWSE_NOTES',
                        uuid: location.hash.split(":")[0].substring(1),
                        id: parseInt(location.hash.split(":")[1])
                    });
                }
                else {
                    let notes_page = location.origin.replace(/^blob:/, "") + "/ui/notes.html?i"

                    $(document.body).prepend(`<iframe id="notes-ifrm" frameborder="0" src="${notes_page}${location.hash}"/>
                                                <div id="notes-container"></div>`)
                        .addClass("scrapyard-no-overflow");
                }
            }
        });

        window.addEventListener("message", e => {
            if (e.data === "SCRAPYARD_CLOSE_NOTES") {
                $("#notes-ifrm").remove();
                $("#notes-container").remove();
                $(document.body).removeClass("scrapyard-no-overflow");
            }
        }, false);

        $(editBar).append(`<span style="margin-left: 8px; display: inline-block; color: black;">Original URL: </span>`);

        /** the original url input */
        var originalURLText = document.createElement("input");
        originalURLText.type = "text";
        originalURLText.className = "original-url-text";
        $(originalURLText).attr("readonly", "true")
        editBar.appendChild(originalURLText);

        /** go button */
        var originalURLLink = document.createElement("a");
        $(originalURLLink).attr("target", "_blank");
        editBar.appendChild(originalURLLink);

        browser.runtime.sendMessage({
            type: 'GET_BOOKMARK_INFO',
            uuid: location.hash.split(":")[0].substring(1),
            id: parseInt(location.hash.split(":")[1])
        }).then(node => {
            originalURLText.value = node?.uri || "";
            originalURLLink.href = node?.uri || "#";
            $("#page-info", editBar).html(self.formatPageInfo(node))
        });

        var btn = document.createElement("input");
        btn.type = "button";
        btn.className = "blue-button go-button"
        btn.value = chrome.i18n.getMessage("Go");
        editBar.appendChild(btn);
        btn.addEventListener("click", e => {
            if (originalURLLink.href !== "#")
                originalURLLink.click();
        });

        /** page info */

        $(editBar).append(`<div style="position: relative;"><span class="tips hide" id="page-info"></span><i class="i-mark"></i></div>`);


        /** hide button */
        var btn = document.createElement("input");
        btn.type = "button";
        btn.className = "blue-button hide-button"
        btn.value = chrome.i18n.getMessage("Hide");
        editBar.appendChild(btn);
        btn.addEventListener("click", function () {
            $(rootContainer).hide();
            document.body.style.marginBottom = "0 !important";
        });

        $(".help-mark", editBar).hover(function(e){
            $(this).next(".tips.hide").show().css({"margin-top": "-12px", "margin-left": "5px"});
        }, function(){
            $(this).next(".tips.hide").hide();
        });

        $(".i-mark", editBar).hover(function(e){
            $(this).prev(".tips.hide").show().css({"margin-top": "-12px", "position": "absolute", "right": "100%",
                                                   "margin-right": "-14px"});
        }, function(){
            $(this).prev(".tips.hide").hide();
        });

        document.addEventListener("keydown", e => {
            if (e.code === "KeyT" && e.ctrlKey && e.altKey) {
                $(rootContainer).toggle();
                scrapyardHideToolbar = !scrapyardHideToolbar;
                document.body.style.marginBottom = scrapyardHideToolbar
                    ? "0 !important"
                    : `${TOOLBAR_HEIGHT * 2}px !important`;
            }
        });

        browser.runtime.sendMessage({
            type: 'GET_HIDE_TOOLBAR_SETTING'
        }).then(hide => {
            scrapyardHideToolbar = hide;
            if (!scrapyardHideToolbar)
                setTimeout(() => rootContainer.style.display = "block", 300);
        });
    }
}

$(document).ready(function () {
    var toolbar = new Edit_toolbar();

    $(window).on("beforeunload", e => {
        if (toolbar._unsavedChanges)
            e.preventDefault();
    })
});

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

console.log("==> edit_toolbar.js loaded")