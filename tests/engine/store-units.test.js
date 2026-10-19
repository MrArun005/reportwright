// The designer store's editing functions one by one, with exact results: tables (columns, rows, merges, groups),
// align and distribute, reorder, out of a container, the outline's move, body sections, sizes, cell mode, the matrix
// value's Show, and the helpers they use. Written to the code's rules so that a changed rule (a mutant) fails here.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  newDesignerStore,
  activateStore,
  findItem,
  secOf,
  walk,
  allNames,
  uniqueName,
  stableId,
  normalize,
  sectionList,
  pageOf,
  bodyWidth,
  bodyKeyOf,
  isBodyKey,
  isContentKey,
  ownBand,
  addBodySection,
  removeBodySection,
  addItem,
  insertItem,
  updateItem,
  minSize,
  growToFit,
  reorderItem,
  moveOutOfParent,
  moveItemTo,
  deleteSelection,
  duplicateSelection,
  cloneWithIds,
  rowsOf,
  tableParts,
  tableRowList,
  cellRange,
  columnCells,
  rowCells,
  selCells,
  selectCells,
  tableSync,
  tableInsertColumn,
  tableDeleteColumn,
  tableInsertRow,
  tableDeleteRow,
  tableSetColumnWidth,
  tableMergeRight,
  tableSplit,
  tableMergeDown,
  tableSplitRows,
  tableAddGroup,
  tableRemoveGroup,
  alignItems,
  round,
  nudgeStep,
  clamp,
  overlapsAny,
  snapCells,
  wouldOverlap,
  setMatrixShow,
  holdsBodyOnly,
  BODY_ONLY,
  selectedBand,
  insertSpot,
  moveItems,
  uploadImages,
} from '../../src/designer/store.js';

let st;
const S = () => st.getState();
const item = (id) => findItem(S().def, id)?.item;
const tb = (id, x, y, w = 100, h = 20) => ({ id, type: 'textbox', name: id.toUpperCase(), x, y, w, h, value: id });
const table = () => ({
  id: 't',
  type: 'table',
  name: 'T',
  x: 0,
  y: 0,
  w: 300,
  h: 54,
  dataSet: 'D',
  columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
  header: [{ height: 18, cells: [{ value: 'A' }, { value: 'B' }, { value: 'C' }] }],
  detail: [
    {
      height: 18,
      cells: [{ value: '=Fields.a' }, { value: '=Fields.b', style: { format: 'C2' } }, { value: '=Fields.c' }],
    },
  ],
  footer: [{ height: 18, cells: [{ value: 'f1' }, { value: 'f2' }, { value: 'f3' }] }],
});
const report = (body = [], extra = {}) => ({
  $schema: 'reportwright/report@1',
  name: 'U',
  page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [],
  dataSets: [],
  sections: {
    pageHeader: { height: 40, items: [] },
    body: { height: 400, items: body },
    pageFooter: { height: 30, items: [] },
  },
  ...extra,
});
const load = (body, extra) => {
  st = newDesignerStore();
  activateStore(st);
  S().init('r', report(body, extra));
};
const T = () => item('t');
const vals = (rows) => rows.map((r) => r.cells.map((c) => (c ? [c.value, c.colSpan || 1, c.rowSpan || 1] : null)));

