#!/usr/bin/env node
// The optional CJK and emoji fonts (OFL), about 40 MB: too large to ship with every install, so they are fetched once
// into public/fonts/cjk (or the folder given), where the engine finds them (src/engine/text/fonts.js, FALLBACK).
//   node scripts/fetch-fonts-cjk.mjs [folder]      (npm run fonts:cjk)
// Without them, Chinese, Japanese, Korean and emoji text draws as boxes, with a warning that says to run this.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', 'public', 'fonts', 'cjk'));
const BASE = 'https://github.com/google/fonts/raw/main/ofl';
export const CJK_FONTS = [
  ['notosansjp/NotoSansJP%5Bwght%5D.ttf', 'NotoSansJP.ttf'], ['notosanskr/NotoSansKR%5Bwght%5D.ttf', 'NotoSansKR.ttf'],
  ['notosanssc/NotoSansSC%5Bwght%5D.ttf', 'NotoSansSC.ttf'], ['notoemoji/NotoEmoji%5Bwght%5D.ttf', 'NotoEmoji.ttf'],
  ['notosansjp/OFL.txt', 'OFL.txt'],
];
fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [src, name] of CJK_FONTS) {
  const file = path.join(OUT, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) { total += fs.statSync(file).size; continue; }
  const r = await fetch(`${BASE}/${src}`);
  if (!r.ok) { console.error(`pw: could not fetch ${src}: HTTP ${r.status}`); process.exit(1); }
  const b = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(file, b);
  total += b.length;
  console.log(`${name}: ${(b.length / 1e6).toFixed(1)} MB`);
}
console.log(`CJK and emoji fonts in ${OUT}: ${(total / 1e6).toFixed(1)} MB`);
