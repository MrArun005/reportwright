// The CLI's compile cache folder (build-packages.mjs inlines this file into packages/cli/dist/pw.mjs). Never a shared
// or world-writable place such as the OS temp folder, where another user could plant cached code: a folder only this
// user owns and can read (0700), under $XDG_CACHE_HOME or ~/.cache (or %LOCALAPPDATA%). Anything else: no cache.
// Node checks each entry against a hash of the module's source and its own version before using it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @param {Record<string, string|undefined>} [env] @returns {string|undefined} */
export function compileCacheDir(env = process.env) {
  try {
    if (env.PW_NO_COMPILE_CACHE) return undefined;
    const base = env.XDG_CACHE_HOME || (process.platform === 'win32' && env.LOCALAPPDATA) || path.join(os.homedir(), '.cache');
    if (!path.isAbsolute(base)) return undefined;
    const dir = path.join(base, 'reportwright', 'compile-cache');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return undefined;
    if (process.platform !== 'win32' && (st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0)) return undefined; // not ours alone
    return dir;
  } catch { return undefined; }
}
