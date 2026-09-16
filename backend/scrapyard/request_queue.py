import logging
import os
import threading
from concurrent.futures import Future
from queue import Queue

REQUEST_TIMEOUT = 300


class RequestQueue:
    """Serializes storage modifications in a single thread."""

    def __init__(self):
        self.request_queue = Queue()
        self.processor_thread = None
        self.processor_pid = None
        self.start_mutex = threading.Lock()

    def processor(self):
        while True:
            request, params, future = self.request_queue.get()

            try:
                future.set_result(request(params))
            except Exception as e:
                logging.exception(e)
                future.set_exception(e)

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

    def submit(self, request, params):
        self._ensure_processor()
        future = Future()
        self.request_queue.put((request, params, future,))
        return future

    def add(self, request, params):
        self.submit(request, params)

    def run(self, request, params, timeout=REQUEST_TIMEOUT):
        """Executes the request in the queue and waits for its completion, exceptions are propagated."""
        return self.submit(request, params).result(timeout=timeout)
