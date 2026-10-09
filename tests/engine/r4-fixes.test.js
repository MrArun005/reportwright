// R4: the owner's bug list (docs/COORDINATION.md "R4"). Engine, exporter and server-side checks; the UI parts are in
// tests/e2e/r4-fixes.mjs.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { fontStore, texts, report } from '../helpers.js';

const hasPoppler = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const pdfText = async (model) => {
  const f = path.join(os.tmpdir(), `r4-${process.pid}-${Date.now()}.pdf`);
  try {
    fs.writeFileSync(f, await exportPdf(model, fontStore));
    return execFileSync('pdftotext', ['-layout', f, '-']).toString();
  } finally { fs.rmSync(f, { force: true }); }
};

describe('a pivot wider than the page', () => {
  // 30 column keys: about 30 × 64pt, far wider than A4's 523pt
  const rows = Array.from({ length: 60 }, (_, i) => ({ r: `R${i % 4}`, c: `K${String(i % 30).padStart(2, '0')}`, v: i }));
  const legacy = (extra = {}) => ({ type: 'matrix', name: 'L', x: 0, y: 0, w: 500, h: 54, dataSet: 'Rows', rowGroup: '=Fields.r', columnGroup: '=Fields.c', value: '=Sum(Fields.v)', ...extra });
  const tablix = (extra = {}) => ({ type: 'matrix', name: 'P', x: 0, y: 0, w: 500, h: 54, dataSet: 'Rows', rowGroups: [{ name: 'R', expr: '=Fields.r' }], columnGroups: [{ name: 'C', expr: '=Fields.c' }], values: [{ value: '=Sum(Fields.v)' }], ...extra });
  const run = (item) => render(report([item], { data: { rows } }), { fontStore });

  for (const [kind, make] of [['single-group (legacy)', legacy], ['tablix', tablix]]) {
    it(`${kind}: continues on the next pages by default, every column shown, and says so`, async () => {
      const m = await run(make());
      expect(m.pages.length).toBeGreaterThan(1);
      const all = m.pages.flatMap(texts);
      for (let i = 0; i < 30; i++) expect(all).toContain(`K${String(i).padStart(2, '0')}`);
      expect(m.warnings.join('\n')).toMatch(/wider than the page .* continue on the next pages/);
      expect(m.warnings.join('\n')).not.toMatch(/do not fit the page|showing the first/);
      expect(m.clipped).toEqual([]);
      // every text is inside the page
      for (const p of m.pages) for (const it of p.items) if (it.t === 'text') for (const l of it.lines) expect(l.x + (l.w || 0)).toBeLessThanOrEqual(m.width - 36 + 0.5);
    });
    it(`${kind}: "clip" is the explicit opt-out: one page across, a warning, and model.clipped says so`, async () => {
      const m = await run(make({ overflow: 'clip' }));
      expect(m.pages.length).toBe(1);
      expect(m.clipped.length).toBe(1);
      expect(m.clipped[0]).toMatch(/past the page edge are cut/);
      expect(m.warnings).toContain(m.clipped[0]);
    });
  }
  it('"shrink" that has to drop columns is reported as clipped', async () => {
    const m = await run(legacy({ overflow: 'shrink' }));
    expect(m.clipped.join('\n')).toMatch(/do not fit the page; showing the first/);
  });
  it('an item past the right edge is reported as clipped', async () => {
    const m = await render(report([{ type: 'textbox', name: 'Off', x: 480, y: 0, w: 120, h: 14, value: 'x' }]), { fontStore });
    expect(m.clipped).toEqual([expect.stringMatching(/^Off: it reaches 600pt/)]);
  });
  it.skipIf(!hasPoppler)('PDF: the columns of a wide pivot are all in the file, on extra pages', async () => {
    const m = await run(legacy());
    const txt = await pdfText(m);
    const pages = txt.split('\f').filter(s => s.trim());
    expect(pages.length).toBe(m.pages.length);
    for (let i = 0; i < 30; i++) expect(txt).toContain(`K${String(i).padStart(2, '0')}`);
    // the row headers repeat on each page set
    for (const pg of pages) expect(pg).toContain('R0');
  });
});

