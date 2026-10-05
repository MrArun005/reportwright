// @ts-check
/**
 * Java and Groovy expressions of a JasperReports design → VB.NET expressions as SSRS/ActiveReports write them, which
 * rdlx.js then translates to Pagewright. The common forms are covered: $F{x}, $P{x}, $V{x} (variables come from the
 * caller), string concatenation, the ternary, comparisons, null tests, casts and boxing, the usual String, Number, Math
 * and Date methods, msg(…) message formats and the JasperReports built-in functions (UPPER, IF, DATEFORMAT…).
 * Anything else throws Untranslatable with what it was, so the item says so and shows the expression as text.
 *
 * Linear: one tokenizer pass and a recursive-descent parser with a depth cap; the input is untrusted.
 */

export class Untranslatable extends Error {}

const MAX_DEPTH = 64;
const STR_TYPES = /^(java\.lang\.)?(String|Character|char)$/;
const NUM_TYPES = /^(java\.lang\.|java\.math\.)?(Integer|Long|Short|Byte|Double|Float|BigDecimal|BigInteger|Number|int|long|short|byte|double|float)$/;
const BOOL_TYPES = /^(java\.lang\.)?(Boolean|boolean)$/;
const DATE_TYPES = /^(java\.util\.Date|java\.sql\.(Date|Timestamp|Time)|java\.time\.\w+|Date|Timestamp)$/;
const INT_TYPES = /^(java\.lang\.|java\.math\.)?(Integer|Long|Short|Byte|BigInteger|int|long|short|byte)$/;
/** True for a Java integral class (Integer, Long, int…): / on two of them divides as integers. */
export const integral = (cls) => INT_TYPES.test(String(cls || ''));
/** The value kind of a Java class name: 'str' | 'num' | 'bool' | 'date' | 'any'. */
export function kindOf(cls) {
  const c = String(cls || '');
  return STR_TYPES.test(c) ? 'str' : NUM_TYPES.test(c) ? 'num' : BOOL_TYPES.test(c) ? 'bool' : DATE_TYPES.test(c) ? 'date' : 'any';
}

/* ------------------------------------------------------------------ tokens */

const isDigit = (c) => c >= '0' && c <= '9';
const isIdStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
const isId = (c) => isIdStart(c) || isDigit(c);
const OPS = ['>>>', '===', '!==', '?.', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '?', ':', '+', '-', '*', '/', '%', '<', '>', '!', '(', ')', ',', '.', '[', ']', '&', '|', '^', '~'];

/** @typedef {{ k: 'num'|'str'|'id'|'ref'|'op', v: string, ref?: string, int?: boolean }} Tok */
/** @param {string} s @returns {Tok[]} */
function tokenize(s) {
  /** @type {Tok[]} */
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    // $F{name} $P{name} $P!{name} $V{name} $R{key} $X{…}
    if (c === '$' && /[FPVRX]/.test(s[i + 1] || '') && (s[i + 2] === '{' || (s[i + 2] === '!' && s[i + 3] === '{'))) {
      const bang = s[i + 2] === '!';
      const start = i + (bang ? 4 : 3);
      const e = s.indexOf('}', start);
      if (e < 0) throw new Untranslatable(`an unclosed $${s[i + 1]}{`);
      out.push({ k: 'ref', ref: s[i + 1] + (bang ? '!' : ''), v: s.slice(start, e) });
      i = e + 1; continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(s[i + 1] || ''))) {
      let j = i;
      if (c === '0' && (s[j + 1] === 'x' || s[j + 1] === 'X')) { j += 2; while (j < n && /[0-9a-fA-F_]/.test(s[j])) j++; out.push({ k: 'num', v: String(parseInt(s.slice(i + 2, j).replace(/_/g, ''), 16)), int: true }); if (/[lL]/.test(s[j] || '')) j++; i = j; continue; }
      while (j < n && (isDigit(s[j]) || s[j] === '_')) j++;
      if (s[j] === '.' && isDigit(s[j + 1] || '')) { j++; while (j < n && isDigit(s[j])) j++; }
      if (s[j] === 'e' || s[j] === 'E') { let k = j + 1; if (s[k] === '+' || s[k] === '-') k++; if (isDigit(s[k] || '')) { j = k; while (j < n && isDigit(s[j])) j++; } }
      const v = s.slice(i, j).replace(/_/g, '');
      // an int or long literal: no point, exponent or d / f / G suffix
      let int = /^\d+$/.test(v);
      if (/[dDfFlL]/.test(s[j] || '') && !isId(s[j + 1] || '')) { if (/[dDfF]/.test(s[j])) int = false; j++; } // 100d, 2.5f, 1L
      else if (s[j] === 'G' && !isId(s[j + 1] || '')) { int = false; j++; } // Groovy BigDecimal 1.5G
      out.push({ k: 'num', v, int }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      if (c === '"' && s.startsWith('"""', i)) throw new Untranslatable('a Groovy multi-line string');
      let j = i + 1, v = '';
      for (;;) {
        if (j >= n) throw new Untranslatable('an unclosed string');
        const d = s[j];
        if (d === c) break;
        if (d === '\\') {
          const e = s[j + 1];
          if (e === 'u') { v += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16) || 0xfffd); j += 6; continue; }
          v += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === 'b' || e === 'f' ? '' : e === '0' ? '' : e;
          j += 2; continue;
        }
        if (c === '"' && d === '$' && s[j + 1] === '{') throw new Untranslatable('a Groovy "${…}" string');
        v += d; j++;
      }
      out.push({ k: 'str', v }); i = j + 1; continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isId(s[j])) j++;
      out.push({ k: 'id', v: s.slice(i, j) }); i = j; continue;
    }
    const op = OPS.find(o => s.startsWith(o, i));
    if (!op) throw new Untranslatable(`the character "${c}"`);
    out.push({ k: 'op', v: op }); i += op.length;
  }
  return out;
}

