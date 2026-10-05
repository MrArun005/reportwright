// B2 item 5: Insert with a List, a Container (rectangle) selected drops the new item inside it.
import { describe, it, expect, beforeEach } from 'vitest';
import { useDesigner, insertSpot, addItem, findItem } from '../../src/designer/store.js';

const S = () => useDesigner.getState();
beforeEach(() => S().init('x', {
  $schema: 'pagewright/report@1', name: 'x', page: { size: 'A4' },
  sections: {
    pageHeader: { height: 40, items: [{ id: 'box', type: 'container', name: 'Box', x: 0, y: 0, w: 200, h: 30, items: [] }] },
    body: { height: 200, items: [
      { id: 'a', type: 'textbox', name: 'A', x: 10, y: 10, w: 100, h: 20 },
      { id: 'l', type: 'list', name: 'L', x: 0, y: 40, w: 300, h: 60, items: [{ id: 'in', type: 'textbox', name: 'In', x: 0, y: 4, w: 100, h: 20 }] },
    ] },
  },
}));

describe('insertSpot', () => {
  it('nothing or a plain item selected: the body, below the last item', () => {
    expect(insertSpot(S().def, { kind: 'report' })).toEqual({ section: 'body', parentId: null, y: 108 });
    expect(insertSpot(S().def, { kind: 'items', ids: ['a'] })).toEqual({ section: 'body', parentId: null, y: 108 });
  });
  it('a list selected: inside it, below its items', () => {
    expect(insertSpot(S().def, { kind: 'items', ids: ['l'] })).toEqual({ section: 'body', parentId: 'l', y: 32 });
  });
  it('an empty container in the page header: inside it, at its top, in that section', () => {
    const at = insertSpot(S().def, { kind: 'items', ids: ['box'] });
    expect(at).toEqual({ section: 'pageHeader', parentId: 'box', y: 0 });
    const id = addItem('textbox', at.section, 0, at.y, {}, at.parentId);
    expect(findItem(S().def, id).parent?.id).toBe('box');
  });
});
