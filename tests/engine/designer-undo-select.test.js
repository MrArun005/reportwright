// Designer: undo and redo select what they changed (#25).
import { describe, it, expect, beforeEach } from 'vitest';
import { addItem, moveItems, cutSelection } from '../../src/designer/store.js';
import { S, load } from './designer-bands.fixture.js';

beforeEach(load);

describe('#25: undo and redo select what they changed', () => {
  it('redo of an insert selects the item; undo of a delete selects the restored items', () => {
    const id = addItem('textbox', 'body', 0, 100);
    S().undo();
    expect(S().sel).toEqual({ kind: 'report' });
    S().redo();
    expect(S().sel).toEqual({ kind: 'items', ids: [id] });
    S().select({ kind: 'items', ids: ['a', 'b'] });
    cutSelection();
    expect(S().sel).toEqual({ kind: 'report' });
    S().undo();
    expect(S().sel).toEqual({ kind: 'items', ids: ['a', 'b'] });
  });
  it('undo of a move selects the moved item', () => {
    S().select({ kind: 'items', ids: ['a'] });
    moveItems(['a'], 4, 4);
    S().select({ kind: 'report' });
    S().undo();
    expect(S().sel).toEqual({ kind: 'items', ids: ['a'] });
  });
});
