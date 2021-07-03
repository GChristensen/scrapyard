import {
    DEFAULT_SHELF_NAME,
    DEFAULT_SHELF_UUID,
    NODE_TYPE_SHELF,
} from "./storage.js";

import Dexie from "./lib/dexie.js"

const dexie = new Dexie("scrapyard");

dexie.version(1).stores({
    nodes: `++id,&uuid,parent_id,type,name,uri,tag_list,date_added,date_modified,todo_state,todo_date`,
    blobs: `++id,&node_id,size`,
    index: `++id,&node_id,*words`,
    notes: `++id,&node_id`,
    tags: `++id,name`
});
dexie.version(2).stores({
    nodes: `++id,&uuid,parent_id,type,name,uri,tag_list,date_added,date_modified,todo_state,todo_date,external,external_id`,
    blobs: `++id,&node_id,size`,
    index: `++id,&node_id,*words`,
    notes: `++id,&node_id`,
    tags: `++id,name`
});
dexie.version(3).stores({
    nodes: `++id,&uuid,parent_id,type,name,uri,tag_list,date_added,date_modified,todo_state,todo_date,external,external_id`,
    blobs: `++id,&node_id,size`,
    index: `++id,&node_id,*words`,
    notes: `++id,&node_id`,
    tags: `++id,name`,
    icons: `++id,&node_id`
});
dexie.version(4).stores({
    nodes: `++id,&uuid,parent_id,type,name,uri,tag_list,date_added,date_modified,todo_state,todo_date,external,external_id`,
    blobs: `++id,&node_id,size`,
    index: `++id,&node_id,*words`,
    notes: `++id,&node_id`,
    tags: `++id,name`,
    icons: `++id,&node_id`,
    comments: `++id,&node_id`
});
dexie.version(5).stores({
    nodes: `++id,&uuid,parent_id,type,name,uri,tag_list,date_added,date_modified,todo_state,todo_date,external,external_id`,
    blobs: `++id,&node_id,size`,
    index: `++id,&node_id,*words`,
    notes: `++id,&node_id`,
    tags: `++id,name`,
    icons: `++id,&node_id`,
    comments: `++id,&node_id`,
    index_notes: `++id,&node_id,*words`,
    index_comments: `++id,&node_id,*words`
});
dexie.version(6).stores({
    nodes: `++id,&uuid,parent_id,type,name,uri,tag_list,date_added,date_modified,todo_state,todo_date,external,external_id`,
    blobs: `++id,&node_id,size`,
    index: `++id,&node_id,*words`,
    notes: `++id,&node_id`,
    tags: `++id,name`,
    icons: `++id,&node_id`,
    comments: `++id,&node_id`,
    index_notes: `++id,&node_id,*words`,
    index_comments: `++id,&node_id,*words`,
    export_storage: `++id,process_id`,
});


dexie.on('populate', () => {
    dexie.nodes.add({name: DEFAULT_SHELF_NAME, type: NODE_TYPE_SHELF, uuid: DEFAULT_SHELF_UUID, date_added: new Date(), pos: 1});
});

// minimal database abstraction layer
class IDBStorage {
    constructor() {
        this.STORAGE_TYPE_ID = "IDB";
        this._db = dexie;
    }

    // transaction(mode, table, operation) {
    //     return this._db.transaction(mode, this._db[table], operation);
    // }

    add(entityType, record) {
        return this._db[entityType].add(record);
    }

    existsBy(entityType, field, value) {
        if (value === undefined || value === null)
            return false;

        return this._db[entityType].where(field).equals(value).count();
    }

    // async existsBy2(entityType, field1, value1, field2, value2) {
    //     return !!(await this._db[entityType].where(field1).equals(value1).and(n => n[field2] === value2).count());
    // }

    get(entityType, id) {
        return this._db[entityType].where("id").equals(id).first();
    }

    getBelow(entityType, field, value) {
        return this._db[entityType].where(field).below(value).toArray();
    }

