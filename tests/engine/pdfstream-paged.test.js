// Paged rendering (src/engine/paged.js) and the streaming export (exportPdfStream): a flowing ledger laid out a window of
// rows at a time gives the same pages as the whole render, and the same text in the PDF; other reports fall back to
// exportPdf, byte for byte.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { render } from '../../src/engine/index.js';
import { planPaged } from '../../src/engine/paged.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportPdfStream } from '../../src/exporters/pdfstream.js';
import { createSubsetter } from '../../src/exporters/subset.js';
import { fontStore } from '../helpers.js';

const root = path.join(import.meta.dirname, '../..');
const subset = createSubsetter(() => fs.promises.readFile(path.join(root, 'public/harfbuzz-subset.wasm')));
const hasPoppler = spawnSync('pdftotext', ['-v']).status === 0;
const pdftotext = (bytes, ...args) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pwp-')), 'a.pdf');
  fs.writeFileSync(f, bytes);
  const r = spawnSync('pdftotext', [...args, f, '-']);
  return { text: r.stdout.toString(), err: r.stderr.toString() };
};
const sink = () => { const chunks = []; return { chunks, write: async (u8) => { chunks.push(Buffer.from(u8)); }, bytes: () => Buffer.concat(chunks) }; };

const TYPES = ['Deposit', 'Withdrawal', 'Transfer', 'Fee', 'Interest'];
const REGIONS = ['North', 'South', 'East', 'West'];
/** transactions shaped like stress-ledger's: id, account, region, branch, date, type, amount, currency, channel, reference */
const ledgerRows = (n) => Array.from({ length: n }, (_, i) => ({
  id: i + 1, accountId: `AC${String(1000 + (i * 7) % 900).padStart(5, '0')}`, region: REGIONS[i % 4], branchId: `BR${(i * 13) % 40}`,
  date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, type: TYPES[(i * 3) % 5],
  amount: Math.round(((i * 7919) % 200000 - 100000) * 1.37) / 100, currency: ['INR', 'USD', 'EUR'][i % 3], channel: ['Branch', 'Online', 'ATM', ''][i % 4],
  // every 37th reference is long enough to wrap: rows of different heights
  reference: i % 37 === 0 ? `Reversal of an earlier transfer between linked accounts, batch ${i}` : `REF-${i * 31}`,
}));
const ledger = (rows, extra = {}) => ({
  $schema: 'pagewright/report@1', name: 'Ledger', locale: 'en-IN', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows } }],
  dataSets: [{ name: 'Tx', source: 'src', path: '$.rows', fields: [
    { name: 'id', type: 'number' }, { name: 'accountId', type: 'string' }, { name: 'region', type: 'string' }, { name: 'branchId', type: 'string' },
    { name: 'date', type: 'date' }, { name: 'type', type: 'string' }, { name: 'amount', type: 'number' }, { name: 'currency', type: 'string' },
    { name: 'channel', type: 'string' }, { name: 'reference', type: 'string' },
    { name: 'channelClean', type: 'string', expr: '=IIF(Trim(Coalesce(Fields.channel, "")) = "", "(none)", Fields.channel)' }],
  filters: [{ expr: '=Fields.amount', op: 'Between', value: -900, value2: 900 }], sort: [{ by: '=Fields.date' }, { by: '=Fields.id', dir: 'desc' }] }],
  sections: {
    pageHeader: { height: 24, items: [{ type: 'textbox', name: 'Title', x: 0, y: 0, w: 300, h: 18, value: 'Transactions ledger', style: { fontWeight: 'bold', fontSize: 12 } }] },
    body: { items: [
      { type: 'textbox', name: 'Intro', x: 0, y: 0, w: 520, h: 16, value: 'All transactions between -900 and 900, by date.' },
      { type: 'table', name: 'Tx', dataSet: 'Tx', x: 0, y: 24, w: 523, h: 40, columns: [{ width: 40 }, { width: 62 }, { width: 46 }, { width: 62 }, { width: 58 }, { width: 62 }, { width: 50 }, { width: 143 }],
        header: [{ height: 16, style: { backgroundColor: '#eef2f7', fontWeight: 'bold' }, cells: ['Id', 'Account', 'Region', 'Date', 'Type', 'Amount', 'Channel', 'Reference'].map(value => ({ value })) }],
        detail: [{ height: 14, style: { borderBottom: '0.5 solid #e5e7eb' }, cells: [{ value: '=Fields.id' }, { value: '=Fields.accountId' }, { value: '=Fields.region' }, { value: '=Fields.date', style: { format: 'd' } },
          { value: '=Fields.type' }, { value: '=Fields.amount', style: { format: 'N2', textAlign: 'right', color: '=IIF(Fields.amount < 0, "#b91c1c", "#111827")' } }, { value: '=Fields.channelClean' }, { value: '=Fields.reference', style: { fontSize: 8 } }] }],
        footer: [{ height: 16, style: { fontWeight: 'bold' }, cells: [{ value: 'Total' }, { value: '=CountRows()' }, null, null, null, { value: '=Sum(Fields.amount)', style: { format: 'N2', textAlign: 'right' } }, null, null] }] },
      { type: 'textbox', name: 'End', x: 0, y: 80, w: 520, h: 16, value: 'End of ledger.' },
    ] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 520, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}', style: { textAlign: 'right' } }] },
  },
  ...extra,
});
const now = new Date('2026-01-02T03:04:05Z');

