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
