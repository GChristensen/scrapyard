// Pass 3: the serializer. Re-implements outerHTML by hand so every element can be rewritten in flight;
// strings go to ctx.out (owned by the sink).

import {MARK, SKIP, SKIP_CHILDREN, METADATA_ELEMENTS, RETAIN_ELEMENTS, HIDDEN_BY_DEFAULT} from "../../shared/constants.js";
import {Tag, escapeText} from "../core/tag.js";
import {rewriteInlineStyle} from "../core/stylesheet.js";
import {walk, walkChildren} from "../walker.js";
import {ruleFor} from "../rules/registry.js";
import {isStylesheetLink} from "../rules/style.js";
import {emitFrameFallback, frameManifestEntry} from "../rules/frame.js";
import {isSVG} from "../rules/common.js";

/** @typedef {import("../context.js").CaptureContext} CaptureContext */

/**
 * @typedef {object} SerializeState
 * @property {number} indent           indent of the elements at this level
 * @property {number} parentPreserve   white-space preservation of the parent: 0 collapse, 1 newlines, 2 all
 * @property {boolean} parentInline
 */

/** @returns {SerializeState} */
function rootState() {
    return {indent: 0, parentPreserve: 0, parentInline: false};
}

function newlineIndent(indent) {
    return "\n" + " ".repeat(Math.max(0, indent));
}

function pretty(ctx) {
    return ctx.options.prettyPrint && ctx.depth === 0 && !ctx.savedPage;
}

/** Steps 1-6 of the per-element processing; returns SKIP or {tag, inline, preserve}. */
async function prepareTag(el, ctx, state, visitor) {
    const tag = Tag.from(el);
    const parent = el.parentElement;

    /* a <button> inside an ancestor <button> is invalid: W3C HTML5 2011 4.10.8 */
    if (el.localName === "button" && parent != null && parent.closest("button") != null)
        tag.name = "span";

    /* a non-metadata element in <head> is moved to <body> when the saved page opens: keep it hidden */
    if (parent != null && parent.localName === "head" && !METADATA_ELEMENTS.includes(tag.name)) {
        tag.set(MARK.nonMetadata, "");
        tag.set("hidden", "");
    }

    let inline = false;
    let preserve = 0;

    if (pretty(ctx) && !ctx.crossFrame) {
        const style = ctx.computed(el);

        if (style) {
            const display = style.getPropertyValue("display");
            const position = style.getPropertyValue("position");
            const whitespace = style.getPropertyValue("white-space");

            inline = display.includes("inline") || (display === "none" && ctx.doc.body.contains(el))
                || position === "absolute" || position === "fixed";
            preserve = (whitespace === "pre" || whitespace === "pre-wrap")? 2: (whitespace === "pre-line"? 1: 0);
        }
    }

    /* selection capture: the first body child is replaced by the selection, the rest of the body is skipped */
    if (ctx.depth === 0 && ctx.run.selectionRoot && parent != null && parent.localName === "body") {
        if (!ctx.run.skipRestOfBody) {
            ctx.run.skipRestOfBody = true;
            await walkChildren(ctx, ctx.run.selectionRoot, visitor, state);
        }

        return SKIP;
    }

    const displayed = ctx.displayed(el);

    if (el.hasAttribute("style"))
        tag.set("style", rewriteInlineStyle(el.getAttribute("style"), ctx.baseURI, ctx.documentURI, ctx));

    if (!displayed) {
        /* elements collapsed by the page, page editors or content blockers */
        if (ctx.options.hiddenElements === "remove") {
            if (!RETAIN_ELEMENTS.includes(el.localName) && !isSVG(el)) {
                ctx.out.push(MARK.htmlRemove(el.localName));
                return SKIP;
            }
        }
        else if (ctx.options.hiddenElements === "rehide") {
            if (!HIDDEN_BY_DEFAULT.includes(el.localName))
                tag.appendStyle(MARK.cssRehide + " display: none !important;");
        }
    }

    return {tag, inline, preserve};
}

function isTextElement(el) {
    return el.localName === "style" || el.localName === "script" || isStylesheetLink(el);
}

/**
 * @param {CaptureContext} ctx
 * @returns {import("../walker.js").Visitor}
 */
