// Helper extension in the screenshot VS Code: arranges the window, opens
// SideMates tabs with the demo agents and captures the virtual display.
// Installed only in the screenshot container, next to the packaged SideMates.
const { execSync } = require('node:child_process');
const path = require('node:path');
const vscode = require('vscode');

const env = process.env;
// Sizes are in CSS pixels; the display has SHOT_SCALE device pixels per pixel
const scale = Number(env.SHOT_SCALE);
const width = Number(env.SHOT_WIDTH);
const height = Number(env.SHOT_HEIGHT);
const px = (value) => Math.round(value * scale);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command) => execSync(command, { stdio: 'inherit' });
/** Captures a region given in CSS pixels, the whole window by default */
const shot = (name, x = 0, y = 0, w = width, h = height) =>
  run(
    `import -window root -crop ${px(w)}x${px(h)}+${px(x)}+${px(y)} +repage ` +
      path.join(env.SHOT_DIR, `${name}.png`)
  );
const sideMates = () => vscode.workspace.getConfiguration('sideMates');

const PROFILES = {
  'Claude Code': 'claude',
  Codex: 'codex',
  Pi: 'pi',
  'Gemini CLI': 'gemini',
  OpenCode: 'opencode',
  'GitHub Copilot': 'copilot'
};

/**
 * + opens the first profile. VS Code does not count reordering a setting's
 * keys as a change, so each tab gets a profile list of its agent alone.
 */
async function openTab(name) {
  await sideMates().update(
    'profiles',
    { [name]: PROFILES[name] },
    vscode.ConfigurationTarget.Global
  );
  await sleep(300);
  await vscode.commands.executeCommand('sideMates.newTab');
  await sleep(1200);
}

async function capture() {
  run(
    'xdotool search --sync --onlyvisible --class code | head -1 | ' +
      `xargs -I{} xdotool windowmove {} 0 0 windowsize {} ${px(width)} ${px(height)}`
  );
  await sleep(1500);

  const root = vscode.workspace.workspaceFolders[0].uri;
  const file = vscode.Uri.joinPath(root, 'src', 'middleware', 'rateLimit.ts');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), {
    preview: false
  });
  // The editor and SideMates side by side, without the explorer
  await vscode.commands.executeCommand('workbench.action.closeSidebar');

  await sideMates().update(
    'profiles',
    { 'Claude Code': 'claude' },
    vscode.ConfigurationTarget.Global
  );
  await vscode.commands.executeCommand('sideMates.terminalView.focus');
  await sleep(2500);
  // The view opened the first profile, Claude Code
  for (const name of ['Codex', 'Pi', 'Gemini CLI']) {
    await openTab(name);
  }
  await sideMates().update('profiles', PROFILES, vscode.ConfigurationTarget.Global);

  // Drag the secondary sidebar's edge (SHOT_SIDEBAR_EDGE px from the right
  // by default) so tab names and agent output fit
  const sidebar = Number(env.SHOT_SIDEBAR);
  const edge = px(width - Number(env.SHOT_SIDEBAR_EDGE));
  const target = px(width - sidebar);
  const y = px(height / 2);
  run(
    `xdotool mousemove ${edge} ${y} sleep 0.3 mousedown 1 sleep 0.3 ` +
      `mousemove ${edge - 40} ${y} sleep 0.3 mousemove ${target} ${y} sleep 0.3 mouseup 1`
  );
  await sleep(500);

  await vscode.commands.executeCommand('sideMates.switchToTabAt', 1);
  // Codex finishes in the background meanwhile (SIDEMATES_DEMO_DELAY)
  await sleep(Number(env.SHOT_SETTLE ?? 8000));
  run(`xdotool mousemove ${px(width / 2)} ${px(height - 60)}`);
  await sleep(300);
  shot('overview');

  // Close-up of the tabs, with Pi's question in view
  await vscode.commands.executeCommand('sideMates.switchToTabAt', 3);
  await sleep(1500);
  shot('tabs', width - sidebar - 4, 40, sidebar + 4, Math.min(440, height - 40));

  void vscode.commands.executeCommand('sideMates.newTabWithProfile');
  await sleep(1500);
  shot('profiles', 400, 0, 640, 250);
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
}

exports.activate = () => {
  if (!env.SHOT_DIR) return;
  capture()
    .catch((error) => console.error('screenshot driver:', error))
    .finally(() => vscode.commands.executeCommand('workbench.action.quit'));
};
