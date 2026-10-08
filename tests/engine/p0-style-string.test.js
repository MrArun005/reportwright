// style: "bold" (a string where an object belongs) crashed render with "Invalid value used as weak map key".
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, report } from '../helpers.js';

describe('a style that is not an object', () => {
  const def = () => report([
    { type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 20, value: 'Hello', style: 'bold' },
    { type: 'table', name: 'Tb', x: 0, y: 30, w: 100, h: 40, dataSet: 'Rows', style: ['x'], columns: [{ width: 100 }],
      header: [{ height: 14, style: 'bold', cells: [{ value: 'H', style: 'bold' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.a', style: 42 }] }] },
  ], { data: { rows: [{ a: 1 }] }, def: { styles: { base: 'bold' } } });
  it('renders, ignoring it', async () => {
    const out = await render(def(), { fontStore });
    const t = out.pages[0].items.filter(i => i.t === 'text').map(i => i.lines[0].text);
    expect(t).toEqual(expect.arrayContaining(['Hello', 'H', '1']));
  });
  it('validate() says so', () => {
    const r = validate(def());
    expect([...r.errors, ...r.warnings].join('\n')).toMatch(/T: "style" must be an object/);
  });
});
