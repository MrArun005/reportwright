// The owner's three-tier comparison of two PDFs (scripts/writer-parity.mjs, tests/engine/parity-tiers.test.js):
//   Tier 1, EXACT (never loosened, tagged reports included): every word's text and box per page (pdftotext -bbox, to
//     0.01 pt) and the structure tree (types, order, /Alt /ActualText /Lang /E, attributes such as table structure).
//   Tier 2, TOLERANCE: pages at TOLERANCE.dpi in grayscale; passes when at most pixelTolerance of the pixels differ by
//     more than pixelThreshold/255 AND no blockSize×blockSize block (any position) differs entirely by more than that.
//   Tier 3, TIE-BREAKER when tier 2 fails: 600 dpi in colour, every pixel equal → pass ("anti-aliasing only"), else fail.
//   Also exact, beside the tiers: the graphics state the content streams use per page (fill/stroke colours and colour
//   spaces, line widths, dash patterns, ExtGState values), so a 1/255 colour or a 0.1 pt width the thresholds would hide fails.
// The tolerance and the pinned rasteriser (checkRenderer) live in scripts/parity-tolerance.json, so changing it shows in a diff.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const TOLERANCE = Object.freeze(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'parity-tolerance.json'), 'utf8')));
export const PIXEL_TOLERANCE = TOLERANCE.pixelTolerance, PIXEL_THRESHOLD = TOLERANCE.pixelThreshold, BLOCK_SIZE = TOLERANCE.blockSize, DPI = TOLERANCE.dpi;
/** tier 3's resolution */
export const TIE_DPI = 600;
/** a word box edge may move less than this (pt) */
export const BBOX_EPS = 0.01;

const run = (cmd, a) => { const r = spawnSync(cmd, a, { maxBuffer: 1 << 30 }); if (r.error) throw r.error; return r; };
const pwArgs = (pw, flag) => (pw ? [flag, pw] : []);

// ---------- tier 1: words and boxes ----------
const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** per page: [{ t, b: [xMin, yMin, xMax, yMax] }] @param {string} f @param {string} [pw] */
export function wordBoxes(f, pw = '') {
  const html = run('pdftotext', [...pwArgs(pw, '-upw'), '-bbox', f, '-']).stdout.toString();
  return html.split('<page ').slice(1).map(pg => [...pg.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)<\/word>/g)]
    .map(m => ({ t: ent(m[5]), b: [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] })));
}
/** the first difference of two pages' words, or '' @param {any[]} a @param {any[]} b */
export function wordDiff(a, b) {
  if (a.length !== b.length) return `${a.length}→${b.length} words`;
  for (let i = 0; i < a.length; i++) {
    if (a[i].t !== b[i].t) return `word ${i + 1} "${a[i].t}"→"${b[i].t}"`;
    if (a[i].b.some((v, k) => Math.abs(v - b[i].b[k]) >= BBOX_EPS)) return `"${a[i].t}" box ${a[i].b.join(',')}→${b[i].b.join(',')}`;
  }
  return '';
}

// ---------- the file's objects (qpdf JSON, stream data decoded) ----------
/** @param {string} f @param {string} [pw] */
export function objects(f, pw = '') {
  const r = run('qpdf', [...(pw ? [`--password=${pw}`] : []), '--json=2', '--json-key=qpdf', '--json-key=pages', '--json-stream-data=inline', f]);
  const j = JSON.parse(r.stdout.toString());
  const objs = j.qpdf[1];
  const get = (/** @type {any} */ v) => (typeof v === 'string' && / 0 R$/.test(v) ? (objs[`obj:${v}`]?.value ?? objs[`obj:${v}`]?.stream ?? null) : v);
  const dict = (/** @type {any} */ v) => { const o = get(v); return o?.dict ?? o; };
  const data = (/** @type {any} */ v) => { const o = get(v); return o?.data ? Buffer.from(o.data, 'base64').toString('latin1') : ''; };
  return { objs, pages: j.pages.map((/** @type {any} */ p) => p.object), get, dict, data };
}

// ---------- tier 1: the structure tree ----------
const ATTRS = ['/Alt', '/ActualText', '/Lang', '/E', '/T'];
/**
 * The structure tree as plain JSON: { S, Alt?, ActualText?, Lang?, E?, A?, K: [element | 'mcid p:n' | 'objr p:Subtype'] }.
 * Marked content is named by page and MCID; an annotation by page and subtype. Object numbers never appear.
 * @param {ReturnType<typeof objects>} o
 */
