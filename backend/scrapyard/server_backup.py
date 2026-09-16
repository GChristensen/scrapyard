import logging
import zipfile
import os
import re
from pathlib import Path

from flask import request, abort

from .browser import current_channel, current_context, StreamAborted
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
    stream_id = request.form.get("stream", None)
    channel = current_channel()

    if compress:
        target_path = re.sub(f"{BACKUP_JSON_EXT}$", BACKUP_COMPRESSED_EXT, backup_file_path)
    else:
        target_path = backup_file_path

    # the backup is written to a temporary file, which is not listed as a backup,
    # and renamed only if the whole content is received, so an interrupted backup never looks like a complete one
    part_path = target_path + ".part"

    try:
        if compress:
            method = {
                "DEFLATE": zipfile.ZIP_DEFLATED,
                "LZMA": zipfile.ZIP_LZMA,
                "BZIP2": zipfile.ZIP_BZIP2
            }.get(request.form["method"], zipfile.ZIP_DEFLATED)
            level = int(request.form["level"])

            with zipfile.ZipFile(part_path, "w", method, compresslevel=level) as zout:
                with zout.open(request.form["file"], "w") as backup:
                    for text in channel.read_stream(stream_id):
                        backup.write(text.encode("utf-8"))
        else:
            with open(part_path, "w", encoding="utf-8") as backup:
                for text in channel.read_stream(stream_id):
                    backup.write(text)

        os.replace(part_path, target_path)
    except BaseException as e:
        try:
            if os.path.exists(part_path):
                os.remove(part_path)
        except OSError as oe:
            logging.exception(oe)

        if isinstance(e, StreamAborted):
            logging.error(f"Backup is aborted: {e}")
            return f"Backup is aborted: {e}", 409

        raise

    return "OK"


# the state of a restore operation is kept per client

@app.route("/restore/initialize", methods=['POST'])
@requires_auth
def restore_initialize():
    directory = resolve_backup_directory(request.form["directory"])
    backup_file_path = os.path.join(directory, validate_file_name(request.form["file"]))

    if not os.path.exists(backup_file_path):
        return abort(404)

    restore = current_context()
    close_restore_files(restore)  # a previous restore may have been interrupted
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
    close_restore_files(current_context())
    return "OK"


def close_restore_files(restore):
    json_file = restore.pop("json_file", None)
    backup_file = restore.pop("backup_file", None)
    restore.pop("backup_compressed", None)

    if json_file:
        json_file.close()
    if backup_file:
        backup_file.close()


@app.route("/backup/delete", methods=['POST'])
@requires_auth
def backup_delete():
    directory = resolve_backup_directory(request.form["directory"])
    backup_file_path = os.path.join(directory, validate_file_name(request.form["file"]))

    os.remove(backup_file_path)
    return "OK"
