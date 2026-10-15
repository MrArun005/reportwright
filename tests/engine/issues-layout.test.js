// The layout checker (src/designer/issues.js): overlaps across containers (#1a), the body against the page height (#30),
// a landscape section that uses the shared page header and footer (#16).
import { describe, it, expect } from 'vitest';
import { designIssues } from '../../src/designer/issues.js';

const tb = (id, x, y, w = 100, h = 20) => ({ id, name: id, type: 'textbox', x, y, w, h, value: 'x' });
const box = (id, x, y, w, h, items = []) => ({ id, name: id, type: 'container', x, y, w, h, items });
const kinds = (is) => is.filter((i) => i.kind !== 'field').map((i) => [i.kind, i.name, i.other ?? null]);
const A4 = { size: 'A4', margins: [36, 36, 36, 36] }; // 770 pt for the body, 523 wide
const one = (items, extra = {}) => ({
  page: A4,
  sections: {
    pageHeader: { height: 30, items: [] },
    body: { height: 400, items },
    pageFooter: { height: 40, items: [] },
  },
  ...extra,
});
const check = (def) =>
  designIssues(def, [{ key: 'body', items: def.sections.body.items || def.sections.body[0].items, width: 523 }]);

describe('overlaps across containers (#1a)', () => {
  it('a container that grew over a top-level item: the item lies on it but is not in it', () => {
    const items = [box('Box1', 0, 0, 240, 120, [tb('In1', 4, 4), tb('In2', 4, 30)]), tb('BelowBox', 20, 80)];
    expect(kinds(check(one(items)))).toEqual([['loose', 'BelowBox', 'Box1']]);
  });
  it("a container's child that runs out of its box over an item outside", () => {
    // Child runs from 50 to 70, past its box's bottom (60); Other starts at 65
    const items = [box('Box1', 0, 0, 240, 60, [tb('Child', 4, 50)]), tb('Other', 0, 65)];
    expect(kinds(check(one(items)))).toEqual([['overlap', 'Other', 'Child']]);
  });
  it('children inside their own container, a text box on a shape tile, a rule across: fine', () => {
    const items = [
      box('Box1', 0, 0, 240, 60, [tb('A', 4, 4), tb('B', 4, 30)]),
      { id: 'Tile', name: 'Tile', type: 'shape', x: 300, y: 0, w: 200, h: 80 },
      tb('Kpi', 310, 10),
      { id: 'Rule', name: 'Rule', type: 'line', x: 0, y: 20, w: 500, h: 0 },
    ];
    expect(kinds(check(one(items)))).toEqual([]);
  });
  it('two children of different containers that overlap', () => {
    const items = [box('L', 0, 0, 260, 60, [tb('A', 150, 10)]), box('R', 270, 70, 200, 60, [tb('B', 0, 0)])];
    // the boxes do not overlap and neither do A and B: nothing
    expect(kinds(check(one(items)))).toEqual([]);
    // A (150..250, 40..80) runs out of L's bottom and B (240..340, 70..90) out of R's left side: they overlap
    const near = [box('L', 0, 0, 260, 60, [tb('A', 150, 40, 100, 40)]), box('R', 270, 70, 200, 60, [tb('B', -30, 0)])];
    expect(kinds(check(one(near)))).toEqual([['overlap', 'B', 'A']]);
  });
});
