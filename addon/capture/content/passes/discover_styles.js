// Pass 1: external stylesheets referenced by <style> @imports and <link rel=stylesheet>.

import {walk} from "../walker.js";
import {ruleFor} from "../rules/registry.js";

/** @typedef {import("../context.js").CaptureContext} CaptureContext */

const visitor = {
    enter(el, ctx) {
        const rule = ruleFor(el);

        if (rule && rule.discoverStyles)
            rule.discoverStyles(el, ctx);
    },

    async frame(el, childCtx) {
        if (childCtx)
            await walk(childCtx, childCtx.doc.documentElement, visitor);
    }
};

/**
 * @param {CaptureContext} ctx  the top context
 */
export async function discoverStyles(ctx) {
    await walk(ctx, ctx.doc.documentElement, visitor);
}
