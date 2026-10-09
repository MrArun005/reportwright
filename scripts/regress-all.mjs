// Regression across every report × 7 formats, through two running servers (an old build and a new one), so a broken
// total cannot hide behind a speed gain. Compares, per report and format: the HTTP status, the page count
// (x-reportwright-pages; not for csv, which has no pages), and for csv the row count, every numeric column's sum and the
// text itself (a leading BOM aside); for xlsx every sheet's cells (values, types, formulas; not style numbers). A streamed
// answer has no page count to compare.
//   BASE_OLD=http://localhost:3400 BASE_NEW=http://localhost:3300 PW_ADMIN_EMAIL=… PW_ADMIN_PASSWORD=… node scripts/regress-all.mjs
// Both servers need accounts on (PW_AUTH=users) with that admin; the reports in reports/ (not e2e-*) are saved to both.
// Exit code 1 when anything differs. ONLY=<id,id> limits the reports.
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

/** An xlsx's cells, sheet by sheet: reference, type, formula and value, without style indexes (they number styles in
 *  the order first used; 0.10.0 gives the plain style index 0, so an empty plain cell is no longer written at all). */
function xlsxCells(bytes) {
  try {
    const f = unzipSync(bytes);
    return Object.keys(f).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort().map(k => strFromU8(f[k]).replace(/ s="\d+"/g, '').replace(/<c r="[A-Z]+\d+"\/>/g, '').match(/<c [^>]*?(\/>|>.*?<\/c>)/g)?.join('') || '').join('|');
  } catch { return 'unreadable'; }
}

const OLD = process.env.BASE_OLD, NEW = process.env.BASE_NEW;
if (!OLD || !NEW) { console.error('Set BASE_OLD and BASE_NEW'); process.exit(2); }
const FORMATS = ['pdf', 'xlsx', 'docx', 'pptx', 'html', 'csv', 'json'];
const dir = path.join(import.meta.dirname, '..', 'reports');
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const ids = fs.readdirSync(dir).filter(f => f.endsWith('.pw.json') && !f.startsWith('e2e-')).map(f => f.replace(/\.pw\.json$/, '')).filter(id => !only || only.has(id)).sort();

async function session(base) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.PW_ADMIN_EMAIL || 'admin@e2e.test', password: process.env.PW_ADMIN_PASSWORD || 'e2e admin password' }) });
  if (!r.ok) throw new Error(`${base}: sign-in ${r.status}`);
  return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}

/** CSV → { rows, sums: { column: sum } } (numeric columns only; quoted fields with commas handled). */
function csvFacts(text) {
  const lines = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); lines.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); lines.push(row); }
  const [head = [], ...body] = lines.filter(l => l.some(c => c !== ''));
  const sums = {};
  head.forEach((h, k) => {
    const vals = body.map(r => r[k]).filter(v => v !== undefined && v !== '');
    if (vals.length && vals.every(v => /^-?\d+(\.\d+)?$/.test(v))) sums[h.replace(/^﻿/, '') || `#${k}`] = Math.round(vals.reduce((s, v) => s + Number(v), 0) * 100) / 100;
  });
  return { rows: body.length, sums };
}

async function facts(base, cookie, id, format) {
  const t = Date.now();
  const r = await fetch(`${base}/api/reports/${encodeURIComponent(id)}/pdf?format=${format}`, { headers: { cookie } });
  const body = Buffer.from(await r.arrayBuffer());
  const out = { status: r.status, ms: Date.now() - t, bytes: body.length };
  // a streamed answer (no content-length: the data CSV, Excel) has no page model: its page count is not compared
  out.streamed = r.ok && !r.headers.get('content-length');
  if (r.ok && format !== 'csv') out.pages = Number(r.headers.get('x-reportwright-pages'));
  if (r.ok && format === 'xlsx') out.cells = xlsxCells(new Uint8Array(body)); // the workbook's cells instead
  if (r.ok && format === 'csv') Object.assign(out, csvFacts(body.toString('utf8')), { text: body.toString('utf8').replace(/^\uFEFF/, '') }); // the bytes too (a BOM aside)
  if (r.ok && format === 'json') out.pages = JSON.parse(body.toString('utf8')).pages?.length;
  return out;
}

const cookies = { [OLD]: await session(OLD), [NEW]: await session(NEW) };
for (const base of [OLD, NEW]) for (const id of ids) {
  const def = fs.readFileSync(path.join(dir, `${id}.pw.json`), 'utf8');
  const r = await fetch(`${base}/api/reports/${encodeURIComponent(id)}`, { method: 'PUT', headers: { cookie: cookies[base], origin: base, 'content-type': 'application/json', 'if-match': '*' }, body: def });
  if (!r.ok) console.warn(`${base} ${id}: save ${r.status}`);
}
let diffs = 0, checked = 0;
for (const id of ids) for (const f of FORMATS) {
  const [a, b] = [await facts(OLD, cookies[OLD], id, f), await facts(NEW, cookies[NEW], id, f)];
  checked++;
  const bad = [];
  if (a.status !== b.status) bad.push(`status ${a.status} → ${b.status}`);
  if (a.pages !== b.pages && !(f === 'xlsx' && (a.streamed || b.streamed))) bad.push(`pages ${a.pages} → ${b.pages}`);
  if (a.cells !== b.cells) bad.push('the Excel cells differ');
  if (a.rows !== b.rows) bad.push(`rows ${a.rows} → ${b.rows}`);
  if (JSON.stringify(a.sums) !== JSON.stringify(b.sums)) bad.push(`sums ${JSON.stringify(a.sums)} → ${JSON.stringify(b.sums)}`);
  if (a.text !== b.text) bad.push('the CSV text differs');
  if (bad.length) { diffs++; console.log(`DIFF ${id} ${f}: ${bad.join('; ')}`); }
  else console.log(`ok   ${id} ${f} (${a.status}${a.pages != null ? `, ${a.pages} pages` : ''}${a.rows != null ? `, ${a.rows} rows` : ''}; ${a.ms} → ${b.ms} ms, ${a.bytes} → ${b.bytes} B)`);
}
console.log(`${checked} checked, ${diffs} differ`);
process.exit(diffs ? 1 : 0);
