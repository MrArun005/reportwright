// Renders the sample, exports the PDF, and checks every page-model line is in the PDF at the same position.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { render, FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
import { exportPdf } from '../src/exporters/pdf.js';
import { sampleLoan } from '../src/sample/loans.js';
import { createSubsetter } from '../src/exporters/subset.js';
const subset = createSubsetter(async () => fs.readFileSync(new URL('../public/harfbuzz-subset.wasm', import.meta.url)));
const def = JSON.parse(fs.readFileSync(new URL('../reports/loan-statement.pw.json', import.meta.url)));
const store = new FontStore(async k => fs.readFileSync(new URL(`../public/fonts/${fontFile(k)}`, import.meta.url)));
const model = await render(def, { fontStore: store, sources: { loans: sampleLoan('LN-2026-004417') } });
const pdfBytes = await exportPdf(model, store, { subset });
fs.writeFileSync('/tmp/check.pdf', pdfBytes);
console.log(`PDF size ${(pdfBytes.length / 1024).toFixed(0)} KB`);
const xml = execFileSync('pdftotext', ['-bbox', '/tmp/check.pdf', '-'], { encoding: 'utf8' });
const pages = xml.split('<page ').slice(1).map(p => [...p.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(m => ({ x: +m[1], y: +m[2], t: m[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') })));
let lines = 0, bad = 0;
model.pages.forEach((pg, i) => {
  for (const it of pg.items) if (it.t === 'text') for (const l of it.lines) {
    lines++;
    const first = l.text.split(' ')[0];
    const hit = pages[i].find(w => w.t === first && Math.abs(w.x - l.x) < 0.6 && w.y < l.y && w.y > l.y - it.size * 1.3);
    if (!hit) { bad++; if (bad < 6) console.log(`page ${i + 1}: "${l.text}" at ${l.x.toFixed(1)},${l.y.toFixed(1)} not found`); }
  }
});
console.log(`${lines} lines checked on ${model.pages.length} pages, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
