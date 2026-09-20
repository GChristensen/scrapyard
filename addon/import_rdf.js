import {helperApp} from "./helper_app.js";
import {
    ARCHIVE_TYPE_FILES,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_FOLDER,
    NODE_TYPE_SEPARATOR,
    RDF_EXTERNAL_TYPE
} from "./storage.js";
import {ProgressCounter} from "./utils.js";
import {send, sendLocal} from "./proxy.js";
import {Folder} from "./bookmarks_folder.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import {Archive, Comments, Node} from "./storage_entities.js";
import {StreamImporterBuilder} from "./import_drivers.js";
import {BACKEND_REQUIRED_MESSAGE, RDF_BACKEND_VERSION} from "./plugin_rdf_shelf.js";
import {settings} from "./settings.js";

class RDFImporter {
    #options;
    #nodeID_SB2SY = new Map();
    #nodeID_SY2SB = new Map();
    #shelf;
    #bookmarks = [];
    #cancelled = false;
    #progressCounter;
    #threadCount;
    #sidebarSender;
    #importType = "full";

    #Bookmark = Bookmark;
    #Folder = Folder;

    constructor(importOptions) {
        this.#options = importOptions;
        this.#sidebarSender = importOptions.sidebarContext? sendLocal: send;

        if (importOptions.quick) {
            this.#Bookmark = Bookmark.idb;
            this.#Folder = Folder.idb;
            this.#importType = "index";
        }
    }

    async import() {
        const helper = await helperApp.probe(true);

        if (helper) {
            // the tree is read by the backend, an older one would only answer with a 404
            // that would be reported as a missing RDF file
            if (!await helperApp.hasVersion(RDF_BACKEND_VERSION, BACKEND_REQUIRED_MESSAGE))
                return Promise.reject(new Error(BACKEND_REQUIRED_MESSAGE));

            const path = this.#options.stream.replace(/\\/g, "/");
            const rdfDirectory = path.substring(0, path.lastIndexOf("/"));
            const tree = await this.#getRDFTree(path, rdfDirectory);

            if (!tree)
                return Promise.reject(new Error("RDF file not found."));

            await this.#buildBookmarkTree(path, tree);
            await this.#importArchives(rdfDirectory);
        }
    }

    // the tree is resolved by the backend, which also keeps the importer free of XML parsing
    // that is unavailable in a MV3 service worker
    #traverseRDFTree(tree, visitor, data) {
        async function doTraverse(parent, children) {
            for (const node of children) {
                await visitor(parent, node, data);

                if (node.children)
                    await doTraverse(node, node.children);
            }
        }

