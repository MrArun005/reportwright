// B5 item 8: one export signature in @pagewrightjs/engine: exportPdf/Xlsx/Docx/Pptx(model, { fonts, ... }).
// The 0.7 positional forms still work in 0.8 with one deprecation warning each; a wrong argument is a clear TypeError.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FontStore } from '../../src/engine/index.js';
import { fontFile } from '../../src/engine/text/fonts.js';

let m;
const fonts = new FontStore((k) => fs.readFileSync(path.join('public/fonts', fontFile(k))));
beforeAll(async () => { m = await import('../../packages/engine/entry.js'); });
const model = async () => m.render(m.blankReport(), { fontStore: fonts, exportData: true });

describe('export signatures', () => {
  it('exportPdf(model, { fonts }) and the deprecated exportPdf(model, fonts, opt) give a PDF; the old form warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const md = await model();
    const a = await m.exportPdf(md, { fonts, subset: false, title: 'A' });
    expect(new TextDecoder().decode(a.subarray(0, 5))).toBe('%PDF-');
    const b = await m.exportPdf(md, fonts, { subset: false });
    await m.exportPdf(md, fonts, { subset: false });
    expect(new TextDecoder().decode(b.subarray(0, 5))).toBe('%PDF-');
    expect(warn.mock.calls.filter(c => /DEPRECATED: exportPdf\(model, fontStore, options\)/.test(c[0]))).toHaveLength(1);
    warn.mockRestore();
  }, 60000);
  it('exportXlsx(model, { fonts }), exportDocx(model, { fonts }), exportPptx(model, { fonts }) and the old exportXlsx(model, ExcelJS, opt)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const md = await model();
    for (const f of [m.exportXlsx, m.exportDocx, m.exportPptx]) expect(String.fromCharCode(...(await f(md, { fonts })).subarray(0, 2))).toBe('PK');
    const FakeExcel = { Workbook: class {} };
    expect(String.fromCharCode(...(await m.exportXlsx(md, FakeExcel, {})).subarray(0, 2))).toBe('PK');
    expect(warn.mock.calls.some(c => /DEPRECATED: exportXlsx\(model, ExcelJS, options\)/.test(c[0]))).toBe(true);
    warn.mockRestore();
  }, 60000);
  it('a wrong argument is a TypeError that says what was expected', async () => {
    const md = await model();
    await expect(m.exportPdf({ nope: 1 }, { fonts })).rejects.toThrow(/model must be the page model render\(\) returns/);
    await expect(m.exportPdf(md, 'fonts')).rejects.toThrow(/options must be an object such as \{ fonts \}, got string/);
    expect(() => m.exportXlsx(md, { fonts: {} })).toThrow(/fonts must be a FontStore/);
    expect(() => m.exportXlsx(null)).toThrow(TypeError);
  });
});
