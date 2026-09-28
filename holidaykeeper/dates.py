"""Bank holidays, working days, mandatory days and allowance maths."""

import datetime as dt
import re

ONE_DAY = dt.timedelta(days=1)

REGIONS = {
    "england-and-wales": "England & Wales",
    "scotland": "Scotland",
    "northern-ireland": "Northern Ireland",
}

DEFAULT_SETTINGS = {
    "allowance": 25,
    "work_days": [0, 1, 2, 3, 4],  # Monday=0 ... Sunday=6
    "mandatory_days": ["01-01", "12-25", "12-26"],
    "mandatory_counts": True,  # mandatory days are taken out of the allowance
    "bank_region": "england-and-wales",
    "bank_holidays_off": False,  # True if the job gives bank holidays off on top of the allowance
    "calendar_name": "",
    "ics_url": "",
}

MANDATORY_NAMES = {"01-01": "New Year's Day", "12-25": "Christmas Day", "12-26": "Boxing Day"}

# One-off changes announced by the UK government (apply to all regions).
_ADJUSTMENTS = {
    2020: {"move": {dt.date(2020, 5, 4): dt.date(2020, 5, 8)}, "add": []},
    2022: {
        "move": {dt.date(2022, 5, 30): dt.date(2022, 6, 2)},
        "add": [
            (dt.date(2022, 6, 3), "Platinum Jubilee bank holiday"),
            (dt.date(2022, 9, 19), "State Funeral of Queen Elizabeth II"),
        ],
    },
    2023: {"move": {}, "add": [(dt.date(2023, 5, 8), "Coronation of King Charles III")]},
}


def easter_sunday(year):
    """Gregorian Easter (anonymous algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return dt.date(year, month, day + 1)


def first_monday(year, month):
    d = dt.date(year, month, 1)
    return d + dt.timedelta(days=(7 - d.weekday()) % 7)


def last_monday(year, month):
    d = dt.date(year + month // 12, month % 12 + 1, 1) - ONE_DAY
    return d - dt.timedelta(days=d.weekday())


def _with_substitutes(fixed, reserved):
    """Move fixed-date holidays that fall on a weekend to the next free weekday."""
    taken = set(reserved) | {d for d, _ in fixed if d.weekday() < 5}
    out = []
    for d, name in fixed:
        if d.weekday() < 5:
            out.append((d, name))
            continue
        s = d
        while s.weekday() >= 5 or s in taken:
            s += ONE_DAY
        taken.add(s)
        out.append((s, name + " (substitute day)"))
    return out


def bank_holidays(year, region="england-and-wales"):
    """UK bank holidays for a year as [{"date": "YYYY-MM-DD", "name": ...}], sorted."""
    if region not in REGIONS:
        raise ValueError("unknown region")
    scotland, ni = region == "scotland", region == "northern-ireland"
    easter = easter_sunday(year)

    moveable = [(easter - 2 * ONE_DAY, "Good Friday")]
    if not scotland:
        moveable.append((easter + ONE_DAY, "Easter Monday"))
    moveable.append((first_monday(year, 5), "Early May bank holiday"))
    moveable.append((last_monday(year, 5), "Spring bank holiday"))
    if scotland:
        moveable.append((first_monday(year, 8), "Summer bank holiday"))
    else:
        moveable.append((last_monday(year, 8), "Summer bank holiday"))

    fixed = [(dt.date(year, 1, 1), "New Year's Day")]
    if scotland:
        fixed.append((dt.date(year, 1, 2), "2nd January"))
    if ni:
        fixed.append((dt.date(year, 3, 17), "St Patrick's Day"))
        fixed.append((dt.date(year, 7, 12), "Battle of the Boyne (Orangemen's Day)"))
    if scotland:
        fixed.append((dt.date(year, 11, 30), "St Andrew's Day"))
    fixed.append((dt.date(year, 12, 25), "Christmas Day"))
    fixed.append((dt.date(year, 12, 26), "Boxing Day"))

    days = moveable + _with_substitutes(fixed, [d for d, _ in moveable])
    adj = _ADJUSTMENTS.get(year)
    if adj:
        days = [(adj["move"].get(d, d), n) for d, n in days] + adj["add"]
    return [{"date": d.isoformat(), "name": n} for d, n in sorted(days)]


def daterange(start, end):
    d = start
    while d <= end:
        yield d
        d += ONE_DAY


def parse_mmdd(value, year):
    """'12-25' -> date(year, 12, 25), or None if it does not exist that year (e.g. 02-29)."""
    m = re.fullmatch(r"(\d{2})-(\d{2})", value)
    if not m:
        return None
    try:
        return dt.date(year, int(m.group(1)), int(m.group(2)))
    except ValueError:
        return None


def portion_weight(portion):
    return 0.5 if portion in ("am", "pm") else 1.0


class WorkCalendar:
    """Knows which days are working days for one user's settings."""

    def __init__(self, settings):
        self.settings = settings
        self.work_days = set(settings["work_days"])
        self._bank = {}

    def bank(self, year):
        if year not in self._bank:
            self._bank[year] = bank_holidays(year, self.settings["bank_region"])
        return self._bank[year]

    def bank_dates(self, year):
        return {dt.date.fromisoformat(b["date"]) for b in self.bank(year)}

    def is_working(self, d):
        if d.weekday() not in self.work_days:
            return False
        return not (self.settings["bank_holidays_off"] and d in self.bank_dates(d.year))

    def holiday_days(self, h, year=None):
        """Allowance days a holiday uses (optionally only the part inside `year`)."""
        start, end = dt.date.fromisoformat(h["start"]), dt.date.fromisoformat(h["end"])
        if year is not None:
            start, end = max(start, dt.date(year, 1, 1)), min(end, dt.date(year, 12, 31))
        w = portion_weight(h.get("portion", "full"))
        return sum(w for d in daterange(start, end) if self.is_working(d))

    def mandatory(self, year):
        out = []
        for mmdd in self.settings["mandatory_days"]:
            d = parse_mmdd(mmdd, year)
            if d:
                out.append((d, MANDATORY_NAMES.get(mmdd, "Mandatory day off")))
        return sorted(out)


