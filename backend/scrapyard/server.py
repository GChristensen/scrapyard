import traceback
import threading
import logging
import socket
import time
import os
from functools import wraps
from contextlib import closing

import flask
from flask import request, abort, render_template, send_file
from werkzeug.serving import make_server

from . import config
from .storage_manager import StorageManager
from .utils import module_property

app = flask.Flask(__name__, template_folder="resources", static_folder="resources")
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

accessLog = logging.getLogger('werkzeug')
accessLog.disabled = True

backend_log_file = None

auth_token = None
host = "localhost"
port = None
httpd = None

storage_manager = None


@module_property
def _storage_manager():
    return storage_manager


class Httpd(threading.Thread):
    def __init__(self, app, port):
        threading.Thread.__init__(self, daemon=True)
        self.srv = make_server(host, port, app, True)
        self.ctx = app.app_context()
        self.ctx.push()

    def run(self):
        self.srv.serve_forever()

    def shutdown(self):
        self.srv.shutdown()


def start(options):
    global httpd
    global port
    global auth_token
    global storage_manager

    # the port is checked first: the temporary directory and the state of a process
    # that already serves the port should not be affected
    if httpd or not wait_for_port(options["port"]):
        logging.error(f"Server port {options['port']} is not available.")
        return False

    port = options["port"]
    auth_token = options["auth"]

    storage_manager = StorageManager(port)
    storage_manager.clean_temp_directory()

    logging_enabled = options.get("logging", False)
    app.logger.disabled = not logging_enabled
    if logging_enabled:
        enable_logging()
    # enable_profiling()

    httpd = Httpd(app, port)
    httpd.start()

    logging.info("Server initialized.")

    return True


def init_server_mode():
    """Initializes the application to run under a production WSGI server (see server_main.py)."""
    global port
    global host
    global storage_manager
    global backend_log_file

    from werkzeug.middleware.proxy_fix import ProxyFix
    from . import server_auth

    host = config.HTTP_HOST
    port = config.HTTP_PORT

    storage_manager = StorageManager(port, data_path=config.DATA_PATH)
    storage_manager.clean_temp_directory()

    app.logger.disabled = False
    backend_log_file = config.LOG_FILE

    app.before_request(server_auth.auth_guard)
    server_auth.register_routes(app)

    from . import server_ws

    app.wsgi_app = server_auth.SignedURLMiddleware(app.wsgi_app)

    if config.TRUST_PROXY:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

    logging.info(f"Server initialized, data path: {config.DATA_PATH}")

    return app


def stop():
    global httpd
    httpd.shutdown()


def wait_for_port(port):
    ctr = 20

    while ctr > 0:
        if port_available(port):
            return True
        ctr -= 1
        time.sleep(0.1)

    return False


def port_available(port):
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.settimeout(0.1)
        result = sock.connect_ex(("127.0.0.1", port))
        if result == 0:
            return False
        else:
            return True


def requires_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if config.SERVER_MODE:
            # authentication is performed by server_auth.auth_guard
            from .server_auth import is_authenticated
            if not is_authenticated():
                return abort(401)
        elif not request.authorization or request.authorization["password"] != auth_token:
            return abort(401)
        return f(*args, **kwargs)
    return decorated


def enable_logging():
    global backend_log_file

    backend_log_file = os.path.join(storage_manager.get_temp_directory(), "backend.log")
    logging.basicConfig(filename=backend_log_file, encoding="utf-8", level=logging.DEBUG,
                        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")


def enable_profiling():
    from werkzeug.middleware.profiler import ProfilerMiddleware

    profiler_log_file = os.path.join(storage_manager.get_temp_directory(), "profiler.log")
    profiler_log_file = open(profiler_log_file, "w", encoding="utf-8")
    app.wsgi_app = ProfilerMiddleware(app.wsgi_app, profiler_log_file)


from . import browser
from . import server_resources
from . import server_rdf
from . import server_files
from . import server_browse
from . import server_export
from . import server_backup
from . import server_upload
from . import server_storage


@app.errorhandler(500)
def handle_500(e=None):
    if config.SERVER_MODE:
        logging.error(traceback.format_exc())
        return "Internal server error", 500
    return f"<pre>{traceback.format_exc()}</pre>", 500


@app.after_request
def add_header(r):
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    r.headers["Pragma"] = "no-cache"
    r.headers["Expires"] = "0"
    r.headers['Cache-Control'] = 'public, max-age=0'
    return r


@app.route("/")
def root():
    return "Scrapyard backend application"


@app.errorhandler(404)
def page_not_found(e):
    return render_template("404.html"), 404


@app.route("/exit")
@requires_auth
def exit_app():
    if config.SERVER_MODE:
        return abort(403)
    os._exit(0)


@app.route("/backend_log")
def helper_log():
    if app.logger.disabled or not backend_log_file:
        return "", 404
    else:
        return send_file(backend_log_file, mimetype="text/plain")
