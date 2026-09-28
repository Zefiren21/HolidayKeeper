"""HTTP server: JSON API under /api/, static files for everything else."""

import datetime as dt
import json
import os
import re
import socket
import sys
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote

from . import dates, importers
from .store import SESSION_SECONDS, Store, validate_holiday

# Inside the PyInstaller .exe, bundled files are unpacked to sys._MEIPASS.
_BASE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATIC_DIR = os.path.join(_BASE, "static")
MAX_BODY = 3 * 1024 * 1024
COOKIE = "hk_session"


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


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


def _public(h):
    """A holiday as other people see it: no private notes."""
    return {k: h[k] for k in ("name", "start", "end", "portion", "days") if k in h}


def _overlaps(a, b):
    return a["start"] <= b["end"] and b["start"] <= a["end"]


class App:
    """Everything the request handler needs; one per server."""

    def __init__(self, data_dir, today=None):
        os.makedirs(data_dir, exist_ok=True)
        self.data_dir = data_dir
        self.store = Store(os.path.join(data_dir, "holidaykeeper.db"))
        self.today = today or dt.date.today  # overridable in tests
        self.fetch_ics = importers.fetch_ics

    def migrate_legacy(self, user_id):
        """Give the first account any holidays saved by the pre-login version (holidays.json)."""
        legacy = os.path.join(self.data_dir, "holidays.json")
        if not os.path.exists(legacy):
            return
        try:
            with open(legacy, encoding="utf-8") as f:
                items = [validate_holiday(h) for h in json.load(f)]
        except (ValueError, json.JSONDecodeError):
            return
        self.store.add_holidays(user_id, items)
        os.replace(legacy, legacy + ".migrated")


