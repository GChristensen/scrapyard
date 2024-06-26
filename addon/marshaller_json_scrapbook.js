import {Marshaller, Unmarshaller} from "./marshaller.js";
import {Archive, Comments, Icon, Node, Notes} from "./storage_entities.js";
import {
    ARCHIVE_TYPE_TEXT,
    createJSONScrapBookMeta,
    DEFAULT_SHELF_UUID, EVERYTHING_SHELF_NAME, JSON_SCRAPBOOK_SHELVES,
    JSON_SCRAPBOOK_FORMAT,
    JSON_SCRAPBOOK_VERSION,
    JSON_SCRAPBOOK_TYPE_INDEX,
    NODE_TYPE_BOOKMARK,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_NAMES,
    NODE_TYPES,
    TODO_STATE_NAMES,
    TODO_STATES,
    updateJSONScrapBookMeta
} from "./storage.js";

const SERIALIZED_FIELD_ORDER = [
    "type",
    "uuid",
    "parent",
    "title",
    "url",
    "content_type",
    "contains",
    "size",
    "tags",
    "todo_state",
    "todo_date",
    "todo_pos",
    "details",
    "date_added",
    "date_modified",
    "content_modified",
    "external",
    "external_id",
    "has_icon",
    "has_comments",
    "has_notes",
    "pos"
];

export const FORMAT_DEFAULT_SHELF_UUID = "default";

export class MarshallerJSONScrapbook extends Marshaller {
    configure(options) {
        this._stream = options.stream;
    }

    convertUUIDsToFormat(node) {
        if (node.uuid === DEFAULT_SHELF_UUID)
            node.uuid = FORMAT_DEFAULT_SHELF_UUID;

        if (node.parent && node.parent === DEFAULT_SHELF_UUID)
            node.parent = FORMAT_DEFAULT_SHELF_UUID;
    }

    async convertNode(node) {
        const convertedNode = {...node};

        delete convertedNode.id;
        this._resetNodeDates(convertedNode);

        if (node.parent_id) {
            convertedNode.parent = await Node.getUUIDFromId(node.parent_id);
            delete convertedNode.parent_id;
        }

        if (node.hasOwnProperty("uri")) {
            convertedNode.url = node.uri;
            delete convertedNode.uri;
        }

        if (node.hasOwnProperty("name")) {
            convertedNode.title = node.name;
            delete convertedNode.name;
        }

        if (node.hasOwnProperty("type"))
            convertedNode.type = NODE_TYPE_NAMES[node.type];

        if (convertedNode.icon)
            delete convertedNode.icon;

        if (node.hasOwnProperty("stored_icon")) {
            convertedNode.has_icon = convertedNode.stored_icon;
            delete convertedNode.stored_icon;
        }

        if (node.hasOwnProperty("todo_state"))
            convertedNode.todo_state = TODO_STATE_NAMES[node.todo_state];

        if (node.hasOwnProperty("site")) {
            convertedNode.is_site = node.site;
            delete node.site;
        }

        this.convertUUIDsToFormat(convertedNode);

        return this._reorderFields(convertedNode);
    }

    _resetNodeDates(node) {
        if (node.uuid === DEFAULT_SHELF_UUID) {
            node.date_added = 0;
            node.date_modified = 0;
        }
    }

    _reorderFields(node) {
        const entries = Object.entries(node);
        let orderedEntries = [];

        for (const field of SERIALIZED_FIELD_ORDER) {
            const entry = entries.find(e => e[0] === field);

            if (entry) {
                orderedEntries.push(entry);
                entries.splice(entries.indexOf(entry), 1);
            }
        }

        orderedEntries = [...orderedEntries, ...entries];

        return Object.fromEntries(orderedEntries);
    }

    convertIcon(icon) {
        icon = {...icon};

        delete icon.id;
        delete icon.node_id;

        icon.url = icon.data_url;
        delete icon.data_url;

        return icon;
    }

    convertIndex(index) {
        index = {...index};

        delete index.id;
        delete index.node_id;

        index.content = index.words;
        delete index.words;

        return index;
    }

    async convertArchive(archive) {
        archive = {...archive};

        delete archive.id;
        delete archive.node_id;
        delete archive.type;
        delete archive.byte_length;

        archive.content = archive.object;
        delete archive.object;

        return archive;
    }

    convertNotes(notes) {
        notes = {...notes};

        delete notes.id;
        delete notes.node_id;
        return notes;
    }

    convertComments(text) {
        const comments = {content: text};

        return comments;
    }

    async marshalMeta(options) {
        const {comment, uuid, objects, name} = options;
        const contains = name === EVERYTHING_SHELF_NAME? JSON_SCRAPBOOK_SHELVES: undefined;
        const meta = createJSONScrapBookMeta("export", contains, name);

        updateJSONScrapBookMeta(meta, objects.length, uuid, comment);
        this.convertUUIDsToFormat(meta);

        if (comment)
            meta.comment = comment;

        await this._stream.append(JSON.stringify(meta));
    }

