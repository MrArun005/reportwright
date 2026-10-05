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
