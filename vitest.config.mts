import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'media/**/*.ts'],
      exclude: ['**/*.d.ts', 'media/main.js'],
      // html for browsing, lcov for editor gutters, text for the terminal
      reporter: ['text-summary', 'html', 'lcov']
    }
  }
});
