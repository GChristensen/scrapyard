import {send} from "../proxy.js";
import {settings} from "../settings.js";
import {
    isContentNode,
    isBuiltInShelf,
    CLOUD_EXTERNAL_TYPE,
    CONTENT_NODE_TYPES,
    EVERYTHING_SHELF_UUID,
    FIREFOX_BOOKMARK_MENU,
    FIREFOX_BOOKMARK_MOBILE,
    FIREFOX_BOOKMARK_TOOLBAR,
    FIREFOX_BOOKMARK_UNFILED,
    BROWSER_SHELF_ID,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK,
    NODE_TYPE_FOLDER,
    NODE_TYPE_NOTES,
    NODE_TYPE_SEPARATOR,
    NODE_TYPE_SHELF,
    RDF_EXTERNAL_TYPE,
    TODO_STATE_NAMES,
    DEFAULT_SHELF_NAME,
    BROWSER_EXTERNAL_TYPE,
    FILES_EXTERNAL_TYPE,
    FILES_EXTERNAL_ROOT_PREFIX,
    NODE_TYPE_FILE, CHROME_BOOKMARK_UNFILED, CHROME_BOOKMARK_TOOLBAR
} from "../storage.js";
import {isElementInViewport} from "../utils_html.js";
import {getActiveTabFromSidebar, showNotification} from "../utils_browser.js";
import {IMAGE_FORMATS} from "../utils.js";
import {formatShelfName, setBookmarkedActionIcon} from "../bookmarking.js";
import {Bookmark} from "../bookmarks_bookmark.js";
import {Icon} from "../storage_entities.js";
import {DiskStorage, ExternalStorage} from "../storage_external.js";
import {buildContextMenu} from "./tree_context_menu.js";

export const TREE_STATE_PREFIX = "tree-state-";
const FOLDER_SELECT_STATE = "folder-select";
const EXTENDED_TODO_CLASS = "extended-todo";
const DEFAULT_ICON_CLASS = "generic-icon";

// return the original Scrapyard node object stored in a jsTree node
let o = n => n.data;

class BookmarkTree {
    constructor(elementId, foldersOnly = false) {
        this._elementId = elementId;
        this._foldersOnly = foldersOnly;

        let plugins = ["wholerow", "types", "state"];

        if (!foldersOnly)
            plugins = plugins.concat(["contextmenu", "dnd"]);

        const jstree = $(elementId).jstree({
            plugins: plugins,
            core: {
                worker: false,
                animation: 0,
                multiple: !foldersOnly,
                check_callback: this.#checkOperation.bind(this),
                themes: {
                    name: "default",
                    dots: false,
                    icons: true,
                },
            },
            contextmenu: {
                show_at_node: false,
                items: node => this.contextMenu(node)
            },
            types: {
                "#": {
                    "valid_children": [NODE_TYPE_SHELF]
                },
                [NODE_TYPE_SHELF]: {
                    "valid_children": [NODE_TYPE_FOLDER, ...CONTENT_NODE_TYPES, NODE_TYPE_SEPARATOR]
                },
                [NODE_TYPE_FOLDER]: {
                    "valid_children": [NODE_TYPE_FOLDER, ...CONTENT_NODE_TYPES, NODE_TYPE_SEPARATOR]
                },
                [NODE_TYPE_BOOKMARK]: {
                    "valid_children": []
                },
                [NODE_TYPE_ARCHIVE]: {
                    "valid_children": []
                },
                [NODE_TYPE_NOTES]: {
                    "valid_children": []
                },
                [NODE_TYPE_SEPARATOR]: {
                    "valid_children": []
                }
            },
            state: {
                key: foldersOnly? TREE_STATE_PREFIX + FOLDER_SELECT_STATE: undefined,
                _scrollable: foldersOnly
            },
            dnd: {
                inside_pos: "last"
            }
        });

        jstree.on("move_node.jstree", this.#moveNode.bind(this));

        $(document).on("mousedown", ".jstree-node", e => this.handleMouseClick(e));
        $(document).on("click", ".jstree-anchor", e => this.handleMouseClick(e));
        // $(document).on("auxclick", ".jstree-anchor", e => e.preventDefault());

        this.iconCache = new Map();

        this._jstree = jstree.jstree(true);
        this._jstree.__icon_set_hook = this.#iconSetHook.bind(this);
        this._jstree.__icon_check_hook = this.#iconCheckHook.bind(this);

        if (!foldersOnly)
            this.#loadContainers();
    }

    #loadContainers() {
        if (browser.contextualIdentities) {
            browser.contextualIdentities.query({}).then(containers => {
                this._containers = containers;
            });

            browser.contextualIdentities.onCreated.addListener(() => {
                browser.contextualIdentities.query({}).then(containers => {
                    this._containers = containers;
                });
            });

            browser.contextualIdentities.onRemoved.addListener(() => {
                browser.contextualIdentities.query({}).then(containers => {
                    this._containers = containers;
                });
            });
        }
    }