describe('paged rendering of a flowing table', () => {
  it('window by window, the pages are the whole render\'s pages', async () => {
    const def = ledger(ledgerRows(1500));
    const whole = await render(def, { fontStore, now });
    expect(whole.pages.length).toBeGreaterThan(8);
    const plan = await planPaged(def, { fontStore, now, window: 120 });
    expect(plan.why).toBeUndefined();
    const pages = [];
    for await (const p of /** @type {any} */ (plan).pages()) pages.push(p);
    expect(pages.length).toBe(whole.pages.length);
    pages.forEach((p, i) => expect(JSON.stringify(p.items), `page ${i + 1}`).toBe(JSON.stringify(whole.pages[i].items)));
  });

  it('reports it cannot page fall back: groups, RowNumber, aggregates in the bands', async () => {
    const base = ledger(ledgerRows(10));
    const t = base.sections.body.items[1];
    expect((await planPaged({ ...base, sections: { ...base.sections, body: { items: [{ ...t, groups: [{ name: 'R', expr: '=Fields.region' }] }] } } }, { fontStore })).why).toBe('groups');
    expect((await planPaged({ ...base, sections: { ...base.sections, body: { items: [{ ...t, detail: [{ cells: [{ value: '=RowNumber()' }] }] }] } } }, { fontStore })).why).toBe('RowNumber in the rows');
    expect((await planPaged({ ...base, sections: { ...base.sections, pageHeader: { height: 20, items: [{ type: 'textbox', x: 0, y: 0, w: 100, h: 14, value: '=Sum(Fields.amount)' }] } } }, { fontStore })).why).toBeTruthy();
  });
});

describe('exportPdfStream', () => {
  it.skipIf(!hasPoppler)('a ledger streams, and its PDF reads as exportPdf\'s (text, order, layout)', async () => {
    const def = ledger(ledgerRows(2000));
    const today = await exportPdf(await render(def, { fontStore, now }), fontStore, { subset, creationDate: now });
    const s = sink();
    const r = await exportPdfStream(def, { fontStore, now, subset, creationDate: now, window: 150 }, s);
    expect(r.streamed).toBe(true);
    const pdf = s.bytes();
    for (const args of [[], ['-layout']]) {
      const a = pdftotext(today, ...args), b = pdftotext(pdf, ...args);
      expect(b.err).toBe('');
      expect(b.text).toBe(a.text);
    }
    expect(pdftotext(pdf).text).toMatch(/Page 2 of \d+/);
    const [x, y] = [await PDFDocument.load(today), await PDFDocument.load(pdf)];
    expect(y.getPageCount()).toBe(x.getPageCount());
    expect(r.pages).toBe(x.getPageCount());
  });

  it('a report that does not page is exportPdf\'s file, byte for byte', async () => {
    const def = ledger(ledgerRows(50));
    def.sections.body.items[1].groups = [{ name: 'R', expr: '=Fields.region', header: [{ cells: [{ value: '=Fields.region' }] }] }];
    const today = Buffer.from(await exportPdf(await render(def, { fontStore, now }), fontStore, { subset, creationDate: now }));
    const s = sink();
    const r = await exportPdfStream(def, { fontStore, now, subset, creationDate: now }, s);
    expect(r).toMatchObject({ streamed: false, why: 'groups' });
    expect(s.bytes().equals(today)).toBe(true);
  });
});
