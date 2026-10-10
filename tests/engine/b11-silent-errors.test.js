// The tester's silent mistakes: each fails loudly now (a validation error, or a warning where a report may rely on it).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, report } from '../helpers.js';

const texts = (m) => [...JSON.stringify(m.pages).matchAll(/"text":"([^"]*)"/g)].map(x => x[1]);
const table = (extra = {}, cell = '=Fields.a') => ({ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 200 }], detail: [{ cells: [{ value: cell }] }], ...extra });
const def = (rows, items, extra = {}) => report(items, { data: { rows }, def: extra });

describe('1. a half-written filter is a validation error', () => {
  const rows = [{ a: 1 }, { a: 3 }, { a: 2 }];
  const cases = [
    ['the whole comparison in expr, no op or value', { expr: '=Fields.a >= 2' }, /T, filter 1 has no op; a filter is \{expr, op, value\}, e\.g\. \{ expr: '=Fields\.a', op: '>=', value: 2 \}/],
    ['an op but no value', { expr: '=Fields.a', op: '>=' }, /T, filter 1 \(>=\) has no value/],
    ['between with no value2', { expr: '=Fields.a', op: 'between', value: 1 }, /T, filter 1 \(between\) has no value2/],
    ['an empty expression', { expr: '', op: '=', value: 1 }, /T, filter 1 has no expr/],
    ['an unknown op', { expr: '=Fields.a', op: 'equals', value: 1 }, /T, filter 1: the op "equals" is not a filter operator/],
  ];
  for (const [label, f, msg] of cases) {
    it(`${label}: validate() and render() fail`, async () => {
      const d = def(rows, [table({ filters: [f] })]);
      expect(validate(d).errors.join('\n')).toMatch(msg);
      await expect(render(d, { fontStore })).rejects.toThrow(msg);
    });
  }
  it('a data set filter is checked too, naming the data set', () => {
    const d = def(rows, [table()]);
    d.dataSets[0].filters = [{ expr: '=Fields.a >= 2' }];
    expect(validate(d).errors.join('\n')).toMatch(/Data set "Rows", filter 1 has no op/);
  });
  it('valid filters stay valid: {expr, value} with no op is "=", between with a [low, high] pair or an expression', async () => {
    for (const f of [{ expr: '=Fields.a', value: 3 }, { expr: '=Fields.a', op: 'between', value: [2, 3] }, { expr: '=Fields.a', op: 'between', value: '=Parameters.R' },
      { expr: '=Fields.a', op: 'TopN', value: 1 }, { expr: '=Fields.a', op: '>=', value: 2 }]) {
      const d = def(rows, [table({ filters: [f] })], { parameters: [{ name: 'R', type: 'string', multi: true, default: '' }] });
      expect(validate(d).errors).toEqual([]);
    }
    const m = await render(def(rows, [table({ filters: [{ expr: '=Fields.a', op: '>=', value: 2 }] })]), { fontStore });
    expect(texts(m)).toEqual(['3', '2']);
  });
});

describe('2. a sort by a bare field name', () => {
  const rows = [{ r: 'b' }, { r: 'a' }, { r: 'c' }];
  const d = (by, items) => def(rows, items || [table({ sort: [{ by, dir: 'asc' }] }, '=Fields.r')]);
  it('by: "r" (a field of the data set) sorts by that field, with a warning', async () => {
    expect(validate(d('r')).warnings.join('\n')).toMatch(/T, sort 1: "by" is "r", the name of a field; it sorts by that field \(did you mean "=Fields\.r"\?\)/);
    const m = await render(d('r'), { fontStore });
    expect(texts(m)).toEqual(['a', 'b', 'c']);
    expect(m.warnings.join('\n')).toMatch(/did you mean "=Fields\.r"/);
  });
  it('the data set sort too', async () => {
    const x = d('r', [table({}, '=Fields.r')]);
    x.dataSets[0].sort = [{ by: 'r', dir: 'desc' }];
    expect(texts(await render(x, { fontStore }))).toEqual(['c', 'b', 'a']);
  });
  it('the definition passed in is not changed', async () => {
    const x = d('r');
    await render(x, { fontStore });
    expect(x.sections.body.items[0].sort[0].by).toBe('r');
  });
  it('"=Fields.r" gives the same rows and no warning', async () => {
    const m = await render(d('=Fields.r'), { fontStore });
    expect(texts(m)).toEqual(['a', 'b', 'c']);
    expect(m.warnings.join('\n')).not.toMatch(/sort/);
  });
  it('another constant warns that it does not sort', () => {
    expect(validate(d('rr')).warnings.join('\n')).toMatch(/T, sort 1: "by" is the constant "rr", so the rows are not sorted; \(did you mean "=Fields\.r"\?\)/);
  });
  it('a sort by a field that does not exist warns, with the field name', () => {
    expect(validate(d('=Fields.rr')).warnings.join('\n')).toMatch(/T: The field "rr" does not exist/);
  });
  it('a group on a bare field name warns (a constant group is one group of every row)', () => {
    const x = def(rows, [table({ groups: [{ expr: 'r' }] }, '=Fields.r')]);
    expect(validate(x).warnings.join('\n')).toMatch(/T, group 1: "expr" is "r", the name of a field, so every row is in one group; did you mean "=Fields\.r"\?/);
  });
});

