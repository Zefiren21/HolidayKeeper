#!/usr/bin/env python3
"""HolidayKeeper: a tiny holiday tracker you host on your laptop and open from your phone.

Run:  python3 server.py [--port 8000]
Then open the "Phone" URL it prints on any device on the same Wi-Fi.
"""

import argparse
import json
import os
import socket
import threading
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(ROOT, "static")
DATA_FILE = os.path.join(ROOT, "holidays.json")
MAX_BODY = 64 * 1024

_lock = threading.Lock()


def load_holidays():
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_holidays(holidays):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(holidays, f, indent=2)
    os.replace(tmp, DATA_FILE)


def lan_ip():
    """Best guess at this machine's address on the local network."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No packets are sent; this just asks the OS which interface it would route through.
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return None

    def do_GET(self):
        if self.path == "/api/holidays":
            with _lock:
                return self.send_json(200, load_holidays())
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/holidays":
            return self.send_json(404, {"error": "not found"})
        data = self.read_json()
        if not isinstance(data, dict):
            return self.send_json(400, {"error": "invalid JSON"})

        name = str(data.get("name", "")).strip()[:100]
        start = str(data.get("start", "")).strip()
        end = str(data.get("end", "")).strip() or start
        note = str(data.get("note", "")).strip()[:500]
        if not name or len(start) != 10 or len(end) != 10:
            return self.send_json(400, {"error": "name and start date (YYYY-MM-DD) are required"})
        if end < start:
            return self.send_json(400, {"error": "end date is before start date"})

        holiday = {"id": uuid.uuid4().hex[:8], "name": name, "start": start, "end": end, "note": note}
        with _lock:
            holidays = load_holidays()
            holidays.append(holiday)
            save_holidays(holidays)
        return self.send_json(201, holiday)

    def do_DELETE(self):
        prefix = "/api/holidays/"
        if not self.path.startswith(prefix):
            return self.send_json(404, {"error": "not found"})
        hid = self.path[len(prefix):]
        with _lock:
            holidays = load_holidays()
            remaining = [h for h in holidays if h.get("id") != hid]
            if len(remaining) == len(holidays):
                return self.send_json(404, {"error": "not found"})
            save_holidays(remaining)
        return self.send_json(200, {"ok": True})

    def log_message(self, fmt, *args):
        print(f"{self.client_address[0]} - {fmt % args}")


def main():
    parser = argparse.ArgumentParser(description="Run the HolidayKeeper server.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print("HolidayKeeper is running:")
    print(f"  Laptop: http://localhost:{args.port}")
    print(f"  Phone:  http://{lan_ip()}:{args.port}   (same Wi-Fi)")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
