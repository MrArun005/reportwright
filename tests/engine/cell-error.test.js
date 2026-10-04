// An expression that does not parse or evaluate shows #Error in its own cell with a warning, as in SSRS,
// instead of stopping the whole report. validate() still reports it as an error (the designer shows it).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, report, texts } from '../helpers.js';

const rows = [{ name: 'a', v: 1 }, { name: 'b', v: 2 }];
const box = (name, value, y = 0) => ({ type: 'textbox', name, x: 0, y, w: 200, h: 14, value });

describe('#Error per cell', () => {
  it('a syntax error in one text box: that box shows #Error, the rest renders, a warning names it', async () => {
    const def = report([box('Broken', '=1 + (2'), box('Fine', 'still here', 20)]);
    expect(validate(def).errors.join()).toMatch(/Broken/);
    const m = await render(def, { fontStore });
    const t = texts(m.pages[0]);
    expect(t).toContain('#Error');
    expect(t).toContain('still here');
    expect(m.warnings.some(w => /^Broken: /.test(w))).toBe(true);
  });

  it('table cells, row and group expressions: only the broken ones fail', async () => {
    const table = {
      type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 300, h: 40, columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
      header: [{ height: 14, cells: [{ value: 'Name' }, { value: '="unclosed' }, { value: 'V' }] }],
      detail: [{ height: 14, cells: [{ value: '=Fields.name' }, { value: '=Fields.v *' }, { value: '=Fields.v' }] }],
      groups: [{ name: 'G', expr: '=Fields.name', header: [{ height: 14, cells: [{ value: '=Fields.name & (' }, null, null] }] }],
    };
    const m = await render(report([table], { data: { rows } }), { fontStore });
    const t = texts(m.pages[0]);
    expect(t).toEqual(expect.arrayContaining(['Name', 'V', 'a', 'b', '1', '2']));
    expect(t.filter(x => x === '#Error').length).toBe(1 + 2 + 2); // the header cell, two detail cells, two group headers
    expect(m.warnings.join('\n')).toMatch(/T/);
  });

  it('a broken hidden expression or style keeps the item visible with its default, and warns', async () => {
    const def = report([{ ...box('B', 'shown'), hidden: '=Parameters.x =', style: { color: '=IIf(' } }]);
    const m = await render(def, { fontStore });
    expect(texts(m.pages[0])).toContain('shown');
    expect(m.warnings.some(w => /^B: /.test(w))).toBe(true);
  });

  it('structural errors still stop the render', async () => {
    const def = report([{ ...box('X', 'x'), w: 'wide' }]);
    await expect(render(def, { fontStore })).rejects.toThrow(/"w" must be a number/);
  });
});