function createVisitor(ctx0) {
    const infos = new WeakMap();

    const visitor = {
        async enter(el, ctx, state) {
            const prepared = await prepareTag(el, ctx, state, visitor);

            if (prepared === SKIP)
                return SKIP;

            const {tag, inline, preserve} = prepared;
            const rule = ruleFor(el);
            const result = rule && rule.serialize? await rule.serialize(el, ctx, tag): undefined;

            if (result === SKIP || tag.dropped)
                return SKIP;

            if (result && typeof result === "object" && typeof result.replacement === "string") {
                ctx.out.push(result.replacement);
                return SKIP;
            }

            const out = ctx.out;
            const isPretty = pretty(ctx);
            const info = {tag, inline, preserve, indent: state.indent};
            infos.set(el, info);

            if (el.localName === "html") {
                out.push(tag.before);
                out.push(tag.startTag());
            }
            else if (el.localName === "head") {
                if (isPretty)
                    out.push(newlineIndent(state.indent));

                out.push(tag.startTag());
                out.push(tag.after);
            }
            else {
                if (isPretty && !inline && state.parentPreserve === 0)
                    out.push(newlineIndent(state.indent));

                out.push(tag.startTag());
                out.push(tag.after);
            }

            if (isTextElement(el)) {
                let text = tag.text || "";

                if (isPretty) {
                    text = text.trim().replace(/\n/g, newlineIndent(state.indent + 2));

                    if (text !== "")
                        text = newlineIndent(state.indent + 2) + text;

                    text += newlineIndent(state.indent);
                }

                out.push(text);
                return SKIP_CHILDREN;
            }

            if (tag.text != null) {
                out.push(tag.text);
                return SKIP_CHILDREN;
            }

            if (tag.isVoid && !tag.unwrapped)
                return SKIP_CHILDREN;

            return {indent: state.indent + 2, parentPreserve: preserve, parentInline: inline};
        },

        leave(el, ctx, state) {
            const info = infos.get(el);

            if (!info)
                return;

            infos.delete(el);

            const {tag, inline, preserve, indent} = info;
            const out = ctx.out;
            const isPretty = pretty(ctx);

            if (el.localName === "html" || el.localName === "body") {
                if (isPretty)
                    out.push(newlineIndent(indent));

                out.push(tag.endTag());
            }
            else if (el.localName === "head") {
                out.push(tag.beforeEnd);
                out.push(newlineIndent(isPretty? indent: 0));
                out.push(tag.endTag());
            }
            else if (!tag.isVoid) {
                if (isPretty && !inline && preserve === 0 && el.children.length > 0)
                    out.push(newlineIndent(indent));

                out.push(tag.endTag());
            }

            out.push(tag.afterEnd);
        },

        text(node, ctx, state) {
            let text = node.textContent;
            const parent = node.parentNode;

            if (!parent || parent.localName !== "noscript")
                text = escapeText(text);

            if (pretty(ctx)) {
                /* HTML whitespace: spaces (U+0020, U+0009, U+000C) and newlines (U+000A, U+000D) */
                if (state.parentPreserve === 0)
                    text = text.replace(/[ \t\f\n\r]+/g, " ");
                else if (state.parentPreserve === 1)
                    text = text.replace(/[ \t\f]+/g, " ");
            }

            ctx.out.push(text);
        },

        comment(node, ctx, state) {
            let text = node.textContent;

            if (text.includes(MARK.oldSummary))
                return;

            if (pretty(ctx) && !state.parentInline && state.parentPreserve === 0) {
                text = text.replace(/\n/g, newlineIndent(state.indent));
                ctx.out.push(newlineIndent(state.indent));
            }

            ctx.out.push("<!--" + text + "-->");
        },

        shadowBegin(el, root, ctx, state) {
            if (!ctx.options.shadowDom)
                return false;

            if (pretty(ctx))
                ctx.out.push(newlineIndent(state.indent - 2));

            ctx.out.push("<template " + MARK.shadowRoot + "=\"\">");
        },

        shadowEnd(el, root, ctx, state) {
            if (pretty(ctx))
                ctx.out.push(newlineIndent(state.indent - 2));

            ctx.out.push("</template>");
        },

        async frame(el, childCtx, ctx, state) {
            const prepared = await prepareTag(el, ctx, state, visitor);

            if (prepared === SKIP)
                return;

            const {tag, inline} = prepared;
            const out = ctx.out;

            if (childCtx) {
                childCtx.documentPath = ctx.sink.childDocumentPath(el, childCtx, ctx);
                childCtx.out = [];

                await serializeDocument(childCtx);

                const html = childCtx.out.join("");
                childCtx.out = [];

                await ctx.sink.emitFrame(tag, el, childCtx, html, ctx, state);
                ctx.run.frames.push(frameManifestEntry(childCtx));
            }
            else
                emitFrameFallback(el, tag, ctx);

            tag.remove(MARK.key);
            tag.remove(MARK.oldKey);

            if (pretty(ctx) && !inline && state.parentPreserve === 0)
                out.push(newlineIndent(state.indent));

            out.push(tag.startTag());
            out.push(tag.endTag());
        }
    };

    return visitor;
}

/**
 * Serializes a document into ctx.out.
 * @param {CaptureContext} ctx
 */
export async function serializeDocument(ctx) {
    await walk(ctx, ctx.doc.documentElement, createVisitor(ctx), rootState());
}

/** Indentation helper exported for the sinks (srcdoc wrapping). */
export {newlineIndent};
