import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { include: ['tests/engine/**/*.test.js', 'tests/golden/**/*.test.js', 'tests/diff/**/*.test.js', 'tests/pdf/**/*.test.js'], testTimeout: 20000 },
});
