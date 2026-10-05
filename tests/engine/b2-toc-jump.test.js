// B2 item 7: a contents entry knows its page, also in the viewer's fast first render (firstPages) of a short report.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const tb = (name, value, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 18, value, ...extra });
const def = () => report([
  { type: 'toc', name: 'Toc', x: 0, y: 0, w: 400, h: 20, title: 'Contents', source: 'headings' },
  tb('H1', 'Intro', 40, { headingLevel: 1 }),
  tb('H3', 'Results', 100, { headingLevel: 1, pageBreakBefore: true }),
]);
const tocLinks = (m) => m.pages[0].items.filter(i => i.t === 'link' && i.action?.type === 'bookmark').map(i => i.action);

describe('TOC entries jump to their page', () => {
  it('a full render: every entry carries its page', async () => {
    const m = await render(def(), { fontStore });
    expect(tocLinks(m).map(a => [a.target, a.page])).toEqual([['Intro', 1], ['Results', 2]]);
  });
  it('a first-pages render of a report that fits is the final one: numbers and pages filled in', async () => {
    const m = await render(def(), { fontStore, firstPages: 2 });
    expect(m.partial).toBeFalsy();
    expect(tocLinks(m).map(a => [a.target, a.page])).toEqual([['Intro', 1], ['Results', 2]]);
  });
});
