// N10 part 2: @reportwright/fonts-cjk downloads into a cache folder that survives upgrading the package
// (REPORTWRIGHT_FONTS_DIR, else $XDG_CACHE_HOME/reportwright/fonts-cjk, else ~/.cache/…, %LOCALAPPDATA% on Windows),
// and still finds fonts an older version put in its own fonts/ folder.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheDir, fontPath, fetchCjkFonts, LEGACY_DIR } from '../../packages/fonts-cjk/src/index.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cjk-cache-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('@reportwright/fonts-cjk cache folder (N10)', () => {
  it('REPORTWRIGHT_FONTS_DIR, then XDG_CACHE_HOME, then ~/.cache; %LOCALAPPDATA% on Windows', () => {
    expect(cacheDir({ REPORTWRIGHT_FONTS_DIR: '/srv/fonts', XDG_CACHE_HOME: '/x' }, 'linux', '/home/a')).toBe(path.resolve('/srv/fonts'));
    expect(cacheDir({ XDG_CACHE_HOME: '/x' }, 'linux', '/home/a')).toBe(path.join('/x', 'reportwright', 'fonts-cjk'));
    expect(cacheDir({}, 'darwin', '/Users/a')).toBe(path.join('/Users/a', '.cache', 'reportwright', 'fonts-cjk'));
    expect(cacheDir({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a')).toBe(path.join('C:\\Users\\a\\AppData\\Local', 'reportwright', 'fonts-cjk'));
  });
  it('is not inside the package (an upgrade replaces the package folder)', () => {
    expect(cacheDir({}, 'linux', '/home/a').startsWith(path.resolve(LEGACY_DIR, '..'))).toBe(false);
  });
  it('fetchCjkFonts writes to the cache folder by default', async () => {
    const dir = path.join(tmp, 'cache');
    process.env.REPORTWRIGHT_FONTS_DIR = dir;
    try {
      await expect(fetchCjkFonts(undefined, { fetch: async () => new Response('not a font') })).rejects.toThrow(/does not match its SHA-256/);
      expect(fs.existsSync(dir)).toBe(true); // created there (nothing written: the hash did not match)
    } finally { delete process.env.REPORTWRIGHT_FONTS_DIR; }
  });
  it('fontPath finds a font in the cache, else in the old package folder', () => {
    const cache = path.join(tmp, 'c'), old = path.join(tmp, 'old');
    fs.mkdirSync(cache); fs.mkdirSync(old);
    fs.writeFileSync(path.join(old, 'NotoSansJP.ttf'), 'old');
    expect(fontPath('NotoSansJP.ttf', [cache, old])).toBe(path.join(old, 'NotoSansJP.ttf'));
    fs.writeFileSync(path.join(cache, 'NotoSansJP.ttf'), 'new');
    expect(fontPath('NotoSansJP.ttf', [cache, old])).toBe(path.join(cache, 'NotoSansJP.ttf'));
    expect(fontPath('NotoSansKR.ttf', [cache, old])).toBeUndefined();
  });
  it('the engine looks in the same cache folder before the package folder', () => {
    const entry = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'packages', 'engine', 'entry.js'), 'utf8');
    expect(entry).toMatch(/REPORTWRIGHT_FONTS_DIR/);
    expect(entry).toMatch(/XDG_CACHE_HOME/);
    expect(entry).toMatch(/LOCALAPPDATA/);
  });
});
