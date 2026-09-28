"""SQLite storage for users, login sessions, settings and holidays."""

import contextlib
import datetime as dt
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
import uuid

from .dates import DEFAULT_SETTINGS

PBKDF2_ITERATIONS = 200_000
SESSION_SECONDS = 30 * 24 * 3600
PORTIONS = ("full", "am", "pm")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_salt BLOB NOT NULL,
    pw_hash BLOB NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS holidays (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    portion TEXT NOT NULL DEFAULT 'full',
    note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS holidays_user ON holidays(user_id, start);
"""


def _hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)


def validate_holiday(data):
    """Clean one holiday dict from user input, raising ValueError when invalid."""
    if not isinstance(data, dict):
        raise ValueError("invalid holiday")
    name = str(data.get("name", "")).strip()[:100]
    note = str(data.get("note", "")).strip()[:500]
    portion = data.get("portion") or "full"
    try:
        start = dt.date.fromisoformat(str(data.get("start", "")).strip())
        end_raw = str(data.get("end") or "").strip()
        end = dt.date.fromisoformat(end_raw) if end_raw else start
    except ValueError:
        raise ValueError("dates must be YYYY-MM-DD")
    if not name:
        raise ValueError("name is required")
    if portion not in PORTIONS:
        raise ValueError("portion must be full, am or pm")
    if portion != "full":
        end = start
    if end < start:
        raise ValueError("end date is before start date")
    if (end - start).days > 366:
        raise ValueError("a holiday can be at most a year long")
    return {"name": name, "start": start.isoformat(), "end": end.isoformat(),
            "portion": portion, "note": note}


class Store:
    def __init__(self, path):
        self.path = path
        with self._db() as c:
            c.executescript(SCHEMA)

    @contextlib.contextmanager
    def _db(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    # --- users & sessions -------------------------------------------------

    def user_count(self):
        with self._db() as c:
            return c.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def create_user(self, username, password):
        username = str(username or "").strip()
        password = str(password or "")
        if not re.fullmatch(r"[\w.\- ]{1,32}", username):
            raise ValueError("username must be 1-32 letters, numbers, spaces or . _ -")
        if len(password) < 6:
            raise ValueError("password must be at least 6 characters")
        salt = secrets.token_bytes(16)
        try:
            with self._db() as c:
                cur = c.execute("INSERT INTO users (username, pw_salt, pw_hash) VALUES (?, ?, ?)",
                                (username, salt, _hash(password, salt)))
                return cur.lastrowid
        except sqlite3.IntegrityError:
            raise ValueError("that username is taken")

    def verify_user(self, username, password):
        with self._db() as c:
            row = c.execute("SELECT id, pw_salt, pw_hash FROM users WHERE username = ?",
                            (str(username or "").strip(),)).fetchone()
        if row is None:
            _hash(str(password or ""), b"timing-equaliser")
            return None
        if hmac.compare_digest(_hash(str(password or ""), row["pw_salt"]), row["pw_hash"]):
            return row["id"]
        return None

    def create_session(self, user_id):
        token = secrets.token_urlsafe(32)
        with self._db() as c:
            c.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
            c.execute("INSERT INTO sessions VALUES (?, ?, ?)", (token, user_id, time.time() + SESSION_SECONDS))
        return token

    def session_user(self, token):
        if not token:
            return None
        with self._db() as c:
            row = c.execute(
                "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token = ? AND s.expires > ?", (token, time.time())).fetchone()
        return dict(row) if row else None

    def delete_session(self, token):
        with self._db() as c:
            c.execute("DELETE FROM sessions WHERE token = ?", (token,))

    # --- settings ---------------------------------------------------------

    def get_settings(self, user_id):
        with self._db() as c:
            raw = c.execute("SELECT settings FROM users WHERE id = ?", (user_id,)).fetchone()[0]
        return {**DEFAULT_SETTINGS, **json.loads(raw)}

    def save_settings(self, user_id, settings):
        with self._db() as c:
            c.execute("UPDATE users SET settings = ? WHERE id = ?", (json.dumps(settings), user_id))

    # --- holidays ---------------------------------------------------------

    def list_holidays(self, user_id):
        with self._db() as c:
            rows = c.execute("SELECT id, name, start, end, portion, note FROM holidays "
                             "WHERE user_id = ? ORDER BY start, end", (user_id,)).fetchall()
        return [dict(r) for r in rows]

    def add_holidays(self, user_id, items):
        """Insert already-validated holidays; returns them with ids."""
        out = []
        with self._db() as c:
            for h in items:
                h = dict(h, id=uuid.uuid4().hex[:12])
                c.execute("INSERT INTO holidays (id, user_id, name, start, end, portion, note) "
                          "VALUES (:id, :uid, :name, :start, :end, :portion, :note)", dict(h, uid=user_id))
                out.append(h)
        return out

    def delete_holiday(self, user_id, holiday_id):
        with self._db() as c:
            cur = c.execute("DELETE FROM holidays WHERE id = ? AND user_id = ?", (holiday_id, user_id))
            return cur.rowcount > 0
