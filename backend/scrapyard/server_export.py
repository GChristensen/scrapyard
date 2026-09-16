import tempfile
import os

import flask

from .browser import current_channel, current_context
from .server import app, requires_auth

# Export using helper

# the path of the exported file is kept per client


@app.route("/export/initialize", methods=['GET'])
@requires_auth
def export_initialize():
    channel = current_channel()
    context = current_context()
    export_file = os.path.join(tempfile.gettempdir(), next(tempfile._get_candidate_names()))
    context["export_file"] = export_file

    with open(export_file, mode="w", encoding="utf-8") as fp:
        channel.message_mutex.acquire()
        try:
            while True:
                text = channel.message_queue.get()
                if text is not None:
                    fp.write(text)
                else:
                    fp.flush()
                    break
        finally:
            channel.message_mutex.release()

    return "", 204


@app.route("/export/download", methods=['GET'])
def export_download():
    export_file = current_context().get("export_file", None)

    if not export_file or not os.path.exists(export_file):
        return "", 404

    return flask.send_file(export_file, mimetype="application/json")


@app.route("/export/finalize", methods=['GET'])
@requires_auth
def export_finalize():
    export_file = current_context().pop("export_file", None)

    if export_file and os.path.exists(export_file):
        os.remove(export_file)

    return "", 204
