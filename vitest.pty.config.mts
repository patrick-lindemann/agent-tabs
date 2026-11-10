import { defineConfig } from 'vitest/config';

// Starts real processes through node-pty's native module; see test/pty
export default defineConfig({
  test: {
    include: ['test/pty/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000
  }
});
