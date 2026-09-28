// Dates, UK bank holidays, working days and allowance maths. Pure functions, no DOM,
// so the same code runs in the browser and in `node --test`.

export const REGIONS = {
  "england-and-wales": "England & Wales",
  "scotland": "Scotland",
  "northern-ireland": "Northern Ireland",
};

export const DEFAULT_SETTINGS = {
  allowance: 25,
  work_days: [0, 1, 2, 3, 4], // Monday=0 ... Sunday=6
  mandatory_days: ["01-01", "12-25", "12-26"],
  mandatory_counts: true, // mandatory days come out of the allowance
  bank_region: "england-and-wales",
  bank_holidays_off: false, // the job gives bank holidays off on top of the allowance
  calendar_name: "",
  carry_over: {}, // { "2026": 0.765 } days brought forward into that year (negative = borrowed)
};

/** Round away floating-point noise (0.1 + 0.2) while keeping up to 3 decimals, e.g. 0.765. */
export const round3 = (n) => Math.round(n * 1000) / 1000;
export const carryOver = (settings, year) => Number(settings.carry_over?.[String(year)] || 0);

export const MANDATORY_NAMES = { "01-01": "New Year's Day", "12-25": "Christmas Day", "12-26": "Boxing Day" };

// ---- ISO date helpers (all in UTC so daylight saving never shifts a day) ----

const DAY_MS = 86400000;

export const pad = (n) => String(n).padStart(2, "0");
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export function toDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const toISO = (date) => date.toISOString().slice(0, 10);
export const addDays = (iso, n) => toISO(new Date(toDate(iso).getTime() + n * DAY_MS));
export const weekday = (iso) => (toDate(iso).getUTCDay() + 6) % 7; // Monday=0
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY_MS);
export const yearOf = (iso) => Number(iso.slice(0, 4));
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const isValidISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(toDate(s)) === s;
export const localToday = () => { const n = new Date(); return ymd(n.getFullYear(), n.getMonth() + 1, n.getDate()); };

export function* dateRange(start, end) {
  for (let d = start; d <= end; d = addDays(d, 1)) yield d;
}

// ---- bank holidays -----------------------------------------------------------

export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return ymd(year, Math.floor(n / 31), (n % 31) + 1);
}

export function firstMonday(year, month) {
  const d = ymd(year, month, 1);
  return addDays(d, (7 - weekday(d)) % 7);
}

export function lastMonday(year, month) {
  const d = ymd(year, month, daysInMonth(year, month));
  return addDays(d, -weekday(d));
}

// One-off changes announced by the UK government (apply to all regions).
const ADJUSTMENTS = {
  2020: { move: { "2020-05-04": "2020-05-08" }, add: [] },
  2022: {
    move: { "2022-05-30": "2022-06-02" },
    add: [["2022-06-03", "Platinum Jubilee bank holiday"], ["2022-09-19", "State Funeral of Queen Elizabeth II"]],
  },
  2023: { move: {}, add: [["2023-05-08", "Coronation of King Charles III"]] },
};

/** Move fixed-date holidays that fall on a weekend to the next free weekday. */
function withSubstitutes(fixed, reserved) {
  const taken = new Set([...reserved, ...fixed.filter(([d]) => weekday(d) < 5).map(([d]) => d)]);
  return fixed.map(([d, name]) => {
    if (weekday(d) < 5) return [d, name];
    let s = d;
    while (weekday(s) >= 5 || taken.has(s)) s = addDays(s, 1);
    taken.add(s);
    return [s, `${name} (substitute day)`];
  });
}

/** UK bank holidays for a year as [{date, name}], sorted by date. */
export function bankHolidays(year, region = "england-and-wales") {
  if (!(region in REGIONS)) throw new Error("unknown region");
  const scotland = region === "scotland", ni = region === "northern-ireland";
  const easter = easterSunday(year);

  const moveable = [[addDays(easter, -2), "Good Friday"]];
  if (!scotland) moveable.push([addDays(easter, 1), "Easter Monday"]);
  moveable.push([firstMonday(year, 5), "Early May bank holiday"]);
  moveable.push([lastMonday(year, 5), "Spring bank holiday"]);
  moveable.push(scotland ? [firstMonday(year, 8), "Summer bank holiday"] : [lastMonday(year, 8), "Summer bank holiday"]);

  const fixed = [[ymd(year, 1, 1), "New Year's Day"]];
  if (scotland) fixed.push([ymd(year, 1, 2), "2nd January"]);
  if (ni) {
    fixed.push([ymd(year, 3, 17), "St Patrick's Day"]);
    fixed.push([ymd(year, 7, 12), "Battle of the Boyne (Orangemen's Day)"]);
  }
  if (scotland) fixed.push([ymd(year, 11, 30), "St Andrew's Day"]);
  fixed.push([ymd(year, 12, 25), "Christmas Day"], [ymd(year, 12, 26), "Boxing Day"]);

  let days = [...moveable, ...withSubstitutes(fixed, moveable.map(([d]) => d))];
  const adj = ADJUSTMENTS[year];
  if (adj) days = [...days.map(([d, n]) => [adj.move[d] || d, n]), ...adj.add];
  days.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return days.map(([date, name]) => ({ date, name }));
}

