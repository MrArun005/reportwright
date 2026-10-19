// Designer store: the layout commands behind the canvas (moveItems, alignItems, nudgeStep, minSize, reorderItem,
// selectAllItems). The browser tests (tests/designer/move-resize.test.mjs) drive the same commands from the UI.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  newDesignerStore,
  activateStore,
  findItem,
  secOf,
  moveItems,
  alignItems,
  nudgeStep,
  minSize,
  reorderItem,
  selectAllItems,
  updateItem,
  bodyWidth,
} from '../../src/designer/store.js';

const tb = (id, x, y, w = 100, h = 20, more = {}) => ({
  id,
  type: 'textbox',
  name: id.toUpperCase(),
  x,
  y,
  w,
  h,
  value: 'x',
  ...more,
});
let st;
const S = () => st.getState();
const item = (id) => findItem(S().def, id)?.item;
const xy = (id) => [item(id).x, item(id).y];
function load(body, more = {}) {
  st = newDesignerStore();
  activateStore(st);
  S().init('r', {
    $schema: 'reportwright/report@1',
    name: 'R',
    page: { size: 'A4', margins: [36, 36, 36, 36] },
    dataSources: [],
    dataSets: [],
    ...more,
    sections: {
      pageHeader: { height: 40, items: [tb('h1', 0, 4)] },
      body: { height: 400, items: body },
      pageFooter: { height: 30, items: [] },
      ...(more.sections || {}),
    },
  });
}
const BW = 523.28;

describe('nudgeStep', () => {
  it('1 pt, a grid step with snap, a cell in cell mode; Shift ten of them', () => {
    expect(nudgeStep({ snap: false, grid: 4, cells: false, cellSize: 12 }, false)).toBe(1);
    expect(nudgeStep({ snap: false, grid: 4, cells: false, cellSize: 12 }, true)).toBe(10);
    expect(nudgeStep({ snap: true, grid: 4, cells: false, cellSize: 12 }, false)).toBe(4);
    expect(nudgeStep({ snap: true, grid: 4, cells: false, cellSize: 12 }, true)).toBe(40);
    expect(nudgeStep({ snap: true, grid: 4, cells: true, cellSize: 12 }, false)).toBe(12);
    expect(nudgeStep({ snap: false, grid: 4, cells: true, cellSize: 24 }, true)).toBe(240);
  });
});

describe('minSize', () => {
  it('no box below 1 pt; NaN and negatives become 1; a line may be 0 one way', () => {
    const a = { type: 'textbox', w: 0, h: -3 };
    minSize(a);
    expect([a.w, a.h]).toEqual([1, 1]);
    const b = { type: 'textbox', w: NaN, h: 0.2 };
    minSize(b);
    expect([b.w, b.h]).toEqual([1, 1]);
    const l = { type: 'line', w: 0, h: 50 };
    minSize(l);
    expect([l.w, l.h]).toEqual([0, 50]);
    const z = { type: 'line', w: 0, h: 0 };
    minSize(z);
    expect([z.w, z.h]).toEqual([1, 0]);
  });
});

describe('moveItems', () => {
  beforeEach(() => load([tb('a', 100, 100), tb('b', 0, 0), tb('wide', 0, 200, BW, 20)]));
  it('a drag is kept inside the band; a nudge moves the whole step but never before the start', () => {
    moveItems(['a'], 5000, -5000);
    expect(xy('a')).toEqual([BW - 100, 0]);
    moveItems(['b'], -10, -10, { nudge: true });
    expect(xy('b')).toEqual([0, 0]);
    moveItems(['wide'], 1, 0, { nudge: true });
    expect(item('wide').x).toBe(1); // E12: the whole step, the Issues panel flags the overflow
    moveItems(['wide'], 1, 0);
    expect(item('wide').x).toBe(0); // a drag puts it back inside
  });
  it('the band grows to an item moved below it', () => {
    moveItems(['a'], 0, 1000);
    expect(item('a').y).toBe(1100);
    expect(secOf(S().def, 'body').height).toBe(1120);
  });
  it('a move of 0 is no history step', () => {
    const n = S().past.length;
    moveItems(['a'], 0, 0);
    expect(S().past.length).toBe(n);
  });
  it('cell mode refuses a move onto another item and says so', () => {
    load([tb('a', 12, 12, 48, 24), tb('b', 72, 12, 48, 24)]);
    S().setUi({ cells: true });
    moveItems(['a'], 12, 0, { nudge: true });
    expect(item('a').x).toBe(24);
    moveItems(['a'], 12, 0, { nudge: true });
    expect(item('a').x).toBe(24);
    expect(S().saveError).toMatch(/cells are taken/);
  });
  it('a band move snaps y again to the grid and keeps x inside the new band', () => {
    load([tb('a', 400, 10)]);
    moveItems(['a'], 500, 5, { to: { section: 'pageFooter', ox: 0, oy: 401.3 } });
    const f = findItem(S().def, 'a');
    expect(f.section).toBe('pageFooter');
    expect(f.item.x).toBe(BW - 100);
    expect(f.item.y % 4).toBe(0);
    expect(f.item.y).toBeGreaterThanOrEqual(0);
  });
});

