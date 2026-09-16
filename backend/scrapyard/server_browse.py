import io
import os
import json
import logging
import zipfile

import flask
from flask import send_file, send_from_directory, request, render_template

from . import server, config

from .browser import current_channel
from .browse import highlight_words_in_index
from .cache_dict import CacheDict
from .server import app
from .storage_manager import StorageManager, NODE_OBJECT_FILE

# Browse regular scrapyard archives


unpacked_archives = CacheDict()


def request_archive_info(uuid):
    if config.SERVER_MODE:
        # archives stored on the server are described by their node objects, only cloud archives require the browser
        server.storage_manager.get_object_directory({}, uuid)  # validates uuid
        node_json = server.storage_manager.fetch_object(NODE_OBJECT_FILE, {"uuid": uuid})

        if node_json:
            node = json.loads(node_json)
            return {
                "type": "ARCHIVE_INFO",
                "kind": "metadata",
                "data_path": config.DATA_PATH,
                "name": node.get("name", None) or uuid,
                "content_type": node.get("content_type", None) or "text/html",
                "contains": node.get("contains", None)
            }

    return current_channel().send_with_response({"type": "REQUEST_ARCHIVE", "uuid": uuid})


@app.route("/browse/<uuid>/")
def browse(uuid):
    msg = request_archive_info(uuid)
    highlight = request.args.get("highlight", None)

    if highlight:
        msg["highlight"] = highlight
    else:
        msg["highlight"] = None

    try:
        if msg["type"] == "ARCHIVE_INFO" and msg["kind"] == "metadata" and msg["data_path"]:
            return serve_from_file(msg, uuid)
        elif msg["type"] == "ARCHIVE_INFO" and msg["kind"] == "content":
            return serve_content(msg)
    except Exception as e:
        logging.exception(e)

    return render_template("404.html"), 404


def serve_from_file(params, uuid):
    params["uuid"] = uuid

    object_directory = server.storage_manager.get_object_directory(params, uuid)
    archive_type = params.get("contains", None)
    archive_name = params.get("name", uuid)

    if archive_type == StorageManager.ARCHIVE_TYPE_FILES:
        archive_directory = server.storage_manager.get_archive_unpacked_path(object_directory)
        unpacked_archives[uuid] = archive_directory
        return serve_unpacked_archive(params, archive_directory)
    else:
        archive_content_path = server.storage_manager.get_archive_content_path(object_directory)
        content_type = params.get("content_type", "text/html")
        return send_file(archive_content_path, mimetype=content_type, download_name=archive_name)


def serve_content(params):
    content = params["content"]
    contains = params["contains"]

    if contains is not None and contains != StorageManager.ARCHIVE_TYPE_TEXT:
        content = content.encode("latin1")

    if contains == StorageManager.ARCHIVE_TYPE_FILES:
        archive_directory = extract_unpacked_archive(params, content)
        unpacked_archives[params["uuid"]] = archive_directory
        return serve_unpacked_archive(params, archive_directory)
    else:
        return flask.Response(content, mimetype=params["content_type"])


def extract_unpacked_archive(params, content):
    archive_directory_path = server.storage_manager.get_cloud_archive_temp_directory(params)
    zip_buffer = io.BytesIO(content)

    with zipfile.ZipFile(zip_buffer, "r", zipfile.ZIP_DEFLATED, False) as zip_file:
        zip_file.extractall(archive_directory_path)

    return archive_directory_path


def serve_unpacked_archive(params, archive_directory):
    if params["highlight"]:
        params["index_file_path"] = os.path.join(archive_directory, "index.html")
        return highlight_words_in_index(params)
    else:
        return send_from_directory(archive_directory, "index.html")


@app.route("/browse/<uuid>/<path:file>")
def serve_unpacked_assets(uuid, file):
    if uuid in unpacked_archives:
        return send_from_directory(unpacked_archives[uuid], file)
    else:
        return "", 404

