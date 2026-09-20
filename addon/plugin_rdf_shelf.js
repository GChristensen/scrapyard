import UUID from "./uuid.js";
import {helperApp} from "./helper_app.js";
import {
    ARCHIVE_TYPE_FILES,
    isContainerNode,
    isRDFStorableNode,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_FOLDER,
    NODE_TYPE_NAMES,
    NODE_TYPE_SEPARATOR,
    RDF_EXTERNAL_TYPE
} from "./storage.js";
import {Comments, Icon, Node} from "./storage_entities.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import {Path} from "./path.js";
import {CONTENT_TYPE_TO_EXT} from "./utils.js";
import {showNotification} from "./utils_browser.js";

// the backend version that performs the RDF index operations
export const RDF_BACKEND_VERSION = "2.3";

export const BACKEND_REQUIRED_MESSAGE =
    "The backend application v2.3 or above is required to read and modify RDF archives.";

const UNSUPPORTED_ITEM_MESSAGE =
    "Only archived pages, folders and separators could be stored in an RDF archive.";

// names the items that stopped an operation, as a folder may hold thousands of items
function unsupportedItemsError(items) {
    const named = items.slice(0, 3)
        .map(n => `"${n.name || n.uri || "untitled"}" (${NODE_TYPE_NAMES[n.type] || "item"})`);
    const more = items.length > named.length? ` and ${items.length - named.length} more`: "";

    return rdfError(`${UNSUPPORTED_ITEM_MESSAGE} Not supported: ${named.join(", ")}${more}.`);
}

const SCRAPBOOK_FOLDER_TYPE = "folder";
const SCRAPBOOK_SEPARATOR_TYPE = "separator";

// ScrapBook item ids are timestamps with a resolution of one second, so a burst of items
// created within the same second (copying a subtree) would otherwise receive the same id
let lastIssuedId = null;

function nextItemId() {
    let id = UUID.date();

    if (lastIssuedId && id <= lastIssuedId) {
        const previous = UUID.getDate(lastIssuedId);
        previous.setSeconds(previous.getSeconds() + 1);
        id = UUID.date(previous);
    }

    lastIssuedId = id;
    return id;
}

// the RDF plugin reports its failures, as an unnoticed one would leave the sidebar
// showing a change that never reached the RDF file
function rdfError(message, notify = true) {
    if (notify)
        showNotification(message);

    const error = new Error(message);
    error.name = "EScrapyardPluginError";

    return error;
}

// Throws unless a backend that understands the RDF index operations is available. The two conditions
// are checked apart so that an unavailable backend is not reported as an outdated one, and the result
// of hasVersion is not relied upon to report anything: a connection lost while it is checking makes it
// return no verdict at all, which must not pass for a silent success.
export async function checkRDFBackend() {
    // probe words the failure for the server mode as well
    if (!await helperApp.probe(true))
        throw rdfError("The backend application is not available.", false);

    if (!await helperApp.hasVersion(RDF_BACKEND_VERSION))
        throw rdfError(BACKEND_REQUIRED_MESSAGE);
}

function scrapbookType(node) {
    if (node.type === NODE_TYPE_FOLDER)
        return SCRAPBOOK_FOLDER_TYPE;
    else if (node.type === NODE_TYPE_SEPARATOR)
        return SCRAPBOOK_SEPARATOR_TYPE;

    return "";
}

async function loadNodeIcon(node) {
    node.__icon_data_url = await Icon.get(node);

    if (!node.__icon_data_url)
        return "";

    const mimeType = node.__icon_data_url.match(/data:([^;]+)/)?.[1];
    node.__icon_ext = mimeType && CONTENT_TYPE_TO_EXT[mimeType] || "ico";

    return `resource://scrapbook/data/${node.external_id}/favicon.${node.__icon_ext}`;
}

