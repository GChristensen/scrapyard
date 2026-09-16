import os
import re

from werkzeug.exceptions import BadRequest, Forbidden
from werkzeug.security import safe_join

from . import config

# Validation and confinement of the filesystem paths received from clients.
# In the native messaging mode the backend runs locally on behalf of the user, so client paths are trusted as before.
# In the server mode client paths should point inside DATA_PATH (or BACKUP_PATH for backups): absolute paths are
# used as is, relative paths are resolved against the root.

UUID_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")

PROTECTED_DATA_ENTRIES = ("index.jsbk", "objects")


def validate_uuid(uuid):
    if config.SERVER_MODE:
        if not isinstance(uuid, str) or not UUID_PATTERN.match(uuid):
            raise BadRequest("Invalid UUID.")
    elif isinstance(uuid, str) and ("/" in uuid or "\\" in uuid or uuid in (".", "..")):
        raise BadRequest("Invalid UUID.")

    return uuid


def safe_join_path(directory, file):
    """Joins an untrusted relative file path to the directory, not allowing to escape it."""
    if config.SERVER_MODE:
        path = safe_join(directory, file.replace("\\", "/"))
        if path is None:
            raise BadRequest("Invalid file path.")
        return path
    else:
        return os.path.join(directory, file)


def validate_file_name(file):
    """Accepts only plain file names without directory components."""
    if config.SERVER_MODE:
        if not file or os.path.basename(file.replace("\\", "/")) != file or file in (".", ".."):
            raise BadRequest("Invalid file name.")
    return file


def _is_inside(root, path):
    try:
        return os.path.commonpath([os.path.normcase(root), os.path.normcase(path)]) == os.path.normcase(root)
    except ValueError:  # different drives on Windows
        return False


def _confine(root, client_path, root_name):
    if client_path is None:
        raise BadRequest("Path is not specified.")

    # containment is checked on the normalized path without resolving symlinks,
    # so directories symlinked or mounted into the root by the server administrator are accessible
    root = os.path.abspath(root)
    path = os.path.expanduser(str(client_path).strip())

    if os.name != "nt":
        path = path.replace("\\", "/")

    resolved = os.path.abspath(os.path.join(root, path))  # an absolute path replaces the root

    if not _is_inside(root, resolved):
        raise Forbidden(f"The path {client_path} is outside of the server {root_name} ({root}).")

    return resolved


def resolve_client_path(client_path, for_write=False):
    """Resolves a filesystem path received from a client."""
    if not config.SERVER_MODE:
        return os.path.expanduser(client_path) if client_path else client_path

    resolved = _confine(config.DATA_PATH, client_path, "data directory")

    if for_write:
        relative = os.path.relpath(resolved, os.path.abspath(config.DATA_PATH))
        first = relative.replace("\\", "/").split("/")[0]
        if relative == "." or os.path.normcase(first) in [os.path.normcase(e) for e in PROTECTED_DATA_ENTRIES]:
            raise Forbidden("Modification of the Scrapyard storage files is not allowed.")

    return resolved


def to_client_path(path):
    """Converts a resolved server path to the form that could be passed back to resolve_client_path."""
    return path


def resolve_backup_directory(client_directory):
    if not config.SERVER_MODE:
        return os.path.expanduser(client_directory)

    return _confine(config.BACKUP_PATH, client_directory or "", "backup directory")


def forbid_in_server_mode():
    if config.SERVER_MODE:
        raise Forbidden("This operation is not available in the server mode.")
