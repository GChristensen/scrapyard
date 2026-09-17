// Gallery capture: extracting an image and its metadata from a page with the CSS/XPath selectors of a gallery
// shelf, instead of running the page-capture engine. Split out of bookmarking.js so the gallery-specific pipeline
// (a distinct capture mode with its own extraction, storage and notification steps) doesn't dilute the general
// bookmarking/archiving code there. See addon/gallery.js for what makes a shelf or folder a gallery in the first
// place, and addon/content_gallery.js for the extraction content script this dispatches to.

import {injectScriptFile, showNotification} from "./utils_browser.js";
import {getMimetypeByExt} from "./utils.js";
import {send} from "./proxy.js";
import {fetchWithTimeout} from "./utils_io.js";
import {Node, Comments} from "./storage_entities.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import {getGalleryShelf, isGalleryTarget, readGallerySelectors} from "./gallery.js";
import {clearNodePending} from "./storage_pending.js";
import {toBase64} from "./capture/shared/bytes.js";
import {finalizeCapture} from "./bookmarking.js";

// A capture into a gallery shelf or into a folder directly under it extracts an image instead of the page.
export async function isGalleryCapture(bookmark) {
    if (!bookmark?.parent_id)
        return false;

    const parent = await Node.get(bookmark.parent_id);
    return isGalleryTarget(parent);
}

// Extracts an image and its metadata from the page with the selectors of the gallery shelf, and stores the image
// itself as the content of the archive node created for the capture. The prompt and the resources are stored as JSON
// in the comments of the node, and the thumbnail becomes its icon.
export async function captureGalleryTab(tab, bookmark) {
    const parent = await Node.get(bookmark.parent_id);
    const shelf = await getGalleryShelf(parent);
    const selectors = readGallerySelectors(shelf);

    if (!selectors.image_url)
        return abortGalleryCapture(bookmark, "No image selector is configured for this gallery.");

    let extracted;

    try {
        if (!_BACKGROUND_PAGE)
            await injectScriptFile(tab.id, {file: "/lib/browser-polyfill.js", frameId: 0});

        await injectScriptFile(tab.id, {file: "/content_gallery.js", frameId: 0});

        extracted = await browser.tabs.sendMessage(tab.id, {type: "EXTRACT_GALLERY_ITEM", selectors}, {frameId: 0});
    }
    catch (e) {
        console.error(e);
    }

    if (!extracted?.image_url)
        return abortGalleryCapture(bookmark, "No image was found on this page.");

    let response;

    try {
        response = await fetchWithTimeout(extracted.image_url, {timeout: 60000, headers: {"Cache-Control": "no-store"}});
    }
    catch (e) {
        console.error(e);
    }

    if (!response?.ok)
        return abortGalleryCapture(bookmark, "Could not download the image.");

    let contentType = response.headers.get("content-type");

    if (!contentType)
        contentType = getMimetypeByExt(new URL(extracted.image_url).pathname) || "application/octet-stream";

    bookmark.content_type = contentType;
    bookmark.name = galleryItemName(bookmark, extracted);

    // read once: a fetch Response body can only be consumed a single time, and these bytes are reused below for
    // the OS notification when there is no separate thumbnail to show there instead
    const imageBytes = await response.arrayBuffer();

    try {
        await Bookmark.storeArchive(bookmark, imageBytes, contentType);
    }
    catch (e) {
        console.error(e);
        return abortGalleryCapture(bookmark, "Error archiving the image.");
    }

    // the image is stored by now, so neither the metadata nor the thumbnail may fail the capture

    try {
        // the page url is kept in the node, so the original page remains reachable; the image address is recorded
        // in the comments along with the rest of the extracted metadata
        const metadata = {
            image_url: extracted.image_url,
            prompt: extracted.image_prompt,
            negative_prompt: extracted.image_negative_prompt,
            resources: extracted.image_resources
        };

        // the automation API stores the comments it was given before the capture runs, without updating
        // has_comments on this object, so the stored comments are looked up and retained here instead of being
        // overwritten by the metadata
        const existing = await Comments.get(bookmark);

        if (existing)
            metadata.comments = existing;

        await Bookmark.storeComments(bookmark.id, JSON.stringify(metadata));
    }
    catch (e) {
        console.error(e);
    }

    try {
        if (extracted.image_thumb_url) {
            bookmark.icon = extracted.image_thumb_url;
            await Bookmark.storeIcon(bookmark);
        }
    }
    catch (e) {
        console.error(e);
    }

    if (!bookmark.__mute_ui) {
        try {
            await notifyGalleryCaptured(bookmark, imageBytes, contentType);
        }
        catch (e) {
            console.error(e);
        }
    }

    clearNodePending(bookmark);
    finalizeCapture(bookmark);
}

// Shows an OS notification with the captured picture itself - not the thumbnail, deliberately: the point of the
// notification is to confirm at a glance that the selectors still match this site and a real image came through,
// which a thumbnail can't vouch for (it's usually a different, smaller pick, and bookmark.stored_icon is already
// true from the tab favicon stored when the node was first created, well before this thumbnail selector even runs -
// checking it here would show that favicon, not the gallery thumbnail, on top of not answering the question asked).
// Chrome renders a real large-picture notification for this; Firefox currently only implements the "basic" template
// (see showNotification in utils_browser.js), so there the same picture is shown small, as the notification icon.
async function notifyGalleryCaptured(bookmark, imageBytes, contentType) {
    const imageUrl = `data:${contentType};base64,${toBase64(new Uint8Array(imageBytes))}`;

    return showNotification({title: "Scrapyard", message: bookmark.name || "Image captured", imageUrl});
}

// A gallery capture that produced nothing must not leave an empty archive node behind.
async function abortGalleryCapture(bookmark, message) {
    clearNodePending(bookmark);

    try {
        if (bookmark.id)
            await Bookmark.idb.delete([bookmark.id]);
    }
    catch (e) {
        console.error(e);
    }

    if (!bookmark.__mute_ui) {
        send.bookmarkCreationFailed({node: bookmark});
        // the indication is started for every archive in beforeBookmarkAdded and is only stopped when one is added
        send.stopProcessingIndication();
        showNotification(message);
    }
}

function galleryItemName(bookmark, extracted) {
    const prompt = extracted.image_prompt?.replace(/\s+/g, " ").trim();

    if (prompt)
        return prompt.length > 120? prompt.substring(0, 120) + "...": prompt;

    if (bookmark.name)
        return bookmark.name;

    try {
        return decodeURIComponent(new URL(extracted.image_url).pathname.split("/").pop()) || extracted.image_url;
    }
    catch (e) {
        return extracted.image_url;
    }
}