class Handler(SimpleHTTPRequestHandler):
    app = None  # set by make_server

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    # --- plumbing ---------------------------------------------------------

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def send_json(self, status, payload, cookie=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        # Requiring a JSON content type means other websites can't forge requests with a plain form.
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            raise ApiError(415, "expected application/json")
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "request too large")
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            raise ApiError(400, "invalid JSON")
        if not isinstance(data, dict):
            raise ApiError(400, "expected a JSON object")
        return data

    def session_token(self):
        cookie = SimpleCookie(self.headers.get("Cookie") or "")
        return cookie[COOKIE].value if COOKIE in cookie else None

    def current_user(self):
        user = self.app.store.session_user(self.session_token())
        if user is None:
            raise ApiError(401, "please log in")
        return user

    def login_cookie(self, user_id):
        token = self.app.store.create_session(user_id)
        return f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_SECONDS}"

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        path, _, query = self.path.partition("?")
        if not path.startswith("/api/"):
            if method == "GET":
                if re.fullmatch(r"/s/[\w-]+", path):
                    self.path = "/share.html"  # the page reads the token from its own URL
                return super().do_GET()
            return self.send_json(405, {"error": "method not allowed"})
        try:
            for m, pattern, fn in ROUTES:
                match = re.fullmatch(pattern, path)
                if match and m == method:
                    status, payload, *cookie = fn(self, parse_qs(query), *match.groups())
                    return self.send_json(status, payload, *cookie)
            raise ApiError(404, "not found")
        except ApiError as e:
            self.send_json(e.status, {"error": e.message})

    def log_message(self, fmt, *args):
        if not os.environ.get("HK_QUIET"):
            print(f"{self.client_address[0]} - {fmt % args}")

    # --- auth -------------------------------------------------------------

    def api_register(self, query):
        data = self.read_json()
        first = self.app.store.user_count() == 0
        try:
            uid = self.app.store.create_user(data.get("username"), data.get("password"))
        except ValueError as e:
            raise ApiError(400, str(e))
        if first:
            self.app.migrate_legacy(uid)
        return 201, {"ok": True}, self.login_cookie(uid)

    def api_login(self, query):
        data = self.read_json()
        uid = self.app.store.verify_user(data.get("username"), data.get("password"))
        if uid is None:
            raise ApiError(401, "wrong username or password")
        return 200, {"ok": True}, self.login_cookie(uid)

    def api_logout(self, query):
        self.read_json()
        token = self.session_token()
        if token:
            self.app.store.delete_session(token)
        return 200, {"ok": True}, f"{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"

    def api_me(self, query):
        user = self.current_user()
        return 200, {"username": user["username"], "settings": self.app.store.get_settings(user["id"]),
                     "regions": dates.REGIONS, "today": self.app.today().isoformat(),
                     "share_base": f"http://{lan_ip()}:{self.server.server_address[1]}"}

    def api_settings(self, query):
        user = self.current_user()
        current = self.app.store.get_settings(user["id"])
        try:
            settings = dates.validate_settings(self.read_json(), current)
        except ValueError as e:
            raise ApiError(400, str(e))
        self.app.store.save_settings(user["id"], settings)
        return 200, settings

    # --- holidays ---------------------------------------------------------

    def _with_days(self, uid, holidays):
        cal = dates.WorkCalendar(self.app.store.get_settings(uid))
        return [dict(h, days=cal.holiday_days(h)) for h in holidays]

    def api_list(self, query):
        user = self.current_user()
        return 200, self._with_days(user["id"], self.app.store.list_holidays(user["id"]))

    def api_add(self, query):
        user = self.current_user()
        data = self.read_json()
        raw = data["items"] if isinstance(data.get("items"), list) else [data]
        if len(raw) > 500:
            raise ApiError(400, "too many holidays at once")
        try:
            items = [validate_holiday(h) for h in raw]
        except ValueError as e:
            raise ApiError(400, str(e))
        added = self._with_days(user["id"], self.app.store.add_holidays(user["id"], items))
        return 201, (added if "items" in data else added[0])

    def api_delete(self, query, holiday_id):
        user = self.current_user()
        if not self.app.store.delete_holiday(user["id"], holiday_id):
            raise ApiError(404, "not found")
        return 200, {"ok": True}

    def _year(self, query):
        try:
            year = int(query.get("year", [self.app.today().year])[0])
        except ValueError:
            raise ApiError(400, "year must be a number")
        if not 1900 <= year <= 2200:
            raise ApiError(400, "year out of range")
        return year

    def api_summary(self, query):
        user = self.current_user()
        year = self._year(query)
        return 200, dates.year_summary(self.app.store.list_holidays(user["id"]),
                                       self.app.store.get_settings(user["id"]), year, self.app.today())

    def api_import_preview(self, query):
        user = self.current_user()
        data = self.read_json()
        settings = self.app.store.get_settings(user["id"])
        person = str(data.get("name", settings["calendar_name"])).strip()[:100]
        if data.get("source") == "google":
            if not settings["ics_url"]:
                raise ApiError(400, "add your Google Calendar iCal link in Settings first")
            try:
                text = self.app.fetch_ics(settings["ics_url"])
            except Exception as e:  # network errors, bad responses
                raise ApiError(502, f"couldn't fetch your calendar: {e}")
        else:
            text = str(data.get("text", ""))
        if not text.strip():
            raise ApiError(400, "nothing to import")
        items = importers.parse_calendar(text, person, settings["work_days"])
        existing = self.app.store.list_holidays(user["id"])
        cal = dates.WorkCalendar(settings)
        for it in items:
            it["duplicate"] = any(_overlaps(it, h) for h in existing)
            it["days"] = cal.holiday_days(it)
        return 200, {"name": person, "items": items}

    # --- sharing ----------------------------------------------------------

    def api_shares(self, query):
        user = self.current_user()
        mine, theirs = self.app.store.shares_for(user["id"])
        return 200, {"sharing_with": mine, "shared_with_me": theirs,
                     "links": self.app.store.links_for(user["id"])}

    def api_share_add(self, query):
        user = self.current_user()
        other = self.app.store.user_by_name(self.read_json().get("username"))
        if other is None:
            raise ApiError(404, "no account with that username")
        if other["id"] == user["id"]:
            raise ApiError(400, "you can't share with yourself")
        self.app.store.add_share(user["id"], other["id"])
        return self.api_shares(query)

    def api_share_remove(self, query, username):
        user = self.current_user()
        other = self.app.store.user_by_name(unquote(username))
        if other is None or not self.app.store.remove_share(user["id"], other["id"]):
            raise ApiError(404, "not found")
        return self.api_shares(query)

    def api_person(self, query, username):
        """Someone else's holidays and allowance, if they have shared with the current user."""
        user = self.current_user()
        owner = self.app.store.user_by_name(unquote(username))
        if owner is None or not self.app.store.can_view(user["id"], owner["id"]):
            raise ApiError(404, "they haven't shared their holidays with you")
        year = self._year(query)
        holidays = self.app.store.list_holidays(owner["id"])
        summary = dates.year_summary(holidays, self.app.store.get_settings(owner["id"]), year, self.app.today())
        return 200, {"username": owner["username"], "summary": summary,
                     "holidays": [_public(h) for h in self._with_days(owner["id"], holidays)]}

    def api_link_create(self, query):
        user = self.current_user()
        self.read_json()
        link = self.app.store.create_link(user["id"])
        return 201, link

    def api_link_delete(self, query, token):
        user = self.current_user()
        if not self.app.store.delete_link(user["id"], token):
            raise ApiError(404, "not found")
        return 200, {"ok": True}

    def api_public(self, query, token):
        """What a share link shows: upcoming holidays from this year on. No login needed."""
        owner = self.app.store.link_owner(token)
        if owner is None:
            raise ApiError(404, "this link has been turned off")
        today = self.app.today()
        since = dt.date(today.year, 1, 1).isoformat()
        holidays = [h for h in self.app.store.list_holidays(owner["id"]) if h["end"] >= since]
        return 200, {"username": owner["username"], "today": today.isoformat(),
                     "holidays": [_public(h) for h in self._with_days(owner["id"], holidays)]}


ROUTES = [
    ("POST", r"/api/register", Handler.api_register),
    ("POST", r"/api/login", Handler.api_login),
    ("POST", r"/api/logout", Handler.api_logout),
    ("GET", r"/api/me", Handler.api_me),
    ("PUT", r"/api/settings", Handler.api_settings),
    ("GET", r"/api/holidays", Handler.api_list),
    ("POST", r"/api/holidays", Handler.api_add),
    ("DELETE", r"/api/holidays/([\w-]+)", Handler.api_delete),
    ("GET", r"/api/summary", Handler.api_summary),
    ("POST", r"/api/import/preview", Handler.api_import_preview),
    ("GET", r"/api/shares", Handler.api_shares),
    ("POST", r"/api/shares", Handler.api_share_add),
    ("DELETE", r"/api/shares/([\w.\- %]+)", Handler.api_share_remove),
    ("GET", r"/api/people/([\w.\- %]+)", Handler.api_person),
    ("POST", r"/api/links", Handler.api_link_create),
    ("DELETE", r"/api/links/([\w-]+)", Handler.api_link_delete),
    ("GET", r"/api/public/([\w-]+)", Handler.api_public),
]


def make_server(host, port, data_dir, today=None):
    app = App(data_dir, today)
    handler = type("BoundHandler", (Handler,), {"app": app})
    server = ThreadingHTTPServer((host, port), handler)
    server.app = app
    return server
