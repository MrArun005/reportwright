// The tests Stryker runs against each mutant (stryker.config.mjs): the engine test files that import the mutated
// files (the designer store, the schema validator) or the designer modules built on them, so a mutant is judged by
// the tests written for that code. Left out: the files that build the npm packages first (in Stryker's sandbox the
// build cannot read node_modules), measure memory or spawn processes (they test packaging and resources, not these
// two files).
import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, 'tests/engine');
const TARGETS = /designer\/(store|issues|importFile)\.js|schema\/validate\.js/;
const OUT = new Set([
  'b5-schema',
  'b6g-types',
  'b7c-docs',
  'b5-docs',
  'fetch-guard-cli',
  'b11-mem-designer-cascade',
  'b11-mem-silent6-tall',
  'b11-worker-schema',
  'r2-a5',
  'r4-fixes',
  'b11-silent-errors',
]);
const include = fs
  .readdirSync(dir)
  .filter(
    (f) =>
      f.endsWith('.test.js') &&
      !OUT.has(f.replace(/\.test\.js$/, '')) &&
      TARGETS.test(fs.readFileSync(path.join(dir, f), 'utf8')),
  )
  .map((f) => `tests/engine/${f}`);

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { include, testTimeout: 20000 },
});
