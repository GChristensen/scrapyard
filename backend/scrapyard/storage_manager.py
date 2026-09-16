import io
import os
import json
import shutil
import logging
import zipfile
import tempfile
import threading
import time

from pathlib import Path

from werkzeug.exceptions import Conflict

from . import storage_sync
from .rwlock import path_lock
from .server_paths import validate_uuid, safe_join_path
from .storage_node_db import NodeDB
from .utils_fs import atomic_write, atomic_file, atomic_directory, DirectoryLock, DirectoryLockedError

SCRAPYARD_DIRECTORY = "scrapyard"
CLOUD_DIRECTORY = "cloud"
OBJECT_DIRECTORY = "objects"
ARCHIVE_DIRECTORY = "archive"
NODE_DB_FILE = "index.jsbk"
NODE_OBJECT_FILE = "item.json"
ICON_OBJECT_FILE = "icon.json"
ARCHIVE_INDEX_OBJECT_FILE = "archive_index.json"
ARCHIVE_OBJECT_FILE = "archive.json"
ARCHIVE_CONTENT_FILE = "archive_content.blob"
NOTES_INDEX_OBJECT_FILE = "notes_index.json"
NOTES_OBJECT_FILE = "notes.json"
COMMENTS_INDEX_OBJECT_FILE = "comments_index.json"
COMMENTS_OBJECT_FILE = "comments.json"

# a batch session keeps the index in memory, and the index file is not updated until the session is closed;
# a session abandoned by a client that has lost the connection is saved and closed after the idle timeout
BATCH_SESSION_IDLE_TIMEOUT = 60
BATCH_SESSION_WATCHDOG_INTERVAL = 10


