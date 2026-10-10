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
