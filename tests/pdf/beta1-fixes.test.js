// Tester-reported issues for 0.1.0-beta.1: the real reason for an unreadable catalog, one bad page not failing the
// document, createPdf's metadata: false, a merge's tagging claims, the reader's memory.
import { describe, it, expect } from 'vitest';
import { loadPdf, PdfReadError } from '../../packages/pdf/src/index.js';
import { rawPdf, enc } from './reader-tools.js';

describe('PDF-5: a catalog nested past the limit', () => {
  it('reports E_DEPTH with the limit, not "no document catalog"', async () => {
    const deep = '<< /A '.repeat(100_000) + '>>'.repeat(100_000);
    const b = rawPdf([`<< /Type /Catalog /Pages 2 0 R /X ${deep} >>`, '<< /Type /Pages /Kids [] /Count 0 >>']);
    const e = await loadPdf(b).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(PdfReadError);
    expect(e.code).toBe('E_DEPTH');
    expect(e.message).toMatch(/catalog.*deeper than \d+/);
  });
});
