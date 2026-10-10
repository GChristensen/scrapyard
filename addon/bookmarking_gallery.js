// Gallery capture: extracting an image and its metadata from a page with the CSS/XPath selectors of a gallery
// shelf, instead of running the page-capture engine. Split out of bookmarking.js so the gallery-specific pipeline
// (a distinct capture mode with its own extraction, storage and notification steps) doesn't dilute the general
// bookmarking/archiving code there. See addon/gallery.js for what makes a shelf or folder a gallery in the first
// place, and addon/content_gallery.js for the extraction content script this dispatches to.

import {injectScriptFile, showNotification} from "./utils_browser.js";
import {CONTENT_TYPE_TO_EXT, getMimetypeByExt} from "./utils.js";
import {send} from "./proxy.js";
import {fetchWithTimeout} from "./utils_io.js";
import {Archive, Node, Comments} from "./storage_entities.js";
import {settings} from "./settings.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import {byPosition} from "./storage.js";
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

    // the poster of a video is stored as a side file, which exists only in the backend storage
    if (extracted.video && settings.storage_mode_internal())
        return abortGalleryCapture(bookmark, "Videos can only be archived in the backend storage mode.");

    let response;

    try {
        response = await fetchWithTimeout(extracted.image_url, {timeout: 60000, headers: {"Cache-Control": "no-store"}});
    }
    catch (e) {
        console.error(e);
    }

    if (!response?.ok)
        return abortGalleryCapture(bookmark, "Could not download the image.");

    const contentType = extracted.video
        ? videoContentType(response, extracted.image_url)
        : response.headers.get("content-type")
            || getMimetypeByExt(new URL(extracted.image_url).pathname) || "application/octet-stream";

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

    // the image is stored by now, so neither the metadata, the poster nor the thumbnail may fail the capture

    let poster;

    try {
        if (extracted.video_poster_url)
            poster = await storeVideoPoster(bookmark, extracted.video_poster_url);
        // side files exist only in the backend storage, in the internal storage mode the grid draws the full images
        else if (!extracted.video && !settings.storage_mode_internal())
            poster = await storeImagePoster(bookmark, imageBytes, contentType);
    }
    catch (e) {
        console.error(e);
    }

    try {
        // the page url is kept in the node, so the original page remains reachable; the image address is recorded
        // in the comments along with the rest of the extracted metadata
        const metadata = {
            image_url: extracted.image_url,
            prompt: extracted.image_prompt,
            negative_prompt: extracted.image_negative_prompt,
            resources: extracted.image_resources
        };

        // the side file with the poster of a video (with its original name) or the reduced copy of an image
        if (poster)
            metadata.poster = {file: poster.file, name: poster.name, type: poster.type};

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
            // a video is shown by its poster, if any
            if (!extracted.video)
                await notifyGalleryCaptured(bookmark, imageBytes, contentType);
            else if (poster)
                await notifyGalleryCaptured(bookmark, poster.bytes, poster.type);
            else
                showNotification({title: "Scrapyard", message: bookmark.name || "Video captured"});
        }
        catch (e) {
            console.error(e);
        }
    }

    try {
        await moveToFirstPosition(bookmark);
    }
    catch (e) {
        console.error(e);
    }

    clearNodePending(bookmark);
    finalizeCapture(bookmark);
}

// The newest item of a gallery goes first, both in the grid and in the sidebar.
async function moveToFirstPosition(bookmark) {
    const siblings = await Node.getChildren(bookmark.parent_id);
    const others = siblings.filter(n => n.id !== bookmark.id).sort(byPosition);
    const positions = [bookmark, ...others].map((n, i) => ({id: n.id, pos: i}));

    await Bookmark.reorder(positions);
    bookmark.pos = 0;
}

// The type of a video must be video/* to mark the item as a video (see ui/gallery.js), while servers often send
// a generic type such as application/octet-stream.
function videoContentType(response, url) {
    const isVideo = type => type?.split(";")[0].trim().toLowerCase().startsWith("video/");

    const header = response.headers.get("content-type");
    if (isVideo(header))
        return header;

    const byExt = getMimetypeByExt(new URL(url).pathname);
    if (isVideo(byExt))
        return byExt;

    return "video/mp4";
}

// Downloads the poster of a video and stores it as a side file of the archive, named "poster" with the extension
// of the original file. Returns its file name, original name and type along with the bytes, or nothing if the poster
// is not an image.
async function storeVideoPoster(bookmark, url) {
    const response = await fetchWithTimeout(url, {timeout: 60000, headers: {"Cache-Control": "no-store"}});

    if (!response.ok)
        return;

    const pathname = new URL(url).pathname;
    let type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();

    if (!type?.startsWith("image/"))
        type = getMimetypeByExt(pathname);

    if (!type?.startsWith("image/"))
        return;

    let name;
    try {
        name = decodeURIComponent(pathname.split("/").pop());
    }
    catch (e) {
        name = pathname.split("/").pop();
    }

    const ext = name.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase() || CONTENT_TYPE_TO_EXT[type];
    const file = ext? `poster.${ext}`: "poster";
    const bytes = await response.arrayBuffer();

    await Archive.saveSideFile(bookmark, file, bytes);

    return {file, name: name || undefined, type, bytes};
}

// The longest side of the poster made of a captured image, the size of a grid tile (see ui/gallery.css).
const IMAGE_POSTER_SIZE = 300;

// Stores a copy of the captured image reduced to IMAGE_POSTER_SIZE as its poster, so the grid does not have to
// fetch and decode the full images. Nothing is stored for an image that is already small enough, or that can not be
// decoded here (e.g., SVG). OffscreenCanvas is used, since there is no DOM in the MV3 service worker.
async function storeImagePoster(bookmark, imageBytes, contentType) {
    const bitmap = await createImageBitmap(new Blob([imageBytes], {type: contentType}));

    try {
        const scale = IMAGE_POSTER_SIZE / Math.max(bitmap.width, bitmap.height);

        if (scale >= 1)
            return;

        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");

        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, 0, 0, width, height);

        // a browser that can not encode WebP produces PNG instead, the actual type is taken from the result
        const blob = await canvas.convertToBlob({type: "image/webp", quality: 0.85});
        const type = blob.type || "image/png";
        const file = `poster.${CONTENT_TYPE_TO_EXT[type] || "png"}`;

        await Archive.saveSideFile(bookmark, file, await blob.arrayBuffer());

        return {file, type};
    }
    finally {
        bitmap.close();
    }
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
