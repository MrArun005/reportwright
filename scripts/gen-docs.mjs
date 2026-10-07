// Generates docs/SCHEMA.md (from the report JSON Schema) and docs/FUNCTIONS.md (from the engine's function list).
//   node scripts/gen-docs.mjs [--check]     --check: exit 1 when a file on disk is out of date (CI)
import fs from 'node:fs';
import path from 'node:path';
import { REPORT_SCHEMA } from '../src/engine/schema/report.schema.js';
import { FUNCTION_NAMES } from '../src/engine/expr/evaluate.js';

const root = path.join(import.meta.dirname, '..');
const name = (r) => r.replace('#/$defs/', '');
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
function typeOf(s) {
  if (s['x-ts']) return s['x-ts'];
  if (s.$ref) return `[${name(s.$ref)}](#${name(s.$ref).toLowerCase()})`;
  if ('const' in s) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map(v => JSON.stringify(v)).join(' \\| ');
  if (s.anyOf) return s.anyOf.map(typeOf).join(' \\| ');
  if (s.type === 'array') return `${typeOf(s.items || {})}[]`;
  if (s.type === 'object' && s.properties) return `{ ${Object.keys(s.properties).join(', ')} }`;
  return s.type || 'any';
}
export function schemaMd() {
  const out = ['# Report schema reference', '',
    'GENERATED from `src/engine/schema/report.schema.js` by `node scripts/gen-docs.mjs`; the same schema is published as',
    '`@reportwright/engine/schema.json` and is what `packages/engine/report.d.ts` and `validate()` are made from.',
    'A value of type `Expr` may also be an expression: a string starting with `=` (`"=Sum(Fields.amount)"`).', ''];
  for (const [n, s] of Object.entries(REPORT_SCHEMA.$defs)) {
    if (s['x-ts-decl']) continue;
    out.push(`## ${n}`, '');
    if (s.description) out.push(s.description, '');
    const parts = s.allOf || [s];
    const base = parts.filter(p => p.$ref).map(p => name(p.$ref));
    if (base.length) out.push(`Also has every property of ${base.map(b => `[${b}](#${b.toLowerCase()})`).join(', ')}.`, '');
    const own = parts.find(p => p.properties);
    if (s.anyOf && !own) { out.push(`One of: ${s.anyOf.map(typeOf).join(', ')}.`, ''); continue; }
    if (!own) { out.push(`Type: ${typeOf(s)}`, ''); continue; }
    const req = new Set(own.required || []);
    out.push('| Property | Type | Required | Description |', '|---|---|---|---|');
    for (const [k, v] of Object.entries(own.properties)) out.push(`| \`${k}\` | ${cell(typeOf(v))} | ${req.has(k) ? 'yes' : ''} | ${cell(v.description || '')} |`);
    out.push('');
  }
  return out.join('\n');
}
export function functionsMd() {
  const names = [...new Set(FUNCTION_NAMES)];
  return ['# Expression functions', '',
    `GENERATED from the engine's function list (\`FUNCTION_NAMES\` in \`src/engine/expr/evaluate.js\`) by \`node scripts/gen-docs.mjs\`: ${names.length} functions.`,
    'Expressions are SSRS/VB style: `=Sum(Fields.amount)`, `=IIF(Fields.qty > 10, "bulk", "single")`, `=Format(Fields.d, "dd MMM yyyy")`.',
    'Aggregates take an optional scope: `=Sum(Fields.amount, "Orders")` (a data set, group or table name).', '',
    ...names.sort((a, b) => a.localeCompare(b)).map(n => `- \`${n}()\``), ''].join('\n');
}
const FILES = { 'docs/SCHEMA.md': schemaMd, 'docs/FUNCTIONS.md': functionsMd };
if (import.meta.url === `file://${process.argv[1]}`) {
  let stale = false;
  for (const [f, gen] of Object.entries(FILES)) {
    const p = path.join(root, f), text = gen();
    if (process.argv.includes('--check')) { if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) { console.error(`${f} is out of date: node scripts/gen-docs.mjs`); stale = true; } }
    else { fs.writeFileSync(p, text); console.log(`wrote ${f}`); }
  }
  if (stale) process.exit(1);
}
