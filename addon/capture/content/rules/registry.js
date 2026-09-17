// The first matching rule of the ordered list wins.

import {RULES} from "./index.js";

/** @typedef {import("../../shared/types.js").ElementRule} ElementRule */

/**
 * @param {Element} el
 * @returns {ElementRule|null}
 */
export function ruleFor(el) {
    for (const rule of RULES)
        if (rule.match(el))
            return rule;

    return null;
}
