import os
import threading
import weakref
from contextlib import contextmanager


class RWLock:
    """Writer-preferring reader-writer lock (not reentrant)."""

    def __init__(self):
        self._cond = threading.Condition(threading.Lock())
        self._readers = 0
        self._writer = False
        self._writers_waiting = 0

    def acquire_read(self):
        with self._cond:
            while self._writer or self._writers_waiting:
                self._cond.wait()
            self._readers += 1

    def release_read(self):
        with self._cond:
            self._readers -= 1
            if self._readers == 0:
                self._cond.notify_all()

    def acquire_write(self):
        with self._cond:
            self._writers_waiting += 1
            try:
                while self._writer or self._readers:
                    self._cond.wait()
            finally:
                self._writers_waiting -= 1
            self._writer = True

    def release_write(self):
        with self._cond:
            self._writer = False
            self._cond.notify_all()

    @contextmanager
    def read_locked(self):
        self.acquire_read()
        try:
            yield
        finally:
            self.release_read()

    @contextmanager
    def write_locked(self):
        self.acquire_write()
        try:
            yield
        finally:
            self.release_write()


# locks are removed from the registry when no thread holds or waits for them
_registry = weakref.WeakValueDictionary()
_registry_mutex = threading.Lock()


def path_lock(path):
    """Returns a process-wide RWLock associated with the given file path."""
    key = os.path.normcase(os.path.realpath(path))

    with _registry_mutex:
        lock = _registry.get(key, None)
        if lock is None:
            lock = RWLock()
            _registry[key] = lock
        return lock
