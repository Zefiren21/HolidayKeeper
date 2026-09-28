// Calendar views: a year of mini-months, a zoomed-in month, and the text for one day.

import { daysInMonth, isPencilled, weekday, ymd } from "./core.js";
import { el, fmtRange } from "./ui.js";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export const KIND_LABELS = {
  taken: "Taken", booked: "Booked", pencilled: "Pencilled in", mandatory: "Mandatory day off", bank: "Bank holiday",
};

export function legend(kinds = ["taken", "booked", "pencilled", "mandatory", "bank"]) {
  return el("div", { className: "legend" },
    ...kinds.map((k) => el("span", {}, el("i", { className: `dot k-${k}` }), KIND_LABELS[k])),
    el("span", {}, el("i", { className: "dot", style: "box-shadow: 0 0 0 2px var(--text)" }), "Today"));
}

/** Lines describing one day: [{kind, text}] */
export function describeDay(info, cal) {
  const lines = [];
  for (const h of info.holidays) {
    const status = isPencilled(h) ? "pencilled" : info.date < info.todayIso ? "taken" : "booked";
    const half = h.portion !== "full" ? ` · half day (${h.portion.toUpperCase()})` : "";
    const days = cal ? ` · uses ${cal.holidayDays(h)} day${cal.holidayDays(h) === 1 ? "" : "s"}` : "";
    lines.push({ kind: status, text: `${h.name} — ${KIND_LABELS[status].toLowerCase()} (${fmtRange(h.start, h.end)}${half}${days})` });
  }
  if (info.mandatory) {
    lines.push({ kind: "mandatory",
      text: `${info.mandatory.name} — mandatory day off${info.mandatory.counts ? ", uses 1 day" : ", not counted"}` });
  }
  if (info.bank) lines.push({ kind: "bank", text: `${info.bank.name}${info.working ? " — you work bank holidays unless you book it" : " — day off"}` });
  if (!lines.length) lines.push({ kind: info.working ? "work" : "off", text: info.working ? "Working day" : "Not a working day" });
  return lines;
}

function dayButton(y, m, d, map, onDay) {
  const iso = ymd(y, m, d);
  const info = map.get(iso);
  const cls = ["cal-day", `k-${info.kind}`];
  if (info.half) cls.push("half");
  if (info.today) cls.push("today");
  const label = info.holidays.map((h) => h.name).concat(info.bank ? [info.bank.name] : [], info.mandatory ? [info.mandatory.name] : []);
  return el("button", {
    type: "button", className: cls.join(" "), textContent: d, dataset: { date: iso },
    ariaLabel: `${d} ${MONTHS[m - 1]}${label.length ? ": " + label.join(", ") : ""}`,
    onclick: (e) => { e.stopPropagation(); onDay(iso); },
  });
}

function monthGrid(y, m, map, onDay, big = false) {
  const grid = el("div", { className: "cal-grid" + (big ? " cal-big" : "") },
    ...WEEKDAYS.map((w) => el("div", { className: "cal-wd", textContent: w, ariaHidden: "true" })));
  for (let i = 0; i < weekday(ymd(y, m, 1)); i++) grid.append(el("div"));
  for (let d = 1; d <= daysInMonth(y, m); d++) grid.append(dayButton(y, m, d, map, onDay));
  return grid;
}

export function renderYear(container, { year, map, onMonth, onDay }) {
  container.replaceChildren(el("div", { className: "cal-year" }, ...MONTHS.map((name, i) =>
    el("section", { className: "cal-month", onclick: () => onMonth(i + 1) },
      el("button", { type: "button", className: "cal-title", textContent: name,
        onclick: (e) => { e.stopPropagation(); onMonth(i + 1); } }),
      monthGrid(year, i + 1, map, onDay)))));
}

export function renderMonth(container, { year, month, map, onDay, onBack, onPrev, onNext }) {
  const first = ymd(year, month, 1), last = ymd(year, month, daysInMonth(year, month));
  const events = [];
  const seen = new Set();
  for (const info of map.values()) {
    if (info.date < first || info.date > last) continue;
    for (const h of info.holidays) {
      if (seen.has(h)) continue;
      seen.add(h);
      const kind = isPencilled(h) ? "pencilled" : h.end < info.todayIso ? "taken" : "booked";
      events.push({ date: h.start < first ? first : h.start, kind, text: `${h.name} · ${fmtRange(h.start, h.end)}` });
    }
    if (info.mandatory) events.push({ date: info.date, kind: "mandatory", text: `${info.mandatory.name} · ${fmtRange(info.date, info.date)}` });
    else if (info.bank) events.push({ date: info.date, kind: "bank", text: `${info.bank.name} · ${fmtRange(info.date, info.date)}` });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : 1));

  container.replaceChildren(
    el("div", { className: "cal-nav" },
      el("button", { type: "button", className: "ghost small", textContent: "‹ Year", onclick: onBack }),
      el("b", { textContent: `${MONTHS[month - 1]} ${year}` }),
      el("button", { type: "button", className: "ghost", textContent: "‹", ariaLabel: "Previous month", onclick: onPrev }),
      el("button", { type: "button", className: "ghost", textContent: "›", ariaLabel: "Next month", onclick: onNext })),
    el("div", { className: "card" }, monthGrid(year, month, map, onDay, true)),
    events.length
      ? el("ul", { className: "cal-events" }, ...events.map((e) => el("li", {},
          el("button", { type: "button", onclick: () => onDay(e.date) }, el("i", { className: `dot k-${e.kind}` }), e.text))))
      : el("p", { className: "muted", textContent: "Nothing booked this month." }));
}
