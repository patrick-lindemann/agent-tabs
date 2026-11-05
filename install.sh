#!/bin/sh
# Installs or updates Agent Terminal from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/patrick-lindemann/agent-terminal/main/install.sh | sh
#
# Run it in a VS Code terminal: on a remote connection, `code` there installs
# into the remote's VS Code server. Set CODE to use another CLI (e.g. cursor).
set -eu

repo="patrick-lindemann/agent-terminal"
code_cli="${CODE:-code}"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  MINGW* | MSYS* | CYGWIN*) os=win32 ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

target="$os-$arch"

if ! command -v "$code_cli" >/dev/null 2>&1; then
  echo "'$code_cli' not found. Run this in a VS Code terminal or set CODE." >&2
  exit 1
fi

url=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" |
  grep -o "\"browser_download_url\": *\"[^\"]*agent-terminal-$target-[^\"]*\.vsix\"" |
  sed 's/.*"\(https[^"]*\)"$/\1/' |
  head -n 1)

if [ -z "$url" ]; then
  echo "No $target build in the latest release of $repo." >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
file="$tmp/${url##*/}"

echo "Downloading ${url##*/}"
curl -fsSL -o "$file" "$url"
"$code_cli" --install-extension "$file" --force
echo "Done. Run 'Developer: Reload Window' in VS Code."
