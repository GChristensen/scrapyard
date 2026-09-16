import argparse
import datetime
import ipaddress
import logging
import os
import socket
import sys

from . import config

# Entry point of the Scrapyard backend in the server mode (scrapyard_server)


def find_env_file(path):
    if path:
        return path

    if os.environ.get("SCRAPYARD_ENV"):
        return os.environ["SCRAPYARD_ENV"]

    if os.path.exists(".env"):
        return ".env"

    return None


def configure_logging():
    handlers = [logging.StreamHandler(sys.stderr)]

    if config.LOG_FILE:
        os.makedirs(os.path.dirname(config.LOG_FILE), exist_ok=True)
        handlers.append(logging.FileHandler(config.LOG_FILE, encoding="utf-8"))

    logging.basicConfig(level=getattr(logging, config.LOG_LEVEL, logging.INFO), handlers=handlers, force=True,
                        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")


def ensure_tls_certificate(config_directory):
    """Generates a self-signed certificate if SCHEME is https and no certificate is configured."""
    if config.TLS_CERT and config.TLS_KEY:
        for file in (config.TLS_CERT, config.TLS_KEY):
            if not os.path.exists(file):
                raise config.ConfigError(f"TLS file {file} does not exist.")
        return

    cert_path = os.path.join(config_directory, "scrapyard_server.crt")
    key_path = os.path.join(config_directory, "scrapyard_server.key")

    if not (os.path.exists(cert_path) and os.path.exists(key_path)):
        generate_self_signed_certificate(cert_path, key_path)
        logging.warning(f"Generated a self-signed TLS certificate: {cert_path}")

    config.TLS_CERT = cert_path
    config.TLS_KEY = key_path


def generate_self_signed_certificate(cert_path, key_path):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    hostname = socket.gethostname()
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"Scrapyard server ({hostname})")])

    alt_names = [x509.DNSName("localhost"), x509.DNSName(hostname)]
    ip_addresses = {"127.0.0.1", "::1"}

    if config.HTTP_HOST not in ("0.0.0.0", "::", ""):
        try:
            ip_addresses.add(str(ipaddress.ip_address(config.HTTP_HOST)))
        except ValueError:
            alt_names.append(x509.DNSName(config.HTTP_HOST))

    try:
        ip_addresses.add(socket.gethostbyname(hostname))
    except OSError:
        pass

    alt_names += [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ip_addresses]

    now = datetime.datetime.now(datetime.timezone.utc)
    certificate = (x509.CertificateBuilder()
                   .subject_name(name)
                   .issuer_name(name)
                   .public_key(key.public_key())
                   .serial_number(x509.random_serial_number())
                   .not_valid_before(now - datetime.timedelta(days=1))
                   .not_valid_after(now + datetime.timedelta(days=825))
                   .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
                   .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                   .sign(key, hashes.SHA256()))

    old_umask = os.umask(0o077) if hasattr(os, "umask") else None
    try:
        with open(key_path, "wb") as key_file:
            key_file.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                             serialization.NoEncryption()))
        with open(cert_path, "wb") as cert_file:
            cert_file.write(certificate.public_bytes(serialization.Encoding.PEM))
    finally:
        if old_umask is not None:
            os.umask(old_umask)


def create_app(env_path=None):
    config.load_env(env_path)
    configure_logging()

    from . import server
    return server.init_server_mode()


def run_gunicorn(app):
    from gunicorn.app.base import BaseApplication

    class ScrapyardServer(BaseApplication):
        def __init__(self, application, options):
            self.application = application
            self.options = options
            super().__init__()

        def load_config(self):
            for key, value in self.options.items():
                self.cfg.set(key, value)

        def load(self):
            return self.application

    options = {
        "bind": f"[{config.HTTP_HOST}]:{config.HTTP_PORT}" if ":" in config.HTTP_HOST
                else f"{config.HTTP_HOST}:{config.HTTP_PORT}",
        # in-memory state (sessions, WebSocket channels, index locks) requires a single process
        "workers": 1,
        "worker_class": "gthread",
        # each WebSocket connection occupies a thread
        "threads": config.THREADS,
        "timeout": 0,
        "graceful_timeout": 10,
        "keepalive": 5,
        "accesslog": "-",
        "errorlog": "-",
        "loglevel": config.LOG_LEVEL.lower(),
        "access_log_format": '%({x-forwarded-for}i)s %(h)s "%(r)s" %(s)s %(b)s %(M)sms',
    }

    if config.SCHEME == "https":
        options["certfile"] = config.TLS_CERT
        options["keyfile"] = config.TLS_KEY

    ScrapyardServer(app, options).run()


def main():
    parser = argparse.ArgumentParser(prog="scrapyard_server", description="Scrapyard backend server")
    parser.add_argument("--env", help="path to the .env configuration file (default: $SCRAPYARD_ENV or ./.env)")
    parser.add_argument("--dev", action="store_true",
                        help="use the Werkzeug development server instead of gunicorn (not for production)")
    args = parser.parse_args()

    env_path = find_env_file(args.env)

    try:
        app = create_app(env_path)

        if config.SCHEME == "https":
            if env_path:
                config_directory = os.path.dirname(os.path.abspath(env_path))
            else:  # e.g., in a container configured through environment variables
                config_directory = os.path.join(config.DATA_PATH, ".tls")
                os.makedirs(config_directory, exist_ok=True)
            ensure_tls_certificate(config_directory)
    except config.ConfigError as e:
        print(f"Configuration error: {e}", file=sys.stderr)
        sys.exit(2)

    if args.dev or sys.platform == "win32":
        if not args.dev:
            print("gunicorn is not available on Windows, please run the server in Docker or WSL. "
                  "Use --dev to start the development server.", file=sys.stderr)
            sys.exit(2)

        logging.warning("Running the development server, do not use it in production.")
        ssl_context = (config.TLS_CERT, config.TLS_KEY) if config.SCHEME == "https" else None
        app.run(host=config.HTTP_HOST, port=config.HTTP_PORT, threaded=True, ssl_context=ssl_context)
    else:
        run_gunicorn(app)


if __name__ == "__main__":
    main()
