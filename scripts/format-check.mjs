// Checks Prettier formatting of the files changed against main (FORMAT_BASE overrides it), not the whole repository:
// the engine source predates the Prettier config, and a whole-repo reformat would bury its history.
// ponytail: prettier runs through npx at a pinned version, so it is not a dependency; add it if this runs often offline.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const base = process.env.FORMAT_BASE || 'main';
const git = (/** @type {string[]} */ args) =>
  execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
const mergeBase = git(['merge-base', base, 'HEAD'])[0];
const files = [
  ...new Set([
    ...git(['diff', '--name-only', '--diff-filter=ACMR', mergeBase]),
    ...git(['ls-files', '--others', '--exclude-standard']),
  ]),
].filter((f) => /\.(m?js|cjs|jsx|ts|tsx|json|css|ya?ml)$/.test(f) && fs.existsSync(f));
if (!files.length) {
  console.log(`format:check: no changed files against ${base}`);
  process.exit(0);
}
try {
  execFileSync('npx', ['--yes', 'prettier@3.6.2', '--check', '--ignore-unknown', ...files], { stdio: 'inherit' });
} catch {
  console.error('format:check: run `npx prettier@3.6.2 --write <file>` on the files above');
  process.exit(1);
}
