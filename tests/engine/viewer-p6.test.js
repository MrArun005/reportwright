// Phase 6 viewer: UI languages, search, toolbar arrangement, galley view, frozen table headers.
import { describe, it, expect } from 'vitest';
import { STRINGS, LANGUAGES, t, tParts, dirOf, pickLang } from '../../src/i18n/index.js';

const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('UI languages', () => {
  it('ships nine languages', () => {
    expect(LANGUAGES).toEqual(['en', 'hi', 'es', 'fr', 'de', 'ja', 'zh', 'pt-BR', 'ar']);
  });
  it.each(LANGUAGES)('%s has every key, with the same placeholders, and is not an English copy', (lang) => {
    const en = STRINGS.en, tab = STRINGS[lang];
    expect(Object.keys(tab).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(vars(tab[k]), `${lang}.${k}`).toEqual(vars(en[k]));
    if (lang !== 'en') {
      const same = Object.keys(en).filter(k => tab[k] === en[k] && /[a-z]{4}/i.test(en[k]));
      expect(same.length / Object.keys(en).length, `${lang} copies English: ${same.join(', ')}`).toBeLessThan(0.1);
    }
  });
  it('picks a language from ?lang=, falls back to English, and knows the direction', () => {
    expect(pickLang('HI')).toBe('hi');
    expect(pickLang('hi-IN')).toBe('hi');
    expect(pickLang('xx')).toBe('en');
    expect(pickLang(undefined)).toBe('en');
    expect(t('xx', 'parameters')).toBe('Parameters');
    expect(t('hi', 'pagesRows', { pages: 2, rows: 3, ms: 4 })).toBe('2 पृष्ठ · 3 पंक्तियाँ · 4 ms');
    expect(dirOf('hi')).toBe('ltr');
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('ar-EG')).toBe('rtl');
    expect(pickLang('pt-br')).toBe('pt-BR');
    expect(pickLang('pt')).toBe('en'); // only Brazilian Portuguese ships
    expect(tParts('en', 'accountsOff')).toEqual(['Accounts are off on this server. Set ', 'setting', ' to turn them on.']);
    expect(t('hi', 'noSuchKey')).toBe('noSuchKey');
  });
});

import { arrangeToolbar, galleyDefinition, findText, frozenAt, rangeValue } from '../../src/viewer/logic.js';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

describe('toolbar', () => {
  const built = [{ id: 'a', group: 'g1' }, { id: 'b', group: 'g1' }, { id: 'c', group: 'g2' }];
  it('hides by id and adds after an id, or at the end', () => {
    const out = arrangeToolbar(built, { hide: ['b'], add: [{ id: 'x', label: 'X', after: 'a' }, { id: 'y', label: 'Y' }] });
    expect(out.map(i => i.id)).toEqual(['a', 'x', 'c', 'y']);
    expect(out[1]).toMatchObject({ group: 'g1', custom: true });
  });
  it('an unknown "after" goes to the end; a custom id never replaces a built-in', () => {
    const out = arrangeToolbar(built, { add: [{ id: 'z', label: 'Z', after: 'nope' }, { id: 'a', label: 'dup' }, null] });
    expect(out.map(i => i.id)).toEqual(['a', 'b', 'c', 'z']);
  });
  it('after a hidden item: placed where that item was', () => {
    const out = arrangeToolbar(built, { hide: ['b'], add: [{ id: 'x', label: 'X', after: 'b' }] });
    expect(out.map(i => i.id)).toEqual(['a', 'x', 'c']);
  });
  it('no options: the built-ins unchanged', () => {
    expect(arrangeToolbar(built)).toEqual(built);
  });
});

const tableRows = (n) => report([{
  type: 'table', name: 'T', x: 0, y: 40, w: 200, h: 40, dataSet: 'Rows', repeatHeader: true, columns: [{ width: 200 }],
  header: [{ height: 20, cells: [{ value: 'No' }] }], detail: [{ height: 20, cells: [{ value: '=Fields.n' }] }],
}], { data: { rows: Array.from({ length: n }, (_, i) => ({ n: i + 1 })) } });

describe('galley view', () => {
  it('renders the report as one long page of the same width', async () => {
    const def = tableRows(120);
    const paged = await render(def, { fontStore });
    const galley = await render(galleyDefinition(def), { fontStore });
    expect(paged.pages.length).toBeGreaterThan(1);
    expect(galley.pages).toHaveLength(1);
    expect(galley.width).toBe(paged.width);
    expect(galley.height).toBeGreaterThan(paged.height);
    expect(def.page.size).toBe('A4'); // the definition itself is not changed
  });
  it('keeps a landscape width and the margins; a pageless report stays as it is', () => {
    const g = galleyDefinition({ page: { size: 'A4', orientation: 'landscape', margins: [10, 20, 30, 40] } });
    expect(g.page).toEqual({ size: 'Pageless', width: 841.89, margins: [10, 20, 30, 40] });
    const pl = { page: { size: 'Pageless', width: 900 } };
    expect(galleyDefinition(pl)).toBe(pl);
  });
});

