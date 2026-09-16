import logging
import queue
import sys
import struct
import json
import threading


class Channel:
    """A bidirectional message channel to the browser add-on.

    The backend may send messages to the add-on and wait for a response. The add-on pushes streamed
    content (e.g., backups) and responses into the message queue, which is consumed by HTTP handlers.
    """

    def __init__(self):
        self.message_mutex = threading.Lock()
        self.message_queue = queue.Queue()
        # state of multistep operations (export, restore)
        self.context = dict()

    def send_message(self, message):
        raise NotImplementedError()

    def send_with_response(self, msg):
        self.message_mutex.acquire()
        response = {}

        try:
            msg_json = json.dumps(msg)
            self.send_message(msg_json)
            response = self.message_queue.get()
        finally:
            self.message_mutex.release()

        return response

    @property
    def connected(self):
        return True


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
        self.closed = False

    def send_message(self, message):
        # messages are double-encoded JSON strings, as in the native messaging protocol
        with self.send_mutex:
            self.ws.send(json.dumps(message))

    def send_with_response(self, msg):
        if not self.message_mutex.acquire(timeout=self.RESPONSE_TIMEOUT):
            return {}

        try:
            self.send_message(json.dumps(msg))
            return self.message_queue.get(timeout=self.RESPONSE_TIMEOUT) or {}
        except queue.Empty:
            logging.error(f"No response from the browser to {msg.get('type')}")
            return {}
        finally:
            self.message_mutex.release()

    def close(self):
        self.closed = True
        # release consumers that may wait for streamed content
        self.message_queue.put(None)

    @property
    def connected(self):
        return not self.closed


native_channel = NativeChannel()

# backwards-compatible module-level aliases
message_mutex = native_channel.message_mutex
message_queue = native_channel.message_queue


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
