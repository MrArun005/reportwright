// CJK text without the optional CJK fonts is never silent: the PDF draws .notdef boxes (also when fonts are subset)
// and the model carries a warning that names the fix.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { render, FontStore } from '../../src/engine/index.js';
import { fontFile, OPTIONAL_KEYS } from '../../src/engine/text/fonts.js';
import { createSubsetter } from '../../src/exporters/subset.js';
import { fontStore, report } from '../helpers.js';

const root = path.join(import.meta.dirname, '..', '..');
const subset = createSubsetter(() => fs.promises.readFile(path.join(root, 'public/harfbuzz-subset.wasm')));
// a store that never has the optional CJK faces, installed or not: the warning must not depend on public/fonts/cjk
const noCjkFonts = new FontStore(async (k) => {
  if (OPTIONAL_KEYS.includes(k)) throw new Error(`${k} is not installed`);
  return fs.readFileSync(path.join(root, 'public', 'fonts', fontFile(k)));
});

describe('CJK without CJK fonts', () => {
  it('warns with the fix', async () => {
    const m = await render(report([{ type: 'textbox', x: 0, y: 0, w: 300, h: 20, value: 'Hello 日本語 한국어 中文' }]), { fontStore: noCjkFonts });
    expect(m.warnings.join('\n')).toMatch(/^Text in Japanese\/Chinese\/Korean needs the optional CJK fonts: npm i @reportwright\/fonts-cjk, then npx reportwright-fonts-cjk \(npm\); in the app, npm run fonts:cjk/m);
  });
  it('a subset font keeps the .notdef outline, so missing characters draw as boxes', async () => {
    await fontStore.load(['Inter-Regular']);
    const sub = await subset(fontStore.bytes.get('Inter-Regular'), [72, 0x65e5]);
    const notdef = fontkit.create(sub).getGlyph(0);
    expect(notdef.path.commands.length).toBeGreaterThan(0);
  });
});
