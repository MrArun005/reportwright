// @ts-check
import { parse, ExprError } from './parser.js';
import { formatValue, formatDate, english, toDate, roundHalfAway } from './format.js';

/**
 * @typedef {object} EvalCtx
 * @property {Record<string, any>|null} [fields]   current row
 * @property {Record<string, any>} params
 * @property {Record<string, any>} globals
 * @property {any[]} [aggRows]                       rows for aggregates in the current scope
 * @property {any[]} [runningRows]                   rows from scope start up to the current row
 * @property {number} [rowNumber]
 * @property {Record<string, any[]>} dataSets
 * @property {string} [locale]
 * @property {string} [currency]
 */

const ROOTS = { fields: 'Fields', parameters: 'Parameters', globals: 'Globals', parent: 'Parent' };

/* ------------------------------------------------------------------ cache */
const astCache = new Map();
/** @param {string} src */
export function compile(src) {
  let a = astCache.get(src);
  if (!a) {
    a = parse(src);
    if (astCache.size > 5000) astCache.clear();
    astCache.set(src, a);
  }
  return a;
}

/* ------------------------------------------------------------- templates */
const tplCache = new Map();
/**
 * A value is: a literal, "=expression", or a text with {expression} parts.
 * "{{" and "}}" give literal braces.
 * @param {any} v
 */
export function parseValue(v) {
  if (typeof v !== 'string') return { kind: 'lit', v };
  let p = tplCache.get(v);
  if (p) return p;
  if (v.startsWith('=')) p = { kind: 'expr', ast: compile(v.slice(1)) };
  else if (!v.includes('{')) p = { kind: 'lit', v };
  else {
    const parts = [];
    let i = 0, buf = '';
    while (i < v.length) {
      if (v.startsWith('{{', i)) { buf += '{'; i += 2; continue; }
      if (v.startsWith('}}', i)) { buf += '}'; i += 2; continue; }
      if (v[i] === '{') {
        const end = findClose(v, i + 1);
        if (end < 0) throw new ExprError('A "{" has no closing "}"', i, v);
        if (buf) { parts.push(buf); buf = ''; }
        parts.push({ ast: compile(v.slice(i + 1, end)) });
        i = end + 1; continue;
      }
      buf += v[i++];
    }
    if (buf) parts.push(buf);
    p = { kind: 'tpl', parts };
  }
  if (tplCache.size > 5000) tplCache.clear();
  tplCache.set(v, p);
  return p;
}
function findClose(s, i) {
  let q = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '}') return i;
  }
  return -1;
}