    #iconSetHook(jnode) {
        if (jnode.icon.startsWith("var("))
            return jnode.icon;
        else if (jnode.icon.startsWith("/"))
            return `url("${jnode.icon}")`;
        else {
            if (o(jnode)?.stored_icon) {
                let icon = this.iconCache.get(jnode.icon);
                if (icon)
                    return `url("${icon}")`;
                else
                    return null;
            }
            else
                return `url("${jnode.icon}")`;
        }
    }

    #iconCheckHook(a_element, jnode) {
        if (jnode.__icon_validated || !jnode.icon || (jnode.icon && jnode.icon.startsWith("var("))
            || (jnode.icon && jnode.icon.startsWith("/")))
            return;

        setTimeout(async () => {
            if (o(jnode)?.stored_icon) {
                const cached = this.iconCache.get(jnode.icon);
                const base64Url = cached || (await Icon.get(o(jnode)));

                if (base64Url) {
                    if (!cached)
                        this.iconCache.set(jnode.icon, base64Url);
                    let iconElement = await this.#getIconElement(a_element);
                    if (iconElement)
                        iconElement.style.backgroundImage = `url("${base64Url}")`;
                }
            }
            else {
                let image = new Image();

                image.onerror = async e => {
                    const fallback_icon = "var(--themed-globe-icon)";
                    jnode.icon = fallback_icon;
                    let iconElement = await this.#getIconElement(a_element);
                    if (iconElement)
                        iconElement.style.backgroundImage = fallback_icon;
                };
                image.src = jnode.icon;
            }
        }, 0);

        jnode.__icon_validated = true;
    }

    #getIconElement(a_element) {
        const a_element2 = document.getElementById(a_element.id);
        if (a_element2)
            return a_element2.childNodes[0];
        else {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    const a_element2 = document.getElementById(a_element.id);
                    if (a_element2) {
                        resolve(a_element2.childNodes[0]);
                    }
                    else {
                        console.error("can't find icon element");
                        resolve(null);
                    }
                }, 100);
            })
        }
    }

    clearIconCache() {
        this.iconCache = new Map();
    }

    handleMouseClick(e) {
        if (this._foldersOnly)
            return;

        if (e.type === "click" && e.target._mousedown_fired) {
            e.target._mousedown_fired = false;
            return;
        }

        if (e.button === undefined || e.button === 0 || e.button === 1) {
            e.preventDefault();

            if (e.type === "mousedown")
                e.target._mousedown_fired = true;

            let element = e.target;

            if (element.classList.contains("jstree-ocl")) // expand/collapse arrow icon
                return;

            while (element && !$(element).hasClass("jstree-node")) {
                element = element.parentNode;
            }

            if (e.type === "mousedown" && e.button === 0 && $(e.target).hasClass("jstree-wholerow")) {
                let anchor = $(element).find(".jstree-anchor");
                if (anchor.length)
                    anchor [0]._mousedown_fired = true;
            }
            if (e.type === "mousedown" && e.button === 1 && $(e.target).hasClass("jstree-anchor")) {
                let anchor = $(element).find(".jstree-anchor");
                if (anchor.length)
                    anchor[0]._mousedown_fired = false;
            }

            let node = o(this._jstree.get_node(element.id));
            let clickable = element.getAttribute("data-clickable") || node.__filtering;

            if (clickable && !e.ctrlKey && !e.shiftKey) {
                if (node) {
                    if (settings.open_bookmark_in_active_tab()) {
                        getActiveTabFromSidebar().then(activeTab => {
                            activeTab = e.button === 0 && activeTab ? activeTab : undefined;
                            send.browseNode({node: node, tab: activeTab, preserveHistory: true});
                        });
                    }
                    else
                        send.browseNode({node: node});
                }
            }
            return false;
        }
    }

    static _formatNodeTooltip(node) {
        return `${node.name}${node.uri? "\x0A" + node.uri: ""}`;
    }

    static _styleTODO(node) {
        if (node.todo_state)
            return " todo-state-" + (node.__overdue
                ? "overdue"
                : TODO_STATE_NAMES[node.todo_state]?.toLowerCase());

        return "";
    }

    static _formatTODO(node) {
        let text = "<div><span class='todo-path'>";

        for (let i = 0; i < node.__path.length; ++i) {
            text += node.__path[i];

            if (i !== node.__path.length - 1)
                text += " &#187; "
        }

        if (node.todo_date)
            text += " | " + "<span class='" + BookmarkTree._styleTODO(node) + "'>" + node.todo_date + "</span>";

        if (node.details)
            text += " | " + "<span class='todo-details'>" + node.details + "</span>";

        text += "</span><br/>";
        text += "<span class='todo-text'>" + node.name + "</span></div>";

        return text;
    }

    static styleFirefoxFolders(node, jnode) {
        if (node.external === BROWSER_EXTERNAL_TYPE && node.external_id === FIREFOX_BOOKMARK_MENU) {
            jnode.icon = "/icons/bookmarksMenu.svg";
            jnode.li_attr = {"class": "browser-bookmark-menu"};
            node.special_browser_folder = true;
        }
        else if (node.external === BROWSER_EXTERNAL_TYPE
                && (settings.platform.firefox && node.external_id === FIREFOX_BOOKMARK_UNFILED
                        || settings.platform.chrome && node.external_id === CHROME_BOOKMARK_UNFILED)) {
            jnode.icon = "/icons/unfiledBookmarks.svg";
            jnode.li_attr = {"class": "browser-unfiled-bookmarks"};
            node.special_browser_folder = true;
        }
        else if (node.external === BROWSER_EXTERNAL_TYPE
                && (settings.platform.firefox && node.external_id === FIREFOX_BOOKMARK_TOOLBAR
                        || settings.platform.chrome && node.external_id === CHROME_BOOKMARK_TOOLBAR)) {
            jnode.icon = "/icons/bookmarksToolbar.svg";
            jnode.li_attr = {"class": "browser-bookmark-toolbar"};
            if (!settings.show_firefox_toolbar())
                jnode.state = {hidden: true};
            node.special_browser_folder = true;
        }
        else if (node.external === BROWSER_EXTERNAL_TYPE && node.external_id === FIREFOX_BOOKMARK_MOBILE) {
            if (!settings.show_firefox_mobile())
                jnode.state = {hidden: true};
            node.special_browser_folder = true;
        }
    }

    static toJsTreeNode(node) {
        let jnode = {};

        jnode.id = node.id;
        jnode.text = node.name || "";
        jnode.type = node.type;
        jnode.icon = node.icon;
        jnode.data = node; // store the original Scrapyard node
        jnode.parent = node.parent_id;

        if (!jnode.parent)
            jnode.parent = "#";

        if (node.type === NODE_TYPE_SHELF && node.external === BROWSER_EXTERNAL_TYPE) {
            jnode.text = formatShelfName(node.name);
            jnode.li_attr = {"class": "browser-logo"};
            if (settings.platform.firefox)
                jnode.icon = "var(--themed-firefox-icon)";
            else if (settings.platform.chrome)
                jnode.icon = "var(--themed-chrome-icon)";
            else
                jnode.icon = "/icons/shelf.svg";
            if (!settings.show_firefox_bookmarks()) {
                jnode.state = {hidden: true};
            }
            BookmarkTree.styleFirefoxFolders(node, jnode);
        }
        else if (node.type === NODE_TYPE_SHELF && node.external === FILES_EXTERNAL_TYPE) {
            jnode.li_attr = {"class": "files-shelf"};
            jnode.icon = "var(--themed-files-box-icon)";
        }
        else if (node.type === NODE_TYPE_SHELF && node.external === CLOUD_EXTERNAL_TYPE) {
            jnode.text = formatShelfName(node.name);
            jnode.li_attr = {"class": "cloud-shelf"};
            jnode.icon = "var(--themed-cloud-icon)";
        }
        else if (node.type === NODE_TYPE_SHELF && node.external === RDF_EXTERNAL_TYPE) {
            jnode.li_attr = {"class": "rdf-archive"};
            jnode.icon = "/icons/tape.svg";
        }
        else if (node.type === NODE_TYPE_SHELF) {
            if (node.name && isBuiltInShelf(node.name))
                jnode.text = formatShelfName(node.name);
            jnode.icon = "/icons/shelf.svg";
            jnode.li_attr = {"class": "scrapyard-shelf"};
        }
        else if (node.type === NODE_TYPE_FOLDER) {
            jnode.icon = "/icons/group.svg";
            jnode.li_attr = {class: "scrapyard-group"};

            if (node.site) {
                jnode.li_attr["data-clickable"] = "true";
                jnode.li_attr["class"] += " scrapyard-site"
                jnode.icon = "/icons/web.svg";
            }

            BookmarkTree.styleFirefoxFolders(node, jnode);

            if (node.external === FILES_EXTERNAL_TYPE && node.external_id?.startsWith(FILES_EXTERNAL_ROOT_PREFIX)) {
                jnode.icon = "/icons/bookmarksMenu.svg";
                jnode.li_attr = {"class": "browser-bookmark-menu"};
            }
        }
        else if (node.type === NODE_TYPE_SEPARATOR) {
            jnode.text = "─".repeat(60);
            jnode.icon = false;
            jnode.a_attr = {
                class: "separator-node"
            };
        }
        else {
            jnode.li_attr = {
                class: "show_tooltip",
                title: BookmarkTree._formatNodeTooltip(node),
                //"data-id": node.id,
                "data-clickable": "true"
            };

            jnode.a_attr = {
                class: node.has_notes? "has-notes": ""
            };

            if (node.type === NODE_TYPE_ARCHIVE) {
                jnode.li_attr.class += " archive-node";

                if (settings.visually_emphasise_archives()) {
                    if (settings.visual_archive_icon())
                        jnode.a_attr.class += " archive-node-jar";

                    if (settings.visual_archive_color())
                        jnode.a_attr.class += " archive-node-color";
                }
            }

            if (node.todo_state) {
                jnode.a_attr.class += BookmarkTree._styleTODO(node);

                if (node.__extended_todo) {
                    jnode.li_attr.class += " " + EXTENDED_TODO_CLASS;
                    jnode.text = BookmarkTree._formatTODO(node);
                }
            }

            if (node.type === NODE_TYPE_NOTES)
                jnode.li_attr.class += " scrapyard-notes";

            if (!node.icon) {
                if (node.type === NODE_TYPE_NOTES)
                    jnode.icon = "var(--themed-notes-icon)";
                else if (node.type === NODE_TYPE_FILE)
                    jnode.icon = "var(--themed-file-icon)";
                else if (node.content_type === "application/pdf")
                    jnode.icon = "var(--themed-pdf-icon)";
                else if (IMAGE_FORMATS.some(f => f === node.content_type))
                    jnode.icon = "var(--themed-image-icon)";
                else {
                    jnode.icon = "var(--themed-globe-icon)";
                    jnode.a_attr.class += " " + DEFAULT_ICON_CLASS;
                }
            }
        }

        return jnode;
    }

    set data(nodes) {
        this._jstree.settings.core.data = nodes;
    }

    get data() {
        return this._jstree.settings.core.data
    }

    get odata() {
        return this._jstree.settings.core.data.map(n => n.data);
    }

    get stateKey() {
        return this._jstree.settings.state.key;
    }

    set stateKey(key) {
        this._jstree.settings.state.key = key;
    }

    get selected() {
        return this._jstree.get_selected(true)
    }

    getSelectedNodes() {
        const selection = this._jstree.get_top_selected().map(id => parseInt(id));
        return this.odata.filter(n => selection.some(id => id === n.id));
    }

    update(nodes, everything = false, clearSelected = false) {
        this.data = nodes.map(n => BookmarkTree.toJsTreeNode(n));

        let state;

        if (/*this._foldersOnly || */everything) {
            this._everything = true;
            this._jstree.settings.state.key = TREE_STATE_PREFIX + EVERYTHING_SHELF_UUID;
            state = JSON.parse(localStorage.getItem(TREE_STATE_PREFIX + EVERYTHING_SHELF_UUID));
        }
        else {
            this._everything = false;
            const shelves = nodes.filter(n => n.type === NODE_TYPE_SHELF);

            if (shelves.length) {
                this._jstree.settings.state.key = TREE_STATE_PREFIX + shelves[0].name;
                state = JSON.parse(localStorage.getItem(TREE_STATE_PREFIX + shelves[0].name));
            }
        }

        this._jstree.refresh(true, () => state? state.state: null);

        if (clearSelected)
            this._jstree.deselect_all(true);
    }

    // Used to make a flat list in the tree-view (e.g. in search)
    list(nodes, stateKey, clearSelected = false) {
        if (stateKey)
            this.stateKey = TREE_STATE_PREFIX + stateKey;

        this.data = nodes.map(n => BookmarkTree.toJsTreeNode(n));
        this.data.forEach(n => n.parent = "#");

        this._jstree.refresh(true);

        if (clearSelected)
            this._jstree.deselect_all(true);
    }

    renameRoot(name) {
        let rootNode = this._jstree.get_node(this.odata.find(n => n.type === NODE_TYPE_SHELF));
        this._jstree.rename_node(rootNode, name);
    }

    openRoot() {
        let rootNode = this._jstree.get_node(this.odata.find(n => n.type === NODE_TYPE_SHELF));
        this._jstree.open_node(rootNode);
        this._jstree.deselect_all(true);
    }

    setNotesState(nodeId, hasNotes) {
        let jnode = this._jstree.get_node(nodeId);

        if (jnode) {
            o(jnode).has_notes = hasNotes;
            jnode.a_attr.class = jnode.a_attr.class.replace("has-notes", "");

            if (hasNotes)
                jnode.a_attr.class += " has-notes";

            this._jstree.redraw_node(jnode, false, false, true);
        }
    }

    setNodeIcon(nodeId, icon) {
        let cloudNode = this._jstree.get_node(nodeId);

        if (cloudNode)
            this._jstree.set_icon(cloudNode, icon);
    }

    createTentativeNode(node) {
        node.__tentative = true;
        node.id = node.__tentative_id;
        let jnode = BookmarkTree.toJsTreeNode(node);

        jnode.a_attr.class += " node-pending";
        return this._jstree.create_node(node.parent_id, jnode, "last");
    }

    updateTentativeNode(node) {
        const jnode = this._jstree.get_node(node.__tentative_id);
        if (jnode) {
            this._jstree.set_id(node.__tentative_id, node.id);
            const jnode = this._jstree.get_node(node.id);

            jnode.a_attr.class = jnode.a_attr.class.replace("node-pending", " ");

            node.__tentative = false;

            Object.assign(o(jnode), node);
            jnode.original = BookmarkTree.toJsTreeNode(node);
            this.data.push(jnode.original);

            if (node.icon && node.stored_icon) {
                this.iconCache.set(node.icon, jnode.icon);
                jnode.icon = node.icon;
            }
            else
                jnode.icon = jnode.original.icon;

            this._jstree.redraw_node(jnode)

            return true;
        }
        return false;
    }

    removeTentativeNode(node) {
        this._jstree.delete_node(node.__tentative_id);
    }

    openNode(nodeId) {
        let jnode = this._jstree.get_node(nodeId);
        this._jstree.open_node(jnode);
    }

    selectNode(nodeId, open, forceScroll) {
        this._jstree.deselect_all(true);
        this._jstree.select_node(nodeId);

        if (Array.isArray(nodeId))
            nodeId = nodeId[0];

        if (open)
            this._jstree.open_node(nodeId);

        let domNode = document.getElementById(nodeId.toString());

        if (forceScroll) {
            domNode.scrollIntoView();
            $(this._elementId).scrollLeft(0);
        }
        else {
            if (!isElementInViewport(domNode)) {
                domNode.scrollIntoView();
                $(this._elementId).scrollLeft(0);
            }
        }
    }

    async createNewFolderUnderSelection(id, type) {
        let selectedJNode = this.selected?.[0];

        if (!selectedJNode && type !== NODE_TYPE_SHELF)
            return;

        const parent = type === NODE_TYPE_SHELF? "#": selectedJNode;
        const title = type === NODE_TYPE_SHELF? "Shelf": "Folder";
        const className = type === NODE_TYPE_SHELF? "scrapyard-shelf": "scrapyard-group";
        const icon = type === NODE_TYPE_SHELF? "/icons/shelf.svg": "/icons/group.svg";

        let jnode = this._jstree.create_node(parent, {
            id: id,
            text: `New ${title}`,
            type: type,
            icon: icon,
            li_attr: {"class": className}
        });

        this._jstree.deselect_all();
        this._jstree.select_node(jnode);

        return new Promise((resolve, reject) => {
            this._jstree.edit(jnode, null, async (jnode, success, cancelled) => {
                if (cancelled) {
                    this._jstree.delete_node(jnode);
                    resolve(null);
                }
                else {
                    const folder = type === NODE_TYPE_SHELF
                        ? await send.createShelf({name: jnode.text})
                        : await send.createFolder({parent: parseInt(selectedJNode.id), name: jnode.text});

                    if (folder) {
                        this._jstree.set_id(jnode.id, folder.id);
                        jnode.original = BookmarkTree.toJsTreeNode(folder);
                        jnode.data = folder;
                        this._jstree.rename_node(jnode, folder.name);
                        //this.reorderNodes(selectedJNode);
                        resolve(folder);
                    }
                }
            });
        });
    }

    adjustBookmarkingTarget(nodeId) {
        let jnode = this._jstree.get_node(nodeId);
        let odata = this.odata;

        if (o(jnode)?.id === BROWSER_SHELF_ID) {
            let unfiled = odata.find(n => n.external_id === FIREFOX_BOOKMARK_UNFILED)
            if (unfiled)
                jnode = this._jstree.get_node(unfiled.id);
            else
                jnode = this._jstree.get_node(odata.find(n => n.name === DEFAULT_SHELF_NAME).id);
        }

        return o(jnode);
    }

    #checkOperation(operation, jnode, jparent, position, more) {
        // disable dnd copy
        if (operation === "copy_node") {
            return false;
        } else if (operation === "move_node") {
            if (more.ref && more.ref.id == BROWSER_SHELF_ID
                    || jparent.id == BROWSER_SHELF_ID || jnode.parent == BROWSER_SHELF_ID)
                return false;

            if (o(jnode)?.external !== RDF_EXTERNAL_TYPE && o(jparent)?.external === RDF_EXTERNAL_TYPE
                    || o(jnode)?.external === RDF_EXTERNAL_TYPE
                        && more.ref && jnode.parent !== "#" && o(more.ref)?.external !== RDF_EXTERNAL_TYPE)
                return false;

            if (o(jnode)?.external !== FILES_EXTERNAL_TYPE && o(jparent)?.external === FILES_EXTERNAL_TYPE
                    || o(jnode)?.external === FILES_EXTERNAL_TYPE
                        && more.ref && jnode.parent !== "#" && o(more.ref)?.external !== FILES_EXTERNAL_TYPE)
                return false;
        }

        return true;
    }

    async #moveNode(_, data) {
        const tree = this._jstree;
        const jnode = tree.get_node(data.node);
        const jparent = tree.get_node(data.parent);
        const destNode = o(jparent);

        if (data.parent != data.old_parent) {
            this.startProcessingIndication();

            try {

                await ExternalStorage.openBatchSession(destNode);
                const newNodes = await send.moveNodes({node_ids: [o(jnode).id], dest_id: destNode.id});

                // keep jstree nodes synchronized with the database
                for (let node of newNodes) {
                    jnode.original = BookmarkTree.toJsTreeNode(node);

                    let oldOriginal = this.data.find(d => d.id == node.id);
                    if (oldOriginal)
                        this.data[this.data.indexOf(oldOriginal)] = jnode.original;
                    else
                        this.data.push(jnode.original);
                }

                await this.reorderNodes(jparent);
            }
            finally {
                await ExternalStorage.closeBatchSession(destNode);
                this.stopProcessingIndication();
            }
        }
        else {
            if (jnode.li_attr?.class?.includes(EXTENDED_TODO_CLASS))
                await this.reorderNodes(jparent, "todo_pos");
            else
                await this.reorderNodes(jparent);
        }
    }

    async reorderNodes(jparent, posProperty = "pos") {
        let jsiblings = jparent.children.map(c => this._jstree.get_node(c));

        let positions = [];
        for (let i = 0; i < jsiblings.length; ++i) {
            const sibling = o(jsiblings[i]);
            const orderNode = {};

            orderNode.id = sibling.id;
            orderNode.uuid = sibling.uuid;
            orderNode.parent_id = sibling.parent_id;
            orderNode.external = sibling.external;
            orderNode.external_id = sibling.external_id;
            sibling[posProperty] = orderNode[posProperty] = i;
            positions.push(orderNode);
        }

        if (jparent.id === "#" && this._everything) {
            await Bookmark.idb.reorder(positions);
            const storedShelves = positions.filter(p => !p.external);
            await send.reorderNodes({positions: storedShelves});
        }
        else
            return send.reorderNodes({positions: positions, posProperty});
    }

    contextMenu(ctxJNode) {
        return buildContextMenu(this, ctxJNode);
    }
}


export {BookmarkTree};
