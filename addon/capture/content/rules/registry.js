// The first matching rule of the ordered list wins.
//
// The list is indexed by tag name once, at module load: every rule declares the localName values its match()
// can accept, so an element only tests the rules of its own tag. Order inside a bucket is inherited from
// RULES, so precedence is exactly the precedence of the list. A rule that declares no tags disables the index
// altogether and everything falls back to the linear scan: a forgotten "tags" is slow, never wrong.

import {RULES} from "./index.js";

/** @typedef {import("../../shared/types.js").ElementRule} ElementRule */

/** @type {Map<string, ElementRule[]>|null} null when some rule declares no tags */
const INDEX = buildIndex();

function buildIndex() {
    const index = new Map();

    for (const rule of RULES) {
        if (!Array.isArray(rule.tags) || rule.tags.length === 0)
            return null;

        for (const tag of rule.tags) {
            const bucket = index.get(tag);

            if (bucket)
                bucket.push(rule);
            else
                index.set(tag, [rule]);
        }
    }

    return index;
}

/**
 * @param {Element} el
 * @returns {ElementRule|null}
 */
export function ruleFor(el) {
    const candidates = INDEX? INDEX.get(el.localName): RULES;

    if (candidates)
        for (const rule of candidates)
            if (rule.match(el))
                return rule;

    return null;
}

/** The linear scan the index replaces; kept for the test that proves the two agree. */
export function ruleForLinear(el) {
    for (const rule of RULES)
        if (rule.match(el))
            return rule;

    return null;
}
