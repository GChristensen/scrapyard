import multiprocessing
import threading
import mimetypes
import logging
import json
import uuid
import os

import flask
from flask import request, abort

from .cache_dict import CacheDict
from .server import app, requires_auth
from .server_paths import resolve_client_path, forbid_in_server_mode


# Upload a local file using file open dialog

def open_file_dialog(queue):
    import os
    from tkinter import Tk, PhotoImage
    from tkinter.filedialog import askopenfilenames

    root = Tk()
    root.withdraw()

    icon_dir = os.path.split(__file__)[0]
    icon_path = os.path.join(icon_dir, "resources", "scrapyard.png")

    if os.path.exists(icon_path):
        icon = PhotoImage(file=icon_path)
        root.iconphoto(False, icon)

    filename = askopenfilenames()
    queue.put(filename)


# currently does not work, it is impossible to spawn a multiprocessing.Process when the main
# process waits on stdin in the loop to process native messages
@app.route("/upload/open_file_dialog", methods=['GET'])
@requires_auth
def upload_show_dialog():
    forbid_in_server_mode()

    try:
        queue = multiprocessing.Queue()
        p = multiprocessing.Process(target=open_file_dialog, args=(queue,))
        p.start()
        p.join()

        files = queue.get()
        uuids = {}

        if files:
            serve_mutex.acquire()

            for file in files:
                if os.path.isfile(file):
                    file_uuid = uuid.uuid4().hex
                    uuids[file_uuid] = file
                    serve_path_map[file_uuid] = file

            serve_mutex.release()

    except Exception as e:
        logging.exception(e)
        return "[]"

    return json.dumps(uuids)


# Serve a local file (used to upload local files from automation API)

serve_path_map = dict()
serve_mutex = threading.Lock()


@app.route("/serve/set_path/<uuid>", methods=['POST'])
@requires_auth
def serve_set_path(uuid):
    global serve_path_map
    path = request.form["path"]

    if path:
        path = resolve_client_path(path)

        if path and os.path.exists(path):
            try:
                serve_mutex.acquire()
                serve_path_map[uuid] = path
            finally:
                serve_mutex.release()
    return "OK"


@app.route("/serve/release_path/<uuid>", methods=['GET'])
@requires_auth
def serve_release_path(uuid):
    global serve_path_map

    try:
        serve_mutex.acquire()
        if uuid in serve_path_map:
            del serve_path_map[uuid]
    finally:
        serve_mutex.release()

    return "OK"


@app.route("/serve/file/<uuid>/", methods=['GET'])
def serve_file(uuid):
    path = serve_path_map.get(uuid, None)

    if path:
        response = flask.make_response(flask.send_file(path))
        mime_type = mimetypes.guess_type(path)[0]

        if mime_type:
            response.headers["content-type"] = mime_type

        return response
    else:
        abort(404)


@app.route("/serve/file/<uuid>/<path:file>", methods=['GET'])
def serve_file_deps(uuid, file):
    path = serve_path_map.get(uuid, None)

    if path:
        [directory, _] = os.path.split(path)
        return flask.send_from_directory(directory, file)
    else:
        abort(404)

