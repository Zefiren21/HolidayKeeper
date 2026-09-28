// HolidayKeeper phone app: everything runs and is stored on the device.

import {
  dayMap, isPencilled, localToday, overlaps, REGIONS, validateHoliday, validateSettings, WorkCalendar, yearOf, yearSummary,
} from "./core.js";
import { describeDay, legend, MONTHS, renderMonth, renderYear } from "./calendar-view.js";
import { parseCalendar } from "./importers.js";
import { canvasToFile, drawYearPicture } from "./render-image.js";
import { encodeShare } from "./share.js";
import { active, backupFile, load, newProfile, sanitize, save } from "./store.js";
import { $, el, fmt, fmtLong, fmtRange, num, plural, shareOrDownload } from "./ui.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PREFS = { view: "holidaykeeper:view", installDismissed: "holidaykeeper:install-hint" };

function pref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: not remembered */ }
}

let state = load();
const ui = { year: yearOf(localToday()), view: pref(PREFS.view, "list"), month: null, mandatory: [], carry: {}, importItems: [], picture: null };
const profile = () => active(state);
let warnedStorage = false;

function persist() {
  if (!save(state) && !warnedStorage) {
    warnedStorage = true;
    alert("Couldn't save on this device (private browsing or storage full). Changes will be lost when you close the app.");
  }
}

// ---- rendering ------------------------------------------------------------------

function render() {
  const p = profile(), today = localToday(), y = ui.year;
  const s = yearSummary(p.holidays, p.settings, y, today);
  const map = dayMap(p.holidays, p.settings, y, today);

  $("profile").replaceChildren(...state.profiles.map((x) => el("option", { value: x.id, textContent: x.name })),
    el("option", { value: "__new", textContent: "＋ Add person…" }));
  $("profile").value = state.activeId;
  $("yearLabel").textContent = y;

  $("remaining").textContent = num(s.remaining);
  $("remainingLabel").textContent = `${s.remaining === 1 ? "day" : "days"} left in ${y}`;
  $("summary").classList.toggle("over", s.remaining < 0);
  $("ifPencilled").hidden = !s.pencilled;
  $("ifPencilled").textContent = `✎ ${num(s.remainingIfPencilled)} left if you take your pencilled-in ${plural(s.pencilled, "day")}`;
  $("taken").textContent = num(s.taken);
  $("booked").textContent = num(s.booked);
  $("pencilled").textContent = num(s.pencilled);
  $("allowance").textContent = num(s.allowance);
  $("carryLine").hidden = !s.carryOver;
  $("carryLine").textContent = s.carryOver > 0
    ? `Allowance ${num(s.baseAllowance)} + ${num(s.carryOver)} carried over from ${y - 1}`
    : `Allowance ${num(s.baseAllowance)} − ${num(-s.carryOver)} borrowed`;
  const pct = (n) => (s.allowance ? `${Math.max(0, Math.min(100, (n / s.allowance) * 100))}%` : "0");
  $("barTaken").style.width = pct(s.taken);
  $("barBooked").style.width = pct(s.booked);
  $("barPencilled").style.width = pct(s.pencilled);

  for (const [tab, view] of [["tabList", "list"], ["tabCalendar", "calendar"]]) $(tab).setAttribute("aria-selected", String(ui.view === view));
  $("listView").hidden = ui.view !== "list";
  $("calendarView").hidden = ui.view !== "calendar";
  if (ui.view === "list") renderList(p, s, today);
  else renderCalendar(map);

  $("bankTitle").textContent = `UK bank holidays ${y} · ${s.bankRegion}`;
  $("bank").replaceChildren(...s.bankHolidays.map(bankRow));
}

function badge(h, today) {
  if (today < h.start) {
    const n = Math.round((Date.parse(h.start) - Date.parse(today)) / 86400000);
    return [String(n), n === 1 ? "day to go" : "days to go"];
  }
  if (today <= h.end) return ["🌴", "now!"];
  return ["✓", "done"];
}