/** True when a value holds an expression. */
export function isDynamic(v) {
  return typeof v === 'string' && (v.startsWith('=') || /\{[^{]/.test(v));
}

/**
 * Evaluate a property value. Expressions give raw values; templates give strings.
 * @param {any} v @param {EvalCtx} ctx
 */
export function evalValue(v, ctx) {
  const p = parseValue(v);
  if (p.kind === 'lit') return p.v;
  if (p.kind === 'expr') return evaluate(p.ast, ctx);
  let out = '';
  for (const part of p.parts) out += typeof part === 'string' ? part : toText(evaluate(part.ast, ctx), null, ctx);
  return out;
}

/** @param {any} v @param {string|null|undefined} fmt @param {EvalCtx} ctx */
export function toText(v, fmt, ctx) {
  return formatValue(v, fmt, { locale: ctx.locale, currency: ctx.currency });
}

/** Check syntax only. Returns null or an error message. */
export function checkValue(v) {
  try { parseValue(v); return null; } catch (e) { return e.message; }
}

/* ------------------------------------------------------------- evaluator */
/** @param {any} n @param {EvalCtx} ctx @returns {any} */
export function evaluate(n, ctx) {
  switch (n.type) {
    case 'lit': return n.v;
    case 'id': {
      const r = ROOTS[n.name.toLowerCase()];
      if (r) return { __root: r };
      throw new ExprError(`Unknown name "${n.name}". Use Fields.x, Parameters.x, Globals.x or Parent.x`, n.p);
    }
    case 'member': {
      const o = evaluate(n.obj, ctx);
      return member(o, n.prop, ctx);
    }
    case 'index': {
      const o = evaluate(n.obj, ctx);
      return member(o, String(evaluate(n.key, ctx)), ctx);
    }
    case 'unary': {
      const v = evaluate(n.arg, ctx);
      if (n.op === 'neg') return v == null ? null : -Number(v);
      return !truthy(v);
    }
    case 'cond': return truthy(evaluate(n.test, ctx)) ? evaluate(n.a, ctx) : evaluate(n.b, ctx);
    case 'bin': return binary(n, ctx);
    case 'call': return call(n, ctx);
  }
  throw new ExprError('Bad expression node');
}

function member(o, prop, ctx) {
  if (o && o.__root) {
    const src = o.__root === 'Fields' ? ctx.fields : o.__root === 'Parameters' ? ctx.params : o.__root === 'Parent' ? ctx.parentFields : ctx.globals;
    if (!src) return null;
    if (prop in src) return src[prop];
    const lower = prop.toLowerCase();
    for (const k of Object.keys(src)) if (k.toLowerCase() === lower) return src[k];
    if (o.__root === 'Fields' && ctx.fields && Object.keys(ctx.fields).length) throw new ExprError(`The field "${prop}" does not exist`);
    if (o.__root === 'Parameters') throw new ExprError(`The parameter "${prop}" does not exist`);
    return null;
  }
  if (o == null) return null;
  if (prop === 'Value') return o;
  if (typeof o === 'object') return o[prop] ?? null;
  return null;
}

export function truthy(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v !== '' && v.toLowerCase() !== 'false';
  return Boolean(v);
}
const num = (v) => (v == null || v === '' ? null : v instanceof Date ? v.getTime() : Number(v));
function cmpVal(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && !Number.isNaN(Number(b))) b = Number(b);
  if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '' && !Number.isNaN(Number(a))) a = Number(a);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function binary(n, ctx) {
  const op = n.op;
  if (op === 'and' || op === '&&') return truthy(evaluate(n.a, ctx)) && truthy(evaluate(n.b, ctx));
  if (op === 'or' || op === '||') return truthy(evaluate(n.a, ctx)) || truthy(evaluate(n.b, ctx));
  const a = evaluate(n.a, ctx), b = evaluate(n.b, ctx);
  switch (op) {
    case '&': return toText(a, null, ctx) + toText(b, null, ctx);
    case '+':
      if (typeof a === 'string' || typeof b === 'string') return (a ?? '') + '' + (b ?? '');
      if (a == null || b == null) return null;
      return Number(a) + Number(b);
    case '-': return a == null || b == null ? null : num(a) - num(b);
    case '*': return a == null || b == null ? null : num(a) * num(b);
    case '/': {
      if (a == null || b == null) return null;
      const d = num(b);
      return d === 0 ? null : num(a) / d;
    }
    case '%': return a == null || b == null ? null : num(a) % num(b);
    case '=': case '==':
      if (a == null || b == null) return a == null && b == null;
      return cmpVal(a, b) === 0;
    case '<>': case '!=':
      if (a == null || b == null) return !(a == null && b == null);
      return cmpVal(a, b) !== 0;
    case '<': return a != null && b != null && cmpVal(a, b) < 0;
    case '<=': return a != null && b != null && cmpVal(a, b) <= 0;
    case '>': return a != null && b != null && cmpVal(a, b) > 0;
    case '>=': return a != null && b != null && cmpVal(a, b) >= 0;
  }
  throw new ExprError(`Unknown operator "${op}"`);
}

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString('en', { month: 'long' }));

/* ------------------------------------------------------------- aggregates */
function scopeRows(args, idx, ctx, fname) {
  if (args.length > idx) {
    const s = evaluate(args[idx], ctx);
    const rows = ctx.scopes?.[s]?.rows || ctx.dataSets[s];
    if (!rows) throw new ExprError(`${fname}: the scope "${s}" does not exist`);
    return rows;
  }
  if (ctx.aggRows) return ctx.aggRows;
  return ctx.fields ? [ctx.fields] : [];
}
/**
 * RunningValue cache: each row's value of an expression, per row array, extended as the prefix grows. A group of n
 * rows then costs n evaluations instead of n²/2. Only for expressions that read the row alone (no aggregates,
 * whose result would depend on the prefix), over arrays that only grow (a scope's run) or never change.
 */
