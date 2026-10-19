// Property-based tests of the designer store (fast-check, no browser): random sequences of the commands the designer's
// UI runs, on random reports. After every step the report must stay valid (validate: no errors), item ids and names
// unique, no table/matrix/subreport in a page header or footer (nested ones too), every box finite and not negative, and
// every item inside its band or container. Undo all the way gives the report as opened; redo all the way gives the
// last state back, JSON for JSON. A paste right after a copy pastes that copy.
// Shrunk counterexamples found while writing this file are kept as regression tests at the end.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import * as st from '../../src/designer/store.js';
import { validate } from '../../src/engine/schema/validate.js';
import { ITEMS } from '../../src/engine/items/index.js';

let store;
const S = () => store.getState();
const BANDS = ['pageHeader', 'body', 'pageFooter'];
const SIMPLE = [
  'textbox',
  'shape',
  'line',
  'image',
  'checkbox',
  'barcode',
  'richtext',
  'container',
  'list',
  'table',
  'subreport',
  'matrix',
];
const HOWS = ['left', 'hcenter', 'right', 'top', 'vmiddle', 'bottom', 'hdist', 'vdist', 'width', 'height'];
const RUNS = Number(process.env.FC_RUNS || 150);

/* ------------------------------------------------------------ random reports */
const tbox = (name, x, y, w, h) => ({ type: 'textbox', name, x, y, w, h, value: name });
const itemArb = (n) =>
  fc
    .record({
      x: fc.integer({ min: 0, max: 400 }),
      y: fc.integer({ min: 0, max: 200 }),
      w: fc.integer({ min: 1, max: 120 }),
      h: fc.integer({ min: 1, max: 60 }),
    })
    .map((r) => tbox(`T${n}`, r.x, r.y, r.w, r.h));
const reportArb = fc
  .tuple(fc.array(fc.integer({ min: 0, max: 400 }), { minLength: 0, maxLength: 6 }), fc.boolean(), fc.boolean())
  .chain(([xs, withBox, withTable]) =>
    fc.tuple(...xs.map((_, i) => itemArb(i)), fc.constant(withBox), fc.constant(withTable)),
  )
  .map((arr) => {
    const withTable = arr.pop(),
      withBox = arr.pop();
    const items = [...arr];
    if (withBox)
      items.push({ type: 'container', name: 'Box', x: 0, y: 300, w: 200, h: 60, items: [tbox('Kid', 4, 4, 80, 20)] });
    if (withTable)
      items.push({
        type: 'table',
        name: 'Tbl',
        x: 0,
        y: 380,
        w: 144,
        h: 36,
        columns: [{ width: 72 }, { width: 72 }],
        header: [{ height: 18, cells: [{ value: 'a' }, { value: 'b' }] }],
        detail: [{ height: 18, cells: [{ value: '1' }, { value: '2' }] }],
      });
    return {
      $schema: 'reportwright/report@1',
      name: 'P',
      page: { size: 'A4', margins: [36, 36, 36, 36] },
      dataSources: [],
      dataSets: [],
      sections: {
        pageHeader: { height: 40, items: [tbox('H', 0, 4, 100, 20)] },
        body: { height: 460, items },
        pageFooter: { height: 30, items: [tbox('F', 0, 4, 100, 20)] },
      },
    };
  });