def year_summary(holidays, settings, year, today):
    """Allowance used / booked / remaining for a year, plus mandatory and bank holiday info."""
    cal = WorkCalendar(settings)
    first, last = dt.date(year, 1, 1), dt.date(year, 12, 31)

    weights = {}
    covered = set()
    for h in holidays:
        start = max(dt.date.fromisoformat(h["start"]), first)
        end = min(dt.date.fromisoformat(h["end"]), last)
        w = portion_weight(h.get("portion", "full"))
        for d in daterange(start, end):
            covered.add(d)
            if cal.is_working(d):
                weights[d] = max(weights.get(d, 0), w)

    mandatory = []
    for d, name in cal.mandatory(year):
        counts = bool(settings["mandatory_counts"]) and cal.is_working(d)
        if counts:
            weights[d] = 1.0
        mandatory.append({"date": d.isoformat(), "name": name, "counts": counts})
    mandatory_dates = {m["date"] for m in mandatory}

    bank = []
    for b in cal.bank(year):
        if settings["bank_holidays_off"]:
            status = "off"
        elif b["date"] in mandatory_dates:
            status = "mandatory"
        elif dt.date.fromisoformat(b["date"]) in covered:
            status = "booked"
        else:
            status = "available"
        bank.append(dict(b, status=status))

    taken = sum(w for d, w in weights.items() if d <= today)
    booked = sum(w for d, w in weights.items() if d > today)
    allowance = float(settings["allowance"])
    return {
        "year": year,
        "allowance": allowance,
        "taken": taken,
        "booked": booked,
        "remaining": allowance - taken - booked,
        "mandatory": mandatory,
        "bank_holidays": bank,
        "bank_region": REGIONS[settings["bank_region"]],
    }


def validate_settings(data, current):
    """Merge user-supplied settings over `current`, raising ValueError on bad input."""
    s = dict(current)
    if "allowance" in data:
        try:
            a = float(data["allowance"])
        except (TypeError, ValueError):
            raise ValueError("allowance must be a number")
        if not 0 <= a <= 366 or a * 2 != int(a * 2):
            raise ValueError("allowance must be between 0 and 366, in half days")
        s["allowance"] = a
    if "work_days" in data:
        wd = data["work_days"]
        if not isinstance(wd, list) or not all(isinstance(x, int) and 0 <= x <= 6 for x in wd):
            raise ValueError("work_days must be a list of 0-6")
        s["work_days"] = sorted(set(wd))
    if "mandatory_days" in data:
        md = data["mandatory_days"]
        if not isinstance(md, list) or len(md) > 50:
            raise ValueError("mandatory_days must be a list")
        clean = []
        for v in md:
            v = str(v).strip()
            if not parse_mmdd(v, 2000):  # 2000 is a leap year, so 02-29 is allowed
                raise ValueError(f"invalid mandatory day {v!r}; use MM-DD")
            clean.append(v)
        s["mandatory_days"] = sorted(set(clean))
    for key in ("mandatory_counts", "bank_holidays_off"):
        if key in data:
            s[key] = bool(data[key])
    if "bank_region" in data:
        if data["bank_region"] not in REGIONS:
            raise ValueError("unknown bank holiday region")
        s["bank_region"] = data["bank_region"]
    if "calendar_name" in data:
        s["calendar_name"] = str(data["calendar_name"]).strip()[:100]
    if "ics_url" in data:
        url = str(data["ics_url"]).strip()
        if url.startswith("webcal://"):
            url = "https://" + url[len("webcal://"):]
        if url and not url.startswith("https://"):
            raise ValueError("calendar link must start with https://")
        s["ics_url"] = url[:2000]
    return s
