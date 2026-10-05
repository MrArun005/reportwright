// @ts-check
/**
 * Paginator.
 *
 * The body is one vertical strip of units. A unit is atomic: a break may
 * never cut it. The paginator picks, for each page, the lowest break line
 * that fits the page and does not cut any unit.
 *
 * Side by side regions whose rows never line up leave no line that cuts no unit (or only one far up the page). Then
 * the page ends at its limit and each unit that crosses it moves whole to the next page ("ragged" break: each column
 * continues where its own rows stopped, as SSRS paginates regions on their own). A unit is never drawn past the
 * page bottom and never twice.
 *
 * Unit: { top, height, items, breakBefore?, keepWithNext?, keepWithPrevious?, tableId? }
 * Table: { id, top, bottom, headerHeight, headerItems, owner?, depth? }  (strip coordinates; a repeating group header is
 *        one more entry of its table, owner the same, depth its level + 1)
 */

const EPS = 0.01;

/**
 * @param {any[]} units  sorted by top
 * @param {any[]} tables
 * @param {number} pageH  content height available for the body
 * @param {(msg: string) => void} warn
 * @returns {{ top: number, bottom: number, offset: number, repeat: any[], units: any[] }[]}
 */
export function paginate(units, tables, pageH, warn) {
  const end = units.reduce((m, u) => Math.max(m, u.top + u.height), 0);
  const pages = [];
  // nothing with any height (an empty list): still one page, so the page header and footer print
  if (!units.length || end <= EPS) return [{ top: 0, bottom: 0, offset: 0, repeat: [], units }];

  // Candidate break lines: unit tops and bottoms.
  const cand = [...new Set(units.flatMap(u => [u.top, u.top + u.height]).map(v => Math.round(v * 100) / 100))].sort((a, b) => a - b);

  // keep-together blocks: a break may not cut a block that fits on one page
  const blockMap = new Map();
  for (const u of units) if (u.block) {
    const b = blockMap.get(u.block);
    if (b) { b.top = Math.min(b.top, u.top); b.bottom = Math.max(b.bottom, u.top + u.height); }
    else blockMap.set(u.block, { top: u.top, bottom: u.top + u.height });
  }
  const blockUnits = new Map();
  for (const u of units) if (u.block) { let l = blockUnits.get(u.block); if (!l) blockUnits.set(u.block, l = []); l.push(u); }
  const blocks = [...blockMap.values()].filter(b => b.bottom - b.top <= pageH + EPS);
  for (const b of blocks) cand.push(b.top, b.bottom);
  cand.sort((a, b) => a - b);

  // Units are sorted by top. Only units that start within maxH above y can cut y.
  const maxH = units.reduce((m, u) => Math.max(m, u.height), 0);
  const firstAtOrAfter = (v) => { let lo = 0, hi = units.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (units[mid].top < v) lo = mid + 1; else hi = mid; } return lo; };
  /** units already drawn on an earlier page (a ragged break draws units below the next page's top) */
  const placed = new Set();
  const valid = (y) => {
    const from = firstAtOrAfter(y - maxH - 1);
    const to = firstAtOrAfter(y + EPS * 2);
    for (let i = from; i < to + 1 && i < units.length; i++) {
      const u = units[i];
      if (placed.has(u)) continue;
      const b = u.top + u.height;
      if (u.top < y - EPS && b > y + EPS) return false;                 // cuts a unit
      if (u.keepWithNext && Math.abs(b - y) < EPS && b < end - EPS) return false;
      if (u.keepWithPrevious && Math.abs(u.top - y) < EPS) return false;
    }
    for (const bl of blocks) if (bl.top < y - EPS && bl.bottom > y + EPS) return false;
    return true;
  };

  // A page with nothing on it, made so that what starts at y moves to the next page, helps only when that fits
  // a page there. Tall items (or tall items that overlap) that fit no page are cut where this page ends instead:
  // moving them past a gap made a blank page 1.
  const emptyFor = (top, y) => { let f = firstAtOrAfter(top - EPS); while (f < units.length && placed.has(units[f])) f++; return f >= units.length || units[f].top >= y - EPS; };
  /**
   * A ragged break at y: the units that cross y, which then move whole to the next page. Null when that does not work:
   * a crossing unit starts at the page top (no progress) or is taller than a page, a keep-together block or a
   * keep-with rule would be split.
   */
  const ragged = (top, y, room) => {
    const moved = [];
    const movedBlocks = new Set();
    for (let i = firstAtOrAfter(y - maxH - 1); i < units.length && units[i].top < y - EPS; i++) {
      const u = units[i];
      if (placed.has(u) || u.top + u.height <= y + EPS) continue;
      if (u.top <= top + EPS || u.height > room + EPS || u.keepWithPrevious) return null;
      if (u.block) {
        // a keep-together group that fits a page moves whole (its rows above the line too), N8: it vetoed the
        // ragged break, which left page 1 with only the headers and rows past the footer
        const bl = blockMap.get(u.block);
        if (movedBlocks.has(bl)) continue;
        if (!bl || bl.bottom - bl.top > room + EPS || bl.top <= top + EPS) return null;
        movedBlocks.add(bl);
        for (const m of blockUnits.get(u.block)) if (!placed.has(m)) moved.push(m);
        continue;
      }
      moved.push(u);
    }
    if (!moved.length) return null;
    for (const u of units) if (u.keepWithNext && !placed.has(u) && u.top + u.height <= y + EPS && moved.some(m => Math.abs(m.top - (u.top + u.height)) < EPS)) return null;
    for (const bl of blocks) if (!movedBlocks.has(bl) && bl.top < y - EPS && bl.bottom > y + EPS) return null;
    return new Set(moved);
  };
  const fitsFrom = (y) => {
    if (y + pageH >= end - EPS) return true;
    for (const c of cand) if (c > y + EPS && c <= y + pageH + EPS && valid(c)) return true;
    return false;
  };
  const useless = (top, y) => emptyFor(top, y) && !fitsFrom(y);

  // a table too wide for the page (items/hpage.js): the rows that start a page in its first column set start one in
  // every other set too, so pages printed side by side line up
  const gridBreaks = new Map();
  const mirror = (u) => !!(u.hgrid && u.hgrid.set > 0 && u.hgrid.row > 0 && gridBreaks.get(u.hgrid.id)?.has(u.hgrid.row));
  let top = 0, guard = 0, cut = false;
  while (top < end - EPS) {
    if (++guard > 100000) { warn('Pagination stopped: too many pages'); break; }
    if (cut) { // the cut part of an item is not drawn: the next page starts at the next unit, and there is none after the last
      cut = false;
      let f = firstAtOrAfter(top - EPS);
      while (f < units.length && placed.has(units[f])) f++;
      if (f >= units.length) break;
      top = Math.max(top, units[f].top);
    }
    // A page that would begin with a gap and then an item with a page break before it: the break is already met
    // (the item did not fit the page before). The page starts at the item, as a forced break would start it,
    // instead of making a page of the gap alone.
    if (pages.length) {
      const f = firstAtOrAfter(top - EPS);
      for (let i = f; i < units.length && units[i].top < units[f].top + EPS; i++) {
        if ((units[i].breakBefore || mirror(units[i])) && units[i].top > top + EPS) { top = units[i].top; break; }
      }
    }
    // tables that continue onto this page repeat their header
    let repeat = pages.length
      ? tables.filter(t => t.top < top - EPS && t.bottom > top + EPS)
      : [];
    // a repeating group header comes with its table's header (and outer groups'): the deepest one stands for them all
    if (repeat.length > 1) repeat = repeat.filter(t => !t.owner || !repeat.some(r => r !== t && r.owner === t.owner && r.depth > t.depth));
    const offset = repeat.reduce((m, t) => Math.max(m, t.headerHeight), 0);
    let limit = top + Math.max(pageH - offset, 1);

    // forced page breaks (one before the first thing on a page is met already: on the first page it is ignored)
    const firstHere = units[firstAtOrAfter(top - EPS)];
    for (let i = firstAtOrAfter(top - maxH - 1); i < units.length && units[i].top < limit; i++) {
      const u = units[i];
      if (placed.has(u)) continue;
      if ((u.breakBefore || mirror(u)) && u.top > top + EPS && u.top < limit && firstHere.top < u.top - EPS) limit = u.top;
      const ub = u.top + u.height;
      if (u.breakAfter && ub > top + EPS && ub < limit && ub < end - EPS) limit = ub;
    }
    const forced = limit < top + Math.max(pageH - offset, 1) - EPS;

    let bottom, moved = null;
    if (limit >= end - EPS) bottom = end;
    else if (forced && valid(limit)) bottom = limit;
    else {
      bottom = -1;
      // the highest candidate at or below the limit: a binary search, not a scan from the end of the strip
      let lo = 0, hi = cand.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cand[mid] > limit + EPS) hi = mid; else lo = mid + 1; }
      const last = lo - 1;
      for (let i = last; i >= 0; i--) {
        const y = cand[i];
        if (y > limit + EPS) continue;
        if (y <= top + EPS) break;
        if (valid(y) && !useless(top, y)) { bottom = y; break; }
      }
      // the best clean line leaves a quarter of the page or more empty (side by side rows that rarely line up):
      // a ragged break at the limit fills the page instead
      if (!forced && bottom >= 0 && bottom < limit - pageH / 4) {
        const mv = ragged(top, limit, pageH - offset);
        if (mv) { bottom = limit; moved = mv; }
      }
      if (bottom < 0) {
        const mv = ragged(top, limit, pageH - offset);
        if (mv) { bottom = limit; moved = mv; }
      }
      if (bottom < 0) {
        // Nothing valid: drop keep-rules and try again, then cut.
        for (let i = last; i >= 0; i--) {
          const y = cand[i];
          if (y > limit + EPS) continue;
          if (y <= top + EPS) break;
          if (!units.some(u => !placed.has(u) && u.top < y - EPS && u.top + u.height > y + EPS) && !useless(top, y)) { bottom = y; break; }
        }
        if (bottom < 0) {
          bottom = limit;
          cut = true;
          warn(`An item is taller than the page (page ${pages.length + 1}). Its lower part is cut.`);
        }
      }
    }
    const onPage = [];
    for (let i = firstAtOrAfter(top - EPS); i < units.length && units[i].top < bottom - EPS; i++) {
      const u = units[i];
      if (placed.has(u) || moved?.has(u)) continue;
      onPage.push(u);
      if (moved || placed.size) placed.add(u);
    }
    const g0 = onPage.find(u => u.hgrid && u.hgrid.set === 0);
    if (g0 && g0.hgrid.row > 0) { let set = gridBreaks.get(g0.hgrid.id); if (!set) gridBreaks.set(g0.hgrid.id, set = new Set()); set.add(g0.hgrid.row); }
    pages.push({ top, bottom, offset, repeat, units: onPage });
    // after a ragged break the next page starts at the highest unit that moved
    top = moved ? Math.min(...[...moved].map(u => u.top)) : bottom;
  }
  return pages;
}
