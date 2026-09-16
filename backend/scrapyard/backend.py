import json
import logging
import os

from . import server, browser
from .browser import native_channel

VERSION = "2.2.0"


def main():
    while True:
        msg = browser.get_message()
        process_message(msg)

    # msg = browser.get_message()
    # start_server(msg)


def process_message(msg, channel=native_channel):
    msg_type = msg["type"]
    # older add-ons do not pass stream ids
    stream_id = msg.get("stream", None)
    stream_id = None if stream_id is None else str(stream_id)

    if msg_type == "INITIALIZE":
        start_server(msg)
    elif msg_type in ("BACKUP_PUSH_TEXT", "EXPORT_PUSH_TEXT"):
        channel.push_stream_text(stream_id, msg["text"])
    elif msg_type in ("BACKUP_FINISH", "EXPORT_FINISH"):
        channel.finish_stream(stream_id)
    elif msg_type in ("BACKUP_ABORT", "EXPORT_ABORT"):
        channel.abort_stream(stream_id)
    elif msg_type in ("RDF_PATH", "ARCHIVE_INFO"):
        channel.put_response(msg)


def start_server(msg):
    start_success = server.start(msg)
    response = {"type": "INITIALIZED", "version": VERSION}

    if not start_success:
        response["error"] = "address_in_use"

    browser.send_message(json.dumps(response))


if __name__ == "__main__":
    main()
