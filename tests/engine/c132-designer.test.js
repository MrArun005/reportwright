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
      st.getState().init('r', { $schema: 'pagewright/report@1', name: 'R', page: { size: 'A4' }, dataSources: [], dataSets: [],
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