/* ------------------------------------------------------------ actions */
const ids = () => {
  const out = [];
  st.walk(S().def, (it) => out.push(it.id));
  return out;
};
const pick = (list, k) => (list.length ? list[k % list.length] : null);
const actionArb = fc.oneof(
  fc.record({ t: fc.constant('select'), k: fc.nat(), n: fc.integer({ min: 1, max: 3 }) }),
  fc.record({
    t: fc.constant('add'),
    type: fc.constantFrom(...SIMPLE),
    band: fc.constantFrom(...BANDS),
    x: fc.integer({ min: -50, max: 600 }),
    y: fc.integer({ min: -50, max: 500 }),
    into: fc.boolean(),
  }),
  fc.record({ t: fc.constant('nudge'), dx: fc.integer({ min: -40, max: 40 }), dy: fc.integer({ min: -40, max: 40 }) }),
  fc.record({
    t: fc.constant('move'),
    dx: fc.integer({ min: -600, max: 600 }),
    dy: fc.integer({ min: -600, max: 600 }),
  }),
  fc.record({
    t: fc.constant('toBand'),
    band: fc.constantFrom(...BANDS),
    dx: fc.integer({ min: -100, max: 100 }),
    dy: fc.integer({ min: -100, max: 100 }),
  }),
  fc.record({
    t: fc.constant('resize'),
    w: fc.oneof(fc.integer({ min: -50, max: 900 }), fc.constant(NaN)),
    h: fc.oneof(fc.integer({ min: -50, max: 900 }), fc.constant(NaN)),
  }),
  fc.record({ t: fc.constant('align'), how: fc.constantFrom(...HOWS), page: fc.boolean() }),
  fc.record({ t: fc.constantFrom('copy', 'cut', 'duplicate', 'delete', 'undo', 'redo', 'selectAll', 'out') }),
  fc.record({ t: fc.constant('paste'), band: fc.constantFrom(...BANDS) }),
  fc.record({ t: fc.constant('moveTo'), k: fc.nat(), idx: fc.integer({ min: 0, max: 5 }) }),
  fc.record({ t: fc.constant('reorder'), by: fc.constantFrom(-1, 1) }),
  fc.record({
    t: fc.constant('table'),
    op: fc.constantFrom('insCol', 'delCol', 'insRow', 'delRow', 'mergeR', 'split', 'mergeD', 'splitR', 'group'),
    a: fc.nat(),
    b: fc.nat(),
  }),
);

function run(a) {
  const s = S();
  const sel = s.sel.kind === 'items' ? s.sel.ids : [];
  switch (a.t) {
    case 'select': {
      const all = ids();
      if (all.length)
        s.select({ kind: 'items', ids: [...new Set(Array.from({ length: a.n }, (_, i) => pick(all, a.k + i * 7)))] });
      break;
    }
    case 'add': {
      const parent = a.into
        ? ids()
            .map((id) => st.findItem(s.def, id))
            .find((f) => f && st.NESTING.has(f.item.type) && f.section === a.band)
        : null;
      if (!ITEMS[a.type]) break;
      if (st.BODY_ONLY.has(a.type) && a.band !== 'body') {
        st.addItem(a.type, 'body', a.x, a.y);
        break;
      } // the UI sends them to the body (insertSpot)
      st.addItem(a.type, a.band, a.x, a.y, {}, parent?.item.id || null);
      break;
    }
    case 'nudge':
      if (sel.length) st.moveItems(sel, a.dx, a.dy, { nudge: true });
      break;
    case 'move':
      if (sel.length) st.moveItems(sel, a.dx, a.dy);
      break;
    case 'toBand':
      if (sel.length) st.moveItems(sel, a.dx, a.dy, { to: { section: a.band, ox: 0, oy: 0 } });
      break;
    case 'resize':
      if (sel.length === 1)
        st.updateItem(sel[0], (it) => {
          it.w = a.w;
          it.h = a.h;
        });
      break;
    case 'align':
      if (sel.length) st.alignItems(sel, a.how, a.page);
      break;
    case 'copy':
      st.copySelection();
      break;
    case 'cut':
      st.cutSelection();
      break;
    case 'paste':
      st.pasteItems(a.band);
      break;
    case 'duplicate':
      st.duplicateSelection();
      break;
    case 'delete':
      st.deleteSelection();
      break;
    case 'undo':
      s.undo();
      break;
    case 'redo':
      s.redo();
      break;
    case 'selectAll':
      st.selectAllItems();
      break;
    case 'out':
      if (sel.length === 1) st.moveOutOfParent(sel[0]);
      break;
    case 'moveTo': {
      if (sel.length !== 1) break;
      const f = st.findItem(s.def, sel[0]);
      const nest = [];
      st.walk(s.def, (it, _l, _i, _p, sec) => {
        if (st.NESTING.has(it.type) && sec === f?.section) nest.push(it.id);
      });
      st.moveItemTo(sel[0], pick([null, ...nest], a.k), a.idx);
      break;
    }
    case 'reorder':
      if (sel.length === 1) st.reorderItem(sel[0], a.by);
      break;
    case 'table': {
      const tbl = [];
      st.walk(s.def, (it) => {
        if (it.type === 'table' && Array.isArray(it.columns)) tbl.push(it);
      });
      const t = pick(tbl, a.a);
      if (!t) break;
      const n = t.columns.length,
        rows = (t.detail || []).length || 1,
        c = a.b % n,
        r = a.a % rows;
      const op = {
        insCol: () => st.tableInsertColumn(t.id, c),
        delCol: () => st.tableDeleteColumn(t.id, c),
        insRow: () => st.tableInsertRow(t.id, 'detail', r),
        delRow: () => st.tableDeleteRow(t.id, 'detail', r),
        mergeR: () => st.tableMergeRight(t.id, 'header', 0, c),
        split: () => st.tableSplit(t.id, 'header', 0, c),
        mergeD: () => st.tableMergeDown(t.id, 'detail', r, c),
        splitR: () => st.tableSplitRows(t.id, 'detail', r, c),
        group: () => st.tableAddGroup(t.id, 'x'),
      }[a.op];
      try {
        if (
          rowsOf(t, a.op === 'mergeR' || a.op === 'split' ? 'header' : 'detail')?.[
            a.op === 'mergeR' || a.op === 'split' ? 0 : r
          ]?.cells?.[c]
        )
          op();
      } catch (e) {
        throw new Error(`table ${a.op}: ${e.message}`);
      }
      break;
    }
  }
}
const rowsOf = st.rowsOf;

