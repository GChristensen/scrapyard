import base64
import json
import os
import shutil
import threading
from pathlib import Path

from bs4 import BeautifulSoup

from . import server
from .rdf_index import COMMENT_LINE_BREAK
from .rwlock import path_lock
from .server_paths import resolve_client_path, safe_join_path
from .utils import index_text
from .utils_fs import atomic_write, atomic_file

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
        def copy_archive():
            with path_lock(object_directory).write_locked():
                shutil.copytree(rdf_archive_directory, unpacked_archive_directory, dirs_exist_ok=True)

        with_mutex(copy_archive)
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


RDF_METADATA_FIELDS = ("id", "type", "title", "chars", "icon", "source", "comment")


def parse_rdf_metadata(lines):
    metadata = {}

    for line in lines:
        name, _, value = line.partition("\t")
        name = name.strip()

        if name:
            metadata[name] = value.strip("\r\n")

    return metadata


def format_rdf_metadata(metadata):
    names = list(RDF_METADATA_FIELDS)
    # whatever the legacy add-on stored beyond the fields known here is preserved
    names += [name for name in metadata if name not in RDF_METADATA_FIELDS]

    return [f"{name}\t{metadata[name]}\n" if metadata.get(name) else f"{name}\n" for name in names]


def create_rdf_metadata(params):
    archive_directory_path = resolve_client_path(params["rdf_archive_path"], for_write=True)

    # the metadata file also holds the comment, which is not part of a captured page:
    # it is read back so that archiving a page again does not discard it
    metadata = parse_rdf_metadata(read_rdf_metadata(archive_directory_path))

    metadata["id"] = params["scrapbook_id"]
    metadata["title"] = params["title"]
    metadata["chars"] = "UTF-8"
    metadata["source"] = params["source"]
    metadata.setdefault("type", "")
    metadata.setdefault("comment", "")

    # a missing icon should not leave a reference to a file that was never written
    if params.get("icon_data", None):
        metadata["icon"] = f"favicon.{params['icon_ext']}"
    else:
        metadata.setdefault("icon", "")

    write_rdf_metadata(archive_directory_path, format_rdf_metadata(metadata))


def read_rdf_metadata(rdf_archive_directory):
    metadata_file_path = os.path.join(rdf_archive_directory, "index.dat")

    lines = []
    if os.path.exists(metadata_file_path):
        with open(metadata_file_path, "r", encoding="utf-8") as metadata_file:
            lines = metadata_file.readlines()

    return lines


def write_rdf_metadata(rdf_archive_directory, lines):
    metadata_file_path = os.path.join(rdf_archive_directory, "index.dat")
    atomic_write(metadata_file_path, "".join(lines))


def import_rdf_metadata(rdf_archive_directory, result):
    metadata = parse_rdf_metadata(read_rdf_metadata(rdf_archive_directory))

    if metadata.get("chars", None):
        result["charset"] = metadata["chars"]

    comments = metadata.get("comment", "").replace(COMMENT_LINE_BREAK, "\n")

    if comments:
        result["comments"] = comments
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

    with path_lock(archive_directory_path).write_locked():
        content = files.get("content", None) if files else None

        # the page is normally written through save_archive_file, so only the ScrapBook
        # metadata and the icon are persisted when no content is supplied
        if content is not None:
            index_file_path = os.path.join(archive_directory_path, "index.html")

            with atomic_file(index_file_path) as index_file:
                content.save(index_file)

        create_rdf_metadata(params)
        persist_archive_icon(params)


def persist_archive_icon(params):
    archive_directory_path = resolve_client_path(params["rdf_archive_path"], for_write=True)
    icon_data = params.get("icon_data", None)

    if icon_data:
        icon_file_path = safe_join_path(archive_directory_path, f"favicon.{params['icon_ext']}")
        icon_bytes = base64.b64decode(icon_data)
        atomic_write(icon_file_path, icon_bytes)


def fetch_archive_file(params):
    archive_file_path = safe_join_path(resolve_client_path(params["rdf_archive_path"]), params["file"])

    file_content = None
    if os.path.exists(archive_file_path):
        with open(archive_file_path, "rb") as archive_file:
            file_content = archive_file.read()

    return file_content


def save_archive_file(params, files, compute_index=False):
    archive_directory_path = resolve_client_path(params["rdf_archive_path"], for_write=True)
    archive_file_path = safe_join_path(archive_directory_path, params["file"])

    with path_lock(archive_directory_path).write_locked():
        with atomic_file(archive_file_path) as archive_file:
            files["content"].save(archive_file)

        # building the index parses every page of the archive, so it is done once the
        # capture has written its index file, not for every resource that is saved
        index = build_archive_index(archive_directory_path) if compute_index else []

    return json.dumps(index)


def persist_comments(params):
    archive_directory_path = resolve_client_path(params["rdf_archive_path"], for_write=True)
    comments = json.loads(params["comments_json"])

    # read-modify-write
    with path_lock(archive_directory_path).write_locked():
        metadata = parse_rdf_metadata(read_rdf_metadata(archive_directory_path))
        # the comment is written even when the metadata file has no comment line yet
        metadata["comment"] = comments["content"].replace("\n", COMMENT_LINE_BREAK)
        write_rdf_metadata(archive_directory_path, format_rdf_metadata(metadata))


def _archive_directory_of(params, location, for_write=False):
    """Resolves either an RDF data directory or the unpacked archive directory of a Scrapyard item."""
    if location["kind"] == "rdf":
        return resolve_client_path(location["path"], for_write=for_write)

    object_directory = server.storage_manager.get_object_directory(params, location["uuid"])
    return server.storage_manager.get_archive_unpacked_path(object_directory)


def transfer_archive(params):
    """Copies the files of an unpacked archive between an RDF directory and the Scrapyard storage.

    Used when an item is moved or copied across the boundary of an RDF shelf: unlike copying the
    page alone, this carries the resource files of the archive with it.
    """
    source = _archive_directory_of(params, params["source"])
    destination = _archive_directory_of(params, params["destination"], for_write=True)

    # a packed archive, or one kept in the browser storage, has no directory to copy;
    # the add-on transfers those through the storage layer instead
    if not os.path.isdir(source):
        return {"transferred": False}

    def copy():
        with path_lock(destination).write_locked():
            shutil.copytree(source, destination, dirs_exist_ok=True)

    with_mutex(copy)

    return {"transferred": True}


