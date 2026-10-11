// The CLI's compile cache folder (build-packages.mjs inlines this file into packages/cli/dist/pw.mjs). Never a shared
// or world-writable place such as the OS temp folder, where another user could plant cached code: a folder only this
// user owns and can read (0700), under $XDG_CACHE_HOME or ~/.cache (or %LOCALAPPDATA%), inside the home folder (or
// %LOCALAPPDATA%). Anything else: no cache.
// Node checks each entry against a hash of the module's source and its own version before using it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** p is root or inside it @param {string} root @param {string} p */
const inside = (root, p) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/**
 * @param {Record<string, string|undefined>} [env] @param {string} [home] the user's home folder (tests)
 * @returns {string|undefined}
 */
export function compileCacheDir(env = process.env, home = os.homedir()) {
  try {
    if (env.PW_NO_COMPILE_CACHE) return undefined;
    const base = env.XDG_CACHE_HOME || (process.platform === 'win32' && env.LOCALAPPDATA) || path.join(home, '.cache');
    if (!path.isAbsolute(base)) return undefined;
    // only under the home folder (or %LOCALAPPDATA%): a shared base such as /tmp could be swapped under us (TOCTOU)
    const roots = [home, process.platform === 'win32' ? env.LOCALAPPDATA : undefined].filter((r) => r && path.isAbsolute(r));
    if (!roots.some((r) => inside(/** @type {string} */ (r), path.resolve(base)))) return undefined;
    const dir = path.join(base, 'reportwright', 'compile-cache');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return undefined;
    // and still there once symlinks on the way are followed
    if (!roots.some((r) => inside(fs.realpathSync(/** @type {string} */ (r)), fs.realpathSync(dir)))) return undefined;
    if (process.platform !== 'win32' && (st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0)) return undefined; // not ours alone
    return dir;
  } catch { return undefined; }
}
