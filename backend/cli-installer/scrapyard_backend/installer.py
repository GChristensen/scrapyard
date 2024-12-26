import subprocess
import platform
import site
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


backend_base = "scrapyard_backend"
native_base = "scrapyard_helper"

base_path = str(Path(__file__).parent.parent.resolve())
package_path = str(Path(__file__).parent.resolve())

subprocess.check_call([sys.executable, "-m", "venv", "venv"])


scripts_dir = "Scripts" if PLATFORM_NAME == "Windows" else "bin"
binary_ext = ".exe" if PLATFORM_NAME == "Windows" else ""
venv_scripts = base_path + "/venv/" + scripts_dir
venv_python = venv_scripts + "/python" + binary_ext

subprocess.check_call([venv_python, "-m", "pip", "install", "--upgrade", "pip"])
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
