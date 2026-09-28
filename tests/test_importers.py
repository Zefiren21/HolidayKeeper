import os
import unittest

from holidaykeeper.dates import DEFAULT_SETTINGS, WorkCalendar
from holidaykeeper.importers import clean_title, parse_calendar

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "google_agenda_2026.txt")
MON_FRI = [0, 1, 2, 3, 4]

ICS = "\r\n".join([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260810",
    "DTEND;VALUE=DATE:20260815",
    "SUMMARY:Alex Example - Summer",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART:20261002T130000Z",
    "DTEND:20261002T173000Z",
    "SUMMARY:Alex Ex",
    " ample appointment",  # folded line
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261102",
    "DTEND;VALUE=DATE:20261103",
    "SUMMARY:Sam Other",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261201",
    "DTEND;VALUE=DATE:20261202",
    "SUMMARY:Alex Example",
    "STATUS:CANCELLED",
    "END:VEVENT",
    "END:VCALENDAR",
])


class AgendaTextTest(unittest.TestCase):
    def setUp(self):
        with open(FIXTURE, encoding="utf-8") as f:
            self.items = parse_calendar(f.read(), "Alex Example", MON_FRI)

    def test_groups_days_into_holidays(self):
        ranges = [(i["start"], i["end"], i["portion"]) for i in self.items]
        self.assertEqual(ranges, [
            ("2026-01-09", "2026-01-12", "full"),
            ("2026-03-05", "2026-03-05", "pm"),
            ("2026-03-12", "2026-03-13", "full"),
            ("2026-04-10", "2026-04-10", "full"),
            ("2026-05-04", "2026-05-08", "full"),
            ("2026-05-28", "2026-05-29", "full"),
            ("2026-06-18", "2026-06-19", "full"),
            ("2026-07-30", "2026-07-31", "full"),
            ("2026-09-21", "2026-09-22", "full"),
        ])
        self.assertEqual(self.items[0]["name"], "Holiday")
        self.assertEqual(self.items[1]["name"], "Half day")

    def test_total_working_days(self):
        cal = WorkCalendar(DEFAULT_SETTINGS)
        self.assertEqual(sum(cal.holiday_days(i) for i in self.items), 18.5)

    def test_name_filter(self):
        with open(FIXTURE, encoding="utf-8") as f:
            self.assertEqual(parse_calendar(f.read(), "Someone Else", MON_FRI), [])


class IcsTest(unittest.TestCase):
    def test_parse_and_filter(self):
        items = parse_calendar(ICS, "alex example", MON_FRI)
        self.assertEqual([(i["name"], i["start"], i["end"], i["portion"]) for i in items], [
            ("Summer", "2026-08-10", "2026-08-14", "full"),
            ("appointment", "2026-10-02", "2026-10-02", "pm"),
        ])

    def test_no_filter_imports_everyone(self):
        self.assertEqual(len(parse_calendar(ICS, "", MON_FRI)), 3)


class CleanTitleTest(unittest.TestCase):
    def test_examples(self):
        self.assertEqual(clean_title("Alex Example (Day 2/5)", "Alex Example"), ("Holiday", None))
        self.assertEqual(clean_title("Alex Example - half day AM", "Alex Example"), ("Half day", "am"))
        self.assertEqual(clean_title("Alex Example: Paris", "Alex Example"), ("Paris", None))


if __name__ == "__main__":
    unittest.main()
