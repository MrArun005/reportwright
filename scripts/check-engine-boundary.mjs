// Fails when src/engine (or src/importers) imports React, Next or Node modules, or touches the DOM.
// The engine and the importers must run in a Worker, in the browser and in Node.
import fs from 'node:fs';
import path from 'node:path';
const roots = ['engine', 'importers'].map(d => path.join(import.meta.dirname, '..', 'src', d));
const bad = [/from ['"](react|react-dom|next|node:[^'"]+)(\/[^'"]*)?['"]/, /\b(document|window|localStorage|navigator)\./, /from ['"]\.\.\/\.\.\/(designer|viewer)/];
const problems = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const f = path.join(d, e.name);
  if (e.isDirectory()) return walk(f);
  if (!/\.m?js$/.test(e.name)) return;
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    for (const re of bad) if (re.test(line)) problems.push(`${path.relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`);
  });
});
for (const r of roots) if (fs.existsSync(r)) walk(r);
if (problems.length) { console.error('Engine boundary broken:\n' + problems.join('\n')); process.exit(1); }
console.log('Engine boundary OK: no React, Next, Node modules or DOM in src/engine and src/importers');
