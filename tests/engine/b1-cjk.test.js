// CJK text without the optional CJK fonts is never silent: the PDF draws .notdef boxes (also when fonts are subset)
// and the model carries a warning that names the fix.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { render } from '../../src/engine/index.js';
import { createSubsetter } from '../../src/exporters/subset.js';
import { fontStore, report } from '../helpers.js';

const root = path.join(import.meta.dirname, '..', '..');
const subset = createSubsetter(() => fs.promises.readFile(path.join(root, 'public/harfbuzz-subset.wasm')));

describe('CJK without CJK fonts', () => {
  it('warns with the fix', async () => {
    const m = await render(report([{ type: 'textbox', x: 0, y: 0, w: 300, h: 20, value: 'Hello 日本語 한국어 中文' }]), { fontStore });
    expect(m.warnings.join('\n')).toMatch(/^Text in Japanese\/Chinese\/Korean needs the optional CJK fonts: npm i @reportwright\/fonts-cjk, then npx reportwright-fonts-cjk \(npm\); in the app, npm run fonts:cjk/m);
  });
  it('a subset font keeps the .notdef outline, so missing characters draw as boxes', async () => {
    await fontStore.load(['Inter-Regular']);
    const sub = await subset(fontStore.bytes.get('Inter-Regular'), [72, 0x65e5]);
    const notdef = fontkit.create(sub).getGlyph(0);
    expect(notdef.path.commands.length).toBeGreaterThan(0);
  });
});