describe('helpers', () => {
  it('round, clamp, nudgeStep', () => {
    expect(round(1.005)).toBe(1);
    expect(round(2.345)).toBe(2.35);
    expect(round(-1.234)).toBe(-1.23);
    expect([clamp(5, 0, 3), clamp(-1, 0, 3), clamp(2, 0, 3)]).toEqual([3, 0, 2]);
    expect(nudgeStep({ snap: false, grid: 4, cells: false, cellSize: 12 }, false)).toBe(1);
    expect(nudgeStep({ snap: false, grid: 4, cells: false, cellSize: 12 }, true)).toBe(10);
    expect(nudgeStep({ snap: true, grid: 4, cells: false, cellSize: 12 }, false)).toBe(4);
    expect(nudgeStep({ snap: true, grid: 4, cells: false, cellSize: 12 }, true)).toBe(40);
    expect(nudgeStep({ snap: true, grid: 4, cells: true, cellSize: 12 }, false)).toBe(12);
    expect(nudgeStep({ snap: false, grid: 4, cells: true, cellSize: 12 }, true)).toBe(120);
  });
  it('uniqueName counts up from 1 and takes the name', () => {
    const used = new Set(['Text1', 'Text2']);
    expect(uniqueName(used, 'Text')).toBe('Text3');
    expect(used.has('Text3')).toBe(true);
    expect(uniqueName(used, 'Box')).toBe('Box1');
  });
  it('stableId: the same key gives the same id; a taken one another', () => {
    const a = stableId('body/0/T', new Set());
    expect(a).toBe(stableId('body/0/T', new Set()));
    expect(a).toMatch(/^[a-z0-9]+$/);
    const taken = new Set([a]);
    const b = stableId('body/0/T', taken);
    expect(b).not.toBe(a);
    expect(taken.has(b)).toBe(true);
    expect(stableId('body/1/T', new Set())).not.toBe(a);
  });
  it('band keys', () => {
    expect([
      isBodyKey('body'),
      isBodyKey('body:2'),
      isBodyKey('body:1:pageHeader'),
      isBodyKey('pageHeader'),
      isBodyKey('content:0'),
    ]).toEqual([true, true, false, false, false]);
    expect([
      bodyKeyOf('body'),
      bodyKeyOf('body:0'),
      bodyKeyOf('body:2'),
      bodyKeyOf('body:2:pageFooter'),
      bodyKeyOf('pageHeader'),
    ]).toEqual(['body', 'body', 'body:2', 'body:2', null]);
    expect([isContentKey('content:1'), isContentKey('body'), isContentKey('contents')]).toEqual([true, false, false]);
    expect([
      ownBand({ pageHeader: { items: [] } }, 'pageHeader'),
      ownBand({ pageHeader: { hidden: true } }, 'pageHeader'),
      ownBand({ pageHeader: [] }, 'pageHeader'),
      ownBand(null, 'pageHeader'),
      ownBand({}, 'pageHeader'),
    ]).toEqual([true, false, false, false, false]);
  });
  it('holdsBodyOnly: the item, or anything inside it', () => {
    expect([...BODY_ONLY].sort()).toEqual(['matrix', 'subreport', 'table']);
    expect(holdsBodyOnly({ type: 'matrix' })).toBe(true);
    expect(holdsBodyOnly({ type: 'container', items: [{ type: 'list', items: [{ type: 'subreport' }] }] })).toBe(true);
    expect(holdsBodyOnly({ type: 'container', items: [{ type: 'textbox' }] })).toBe(false);
    expect(holdsBodyOnly({ type: 'textbox', items: 'x' })).toBe(false);
    expect(holdsBodyOnly(null)).toBe(false);
  });
  it('minSize: nothing under 1 pt; a line may be 0 one way', () => {
    const a = { type: 'textbox', w: 0.2, h: -5 };
    minSize(a);
    expect([a.w, a.h]).toEqual([1, 1]);
    const n = { type: 'textbox', w: NaN, h: 3 };
    minSize(n);
    expect([n.w, n.h]).toEqual([1, 3]);
    const l = { type: 'line', w: 0, h: 0 };
    minSize(l);
    expect([l.w, l.h]).toEqual([1, 0]);
    const l2 = { type: 'line', w: 0, h: 5 };
    minSize(l2);
    expect([l2.w, l2.h]).toEqual([0, 5]);
    const s = { type: 'textbox', w: 'x', h: 2 };
    minSize(s);
    expect(s.w).toBe('x');
  });
  it('overlap and cells', () => {
    const a = { id: 'a', x: 0, y: 0, w: 10, h: 10 };
    expect(overlapsAny(a, [a, { id: 'b', x: 10, y: 0, w: 5, h: 5 }])).toBe(false);
    expect(overlapsAny(a, [{ id: 'b', x: 9, y: 9, w: 5, h: 5 }])).toBe(true);
    expect(overlapsAny(a, [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }])).toBe(false); // the same item
    expect(overlapsAny({ id: 'z', x: 0, y: 0, w: 0, h: 0 }, [{ id: 'b', x: 0.5, y: 0.5, w: 0, h: 0 }])).toBe(true); // 0 counts as 1
  });
});

