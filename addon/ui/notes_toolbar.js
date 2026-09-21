// Markup formatting toolbar for markdown and org-mode editors.
// Renders a toolbar visually identical to the Quill "snow" toolbar by reusing its CSS classes.

// ---------------------------------------------------------
// SVG icons – taken directly from Quill 1.3.7 (same viewBox, same ql-stroke / ql-fill classes)
// ---------------------------------------------------------

const ICONS = {
    bold:
        `<svg viewbox="0 0 18 18"> <path class=ql-stroke d=M5,4H9.5A2.5,2.5,0,0,1,12,6.5v0A2.5,2.5,0,0,1,9.5,9H5A0,0,0,0,1,5,9V4A0,0,0,0,1,5,4Z></path> <path class=ql-stroke d=M5,9h5.5A2.5,2.5,0,0,1,13,11.5v0A2.5,2.5,0,0,1,10.5,14H5a0,0,0,0,1,0,0V9A0,0,0,0,1,5,9Z></path> </svg>`,

    italic:
        `<svg viewbox="0 0 18 18"> <line class=ql-stroke x1=7 x2=13 y1=4 y2=4></line> <line class=ql-stroke x1=5 x2=11 y1=14 y2=14></line> <line class=ql-stroke x1=8 x2=10 y1=14 y2=4></line> </svg>`,

    underline:
        `<svg viewbox="0 0 18 18"> <path class=ql-stroke d=M5,3V9a4.012,4.012,0,0,0,4,4H9a4.012,4.012,0,0,0,4-4V3></path> <rect class=ql-fill height=1 rx=0.5 ry=0.5 width=12 x=3 y=15></rect> </svg>`,

    strike:
        `<svg viewbox="0 0 18 18"> <line class="ql-stroke ql-thin" x1=15.5 x2=2.5 y1=8.5 y2=9.5></line> <path class=ql-fill d=M9.007,8C6.542,7.791,6,7.519,6,6.5,6,5.792,7.283,5,9,5c1.571,0,2.765.679,2.969,1.309a1,1,0,0,0,1.9-.617C13.356,4.106,11.354,3,9,3,6.2,3,4,4.538,4,6.5a3.2,3.2,0,0,0,.5,1.843Z></path> <path class=ql-fill d=M8.984,10C11.457,10.208,12,10.479,12,11.5c0,0.708-1.283,1.5-3,1.5-1.571,0-2.765-.679-2.969-1.309a1,1,0,1,0-1.9.617C4.644,13.894,6.646,15,9,15c2.8,0,5-1.538,5-3.5a3.2,3.2,0,0,0-.5-1.843Z></path> </svg>`,

    code:
        `<svg viewbox="0 0 18 18"> <polyline class="ql-even ql-stroke" points="5 7 3 9 5 11"></polyline> <polyline class="ql-even ql-stroke" points="13 7 15 9 13 11"></polyline> <line class=ql-stroke x1=10 x2=8 y1=5 y2=13></line> </svg>`,

    blockquote:
        `<svg viewbox="0 0 18 18"> <rect class="ql-fill ql-stroke" height=3 width=3 x=4 y=5></rect> <rect class="ql-fill ql-stroke" height=3 width=3 x=11 y=5></rect> <path class="ql-even ql-fill ql-stroke" d=M7,8c0,4.031-3,5-3,5></path> <path class="ql-even ql-fill ql-stroke" d=M14,8c0,4.031-3,5-3,5></path> </svg>`,

    codeblock:
        `<svg viewbox="0 0 18 18"> <polyline class="ql-even ql-stroke" points="5 7 3 9 5 11"></polyline> <polyline class="ql-even ql-stroke" points="13 7 15 9 13 11"></polyline> <line class=ql-stroke x1=10 x2=8 y1=5 y2=13></line> </svg>`,

    link:
        `<svg viewbox="0 0 18 18"> <line class=ql-stroke x1=7 x2=11 y1=7 y2=11></line> <path class="ql-even ql-stroke" d=M8.9,4.577a3.476,3.476,0,0,1,.36,4.679A3.476,3.476,0,0,1,4.577,8.9C3.185,7.5,2.035,6.4,4.217,4.217S7.5,3.185,8.9,4.577Z></path> <path class="ql-even ql-stroke" d=M13.423,9.1a3.476,3.476,0,0,0-4.679-.36,3.476,3.476,0,0,0,.36,4.679c1.392,1.392,2.5,2.542,4.679.36S14.815,10.5,13.423,9.1Z></path> </svg>`,

    image:
        `<svg viewbox="0 0 18 18"> <rect class=ql-stroke height=10 width=12 x=3 y=4></rect> <circle class=ql-fill cx=6 cy=7 r=1></circle> <polyline class="ql-even ql-fill" points="5 12 5 11 7 9 8 10 11 7 13 9 13 12 5 12"></polyline> </svg>`,

    ol:
        `<svg viewbox="0 0 18 18"> <line class=ql-stroke x1=7 x2=15 y1=4 y2=4></line> <line class=ql-stroke x1=7 x2=15 y1=9 y2=9></line> <line class=ql-stroke x1=7 x2=15 y1=14 y2=14></line> <line class="ql-stroke ql-thin" x1=2.5 x2=4.5 y1=5.5 y2=5.5></line> <path class=ql-fill d=M3.5,6A0.5,0.5,0,0,1,3,5.5V3.085l-0.276.138A0.5,0.5,0,0,1,2.053,3c-0.124-.247-0.023-0.324.224-0.447l1-.5A0.5,0.5,0,0,1,4,2.5v3A0.5,0.5,0,0,1,3.5,6Z></path> <path class="ql-stroke ql-thin" d=M4.5,10.5h-2c0-.234,1.85-1.076,1.85-2.234A0.959,0.959,0,0,0,2.5,8.156></path> <path class="ql-stroke ql-thin" d=M2.5,14.846a0.959,0.959,0,0,0,1.85-.109A0.7,0.7,0,0,0,3.75,14a0.688,0.688,0,0,0,.6-0.736,0.959,0.959,0,0,0-1.85-.109></path> </svg>`,

    ul:
        `<svg viewbox="0 0 18 18"> <line class=ql-stroke x1=6 x2=15 y1=4 y2=4></line> <line class=ql-stroke x1=6 x2=15 y1=9 y2=9></line> <line class=ql-stroke x1=6 x2=15 y1=14 y2=14></line> <line class=ql-stroke x1=3 x2=3 y1=4 y2=4></line> <line class=ql-stroke x1=3 x2=3 y1=9 y2=9></line> <line class=ql-stroke x1=3 x2=3 y1=14 y2=14></line> </svg>`,

    hr:
        `<svg viewbox="0 0 18 18"> <line class=ql-stroke x1=3 x2=15 y1=9 y2=9></line> <line class="ql-stroke ql-thin" x1=3 x2=15 y1=9 y2=9></line> </svg>`,

    table:
        `<svg viewbox="0 0 18 18"> <rect class=ql-stroke height=12 width=12 x=3 y=3></rect> <line class=ql-stroke x1=3 x2=15 y1=7 y2=7></line> <line class=ql-stroke x1=3 x2=15 y1=11 y2=11></line> <line class=ql-stroke x1=7 x2=7 y1=3 y2=15></line> <line class=ql-stroke x1=11 x2=11 y1=3 y2=15></line> </svg>`,
};

