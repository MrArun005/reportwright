// @ts-check
/**
 * Horizontal pagination of a laid-out table (spec §3.3): columns that do not fit the body continue on
 * the next page set, with the first `repeat` columns (row headers) drawn again on every set.
 * Works on the page-model items of the finished rows, so every row keeps one height on every set.
 */
import { shiftItems } from './paint.js';

const EPS = 0.01;
const MAX_SETS = 200; // page sets across for one table

/** The left edge of a page-model item. */
export function itemLeft(it) {
  if (it.t === 'text') return it.clip ? it.clip.x : Math.min(...it.lines.map(l => l.x));
  if (it.t === 'line') return Math.min(it.x1, it.x2);
  if (it.t === 'ellipse') return it.cx - it.rx;
  return it.x ?? 0;
}
/** The right edge (the left edge for items without a width). */
function itemRight(it) {
  if (it.t === 'text') return it.clip ? it.clip.x + it.clip.w : Math.max(...it.lines.map(l => l.x + (l.w || 0)));
  if (it.t === 'line') return Math.max(it.x1, it.x2);
  if (it.t === 'ellipse') return it.cx + it.rx;
  return (it.x ?? 0) + (it.w || 0);
}

/** Cut an item to [a, b): rectangles and lines are clamped, text keeps its lines and is clipped (moved to a when it starts left of it). */
function clipTo(it, a, b) {
  const l = itemLeft(it), r = itemRight(it);
  if (l >= a - EPS && r <= b + EPS) return it;
  if (it.t === 'rect' || it.t === 'image' || it.t === 'link') { const x = Math.max(l, a); return { ...it, x, w: Math.max(0, Math.min(r, b) - x) }; }
  if (it.t === 'line') {
    if (it.x1 === it.x2) return it; // a vertical border sits at one x
    const lo = Math.max(l, a), hi = Math.min(r, b);
    return it.x1 <= it.x2 ? { ...it, x1: lo, x2: hi } : { ...it, x1: hi, x2: lo };
  }
  if (it.t === 'text' && it.clip) {
    const dx = Math.max(0, a - it.clip.x); // a header label that spans into this set starts again at its left edge
    const x = it.clip.x + dx;
    return { ...it, lines: it.lines.map(ln => ({ ...ln, x: ln.x + dx })), clip: { ...it.clip, x, w: Math.max(0, Math.min(r, b) - x) } };
  }
  return it;
}

/**
 * @param {{ units: any[], height: number, headerCount: number, headerHeight: number, repeatHeader: boolean,
 *   colX: number[], widths: number[], x: number, repeat: number, room: number, order: 'down' | 'across', pageH: number,
 *   name: string, nextId: () => number, warn: (m: string) => void, shiftLocal: (items: any[], dy: number) => any[] }} o
 * @returns {{ height: number, units: any[], tables: any[], width: number } | null}  null when the columns fit
 */
