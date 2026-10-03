import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { pageToSvg } from '../../src/exporters/svg.js';
import { fontStore, report } from '../helpers.js';

const data = { rows: [{ cat: 'A', v: 10 }, { cat: 'B', v: 30 }, { cat: 'A', v: 5 }] };
const def = (chartType, extra = {}) => report([{ type: 'chart', name: 'C', x: 0, y: 0, w: 300, h: 180, chartType, dataSet: 'Rows', category: '=Fields.cat',
  series: [{ name: 'V', value: '=Sum(Fields.v)' }], pointAction: { type: 'params', params: { pick: '=Fields.cat' } },
  pointColor: "=IIF(Fields.cat = Parameters.pick, '#0e7490', '#cccccc')", ...extra }],
  { data, def: { parameters: [{ name: 'pick', type: 'string' }] } });

describe('interactive reports', () => {
  for (const chartType of ['column', 'bar', 'line', 'donut']) {
    it(`a ${chartType} chart gives each point a "set parameters" link with a tooltip`, async () => {
      const out = await render(def(chartType), { fontStore, parameters: { pick: 'B' } });
      const links = out.pages[0].items.filter(i => i.t === 'link');
      expect(links.map(l => l.action.params.pick).sort()).toEqual(['A', 'B']);
      expect(links.every(l => l.action.type === 'params' && l.action.toggle === true)).toBe(true);
      expect(links.find(l => l.action.params.pick === 'A').tip).toMatch(/^A: 15/);
      if (chartType === 'donut') expect(links.every(l => typeof l.d === 'string')).toBe(true);
    });
  }
  it('point colour follows the selected parameter', async () => {
    const out = await render(def('column'), { fontStore, parameters: { pick: 'B' } });
    const fills = out.pages[0].items.filter(i => i.t === 'rect').map(r => r.fill);
    expect(fills).toContain('#0e7490');
    expect(fills).toContain('#cccccc');
  });
  it('tooltips without an action render as hover-only shapes', async () => {
    const out = await render(def('column', { pointAction: undefined }), { fontStore });
    const links = out.pages[0].items.filter(i => i.t === 'link');
    expect(links.length).toBe(2);
    expect(links.every(l => l.action === null && l.tip)).toBe(true);
    const svg = pageToSvg(out.pages[0], out.width, out.height);
    expect(svg).toContain('class="pw-tip"');
    expect(svg).not.toContain('data-action="null"');
  });
  it('a text box can set parameters and carry a tooltip', async () => {
    const d = report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 14, value: 'Clear', tooltip: '="Remove " & "filters"', action: { type: 'params', params: { pick: '' }, toggle: false } }],
      { data, def: { parameters: [{ name: 'pick', type: 'string' }] } });
    const out = await render(d, { fontStore });
    const l = out.pages[0].items.find(i => i.t === 'link');
    expect(l.action).toEqual({ type: 'params', params: { pick: '' }, toggle: false });
    expect(l.tip).toBe('Remove filters');
  });
});