function renderList(p, s, today) {
  const y = ui.year, first = `${y}-01-01`, last = `${y}-12-31`;
  const cal = new WorkCalendar(p.settings);
  const items = p.holidays.filter((h) => h.start <= last && h.end >= first);
  for (const m of s.mandatory) {
    items.push({ name: m.name, start: m.date, end: m.date, portion: "full", mandatory: true, counts: m.counts });
  }
  items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const upcoming = items.filter((h) => h.end >= today);
  const past = items.filter((h) => h.end < today).reverse();
  fillList($("upcoming"), upcoming, false, "Nothing planned — add a holiday below.", cal, today);
  fillList($("past"), past, true, null, cal, today);
  $("pastTitle").hidden = !past.length;
}

function fillList(ul, items, isPast, emptyText, cal, today) {
  if (!items.length) {
    ul.replaceChildren(...(emptyText ? [el("li", { className: "empty", textContent: emptyText })] : []));
    return;
  }
  ul.replaceChildren(...items.map((h) => {
    const [big, small] = badge(h, today);
    let uses;
    if (h.mandatory) uses = h.counts ? "uses 1 day" : "not counted";
    else if (h.portion !== "full") uses = `half day (${h.portion.toUpperCase()}) · uses ${num(cal.holidayDays(h))} days`;
    else uses = `uses ${plural(cal.holidayDays(h), "day")}`;
    const pencilled = isPencilled(h);
    const title = el("strong", {}, h.name,
      pencilled ? el("span", { className: "tag t-pencilled", textContent: "Pencilled in" }) : null,
      h.mandatory ? el("span", { className: "tag t-mandatory", textContent: "Mandatory" }) : null);
    const actions = h.mandatory ? null : el("div", { className: "item-actions" },
      el("button", { className: "del", ariaLabel: `Delete ${h.name}`, textContent: "×", onclick: () => removeHoliday(h) }),
      pencilled ? el("button", { className: "soft small", textContent: "Book it", onclick: () => bookHoliday(h) }) : null);
    return el("li", { className: `card item${isPast ? " past" : ""}${pencilled ? " pencilled" : ""}` },
      el("div", { className: "count" }, el("b", { textContent: big }), el("small", { textContent: small })),
      el("div", { className: "info" }, title,
        el("div", { className: "meta", textContent: `${fmtRange(h.start, h.end)} · ${uses}` }),
        h.note ? el("div", { className: "meta", textContent: h.note }) : null),
      actions);
  }));
}

function renderCalendar(map) {
  const onDay = (iso) => openDay(iso);
  if (ui.month) {
    $("calendarTitle").textContent = "Tap a day for details";
    renderMonth($("calendar"), {
      year: ui.year, month: ui.month, map, onDay,
      onBack: () => { ui.month = null; render(); },
      onPrev: () => shiftMonth(-1),
      onNext: () => shiftMonth(1),
    });
  } else {
    $("calendarTitle").textContent = "Tap a month to zoom in, or a day for details";
    renderYear($("calendar"), {
      year: ui.year, map, onDay,
      onMonth: (m) => { ui.month = m; render(); $("calendarView").scrollIntoView({ behavior: "smooth", block: "start" }); },
    });
  }
  const kinds = ["taken", "booked", "pencilled", "mandatory", "bank"];
  $("legend").replaceChildren(legend(kinds));
}

function shiftMonth(delta) {
  let m = ui.month + delta;
  if (m < 1) { ui.year--; m = 12; }
  if (m > 12) { ui.year++; m = 1; }
  ui.month = m;
  render();
}

