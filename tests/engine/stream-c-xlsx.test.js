// Streaming phase C (docs/research/STREAMING-1M.md §5): the streaming Excel writer gives the same sheet XML, styles and
// workbook as the model path (exportXlsx), SUBTOTAL formulas included, splits a table past Excel's row limit into
// "Name (2)" with the header again, and LibreOffice opens what it writes.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import { render } from '../../src/engine/index.js';
import { planStream } from '../../src/engine/stream.js';
import { exportXlsx } from '../../src/exporters/xlsx.js';
import { writeXlsxStream } from '../../src/exporters/xlsxstream.js';
import { fontStore } from '../helpers.js';

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: `Name ${i}`, city: ['Pune', 'Delhi', 'Chennai', 'Agra'][i % 4], team: `T${i % 3}`, qty: (i * 37) % 11, price: ((i * 7.31) % 100) - 20, day: `2026-0${1 + (i % 9)}-1${i % 10}` }));
const report = (table, extra = {}, n = 200) => ({
  $schema: 'reportwright/report@1', name: 'Book', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: rows(n) }],
  dataSets: [{ name: 'D', source: 'src', fields: [{ name: 'id', type: 'number' }, { name: 'name', type: 'string' }, { name: 'city', type: 'string' }, { name: 'team', type: 'string' }, { name: 'qty', type: 'number' }, { name: 'price', type: 'number' }, { name: 'day', type: 'date' }] }],
  sections: { body: { items: [{ type: 'table', name: 'Sales', dataSet: 'D', x: 0, y: 0, w: 500, h: 40,
    columns: [{ width: 60 }, { width: 120 }, { width: 90 }, { width: 60 }, { width: 80 }, { width: 90 }],
    header: [{ height: 16, cells: [{ value: 'Id' }, { value: 'Name' }, { value: 'City' }, { value: 'Qty' }, { value: 'Price' }, { value: 'Day' }] }],
    detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }, { value: '=Fields.city' }, { value: '=Fields.qty' }, { value: '=Fields.price', style: { format: 'C2' } }, { value: '=Fields.day', style: { format: 'd' } }] }],
    footer: [{ height: 14, style: { fontWeight: 'bold' }, cells: [{ value: 'Total', colSpan: 3 }, null, null, { value: '=Sum(Fields.qty)' }, { value: '=Sum(Fields.price)', style: { format: 'C2' } }, { value: '=Count(Fields.day)' }] }],
    ...table }] } },
  ...extra,
});
const parts = (bytes) => { const f = unzipSync(bytes); return Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('docProps/')).map(([k, v]) => [k, strFromU8(v)])); };
const model = async (def, o = {}) => parts(await exportXlsx(await render(def, { fontStore, exportData: true }), { currency: def.currency, title: def.name, ...o }));
async function streamed(def, o = {}) {
  const plan = await planStream(def, { format: 'xlsx' });
  if (plan.why) return { why: plan.why };
  const chunks = [];
  await writeXlsxStream(plan, (c) => { chunks.push(c); }, { currency: def.currency, title: def.name, ...o });
  return { bytes: Buffer.concat(chunks) };
}

