#!/bin/sh
# Publishes platform packages to the VS Code Marketplace:
#   scripts/publish.sh [--pre-release] <package.vsix>...
#
# Uploads every package that is not listed yet at once and waits until the
# Marketplace lists them. While it validates one package, the Marketplace may
# silently drop uploads of other platforms (seen for a new extension). So when
# the listed platforms stop changing before all are listed, the rest is
# published one at a time, each after the previous one is listed. Packages
# already listed are skipped, which makes a failed run safe to repeat. Uses
# trusted publishing (--oidc), so it only works in the release workflow.
set -eu

pre_release=""
if [ "${1:-}" = "--pre-release" ]; then
  pre_release="--pre-release"
  shift
fi

publisher=$(node -p "require('./package.json').publisher")
name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")

# Platforms the Marketplace lists for this version, one per line
listed_targets() {
  curl -fsS -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json;api-version=7.2-preview.1' \
    -d "{\"filters\":[{\"criteria\":[{\"filterType\":7,\"value\":\"$publisher.$name\"}]}],\"flags\":3}" |
    jq -r --arg version "$version" \
      '.results[0].extensions[0].versions // [] | .[] | select(.version == $version) | .targetPlatform' |
    sort
}

# agent-tabs-linux-x64-2.0.0.vsix -> linux-x64
target_of() {
  basename "$1" .vsix | sed "s/^$name-//; s/-$version\$//"
}

# The given packages whose platform is not listed yet, one per line
missing_packages() {
  listed=$(listed_targets)
  for package in "$@"; do
    if ! printf '%s\n' "$listed" | grep -qx "$(target_of "$package")"; then
      printf '%s\n' "$package"
    fi
  done
}

publish() {
  echo "$(target_of "$1"): publishing $1"
  npx vsce publish --oidc --skip-duplicate --packagePath "$1" $pre_release
}

# All at once
missing=$(missing_packages "$@")
if [ -z "$missing" ]; then
  echo "All platforms are listed"
  exit 0
fi
for package in $missing; do
  publish "$package"
done

# Wait until all are listed, or until the listed platforms have not changed
# for 5 minutes after the first one appeared (at most 30 minutes)
previous=$(listed_targets)
unchanged=0
for _ in $(seq 1 60); do
  sleep 30
  if [ -z "$(missing_packages $missing)" ]; then
    echo "All platforms are listed"
    exit 0
  fi
  current=$(listed_targets)
  if [ "$current" = "$previous" ]; then
    unchanged=$((unchanged + 1))
  else
    unchanged=0
    previous=$current
  fi
  if [ -n "$current" ] && [ "$unchanged" -ge 10 ]; then
    break
  fi
done

# The Marketplace dropped some uploads: publish the rest one at a time
for package in $(missing_packages $missing); do
  publish "$package"
  for _ in $(seq 1 60); do
    if [ -z "$(missing_packages "$package")" ]; then
      echo "$(target_of "$package"): listed"
      break
    fi
    sleep 30
  done
  if [ -n "$(missing_packages "$package")" ]; then
    echo "$(target_of "$package"): not listed 30 minutes after publishing" >&2
    exit 1
  fi
done
echo "All platforms are listed"