/* ------------------------------------------------------------ invariants */
const PAGE_BANDS = (key) => key === 'pageHeader' || key === 'pageFooter' || /:page(Header|Footer)$/.test(key);
function check(def, where) {
  const idSeen = new Set(),
    names = new Set(),
    bad = [];
  const go = (list, key, parent, roomH) =>
    (list || []).forEach((it) => {
      if (!it || typeof it !== 'object') {
        bad.push(`${key}: not an item`);
        return;
      }
      if (idSeen.has(it.id)) bad.push(`duplicate id ${it.id}`);
      idSeen.add(it.id);
      if (names.has(it.name)) bad.push(`duplicate name ${it.name}`);
      names.add(it.name);
      if (PAGE_BANDS(key) && st.BODY_ONLY.has(it.type))
        bad.push(`${it.type} ${it.name} in ${key}${parent ? ` (inside ${parent.name})` : ''}`);
      for (const k of ['x', 'y', 'w', 'h'])
        if (typeof it[k] !== 'number' || !Number.isFinite(it[k]) || it[k] < 0) bad.push(`${it.name}.${k} = ${it[k]}`);
      if (it.y + it.h > roomH + 0.5)
        bad.push(
          `${it.name} bottom ${it.y + it.h} below its ${parent ? `container ${parent.name} (h ${roomH})` : `band ${key} (h ${roomH})`}`,
        );
      go(it.items, key, it, it.h);
    });
  for (const { key } of st.sectionList(def)) {
    const b = st.secOf(def, key);
    go(b?.items, key, null, b?.height || 0);
  }
  const errs = validate(def).errors;
  if (errs.length) bad.push(...errs.map((e) => `validate: ${e}`));
  expect(bad, `${where}`).toEqual([]);
}

function load(def) {
  store = st.newDesignerStore();
  st.activateStore(store);
  S().init('p', def);
}
const json = (d) => JSON.stringify(d);

/** Run a sequence; check after every step; then undo all and redo all. */
function scenario(def, actions) {
  load(def);
  const first = json(S().def);
  check(S().def, 'loaded');
  actions.forEach((a, i) => {
    run(a);
    check(S().def, `after step ${i} ${JSON.stringify(a)}`);
  });
  const last = json(S().def);
  const n = S().past.length,
    m = S().future.length;
  for (let i = 0; i < n; i++) S().undo();
  // after undoing everything: either the report as opened, or (redo steps remained before) a state on the path
  if (m === 0 || S().past.length === 0) expect(S().past.length).toBe(0);
  for (let i = 0; i < n + m; i++) S().redo();
  for (let i = 0; i < m; i++) S().undo(); // back to where the run ended
  expect(json(S().def), 'undo × n then redo × n is the same report').toBe(last);
  if (S().past.length === n && m === 0) {
    for (let i = 0; i < n; i++) S().undo();
    expect(json(S().def), 'undo all is the report as opened').toBe(first);
  }
}

