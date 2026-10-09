// 0.13.2 designer UI review: the arrow keys' step (P1 #3) and the fields the Data panel lists from the data (P1 #5).
import { describe, it, expect, beforeEach } from 'vitest';
import { newDesignerStore, activateStore, moveItems, nudgeStep } from '../../src/designer/store.js';

describe('P1 #3: keyboard nudge', () => {
  const ui = (o) => ({ snap: false, grid: 4, cells: false, cellSize: 12, ...o });
  it('1 pt, Shift 10 pt without snap', () => {
    expect(nudgeStep(ui(), false)).toBe(1);
    expect(nudgeStep(ui(), true)).toBe(10);
  });
  it('one grid step, Shift ten, with Snap to grid', () => {
    expect(nudgeStep(ui({ snap: true }), false)).toBe(4);
    expect(nudgeStep(ui({ snap: true }), true)).toBe(40);
    expect(nudgeStep(ui({ snap: true, grid: 6 }), true)).toBe(60);
  });
  it('a cell, Shift ten cells, in cell mode', () => {
    expect(nudgeStep(ui({ cells: true, snap: true }), false)).toBe(12);
    expect(nudgeStep(ui({ cells: true }), true)).toBe(120);
  });
  describe('moved positions are stored to 2 decimals', () => {
    let st;
    beforeEach(() => {
      st = newDesignerStore(); activateStore(st);
      st.getState().init('r', { $schema: 'reportwright/report@1', name: 'R', page: { size: 'A4' }, dataSources: [], dataSets: [],
        sections: { body: { height: 200, items: [{ type: 'textbox', name: 'A', x: 0.1, y: 0.2, w: 50, h: 10, value: 'x' }] } } });
    });
    it('0.1 + 1 is 1.1, not 1.1000000000000001; Shift adds exactly 10', () => {
      const id = st.getState().def.sections.body.items[0].id;
      moveItems([id], 1, 0);
      expect(st.getState().def.sections.body.items[0].x).toBe(1.1);
      moveItems([id], 0, 10);
      expect(st.getState().def.sections.body.items[0].y).toBe(10.2);
    });
  });
});

describe('E12: the arrow keys move the whole step on a page with margins', () => {
  // A4 with 36 pt margins: a 523.28 pt body. A 523 pt wide item had 0.28 pt of room, so the keys moved it 0.28, then never.
  const ui = (o) => ({ snap: false, grid: 4, cells: false, cellSize: 12, ...o });
  for (const margins of [0, 36]) for (const snap of [false, true]) for (const shift of [false, true]) {
    it(`margins ${margins}, snap ${snap}, shift ${shift}`, () => {
      const st = newDesignerStore(); activateStore(st);
      st.getState().init('r', { $schema: 'reportwright/report@1', name: 'R', page: { size: 'A4', margins }, dataSources: [], dataSets: [],
        sections: { body: { height: 200, items: [{ type: 'textbox', name: 'A', x: 0, y: 0, w: 523, h: 10, value: 'x' }] } } });
      const it_ = () => st.getState().def.sections.body.items[0];
      const step = nudgeStep(ui({ snap }), shift);
      moveItems([it_().id], step, 0, { nudge: true });
      expect(it_().x).toBe(step);
      moveItems([it_().id], step, step, { nudge: true });
      expect([it_().x, it_().y]).toEqual([2 * step, step]);
      moveItems([it_().id], -3 * step, -3 * step, { nudge: true });
      expect([it_().x, it_().y]).toEqual([0, 0]); // never before the band's start
    });
  }
});

describe('P1 #5: the Data panel detects the fields of a data set that declares none', async () => {
  const { detectedFields } = await import('../../src/designer/DataPanel.jsx');
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: i, region: i % 2 ? 'N' : 'S', on: i % 3 === 0, day: '2024-01-31' }));
  const def = { dataSources: [{ name: 'src', type: 'json', data: { items: rows } }, { name: 'web', type: 'rest', url: 'https://x.test/a' }] };
  it('from inline JSON (with the data set path), as the engine types them', () => {
    expect(detectedFields({ name: 'D', source: 'src', path: '$.items' }, def)).toEqual([
      { name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'on', type: 'boolean' }, { name: 'day', type: 'date' }]);
  });
  it('detectDates: false keeps a date-like text a string', () => {
    expect(detectedFields({ name: 'D', source: 'src', path: '$.items', detectDates: false }, def).find(f => f.name === 'day').type).toBe('string');
  });
  it('from the first rows of fetched data (the sample)', () => {
    expect(detectedFields({ name: 'W', source: 'web' }, def, [{ a: 1, b: 'x' }, { a: 2, b: null, c: 'late' }])).toEqual([{ name: 'a', type: 'number' }, { name: 'b', type: 'string' }, { name: 'c', type: 'string' }]);
  });
  it('nothing when the data set declares its fields, or there is nothing to read yet', () => {
    expect(detectedFields({ name: 'D', source: 'src', fields: [{ name: 'id', type: 'number' }] }, def, rows)).toBeNull();
    expect(detectedFields({ name: 'W', source: 'web' }, def)).toBeNull();
    expect(detectedFields({ name: 'W', source: 'web' }, def, [])).toBeNull();
  });
});