export function structTree(o) {
  const cat = Object.values(o.objs).map((/** @type {any} */ x) => x.value).find((/** @type {any} */ v) => v?.['/Type'] === '/Catalog');
  const root = o.dict(cat?.['/StructTreeRoot']);
  if (!root) return null;
  const pageNo = new Map(o.pages.map((r, i) => [r, i + 1]));
  /** attributes, references resolved (an /A may be a dict, an array of them, or with revision numbers) @param {any} v */
  const val = (v, d = 0) => {
    if (d > 8) return '…';
    const x = o.get(v);
    if (Array.isArray(x)) return x.map(y => val(y, d + 1));
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).sort().map(([k, y]) => [k, val(y, d + 1)]));
    return x;
  };
  const seen = new Set();
  /** @param {any} ref @param {any} pg the parent's /Pg */
  const walk = (ref, pg) => {
    if (seen.has(ref)) return 'cycle';
    seen.add(ref);
    const e = o.dict(ref);
    if (!e) return null;
    const out = /** @type {any} */ ({ S: e['/S'] });
    for (const k of ATTRS) if (e[k] !== undefined) out[k.slice(1)] = e[k];
    if (e['/A'] !== undefined) out.A = val(e['/A']);
    if (e['/C'] !== undefined) out.C = val(e['/C']);
    const myPg = e['/Pg'] ?? pg;
    const K = e['/K'] === undefined ? [] : Array.isArray(o.get(e['/K'])) ? o.get(e['/K']) : [e['/K']];
    out.K = K.map((/** @type {any} */ k) => {
      if (typeof k === 'number') return `mcid ${pageNo.get(myPg)}:${k}`;
      const d = o.dict(k);
      if (d?.['/Type'] === '/MCR') return `mcid ${pageNo.get(d['/Pg'] ?? myPg)}:${d['/MCID']}`;
      if (d?.['/Type'] === '/OBJR') return `objr ${pageNo.get(d['/Pg'] ?? myPg)}:${o.dict(d['/Obj'])?.['/Subtype'] ?? '?'}`;
      return walk(k, myPg);
    });
    return out;
  };
  const K = root['/K'];
  return (Array.isArray(o.get(K)) ? o.get(K) : [K]).map((/** @type {any} */ k) => walk(k, undefined));
}
/** where two trees first differ ('' when identical) @param {any} a @param {any} b */
export function treeDiff(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return '';
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return `${at || '/'}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = treeDiff(a[i], b[i], `${at}[${i}]`); if (d) return d; }
    return `${at}: ${a.length}→${b.length} kids`;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = treeDiff(a[k], b[k], Array.isArray(a) ? `${at}[${k}]` : `${at}${a.S ? `/${a.S.slice(1)}` : ''}.${k}`);
    if (d) return d;
  }
  return '';
}

// ---------- exact: the drawing commands ----------
/** a number to 3 decimals (0.5 = .5 = 0.500; -0 = 0) @param {string} s */
const num = (s) => { const v = Math.round(Number(s) * 1000) / 1000; return String(v === 0 ? 0 : v); };
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)$/;
/**
 * A content stream as canonical operators, 'op operand …': numbers to 3 decimals, string operands as (str) (text is
 * never diffed here; tier 1 compares it), a name resolved by name(op, operand) (a font to its BaseFont, an ExtGState to
 * its values, an XObject to what it is), identity cm dropped, q … Q with nothing drawn inside dropped (nesting kept).
 * @param {string} s @param {(op: string, name: string) => string} [name]
 */
export function canonicalOps(s, name = (_, n) => n) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  let st = [];
  let i = 0;
  const n = s.length;
  const qs = []; // out.length at each open q
  while (i < n) {
    const c = s[i];
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (' \t\r\n\f\0'.includes(c)) { i++; continue; }
    if (c === '(') { let d = 0; for (; i < n; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) break; } i++; st.push('(str)'); continue; }
    if (c === '<' && s[i + 1] === '<') { const k = i; let d = 0; for (; i < n; i++) { if (s[i] === '<' && s[i + 1] === '<') { d++; i++; } else if (s[i] === '>' && s[i + 1] === '>') { i++; if (--d === 0) break; } } i++; st.push(s.slice(k, i).replace(/\s+/g, ' ').replace(/[+-]?(\d+\.?\d*|\.\d+)/g, num)); continue; }
    if (c === '<') { const e = s.indexOf('>', i); i = e + 1; st.push('(str)'); continue; }
    if (c === '[') { st.push('['); i++; continue; }
    if (c === ']') { const k = st.lastIndexOf('['); const arr = st.splice(k); st.push(`[${arr.slice(1).join(' ')}]`); i++; continue; }
    let j = i + 1;
    while (j < n && !' \t\r\n\f\0()<>[]{}/%'.includes(s[j])) j++;
    const tok = s.slice(i, j);
    i = j;
    if (c === '/') { st.push(tok); continue; }
    if (NUM.test(tok)) { st.push(num(tok)); continue; }
    if (tok === 'BI') { const e = s.indexOf('EI', s.indexOf('ID', i)); i = e < 0 ? n : e + 2; out.push('BI (inline image)'); st = []; continue; }
    if (tok === 'cm' && st.join(' ') === '1 0 0 1 0 0') { st = []; continue; }
    if (tok === 'q') { qs.push(out.length); out.push('q'); st = []; continue; }
    if (tok === 'Q') { const k = qs.pop(); if (k === out.length - 1) out.pop(); else out.push('Q'); st = []; continue; }
    if (tok === 'Tf' || tok === 'gs' || tok === 'Do' || tok === 'cs' || tok === 'CS' || tok === 'sh') st = st.map(x => (x.startsWith('/') ? name(tok, x) : x));
    if ((tok === 'scn' || tok === 'SCN') && st.at(-1)?.startsWith('/')) st[st.length - 1] = name(tok, st[st.length - 1]);
    out.push(st.length ? `${tok} ${st.join(' ')}` : tok);
    st = [];
  }
  return out;
}
/**
 * Per page: its content's canonical operators (canonicalOps), a form XObject's own after its Do. Resource names are
 * replaced by what they name: a font by its BaseFont (subset tag left out, it hashes the subset's bytes; pdf-lib's random '-1234' suffix, addRandomSuffix, too), an ExtGState
 * by its values (numbers to 3 decimals), a colour space or pattern by its kind, an XObject by its subtype and size.
 * @param {ReturnType<typeof objects>} o
 */
export function drawing(o) {
  return o.pages.map(ref => {
    const pg = o.dict(ref);
    /** @param {string} content @param {any} r @returns {string[]} */
    const scan = (content, r, depth = 0) => {
      const sub = (/** @type {string} */ k) => o.dict(r[k]) || {};
      const name = (/** @type {string} */ op, /** @type {string} */ nm) => {
        if (op === 'Tf') { const f = o.dict(sub('/Font')[nm]) || {}; return `font:${String(f['/BaseFont'] ?? '?').replace(/^\/[A-Z]{6}\+/, '/').replace(/-\d{1,4}$/, '')}:${f['/Subtype'] ?? ''}`; }
        if (op === 'gs') { const d = o.dict(sub('/ExtGState')[nm]) || {}; return `gs:${JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => k !== '/Type').sort().map(([k, v]) => [k, typeof v === 'string' && / 0 R$/.test(v) ? (o.dict(v)?.['/S'] ?? 'ref') : typeof v === 'number' ? Number(num(String(v))) : v])))}`; }
        if (op === 'Do') { const d = o.dict(sub('/XObject')[nm]) || {}; return `xobject:${d['/Subtype']}:${d['/Width'] ?? ''}x${d['/Height'] ?? ''}${d['/BBox'] ? `:${o.get(d['/BBox']).map(num)}` : ''}`; }
        if (op === 'cs' || op === 'CS') { if (['/DeviceRGB', '/DeviceGray', '/DeviceCMYK', '/Pattern'].includes(nm)) return nm; const v = o.get(sub('/ColorSpace')[nm]); return `cs:${Array.isArray(v) ? v[0] : v}`; }
        if (op === 'sh') return `shading:${o.dict(sub('/Shading')[nm])?.['/ShadingType'] ?? '?'}`;
        return `pattern:${o.dict(sub('/Pattern')[nm])?.['/PatternType'] ?? '?'}`;
      };
      const ops = canonicalOps(content, name);
      if (depth > 6) return ops;
      const xo = sub('/XObject');
      return ops.flatMap(op => {
        if (!op.startsWith('Do xobject:/Form')) return [op];
        const ent = Object.values(xo).find(v => `Do ${name('Do', Object.keys(xo).find(k => xo[k] === v) || '')}` === op);
        const d = ent && o.dict(ent);
        return d ? [op, '{', ...scan(o.data(ent), o.dict(d['/Resources']) || r, depth + 1), '}'] : [op];
      });
    };
    const c = o.get(pg['/Contents']);
    return scan((Array.isArray(c) ? c : [pg['/Contents']]).map(x => o.data(x)).join('\n'), o.dict(pg['/Resources']) || {});
  });
}
/** where two files' drawings first differ ('' when identical) @param {string[][]} a @param {string[][]} b */
export function drawingDiff(a, b) {
  if (a.length !== b.length) return `pages ${a.length}→${b.length}`;
  for (let p = 0; p < a.length; p++) {
    const n = Math.max(a[p].length, b[p].length);
    for (let i = 0; i < n; i++) if (a[p][i] !== b[p][i]) return `page ${p + 1} op ${i + 1}: ${a[p][i] ?? '(end)'} → ${b[p][i] ?? '(end)'}`;
  }
  return '';
}

/** The installed rasteriser must be the pinned one (parity-tolerance.json), else every pixel verdict is meaningless. */
export function checkRenderer() {
  const v = (run('pdftoppm', ['-v']).stderr.toString().match(/version (\S+)/) || [])[1];
  if (v !== TOLERANCE.rendererVersion) throw new Error(`pdftoppm ${v} is installed, the gate is pinned to ${TOLERANCE.rendererVersion} (scripts/parity-tolerance.json): re-baseline in one explicit commit`);
  return v;
}

// ---------- tiers 2 and 3: pixels ----------
/** a P5/P6 file: { w, h, ch, data } @param {Buffer} b */
export function readPnm(b) {
  let i = 0, f = [];
  while (f.length < 4) { while (/\s/.test(String.fromCharCode(b[i]))) i++; if (b[i] === 0x23) { while (b[i] !== 0x0a) i++; continue; } let s = ''; while (!/\s/.test(String.fromCharCode(b[i]))) s += String.fromCharCode(b[i++]); f.push(s); }
  return { w: Number(f[1]), h: Number(f[2]), ch: f[0] === 'P6' ? 3 : 1, data: b.subarray(i + 1) };
}
/** every page of f at dpi (grayscale, or colour) @param {string} f @returns {ReturnType<typeof readPnm>[]} */
export function renderPages(f, dpi, gray, pw = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-tier-'));
  try {
    // a failed render (a full disk, say) is an error, never a verdict
    const r = run('pdftoppm', [...pwArgs(pw, '-upw'), '-r', String(dpi), ...(gray ? ['-gray'] : []), f, path.join(dir, 'p')]);
    if (r.status !== 0) throw new Error(`pdftoppm failed (${r.status}): ${r.stderr.toString().slice(0, 200)}`);
    return fs.readdirSync(dir).sort((x, y) => Number(x.match(/(\d+)\./)?.[1]) - Number(y.match(/(\d+)\./)?.[1])).map(x => readPnm(fs.readFileSync(path.join(dir, x))));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
/**
 * Tier 2 on two grayscale rasters: { ok, differing, fraction, block } — block: the top-left of a blockSize square whose
 * every pixel differs by more than the threshold (summed-area table over the difference mask, every position).
 * @param {{ w: number, h: number, data: Uint8Array }} a @param {typeof a} b
 */
export function tier2(a, b, t = TOLERANCE) {
  if (a.w !== b.w || a.h !== b.h) return { ok: false, differing: Infinity, fraction: 1, block: null, size: true };
  const { w, h } = a, B = t.blockSize;
  const sat = new Uint32Array((w + 1) * (h + 1));
  let differing = 0;
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const d = Math.abs(a.data[y * w + x] - b.data[y * w + x]) > t.pixelThreshold ? 1 : 0;
      differing += d; row += d;
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  let block = null;
  if (differing >= B * B) {
    outer: for (let y = 0; y + B <= h; y++) for (let x = 0; x + B <= w; x++) {
      const s = sat[(y + B) * (w + 1) + x + B] - sat[y * (w + 1) + x + B] - sat[(y + B) * (w + 1) + x] + sat[y * (w + 1) + x];
      if (s === B * B) { block = [x, y]; break outer; }
    }
  }
  const fraction = differing / (w * h);
  return { ok: fraction <= t.pixelTolerance && !block, differing, fraction, block };
}
/** tier 3: identical colour rasters @param {ReturnType<typeof readPnm>} a @param {typeof a} b */
export const tier3 = (a, b) => a.w === b.w && a.h === b.h && Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0;

/**
 * The pixel verdict of two files: { ok, tier: 2|3, detail, tier3Pages: [] }. Pages failing tier 2 are rendered at 600 dpi
 * in colour; all of them equal there → ok, "anti-aliasing only".
 * @param {string} fa @param {string} fb @param {string} [pw]
 */
export function pixelVerdict(fa, fb, pw = '') {
  const A = renderPages(fa, DPI, true, pw), B = renderPages(fb, DPI, true, pw);
  if (A.length !== B.length) return { ok: false, tier: 2, detail: `pages ${A.length}→${B.length}`, tier3Pages: [] };
  const failing = [];
  let worst = 0, n = 0;
  for (let p = 0; p < A.length; p++) { const r = tier2(A[p], B[p]); n += r.differing === Infinity ? 0 : r.differing; worst = Math.max(worst, r.fraction); if (!r.ok) failing.push({ p: p + 1, r }); }
  if (!failing.length) return { ok: true, tier: 2, detail: n ? `ok (tier 2: ${n} px over ${PIXEL_THRESHOLD}, worst page ${(worst * 100).toFixed(3)}%)` : 'ok', tier3Pages: [] };
  const bad = [];
  for (const { p } of failing) {
    const a = renderOne(fa, p, pw), b = renderOne(fb, p, pw);
    if (!tier3(a, b)) bad.push(p);
  }
  const why = (/** @type {any} */ f) => (f.r.size ? 'page size' : f.r.block ? `8×8 block at ${f.r.block}` : `${(f.r.fraction * 100).toFixed(3)}%`);
  if (!bad.length) return { ok: true, tier: 3, detail: `ok (tier 3, anti-aliasing only: page(s) ${failing.map(f => `${f.p} ${why(f)}`).join(', ')} identical at ${TIE_DPI} dpi)`, tier3Pages: failing.map(f => f.p) };
  return { ok: false, tier: 3, detail: `page(s) ${failing.filter(f => bad.includes(f.p)).map(f => `${f.p} ${why(f)}`).join(', ')} fail tier 2 and differ at ${TIE_DPI} dpi`, tier3Pages: failing.map(f => f.p) };
}
/** page p at 600 dpi in colour @param {string} f @param {number} p */
function renderOne(f, p, pw = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-tie-'));
  try {
    const r = run('pdftoppm', [...pwArgs(pw, '-upw'), '-r', String(TIE_DPI), '-f', String(p), '-l', String(p), '-singlefile', f, path.join(dir, 'p')]);
    if (r.status !== 0) throw new Error(`pdftoppm failed (${r.status}): ${r.stderr.toString().slice(0, 200)}`);
    return readPnm(fs.readFileSync(path.join(dir, 'p.ppm')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Tier 1 and the exact graphics state of two files: { words, tree, state } (each '' when equal, else the first difference).
 * @param {string} fa @param {string} fb @param {string} [pw]
 */
export function exactChecks(fa, fb, pw = '') {
  const wa = wordBoxes(fa, pw), wb = wordBoxes(fb, pw);
  let words = wa.length !== wb.length ? `pages ${wa.length}→${wb.length}` : '';
  for (let p = 0; !words && p < wa.length; p++) { const d = wordDiff(wa[p], wb[p]); if (d) words = `page ${p + 1}: ${d}`; }
  const oa = objects(fa, pw), ob = objects(fb, pw);
  return { words, tree: treeDiff(structTree(oa), structTree(ob)), drawing: drawingDiff(drawing(oa), drawing(ob)) };
}
