// B5 item 11: @pagewrightjs/fonts-cjk downloads the fonts on demand, pinned and hash-checked.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchCjkFonts, CJK_FONTS } from '../../packages/fonts-cjk/src/index.mjs';

describe('@pagewrightjs/fonts-cjk', () => {
  it('pins every file to a commit and a SHA-256', () => {
    for (const [, name, hash] of CJK_FONTS) { expect(name).toMatch(/\.(ttf|txt)$/); expect(hash).toMatch(/^[0-9a-f]{64}$/); }
    expect(fs.readFileSync('packages/fonts-cjk/src/index.mjs', 'utf8')).toMatch(/const COMMIT = '[0-9a-f]{40}'/);
  });
  it('refuses a download that does not match its hash and writes nothing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cjk-'));
    const urls = [];
    const fake = async (u) => { urls.push(u); return new Response('not a font'); };
    await expect(fetchCjkFonts(dir, { fetch: fake })).rejects.toThrow(/does not match its SHA-256/);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(urls[0]).toMatch(/^https:\/\/github\.com\/google\/fonts\/raw\/[0-9a-f]{40}\/ofl\//);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
