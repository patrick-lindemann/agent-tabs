#!/bin/sh
# Publishes platform packages to the VS Code Marketplace one at a time:
#   scripts/publish.sh [--pre-release] <package.vsix>...
#
# The Marketplace validates a package for a few minutes after the upload and
# silently drops uploads of other platforms in the meantime, at least for a
# new extension. So each package is published only after the previous one is
# listed, and packages already listed are skipped, which makes a failed run
# safe to repeat. Uses trusted publishing (--oidc), so it only works in the
# release workflow.
set -eu

pre_release=""
if [ "${1:-}" = "--pre-release" ]; then
  pre_release="--pre-release"
  shift
fi

publisher=$(node -p "require('./package.json').publisher")
name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")

# Whether the Marketplace lists this version for a platform
listed() {
  curl -fsS -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json;api-version=7.2-preview.1' \
    -d "{\"filters\":[{\"criteria\":[{\"filterType\":7,\"value\":\"$publisher.$name\"}]}],\"flags\":3}" |
    jq -e --arg version "$version" --arg target "$1" \
      '[.results[0].extensions[0].versions // [] | .[] | select(.version == $version and .targetPlatform == $target)] | length > 0' \
      >/dev/null
}

for package in "$@"; do
  # agent-tabs-linux-x64-2.0.0.vsix -> linux-x64
  target=$(basename "$package" .vsix | sed "s/^$name-//; s/-$version\$//")
  if listed "$target"; then
    echo "$target: already listed, skipping"
    continue
  fi
  echo "$target: publishing $package"
  npx vsce publish --oidc --skip-duplicate --packagePath "$package" $pre_release

  # Wait up to 30 minutes for the Marketplace to list it
  for _ in $(seq 1 60); do
    if listed "$target"; then
      echo "$target: listed"
      break
    fi
    sleep 30
  done
  if ! listed "$target"; then
    echo "$target: not listed 30 minutes after publishing" >&2
    exit 1
  fi
done
