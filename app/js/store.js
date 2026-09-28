// Everything is saved on this device (localStorage). Several people ("profiles") can be
// tracked on one phone, e.g. you and your wife, each with their own allowance and settings.

import { DEFAULT_SETTINGS, newId, validateHoliday, validateSettings } from "./core.js";

const KEY = "holidaykeeper:v1";

export const newProfile = (name) => ({ id: newId(), name, settings: { ...DEFAULT_SETTINGS }, holidays: [] });

function blank() {
  const me = newProfile("Me");
  return { version: 1, activeId: me.id, profiles: [me] };
}

/** Rebuild a stored or imported state, dropping anything malformed. */
export function sanitize(raw) {
  if (!raw || !Array.isArray(raw.profiles) || !raw.profiles.length) throw new Error("that isn't a HolidayKeeper backup");
  const profiles = raw.profiles.map((p) => {
    let settings = { ...DEFAULT_SETTINGS };
    try {
      settings = validateSettings(p.settings || {}, settings);
    } catch {
      // keep defaults for a corrupt settings block
    }
    const holidays = [];
    for (const h of Array.isArray(p.holidays) ? p.holidays : []) {
      try {
        holidays.push(validateHoliday(h));
      } catch {
        // skip a broken holiday rather than losing the rest
      }
    }
    return { id: String(p.id || newId()), name: String(p.name || "Me").slice(0, 40), settings, holidays };
  });
  const activeId = profiles.some((p) => p.id === raw.activeId) ? raw.activeId : profiles[0].id;
  return { version: 1, activeId, profiles };
}

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : blank();
  } catch {
    return blank();
  }
}

export function save(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export const active = (state) => state.profiles.find((p) => p.id === state.activeId) || state.profiles[0];

export function backupFile(state) {
  const body = JSON.stringify({ app: "HolidayKeeper", exported: new Date().toISOString(), ...state }, null, 2);
  return new File([body], `holidaykeeper-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" });
}
