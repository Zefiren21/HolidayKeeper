import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_SETTINGS, WorkCalendar, bankHolidays, dayMap, easterSunday, validateHoliday, validateSettings, yearSummary,
} from "../js/core.js";

const settings = (o = {}) => ({ ...DEFAULT_SETTINGS, ...o });
const bh = (year, region) => bankHolidays(year, region).map((b) => b.date);
const mayWeek = { name: "Trip", start: "2026-05-04", end: "2026-05-08", portion: "full", status: "booked" };

test("easter dates", () => {
  for (const [y, d] of [[2024, "2024-03-31"], [2025, "2025-04-20"], [2026, "2026-04-05"], [2027, "2027-03-28"], [2038, "2038-04-25"]]) {
    assert.equal(easterSunday(y), d);
  }
});

test("England & Wales 2026", () => {
  assert.deepEqual(bh(2026), ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25",
    "2026-08-31", "2026-12-25", "2026-12-28"]);
});

test("Christmas weekend substitutes 2027", () => {
  assert.deepEqual(bh(2027).slice(-2), ["2027-12-27", "2027-12-28"]);
});

test("one-off changes 2022", () => {
  const days = bh(2022);
  for (const d of ["2022-01-03", "2022-06-02", "2022-06-03", "2022-09-19"]) assert.ok(days.includes(d), d);
  assert.ok(!days.includes("2022-05-30"));
  const names = Object.fromEntries(bankHolidays(2022).map((b) => [b.date, b.name]));
  assert.equal(names["2022-12-26"], "Boxing Day");
  assert.equal(names["2022-12-27"], "Christmas Day (substitute day)");
});

test("Scotland and Northern Ireland 2026", () => {
  const sc = bh(2026, "scotland");
  for (const d of ["2026-01-02", "2026-08-03", "2026-11-30"]) assert.ok(sc.includes(d), d);
  assert.ok(!sc.includes("2026-04-06"));
  const ni = bh(2026, "northern-ireland");
  assert.ok(ni.includes("2026-03-17") && ni.includes("2026-07-13"));
  assert.throws(() => bankHolidays(2026, "wales-only"));
});

test("mandatory days count on working days only", () => {
  const s = yearSummary([], settings({ allowance: 30 }), 2026, "2026-06-01");
  assert.deepEqual(Object.fromEntries(s.mandatory.map((m) => [m.date, m.counts])),
    { "2026-01-01": true, "2026-12-25": true, "2026-12-26": false });
  assert.deepEqual([s.taken, s.booked, s.remaining], [1, 1, 28]);
});

test("week including a bank holiday, and bank holidays off", () => {
  let s = yearSummary([mayWeek], settings({ allowance: 30, mandatory_days: [] }), 2026, "2026-01-01");
  assert.equal(s.booked, 5);
  const status = Object.fromEntries(s.bankHolidays.map((b) => [b.date, b.status]));
  assert.equal(status["2026-05-04"], "booked");
  assert.equal(status["2026-05-25"], "available");
  s = yearSummary([mayWeek], settings({ bank_holidays_off: true, mandatory_days: [] }), 2026, "2026-01-01");
  assert.equal(s.booked, 4);
  assert.ok(s.bankHolidays.every((b) => b.status === "off"));
});

test("taken vs booked split, half days, custom work week", () => {
  let s = yearSummary([mayWeek], settings({ mandatory_days: [] }), 2026, "2026-05-06");
  assert.deepEqual([s.taken, s.booked], [3, 2]);
  const half = { name: "Dentist", start: "2026-03-05", end: "2026-03-05", portion: "pm", status: "booked" };
  assert.equal(yearSummary([half], settings({ mandatory_days: [] }), 2026, "2026-01-01").booked, 0.5);
  s = yearSummary([mayWeek], settings({ work_days: [2, 3, 4, 5], mandatory_days: [] }), 2026, "2026-01-01");
  assert.equal(s.booked, 3);
});

test("mandatory not counted twice, or at all when disabled", () => {
  const xmas = { name: "Xmas", start: "2026-12-21", end: "2026-12-31", portion: "full", status: "booked" };
  assert.equal(yearSummary([xmas], settings(), 2026, "2026-01-01").booked, 1 + 8);
  const s = yearSummary([], settings({ mandatory_counts: false }), 2026, "2026-01-01");
  assert.equal(s.booked + s.taken, 0);
});

test("holiday across new year is split", () => {
  const h = { name: "NY", start: "2026-12-28", end: "2027-01-05", portion: "full" };
  const cal = new WorkCalendar(settings());
  assert.equal(cal.holidayDays(h, 2026), 4);
  assert.equal(cal.holidayDays(h, 2027), 3);
  assert.equal(cal.holidayDays(h), 7);
});

