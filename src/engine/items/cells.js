// @ts-check
/**
 * A table row's cells by column (null where nothing starts). Two forms, both accepted:
 * - one entry per column, null under a colSpan (ReportWright's own form);
 * - RDL / HTML style: the row has fewer cells than columns and spans, the spanned cells are omitted.
 * covered: [k, j] pairs, cell k (0-based, own form) sits under the colSpan of cell j; it is not drawn.
 * @param {any} cells @param {number} ncols @returns {{ at: any[], covered: [number, number][] }}
 */
export function rowCells(cells, ncols) {
  const list = Array.isArray(cells) ? cells : [];
  const span = (c) => Math.max(1, Math.floor(Number(c?.colSpan)) || 1);
  const at = new Array(ncols).fill(null);
  /** @type {[number, number][]} */
  const covered = [];
  if (list.length < ncols && list.some(c => span(c) > 1)) {
    let pos = 0;
    for (const c of list) { if (pos >= ncols) break; at[pos] = c ?? null; pos += span(c); }
    return { at, covered };
  }
  let until = -1, by = -1;
  for (let k = 0; k < Math.min(list.length, ncols); k++) {
    const c = list[k];
    if (k <= until) { if (c) covered.push([k, by]); continue; }
    at[k] = c ?? null;
    if (span(c) > 1) { until = k + span(c) - 1; by = k; }
  }
  return { at, covered };
}
