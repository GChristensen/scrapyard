import {send} from "../proxy.js";
import {bookmarkManager} from "../backend.js"
import * as org from "../lib/org/org.js"
import {NODE_TYPE_NOTES} from "../storage.js";
import {markdown2html, org2html, text2html} from "../notes_render.js";
import {applyInlineStyles} from "../utils_html.js";

const ORG_EXAMPLE = `#+OPTIONS: toc:t num:nil
#+CSS: p {text-align: justify;}

Supported [[http://orgmode.org/][org-mode]] markup features:

* Top Level Heading
** Second Level Heading
*** Third Level Heading

# A comment line. This line will not be displayed.

Paragraphs are separated by at least one empty line.


*** Formatting

*bold*
/italic/
_underlined_
+strikethrough+
=monospaced=
and ~code~

Sub_{script}. a_{1}, a_{2}, and a_{3}.

A horizontal line, fill-width across the page:
-----


*** Links

[[http://orgmode.org][Link with a description]]

http://orgmode.org - link without a description.

*** Lists
- First item in a list.
- Second item.
  - Sub-item
    1. Numbered item.
    2. Another item.
- [ ] Item yet to be done.
- [X] Item that has been done.


*** Definition List

- vim :: Vi IMproved, a programmers text editor
- ed :: Line-oriented text editor


*** TODO

**** TODO A todo item.
**** DONE A todo item that has been done.


*** Directives

**** ~BEGIN_QUOTE~ and ~END_QUOTE~

#+BEGIN_QUOTE
To be or not to be, that is the question.
#+END_QUOTE

**** ~BEGIN_EXAMPLE~ and ~END_EXAMPLE~

#+BEGIN_EXAMPLE
let o = new Object();
o.attr = "string";
#+END_EXAMPLE

**** ~BEGIN_SRC~ and ~END_SRC~

#+BEGIN_SRC javascript
let o = new Object();
o.attr = "string";
#+END_SRC


*** Verbatim text

: Text to be displayed verbatim (as-is), without markup
: (*bold* does not change font), e.g., for source code.
: Line breaks are respected.


*** Table

|-------+--------+------------|
|       | Symbol | Author     |
|-------+--------+------------|
| Emacs | ~M-x~  | _RMS_      |
|-------+--------+------------|
| Vi    | ~:~    | _Bill Joy_ |
|-------+--------+------------|

*** Images

Referenced image:

[[https://upload.wikimedia.org/wikipedia/commons/6/60/Cat_silhouette.svg][Cat silhouette]]

From data URL:

[[data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoBAMAAAB+0KVeAAAAMHRFWHRDcmVhdGlvbiBUaW1lANCf0L0gMTUg0LDQv9GAIDIwMTkgMTU6MzA6MzMgKzA0MDAnkrt2AAAAB3RJTUUH4wQPCx8oBV08nwAAAAlwSFlzAAALEgAACxIB0t1+/AAAAARnQU1BAACxjwv8YQUAAAAwUExURf///7W1tWJiYtLS0oODg6CgoPf39wAAACkpKefn597e3j09Pe/v7xQUFAgICMHBwUxnnB8AAACdSURBVHjaY2AYpoArAUNEjeFsALogZ1HIdgxBhufl5QIYgtexCZaXl2Nqb8em0r28/P5KLCrLy2/H22TaIMQYy+FgK1yQBSFYrgDki6ILFgH9uwUkyIQkWP5axeUJyOvq5ajgFgNDsh6qUFF8AoPs87om16B95eWblJTKy6uF+sonMDCYuJoBjQiviASSSq4LGBi8D8BcJYTpzREKABwGR4NYnai5AAAAAElFTkSuQmCC][Cat silhouette]]
`;

const ORG_DEFAULT_STYLE = `#+CSS: p {text-align: justify;}`;

