// BIRT import: a bound column's aggregate (SUM, COUNT, …) is computed over the bound expression, not over a row count.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { importBirt } from '../../src/importers/birt.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts } from '../helpers.js';

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'birt', 'sum-total.rptdesign');
const SRC = fs.readFileSync(FIXTURE, 'utf8');
const rows = [{ REGION: 'North', AMOUNT: 100.5 }, { REGION: 'North', AMOUNT: 100.25 }, { REGION: 'South', AMOUNT: 50 }];
const footerCell = (r) => r.definition.sections.body.items.find(i => i.type === 'table').footer[0].cells[1];

describe('BIRT aggregates', () => {
  it('a SUM bound column totals its expression (250.75), not the row count', async () => {
    const r = importBirt(SRC, { name: 'Sales' });
    expect(r.error).toBeUndefined();
    expect(footerCell(r).value).toMatch(/^=Sum\(Fields\.AMOUNT, /);
    const out = await render(r.definition, { fontStore, sources: { 'Sales DB': rows } });
    const all = out.pages.flatMap(texts);
    expect(all).toContain('250.75');
    expect(all).not.toContain('3.00');
  });
  it('an aggregate with no mapping is counted as approximated, never as a row count', () => {
    const r = importBirt(SRC.replace('>SUM<', '>MEDIAN<'), { name: 'Sales' });
    expect(footerCell(r).value).not.toMatch(/Sum\(1/);
    expect(r.stats.approximated).toBeGreaterThan(0);
    expect(r.warnings.join('\n')).toMatch(/MEDIAN/);
  });
});