/* ------------------------------------------------------------------ parser */

const PRIMS = new Set(['int', 'long', 'short', 'byte', 'double', 'float', 'boolean', 'char']);
const BIN = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!=', '===', '!=='], ['<', '>', '<=', '>=', 'instanceof'], ['+', '-'], ['*', '/', '%']];

/** @param {Tok[]} toks */
function parse(toks) {
  let p = 0, depth = 0;
  const peek = (o = 0) => toks[p + o];
  const isOp = (v, o = 0) => toks[p + o]?.k === 'op' && toks[p + o].v === v;
  const take = (v) => { if (!isOp(v)) throw new Untranslatable(`"${v}" was expected`); p++; };
  const deeper = () => { if (++depth > MAX_DEPTH) throw new Untranslatable('an expression nested too deeply'); };
  function ternary() {
    deeper();
    const c = binary(0);
    if (isOp('?')) {
      p++;
      if (isOp(':')) { p++; const b = ternary(); depth--; return { k: 'elvis', a: c, b }; } // Groovy a ?: b
      const a = ternary(); take(':'); const b = ternary();
      depth--;
      return { k: 'cond', c, a, b };
    }
    depth--;
    return c;
  }
  function binary(level) {
    if (level >= BIN.length) return unary();
    let l = binary(level + 1);
    for (;;) {
      const t = peek();
      if (!t || !((t.k === 'op' || (t.k === 'id' && t.v === 'instanceof')) && BIN[level].includes(t.v))) return l;
      p++;
      if (t.v === 'instanceof') throw new Untranslatable('instanceof');
      l = { k: 'bin', op: t.v, l, r: binary(level + 1) };
    }
  }
  function unary() {
    deeper();
    let out;
    if (isOp('!') || isOp('-') || isOp('+') || isOp('~')) { const op = peek().v; p++; out = { k: 'un', op, e: unary() }; }
    else if (isOp('++') || isOp('--')) throw new Untranslatable('++ and --');
    else if (isOp('(') && isCast()) {
      p++;
      let type = '';
      while (!isOp(')')) type += peek().v, p++;
      p++;
      out = { k: 'cast', type, e: unary() };
    } else out = postfix(primary());
    depth--;
    return out;
  }
  /** "(Type) x": a parenthesised type name followed by the start of an operand */
  function isCast() {
    let j = 1, name = '';
    while (toks[p + j] && (toks[p + j].k === 'id' || (toks[p + j].k === 'op' && (toks[p + j].v === '.' || toks[p + j].v === '[' || toks[p + j].v === ']')))) { name += toks[p + j].v; j++; }
    if (!name || !(toks[p + j]?.k === 'op' && toks[p + j].v === ')')) return false;
    const next = toks[p + j + 1];
    const typeLike = PRIMS.has(name) || /^([a-z]\w*\.)*[A-Z]\w*(\[\])?$/.test(name);
    return typeLike && !!next && (next.k !== 'op' || next.v === '(' || next.v === '!');
  }
  function primary() {
    const t = peek();
    if (!t) throw new Untranslatable('an expression that ends too early');
    p++;
    if (t.k === 'num') return { k: 'num', v: t.v, int: t.int };
    if (t.k === 'str') return { k: 'str', v: t.v };
    if (t.k === 'ref') return { k: 'ref', ref: t.ref, name: t.v };
    if (t.k === 'op' && t.v === '(') { const e = ternary(); take(')'); return { k: 'paren', e }; }
    if (t.k === 'op' && t.v === '[') throw new Untranslatable('a list literal');
    if (t.k === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v === 'true' };
      if (t.v === 'null') return { k: 'null' };
      if (t.v === 'new') {
        let name = '';
        while (peek() && (peek().k === 'id' || isOp('.'))) { name += peek().v; p++; }
        if (isOp('[')) throw new Untranslatable(`new ${name}[]`);
        const args = callArgs();
        return { k: 'new', name, args };
      }
      // a dotted name: java.lang.Math.abs, Boolean.TRUE…
      return { k: 'id', name: t.v };
    }
    throw new Untranslatable(`"${t.v}"`);
  }
  function callArgs() {
    take('(');
    const args = [];
    if (!isOp(')')) { for (;;) { args.push(ternary()); if (isOp(',')) { p++; continue; } break; } }
    take(')');
    return args;
  }
  function postfix(e) {
    for (;;) {
      if (isOp('.') || isOp('?.')) {
        p++;
        const t = peek();
        if (!t || t.k !== 'id') throw new Untranslatable('a "." without a name after it');
        p++;
        if (isOp('(')) e = { k: 'call', obj: e, name: t.v, args: callArgs() };
        else e = { k: 'member', obj: e, name: t.v };
        continue;
      }
      if (isOp('(') && e.k === 'id') { e = { k: 'call', obj: null, name: e.name, args: callArgs() }; continue; }
      if (isOp('[')) { // x["name"] (JavaScript: row["COL"], params["P"]); a computed index is not translated
        const t = peek(1);
        if (!t || (t.k !== 'str' && t.k !== 'num') || !isOp(']', 2)) throw new Untranslatable('an index [ ]');
        p += 3;
        e = { k: 'index', obj: e, key: t.v };
        continue;
      }
      return e;
    }
  }
  const e = ternary();
  if (p < toks.length) throw new Untranslatable(`"${toks[p].v}" after the end of the expression`);
  return e;
}

