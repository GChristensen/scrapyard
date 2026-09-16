import logging
import os
import re
import tempfile
import threading
import time

import flask
from flask import request, abort

from .browser import current_channel, current_context, StreamAborted
from .server import app, requires_auth

# Export using helper

# Exported files are identified by the stream id passed by the add-on (older add-ons do not pass it,
# and the file is kept in the client context). Unlike the session context, stream ids survive re-authentication
# of the client between the export and the download.

STREAM_ID_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
ABANDONED_EXPORT_TIMEOUT = 24 * 60 * 60

export_files = dict()
export_files_mutex = threading.Lock()


def stream_id_arg():
    stream_id = request.args.get("stream", None)

    if stream_id is not None and not STREAM_ID_PATTERN.match(stream_id):
        abort(400)

    return stream_id


def remove_file(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError as e:
        logging.exception(e)


def remove_abandoned_exports():
    now = time.monotonic()

    with export_files_mutex:
        abandoned = [k for k, (_, created) in export_files.items() if now - created > ABANDONED_EXPORT_TIMEOUT]
        for stream_id in abandoned:
            path, _ = export_files.pop(stream_id)
            remove_file(path)


def get_export_file(stream_id):
    if stream_id is None:
        return current_context().get("export_file", None)

    with export_files_mutex:
        entry = export_files.get(stream_id, None)
        return entry[0] if entry else None


def pop_export_file(stream_id):
    if stream_id is None:
        return current_context().pop("export_file", None)

    with export_files_mutex:
        entry = export_files.pop(stream_id, None)
        return entry[0] if entry else None


@app.route("/export/initialize", methods=['GET'])
@requires_auth
def export_initialize():
    stream_id = stream_id_arg()
    channel = current_channel()
    remove_abandoned_exports()

    fd, export_file = tempfile.mkstemp(prefix="scrapyard_export_")

    try:
        with os.fdopen(fd, mode="w", encoding="utf-8") as fp:
            for text in channel.read_stream(stream_id):
                fp.write(text)
    except BaseException as e:
        remove_file(export_file)

        if isinstance(e, StreamAborted):
            logging.error(f"Export is aborted: {e}")
            return f"Export is aborted: {e}", 409

        raise

    if stream_id is None:
        current_context()["export_file"] = export_file
    else:
        with export_files_mutex:
            export_files[stream_id] = (export_file, time.monotonic())

    return "", 204


@app.route("/export/download", methods=['GET'])
def export_download():
    export_file = get_export_file(stream_id_arg())

    if not export_file or not os.path.exists(export_file):
        return "", 404

    return flask.send_file(export_file, mimetype="application/json")


@app.route("/export/finalize", methods=['GET'])
@requires_auth
def export_finalize():
    remove_file(pop_export_file(stream_id_arg()))
    return "", 204
