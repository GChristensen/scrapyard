"""Serves the capture fixtures on two origins and synthesizes the binary assets.

    python tests/capture/fixtures/serve.py [port] [second port]

Routes on both origins (default 8080 and 8081):
    /<file>                 the fixture files of this directory
    /img/<name>.png         a 32x32 PNG in a color derived from the name
    /img/<name>.gif         a 1x1 GIF
    /gated/logo.png         a PNG only when the request carries the cookie "fixture=1" (set by /cookie.html)
    /media/tone.wav         a short WAV clip
    /media/subs.vtt         WebVTT subtitles
    /fonts/test.ttf         a TrueType font copied from the system (Windows: arial.ttf)
    /csp.html               served with "Content-Security-Policy: script-src 'none'"
    /svg/symbols.svg        an SVG document with a <symbol>
    /engine/<module>        addon/capture, so harness.html can run the content side without the extension
"""

import os
import struct
import sys
import threading
import zlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, "..", "..", "..", "addon", "capture"))


def png(color):
    width = height = 32
    raw = b"".join(b"\x00" + bytes(color) * width for _ in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


GIF = (b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\x00\x00\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,"
       b"\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;")


def wav():
    rate = 8000
    samples = bytes(((i // 20) % 2) * 100 + 64 for i in range(rate // 4))
    header = b"RIFF" + struct.pack("<I", 36 + len(samples)) + b"WAVE" + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate, 1, 8)
    return header + b"data" + struct.pack("<I", len(samples)) + samples


def color_of(name):
    h = zlib.crc32(name.encode()) & 0xffffff
    return (h >> 16 & 0xff, h >> 8 & 0xff, h & 0xff)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def log_message(self, format, *args):
        sys.stderr.write("%s %s\n" % (self.server.server_address[1], format % args))

    def send_bytes(self, data, mime, extra=None):
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]

        if path.startswith("/img/") and path.endswith(".png"):
            return self.send_bytes(png(color_of(path)), "image/png")
        if path.startswith("/img/") and path.endswith(".gif"):
            return self.send_bytes(GIF, "image/gif")
        if path == "/gated/logo.png":
            if "fixture=1" in (self.headers.get("Cookie") or ""):
                return self.send_bytes(png((0, 128, 0)), "image/png")
            return self.send_error(403, "cookie required")
        if path == "/media/tone.wav":
            return self.send_bytes(wav(), "audio/wav")
        if path == "/media/subs.vtt":
            return self.send_bytes(b"WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n", "text/vtt; charset=utf-8")
        if path == "/fonts/test.ttf":
            for candidate in [r"C:\Windows\Fonts\arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                              "/System/Library/Fonts/Supplemental/Arial.ttf"]:
                if os.path.exists(candidate):
                    with open(candidate, "rb") as f:
                        return self.send_bytes(f.read(), "font/ttf", {"Access-Control-Allow-Origin": "*"})
            return self.send_error(404, "no system font found")
        if path.startswith("/engine/"):   # the engine modules, for harness.html
            file = os.path.abspath(os.path.join(ENGINE, path[len("/engine/"):]))
            if file.startswith(ENGINE) and os.path.isfile(file):
                with open(file, "rb") as f:
                    return self.send_bytes(f.read(), "text/javascript; charset=utf-8")
            return self.send_error(404)
        if path == "/csp.html":
            with open(os.path.join(HERE, "csp.html"), "rb") as f:
                return self.send_bytes(f.read(), "text/html; charset=utf-8", {"Content-Security-Policy": "script-src 'none'"})
        if path == "/cookie.html":
            with open(os.path.join(HERE, "cookie.html"), "rb") as f:
                return self.send_bytes(f.read(), "text/html; charset=utf-8", {"Set-Cookie": "fixture=1; Path=/"})

        return super().do_GET()

    def end_headers(self):
        if self.path.startswith("/css/") or self.path.endswith(".css"):
            self.send_header("Access-Control-Allow-Origin", "*")
        if not self._headers_buffer or b"Cache-Control" not in b"".join(self._headers_buffer):
            self.send_header("Cache-Control", "no-store")   # fixtures are edited while testing
        super().end_headers()


def serve(port):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("fixtures on http://localhost:%d/" % port)
    server.serve_forever()


if __name__ == "__main__":
    first = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    second = int(sys.argv[2]) if len(sys.argv) > 2 else 8081
    threading.Thread(target=serve, args=(second,), daemon=True).start()
    serve(first)
