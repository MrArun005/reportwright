// Designer: paste goes to the selected band and fits it (#12, #13).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pasteItems, copySelection, cutSelection, findItem, secOf, selectedBand } from '../../src/designer/store.js';
import { S, load, where } from './designer-bands.fixture.js';

beforeEach(load);

describe('#12/#13: paste goes to the selected band and fits it', () => {
  it('copied in the body, pasted into the footer: at the top of its free space, the footer keeps its height', async () => {
    S().select({ kind: 'items', ids: ['b'] });
    await copySelection();
    S().select({ kind: 'items', ids: ['f1'] });
    expect(pasteItems('pageFooter')).toBe(1);
    const id = S().sel.ids[0];
    expect(where(id).section).toBe('pageFooter');
    expect(secOf(S().def, 'pageFooter').height).toBe(24);
    expect(findItem(S().def, id).item.y).toBe(4); // 24 - 20: clamped so it fits
  });
  it('several items keep their places relative to each other', async () => {
    S().select({ kind: 'items', ids: ['a', 'b'] });
    await copySelection();
    S().apply((d) => {
      d.sections.pageFooter.height = 100;
    });
    pasteItems('pageFooter');
    const [p, q] = S().sel.ids.map((i) => findItem(S().def, i).item);
    expect([p.y, q.y]).toEqual([32, 62]); // below F1 (2 + 20 + 8), 30 apart as A and B
    expect(secOf(S().def, 'pageFooter').height).toBe(100);
  });
  it('an item taller than the band grows it to the item, no more', async () => {
    S().apply((d) => {
      d.sections.body.items[0].h = 60;
    });
    S().select({ kind: 'items', ids: ['a'] });
    await copySelection();
    pasteItems('pageFooter');
    expect(secOf(S().def, 'pageFooter').height).toBe(60);
  });
  it('the same band: 12 pt right and down, as before', async () => {
    S().select({ kind: 'items', ids: ['a'] });
    await copySelection();
    pasteItems('body');
    expect(findItem(S().def, S().sel.ids[0]).item).toMatchObject({ x: 22, y: 22 });
  });
});

describe('#12: the band a paste goes to', () => {
  it('the selected band, the band of the selected item, else the body', () => {
    expect(selectedBand(S().def, { kind: 'section', section: 'pageHeader' })).toBe('pageHeader');
    expect(selectedBand(S().def, { kind: 'items', ids: ['f1'] })).toBe('pageFooter');
    expect(selectedBand(S().def, { kind: 'items', ids: ['kid'] })).toBe('body');
    expect(selectedBand(S().def, { kind: 'report' })).toBe('body');
  });
});

describe('a table, matrix or subreport pasted into a page band goes to the body, as Insert does', () => {
  const clip = (item) => JSON.stringify({ kind: 'pagewright/items@1', items: [item] });
  for (const type of ['table', 'matrix', 'subreport']) {
    it(type, () => {
      expect(pasteItems('pageHeader', clip({ id: 'z', type, name: 'Z', x: 0, y: 0, w: 100, h: 20 }))).toBe(1);
      expect(where(S().sel.ids[0]).section).toBe('body');
    });
  }
  it('a text box still goes to the page band', () => {
    pasteItems('pageHeader', clip(S().def.sections.body.items[0]));
    expect(where(S().sel.ids[0]).section).toBe('pageHeader');
  });
});

describe('#14: cut keeps the in-memory copy at once', () => {
  it('a paste right after the cut, before the clipboard write ends, pastes the cut item', async () => {
    S().apply((d) => {
      d.sections.body.items[0].value = 'cut me';
    });
    vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise((r) => setTimeout(r)) } });
    S().select({ kind: 'items', ids: ['a'] });
    const done = cutSelection();
    expect(pasteItems('body')).toBe(1);
    expect(findItem(S().def, S().sel.ids[0]).item.value).toBe('cut me');
    await done;
    vi.unstubAllGlobals();
  });
});

describe('#14: a paste event that still brings an older copy of this tab pastes the newer in-memory copy', () => {
  /** A clipboard whose writes end when release() is called, or fail while `block`; `system` is what it holds. */
  const slowClipboard = () => {
    const cb = { system: null, block: false, release: () => {} };
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: (t) =>
          new Promise((resolve, reject) => {
            cb.release = () => (cb.block ? reject(new Error('blocked')) : ((cb.system = t), resolve()));
          }),
      },
    });
    return cb;
  };
  const valueOfPasted = () => findItem(S().def, S().sel.ids[0]).item.value;
  /** Copy A (its write ends), then cut B: @returns the cut's promise, its write not ended yet */
  const copyAThenCutB = async (cb) => {
    S().apply((d) => {
      d.sections.body.items[0].value = 'older';
      d.sections.body.items[1].value = 'just cut';
    });
    S().select({ kind: 'items', ids: ['a'] });
    const c = copySelection();
    cb.release();
    await c;
    S().select({ kind: 'items', ids: ['b'] });
    return { cut: cutSelection() };
  };
  afterEach(() => vi.unstubAllGlobals());
  it('the write has not ended: the cut item, not the clipboard text', async () => {
    const cb = slowClipboard();
    const { cut } = await copyAThenCutB(cb);
    expect(pasteItems('body', cb.system)).toBe(1); // cb.system: still the older copy, as the paste event's text
    expect(valueOfPasted()).toBe('just cut');
    cb.release();
    await cut;
  });
  it('the write failed: the cut item, not the older copy the clipboard kept', async () => {
    const cb = slowClipboard();
    const { cut } = await copyAThenCutB(cb);
    cb.block = true;
    cb.release();
    await cut;
    expect(pasteItems('body', cb.system)).toBe(1);
    expect(valueOfPasted()).toBe('just cut');
  });
  it('a copy made elsewhere after this one still pastes', async () => {
    const cb = slowClipboard();
    S().select({ kind: 'items', ids: ['a'] });
    const c = copySelection();
    cb.release();
    await c;
    const other = JSON.stringify({
      kind: 'pagewright/items@1',
      items: [{ id: 'o', type: 'textbox', name: 'O', x: 0, y: 0, w: 50, h: 20, value: 'other tab' }],
    });
    expect(pasteItems('body', other)).toBe(1);
    expect(valueOfPasted()).toBe('other tab');
  });
});
