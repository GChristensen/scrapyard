// Archive nodes are added to the internal storage before their content is captured, and are added to
// the backend storage only when the content is stored (see Bookmark.idb.add usages and Node.updateContentModified).
// The synchronization removes the items that are absent in the backend storage from the internal storage,
// so the nodes with a capture in progress are registered here to be left alone by it.

// a capture that has not completed in this time is considered failed, and its node is no longer protected
const PENDING_NODE_TIMEOUT = 30 * 60000;

const pendingNodes = new Map();

export function markNodePending(node) {
    if (node?.uuid)
        pendingNodes.set(node.uuid, Date.now());
}

export function clearNodePending(node) {
    if (node?.uuid)
        pendingNodes.delete(node.uuid);
}

export function isNodePending(node) {
    const uuid = typeof node === "string"? node: node?.uuid;
    const since = pendingNodes.get(uuid);

    if (since === undefined)
        return false;

    if (Date.now() - since > PENDING_NODE_TIMEOUT) {
        pendingNodes.delete(uuid);
        return false;
    }

    return true;
}
