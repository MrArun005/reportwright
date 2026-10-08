// defaultFontStore({ fontsUrl }) reads the fonts from that folder (a URL or a path), in Node and in a bundled browser app:
// no import.meta.resolve needed. A missing file is an error, not an empty font.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { defaultFontStore } from '../../packages/engine/entry.js';
import { ALL_FONT_KEYS } from '../../src/engine/text/fonts.js';
import { fontFile } from '../../src/engine/text/fonts.js';

const key = ALL_FONT_KEYS[0];
let dir, server, base;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-fonts-'));
  fs.mkdirSync(path.dirname(path.join(dir, fontFile(key))), { recursive: true });
  fs.writeFileSync(path.join(dir, fontFile(key)), 'FAKE-FONT');
  server = http.createServer((req, res) => {
    const f = path.join(dir, decodeURIComponent(req.url.replace(/^\/fonts\//, '')));
    if (req.url.startsWith('/fonts/') && fs.existsSync(f)) { res.end(fs.readFileSync(f)); return; }
    res.statusCode = 404; res.end('<html>not found</html>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/fonts/`;
});
afterAll(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('defaultFontStore with fontsUrl', () => {
  it('reads a font from a folder URL (http)', async () => {
    const bytes = await defaultFontStore({ fontsUrl: base }).loader(key);
    expect(Buffer.from(bytes).toString()).toBe('FAKE-FONT');
  });

  it('reads a font from a folder path (Node)', async () => {
    const bytes = await defaultFontStore({ fontsUrl: dir }).loader(key);
    expect(Buffer.from(bytes).toString()).toBe('FAKE-FONT');
  });

  it('a 404 is an error, not the 404 page used as font bytes', async () => {
    await expect(defaultFontStore({ fontsUrl: `${base}nowhere/` }).loader(key)).rejects.toThrow(/404/);
  });
});
