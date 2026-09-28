#!/usr/bin/env python3
"""HolidayKeeper: a holiday tracker you host on your laptop and open from your phone.

Run:  python3 server.py [--port 8000] [--data DIR]
Then open the "Phone" URL it prints on any device on the same Wi-Fi.
"""

import argparse
import os
import socket

from holidaykeeper.web import make_server

ROOT = os.path.dirname(os.path.abspath(__file__))


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


def main():
    parser = argparse.ArgumentParser(description="Run the HolidayKeeper server.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data", default=ROOT, help="folder for the database (default: next to server.py)")
    args = parser.parse_args()

    server = make_server("0.0.0.0", args.port, args.data)
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
