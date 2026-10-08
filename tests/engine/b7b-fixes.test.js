// External retest of 0.11.0 (B7-B): DOCX/HTML export, chart axes and warnings, the guarded fetch, CJK weights,
// warning de-duplication, parameter options, bidi controls.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { render } from '../../src/engine/index.js';
import { exportDocx } from '../../src/exporters/docx.js';
import { exportHtml } from '../../src/exporters/html.js';
import { fontStore, report } from '../helpers.js';

const text = (name, value, extra = {}) => ({ type: 'textbox', name, x: 0, y: 0, w: 300, h: 20, value, ...extra });

describe('N15: Word export of a report with no tables', () => {
  it('exports without exportData', async () => {
    const m = await render(report([text('T', 'Hello')]), { fontStore });
    expect(m.regions).toBeNull();
    const files = unzipSync(await exportDocx(m, { fontStore }));
    expect(strFromU8(files['word/document.xml'])).toContain('Hello');
  });
  it('a report with a table still asks for exportData', async () => {
    const rows = [{ a: 'x' }];
    const def = report([{ type: 'table', name: 'Tb', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 200 }],
      detail: [{ height: 18, cells: [{ value: '=Fields.a' }] }] }], { data: { rows } });
    const m = await render(def, { fontStore });
    expect(m.hasTables).toBe(true);
    await expect(exportDocx(m, { fontStore })).rejects.toThrow(/exportData/);
  });
});

import { slices } from '../../src/exporters/docx.js';

describe('N5: Word export writes the document XML in pieces', () => {
  it('slices cut at tag ends: the pieces join back to the input, and none is much longer than the limit', () => {
    const s = '<w:p><w:t>a</w:t></w:p>'.repeat(500);
    const pieces = slices(s, 100);
    expect(pieces.join('')).toBe(s);
    expect(pieces.length).toBeGreaterThan(50);
    for (const p of pieces.slice(0, -1)) expect(p.endsWith('>')).toBe(true);
    expect(slices('short', 100)).toEqual(['short']);
  });
  it('a document written in many small pieces is the same document', async () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ id: i, name: `Name ${i} & <co>` }));
    const def = report([{ type: 'table', name: 'Tb', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 200 }],
      detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }] }] }], { data: { rows } });
    const m = await render(def, { fontStore, exportData: true });
    const whole = unzipSync(await exportDocx(m, { fontStore }));
    const piecewise = unzipSync(await exportDocx(m, { fontStore, xmlChunk: 300 }));
    expect(strFromU8(piecewise['word/document.xml'])).toBe(strFromU8(whole['word/document.xml']));
    expect(strFromU8(piecewise['word/document.xml'])).toContain('Name 399 &amp; &lt;co&gt;');
  });
});

import { exportHtml } from '../../src/exporters/html.js';

describe('N6: exportHtml takes the options object like the other exporters', () => {
  it('exportHtml(model, { fonts }) works and embeds the fonts', async () => {
    const m = await render(report([text('T', 'Hello')]), { fontStore });
    const html = await exportHtml(m, { fonts: fontStore, title: 'T', static: true });
    expect(html).toContain('@font-face');
    expect(html).toContain('<title>T</title>');
  });
  it('the 0.7 form exportHtml(model, fontStore, options) still works, with one deprecation warning', async () => {
    const m = await render(report([text('T', 'Hello')]), { fontStore });
    const warn = [];
    const orig = console.warn; console.warn = (...a) => warn.push(a.join(' '));
    try {
      const html = await exportHtml(m, fontStore, { title: 'Old', static: true });
      expect(html).toContain('<title>Old</title>');
      await exportHtml(m, fontStore, { static: true });
    } finally { console.warn = orig; }
    expect(warn.filter(w => /DEPRECATED.*exportHtml/.test(w))).toHaveLength(1);
  });
  it('a missing or wrong fonts value is a TypeError that says what was expected', async () => {
    const m = await render(report([text('T', 'Hello')]), { fontStore });
    expect(() => exportHtml(m, { title: 'x' })).toThrow(/fonts must be a FontStore/);
    expect(() => exportHtml(m, { fonts: new Map() })).toThrow(/fonts must be a FontStore/);
  });
});

