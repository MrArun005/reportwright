// R3-A: engine findings from REVIEW-ENGINE-2 (N-numbers), each with variants rather than the single repro.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { evaluate, compile } from '../../src/engine/expr/evaluate.js';
import { translateExpression } from '../../src/importers/rdlx.js';
import { fontStore } from '../helpers.js';
import { formatValue } from '../../src/engine/expr/format.js';

const ev = (src, extra = {}) => evaluate(compile(src), { params: {}, globals: {}, dataSets: {}, fields: null, locale: 'en-US', ...extra });

describe('N4 CDbl / CInt / ToDouble read the report locale', () => {
  it.each([
    ['CDbl("1.234,5")', 'de-DE', 1234.5], ['CDbl("12,5")', 'de-DE', 12.5], ['CDbl("1,234.5")', 'en-US', 1234.5], ['CDbl("-$5")', 'en-US', -5],
    ['CInt("2,5")', 'de-DE', 2], ['ToDouble("1 234,5")', 'fr-FR', 1234.5], ['CDbl("1e3")', 'de-DE', 1000], ['CDbl(" 7 ")', 'en-US', 7],
  ])('%s in %s is %s', (src, locale, want) => expect(ev(src, { locale })).toBe(want));
  it('text that is not a number is still an error', () => expect(() => ev('CDbl("abc")')).toThrow(/not a number/));
  it.each([['"1,23"', 'en-US'], ['"1,234,56"', 'en-US'], ['"12,34,567"', 'en-US']])('N25: %s in %s is not a number', (t, locale) => expect(() => ev(`CDbl(${t})`, { locale })).toThrow(/not a number/));
  it.each([['"12,34,567"', 'en-IN', 1234567], ['"-$1,234.50"', 'en-US', -1234.5], ['"Rs. 1,000"', 'en-IN', 1000], ['"(1,234)"', 'en-US', -1234]])('N25: %s in %s is %s', (t, locale, want) => expect(ev(`CDbl(${t})`, { locale })).toBe(want));
});

describe('N12 Contains is ordinal, as .NET', () => {
  it.each([['Contains("Hello", "ELL")', false], ['Contains("Hello", "ell")', true], ['Contains("straße", "SS")', false], ['Contains("", "")', true]])('%s', (src, want) => expect(ev(src)).toBe(want));
  it('RDL Like "*LL*" on Hello is False', () => {
    const t = translateExpression('=Fields!s.Value Like "*LL*"');
    expect(ev(t.value.slice(1), { fields: { s: 'Hello' } })).toBe(false);
  });
});

describe('N18 text sorts as text unless naturalSort', () => {
  const sorted = async (extra) => {
    const m = await render({ $schema: 'pagewright/report@1', page: { size: 'A4' }, ...extra,
      dataSources: [{ name: 'S', type: 'json', data: ['10', '9', 'a10', 'a9', 'B', 'a'].map(s => ({ s })) }], dataSets: [{ name: 'D', source: 'S', path: '$', fields: [{ name: 's', type: 'string' }], sort: [{ by: '=Fields.s' }] }],
      sections: { body: { height: 40, items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 12, value: '=Join(LookupSet(1, 1, Fields.s, "D"), ",")' }] } } }, { fontStore });
    return m.pages[0].items.flatMap(i => i.lines || []).map(l => l.text).join('');
  };
  it('SSRS order', async () => expect(await sorted({})).toBe('10,9,a,a10,a9,B'));
  it('natural order on request', async () => expect(await sorted({ naturalSort: true })).toBe('9,10,a,a9,a10,B'));
});

describe('N19 / N20 RDL import', () => {
  it('Overall page numbers stay overall', () => expect(translateExpression('="Page " & Globals!OverallPageNumber & " of " & Globals!OverallTotalPages').value).toMatch(/OverallPageNumber.*OverallTotalPages/));
  it.each([['DateFormat.LongTime', 'T'], ['DateFormat.GeneralDate', 'G'], ['DateFormat.ShortTime', 'HH:mm'], ['DateFormat.LongDate', 'D'], ['DateFormat.ShortDate', 'd']])('FormatDateTime %s → %s', (k, f) =>
    expect(translateExpression(`=FormatDateTime(Fields!d.Value, ${k})`).value).toBe(`=Format(Fields.d, "${f}")`));
});

