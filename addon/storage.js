export const NODE_TYPE_SHELF = 1;
export const NODE_TYPE_FOLDER = 2;
export const NODE_TYPE_BOOKMARK = 3;
export const NODE_TYPE_ARCHIVE = 4;
export const NODE_TYPE_SEPARATOR = 5;
export const NODE_TYPE_NOTES = 6;
export const NODE_TYPE_UNLISTED = 7;
export const NODE_TYPE_FILE = 8;

export const NODE_TYPE_NAMES = {
    [NODE_TYPE_SHELF]: "shelf",
    [NODE_TYPE_FOLDER]: "folder",
    [NODE_TYPE_BOOKMARK]: "bookmark",
    [NODE_TYPE_ARCHIVE]: "archive",
    [NODE_TYPE_SEPARATOR]: "separator",
    [NODE_TYPE_NOTES]: "notes",
    [NODE_TYPE_FILE]: "file"
};

export const NODE_TYPES = {
    "shelf": NODE_TYPE_SHELF,
    "folder": NODE_TYPE_FOLDER,
    "bookmark": NODE_TYPE_BOOKMARK,
    "archive": NODE_TYPE_ARCHIVE,
    "separator": NODE_TYPE_SEPARATOR,
    "notes": NODE_TYPE_NOTES,
    "file": NODE_TYPE_FILE
};

export const CONTAINER_NODE_TYPES = [NODE_TYPE_SHELF, NODE_TYPE_FOLDER, NODE_TYPE_UNLISTED];
export const CONTENT_NODE_TYPES = [NODE_TYPE_ARCHIVE, NODE_TYPE_BOOKMARK, NODE_TYPE_NOTES, NODE_TYPE_FILE];

export const TODO_STATE_TODO = 1;
export const TODO_STATE_DONE = 4;
export const TODO_STATE_WAITING = 2;
export const TODO_STATE_POSTPONED = 3;
export const TODO_STATE_CANCELLED = 5;

export const TODO_STATE_NAMES = {
    [TODO_STATE_TODO]: "TODO",
    [TODO_STATE_WAITING]: "WAITING",
    [TODO_STATE_POSTPONED]: "POSTPONED",
    [TODO_STATE_CANCELLED]: "CANCELLED",
    [TODO_STATE_DONE]: "DONE"
};

export const TODO_STATES = {
    "TODO": TODO_STATE_TODO,
    "WAITING": TODO_STATE_WAITING,
    "POSTPONED": TODO_STATE_POSTPONED,
    "CANCELLED": TODO_STATE_CANCELLED,
    "DONE": TODO_STATE_DONE
};

export const DEFAULT_SHELF_ID = 1;
export const EVERYTHING_SHELF_ID = -1;
export const DONE_SHELF_ID = -2;
export const TODO_SHELF_ID = -3;
export const BROWSER_SHELF_ID = -4;
export const CLOUD_SHELF_ID = -5;
export const FILES_SHELF_ID = -6;

export const TODO_SHELF_NAME = "TODO";
export const TODO_SHELF_UUID = TODO_SHELF_NAME;
export const DONE_SHELF_NAME = "DONE";
export const DONE_SHELF_UUID = DONE_SHELF_NAME;

export const EVERYTHING_SHELF_NAME = "everything";
export const EVERYTHING_SHELF_UUID = "everything";

export const DEFAULT_SHELF_NAME = "default";
export const DEFAULT_SHELF_UUID = "1";

export const BROWSER_SHELF_NAME = "browser";
export const BROWSER_SHELF_UUID = "browser_bookmarks";
export const BROWSER_EXTERNAL_TYPE = "browser";

export const FIREFOX_BOOKMARK_MENU = "menu________";
export const FIREFOX_BOOKMARK_UNFILED = "unfiled_____";
export const FIREFOX_BOOKMARK_TOOLBAR = "toolbar_____";
export const FIREFOX_BOOKMARK_MOBILE = "mobile______"

export const FIREFOX_SPECIAL_FOLDERS = [FIREFOX_BOOKMARK_MENU, FIREFOX_BOOKMARK_UNFILED, FIREFOX_BOOKMARK_TOOLBAR];

export const CHROME_BOOKMARK_TOOLBAR = "1";
export const CHROME_BOOKMARK_UNFILED = "2";

export const CLOUD_SHELF_NAME = "cloud";
export const CLOUD_SHELF_UUID = "cloud";
export const CLOUD_EXTERNAL_TYPE = "cloud";

export const RDF_EXTERNAL_TYPE = "rdf";

export const FILES_SHELF_NAME = "files";
export const FILES_SHELF_UUID = "files";
export const FILES_EXTERNAL_TYPE = "files";
export const FILES_EXTERNAL_ROOT_PREFIX = "files-root-";

export const NON_IMPORTABLE_SHELVES = [BROWSER_SHELF_UUID, CLOUD_SHELF_UUID, FILES_SHELF_UUID];

export const NON_SYNCHRONIZED_EXTERNALS = [BROWSER_EXTERNAL_TYPE, CLOUD_EXTERNAL_TYPE, RDF_EXTERNAL_TYPE, FILES_EXTERNAL_TYPE];

