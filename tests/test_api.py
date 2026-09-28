"""End-to-end tests: start a real server on a free port and talk to it over HTTP."""

import datetime as dt
import http.cookiejar
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from holidaykeeper.web import make_server

os.environ.setdefault("HK_QUIET", "1")
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "google_agenda_2026.txt")
TODAY = dt.date(2026, 6, 1)


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method, path, body=None, content_type="application/json"):
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", content_type)
        try:
            with self.opener.open(req) as resp:
                raw, status = resp.read(), resp.status
                ctype = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            raw, status, ctype = e.read(), e.code, e.headers.get("Content-Type", "")
        return status, (json.loads(raw) if "json" in ctype else raw.decode())

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, body=None):
        return self.request("POST", path, body if body is not None else {})


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.server = make_server("127.0.0.1", 0, self.tmp, today=lambda: TODAY)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        shutil.rmtree(self.tmp)

    def user(self, name="alice", password="secret123"):
        c = Client(self.base)
        status, body = c.post("/api/register", {"username": name, "password": password})
        self.assertEqual(status, 201, body)
        return c

    def test_serves_app_page(self):
        status, body = Client(self.base).get("/")
        self.assertEqual(status, 200)
        self.assertIn("HolidayKeeper", body)

    def test_requires_login(self):
        c = Client(self.base)
        for path in ("/api/me", "/api/holidays", "/api/summary"):
            self.assertEqual(c.get(path)[0], 401)
        self.assertEqual(c.post("/api/holidays", {"name": "x", "start": "2026-01-01"})[0], 401)

    def test_register_login_logout(self):
        c = self.user()
        status, me = c.get("/api/me")
        self.assertEqual((status, me["username"]), (200, "alice"))
        self.assertEqual(me["settings"]["mandatory_days"], ["01-01", "12-25", "12-26"])

        self.assertEqual(Client(self.base).post("/api/register",
                         {"username": "ALICE", "password": "whatever1"})[0], 400)
        self.assertEqual(Client(self.base).post("/api/register",
                         {"username": "bob", "password": "123"})[0], 400)

        c.post("/api/logout")
        self.assertEqual(c.get("/api/me")[0], 401)
        self.assertEqual(c.post("/api/login", {"username": "alice", "password": "nope"})[0], 401)
        self.assertEqual(c.post("/api/login", {"username": "alice", "password": "secret123"})[0], 200)
        self.assertEqual(c.get("/api/me")[0], 200)

    def test_users_are_isolated(self):
        alice, bob = self.user("alice"), self.user("bob")
        status, h = alice.post("/api/holidays", {"name": "Rome", "start": "2026-07-06", "end": "2026-07-10"})
        self.assertEqual((status, h["days"]), (201, 5))
        self.assertEqual(bob.get("/api/holidays")[1], [])
        self.assertEqual(bob.request("DELETE", f"/api/holidays/{h['id']}")[0], 404)
        self.assertEqual(len(alice.get("/api/holidays")[1]), 1)
        self.assertEqual(alice.request("DELETE", f"/api/holidays/{h['id']}")[0], 200)
        self.assertEqual(alice.get("/api/holidays")[1], [])

    def test_holiday_validation(self):
        c = self.user()
        for bad in ({"name": "", "start": "2026-01-01"},
                    {"name": "x", "start": "01/02/2026"},
                    {"name": "x", "start": "2026-01-05", "end": "2026-01-01"},
                    {"name": "x", "start": "2026-01-05", "portion": "evening"}):
            with self.subTest(bad=bad):
                self.assertEqual(c.post("/api/holidays", bad)[0], 400)
        status, h = c.post("/api/holidays", {"name": "x", "start": "2026-01-05", "end": "2026-01-09",
                                             "portion": "am"})
        self.assertEqual((status, h["end"], h["days"]), (201, "2026-01-05", 0.5))

    def test_rejects_non_json_posts(self):
        c = self.user()
        status, _ = c.request("POST", "/api/holidays", b"name=x&start=2026-01-01",
                              content_type="application/x-www-form-urlencoded")
        self.assertEqual(status, 415)

    def test_settings_and_summary(self):
        c = self.user()
        status, s = c.request("PUT", "/api/settings", {"allowance": 30})
        self.assertEqual((status, s["allowance"]), (200, 30))
        self.assertEqual(c.request("PUT", "/api/settings", {"mandatory_days": ["31-12"]})[0], 400)

        c.post("/api/holidays", {"name": "May", "start": "2026-05-04", "end": "2026-05-08"})
        c.post("/api/holidays", {"name": "Aug", "start": "2026-08-24", "end": "2026-08-28"})
        status, s = c.get("/api/summary?year=2026")
        self.assertEqual(status, 200)
        # taken: 1 Jan + 5 May days; booked: 5 Aug days + 25 Dec
        self.assertEqual((s["allowance"], s["taken"], s["booked"], s["remaining"]), (30, 6, 6, 18))

        c.request("PUT", "/api/settings", {"bank_holidays_off": True})
        s = c.get("/api/summary?year=2026")[1]
        # 1 Jan, 4 May, 25 Dec and 31 Aug are now free days
        self.assertEqual((s["taken"], s["booked"]), (4, 5))
        self.assertEqual(c.get("/api/summary?year=abc")[0], 400)

    def test_import_text_then_duplicates(self):
        c = self.user()
        with open(FIXTURE, encoding="utf-8") as f:
            text = f.read()
        status, preview = c.post("/api/import/preview", {"text": text, "name": "Alex Example"})
        self.assertEqual(status, 200, preview)
        self.assertEqual(len(preview["items"]), 9)
        self.assertFalse(any(i["duplicate"] for i in preview["items"]))

        status, added = c.post("/api/holidays", {"items": preview["items"]})
        self.assertEqual((status, len(added)), (201, 9))
        s = c.get("/api/summary?year=2026")[1]
        self.assertEqual(s["taken"] + s["booked"], 18.5 + 2)  # imported days + 1 Jan + 25 Dec

        preview = c.post("/api/import/preview", {"text": text, "name": "Alex Example"})[1]
        self.assertTrue(all(i["duplicate"] for i in preview["items"]))

    def test_import_from_google_link(self):
        c = self.user()
        self.assertEqual(c.post("/api/import/preview", {"source": "google"})[0], 400)
        c.request("PUT", "/api/settings", {"ics_url": "https://calendar.google.com/secret/basic.ics",
                                           "calendar_name": "Alex Example"})
        fetched = []
        self.server.app.fetch_ics = lambda url: fetched.append(url) or (
            "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261012\nDTEND;VALUE=DATE:20261017\n"
            "SUMMARY:Alex Example\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261012\n"
            "DTEND;VALUE=DATE:20261013\nSUMMARY:Team offsite\nEND:VEVENT\nEND:VCALENDAR\n")
        status, preview = c.post("/api/import/preview", {"source": "google"})
        self.assertEqual(status, 200, preview)
        self.assertEqual(fetched, ["https://calendar.google.com/secret/basic.ics"])
        self.assertEqual([(i["start"], i["end"], i["days"]) for i in preview["items"]],
                         [("2026-10-12", "2026-10-16", 5)])

        def broken(url):
            raise OSError("network down")
        self.server.app.fetch_ics = broken
        self.assertEqual(c.post("/api/import/preview", {"source": "google"})[0], 502)

    def test_first_user_inherits_legacy_holidays(self):
        with open(os.path.join(self.tmp, "holidays.json"), "w") as f:
            json.dump([{"id": "a", "name": "Old trip", "start": "2026-02-02", "end": "2026-02-03",
                        "note": ""}], f)
        c = self.user()
        self.assertEqual([h["name"] for h in c.get("/api/holidays")[1]], ["Old trip"])
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "holidays.json.migrated")))
        self.assertEqual(self.user("bob").get("/api/holidays")[1], [])


if __name__ == "__main__":
    unittest.main()
