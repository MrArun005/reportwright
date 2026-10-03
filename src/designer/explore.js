// @ts-check
// Response explorer: every array in a JSON response that could be a data set, with the path to it.
// Pure functions (no React), used by the data set dialog.

const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `['${k}']`);
const scalarFields = (rows) => {
  const seen = new Set();
  for (const r of rows.slice(0, 50)) if (r && typeof r === 'object') for (const [k, v] of Object.entries(r)) if (v == null || typeof v !== 'object') seen.add(k);
  return [...seen];
};

/**
 * @param {any} root a parsed response
 * @returns {{ path: string, rows: number, objects: boolean, fields: string[], spreads: number }[]}
 *   path: JSONPath for the data set ([*] where it goes through a list); objects: rows are objects
 */
export function rowArrays(root, maxDepth = 8) {
  const out = [];
  // values: everything at this path (several when the path goes through a list)
  const walk = (values, path, spreads, depth) => {
    if (depth > maxDepth) return;
    const arrays = values.filter(Array.isArray);
    if (arrays.length) {
      const rows = arrays.flat();
      const objects = rows.length > 0 && rows.every(r => r && typeof r === 'object' && !Array.isArray(r));
      // under a list, the path must end in [*] to get the rows themselves, not one array per parent
      out.push({ path: spreads ? `${path}[*]` : path, rows: rows.length, objects, fields: objects ? scalarFields(rows) : [], spreads });
      if (objects) for (const k of new Set(rows.flatMap(o => Object.keys(o)))) walk(rows.map(o => o[k]).filter(v => v !== undefined), `${path}[*]${key(k)}`, spreads + 1, depth + 1);
      return;
    }
    const objs = values.filter(v => v && typeof v === 'object');
    for (const k of new Set(objs.flatMap(o => Object.keys(o)))) walk(objs.map(o => o[k]).filter(v => v !== undefined), `${path}${key(k)}`, spreads, depth + 1);
  };
  walk([root], '$', 0, 0);
  return out;
}

/** The array most likely to be "the rows": the fewest [*] steps, then the most rows. */
export function bestRows(root) {
  const list = rowArrays(root).filter(a => a.objects && a.rows > 0);
  list.sort((a, b) => a.spreads - b.spreads || b.rows - a.rows);
  return list[0] || null;
}
