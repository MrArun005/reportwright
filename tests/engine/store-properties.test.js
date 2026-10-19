// Property tests of the designer store: random reports and random sequences of what a designer user does (insert,
// select, copy, cut, paste, delete, drag, undo, redo, rename), with a system clipboard whose writes are fast, slow or
// blocked. After every step: the report has no validation errors, tables, matrices and subreports are only in the
// body (also inside containers), ids and names are unique, the selection names items that exist, undo then redo of the
// whole history is the identity, and a paste pastes the last copy or cut, never an older one.
// FC_SEED=<n> replays a run (CI pins one; the nightly job takes a random one), FC_RUNS=<n> sets the number of runs.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import {
  secOf,
  addItem,
  insertSpot,
  copySelection,
  cutSelection,
  pasteItems,
  deleteSelection,
  moveItems,
  selectedBand,
  findItem,
  walk,
  sectionList,
  BODY_ONLY,
  isBodyKey,
  isContentKey,
  newDesignerStore,
  activateStore,
} from '../../src/designer/store.js';
import { validate } from '../../src/engine/schema/validate.js';
import { ITEMS } from '../../src/engine/items/index.js';

const SEED = process.env.FC_SEED ? Number(process.env.FC_SEED) : 20261019;
const RUNS = Number(process.env.FC_RUNS) || 150;
const CLIP = 'pagewright/items@1';
const BANDS = ['pageHeader', 'body', 'pageFooter'];
// item types a user inserts from the toolbox (a report part and a content placeholder come from elsewhere)
const TYPES = Object.keys(ITEMS).filter((t) => !['part', 'placeholder', 'overflow'].includes(t));
const PAGE_TYPES = TYPES.filter((t) => !BODY_ONLY.has(t));

let st;
const S = () => st.getState();

/* ---------------------------------------------------------------- random reports */
let seq = 0;
const leaf = (type, x, y) => ({
  ...ITEMS[type].defaults(),
  id: `g${++seq}`,
  name: `G${seq}`,
  x,
  y,
  ...(type === 'barcode' ? { value: `B${seq}` } : {}),
});
const itemArb = (types, depth) =>
  fc
    .record({
      type: fc.constantFrom(...types, ...(depth > 0 ? ['container', 'list'] : [])),
      x: fc.integer({ min: 0, max: 300 }),
      y: fc.integer({ min: 0, max: 200 }),
      kids: fc.array(fc.nat(), { maxLength: depth > 0 ? 3 : 0 }),
    })
    .chain(({ type, x, y, kids }) =>
      NEST.has(type) && depth > 0
        ? fc
            .array(itemArb(types, depth - 1), { minLength: kids.length, maxLength: kids.length })
            .map((items) => ({ ...leaf(type, x, y), w: 400, h: 220, items }))
        : fc.constant(leaf(type, x, y)),
    );
const NEST = new Set(['container', 'list']);
const leafTypes = (types) => types.filter((t) => !NEST.has(t));
const reportArb = fc
  .record({
    header: fc.array(itemArb(leafTypes(PAGE_TYPES), 1), { maxLength: 3 }),
    body: fc.array(itemArb(leafTypes(TYPES), 1), { minLength: 1, maxLength: 5 }),
    footer: fc.array(itemArb(leafTypes(PAGE_TYPES), 1), { maxLength: 2 }),
  })
  .map(({ header, body, footer }) => ({
    $schema: 'reportwright/report@1',
    name: 'Prop',
    page: { size: 'A4', margins: [36, 36, 36, 36] },
    dataSources: [{ name: 'src', type: 'json', data: { rows: [] } }],
    dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }],
    sections: {
      pageHeader: { height: 240, items: header },
      body: { height: 600, items: body },
      pageFooter: { height: 240, items: footer },
    },
  }));

/* ---------------------------------------------------------------- the system clipboard */
/** writes: 'fast' ends at once, 'slow' when a flush comes, 'fail' (blocked) when a flush comes */
const clipboard = { system: null, fate: 'fast', pending: [] };
const stubClipboard = () =>
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: (t) =>
        new Promise((resolve, reject) => {
          const end = () =>
            clipboard.fate === 'fail' || end.fate === 'fail'
              ? reject(new Error('blocked'))
              : ((clipboard.system = t), resolve());
          end.fate = clipboard.fate;
          if (clipboard.fate === 'fast') {
            clipboard.system = t;
            resolve();
          } else clipboard.pending.push(end);
        }),
    },
  });