// ---------------------------------------------------------
// Textarea manipulation helpers
// ---------------------------------------------------------

function wrapSelection(textarea, before, after) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    // toggle off: if the selection is already wrapped, remove the markers
    const hasBefore = start >= before.length
        && text.substring(start - before.length, start) === before;
    const hasAfter = end + after.length <= text.length
        && text.substring(end, end + after.length) === after;

    if (hasBefore && hasAfter) {
        const inner = text.substring(start, end);
        textarea.selectionStart = start - before.length;
        textarea.selectionEnd = end + after.length;
        document.execCommand("insertText", false, inner);
        textarea.selectionStart = start - before.length;
        textarea.selectionEnd = start - before.length + inner.length;
    }
    else {
        const selected = text.substring(start, end);
        document.execCommand("insertText", false, before + selected + after);
        textarea.selectionStart = start + before.length;
        textarea.selectionEnd = start + before.length + selected.length;
    }
}

function prefixLines(textarea, prefix) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    // expand to full lines
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", end);
    const actualEnd = lineEnd === -1 ? text.length : lineEnd;

    const lines = text.substring(lineStart, actualEnd).split("\n");
    const allPrefixed = lines.every(line => line.startsWith(prefix));

    const result = allPrefixed
        ? lines.map(line => line.substring(prefix.length)).join("\n")
        : lines.map(line => prefix + line).join("\n");

    textarea.selectionStart = lineStart;
    textarea.selectionEnd = actualEnd;
    document.execCommand("insertText", false, result);

    textarea.selectionStart = lineStart;
    textarea.selectionEnd = lineStart + result.length;
}