describe('3. a misspelled parameter', () => {
  const d = (value) => def([{ a: 1 }], [{ type: 'textbox', name: 'X', x: 0, y: 0, w: 200, h: 20, value }], { parameters: [{ name: 'Region', type: 'string', default: 'North' }, { name: 'Min', type: 'number', default: 1 }] });
  for (const v of ['=Parameters.Regoin', 'Region: {Parameters.Regoin}']) {
    it(`${v} is a validation error with a did-you-mean; render() draws #Error with the same words, once`, async () => {
      const msg = 'X: The parameter "Regoin" does not exist (did you mean "Region"?); declare it under parameters, or check the spelling';
      expect(validate(d(v)).errors).toContain(msg);
      const m = await render(d(v), { fontStore });
      expect(texts(m)).toEqual(['#Error']);
      expect(m.warnings.filter(w => w.includes('Regoin'))).toEqual([msg]);
    });
  }
  it('a declared parameter, in any case, is no error', () => {
    expect(validate(d('=Parameters.region')).errors).toEqual([]);
  });
});

describe('3. parameter values a caller gives', () => {
  const d = () => def([{ a: 1 }], [{ type: 'textbox', name: 'X', x: 0, y: 0, w: 200, h: 20, value: '=Parameters.Min' }], { parameters: [
    { name: 'Min', type: 'number', default: 1 }, { name: 'Region', type: 'string', options: ['North', 'South'] },
    { name: 'On', type: 'boolean' }, { name: 'From', type: 'date' }] });
  const cases = [
    [{ Nope: 1 }, 'Unknown parameter "Nope"; this report declares: Min, Region, On, From'],
    [{ Regoin: 'North' }, 'Unknown parameter "Regoin" (did you mean "Region"?); this report declares: Min, Region, On, From'],
    [{ min: 2 }, 'Unknown parameter "min" (did you mean "Min"?)'],
    [{ Min: 'not a number' }, 'The parameter "Min" takes a number; "not a number" is not one'],
    [{ From: '31/12/2026' }, 'The parameter "From" takes a date; "31/12/2026" is not one'],
    [{ On: 'maybe' }, 'The parameter "On" takes a boolean; "maybe" is not one'],
    [{ Region: 'East' }, 'The parameter "Region" takes one of its options; "East" is not one'],
  ];
  for (const [given, msg] of cases) {
    it(`${JSON.stringify(given)}: a warning, and a 400 with strictParameters`, async () => {
      expect((await render(d(), { fontStore, parameters: given })).warnings.join('\n')).toContain(msg);
      await expect(render(d(), { fontStore, parameters: given, strictParameters: true })).rejects.toMatchObject({ status: 400, message: expect.stringContaining(msg) });
    });
  }
  it('good values say nothing, strict or not', async () => {
    const m = await render(d(), { fontStore, strictParameters: true, parameters: { Min: '2', Region: 'North', On: 'true', From: '2026-12-31' } });
    expect(texts(m)).toEqual(['2']);
    expect(m.warnings.join('\n')).not.toMatch(/parameter/i);
  });
});

describe('3. pw render -p with a name the report does not declare', () => {
  it('fails, naming the parameter and what the report declares', async () => {
    const { spawnSync } = await import('node:child_process');
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-p-'));
    const file = path.join(dir, 'r.pw.json');
    fs.writeFileSync(file, JSON.stringify(def([{ a: 1 }], [{ type: 'textbox', x: 0, y: 0, w: 100, h: 20, value: 'x' }], { parameters: [{ name: 'Min', type: 'number' }, { name: 'Region', type: 'string' }] })));
    const r = spawnSync(process.execPath, ['bin/pw.mjs', 'render', file, '-p', 'Nope=1', '-o', path.join(dir, 'r.pdf')], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown parameter "Nope"; this report declares: Min, Region');
  }, 60000);
});

describe('4. siblings', () => {
  const tb = (extra) => def([{ a: 1 }], [{ type: 'textbox', name: 'X', x: 0, y: 0, w: 200, h: 20, value: 'x', ...extra }]);
  it('a misspelt style property warns with a did-you-mean (it was ignored silently)', () => {
    expect(validate(tb({ style: { fontWieght: 'bold' } })).warnings).toContain('X: unknown style property "fontWieght" (did you mean "fontWeight"?); it is ignored');
    expect(validate(tb({ style: { fontWeight: 'bold', direction: 'rtl', borderStyle: 'solid' } })).warnings.join('\n')).not.toMatch(/style property/);
  });
  it('already loud: an unknown field, data set, aggregate scope and item type', async () => {
    const d = def([{ a: 1 }], [table({ dataSet: 'Rowz' }), { type: 'textbx', x: 0, y: 50, w: 10, h: 10 },
      { type: 'textbox', name: 'S', x: 0, y: 80, w: 100, h: 20, value: '=Sum(Fields.a, "Rowz")' }, { type: 'textbox', name: 'F', x: 0, y: 110, w: 100, h: 20, value: '=Fields.b' }]);
    const w = validate(d).warnings.join('\n');
    expect(w).toMatch(/T: the data set "Rowz" does not exist/);
    expect(w).toMatch(/Unknown item type "textbx"/);
    expect(w).toMatch(/F: The field "b" does not exist/);
    expect((await render(d, { fontStore })).warnings.join('\n')).toMatch(/S: Sum: the scope "Rowz" does not exist/);
  });
});
