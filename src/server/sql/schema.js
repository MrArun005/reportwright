// @ts-check
// The server half of the visual SQL builder (docs/COORDINATION.md, "SQL builder payloads").
//   schemaOf(connection): tables, columns (type, key), foreign keys, read through the connection's read-only login,
//     in its query process, under the SQL deadline and caps (sql.js runSql) — the catalog queries are the server's own.
//   buildSql(spec, dialect): a structured query (tables, joins, columns, filters, sort, limit) as one SELECT for that
//     dialect. Names are checked and quoted; every value is a parameter (@pw_1, …, or a report parameter @Name), never
//     text in the SQL. The result runs as any SQL source does (runSql binds the @names).
import { runSql, connectionKind } from '../sql.js';

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const MAX_TABLES = 500, MAX_COLUMNS = 20000;

/** @type {Record<string, { columns: string, fks: string }>} catalog reads; every row: tbl, col, type, pk / tbl, col, ref_table, ref_col */
const CATALOG = {
  sqlite: {
    columns: "SELECT m.name AS tbl, p.name AS col, p.type AS type, p.pk AS pk FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid",
    fks: "SELECT m.name AS tbl, f.\"from\" AS col, f.\"table\" AS ref_table, f.\"to\" AS ref_col FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type = 'table' ORDER BY m.name, f.id, f.seq",
  },
  postgres: {
    columns: "SELECT CASE WHEN c.table_schema = 'public' THEN c.table_name ELSE c.table_schema || '.' || c.table_name END AS tbl, c.column_name AS col, c.data_type AS type, CASE WHEN k.column_name IS NULL THEN 0 ELSE 1 END AS pk FROM information_schema.columns c LEFT JOIN (SELECT ku.table_schema, ku.table_name, ku.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage ku ON ku.constraint_name = tc.constraint_name AND ku.table_schema = tc.table_schema WHERE tc.constraint_type = 'PRIMARY KEY') k ON k.table_schema = c.table_schema AND k.table_name = c.table_name AND k.column_name = c.column_name WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, c.ordinal_position",
    fks: "SELECT CASE WHEN tc.table_schema = 'public' THEN tc.table_name ELSE tc.table_schema || '.' || tc.table_name END AS tbl, kcu.column_name AS col, CASE WHEN ccu.table_schema = 'public' THEN ccu.table_name ELSE ccu.table_schema || '.' || ccu.table_name END AS ref_table, ccu.column_name AS ref_col FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' ORDER BY 1, 2",
  },
  mysql: {
    columns: "SELECT c.table_name AS tbl, c.column_name AS col, c.data_type AS type, CASE WHEN c.column_key = 'PRI' THEN 1 ELSE 0 END AS pk FROM information_schema.columns c WHERE c.table_schema = DATABASE() ORDER BY c.table_name, c.ordinal_position",
    fks: "SELECT k.table_name AS tbl, k.column_name AS col, k.referenced_table_name AS ref_table, k.referenced_column_name AS ref_col FROM information_schema.key_column_usage k WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL ORDER BY 1, 2",
  },
  mssql: {
    columns: "SELECT CASE WHEN c.TABLE_SCHEMA = 'dbo' THEN c.TABLE_NAME ELSE c.TABLE_SCHEMA + '.' + c.TABLE_NAME END AS tbl, c.COLUMN_NAME AS col, c.DATA_TYPE AS type, CASE WHEN k.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS pk FROM INFORMATION_SCHEMA.COLUMNS c LEFT JOIN (SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY') k ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME ORDER BY 1, c.ORDINAL_POSITION",
    fks: "SELECT CASE WHEN sp.name = 'dbo' THEN tp.name ELSE sp.name + '.' + tp.name END AS tbl, cp.name AS col, CASE WHEN sr.name = 'dbo' THEN tr.name ELSE sr.name + '.' + tr.name END AS ref_table, cr.name AS ref_col FROM sys.foreign_key_columns fkc JOIN sys.tables tp ON tp.object_id = fkc.parent_object_id JOIN sys.schemas sp ON sp.schema_id = tp.schema_id JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id JOIN sys.tables tr ON tr.object_id = fkc.referenced_object_id JOIN sys.schemas sr ON sr.schema_id = tr.schema_id JOIN sys.columns cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id ORDER BY 1, 2",
  },
};

/**
 * { dialect, tables: [{ name, columns: [{ name, type, key }] }], relations: [{ from: { table, column }, to: { table, column } }], truncated }
 * @param {string} connection
 */
