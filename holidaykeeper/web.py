"""HTTP server: JSON API under /api/, static files for everything else."""

import datetime as dt
import json
import os
import re
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

from . import dates, importers
from .store import SESSION_SECONDS, Store, validate_holiday

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
MAX_BODY = 3 * 1024 * 1024
COOKIE = "hk_session"


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


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
                     "regions": dates.REGIONS, "today": self.app.today().isoformat()}

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

    def api_summary(self, query):
        user = self.current_user()
        try:
            year = int(query.get("year", [self.app.today().year])[0])
        except ValueError:
            raise ApiError(400, "year must be a number")
        if not 1900 <= year <= 2200:
            raise ApiError(400, "year out of range")
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
]


def make_server(host, port, data_dir, today=None):
    app = App(data_dir, today)
    handler = type("BoundHandler", (Handler,), {"app": app})
    server = ThreadingHTTPServer((host, port), handler)
    server.app = app
    return server
