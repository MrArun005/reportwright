// @ts-check
import { evalValue, evaluate, compile, parseValue, toText } from '../expr/evaluate.js';
import { toDate, isoDate } from '../expr/format.js';

/**
 * Data layer: sources → raw JSON; data sets → typed, filtered, sorted rows.
 */

/** Minimal JSONPath: $, $.a.b, $.a[0].b, $.a[*].b, $['a b'] */
export function jsonPath(obj, path) {
  if (!path || path === '$') return obj;
  const toks = [];
  const re = /\.([A-Za-z_$][\w$]*)|\[(\d+|\*)\]|\['([^']+)'\]|\["([^"]+)"\]/g;
  const p = path.startsWith('$') ? path.slice(1) : '.' + path;
  let m, last = 0;
  while ((m = re.exec(p))) {
    if (m.index !== last) throw new Error(`Bad data path "${path}"`);
    toks.push(m[1] ?? m[3] ?? m[4] ?? (m[2] === '*' ? '*' : Number(m[2])));
    last = re.lastIndex;
  }
  if (last !== p.length) throw new Error(`Bad data path "${path}"`);
  let cur = [obj], spread = false;
  for (const t of toks) {
    const nxt = [];
    for (const c of cur) {
      if (c == null) continue;
      if (t === '*') { if (Array.isArray(c)) nxt.push(...c); else nxt.push(...Object.values(c)); spread = true; }
      else nxt.push(c[t]);
    }
    cur = nxt;
  }
  return spread ? cur : cur[0];
}

/** @param {any} v @param {string} type */
export function coerce(v, type) {
  if (v == null || v === '') return v === '' && type === 'string' ? '' : null;
  switch (type) {
    case 'number': { const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '')); return Number.isNaN(n) ? null : n; }
    case 'date': return toDate(v);
    case 'boolean': return typeof v === 'boolean' ? v : ['true', '1', 'yes', 'y'].includes(String(v).toLowerCase());
    case 'string': return typeof v === 'string' ? v : String(v);
    default: return v;
  }
}

/** Guess field names and types from sample rows. */
export function detectFields(rows) {
  const out = new Map();
  for (const r of rows.slice(0, 50)) {
    if (!r || typeof r !== 'object') continue;
    for (const [k, v] of Object.entries(r)) {
      if (v != null && typeof v === 'object' && !(v instanceof Date)) continue;
      const t = guessType(v);
      if (!out.has(k) || out.get(k) === 'null') out.set(k, t);
      else if (out.get(k) !== t && t !== 'null') out.set(k, 'string');
    }
  }
  return [...out].map(([name, type]) => ({ name, type: type === 'null' ? 'string' : type }));
}
function guessType(v) {
  if (v == null) return 'null';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (v instanceof Date) return 'date';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return 'date';
  return 'string';
}

/** Parse CSV text (RFC 4180-ish) into objects using the first row as headers. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1 || r[0] !== '');
  if (!head) return [];
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/**
 * Load every data source used by the report.
 * @param {any} def
 * @param {{params: object, fetch?: typeof fetch, baseUrl?: string, reportId?: string,
 *   sql?: (src: any, params: Record<string, any>) => Promise<object[]>, sqlPreview?: boolean}} opt
 *   sql: runs a SQL source directly (server renders). Without it the server runs the saved report's
 *   query: the browser sends the report id and source name, never SQL.
 */