describe('sections', () => {
  beforeEach(() => load([tb('a', 0, 0)]));
  it('normalize: missing bands, ids and names, the body grows to its items', () => {
    const d = normalize({
      sections: {
        body: {
          items: [
            { type: 'textbox', x: 0, y: 500, w: 10, h: 40 },
            { type: 'container', x: 0, y: 0, w: 10, h: 10 },
          ],
        },
      },
    });
    expect(Object.keys(d.sections).sort()).toEqual(['body', 'pageFooter', 'pageHeader']);
    expect(d.sections.pageHeader).toEqual({ height: 0, items: [] });
    expect(d.sections.body.items.map((i) => i.name)).toEqual(['Textbox1', 'Container1']);
    expect(d.sections.body.items.every((i) => typeof i.id === 'string' && i.id)).toBe(true);
    expect(d.sections.body.items[1].items).toEqual([]);
    expect(d.sections.body.height).toBe(600); // no height: the lowest item + 60
    const e = normalize({
      sections: { body: { height: 100, items: [{ type: 'textbox', x: 0, y: 150, w: 10, h: 20 }] } },
    });
    expect(e.sections.body.height).toBe(170);
    const f = normalize({ sections: { body: [] } });
    expect(f.sections.body).toEqual({ height: 420, items: [] });
    const t = normalize({ sections: { body: { height: 400, items: [table()] } } });
    expect([t.sections.body.items[0].w, t.sections.body.items[0].h]).toEqual([300, 54]);
  });
  it('sectionList: header, the bodies with their own bands, placeholders, footer', () => {
    const d = {
      sections: {
        pageHeader: { items: [] },
        body: [
          { items: [] },
          { name: 'Second', items: [], pageHeader: { items: [] }, pageFooter: { hidden: true, items: [] } },
        ],
        content: [{ placeholder: 'Main', items: [] }],
        pageFooter: { items: [] },
      },
    };
    expect(sectionList(d).map((s) => s.key)).toEqual([
      'pageHeader',
      'body',
      'body:1:pageHeader',
      'body:1',
      'content:0',
      'pageFooter',
    ]);
    expect(sectionList(d).map((s) => s.label)).toEqual([
      'Page header',
      'Section 1',
      'Second · page header',
      'Second',
      'Placeholder “Main”',
      'Page footer',
    ]);
    expect(secOf(d, 'body:1').name).toBe('Second');
    expect(secOf(d, 'body:1:pageHeader')).toBe(d.sections.body[1].pageHeader);
    expect(secOf(d, 'content:0').placeholder).toBe('Main');
  });
  it('add and remove a body section', () => {
    addBodySection();
    expect(S().def.sections.body.map((b) => b.name)).toEqual(['Section1', 'Section2']);
    expect(S().def.sections.body[1]).toEqual({ name: 'Section2', height: 300, items: [] });
    expect(S().def.sections.body[0].items.map((i) => i.id)).toEqual(['a']);
    expect(S().sel).toEqual({ kind: 'section', section: 'body:1' });
    addBodySection();
    expect(S().def.sections.body.map((b) => b.name)).toEqual(['Section1', 'Section2', 'Section3']);
    removeBodySection('body:1');
    expect(S().def.sections.body.map((b) => b.name)).toEqual(['Section1', 'Section3']);
    expect(S().sel).toEqual({ kind: 'report' });
    removeBodySection('body');
    // one left: a single band again, without the section's name
    expect(S().def.sections.body).toEqual({ height: 300, items: [] });
    const past = S().past.length;
    removeBodySection('body');
    expect(S().past.length).toBe(past);
  });
  it('page width: A4 with 36 pt margins', () => {
    expect(bodyWidth(S().def)).toBeCloseTo(595.28 - 72, 1);
    expect(pageOf(S().def, 'body').bodyWidth).toBe(bodyWidth(S().def, 'body'));
  });
});