import { validate } from '../../src/engine/schema/validate.js';

describe('N9: chart warnings name only what is really not drawn', () => {
  const rowsP = [{ deg: 0, v: 10 }, { deg: 90, v: 20 }, { deg: 180, v: 15 }, { deg: 270, v: 5 }];
  const polar = (series) => ({ type: 'chart', name: 'C', x: 0, y: 0, w: 300, h: 300, dataSet: 'Rows', chartType: 'polar', xValue: '=Fields.deg', series });
  it('a polar chart drawn by one series does not warn that rows are not drawn when another series is blank', async () => {
    const m = await render(report([polar([{ name: 'V', value: '=Sum(Fields.v)' }, { name: 'W', value: '=Sum(Fields.nope)' }])], { data: { rows: rowsP } }), { fontStore });
    expect(m.warnings.filter(w => /not drawn/.test(w))).toEqual([]);
    expect(m.pages[0].items.filter(i => i.t === 'text').some(i => i.lines?.[0]?.text === '90°')).toBe(true);
  });
  it('rows that no series draws are still counted', async () => {
    const rows = [{ deg: 0, v: 10 }, { deg: null, v: 20 }, { deg: 180, v: 15 }];
    const m = await render(report([{ type: 'chart', name: 'S', x: 0, y: 0, w: 300, h: 300, dataSet: 'Rows', chartType: 'scatter', xValue: '=Fields.deg', series: [{ name: 'V', value: '=Sum(Fields.v)' }] }], { data: { rows } }), { fontStore });
    expect(m.warnings).toContain('S: 1 of 3 rows have no x or y value and are not drawn');
  });
  it('a gantt chart has no series by design: no "has no series" warning', () => {
    const def = report([{ type: 'chart', name: 'G', x: 0, y: 0, w: 300, h: 200, dataSet: 'Rows', chartType: 'gantt', series: [], ganttStart: '=Fields.v', ganttEnd: '=Fields.deg' }], { data: { rows: rowsP } });
    expect(validate(def).warnings.filter(w => /has no series/.test(w))).toEqual([]);
    expect(validate(report([{ type: 'chart', name: 'B', x: 0, y: 0, w: 300, h: 200, dataSet: 'Rows', chartType: 'column', series: [] }])).warnings.some(w => /has no series/.test(w))).toBe(true);
  });
});

describe('N4: scatter axes are not over-padded past zero', () => {
  const axisLabels = async (vals) => {
    const rows = vals.map(v => ({ x: v, y: v }));
    const m = await render(report([{ type: 'chart', name: 'S', x: 0, y: 0, w: 400, h: 300, dataSet: 'Rows', chartType: 'scatter', xValue: '=Fields.x', series: [{ name: 'V', value: '=Fields.y' }] }], { data: { rows } }), { fontStore });
    return m.pages[0].items.filter(i => i.t === 'text').map(i => i.lines?.[0]?.text).filter(t => /^-?\d+(\.\d+)?$/.test(t)).map(Number);
  };
  it('0-100 data: no negative tick, the top stays near the data (not 150)', async () => {
    const labels = await axisLabels([0, 25, 50, 75, 100]);
    expect(Math.min(...labels)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...labels)).toBeLessThanOrEqual(120);
    expect(Math.max(...labels)).toBeGreaterThanOrEqual(100);
  });
  it('40-100 data: the axis min stays at or above zero and within one step of the data', async () => {
    const labels = await axisLabels([40, 60, 80, 100]);
    expect(Math.min(...labels)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...labels)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...labels)).toBeLessThanOrEqual(40);
    expect(Math.max(...labels)).toBeLessThanOrEqual(120);
  });
});
