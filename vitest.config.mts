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
      reporter: ['text-summary', 'html', 'lcov'],
      // Tab status decides what users act on, so it must stay tested
      thresholds: {
        'src/terminal/{signals,status,state,tabs,prompt}.ts': { lines: 90, branches: 85 },
        'src/profiles.ts': { lines: 90, branches: 90 }
      }
    }
  }
});
