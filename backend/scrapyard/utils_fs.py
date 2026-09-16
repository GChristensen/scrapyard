import os
import sys
import time
import uuid
import shutil
import tempfile
from contextlib import contextmanager

LOCK_FILE = "scrapyard.lock"
# Windows byte-range locks are mandatory, the lock is placed beyond the end of the empty lock file,
# so it does not prevent other programs (e.g., cloud sync clients) from reading the file
WIN32_LOCK_OFFSET = 0x7FFFFFFF


@contextmanager
def atomic_file(path, mode="wb", encoding=None):
    """Yields a temporary file in the directory of the target, which atomically replaces the target
    if the block completes without an exception, so readers never observe a partially written file."""
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(prefix=os.path.basename(path) + ".", suffix=".tmp", dir=directory)

    try:
        with os.fdopen(fd, mode, encoding=encoding) as temp_file:
            yield temp_file
            temp_file.flush()
            os.fsync(temp_file.fileno())

        if sys.platform != "win32":  # mkstemp creates files with 0600 permissions
            try:
                mode = os.stat(path).st_mode & 0o777
            except OSError:
                mode = 0o644
            os.chmod(temp_path, mode)

        replace_file(temp_path, path)
    except BaseException:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise


def atomic_write(path, content, encoding="utf-8"):
    """Writes content to a temporary file in the same directory and atomically replaces the target."""
    if isinstance(content, (bytes, bytearray)):
        with atomic_file(path, "wb") as file:
            file.write(content)
    else:
        with atomic_file(path, "w", encoding=encoding) as file:
            file.write(content)


def _retry_on_windows(f):
    # on Windows renames fail if the destination is opened by another process (e.g. a cloud sync client)
    attempts = 10 if sys.platform == "win32" else 1

    for i in range(attempts):
        try:
            return f()
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.05)


def replace_file(source, destination):
    _retry_on_windows(lambda: os.replace(source, destination))


@contextmanager
def atomic_directory(path):
    """Yields a temporary directory next to the target, which replaces the target if the block completes
    without an exception. The previous content of the target is removed."""
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)

    temp_path = tempfile.mkdtemp(prefix=os.path.basename(path) + ".", suffix=".tmp", dir=parent)

    try:
        yield temp_path
    except BaseException:
        shutil.rmtree(temp_path, ignore_errors=True)
        raise

    old_path = None

    try:
        if os.path.exists(path):
            old_path = f"{path}.{uuid.uuid4().hex}.old"
            _retry_on_windows(lambda: os.rename(path, old_path))

        try:
            _retry_on_windows(lambda: os.rename(temp_path, path))
        except BaseException:
            if old_path:
                os.rename(old_path, path)
                old_path = None
            raise
    except BaseException:
        shutil.rmtree(temp_path, ignore_errors=True)
        raise

    if old_path:
        shutil.rmtree(old_path, ignore_errors=True)


class DirectoryLockedError(Exception):
    pass


class DirectoryLock:
    """An exclusive inter-process lock on a directory, held until the process exits.
    Prevents several backend processes from modifying the same storage."""

    def __init__(self, directory):
        self.path = os.path.join(directory, LOCK_FILE)
        self.file = open(self.path, "a+b")

        try:
            self._lock()
        except OSError:
            self.file.close()
            raise DirectoryLockedError(f"The directory {directory} is used by another Scrapyard backend process.")

    def _lock(self):
        if sys.platform == "win32":
            import msvcrt
            self.file.seek(WIN32_LOCK_OFFSET)
            msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
