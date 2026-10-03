import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const many = (n) => ({ rows: Array.from({ length: n }, (_, i) => ({ n: i + 1, name: `Item ${i + 1}`, grp: `G${Math.floor(i / 20) + 1}` })) });
const table = { type: 'table', name: 'T', x: 0, y: 0, w: 150, h: 36, dataSet: 'Rows', repeatHeader: true, columns: [{ width: 50 }, { width: 100 }],
  header: [{ height: 18, cells: [{ value: 'No' }, { value: 'Name' }] }], detail: [{ height: 18, cells: [{ value: '=Fields.n' }, { value: '=Fields.name' }] }] };

describe('multi-column body', () => {
  it('fills three columns before starting a new page', async () => {
    const def = report([table], { data: many(120) });
    def.sections.body.columns = { count: 3, gap: 12 };
    const out = await render(def, { fontStore });
    const one = await render(report([table], { data: many(120) }), { fontStore });
    expect(out.pages.length).toBe(Math.ceil(one.pages.length / 3));
    const xs = new Set(out.pages[0].items.filter(i => i.t === 'text' && i.lines[0].text === 'No').map(i => Math.round(i.lines[0].x)));
    expect(xs.size).toBe(3);                                             // header repeated in each column
  });
});

describe('table of contents', () => {
  it('lists bookmarks with their final page numbers', async () => {
    const body = [
      { type: 'toc', name: 'Toc', x: 0, y: 0, w: 400, h: 40, title: 'Contents', pageBreakAfter: true },
      { ...table, y: 60, groups: [{ name: 'G', expr: '=Fields.grp', pageBreak: 'between', header: [{ height: 18, cells: [{ value: '=Fields.grp', bookmark: '=Fields.grp' }, null] }], footer: [] }] },
    ];
    const out = await render(report(body, { data: many(100) }), { fontStore });
    const toc = texts(out.pages[0]);
    expect(toc[0]).toBe('Contents');
    expect(toc).toEqual(expect.arrayContaining(['G1', 'G5']));
    const g3 = out.bookmarks.find(b => b.label === 'G3');
    expect(toc[toc.indexOf('G3') + 1]).toBe(String(g3.page));
    expect(g3.page).toBe(4);                                             // contents page + G1 + G2
    const links = out.pages[0].items.filter(i => i.t === 'link' && i.action.type === 'bookmark');
    expect(links.length).toBe(5);
  });
});

describe('named styles', () => {
  it('applies a named style under the item style', async () => {
    const def = report([{ type: 'textbox', name: 'H', x: 0, y: 0, w: 300, h: 20, value: 'Heading', styleName: 'Heading', style: { color: '#ff0000' } }]);
    def.styles = { base: { fontSize: 9 }, named: { Heading: { fontSize: 18, fontWeight: 'bold', color: '#0000ff' } } };
    const out = await render(def, { fontStore });
    const t = out.pages[0].items.find(i => i.t === 'text');
    expect(t.size).toBe(18);
    expect(t.font).toBe('Inter-Bold');
    expect(t.color).toBe('#ff0000');                                     // item style wins
  });
});
