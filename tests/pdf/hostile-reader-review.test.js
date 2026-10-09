// Regressions for the independent security review of the reader (R1–R8). Each describe is one finding; each test
// failed before its fix. Inputs that can exhaust the heap or run for hours are run in a child process
// (reader-hostile-child.mjs) under a time limit and a 512 MB heap, since a fatal OOM cannot be caught in-process.
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { loadPdf } from '../../packages/pdf/src/index.js';
import { onePage, rawPdf } from './reader-tools.js';
import { toBytes } from '../../packages/pdf/src/index.js';
import { HAS, INTER, verapdf } from './tools.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CHILD = path.join(import.meta.dirname, 'reader-hostile-child.mjs');
/** run one case in a child: its JSON line, or { killed / crashed } @param {string} name @param {number} [secs] */
function child(name, secs = 20) {
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', CHILD, name], { encoding: 'utf8', timeout: secs * 1000, killSignal: 'SIGKILL' });
  const line = r.stdout.trim().split('\n').pop();
  if (r.status !== 0 || !line) return { code: r.signal ? `killed:${r.signal}` : `exit:${r.status}`, stderr: r.stderr.slice(-400) };
  return JSON.parse(line);
}

describe('R1: a ToUnicode bfrange cannot copy a long destination 65,536 times (heap exhaustion)', () => {
  it('a destination past 64 code units is skipped: the text comes from the encoding, no OOM', () => {
    const r = child('cmap-long-dst');
    expect(r.code).toBe('OK');
    expect(r.text).toBe('A');
  }, 30_000);
  it('the characters one CMap holds are capped: E_BUDGET, not OOM', () => {
    expect(child('cmap-chars').code).toBe('E_BUDGET');
  }, 30_000);
  it('the characters one extraction holds across fonts are capped: E_BUDGET, not OOM', () => {
    expect(child('cmap-many-fonts').code).toBe('E_BUDGET');
  }, 30_000);
});

describe('R2: a CIDFont /W is a budget step per code, capped in total (timeoutMs honoured)', () => {
  for (const name of ['w-ranges', 'w-arrays', 'page-tree-shared-kids']) {
    it(`${name}: stops in well under the 15 s limit with a typed error`, () => {
      const r = child(name, 15);
      expect(['E_BUDGET', 'E_TIMEOUT']).toContain(r.code);
      expect(r.ms).toBeLessThan(3000);
    }, 30_000);
  }
});

describe('R3: glyphs are budget steps, every stream counts against maxDecoded, form XObjects drawn are capped, extractText has a default time', () => {
  it('an unfiltered 64 KB form drawn 100,000 times stops at maxDecoded', () => {
    const r = child('forms-unfiltered', 15);
    expect(r.code).toBe('E_BUDGET');
    expect(r.message).toMatch(/maxDecoded/);
  }, 30_000);
  it('a form drawn 20,000 times: E_BUDGET (at most 10,000 per extraction)', () => {
    const r = child('forms-many', 15);
    expect(r.code).toBe('E_BUDGET');
    expect(r.message).toMatch(/form XObjects/);
  }, 30_000);
  it('one Tj of a 16 MB string honours timeoutMs 300', () => {
    const r = child('glyphs-one-string', 15);
    expect(r.code).toBe('E_TIMEOUT');
    expect(r.ms).toBeLessThan(1500);
  }, 30_000);
  it('extractText takes its own timeoutMs (30 s by default) and checks its options', async () => {
    const d = await loadPdf(onePage(`BT /F1 1 Tf (${'A'.repeat(1 << 20)}) Tj ET`));
    const t = Date.now();
    expect(() => d.page(0).extractText({ timeoutMs: 5 })).toThrow(expect.objectContaining({ code: 'E_TIMEOUT' }));
    expect(Date.now() - t).toBeLessThan(1500);
    expect(() => d.extractText({ timeoutMs: -1 })).toThrow(TypeError);
    expect(() => d.extractText({ nope: 1 })).toThrow(TypeError);
    expect(d.page(0).extractText({ timeoutMs: Infinity }).length).toBe(1 << 20);
  }, 30_000);
});

describe('R6: names from the file never reach Object.prototype through a constant table', () => {
  const font = (f, s) => rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    [`<< /Length ${s.length} >>`, s], f]);
  it('/BaseFont /__proto__ and /Encoding /constructor: the standard encoding and widths, not a TypeError', async () => {
    const d = await loadPdf(font('<< /Type /Font /Subtype /Type1 /BaseFont /__proto__ /Encoding /constructor >>', 'BT /F1 12 Tf 10 10 Td (AB) Tj ET'));
    expect(d.page(0).extractText()).toBe('AB');
  });
  it('/Differences glyph names toString and valueOf: no text, not a function', async () => {
    const d = await loadPdf(font('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [65 /toString /valueOf] >> >>', 'BT /F1 12 Tf 10 10 Td (ABC) Tj ET'));
    expect(d.page(0).extractText()).toBe('C');
  });
  it('a field /FT /constructor is unknown; a /DA font /constructor fills in Helvetica', async () => {
    const form = (ft, da) => rawPdf(['<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] >> >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>',
      `<< /Type /Annot /Subtype /Widget /FT /${ft} /T (f) /Rect [10 10 110 30] /P 3 0 R /DA (/${da} 12 Tf 0 g) >>`]);
    expect((await loadPdf(form('constructor', 'Helv'))).fields[0].type).toBe('unknown');
    const d = await loadPdf(form('Tx', 'constructor'));
    d.fill({ f: 'hello' });
    const r = await d.save();
    expect((await loadPdf(r.bytes)).fields[0].value).toBe('hello');
  });
});

