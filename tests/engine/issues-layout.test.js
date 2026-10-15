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

describe('the body against the page height (#30)', () => {
  it('an item that starts past the room a page has for the body: once, with how many more', () => {
    const is = check(one([tb('Top', 0, 0), tb('Textbox3', 0, 900), tb('Textbox4', 0, 950)]));
    const b = is.find((i) => i.kind === 'below');
    expect(b).toMatchObject({ name: 'Textbox3', y: 900, room: 700, more: 1 });
    expect(is.filter((i) => i.kind === 'below' || i.kind === 'past')).toHaveLength(1);
  });
  it('an item across the page line moves to the next page; one taller than the page is cut', () => {
    expect(check(one([tb('Low', 0, 690)])).find((i) => i.kind === 'past')).toMatchObject({ bottom: 710, room: 700 });
    expect(check(one([tb('Tall', 0, 0, 100, 900)])).find((i) => i.kind === 'tall')).toMatchObject({
      height: 900,
      room: 700,
    });
  });
  it('a table taller than the page is fine (its rows go on); one below the page is not', () => {
    const t = { id: 'T', name: 'T', type: 'table', x: 0, y: 0, w: 200, h: 900 };
    expect(kinds(check(one([t])))).toEqual([]);
    expect(kinds(check(one([{ ...t, y: 720, h: 40 }])))).toEqual([['below', 'T', null]]);
  });
  it('a page header and footer that leave little room', () => {
    const def = one([tb('A', 0, 0)]);
    def.sections.pageHeader.height = 400;
    def.sections.pageFooter.height = 300;
    expect(check(def).find((i) => i.kind === 'room')).toMatchObject({ header: 400, footer: 300, room: 70 });
  });
  it('a body that fits: nothing', () => {
    expect(kinds(check(one([tb('A', 0, 0), tb('B', 0, 670)])))).toEqual([]);
  });
});

describe('a section with another page width and the shared header or footer (#16)', () => {
  const def = (own) => ({
    page: A4,
    sections: {
      pageHeader: { height: 0, items: [] },
      body: [
        { name: 'Section1', items: [tb('P', 0, 0)] },
        { name: 'Section2', page: { orientation: 'landscape' }, items: [tb('L', 0, 0)], ...own },
      ],
      pageFooter: { height: 20, items: [{ ...tb('Pg', 0, 0), w: 523 }] },
    },
  });
  it('landscape with the shared footer: say so', () => {
    const is = designIssues(def({}), []);
    expect(is.find((i) => i.kind === 'shared')).toMatchObject({
      name: 'Section2',
      band: 'footer',
      orient: 'landscape',
      width: 770,
      room: 523,
    });
  });
  it('with its own footer: nothing', () => {
    const is = designIssues(def({ pageFooter: { height: 20, items: [] } }), []);
    expect(is.filter((i) => i.kind === 'shared')).toEqual([]);
  });
  it('the landscape section measures items against its own page height', () => {
    const d = def({});
    d.sections.body[1].items.push(tb('Low', 0, 520)); // 595 - 72 - 20 = 503 pt for the body
    expect(designIssues(d, []).find((i) => i.kind === 'below')).toMatchObject({ name: 'Low', room: 503 });
  });
});
