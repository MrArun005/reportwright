// create-reportwright: copies a template (built from the repository's examples/ by scripts/build-packages.mjs) into a
// new folder, names the app and pins @reportwright/* to this package's version (all packages share one version).
import fs from 'node:fs';
import path from 'node:path';

export const TEMPLATES = ['node', 'react', 'vue', 'svelte', 'angular'];
export const DESCRIPTIONS = {
  node: 'a Node script that renders the sample report to PDF and Excel',
  react: 'React + Vite with the viewer and the sample report',
  vue: 'Vue 3 + Vite with the viewer and the sample report',
  svelte: 'Svelte + Vite with the viewer and the sample report',
  angular: 'Angular (JIT) + Vite with the viewer and the sample report',
};
export const USAGE = `Usage: npm create reportwright@latest [dir] -- [--template ${TEMPLATES.join('|')}] [--yes]`;

/** argv (without node and the script) to { dir, template, yes, help }. Throws on an unknown flag or template. */
export function parseArgs(argv) {
  const o = { dir: undefined, template: undefined, yes: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--template' || a === '-t') o.template = argv[++i] ?? '';
    else if (a.startsWith('--template=')) o.template = a.slice(11);
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}\n${USAGE}`);
    else if (o.dir === undefined) o.dir = a;
    else throw new Error(`one folder only (got ${o.dir} and ${a})\n${USAGE}`);
  }
  if (o.template !== undefined && !TEMPLATES.includes(o.template)) throw new Error(`unknown template "${o.template}": one of ${TEMPLATES.join(', ')}`);
  return o;
}

/** A template from a prompt answer: its number (1-based) or name; empty means the default (node). */
export function pickTemplate(answer) {
  const a = String(answer ?? '').trim().toLowerCase();
  if (!a) return TEMPLATES[0];
  if (/^\d+$/.test(a)) return TEMPLATES[Number(a) - 1];
  return TEMPLATES.includes(a) ? a : undefined;
}

/** An npm package name from a folder name. */
export const appName = (dir) => path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9._~-]+/g, '-').replace(/^[._-]+/, '') || 'reportwright-app';

/** The template's package.json with the app's name and @reportwright/* pinned to version. */
export function rewritePackageJson(pkg, name, version) {
  const out = { ...pkg, name };
  for (const k of ['dependencies', 'devDependencies']) {
    if (!pkg[k]) continue;
    out[k] = Object.fromEntries(Object.entries(pkg[k]).map(([n, v]) => [n, n.startsWith('@reportwright/') ? version : v]));
  }
  return out;
}

/** True when dir is missing or empty (a lone .git is allowed). */
export const isEmptyDir = (dir) => !fs.existsSync(dir) || fs.readdirSync(dir).every(f => f === '.git');

/** Copies templatesDir/<template> to dir. Throws when dir has files. */
export function create({ dir, template, version, templatesDir }) {
  if (!isEmptyDir(dir)) throw new Error(`${dir} is not empty: pick a new folder`);
  fs.cpSync(path.join(templatesDir, template), dir, { recursive: true });
  const f = path.join(dir, 'package.json');
  fs.writeFileSync(f, JSON.stringify(rewritePackageJson(JSON.parse(fs.readFileSync(f, 'utf8')), appName(dir), version), null, 2) + '\n');
}

export const nextSteps = (dir, template) => `\nDone. Next:\n  cd ${dir}\n  npm i\n  ${template === 'node' ? 'npm start        # writes orders.pdf and orders.xlsx' : 'npm run dev      # opens the viewer with the sample report'}\n`;
