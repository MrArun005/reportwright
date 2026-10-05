// @ts-check
import { parse, ExprError, capText } from './parser.js';
import { formatValue, formatDate, english, toDate as readDate, roundHalfAway, roundHalfEven, toWall, fromWall as zoneFromWall, parseNumber } from './format.js';
import { javaString, jsString, javaFormatString } from './javafmt.js';

/**
 * @typedef {object} EvalCtx
 * @property {Record<string, any>|null} [fields]   current row
 * @property {Record<string, any>} params
 * @property {Record<string, any>} globals
 * @property {any[]} [aggRows]                       rows for aggregates in the current scope
 * @property {WeakMap<any[], Map<any, any>>} [aggCache] aggregate results for this render, per row array and call
 * @property {any[]} [runningRows]                   rows from scope start up to the current row
 * @property {number} [rowNumber]
 * @property {Record<string, any[]>} dataSets
 * @property {{ until: number, n: number, over: boolean }} [clock] the render's time limit (see evaluate)
 * @property {string} [locale]
 * @property {string} [currency]
 */

const ROOTS = { fields: 'Fields', parameters: 'Parameters', globals: 'Globals', parent: 'Parent', theme: 'Theme', partproperties: 'PartProperties' };

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
  if (p) { if (p.kind === 'err') throw p.error; return p; }
  try { p = parseFresh(v); } catch (e) {
    // a value that does not parse is parsed once: every cell that uses it rethrows the same error (#Error there)
    if (!(e instanceof ExprError)) throw e;
    p = { kind: 'err', error: e };
  }
  if (tplCache.size > 5000) tplCache.clear();
  tplCache.set(v, p);
  if (p.kind === 'err') throw p.error;
  return p;
}
/** @param {string} v */
function parseFresh(v) {
  let p;
  if (v.startsWith('=')) { const ast = compile(v.slice(1)); p = { kind: 'expr', ast, fn: closureFor(ast) }; }
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
  let p;
  try { p = parseValue(v); } catch (e) {
    // a failed parse counts against the render's time limit like an evaluation: a table of failing cells stops on time
    const clock = ctx.clock;
    if (clock && (clock.over || ((++clock.n & 1023) === 0 && Date.now() > clock.until && (clock.over = true)))) throw new ExprError(OVER_TIME, 0);
    throw e;
  }
  if (p.kind === 'lit') return p.v;
  if (p.kind === 'expr') return p.fn ? p.fn(ctx) : evaluate(p.ast, ctx);
  let out = '';
  for (const part of p.parts) out += typeof part === 'string' ? part : toText(evaluate(part.ast, ctx), null, ctx);
  return out;
}

/** @param {any} v @param {string|null|undefined} fmt @param {EvalCtx} ctx */
export function toText(v, fmt, ctx) {
  return formatValue(v, fmt, ctx); // reads ctx.locale, ctx.currency and the render's ctx.fmtMemo
}

/** Check syntax only. Returns null or an error message. */
export function checkValue(v) {
  try { parseValue(v); return null; } catch (e) { return e.message; }
}

/**
 * The hottest expressions, compiled once to a closure built from our own AST (never eval or new Function):
 * =Fields.x and =Parameters.x, a cell's usual value. They do what evaluate() does; anything unusual (a local of
 * the same name inside a report function, a field that needs the case-insensitive lookup or its error) goes
 * through evaluate(). Other expressions return null here and are walked by evaluate().
 * @returns {((ctx: EvalCtx) => any) | null}
 */
function closureFor(ast) {
  if (ast.type !== 'member' || ast.obj.type !== 'id') return null;
  const root = ast.obj.name.toLowerCase(), prop = ast.prop;
  if (root !== 'fields' && root !== 'parameters') return null;
  const key = root === 'fields' ? 'fields' : 'params';
  return (ctx) => {
    const src = ctx[key];
    if (ctx.locals || !src || typeof src !== 'object' || !Object.hasOwn(src, prop)) return evaluate(ast, ctx);
    const clock = ctx.clock; // the time limit, as evaluate() checks it
    if (clock && (clock.over || ((clock.n += 2) & 1022) === 0 && Date.now() > clock.until && (clock.over = true))) throw new ExprError(OVER_TIME, ast.p);
    return src[prop];
  };
}

/* ------------------------------------------------------------- evaluator */
/**
 * A render's time limit (render(def, { timeoutMs })): ctx.clock = { until, n, over }. The clock is read every 1,024
 * evaluations; once the limit has passed every evaluation throws at once, so even a quadratic report unwinds fast.
 */
