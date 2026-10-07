#!/usr/bin/env node
// @reportwright/fonts-cjk: the Chinese, Japanese, Korean and emoji fonts (Noto, SIL Open Font License), about 40 MB.
// The package itself is small: the fonts are downloaded on demand from google/fonts at a pinned commit and checked
// against their SHA-256 before they are written. No install script runs.
//   npx reportwright-fonts-cjk [folder]          (default: this package's fonts/ folder, where the engine looks)
//   import { fetchCjkFonts } from '@reportwright/fonts-cjk'; await fetchCjkFonts();
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const COMMIT = '5e8a3ba899557829a76cfdac30fa512bda91d7ca'; // github.com/google/fonts
/** [path under ofl/, file name the engine asks for, sha256] */
export const CJK_FONTS = [
  ['notosansjp/NotoSansJP%5Bwght%5D.ttf', 'NotoSansJP.ttf', 'c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f'],
  ['notosanskr/NotoSansKR%5Bwght%5D.ttf', 'NotoSansKR.ttf', '194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252'],
  ['notosanssc/NotoSansSC%5Bwght%5D.ttf', 'NotoSansSC.ttf', 'a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da'],
  ['notoemoji/NotoEmoji%5Bwght%5D.ttf', 'NotoEmoji.ttf', 'de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551'],
  ['notosansjp/OFL.txt', 'OFL.txt', '1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9'],
];
/** Where the fonts go by default: this package's fonts/ folder. */
export const FONTS_DIR = fileURLToPath(new URL('../fonts/', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');

/**
 * Download the fonts that are missing (or damaged) into dir. Resolves to the folder.
 * @param {string} [dir] @param {{ log?: (line: string) => void, fetch?: typeof fetch }} [opt]
 */
export async function fetchCjkFonts(dir = FONTS_DIR, { log = () => {}, fetch: get = fetch } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [src, name, hash] of CJK_FONTS) {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && sha(fs.readFileSync(file)) === hash) continue;
    const r = await get(`https://github.com/google/fonts/raw/${COMMIT}/ofl/${src}`);
    if (!r.ok) throw new Error(`@reportwright/fonts-cjk: could not download ${name}: HTTP ${r.status}`);
    const b = Buffer.from(await r.arrayBuffer());
    if (sha(b) !== hash) throw new Error(`@reportwright/fonts-cjk: ${name} does not match its SHA-256; not written`);
    fs.writeFileSync(file, b);
    log(`${name}: ${(b.length / 1e6).toFixed(1)} MB`);
  }
  return dir;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = await fetchCjkFonts(process.argv[2] ? path.resolve(process.argv[2]) : FONTS_DIR, { log: console.log });
  console.log(`CJK and emoji fonts in ${dir}`);
}
