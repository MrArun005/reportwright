// pw compare: prove a converted report matches the original PDF (SSRS, Jasper, BIRT exports).
// Text-and-layout: the words of both PDFs, page by page, aligned (LCS); missing, extra, changed and moved words, numbers
// first. Visual (pdftoppm on PATH): both pages rendered, a red-on-faded overlay and the % of pixels that differ.
// Inputs are untrusted: every PDF goes through @reportwright/pdf's budgeted reader first; pages, words, pixels and time
// are capped, and the external tools run with a timeout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { loadPdf } from '@reportwright/pdf';

export const LIMITS = Object.freeze({
  maxBytes: 50 * 1024 * 1024,
  maxPages: 300,
  maxWords: 20000,
  maxVisualPages: 50,
  maxPixels: 4_000_000,
  timeoutMs: 20000,
  toolTimeoutMs: 15000,
});
const BUDGET = {
  maxDecoded: 256 * 1024 * 1024,
  maxStream: 64 * 1024 * 1024,
  maxSteps: 50_000_000,
  maxObjects: 1_000_000,
  maxTextItems: 200_000,
};

const has = (tool) => {
  try {
    return spawnSync(tool, ['-v'], { timeout: 5000 }).error == null;
  } catch {
    return false;
  }
};
/** a word is a number when it has a digit and no letter: 1,234.50  (12.00)  -7%  $3  2026-01-01 */
export const isNumber = (t) => /\d/.test(t) && !/\p{L}/u.test(t);

/** Load a PDF under the reader's budget: page sizes, and each page's words in content order (no positions). */
async function readJs(bytes, warn) {
  if (bytes.length > LIMITS.maxBytes)
    throw Object.assign(new Error(`a PDF can be at most ${LIMITS.maxBytes / 1048576} MB`), { status: 413 });
  const doc = await loadPdf(bytes, { budget: BUDGET, timeoutMs: LIMITS.timeoutMs });
  const n = Math.min(doc.pageCount, LIMITS.maxPages);
  if (doc.pageCount > n) warn(`only the first ${n} of ${doc.pageCount} pages are compared`);
  const pages = [];
  for (let i = 0; i < n; i++) {
    const p = doc.page(i);
    const words = p
      .extractText({ timeoutMs: 5000 })
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => ({ t }));
    pages.push({ w: p.width, h: p.height, words: cap(words, i, warn) });
  }
  return { pageCount: doc.pageCount, pages };
}
const cap = (words, i, warn) => {
  if (words.length > LIMITS.maxWords) {
    warn(`page ${i + 1}: only the first ${LIMITS.maxWords} words are compared`);
    return words.slice(0, LIMITS.maxWords);
  }
  return words;
};

/** Word boxes from pdftotext -bbox (top-left origin, points), as scripts/parity-tiers.mjs reads them. */
function readPoppler(file, n, warn) {
  const r = spawnSync('pdftotext', ['-bbox', '-l', String(n), file, '-'], {
    timeout: LIMITS.toolTimeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    warn(`pdftotext failed (${r.error?.code || r.status}): word positions are not compared`);
    return null;
  }
  const ent = (s) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  return r.stdout
    .toString()
    .split('<page ')
    .slice(1)
    .map((pg, i) =>
      cap(
        [
          ...pg.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)<\/word>/g),
        ].map((m) => ({ t: ent(m[5]), x: +m[1], y: +m[2], w: m[3] - m[1], h: m[4] - m[2] })),
        i,
        warn,
      ),
    );
}

/** LCS alignment of two word lists: [['=', a, b] | ['-', a] | ['+', b]]. Over 16 M cells: an order-blind multiset diff. */
function align(A, B) {
  const n = A.length,
    m = B.length,
    ops = [];
  if (n * m > 16_000_000) {
    // ponytail: a huge page loses order; split pages by line if this ever matters
    const pool = new Map();
    B.forEach((b) => {
      const l = pool.get(b.t) || [];
      l.push(b);
      pool.set(b.t, l);
    });
    for (const a of A) {
      const l = pool.get(a.t);
      if (l?.length) ops.push(['=', a, l.shift()]);
      else ops.push(['-', a]);
    }
    for (const l of pool.values()) for (const b of l) ops.push(['+', b]);
    return ops;
  }
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = A[i].t === B[j].t ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i].t === B[j].t) ops.push(['=', A[i++], B[j++]]);
    else if (j < m && (i === n || L[i][j + 1] > L[i + 1][j])) ops.push(['+', B[j++]]);
    else ops.push(['-', A[i++]]);
  }
  return ops;
}