const CASES = {
  plain: report({}),
  'groups: header, footer totals (SUBTOTAL), two levels': report({ groups: [
    { name: 'C', expr: '=Fields.city', header: [{ cells: [{ value: '=Fields.city', colSpan: 2 }, null] }], footer: [{ cells: [{ value: '="Total " & Fields.city' }, null, null, { value: '=Sum(Fields.qty)' }, { value: '=Sum(Fields.price)', style: { format: 'C2' } }, { value: '=Max(Fields.qty)' }] }] },
    { name: 'T', expr: '=Fields.team', sort: 'desc', footer: [{ cells: [null, null, null, { value: '=Count(Fields.qty)' }, { value: '=Avg(Fields.price)', style: { format: 'N2' } }, { value: '=Min(Fields.qty)' }] }, { cells: [{ value: 'second footer row' }, null, null, { value: '=Sum(Fields.qty)' }] }] }] }),
  'more than 30 runs: one range': report({ groups: [{ name: 'I', expr: '=Fields.id', footer: [{ cells: [null, null, null, { value: '=Sum(Fields.qty)' }] }] }] }, {}, 120),
  'more than 30 runs with text between: values': report({ groups: [{ name: 'I', expr: '=Fields.id', header: [{ cells: [null, null, null, { value: 'x' }] }], footer: [{ cells: [null, null, null, { value: '=Sum(Fields.qty)' }] }] }] }, {}, 120),
  'sorted, filtered, currency INR in en-IN': report({ sort: [{ by: '=Fields.price', dir: 'desc' }], filters: [{ expr: '=Fields.qty', op: '>', value: '=3' }] }, { locale: 'en-IN', currency: 'INR' }),
  'no rows': report({ filters: [{ expr: '=Fields.qty', op: '>', value: '=100' }], groups: [{ name: 'C', expr: '=Fields.city', footer: [{ cells: [null, null, null, { value: '=Sum(Fields.qty)' }] }] }] }),
};

describe('streaming Excel: the same workbook as the model path', () => {
  for (const [name, def] of Object.entries(CASES)) {
    it(name, async () => {
      const want = await model(def);
      const got = await streamed(def);
      expect(got.why).toBeUndefined();
      expect(parts(got.bytes)).toEqual(want);
      expect(want['xl/worksheets/sheet1.xml']).toContain('<sheetData>');
    });
  }
  it('formulas off: values only, as the model path', async () => {
    const def = CASES['groups: header, footer totals (SUBTOTAL), two levels'];
    const got = parts((await streamed(def, { formulas: false })).bytes);
    expect(got).toEqual(await model(def, { formulas: false }));
    expect(got['xl/worksheets/sheet1.xml']).not.toContain('<f>');
  });
  it('a plain cell carries no style (the default xf is 0)', async () => {
    const x = parts((await streamed(CASES.plain)).bytes)['xl/worksheets/sheet1.xml'];
    expect(x).toMatch(/<c r="B2" t="inlineStr">/);
  });
  it('falls back for what it cannot stream (a group header total needs its rows first)', async () => {
    expect((await streamed(report({ groups: [{ expr: '=Fields.city', header: [{ cells: [{ value: '=Sum(Fields.qty)' }] }] }] }))).why).toMatch(/group band/);
    expect((await streamed(report({}, { sections: { pageHeader: { height: 30, items: [{ type: 'image', x: 0, y: 0, w: 20, h: 20, src: 'x.png' }] }, body: report({}).sections.body } }))).why).toMatch(/pictures/);
  });
});

describe('the shipped reports', () => {
  it('every one that streams to Excel gives the model path\'s workbook', async () => {
    const dir = path.join(import.meta.dirname, '../../reports');
    const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const loadReport = async (id) => read(`${id}.pw.json`);
    let n = 0;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.pw.json')).sort()) {
      const def = read(f);
      if (!(def.dataSources || []).every(s => s.type === 'json' || ((s.type === 'csv' || s.type === 'xml') && s.data))) continue;
      const plan = await planStream(def, { format: 'xlsx', loadReport });
      if (plan.why) continue;
      let m;
      try { m = await render(def, { fontStore, exportData: true, loadReport }); } catch { continue; }
      const want = parts(await exportXlsx(m, { currency: def.currency, title: def.name }));
      const chunks = [];
      await writeXlsxStream(plan, (c) => { chunks.push(c); }, { currency: def.currency, title: def.name });
      expect(parts(Buffer.concat(chunks)), f).toEqual(want);
      n++;
    }
    expect(n).toBeGreaterThan(0);
  }, 120000);
});