describe('HTML export size', () => {
  const ROOT = path.join(import.meta.dirname, '..', '..');
  const subsetP = import('../../src/exporters/subset.js').then(m => m.createSubsetter(() => fs.promises.readFile(path.join(ROOT, 'public', 'harfbuzz-subset.wasm'))));
  // a one-page report over 3,000 rows: a summary and the top 25 rows
  const rows = Array.from({ length: 3000 }, (_, i) => ({ id: i, customer: `Customer ${i} with a long name`, city: ['Pune', 'Delhi', 'Kochi'][i % 3], amount: i * 13.7, note: 'x'.repeat(120) }));
  const def = report([
    { type: 'textbox', name: 'Total', x: 0, y: 0, w: 300, h: 16, value: '="Total " & Format(Sum(Fields.amount, "Rows"), "N2")' },
    { type: 'table', name: 'Top', x: 0, y: 24, w: 520, h: 28, dataSet: 'Rows', filters: [{ expr: '=Fields.id', op: '<', value: '=25' }],
      columns: [{ width: 60 }, { width: 300 }, { width: 160 }],
      header: [{ height: 14, cells: [{ value: 'Id' }, { value: 'Customer' }, { value: 'Amount' }] }],
      detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.customer' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] },
  ], { data: { rows } });
  it('a one-page report is under 300 KB: the pages, subset fonts and the rendered tables, not the data set', async () => {
    const { exportHtml } = await import('../../src/exporters/html.js');
    const m = await render(def, { fontStore, exportData: true });
    expect(m.pages.length).toBe(1);
    const html = await exportHtml(m, fontStore, { subset: await subsetP });
    expect(html.length).toBeLessThan(300 * 1024);
    expect(html).not.toContain('Customer 2999');
    expect(html).not.toContain('x'.repeat(120));
  });
  it('pw render -f html subsets the fonts (it embedded every font whole: 1.6 MB for one page)', async () => {
    const { spawnSync } = await import('node:child_process');
    const out = path.join(os.tmpdir(), `r4-${process.pid}.html`);
    try {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'pw.mjs'), 'render', path.join(ROOT, 'reports', 'style-showcase.pw.json'), '-f', 'html', '-o', out], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(fs.statSync(out).size).toBeLessThan(300 * 1024);
    } finally { fs.rmSync(out, { force: true }); }
  });
  it('the viewer exports HTML as pages + tables by default; an old stored "interactive" default is dropped, a v2 choice kept', async () => {
    const { EXPORT_DEFAULTS, exportOptionsFrom } = await import('../../src/viewer/logic.js');
    expect(EXPORT_DEFAULTS.html).toBe('tables');
    expect(exportOptionsFrom({ pdfua: true, pdfa: false, formulas: true, html: 'interactive' })).toEqual({ ...EXPORT_DEFAULTS, pdfua: true });
    expect(exportOptionsFrom({ v: 2, html: 'interactive' }).html).toBe('interactive');
    expect(exportOptionsFrom(null)).toEqual(EXPORT_DEFAULTS);
  });
  it('the interactive file\'s data snapshot keeps only the values a report can read', async () => {
    const { pruneSnapshot } = await import('../../src/viewer/logic.js');
    const d = { dataSets: [{ name: 'A', source: 's', path: '$.accounts[*]', fields: [{ name: 'id' }, { name: 'balance due' }] }], sections: { body: { items: [{ type: 'textbox', value: '=Fields.city' }] } } };
    const snap = { '/api/x': { total: 3, accounts: [{ id: 1, 'balance due': 5, city: 'Pune', secret: 'no', notes: 'long', tags: ['a'], nested: { id: 2, junk: 1 } }] } };
    expect(pruneSnapshot(snap, [d])).toEqual({ '/api/x': { accounts: [{ id: 1, 'balance due': 5, city: 'Pune', tags: ['a'], nested: { id: 2 } }] } });
  });
});

