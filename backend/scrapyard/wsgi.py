# WSGI entry point for running the server mode under an external gunicorn command, e.g.:
#   SCRAPYARD_ENV=/etc/scrapyard/.env gunicorn -w 1 -k gthread --threads 32 -b 0.0.0.0:20202 scrapyard.wsgi:app
# Only a single worker process is supported.

import os

from .server_main import create_app

app = create_app(os.environ.get("SCRAPYARD_ENV", None))
