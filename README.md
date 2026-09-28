# HolidayKeeper

A holiday tracker for your phone: yearly allowance, bank holidays, mandatory days off,
pencilled-in plans, a tap-through calendar, and shareable calendar pictures.

There are two versions:

- **Phone app (`app/`)** — the main one. Install it from the web onto your iPhone's home
  screen. Everything runs and is saved on the phone. No laptop or server is needed.
- **Laptop version (`server.py`)** — the original. It runs on your computer and phones on
  the same Wi-Fi use it, with logins and live sharing between accounts. It's described
  further down.

## Phone app

**Install on iPhone:**

1. Open **https://zefiren21.github.io/HolidayKeeper/** in Safari.
2. Tap **Share → Add to Home Screen**.
3. Open it from the new icon. It works offline.

Add holidays in the installed app, not in Safari: iOS keeps their data separate.

**Features:**

- **Allowance.** Set it in Settings. The summary shows days taken, booked and left.
  Only your working days count, and half days count as 0.5.
- **Carry-over.** In Settings, enter the days carried into the year you're viewing.
  Decimals are fine, e.g. 0.765. Tap "Use what was left in 2025" to fill it in from
  last year. It's added to that year only, and the summary shows "Allowance 30 +
  0.765 carried over". Change years with ‹ › to set other years.
- **Pencilled-in holidays.** Choose *Pencilled in* when adding a holiday, or tap a day
  and pick **✎ Pencil in this day**. These plans don't touch your real numbers. The
  summary shows "X left if you take your pencilled-in days". Tap **Book it** once your
  job approves.
- **Calendar view.** Switch **List / Calendar**. You get the whole year with colour
  coding:
  - Taken, booked, pencilled in, mandatory and bank holidays each have their own colour.
  - Weekends are grey, and today is outlined.
  - Tap a month to zoom in, or tap a day to see what's on it and add, pencil in, book
    or delete from there.
- **Mandatory days and bank holidays.** These work as in the laptop version: mandatory
  days are customisable, and bank holidays for England & Wales, Scotland or Northern
  Ireland are offered with **+ Book** or **✎**.
- **Several people on one phone.** Use the name menu at the top (e.g. you and your
  wife). Each person has their own allowance and settings.
- **Share.**
  - **Calendar picture:** a whole-year image with the same colour coding, sent through
    the share sheet (WhatsApp, Messages) or saved to Photos.
  - **Share link:** a read-only page with the calendar. Your dates are packed into the
    link itself, so it works anywhere with no server. It's a snapshot and doesn't
    update, and it never includes notes.
  - **Options:** you choose whether pencilled-in holidays and days left are included.
- **Import** from Google Calendar text or an `.ics` file.
  - **Quickest route:** on a computer, search your name in Google Calendar, then copy the
    results and paste them in.
  - **Automatic sync isn't possible:** the phone app can't sync a calendar link directly,
    because Google blocks that from web pages.
- **Backup.** Everything is stored on the phone. Use **Save backup** now and then (to
  Files or iCloud Drive), and **Restore backup** on a new phone.

**Try it on a computer:** run `node app/tests/serve.mjs`, then open http://localhost:8090/.

**Publishing:** pushes to `main` are published by `.github/workflows/phone-app.yml`.
One-time setup is needed: in the repo, go to **Settings → Pages → Build and deployment →
Source: GitHub Actions**. GitHub Pages needs the repository to be public, or a paid plan.

## Laptop version

### Windows: just download and run

