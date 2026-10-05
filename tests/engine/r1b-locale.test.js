// REVIEW-ENGINE A10, A12, A13, A14, A16, A17, A19 (IsNumeric, Upper, CStr, "a" + 5), A21 (empty "in" list).
import { describe, it, expect } from 'vitest';
import { evalValue } from '../../src/engine/expr/evaluate.js';
import { formatValue, toDate } from '../../src/engine/expr/format.js';
import { coerce, applySort, applyFilters } from '../../src/engine/data/index.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const ctx = (o = {}) => ({ fields: {}, params: {}, globals: {}, dataSets: {}, ...o });
const ev = (s, o) => evalValue(s, ctx(o));
const d = new Date(Date.UTC(2026, 2, 5, 14, 30)); // shown in UTC below

describe('standard date and number formats per locale', () => {
  it('short dates as the culture writes them', () => {
    const f = (fmt, locale) => formatValue(d, fmt, { locale, timeZone: 'UTC' });
    expect(f('d', 'en-US')).toBe('3/5/2026');
    expect(f('d', 'de-DE')).toBe('05.03.2026');
    expect(f('d', 'en-IN')).toBe('05-03-2026');
    expect(f('d', 'ja-JP')).toBe('2026/03/05');
    expect(f('d', 'en-GB')).toBe('05/03/2026');
    expect(f('D', 'de-DE')).toBe('Donnerstag, 5. März 2026');
    expect(f('t', 'de-DE')).toBe('14:30');
    expect(f('G', 'en-US')).toBe('3/5/2026 2:30:00 PM');
    expect(ev('=Format(Fields.d, "d")', { fields: { d }, locale: 'ja-JP', timeZone: 'UTC' })).toBe('2026/03/05');
  });
  it('F, N, E and plain numbers use the locale\'s decimal sign', () => {
    expect(formatValue(-1234.5, 'F2', { locale: 'de-DE' })).toBe('-1234,50');
    expect(formatValue(-1234.5, 'N2', { locale: 'de-DE' })).toBe('-1.234,50');
    expect(formatValue(1234.5, 'E2', { locale: 'de-DE' })).toBe('1,23E+003');
    expect(formatValue(1 / 3, null, { locale: 'de-DE' })).toBe('0,333333333333333');
    expect(formatValue(-1234.5, 'F2', { locale: 'en-US' })).toBe('-1234.50');
  });
  it('the custom scientific format 0.00E+00', () => {
    expect(formatValue(0.00001234, '0.00E+00')).toBe('1.23E-05');
    expect(formatValue(123456, '0.00E+00')).toBe('1.23E+05');
    expect(formatValue(123456, '0.0e0')).toBe('1.2e5');
    expect(formatValue(-0.5, '0.0E+0')).toBe('-5.0E-1');
    expect(formatValue(9.999, '0.00E+00')).toBe('1.00E+01');
    expect(formatValue(1234, '00.0E+0')).toBe('12.3E+2');
  });
});

describe('reading dates and numbers', () => {
  it('CDate rejects a day that does not exist; IsDate agrees', () => {
    expect(() => ev('=CDate("2026-02-30")')).toThrow(/not a date/);
    expect(() => ev('=CDate("13/13/2026")')).toThrow(/not a date/);
    expect(ev('=IsDate("2026-02-30")')).toBe(false);
    expect(ev('=IsDate("2026-02-28")')).toBe(true);
    expect(toDate('2026-02-30T10:00:00')).toBeNull();
  });
  it('slash dates in the locale\'s field order', () => {
    const p = (s, locale) => { const x = toDate(s, { locale, timeZone: 'UTC' }); return x && x.toISOString().slice(0, 10); };
    expect(p('03/04/2026', 'en-US')).toBe('2026-03-04');
    expect(p('03/04/2026', 'en-GB')).toBe('2026-04-03');
    expect(p('03.04.2026', 'de-DE')).toBe('2026-04-03');
    expect(p('2026/04/03', 'ja-JP')).toBe('2026-04-03');
    expect(p('31/12/2026', 'en-US')).toBeNull(); // month 31
    expect(ev('=Month(CDate("03/04/2026"))', { locale: 'en-GB' })).toBe(4);
  });
  it('numbers in text by the data\'s locale; text that is not a number is blank with a warning', async () => {
    expect(coerce('12,5', 'number', { locale: 'de-DE' })).toBe(12.5);
    expect(coerce('1.234,56', 'number', { locale: 'de-DE' })).toBe(1234.56);
    expect(coerce('1,234.5', 'number', { locale: 'en-US' })).toBe(1234.5);
    expect(coerce('(1,234)', 'number')).toBe(-1234);
    expect(coerce('$5', 'number')).toBe(5);
    expect(coerce('12,5', 'number', { locale: 'en-US' })).toBeNull(); // not 125
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 20, dataSet: 'Rows', columns: [{ width: 200 }], detail: [{ height: 14, cells: [{ value: '=Fields.n * 2' }] }] }],
      { data: { rows: [{ n: '12,5' }, { n: 'abc' }, { n: '1.000' }] }, def: { locale: 'de-DE' } });
    def.dataSets[0].fields = [{ name: 'n', type: 'number' }];
    const r = await render(def, { fontStore });
    expect(texts(r.pages[0])).toEqual(['25', '0', '2000']);
    expect(r.warnings.join('\n')).toMatch(/field "n": 1 value does not read as a number \(for example "abc"\)/);
  });
});