    getAboveOrEqual(entityType, field, value) {
        return this._db[entityType].where(field).aboveOrEqual(value).toArray();
    }

    getAll(entityType, ids) {
        if (!ids)
            return this._db[entityType].toArray();

        return this._db[entityType].where("id").anyOf(ids).toArray();
    }

    getBy(entityType, field, value) {
        return this._db[entityType].where(field).equals(value).first();
    }

    getBy2(entityType, field1, value1, field2, value2) {
        return this._db[entityType].where(field1).equals(value1).and(n => n[field2] === value2).first();
    }

    getByPredicate(entityType, field, value, predicate) {
        return this._db[entityType].where(field).equals(value).and(predicate).first();
    }

    getAllBy(entityType, field, value) {
        return this._db[entityType].where(field).equals(value).toArray();
    }

    getAllBySorting(entityType, field, value, sortingField) {
        return this._db[entityType].where(field).equals(value).sortBy(sortingField);
    }

    getAllByAnyOf(entityType, field, values) {
        return this._db[entityType].where(field).anyOf(values).toArray();
    }

    getAllByPredicate(entityType, field, value, predicate) {
        return this._db[entityType].where(field).equals(value).and(predicate).toArray();
    }

    getIds(entityType) {
        return this._db[entityType].orderBy("id").keys();
    }

    async getIdsBy(entityType, field, value, out) {
        const ids = out || [];
        await this._db[entityType].where(field).equals(value).each(n => ids.push(n.id));

        return ids;
    }

    async getMissingIdsBy2(entityType, field1, value1, field2, values2) {
        const existing = new Set(values2);

        const ids = [];
        await this._db[entityType].where(field1).equals(value1)
            .and(n => n[field2] && !existing.has(n[field2]))
            .each(n => ids.push(n.id));

        return ids;
    }

    modify(entityType, record) {
        return this._db[entityType].where("id").equals(record.id).modify(record);
    }

    modifyReferencedEntity(entityType, refField, value, record) {
        return this._db[entityType].where(refField).equals(value).modify(record);
    }

    modifyAll(entityType, ids, modfunc) {
        if (ids)
            return this._db[entityType].where("id").anyOf(ids).modify(modfunc);
        else
            return this._db[entityType].toCollection().modify(modfunc);
    }

    update(entityType, record) {
        return this._db[entityType].update(record.id, record);
    }

    iterate(entityType, iterator, filter) {
        if (filter)
            return this._db[entityType].filter(filter).each(iterator);
        else
            return this._db[entityType].each(iterator);
    }

    filter(entityType, filter, limit) {
        if (limit)
            return this._db[entityType].filter(filter).limit(limit).toArray();
        else
            return this._db[entityType].filter(filter).toArray();
    }

    filterIds(entityType, filter, ids, limit) {
        if (limit)
            return this._db[entityType].where("id").anyOf(ids).filter(filter).limit(limit).toArray();
        else
            return this._db[entityType].where("id").anyOf(ids).filter(filter).toArray();
    }

    async queryIndex(entityType, field, word, refField, ids) {
        let result = [];
        let query;

        if (ids)
            query = this._db[entityType].where(field).startsWith(word).and(i => ids.some(id => id === i[refField]));
        else
            query = this._db[entityType].where(field).startsWith(word);

        await query.each(w => result.push(w[refField]));

        return result;
    }

    deleteIds(entityType, ids) {
        return this._db[entityType].bulkDelete(ids);
    }

    async deleteReferencedEntity(entityType, refField, ids) {
        if (this._db.tables.some(t => t.name === entityType))
            await this._db[entityType].where(refField).anyOf(ids).delete();
    }

    clear(entityType) {
        return this._db[entityType].clear();
    }

    async wipeReferencedEntity(entityType, refField, retain) {
        if (this._db.tables.some(t => t.name === entityType))
            await this._db[entityType].where(refField).noneOf(retain).delete();
    }
}

export default IDBStorage;
