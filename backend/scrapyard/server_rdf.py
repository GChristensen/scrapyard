import io
import logging
import mimetypes
import os
import shutil

from pathlib import Path

import flask
from flask import request, render_template

from .browser import current_channel
from .server_paths import resolve_client_path
from .browse import highlight_words_in_index
from .cache_dict import CacheDict
from .rwlock import path_lock
from .request_queue import RequestQueue
from .rdf_index import RDFIndexError
from . import rdf_index
from .storage_rdf import import_rdf_archive, import_rdf_archive_index, fetch_archive_file, save_archive_file, \
    persist_comments, persist_archive, transfer_archive, fetch_archive_content, persist_archive_content
from .server import app, requires_auth

# Scrapbook RDF support


rdf_import_directory = None

# mutations of the RDF index are serialized, as every one of them rewrites the whole file
rdf_request_queue = RequestQueue()


@app.route("/rdf/import/<file>", methods=['POST'])
@requires_auth
def rdf_import(file):
    global rdf_import_directory
    form = request.form
    rdf_import_directory = resolve_client_path(form["rdf_directory"])
    return flask.send_from_directory(rdf_import_directory, file)


@app.route("/rdf/import/files/<path:file>", methods=['GET'])
def rdf_import_files(file):
    if not rdf_import_directory:
        return "", 404
    return flask.send_from_directory(rdf_import_directory, file)


def _copyfileobj_patched(fsrc, fdst, length=16*1024*1024):
    """Patches shutil method to hugely improve copy speed"""
    while 1:
        buf = fsrc.read(length)
        if not buf:
            break
        fdst.write(buf)


shutil.copyfileobj = _copyfileobj_patched


@app.route("/rdf/import/archive", methods=['POST'])
@requires_auth
def rdf_import_archive():
    import_type = request.args.get("type", "full")
    result = {}

    if import_type == "full":
        result = import_rdf_archive(request.json)
    else:
        result = import_rdf_archive_index(request.json)

    return result


@app.route("/rdf/persist_archive", methods=['POST'])
@requires_auth
def rdf_persist_archive():
    persist_archive(request.form, request.files)
    return "", 204


@app.route("/rdf/fetch_archive_file", methods=['POST'])
@requires_auth
def rdf_fetch_archive_file():
    result = fetch_archive_file(request.json)

    if result:
        return result
    else:
        return "", 404


@app.route("/rdf/persist_archive_content", methods=['POST'])
@requires_auth
def rdf_persist_archive_content():
    persist_archive_content(request.form, request.files)
    return "", 204


@app.route("/rdf/fetch_archive_content", methods=['POST'])
@requires_auth
def rdf_fetch_archive_content():
    result = fetch_archive_content(request.json)

    if result:
        return result
    else:
        return "", 404


@app.route("/rdf/save_archive_file", methods=['POST'])
@requires_auth
def rdf_save_archive_file():
    compute_index = not not request.form.get("compute_index", None)
    result = save_archive_file(request.form, request.files, compute_index)

    if result:
        return result
    else:
        return "", 404


@app.route("/rdf/persist_comments", methods=['POST'])
@requires_auth
def rdf_persist_comments():
    persist_comments(request.json)
    return "", 204


rdf_page_directories = CacheDict()


@app.route("/rdf/browse/<uuid>/", methods=['GET'])
def rdf_browse(uuid):
    msg = current_channel(any_client=True).send_with_response({"type": "REQUEST_RDF_PATH", "uuid": uuid})

    if not msg.get("rdf_archive_path", None):
        return render_template("404.html"), 404

    rdf_archive_directory = resolve_client_path(msg["rdf_archive_path"])
    archive_index_path = os.path.join(rdf_archive_directory, "index.html")

    if os.path.exists(archive_index_path):
        rdf_page_directories[uuid] = rdf_archive_directory
        highlight = request.args.get("highlight", None)

        if highlight:
            msg["highlight"] = highlight
        else:
            msg["highlight"] = None

        if highlight:
            msg["index_file_path"] = os.path.join(archive_index_path)
            return highlight_words_in_index(msg)
        else:
            return flask.send_file(archive_index_path)

    return render_template("404.html"), 404


@app.route("/rdf/browse/<uuid>/<path:file>", methods=['GET'])
def rdf_browse_content(uuid, file):
    if uuid in rdf_page_directories:
        return flask.send_from_directory(rdf_page_directories[uuid], file)
    else:
        return "", 404


# Get Scrapbook rdf file for the given node uuid

@app.route("/rdf/xml/<uuid>", methods=['POST'])
@requires_auth
def rdf_xml(uuid):
    rdf_file = resolve_client_path(request.form["rdf_file"])

    # the content is read at once, an opened file would prevent its replacement on Windows
    with path_lock(rdf_file).read_locked():
        with open(rdf_file, "rb") as fp:
            content = fp.read()

    mime_type = mimetypes.guess_type(rdf_file)[0] or "application/rdf+xml"
    return flask.send_file(io.BytesIO(content), mimetype=mime_type)


# Read and modify the Scrapbook RDF index.
#
# The index is mutated here rather than in the browser: the operations are expressed semantically,
# so the add-on needs no XML support (unavailable in a MV3 service worker), and each one reads,
# modifies and writes the file under a single lock, which rules out lost updates.

RDF_INDEX_OPERATIONS = {
    "create_items": rdf_index.create_items,
    "update_item": rdf_index.update_item,
    "delete_items": rdf_index.delete_items,
    "move_items": rdf_index.move_items,
    "reorder_items": rdf_index.reorder_items
}


@app.route("/rdf/index/read", methods=['POST'])
@requires_auth
def rdf_index_read():
    params = request.json

    # the importer fetches the icons of the items from the same directory afterwards
    if params.get("rdf_directory", None):
        global rdf_import_directory
        rdf_import_directory = resolve_client_path(params["rdf_directory"])

    try:
        return rdf_index.read_tree(params)
    except RDFIndexError as e:
        return str(e), 400
    except FileNotFoundError:
        return "The RDF file does not exist.", 404


@app.route("/rdf/index/<operation>", methods=['POST'])
@requires_auth
def rdf_index_modify(operation):
    handler = RDF_INDEX_OPERATIONS.get(operation)

    if not handler:
        return "", 404

    try:
        rdf_request_queue.run(handler, request.json)
    except RDFIndexError as e:
        return str(e), 400
    except FileNotFoundError:
        return "The RDF file does not exist.", 404

    return "", 204


@app.route("/rdf/transfer_archive", methods=['POST'])
@requires_auth
def rdf_transfer_archive():
    return transfer_archive(request.json)


@app.route("/rdf/delete_item/<uuid>", methods=['POST'])
@requires_auth
def rdf_item_delete(uuid):
    rdf_item_path = resolve_client_path(request.form["rdf_archive_directory"], for_write=True)

    with path_lock(rdf_item_path).write_locked():
        try:
            shutil.rmtree(rdf_item_path)
        except Exception as e:
            logging.exception(e)

    return "", 204