export const OVER_TIME = 'The report ran past its time limit.';
/** @param {any} n @param {EvalCtx} ctx @returns {any} */
export function evaluate(n, ctx) {
  const clock = ctx.clock;
  if (clock && (clock.over || ((++clock.n & 1023) === 0 && Date.now() > clock.until && (clock.over = true)))) throw new ExprError(OVER_TIME, n.p);
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
      if (n.op === 'neg') return v == null ? (ctx.nullPropagation === true ? null : 0) : typeof v === 'boolean' ? -vbNum(v) : -Number(v);
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
      : o.__root === 'Parent' ? ctx.parentFields ?? (ctx.fields && typeof ctx.fields === 'object' ? ROW_PARENT.get(ctx.fields) : null)
        : o.__root === 'Theme' ? ctx.theme : o.__root === 'PartProperties' ? ctx.partProps : ctx.globals;
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

/* ------------------------------------------------------------ decimal arithmetic
 * Report numbers are mostly decimals (money, quantities), and SSRS reads SQL decimal and money columns as
 * System.Decimal, where 0.1 + 0.2 is 0.3 and ten 0.1s sum to 1. A double holds the nearest binary value instead
 * (0.30000000000000004, 0.9999999999999999), and a total compared with "= 1" or printed in full shows it.
 * Decision: a number stands for its shortest decimal form (String(x)). +, -, * and Sum / Avg / RunningValue work on
 * that form exactly, as scaled integers, and give the double nearest the exact decimal result, so its shortest form
 * is the decimal answer. An operand with no short form (1/3, 1e-30) or a result past 2^53 scaled units falls back to
 * plain double arithmetic, which is what VB does for Double values. Display rounding is separate (format.js: half away
 * from zero on the decimal value, as .NET format strings do).
 */
const P10 = Array.from({ length: 23 }, (_, i) => 10 ** i);
const DEC_MAX = 2 ** 49; // a scaled integer this small is read from x * 10^k without error (|error| < 1/8)
/**
 * x as [integer, scale] (x = integer / 10^scale) with the fewest decimals that give back x, i.e. its shortest decimal
 * form (String(x), found without building the string); null when it has none within 15 decimals and 2^49.
 */
function dec(x) {
  if (Number.isInteger(x)) return Math.abs(x) <= DEC_MAX ? [x, 0] : null;
  if (!Number.isFinite(x)) return null;
  for (let k = 1; k <= 15; k++) {
    const i = Math.round(x * P10[k]);
    if (Math.abs(i) > DEC_MAX) return null;
    if (i / P10[k] === x) return [i, k];
  }
  return null;
}
/** a + b on the decimal values. */
export function decAdd(a, b) {
  if (Number.isInteger(a) && Number.isInteger(b)) return a + b;
  const x = dec(a), y = dec(b);
  if (!x || !y) return a + b;
  const k = Math.max(x[1], y[1]);
  const p = x[0] * P10[k - x[1]], q = y[0] * P10[k - y[1]], t = p + q;
  return Number.isSafeInteger(p) && Number.isSafeInteger(q) && Number.isSafeInteger(t) ? t / P10[k] : a + b;
}
/** a * b on the decimal values. */
export function decMul(a, b) {
  if (Number.isInteger(a) && Number.isInteger(b)) return a * b;
  const x = dec(a), y = dec(b);
  if (!x || !y) return a * b;
  const p = x[0] * y[0], k = x[1] + y[1];
  return Number.isSafeInteger(p) && k <= 22 ? p / P10[k] : a * b;
}
/** a + b: on decimal values (decAdd), or as IEEE doubles when the report computes as Java and JavaScript do (ctx.doubles) */
const add = (a, b, ctx) => (ctx?.doubles ? a + b : decAdd(a, b));
export function cmpVal(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && !Number.isNaN(Number(b))) b = Number(b);
  if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '' && !Number.isNaN(Number(a))) a = Number(a);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Nothing (null) in operators. By default VB / SSRS semantics, which imported reports were written for: Nothing widens
 * to the other operand's type default, so it is 0 in arithmetic ("Nothing + 1" is 1, a row with one null field still
 * counts in Sum(a + b)), "" next to text, the earliest date next to a date, and in comparisons ("Nothing = 0" and
 * "Nothing = """ are True). Division by zero gives Infinity or NaN, as VB Double division does.
 * A report with nullPropagation: true keeps the SQL-like rule instead: arithmetic with a null gives null (a blank stays
 * blank), a comparison with null is False except null = null, and x / 0 is null.
 */
const vbNum = (v) => (v == null || v === '' ? 0 : typeof v === 'boolean' ? (v ? -1 : 0) : v instanceof Date ? v.getTime() : Number(v));
/** Nothing as the type default of the other operand (VB widening). */
function widen(other) {
  if (typeof other === 'string') return '';
  if (other instanceof Date) return new Date(-62135596800000); // DateTime.MinValue, 1 Jan 0001
  if (typeof other === 'boolean') return false;
  return 0;
}
/**
 * Sort and group order, as SSRS on a case-insensitive, accent-sensitive collation: text compares by the report's
 * locale, ignoring case, with digit runs read as numbers ("9" before "10"); numbers and dates by value, before text;
 * nulls last. A report with caseSensitive: true compares upper and lower case apart.
 */
const collators = new Map();
export function collator(ctx) {
  const key = `${ctx?.locale || 'en-US'}|${ctx?.caseSensitive === true}`;
  let c = collators.get(key);
  if (!c) {
    try { c = new Intl.Collator(ctx?.locale || 'en-US', { numeric: true, sensitivity: ctx?.caseSensitive === true ? 'variant' : 'accent' }); } catch { c = new Intl.Collator('en-US', { numeric: true, sensitivity: 'accent' }); }
    if (collators.size >= 100) collators.clear();
    collators.set(key, c);
  }
  return c;
}
/** @returns {number} for two keys (dates as their time), nulls last */
export function sortCompare(a, b, ctx) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const sa = typeof a === 'string', sb = typeof b === 'string';
  if (sa && sb) return collator(ctx).compare(a, b);
  if (sa !== sb) return sa ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
/** A group key that merges values the sort calls equal ("ABC" and "abc" unless caseSensitive). */
export function groupKeyText(key, ctx) {
  if (key instanceof Date) return String(key.getTime());
  if (typeof key === 'string' && ctx?.caseSensitive !== true) return key.toLocaleLowerCase(ctx?.locale || 'en-US');
  return String(key);
}

