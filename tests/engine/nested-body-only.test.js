// A table inside a container (or a list) in a page header or footer: the check warns (it was checked at the top level
// only), and a saved report with one renders as it did before; the designer's paste and drag send it to the body as
// they do a table. A table directly in a page band stays an error, as it always was.
import { describe, it, expect, beforeEach } from 'vitest';
import { validate } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { pasteItems, moveItems } from '../../src/designer/store.js';
import { report, fontStore, texts } from '../helpers.js';
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
const says = (name) =>
  `${name}: tables belong in the body; this one, inside a container or list in a page band, still prints, but move it to the body`;

describe('validate: a table nested in a page band', () => {
  for (const band of ['header', 'footer']) {
    it(`in a container in the page ${band}: a warning the Issues panel lists, not an error`, () => {
      const v = validate(report([], { [band]: { height: 40, items: [box([table()])] } }));
      expect(v.errors).toEqual([]);
      expect(v.warnings).toContain(says('T'));
      expect(v.hints).toContain(says('T'));
    });
  }
  it('two containers deep', () => {
    const v = validate(report([], { header: { height: 60, items: [box([box([table('Deep')], 'Inner')])] } }));
    expect(v.errors).toEqual([]);
    expect(v.hints).toContain(says('Deep'));
  });
  it('unnamed: named by the container it is in', () => {
    const { name, ...t } = table();
    void name;
    const v = validate(report([], { header: { height: 40, items: [box([t])] } }));
    expect(v.hints).toContain(says('C table'));
  });
  it('in a container in the body: no error, no warning', () => {
    const v = validate(report([box([table()])]));
    expect(v.errors).toEqual([]);
    expect(v.warnings.join('\n')).not.toMatch(/belong in the body/);
  });
  it('a table directly in the page header: still an error', () => {
    const v = validate(report([], { header: { height: 40, items: [table('X')] } }));
    expect(v.errors).toContain('X: tables can only be in the body');
  });
});

describe('render: a saved report with a table nested in the page header', () => {
  const data = { rows: [{ a: 'one' }, { a: 'two' }] };
  it('renders its rows, as before, with the warning', async () => {
    const m = await render(report([], { header: { height: 40, items: [box([table()])] }, data }), { fontStore });
    expect(texts(m.pages[0])).toEqual(['one', 'two']);
    expect(m.warnings).toContain(says('T'));
  });
  it('a table directly in the page header still stops the render', async () => {
    await expect(
      render(report([], { header: { height: 40, items: [table('X')] }, data }), { fontStore }),
    ).rejects.toThrow('X: tables can only be in the body');
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