export async function loadSources(def, opt) {
  const ctx = { params: opt.params, globals: {}, dataSets: {}, fields: null };
  const out = {};
  const f = opt.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  await Promise.all((def.dataSources || []).map(async (src) => {
    try {
      if (src.type === 'json') out[src.name] = typeof src.data === 'string' ? JSON.parse(src.data) : src.data;
      else if (src.type === 'sql') out[src.name] = await loadSql(src, ctx.params, opt, f);
      else if (src.type === 'csv' && src.data) out[src.name] = parseCsv(src.data);
      else if (src.type === 'rest' || src.type === 'csv' || src.type === 'graphql') {
        if (!f) throw new Error('No fetch() available');
        let url = urlFrom(src.url || '', ctx);
        if (src.useProxy) url = `/api/data/proxy?url=${encodeURIComponent(url)}`;
        if (opt.baseUrl && url.startsWith('/')) url = opt.baseUrl.replace(/\/$/, '') + url;
        const headers = {};
        for (const [k, v] of Object.entries(src.headers || {})) headers[k] = String(evalValue(v, ctx));
        const init = { method: src.type === 'graphql' ? 'POST' : src.method || 'GET', headers };
        if (src.type === 'graphql') {
          headers['content-type'] ||= 'application/json';
          const vars = src.variables ? variablesFrom(src.variables, ctx) : {};
          init.body = JSON.stringify({ query: src.query, variables: vars });
        } else if (src.body && init.method !== 'GET') init.body = String(evalValue(src.body, ctx));
        const res = await f(url, init);
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
        if (src.type === 'csv') out[src.name] = parseCsv(await res.text());
        else {
          const json = await res.json();
          if (src.type === 'graphql' && json.errors?.length) throw new Error(`GraphQL: ${json.errors[0].message}`);
          out[src.name] = src.type === 'graphql' ? json.data : json;
        }
      } else throw new Error(`Unknown data source type "${src.type}"`);
    } catch (e) {
      throw Object.assign(new Error(`Data source "${src.name}": ${e.message}`), { status: e.status }); // keep 403 for a refused address
    }
  }));
  return out;
}

