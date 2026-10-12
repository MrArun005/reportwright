// @ts-check
/**
 * pw import <folder>: every SSRS, JasperReports, BIRT and ActiveReports report in a folder becomes a .pw.json file in an
 * output folder that mirrors it, with a migration report (import-report.json and import-report.html).
 *
 * Node only (the file system); the importers themselves stay pure, which is why this lives in src/cli, outside the engine boundary. One file's failure never stops the batch.
 * The input is untrusted:
 *   - only files found by walking the input folder are ever read: a reference in a report (an image, a subreport, a
 *     style template, a shared data source) is looked up among them, never opened by its path, so "../" or an absolute
 *     path in a report cannot read outside the folder;
 *   - symbolic links are not followed out of the input folder (nor into folders: no loops); they are listed as refused;
 *   - every output path is checked to stay inside the output folder, and nothing is written through a symbolic link;
 *   - the number of files and their size are capped (maxFiles, maxBytes);
 *   - nothing from a report is executed (custom code and scriptlets are kept as text by the importers).
 * Re-runs never overwrite a file the user edited: outDir/.pw-import.json keeps the hash of each file as written.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { importXmlReport, decodeXml } from '../importers/index.js';
import { importRdlx, reportId } from '../importers/rdlx.js';

export const BATCH_LIMITS = { maxFiles: 2000, maxBytes: 16 * 1024 * 1024 };
export const MANIFEST = '.pw-import.json';
const REPORT = /\.(rdlc?|jrxml|rptdesign|rdlx-json)$/i;
const IMAGE = /\.(png|jpe?g|gif|svg|bmp|webp)$/i;
const RESOURCE = /\.(rds|jrtx|rptlibrary)$/i;
const FORMAT = { rdl: 'SSRS', rdlc: 'SSRS', jrxml: 'JasperReports', rptdesign: 'BIRT', 'rdlx-json': 'ActiveReports' };

const sha = (/** @type {string | Uint8Array} */ b) => crypto.createHash('sha256').update(b).digest('hex');
const inside = (root, p) => p === root || p.startsWith(root + path.sep);
const extOf = (f) => (/\.rdlx-json$/i.test(f) ? 'rdlx-json' : path.extname(f).slice(1).toLowerCase());
const stemOf = (f) => path.basename(f).replace(/\.rdlx-json$/i, '').replace(/\.[^.]+$/, '');
const dirOf = (rel) => path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
const join = (dir, f) => (dir ? `${dir}/${f}` : f);

/**
 * The input folder's files: reports, their resources and images (sorted), and what was refused.
 * @param {string} root the input folder (a real path) @param {{ recursive?: boolean, maxFiles: number, skip?: string }} o
 */
function walk(root, o) {
  /** @type {{ rel: string, abs: string, size: number }[]} */ const files = [];
  /** @type {{ path: string, reason: string }[]} */ const refused = [];
  let capped = false, total = 0;
  const visit = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (capped) return;
      const r = join(rel, ent.name), abs = path.join(dir, ent.name);
      let real = abs, st;
      try {
        if (ent.isSymbolicLink()) {
          real = fs.realpathSync(abs);
          if (!inside(root, real)) { refused.push({ path: r, reason: 'a symbolic link to outside the input folder: not followed' }); continue; }
          st = fs.statSync(real);
          if (st.isDirectory()) { refused.push({ path: r, reason: 'a symbolic link to a folder: not followed' }); continue; }
        } else st = fs.statSync(abs);
      } catch (e) { refused.push({ path: r, reason: `cannot be read (${e instanceof Error ? e.message : e})` }); continue; }
      if (st.isDirectory()) { if (o.recursive && real !== o.skip) visit(abs, r); continue; }
      if (!st.isFile() || !(REPORT.test(r) || IMAGE.test(r) || RESOURCE.test(r))) continue;
      if (files.length >= o.maxFiles) { capped = true; refused.push({ path: r, reason: `more than ${o.maxFiles} files: this one and the rest are not imported (--max-files)` }); return; }
      if (total + st.size > (o.maxTotal ?? Infinity)) { refused.push({ path: r, reason: `the folder's files add up to more than ${o.maxTotal} bytes: this one is not read` }); continue; }
      total += st.size;
      files.push({ rel: r, abs: real, size: st.size });
    }
  };
  visit(root, '');
  return { files, refused };
}

/** Line and column (1-based) of a character offset. */
function positions(text) {
  let starts = null;
  return (pos) => {
    if (typeof pos !== 'number') return {};
    starts ||= [0, ...[...text.matchAll(/\n/g)].map(m => /** @type {number} */ (m.index) + 1)];
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, column: pos - starts[lo] + 1 };
  };
}

