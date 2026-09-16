# Scrapyard backend server

By default, the Scrapyard backend application runs locally: the browser starts it through native
messaging. It can also be hosted on a server and shared by several browsers. In this mode:

- The server runs under [gunicorn](https://gunicorn.org/) (a single process with a thread pool).
  It is configured through a `.env` file.
- The add-on connects to the server over HTTP(S) and a WebSocket, which replaces native messaging.
- All content lives in `DATA_PATH` on the server (`index.jsbk` at its root). Each browser keeps its
  own IndexedDB copy and synchronizes it with the server.
- Backups are stored in `BACKUP_PATH` (`DATA_PATH/.backups` by default).
- Paths used by the Files shelf, RDF import and similar features are server paths and should be
  located inside `DATA_PATH`. Relative paths are resolved against `DATA_PATH`. To use a directory
  located elsewhere, symlink or mount it into `DATA_PATH`.
  Opening files in an editor on the server host is not available.

In the add-on settings, choose **Content location: Server**, enter the server URL and key, and click
**Connect**. This resets the browser internal storage and pulls the content from the server.

## Configuration

| Variable      | Required | Description                                                              |
|---------------|----------|--------------------------------------------------------------------------|
| `SCHEME`      | yes      | `http` or `https`                                                         |
| `HTTP_HOST`   | yes      | Interface to listen on, e.g. `127.0.0.1` or `0.0.0.0`                    |
| `HTTP_PORT`   | yes      | Port to listen on                                                         |
| `DATA_PATH`   | yes      | Data directory with `index.jsbk` at its root                              |
| `AUTH_KEY`    | yes      | Server key, at least 24 characters; generate a random one (see below)     |
| `BACKUP_PATH` | no       | Backup directory, `DATA_PATH/.backups` by default                         |
| `TLS_CERT`    | no       | PEM certificate for `SCHEME=https`; if omitted, a self-signed one is generated |
| `TLS_KEY`     | no       | PEM private key for `SCHEME=https`                                        |
| `TRUST_PROXY` | no       | `1` behind a reverse proxy, so client IPs come from `X-Forwarded-For`     |
| `THREADS`     | no       | Worker threads (default 32); each connected browser holds one             |
| `LOG_FILE`    | no       | Log file in addition to stderr                                            |
| `LOG_LEVEL`   | no       | `DEBUG`, `INFO` (default), `WARNING`, `ERROR`                             |

Generate a key:

```sh
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Variables that are already set in the environment take precedence over `.env`.

## Authentication

- The add-on exchanges `AUTH_KEY` for a random session token (`POST /auth/session`). Only this
  endpoint ever receives the key.
- API requests and the WebSocket connection authenticate with the session token. Sessions expire
  after 24 hours of inactivity and do not survive server restarts; the add-on logs in again
  automatically.
- Archives, downloads and other pages opened in browser tabs use signed URLs (`/s/<signature>/...`).
  A signed URL is limited to a single resource path and expires after 12 hours.
- Brute-force protection: after 5 failed attempts within 15 minutes, an IP address is blocked for
  1 minute. The block doubles with every subsequent strike, up to 24 hours. More than 30 failures
  per minute from all addresses combined temporarily blocks new logins for everyone; existing
  sessions keep working.
- Every failure is logged as `AUTH_FAILURE ip=<address> reason=<reason>`, and every block as
  `AUTH_BLOCKED ip=<address> seconds=<n>`, so fail2ban can act on them.

Only enable `TRUST_PROXY=1` when the server is actually behind a proxy. Otherwise, clients can spoof
their address to evade the per-IP limit.

## Deployment options

### 1. Tailscale (recommended)

The server is reachable only from your tailnet, with a valid HTTPS certificate and nothing
exposed to the internet.

```sh
# .env: SCHEME=http, HTTP_HOST=127.0.0.1, HTTP_PORT=20202, TRUST_PROXY=1
tailscale serve --bg --https=443 http://127.0.0.1:20202
```

Server URL in the add-on: `https://<machine>.<tailnet>.ts.net`

### 2. LAN

Use `SCHEME=https`, `HTTP_HOST=0.0.0.0`, and a certificate trusted by the client machines. The easiest
way is [mkcert](https://github.com/FiloSottile/mkcert): install its CA on each client, then issue a
certificate for the server name or IP and set `TLS_CERT`/`TLS_KEY`.

Without `TLS_CERT`/`TLS_KEY`, a self-signed certificate is generated next to the `.env` file:

- **Firefox:** open the server URL in a tab once and accept the certificate exception.
- **Chrome:** add the certificate to the operating system trust store.

Plain `http` on a LAN sends the session token unencrypted. Use it only on a trusted network.

### 3. Internet (not recommended)

If you must, put the server behind [Caddy](https://caddyserver.com/) (see `Caddyfile.example`).
Caddy obtains a Let's Encrypt certificate and proxies WebSockets. Set `HTTP_HOST=127.0.0.1` and
`TRUST_PROXY=1`, and consider:

- requiring TLS client certificates (mTLS) in Caddy
- fail2ban with the filter below

```ini
# /etc/fail2ban/filter.d/scrapyard.conf
[Definition]
failregex = AUTH_FAILURE ip=<HOST>

# /etc/fail2ban/jail.d/scrapyard.conf
[scrapyard]
enabled  = true
filter   = scrapyard
logpath  = /var/log/scrapyard/server.log
maxretry = 5
findtime = 900
bantime  = 86400
```

## Installation

### CLI installer (Linux, macOS)

```sh
./install.sh --server
```

The installer does the following:

- creates a virtual environment and installs the server dependencies
- writes `.env` with a random `AUTH_KEY` (if the file does not exist)
- installs a systemd user unit (Linux) or a launchd agent (macOS), and prints the commands to
  enable it

Use `--env-dir <dir>` to place `.env` somewhere other than the installation directory.

### Docker

```sh
cd server
cp .env.example .env    # set AUTH_KEY and SCHEME
mkdir data && sudo chown 1000:1000 data
docker compose up -d --build
```

The compose file publishes the port on `127.0.0.1` only. Expose it with `tailscale serve`, a reverse
proxy, or by changing the port mapping.

On Windows hosts, run the server in Docker or WSL. gunicorn does not support Windows. For testing
only, `scrapyard_server --dev` starts the Werkzeug development server.

### Manual

```sh
pip install "scrapyard_backend[server]"   # or: pip install "./backend[server]"
scrapyard_server --env /path/to/.env
```

Alternatively, run gunicorn directly. Use exactly one worker: sessions, WebSocket channels and the
`index.jsbk` locks live in process memory.

```sh
SCRAPYARD_ENV=/path/to/.env gunicorn -w 1 -k gthread --threads 32 -b 127.0.0.1:20202 scrapyard.wsgi:app
```

## Data consistency

- Writes of `index.jsbk` are serialized and protected by a reader-writer lock, so no reads happen
  during a write.
- The index and per-item JSON files are written to a temporary file and atomically renamed. A crash
  or an external reader (e.g. a sync client) never sees a partially written file.
- Only one server process should access a data directory at a time.