const pos = (w) =>
  w && w.x != null ? { x: +w.x.toFixed(1), y: +w.y.toFixed(1), w: +w.w.toFixed(1), h: +w.h.toFixed(1) } : undefined;

/**
 * A number's value, however it is formatted: 1,234.50  1234.5  1.234,50  $ (12.00)  12-  -7%  ₹1,23,456. null when the word is
 * not one. decimals: the digits after the decimal separator (for rounding). Dates and codes (2026-01-01) are not values.
 */
export function parseNumber(t) {
  if (!isNumber(t)) return null;
  let s = t.replace(/[\s\u00a0\u202f'’$€£¥₹%]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/^[-−]/.test(s)) {
    neg = !neg;
    s = s.slice(1);
  } else if (/[-−]$/.test(s)) {
    neg = !neg;
    s = s.slice(0, -1);
  } else if (/^\+/.test(s)) s = s.slice(1);
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'),
    lastComma = s.lastIndexOf(',');
  let dec = -1;
  if (lastDot >= 0 && lastComma >= 0)
    dec = Math.max(lastDot, lastComma); // both: the last is the decimal separator
  else if (lastDot >= 0 || lastComma >= 0) {
    const c = lastDot >= 0 ? '.' : ',',
      at = Math.max(lastDot, lastComma);
    // one kind: a decimal separator unless it repeats or groups exactly three digits (1,234 / 1.234 are thousands)
    if (s.split(c).length === 2 && s.length - at - 1 !== 3) dec = at;
  }
  const int = (dec < 0 ? s : s.slice(0, dec)).replace(/[.,]/g, ''),
    frac = dec < 0 ? '' : s.slice(dec + 1);
  if (/[.,]/.test(frac)) return null;
  const value = Number(`${int}.${frac || 0}`);
  return Number.isFinite(value) ? { value: neg ? -value : value, decimals: frac.length } : null;
}
export const TOTAL = /total|sum|grand|subtotal|gesamt|summe|totale|somme|suma|totaal|合計|合计|总计|итог/i;

/** the words before a number on its line (positions), or in reading order (no positions): its label */
function labelOf(words, i) {
  const w = words[i],
    out = [];
  for (let k = i - 1; k >= 0 && out.length < 3; k--) {
    const v = words[k];
    if (w.x != null && (Math.abs(v.y - w.y) > Math.max(w.h, 1) / 2 || v.x > w.x)) break; // another line
    if (/\p{L}/u.test(v.t)) out.unshift(v.t);
    else if (out.length) break;
  }
  return out.join(' ');
}

/** The differences on one page, and its numbers reconciled. sx, sy: the converted page's coordinates to the original's. */
function diffPage(page, A, B, { tolerance, sx, sy }) {
  const out = [],
    recon = [];
  A.forEach((w, i) => {
    w.i = i;
  });
  B.forEach((w, i) => {
    w.i = i;
  });
  const ops = align(A, B);
  const num = (a, b, status, extra = {}) => {
    const label = labelOf(a ? A : B, (a || b).i);
    recon.push({
      page,
      label,
      total: TOTAL.test(label),
      status,
      original: a?.t,
      converted: b?.t,
      at: pos(a) || pos(b),
      ...extra,
    });
  };
  /** two numbers in the same place: equal (however formatted), a rounding difference, or a mismatch */
  const pairNumbers = (a, b) => {
    const x = parseNumber(a.t),
      y = parseNumber(b.t);
    if (!x || !y) {
      num(a, b, 'mismatched');
      return 'number';
    }
    if (x.value === y.value) {
      num(a, b, 'matched', { formatting: true });
      return null;
    }
    const d = Math.min(x.decimals, y.decimals),
      delta = +(y.value - x.value).toFixed(Math.max(x.decimals, y.decimals, 2));
    const pct = x.value ? +((delta * 100) / Math.abs(x.value)).toFixed(4) : null;
    const rounding = x.decimals !== y.decimals && Math.abs(delta) <= 0.5 * 10 ** -d + 1e-9;
    num(a, b, rounding ? 'rounding' : 'mismatched', { delta, deltaPercent: pct });
    return 'number';
  };
  let del = [],
    add = [];
  const flush = () => {
    // numbers pair with numbers, words with words, in order
    const dn = del.filter((w) => isNumber(w.t)),
      an = add.filter((w) => isNumber(w.t)),
      dw = del.filter((w) => !isNumber(w.t)),
      aw = add.filter((w) => !isNumber(w.t));
    const kn = Math.min(dn.length, an.length);
    for (let i = 0; i < kn; i++) {
      const k = pairNumbers(dn[i], an[i]);
      if (k) out.push({ kind: k, page, original: dn[i].t, converted: an[i].t, at: pos(dn[i]) || pos(an[i]) });
    }
    for (const a of dn.slice(kn)) {
      num(a, null, 'missing');
      out.push({ kind: 'number', page, original: a.t, at: pos(a) });
    }
    for (const b of an.slice(kn)) {
      num(null, b, 'extra');
      out.push({ kind: 'number', page, converted: b.t, at: pos(b) });
    }
    const k = Math.min(dw.length, aw.length);
    for (let i = 0; i < k; i++)
      out.push({ kind: 'changed', page, original: dw[i].t, converted: aw[i].t, at: pos(dw[i]) || pos(aw[i]) });
    for (const a of dw.slice(k)) out.push({ kind: 'missing', page, original: a.t, at: pos(a) });
    for (const b of aw.slice(k)) out.push({ kind: 'extra', page, converted: b.t, at: pos(b) });
    del = [];
    add = [];
  };
  for (const [op, a, b] of ops) {
    if (op === '-') {
      del.push(a);
      continue;
    }
    if (op === '+') {
      add.push(a);
      continue;
    }
    flush();
    if (isNumber(a.t)) num(a, b, 'matched');
    if (a.x == null || b.x == null) continue;
    const dx = b.x * sx - a.x,
      dy = b.y * sy - a.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > tolerance)
      out.push({
        kind: 'moved',
        page,
        original: a.t,
        converted: b.t,
        at: pos(a),
        by: { dx: +dx.toFixed(1), dy: +dy.toFixed(1) },
      });
  }
  flush();
  return { diffs: out, recon };
}

