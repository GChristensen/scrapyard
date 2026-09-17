// The gallery viewer. The node named in the location hash decides the view: a gallery shelf or folder is shown as a
// grid of thumbnails, an archive as the full image with its prompt and resources.

import {systemInitialization} from "../bookmarks_init.js";
import {Archive, Comments, Node} from "../storage_entities.js";
import {Query} from "../storage_query.js";
import {NODE_TYPE_ARCHIVE} from "../storage.js";

const objectURLs = [];

// The grid draws the full images, so a tile is only loaded once it comes close to the viewport: in the helper app
// storage mode every archive is fetched over HTTP, and a large gallery would otherwise fetch and decode all of them.
let gridObserver;

$(init);
window.addEventListener("hashchange", () => render());
window.addEventListener("unload", revokeObjectURLs);

async function init() {
    await systemInitialization;
    bindInfoPopup();
    return render();
}

// Wired once, not per render: the popup's elements stay put across renders, only their content and the
// "Image Info" link's visibility change.
function bindInfoPopup() {
    $("#gallery-info-link").on("click", e => {
        e.preventDefault();
        $("#gallery-info-overlay").show();
    });

    $("#gallery-info-close").on("click", e => {
        e.preventDefault();
        closeInfoPopup();
    });

    // clicking the dimmed backdrop closes the popup; clicking inside the box must not (jQuery delegated targets
    // only the overlay itself, not its descendants, so a click reaching here always started on the backdrop)
    $("#gallery-info-overlay").on("click", e => {
        if (e.target.id === "gallery-info-overlay")
            closeInfoPopup();
    });

    $(document).on("keydown", e => {
        if (e.key === "Escape" && $("#gallery-info-overlay").is(":visible"))
            closeInfoPopup();
    });
}

function closeInfoPopup() {
    $("#gallery-info-overlay").hide();
}

function revokeObjectURLs() {
    while (objectURLs.length)
        URL.revokeObjectURL(objectURLs.pop());
}

function trackObjectURL(url) {
    if (url)
        objectURLs.push(url);

    return url;
}

// Mirrors getBlobURL() of browse.js: in the internal storage mode the content is already a Blob, otherwise it is
// reified into one.
async function archiveObjectURL(node) {
    const archive = await Archive.get(node);

    if (!archive)
        return null;

    if (archive.object instanceof Blob)
        return trackObjectURL(URL.createObjectURL(archive.object));

    const content = await Archive.reify(archive);

    if (!content)
        return null;

    const type = archive.type || node.content_type || "application/octet-stream";
    return trackObjectURL(URL.createObjectURL(new Blob([content], {type})));
}

// Resources come in two shapes depending on how the gallery selector was written (see content_gallery.js): a CSS
// selector produces a list of {name, url} pairs, an XPath selector produces one newline-joined string, each line
// being one resource with no separate address. Both are normalized here into the same {name, url} list so the
// popup can render them identically - a string line becomes a plain-text entry (no url).
function normalizeResources(resources) {
    if (Array.isArray(resources))
        return resources;

    if (typeof resources === "string")
        return resources.split("\n").map(line => line.trim()).filter(Boolean).map(name => ({name}));

    return [];
}

// The prompt and the resources of a gallery image are stored as JSON in its comments.
async function readMetadata(node) {
    if (!node.has_comments)
        return {};

    try {
        return JSON.parse(await Comments.get(node)) || {};
    }
    catch (e) {
        return {};
    }
}

function showMessage(message) {
    $("#gallery-message").text(message).show();
}

function resetViews() {
    gridObserver?.disconnect();
    gridObserver = undefined;

    revokeObjectURLs();

    $("#gallery-message").hide().text("");
    $("#gallery-grid").hide().empty();
    $("#gallery-item").hide();
    $("#gallery-item-image").empty();
    $("#gallery-back").hide();

    closeInfoPopup();
    $("#gallery-info-link").hide();
    $("#gallery-info-prompt-section").hide();
    $("#gallery-info-negative-prompt-section").hide();
    $("#gallery-info-resources-section").hide();
    $("#gallery-info-prompt").empty();
    $("#gallery-info-negative-prompt").empty();
    $("#gallery-info-resources").empty();
}