describe('N3 a master report does not take the content report\'s default data set', () => {
  it('unscoped Sum reads the content data set', async () => {
    const master = { $schema: 'pagewright/report@1', page: { size: 'A4' }, dataSources: [{ name: 'MS', type: 'json', data: [{ company: 'ACME', amount: 999 }] }], dataSets: [{ name: 'Company', source: 'MS', path: '$' }],
      sections: { pageHeader: { height: 14, items: [{ type: 'textbox', name: 'H', x: 0, y: 0, w: 200, h: 12, value: '=First(Fields.company, "Company")' }] }, body: { height: 20, items: [] } } };
    const content = { $schema: 'pagewright/report@1', master: 'm', dataSources: [{ name: 'CS', type: 'json', data: [{ amount: 1 }, { amount: 2 }] }], dataSets: [{ name: 'Sales', source: 'CS', path: '$' }],
      sections: { body: { height: 20, items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 12, value: '="Total " & Sum(Fields.amount)' }] } } };
    const m = await render(content, { fontStore, loadReport: async () => master });
    const text = m.pages[0].items.flatMap(i => i.lines || []).map(l => l.text);
    expect(text).toContain('Total 3');
    expect(text).toContain('ACME');
  });
});

describe('.NET formats in other cultures (N5, N13–N17, N28)', () => {
  const f = (v, fmt, locale) => formatValue(v, fmt, { locale, timeZone: 'UTC' });
  const d = new Date('2026-03-05T14:30:00Z');
  it.each([
    [-5, '0', 'ar-SA', '-5'], [-1234.5, '#,##0.00', 'ar-SA', '-1,234.50'], [-5, '0.00', 'fa-IR', '-5.00'], [-1234.5, 'N2', 'ar-SA', '-1,234.50'],
    [1234.5, 'N2', 'es-ES', '1.234,50'], [1234.5, 'N2', 'pl-PL', '1 234,50'], [1234.5, 'N2', 'pt-PT', '1 234,50'], [-1234.5, 'C2', 'es-ES', '-1.234,50 €'],
    [0.1234, '0.0‰', 'en-US', '123.4‰'], [0.5, '#,##0‰', 'de-DE', '500‰'],
  ])('%s %s %s → %s', (v, fmt, l, want) => expect(f(v, fmt, l).replace(/[  ]/g, ' ')).toBe(want));
  it.each([
    ['D', 'ru-RU', /5 марта 2026/], ['d MMMM', 'pl-PL', /^5 marca$/], ['dd MMMM', 'cs-CZ', /^05 března$/], ['MMMM', 'ru-RU', /^март$/],
    ['t', 'ko-KR', /^오후 2:30$/], ['hh:mm tt', 'ja-JP', /^02:30 午後$/], ['dd/MM/yyyy', 'de-DE', /^05\.03\.2026$/], ['dd/MM/yyyy', 'nl-NL', /^05-03-2026$/],
    ['dd\\/MM', 'de-DE', /^05\/03$/], ["dd'/'MM", 'de-DE', /^05\/03$/], ['d', 'fa-IR', /^2026\/3\/5$/], ['dd/MM/yyyy hh:mm tt', 'en-US', /^05\/03\/2026 02:30 PM$/],
  ])('%s in %s', (fmt, l, re) => expect(f(d, fmt, l)).toMatch(re));
});

describe('N11 / §3.4: RunningValue and RowNumber without a scope are over the data region', () => {
  const tbl = (cell, groups = true) => ({ $schema: 'pagewright/report@1', page: { size: 'A4' },
    dataSources: [{ name: 'S', type: 'json', data: [{ g: 'X', h: 'p', v: 1 }, { g: 'X', h: 'p', v: 2 }, { g: 'X', h: 'q', v: 4 }, { g: 'Y', h: 'p', v: 8 }, { g: 'Y', h: 'r', v: 16 }] }],
    dataSets: [{ name: 'D', source: 'S', path: '$' }],
    sections: { body: { height: 200, items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 100, dataSet: 'D', columns: [{ width: 200 }],
      groups: groups ? [{ name: 'G', expr: '=Fields.g', footer: [{ height: 12, cells: [{ value: `="F" & ${cell}` }] }] }, { name: 'H', expr: '=Fields.h' }] : [],
      detail: [{ height: 12, cells: [{ value: `="D" & ${cell}` }] }], footer: [{ height: 12, cells: [{ value: `="T" & ${cell}` }] }] }] } } });
  const texts = async (cell) => (await render(tbl(cell), { fontStore })).pages[0].items.flatMap(i => i.lines || []).map(l => l.text).join(' ');
  it.each([['RunningValue(Fields.v, "Sum")'], ['RunningValue(Fields.v, "Sum", Nothing)'], ['RunningValue(Fields.v, "Sum", "T")']])('%s', async (e) =>
    expect(await texts(e)).toBe('D1 D3 D7 F7 D15 D31 F31 T31'));
  it.each([['RowNumber()'], ['RowNumber(Nothing)'], ['RowNumber("T")']])('%s', async (e) => expect(await texts(e)).toBe('D1 D2 D3 F3 D4 D5 F5 T5'));
  it('the RDL import keeps RowNumber(Nothing) meaning the region', () => expect(translateExpression('=RowNumber(Nothing)').ok).toBe(true));
});

