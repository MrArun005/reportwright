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
 * @property {string} [nonFinite]    how Infinity and NaN print: undefined (as SSRS), "blank" or "error"
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
/**
 * x as [BigInt integer, scale] from its shortest decimal form (String(x)), exact at any size; null when it has none
 * (NaN, Infinity, or more than 15 decimals).
 */
function decBig(x) {
  const m = Number.isFinite(x) ? /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(x)) : null;
  if (!m) return null;
  const frac = m[3] || '';
  let scale = frac.length - Number(m[4] || 0), digits = m[2] + frac;
  if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
  return scale > 15 ? null : [BigInt(m[1] + digits), scale];
}
/** the decimal t / 10^k as the double nearest to it (the parse of its digits is correctly rounded). */
function decNum(t, k) {
  const neg = t < 0n;
  let s = (neg ? -t : t).toString().padStart(k + 1, '0');
  if (k) s = `${s.slice(0, -k)}.${s.slice(-k)}`;
  return Number((neg ? '-' : '') + s);
}
/** a + b on the decimal values. Past 2^49 a scaled integer leaves the fast path: the sum is then BigInt arithmetic. */
export function decAdd(a, b) {
  if (Number.isInteger(a) && Number.isInteger(b)) return a + b;
  const x = dec(a), y = dec(b);
  if (x && y) {
    const k = Math.max(x[1], y[1]);
    const p = x[0] * P10[k - x[1]], q = y[0] * P10[k - y[1]], t = p + q;
    if (Number.isSafeInteger(p) && Number.isSafeInteger(q) && Number.isSafeInteger(t)) return t / P10[k];
  }
  const X = decBig(a), Y = decBig(b);
  if (!X || !Y) return a + b;
  const k = Math.max(X[1], Y[1]);
  return decNum(X[0] * 10n ** BigInt(k - X[1]) + Y[0] * 10n ** BigInt(k - Y[1]), k);
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
  const key = `${ctx?.locale || 'en-US'}|${ctx?.caseSensitive === true}|${ctx?.naturalSort === true}|${ctx?.collation || ''}`;
  let c = collators.get(key);
  if (!c && ctx?.collation === 'ordinal') { // BIRT: String.compareTo, by UTF-16 code unit ("B" before "a")
    c = { compare: (x, y) => (x < y ? -1 : x > y ? 1 : 0) };
    collators.set(key, c);
  }
  if (!c && ctx?.collation === 'java') { // JasperReports: java.text.Collator (spaces and punctuation ignored, case after letters)
    try { c = new Intl.Collator(ctx?.locale || 'en-US', { ignorePunctuation: true, sensitivity: 'variant', caseFirst: 'lower' }); } catch { c = new Intl.Collator('en-US', { ignorePunctuation: true }); }
    collators.set(key, c);
  }
  if (!c) {
    // text compares as text ("10" before "9", as SSRS's CompareInfo does); naturalSort: true reads digit runs as numbers (N18)
    const numeric = ctx?.naturalSort === true;
    try { c = new Intl.Collator(ctx?.locale || 'en-US', { numeric, sensitivity: ctx?.caseSensitive === true ? 'variant' : 'accent' }); } catch { c = new Intl.Collator('en-US', { numeric, sensitivity: 'accent' }); }
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
  if (a == null) return ctx?.nullOrder === 'low' ? -1 : 1;
  if (b == null) return ctx?.nullOrder === 'low' ? 1 : -1;
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
  if (op === 'and' || op === '&&' || op === 'andalso') return truthy(evaluate(n.a, ctx)) && truthy(evaluate(n.b, ctx));
  if (op === 'or' || op === '||' || op === 'orelse') return truthy(evaluate(n.a, ctx)) || truthy(evaluate(n.b, ctx));
  let a = evaluate(n.a, ctx), b = evaluate(n.b, ctx);
  // Is / IsNot: x Is Nothing tests for null (and "" is not Nothing here); two values: the same value
  if (op === 'is' || op === 'isnot') { const same = a == null || b == null ? a == null && b == null : a === b || cmpVal(a, b) === 0; return op === 'is' ? same : !same; }
  if (op === 'xor') return truthy(a) !== truthy(b);
  if (op === '&') { const x = toText(a, null, ctx), y = toText(b, null, ctx); capText('&', x.length + y.length); return x + y; }
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
        { const x = String(a ?? ''), y = String(b ?? ''); capText('+', x.length + y.length); return x + y; }
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
    case '%': case 'mod': return a == null || b == null ? null : (num(a) % num(b)) + 0; // + 0: no -0 // VB Mod: the dividend's sign (-7 Mod 3 is -1)
    case '^': return a == null || b == null ? null : num(a) ** num(b);
    case '\\': { // VB \: both sides rounded to Long (half to even), the quotient truncated
      if (a == null || b == null) return null;
      const x = roundHalfEven(num(a), 0), y = roundHalfEven(num(b), 0);
      if (y === 0) throw new ExprError('\\ by zero');
      return Math.trunc(x / y) + 0;
    }
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
    const rows = sc?.rows || ctx.dataSets[s] || groupInstanceRows(s, ctx);
    if (!rows) throw new ExprError(`${fname}: the scope "${s}" does not exist`);
    return rows;
  }
  // a detail row is its own scope (RDL): Sum(Fields.x) there is the row's value, not the group's or the table's total
  if (ctx.aggIndex != null && ctx.fields) return [ctx.fields];
  if (ctx.aggRows) return ctx.aggRows;
  return ctx.fields ? [ctx.fields] : [];
}
/** A table group named outside its own bands: the rows of the instance the current row belongs to, or null. */
function groupInstanceRows(name, ctx) {
  const g = ctx.groupChains?.[name];
  if (!g || !ctx.fields) return null;
  const keys = g.keys.map(k => compile(String(k).replace(/^=/, '')));
  const c = Object.assign({}, ctx, { aggRows: undefined, aggIndex: undefined });
  const keyOf = (r) => { c.fields = r; return keys.map(k => { const v = evaluate(k, c); return v instanceof Date ? v.getTime() : v; }).join('\u0001'); };
  const want = keyOf(ctx.fields);
  return g.rows.filter(r => keyOf(r) === want);
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

/**
 * True when a property value (a literal, an =expression or a {template}) reads only the current row, the parameters
 * and the globals: no aggregate, scope, Lookup, Previous, Parent or report function. Streaming exports
 * (engine/stream.js) evaluate such values one row at a time. rowNumber: RowNumber() / RowNumber(Nothing) is allowed
 * too (the caller supplies ctx.rowNumber). A value that does not parse counts as row-local: it is #Error either way.
 * @param {any} v @param {{ rowNumber?: boolean }} [o]
 */
export function streamable(v, { rowNumber = false } = {}) {
  let p;
  try { p = parseValue(v); } catch { return true; }
  if (p.kind === 'lit') return true;
  const asts = p.kind === 'expr' ? [p.ast] : p.parts.filter(x => typeof x !== 'string').map(x => /** @type {any} */ (x).ast);
  return asts.every(a => streamableAst(a, { rowNumber }));
}
/** streamable for a parsed expression. @param {any} ast @param {{ rowNumber?: boolean }} [o] */
export function streamableAst(ast, { rowNumber = false } = {}) {
  const ok = (n) => {
    if (!n || typeof n !== 'object') return true;
    if (Array.isArray(n)) return n.every(ok);
    if (n.type === 'id') { const k = n.name.toLowerCase(); return k !== 'parent' && (k in ROOTS || k in CONSTANTS); }
    if (n.type === 'call') {
      const k = n.name.toLowerCase();
      if (n.obj) return false;
      if (k === 'rownumber') return rowNumber && (!n.args.length || (n.args.length === 1 && n.args[0].type === 'lit' && n.args[0].v == null));
      if (!(k in FUNCTIONS || k === 'iif' || k === 'switch' || k === 'choose')) return false;
    }
    return Object.values(n).every(ok);
  };
  return ok(ast);
}

/** The aggregates a streaming export folds row by row (aggregator). */
export const FOLDS = new Set(['sum', 'count', 'avg', 'min', 'max']);
/**
 * A running Sum, Count, Avg, Min or Max: values added one at a time give the same result as the aggregate over the
 * whole list (the same decimal addition, the same comparison, the same errors), in O(1) memory.
 * @param {string} name lower case, one of FOLDS @param {EvalCtx} ctx
 */
export function aggregator(name, ctx) {
  let s = 0, c = 0, m = null, bad = null;
  const one = (v) => {
    if (name === 'count') { if (v != null) c++; return; }
    if (name === 'min' || name === 'max') { if (v != null && (m == null || (name === 'min' ? cmpVal(v, m) < 0 : cmpVal(v, m) > 0))) m = v; return; }
    if (v == null || v === '') return;
    const x = Number(v);
    if (name === 'sum' && Number.isNaN(x) && typeof v === 'string') { bad ||= new ExprError(`Sum: "${v.slice(0, 40)}" is not a number`); return; }
    s = add(s, x, ctx); c++;
  };
  return {
    /** @param {any} v one row's value (an array, a LookupSet's, adds each item) */
    add(v) { if (Array.isArray(v)) for (const x of v) one(x); else one(v); },
    value() {
      if (bad) throw bad;
      return name === 'sum' ? s : name === 'count' ? c : name === 'avg' ? (c ? s / c : null) : m;
    },
  };
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
  // text that is not a number is #Error, as in SSRS (it printed NaN)
  sum: (vals, ctx) => { let s = 0; for (const v of vals) if (v != null && v !== '') { const x = Number(v); if (Number.isNaN(x) && typeof v === 'string') throw new ExprError(`Sum: "${v.slice(0, 40)}" is not a number`); s = add(s, x, ctx); } return s; },
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
  // VB Mid: the start is 1 or more (0 raises an error, as VB does: it printed the last character)
  mid: (ctx, s, start, len) => { const st = Number(start); if (!(st >= 1)) throw new ExprError('Mid: the start must be 1 or more'); if (len != null && Number(len) < 0) throw new ExprError('Mid: the length must be 0 or more'); return S(s).substr(st - 1, len == null ? undefined : Number(len)); },
  len: (ctx, s) => S(s).length,
  trim: (ctx, s) => S(s).trim(),
  replace: (ctx, s, a, b, start, count) => replaceText(S(s), S(a), S(b), start, count),
  instr: (ctx, s, sub) => S(s).indexOf(S(sub)) + 1,
  join: (ctx, arr, sep) => {
    if (!Array.isArray(arr)) return toText(arr, null, ctx);
    const parts = arr.map(v => toText(v, null, ctx)), j = sep == null ? ', ' : S(sep);
    capText('Join', parts.reduce((n, p) => n + p.length, 0) + j.length * Math.max(0, parts.length - 1));
    return parts.join(j);
  },
  // .NET String.Contains and VB Like are ordinal: "Hello".Contains("ELL") is False (N12)
  contains: (ctx, hay, needle) => (Array.isArray(hay) ? hay.some(v => cmpVal(v, needle) === 0) : S(hay).includes(S(needle))),
  inlist: (ctx, v, ...list) => list.flat().some(x => cmpVal(v, x) === 0),
  cstr: (ctx, v) => toText(v, null, ctx),
  // String.valueOf in Java (imported JasperReports expressions) and String() in JavaScript (BIRT): "null", true/false,
  // Double.toString ("2.0"); JavaStr(x, "int") for an integral value. JavaFormat is java.util.Formatter (String.format).
  javastr: (ctx, v, kind) => javaString(v, kind, ctx.timeZone),
  jsstr: (ctx, v, digits) => (digits != null && typeof v === 'number' ? v.toFixed(Math.max(0, Math.min(100, Number(digits) || 0))) : jsString(v)), // JsStr(x, n): x.toFixed(n)
  javaformat: (ctx, f, ...args) => javaFormatString(S(f), args, ctx.locale, ctx.timeZone), // capped inside, before it builds
  // VB conversions: CInt rounds half to even and raises #Error for text that is not a number; a blank stays blank
  // VB: Nothing converts to the type default (0) unless the report keeps SQL nulls; True is -1
  cdbl: (ctx, v) => (v == null ? (ctx.nullPropagation === true ? null : 0) : v === '' ? null : v instanceof Date ? v.getTime() : typeof v === 'boolean' ? vbNum(v) : toNumber('CDbl', v, ctx.locale)),
  cnum: (ctx, v) => num(v),
  val: (ctx, v) => vbVal(v),
  cint: (ctx, v) => (v == null ? (ctx.nullPropagation === true ? null : 0) : v === '' ? null : toInt('CInt', typeof v === 'boolean' ? vbNum(v) : v, 32, ctx.locale)),
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
function toNumber(fname, v, locale) {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  // the report locale's way (de-DE "1.234,5" is 1234.5, en-US "-$5" is -5), as VB's CDbl reads the culture (N4)
  const t = typeof v === 'string' ? v.trim() : '';
  const n = t === '' ? NaN : Number.isFinite(Number(t)) ? Number(t) : parseNumber(t, locale);
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
function toInt(fname, v, bits, locale) {
  const n = toNumber(fname, v, locale);
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
function radix(v, base) {
  const t = roundHalfEven(Number(v), 0);
  if (!Number.isFinite(t)) throw new ExprError(`${base === 16 ? 'Hex' : 'Oct'}: ${v} is not a number`);
  const h = t >= 0 ? t.toString(base) : BigInt.asUintN(t >= -(2 ** 31) ? 32 : 64, BigInt(t)).toString(base);
  return h.toUpperCase();
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
  // VB Hex/Oct: Int32 two's complement for a negative (Long when outside Int32)
  hex: (ctx, v) => (v == null ? null : radix(v, 16)),
  oct: (ctx, v) => (v == null ? null : radix(v, 8)),
  instrrev: (ctx, s, sub, start) => { s = S(s); const st = start == null || Number(start) === -1 ? s.length : Number(start); return s.lastIndexOf(S(sub), st - S(sub).length) + 1; },
  formatnumber: (ctx, v, d) => toText(v == null ? null : Number(v), `N${d == null || Number(d) < 0 ? 2 : Math.min(99, Number(d))}`, ctx),
  formatpercent: (ctx, v, d) => toText(v == null ? null : Number(v), `P${d == null || Number(d) < 0 ? 2 : Math.min(99, Number(d))}`, ctx),
  formatcurrency: (ctx, v, d) => toText(v == null ? null : Number(v), `C${d == null || Number(d) < 0 ? 2 : Math.min(99, Number(d))}`, ctx),
  lset: (ctx, s, n) => { n = Math.max(0, Math.trunc(Number(n)) || 0); capText('LSet', n); return S(s).slice(0, n).padEnd(n); },
  rset: (ctx, s, n) => { n = Math.max(0, Math.trunc(Number(n)) || 0); capText('RSet', n); return S(s).slice(0, n).padStart(n); },
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
  // VB Information.IsNumeric: a number, a Boolean (True is -1), or text that reads as a number in the report's locale
  isnumeric: (ctx, v) => (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean' || (typeof v === 'string' && (numericText(v) || (!/\p{L}/u.test(v.replace(/e[+-]?\d+\s*$/i, '')) && Number.isFinite(parseNumber(v, ctx.locale)))))), // no letters: "12a" is not
  isdate: (ctx, v) => isDate(v, ctx),
  isarray: (ctx, v) => Array.isArray(v),
  // conversion
  tostring: (ctx, v, f) => toText(v, f, ctx),
  toint16: (ctx, v) => toInt('ToInt16', v, 16, ctx.locale),
  toint32: (ctx, v) => toInt('ToInt32', v, 32, ctx.locale),
  toint64: (ctx, v) => toInt('ToInt64', v, 64, ctx.locale),
  todouble: (ctx, v) => toNumber('ToDouble', v, ctx.locale),
  tosingle: (ctx, v) => toNumber('ToSingle', v, ctx.locale),
  todecimal: (ctx, v) => toNumber('ToDecimal', v, ctx.locale),
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
/* ------------------------------------------------------------- JasperReports variables */
/**
 * JasperValue(dataSet, calc, expr, at, reset, end, key1…keyN): a JasperReports report variable as Jasper prints it
 * (the JRXML importer writes these). Jasper reads the data set's rows once, in order, and a variable adds each row in;
 * it starts again (empty: null) when its reset group starts. Groups break on every change of their key (key1 is the
 * outermost). The value depends on when the text field is evaluated:
 *   at "detail": after the current row; "header": before the group's first row (a variable that resets with this
 *   group, or an inner one, is still empty); "footer": after the group's last row; "start": before any row (title);
 *   "end": after the last row (summary).
 *   end 0: evaluationTime="Report" (after the last row); k: evaluationTime="Group" of group k (after the last row of
 *   the group-k instance there); -1: the band's own time.
 *   reset 0: the whole report; k: group k.
 *   calc: Sum, Count (values that are not null), Rows (every row: REPORT_COUNT, <group>_COUNT), Average, Lowest,
 *   Highest, DistinctCount, First.
 * Linear: each (rows, expression, calc, reset) runs once per render, then every cell reads its index.
 */
const JASPER = new WeakMap();
let astIds = new WeakMap(), astNext = 0;
const astId = (a) => { let i = astIds.get(a); if (i === undefined) { i = ++astNext; astIds.set(a, i); } return i; };
function jasperValue(n, ctx) {
  const a = n.args;
  if (a.length < 6) throw new ExprError('JasperValue needs a data set, a calculation, an expression, a time, a reset and an end', n.p);
  const ds = String(evaluate(a[0], ctx)), at = String(evaluate(a[3], ctx)).toLowerCase();
  // "Sum@k": incrementType="Group" of group k (the variable adds a value only on each group-k instance's last row)
  const [calc, incrS] = String(evaluate(a[1], ctx)).toLowerCase().split('@');
  const incr = incrS ? Math.trunc(Number(incrS)) || 0 : 0;
  const reset = Math.trunc(Number(evaluate(a[4], ctx))) || 0, end = Math.trunc(Number(evaluate(a[5], ctx)));
  const keys = a.slice(6);
  if (reset < 0 || reset > keys.length || end > keys.length || incr < 0 || incr > keys.length) throw new ExprError('JasperValue: no such group', n.p);
  const rows = ctx.dataSets?.[ds];
  if (!rows) throw new ExprError(`JasperValue: the data set "${ds}" does not exist`, n.p);
  let byRows = JASPER.get(rows);
  if (!byRows) { byRows = new Map(); JASPER.set(rows, byRows); }
  const kid = keys.map(astId).join(',');
  let info = byRows.get(`k|${kid}`);
  if (!info) { info = jasperIndex(rows, keys, ctx); byRows.set(`k|${kid}`, info); }
  const N = rows.length;
  const posOf = (r) => (r ? info.pos.get(r) : undefined);
  let anchor;
  if (at === 'detail') anchor = posOf(ctx.fields);
  else if (at === 'header') anchor = posOf(ctx.aggRows?.[0]);
  else if (at === 'footer') anchor = posOf(ctx.aggRows?.[ctx.aggRows.length - 1]);
  else if (at === 'start') anchor = -1;
  else anchor = N - 1;
  if (anchor === undefined) return null;
  let b;
  if (end === 0) b = N - 1;
  else if (end > 0) b = N ? info.end[end][Math.max(0, anchor)] : -1; // the title: the end of the first instance
  else b = at === 'header' ? anchor - 1 : anchor;
  if (b < 0) return calc === 'rows' ? 0 : null; // REPORT_COUNT and <group>_COUNT start at 0, the others empty
  // a header's time is before its group's first row, but after the resets that row brings
  // (the built-in counts are 0 there, a variable is empty)
  if (end < 0 && at === 'header' && reset > 0 && info.start[reset][anchor] > b) return calc === 'rows' ? 0 : null;
  const vk = `v|${astId(a[2])}|${calc}|${reset}|${incr}|${kid}`;
  let vals = byRows.get(vk);
  if (!vals) { vals = jasperRun(rows, a[2], calc, reset ? info.start[reset] : null, incr ? info.end[incr] : null, ctx); byRows.set(vk, vals); }
  return vals[b];
}
/** Each row's position, and per group depth the first and last row of the instance it is in (break on change). */
function jasperIndex(rows, keys, ctx) {
  const pos = new Map(rows.map((r, i) => [r, i]));
  const kv = keys.map(k => mapRows(rows, k, ctx).map(v => (v instanceof Date ? v.getTime() : v)));
  const start = [null], endA = [null];
  for (let d = 1; d <= keys.length; d++) {
    const st = new Array(rows.length), en = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      let brk = i === 0;
      for (let k = 0; k < d && !brk; k++) if (kv[k][i] !== kv[k][i - 1]) brk = true;
      st[i] = brk ? i : st[i - 1];
    }
    for (let i = rows.length - 1; i >= 0; i--) en[i] = i === rows.length - 1 || st[i + 1] !== st[i] ? i : en[i + 1];
    start.push(st); endA.push(en);
  }
  return { pos, start, end: endA };
}
/** The variable's value after each row (null before its first value), restarting where `start` says. */
function jasperRun(rows, ast, calc, start, incrEnd, ctx) {
  const xs = calc === 'rows' ? null : mapRows(rows, ast, ctx);
  const out = new Array(rows.length);
  let sum = null, cnt = 0, nn = 0, mn = null, mx = null, first, seen = null;
  for (let i = 0; i < rows.length; i++) {
    if (i === 0 || (start && start[i] === i)) { sum = null; cnt = 0; nn = 0; mn = null; mx = null; first = undefined; seen = new Set(); }
    const v = xs ? xs[i] : 1;
    // incrementType Group: a value is added only on each group instance's last row
    if (incrEnd && incrEnd[i] !== i) { out[i] = i && !(start && start[i] === i) ? out[i - 1] : null; continue; }
    cnt++;
    if (v != null && v !== '') {
      nn++;
      if (calc === 'sum' || calc === 'average') sum = sum == null ? Number(v) : add(sum, Number(v), ctx);
      if (mn == null || cmpVal(v, mn) < 0) mn = v;
      if (mx == null || cmpVal(v, mx) > 0) mx = v;
      seen.add(v instanceof Date ? v.getTime() : v);
    }
    if (first === undefined) first = v ?? null;
    out[i] = calc === 'sum' ? sum : calc === 'count' ? nn : calc === 'rows' ? cnt : calc === 'average' ? (nn ? sum / nn : null)
      : calc === 'lowest' ? mn : calc === 'highest' ? mx : calc === 'distinctcount' ? seen.size : calc === 'first' ? first : null;
  }
  return out;
}

/** Names that may be written without brackets. */
const CONSTANTS = { pi: Math.PI, e: Math.E };

/** Names shown in the designer's expression helper. */
export const FUNCTION_NAMES = [
  'Sum', 'Avg', 'Count', 'CountDistinct', 'CountRows', 'Min', 'Max', 'First', 'Last', 'RunningValue', 'RowNumber',
  'Median', 'Mode', 'Rank', 'StDev', 'StDevP', 'Var', 'VarP', 'DistinctSum', 'AggregateIf',
  'IIF', 'Switch', 'IsNull', 'Coalesce', 'Lookup', 'LookupSet', 'Previous', 'GroupIndex', 'Level', 'Join', 'Contains', 'InList',
  ...['Format', 'Upper', 'Lower', 'Left', 'Right', 'Mid', 'Len', 'Trim', 'Replace', 'InStr', 'CStr', 'CDbl', 'CInt', 'CDate', 'CBool',
    'Round', 'RoundHalfAway', 'Abs', 'Floor', 'Ceiling', 'Int', 'Pow', 'Sqrt', 'Now', 'Today', 'DateAdd', 'DateDiff', 'DateSerial', 'Year', 'Month', 'Day', 'MonthName'],
  'StartsWith', 'EndsWith', 'IndexOf', 'LastIndexOf', 'Substring', 'PadLeft', 'PadRight', 'Split', 'Chr', 'Asc', 'TrimStart', 'TrimEnd', 'StrReverse', 'Space', 'StrDup', 'Hex', 'Oct', 'InStrRev', 'FormatNumber', 'FormatPercent', 'FormatCurrency', 'LSet', 'RSet', 'JavaStr', 'JsStr', 'JavaFormat', 'LCase', 'UCase',
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
  // in a group header or footer: rank the group among its sibling groups, the expression computed per group (N10:
  // Rank(Sum(x), "Rows") ranked a group's total against the rows)
  if (ctx.aggIndex == null && ctx.group?.siblings && ctx.group.siblings.length > 1) {
    let byCall = RANKS.get(ctx.group.siblings);
    if (!byCall) RANKS.set(ctx.group.siblings, byCall = new Map());
    let gv = byCall.get(n);
    if (!gv) {
      gv = [];
      for (const rs of ctx.group.siblings) { const v = evaluate(args[0], Object.assign({}, ctx, { fields: rs[0], aggRows: rs, aggIndex: undefined })); if (v != null && v !== '') gv.push(v); }
      gv.sort((p, q) => sortCompare(p, q, ctx));
      byCall.set(n, gv);
    }
    const lt = gv.filter(v => sortCompare(v, x, ctx) < 0).length, gt = gv.filter(v => sortCompare(v, x, ctx) > 0).length;
    return desc ? gt + 1 : lt + 1;
  }
  // the scope's values, sorted once per (row array, call, length): each row's rank is then two binary searches
  let byCall = RANKS.get(rows);
  if (!byCall) RANKS.set(rows, byCall = new Map());
  let hit = pureRows(args[0]) ? byCall.get(n) : null;
  if (!hit || hit.len !== rows.length) {
    const c = Object.assign({}, ctx, { aggIndex: 0 });
    const vals = [];
    for (const r of rows) { c.fields = r; c.aggRows = [r]; const v = evaluate(args[0], c); if (v != null && v !== '') vals.push(v); }
    hit = { len: rows.length, vals: vals.sort((p, q) => sortCompare(p, q, ctx)) }; // the sort's order: a total order over mixed types (N29)
    if (pureRows(args[0])) byCall.set(n, hit);
  }
  const vals = hit.vals;
  const bound = (strict) => { let lo = 0, hi = vals.length; while (lo < hi) { const m = (lo + hi) >> 1; const c = sortCompare(vals[m], x, ctx); if (c < 0 || (!strict && c === 0)) lo = m + 1; else hi = m; } return lo; };
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
    if (args.length && evaluate(args[0], ctx) != null) { const sc = ctx.scopes?.[evaluate(args[0], ctx)]; if (!sc) throw new ExprError('RowNumber: unknown scope', n.p); return sc.index + 1 + (ctx.pendingRows?.length || 0); }
    // RowNumber() / RowNumber(Nothing): the data region; in a footer that is every row so far (it printed 1)
    if (ctx.rowNumber != null) return ctx.rowNumber;
    return ctx.region?.run ? ctx.region.index + 1 + (ctx.pendingRows?.length || 0) : 1;
  }
  if (name === 'runningvalue') {
    if (args.length < 2) throw new ExprError('RunningValue needs 2 arguments: RunningValue(expr, "Sum")', n.p);
    const fn = String(evaluate(args[1], ctx)).toLowerCase();
    if (!(fn in AGG)) throw new ExprError(`RunningValue: unknown function "${fn}"`, n.p);
    let rows;
    // no scope (or Nothing): the data region, as RDL does, so a detail row runs on across groups and a footer has the
    // total (N11); the region's run is the same path as an explicit scope
    const noScope = args.length <= 2 || evaluate(args[2], ctx) == null;
    if (noScope && ctx.region?.run && !ctx.runningRows) {
      const sc = ctx.region;
      rows = sc.run;
      const pend = ctx.pendingRows;
      if (pend?.length) return AGG[fn](rowLocal(args[0]) ? prefixValues(rows, rows.length, args[0], ctx).concat(mapRows(pend, args[0], ctx)) : mapRows(rows.concat(pend), args[0], ctx), ctx);
      if (rowLocal(args[0])) return fn === 'sum' ? runningSum(rows, rows.length, args[0], ctx) : AGG[fn](prefixValues(rows, rows.length, args[0], ctx), ctx);
      return AGG[fn](mapRows(rows, args[0], ctx), ctx);
    }
    if (args.length > 2 && !noScope) {
      const sn = evaluate(args[2], ctx);
      const sc = ctx.scopes?.[sn];
      if (!sc) {
        // a group outside its own bands: running over the group instance the current row is in, up to that row
        const gr = groupInstanceRows(sn, ctx);
        if (!gr) throw new ExprError('RunningValue: unknown scope', n.p);
        return AGG[fn](mapRows(gr.slice(0, gr.indexOf(ctx.fields) + 1), args[0], ctx), ctx);
      }
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
  if (name === 'jaspervalue') return jasperValue(n, ctx);
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
const RESERVED = new Set(['rank', 'jaspervalue', 'iif', 'switch', 'choose', 'lookup', 'lookupset', 'previous', 'groupindex', 'level', 'countrows', 'rownumber',
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

/**
 * Calls an expression makes that no render could answer: an unknown function (Frobnicate(1)), Code.X(…) with no report
 * function X, or a method after "." that is not one of the .NET string methods. One message per name, with the
 * nearest known name. Pure: walks the AST, evaluates nothing.
 * @param {any} ast @param {Set<string>} custom the report's own function names, lower case
 * @param {(name: string, known: string[]) => string | null} [suggest]
 * @returns {string[]}
 */
export function callIssues(ast, custom, suggest) {
  const out = [], seen = new Set();
  const say = (key, msg) => { if (!seen.has(key)) { seen.add(key); out.push(msg); } };
  const known = () => [...FUNCTION_NAMES, ...Object.keys(FUNCTIONS)];
  /** @param {any} n @param {number} depth */
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 200) return;
    if (Array.isArray(n)) { for (const x of n) walk(x, depth + 1); return; }
    if (n.type === 'call') {
      const lower = String(n.name).toLowerCase();
      const isCode = n.obj?.type === 'id' && n.obj.name.toLowerCase() === 'code';
      const isString = n.obj?.type === 'id' && n.obj.name.toLowerCase() === 'string' && lower === 'format';
      if (!n.obj && !builtin(lower) && !custom.has(lower)) {
        const g = suggest?.(n.name, known());
        say(lower, `Unknown function "${n.name}"${g ? ` (did you mean "${g}"?)` : ''}`);
      } else if (isCode && !custom.has(lower)) say(`code.${lower}`, `The report has no function "${n.name}" (Code.${n.name})`);
      else if (n.obj && !isCode && !isString && !METHODS[lower]) say(`.${lower}`, `"${n.name}(…)" after "." is not supported`);
    }
    for (const k in n) if (k !== 'p' && n[k] && typeof n[k] === 'object') walk(n[k], depth + 1);
  };
  walk(ast, 0);
  return out;
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

/** .NET methods on a value, called as x.Name(…): the same as the function Name(x, …) */
const METHODS = { padleft: 'padleft', padright: 'padright', substring: 'substring', toupper: 'ucase', toupperinvariant: 'ucase', tolower: 'lcase', tolowerinvariant: 'lcase',
  trim: 'trim', trimstart: 'trimstart', trimend: 'trimend', startswith: 'startswith', endswith: 'endswith', indexof: 'indexof', lastindexof: 'lastindexof',
  contains: 'contains', replace: 'replace', split: 'split', tostring: 'tostring' };
/** .NET composite formatting, String.Format("{0:N2} of {1,-8}", a, b): {index[,alignment][:format]}, {{ and }} */
export function netFormat(f, args, ctx) {
  let out = '';
  for (let i = 0; i < f.length; i++) {
    const c = f[i];
    if (c === '{' && f[i + 1] === '{') { out += '{'; i++; continue; }
    if (c === '}' && f[i + 1] === '}') { out += '}'; i++; continue; }
    if (c === '}') throw new ExprError('String.Format: a "}" without its "{"');
    if (c !== '{') { out += c; continue; }
    const e = f.indexOf('}', i);
    if (e < 0) throw new ExprError('String.Format: a "{" without its "}"');
    const m = /^\s*(\d{1,3})\s*(?:,\s*(-?\d{1,4}))?\s*(?::([^}]*))?$/.exec(f.slice(i + 1, e));
    if (!m) throw new ExprError(`String.Format: "{${f.slice(i + 1, e).slice(0, 20)}}" is not a placeholder`);
    const k = Number(m[1]);
    if (k >= args.length) throw new ExprError(`String.Format: {${k}} has no argument`);
    let t = toText(args[k], m[3] || null, ctx);
    const w = m[2] ? Number(m[2]) : 0;
    if (Math.abs(w) > t.length) t = w < 0 ? t.padEnd(-w) : t.padStart(w);
    capText('String.Format', out.length + t.length + f.length - e);
    out += t;
    i = e;
  }
  return out;
}
function callCustom(n, name, ctx) {
  if (n.obj && n.obj.type === 'id' && n.obj.name.toLowerCase() === 'string' && name === 'format') {
    if (!n.args.length) throw new ExprError('String.Format needs a format', n.p);
    const [f, ...rest] = n.args.map(a => evaluate(a, ctx));
    return netFormat(S(f), rest, ctx);
  }
  if (n.obj && !(n.obj.type === 'id' && n.obj.name.toLowerCase() === 'code') && METHODS[name]) {
    return FUNCTIONS[METHODS[name]](ctx, evaluate(n.obj, ctx), ...n.args.map(a => evaluate(a, ctx)));
  }
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
