import {send} from "../proxy.js";
import {cloudShelf} from "../plugin_cloud_shelf.js"
import {showDlg, confirm, showUploadDlg} from "./dialog.js"
import {settings} from "../settings.js";
import {
    isContainerNode,
    isContentNode,
    isBuiltInShelf,
    CLOUD_EXTERNAL_TYPE,
    BROWSER_SHELF_ID,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK,
    NODE_TYPE_FOLDER,
    NODE_TYPE_NOTES,
    NODE_TYPE_SEPARATOR,
    NODE_TYPE_SHELF,
    RDF_EXTERNAL_TYPE,
    TODO_STATE_CANCELLED,
    TODO_STATE_DONE,
    TODO_STATE_POSTPONED,
    TODO_STATE_TODO,
    TODO_STATE_WAITING,
    byPosition,
    BROWSER_EXTERNAL_TYPE,
    FILES_EXTERNAL_TYPE,
    FILES_EXTERNAL_ROOT_PREFIX,
    NODE_TYPE_FILE, byContainer
} from "../storage.js";
import {getThemeVar} from "../utils_html.js";
import {openContainerTab, openPage, showNotification} from "../utils_browser.js";
import {createBookmarkFromURL, setBookmarkedActionIcon} from "../bookmarking.js";
import {Bookmark} from "../bookmarks_bookmark.js";
import {Comments, Icon, Node} from "../storage_entities.js";
import UUID from "../uuid.js";
import {ExternalStorage} from "../storage_external.js";

// return the original Scrapyard node object stored in a jsTree node
const o = n => n.data;
const DEFAULT_ICON_CLASS = "generic-icon";

