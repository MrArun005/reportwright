// The parity gate's own checks (scripts/parity-tiers.mjs): what passes and what must fail.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exactChecks, pixelVerdict, tier2, canonicalOps, TOLERANCE, checkRenderer } from '../../scripts/parity-tiers.mjs';

const tools = ['pdftoppm', 'pdftotext', 'qpdf'].every(t => spawnSync(t, [t === 'qpdf' ? '--version' : '-v']).status === 0);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-tiers-'));
let n = 0;
const W = Array(224).fill(500).join(' ');
/** a one-page PDF (xref rebuilt by qpdf): content, and an optional structure tree of { S, mcid } elements */
function pdf(content, { kids = null, fonts = { F1: 'Helvetica' } } = {}) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const fontRefs = Object.entries(fonts).map(([k, base]) => `/${k} ${add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /FirstChar 32 /LastChar 255 /Widths [${W}] /FontDescriptor ${add(`<< /Type /FontDescriptor /FontName /${base} /Flags 32 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>`)} 0 R >>`)} 0 R`).join(' ');
  const contents = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const pages = objs.length + 2, page = objs.length + 1;
  add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 300 200] /Contents ${contents} 0 R /Resources << /Font << ${fontRefs} >> >>${kids ? ' /StructParents 0' : ''} >>`);
  add(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  let tree = '';
  if (kids) {
    const root = objs.length + 1, doc = root + 1, first = doc + 1;
    add(`<< /Type /StructTreeRoot /K ${doc} 0 R /ParentTree << /Nums [0 [${kids.map((_, i) => `${first + i} 0 R`).join(' ')}]] >> >>`);
    add(`<< /Type /StructElem /S /Document /P ${root} 0 R /K [${kids.map((_, i) => `${first + i} 0 R`).join(' ')}] >>`);
    kids.forEach(k => add(`<< /Type /StructElem /S /${k.S} /P ${doc} 0 R /Pg ${page} 0 R /K ${k.mcid} >>`));
    tree = ` /StructTreeRoot ${root} 0 R /MarkInfo << /Marked true >>`;
  }
  const cat = add(`<< /Type /Catalog /Pages ${pages} 0 R${tree} >>`);
  let body = '%PDF-1.7\n';
  objs.forEach((o, i) => { body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  body += `trailer\n<< /Root ${cat} 0 R /Size ${objs.length + 1} >>\n%%EOF\n`;
  const raw = path.join(dir, `r${++n}.pdf`), f = path.join(dir, `p${n}.pdf`);
  fs.writeFileSync(raw, body, 'latin1');
  spawnSync('qpdf', [raw, f]);
  return f;
}
const text = (x = 40, font = 'F1') => `BT /${font} 14 Tf ${x} 120 Td (Hello world) Tj ET`;
const rule = (w = 1, rgb = '0 0 0') => `${rgb} RG ${w} w 40 100 m 260 100 l S`;

describe.skipIf(!tools)('parity gate tiers', () => {
  let base;
  beforeAll(() => { base = pdf(`${text()}\n${rule()}`); });
  const all = (b) => ({ ...exactChecks(base, b), pixels: pixelVerdict(base, b) });

  it('the rasteriser is the pinned one, and the tolerance is the named config', () => {
    expect(checkRenderer()).toBe(TOLERANCE.rendererVersion);
    expect(TOLERANCE).toMatchObject({ pixelTolerance: 0.005, pixelThreshold: 64, blockSize: 8, dpi: 150 });
  });
  it('the same drawing, written differently (number formats, identity cm, an empty q Q) passes everything', () => {
    const r = all(pdf(`q Q 1 0 0 1 0 0 cm BT /F1 14.000 Tf 40.0 120 Td (Hello world) Tj ET\n0 0 0 RG 1.0 w 40 100.000 m 260 100 l S`));
    expect(r).toMatchObject({ words: '', tree: '', drawing: '' });
    expect(r.pixels.ok).toBe(true);
    expect(canonicalOps('0.5 g .5 g 1 0 0 1 0 0 cm q Q')).toEqual(['g 0.5', 'g 0.5']);
  });
  it('anti-aliasing only passes tier 2: small grey changes on edges, and a few strong ones scattered', () => {
    const w = 200, h = 100, a = new Uint8Array(w * h).fill(255), b = new Uint8Array(a);
    for (let x = 0; x < w; x++) { a[50 * w + x] = 0; b[50 * w + x] = 0; a[51 * w + x] = 140; b[51 * w + x] = 180; } // a softer edge
    for (let k = 0; k < 90; k++) b[(k % 90 + 5) * w + (k * 37) % w] = 0; // 90 isolated pixels: 0.45%
    expect(tier2({ w, h, data: a }, { w, h, data: b })).toMatchObject({ ok: true, block: null });
    for (let y = 10; y < 18; y++) for (let x = 10; x < 18; x++) b[y * w + x] = 0; // one solid 8×8 block
    expect(tier2({ w, h, data: a }, { w, h, data: b })).toMatchObject({ ok: false, block: [10, 10] });
  });
  it('a moved word fails tier 1', () => { expect(all(pdf(`${text(40.5)}\n${rule()}`)).words).toMatch(/box/); });
  it('a 1/255 colour change fails the drawing compare (the thresholds would hide it)', () => {
    const r = all(pdf(`${text()}\n${rule(1, `${1 / 255} 0 0`)}`));
    expect(r.drawing).toMatch(/RG/);
    expect(r.words).toBe('');
  });
  it('a 0.1 pt line width change fails the drawing compare', () => { expect(all(pdf(`${text()}\n${rule(1.1)}`)).drawing).toMatch(/w 1 → w 1.1/); });
  it('a glyph in another font at the same place fails the drawing compare, not tier 1', () => {
    const fonts = { F1: 'ReportSans', F2: 'ReportSerif' }; // the same widths and descriptor: the same boxes
    const b0 = pdf(`${text()}\n${rule()}`, { fonts }), b1 = pdf(`${text(40, 'F2')}\n${rule()}`, { fonts });
    const r = exactChecks(b0, b1);
    expect(r.words).toBe('');
    expect(r.drawing).toMatch(/font:\/ReportSans.*font:\/ReportSerif/);
  });
  it('a missing rule line (a fully different 8×8 block) fails tiers 2 and 3', () => {
    const thick = pdf(`${text()}\n0 0 0 rg 40 60 220 6 re f`), r = pixelVerdict(thick, pdf(text()));
    expect(r).toMatchObject({ ok: false, tier: 3 });
  });
  const tagged = (kids) => pdf(`/P <</MCID 0>> BDC ${text()} EMC /H1 <</MCID 1>> BDC BT /F1 14 Tf 40 60 Td (Title) Tj ET EMC`, { kids });
  it('a dropped structure element fails tier 1', () => {
    expect(exactChecks(tagged([{ S: 'P', mcid: 0 }, { S: 'H1', mcid: 1 }]), tagged([{ S: 'P', mcid: 0 }])).tree).toMatch(/kids/);
  });
  it('a reordered structure tree with identical words fails tier 1 on order', () => {
    const r = exactChecks(tagged([{ S: 'P', mcid: 0 }, { S: 'H1', mcid: 1 }]), tagged([{ S: 'H1', mcid: 1 }, { S: 'P', mcid: 0 }]));
    expect(r.words).toBe('');
    expect(r.tree).toMatch(/\/P.*\/H1/);
  });
});