function bankRow(b) {
  let action;
  if (b.status === "available") {
    action = el("div", { className: "actions" },
      el("button", { className: "small", textContent: "+ Book",
        onclick: () => addHolidays([{ name: b.name, start: b.date, end: b.date, note: "Bank holiday", status: "booked" }]) }),
      el("button", { className: "soft small", textContent: "✎", ariaLabel: `Pencil in ${b.name}`,
        onclick: () => addHolidays([{ name: b.name, start: b.date, end: b.date, note: "Bank holiday", status: "pencilled" }]) }));
  } else {
    const labels = { off: "Day off", booked: "Booked", pencilled: "Pencilled in", mandatory: "Mandatory" };
    action = el("span", { className: "muted", textContent: labels[b.status] });
  }
  return el("li", {}, el("div", { className: "info" }, el("strong", { textContent: b.name }),
    el("div", { className: "meta", textContent: fmt(b.date) })), action);
}

// ---- changing holidays ------------------------------------------------------------

function addHolidays(raw) {
  const items = raw.map(validateHoliday); // throws with a friendly message
  profile().holidays.push(...items);
  persist();
  render();
  return items;
}

function bookHoliday(h) {
  h.status = "booked";
  persist();
  closeSheet();
  render();
}

function removeHoliday(h) {
  if (!confirm(`Delete "${h.name}"?`)) return;
  profile().holidays = profile().holidays.filter((x) => x !== h);
  persist();
  closeSheet();
  render();
}

// ---- day sheet ----------------------------------------------------------------------

function openDay(iso) {
  const p = profile();
  const info = dayMap(p.holidays, p.settings, yearOf(iso), localToday()).get(iso);
  const cal = new WorkCalendar(p.settings);
  $("sheetTitle").textContent = fmtLong(iso);
  $("sheetInfo").replaceChildren(...describeDay(info, cal).map((l) =>
    el("li", {}, el("i", { className: `dot k-${l.kind}` }), el("span", { textContent: l.text }))));
  const actions = [];
  for (const h of info.holidays) {
    if (isPencilled(h)) actions.push(el("button", { className: "soft", textContent: `Mark "${h.name}" as booked`, onclick: () => bookHoliday(h) }));
    actions.push(el("button", { className: "danger", textContent: `Delete "${h.name}"`, onclick: () => removeHoliday(h) }));
  }
  if (!info.holidays.length) {
    actions.push(
      el("button", { textContent: "Add a holiday starting here", onclick: () => prefill(iso, "booked") }),
      el("button", { className: "soft", textContent: "✎ Pencil in this day", onclick: () => {
        addHolidays([{ name: "Pencilled in", start: iso, end: iso, status: "pencilled" }]);
        openDay(iso);
      } }),
      el("button", { className: "ghost", textContent: "Plan a longer pencilled-in break from here", onclick: () => prefill(iso, "pencilled") }));
  }
  $("sheetActions").replaceChildren(...actions);
  $("sheet").hidden = false;
  $("sheetClose").focus();
}

function closeSheet() {
  $("sheet").hidden = true;
}

function prefill(iso, status) {
  closeSheet();
  $("start").value = iso;
  $("end").value = iso;
  $("portion").value = "full";
  $("status").value = status;
  syncPortion();
  $("addForm").scrollIntoView({ behavior: "smooth", block: "center" });
  $("name").focus({ preventScroll: true });
}

$("sheetClose").onclick = closeSheet;
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

// ---- navigation -----------------------------------------------------------------------

function changeYear(delta) {
  if (!$("settingsForm").hidden) stashCarry();
  ui.year += delta;
  if (!$("settingsForm").hidden) showCarry();
  render();
}
$("prevYear").onclick = () => changeYear(-1);
$("nextYear").onclick = () => changeYear(1);
for (const tab of [$("tabList"), $("tabCalendar")]) {
  tab.onclick = () => { ui.view = tab.dataset.view; setPref(PREFS.view, ui.view); render(); };
}