/** Every object in a definition (sections, bands, nested items, cells), depth first. */
function* objects(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 200) return;
  yield o;
  for (const v of Array.isArray(o) ? o : Object.values(o)) if (v && typeof v === 'object') yield* objects(v, depth + 1);
}

/**
 * Import a folder.
 * @param {string} input the input folder
 * @param {string} output the output folder (created)
 * @param {{ recursive?: boolean, force?: boolean, maxFiles?: number, maxBytes?: number, maxTotal?: number, dryRun?: boolean,
 *   verify?: (r: { file: string, definition: any, baseline: any }) => Promise<any>, log?: (msg: string) => void }} [opts]
 *   verify: called for each imported report (pw import --verify renders it); its result goes into the report
 *   dryRun: convert everything but write nothing (pw assess); the output folder is not created or read
 *   maxTotal: a cap on the files' total size, in bytes (the files past it are refused)
 */
export async function importFolder(input, output, opts = {}) {
  const maxFiles = opts.maxFiles ?? BATCH_LIMITS.maxFiles, maxBytes = opts.maxBytes ?? BATCH_LIMITS.maxBytes;
  const log = opts.log || (() => {});
  const inRoot = fs.realpathSync(input);
  if (!fs.statSync(inRoot).isDirectory()) throw new Error(`${input} is not a folder`);
  if (!opts.dryRun) fs.mkdirSync(output, { recursive: true });
  const outRoot = opts.dryRun ? path.resolve(output || '.') : fs.realpathSync(output);
  const { files, refused } = walk(inRoot, { recursive: opts.recursive, maxFiles, maxTotal: opts.maxTotal, skip: opts.dryRun ? undefined : outRoot });

  let old = {};
  try { const m = JSON.parse(fs.readFileSync(path.join(outRoot, MANIFEST), 'utf8')); if (m && typeof m.files === 'object') old = m.files; } catch { /* none yet, or not ours */ }
  /** @type {Record<string, string>} */ const manifest = {};
  for (const [k, v] of Object.entries(old)) if (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) manifest[k] = v;

  /**
   * Write one output file unless the user edited it. @param {string} rel @param {string | Uint8Array} bytes
   * @returns {{ write: 'written' | 'refreshed' | 'unchanged' | 'skipped-edited' | 'overwritten', previous?: Buffer }}
   */
  function writeTarget(rel, bytes) {
    const abs = path.resolve(outRoot, ...rel.split('/'));
    if (!inside(outRoot, abs) || abs === outRoot) throw new Error(`the output path ${rel} is outside the output folder`);
    if (opts.dryRun) { manifest[rel] = sha(bytes); return { write: 'written' }; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!inside(outRoot, fs.realpathSync(path.dirname(abs)))) throw new Error(`the output folder of ${rel} is a link to outside the output folder`);
    const h = sha(bytes);
    let st = null;
    try { st = fs.lstatSync(abs); } catch { /* new */ }
    if (st && !st.isFile()) throw new Error(`${rel} is in the output folder and is not a plain file (a link or a folder): not overwritten`);
    let previous, cur;
    if (st) {
      previous = fs.readFileSync(abs);
      cur = sha(previous);
      if (cur === h) { manifest[rel] = h; return { write: 'unchanged', previous }; }
      if (cur !== old[rel] && !opts.force) return { write: 'skipped-edited', previous }; // edited since the last import (or never ours)
    }
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(tmp, bytes, { flag: 'wx' }); // wx: never through a link
    fs.renameSync(tmp, abs);
    manifest[rel] = h;
    return { write: !st ? 'written' : cur !== old[rel] ? 'overwritten' : 'refreshed', previous };
  }

  // resources by relative path and by lower-case file name
  const byRel = new Map(files.map(f => [f.rel, f]));
  /** A resource that a report names: by its path relative to the report, else by its file name (the nearest one). */
  function find(test, ref, fromDir) {
    const r = String(ref ?? '').trim().replace(/\\/g, '/').replace(/^file:(\/\/)?/i, '');
    if (!r || /^[a-z][a-z0-9+.-]*:/i.test(r) && !/^[a-z]:\//i.test(r)) return null; // a URL: not a file of the batch
    if (!r.startsWith('/') && !/^[a-z]:\//i.test(r)) {
      const rel = path.posix.normalize(join(fromDir, r));
      const hit = !rel.startsWith('../') && byRel.get(rel);
      if (hit && test.test(hit.rel)) return hit;
    }
    const base = r.split('/').pop()?.toLowerCase();
    const cands = files.filter(f => test.test(f.rel) && (path.posix.basename(f.rel).toLowerCase() === base || stemOf(f.rel).toLowerCase() === base));
    return cands.find(f => dirOf(f.rel) === fromDir) || cands[0] || null;
  }
  const readText = (f) => { if (f.size > maxBytes) throw new Error(`${f.rel} is larger than ${maxBytes} bytes`); return decodeXml(fs.readFileSync(f.abs)); };

  // where each report goes: <its folder>/<report id>.pw.json (pw render and the server find subreports by that id)
  const reports = files.filter(f => REPORT.test(f.rel));
  const taken = new Set();
  const outOf = new Map(reports.map(f => {
    const dir = dirOf(f.rel);
    let id = reportId(path.posix.basename(f.rel));
    if (taken.has(join(dir, id))) id = `${id}-${extOf(f.rel)}`.slice(0, 64);
    for (let k = 2; taken.has(join(dir, id)); k++) id = `${reportId(path.posix.basename(f.rel))}-${k}`;
    taken.add(join(dir, id));
    return [f.rel, { dir, id, rel: join(dir, `${id}.pw.json`) }];
  }));
  /** @type {Map<string, string>} image content hash → its copy in the output folder */
  const images = new Map();

  const results = [];
  for (const f of reports) {
    const o = /** @type {{ dir: string, id: string, rel: string }} */ (outOf.get(f.rel));
    /** @type {any} */
    const rec = { source: f.rel, format: FORMAT[extOf(f.rel)], output: o.rel, status: 'failed', stats: { items: 0, mapped: 0, approximated: 0, dropped: 0 }, items: [], expressions: [], notes: [], references: [] };
    results.push(rec);
    try {
      const text = readText(f);
      const at = positions(text);
      const resolve = (kind, ref) => {
        const hit = find(kind === 'datasource' ? /\.rds$/i : /\.jrtx$/i, ref, o.dir);
        rec.references.push({ kind: kind === 'datasource' ? 'shared data source' : 'style template', ref, resolved: hit ? hit.rel : null });
        return hit ? readText(hit) : null;
      };
      const name = stemOf(f.rel);
      const r = extOf(f.rel) === 'rdlx-json' ? importRdlx(JSON.parse(text.replace(/^﻿/, '')), { name }) : importXmlReport(text, { name, resolve });
      if (r.error) throw new Error(r.error);
      const def = r.definition;
      rec.stats = r.stats;
      rec.sources = (def.dataSources || []).map(s => ({ name: s.name, type: s.type, ...(s.connection ? { connection: s.connection } : {}) }));
      const itemLines = new Set();
      for (const it of r.items || []) {
        const p = at(it.pos);
        rec.items.push({ name: it.name, state: it.state, ...p, notes: it.notes });
        for (const n of it.notes) itemLines.add(`${it.name}: ${n.message}`);
        for (const e of it.exprs) rec.expressions.push({ item: it.name, expression: e, ...p });
      }
      rec.notes = r.warnings.filter(w => !itemLines.has(w)); // the report-level ones: every warning is in the report once

      // subreports, by their id: the batch's report of that id, the nearest first
      for (const s of objects(def)) {
        if (s.type !== 'subreport' || typeof s.report !== 'string') continue;
        const hits = reports.filter(x => outOf.get(x.rel)?.id === s.report);
        const hit = hits.find(x => dirOf(x.rel) === o.dir) || hits[0];
        const where = hit && /** @type {any} */ (outOf.get(hit.rel)).rel;
        rec.references.push({ kind: 'subreport', ref: s.report, resolved: hit ? hit.rel : null, ...(hit ? { output: where } : {}),
          ...(hit && dirOf(hit.rel) !== o.dir ? { note: `it is imported to ${where}, another folder: pw render finds a subreport next to its report (the server by its id)` } : {}) });
      }
      // images by relative path: copied next to the report, one copy per content
      for (const im of objects(def)) {
        if (im.type !== 'image' || typeof im.src !== 'string' || !im.src || im.src.startsWith('=') || /^(https?:|data:|embedded:)/i.test(im.src)) continue;
        const hit = find(IMAGE, im.src, dirOf(f.rel));
        if (!hit) { rec.references.push({ kind: 'image', ref: im.src, resolved: null }); continue; }
        if (hit.size > maxBytes) { rec.references.push({ kind: 'image', ref: im.src, resolved: null, note: `${hit.rel} is larger than ${maxBytes} bytes` }); continue; }
        const bytes = fs.readFileSync(hit.abs), h = sha(bytes);
        let copy = images.get(h);
        if (!copy) {
          const base = path.posix.basename(hit.rel);
          copy = join(o.dir, base);
          if ([...images.values()].includes(copy)) copy = join(o.dir, `${stemOf(base)}-${h.slice(0, 8)}${path.posix.extname(base)}`);
          const w = writeTarget(copy, bytes);
          if (w.write === 'skipped-edited') rec.notes.push(`The image ${copy} in the output folder was changed since the last import, so it was not replaced (--force replaces it).`);
          images.set(h, copy);
        }
        rec.references.push({ kind: 'image', ref: im.src, resolved: hit.rel, output: copy });
        im.src = path.posix.relative(o.dir, copy);
      }
      // BIRT libraries: listed; the BIRT importer does not read them
      if (extOf(f.rel) === 'rptdesign') {
        const libs = /<list-property\s+name="libraries">([\s\S]*?)<\/list-property>/.exec(text)?.[1] || '';
        for (const m of libs.matchAll(/<property\s+name="fileName">([^<]{1,500})<\/property>/g)) {
          const hit = find(/\.rptlibrary$/i, m[1], o.dir);
          rec.references.push({ kind: 'BIRT library', ref: m[1], resolved: hit ? hit.rel : null, note: 'the BIRT importer does not read libraries: items from it are missing' });
        }
      }
      const w = writeTarget(o.rel, JSON.stringify(def, null, 2) + '\n');
      rec.status = 'imported';
      rec.write = w.write;
      if (w.write === 'skipped-edited') rec.notes.unshift(`${o.rel} was changed since the last import, so it was not overwritten (--force overwrites it).`);
      log(`${f.rel} → ${o.rel}: ${w.write}${rec.references.some(x => !x.resolved) ? `, ${rec.references.filter(x => !x.resolved).length} unresolved` : ''}`);
      if (opts.verify) {
        let baseline = null, onDisk = def;
        try {
          if (w.write === 'skipped-edited') onDisk = JSON.parse(fs.readFileSync(path.join(outRoot, ...o.rel.split('/')), 'utf8'));
          else if (w.previous && w.write !== 'unchanged') baseline = JSON.parse(w.previous.toString('utf8'));
        } catch { /* a previous file that is not JSON: no baseline */ }
        try { rec.verify = await opts.verify({ file: path.join(outRoot, ...o.rel.split('/')), definition: onDisk, baseline }); } catch (e) { rec.verify = { status: 'failed', error: e instanceof Error ? e.message : String(e) }; }
      }
    } catch (e) {
      rec.status = 'failed';
      rec.error = e instanceof Error ? e.message : String(e);
      log(`${f.rel}: FAILED: ${rec.error}`);
    }
  }
  if (!opts.dryRun) fs.writeFileSync(path.join(outRoot, MANIFEST), JSON.stringify({ version: 1, note: 'pw import: the hash of each file as written; a file whose hash differs was edited and is not overwritten without --force', files: manifest }, null, 2) + '\n');

  const n = (s) => results.filter(r => r.status === s).length;
  return {
    tool: 'pw import', schema: 1, created: new Date().toISOString(), input: inRoot, output: outRoot,
    options: { recursive: !!opts.recursive, force: !!opts.force, verify: !!opts.verify, maxFiles, maxBytes, ...(opts.dryRun ? { dryRun: true } : {}) },
    summary: { reports: results.length, imported: n('imported'), failed: n('failed'), refused: refused.length, images: images.size,
      skippedEdited: results.filter(r => r.write === 'skipped-edited').length, unresolved: results.reduce((k, r) => k + r.references.filter(x => !x.resolved).length, 0) },
    files: results, refused,
  };
}

/** 0 all imported, 2 some failed, 1 nothing imported. @param {any} report */
export const exitCode = (report) => (!report.summary.imported ? 1 : report.summary.failed ? 2 : 0);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const at = (o) => (o.line ? `${o.line}:${o.column}` : '');

/** The report as a self-contained page (everything from the files is escaped). @param {any} r */
export function reportHtml(r) {
  const s = r.summary;
  const verifyCell = (v) => (!v ? '' : `<span class="v-${esc(v.status)}">${esc(v.status)}</span>`);
  const rows = r.files.map((f, i) => `<tr class="${f.status}"><td><a href="#f${i}">${esc(f.source)}</a></td><td>${esc(f.format)}</td><td>${esc(f.status)}${f.write ? ` · ${esc(f.write)}` : ''}</td>` +
    `<td class="n">${f.stats.mapped}</td><td class="n">${f.stats.approximated}</td><td class="n">${f.stats.dropped}</td><td class="n">${f.expressions.length}</td>` +
    `<td class="n">${f.references.filter(x => !x.resolved).length}</td><td>${verifyCell(f.verify)}</td></tr>`).join('\n');
  const detail = r.files.map((f, i) => {
    const items = f.items.filter(it => it.notes.length);
    return `<section id="f${i}"><h2>${esc(f.source)} <small>${esc(f.format)} → ${esc(f.output)}</small></h2>` +
      (f.error ? `<p class="err">Failed: ${esc(f.error)}</p>` : '') +
      (f.references.length ? `<h3>References</h3><table><tr><th>Kind</th><th>Name</th><th>Resolved to</th><th>Note</th></tr>${f.references.map(x => `<tr class="${x.resolved ? '' : 'failed'}"><td>${esc(x.kind)}</td><td><code>${esc(x.ref)}</code></td><td>${x.resolved ? esc(x.resolved) + (x.output ? ` → ${esc(x.output)}` : '') : '<b>unresolved</b>'}</td><td>${esc(x.note)}</td></tr>`).join('')}</table>` : '') +
      (f.expressions.length ? `<h3>Expressions not translated</h3><table><tr><th>Line:col</th><th>Item</th><th>Expression</th></tr>${f.expressions.map(e => `<tr><td>${esc(at(e))}</td><td>${esc(e.item)}</td><td><code>${esc(e.expression)}</code></td></tr>`).join('')}</table>` : '') +
      (items.length ? `<h3>Items</h3><table><tr><th>Line:col</th><th>Item</th><th>Status</th><th>Why</th></tr>${items.map(it => `<tr class="${esc(it.state)}"><td>${esc(at(it))}</td><td>${esc(it.name)}</td><td>${esc(it.state)}</td><td><ul>${it.notes.map(n => `<li class="${esc(n.kind)}">${esc(n.message)}</li>`).join('')}</ul></td></tr>`).join('')}</table>` : '') +
      (f.notes.length ? `<h3>Report notes</h3><ul>${f.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '') +
      (f.verify ? `<h3>Verify</h3><p>${verifyCell(f.verify)} ${esc(f.verify.note || f.verify.error || '')}${f.verify.pages != null ? ` (${f.verify.pages} pages)` : ''}</p>${f.verify.diff?.length ? `<pre>${esc(f.verify.diff.join('\n'))}</pre>` : ''}` : '') +
      '</section>';
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Import report</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1d2025;--mute:#636a74;--line:#dfe2e6;--bad:#b42318;--warn:#9a6700;--ok:#1a7f37;--head:#f4f5f7}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--fg:#e6e8eb;--mute:#9aa1ab;--line:#30343a;--bad:#ff7b72;--warn:#d29922;--ok:#3fb950;--head:#1f2228}}
body{margin:0;padding:16px 24px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 6px;border-top:1px solid var(--line);padding-top:14px;overflow-wrap:anywhere}h2 small{color:var(--mute);font-weight:400}h3{font-size:14px;margin:14px 0 4px}
p.meta{color:var(--mute);margin:0 0 12px;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;margin:4px 0}th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:var(--head);font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.failed td:first-child,.err,li.dropped,.v-failed,.v-changed{color:var(--bad)}tr.dropped td,li.approximated{color:var(--warn)}.v-ok{color:var(--ok)}
code,pre{font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}ul{margin:0;padding-left:18px}
.cards{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 16px}.cards div{border:1px solid var(--line);border-radius:6px;padding:6px 12px}.cards b{display:block;font-size:18px}
</style></head><body><h1>Import report</h1>
<p class="meta">${esc(r.input)} → ${esc(r.output)} · ${esc(r.created)}</p>
<div class="cards"><div><b>${s.reports}</b>reports</div><div><b>${s.imported}</b>imported</div><div><b>${s.failed}</b>failed</div><div><b>${s.unresolved}</b>unresolved references</div><div><b>${s.images}</b>images copied</div><div><b>${s.skippedEdited}</b>kept (edited)</div><div><b>${s.refused}</b>refused</div></div>
<table><tr><th>File</th><th>Format</th><th>Status</th><th>Mapped</th><th>Approximated</th><th>Dropped</th><th>Expressions not translated</th><th>Unresolved</th><th>Verify</th></tr>
${rows}</table>
${r.refused.length ? `<h2>Refused</h2><ul>${r.refused.map(x => `<li><code>${esc(x.path)}</code>: ${esc(x.reason)}</li>`).join('')}</ul>` : ''}
${detail}
</body></html>
`;
}
