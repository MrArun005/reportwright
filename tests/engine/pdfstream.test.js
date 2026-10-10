// The streaming PDF writer (src/exporters/pdfstream.js, docs/research/STREAMING-1M.md §6): objects go to the sink as
// they are made, fonts are subset at the end with their glyph IDs kept, "of Y" is an XObject written at the end.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadPdf } from '@reportwright/pdf';
import fontkitModule from '@pdf-lib/fontkit';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { createSubsetter } from '../../src/exporters/subset.js';
import { createPdfStream } from '../../src/exporters/pdfstream.js';
import { fontStore, report } from '../helpers.js';

const fontkit = /** @type {any} */ (fontkitModule).default || fontkitModule;
const root = path.join(import.meta.dirname, '../..');
const subset = createSubsetter(() => fs.promises.readFile(path.join(root, 'public/harfbuzz-subset.wasm')));
const hasPoppler = spawnSync('pdftotext', ['-v']).status === 0;

/** a sink that keeps the chunks (and awaits a turn per write, like a slow socket) */
const memorySink = () => {
  const chunks = [];
  return { chunks, write: async (u8) => { chunks.push(Uint8Array.from(u8)); await new Promise(r => setImmediate(r)); }, bytes: () => Buffer.concat(chunks) };
};
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pws-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
let tmpN = 0;
const tmp = (bytes) => { const f = path.join(tmpDir, `${++tmpN}.pdf`); fs.writeFileSync(f, bytes); return f; };
/** pdftotext's text and its complaints (a broken xref or object makes poppler print "Syntax Error") */
const pdftotext = (bytes, ...args) => {
  const r = spawnSync('pdftotext', [...args, tmp(bytes), '-']);
  return { text: r.stdout.toString(), err: r.stderr.toString() };
};
/**
 * The cross-reference stream: every object it lists is where it says (at its offset, or in an object stream that
 * holds that many objects), startxref points at it. Returns the text of every object (object streams unpacked).
 */
function checkXref(pdf) {
  const s = Buffer.from(pdf).toString('latin1');
  expect(s.startsWith('%PDF-1.7\n')).toBe(true);
  const at = Number(s.match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1]);
  const streamOf = (off) => {
    const head = s.slice(off, off + 400).match(/^(\d+) 0 obj\n(<<.*?>>)\nstream\n/s);
    const len = Number(head[2].match(/\/Length (\d+)/)[1]);
    const from = off + head[0].length;
    return { n: Number(head[1]), dict: head[2], data: zlib.inflateSync(pdf.subarray(from, from + len)) };
  };
  const x = streamOf(at);
  expect(x.dict).toMatch(/\/Type \/XRef/);
  expect(x.dict).toMatch(/\/W \[1 4 2\] \/DecodeParms << \/Columns 7 \/Predictor 12 >>/);
  { // PNG Up: a filter byte (2) a row, then each byte plus the one above
    const raw = x.data, rows = raw.length / 8, out = Buffer.alloc(rows * 7);
    for (let r = 0; r < rows; r++) {
      expect(raw[r * 8]).toBe(2);
      for (let b = 0; b < 7; b++) out[r * 7 + b] = (raw[r * 8 + 1 + b] + (r ? out[(r - 1) * 7 + b] : 0)) & 255;
    }
    x.data = out;
  }
  const size = Number(x.dict.match(/\/Size (\d+)/)[1]);
  expect(x.data.length).toBe(size * 7);
  let text = '';
  const stms = new Map();
  for (let n = 1; n < size; n++) {
    const e = x.data.subarray(n * 7, n * 7 + 7), f = e.readUInt32BE(1);
    if (e[0] === 1) { expect(s.slice(f, f + 12)).toMatch(new RegExp(`^${n} 0 obj`)); continue; }
    expect(e[0]).toBe(2);
    if (!stms.has(f)) {
      const o = x.data.readUInt32BE(f * 7 + 1), st = streamOf(o);
      expect(st.dict).toMatch(/\/Type \/ObjStm/);
      stms.set(f, Number(st.dict.match(/\/N (\d+)/)[1]));
      text += st.data.toString('latin1');
    }
    expect(e.readUInt16BE(5)).toBeLessThan(stms.get(f));
  }
  return text + s;
}

/** to a tenth of a point, as pdf.js's Content places text */
const r1 = (v) => Math.round(v * 10) / 10;
/** A minimal painter for a page model's plain text (what this test compares: the text and its order). */
async function streamModel(model, w) {
  for (const pg of model.pages) {
    let s = '';
    const H = pg.height ?? model.height;
    for (const it of pg.items) {
      if (it.t !== 'text') continue;
      for (const l of it.lines) s += `BT /${w.fontName(it.font)} ${it.size} Tf ${r1(l.x)} ${r1(H - l.y)} Td <${w.encode(it.font, l.text)}> Tj ET\n`;
    }
    await w.addPage({ width: pg.width ?? model.width, height: H, content: s });
  }
}

