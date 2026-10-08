// Batch 4 tester list, group 1: numbers, ids and text stay whole (items 5, 6, 8, 9, 10, 12, 13, 14).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const textItems = (out) => out.pages.flatMap(p => p.items.filter(i => i.t === 'text'));
const joined = (t) => t.lines.map(l => l.text).join('⏎');
const find = (out, re) => textItems(out).find(t => re.test(t.lines.map(l => l.text).join('')));
const table = (columns, header, detail, extra = {}) => ({ type: 'table', name: 'T', x: 0, y: 0, w: columns.reduce((s, c) => s + (c.width || 0), 0) || 300, h: 40, dataSet: 'Rows', columns, header: [{ height: 14, cells: header.map(v => ({ value: v })) }], detail: [{ height: 14, cells: detail }], ...extra });

describe('5: a number never breaks inside its digits', () => {
  it('in a narrow table cell, a KPI box and a matrix cell', async () => {
    const rows = [{ v: -2138350.5, k: 99999999.99 }];
    const def = report([
      table([{ width: 30 }, { width: 200 }], ['A', 'B'], [{ value: '=Fields.v', style: { format: 'N2' } }, { value: 'x' }]),
      { type: 'textbox', name: 'Kpi', x: 0, y: 60, w: 40, h: 16, canGrow: false, dataSet: 'Rows', value: '=Format(First(Fields.k), "C2")', style: { fontSize: 13 } },
      { type: 'matrix', name: 'M', x: 0, y: 100, w: 200, h: 40, dataSet: 'Rows', columnWidth: 28, rowGroups: [{ name: 'R', expr: '="r"', width: 30 }], columnGroups: [{ name: 'C', expr: '="c"' }], values: [{ value: '=Sum(Fields.k)', format: 'N2' }] },
    ], { data: { rows }, def: { locale: 'en-IN', currency: 'INR' } });
    def.dataSets[0].fields = [{ name: 'v', type: 'number' }, { name: 'k', type: 'number' }];
    const out = await render(def, { fontStore });
    for (const re of [/-21,38,350\.50/, /₹9,99,99,999\.99/, /9,99,99,999\.99/]) {
      const t = find(out, re);
      expect(t, String(re)).toBeTruthy();
      expect(t.lines.length, joined(t)).toBe(1);
      expect(t.lines[0].text).not.toMatch(/…/);
    }
  });
});

describe('5: a number inside a text never breaks either', () => {
  it('"Total ₹1,61,70,192.00" in a narrow box keeps the amount whole', async () => {
    const def = report([{ type: 'textbox', name: 'K', x: 0, y: 0, w: 46, h: 30, value: 'Total ₹1,61,70,192.00', style: { fontSize: 9 } }]);
    const out = await render(def, { fontStore });
    const t = find(out, /Total/);
    expect(t.lines.map(l => l.text)).toContain('₹1,61,70,192.00');
  });
});

describe('6: a header word never breaks inside', () => {
  it('"Amount", "Outstanding amount" and "m02" in narrow columns shrink or wrap between words', async () => {
    const def = report([table([{ width: 26 }, { width: 44 }, { width: 11.6 }], ['Amount', 'Outstanding amount', 'm02'], [{ value: '1' }, { value: '2' }, { value: '3' }], { style: { padding: [1, 1, 1, 1] } })], { data: { rows: [{}] } });
    const out = await render(def, { fontStore });
    for (const [re, words] of [[/^Amount$/, ['Amount']], [/^Outstanding.?amount$/, ['Outstanding', 'amount']], [/^m02$/, ['m02']]]) {
      const t = textItems(out).find(i => re.test(i.lines.map(l => l.text).join(i.lines.length > 1 ? ' ' : '')));
      expect(t, String(re)).toBeTruthy();
      expect(t.lines.map(l => l.text).join(' ').split(' ')).toEqual(words);
    }
  });
});

