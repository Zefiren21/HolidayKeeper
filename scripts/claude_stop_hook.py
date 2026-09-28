#!/usr/bin/env python3
"""Claude Code Stop hook: run the test suites whenever Claude finishes a turn.

Runs the Python server tests and, when Node is installed, the phone app's unit tests.
If anything fails, exit code 2 hands the output back to Claude so it fixes the
problem before stopping. It only bounces once per turn to avoid an endless loop.
"""

import glob
import json
import os
import shutil
import subprocess
import sys

try:
    event = json.load(sys.stdin)
except ValueError:
    event = {}
if event.get("stop_hook_active"):
    sys.exit(0)

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
suites = [("server", [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-t", "."])]
if shutil.which("node"):
    tests = sorted(glob.glob(os.path.join(root, "app", "tests", "*.test.mjs")))
    suites.append(("phone app", ["node", "--test", *tests]))

failed = False
for name, cmd in suites:
    result = subprocess.run(cmd, cwd=root, capture_output=True, text=True, env={**os.environ, "HK_QUIET": "1"})
    if result.returncode != 0:
        failed = True
        sys.stderr.write(f"HolidayKeeper {name} tests failed — fix before finishing:\n")
        sys.stderr.write((result.stderr + result.stdout)[-4000:])
if failed:
    sys.exit(2)