    async marshal(object) {
        const content = await this.assembleContent(object);
        const output = "\n" + JSON.stringify(content);

        return this._stream.append(output);
    }

    async assembleContent(node) {
        const result = {item: null};

        if (node.type === NODE_TYPE_ARCHIVE) {
            let archive = await Archive.get(node);
            if (archive) {
                archive = await this.serializeArchive(archive);
                result.archive = await this.convertArchive(archive);
            }
        }

        if (node.has_notes) {
            let notes = await Notes.get(node);
            if (notes)
                result.notes = this.convertNotes(notes);
        }

        if (node.has_comments)
            result.comments = this.convertComments(await Comments.get(node));

        if (node.icon && node.stored_icon) {
            const icon = Icon.entity(node, await Icon.get(node));
            result.icon = this.convertIcon(icon);
        }

        node = this.serializeNode(node);
        result.item = await this.convertNode(node);

        return result;
    }
}

export class UnmarshallerJSONScrapbook extends Unmarshaller {
    _stream;
    _nextId = 2;
    _uuidToId = new Map();

    configure(options) {
        this._stream = options.stream;
        this._uuidToId.set(DEFAULT_SHELF_UUID, 1);
    }

    convertUUIDsFromFormat(node) {
        if (node.uuid === FORMAT_DEFAULT_SHELF_UUID)
            node.uuid = DEFAULT_SHELF_UUID;

        if (node.parent && node.parent === FORMAT_DEFAULT_SHELF_UUID)
            node.parent = DEFAULT_SHELF_UUID;
    }

    unconvertNode(node) {
        const unconvertedNode = {...node};

        this.convertUUIDsFromFormat(unconvertedNode);

        if (node.url)
            unconvertedNode.uri = node.url;
        delete unconvertedNode.url;

        unconvertedNode.name = node.title;
        delete unconvertedNode.title;

        unconvertedNode.type = NODE_TYPES[node.type] || NODE_TYPE_BOOKMARK;

        if (node.todo_state)
            unconvertedNode.todo_state = TODO_STATES[node.todo_state];

        if (unconvertedNode.has_icon)
            unconvertedNode.stored_icon = unconvertedNode.has_icon;
        delete unconvertedNode.has_icon;

        if (node.is_site) {
            unconvertedNode.site = node.is_site;
            delete node.is_site;
        }

        return unconvertedNode;
    }

    unconvertIcon(icon) {
        icon = {...icon};

        icon.data_url = icon.url;
        delete icon.url;

        return icon;
    }

    unconvertIndex(index) {
        index = {...index};

        index.words = index.content;
        delete index.content;

        return index;
    }

    unconvertArchive(node, archive) {
        archive = {...archive};

        archive.type = node.content_type;
        delete archive.content_type;

        archive.object = archive.content;
        delete archive.content;

        if (node.contains && node.contains !== ARCHIVE_TYPE_TEXT)
            archive.byte_length = true;

        return archive;
    }

    unconvertNotes(notes) {
        return notes;
    }

    unconvertComments(comments) {
        comments.text = comments.content;
        delete comments.content;

        return comments;
    }

    async unmarshalMeta() {
        let metaLine = await this._stream.read();

        if (!metaLine)
            throw new Error("Invalid file format.");

        metaLine = metaLine.replace(/^\[/, "");
        metaLine = metaLine.replace(/,$/, "");
        const meta = JSON.parse(metaLine);

        if (!meta)
            throw new Error("Invalid file format.");

        if (meta.format === JSON_SCRAPBOOK_FORMAT && meta.version > JSON_SCRAPBOOK_VERSION)
            throw new Error("Export format version is not supported.");

        if (meta.type === JSON_SCRAPBOOK_TYPE_INDEX)
            throw new Error("Import of JSON Scrapbook index is not supported.");

        return meta;
    }

    async unmarshal() {
        let input = await this._stream.read();

        if (input) {
            const object = JSON.parse(input);

            await this.unconvertContent(object);

            object.persist = () => this.storeContent(object);
            return object;
        }
    }

    async unconvertContent(object) {
        object.node = await this.unconvertNode(object.item);
        delete object.item;

        this.#findParentInStream(object.node);

        if (object.archive)
            object.archive = await this.unconvertArchive(object.node, object.archive);

        if (object.notes)
            object.notes = this.unconvertNotes(object.notes);

        if (object.comments)
            object.comments = this.unconvertComments(object.comments);

        if (object.icon) {
            object.icon = this.unconvertIcon(object.icon);
            object.node.icon = await Icon.computeHash(object.icon.data_url)
        }

        return object;
    }

    async findParentInIDB(node) {
        if (node.parent) {
            const parent = await Node.getByUUID(node.parent);
            delete node.parent;

            if (parent)
                node.parent_id = parent.id;
            else
                throw new Error(`No parent for node: ${node.uuid}`);
        }
    }

    #findParentInStream(node) {
        node.id = this._nextId++;
        this._uuidToId.set(node.uuid, node.id);

        if (node.parent) {
            node.parent_id = this._uuidToId.get(node.parent) || 1;
            delete node.parent;
        }
    }
}
