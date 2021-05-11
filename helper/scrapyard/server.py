import configparser
import traceback
import threading
import tempfile
import platform
import zipfile
import logging
import time
import json
import os
import re
from functools import wraps
from pathlib import Path

import flask
from flask import Response, Request, request, abort
from werkzeug.serving import make_server

from . import browser

DEBUG = True

app = flask.Flask(__name__)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
log = logging.getLogger('werkzeug')
log.disabled = True
app.logger.disabled = True

###
if DEBUG:
    logging.basicConfig(filename='debug.log', encoding='utf-8', level=logging.DEBUG)
###

auth = None
host = "localhost"
port = None
httpd = None

class Httpd(threading.Thread):

    def __init__(self, app, port):
        threading.Thread.__init__(self)
        self.srv = make_server(host, port, app)
        self.ctx = app.app_context()
        self.ctx.push()

    def run(self):
        self.srv.serve_forever()

    def shutdown(self):
        self.srv.shutdown()


def start(a_port, an_auth):
    global httpd
    global port
    global auth
    port = a_port
    auth = an_auth
    httpd = Httpd(app, a_port)
    #httpd.setDaemon(True)
    httpd.start()


def stop():
    global httpd
    httpd.shutdown()


def requires_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = True #request.authorization
        if not auth:
            abort(401)
        return f(*args, **kwargs)
    return decorated


###
if DEBUG:
    @app.errorhandler(Exception)
    def handle_500(e=None):
        return traceback.format_exc(), 500
###


@app.after_request
def add_header(r):
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    r.headers["Pragma"] = "no-cache"
    r.headers["Expires"] = "0"
    r.headers['Cache-Control'] = 'public, max-age=0'
    return r


@app.route("/")
def root():
    return "Scrapyard helper application"


def find_db_path(mozilla_root, profiles, addon_id):
    profiles = [profiles[k] for k in profiles.keys() if k.startswith("Profile")]

    for profile in profiles:
        path = profile["Path"]

        if profile["IsRelative"] == "1":
            path = mozilla_root + path

        path_candidate = f"{path}/storage/default/moz-extension+++{addon_id}"

        if os.path.exists(path_candidate):
            return path_candidate.replace("/", "\\")

    return None


# try to get the Scrapyard addon database path
@app.route("/request/idb_path/<addon_id>")
def get_db_path(addon_id):
    if platform.system() != "Windows":
        return abort(404)

    mozilla_root = os.environ["APPDATA"] + "/Mozilla/Firefox/"
    profiles_ini = f"{mozilla_root}profiles.ini"

    if os.path.exists(profiles_ini):
        config = configparser.ConfigParser()
        config.read(profiles_ini)
        path = find_db_path(mozilla_root, config, addon_id)
        if path:
            return path
        else:
            abort(404)
    else:
        return abort(404)

# Browse regular scrapyard archives

@app.route("/browse/<uuid>")
def browse(uuid):
    browser.send_message(json.dumps({"type": "REQUEST_PUSH_BLOB", "uuid": uuid}))
    msg = browser.get_message()
    if msg["type"] == "PUSH_BLOB":
        blob = msg["blob"]
        if msg["byte_length"]:
            blob = blob.encode("latin1")
        return flask.Response(blob, mimetype=msg["content_type"])


# Scrapbook RDF support

rdf_import_directory = None


@app.route("/rdf/import/<file>", methods=['POST'])
def rdf_import(file):
    global rdf_import_directory
    form = request.form
    rdf_import_directory = form["rdf_directory"]
    return flask.send_from_directory(rdf_import_directory, file)


@app.route("/rdf/import/files/<path:file>", methods=['GET'])
def rdf_import_files(file):
    return flask.send_from_directory(rdf_import_directory, file)


rdf_browse_directories = dict()


@app.route("/rdf/browse/<uuid>/<path:file>", methods=['GET'])
def rdf_browse(uuid, file):
    if file == "_":
        browser.send_message(json.dumps({"type": "REQUEST_RDF_PATH", "uuid": uuid}))
        msg = browser.get_message()
        rdf_browse_directories[uuid] = msg["rdf_directory"]
        if msg["type"] == "RDF_PATH" and msg["uuid"] == uuid:
            return flask.send_from_directory(rdf_browse_directories[uuid], f"index.html")
        else:
            abort(404)
    else:
        return flask.send_from_directory(rdf_browse_directories[uuid], file)


# Get Scrapbook rdf file for a given node uuid

@app.route("/rdf/root/<uuid>", methods=['GET'])
def rdf_root(uuid):
    browser.send_message(json.dumps({"type": "REQUEST_RDF_ROOT", "uuid": uuid}))
    msg = browser.get_message()
    if msg["type"] == "RDF_ROOT" and msg["uuid"] == uuid:
        return flask.send_file(msg["rdf_file"])


# Save Scrapbook rdf file for a given node uuid

@app.route("/rdf/root/save/<uuid>", methods=['POST'])
def rdf_root_save(uuid):
    browser.send_message(json.dumps({"type": "REQUEST_RDF_ROOT", "uuid": uuid}))
    msg = browser.get_message()
    if msg["type"] == "RDF_ROOT" and msg["uuid"] == uuid:
        with open(msg["rdf_file"], 'w', encoding='utf-8') as fp:
            fp.write(request.form["rdf_content"])
            fp.flush()
    return "OK"


# Save Scrpabook data file

@app.route("/rdf/save_item/<uuid>", methods=['POST'])
def rdf_item_save(uuid):
    browser.send_message(json.dumps({"type": "REQUEST_RDF_PATH", "uuid": uuid}))
    msg = browser.get_message()
    rdf_item_path = msg["rdf_directory"]
    Path(rdf_item_path).mkdir(parents=True, exist_ok=True)
    if msg["type"] == "RDF_PATH" and msg["uuid"] == uuid:
        with open(os.path.join(rdf_item_path, "index.html"), 'w', encoding='utf-8') as fp:
            fp.write(request.form["item_content"])
    return "OK"