describe('§3.3: empty matrix cells drill with their group values, not nulls', () => {
  const m = (rowGroup) => ({ $schema: 'pagewright/report@1', page: { size: 'A4' },
    dataSources: [{ name: 'S', type: 'json', data: [{ r: 'A', c: 'X', v: 1 }, { r: 'B', c: 'Y', v: 2 }] }], dataSets: [{ name: 'D', source: 'S', path: '$' }],
    sections: { body: { height: 100, items: [{ type: 'matrix', name: 'M', x: 0, y: 0, w: 300, h: 60, dataSet: 'D', rowGroups: [{ expr: rowGroup }], columnGroups: [{ expr: '=Fields.c' }],
      values: [{ value: '=Sum(Fields.v)', action: { type: 'report', report: 'detail', params: { r: '=Fields.r', c: '=Fields.c' } } }] }] } } });
  const links = async (rg) => (await render(m(rg), { fontStore })).pages[0].items.filter(i => i.t === 'link' && i.action).map(l => JSON.stringify(l.action.params));
  it('every cell, empty ones too, carries its row and column', async () => {
    const ls = await links('=Fields.r');
    expect(ls.length).toBe(4);
    for (const want of [['A', 'X'], ['A', 'Y'], ['B', 'X'], ['B', 'Y']]) expect(ls.some(l => l.includes(`"${want[0]}"`) && l.includes(`"${want[1]}"`))).toBe(true);
    expect(ls.join(' ')).not.toMatch(/null/);
  });
  it('a computed group key: empty cells get no action', async () => {
    const ls = await links('=Upper(Fields.r)');
    expect(ls.length).toBe(2);
  });
});

describe('N24, N29, N30', () => {
  const ev2 = (src, extra = {}) => ev(src, extra);
  it('N30: Mid start 0 is an error; Sum over text is #Error', () => {
    expect(() => ev2('Mid("abc", 0)')).toThrow(/start must be 1/);
    expect(ev2('Mid("abc", 2)')).toBe('bc');
  });
  it('N29: Rank orders mixed values as the sort does', async () => {
    const m = await render({ $schema: 'pagewright/report@1', page: { size: 'A4' }, dataSources: [{ name: 'S', type: 'json', data: [{ v: 1 }, { v: 2 }, { v: 10 }, { v: 4 }, { v: 'x' }] }], dataSets: [{ name: 'D', source: 'S', path: '$' }],
      sections: { body: { height: 100, items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 100, h: 20, dataSet: 'D', columns: [{ width: 100 }], detail: [{ height: 12, cells: [{ value: '=Rank(Fields.v, "T")' }] }] }] } } }, { fontStore });
    // the column mixes text in, so it is text: ranked in text order ("1" < "10" < "2" < "4" < "x"), largest first,
    // one consistent order (before, ranks of 1, 2, 10, 4 came out 7, 5, 6, 3)
    expect(m.pages[0].items.flatMap(i => i.lines || []).map(l => l.text)).toEqual(['5', '3', '4', '2', '1']);
  });
  it('N24: an in filter with one value is a one-item list', async () => {
    const m = await render({ $schema: 'pagewright/report@1', page: { size: 'A4' }, parameters: [{ name: 'p', type: 'string' }], dataSources: [{ name: 'S', type: 'json', data: [{ v: 'Smith, John' }, { v: 'Smith' }] }],
      dataSets: [{ name: 'D', source: 'S', path: '$', filters: [{ expr: '=Fields.v', op: 'in', value: '=Parameters.p' }] }],
      sections: { body: { height: 40, items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 12, value: '=CountRows("D")' }] } } }, { fontStore, parameters: { p: 'Smith, John' } });
    expect(m.pages[0].items.flatMap(i => i.lines || []).map(l => l.text)).toEqual(['1']);
  });
});