export async function schemaOf(connection) {
  const dialect = connectionKind(connection);
  const cat = CATALOG[dialect];
  if (!cat) throw fail(`The SQL builder does not read ${dialect} catalogs yet: write the query.`, 400);
  const [cols, fks] = await Promise.all([runSql({ connection, query: cat.columns }, {}, { catalog: true }), runSql({ connection, query: cat.fks }, {}, { catalog: true })]);
  /** @type {Map<string, { name: string, columns: { name: string, type: string, key: boolean }[] }>} */
  const tables = new Map();
  let truncated = false;
  for (const r of cols.slice(0, MAX_COLUMNS)) {
    const name = String(r.tbl ?? r.TBL);
    if (!tables.has(name)) { if (tables.size >= MAX_TABLES) { truncated = true; continue; } tables.set(name, { name, columns: [] }); }
    tables.get(name)?.columns.push({ name: String(r.col ?? r.COL), type: String(r.type ?? r.TYPE ?? '').toLowerCase(), key: Number(r.pk ?? r.PK) > 0 });
  }
  if (cols.length > MAX_COLUMNS) truncated = true;
  const relations = fks.map(r => ({ from: { table: String(r.tbl ?? r.TBL), column: String(r.col ?? r.COL) }, to: { table: String(r.ref_table ?? r.REF_TABLE), column: String(r.ref_col ?? r.REF_COL) } }))
    .filter(x => tables.has(x.from.table) && tables.has(x.to.table));
  return { dialect, tables: [...tables.values()], relations, truncated };
}

/* ---------------- building a query ---------------- */