function binary(n, ctx) {
  const op = n.op;
  if (op === 'and' || op === '&&') return truthy(evaluate(n.a, ctx)) && truthy(evaluate(n.b, ctx));
  if (op === 'or' || op === '||') return truthy(evaluate(n.a, ctx)) || truthy(evaluate(n.b, ctx));
  let a = evaluate(n.a, ctx), b = evaluate(n.b, ctx);
  if (op === '&') return toText(a, null, ctx) + toText(b, null, ctx);
  const sql = ctx.nullPropagation === true;
  if (!sql && (a == null || b == null)) {
    // VB: Nothing takes the other side's type default; Nothing with Nothing is 0 (and equal)
    if (a == null && b == null) { a = 0; b = 0; } else if (a == null) a = widen(b); else b = widen(a);
  }
  if (!sql && (typeof a === 'boolean' || typeof b === 'boolean') && '+-*/%'.includes(op) && typeof a !== 'string' && typeof b !== 'string') {
    a = vbNum(a); b = vbNum(b); // VB True is -1 in arithmetic (True + 1 = 0)
  }
  switch (op) {
    case '+':
      if (typeof a === 'string' || typeof b === 'string') {
        // VB (Option Strict Off): a number plus numeric text adds; two texts, or text that is not a number, concatenate
        if (typeof a === 'number' && numericText(b)) return add(a, Number(b), ctx);
        if (typeof b === 'number' && numericText(a)) return add(Number(a), b, ctx);
        // VB: a number plus text that is not a number converts the text to Double and fails ("a" + 5 is #Error)
        if (!sql && (typeof a === 'number' || typeof b === 'number')) throw new ExprError(`"${String(typeof a === 'string' ? a : b).slice(0, 40)}" + a number: the text is not a number (join text with &)`);
        return (a ?? '') + '' + (b ?? '');
      }
      if (a == null || b == null) return null;
      if (a instanceof Date && b === 0) return a;
      if (b instanceof Date && a === 0) return b;
      if (a instanceof Date || b instanceof Date) return Number(a) + Number(b);
      return add(Number(a), Number(b), ctx);
    case '-':
      if (a == null || b == null) return null;
      return a instanceof Date || b instanceof Date ? num(a) - num(b) : add(num(a), -num(b), ctx);
    case '*': return a == null || b == null ? null : ctx.doubles ? num(a) * num(b) : decMul(num(a), num(b));
    case '/': {
      if (a == null || b == null) return null;
      const d = num(b);
      return d === 0 && sql ? null : num(a) / d; // VB Double: 5 / 0 is Infinity, 0 / 0 is NaN
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
    const sc = ctx.scopes?.[s];
    // Sum(x, "Group", "Recursive"): a recursive group's node and every node below it
    if (sc?.recRows && args.length > idx + 1 && String(evaluate(args[idx + 1], ctx)).toLowerCase() === 'recursive') return sc.recRows;
    const rows = sc?.rows || ctx.dataSets[s];
    if (!rows) throw new ExprError(`${fname}: the scope "${s}" does not exist`);
    return rows;
  }
  // a detail row is its own scope (RDL): Sum(Fields.x) there is the row's value, not the group's or the table's total
  if (ctx.aggIndex != null && ctx.fields) return [ctx.fields];
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
    const c = Object.assign({}, ctx, { aggRows: base, aggIndex: undefined }); // row-local: nothing reads aggRows
    for (let i = vals.length; i < n; i++) { c.fields = base[i]; vals.push(evaluate(ast, c)); }
  }
  return vals.length === n ? vals : vals.slice(0, n);
}
/** RunningValue(…, "Sum"): running totals over a cached prefix, extended as it grows (a fold of decAdd, as AGG.sum). */
const RUN_SUMS = new WeakMap();
function runningSum(base, n, ast, ctx) {
  prefixValues(base, n, ast, ctx);
  const vals = RUN_CACHE.get(base).get(ast);
  let sums = RUN_SUMS.get(vals);
  if (!sums) { sums = []; RUN_SUMS.set(vals, sums); }
  for (let i = sums.length; i < n; i++) { const v = vals[i]; const prev = i ? sums[i - 1] : 0; sums.push(v != null && v !== '' ? add(prev, Number(v), ctx) : prev); }
  return n ? sums[n - 1] : 0;
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

const PURE_ROWS = new WeakMap();
/** Row-local, and reads neither Globals (page numbers change between passes) nor Parent (the caller's row). */
function pureRows(ast) {
  let r = PURE_ROWS.get(ast);
  if (r === undefined) {
    const walk = (n) => !n || typeof n !== 'object' || (Array.isArray(n) ? n.every(walk)
      : !(n.type === 'id' && ['globals', 'parent', 'partproperties'].includes(n.name.toLowerCase())) && Object.values(n).every(walk));
    r = rowLocal(ast) && walk(ast);
    PURE_ROWS.set(ast, r);
  }
  return r;
}

function mapRows(rows, ast, ctx) {
  const c = Object.assign({}, ctx, { aggRows: rows, aggIndex: undefined }); // an aggregate inside runs over these rows
  const out = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) { c.fields = rows[i]; out[i] = evaluate(ast, c); }
  return out;
}
const AGG = {
  sum: (vals, ctx) => { let s = 0; for (const v of vals) if (v != null && v !== '') s = add(s, Number(v), ctx); return s; },
  avg: (vals, ctx) => { let s = 0, c = 0; for (const v of vals) if (v != null && v !== '') { s = add(s, Number(v), ctx); c++; } return c ? s / c : null; },
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

/* --------------------------------------------------------------- dates
 * VB DateAdd / DateDiff semantics (Microsoft.VisualBasic.DateAndTime). A .NET DateTime has no time zone, so its
 * arithmetic is on the wall clock: a day added across a DST change keeps the time of day, and a difference in hours
 * counts clock hours. The wall clock is the report's time zone (ctx.timeZone; the host's when none is set):
 * wall() turns a date into that clock as a UTC timestamp (its getUTC* parts are the parts there); fromWall() turns it
 * back. W() is that clock as a Date, read with getUTC*.
 */
const DAY = 86400000;
/** @param {Date} d @param {any} z the evaluation context (its timeZone) */
const wall = (d, z) => toWall(d, z?.timeZone);
const fromWall = (ms, z) => zoneFromWall(ms, z?.timeZone);
const W = (d, z) => new Date(wall(d, z));
/** A value as a date in the context's locale and zone, or null. */
const toDate = (v, z) => readDate(v, z);
/** .NET AddHours/AddMinutes/AddSeconds: the double is rounded to a whole millisecond, half away from zero. */
const msOf = (n, unit) => Math.sign(n) * Math.round(Math.abs(n) * unit);
/**
 * DateAdd(interval, number, date). Years, quarters and months keep the day, clamped to the end of the target month
 * (31 Jan + 1 month = 28 Feb, 29 Feb 2024 + 1 year = 28 Feb 2025). The fraction of number is ignored except for hours,
 * minutes and seconds. "y" (day of year) and "w" (weekday) add days, as in VB.
 */
function dateAdd(interval, n, d, z) {
  d = toDate(d, z); if (!d) return null;
  n = Number(n);
  if (!Number.isFinite(n)) return null;
  const whole = Math.trunc(n);
  switch (String(interval).toLowerCase()) {
    case 'yyyy': case 'year': return addMonths(d, 12 * whole, z);
    case 'q': case 'quarter': return addMonths(d, 3 * whole, z);
    case 'm': case 'month': return addMonths(d, whole, z);
    case 'd': case 'day': case 'y': case 'dayofyear': case 'w': case 'weekday': return fromWall(wall(d, z) + whole * DAY, z);
    case 'ww': case 'week': case 'weekofyear': return fromWall(wall(d, z) + whole * 7 * DAY, z);
    case 'h': case 'hour': return fromWall(wall(d, z) + msOf(n, 3600000), z);
    case 'n': case 'minute': return fromWall(wall(d, z) + msOf(n, 60000), z);
    case 's': case 'second': return fromWall(wall(d, z) + msOf(n, 1000), z);
  }
  throw new ExprError(`DateAdd: unknown interval "${interval}"`);
}
/**
 * DateDiff(interval, date1, date2[, firstDayOfWeek]) as the .NET runtime computes it: years, quarters and months
 * count calendar boundaries; days, hours, minutes and seconds are whole elapsed units truncated toward zero; "w" is
 * whole weeks elapsed; "ww" counts first days of the week (Sunday by default) after date1 up to and including date2.
 */
function dateDiff(interval, a0, b0, first, z) {
  const a1 = toDate(a0, z), b1 = toDate(b0, z); if (!a1 || !b1) return null;
  const a = W(a1, z), b = W(b1, z); // wall clock: getUTC* parts
  const ms = b.getTime() - a.getTime();
  const fix = (x) => Math.trunc(x) + 0;
  switch (String(interval).toLowerCase()) {
    case 'yyyy': case 'year': return b.getUTCFullYear() - a.getUTCFullYear();
    case 'q': case 'quarter': return (b.getUTCFullYear() - a.getUTCFullYear()) * 4 + Math.floor(b.getUTCMonth() / 3) - Math.floor(a.getUTCMonth() / 3);
    case 'm': case 'month': return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
    case 'd': case 'day': case 'y': case 'dayofyear': return fix(ms / DAY);
    case 'w': case 'weekday': return fix(ms / DAY / 7);
    case 'ww': case 'week': case 'weekofyear': {
      const start = (x) => x.getTime() - (weekdayW(x, first) - 1) * DAY; // back to the first day of x's week
      return fix((start(b) - start(a)) / DAY / 7);
    }
    case 'h': case 'hour': return fix(ms / 3600000);
    case 'n': case 'minute': return fix(ms / 60000);
    case 's': case 'second': return fix(ms / 1000);
  }
  throw new ExprError(`DateDiff: unknown interval "${interval}"`);
}

/* ------------------------------------------------------------- functions */
const S = (v) => (v == null ? '' : String(v));
/** .NET ToUpper: one character for one (ß stays ß, as do ligatures that would expand: JS gives STRASSE). */
const vbUpper = (s) => { const u = s.toUpperCase(); return u.length === s.length ? u : [...s].map(c => { const x = c.toUpperCase(); return x.length === c.length ? x : c; }).join(''); };
/** Eager functions: get evaluated args. */
export const FUNCTIONS = {
  format: (ctx, v, f) => toText(v, f, ctx),
  upper: (ctx, s) => vbUpper(S(s)), ucase: (ctx, s) => vbUpper(S(s)),
  lower: (ctx, s) => S(s).toLowerCase(), lcase: (ctx, s) => S(s).toLowerCase(),
  left: (ctx, s, n) => S(s).slice(0, Number(n)),
  right: (ctx, s, n) => (Number(n) <= 0 ? '' : S(s).slice(-Number(n))),
  mid: (ctx, s, start, len) => S(s).substr(Number(start) - 1, len == null ? undefined : Number(len)),
  len: (ctx, s) => S(s).length,
  trim: (ctx, s) => S(s).trim(),
  replace: (ctx, s, a, b, start, count) => replaceText(S(s), S(a), S(b), start, count),
  instr: (ctx, s, sub) => S(s).indexOf(S(sub)) + 1,
  join: (ctx, arr, sep) => (Array.isArray(arr) ? arr.map(v => toText(v, null, ctx)).join(sep == null ? ', ' : S(sep)) : toText(arr, null, ctx)),
  contains: (ctx, hay, needle) => (Array.isArray(hay) ? hay.some(v => cmpVal(v, needle) === 0) : S(hay).toLowerCase().includes(S(needle).toLowerCase())),
  inlist: (ctx, v, ...list) => list.flat().some(x => cmpVal(v, x) === 0),
  cstr: (ctx, v) => toText(v, null, ctx),
  // String.valueOf in Java (imported JasperReports expressions) and String() in JavaScript (BIRT): "null", true/false,
  // Double.toString ("2.0"); JavaStr(x, "int") for an integral value. JavaFormat is java.util.Formatter (String.format).
  javastr: (ctx, v, kind) => javaString(v, kind, ctx.timeZone),
  jsstr: (ctx, v, digits) => (digits != null && typeof v === 'number' ? v.toFixed(Math.max(0, Math.min(100, Number(digits) || 0))) : jsString(v)), // JsStr(x, n): x.toFixed(n)
  javaformat: (ctx, f, ...args) => javaFormatString(S(f), args, ctx.locale, ctx.timeZone), // capped inside, before it builds
  // VB conversions: CInt rounds half to even and raises #Error for text that is not a number; a blank stays blank
  // VB: Nothing converts to the type default (0) unless the report keeps SQL nulls; True is -1
  cdbl: (ctx, v) => (v == null ? (ctx.nullPropagation === true ? null : 0) : v === '' ? null : v instanceof Date ? v.getTime() : typeof v === 'boolean' ? vbNum(v) : toNumber('CDbl', v)),
  cnum: (ctx, v) => num(v),
  val: (ctx, v) => vbVal(v),
  cint: (ctx, v) => (v == null ? (ctx.nullPropagation === true ? null : 0) : v === '' ? null : toInt('CInt', typeof v === 'boolean' ? vbNum(v) : v, 32)),
  cbool: (ctx, v) => vbBool(v),
  // VB CDate: text that is not a date (or a day that does not exist, 30 February) raises #Error
  cdate: (ctx, v) => { if (v == null) return null; const d = toDate(v, ctx); if (!d) throw new ExprError(`CDate: "${String(v).slice(0, 40)}" is not a date`); return d; },
  isnull: (ctx, v) => v == null, isnothing: (ctx, v) => v == null,
  coalesce: (ctx, ...vs) => { for (const v of vs) if (v != null && v !== '') return v; return null; },
  // Round is VB's Math.Round: half to even (2.5 → 2). RoundHalfAway is the Excel / format-string rule (2.5 → 3).
  round: (ctx, v, d) => (v == null ? null : roundHalfEven(Number(v), Number(d || 0))),
  roundhalfaway: (ctx, v, d) => (v == null ? null : roundHalfAway(Number(v), Number(d || 0))),
  abs: (ctx, v) => (v == null ? null : Math.abs(Number(v))),
  floor: (ctx, v) => (v == null ? null : Math.floor(Number(v))),
  ceiling: (ctx, v) => (v == null ? null : Math.ceil(Number(v))),
  int: (ctx, v) => (v == null ? null : Math.floor(Number(v))), // VB Int rounds down (Int(-2.5) = -3); Fix truncates
  pow: (ctx, a, b) => Number(a) ** Number(b),
  sqrt: (ctx, v) => Math.sqrt(Number(v)),
  now: (ctx) => (ctx.globals.ExecutionTime instanceof Date ? new Date(ctx.globals.ExecutionTime.getTime()) : new Date()),
  // midnight on the report's clock
  today: (ctx) => fromWall(Math.floor(wall(FUNCTIONS.now(ctx), ctx) / DAY) * DAY, ctx),
  dateadd: (ctx, i, n, d) => dateAdd(i, n, d, ctx),
  datediff: (ctx, i, a, b, first) => dateDiff(i, a, b, first, ctx),
  dateserial: (ctx, y, m, d) => {
    // out-of-range months and days roll over (as .NET's DateSerial); VB reads a year 0–29 as 2000–2029, 30–99 as 1930–1999
    let yr = Number(y);
    if (yr >= 0 && yr < 100) yr += yr < 30 ? 2000 : 1900;
    const w = new Date(0);
    w.setUTCFullYear(yr, Number(m) - 1, Number(d));
    return fromWall(w.getTime(), ctx);
  },
  year: (ctx, d) => { const x = toDate(d, ctx); return x ? W(x, ctx).getUTCFullYear() : null; },
  month: (ctx, d) => { const x = toDate(d, ctx); return x ? W(x, ctx).getUTCMonth() + 1 : null; },
  day: (ctx, d) => { const x = toDate(d, ctx); return x ? W(x, ctx).getUTCDate() : null; },
  monthname: (ctx, m, abbr) => {
    // English (the default) keeps the fixed names; another report locale gets its own month names
    if (!english(ctx.locale)) return formatDate(new Date(Date.UTC(2000, Number(m) - 1, 1)), truthy(abbr) ? 'MMM' : 'MMMM', ctx.locale, 'UTC');
    const s = MONTH_NAMES[Number(m) - 1] ?? new Date(2000, Number(m) - 1, 1).toLocaleString('en', { month: 'long' }); return truthy(abbr) ? s.slice(0, 3) : s;
  },
};

/* ------------------------------------------------- Phase 3 function library */
// capText (expr/parser.js): the longest string a function may build, shared with the formats
/** A finite number or null: Log(0), Asin(2) and friends give null, like 1 / 0. */
const fin = (x) => (Number.isFinite(x) ? x : null);
/** Run f on a number argument; null in, null out. */
const math1 = (f) => (ctx, v) => (v == null || v === '' ? null : fin(f(num(v))));
/** A date argument on the report's wall clock (read with getUTC*), or null when it is not a date. */
const dt = (v, z) => { const d = toDate(v, z); return d ? W(d, z) : null; };
/** Days since Sunday (0..6) of a wall date, shifted so firstDay (1 = Sunday … 7 = Saturday) is 1. */
const weekdayW = (w, first) => ((w.getUTCDay() - ((Number(first) || 1) - 1) + 7) % 7) + 1;
const dayOfYear = (w) => Math.round((Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()) - Date.UTC(w.getUTCFullYear(), 0, 1)) / DAY) + 1;
/** .NET AddMonths: keeps the day, clamped to the end of the target month (31 Jan + 1 month = 28 Feb). */
function addMonths(v, n, z) {
  const d = dt(v, z);
  if (!d || n == null || !Number.isFinite(Number(n))) return null;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Math.trunc(Number(n)));
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return fromWall(d.getTime(), z);
}
/** Add a number of units (milliseconds each) on the wall clock. */
function addUnits(v, n, ms, z) {
  const d = toDate(v, z);
  if (!d || n == null || !Number.isFinite(Number(n))) return null;
  return fromWall(wall(d, z) + msOf(Number(n), ms), z); // wall clock, as .NET DateTime.AddDays/AddHours
}
function datePart(interval, v, first, z) {
  const d = dt(v, z);
  if (!d) return null;
  switch (String(interval).toLowerCase()) {
    case 'yyyy': case 'year': return d.getUTCFullYear();
    case 'q': case 'quarter': return Math.floor(d.getUTCMonth() / 3) + 1;
    case 'm': case 'month': return d.getUTCMonth() + 1;
    case 'y': case 'dayofyear': return dayOfYear(d);
    case 'd': case 'day': return d.getUTCDate();
    case 'w': case 'weekday': return weekdayW(d, first);
    case 'ww': case 'weekofyear': {
      // week 1 holds 1 January; weeks start on firstDay (Sunday by default), as VB's DatePart
      const jan1 = weekdayW(new Date(Date.UTC(d.getUTCFullYear(), 0, 1)), first) - 1;
      return Math.floor((dayOfYear(d) - 1 + jan1) / 7) + 1;
    }
    case 'h': case 'hour': return d.getUTCHours();
    case 'n': case 'minute': return d.getUTCMinutes();
    case 's': case 'second': return d.getUTCSeconds();
    default: throw new ExprError(`DatePart: unknown interval "${interval}"`);
  }
}
/** Text that reads as a number ("12.5", " 7 ", "1e3"); "" and text with letters do not. */
const numericText = (v) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.trim()));
function isDate(v, z) {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== 'string') return false;
  return toDate(v, z) != null; // a day that rolls over (30 February) is not a date
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
/** VB Val: the number at the start of the text, blanks skipped, 0 when there is none; &H / &O read hex / octal. */
function vbVal(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? -1 : 0;
  const s = String(v).replace(/[ \t\r\n]/g, '');
  const radix = /^&([HhOo])([0-9A-Fa-f]*)/.exec(s);
  if (radix) { const n = parseInt(radix[2], radix[1].toLowerCase() === 'h' ? 16 : 8); return Number.isNaN(n) ? 0 : n; }
  const m = /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?/.exec(s);
  return m ? Number(m[0].replace(/[dD]/, 'e')) : 0;
}
/** VB CBool: True/False text, or a number (0 is False). Other text raises #Error; Nothing and a blank are False. */
function vbBool(v) {
  if (v == null || v === '') return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const t = String(v).trim().toLowerCase();
  if (t === 'true' || t === 'false') return t === 'true';
  if (numericText(v)) return Number(v) !== 0;
  throw new ExprError(`CBool: "${String(v).slice(0, 40)}" is not True, False or a number`);
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
/**
 * VB Replace(text, find, with[, start[, count]]): from the 1-based start (the text before it is dropped, as VB does),
 * at most count changes (-1: all). An empty find changes nothing. The result is capped at 1,000,000 characters before
 * it is built (a short text with many matches can otherwise grow without bound).
 */
function replaceText(s, a, b, start, count) {
  const st = start == null ? 1 : Math.trunc(Number(start));
  if (!(st >= 1)) throw new ExprError('Replace: the start must be 1 or more');
  if (st > 1) s = s.slice(st - 1);
  if (a === '') return s;
  let n = count == null ? -1 : Math.trunc(Number(count));
  if (n === 0) return s;
  let out = '', i = 0, len = 0;
  for (;;) {
    const j = s.indexOf(a, i);
    if (j < 0 || n === 0) break;
    len += j - i + b.length;
    capText('Replace', len + (s.length - j - a.length));
    out += s.slice(i, j) + b;
    i = j + a.length;
    if (n > 0) n--;
  }
  return out + s.slice(i);
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
  // VB StrDup(count, character): the first character of the text, count times (checked before it is built)
  strdup: (ctx, n, c) => { n = Math.max(0, Math.trunc(Number(n)) || 0); capText('StrDup', n); return c == null || c === '' ? '' : [...S(c)][0].repeat(n); },
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
  datepart: (ctx, i, d, first) => datePart(i, d, first, ctx),
  weekday: (ctx, d, first) => { const w = dt(d, ctx); return w ? weekdayW(w, first) : null; },
  weekdayname: (ctx, n, abbr, first) => {
    n = Number(n);
    if (!Number.isInteger(n) || n < 1 || n > 7) return null;
    const d = new Date(Date.UTC(2000, 0, 2 + n - 1 + ((Number(first) || 1) - 1))); // 2 Jan 2000 was a Sunday
    return formatDate(d, truthy(abbr) ? 'ddd' : 'dddd', ctx.locale, 'UTC');
  },
  quarter: (ctx, d) => { const w = dt(d, ctx); return w ? Math.floor(w.getUTCMonth() / 3) + 1 : null; },
  quartername: (ctx, d) => { const w = dt(d, ctx); return w ? `Q${Math.floor(w.getUTCMonth() / 3) + 1}` : null; },
  hour: (ctx, d) => dt(d, ctx)?.getUTCHours() ?? null,
  minute: (ctx, d) => dt(d, ctx)?.getUTCMinutes() ?? null,
  second: (ctx, d) => dt(d, ctx)?.getUTCSeconds() ?? null,
  addyears: (ctx, d, n) => addMonths(d, n == null ? null : 12 * Math.trunc(Number(n)), ctx),
  addmonths: (ctx, d, n) => addMonths(d, n, ctx),
  adddays: (ctx, d, n) => addUnits(d, n, 86400000, ctx),
  addhours: (ctx, d, n) => addUnits(d, n, 3600000, ctx),
  addminutes: (ctx, d, n) => addUnits(d, n, 60000, ctx),
  addseconds: (ctx, d, n) => addUnits(d, n, 1000, ctx),
  datevalue: (ctx, v) => { const d = toDate(v, ctx); return d ? fromWall(Math.floor(wall(d, ctx) / DAY) * DAY, ctx) : null; },
  timeserial: (ctx, h, m, s) => { const w = new Date(0); w.setUTCFullYear(1, 0, 1); w.setUTCHours(Number(h) || 0, Number(m) || 0, Number(s) || 0, 0); return fromWall(w.getTime(), ctx); },
  datestring: (ctx) => formatDate(FUNCTIONS.now(ctx), 'MM-dd-yyyy', undefined, ctx.timeZone),
  // inspection
  // VB IsNumeric reads the culture's grouping, currency symbol and parentheses: "1,000" and "$5" are numbers
  isnumeric: (ctx, v) => (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && (numericText(v) || Number.isFinite(parseNumber(v, ctx.locale)))),
  isdate: (ctx, v) => isDate(v, ctx),
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
    const d = toDate(v, ctx);
    if (!d) throw new ExprError(`ToDateTime: "${String(v).slice(0, 40)}" is not a date`);
    return d;
  },
});
/** Names that may be written without brackets. */
const CONSTANTS = { pi: Math.PI, e: Math.E };

