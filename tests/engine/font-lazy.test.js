// A font face is loaded only when a report uses it; one that fails to load falls back to a bundled face with a warning
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../../src/engine/index.js';
import { FontStore, fontFile } from '../../src/engine/text/fonts.js';
import { texts, report } from '../helpers.js';

const bundled = (k) => fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'fonts', fontFile(k)));
const noItalic = () => new FontStore(async (k) => { if (/Italic/.test(k)) throw new Error('disk gone'); return bundled(k); });

describe('font loading', () => {
  it('a plain-text report renders when the Italic face fails to load', async () => {
    const page = await render(report([{ type: 'textbox', x: 0, y: 0, w: 200, h: 20, value: 'Plain text' }]), { fontStore: noItalic() });
    expect(texts(page.pages[0])).toContain('Plain text');
  });

  it('an italic run with a failed face renders in a fallback face and warns once per failed face', async () => {
    const items = [{ type: 'textbox', x: 0, y: 0, w: 200, h: 20, value: 'Slanted', style: { fontStyle: 'italic' } }];
    const page = await render(report(items), { fontStore: noItalic() });
    expect(texts(page.pages[0])).toContain('Slanted');
    // each failed italic face warns once
    expect(page.warnings.filter(w => /Italic/.test(w))).toEqual([
      'The font "Inter-Italic" did not load, so its text is drawn in a bundled face instead.',
      'The font "Inter-BoldItalic" did not load, so its text is drawn in a bundled face instead.',
    ]);
  });

  it('a bold report lays out in one pass: the faces its styles name load before layout', async () => {
    const items = [{ type: 'textbox', x: 0, y: 0, w: 200, h: 20, value: 'Bold total', style: { fontWeight: 'bold' } }];
    const stats = {};
    const page = await render(report(items), { fontStore: new FontStore(async (k) => bundled(k)), stats });
    expect(texts(page.pages[0])).toContain('Bold total');
    expect(stats.layoutPasses).toBe(1);
  });
});
