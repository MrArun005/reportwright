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

describe('R5 #1: the browser PDF writer is linear in pages', () => {
  it('time per page at 4x the rows stays within 2x (the browser path: CompressionStream, no node:zlib)', async () => {
    const { renderTo } = await import('../../src/server/renderer.js');
    const { sampleStress } = await import('../../src/sample/stress.js');
    const { createSubsetter } = await import('../../src/exporters/subset.js');
    const { fontKeysOf } = await import('../../src/exporters/svg.js');
    const { fontStore } = await import('../helpers.js');
    const gbm = process.getBuiltinModule; process.getBuiltinModule = undefined; // pdf.js picks the browser's deflate
    let exportPdf;
    try { ({ exportPdf } = await import('../../src/exporters/pdf.js?browser')); } finally { process.getBuiltinModule = gbm; }
    const def = JSON.parse(fs.readFileSync('reports/stress-scale.pw.json', 'utf8'));
    const subset = createSubsetter(async () => fs.readFileSync('public/harfbuzz-subset.wasm'));
    const perPage = async (n) => {
      const { model } = await renderTo(def, { format: 'pdf', modelOnly: true, parameters: { rows: n }, data: { s: sampleStress(n) } });
      await fontStore.load(fontKeysOf(model));
      let best = Infinity;
      for (let k = 0; k < 2; k++) { const t = performance.now(); await exportPdf(structuredClone(model), fontStore, { title: 'x', subset }); best = Math.min(best, performance.now() - t); }
      return best / model.pages.length;
    };
    await perPage(500); // warm up (WASM, fonts, JIT)
    const small = await perPage(2500), big = await perPage(10000);
    expect(big / small).toBeLessThan(2);
  }, 120000);
});

describe('R5 #7: a date or number in a narrow column shrinks, it does not wrap the row', () => {
  it('a formatted date stays on one line, so rows keep their designed height', async () => {
    const { render } = await import('../../src/engine/index.js');
    const { fontStore, report } = await import('../helpers.js');
    const rows = Array.from({ length: 200 }, (_, i) => ({ d: `2024-03-${String(1 + (i % 28)).padStart(2, '0')}`, a: 123456789.12 + i, s: 'two words' }));
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 36, dataSet: 'Rows', columns: [{ width: 47.5 }, { width: 39.6 }, { width: 40 }],
      detail: [{ height: 18, cells: [{ value: '=Fields.d', style: { format: 'dd MMM yyyy' } }, { value: '=Fields.a', style: { format: 'N2' } }, { value: '=Fields.s' }] }] }], { data: { rows } });
    def.dataSets[0].fields = [{ name: 'd', type: 'date' }, { name: 'a', type: 'number' }, { name: 's', type: 'string' }];
    def.styles = { base: { fontFamily: 'Inter', fontSize: 9, padding: [3, 4, 3, 4] } };
    const out = await render(def, { fontStore });
    const texts = out.pages[0].items.filter(i => i.t === 'text');
    const date = texts.find(i => /Mar/.test(i.lines.map(l => l.text).join(' ')));
    expect(date.lines.length).toBe(1);
    expect(date.lines[0].text).toMatch(/^\d\d Mar 2024$/);
    // a text value may still wrap between words
    expect(texts.find(i => /two/.test(i.lines[0].text)).lines.length).toBe(2);
  });
});

describe('R5 #9: health with inline renders and a cron-driven scheduler', () => {
  it('no worker pool is a neutral "inline" check, schedules and batches off say they run via cron, inline renders are timed', async () => {
    const keep = { ...process.env };
    Object.assign(process.env, { PW_RENDER_WORKERS: '0', PW_SCHEDULER: 'off', PW_WORKER: 'off', PW_CRON: 'daily' });
    try {
      const { health, renderStats } = await import('../../src/home/overview.js');
      const { renderInPool } = await import('../../src/server/pool.js');
      const by = Object.fromEntries((await health()).checks.map(c => [c.id, c]));
      expect(by.engine).toMatchObject({ state: 'off', label: 'inline', note: 'inline' });
      expect(by.scheduler).toMatchObject({ state: 'off', note: 'cron:daily' });
      expect(by.worker).toMatchObject({ state: 'off', note: 'cron:daily' });
      const before = renderStats().timed;
      await renderInPool({ def: { $schema: 'pagewright/report@1', name: 'X', sections: { body: { items: [] } } }, opt: { format: 'json' } });
      expect(renderStats().timed).toBe(before + 1);
      expect(renderStats().avgMs).not.toBe(null);
    } finally { for (const k of ['PW_RENDER_WORKERS', 'PW_SCHEDULER', 'PW_WORKER', 'PW_CRON']) if (keep[k] == null) delete process.env[k]; else process.env[k] = keep[k]; }
  });
  it('the schedule editor warns when a cadence faster than daily runs only on a daily cron', async () => {
    const { fasterThanDaily } = await import('../../src/server/cron.js');
    expect(fasterThanDaily('*/15 * * * *')).toBe(true);
    expect(fasterThanDaily('0 * * * *')).toBe(true);
    expect(fasterThanDaily('0 6,18 * * *')).toBe(true);
    expect(fasterThanDaily('0 6 * * *')).toBe(false);
    expect(fasterThanDaily('30 7 * * 1')).toBe(false);
  });
});

describe('R5 #11: small fixes', () => {
  it('the dashboard shows a schedule\'s next run in the viewer\'s zone, like the Schedules page', () => {
    const src = fs.readFileSync('src/home/Overview.jsx', 'utf8');
    expect(src).not.toMatch(/new Date\(s\.nextRunAt\)\.toLocaleString/);
    expect(src).toMatch(/<LocalTime iso=\{s\.nextRunAt\}/);
    expect(fs.readFileSync('src/home/ScheduleToggle.jsx', 'utf8')).toMatch(/^'use client'/);
  });
});