const MD_EXAMPLE = `[//]: # (p {text-align: justify;})

Supported [Markdown](https://daringfireball.net/projects/markdown/syntax#link) markup features:

# Top Level Heading
## Second Level Heading
### Third Level Heading

[//]: # (A comment line. This line will not be displayed.)

Paragraphs are separated by at least one empty line.


### Formatting

**bold** __text__
*italic* _text_
~~strikethrough~~
and \`monospaced\`

A horizontal line, fill-width across the page:

-----


### Links

[Link with a description](http://orgmode.org)

http://orgmode.org - link without a description.

### Lists
- First item in a list.
- Second item.
* Third item.
  + Sub-item
    1. Numbered item.
    2. Another item.
    1. Third item.


### Code

Inline \`code\`

Indented code

    // Some comments
    line 1 of code
    line 2 of code
    line 3 of code


Block code "fences"

\`\`\`
To be or not to be, that is the question.
\`\`\`


### Blockquotes

> Blockquotes can also be nested...
>> ...by using additional greater-than signs right next to each other...
> > > ...or with spaces between arrows.

### Table

|       | Symbol | Author     |
|-------|--------|------------|
| Emacs | ~M-x~  | _RMS_      |
| Vi    | ~:~    | _Bill Joy_ |


### Images

Referenced image:

![Cat silhouette](https://upload.wikimedia.org/wikipedia/commons/6/60/Cat_silhouette.svg)

From data URL:

![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoBAMAAAB+0KVeAAAAMHRFWHRDcmVhdGlvbiBUaW1lANCf0L0gMTUg0LDQv9GAIDIwMTkgMTU6MzA6MzMgKzA0MDAnkrt2AAAAB3RJTUUH4wQPCx8oBV08nwAAAAlwSFlzAAALEgAACxIB0t1+/AAAAARnQU1BAACxjwv8YQUAAAAwUExURf///7W1tWJiYtLS0oODg6CgoPf39wAAACkpKefn597e3j09Pe/v7xQUFAgICMHBwUxnnB8AAACdSURBVHjaY2AYpoArAUNEjeFsALogZ1HIdgxBhufl5QIYgtexCZaXl2Nqb8em0r28/P5KLCrLy2/H22TaIMQYy+FgK1yQBSFYrgDki6ILFgH9uwUkyIQkWP5axeUJyOvq5ajgFgNDsh6qUFF8AoPs87om16B95eWblJTKy6uF+sonMDCYuJoBjQiviASSSq4LGBi8D8BcJYTpzREKABwGR4NYnai5AAAAAElFTkSuQmCC)
`;

const MD_DEFAULT_STYLE = `[//]: # (p {text-align: justify;})`;

const INPUT_TIMEOUT = 3000;
const DEFAULT_WIDTH = "790px";
const DEFAULT_FONT_SIZE = 120;

const examples = {"org": ORG_EXAMPLE, "markdown": MD_EXAMPLE};
const styles = {"org": ORG_DEFAULT_STYLE, "markdown": MD_DEFAULT_STYLE};

const NODE_ID = parseInt(location.hash?.split(":")?.pop());

let format = "delta";
let align;
let width;

let quill;

let editorChanged;
let editorTimeout;

function saveNotes() {
    let options = {node_id: NODE_ID, content: getEditorContent(), format, align, width};
    if (format === "delta")
        options.html = renderEditorContent();

    send.storeNotes({options});
    send.notesChanged({node_id: NODE_ID, removed: !options.content});
    editorChanged = false;
}

function editorSaveOnChange(e) {
    clearTimeout(editorTimeout);

    editorTimeout = setTimeout(() => {
        if (e && NODE_ID) {
            saveNotes();
        }
    }, INPUT_TIMEOUT);
}

function editorSaveOnBlur(e) {
    if (e && NODE_ID) {
        clearTimeout(editorTimeout);
        saveNotes();
    }
}

