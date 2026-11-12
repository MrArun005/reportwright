// Designer: select all (#6) and cut (#14).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { selectAllItems, cutSelection, copySelection, pasteItems, findItem } from '../../src/designer/store.js';
import { S, load } from './designer-bands.fixture.js';

beforeEach(load);
afterEach(() => vi.unstubAllGlobals());

describe('#6: select all, #14: cut', () => {
  it('the band of the selection, or the body', () => {
    S().select({ kind: 'report' });
    expect(selectAllItems()).toBe(3);
    expect(S().sel).toEqual({ kind: 'items', ids: ['a', 'b', 'box'] });
    S().select({ kind: 'items', ids: ['f1'] });
    selectAllItems();
    expect(S().sel).toEqual({ kind: 'items', ids: ['f1'] });
    S().select({ kind: 'section', section: 'pageHeader' });
    selectAllItems();
    expect(S().sel).toEqual({ kind: 'items', ids: ['h1'] });
  });
  it('cut: copied and deleted in one undo step; paste brings it back', () => {
    S().select({ kind: 'items', ids: ['a'] });
    const past = S().past.length;
    cutSelection();
    expect(findItem(S().def, 'a')).toBeNull();
    expect(S().past.length).toBe(past + 1);
    expect(pasteItems('body')).toBe(1);
  });
  it('cut and pasted back into its band: in its own place; pasted again: 12 pt on', () => {
    S().select({ kind: 'items', ids: ['b'] });
    cutSelection();
    pasteItems('body');
    expect(findItem(S().def, S().sel.ids[0]).item).toMatchObject({ x: 10, y: 40 });
    pasteItems('body');
    expect(findItem(S().def, S().sel.ids[0]).item).toMatchObject({ x: 22, y: 52 });
  });
  it('a paste before the clipboard refuses a copy: a newer copy from another tab is pasted afterwards', async () => {
    // the nightly property run of 2026-11-12 (FC_SEED=3171775530): the same item copied twice, the second write
    // refused only after a paste; the refusal then took the next paste's text for an older one
    const copy = () => (S().select({ kind: 'items', ids: ['a'] }), copySelection());
    let system = null,
      refuse = null;
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t) => void (system = t) } });
    await copy();
    vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise((_, reject) => (refuse = reject)) } });
    const refusedCopy = copy();
    expect(pasteItems('body', system)).toBe(1); // the write has not ended: the clipboard still holds the first copy
    refuse(new Error('blocked'));
    await refusedCopy;
    const other = { id: 'x1', type: 'textbox', name: 'Other', x: 0, y: 0, w: 80, h: 20, value: 'from another tab' };
    expect(pasteItems('body', JSON.stringify({ kind: 'pagewright/items@1', items: [other] }))).toBe(1);
    expect(findItem(S().def, S().sel.ids[0]).item.value).toBe('from another tab');
  });
});