describe('N23: column sets of a too-wide table break at the same rows', () => {
  it('every set\'s pages hold the same rows', async () => {
    const cols = Array.from({ length: 10 }, (_, i) => ({ width: 90 }));
    const d = { $schema: 'pagewright/report@1', page: { size: 'A4' }, dataSources: [{ name: 'S', type: 'json', data: Array.from({ length: 60 }, (_, i) => ({ r: `r${i}` })) }], dataSets: [{ name: 'D', source: 'S', path: '$' }],
      sections: { body: { height: 200, items: [{ type: 'textbox', name: 'Top', x: 0, y: 0, w: 200, h: 20, value: 'above' },
        { type: 'table', name: 'T', x: 0, y: 20, w: 900, h: 40, dataSet: 'D', columns: cols, header: [{ height: 14, cells: cols.map((_, i) => ({ value: `C${i}` })) }],
          detail: [{ height: 14, cells: cols.map((_, i) => ({ value: i === 0 || i === 6 ? '=Fields.r' : 'x' })) }] }] } } };
    const m = await render(d, { fontStore });
    const rowsOf = (p) => p.items.flatMap(i => i.lines || []).map(l => l.text).filter(t => /^r\d+$/.test(t));
    const pages = m.pages.map(rowsOf).filter(r => r.length);
    expect(pages.length % 2).toBe(0);
    const half = pages.length / 2;
    for (let i = 0; i < half; i++) expect(pages[half + i]).toEqual(pages[i]);
  });
});

describe('N8: side-by-side regions with keep-together groups', () => {
  it.each([[7, 17.3, 19.7], [5, 18, 14], [9, 15.5, 21]])('groups of %i rows (%dpt beside %dpt): page 1 has rows, nothing past the footer, no false warning', async (g, ha, hb) => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ i, k: Math.floor(i / g) }));
    const t = (name, x, h, group) => ({ type: 'table', name, x, y: 0, w: 120, h: 40, dataSet: 'D', columns: [{ width: 120 }], header: [{ height: 14, cells: [{ value: name }] }],
      ...(group ? { groups: [{ name: `${name}G`, expr: '=Fields.k', keepTogether: true }] } : {}), detail: [{ height: h, cells: [{ value: `=Fields.i` }] }], footer: [{ height: 14, cells: [{ value: 'end' }] }] });
    const d = { $schema: 'pagewright/report@1', page: { size: 'A4', margins: [36, 36, 36, 36] }, dataSources: [{ name: 'S', type: 'json', data: rows }], dataSets: [{ name: 'D', source: 'S', path: '$' }],
      sections: { body: { height: 60, items: [t('A', 0, ha, true), t('B', 130, hb, false)] }, pageFooter: { height: 30, items: [{ type: 'textbox', name: 'F', x: 0, y: 0, w: 200, h: 12, value: 'footer' }] } } };
    const m = await render(d, { fontStore });
    expect(m.warnings.join(' ')).not.toMatch(/taller than the page/);
    const texts = m.pages[0].items.flatMap(i => i.lines || []).map(l => l.text);
    expect(texts.filter(x => /^\d+$/.test(x)).length).toBeGreaterThan(20);
    const footerTop = 842 - 36 - 30;
    for (const p of m.pages) for (const it of p.items) for (const l of it.lines || []) if (/^\d+$/.test(l.text)) expect(l.y).toBeLessThan(footerTop);
  });
});

describe('N10: data bars compare across the column', () => {
  it('detail rows and group cells', async () => {
    const d = { $schema: 'pagewright/report@1', page: { size: 'A4' }, dataSources: [{ name: 'S', type: 'json', data: [{ g: 'A', v: 5 }, { g: 'B', v: 10 }, { g: 'B', v: 10 }, { g: 'C', v: 20 }] }], dataSets: [{ name: 'D', source: 'S', path: '$' }],
      sections: { body: { height: 100, items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'D', columns: [{ width: 200 }],
        groups: [{ name: 'G', expr: '=Fields.g', footer: [{ height: 14, cells: [{ value: '=Sum(Fields.v)', visual: { type: 'databar', value: '=Sum(Fields.v)' } }] }] }],
        detail: [{ height: 14, cells: [{ value: '=Fields.v', visual: { type: 'databar', value: '=Fields.v' } }] }] }] } } };
    const m = await render(d, { fontStore });
    const bars = m.pages[0].items.filter(i => i.t === 'rect' && /cc$/.test(i.fill || '')).map(r => Math.round(r.w));
    // detail 5, 10, 10, 20 of max 20; group sums 5, 20, 20 of max 20
    const full = Math.max(...bars);
    // in page order: A's row (5) and footer (5 of 20), B's two rows (10, 10) and footer (20), C's row (20) and footer
    expect(bars.map(b => Math.round((b / full) * 4))).toEqual([1, 1, 2, 2, 4, 4, 4]);
  });
});
