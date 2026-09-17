// Per-site quirks. Add entries here, never inline in rules.

/**
 * @typedef {object} Quirk
 * @property {(location: Location) => boolean} match
 * @property {(doc: Document) => void} [prepare]
 * @property {(el: Element) => boolean} [exclude]
 */

/** @type {Quirk[]} */
const QUIRKS = [
    {
        // reddit: the first "subredditvars" element is collapsed and left out of the archive
        match: location => location.hostname.includes("reddit.com"),
        prepare(doc) {
            this._excluded = null;

            for (const element of doc.querySelectorAll("*")) {
                if (typeof element.className === "string" && element.className.startsWith("subredditvars")) {
                    element.style.height = "0";
                    this._excluded = element;
                    break;
                }
            }
        },
        exclude(el) {
            return this._excluded != null && el === this._excluded;
        }
    }
];

/**
 * The quirks that apply to a location, exposed as one object with prepare() and exclude().
 * @param {Location} location
 * @returns {{prepare: (doc: Document) => void, exclude: (el: Element) => boolean, active: Quirk[]}}
 */
export function quirksFor(location) {
    const active = QUIRKS.filter(quirk => {
        try {
            return quirk.match(location);
        }
        catch (e) {
            return false;
        }
    });

    return {
        active,
        prepare(doc) {
            for (const quirk of active)
                if (quirk.prepare)
                    quirk.prepare(doc);
        },
        exclude(el) {
            for (const quirk of active)
                if (quirk.exclude && quirk.exclude(el))
                    return true;

            return false;
        }
    };
}
