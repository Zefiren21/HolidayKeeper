// Tiny DOM + formatting helpers shared by the app and the share page.

import { toDate } from "./core.js";

export const $ = (id) => document.getElementById(id);

export function el(tag, { dataset, ...props } = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(e.dataset, dataset);
  e.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return e;
}

export const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const plural = (n, word) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;

const fmtOpts = { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" };
export const fmt = (iso, withYear = false) =>
  toDate(iso).toLocaleDateString(undefined, withYear ? { ...fmtOpts, year: "numeric" } : fmtOpts);
export const fmtLong = (iso) =>
  toDate(iso).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
export function fmtRange(start, end) {
  if (start === end) return fmt(start, true);
  return `${fmt(start, start.slice(0, 4) !== end.slice(0, 4))} – ${fmt(end, true)}`;
}

/** Share a file with the iOS/Android share sheet, or fall back to downloading it. */
export async function shareOrDownload(file, title) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = el("a", { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
