"""Local development HTTP server for ChinaCiv with cache-control headers."""

import http.server
import pathlib
import sys


WEB_DIR = pathlib.Path(__file__).resolve().parent.parent / "web"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self):
        path_only = self.path.split("?", 1)[0].lower()
        if path_only.endswith((".html", ".js", ".css")) or path_only == "/":
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        elif path_only.endswith(".json"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class ReusableThreadingServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ReusableThreadingServer(("127.0.0.1", port), NoCacheHandler)
    print(f"Serving ChinaCiv (no-store JS/CSS/HTML) on http://127.0.0.1:{port}/ ...", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