/** the Reconciliation section: every number compared, mismatches first, totals separately */
function reconcile(items) {
  const order = { mismatched: 0, missing: 1, extra: 2, rounding: 3, matched: 4 };
  const sorted = [...items].sort((x, y) => y.total - x.total || order[x.status] - order[y.status] || x.page - y.page);
  const c = (s, l = items) => l.filter((i) => i.status === s).length;
  const totals = sorted.filter((i) => i.total);
  return {
    compared: items.length,
    matched: c('matched'),
    formattingOnly: items.filter((i) => i.formatting).length,
    rounding: c('rounding'),
    mismatched: c('mismatched'),
    missing: c('missing'),
    extra: c('extra'),
    matchPercent: items.length ? +((c('matched') * 100) / items.length).toFixed(2) : 100,
    totals: { compared: totals.length, mismatched: totals.filter((i) => i.status !== 'matched').length, items: totals },
    issues: sorted.filter((i) => i.status !== 'matched'),
  };
}

// ---------- visual ----------
/** a page as greyscale pixels: pdftoppm -gray, a binary PGM */
function raster(file, i, dpi, size) {
  const a = [
    '-gray',
    '-f',
    String(i + 1),
    '-l',
    String(i + 1),
    '-r',
    String(dpi),
    ...(size ? ['-scale-to-x', String(size[0]), '-scale-to-y', String(size[1])] : []),
    file,
  ];
  const r = spawnSync('pdftoppm', a, { timeout: LIMITS.toolTimeoutMs, maxBuffer: 4 * LIMITS.maxPixels + 1024 });
  if (r.error || r.status !== 0 || !r.stdout?.length) return null;
  const m = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(r.stdout.subarray(0, 64).toString('latin1'));
  if (!m) return null;
  const w = +m[1],
    h = +m[2];
  return { w, h, px: r.stdout.subarray(m[0].length, m[0].length + w * h) };
}
/** an RGB PNG (8-bit, filter 0) */
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const grey = (g) => {
  const b = Buffer.alloc(g.length * 3);
  for (let i = 0; i < g.length; i++) b[i * 3] = b[i * 3 + 1] = b[i * 3 + 2] = g[i];
  return b;
};
/** both pages at the original's pixel size; the converted one scaled to it (a different page size is normalised) */
function visualPage(fa, fb, i, dpi, size, same) {
  if (size.w * size.h * (dpi / 72) ** 2 > LIMITS.maxPixels) return { skipped: 'the page is too large to render' };
  const a = raster(fa, i, dpi);
  if (!a) return { skipped: 'the original page did not render' };
  const b = raster(fb, i, dpi, same ? undefined : [a.w, a.h]); // scaled only when the page sizes differ (scaling alone moves pixels)
  if (!b || b.w !== a.w || b.h !== a.h) return { skipped: 'the converted page did not render' };
  const over = Buffer.alloc(a.w * a.h * 3);
  let changed = 0;
  for (let k = 0; k < a.px.length; k++) {
    const o = k * 3;
    if (Math.abs(a.px[k] - b.px[k]) > 48) {
      changed++;
      over[o] = 220;
      over[o + 1] = 30;
      over[o + 2] = 30;
    } else over[o] = over[o + 1] = over[o + 2] = 255 - Math.round((255 - a.px[k]) * 0.25); // the original, faded
  }
  return {
    percent: +((changed * 100) / a.px.length).toFixed(3),
    w: a.w,
    h: a.h,
    images: { original: png(a.w, a.h, grey(a.px)), converted: png(b.w, b.h, grey(b.px)), overlay: png(a.w, a.h, over) },
  };
}

