// The CLI's compile cache never lives in a shared or world-writable folder (code-cache poisoning).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileCacheDir } from '../../scripts/compile-cache-dir.mjs';

describe('CLI compile cache folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cc-'));
  it('is a private (0700) folder under the user cache folder', () => {
    const dir = compileCacheDir({ XDG_CACHE_HOME: tmp }, tmp);
    expect(dir).toBe(path.join(tmp, 'reportwright', 'compile-cache'));
    if (process.platform !== 'win32') expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });
  it('refuses a folder others can read or write, a symlink, a relative base, or an opt-out', () => {
    if (process.platform !== 'win32') {
      const open = path.join(tmp, 'open');
      fs.mkdirSync(path.join(open, 'reportwright', 'compile-cache'), { recursive: true });
      fs.chmodSync(path.join(open, 'reportwright', 'compile-cache'), 0o777);
      expect(compileCacheDir({ XDG_CACHE_HOME: open }, tmp)).toBeUndefined();
      const link = path.join(tmp, 'link');
      fs.mkdirSync(path.join(link, 'reportwright'), { recursive: true });
      fs.symlinkSync(os.tmpdir(), path.join(link, 'reportwright', 'compile-cache'));
      expect(compileCacheDir({ XDG_CACHE_HOME: link }, tmp)).toBeUndefined();
    }
    expect(compileCacheDir({ XDG_CACHE_HOME: 'relative/dir' }, tmp)).toBeUndefined();
    expect(compileCacheDir({ XDG_CACHE_HOME: tmp, PW_NO_COMPILE_CACHE: '1' }, tmp)).toBeUndefined();
  });
  it('the built pw.mjs uses it and never the default (temp folder) cache', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, '../../scripts/build-packages.mjs'), 'utf8');
    expect(src).toMatch(/enableCompileCache\?\.\(dir\)/);
    expect(src).not.toMatch(/enableCompileCache\?\.\(\)/);
    const built = path.join(import.meta.dirname, '../../packages/cli/dist/pw.mjs');
    if (fs.existsSync(built)) { const b = fs.readFileSync(built, 'utf8'); expect(b).toMatch(/enableCompileCache\?\.\(dir\)/); expect(b).not.toMatch(/enableCompileCache\?\.\(\)/); }
  });
});
