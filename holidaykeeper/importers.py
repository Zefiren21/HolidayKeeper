"""Turn Google Calendar exports (agenda text or .ics) into holiday ranges."""

import datetime as dt
import re
import urllib.request

from .dates import ONE_DAY

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

_DAY_LINE = re.compile(r"^\d{1,2}$")
_MONTH_LINE = re.compile(r"^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})(?:,\s*[A-Za-z]+)?$")
_TIME_LINE = re.compile(r"^(all day|\d{1,2}(:\d{2})?\s*(am|pm)?\s*[–-]\s*\d{1,2}(:\d{2})?\s*(am|pm)?)$", re.I)
_TIME = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", re.I)
_HALF = re.compile(r"(1/2|½|half)[\s-]*day", re.I)
_DAY_N_OF_M = re.compile(r"\(\s*day\s*\d+\s*/\s*\d+\s*\)", re.I)

MAX_MERGE_GAP = 4  # days; lets a Fri + Mon pair join across a weekend


def _hour(match):
    h = int(match.group(1)) % 24
    ampm = (match.group(3) or "").lower()
    if ampm == "pm" and h < 12:
        h += 12
    if ampm == "am" and h == 12:
        h = 0
    return h + int(match.group(2) or 0) / 60


def _portion_from_hours(start, end):
    """A short timed event counts as a half day: morning or afternoon."""
    if end - start > 5:
        return None
    return "am" if start < 12 else "pm"


def parse_agenda_text(text):
    """Parse Google Calendar's agenda view copied as text.

    Each event looks like:  9 / Jan 2026, Fri / All day / Title
    """
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    events, current, portion = [], None, None
    i = 0
    while i < len(lines):
        line = lines[i]
        m = _MONTH_LINE.match(lines[i + 1]) if i + 1 < len(lines) else None
        if _DAY_LINE.match(line) and m:
            month = MONTHS.get(m.group(1).lower())
            try:
                current = dt.date(int(m.group(2)), month, int(line)) if month else None
            except ValueError:
                current = None
            portion = None
            i += 2
            continue
        if current is not None:
            if _TIME_LINE.match(line):
                ms = list(_TIME.finditer(line))
                portion = _portion_from_hours(_hour(ms[0]), _hour(ms[1])) if len(ms) >= 2 else None
            else:
                events.append({"date": current, "title": line, "portion": portion})
                portion = None
        i += 1
    return events


def _ics_unescape(v):
    return (v.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",")
             .replace("\\;", ";").replace("\\\\", "\\"))


def _ics_value(v):
    """Returns (date, datetime-or-None)."""
    v = v.strip()
    if re.fullmatch(r"\d{8}", v):
        return dt.date(int(v[:4]), int(v[4:6]), int(v[6:8])), None
    m = re.fullmatch(r"(\d{8})T(\d{2})(\d{2})(\d{2})?Z?", v)
    if not m:
        raise ValueError(v)
    t = dt.datetime.strptime(m.group(1) + m.group(2) + m.group(3), "%Y%m%d%H%M")
    return t.date(), t


def parse_ics(text):
    """Parse the VEVENTs of an iCalendar file into single-day events."""
    unfolded = re.sub(r"\r?\n[ \t]", "", text)
    events, ev = [], None
    for line in unfolded.splitlines():
        if line == "BEGIN:VEVENT":
            ev = {}
        elif line == "END:VEVENT":
            if ev is not None:
                events.extend(_expand_ics_event(ev))
            ev = None
        elif ev is not None and ":" in line:
            key, _, value = line.partition(":")
            ev[key.split(";")[0].upper()] = value
    return events


def _expand_ics_event(ev):
    if ev.get("STATUS", "").upper() == "CANCELLED" or "DTSTART" not in ev:
        return []
    title = _ics_unescape(ev.get("SUMMARY", "")).strip()
    try:
        start, start_t = _ics_value(ev["DTSTART"])
        if "DTEND" in ev:
            end, end_t = _ics_value(ev["DTEND"])
        else:
            end, end_t = start + (ONE_DAY if start_t is None else dt.timedelta()), start_t
    except ValueError:
        return []

    portion = None
    if start_t is None:
        end -= ONE_DAY  # all-day DTEND is exclusive
    else:
        if end_t and end_t.time() == dt.time(0, 0) and end > start:
            end -= ONE_DAY
        if end_t and start == end_t.date():
            portion = _portion_from_hours(start_t.hour + start_t.minute / 60,
                                          end_t.hour + end_t.minute / 60)
    if end < start:
        end = start
    if (end - start).days > 366:
        return []
    out, d = [], start
    while d <= end:
        out.append({"date": d, "title": title, "portion": portion})
        d += ONE_DAY
    return out


def clean_title(title, person):
    """'Alex Example - 1/2 day hol PM' -> ('Half day', 'pm'); '(Day 1/4)' markers are dropped."""
    portion = None
    if _HALF.search(title):
        if re.search(r"\bpm\b|afternoon", title, re.I):
            portion = "pm"
        else:
            portion = "am"
        return "Half day", portion
    t = re.sub(re.escape(person), "", title, flags=re.I) if person else title
    t = _DAY_N_OF_M.sub("", t)
    t = re.sub(r"\s+", " ", t).strip(" -–:,|")
    return (t or "Holiday"), None


def to_holidays(events, person, work_days):
    """Filter events by person name and merge consecutive days into holiday ranges."""
    needle = (person or "").strip().lower()
    days = {}
    for e in events:
        if needle and needle not in e["title"].lower():
            continue
        label, portion = clean_title(e["title"], person)
        portion = portion or e.get("portion") or "full"
        prev = days.get(e["date"])
        if prev is None or (prev[1] != "full" and portion == "full"):
            days[e["date"]] = (label, portion)

    items = []
    for d in sorted(days):
        label, portion = days[d]
        last = items[-1] if items else None
        if (last and portion == "full" and last["portion"] == "full" and last["name"] == label
                and 0 < (d - last["end"]).days <= MAX_MERGE_GAP
                and all(g.weekday() not in work_days
                        for g in (last["end"] + ONE_DAY * k for k in range(1, (d - last["end"]).days)))):
            last["end"] = d
        else:
            items.append({"name": label, "start": d, "end": d, "portion": portion, "note": "Imported"})
    for it in items:
        it["start"], it["end"] = it["start"].isoformat(), it["end"].isoformat()
    return items


def parse_calendar(text, person, work_days):
    events = parse_ics(text) if "BEGIN:VCALENDAR" in text else parse_agenda_text(text)
    return to_holidays(events, person, work_days)


MAX_ICS_BYTES = 5 * 1024 * 1024


def fetch_ics(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "HolidayKeeper"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read(MAX_ICS_BYTES + 1)
    if len(data) > MAX_ICS_BYTES:
        raise ValueError("calendar is too large")
    text = data.decode("utf-8", errors="replace")
    if "BEGIN:VCALENDAR" not in text:
        raise ValueError("that link did not return an iCal calendar")
    return text
