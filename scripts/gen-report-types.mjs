// Generates packages/engine/report.d.ts from the report JSON Schema (src/engine/schema/report.schema.js), so the
// published types and validate() read one source. --check: exit 1 when the file on disk differs (CI).
import fs from 'node:fs';
import path from 'node:path';
import { REPORT_SCHEMA } from '../src/engine/schema/report.schema.js';

const root = path.join(import.meta.dirname, '..');
const OUT = path.join(root, 'packages/engine/report.d.ts');
const name = (ref) => ref.replace('#/$defs/', '');
const paren = (t) => (/[|&]/.test(t) ? `(${t})` : t);
const doc = (s, pad) => (s.description ? `${pad}/** ${s.description} */\n` : '');

/** The TypeScript type of a schema. */
function ts(s, pad = '') {
  if (s['x-ts']) return s['x-ts'];
  if (s.$ref) return name(s.$ref);
  if ('const' in s) return JSON.stringify(s.const).replace(/"/g, "'");
  if (s.enum) return s.enum.map(v => JSON.stringify(v).replace(/"/g, "'")).join(' | ');
  if (s.anyOf || s.oneOf) return (s.anyOf || s.oneOf).map(x => ts(x, pad)).join(' | ');
  if (s.allOf) return s.allOf.map(x => paren(ts(x, pad))).join(' & ');
  switch (s.type) {
    case 'string': return 'string';
    case 'number': case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'array': return `${paren(ts(s.items || {}, pad))}[]`;
    case 'object': return s.properties ? body(s, pad) : 'Record<string, unknown>';
    default: return 'unknown';
  }
}
/** { a?: T; ... } of an object schema. */
function body(s, pad) {
  const req = new Set(s.required || []);
  const inner = pad + '  ';
  const lines = Object.entries(s.properties).map(([k, v]) => `${doc(v, inner)}${inner}${/^[\w$]+$/.test(k) ? k : JSON.stringify(k)}${req.has(k) ? '' : '?'}: ${ts(v, inner)};`);
  if (s.additionalProperties === true) lines.push(`${inner}[key: string]: unknown;`);
  return `{\n${lines.join('\n')}\n${pad}}`;
}

export function generate(schema = REPORT_SCHEMA) {
  const out = ['// Types for a ReportWright report definition (pagewright/report@1), the JSON that render() takes.',
    '// GENERATED from src/engine/schema/report.schema.js by scripts/gen-report-types.mjs: do not edit by hand.',
    '// The same schema is published as @reportwright/engine/schema.json, and validate() checks against it.',
    '// Any value marked Expr may be a literal or an expression string starting with "=" (e.g. "=Fields.amount").', ''];
  for (const [n, s] of Object.entries(schema.$defs)) {
    const ex = (s.examples || []).map(e => `\n * @example\n * ${JSON.stringify(e)}`).join('');
    const head = s.description || ex ? `/**${s.description ? ` ${s.description}` : ''}${ex}${ex ? '\n' : ''} */\n` : '';
    if (s['x-ts-decl']) { out.push(head + s['x-ts-decl']); continue; }
    const exp = s['x-internal'] ? '' : 'export ';
    const parts = s.allOf || [s];
    const base = parts.filter(p => p.$ref).map(p => name(p.$ref));
    const own = parts.find(p => p.type === 'object' && p.properties);
    // a property the item redeclares (Sparkline's style is a chart kind, ItemBase's is a Style) is left out of the base
    const keysOf = (d) => (d.allOf || [d]).flatMap(p => Object.keys(p.properties || {}));
    const clash = own ? Object.keys(own.properties).filter(k => base.some(b => keysOf(schema.$defs[b]).includes(k))) : [];
    const ext = base.map(b => (clash.length ? `Omit<${b}, ${clash.map(k => `'${k}'`).join(' | ')}>` : b));
    if (own && !s.anyOf) out.push(`${head}${exp}interface ${n}${ext.length ? ` extends ${ext.join(', ')}` : ''} ${body(own, '')}`);
    else out.push(`${head}${exp}type ${n} = ${ts(s)};`);
  }
  return out.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = generate();
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(OUT, 'utf8') !== text) { console.error('packages/engine/report.d.ts is out of date: node scripts/gen-report-types.mjs'); process.exit(1); }
    console.log('report.d.ts matches the schema');
  } else { fs.writeFileSync(OUT, text); console.log(`wrote ${path.relative(root, OUT)}`); }
}
