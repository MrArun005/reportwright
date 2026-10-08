// N43: the standard-14 metrics are a generated table (src/engine/text/standard-metrics.js), not
// @pdf-lib/standard-fonts decompressed with pako at run time; the PDFs are byte for byte what they were.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

describe('N43: standard-font metrics without @pdf-lib/standard-fonts', () => {
  it('a PDF in all 14 standard fonts is byte-identical to 0.13.0 (layout and /Widths)', async () => {
    const fonts = new FontStore(() => { throw new Error('no font file for a standard-font report'); });
    const model = await render(def, { fontStore: fonts });
    const pdf = await exportPdf(model, { fonts, creationDate: new Date('2026-01-01T00:00:00Z') });
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(HASH);
  });
  it('the generated table is up to date, and nothing in src or the builds imports @pdf-lib/standard-fonts', () => {
    execFileSync(process.execPath, ['scripts/gen-standard-metrics.mjs', '--check'], { cwd: root, stdio: 'pipe' });
    const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(f => /\.m?js$/.test(f)).map(f => path.join('src', f));
    for (const f of [...files, 'scripts/build-packages.mjs', 'scripts/build-embed.mjs', 'scripts/embed-options.mjs', 'packages/engine/entry.js']) {
      expect(fs.readFileSync(path.join(root, f), 'utf8'), f).not.toMatch(/['"]@pdf-lib\/standard-fonts['"]/);
    }
  });
});
const HASH = 'a50c3c8af31fc3ebb9a5ad6d3ca0b782ba9cc17658382cabc07c0dec115ca9f4'; // 0.13.0 with @pdf-lib/standard-fonts
