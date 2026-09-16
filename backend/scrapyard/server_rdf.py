import logging
import os
import shutil

from pathlib import Path

import flask
from flask import request, render_template

from .browser import current_channel
from .server_paths import resolve_client_path
from .browse import highlight_words_in_index
from .cache_dict import CacheDict
from .storage_rdf import import_rdf_archive, import_rdf_archive_index, fetch_archive_file, save_archive_file, \
    persist_comments, persist_archive
from .server import app, requires_auth

# Scrapbook RDF support


rdf_import_directory = None


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


@app.route("/rdf/save_archive_file", methods=['POST'])
@requires_auth
def rdf_save_archive_file():
    result = save_archive_file(request.form, request.files)

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
    msg = current_channel().send_with_response({"type": "REQUEST_RDF_PATH", "uuid": uuid})

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
    return flask.send_file(rdf_file)


# Save Scrapbook rdf file for the given node uuid

@app.route("/rdf/xml/save/<uuid>", methods=['POST'])
@requires_auth
def rdf_xml_save(uuid):
    rdf_file = resolve_client_path(request.form["rdf_file"], for_write=True)

    with open(rdf_file, 'w', encoding='utf-8') as fp:
        fp.write(request.form["rdf_content"])
        fp.flush()

    return "", 204


@app.route("/rdf/delete_item/<uuid>", methods=['POST'])
@requires_auth
def rdf_item_delete(uuid):
    rdf_item_path = resolve_client_path(request.form["rdf_archive_directory"], for_write=True)

    try:
        shutil.rmtree(rdf_item_path)
    except Exception as e:
        logging.exception(e)

    return "", 204
