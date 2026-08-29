#!/bin/sh
# Photograph the whole app in one go, so a change can be judged the way anybody
# using it would judge it — by looking at every screen, not just the pretty one.
#
#     sh scripts/shots.sh <tag>            # writes .scratch/shots/<tag>-*.png
#
# Wants a daemon on $PORT serving the seeded demo city:
#     node scripts/seed-demo.mjs && sh scripts/demo-daemon.sh &
set -e
cd "$(dirname "$0")/.."

TAG="${1:-now}"
PORT="${ROOFSCAPE_PORT:-7788}"
HOME_DIR="$PWD/.scratch/demo-home"
TOKEN=$(cat "$HOME_DIR/daemon.token" 2>/dev/null || true)
URL="http://127.0.0.1:$PORT/?token=$TOKEN"
OUT="$PWD/.scratch/shots"
E="node_modules/.bin/electron"
S="scripts/shoot.cjs"

mkdir -p "$OUT"

if [ -z "$TOKEN" ]; then
  echo "no token at $HOME_DIR/daemon.token — seed and start the demo daemon first" >&2
  exit 1
fi

# The city, which is the home screen and the thing most worth getting right.
"$E" "$S" "$URL" "$OUT/$TAG-city.png" 1600 1050 2600

# Inside a building: staff, and the shape of the place.
"$E" "$S" "$URL" "$OUT/$TAG-building.png" 1600 1050 2200 \
  'document.querySelector("[data-building]")?.dispatchEvent(new MouseEvent("click",{bubbles:true}))'

# The approval desk, which is the one screen that is about the owner.
"$E" "$S" "$URL" "$OUT/$TAG-desk.png" 1600 1050 2200 \
  'document.querySelectorAll("[data-building]")[1]?.dispatchEvent(new MouseEvent("click",{bubbles:true})); setTimeout(function(){document.querySelector("[data-tab=desk]")?.click()},1100)'

# Work in hand, which is where somebody watches a goal being done.
"$E" "$S" "$URL" "$OUT/$TAG-work.png" 1600 1050 2200 \
  'document.querySelector("[data-building]")?.dispatchEvent(new MouseEvent("click",{bubbles:true})); setTimeout(function(){document.querySelector("[data-tab=work]")?.click()},1100)'

# A narrow window, because a layout that only works wide is not finished.
"$E" "$S" "$URL" "$OUT/$TAG-narrow.png" 620 1000 2600

# The drawing on its own, every form and the variety within a form.
node scripts/city-preview.mjs "$PWD/.scratch/city-$TAG.html" >/dev/null
"$E" "$S" "$PWD/.scratch/city-$TAG.html" "$OUT/$TAG-drawing.png" 1600 1400 1400

echo "wrote:"
ls -1 "$OUT" | grep "^$TAG-" | sed 's/^/  .scratch\/shots\//'