function insertBlock(textarea, blockText) {
    document.execCommand("insertText", false, blockText);
}

// ---------------------------------------------------------
// Button definitions per format
// ---------------------------------------------------------

const MD_TABLE_TEMPLATE =
`| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
|          |          |          |
`;

const ORG_TABLE_TEMPLATE =
`|-------+--------+--------|
|       | Col 1  | Col 2  |
|-------+--------+--------|
|       |        |        |
|-------+--------+--------|
`;

const MARKDOWN_BUTTONS = [
    // Headings
    [
        {id: "h1", title: "Heading 1", label: "H1", action: ta => prefixLines(ta, "# ")},
        {id: "h2", title: "Heading 2", label: "H2", action: ta => prefixLines(ta, "## ")},
        {id: "h3", title: "Heading 3", label: "H3", action: ta => prefixLines(ta, "### ")},
    ],
    // Inline formatting
    [
        {id: "bold",   title: "Bold",          icon: ICONS.bold,   action: ta => wrapSelection(ta, "**", "**")},
        {id: "italic", title: "Italic",        icon: ICONS.italic, action: ta => wrapSelection(ta, "*", "*")},
        // markdown has no underline syntax, the inline HTML is passed through by the renderer
        {id: "underline", title: "Underline", icon: ICONS.underline, action: ta => wrapSelection(ta, "<u>", "</u>")},
        {id: "strike", title: "Strikethrough",  icon: ICONS.strike, action: ta => wrapSelection(ta, "~~", "~~")},
        {id: "code",   title: "Inline code",   icon: ICONS.code,   action: ta => wrapSelection(ta, "`", "`")},
    ],
    // Block
    [
        {id: "blockquote", title: "Blockquote", icon: ICONS.blockquote, action: ta => prefixLines(ta, "> ")},
        {id: "codeblock",  title: "Code block", icon: ICONS.codeblock,  action: ta => wrapSelection(ta, "```\n", "\n```")},
    ],
    // Lists
    [
        {id: "ul", title: "Unordered list", icon: ICONS.ul, action: ta => prefixLines(ta, "- ")},
        {id: "ol", title: "Ordered list",   icon: ICONS.ol, action: ta => prefixLines(ta, "1. ")},
    ],
    // Insert
    [
        {id: "link",  title: "Link",           icon: ICONS.link,  action: ta => wrapSelection(ta, "[", "](url)")},
        {id: "image", title: "Image",          icon: ICONS.image, action: ta => insertBlock(ta, "![alt](url)")},
        {id: "hr",    title: "Horizontal rule", icon: ICONS.hr,    action: ta => insertBlock(ta, "\n-----\n")},
        {id: "table", title: "Table",          icon: ICONS.table, action: ta => insertBlock(ta, "\n" + MD_TABLE_TEMPLATE)},
    ],
];

