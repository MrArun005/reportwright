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
      const lower = n.name.toLowerCase();
      if (ctx.locals && Object.hasOwn(ctx.locals, lower)) return ctx.locals[lower];
      const r = ROOTS[lower];
      if (r) return { __root: r };
      if (lower in CONSTANTS) return CONSTANTS[lower];
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

/**
 * Data-set row → its parent: the parent data set's row (nested data sets) or the raw object that held a
 * [*]-spread array. Parent.* reads it when no list row supplies a parent.
 */
export const ROW_PARENT = new WeakMap();

function member(o, prop, ctx) {
  if (o && o.__root) {
    const src = o.__root === 'Fields' ? ctx.fields : o.__root === 'Parameters' ? ctx.params
      : o.__root === 'Parent' ? ctx.parentFields ?? (ctx.fields && typeof ctx.fields === 'object' ? ROW_PARENT.get(ctx.fields) : null) : ctx.globals;
    if (!src || typeof src !== 'object') return null;
    if (Object.hasOwn(src, prop)) return src[prop];
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
export function cmpVal(a, b) {
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
const SCOPED = new Set(['countrows', 'rownumber', 'runningvalue', 'distinctsum', 'aggregateif', 'previous', 'groupindex']);
/** True when an expression reads only the current row (and parameters): no aggregate, RowNumber or RunningValue. */
function rowLocal(ast) {
  let r = ROW_LOCAL.get(ast);
  if (r === undefined) {
    // a report function or a local name (inside a function body) could read anything: not row-local
    const local = (n) => {
      if (n.type === 'id') return n.name.toLowerCase() in ROOTS || n.name.toLowerCase() in CONSTANTS;
      if (n.type !== 'call') return true;
      const k = n.name.toLowerCase();
      return !n.obj && (k in FUNCTIONS || k === 'iif' || k === 'switch' || k === 'choose' || k === 'lookup' || k === 'lookupset');
    };
    const walk = (n) => !n || typeof n !== 'object' || (Array.isArray(n) ? n.every(walk) : local(n) && Object.values(n).every(walk));
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
  median: (vals) => {
    const xs = nums(vals).sort((a, b) => a - b), n = xs.length;
    return n ? (n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2) : null;
  },
  mode: (vals) => {
    // the most frequent value; on a tie the one seen first
    const counts = new Map();
    let best = null, top = 0;
    for (const v of vals) {
      if (v == null || v === '') continue;
      const k = v instanceof Date ? v.getTime() : v;
      const c = (counts.get(k) || 0) + 1;
      counts.set(k, c);
      if (c > top) { top = c; best = v; }
    }
    return best;
  },
  var: (vals) => variance(vals, true),
  varp: (vals) => variance(vals, false),
  stdev: (vals) => { const v = variance(vals, true); return v == null ? null : Math.sqrt(v); },
  stdevp: (vals) => { const v = variance(vals, false); return v == null ? null : Math.sqrt(v); },
};
/** Numbers among the values: nulls, blanks and text that is not a number are skipped. */
function nums(vals) {
  const out = [];
  for (const v of vals) {
    if (v == null || v === '' || typeof v === 'boolean') continue;
    const n = num(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}
/** Two-pass variance: sample (n - 1) or population (n). */
function variance(vals, sample) {
  const xs = nums(vals);
  if (xs.length < (sample ? 2 : 1)) return null;
  let m = 0;
  for (const x of xs) m += x;
  m /= xs.length;
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - (sample ? 1 : 0));
}
/** Values of an expression over rows, with arrays (a LookupSet) spread into their items. */
function aggValues(rows, ast, ctx) {
  const vals = mapRows(rows, ast, ctx);
  return vals.some(Array.isArray) ? vals.flat() : vals;
}

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

/* ------------------------------------------------- Phase 3 function library */
const MAX_TEXT = 1_000_000; // longest string a function may build
const capText = (fname, n) => { if (n > MAX_TEXT) throw new ExprError(`${fname}: the result would be longer than 1,000,000 characters`); };
/** A finite number or null: Log(0), Asin(2) and friends give null, like 1 / 0. */
const fin = (x) => (Number.isFinite(x) ? x : null);
/** Run f on a number argument; null in, null out. */
const math1 = (f) => (ctx, v) => (v == null || v === '' ? null : fin(f(num(v))));
/** A date argument, or null when it is not a date. */
const dt = (v) => toDate(v);
/** Days since Sunday (0..6) shifted so firstDay (1 = Sunday … 7 = Saturday) is 1. */
const weekday = (d, first) => ((d.getDay() - ((Number(first) || 1) - 1) + 7) % 7) + 1;
function dayOfYear(d) {
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
}
/** .NET AddMonths: keeps the day, clamped to the end of the target month (31 Jan + 1 month = 28 Feb). */
function addMonths(v, n) {
  const d = dt(v);
  if (!d || n == null || !Number.isFinite(Number(n))) return null;
  const r = new Date(d.getTime());
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + Math.trunc(Number(n)));
  r.setDate(Math.min(day, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
}
/** Add a number of milliseconds-per-unit; whole days move the calendar day (local wall clock). */
function addUnits(v, n, ms) {
  const d = dt(v);
  if (!d || n == null || !Number.isFinite(Number(n))) return null;
  const r = new Date(d.getTime());
  n = Number(n);
  if (ms === 86400000) { const whole = Math.trunc(n); r.setDate(r.getDate() + whole); n -= whole; }
  r.setTime(r.getTime() + n * ms);
  return r;
}
function datePart(interval, v, first) {
  const d = dt(v);
  if (!d) return null;
  switch (String(interval).toLowerCase()) {
    case 'yyyy': case 'year': return d.getFullYear();
    case 'q': case 'quarter': return Math.floor(d.getMonth() / 3) + 1;
    case 'm': case 'month': return d.getMonth() + 1;
    case 'y': case 'dayofyear': return dayOfYear(d);
    case 'd': case 'day': return d.getDate();
    case 'w': case 'weekday': return weekday(d, first);
    case 'ww': case 'weekofyear': {
      // week 1 holds 1 January; weeks start on firstDay (Sunday by default), as VB's DatePart
      const jan1 = weekday(new Date(d.getFullYear(), 0, 1), first) - 1;
      return Math.floor((dayOfYear(d) - 1 + jan1) / 7) + 1;
    }
    case 'h': case 'hour': return d.getHours();
    case 'n': case 'minute': return d.getMinutes();
    case 's': case 'second': return d.getSeconds();
    default: throw new ExprError(`DatePart: unknown interval "${interval}"`);
  }
}
/** Text that reads as a number ("12.5", " 7 ", "1e3"); "" and text with letters do not. */
const numericText = (v) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.trim()));
function isDate(v) {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== 'string') return false;
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) { const d = toDate(s.slice(0, 10)); if (!d || d.getMonth() + 1 !== Number(iso[2]) || d.getDate() !== Number(iso[3])) return false; }
  // a date needs separated parts or a month name: new Date("1") would read a bare number as a year
  return /\d{1,4}[-/.]\d{1,2}|[A-Za-z]{3}/.test(s) && toDate(s) != null;
}
/** Convert.ToXxx: null stays null, anything that does not convert is an error (the cell shows #Error). */
function toNumber(fname, v) {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/,/g, '').trim()) : NaN;
  if (!Number.isFinite(n)) throw new ExprError(`${fname}: "${String(v).slice(0, 40)}" is not a number`);
  return n;
}
/** Round half to even, as .NET Convert.ToInt32 does, then check the range. */
function toInt(fname, v, bits) {
  const n = toNumber(fname, v);
  if (n == null) return null;
  const f = Math.floor(n), diff = n - f;
  const r = diff > 0.5 || (diff === 0.5 && f % 2 !== 0) ? f + 1 : f;
  const lim = 2 ** (bits - 1);
  if (r < -lim || r >= lim) throw new ExprError(`${fname}: ${n} is outside the Int${bits} range`);
  return r + 0;
}
const firstChar = (c) => (c == null || c === '' ? ' ' : [...String(c)][0]);
function pad(fname, s, width, c, left) {
  s = S(s);
  const w = Number(width) || 0;
  capText(fname, w);
  if (w <= s.length) return s;
  const fill = firstChar(c).repeat(w - s.length);
  return left ? fill + s : s + fill;
}

