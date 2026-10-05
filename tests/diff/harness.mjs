// Differential testing: the Pagewright side of a case, text extraction and the cell-by-cell comparison.
// Used by scripts/diff-engines.mjs (which also runs the real engines) and tests/diff/diff.test.js (which replays the
// recorded ground truth, so it needs no Java).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { render, FontStore } from '../../src/engine/index.js';
import { fontFile } from '../../src/engine/text/fonts.js';
import { importJrxml } from '../../src/importers/jrxml.js';
import { importBirt } from '../../src/importers/birt.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
export const TRUTH_DIR = path.join(import.meta.dirname, 'truth');
export const fontStore = () => new FontStore((k) => fs.readFileSync(path.join(ROOT, 'public', 'fonts', fontFile(k))));

/** The imported definition with the case's rows and locale, rendered in UTC. */
export async function pagewright(c, store) {
  const imp = (c.engine === 'jrxml' ? importJrxml : importBirt)(c.xml, { name: c.id });
  const def = imp.definition;
  def.locale = c.locale;
  def.timeZone = 'UTC';
  for (const s of def.dataSources || []) if (s.type === 'json') s.data = c.rows;
  for (const ds of def.dataSets || []) for (const f of ds.fields || []) if (f.name === 'd' && !f.type) f.type = 'date';
  const model = await render(def, { fontStore: store, timeZone: 'UTC' });
  return { model, warnings: [...imp.warnings, ...model.warnings], def };
}

/** Page model → lines per page: text pieces with the same baseline (±1.5pt) joined left to right. */
export function modelPages(model) {
  return model.pages.map((p) => {
    const frags = [];
    const add = (it) => {
      if (it.t === 'field') { (it.draw || []).forEach(add); return; }
      if (it.t !== 'text') return;
      for (const l of it.lines || []) frags.push({ x: l.x, y: l.y, text: l.text });
    };
    p.items.forEach(add);
    frags.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const f of frags) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.y - f.y) <= 1.5) last.frags.push(f); else rows.push({ y: f.y, frags: [f] });
    }
    return normalise(rows.map(r => r.frags.sort((a, b) => a.x - b.x).map(f => f.text).join('  ')));
  });
}

/** pdftotext -layout → lines per page */
export function pdfPages(file) {
  const out = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const pages = out.split('\f');
  if (pages.length && pages[pages.length - 1].trim() === '') pages.pop();
  return pages.map(p => normalise(p.split('\n')));
}

/** DiffJasper's print-text dump (y TAB x TAB text per element, \f between pages) → lines per page, grouped as modelPages does */
export function printPages(txt) {
  const pages = txt.split('\f');
  if (pages.length && pages[pages.length - 1].trim() === '') pages.pop();
  return pages.map((p) => {
    const frags = p.split('\n').filter(Boolean).map(l => { const [y, x, ...t] = l.split('\t'); return { y: Number(y), x: Number(x), text: t.join('\t') }; });
    frags.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const f of frags) { const last = rows[rows.length - 1]; if (last && Math.abs(last.y - f.y) <= 1.5) last.frags.push(f); else rows.push({ y: f.y, frags: [f] }); }
    return normalise(rows.map(r => r.frags.map(f => f.text).join('  ')));
  });
}

/** BIRT's HTML output → the labelled lines in document order (one table row each) */
export function htmlLines(html) {
  const dec = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
  const out = [];
  for (const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c => dec(c[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
    if (cells[0]?.startsWith('@')) out.push(normalise([cells.join('  ')])[0] || cells[0]);
  }
  return out;
}

/** PDF pages, with each labelled value replaced by the exact one from `exact` (the k-th occurrence of its label) */
export function withExactValues(pages, exact) {
  const byLabel = new Map();
  for (const l of exact) { const [lab, v] = cell(l); if (!byLabel.has(lab)) byLabel.set(lab, []); byLabel.get(lab).push(v); }
  const seen = new Map();
  return pages.map(lines => lines.map((l) => {
    const [lab, v] = cell(l);
    if (v === null) return l;
    const k = seen.get(lab) || 0; seen.set(lab, k + 1);
    const e = byLabel.get(lab)?.[k];
    return e === undefined ? l : normalise([`${lab} ${e}`])[0];
  }));
}

/** Whitespace only: runs of spaces (incl. no-break and thin spaces) become one; blank lines go. Signs, digits and
 *  separators are compared as they are. */
export function normalise(lines) {
  return lines.map(l => l.replace(/[\s    ]+/g, ' ').trim()).filter(Boolean);
}

/** A line "@label value" → [label, value]; a line without a label is its own label. */
const cell = (line) => { const m = /^(@\S+)(?: (.*))?$/.exec(line); return m ? [m[1], m[2] ?? ''] : [line, null]; };

/**
 * Cell by cell: the k-th occurrence of each label on each side. `pages` false means the same cells in the same
 * order but split over pages differently (or a different page count).
 * @param {string[][]} want @param {string[][]} got
 */
export function compare(want, got) {
  const flat = (pages) => pages.flatMap((lines, p) => lines.filter(l => l.startsWith('@')).map(l => [...cell(l), p]));
  const a = flat(want), b = flat(got);
  const key = (list) => { const seen = new Map(); return list.map(([l, v, p]) => { const k = (seen.get(l) || 0) + 1; seen.set(l, k); return { id: `${l}#${k}`, v, p }; }); };
  const ka = key(a), kb = new Map(key(b).map(x => [x.id, x]));
  const bad = [];
  let pagesOk = want.length === got.length;
  for (const x of ka) {
    const y = kb.get(x.id);
    if (!y) { bad.push({ cell: x.id, want: x.v, got: undefined }); continue; }
    if (y.v !== x.v) bad.push({ cell: x.id, want: x.v, got: y.v });
    if (y.p !== x.p) pagesOk = false;
    kb.delete(x.id);
  }
  for (const y of kb.values()) bad.push({ cell: y.id, want: undefined, got: y.v });
  return { ok: !bad.length && pagesOk, cells: ka.length, bad, pages: pagesOk };
}

export function readTruth(engine) {
  const f = path.join(TRUTH_DIR, `${engine}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
