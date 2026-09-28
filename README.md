# HolidayKeeper

A tiny holiday tracker you run on your laptop and open from your phone over the same Wi-Fi.
Add trips with dates and a note; it counts down the days to each one.

No dependencies — just Python 3.8+.

## Run it

```sh
python3 server.py            # or: python3 server.py --port 8080
```

It prints two URLs:

```
  Laptop: http://localhost:8000
  Phone:  http://192.168.1.23:8000   (same Wi-Fi)
```

Open the **Phone** URL in your phone's browser. Tip: use "Add to Home Screen" to get an app icon.

Data is saved to `holidays.json` next to `server.py`.

## Can't connect from your phone?

- Make sure the phone and laptop are on the **same Wi-Fi** (not guest network, not mobile data).
- **Firewall:** allow incoming connections for Python when prompted.
  - macOS: System Settings → Network → Firewall → Options → allow `python3`.
  - Windows: accept the "Windows Defender Firewall" prompt and tick **Private networks**.
- If the printed IP looks wrong, find it manually: `ipconfig getifaddr en0` (macOS),
  `ipconfig` (Windows), or `hostname -I` (Linux).

This has no login, so anyone on your network can view and edit it — fine for home Wi-Fi,
don't run it on public networks.
