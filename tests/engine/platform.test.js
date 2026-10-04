// Phase 7: TOC numbering, image sources and sizes, barcode options, PDF passwords.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report, texts } from '../helpers.js';
import { tocNumbers, formatNumber } from '../../src/engine/items/toc.js';

const tb = (name, value, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 18, value, ...extra });

describe('TOC numbering', () => {
  it('formats decimal, roman and alpha', () => {
    expect([1, 4, 9, 14, 2026].map(n => formatNumber(n, 'roman'))).toEqual(['I', 'IV', 'IX', 'XIV', 'MMXXVI']);
    expect([1, 26, 27, 52, 703].map(n => formatNumber(n, 'alpha'))).toEqual(['A', 'Z', 'AA', 'AZ', 'AAA']);
    expect(formatNumber(7, 'decimal')).toBe('7');
    expect(formatNumber(5000, 'roman')).toBe('5000'); // no Roman numeral that large
  });
  it('numbers nested levels, one format per level (the last repeats)', () => {
    const e = [{ level: 0 }, { level: 1 }, { level: 1 }, { level: 0 }, { level: 1 }, { level: 2 }];
    expect(tocNumbers(e, 'decimal')).toEqual(['1', '1.1', '1.2', '2', '2.1', '2.1.1']);
    expect(tocNumbers(e, ['roman', 'alpha'])).toEqual(['I', 'I.A', 'I.B', 'II', 'II.A', 'II.A.A']);
    expect(tocNumbers([{ level: 2 }], 'decimal')).toEqual(['1.1.1']); // a skipped level counts as 1
  });

  const def = (toc) => report([
    { type: 'toc', name: 'Toc', x: 0, y: 0, w: 400, h: 20, title: 'Contents', ...toc },
    tb('H1', 'Intro', 40, { headingLevel: 1 }),
    tb('H2', 'Scope', 60, { headingLevel: 2 }),
    tb('B', 'Marked', 80, { bookmark: 'Marked' }),
    tb('H3', 'Results', 100, { headingLevel: 1, pageBreakBefore: true }),
  ]);
  it('source: headings lists text boxes with headingLevel, numbered; the PDF outline keeps bookmarks only', async () => {
    const m = await render(def({ source: 'headings', numbering: 'decimal' }), { fontStore });
    const t = texts(m.pages[0]);
    expect(t).toContain('1 Intro');
    expect(t).toContain('1.1 Scope');
    expect(t).toContain('2 Results');
    expect(t).not.toContain('Marked'.padStart(8, ' '));
    expect(t.filter(s => /Marked/.test(s))).toEqual(['Marked']); // the text box itself, not a TOC line
    expect(m.bookmarks.map(b => b.label)).toEqual(['Marked']);
    // page numbers: Results is on page 2
    const i = t.indexOf('2 Results');
    expect(t[i + 1]).toBe('2');
  });
  it('source: bookmarks (the default) ignores headings; numbering is optional', async () => {
    const t = texts((await render(def({}), { fontStore })).pages[0]);
    expect(t).not.toContain('Intro'.padStart(6));
    expect(t.filter(s => s === 'Marked').length).toBe(2); // TOC line + the text box
    const r = texts((await render(def({ numbering: ['roman'] }), { fontStore })).pages[0]);
    expect(r).toContain('I Marked');
  });
});