/** A SQL source: run it here (server) or ask the server to run the saved report's query (browser). */
async function loadSql(src, params, opt, f) {
  const day = (v) => (v instanceof Date ? isoDate(v) : v);
  const p = Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(day) : day(v)]));
  if (opt.sql) return opt.sql(src, p);
  if (!f) throw new Error('No fetch() available');
  // sqlPreview: the designer's unsaved query (the server allows it for designers only)
  if (!opt.reportId && !opt.sqlPreview) throw new Error('Save the report first: SQL runs on the server, from the saved report.');
  const url = `${(opt.baseUrl || '').replace(/\/$/, '')}/api/data/sql`;
  const body = opt.sqlPreview ? { connection: src.connection, query: src.query, params: p } : { report: opt.reportId, source: src.name, params: p };
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status} from ${url}`), { status: res.status });
  return json.rows;
}

const plain = (x, ctx) => (x instanceof Date ? isoDate(x) : toText(x, null, ctx));

/** URL from a template: typed-in values are encoded, so "A&B" stays one value. A leading {…} may hold a base URL. */
function urlFrom(v, ctx) {
  const p = parseValue(v);
  if (p.kind !== 'tpl') return String(evalValue(v, ctx) ?? '');
  return p.parts.map((part, i) => {
    if (typeof part === 'string') return part;
    const s = plain(evaluate(part.ast, ctx), ctx);
    return i === 0 ? s : encodeURIComponent(s);
  }).join('');
}

/** GraphQL variables: JSON whose strings may hold {Parameters.x}. A string that is just one {…} keeps the value's type. */
function variablesFrom(src, ctx) {
  let json;
  try { json = JSON.parse(src); } catch { return JSON.parse(String(evalValue(src, ctx))); } // older form: a template that builds JSON
  const fill = (v) => {
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    if (typeof v !== 'string') return v;
    const p = parseValue(v);
    if (p.kind === 'tpl' && p.parts.length === 1 && typeof p.parts[0] !== 'string') {
      const x = evaluate(p.parts[0].ast, ctx);
      return x instanceof Date ? isoDate(x) : x;
    }
    return evalValue(v, ctx);
  };
  return fill(json);
}

/** Wildcards: * any run, ? one character, any case. No regex: at most len(s) × len(pattern) steps, so "a*a*a*…b" cannot hang the server. */
function like(s, p) {
  s = s.toLowerCase(); p = p.toLowerCase();
  let i = 0, j = 0, star = -1, mark = 0;
  while (i < s.length) {
    if (j < p.length && (p[j] === '?' || p[j] === s[i])) { i++; j++; }
    else if (j < p.length && p[j] === '*') { star = j++; mark = i; }
    else if (star >= 0) { j = star + 1; i = ++mark; }
    else return false;
  }
  while (p[j] === '*') j++;
  return j === p.length;
}

/**
 * Build typed rows for every data set.
 * @param {any} def @param {Record<string, any>} sources @param {any} baseCtx
 */
export function buildDataSets(def, sources, baseCtx) {
  /** @type {Record<string, any[]>} */
  const sets = {};
  for (const ds of def.dataSets || []) {
    const raw = sources[ds.source];
    if (raw === undefined) throw new Error(`Data set "${ds.name}": the source "${ds.source}" does not exist`);
    let list = jsonPath(raw, ds.path || '$');
    if (list == null) list = [];
    if (!Array.isArray(list)) list = [list];
    const fields = ds.fields && ds.fields.length ? ds.fields : detectFields(list);
    const plain = fields.filter(fd => !fd.expr);
    const calc = fields.filter(fd => fd.expr);
    let rows = list.map((r) => {
      const o = {};
      for (const fd of plain) o[fd.name] = coerce(fd.path ? jsonPath(r, fd.path) : r?.[fd.name], fd.type);
      return o;
    });
    if (calc.length) {
      const c = { ...baseCtx, fields: null };
      for (const r of rows) { c.fields = r; for (const fd of calc) r[fd.name] = coerce(evalValue(fd.expr, c), fd.type); }
    }
    // filters and sorts may Lookup into the data sets defined above this one
    const setCtx = { ...baseCtx, dataSets: { ...baseCtx.dataSets, ...sets } };
    rows = applyFilters(rows, ds.filters, setCtx);
    rows = applySort(rows, ds.sort, setCtx);
    sets[ds.name] = rows;
  }
  return sets;
}

/** @param {any[]} rows @param {any[]|undefined} filters */
export function applyFilters(rows, filters, baseCtx) {
  if (!filters || !filters.length) return rows;
  const c = { ...baseCtx };
  return rows.filter((r) => {
    c.fields = r;
    return filters.every((f) => {
      const a = evalValue(f.expr, c);
      const b = evalValue(f.value, c);
      switch (f.op || '=') {
        case '=': return looseEq(a, b);
        case '<>': return !looseEq(a, b);
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        case '<=': return a <= b;
        case 'in': {
          // an empty list (nothing picked in a multi-value parameter) means "all"
          const list = Array.isArray(b) ? b : b == null || b === '' ? [] : String(b).split(',').map(s => s.trim());
          return list.length === 0 || list.some(x => looseEq(a, x));
        }
        case 'like': return like(String(a ?? ''), String(b ?? ''));
        case 'contains': return String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase());
        default: throw new Error(`Unknown filter operator "${f.op}"`);
      }
    });
  });
}
function looseEq(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  // eslint-disable-next-line eqeqeq
  return a == b;
}

/** @param {any[]} rows @param {any[]|undefined} sort */
export function applySort(rows, sort, baseCtx) {
  if (!sort || !sort.length) return rows;
  const c = { ...baseCtx };
  const keys = rows.map((r) => { c.fields = r; return sort.map(s => { const v = evalValue(s.by, c); return v instanceof Date ? v.getTime() : v; }); });
  const idx = rows.map((_, i) => i);
  idx.sort((i, j) => {
    for (let k = 0; k < sort.length; k++) {
      const a = keys[i][k], b = keys[j][k];
      if (a === b) continue;
      if (a == null) return 1;
      if (b == null) return -1;
      const r = a < b ? -1 : 1;
      return sort[k].dir === 'desc' ? -r : r;
    }
    return i - j;
  });
  return idx.map(i => rows[i]);
}

export { evaluate, compile };