const RUN_CACHE = new WeakMap();
function prefixValues(base, n, ast, ctx) {
  let byAst = RUN_CACHE.get(base);
  if (!byAst) { byAst = new Map(); RUN_CACHE.set(base, byAst); }
  let vals = byAst.get(ast);
  if (!vals) { vals = []; byAst.set(ast, vals); }
  if (vals.length < n) {
    const c = Object.assign({}, ctx, { aggRows: base }); // row-local: nothing reads aggRows
    for (let i = vals.length; i < n; i++) { c.fields = base[i]; vals.push(evaluate(ast, c)); }
  }
  return vals.length === n ? vals : vals.slice(0, n);
}
const ROW_LOCAL = new WeakMap();
const SCOPED = new Set(['countrows', 'rownumber', 'runningvalue']);
/** True when an expression reads only the current row (and parameters): no aggregate, RowNumber or RunningValue. */
function rowLocal(ast) {
  let r = ROW_LOCAL.get(ast);
  if (r === undefined) {
    const walk = (n) => !n || typeof n !== 'object' || (Array.isArray(n) ? n.every(walk)
      : !(n.type === 'call' && (n.name.toLowerCase() in AGG || SCOPED.has(n.name.toLowerCase()))) && Object.values(n).every(walk));
    r = walk(ast);
    ROW_LOCAL.set(ast, r);
  }
  return r;
}

function mapRows(rows, ast, ctx) {
  const c = Object.assign({}, ctx, { aggRows: rows });
  const out = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) { c.fields = rows[i]; out[i] = evaluate(ast, c); }
  return out;
}
const AGG = {
  sum: (vals) => { let s = 0, any = false; for (const v of vals) if (v != null && v !== '') { s += Number(v); any = true; } return any ? s : 0; },
  avg: (vals) => { let s = 0, c = 0; for (const v of vals) if (v != null && v !== '') { s += Number(v); c++; } return c ? s / c : null; },
  count: (vals) => vals.filter(v => v != null).length,
  countdistinct: (vals) => new Set(vals.filter(v => v != null).map(v => (v instanceof Date ? v.getTime() : v))).size,
  min: (vals) => { let m = null; for (const v of vals) if (v != null && (m == null || cmpVal(v, m) < 0)) m = v; return m; },
  max: (vals) => { let m = null; for (const v of vals) if (v != null && (m == null || cmpVal(v, m) > 0)) m = v; return m; },
  first: (vals) => (vals.length ? vals[0] : null),
  last: (vals) => (vals.length ? vals[vals.length - 1] : null),
};

/* --------------------------------------------------------------- dates */
function dateAdd(interval, n, d) {
  d = toDate(d); if (!d) return null;
  const r = new Date(d.getTime());
  n = Number(n);
  switch (String(interval).toLowerCase()) {
    case 'yyyy': case 'year': r.setFullYear(r.getFullYear() + n); break;
    case 'q': case 'quarter': r.setMonth(r.getMonth() + 3 * n); break;
    case 'm': case 'month': r.setMonth(r.getMonth() + n); break;
    case 'ww': case 'week': r.setDate(r.getDate() + 7 * n); break;
    case 'd': case 'day': r.setDate(r.getDate() + n); break;
    case 'h': case 'hour': r.setHours(r.getHours() + n); break;
    case 'n': case 'minute': r.setMinutes(r.getMinutes() + n); break;
    case 's': case 'second': r.setSeconds(r.getSeconds() + n); break;
    default: throw new ExprError(`DateAdd: unknown interval "${interval}"`);
  }
  return r;
}
function dateDiff(interval, a, b) {
  a = toDate(a); b = toDate(b); if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  switch (String(interval).toLowerCase()) {
    case 'yyyy': case 'year': return b.getFullYear() - a.getFullYear();
    case 'm': case 'month': return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    case 'ww': case 'week': return Math.trunc(ms / 604800000);
    case 'd': case 'day': return Math.round(ms / 86400000);
    case 'h': case 'hour': return Math.trunc(ms / 3600000);
    case 'n': case 'minute': return Math.trunc(ms / 60000);
    case 's': case 'second': return Math.trunc(ms / 1000);
    default: throw new ExprError(`DateDiff: unknown interval "${interval}"`);
  }
}