const flush = async () => {
  const p = clipboard.pending.splice(0);
  for (const end of p) {
    const f = clipboard.fate;
    clipboard.fate = end.fate;
    end();
    clipboard.fate = f;
  }
  await new Promise((r) => setTimeout(r));
};

/* ---------------------------------------------------------------- what a user does */
const actionArb = fc.oneof(
  { arbitrary: fc.record({ k: fc.constant('insert'), type: fc.constantFrom(...TYPES) }), weight: 3 },
  {
    arbitrary: fc.record({ k: fc.constant('select'), pick: fc.array(fc.nat(), { minLength: 1, maxLength: 3 }) }),
    weight: 4,
  },
  { arbitrary: fc.record({ k: fc.constant('selectBand'), band: fc.constantFrom(...BANDS) }), weight: 1 },
  {
    arbitrary: fc.record({ k: fc.constantFrom('copy', 'cut'), write: fc.constantFrom('fast', 'slow', 'fail') }),
    weight: 3,
  },
  { arbitrary: fc.record({ k: fc.constant('paste') }), weight: 3 },
  { arbitrary: fc.record({ k: fc.constant('flush') }), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant('externalCopy') }), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant('delete') }), weight: 1 },
  {
    arbitrary: fc.record({
      k: fc.constant('drag'),
      band: fc.option(fc.constantFrom(...BANDS)),
      dx: fc.integer({ min: -60, max: 60 }),
      dy: fc.integer({ min: -60, max: 60 }),
    }),
    weight: 2,
  },
  { arbitrary: fc.record({ k: fc.constantFrom('undo', 'redo') }), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant('rename'), name: fc.stringMatching(/^[A-Za-z_]\w{0,6}$/) }), weight: 1 },
);

/** All items of the report, in order. */
const items = (def) => {
  const out = [];
  walk(def, (it) => out.push(it));
  return out;
};
/** What a copy is, without what a paste changes (ids, names, places). */
const content = (list) =>
  list.map((it) => ({
    type: it.type,
    value: it.value ?? null,
    items: Array.isArray(it.items) ? content(it.items) : null,
  }));
let ext = 0;

/** Run one action as the designer does; returns what the model expects of a paste afterwards. */
async function run(a, model) {
  const { def, sel } = S();
  const all = items(def);
  switch (a.k) {
    case 'insert': {
      const at = insertSpot(def, sel, a.type);
      addItem(a.type, at.section, 0, at.y, {}, at.parentId);
      break;
    }
    case 'select': {
      if (!all.length) break;
      // as the canvas lets a user: items of one band or container (a click, then shift+clicks beside it)
      const first = findItem(def, all[a.pick[0] % all.length].id);
      const sibs = first.list;
      const ids = [...new Set(a.pick.map((n) => sibs[n % sibs.length].id))];
      S().select({ kind: 'items', ids });
      break;
    }
    case 'selectBand':
      S().select({ kind: 'section', section: a.band });
      break;
    case 'copy':
    case 'cut': {
      if (sel.kind !== 'items') break;
      clipboard.fate = a.write;
      const copied = content(sel.ids.map((id) => findItem(def, id)?.item).filter(Boolean));
      const p = a.k === 'cut' ? cutSelection() : copySelection();
      model.expect = copied;
      model.refused = a.write === 'fail';
      if (a.write === 'fast') await p;
      else model.writes.push(p);
      break;
    }
    case 'flush':
      await flush();
      await Promise.all(model.writes.splice(0));
      break;
    case 'externalCopy': {
      // a copy in another tab: only while no write of this tab is still on its way (which one lands last is the
      // browser's), so what the system clipboard holds is the user's last copy
      // nor between a copy the clipboard refused and the next paste: the clipboard cannot be read, so whether the other
      // tab's copy came before or after the refused one is not known (the store takes the first paste's text as older)
      if (clipboard.pending.length || model.refused) break;
      const it = { id: `x${++ext}`, type: 'textbox', name: `Ext${ext}`, x: 0, y: 0, w: 80, h: 20, value: `ext ${ext}` };
      clipboard.system = JSON.stringify({ kind: CLIP, items: [it] });
      model.expect = content([it]);
      break;
    }
    case 'paste': {
      const before = items(S().def).length;
      const n = pasteItems(selectedBand(def, sel), clipboard.system);
      model.refused = false;
      expect(n).toBe(model.expect.length);
      const pasted = S().sel.ids.map((id) => findItem(S().def, id).item);
      expect(content(pasted), 'a paste pastes the last copy or cut').toEqual(model.expect);
      expect(items(S().def).length).toBeGreaterThan(before);
      break;
    }
    case 'delete':
      deleteSelection();
      break;
    case 'drag': {
      if (sel.kind !== 'items') break;
      const f = findItem(def, sel.ids[0]);
      const to =
        a.band && a.band !== f.section && !f.parent
          ? { section: a.band, ox: 0, oy: a.band === 'pageHeader' ? -300 : 300 }
          : null;
      moveItems(sel.ids, a.dx, a.dy, { to });
      break;
    }
    case 'undo':
      S().undo();
      break;
    case 'redo':
      S().redo();
      break;
    case 'rename': {
      // the inspector's rename: a valid name no other item has
      if (sel.kind !== 'items' || sel.ids.length !== 1) break;
      if (all.some((i) => i.id !== sel.ids[0] && i.name === a.name)) break;
      S().apply((d) => {
        findItem(d, sel.ids[0]).item.name = a.name;
      });
      break;
    }
  }
}

