// Browser test: drives the real app at phone size in Chromium.
//   npm install --no-save playwright && npx playwright install chromium && node app/tests/e2e.mjs
// Set SHOTS=dir to save screenshots.

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { DEFAULT_SETTINGS, yearSummary } from "../js/core.js";
import { startServer } from "./serve.mjs";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const globalRoot = execSync("npm root -g").toString().trim();
    return createRequire(join(globalRoot, "noop.js"))("playwright");
  }
}

const { chromium } = await loadPlaywright();
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); };

const Y = new Date().getFullYear() + 1;
const errors = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept("Anna") : d.accept()));

  await page.goto(base);
  await page.click("#installDismiss");
  await shot(page, "01-empty");

  // Settings: name and allowance.
  await page.click("#settingsBtn");
  await page.fill("#sName", "Alex");
  await page.fill("#sAllowance", "30");
  await page.fill("#sCalName", "Alex Example");
  await page.click("#settingsForm button[type=submit]");
  assert.equal(await page.inputValue("#profile"), await page.evaluate(() => JSON.parse(localStorage.getItem("holidaykeeper:v1")).activeId));

  // A booked week and a pencilled-in week next year.
  const add = async (name, start, end, status) => {
    await page.fill("#name", name);
    await page.fill("#start", start);
    await page.fill("#end", end);
    await page.selectOption("#status", status);
    await page.click("#addForm button[type=submit]");
  };
  await add("Lisbon", `${Y}-05-04`, `${Y}-05-08`, "booked");
  await add("Maybe Rome", `${Y}-07-06`, `${Y}-07-10`, "pencilled");
  const settings = { ...DEFAULT_SETTINGS, allowance: 30 };
  const holidays = [
    { start: `${Y}-05-04`, end: `${Y}-05-08`, portion: "full", status: "booked" },
    { start: `${Y}-07-06`, end: `${Y}-07-10`, portion: "full", status: "pencilled" },
  ];
  const expected = yearSummary(holidays, settings, Y, `${Y - 1}-12-31`);
  assert.equal(await page.textContent("#yearLabel"), String(Y));
  assert.equal(await page.textContent("#remaining"), String(expected.remaining));
  assert.equal(await page.textContent("#pencilled"), String(expected.pencilled));
  assert.match(await page.textContent("#ifPencilled"), new RegExp(`^✎ ${expected.remainingIfPencilled} left`));
  assert.equal(await page.locator("#upcoming li.pencilled").count(), 1);
  await shot(page, "02-list");

  // Calendar: year view, zoom into May, open a day.
  await page.click("#tabCalendar");
  assert.equal(await page.locator(".cal-month").count(), 12);
  assert.ok(await page.locator(`.cal-day.k-booked[data-date="${Y}-05-06"]`).isVisible());
  assert.ok(await page.locator(`.cal-day.k-pencilled[data-date="${Y}-07-07"]`).isVisible());
  await shot(page, "03-calendar-year");
  await page.click(".cal-month:nth-child(5) .cal-title");
  assert.equal(await page.textContent(".cal-nav b"), `May ${Y}`);
  await page.click(`.cal-day[data-date="${Y}-05-06"]`);
  assert.match(await page.textContent("#sheetInfo"), /Lisbon/);
  await shot(page, "04-month-day");
  await page.click("#sheetClose");
  await page.click(".cal-nav button:has-text('›')");
  await page.click(".cal-nav button:has-text('›')");
  await page.click(`.cal-day[data-date="${Y}-07-07"]`);
  await page.click("#sheetActions button:has-text('as booked')");
  assert.equal(await page.textContent("#pencilled"), "0");
  assert.ok(await page.locator(`.cal-day.k-booked[data-date="${Y}-07-07"]`).isVisible());

  // Quick pencil from an empty day.
  await page.click(`.cal-day[data-date="${Y}-07-20"]`);
  await page.click("#sheetActions button:has-text('Pencil in this day')");
  assert.match(await page.textContent("#sheetInfo"), /pencilled in/);
  await page.click("#sheetClose");
  const statuses = await page.evaluate(() => JSON.parse(localStorage.getItem("holidaykeeper:v1")).profiles[0].holidays.map((h) => h.status));
  assert.deepEqual(statuses, ["booked", "booked", "pencilled"]);

  // Import the Google agenda text.
  await page.click("#tabList");
  await page.click("#importBox summary");
  await page.fill("#impText", readFileSync(new URL("../../tests/fixtures/google_agenda_2026.txt", import.meta.url), "utf8"));
  await page.click("#impPreview");
  assert.equal(await page.locator("#impList li").count(), 9);
  await page.click("#impCommit");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("holidaykeeper:v1")).profiles[0].holidays.length);
  assert.equal(saved, 3 + 9);

  // Share picture and link.
  await page.check("#shareIncludePencilled");
  await page.click("#makePicture");
  await page.waitForFunction(() => document.getElementById("pictureImg").naturalWidth > 0);
  assert.equal(await page.evaluate(() => document.getElementById("pictureImg").naturalWidth), 2400);
  await shot(page, "05-picture");
  await page.click("#makeLink");
  await page.waitForSelector("#link:not([hidden])");
  const url = await page.inputValue("#linkUrl");
  assert.match(url, /share\.html#z/);

  const viewer = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  viewer.on("pageerror", (e) => errors.push(`share page: ${e.message}`));
  await viewer.goto(url);
  await viewer.waitForSelector("#content:not([hidden])");
  assert.equal(await viewer.textContent("#title"), "Alex's holidays");
  assert.ok((await viewer.locator("#upcoming li").count()) >= 3);
  assert.equal(await viewer.locator(".cal-month").count(), 12);
  await shot(viewer, "06-share-page");

  // A second person keeps separate data.
  await page.selectOption("#profile", "__new");
  assert.equal(await page.locator("#profile option").count(), 3);
  assert.equal(await page.textContent("#pencilled"), "0");

  // Carry-over with decimals, for the year being viewed.
  await page.selectOption("#profile", { index: 0 });
  await page.click("#settingsBtn");
  assert.equal(await page.textContent("#sCarryYear"), String(Y));
  await page.fill("#sCarry", "0,765"); // comma decimal keypads work too
  await page.click("#settingsForm button[type=submit]");
  const before = Number(await page.textContent("#allowance"));
  assert.equal(before, 30.765);
  assert.match(await page.textContent("#carryLine"), /30 \+ 0\.765 carried over from/);
  await page.click("#prevYear");
  assert.equal(await page.textContent("#allowance"), "30");
  assert.ok(await page.locator("#carryLine").isHidden());
  await page.click("#nextYear");

  // Survives a reload.
  await page.reload();
  assert.equal(await page.locator("#profile option").count(), 3);

  assert.deepEqual(errors, []);
  console.log("e2e: all checks passed");
} finally {
  await browser.close();
  server.close();
}
