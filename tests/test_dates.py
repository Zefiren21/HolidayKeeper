import datetime as dt
import unittest

from holidaykeeper import dates
from holidaykeeper.dates import DEFAULT_SETTINGS, bank_holidays, easter_sunday, validate_settings, year_summary


def d(s):
    return dt.date.fromisoformat(s)


def settings(**overrides):
    return {**DEFAULT_SETTINGS, **overrides}


def bh_dates(year, region="england-and-wales"):
    return [b["date"] for b in bank_holidays(year, region)]


class EasterTest(unittest.TestCase):
    def test_known_dates(self):
        for year, expected in [(2024, "2024-03-31"), (2025, "2025-04-20"), (2026, "2026-04-05"),
                               (2027, "2027-03-28"), (2038, "2038-04-25")]:
            self.assertEqual(easter_sunday(year), d(expected))


class BankHolidayTest(unittest.TestCase):
    def test_england_2026(self):
        self.assertEqual(bh_dates(2026), [
            "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25",
            "2026-08-31", "2026-12-25", "2026-12-28"])

    def test_christmas_weekend_substitutes_2027(self):
        self.assertEqual(bh_dates(2027)[-2:], ["2027-12-27", "2027-12-28"])

    def test_one_off_changes_2022(self):
        days = bh_dates(2022)
        self.assertIn("2022-01-03", days)  # New Year's Day substitute
        for extra in ("2022-06-02", "2022-06-03", "2022-09-19"):
            self.assertIn(extra, days)
        self.assertNotIn("2022-05-30", days)
        names = {b["date"]: b["name"] for b in bank_holidays(2022)}
        self.assertEqual(names["2022-12-26"], "Boxing Day")
        self.assertEqual(names["2022-12-27"], "Christmas Day (substitute day)")

    def test_scotland_2026(self):
        days = bh_dates(2026, "scotland")
        for expected in ("2026-01-02", "2026-08-03", "2026-11-30"):
            self.assertIn(expected, days)
        self.assertNotIn("2026-04-06", days)  # no Easter Monday in Scotland

    def test_northern_ireland_2026(self):
        days = bh_dates(2026, "northern-ireland")
        self.assertIn("2026-03-17", days)
        self.assertIn("2026-07-13", days)  # 12 July is a Sunday

    def test_unknown_region(self):
        with self.assertRaises(ValueError):
            bank_holidays(2026, "wales-only")


class SummaryTest(unittest.TestCase):
    may_week = {"name": "Trip", "start": "2026-05-04", "end": "2026-05-08", "portion": "full"}

    def test_mandatory_days_count_on_working_days_only(self):
        s = year_summary([], settings(allowance=30), 2026, d("2026-06-01"))
        by_date = {m["date"]: m["counts"] for m in s["mandatory"]}
        # 1 Jan (Thu) and 25 Dec (Fri) count; 26 Dec is a Saturday.
        self.assertEqual(by_date, {"2026-01-01": True, "2026-12-25": True, "2026-12-26": False})
        self.assertEqual((s["taken"], s["booked"], s["remaining"]), (1, 1, 28))

    def test_week_including_bank_holiday(self):
        s = year_summary([self.may_week], settings(allowance=30, mandatory_days=[]), 2026, d("2026-01-01"))
        self.assertEqual(s["booked"], 5)
        status = {b["date"]: b["status"] for b in s["bank_holidays"]}
        self.assertEqual(status["2026-05-04"], "booked")
        self.assertEqual(status["2026-05-25"], "available")

    def test_bank_holidays_off_are_not_deducted(self):
        s = year_summary([self.may_week], settings(bank_holidays_off=True, mandatory_days=[]),
                         2026, d("2026-01-01"))
        self.assertEqual(s["booked"], 4)
        self.assertTrue(all(b["status"] == "off" for b in s["bank_holidays"]))

    def test_taken_versus_booked_split_on_today(self):
        s = year_summary([self.may_week], settings(mandatory_days=[]), 2026, d("2026-05-06"))
        self.assertEqual((s["taken"], s["booked"]), (3, 2))

    def test_half_day_and_custom_work_week(self):
        half = {"name": "Dentist", "start": "2026-03-05", "end": "2026-03-05", "portion": "pm"}
        s = year_summary([half], settings(mandatory_days=[]), 2026, d("2026-01-01"))
        self.assertEqual(s["booked"], 0.5)
        # Someone working Wed-Sat only uses 3 days (Wed, Thu, Fri) of a Mon-Fri week off.
        s = year_summary([self.may_week], settings(work_days=[2, 3, 4, 5], mandatory_days=[]),
                         2026, d("2026-01-01"))
        self.assertEqual(s["booked"], 3)

    def test_mandatory_not_counted_twice_or_when_disabled(self):
        xmas = {"name": "Xmas", "start": "2026-12-21", "end": "2026-12-31", "portion": "full"}
        s = year_summary([xmas], settings(), 2026, d("2026-01-01"))
        self.assertEqual(s["booked"], 1 + 8)  # 1 Jan + 8 weekdays 21-31 Dec
        s = year_summary([], settings(mandatory_counts=False), 2026, d("2026-01-01"))
        self.assertEqual(s["booked"] + s["taken"], 0)

    def test_holiday_across_new_year_is_split(self):
        h = {"name": "NY", "start": "2026-12-28", "end": "2027-01-05", "portion": "full"}
        cal = dates.WorkCalendar(settings())
        self.assertEqual(cal.holiday_days(h, 2026), 4)
        self.assertEqual(cal.holiday_days(h, 2027), 3)
        self.assertEqual(cal.holiday_days(h), 7)


class SettingsValidationTest(unittest.TestCase):
    def test_valid_update(self):
        s = validate_settings({"allowance": 30, "mandatory_days": ["12-24", "01-01"],
                               "ics_url": "webcal://calendar.google.com/x.ics"}, DEFAULT_SETTINGS)
        self.assertEqual(s["allowance"], 30)
        self.assertEqual(s["mandatory_days"], ["01-01", "12-24"])
        self.assertEqual(s["ics_url"], "https://calendar.google.com/x.ics")

    def test_rejects_bad_values(self):
        for bad in ({"allowance": -1}, {"allowance": 10.3}, {"allowance": "lots"},
                    {"work_days": [7]}, {"mandatory_days": ["13-01"]}, {"mandatory_days": ["Dec 25"]},
                    {"bank_region": "mars"}, {"ics_url": "http://insecure.example"}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_settings(bad, DEFAULT_SETTINGS)


if __name__ == "__main__":
    unittest.main()