describe('the checker (validate, and the save that runs it)', () => {
  const item = (extra) => ({ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 14, value: 'x', ...extra });
  const def = (items, extra = {}) => ({ ...report(items), ...extra });
  const check = async (d) => (await import('../../src/engine/schema/validate.js')).validate(d);

  it('a barcode symbology bwip-js does not draw is an error with the id meant ("qr" → "qrcode"); the render goes on', async () => {
    const d = def([{ type: 'barcode', name: 'QR', x: 0, y: 0, w: 60, h: 60, symbology: 'qr', value: 'hello' }, item()]);
    const v = await check(d);
    expect(v.errors).toEqual(['QR: "qr" is not a barcode symbology (did you mean "qrcode"?)']);
    const m = await render(d, { fontStore });
    expect(m.pages.flatMap(texts).join(' ')).toMatch(/Barcode error: "qr" is not a barcode/);
    expect(m.warnings.filter(w => /"qr"/.test(w))).toHaveLength(1); // said once, by the render
    expect((await check(def([{ type: 'barcode', name: 'Q', x: 0, y: 0, w: 60, h: 60, symbology: 'qrcode', value: 'x' }]))).errors).toEqual([]);
  });
  it('the symbology list is bwip-js\'s own', async () => {
    const { BWIP_IDS, SYMBOLOGIES } = await import('../../src/engine/items/barcode.js');
    const bwip = (await import('bwip-js')).default;
    expect([...BWIP_IDS].sort()).toEqual(bwip.symbolList.map(s => s.bcid).sort());
    for (const s of SYMBOLOGIES) expect(BWIP_IDS.has(s.id), s.id).toBe(true);
  });
  it('an unknown function is an error wherever the expression is: item, cell, data set field, filter, parameter, report function', async () => {
    const d = def([item({ value: '=Frobnicate(1)' }),
      { type: 'table', name: 'Tb', x: 0, y: 20, w: 100, h: 28, dataSet: 'Rows', columns: [{ width: 100 }], detail: [{ height: 14, cells: [{ value: '=Fields.a & IsNumber(Fields.a)' }] }] },
      item({ name: 'Tpl', value: 'Total {Summ(Fields.a)}' })], {
      dataSets: [{ name: 'Rows', source: 'src', path: '$.rows', fields: [{ name: 'a' }, { name: 'b', value: '=Trimm(Fields.a)' }], filters: [{ expr: '=Lenn(Fields.a)', op: '>', value: '=0' }] }],
      parameters: [{ name: 'p', type: 'string', default: '=Todayy()' }],
      functions: [{ name: 'Twice', params: ['x'], body: '=x * Dubble(x)' }] });
    const e = (await check(d)).errors;
    expect(e).toEqual(expect.arrayContaining([
      'T: Unknown function "Frobnicate"',
      'Tb: Unknown function "IsNumber"',
      'Tpl: Unknown function "Summ" (did you mean "Sum"?)',
      'Data set "Rows": Unknown function "Trimm" (did you mean "Trim"?)',
      'Data set "Rows": Unknown function "Lenn" (did you mean "Len"?)',
      'Parameter "p": Unknown function "Todayy" (did you mean "Today"?)',
      'Function "Twice": Unknown function "Dubble"',
    ]));
    // still renders: the item shows #Error and the render says why, once
    const m = await render(d, { fontStore, parameters: { p: 'x' } });
    expect(m.warnings.filter(w => /Frobnicate/.test(w))).toHaveLength(1);
  });
  it('known functions, .NET methods, Code.<report function> and String.Format are fine; Code.Missing is not', async () => {
    const ok = def([item({ value: '=IsNumeric(Fields.a) & Code.Twice(2) & Twice(1) & "a".ToUpper() & String.Format("{0}", 1) & Lookup(1, 1, 1, "Rows") & IIF(true, 1, 2)' })], { functions: [{ name: 'Twice', params: ['x'], body: '=x * 2' }] });
    expect((await check(ok)).errors).toEqual([]);
    expect((await check(def([item({ value: '=Code.Missing(1)' })]))).errors).toEqual(['T: The report has no function "Missing" (Code.Missing)']);
  });
  it('IsNumeric is VB\'s: numbers, Booleans and numeric text in the report locale', async () => {
    const d = def([item({ value: '=IsNumeric(12) & "," & IsNumeric("1,23,456.5") & "," & IsNumeric("12a") & "," & IsNumeric(True) & "," & IsNumeric(Nothing) & "," & IsNumeric(Today())' })], { locale: 'en-IN' });
    const m = await render(d, { fontStore });
    expect(m.pages.flatMap(texts).join('')).toBe('True,True,False,True,False,False');
  });
  it('Lookup into another data set named in single quotes is no false alarm; a real typo still is', async () => {
    const { fieldIssues } = await import('../../src/designer/fieldCheck.js');
    const sets = [{ name: 'Txn', fields: [{ name: 'currency' }, { name: 'amount' }] }, { name: 'FX', fields: [{ name: 'currency' }, { name: 'toInr' }] }];
    expect(fieldIssues("=Fields.amount * Lookup(Fields.currency, Fields.currency, Fields.toInr, 'FX')", sets, 'Txn')).toEqual([]);
    expect(fieldIssues('=Fields.amount * Lookup(Fields.currency, Fields.currency, Fields.toInr, "FX")', sets, 'Txn')).toEqual([]);
    expect(fieldIssues("=Lookup(Fields.currency, Fields.currency, Fields.toInrr, 'FX')", sets, 'Txn').map(i => i.suggest)).toEqual(['toInr']);
  });
  it('drillRefs lists the drill-through targets with where they are (stress-ledger → account-detail)', async () => {
    const { drillRefs } = await import('../../src/engine/reuse.js');
    const d = JSON.parse(fs.readFileSync(new URL('../../reports/stress-ledger.pw.json', import.meta.url), 'utf8'));
    expect(drillRefs(d)).toEqual(expect.arrayContaining([{ report: 'account-detail', where: 'Ledger cell' }]));
    expect(drillRefs({ sections: { body: { items: [{ type: 'textbox', name: 'X', action: { type: 'report', report: '=Fields.r' } }] } } })).toEqual([]);
  });
});