describe('past the row limit: a new sheet', () => {
  it('splits into "Sales (2)", "Sales (3)" with the header again; totals over two sheets are values', async () => {
    const def = report({ groups: [{ name: 'C', expr: '=Fields.city', footer: [{ cells: [null, null, null, { value: '=Sum(Fields.qty)' }] }] }] }, {}, 130);
    const plan = await planStream(def, { format: 'xlsx' });
    const chunks = [];
    await writeXlsxStream(plan, (c) => { chunks.push(c); }, { maxRows: 50 });
    const p = parts(Buffer.concat(chunks));
    expect(p['xl/workbook.xml']).toMatch(/<sheet name="Sales" sheetId="1"[^>]*\/><sheet name="Sales \(2\)" sheetId="2"[^>]*\/><sheet name="Sales \(3\)" sheetId="3"/);
    for (const k of [1, 2, 3]) {
      const x = p[`xl/worksheets/sheet${k}.xml`];
      expect(x).toContain('<pane ySplit="1"');
      expect(x).toMatch(/<row r="1"><c r="A1" s="\d+" t="inlineStr"><is><t xml:space="preserve">Id<\/t>/);
      expect((x.match(/<row /g) || []).length).toBeLessThanOrEqual(50);
    }
    // all 130 detail rows, once: the ids across the sheets
    const ids = [1, 2, 3].flatMap(k => [...p[`xl/worksheets/sheet${k}.xml`].matchAll(/<c r="A\d+"[^>]*><v>(\d+)<\/v><\/c>/g)].map(m => Number(m[1])));
    expect(ids.sort((a, b) => a - b)).toEqual(Array.from({ length: 130 }, (_, i) => i));
    // a group that ends on the next sheet: its total is a value; one wholly on its sheet: a formula
    const all = [1, 2, 3].map(k => p[`xl/worksheets/sheet${k}.xml`]).join('');
    expect(all).toMatch(/<f>SUBTOTAL\(9,D/);
    expect((all.match(/<f>/g) || []).length).toBeLessThan(4 + 1);
  });
});

const soffice = (() => { try { execFileSync('soffice', ['--version'], { stdio: 'ignore', timeout: 30000 }); return true; } catch { return false; } })();
describe.skipIf(!soffice)('LibreOffice reads it', () => {
  it('converts the streamed workbook to CSV with the same values as the model path\'s', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-lo-'));
    try {
      const def = CASES['groups: header, footer totals (SUBTOTAL), two levels'];
      fs.writeFileSync(path.join(dir, 'stream.xlsx'), (await streamed(def)).bytes);
      fs.writeFileSync(path.join(dir, 'model.xlsx'), await exportXlsx(await render(def, { fontStore, exportData: true }), { title: def.name }));
      execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${dir}/lo`, '--convert-to', 'csv', '--outdir', dir, path.join(dir, 'stream.xlsx'), path.join(dir, 'model.xlsx')], { stdio: 'ignore', timeout: 120000 });
      const a = fs.readFileSync(path.join(dir, 'stream.csv'), 'utf8'), b = fs.readFileSync(path.join(dir, 'model.csv'), 'utf8');
      expect(a.split('\n').length).toBeGreaterThan(200);
      expect(a).toBe(b);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 180000);
});

describe('the pool streams an Excel export', () => {
  it('a stream with no content-length whose workbook is the model path\'s', async () => {
    const { streamInPool, stopPool } = await import('../../src/server/pool.js');
    const { OPEN } = await import('../../src/server/perms.js');
    process.env.PW_RENDER_WORKERS = '2';
    try {
      const def = report({}, {}, 5000);
      const r = await streamInPool({ def, opt: { format: 'xlsx', principal: OPEN } });
      expect(r.stream).toBeDefined();
      expect(r.contentType).toMatch(/spreadsheetml/);
      const got = parts(new Uint8Array(await new Response(r.stream).arrayBuffer()));
      expect(got).toEqual(await model(def));
    } finally { delete process.env.PW_RENDER_WORKERS; await stopPool(); }
  }, 120000);
});
