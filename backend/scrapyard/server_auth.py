import base64
import collections
import hashlib
import hmac
import logging
import secrets
import threading
import time

from flask import request, abort, g, jsonify, render_template

from . import config

# Server mode authentication
#
# 1. A client exchanges AUTH_KEY for a session token: POST /auth/session with "Authorization: Bearer <AUTH_KEY>".
# 2. API requests carry "Authorization: Bearer <session token>".
# 3. WebSocket connections send {"type": "INITIALIZE", "token": <session token>} as the first frame.
# 4. URLs opened in browser tabs (which can not carry headers) are signed: /s/<signature>/<path>.
#    The signature covers a path prefix, an expiration time and the session id; it is derived from AUTH_KEY,
#    so signed URLs survive server restarts.
#
# Only wrong AUTH_KEY values and forged URL signatures count as authentication failures. Session tokens
# are 256-bit random values, and stale tokens are expected after server restarts.

auth_log = logging.getLogger("scrapyard.auth")

SIGNED_URL_PREFIX = "/s/"
PUBLIC_PATHS = {"/", "/auth/session", "/ws", "/favicon.ico"}
PUBLIC_PATH_PREFIXES = ("/resources/",)
# resources that could be opened in browser tabs through signed URLs
SIGNABLE_PATH_PREFIXES = ("/browse/", "/rdf/browse/", "/rdf/import/files/", "/serve/file/",
                          "/export/download", "/backend_log")


class Session:
    def __init__(self, token, ttl):
        self.token = token
        self.sid = secrets.token_urlsafe(12)
        self.ttl = ttl
        self.expires = time.time() + ttl
        self.channel = None
        # state of multistep operations (export, restore)
        self.context = dict()

    def touch(self):
        self.expires = time.time() + self.ttl

    @property
    def expired(self):
        return time.time() > self.expires


class SessionStore:
    def __init__(self):
        self._by_token = dict()
        self._by_sid = dict()
        self._mutex = threading.Lock()

    def create(self):
        with self._mutex:
            self._cleanup()
            session = Session(secrets.token_urlsafe(32), config.SESSION_TTL)
            self._by_token[session.token] = session
            self._by_sid[session.sid] = session
            return session

    def get(self, token):
        if not token:
            return None

        with self._mutex:
            session = self._by_token.get(token, None)
            if session and not session.expired:
                session.touch()
                return session

    def get_by_sid(self, sid):
        with self._mutex:
            session = self._by_sid.get(sid, None)
            if session and not session.expired:
                return session

    def delete(self, token):
        with self._mutex:
            session = self._by_token.pop(token, None)
            if session:
                self._by_sid.pop(session.sid, None)
                if session.channel:
                    session.channel.close()

    def _cleanup(self):
        expired = [s for s in self._by_token.values() if s.expired and not (s.channel and s.channel.connected)]
        for session in expired:
            del self._by_token[session.token]
            self._by_sid.pop(session.sid, None)


class AuthLimiter:
    """In-memory brute-force protection (valid because the server runs in a single process)."""

    MAX_FAILURES = 5
    FAILURE_WINDOW = 15 * 60
    BASE_BLOCK = 60
    MAX_BLOCK = 24 * 60 * 60
    GLOBAL_MAX_FAILURES_PER_MINUTE = 30
    MAX_TRACKED_ADDRESSES = 10000

    class Record:
        def __init__(self):
            self.failures = collections.deque()
            self.blocked_until = 0
            self.strikes = 0
            self.last_seen = time.time()

    def __init__(self):
        self._records = dict()
        self._global_failures = collections.deque()
        self._mutex = threading.Lock()

    def retry_after(self, address):
        now = time.time()

        with self._mutex:
            record = self._records.get(address, None)
            if record and record.blocked_until > now:
                return int(record.blocked_until - now) + 1

            self._prune(self._global_failures, now - 60)
            if len(self._global_failures) >= self.GLOBAL_MAX_FAILURES_PER_MINUTE:
                return int(self._global_failures[0] + 60 - now) + 1

        return 0

    def failure(self, address, reason):
        now = time.time()
        auth_log.warning(f"AUTH_FAILURE ip={address} reason={reason}")

        with self._mutex:
            self._global_failures.append(now)

            if len(self._records) > self.MAX_TRACKED_ADDRESSES:
                self._evict(now)

            record = self._records.setdefault(address, AuthLimiter.Record())
            record.last_seen = now
            record.failures.append(now)
            self._prune(record.failures, now - self.FAILURE_WINDOW)

            if len(record.failures) >= self.MAX_FAILURES:
                record.strikes += 1
                block = min(self.BASE_BLOCK * 2 ** (record.strikes - 1), self.MAX_BLOCK)
                record.blocked_until = now + block
                record.failures.clear()
                auth_log.warning(f"AUTH_BLOCKED ip={address} seconds={block}")

    def success(self, address):
        with self._mutex:
            self._records.pop(address, None)

    @staticmethod
    def _prune(timestamps, threshold):
        while timestamps and timestamps[0] < threshold:
            timestamps.popleft()

    def _evict(self, now):
        stale = [a for a, r in self._records.items()
                 if r.blocked_until < now and r.last_seen < now - self.FAILURE_WINDOW]
        for address in stale:
            del self._records[address]


