import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  extensionDevelopmentPath: new URL('.', import.meta.url).pathname,
  version: '1.106.0',
  mocha: { timeout: 20000 }
});
// These tests only exercise activation and commands; they do not spawn node-pty.
// This keeps them independent of the Electron version used by the downloaded VS Code.