describe('streaming PDF writer', () => {
  it.skipIf(!hasPoppler)('a report streamed and exported today reads the same (text and order), and the file is well formed', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ a: `Customer ${i}`, b: i * 1.5, c: ['Pune', 'Delhi', 'Chennai'][i % 3] }));
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 360, h: 36, dataSet: 'Rows', columns: [{ width: 140 }, { width: 100 }, { width: 120 }],
      header: [{ height: 18, cells: [{ value: 'Name' }, { value: 'Amount' }, { value: 'City' }] }],
      detail: [{ height: 18, cells: [{ value: '=Fields.a' }, { value: '=Fields.b', style: { format: 'N2' } }, { value: '=Fields.c' }] }] }],
    { data: { rows }, footer: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 300, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] } });
    def.dataSets[0].fields = [{ name: 'a', type: 'string' }, { name: 'b', type: 'number' }, { name: 'c', type: 'string' }];
    const model = await render(def, { fontStore });
    expect(model.pages.length).toBeGreaterThan(2);
    const today = await exportPdf(model, fontStore, { subset });
    const keys = [...new Set(model.pages.flatMap(p => p.items.filter(i => i.t === 'text').map(i => i.font)))];
    const sink = memorySink();
    const w = createPdfStream(sink, { fontStore, fonts: keys, subset });
    await streamModel(model, w);
    const res = await w.finish({ info: { title: 'T' } });
    const pdf = sink.bytes();
    expect(res.pages).toBe(model.pages.length);
    expect(res.bytes).toBe(pdf.length);
    checkXref(pdf);
    for (const args of [[], ['-layout']]) {
      const a = pdftotext(today, ...args), b = pdftotext(pdf, ...args);
      expect(b.err).toBe('');
      expect(b.text).toBe(a.text);
    }
    expect(pdftotext(pdf).text).toContain('Page 2 of');
    const doc = await loadPdf(pdf);
    expect(doc.pageCount).toBe(model.pages.length);
    expect(doc.info.title).toBe('T');
  });

  it.skipIf(!hasPoppler)('fonts: only the glyphs drawn are embedded (IDs kept), and the text reads back', async () => {
    await fontStore.load(['Inter-Regular', 'Inter-Bold']);
    const sink = memorySink();
    const w = createPdfStream(sink, { fontStore, fonts: ['Inter-Regular', 'Inter-Bold'], subset });
    await w.addPage({ width: 300, height: 200, content: `BT /${w.fontName('Inter-Regular')} 12 Tf 20 150 Td <${w.encode('Inter-Regular', 'Hello ABBA')}> Tj ET` });
    await w.finish();
    const pdf = sink.bytes();
    checkXref(pdf);
    expect(pdftotext(pdf).text.trim()).toBe('Hello ABBA');
    const fonts = execFileSync('pdffonts', [tmp(pdf)]).toString();
    expect(fonts).toMatch(/[A-Z]{6}\+Inter/); // a subset, named as one
    expect(fonts).not.toMatch(/Bold/); // a font no page used is not written
    // the embedded file: the drawn glyphs have outlines, the others are empty, and the IDs are the full font's
    const s = pdf.toString('latin1');
    const m = s.match(/\/Length1 \d+ \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/);
    const len = Number(m[1]);
    const file = zlib.inflateSync(pdf.subarray(m.index + m[0].length, m.index + m[0].length + len));
    expect(file.length).toBeLessThan(fontStore.bytes.get('Inter-Regular').length / 4);
    const full = fontStore.get('Inter-Regular'), sub = fontkit.create(new Uint8Array([...file, ...new Uint8Array(16)]));
    const gid = (ch) => full.glyphForCodePoint(ch.codePointAt(0)).id;
    for (const ch of 'HeloAB') expect(sub.getGlyph(gid(ch)).path.commands.length).toBeGreaterThan(0);
    for (const ch of 'ZxQ') expect(sub.getGlyph(gid(ch)).path.commands.length).toBe(0);
  });

  it.skipIf(!hasPoppler)('"Page X of Y": the total is an XObject written at the end', async () => {
    await fontStore.load(['Inter-Regular']);
    const sink = memorySink();
    const w = createPdfStream(sink, { fontStore, fonts: ['Inter-Regular'], subset });
    const F = w.fontName('Inter-Regular');
    const total = w.totalPages({ font: 'Inter-Regular', size: 10, width: 30 });
    for (let i = 1; i <= 7; i++) {
      await w.addPage({ width: 300, height: 200, content: `BT /${F} 10 Tf 20 20 Td <${w.encode('Inter-Regular', `Page ${i} of`)}> Tj ET\nq 1 0 0 1 80 20 cm /${total} Do Q\n`,
        annots: i === 1 ? [`<< /Type /Annot /Subtype /Link /Rect [20 100 120 120] /Border [0 0 0] /Dest [${w.pageRef(6)} 0 R /Fit] >>`] : [] });
    }
    await w.finish({ outline: [{ title: 'Start', page: 1 }, { title: 'Three', page: 3, top: 150, level: 1 }, { title: 'Seven', page: 7 }] });
    const pdf = sink.bytes();
    checkXref(pdf);
    const pages = pdftotext(pdf).text.split('\f');
    expect(pages[2]).toMatch(/Page 3 of\s*7/);
    expect(pages[6]).toMatch(/Page 7 of\s*7/);
    const doc = await loadPdf(pdf);
    expect(doc.pageCount).toBe(7);
    const s = checkXref(pdf);
    expect(s).toContain('/Type /Outlines');
    expect(s).toMatch(/\/Dest \[\d+ 0 R \/XYZ null 150 null\]/);
  });

  it('pages leave memory once written: heap after GC stays flat from 2,000 to 10,000 pages', () => {
    const run = (n) => {
      const r = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=128', path.join(root, 'scripts/mem-pdfstream.mjs'), String(n)], { cwd: root, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(r.stderr);
      return JSON.parse(r.stdout.trim().split('\n').pop());
    };
    const a = run(2000), b = run(10000);
    console.log(JSON.stringify({ a, b }));
    expect(b.pages).toBe(10000);
    // per page the writer keeps two offsets and a ref (a few dozen bytes): 8,000 more pages are well under 4 MB
    expect(b.liveMB - a.liveMB).toBeLessThan(4);
    expect(b.peakRssMB - a.peakRssMB).toBeLessThan(30);
  }, 240000);
});
