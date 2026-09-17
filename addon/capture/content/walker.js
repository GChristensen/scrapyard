// The DOM walk shared by all three passes: document order, shadow roots before light children, frames
// resolved through frames.js, exclusions applied once. The passes differ only in their visitor.

import {MARK, SKIP, SKIP_CHILDREN} from "../shared/constants.js";
import {resolveFrame} from "./frames.js";

/** @typedef {import("./context.js").CaptureContext} CaptureContext */

/**
 * @typedef {object} Visitor
 * @property {(el: Element, ctx: CaptureContext, state: any) => any} [enter]
 *     may return SKIP (nothing more for this element), SKIP_CHILDREN (no children, leave still called),
 *     or an object used as the children's state
 * @property {(el: Element, ctx: CaptureContext, state: any) => any} [leave]
 * @property {(el: Element, childCtx: CaptureContext|null, ctx: CaptureContext, state: any) => any} [frame]
 * @property {(el: Element, root: ShadowRoot, ctx: CaptureContext, state: any) => any} [shadowBegin]  false = do not walk the root
 * @property {(el: Element, root: ShadowRoot, ctx: CaptureContext, state: any) => any} [shadowEnd]
 * @property {(node: Text, ctx: CaptureContext, state: any) => any} [text]
 * @property {(node: Comment, ctx: CaptureContext, state: any) => any} [comment]
 */

/**
 * Elements never visited: the lock overlay, quirk exclusions, Scrapyard UI leftovers (id "scrapyard-*", except the
 * CSS variables style of a re-saved page) and, at depth 0, script/meta leftovers of previous saves.
 * @param {Element} el
 * @param {CaptureContext} ctx
 * @returns {boolean}
 */
export function isExcluded(el, ctx) {
    const id = typeof el.id === "string"? el.id: "";

    if (id === MARK.overlay)
        return true;

    if (id.startsWith(MARK.prefix + "-") && id !== MARK.cssVariables)
        return true;

    if (ctx.quirks && ctx.quirks.exclude(el))
        return true;

    if (ctx.depth === 0 && (el.localName === "script" || el.localName === "meta")) {
        const name = el.localName === "meta"? (el.getAttribute("name") || ""): id;

        for (const prefix of MARK.leftoverPrefixes)
            if (name.startsWith(prefix) || id.startsWith(prefix))
                return true;
    }

    return false;
}

/**
 * @param {CaptureContext} ctx
 * @param {Element} root
 * @param {Visitor} visitor
 * @param {any} [state]
 */
export async function walk(ctx, root, visitor, state) {
    await visitElement(root, ctx, visitor, state);
}

/**
 * Walks the child nodes of a node (used for the selection container).
 * @param {CaptureContext} ctx
 * @param {Node} parent
 * @param {Visitor} visitor
 * @param {any} [state]
 */
export async function walkChildren(ctx, parent, visitor, state) {
    const nodes = Array.from(parent.childNodes);

    for (const node of nodes)
        await visitNode(node, ctx, visitor, state);
}

async function visitNode(node, ctx, visitor, state) {
    if (node == null)   /* in case the page is not fully loaded */
        return;

    switch (node.nodeType) {
        case 1:
            await visitElement(node, ctx, visitor, state);
            break;
        case 3:
            if (visitor.text)
                await visitor.text(node, ctx, state);
            break;
        case 8:
            if (visitor.comment)
                await visitor.comment(node, ctx, state);
            break;
    }
}

async function visitElement(el, ctx, visitor, state) {
    if (isExcluded(el, ctx))
        return;

    if (el.localName === "iframe" || el.localName === "frame") {
        if (visitor.frame)
            await visitor.frame(el, resolveFrame(el, ctx), ctx, state);

        return;
    }

    const result = visitor.enter? await visitor.enter(el, ctx, state): undefined;

    if (result === SKIP)
        return;

    if (result !== SKIP_CHILDREN) {
        const childState = (result && typeof result === "object")? result: state;
        const shadow = ctx.shadowRootOf(el);

        if (shadow) {
            const walkShadow = visitor.shadowBegin? (await visitor.shadowBegin(el, shadow, ctx, childState)) !== false: true;

            if (walkShadow) {
                await walkChildren(ctx, shadow, visitor, childState);

                if (visitor.shadowEnd)
                    await visitor.shadowEnd(el, shadow, ctx, childState);
            }
        }

        await walkChildren(ctx, el, visitor, childState);
    }

    if (visitor.leave)
        await visitor.leave(el, ctx, state);
}
