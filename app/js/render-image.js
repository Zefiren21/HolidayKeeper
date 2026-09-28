// Draw a whole year as a shareable picture (PNG) with holidays colour coded.
// Uses a fixed light palette so the picture looks the same in every chat app.

import { daysInMonth, weekday, ymd } from "./core.js";
import { KIND_LABELS, MONTHS } from "./calendar-view.js";
import { num } from "./ui.js";

const C = {
  bg: "#ffffff", text: "#1a2421", muted: "#5f6f6a", border: "#dfe5e3",
  taken: ["#a5d8d0", "#134e48"], booked: ["#0f766e", "#ffffff"], pencilled: ["#fde1a6", "#5c3b00"],
  mandatory: ["#7c5cc4", "#ffffff"], bank: ["#dbe8fb", "#1d4ed8"], off: ["#eceff0", "#8a9793"], work: [null, "#1a2421"],
  pencilLine: "#c27c0e", bankLine: "#3b82f6",
};
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const W = 1200, PAD = 56, COLS = 3, GAP_X = 36, GAP_Y = 30;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawDay(ctx, info, x, y, s, day) {
  const [fill, ink] = C[info.kind];
  const r = s * 0.2, inset = 2;
  if (fill) {
    ctx.save();
    roundRect(ctx, x + inset, y + inset, s - inset * 2, s - inset * 2, r);
    ctx.clip();
    ctx.fillStyle = fill;
    if (info.half) { // half day: only the top-left triangle
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.closePath();
    } else {
      ctx.fillRect(x, y, s, s);
    }
    ctx.fill();
    ctx.restore();
  }
  if (info.kind === "pencilled" || info.kind === "bank") {
    roundRect(ctx, x + inset + 1, y + inset + 1, s - inset * 2 - 2, s - inset * 2 - 2, r);
    ctx.strokeStyle = info.kind === "pencilled" ? C.pencilLine : C.bankLine;
    ctx.lineWidth = 2;
    ctx.setLineDash(info.kind === "pencilled" ? [5, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (info.today) {
    roundRect(ctx, x + 1, y + 1, s - 2, s - 2, r + 1);
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.fillStyle = info.half ? C.text : ink;
  ctx.font = `600 ${Math.round(s * 0.38)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(day), x + s / 2, y + s / 2 + 1);
}

/**
 * options: { title, year, map (from dayMap), summary (or null to hide numbers), kinds (legend entries) }
 * Returns a canvas at 2x resolution.
 */
export function drawYearPicture({ title, year, map, summary = null, kinds }) {
  const monthW = (W - PAD * 2 - GAP_X * (COLS - 1)) / COLS;
  const cell = monthW / 7;
  const monthH = 44 + cell * 0.6 + cell * 6;
  const headerH = summary ? 150 : 110;
  const legendH = 90;
  const H = Math.round(PAD + headerH + 4 * monthH + 3 * GAP_Y + legendH + PAD * 0.6);

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.text;
  ctx.font = `700 46px ${FONT}`;
  ctx.fillText(title, PAD, PAD + 40);
  ctx.fillStyle = C.muted;
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(String(year), PAD, PAD + 80);
  if (summary) {
    const parts = [`${num(summary.remaining)} of ${num(summary.allowance)} days left`,
      `${num(summary.taken)} taken`, `${num(summary.booked)} booked`];
    if (summary.pencilled) parts.push(`${num(summary.pencilled)} pencilled in`);
    ctx.fillStyle = C.booked[0];
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(parts.join("  ·  "), PAD, PAD + 122);
  }

  // months
  const top = PAD + headerH;
  for (let m = 1; m <= 12; m++) {
    const col = (m - 1) % COLS, row = Math.floor((m - 1) / COLS);
    const x0 = PAD + col * (monthW + GAP_X), y0 = top + row * (monthH + GAP_Y);
    ctx.fillStyle = C.text;
    ctx.font = `700 26px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(MONTHS[m - 1], x0 + 2, y0 + 28);
    ctx.fillStyle = C.muted;
    ctx.font = `600 ${Math.round(cell * 0.3)}px ${FONT}`;
    ctx.textAlign = "center";
    ["M", "T", "W", "T", "F", "S", "S"].forEach((w, i) => ctx.fillText(w, x0 + i * cell + cell / 2, y0 + 44 + cell * 0.35));
    const gridTop = y0 + 44 + cell * 0.6;
    const offset = weekday(ymd(year, m, 1));
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const idx = offset + d - 1;
      drawDay(ctx, map.get(ymd(year, m, d)), x0 + (idx % 7) * cell, gridTop + Math.floor(idx / 7) * cell, cell, d);
    }
  }

  // legend
  let lx = PAD;
  const ly = H - PAD * 0.6 - legendH / 2;
  ctx.font = `500 22px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (const k of kinds) {
    drawDay(ctx, { kind: k, half: false, today: false }, lx, ly - 18, 36, "");
    ctx.fillStyle = C.muted;
    ctx.font = `500 22px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(KIND_LABELS[k], lx + 44, ly);
    lx += 44 + ctx.measureText(KIND_LABELS[k]).width + 30;
  }
  ctx.fillStyle = "#9aa6a2";
  ctx.font = `500 18px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("Made with HolidayKeeper", W - PAD, ly + 42);
  return canvas;
}

export const canvasToFile = (canvas, name) =>
  new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob], name, { type: "image/png" })), "image/png"));
