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

describe('R5 #2: a fetched data source over the size cap', () => {
  it('fails with 413 naming the cap and PW_FETCH_MAX_MB, and the setting raises it', async () => {
    const http = await import('node:http');
    const { safeFetch } = await import('../../src/server/safeFetch.js');
    const big = Buffer.alloc(1.5 * 1048576, 32);
    const srv = http.createServer((_q, r) => { r.end(big); });
    await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${srv.address().port}/x`;
    const prev = process.env.PW_FETCH_MAX_MB;
    try {
      process.env.PW_FETCH_MAX_MB = '1';
      const res = await safeFetch(url, {}, { allow: [new URL(url).origin] });
      const e = await res.text().then(() => null, x => x);
      expect(e?.status).toBe(413);
      expect(e.message).toMatch(/1 MB.*PW_FETCH_MAX_MB/);
      process.env.PW_FETCH_MAX_MB = '2';
      expect((await (await safeFetch(url, {}, { allow: [new URL(url).origin] })).text()).length).toBe(big.length);
    } finally { if (prev == null) delete process.env.PW_FETCH_MAX_MB; else process.env.PW_FETCH_MAX_MB = prev; srv.close(); }
  });
  it('the default cap holds the 100k-row hard sample (~22 MB)', async () => {
    const { fetchMaxBytes } = await import('../../src/server/safeFetch.js');
    expect(fetchMaxBytes()).toBeGreaterThanOrEqual(64 * 1048576);
  });
});

describe('R5 #5: the Excel formulas option reaches the exporter', () => {
  const def = { $schema: 'pagewright/report@1', name: 'F', dataSources: [{ name: 's', type: 'json', data: [{ a: 1 }, { a: 2 }, { a: 4 }] }], dataSets: [{ name: 'd', source: 's', fields: [{ name: 'a', type: 'number' }] }],
    sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 54, dataSet: 'd', columns: [{ width: 200 }], header: [{ height: 18, cells: [{ value: 'A' }] }], detail: [{ height: 18, cells: [{ value: '=Fields.a' }] }], footer: [{ height: 18, cells: [{ value: '=Sum(Fields.a)' }] }] }] } } };
  const sheet = async (formulas) => {
    const { renderTo } = await import('../../src/server/renderer.js');
    const JSZip = (await import('jszip')).default;
    const { bytes } = await renderTo(def, { format: 'xlsx', ...(formulas !== undefined && { formulas }) });
    return (await JSZip.loadAsync(bytes)).file('xl/worksheets/sheet1.xml').async('string');
  };
  it('on by default and with 1/true; off with 0, "0", "false", false (a query string or a JSON body)', async () => {
    for (const v of [undefined, 1, '1', true, 'true']) expect(await sheet(v), String(v)).toContain('<f>SUBTOTAL(9,');
    for (const v of [0, '0', 'false', false, 'off']) expect(await sheet(v), String(v)).not.toContain('<f>');
  });
  it('the server link reads ?formulas= and does not pass it on as a report parameter', () => {
    const src = fs.readFileSync('app/api/reports/[id]/pdf/route.js', 'utf8');
    expect(src).toMatch(/searchParams\.get\('formulas'\)/);
    expect(src).toMatch(/k !== 'formulas'/);
  });
});