// the representation of a node in the RDF index
async function itemOf(node, parent) {
    const type = scrapbookType(node);

    return {
        id: node.external_id,
        parent_id: parent?.external_id || null,
        type,
        title: node.name || "",
        source: node.uri || "",
        // ScrapBook stores the charset of archived pages only
        chars: type? "": "UTF-8",
        icon: node.stored_icon? await loadNodeIcon(node): "",
        comment: node.has_comments? (await Comments.get(node)) || "": ""
    };
}

// The index is modified by the backend rather than here: the browser needs no XML support
// (unavailable in a MV3 service worker), and the whole read-modify-write is performed there
// while the file is locked, so concurrent changes can not overwrite each other.
class RDFIndex {
    static async #rdfFile(node) {
        const path = await Path.compute(node);
        return `${path[0].uri}/scrapbook.rdf`;
    }

    static async #request(node, path, params) {
        await checkRDFBackend();

        const rdf_file = await this.#rdfFile(node);
        let response;

        try {
            response = await helperApp.postJSON(path, {rdf_file, ...params});
        }
        catch (e) {
            throw rdfError(`Can not access the RDF archive: ${e.message}`);
        }

        if (!response.ok) {
            const error = await helperApp.errorFromResponse(response);
            throw rdfError(`Can not modify the RDF archive: ${error.message}`);
        }

        return response;
    }

    static #modify(node, operation, params) {
        return this.#request(node, `/rdf/index/${operation}`, params);
    }

    static createItems(node, items) {
        return this.#modify(node, "create_items", {items});
    }

    static updateItem(node, id, fields) {
        return this.#modify(node, "update_item", {id, fields});
    }

    static deleteItems(node, ids) {
        return this.#modify(node, "delete_items", {ids});
    }

    static moveItems(node, ids, destId) {
        return this.#modify(node, "move_items", {ids, dest_id: destId || null});
    }

    static reorderItems(node, ids) {
        return this.#modify(node, "reorder_items", {ids});
    }
}

export class RDFShelfPlugin {
    constructor() {
    }

    async createBookmarkFolder(node, parent) {
        return this.#createNode(node, parent);
    }

    async createBookmark(node, parent) {
        return this.#createNode(node, parent);
    }

    async #createNode(node, parent) {
        node.external = RDF_EXTERNAL_TYPE;
        node.external_id = nextItemId();

        if (node.type === NODE_TYPE_ARCHIVE)
            node.contains = ARCHIVE_TYPE_FILES;

