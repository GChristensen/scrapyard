import base64
import json
import os
import shutil
import threading
from pathlib import Path

from bs4 import BeautifulSoup

from . import server
from .server_paths import resolve_client_path, safe_join_path
from .utils import index_text

archive_import_mutex = threading.Lock()


def with_mutex(f):
    archive_import_mutex.acquire()
    try:
        f()
    finally:
        archive_import_mutex.release()


def import_rdf_archive(params):
    uuid = params["uuid"]
    scrapbook_id = params["scrapbook_id"]
    rdf_path = resolve_client_path(params["rdf_archive_path"])

    object_directory = server.storage_manager.get_object_directory(params, uuid)
    unpacked_archive_directory = server.storage_manager.get_archive_unpacked_path(object_directory)
    rdf_archive_directory = safe_join_path(os.path.join(rdf_path, "data"), scrapbook_id)

    result = dict()

    if os.path.exists(rdf_archive_directory):
        with_mutex(lambda: shutil.copytree(rdf_archive_directory, unpacked_archive_directory, dirs_exist_ok=True))
        result["size"] = sum(f.stat().st_size for f in Path(unpacked_archive_directory).glob('**/*') if f.is_file())
        words = build_archive_index(rdf_archive_directory)
        import_archive_index(params, words)
        result["archive_index"] = words

        import_rdf_metadata(rdf_archive_directory, result)
        if result.get("comments", None):
            import_archive_comments(params, result)

    return result


def import_rdf_archive_index(params):
    scrapbook_id = params["scrapbook_id"]
    rdf_path = resolve_client_path(params["rdf_archive_path"])
    rdf_archive_directory = safe_join_path(os.path.join(rdf_path, "data"), scrapbook_id)

    result = dict()

    if os.path.exists(rdf_archive_directory):
        result["size"] = sum(f.stat().st_size for f in Path(rdf_archive_directory).glob('**/*') if f.is_file())
        words = build_archive_index(rdf_archive_directory)
        result["archive_index"] = words

    return result


def build_archive_index(path):
    words = []

    for file in os.listdir(path):
        if file.endswith(".html"):
            file_path = os.path.join(path, file)
            with open(file_path, "r", encoding="utf-8") as html_file:
                soup = BeautifulSoup(html_file, 'html.parser')

                for script in soup(["script", "style"]):
                    script.extract()

                text = soup.body.get_text(separator=' ')
                file_words = index_text(text)
                words += file_words

    return list(set(words))


def create_rdf_metadata(params):
    archive_directory_path = resolve_client_path(params["rdf_archive_path"], for_write=True)
    metadata_file_path = os.path.join(archive_directory_path, "index.dat")
    metadata = f"""id\t{params["scrapbook_id"]}
type
title\t{params["title"]}
chars\tUTF-8
icon\tfavicon.{params["icon_ext"]}
source\t{params["source"]}
comment
"""
    with open(metadata_file_path, "w", encoding="utf-8") as metadata_file:
        metadata_file.write(metadata)


def read_rdf_metadata(rdf_archive_directory):
    metadata_file_path = os.path.join(rdf_archive_directory, "index.dat")

    lines = []
    if os.path.exists(metadata_file_path):
        with open(metadata_file_path, "r", encoding="utf-8") as metadata_file:
            lines = metadata_file.readlines()

    return lines


def write_rdf_metadata(rdf_archive_directory, lines):
    metadata_file_path = os.path.join(rdf_archive_directory, "index.dat")

    with open(metadata_file_path, "w", encoding="utf-8") as metadata_file:
        content = "".join(lines)
        metadata_file.write(content)


def import_rdf_metadata(rdf_archive_directory, result):
    lines = read_rdf_metadata(rdf_archive_directory)

    for line in lines:
        if line.startswith("chars"):
            result["charset"] = line.replace("chars", "", 1).strip()

        if line.startswith("comment"):
            comments = line.replace("comment", "", 1).strip()
            result["comments"] = comments = comments.replace(" __BR__ ", "\n")
            result["comments_index"] = index_text(comments)


def import_archive_comments(params, result):
    comments = {"content": result["comments"]}
    params["comments_json"] = json.dumps(comments, ensure_ascii=False, separators=(',', ':'))
    with_mutex(lambda: server.storage_manager.persist_comments(params))

    comments_index = {"content": result["comments_index"]}
    params["index_json"] = json.dumps(comments_index, ensure_ascii=False, separators=(',', ':'))
    with_mutex(lambda: server.storage_manager.persist_comments_index(params))


def import_archive_index(params, words):
    index = {"content": words}
    params["index_json"] = json.dumps(index, ensure_ascii=False, separators=(',', ':'))
    with_mutex(lambda: server.storage_manager.persist_archive_index(params))


def persist_archive(params, files):
    archive_directory_path = resolve_client_path(params["rdf_archive_path"], for_write=True)
    if not os.path.exists(archive_directory_path):
        Path(archive_directory_path).mkdir(parents=True, exist_ok=True)

    index_file_path = os.path.join(archive_directory_path, "index.html")
    files["content"].save(index_file_path)
    create_rdf_metadata(params)
    persist_archive_icon(params)


def persist_archive_icon(params):
    archive_directory_path = resolve_client_path(params["rdf_archive_path"], for_write=True)
    icon_data = params.get("icon_data", None)

    if icon_data:
        icon_file_path = safe_join_path(archive_directory_path, f"favicon.{params['icon_ext']}")
        icon_bytes = base64.b64decode(icon_data)

        with open(icon_file_path, "wb") as icon_file:
            icon_file.write(icon_bytes)


def fetch_archive_file(params):
    archive_file_path = safe_join_path(resolve_client_path(params["rdf_archive_path"]), params["file"])

    file_content = None
    if os.path.exists(archive_file_path):
        with open(archive_file_path, "rb") as archive_file:
            file_content = archive_file.read()

    return file_content


def save_archive_file(params, files):
    archive_directory_path = resolve_client_path(params["rdf_archive_path"], for_write=True)
    archive_file_path = safe_join_path(archive_directory_path, params["file"])

    Path(os.path.dirname(archive_file_path)).mkdir(parents=True, exist_ok=True)
    files["content"].save(archive_file_path)

    index = build_archive_index(archive_directory_path)
    return json.dumps(index)


def persist_comments(params):
    archive_directory_path = resolve_client_path(params["rdf_archive_path"], for_write=True)
    lines = read_rdf_metadata(archive_directory_path)
    comments = json.loads(params["comments_json"])

    for i in range(len(lines)):
        if lines[i].startswith("comment"):
            text = comments["content"].replace("\n", " __BR__ ")
            lines[i] = f"comment\t{text}\n"

    write_rdf_metadata(archive_directory_path, lines)


