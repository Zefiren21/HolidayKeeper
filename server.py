#!/usr/bin/env python3
"""HolidayKeeper: a holiday tracker you host on your laptop and open from your phone.

Run:  python3 server.py [--port 8000] [--data DIR] [--no-browser]
      (or double-click HolidayKeeper.exe on Windows)
Then open the "Phone" URL it prints on any device on the same Wi-Fi.
"""

import argparse
import os
import sys
import threading
import webbrowser

from holidaykeeper.web import lan_ip, make_server

FROZEN = getattr(sys, "frozen", False)  # True inside the PyInstaller .exe
# The .exe keeps its database next to itself; the script keeps it next to server.py.
ROOT = os.path.dirname(sys.executable if FROZEN else os.path.abspath(__file__))
DEFAULT_PORTS = range(8000, 8010)


def start_server(ports, data):
    """Bind to the first free port; returns (server, port)."""
    error = None
    for port in ports:
        try:
            return make_server("0.0.0.0", port, data), port
        except OSError as e:
            error = e
    raise SystemExit(f"Couldn't start the server: {error}\n"
                     "Is HolidayKeeper already running? Otherwise try --port 8080.")


def main():
    parser = argparse.ArgumentParser(description="Run the HolidayKeeper server.")
    parser.add_argument("--port", type=int, help="port to listen on (default: first free one from 8000)")
    parser.add_argument("--data", default=ROOT, help="folder for the database (default: next to the program)")
    parser.add_argument("--no-browser", action="store_true", help="don't open the app in a browser on start")
    args = parser.parse_args()

    server, port = start_server([args.port] if args.port else DEFAULT_PORTS, args.data)
    print("HolidayKeeper is running:")
    print(f"  Laptop: http://localhost:{port}")
    print(f"  Phone:  http://{lan_ip()}:{port}   (same Wi-Fi)")
    print(f"  Data:   {os.path.join(os.path.abspath(args.data), 'holidaykeeper.db')}")
    print("Close this window (or press Ctrl+C) to stop.", flush=True)
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, [f"http://localhost:{port}"]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        # Double-clicked .exe windows close instantly; keep errors on screen.
        if FROZEN and e.code not in (None, 0):
            print(e.code if isinstance(e.code, str) else "")
            input("Press Enter to close...")
            sys.exit(1)
        raise