describe('saving warns about drill-through reports that do not exist', () => {
  let tmp;
  const ORIGIN = 'http://pw.test';
  const put = async (id, def) => {
    const { PUT } = await import('../../app/api/reports/[id]/route.js');
    const res = await PUT(new Request(`${ORIGIN}/api/reports/${id}`, { method: 'PUT', headers: { host: 'pw.test', origin: ORIGIN, 'content-type': 'application/json', 'if-match': '*' }, body: JSON.stringify(def) }), { params: Promise.resolve({ id }) });
    return res.json();
  };
  it('names the item and the missing report; a report that exists is fine', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r4-'));
    process.env.PW_STORAGE = `sqlite:${path.join(tmp, 's.db')}`;
    try {
      const link = (report) => report && { type: 'report', report, params: {} };
      const def = (name, report) => ({ ...report && {}, $schema: 'reportwright/report@1', name, page: { size: 'A4' }, sections: { body: { items: [
        { type: 'textbox', name: 'Go', x: 0, y: 0, w: 100, h: 14, value: 'open', ...(report ? { action: link(report) } : {}) }] } } });
      const a = await put('r4-ledger', def('Ledger', 'account-detail'));
      expect(a.ok).toBe(true);
      expect(a.missing).toEqual(['Go: it opens the report "account-detail", which does not exist']);
      expect(a.warnings).toEqual(expect.arrayContaining(a.missing));
      await put('account-detail', def('Account detail'));
      expect((await put('r4-ledger', def('Ledger', 'account-detail'))).missing).toEqual([]);
    } finally { delete process.env.PW_STORAGE; fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

describe('render speed: no layout pass for nothing', () => {
  // a report function counts how often the table's cells are laid out, across every pass of one render
  const counted = (rows, extra = []) => ({ ...report([
    { type: 'table', name: 'Big', x: 0, y: 0, w: 300, h: 28, dataSet: 'Rows', columns: [{ width: 300 }], detail: [{ height: 14, cells: [{ value: '=Code.Tick(Fields.v)' }] }] },
    ...extra], { data: { rows } }), functions: [{ name: 'Tick', params: ['x'], body: '=x' }] });
  const passes = async (def, opts = {}) => { const fnCount = { n: 0 }; const { FontStore } = await import('../../src/engine/index.js'); const { fontFile } = await import('../../src/engine/text/fonts.js');
    const store = opts.fresh ? new FontStore(async (k) => fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'fonts', fontFile(k)))) : fontStore;
    await render(def, { fontStore: store, fnCount, loadReport: async () => ({ $schema: 'reportwright/report@1', sections: { body: { items: [] } } }) }); return fnCount.n / def.dataSources[0].data.rows.length; };
  it('data in Hindi and Arabic: the fallback fonts and the shaper load before the layout, not after a first pass', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ v: i % 2 ? `राधिका ${i}` : `محمد ${i}` }));
    expect(await passes(counted(rows), { fresh: true })).toBe(1);
  });
  it('a subreport elsewhere: the pass that collects subreport requests does not lay out the table', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ v: `r${i}` }));
    expect(await passes(counted(rows, [{ type: 'subreport', name: 'S', x: 0, y: 40, w: 200, h: 40, report: 'child' }]))).toBe(1);
  });
  it('fontsFor: one face per script (regular, bold) and the shaper for complex scripts only', async () => {
    const { fontsFor } = await import('../../src/engine/text/fonts.js');
    expect(fontsFor(['plain Latin, Zoë, Łukasiewicz'])).toEqual([]);
    expect(fontsFor(['राधिका'])).toEqual(['NotoSansDevanagari-Regular', 'NotoSansDevanagari-Bold', 'harfbuzz']);
  });
});

