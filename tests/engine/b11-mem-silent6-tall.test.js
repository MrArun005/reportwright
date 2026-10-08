// SILENT-6: an item taller than the room the page has for the body warns in validate(), saying what the render does;
// render() says it once (the paginator's own warning where it cuts), not twice.
import { describe, it, expect } from 'vitest';
import { validate } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { fontStore } from '../helpers.js';

// A4 (842 pt) with 36 pt margins: 770 pt for the body
const def = (items, sections = {}, page = {}) => ({ $schema: 'pagewright/report@1', page: { size: 'A4', margins: [36, 36, 36, 36], ...page }, sections: { body: { items }, ...sections } });
const tall = (w) => w.filter(x => /taller than the \d+ pt the page has/.test(x));

describe('SILENT-6: an item taller than the page', () => {
  it('a shape taller than the body warns, naming the heights and that its lower part is cut', () => {
    const w = tall(validate(def([{ type: 'shape', name: 'Box', x: 0, y: 0, w: 100, h: 800 }])).warnings);
    expect(w).toEqual(['Box: it is 800 pt tall, taller than the 770 pt the page has for the body (the page less its margins, page header and footer). Its lower part is cut at the page bottom; make it shorter.']);
  });
  it('the page header and footer count; a text box says its text continues when it has more than one line', () => {
    const w = tall(validate(def([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 700, value: 'x' }], { pageHeader: { height: 50, items: [] }, pageFooter: { height: 30, items: [] } })).warnings);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^T: it is 700 pt tall, taller than the 690 pt/);
    expect(w[0]).toMatch(/text of more than one line continues on the next page/);
  });
  it('a body section with its own page and header is measured against them', () => {
    const d = def([]);
    d.sections.body = [{ items: [{ type: 'shape', name: 'A', x: 0, y: 0, w: 10, h: 700 }] },
      { page: { size: 'A5' }, pageHeader: { height: 40, items: [] }, items: [{ type: 'shape', name: 'B', x: 0, y: 0, w: 10, h: 700 }] }];
    const w = tall(validate(d).warnings);
    expect(w).toHaveLength(1); // A5 is 595 pt tall: 595 - 72 - 40 = 483
    expect(w[0]).toMatch(/^B: it is 700 pt tall, taller than the 483 pt/);
  });
  it('quiet: items that fit, tables and lists (their rows split across pages), pageless pages', () => {
    expect(tall(validate(def([{ type: 'shape', name: 'S', x: 0, y: 600, w: 10, h: 300 }])).warnings)).toEqual([]); // moves to the next page
    expect(tall(validate(def([{ type: 'list', name: 'L', x: 0, y: 0, w: 100, h: 900, items: [] }])).warnings)).toEqual([]);
    expect(tall(validate(def([{ type: 'shape', name: 'S', x: 0, y: 0, w: 10, h: 2000 }], {}, { size: 'Pageless' })).warnings)).toEqual([]);
  });
  it('render says it once: its own cut warning, not validate\'s as well', async () => {
    const m = await render(def([{ type: 'shape', name: 'Box', x: 0, y: 0, w: 100, h: 800 }]), { fontStore });
    expect(tall(m.warnings)).toEqual([]);
    expect(m.warnings.filter(x => /taller than the page/.test(x))).toHaveLength(1);
  });
});
