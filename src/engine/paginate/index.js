// @ts-check
/**
 * Paginator.
 *
 * The body is one vertical strip of units. A unit is atomic: a break may
 * never cut it. The paginator picks, for each page, the lowest break line
 * that fits the page and does not cut any unit.
 *
 * Unit: { top, height, items, breakBefore?, keepWithNext?, keepWithPrevious?, tableId? }
 * Table: { id, top, bottom, headerHeight, headerItems }  (strip coordinates)
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
  if (!units.length) return [{ top: 0, bottom: 0, offset: 0, repeat: [], units: [] }];

  // Candidate break lines: unit tops and bottoms.
  const cand = [...new Set(units.flatMap(u => [u.top, u.top + u.height]).map(v => Math.round(v * 100) / 100))].sort((a, b) => a - b);

  // keep-together blocks: a break may not cut a block that fits on one page
  const blockMap = new Map();
  for (const u of units) if (u.block) {
    const b = blockMap.get(u.block);
    if (b) { b.top = Math.min(b.top, u.top); b.bottom = Math.max(b.bottom, u.top + u.height); }
    else blockMap.set(u.block, { top: u.top, bottom: u.top + u.height });
  }
  const blocks = [...blockMap.values()].filter(b => b.bottom - b.top <= pageH + EPS);
  for (const b of blocks) cand.push(b.top, b.bottom);
  cand.sort((a, b) => a - b);

  // Units are sorted by top. Only units that start within maxH above y can cut y.
  const maxH = units.reduce((m, u) => Math.max(m, u.height), 0);
  const firstAtOrAfter = (v) => { let lo = 0, hi = units.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (units[mid].top < v) lo = mid + 1; else hi = mid; } return lo; };
  const valid = (y) => {
    const from = firstAtOrAfter(y - maxH - 1);
    const to = firstAtOrAfter(y + EPS * 2);
    for (let i = from; i < to + 1 && i < units.length; i++) {
      const u = units[i];
      const b = u.top + u.height;
      if (u.top < y - EPS && b > y + EPS) return false;                 // cuts a unit
      if (u.keepWithNext && Math.abs(b - y) < EPS && b < end - EPS) return false;
      if (u.keepWithPrevious && Math.abs(u.top - y) < EPS) return false;
    }
    for (const bl of blocks) if (bl.top < y - EPS && bl.bottom > y + EPS) return false;
    return true;
  };

  let top = 0, guard = 0;
  while (top < end - EPS) {
    if (++guard > 100000) { warn('Pagination stopped: too many pages'); break; }
    // tables that continue onto this page repeat their header
    const repeat = pages.length
      ? tables.filter(t => t.top < top - EPS && t.bottom > top + EPS)
      : [];
    const offset = repeat.reduce((m, t) => Math.max(m, t.headerHeight), 0);
    let limit = top + Math.max(pageH - offset, 1);

    // forced page breaks
    for (let i = firstAtOrAfter(top - maxH - 1); i < units.length && units[i].top < limit; i++) {
      const u = units[i];
      if (u.breakBefore && u.top > top + EPS && u.top < limit) limit = u.top;
      const ub = u.top + u.height;
      if (u.breakAfter && ub > top + EPS && ub < limit && ub < end - EPS) limit = ub;
    }
    const forced = limit < top + Math.max(pageH - offset, 1) - EPS;

    let bottom;
    if (limit >= end - EPS) bottom = end;
    else if (forced && valid(limit)) bottom = limit;
    else {
      bottom = -1;
      for (let i = cand.length - 1; i >= 0; i--) {
        const y = cand[i];
        if (y > limit + EPS) continue;
        if (y <= top + EPS) break;
        if (valid(y)) { bottom = y; break; }
      }
      if (bottom < 0) {
        // Nothing valid: drop keep-rules and try again, then cut.
        for (let i = cand.length - 1; i >= 0; i--) {
          const y = cand[i];
          if (y > limit + EPS) continue;
          if (y <= top + EPS) break;
          if (!units.some(u => u.top < y - EPS && u.top + u.height > y + EPS)) { bottom = y; break; }
        }
        if (bottom < 0) {
          bottom = limit;
          warn(`An item is taller than the page (page ${pages.length + 1}). Its lower part is cut.`);
        }
      }
    }
    const onPage = [];
    for (let i = firstAtOrAfter(top - EPS); i < units.length && units[i].top < bottom - EPS; i++) onPage.push(units[i]);
    pages.push({ top, bottom, offset, repeat, units: onPage });
    top = bottom;
  }
  return pages;
}