        return doTraverse(null, tree.children || []);
    }

    async #getRDFTree(rdfFile, rdfDirectory) {
        try {
            // the directory is passed along, as the icons of the items are fetched from it afterwards
            const response = await helperApp.postJSON("/rdf/index/read",
                {rdf_file: rdfFile, rdf_directory: rdfDirectory});

            if (response.ok)
                return response.json();

            console.error(await helperApp.errorFromResponse(response));
        } catch (e) {
            console.error(e);
        }
    }

    async #buildBookmarkTree(path, tree) {
        this.#shelf = await this.#createShelf(path);

        await this.#traverseRDFTree(tree, this.#createBookmark.bind(this), {pos: 0});
    }

    async #importArchives(path) {
        let cancelListener = (message, sender, sendResponse) => {
            if (message.type === "cancelRdfImport")
                this.#cancelled = true;
        };
        browser.runtime.onMessage.addListener(cancelListener);

        try {
            if (this.#options.createIndex) { // createIndex is always on when performing a full import
                this.#progressCounter =
                    new ProgressCounter(this.#bookmarks.length, "rdfImportProgress", {muteSidebar: true});
                await this.#startThreads(this.#importThread.bind(this, path), this.#options.threads);
            }
            else
                await this.#onFinish();
        } finally {
            browser.runtime.onMessage.removeListener(cancelListener);
        }
    }

    async #startThreads(threadf, maxThreads) {
        const bookmarks = [...this.#bookmarks];
        this.#threadCount = Math.min(maxThreads, this.#bookmarks.length);

        const promises = [];
        for (let i = 0; i < maxThreads; ++i)
            promises.push(threadf(bookmarks));

        return Promise.all(promises);
    }

    async #importThread(path, bookmarks) {
        if (bookmarks.length && !this.#cancelled) {
            let bookmark = bookmarks.shift();

            try {
                let scrapbookId = this.#nodeID_SY2SB.get(bookmark.id);
                await this.#importRDFArchive(path, bookmark, scrapbookId);
            } catch (e) {
                send.rdfImportError({bookmark: bookmark, error: e.message});
            }

            this.#progressCounter.incrementAndNotify();

            return this.#importThread(path, bookmarks);
        }
        else {
            this.#threadCount -= 1;
            if (this.#threadCount === 0)
                return this.#onFinish();
        }
    }

    async #importRDFArchive(path, node, scrapbookId) {
        const params = {
            data_path: helperApp.dataPath(),
            rdf_archive_path: path,
            uuid: node.uuid,
            scrapbook_id: scrapbookId
        };

        try {
            const url = `/rdf/import/archive?type=${this.#importType}`;
            const response = await helperApp.fetchJSON_postJSON(url, params);

            if (response?.size) {
                node.size = response.size;
                await Node.update(node);
            }

            if (response?.archive_index)
                Archive.idb.import.storeIndex(node, response.archive_index);
        } catch (e) {
            console.error(e);
        }
    }

    async #onFinish() {
        this.#sidebarSender.nodesImported({shelf: this.#shelf});

        if (this.#options.createIndex)
            this.#progressCounter.finish();

        send.obtainingIcons({shelf: this.#shelf});
        await this.#startThreads(this.#iconImportThread.bind(this), this.#options.threads);
    }

    async #iconImportThread(bookmarks) {
        if (bookmarks.length && !this.#cancelled) {
            let bookmark = bookmarks.shift();

            if (bookmark.icon && bookmark.icon.startsWith("resource://scrapbook/")) {
                bookmark.icon = bookmark.icon.replace("resource://scrapbook/", "");
                bookmark.icon = await helperApp.signedURL(`/rdf/import/files/${bookmark.icon}`);
                await this.#Bookmark.storeIcon(bookmark);
            }

            return this.#iconImportThread(bookmarks);
        }
        else {
            this.#threadCount -= 1;
            if (this.#threadCount === 0)
                this.#sidebarSender.nodesReady({shelf: this.#shelf});
        }
    }

    async #createShelf(path) {
        const shelfNode = await this.#Folder.getOrCreateByPath(this.#options.name);

        if (shelfNode) {
            if (this.#options.quick) {
                shelfNode.external = RDF_EXTERNAL_TYPE;
                shelfNode.uri = path.substring(0, path.lastIndexOf("/"));
                await Node.idb.update(shelfNode);
            }
            this.#nodeID_SB2SY.set(null, shelfNode.id);
        }

        return shelfNode;
    }

    async #createBookmark(parent, node, vars) {
        const now = new Date();

        let data = {
            pos: vars.pos++,
            uri: node.__sb_source,
            name: node.__sb_title,
            type: node.__sb_type === "folder"
                ? NODE_TYPE_FOLDER
                : (node.__sb_type === "separator"
                    ? NODE_TYPE_SEPARATOR
                    : NODE_TYPE_ARCHIVE),
            parent_id: parent ? this.#nodeID_SB2SY.get(parent.__sb_id) : this.#shelf.id,
            todo_state: node.__sb_type === "marked" ? 1 : undefined,
            contains: ARCHIVE_TYPE_FILES,
            content_type: "text/html",
            has_comments: node.__sb_comment? true: undefined,
            icon: node.__sb_icon,
            date_added: now,
            date_modified: now
        };

        if (this.#options.quick) {
            data.external = RDF_EXTERNAL_TYPE;
            data.external_id = node.__sb_id;
        }

        let bookmark = await this.#Bookmark.import(data);

        if (node.__sb_comment) // commends json file on disk is also created by helper
            await Comments.idb.import.add(bookmark, node.__sb_comment);

        this.#nodeID_SB2SY.set(node.__sb_id, bookmark.id);

        if (data.type === NODE_TYPE_FOLDER)
            this.#nodeID_SB2SY.set(node.__sb_id, bookmark.id);
        else if (data.type === NODE_TYPE_ARCHIVE) {
            this.#nodeID_SY2SB.set(bookmark.id, node.__sb_id);
            this.#bookmarks.push(bookmark);
        }
    }
}

export class RDFImporterBuilder extends StreamImporterBuilder {
    setNumberOfThreads(threads) {
        this._importOptions.threads = threads;
    }

    setQuickImport(quick) {
        this._importOptions.quick = quick;
    }

    setCreateIndex(quick) {
        this._importOptions.createIndex = quick;
    }

    _createImporter(options) {
        return new RDFImporter(options);
    }
}
