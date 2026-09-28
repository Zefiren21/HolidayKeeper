// Turn Google Calendar exports (agenda/search text or .ics) into holiday ranges.

import { addDays, daysBetween, isValidISO, weekday, ymd } from "./core.js";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const DAY_LINE = /^\d{1,2}$/;
const MONTH_LINE = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})(?:,\s*[A-Za-z]+)?$/;
const TIME_LINE = /^(all day|\d{1,2}(:\d{2})?\s*(am|pm)?\s*[–-]\s*\d{1,2}(:\d{2})?\s*(am|pm)?)$/i;
const TIME = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
const HALF = /(1\/2|½|half)[\s-]*day/i;
const DAY_N_OF_M = /\(\s*day\s*\d+\s*\/\s*\d+\s*\)/gi;
const MAX_MERGE_GAP = 4; // days; lets a Fri + Mon pair join across a weekend

function hour(match) {
  let h = Number(match[1]) % 24;
  const ampm = (match[3] || "").toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return h + Number(match[2] || 0) / 60;
}

/** A short timed event counts as a half day: morning or afternoon. */
const portionFromHours = (start, end) => (end - start > 5 ? null : start < 12 ? "am" : "pm");

/**
 * Google Calendar's agenda or search results copied as text. Each event looks like:
 *   9 / Jan 2026, Fri / All day / Title
 */
export function parseAgendaText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const events = [];
  let current = null, portion = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = i + 1 < lines.length ? MONTH_LINE.exec(lines[i + 1]) : null;
    if (DAY_LINE.test(line) && m) {
      const month = MONTHS[m[1].toLowerCase()];
      const iso = month ? ymd(Number(m[2]), month, Number(line)) : null;
      current = iso && isValidISO(iso) ? iso : null;
      portion = null;
      i++;
      continue;
    }
    if (current === null) continue;
    if (TIME_LINE.test(line)) {
      const ms = [...line.matchAll(TIME)];
      portion = ms.length >= 2 ? portionFromHours(hour(ms[0]), hour(ms[1])) : null;
    } else {
      events.push({ date: current, title: line, portion });
      portion = null;
    }
  }
  return events;
}

const icsUnescape = (v) =>
  v.replace(/\\[nN]/g, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

/** Returns {date, hours} where hours is null for all-day values. */
function icsValue(v) {
  v = v.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, hours: null };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z?$/.exec(v);
  if (!m) throw new Error(v);
  return { date: `${m[1]}-${m[2]}-${m[3]}`, hours: Number(m[4]) + Number(m[5]) / 60 };
}

/** Parse the VEVENTs of an iCalendar file into single-day events. */
export function parseIcs(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const events = [];
  let ev = null;
  for (const line of unfolded.split(/\r?\n/)) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT") {
      if (ev) events.push(...expandIcsEvent(ev));
      ev = null;
    } else if (ev && line.includes(":")) {
      const idx = line.indexOf(":");
      ev[line.slice(0, idx).split(";")[0].toUpperCase()] = line.slice(idx + 1);
    }
  }
  return events;
}

function expandIcsEvent(ev) {
  if ((ev.STATUS || "").toUpperCase() === "CANCELLED" || !ev.DTSTART) return [];
  const title = icsUnescape(ev.SUMMARY || "").trim();
  let start, end;
  try {
    start = icsValue(ev.DTSTART);
    end = ev.DTEND ? icsValue(ev.DTEND)
      : { date: start.hours === null ? addDays(start.date, 1) : start.date, hours: start.hours };
  } catch {
    return [];
  }
  let portion = null, first = start.date, last = end.date;
  if (start.hours === null) last = addDays(last, -1); // all-day DTEND is exclusive
  else {
    if (end.hours === 0 && last > first) last = addDays(last, -1);
    if (end.hours !== null && first === end.date) portion = portionFromHours(start.hours, end.hours);
  }
  if (last < first) last = first;
  if (daysBetween(first, last) > 366) return [];
  const out = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push({ date: d, title, portion });
  return out;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const trimChars = (s, chars) => {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
};

/** 'Alex Example - 1/2 day hol PM' -> ['Half day', 'pm']; '(Day 1/4)' markers are dropped. */
export function cleanTitle(title, person) {
  if (HALF.test(title)) return ["Half day", /\bpm\b|afternoon/i.test(title) ? "pm" : "am"];
  let t = person ? title.replace(new RegExp(escapeRegExp(person), "gi"), "") : title;
  t = t.replace(DAY_N_OF_M, "");
  t = trimChars(t.replace(/\s+/g, " "), " -–:,|");
  return [t || "Holiday", null];
}

/** Filter events by person name and merge consecutive days into holiday ranges. */
export function toHolidays(events, person, workDays) {
  const needle = (person || "").trim().toLowerCase();
  const work = new Set(workDays);
  const days = new Map();
  for (const e of events) {
    if (needle && !e.title.toLowerCase().includes(needle)) continue;
    const [label, p] = cleanTitle(e.title, person);
    const portion = p || e.portion || "full";
    const prev = days.get(e.date);
    if (!prev || (prev.portion !== "full" && portion === "full")) days.set(e.date, { label, portion });
  }
  const items = [];
  for (const d of [...days.keys()].sort()) {
    const { label, portion } = days.get(d);
    const last = items[items.length - 1];
    const gap = last ? daysBetween(last.end, d) : 0;
    let gapIsNonWorking = true;
    for (let k = 1; k < gap; k++) if (work.has(weekday(addDays(last.end, k)))) gapIsNonWorking = false;
    if (last && portion === "full" && last.portion === "full" && last.name === label
        && gap > 0 && gap <= MAX_MERGE_GAP && gapIsNonWorking) {
      last.end = d;
    } else {
      items.push({ name: label, start: d, end: d, portion, status: "booked", note: "Imported" });
    }
  }
  return items;
}

export function parseCalendar(text, person, workDays) {
  const events = text.includes("BEGIN:VCALENDAR") ? parseIcs(text) : parseAgendaText(text);
  return toHolidays(events, person, workDays);
}
