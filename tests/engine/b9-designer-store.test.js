// b9 designer tickets: store logic (N33 sizes, N37 duplicate offset, N38 stable ids, bug 3 band growth, bug 6 matrix
// percentage format, N36 paste from the paste event's text).
import { describe, it, expect, beforeEach } from 'vitest';
import { newDesignerStore, activateStore, normalize, updateItem, addItem, duplicateSelection, tableAddGroup, setMatrixShow, pasteItems, copySelection, findItem, secOf } from '../../src/designer/store.js';

const report = (body, extra = {}) => ({ $schema: 'pagewright/report@1', name: 'R', page: { size: 'A4' }, dataSources: [], dataSets: [], sections: { body }, ...extra });
const tb = (name, x = 10, y = 10) => ({ type: 'textbox', name, x, y, w: 100, h: 20, value: 'x' });
let st;
const load = (def) => { st = newDesignerStore(); activateStore(st); st.getState().init('r', def); return st.getState().def; };

describe('N38: opening a report gives the same ids every time', () => {
  const src = () => report({ height: 200, items: [tb('A'), { type: 'container', name: 'Box', x: 0, y: 40, w: 200, h: 80, items: [tb('Kid', 0, 0)] }, { type: 'textbox', x: 0, y: 140, w: 50, h: 10 }] });
  it('the same input, the same normalised output (no random ids)', () => {
    expect(JSON.stringify(normalize(src()))).toBe(JSON.stringify(normalize(src())));
  });
  it('normalising again changes nothing; ids given in the file are kept; ids are unique', () => {
    const once = normalize(src());
    expect(normalize(once)).toEqual(once);
    const kept = normalize(report({ height: 100, items: [{ ...tb('A'), id: 'mine' }] }));
    expect(kept.sections.body.items[0].id).toBe('mine');
    const ids = []; const go = (l) => l.forEach(i => { ids.push(i.id); go(i.items || []); }); go(once.sections.body.items);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('N33: no 0-size items', () => {
  beforeEach(() => load(report({ height: 200, items: [tb('A'), { type: 'line', name: 'L', x: 0, y: 50, w: 100, h: 0 }] })));
  const id = (n) => st.getState().def.sections.body.items.find(i => i.name === n).id;
  it('width or height 0 becomes 1', () => {
    updateItem(id('A'), it => { it.w = 0; it.h = -3; });
    const a = findItem(st.getState().def, id('A')).item;
    expect([a.w, a.h]).toEqual([1, 1]);
  });
  it('a line may be 0 one way, not both', () => {
    updateItem(id('L'), it => { it.w = 0; });
    const l = findItem(st.getState().def, id('L')).item;
    expect(l.w + l.h).toBeGreaterThan(0);
    updateItem(id('L'), it => { it.w = 100; it.h = 0; });
    expect(findItem(st.getState().def, id('L')).item.h).toBe(0);
  });
});

describe('N37: Ctrl+D puts the copy where a paste would', () => {
  it('offset 12, not on top of the original', () => {
    load(report({ height: 200, items: [tb('A')] }));
    const a = st.getState().def.sections.body.items[0];
    st.getState().select({ kind: 'items', ids: [a.id] });
    duplicateSelection();
    const c = st.getState().def.sections.body.items[1];
    expect([c.x - a.x, c.y - a.y]).toEqual([12, 12]);
  });
});

describe('bug 3: the band grows with its items', () => {
  it('Add group makes the table taller: the body grows to fit it', () => {
    const t = { type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 36, dataSet: 'D', columns: [{ width: 100 }, { width: 100 }],
      header: [{ height: 18, cells: [{ value: 'A' }, { value: 'B' }] }], detail: [{ height: 18, cells: [{ value: '=Fields.a' }, { value: '=Fields.b' }] }] };
    load(report({ height: 40, items: [t] }));
    const id = st.getState().def.sections.body.items[0].id;
    tableAddGroup(id, 'a');
    const d = st.getState().def;
    const it = findItem(d, id).item;
    expect(it.h).toBeGreaterThan(40);
    expect(d.sections.body.height).toBeGreaterThanOrEqual(it.y + it.h);
  });
  it('a drop into a 0 pt (or unset) band grows it', () => {
    load(report({ height: 200, items: [] }, {}));
    st.getState().apply(d => { d.sections.pageHeader = { items: [] }; d.sections.pageFooter.height = 0; });
    addItem('textbox', 'pageHeader', 0, 0);
    addItem('textbox', 'pageFooter', 0, 0);
    const d = st.getState().def;
    expect(d.sections.pageHeader.height).toBeGreaterThan(0);
    expect(d.sections.pageFooter.height).toBeGreaterThan(0);
  });
});

describe('bug 6: a matrix value shown as a percentage gets P1', () => {
  it('only while the format is still the default', () => {
    const v = { value: '=Sum(Fields.x)', format: 'N0' };
    setMatrixShow(v, 'percentOfRow'); expect(v).toMatchObject({ show: 'percentOfRow', format: 'P1' });
    setMatrixShow(v, 'value'); expect(v.show).toBeUndefined(); expect(v.format).toBe('N0');
    const mine = { format: 'C2' }; setMatrixShow(mine, 'percentOfTotal'); expect(mine.format).toBe('C2');
    const none = {}; setMatrixShow(none, 'percentOfColumn'); expect(none.format).toBe('P1');
  });
});

describe('N36: paste without the clipboard-read permission', () => {
  it('pastes the paste event text; else the copy made in this tab; else nothing (0: the designer says so)', async () => {
    load(report({ height: 200, items: [tb('A')] }));
    const n0 = st.getState().def.sections.body.items.length;
    const text = JSON.stringify({ kind: 'pagewright/items@1', items: [tb('Z', 0, 0)] });
    expect(pasteItems('body', text)).toBe(1);
    expect(secOf(st.getState().def, 'body').items.length).toBe(n0 + 1);
    expect(pasteItems('body', 'plain text, no items')).toBe(0); // nothing copied in this tab yet
    st.getState().select({ kind: 'items', ids: [st.getState().def.sections.body.items[0].id] });
    await copySelection(); // navigator.clipboard is missing here: the in-memory copy stays
    expect(pasteItems('body', 'plain text')).toBe(1);
  });
});
