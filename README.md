# HolidayKeeper

A holiday tracker you run on your laptop and open from your phone over the same Wi-Fi.
Everyone in the house gets their own login, allowance and settings.

No dependencies — just Python 3.8+.

## Run it

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

## Tests

```sh
python3 -m unittest discover -s tests -t .
```

- **What's covered:** the bank holiday rules, the allowance maths, the calendar
  importers, and the full HTTP API. The API tests start a real server.
- **GitHub Actions:** runs them on every push (`.github/workflows/tests.yml`).
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
