#!/bin/bash
# Runs every test suite. Needs the app being served first:
#
#   cd .. && python3 -m http.server 8765
#   tests/run.sh
#
set -u

cd "$(dirname "$0")"
URL="${APP_URL:-http://127.0.0.1:8765/index.html}"

if ! curl -sf -o /dev/null "$URL"; then
  echo "The app is not being served at $URL"
  echo "Start it with:  cd .. && python3 -m http.server 8765"
  exit 1
fi

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at $CHROME"
  exit 1
fi

fail=0

echo "=============================================="
echo " 1/6  animation maths (no browser needed)"
echo "=============================================="
node sim.mjs || fail=1

echo
echo "=============================================="
echo " 2/6  nothing that is hidden stays on screen"
echo "=============================================="
CASES=hidden-audit.js node cdp.js || fail=1

echo
echo "=============================================="
echo " 3/6  boss battle, full motion"
echo "=============================================="
CASES=stage3-motion.js node cdp.js || fail=1

echo
echo "=============================================="
echo " 4/6  reduced motion"
echo "=============================================="
CASES=stage3-reduced-motion.js node cdp.js --reduced-motion || fail=1

echo
echo "=============================================="
echo " 5/6  phone size, dark theme"
echo "=============================================="
CASES=stage3-phone.js node cdp.js --mobile || fail=1

echo
echo "=============================================="
echo " 6/6  fight rules"
echo "=============================================="
CASES=rules.js node cdp.js || fail=1

echo
if [ "$fail" -eq 0 ]; then
  echo "ALL SUITES PASSED"
else
  echo "SOMETHING FAILED"
fi
exit "$fail"