export const NODE_TYPE_SHELF = 1;
export const NODE_TYPE_GROUP = 2;
export const NODE_TYPE_BOOKMARK = 3;
export const NODE_TYPE_ARCHIVE = 4;
export const NODE_TYPE_SEPARATOR = 5;
export const NODE_TYPE_NOTES = 6;

export const ENDPOINT_TYPES = [NODE_TYPE_ARCHIVE, NODE_TYPE_BOOKMARK, NODE_TYPE_NOTES];
export const CONTAINER_TYPES = [NODE_TYPE_SHELF, NODE_TYPE_GROUP];

export const TODO_STATE_TODO = 1;
export const TODO_STATE_DONE = 4;
export const TODO_STATE_WAITING = 2;
export const TODO_STATE_POSTPONED = 3;
export const TODO_STATE_CANCELLED = 5;

export const TODO_NAMES = {
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
export const EVERYTHING_SHELF = -1;
export const DONE_SHELF = -2;
export const TODO_SHELF = -3;
export const FIREFOX_SHELF_ID = -4;
export const CLOUD_SHELF_ID = -5;

export const TODO_NAME = "TODO";
export const DONE_NAME = "DONE";

export const EVERYTHING = "everything";
export const DEFAULT_SHELF_NAME = "default";

export const FIREFOX_SHELF_NAME = "firefox";
export const FIREFOX_SHELF_UUID = "browser_bookmarks";
export const FIREFOX_BOOKMARK_MENU = "menu________";
export const FIREFOX_BOOKMARK_UNFILED = "unfiled_____";
export const FIREFOX_BOOKMARK_TOOLBAR = "toolbar_____";
export const FIREFOX_BOOKMARK_MOBILE = "mobile______"

export const CLOUD_SHELF_NAME = "cloud";
export const CLOUD_EXTERNAL_NAME = "cloud";

export const RDF_EXTERNAL_NAME = "rdf";

export const SPECIAL_UUIDS = [FIREFOX_SHELF_UUID, CLOUD_EXTERNAL_NAME];

export const DEFAULT_POSITION = 2147483647;

export const NODE_PROPERTIES =
    ["id",
        "pos",
        "uri",
        "name",
        "type",
        "uuid",
        "icon",
        "tags",
        "tag_list",
        "details",
        "parent_id",
        "todo_date",
        "todo_state",
        "date_added",
        "date_modified",
        "stored_icon",
        "has_notes",
        "external",
        "external_id"
    ];

export function isContainer(node) {
    return node && CONTAINER_TYPES.some(t => t == node.type);
}

export function isEndpoint(node) {
    return node && ENDPOINT_TYPES.some(t => t == node.type);
}

export function isSpecialShelf(name) {
    name = name.toLocaleUpperCase();
    return name === DEFAULT_SHELF_NAME.toLocaleUpperCase()
        || name === FIREFOX_SHELF_NAME.toLocaleUpperCase()
        || name === CLOUD_SHELF_NAME.toLocaleUpperCase()
        || name === EVERYTHING.toLocaleUpperCase()
        || name === TODO_NAME.toLocaleUpperCase()
        || name === DONE_NAME.toLocaleUpperCase();
}