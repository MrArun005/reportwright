// @ts-check
/** Merge table regions that share a name (a table repeated inside a list). */
export function mergedRegions(model) {
  const map = new Map();
  for (const r of model.regions || []) {
    const m = map.get(r.name);
    if (!m) map.set(r.name, { ...r, rows: [...r.rows] });
    else m.rows.push(...r.rows.filter(row => row.kind !== 'header' || !m.rows.some(x => x.kind === 'header')));
  }
  return [...map.values()];
}
