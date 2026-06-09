"""
WorkSpan API Proxy — pure Python stdlib, no pip installs required.
Listens on http://localhost:8765 and forwards to api.workspan.com.
"""
import sys, os, threading, webbrowser, json, time
import urllib.request, urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8765
WS_API = "https://api.workspan.com"
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_INDEX = os.path.join(BASE_DIR, "index.html")

class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-ws-env")

    def do_OPTIONS(self):
        self.send_response(204); self.send_cors(); self.end_headers()

    def do_GET(self):  self._proxy("GET", None)
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        self._proxy("POST", self.rfile.read(n) if n else None)

    def _proxy(self, method, body):
        target = WS_API + self.path
        hdrs = {}
        for h in ("Authorization", "Content-Type", "x-ws-env"):
            v = self.headers.get(h)
            if v: hdrs[h] = v
        if "Content-Type" not in hdrs and body:
            hdrs["Content-Type"] = "application/json"
        req = urllib.request.Request(target, data=body, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                self.send_response(r.status)
                self.send_cors()
                self.send_header("Content-Type", r.headers.get("Content-Type","application/json"))
                self.end_headers(); self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code); self.send_cors()
            self.send_header("Content-Type","application/json")
            self.end_headers(); self.wfile.write(data)
        except Exception as e:
            msg = json.dumps({"error": str(e)}).encode()
            self.send_response(502); self.send_cors()
            self.send_header("Content-Type","application/json")
            self.end_headers(); self.wfile.write(msg)

if __name__ == "__main__":
    print("="*50)
    print("  Adoption Dashboard — API Proxy (Python)")
    print("="*50)
    threading.Thread(target=lambda: HTTPServer(("localhost",PORT),ProxyHandler).serve_forever(), daemon=True).start()
    print(f"  Proxy running on http://localhost:{PORT}")
    if os.path.exists(APP_INDEX):
        url = "file:///" + APP_INDEX.replace(os.sep, "/")
        print(f"  Opening app: {url}")
        webbrowser.open(url)
    else:
        print(f"  Open index.html in your browser.")
    print("  Keep this window open while using the API feature.")
    print("  Close this window to stop the proxy.")
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        print("  Stopped.")
