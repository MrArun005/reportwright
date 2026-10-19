// A table inside a container (or a list) in a page header or footer: the check says so as for a table there (it was
// checked at the top level only), and the designer's paste and drag send it to the body as they do a table.
import { describe, it, expect, beforeEach } from 'vitest';
import { validate } from '../../src/engine/schema/validate.js';
import { pasteItems, moveItems } from '../../src/designer/store.js';
import { report } from '../helpers.js';
import { S, load, where } from './designer-bands.fixture.js';

const table = (name = 'T') => ({
  type: 'table',
  name,
  dataSet: 'Rows',
  x: 0,
  y: 0,
  w: 100,
  h: 20,
  columns: [{ width: 100 }],
  detail: [{ height: 16, cells: [{ value: '=Fields.a' }] }],
});
const box = (items, name = 'C') => ({ type: 'container', name, x: 0, y: 0, w: 120, h: 30, items });

describe('validate: a table nested in a page band', () => {
  for (const band of ['header', 'footer']) {
    it(`in a container in the page ${band}: an error`, () => {
      const v = validate(report([], { [band]: { height: 40, items: [box([table()])] } }));
      expect(v.errors).toContain('T: tables can only be in the body');
    });
  }
  it('two containers deep', () => {
    const v = validate(report([], { header: { height: 60, items: [box([box([table('Deep')], 'Inner')])] } }));
    expect(v.errors).toContain('Deep: tables can only be in the body');
  });
  it('unnamed: named by the container it is in', () => {
    const { name, ...t } = table();
    void name;
    const v = validate(report([], { header: { height: 40, items: [box([t])] } }));
    expect(v.errors).toContain('C table: tables can only be in the body');
  });
  it('in a container in the body: no error', () => {
    const v = validate(report([box([table()])]));
    expect(v.errors).toEqual([]);
  });
});

describe('designer: a container holding a table goes to the body', () => {
  beforeEach(load);
  const clip = (item) => JSON.stringify({ kind: 'pagewright/items@1', items: [item] });
  it('pasted into the page header', () => {
    expect(pasteItems('pageHeader', clip({ id: 'c', ...box([{ id: 't', ...table() }]) }))).toBe(1);
    expect(where(S().sel.ids[0]).section).toBe('body');
    expect(validate(S().def).errors).toEqual([]);
  });
  it('dragged onto the page header: stays in the body', () => {
    S().apply((d) => {
      d.sections.body.items.push({ id: 'c', ...box([{ id: 't', ...table() }]), y: 100 });
    });
    moveItems(['c'], 0, -150, { to: { section: 'pageHeader', ox: 0, oy: -40 } });
    expect(where('c').section).toBe('body');
  });
});
