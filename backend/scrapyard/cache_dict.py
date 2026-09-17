import threading
from collections import UserDict
from datetime import datetime, timedelta


class CacheDict(UserDict):
    """A dictionary whose entries expire after a period of inactivity.
    The lifetime of an entry is tracked individually and is extended on every access, so an entry used by one
    client (e.g., the directory of an unpacked archive opened in a tab) is not evicted by the activity of others."""

    TTL = timedelta(minutes=1)

    def __init__(self, *args, **kwargs):
        self.__mutex = threading.RLock()
        self.__timestamps = dict()
        UserDict.__init__(self, *args, **kwargs)

    def __setitem__(self, key, value):
        with self.__mutex:
            self.__timestamps[key] = datetime.now()
            self.data[key] = value
            self.__remove_expired()

    def __getitem__(self, key):
        with self.__mutex:
            if self.__expired(key):
                raise KeyError(key)
            self.__timestamps[key] = datetime.now()
            return self.data[key]

    def __delitem__(self, key):
        with self.__mutex:
            del self.data[key]
            self.__timestamps.pop(key, None)

    def __contains__(self, key):
        with self.__mutex:
            if key not in self.data or self.__expired(key):
                return False
            self.__timestamps[key] = datetime.now()
            return True

    def get(self, key, default=None):
        with self.__mutex:
            if key in self:
                return self.data[key]
            return default

    def __expired(self, key):
        timestamp = self.__timestamps.get(key, None)
        return timestamp is not None and timestamp < datetime.now() - self.TTL

    def __remove_expired(self):
        remove = [key for key in self.__timestamps if self.__expired(key)]

        for key in remove:
            del self.__timestamps[key]
            self.data.pop(key, None)