sessions = SessionStore()
limiter = AuthLimiter()


def _url_signing_key():
    return hmac.new(config.AUTH_KEY.encode("utf-8"), b"scrapyard-url-signing", hashlib.sha256).digest()


def _b64encode(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64decode(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign_path(path, sid, ttl=None):
    """Returns a signed URL path for the given path (the query string is preserved but not signed)."""
    path_part, sep, query = path.partition("?")
    expires = int(time.time() + (ttl or config.SIGNED_URL_TTL))
    payload = f"{expires}|{sid}|{path_part}".encode("utf-8")
    signature = hmac.new(_url_signing_key(), payload, hashlib.sha256).digest()
    token = f"{_b64encode(payload)}.{_b64encode(signature)}"
    return f"{SIGNED_URL_PREFIX}{token}{path_part}{sep}{query}"


def verify_signed_token(token, path):
    """Returns (sid, error). The path should start with the signed prefix."""
    try:
        payload_text, signature_text = token.split(".", 1)
        payload = _b64decode(payload_text)
        signature = _b64decode(signature_text)
    except Exception:
        return None, "malformed"

    expected = hmac.new(_url_signing_key(), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, signature):
        return None, "forged"

    try:
        expires, sid, prefix = payload.decode("utf-8").split("|", 2)
        expires = int(expires)
    except Exception:
        return None, "malformed"

    if time.time() > expires:
        return None, "expired"

    if not path.startswith(prefix):
        return None, "prefix"

    return sid, None


class SignedURLMiddleware:
    """Unwraps /s/<token>/<path> URLs before they reach Flask routing."""

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "")

        if path.startswith(SIGNED_URL_PREFIX):
            rest = path[len(SIGNED_URL_PREFIX):]
            token, slash, target = rest.partition("/")
            target = "/" + target

            if not slash or "/../" in target or target.endswith("/.."):
                sid, error = None, "malformed"
            else:
                sid, error = verify_signed_token(token, target)

            environ["PATH_INFO"] = target
            environ["SCRAPYARD_SIGNED_URL"] = {"sid": sid, "error": error}

        return self.wsgi_app(environ, start_response)


def _bearer_token():
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() == "bearer":
        return token.strip()
    return None


def _too_many_requests(retry_after):
    response = jsonify(error="too_many_requests")
    response.status_code = 429
    response.headers["Retry-After"] = str(retry_after)
    return response


def auth_guard():
    """Flask before_request handler that authenticates all non-public requests in the server mode."""
    g.authenticated = False
    g.session = None

    address = request.remote_addr or "unknown"
    retry_after = limiter.retry_after(address)
    if retry_after:
        return _too_many_requests(retry_after)

    signed = request.environ.get("SCRAPYARD_SIGNED_URL", None)

    if signed is not None:
        if signed["error"]:
            forged = signed["error"] in ("forged", "malformed")

            if forged:
                limiter.failure(address, "signed_url_" + signed["error"])

            # the page is recognized by the add-on, which does not inject the edit toolbar into it
            # and offers to reopen the archive
            return render_template("404.html", title="Link Expired" if not forged else "Invalid Link",
                                   message="LINK EXPIRED" if not forged else "INVALID LINK",
                                   link_expired=True), 401

        if request.method not in ("GET", "HEAD"):
            abort(405)

        g.authenticated = True
        g.session = sessions.get_by_sid(signed["sid"])
        return None

    if request.path in PUBLIC_PATHS or request.path.startswith(PUBLIC_PATH_PREFIXES):
        return None

    session = sessions.get(_bearer_token())

    if not session:
        abort(401)

    g.authenticated = True
    g.session = session


def current_session():
    return getattr(g, "session", None)


def is_authenticated():
    return getattr(g, "authenticated", False)


def check_auth_key(key):
    return bool(key) and hmac.compare_digest(key.encode("utf-8"), config.AUTH_KEY.encode("utf-8"))


def register_routes(app):
    @app.route("/auth/session", methods=["POST"])
    def auth_session():
        address = request.remote_addr or "unknown"

        if not check_auth_key(_bearer_token()):
            limiter.failure(address, "invalid_key")
            abort(401)

        limiter.success(address)
        session = sessions.create()
        auth_log.info(f"AUTH_SUCCESS ip={address}")

        return {"token": session.token, "expires": int(session.expires * 1000), "ttl": config.SESSION_TTL}

    @app.route("/auth/sign_url", methods=["POST"])
    def auth_sign_url():
        path = (request.json or {}).get("path", "")

        if not g.session:
            abort(403)

        if not isinstance(path, str) or not path.startswith(SIGNABLE_PATH_PREFIXES):
            abort(400)

        # only dot segments of the path are rejected, the query (e.g., a search phrase) may contain anything
        if ".." in path.partition("?")[0].split("/"):
            abort(400)

        return {"url": sign_path(path, g.session.sid)}

    @app.route("/auth/logout", methods=["POST"])
    def auth_logout():
        sessions.delete(_bearer_token())
        return "", 204
