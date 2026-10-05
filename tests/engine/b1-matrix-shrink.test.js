// A matrix number cell (incl. the grand total) shrinks to one line inside its column, as a table number cell does.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

describe('matrix number cells fit their column', () => {
  it('the grand total 235,897,306.38 stays on one line inside a 37 pt column', async () => {
    const rows = [{ r: 'North', p: 'A', v: 100000000 }, { r: 'South', p: 'A', v: 85897306.38 }, { r: 'North', p: 'B', v: 50000000 }];
    const def = report([{ type: 'matrix', name: 'M', x: 0, y: 0, w: 300, h: 60, dataSet: 'Rows', columnWidth: 37, cellStyle: { fontSize: 7 }, totalStyle: { fontWeight: 'bold', fontSize: 7 },
      rowGroups: [{ name: 'R', expr: '=Fields.r', total: 'after', width: 60 }], columnGroups: [{ name: 'P', expr: '=Fields.p', total: 'after' }],
      values: [{ value: '=Sum(Fields.v)', format: 'N2' }] }], { data: { rows } });
    def.dataSets[0].fields = [{ name: 'r', type: 'string' }, { name: 'p', type: 'string' }, { name: 'v', type: 'number' }];
    const out = await render(def, { fontStore });
    const t = out.pages[0].items.find(i => i.t === 'text' && i.lines.map(l => l.text).join('').replace(/\W/g, '').startsWith('235897306'));
    expect(t.lines.length).toBe(1);
    expect(t.lines[0].text).toBe('235,897,306.38');
    expect(t.lines[0].x).toBeGreaterThanOrEqual(t.clip.x);
    expect(t.lines[0].x + t.lines[0].w).toBeLessThanOrEqual(t.clip.x + t.clip.w + 0.01);
  });
});
