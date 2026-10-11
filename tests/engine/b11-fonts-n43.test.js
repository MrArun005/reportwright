// N43: the standard-14 metrics are a generated table (src/engine/text/standard-metrics.js), not
// @pdf-lib/standard-fonts decompressed with pako at run time; the PDFs are byte for byte what they were.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { render, exportPdf, FontStore } from '../../packages/engine/entry.js';
import { STANDARD_FACES } from '../../src/engine/text/standard.js';

const root = path.join(import.meta.dirname, '../..');
// every face, WinAnsi punctuation, accents and a soft hyphen; Symbol and ZapfDingbats in their own encodings
const TEXT = 'Façade “quoted” — 1,234.50 € naïve Œuvre ½ ® trade­mark AVAWAY Ty';
const def = {
  $schema: 'reportwright/report@1', name: 'Std', page: { size: 'A4', margins: [36, 36, 36, 36] },
  sections: { body: { height: 700, items: STANDARD_FACES.map(([family, , weight, style], i) => ({
    id: `t${i}`, type: 'textbox', x: 0, y: i * 40, w: 200, h: 36, canGrow: true,
    value: family === 'Symbol' ? 'αβγ ∑ ≤ ∞' : family === 'ZapfDingbats' ? '✓✔✗ ❤ ➔' : TEXT,
    style: { fontFamily: family, fontWeight: weight === 700 ? 'bold' : 'normal', fontStyle: style, fontSize: 9 } })) } },
};


/** The PDF's content, not its compressed bytes (zlib differs between Node versions): every Flate stream inflated, the
 *  /Length values, the cross-reference stream and startxref (they follow the compressed sizes) masked. */
function contentHash(pdf) {
  const b = Buffer.from(pdf); let out = '', i = 0;
  for (;;) {
    const s = b.indexOf('stream', i);
    if (s < 0) { out += b.subarray(i).toString('latin1'); break; }
    if (b.subarray(s - 3, s).toString() === 'end') { out += b.subarray(i, s + 6).toString('latin1'); i = s + 6; continue; }
    let st = s + 6; if (b[st] === 13) st++; if (b[st] === 10) st++;
    const e = b.indexOf('endstream', st), head = b.subarray(i, st).toString('latin1');
    let d = b.subarray(st, e); while (d.length && (d[d.length - 1] === 10 || d[d.length - 1] === 13)) d = d.subarray(0, -1);
    out += head + (/\/Type\s*\/XRef/.test(head.slice(head.lastIndexOf('<<'))) ? '[xref]' : (() => { try { return zlib.inflateSync(d).toString('latin1'); } catch { return d.toString('latin1'); } })());
    i = e;
  }
  return createHash('sha256').update(out.replace(/\/Length \d+/g, '/Length _').replace(/startxref\s+\d+/, 'startxref _'), 'latin1').digest('hex');
}

describe('N43: standard-font metrics without @pdf-lib/standard-fonts', () => {
  it('a PDF in all 14 standard fonts is byte-identical to 0.13.0 (layout and /Widths)', async () => {
    const fonts = new FontStore(() => { throw new Error('no font file for a standard-font report'); });
    const model = await render(def, { fontStore: fonts });
    // the hash is the 0.13.0 writer's file: pdfWriter 'legacy' (scripts/writer-parity.mjs holds the default writer's pages to it)
    const pdf = await exportPdf(model, { fonts, creationDate: new Date('2026-01-01T00:00:00Z'), pdfWriter: 'legacy' });
    expect(contentHash(pdf)).toBe(HASH);
  });
  it('the generated table is up to date, and nothing in src or the builds imports @pdf-lib/standard-fonts', () => {
    execFileSync(process.execPath, ['scripts/gen-standard-metrics.mjs', '--check'], { cwd: root, stdio: 'pipe' });
    const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(f => /\.m?js$/.test(f)).map(f => path.join('src', f));
    for (const f of [...files, 'scripts/build-packages.mjs', 'scripts/build-embed.mjs', 'scripts/embed-options.mjs', 'packages/engine/entry.js']) {
      expect(fs.readFileSync(path.join(root, f), 'utf8'), f).not.toMatch(/['"]@pdf-lib\/standard-fonts['"]/);
    }
  });
});
const HASH = '77667887523ae6a1e71aa07ac67750a736e6322d44d3c2e61458dc77177f8749'; // the content of 0.13.0's PDF (with @pdf-lib/standard-fonts), the same on Node 20 and 22