/** Names shown in the designer's expression helper. */
export const FUNCTION_NAMES = [
  'Sum', 'Avg', 'Count', 'CountDistinct', 'CountRows', 'Min', 'Max', 'First', 'Last', 'RunningValue', 'RowNumber',
  'Median', 'Mode', 'Rank', 'StDev', 'StDevP', 'Var', 'VarP', 'DistinctSum', 'AggregateIf',
  'IIF', 'Switch', 'IsNull', 'Coalesce', 'Lookup', 'LookupSet', 'Previous', 'GroupIndex', 'Level', 'Join', 'Contains', 'InList',
  ...['Format', 'Upper', 'Lower', 'Left', 'Right', 'Mid', 'Len', 'Trim', 'Replace', 'InStr', 'CStr', 'CDbl', 'CInt', 'CDate', 'CBool',
    'Round', 'RoundHalfAway', 'Abs', 'Floor', 'Ceiling', 'Int', 'Pow', 'Sqrt', 'Now', 'Today', 'DateAdd', 'DateDiff', 'DateSerial', 'Year', 'Month', 'Day', 'MonthName'],
  'StartsWith', 'EndsWith', 'IndexOf', 'LastIndexOf', 'Substring', 'PadLeft', 'PadRight', 'Split', 'Chr', 'Asc', 'TrimStart', 'TrimEnd', 'StrReverse', 'Space', 'StrDup', 'LCase', 'UCase',
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

/**
 * Rank(expr[, scope[, descending]]): the current row's place among the scope's rows by expr. Competition rank, as
 * SQL RANK() and Excel RANK.EQ: ties share a rank and the next rank skips (10, 10, 7 → 1, 1, 3), so "Rank(…) <= 3"
 * keeps every row tied at the cut, as an SSRS Top N filter does. descending (default True, or "desc"/"asc"): 1 is the
 * largest; False or "asc": 1 is the smallest. expr is evaluated for each row of the scope as that row alone (a detail
 * row is its own scope) and for the current row; rows where it is Nothing or "" are not ranked, and a current row
 * whose value is Nothing gets Nothing. Scope: a group, data region or data set name; none means the data region.
 * Values compare as in sorting (numbers, dates, text). It ranks rows, not group instances.
 */
const RANKS = new WeakMap();
function rank(n, ctx) {
  const args = n.args;
  if (!args.length) throw new ExprError('Rank needs an expression: Rank(Fields.amount[, "Scope"[, descending]])', n.p);
  const rows = args.length > 1 && evaluate(args[1], ctx) != null ? scopeRows(args, 1, ctx, n.name) : (ctx.region?.rows || ctx.aggRows || (ctx.fields ? [ctx.fields] : []));
  const d = args.length > 2 ? evaluate(args[2], ctx) : true;
  const desc = typeof d === 'string' ? !/^asc/i.test(d.trim()) : d == null || truthy(d);
  const x = evaluate(args[0], ctx);
  if (x == null || x === '') return null;
  // the scope's values, sorted once per (row array, call, length): each row's rank is then two binary searches
  let byCall = RANKS.get(rows);
  if (!byCall) RANKS.set(rows, byCall = new Map());
  let hit = pureRows(args[0]) ? byCall.get(n) : null;
  if (!hit || hit.len !== rows.length) {
    const c = Object.assign({}, ctx, { aggIndex: 0 });
    const vals = [];
    for (const r of rows) { c.fields = r; c.aggRows = [r]; const v = evaluate(args[0], c); if (v != null && v !== '') vals.push(v); }
    hit = { len: rows.length, vals: vals.sort(cmpVal) };
    if (pureRows(args[0])) byCall.set(n, hit);
  }
  const vals = hit.vals;
  const bound = (strict) => { let lo = 0, hi = vals.length; while (lo < hi) { const m = (lo + hi) >> 1; const c = cmpVal(vals[m], x); if (c < 0 || (!strict && c === 0)) lo = m + 1; else hi = m; } return lo; };
  return desc ? vals.length - bound(false) + 1 : bound(true) + 1; // 1 + how many are larger (smaller)
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
    // memoised per render (ctx.aggCache) for each (row array, call): a group total asked in every detail row is
    // computed once. Row arrays are rebuilt for each render (sort, filter, drill state), and only ever grow (a scope's run)
    // within one, so a result keyed by array, call and length never goes stale.
    const cache = ctx.aggCache;
    if (cache && rows.length > 1 && pureRows(args[0])) {
      let m = cache.get(rows);
      if (!m) cache.set(rows, m = new Map());
      // a scope's run grows as rows are shown: a result counts only for the length it was computed at
      const hit = m.get(n);
      if (hit && hit.len === rows.length) return hit.v;
      const v = AGG[name](aggValues(rows, args[0], ctx), ctx);
      m.set(n, { len: rows.length, v });
      return v;
    }
    return AGG[name](aggValues(rows, args[0], ctx), ctx);
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
    return AGG.sum(aggValues(pick, args[1], ctx), ctx);
  }
  if (name === 'aggregateif') {
    // AggregateIf(condition, "Sum", expr[, scope])
    if (args.length < 3) throw new ExprError('AggregateIf needs 3 arguments: AggregateIf(condition, "Sum", expr)', n.p);
    const fn = String(evaluate(args[1], ctx)).toLowerCase();
    if (!(fn in AGG)) throw new ExprError(`AggregateIf: unknown aggregate "${fn}"`, n.p);
    const rows = scopeRows(args, 3, ctx, n.name);
    const ok = mapRows(rows, args[0], ctx);
    return AGG[fn](aggValues(rows.filter((_, i) => truthy(ok[i])), args[2], ctx), ctx);
  }
  if (name === 'countrows') return scopeRows(args, 0, ctx, n.name).length;
  if (name === 'rownumber') {
    // a group header comes before its rows: it counts them too (ctx.pendingRows), as RDL evaluates a group's running values
    if (args.length) { const sc = ctx.scopes?.[evaluate(args[0], ctx)]; if (!sc) throw new ExprError('RowNumber: unknown scope', n.p); return sc.index + 1 + (ctx.pendingRows?.length || 0); }
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
      const pend = ctx.pendingRows;
      if (pend?.length && sc.run) {
        // a group header: the rows shown so far and the group's own rows, which come after it
        if (fn === 'sum' && rowLocal(args[0])) return add(runningSum(rows, rows.length, args[0], ctx), AGG.sum(mapRows(pend, args[0], ctx), ctx), ctx);
        return AGG[fn](rowLocal(args[0]) ? prefixValues(rows, rows.length, args[0], ctx).concat(mapRows(pend, args[0], ctx)) : mapRows(rows.concat(pend), args[0], ctx), ctx);
      }
    } else if (ctx.runningRows) rows = ctx.runningRows;
    else if (ctx.aggRows && ctx.aggIndex != null) rows = ctx.aggRows.slice(0, ctx.aggIndex + 1);
    else rows = ctx.fields ? [ctx.fields] : [];
    // asked once per row over a growing prefix of the same rows: reuse the values already computed
    if (args.length > 2 || (!ctx.runningRows && ctx.aggRows && ctx.aggIndex != null)) {
      const base = args.length > 2 ? rows : ctx.aggRows;
      if (rowLocal(args[0])) return fn === 'sum' ? runningSum(base, rows.length, args[0], ctx) : AGG[fn](prefixValues(base, rows.length, args[0], ctx), ctx);
    }
    return AGG[fn](mapRows(rows, args[0], ctx), ctx);
  }
  if (name === 'rank') return rank(n, ctx);
  if (name === 'previous') return previous(n, ctx);
  if (name === 'groupindex') {
    const sc = args.length ? ctx.scopes?.[evaluate(args[0], ctx)] : ctx.group;
    if (args.length && !sc) throw new ExprError('GroupIndex: unknown scope', n.p);
    return sc?.number ?? null;
  }
  if (name === 'level') {
    // 0-based depth in a recursive group (0 outside one, as in RDL)
    if (args.length) { const sc = ctx.scopes?.[evaluate(args[0], ctx)]; if (!sc) throw new ExprError('Level: unknown scope', n.p); return sc.level ?? 0; }
    return ctx.level ?? 0;
  }
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
const RESERVED = new Set(['rank', 'iif', 'switch', 'choose', 'lookup', 'lookupset', 'previous', 'groupindex', 'level', 'countrows', 'rownumber',
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