/* ------------------------------------------------------------------ VB emitter */

/** @typedef {{ s: string, t: 'str'|'num'|'bool'|'date'|'any', p: number, i?: boolean }} V  p: precedence of the result (higher binds tighter); i: a Java integer (int, long…) */
/**
 * @typedef {{
 *   field: (name: string) => V,
 *   param: (name: string) => V,
 *   variable: (name: string) => V,
 *   resource?: (key: string) => V,
 *   ident?: (name: string) => V | undefined,
 *   index?: (n: any, E: (x: any) => V) => V | undefined,
 *   memberOf?: (n: any, E: (x: any) => V) => V | undefined,
 *   call?: (n: any, E: (x: any) => V) => V | undefined,
 *   notes: string[],
 * }} Env
 *   ident, index, memberOf, call: hooks for another dialect (BIRT's JavaScript: row["X"], params["P"].value, Total.sum…);
 *   undefined from a hook falls through to the Java rules.
 */
const vbStr = (s) => {
  const parts = String(s).split(/(\r\n|\n|\r|\t)/);
  return parts.filter((x, i) => x !== '' || (i === 0 && parts.length === 1)).map(x => (x === '\t' ? 'vbTab' : /^(\r\n|\n|\r)$/.test(x) ? 'vbCrLf' : `"${x.replace(/"/g, '""')}"`)).join(' & ') || '""';
};
const A = (s, t = 'any') => ({ s, t, p: 9 });
const wrap = (v, p) => (v.p < p ? `(${v.s})` : v.s);
const fn = (name, args, t = 'any') => A(`${name}(${args.map(a => a.s).join(', ')})`, t);
const isNull = (n) => n.k === 'null' || (n.k === 'paren' && isNull(n.e));

