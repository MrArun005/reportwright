// Renders the sample, exports the PDF, and checks every page-model line is in the PDF at the same position.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { render, FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
import { exportPdf } from '../src/exporters/pdf.js';
import { sampleLoan } from '../src/sample/loans.js';
import { sampleTorture } from '../src/sample/torture.js';
import { createSubsetter } from '../src/exporters/subset.js';
const subset = createSubsetter(async () => fs.readFileSync(new URL('../public/harfbuzz-subset.wasm', import.meta.url)));
const store = new FontStore(async k => fs.readFileSync(new URL(`../public/fonts/${fontFile(k)}`, import.meta.url)));
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../reports/${f}`, import.meta.url)));
let total = 0;
for (const [file, opts] of [['loan-statement.pw.json', { sources: { loans: sampleLoan('LN-2026-004417') } }], ['richtext-showcase.pw.json', {}], ['expressions-showcase.pw.json', {}], ['charts-showcase.pw.json', {}], ['tablix-showcase.pw.json', {}], ['torture-test.pw.json', { sources: { torture: sampleTorture() } }]]) {
  const model = await render(read(file), { fontStore: store, ...opts });
  const pdfBytes = await exportPdf(model, store, { subset });
  fs.writeFileSync('/tmp/check.pdf', pdfBytes);
  console.log(`${file}: PDF size ${(pdfBytes.length / 1024).toFixed(0)} KB`);
  const xml = execFileSync('pdftotext', ['-bbox', '/tmp/check.pdf', '-'], { encoding: 'utf8' });
  const pages = xml.split('<page ').slice(1).map(p => [...p.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(m => ({ x: +m[1], y: +m[2], t: m[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') })));
  let lines = 0, bad = 0;
  model.pages.forEach((pg, i) => {
    const texts = pg.items.filter(it => it.t === 'text');
    for (const it of texts) {
      if (it.rotate) continue; // pdftotext reports turned text in its own frame
      for (const l of it.lines) {
        // rich text: only a piece that starts a word (pdftotext joins "bo" + "ld" into one word)
        if (it.rich) {
          if (!l.text.trim() || l.text[0] === ' ') continue;
          const prev = texts.filter(o => o.rich?.id === it.rich.id && o.rich.l === it.rich.l && o.lines[0].x < l.x).sort((a, b) => b.lines[0].x - a.lines[0].x)[0];
          if (prev && !prev.lines[0].text.endsWith(' ')) continue;
        }
        lines++;
        const first = l.text.split(' ')[0];
        const hit = pages[i].find(w => (it.rich ? w.t.startsWith(first) : w.t === first) && Math.abs(w.x - l.x) < 0.6 && w.y < l.y && w.y > l.y - it.size * 1.3);
        if (!hit) { bad++; if (bad < 6) console.log(`page ${i + 1}: "${l.text}" at ${l.x.toFixed(1)},${l.y.toFixed(1)} not found`); }
      }
    }
  });
  console.log(`${file}: ${lines} lines checked on ${model.pages.length} pages, ${bad} mismatches`);
  total += bad;
}
process.exit(total ? 1 : 0);
