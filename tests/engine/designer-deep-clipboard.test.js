// Designer clipboard, store level: copy, cut, paste and duplicate of every item type, into every band.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ITEMS } from '../../src/engine/items/index.js';
import {
  newDesignerStore,
  activateStore,
  findItem,
  secOf,
  walk,
  selectedBand,
  BODY_ONLY,
  isBodyKey,
  copySelection,
  cutSelection,
  pasteItems,
  duplicateSelection,
} from '../../src/designer/store.js';

const CLIP_KIND = 'pagewright/items@1';
const TYPES = Object.keys(ITEMS);
const BANDS = ['pageHeader', 'body', 'pageFooter', 'body:1'];
const OFFSET = 12; // the paste and duplicate step (store.js PASTE_OFFSET)

/** One item of a type, with its defaults. */
const make = (type, id, x = 10, y = 10, more = {}) => ({
  ...ITEMS[type].defaults(),
  id,
  name: `${type}_${id}`,
  x,
  y,
  ...more,
});
const tb = (id, x, y, more = {}) => make('textbox', id, x, y, { value: id, ...more });
/** A report with two body sections and roomy page bands. */
const report = (bands = {}) => ({
  $schema: 'reportwright/report@1',
  name: 'R',
  page: { size: 'A4' },
  dataSources: [],
  dataSets: [],
  sections: {
    pageHeader: { height: 120, items: bands.pageHeader || [] },
    body: [
      { name: 'Section1', height: 400, items: bands.body || [] },
      { name: 'Section2', height: 400, items: bands['body:1'] || [] },
    ],
    pageFooter: { height: 120, items: bands.pageFooter || [] },
  },
});

