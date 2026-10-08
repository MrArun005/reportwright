// N37 polish: repeated Ctrl+D (or paste) copies cascade, each 12 pt from the one before, never stacked on a copy.
import { describe, it, expect } from 'vitest';
import { newDesignerStore, activateStore, duplicateSelection, pasteItems } from '../../src/designer/store.js';

const report = (items) => ({ $schema: 'pagewright/report@1', name: 'R', page: { size: 'A4' }, dataSources: [], dataSets: [], sections: { body: { height: 300, items } } });
const tb = (name, x = 10, y = 10) => ({ type: 'textbox', name, x, y, w: 100, h: 20, value: 'x' });
let st;
const load = (def) => { st = newDesignerStore(); activateStore(st); st.getState().init('r', def); return st.getState().def; };
const items = () => st.getState().def.sections.body.items;
const offs = () => items().map(i => [i.x - 10, i.y - 10]);

describe('N37: repeated copies cascade', () => {
  it('Ctrl+D three times (the copy stays selected): +12, +24, +36', () => {
    load(report([tb('A')]));
    st.getState().select({ kind: 'items', ids: [items()[0].id] });
    for (let i = 0; i < 3; i++) duplicateSelection();
    expect(offs()).toEqual([[0, 0], [12, 12], [24, 24], [36, 36]]);
  });
  it('the original selected again each time: the copies still cascade, none on top of another', () => {
    load(report([tb('A')]));
    const a = items()[0].id;
    for (let i = 0; i < 3; i++) { st.getState().select({ kind: 'items', ids: [a] }); duplicateSelection(); }
    expect(offs()).toEqual([[0, 0], [12, 12], [24, 24], [36, 36]]);
  });
  it('pasting the same items again cascades too', () => {
    load(report([tb('A')]));
    const text = JSON.stringify({ kind: 'pagewright/items@1', items: [items()[0]] });
    pasteItems('body', text); pasteItems('body', text);
    expect(offs()).toEqual([[0, 0], [12, 12], [24, 24]]);
  });
});

describe('N37: pasted coordinates are not trusted', () => {
  it('x/y 1e309 (Infinity) or 2**60 (where += 12 changes nothing) on top of an item there: the paste returns at once', () => {
    for (const [raw, v] of [['1e309', Infinity], [String(2 ** 60), 2 ** 60]]) {
      load(report([{ ...tb('A'), x: v, y: v }, tb('B', 0, 0)]));
      const text = `{"kind":"pagewright/items@1","items":[{"type":"textbox","name":"A","x":${raw},"y":${raw},"w":100,"h":20,"value":"x"}]}`;
      const t0 = Date.now();
      expect(pasteItems('body', text)).toBe(1);
      expect(Date.now() - t0).toBeLessThan(1000);
      const c = items()[2];
      expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    }
  });
});
