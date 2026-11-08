// Rebuilds node-pty for the Electron version of the targeted VS Code
// (`config.electronVersion` in package.json). Runs electron-rebuild's script
// with Node, because Node refuses to start the `.cmd` shim on Windows.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { config } = require('../package.json');

// The package exports only its API, so find the CLI next to it
const cli = path.join(path.dirname(require.resolve('@electron/rebuild')), 'cli.js');
execFileSync(
  process.execPath,
  [cli, '--version', config.electronVersion, ...process.argv.slice(2)],
  { stdio: 'inherit' }
);