/** What must hold after every step. */
function invariants() {
  const { def, sel } = S();
  const v = validate(def);
  expect(v.errors, 'no validation errors').toEqual([]);
  const ids = new Set(),
    names = new Set();
  for (const s of sectionList(def)) {
    const inPage = !isBodyKey(s.key) && !isContentKey(s.key);
    const check = (it) => {
      expect(it.id, 'every item has an id').toBeTruthy();
      expect(ids.has(it.id), `id ${it.id} is unique`).toBe(false);
      ids.add(it.id);
      if (it.name) {
        expect(names.has(it.name), `name ${it.name} is unique`).toBe(false);
        names.add(it.name);
      }
      if (inPage) expect(BODY_ONLY.has(it.type), `no ${it.type} in ${s.key}`).toBe(false);
      for (const c of it.items || []) check(c);
    };
    for (const it of secOf(def, s.key)?.items || []) check(it);
  }
  if (sel.kind === 'items') for (const id of sel.ids) expect(ids.has(id), `selected ${id} exists`).toBe(true);
  if (sel.kind === 'cell') expect(ids.has(sel.id)).toBe(true);
  const dsNames = new Set(def.dataSets.map((d) => d.name));
  for (const it of items(def))
    if (it.dataSet) expect(dsNames.has(it.dataSet), `${it.name}: data set ${it.dataSet}`).toBe(true);
  // undo of the whole history, then redo of it all: the same report
  const now = JSON.stringify(def),
    n = S().past.length,
    m = S().future.length;
  const states = [now];
  for (let i = 0; i < n; i++) {
    S().undo();
    states.push(JSON.stringify(S().def));
  }
  for (let i = 0; i < n; i++) {
    S().redo();
    expect(JSON.stringify(S().def), `redo ${i + 1} of ${n}`).toBe(states[n - i - 1]);
  }
  expect(JSON.stringify(S().def), 'undo × n, redo × n').toBe(now);
  expect([S().past.length, S().future.length]).toEqual([n, m]);
  S().select(sel);
  S().fixSelection();
}

beforeEach(() => {
  st = newDesignerStore();
  activateStore(st);
  Object.assign(clipboard, { system: null, fate: 'fast', pending: [] });
  stubClipboard();
});
afterEach(() => vi.unstubAllGlobals());

/** A fresh designer (and an empty clipboard, in this tab and the system's) for each run. */
async function fresh(def) {
  await flush();
  st = newDesignerStore();
  activateStore(st);
  S().init('r', def);
  Object.assign(clipboard, { system: null, fate: 'fast', pending: [] });
  // the clipboard state is the store module's, across runs: start each run from a copy that reached the clipboard
  const first = def.sections.body.items[0];
  S().select({ kind: 'items', ids: [first.id] });
  await copySelection();
  S().select({ kind: 'report' });
  return content([first]);
}

describe('designer store properties', () => {
  it('every step keeps the invariants', async () => {
    await fc.assert(
      fc.asyncProperty(reportArb, fc.array(actionArb, { minLength: 1, maxLength: 30 }), async (def, actions) => {
        const model = { expect: await fresh(def), writes: [], refused: false };
        expect(validate(S().def).errors).toEqual([]);
        for (const a of actions) {
          await run(a, model);
          invariants();
        }
        await flush();
        await Promise.all(model.writes);
      }),
      { seed: SEED, numRuns: RUNS, endOnFailure: false },
    );
  }, 600000);
});
