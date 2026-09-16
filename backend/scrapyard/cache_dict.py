import threading
from collections import UserDict
from datetime import datetime, timedelta


class CacheDict(UserDict):
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
            return self.data[key]

    def __contains__(self, key):
        with self.__mutex:
            return key in self.data

    def get(self, key, default=None):
        with self.__mutex:
            return self.data.get(key, default)

    def __remove_expired(self):
        threshold = datetime.now() - timedelta(hours=0, minutes=1)
        remove = [key for key, key_time in self.__timestamps.items() if key_time < threshold]

        for key in remove:
            del self.__timestamps[key]
            del self.data[key]
