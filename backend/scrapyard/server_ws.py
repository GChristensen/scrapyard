import json
import logging

from flask import request
from flask_sock import Sock, ConnectionClosed

from . import backend
from .browser import WebSocketChannel
from .server import app
from .server_auth import sessions

# WebSocket replacement of the native messaging channel in the server mode

INITIALIZE_TIMEOUT = 10
RECEIVE_TIMEOUT = 90  # clients send PING every 20 seconds

sock = Sock(app)


def _parse(frame):
    try:
        msg = json.loads(frame)
        # native messaging clients may send double-encoded JSON
        if isinstance(msg, str):
            msg = json.loads(msg)
        return msg if isinstance(msg, dict) else None
    except Exception:
        return None


@sock.route("/ws")
def websocket(ws):
    address = request.remote_addr or "unknown"
    frame = ws.receive(timeout=INITIALIZE_TIMEOUT)
    msg = _parse(frame) if frame else None

    if not msg or msg.get("type") != "INITIALIZE":
        ws.close(reason=1008, message="Expected INITIALIZE")
        return

    session = sessions.get(msg.get("token"))

    if not session:
        ws.close(reason=1008, message="Unauthorized")
        return

    channel = WebSocketChannel(ws)
    previous_channel = session.channel
    session.channel = channel

    if previous_channel:
        previous_channel.close()

    logging.info(f"WebSocket client connected: {address}")

    try:
        channel.send_message(json.dumps({"type": "INITIALIZED", "version": backend.VERSION}))

        while True:
            frame = ws.receive(timeout=RECEIVE_TIMEOUT)

            if frame is None:  # timeout
                break

            msg = _parse(frame)

            if not msg:
                continue

            msg_type = msg.get("type")

            if msg_type == "PING":
                session.touch()
                channel.send_message(json.dumps({"type": "PONG"}))
            elif msg_type != "INITIALIZE":
                backend.process_message(msg, channel)
    except ConnectionClosed:
        pass
    except Exception as e:
        logging.exception(e)
    finally:
        channel.close()
        if session.channel is channel:
            session.channel = None
        logging.info(f"WebSocket client disconnected: {address}")
