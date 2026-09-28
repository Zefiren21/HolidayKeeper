// Snapshot share links: the holidays are packed into the link itself (after the #, so
// they never reach any server). Anyone with the link can view them; nothing is live.

import { DEFAULT_SETTINGS, isValidISO, PORTIONS, STATUSES, validateSettings } from "./core.js";

const SETTINGS_KEYS = ["work_days", "mandatory_days", "mandatory_counts", "bank_region", "bank_holidays_off", "allowance"];

function toBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * Build the part after "#" for a share link.
 * options: { pencilled: include pencilled-in holidays, allowance: include days left }
 */
export async function encodeShare(profile, options = {}) {
  const holidays = profile.holidays
    .filter((h) => options.pencilled || h.status !== "pencilled")
    .map((h) => [h.start, h.end, h.name, h.portion === "full" ? 0 : h.portion, h.status === "pencilled" ? 1 : 0]);
  const settings = {};
  for (const k of SETTINGS_KEYS) settings[k] = profile.settings[k];
  if (!options.allowance) delete settings.allowance;
  const payload = { v: 1, n: profile.name, h: holidays, s: settings };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "function") {
    return "z" + toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw")));
  }
  return "j" + toBase64Url(bytes);
}

/** Inverse of encodeShare; returns {name, holidays, settings, showAllowance} or throws. */
export async function decodeShare(fragment) {
  const kind = fragment[0], body = fromBase64Url(fragment.slice(1));
  let bytes;
  if (kind === "z") bytes = await pipe(body, new DecompressionStream("deflate-raw"));
  else if (kind === "j") bytes = body;
  else throw new Error("not a HolidayKeeper link");
  const p = JSON.parse(new TextDecoder().decode(bytes));
  if (p.v !== 1 || !Array.isArray(p.h)) throw new Error("not a HolidayKeeper link");

  const holidays = p.h
    .filter((x) => Array.isArray(x) && isValidISO(x[0]) && isValidISO(x[1]))
    .map(([start, end, name, portion, pencilled], i) => ({
      id: `s${i}`, start, end, name: String(name || "Holiday").slice(0, 100),
      portion: PORTIONS.includes(portion) ? portion : "full",
      status: STATUSES[pencilled ? 1 : 0], note: "",
    }));
  let settings = { ...DEFAULT_SETTINGS };
  const given = {};
  for (const k of SETTINGS_KEYS) if (p.s && k in p.s) given[k] = p.s[k];
  try {
    settings = validateSettings(given, settings);
  } catch {
    // a tampered link: fall back to default settings rather than failing to show anything
  }
  return { name: String(p.n || "Someone").slice(0, 60), holidays, settings, showAllowance: Boolean(p.s && "allowance" in p.s) };
}
