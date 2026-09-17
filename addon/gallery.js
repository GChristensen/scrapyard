// Gallery shelves: an ordinary user shelf flagged with the `gallery` property, in which archiving a page extracts a
// single image and its metadata with CSS selectors instead of capturing the page. The shelf and the folders directly
// under it are galleries; deeper folders are ordinary folders.
//
// The flag lives in the `gallery` node property; the selectors are stored as JSON in the `details` property of the
// shelf (the same way the files shelf keeps its file mask there). There is no UI to create a gallery shelf: an
// ordinary shelf is converted through the debug context menu.

import {Node} from "./storage_entities.js";
import {NODE_TYPE_FOLDER, NODE_TYPE_SHELF} from "./storage.js";

export const GALLERY_SELECTOR_FIELDS =
    ["image_url", "image_thumb_url", "image_prompt", "image_negative_prompt", "image_resources"];

export function isGalleryTarget(node) {
    return !!node?.gallery;
}

export function isGalleryShelf(node) {
    return node?.type === NODE_TYPE_SHELF && !!node.gallery;
}

export function isGalleryFolder(node) {
    return node?.type === NODE_TYPE_FOLDER && !!node.gallery;
}

// Returns the shelf that owns the gallery settings of the given node, or null when the node is not a gallery.
export async function getGalleryShelf(node) {
    if (isGalleryShelf(node))
        return node;

    if (isGalleryFolder(node))
        return Node.get(node.parent_id);

    return null;
}

// Selectors of a shelf that has none yet are returned as a complete object with empty values, so the settings dialog
// always has every field to fill in.
export function readGallerySelectors(shelfNode) {
    const selectors = {};
    let stored;

    try {
        stored = JSON.parse(shelfNode?.details || "{}");
    }
    catch (e) {
        stored = {};
    }

    for (const field of GALLERY_SELECTOR_FIELDS)
        selectors[field] = typeof stored?.[field] === "string"? stored[field].trim(): "";

    return selectors;
}

// Stores the selectors in the `details` property of the shelf node. The node is not persisted here.
export function writeGallerySelectors(shelfNode, selectors) {
    const stored = {};

    for (const field of GALLERY_SELECTOR_FIELDS) {
        const selector = selectors?.[field]?.trim();

        if (selector)
            stored[field] = selector;
    }

    shelfNode.details = Object.keys(stored).length? JSON.stringify(stored): undefined;

    return shelfNode;
}
