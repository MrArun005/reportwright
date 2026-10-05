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

describe('R5 #6: CSV is the data by default, the printed layout on request', () => {
  const model = {
    pages: [], timeZone: null, regions: [
      { name: 'Summary', columns: [50, 50], rows: [{ kind: 'header', cells: [{ colIndex: 0, value: 'Region' }, { colIndex: 1, value: 'Total' }] }, { kind: 'detail', level: 0, cells: [{ colIndex: 0, value: 'East' }, { colIndex: 1, value: '₹1,234.00' }] }] },
      { name: 'Ledger', columns: [50, 50, 50], rows: [
        { kind: 'header', cells: [{ colIndex: 0, value: 'Who', span: 2 }, { colIndex: 2, value: 'Money' }] },
        { kind: 'header', cells: [{ colIndex: 0, value: 'Id' }, { colIndex: 1, value: 'Name' }, { colIndex: 2, value: 'Amount' }] },
        { kind: 'groupHeader', level: 0, cells: [{ colIndex: 0, value: 'East (2 rows)', span: 3 }] },
        { kind: 'detail', level: 1, cells: [{ colIndex: 0, value: 1 }, { colIndex: 1, value: 'A, Ltd' }, { colIndex: 2, value: 1234.5, format: 'C2' }] },
        { kind: 'detail', level: 1, cells: [{ colIndex: 0, value: 2 }, { colIndex: 1, value: 'B' }, { colIndex: 2, value: -7, format: 'C2' }] },
        { kind: 'groupFooter', level: 0, cells: [{ colIndex: 0, value: 'Subtotal' }, { colIndex: 2, value: 1227.5, format: 'C2' }] },
        { kind: 'footer', cells: [{ colIndex: 0, value: 'Total' }, { colIndex: 2, value: 1227.5 }] },
      ] },
    ],
  };
  it('one header row and the detail rows of the main table, raw numbers', async () => {
    const { exportCsv } = await import('../../src/exporters/csv.js');
    expect(exportCsv(model, { currency: 'INR' }).replace('﻿', '').split('\r\n')).toEqual(['Who Id,Who Name,Money Amount', '1,"A, Ltd",1234.5', '2,B,-7']);
  });
  it('layout: true keeps every table and row as printed', async () => {
    const { exportCsv } = await import('../../src/exporters/csv.js');
    const lines = exportCsv(model, { layout: true }).replace('\uFEFF', '').split('\r\n');
    expect(lines).toContain('Subtotal,,1227.5');
    expect(lines).toContain('Summary');
  });
});

describe('R5 #4: a batch fetches each data request once, per principal', () => {
  it('items of one batch share the fetched data; another principal or batch fetches again', async () => {
    const http = await import('node:http');
    const { renderTo } = await import('../../src/server/renderer.js');
    let hits = 0;
    const srv = http.createServer((q, r) => { hits++; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify([{ a: 1 }, { a: 2 }])); });
    await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
    const self = `http://127.0.0.1:${srv.address().port}`;
    const def = { $schema: 'pagewright/report@1', name: 'B', parameters: [{ name: 'who', type: 'string' }],
      dataSources: [{ name: 's', type: 'rest', url: '/rows' }], dataSets: [{ name: 'd', source: 's', fields: [{ name: 'a', type: 'number' }] }],
      sections: { body: { items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 16, value: '=Parameters.who & Sum(Fields.a, "d")' }] } } };
    const alice = { kind: 'user', email: 'alice@x.test', role: 'viewer' }, bob = { kind: 'user', email: 'bob@x.test', role: 'viewer' };
    const run = (who, principal, batch) => renderTo(def, { format: 'json', parameters: { who }, baseUrl: self, self, principal, ...(batch && { batch }) });
    try {
      for (const who of ['x', 'y', 'z']) expect(JSON.stringify((await run(who, alice, 'job1')).model.pages)).toContain(`${who}3`);
      expect(hits).toBe(1);
      await run('x', bob, 'job1'); // never shared across principals
      expect(hits).toBe(2);
      await run('x', alice, 'job2');
      expect(hits).toBe(3);
      await run('x', alice); await run('x', alice); // not a batch: every render fetches
      expect(hits).toBe(5);
    } finally { srv.close(); }
  });
});