describe('designer store: random command sequences keep every invariant', () => {
  it('fast-check: valid, unique ids/names, body-only rule (nested too), sane boxes, items inside their band, undo/redo identity', () => {
    fc.assert(
      fc.property(reportArb, fc.array(actionArb, { minLength: 1, maxLength: 40 }), (def, actions) => {
        scenario(def, actions);
      }),
      { numRuns: RUNS, seed: Number(process.env.FC_SEED) || 20261019, endOnFailure: true },
    );
  });

  it('fast-check: a paste right after a copy pastes that copy (same types and contents, new ids and names)', () => {
    fc.assert(
      fc.property(
        reportArb,
        fc.array(actionArb, { maxLength: 15 }),
        fc.nat(),
        fc.integer({ min: 1, max: 3 }),
        (def, actions, k, n) => {
          load(def);
          for (const a of actions) run(a);
          const all = ids();
          if (!all.length) return;
          // top-level items of one band, as the canvas selects them
          const band = st.findItem(S().def, pick(all, k)).section;
          const tops = (st.secOf(S().def, band)?.items || []).slice(0, n).map((i) => i.id);
          if (!tops.length) return;
          S().select({ kind: 'items', ids: tops });
          st.copySelection();
          const copied = tops.map((id) => st.findItem(S().def, id).item);
          const got = st.pasteItems(band);
          expect(got).toBe(copied.length);
          const pasted = S().sel.ids.map((id) => st.findItem(S().def, id).item);
          const strip = (it) =>
            JSON.parse(
              JSON.stringify(it, (key, v) =>
                key === 'id' || key === 'name' || key === 'x' || key === 'y' ? undefined : v,
              ),
            );
          expect(pasted.map(strip)).toEqual(copied.map(strip));
          for (const p of pasted) expect(copied.some((c) => c.id === p.id || c.name === p.name)).toBe(false);
        },
      ),
      { numRuns: RUNS, seed: Number(process.env.FC_SEED) || 20261019 },
    );
  });
});

/* ------------------------------------------------------------ shrunk counterexamples, kept as regression tests */
const base = () => ({
  $schema: 'reportwright/report@1',
  name: 'P',
  page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [],
  dataSets: [],
  sections: {
    pageHeader: { height: 40, items: [tbox('H', 0, 4, 100, 20)] },
    body: {
      height: 460,
      items: [{ type: 'container', name: 'Box', x: 0, y: 300, w: 200, h: 60, items: [tbox('Kid', 4, 4, 80, 20)] }],
    },
    pageFooter: { height: 30, items: [tbox('F', 0, 4, 100, 20)] },
  },
});
const idOf = (name) => {
  let id = null;
  st.walk(S().def, (it) => {
    if (it.name === name) id = it.id;
  });
  return id;
};

describe('regressions found by the property test', () => {
  beforeEach(() => load(base()));

  it('a child nudged down grows its container, and the container grows its band (not past it)', () => {
    S().select({ kind: 'items', ids: [idOf('Kid')] });
    for (let i = 0; i < 20; i++) st.moveItems([idOf('Kid')], 0, 10, { nudge: true });
    check(S().def, 'after 20 nudges');
  });
  it('a child made taller in the Inspector grows its container and the band', () => {
    st.updateItem(idOf('Kid'), (it) => {
      it.h = 400;
    });
    check(S().def, 'after resize');
  });
  it('a child aligned to the bottom of a taller selection stays inside its container', () => {
    st.alignItems([idOf('Kid'), idOf('Box')], 'bottom');
    check(S().def, 'after align');
  });
  it('a paste of [null] says nothing to paste instead of throwing', () => {
    expect(() => st.pasteItems('body', JSON.stringify({ kind: 'pagewright/items@1', items: [null] }))).not.toThrow();
    check(S().def, 'after paste');
  });
  it('pasted sizes that are not numbers, or negative, become sane sizes', () => {
    st.pasteItems(
      'body',
      JSON.stringify({
        kind: 'pagewright/items@1',
        items: [{ type: 'textbox', name: 'Q', x: 5, y: 5, w: 'abc', h: -50, value: 'x' }],
      }),
    );
    check(S().def, 'after paste');
  });
  it('a container holding a table, moved by a drag into the page header, stays in the body', () => {
    st.addItem('table', 'body', 0, 0, {}, idOf('Box'));
    st.moveItems([idOf('Box')], 0, 0, { to: { section: 'pageHeader', ox: 0, oy: 0 } });
    check(S().def, 'after the drag');
  });
});
