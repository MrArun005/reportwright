// Paged rendering (src/engine/paged.js) and the streaming export (exportPdfStream): a flowing ledger laid out a window of
// rows at a time gives the same pages as the whole render, and the same text in the PDF; other reports fall back to
// exportPdf, byte for byte.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
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
const VERAPDF = process.env.VERAPDF_BIN || (spawnSync('verapdf', ['--version']).status === 0 ? 'verapdf' : null);
const ICC = fs.readFileSync(path.join(root, 'public/icc/sRGB-v2-magic.icc'));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwp-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
let tmpN = 0;
const pdftotext = (bytes, ...args) => {
  const f = path.join(tmpDir, `${++tmpN}.pdf`);
  fs.writeFileSync(f, bytes);
  const r = spawnSync('pdftotext', [...args, f, '-'], { maxBuffer: 1 << 30 });
  if (r.error || r.status) throw new Error(`pdftotext failed (${r.error?.code ?? r.status}): ${r.stderr}`); // ENOBUFS cut the text short, silently
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
  $schema: 'reportwright/report@1', name: 'Ledger', locale: 'en-IN', page: { size: 'A4', margins: [36, 36, 36, 36] },
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

const sumF = (label) => [{ height: 15, style: { fontWeight: 'bold' }, cells: [{ value: label }, { value: '=CountRows()' }, null, null, null, { value: '=Sum(Fields.amount)', style: { format: 'N2', textAlign: 'right' } }, { value: '=Fields.region' }, { value: '=Max(Fields.date)', style: { format: 'd' } }] }];
/** two group levels (subtotals, counts, max; the outer header repeats), RowNumber, fields in the table header */
const grouped = (n, o = {}) => {
  const def = ledger(ledgerRows(n), o.def);
  const t = def.sections.body.items[1];
  t.groups = [
    { name: 'Region', expr: '=Fields.region', repeatHeader: true, header: [{ height: 18, style: { backgroundColor: '#dbeafe', fontWeight: 'bold' }, cells: [{ value: '="Region " & Fields.region', colSpan: 3 }, null, null] }], footer: sumF('Region total'), ...o.outer },
    { name: 'Type', expr: '=Fields.type', header: [{ height: 15, cells: [null, { value: '=Fields.type' }] }], footer: sumF('Type total'), ...o.inner },
  ];
  t.detail[0].cells[0] = { value: '=RowNumber() & "/" & Fields.id' };
  t.header[0].cells[1] = { value: '="From " & Fields.accountId' };
  Object.assign(t, o.table);
  if (o.single) def.sections.pageFooter.items[0].value = 'Page {Globals.PageNumber}';
  return def;
};
describe('paged rendering of a flowing table', () => {
  it('"Page N of M": the held first pass and the two passes (pages past holdItems) give the whole render\'s pages', async () => {
    const def = grouped(1500);
    def.sections.pageHeader = { height: 20, items: [{ type: 'textbox', name: 'H', x: 0, y: 0, w: 300, h: 16, value: 'Ledger', bookmark: 'Ledger' }] }; // the outline comes from the held pass
    const whole = await render(def, { fontStore, now });
    expect(whole.bookmarks.length).toBeGreaterThan(3);
    const outlines = [];
    for (const holdItems of [undefined, 400, 0]) { // held throughout, dropped part way, dropped at once
      const plan = await planPaged(def, { fontStore, now, window: 120, holdItems });
      const pages = [];
      for await (const p of /** @type {any} */ (plan).pages()) pages.push(p);
      expect(pages.length, `holdItems ${holdItems}`).toBe(whole.pages.length);
      if (holdItems === undefined) expect(pages.some((p) => p.items.some((/** @type {any} */ it) => it.lines?.[0]?.text === `Page 3 of ${whole.pages.length}`))).toBe(true);
      pages.forEach((p, i) => { expect(p.reband).toBeUndefined(); expect(JSON.stringify(p.items), `holdItems ${holdItems}, page ${i + 1}`).toBe(JSON.stringify(whole.pages[i].items)); });
      outlines.push(JSON.stringify(/** @type {any} */ (plan).info.bookmarks));
    }
    expect(outlines[1]).toBe(outlines[0]);
    expect(outlines[2]).toBe(outlines[0]);
  });

  it('the held pass is bounded by what it holds, a long text\'s lines included: a hostile report falls back to two passes', async () => {
    const words = (i) => Array.from({ length: 300 }, (_, k) => `w${i}x${k}`).join(' '); // distinct words: one cell, ~60 lines
    const def = ledger(ledgerRows(200).map((r, i) => ({ ...r, account: words(i) })));
    const count = async (holdItems) => { const plan = /** @type {any} */ (await planPaged(def, { fontStore, now, window: 50, holdItems })); let n = 0; for await (const p of plan.pages()) n += p.items.length; return { n, held: plan.info.held }; };
    const big = await count(undefined), small = await count(2000);
    expect(big.held).toBe(true);
    expect(small.held).toBe(false); // few items, but their lines are over the cap
    expect(small.n).toBe(big.n);
  });

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

  const same = async (def, window) => {
    const whole = await render(def, { fontStore, now });
    const plan = await planPaged(def, { fontStore, now, window });
    expect(plan.why).toBeUndefined();
    let i = 0;
    for await (const p of /** @type {any} */ (plan).pages()) { expect(JSON.stringify(p.items), `page ${i + 1}`).toBe(JSON.stringify(whole.pages[i].items)); i++; }
    expect(i).toBe(whole.pages.length);
    return i;
  };
  it('groups page window by window as the whole render: headers that repeat, subtotals, RowNumber, header fields', async () => {
    expect(await same(grouped(1500), 120)).toBeGreaterThan(20);
  });
  it('a zebra detail row (RowNumber() in its style) pages window by window as the whole render, flat and grouped', async () => {
    // 0.14.0-rc.1: the row style's RowNumber() was refused ("detail expressions"), so the report was rendered whole
    const zebra = (def) => { const t = def.sections.body.items[1]; t.detail[0].style = { backgroundColor: '=IIf(RowNumber() Mod 2 = 0, "#f3f4f6", "#ffffff")', borderBottom: '=IIf(RowNumber() Mod 2 = 0, "0.5 solid #d1d5db", "0.5 solid #e5e7eb")' }; return def; };
    expect(await same(zebra(ledger(ledgerRows(1500))), 120)).toBeGreaterThan(8);
    expect(await same(zebra(grouped(1500)), 120)).toBeGreaterThan(20);
  });
  it('… with groups kept together, a break between groups, pageBreakEvery, first-last band rows, a sorted inner group', async () => {
    await same(grouped(1500, { outer: { keepTogether: true }, inner: { keepTogether: true } }), 60);
    await same(grouped(1500, { outer: { keepTogether: true }, inner: { keepTogether: true }, single: true }), 60); // one pass (no page count)
    await same(grouped(1500, { outer: { pageBreak: 'between' }, table: { pageBreakEvery: 25 } }), 120);
    await same(grouped(1200, { def: { bandRows: 'first-last' }, inner: { sort: 'desc' }, table: { header: [{ height: 16, cells: [{ value: 'Id' }, { value: 'Account' }] }] } }), 200); // header fields: not with sorted groups
  });

  it.skipIf(!hasPoppler)('a grouped ledger streams as a PDF that reads as exportPdf\'s', async () => {
    const def = grouped(3000);
    const today = await exportPdf(await render(def, { fontStore, now }), fontStore, { subset, creationDate: now });
    const s = sink();
    expect((await exportPdfStream(def, { fontStore, now, subset, creationDate: now, window: 300 }, s)).streamed).toBe(true);
    for (const args of [[], ['-layout']]) expect(pdftotext(s.bytes(), ...args).text).toBe(pdftotext(today, ...args).text);
  });

  it('reports it cannot page fall back: group sections, aggregates in the bands, header fields of a re-sorted table', async () => {
    const base = ledger(ledgerRows(10));
    const t = base.sections.body.items[1];
    const withTable = (x) => ({ ...base, sections: { ...base.sections, body: { items: [{ ...t, ...x }] } } });
    expect((await planPaged(withTable({ groups: [{ name: 'R', expr: '=Fields.region', newSection: true }] }), { fontStore })).why).toBe('group sections');
    expect((await planPaged({ ...base, sections: { ...base.sections, pageHeader: { height: 20, items: [{ type: 'textbox', x: 0, y: 0, w: 100, h: 14, value: '=Sum(Fields.amount)' }] } } }, { fontStore })).why).toBeTruthy();
    expect((await planPaged(withTable({ sort: [{ by: '=Fields.amount' }], header: [{ cells: [{ value: '=Fields.id' }] }] }), { fontStore })).why).toBe('fields outside the rows of a re-ordered table');
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
    expect(pdf.length / today.length).toBeLessThan(1.05); // object streams, literal text, zlib 9: about exportPdf's size
  });

  it.skipIf(!VERAPDF || !hasPoppler)('PDF/A-2b, PDF/UA-1 and PDF/A-2a + PDF/UA-1 stream, pass veraPDF and read as exportPdf\'s', async () => {
    const def = ledger(ledgerRows(1500));
    const t = def.sections.body.items[1];
    t.groups = [{ name: 'R', expr: '=Fields.region', header: [{ cells: [{ value: '=Fields.region' }] }], footer: [{ cells: [{ value: 'Total' }, null, null, null, null, { value: '=Sum(Fields.amount)', style: { format: 'N2' } }] }] }];
    t.detail[0].cells[1].action = { type: 'url', href: '="https://example.com/acct/" & Fields.accountId' };
    const run = async (o) => { const s = sink(); const r = await exportPdfStream(def, { fontStore, now, subset, creationDate: now, title: 'Ledger', window: 200, ...o }, s); expect(r.streamed).toBe(true); return s.bytes(); };
    // exportPdf's text for the same options; tagged, the untagged file's (the streamed cells' text is one text object a
    // page, as untagged, and pdftotext reads it so)
    const want = async (o) => pdftotext(await exportPdf(await render(def, { fontStore, now }), fontStore, { subset, creationDate: now, title: 'Ledger', ...o, tagged: undefined })).text;
    for (const [o, profiles] of [[{ pdfa: { icc: ICC } }, ['2b']], [{ tagged: { lang: 'en-IN' } }, ['ua1']], [{ pdfa: { icc: ICC }, tagged: { lang: 'en-IN' } }, ['2a', 'ua1']]]) {
      const pdf = await run(o);
      expect(pdftotext(pdf).text).toBe(await want(o));
      const f = path.join(tmpDir, `v${++tmpN}.pdf`);
      fs.writeFileSync(f, pdf);
      for (const p of profiles) {
        let out; try { out = execFileSync(VERAPDF, ['-f', p, '--format', 'text', f], { encoding: 'utf8', maxBuffer: 1e8 }); } catch (e) { out = e.stdout; }
        expect(out, p).toMatch(/^PASS /m);
      }
    }
  }, 240000);

  it('parallel: windows laid out and painted by worker threads give the same file, byte for byte', async () => {
    const def = grouped(3000);
    const run = async (parallel) => { const s = sink(); const r = await exportPdfStream(def, { fontStore, now, subset, creationDate: now, id: '0123456789abcdef0123456789abcdef', window: 300, parallel }, s); expect(r.streamed).toBe(true); return s.bytes(); };
    const one = await run(1);
    expect((await run(3)).equals(one)).toBe(true);
    // without "of M" the pages are counted first all the same (the workers need the page starts)
    def.sections.pageFooter.items[0].value = 'Page {Globals.PageNumber}';
    expect((await run(2)).equals(await run(1))).toBe(true);
  }, 120000);

  it('parallel: the counting pass\'s windows go to the workers as it counts; the file is the same in every mode', async () => {
    const def = grouped(2500);
    const bytes = async (parallel, o = {}) => { const s = sink(); const r = await exportPdfStream(def, { fontStore, now, subset, creationDate: now, id: '0123456789abcdef0123456789abcdef', window: 250, parallel, ...o }, s); expect(r.streamed).toBe(true); return s.bytes(); };
    const one = await bytes(1);
    // held in the workers throughout; past aheadRows (the rest laid out by a second pass from there); 'auto' that stays
    // here (held, small), and 'auto' that starts the workers once the held pages pass holdItems
    for (const o of [{ parallel: 2 }, { parallel: 3, aheadRows: 300 }, { parallel: 'auto' }, { parallel: 'auto', holdItems: 3000, aheadRows: 400 }]) {
      expect((await bytes(o.parallel, o)).equals(one), JSON.stringify(o)).toBe(true);
    }
    // without "of M": drawn here, then (autoRows) by the workers
    def.sections.pageFooter.items[0].value = 'Page {Globals.PageNumber}';
    const single = await bytes(1);
    expect((await bytes('auto', { autoRows: 600 })).equals(single)).toBe(true);
    // not holdable (a bookmark on the table): counted first, then laid out by the workers
    def.sections.pageFooter.items[0].value = 'Page {Globals.PageNumber} of {Globals.TotalPages}';
    def.sections.body.items[1].bookmark = '="Ledger"';
    expect((await bytes(3)).equals(await bytes(1))).toBe(true);
  }, 240000);

  it('parallel: an abort or the time limit ends the export and every worker', async () => {
    const wt = process.getBuiltinModule('node:worker_threads');
    const Real = wt.Worker, made = [], exited = [];
    wt.Worker = class extends Real { constructor(...a) { super(...a); made.push(this); this.once('exit', () => exited.push(this)); } };
    try {
      const def = grouped(4000);
      const ac = new AbortController();
      let n = 0;
      const s = { write: async () => { if (++n === 3) ac.abort(new Error('stop')); } };
      await expect(exportPdfStream(def, { fontStore, now, subset, window: 250, parallel: 2, signal: ac.signal }, s)).rejects.toThrow('stop');
      await expect(exportPdfStream(def, { fontStore, now, subset, window: 250, parallel: 2, timeoutMs: 150 }, sink())).rejects.toMatchObject({ status: 504 });
      expect(made.length).toBeGreaterThan(0);
      await new Promise((ok) => setTimeout(ok, 200));
      expect(exited.length).toBe(made.length);
    } finally { wt.Worker = Real; }
  }, 120000);

  it('a report that does not page is exportPdf\'s file, byte for byte', async () => {
    const def = ledger(ledgerRows(50));
    def.sections.body.items[1].groups = [{ name: 'R', expr: '=Fields.region', newSection: true, header: [{ cells: [{ value: '=Fields.region' }] }] }];
    const today = Buffer.from(await exportPdf(await render(def, { fontStore, now }), fontStore, { subset, creationDate: now }));
    const s = sink();
    const r = await exportPdfStream(def, { fontStore, now, subset, creationDate: now }, s);
    expect(r).toMatchObject({ streamed: false, why: 'group sections' });
    expect(s.bytes().equals(today)).toBe(true);
  });
});
