import {backend} from "./backend.js"
import {settings} from "./settings.js"

import {
    CLOUD_SHELF_UUID, DEFAULT_SHELF_ID,
    DEFAULT_SHELF_NAME, DEFAULT_SHELF_UUID,
    EVERYTHING,
    FIREFOX_SHELF_UUID,
    NODE_TYPE_UNLISTED
} from "./storage.js";
import {send} from "./proxy.js";

const RESERVED_SHELVES = [CLOUD_SHELF_UUID, FIREFOX_SHELF_UUID, DEFAULT_SHELF_UUID];

export async function prepareNewImport(shelf) {
    if (settings.undo_failed_imports())
        return;

    if (shelf === EVERYTHING) {
        return backend.wipeEverything();
    }
    else {
        shelf = await backend.queryShelf(shelf);

        if (shelf && shelf.name === DEFAULT_SHELF_NAME) {
            return backend.deleteChildNodes(shelf.id);
        } else if (shelf) {
            return backend.deleteNodes(shelf.id);
        }
    }
}

async function createRollbackNode(shelf) {
    let rollbackNode = {
        name: "_" + shelf,
        type: NODE_TYPE_UNLISTED
    };

    return backend.addNode(rollbackNode);
}

async function relocateNodes(nodes, dest) {
    for (let node of nodes) {
        await backend.updateNode({id: node.id, parent_id: dest?.id || undefined}, false);
    }
}

async function maskUUIDs(rollbackNode) {
    const rollbackItemIds = await backend.queryFullSubtreeIds(rollbackNode.id);

    await backend.updateNodes(node => {
        node._unlisted = true;
        node._uuid = node.uuid;
        node.uuid = undefined;
    }, rollbackItemIds)
}

async function unmaskUUIDs(rollbackNode) {
    const rollbackItemIds = await backend.queryFullSubtreeIds(rollbackNode.id);

    await backend.updateNodes(node => {
        node._unlisted = undefined;
        node.uuid = node._uuid;
        node._uuid = undefined;
    }, rollbackItemIds)
}

export async function createRollback(shelf) {
    if (shelf === EVERYTHING) {
        const rollbackNode = await createRollbackNode(EVERYTHING);
        let shelves = await backend.queryShelf();
        shelves = shelves.filter(n => !RESERVED_SHELVES.some(uuid => uuid === n.uuid));
        await relocateNodes(shelves, rollbackNode);
        await maskUUIDs(rollbackNode);

        await createRollback(DEFAULT_SHELF_NAME);
    }
    else {
        shelf = await backend.queryShelf(shelf);
        if (shelf) {
            const rollbackNode = await createRollbackNode(shelf.name);
            const nodes = await backend.getChildNodes(shelf.id);
            await relocateNodes(nodes, rollbackNode);
            await maskUUIDs(rollbackNode);
        }
    }
}

async function cleanRollback() {
    const unlisted = await backend.queryUnlisted();
    let rollbackItems = [];

    for (const node of unlisted) {
        rollbackItems = [...await backend.queryFullSubtreeIds(node.id), ...rollbackItems];
    }

    await backend.deleteNodesLowLevel(rollbackItems);
}

async function cleanFailedImport(shelf, exists) {
    if (shelf === EVERYTHING) {
        let shelves = await backend.queryShelf();
        shelves = shelves.filter(n => !RESERVED_SHELVES.some(uuid => uuid === n.uuid));

        let failedItems = [];

        for (const node of shelves) {
            failedItems = [...await backend.queryFullSubtreeIds(node.id), ...failedItems];
        }

        await backend.deleteNodesLowLevel(failedItems);
    }
    else {
        shelf = await backend.queryShelf(shelf);

        if (shelf) {
            const failedItems = await backend.queryFullSubtreeIds(shelf.id);
            if (exists)
                failedItems.shift();
            await backend.deleteNodesLowLevel(failedItems);
        }
    }
}

export async function rollbackImport(shelf, exists) {
    if (shelf === EVERYTHING) {
        await cleanFailedImport(EVERYTHING, true);

        const rollbackNode = await backend.queryUnlisted("_" + EVERYTHING);
        await unmaskUUIDs(rollbackNode);
        const shelves = await backend.getChildNodes(rollbackNode.id);
        await relocateNodes(shelves, null);

        await backend.deleteNodesLowLevel(rollbackNode.id);

        await rollbackImport(DEFAULT_SHELF_NAME, true);
    }
    else {
        await cleanFailedImport(shelf, exists);

        const rollbackNode = await backend.queryUnlisted("_" + shelf);
        shelf = await backend.queryShelf(shelf);
        if (rollbackNode && shelf) {
            await unmaskUUIDs(rollbackNode);
            const nodes = await backend.getChildNodes(rollbackNode.id);
            await relocateNodes(nodes, shelf);
            await backend.deleteNodesLowLevel(rollbackNode.id);
        }
    }
}

export async function importTransaction(shelf, importf) {
    const exists = shelf === EVERYTHING || !!await backend.queryShelf(shelf);
    const undo = settings.undo_failed_imports();

    if (exists && undo) {
        try { send.importInitializingTransaction(); } catch {}

        await cleanRollback();
        _tm()
        await createRollback(shelf);
        _te()
    }

    let result;
    try {
        result = await importf();
    }
    catch (e) {
        if (undo) {
            try { send.importRollingBack(); } catch {}

            await rollbackImport(shelf, exists);
        }
        throw e;
    }

    if (exists && undo) {
        try { send.importFinalizingTransaction(); } catch {}

        await cleanRollback(shelf);
    }

    return result;
}