export function sliceColumns(o) {
  const n = o.widths.length;
  const rep = Math.max(0, Math.min(o.repeat | 0, n - 1));
  const repW = o.widths.slice(0, rep).reduce((s, w) => s + w, 0);
  const avail = o.room - repW;
  if (avail <= 1) { o.warn(`${o.name}: its repeated columns leave no room on the page`); return null; }
  /** column sets after the repeated columns: { from, to, w } */
  const sets = [];
  for (let ci = rep; ci < n; ci++) {
    const last = sets[sets.length - 1];
    if (last && last.w + o.widths[ci] <= avail + EPS) { last.to = ci + 1; last.w += o.widths[ci]; continue; }
    if (o.widths[ci] > avail + EPS) o.warn(`${o.name}: column ${ci + 1} is wider than the page, so it is cut`);
    sets.push({ from: ci, to: ci + 1, w: o.widths[ci] });
  }
  if (sets.length < 2) return null;
  if (sets.length > MAX_SETS) { o.warn(`${o.name}: its columns would fill more than ${MAX_SETS} pages across; the rest are left out`); sets.length = MAX_SETS; }
  const right = o.colX[n - 1] + o.widths[n - 1];
  for (const s of sets) {
    s.a = o.colX[s.from];
    s.b = s.to < n ? o.colX[s.to] : right;
    s.dx = o.x + repW - s.a;
    s.cols = [...o.widths.slice(0, rep), ...o.widths.slice(s.from, s.to)];
  }
  const repEnd = rep ? o.colX[rep] : o.x;
  const colAt = (x) => { let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (o.colX[mid] <= x + EPS) lo = mid; else hi = mid - 1; } return lo; };

  const setOf = new Int32Array(n); // column → its set (-1: repeated)
  setOf.fill(-1);
  sets.forEach((s, k) => { for (let ci = s.from; ci < s.to; ci++) setOf[ci] = k; });
  /**
   * The items of a row sorted into column sets once (an item that spans a set edge goes into each set it reaches):
   * rows × items, not rows × items × sets.
   */
  const bucketsOf = (items) => {
    const rep0 = [], by = sets.map(() => []);
    for (const it of items) {
      const l = itemLeft(it);
      if (l < repEnd - EPS) { rep0.push(it); continue; } // a repeated column
      const r = Math.max(l, itemRight(it));
      const k0 = Math.max(0, setOf[colAt(l)]), k1 = Math.max(k0, setOf[colAt(Math.max(l, r - EPS * 2))]);
      for (let k = k0; k <= k1; k++) by[k].push(it);
    }
    return { rep0, by };
  };
  const cache = new WeakMap();
  /** The items of one row (or its cont items) on one column set. */
  const slice = (items, s, k) => {
    let b = cache.get(items);
    if (!b) { b = bucketsOf(items); cache.set(items, b); }
    const out = [...b.rep0];
    for (const it of b.by[k]) {
      const l = itemLeft(it);
      const r = Math.max(l, itemRight(it));
      if (r <= s.a + EPS || l >= s.b - EPS) continue; // only touches the edge
      let c = clipTo(it, s.a, s.b);
      if (c.t === 'text' && c.cell) {
        // the Word export rebuilds the table of this set: columns re-indexed, spans cut at the set edge
        const col = c.cell.col < rep ? c.cell.col : Math.max(rep, colAt(c.clip?.x ?? l) - s.from + rep);
        c = { ...c, cell: { ...c.cell, col, span: Math.max(1, Math.min(c.cell.span || 1, s.cols.length - col)), cols: s.cols } };
      }
      out.push(...shiftItems([c], s.dx, 0));
    }
    return out;
  };

  const out = [];
  let y = 0;
  const emit = (u, s, k, first) => {
    const si = sets.indexOf(s);
    const c = { ...u, top: y, items: slice(u.items, s, si), x0: o.x, x1: o.x + repW + s.w };
    if (u.cont) c.cont = slice(u.cont, s, si);
    if (u.block) c.block = `${u.block}#${k}`;
    // a numbering section starts once, on the first column set, not again on every set
    if (si > 0 && c.sectionStart) delete c.sectionStart;
    if (first) c.breakBefore = true;
    out.push(c);
    y += u.height;
  };
  const tables = [];
  const head = o.units.slice(0, o.headerCount), rest = o.units.slice(o.headerCount);
  if (o.order === 'across') {
    // page-high row blocks, each shown once per column set, with the header on top (the table starts on a page top)
    const cap = Math.max(1, o.pageH - o.headerHeight);
    const blocks = [];
    let cur = [], h = 0;
    for (const u of rest) {
      if (cur.length && h + u.height > cap + EPS) { blocks.push(cur); cur = []; h = 0; }
      cur.push(u); h += u.height;
    }
    if (cur.length || !blocks.length) blocks.push(cur);
    let k = 0;
    for (const b of blocks) {
      for (const s of sets) {
        k++;
        [...head, ...b].forEach((u, i) => emit({ ...u, keepWithNext: i < head.length || u.keepWithNext }, s, k, i === 0));
      }
    }
  } else {
    // down, then across: every row with the first set, then every row with the next. A numbering section
    // (newSection) is done on all its sets before the next section starts, so its pages stay together.
    const chunks = [[]];
    rest.forEach((u, i) => { if (i > 0 && u.sectionStart) chunks.push([]); chunks[chunks.length - 1].push(u); });
    chunks.forEach((chunk, ch) => sets.forEach((s, k) => {
      const top = y;
      const brk = k > 0 || ch > 0;
      // the header opens the page: it carries the section start, the first row no longer breaks
      const opens = chunk[0]?.sectionStart && k === 0;
      head.forEach((u, i) => emit(i === 0 && opens ? { ...u, sectionStart: true } : u, s, k, i === 0 && brk));
      const headerItems = [];
      for (const u of out.slice(out.length - head.length)) for (const it of o.shiftLocal(u.items.filter(i => i.t !== 'link' && i.t !== 'bookmark'), u.top - top)) headerItems.push(it);
      chunk.forEach((u, i) => emit(i === 0 && head.length ? { ...u, breakBefore: false, sectionStart: false } : u, s, k, i === 0 && brk && !head.length));
      if (o.repeatHeader && o.headerHeight) tables.push({ id: o.nextId(), headerHeight: o.headerHeight, headerItems, x: o.x, x0: o.x, x1: o.x + repW + s.w, top, bottom: y });
    }));
  }
  return { height: y, units: out, tables, width: repW + Math.max(...sets.map(s => s.w)) };
}