describe('adding and placing items', () => {
  beforeEach(() =>
    load([
      tb('a', 0, 0),
      { id: 'box', type: 'container', name: 'Box', x: 10, y: 100, w: 200, h: 50, items: [tb('kid', 5, 5, 50, 20)] },
    ]),
  );
  it('addItem: a unique name, kept inside the band, the band grows (24 pt more in a body, 4 in a page band)', () => {
    const id = addItem('textbox', 'body', 9999, 395);
    const it = item(id);
    expect(it.name).toBe('Textbox1');
    expect(it.x).toBe(round(bodyWidth(S().def) - it.w));
    expect(S().def.sections.body.height).toBe(Math.ceil(395 + it.h + 24));
    expect(S().sel).toEqual({ kind: 'items', ids: [id] });
    const h = addItem('textbox', 'pageHeader', -5, 30);
    expect([item(h).x, item(h).y]).toEqual([0, 30]);
    expect(S().def.sections.pageHeader.height).toBe(Math.ceil(30 + item(h).h + 4));
    const third = addItem('textbox', 'body', 0, 0);
    expect(item(third).name).toBe('Textbox3');
  });
  it('addItem into a container: inside its width, the container and band grow', () => {
    const id = addItem('textbox', 'body', 0, 60, { w: 500 }, 'box');
    const box = item('box');
    expect(box.items.map((i) => i.id)).toEqual(['kid', id]);
    expect(item(id).w).toBe(200);
    expect(box.h).toBe(Math.ceil(60 + item(id).h));
    expect(S().def.sections.body.height).toBeGreaterThanOrEqual(box.y + box.h);
  });
  it('addItem of a table: its size from its columns', () => {
    const id = addItem('table', 'body', 0, 0);
    const t = item(id);
    expect(t.w).toBe(t.columns.reduce((s, c) => s + c.width, 0));
  });
  it('insertItem: a chart with data opens the gallery, a table with fields the table gallery, others go in', () => {
    load([], {
      dataSources: [{ name: 's', type: 'json', data: [] }],
      dataSets: [{ name: 'D', source: 's', fields: [{ name: 'a' }] }],
    });
    expect(insertItem('chart', 'body', 1, 2)).toBeNull();
    expect(S().wizard).toEqual({ mode: 'insert', section: 'body', x: 1, y: 2, extra: {}, parentId: null });
    expect(insertItem('matrix', 'body', 3, 4)).toBeNull();
    expect(S().tableWizard).toEqual({ type: 'matrix', section: 'body', x: 3, y: 4, extra: {}, parentId: null });
    expect(typeof insertItem('textbox', 'body', 0, 0)).toBe('string');
    load([], { dataSources: [{ name: 's', type: 'json', data: [] }], dataSets: [{ name: 'D', source: 's' }] });
    expect(typeof insertItem('table', 'body', 0, 0)).toBe('string'); // no fields: straight in
  });
  it('insertSpot and selectedBand', () => {
    const d = S().def;
    expect(insertSpot(d, { kind: 'items', ids: ['box'] })).toEqual({ section: 'body', parentId: 'box', y: 36 }); // below the kid (5 + 20 + 8, on 4 pt)
    expect(insertSpot(d, { kind: 'items', ids: ['kid'] })).toEqual({ section: 'body', parentId: 'box', y: 36 });
    expect(insertSpot(d, { kind: 'items', ids: ['a'] })).toEqual({ section: 'body', parentId: null, y: 160 });
    expect(insertSpot(d, { kind: 'section', section: 'pageFooter' })).toEqual({
      section: 'pageFooter',
      parentId: null,
      y: 0,
    });
    expect(insertSpot(d, { kind: 'section', section: 'pageFooter' }, 'table')).toEqual({
      section: 'body',
      parentId: null,
      y: 160,
    });
    expect(insertSpot(d, { kind: 'report' })).toEqual({ section: 'body', parentId: null, y: 160 });
    expect(selectedBand(d, { kind: 'cell', id: 'kid' })).toBe('body');
    expect(selectedBand(d, { kind: 'section', section: 'nope' })).toBe('body');
  });
  it('updateItem: sizes at least 1, the band grows to it', () => {
    updateItem('a', (it) => {
      it.h = 500;
      it.w = 0;
    });
    expect([item('a').w, item('a').h]).toEqual([1, 500]);
    expect(S().def.sections.body.height).toBe(500);
    updateItem('missing', () => {
      throw new Error('not called');
    });
  });
  it('growToFit: the parent or band grows, never shrinks', () => {
    const d = JSON.parse(JSON.stringify(S().def));
    growToFit(d, { section: 'body', parent: null, item: { y: 390, h: 20.2 } });
    expect(d.sections.body.height).toBe(411);
    growToFit(d, { section: 'body', parent: null, item: { y: 0, h: 1 } });
    expect(d.sections.body.height).toBe(411);
    const parent = { h: 10 };
    growToFit(d, { section: 'body', parent, item: { y: 5, h: 10 } });
    expect(parent.h).toBe(15);
  });
});