describe('frozen table headers', () => {
  it('each page lists the repeated header rectangle and where the table ends on it', async () => {
    const out = await render(tableRows(120), { fontStore });
    const [p1, p2] = out.pages;
    // page 1: the table starts 40 pt below the top of the body
    expect(p1.frozen).toHaveLength(1);
    expect(p1.frozen[0]).toMatchObject({ x: 36, w: 200, h: 20 });
    expect(p1.frozen[0].y).toBeCloseTo(36 + 40);
    // page 2: the repeated header sits at the top of the body
    expect(p2.frozen[0].y).toBeCloseTo(36);
    expect(p2.frozen[0].end).toBeGreaterThan(p2.frozen[0].y + 20);
    expect(p2.frozen[0].end).toBeLessThanOrEqual(out.height - 36 + 0.01);
    const last = out.pages[out.pages.length - 1].frozen[0];
    expect(last.end).toBeLessThan(out.height - 100); // the table ends part way down the last page
  });
  it('a table without a repeated header has no frozen region', async () => {
    const def = tableRows(120);
    def.sections.body.items[0].repeatHeader = false;
    const out = await render(def, { fontStore });
    expect(out.pages.every(p => !p.frozen)).toBe(true);
  });
  it('frozenAt picks the header to pin for a scroll position', () => {
    const page = { frozen: [{ x: 36, y: 100, w: 200, h: 20, end: 600 }] };
    expect(frozenAt(page, 90)).toBeNull(); // the header is still in view
    expect(frozenAt(page, 300)).toMatchObject({ y: 100 });
    expect(frozenAt(page, 590)).toBeNull(); // the table is about to end
    expect(frozenAt({ items: [] }, 300)).toBeNull();
    expect(frozenAt(undefined, 300)).toBeNull();
  });
});

describe('search', () => {
  const model = { pages: [
    { items: [{ t: 'text', size: 10, lines: [{ text: 'Total', x: 0, y: 20, w: 20 }, { text: 'due', x: 25, y: 20, w: 14 }] }] },
    { items: [{ t: 'text', size: 10, lines: [{ text: 'Subtotal and total', x: 0, y: 40, w: 80 }] }, { t: 'rect', x: 0, y: 0, w: 1, h: 1 }] },
  ] };
  it('joins a justified line (one run per word) before matching', () => {
    expect(findText(model, 'total due')).toHaveLength(1);
  });
  it('ignores case unless asked', () => {
    expect(findText(model, 'total').map(h => h.page)).toEqual([0, 1]);
    expect(findText(model, 'Total', { matchCase: true }).map(h => h.page)).toEqual([0]);
  });
  it('whole word', () => {
    expect(findText(model, 'total', { wholeWord: true }).map(h => h.text)).toEqual(['Total due', 'Subtotal and total']);
    expect(findText(model, 'sub', { wholeWord: true })).toEqual([]);
    expect(findText(model, 'total and', { wholeWord: true })).toHaveLength(0);
  });
  it('a whole word works for Hindi: combining marks belong to the word', () => {
    const m = { pages: [{ items: [{ t: 'text', size: 10, lines: [{ text: 'कुल राशि', x: 0, y: 10, w: 40 }] }] }] };
    expect(findText(m, 'कुल', { wholeWord: true })).toHaveLength(1);
    expect(findText(m, 'कु', { wholeWord: true })).toHaveLength(0);
  });
  it('treats the query as text, not a pattern', () => {
    const m = { pages: [{ items: [{ t: 'text', size: 10, lines: [{ text: 'a+b (c)', x: 0, y: 10, w: 40 }] }] }] };
    expect(findText(m, 'a+b (c')).toHaveLength(1);
    expect(findText(m, '.*')).toHaveLength(0);
  });
  it('hits carry the page, a highlight box and the line text', () => {
    const [h] = findText(model, 'due');
    expect(h).toMatchObject({ page: 0, text: 'Total due' });
    expect(h.w).toBeGreaterThan(30);
    expect(findText(model, '')).toEqual([]);
    expect(findText(null, 'x')).toEqual([]);
  });
});

describe('range parameters', () => {
  it('two bounds become one list value; a missing bound takes the editor limit', () => {
    expect(rangeValue('10', '50', {})).toBe('10,50');
    expect(rangeValue('', '', { min: 0, max: 100 })).toBe('');
    expect(rangeValue('', '50', { min: 0 })).toBe('0,50');
    expect(rangeValue('10', '', { max: 100 })).toBe('10,100');
    expect(rangeValue('10', '', {})).toBe('10,10');
    expect(rangeValue('2026-01-01', '2026-03-31', {})).toBe('2026-01-01,2026-03-31');
  });
});