/* ------------------------------------------------------------- functions */
const S = (v) => (v == null ? '' : String(v));
/** Eager functions: get evaluated args. */
export const FUNCTIONS = {
  format: (ctx, v, f) => toText(v, f, ctx),
  upper: (ctx, s) => S(s).toUpperCase(), ucase: (ctx, s) => S(s).toUpperCase(),
  lower: (ctx, s) => S(s).toLowerCase(), lcase: (ctx, s) => S(s).toLowerCase(),
  left: (ctx, s, n) => S(s).slice(0, Number(n)),
  right: (ctx, s, n) => (Number(n) <= 0 ? '' : S(s).slice(-Number(n))),
  mid: (ctx, s, start, len) => S(s).substr(Number(start) - 1, len == null ? undefined : Number(len)),
  len: (ctx, s) => S(s).length,
  trim: (ctx, s) => S(s).trim(),
  replace: (ctx, s, a, b) => S(s).split(S(a)).join(S(b)),
  instr: (ctx, s, sub) => S(s).indexOf(S(sub)) + 1,
  join: (ctx, arr, sep) => (Array.isArray(arr) ? arr.map(v => toText(v, null, ctx)).join(sep == null ? ', ' : S(sep)) : toText(arr, null, ctx)),
  contains: (ctx, hay, needle) => (Array.isArray(hay) ? hay.some(v => cmpVal(v, needle) === 0) : S(hay).toLowerCase().includes(S(needle).toLowerCase())),
  inlist: (ctx, v, ...list) => list.flat().some(x => cmpVal(v, x) === 0),
  cstr: (ctx, v) => toText(v, null, ctx),
  cdbl: (ctx, v) => num(v), cnum: (ctx, v) => num(v), val: (ctx, v) => num(v),
  cint: (ctx, v) => (v == null ? null : Math.round(Number(v))),
  cbool: (ctx, v) => truthy(v),
  cdate: (ctx, v) => toDate(v),
  isnull: (ctx, v) => v == null, isnothing: (ctx, v) => v == null,
  coalesce: (ctx, ...vs) => { for (const v of vs) if (v != null && v !== '') return v; return null; },
  round: (ctx, v, d) => (v == null ? null : roundHalfAway(Number(v), Number(d || 0))),
  abs: (ctx, v) => (v == null ? null : Math.abs(Number(v))),
  floor: (ctx, v) => (v == null ? null : Math.floor(Number(v))),
  ceiling: (ctx, v) => (v == null ? null : Math.ceil(Number(v))),
  int: (ctx, v) => (v == null ? null : Math.trunc(Number(v))),
  pow: (ctx, a, b) => Number(a) ** Number(b),
  sqrt: (ctx, v) => Math.sqrt(Number(v)),
  now: (ctx) => (ctx.globals.ExecutionTime instanceof Date ? new Date(ctx.globals.ExecutionTime.getTime()) : new Date()),
  today: (ctx) => { const d = FUNCTIONS.now(ctx); d.setHours(0, 0, 0, 0); return d; },
  dateadd: (ctx, i, n, d) => dateAdd(i, n, d),
  datediff: (ctx, i, a, b) => dateDiff(i, a, b),
  dateserial: (ctx, y, m, d) => new Date(Number(y), Number(m) - 1, Number(d)),
  year: (ctx, d) => toDate(d)?.getFullYear() ?? null,
  month: (ctx, d) => (toDate(d) ? toDate(d).getMonth() + 1 : null),
  day: (ctx, d) => toDate(d)?.getDate() ?? null,
  monthname: (ctx, m, abbr) => {
    // English (the default) keeps the fixed names; another report locale gets its own month names
    if (!english(ctx.locale)) return formatDate(new Date(2000, Number(m) - 1, 1), truthy(abbr) ? 'MMM' : 'MMMM', ctx.locale);
    const s = MONTH_NAMES[Number(m) - 1] ?? new Date(2000, Number(m) - 1, 1).toLocaleString('en', { month: 'long' }); return truthy(abbr) ? s.slice(0, 3) : s;
  },
};

