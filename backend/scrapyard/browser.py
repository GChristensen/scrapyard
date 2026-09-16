import logging
import queue
import sys
import struct
import json
import threading
import time
import uuid

# how long to wait for the next chunk of streamed content (e.g., a backup) before the stream is aborted
STREAM_IDLE_TIMEOUT = 600
# streams pushed by the add-on that no HTTP request has consumed (e.g., the request has failed) are discarded
ORPHANED_STREAM_TIMEOUT = 600


class StreamAborted(Exception):
    pass


# placed into queues when the channel is closed to release the waiting consumers
_CHANNEL_CLOSED = object()
# the end of a stream aborted by the add-on
_STREAM_ABORTED = object()


class _Stream:
    def __init__(self):
        self.queue = queue.Queue()
        self.created = time.monotonic()
        self.consumed = False


class Channel:
    """A bidirectional message channel to the browser add-on.

    The backend may send messages to the add-on and wait for a response. The add-on pushes streamed
    content (e.g., backups) into per-stream queues, which are consumed by HTTP handlers. Streams are identified
    by ids passed by the add-on both in the HTTP request and in the pushed messages, so content pushed for
    a failed request is never consumed by a subsequent one.
    """

    def __init__(self):
        self.message_mutex = threading.Lock()
        self.message_queue = queue.Queue()
        self.streams = dict()
        self.streams_mutex = threading.Lock()
        self.closed = False
        # state of multistep operations (export, restore)
        self.context = dict()

    def send_message(self, message):
        raise NotImplementedError()

    def send_with_response(self, msg, timeout=None):
        if not self.message_mutex.acquire(timeout=-1 if timeout is None else timeout):
            return {}

        try:
            # the id is echoed by the add-on, responses to earlier requests that have timed out are skipped
            msg = {**msg, "id": uuid.uuid4().hex}
            self.send_message(json.dumps(msg))
            deadline = None if timeout is None else time.monotonic() + timeout

            while True:
                remaining = None if deadline is None else deadline - time.monotonic()

                if remaining is not None and remaining <= 0:
                    raise queue.Empty()

                response = self.message_queue.get(timeout=remaining)

                if response is _CHANNEL_CLOSED:
                    self.message_queue.put(_CHANNEL_CLOSED)  # release other waiting consumers
                    return {}
                elif not isinstance(response, dict):
                    continue
                elif "id" not in response or response["id"] == msg["id"]:  # older add-ons do not echo ids
                    return response
                else:
                    logging.warning(f"Skipping a stale response to {response.get('type')}")
        except queue.Empty:
            logging.error(f"No response from the browser to {msg.get('type')}")
            return {}
        finally:
            self.message_mutex.release()

    def put_response(self, msg):
        self.message_queue.put(msg)

    def _stream(self, stream_id):
        with self.streams_mutex:
            stream = self.streams.get(stream_id, None)

            if stream is None:
                self._discard_orphaned_streams()
                stream = self.streams[stream_id] = _Stream()

            if self.closed:
                stream.queue.put(_CHANNEL_CLOSED)

            return stream

    def _discard_orphaned_streams(self):
        now = time.monotonic()
        orphaned = [k for k, s in self.streams.items() if not s.consumed and now - s.created > ORPHANED_STREAM_TIMEOUT]

        for stream_id in orphaned:
            logging.warning(f"Discarding an orphaned stream {stream_id}")
            del self.streams[stream_id]

    def push_stream_text(self, stream_id, text):
        self._stream(stream_id).queue.put(text)

    def finish_stream(self, stream_id):
        self._stream(stream_id).queue.put(None)

    def abort_stream(self, stream_id):
        self._stream(stream_id).queue.put(_STREAM_ABORTED)

    def read_stream(self, stream_id, timeout=STREAM_IDLE_TIMEOUT):
        """Yields text chunks of a stream until it is finished.
        Raises StreamAborted if the stream is aborted by the add-on, the channel is closed, or no content arrives
        in time, so a partially received stream is never taken for a complete one."""
        stream = self._stream(stream_id)
        stream.consumed = True

        try:
            while True:
                try:
                    text = stream.queue.get(timeout=timeout)
                except queue.Empty:
                    raise StreamAborted("No content has been received from the browser in time.")

                if text is None:
                    return
                elif text is _STREAM_ABORTED:
                    raise StreamAborted("The operation has been aborted by the browser.")
                elif text is _CHANNEL_CLOSED:
                    raise StreamAborted("The connection to the browser is lost.")
                else:
                    yield text
        finally:
            with self.streams_mutex:
                if self.streams.get(stream_id, None) is stream:
                    del self.streams[stream_id]

    def close(self):
        self.closed = True

        # release consumers that may wait for responses or streamed content
        self.message_queue.put(_CHANNEL_CLOSED)

        with self.streams_mutex:
            for stream in self.streams.values():
                stream.queue.put(_CHANNEL_CLOSED)

    @property
    def connected(self):
        return not self.closed


class NativeChannel(Channel):
    """Native messaging over stdin/stdout."""

    def send_message(self, message):
        encoded_message = encode_message(message)
        sys.stdout.buffer.write(encoded_message['length'])
        sys.stdout.buffer.write(encoded_message['content'])
        sys.stdout.buffer.flush()


class WebSocketChannel(Channel):
    """Messaging over a WebSocket connection in the server mode."""

    RESPONSE_TIMEOUT = 60

    def __init__(self, ws):
        super().__init__()
        self.ws = ws
        self.send_mutex = threading.Lock()

    def send_message(self, message):
        # messages are double-encoded JSON strings, as in the native messaging protocol
        with self.send_mutex:
            self.ws.send(json.dumps(message))

    def send_with_response(self, msg, timeout=RESPONSE_TIMEOUT):
        return super().send_with_response(msg, timeout)


native_channel = NativeChannel()


def get_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        sys.exit(0)
    message_length = struct.unpack('=I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(message)


def encode_message(message_content):
    encoded_content = json.dumps(message_content).encode("utf-8")
    encoded_length = struct.pack('=I', len(encoded_content))
    #  use struct.pack("10s", bytes), to pack a string of the length of 10 characters
    return {'length': encoded_length, 'content': struct.pack(str(len(encoded_content))+"s", encoded_content)}


def send_message(message):
    native_channel.send_message(message)


def send_with_response(msg):
    return native_channel.send_with_response(msg)


def current_channel():
    """Returns the channel to the add-on that issued the current request."""
    from . import config

    if not config.SERVER_MODE:
        return native_channel

    from flask import abort
    from .server_auth import current_session

    session = current_session()
    channel = session.channel if session else None

    if not channel or not channel.connected:
        abort(409, "The browser is not connected to the server over WebSocket.")

    return channel


def current_context():
    """Returns a dictionary for the state of multistep operations of the current client."""
    from . import config

    if not config.SERVER_MODE:
        return native_channel.context

    from flask import abort
    from .server_auth import current_session

    session = current_session()

    if not session:
        abort(401)

    return session.context
