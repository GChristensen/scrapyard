// The start-tag builder of the serializer: attributes are edited by name instead of by regex on a string.
// DOM-free: Tag.from() only reads localName and the attributes collection.

import {MARK, VOID_ELEMENTS, DROPPED_ATTRIBUTES, SKIP} from "../../shared/constants.js";

/**
 * @param {string} value
 * @returns {string} value with double quotes escaped for an attribute
 */
export function escapeAttribute(value) {
    return String(value).replace(/"/g, "&quot;");
}

/**
 * @param {string} text
 * @returns {string} text with &, < and > escaped
 */
export function escapeText(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class Tag {
    /**
     * @param {string} name
     * @param {Array<[string, string]>} [attributes]  in DOM order
     */
    constructor(name, attributes = []) {
        this.name = name;
        /** @type {Array<{name: string, value: string}>} */
        this._attributes = attributes.map(([name, value]) => ({name, value}));
        this._dropped = false;
        /** emit the children only (see unwrap()) */
        this.unwrapped = false;
        /** raw text content override (not escaped); null = serialize the child nodes */
        this.text = null;
        /** raw string emitted before the start tag (doctype) */
        this.before = "";
        /** raw string emitted right after the start tag (SVG symbol insert, head injections) */
        this.after = "";
        /** raw string emitted right before the end tag (head injections) */
        this.beforeEnd = "";
        /** raw string emitted right after the end tag (SVG symbol insert, as today) */
        this.afterEnd = "";
    }

    /**
     * @param {Element} element
     * @returns {Tag}
     */
    static from(element) {
        const attributes = [];

        for (const attribute of element.attributes)
            if (!DROPPED_ATTRIBUTES.includes(attribute.name))
                attributes.push([attribute.name, attribute.value]);

        return new Tag(element.localName, attributes);
    }

    /** @returns {boolean} */
    get dropped() {
        return this._dropped;
    }

    /** @param {string} name */
    has(name) {
        return this._attributes.some(a => a.name === name);
    }

    /**
     * @param {string} name
     * @returns {string|null}
     */
    get(name) {
        const attribute = this._attributes.find(a => a.name === name);
        return attribute? attribute.value: null;
    }

    /**
     * Sets a value; keeps the position of an existing attribute, appends otherwise.
     * @param {string} name
     * @param {string} value
     */
    set(name, value) {
        const attribute = this._attributes.find(a => a.name === name);

        if (attribute)
            attribute.value = String(value);
        else
            this._attributes.push({name, value: String(value)});

        return this;
    }

    /** @param {string} name */
    remove(name) {
        this._attributes = this._attributes.filter(a => a.name !== name);
        return this;
    }

    /**
     * Renames an attribute in place (xlink:href -> href); no-op when absent.
     * @param {string} oldName
     * @param {string} newName
     */
    rename(oldName, newName) {
        const attribute = this._attributes.find(a => a.name === oldName);

        if (attribute) {
            this._attributes = this._attributes.filter(a => a.name !== newName || a === attribute);
            attribute.name = newName;
        }

        return this;
    }

    /**
     * Copies the current value to data-scrapyard-<name>; no-op when the attribute is absent.
     * @param {string} name
     */
    preserve(name) {
        const value = this.get(name);

        if (value != null)
            this.set(MARK.original(name), value);

        return this;
    }

    /**
     * Preserves the original only if the value actually changes, then sets it.
     * @param {string} name
     * @param {string} value
     */
    replace(name, value) {
        const current = this.get(name);

        if (current !== value) {
            if (current != null)
                this.set(MARK.original(name), current);

            this.set(name, value);
        }

        return this;
    }

    /**
     * Appends CSS to the style attribute with ("; " unless it already ends with ";").
     * @param {string} css
     */
    appendStyle(css) {
        const current = this.get("style");

        if (current == null || current.trim() === "")
            return this.set("style", css);

        const separator = current.trim().endsWith(";")? " ": "; ";

        return this.set("style", current + separator + css);
    }

    /**
     * Prepends CSS to the style attribute.
     * @param {string} css
     */
    prependStyle(css) {
        const current = this.get("style");

        if (current == null || current.trim() === "")
            return this.set("style", css);

        const separator = css.trim().endsWith(";")? " ": "; ";

        return this.set("style", css + separator + current);
    }

    /** Emit nothing for this element (start tag, children, end tag). */
    drop() {
        this._dropped = true;
        return SKIP;
    }

    /** Emit the children but neither the start nor the end tag. */
    unwrap() {
        this.unwrapped = true;
    }

    /** @returns {boolean} */
    get isVoid() {
        return VOID_ELEMENTS.includes(this.name);
    }

    /** @returns {string} "" when unwrapped */
    startTag() {
        if (this.unwrapped)
            return "";

        let s = "<" + this.name;

        for (const {name, value} of this._attributes)
            s += " " + name + "=\"" + escapeAttribute(value) + "\"";

        return s + ">";
    }

    /** @returns {string} "" for void elements */
    endTag() {
        return (this.isVoid || this.unwrapped)? "": "</" + this.name + ">";
    }

    /** @returns {Array<[string, string]>} */
    attributes() {
        return this._attributes.map(a => [a.name, a.value]);
    }
}
