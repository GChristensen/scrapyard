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
    message_queue = channel.message_queue

    if msg["type"] == "INITIALIZE":
        start_server(msg)
    elif msg["type"] == "BACKUP_PUSH_TEXT":
        message_queue.put(msg["text"])
    elif msg["type"] == "EXPORT_PUSH_TEXT":
        message_queue.put(msg["text"])
    elif msg["type"] == "BACKUP_FINISH":
        message_queue.put(None)
    elif msg["type"] == "EXPORT_FINISH":
        message_queue.put(None)
    elif msg["type"] == "RDF_PATH":
        message_queue.put(msg)
    elif msg["type"] == "ARCHIVE_INFO":
        message_queue.put(msg)


def start_server(msg):
    start_success = server.start(msg)
    response = {"type": "INITIALIZED", "version": VERSION}

    if not start_success:
        response["error"] = "address_in_use"

    browser.send_message(json.dumps(response))


if __name__ == "__main__":
    main()
