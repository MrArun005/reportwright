import { describe, it, expect } from 'vitest';
import { evalValue, functionTable, checkFunctions } from '../../src/engine/expr/evaluate.js';
import { validate } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const fns = [
  { name: 'Tax', params: ['amt'], body: '=amt * 0.18' },
  { name: 'Gross', params: ['amt', 'rate'], body: '=amt + Code.Tax(amt) * rate' },
  { name: 'Total', params: [], body: '=Sum(Fields.x)' },
];
const ev = (s, f = fns, o = {}) => evalValue(s, { params: {}, globals: {}, dataSets: {}, fields: { x: 100 }, aggRows: [{ x: 100 }, { x: 5 }], functions: functionTable({ functions: f }), ...o });

describe('report functions', () => {
  it('are called with Code. and without, any case', () => {
    expect(ev('=Code.Tax(100)')).toBe(18);
    expect(ev('=tax(Fields.x)')).toBe(18);
    expect(ev('=Gross(100, 2)')).toBe(136);
    expect(ev('={Tax(10)}'.slice(1))).toBe('1.8');
  });
  it('see the caller\'s row and scope', () => expect(ev('=Total()')).toBe(105));
  it('parameters are local names; a caller\'s locals do not leak into the callee', () => {
    expect(() => ev('=Leak(1)', [{ name: 'Leak', params: ['q'], body: '=Inner()' }, { name: 'Inner', params: [], body: '=q' }])).toThrow(/Unknown name "q"/);
    expect(() => ev('=amt')).toThrow(/Unknown name/);
  });
  it('a local shadows nothing outside the body and the RunningValue cache does not mix calls', () => {
    const f = [{ name: 'Run', params: ['k'], body: '=RunningValue(Fields.x * k, "Sum")' }];
    const c = { aggIndex: 1 };
    expect(ev('=Run(1)', f, c)).toBe(105);
    expect(ev('=Run(2)', f, c)).toBe(210);
  });
  it('stop recursion at depth 32', () => expect(() => ev('=F(1)', [{ name: 'F', params: ['n'], body: '=F(n + 1)' }])).toThrow(/32/));
  it('stop at 1,000,000 calls per table', () => {
    const f = [{ name: 'F', params: ['n'], body: '=IIF(n < 25, F(n + 1) + F(n + 1), 0)' }];
    expect(() => ev('=F(0)', f)).toThrow(/1,000,000/);
  });
  it('check the argument count', () => {
    expect(() => ev('=Tax(1, 2)')).toThrow(/1 argument/);
    expect(() => ev('=Total(1)')).toThrow(/0 arguments/);
  });
  it('Code. only reaches report functions; other method calls are refused', () => {
    expect(() => ev('=Code.Sum(1)')).toThrow(/no function "Sum"/);
    expect(() => ev('=Fields.x.Tax(1)')).toThrow(/not supported/);
    expect(() => ev('=Nope(1)')).toThrow(/Unknown function/);
  });
  it('checkFunctions rejects bad names, clashes, duplicates, bad params and bad bodies', () => {
    const errs = checkFunctions([
      { name: '1x', params: [], body: '=1' },
      { name: 'Sum', params: [], body: '=1' },
      { name: 'Left', params: [], body: '=1' },
      { name: 'IIF', params: [], body: '=1' },
      { name: 'Ok', params: ['Fields'], body: '=1' },
      { name: 'ok', params: [], body: '=1' },
      { name: 'Dup', params: ['a', 'A'], body: '=a' },
      { name: 'Bad', params: [], body: '=1 +' },
      { name: 'Empty', params: [], body: '' },
    ]).join('\n');
    for (const m of [/"1x": the name/, /"Sum": a built-in/, /"Left": a built-in/, /"IIF": a built-in/, /"Fields" cannot be a parameter/, /"ok": two functions/, /two parameters/, /"Bad": The expression ends too early/, /"Empty": the body is empty/]) expect(errs).toMatch(m);
    expect(checkFunctions(fns)).toEqual([]);
    expect(checkFunctions('x')).toEqual(['"functions" must be a list']);
  });
  it('validate() stops a report with a broken function', () => {
    const def = report([], { def: { functions: [{ name: 'Bad', params: [], body: '=(' }] } });
    expect(validate(def).errors[0]).toMatch(/Function "Bad"/);
  });
  it('a render uses them in cells and calculated fields', async () => {
    const def = report([{ type: 'textbox', name: 't', x: 0, y: 0, w: 200, h: 14, value: '=Code.Tax(Fields.amt) & " " & Fields.gross' }], {
      data: { rows: [{ amt: 200 }] },
      def: { functions: fns, dataSets: [{ name: 'Rows', source: 'src', path: '$.rows', fields: [{ name: 'amt', type: 'number' }, { name: 'gross', type: 'number', expr: '=Gross(Fields.amt, 1)' }] }] },
    });
    const r = await render(def, { fontStore });
    expect(texts(r.pages[0])).toEqual(['36 236']);
  });
});