describe('sorting and grouping as SSRS', () => {
  it('culture order, case-insensitive, numbers before text; digit runs as text (SSRS) unless naturalSort (R3-A N18)', () => {
    const rows = ['apple', 'Banana', 'cherry', 'Émile', 'zed', 10, 9, 'item 10', 'item 9'].map(v => ({ v }));
    const sorted = applySort(rows, [{ by: '=Fields.v' }], ctx({ locale: 'en-US' })).map(r => r.v);
    expect(sorted).toEqual([9, 10, 'apple', 'Banana', 'cherry', 'Émile', 'item 10', 'item 9', 'zed']);
    expect(applySort(rows, [{ by: '=Fields.v' }], ctx({ locale: 'en-US', naturalSort: true })).map(r => r.v)).toEqual([9, 10, 'apple', 'Banana', 'cherry', 'Émile', 'item 9', 'item 10', 'zed']);
  });
  it('groups ABC with abc (unless caseSensitive)', async () => {
    const t = { type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 20, dataSet: 'Rows', columns: [{ width: 200 }],
      groups: [{ name: 'G', expr: '=Fields.k', sort: 'asc', header: [{ height: 14, cells: [{ value: '=Fields.k & " " & Count(Fields.k)' }] }] }], detail: [] };
    const data = { rows: [{ k: 'abc' }, { k: 'ABC' }, { k: 'b' }] };
    expect(texts((await render(report([t], { data }), { fontStore })).pages[0])).toEqual(['abc 2', 'b 1']);
    expect(texts((await render(report([t], { data, def: { caseSensitive: true } }), { fontStore })).pages[0])).toEqual(['abc 1', 'ABC 1', 'b 1']);
  });
  it('an empty "in" list matches nothing; nothing picked in a parameter read directly still means all', () => {
    const rows = [{ v: 1 }, { v: 2 }];
    expect(applyFilters(rows, [{ expr: '=Fields.v', op: 'in', value: '=Split("", ",")' }], ctx())).toEqual([]);
    expect(applyFilters(rows, [{ expr: '=Fields.v', op: 'in', value: '=LookupSet(1, Fields.k, Fields.v, "L")' }], ctx({ dataSets: { L: [] } }))).toEqual([]);
    expect(applyFilters(rows, [{ expr: '=Fields.v', op: 'in', value: '=Parameters.p' }], ctx({ params: { p: [] } }))).toEqual(rows);
  });
});

describe('the report\'s time zone', () => {
  const def = (timeZone) => report([{ type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 20, dataSet: 'Rows', columns: [{ width: 300 }],
    detail: [{ height: 14, cells: [{ value: '=Format(Fields.d, "yyyy-MM-dd HH:mm") & " " & Day(Fields.d) & " " & Format(Fields.day, "yyyy-MM-dd")' }] }] }],
  { data: { rows: [{ d: '2026-03-05T02:00:00Z', day: '2026-03-05' }] }, def: { timeZone } });
  for (const [tz, want] of [['UTC', '2026-03-05 02:00 5 2026-03-05'], ['America/Los_Angeles', '2026-03-04 18:00 4 2026-03-05'], ['Asia/Kolkata', '2026-03-05 07:30 5 2026-03-05']]) {
    it(`${tz}: the same on every host`, async () => {
      const r = await render(def(tz), { fontStore });
      expect(texts(r.pages[0])).toEqual([want]);
    });
  }
  it('the render option timeZone (the viewer\'s) applies when the report sets none; an unknown zone warns', async () => {
    const r = await render(def(undefined), { fontStore, timeZone: 'America/Los_Angeles' });
    expect(texts(r.pages[0])).toEqual(['2026-03-04 18:00 4 2026-03-05']);
    const bad = await render(def('Mars/Olympus'), { fontStore });
    expect(bad.warnings.join('\n')).toMatch(/time zone "Mars\/Olympus" is not known/);
  });
  it('Today(), DateSerial and DateAdd are on the report\'s clock', () => {
    const c = { timeZone: 'America/Los_Angeles', globals: { ExecutionTime: new Date('2026-03-05T02:00:00Z') } };
    expect(ev('=Format(Today(), "yyyy-MM-dd HH:mm")', c)).toBe('2026-03-04 00:00');
    expect(ev('=Format(DateSerial(2026, 3, 8), "o")', c)).toBe('2026-03-08T00:00:00.0000000');
    expect(ev('=DateSerial(2026, 3, 8)', c).toISOString()).toBe('2026-03-08T08:00:00.000Z'); // PST
    expect(ev('=Format(DateAdd("d", 1, DateSerial(2026, 3, 7)), "yyyy-MM-dd HH:mm")', c)).toBe('2026-03-08 00:00'); // across the DST change
  });
});

describe('smaller VB divergences', () => {
  it('IsNumeric, UCase, CStr, "a" + 5', () => {
    expect(ev('=IsNumeric("1,000")')).toBe(true);
    expect(ev('=IsNumeric("$5")')).toBe(true);
    expect(ev('=IsNumeric("1,0,0")')).toBe(false);
    expect(ev('=UCase("straße")')).toBe('STRAßE');
    expect(ev('=CStr(1 / 3)')).toBe('0.333333333333333');
    expect(() => ev('="a" + 5')).toThrow(/not a number/);
    expect(ev('="a" + 5', { nullPropagation: true })).toBe('a5');
  });
});

describe('multi-value parameters given as text', () => {
  it('a comma inside an option value stays; "\\," is a comma', async () => {
    const { resolveParameters } = await import('../../src/engine/index.js');
    const def = { parameters: [{ name: 'who', multi: true, options: ['Smith, John', 'Doe, Jane', 'Lee'] }, { name: 'free', multi: true }] };
    const p = resolveParameters(def, { who: 'Smith, John,Lee', free: 'a\\,b,c' });
    expect(p.who).toEqual(['Smith, John', 'Lee']);
    expect(p.free).toEqual(['a,b', 'c']);
    expect(resolveParameters(def, { who: 'Smith, John' }).who).toEqual(['Smith, John']);
  });
});
