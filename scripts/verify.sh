#!/bin/sh
# Everything that has to be true before a change to this app is believed.
#
#     sh scripts/verify.sh [tag]
#
# Typechecks each package separately — the root tsconfig has `files: []` and
# references only, so `tsc --noEmit -p tsconfig.json` there checks nothing at all
# and exits 0. That false pass is worth knowing about: it is exactly the kind of
# green that hides a broken tree.
set -e
cd "$(dirname "$0")/.."

TAG="${1:-after}"

echo "== typecheck (per package: the root one is a no-op) =="
npx tsc --noEmit -p packages/core/tsconfig.json
npx tsc --noEmit -p apps/daemon/tsconfig.json
npx tsc --noEmit -p apps/cli/tsconfig.json
echo "   clean"

echo
echo "== build =="
npm run build >/dev/null
echo "   built"

echo
echo "== tests =="
npm test 2>&1 | tail -8

echo
echo "== the app, photographed =="
node scripts/seed-demo.mjs .scratch/demo-home >/dev/null
# Restart the daemon so it serves the freshly built core rather than the one it
# loaded at boot.
pkill -f "apps/daemon/dist/main.js" 2>/dev/null || true
sh scripts/demo-daemon.sh >.scratch/daemon.log 2>&1 &
sleep 4
sh scripts/shots.sh "$TAG"
