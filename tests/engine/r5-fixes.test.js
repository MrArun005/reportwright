// R5: fixes from the external tester's list (one describe per issue).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mergedRegions } from '../../src/exporters/regions.js';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(m?js|jsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
// an array spread into a call: Math.max(...xs), out.push(...xs), String.fromCharCode(...bytes). Past ~100k elements
// V8 throws "Maximum call stack size exceeded" (the table wizard preview at 100k rows).
const SPREAD_CALL = /(Math\.(?:max|min)|\.(?:push|unshift)|fromCharCode)\(([^(){}]*,\s*)?\.\.\.(?!\s*\{)/g;

describe('R5 #3: no array spread into a call on data-sized arrays', () => {
  it('the data-sized paths have none, and the rest only ratchet down', () => {
    const hits = {};
    for (const f of walk('src')) { const n = (fs.readFileSync(f, 'utf8').match(SPREAD_CALL) || []).length; if (n) hits[path.relative('src', f)] = n; }
    const canvas = fs.readFileSync('src/designer/Canvas.jsx', 'utf8');
    const paint = canvas.slice(canvas.indexOf('export async function paintItemSvg'), canvas.indexOf('function LivePreview'));
    expect(paint.match(SPREAD_CALL)).toBe(null);
    for (const f of ['designer/ChartWizard.jsx', 'exporters/regions.js', 'exporters/xlsx.js', 'exporters/htmldata.js', 'engine/items/pivot.js', 'engine/items/map.js', 'engine/items/chart-round.js', 'server/audit.js']) expect(hits[f] || 0, f).toBe(0);
    // the rest spread small, bounded arrays (a selection, a cell's lines, a page of rows)
    expect(Object.values(hits).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CEILING);
  });
  it('merging table regions with 300k rows does not overflow the stack', () => {
    const rows = Array.from({ length: 300000 }, (_, i) => ({ kind: 'detail', cells: [i] }));
    const out = mergedRegions({ regions: [{ name: 't', rows: [{ kind: 'header' }] }, { name: 't', rows }] });
    expect(out[0].rows.length).toBe(300001);
  });
});
const CEILING = 81;