$("profile").onchange = () => {
  const v = $("profile").value;
  if (v === "__new") {
    const name = (prompt("Name of the person to add (e.g. Anna):") || "").trim();
    if (name) {
      const p = newProfile(name.slice(0, 40));
      state.profiles.push(p);
      state.activeId = p.id;
    }
  } else {
    state.activeId = v;
  }
  persist();
  ui.month = null;
  $("settingsForm").hidden = true;
  $("picture").hidden = $("link").hidden = true;
  $("impName").value = profile().settings.calendar_name;
  render();
};

// ---- add form -------------------------------------------------------------------------

function syncPortion() {
  const half = $("portion").value !== "full";
  $("end").disabled = half;
  if (half) $("end").value = $("start").value;
}
$("portion").addEventListener("change", syncPortion);
$("start").addEventListener("change", () => {
  if (!$("end").value || $("end").value < $("start").value || $("portion").value !== "full") $("end").value = $("start").value;
});

$("addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  $("addError").textContent = "";
  try {
    const [h] = addHolidays([{ name: $("name").value, start: $("start").value, end: $("end").value,
      portion: $("portion").value, status: $("status").value, note: $("note").value }]);
    $("addForm").reset();
    syncPortion();
    ui.year = yearOf(h.start);
    render();
  } catch (err) {
    $("addError").textContent = err.message;
  }
});

// ---- settings -------------------------------------------------------------------------

$("settingsBtn").onclick = () => {
  const p = profile(), s = p.settings;
  $("sName").value = p.name;
  $("sAllowance").value = s.allowance;
  $("sWorkDays").replaceChildren(...WEEKDAYS.map((d, i) =>
    el("label", {}, el("input", { type: "checkbox", value: i, checked: s.work_days.includes(i) }), d)));
  ui.mandatory = [...s.mandatory_days];
  ui.carry = { ...s.carry_over };
  showCarry();
  renderMandatory();
  $("sMandatoryCounts").checked = s.mandatory_counts;
  $("sRegion").replaceChildren(...Object.entries(REGIONS).map(([k, v]) =>
    el("option", { value: k, textContent: v, selected: k === s.bank_region })));
  $("sBankOff").checked = s.bank_holidays_off;
  $("sCalName").value = s.calendar_name;
  $("deleteProfile").hidden = state.profiles.length < 2;
  $("settingsError").textContent = "";
  $("settingsForm").hidden = false;
  $("settingsForm").scrollIntoView({ behavior: "smooth" });
};
$("settingsCancel").onclick = () => { $("settingsForm").hidden = true; };

function renderMandatory() {
  const label = (mmdd) => new Date(Date.UTC(2000, Number(mmdd.slice(0, 2)) - 1, Number(mmdd.slice(3))))
    .toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" });
  $("sMandatory").replaceChildren(...ui.mandatory.map((m) => el("span", { className: "chip" }, label(m),
    el("button", { type: "button", ariaLabel: "Remove", textContent: "×",
      onclick: () => { ui.mandatory = ui.mandatory.filter((x) => x !== m); renderMandatory(); } }))));
  if (!ui.mandatory.length) $("sMandatory").append(el("span", { className: "muted", textContent: "None" }));
}
$("sMandatoryAdd").onclick = () => {
  const v = $("sMandatoryNew").value;
  if (!v) return;
  const mmdd = v.slice(5);
  if (!ui.mandatory.includes(mmdd)) ui.mandatory = [...ui.mandatory, mmdd].sort();
  $("sMandatoryNew").value = "";
  renderMandatory();
};

// Carry-over is edited for the year being viewed; other years are kept in ui.carry.
function stashCarry() {
  const v = $("sCarry").value.trim().replace(",", ".");
  ui.carry[String(ui.year)] = v;
  return ui.carry;
}