export function buildContextMenu(bookmarkTree, ctxJNode) {
    const ctxNode = o(ctxJNode);

    if (ctxNode.__tentative)
        return null;

    const tree = bookmarkTree._jstree;
    const lightTheme = getThemeVar("--theme-background").trim() === "white";

    let selectedNodes = tree.get_selected(true) || [];
    const multiselect = selectedNodes.length > 1;

    const setTODOState = async state => {
        let selectedIds = selectedNodes.map(n => o(n).type === NODE_TYPE_FOLDER || o(n).type === NODE_TYPE_SHELF
                                                    ? n.children
                                                    : o(n).id);
        let nodes = [];
        let changedNodes = selectedIds.flat().map(id => tree.get_node(id));

        selectedIds = changedNodes.filter(n => isContentNode(o(n))).map(n => parseInt(n.id));

        selectedNodes = changedNodes.filter(n => selectedIds.some(id => id === o(n).id)).map(n => o(n));

        // a minimal set of attributes compatible with marshalling
        selectedNodes.forEach(n => nodes.push({id: n.id, parent_id: n.parent_id, name: n.name, uuid: n.uuid,
            external: n.external, external_id: n.external_id, todo_state: state, todo_pos: state? n.todo_pos: undefined}));

        selectedIds.forEach(id => {
            let jnode = tree.get_node(id);
            o(jnode).todo_state = state;
            jnode.a_attr.class = jnode.a_attr.class.replace(/todo-state-[a-zA-Z]+/g, "");
            jnode.a_attr.class += bookmarkTree.constructor._styleTODO(o(jnode));
            jnode.text = jnode.text.replace(/todo-state-[a-zA-Z]+/g, jnode.a_attr.class);
            tree.redraw_node(jnode, true, false, true);
        });

        bookmarkTree.startProcessingIndication();

        try {
            await send.setTODOState({nodes});
        }
        finally {
            bookmarkTree.stopProcessingIndication();
        }
    }

    let containers = bookmarkTree._containers || [];
    let containersSubmenu = {};

    for (let container of containers) {
        containersSubmenu[container.cookieStoreId] = {
            label: container.name,
            __container_id: container.cookieStoreId,
            _istyle: `mask-image: url("${container.iconUrl}"); mask-size: 16px 16px; `
                   + `mask-repeat: no-repeat; mask-position: center; background-color: ${container.colorCode};`,
            action: async obj => {
                if (ctxNode.type === NODE_TYPE_SHELF || ctxNode.type === NODE_TYPE_FOLDER) {
                    let children = bookmarkTree.odata.filter(n => ctxJNode.children.some(id => id == n.id) && isContentNode(n));
                    children = children.filter(c => c.type !== NODE_TYPE_NOTES);
                    children.forEach(c => c.type = NODE_TYPE_BOOKMARK);
                    children.sort(byPosition);

                    for (let node of children) {
                        await send.browseNode({node, container: obj.item.__container_id});
                    }
                }
                else {
                    for (let n of selectedNodes) {
                        let node = o(n);
                        if (!isContentNode(node) || !node.uri)
                            continue;
                        node.type = NODE_TYPE_BOOKMARK;
                        await send.browseNode({node, container: obj.item.__container_id});
                    }
                }
            }
        }
    }

    let items = {
        locateItem: {
            label: "Locate",
            action: async () => {
                bookmarkTree.sidebarSelectNode(ctxNode);
            }
        },
        archiveItem: {
            label: "Archive",
            separator_before: ctxNode.__filtering,
            action: async () => {
                send.archiveBookmarks({nodes: selectedNodes.map(n => o(n))});
            }
        },
        copyLinkItem: {
            label: "Copy Link",
            separator_before: ctxNode.__filtering && ctxNode.type !== NODE_TYPE_BOOKMARK,
            action: () => navigator.clipboard.writeText(ctxNode.uri)
        },
        openItem: {
            label: "Open",
            separator_before: ctxNode.__filtering,
            action: async () => {
                for (let jnode of selectedNodes)
                    await send.browseNode({node: o(jnode)});
            }
        },
        openWithEditorItem: {
            label: "Edit",
            action: async () => {
                send.openWithEditor({node: ctxNode});
            }
        },
        openNotesItem: {
            label: "Open Notes",
            action: () => {
                send.browseNotes({uuid: ctxNode.uuid});
            }
        },
        openOriginalItem: {
            label: "Open Original URL",
            action: async () => {
                let url = ctxNode.uri;

                if (url)
                    openContainerTab(url, ctxNode.container);
            }
        },
        openAllItem: {
            label: "Open All",
            separator_before: ctxNode.__filtering && ctxNode.type,
            action: async () => {
                let children = bookmarkTree.odata.filter(n => ctxJNode.children.some(id => id == n.id) && isContentNode(n));
                children.sort(byPosition);

                for (let node of children)
                    await send.browseNode({node: node});
            }
        },
        openInContainerItem: {
            label: "Open in Container",
            submenu: containersSubmenu
        },
        orderItem: {
            label: "Order",
            submenu: {
                sortItem: {
                    label: "Sort by Name",
                    action: () => {
                        const oldPositions = ctxJNode.children.map((c, i) => {
                            const sibling = o(tree.get_node(c));
                            return {id: sibling.id, uuid: sibling.uuid, parent_id: sibling.parent_id,
                                    external: sibling.external, external_id: sibling.external_id, pos: i};
                        });

                        let jchildren = ctxJNode.children.map(c => tree.get_node(c));
                        jchildren.sort((a, b) => a.text.localeCompare(b.text));
                        jchildren.sort((a, b) => byContainer(o(a), o(b)));
                        ctxJNode.children = jchildren.map(c => c.id);

                        tree.redraw_node(ctxJNode, true, false, true);
                        bookmarkTree.reorderNodesUndoable(ctxJNode, oldPositions);
                    }
                },
                reverseItem: {
                    label: "Reverse",
                    action: () => {
                        const oldPositions = ctxJNode.children.map((c, i) => {
                            const sibling = o(tree.get_node(c));
                            return {id: sibling.id, uuid: sibling.uuid, parent_id: sibling.parent_id,
                                    external: sibling.external, external_id: sibling.external_id, pos: i};
                        });

                        let jchildren = ctxJNode.children.map(c => tree.get_node(c));
                        jchildren.reverse();
                        ctxJNode.children = jchildren.map(c => c.id);

                        tree.redraw_node(ctxJNode, true, false, true);
                        bookmarkTree.reorderNodesUndoable(ctxJNode, oldPositions);
                    }
                }
            }
        },
        addFilesDirectoryItem: {
            label: "Add directory",
            action: async () => {
                const options = await bookmarkTree.addFilesDirectory();

                if (options?.path) {
                    options.title = options.title || "Untitled";

                    bookmarkTree.startProcessingIndication();

                    try {
                        return send.addFilesDirectory({options});
                    }
                    finally {
                        bookmarkTree.stopProcessingIndication();
                    }
                }
            }
        },
        newItem: {
            label: "New",
            separator_before: true,
            submenu: {
                newFolderItem: {
                    label: "Folder",
                    icon: `/icons/group${lightTheme? "": "2"}.svg`,
                    action: async () => {
                        let folder = {id: Bookmark.setTentativeId({}), type: NODE_TYPE_FOLDER, name: "New Folder",
                                     parent_id: ctxNode.id};
                        const folderPending = send.createFolder({parent: ctxNode, name: folder.name});

                        let jfolder = bookmarkTree.constructor.toJsTreeNode(folder);
                        tree.deselect_all(true);

                        let folderJNode = tree.get_node(tree.create_node(ctxJNode, jfolder, 0));
                        tree.select_node(folderJNode);

                        tree.edit(folderJNode, null, async (jnode, success, cancelled) => {
                            bookmarkTree.startProcessingIndication();
                            folder = await folderPending;
                            tree.set_id(folderJNode.id, folder.id);

                            if (success && !cancelled && jnode.text)
                                folder = await send.renameFolder({id: folder.id, name: jnode.text});

                            tree.rename_node(jnode, folder.name);
                            Object.assign(o(jnode), folder);
                            jnode.original = bookmarkTree.constructor.toJsTreeNode(folder);
                            await bookmarkTree.reorderNodes(ctxJNode);

                            bookmarkTree.stopProcessingIndication();
                        });
                    }
                },
                newSiblingFolderItem: {
                    label: "Sibling Folder",
                    icon: `/icons/group${lightTheme? "": "2"}.svg`,
                    action: async () => {
                        let jparent = tree.get_node(ctxJNode.parent);
                        let position = $.inArray(ctxJNode.id, jparent.children);

                        let folder = {id: Bookmark.setTentativeId({}), type: NODE_TYPE_FOLDER, name: "New Folder",
                            parent_id: o(jparent).id};
                        const folderPending = send.createFolder({parent: o(jparent), name: folder.name});

                        let jfolder = bookmarkTree.constructor.toJsTreeNode(folder);
                        tree.deselect_all(true);

                        let folderJNode = tree.get_node(tree.create_node(jparent, jfolder, position + 1));
                        tree.select_node(folderJNode);

                        tree.edit(folderJNode, null, async (jnode, success, cancelled) => {
                            bookmarkTree.startProcessingIndication();
                            folder = await folderPending;
                            tree.set_id(folderJNode.id, folder.id);

                            if (success && !cancelled && jnode.text)
                                folder = await send.renameFolder({id: folder.id, name: jnode.text});

                            tree.rename_node(jnode, folder.name);
                            Object.assign(o(jnode), folder);
                            jnode.original = bookmarkTree.constructor.toJsTreeNode(folder);
                            await bookmarkTree.reorderNodes(jparent);

                            bookmarkTree.stopProcessingIndication();
                        });
                    }
                },
                newBookmarkItem: {
                    label: "Bookmark",
                    icon: `/icons/globe${lightTheme? "": "2"}.svg`,
                    action: async () => {
                        const options = await showDlg("prompt", {caption: "New Bookmark", label: "URL:"});
                        if (options && options.title)
                            return createBookmarkFromURL(options.title, ctxNode.id);
                    }
                },
                newNotesItem: {
                    label: "Notes",
                    icon: `/icons/notes${lightTheme? "": "2"}.svg`,
                    action: async () => {
                        if (isContentNode(ctxNode)) {
                            send.browseNotes({uuid: ctxNode.uuid});
                            return;
                        }

                        let notes = {id: Bookmark.setTentativeId({}), parent_id: ctxNode.id, name: "New Notes",
                                     type: NODE_TYPE_NOTES};
                        const notesPending = send.addNotes({name: notes.name, parent_id: notes.parent_id});

                        let jnotes = bookmarkTree.constructor.toJsTreeNode(notes);
                        tree.deselect_all(true);

                        let notesNode = tree.get_node(tree.create_node(ctxJNode, jnotes));
                        tree.select_node(notesNode);

                        tree.edit(notesNode, null, async (jnode, success, cancelled) => {
                            bookmarkTree.startProcessingIndication();
                            notes = await notesPending;
                            tree.set_id(notesNode.id, notes.id);

                            if (success && !cancelled && jnode.text) {
                                notes.name = jnode.text;
                                notes = await send.updateBookmark({node: notes});
                            }

                            Object.assign(o(jnode), notes);
                            jnode.original = bookmarkTree.constructor.toJsTreeNode(notes);
                            bookmarkTree.data.push(jnode.original);

                            bookmarkTree.stopProcessingIndication();
                        });
                    }
                },
                newSeparatorItem: {
                    label: "Separator Below",
                    icon: `/icons/separator${lightTheme? "": "2"}.svg`,
                    action: async () => {
                        const jparent = tree.get_node(ctxJNode.parent);
                        const position = $.inArray(ctxJNode.id, jparent.children);
                        let separator = {id: Bookmark.setTentativeId({}), type: NODE_TYPE_SEPARATOR,
                                         parent_id: o(jparent).id};

                        const jnode = bookmarkTree.constructor.toJsTreeNode(separator);
                        const separatorJNode = tree.get_node(tree.create_node(jparent, jnode, position + 1));

                        separator = await send.addSeparator({parent_id: o(jparent).id});
                        tree.set_id(separatorJNode.id, separator.id);
                        Object.assign(o(separatorJNode), separator);
                        bookmarkTree.reorderNodes(jparent);
                    }
                },
                newLabeledSeparatorItem: {
                    label: "Labeled Separator",
                    icon: `/icons/labeled_separator${lightTheme? "": "2"}.svg`,
                    action: async () => {
                        const options = await showDlg("prompt", {caption: "Labeled Separator", label: "Label:"});
                        if (!options?.title)
                            return;

                        const jparent = tree.get_node(ctxJNode.parent);
                        const position = $.inArray(ctxJNode.id, jparent.children);
                        let separator = {id: Bookmark.setTentativeId({}), type: NODE_TYPE_SEPARATOR,
                                         name: options.title, parent_id: o(jparent).id};

                        const jnode = bookmarkTree.constructor.toJsTreeNode(separator);
                        const separatorJNode = tree.get_node(tree.create_node(jparent, jnode, position + 1));

                        separator = await send.addSeparator({parent_id: o(jparent).id, name: options.title});
                        tree.set_id(separatorJNode.id, separator.id);
                        Object.assign(o(separatorJNode), separator);
                        bookmarkTree.reorderNodes(jparent);
                    }
                },
            }
        },
        cutItem: {
            separator_before: true,
            label: "Cut",
            _disabled: selectedNodes.some(n => o(n).type === NODE_TYPE_SHELF),
            action: () => tree.cut(selectedNodes)
        },
        copyItem: {
            label: "Copy",
            _disabled: selectedNodes.some(n => o(n).type === NODE_TYPE_SHELF),
            action: () => tree.copy(selectedNodes)
        },
        pasteItem: {
            label: "Paste",
            separator_before: ctxNode.type === NODE_TYPE_SHELF || ctxNode.parent_id == BROWSER_SHELF_ID,
            _disabled: !(tree.can_paste() && isContainerNode(ctxNode)),
            action: async () => {
                let buffer = tree.get_buffer();
                let selection = Array.isArray(buffer.node)? buffer.node.map(n => o(n)): [o(buffer.node)];
                selection.sort(byPosition);
                selection = selection.map(n => n.id);

                bookmarkTree.startProcessingIndication();

                try {
                    let newNodes;

                    await ExternalStorage.openBatchSession(ctxNode);

                    if (buffer.mode === "copy_node")
                        newNodes = await send.copyNodes({node_ids: selection, dest_id: ctxNode.id});
                    else {
                        newNodes = await send.moveNodes({node_ids: selection, dest_id: ctxNode.id});
                        for (let s of selection)
                            tree.delete_node(s);
                    }

                    for (let newNode of newNodes) {
                        let jparent = tree.get_node(newNode.parent_id);
                        let jnode = bookmarkTree.constructor.toJsTreeNode(newNode);
                        tree.create_node(jparent, jnode, "last");

                        let sourceNode = bookmarkTree.data.find(treeNode => treeNode.id == newNode.id);
                        if (sourceNode)
                            bookmarkTree.data[bookmarkTree.data.indexOf(sourceNode)] = jnode;
                        else
                            bookmarkTree.data.push(jnode);
                    }

                    await bookmarkTree.reorderNodes(ctxJNode);
                    tree.clear_buffer();
                }
                catch (e) {
                    console.error(e)
                }

                finally {
                    await ExternalStorage.closeBatchSession(ctxNode);
                    bookmarkTree.stopProcessingIndication();
                }
            }
        },
        shareItem: {
            label: "Share",
            separator_before: true,
            submenu: {
                cloudItem: {
                    label: "Cloud",
                    icon: (lightTheme? "/icons/cloud.png": "/icons/cloud2.png"),
                    _disabled: !settings.cloud_enabled() || !cloudShelf.isAuthenticated(),
                    action: async () => {
                        bookmarkTree.startProcessingIndication(true);
                        let selectedIds = selectedNodes.map(n => o(n).id);
                        try {
                            await send.shareToCloud({node_ids: selectedIds})
                        }
                        finally {
                            bookmarkTree.stopProcessingIndication();
                        }
                    }
                },
                dropboxItem: {
                    label: "Dropbox",
                    icon: "/icons/dropbox.png",
                    action: async () => {
                        if (selectedNodes)
                            await send.shareToDropbox({nodes: selectedNodes.map(n => o(n))});
                    }
                },
                oneDriveItem: {
                    label: "OneDrive",
                    icon: "/icons/onedrive.png",
                    action: async () => {
                        if (selectedNodes)
                            await send.shareToOneDrive({nodes: selectedNodes.map(n => o(n))});
                    }
                }
            }
        },
        todoItem: {
            separator_before: true,
            label: "TODO",
            submenu: {
                todoItem: {
                    label: "TODO",
                    icon: "/icons/todo.svg",
                    action: () => {
                        setTODOState(TODO_STATE_TODO);
                    }
                },
                waitingItem: {
                    label: "WAITING",
                    icon: "/icons/waiting.svg",
                    action: () => {
                        setTODOState(TODO_STATE_WAITING);
                    }
                },
                postponedItem: {
                    label: "POSTPONED",
                    icon: "/icons/postponed.svg",
                    action: () => {
                        setTODOState(TODO_STATE_POSTPONED);
                    }
                },
                cancelledItem: {
                    label: "CANCELLED",
                    icon: "/icons/cancelled.svg",
                    action: () => {
                        setTODOState(TODO_STATE_CANCELLED);
                    }
                },
                doneItem: {
                    label: "DONE",
                    icon: "/icons/done.svg",
                    action: () => {
                        setTODOState(TODO_STATE_DONE);
                    }
                },
                clearItem: {
                    separator_before: true,
                    label: "Clear",
                    action: () => {
                        setTODOState(undefined);
                    }
                }
            }
        },
        checkLinksItem: {
            separator_before: true,
            label: "Check Links...",
            action: async () => {
                await settings.load();
                let query = `?menu=true&repairIcons=${settings.repair_icons()}&scope=${ctxNode.id}`;
                openPage(`/ui/options.html${query}#checklinks`);
            }
        },
        uploadItem: {
            label: "Upload...",
            action: async () => {
                const picked = await showUploadDlg();

                if (!picked)
                    return;

                if (picked.path) {
                    send.uploadFiles({parent_id: ctxNode.id, file_name: picked.path});
                    return;
                }

                const file = picked.file;
                const isOrg = /\.org$/i.test(file.name);
                const isMarkdown = /\.md$/i.test(file.name);
                const content = isOrg || isMarkdown ? await file.text() : await file.arrayBuffer();

                send.uploadFiles({parent_id: ctxNode.id, file_name: file.name, content, content_type: file.type});
            }
        },
        exportItem: {
            label: "Export...",
            action: async () => bookmarkTree.performExport(ctxNode)
        },
        deleteItem: {
            separator_before: true,
            _disabled: !bookmarkTree._everything && multiselect && selectedNodes.some(n => o(n).type === NODE_TYPE_SHELF),
            label: "Delete",
            action: async () => {
                if (ctxNode.type === NODE_TYPE_SHELF) {
                    if (selectedNodes.map(n => o(n)).some(n => isBuiltInShelf(n.name))) {
                        showNotification({message: "A built-in shelf could not be deleted."});
                        return;
                    }

                    const verb = ctxNode.external === RDF_EXTERNAL_TYPE? "close": "delete";

                    if (await confirm("Warning", `Do you really want to ${verb} '${ctxNode.name}'?`)) {
                        bookmarkTree.startProcessingIndication();

                        let selectedIds = selectedNodes.map(n => o(n).id);

                        try {
                            await send.softDeleteNodes({node_ids: selectedIds});

                            tree.delete_node(selectedNodes);
                            bookmarkTree.onDeleteShelf(selectedIds);

                            await setBookmarkedActionIcon();
                        }
                        finally {
                            bookmarkTree.stopProcessingIndication();
                        }
                    }
                }
                else {
                    if (await confirm("Warning", "Do you really want to delete the selected items?")) {
                        bookmarkTree.startProcessingIndication();

                        try {
                            await send.softDeleteNodes({node_ids: selectedNodes.map(n => o(n).id)});
                            tree.delete_node(selectedNodes);

                            await setBookmarkedActionIcon();
                        }
                        finally {
                            bookmarkTree.stopProcessingIndication();
                        }
                    }
                }
            }
        },
        propertiesItem: {
            separator_before: true,
            label: "Properties...",
            action: async () => {
                if (isContentNode(ctxNode)) {
                    let properties = await Node.get(ctxNode.id);

                    if (properties.has_comments)
                        properties.comments = await Comments.get(properties);
                    else
                        properties.comments = "";

                    if (properties.icon || properties.stored_icon) {
                        if (properties.stored_icon)
                            properties.displayed_icon = await Icon.get(properties);
                        else
                            properties.displayed_icon = properties.icon;

                        properties.user_icon = properties.displayed_icon;
                    }
                    else {
                        properties.displayed_icon = "";
                        properties.user_icon = "";
                    }

                    let hasComments = !!properties.comments;

                    properties.containers = bookmarkTree._containers;

                    const originalUUID = properties.uuid;
                    const originalDateAdded = properties.date_added;
                    if (ctxNode.external === RDF_EXTERNAL_TYPE) {
                        properties.uuid = properties.external_id;
                        properties.date_added = UUID.getDate(properties.external_id);
                    }

                    let newProperties = await showDlg("properties", properties);

                    if (newProperties) {
                        delete properties.containers;
                        delete properties.uuid;

                        Object.assign(properties, newProperties);

                        if (ctxNode.external === RDF_EXTERNAL_TYPE) {
                            properties.uuid = originalUUID;
                            properties.date_added = originalDateAdded;
                        }

                        bookmarkTree.startProcessingIndication();

                        properties.has_comments = !!properties.comments;

                        if (hasComments || properties.has_comments)
                            await Bookmark.storeComments(properties.id, properties.comments);

                        delete properties.comments;

                        let newIcon;
                        if (properties.user_icon === "") {
                            properties.icon = undefined;
                            properties.stored_icon = undefined;
                            ctxJNode.icon = bookmarkTree.constructor.toJsTreeNode(ctxNode).icon;
                        }
                        else if (properties.user_icon && properties.user_icon !== properties.displayed_icon)
                            newIcon = properties.user_icon;

                        Bookmark.clean(properties);
                        properties = await send.updateBookmark({node: properties});

                        if (newIcon) {
                            properties.icon = newIcon;
                            await Bookmark.storeIcon(properties);

                            if (ctxJNode.a_attr.class)
                                ctxJNode.a_attr.class = ctxJNode.a_attr.class.replace(DEFAULT_ICON_CLASS, "");

                            tree.set_icon(ctxJNode, newIcon);
                        }

                        bookmarkTree.stopProcessingIndication();

                        let live_data = bookmarkTree.data.find(n => n.id == properties.id);
                        Object.assign(ctxNode, properties);
                        Object.assign(live_data, bookmarkTree.constructor.toJsTreeNode(ctxNode));

                        if (!ctxNode.__extended_todo)
                            tree.rename_node(ctxJNode, properties.name);
                        else
                            tree.rename_node(ctxJNode, bookmarkTree.constructor._formatTODO(ctxNode));

                        tree.redraw_node(ctxJNode, true, false, true);

                        $("#" + properties.id).prop('title', bookmarkTree.constructor._formatNodeTooltip(properties));
                    }
                }
            }
        },
        renameItem: {
            label: "Rename",
            action: async () => {
                const node = ctxNode;
                switch (node.type) {
                    case NODE_TYPE_SHELF:
                        const ERROR_MESSAGE = "A built-in shelf could not be renamed.";
                        if (isBuiltInShelf(node.name)) {
                            showNotification({message: ERROR_MESSAGE});
                            return;
                        }

                        tree.edit(node.id, null, async (jnode, success, cancelled) => {
                            if (success && !cancelled) {
                                if (isBuiltInShelf(jnode.text)) {
                                    tree.rename_node(jnode.id, node.name);
                                    showNotification({message: ERROR_MESSAGE});
                                    return;
                                }

                                bookmarkTree.startProcessingIndication();
                                await send.renameFolder({id: node.id, name: jnode.text})
                                bookmarkTree.stopProcessingIndication();
                                node.name = ctxJNode.original.text = jnode.text;
                                tree.rename_node(jnode.id, jnode.text);
                                bookmarkTree.onRenameShelf(node);
                            }
                        });
                        break;
                    case NODE_TYPE_FOLDER:
                        tree.edit(ctxJNode, null, async (jnode, success, cancelled) => {
                            if (success && !cancelled) {
                                bookmarkTree.startProcessingIndication();
                                const folder = await send.renameFolder({id: node.id, name: jnode.text});
                                bookmarkTree.stopProcessingIndication();
                                node.name = ctxJNode.original.text = folder.name;
                                tree.rename_node(ctxJNode, folder.name);
                            }
                        });
                        break;
                    case NODE_TYPE_SEPARATOR: {
                        const currentLabel = node.name && node.name !== "-"? node.name: "";
                        const options = await showDlg("prompt", {caption: "Labeled Separator", label: "Label:",
                                                                   title: currentLabel});
                        if (!options)
                            return;

                        const name = options.title || "-";

                        bookmarkTree.startProcessingIndication();
                        await send.updateBookmark({node: {id: node.id, name}});
                        bookmarkTree.stopProcessingIndication();

                        node.name = name;
                        const text = bookmarkTree.constructor.toJsTreeNode(node).text;
                        ctxJNode.original.text = text;
                        tree.rename_node(ctxJNode, text);
                        break;
                    }
                }
            }
        },
        rdfPathItem: {
            separator_before: true,
            label: "RDF Directory...",
            action: async () => {
                const options = await showDlg("prompt", {caption: "RDF Directory", label: "Path:",
                                                                    title: ctxNode.uri});
                if (options) {
                    let node = await Node.get(ctxNode.id);
                    ctxNode.uri = node.uri = options.title;
                    await Node.update(node);
                }
            }
        },
        debugItem: {
            separator_before: true,
            label: "Debug",
            submenu: {
                printObjectItem: {
                    label: "Print object",
                    action: async () => {
                        console.log(ctxNode);
                    }
                },
                printStubItem: {
                    label: "Print update stub",
                    action: async () => {
                        const stub = `var Node = (await import("./storage_entities.js")).Node;\n`
                                   + `var node = await Node.get(${ctxNode.id});\n`
                                   + `node.xyz = ...;\n`
                                   + `Node.update(node);`
                        console.log(stub);
                    }
                },

            }
        },
    };

    switch (ctxNode.type) {
        case NODE_TYPE_SHELF:
            delete items.archiveItem;
            delete items.cutItem;
            delete items.copyItem;
            delete items.shareItem;
            delete items.newItem.submenu.newSeparatorItem;
            delete items.newItem.submenu.newSiblingFolderItem;
            if (ctxNode.id === BROWSER_SHELF_ID) {
                items = {};
            }
            if (ctxNode.external !== RDF_EXTERNAL_TYPE) {
                delete items.rdfPathItem;
            }
        case NODE_TYPE_FOLDER:
            //delete items.newSeparatorItem;
            delete items.openOriginalItem;
            delete items.propertiesItem;
            delete items.copyLinkItem;
            //delete items.shareItem;
            if (items.shareItem) {
                delete items.shareItem.submenu.dropboxItem;
                delete items.shareItem.submenu.oneDriveItem;
            }
            if (ctxNode.type === NODE_TYPE_FOLDER)
                delete items.rdfPathItem;
            if (ctxNode.external && ctxNode.external !== CLOUD_EXTERNAL_TYPE)
                delete items.newItem.submenu.newNotesItem;
            if (ctxNode.special_browser_folder) {
                delete items.cutItem;
                delete items.copyItem;
                delete items.renameItem;
                delete items.deleteItem;
                delete items.newItem.submenu.newSeparatorItem;
                delete items.newItem.submenu.newSiblingFolderItem;
            }
            if (ctxNode.external === RDF_EXTERNAL_TYPE) {
                delete items.cutItem;
                delete items.copyItem;
                delete items.pasteItem;
            }
            break;
        case NODE_TYPE_NOTES:
        case NODE_TYPE_FILE:
            delete items.newItem.submenu.newNotesItem;
            delete items.openInContainerItem;
            delete items.copyLinkItem;
            delete items.pasteItem;
        case NODE_TYPE_BOOKMARK:
            delete items.openOriginalItem;
        case NODE_TYPE_ARCHIVE:
            delete items.orderItem;
            delete items.openAllItem;
            delete items.newItem.submenu.newFolderItem;
            delete items.renameItem;
            delete items.rdfPathItem;
            delete items.checkLinksItem;
            delete items.uploadItem;
            delete items.exportItem;
            if (ctxNode.external === RDF_EXTERNAL_TYPE) {
                delete items.cutItem;
                delete items.copyItem;
                delete items.pasteItem;
                delete items.shareItem.submenu.cloudItem;
                delete items.shareItem.submenu.dropboxItem;
                delete items.shareItem.submenu.oneDriveItem;
            }
            break;
    }

    if (ctxNode.type !== NODE_TYPE_BOOKMARK)
        delete items.archiveItem;

    if (ctxNode.type === NODE_TYPE_SEPARATOR) {
        const deleteItem = items.deleteItem;
        const renameItem = items.renameItem;

        items.newSiblingFolderItem = items.newItem.submenu.newSiblingFolderItem;
        items.newSiblingFolderItem.icon = undefined;
        items.newSiblingFolderItem.label = "New Sibling Folder";

        for (let k in items)
            if (!["newSiblingFolderItem"].find(s => s === k))
                delete items[k];

        items.renameItem = renameItem;
        items.deleteItem = deleteItem;
    }

    if (selectedNodes.length < 2) {
        delete items.openItem;
    }

    if (isContentNode(ctxNode)) {
        delete items.newItem.submenu.newBookmarkItem;

        if (!ctxNode.has_notes || ctxNode.type === NODE_TYPE_NOTES) {
            delete items.openNotesItem;
            if (items.newItem.submenu.newNotesItem)
                items.newItem.submenu.newNotesItem.label = "Attached Notes";
        }
        else if (ctxNode.has_notes) {
            delete items.newItem.submenu.newNotesItem;
        }
    }
    else {
        delete items.openNotesItem;
    }

    if (ctxNode.__extended_todo) {
        delete items.newItem.submenu.newSeparatorItem;
        delete items.newItem.submenu.newSiblingFolderItem;
    }

    if (!(ctxNode.__filtering || ctxNode.__extended_todo)) {
        delete items.locateItem;
    }

    if (multiselect) {
        items["newItem"] && (items["newItem"]._disabled = true);
        items["orderItem"] && (items["orderItem"]._disabled = true);
        items["uploadItem"] && (items["uploadItem"]._disabled = true);
        items["exportItem"] && (items["exportItem"]._disabled = true);
        items["renameItem"] && (items["renameItem"]._disabled = true);
        items["copyLinkItem"] && (items["copyLinkItem"]._disabled = true);
        items["openNotesItem"] && (items["openNotesItem"]._disabled = true);
        items["propertiesItem"] && (items["propertiesItem"]._disabled = true);
        items["checkLinksItem"] && (items["checkLinksItem"]._disabled = true);
        items["openOriginalItem"] && (items["openOriginalItem"]._disabled = true);
    }

    if (!settings.debug_mode())
        delete items.debugItem;

    if (!browser.contextualIdentities)
        delete items.openInContainerItem;

    if (ctxNode.external === BROWSER_EXTERNAL_TYPE || ctxNode.external === RDF_EXTERNAL_TYPE) {
        delete items.newItem.submenu.newNotesItem;

        if (ctxNode.external === RDF_EXTERNAL_TYPE) {
            delete items.exportItem;
        }
    }

    if (ctxNode.external === RDF_EXTERNAL_TYPE && ctxNode.type === NODE_TYPE_SHELF) {
        items.deleteItem.label = "Close";
    }

    if (ctxNode.type === NODE_TYPE_SHELF && ctxNode.external === FILES_EXTERNAL_TYPE) {
        for (let k in items)
            if (!["addFilesDirectoryItem"].find(s => s === k))
                delete items[k];
    }
    else {
        delete items.addFilesDirectoryItem;
    }

    if (ctxNode.external === FILES_EXTERNAL_TYPE) {
        delete items.cutItem;
        delete items.pasteItem;
        delete items.newItem;
        delete items.newItem;
        delete items.uploadItem;
        delete items.checkLinksItem;
        delete items.openInContainerItem;

        if (ctxNode.type === NODE_TYPE_FILE) {
            delete items.shareItem.submenu.cloudItem;
            delete items.openWithEditorItem;
            delete items.copyItem;
        }

        if (items.copyItem)
            items.copyItem.separator_before = true;

        if (!ctxNode.external_id?.startsWith(FILES_EXTERNAL_ROOT_PREFIX))
            delete items.deleteItem;

        if (isContainerNode(ctxNode))
            delete items.openWithEditorItem;
    }
    else {
        delete items.openWithEditorItem;
    }

    return items;
}
