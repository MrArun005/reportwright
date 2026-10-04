// The outline's drag and drop: moveItemTo reorders, moves into and out of containers and lists, by the canvas's rules.
import { describe, it, expect, beforeEach } from 'vitest';
import { useDesigner, moveItemTo, findItem } from '../../src/designer/store.js';

const S = () => useDesigner.getState();
const names = (list) => list.map(i => i.name);
beforeEach(() => S().init('x', {
  $schema: 'pagewright/report@1', name: 'x', page: { size: 'A4' },
  sections: {
    pageHeader: { height: 40, items: [{ id: 'h', type: 'textbox', name: 'H', x: 0, y: 0, w: 100, h: 20 }] },
    body: { height: 200, items: [
      { id: 'a', type: 'textbox', name: 'A', x: 10, y: 10, w: 100, h: 20 },
      { id: 'c', type: 'container', name: 'C', x: 50, y: 40, w: 200, h: 60, items: [{ id: 'k', type: 'textbox', name: 'K', x: 5, y: 5, w: 50, h: 20 }] },
      { id: 'l', type: 'list', name: 'L', x: 0, y: 120, w: 300, h: 40, items: [] },
      { id: 'w', type: 'textbox', name: 'Wide', x: 0, y: 170, w: 400, h: 20 },
    ] },
    pageFooter: { height: 0, items: [] },
  },
}));

describe('moveItemTo', () => {
  it('reorders in the same list (index counts the list before the move)', () => {
    expect(moveItemTo('a', null, 3)).toBe(true);
    expect(names(S().def.sections.body.items)).toEqual(['C', 'L', 'A', 'Wide']);
    moveItemTo('w', null, 0);
    expect(names(S().def.sections.body.items)).toEqual(['Wide', 'C', 'L', 'A']);
    expect(moveItemTo('c', null, 2)).toBe(false); // already there: no history entry
  });
  it('into a container: keeps its place on the page, relative to the container', () => {
    moveItemTo('a', 'c', 0);
    const f = findItem(S().def, 'a');
    expect(f.parent.id).toBe('c');
    expect(f.index).toBe(0);
    expect({ x: f.item.x, y: f.item.y }).toEqual({ x: 0, y: 0 }); // 10-50 clamps to 0; 10-40 to 0
  });
  it('a wider item is narrowed to its new parent, which grows to fit it', () => {
    moveItemTo('w', 'l', 0);
    const f = findItem(S().def, 'w');
    expect(f.item.w).toBe(300);
    expect(f.item.y).toBe(50);
    expect(f.parent.h).toBe(70);
  });
  it('out of a container to the band, at the given place, back on the page where it was', () => {
    moveItemTo('k', null, 1);
    const f = findItem(S().def, 'k');
    expect(f.parent).toBeNull();
    expect(names(f.list)).toEqual(['A', 'K', 'C', 'L', 'Wide']);
    expect({ x: f.item.x, y: f.item.y }).toEqual({ x: 55, y: 45 });
  });
  it('a container into a list, and nested items keep their page position through two levels', () => {
    moveItemTo('c', 'l', 0);
    moveItemTo('k', null, 0);
    expect({ x: findItem(S().def, 'k').item.x, y: findItem(S().def, 'k').item.y }).toEqual({ x: 55, y: 125 });
  });
  it('refuses: into itself or its own child, into a non-container, across bands, unknown ids', () => {
    moveItemTo('c', 'l', 0);
    expect(moveItemTo('l', 'c', 0)).toBe(false); // the list holds the container
    expect(moveItemTo('c', 'c', 0)).toBe(false);
    expect(moveItemTo('a', 'w', 0)).toBe(false);
    expect(moveItemTo('h', 'c', 0)).toBe(false);
    expect(moveItemTo('nope', null, 0)).toBe(false);
    expect(findItem(S().def, 'h').section).toBe('pageHeader');
  });
  it('one undo step per move', () => {
    moveItemTo('a', 'c', 0);
    S().undo();
    expect(findItem(S().def, 'a').parent).toBeNull();
  });
});