class StorageManager:
    ARCHIVE_TYPE_BYTES = "bytes"
    ARCHIVE_TYPE_TEXT = "text"
    ARCHIVE_TYPE_FILES = "files"

    def __init__(self, port, data_path=None):
        self.port = port
        # in the server mode the data path is configured on the server and the path passed by clients is ignored
        self.data_path = data_path
        self.bach_node_db = None
        self.batch_node_db_path = None
        # the number of openings of the batch session by each owner, see open_batch_session
        self.batch_owners = dict()
        self.batch_activity = 0
        self.batch_mutex = threading.RLock()
        self.directory_locks = dict()
        self.locked_directories = set()
        self.directory_locks_mutex = threading.Lock()

    def get_data_directory(self, params):
        data_directory = self._get_data_directory(params)
        self.lock_data_directory(data_directory)
        return data_directory

    def _get_data_directory(self, params):
        if self.data_path:
            return self.data_path
        return os.path.expanduser(params["data_path"])

    def lock_data_directory(self, data_directory):
        """Fails if the storage is used by another backend process, the in-process locks do not protect it.
        A directory that does not exist yet is locked on the first access after it is created."""
        if data_directory in self.locked_directories:
            return

        with self.directory_locks_mutex:
            if data_directory in self.locked_directories or not os.path.isdir(data_directory):
                return

            # the same directory may be specified by different paths
            key = os.path.normcase(os.path.realpath(data_directory))

            if key not in self.directory_locks:
                try:
                    self.directory_locks[key] = DirectoryLock(data_directory)
                except DirectoryLockedError as e:
                    logging.error(str(e))
                    raise Conflict(str(e))

            self.locked_directories.add(data_directory)

    def get_node_db_path(self, params):
        return os.path.join(self.get_data_directory(params), NODE_DB_FILE)

    def get_object_root_directory(self, params):
        return os.path.join(self.get_data_directory(params), OBJECT_DIRECTORY)

    def get_object_directory(self, params, uuid=None):
        if not uuid:
            uuid = params["uuid"]

        validate_uuid(uuid)
        return os.path.join(self.get_data_directory(params), OBJECT_DIRECTORY, uuid)

    def get_temp_directory(self):
        temp_directory_path = os.path.join(tempfile.gettempdir(), f"{SCRAPYARD_DIRECTORY}_{self.port}")

        if not os.path.exists(temp_directory_path):
            Path(temp_directory_path).mkdir(parents=True, exist_ok=True)

        return temp_directory_path

    def get_cloud_archive_temp_directory(self, params):
        temp_directory = self.get_temp_directory()
        return os.path.join(temp_directory, CLOUD_DIRECTORY, params["uuid"], ARCHIVE_DIRECTORY)

    def get_node_object_path(self, object_directory):
        return os.path.join(object_directory, NODE_OBJECT_FILE)

    def get_icon_object_path(self, object_directory):
        return os.path.join(object_directory, ICON_OBJECT_FILE)

    def get_comments_object_path(self, object_directory):
        return os.path.join(object_directory, COMMENTS_OBJECT_FILE)

    def get_archive_unpacked_path(self, object_directory):
        return os.path.join(object_directory, ARCHIVE_DIRECTORY)

    def get_archive_object_path(self, object_directory):
        return os.path.join(object_directory, ARCHIVE_OBJECT_FILE)

    def get_archive_content_path(self, object_directory):
        return os.path.join(object_directory, ARCHIVE_CONTENT_FILE)

    def get_archive_index_object_path(self, object_directory):
        return os.path.join(object_directory, ARCHIVE_INDEX_OBJECT_FILE)

    def get_notes_index_object_path(self, object_directory):
        return os.path.join(object_directory, NOTES_INDEX_OBJECT_FILE)

    def get_comments_index_object_path(self, object_directory):
        return os.path.join(object_directory, COMMENTS_INDEX_OBJECT_FILE)

    def compute_directory_size(self, path):
        root_directory = Path(path)
        return sum(f.stat().st_size for f in root_directory.glob('**/*') if f.is_file())

    # Batch sessions may overlap (e.g., simultaneous operations in different browsers), so the openings
    # are counted per owner, and the session is saved when all its owners have closed it. A close by an owner
    # that has not opened the session is ignored, so it could not end the session of others.
    # The owner is the id of the client session in the server mode, and None otherwise.

    def open_batch_session(self, params, owner=None):
        node_db_path = self.get_node_db_path(params)

        with self.batch_mutex:
            if self.bach_node_db and self.batch_node_db_path != node_db_path:
                # the session of another storage directory could not be shared
                self._save_batch_session()

            if not self.bach_node_db:
                self.bach_node_db = NodeDB.from_file(node_db_path)
                self.batch_node_db_path = node_db_path

                watchdog = threading.Thread(target=self._batch_session_watchdog, args=(self.bach_node_db,),
                                            daemon=True)
                watchdog.start()

            self.batch_owners[owner] = self.batch_owners.get(owner, 0) + 1
            self.batch_activity = time.monotonic()

    def close_batch_session(self, params=None, owner=None, force=False):
        """Closes the session opened by the owner. Forced close saves the session regardless of its owners,
        e.g., when the user cancels a batch session that has not been closed."""
        with self.batch_mutex:
            if force:
                self._save_batch_session()
            elif owner in self.batch_owners:
                self.batch_owners[owner] -= 1

                if self.batch_owners[owner] <= 0:
                    del self.batch_owners[owner]

                if not self.batch_owners:
                    self._save_batch_session()

    def close_batch_session_of(self, owner):
        """Closes all openings of the session by the given client session, e.g., after its WebSocket is disconnected."""
        with self.batch_mutex:
            if self.bach_node_db and owner is not None and owner in self.batch_owners:
                logging.warning("Closing a batch session of a disconnected client")
                del self.batch_owners[owner]

                if not self.batch_owners:
                    self._save_batch_session()

    def flush_batch_session(self):
        """Writes the index of an open batch session, so the index file could be read by other clients."""
        with self.batch_mutex:
            if self.bach_node_db:
                self.bach_node_db.save(self.batch_node_db_path)

    def is_batch_session_open(self):
        return {"result": not not self.bach_node_db}

    def _save_batch_session(self):
        # the session remains open if the index could not be written, so its changes are not lost
        if self.bach_node_db:
            self.bach_node_db.save(self.batch_node_db_path)
            self.bach_node_db = None
            self.batch_node_db_path = None
            self.batch_owners.clear()

    def _batch_session_watchdog(self, node_db):
        while True:
            time.sleep(BATCH_SESSION_WATCHDOG_INTERVAL)

            with self.batch_mutex:
                if self.bach_node_db is not node_db:
                    return

                if time.monotonic() - self.batch_activity > BATCH_SESSION_IDLE_TIMEOUT:
                    try:
                        logging.warning("Closing an abandoned batch session")
                        self._save_batch_session()
                        return
                    except Exception as e:
                        logging.exception(e)

    def with_node_db(self, params, f):
        # the mutex is held during the modification of the index file, so a batch session could not be opened
        # with a copy of the index that misses the modification
        with self.batch_mutex:
            if self.bach_node_db:
                self.batch_activity = time.monotonic()
                f(self.bach_node_db)
            else:
                node_db_path = self.get_node_db_path(params)
                NodeDB.with_file(node_db_path, f)

    def inspect_node_db(self, params, f):
        """Performs f on the actual index, while it could not be modified by others. The index file is not written."""
        with self.batch_mutex:
            if self.bach_node_db:
                return f(self.bach_node_db)
            else:
                node_db_path = self.get_node_db_path(params)
                return NodeDB.with_file_exclusive(node_db_path, f)

    def check_directory(self, params):
        # does not lock the directory, which may be chosen by mistake
        node_db_path = os.path.join(self._get_data_directory(params), NODE_DB_FILE)

        if os.path.exists(node_db_path):
            return dict(status="populated")
        else:
            return dict(error="empty")

    def clean_temp_directory(self):
        temp_directory = self.get_temp_directory()

        if os.path.exists(temp_directory):
            try:
                shutil.rmtree(temp_directory)
            except Exception as e:
                logging.exception(e)

    def persist_node(self, params):
        def persist(node_db):
            node_db.add_node(params["node"])
            self.persist_node_object(params)

        self.with_node_db(params, persist)

    @staticmethod
    def check_nodes_exist(node_db, nodes):
        # updates contain only the modified fields, an update of a node that has been deleted
        # (e.g., by a concurrent request) would add an incomplete node to the index
        missing = [n["uuid"] for n in nodes if n["uuid"] not in node_db.nodes]

        if missing:
            raise Conflict(f"Can not update nonexistent items: {', '.join(missing)}")

    def update_node(self, params):
        def update(node_db):
            # an upsert contains the complete node, e.g., a new archive that is added to the storage after its capture
            if not params.get("upsert", False):
                self.check_nodes_exist(node_db, [params["node"]])
            params["node"] = node_db.update_node(params["node"], params["remove_fields"])
            self.persist_node_object(params)

        self.with_node_db(params, update)

    def update_nodes(self, params):
        def update(node_db):
            nodes = params["nodes"]
            remove_fields = params["remove_fields"]

            self.check_nodes_exist(node_db, nodes)

            for i in range(len(nodes)):
                params["node"] = node_db.update_node(nodes[i], remove_fields[i])
                self.persist_node_object(params)

        self.with_node_db(params, update)

    def delete_nodes(self, params):
        self.delete_nodes_shallow(params)
        self.delete_node_content(params)

    def delete_nodes_shallow(self, params):
        def delete(node_db):
            for uuid in params["node_uuids"]:
                node_db.delete_node(uuid)

        self.with_node_db(params, delete)

    def delete_node_content(self, params):
        for uuid in params["node_uuids"]:
            object_directory_path = self.get_object_directory(params, uuid)

            with path_lock(object_directory_path).write_locked():
                try:
                    shutil.rmtree(object_directory_path)
                except FileNotFoundError:
                    pass
                except Exception as e:
                    # e.g., a file is opened by another process on Windows, the remaining content is orphaned
                    logging.exception(e)

    def wipe_storage(self, params):
        with self.batch_mutex:
            if self.bach_node_db:
                self.bach_node_db.reset()

            try:
                node_db_path = self.get_node_db_path(params)
                NodeDB.delete_file(node_db_path)
            except FileNotFoundError:
                pass
            except Exception as e:
                logging.exception(e)

            try:
                object_root_directory = self.get_object_root_directory(params)
                shutil.rmtree(object_root_directory)
            except FileNotFoundError:
                pass
            except Exception as e:
                logging.exception(e)

    def persist_object(self, object_file_name, params, param_name):
        object_directory_path = self.get_object_directory(params)
        object_file_path = os.path.join(object_directory_path, object_file_name)

        atomic_write(object_file_path, params[param_name])

    def persist_node_object(self, params):
        params["uuid"] = params["node"]["uuid"]
        params["node_json"] = json.dumps(params["node"], ensure_ascii=False, separators=(',', ':'))
        self.persist_object(NODE_OBJECT_FILE, params, "node_json")

    # Archive content is replaced atomically, so an interrupted write never damages an existing archive,
    # and readers do not observe partially written files

    def persist_archive_content(self, params, files):
        object_directory_path = self.get_object_directory(params)

        with path_lock(object_directory_path).write_locked():
            if params.get("contains", None) == StorageManager.ARCHIVE_TYPE_FILES:
                archive_directory_path = self.get_archive_unpacked_path(object_directory_path)

                with atomic_directory(archive_directory_path) as temp_directory_path:
                    with zipfile.ZipFile(files["content"], "r", zipfile.ZIP_DEFLATED, False) as zip_file:
                        zip_file.extractall(temp_directory_path)
            else:
                content_file_path = os.path.join(object_directory_path, ARCHIVE_CONTENT_FILE)

                with atomic_file(content_file_path) as content_file:
                    files["content"].save(content_file)

    def save_archive_file(self, params, files, compute_index=False):
        """Saves a file of an unpacked archive, returns the word index of the archive if requested."""
        from .storage_rdf import build_archive_index

        object_directory_path = self.get_object_directory(params)
        archive_directory_path = self.get_archive_unpacked_path(object_directory_path)
        archive_file_path = safe_join_path(archive_directory_path, params["file"])

        with path_lock(object_directory_path).write_locked():
            with atomic_file(archive_file_path) as archive_file:
                files["content"].save(archive_file)

            if compute_index:
                return build_archive_index(archive_directory_path)

    def fetch_object(self, object_file_name, params):
        object_directory_path = self.get_object_directory(params)
        object_file_path = os.path.join(object_directory_path, object_file_name)

        result = None
        if os.path.exists(object_file_path):
            with open(object_file_path, "r", encoding="utf-8") as object_file:
                result = object_file.read()

        return result

    def fetch_archive_content(self, params):
        object_directory_path = self.get_object_directory(params)
        archive_directory_path = os.path.join(object_directory_path, ARCHIVE_DIRECTORY)

        with path_lock(object_directory_path).read_locked():
            if os.path.exists(archive_directory_path):
                return self.fetch_unpacked_archive(archive_directory_path)
            else:
                return self.fetch_packed_archive(object_directory_path)

    def fetch_archive_file(self, params):
        object_directory_path = self.get_object_directory(params)
        archive_directory_path = self.get_archive_unpacked_path(object_directory_path)
        archive_file_path = safe_join_path(archive_directory_path, params["file"])

        file_content = None
        if os.path.exists(archive_file_path):
            with open(archive_file_path, "rb") as archive_file:
                file_content = archive_file.read()

        return file_content

    def fetch_packed_archive(self, object_directory_path):
        content_file_path = os.path.join(object_directory_path, ARCHIVE_CONTENT_FILE)

        result = None
        if os.path.exists(content_file_path):
            with open(content_file_path, "rb") as content_file:
                return content_file.read()

        return result

    def fetch_unpacked_archive(self, archive_directory_path):
        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
            for root, dirs, files in os.walk(archive_directory_path):
                for file in files:
                    archive_filename = os.path.join(root.replace(archive_directory_path, ""), file)
                    filename = os.path.join(root, file)

                    with open(filename, "rb") as content_file:
                        file_content = content_file.read()

                    zip_file.writestr(archive_filename, file_content)

        return zip_buffer.getvalue()

    def get_archive_size(self, params):
        object_directory_path = self.get_object_directory(params)
        archive_directory_path = self.get_archive_unpacked_path(object_directory_path)
        result = None

        with path_lock(object_directory_path).read_locked():
            if os.path.exists(archive_directory_path):
                result = dict(size=self.compute_directory_size(archive_directory_path))
            else:
                archive_file_path = self.get_archive_content_path(object_directory_path)
                if os.path.exists(archive_file_path):
                    result = dict(size=os.path.getsize(archive_file_path))

        return result

    def persist_icon(self, params):
        self.persist_object(ICON_OBJECT_FILE, params, "icon_json")

    def persist_archive_index(self, params):
        self.persist_object(ARCHIVE_INDEX_OBJECT_FILE, params, "index_json")

    def persist_archive_object(self, params):
        self.persist_object(ARCHIVE_OBJECT_FILE, params, "archive_json")

    def fetch_archive_object(self, params):
        return self.fetch_object(ARCHIVE_OBJECT_FILE, params)

    def fetch_archive_metadata(self, params):
        archive_object_json = self.fetch_object(ARCHIVE_OBJECT_FILE, params)

        if archive_object_json:
            return json.loads(archive_object_json)

    def persist_notes_index(self, params):
        self.persist_object(NOTES_INDEX_OBJECT_FILE, params, "index_json")

    def persist_notes(self, params):
        notes_file_path = os.path.join(self.get_object_directory(params), NOTES_OBJECT_FILE)

        # read-modify-write
        with path_lock(notes_file_path).write_locked():
            existing_notes = self.fetch_notes(params) or "{}"
            existing_notes = json.loads(existing_notes)
            new_notes = json.loads(params["notes_json"])
            new_notes = {**existing_notes, **new_notes}
            params["notes_json"] = json.dumps(new_notes)
            self.persist_object(NOTES_OBJECT_FILE, params, "notes_json")

    def fetch_notes(self, params):
        return self.fetch_object(NOTES_OBJECT_FILE, params)

    def persist_comments_index(self, params):
        self.persist_object(COMMENTS_INDEX_OBJECT_FILE, params, "index_json")

    def persist_comments(self, params):
        self.persist_object(COMMENTS_OBJECT_FILE, params, "comments_json")

    def fetch_comments(self, params):
        return self.fetch_object(COMMENTS_OBJECT_FILE, params)

    def get_metadata(self, params):
        result = {"error": "error"}

        try:
            self.flush_batch_session()
            node_db_path = self.get_node_db_path(params)
            if os.path.exists(node_db_path):
                header = NodeDB.read_header(node_db_path)
                if header != "":
                    result = header
                else:
                    result = {"error": "empty"}
            else:
                result = {"error": "empty"}
        except Exception as e:
            logging.exception(e)

        return result

    def read_object_file(self, path):
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as object_file:
                return object_file.readline()

    def sync_open_session(self, params):
        storage_sync.open_session(self, params)

    def sync_close_session(self):
        storage_sync.close_session()

    def sync_compute(self, params):
        # the changes of a batch session performed by other clients should be visible to the synchronization
        self.flush_batch_session()
        return storage_sync.compute_sync(self, params)

    def sync_pull_objects(self, params):
        return storage_sync.pull_sync_objects(self, params)

    def get_orphaned_items(self, params):
        object_root_directory = self.get_object_root_directory(params)

        if os.path.exists(object_root_directory):
            disk_items = os.listdir(object_root_directory)

            # items of an open batch session are not orphaned
            def find_orphaned(node_db):
                return [uuid for uuid in disk_items if uuid not in node_db.nodes]

            return self.inspect_node_db(params, find_orphaned)

    def delete_orphaned_items(self, params):
        # the items might have been added to the index after they were reported as orphaned
        def delete(node_db):
            existing = [uuid for uuid in params["node_uuids"] if uuid in node_db.nodes]

            if existing:
                raise Conflict(f"Items are not orphaned: {', '.join(existing)}")

            self.delete_node_content(params)

        self.inspect_node_db(params, delete)

    def rebuild_item_index(self, params):
        node_db_path = self.get_node_db_path(params)
        object_root_directory = self.get_object_root_directory(params)

        def rebuild(node_db):
            nodes = {NodeDB.DEFAULT_SHELF_UUID: node_db.create_default_shelf()}

            for uuid in os.listdir(object_root_directory):
                node_object_file_path = os.path.join(object_root_directory, uuid, NODE_OBJECT_FILE)

                if os.path.exists(node_object_file_path):
                    with open(node_object_file_path, "r", encoding="utf-8") as node_object_file:
                        node_json = node_object_file.read()
                        node = json.loads(node_json)
                        nodes[node["uuid"]] = node

            # the index is not modified if any item could not be read
            node_db.nodes = NodeDB.tree_sort_nodes(nodes)

        with self.batch_mutex:
            # the index of the batch session would overwrite the rebuilt one
            if self.bach_node_db:
                raise Conflict("Can not rebuild the index while a batch operation is in progress.")

            NodeDB.with_file(node_db_path, rebuild)

    def debug_get_stored_node_instances(self, params):
        node_db_path = self.get_node_db_path(params)
        node_db = NodeDB.from_file(node_db_path)
        items = list(node_db.nodes.items())
        n_items = len(items)
        result = "{"

        for i in range(n_items):
            uuid, node = items[i]
            object_directory = self.get_object_directory(params, uuid)
            node_object_path = self.get_node_object_path(object_directory)

            node_object_json = "{}"
            if os.path.exists(node_object_path):
                with open(node_object_path, "r", encoding="utf-8") as node_object_file:
                    node_object_json = node_object_file.read()

            result += f'"{uuid}": {{"db_item": {json.dumps(node)}, "object_item": {node_object_json}}}'

            if i < n_items - 1:
                result += ","

        result += "}"

        return result