describe('alignItems', () => {
  beforeEach(() => load([tb('a', 20, 20, 100, 20), tb('b', 200, 60, 60, 30), tb('c', 300, 120, 40, 10)]));
  it('one item aligns to its band', () => {
    alignItems(['b'], 'right');
    expect(item('b').x).toBeCloseTo(BW - 60, 2);
    alignItems(['b'], 'bottom');
    expect(item('b').y).toBe(370);
    alignItems(['b'], 'hcenter');
    expect(item('b').x).toBeCloseTo(BW / 2 - 30, 2);
    alignItems(['b'], 'vmiddle');
    expect(item('b').y).toBe(185);
  });
  it('distribute with fewer than three items changes nothing', () => {
    const before = S().def;
    alignItems(['a', 'b'], 'hdist');
    alignItems(['a', 'b'], 'vdist');
    expect(S().def).toBe(before);
  });
  it('same width never on a table, and the result stays inside the band', () => {
    load([tb('a', 450, 0, 60, 20), tb('b', 0, 40, 300, 20)]);
    alignItems(['a', 'b'], 'width');
    expect(item('a').w).toBe(300);
    expect(item('a').x + item('a').w).toBeLessThanOrEqual(BW + 0.01);
  });
  it('to page in a container: the container is the page', () => {
    load([
      {
        id: 'box',
        type: 'container',
        name: 'Box',
        x: 100,
        y: 50,
        w: 200,
        h: 100,
        items: [tb('k1', 10, 10, 50, 20), tb('k2', 30, 50, 20, 20)],
      },
    ]);
    alignItems(['k1', 'k2'], 'right', true);
    expect([item('k1').x, item('k2').x]).toEqual([150, 180]);
    alignItems(['k1', 'k2'], 'bottom', true);
    expect([item('k1').y, item('k2').y]).toEqual([80, 80]);
  });
});

describe('reorderItem and selectAllItems', () => {
  beforeEach(() => load([tb('a', 0, 0), tb('b', 0, 30), tb('c', 0, 60)]));
  it('reorder moves one place, never past either end', () => {
    reorderItem('a', 1);
    expect(S().def.sections.body.items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    reorderItem('b', -1);
    expect(S().def.sections.body.items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    reorderItem('c', 1);
    expect(S().def.sections.body.items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
  it('select all: the band of the selection, else the body', () => {
    expect(selectAllItems()).toBe(3);
    expect(S().sel.ids).toEqual(['a', 'b', 'c']);
    S().select({ kind: 'items', ids: ['h1'] });
    selectAllItems();
    expect(S().sel.ids).toEqual(['h1']);
    S().select({ kind: 'section', section: 'pageFooter' });
    expect(selectAllItems()).toBe(0);
    expect(S().sel).toEqual({ kind: 'section', section: 'pageFooter' });
  });
});

describe('updateItem geometry', () => {
  beforeEach(() => load([tb('a', 100, 100)]));
  it('a width of 0 from the Inspector becomes 1 pt; an x past the band is kept (the Issues panel flags it)', () => {
    updateItem('a', (t) => {
      t.w = 0;
    });
    expect(item('a').w).toBe(1);
    updateItem('a', (t) => {
      t.x = 9999;
    });
    expect(item('a').x).toBe(9999);
    expect(bodyWidth(S().def)).toBeCloseTo(BW, 2);
  });
});
