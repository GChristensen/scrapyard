import os
import sys
import time
import tempfile


def atomic_write(path, content, encoding="utf-8"):
    """Writes content to a temporary file in the same directory and atomically replaces the target."""
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)

    binary = isinstance(content, (bytes, bytearray))
    fd, temp_path = tempfile.mkstemp(prefix=os.path.basename(path) + ".", suffix=".tmp", dir=directory)

    try:
        if binary:
            with os.fdopen(fd, "wb") as temp_file:
                temp_file.write(content)
                temp_file.flush()
                os.fsync(temp_file.fileno())
        else:
            with os.fdopen(fd, "w", encoding=encoding) as temp_file:
                temp_file.write(content)
                temp_file.flush()
                os.fsync(temp_file.fileno())

        if sys.platform != "win32":  # mkstemp creates files with 0600 permissions
            try:
                mode = os.stat(path).st_mode & 0o777
            except OSError:
                mode = 0o644
            os.chmod(temp_path, mode)

        _replace(temp_path, path)
    except BaseException:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise


def _replace(source, destination):
    # on Windows os.replace fails if the destination is opened by another process (e.g. a cloud sync client)
    attempts = 10 if sys.platform == "win32" else 1

    for i in range(attempts):
        try:
            os.replace(source, destination)
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.05)