Object.assign(FUNCTIONS, {
  // text
  startswith: (ctx, s, p) => S(s).startsWith(S(p)),
  endswith: (ctx, s, p) => S(s).endsWith(S(p)),
  indexof: (ctx, s, sub, start) => S(s).indexOf(S(sub), Number(start) || 0),
  lastindexof: (ctx, s, sub, start) => (start == null ? S(s).lastIndexOf(S(sub)) : S(s).lastIndexOf(S(sub), Number(start))),
  substring: (ctx, s, start, len) => { const a = Math.max(0, Number(start) || 0); return len == null ? S(s).slice(a) : S(s).slice(a, a + Math.max(0, Number(len) || 0)); },
  padleft: (ctx, s, w, c) => pad('PadLeft', s, w, c, true),
  padright: (ctx, s, w, c) => pad('PadRight', s, w, c, false),
  split: (ctx, s, sep) => (s == null ? [] : sep == null || sep === '' ? [S(s)] : S(s).split(S(sep))),
  chr: (ctx, c) => { const n = Number(c); return c == null || !Number.isInteger(n) || n < 0 || n > 0x10ffff ? null : String.fromCodePoint(n); },
  asc: (ctx, s) => (s == null || s === '' ? null : S(s).codePointAt(0) ?? null),
  trimstart: (ctx, s) => S(s).trimStart(),
  trimend: (ctx, s) => S(s).trimEnd(),
  strreverse: (ctx, s) => { s = S(s); capText('StrReverse', s.length); return [...s].reverse().join(''); },
  space: (ctx, n) => { n = Math.max(0, Number(n) || 0); capText('Space', n); return ' '.repeat(n); },
  // math
  sign: math1(Math.sign),
  log: (ctx, v, base) => (v == null || v === '' ? null : fin(base == null ? Math.log(num(v)) : Math.log(num(v)) / Math.log(num(base)))),
  log10: math1(Math.log10),
  exp: math1(Math.exp),
  truncate: math1(Math.trunc), fix: math1(Math.trunc),
  sin: math1(Math.sin), cos: math1(Math.cos), tan: math1(Math.tan),
  asin: math1(Math.asin), acos: math1(Math.acos), atan: math1(Math.atan),
  atan2: (ctx, y, x) => (y == null || x == null ? null : fin(Math.atan2(num(y), num(x)))),
  pi: () => Math.PI,
  e: () => Math.E,
  // dates
  datepart: (ctx, i, d, first) => datePart(i, d, first),
  weekday: (ctx, d, first) => (dt(d) ? weekday(dt(d), first) : null),
  weekdayname: (ctx, n, abbr, first) => {
    n = Number(n);
    if (!Number.isInteger(n) || n < 1 || n > 7) return null;
    const d = new Date(2000, 0, 2 + n - 1 + ((Number(first) || 1) - 1)); // 2 Jan 2000 was a Sunday
    return formatDate(d, truthy(abbr) ? 'ddd' : 'dddd', ctx.locale);
  },
  quarter: (ctx, d) => (dt(d) ? Math.floor(dt(d).getMonth() / 3) + 1 : null),
  quartername: (ctx, d) => (dt(d) ? `Q${Math.floor(dt(d).getMonth() / 3) + 1}` : null),
  hour: (ctx, d) => dt(d)?.getHours() ?? null,
  minute: (ctx, d) => dt(d)?.getMinutes() ?? null,
  second: (ctx, d) => dt(d)?.getSeconds() ?? null,
  addyears: (ctx, d, n) => addMonths(d, n == null ? null : 12 * Math.trunc(Number(n))),
  addmonths: (ctx, d, n) => addMonths(d, n),
  adddays: (ctx, d, n) => addUnits(d, n, 86400000),
  addhours: (ctx, d, n) => addUnits(d, n, 3600000),
  addminutes: (ctx, d, n) => addUnits(d, n, 60000),
  addseconds: (ctx, d, n) => addUnits(d, n, 1000),
  datevalue: (ctx, v) => { const d = dt(v); if (!d) return null; const r = new Date(d.getTime()); r.setHours(0, 0, 0, 0); return r; },
  timeserial: (ctx, h, m, s) => { const d = new Date(2000, 0, 1); d.setFullYear(1, 0, 1); d.setHours(Number(h) || 0, Number(m) || 0, Number(s) || 0, 0); return d; },
  datestring: (ctx) => formatDate(FUNCTIONS.now(ctx), 'MM-dd-yyyy'),
  // inspection
  isnumeric: (ctx, v) => (typeof v === 'number' ? Number.isFinite(v) : numericText(v)),
  isdate: (ctx, v) => isDate(v),
  isarray: (ctx, v) => Array.isArray(v),
  // conversion
  tostring: (ctx, v, f) => toText(v, f, ctx),
  toint16: (ctx, v) => toInt('ToInt16', v, 16),
  toint32: (ctx, v) => toInt('ToInt32', v, 32),
  toint64: (ctx, v) => toInt('ToInt64', v, 64),
  todouble: (ctx, v) => toNumber('ToDouble', v),
  tosingle: (ctx, v) => toNumber('ToSingle', v),
  todecimal: (ctx, v) => toNumber('ToDecimal', v),
  toboolean: (ctx, v) => {
    if (v == null) return null;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const t = String(v).trim().toLowerCase();
    if (t === 'true' || t === 'false') return t === 'true';
    throw new ExprError(`ToBoolean: "${String(v).slice(0, 40)}" is not True or False`);
  },
  todatetime: (ctx, v) => {
    if (v == null) return null;
    const d = dt(v);
    if (!d) throw new ExprError(`ToDateTime: "${String(v).slice(0, 40)}" is not a date`);
    return d;
  },
});
/** Names that may be written without brackets. */
const CONSTANTS = { pi: Math.PI, e: Math.E };

