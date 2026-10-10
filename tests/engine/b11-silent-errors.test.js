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
