import argparse
import subprocess
import platform
import secrets
import site
import stat
import sys
import os

from pathlib import Path

PLATFORM_NAME = platform.system()


def check_binary(base_path, ext):
    if os.path.exists(base_path + ext):
        return base_path + ext
    return None


def get_binary_path(base_path):
    if PLATFORM_NAME == "Windows":
        binaries = [
            check_binary(base_path, ".exe"),
            check_binary(base_path, ".cmd"),
            check_binary(base_path, ".bat")
        ]
    else:
        binaries = [
            check_binary(base_path, ".sh")
        ]

    return next((p for p in binaries if p is not None), base_path)


def write_manifest(template, destination, executable_path):
    with open(template, "r") as manifest_in:
        manifest_text = manifest_in.read()

        executable_manifest_path = executable_path
        if PLATFORM_NAME == "Windows":
            executable_manifest_path = executable_path.replace("/", "\\")
            executable_manifest_path = executable_manifest_path.replace("\\", "\\\\")

        manifest_text = manifest_text.replace("$EXECUTABLE_PATH$", executable_manifest_path)

        Path(os.path.dirname(destination)).mkdir(parents=True, exist_ok=True)
        with open(destination, "w", encoding="utf-8") as manifest_out:
            manifest_out.write(manifest_text)


def write_reg_hklm_value(path, value):
    try:
        winreg.CreateKey(winreg.HKEY_LOCAL_MACHINE, path)
        registry_key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path, 0, winreg.KEY_WRITE)
        winreg.SetValueEx(registry_key, "", 0, winreg.REG_SZ, value)
        winreg.CloseKey(registry_key)
    except WindowsError:
        print("Can't access registry")


parser = argparse.ArgumentParser(description="Scrapyard backend application installer")
parser.add_argument("--server", action="store_true",
                    help="install the backend as a server accessible over the network "
                         "instead of the native messaging helper application")
parser.add_argument("--env-dir", default=None,
                    help="directory of the server .env configuration file (default: the installation directory)")
args = parser.parse_args()

if args.server and PLATFORM_NAME == "Windows":
    print("The server mode is not supported on Windows natively.")
    print("Please run the server in Docker or WSL, see scrapyard_backend/server/DEPLOY.md")
    sys.exit(1)

backend_base = "scrapyard_backend"
server_base = "scrapyard_server"
native_base = "scrapyard_helper"

base_path = str(Path(__file__).parent.parent.resolve())
package_path = str(Path(__file__).parent.resolve())

subprocess.check_call([sys.executable, "-m", "venv", "venv"])


scripts_dir = "Scripts" if PLATFORM_NAME == "Windows" else "bin"
binary_ext = ".exe" if PLATFORM_NAME == "Windows" else ""
venv_scripts = base_path + "/venv/" + scripts_dir
venv_python = venv_scripts + "/python" + binary_ext

subprocess.check_call([venv_python, "-m", "pip", "install", "--upgrade", "pip"])


def write_env_file(env_path):
    if os.path.exists(env_path):
        print(f"Keeping the existing configuration file: {env_path}")
        return None

    auth_key = secrets.token_urlsafe(32)
    data_path = os.path.expanduser("~/scrapyard")

    content = f"""# Scrapyard server configuration

# http or https; with https and without TLS_CERT/TLS_KEY a self-signed certificate is generated
SCHEME=http
# use 127.0.0.1 behind a reverse proxy or `tailscale serve`, 0.0.0.0 to listen on all interfaces
HTTP_HOST=127.0.0.1
HTTP_PORT=20202
# directory with index.jsbk at its root
DATA_PATH={data_path}
# the key that should be entered in the Scrapyard add-on settings
AUTH_KEY={auth_key}

#BACKUP_PATH={data_path}/.backups
#TLS_CERT=/path/to/cert.pem
#TLS_KEY=/path/to/key.pem
# set to 1 when running behind a reverse proxy (Caddy, nginx, tailscale serve)
#TRUST_PROXY=0
#THREADS=32
#LOG_FILE=
#LOG_LEVEL=INFO
# lifetime of archive links opened in browser tabs, 0 - links do not expire
#SIGNED_URL_TTL_HOURS=12
"""

    Path(os.path.dirname(env_path)).mkdir(parents=True, exist_ok=True)
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(fd, "w", encoding="utf-8") as env_file:
        env_file.write(content)

    return auth_key