/** Names shown in the designer's expression helper. */
export const FUNCTION_NAMES = [
  'Sum', 'Avg', 'Count', 'CountDistinct', 'CountRows', 'Min', 'Max', 'First', 'Last', 'RunningValue', 'RowNumber',
  'Median', 'Mode', 'StDev', 'StDevP', 'Var', 'VarP', 'DistinctSum', 'AggregateIf',
  'IIF', 'Switch', 'IsNull', 'Coalesce', 'Lookup', 'LookupSet', 'Previous', 'GroupIndex', 'Join', 'Contains', 'InList',
  ...['Format', 'Upper', 'Lower', 'Left', 'Right', 'Mid', 'Len', 'Trim', 'Replace', 'InStr', 'CStr', 'CDbl', 'CInt', 'CDate', 'CBool',
    'Round', 'Abs', 'Floor', 'Ceiling', 'Int', 'Pow', 'Sqrt', 'Now', 'Today', 'DateAdd', 'DateDiff', 'DateSerial', 'Year', 'Month', 'Day', 'MonthName'],
  'StartsWith', 'EndsWith', 'IndexOf', 'LastIndexOf', 'Substring', 'PadLeft', 'PadRight', 'Split', 'Chr', 'Asc', 'TrimStart', 'TrimEnd', 'StrReverse', 'Space', 'LCase', 'UCase',
  'Sign', 'Log', 'Log10', 'Exp', 'Truncate', 'Fix', 'Sin', 'Cos', 'Tan', 'Asin', 'Acos', 'Atan', 'Atan2', 'PI', 'E',
  'DatePart', 'Weekday', 'WeekdayName', 'Quarter', 'QuarterName', 'Hour', 'Minute', 'Second',
  'AddYears', 'AddMonths', 'AddDays', 'AddHours', 'AddMinutes', 'AddSeconds', 'DateValue', 'TimeSerial', 'DateString',
  'IsNumeric', 'IsDate', 'IsArray', 'Choose',
  'ToString', 'ToInt16', 'ToInt32', 'ToInt64', 'ToDouble', 'ToSingle', 'ToDecimal', 'ToBoolean', 'ToDateTime',
];

