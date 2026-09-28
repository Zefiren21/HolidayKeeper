import assert from "node:assert/strict";
import { test } from "node:test";

import { active, load, sanitize, save } from "../js/store.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v) { this.data.set(k, String(v)); }
}

test("first run creates one profile and round-trips through storage", () => {
  const storage = new MemoryStorage();
  const state = load(storage);
  assert.equal(state.profiles.length, 1);
  assert.equal(active(state).name, "Me");
  active(state).holidays.push({ id: "x", name: "Trip", start: "2026-01-05", end: "2026-01-06", portion: "full", status: "pencilled", note: "" });
  assert.ok(save(state, storage));
  const again = load(storage);
  assert.deepEqual(again, state);
});

test("corrupt storage falls back to a blank state", () => {
  const storage = new MemoryStorage();
  storage.setItem("holidaykeeper:v1", "{not json");
  assert.equal(load(storage).profiles.length, 1);
});

test("sanitize keeps good data and drops bad", () => {
  const state = sanitize({
    activeId: "nope",
    profiles: [{ id: "p1", name: "Wife", settings: { allowance: 28, bank_region: "mars" },
      holidays: [{ name: "ok", start: "2026-02-02" }, { name: "bad", start: "2026-13-01" }] }],
  });
  assert.equal(state.activeId, "p1");
  assert.equal(state.profiles[0].settings.allowance, 25); // whole settings block rejected
  assert.deepEqual(state.profiles[0].holidays.map((h) => h.name), ["ok"]);
  assert.throws(() => sanitize({ profiles: [] }));
});
