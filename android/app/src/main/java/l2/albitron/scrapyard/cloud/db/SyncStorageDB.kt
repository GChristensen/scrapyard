package l2.albitron.scrapyard.cloud.db

import l2.albitron.scrapyard.Scrapyard
import l2.albitron.scrapyard.cloud.db.model.*
import l2.albitron.scrapyard.cloud.providers.CloudProvider

private const val SYNC_STORAGE_PATH = "/Sync"
private const val SYNC_DB_INDEX = "index.jsbk"

class SyncStorageDB: AbstractCloudDB, CloudDB {
    override var _provider: CloudProvider
    override var _meta: JSONScrapbookMeta

    constructor(provider: CloudProvider) {
        _provider = provider
        _meta = createTypeMeta()
    }

    override fun createTypeMeta(): JSONScrapbookMeta {
        return super.createMeta(Scrapyard.FORMAT_TYPE_INDEX, Scrapyard.FORMAT_CONTAINS_SHELVES)
    }

    override fun getDatabaseFile(): String = SYNC_DB_INDEX
    override fun getCloudPath(file: String): String = "${SYNC_STORAGE_PATH}/$file"
    override fun getSharingShelfUUID(): String = Scrapyard.DEFAULT_SHELF_UUID

    override fun getType(): String {
        return DATABASE_TYPE
    }

    companion object {
        const val DATABASE_TYPE = "sync"
    }
}
