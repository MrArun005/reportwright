// @ts-check
// The visual SQL query builder's model → a SELECT statement. Pure (no React): the SQL source dialog shows the result
// live and saves it as the source's query; the model is kept as `builder` so the query reopens as boxes and ticks.
// Values from report parameters are bound (@name), never pasted into the SQL; typed values are quoted literals.
// builder: { tables: [{ name, alias }], columns: [{ t, c }], joins: [{ type, from: { t, c }, to: { t, c } }],
//   filters: [{ t, c, op, param?, value? }], sort: [{ t, c, dir }], limit? }

export const FILTER_OPS = ['=', '<>', '<', '<=', '>', '>=', 'like', 'in', 'is null', 'is not null'];

/** An identifier quoted for the connection's kind (schema.table quotes each part). */
export function quoteId(id, kind) {
  const one = (x) => (kind === 'mysql' ? `\`${x.replace(/`/g, '``')}\`` : kind === 'mssql' ? `[${x.replace(/]/g, ']]')}]` : `"${x.replace(/"/g, '""')}"`);
  return String(id).split('.').map(one).join('.');
}
const lit = (v) => (v !== '' && v != null && !Number.isNaN(Number(v)) ? String(Number(v)) : `'${String(v ?? '').replace(/'/g, "''")}'`);
/** A short alias for a table: its initials, made unique (orders → o, order_items → oi). */
export function aliasFor(name, taken) {
  const base = (String(name).split('.').pop().split(/[_\s]+/).map(w => w[0] || '').join('') || 't').toLowerCase().replace(/\W/g, '') || 't';
  let a = base, k = 2;
  while (taken.has(a)) a = `${base}${k++}`;
  return a;
}

/**
 * @param {any} b the builder model
 * @param {string} [kind] the connection's kind: sqlite, postgres, mysql, mssql, oracle, snowflake, bigquery
 * @returns {string} the SELECT, or '' when no table is chosen
 */
export function buildSql(b, kind = 'sqlite') {
  const tables = b?.tables || [];
  if (!tables.length) return '';
  const q = (x) => quoteId(x, kind);
  const col = (r) => `${r.t}.${q(r.c)}`;
  const cols = (b.columns || []).filter(c => tables.some(t => t.alias === c.t));
  const names = new Map();
  for (const c of cols) names.set(c.c, (names.get(c.c) || 0) + 1);
  const select = cols.length ? cols.map(c => (names.get(c.c) > 1 ? `${col(c)} AS ${q(`${c.t}_${c.c}`)}` : col(c))).join(', ') : `${tables[0].alias}.*`;
  const limit = Number(b.limit) > 0 ? Math.floor(Number(b.limit)) : 0;
  const top = limit && kind === 'mssql' ? `TOP ${limit} ` : '';
  const lines = [`SELECT ${top}${select}`, `FROM ${q(tables[0].name)} ${tables[0].alias}`];
  const joined = new Set([tables[0].alias]);
  for (const t of tables.slice(1)) {
    const js = (b.joins || []).filter(j => (j.from.t === t.alias && joined.has(j.to.t)) || (j.to.t === t.alias && joined.has(j.from.t)));
    if (js.length) lines.push(`${js[0].type === 'left' ? 'LEFT JOIN' : 'JOIN'} ${q(t.name)} ${t.alias} ON ${js.map(j => `${col(j.from)} = ${col(j.to)}`).join(' AND ')}`);
    else lines.push(`CROSS JOIN ${q(t.name)} ${t.alias}`);
    joined.add(t.alias);
  }
  const where = (b.filters || []).filter(f => f.c && tables.some(t => t.alias === f.t)).map(f => {
    if (f.op === 'is null' || f.op === 'is not null') return `${col(f)} ${f.op.toUpperCase()}`;
    const v = f.param ? `@${f.param}` : f.op === 'in' ? String(f.value ?? '').split(',').map(x => lit(x.trim())).join(', ') : lit(f.value);
    return f.op === 'in' ? `${col(f)} IN (${v})` : `${col(f)} ${f.op === 'like' ? 'LIKE' : f.op} ${v}`;
  });
  if (where.length) lines.push(`WHERE ${where.join('\n  AND ')}`);
  const sort = (b.sort || []).filter(s => s.c && tables.some(t => t.alias === s.t));
  if (sort.length) lines.push(`ORDER BY ${sort.map(s => `${col(s)}${s.dir === 'desc' ? ' DESC' : ''}`).join(', ')}`);
  if (limit && kind !== 'mssql') lines.push(kind === 'oracle' ? `FETCH FIRST ${limit} ROWS ONLY` : `LIMIT ${limit}`);
  return lines.join('\n');
}

/**
 * Joins the schema's foreign keys suggest between a table being added and the tables already there.
 * @param {{ name: string, foreignKeys?: { columns: string[], refTable: string, refColumns: string[] }[] }[]} schema
 */
export function suggestJoins(b, schema, alias) {
  const byName = new Map((schema || []).map(t => [t.name, t]));
  const added = (b.tables || []).find(t => t.alias === alias);
  if (!added) return [];
  const out = [];
  for (const other of b.tables || []) {
    if (other.alias === alias) continue;
    for (const [from, to] of [[added, other], [other, added]]) {
      for (const fk of byName.get(from.name)?.foreignKeys || []) {
        if (fk.refTable !== to.name) continue;
        fk.columns.forEach((c, i) => out.push({ type: 'inner', from: { t: from.alias, c }, to: { t: to.alias, c: fk.refColumns[i] ?? fk.refColumns[0] } }));
      }
    }
  }
  return out;
}