def write_systemd_unit(executable_path, env_path):
    unit_path = os.path.expanduser(f"~/.config/systemd/user/{server_base}.service")
    Path(os.path.dirname(unit_path)).mkdir(parents=True, exist_ok=True)

    with open(unit_path, "w", encoding="utf-8") as unit_file:
        unit_file.write(f"""[Unit]
Description=Scrapyard backend server
After=network-online.target

[Service]
ExecStart={executable_path} --env {env_path}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
""")

    print(f"Systemd user unit installed at: {unit_path}")
    print("To start the server and run it at boot, execute:")
    print(f"  systemctl --user daemon-reload")
    print(f"  systemctl --user enable --now {server_base}")
    print(f"  sudo loginctl enable-linger $USER")


def write_launchd_plist(executable_path, env_path):
    label = "com.scrapyard.server"
    plist_path = os.path.expanduser(f"~/Library/LaunchAgents/{label}.plist")
    log_path = os.path.expanduser(f"~/Library/Logs/{server_base}.log")
    Path(os.path.dirname(plist_path)).mkdir(parents=True, exist_ok=True)

    with open(plist_path, "w", encoding="utf-8") as plist_file:
        plist_file.write(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{executable_path}</string>
        <string>--env</string>
        <string>{env_path}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{log_path}</string>
    <key>StandardErrorPath</key>
    <string>{log_path}</string>
</dict>
</plist>
""")

    print(f"Launchd agent installed at: {plist_path}")
    print("To start the server, execute:")
    print(f"  launchctl load -w {plist_path}")


if args.server:
    subprocess.check_call([venv_python, "-m", "pip", "install", package_path + "[server]"])

    executable_path = venv_scripts + f"/{server_base}"
    env_directory = os.path.abspath(os.path.expanduser(args.env_dir)) if args.env_dir else base_path
    env_path = os.path.join(env_directory, ".env")

    auth_key = write_env_file(env_path)

    print()
    print(f"Server configuration file: {env_path}")

    if PLATFORM_NAME == "Darwin":
        write_launchd_plist(executable_path, env_path)
    else:
        write_systemd_unit(executable_path, env_path)

    print()
    print(f"To run the server manually: {executable_path} --env {env_path}")

    if auth_key:
        print()
        print(f"Server key (AUTH_KEY): {auth_key}")

    print()
    print("Review the configuration file, then in the Scrapyard add-on settings choose")
    print("Content location: Server, and enter the server URL and key.")
    print("It is recommended to access the server only through LAN or Tailscale,")
    print("see scrapyard_backend/server/DEPLOY.md for the deployment options.")
    sys.exit(0)

subprocess.check_call([venv_python, "-m", "pip", "install", package_path])

executable_base_path = venv_scripts + f"/{backend_base}"
executable_path = get_binary_path(executable_base_path)

firefox_manifest_path = os.path.expanduser(f"~/.mozilla/native-messaging-hosts/{native_base}.json")

if PLATFORM_NAME == "Windows":
    firefox_manifest_path = executable_base_path + ".json.firefox"
elif PLATFORM_NAME == "Darwin":
    firefox_manifest_path = \
        os.path.expanduser(f"~/Library/Application Support/Mozilla/NativeMessagingHosts/{native_base}.json")

write_manifest(package_path + f"/manifests/{backend_base}.json.firefox", firefox_manifest_path, executable_path)

chrome_manifest_path = os.path.expanduser(f"~/.config/google-chrome/NativeMessagingHosts/{native_base}.json")
chromium_manifest_path = chrome_manifest_path.replace("google-chrome", "chromium")

if PLATFORM_NAME == "Windows":
    chrome_manifest_path = executable_base_path + ".json.chrome"
elif PLATFORM_NAME == "Darwin":
    chrome_manifest_path = \
        os.path.expanduser(f"~/Library/Application Support/Google/Chrome/NativeMessagingHosts/{native_base}.json")
    chromium_manifest_path = chrome_manifest_path.replace("Chrome", "Chromium")

write_manifest(package_path + f"/manifests/{backend_base}.json.chrome", chrome_manifest_path, executable_path)

if PLATFORM_NAME != "Windows":
    write_manifest(package_path + f"/manifests/{backend_base}.json.chrome", chromium_manifest_path, executable_path)

if PLATFORM_NAME == "Windows":
    import winreg

    write_reg_hklm_value(f"Software\\Mozilla\\NativeMessagingHosts\\{native_base}", firefox_manifest_path)
    write_reg_hklm_value(f"Software\\Google\\Chrome\\NativeMessagingHosts\\{native_base}", chrome_manifest_path)

print("Native messaging manifests installed at:")
print(f"  Firefox: {firefox_manifest_path}")
print(f"  Chrome: {chrome_manifest_path}")
if PLATFORM_NAME != "Windows":
    print(f"  Chromium: {chromium_manifest_path}")