/** Names shown in the designer's expression helper. */
export const FUNCTION_NAMES = [
  'Sum', 'Avg', 'Count', 'CountDistinct', 'CountRows', 'Min', 'Max', 'First', 'Last', 'RunningValue', 'RowNumber',
  'IIF', 'Switch', 'IsNull', 'Coalesce', 'Lookup', 'Join', 'Contains', 'InList',
  ...['Format', 'Upper', 'Lower', 'Left', 'Right', 'Mid', 'Len', 'Trim', 'Replace', 'InStr', 'CStr', 'CDbl', 'CInt', 'CDate', 'CBool',
    'Round', 'Abs', 'Floor', 'Ceiling', 'Int', 'Pow', 'Sqrt', 'Now', 'Today', 'DateAdd', 'DateDiff', 'DateSerial', 'Year', 'Month', 'Day', 'MonthName'],
];

function call(n, ctx) {
  const name = n.name.toLowerCase();
  const args = n.args;
  // lazy logic
  if (name === 'iif') {
    if (args.length !== 3) throw new ExprError('IIF needs 3 arguments: IIF(test, ifTrue, ifFalse)', n.p);
    return truthy(evaluate(args[0], ctx)) ? evaluate(args[1], ctx) : evaluate(args[2], ctx);
  }
  if (name === 'switch') {
    for (let i = 0; i + 1 < args.length; i += 2) if (truthy(evaluate(args[i], ctx))) return evaluate(args[i + 1], ctx);
    return null;
  }
  // aggregates
  if (name in AGG) {
    if (!args.length) throw new ExprError(`${n.name} needs an expression, e.g. ${n.name}(Fields.amount)`, n.p);
    const rows = scopeRows(args, 1, ctx, n.name);
    return AGG[name](mapRows(rows, args[0], ctx));
  }
  if (name === 'countrows') return scopeRows(args, 0, ctx, n.name).length;
  if (name === 'rownumber') {
    if (args.length) { const sc = ctx.scopes?.[evaluate(args[0], ctx)]; if (!sc) throw new ExprError('RowNumber: unknown scope', n.p); return sc.index + 1; }
    return ctx.rowNumber ?? 1;
  }
  if (name === 'runningvalue') {
    if (args.length < 2) throw new ExprError('RunningValue needs 2 arguments: RunningValue(expr, "Sum")', n.p);
    const fn = String(evaluate(args[1], ctx)).toLowerCase();
    if (!(fn in AGG)) throw new ExprError(`RunningValue: unknown function "${fn}"`, n.p);
    let rows;
    if (args.length > 2) {
      const sc = ctx.scopes?.[evaluate(args[2], ctx)];
      if (!sc) throw new ExprError('RunningValue: unknown scope', n.p);
      rows = sc.run || sc.rows.slice(0, sc.index + 1);
    } else if (ctx.runningRows) rows = ctx.runningRows;
    else if (ctx.aggRows && ctx.aggIndex != null) rows = ctx.aggRows.slice(0, ctx.aggIndex + 1);
    else rows = ctx.fields ? [ctx.fields] : [];
    // asked once per row over a growing prefix of the same rows: reuse the values already computed
    if (args.length > 2 || (!ctx.runningRows && ctx.aggRows && ctx.aggIndex != null)) {
      const base = args.length > 2 ? rows : ctx.aggRows;
      if (rowLocal(args[0])) return AGG[fn](prefixValues(base, rows.length, args[0], ctx));
    }
    return AGG[fn](mapRows(rows, args[0], ctx));
  }
  if (name === 'lookup') {
    // Lookup(sourceExpr, destExpr, resultExpr, "DataSet"): first matching row in another data set
    if (args.length !== 4) throw new ExprError('Lookup needs 4 arguments: Lookup(source, destination, result, "DataSet")', n.p);
    const key = evaluate(args[0], ctx);
    const setName = evaluate(args[3], ctx);
    const rows = ctx.dataSets[setName];
    if (!rows) throw new ExprError(`Lookup: the data set "${setName}" does not exist`, n.p);
    const c = Object.assign({}, ctx);
    for (const r of rows) { c.fields = r; if (cmpVal(evaluate(args[1], c), key) === 0) return evaluate(args[2], c); }
    return null;
  }
  const f = FUNCTIONS[name];
  if (!f) throw new ExprError(`Unknown function "${n.name}"`, n.p);
  return f(ctx, ...args.map(a => evaluate(a, ctx)));
}
