// The fpdf plain-text case with @reportwright/pdf. It has no core (standard-14) fonts, so it embeds Inter (a subset).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createPdf } from '@reportwright/pdf';

const inter = fs.readFileSync(createRequire(import.meta.url).resolve('@reportwright/fonts/public/fonts/Inter-Regular.ttf'));
const pdf = createPdf(fs.createWriteStream(process.env.OUT + '/ours.pdf'), { title: 'Plain' });
const f = await pdf.embedFont(inter);
for (let pg = 0; pg < 200; pg++) {
  const p = pdf.addPage({ width: 595.28, height: 841.89 });
  for (let l = 0; l < 60; l++) p.text(`Page ${pg + 1} line ${l + 1}: the quick brown fox jumps over the lazy dog 0123456789`, { x: 40, y: 50 + l * 12 - 8, font: f, size: 10 });
  await p.end();
}
await pdf.end();