// ---- working days & allowance -------------------------------------------------

export const portionWeight = (p) => (p === "am" || p === "pm" ? 0.5 : 1);
export const isPencilled = (h) => h.status === "pencilled";

export function parseMMDD(value, year) {
  const m = /^(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const iso = ymd(year, Number(m[1]), Number(m[2]));
  return isValidISO(iso) ? iso : null;
}

/** Knows which days are working days for one person's settings. */
export class WorkCalendar {
  constructor(settings) {
    this.settings = settings;
    this.workDays = new Set(settings.work_days);
    this._bank = new Map();
  }

  bank(year) {
    if (!this._bank.has(year)) this._bank.set(year, bankHolidays(year, this.settings.bank_region));
    return this._bank.get(year);
  }

  bankOn(iso) {
    return this.bank(yearOf(iso)).find((b) => b.date === iso) || null;
  }

  isWorking(iso) {
    if (!this.workDays.has(weekday(iso))) return false;
    return !(this.settings.bank_holidays_off && this.bankOn(iso));
  }

  /** Allowance days a holiday uses (optionally only the part inside `year`). */
  holidayDays(h, year = null) {
    let start = h.start, end = h.end;
    if (year !== null) {
      start = start > `${year}-01-01` ? start : `${year}-01-01`;
      end = end < `${year}-12-31` ? end : `${year}-12-31`;
    }
    const w = portionWeight(h.portion);
    let total = 0;
    for (const d of dateRange(start, end)) if (this.isWorking(d)) total += w;
    return total;
  }

  mandatory(year) {
    return this.settings.mandatory_days
      .map((mmdd) => ({ date: parseMMDD(mmdd, year), name: MANDATORY_NAMES[mmdd] || "Mandatory day off" }))
      .filter((m) => m.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
}

const clampToYear = (h, year) => [
  h.start > `${year}-01-01` ? h.start : `${year}-01-01`,
  h.end < `${year}-12-31` ? h.end : `${year}-12-31`,
];

/**
 * Allowance for a year. Pencilled-in holidays are counted separately so you can see
 * what would be left if you took them, without them eating into the real numbers.
 */
export function yearSummary(holidays, settings, year, today) {
  const cal = new WorkCalendar(settings);
  const booked = new Map(), pencil = new Map();
  const coveredBooked = new Set(), coveredPencil = new Set();

  for (const h of holidays) {
    const [start, end] = clampToYear(h, year);
    const w = portionWeight(h.portion);
    const weights = isPencilled(h) ? pencil : booked;
    const covered = isPencilled(h) ? coveredPencil : coveredBooked;
    for (const d of dateRange(start, end)) {
      covered.add(d);
      if (cal.isWorking(d)) weights.set(d, Math.max(weights.get(d) || 0, w));
    }
  }

  const mandatory = cal.mandatory(year).map((m) => {
    const counts = Boolean(settings.mandatory_counts) && cal.isWorking(m.date);
    if (counts) booked.set(m.date, 1);
    return { ...m, counts };
  });
  const mandatoryDates = new Set(mandatory.map((m) => m.date));

  const bank = cal.bank(year).map((b) => {
    let status = "available";
    if (settings.bank_holidays_off) status = "off";
    else if (mandatoryDates.has(b.date)) status = "mandatory";
    else if (coveredBooked.has(b.date)) status = "booked";
    else if (coveredPencil.has(b.date)) status = "pencilled";
    return { ...b, status };
  });

  let taken = 0, bookedAhead = 0, pencilled = 0;
  for (const [d, w] of booked) d <= today ? (taken += w) : (bookedAhead += w);
  for (const [d, w] of pencil) pencilled += Math.max(0, w - (booked.get(d) || 0));

  const baseAllowance = Number(settings.allowance);
  const carried = carryOver(settings, year);
  const allowance = round3(baseAllowance + carried);
  const remaining = round3(allowance - taken - bookedAhead);
  return {
    year, allowance, baseAllowance, carryOver: carried, taken, booked: bookedAhead, pencilled, remaining,
    remainingIfPencilled: round3(remaining - pencilled),
    mandatory, bankHolidays: bank, bankRegion: REGIONS[settings.bank_region],
  };
}

/**
 * What each day of a year looks like on a calendar: iso -> info.
 * kind is the colour it gets: taken | booked | pencilled | mandatory | bank | off | work.
 */
export function dayMap(holidays, settings, year, today) {
  const cal = new WorkCalendar(settings);
  const map = new Map();
  for (const d of dateRange(`${year}-01-01`, `${year}-12-31`)) {
    map.set(d, { date: d, holidays: [], bank: cal.bankOn(d), mandatory: null, working: cal.isWorking(d) });
  }
  for (const m of cal.mandatory(year)) {
    map.get(m.date).mandatory = { ...m, counts: Boolean(settings.mandatory_counts) && cal.isWorking(m.date) };
  }
  for (const h of holidays) {
    const [start, end] = clampToYear(h, year);
    for (const d of dateRange(start, end)) map.get(d).holidays.push(h);
  }
  for (const info of map.values()) {
    const booked = info.holidays.filter((h) => !isPencilled(h));
    const pencilled = info.holidays.filter(isPencilled);
    const main = booked[0] || pencilled[0];
    info.half = Boolean(main && main.portion !== "full" && info.holidays.every((h) => h.portion !== "full"));
    if (booked.length) info.kind = info.date < today ? "taken" : "booked";
    else if (pencilled.length) info.kind = "pencilled";
    else if (info.mandatory) info.kind = "mandatory";
    else if (info.bank) info.kind = "bank";
    else info.kind = info.working ? "work" : "off";
    info.today = info.date === today;
    info.todayIso = today;
  }
  return map;
}

// ---- validation -----------------------------------------------------------------

export const PORTIONS = ["full", "am", "pm"];
export const STATUSES = ["booked", "pencilled"];

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 12);

/** Clean one holiday from user input; throws Error with a friendly message when invalid. */
export function validateHoliday(data) {
  if (!data || typeof data !== "object") throw new Error("invalid holiday");
  const name = String(data.name ?? "").trim().slice(0, 100);
  const note = String(data.note ?? "").trim().slice(0, 500);
  const portion = data.portion || "full";
  const status = data.status || "booked";
  const start = String(data.start ?? "").trim();
  let end = String(data.end ?? "").trim() || start;
  if (!isValidISO(start) || !isValidISO(end)) throw new Error("dates must be YYYY-MM-DD");
  if (!name) throw new Error("name is required");
  if (!PORTIONS.includes(portion)) throw new Error("portion must be full, am or pm");
  if (!STATUSES.includes(status)) throw new Error("status must be booked or pencilled");
  if (portion !== "full") end = start;
  if (end < start) throw new Error("end date is before start date");
  if (daysBetween(start, end) > 366) throw new Error("a holiday can be at most a year long");
  return { id: data.id || newId(), name, start, end, portion, status, note };
}

/** Merge user-supplied settings over `current`; throws Error on bad input. */
export function validateSettings(data, current) {
  const s = { ...current };
  if ("allowance" in data) {
    const a = Number(data.allowance);
    if (data.allowance === "" || !Number.isFinite(a)) throw new Error("allowance must be a number");
    if (a < 0 || a > 366 || a * 2 !== Math.floor(a * 2)) throw new Error("allowance must be between 0 and 366, in half days");
    s.allowance = a;
  }
  if ("work_days" in data) {
    const wd = data.work_days;
    if (!Array.isArray(wd) || !wd.every((x) => Number.isInteger(x) && x >= 0 && x <= 6)) throw new Error("work days must be 0-6");
    s.work_days = [...new Set(wd)].sort();
  }
  if ("mandatory_days" in data) {
    const md = data.mandatory_days;
    if (!Array.isArray(md) || md.length > 50) throw new Error("mandatory days must be a list");
    const clean = md.map((v) => String(v).trim());
    for (const v of clean) if (!parseMMDD(v, 2000)) throw new Error(`invalid mandatory day "${v}"; use MM-DD`);
    s.mandatory_days = [...new Set(clean)].sort();
  }
  for (const key of ["mandatory_counts", "bank_holidays_off"]) if (key in data) s[key] = Boolean(data[key]);
  if ("bank_region" in data) {
    if (!(data.bank_region in REGIONS)) throw new Error("unknown bank holiday region");
    s.bank_region = data.bank_region;
  }
  if ("carry_over" in data) {
    const co = data.carry_over;
    if (!co || typeof co !== "object" || Array.isArray(co)) throw new Error("carry-over must be a list of years");
    const clean = {};
    for (const [year, value] of Object.entries(co)) {
      if (!/^\d{4}$/.test(year)) throw new Error(`invalid carry-over year "${year}"`);
      if (value === "" || value === null) continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < -366 || n > 366) throw new Error("carry-over must be a number of days between -366 and 366");
      if (round3(n) !== 0) clean[year] = round3(n);
    }
    s.carry_over = clean;
  }
  if ("calendar_name" in data) s.calendar_name = String(data.calendar_name).trim().slice(0, 100);
  return s;
}

export const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;
