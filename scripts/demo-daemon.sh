#!/bin/sh
# Run a daemon against the seeded demo city, on a port of its own, so looking at
# the app never disturbs whatever the owner has actually got running.
set -e
cd "$(dirname "$0")/.."
ROOFSCAPE_HOME="$PWD/.scratch/demo-home"
export ROOFSCAPE_HOME
ROOFSCAPE_PORT="${ROOFSCAPE_PORT:-7788}"
export ROOFSCAPE_PORT
exec node apps/daemon/dist/main.js