function showCarry() {
  $("sCarryYear").textContent = ui.year;
  const v = ui.carry[String(ui.year)];
  $("sCarry").value = v === undefined || v === 0 ? "" : String(v).replace(".", decimalMark());
  // Offer last year's leftover days, if last year was used at all.
  const p = profile(), prev = ui.year - 1;
  const usedLastYear = p.holidays.some((h) => h.start <= `${prev}-12-31` && h.end >= `${prev}-01-01`);
  const left = usedLastYear
    ? yearSummary(p.holidays, { ...p.settings, carry_over: cleanCarry(ui.carry, p.settings) }, prev, localToday()).remaining
    : 0;
  $("sCarryFill").hidden = !(left > 0);
  $("sCarryFill").textContent = `Use what was left in ${prev}: ${num(left)} days`;
  $("sCarryFill").onclick = () => { $("sCarry").value = num(left).replace(".", decimalMark()); };
}

const decimalMark = () => (1.5).toLocaleString().charAt(1);

function cleanCarry(raw, current) {
  try {
    return validateSettings({ carry_over: raw }, current).carry_over;
  } catch {
    return current.carry_over;
  }
}

$("settingsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  $("settingsError").textContent = "";
  try {
    const p = profile();
    p.settings = validateSettings({
      allowance: $("sAllowance").value,
      work_days: [...$("sWorkDays").querySelectorAll("input:checked")].map((i) => Number(i.value)),
      mandatory_days: ui.mandatory,
      carry_over: stashCarry(),
      mandatory_counts: $("sMandatoryCounts").checked,
      bank_region: $("sRegion").value,
      bank_holidays_off: $("sBankOff").checked,
      calendar_name: $("sCalName").value,
    }, p.settings);
    p.name = $("sName").value.trim().slice(0, 40) || p.name;
    persist();
    $("impName").value = p.settings.calendar_name;
    $("settingsForm").hidden = true;
    render();
  } catch (err) {
    $("settingsError").textContent = err.message;
  }
});

$("deleteProfile").onclick = () => {
  const p = profile();
  if (state.profiles.length < 2 || !confirm(`Remove ${p.name} and all their holidays from this phone?`)) return;
  state.profiles = state.profiles.filter((x) => x !== p);
  state.activeId = state.profiles[0].id;
  persist();
  $("settingsForm").hidden = true;
  render();
};

// ---- sharing ----------------------------------------------------------------------------

const displayName = (p) => (p.name === "Me" ? "My holidays" : `${p.name}'s holidays`);

$("makePicture").onclick = async () => {
  const p = profile(), today = localToday();
  const withPencilled = $("shareIncludePencilled").checked;
  const holidays = withPencilled ? p.holidays : p.holidays.filter((h) => !isPencilled(h));
  const summary = $("shareIncludeAllowance").checked ? yearSummary(holidays, p.settings, ui.year, today) : null;
  const kinds = ["taken", "booked", ...(withPencilled && holidays.some(isPencilled) ? ["pencilled"] : []), "mandatory", "bank"];
  const canvas = drawYearPicture({ title: displayName(p), year: ui.year, map: dayMap(holidays, p.settings, ui.year, today), summary, kinds });
  const file = await canvasToFile(canvas, `holidays-${ui.year}.png`);
  if (ui.picture) URL.revokeObjectURL($("pictureImg").src);
  ui.picture = file;
  $("pictureImg").src = URL.createObjectURL(file);
  $("picture").hidden = false;
  $("link").hidden = true;
  $("picture").scrollIntoView({ behavior: "smooth", block: "nearest" });
};
$("pictureShare").onclick = () => shareOrDownload(ui.picture, displayName(profile()));

async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    input.select();
    document.execCommand("copy");
  }
}