describe('order, containers, the outline', () => {
  beforeEach(() =>
    load([
      tb('a', 0, 0),
      tb('b', 0, 30),
      tb('c', 0, 60),
      { id: 'box', type: 'container', name: 'Box', x: 50, y: 100, w: 200, h: 50, items: [tb('kid', 5, 10, 50, 20)] },
    ]),
  );
  const order = () => S().def.sections.body.items.map((i) => i.id);
  it('reorderItem: one place either way, not past the ends', () => {
    reorderItem('b', 1);
    expect(order()).toEqual(['a', 'c', 'b', 'box']);
    reorderItem('b', -1);
    reorderItem('b', -1);
    expect(order()).toEqual(['b', 'a', 'c', 'box']);
    const past = S().past.length;
    reorderItem('b', -1);
    reorderItem('box', 1);
    reorderItem('nope', 1);
    expect(S().past.length).toBe(past);
  });
  it('moveOutOfParent: after the container, at the same place on the page', () => {
    moveOutOfParent('kid');
    expect(order()).toEqual(['a', 'b', 'c', 'box', 'kid']);
    expect([item('kid').x, item('kid').y]).toEqual([55, 110]);
    expect(item('box').items).toEqual([]);
    const past = S().past.length;
    moveOutOfParent('a');
    expect(S().past.length).toBe(past);
  });
  it('moveOutOfParent: kept inside the band, the band grows', () => {
    S().apply((d) => {
      const k = d.sections.body.items[3].items[0];
      k.x = 190;
      k.y = 400;
      k.w = 60;
    });
    moveOutOfParent('kid');
    expect(item('kid').x).toBe(round(Math.min(240, bodyWidth(S().def) - 60)));
    expect(S().def.sections.body.height).toBe(520);
  });
  it('moveItemTo: into a container, keeping its place on the page; out again; never into itself', () => {
    expect(moveItemTo('c', 'box', 0)).toBe(true);
    expect(item('box').items.map((i) => i.id)).toEqual(['c', 'kid']);
    expect([item('c').x, item('c').y]).toEqual([0, 0]); // 0,60 on the band is above the box: clamped to its top left
    expect(moveItemTo('c', null, 1)).toBe(true);
    expect(order()).toEqual(['a', 'c', 'b', 'box']);
    expect([item('c').x, item('c').y]).toEqual([50, 100]);
    expect(moveItemTo('box', 'box', 0)).toBe(false);
    expect(moveItemTo('a', 'b', 0)).toBe(false); // a text box is not a container
    expect(moveItemTo('nope', null, 0)).toBe(false);
    expect(moveItemTo('a', null, 1)).toBe(false); // already there
    expect(moveItemTo('a', null, 2)).toBe(true);
    expect(order()).toEqual(['c', 'a', 'b', 'box']);
  });
  it('delete and duplicate', () => {
    S().select({ kind: 'items', ids: ['a', 'kid'] });
    duplicateSelection();
    const [ca, ck] = S().sel.ids.map(item);
    expect([ca.x, ca.y, ca.name]).toEqual([12, 12, 'A1']);
    expect([ck.x, ck.y]).toEqual([17, 22]);
    expect(item('box').items.length).toBe(2);
    S().select({ kind: 'items', ids: ['a'] });
    duplicateSelection();
    expect([item(S().sel.ids[0]).x, item(S().sel.ids[0]).y]).toEqual([24, 24]); // past the first copy
    S().select({ kind: 'items', ids: ['a', 'b'] });
    deleteSelection();
    expect(order()).not.toContain('a');
    expect(order()).not.toContain('b');
    expect(S().sel).toEqual({ kind: 'report' });
    S().select({ kind: 'report' });
    const past = S().past.length;
    deleteSelection();
    duplicateSelection();
    expect(S().past.length).toBe(past);
  });
  it('cloneWithIds: new ids and names, children too', () => {
    const used = allNames(S().def);
    const c = cloneWithIds(item('box'), used);
    expect(c.id).not.toBe('box');
    expect(c.name).toBe('Box1');
    expect(c.items[0].id).not.toBe('kid');
    expect(c.items[0].name).toBe('KID1');
    expect(item('box').items[0].id).toBe('kid'); // the original kept
  });
  it('walk visits nested items with their parent and band', () => {
    const seen = [];
    walk(S().def, (it, list, i, parent, section) => seen.push([it.id, i, parent?.id || null, section]));
    expect(seen).toEqual([
      ['a', 0, null, 'body'],
      ['b', 1, null, 'body'],
      ['c', 2, null, 'body'],
      ['box', 3, null, 'body'],
      ['kid', 0, 'box', 'body'],
    ]);
  });
});

describe('align and distribute', () => {
  beforeEach(() => load([tb('a', 10, 10, 50, 20), tb('b', 100, 50, 30, 10), tb('c', 40, 200, 70, 40)]));
  const xs = () => ['a', 'b', 'c'].map((i) => item(i).x);
  const ys = () => ['a', 'b', 'c'].map((i) => item(i).y);
  for (const [how, get, want] of [
    ['left', xs, [10, 10, 10]],
    ['right', xs, [80, 100, 60]],
    ['hcenter', xs, [45, 55, 35]],
    ['top', ys, [10, 10, 10]],
    ['bottom', ys, [220, 230, 200]],
    ['vmiddle', ys, [115, 120, 105]],
  ]) {
    it(how, () => {
      alignItems(['a', 'b', 'c'], how);
      expect(get()).toEqual(want);
    });
  }
  it('width and height: the largest', () => {
    alignItems(['a', 'b', 'c'], 'width');
    expect(['a', 'b', 'c'].map((i) => item(i).w)).toEqual([70, 70, 70]);
    alignItems(['a', 'b', 'c'], 'height');
    expect(['a', 'b', 'c'].map((i) => item(i).h)).toEqual([40, 40, 40]);
  });
  it('hdist and vdist: even gaps between the first and last', () => {
    alignItems(['a', 'b', 'c'], 'hdist');
    expect(xs()).toEqual([10, 100, 45]); // by x: a (10, w 50), c (40, w 70), b (100, w 30); gap (130 - 10 - 150) / 2 = -15
    load([tb('a', 0, 0, 10, 10), tb('b', 0, 50, 10, 10), tb('c', 0, 200, 10, 30)]);
    alignItems(['a', 'b', 'c'], 'vdist');
    expect(ys()).toEqual([0, 100, 200]); // gap (230 - 0 - 50) / 2 = 90
    alignItems(['a', 'b'], 'vdist'); // fewer than three: nothing
    expect(ys()).toEqual([0, 100, 200]);
  });
  it('one item: to its band; toPage: to the band', () => {
    alignItems(['b'], 'right');
    expect(item('b').x).toBe(round(bodyWidth(S().def) - 30));
    alignItems(['a', 'c'], 'bottom', true);
    expect([item('a').y, item('c').y]).toEqual([400 - 20, 400 - 40]);
    alignItems(['b'], 'hcenter');
    expect(item('b').x).toBe(round(bodyWidth(S().def) / 2 - 15));
  });
  it('nothing to align: no step', () => {
    const past = S().past.length;
    alignItems(['nope'], 'left');
    expect(S().past.length).toBe(past);
  });
});

