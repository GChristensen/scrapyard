import {fetchText} from "../utils_io.js";
import {send} from "../proxy.js";
import * as org from "../lib/org/org.js"
import {NODE_TYPE_NOTES} from "../storage.js";
import {markdown2html, notes2html, org2html, text2html} from "../notes_render.js";
import {systemInitialization} from "../bookmarks_init.js";
import {Node, Notes} from "../storage_entities.js";
import {PlainTextEditor, WYSIWYGEditor} from "./notes_editor.js";

const INPUT_TIMEOUT = 3000;
const SAVE_RETRY_TIMEOUT = 10000;
const DEFAULT_WIDTH = "790px";
const DEFAULT_FONT_SIZE = 115;

let examples;
const styles = {"org": `#+CSS: p {text-align: justify;}`,
                "markdown": `[//]: # (p {text-align: justify;})`};

let NODE_ID;

let format = "delta";
let align;
let width;

let editor;
let editorChanged;
let editorTimeout;
// notes could not be fetched, editing is disabled to not overwrite the stored notes
let loadFailed = false;
let saveSequence = 0;

$(init);

async function init() {
    await systemInitialization;

    const isInline = location.search.startsWith("?i");
    const isEditMode = location.search.startsWith("?edit");

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

    let node;

    try {
        const uuid = location.hash.substring(1);
        node = await Node.getByUUID(uuid);
        const sourceURL = $("#source-url");
        sourceURL.text(node.name);

        NODE_ID = node.id;

        if (node.type === NODE_TYPE_NOTES) {
            sourceURL.removeClass("source-url");
            sourceURL.addClass("notes-title");
            $("title").text(node.name);
        }
        else {
            $("title").text("Notes for: " + node.name);
            $("#notes-for").show();
        }

        if (node.type !== NODE_TYPE_NOTES)
            sourceURL.on("click", e => {
                send.browseNode({node: node});
            });

        let notes;

        try {
            notes = await Notes.get(node);
        }
        catch (e) {
            console.error(e);
            loadFailed = true;
            showNotesError(`Can not load notes: ${sentence(e.message)} Editing is disabled to protect the stored notes, `
                + `reload the page to try again.`);
            $("#edit-button").hide();
            $("#bottomline").hide();
        }

        if (notes) {
            format = notes.format || "org";
            $("#notes-format").val(format === "html"? "delta": format);
            if (notes.__file_as_notes)
                $("#notes-format").prop("disabled", true);

            editor = createEditor(format);
            editor.setContent(notes.content);
            formatNotes(editor.renderContent(), format, notes);

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
        else if (!loadFailed) {
            editor = createEditor();
        }
    }
    catch (e) {
        console.error(e)
    }

    $("#tabbar a").on("click", e => {
        e.preventDefault();

        if (!editor)
            return;

        $("#tabbar a").removeClass("focus");
        $(e.target).addClass("focus");

        $(`.content`).hide();
        $(`#${e.target.id}-content`).css("display", "flex");

        if (e.target.id === "notes-button") {
            formatNotes(editor.renderContent(), format);
            $("#format-selector").hide();
            $("#align-selector").show();
        }
        else if (e.target.id === "edit-button") {
            $("#format-selector").show();
            $("#align-selector").hide();
            editor.focus();
        }
    });

    $("#insert-example").on("click", async e => {
        let edit = jQuery("#editor");
        let caretPos = edit[0].selectionStart;
        let textAreaText = edit.val();

        await initExamples();

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
        if (format === "delta" && !editor.isEmpty())
            $("#editor").val(editor.getContent());

        format = $("#notes-format").val();

        editor.uninstall();
        editor = createEditor(format);

        // new format
        if (format === "delta")
            editor.setContent($("#editor").val());

        if (format !== "delta" && format !== "text") {
            $("#inserts").show();
            $("#editor-font-sizes").hide();
        }
        else {
            $("#inserts").hide();
            if (format === "delta")
                $("#editor-font-sizes").show();
        }

        storeNotesProperties({format});
    });

    $("#notes-align").on("change", e => {
        align = $("#notes-align").val();
        alignNotes();
        storeNotesProperties({align});
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

        storeNotesProperties({width});
    });

    $("#decrease-width").on("click", e => changeWidth("dec"));
    $("#increase-width").on("click", e => changeWidth("inc"));

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

    $("#close-button").on("click", async e => {
        // the pending changes are saved before the frame is removed; the notes are left open
        // if the save has failed, so the error is visible and the save is retried
        if (editorChanged) {
            clearTimeout(editorTimeout);
            await saveNotes();

            if (editorChanged)
                return;
        }

        if (window.parent)
            window.parent.postMessage("SCRAPYARD_CLOSE_NOTES");
    });

    if (isInline) {
        $("#close-button").show();
    }

    $("#notes")
        .on("click", "a[href^='org-protocol://']", e => {
            e.preventDefault();
            send.browseOrgReference({link: e.target.href, node});
        })
        .on("click", "a[href^='file://'], a[href^='wiki:'], a[href^='wiki-asset-sys:']", e => {
            e.preventDefault();
            send.browseOrgWikiReference({link: e.target.href, node});
        });

    if (isEditMode)
        $("#tabbar a#edit-button").click();
}

// an already open notes tab is focused instead of being reopened, see browseNotes in browse.js
browser.runtime.onMessage.addListener(message => {
    if (message?.type === "SCRAPYARD_NOTES_EDIT" && !location.search.startsWith("?i"))
        $("#tabbar a#edit-button").click();
});

window.onbeforeunload = function() {
    if (editorChanged)
        return true;
};

// The inline notes frame is removed from the archive page without onbeforeunload, e.g., by the toolbar button,
// and the rich text editor does not report the loss of focus when a button is clicked, so the changes made
// within the input timeout would be lost. The save message is sent synchronously and is delivered
// to the background even though the page is unloaded.
window.addEventListener("pagehide", () => {
    if (editorChanged) {
        clearTimeout(editorTimeout);
        saveNotes();
    }
});

function createEditor(format = "delta") {
    let editor;

    if (format === "html" || format === "delta") {
        const fontSize = parseInt(localStorage.getItem("editor-font-size") || DEFAULT_FONT_SIZE);
        editor = new WYSIWYGEditor(format, fontSize);
    }
    else
        editor = new PlainTextEditor(format);

    editor.setChangeHandler(() => {
        editorChanged = true;
        editorSaveOnChange(true);
    })
    editor.setBlurHandler(() => editorSaveOnBlur(true));
    editor.setSaveHandler(() => saveNotes());

    return editor;
}

async function initExamples() {
    if (!examples) {
        examples = {"org": await fetchText("notes_example_org.txt"),
                    "markdown": await fetchText("notes_example_md.txt")};
    }
}

async function saveNotes() {
    if (loadFailed || !editor)
        return;

    const sequence = ++saveSequence;
    let options = {node_id: NODE_ID, format, align, width};

    options.content = editor.getContent();

    if (options.content && format === "delta")
        options.html = editor.renderContent();

    options.html = notes2html(options);

    // changes made while saving set the flag again
    editorChanged = false;

    try {
        await send.storeNotes({options});

        if (sequence === saveSequence)
            hideNotesError();

        send.notesChanged({node_id: NODE_ID, removed: !options.content});
    }
    catch (e) {
        console.error(e);

        // only the outcome of the latest save matters, it contains all changes
        if (sequence === saveSequence) {
            editorChanged = true;
            showNotesError(`Notes are not saved: ${sentence(e.message)} Saving will be retried.`);
            retrySaveNotes();
        }
    }
}

function retrySaveNotes() {
    clearTimeout(editorTimeout);

    editorTimeout = setTimeout(() => {
        if (editorChanged)
            saveNotes();
    }, SAVE_RETRY_TIMEOUT);
}

function storeNotesProperties(properties) {
    if (loadFailed)
        return;

    send.storeNotes({options: {node_id: NODE_ID, ...properties}, property_change: true})
        .catch(e => {
            console.error(e);
            showNotesError(`Notes settings are not saved: ${e.message}`);
        });
}

function sentence(message) {
    message = String(message || "unknown error").trim();
    return /[.!?]$/.test(message)? message: message + ".";
}

function showNotesError(message) {
    $("#notes-error").text(message).show();
}

function hideNotesError() {
    $("#notes-error").hide().text("");
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
    if (e && NODE_ID && editorChanged) {
        clearTimeout(editorTimeout);
        saveNotes();
    }
}

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
            $("#notes").attr("class", "notes format-text").html(text2html(text));
    }
}

function alignNotes() {
    switch (align) {
        case "left":
            $("#space-left").css("flex", "0");
            $("#space-right").css("flex", "1");
            break;
        case "right":
            $("#space-right").css("flex", "0");
            $("#space-left").css("flex", "1");
            break;
        default:
            $("#space-left").css("flex", "1");
            $("#space-right").css("flex", "1");
    }
}

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
        storeNotesProperties({width: newWidth});
    }
}

function changeFontSize(setting, target, op) {
    let size = parseInt(localStorage.getItem(setting) || DEFAULT_FONT_SIZE);
    size = op(size, 5);
    localStorage.setItem(setting, size);
    $(target).css("font-size", size + "%");
}
