// "Toggle visibility of another item": a click flips the target's visibility (state.toggles['item:<name>']).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report, texts } from '../helpers.js';

const def = report([
  { type: 'textbox', name: 'Switch', x: 0, y: 0, w: 100, h: 16, value: 'Details', action: { type: 'toggleItem', target: 'More' } },
  { type: 'textbox', name: 'More', x: 0, y: 20, w: 100, h: 16, value: 'the details', hidden: true },
  { type: 'textbox', name: 'Shown', x: 0, y: 40, w: 100, h: 16, value: 'always' },
]);

describe('toggle another item', () => {
  it('starts as its own hidden says; the link flips it', async () => {
    const m = await render(def, { fontStore });
    expect(texts(m.pages[0])).not.toContain('the details');
    const link = m.pages[0].items.find(i => i.t === 'link');
    expect(link.action).toEqual({ type: 'toggle', key: 'item:More', open: false });
    const m2 = await render(def, { fontStore, state: { toggles: { [link.action.key]: !link.action.open } } });
    expect(texts(m2.pages[0])).toContain('the details');
    expect(m2.pages[0].items.find(i => i.t === 'link').action.open).toBe(true);
  });
});

describe('table bookmark', () => {
  it('a table\'s bookmark is in the document map, on the page where the table starts', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ n: i }));
    const m = await render(report([
      { type: 'textbox', name: 'Gap', x: 0, y: 0, w: 100, h: 16, value: 'x', pageBreakAfter: true },
      { type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 20, w: 100, h: 36, bookmark: '="Rows table"', columns: [{ width: 100 }], header: [{ height: 18, cells: [{ value: 'N' }] }], detail: [{ height: 18, cells: [{ value: '=Fields.n' }] }] },
    ], { data: { rows } }), { fontStore });
    expect(m.bookmarks).toEqual([expect.objectContaining({ label: 'Rows table', page: 2 })]);
  });
});