export const DEFAULT_POSITION = 2147483647;

export const UNDO_DELETE = 1;
export const UNDO_REORDER = 2;

export const NODE_PROPERTIES =
    ["id",
     "pos",
     "uri",
     "name",
     "type",
     "size",
     "uuid",
     "icon",
     "tags",
     "tag_list",
     "details",
     "parent_id",
     "todo_date",
     "todo_state",
     "todo_pos",
     "date_added",
     "date_modified",
     "content_modified",
     "stored_icon",
     "has_notes",
     "has_comments",
     "external",
     "external_id",
     "container",
     "content_type",
     "contains",
     "encoding",
     "_unlisted",
     "site",
     "gallery"
    ];

export function isContainerNode(node) {
    return node && CONTAINER_NODE_TYPES.some(t => t == node.type);
}

export function isContentNode(node) {
    return node && CONTENT_NODE_TYPES.some(t => t == node.type);
}

export function nodeHasSomeContent(node) {
    return node.type === NODE_TYPE_ARCHIVE || node.stored_icon || node.has_notes || node.has_comments;
}

const VIRTUAL_SHELVES = [
    EVERYTHING_SHELF_NAME,
    TODO_SHELF_NAME,
    DONE_SHELF_NAME,
].map(s => s.toLocaleLowerCase());

export function isVirtualShelf(name) {
    name = name?.toLocaleLowerCase();

    return VIRTUAL_SHELVES.some(s => s === name);
}

const BUILTIN_SHELVES = [
    EVERYTHING_SHELF_NAME,
    TODO_SHELF_NAME,
    DONE_SHELF_NAME,
    DEFAULT_SHELF_NAME,
    BROWSER_SHELF_NAME,
    CLOUD_SHELF_NAME,
    FILES_SHELF_NAME
].map(s => s.toLocaleLowerCase());

export function isBuiltInShelf(name) {
    name = name?.toLocaleLowerCase();

    return BUILTIN_SHELVES.some(s => s === name);
}

export function getBuiltInShelfName(uuid) {
    switch(uuid) {
        case EVERYTHING_SHELF_UUID:
            return EVERYTHING_SHELF_NAME;
        case DEFAULT_SHELF_UUID:
            return DEFAULT_SHELF_NAME;
        case BROWSER_SHELF_UUID:
            return BROWSER_SHELF_NAME;
        case CLOUD_SHELF_UUID:
            return CLOUD_SHELF_NAME;
        case TODO_SHELF_UUID:
            return TODO_SHELF_NAME;
        case DONE_SHELF_UUID:
            return DONE_SHELF_NAME;
        case FILES_SHELF_UUID:
            return FILES_SHELF_NAME;
    }
}

export function byName(a, b) {
    return a.name?.localeCompare(b.name, undefined, {sensitivity: "base"});
}

export function byPosition(a, b) {
    let a_pos = a.pos === undefined? DEFAULT_POSITION: a.pos;
    let b_pos = b.pos === undefined? DEFAULT_POSITION: b.pos;
    return a_pos - b_pos;
}

export function byTODOPosition(a, b) {
    let a_pos = a.todo_pos === undefined? 0: a.todo_pos;
    let b_pos = b.todo_pos === undefined? 0: b.todo_pos;
    return a_pos - b_pos;
}

export function byDateAddedDesc(a, b) {
    if (a.date_added && b.date_added)
        return b.date_added - a.date_added;

    return 0;
}

export function byDateAddedAsc(a, b) {
    if (a.date_added && b.date_added)
        return a.date_added - b.date_added;

    return 0;
}

export function byContainer(a, b) {
    const ac = isContainerNode(a)? 0: 1;
    const bc = isContainerNode(b)? 0: 1;

    return ac - bc;
}

export const JSON_SCRAPBOOK_FORMAT = "JSON Scrapbook";
export const JSON_SCRAPBOOK_VERSION = 1;
export const JSON_SCRAPBOOK_SHELVES = "shelves";
export const JSON_SCRAPBOOK_FOLDERS = "folders";
export const JSON_SCRAPBOOK_TYPE_INDEX = "index";

export function createJSONScrapBookMeta(type, contains = JSON_SCRAPBOOK_SHELVES, title) {
    const now = new Date();

    return {
        format: JSON_SCRAPBOOK_FORMAT,
        version: JSON_SCRAPBOOK_VERSION,
        type: type,
        contains: contains,
        title: title,
        uuid: undefined,
        entities: undefined,
        timestamp: now.getTime(),
        date: now.toISOString()
    };
}

export function updateJSONScrapBookMeta(meta, entities, uuid, comment) {
    if (uuid)
        meta.uuid = uuid;

    meta.entities = entities;

    const now = new Date();
    meta.timestamp = now.getTime();
    meta.date = now.toISOString();

    if (comment)
        meta.comment = comment;
}

export const ARCHIVE_TYPE_BYTES = "bytes";
export const ARCHIVE_TYPE_TEXT = "text";
export const ARCHIVE_TYPE_FILES = "files";

export const UNPACKED_ARCHIVE_DIRECTORY = "archive";

export const STORAGE_POPULATED = "populated";
