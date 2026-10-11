// 100 three-page inputs, each embedding the same font (what an optimize pass can dedupe).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createPdf } from '@reportwright/pdf';
const inter = fs.readFileSync(createRequire(import.meta.url).resolve('@reportwright/fonts/public/fonts/Inter-Regular.ttf'));
const dir = process.env.OUT + '/in';
fs.mkdirSync(dir, { recursive: true });
for (let i = 0; i < 100; i++) {
  const pdf = createPdf(fs.createWriteStream(`${dir}/f-${String(i).padStart(3, '0')}.pdf`));
  const f = await pdf.embedFont(inter);
  for (let p = 0; p < 3; p++) { const pg = pdf.addPage({ width: 595.28, height: 841.89 }); pg.text(`File ${i + 1} page ${p + 1}`, { x: 40, y: 40, font: f, size: 14 }); await pg.end(); }
  await pdf.end();
}
