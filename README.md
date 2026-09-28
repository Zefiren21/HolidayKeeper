# HolidayKeeper

A holiday tracker you run on your laptop and open from your phone over the same Wi-Fi.
Everyone in the house gets their own login, allowance and settings.

## Windows: just download and run

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

## Run from source (any OS)

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

## Features

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

## Sharing

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
python3 -m unittest discover -s tests -t .
```

- **What's covered:** the bank holiday rules, the allowance maths, the calendar
  importers, and the full HTTP API. The API tests start a real server.
- **GitHub Actions:** runs them on every push (`.github/workflows/tests.yml`). The
  Windows build (`.github/workflows/windows-build.yml`) also runs them on Windows,
  builds the exe and checks that it starts.
- **Claude Code:** a Stop hook in `.claude/settings.json` runs them at the end of every
  turn and sends any failures back to Claude to fix.

## Can't connect from your phone?

- Make sure the phone and laptop are on the **same Wi-Fi** (not guest network, not mobile data).
- **Firewall:** allow incoming connections for Python when prompted.
  - macOS: System Settings → Network → Firewall → Options → allow `python3`.
  - Windows: accept the "Windows Defender Firewall" prompt and tick **Private networks**.
- If the printed IP looks wrong, find it manually: `ipconfig getifaddr en0` (macOS),
  `ipconfig` (Windows), or `hostname -I` (Linux).

Logins are sent over plain HTTP on your home network, and anyone on the Wi-Fi can
create an account. Fine for home use; don't expose it to the internet or run it on
public Wi-Fi.