        await Node.update(node);
        await RDFIndex.createItems(parent, [await itemOf(node, parent)]);
    }

    async renameBookmark(node) {
        // the shelf itself is not an item of the RDF file, only its directory is named by it
        if (!node.external_id)
            return;

        return RDFIndex.updateItem(node, node.external_id, {title: node.name});
    }

    async updateBookmark(node) {
        if (!node.external_id)
            return;

        const fields = {
            title: node.name || "",
            source: node.uri || "",
            comment: node.has_comments? (await Comments.get(node)) || "": ""
        };

        return RDFIndex.updateItem(node, node.external_id, fields);
    }

    async reorderBookmarks(nodes) {
        const rdfNodes = nodes.filter(n => n.external === RDF_EXTERNAL_TYPE && n.external_id);

        if (rdfNodes.length)
            await RDFIndex.reorderItems(rdfNodes[0], rdfNodes.map(n => n.external_id));
    }

    async deleteBookmarks(nodes) {
        if (nodes.some(n => n.external === RDF_EXTERNAL_TYPE && !n.external_id))
            return; // the shelf itself is only closed, the RDF file is left intact

        const rdfNodes = nodes.filter(n => n.external === RDF_EXTERNAL_TYPE && n.external_id);

        if (!rdfNodes.length)
            return;

        await RDFIndex.deleteItems(rdfNodes[0], rdfNodes.map(n => n.external_id));

        for (const node of rdfNodes)
            if (node.type === NODE_TYPE_ARCHIVE)
                await this.#deleteArchiveDirectory(node);
    }

    async moveBookmarks(dest, nodes) {
        const rdfNodes = nodes.filter(n => n.external === RDF_EXTERNAL_TYPE);
        const foreignNodes = nodes.filter(n => n.external !== RDF_EXTERNAL_TYPE);

        if (dest.external === RDF_EXTERNAL_TYPE) {
            // the whole selection is checked before anything is moved, so an item that can not
            // be stored in a ScrapBook archive does not leave the operation half performed
            await this.#checkStorable(foreignNodes);

            if (rdfNodes.length)
                await RDFIndex.moveItems(dest, rdfNodes.map(n => n.external_id), dest.external_id);

            for (const node of foreignNodes)
                await this.#adopt(dest, node);
        }
        else
            for (const node of rdfNodes)
                await this.#release(dest, node);
    }

    // the new nodes have been added by the copy operation already, they only need
    // their entries in the index and the files of their archives
    async copyBookmarks(dest, nodes) {
        if (dest.external !== RDF_EXTERNAL_TYPE)
            return;

        for (const node of nodes) {
            const items = [];
            const archives = [];

            // the traversal is depth first, so a folder is always created before its children
            await Bookmark.traverse(node, async (parent, child) => {
                items.push(await itemOf(child, parent || dest));

                if (child.type === NODE_TYPE_ARCHIVE)
                    archives.push(child);
            });

            await RDFIndex.createItems(dest, items);

            // the content of the copies has been written by the storage layer, the ScrapBook
            // metadata that accompanies it in the item directory has not
            for (const archive of archives)
                await this.storeBookmarkData(archive);
        }
    }

    // Called with the whole selection before the first copy is created. The copies are created one by one, so
    // rejecting an item halfway would leave the copies made so far in the tree and the storage, but absent
    // from the RDF file.
    async validateCopy(dest, nodes) {
        if (dest.external !== RDF_EXTERNAL_TYPE)
            return;

        const unsupported = nodes.filter(n => !isRDFStorableNode(n));

        if (unsupported.length)
            throw unsupportedItemsError(unsupported);
    }

    async beforeBookmarkCopied(dest, node) {
        if (dest.external === RDF_EXTERNAL_TYPE) {
            if (!isRDFStorableNode(node))
                throw rdfError(UNSUPPORTED_ITEM_MESSAGE);

            node.external = RDF_EXTERNAL_TYPE;
            // a copy is a new ScrapBook item even when it stays in the same shelf
            node.external_id = nextItemId();

            if (node.type === NODE_TYPE_ARCHIVE)
                node.contains = ARCHIVE_TYPE_FILES;
        }
        else if (node.external === RDF_EXTERNAL_TYPE) {
            if (dest.external)
                node.external = dest.external;
            else
                delete node.external;

            delete node.external_id;
        }
    }

    async storeBookmarkData(node) {
        const params = {
            rdf_archive_path: await this.getRDFArchiveDir(node),
            scrapbook_id: node.external_id,
            title: node.name || "",
            source: node.uri || ""
        };

        // the page itself has been written through the storage layer, only the ScrapBook
        // metadata and the icon are persisted here
        if (node.__icon_data_url) {
            params.icon_ext = node.__icon_ext || "ico";
            params.icon_data = node.__icon_data_url.split(",")[1];
        }

        try {
            await helperApp.post(`/rdf/persist_archive`, params);
        }
        catch (e) {
            console.error(e);
        }
    }

    async getRDFArchiveDir(node, anchor = node) {
        const path = await Path.compute(anchor);
        return `${path[0].uri}/data/${node.external_id}/`;
    }

    async #checkStorable(nodes) {
        const unsupported = [];

        for (const node of nodes) {
            if (isContainerNode(node))
                await Bookmark.traverse(node, (parent, child) => {
                    if (!isRDFStorableNode(child))
                        unsupported.push(child);
                });
            else if (!isRDFStorableNode(node))
                unsupported.push(node);
        }

        if (unsupported.length)
            throw unsupportedItemsError(unsupported);
    }

    // Moves a node of another shelf into the RDF shelf. The content is transferred before the node
    // is detached from its previous storage, so a failed transfer does not lose it.
    async #adopt(destination, node) {
        if (isContainerNode(node))
            await Bookmark.traverse(node, async (parent, child) => this.#adoptNode(parent || destination, child));
        else
            await this.#adoptNode(destination, node);
    }

    async #adoptNode(parent, node) {
        const source = {...node};

        node.external = RDF_EXTERNAL_TYPE;
        node.external_id = nextItemId();
        // the node is reparented before anything is stored, as the location of its files
        // is derived from the path of the shelf it belongs to
        node.parent_id = parent.id;

        if (node.type === NODE_TYPE_ARCHIVE)
            node.contains = ARCHIVE_TYPE_FILES;

        await RDFIndex.createItems(parent, [await itemOf(node, parent)]);
        await Node.update(node, false, true);

        if (source.type === NODE_TYPE_ARCHIVE)
            await this.#transferArchiveFiles(source, node, parent);

        await Bookmark.copyContent(source, node);
        await Node.unpersist(source);
    }

    // Moves a node of the RDF shelf into another shelf.
    async #release(destination, node) {
        // the path of an item no longer leads to the RDF shelf once it has been reparented,
        // so the node the RDF locations are resolved against is captured beforehand
        const anchor = {...node};

        if (isContainerNode(node))
            await Bookmark.traverse(node, async (parent, child) =>
                this.#releaseNode(parent || destination, child, anchor));
        else
            await this.#releaseNode(destination, node, anchor);
    }

    async #releaseNode(parent, node, anchor) {
        const source = {...node};

        node.external = parent.external;
        node.external_id = undefined;
        // the item is reparented and stored before its content is copied into it: the backend
        // rejects an item whose parent is absent from the index, and the folders of an RDF
        // shelf are never stored there
        node.parent_id = parent.id;

        await Node.update(node, false, true);

        if (source.type === NODE_TYPE_ARCHIVE)
            await this.#transferArchiveFiles(source, node, anchor);

        await Bookmark.copyContent(source, node);

        // the item is removed from the RDF only after its content has been transferred
        await RDFIndex.deleteItems(anchor, [source.external_id]);

        if (source.type === NODE_TYPE_ARCHIVE)
            await this.#deleteArchiveDirectory(source, anchor);
    }

    // The files of an unpacked archive are copied directly between the directories: the storage
    // layer carries the page alone, which would leave the resources of the archive behind.
    async #transferArchiveFiles(source, destination, rdfAnchor) {
        // only one side of a transfer is an RDF item, and it may already have been reparented,
        // so its directory is resolved against the anchor when the caller supplies one
        const location = async node => node.external === RDF_EXTERNAL_TYPE
            ? {kind: "rdf", path: await this.getRDFArchiveDir(node, rdfAnchor || node)}
            : {kind: "scrapyard", uuid: node.uuid};

        const dataPath = helperApp.dataPath();

        // an archive kept in the browser storage has no directory of its own,
        // it is transferred through the storage layer alone
        if (!dataPath && [source, destination].some(n => n.external !== RDF_EXTERNAL_TYPE))
            return;

        try {
            await helperApp.fetchJSON_postJSON("/rdf/transfer_archive", {
                data_path: dataPath,
                source: await location(source),
                destination: await location(destination)
            });
        }
        catch (e) {
            console.error(e);
        }
    }

    async #deleteArchiveDirectory(node, anchor = node) {
        try {
            await helperApp.post(`/rdf/delete_item/${node.uuid}`,
                {rdf_archive_directory: await this.getRDFArchiveDir(node, anchor)});
        }
        catch (e) {
            console.error(e);
        }
    }
}

export let rdfShelf = new RDFShelfPlugin();