describe('R8: the whole-file check finds whether a byte-scan hit is in stream data without scanning every stream', () => {
  it('80,000 streams each hiding an unreadable object: linear, not quadratic', () => {
    const r = child('regions', 60);
    expect(r.code).toBe('OK');
    expect(r.ms).toBeLessThan(5000);
  }, 90_000);
});

describe('an earlier cross-reference section is checked like the latest: each entry must match an object read', () => {
  /** rev 1: object 4 is at a place no scan reads (in a stream's data, "obj" after a comment) and is a JavaScript
   * action; rev 2's section moves object 4 to a clean object, so the merged table looks clean */
  function twoRevisions() {
    const parts = []; let pos = 0;
    const add = (s) => { const b = Buffer.from(s, 'latin1'); parts.push(b); pos += b.length; return pos - b.length; };
    add('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
    const o1 = add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>\nendobj\n');
    const o2 = add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    const o3 = add('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>\nendobj\n');
    const hidden = '\n4 0 %c\nobj << /S /JavaScript /JS (app.alert(1)) >> endobj\n';
    const o5 = add(`5 0 obj\n<< /Length ${hidden.length} >>\nstream\n`);
    const o4 = add(hidden) + 1;
    add('\nendstream\nendobj\n');
    const row = (o) => `${String(o).padStart(10, '0')} 00000 n\r\n`;
    const x1 = add(`xref\n0 6\n0000000000 65535 f\r\n${row(o1)}${row(o2)}${row(o3)}${row(o4)}${row(o5)}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n`);
    add(`${x1}\n%%EOF\n`);
    const n4 = add('4 0 obj\n<< /S /GoTo /D [3 0 R /Fit] >>\nendobj\n');
    const x2 = add(`xref\n4 1\n${row(n4)}trailer\n<< /Size 6 /Root 1 0 R /Prev ${x1} >>\nstartxref\n`);
    add(`${x2}\n%%EOF\n`);
    return new Uint8Array(Buffer.concat(parts));
  }
  it('saveIncremental refuses (fail closed) when an earlier section points at an object the check never read', async () => {
    const d = await loadPdf(twoRevisions());
    await expect(d.saveIncremental()).rejects.toMatchObject({ code: 'E_ACTIVE', message: expect.stringMatching(/earlier cross-reference section|could not be checked/) });
  });
});

describe('R7: a structure element\'s /A (attributes) is not an action', () => {
  it.skipIf(!HAS.verapdf)('a tagged table rewritten by save() keeps /Scope and /ColSpan, and passes PDF/UA-1', async () => {
    const out = await toBytes(async (pdf) => {
      const f = await pdf.embedFont(INTER), p = pdf.addPage(), T = (t, fn, o) => p.tag(t, fn, o), t = (s, x, y) => p.text(s, { x, y, font: f, size: 11 });
      T('H1', () => t('Sales', 40, 50));
      T('Table', () => {
        T('THead', () => T('TR', () => ['Region', 'Q1', 'Q2'].forEach((h, i) => T('TH', () => t(h, 40 + i * 120, 145), { scope: 'Column', id: `h${i}` }))));
        T('TBody', () => T('TR', () => { T('TH', () => t('South', 40, 185), { scope: 'Row', id: 'r1' }); T('TD', () => t('2,581', 160, 185), { headers: ['h1', 'h2', 'r1'], colSpan: 2 }); }));
      });
      await p.end();
    }, { title: 'Sales', tagged: { lang: 'en-GB' }, creationDate: new Date('2026-01-01') });
    const r = await (await loadPdf(out)).save();
    expect(r.stripped ?? []).toEqual([]);
    // every object's text, object streams and all (pdf-lib parses them)
    const doc = await PDFDocument.load(r.bytes);
    const text = doc.context.enumerateIndirectObjects().map(([, o]) => String(o)).join('\n');
    expect(text).toMatch(/\/Scope \/Column/);
    expect(text).toMatch(/\/Scope \/Row/);
    expect(text).toMatch(/\/ColSpan 2/);
    expect(verapdf(r.bytes, 'ua1').failed).toEqual([]);
  }, 60_000);
  it('an annotation shaped like a structure element (/S, /P) still has its /A checked', async () => {
    const b = rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>',
      '<< /Type /Annot /Subtype /Link /S /Table /P 3 0 R /Rect [0 0 10 10] /A << /S /JavaScript /JS (app.alert(1)) >> >>']);
    const r = await (await loadPdf(b)).save();
    expect(Buffer.from(r.bytes).toString('latin1')).not.toMatch(/JavaScript/);
    await expect((await loadPdf(b)).saveIncremental()).rejects.toMatchObject({ code: 'E_ACTIVE' });
  });
});
