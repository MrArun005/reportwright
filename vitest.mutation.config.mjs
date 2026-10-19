// The tests Stryker runs against each mutant (stryker.config.mjs): the engine suite, without the timing- and
// worker-dependent files (b1-batch-roundtrips, b5-pool), the ones that need a database, and the ones that build the npm
// packages first (in Stryker's sandbox the build cannot read node_modules; they test packaging, not these two files),
// and r5-fixes, which counts spreads in the source (the instrumented copy has more).
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    include: ['tests/engine/**/*.test.js'],
    exclude: [
      'tests/engine/b1-batch-roundtrips.test.js',
      'tests/engine/b5-pool.test.js',
      'tests/engine/storage.test.js',
      'tests/engine/perms.test.js',
      'tests/engine/audit.test.js',
      ...['b10-bundle-size', 'b10-perf-lazy', 'b11-fonts-n43', 'b5-schema', 'b5-xlsx-writer', 'b6g-types', 'compile-cache-dir', 'packages', 'r5-fixes'].map((f) => `tests/engine/${f}.test.js`),
      '**/node_modules/**',
    ],
    testTimeout: 20000,
  },
});
