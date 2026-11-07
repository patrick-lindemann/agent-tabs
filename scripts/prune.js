const fs = require('node:fs');
const path = require('node:path');

const target = process.argv[2];
if (!target) throw new Error('Usage: node scripts/prune.js <target>');

const prebuilds = path.join('node_modules', 'node-pty', 'prebuilds');
if (fs.existsSync(prebuilds)) {
  for (const entry of fs.readdirSync(prebuilds)) {
    if (entry !== target) fs.rmSync(path.join(prebuilds, entry), { recursive: true, force: true });
  }
}

// Electron rebuild leaves only the current platform's native artifacts in this
// directory. Keep those artifacts and let .vscodeignore filter their contents.
