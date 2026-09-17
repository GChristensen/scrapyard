import {NODE_TYPE_ARCHIVE} from "./storage.js";
import {Archive, Comments, Icon, Node, Notes} from "./storage_entities.js";
import {UnmarshallerJSONScrapbook} from "./marshaller_json_scrapbook.js";

export class UnmarshallerCloud extends UnmarshallerJSONScrapbook {
    constructor() {
        super();
        this.setSyncMode();
        this.setIDBOnlyMode();
    }

    async unmarshal(provider, cloudNode) {
        return this.store(await this.prepare(provider, cloudNode));
    }

    // downloads the content of a changed node, does not depend on the other nodes, so may be called concurrently;
    // returns undefined if the node is not changed
    async prepare(provider, cloudNode) {
        cloudNode = this.unconvertNode(cloudNode);

        const node = await Node.getByUUID(cloudNode.uuid);
        let fetchContent = true;

        if (node) {
            if (!(cloudNode.date_modified > node.date_modified))
                return;

            fetchContent = cloudNode.content_modified > node.date_modified;
        }

        const [content, indexes] = await Promise.all([
            fetchContent? this._unmarshalContent(provider, cloudNode): {},
            this._fetchIndexes(provider, cloudNode)
        ]);

        return {cloudNode, content, indexes};
    }

    // stores a prepared node, the parent of the node should be already stored
    async store(prepared) {
        if (!prepared)
            return;

        const {cloudNode, content, indexes} = prepared;

        await this.findParentInIDB(cloudNode);
        const node = await this.storeContent({node: cloudNode, ...content});
        await this._storeIndexes(node, indexes);
    }

    async _unmarshalContent(provider, node) {
        const content = {};

        const [icon, comments] = await Promise.all([
            node.stored_icon? provider.assets.fetchIcon(node.uuid): undefined,
            node.has_comments? provider.assets.fetchComments(node.uuid): undefined
        ]);

        if (icon) {
            const unconvertedIcon = this.unconvertIcon(JSON.parse(icon));
            node.icon = await Icon.computeHash(unconvertedIcon.data_url);
            content.icon = unconvertedIcon;
        }

        if (comments)
            content.comments = this.unconvertComments(JSON.parse(comments));

        return content;
    }

    async _fetchIndexes(provider, node) {
        const [archiveIndex, notesIndex, commentsIndex] = await Promise.all([
            node.type === NODE_TYPE_ARCHIVE? provider.assets.fetchArchiveIndex(node.uuid): undefined,
            node.has_notes? provider.assets.fetchNotesIndex(node.uuid): undefined,
            node.has_comments? provider.assets.fetchCommentsIndex(node.uuid): undefined
        ]);

        const unconvert = index => index? this.unconvertIndex(JSON.parse(index)): undefined;

        return {
            archiveIndex: unconvert(archiveIndex),
            notesIndex: unconvert(notesIndex),
            commentsIndex: unconvert(commentsIndex)
        };
    }

    async _storeIndexes(node, {archiveIndex, notesIndex, commentsIndex}) {
        if (archiveIndex)
            await Archive.idb.import.storeIndex(node, archiveIndex.words);

        if (notesIndex)
            await Notes.idb.import.storeIndex(node, notesIndex.words);

        if (commentsIndex)
            await Comments.idb.import.storeIndex(node, commentsIndex.words);
    }
}
