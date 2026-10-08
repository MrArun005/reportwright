// N39: a font the engine does not have is never swapped silently. The render warns once per name, and monospace
// names get the shipped monospace face (JetBrains Mono), so aligned columns stay aligned.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { resolveFontKey } from '../../src/engine/text/fonts.js';
import { fontStore, report } from '../helpers.js';

const box = (fontFamily, value = 'Hello', y = 0) => ({ type: 'textbox', x: 0, y, w: 300, h: 20, value, style: { fontFamily } });
const fontsOf = (model) => model.pages[0].items.filter(i => i.t === 'text').map(i => i.font);

describe('unknown fonts (N39)', () => {
  it('warns once per unknown name and uses Inter', async () => {
    const m = await render(report([box('NoSuchFont'), box('NoSuchFont', 'Again', 30)]), { fontStore });
    expect(m.warnings.filter(w => w.includes('NoSuchFont'))).toEqual(['Font "NoSuchFont" is not available; using Inter.']);
    expect(fontsOf(m)).toEqual(['Inter-Regular', 'Inter-Regular']);
  });

  it('monospace names use JetBrains Mono, with a warning', async () => {
    const m = await render(report([box('Consolas'), box('Menlo', 'x', 30)]), { fontStore });
    expect(m.warnings).toContain('Font "Consolas" is not available; using JetBrains Mono.');
    expect(m.warnings).toContain('Font "Menlo" is not available; using JetBrains Mono.');
    expect(fontsOf(m)).toEqual(['JetBrainsMono-Regular', 'JetBrainsMono-Regular']);
  });

  it('a font named in rich text markup warns too', async () => {
    const item = { type: 'richtext', x: 0, y: 0, w: 300, h: 40, value: '<span style="font-family: Zorblax">odd</span>' };
    const m = await render(report([item]), { fontStore });
    expect(m.warnings).toContain('Font "Zorblax" is not available; using Inter.');
  });

  it('bundled fonts, a CSS list with a known font and generic names do not warn', async () => {
    const m = await render(report([box('Inter'), box('JetBrains Mono', 'x', 30), box('NoSuchFont, Inter', 'y', 60), box('sans-serif', 'z', 90), box('monospace', 'm', 120)]), { fontStore });
    expect(m.warnings.filter(w => w.startsWith('Font '))).toEqual([]);
    expect(fontsOf(m)).toEqual(['Inter-Regular', 'JetBrainsMono-Regular', 'Inter-Regular', 'Inter-Regular', 'JetBrainsMono-Regular']);
  });

  it('family names match without regard to case', () => {
    expect(resolveFontKey('jetbrains mono', 'bold')).toBe('JetBrainsMono-Bold');
  });
});
