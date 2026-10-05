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