describe('a busy server: data reads are tried again', () => {
  const res = (status, h = {}) => ({ status, ok: status < 400, headers: { get: (k) => h[k.toLowerCase()] ?? null } });
  it('503 twice, then 200: two retries reported (1/3, 2/3), Retry-After honoured', async () => {
    const { reportFetch } = await import('../../src/viewer/dataFetch.js');
    const answers = [res(503, { 'retry-after': '2' }), res(503), res(200)];
    const seen = [], waits = [];
    const f = reportFetch('http://pw.test', async () => answers.shift(), { onRetry: (r) => seen.push(r), wait: async (ms) => { waits.push(ms); } });
    expect((await f('http://pw.test/api/sample/hard?rows=3000')).status).toBe(200);
    expect(seen).toEqual([{ attempt: 1, max: 3, status: 503 }, { attempt: 2, max: 3, status: 503 }]);
    expect(waits[0]).toBe(2000);
  });
  it('gives up after 3 retries with the last answer; never retries a write', async () => {
    const { withRetry } = await import('../../src/viewer/dataFetch.js');
    let n = 0;
    const f = withRetry(async () => { n++; return res(503); }, { wait: async () => {} });
    expect((await f('http://x/a')).status).toBe(503);
    expect(n).toBe(4);
    n = 0;
    expect((await f('http://x/a', { method: 'POST', body: '{}' })).status).toBe(503);
    expect(n).toBe(1);
  });
});

describe('narrow columns: numbers never break, words only between words', () => {
  const cellTexts = async (values, width) => {
    const d = report([{ type: 'table', name: 'T', x: 0, y: 0, w: width, h: 14, dataSet: 'Rows', columns: [{ width }],
      detail: [{ height: 14, cells: [{ value: '=Fields.v', style: { fontSize: 9, padding: [2, 3, 2, 3] } }] }] }], { data: { rows: values.map(v => ({ v })) } });
    const m = await render(d, { fontStore });
    return m.pages[0].items.filter(i => i.t === 'text').map(i => ({ lines: i.lines.map(l => l.text), size: i.size }));
  };
  it('a number wider than the cell stays on one line (a smaller font), never "4,966,681.4|5"', async () => {
    const [n] = await cellTexts(['4,966,681.45'], 46);
    expect(n.lines).toEqual(['4,966,681.45']);
    expect(n.size).toBeLessThan(9);
  });
  it('one word a little wider than the cell: smaller, not "restructure|d"', async () => {
    const [w] = await cellTexts(['Restructured'], 52);
    expect(w.lines).toEqual(['Restructured']);
  });
  it('words wrap between words at the normal size; a very long word still breaks as the last resort', async () => {
    const [a, b] = await cellTexts(['Loan against property', 'Supercalifragilisticexpialidocious'], 60);
    for (const l of a.lines) expect(['Loan', 'against', 'property', 'Loan against', 'against property']).toContain(l);
    expect(a.lines.join(' ')).toBe('Loan against property');
    expect(a.size).toBe(9);
    expect(b.lines.length).toBeGreaterThan(1);
  });
});

describe('data bar labels', () => {
  it('stay inside their cell, so inside the page, whatever the bar length', async () => {
    const rows = [{ v: 4966681.45 }, { v: 4900000 }, { v: 10 }, { v: 4950000 }];
    const d = report([{ type: 'table', name: 'T', x: 440, y: 0, w: 83, h: 14, dataSet: 'Rows', columns: [{ width: 83 }],
      detail: [{ height: 14, cells: [{ value: '=Fields.v', visual: { type: 'databar', value: '=Fields.v', max: '=10000000', format: 'N2' } }] }] }], { data: { rows } });
    const m = await render(d, { fontStore });
    const labels = m.pages[0].items.filter(i => i.t === 'text' && /\d,\d/.test(i.lines[0].text));
    expect(labels.length).toBeGreaterThan(0);
    for (const t of labels) for (const l of t.lines) expect(l.x + l.w).toBeLessThanOrEqual(36 + 440 + 83 + 0.01);
  });
});

