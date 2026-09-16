import json
import logging
import os
import shutil
import subprocess
import platform
from fnmatch import fnmatch

from bs4 import UnicodeDammit

from .server_paths import resolve_client_path, forbid_in_server_mode, to_client_path
from .utils import index_text


DIR_ITEM_TYPE = "dir"
FILE_ITEM_TYPE = "file"


def files_list_directory(params):
    path = resolve_client_path(params["path"])
    file_mask = params.get("file_mask", None)

    if file_mask:
        file_mask = file_mask.split(";")

    if os.path.exists(path) and os.path.isdir(path):
        path = path.replace("\\", "/")

        if not path.endswith("/"):
            path = path + "/"

        items = []

        for root, dirs, files in os.walk(path):
            for dir in dirs:
                create_dir_item(dir, path, root, items)

            for file in files:
                create_file_item(file, file_mask, path, root, items)

        items = filter_directories(items)

        for item in items:
            item["full_path"] = to_client_path(item["full_path"])

        return dict(status="success", content=items)
    else:
        return dict(status="error", error="incorrect_path")


def create_dir_item(dir, path, root, items):
    full_path = os.path.join(root, dir).replace("\\", "/")
    dir_path = full_path.replace(path, "", 1)
    dir_item = dict(type=DIR_ITEM_TYPE, name=dir, path=dir_path, full_path=full_path)

    items.append(dir_item)


def create_file_item(file, file_mask, path, root, items):
    full_path = os.path.join(root, file).replace("\\", "/")
    file_path = full_path.replace(path, "", 1)

    if satisfies_mask(file, file_mask):
        file_item = dict(type=FILE_ITEM_TYPE,
                         name=file,
                         path=file_path,
                         full_path=full_path,
                         content_modified=int(os.path.getmtime(full_path) * 1000))
        items.append(file_item)


def satisfies_mask(file, mask):
    for wildcard in mask:
        if fnmatch(file, wildcard):
            return True

    return False


def filter_directories(items):
    dirs = [i for i in items if i["type"] == DIR_ITEM_TYPE]
    files = [i for i in items if i["type"] == FILE_ITEM_TYPE]

    filtered_dirs = [d for d in dirs if any(f["full_path"].startswith(d["full_path"] + "/") for f in files)]

    return [*filtered_dirs, *files]


def files_open_with_editor(params):
    forbid_in_server_mode()
    editor = shutil.which(params.get("editor", None))

    if editor:
        subprocess.call([editor, params["path"]])


def files_shell_open_asset(params):
    forbid_in_server_mode()
    if platform.system() == 'Darwin':
        subprocess.call(('open', params["path"]))
    elif platform.system() == 'Windows':
        path = params["path"].replace("/", "\\")
        os.startfile(path)
    else:
        subprocess.call(('xdg-open', params["path"]))


def files_fetch_file_bytes(params):
    path = params.get("path", None)
    path = resolve_client_path(path) if path else None

    if path and os.path.exists(path):
        with open(path, "rb") as file:
            return file.read()


def files_fetch_file_text(params):
    path = params.get("path", None)
    path = resolve_client_path(path) if path else None

    if path and os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as file:
                return file.read()
        except UnicodeDecodeError as e:
            encoding = "latin1"

            with open(path, 'rb') as file:
                content = file.read()
                suggestion = UnicodeDammit(content)

                encoding = suggestion.original_encoding

            with open(path, "r", encoding=encoding) as file:
                return file.read()


def files_save_file_text(params):
    path = params.get("path", None)
    path = resolve_client_path(path, for_write=True) if path else None

    if path and os.path.exists(path):
        with open(path, "w", encoding="utf-8") as file:
            notes = json.loads(params["notes_json"])
            return file.write(notes["content"])


def files_create_index(params):
    content = files_fetch_file_text(params)

    if content:
        return index_text(content)
