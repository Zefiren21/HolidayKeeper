#!/usr/bin/env python3
"""Claude Code Stop hook: run the test suite whenever Claude finishes a turn.

If tests fail, exit code 2 hands the failure output back to Claude so it fixes the
problem before stopping. It only bounces once per turn to avoid an endless loop.
"""

import json
import os
import subprocess
import sys

try:
    event = json.load(sys.stdin)
except ValueError:
    event = {}
if event.get("stop_hook_active"):
    sys.exit(0)

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
result = subprocess.run(
    [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-t", "."],
    cwd=root, capture_output=True, text=True, env={**os.environ, "HK_QUIET": "1"},
)
if result.returncode != 0:
    sys.stderr.write("HolidayKeeper tests failed — fix before finishing:\n")
    sys.stderr.write(result.stderr[-4000:])
    sys.exit(2)
