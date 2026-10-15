// Designer: a drag moves an item to another band (#12).
import { describe, it, expect, beforeEach } from 'vitest';
import { moveItems, secOf } from '../../src/designer/store.js';
import { S, load, where } from './designer-bands.fixture.js';

beforeEach(load);

describe('#12: a drag moves an item to another band', () => {
  it('to the footer: y relative to the footer, one undo step', () => {
    // the footer starts 400 pt below the body's top on the canvas
    moveItems(['b'], 5, 404, { to: { section: 'pageFooter', ox: 0, oy: 400 } });
    expect(where('b')).toEqual({ section: 'pageFooter', parent: null, x: 15, y: 44 });
    expect(secOf(S().def, 'pageFooter').height).toBe(64);
    expect(S().def.sections.body.items.map((i) => i.id)).toEqual(['a', 'box']);
    S().undo();
    expect(where('b')).toEqual({ section: 'body', parent: null, x: 10, y: 40 });
  });
  it('a child of a container or a table into a page band: stays in its band', () => {
    moveItems(['kid'], 0, 10, { to: { section: 'pageFooter', ox: 0, oy: 400 } });
    expect(where('kid')).toMatchObject({ section: 'body', parent: 'box', y: 14 });
  });
  it('the same band: a plain move', () => {
    moveItems(['a'], 0, 10, { to: { section: 'body', ox: 0, oy: 0 } });
    expect(where('a')).toMatchObject({ section: 'body', y: 20 });
  });
});