test("pencilled holidays are counted separately", () => {
  const pencil = { name: "Maybe Rome", start: "2026-07-06", end: "2026-07-10", portion: "full", status: "pencilled" };
  const s = yearSummary([mayWeek, pencil], settings({ allowance: 30, mandatory_days: [] }), 2026, "2026-01-01");
  assert.deepEqual([s.booked, s.pencilled, s.remaining, s.remainingIfPencilled], [5, 5, 25, 20]);

  // Overlapping a booked day or a counted mandatory day doesn't count twice.
  const overlap = { name: "Extend", start: "2026-05-08", end: "2026-05-11", portion: "full", status: "pencilled" };
  const xmas = { name: "Xmas?", start: "2026-12-24", end: "2026-12-25", portion: "full", status: "pencilled" };
  const s2 = yearSummary([mayWeek, overlap, xmas], settings({ allowance: 30 }), 2026, "2026-01-01");
  assert.equal(s2.pencilled, 1 + 1); // 11 May, 24 Dec
  const status = Object.fromEntries(s2.bankHolidays.map((b) => [b.date, b.status]));
  assert.equal(status["2026-12-25"], "mandatory");
});

test("carry-over adds decimal days to that year only", () => {
  const s = settings({ allowance: 30, mandatory_days: [], carry_over: { 2026: 0.765 } });
  const y26 = yearSummary([mayWeek], s, 2026, "2026-01-01");
  assert.deepEqual([y26.baseAllowance, y26.carryOver, y26.allowance, y26.remaining], [30, 0.765, 30.765, 25.765]);
  const half = { name: "Half", start: "2026-06-01", end: "2026-06-01", portion: "am", status: "pencilled" };
  assert.equal(yearSummary([mayWeek, half], s, 2026, "2026-01-01").remainingIfPencilled, 25.265);
  const y27 = yearSummary([], s, 2027, "2026-01-01");
  assert.deepEqual([y27.carryOver, y27.allowance], [0, 30]);
  // Floating-point noise is rounded away: 0.1 + 0.2 style sums stay tidy.
  const noisy = yearSummary([], settings({ allowance: 30, mandatory_days: [], carry_over: { 2026: 0.1 + 0.2 } }), 2026, "2026-01-01");
  assert.equal(noisy.remaining, 30.3);
  // Borrowed days reduce the allowance.
  assert.equal(yearSummary([], settings({ mandatory_days: [], carry_over: { 2026: -1.25 } }), 2026, "2026-01-01").allowance, 23.75);
});

test("carry-over validation", () => {
  const s = validateSettings({ carry_over: { 2026: "0.765", 2025: "", 2024: 0, 2023: 1.23456 } }, DEFAULT_SETTINGS);
  assert.deepEqual(s.carry_over, { 2026: 0.765, 2023: 1.235 });
  for (const bad of [{ carry_over: { 26: 1 } }, { carry_over: { 2026: "lots" } }, { carry_over: { 2026: 400 } }, { carry_over: [1] }]) {
    assert.throws(() => validateSettings(bad, DEFAULT_SETTINGS), undefined, JSON.stringify(bad));
  }
});

test("day map colours", () => {
  const pencil = { name: "Maybe", start: "2026-07-06", end: "2026-07-06", portion: "am", status: "pencilled" };
  const m = dayMap([mayWeek, pencil], settings(), 2026, "2026-05-06");
  assert.equal(m.size, 365);
  assert.equal(m.get("2026-05-05").kind, "taken");
  assert.equal(m.get("2026-05-06").kind, "booked");
  assert.ok(m.get("2026-05-06").today);
  assert.equal(m.get("2026-07-06").kind, "pencilled");
  assert.ok(m.get("2026-07-06").half);
  assert.equal(m.get("2026-01-01").kind, "mandatory");
  assert.equal(m.get("2026-05-25").kind, "bank");
  assert.equal(m.get("2026-05-09").kind, "off"); // Saturday
  assert.equal(m.get("2026-05-11").kind, "work");
  assert.equal(m.get("2026-05-04").bank.name, "Early May bank holiday");
});

test("holiday validation", () => {
  for (const bad of [{ name: "", start: "2026-01-01" }, { name: "x", start: "01/02/2026" },
    { name: "x", start: "2026-02-30" }, { name: "x", start: "2026-01-05", end: "2026-01-01" },
    { name: "x", start: "2026-01-05", portion: "evening" }, { name: "x", start: "2026-01-05", status: "maybe" }]) {
    assert.throws(() => validateHoliday(bad), undefined, JSON.stringify(bad));
  }
  const h = validateHoliday({ name: " x ", start: "2026-01-05", end: "2026-01-09", portion: "am" });
  assert.deepEqual([h.name, h.end, h.status], ["x", "2026-01-05", "booked"]);
  assert.ok(h.id);
});

test("settings validation", () => {
  const s = validateSettings({ allowance: "30", mandatory_days: ["12-24", "01-01"] }, DEFAULT_SETTINGS);
  assert.equal(s.allowance, 30);
  assert.deepEqual(s.mandatory_days, ["01-01", "12-24"]);
  for (const bad of [{ allowance: -1 }, { allowance: 10.3 }, { allowance: "lots" }, { allowance: "" },
    { work_days: [7] }, { mandatory_days: ["13-01"] }, { mandatory_days: ["Dec 25"] }, { bank_region: "mars" }]) {
    assert.throws(() => validateSettings(bad, DEFAULT_SETTINGS), undefined, JSON.stringify(bad));
  }
});
