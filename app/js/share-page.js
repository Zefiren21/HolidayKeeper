// Read-only page for a snapshot share link (share.html#<data>).

import { dayMap, isPencilled, localToday, yearOf, yearSummary } from "./core.js";
import { describeDay, legend, renderMonth, renderYear } from "./calendar-view.js";
import { canvasToFile, drawYearPicture } from "./render-image.js";
import { decodeShare } from "./share.js";
import { $, el, fmtLong, fmtRange, num, plural, shareOrDownload } from "./ui.js";

const today = localToday();
const ui = { year: yearOf(today), month: null };
let data;

function render() {
  const map = dayMap(data.holidays, data.settings, ui.year, today);
  $("yearLabel").textContent = ui.year;

  if (data.showAllowance) {
    const s = yearSummary(data.holidays, data.settings, ui.year, today);
    $("summary").hidden = false;
    $("remaining").textContent = num(s.remaining);
    $("remainingLabel").textContent = `of ${num(s.allowance)} days left in ${ui.year}`;
    $("ifPencilled").hidden = !s.pencilled;
    $("ifPencilled").textContent = `✎ ${num(s.remainingIfPencilled)} if the pencilled-in ${plural(s.pencilled, "day")} are taken`;
  }

  const upcoming = data.holidays.filter((h) => h.end >= today).sort((a, b) => (a.start < b.start ? -1 : 1));
  $("upcoming").replaceChildren(...(upcoming.length ? upcoming.map((h) => {
    const n = Math.round((Date.parse(h.start) - Date.parse(today)) / 86400000);
    const [big, small] = n > 0 ? [String(n), n === 1 ? "day to go" : "days to go"] : ["🌴", "now!"];
    const half = h.portion !== "full" ? ` · half day (${h.portion.toUpperCase()})` : "";
    return el("li", { className: `card item${isPencilled(h) ? " pencilled" : ""}` },
      el("div", { className: "count" }, el("b", { textContent: big }), el("small", { textContent: small })),
      el("div", { className: "info" },
        el("strong", {}, h.name, isPencilled(h) ? el("span", { className: "tag t-pencilled", textContent: "Pencilled in" }) : null),
        el("div", { className: "meta", textContent: fmtRange(h.start, h.end) + half })));
  }) : [el("li", { className: "empty", textContent: "Nothing planned right now." })]));

  const onDay = (iso) => {
    $("sheetTitle").textContent = fmtLong(iso);
    $("sheetInfo").replaceChildren(...describeDay(map.get(iso), null).map((l) =>
      el("li", {}, el("i", { className: `dot k-${l.kind}` }), el("span", { textContent: l.text }))));
    $("sheet").hidden = false;
  };
  if (ui.month) {
    renderMonth($("calendar"), {
      year: ui.year, month: ui.month, map, onDay,
      onBack: () => { ui.month = null; render(); },
      onPrev: () => { if (--ui.month < 1) { ui.month = 12; ui.year--; } render(); },
      onNext: () => { if (++ui.month > 12) { ui.month = 1; ui.year++; } render(); },
    });
  } else {
    renderYear($("calendar"), { year: ui.year, map, onDay, onMonth: (m) => { ui.month = m; render(); } });
  }
  const kinds = ["taken", "booked", ...(data.holidays.some(isPencilled) ? ["pencilled"] : []), "mandatory", "bank"];
  $("legend").replaceChildren(legend(kinds));
}

$("prevYear").onclick = () => { ui.year--; render(); };
$("nextYear").onclick = () => { ui.year++; render(); };
$("sheetClose").onclick = () => { $("sheet").hidden = true; };
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) $("sheet").hidden = true; });

$("savePicture").onclick = async () => {
  const kinds = ["taken", "booked", ...(data.holidays.some(isPencilled) ? ["pencilled"] : []), "mandatory", "bank"];
  const summary = data.showAllowance ? yearSummary(data.holidays, data.settings, ui.year, today) : null;
  const canvas = drawYearPicture({ title: `${data.name}'s holidays`, year: ui.year,
    map: dayMap(data.holidays, data.settings, ui.year, today), summary, kinds });
  await shareOrDownload(await canvasToFile(canvas, `${data.name}-holidays-${ui.year}.png`), `${data.name}'s holidays`);
};

(async () => {
  try {
    data = await decodeShare(location.hash.slice(1));
  } catch {
    $("title").textContent = "Link not available";
    $("sub").textContent = "This link looks incomplete. Ask for it to be sent again.";
    return;
  }
  document.title = `${data.name}'s holidays`;
  $("title").textContent = `${data.name}'s holidays`;
  $("sub").textContent = "Read-only snapshot. Tap a month to zoom in, or a day for details.";
  $("content").hidden = false;
  render();
})();
