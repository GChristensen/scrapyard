
from flask import request, abort

from .request_queue import RequestQueue
from .server import app, requires_auth, storage_manager

# JSON Scrapbook support

request_queue = RequestQueue()


@app.route("/storage/check_directory", methods=['POST'])
@requires_auth
def check_directory():
    result = storage_manager.check_directory(request.json)
    return result, 200


@app.route("/storage/clean_temp_directory", methods=['POST'])
@requires_auth
def clean_temp_directory():
    storage_manager.clean_temp_directory(request.json)
    return "", 200


@app.route("/storage/open_batch_session", methods=['POST'])
@requires_auth
def open_batch_session():
    storage_manager.open_batch_session(request.json)
    return "", 204


@app.route("/storage/close_batch_session", methods=['POST'])
@requires_auth
def close_batch_session():
    storage_manager.close_batch_session(request.json)
    return "", 204


@app.route("/storage/persist_node", methods=['POST'])
@requires_auth
def add_node():
    request_queue.add(storage_manager.persist_node, request.json)
    #storage_manager.persist_node(request.json)
    return "", 204


@app.route("/storage/update_node", methods=['POST'])
@requires_auth
def update_node():
    request_queue.add(storage_manager.update_node, request.json)
    #storage_manager.update_node(request.json)
    return "", 204


@app.route("/storage/update_nodes", methods=['POST'])
@requires_auth
def update_nodes():
    request_queue.add(storage_manager.update_nodes, request.json)
    #storage_manager.update_nodes(request.json)
    return "", 204


@app.route("/storage/delete_nodes", methods=['POST'])
@requires_auth
def delete_nodes():
    request_queue.add(storage_manager.delete_nodes, request.json)
    #storage_manager.delete_nodes(request.json)
    return "", 204


@app.route("/storage/delete_nodes_shallow", methods=['POST'])
@requires_auth
def delete_nodes_shallow():
    request_queue.add(storage_manager.delete_nodes_shallow, request.json)
    #storage_manager.delete_nodes_shallow(request.json)
    return "", 204


@app.route("/storage/delete_node_content", methods=['POST'])
@requires_auth
def delete_node_content():
    storage_manager.delete_node_content(request.json)
    return "", 204


@app.route("/storage/wipe", methods=['POST'])
@requires_auth
def wipe_storage():
    storage_manager.wipe_storage(request.json)
    return "", 204


@app.route("/storage/persist_icon", methods=['POST'])
@requires_auth
def persist_icon():
    storage_manager.persist_icon(request.json)
    return "", 204


@app.route("/storage/persist_archive_index", methods=['POST'])
@requires_auth
def persist_content_index():
    storage_manager.persist_archive_index(request.json)
    return "", 204


@app.route("/storage/persist_archive_object", methods=['POST'])
@requires_auth
def persist_archive_object():
    storage_manager.persist_archive_object(request.json)
    return "", 204


@app.route("/storage/persist_archive_content", methods=['POST'])
@requires_auth
def persist_archive_content():
    storage_manager.persist_archive_content(request.form, request.files)
    return "", 204


@app.route("/storage/fetch_archive_object", methods=['POST'])
@requires_auth
def fetch_archive_object():
    json_text = storage_manager.fetch_archive_object(request.json)

    if json_text:
        return json_text
    else:
        return "", 404


@app.route("/storage/fetch_archive_content", methods=['POST'])
@requires_auth
def fetch_archive_content():
    result = storage_manager.fetch_archive_content(request.form)

    if result:
        return result
    else:
        return "", 404


@app.route("/storage/persist_notes_index", methods=['POST'])
@requires_auth
def persist_notes_index():
    storage_manager.persist_notes_index(request.json)
    return "", 204


@app.route("/storage/persist_notes", methods=['POST'])
@requires_auth
def persist_notes():
    storage_manager.persist_notes(request.json)
    return "", 204


@app.route("/storage/fetch_notes", methods=['POST'])
@requires_auth
def fetch_notes():
    json_text = storage_manager.fetch_notes(request.json)

    if json_text:
        return json_text
    else:
        return "", 404


@app.route("/storage/persist_comments_index", methods=['POST'])
@requires_auth
def persist_comments_index():
    storage_manager.persist_comments_index(request.json)
    return "", 204


@app.route("/storage/persist_comments", methods=['POST'])
@requires_auth
def persist_comments():
    storage_manager.persist_comments(request.json)
    return "", 204


@app.route("/storage/fetch_comments", methods=['POST'])
@requires_auth
def fetch_comments():
    json_text = storage_manager.fetch_comments(request.json)

    if json_text:
        return json_text
    else:
        return "", 404


@app.route("/storage/get_metadata", methods=['POST'])
@requires_auth
def get_metadata():
    json_text = storage_manager.get_metadata(request.json)

    if json_text:
        return json_text
    else:
        return "", 404


@app.route("/storage/sync_compute", methods=['POST'])
@requires_auth
def sync_get_metadata():
    json_object = storage_manager.sync_compute(request.json)

    if json_object:
        return json_object
    else:
        return "", 404


@app.route("/storage/sync_open_session", methods=['POST'])
@requires_auth
def sync_open_session():
    storage_manager.sync_open_session(request.json)
    return "{}", 200


@app.route("/storage/sync_close_session", methods=['GET'])
@requires_auth
def sync_close_session():
    storage_manager.sync_close_session()
    return "", 204


@app.route("/storage/sync_pull_objects", methods=['POST'])
@requires_auth
def sync_pull_objects():
    json_text = storage_manager.sync_pull_objects(request.json)

    if json_text:
        return json_text
    else:
        return "", 404
