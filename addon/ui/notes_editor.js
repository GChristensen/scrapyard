import {applyInlineStyles} from "../utils_html.js";
import {NotesToolbar} from "./notes_toolbar.js";

class Editor {
    setBlurHandler(handler) {
        this.blurHandler = handler;
    }

    setSaveHandler(handler) {
        this.saveHandler = handler;
    }

    setChangeHandler(handler) {
        this.changeHandler = handler;
    }
}

export class WYSIWYGEditor extends Editor {
    constructor(format, fontSize) {
        super();
        this.format = format;
        this.install(fontSize);
    }

    install(fontSize) {
        if (this.editor)
            return;

        $(PlainTextEditor.ELEMENT_ID).hide();
        $(WYSIWYGEditor.ELEMENT_ID).show();

        var toolbarOptions = [
            // ['showHtml'],
            [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
            [{ 'size': ['small', false, 'large', 'huge'] }],
            [{ 'font': [] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'align': [] }],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            ['blockquote', 'code-block'],
            [{ 'script': 'sub'}, { 'script': 'super' }],
            [{ 'indent': '-1'}, { 'indent': '+1' }],
            ['hr'],
            [ 'link', 'image'],
            ['clean']
        ];

        Quill.prototype.getHTML = function() {
            if (!this.isEmpty()) {
                let root = $(WYSIWYGEditor.ELEMENT_ID)[0].cloneNode(true);
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

        this.editor = new Quill(WYSIWYGEditor.ELEMENT_ID, {
            modules: {
                clipboard: {
                    matchVisual: false
                },
                toolbar: {
                    container: toolbarOptions,
                    handlers: {
                        // showHtml: () => {
                        //     if ($(quill.txtArea).is(":visible")) {
                        //         this.editor.setHTML(this.editor.txtArea.value);
                        //         $(".ql-toolbar .ql-formats").slice(1).toggle();
                        //     }
                        //     else {
                        //         this.editor.txtArea.value = this.editor.getHTML(true);
                        //         $(".ql-toolbar .ql-formats").slice(1).toggle();
                        //     }
                        //
                        //     $(this.editor.txtArea).toggle();
                        // },
                        hr: () => {
                            let range = this.editor.getSelection();
                            if (range) {
                                this.editor.insertEmbed(range.index, "hr", "null")
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
                            handler: (range, context) => {
                                this.saveHandler();
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

        // text area for source viewing
        // this.editor.txtArea = document.createElement("textarea");
        // this.editor.txtArea.className = "quill-html-editor";
        // document.querySelector(WYSIWYGEditor.ELEMENT_ID).appendChild(this.editor.txtArea);

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

        this.editor.on('selection-change', (range, oldRange, source) => {
            if (range === null && oldRange !== null)
                this.blurHandler();
        });

        this.editor.on('text-change', (delta, oldDelta, source) => {
            this.changeHandler();
        });

        $(".ql-container").css("font-size", fontSize + "%");
    }

    uninstall() {
        if($(WYSIWYGEditor.ELEMENT_ID)[0]) {
            const editor = $(WYSIWYGEditor.ELEMENT_ID);
            let content = editor.find('.ql-editor').html();
            editor.html(content);

            editor.siblings('.ql-toolbar').remove();
            $(`${WYSIWYGEditor.ELEMENT_ID} *[class*='ql-']`).removeClass(function (index, css) {
                return (css.match (/(^|\s)ql-\S+/g) || []).join(' ');
            });

            $(`${WYSIWYGEditor.ELEMENT_ID}[class*='ql-']`).removeClass(function (index, css) {
                return (css.match (/(^|\s)ql-\S+/g) || []).join(' ');
            });

            editor.empty();
        }

        this.editor = null;

        $(WYSIWYGEditor.ELEMENT_ID).hide();
        $(PlainTextEditor.ELEMENT_ID).show();
    }

    isEmpty() {
        return this.editor.isEmpty();
    }

    setContent(content) {
        if (content) {
            if (this.format === "html")
                this.editor.setHTML(content);
            else if (this.format === "delta")
                this.editor.setContents(JSON.parse(content));
        }
    }

    getContent() {
        if (this.editor.isEmpty())
            return "";
        return JSON.stringify(this.editor.getContents());
    }

    renderContent() {
        return this.editor.getHTML();
    }

    focus() {
        this.editor.focus();
    }
}

WYSIWYGEditor.ELEMENT_ID = "#wysiwyg-editor";

export class PlainTextEditor extends Editor {
    constructor(format) {
        super();
        this.format = format;
        this.install();
    }

    install() {
        $(WYSIWYGEditor.ELEMENT_ID).hide();
        $(PlainTextEditor.ELEMENT_ID).show();

        if (this.format === "markdown" || this.format === "org")
            this.toolbar = new NotesToolbar(this.format);
    }

    uninstall() {
        if (this.toolbar) {
            this.toolbar.uninstall();
            this.toolbar = null;
        }
        $(WYSIWYGEditor.ELEMENT_ID).show();
        $(PlainTextEditor.ELEMENT_ID).hide();
    }

    isEmpty() {
        return !!this.getContent();
    }

    setContent(content) {
        const editor = $(PlainTextEditor.ELEMENT_ID);
        editor.val(content);
        editor[0].setSelectionRange(0, 0);
    }

    getContent() {
        return $(PlainTextEditor.ELEMENT_ID).val();
    }

    renderContent() {
        return this.getContent();
    }

    setSaveHandler(handler) {
        super.setSaveHandler(handler);

        // the namespace keeps the handlers of the recreated editors from accumulating
        $("#editor").off("keydown.save").on("keydown.save", e => {
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
                e.preventDefault();
                handler();
            }
        });
    }

    setBlurHandler(handler) {
        $("#editor").on("blur", handler);
    }

    setChangeHandler(handler) {
        $("#editor").on("input", handler);
    }

    focus() {
        $("#editor")[0].focus();
    }
}

PlainTextEditor.ELEMENT_ID = "#editor"