# Delete Scrapbook data file

@app.route("/rdf/delete_item/<uuid>", methods=['GET'])
def rdf_item_delete(uuid):
    browser.send_message(json.dumps({"type": "REQUEST_RDF_PATH", "uuid": uuid}))
    msg = browser.get_message()
    rdf_item_path = msg["rdf_directory"]

    def rm_tree(pth: Path):
        for child in pth.iterdir():
            if child.is_file():
                child.unlink()
            else:
                rm_tree(child)
        pth.rmdir()

    if msg["type"] == "RDF_PATH" and msg["uuid"] == uuid:
        rm_tree(Path(rdf_item_path))
    return "OK"


# Export support

export_file = None


@app.route("/export/initialize", methods=['GET'])
def export_initialize():
    global export_file
    export_file = os.path.join(tempfile.gettempdir(), next(tempfile._get_candidate_names()))
    with open(export_file, mode="w", encoding="utf-8") as fp:
        while True:
            msg = browser.get_message()
            if msg["type"] == "EXPORT_PUSH_TEXT":
                fp.write(msg["text"])
            elif msg["type"] == "EXPORT_FINISH":
                fp.flush()
                return "OK"


@app.route("/export/download", methods=['GET'])
def export_download():
    return flask.send_file(export_file)


@app.route("/export/finalize", methods=['GET'])
def export_finalize():
    global export_file
    os.remove(export_file)
    export_file = None
    return "OK"


# Backup routines

BACKUP_JSON_EXT = ".jsonl"
BACKUP_COMPRESSED_EXT = ".zip"


def backup_peek_meta_compressed(path):
    compressed = os.path.splitext(os.path.basename(path))[0] + BACKUP_JSON_EXT
    with zipfile.ZipFile(path, "r") as zin:
        with zin.open(compressed) as backup:
            meta = backup.readline()
            if meta:
                meta = meta.decode("utf-8")
                return meta
            else:
                return None


def backup_peek_meta_plain(path):
    with open(path, "r", encoding="utf-8") as backup:
        return backup.readline()


def backup_peek_meta(path):
    if path.endswith(BACKUP_COMPRESSED_EXT):
        return backup_peek_meta_compressed(path)
    else:
        return backup_peek_meta_plain(path)


@app.route("/backup/list", methods=['POST'])
def backup_list():
    directory = request.form["directory"]

    if os.path.exists(directory):
        result = "{"

        files = [f for f in os.listdir(directory) if f.endswith(BACKUP_JSON_EXT) or f.endswith(BACKUP_COMPRESSED_EXT)]
        nfiles = len(files)
        ctr = 0

        for file in files:
            path = os.path.join(directory, file)
            meta = backup_peek_meta(path)
            if meta:
                meta = meta.strip()
                result += f"\"{file}\": {meta}"
                ctr += 1
                if ctr < nfiles:
                    result += ","
            else:
                nfiles -= 1

        result += "}"

        return result
    else:
        return abort(404)


@app.route("/backup/initialize", methods=['POST'])
def backup_initialize():
    directory = request.form["directory"]
    backup_file_path = os.path.join(directory, request.form["file"])

    Path(directory).mkdir(parents=True, exist_ok=True)

    compress = request.form["compress"] == "true"

    def do_backup(backup, encode=False):
        while True:
            msg = browser.get_message()
            if msg["type"] == "BACKUP_PUSH_TEXT":
                if encode:
                    backup.write(msg["text"].encode("utf-8"))
                else:
                    backup.write(msg["text"])
            elif msg["type"] == "BACKUP_FINISH":
                return "OK"

    if compress:
        compressed = re.sub(f"{BACKUP_JSON_EXT}$", BACKUP_COMPRESSED_EXT, backup_file_path)
        logging.debug(compressed)
        with zipfile.ZipFile(compressed, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as zout:
            with zout.open(request.form["file"], "w") as backup:
                return do_backup(backup, True)
    else:
        with open(backup_file_path, "w", encoding="utf-8") as backup:
            return do_backup(backup)


backup_compressed = False
backup_file = None
json_file = None


@app.route("/restore/initialize", methods=['POST'])
def restore_initialize():
    directory = request.form["directory"]
    backup_file_path = os.path.join(directory, request.form["file"])

    global backup_compressed, backup_file, json_file

    backup_compressed = backup_file_path.endswith(BACKUP_COMPRESSED_EXT)

    if backup_compressed:
        compressed = os.path.splitext(os.path.basename(backup_file_path))[0] + BACKUP_JSON_EXT
        backup_file = zipfile.ZipFile(backup_file_path, 'r')
        json_file = backup_file.open(compressed)
    else:
        json_file = open(backup_file_path, "r", encoding="utf-8")

    return "OK"


@app.route("/restore/get_line", methods=['GET'])
def restore_get_line():
    line = json_file.readline()
    if line:
        if backup_compressed:
            line = line.decode("utf-8")
        line = line.strip()
        return line
    else:
        return "", 204


@app.route("/restore/finalize", methods=['GET'])
def restore_finalize():
    global backup_compressed, backup_file, json_file
    json_file.close()
    if backup_compressed:
        backup_file.close()
    backup_compressed = False
    backup_file = None
    json_file = None
    return "OK"


@app.route("/backup/delete", methods=['POST'])
def backup_delete():
    directory = request.form["directory"]
    backup_file_path = os.path.join(directory, request.form["file"])

    os.remove(backup_file_path)
    return "OK"
