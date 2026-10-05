// 1/0 shows Infinity (SSRS) by default; the report's nonFinite option shows blank or #Error instead.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { blankReport } from '../../src/engine/schema/template.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore } from '../helpers.js';

const text = async (nonFinite) => {
  const def = blankReport();
  if (nonFinite) def.nonFinite = nonFinite;
  def.sections.body.items.push({ id: 'b1', type: 'textbox', x: 0, y: 0, w: 200, h: 20, value: '=1/0' }, { id: 'b2', type: 'textbox', x: 0, y: 30, w: 200, h: 20, value: '=Format(0/0, "N2")' });
  expect(validate(def).warnings).toEqual([]);
  const m = await render(def, { fontStore });
  return m.pages[0].items.filter(i => i.t === 'text').slice(1, -1).map(i => i.lines.map(l => l.text).join('')).filter(Boolean);
};

describe('non-finite numbers', () => {
  it('default: Infinity, NaN', async () => expect(await text()).toEqual(['Infinity', 'NaN']));
  it('blank', async () => expect(await text('blank')).toEqual([]));
  it('#Error', async () => expect(await text('error')).toEqual(['#Error', '#Error']));
});