describe('8: column widths from the content', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Customer with a long name ${i}`, amount: 123456.78 * (i + 1) }));
  const cells = [{ value: '=Fields.id' }, { value: '=Fields.name' }, { value: '=Fields.amount', style: { format: 'N2' } }];
  const widths = (out) => out.regions?.[0]?.columns;
  it('columns without a width share the table width by what their first rows hold', async () => {
    const def = report([table([{}, {}, {}], ['Id', 'Name', 'Amount'], cells, { w: 400 })], { data: { rows } });
    const out = await render(def, { fontStore, exportData: true });
    const [a, b, c] = widths(out);
    expect(a + b + c).toBeCloseTo(400, 1);
    expect(a).toBeLessThan(c);
    expect(c).toBeLessThan(b);
    // every value fits its column on one line
    for (const t of textItems(out)) expect(t.lines.length, joined(t)).toBe(1);
  });
  it('fitColumns re-measures a table that has widths', async () => {
    const def = report([table([{ width: 150 }, { width: 100 }, { width: 150 }], ['Id', 'Name', 'Amount'], cells, { fitColumns: true })], { data: { rows } });
    const out = await render(def, { fontStore, exportData: true });
    const [a, b, c] = widths(out);
    expect(a + b + c).toBeCloseTo(400, 1);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeGreaterThan(c);
  });
  it('explicit widths without fitColumns stay as designed', async () => {
    const def = report([table([{ width: 150 }, { width: 100 }, { width: 150 }], ['Id', 'Name', 'Amount'], cells)], { data: { rows } });
    expect(widths(await render(def, { fontStore, exportData: true }))).toEqual([150, 100, 150]);
  });
});

describe('9: ids are not amounts', () => {
  it('the Designer gives integer ids, numbers, codes and sequences no decimals and no grouping', async () => {
    const { formatFor } = await import('../../src/designer/tableGen.js');
    const ints = [{ id: 885, seq: 2113, txnNo: 4470, code: 12, number: 3685, lineSeq: 7 }, { id: 2113, seq: 3252, txnNo: 1, code: 3, number: 1, lineSeq: 8 }];
    for (const name of ['id', 'seq', 'txnNo', 'code', 'number', 'lineSeq', 'branch_id']) expect(formatFor({ name, type: 'number' }, ints), name).toBe('0');
    expect(formatFor({ name: 'amount', type: 'number' }, [{ amount: 1.5 }])).toBe('N2');
  });
  it('the engine adds no decimals or grouping to a whole number without a format', async () => {
    const def = report([table([{ width: 100 }], ['Id'], [{ value: '=Fields.id' }])], { data: { rows: [{ id: 2113 }, { id: 1234567 }] } });
    def.dataSets[0].fields = [{ name: 'id', type: 'number' }];
    const out = await render(def, { fontStore });
    expect(find(out, /^2113$/)).toBeTruthy();
    expect(find(out, /^1234567$/)).toBeTruthy();
  });
});

describe('10: no JavaScript values in the output', () => {
  it('objects, arrays and big numbers read as data, not [object Object] or 1e+21', async () => {
    const rows = [{ v: { nested: true } }, { v: 1e21 }, { v: [1, { a: 1 }] }, { v: 1e-7 }, { v: -2.5e22 }];
    const typed = report([table([{ width: 300 }], ['V'], [{ value: '=Fields.v' }])], { data: { rows } });
    typed.dataSets[0].fields = [{ name: 'v', type: 'string' }];
    const untyped = report([table([{ width: 300 }], ['V'], [{ value: '=Fields.v' }])], { data: { rows: [{ v: { nested: true } }, { v: 'x' }] } });
    const all = [...textItems(await render(typed, { fontStore })), ...textItems(await render(untyped, { fontStore }))].map(t => t.lines.map(l => l.text).join(''));
    expect(all.join('|')).not.toMatch(/object Object|e\+|e-/);
    expect(all).toContain('{"nested":true}');
    expect(all).toContain('1000000000000000000000');
    expect(all).toContain('1, {"a":1}');
    expect(all).toContain('0.0000001');
    expect(all).toContain('-25000000000000000000000');
  });
});

describe('12, 13: a short text shrinks before it is cut or wraps alone', () => {
  it('a KPI value and a label in fixed boxes shrink instead of ending in …', async () => {
    const def = report([
      { type: 'textbox', name: 'Kpi', x: 0, y: 0, w: 70, h: 18, canGrow: false, value: '₹9,99,99,999 crore', style: { fontSize: 13 } },
      { type: 'textbox', name: 'Lbl', x: 0, y: 30, w: 60, h: 12, canGrow: false, value: "Named 'Main Branch'", style: { fontSize: 8 } },
    ]);
    const out = await render(def, { fontStore });
    for (const re of [/₹9,99,99,999/, /Named/]) {
      const t = find(out, re);
      expect(joined(t)).not.toMatch(/…/);
      expect(t.size).toBeLessThan(re.source.includes('9') ? 13 : 8);
    }
    expect(joined(find(out, /Named/)).replace('⏎', ' ')).toBe("Named 'Main Branch'");
  });
  it('a one-line label a little too wide shrinks to stay on one line, like its neighbours', async () => {
    const def = report([{ type: 'textbox', name: 'L', x: 0, y: 0, w: 60, h: 10, value: 'Collection efficiency', style: { fontSize: 6.8, padding: 0 } }]);
    const out = await render(def, { fontStore });
    const t = find(out, /Collection/);
    expect(t.lines.length).toBe(1);
    expect(t.size).toBeGreaterThanOrEqual(6.8 * 0.85 - 0.01);
  });
  it('a long paragraph still wraps and grows', async () => {
    const def = report([{ type: 'textbox', name: 'P', x: 0, y: 0, w: 70, h: 10, value: 'The quick brown fox jumps over the lazy dog again', style: { fontSize: 8 } }]);
    const t = find(await render(def, { fontStore }), /quick/);
    expect(t.lines.length).toBeGreaterThan(1);
    expect(t.size).toBe(8);
  });
});