function initWYSIWYGEditor() {

    if (quill)
        return;

    $("#editor").hide();
    $("#quill").show();

    var toolbarOptions = [
       // ['showHtml'],
        [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
        [{ 'size': ['small', false, 'large', 'huge'] }],
        [{ 'font': [] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'align': [] }],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        ['blockquote', 'code'],
        [{ 'script': 'sub'}, { 'script': 'super' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        ['hr'],
        [ 'link', 'image'],
        ['clean']
    ];

    Quill.prototype.getHTML = function() {
        if (!this.isEmpty()) {
            let root = $("#quill")[0].cloneNode(true);
            applyInlineStyles(root, true, ["org.css"]);

            return root.firstChild.innerHTML;
        }

        return "";
    };

    Quill.prototype.setHTML = function(html) {
        this.pasteHTML(html);
    };

    Quill.prototype.isEmpty = function() {
        if (JSON.stringify(this.getContents()) === "\{\"ops\":[\{\"insert\":\"\\n\"\}]\}")
            return true;
    };


    var Parchment = Quill.import('parchment');

    var LineBreakClass = new Parchment.Attributor.Class('linebreak', 'linebreak', {
        scope: Parchment.Scope.BLOCK
    });

    Quill.register('formats/linebreak', LineBreakClass);


    quill = new Quill('#quill', {
        modules: {
            clipboard: {
                matchVisual: false
            },
            toolbar: {
                container: toolbarOptions,
                handlers: {
                    // showHtml: () => {
                    //     if ($(quill.txtArea).is(":visible")) {
                    //         quill.setHTML(quill.txtArea.value);
                    //         $(".ql-toolbar .ql-formats").slice(1).toggle();
                    //     }
                    //     else {
                    //         quill.txtArea.value = quill.getHTML(true);
                    //         $(".ql-toolbar .ql-formats").slice(1).toggle();
                    //     }
                    //
                    //     $(quill.txtArea).toggle();
                    // },
                    hr: () => {
                        let range = quill.getSelection();
                        if (range) {
                            quill.insertEmbed(range.index, "hr", "null")
                        }
                    }
                }
            },
            // history: {
            //     delay: 2000,
            //     maxStack: 100,
            //     userOnly: true
            // },
            keyboard: {
                bindings: {
                    _save: {
                        key: 'S',
                        shortKey: true,
                        handler: function (range, context) {
                            saveNotes();
                        }
                    },
                    smartbreak: {
                        key: 13,
                        shiftKey: true,
                        handler: function (range, context) {
                            this.quill.setSelection(range.index,'silent');
                            this.quill.insertText(range.index, '\n', 'user')
                            this.quill.setSelection(range.index + 1,'silent');
                            this.quill.format('linebreak', true, 'user');
                        }
                    },
                    paragraph: {
                        key: 13,
                        handler: function (range, context) {
                            this.quill.setSelection(range.index, 'silent');
                            this.quill.insertText(range.index, '\n', 'user')
                            this.quill.setSelection(range.index + 1, 'silent');
                            let f = this.quill.getFormat(range.index + 1);
                            if (f.hasOwnProperty('linebreak')) {
                                delete (f.linebreak)
                                this.quill.removeFormat(range.index + 1)
                                for (let key in f) {
                                    this.quill.formatText(range.index + 1, key, f[key])
                                }
                            }
                        }
                    },
                    justifiedTextSpacebarFixForFirefox: {
                        key: ' ',
                        format: {'align': 'justify'},
                        suffix: /^$/,
                        handler: function (range, context) {
                            this.quill.insertText(range.index, ' ', 'user');
                            return true;
                        }
                    }
                }
            }
        },
        theme: 'snow'
    });

    // quill.txtArea = document.createElement("textarea");
    // quill.txtArea.className = "quill-html-editor";
    // document.getElementById("quill").appendChild(quill.txtArea);

    let Link = window.Quill.import('formats/link');
    class ScrapyardLink extends Link {
        static sanitize(url) {
            if(url.startsWith("ext+scrapyard")) {
                return url
            }
            else {
                return super.sanitize(url);
            }
        }
    }
    Quill.register(ScrapyardLink);

    let Embed = Quill.import('blots/block/embed');
    class Hr extends Embed {
        static create(value) {
            let node = super.create(value);
            node.setAttribute('style', "height:0px; margin-top:10px; margin-bottom:10px;");
            return node;
        }
    }
    Hr.blotName = 'hr';
    Hr.tagName = 'hr';
    Quill.register({'formats/hr': Hr});

    quill.on('selection-change', function(range, oldRange, source) {
        if (range === null && oldRange !== null)
            editorSaveOnBlur(true);
    });

    quill.on('text-change', function(delta, oldDelta, source) {
        editorChanged = true;
        editorSaveOnChange(true);
    });

    let fontSize = parseInt(localStorage.getItem("editor-font-size") || DEFAULT_FONT_SIZE);
    $(".ql-container").css("font-size", fontSize + "%");

    window.onbeforeunload = function() {
        if (editorChanged)
            return true;
    };
}

function closeWYSIWYGEditor() {
    let editor = '#quill';

    if($(editor)[0]) {
        var content = $(editor).find('.ql-editor').html();
        $(editor).html(content);

        $(editor).siblings('.ql-toolbar').remove();
        $(editor + " *[class*='ql-']").removeClass (function (index, css) {
            return (css.match (/(^|\s)ql-\S+/g) || []).join(' ');
        });

        $(editor + "[class*='ql-']").removeClass (function (index, css) {
            return (css.match (/(^|\s)ql-\S+/g) || []).join(' ');
        });

        $(editor).empty();
    }

    quill = null;

    $("#quill").hide();
    $("#editor").show();
}

function initMarkupEditor() {
    $("#quill").hide();
    $("#editor").show();
}

function closeMarkupEditor() {
    $("#quill").show();
    $("#editor").hide();
}

function renderEditorContent() {
    if (format === "delta")
        return quill.getHTML();
    else
        return $('#editor').val();
}

function getEditorContent() {
    if (format === "delta") {
        if (quill.isEmpty())
            return "";
        return JSON.stringify(quill.getContents());
    }
    else
        return $('#editor').val();
}

function setEditorContent(content) {
    if (content) {
        if (format === "html")
            quill.setHTML(content);
        else if (format === "delta")
            quill.setContents(JSON.parse(content));
        else
            $('#editor').val(content);
    }
}

window.onload = async function() {
    await bookmarkManager;

    const isInline = location.search.startsWith("?i");

    if (isInline)
        $("#tabbar").html(`<a id="notes-button" class="focus" href="#">Notes</a>
                                 <a id="edit-button" href="#">Edit</a>`);
    else
        $("#tabbar").html(`<div style="margin-left: 20px;">
                                    <span id="notes-for">Notes for: </span>
                                    <span id="source-url" class="source-url"></a>
                                 </div>
                                 <div class="spacer">&nbsp;</div>
                                 <a id="notes-button" class="focus" href="#">View</a>
                                 <a id="edit-button" href="#">Edit</a>`);


    bookmarkManager.getNode(NODE_ID).then(n => {
        let node = n;
        let source_url = $("#source-url");
        source_url.text(node.name);

        if (node.type === NODE_TYPE_NOTES) {
            source_url.removeClass("source-url");
            source_url.addClass("notes-title");
            $("title").text(node.name);
        }
        else {
            $("title").text("Notes for: " + node.name);
            $("#notes-for").show();
        }

        if (node.type !== NODE_TYPE_NOTES)
            source_url.on("click", e => {
                send.browseNode({node: node});
            });
    });

    function formatNotes(text, format) {
        switch (format) {
            case "org":
                $("#notes").attr("class", "notes format-org").html(org2html(text));
                break;
            case "markdown":
                $("#notes").attr("class", "notes format-markdown").html(markdown2html(text));
                break;
            case "html":
            case "delta":
                $("#notes").attr("class", "notes format-html").html(text);
                break;
            default:
                $("#notes").attr("class", "notes format-text").html(text2html(text));;
        }
    }

    function alignNotes() {
        switch (align) {
            case "left":
                $("#space-left").css("flex", "0");
                break;
            case "right":
                $("#space-right").css("flex", "0");
                break;
            default:
                $("#space-left").css("flex", "1");
                $("#space-right").css("flex", "1");
        }

    }

    $("#notes").on("click", "a[href^='org-protocol://']", e => {
        e.preventDefault();
        send.browseOrgReference({link: e.target.href});
    });

    $("#tabbar a").on("click", e => {
        e.preventDefault();

        $("#tabbar a").removeClass("focus");
        $(e.target).addClass("focus");

        $(`.content`).hide();
        $(`#content-${e.target.id}`).css("display", "flex");

        if (e.target.id === "notes-button") {
            let content = renderEditorContent();
            formatNotes(content, format);

            $("#format-selector").hide();
            $("#align-selector").show();
        }
        else if (e.target.id === "edit-button") {
            $("#format-selector").show();
            $("#align-selector").hide();
        }
    });

    if (NODE_ID)
        bookmarkManager.fetchNotes(NODE_ID).then(notes => {
            if (notes) {
                format = notes.format || "org";
                $("#notes-format").val(format === "html"? "delta": format);

                if (format === "html" || format === "delta")
                    initWYSIWYGEditor();
                else
                    initMarkupEditor();

                setEditorContent(notes.content);

                let content;
                if (format === "delta")
                    content = renderEditorContent();
                else
                    content = notes.content;
                formatNotes(content, format);

                if (format === "html")
                    format = "delta";

                align = notes.align;
                if (align)
                    $("#notes-align").val(align);
                alignNotes();

                width = notes.width;
                if (width) {
                    //$("#notes").css("width", width);

                    let selected;
                    $("#notes-width option").each(function() {
                        if (width === this.textContent)
                            selected = this.value;
                    });

                    if (selected) {
                        $("#notes-width").val(selected);
                        $("#notes").css("width", width);
                    }
                    else {
                        let actualWidthElt = $("#notes-width option[value='actual']");
                        actualWidthElt.show();
                        actualWidthElt.text(width);
                        $("#notes-width").val("actual");
                        $("#notes").css("width", width);
                    }
                }

                if (format !== "delta" && format !== "text")
                    $("#inserts").show();
                else
                    $("#inserts").hide();
            }
            else {
                initWYSIWYGEditor();
            }

        }).catch(e => {
            console.error(e)
        });

    $("#editor").on("input", editorSaveOnChange);
    $("#editor").on("blur", editorSaveOnBlur);

    $("#insert-example").on("click", e => {
        let edit = jQuery("#editor");
        let caretPos = edit[0].selectionStart;
        let textAreaText = edit.val();

        edit.val(textAreaText.substring(0, caretPos) + examples[format] + textAreaText.substring(caretPos));
        edit.trigger("input");
    });

    $("#insert-style").on("click", e => {
        let edit = jQuery("#editor");
        let caretPos = edit[0].selectionStart;
        let textAreaText = edit.val();

        edit.val(textAreaText.substring(0, caretPos) + styles[format] + textAreaText.substring(caretPos));
        edit.trigger("input");
    });

    $("#notes-format").on("change", e => {
        // old format
        if (format === "delta") {
            if (!quill.isEmpty())
                $("#editor").val(JSON.stringify(quill.getContents()));
        }

        format = $("#notes-format").val();

        // new format
        if (format === "delta") {
            initWYSIWYGEditor();
            quill.setContents(JSON.parse($("#editor").val()));
        }
        else {
            closeWYSIWYGEditor();
        }

        if (format !== "delta" && format !== "text") {
            $("#inserts").show();
            $("#editor-font-sizes").hide();
        }
        else {
            $("#inserts").hide();
            if (format === "delta")
                $("#editor-font-sizes").show();
        }

        send.storeNotes({options: {node_id: NODE_ID, format}});
    });

    $("#notes-align").on("change", e => {
        align = $("#notes-align").val();
        alignNotes();
        send.storeNotes({options: {node_id: NODE_ID, align}});
    });

    $("#notes-width").on("change", e => {
        let selectedWidth = $("#notes-width option:selected").text();
        switch ($("#notes-width").val()) {
            case "custom":
                let customWidth = prompt("Custom width: ", "650px");
                if (customWidth) {
                    if (/^\d+$/.test(customWidth))
                        customWidth = customWidth + "px";

                    let actualWidthElt = $("#notes-width option[value='actual']");
                    actualWidthElt.show();
                    actualWidthElt.text(customWidth);
                    width = customWidth;
                    $("#notes-width").val("actual");
                    $("#notes").css("width", width);
                }
                break;
            case "default":
                $("#notes").css("width", DEFAULT_WIDTH);
                width = null;
                break;
            default:
                $("#notes").css("width", selectedWidth);
                width = selectedWidth;
        }

        send.storeNotes({options: {node_id: NODE_ID, width}});
    });

    function changeWidth(op) {
        let newWidth;
        let selectedWidth = $("#notes-width option:selected").text();
        let actualWidthElt = $("#notes-width option[value='actual']");
        let match = /(\d+)(.*)/.exec(selectedWidth);

        let [_, value, units] = (match || [null, "inc"? "800": "700", "px"]);

        const step = units === "%"? 10: 50;
        newWidth = parseInt(value);
        newWidth = op === "inc"? newWidth + step: newWidth - step;
        let pass = units === "%"? newWidth >= 10 && newWidth <= 100: newWidth >= 100 && newWidth <= 4000;

        if (pass) {
            width = newWidth = newWidth + units;
            actualWidthElt.text(newWidth);
            actualWidthElt.show();
            $("#notes-width").val("actual");
            $("#notes").css("width", newWidth);
            send.storeNotes({options: {node_id: NODE_ID, width: newWidth}});
        }
    }

    $("#decrease-width").on("click", e => changeWidth("dec"));
    $("#increase-width").on("click", e => changeWidth("inc"));

    let changeFontSize = (setting, target, op) => {
        let size = parseInt(localStorage.getItem(setting) || DEFAULT_FONT_SIZE);
        size = op(size, 5);
        localStorage.setItem(setting, size);
        $(target).css("font-size", size + "%");
    }

    $("#font-size-larger").on("click", e => {
        changeFontSize("notes-font-size", "#notes", (a, b) => a + b);
    });

    $("#font-size-smaller").on("click", e => {
        changeFontSize("notes-font-size", "#notes", (a, b) => a - b);
    });

    $("#font-size-default").on("click", e => {
        localStorage.setItem("notes-font-size", DEFAULT_FONT_SIZE);
        $("#notes").css("font-size", DEFAULT_FONT_SIZE + "%");
    });

    $("#editor-font-size-larger").on("click", e => {
        changeFontSize("editor-font-size", ".ql-container", (a, b) => a + b);
    });

    $("#editor-font-size-smaller").on("click", e => {
        changeFontSize("editor-font-size", ".ql-container", (a, b) => a - b);
    });

    $("#editor-font-size-default").on("click", e => {
        localStorage.setItem("editor-font-size", DEFAULT_FONT_SIZE);
        $(".ql-container").css("font-size", DEFAULT_FONT_SIZE + "%");
    });

    let fontSize = parseInt(localStorage.getItem("notes-font-size") || DEFAULT_FONT_SIZE);
    $("#notes").css("font-size", fontSize + "%");

    $("#close-button").on("click", e => {
       if (window.parent) {
           window.parent.postMessage("SCRAPYARD_CLOSE_NOTES");
       }
    });

    if (isInline) {
        $("#close-button").show();
    }

};
