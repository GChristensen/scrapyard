import zipfile
import os
import re
from pathlib import Path

from flask import request, abort

from .browser import current_channel, current_context
from .server import app, requires_auth
from .server_paths import resolve_backup_directory, validate_file_name

# Backup routines

BACKUP_JSON_EXT = ".jsonl"
BACKUP_COMPRESSED_EXT = ".zip"


def backup_peek_meta_compressed(path):
    try:
        with zipfile.ZipFile(path, "r") as zin:
            compressed = zin.namelist()[0]
            if not compressed.endswith(BACKUP_JSON_EXT):
                return None
            with zin.open(compressed) as backup:
                meta = backup.readline()
                if meta:
                    meta = meta.decode("utf-8")
                    return meta
                else:
                    return None
    except:
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
@requires_auth
def backup_list():
    directory = resolve_backup_directory(request.form["directory"])

    if os.path.exists(directory):
        result = "{"

        files = [f for f in os.listdir(directory) if f.endswith(BACKUP_JSON_EXT) or f.endswith(BACKUP_COMPRESSED_EXT)]

        for file in files:
            path = os.path.join(directory, file)
            meta = backup_peek_meta(path)
            if meta:
                meta = meta.strip()
                meta = re.sub(r"}$", f",\"file_size\":{os.path.getsize(path)}}}", meta)
                result += f"\"{file}\": {meta},"

        result = re.sub(r",$", "", result)
        result += "}"

        return result
    else:
        return abort(404)


@app.route("/backup/initialize", methods=['POST'])
@requires_auth
def backup_initialize():
    directory = resolve_backup_directory(request.form["directory"])
    backup_file_path = os.path.join(directory, validate_file_name(request.form["file"]))

    if not os.path.exists(directory):
        Path(directory).mkdir(parents=True, exist_ok=True)

    compress = request.form["compress"] == "true"
    channel = current_channel()
    message_mutex = channel.message_mutex
    message_queue = channel.message_queue

    def do_backup(backup, encode=False):
        message_mutex.acquire()
        try:
            while True:
                text = message_queue.get()
                if text is not None:
                    if encode:
                        backup.write(text.encode("utf-8"))
                    else:
                        backup.write(text)
                else:
                    break
        finally:
            message_mutex.release()

    if compress:
        compressed = re.sub(f"{BACKUP_JSON_EXT}$", BACKUP_COMPRESSED_EXT, backup_file_path)
        method = {
            "DEFLATE": zipfile.ZIP_DEFLATED,
            "LZMA": zipfile.ZIP_LZMA,
            "BZIP2": zipfile.ZIP_BZIP2
        }.get(request.form["method"], zipfile.ZIP_DEFLATED)
        level = int(request.form["level"])

        try:
            zout = zipfile.ZipFile(compressed, "w", method, compresslevel=level)
            backup = zout.open(request.form["file"], "w")
            do_backup(backup, True)
        finally:
            backup.close()
            zout.close()
        return "OK"
    else:
        with open(backup_file_path, "w", encoding="utf-8") as backup:
            do_backup(backup)
        return "OK"


# the state of a restore operation is kept per client

@app.route("/restore/initialize", methods=['POST'])
@requires_auth
def restore_initialize():
    directory = resolve_backup_directory(request.form["directory"])
    backup_file_path = os.path.join(directory, validate_file_name(request.form["file"]))

    restore = current_context()
    restore["backup_compressed"] = backup_file_path.endswith(BACKUP_COMPRESSED_EXT)

    if restore["backup_compressed"]:
        restore["backup_file"] = zipfile.ZipFile(backup_file_path, 'r')
        compressed = restore["backup_file"].namelist()[0]
        restore["json_file"] = restore["backup_file"].open(compressed)
    else:
        restore["json_file"] = open(backup_file_path, "r", encoding="utf-8")

    return "OK"


@app.route("/restore/get_line", methods=['GET'])
@requires_auth
def restore_get_line():
    json_file = current_context().get("json_file", None)

    if not json_file:
        return abort(404)

    line = json_file.readline()
    if line:
        # if backup_compressed:
        #     line = line.decode("utf-8")
        # line = line.strip()
        return line
    else:
        return "", 204


@app.route("/restore/finalize", methods=['GET'])
@requires_auth
def restore_finalize():
    restore = current_context()
    json_file = restore.pop("json_file", None)
    backup_file = restore.pop("backup_file", None)
    restore.pop("backup_compressed", None)

    if json_file:
        json_file.close()
    if backup_file:
        backup_file.close()
    return "OK"


@app.route("/backup/delete", methods=['POST'])
@requires_auth
def backup_delete():
    directory = resolve_backup_directory(request.form["directory"])
    backup_file_path = os.path.join(directory, validate_file_name(request.form["file"]))

    os.remove(backup_file_path)
    return "OK"