describe('moves', () => {
  beforeEach(() => load([tb('a', 10, 10, 50, 20), tb('b', 100, 10, 30, 20)]));
  it('a drag stays in its band; a nudge moves the whole step', () => {
    moveItems(['a'], -50, -50);
    expect([item('a').x, item('a').y]).toEqual([0, 0]);
    moveItems(['a'], 4, 8);
    expect([item('a').x, item('a').y]).toEqual([4, 8]);
    moveItems(['a'], 0, 0);
    expect([item('a').x, item('a').y]).toEqual([4, 8]);
  });
  it('cell mode: a move onto another item is refused, with a message', () => {
    S().setUi({ cells: true });
    moveItems(['a'], 90, 0);
    expect(item('a').x).toBe(10);
    expect(S().saveError).toBeTruthy();
    expect(wouldOverlap(S().def, ['a'], (it) => ({ ...it, x: it.x + 200 }))).toBe(false);
    expect(wouldOverlap(S().def, ['a'], (it) => ({ ...it, x: 100 }))).toBe(true);
    expect(wouldOverlap(S().def, ['a', 'b'], (it) => ({ ...it, x: it.x + 1 }))).toBe(false);
  });
  it('snapCells: whole cells, at least one', () => {
    S().setUi({ cellSize: 12 });
    const it = { type: 'textbox', x: 17, y: 5, w: 3, h: 25 };
    snapCells(it);
    expect(it).toEqual({ type: 'textbox', x: 12, y: 0, w: 12, h: 24 });
    const l = { type: 'line', x: 7, y: 7, w: 3, h: 0 };
    snapCells(l);
    expect(l).toEqual({ type: 'line', x: 12, y: 12, w: 3, h: 0 });
  });
});

