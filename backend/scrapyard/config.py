import os

# Server mode configuration, populated from .env by load_env()
# In the native messaging mode SERVER_MODE remains False and other values are not used

SERVER_MODE = False

SCHEME = "http"
HTTP_HOST = "127.0.0.1"
HTTP_PORT = 20202
DATA_PATH = None
BACKUP_PATH = None
AUTH_KEY = None
TLS_CERT = None
TLS_KEY = None
THREADS = 32
TRUST_PROXY = False
LOG_FILE = None
LOG_LEVEL = "INFO"
SESSION_TTL = 24 * 60 * 60
SIGNED_URL_TTL = 12 * 60 * 60

MIN_AUTH_KEY_LENGTH = 24


class ConfigError(Exception):
    pass


def _bool(value):
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _path(value):
    return os.path.realpath(os.path.expanduser(os.path.expandvars(value)))


def load_env(env_path=None):
    global SERVER_MODE, SCHEME, HTTP_HOST, HTTP_PORT, DATA_PATH, BACKUP_PATH, AUTH_KEY, \
        TLS_CERT, TLS_KEY, THREADS, TRUST_PROXY, LOG_FILE, LOG_LEVEL

    if env_path:
        from dotenv import load_dotenv

        if not os.path.exists(env_path):
            raise ConfigError(f"Configuration file {env_path} does not exist.")

        # the actual environment takes precedence over .env
        load_dotenv(env_path, override=False)

    env = os.environ

    missing = [v for v in ("SCHEME", "HTTP_PORT", "HTTP_HOST", "DATA_PATH", "AUTH_KEY") if not env.get(v)]
    if missing:
        raise ConfigError(f"Missing configuration variables: {', '.join(missing)}")

    SCHEME = env["SCHEME"].strip().lower()
    if SCHEME not in ("http", "https"):
        raise ConfigError("SCHEME should be either http or https.")

    try:
        HTTP_PORT = int(env["HTTP_PORT"])
    except ValueError:
        raise ConfigError("HTTP_PORT should be a number.")

    HTTP_HOST = env["HTTP_HOST"].strip()

    AUTH_KEY = env["AUTH_KEY"].strip()
    if len(AUTH_KEY) < MIN_AUTH_KEY_LENGTH:
        raise ConfigError(f"AUTH_KEY should be at least {MIN_AUTH_KEY_LENGTH} characters long. "
                          "Generate one with: python3 -c \"import secrets; print(secrets.token_urlsafe(32))\"")

    DATA_PATH = _path(env["DATA_PATH"])
    os.makedirs(DATA_PATH, exist_ok=True)

    # created when the first backup is performed
    BACKUP_PATH = _path(env["BACKUP_PATH"]) if env.get("BACKUP_PATH") else os.path.join(DATA_PATH, ".backups")

    TLS_CERT = _path(env["TLS_CERT"]) if env.get("TLS_CERT") else None
    TLS_KEY = _path(env["TLS_KEY"]) if env.get("TLS_KEY") else None

    try:
        THREADS = int(env.get("THREADS", THREADS))
    except ValueError:
        raise ConfigError("THREADS should be a number.")

    TRUST_PROXY = _bool(env.get("TRUST_PROXY", "0"))
    LOG_FILE = _path(env["LOG_FILE"]) if env.get("LOG_FILE") else None
    LOG_LEVEL = env.get("LOG_LEVEL", LOG_LEVEL).upper()

    SERVER_MODE = True
