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
  it('the 0.7 form exportHtml(model, fontStore, options) was removed in 1.0: a TypeError naming the new form', async () => {
    const m = await render(report([text('T', 'Hello')]), { fontStore });
    expect(() => exportHtml(m, fontStore, { title: 'Old', static: true })).toThrow(/removed in 1\.0: use exportHtml\(model, \{ fonts: fontStore/);
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

import http from 'node:http';
import zlib from 'node:zlib';
import { guardedFetch, boundedFetch } from '../../src/engine/data/guard.js';
import { sourceResponse } from '../../src/engine/data/index.js';

describe('N14: the guarded fetch decodes gzip and names the scheme it refuses', () => {
  const serve = (body, headers) => new Promise((resolve) => {
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', ...headers }); res.end(body); });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
  it('a gzip body (sent although the request asked for identity) reads as its JSON, and the encoding header is not passed on', async () => {
    const data = { rows: [{ a: 1 }, { a: 2 }] };
    const srv = await serve(zlib.gzipSync(JSON.stringify(data)), { 'content-encoding': 'gzip' });
    try {
      const f = boundedFetch(guardedFetch({ allowHosts: ['127.0.0.1'] }, fetch), {});
      const res = await f(`http://127.0.0.1:${srv.address().port}/x`, {});
      expect(res.headers.get('content-encoding')).toBeNull();
      expect(await res.json()).toEqual(data);
    } finally { srv.close(); }
  });
  it('the byte cap counts the decoded bytes: a small gzip that inflates past the cap is refused', async () => {
    const srv = await serve(zlib.gzipSync(Buffer.alloc(1024 * 1024)), { 'content-encoding': 'gzip' });
    try {
      const f = boundedFetch(guardedFetch({ allowHosts: ['127.0.0.1'] }, fetch), { maxFetchBytes: 100 * 1024 });
      const res = await f(`http://127.0.0.1:${srv.address().port}/x`, {});
      await expect(res.text()).rejects.toThrow(/larger than/);
    } finally { srv.close(); }
  });
  it('file: and data: URLs are refused for their scheme, not for a host made by a parameter', async () => {
    const ctx = { params: {}, globals: {}, dataSets: {}, fields: null, functions: {} };
    await expect(sourceResponse({ type: 'json', url: 'file:///etc/hosts' }, ctx, { params: {} })).rejects.toThrow(/Only http and https URLs can be fetched, not file:/);
    await expect(sourceResponse({ type: 'json', url: 'data:application/json,[1]' }, ctx, { params: {} })).rejects.toThrow(/not data:/);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import fontkitModule from '@pdf-lib/fontkit';
import { createSubsetter } from '../../src/exporters/subset.js';

describe('N10: a variable CJK face is cut at Regular, not its default (Thin)', () => {
  const cjk = path.join(import.meta.dirname, '..', '..', 'public', 'fonts', 'cjk', 'NotoSansJP.ttf');
  const inter = path.join(import.meta.dirname, '..', '..', 'public', 'fonts', 'Inter-Regular.ttf');
  const fontkit = fontkitModule.default || fontkitModule;
  const subset = createSubsetter(async () => fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'harfbuzz-subset.wasm')));
  it.skipIf(!fs.existsSync(cjk))('the subset has no variation left and its Latin advance is the Regular one', async () => {
    const orig = new Uint8Array(fs.readFileSync(cjk));
    const cut = fontkit.create(Buffer.from(await subset(orig, [...'日本語A'].map(c => c.codePointAt(0)), {})));
    const regular = fontkit.create(Buffer.from(orig)).getVariation({ wght: 400 });
    const thin = fontkit.create(Buffer.from(orig));
    expect(cut.fvar).toBeFalsy();
    // the Latin advance: Regular's (607.5, 608 after the subset's rounding) and not Thin's (574)
    const adv = (f) => f.glyphForCodePoint(0x41).advanceWidth;
    expect(Math.abs(adv(cut) - adv(regular))).toBeLessThanOrEqual(1);
    expect(Math.abs(adv(cut) - adv(thin))).toBeGreaterThan(20);
  });
  it('a static face is cut the same whatever weight is asked for', async () => {
    const bytes = new Uint8Array(fs.readFileSync(inter));
    const a = await subset(bytes, [65, 66, 67], {});
    const b = await subset(bytes, [65, 66, 67], { weight: 100 });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

import { TextMeasurer } from '../../src/engine/text/measure.js';
import { SHAPER } from '../../src/engine/text/fonts.js';
import { exportPdf } from '../../src/exporters/pdf.js';

// the PDF's content streams, inflated (pdf-lib compresses them)
const pdfStreams = (bytes) => {
  const s = Buffer.from(bytes).toString('latin1');
  const out = [];
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const end = s.indexOf('endstream', m.index);
    try { out.push(zlib.inflateSync(Buffer.from(s.slice(m.index + m[0].length, end), 'latin1')).toString('latin1')); } catch { /* not flate */ }
  }
  return out.join('\n');
};
describe('#29: format characters (bidi marks, joiners, soft hyphen) need no glyph', () => {
  it('no "no font has these characters" for RLM, LRE, LRI, ZWJ, ZWNJ, soft hyphen', async () => {
    await fontStore.load([SHAPER, 'Inter-Regular', 'NotoSansArabic-Regular', 'NotoSansHebrew-Regular']);
    for (const cp of [0x200f, 0x200e, 0x202a, 0x202c, 0x2066, 0x200d, 0x200c, 0x00ad]) {
      const m = new TextMeasurer(fontStore);
      m.pick(cp, 'Inter-Regular', null);
      expect([...m.noGlyph], cp.toString(16)).toEqual([]);
    }
  });
  it('a PDF draws no .notdef box for a format character no face has', async () => {
    const m = await render(report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 20, value: 'a‪b‬c' }], { def: { locale: 'ar-SA' } }), { fontStore });
    const pdf = await exportPdf(m, fontStore, {});
    expect(pdfStreams(pdf)).toMatch(/\[<[0-9a-f]{4}>/); // the text is drawn
    expect(pdfStreams(pdf)).not.toMatch(/<0000>\]? ?(TJ|Tj)|\[<0000>/); // and no notdef glyph in it
  });
});

import { execFileSync } from 'node:child_process';
describe('#10 leftover: HTML Tables sort keys do not depend on the host time zone', () => {
  it('the same report gives the same sort keys under UTC, Kolkata and Los Angeles', () => {
    const root = path.join(import.meta.dirname, '..', '..');
    const script = `
      const { render } = await import(${JSON.stringify(path.join(root, 'src/engine/index.js'))});
      const { tablesData } = await import(${JSON.stringify(path.join(root, 'src/exporters/htmldata.js'))});
      const { fontStore, report } = await import(${JSON.stringify(path.join(root, 'tests/helpers.js'))});
      const def = report([{ type: 'table', name: 'Tb', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 200 }],
        detail: [{ height: 14, cells: [{ value: '=CDate(Fields.d)' }] }] }], { data: { rows: [{ d: '2026-10-08' }, { d: '2026-03-01' }] } });
      const m = await render(def, { fontStore, exportData: true });
      console.log(JSON.stringify(tablesData(m).map(t => t.rows.map(r => r.c.map(c => c[2])))));`;
    const keys = ['UTC', 'Asia/Kolkata', 'America/Los_Angeles'].map(tz =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim());
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
    expect(keys[0]).toBe(JSON.stringify([[[1791417600000], [1772323200000]]]));
  });
});

describe('#22: warnings once, and named by their item (never "undefined")', () => {
  it('a sub-report warning about an unnamed chart is said once, naming the chart type', async () => {
    const child = report([{ type: 'chart', x: 0, y: 30, w: 200, h: 100, dataSet: 'Nope', chartType: 'column', series: [{ name: 'V', value: '=Sum(Fields.a)' }] }], { data: { rows: [{ a: 1 }] } });
    const parent = report([{ type: 'subreport', name: 'S', x: 0, y: 0, w: 300, h: 200, report: 'child1' }]);
    const m = await render(parent, { fontStore, loadReport: async () => child });
    expect(m.warnings).toEqual(['Subreport child1: chart: the data set "Nope" does not exist']);
  });
  it('no warning reads "undefined" for an item without a name', async () => {
    const m = await render(report([{ type: 'table', x: 0, y: 0, w: 200, h: 40, dataSet: 'Nope', columns: [{ width: 200 }], detail: [{ height: 14, cells: [{ value: '=1' }] }] }], { data: { rows: [{ a: 1 }] } }), { fontStore });
    expect(m.warnings.join('\n')).not.toMatch(/undefined/);
  });
});

import { parameterOptions } from '../../src/engine/index.js';
describe('#25: parameterOptions keeps the fixed options, first', () => {
  it('a parameter with fixed options and a data set lists the fixed ones first, then the fetched, each once', async () => {
    const def = report([text('T', 'x')], {
      data: { rows: [{ city: 'Home' }, { city: 'Gold' }, { city: 'All' }, { city: 'Pune' }] },
      def: { parameters: [{ name: 'Where', type: 'string', options: [{ value: 'All', label: 'All' }], optionsFrom: { dataSet: 'Rows', value: '=Fields.city' } }] },
    });
    const opts = await parameterOptions(def, {}, {});
    expect(opts.Where.map(o => o.value)).toEqual(['All', 'Home', 'Gold', 'Pune']);
  });
});
