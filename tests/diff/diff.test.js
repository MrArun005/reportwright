// Differential tests against recorded ground truth from the real JasperReports 7.0.8 and BIRT 4.25 (see
// docs/DIFF-TESTING.md). No Java needed: the cases are regenerated from the seed, imported and rendered, and their
// text compared cell by cell with what the real engine printed.
//
// A ratchet on the mismatch corpus (tests/diff/mismatches/<engine>.json, written by scripts/diff-engines.mjs):
//   - a case that matched before and now differs fails (a regression);
//   - a case in the corpus that now matches fails too, until the corpus is rewritten (so it stays accurate).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cases } from './gen.mjs';
import { pagewright, modelPages, compare, fontStore, readTruth } from './harness.mjs';

const store = fontStore();
for (const engine of ['jrxml', 'birt']) {
  const truth = readTruth(engine);
  const known = new Map(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'mismatches', `${engine}.json`), 'utf8')).map(m => [m.id, m]));
  describe(`${truth.tool}: ground truth`, () => {
    const list = cases(engine);
    it('the recorded truth is for these designs (rerun scripts/diff-engines.mjs --capture after changing gen.mjs)', () => {
      const stale = list.filter(c => truth.cases[c.id]?.hash !== c.hash).map(c => c.id);
      expect(stale).toEqual([]);
    });
    it.each(list.filter(c => truth.cases[c.id]?.pages).map(c => [c.id, c]))('%s', async (id, c) => {
      const r = await pagewright(c, store);
      const cmp = compare(truth.cases[id].pages, modelPages(r.model));
      if (known.has(id)) {
        expect(cmp.ok, `${id} now matches ${truth.tool}: rerun node scripts/diff-engines.mjs to update the mismatch corpus`).toBe(false);
        expect(cmp.bad.length, `${id}: more cells differ from ${truth.tool} than the corpus records`).toBeLessThanOrEqual(known.get(id).nBad);
      } else {
        expect(cmp.bad.slice(0, 5), `${id} no longer matches ${truth.tool}`).toEqual([]);
        expect(cmp.pages, `${id}: the same cells, but on different pages`).toBe(true);
      }
    });
  });
}
