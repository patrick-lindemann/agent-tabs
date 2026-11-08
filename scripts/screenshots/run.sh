#!/bin/sh
# Takes the README screenshots in Docker: a clean VS Code with only this
# extension, demo agents instead of real ones (agents/demo.js) and an example
# workspace. Writes media/screenshots/*.png.
#   npm run screenshots
set -eu
cd "$(dirname "$0")/../.."

image=sidemates-screenshots
docker build --quiet --tag "$image" scripts/screenshots >/dev/null
mkdir -p media/screenshots
docker run --rm --shm-size=2g \
  --volume "$PWD:/work" \
  --volume sidemates-screenshots-modules:/work/node_modules \
  --volume sidemates-vscode-test:/work/.vscode-test \
  --env SHOT_VSCODE="${SHOT_VSCODE:-1.144.0}" \
  --env SHOT_WIDTH="${SHOT_WIDTH:-1440}" \
  --env SHOT_HEIGHT="${SHOT_HEIGHT:-900}" \
  --env SHOT_SCALE="${SHOT_SCALE:-2}" \
  --env SHOT_ZOOM="${SHOT_ZOOM:-0}" \
  --env SHOT_SIDEBAR="${SHOT_SIDEBAR:-640}" \
  --env SHOT_SIDEBAR_EDGE="${SHOT_SIDEBAR_EDGE:-297}" \
  --env SHOT_DIR=/work/media/screenshots \
  "$image" \
  sh -c 'npm ci --ignore-scripts --no-audit --no-fund >/dev/null \
    && npm run rebuild >/dev/null \
    && chown -R node /work/.vscode-test \
    && su node -c "xvfb-run -a -s \"-screen 0 $((SHOT_WIDTH * SHOT_SCALE))x$((SHOT_HEIGHT * SHOT_SCALE))x24\" sh scripts/screenshots/capture.sh"'