/**
 * Compare two PDFs. @param {Uint8Array} original @param {Uint8Array} converted
 * @param {{ tolerance?: number, visual?: boolean | 'auto', dpi?: number, positions?: boolean | 'auto', threshold?: number, names?: string[] }} [o]
 */
export async function comparePdfs(original, converted, o = {}) {
  const tolerance = o.tolerance ?? 2,
    dpi = Math.min(100, Math.max(72, o.dpi ?? 72)),
    threshold = o.threshold ?? 0;
  const warnings = [];
  const warn = (side) => (m) => warnings.push(`${side}: ${m}`);
  const [A, B] = [
    await readJs(Buffer.from(original), warn('original')),
    await readJs(Buffer.from(converted), warn('converted')),
  ];
  const wantPos = o.positions ?? 'auto',
    wantVis = o.visual ?? 'auto';
  const usePos = wantPos === true || (wantPos === 'auto' && has('pdftotext'));
  const useVis = (!o.numbersOnly && wantVis === true) || (!o.numbersOnly && wantVis === 'auto' && has('pdftoppm'));
  let tmp = null;
  if (usePos || useVis) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-compare-'));
    fs.writeFileSync(path.join(tmp, 'a.pdf'), original);
    fs.writeFileSync(path.join(tmp, 'b.pdf'), converted);
  }
  try {
    if (usePos) {
      const pa = readPoppler(path.join(tmp, 'a.pdf'), A.pages.length, warn('original')),
        pb = readPoppler(path.join(tmp, 'b.pdf'), B.pages.length, warn('converted'));
      if (pa && pb) {
        A.pages.forEach((p, i) => {
          if (pa[i]) p.words = pa[i];
        });
        B.pages.forEach((p, i) => {
          if (pb[i]) p.words = pb[i];
        });
      }
    }
    const differences = [],
      pages = [],
      numbers = [];
    const n = Math.max(A.pages.length, B.pages.length);
    for (let i = 0; i < n; i++) {
      const a = A.pages[i],
        b = B.pages[i];
      const { diffs: all, recon } = diffPage(i + 1, a?.words || [], b?.words || [], {
        tolerance,
        sx: a && b ? a.w / b.w : 1,
        sy: a && b ? a.h / b.h : 1,
      });
      const diffs = o.numbersOnly ? all.filter((d) => d.kind === 'number') : all;
      differences.push(...diffs);
      numbers.push(...recon);
      const page = {
        page: i + 1,
        original: a ? { width: a.w, height: a.h, words: a.words.length } : null,
        converted: b ? { width: b.w, height: b.h, words: b.words.length } : null,
        differences: diffs.length,
      };
      if (useVis && !o.numbersOnly && a && b && i < LIMITS.maxVisualPages)
        page.visual = visualPage(
          path.join(tmp, 'a.pdf'),
          path.join(tmp, 'b.pdf'),
          i,
          dpi,
          { w: a.w, h: a.h },
          Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5,
        );
      pages.push(page);
    }
    if (useVis && n > LIMITS.maxVisualPages)
      warnings.push(`only the first ${LIMITS.maxVisualPages} pages are compared visually`);
    const order = { number: 0, missing: 1, extra: 2, changed: 3, moved: 4 };
    differences.sort((x, y) => order[x.kind] - order[y.kind] || x.page - y.page);
    const count = (k) => differences.filter((d) => d.kind === k).length;
    const words = Math.max(
      1,
      A.pages.reduce((s, p) => s + p.words.length, 0),
    );
    const textPercent = +(((differences.length - count('moved')) * 100) / words).toFixed(3);
    const visualMax = Math.max(0, ...pages.map((p) => p.visual?.percent ?? 0));
    const pageCount = { original: A.pageCount, converted: B.pageCount };
    const serious =
      count('number') + count('missing') + count('extra') + count('changed') + (A.pageCount !== B.pageCount ? 1 : 0);
    const verdict =
      !serious && !count('moved') && visualMax === 0 ? 'Matches' : !serious ? 'Minor differences' : 'Differences found';
    // the CI gate: a number that differs, or a page count, always fails; otherwise the worse of the text and pixel % against --threshold
    const reconciliation = reconcile(numbers);
    // a total that differs (by value, rounding included) always fails
    const pass =
      !reconciliation.totals.mismatched &&
      !count('number') &&
      (o.numbersOnly || (A.pageCount === B.pageCount && Math.max(textPercent, visualMax) <= threshold));
    return {
      verdict,
      pass,
      threshold,
      numbersOnly: !!o.numbersOnly,
      reconciliation,
      names: o.names || ['original.pdf', 'converted.pdf'],
      modes: {
        positions: A.pages.some((p) => p.words[0]?.x != null),
        visual: useVis && !o.numbersOnly,
        tolerance,
        dpi,
      },
      pageCount,
      summary: {
        numbers: count('number'),
        missing: count('missing'),
        extra: count('extra'),
        changed: count('changed'),
        moved: count('moved'),
        textPercent,
        visualMaxPercent: visualMax,
      },
      pages,
      differences,
      warnings,
    };
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** compare.json: the result without the images (they are in the HTML) */
export const toJson = (r) =>
  JSON.stringify(
    { ...r, pages: r.pages.map((p) => (p.visual?.images ? { ...p, visual: { ...p.visual, images: undefined } } : p)) },
    null,
    2,
  ) + '\n';

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const img = (b, alt) => (b ? `<img alt="${esc(alt)}" src="data:image/png;base64,${b.toString('base64')}">` : '');
/** a page sketch: the original's words as boxes, the differences on it highlighted (when the words have positions) */
function sketch(p, diffs, side) {
  const s = p[side];
  if (!s) return '<div class="none">no page</div>';
  const marks = diffs
    .filter((d) => d.at && (side === 'original' ? d.kind !== 'extra' : d.kind !== 'missing'))
    .map(
      (d) =>
        `<rect class="k-${d.kind}" x="${d.at.x - 1}" y="${d.at.y - 1}" width="${d.at.w + 2}" height="${d.at.h + 2}"><title>${esc(`${d.kind}: ${d.original ?? ''} → ${d.converted ?? ''}`)}</title></rect>`,
    )
    .join('');
  return `<svg viewBox="0 0 ${s.width} ${s.height}" role="img" aria-label="${side} page ${p.page}"><rect class="paper" width="${s.width}" height="${s.height}"/>${marks}</svg>`;
}

const reconRow = (i) =>
  `<tr class="r-${i.status}${i.total ? ' total' : ''}"><td><span class="tag">${i.status}</span>${i.formatting ? ' <small>formatting only</small>' : ''}</td><td>${i.page}</td><td>${esc(i.label)}</td><td>${esc(i.original)}</td><td>${esc(i.converted)}</td><td>${i.delta != null ? `${i.delta > 0 ? '+' : ''}${i.delta}${i.deltaPercent != null ? ` (${i.deltaPercent}%)` : ''}` : ''}</td></tr>`;
const reconTable = (l) =>
  `<table><thead><tr><th>Status</th><th>Page</th><th>Label</th><th>Original</th><th>Converted</th><th>Delta</th></tr></thead><tbody>${l.slice(0, 1000).map(reconRow).join('')}</tbody></table>`;
function reconHtml(R) {
  return `<h2>Reconciliation</h2><div class="stats"><div><b>${R.compared}</b>numbers compared</div><div><b>${R.matchPercent}%</b>match exactly</div><div class="num"><b>${R.mismatched}</b>mismatched</div><div><b>${R.rounding}</b>rounding</div><div><b>${R.missing}</b>missing</div><div><b>${R.extra}</b>extra</div><div><b>${R.formattingOnly}</b>equal, formatted differently</div></div>
<h3>Totals: ${R.totals.compared} found, ${R.totals.mismatched ? `<span class="badtxt">${R.totals.mismatched} do not match</span>` : 'all match'}</h3>${R.totals.items.length ? reconTable(R.totals.items) : '<p>No totals found (a label with total, sum, grand, subtotal…).</p>'}
<h3>Number differences</h3>${R.issues.length ? reconTable(R.issues) : '<p>Every number matches.</p>'}`;
}

/** compare.html: self-contained (images inline), full width */
export function toHtml(r) {
  const tone = { Matches: 'ok', 'Minor differences': 'minor', 'Differences found': 'bad' }[r.verdict];
  const S = r.summary;
  const rows = r.differences
    .slice(0, 2000)
    .map(
      (d) =>
        `<tr class="k-${d.kind}"><td><span class="tag">${d.kind === 'number' ? 'number' : d.kind}</span></td><td>${d.page}</td><td>${d.at ? `${d.at.x}, ${d.at.y}` : ''}</td><td>${esc(d.original)}</td><td>${esc(d.converted)}</td><td>${d.by ? `moved ${d.by.dx}, ${d.by.dy} pt` : ''}</td></tr>`,
    )
    .join('');
  const pages = r.pages
    .map((p) => {
      const diffs = r.differences.filter((d) => d.page === p.page);
      const v = p.visual;
      const body = v?.images
        ? `<figure>${img(v.images.original, 'original')}<figcaption>Original</figcaption></figure><figure>${img(v.images.converted, 'converted')}<figcaption>Converted</figcaption></figure><figure>${img(v.images.overlay, 'differences')}<figcaption>Differences (red)</figcaption></figure>`
        : r.modes.positions
          ? `<figure>${sketch(p, diffs, 'original')}<figcaption>Original</figcaption></figure><figure>${sketch(p, diffs, 'converted')}<figcaption>Converted</figcaption></figure>`
          : '';
      return `<section class="page"><h3>Page ${p.page} <small>${p.differences} difference${p.differences === 1 ? '' : 's'}${v?.percent != null ? ` · ${v.percent}% of pixels differ` : v?.skipped ? ` · not rendered: ${esc(v.skipped)}` : ''}${!p.original ? ' · not in the original' : !p.converted ? ' · missing from the converted report' : ''}</small></h3><div class="row">${body}</div></section>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report comparison</title><style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1b1f24;--mute:#5b6470;--line:#d9dde3;--ok:#1f7a3f;--minor:#9a6700;--bad:#c62828}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121417;--card:#1b1f24;--ink:#e8eaed;--mute:#9aa3ad;--line:#2d333b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}main{padding:20px 24px}
.verdict{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--${tone});padding:16px 20px;border-radius:6px}
.verdict h1{margin:0 0 4px;font-size:22px;color:var(--${tone})}.verdict p{margin:2px 0;color:var(--mute)}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.stats div{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px 14px}.stats b{display:block;font-size:20px}
.stats .num b{color:var(--bad)}
table{width:100%;border-collapse:collapse;background:var(--card)}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600}
.tag{font-size:12px;padding:1px 8px;border-radius:10px;border:1px solid var(--line)}tr.k-number .tag{background:var(--bad);color:#fff;border-color:var(--bad)}tr.k-number td{font-weight:600}
.page{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px 16px;margin:12px 0}.page h3{margin:0 0 8px}.page small{color:var(--mute);font-weight:400}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}figure{margin:0}figure img,figure svg{width:100%;height:auto;border:1px solid var(--line);background:#fff}figcaption{color:var(--mute);font-size:12px}
svg .paper{fill:#fff}svg rect[class^=k-]{fill:none;stroke-width:1.5}svg .k-number{stroke:#c62828;fill:rgba(198,40,40,.25)}svg .k-missing,svg .k-extra,svg .k-changed{stroke:#e65100;fill:rgba(230,81,0,.2)}svg .k-moved{stroke:#1565c0;fill:rgba(21,101,192,.15)}
tr.r-mismatched td,tr.r-missing td,tr.r-extra td{color:var(--bad)}tr.r-rounding td{color:var(--minor)}tr.total td:nth-child(3){font-weight:700}.badtxt{color:var(--bad)}
.none{color:var(--mute);padding:24px}ul.warn{color:var(--minor)}
</style></head><body><main>
<div class="verdict"><h1>${esc(r.verdict)}</h1><p>${esc(r.names[0])} (original, ${r.pageCount.original} pages) vs ${esc(r.names[1])} (converted, ${r.pageCount.converted} pages)</p>
<p>${r.pass ? 'Passes' : 'Fails'} the threshold of ${r.threshold}% · words ${r.modes.positions ? `with positions (tolerance ${r.modes.tolerance} pt)` : 'in order (no positions: install poppler-utils for moved-text checks)'} · ${r.modes.visual ? `pixels at ${r.modes.dpi} dpi` : 'no visual comparison (pdftoppm not found)'}</p></div>
<div class="stats"><div class="num"><b>${S.numbers}</b>numbers differ</div><div><b>${S.missing}</b>missing</div><div><b>${S.extra}</b>extra</div><div><b>${S.changed}</b>changed</div><div><b>${S.moved}</b>moved</div><div><b>${S.textPercent}%</b>of words differ</div><div><b>${S.visualMaxPercent}%</b>worst page, pixels</div></div>
${r.warnings.length ? `<ul class="warn">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
${reconHtml(r.reconciliation)}
<h2>Differences${r.differences.length > 2000 ? ` (first 2000 of ${r.differences.length})` : ''}</h2>
${r.differences.length ? `<table><thead><tr><th>Kind</th><th>Page</th><th>Position (pt)</th><th>Original</th><th>Converted</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p>None.</p>'}
<h2>Pages</h2>${pages}
</main></body></html>`;
}

/** the terminal summary */
export function toText(r) {
  const S = r.summary,
    lines = [
      `${r.verdict}: ${r.pageCount.original} → ${r.pageCount.converted} pages; ${S.numbers} numbers, ${S.missing} missing, ${S.extra} extra, ${S.changed} changed, ${S.moved} moved; ${S.textPercent}% of words${r.modes.visual ? `, worst page ${S.visualMaxPercent}% of pixels` : ''}`,
    ];
  const R = r.reconciliation;
  lines.push(
    `Numbers: ${R.compared} compared, ${R.matchPercent}% match exactly, ${R.mismatched} mismatched, ${R.rounding} rounding, ${R.missing} missing, ${R.extra} extra; totals: ${R.totals.compared} found, ${R.totals.mismatched} do not match`,
  );
  for (const i of R.issues.slice(0, 20))
    lines.push(
      `  p${i.page} ${i.total ? 'TOTAL ' : ''}${i.status.padEnd(10)} ${JSON.stringify(i.label)}: ${i.original ?? '-'} → ${i.converted ?? '-'}${i.delta != null ? ` (${i.delta > 0 ? '+' : ''}${i.delta})` : ''}`,
    );
  for (const d of r.differences.filter((d) => d.kind !== 'number').slice(0, 20))
    lines.push(
      `  p${d.page} ${d.kind.padEnd(7)} ${d.original != null ? JSON.stringify(d.original) : ''}${d.converted != null ? ` → ${JSON.stringify(d.converted)}` : ''}${d.by ? ` (${d.by.dx}, ${d.by.dy} pt)` : ''}`,
    );
  if (r.differences.length > 20) lines.push(`  … ${r.differences.length - 20} more (see compare.html)`);
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}
