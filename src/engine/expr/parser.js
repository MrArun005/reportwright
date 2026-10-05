// @ts-check
/**
 * Expression language: lexer + Pratt parser.
 * No eval, no new Function. The AST is plain data.
 */

export class ExprError extends Error {
  /** @param {string} msg @param {number} [pos] @param {string} [src] */
  constructor(msg, pos, src) {
    super(pos != null ? `${msg} (at ${pos + 1})` : msg);
    this.pos = pos;
    this.src = src;
  }
}

/** The longest string a function or a format may build, checked before it is built (capText). */
export const MAX_TEXT = 1_000_000;
/** @param {string} fname @param {number} n the length the result would have */
export const capText = (fname, n) => { if (n > MAX_TEXT) throw new ExprError(`${fname}: the result would be longer than 1,000,000 characters`); };
/** Format patterns: at most 1,000 characters; widths, precisions and digit counts at most 340 (a double has 309
 *  integer digits and 340 decimals at most, as Java and .NET cap them). */
export const MAX_PATTERN = 1000, MAX_DIGITS = 340;
export const capPattern = (fname, pat) => { if (pat.length > MAX_PATTERN) throw new ExprError(`${fname}: a format longer than ${MAX_PATTERN} characters`); };
export const capDigits = (fname, n) => { if (n > MAX_DIGITS) throw new ExprError(`${fname}: ${n} digits is more than ${MAX_DIGITS}`); };

const OPS = ['<>', '<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '&', '=', '<', '>', '(', ')', ',', '.', '!', '[', ']', '?', ':', '^', '\\'];
// VB operators written as words: Mod, Is, IsNot, Xor, AndAlso, OrElse
const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'null', 'nothing', 'mod', 'is', 'isnot', 'xor', 'andalso', 'orelse']);

/** @param {string} src */
export function lex(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (/[eE]/.test(src[j] || '') && /[-+0-9]/.test(src[j + 1] || '')) { j += 2; while (/[0-9]/.test(src[j] || '')) j++; }
      const n = Number(src.slice(i, j));
      if (Number.isNaN(n)) throw new ExprError(`Bad number "${src.slice(i, j)}"`, i, src);
      toks.push({ t: 'num', v: n, p: i });
      i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      if (j >= src.length) throw new ExprError('A string has no closing quote', i, src);
      toks.push({ t: 'str', v: s, p: i });
      i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const w = src.slice(i, j);
      toks.push(KEYWORDS.has(w.toLowerCase()) ? { t: 'kw', v: w.toLowerCase(), p: i } : { t: 'id', v: w, p: i });
      i = j; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { toks.push({ t: 'op', v: op, p: i }); i += op.length; continue; }
    throw new ExprError(`Unexpected character "${c}"`, i, src);
  }
  toks.push({ t: 'eof', v: '', p: src.length });
  return toks;
}

const BIN = {
  'or': 1, '||': 1, 'orelse': 1, 'xor': 1,
  'and': 2, '&&': 2, 'andalso': 2,
  '=': 4, '==': 4, '<>': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, 'is': 4, 'isnot': 4,
  '&': 5,
  '+': 6, '-': 6,
  // VB: Mod below \ below * and /, all above + -; ^ above unary minus (-2 ^ 2 is -4), left to right (2 ^ 3 ^ 2 is 64)
  'mod': 6.4, '\\': 6.7, '*': 7, '/': 7, '%': 7,
  '^': 8.5,
};

/** @param {string} src */
export function parse(src) {
  const toks = lex(src);
  let k = 0;
  const peek = () => toks[k];
  const next = () => toks[k++];
  const expect = (v) => {
    const t = next();
    if (t.v !== v) throw new ExprError(`Expected "${v}" but found "${t.v || 'end'}"`, t.p, src);
    return t;
  };
  const lbp = (t) => {
    if (t.t === 'op' && (t.v === '.' || t.v === '[')) return 9;
    if (t.t === 'op' && t.v === '(') return 9; // a call's result indexed: Split(s, ",")(1)
    if (t.t === 'op' && t.v === '?') return 0.5;
    if ((t.t === 'op' || t.t === 'kw') && BIN[t.v] != null) return BIN[t.v];
    return 0;
  };

  /** Arguments after "(", up to and including ")". */
  function callArgs() {
    const args = [];
    if (peek().v !== ')') {
      do { args.push(expr(0)); } while (peek().v === ',' && next());
    }
    expect(')');
    return args;
  }

  function nud() {
    const t = next();
    if (t.t === 'num' || t.t === 'str') return { type: 'lit', v: t.v };
    if (t.t === 'kw') {
      if (t.v === 'true') return { type: 'lit', v: true };
      if (t.v === 'false') return { type: 'lit', v: false };
      if (t.v === 'null' || t.v === 'nothing') return { type: 'lit', v: null };
      if (t.v === 'not') return { type: 'unary', op: 'not', arg: expr(3) };
    }
    if (t.t === 'id') {
      if (peek().v === '(') {
        next();
        return { type: 'call', name: t.v, args: callArgs(), p: t.p };
      }
      return { type: 'id', name: t.v, p: t.p };
    }
    if (t.t === 'op') {
      if (t.v === '(') { const e = expr(0); expect(')'); return e; }
      if (t.v === '-') return { type: 'unary', op: 'neg', arg: expr(8) };
      if (t.v === '+') return expr(8);
      if (t.v === '!') return { type: 'unary', op: 'not', arg: expr(8) };
    }
    throw new ExprError(t.t === 'eof' ? 'The expression ends too early' : `Unexpected "${t.v}"`, t.p, src);
  }

  function led(left) {
    const t = next();
    if (t.v === '.') {
      const id = next();
      if (id.t !== 'id' && id.t !== 'kw') throw new ExprError('Expected a name after "."', id.p, src);
      if (peek().v === '(') { // Code.Name(args): a report function
        next();
        return { type: 'call', name: id.v, args: callArgs(), p: id.p, obj: left };
      }
      return { type: 'member', obj: left, prop: id.v };
    }
    if (t.v === '[') {
      const e = expr(0); expect(']');
      return { type: 'index', obj: left, key: e };
    }
    if (t.v === '(') { // VB: an array element, Split(s, ",")(1) (0-based)
      const args = callArgs();
      if (args.length !== 1) throw new ExprError('An index needs one value: Split(s, ",")(1)', t.p, src);
      return { type: 'index', obj: left, key: args[0] };
    }
    if (t.v === '?') {
      const a = expr(0); expect(':'); const b = expr(0); // right-assoc: a ? b : c ? d : e
      return { type: 'cond', test: left, a, b };
    }
    return { type: 'bin', op: t.v, a: left, b: expr(BIN[t.v]) };
  }

  function expr(rbp) {
    let left = nud();
    while (rbp < lbp(peek())) left = led(left);
    return left;
  }

  const ast = expr(0);
  if (peek().t !== 'eof') throw new ExprError(`Unexpected "${peek().v}"`, peek().p, src);
  return ast;
}