let st;
const S = () => st.getState();
const load = (def) => {
  st = newDesignerStore();
  activateStore(st);
  S().init('r', def);
};
const json = () => JSON.stringify(S().def);
const pasted = () => S().sel.ids.map((id) => findItem(S().def, id));
const strip = ({ id, name, x, y, items, ...rest }) => rest; // what a copy keeps as it was
/** The text a copy put on the system clipboard (navigator.clipboard stubbed). */
let clipText = null;
beforeEach(() => {
  clipText = null;
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: async (t) => {
        clipText = t;
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('copy and paste every item type into every band', () => {
  for (const type of TYPES) {
    for (const band of BANDS) {
      it(`${type} → ${band}`, async () => {
        load(report({ body: [make(type, 'src', 10, 10)] }));
        S().select({ kind: 'items', ids: ['src'] });
        expect(await copySelection()).toBe(1);
        const before = findItem(S().def, 'src').item;
        expect(pasteItems(band)).toBe(1);
        const [f] = pasted();
        const goesTo = BODY_ONLY.has(type) && !isBodyKey(band) ? 'body' : band;
        expect(f.section).toBe(goesTo);
        expect(f.item.type).toBe(type);
        expect(f.item.id).not.toBe('src');
        expect(f.item.name).not.toBe(before.name);
        expect(strip(f.item)).toEqual(strip(before));
        // the original is untouched
        expect(findItem(S().def, 'src').item).toBe(before);
        // it fits its band: the band grew to it when needed
        expect(f.item.y + f.item.h).toBeLessThanOrEqual(secOf(S().def, goesTo).height);
        // one undo step takes it away again
        S().undo();
        expect(findItem(S().def, f.item.id)).toBeNull();
      });
    }
  }
});

describe('duplicate every item type, in every band', () => {
  for (const type of TYPES) {
    for (const band of BANDS) {
      if (BODY_ONLY.has(type) && !isBodyKey(band)) continue;
      it(`${type} in ${band}`, () => {
        load(report({ [band]: [make(type, 'src', 10, 10)] }));
        S().select({ kind: 'items', ids: ['src'] });
        duplicateSelection();
        const [f] = pasted();
        expect(f.section).toBe(band);
        expect([f.item.x, f.item.y]).toEqual([10 + OFFSET, 10 + OFFSET]);
        expect(strip(f.item)).toEqual(strip(findItem(S().def, 'src').item));
        S().undo();
        expect(secOf(S().def, band).items.map((i) => i.id)).toEqual(['src']);
      });
    }
  }
});

describe('cut and paste every item type: back at the same place', () => {
  for (const type of TYPES) {
    it(type, async () => {
      load(report({ body: [make(type, 'src', 30, 40)] }));
      const before = findItem(S().def, 'src').item;
      S().select({ kind: 'items', ids: ['src'] });
      await cutSelection();
      expect(findItem(S().def, 'src')).toBeNull();
      expect(pasteItems(selectedBand(S().def, S().sel))).toBe(1);
      const [f] = pasted();
      expect(f.section).toBe('body');
      expect([f.item.x, f.item.y]).toEqual([30, 40]);
      expect(strip(f.item)).toEqual(strip(before));
    });
  }
});

describe('multi-selection', () => {
  it('copy of three items pastes three, in one undo step, with unique names and ids', async () => {
    load(report({ body: [tb('a', 0, 0), tb('b', 200, 0), make('shape', 'c', 0, 100)] }));
    S().select({ kind: 'items', ids: ['a', 'b', 'c'] });
    expect(await copySelection()).toBe(3);
    const before = json();
    expect(pasteItems('body')).toBe(3);
    const fs = pasted();
    expect(fs.map((f) => f.item.type)).toEqual(['textbox', 'textbox', 'shape']);
    const names = new Set();
    let dup = false;
    walk(S().def, (it) => {
      if (names.has(it.name)) dup = true;
      names.add(it.name);
    });
    expect(dup).toBe(false);
    expect(new Set(fs.map((f) => f.item.id)).size).toBe(3);
    S().undo();
    expect(json()).toBe(before);
  });
  it('items of two bands (header + body) pasted into the footer keep their places relative to each other', async () => {
    load(report({ pageHeader: [tb('h', 0, 4)], body: [tb('a', 0, 30)] }));
    S().select({ kind: 'items', ids: ['h', 'a'] });
    await copySelection();
    expect(pasteItems('pageFooter')).toBe(2);
    const [p, q] = pasted();
    expect(p.section).toBe('pageFooter');
    expect(q.section).toBe('pageFooter');
    expect(q.item.y - p.item.y).toBe(26);
  });
  it('duplicate of several items: each copy next to its original, one undo step', () => {
    load(report({ body: [tb('a', 0, 0), tb('b', 200, 100)], pageFooter: [tb('f', 0, 0)] }));
    const before = json();
    S().select({ kind: 'items', ids: ['a', 'b', 'f'] });
    duplicateSelection();
    const fs = pasted();
    expect(fs.map((f) => [f.section, f.item.x, f.item.y])).toEqual([
      ['body', 12, 12],
      ['body', 212, 112],
      ['pageFooter', 12, 12],
    ]);
    S().undo();
    expect(json()).toBe(before);
  });
});

describe('nested container children', () => {
  const nested = () =>
    report({
      body: [
        {
          ...make('container', 'box', 0, 100),
          items: [
            tb('kid', 4, 4),
            { ...make('container', 'inner', 4, 30, { w: 200, h: 30 }), items: [tb('deep', 2, 2)] },
          ],
        },
      ],
    });
  it('a container copied with its children: every child gets a new id and a unique name', async () => {
    load(nested());
    S().select({ kind: 'items', ids: ['box'] });
    await copySelection();
    pasteItems('body');
    const [f] = pasted();
    const ids = [],
      names = [];
    walk({ sections: { body: { items: [f.item] } } }, (it) => {
      ids.push(it.id);
      names.push(it.name);
    });
    expect(ids).toHaveLength(4);
    for (const id of ids) expect(['box', 'kid', 'inner', 'deep']).not.toContain(id);
    const all = [];
    walk(S().def, (it) => all.push(it.name));
    expect(new Set(all).size).toBe(all.length);
    expect(f.item.items[1].items[0].type).toBe('textbox');
  });
  it('a child copied out of its container pastes into the band', async () => {
    load(nested());
    S().select({ kind: 'items', ids: ['deep'] });
    await copySelection();
    expect(pasteItems(selectedBand(S().def, S().sel))).toBe(1);
    const [f] = pasted();
    expect(f.section).toBe('body');
    expect(f.parent).toBeNull();
  });
  it('duplicate of a child stays in its container, 12 pt on', () => {
    load(nested());
    S().select({ kind: 'items', ids: ['kid'] });
    duplicateSelection();
    const [f] = pasted();
    expect(f.parent.id).toBe('box');
    expect([f.item.x, f.item.y]).toEqual([16, 16]);
  });
  it('regression: a child cut out of its container and pasted right away goes back into its container', async () => {
    load(nested());
    S().select({ kind: 'items', ids: ['kid'] });
    await cutSelection();
    pasteItems(selectedBand(S().def, S().sel));
    const [f] = pasted();
    // pasteItems only ever adds to the band's top-level list: the child lands in the body at its container-relative
    // x/y (4, 4), i.e. ~100 pt above where it was on the page, outside the container
    expect(f.parent?.id).toBe('box');
  });
});

describe('paste offset cascade', () => {
  it('repeated pastes go 12 pt further each time', async () => {
    load(report({ body: [tb('a', 10, 10)] }));
    S().select({ kind: 'items', ids: ['a'] });
    await copySelection();
    const at = [];
    for (let i = 0; i < 5; i++) {
      pasteItems('body');
      at.push([pasted()[0].item.x, pasted()[0].item.y]);
    }
    expect(at).toEqual([
      [22, 22],
      [34, 34],
      [46, 46],
      [58, 58],
      [70, 70],
    ]);
  });
  it('repeated duplicates of the original cascade too', () => {
    load(report({ body: [tb('a', 10, 10)] }));
    const at = [];
    for (let i = 0; i < 3; i++) {
      S().select({ kind: 'items', ids: ['a'] });
      duplicateSelection();
      at.push(pasted()[0].item.x);
    }
    expect(at).toEqual([22, 34, 46]);
  });
  it('a paste into another band starts at the top of its free space, then cascades there', async () => {
    load(report({ body: [tb('a', 10, 200)], pageHeader: [tb('h', 0, 0)] }));
    S().select({ kind: 'items', ids: ['a'] });
    await copySelection();
    pasteItems('pageHeader');
    const first = pasted()[0].item;
    expect(first.y).toBe(28); // below H (0 + 20 + 8)
    expect(first.y + first.h).toBeLessThanOrEqual(secOf(S().def, 'pageHeader').height);
  });
});

describe('cut and paste', () => {
  it('cut + paste are two undo steps: undo removes the paste, undo again restores the original (same id)', async () => {
    load(report({ body: [tb('a', 10, 10), tb('b', 10, 60)] }));
    const start = json();
    S().select({ kind: 'items', ids: ['a'] });
    await cutSelection();
    const afterCut = json();
    pasteItems('body');
    S().undo();
    expect(json()).toBe(afterCut);
    S().undo();
    expect(json()).toBe(start);
    S().redo();
    S().redo();
    expect(pasted()).toHaveLength(1);
    expect(pasted()[0].item.value).toBe('a');
  });
  it('a second paste after cut + paste cascades from the first', async () => {
    load(report({ body: [tb('a', 10, 10)] }));
    S().select({ kind: 'items', ids: ['a'] });
    await cutSelection();
    pasteItems('body');
    pasteItems('body');
    expect([pasted()[0].item.x, pasted()[0].item.y]).toEqual([22, 22]);
  });
  it('regression: a page-header item cut and pasted right away goes back into the page header', async () => {
    load(report({ pageHeader: [tb('h', 40, 4)] }));
    S().select({ kind: 'items', ids: ['h'] });
    await cutSelection();
    // Designer.jsx onPaste: pasteItems(selectedBand(def, sel)); cut left the selection at { kind: 'report' } → 'body'
    pasteItems(selectedBand(S().def, S().sel));
    const [f] = pasted();
    expect(f.section).toBe('pageHeader');
    expect([f.item.x, f.item.y]).toEqual([40, 4]);
  });
  it('a second-section item cut and pasted with that section selected goes back to the same place', async () => {
    load(report({ 'body:1': [tb('s', 40, 50)] }));
    S().select({ kind: 'items', ids: ['s'] });
    await cutSelection();
    S().select({ kind: 'section', section: 'body:1' });
    pasteItems(selectedBand(S().def, S().sel));
    const [f] = pasted();
    expect([f.section, f.item.x, f.item.y]).toEqual(['body:1', 40, 50]);
  });
});

describe('paste across two designers (the JSON travels as text)', () => {
  it('copied in designer A, pasted into designer B from the clipboard text', async () => {
    load(report({ body: [make('chart', 'c', 10, 10), tb('t', 10, 200)] }));
    S().select({ kind: 'items', ids: ['c', 't'] });
    await copySelection();
    const fromA = clipText;
    expect(JSON.parse(fromA).kind).toBe(CLIP_KIND);
    const a = st;
    load(report({ body: [tb('other', 0, 0)] }));
    expect(st).not.toBe(a);
    expect(pasteItems('body', fromA)).toBe(2);
    expect(pasted().map((f) => f.item.type)).toEqual(['chart', 'textbox']);
    // designer A is unchanged
    expect(a.getState().def.sections.body[0].items).toHaveLength(2);
  });
  it('names taken in B are renamed', async () => {
    load(report({ body: [tb('t', 10, 10)] }));
    S().select({ kind: 'items', ids: ['t'] });
    await copySelection();
    const text = clipText;
    load(report({ body: [tb('t', 10, 10)] })); // same name textbox_t exists in B
    pasteItems('body', text);
    expect(pasted()[0].item.name).not.toBe('textbox_t');
  });
});

describe('paste of external text', () => {
  beforeEach(() => load(report({ body: [tb('a', 10, 10)] })));
  // a fresh designer: nothing copied in it yet
  const fresh = () => {
    load(report({ body: [tb('a', 10, 10)] }));
  };
  const clip = (items, more = {}) => JSON.stringify({ kind: CLIP_KIND, items, ...more });
  it('plain text: nothing to paste (fresh tab)', async () => {
    // a fresh module state cannot be had per test: clear the in-memory copy by importing a new module copy
    vi.resetModules();
    const m = await import('../../src/designer/store.js');
    const s2 = m.newDesignerStore();
    m.activateStore(s2);
    s2.getState().init('r', report());
    expect(m.pasteItems('body', 'hello world')).toBe(0);
    expect(m.pasteItems('body', '')).toBe(0);
    expect(m.pasteItems('body', null)).toBe(0);
    expect(m.pasteItems('body', '{"kind":"other","items":[]}')).toBe(0);
    expect(m.pasteItems('body', '{not json')).toBe(0);
    expect(m.pasteItems('body', JSON.stringify({ kind: CLIP_KIND, items: 'nope' }))).toBe(0);
    expect(s2.getState().past).toHaveLength(0);
  });
  it('regression: plain text pasted after an earlier copy (whose clipboard write succeeded) is not the earlier copy', async () => {
    fresh();
    S().select({ kind: 'items', ids: ['a'] });
    await copySelection(); // the system clipboard took it (sysClip === memClip)
    // the user then copies "hello" in another app and pastes: the paste event brings "hello"
    expect(pasteItems('body', 'hello')).toBe(0);
  });
  it('valid item JSON from elsewhere pastes', () => {
    expect(
      pasteItems('body', clip([{ id: 'x', type: 'shape', name: 'S', x: 5, y: 5, w: 30, h: 30, shape: 'ellipse' }])),
    ).toBe(1);
    expect(pasted()[0].item).toMatchObject({ type: 'shape', shape: 'ellipse', w: 30, h: 30 });
  });
  it('an empty items list pastes nothing and adds no undo step', () => {
    const n = S().past.length;
    expect(pasteItems('body', clip([]))).toBe(0);
    expect(S().past.length).toBe(n);
  });
  it('1e309 and other non-finite coordinates start at 0', () => {
    const text = `{"kind":"${CLIP_KIND}","items":[{"type":"textbox","name":"T","x":1e309,"y":-1e309,"w":50,"h":20}]}`;
    expect(pasteItems('body', text)).toBe(1);
    const it0 = pasted()[0].item;
    expect(Number.isFinite(it0.x) && Number.isFinite(it0.y)).toBe(true);
    for (const b of S().def.sections.body) expect(Number.isFinite(b.height)).toBe(true);
  });
  it('a huge w or h (1e309) leaves the band height finite', () => {
    const text = `{"kind":"${CLIP_KIND}","items":[{"type":"textbox","name":"T","x":0,"y":0,"w":50,"h":1e309}]}`;
    pasteItems('body', text);
    expect(Number.isFinite(S().def.sections.body[0].height)).toBe(true);
  });
  it('strings for coordinates are not concatenated ("10" + 12)', () => {
    pasteItems('body', clip([{ type: 'textbox', name: 'T', x: '10', y: '10', w: 50, h: 20 }]));
    const it0 = pasted()[0].item;
    expect(typeof it0.x).toBe('number');
    expect(typeof it0.y).toBe('number');
  });
  it('regression: negative pasted coordinates are clamped into the band (x, y >= 0)', () => {
    pasteItems('body', clip([{ type: 'textbox', name: 'T', x: -400, y: -400, w: 50, h: 20 }]));
    const it0 = pasted()[0].item;
    // offsetCopy only replaces non-finite numbers: -400 + 12 = -388, the item sits above and left of the band
    expect([it0.x >= 0, it0.y >= 0]).toEqual([true, true]);
  });
  it('__proto__ and constructor keys pollute nothing', () => {
    const text = `{"kind":"${CLIP_KIND}","__proto__":{"evil":1},"items":[{"type":"textbox","name":"T","x":0,"y":0,"w":50,"h":20,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}},"style":{"__proto__":{"polluted3":true}}}]}`;
    pasteItems('body', text);
    expect({}.polluted).toBeUndefined();
    expect({}.polluted2).toBeUndefined();
    expect({}.polluted3).toBeUndefined();
    expect({}.evil).toBeUndefined();
    expect(Object.prototype.hasOwnProperty('polluted')).toBe(false);
  });
  it('an unknown type pastes without throwing', () => {
    expect(() => pasteItems('body', clip([{ type: 'nosuchtype', name: 'Q', x: 0, y: 0, w: 10, h: 10 }]))).not.toThrow();
  });
  it('an item with no type and no name pastes without throwing', () => {
    expect(() => pasteItems('body', clip([{ x: 0, y: 0, w: 10, h: 10 }]))).not.toThrow();
  });
  it('script in values is kept as text (it is data)', () => {
    const evil = '<img src=x onerror="globalThis.__pwned=1"><script>globalThis.__pwned=2</script>';
    pasteItems(
      'body',
      clip([
        { type: 'textbox', name: 'T', x: 0, y: 0, w: 50, h: 20, value: evil },
        { type: 'richtext', name: 'R', x: 0, y: 40, w: 50, h: 20, value: evil },
      ]),
    );
    expect(pasted().map((f) => f.item.value)).toEqual([evil, evil]);
    expect(globalThis.__pwned).toBeUndefined();
  });
  const nest = (depth) => {
    let node = { type: 'textbox', name: 'Leaf', x: 0, y: 0, w: 10, h: 10 };
    for (let i = 0; i < depth; i++) node = { type: 'container', name: 'C', x: 0, y: 0, w: 100, h: 100, items: [node] };
    return node;
  };
  it('deeply nested items (200 levels) paste with unique ids', () => {
    expect(pasteItems('body', clip([nest(200)]))).toBe(1);
    const ids = new Set();
    let n = 0;
    walk(S().def, (it) => {
      ids.add(it.id);
      n++;
    });
    expect(ids.size).toBe(n);
  });
  it('regression: items nested 5000 levels deep do not throw on paste (refused or pasted)', () => {
    // immer's finalize recurses once per level: RangeError (Maximum call stack size exceeded) out of pasteItems
    // built as text: JSON.stringify of a 5000-level object overflows the test worker's own stack
    const open = '{"type":"container","name":"C","x":0,"y":0,"w":100,"h":100,"items":['.repeat(5000);
    const text = `{"kind":"${CLIP_KIND}","items":[${open}{"type":"textbox","name":"Leaf","x":0,"y":0,"w":10,"h":10}${']}'.repeat(5000)}]}`;
    expect(() => pasteItems('body', text)).not.toThrow();
  });
  it('regression: 10 000 items paste in one undo step within 10 s', () => {
    const items = Array.from({ length: 10000 }, (_, i) => ({
      type: 'textbox',
      name: `T${i}`,
      x: (i % 40) * 10,
      y: Math.floor(i / 40) * 20,
      w: 10,
      h: 20,
      value: String(i),
    }));
    const n = S().past.length;
    const t0 = Date.now();
    expect(pasteItems('body', clip(items, { from: 'body' }))).toBe(10000);
    const ms = Date.now() - t0;
    expect(S().past.length).toBe(n + 1);
    const names = new Set();
    walk(S().def, (it) => names.add(it.name));
    expect(names.size).toBe(10001);
    // offsetCopy scans the band once per step and uniqueName counts up from 1 per name: quadratic, ~40 s here
    expect(ms).toBeLessThan(10000);
  }, 120000);
});

describe('body-only types (table, matrix, subreport) pasted into a page band go to the body', () => {
  const clip = (items) => JSON.stringify({ kind: CLIP_KIND, items });
  for (const type of BODY_ONLY) {
    for (const band of ['pageHeader', 'pageFooter']) {
      it(`${type} → ${band}`, () => {
        load(report());
        pasteItems(band, clip([make(type, 'z', 0, 0)]));
        expect(pasted()[0].section).toBe('body');
      });
      it(`${type} with a text box → ${band}: both go to the body (one paste)`, () => {
        load(report());
        pasteItems(band, clip([make(type, 'z', 0, 0), tb('t', 0, 80)]));
        expect(pasted().map((f) => f.section)).toEqual(['body', 'body']);
      });
      for (const wrap of ['container', 'list']) {
        it(`regression: ${type} inside a ${wrap} → ${band} goes to the body`, () => {
          load(report());
          pasteItems(band, clip([{ ...make(wrap, 'w', 0, 0, { h: 80 }), items: [make(type, 'z', 0, 0)] }]));
          expect(pasted()[0].section).toBe('body');
        });
      }
    }
  }
});
