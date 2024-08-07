import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/fixtures/**'],
    environment: 'node',
    globals: true,
    pool: 'threads',
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
    },
    //setupFiles: ['./tests/vitest.setup.ts'],
  },
});
