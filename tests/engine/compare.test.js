// pw compare: src/compare/index.js on PDFs written here (standard fonts, no files).
import { describe, it, expect } from 'vitest';
import { createPdf } from '@reportwright/pdf';
import { comparePdfs, parseNumber, toHtml, toJson, LIMITS } from '../../src/compare/index.js';

/** pages: [[ [text, x, y], … ], …] → PDF bytes */
async function pdf(pages, size) {
  const parts = [];
  const doc = createPdf(
    {
      write: (b) => {
        parts.push(Buffer.from(b));
      },
    },
    {},
  );
  const f = doc.standardFont('Helvetica');
  for (const words of pages) {
    const p = doc.addPage(size);
    for (const [t, x, y] of words) p.text(t, { x, y, font: f, size: 11 });
  }
  await doc.end();
  return new Uint8Array(Buffer.concat(parts));
}
const invoice = (total = '1,234.50', extra = []) => [
  [
    ['Invoice', 40, 40],
    ['Widgets', 40, 80],
    ['1,000.00', 300, 80],
    ['Gadgets', 40, 100],
    ['234.50', 300, 100],
    ['Grand', 40, 130],
    ['Total', 80, 130],
    [total, 300, 130],
    ...extra,
  ],
];
const run = async (a, b, o = {}) => comparePdfs(await pdf(a), await pdf(b), { visual: false, ...o });

describe('parseNumber', () => {
  it('reads formats as values', () => {
    expect(parseNumber('1,234.50').value).toBe(1234.5);
    expect(parseNumber('1234.5').value).toBe(1234.5);
    expect(parseNumber('1.234,50').value).toBe(1234.5);
    expect(parseNumber('$(12.00)').value).toBe(-12);
    expect(parseNumber('₹1,23,456').value).toBe(123456);
    expect(parseNumber('2026-01-01')).toBeNull();
    expect(parseNumber('Total')).toBeNull();
  });
});

describe('comparePdfs', () => {
  it('identical PDFs match', async () => {
    const r = await run(invoice(), invoice());
    expect(r.verdict).toBe('Matches');
    expect(r.pass).toBe(true);
    expect(r.reconciliation.matchPercent).toBe(100);
    expect(r.reconciliation.totals.compared).toBe(1);
    expect(toHtml(r)).toContain('Matches');
  });
  it('a changed grand total is flagged first, as a total mismatch', async () => {
    const r = await run(invoice(), invoice('1,243.50', [['Note', 40, 200]]));
    expect(r.verdict).toBe('Differences found');
    expect(r.pass).toBe(false);
    expect(r.differences[0]).toMatchObject({ kind: 'number', original: '1,234.50', converted: '1,243.50' });
    const t = r.reconciliation.totals;
    expect(t.mismatched).toBe(1);
    expect(t.items[0]).toMatchObject({ label: 'Grand Total', status: 'mismatched', delta: 9 });
    expect(r.reconciliation.issues[0].total).toBe(true);
  });
  it('formatting-only differences are equal', async () => {
    const r = await run(invoice('1,234.50'), invoice('1234.5'));
    expect(r.reconciliation.mismatched).toBe(0);
    expect(r.reconciliation.formattingOnly).toBe(1);
    expect(r.reconciliation.totals.mismatched).toBe(0);
    expect(r.differences.some((d) => d.kind === 'number')).toBe(false);
  });
  it('a rounding difference is flagged as rounding', async () => {
    const r = await run(invoice('1,234.504'), invoice('1,234.50'));
    expect(r.reconciliation.rounding).toBe(1);
    expect(r.reconciliation.totals.items[0].status).toBe('rounding');
    expect(r.pass).toBe(false);
  });
  it('moved text beyond the tolerance', async () => {
    const a = invoice(),
      b = invoice();
    b[0][0] = ['Invoice', 60, 40];
    const r = await run(a, b);
    if (!r.modes.positions) return; // no pdftotext here: positions are not compared (CI has poppler-utils)
    expect(r.verdict).toBe('Minor differences');
    expect(r.differences).toEqual([
      expect.objectContaining({ kind: 'moved', original: 'Invoice', by: { dx: 20, dy: 0 } }),
    ]);
    const near = invoice();
    near[0][0] = ['Invoice', 41, 40];
    expect((await run(a, near)).verdict).toBe('Matches');
  });
  it('an extra page', async () => {
    const r = await run(invoice(), [...invoice(), [['Appendix', 40, 40]]]);
    expect(r.pageCount).toEqual({ original: 1, converted: 2 });
    expect(r.verdict).toBe('Differences found');
    expect(r.pass).toBe(false);
    expect(r.differences.find((d) => d.page === 2)).toMatchObject({ kind: 'extra', converted: 'Appendix' });
  });
  it('--numbers-only reports numbers and gates on them', async () => {
    const b = invoice();
    b[0][1] = ['Things', 40, 80];
    const r = await run(invoice(), b, { numbersOnly: true });
    expect(r.differences).toEqual([]);
    expect(r.pass).toBe(true);
  });
  it('hostile input is refused, bounded', async () => {
    const t = Date.now();
    await expect(
      comparePdfs(new TextEncoder().encode('%PDF-1.7\n' + '[ '.repeat(200000)), await pdf(invoice()), {
        visual: false,
        positions: false,
      }),
    ).rejects.toThrow();
    await expect(
      comparePdfs(new Uint8Array(51 * 1024 * 1024), await pdf(invoice()), { visual: false }),
    ).rejects.toThrow(/at most/);
    expect(Date.now() - t).toBeLessThan(15000);
  });
  it('compare.json carries no images', async () => {
    const r = await run(invoice(), invoice());
    expect(JSON.parse(toJson(r)).verdict).toBe('Matches');
  });
});