describe('a list row taller than a page', () => {
  it('starts on the page it reaches and continues, borders on every piece, no "lower part is cut"', async () => {
    const kids = (n) => Array.from({ length: n }, (_, i) => ({ k: `${n}-${i}` }));
    const card = { type: 'container', name: 'Card', x: 0, y: 0, w: 500, h: 60, style: { border: '0.5 solid #cccccc' }, items: [
      { type: 'textbox', name: 'N', x: 6, y: 4, w: 300, h: 14, value: '=Fields.name' },
      { type: 'table', name: 'Inner', x: 6, y: 24, w: 400, h: 28, dataSet: 'Kids', columns: [{ width: 400 }], header: [{ height: 14, cells: [{ value: 'Kid' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.k' }] }] }] };
    const def = { ...report([{ type: 'list', name: 'L', x: 0, y: 0, w: 500, h: 70, dataSet: 'Rows', items: [card] }], { data: { rows: [{ name: 'A', kids: kids(30) }, { name: 'B', kids: kids(70) }] } }),
      dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }, { name: 'Kids', relation: { parent: 'Rows', path: '$.kids[*]' } }] };
    const m = await render(def, { fontStore });
    expect(m.warnings.join(' ')).not.toMatch(/taller than the page|need "Keep together"/);
    // B starts on page 1 under A, not on page 2
    expect(m.pages[0].items.some(i => i.t === 'text' && i.lines[0].text === 'B')).toBe(true);
    const all = m.pages.flatMap(texts);
    for (let i = 0; i < 70; i++) expect(all).toContain(`70-${i}`);
    // the card's sides are drawn on every page it spans
    for (const p of m.pages.slice(1)) expect(p.items.some(i => i.t === 'line' && i.x1 === i.x2 && Math.abs(i.x1 - 36) < 1)).toBe(true);
  });
});

describe('Instant visuals starts with fields worth a picture', () => {
  it('low-cardinality text fields and an amount, never Id or a name', async () => {
    const { instantPicks } = await import('../../src/designer/tableGen.js');
    const fields = [{ name: 'id', type: 'number' }, { name: 'borrower', type: 'string' }, { name: 'borrowerName', type: 'string' }, { name: 'region', type: 'string' },
      { name: 'status', type: 'string' }, { name: 'rate', type: 'number' }, { name: 'outstanding', type: 'number' }];
    const rows = Array.from({ length: 180 }, (_, i) => ({ id: i, borrower: `B${i}`, borrowerName: `Name ${i}`, region: ['N', 'S', 'E', 'W'][i % 4], status: ['Active', 'Closed', 'Overdue'][i % 3], rate: 9.5, outstanding: i * 100 }));
    expect(instantPicks(fields, rows)).toEqual(['status', 'region', 'outstanding']);
    expect(instantPicks(fields, [])).toEqual(['borrower', 'region', 'outstanding']);
  });
});

describe('icon sets', () => {
  it('"reverse": a high value gets the first (worst) icon: red for many days overdue', async () => {
    const colours = async (reverse) => {
      const d = report([{ type: 'iconset', name: 'I', x: 0, y: 0, w: 18, h: 18, iconSet: 'trafficLights', value: '=90', lower: '=33', upper: '=67', ...(reverse ? { reverse: true } : {}) }]);
      const m = await render(d, { fontStore });
      return m.pages[0].items.filter(i => i.fill && i.fill !== 'none').map(i => i.fill).join(',');
    };
    const normal = await colours(false), rev = await colours(true);
    expect(rev).not.toBe(normal);
    const low = await (async () => { const d = report([{ type: 'iconset', name: 'I', x: 0, y: 0, w: 18, h: 18, iconSet: 'trafficLights', value: '=10', lower: '=33', upper: '=67' }]); const m = await render(d, { fontStore }); return m.pages[0].items.filter(i => i.fill && i.fill !== 'none').map(i => i.fill).join(','); })();
    expect(rev).toBe(low);
  });
});
