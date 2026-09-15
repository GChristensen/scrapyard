import {Undo} from "./storage_undo.js";
import {NODE_TYPE_SHELF, UNDO_DELETE, UNDO_REORDER} from "./storage.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import {Query} from "./storage_query.js";
import {Node} from "./storage_entities.js";

class UndoManager {

    async canUndo() {
        return (await Undo.peek()).stack >= 0;
    }

    async undo() {
        const undoTop = await Undo.peek();

        if (undoTop.stack >= 0)
            switch (undoTop.operation) {
                case UNDO_DELETE:
                    return this.#undoDelete();
                case UNDO_REORDER:
                    return this.#undoReorder();
            }
    }

    async pushDeleted(ids, subtree) {
        const stackIndex = (await Undo.peek()).stack + 1;

        let ctr = 0;
        for (const node of subtree) {
            const undoItem = {
                stack: stackIndex,
                operation: UNDO_DELETE,
                node,
                selectedIDs: ctr++ === 0? ids: undefined // (!) currently not used
            };

            await Undo.add(undoItem);
        }
    }

    async pushReordered(oldPositions, posProperty = "pos") {
        const stackIndex = (await Undo.peek()).stack + 1;

        let ctr = 0;
        for (const p of oldPositions) {
            await Undo.add({
                stack: stackIndex,
                operation: UNDO_REORDER,
                nodeId: p.id,
                uuid: p.uuid,
                parent_id: p.parent_id,
                external: p.external,
                external_id: p.external_id,
                pos: p[posProperty],
                posProperty: ctr++ === 0? posProperty: undefined
            });
        }
    }

    async #undoReorder() {
        const batch = await Undo.pop();
        const posProperty = batch[0].posProperty || "pos";

        const positions = batch.map(u => ({
            id: u.nodeId, uuid: u.uuid, parent_id: u.parent_id,
            external: u.external, external_id: u.external_id,
            [posProperty]: u.pos
        }));

        await Bookmark.reorder(positions, posProperty);

        const parentId = batch[0].parent_id;
        let shelf;
        if (parentId) {
            const parentNode = await Node.get(parentId);
            shelf = parentNode.type === NODE_TYPE_SHELF? parentNode: await Query.rootOf(parentNode);
        }

        return {operation: UNDO_REORDER, shelf};
    }

    async #undoDelete() {
        const batch = await Undo.pop();
        const selectedIDs = batch[0].selectedIDs;

        let shelf;
        for (const undo of batch) {
            if (undo.node.type === NODE_TYPE_SHELF)
                shelf = undo.node;

            await Bookmark.restore(undo.node);
        }

        if (!shelf)
            shelf = await Query.rootOf(batch[0].node);

        return {operation: UNDO_DELETE, selectedIDs, shelf};
    }

    async commit() {
        let batch = await Undo.pop();

        while (batch) {
            switch (batch[0].operation) {
                case UNDO_DELETE:
                    await this.#commitDelete(batch);
                    break;
            }

            batch = await Undo.pop();
        }
    }

    async #commitDelete(batch) {
        const nodes = batch.map(u => u.node);

        await Node.deleteDependencies(nodes);
    }

}

export const undoManager = new UndoManager();
