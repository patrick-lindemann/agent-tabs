#!/bin/sh
# Runs inside the screenshot container (see run.sh): packages SideMates,
# installs it with the driver into a clean VS Code and starts it on the
# virtual display.
set -eu
here=/work/scripts/screenshots
data=/tmp/vscode
rm -rf "$data" /tmp/sidemates.vsix /tmp/driver.vsix
mkdir -p "$data/user/User" "$data/extensions"

npx vsce package --out /tmp/sidemates.vsix >/dev/null
(cd "$here/driver" && npx vsce package --allow-missing-repository --skip-license \
  --out /tmp/driver.vsix >/dev/null)
vscode=$(node -e "require('@vscode/test-electron').downloadAndUnzipVSCode('$SHOT_VSCODE').then(console.log)" | tail -1)
cli=$(dirname "$vscode")/bin/code
for extension in /tmp/sidemates.vsix /tmp/driver.vsix; do
  "$cli" --user-data-dir "$data/user" --extensions-dir "$data/extensions" \
    --install-extension "$extension" >/dev/null
done

export PATH="$here/agents:$PATH" SIDEMATES_DEMO_PI=blocked
cat > "$data/user/User/settings.json" <<EOF
{
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.layoutControl.enabled": false,
  "workbench.secondarySideBar.defaultVisibility": "visible",
  "window.zoomLevel": ${SHOT_ZOOM},
  "window.commandCenter": true,
  "window.title": "\${rootName}",
  "window.restoreWindows": "none",
  "chat.disableAIFeatures": true,
  "editor.fontFamily": "'JetBrains Mono', monospace",
  "editor.fontSize": 13,
  "editor.minimap.enabled": false,
  "editor.stickyScroll.enabled": false,
  "typescript.validate.enable": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.ignoreRecommendations": true,
  "extensions.autoCheckUpdates": false,
  "security.workspace.trust.enabled": false,
  "git.enabled": false,
  "sideMates.confirmClose": false,
  "sideMates.env": { "PATH": "$PATH" }
}
EOF

"$vscode" "$here/api-server" --force-device-scale-factor="$SHOT_SCALE" \
  --user-data-dir "$data/user" --extensions-dir "$data/extensions" \
  --disable-gpu --no-sandbox --skip-welcome --skip-release-notes --wait \
  >/dev/null 2>&1
ls "$SHOT_DIR"
