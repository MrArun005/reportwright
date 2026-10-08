// B9 SILENT-6: static validate() rules left over from the 0.12.1 retest.
import { describe, it, expect } from 'vitest';
import { validate } from '../../src/engine/schema/validate.js';
import { report } from '../helpers.js';

const box = (value, extra = {}) => ({ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 20, value, ...extra });
const warn = (items, extra) => validate(report(items, extra)).warnings;

describe('SILENT-6', () => {
  it('(a) && and || are accepted by the expression language, so no warning', () => {
    expect(warn([box('=Fields.n > 1 && Fields.n < 5 || Fields.n = 9')])).toEqual([]);
  });
  it('(b) an aggregate with no scope outside a data region warns', () => {
    const w = warn([box('=Sum(Fields.n)')]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^T: Sum is outside a table or list and names no scope/);
  });
  it('(b) a scope, a dataSet on the item, or a table around it is quiet', () => {
    expect(warn([box('=Sum(Fields.n, "Rows")')])).toEqual([]);
    expect(warn([box('=Sum(Fields.n)', { dataSet: 'Rows' })])).toEqual([]);
    expect(warn([{ type: 'table', name: 'Tb', dataSet: 'Rows', x: 0, y: 0, w: 100, h: 20, columns: [{ width: 100 }], header: [], footer: [{ height: 14, cells: [{ value: '=Sum(Fields.n)' }] }], detail: [] }])).toEqual([]);
  });
  it('(b) found inside a container too', () => {
    const w = warn([{ type: 'container', name: 'C', x: 0, y: 0, w: 100, h: 50, items: [box('Total {Count(Fields.n)}', { name: 'In' })] }]);
    expect(w.filter(x => /^In: Count is outside/.test(x))).toHaveLength(1);
  });
  const p = (o) => ({ def: { parameters: [{ name: 'q', type: 'string', ...o }] } });
  it('(d) nullable:false or allowBlank:false with no default and not required warns', () => {
    expect(warn([box('x')], p({ nullable: false }))[0]).toMatch(/^Parameter "q" is nullable: false but is not required and has no default/);
    expect(warn([box('x')], p({ allowBlank: false }))[0]).toMatch(/allowBlank: false/);
  });
  it('(d) required, a default, or no explicit false is quiet', () => {
    expect(warn([box('x')], p({ nullable: false, required: true }))).toEqual([]);
    expect(warn([box('x')], p({ nullable: false, default: 'a' }))).toEqual([]);
    expect(warn([box('x')], p({}))).toEqual([]);
  });
});
