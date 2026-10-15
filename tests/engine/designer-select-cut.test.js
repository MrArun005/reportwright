// Designer: select all (#6) and cut (#14).
import { describe, it, expect, beforeEach } from 'vitest';
import { selectAllItems, cutSelection, pasteItems, findItem } from '../../src/designer/store.js';
import { S, load } from './designer-bands.fixture.js';

beforeEach(load);

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
});