1. Download **HolidayKeeper.exe** from the
   [latest release](https://github.com/Zefiren21/HolidayKeeper/releases/latest).
   Every build is also attached to its run under **Actions → Windows build → Artifacts**.
2. Put it in a folder of its own (e.g. `Documents\HolidayKeeper`). Your data
   (`holidaykeeper.db`) is saved next to it.
3. Double-click it. A window shows the address for your phone and your browser opens the
   app. Close the window to stop it.

First run notes:

- **SmartScreen:** "Windows protected your PC" appears because the app isn't code-signed.
  Click **More info → Run anyway**.
- **Firewall:** when Windows asks, allow access on **Private networks** so your phone
  can connect.

To build the exe yourself on Windows: `pip install pyinstaller` then `pyinstaller HolidayKeeper.spec`.
The file appears in `dist\`.

### Run from source (any OS)

No dependencies — just Python 3.8+.

```sh
python3 server.py            # or: python3 server.py --port 8080 --data ~/holidaykeeper-data
```

It prints two URLs:

```
  Laptop: http://localhost:8000
  Phone:  http://192.168.1.23:8000   (same Wi-Fi)
```

Open the **Phone** URL on your phone and tap **Create account**. Each person creates
their own account. Tip: "Add to Home Screen" gives you an app icon.

Data lives in `holidaykeeper.db` (SQLite) next to `server.py`. If you used the earlier
version, its `holidays.json` is moved into the first account created.

### Features

- **Logins** — separate holidays and settings per person.
- **Yearly allowance** — set in Settings (e.g. 30 days). The summary shows days taken,
  booked and left for the selected year. Only your working days count, and half days
  count as 0.5.
- **Working days** — choose which days of the week you work (e.g. Wed–Sat).
- **Mandatory days off** — 1 Jan, 25 Dec and 26 Dec by default. Add or remove days
  in Settings. They appear automatically every year. You choose whether they come out
  of your allowance.
- **UK bank holidays** — worked out for England & Wales, Scotland or Northern Ireland,
  including weekend substitute days. They are *not* added automatically: tap **+ Add**
  on the ones your job makes you book. If your job gives them all off, tick "My job
  gives bank holidays off" and they won't be deducted.
- **Import from Google Calendar**
  - **File or pasted text:** Google Calendar's agenda view copied as text (e.g.
    `9 / Jan 2026, Fri / All day / Name (Day 1/4)`), or an `.ics` export.
  - **Google link:** paste the calendar's *Secret address in iCal format* in Settings
    (Google Calendar → Settings → the calendar → Integrate calendar), then tap
    **Sync Google link**.
  - **Filtering:** only events containing your name are picked up. Consecutive days
    are merged into one holiday, and "½ day" / "half day AM|PM" events become half days.
  - **Review first:** you see a preview before anything is saved. Holidays you already
    have are unticked.

### Sharing

Open the **Sharing** section:

- **With someone who has an account here:** type their username and tap **Share**.
  They get a "Showing" picker at the top to switch to your holidays. It's read-only:
  they see your dates and allowance, but not your notes. Sharing is one-way, so they
  need to share back for you to see theirs. Tap × to stop sharing.
- **With a link:** tap **Create a share link**, then **Copy**, **Text** or **WhatsApp**
  it. Anyone who opens it sees your holiday dates for this year onwards. No login is
  needed, and it shows no notes or allowance. **Turn off** disables the link.
- **Links only work locally:** they point at your laptop, so they only open on the same
  Wi-Fi while HolidayKeeper is running. For friends outside your home, use something
  like Tailscale.

## Tests

```sh
node --test app/tests/*.test.mjs           # phone app logic
node app/tests/e2e.mjs                     # phone app in a real browser (needs Playwright)
python3 -m unittest discover -s tests -t . # laptop server
```

- **Phone app:** unit tests cover the bank holiday rules, allowance and pencilled-in
  maths, the calendar colours, the importers, share links and storage. The browser test
  drives the app at iPhone size: adding holidays, the calendar views, the day panel,
  importing, pictures, share links, and switching people. CI runs both
  (`.github/workflows/phone-app.yml`) and keeps screenshots as an artifact.
- **Laptop version:** tests cover the same rules plus the full HTTP API, and start a
  real server.
- **GitHub Actions:** runs them on every push (`.github/workflows/tests.yml`). The
  Windows build (`.github/workflows/windows-build.yml`) also runs them on Windows,
  builds the exe and checks that it starts.
- **Claude Code:** a Stop hook in `.claude/settings.json` runs them at the end of every
  turn and sends any failures back to Claude to fix.

### Laptop version: can't connect from your phone?

- Make sure the phone and laptop are on the **same Wi-Fi** (not guest network, not mobile data).
- **Firewall:** allow incoming connections for Python when prompted.
  - macOS: System Settings → Network → Firewall → Options → allow `python3`.
  - Windows: accept the "Windows Defender Firewall" prompt and tick **Private networks**.
- If the printed IP looks wrong, find it manually: `ipconfig getifaddr en0` (macOS),
  `ipconfig` (Windows), or `hostname -I` (Linux).

Logins are sent over plain HTTP on your home network, and anyone on the Wi-Fi can
create an account. Fine for home use; don't expose it to the internet or run it on
public Wi-Fi.