describe('tables', () => {
  beforeEach(() => load([table()]));
  it('parts, rows and cells', () => {
    const t = {
      ...table(),
      groups: [{ name: 'G', header: [{ height: 18, cells: [{ value: 'g' }, null, null] }], footer: [] }],
    };
    expect(tableParts(t).map((p) => [p.part, p.tag, p.label])).toEqual([
      ['header', 'H', 'Header'],
      ['g0h', 'G1', 'G header'],
      ['detail', 'D', 'Detail'],
      ['g0f', 'F1', 'G footer'],
      ['footer', 'F', 'Footer'],
    ]);
    expect(rowsOf(t, 'g0h')).toBe(t.groups[0].header);
    expect(rowsOf(t, 'g5h')).toBeNull();
    expect(rowsOf({}, 'detail')).toEqual([]);
    const x = {};
    expect(rowsOf(x, 'detail', true)).toBe(x.detail);
    expect(tableRowList(t)).toEqual([
      { part: 'header', row: 0 },
      { part: 'g0h', row: 0 },
      { part: 'detail', row: 0 },
      { part: 'footer', row: 0 },
    ]);
    expect(cellRange(t, { part: 'header', row: 0, col: 2 }, { part: 'detail', row: 0, col: 1 })).toEqual(
      [
        { part: 'header', row: 0, col: 1 },
        { part: 'header', row: 0, col: 2 },
        { part: 'g0h', row: 0, col: 1 },
        { part: 'g0h', row: 0, col: 2 },
        { part: 'detail', row: 0, col: 1 },
        { part: 'detail', row: 0, col: 2 },
      ].filter((c) => c.part !== 'g0h'),
    );
    expect(cellRange(t, { part: 'nope', row: 0, col: 0 }, { part: 'detail', row: 0, col: 1 })).toEqual([
      { part: 'detail', row: 0, col: 1 },
    ]);
    expect(columnCells(t, 0).map((c) => c.part)).toEqual(['header', 'g0h', 'detail', 'footer']);
    expect(columnCells(t, 1).map((c) => c.part)).toEqual(['header', 'detail', 'footer']);
    expect(rowCells(t, 'g0h', 0)).toEqual([{ part: 'g0h', row: 0, col: 0 }]);
    expect(selCells({ kind: 'cell', part: 'detail', row: 0, col: 2 })).toEqual([{ part: 'detail', row: 0, col: 2 }]);
    expect(selCells({ kind: 'cell', cells: [{ part: 'header', row: 0, col: 0 }] })).toEqual([
      { part: 'header', row: 0, col: 0 },
    ]);
    expect(selCells({ kind: 'items' })).toEqual([]);
  });
  it('selectCells: no duplicates, the first is the one edited, an anchor', () => {
    selectCells('t', [
      { part: 'detail', row: 0, col: 1 },
      { part: 'detail', row: 0, col: 1 },
      { part: 'header', row: 0, col: 0 },
    ]);
    expect(S().sel).toEqual({
      kind: 'cell',
      id: 't',
      part: 'detail',
      row: 0,
      col: 1,
      cells: [
        { part: 'detail', row: 0, col: 1 },
        { part: 'header', row: 0, col: 0 },
      ],
      anchor: { part: 'detail', row: 0, col: 1 },
    });
    selectCells('t', [{ part: 'footer', row: 0, col: 2 }], { part: 'header', row: 0, col: 0 });
    expect(S().sel).toEqual({
      kind: 'cell',
      id: 't',
      part: 'footer',
      row: 0,
      col: 2,
      anchor: { part: 'header', row: 0, col: 0 },
    });
    const before = S().sel;
    selectCells('t', []);
    expect(S().sel).toBe(before);
  });
  it('tableSync: width from columns, height from every row', () => {
    const t = { columns: [{ width: 10.333 }, { width: 20 }], header: [{ height: 10 }], detail: [{}], footer: [] };
    tableSync(t);
    expect([t.w, t.h]).toEqual([30.33, 28]);
  });
  it('insert a column: an empty cell in each row; inside a merge, the merge grows', () => {
    tableInsertColumn('t', 1);
    expect(T().columns.map((c) => c.width)).toEqual([100, 72, 100, 100]);
    expect(vals(T().header)).toEqual([
      [
        ['A', 1, 1],
        ['', 1, 1],
        ['B', 1, 1],
        ['C', 1, 1],
      ],
    ]);
    expect(T().w).toBe(372);
    tableMergeRight('t', 'footer', 0, 0); // f1 over two columns
    tableInsertColumn('t', 1);
    expect(vals(T().footer)).toEqual([[['f1', 3, 1], null, null, ['f2', 1, 1], ['f3', 1, 1]]]);
    tableInsertColumn('t', 0);
    expect(vals(T().header)[0][0]).toEqual(['', 1, 1]);
    tableInsertColumn('t', T().columns.length);
    expect(vals(T().header)[0].at(-1)).toEqual(['', 1, 1]);
  });
  it('delete a column: a merge shrinks, or moves right when it started there; the last column stays', () => {
    tableMergeRight('t', 'header', 0, 0); // A over 0..1
    tableDeleteColumn('t', 0);
    expect(vals(T().header)).toEqual([
      [
        ['A', 1, 1],
        ['C', 1, 1],
      ],
    ]);
    expect(vals(T().detail)).toEqual([
      [
        ['=Fields.b', 1, 1],
        ['=Fields.c', 1, 1],
      ],
    ]);
    load([table()]);
    tableMergeRight('t', 'header', 0, 0);
    tableDeleteColumn('t', 1);
    expect(vals(T().header)).toEqual([
      [
        ['A', 1, 1],
        ['C', 1, 1],
      ],
    ]);
    expect(T().w).toBe(200);
    tableDeleteColumn('t', 1);
    const past = S().past.length;
    tableDeleteColumn('t', 0);
    expect(T().columns.length).toBe(1);
    expect(S().past.length).toBe(past);
  });
  it('rows: insert a blank row, delete; the only detail row stays (without groups)', () => {
    tableInsertRow('t', 'header', 1);
    expect(T().header.map((r) => r.cells.map((c) => c.value))).toEqual([
      ['A', 'B', 'C'],
      ['', '', ''],
    ]);
    expect(T().header[1].height).toBe(18);
    expect(T().h).toBe(72);
    tableDeleteRow('t', 'header', 0);
    expect(T().header.map((r) => r.cells[0].value)).toEqual(['']);
    tableDeleteRow('t', 'detail', 0);
    expect(T().detail.length).toBe(1);
    tableAddGroup('t', 'a');
    tableDeleteRow('t', 'detail', 0);
    expect(T().detail.length).toBe(0);
    tableInsertRow('t', 'g0h', 0);
    expect(T().groups[0].header.length).toBe(2);
  });
  it('column width: at least 12, rounded, the table follows', () => {
    tableSetColumnWidth('t', 0, 3);
    expect(T().columns[0].width).toBe(12);
    tableSetColumnWidth('t', 1, 50.456);
    expect(T().columns[1].width).toBe(50.46);
    expect(T().w).toBe(round(12 + 50.46 + 100));
  });
  it('merge right, split; not past the last column', () => {
    tableMergeRight('t', 'detail', 0, 1);
    expect(vals(T().detail)).toEqual([[['=Fields.a', 1, 1], ['=Fields.b', 2, 1], null]]);
    const past = S().past.length;
    tableMergeRight('t', 'detail', 0, 1);
    expect(S().past.length).toBe(past);
    tableSplit('t', 'detail', 0, 1);
    expect(vals(T().detail)).toEqual([
      [
        ['=Fields.a', 1, 1],
        ['=Fields.b', 1, 1],
        ['', 1, 1],
      ],
    ]);
  });
  it('merge down, split rows; not past the last row', () => {
    tableInsertRow('t', 'header', 1);
    tableMergeRight('t', 'header', 0, 0);
    tableMergeDown('t', 'header', 0, 0);
    expect(vals(T().header)).toEqual([
      [['A', 2, 2], null, ['C', 1, 1]],
      [null, null, ['', 1, 1]],
    ]);
    const past = S().past.length;
    tableMergeDown('t', 'header', 0, 0);
    expect(S().past.length).toBe(past);
    tableSplitRows('t', 'header', 0, 0);
    expect(vals(T().header)).toEqual([
      [['A', 2, 1], null, ['C', 1, 1]],
      [['', 1, 1], null, ['', 1, 1]],
    ]);
  });
  it('add a group: header shows the field, footer sums number columns in their format; drill-down; names unique', () => {
    tableAddGroup(
      't',
      'a',
      [
        [1, 'b'],
        [0, 'x'],
        [9, 'y'],
      ],
      { drill: true },
    );
    const g = T().groups[0];
    expect(g.name).toBe('A');
    expect(g.expr).toBe('=Fields.a');
    expect(g.sort).toBe('asc');
    expect([g.collapsible, g.initiallyCollapsed]).toEqual([true, true]);
    expect(g.header[0].cells.map((c) => c.value)).toEqual(['=Fields.a', '', '']);
    expect(g.header[0].style).toEqual({ fontWeight: 'bold', backgroundColor: '#f8fafc' });
    expect(g.footer[0].cells.map((c) => c.value)).toEqual(['Subtotal {Fields.a}', '=Sum(Fields.b)', '']);
    expect(g.footer[0].cells[1].style).toEqual({ format: 'C2' });
    expect(g.footer[0].style).toEqual({ fontWeight: '600', borderTop: '0.5 solid #cbd5e1' });
    expect(T().detail[0].cells[0].value).toBe(''); // shown by the group header now
    expect(T().h).toBe(90);
    tableAddGroup('t', 'a');
    expect(T().groups.map((x) => x.name)).toEqual(['A', 'A_']);
    expect('collapsible' in T().groups[1]).toBe(false);
    tableAddGroup('t', '');
    expect(T().groups[2]).toMatchObject({ name: 'Group', expr: '' });
    expect(T().groups[2].footer[0].cells[0].value).toBe('Subtotal');
    tableRemoveGroup('t', 0);
    expect(T().groups.map((x) => x.name)).toEqual(['A_', 'Group']);
    expect(T().h).toBe(126);
  });
  it('a format-less number column subtotals as N2', () => {
    tableAddGroup('t', 'a', [[2, 'c']]);
    expect(T().groups[0].footer[0].cells[2]).toEqual({ value: '=Sum(Fields.c)', style: { format: 'N2' } });
  });
});

