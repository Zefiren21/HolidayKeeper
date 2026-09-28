# HolidayKeeper

- The phone app in `app/` (plain JavaScript web app, published to GitHub Pages) is the main
  app. New features and fixes go there.
- The Python laptop version (`server.py`, `holidaykeeper/`, `static/`, Windows build) is
  frozen: don't change it unless the owner explicitly asks. Its tests must keep passing.
- Tests: `node --test app/tests/*.test.mjs` and the browser test `node app/tests/e2e.mjs`.