/** Java DecimalFormat / SimpleDateFormat pattern → a .NET format string (what rdlx.js and Pagewright read). */
export function javaPattern(pat, kind = 'any') {
  const s = String(pat ?? '');
  if (!s) return undefined;
  const dateLike = kind === 'date' || (kind !== 'num' && /[yMdHhmsEaSk]/.test(s.replace(/'[^']*'/g, '')) && !/[#0]/.test(s.replace(/'[^']*'/g, '')));
  if (dateLike) {
    return s.replace(/'([^']*)'|E{4,}|E{1,3}|a+|S{1,3}|u|Z+|X+|z+/g, (m, lit) => {
      if (lit !== undefined) return lit ? `"${lit}"` : "\\'";
      if (/^E{4,}/.test(m)) return 'dddd';
      if (/^E/.test(m)) return 'ddd';
      if (/^a/.test(m)) return 'tt';
      if (/^S/.test(m)) return 'f'.repeat(m.length);
      if (m === 'u') return 'd';
      return 'zzz';
    });
  }
  const pos = s.split(';')[0];
  if (pos.includes('¤')) { const d = (/\.(0+)/.exec(pos) || ['', ''])[1].length; return `C${d}`; }
  return s.replace(/'([^']*)'/g, (_, lit) => (lit ? `"${lit}"` : "\\'")).replace(/‰/g, '‰');
}

/**
 * Java DecimalFormat rounds HALF_EVEN (10.125 with "#,##0.00" is 10.12, 2.5 with "#,##0" is 2); a .NET format string
 * rounds halves away from zero. The decimals the pattern shows (after % or ‰ scaling), so the importer can round the
 * value half to even first (VB Round); null for a pattern that is not a plain number pattern (scientific, none).
 * @param {string} pat
 */
