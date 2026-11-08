const { execFileSync } = require('node:child_process');
const { config } = require('../package.json');

const command = process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild';
execFileSync(command, ['--version', config.electronVersion, ...process.argv.slice(2)], {
  stdio: 'inherit'
});
