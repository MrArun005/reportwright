// Groups ordered by an aggregate (sortBy), interactive sort reordering groups, and filters that Lookup into earlier data sets.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report, texts } from '../helpers.js';

const rows = [
  { city: 'Agra', amt: 1 }, { city: 'Agra', amt: 1 },
  { city: 'Bhopal', amt: 10 },
  { city: 'Cuttack', amt: 3 }, { city: 'Cuttack', amt: 3 },
];
const table = (group) => report([{
  type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }],
  header: [{ height: 16, cells: [{ value: 'City', sortBy: '=Fields.city' }, { value: 'Total', sortBy: '=Sum(Fields.amt)' }] }],
  groups: [{ name: 'City', expr: '=Fields.city', header: [{ height: 16, cells: [{ value: '=Fields.city' }, { value: '=Sum(Fields.amt)' }] }], ...group }],
  detail: [],
}], { data: { rows } });
const order = async (def, state) => texts((await render(def, { fontStore, state })).pages[0]).filter(t => ['Agra', 'Bhopal', 'Cuttack'].includes(t));

describe('group sorting', () => {
  it('sort alone orders groups by their value', async () => {
    expect(await order(table({ sort: 'desc' }))).toEqual(['Cuttack', 'Bhopal', 'Agra']);
  });
  it('sortBy orders groups by an aggregate in the group scope', async () => {
    expect(await order(table({ sort: 'desc', sortBy: '=Sum(Fields.amt)' }))).toEqual(['Bhopal', 'Cuttack', 'Agra']);
    expect(await order(table({ sortBy: '=Sum(Fields.amt)' }))).toEqual(['Agra', 'Cuttack', 'Bhopal']);
  });
  it('an interactive sort on a header reorders the groups by group totals, and wins over sortBy', async () => {
    const def = table({ sort: 'asc' });
    expect(await order(def, { sort: { T: [{ by: '=Sum(Fields.amt)', dir: 'desc' }] } })).toEqual(['Bhopal', 'Cuttack', 'Agra']);
    expect(await order(table({ sort: 'desc', sortBy: '=Sum(Fields.amt)' }), { sort: { T: [{ by: '=Fields.city', dir: 'asc' }] } })).toEqual(['Agra', 'Bhopal', 'Cuttack']);
  });
});

describe('data set filters', () => {
  it('can Lookup into a data set defined above', async () => {
    const def = report([{ type: 'textbox', name: 'N', x: 0, y: 0, w: 200, h: 16, value: '=Count(Fields.city, "Same")' }], {
      data: { rows: [{ city: 'Pune', region: 'West' }, { city: 'Mumbai', region: 'West' }, { city: 'Delhi', region: 'North' }] },
      def: { parameters: [{ name: 'city', type: 'string', default: 'Pune' }] },
    });
    def.dataSets.push({ name: 'Same', source: 'src', path: '$.rows', filters: [{ expr: '=Fields.region', op: '=', value: '=Lookup(Parameters.city, Fields.city, Fields.region, "Rows")' }] });
    expect(texts((await render(def, { fontStore })).pages[0])).toContain('2');
  });
});

describe('drill-down toggle beside a drill-through', () => {
  it('only the arrow toggles when the first cell has its own action, so the action stays clickable', async () => {
    const def = table({ collapsible: true });
    def.sections.body.items[0].groups[0].header[0].cells[0].action = { type: 'report', report: 'detail', params: { city: '=Fields.city' } };
    const links = (await render(def, { fontStore })).pages[0].items.filter(i => i.t === 'link');
    const toggle = links.find(l => l.action?.type === 'toggle'), drill = links.find(l => l.action?.type === 'drill');
    expect(drill.w).toBe(100);
    expect(toggle.w).toBeLessThan(30);
    // without an action the whole cell toggles, as before
    const plain = (await render(table({ collapsible: true }), { fontStore })).pages[0].items.find(i => i.t === 'link' && i.action?.type === 'toggle');
    expect(plain.w).toBe(100);
  });
});
