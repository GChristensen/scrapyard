import os
import json
import logging
import uuid

from datetime import datetime

from .rwlock import path_lock
from .utils_fs import atomic_write


class NodeDB:
    FORMAT_VERSION = 1
    DEFAULT_SHELF_NAME = "default"
    DEFAULT_SHELF_UUID = "default"

    def __init__(self):
        self.header = self.create_format_header()
        self.nodes = dict()

    # Access to the index file is guarded by a reader-writer lock associated with its path:
    # from_file, iterate and read_header are readers, save and with_file are writers.
    # The lock is not reentrant, so the functions passed to iterate and with_file should not call them.

    @classmethod
    def from_file(cls, path):
        db = cls()
        with path_lock(path).read_locked():
            db._read(path)
        return db

    @classmethod
    def with_file(cls, path, f):
        """Performs a read-modify-write transaction on the index file."""
        with path_lock(path).write_locked():
            node_db = cls()
            node_db._read(path)

            try:
                f(node_db)
            except Exception as e:
                logging.exception(e)

            node_db._write(path)

    @classmethod
    def delete_file(cls, path):
        with path_lock(path).write_locked():
            os.remove(path)

    @classmethod
    def iterate(cls, path, f):
        with path_lock(path).read_locked():
            cls._iterate(path, f)

    @classmethod
    def _iterate(cls, path, f):
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as node_db_file:
                node_db_file.readline()  # header

                node_json = node_db_file.readline()

                while node_json:
                    try:
                        node = json.loads(node_json)
                        f(node)
                    except Exception as e:
                        logging.exception(e)

                    node_json = node_db_file.readline()

    @classmethod
    def generate_uuid(cls):
        new_uuid = str(uuid.uuid4())
        new_uuid = new_uuid.replace("-", "")
        return new_uuid.upper()

    @classmethod
    def tree_sort_nodes(cls, nodes):
        items = nodes.items()
        children = dict()
        roots = []

        for uuid, n in items:
            parent_uuid = n.get("parent", None)
            if parent_uuid is None:
                roots.append(n)
            else:
                if parent_uuid in children:
                    children[parent_uuid].append(uuid)
                else:
                    children[parent_uuid] = [uuid]

        def get_subtree(p, acc=[]):
            children_uuids = children.get(p["uuid"], None)

            if children_uuids:
                for uuid in children_uuids:
                    node = nodes[uuid]
                    acc.append(node)
                    get_subtree(node, acc)

            return acc

        sorted_nodes = roots[:]

        for r in roots:
            sorted_nodes += get_subtree(r, [])

        result = dict()

        for node in sorted_nodes:
            result[node["uuid"]] = node

        return result

    def create_format_header(self):
        return {
            "format": "JSON Scrapbook",
            "version": NodeDB.FORMAT_VERSION,
            "type": "index",
            "contains": "shelves",
            "generator": "Scrapyard",
            "uuid": NodeDB.generate_uuid(),
            "entities": 0
        }

    def populate_format_header(self):
        self.header["entities"] = len(self.nodes)
        now = datetime.now()
        self.header["timestamp"] = int(now.timestamp() * 1000)
        self.header["date"] = now.isoformat()

    def create_default_shelf(self):
        return {
            "type": "shelf",
            "uuid": NodeDB.DEFAULT_SHELF_UUID,
            "title": NodeDB.DEFAULT_SHELF_NAME,
            "date_added": int(datetime.now().timestamp() * 1000),
            "date_modified": 0,
            "pos": 1
        }

    def parse_json(self, s):
        try:
            return json.loads(s)
        except Exception as e:
            logging.exception(e)

    @classmethod
    def read_header(cls, path):
        with path_lock(path).read_locked():
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as node_db_file:
                    return node_db_file.readline()

    def _read(self, path):
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as node_db_file:
                header_json = node_db_file.readline()
                nodes_json = []

                if header_json != "":
                    nodes_json = node_db_file.readlines()
                    self.header = self.parse_json(header_json)

                for node_json in nodes_json:
                    if node_json:
                        node = self.parse_json(node_json)
                        if node:
                            self.nodes[node["uuid"]] = node

        if not self.header:
            self.header = self.create_format_header()

        if len(self.nodes) == 0:
            self.nodes[NodeDB.DEFAULT_SHELF_UUID] = self.create_default_shelf()

    def save(self, path):
        with path_lock(path).write_locked():
            self._write(path)

    def _write(self, path):
        self.populate_format_header()

        entries = [self.header]
        entries += list(self.nodes.values())
        json_entries = [json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in entries]

        content = "\n".join(json_entries)

        # readers never observe a partially written index
        atomic_write(path, content)

    def reset(self):
        self.nodes.clear()
        self.nodes[NodeDB.DEFAULT_SHELF_UUID] = self.create_default_shelf()
        self.header = self.create_format_header()

    def add_node(self, node):
        self.nodes[node["uuid"]] = node

    def update_node(self, update, remove_fields):
        node = self.nodes.get(update["uuid"], None)
        result = update

        if node:
            result = {**node, **update}

            if remove_fields:
                for field in remove_fields:
                    if field in result:
                        del result[field]

            self.nodes[update["uuid"]] = result
        else:
            self.nodes[update["uuid"]] = update

        return result

    def delete_node(self, uuid):
        if uuid in self.nodes:
            del self.nodes[uuid]