const ORG_BUTTONS = [
    // Headings
    [
        {id: "h1", title: "Heading 1", label: "H1", action: ta => prefixLines(ta, "* ")},
        {id: "h2", title: "Heading 2", label: "H2", action: ta => prefixLines(ta, "** ")},
        {id: "h3", title: "Heading 3", label: "H3", action: ta => prefixLines(ta, "*** ")},
    ],
    // Inline formatting
    [
        {id: "bold",      title: "Bold",         icon: ICONS.bold,      action: ta => wrapSelection(ta, "*", "*")},
        {id: "italic",    title: "Italic",       icon: ICONS.italic,    action: ta => wrapSelection(ta, "/", "/")},
        {id: "underline", title: "Underline",    icon: ICONS.underline, action: ta => wrapSelection(ta, "_", "_")},
        {id: "strike",    title: "Strikethrough", icon: ICONS.strike,   action: ta => wrapSelection(ta, "+", "+")},
        {id: "mono",      title: "Monospaced",   icon: ICONS.code,     action: ta => wrapSelection(ta, "=", "=")},
        {id: "code",      title: "Code",         icon: ICONS.codeblock, action: ta => wrapSelection(ta, "~", "~")},
    ],
    // Block
    [
        {id: "quote",   title: "Quote",   icon: ICONS.blockquote, action: ta => wrapSelection(ta, "#+BEGIN_QUOTE\n", "\n#+END_QUOTE")},
        {id: "example", title: "Example", icon: ICONS.codeblock,  action: ta => wrapSelection(ta, "#+BEGIN_EXAMPLE\n", "\n#+END_EXAMPLE")},
        {id: "src",     title: "Source",  icon: ICONS.code,       action: ta => wrapSelection(ta, "#+BEGIN_SRC\n", "\n#+END_SRC")},
    ],
    // Lists
    [
        {id: "ul", title: "Unordered list", icon: ICONS.ul, action: ta => prefixLines(ta, "- ")},
        {id: "ol", title: "Ordered list",   icon: ICONS.ol, action: ta => prefixLines(ta, "1. ")},
    ],
    // Insert
    [
        {id: "link",  title: "Link",           icon: ICONS.link,  action: ta => wrapSelection(ta, "[[url][", "]]")},
        {id: "hr",    title: "Horizontal rule", icon: ICONS.hr,    action: ta => insertBlock(ta, "\n-----\n")},
        {id: "table", title: "Table",          icon: ICONS.table, action: ta => insertBlock(ta, "\n" + ORG_TABLE_TEMPLATE)},
    ],
];

// ---------------------------------------------------------
// NotesToolbar class
// ---------------------------------------------------------

export class NotesToolbar {
    /**
     * @param {"markdown"|"org"} format
     */
    constructor(format) {
        this.format = format;
        this.element = null;
        this.install();
    }

    install() {
        const buttons = this.format === "markdown" ? MARKDOWN_BUTTONS : ORG_BUTTONS;
        const textarea = document.getElementById("editor");

        // build toolbar container with Quill's CSS classes
        const toolbar = document.createElement("div");
        toolbar.id = "markup-toolbar";
        toolbar.className = "ql-toolbar ql-snow";

        for (const group of buttons) {
            const span = document.createElement("span");
            span.className = "ql-formats";

            for (const btn of group) {
                const button = document.createElement("button");
                button.type = "button";
                button.title = btn.title;

                if (btn.icon) {
                    button.innerHTML = btn.icon;
                }
                else if (btn.label) {
                    button.textContent = btn.label;
                    button.className = "markup-heading-btn";
                }

                button.addEventListener("mousedown", e => {
                    e.preventDefault();  // keep textarea focused for execCommand
                });

                button.addEventListener("click", e => {
                    e.preventDefault();
                    btn.action(textarea);
                });

                span.appendChild(button);
            }

            toolbar.appendChild(span);
        }

        // insert before the textarea in #editor-container
        const container = document.getElementById("editor-container");
        container.insertBefore(toolbar, container.firstChild);
        this.element = toolbar;
    }

    uninstall() {
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }
}
