import logging
import os
import threading
from queue import Queue


class RequestQueue:
    def __init__(self):
        self.request_queue = Queue()
        self.processor_thread = None
        self.processor_pid = None
        self.start_mutex = threading.Lock()

    def processor(self):
        while True:
            try:
                request, params = self.request_queue.get()
                request(params)
            except Exception as e:
                logging.exception(e)

    def _ensure_processor(self):
        # the processor thread is started lazily in the process that uses the queue:
        # threads do not survive fork, and gunicorn forks workers after the application is imported
        pid = os.getpid()

        if self.processor_pid != pid or not self.processor_thread.is_alive():
            with self.start_mutex:
                if self.processor_pid != pid or not self.processor_thread.is_alive():
                    if self.processor_pid != pid:
                        self.request_queue = Queue()
                    self.processor_thread = threading.Thread(target=self.processor, daemon=True)
                    self.processor_thread.start()
                    self.processor_pid = pid

    def add(self, request, params):
        self._ensure_processor()
        self.request_queue.put((request, params,))
