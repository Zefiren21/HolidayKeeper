import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DEFAULT_SETTINGS, WorkCalendar } from "../js/core.js";
import { cleanTitle, parseCalendar } from "../js/importers.js";

const FIXTURE = readFileSync(new URL("../../tests/fixtures/google_agenda_2026.txt", import.meta.url), "utf8");
const MON_FRI = [0, 1, 2, 3, 4];

const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260810", "DTEND;VALUE=DATE:20260815", "SUMMARY:Alex Example - Summer", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261002T130000Z", "DTEND:20261002T173000Z", "SUMMARY:Alex Ex", " ample appointment", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261102", "DTEND;VALUE=DATE:20261103", "SUMMARY:Sam Other", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261201", "DTEND;VALUE=DATE:20261202", "SUMMARY:Alex Example", "STATUS:CANCELLED", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("agenda text groups days into holidays", () => {
  const items = parseCalendar(FIXTURE, "Alex Example", MON_FRI);
  assert.deepEqual(items.map((i) => [i.start, i.end, i.portion]), [
    ["2026-01-09", "2026-01-12", "full"], ["2026-03-05", "2026-03-05", "pm"], ["2026-03-12", "2026-03-13", "full"],
    ["2026-04-10", "2026-04-10", "full"], ["2026-05-04", "2026-05-08", "full"], ["2026-05-28", "2026-05-29", "full"],
    ["2026-06-18", "2026-06-19", "full"], ["2026-07-30", "2026-07-31", "full"], ["2026-09-21", "2026-09-22", "full"],
  ]);
  assert.equal(items[0].name, "Holiday");
  assert.equal(items[1].name, "Half day");
  assert.ok(items.every((i) => i.status === "booked"));
  const cal = new WorkCalendar(DEFAULT_SETTINGS);
  assert.equal(items.reduce((t, i) => t + cal.holidayDays(i), 0), 18.5);
  assert.deepEqual(parseCalendar(FIXTURE, "Someone Else", MON_FRI), []);
});

test("search results with several events under one date and timed half days", () => {
  const text = "5\nMar 2026, Thu\nAll day\nSam Other\n9:00 – 13:00\nAlex Example dentist\n6\nMar 2026, Fri\nAll day\nAlex Example\n";
  const items = parseCalendar(text, "Alex Example", MON_FRI);
  assert.deepEqual(items.map((i) => [i.name, i.start, i.portion]), [["dentist", "2026-03-05", "am"], ["Holiday", "2026-03-06", "full"]]);
});

test("ics parsing and filtering", () => {
  const items = parseCalendar(ICS, "alex example", MON_FRI);
  assert.deepEqual(items.map((i) => [i.name, i.start, i.end, i.portion]), [
    ["Summer", "2026-08-10", "2026-08-14", "full"],
    ["appointment", "2026-10-02", "2026-10-02", "pm"],
  ]);
  assert.equal(parseCalendar(ICS, "", MON_FRI).length, 3);
});

test("clean title", () => {
  assert.deepEqual(cleanTitle("Alex Example (Day 2/5)", "Alex Example"), ["Holiday", null]);
  assert.deepEqual(cleanTitle("Alex Example - half day AM", "Alex Example"), ["Half day", "am"]);
  assert.deepEqual(cleanTitle("Alex Example: Paris", "Alex Example"), ["Paris", null]);
});