$("makeLink").onclick = async () => {
  const p = profile();
  if (p.name === "Me") {
    const name = (prompt("What name should people see on the shared page?") || "").trim();
    if (!name) return;
    p.name = name.slice(0, 40);
    persist();
    render();
  }
  const frag = await encodeShare(p, { pencilled: $("shareIncludePencilled").checked, allowance: $("shareIncludeAllowance").checked });
  const url = new URL("share.html", location.href);
  url.hash = frag;
  const input = $("linkUrl");
  input.value = url.href;
  const msg = encodeURIComponent(`${displayName(p)}: ${url.href}`);
  const copy = el("button", { type: "button", className: "small", textContent: "Copy", onclick: async () => {
    await copyText(url.href, input);
    copy.textContent = "Copied!";
    setTimeout(() => { copy.textContent = "Copy"; }, 1500);
  } });
  $("linkActions").replaceChildren(
    navigator.share ? el("button", { type: "button", className: "small", textContent: "Share…",
      onclick: () => navigator.share({ title: displayName(p), url: url.href }).catch(() => {}) }) : null,
    copy,
    el("a", { className: "btn", href: `sms:?&body=${msg}`, textContent: "Text" }),
    el("a", { className: "btn", href: `https://wa.me/?text=${msg}`, target: "_blank", rel: "noopener", textContent: "WhatsApp" }));
  $("link").hidden = false;
  $("picture").hidden = true;
};
$("linkUrl").onclick = (e) => e.target.select();

// ---- import -----------------------------------------------------------------------------

$("impFile").addEventListener("change", async () => {
  const f = $("impFile").files[0];
  if (f) $("impText").value = await f.text();
});

$("impPreview").onclick = () => {
  $("impError").textContent = "";
  $("impResult").hidden = true;
  const text = $("impText").value;
  if (!text.trim()) { $("impError").textContent = "Choose a file or paste some text first."; return; }
  const p = profile();
  const cal = new WorkCalendar(p.settings);
  const items = parseCalendar(text, $("impName").value, p.settings.work_days);
  ui.importItems = items;
  if (!items.length) { $("impError").textContent = "No matching events found. Check the name above."; return; }
  $("impList").replaceChildren(...items.map((it, i) => {
    const duplicate = p.holidays.some((h) => overlaps(it, h));
    const what = it.portion !== "full" ? `half day (${it.portion.toUpperCase()})` : plural(cal.holidayDays(it), "day");
    return el("li", {}, el("input", { type: "checkbox", checked: !duplicate, dataset: { i } }),
      el("div", { className: "info" }, el("strong", { textContent: it.name }),
        el("div", { className: "meta", textContent: `${fmtRange(it.start, it.end)} · ${what}${duplicate ? " · already added" : ""}` })));
  }));
  $("impResult").hidden = false;
};

$("impCommit").onclick = () => {
  const chosen = [...$("impList").querySelectorAll("input:checked")].map((c) => ui.importItems[c.dataset.i]);
  if (!chosen.length) return;
  addHolidays(chosen);
  $("impResult").hidden = true;
  $("impText").value = "";
  $("impFile").value = "";
};

// ---- backup -----------------------------------------------------------------------------

$("backupSave").onclick = () => shareOrDownload(backupFile(state), "HolidayKeeper backup");

$("backupRestore").addEventListener("change", async () => {
  $("backupError").textContent = "";
  const f = $("backupRestore").files[0];
  $("backupRestore").value = "";
  if (!f) return;
  try {
    const restored = sanitize(JSON.parse(await f.text()));
    const count = restored.profiles.reduce((n, p) => n + p.holidays.length, 0);
    if (!confirm(`Replace everything on this phone with the backup (${plural(restored.profiles.length, "person").replace("persons", "people")}, ${plural(count, "holiday")})?`)) return;
    state = restored;
    persist();
    ui.month = null;
    render();
  } catch (err) {
    $("backupError").textContent = err instanceof SyntaxError ? "That file isn't a HolidayKeeper backup." : err.message;
  }
});

// ---- start ---------------------------------------------------------------------------------

const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
$("installHint").hidden = standalone || pref(PREFS.installDismissed, "") === "1";
$("installDismiss").onclick = () => { setPref(PREFS.installDismissed, "1"); $("installHint").hidden = true; };

$("impName").value = profile().settings.calendar_name;
render();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") render(); });

navigator.storage?.persist?.().catch(() => {});
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
