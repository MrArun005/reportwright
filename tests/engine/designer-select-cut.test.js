// Designer: select all (#6) and cut (#14).
import { describe, it, expect, beforeEach } from 'vitest';
import { selectAllItems } from '../../src/designer/store.js';
import { S, load } from './designer-bands.fixture.js';

beforeEach(load);

describe('#6: select all', () => {
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
});
