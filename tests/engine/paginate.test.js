import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const rows = (n) => ({ rows: Array.from({ length: n }, (_, i) => ({ n: i + 1, name: `Row ${i + 1}` })) });
const table = (extra = {}) => ({
  type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 54, dataSet: 'Rows', repeatHeader: true,
  columns: [{ width: 100 }, { width: 200 }],
  header: [{ height: 20, cells: [{ value: 'No' }, { value: 'Name' }] }],
  detail: [{ height: 20, cells: [{ value: '=Fields.n' }, { value: '=Fields.name' }] }],
  footer: [{ height: 20, cells: [{ value: 'Total' }, { value: '=Sum(Fields.n)' }] }],
  ...extra,
});
const footer = { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 0, w: 200, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] };

describe('paginator', () => {
  it('breaks a long table between rows and repeats the header', async () => {
    const out = await render(report([table()], { data: rows(100), footer }), { fontStore });
    expect(out.pages.length).toBeGreaterThan(2);
    for (const pg of out.pages) {
      const t = texts(pg);
      expect(t[0]).toBe('No');                                   // header on every page
      expect(t).toContain(`Page ${out.pages.indexOf(pg) + 1} of ${out.pages.length}`);
    }
    // every row appears exactly once
    const all = out.pages.flatMap(texts).filter(s => /^Row \d+$/.test(s));
    expect(all.length).toBe(100);
    expect(new Set(all).size).toBe(100);
    expect(texts(out.pages.at(-1))).toContain('5,050');
  });

  it('never places a row across the page bottom', async () => {
    const out = await render(report([table()], { data: rows(120) }), { fontStore });
    const bottom = 841.89 - 36;
    for (const pg of out.pages) for (const it of pg.items) if (it.t === 'rect' || it.t === 'line') expect((it.y ?? Math.max(it.y1, it.y2)) + (it.h || 0)).toBeLessThanOrEqual(bottom + 0.01);
  });

  it('does not leave a header alone at the bottom of a page', async () => {
    // a 700pt spacer pushes the table so only the header would fit on page 1
    const spacer = { type: 'shape', name: 'S', shape: 'rect', x: 0, y: 0, w: 10, h: 745 };
    const out = await render(report([spacer, table({ y: 745 })], { data: rows(5) }), { fontStore });
    expect(texts(out.pages[0])).not.toContain('No');
    expect(texts(out.pages[1])[0]).toBe('No');
  });

  it('pushes items below a growing item down', async () => {
    const long = 'word '.repeat(400);
    const body = [
      { type: 'textbox', name: 'A', x: 0, y: 0, w: 200, h: 14, value: long, canGrow: true },
      { type: 'textbox', name: 'B', x: 0, y: 20, w: 200, h: 14, value: 'below' },
      { type: 'textbox', name: 'C', x: 300, y: 20, w: 200, h: 14, value: 'beside' },
    ];
    const out = await render(report(body), { fontStore });
    const find = (s) => out.pages.flatMap((p, pi) => p.items.filter(i => i.t === 'text' && i.lines.some(l => l.text === s)).map(i => ({ pi, y: i.lines[0].y })))[0];
    expect(find('beside')).toMatchObject({ pi: 0 });
    expect(find('beside').y).toBeLessThan(80);                   // not under A, not pushed
    const b = find('below');
    expect(b.pi > 0 || b.y > 200).toBe(true);                    // pushed below the grown text
  });

  it('honours page break before', async () => {
    const body = [
      { type: 'textbox', name: 'A', x: 0, y: 0, w: 200, h: 14, value: 'first' },
      { type: 'textbox', name: 'B', x: 0, y: 20, w: 200, h: 14, value: 'second', pageBreakBefore: true },
    ];
    const out = await render(report(body), { fontStore });
    expect(out.pages.length).toBe(2);
    expect(texts(out.pages[1])).toContain('second');
  });

  it('shows #Error and a warning instead of failing', async () => {
    const out = await render(report([{ type: 'textbox', name: 'Bad', x: 0, y: 0, w: 200, h: 14, value: '=Fields.missing', dataSet: 'Rows' }], { data: rows(1) }), { fontStore });
    expect(texts(out.pages[0])).toContain('#Error');
    expect(out.warnings.join(' ')).toMatch(/Bad: The field "missing" does not exist/);
  });

  it('needs required parameters', async () => {
    const def = report([], { def: { parameters: [{ name: 'acc', type: 'string', required: true }] } });
    await expect(render(def, { fontStore })).rejects.toMatchObject({ missingParameters: ['acc'] });
  });
});
