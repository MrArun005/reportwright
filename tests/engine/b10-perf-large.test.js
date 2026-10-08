// B10 A1.5: a classic render past 100,000 rows says once that exportPdfStream would write it in far less memory.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, FontStore, fontFile } from '../../packages/engine/entry.js';

const root = path.join(import.meta.dirname, '..', '..');
const fonts = new FontStore((k) => fs.readFileSync(path.join(root, 'public/fonts', fontFile(k))));
const report = (n) => ({ $schema: 'pagewright/report@1', name: 'Big',
  dataSources: [{ name: 's', type: 'json', data: { rows: Array.from({ length: n }, (_, i) => ({ v: i })) } }],
  dataSets: [{ name: 'R', source: 's', path: '$.rows' }],
  sections: { body: { items: [{ type: 'textbox', name: 'N', x: 0, y: 0, w: 200, h: 20, value: '=Count(Fields.v, "R")' }] } } });
const MSG = /^Large report \(100,001 rows\): exportPdfStream writes it in about 320 MB; render \+ exportPdf holds it all in memory$/;

describe('B10 A1.5 large classic render', () => {
  it('past 100,000 rows: one model warning per render, one console warning per process', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const a = await render(report(100_001), { fontStore: fonts });
      const b = await render(report(100_001), { fontStore: fonts });
      expect(a.warnings.filter(w => MSG.test(w))).toHaveLength(1);
      expect(b.warnings.filter(w => MSG.test(w))).toHaveLength(1);
      expect(warn.mock.calls.filter(c => MSG.test(String(c[0]).replace('[@reportwright/engine] ', '')))).toHaveLength(1);
    } finally { warn.mockRestore(); }
  }, 30000);

  it('at 100,000 rows and below: no warning', async () => {
    const m = await render(report(100_000), { fontStore: fonts });
    expect(m.warnings.some(w => /^Large report/.test(w))).toBe(false);
  }, 30000);
});

describe('B10 A1.5 largeReportRows', () => {
  const table = (n) => ({ ...report(n), sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'R',
    columns: [{ width: 200 }], detail: [{ height: 18, cells: [{ value: '=Fields.v' }] }] }] },
  pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 0, w: 200, h: 18, value: '="Page " & Globals.PageNumber & " of " & Globals.TotalPages' }] } } });

  it('sets the threshold; a multi-page render warns exactly once; it is a known option', async () => {
    const m = await render(table(1001), { fontStore: fonts, largeReportRows: 1000 });
    expect(m.pages.length).toBeGreaterThan(10);
    expect(m.warnings.filter(w => /^Large report \(1,001 rows\)/.test(w))).toHaveLength(1);
    expect(m.warnings.some(w => /Unknown option/.test(w))).toBe(false);
  });

  it('0 or false turns it off; below the threshold says nothing', async () => {
    for (const largeReportRows of [0, false, 2000]) {
      const m = await render(table(1001), { fontStore: fonts, largeReportRows });
      expect(m.warnings.some(w => /^Large report/.test(w))).toBe(false);
    }
  });
});
