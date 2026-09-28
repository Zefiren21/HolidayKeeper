import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETTINGS } from "../js/core.js";
import { decodeShare, encodeShare } from "../js/share.js";

const profile = {
  name: "Alex",
  settings: { ...DEFAULT_SETTINGS, allowance: 30, bank_region: "scotland", calendar_name: "Alex Example" },
  holidays: [
    { id: "a", name: "Lisbon", start: "2026-10-12", end: "2026-10-16", portion: "full", status: "booked", note: "secret" },
    { id: "b", name: "Dentist", start: "2026-11-02", end: "2026-11-02", portion: "pm", status: "booked", note: "" },
    { id: "c", name: "Maybe Rome", start: "2026-12-01", end: "2026-12-04", portion: "full", status: "pencilled", note: "" },
  ],
};

test("round trip without pencilled holidays or allowance", async () => {
  const frag = await encodeShare(profile);
  assert.match(frag, /^[zj][A-Za-z0-9_-]+$/);
  const data = await decodeShare(frag);
  assert.equal(data.name, "Alex");
  assert.deepEqual(data.holidays.map((h) => [h.name, h.start, h.end, h.portion, h.status]), [
    ["Lisbon", "2026-10-12", "2026-10-16", "full", "booked"],
    ["Dentist", "2026-11-02", "2026-11-02", "pm", "booked"],
  ]);
  assert.ok(data.holidays.every((h) => h.note === ""), "notes are never shared");
  assert.equal(data.settings.bank_region, "scotland");
  assert.equal(data.showAllowance, false);
  assert.equal(data.settings.calendar_name, "");
});

test("options include pencilled holidays and allowance", async () => {
  const data = await decodeShare(await encodeShare(profile, { pencilled: true, allowance: true }));
  assert.equal(data.holidays.length, 3);
  assert.equal(data.holidays[2].status, "pencilled");
  assert.equal(data.showAllowance, true);
  assert.equal(data.settings.allowance, 30);
});

test("rejects junk and survives tampered settings", async () => {
  await assert.rejects(decodeShare("xabc"));
  const raw = Buffer.from(JSON.stringify({ v: 1, n: "E", h: [["2026-01-05", "2026-01-06", "Hi", 0, 0], ["bad"]], s: { bank_region: "mars" } }))
    .toString("base64url");
  const data = await decodeShare("j" + raw);
  assert.equal(data.holidays.length, 1);
  assert.equal(data.settings.bank_region, "england-and-wales");
});
