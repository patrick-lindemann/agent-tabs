#!/bin/sh
# Runs the integration tests in Docker on a virtual display, so the test
# VS Code does not open a window or take focus. node_modules and the
# downloaded VS Code live in Docker volumes, apart from the host's
# platform-specific ones.
set -eu
cd "$(dirname "$0")/.."

image=sidemates-integration
docker build --quiet --tag "$image" test/integration >/dev/null
docker run --rm \
  --volume "$PWD:/work" \
  --volume sidemates-node-modules:/work/node_modules \
  --volume sidemates-vscode-test:/work/.vscode-test \
  --volume sidemates-out:/work/out \
  "$image" \
  sh -c 'npm ci --ignore-scripts --no-audit --no-fund >/dev/null && xvfb-run -a npm run test:integration:visible'
