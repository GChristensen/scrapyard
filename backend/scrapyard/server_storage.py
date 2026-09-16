import json

from flask import request

from . import server, config

from .request_queue import RequestQueue
from .server import app, requires_auth

# JSON Scrapbook support

# all operations that modify the index or remove item content are serialized by the queue
request_queue = RequestQueue()


@app.route("/storage/check_directory", methods=['POST'])
@requires_auth
def check_directory():
    result = server.storage_manager.check_directory(request.json)
    return result, 200


def batch_session_owner():
    """The id of the client session in the server mode, None otherwise."""
    if config.SERVER_MODE:
        from .server_auth import current_session
        session = current_session()
        return session.sid if session else None


@app.route("/storage/open_batch_session", methods=['POST'])
@requires_auth
def open_batch_session():
    owner = batch_session_owner()
    request_queue.run(lambda params: server.storage_manager.open_batch_session(params, owner), request.json)
    return "", 204


@app.route("/storage/close_batch_session", methods=['POST'])
@requires_auth
def close_batch_session():
    owner = batch_session_owner()
    force = bool(request.json.get("force", False))
    request_queue.run(lambda params: server.storage_manager.close_batch_session(params, owner, force), request.json)
    return "", 204


@app.route("/storage/is_batch_session_open", methods=['POST'])
@requires_auth
def is_batch_session_open():
    return server.storage_manager.is_batch_session_open()


@app.route("/storage/persist_node", methods=['POST'])
@requires_auth
def add_node():
    request_queue.run(server.storage_manager.persist_node, request.json)
    return "", 204


@app.route("/storage/update_node", methods=['POST'])
@requires_auth
def update_node():
    request_queue.run(server.storage_manager.update_node, request.json)
    return "", 204


@app.route("/storage/update_nodes", methods=['POST'])
@requires_auth
def update_nodes():
    request_queue.run(server.storage_manager.update_nodes, request.json)
    return "", 204


@app.route("/storage/delete_nodes", methods=['POST'])
@requires_auth
def delete_nodes():
    request_queue.run(server.storage_manager.delete_nodes, request.json)
    return "", 204


@app.route("/storage/delete_nodes_shallow", methods=['POST'])
@requires_auth
def delete_nodes_shallow():
    request_queue.run(server.storage_manager.delete_nodes_shallow, request.json)
    return "", 204


@app.route("/storage/delete_node_content", methods=['POST'])
@requires_auth
def delete_node_content():
    request_queue.run(server.storage_manager.delete_node_content, request.json)
    return "", 204


@app.route("/storage/wipe", methods=['POST'])
@requires_auth
def wipe_storage():
    request_queue.run(server.storage_manager.wipe_storage, request.json)
    return "", 204


@app.route("/storage/persist_icon", methods=['POST'])
@requires_auth
def persist_icon():
    server.storage_manager.persist_icon(request.json)
    return "", 204


@app.route("/storage/persist_archive_index", methods=['POST'])
@requires_auth
def persist_content_index():
    server.storage_manager.persist_archive_index(request.json)
    return "", 204


@app.route("/storage/persist_archive_object", methods=['POST'])
@requires_auth
def persist_archive_object():
    server.storage_manager.persist_archive_object(request.json)
    return "", 204


@app.route("/storage/persist_archive_content", methods=['POST'])
@requires_auth
def persist_archive_content():
    server.storage_manager.persist_archive_content(request.form, request.files)
    return "", 204


@app.route("/storage/get_archive_size", methods=['POST'])
@requires_auth
def get_archive_size():
    result = server.storage_manager.get_archive_size(request.json)

    if result:
        return result
    else:
        return "", 404


@app.route("/storage/fetch_archive_object", methods=['POST'])
@requires_auth
def fetch_archive_object():
    json_text = server.storage_manager.fetch_archive_object(request.json)

    if json_text:
        return json_text
    else:
        return "", 404


@app.route("/storage/fetch_archive_content", methods=['POST'])
@requires_auth
def fetch_archive_content():
    result = server.storage_manager.fetch_archive_content(request.json)

    if result:
        return result
    else:
        return "", 404


@app.route("/storage/fetch_archive_file", methods=['POST'])
@requires_auth
def fetch_archive_file():
    result = server.storage_manager.fetch_archive_file(request.json)

    if result:
        return result
    else:
        return "", 404


@app.route("/storage/save_archive_file", methods=['POST'])
@requires_auth
def save_archive_file():
    compute_index = not not request.form.get("compute_index", None)
    index = server.storage_manager.save_archive_file(request.form, request.files, compute_index)

    if index:
        return json.dumps(index)
    else:
        return "[]"


@app.route("/storage/persist_notes_index", methods=['POST'])
@requires_auth
def persist_notes_index():
    server.storage_manager.persist_notes_index(request.json)
    return "", 204


@app.route("/storage/persist_notes", methods=['POST'])
@requires_auth
def persist_notes():
    server.storage_manager.persist_notes(request.json)
    return "", 204


@app.route("/storage/fetch_notes", methods=['POST'])
@requires_auth
def fetch_notes():
    json_text = server.storage_manager.fetch_notes(request.json)

    if json_text:
        return json_text
    else:
        return "", 404


@app.route("/storage/persist_comments_index", methods=['POST'])
@requires_auth
def persist_comments_index():
    server.storage_manager.persist_comments_index(request.json)
    return "", 204


@app.route("/storage/persist_comments", methods=['POST'])
@requires_auth
def persist_comments():
    server.storage_manager.persist_comments(request.json)
    return "", 204


@app.route("/storage/fetch_comments", methods=['POST'])
@requires_auth
def fetch_comments():
    json_text = server.storage_manager.fetch_comments(request.json)

    if json_text:
        return json_text
    else:
        return "", 404


@app.route("/storage/get_metadata", methods=['POST'])
@requires_auth
def get_metadata():
    json_text = server.storage_manager.get_metadata(request.json)

    if json_text:
        return json_text
    else:
        return "", 404


@app.route("/storage/sync_compute", methods=['POST'])
@requires_auth
def sync_get_metadata():
    json_object = server.storage_manager.sync_compute(request.json)

    if json_object:
        return json_object
    else:
        return "", 404


@app.route("/storage/sync_open_session", methods=['POST'])
@requires_auth
def sync_open_session():
    server.storage_manager.sync_open_session(request.json)
    return "{}", 200


@app.route("/storage/sync_close_session", methods=['GET'])
@requires_auth
def sync_close_session():
    server.storage_manager.sync_close_session()
    return "", 204


@app.route("/storage/sync_pull_objects", methods=['POST'])
@requires_auth
def sync_pull_objects():
    json_text = server.storage_manager.sync_pull_objects(request.json)

    if json_text:
        return json_text
    else:
        return "", 404


@app.route("/storage/get_orphaned_items", methods=['POST'])
@requires_auth
def get_orphaned_items():
    item_list = server.storage_manager.get_orphaned_items(request.json)
    return json.dumps(item_list)


@app.route("/storage/delete_orphaned_items", methods=['POST'])
@requires_auth
def delete_orphaned_items():
    request_queue.run(server.storage_manager.delete_orphaned_items, request.json)
    return "", 204


@app.route("/storage/rebuild_item_index", methods=['POST'])
@requires_auth
def rebuild_item_index():
    request_queue.run(server.storage_manager.rebuild_item_index, request.json)
    return "", 204


@app.route("/storage/debug_get_stored_node_instances", methods=['POST'])
@requires_auth
def debug_get_stored_node_instances():
    json_text = server.storage_manager.debug_get_stored_node_instances(request.json)

    if json_text:
        return json_text
    else:
        return "", 404