const IDENT = /^[A-Za-z_][A-Za-z0-9_$ ]{0,127}$/; // a table or column name; "schema.table" is two of these
const quote = (d, id) => (d === 'mysql' ? `\`${id.replace(/`/g, '``')}\`` : d === 'mssql' ? `[${id.replace(/]/g, ']]')}]` : `"${id.replace(/"/g, '""')}"`);
const OPS = new Set(['=', '<>', '<', '<=', '>', '>=', 'like', 'not like', 'in', 'not in', 'between', 'is null', 'is not null']);
const AGGS = { sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX', count: 'COUNT', count_distinct: 'COUNT' };
const JOINS = { inner: 'INNER JOIN', left: 'LEFT JOIN', right: 'RIGHT JOIN', full: 'FULL OUTER JOIN' };
const MAX_PARTS = 200;

/**
 * The SQL for a structured query: { sql, parameters: [{ name, value }] } (the values of @pw_1, @pw_2, …; @Name for
 * a filter tied to a report parameter is not in the list: the report fills it).
 * @param {any} spec see docs/COORDINATION.md @param {string} dialect
 */
export function buildSql(spec, dialect) {
  if (!spec || typeof spec !== 'object') throw fail('Send { tables, joins?, columns, filters?, sort?, limit? }.');
  if (!['sqlite', 'postgres', 'mysql', 'mssql', 'oracle'].includes(dialect)) throw fail(`The SQL builder does not write ${dialect} yet.`);
  const tables = Array.isArray(spec.tables) ? spec.tables : [];
  if (!tables.length || tables.length > 32) throw fail('Give one to 32 tables.');
  const parts = (n) => { const a = String(n ?? '').split('.'); if (a.length > 2 || !a.every(x => IDENT.test(x))) throw fail(`"${String(n).slice(0, 80)}" is not a table or column name.`); return a; };
  const tableSql = (n) => parts(n).map(x => quote(dialect, x)).join('.');
  const aliases = new Map(); // alias → true
  const alias = (t, i) => {
    const a = t.alias ?? `t${i + 1}`;
    if (!IDENT.test(String(a)) || /\s/.test(String(a)) || aliases.has(a)) throw fail(`"${String(a).slice(0, 40)}" cannot be a table alias here.`);
    aliases.set(a, true);
    return a;
  };
  const from = tables.slice(0, 1).map((t, i) => `${tableSql(t.name)} ${quote(dialect, alias(t, i))}`)[0];
  const joins = (Array.isArray(spec.joins) ? spec.joins : []).slice(0, 31).map((j, i) => {
    const kind = JOINS[j.type || 'inner'];
    if (!kind) throw fail(`A join is inner, left, right or full, not "${String(j.type).slice(0, 20)}".`);
    if (dialect === 'sqlite' && (j.type === 'right' || j.type === 'full')) throw fail('SQLite (before 3.39) has no right or full joins: swap the tables and use left.');
    const a = alias(j, tables.length + i);
    const on = (Array.isArray(j.on) ? j.on : []).map(c => `${col(c.left)} = ${col(c.right)}`);
    if (!on.length) throw fail('A join needs at least one pair of columns in "on".');
    return `${kind} ${tableSql(j.table)} ${quote(dialect, a)} ON ${on.join(' AND ')}`;
  });
  function col(ref) { // "alias.column" (or a bare column with one table)
    const s = String(ref ?? '');
    const i = s.indexOf('.');
    const [a, c] = i < 0 ? [aliases.size === 1 ? [...aliases.keys()][0] : '', s] : [s.slice(0, i), s.slice(i + 1)];
    if (!aliases.has(a)) throw fail(`"${s.slice(0, 80)}": name the table it comes from ("alias.column").`);
    if (!IDENT.test(c)) throw fail(`"${c.slice(0, 80)}" is not a column name.`);
    return `${quote(dialect, a)}.${quote(dialect, c)}`;
  }
  const parameters = [];
  const value = (v) => {
    if (v && typeof v === 'object' && typeof v.param === 'string') { if (!/^[A-Za-z_]\w{0,63}$/.test(v.param)) throw fail('A report parameter name is letters, digits and _.'); return `@${v.param}`; }
    if (v != null && !['string', 'number', 'boolean'].includes(typeof v)) throw fail('A filter value is text, a number, true/false, or { param: "Name" }.');
    if (parameters.length >= MAX_PARTS) throw fail('Too many values in the filters.');
    parameters.push({ name: `pw_${parameters.length + 1}`, value: v });
    return `@pw_${parameters.length}`;
  };
  const columns = (Array.isArray(spec.columns) ? spec.columns : []).slice(0, MAX_PARTS);
  if (!columns.length) throw fail('Choose at least one column.');
  const anyAgg = columns.some(c => c.agg);
  const select = columns.map((c) => {
    const ref = c.column === '*' && c.agg === 'count' ? '*' : col(c.table ? `${c.table}.${c.column}` : c.column);
    const as = c.as != null ? ` AS ${quote(dialect, (() => { if (!IDENT.test(String(c.as))) throw fail(`"${String(c.as).slice(0, 40)}" cannot be a column name.`); return String(c.as); })())}` : '';
    if (!c.agg) return `${ref}${as}`;
    if (!AGGS[c.agg]) throw fail(`"${String(c.agg).slice(0, 20)}" is not sum, avg, min, max, count or count_distinct.`);
    return `${AGGS[c.agg]}(${c.agg === 'count_distinct' ? 'DISTINCT ' : ''}${ref})${as}`;
  });
  const where = (Array.isArray(spec.filters) ? spec.filters : []).slice(0, MAX_PARTS).map((f) => {
    const op = String(f.op || '=').toLowerCase();
    if (!OPS.has(op)) throw fail(`"${op.slice(0, 20)}" is not a filter operator.`);
    const c = col(f.column);
    if (op === 'is null' || op === 'is not null') return `${c} ${op.toUpperCase()}`;
    if (op === 'between') { const [a, b] = Array.isArray(f.values) ? f.values : []; return `${c} BETWEEN ${value(a)} AND ${value(b)}`; }
    if (op === 'in' || op === 'not in') {
      if (f.value?.param) return `${c} ${op.toUpperCase()} (${value(f.value)})`; // a multi-value report parameter
      const list = Array.isArray(f.values) ? f.values : [];
      if (!list.length) throw fail('"in" needs at least one value.');
      return `${c} ${op.toUpperCase()} (${list.map(value).join(', ')})`;
    }
    return `${c} ${op.toUpperCase()} ${value(f.value)}`;
  });
  const groupBy = anyAgg ? columns.filter(c => !c.agg).map(c => col(c.table ? `${c.table}.${c.column}` : c.column)) : [];
  const order = (Array.isArray(spec.sort) ? spec.sort : []).slice(0, 32).map(s => {
    const dir = String(s.dir || 'asc').toLowerCase();
    if (dir !== 'asc' && dir !== 'desc') throw fail('A sort is asc or desc.');
    const byAlias = s.column && columns.some(c => c.as === s.column) && IDENT.test(String(s.column));
    return `${byAlias ? quote(dialect, String(s.column)) : col(s.column)} ${dir.toUpperCase()}`;
  });
  const limit = spec.limit == null ? null : Number(spec.limit);
  if (limit != null && !(Number.isInteger(limit) && limit > 0 && limit <= 1000000)) throw fail('The limit is a whole number from 1 to 1,000,000.');
  const top = limit != null && dialect === 'mssql' ? `TOP (${limit}) ` : '';
  let sql = `SELECT ${top}${select.join(', ')}\nFROM ${from}`;
  if (joins.length) sql += `\n${joins.join('\n')}`;
  if (where.length) sql += `\nWHERE ${where.join('\n  AND ')}`;
  if (groupBy.length) sql += `\nGROUP BY ${groupBy.join(', ')}`;
  if (order.length) sql += `\nORDER BY ${order.join(', ')}`;
  if (limit != null && dialect !== 'mssql') sql += dialect === 'oracle' ? `\nFETCH FIRST ${limit} ROWS ONLY` : `\nLIMIT ${limit}`;
  return { sql, parameters };
}