/**
 * Previous(expr[, scope]).
 * Detail row: the previous detail row of the region (across groups), or of the named group instance.
 * Group header/footer or list row: expr over the previous group instance (or list row).
 */
function previous(n, ctx) {
  const args = n.args;
  if (!args.length) throw new ExprError('Previous needs an expression: Previous(Fields.amount)', n.p);
  let sc;
  if (args.length > 1) {
    sc = ctx.scopes?.[evaluate(args[1], ctx)];
    if (!sc) throw new ExprError('Previous: unknown scope', n.p);
  }
  let rows = null;
  if (ctx.aggIndex != null) {
    const run = (sc || ctx.region)?.run;
    if (run) rows = run.length > 1 ? [run[run.length - 2]] : null;
    else if (ctx.aggIndex > 0) rows = [ctx.aggRows[ctx.aggIndex - 1]];
  } else rows = (sc || ctx.group || ctx.region)?.prevRows || null;
  if (!rows) return null;
  return evaluate(args[0], Object.assign({}, ctx, { fields: rows[0], aggRows: rows, aggIndex: undefined }));
}

function call(n, ctx) {
  const name = n.name.toLowerCase();
  const args = n.args;
  if (n.obj) return callCustom(n, name, ctx); // Code.Name(…)
  // lazy logic
  if (name === 'iif') {
    if (args.length !== 3) throw new ExprError('IIF needs 3 arguments: IIF(test, ifTrue, ifFalse)', n.p);
    return truthy(evaluate(args[0], ctx)) ? evaluate(args[1], ctx) : evaluate(args[2], ctx);
  }
  if (name === 'choose') {
    // Choose(index, a, b, …): 1-based; only the chosen argument is evaluated
    if (!args.length) throw new ExprError('Choose needs an index and choices: Choose(2, "a", "b")', n.p);
    const i = Number(evaluate(args[0], ctx));
    return Number.isInteger(i) && i >= 1 && i < args.length ? evaluate(args[i], ctx) : null;
  }
  if (name === 'switch') {
    for (let i = 0; i + 1 < args.length; i += 2) if (truthy(evaluate(args[i], ctx))) return evaluate(args[i + 1], ctx);
    return null;
  }
  // aggregates
  if (name in AGG) {
    if (!args.length) throw new ExprError(`${n.name} needs an expression, e.g. ${n.name}(Fields.amount)`, n.p);
    const rows = scopeRows(args, 1, ctx, n.name);
    return AGG[name](aggValues(rows, args[0], ctx));
  }
  if (name === 'distinctsum') {
    // DistinctSum(distinctExpr, valueExpr[, scope]): the value of the first row of each distinct key
    if (args.length < 2) throw new ExprError('DistinctSum needs 2 arguments: DistinctSum(distinct, value)', n.p);
    const rows = scopeRows(args, 2, ctx, n.name);
    const keys = mapRows(rows, args[0], ctx);
    const seen = new Set(), pick = [];
    for (let i = 0; i < rows.length; i++) {
      const k = keys[i] instanceof Date ? keys[i].getTime() : keys[i];
      if (!seen.has(k)) { seen.add(k); pick.push(rows[i]); }
    }
    return AGG.sum(aggValues(pick, args[1], ctx));
  }
  if (name === 'aggregateif') {
    // AggregateIf(condition, "Sum", expr[, scope])
    if (args.length < 3) throw new ExprError('AggregateIf needs 3 arguments: AggregateIf(condition, "Sum", expr)', n.p);
    const fn = String(evaluate(args[1], ctx)).toLowerCase();
    if (!(fn in AGG)) throw new ExprError(`AggregateIf: unknown aggregate "${fn}"`, n.p);
    const rows = scopeRows(args, 3, ctx, n.name);
    const ok = mapRows(rows, args[0], ctx);
    return AGG[fn](aggValues(rows.filter((_, i) => truthy(ok[i])), args[2], ctx));
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
  if (name === 'previous') return previous(n, ctx);
  if (name === 'groupindex') {
    const sc = args.length ? ctx.scopes?.[evaluate(args[0], ctx)] : ctx.group;
    if (args.length && !sc) throw new ExprError('GroupIndex: unknown scope', n.p);
    return sc?.number ?? null;
  }
  if (name === 'level') throw new ExprError('Level() needs a recursive group (Phase 4)', n.p);
  if (name === 'lookupset') {
    // LookupSet(sourceExpr, destExpr, resultExpr, "DataSet"): every matching row's result, as an array
    if (args.length !== 4) throw new ExprError('LookupSet needs 4 arguments: LookupSet(source, destination, result, "DataSet")', n.p);
    const key = evaluate(args[0], ctx);
    const setName = evaluate(args[3], ctx);
    const rows = ctx.dataSets[setName];
    if (!rows) throw new ExprError(`LookupSet: the data set "${setName}" does not exist`, n.p);
    const c = Object.assign({}, ctx), out = [];
    for (const r of rows) { c.fields = r; if (cmpVal(evaluate(args[1], c), key) === 0) out.push(evaluate(args[2], c)); }
    return out;
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
  if (f) return f(ctx, ...args.map(a => evaluate(a, ctx)));
  return callCustom(n, name, ctx);
}

/* ------------------------------------------------------- report functions */
const MAX_FN_DEPTH = 32;
const MAX_FN_CALLS = 1_000_000; // per function table, i.e. per render
const MAX_FUNCTIONS = 200, MAX_FN_PARAMS = 32;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(['iif', 'switch', 'choose', 'lookup', 'lookupset', 'previous', 'groupindex', 'level', 'countrows', 'rownumber',
  'runningvalue', 'distinctsum', 'aggregateif', 'code', 'fields', 'parameters', 'globals', 'parent', 'and', 'or', 'not', 'true', 'false', 'null', 'nothing']);
const builtin = (lower) => RESERVED.has(lower) || lower in FUNCTIONS || lower in AGG || lower in CONSTANTS;

/**
 * Compile-on-call table of the report's functions. One per render: it also counts calls.
 * @param {any} def @param {{n: number}} [count] shared by a render and its subreports
 * @returns {{byName: Map<string, any>, count: {n: number}}}
 */
export function functionTable(def, count = { n: 0 }) {
  const byName = new Map();
  for (const f of Array.isArray(def?.functions) ? def.functions.slice(0, MAX_FUNCTIONS) : []) {
    if (f && typeof f.name === 'string') byName.set(f.name.toLowerCase(), f);
  }
  return { byName, count };
}

/** Errors in report functions: names, parameters, body syntax. */
export function checkFunctions(list) {
  const errors = [];
  if (list == null) return errors;
  if (!Array.isArray(list)) return ['"functions" must be a list'];
  if (list.length > MAX_FUNCTIONS) errors.push(`A report can have at most ${MAX_FUNCTIONS} functions`);
  const seen = new Set();
  for (const f of list.slice(0, MAX_FUNCTIONS)) {
    const name = String(f?.name ?? '');
    const label = `Function "${name.slice(0, 40)}"`;
    if (!IDENT.test(name)) { errors.push(`${label}: the name must start with a letter or _ and hold only letters, digits and _`); continue; }
    const lower = name.toLowerCase();
    if (builtin(lower)) errors.push(`${label}: a built-in function or name is called that`);
    if (seen.has(lower)) errors.push(`${label}: two functions have this name`);
    seen.add(lower);
    const ps = f.params ?? [];
    if (!Array.isArray(ps) || ps.length > MAX_FN_PARAMS) { errors.push(`${label}: "params" must be a list of at most ${MAX_FN_PARAMS} names`); continue; }
    const pset = new Set();
    for (const p of ps) {
      const pl = String(p).toLowerCase();
      if (!IDENT.test(String(p)) || RESERVED.has(pl) || pl in CONSTANTS) errors.push(`${label}: "${String(p).slice(0, 40)}" cannot be a parameter name`);
      else if (pset.has(pl)) errors.push(`${label}: two parameters are called "${p}"`);
      pset.add(pl);
    }
    if (typeof f.body !== 'string' || !f.body.replace(/^=/, '').trim()) { errors.push(`${label}: the body is empty`); continue; }
    try { compile(f.body.replace(/^=/, '')); } catch (e) { errors.push(`${label}: ${e.message}`); }
  }
  return errors;
}

function callCustom(n, name, ctx) {
  const viaCode = !!n.obj;
  if (viaCode && !(n.obj.type === 'id' && n.obj.name.toLowerCase() === 'code')) throw new ExprError(`"${n.name}(…)" after "." is not supported; report functions are called as Code.${n.name}(…)`, n.p);
  const table = ctx.functions;
  const f = table?.byName.get(name);
  if (!f || (!viaCode && builtin(name))) throw new ExprError(viaCode ? `The report has no function "${n.name}"` : `Unknown function "${n.name}"`, n.p);
  const params = Array.isArray(f.params) ? f.params : [];
  if (n.args.length !== params.length) throw new ExprError(`${f.name} needs ${params.length} argument${params.length === 1 ? '' : 's'}`, n.p);
  const depth = (ctx.fnDepth || 0) + 1;
  if (depth > MAX_FN_DEPTH) throw new ExprError(`${f.name}: functions call each other more than ${MAX_FN_DEPTH} deep`, n.p);
  if (++table.count.n > MAX_FN_CALLS) throw new ExprError(`Report functions were called more than 1,000,000 times in this render`, n.p);
  const locals = Object.create(null);
  for (let i = 0; i < params.length; i++) locals[String(params[i]).toLowerCase()] = evaluate(n.args[i], ctx);
  // the body sees its parameters and the caller's row and scope, not the caller's own parameters
  return evaluate(compile(String(f.body).replace(/^=/, '')), Object.assign({}, ctx, { locals, fnDepth: depth }));
}
