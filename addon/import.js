import {
    BROWSER_SHELF_ID,
    CLOUD_SHELF_ID,
    DEFAULT_SHELF_NAME,
    DONE_SHELF_NAME,
    EVERYTHING_SHELF_NAME, FILES_SHELF_ID,
    RDF_EXTERNAL_TYPE,
    TODO_SHELF_NAME
} from "./storage.js";
import {Query} from "./storage_query.js";
import {TODO} from "./bookmarks_todo.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import {MarshallerORG, UnmarshallerORG} from "./marshaller_org.js";
import {NetscapeImporterBuilder} from "./import_html.js";
import {RDFImporterBuilder} from "./import_rdf.js";
import {StreamExporterBuilder, StreamImporterBuilder, StructuredStreamImporterBuilder} from "./import_drivers.js";
import {undoManager} from "./bookmarks_undo.js";
import {Database} from "./storage_database.js";
import {DiskStorage} from "./storage_external.js";
import {MarshallerJSONScrapbook, UnmarshallerJSONScrapbook} from "./marshaller_json_scrapbook.js";

export class Export {
    static create(format) {
        switch (format) {
            case "json":
                return new StreamExporterBuilder(new MarshallerJSONScrapbook());
            case "org":
                return new StreamExporterBuilder(new MarshallerORG());
        }
    }

    // get nodes of the specified shelf for export
    static async nodes(shelf, computeLevel) {
        const isShelfName = typeof shelf === "string";
        let nodes;

        if (isShelfName && shelf.toUpperCase() === TODO_SHELF_NAME) {
            nodes = await TODO.listTODO();

            if (computeLevel)
                nodes.forEach(n => n.__level = 1)

            return nodes;
        }
        else if (isShelfName && shelf.toUpperCase() === DONE_SHELF_NAME) {
            nodes = await TODO.listDONE();

            if (computeLevel)
                nodes.forEach(n => n.__level = 1)

            return nodes;
        }

        const everything = isShelfName && shelf === EVERYTHING_SHELF_NAME;

        if (!everything && isShelfName)
            shelf = await Query.shelf(shelf);

        let level = computeLevel? (everything? 1: 0): undefined;

        if (everything) {
            const shelves = await Query.allShelves();
            const cloud = shelves.find(s => s.id === CLOUD_SHELF_ID);

            if (cloud)
                shelves.splice(shelves.indexOf(cloud), 1);

            const browser = shelves.find(s => s.id === BROWSER_SHELF_ID);
            if (browser)
                shelves.splice(shelves.indexOf(browser), 1);

            const files = shelves.find(s => s.id === FILES_SHELF_ID);
            if (files)
                shelves.splice(shelves.indexOf(files), 1);

            const openRDFShelves = shelves.filter(n => n.external === RDF_EXTERNAL_TYPE);
            for (const node of openRDFShelves)
                shelves.splice(shelves.indexOf(node), 1);

            nodes = await Query.fullSubtree(shelves.map(s => s.id), true, level);
        }
        else {
            nodes = await Query.fullSubtree(shelf.id,true, level);
            nodes.shift();
        }

        return nodes;
    }
}

export class Import {
    static create(format) {
        switch (format) {
            case "json":
            case "jsonl":
            case "jsbk":
                return new StructuredStreamImporterBuilder(new UnmarshallerJSONScrapbook());
            case "org":
                return new StreamImporterBuilder(new UnmarshallerORG());
            case "html":
                return new NetscapeImporterBuilder(null);
            case "rdf":
                return new RDFImporterBuilder(null);
        }
    }

    static async prepare(shelf) {
        try {
            await undoManager.commit();
        } catch (e) {
            console.error(e);
        }

        if (shelf === EVERYTHING_SHELF_NAME) {
            await Database.wipeImportable();
            await DiskStorage.wipeStorage();
        }
        else {
            shelf = await Query.shelf(shelf);

            if (shelf && shelf.name === DEFAULT_SHELF_NAME) {
                return Bookmark.deleteChildren(shelf.id);
            } else if (shelf) {
                return Bookmark.delete(shelf.id);
            }
        }
    }

    static async transaction(importer) {
        try {
            await DiskStorage.openBatchSession();
            // awaited, so the session is not closed before the import is finished
            return await importer.import();
        }
        finally {
            await DiskStorage.closeBatchSession();
        }
    }
}