export function halfEvenDigits(pat) {
  const pos = String(pat ?? '').split(';')[0].replace(/'[^']*'/g, '');
  if (!/[#0]/.test(pos) || /E/.test(pos)) return null;
  const m = /\.([#0]*)/.exec(pos);
  return (m ? m[1].length : 0) + (pos.includes('%') ? 2 : pos.includes('‰') ? 3 : 0);
}
/** Format(v, pattern) for a DecimalFormat pattern: rounded half to even first, as Java does. */
const javaNumFormat = (v, pat) => {
  const d = halfEvenDigits(pat);
  return `Format(${d == null ? v.s : `Round(${v.s}, ${d})`}, ${vbStr(javaPattern(pat, 'num') || '')})`;
};

/** msg("…{0,number,0.00}…", a, b) → concatenation with Format calls. */
function message(pattern, args) {
  /** @type {string[]} */
  const parts = [];
  let i = 0, lit = '';
  const flush = () => { if (lit) parts.push(vbStr(lit)); lit = ''; };
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "'") {
      const e = pattern.indexOf("'", i + 1);
      if (e === i + 1) { lit += "'"; i += 2; continue; }
      if (e < 0) { lit += pattern.slice(i + 1); break; }
      lit += pattern.slice(i + 1, e); i = e + 1; continue;
    }
    if (c === '{') {
      const e = pattern.indexOf('}', i);
      if (e < 0) throw new Untranslatable('a msg() pattern with an unclosed {');
      const [idx, type = '', style = ''] = pattern.slice(i + 1, e).split(',').map(x => x.trim());
      const a = args[Number(idx)];
      if (!a || !/^\d+$/.test(idx)) throw new Untranslatable(`msg() argument {${idx}}`);
      flush();
      const fmt = type === 'number' ? (style === 'integer' ? '#,##0' : style === 'percent' ? 'P0' : style === 'currency' ? 'C2' : style ? javaPattern(style, 'num') : '#,##0.###')
        : type === 'date' || type === 'time' ? ({ short: type === 'date' ? 'd' : 't', medium: type === 'date' ? 'MMM d, yyyy' : 'T', long: type === 'date' ? 'MMMM d, yyyy' : 'T', full: 'D' }[style] ?? (style ? javaPattern(style, 'date') : type === 'date' ? 'MMM d, yyyy' : 'T'))
          : null;
      if (type && fmt == null && type !== 'choice') throw new Untranslatable(`msg() format "${type}"`);
      if (type === 'choice') throw new Untranslatable('msg() choice formats');
      const javaNum = type === 'number' && !/^(integer|percent|currency)$/.test(style);
      parts.push(javaNum ? javaNumFormat(a, style || '#,##0.###') : fmt ? `Format(${type === 'number' && style === 'integer' ? `Round(${a.s}, 0)` : a.s}, ${vbStr(fmt)})` : wrap(a, 6));
      i = e + 1; continue;
    }
    lit += c; i++;
  }
  flush();
  return A(parts.length ? (parts.length === 1 ? parts[0] : parts.join(' & ')) : '""', 'str');
}

const JR_FUNCS = {
  UPPER: (a) => fn('UCase', a, 'str'), LOWER: (a) => fn('LCase', a, 'str'), LEN: (a) => fn('Len', a, 'num'), TRIM: (a) => fn('Trim', a, 'str'),
  LEFT: (a) => fn('Left', a, 'str'), RIGHT: (a) => fn('Right', a, 'str'), MID: (a) => fn('Mid', a, 'str'),
  CONCATENATE: (a) => ({ s: a.map(x => wrap(x, 6)).join(' & ') || '""', t: 'str', p: 5 }),
  IF: (a) => fn('IIF', a), AND: (a) => ({ s: a.map(x => wrap(x, 3)).join(' AndAlso '), t: 'bool', p: 2 }), OR: (a) => ({ s: a.map(x => wrap(x, 2)).join(' OrElse '), t: 'bool', p: 1 }),
  NOT: (a) => ({ s: `Not ${wrap(a[0], 4)}`, t: 'bool', p: 3 }), ABS: (a) => fn('Math.Abs', a, 'num'), FLOOR: (a) => fn('Math.Floor', a, 'num'), CEIL: (a) => fn('Math.Ceiling', a, 'num'),
  SQRT: (a) => fn('Math.Sqrt', a, 'num'), POWER: (a) => fn('Math.Pow', a, 'num'), MOD: (a) => ({ s: `${wrap(a[0], 7)} Mod ${wrap(a[1], 8)}`, t: 'num', p: 7 }),
  // ROUND(x) is Java Math.round (floor(x + 0.5)); ROUND(x, d) BigDecimal HALF_UP (away from zero)
  ROUND: (a) => (a[1] ? A(`Math.Round(${a[0].s}, ${a[1].s}, MidpointRounding.AwayFromZero)`, 'num') : { ...A(`Math.Floor(${wrap(a[0], 6)} + 0.5)`, 'num'), i: true }),
  NOW: () => A('Now', 'date'), TODAY: () => A('Today', 'date'), YEAR: (a) => fn('Year', a, 'num'), MONTH: (a) => fn('Month', a, 'num'), DAY: (a) => fn('Day', a, 'num'),
  ISBLANK: (a) => A(`IsNothing(${a[0].s}) OrElse ${wrap(a[0], 4)} = ""`, 'bool'),
};

/**
 * Translate one Java/Groovy expression.
 * @param {string} src @param {Env} env
 * @returns {V}
 */
export function javaToVb(src, env) {
  const ast = parse(tokenize(String(src)));
  return em(ast, env, 0);
}

/** @returns {V} */
function em(n, env, d) {
  if (d > MAX_DEPTH * 2) throw new Untranslatable('an expression nested too deeply');
  const E = (x) => em(x, env, d + 1);
  switch (n.k) {
    case 'num': return { ...A(n.v, 'num'), i: !!n.int };
    case 'str': return { s: vbStr(n.v), t: 'str', p: n.v.includes('\n') || n.v.includes('\t') ? 5 : 9 };
    case 'bool': return A(n.v ? 'True' : 'False', 'bool');
    case 'null': return A('Nothing');
    case 'paren': { const v = E(n.e); return { ...v, p: 9, s: `(${v.s})` }; } // keeps i (an integer value)
    case 'ref':
      if (n.ref === 'F') return env.field(n.name);
      if (n.ref === 'P') return env.param(n.name);
      if (n.ref === 'V') return env.variable(n.name);
      if (n.ref === 'R') { if (env.resource) return env.resource(n.name); throw new Untranslatable(`the resource $R{${n.name}}`); }
      throw new Untranslatable(`$${n.ref}{${n.name}}`);
    case 'cast': {
      const v = E(n.e);
      const k = kindOf(n.type.replace(/\[\]$/, ''));
      if (k === 'str') return fn('CStr', [v], 'str');
      // (int) and (long) truncate toward zero (Java), where CInt would round half to even: (int)2.675 is 2
      if (k === 'num') return /Integer|Long|Short|Byte|int|long|short|byte/.test(n.type) ? { ...fn('Fix', [v], 'num'), i: true } : fn('CDbl', [v], 'num');
      if (k === 'bool') return fn('CBool', [v], 'bool');
      return v; // (Object), (Date), (Comparable)…: the value as it is
    }
    case 'un': {
      const v = E(n.e);
      if (n.op === '!') return { s: `Not ${wrap(v, 4)}`, t: 'bool', p: 3 };
      if (n.op === '-') return { s: `-${wrap(v, 8)}`, t: 'num', p: 8, i: v.i };
      if (n.op === '+') return v;
      throw new Untranslatable('the operator ~');
    }
    case 'elvis': { const a = E(n.a), b = E(n.b); return fn('IIF', [A(`IsNothing(${a.s})`, 'bool'), b, a], a.t); }
    case 'cond': { const a = E(n.a), b = E(n.b); return fn('IIF', [E(n.c), a, b], a.t === b.t ? a.t : 'any'); }
    case 'bin': return emBin(n, env, d);
    case 'id': return env.ident?.(n.name) ?? emId(n.name);
    case 'index': { const v = env.index?.(n, E); if (v) return v; throw new Untranslatable('an index [ ]'); }
    case 'member': return env.memberOf?.(n, E) ?? emMember(n, env, d);
    case 'new': return emNew(n, env, d);
    case 'call': return env.call?.(n, E) ?? emCall(n, env, d);
  }
  throw new Untranslatable('this expression');
}

function emBin(n, env, d) {
  // a long chain (a + b + c…) is left-deep: walk its left spine in a loop, not by recursion
  const spine = [];
  let cur = n;
  while (cur.k === 'bin') { spine.push(cur); cur = cur.l; }
  let acc = em(cur, env, d + 1);
  for (let i = spine.length - 1; i >= 0; i--) acc = combine(spine[i], acc, env, d);
  return acc;
}

/** One binary operator, its left side already emitted. @param {any} n @param {V} l @returns {V} */
function combine(n, l, env, d) {
  const E = (x) => em(x, env, d + 1);
  const op = n.op;
  if (op === '==' || op === '!=' || op === '===' || op === '!==') {
    const neg = op[0] === '!';
    if (isNull(n.r) || isNull(n.l)) { const v = isNull(n.r) ? l : E(n.r); return neg ? A(`Not IsNothing(${v.s})`, 'bool') : A(`IsNothing(${v.s})`, 'bool'); }
    const r = E(n.r);
    return { s: `${wrap(l, 5)} ${neg ? '<>' : '='} ${wrap(r, 5)}`, t: 'bool', p: 4 };
  }
  if (op === '&&') return { s: `${wrap(l, 2)} AndAlso ${wrap(E(n.r), 3)}`, t: 'bool', p: 2 };
  if (op === '||') return { s: `${wrap(l, 1)} OrElse ${wrap(E(n.r), 2)}`, t: 'bool', p: 1 };
  if (op === '&' || op === '|' || op === '^') {
    const r = E(n.r);
    if (l.t !== 'bool' && r.t !== 'bool') throw new Untranslatable(`the bit operator ${op}`);
    if (op === '^') return fn('IIF', [l, A(`Not ${wrap(r, 4)}`, 'bool'), r], 'bool');
    return { s: `${wrap(l, op === '&' ? 2 : 1)} ${op === '&' ? 'And' : 'Or'} ${wrap(r, op === '&' ? 3 : 2)}`, t: 'bool', p: op === '&' ? 2 : 1 };
  }
  if (op === '<' || op === '>' || op === '<=' || op === '>=') return { s: `${wrap(l, 5)} ${op} ${wrap(E(n.r), 5)}`, t: 'bool', p: 4 };
  const r = E(n.r);
  if (op === '+') {
    // Java: + is concatenation as soon as one side is a String
    if (l.t === 'str' || r.t === 'str') return { s: `${wrap(l, 5)} & ${wrap(r, 6)}`, t: 'str', p: 5 };
    return { s: `${wrap(l, 6)} + ${wrap(r, 7)}`, t: l.t === 'date' ? 'date' : 'num', p: 6, i: !!(l.i && r.i) };
  }
  const i = !!(l.i && r.i); // int op int stays an int in Java
  if (op === '-') return { s: `${wrap(l, 6)} - ${wrap(r, 7)}`, t: 'num', p: 6, i };
  // Java int / int truncates toward zero (7 / 2 is 3); Groovy (and any double side) divides exactly
  if (op === '/' && i && env.intDivision) return { ...fn('Fix', [A(`${wrap(l, 7)} / ${wrap(r, 8)}`, 'num')], 'num'), i: true };
  if (op === '*' || op === '/') return { s: `${wrap(l, 7)} ${op} ${wrap(r, 8)}`, t: 'num', p: 7, i: op === '*' && i };
  if (op === '%') return { s: `${wrap(l, 7)} Mod ${wrap(r, 8)}`, t: 'num', p: 7, i };
  throw new Untranslatable(`the operator ${op}`);
}

const BOXED = /^(java\.lang\.)?(Integer|Long|Short|Byte|Double|Float|Boolean|String|Character)$/;
function emId(name) {
  throw new Untranslatable(`the name "${name}"`);
}
function dotted(n) { // a.b.c → "a.b.c" (class names), or null
  if (n.k === 'id') return n.name;
  if (n.k === 'member') { const o = dotted(n.obj); return o ? `${o}.${n.name}` : null; }
  return null;
}
function emMember(n, env, d) {
  const path = dotted(n);
  if (path) {
    const short = path.replace(/^java\.(lang|math|util)\./, '');
    if (short === 'Boolean.TRUE') return A('True', 'bool');
    if (short === 'Boolean.FALSE') return A('False', 'bool');
    if (short === 'Math.PI') return A('Math.PI', 'num');
    if (short === 'BigDecimal.ZERO' || short === 'BigInteger.ZERO') return A('0', 'num');
    if (short === 'BigDecimal.ONE' || short === 'BigInteger.ONE') return A('1', 'num');
    if (/^(Integer|Long|Double|Float)\.(MAX_VALUE|MIN_VALUE)$/.test(short)) throw new Untranslatable(short);
  }
  if (n.name === 'length' && n.obj) throw new Untranslatable('an array length');
  throw new Untranslatable(`the field ${path || `.${n.name}`}`);
}
function emNew(n, env, d) {
  const name = n.name.replace(/^java\.(lang|math|util|sql)\./, '');
  const args = n.args.map(a => em(a, env, d + 1));
  if ((name === 'Date' || name === 'Timestamp') && !args.length) return A('Now', 'date');
  if (/^(Integer|Long|Short|Byte)$/.test(name) && args.length === 1) return { ...fn('CInt', args, 'num'), i: true };
  if (/^(Double|Float|BigDecimal|BigInteger)$/.test(name) && args.length === 1) return fn('CDbl', args, 'num');
  if (name === 'Boolean' && args.length === 1) return fn('CBool', args, 'bool');
  if (name === 'String' && args.length <= 1) return args.length ? fn('CStr', args, 'str') : A('""', 'str');
  throw new Untranslatable(`new ${n.name}(…)`);
}

function emCall(n, env, d) {
  const E = (x) => em(x, env, d + 1);
  const args = () => n.args.map(E);
  if (!n.obj) {
    if (n.name === 'msg') {
      if (n.args[0]?.k !== 'str') throw new Untranslatable('msg() with a pattern that is not a literal');
      return message(n.args[0].v, n.args.slice(1).map(E));
    }
    if (n.name === 'str' && n.args[0]?.k === 'str' && env.resource) return env.resource(n.args[0].v);
    const f = JR_FUNCS[n.name];
    if (f) return f(args());
    if (n.name === 'DATEFORMAT' || n.name === 'TEXT') {
      const [v] = args();
      if (n.args[1]?.k !== 'str') throw new Untranslatable(`${n.name}() with a pattern that is not a literal`);
      if (n.name === 'TEXT') return A(javaNumFormat(v, n.args[1].v), 'str');
      return A(`Format(${v.s}, ${vbStr(javaPattern(n.args[1].v, 'date') || '')})`, 'str');
    }
    throw new Untranslatable(`the function ${n.name}()`);
  }
  const path = dotted(n.obj);
  if (path && !(n.obj.k === 'id' && /^[a-z]/.test(n.obj.name) && !/^java$/.test(n.obj.name))) {
    const cls = path.replace(/^java\.(lang|math|util|sql)\./, '');
    const a = args();
    const m = n.name;
    if (cls === 'String' && m === 'valueOf') return fn('CStr', a, 'str');
    if (cls === 'String' && m === 'format') throw new Untranslatable('String.format(…)');
    if (/^(Integer|Long|Short|Byte)$/.test(cls) && /^(valueOf|parse\w+)$/.test(m) && a.length === 1) return { ...fn('CInt', a, 'num'), i: true };
    if (/^(Double|Float|BigDecimal)$/.test(cls) && /^(valueOf|parse\w+)$/.test(m) && a.length === 1) return fn('CDbl', a, 'num');
    if (cls === 'Boolean' && /^(valueOf|parseBoolean)$/.test(m)) return fn('CBool', a, 'bool');
    if (cls === 'Math' || cls === 'StrictMath') {
      const M = { abs: 'Math.Abs', floor: 'Math.Floor', ceil: 'Math.Ceiling', sqrt: 'Math.Sqrt', pow: 'Math.Pow', log: 'Math.Log', log10: 'Math.Log10', exp: 'Math.Exp', signum: 'Math.Sign', max: 'Math.Max', min: 'Math.Min' };
      // Java Math.round is floor(x + 0.5): halves go up, toward +infinity (Math.round(-2.5) is -2)
      if (m === 'round') return { ...A(`Math.Floor(${wrap(a[0], 6)} + 0.5)`, 'num'), i: true };
      if (M[m]) return fn(M[m], a, 'num');
    }
    if (cls === 'System' && m === 'currentTimeMillis') throw new Untranslatable('System.currentTimeMillis()');
    if (BOXED.test(cls) || /^(Math|String|System|Calendar|Arrays|Objects)$/.test(cls)) throw new Untranslatable(`${cls}.${m}()`);
  }
  const o = E(n.obj);
  const a = args();
  switch (n.name) {
    case 'toUpperCase': return fn('UCase', [o], 'str');
    case 'toLowerCase': return fn('LCase', [o], 'str');
    case 'trim': case 'strip': return fn('Trim', [o], 'str');
    case 'length': return fn('Len', [o], 'num');
    case 'isEmpty': return { s: `Len(${o.s}) = 0`, t: 'bool', p: 4 };
    case 'toString': return fn('CStr', [o], 'str');
    case 'concat': return { s: `${wrap(o, 5)} & ${wrap(a[0], 6)}`, t: 'str', p: 5 };
    case 'substring':
      if (a.length === 1) return A(`${wrap(o, 9)}.Substring(${a[0].s})`, 'str');
      return A(`${wrap(o, 9)}.Substring(${a[0].s}, ${wrap(a[1], 6)} - ${wrap(a[0], 7)})`, 'str');
    case 'charAt': return A(`${wrap(o, 9)}.Substring(${a[0].s}, 1)`, 'str');
    case 'indexOf': return A(`${wrap(o, 9)}.IndexOf(${a[0].s})`, 'num');
    case 'startsWith': return A(`${wrap(o, 9)}.StartsWith(${a[0].s})`, 'bool');
    case 'endsWith': return A(`${wrap(o, 9)}.EndsWith(${a[0].s})`, 'bool');
    case 'contains': return A(`${wrap(o, 9)}.Contains(${a[0].s})`, 'bool');
    case 'replace': return fn('Replace', [o, a[0], a[1]], 'str');
    case 'equals': return { s: `${wrap(o, 5)} = ${wrap(a[0], 5)}`, t: 'bool', p: 4 };
    case 'equalsIgnoreCase': return { s: `UCase(${o.s}) = UCase(${a[0].s})`, t: 'bool', p: 4 };
    case 'compareTo': throw new Untranslatable('.compareTo()');
    case 'intValue': case 'longValue': case 'shortValue': case 'byteValue': return { ...fn('Fix', [o], 'num'), i: true }; // truncates, as Java
    case 'doubleValue': case 'floatValue': return fn('CDbl', [o], 'num');
    case 'booleanValue': return o;
    case 'add': if (o.t === 'num') return { s: `${wrap(o, 6)} + ${wrap(a[0], 7)}`, t: 'num', p: 6 }; break;
    case 'subtract': if (o.t === 'num') return { s: `${wrap(o, 6)} - ${wrap(a[0], 7)}`, t: 'num', p: 6 }; break;
    case 'multiply': if (o.t === 'num') return { s: `${wrap(o, 7)} * ${wrap(a[0], 8)}`, t: 'num', p: 7 }; break;
    case 'divide': if (o.t === 'num') return { s: `${wrap(o, 7)} / ${wrap(a[0], 8)}`, t: 'num', p: 7 }; break;
    case 'format': // new SimpleDateFormat("…").format(d) is a 'new' and fails above; NumberFormat.getInstance().format(x) too
      break;
  }
  throw new Untranslatable(`the method .${n.name}()`);
}