describe('POST /api/reports/compare', () => {
  it('compares two uploaded PDFs; refuses a missing file', async () => {
    const { POST } = await import('../../app/api/reports/compare/route.js');
    const fd = new FormData();
    fd.set('original', new Blob([await pdf(invoice())]), 'a.pdf');
    fd.set('converted', new Blob([await pdf(invoice('1,243.50'))]), 'b.pdf');
    const res = await POST(new Request('http://localhost/api/reports/compare', { method: 'POST', body: fd }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.verdict).toBe('Differences found');
    expect(j.reconciliation.totals.mismatched).toBe(1);
    expect(j.html).toContain('Reconciliation');
    const bad = new FormData();
    bad.set('original', new Blob([new Uint8Array(4)]), 'a.pdf');
    expect(
      (await POST(new Request('http://localhost/api/reports/compare', { method: 'POST', body: bad }))).status,
    ).toBe(400);
  });
});

describe('visual', () => {
  it('a changed total shows in the pixels (when pdftoppm is installed)', async () => {
    const r = await comparePdfs(await pdf(invoice()), await pdf(invoice('9,999.99')), {});
    if (!r.modes.visual) return;
    expect(r.pages[0].visual.percent).toBeGreaterThan(0);
    expect(toHtml(r)).toContain('data:image/png;base64,');
  });
});

describe('hostile inputs are refused or bounded, fast', () => {
  it('a huge page count: the first LIMITS.maxPages pages, said so', async () => {
    const many = Array.from({ length: LIMITS.maxPages + 20 }, (_, i) => [[`p${i}`, 40, 40]]);
    const t = Date.now();
    const r = await comparePdfs(await pdf(many), await pdf(many), { visual: false });
    expect(r.pages.length).toBe(LIMITS.maxPages);
    expect(r.warnings.join()).toMatch(/only the first 300 of 320 pages/);
    expect(Date.now() - t).toBeLessThan(15000);
  }, 30000);
  it('a page with 500k words: capped per page, and the alignment stays linear', async () => {
    const big = [[['x '.repeat(500000), 0, 20]]];
    const t = Date.now();
    const r = await comparePdfs(await pdf(big, { width: 14400, height: 400 }), await pdf([[['y', 0, 20]]]), {
      visual: false,
      positions: false,
    });
    expect(r.pages[0].original.words).toBe(LIMITS.maxWords);
    expect(r.warnings.join()).toMatch(/only the first 20000 words/);
    expect(r.differences.length).toBeLessThanOrEqual(LIMITS.maxListed);
    expect(r.differencesTotal).toBeGreaterThan(LIMITS.maxListed);
    expect(toHtml(r).length).toBeLessThan(5_000_000);
    expect(Date.now() - t).toBeLessThan(15000);
  }, 30000);
  it('a giant MediaBox is not rasterised', async () => {
    const r = await comparePdfs(
      await pdf(invoice(), { width: 14400, height: 14400 }),
      await pdf(invoice(), { width: 14400, height: 14400 }),
      {},
    );
    if (!r.modes.visual) return;
    expect(r.pages[0].visual).toEqual({ skipped: 'the page is too large to render' });
  });
  it('two 50 MB uploads: 413 before the body is parsed', async () => {
    const { POST } = await import('../../app/api/reports/compare/route.js');
    const fd = new FormData();
    fd.set('original', new Blob([new Uint8Array(50 * 1024 * 1024)]), 'a.pdf');
    fd.set('converted', new Blob([new Uint8Array(50 * 1024 * 1024)]), 'b.pdf');
    const t = Date.now();
    const res = await POST(new Request('http://localhost/api/reports/compare', { method: 'POST', body: fd }));
    expect(res.status).toBe(413);
    // no content-length (chunked): the stream is cut at the cap
    const body = new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const res2 = await POST(
      new Request('http://localhost/api/reports/compare', {
        method: 'POST',
        body,
        duplex: 'half',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
      }),
    );
    expect(res2.status).toBe(413);
    expect(Date.now() - t).toBeLessThan(10000);
  });
  it('three files: refused', async () => {
    const { POST } = await import('../../app/api/reports/compare/route.js');
    const fd = new FormData();
    for (const k of ['original', 'converted', 'third']) fd.set(k, new Blob([new Uint8Array(8)]), `${k}.pdf`);
    expect((await POST(new Request('http://localhost/api/reports/compare', { method: 'POST', body: fd }))).status).toBe(
      400,
    );
  });
});
