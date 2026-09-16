import os
import json
import logging

from .storage_node_db import NodeDB


g_sync_operations = dict()


def compute_sync(storage_manager, params):
    node_db_path = storage_manager.get_node_db_path(params)
    nodes_incoming = json.loads(params["nodes"])
    last_sync_date = int(params["last_sync_date"])

    uuid2node_incoming = dict()
    uuid2node_storage = dict()
    from_storage = set()
    incoming = set()
    common = set()
    new_in_storage = set()
    new_incoming = set()
    updated_in_storage = set()
    updated_incoming = set()
    deleted_in_storage = set()
    deleted_incoming = set()

    for node in nodes_incoming:
        incoming.add(node["uuid"])
        uuid2node_incoming[node["uuid"]] = node

    uuid2node_storage = dict()

    def read_storage_node(node):
        uuid2node_storage[node["uuid"]] = make_sync_node(node)

    NodeDB.iterate(node_db_path, read_storage_node)

    from_storage = set(uuid2node_storage.keys())

    common = from_storage & incoming

    for uuid in common:
        incoming_node = uuid2node_incoming[uuid]
        storage_node = uuid2node_storage[uuid]

        if incoming_node.get("date_modified", 0) > storage_node.get("date_modified", 0):
            updated_incoming.add(uuid)
        elif incoming_node.get("date_modified", 0) < storage_node.get("date_modified", 0):
            updated_in_storage.add(uuid)

    new_incoming = incoming - common
    new_in_storage = from_storage - common

    # for uuid in new_incoming:
    #     if uuid2node_incoming[uuid]["date_modified"] < last_sync_date:
    #         deleted_incoming.add(uuid)

    deleted_incoming = new_incoming  # instead of ^^^

    # for uuid in new_in_storage:
    #     if uuid2node_storage[uuid]["date_modified"] < last_sync_date:
    #         deleted_in_storage.add(uuid)

    # new_incoming -= deleted_incoming
    # new_in_storage -= deleted_in_storage

    # push = new_incoming | updated_incoming
    pull = new_in_storage | updated_in_storage

    db_tree = NodeDB.tree_sort_nodes(uuid2node_storage)

    # keeping the correct order
    # push_nodes = [n for n in nodes_incoming if n["uuid"] in push]
    pull_nodes = [make_sync_node(n) for n in db_tree.values() if n["uuid"] in pull]

    # for n in push_nodes:
    #     n["push_content"] = "content_modified" in n and (n["uuid"] in new_incoming
    #                                                      or n["content_modified"] > last_sync_date)

    for n in pull_nodes:
        n["pull_content"] = "content_modified" in n and (n["uuid"] in new_in_storage
                                                         or n["content_modified"] > last_sync_date)

    global g_sync_operations
    g_sync_operations = {
        "push": [],  # push_nodes,
        "pull": pull_nodes,
        "delete": [uuid2node_incoming[n] for n in deleted_incoming],
        "delete_in_storage": []  # [uuid2node_storage[n] for n in deleted_in_storage]
    }

    return g_sync_operations


def make_sync_node(node):
    result = {
        "uuid": node["uuid"],
        "date_modified": node.get("date_modified", 0)
    }

    if "parent" in node:
        result["parent"] = node["parent"]

    if "content_modified" in node:
        result["content_modified"] = node["content_modified"]

    return result


def open_session(storage_manager, params):
    pass


def close_session():
    global g_sync_operations
    g_sync_operations = None


def pull_sync_objects(storage_manager, params):
    sync_nodes = json.loads(params["sync_nodes"])
    payloads = [assemble_node_payload(storage_manager, params, sync_node) for sync_node in sync_nodes]

    return "[" + ",".join(p for p in payloads if p) + "]"


def assemble_node_payload(storage_manager, params, sync_node):
    uuid = sync_node["uuid"]
    result = "{"

    object_directory_path = storage_manager.get_object_directory(params, uuid)
    node_object_path = storage_manager.get_node_object_path(object_directory_path)
    node_object = storage_manager.read_object_file(node_object_path)

    # the item has been deleted after the synchronization was computed
    if not node_object:
        return None

    result += "\"item\":" + node_object

    if sync_node["pull_content"]:
        icon_object_path = storage_manager.get_icon_object_path(object_directory_path)
        icon_object = storage_manager.read_object_file(icon_object_path)
        if icon_object:
            result += ",\"icon\":" + icon_object

        comments_object_path = storage_manager.get_comments_object_path(object_directory_path)
        comments_object = storage_manager.read_object_file(comments_object_path)
        if comments_object:
            result += ",\"comments\":" + comments_object

        archive_index_object_path = storage_manager.get_archive_index_object_path(object_directory_path)
        archive_index_object = storage_manager.read_object_file(archive_index_object_path)
        if archive_index_object:
            result += ",\"archive_index\":" + archive_index_object

        notes_index_object_path = storage_manager.get_notes_index_object_path(object_directory_path)
        notes_index_object = storage_manager.read_object_file(notes_index_object_path)
        if notes_index_object:
            result += ",\"notes_index\":" + notes_index_object

    result += "}"

    return result




