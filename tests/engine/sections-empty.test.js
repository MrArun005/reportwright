// #16: "Add a body section" on a report whose body is empty leaves an empty Section1, which printed a blank page.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report, texts } from '../helpers.js';

const tb = (value) => ({ type: 'textbox', name: value, x: 0, y: 0, w: 200, h: 20, value });
const footer = {
  height: 20,
  items: [{ type: 'textbox', name: 'pn', x: 0, y: 4, w: 300, h: 12, value: 'Page {Globals.PageNumber}' }],
};
const withBody = (body) => ({ ...report([], { footer }), sections: { ...report([], { footer }).sections, body } });

describe('an empty body section prints no page', () => {
  it('an empty section before one with items: one page', async () => {
    const out = await render(
      withBody([
        { name: 'Section1', items: [] },
        { name: 'Section2', height: 300, page: { orientation: 'landscape' }, items: [tb('Hello')] },
      ]),
      { fontStore },
    );
    expect(out.pages.length).toBe(1);
    expect(texts(out.pages[0])).toContain('Hello');
    expect(texts(out.pages[0])).toContain('Page 1');
  });
  it('a section with only its own page header still prints (a cover)', async () => {
    const cover = { name: 'Cover', pageHeader: { height: 40, items: [tb('Cover title')] }, items: [] };
    const out = await render(withBody([cover, { name: 'Main', items: [tb('Hello')] }]), { fontStore });
    expect(out.pages.length).toBe(2);
  });
  it('every section empty: still one page, so the header and footer print', async () => {
    const out = await render(
      withBody([
        { name: 'A', items: [] },
        { name: 'B', items: [] },
      ]),
      { fontStore },
    );
    expect(out.pages.length).toBe(1);
  });
});