async function render() {
    resetViews();

    const uuid = location.hash.substring(1);
    const node = uuid? await Node.getByUUID(uuid): null;

    if (!node) {
        $("#gallery-title").text("");
        $("title").text("Gallery");
        return showMessage("This gallery no longer exists.");
    }

    if (node.type === NODE_TYPE_ARCHIVE)
        return renderItem(node);

    return renderGrid(node);
}

async function renderGrid(node) {
    $("#gallery-title").text(node.name || "");
    $("title").text(node.name? `Gallery: ${node.name}`: "Gallery");

    const subtree = await Query.fullSubtree(node.id, true);
    const images = subtree.filter(n => n.type === NODE_TYPE_ARCHIVE);

    if (!images.length)
        return showMessage("This gallery is empty.");

    const grid = $("#gallery-grid").show();
    const template = document.getElementById("gallery-thumbnail-template");
    const pending = new Map();

    // the stored thumbnail is a small node icon and would be blurry at this size, so the grid draws the full image
    const loadTile = element => {
        const image = pending.get(element);

        if (!image)
            return;

        pending.delete(element);

        archiveObjectURL(image)
            .then(url => { if (url) $(element).find("img").attr("src", url); })
            .catch(e => console.error(e));
    };

    gridObserver = new IntersectionObserver((entries, observer) => {
        for (const entry of entries)
            if (entry.isIntersecting) {
                observer.unobserve(entry.target);
                loadTile(entry.target);
            }
    }, {rootMargin: "300px"});

    for (const image of images) {
        const anchor = $(template.content.cloneNode(true).querySelector("a"));

        anchor.find("img").attr("title", image.name || "");
        anchor.attr("href", "#" + image.uuid);
        grid.append(anchor);

        pending.set(anchor[0], image);
        gridObserver.observe(anchor[0]);
    }
}

async function renderItem(node) {
    const metadata = await readMetadata(node);

    $("#gallery-title").text(node.name || "");
    $("title").text(node.name || "Gallery");
    $("#gallery-item").show();

    const parent = await Node.get(node.parent_id);

    if (parent?.uuid) {
        $("#gallery-back")
            .attr("href", "#" + parent.uuid)
            .text("← " + (parent.name || "Gallery"))
            .show();
    }

    const url = await archiveObjectURL(node);

    if (url) {
        const image = $("<img/>").attr("alt", node.name || "").attr("src", url);

        // the stored image links back to the page it was taken from
        if (node.uri)
            $("#gallery-item-image").append($("<a/>")
                .attr("href", node.uri).attr("target", "_blank").attr("rel", "noreferrer noopener").append(image));
        else
            $("#gallery-item-image").append(image);
    }
    else
        showMessage("No image is stored for this item.");

    // the prompt, negative prompt and resources are shown in the "Image Info" popup rather than on the page itself;
    // the link that opens it is only shown when there is at least one of them to show
    let hasInfo = false;

    if (metadata.prompt) {
        $("#gallery-info-prompt").text(metadata.prompt);
        $("#gallery-info-prompt-section").show();
        hasInfo = true;
    }

    if (metadata.negative_prompt) {
        $("#gallery-info-negative-prompt").text(metadata.negative_prompt);
        $("#gallery-info-negative-prompt-section").show();
        hasInfo = true;
    }

    const resources = normalizeResources(metadata.resources);

    if (resources.length) {
        const container = $("#gallery-info-resources");
        const template = document.getElementById("gallery-resource-template");

        for (const resource of resources) {
            const row = $(template.content.cloneNode(true).querySelector(".gallery-resource"));
            const link = row.find("a");

            link.text(resource.name || resource.url || "");

            // a resource without an address is plain text
            if (resource.url)
                link.attr("href", resource.url);
            else
                link.replaceWith($("<span/>").text(resource.name || ""));

            container.append(row);
        }

        $("#gallery-info-resources-section").show();
        hasInfo = true;
    }

    if (hasInfo)
        $("#gallery-info-link").show();
}