describe('matrix value Show', () => {
  it('a share gets P1 while the format is the default; back to the value, N0', () => {
    const v = { format: 'N0' };
    setMatrixShow(v, 'pctRow');
    expect(v).toEqual({ show: 'pctRow', format: 'P1' });
    setMatrixShow(v, 'value');
    expect(v).toEqual({ format: 'N0' });
    const w = {};
    setMatrixShow(w, 'pctTotal');
    expect(w).toEqual({ show: 'pctTotal', format: 'P1' });
    const hand = { format: 'C2' };
    setMatrixShow(hand, 'pctCol');
    expect(hand).toEqual({ show: 'pctCol', format: 'C2' });
    setMatrixShow(hand, null);
    expect(hand).toEqual({ format: 'C2' });
  });
});

describe('images', () => {
  it('uploadImages: a name from the file, unique; a wrong type or a too big file says so', async () => {
    load([]);
    const file = (name, type, size = 3) => ({ name, type, size });
    globalThis.FileReader ??= class {
      readAsDataURL(f) {
        this.result = `data:${f.type};base64,AAA`;
        setTimeout(() => this.onload());
      }
    };
    const T = (k, o) => `${k}:${o.name}`;
    const r = await uploadImages(
      [
        file('My Logo!.png', 'image/png'),
        file('My Logo!.png', 'image/png'),
        file('doc.pdf', 'application/pdf'),
        file('big.png', 'image/png', 11 * 1024 * 1024),
        file('__.gif', 'image/gif'),
      ],
      T,
    );
    expect(r.names).toEqual(['My_Logo', 'My_Logo2', 'image']);
    expect(r.err).toBe('imageTooBig:big.png');
    expect(Object.keys(S().def.images)).toEqual(['My_Logo', 'My_Logo2', 'image']);
    const r2 = await uploadImages([file('a.bmp', 'image/bmp')], T);
    expect(r2).toEqual({ names: [], err: 'imageType:a.bmp' });
  });
});
