// Optional CJK/emoji fonts: a page served by a server without them never asks for their files (no 404 in the console);
// their text falls back. GET /fonts/optional.json says which are installed (npm run fonts:cjk).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { setOptionalFonts, optionalMissing } from '../../src/engine/text/fonts.js';
import { installedOptionalFonts } from '../../src/server/fonts.js';
import fs from 'node:fs';

afterEach(() => { setOptionalFonts(null); vi.unstubAllGlobals(); });

describe('optional fonts', () => {
  it('an optional font counts as missing only when the server has said it lacks it', () => {
    setOptionalFonts([]);
    expect(['Inter-Regular', 'NotoEmoji', 'NotoSansJP'].map(optionalMissing)).toEqual([false, true, true]);
    setOptionalFonts(['NotoEmoji']);
    expect(['NotoEmoji', 'NotoSansJP'].map(optionalMissing)).toEqual([false, true]);
    setOptionalFonts(null); // not known (standalone, the server's own renders): every font may be asked for
    expect(optionalMissing('NotoEmoji')).toBe(false);
  });

  it('the server lists the optional fonts it has on disk', () => {
    const want = ['NotoSansJP', 'NotoSansKR', 'NotoSansSC', 'NotoEmoji'].filter(k => fs.existsSync(`public/fonts/cjk/${k}.ttf`));
    expect(installedOptionalFonts()).toEqual(want);
  });

  it('a page whose server has no optional fonts requests none of their files', async () => {
    const asked = [];
    vi.stubGlobal('window', { location: { origin: 'http://pw.test' } });
    vi.stubGlobal('fetch', async (u) => {
      asked.push(String(u));
      if (String(u).endsWith('/fonts/optional.json')) return new Response('[]', { headers: { 'content-type': 'application/json' } });
      if (String(u).includes('/api/fonts')) return Response.json([]);
      return new Response(fs.readFileSync(`public/fonts/${String(u).split('/fonts/')[1]}`));
    });
    vi.resetModules();
    const { loadFontStore, customFonts } = await import('../../src/viewer/engineClient.js');
    await customFonts();
    const store = await loadFontStore();
    await store.load(['Inter-Regular', 'NotoEmoji', 'NotoSansJP']);
    expect(store.failed.has('NotoEmoji')).toBe(true); // falls back
    expect(asked.filter(u => /cjk\//.test(u))).toEqual([]); // never requested: no 404
    expect(asked.some(u => u.endsWith('/fonts/optional.json'))).toBe(true);
  });
});
