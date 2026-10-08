// B10 A1.4: `pw render -f pdf` streams a flowing report into the file (exportPdfStream) through a temporary file that is
// renamed when the export succeeded; the text is the whole-model PDF's text.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportPdfStream } from '../../src/exporters/pdfstream.js';
import { fontStore } from '../helpers.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin/pw.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-b10-cli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const hasPoppler = spawnSync('pdftotext', ['-v']).status === 0;
const pdftotext = (f) => spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout;

/** a grouped ledger with a "Page N of M" footer (pdfstream-paged.test.js's shape, smaller) */
const ledger = (n) => ({ $schema: 'pagewright/report@1', name: 'Ledger', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data: { rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, region: ['North', 'South', 'East'][i % 3], amount: ((i * 7919) % 20000 - 10000) / 100, ref: `REF-${i * 31}` })) } }],
  dataSets: [{ name: 'Tx', source: 's', path: '$.rows' }],
  sections: {
    body: { items: [{ type: 'table', name: 'Tx', dataSet: 'Tx', x: 0, y: 0, w: 400, h: 40, columns: [{ width: 60 }, { width: 100 }, { width: 120 }, { width: 120 }],
      groups: [{ name: 'Region', expr: '=Fields.region', header: [{ height: 18, cells: [{ value: '="Region " & Fields.region' }] }],
        footer: [{ height: 16, cells: [{ value: 'Total' }, null, { value: '=Sum(Fields.amount)', style: { format: 'N2' } }] }] }],
      header: [{ height: 16, cells: ['Id', 'Region', 'Amount', 'Ref'].map(value => ({ value })) }],
      detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.region' }, { value: '=Fields.amount', style: { format: 'N2' } }, { value: '=Fields.ref' }] }] }] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 400, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
  } });

describe('B10 A1.4 pw render -f pdf streams', () => {
  it('a flowing report is streamed into a valid PDF with the whole-model PDF\'s text; no temporary file is left', async () => {
    const def = ledger(600), file = path.join(tmp, 'ledger.pw.json'), out = path.join(tmp, 'ledger.pdf');
    fs.writeFileSync(file, JSON.stringify(def));
    const r = run('render', file, '-o', out);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/wrote .*ledger\.pdf \(\d+ pages, streamed/);
    const pdf = fs.readFileSync(out);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toMatch(/%%EOF\s*$/);
    expect(fs.readdirSync(tmp).filter(f => f.endsWith('.part'))).toEqual([]);
    if (!hasPoppler) return;
    const whole = path.join(tmp, 'whole.pdf');
    fs.writeFileSync(whole, await exportPdf(await render(def, { fontStore }), fontStore, { title: def.name }));
    expect(pdftotext(out)).toBe(pdftotext(whole));
  }, 60000);

  it('a report that cannot stream, and --password, take the whole-model path as before', () => {
    const out = path.join(tmp, 'enc.pdf'), file = path.join(tmp, 'ledger.pw.json');
    const r = run('render', file, '-o', out, '--password', 'secret');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/streamed/);
    expect(fs.readFileSync(out).toString('latin1')).toContain('/Encrypt');
  }, 60000);

  it('a failed export leaves no file and no temporary file, and an older file at the path as it was', () => {
    const def = ledger(50);
    def.dataSources = [{ name: 's', type: 'json', url: '/no/such/rows.json' }]; // fails once the export has begun
    const file = path.join(tmp, 'broken.pw.json'), out = path.join(tmp, 'broken.pdf');
    fs.writeFileSync(file, JSON.stringify(def));
    fs.writeFileSync(out, 'older');
    const r = run('render', file, '-o', out);
    expect(r.status).not.toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toBe('older');
    expect(fs.readdirSync(tmp).filter(f => f.startsWith('broken.pdf.'))).toEqual([]);
  }, 60000);

  it('a streamed grouped report warns as its whole render does: not about the group totals\' own fields (__g…)', async () => {
    const def = ledger(3000); // groups of 1,000 rows: a window (1,000 rows) ends inside one
    def.dataSets[0].fields = ['id', 'region', 'amount', 'ref'].map(name => ({ name })); // declared: the missing-field check runs
    const r = await exportPdfStream(def, { fontStore }, { write: () => {} });
    expect(r.streamed).toBe(true);
    expect(r.warnings).toEqual((await render(def, { fontStore })).warnings);
  }, 60000);
});
