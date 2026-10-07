// @ts-check
/**
 * ActiveReports importer: an ActiveReportsJS report (.rdlx-json) becomes a ReportWright report definition.
 *
 * Pure JavaScript, no Node APIs and no DOM, so it runs on the server, in a worker or in the browser.
 * It never throws. Whatever it cannot map becomes a warning that names the item and what was lost,
 * and `stats` counts report items (mapped, approximated, dropped) so the conversion rate is stated honestly:
 *   mapped        the item is in the report and behaves the same
 *   approximated  the item is in the report, but something about it is lost or changed (a warning says what)
 *   dropped       the item is not in the report (a warning says why)
 */
import { PAGE_SIZES } from '../engine/units.js';
import { FONT_FAMILIES } from '../engine/text/fonts.js';
import { checkValue } from '../engine/expr/evaluate.js';
import { currencyOf } from '../engine/expr/format.js';
import { jsonPath } from '../engine/data/index.js';

/* ================================================================ units, colours, fonts, formats */

const UNIT = { in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pt: 1, pc: 12, px: 0.75 };
const r2 = (n) => Math.round(n * 100) / 100;

/** "1in", "2.5cm", "12mm", "10pt", "1pc", "96px" (or a number of points) → points. */
export function toPt(v, fallback = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? r2(v) : fallback;
  const m = /^(-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?)\s*(in|cm|mm|pt|pc|px)?$/i.exec(String(v ?? '').trim()); // linear: the input may be hostile
  return m ? r2(Number(m[1]) * UNIT[/** @type {keyof UNIT} */ ((m[2] || 'pt').toLowerCase())]) : fallback;
}

// CSS colour names: ActiveReports uses them freely, ReportWright's exporters know only a few.
const NAMED = Object.fromEntries(('aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,' +
  'blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,' +
  'cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,' +
  'darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,' +
  'darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,' +
  'deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,' +
  'gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,' +
  'indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,' +
  'lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,' +
  'lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,' +
  'linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,' +
  'mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,' +
  'moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,' +
  'palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,' +
  'powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,' +
  'seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,' +
  'springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,' +
  'whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32').split(',').map(p => p.split(':')));

/** A CSS colour as "#rrggbb". null: transparent. undefined: not a colour. */
export function hexColor(c) {
  if (c == null || c === '') return undefined;
  const s = String(c).trim().toLowerCase();
  if (s === 'transparent' || s === 'none') return null;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) return s;
  if (NAMED[s]) return '#' + NAMED[s];
  if (/^rgba?\([\d.,\s%/]+\)$/.test(s)) return s;
  return undefined;
}

const MONO = /mono|courier|consol|menlo|monaco|lucida console|typewriter/i;
const weightOf = (w) => {
  const s = String(w).trim().toLowerCase();
  const n = { thin: 100, extralight: 200, ultralight: 200, light: 300, lighter: 300, normal: 400, regular: 400, medium: 500,
    semibold: 600, demibold: 600, bold: 700, bolder: 700, extrabold: 800, ultrabold: 800, heavy: 900, black: 900 }[s] ?? Number(s);
  if (!Number.isFinite(n)) return undefined;
  return n >= 650 ? 'bold' : n >= 550 ? '600' : 'normal';
};
const ALIGN = { left: 'left', center: 'center', centre: 'center', right: 'right', general: 'auto', justify: 'justify' };
const VALIGN = { top: 'top', middle: 'middle', center: 'middle', bottom: 'bottom' };

/** .NET format string → one ReportWright reads (it knows C N F P D E, custom number patterns and date patterns). */
function formatOf(f) {
  if (f == null || f === '') return undefined;
  const s = String(f);
  if (/^[gG]\d+$/.test(s) || /^[xXrR]\d*$/.test(s)) return undefined; // general / hex / round-trip: plain text is the same
  if (s === 'G') return 'g';
  return { T: 'HH:mm:ss', t: 'HH:mm', M: 'MMMM dd', m: 'MMMM dd', Y: 'MMMM yyyy', y: 'MMMM yyyy' }[s] || s;
}

/** String literals in expressions that set a style become values ReportWright reads ("Red" → "#ff0000"). */
const LITS = {
  color: (s) => { const h = hexColor(s); return h === null ? 'transparent' : h ?? s; },
  weight: (s) => weightOf(s) ?? s,
  align: (s) => ALIGN[String(s).toLowerCase()] ?? s,
  fontStyle: (s) => (/italic|oblique/i.test(s) ? 'italic' : 'normal'),
  format: (s) => formatOf(s) ?? '',
};

/** Field and parameter names become identifiers, so they read as Fields.x everywhere. */
export const safeName = (n) => { let s = String(n ?? '').replace(/[^A-Za-z0-9_]/g, '_'); if (/^\d/.test(s)) s = '_' + s; return s || '_'; };

/** "Reports/Sub Report.rdlx-json" → "sub-report": the id the importer route gives that report (same rule as newId). */
export function reportId(name) {
  const base = String(name ?? '').split(/[\\/]/).pop()
    .replace(/\.(rdlx-json|rdlx-master|rdlx|rdlc?|json|jrxml|jasper|rptdesign)$/i, '');
  return (base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report').slice(0, 48);
}

/* ================================================================ expressions (VB.NET subset) → ReportWright */

class Untranslatable extends Error {
  /** @param {string} what @param {boolean} [syntax] */
  constructor(what, syntax = false) { super(what); this.syntax = syntax; }
}
/** @returns {never} */
const no = (what) => { throw new Untranslatable(what); };
/** @returns {never} */
const bad = (what) => { throw new Untranslatable(what, true); };

const CONT = /[ \t]*\r?\n/y, NUM = /((?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?)[DFRdfr@]?(?![A-Za-z0-9_])/y, NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
/** A sticky regex matched at i (no copy of the rest of the source, no backtracking over it). */
const at = (re, src, i) => { re.lastIndex = i; return re.exec(src); };
const MAX_RESULT = 100_000;
const VB_OPS = ['<>', '<=', '>=', ':=', '&', '+', '-', '*', '/', '\\', '^', '=', '<', '>', '(', ')', ',', '.', '!'];
function vbLex(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '_' && at(CONT, src, i + 1)) { i++; continue; } // line continuation
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = at(NUM, src, i);
      if (!m) bad(`the number "${src.slice(i, i + 8)}"`);
      toks.push({ t: 'num', v: Number(m[1]) }); i += m[0].length; continue;
    }
    if (c === '$' && src[i + 1] === '"') { const r = interpolated(src, i + 2); toks.push({ t: 'istr', parts: r.parts }); i = r.end; continue; }
    if (c === '"' || c === '“' || c === '”') { // VB accepts curly quotes too
      let j = i + 1, s = '';
      for (;;) {
        if (j >= src.length) bad('a string without its closing quote');
        const d = src[j];
        if (d === '"' || d === '“' || d === '”') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += d; j++;
      }
      toks.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (c === '#') {
      const j = src.indexOf('#', i + 1);
      if (j < 0) bad('a date without its closing #');
      toks.push({ t: 'date', v: src.slice(i + 1, j).trim() }); i = j + 1; continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i + 1);
      if (j < 0) bad('a name without its closing ]');
      toks.push({ t: 'id', v: src.slice(i + 1, j) }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) { const w = at(NAME, src, i)[0]; toks.push({ t: 'id', v: w }); i += w.length; continue; }
    const op = VB_OPS.find(o => src.startsWith(o, i));
    if (!op) bad(`the character "${c}"`);
    toks.push({ t: 'op', v: op }); i += op.length;
  }
  toks.push({ t: 'eof', v: '' });
  return toks;
}

/** $"text {expr} {expr:format}" → text parts and expression sources, and the index after the closing quote. */
function interpolated(src, i) {
  const parts = [];
  let text = '';
  for (;;) {
    if (i >= src.length) bad('an interpolated string without its closing quote');
    const c = src[i];
    if (c === '"') { if (src[i + 1] === '"') { text += '"'; i += 2; continue; } break; }
    if (c === '{' && src[i + 1] === '{') { text += '{'; i += 2; continue; }
    if (c === '}' && src[i + 1] === '}') { text += '}'; i += 2; continue; }
    if (c === '{') {
      let j = i + 1, depth = 0, quote = false, colon = -1;
      for (; j < src.length; j++) {
        const d = src[j];
        if (quote) { if (d === '"') quote = false; continue; }
        if (d === '"') quote = true;
        else if (d === '(') depth++;
        else if (d === ')') depth--;
        else if (d === ':' && depth === 0 && colon < 0) colon = j;
        else if (d === '}' && depth === 0) break;
      }
      if (j >= src.length) bad('an interpolated string with an unclosed {');
      if (text) { parts.push({ text }); text = ''; }
      parts.push({ expr: src.slice(i + 1, colon < 0 ? j : colon), fmt: colon < 0 ? null : src.slice(colon + 1, j) });
      i = j + 1; continue;
    }
    text += c; i++;
  }
  if (text || !parts.length) parts.push({ text });
  return { parts, end: i + 1 };
}

// VB precedence, low to high. Not sits at 5, unary minus at 13, member access and calls at 20.
const BIN = { xor: 2, or: 3, orelse: 3, and: 4, andalso: 4, '=': 6, '<>': 6, '<': 6, '>': 6, '<=': 6, '>=': 6, is: 6, isnot: 6, like: 6,
  '&': 8, '+': 9, '-': 9, mod: 10, '\\': 11, '*': 12, '/': 12, '^': 14 };

function vbParse(src) {
  const toks = vbLex(src);
  let k = 0;
  const peek = () => toks[k], next = () => toks[k++];
  const binOp = (t) => (t.t === 'op' ? (BIN[t.v] != null ? t.v : null) : t.t === 'id' && BIN[t.v.toLowerCase()] != null ? t.v.toLowerCase() : null);
  const lbp = (t) => { if (t.t === 'op' && (t.v === '.' || t.v === '!' || t.v === '(')) return 20; const o = binOp(t); return o ? BIN[o] : 0; };
  function nud() {
    const t = next();
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'date') return { k: 'date', v: t.v };
    if (t.t === 'istr') {
      const nodes = t.parts.map(p => {
        if ('text' in p) return { k: 'str', v: p.text };
        const e = vbParse(p.expr);
        return p.fmt ? { k: 'call', fn: { k: 'id', name: 'Format' }, args: [e, { k: 'str', v: p.fmt }] } : e;
      });
      return nodes.reduce((a, b) => ({ k: 'bin', op: '&', a, b }));
    }
    if (t.t === 'id') {
      const w = t.v.toLowerCase();
      if (w === 'not') return { k: 'not', arg: expr(5) };
      if (w === 'true' || w === 'false') return { k: 'bool', v: w === 'true' };
      if (w === 'nothing' || w === 'null' || w === 'dbnull') return { k: 'null' };
      return { k: 'id', name: t.v };
    }
    if (t.v === '(') { const e = expr(0); if (next().v !== ')') bad('a "(" without its ")"'); return e; }
    if (t.v === '-') return { k: 'neg', arg: expr(13) };
    if (t.v === '+') return expr(13);
    return bad(t.t === 'eof' ? 'an expression that ends too early' : `"${t.v}" in the wrong place`);
  }
  function led(left) {
    const t = next();
    if (t.v === '.' || t.v === '!') {
      const id = next();
      if (id.t !== 'id') bad(`a name after "${t.v}"`);
      return { k: t.v === '.' ? 'dot' : 'bang', obj: left, name: id.v };
    }
    if (t.v === '(') {
      const args = [];
      if (peek().v !== ')') do { args.push(expr(0)); } while (peek().v === ',' && next());
      if (next().v !== ')') bad('a function call without its ")"');
      return { k: 'call', fn: left, args };
    }
    const op = binOp(t);
    return { k: 'bin', op, a: left, b: expr(BIN[op]) };
  }
  function expr(rbp) { let left = nud(); while (rbp < lbp(peek())) left = led(left); return left; }
  const ast = expr(0);
  if (peek().t !== 'eof') bad(`"${peek().v}" in the wrong place`);
  return ast;
}

/* ---- emit ReportWright source. Precedence there: or 1, and 2, not 3, comparison 4, & 5, + - 6, * / % 7, unary minus 8. */
const q = (s) => '"' + String(s).replace(/[\\"]/g, '\\$&') + '"';
const wrap = (e, min) => (e.p < min ? `(${e.s})` : e.s);
const atom = (s) => ({ s, p: 10 });
const fn = (name, args) => atom(`${name}(${args.map(a => a.s).join(', ')})`);
const ROOT = (n) => (n.k === 'id' ? n.name.toLowerCase() : null);
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const GLOBALS = { pagenumber: 'PageNumber', totalpages: 'TotalPages', executiontime: 'ExecutionTime', reportname: 'ReportName',
  pagenumberinsection: 'PageNumber', totalpagesinsection: 'TotalPages', overallpagenumber: 'OverallPageNumber', overalltotalpages: 'OverallTotalPages' }; // overall: across section restarts (N19)
const INTERVAL = { year: 'yyyy', quarter: 'q', month: 'm', weekofyear: 'ww', day: 'd', dayofyear: 'd', hour: 'h', minute: 'n', second: 's', weekday: 'w' };
const DATEFORMAT = { generaldate: 0, longdate: 1, shortdate: 2, longtime: 3, shorttime: 4 };
const AGG = { sum: 'Sum', avg: 'Avg', average: 'Avg', count: 'Count', countdistinct: 'CountDistinct', min: 'Min', max: 'Max', first: 'First', last: 'Last',
  stdev: 'StDev', stdevp: 'StDevP', var: 'Var', varp: 'VarP' };
const SAME = { format: 'Format', left: 'Left', right: 'Right', mid: 'Mid', len: 'Len', trim: 'Trim', replace: 'Replace', cstr: 'CStr', cdbl: 'CDbl',
  cint: 'CInt', cbool: 'CBool', cdate: 'CDate', abs: 'Abs', floor: 'Floor', ceiling: 'Ceiling', int: 'Int', sqrt: 'Sqrt', now: 'Now',
  today: 'Today', dateadd: 'DateAdd', datediff: 'DateDiff', dateserial: 'DateSerial', year: 'Year', month: 'Month', day: 'Day', monthname: 'MonthName',
  ucase: 'Upper', lcase: 'Lower', upper: 'Upper', lower: 'Lower', val: 'Val', join: 'Join', lookup: 'Lookup', inlist: 'InList', coalesce: 'Coalesce',
  isnothing: 'IsNull', isnull: 'IsNull', isdbnull: 'IsNull', cdec: 'CDbl', csng: 'CDbl', clng: 'ToInt64', cshort: 'ToInt16', cbyte: 'CInt', fix: 'Fix',
  isempty: 'IsNull', space: 'Space', weekday: 'Weekday', weekdayname: 'WeekdayName', hour: 'Hour', minute: 'Minute', second: 'Second', sign: 'Sign',
  chr: 'Chr', chrw: 'Chr', asc: 'Asc', ascw: 'Asc', strreverse: 'StrReverse', isnumeric: 'IsNumeric', isdate: 'IsDate', datevalue: 'DateValue',
  timeserial: 'TimeSerial', lookupset: 'LookupSet',
  // the JasperReports and BIRT front ends' Java and JavaScript string conversions (expr/javafmt.js)
  hex: 'Hex', oct: 'Oct', lset: 'LSet', rset: 'RSet', strdup: 'StrDup', split: 'Split',
  javastr: 'JavaStr', jsstr: 'JsStr', javaformat: 'JavaFormat', jaspervalue: 'JasperValue', aggregateif: 'AggregateIf' };
const CONVERT = { tostring: 'CStr', todecimal: 'CDbl', todouble: 'CDbl', tosingle: 'CDbl', toint16: 'ToInt16', toint32: 'ToInt32', toint64: 'ToInt64',
  todatetime: 'CDate', toboolean: 'CBool' };
const MATH = { abs: 'Abs', floor: 'Floor', ceiling: 'Ceiling', sqrt: 'Sqrt', pow: 'Pow', truncate: 'Fix', sign: 'Sign', log: 'Log', log10: 'Log10', exp: 'Exp' };

/**
 * @typedef {{ notes: string[], fields?: string, region?: string, scopes?: Map<string, string|null>, runScopes?: Map<string, string>, lit?: (s: string) => string }} EmitOpts
 * @param {any} n @param {EmitOpts} o @param {boolean} [res] a result position: style literals ("Red") are mapped here
 * @returns {{s: string, p: number}}
 */
function em(n, o, res = false) {
  const r = emit(n, o, res);
  // a translation can repeat its operands (Choose, Math.Max, Xor, StartsWith): nested, that doubles per level
  if (r.s.length > MAX_RESULT) no(`an expression whose translation is longer than ${MAX_RESULT} characters`);
  return r;
}
function emit(n, o, res) {
  switch (n.k) {
    case 'num': return atom(String(n.v));
    case 'str': return atom(q(res && o.lit ? o.lit(n.v) : n.v));
    case 'bool': return atom(String(n.v));
    case 'null': return atom('null');
    case 'date': return atom(`CDate(${q(vbDate(n.v))})`);
    case 'neg': return { s: '-' + wrap(em(n.arg, o), 8), p: 8 };
    case 'not': return { s: 'not ' + wrap(em(n.arg, o), 4), p: 3 };
    case 'bin': return emBin(n, o);
    case 'id': return emId(n);
    case 'dot': case 'bang': return emMember(n, o);
    case 'call': return emCall(n, o, res);
  }
  return no('this expression');
}

/** #1/31/2026# or #2026-01-31# → "2026-01-31" */
function vbDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(s);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}${m[4].trim() ? ' ' + m[4].trim() : ''}` : s;
}

function emBin(n, o) {
  const A = () => em(n.a, o), B = () => em(n.b, o);
  switch (n.op) {
    case '&': return { s: `${wrap(A(), 5)} & ${wrap(B(), 6)}`, p: 5 };
    case '+': case '-': return { s: `${wrap(A(), 6)} ${n.op} ${wrap(B(), 7)}`, p: 6 };
    case '*': case '/': return { s: `${wrap(A(), 7)} ${n.op} ${wrap(B(), 8)}`, p: 7 };
    case 'mod': return { s: `${wrap(A(), 7)} % ${wrap(B(), 8)}`, p: 7 };
    // VB \ rounds both sides to Long (half to even), then truncates the quotient
    case '\\': return fn('Fix', [atom(`ToInt64(${A().s}) / ToInt64(${B().s})`)]);
    case '^': return fn('Pow', [A(), B()]);
    case '=': case '<>': case '<': case '>': case '<=': case '>=': return { s: `${wrap(A(), 5)} ${n.op} ${wrap(B(), 5)}`, p: 4 };
    case 'is': case 'isnot': {
      const other = n.b.k === 'null' ? n.a : n.a.k === 'null' ? n.b : null;
      if (!other) return { s: `${wrap(A(), 5)} ${n.op === 'is' ? '=' : '<>'} ${wrap(B(), 5)}`, p: 4 };
      const s = `IsNull(${em(other, o).s})`;
      return n.op === 'is' ? atom(s) : { s: `not ${s}`, p: 3 };
    }
    case 'like': {
      if (n.b.k !== 'str') return no('Like with a computed pattern');
      const pat = n.b.v.replace(/%/g, '*');
      const core = pat.replace(/^\*|\*$/g, '');
      if (/[*?#[\]]/.test(core)) return no(`the pattern Like "${n.b.v}"`);
      const a = A().s, lit = q(core);
      if (pat.startsWith('*') && pat.endsWith('*') && pat.length > 1) return fn('Contains', [atom(a), atom(lit)]);
      if (pat.endsWith('*')) return { s: `Left(${a}, ${core.length}) = ${lit}`, p: 4 };
      if (pat.startsWith('*')) return { s: `Right(${a}, ${core.length}) = ${lit}`, p: 4 };
      return { s: `${a} = ${lit}`, p: 4 };
    }
    case 'and': case 'andalso': return { s: `${wrap(A(), 2)} and ${wrap(B(), 3)}`, p: 2 };
    case 'or': case 'orelse': return { s: `${wrap(A(), 1)} or ${wrap(B(), 2)}`, p: 1 };
    case 'xor': { const a = A().s, b = B().s; return atom(`IIF(${a}, not (${b}), ${b})`); }
  }
  return no(`the operator "${n.op}"`);
}

const VB_DAYS = ['vbusesystemdayofweek', 'vbsunday', 'vbmonday', 'vbtuesday', 'vbwednesday', 'vbthursday', 'vbfriday', 'vbsaturday'];
function emId(n) {
  const w = n.name.toLowerCase();
  if (w === 'vbcrlf' || w === 'vbnewline' || w === 'vbcr' || w === 'vblf') return atom(q('\n'));
  if (w === 'vbtab') return atom(q('\t'));
  if (w === 'now') return atom('Now()');
  if (w === 'today') return atom('Today()');
  const day = VB_DAYS.indexOf(w);
  if (day >= 0) return atom(String(day)); // vbUseSystemDayOfWeek (0: Sunday here), vbSunday (1) … vbSaturday (7)
  return no(`the name "${n.name}"`);
}

function emGlobal(name) {
  const g = GLOBALS[name.toLowerCase()];
  return g ? atom(`Globals.${g}`) : no(`Globals!${name}`);
}

function emMember(n, o) {
  if (n.k === 'bang') {
    const root = ROOT(n.obj);
    if (root === 'fields') return atom(`${o.fields || 'Fields'}.${safeName(n.name)}`);
    if (root === 'parameters') return atom(`Parameters.${safeName(n.name)}`);
    if (root === 'partproperties') return atom(`PartProperties.${safeName(n.name)}`);
    if (root === 'globals') return emGlobal(n.name);
    if (root === 'reportitems') return no(`ReportItems!${n.name} (the value of another item)`);
    if (root === 'user') return no(`User!${n.name} (who runs the report)`);
    return no(`"!${n.name}"`);
  }
  const prop = n.name.toLowerCase(), obj = n.obj;
  if (obj.k === 'bang') {
    const root = ROOT(obj.obj);
    if (root === 'fields') {
      if (prop === 'value') return em(obj, o);
      if (prop === 'ismissing') return atom(`IsNull(${em(obj, o).s})`);
      return no(`Fields!${obj.name}.${n.name}`);
    }
    if (root === 'parameters') {
      if (prop === 'value') return em(obj, o);
      if (prop === 'label') { o.notes.push(`Parameters!${obj.name}.Label gives the value, not the label, in ReportWright`); return em(obj, o); }
      return no(`Parameters!${obj.name}.${n.name}`);
    }
    if (prop === 'value') return em(obj, o);
  }
  const root = ROOT(obj);
  if (root === 'fields') return atom(`${o.fields || 'Fields'}.${safeName(n.name)}`);
  if (root === 'parameters') return atom(`Parameters.${safeName(n.name)}`);
  if (root === 'globals') return emGlobal(n.name);
  if (root === 'dateinterval') return INTERVAL[prop] ? atom(q(INTERVAL[prop])) : no(`DateInterval.${n.name}`);
  if (root === 'firstdayofweek') { const d = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(prop); return d >= 0 ? atom(String(d + 1)) : no(`FirstDayOfWeek.${n.name}`); }
  if (root === 'dateformat') return DATEFORMAT[prop] != null ? atom(String(DATEFORMAT[prop])) : no(`DateFormat.${n.name}`);
  if (root === 'datetime' && (prop === 'now' || prop === 'today')) return atom(prop === 'now' ? 'Now()' : 'Today()');
  if (root === 'environment' && prop === 'newline') return atom(q('\n'));
  if (root === 'math' && prop === 'pi') return atom(String(Math.PI));
  if (root === 'code') return no(`custom code (Code.${n.name})`);
  switch (prop) {
    case 'value': return em(obj, o);
    case 'length': return fn('Len', [em(obj, o)]);
    case 'year': case 'month': case 'day': return fn(cap(prop), [em(obj, o)]);
    case 'hasvalue': return { s: `not IsNull(${em(obj, o).s})`, p: 3 };
  }
  return no(`".${n.name}"`);
}

/** A literal collection lookup: Fields("x"), Fields.Item("x"), Parameters("x"). */
function byName(root, args, o) {
  if (args.length !== 1 || args[0].k !== 'str') return no(`${cap(root)}(…) with a computed name`);
  return atom(`${root === 'fields' ? o.fields || 'Fields' : 'Parameters'}.${safeName(args[0].v)}`);
}

function emCall(n, o, res) {
  const f = n.fn, args = n.args;
  if (f.k === 'id') return emFunc(f.name, args, o, res);
  // Split(s, ",")(1): an element of an array a call returns
  if (f.k === 'call' && args.length === 1) return atom(`${wrap(em(f, o), 10)}(${em(args[0], o).s})`);
  if (f.k === 'dot') {
    const root = ROOT(f.obj), m = f.name.toLowerCase();
    if ((root === 'fields' || root === 'parameters') && m === 'item') return byName(root, args, o);
    if (root === 'code') return no(`custom code (Code.${f.name})`);
    const sysMath = f.obj.k === 'dot' && ROOT(f.obj.obj) === 'system' && f.obj.name.toLowerCase() === 'math';
    if (root === 'math' || sysMath) {
      if (m === 'round') return emRound(args, o);
      if (m === 'max' || m === 'min') { const a = em(args[0], o), b = em(args[1], o); return atom(`IIF(${a.s} ${m === 'max' ? '>' : '<'} ${b.s}, ${a.s}, ${b.s})`); }
      return MATH[m] ? fn(MATH[m], args.map(a => em(a, o))) : no(`Math.${f.name}`);
    }
    if (root === 'convert') return CONVERT[m] ? fn(CONVERT[m], [em(args[0], o)]) : no(`Convert.${f.name}`);
    if (root === 'strings' || root === 'datetime') return emFunc(f.name, args, o, res);
    if (root === 'string' && m === 'format') { if (!args.length) return no('String.Format without a format'); return atom(`String.Format(${args.map(a => em(a, o).s).join(', ')})`); }
    if (root === 'string') return no(`String.${f.name}`);
    return emMethod(f.obj, m, f.name, args, o);
  }
  return no('this function call');
}

/** Methods on a value: x.ToString("N2"), x.ToUpper(), x.Substring(1, 3)… */
function emMethod(objNode, m, name, args, o) {
  const v = () => em(objNode, o);
  const a = (i) => em(args[i], o);
  switch (m) {
    case 'tostring': return args.length ? fn('Format', [v(), a(0)]) : fn('CStr', [v()]);
    case 'toupper': case 'toupperinvariant': return fn('Upper', [v()]);
    case 'tolower': case 'tolowerinvariant': return fn('Lower', [v()]);
    case 'trim': return fn('Trim', [v()]);
    case 'substring': {
      const start = { s: `${wrap(a(0), 6)} + 1`, p: 6 };
      return fn('Mid', args.length > 1 ? [v(), start, a(1)] : [v(), start]);
    }
    case 'contains': return fn('Contains', [v(), a(0)]);
    case 'padleft': case 'padright': return fn(m === 'padleft' ? 'PadLeft' : 'PadRight', [v(), ...args.map((_, i) => a(i))]);
    case 'split': return fn('Split', [v(), a(0)]);
    case 'startswith': { const x = a(0); return { s: `Left(${v().s}, Len(${x.s})) = ${x.s}`, p: 4 }; }
    case 'endswith': { const x = a(0); return { s: `Right(${v().s}, Len(${x.s})) = ${x.s}`, p: 4 }; }
    case 'replace': return fn('Replace', [v(), a(0), a(1)]);
    case 'indexof': return { s: `InStr(${v().s}, ${a(0).s}) - 1`, p: 6 };
    case 'adddays': return fn('DateAdd', [atom('"d"'), a(0), v()]);
    case 'addmonths': return fn('DateAdd', [atom('"m"'), a(0), v()]);
    case 'addyears': return fn('DateAdd', [atom('"yyyy"'), a(0), v()]);
    case 'addhours': return fn('DateAdd', [atom('"h"'), a(0), v()]);
    case 'addminutes': return fn('DateAdd', [atom('"n"'), a(0), v()]);
  }
  return no(`the method .${name}()`);
}

/** The scope argument of an aggregate: a data set, a data region or a group. */
function scopeArg(node, o, fname) {
  if (!node) return null;
  if (node.k === 'null') return o.region ? atom(q(o.region)) : null;
  if (node.k !== 'str') return no(`${fname} with a computed scope`);
  const s = node.v;
  if (/^(runningvalue|rownumber)$/i.test(fname) && o.runScopes?.has(s)) return atom(q(o.runScopes.get(s)));
  if (!o.scopes) return atom(q(s));
  if (o.scopes.has(s)) { const m = o.scopes.get(s); return m ? atom(q(m)) : null; }
  o.notes.push(`the scope "${s}" is not known here, so ${fname} uses the current scope`);
  return null;
}

/**
 * Round(x[, digits][, MidpointRounding.X]): VB's Round and Math.Round round half to even (ReportWright Round);
 * MidpointRounding.AwayFromZero is ReportWright RoundHalfAway.
 */
function emRound(args, o) {
  const last = args[args.length - 1];
  const mode = last?.k === 'dot' && ROOT(last.obj) === 'midpointrounding' ? last.name.toLowerCase() : null;
  if (mode && mode !== 'awayfromzero' && mode !== 'toeven') return no(`MidpointRounding.${last.name}`);
  const rest = mode ? args.slice(0, -1) : args;
  if (!rest.length || rest.length > 2) return no('Round with those arguments');
  return fn(mode === 'awayfromzero' ? 'RoundHalfAway' : 'Round', rest.map(a => em(a, o)));
}

function emFunc(name, args, o, res) {
  const w = name.toLowerCase();
  const all = () => args.map(a => em(a, o));
  if (AGG[w]) {
    if (!args.length) return no(`${name}() without an expression`);
    const sc = scopeArg(args[1], o, name);
    // Sum(x, "Group", Recursive): a recursive group's node and the nodes below it
    const rec = args.length > 2 && sc && args[2].k === 'id' && args[2].name.toLowerCase() === 'recursive';
    if (args.length > 2 && !rec) o.notes.push(`${name}: the third argument is ignored`);
    return fn(AGG[w], sc ? [em(args[0], o), sc, ...(rec ? [atom('"Recursive"')] : [])] : [em(args[0], o)]);
  }
  switch (w) {
    case 'level': { const sc = args.length ? scopeArg(args[0], o, name) : null; return fn('Level', sc ? [sc] : []); }
    case 'countrows': { const sc = scopeArg(args[0], o, name); return fn('CountRows', sc ? [sc] : []); }
    case 'rownumber': { const sc = scopeArg(args[0], o, name); return fn('RowNumber', sc ? [sc] : []); }
    case 'runningvalue': {
      if (args.length < 2) return no('RunningValue without a function');
      const f = args[1].k === 'id' ? args[1].name : args[1].k === 'str' ? args[1].v : no('RunningValue with a computed function');
      const agg = AGG[f.toLowerCase()] || no(`RunningValue with ${f}`);
      const sc = scopeArg(args[2], o, name);
      return fn('RunningValue', [em(args[0], o), atom(q(agg)), ...(sc ? [sc] : [])]);
    }
    case 'fields': case 'parameters': return byName(w, args, o);
    case 'iif':
      if (args.length !== 3) return no('IIF without 3 arguments');
      return fn('IIF', [em(args[0], o), em(args[1], o, res), em(args[2], o, res)]);
    case 'switch': return fn('Switch', args.map((a, i) => em(a, o, res && i % 2 === 1)));
    case 'choose': {
      if (args.length < 2) return no('Choose without choices');
      const i = em(args[0], o);
      return fn('Switch', args.slice(1).flatMap((a, k) => [{ s: `${wrap(i, 5)} = ${k + 1}`, p: 4 }, em(a, o, res)]));
    }
    case 'formatnumber': case 'formatcurrency': case 'formatpercent': {
      const L = { formatnumber: 'N', formatcurrency: 'C', formatpercent: 'P' }[w];
      const d = args[1] == null ? 2 : args[1].k === 'num' ? (args[1].v < 0 ? 2 : args[1].v) : no(`${name} with computed decimals`);
      return fn('Format', [em(args[0], o), atom(q(L + d))]);
    }
    case 'formatdatetime': {
      const k = args[1] == null ? 0 : Number(em(args[1], o).s);
      // VB: GeneralDate is G (3/5/2026 2:30:00 PM), LongTime T (2:30:00 PM), ShortTime HH:mm (N20)
      const f = ['G', 'D', 'd', 'T', 'HH:mm'][k] ?? no('FormatDateTime with that format');
      return fn('Format', [em(args[0], o), atom(q(f))]);
    }
    case 'datepart': // DatePart(interval, date[, firstDayOfWeek]); FirstWeekOfYear other than Jan1 is not supported
      if (args.length > 3) return no('DatePart with a FirstWeekOfYear');
      return fn('DatePart', all());
    case 'round': return emRound(args, o);
    case 'instr': {
      if (args.length !== 3) return fn('InStr', all());
      if (args[0].k === 'num' && args[0].v === 1) return fn('InStr', [em(args[1], o), em(args[2], o)]);
      // InStr(start, s, find): 1-based, from start
      return { s: `IndexOf(${em(args[1], o).s}, ${em(args[2], o).s}, ${wrap(em(args[0], o), 7)} - 1) + 1`, p: 6 };
    }
    case 'instrrev': // VB: 1-based position of the last occurrence (0: none), from an optional start
      if (args.length > 3) return no('InStrRev with a compare mode');
      return fn('InStrRev', all());
    case 'previous': { const sc = args[1] ? scopeArg(args[1], o, name) : null; return fn('Previous', sc ? [em(args[0], o), sc] : [em(args[0], o)]); }
    case 'ltrim': return fn('TrimStart', all());
    case 'rtrim': return fn('TrimEnd', all());
    case 'mid': if (args.length > 3) return no('Mid with extra arguments'); break;
  }
  if (SAME[w]) return fn(SAME[w], all());
  if (CONVERT[w] && args.length === 1) return fn(CONVERT[w], all()); // ToDecimal(x): a Convert method on its own
  return no(`the function ${name}()`);
}

/** text: "a " & x & " b" → "a {x} b" (a ReportWright template). Literal-only text stays plain. undefined: use "=…". */
function asTemplate(ast, o) {
  const parts = [];
  const flat = (n) => { if (n.k === 'bin' && n.op === '&') { flat(n.a); flat(n.b); } else parts.push(n); };
  flat(ast);
  const lit = (n) => n.k === 'str' || n.k === 'num';
  if (parts.every(lit)) {
    const s = escText(parts.map(p => String(p.v)).join(''));
    return s.startsWith('=') ? undefined : s;
  }
  if (parts.length === 1) return undefined;
  const out = parts.map(p => (lit(p) ? String(p.v).replace(/[{}]/g, '$&$&') : `{${em(p, o).s}}`)).join('');
  return out.startsWith('=') ? undefined : out;
}

/** Literal text as a ReportWright value: "{" starts an expression there, so braces are doubled. */
const escText = (s) => (s.includes('{') ? s.replace(/[{}]/g, '$&$&') : s);

/**
 * Translate one ActiveReports value (literal text or "=expression") into a ReportWright value.
 * @param {any} src
 * @param {{ text?: boolean, fields?: string, region?: string, scopes?: Map<string, string|null>, lit?: string | ((s: string) => string) }} [opt]
 *   text: the value is shown as text (concatenations become templates; what cannot be translated stays visible as text).
 *   fields: "Parent" reads fields from the enclosing list row. region: the data region, for Nothing scopes.
 *   scopes: ActiveReports scope name → ReportWright scope (null: drop it). lit: map style literals ("color", "weight", "align").
 * @returns {{ value: any, ok: boolean, notes: string[] }} value is undefined when nothing usable is left outside text.
 */
export function translateExpression(src, opt = {}) {
  /** @type {string[]} */
  const notes = [];
  if (src == null) return { value: undefined, ok: true, notes };
  if (typeof src !== 'string') return { value: src, ok: true, notes };
  const lit = typeof opt.lit === 'string' ? LITS[opt.lit] : opt.lit;
  if (!src.trimStart().startsWith('=')) {
    const v = escText(src);
    return { value: !opt.text && lit ? lit(v) : v, ok: true, notes };
  }
  const o = { notes, fields: opt.fields, region: opt.region, scopes: opt.scopes, runScopes: opt.runScopes, lit };
  try {
    const ast = vbParse(src.trimStart().slice(1));
    let value = opt.text ? asTemplate(ast, o) : undefined;
    if (value === undefined) value = '=' + em(ast, o, true).s;
    const err = checkValue(value);
    if (err) no(`a result ReportWright cannot read (${err})`);
    return { value, ok: true, notes };
  } catch (e) {
    const why = e instanceof Untranslatable
      ? (e.syntax ? `the expression ${src} could not be read (${e.message})` : `${e.message} has no ReportWright equivalent`)
      : `the expression ${src} could not be translated (${e.message})`;
    notes.push(why);
    return { value: opt.text ? '=' + q(src) : undefined, ok: false, notes };
  }
}

const isExpr = (v) => typeof v === 'string' && v.trimStart().startsWith('=');
/** The body of a ReportWright value as an expression: "=x" → "(x)", "text" → "\"text\"". */
const inner = (v) => (typeof v === 'string' && v.startsWith('=') ? `(${v.slice(1)})` : typeof v === 'string' ? q(v) : String(v));
const AGG_RE = /\b(Sum|Avg|Count|CountDistinct|CountRows|Min|Max|First|Last|RunningValue|RowNumber)\s*\(/i;

/* ================================================================ import context */

/**
 * The output budget. A small file must not become a huge report: cells laid out (rows × columns of every table,
 * nested ones included) and the size of the finished definition are capped, and going over stops the import
 * with an error instead of using the memory. Exported for the .rdl front end, which has budgets of its own.
 */
export class ImportBudgetError extends Error {}
export const OUTPUT_LIMITS = { cells: 1_000_000, cellsPerTable: 250_000, chars: 16_000_000 };
/** An empty row of n cells, charged to the budget. */
function blankCells(cx, n) {
  cx.cells += n;
  if (cx.cells > OUTPUT_LIMITS.cells) throw new ImportBudgetError(`its tables have more than ${OUTPUT_LIMITS.cells.toLocaleString('en-US')} cells in all`);
  return new Array(n).fill(null);
}
/** The size of a definition as JSON, counted until it passes the limit (so a shared object repeated a million times stops early). */
export function outputTooLarge(def, limit = OUTPUT_LIMITS.chars) {
  let size = 0;
  const stack = [def];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') size += v.length + 2;
    else if (v && typeof v === 'object') {
      if (Array.isArray(v)) { size += v.length + 2; for (const x of v) stack.push(x); } else for (const [k, x] of Object.entries(v)) { size += k.length + 4; stack.push(x); }
    } else size += 6;
    if (size > limit) return true;
  }
  return false;
}

function newContext() {
  const cx = {
    /** @type {string[]} */ warnings: [],
    stats: { items: 0, mapped: 0, approximated: 0, dropped: 0 },
    /** @type {Map<string, string>} */ images: new Map(),
    /** @type {Map<string, string|null>} */ scopes: new Map(),
    /** @type {Set<string>} */ fonts: new Set(),
    /** @type {Set<string>} */ names: new Set(),
    /** @type {Set<string>} */ reserved: new Set(),
    /** @type {Map<string, Set<string>>} data set → its field names (lower case) */ dsFields: new Map(),
    /** @type {Set<string>} parameter names (lower case) */ params: new Set(),
    /** @type {Record<string, string>} embedded images: referenced as embedded:name, stored once */ imageData: {},
    /** @type {Set<string>} layer names declared or used */ layers: new Set(),
    /** @type {Map<string, string>} banded list and group → the list whose rows a running value counts */ runScopes: new Map(),
    /** @type {{ name: string }[]} layers items use without a declaration */ extraLayers: [],
    /** @type {Set<string>} part libraries referenced (report ids) */ libraries: new Set(),
    cells: 0,
    warn(msg) { if (!cx.warnings.includes(msg)) cx.warnings.push(msg); },
  };
  return cx;
}
/** @typedef {ReturnType<typeof newContext>} Cx */
/** @typedef {{ region?: string, dataSet?: string, listDataSet?: string, parentFilters?: any[], band: string, top?: boolean }} Ctx */

/** Count one report item and collect what happens to it. */
function track(cx, ar, label) {
  cx.stats.items++;
  const name = String(ar?.Name || label || ar?.Type || 'item');
  const t = {
    name, state: 'mapped',
    /** in the report, with something lost or changed */
    approx(msg) { if (t.state === 'mapped') t.state = 'approximated'; cx.warn(`${name}: ${msg}`); },
    /** for information only */
    note(msg) { cx.warn(`${name}: ${msg}`); },
    /** not in the report */
    drop(msg) { t.state = 'dropped'; cx.warn(`${name}: ${msg}`); },
  };
  for (const n of Array.isArray(ar?.__notes) ? ar.__notes : []) t.approx(n); // notes from a front end (the .rdl importer)
  for (const n of Array.isArray(ar?.__info) ? ar.__info : []) t.note(n); // information only: nothing is lost
  return t;
}
/** @typedef {ReturnType<typeof track>} T */
function finish(cx, t, out) { cx.stats[t.state]++; return t.state === 'dropped' ? null : out; }

/** A unique item name; generated names also avoid every name in the file. */
function uniq(cx, base, generated = false) {
  const b = String(base || 'Item').trim() || 'Item';
  let k = b, i = 2;
  while (cx.names.has(k) || (generated && cx.reserved.has(k))) k = `${b}_${i++}`;
  cx.names.add(k);
  return k;
}

/**
 * Translate a value for item t, saying what was lost.
 * @param {Cx} cx @param {T} t @param {any} v @param {Ctx} ctx
 * @param {{ text?: boolean, what?: string, fields?: string, lit?: string }} [opt]
 */
function ex(cx, t, v, ctx, opt = {}) {
  const r = translateExpression(v, { text: opt.text, fields: opt.fields, lit: opt.lit, region: ctx.region, scopes: cx.scopes, runScopes: cx.runScopes });
  if (!r.ok) t.approx(`${r.notes.join('; ')}; ${opt.text ? 'the expression is shown as text' : `${opt.what || 'that setting'} is left out`}.`);
  else for (const n of r.notes) t.approx(`${n}.`);
  return r.value;
}

/* ================================================================ styles */

function fontFamily(name, cx) {
  if (!name || typeof name !== 'string' || isExpr(name)) return undefined;
  const fam = name.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const hit = Object.keys(FONT_FAMILIES).find(k => k.toLowerCase() === fam.toLowerCase());
  if (hit) return hit;
  const sub = MONO.test(fam) && FONT_FAMILIES['JetBrains Mono'] ? 'JetBrains Mono' : 'Inter';
  if (!cx.fonts.has(fam.toLowerCase())) {
    cx.fonts.add(fam.toLowerCase());
    cx.warn(`The font "${fam}" is not bundled with ReportWright, so text set in it uses ${sub}.`);
  }
  return sub;
}

/** One style setting: a literal, or an expression where ReportWright evaluates styles. */
function styleVal(v, cx, t, ctx, what, plain, lit) {
  if (v == null || v === '') return undefined;
  if (isExpr(v)) {
    if (!lit) { t.approx(`its ${what} is set by an expression, which ReportWright does not support for this setting; the default is used.`); return undefined; }
    return ex(cx, t, v, ctx, { lit, what: `its ${what}` });
  }
  return plain(v);
}

/** Borders: Border is the default for every side, TopBorder… override it (RDL 2005 BorderStyle/Color/Width too). */
function borderStyle(st, cx, t) {
  const out = {};
  const D = st.Border || {};
  const old = (prop, side) => { const o = st[`Border${prop}`]; return o == null ? undefined : typeof o === 'object' ? o[side] ?? o.Default : o; };
  let warned = false;
  const side = (S, name) => {
    const style = S?.Style ?? D.Style ?? old('Style', name) ?? 'None';
    const color = S?.Color ?? D.Color ?? old('Color', name) ?? 'Black';
    const width = S?.Width ?? D.Width ?? old('Width', name) ?? '1pt';
    if ([style, color, width].some(isExpr)) {
      if (!warned) t.approx('a border set by an expression is not drawn.');
      warned = true;
      return 'none';
    }
    const s = String(style).toLowerCase();
    if (s === 'none' || s === '') return 'none';
    const dash = { dashed: 'dashed', dotted: 'dotted', double: 'double' }[s] || 'solid';
    return `${toPt(width, 1)} ${dash} ${hexColor(color) || '#000000'}`;
  };
  const s = { Top: side(st.TopBorder, 'Top'), Right: side(st.RightBorder, 'Right'), Bottom: side(st.BottomBorder, 'Bottom'), Left: side(st.LeftBorder, 'Left') };
  const vals = Object.values(s);
  if (vals.every(v => v === 'none')) return out;
  if (vals.every(v => v === vals[0])) { out.border = vals[0]; return out; }
  for (const [k, v] of Object.entries(s)) if (v !== 'none') out[`border${k}`] = v;
  return out;
}

/** Text box style: font, colours, alignment, padding, format, borders. */
function textStyle(st, cx, t, ctx, { box = false } = {}) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!st || typeof st !== 'object') return out;
  const set = (k, v) => { if (v !== undefined && v !== null) out[k] = v; };
  if (!box) {
    if (isExpr(st.FontFamily)) t.approx('its font is set by an expression; the default font is used.');
    set('fontFamily', fontFamily(st.FontFamily, cx));
    set('fontSize', styleVal(st.FontSize, cx, t, ctx, 'font size', (v) => toPt(v, undefined)));
    set('fontWeight', styleVal(st.FontWeight, cx, t, ctx, 'font weight', weightOf, 'weight'));
    set('fontStyle', styleVal(st.FontStyle, cx, t, ctx, 'font style', (v) => (/italic|oblique/i.test(v) ? 'italic' : undefined), 'fontStyle'));
    set('color', styleVal(st.Color, cx, t, ctx, 'colour', hexColor, 'color'));
    set('textAlign', styleVal(st.TextAlign, cx, t, ctx, 'alignment', (v) => ALIGN[String(v).toLowerCase()], 'align'));
    set('verticalAlign', styleVal(st.VerticalAlign, cx, t, ctx, 'vertical alignment', (v) => VALIGN[String(v).toLowerCase()]));
    set('format', styleVal(st.Format, cx, t, ctx, 'format', formatOf, 'format'));
    if (typeof st.NullText === 'string') set('nullText', st.NullText); // the JasperReports front end's "null"
    if (st.LineHeight && !isExpr(st.LineHeight)) {
      const size = out.fontSize || 10, lh = toPt(st.LineHeight, 0);
      if (lh > 0) out.lineHeight = r2(lh / size);
    }
    if (/^(nowrap|none)$/i.test(String(st.WrapMode || ''))) out.wrap = false;
    const deco = String(st.TextDecoration || '').toLowerCase();
    if (isExpr(st.TextDecoration)) t.approx('its text decoration is set by an expression; it is not drawn.');
    else if (deco === 'underline' || deco === 'doubleunderline') set('textDecoration', 'underline');
    else if (deco === 'linethrough') set('textDecoration', 'line-through');
    else if (deco && deco !== 'none') t.approx(`its ${deco} is not drawn.`);
    if (/rtl/i.test(String(st.Direction || ''))) t.approx('right-to-left text is drawn left to right.');
    const wm = String(st.WritingMode || '').toLowerCase();
    if (wm === 'tb-rl' || wm === 'vertical') set('writingMode', 'tb-rl');
    else if (wm && wm !== 'lr-tb' && wm !== 'horizontal') t.approx(`its writing mode "${st.WritingMode}" is drawn horizontally.`);
  }
  set('backgroundColor', styleVal(st.BackgroundColor, cx, t, ctx, 'background', hexColor, 'color'));
  const bg = st.BackgroundImage;
  if (bg?.Value) {
    // an external URL or an image embedded in the file works; one from a field or an expression does not yet
    const src = String(bg.Source || 'External').toLowerCase();
    if (isExpr(bg.Value)) t.approx('its background image is set by an expression; it is not drawn.');
    else if (src === 'embedded' && cx.images.has(bg.Value)) set('backgroundImage', cx.images.get(bg.Value));
    else if (src === 'external' && /^(https?:|data:)/i.test(String(bg.Value))) set('backgroundImage', String(bg.Value));
    else t.approx('its background image is not drawn.');
  }
  const pads = [st.PaddingTop, st.PaddingRight, st.PaddingBottom, st.PaddingLeft];
  if (pads.some(p => p != null && p !== '')) {
    if (pads.some(isExpr)) t.approx('padding set by an expression is not supported; it is 0.');
    out.padding = pads.map(p => (isExpr(p) ? 0 : toPt(p, 0)));
  }
  Object.assign(out, borderStyle(st, cx, t));
  return out;
}

const hasDeco = (st) => !!(st && (st.backgroundColor || st.border || st.borderTop || st.borderRight || st.borderBottom || st.borderLeft));

/* ================================================================ report items */

/** @param {any[]} list @param {Cx} cx @param {Ctx} ctx */
function convertItems(list, cx, ctx) {
  if (!Array.isArray(list)) return [];
  const sorted = list.map((ar, i) => ({ ar, i })).sort((a, b) => (Number(a.ar?.ZIndex) || 0) - (Number(b.ar?.ZIndex) || 0) || a.i - b.i);
  const out = [];
  for (const { ar } of sorted) {
    const it = convertItem(ar, cx, ctx);
    if (it) out.push(it);
  }
  return out;
}

const CONVERTERS = {
  textbox: (ar, cx, ctx) => textbox(ar, cx, ctx),
  formattedtext: (ar, cx, ctx) => richtext(ar, cx, ctx),
  richtext: (ar, cx, ctx) => richtext(ar, cx, ctx),
  image: (ar, cx, ctx) => image(ar, cx, ctx),
  line: (ar, cx, ctx) => line(ar, cx, ctx),
  rectangle: (ar, cx, ctx) => container(ar, cx, ctx),
  container: (ar, cx, ctx) => container(ar, cx, ctx),
  shape: (ar, cx, ctx) => shape(ar, cx, ctx),
  checkbox: (ar, cx, ctx) => checkbox(ar, cx, ctx),
  barcode: (ar, cx, ctx) => barcode(ar, cx, ctx),
  subreport: (ar, cx, ctx) => subreport(ar, cx, ctx),
  table: (ar, cx, ctx) => table(ar, cx, ctx),
  tablix: (ar, cx, ctx) => tablix(ar, cx, ctx),
  list: (ar, cx, ctx) => list(ar, cx, ctx),
  bandedlist: (ar, cx, ctx) => bandedlist(ar, cx, ctx),
  chart: (ar, cx, ctx) => chart(ar, cx, ctx, false),
  dvchart: (ar, cx, ctx) => chart(ar, cx, ctx, true),
  tableofcontents: (ar, cx, ctx) => toc(ar, cx, ctx),
  inputfield: (ar, cx, ctx) => inputField(ar, cx, ctx),
  indicator: (ar, cx, ctx) => indicator(ar, cx, ctx),
  visual: (ar, cx, ctx) => visual(ar, cx, ctx),
  reportpart: (ar, cx, ctx) => reportPart(ar, cx, ctx),
  contentplaceholder: (ar, cx, ctx) => { const t = track(cx, ar); return finish(cx, t, common(ar, cx, t, ctx, 'placeholder')); },
  overflowplaceholder: (ar, cx) => { const t = track(cx, ar); t.approx('the table it continues flows onto the next pages by itself, so this placeholder is not needed.'); return finish(cx, t, null); },
};

/* ================================================================ reuse: layers, report parts, master reports */

// TargetDevice → ReportWright layer target
const TARGETS = { all: 'all', screen: 'screen', paper: 'print', print: 'print', export: 'export', none: 'design' };
/** The report's layers (not "default", where every item is anyway). */
function layersOf(ar, cx) {
  const out = [];
  for (const l of Array.isArray(ar.Layers) ? ar.Layers.slice(0, 200) : []) {
    if (!l?.Name || String(l.Name).toLowerCase() === 'default') continue;
    /** @type {Record<string, any>} */
    const o = { name: String(l.Name) };
    const tg = TARGETS[String(l.TargetDevice ?? '').toLowerCase()];
    if (tg && tg !== 'all') o.target = tg;
    if (l.Visible === false || isFalse(l.Visible ?? true)) o.visible = false;
    if (l.TargetDevice && !tg) cx.warn(`Layer "${l.Name}": the target device "${l.TargetDevice}" is not known; it shows everywhere.`);
    out.push(o);
    cx.layers.add(o.name);
  }
  return out;
}
/** An item's layer name, or undefined on the default layer. */
function layerOf(ar, cx) {
  const n = ar.LayerName;
  if (n == null || n === '' || String(n).toLowerCase() === 'default') return undefined;
  const name = String(n).slice(0, 200);
  if (!cx.layers.has(name)) { cx.layers.add(name); cx.extraLayers.push({ name }); cx.warn(`Layer "${name}" is used by an item but not declared; it was added, shown everywhere.`); }
  return name;
}
/** A library's report parts → ReportWright parts ({ name, item, properties }). */
function partsOf(ar, cx) {
  const out = [];
  for (const p of Array.isArray(ar.ReportParts) ? ar.ReportParts.slice(0, 500) : []) {
    const item = p?.ReportItemName ?? p?.ReportItem ?? p?.ItemName;
    if (!p?.Name || !item) { cx.warn(`A report part without a name or an item${p?.Name ? ` ("${p.Name}")` : ''} was left out.`); continue; }
    /** @type {Record<string, any>} */
    const o = { name: String(p.Name), item: String(item) };
    if (p.Description) o.description = String(p.Description).slice(0, 2000);
    const props = (Array.isArray(p.Properties) ? p.Properties : []).filter(q => q?.Name).map(q => ({ name: safeName(q.Name), default: q.DefaultValue ?? q.Value ?? null }));
    o.properties = props;
    out.push(o);
  }
  return out;
}
/** A report part instance → a ReportWright part item, its library referenced by report id. */
function reportPart(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'part');
  const lib = ar.Library ?? ar.LibraryName ?? ar.ReportLibrary;
  const part = ar.ReportPart ?? ar.PartName ?? ar.Part;
  if (!lib || !part) { t.drop('a report part without its library or part name was left out.'); return finish(cx, t, null); }
  it.library = reportId(lib);
  it.part = String(part);
  it.properties = {};
  for (const q of Array.isArray(ar.Properties) ? ar.Properties : []) {
    if (!q?.Name) continue;
    const v = ex(cx, t, q.Value, ctx, { what: `the part property ${q.Name}` });
    if (v !== undefined) it.properties[safeName(q.Name)] = v;
  }
  if (!cx.libraries.has(it.library)) { cx.libraries.add(it.library); cx.warn(`Report parts come from the library "${lib}": import it too and save it as the report "${it.library}".`); }
  return finish(cx, t, it);
}

/** One item. A converter that fails drops only its own item. */
function convertItem(ar, cx, ctx) {
  if (!ar || typeof ar !== 'object' || Array.isArray(ar)) { cx.warn('An entry in a list of report items is not an item; it was skipped.'); return null; }
  if (typeof ar.__drop === 'string') { const t = track(cx, ar); t.drop(ar.__drop); dropInside(ar, cx); return finish(cx, t, null); } // a front end left it out
  const type = String(ar.Type || '').toLowerCase();
  const conv = CONVERTERS[type];
  if (!conv) {
    const t = track(cx, ar);
    t.drop(`the item type "${ar.Type || '(none)'}" is not supported, so it was left out.`);
    dropInside(ar, cx);
    return finish(cx, t, null);
  }
  const snap = { ...cx.stats };
  try { return conv(ar, cx, ctx); } catch (e) {
    if (e instanceof ImportBudgetError) throw e;
    Object.assign(cx.stats, snap);
    const t = track(cx, ar);
    t.drop(`it could not be converted (${e instanceof Error ? e.message : e}), so it was left out.`);
    dropInside(ar, cx);
    return finish(cx, t, null);
  }
}

/** Items nested in something that was left out are left out too: count them, so the rate stays honest. */
function dropInside(ar, cx) {
  let n = 0;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'ReportItems' && Array.isArray(v)) { for (const x of v) if (x && typeof x === 'object' && x.Type) { n++; walk(x); } }
      else if (k === 'Item' && v && typeof v === 'object' && v.Type) { n++; walk(v); }
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(ar);
  cx.stats.items += n;
  cx.stats.dropped += n;
}

/** Name, position, size, visibility and page breaks: what every item has. */
function common(ar, cx, t, ctx, type) {
  /** @type {Record<string, any>} */
  const it = { type, name: uniq(cx, ar.Name || type), x: toPt(ar.Left), y: toPt(ar.Top), w: toPt(ar.Width), h: toPt(ar.Height) };
  const layer = layerOf(ar, cx);
  if (layer) it.layer = layer;
  const hidden = visibility(ar.Visibility, cx, t, ctx);
  if (hidden !== undefined) it.hidden = hidden;
  const pb = breaks(ar);
  if (pb.before) it.pageBreakBefore = true;
  if (pb.after) it.pageBreakAfter = true;
  return it;
}

const bare = (v) => { const s = v.trim(); return (s[0] === '=' ? s.slice(1).trim() : s).toLowerCase(); }; // "= True" → "true", in linear time
const isTrue = (v) => v === true || (typeof v === 'string' && v.length < 64 && bare(v) === 'true');
const isFalse = (v) => v == null || v === false || v === '' || (typeof v === 'string' && v.length < 64 && bare(v) === 'false');

function visibility(v, cx, t, ctx) {
  if (!v || typeof v !== 'object') return undefined;
  if (v.ToggleItem) {
    if (!isFalse(v.Hidden)) t.approx(`it is hidden until a click on "${v.ToggleItem}" in ActiveReports; ReportWright cannot toggle this item, so it is always shown.`);
    return undefined;
  }
  if (isFalse(v.Hidden)) return undefined;
  if (isTrue(v.Hidden)) return true;
  return ex(cx, t, v.Hidden, ctx, { what: 'the condition that hides it' });
}

function breaks(ar) {
  const s = String(ar?.PageBreak?.BreakLocation ?? ar?.PageBreak ?? '').toLowerCase();
  return {
    before: s === 'start' || s === 'startandend' || ar?.PageBreakAtStart === true,
    after: s === 'end' || s === 'startandend' || ar?.PageBreakAtEnd === true,
    between: s === 'between' || s === 'start' || s === 'end' || s === 'startandend',
  };
}

/** Hyperlink, drill-through, bookmark link, apply parameters. */
function action(a, cx, t, ctx) {
  if (!a || typeof a !== 'object') return undefined;
  if (Array.isArray(a.Actions)) a = a.Actions[0] || {};
  if (a.Hyperlink != null && a.Hyperlink !== '') return { type: 'url', url: ex(cx, t, a.Hyperlink, ctx, { text: true }) };
  if (a.Drillthrough) {
    const d = a.Drillthrough;
    const report = isExpr(d.ReportName) ? ex(cx, t, d.ReportName, ctx, { what: 'the drill-through report' }) : reportId(d.ReportName);
    if (!report) return undefined;
    /** @type {Record<string, any>} */
    const params = {};
    for (const p of d.Parameters || []) {
      if (!p?.ParameterName || isTrue(p.Omit)) continue;
      const v = ex(cx, t, p.Value, ctx, { what: `the drill-through parameter ${p.ParameterName}` });
      if (v !== undefined) params[safeName(p.ParameterName)] = v;
    }
    if (!isExpr(d.ReportName)) t.note(`it drills through to "${d.ReportName}"; import that report too, as ReportWright opens it by the id "${report}".`);
    return { type: 'report', report, params };
  }
  if (a.BookmarkLink != null && a.BookmarkLink !== '') return { type: 'bookmark', target: ex(cx, t, a.BookmarkLink, ctx, { text: true }) };
  if (Array.isArray(a.ApplyParameters) && a.ApplyParameters.length) {
    /** @type {Record<string, any>} */
    const params = {};
    for (const p of a.ApplyParameters) if (p?.Name) params[safeName(p.Name)] = String(p.Type || '').toLowerCase() === 'reset' ? '' : ex(cx, t, p.Value, ctx, { what: `the parameter ${p.Name}` }) ?? '';
    return { type: 'params', params, toggle: a.ApplyParameters.some(p => /toggle/i.test(String(p?.Type || ''))) };
  }
  return undefined;
}

/** Action, document-map label and tooltip of a text box (or table cell). */
function interactivity(ar, it, cx, t, ctx) {
  const a = action(ar.Action ?? ar.ActionInfo, cx, t, ctx);
  if (a) it.action = a;
  const label = ar.Label ?? ar.DocumentMapLabel ?? ar.Bookmark;
  if (label != null && label !== '') it.bookmark = ex(cx, t, label, ctx, { text: true });
  const heading = Number(ar.Style?.HeadingLevel);
  if (heading > 0) {
    if (it.bookmark == null && ar.Value != null && ar.Value !== '') it.bookmark = ex(cx, t, ar.Value, ctx, { text: true });
    if (heading > 1) it.bookmarkLevel = heading - 1;
  }
  if (ar.ToolTip != null && ar.ToolTip !== '') it.tooltip = ex(cx, t, ar.ToolTip, ctx, { text: true });
}

/**
 * FormattedText (and RichText): the HTML is kept as a ReportWright rich text item. Literal HTML is the author's
 * markup; its mail-merge fields (<%Name%>) become {…} parts, which the engine escapes. HTML that comes from an
 * expression is data: ActiveReports renders it as HTML, so htmlFromData is set and a warning names it.
 */
function richtext(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'richtext');
  const raw = ar.Html ?? ar.Value ?? ar.Text ?? '';
  if (isExpr(raw)) {
    const e = ex(cx, t, raw, ctx, { what: 'its HTML' });
    if (e !== undefined) {
      it.value = e;
      it.htmlFromData = true;
      t.approx('its HTML comes from an expression, as in ActiveReports, so "htmlFromData" is set: field values are read as HTML. Turn it off unless that data is trusted.');
    }
  } else {
    let v = String(raw).replace(/\{/g, '{{').replace(/\}/g, '}}');
    for (const f of Array.isArray(ar.MailMergeFields) ? ar.MailMergeFields : []) {
      const name = String(f?.Name ?? '');
      if (!name) continue;
      const e = ex(cx, t, f.Value ?? '', ctx, { what: `the mail-merge field ${name}` });
      const part = e === undefined ? '' : isExpr(e) ? `{${e.slice(1)}}` : String(e).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\{/g, '{{').replace(/\}/g, '}}');
      v = v.split(`<%${name}%>`).join(part).split(`&lt;%${name}%&gt;`).join(part);
    }
    it.value = v;
  }
  it.canGrow = isTrue(ar.CanGrow);
  if (isTrue(ar.CanShrink)) it.canShrink = true;
  const st = textStyle(ar.Style, cx, t, ctx);
  if (Object.keys(st).length) it.style = st;
  interactivity(ar, it, cx, t, ctx);
  return finish(cx, t, it);
}

/** The words of some HTML (for places that hold plain text). */
const stripHtml = (s) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^<>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function textbox(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'textbox');
  const v = ar.Value ?? ar.Text ?? '';
  it.value = ex(cx, t, v, ctx, { text: true });
  it.canGrow = isTrue(ar.CanGrow);
  if (isTrue(ar.CanShrink)) it.canShrink = true;
  // MinCondenseRate squeezes text sideways; shrinking the font is the closest ReportWright does
  const condense = Number(ar.MinCondenseRate);
  if (isTrue(ar.ShrinkToFit) || (condense > 0 && condense < 100)) it.shrinkToFit = true;
  // ActiveReports turns text counter-clockwise; ReportWright's rotate is clockwise
  const angle = Number(ar.Angle);
  const cw = ((-angle % 360) + 360) % 360;
  if (cw && !isExpr(ar.Angle)) it.rotate = cw;
  else if (isExpr(ar.Angle)) t.approx('its angle is set by an expression; the text is drawn upright.');
  const st = textStyle(ar.Style, cx, t, ctx);
  if (Object.keys(st).length) it.style = st;
  interactivity(ar, it, cx, t, ctx);
  return finish(cx, t, it);
}

function image(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'image');
  const source = String(ar.Source || '').toLowerCase();
  const v = ar.Value;
  if (source === 'embedded' || (!isExpr(v) && cx.images.has(v))) {
    if (isExpr(v)) t.approx('it picks an embedded image by an expression, which ReportWright does not support, so no image is shown.');
    else if (cx.images.has(v)) it.src = cx.images.get(v);
    else t.approx(`the embedded image "${v}" is not in the file, so no image is shown.`);
  } else if (source === 'database') {
    const e = ex(cx, t, v, ctx, { what: 'the image' });
    if (e !== undefined) {
      it.src = `data:${ar.MIMEType || 'image/png'};base64,{${isExpr(e) ? e.slice(1) : q(e)}}`;
      t.note('its image comes from a field; ReportWright reads it as base64 text.');
    }
  } else if (v != null && v !== '') {
    it.src = ex(cx, t, v, ctx, { what: 'the image address' });
    if (typeof it.src === 'string' && !isExpr(it.src) && !/^(https?:|data:|\/)/i.test(it.src)) t.approx(`the image address "${v}" is relative; ReportWright needs a full URL or a data URI.`);
  }
  it.fit = { fitproportional: 'contain', fit: 'fill', clip: 'cover', autosize: 'contain' }[String(ar.Sizing || 'AutoSize').toLowerCase()] || 'contain';
  const st = textStyle(ar.Style, cx, t, ctx, { box: true });
  if (Object.keys(st).length) it.style = st;
  if (ar.Action || ar.ActionInfo) t.approx('links on images are not supported, so the link is left out.');
  return finish(cx, t, it);
}

function line(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'line');
  let x1, y1, x2, y2;
  if (ar.StartPoint || ar.EndPoint) { x1 = toPt(ar.StartPoint?.X); y1 = toPt(ar.StartPoint?.Y); x2 = toPt(ar.EndPoint?.X); y2 = toPt(ar.EndPoint?.Y); }
  else { x1 = toPt(ar.Left); y1 = toPt(ar.Top); x2 = r2(x1 + toPt(ar.Width)); y2 = r2(y1 + toPt(ar.Height)); }
  Object.assign(it, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: r2(Math.abs(x2 - x1)), h: r2(Math.abs(y2 - y1)) });
  if ((x2 - x1) * (y2 - y1) < 0) it.direction = 'up';
  const b = ar.Style?.Border || {};
  const style = String(ar.LineStyle ?? b.Style ?? 'Solid').toLowerCase();
  if (style === 'none') it.hidden = true;
  const color = ar.LineColor ?? b.Color ?? 'Black';
  it.style = {
    stroke: isExpr(color) ? (t.approx('its colour is set by an expression; it is drawn black.'), '#000000') : hexColor(color) || '#000000',
    strokeWidth: toPt(ar.LineWidth ?? b.Width ?? '1pt', 1),
    strokeDash: { dashed: 'dashed', dotted: 'dotted' }[style] || 'solid',
  };
  return finish(cx, t, it);
}

function container(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'container');
  it.items = convertItems(ar.ReportItems, cx, { ...ctx, top: false });
  it.style = textStyle(ar.Style, cx, t, ctx, { box: true });
  delete it.style.padding;
  it.keepTogether = isTrue(ar.KeepTogether) || hasDeco(it.style);
  const rr = ar.RoundingRadius;
  if (rr && toPt(typeof rr === 'object' ? rr.Default ?? Object.values(rr)[0] : rr) > 0) t.approx('its rounded corners are drawn square.');
  return finish(cx, t, it);
}

function shape(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'shape');
  const kind = String(ar.ShapeStyle || ar.Shape || 'Rectangle').toLowerCase();
  it.shape = kind === 'ellipse' || kind === 'circle' || kind === 'oval' ? 'ellipse' : 'rect';
  const st = ar.Style || {}, b = st.Border || {};
  const none = /^none$/i.test(String(b.Style ?? 'Solid'));
  it.style = {
    fill: isExpr(st.BackgroundColor) ? null : hexColor(st.BackgroundColor) || null,
    stroke: none ? 'none' : hexColor(b.Color) || '#000000',
    strokeWidth: toPt(b.Width ?? '1pt', 1),
    radius: kind === 'roundrect' || kind === 'roundedrectangle' ? toPt(ar.RoundingRadius?.Default ?? ar.RoundingRadius ?? '8pt', 8) : 0,
  };
  if (isExpr(st.BackgroundColor)) t.approx('its fill is set by an expression, which shapes do not support; it is not filled.');
  return finish(cx, t, it);
}

function checkbox(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'checkbox');
  it.value = ar.Checked == null ? false : ex(cx, t, ar.Checked, ctx, { what: 'the checked state' }) ?? false;
  it.text = ex(cx, t, ar.Text ?? '', ctx, { text: true });
  const st = textStyle(ar.Style, cx, t, ctx);
  if (Object.keys(st).length) it.style = st;
  return finish(cx, t, it);
}

const SYMBOLOGY = [[/^code128|^code_128/, 'code128'], [/^code39|^code_39/, 'code39'], [/^(ean_?13|jan_?13)/, 'ean13'], [/^(ean_?8|jan_?8)/, 'ean8'],
  [/^upc_?a/, 'upca'], [/^itf_?14/, 'itf14'], [/^qr/, 'qrcode'], [/^data_?matrix/, 'datamatrix'], [/^pdf_?417/, 'pdf417'], [/^aztec/, 'azteccode'],
  [/^(gs1_?128|ucc_?ean_?128|ean_?128)/, 'gs1-128']];
function barcode(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'barcode');
  const sym = String(ar.Symbology || 'Code128').toLowerCase();
  const hit = SYMBOLOGY.find(([re]) => re.test(sym));
  it.symbology = hit ? hit[1] : 'code128';
  if (!hit) t.approx(`the "${ar.Symbology}" symbology is not supported; it is drawn as Code 128.`);
  it.value = ex(cx, t, ar.Value ?? '', ctx, { text: true });
  it.showText = !/^none$/i.test(String(ar.CaptionLocation ?? 'Below'));
  const st = textStyle(ar.Style, cx, t, ctx);
  delete st.padding;
  if (Object.keys(st).length) it.style = st;
  return finish(cx, t, it);
}

function subreport(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'subreport');
  it.report = reportId(ar.ReportName);
  it.params = {};
  for (const p of ar.Parameters || []) {
    if (!p?.ParameterName || isTrue(p.Omit)) continue;
    const v = ex(cx, t, p.Value, ctx, { what: `the parameter ${p.ParameterName}` });
    if (v !== undefined) it.params[safeName(p.ParameterName)] = v;
  }
  if (isTrue(ar.KeepTogether)) it.keepTogether = true;
  t.note(`it shows the report "${ar.ReportName}"; import that report too, as ReportWright finds it by the id "${it.report}".`);
  return finish(cx, t, it);
}

/** A state indicator (from the .rdl importer): a ReportWright icon set with low and high thresholds. */
function indicator(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'iconset');
  it.value = ex(cx, t, ar.Value ?? '', ctx, { what: 'its value' }) ?? '';
  it.iconSet = ['trafficLights', 'arrows', 'symbols', 'flags', 'ratings'].includes(ar.IconSet) ? ar.IconSet : 'trafficLights';
  for (const [k, src] of [['lower', ar.Lower], ['upper', ar.Upper]]) {
    const v = src == null ? undefined : ex(cx, t, src, ctx, { what: `its ${k} threshold` });
    if (v !== undefined) it[k] = typeof v === 'number' ? `=${v}` : v;
  }
  return finish(cx, t, it);
}

/** A data bar or sparkline (from the .rdl importer: SSRS draws them as small charts in cells). */
function visual(ar, cx, ctx) {
  const t = track(cx, ar);
  const kind = ar.Kind === 'sparkline' ? 'sparkline' : 'databar';
  const it = common(ar, cx, t, ctx, kind);
  for (const [k, src] of [['value', ar.Value], ['category', ar.Category], ['max', ar.Max]]) {
    const v = src == null ? undefined : ex(cx, t, src, ctx, { what: `its ${k}` });
    if (v !== undefined) it[k] = v;
  }
  if (kind === 'sparkline' && ['line', 'column', 'area'].includes(ar.VisualStyle)) it.style = ar.VisualStyle;
  const c = hexColor(ar.Color);
  if (c) it.color = c;
  return finish(cx, t, it);
}

function toc(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'toc');
  it.title = '';
  it.levels = Array.isArray(ar.Levels) && ar.Levels.length ? ar.Levels.length : 3;
  return finish(cx, t, it);
}

function inputField(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'field');
  const kind = String(ar.InputType || 'Text').toLowerCase();
  it.kind = kind === 'checkbox' ? 'checkbox' : isTrue(ar.Multiline) ? 'multiline' : 'text';
  it.fieldName = safeName(ar.FieldName || ar.Name || it.name);
  it.value = ex(cx, t, kind === 'checkbox' ? ar.Checked ?? false : ar.Value ?? '', ctx, kind === 'checkbox' ? { what: 'the checked state' } : { text: true }) ?? '';
  if (isTrue(ar.Readonly) || isTrue(ar.ReadOnly)) it.readOnly = true;
  if (isTrue(ar.Required)) it.required = true;
  const st = textStyle(ar.Style, cx, t, ctx);
  if (Object.keys(st).length) it.style = st;
  return finish(cx, t, it);
}

/* ================================================================ filters and sorting */

/** Fields and parameters an expression uses that do not exist: ReportWright stops the render on those in sorts, filters and calculated fields. */
function unknownRefs(v, ds, cx) {
  if (typeof v !== 'string' || /\bLookup\s*\(/i.test(v)) return [];
  const out = [];
  const fields = ds ? cx.dsFields.get(ds) : null;
  if (fields?.size) for (const m of v.matchAll(/\bFields\.([A-Za-z_]\w*)/g)) if (!fields.has(m[1].toLowerCase())) out.push(`the field "${m[1]}"`);
  for (const m of v.matchAll(/\bParameters\.([A-Za-z_]\w*)/g)) if (!cx.params.has(m[1].toLowerCase())) out.push(`the parameter "${m[1]}"`);
  return [...new Set(out)];
}
const missing = (refs, ds) => `${refs.join(' and ')}, which ${ds ? `the data set "${ds}"` : 'the report'} does not have`;

const FILTER_OPS = { equal: '=', notequal: '<>', greaterthan: '>', greaterthanorequal: '>=', lessthan: '<', lessthanorequal: '<=', like: 'like',
  topn: 'TopN', bottomn: 'BottomN', toppercent: 'TopPercent', bottompercent: 'BottomPercent' };

function filterList(list, cx, t, ctx, ds) {
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || typeof f !== 'object') continue;
    const expr = ex(cx, t, f.FilterExpression, ctx, { what: 'a filter' });
    if (expr === undefined) continue;
    const op = String(f.Operator || 'Equal').toLowerCase();
    const vals = (Array.isArray(f.FilterValues) ? f.FilterValues : [f.FilterValues]).filter(v => v != null).map(v => {
      // "False" compared with a true/false field: ActiveReports converts, ReportWright compares as is
      if (typeof v === 'string' && /^\s*(=\s*")?(true|false)"?\s*$/i.test(v)) return `=${/true/i.test(v)}`;
      return ex(cx, t, op === 'like' && !isExpr(v) ? String(v).replace(/%/g, '*') : v, ctx, { what: 'a filter value' });
    });
    if (vals.some(v => v === undefined)) continue;
    const refs = unknownRefs([expr, ...vals].join(' '), ds, cx);
    if (refs.length) { t.approx(`a filter uses ${missing(refs, ds)}, so it is left out.`); continue; }
    if (FILTER_OPS[op]) out.push({ expr, op: FILTER_OPS[op], value: vals[0] ?? '' });
    else if (op === 'in') out.push(vals.length === 1 ? { expr, op: 'in', value: vals[0] } : { expr: `=InList(${inner(expr)}, ${vals.map(inner).join(', ')})`, op: '=', value: '=true' });
    else if (op === 'between' && vals.length >= 2) out.push({ expr, op: 'Between', value: vals[0], value2: vals[1] });
    else t.approx(`the filter operator "${f.Operator}" is not supported, so that filter is left out and more rows may show.`);
  }
  return out;
}

function sortList(list, cx, t, ctx, ds) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s) continue;
    const by = ex(cx, t, s.Value ?? s.SortExpression, ctx, { what: 'a sort' });
    const refs = unknownRefs(by, ds, cx);
    if (refs.length) { t.approx(`a sort uses ${missing(refs, ds)}, so it is left out.`); continue; }
    if (by !== undefined) out.push({ by, dir: /desc/i.test(String(s.Direction || '')) ? 'desc' : 'asc' });
  }
  return out;
}

/** Group keys as one value: "=a" or "=(a) & "|" & (b)". */
const joinKeys = (keys) => (keys.length === 1 ? keys[0] : '=' + keys.map(inner).join(' & "|" & '));

/** A group's sort: by its own key → "asc"/"desc"; by a row value → sort rows first (groups keep that order); by an aggregate → lost. */
function groupSort(list, key, cx, t, ctx, label, ds) {
  const s = sortList(list, cx, t, ctx, ds)[0];
  if (!s) return {};
  if (s.by === key) return { dir: s.dir };
  if (typeof s.by === 'string' && AGG_RE.test(s.by)) { t.approx(`${label} is sorted by ${s.by} in ActiveReports; ReportWright sorts groups by their key or by row values, so they keep the data order.`); return {}; }
  return { rows: s };
}

/* ================================================================ table */

function cellOf(c, cx, tt, ctx, kind, opt = {}) {
  const ar = c?.Item ?? (Array.isArray(c?.ReportItems) ? c.ReportItems[0] : undefined);
  const span = Math.max(1, Math.floor(Number(c?.ColSpan) || 1));
  /** @type {Record<string, any>} */
  let cell = { value: '' };
  if (ar && typeof ar === 'object' && CELL_ITEMS.has(String(ar.Type || '').toLowerCase()) && !TEXT_CELL(ar)) {
    // an image, chart, table, list or rectangle in a cell: ReportWright lays it out inside the cell, in the row's scope
    const inner = convertItem({ ...ar, Left: '0pt', Top: '0pt' }, cx, { ...ctx, top: false });
    if (inner) cell.item = inner;
  } else if (ar && typeof ar === 'object') {
    const type = String(ar.Type || '').toLowerCase();
    const t = track(cx, ar);
    if (type === 'formattedtext' || type === 'richtext') {
      // a table cell is plain text in ReportWright: keep the words of the HTML
      const v = ar.Html ?? ar.Value ?? '';
      cell.value = isExpr(v) ? ex(cx, t, v, ctx, { text: true }) : ex(cx, t, stripHtml(String(v)), ctx, { text: true });
      t.approx('its formatting (HTML) is lost in a table cell; the text is kept.');
      const st = textStyle(ar.Style, cx, t, ctx);
      if (Object.keys(st).length) cell.style = st;
    } else if (type === 'textbox') {
      cell.value = opt.firstOf ? firstOf(ex(cx, t, ar.Value ?? '', ctx, { what: 'its value' }), opt.firstOf)
        : opt.firstIn ? firstIn(ex(cx, t, ar.Value ?? '', ctx, { what: 'its value' }), opt.firstIn) : ex(cx, t, ar.Value ?? '', ctx, { text: true });
      const st = textStyle(ar.Style, cx, t, ctx);
      if (Object.keys(st).length) cell.style = st;
      interactivity(ar, cell, cx, t, ctx);
      const us = ar.UserSort?.SortExpression;
      if (us) {
        const by = ex(cx, t, us, ctx, { what: 'its sort link' });
        if (by !== undefined) cell.sortBy = by;
        if (kind !== 'header') t.approx('its sort link works only in the table header in ReportWright.');
      }
      if (ar.Visibility && !ar.Visibility.ToggleItem && !isFalse(ar.Visibility.Hidden)) {
        const h = isTrue(ar.Visibility.Hidden) ? true : ex(cx, t, ar.Visibility.Hidden, ctx, { what: 'the condition that hides it' });
        if (h === true) cell.value = '';
        else if (h !== undefined) {
          const raw = ex(cx, t, ar.Value ?? '', ctx, { what: 'its value' });
          cell.value = `=IIF(${h.slice(1)}, "", ${inner(raw ?? '')})`;
          t.approx('it is hidden by a condition; ReportWright clears its text instead, so its background and borders stay.');
        }
      } else if (ar.Visibility?.ToggleItem) t.approx(`a click on "${ar.Visibility.ToggleItem}" toggles it in ActiveReports; here it is always shown.`);
    } else if (type === 'checkbox') {
      const v = ex(cx, t, ar.Checked ?? false, ctx, { what: 'the checked state' });
      cell.value = `=IIF(${inner(v ?? false)}, "Yes", "No")`;
      const st = textStyle(ar.Style, cx, t, ctx);
      if (Object.keys(st).length) cell.style = st;
      t.approx('a check box in a table cell shows "Yes" or "No".');
    } else if ((type === 'rectangle' || type === 'container') && (ar.ReportItems || []).length === 1 && String(ar.ReportItems[0]?.Type).toLowerCase() === 'textbox') {
      t.approx('this rectangle in a table cell is replaced by the text box inside it.');
      cx.stats[t.state]++;
      const innerCell = cellOf({ Item: ar.ReportItems[0] }, cx, tt, ctx, kind, opt);
      cell = { ...innerCell, style: { ...textStyle(ar.Style, cx, t, ctx, { box: true }), ...innerCell.style } };
      if (span > 1) cell.colSpan = span;
      if (Number(c?.RowSpan) > 1) cell.rowSpan = Math.floor(Number(c.RowSpan));
      return cell;
    } else if (type === 'tablix' || type === 'table' || type === 'list' || type === 'chart' || type === 'dvchart' || type === 'image' || type === 'subreport' || type === 'barcode' || type === 'rectangle' || type === 'bandedlist') {
      t.drop(`a ${ar.Type} inside a table cell is not supported, so the cell is empty.`);
      dropInside(ar, cx);
    } else t.drop(`the item type "${ar.Type || '(none)'}" is not supported in a table cell, so the cell is empty.`);
    finish(cx, t, null);
  }
  if (span > 1) cell.colSpan = span;
  if (Number(c?.RowSpan) > 1) cell.rowSpan = Math.floor(Number(c.RowSpan));
  return cell;
}

/** Report items a table cell can hold as a nested item (the cell lays them out in its box). */
const CELL_ITEMS = new Set(['tablix', 'table', 'list', 'chart', 'dvchart', 'image', 'subreport', 'barcode', 'rectangle', 'container', 'bandedlist', 'indicator', 'visual', 'shape', 'line']);

/** A row-header value shown only on the first row of its group (the merged cell in ActiveReports). */
function firstOf(v, group) {
  if (v === undefined) return '';
  return `=IIF(RowNumber(${q(group)}) = 1, ${typeof v === 'string' && v.startsWith('=') ? v.slice(1) : inner(v)}, "")`;
}

/** An outer group's header in an inner group's header row: shown on the inner group's first instance only. */
function firstIn(v, { key, group }) {
  if (v === undefined) return '';
  const k = inner(key);
  return `=IIF(${k} = First(${k}, ${q(group)}), ${typeof v === 'string' && v.startsWith('=') ? v.slice(1) : inner(v)}, "")`;
}

/** Cells of one row, positioned by column (ActiveReports writes null for cells covered by a span). */
function rowCells(src, N, cx, tt, ctx, kind, offset = 0) {
  const cells = blankCells(cx, N);
  const list = Array.isArray(src) ? src : [];
  const positional = list.length + offset === N || list.some(c => c == null);
  let col = offset;
  for (const c of list) {
    if (col >= N) { if (c?.Item) { const t = track(cx, c.Item); t.drop('it is in a cell beyond the last column, so it was left out.'); finish(cx, t, null); } continue; }
    if (c == null) { col++; continue; }
    cells[col] = cellOf(c, cx, tt, ctx, kind);
    col += positional ? 1 : Math.max(1, Math.floor(Number(c.ColSpan) || 1));
  }
  return cells;
}

function tableRows(rows, N, cx, tt, ctx, kind) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.Visibility && !r.Visibility.ToggleItem && isTrue(r.Visibility.Hidden)) { tt.approx('a hidden row was left out.'); continue; }
    if (r.Visibility && !r.Visibility.ToggleItem && !isFalse(r.Visibility.Hidden)) tt.approx('a row hidden by a condition is always shown.');
    const cellSrc = r.TableCells || r.Cells || [];
    /** @type {Record<string, any>} */
    const row = { height: toPt(r.Height, 18), cells: rowCells(cellSrc, N, cx, tt, ctx, kind) };
    if (!cellSrc.some(c => isTrue(c?.Item?.CanGrow))) row.canGrow = false;
    out.push(row);
  }
  return out;
}

/** Drill-down: the level shown by a click on a text box above it → the group above becomes collapsible. */
function toggles(groups, levelVis, tt) {
  levelVis.forEach((v, k) => {
    if (!v || typeof v !== 'object') return;
    const above = groups[k - 1];
    if (v.ToggleItem) {
      if (!above) { tt.approx(`a click on "${v.ToggleItem}" toggles rows that have no group above them; they are always shown.`); return; }
      above.collapsible = true;
      above.initiallyCollapsed = !isFalse(v.Hidden);
      if (!isTrue(v.Hidden) && !isFalse(v.Hidden)) tt.approx('whether a group starts collapsed depends on an expression; it starts collapsed.');
    } else if (!isFalse(v.Hidden)) tt.approx('rows hidden by a condition are always shown.');
  });
}

/** Cell items a ReportWright table cell can show: text (and check boxes as text). */
const TEXT_CELL = (it) => !it || ['textbox', 'formattedtext', 'checkbox'].includes(String(it.Type || '').toLowerCase())
  || (String(it.Type || '').toLowerCase() === 'rectangle' && (it.ReportItems || []).length === 1 && String(it.ReportItems[0]?.Type).toLowerCase() === 'textbox');

/**
 * A table whose cells hold images, barcodes, charts or other tables becomes a banded list: each row a band,
 * each cell a positioned item. ReportWright table cells hold only text.
 */
function tableAsBands(ar) {
  const widths = ar.TableColumns.filter(Boolean).map(c => toPt(c.Width, 72));
  const xs = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
  const band = (rows) => {
    let y = 0;
    const items = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r) continue;
      const h = toPt(r.Height, 18);
      const list = r.TableCells || r.Cells || [];
      const positional = list.length === widths.length || list.some(c => c == null);
      let col = 0;
      for (const c of list) {
        if (col >= widths.length) break;
        const span = Math.max(1, Math.floor(Number(c?.ColSpan) || 1));
        if (c?.Item) {
          const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
          items.push({ ...c.Item, Left: `${r2(xs[col])}pt`, Top: `${r2(y)}pt`, Width: `${r2(w)}pt`, Height: `${h}pt` });
        }
        col += c == null || positional ? 1 : span;
      }
      y += h;
    }
    return { Height: `${r2(y)}pt`, ReportItems: items };
  };
  return {
    Type: 'bandedlist', Name: ar.Name, DataSetName: ar.DataSetName, Left: ar.Left, Top: ar.Top, Width: `${r2(widths.reduce((a, b) => a + b, 0))}pt`,
    Visibility: ar.Visibility, Filters: ar.Filters, SortExpressions: ar.SortExpressions ?? ar.Details?.SortExpressions, PageBreak: ar.PageBreak,
    Header: band(ar.Header?.TableRows), Details: band(ar.Details?.TableRows), Footer: band(ar.Footer?.TableRows),
    Groups: (ar.TableGroups || []).filter(Boolean).map(g => ({ Group: g.Group || g.Grouping, SortExpressions: g.SortExpressions, KeepTogether: g.KeepTogether, Header: band(g.Header?.TableRows), Footer: band(g.Footer?.TableRows) })),
    __note: 'its cells hold more than text, so each row becomes a band of positioned items: cells no longer grow together and the header does not repeat on new pages.',
  };
}

function table(ar, cx, ctx) {
  const rowCount = [ar.Header, ar.Details, ar.Footer, ...(Array.isArray(ar.TableGroups) ? ar.TableGroups.flatMap(g => [g?.Header, g?.Footer]) : [])]
    .reduce((n, p) => n + (Array.isArray(p?.TableRows) ? p.TableRows.length : 0), 0);
  if (Array.isArray(ar.TableColumns) && rowCount * ar.TableColumns.length > OUTPUT_LIMITS.cellsPerTable) return tooBig(ar, cx, rowCount, ar.TableColumns.length);
  const allCells = [ar.Header, ar.Details, ar.Footer, ...(Array.isArray(ar.TableGroups) ? ar.TableGroups.flatMap(g => [g?.Header, g?.Footer]) : [])]
    .flatMap(p => (Array.isArray(p?.TableRows) ? p.TableRows : [])).flatMap(r => r?.TableCells || r?.Cells || []);
  if (Array.isArray(ar.TableColumns) && ar.TableColumns.length && !allCells.every(c => TEXT_CELL(c?.Item))) return bandedlist(tableAsBands(ar), cx, ctx);
  const t = track(cx, ar);
  const cols = Array.isArray(ar.TableColumns) ? ar.TableColumns.filter(Boolean) : [];
  if (!cols.length) { t.drop('the table has no columns, so it was left out.'); dropInside(ar, cx); return finish(cx, t, null); }
  if (ctx.band !== 'body' && ctx.top) { t.drop('ReportWright allows tables only in the body, not in the page header or footer.'); dropInside(ar, cx); return finish(cx, t, null); }
  const it = common(ar, cx, t, ctx, 'table');
  const rctx = { ...ctx, region: it.name, top: false };
  const N = cols.length;
  it.columns = cols.map(c => ({ width: toPt(c.Width, 72) }));
  if (cols.some(c => c.Visibility && !isFalse(c.Visibility.Hidden))) t.approx('a hidden column is shown.');
  it.dataSet = ar.DataSetName || ctx.dataSet;
  it.repeatHeader = isTrue(ar.Header?.RepeatOnNewPage);
  it.header = tableRows(ar.Header?.TableRows, N, cx, t, rctx, 'header');
  const sorts = sortList(ar.SortExpressions ?? ar.Details?.SortExpressions, cx, t, rctx, it.dataSet);
  it.groups = (Array.isArray(ar.TableGroups) ? ar.TableGroups : []).filter(Boolean).map((g, i) => {
    const G = g.Group || g.Grouping || {};
    const keys = (G.GroupExpressions || []).map(e => ex(cx, t, e, rctx, { what: 'a group expression' })).filter(k => k !== undefined);
    /** @type {Record<string, any>} */
    const out = { name: G.Name || uniq(cx, `${it.name}_Group${i + 1}`, true), expr: keys.length ? joinKeys(keys) : '=""' };
    out.header = tableRows(g.Header?.TableRows, N, cx, t, rctx, 'groupHeader');
    out.footer = tableRows(g.Footer?.TableRows, N, cx, t, rctx, 'groupFooter');
    const gs = groupSort(g.SortExpressions ?? G.SortExpressions, out.expr, cx, t, rctx, `the group "${out.name}"`, it.dataSet);
    if (gs.dir) out.sort = gs.dir;
    if (gs.rows) sorts.splice(i, 0, gs.rows);
    const pb = breaks(G);
    if (pb.between) out.pageBreak = String(G.PageBreak?.BreakLocation ?? G.PageBreak).toLowerCase() === 'end' ? 'after' : 'between';
    if (isTrue(g.KeepTogether ?? G.KeepTogether)) out.keepTogether = true;
    if (Array.isArray(G.Filters) && G.Filters.length) t.approx(`the group "${out.name}" has filters, which ReportWright groups do not support, so all its rows show.`);
    if (isTrue(g.Header?.RepeatOnNewPage)) t.approx(`the header of the group "${out.name}" does not repeat on each new page in ReportWright.`);
    const label = G.DocumentMapLabel ?? G.Label;
    const first = out.header[0]?.cells.find(Boolean);
    if (label && first && first.bookmark == null) first.bookmark = ex(cx, t, label, rctx, { text: true });
    if (!keys.length) t.approx(`the group "${out.name}" has no group expression, so all rows form one group.`);
    return out;
  });
  it.detail = tableRows(ar.Details?.TableRows, N, cx, t, rctx, 'detail');
  it.footer = tableRows(ar.Footer?.TableRows, N, cx, t, rctx, 'footer');
  toggles(it.groups, [...(ar.TableGroups || []).filter(Boolean).map(g => g.Visibility), ar.Details?.Visibility], t);
  if ((ar.Details?.Group || ar.Details?.Grouping)?.GroupExpressions?.length) t.approx('its detail rows are grouped (one row per group) in ActiveReports; ReportWright shows every row.');
  if (ar.Details?.Visibility && !ar.Details.Visibility.ToggleItem && isTrue(ar.Details.Visibility.Hidden)) it.detail = [];
  regionData(ar, it, cx, t, rctx, ctx);
  if (sorts.length) it.sort = sorts;
  it.noRowsText = ar.NoRowsMessage ? ex(cx, t, ar.NoRowsMessage, rctx, { text: true }) : '';
  it.w = r2(it.columns.reduce((s, c) => s + c.width, 0));
  return finish(cx, t, it);
}

/** Filters of a data region, plus the parent keys when it sits in a grouped list over the same data. */
function regionData(ar, it, cx, t, rctx, ctx) {
  if (it.dataSet && !cx.dsFields.has(it.dataSet)) t.note(`its data set "${it.dataSet}" is not in the file, so it shows no rows.`);
  const f = filterList(ar.Filters, cx, t, rctx, it.dataSet);
  if (it.dataSet && it.dataSet === ctx.listDataSet) {
    if (ctx.parentFilters?.length) f.unshift(...ctx.parentFilters);
    else if (ctx.listDataSet) t.approx('it uses the same data as the list around it; ReportWright shows all of its rows in every list row.');
  }
  if (f.length) it.filters = f;
}

/* ================================================================ tablix */

const isDyn = (m) => !!(m && m.Group && (m.Group.GroupExpressions || []).length);
const anyDyn = (ms) => (Array.isArray(ms) ? ms : []).some(m => isDyn(m) || anyDyn(m?.Children));
const members = (h) => (Array.isArray(h?.Members) ? h.Members.filter(Boolean) : []);

/** Rows × columns of one table over the per-table cap: left out with a note. */
function tooBig(ar, cx, rows, cols) {
  const t = track(cx, ar);
  t.drop(`it has ${rows} rows × ${cols} columns, more than the ${OUTPUT_LIMITS.cellsPerTable.toLocaleString('en-US')} cells a table may have, so it was left out.`);
  dropInside(ar, cx);
  return finish(cx, t, null);
}

function tablix(ar, cx, ctx) {
  const body = ar.Body;
  const levels = (h) => (Array.isArray(h?.LevelSizes) ? h.LevelSizes.length : 0);
  if (body && Array.isArray(body.Columns) && Array.isArray(body.Rows)) {
    const rows = body.Rows.length + levels(ar.ColumnHierarchy), cols = body.Columns.length + levels(ar.RowHierarchy);
    if (rows * cols > OUTPUT_LIMITS.cellsPerTable) return tooBig(ar, cx, rows, cols);
  }
  if (!body || !Array.isArray(body.Columns) || !body.Columns.length) {
    const t = track(cx, ar);
    t.drop('the tablix has no body, so it was left out.');
    dropInside(ar, cx);
    return finish(cx, t, null);
  }
  return anyDyn(members(ar.ColumnHierarchy)) ? tablixMatrix(ar, cx, ctx) : tablixTable(ar, cx, ctx);
}

/** Every item inside a tablix (corner, member headers, body cells), for counting what the matrix leaves out. */
function tablixItems(ar) {
  const out = [];
  for (const row of ar.Corner || []) for (const c of row || []) if (c?.Item) out.push(c.Item);
  const walk = (ms) => { for (const m of ms || []) { if (m?.Header?.Item) out.push(m.Header.Item); walk(m?.Children); } };
  walk(ar.ColumnHierarchy?.Members); walk(ar.RowHierarchy?.Members);
  for (const r of ar.Body?.Rows || []) for (const c of r?.Cells || []) if (c?.Item) out.push(c.Item);
  return out;
}

/** A tablix without column groups: a table, with its row groups as table groups. */
function tablixTable(ar, cx, ctx) {
  const t = track(cx, ar);
  if (ctx.band !== 'body' && ctx.top) { t.drop('ReportWright allows tables only in the body, not in the page header or footer.'); dropInside(ar, cx); return finish(cx, t, null); }
  const it = common(ar, cx, t, ctx, 'table');
  const rctx = { ...ctx, region: it.name, top: false };
  const rowH = ar.RowHierarchy || {}, colH = ar.ColumnHierarchy || {};
  const R = (rowH.LevelSizes || []).length, C = (colH.LevelSizes || []).length;
  const bodyCols = ar.Body.Columns.map(w => toPt(typeof w === 'object' ? w?.Width : w, 72));
  it.dataSet = ar.DataSetName || ctx.dataSet;
  it.columns = [...(rowH.LevelSizes || []).map(w => ({ width: toPt(w, 72) })), ...bodyCols.map(width => ({ width }))];
  const N = it.columns.length;

  // column header rows: the corner, then the headers of the (static) column members
  const colRows = [];
  if (C) {
    const grid = Array.from({ length: C }, () => blankCells(cx, N));
    (ar.Corner || []).forEach((crow, l) => (crow || []).forEach((c, k) => { if (c?.Item && l < C && k < R) grid[l][k] = cellOf(c, cx, t, rctx, 'header'); }));
    let leaf = 0;
    const walkCols = (ms, level) => {
      for (const m of ms) {
        const start = leaf;
        const span = m.Header ? Number(m.Header.LevelCount) || 1 : 0;
        if (m.Visibility && !isFalse(m.Visibility.Hidden)) t.approx('a hidden column is shown.');
        if (members(m.Children ? { Members: m.Children } : null).length) walkCols(members({ Members: m.Children }), level + span); else leaf++;
        if (m.Header?.Item && level < C && R + start < N) grid[level][R + start] = cellOf({ Item: m.Header.Item, ColSpan: leaf - start }, cx, t, rctx, 'header');
      }
    };
    walkCols(members(colH), 0);
    colH.LevelSizes.forEach((h, l) => colRows.push({ height: toPt(h, 18), cells: grid[l] }));
  }

  // row hierarchy → leaves (one per body row) in order, each with the members above it
  const groups = [], leaves = [];
  let detailVis, problem = null;
  const walkRows = (ms, level, path, depth, hint) => {
    const localDyn = ms.some(m => m.Group);
    if (ms.filter(m => m.Group).length > 1) problem = 'two row groups sit side by side';
    let seen = false;
    for (const m of ms) {
      const span = m.Header ? Number(m.Header.LevelCount) || 1 : 0;
      const p = [...path, { m, level, span }];
      const kids = members({ Members: m.Children });
      if (isDyn(m)) {
        if (depth !== groups.length) problem = 'its row groups are not nested in one chain';
        groups.push({ m, name: m.Group.Name || uniq(cx, `${it.name}_Group${groups.length + 1}`, true), header: [], footer: [] });
        if (kids.length) walkRows(kids, level + span, p, depth + 1, 'before');
        else leaves.push({ bi: m.BodyIndex, path: p, depth: depth + 1, kind: 'self' });
        seen = true;
      } else if (m.Group) {
        detailVis = m.Visibility;
        // several rows per record: static members under the details member (SSRS writes these)
        const under = (ks, lvl, pp) => { for (const k of ks) {
          const sp = k.Header ? Number(k.Header.LevelCount) || 1 : 0, kp = [...pp, { m: k, level: lvl, span: sp }];
          if (k.Group) problem = 'its detail rows have groups under them';
          const kk = members({ Members: k.Children });
          if (kk.length) under(kk, lvl + sp, kp); else leaves.push({ bi: k.BodyIndex, path: kp, depth, kind: 'detail' });
        } };
        if (kids.length) under(kids, level + span, p); else leaves.push({ bi: m.BodyIndex, path: p, depth, kind: 'detail' });
        seen = true;
      } else if (kids.length) walkRows(kids, level + span, p, depth, seen ? 'after' : localDyn ? 'before' : hint);
      else leaves.push({ bi: m.BodyIndex, path: p, depth, kind: 'static', place: seen ? 'after' : localDyn ? 'before' : hint });
    }
  };
  walkRows(members(rowH), 0, [], 0, 'before');
  for (const g of groups) cx.scopes.set(g.name, g.name);
  leaves.forEach((L, i) => { if (L.bi == null) L.bi = i; });
  for (const L of leaves) {
    const br = ar.Body.Rows?.[L.bi];
    L.row = { height: toPt(br?.Height, 18), cells: rowCells(br?.Cells, N, cx, t, rctx, L.kind === 'detail' ? 'detail' : L.depth === 0 && L.place !== 'after' ? 'header' : 'groupHeader', R) };
    if (!(br?.Cells || []).some(c => isTrue(c?.Item?.CanGrow))) L.row.canGrow = false;
  }
  // a member's header sits in the first row under it (ActiveReports merges it down the rows)
  const placed = new Set();
  const keyOf = (g) => { const ks = (g?.m.Group.GroupExpressions || []).map(e => translateExpression(e, { scopes: cx.scopes }).value).filter(k => typeof k === 'string'); return ks.length ? joinKeys(ks) : null; };
  for (const L of leaves) {
    for (const p of L.path) {
      if (placed.has(p.m)) continue;
      placed.add(p.m);
      if (!p.m.Header?.Item || p.level >= R) continue;
      const gi = groups.findIndex(g => g.m === p.m);
      const span = Math.min(p.span, R - p.level);
      if (gi >= 0 && L.kind === 'detail' && L.depth >= gi + 1) { // the first detail row under the group (nested groups' headers share it)
        L.row.cells[p.level] = cellOf({ Item: p.m.Header.Item, ColSpan: span }, cx, t, rctx, 'detail', { firstOf: groups[gi].name });
      } else if (gi >= 0 && L.depth > gi + 1 && (L.kind === 'self' || (L.kind === 'static' && L.place === 'before')) && keyOf(groups[L.depth - 1])) {
        // the first header row of an inner group: shown on that group's first instance in this one (stair-step headers in one row)
        const key = keyOf(groups[L.depth - 1]);
        L.row.cells[p.level] = cellOf({ Item: p.m.Header.Item, ColSpan: span }, cx, t, rctx, 'groupHeader', { firstIn: { key, group: groups[gi].name } });
      } else if (gi >= 0 && !(L.depth === gi + 1 && (L.kind === 'self' || L.place === 'before'))) {
        const cells = blankCells(cx, N);
        cells[p.level] = cellOf({ Item: p.m.Header.Item, ColSpan: span }, cx, t, rctx, 'groupHeader');
        groups[gi].header.unshift({ height: L.row.height, cells });
        t.approx(`the header of the group "${groups[gi].name}" gets a row of its own above the group.`);
      } else L.row.cells[p.level] = cellOf({ Item: p.m.Header.Item, ColSpan: span }, cx, t, rctx, L.kind === 'detail' ? 'detail' : 'groupHeader');
    }
  }
  const header = [...colRows], footer = [], detail = [];
  for (const L of leaves) {
    if (L.kind === 'detail') { if (L.depth !== groups.length) problem = 'its detail rows are not inside the innermost group'; detail.push(L.row); continue; }
    if (L.kind === 'self') { groups[L.depth - 1].header.push(L.row); continue; }
    const g = groups[L.depth - 1];
    (L.depth === 0 ? (L.place === 'after' ? footer : header) : L.place === 'after' ? g.footer : g.header).push(L.row);
  }
  if (problem) {
    t.approx(`${problem}, so its rows are listed without groups.`);
    it.header = colRows;
    it.groups = [];
    it.detail = leaves.map(L => L.row);
    it.footer = [];
  } else {
    const sorts = sortList(ar.SortExpressions, cx, t, rctx, it.dataSet);
    it.header = header;
    it.groups = groups.map((g, i) => {
      const keys = (g.m.Group.GroupExpressions || []).map(e => ex(cx, t, e, rctx, { what: 'a group expression' })).filter(k => k !== undefined);
      /** @type {Record<string, any>} */
      const out = { name: g.name, expr: keys.length ? joinKeys(keys) : '=""', header: g.header, footer: g.footer };
      const gs = groupSort(g.m.SortExpressions, out.expr, cx, t, rctx, `the group "${g.name}"`, it.dataSet);
      if (gs.dir) out.sort = gs.dir;
      if (gs.rows) sorts.splice(i, 0, gs.rows);
      const pb = breaks(g.m.Group);
      if (pb.between) out.pageBreak = String(g.m.Group.PageBreak?.BreakLocation ?? g.m.Group.PageBreak).toLowerCase() === 'end' ? 'after' : 'between';
      if (isTrue(g.m.Group.PageBreak?.ResetPageNumber)) { out.newSection = true; delete out.pageBreak; }
      // a recursive hierarchy: Parent is the parent's id
      if (g.m.Group.Parent != null && g.m.Group.Parent !== '') { const pe = ex(cx, t, g.m.Group.Parent, rctx, { what: 'a recursive parent' }); if (pe !== undefined) out.parent = pe; }
      if (isTrue(g.m.KeepTogether)) out.keepTogether = true;
      if (Array.isArray(g.m.Group.Filters) && g.m.Group.Filters.length) t.approx(`the group "${g.name}" has filters, which ReportWright groups do not support, so all its rows show.`);
      const label = g.m.Group.DocumentMapLabel;
      const first = out.header[0]?.cells.find(Boolean);
      if (label && first && first.bookmark == null) first.bookmark = ex(cx, t, label, rctx, { text: true });
      return out;
    });
    it.detail = detail;
    it.footer = footer;
    toggles(it.groups, [...groups.map(g => g.m.Visibility), detailVis], t);
    if (sorts.length) it.sort = sorts;
  }
  it.repeatHeader = isTrue(ar.RepeatColumnHeaders) || members(rowH).some(m => !m.Group && isTrue(m.RepeatOnNewPage));
  regionData(ar, it, cx, t, rctx, ctx);
  it.noRowsText = ar.NoRowsMessage ? ex(cx, t, ar.NoRowsMessage, rctx, { text: true }) : '';
  it.w = r2(it.columns.reduce((s, c) => s + c.width, 0));
  return finish(cx, t, it);
}

/**
 * A tablix with column groups: a ReportWright matrix in the array form (spec §6). Each chain of dynamic members
 * becomes rowGroups / columnGroups (outer → inner), a static member beside a dynamic one becomes that group's
 * total, the static children of the innermost column group become several values.
 */
function tablixMatrix(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'matrix');
  const rctx = { ...ctx, region: it.name, top: false };
  it.dataSet = ar.DataSetName || ctx.dataSet;
  const rowMs = members(ar.RowHierarchy), colMs = members(ar.ColumnHierarchy);
  // leaf index of each member (its body row or column)
  const leafIndex = (ms) => { const map = new Map(); let n = 0; const walk = (list) => { for (const m of list) { map.set(m, m.BodyIndex ?? n); const kids = members({ Members: m.Children }); if (kids.length) walk(kids); else n++; } }; walk(ms); return map; };
  const rIdx = leafIndex(rowMs), cIdx = leafIndex(colMs);
  /** The chain of dynamic members, with the static member beside each (its total) and the leaves under the innermost. */
  const chainOf = (ms, which) => {
    const levels = [];
    let list = ms, leaves = [];
    while (list.length) {
      const dyns = list.filter(isDyn);
      if (!dyns.length) { leaves = list; break; }
      if (dyns.length > 1) t.approx(`two ${which} groups sit side by side; only the first is kept.`);
      const d = dyns[0], i = list.indexOf(d);
      const before = list.slice(0, i).find(m => !m.Group), after = list.slice(i + 1).find(m => !m.Group);
      levels.push({ m: d, total: after ? 'after' : before ? 'before' : 'none', tm: after || before || null });
      list = members({ Members: d.Children });
      if (!list.length) leaves = [d];
    }
    return { levels, leaves };
  };
  const rc = chainOf(rowMs, 'row'), cc = chainOf(colMs, 'column');
  if (rc.levels.length > 8 || cc.levels.length > 8) t.approx('it has more than 8 levels of groups; the deeper levels are left out.');
  const used = new Set();
  const cellAt = (r, c) => ar.Body.Rows?.[r]?.Cells?.[c]?.Item;
  for (const L of [...rc.levels, ...cc.levels]) cx.scopes.set(L.m.Group.Name || '', L.m.Group.Name || null);
  const groupOf = (L, l, which) => {
    const m = L.m;
    const keys = (m.Group.GroupExpressions || []).map(e => ex(cx, t, e, rctx, { what: 'a group expression' })).filter(k => k !== undefined);
    /** @type {Record<string, any>} */
    const g = { expr: keys.length ? joinKeys(keys) : '=""' };
    if (m.Group.Name) g.name = m.Group.Name;
    const hv = m.Header?.Item?.Value;
    if (m.Header?.Item) used.add(m.Header.Item);
    if (isExpr(hv)) { const label = ex(cx, t, hv, rctx, { what: 'a group header' }); if (typeof label === 'string' && label !== g.expr) g.label = label; }
    const clickOf = (x) => x && action(x.Action ?? x.ActionInfo, cx, t, rctx); // a header cell's drill-through, link, bookmark jump
    const ha = clickOf(m.Header?.Item);
    if (ha) g.action = ha;
    const s = sortList(m.SortExpressions, cx, t, rctx, it.dataSet)[0];
    if (s) { g.sort = s.dir; if (s.by !== g.expr) g.sortBy = s.by; }
    if (L.total !== 'none') {
      g.total = L.total;
      if (L.tm.Header?.Item) used.add(L.tm.Header.Item);
      const tv = L.tm.Header?.Item?.Value;
      if (tv != null && !isExpr(tv) && String(tv).trim() !== 'Total') g.totalLabel = String(tv);
      const ta = clickOf(L.tm.Header?.Item);
      if (ta) g.totalAction = ta;
    }
    if (which === 'row') { const w = ar.RowHierarchy?.LevelSizes?.[l]; if (w != null) g.width = toPt(w, 110); }
    if (Array.isArray(m.Group.Filters) && m.Group.Filters.length) t.approx(`the group "${m.Group.Name}" has filters, which ReportWright groups do not support, so all its rows show.`);
    return g;
  };
  it.rowGroups = rc.levels.slice(0, 8).map((L, l) => groupOf(L, l, 'row'));
  it.columnGroups = cc.levels.slice(0, 8).map((L, l) => groupOf(L, l, 'column'));
  // drill-down: a member hidden behind a toggle makes the group above it collapsible
  for (const [ch, gs] of [[rc, it.rowGroups], [cc, it.columnGroups]]) {
    ch.levels.forEach((L, l) => {
      const v = L.m.Visibility;
      if (l > 0 && v?.ToggleItem) { gs[l - 1].collapsible = true; if (isTrue(v.Hidden)) gs[l - 1].initiallyCollapsed = true; }
      else if (v && !isFalse(v.Hidden)) t.approx('a hidden group is shown.');
    });
  }
  // values: the cells where the innermost row leaf meets each innermost column leaf
  const rLeaf = rc.leaves[0] || rowMs[0], cLeaves = cc.leaves.length ? cc.leaves : colMs.slice(0, 1);
  if (rc.leaves.length > 1) t.approx('several rows under the innermost row group are reduced to the first.');
  const ri = rLeaf ? rIdx.get(rLeaf) : 0;
  it.values = cLeaves.map((cm) => {
    const ci = cIdx.get(cm) ?? 0;
    const vi = cellAt(ri, ci);
    /** @type {Record<string, any>} */
    const v = { value: vi ? ex(cx, t, vi.Value ?? '', rctx, { what: 'its cell value' }) ?? '=Count(Fields)' : '=Count(Fields)' };
    if (vi) { used.add(vi); const f = formatOf(vi.Style?.Format); if (f) v.format = f; const va = action(vi.Action ?? vi.ActionInfo, cx, t, rctx); if (va) v.action = va; }
    if (cLeaves.length > 1 && cm.Header?.Item) { used.add(cm.Header.Item); v.label = ex(cx, t, cm.Header.Item.Value ?? '', rctx, { text: true }); }
    return v;
  });
  it.columnWidth = toPt(ar.Body.Columns[cIdx.get(cLeaves[0]) ?? 0], 64);
  // total cells: ReportWright totals use the value formulas
  const totRows = rc.levels.filter(L => L.tm).map(L => rIdx.get(L.tm)), totCols = cc.levels.filter(L => L.tm).map(L => cIdx.get(L.tm));
  for (const r of [ri, ...totRows]) for (const c of [...cLeaves.map(m => cIdx.get(m)), ...totCols]) {
    const ti = cellAt(r, c);
    if (!ti || used.has(ti)) continue;
    used.add(ti);
    const tv = translateExpression(ti.Value, { scopes: cx.scopes }).value;
    if (!it.values.some(v => v.value === tv)) t.approx(`a total cell uses ${ti.Value}; ReportWright totals use the same formula as the cells.`);
  }
  // corner: one text, or one header per row group in its last row
  const crow = ar.Corner?.[ar.Corner.length - 1] || [];
  const corner = ar.Corner?.[0]?.[0]?.Item;
  if (crow.length > 1 && it.rowGroups.length > 1) {
    crow.forEach((c, k) => { if (c?.Item && k < it.rowGroups.length) { used.add(c.Item); it.rowGroups[k].header = ex(cx, t, c.Item.Value ?? '', rctx, { text: true }); } });
  } else if (corner) { used.add(corner); it.corner = ex(cx, t, corner.Value ?? '', rctx, { text: true }); }
  const colDyn = cc.levels[0]?.m;
  const hs = colDyn?.Header?.Item ? textStyle(colDyn.Header.Item.Style, cx, t, rctx) : null;
  if (hs && Object.keys(hs).length) it.headerStyle = hs;
  const valueItem = cellAt(ri, cIdx.get(cLeaves[0]) ?? 0);
  if (valueItem) { const cs2 = textStyle(valueItem.Style, cx, t, rctx); delete cs2.format; if (Object.keys(cs2).length) it.cellStyle = cs2; }
  const tItem = totRows.length ? cellAt(totRows[0], cIdx.get(cLeaves[0]) ?? 0) : null;
  if (tItem) { const ts = textStyle(tItem.Style, cx, t, rctx); delete ts.format; if (Object.keys(ts).length) it.totalStyle = ts; }
  const rhs = rc.levels[0]?.m.Header?.Item?.Style;
  if (rhs && Object.keys(textStyle(rhs, cx, t, rctx)).length) it.style = { padding: textStyle(rhs, cx, t, rctx).padding ?? 0 };
  if (isFalse(ar.RepeatColumnHeaders)) it.repeatHeader = false;
  regionData(ar, it, cx, t, rctx, ctx);
  // count the items inside: what the matrix shows is mapped, the rest is noted
  for (const inside of tablixItems(ar)) {
    const ti = track(cx, inside);
    if (!used.has(inside) && inside.Value != null && String(inside.Value).trim() !== '') ti.approx('this cell is not shown: a ReportWright matrix shows group headers, values and totals.');
    finish(cx, ti, null);
  }
  return finish(cx, t, it);
}

/* ================================================================ list, banded list */

/** Group keys of a list level, and the same keys read from the parent row (to filter nested lists). */
function levelKeys(G, cx, t, ctx) {
  const src = (G?.GroupExpressions || []).filter(e => e != null && e !== '');
  const keys = src.map(e => ex(cx, t, e, ctx, { what: 'a group expression' })).filter(k => k !== undefined);
  const parents = src.map(e => translateExpression(e, { fields: 'Parent', scopes: cx.scopes }).value).filter(k => k !== undefined);
  if (!keys.length) return null;
  const key = joinKeys(keys);
  return { key, filter: { expr: key, op: '=', value: parents.length === keys.length ? joinKeys(parents) : key } };
}

function list(ar, cx, ctx) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'list');
  it.dataSet = ar.DataSetName || ctx.dataSet;
  const G = ar.Group ?? ar.Grouping;
  const lk = levelKeys(G, cx, t, ctx);
  if (lk) it.groupBy = lk.key;
  if (breaks(G).between || breaks(G).after) it.pageBreakBetween = true;
  if (isTrue(G?.PageBreak?.ResetPageNumber)) { it.newSection = true; delete it.pageBreakBetween; }
  const st = textStyle(ar.Style, cx, t, ctx, { box: true });
  delete st.padding;
  if (Object.keys(st).length) it.style = st;
  it.keepTogether = isTrue(ar.KeepTogether) || hasDeco(st);
  const rctx = { ...ctx, region: it.name, top: false };
  regionData(ar, it, cx, t, rctx, ctx);
  const sorts = sortList(ar.SortExpressions ?? G?.SortExpressions, cx, t, rctx, it.dataSet);
  if (sorts.length) it.sort = sorts;
  it.items = convertItems(ar.ReportItems, cx, { ...rctx, dataSet: it.dataSet, listDataSet: it.dataSet, parentFilters: lk ? [...(ctx.listDataSet === it.dataSet ? ctx.parentFilters || [] : []), lk.filter] : [] });
  return finish(cx, t, it);
}

const shiftY = (items, dy) => items.map(i => ({ ...i, y: r2(i.y + dy) }));
/** Items outside a data region read fields and aggregates from the data set of the band they came from. */
function useDataSet(items, ds) {
  for (const i of items) {
    if (['table', 'matrix', 'list', 'chart', 'subreport'].includes(i.type)) continue;
    if (!i.dataSet) i.dataSet = ds;
    if (i.items) useDataSet(i.items, ds);
  }
  return items;
}

function bandedlist(ar, cx, ctx) {
  const t = track(cx, ar);
  if (ar.__note) t.approx(ar.__note);
  const name = uniq(cx, ar.Name || 'BandedList');
  const ds = ar.DataSetName || ctx.dataSet;
  const W = toPt(ar.Width);
  const groups = (Array.isArray(ar.Groups) ? ar.Groups : []).filter(Boolean);
  const rctx = { ...ctx, region: name, dataSet: ds, top: false };
  if (ds && !cx.dsFields.has(ds)) t.note(`its data set "${ds}" is not in the file, so it shows no rows.`);
  const base = filterList(ar.Filters, cx, t, rctx, ds);
  if (ctx.listDataSet === ds && ctx.parentFilters?.length) base.unshift(...ctx.parentFilters);
  const band = (b, c) => ({ h: toPt(b?.Height), items: convertItems(b?.ReportItems, cx, c) });
  const keys = [];
  for (const g of groups) {
    const lk = levelKeys(g.Group, cx, t, rctx);
    if (!lk) t.approx('a group without a group expression is left out; its header and footer show once.');
    keys.push(lk);
  }
  const parentF = (lvl) => [...base, ...keys.slice(0, lvl).filter(Boolean).map(k => k.filter)];
  const lctx = (lvl) => ({ ...rctx, listDataSet: ds, parentFilters: parentF(lvl) });
  const det = band(ar.Details, lctx(groups.length));
  /** @type {Record<string, any>} */
  let inner = { type: 'list', name: uniq(cx, `${name}_Details`, true), x: 0, y: 0, w: W, h: det.h, dataSet: ds, items: det.items, keepTogether: isTrue(ar.Details?.KeepTogether) };
  const f0 = parentF(groups.length);
  if (f0.length) inner.filters = f0;
  const sorts = sortList(ar.SortExpressions ?? ar.Details?.SortExpressions, cx, t, rctx, ds);
  if (sorts.length) inner.sort = sorts;
  for (let lvl = groups.length - 1; lvl >= 0; lvl--) {
    const g = groups[lvl], G = g.Group || {};
    const gc = lctx(lvl + 1);
    const gh = band(g.Header, gc), gf = band(g.Footer, gc);
    if (!keys[lvl]) { inner = { ...inner, y: 0 }; continue; }
    inner.y = gh.h;
    /** @type {Record<string, any>} */
    const lst = { type: 'list', name: uniq(cx, `${name}_${G.Name || `Group${lvl + 1}`}`, true), x: 0, y: 0, w: W, h: r2(gh.h + inner.h + gf.h), dataSet: ds, groupBy: keys[lvl].key,
      items: [...gh.items, inner, ...shiftY(gf.items, gh.h + inner.h)], keepTogether: isTrue(g.KeepTogether) };
    const f = parentF(lvl);
    if (f.length) lst.filters = f;
    if (breaks(G).between || breaks(G).after) lst.pageBreakBetween = true;
    if (isTrue(g.Header?.RepeatOnNewPage)) t.approx('group headers do not repeat on each new page in ReportWright.');
    const gs = groupSort(g.SortExpressions ?? G.SortExpressions, keys[lvl].key, cx, t, rctx, `the group "${G.Name || lvl + 1}"`, ds);
    if (gs.dir || gs.rows) lst.sort = [gs.rows || { by: keys[lvl].key, dir: gs.dir }];
    const label = G.DocumentMapLabel ?? G.Label;
    const firstText = gh.items.find(i => i.type === 'textbox');
    if (label && firstText && firstText.bookmark == null) firstText.bookmark = ex(cx, t, label, rctx, { text: true });
    else if (label && !firstText) t.approx(`the document map label of the group "${G.Name}" needs a text box in the group header, so it is left out.`);
    inner = lst;
  }
  const head = band(ar.Header, rctx), foot = band(ar.Footer, rctx);
  useDataSet(head.items, ds); useDataSet(foot.items, ds);
  const hidden = visibility(ar.Visibility, cx, t, ctx);
  const pb = breaks(ar);
  /** @type {Record<string, any>} */
  let out;
  if (!head.items.length && !foot.items.length && !head.h && !foot.h) out = { ...inner, name, x: toPt(ar.Left), y: toPt(ar.Top) };
  else {
    inner.y = head.h;
    out = { type: 'container', name, x: toPt(ar.Left), y: toPt(ar.Top), w: W, h: r2(head.h + inner.h + foot.h), keepTogether: false, style: {},
      items: [...head.items, inner, ...shiftY(foot.items, head.h + inner.h)] };
  }
  if (hidden !== undefined) out.hidden = hidden;
  if (pb.before) out.pageBreakBefore = true;
  if (pb.after) out.pageBreakAfter = true;
  return finish(cx, t, out);
}

/* ================================================================ charts */

const CHART_TYPES = { column: 'column', bar: 'bar', line: 'line', area: 'area', pie: 'pie', doughnut: 'donut', donut: 'donut', scatter: 'scatter',
  bubble: 'bubble', spline: 'line', stepline: 'line', splinearea: 'area', candlestick: 'candlestick', highlowopenclose: 'ohlc', highlowclose: 'ohlc',
  funnel: 'funnel', pyramid: 'funnel', gauge: 'gauge', radar: 'radar', polar: 'polar', rangearea: 'area', rangebar: 'bar', rangecolumn: 'column',
  treemap: 'treemap', waterfall: 'waterfall', histogram: 'histogram', boxplot: 'boxplot', boxwhisker: 'boxplot' };
// ActiveReports palette names → the nearest of ReportWright's 12 named palettes
const PALETTES = { office: 'office', office2010: 'office', office2016: 'office', standard: 'default', light: 'pastel', dark: 'vivid', blue: 'ocean', cerulean: 'ocean',
  green: 'forest', orange: 'sunset', red: 'sunset', yellow: 'sunset', coral: 'sunset', pink: 'berry', purple: 'berry', violet: 'berry', grey: 'grayscale', gray: 'grayscale', grayscale: 'grayscale', cocoa: 'earth' };
const SERIES_KIND = { column: 'column', bar: 'bar', line: 'line', area: 'area', spline: 'line', splinearea: 'area', stepline: 'line', rangearea: 'area', rangebar: 'bar', rangecolumn: 'column' };

/** Line aspect → `line`: Spline is smooth, any step is ReportWright's centred step. */
function lineOf(cfg, pt, t) {
  const a = String(cfg?.LineAspect || '').toLowerCase();
  if (a === 'spline' || pt === 'spline' || pt === 'splinearea') return 'smooth';
  if (a.startsWith('step') || pt === 'stepline') {
    if (a && a !== 'stepcenter') t.approx(`its ${cfg.LineAspect} line is drawn with the step in the middle between points.`);
    return 'step';
  }
  return undefined;
}

/** An axis's settings that ReportWright can draw. */
function axisOf(a, t, which) {
  if (!a || typeof a !== 'object') return {};
  const o = {};
  const num = (v) => (v === '' || v == null || isExpr(v) || !Number.isFinite(Number(v)) ? undefined : Number(v));
  if (which !== 'x') { if (num(a.Min) != null) o.min = num(a.Min); if (num(a.Max) != null) o.max = num(a.Max); }
  if (/log/i.test(String(a.Scale || ''))) {
    o.log = true;
    if (num(a.LogBase) != null && num(a.LogBase) !== 10) t.approx(`its log axis uses base ${a.LogBase}; ReportWright uses base 10.`);
  }
  if (isTrue(a.Reversed)) o.reversed = true;
  if (which === 'x' && num(a.LabelAngle)) o.labelAngle = num(a.LabelAngle);
  const grid = typeof a.MajorGrid === 'object' && a.MajorGrid ? !isTrue(a.MajorGrid.Hidden) && a.MajorGrid.Visible !== false : a.MajorGrid;
  if (typeof grid === 'boolean') o.gridlines = grid;
  if (a.Title && !isExpr(a.Title)) o.title = String(a.Title);
  return o;
}

/** Trend lines, moving averages and reference lines/bands of a plot. */
function overlaysOf(p, t) {
  const list = p.Config?.Overlays ?? p.Overlays;
  if (!Array.isArray(list)) return [];
  const out = [];
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    const ty = String(o.Type || '').toLowerCase();
    const label = o.LegendLabel || o.Label || o.Name;
    let r = null;
    if (/moving/.test(ty)) r = { type: 'movingAverage', ...(num(o.Period) ? { period: num(o.Period) } : {}) };
    else if (/poly/.test(ty)) r = { type: 'trend', kind: 'poly', ...(num(o.Order) ? { order: num(o.Order) } : {}) };
    else if (/exp/.test(ty)) r = { type: 'trend', kind: 'exp' };
    else if (/trend|linear|power|log/.test(ty)) {
      if (/power|log/.test(ty)) t.approx(`its ${/power/.test(ty) ? 'power' : 'logarithmic'} trend line is drawn as a linear one.`);
      r = { type: 'trend' };
    } else if (/band|range/.test(ty) && num(o.Start) != null && num(o.End) != null) r = { type: 'band', from: num(o.Start), to: num(o.End) };
    else if (/line|reference/.test(ty) && num(o.Value ?? o.Start) != null) r = { type: 'line', value: num(o.Value ?? o.Start) };
    if (!r) { t.approx(`its "${o.Type}" overlay is left out.`); continue; }
    if (label && !isExpr(label) && r.type !== 'trend' && r.type !== 'movingAverage') r.label = String(label);
    out.push(r);
  }
  return out;
}

function chart(ar, cx, ctx, dv) {
  const t = track(cx, ar);
  const it = common(ar, cx, t, ctx, 'chart');
  const rctx = { ...ctx, region: it.name, top: false };
  it.dataSet = ar.DataSetName || ctx.dataSet;
  const plots = (Array.isArray(ar.Plots) ? ar.Plots : []).filter(Boolean);
  const p = plots[0] || {};
  const cfg = p.Config || {};
  if (ar.Header?.Title) it.title = ex(cx, t, ar.Header.Title, rctx, { text: true });
  it.legend = isTrue(ar.Legend?.Hidden) ? 'none' : 'bottom';
  const axes = (Array.isArray(ar.PlotArea?.Axes) ? ar.PlotArea.Axes : []).filter(a => a && typeof a === 'object');
  const yAxes = axes.filter(a => /y/i.test(String(a.AxisType || ''))), xAxis = axes.find(a => /x/i.test(String(a.AxisType || '')));
  const yAxis = yAxes[0];
  // plots bound to the second Y axis draw on ReportWright's secondary axis
  const secondary = new Set(yAxes.slice(1).flatMap(a => (Array.isArray(a.Plots) ? a.Plots : []).map(String)));
  const vf = formatOf(yAxis?.Format);
  if (vf) it.valueFormat = vf;
  if (xAxis?.Title && !isExpr(xAxis.Title)) it.xTitle = String(xAxis.Title);
  const field = (e) => { const v = e?.Field?.Value ?? e?.Field; return Array.isArray(v) ? v[0] : v; };
  const fieldsOf = (e) => { const v = e?.Field?.Value ?? e?.Field; return (Array.isArray(v) ? v : [v]).filter(x => x != null && x !== ''); };
  let type, category, seriesGroup, sortBy, sortDir, stacked = false, showValues = false;
  const series = [];
  if (dv) {
    const enc = p.Encodings || {};
    const pt = String(p.PlotChartType || 'Column').toLowerCase();
    type = CHART_TYPES[pt];
    if (!type) { type = 'column'; t.approx(`the "${p.PlotChartType}" chart type is drawn as a column chart.`); }
    if (pt === 'pyramid') t.approx('the pyramid is drawn as a funnel (widest stage first).');
    if (pt === 'gauge') {
      // the sweep picks the shape (up to 200° a half circle, up to 290° three quarters, else full); Marker and Bar pointers map
      const sw = Number(cfg.Sweep ?? cfg.SweepAngle), pk = String(cfg.PointerType || '').toLowerCase();
      if (sw > 290) it.gaugeShape = 'full'; else if (sw > 200) it.gaugeShape = 'threeQuarter';
      if (pk === 'marker') it.gaugeIndicator = 'pointer'; else if (pk === 'bar') it.gaugeIndicator = 'bar';
      t.approx(`the gauge is drawn ${it.gaugeShape ? '' : 'as a half circle '}from its first value.`);
    }
    const mode = String(cfg.AxisMode || '').toLowerCase();
    if (mode === 'polygonal' || (mode === 'radial' && (type === 'line' || type === 'area'))) type = 'radar';
    else if (mode === 'radial' && (type === 'scatter' || type === 'bubble')) type = 'polar';
    if (isTrue(cfg.Radial) && (type === 'column' || type === 'bar')) type = 'pie';
    if (type === 'pie' && Number(cfg.InnerRadius) > 0) type = 'donut';
    const perRow = type === 'scatter' || type === 'bubble' || type === 'polar';
    const details = (Array.isArray(enc.Details) ? enc.Details : []).filter(d => field(d));
    const color = field(enc.Color);
    category = field(enc.Category);
    if (type === 'pie' || type === 'donut' || type === 'funnel') category ??= field(details[0]) ?? color;
    else if (!perRow) seriesGroup = field(details[0]) ?? (color && color !== category ? color : undefined);
    if (details.length > 1) t.approx('only its first detail level splits the series.');
    stacked = /percent/i.test(String(p.PlotChartSubtype || '')) ? 'percent' : /stack/i.test(String(p.PlotChartSubtype || '')) || /stack/i.test(String(details[0]?.Group || ''));
    sortDir = enc.Category?.Sort; sortBy = enc.Category?.SortingField;
    const line = lineOf(cfg, pt, t);
    if (line) it.line = line;
    /** The series of one plot; extra = type/axis for a combo plot. */
    const seriesOf = (pl, extra) => {
      const e = pl.Encodings || {};
      const ptype = String(pl.PlotChartType || '').toLowerCase();
      (Array.isArray(e.Values) ? e.Values : []).filter(Boolean).forEach((v, i) => {
        const srcs = fieldsOf(v);
        if (!srcs.length) return;
        const agg = AGG[String(v.Aggregate || 'Sum').toLowerCase()] || (/^(none|list)$/i.test(String(v.Aggregate)) ? 'First' : null);
        if (!agg) t.approx(`the "${v.Aggregate}" aggregate is drawn as a sum.`);
        const wrap = (src) => {
          const raw = ex(cx, t, src, rctx, { what: 'a series value' });
          if (raw === undefined) return undefined;
          return AGG_RE.test(String(raw)) ? raw : `=${agg || 'Sum'}(${isExpr(raw) ? raw.slice(1) : inner(raw)})`;
        };
        const m = /^=Fields!([\w ]+)\.Value$/i.exec(String(srcs[0]).trim());
        const sr = { name: v.Caption || (m ? safeName(m[1]) : `Series ${series.length + 1}`), ...extra };
        const fin = type === 'candlestick' || type === 'ohlc';
        if (fin && !extra) {
          // high, low, open, close (HighLowClose: high, low, close)
          const keys = ptype === 'highlowclose' || srcs.length === 3 ? ['high', 'low', 'close'] : ['high', 'low', 'open', 'close'];
          if (srcs.length < keys.length) { t.approx(`its ${p.PlotChartType} plot needs ${keys.length} values; the series is left out.`); return; }
          keys.forEach((k, j) => { const w = wrap(srcs[j]); if (w !== undefined) sr[k] = w; });
        } else if (type === 'bubble' && !extra) {
          const y = wrap(srcs[0]); if (y === undefined) return;
          sr.value = y;
          const size = srcs[1] ?? field(e.Size);
          if (size != null) { const w = wrap(size); if (w !== undefined) sr.size = w; } else t.approx('it has no bubble size, so every bubble is the same size.');
        } else if (srcs.length >= 2 && !perRow && !['pie', 'donut', 'funnel', 'gauge', 'radar'].includes(type)) {
          const lo = wrap(srcs[0]), hi = wrap(srcs[1]);
          if (lo === undefined || hi === undefined) return;
          sr.low = lo; sr.high = hi;
        } else {
          const w = wrap(srcs[0]); if (w === undefined) return;
          sr.value = w;
        }
        series.push(sr);
        if (i === 0 && extra?.line) delete extra.line;
      });
    };
    seriesOf(p, null);
    if (perRow && category != null) { const xv = ex(cx, t, category, rctx, { what: 'the x value' }); if (xv !== undefined) it.xValue = xv; category = undefined; }
    // more plots: a combo chart when they share the category
    for (const pl of plots.slice(1)) {
      const kind = SERIES_KIND[String(pl.PlotChartType || '').toLowerCase()];
      if (!kind || perRow || !['column', 'bar', 'line', 'area', 'candlestick', 'ohlc'].includes(type) || String(field(pl.Encodings?.Category) ?? '') !== String(category ?? '')) {
        t.approx(`its plot "${pl.PlotName || pl.PlotChartType}" cannot be combined with the first one and is left out.`);
        continue;
      }
      const extra = { type: type === 'bar' && kind === 'column' ? 'bar' : kind };
      if (secondary.has(String(pl.PlotName))) extra.axis = 'secondary';
      const ln = lineOf(pl.Config || {}, String(pl.PlotChartType || '').toLowerCase(), t);
      if (ln) extra.line = ln;
      seriesOf(pl, extra);
    }
    if (secondary.has(String(p.PlotName)) && yAxes.length > 1) for (const sr of series.filter(x => !x.axis)) sr.axis = 'secondary';
    const tx = cfg.Text;
    showValues = !!(tx && tx.Template && !/^none$/i.test(String(tx.TextPosition || '')));
    if (showValues) {
      const pos = String(tx.TextPosition || '').toLowerCase();
      if (pos === 'inside' || pos === 'outside' || pos === 'center') it.labelPosition = pos;
      const tpl = String(tx.Template);
      if (isExpr(tpl)) { const e2 = ex(cx, t, tpl, rctx, { what: 'the label text' }); if (e2 !== undefined) it.labelTemplate = e2; }
      else if (!/^\{value\}$/i.test(tpl.trim())) {
        if ([...tpl.matchAll(/\{(\w+)\}/g)].every(m2 => /^(value|category|series|percent)$/i.test(m2[1]))) it.labelTemplate = tpl;
        else t.approx(`its label template "${tpl.slice(0, 60)}" uses fields ReportWright cannot fill; the labels show the values.`);
      }
    }
    const palName = String(ar.Palette || '').toLowerCase();
    const pal = Array.isArray(ar.CustomPalette) && /custom/i.test(String(ar.Palette || 'Custom')) ? ar.CustomPalette.map(hexColor).filter(Boolean) : [];
    if (pal.length) { if (seriesGroup || type === 'pie' || type === 'donut' || type === 'funnel') it.palette = pal; /* slices take the palette */ else series.forEach((sr, i) => { if (pal[i]) sr.color = pal[i]; }); }
    else if (palName && palName !== 'custom') { if (PALETTES[palName]) it.palette = PALETTES[palName]; else t.approx(`its "${ar.Palette}" palette is drawn with the default colours.`); }
    if (p.Action) { const a = action(p.Action, cx, t, rctx); if (a) it.pointAction = a; }
    const ovs = plots.flatMap(pl => overlaysOf(pl, t));
    if (ovs.length) it.overlays = ovs;
    const ax = { x: axisOf(xAxis, t, 'x'), y: axisOf(yAxis, t, 'y') };
    if (yAxes.length > 1 && series.some(sr => sr.axis === 'secondary')) {
      ax.y2 = axisOf(yAxes[1], t, 'y');
      const f2 = formatOf(yAxes[1].Format);
      if (f2) ax.y2.format = f2;
    }
    for (const k of Object.keys(ax)) if (!Object.keys(ax[k]).length) delete ax[k];
    if (Object.keys(ax).length) it.axes = ax;
  } else {
    if (plots.length > 1) t.approx(`only its first plot is drawn; ${plots.length - 1} more ${plots.length > 2 ? 'are' : 'is'} left out.`);
    const pt = String(p.PlotType || 'Bar').toLowerCase();
    type = pt === 'bar' ? (isTrue(cfg.SwapAxes) ? 'bar' : 'column') : CHART_TYPES[pt];
    if (!type) { type = 'column'; t.approx(`the "${p.PlotType}" chart type is drawn as a column chart.`); }
    if (type === 'bubble' || type === 'gauge' || type === 'funnel' || type === 'candlestick' || type === 'ohlc') { t.approx(`its ${p.PlotType} plot is drawn as a column chart.`); type = 'column'; }
    if (isTrue(cfg.Radial) && (type === 'column' || type === 'bar')) type = Number(cfg.InnerRadius) > 0 ? 'donut' : 'pie';
    const cg = (p.CategoryGroupings || [])[0];
    category = cg?.Grouping?.GroupExpressions?.[0];
    sortBy = cg?.Sorting?.[0]?.Value; sortDir = cg?.Sorting?.[0]?.Direction || (sortBy ? 'Ascending' : undefined);
    if ((p.CategoryGroupings || []).length > 1) t.approx('only its first category grouping is drawn.');
    const sgExpr = (p.SeriesGroupings || [])[0]?.Grouping?.GroupExpressions?.[0];
    const colorField = p.ColorSeries?.Field;
    seriesGroup = isExpr(colorField) && !AGG_RE.test(colorField) ? colorField : sgExpr;
    stacked = /100/.test(String(cfg.SeriesArrangement || '')) ? 'percent' : /stack/i.test(String(cfg.SeriesArrangement || ''));
    (Array.isArray(p.DataSeries) ? p.DataSeries : []).filter(Boolean).forEach((s2, i) => {
      const v = ex(cx, t, s2.Values?.[0]?.Value ?? '', rctx, { what: 'a series value' });
      if (v === undefined || v === '') return;
      series.push({ name: s2.Name || `Series ${i + 1}`, value: v });
      if (s2.Label?.Value != null && !/^none$/i.test(String(s2.Label.TextPosition || ''))) showValues = true;
      if (i === 0 && s2.Action) { const a = action(s2.Action, cx, t, rctx); if (a) it.pointAction = a; }
    });
    if (type === 'scatter' && category != null) { const xv = ex(cx, t, category, rctx, { what: 'the x value' }); if (xv !== undefined) it.xValue = xv; }
  }
  it.chartType = type;
  if (category != null) it.category = ex(cx, t, category, rctx, { what: 'the category' });
  if (seriesGroup != null) { const sg = ex(cx, t, seriesGroup, rctx, { what: 'the series grouping' }); if (sg !== undefined) it.seriesGroup = sg; }
  if (stacked && !['pie', 'donut', 'funnel', 'gauge', 'radar', 'scatter', 'bubble', 'polar'].includes(type)) it.stacked = stacked;
  if (showValues) it.showValues = true;
  if (series.length) it.series = series;
  if (sortBy != null || sortDir) {
    const by = sortBy != null ? ex(cx, t, sortBy, rctx, { what: 'the category sort' }) : it.category;
    const dir = /desc/i.test(String(sortDir || '')) ? 'desc' : 'asc';
    const refs = unknownRefs(by, it.dataSet, cx);
    if (refs.length) t.approx(`its categories are sorted by ${missing(refs, it.dataSet)}, so they keep the data order.`);
    else if (by !== undefined && by === it.category) it.categorySort = dir;
    else if (by !== undefined && AGG_RE.test(String(by))) t.approx(`its categories are sorted by ${by}; ReportWright sorts them by row values, so they keep the data order.`);
    else if (by !== undefined) it.sort = [{ by, dir }];
  }
  const bg = hexColor(ar.Style?.BackgroundColor);
  if (bg) it.background = bg;
  regionData(ar, it, cx, t, rctx, ctx);
  return finish(cx, t, it);
}

/* ================================================================ data */

const SQL_PROVIDERS = /^(SQL|SQLSERVER|MSSQL|OLEDB|ODBC|ORACLE|MYSQL|POSTGRES|POSTGRESQL|NPGSQL|SQLITE|DB2|SNOWFLAKE|SYBASE)/;
const CONN_KEYS = /^(endpoint|jsondata|jsondoc|xmldoc|xmldata|path|url|uri|jpath|method|body|header\$.+|query\$.+|data|locale|textqualifier|columnsseparator|rowsseparator|hasheaders|startingrow|delimiter|separator)$/i;

/** Split "a=1;b=2" at top-level semicolons (not inside {…} parts of a template), keeping unknown pieces with the previous value. */
function keyValues(str) {
  const parts = [];
  let depth = 0, quote = null, cur = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (depth) {
      if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === '{') depth++; else if (c === '}') depth--;
      cur += c; continue;
    }
    if (c === '{' && str[i + 1] === '{') { cur += '{{'; i++; continue; }
    if (c === '{') { depth = 1; cur += c; continue; }
    if (c === ';') { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  /** @type {[string, string][]} */
  const out = [];
  for (const p of parts) {
    const m = p.includes('=') ? /^\s*([A-Za-z]+(?:\$[^=]*)?)\s*=([\s\S]*)$/.exec(p) : null;
    if (m && CONN_KEYS.test(m[1])) out.push([m[1], m[2]]);
    else if (out.length) out[out.length - 1][1] += ';' + p;
  }
  return out;
}
const getKey = (kv, k) => kv.find(([key]) => key.toLowerCase() === k)?.[1];
const unescapeTpl = (s) => String(s ?? '').replace(/\{\{/g, '{').replace(/\}\}/g, '}');

/** JSONPath as written in ActiveReports ($.value.*) → the subset ReportWright reads ($.value[*]). null: not supported. */
function convertPath(p) {
  if (p == null || String(p).trim() === '' || String(p).trim() === '$') return '$';
  let s = String(p).trim();
  if (s.includes('..') || s.includes('[?') || s.includes('(@')) return null;
  if (!s.startsWith('$')) s = '$.' + s.replace(/^\./, '');
  s = s.replace(/\.\*(?=\.|\[|$)/g, '[*]');
  const ok = (x) => { try { jsonPath({}, x); return true; } catch { return false; } };
  if (ok(s)) return s;
  // names that are not identifiers: ['my-list']
  const segs = s.slice(1).split('.').filter(Boolean).map(seg => (/^[A-Za-z_$][\w$]*(\[(\d+|\*)\])*$/.test(seg) ? '.' + seg : seg === '*' ? '[*]' : `['${seg.replace(/'/g, '')}']`));
  const t = '$' + segs.join('');
  return ok(t) ? t : null;
}

const TYPE_HINT = { date: 'date', datetime: 'date', time: 'date', number: 'number', integer: 'number', int: 'number', float: 'number', decimal: 'number', double: 'number', boolean: 'boolean', bool: 'boolean', string: 'string' };

function dataPart(ar, cx) {
  const sources = [], sets = [];
  const srcNames = new Set();
  const addSource = (s) => { s.name = uniqIn(srcNames, s.name); sources.push(s); return s.name; };
  /** @type {Map<string, any>} */
  const info = new Map();
  (Array.isArray(ar.DataSources) ? ar.DataSources : []).forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const name = String(s.Name || `DataSource${i + 1}`);
    const cp = s.ConnectionProperties || {};
    const provider = String(cp.DataProvider || '').toUpperCase();
    const raw = cp.ConnectString ?? '';
    const inline = !isExpr(raw) ? /(?:^|;)\s*(jsondata|data)\s*=([\s\S]*)$/i.exec(String(raw)) : null;
    const tpl = translateExpression(raw, { text: true });
    if (!tpl.ok) cx.warn(`Data source "${name}": ${tpl.notes.join('; ')}.`);
    info.set(name, { name, provider, kv: tpl.ok ? keyValues(String(tpl.value ?? '')) : [], inline: inline?.[2], used: 0, shared: s.DataSourceReference, inlineName: null });
  });
  const dsList = (Array.isArray(ar.DataSets) ? ar.DataSets : []).filter(d => d && typeof d === 'object');
  for (const d of dsList) { const i = info.get(d.Query?.DataSourceName); if (i) i.used++; }
  /** @type {Map<string, {source: string, path: string}>} */
  const where = new Map();
  const setNames = new Set();
  const nested = [];
  dsList.forEach((d, i) => {
    const name = uniqIn(setNames, String(d.Name || `DataSet${i + 1}`));
    const srcRef = String(d.Query?.DataSourceName ?? '');
    const xml = info.get(srcRef)?.provider === 'XML'; // its field paths are XPaths
    const fields = fieldsOf(d, name, cx, xml);
    cx.dsFields.set(name, new Set(fields.map(fd => fd.name.toLowerCase())));
    /** @type {Record<string, any>} */
    const out = { name, source: '', path: '$', fields };
    const m = /^\$dataset:(.+)$/i.exec(srcRef);
    if (m) { nested.push({ out, chain: m[1].split('/') }); sets.push(out); return; }
    const src = info.get(srcRef);
    const pathOf = (jp) => {
      const p = convertPath(jp);
      if (p === null) { cx.warn(`Data set "${name}": the JSON path "${jp}" uses features ReportWright does not support (.. or filters), so it reads the whole response.`); return '$'; }
      return p;
    };
    if (!src) {
      cx.warn(`Data set "${name}": its data source "${srcRef}" is not in the file, so it has no rows.`);
      out.source = addSource({ name: srcRef || `${name}_source`, type: 'json', data: [] });
    } else if (src.shared) {
      cx.warn(`Data source "${src.name}" is a shared data source (${src.shared}); ReportWright cannot read it, so data set "${name}" has no rows until you set its source.`);
      out.source = src.inlineName ||= addSource({ name: src.name, type: 'json', data: [] });
    } else if (SQL_PROVIDERS.test(src.provider)) {
      const sql = sqlSource(d, src, name, cx);
      out.source = addSource(sql);
    } else if (src.provider === 'XML') {
      // ActiveReports: CommandText is the XPath, XmlDoc= the file or URL, XmlData= the XML. SSRS and JasperReports readers
      // pass what they read as Query.Xml ({ path, url, inline, soap })
      const x = d.Query?.Xml || {};
      const cmd = String(d.Query?.CommandText ?? '').trim();
      if (cmd.startsWith('=')) cx.warn(`Data set "${name}": its XPath is built by an expression; ReportWright needs a fixed path, so it reads the likeliest rows.`);
      out.path = x.path ?? (cmd && !cmd.startsWith('=') ? cmd : '$');
      const kvXml = getKey(src.kv, 'xmldata');
      const inline = x.inline ?? (kvXml == null ? null : unescapeTpl(kvXml));
      const url = unescapeTpl(x.url ?? getKey(src.kv, 'xmldoc') ?? getKey(src.kv, 'url') ?? getKey(src.kv, 'path') ?? '').trim();
      if (url && !/^(https?:)?\/\/|^\//i.test(url)) cx.warn(`Data source "${src.name}" reads the file "${url}"; ReportWright reads XML from a URL, so set one.`);
      if (!url && inline == null) cx.warn(`Data source "${src.name}" has no XML address or data, so data set "${name}" has no rows until you set one.`);
      const web = /^(https?:)?\/\/|^\//i.test(url) ? url : '';
      if (x.soap) out.source = addSource({ name: src.used > 1 ? `${src.name}_${name}` : src.name, type: 'soap', url: web, soapAction: x.soap.action || '', envelope: x.soap.envelope });
      else out.source = src.inlineName ||= addSource(inline != null ? { name: src.name, type: 'xml', data: String(inline) } : { name: src.name, type: 'xml', url: web });
    } else if (/^(JSON|JSONEMBED|JSONDATA|CSV|)$/.test(src.provider)) {
      const cmdT = translateExpression(d.Query?.CommandText ?? '', { text: true });
      if (!cmdT.ok) cx.warn(`Data set "${name}": its query ${cmdT.notes.join('; ')}; it reads the whole response.`);
      const cmd = cmdT.ok ? keyValues(String(cmdT.value ?? '')) : [];
      const jp = unescapeTpl(getKey(cmd, 'jpath'));
      if (/\{/.test(getKey(cmd, 'jpath') ?? '')) cx.warn(`Data set "${name}": its JSON path is built by an expression; ReportWright needs a fixed path, so it reads the whole response.`);
      if (src.inline != null) {
        if (!src.inlineName) {
          let data;
          if (src.provider === 'CSV') data = src.inline;
          else if (!src.inline.trim()) { cx.warn(`Data source "${src.name}" has no embedded data, so it has no rows.`); data = []; }
          else try { data = parseEmbedded(src.inline); } catch (e) { cx.warn(`Data source "${src.name}": its embedded JSON is not valid (${e.message}), so it has no rows.`); data = []; }
          src.inlineName = addSource(src.provider === 'CSV' ? { name: src.name, type: 'csv', data } : { name: src.name, type: 'json', data });
        }
        out.source = src.inlineName;
        out.path = src.provider === 'CSV' ? '$' : pathOf(jp || '$');
      } else {
        const base = getKey(src.kv, 'endpoint') ?? getKey(src.kv, 'jsondoc') ?? getKey(src.kv, 'path') ?? getKey(src.kv, 'url') ?? '';
        const uri = getKey(cmd, 'uri') ?? getKey(cmd, 'path') ?? '';
        let url = joinUrl(base, uri);
        const qs = [...src.kv, ...cmd].filter(([k]) => /^query\$/i.test(k)).map(([k, v]) => `${k.slice(6)}=${v}`);
        if (qs.length) url += (url.includes('?') ? '&' : '?') + qs.join('&');
        /** @type {Record<string, string>} */
        const headers = {};
        for (const [k, v] of [...src.kv, ...cmd]) if (/^header\$/i.test(k)) headers[k.slice(7)] = v;
        const secret = Object.keys(headers).find(h => /auth|token|key|secret|password|cookie/i.test(h));
        if (secret) cx.warn(`Data source "${src.name}" sends the header "${secret}"; it is copied into the report, where anyone who can open the report can read it.`);
        const method = String(getKey(cmd, 'method') || 'GET').trim().toUpperCase();
        const body = getKey(cmd, 'body');
        const sname = src.used > 1 ? `${src.name}_${name}` : src.name;
        if (!url) cx.warn(`Data set "${name}": its data source "${src.name}" has no address, so it has no rows until you set one.`);
        if (src.provider === 'CSV') {
          out.source = addSource({ name: sname, type: 'csv', url });
          const sep = getKey(src.kv, 'columnsseparator') ?? getKey(src.kv, 'delimiter') ?? getKey(src.kv, 'separator');
          if (sep && sep.trim() !== ',') cx.warn(`Data source "${src.name}": ReportWright reads CSV with commas, not "${sep}".`);
        } else {
          // a JSON body with a "query" is GraphQL; ReportWright's GraphQL source returns the "data" part
          let gql = null;
          if (method === 'POST' && body && !/\{[^{]/.test(body.replace(/\{\{|\}\}/g, ''))) { try { gql = JSON.parse(unescapeTpl(body)); } catch { gql = null; } }
          if (gql && typeof gql.query === 'string') {
            /** @type {Record<string, any>} */
            const g = { name: sname, type: 'graphql', url, query: gql.query };
            if (gql.variables) g.variables = JSON.stringify(gql.variables).replace(/[{}]/g, '$&$&');
            if (Object.keys(headers).length) g.headers = headers;
            out.source = addSource(g);
            out.path = pathOf((jp || '$').replace(/^\$\.data(?=[.[]|$)/, '$'));
          } else {
            /** @type {Record<string, any>} */
            const r = { name: sname, type: 'rest', method, url };
            if (Object.keys(headers).length) r.headers = headers;
            if (body && method !== 'GET') {
              r.body = body;
              // a JSON body written with \n outside its strings: send it as clean JSON
              if (!/\{[^{]/.test(body.replace(/\{\{|\}\}/g, ''))) { try { r.body = escText(JSON.stringify(parseEmbedded(unescapeTpl(body)))); } catch { /* not JSON: send it as it is */ } }
            }
            out.source = addSource(r);
            out.path = pathOf(jp || '$');
          }
        }
      }
    } else {
      cx.warn(`Data source "${src.name}" uses the provider "${src.provider}", which ReportWright cannot read; data set "${name}" has no rows until you set its source.`);
      out.source = src.inlineName ||= addSource({ name: src.name, type: 'json', data: [] });
    }
    const fl = filterList(d.Filters, cx, dataTracker(cx, name), { band: 'body' }, name);
    if (fl.length) out.filters = fl;
    where.set(name, { source: out.source, path: out.path });
    sets.push(out);
  });
  // nested data sets ($dataset:Orders/OrderDetails): the child arrays of every parent row, flattened
  for (const { out, chain } of nested) {
    const parent = where.get(chain[0]);
    if (!parent) {
      cx.warn(`Data set "${out.name}": its parent data set "${chain[0]}" is not in the file, so it has no rows.`);
      out.source = addSource({ name: `${out.name}_source`, type: 'json', data: [] });
      continue;
    }
    out.source = parent.source;
    out.path = convertPath(parent.path + chain.slice(1).map(c => `.${c}[*]`).join('')) || '$';
    cx.warn(`Data set "${out.name}": it lists the ${chain.slice(1).join('/')} of every ${chain[0]} row together (ReportWright has no nested data sets); filter it by the parent key if the report shows more than one ${chain[0]}.`);
  }
  return { dataSources: sources, dataSets: sets };
}

/** Embedded JSON: ActiveReports may write its line breaks and tabs as \n and \t outside the strings. */
function parseEmbedded(s) {
  try { return JSON.parse(s); } catch {
    let out = '', inStr = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) { out += c; if (c === '\\') out += s[++i] ?? ''; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      if (c === '\\' && /[nrt]/.test(s[i + 1] || '')) { out += ' '; i++; continue; }
      out += c;
    }
    return JSON.parse(out);
  }
}

function uniqIn(set, base) { let k = base, i = 2; while (set.has(k)) k = `${base}_${i++}`; set.add(k); return k; }
function joinUrl(base, uri) {
  if (!uri) return base || '';
  if (/^(https?:)?\/\//i.test(unescapeTpl(uri)) || !base) return uri;
  return base.replace(/\/+$/, '') + '/' + uri.replace(/^\/+/, '');
}
/** Warnings for data-set settings (filters, calculated fields) go to the report, not to an item. */
function dataTracker(cx, name) {
  return { name, state: 'mapped', approx: (m) => cx.warn(`Data set "${name}": ${m}`), note: (m) => cx.warn(`Data set "${name}": ${m}`), drop: (m) => cx.warn(`Data set "${name}": ${m}`) };
}

function fieldsOf(d, dsName, cx, xml = false) {
  const out = [];
  const seen = new Set();
  const t = dataTracker(cx, dsName);
  (Array.isArray(d.Fields) ? d.Fields : []).forEach((f, i) => {
    if (!f || typeof f !== 'object') return;
    const name = safeName(f.Name || f.DataField || `Field${i + 1}`);
    if (seen.has(name)) { t.approx(`two fields become "${name}"; the second is left out.`); return; }
    seen.add(name);
    if (f.DataField == null && f.Value != null) {
      const expr = ex(cx, /** @type {any} */ (t), f.Value, { band: 'body' }, { what: `the calculated field "${f.Name}"` });
      if (expr !== undefined) out.push({ name, expr });
      return;
    }
    let df = String(f.DataField ?? f.Name ?? name);
    /** @type {Record<string, any>} */
    const fd = { name };
    const hint = /^(.*?)\[(\w+)(?:\|[^\]]*)?\]$/.exec(df);
    if (hint && (!xml || TYPE_HINT[hint[2].toLowerCase()])) { df = hint[1]; if (TYPE_HINT[hint[2].toLowerCase()]) fd.type = TYPE_HINT[hint[2].toLowerCase()]; } // an XPath [1] is not a type
    if (xml) { if (df !== name) fd.path = df; } // an XPath relative to the row element
    else if (df !== name) {
      const p = convertPath(df.startsWith('$') ? df : df.split('.').length > 1 || /^[A-Za-z_$][\w$]*$/.test(df) ? df : `$['${df.replace(/'/g, '')}']`);
      if (p) fd.path = p;
      else t.approx(`the field path "${df}" is not supported, so the field "${name}" is empty.`);
    }
    out.push(fd);
  });
  const known = new Set(out.map(fd => fd.name.toLowerCase()));
  return out.filter(fd => {
    if (!fd.expr) return true;
    const refs = [...String(fd.expr).matchAll(/\bFields\.([A-Za-z_]\w*)/g)].map(m => m[1]).filter(n => !known.has(n.toLowerCase()));
    if (refs.length && !/\bLookup\s*\(/i.test(fd.expr)) { t.approx(`the calculated field "${fd.name}" uses the field "${refs[0]}", which the data set does not have, so it is left out.`); return false; }
    return true;
  });
}

function sqlSource(d, src, name, cx) {
  const conn = safeName(src.name).toLowerCase();
  let query = d.Query?.CommandText ?? '';
  if (isExpr(query)) { cx.warn(`Data set "${name}": its SQL is built by an expression; ReportWright runs fixed SQL with @parameters, so check the query.`); query = String(query).replace(/^\s*=\s*/, ''); }
  for (const p of d.Query?.QueryParameters || []) {
    const pn = String(p?.Name || '').replace(/^@/, '');
    const m = /^=\s*Parameters!(\w+)\.Value\s*$/i.exec(String(p?.Value ?? ''));
    if (m && pn) query = query.replace(new RegExp(`@${pn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), `@${safeName(m[1])}`);
    else if (pn) cx.warn(`Data set "${name}": the query parameter @${pn} is set by ${p?.Value}; ReportWright binds @name to the report parameter of that name, so add one.`);
  }
  if (/storedprocedure/i.test(String(d.Query?.CommandType || ''))) cx.warn(`Data set "${name}": it calls the stored procedure ${query}; write the call in SQL for your database (e.g. exec ${query} @param).`);
  cx.warn(`Data source "${src.name}" is a ${src.provider} database: ReportWright runs its SQL on the server, so set PW_DB_${conn.toUpperCase()}=<connection URL> there (the connection string in the file is not imported).`);
  return { name: src.used > 1 ? `${src.name}_${name}` : src.name, type: 'sql', connection: conn, query: String(query) };
}

/* ================================================================ parameters */

const PTYPE = { string: 'string', text: 'string', integer: 'number', int: 'number', float: 'number', decimal: 'number', double: 'number', number: 'number',
  boolean: 'boolean', bool: 'boolean', datetime: 'date', date: 'date' };
const coerceLit = (v, type) => {
  if (v == null) return v;
  if (type === 'number' && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (type === 'boolean' && /^(true|false)$/i.test(String(v))) return /true/i.test(String(v));
  return v;
};

function parametersOf(list, cx) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p !== 'object') continue;
    if (!p.Name) { cx.warn('A report parameter without a name was left out.'); continue; }
    const name = safeName(p.Name);
    if (seen.has(name)) continue;
    seen.add(name);
    const type = PTYPE[String(p.DataType || 'String').toLowerCase()] || 'string';
    const t = { name, state: 'mapped', approx: (m) => cx.warn(`Parameter "${p.Name}": ${m}`), note: (m) => cx.warn(`Parameter "${p.Name}": ${m}`), drop: (m) => cx.warn(`Parameter "${p.Name}": ${m}`) };
    /** @type {Record<string, any>} */
    const out1 = { name, type };
    if (p.Prompt && !isExpr(p.Prompt)) out1.prompt = String(p.Prompt);
    if (isTrue(p.MultiValue)) out1.multi = true;
    const dv = p.DefaultValue;
    let hasDefault = false;
    const vals = Array.isArray(dv?.Values) ? dv.Values.filter(v => v != null) : dv?.Values != null ? [dv.Values] : [];
    if (vals.length) {
      if (vals.some(isExpr)) {
        if (vals.length > 1) t.approx('only the first of its default values is used.');
        const v = ex(cx, /** @type {any} */ (t), vals[0], { band: 'body' }, { what: 'its default value' });
        if (v !== undefined) { out1.default = v; hasDefault = true; }
      } else {
        out1.default = out1.multi ? vals.map(String).join(',') : coerceLit(vals[0], type);
        hasDefault = true;
      }
    } else if (dv?.DataSetReference) t.approx(`its default comes from the data set "${dv.DataSetReference.DataSetName}", which ReportWright does not support; pick a value when you run the report.`);
    const vv = p.ValidValues;
    if (Array.isArray(vv?.ParameterValues) && vv.ParameterValues.length) {
      out1.options = vv.ParameterValues.filter(Boolean).map(o => ({ value: coerceLit(o.Value, type), label: String(o.Label ?? o.Value) }));
    } else if (vv?.DataSetReference?.DataSetName) {
      const r = vv.DataSetReference;
      out1.optionsFrom = { dataSet: r.DataSetName, value: `=Fields.${safeName(r.ValueField)}`, label: `=Fields.${safeName(r.LabelField || r.ValueField)}` };
    }
    if (!hasDefault && !isTrue(p.Nullable) && !isTrue(p.AllowBlank)) out1.required = true;
    if (isTrue(p.Hidden)) t.note('it is hidden in ActiveReports; ReportWright shows it in the parameter panel.');
    out.push(out1);
  }
  return out;
}

/* ================================================================ page, sections, report */


function pageOf(p, cx) {
  if (!p || typeof p !== 'object') p = {};
  const W = toPt(p.PageWidth, 612), H = toPt(p.PageHeight, 792);
  let w = W > 0 ? W : 612, h = H > 0 ? H : 792;
  const land = /landscape/i.test(String(p.PaperOrientation || p.PageOrientation || '')) || w > h;
  if (land && w < h) [w, h] = [h, w];
  const margins = [toPt(p.TopMargin), toPt(p.RightMargin), toPt(p.BottomMargin), toPt(p.LeftMargin)];
  const short = Math.min(w, h), long = Math.max(w, h);
  const size = Object.keys(PAGE_SIZES).find(k => Math.abs(PAGE_SIZES[k][0] - short) < 2 && Math.abs(PAGE_SIZES[k][1] - long) < 2);
  if (Number(p.Columns) > 1) cx.columns = { count: Math.min(6, Number(p.Columns)), gap: toPt(p.ColumnSpacing, 18) };
  /** @type {Record<string, any>} */
  const page = size ? { size, orientation: land ? 'landscape' : 'portrait', margins } : { width: w, height: h, margins };
  return { page, width: w, height: h, bodyWidth: r2(w - margins[1] - margins[3]), contentH: r2(h - margins[0] - margins[2]) };
}

/** A page header or footer. Its background becomes a shape behind its items. */
function bandSection(sec, cx, band, width) {
  if (!sec || typeof sec !== 'object') return { height: 0, items: [] };
  const height = toPt(sec.Height);
  const items = convertItems(sec.ReportItems, cx, { band, top: true });
  const bg = isExpr(sec.Style?.BackgroundColor) ? null : hexColor(sec.Style?.BackgroundColor);
  if (bg && height) items.unshift({ type: 'shape', name: uniq(cx, `${band}Background`, true), shape: 'rect', x: 0, y: 0, w: width, h: height, style: { fill: bg, stroke: 'none', strokeWidth: 0, radius: 0 } });
  /** @type {Record<string, any>} */
  const out = { height, items };
  out.printOnFirstPage = !isFalse(sec.PrintOnFirstPage ?? true);
  out.printOnLastPage = !isFalse(sec.PrintOnLastPage ?? true);
  return out;
}

const PAGE_NO = /Globals!\s*(PageNumber|TotalPages|PageNumberInSection|TotalPagesInSection|OverallPageNumber|OverallTotalPages)\b/i;

/**
 * A fixed-layout page report: the first page's items become the body (in a list when the pages repeat per record),
 * page-number text boxes go to the page header or footer, and overflow placeholders go (tables flow by themselves).
 */
function fixedPage(fp, cx, info) {
  const pages = (Array.isArray(fp.Pages) ? fp.Pages : []).filter(Boolean);
  const ds = fp.DataSetName || undefined;
  const H = info.contentH;
  const isPageNo = (ar) => String(ar?.Type || '').toLowerCase() === 'textbox' && PAGE_NO.test(String(ar.Value ?? ''));
  const first = Array.isArray(pages[0]?.ReportItems) ? pages[0].ReportItems : [];
  const pn = first.filter(isPageNo), rest = first.filter(a => !isPageNo(a));
  const foot = pn.filter(a => toPt(a.Top) >= H / 2), head = pn.filter(a => toPt(a.Top) < H / 2);
  const footTop = foot.length ? Math.min(...foot.map(a => toPt(a.Top))) : H;
  const headH = head.length ? Math.max(...head.map(a => toPt(a.Top) + toPt(a.Height))) : 0;
  const lctx = { band: 'body', top: !ds, dataSet: ds, listDataSet: ds, parentFilters: [] };
  const header = { height: r2(headH), items: convertItems(head, cx, { band: 'pageHeader', top: true }) };
  const footer = { height: foot.length ? r2(H - footTop) : 0, items: shiftY(convertItems(foot, cx, { band: 'pageFooter', top: true }), -footTop) };
  let items = shiftY(convertItems(rest, cx, lctx), -headH).map(i => (i.y < 0 ? { ...i, y: 0 } : i));
  // later pages: overflow placeholders and repeated page numbers are covered; anything else prints once after page 1's content
  const shown = new Set(pn.map(a => String(a.Value)));
  const later = [];
  for (const pg of pages.slice(1)) {
    for (const ar of Array.isArray(pg.ReportItems) ? pg.ReportItems : []) {
      if (isPageNo(ar) && shown.has(String(ar.Value))) { const t = track(cx, ar); t.approx('it repeats the page number that the page footer already shows.'); finish(cx, t, null); continue; }
      later.push(ar);
    }
  }
  if (later.length) {
    const conv = convertItems(later, cx, { ...lctx, top: false });
    if (conv.length) {
      cx.warn(`Items on page 2 and later of the fixed layout (${conv.map(i => i.name).join(', ')}) print once, after page 1's content, instead of on every page.`);
      const bottom = Math.max(0, ...items.map(i => i.y + i.h));
      items.push({ type: 'container', name: uniq(cx, 'LaterPages', true), x: 0, y: r2(bottom), w: info.bodyWidth, h: r2(Math.max(0, ...conv.map(i => i.y + i.h))), pageBreakBefore: true, keepTogether: false, style: {}, items: conv });
    }
  }
  if (ds) {
    const bottom = Math.max(0, ...items.map(i => i.y + i.h));
    /** @type {Record<string, any>} */
    const lst = { type: 'list', name: uniq(cx, 'Pages', true), x: 0, y: 0, w: info.bodyWidth, h: r2(bottom), dataSet: ds, pageBreakBetween: true, keepTogether: false, items };
    const lk = levelKeys(fp.Group, cx, dataTracker(cx, ds), { band: 'body' });
    if (lk) lst.groupBy = lk.key;
    items = [lst];
  }
  return { header, footer, items };
}

/** Group, region and data set names → the ReportWright scope that aggregates use (null: the current scope). */
function collectScopes(ar, cx) {
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const type = String(o.Type || '').toLowerCase();
    if (o.Name && typeof o.Name === 'string' && type) cx.reserved.add(o.Name);
    if (o.Name && ['table', 'tablix', 'list', 'chart', 'dvchart'].includes(type)) cx.scopes.set(o.Name, type.includes('chart') ? null : o.Name);
    if (o.Name && type === 'bandedlist') {
      cx.scopes.set(o.Name, o.DataSetName || null);
      // running values and row numbers count the rows shown: the list of its detail rows (named as bandedlist() names it)
      const det = (o.Groups || []).length ? `${o.Name}_Details` : o.Name;
      cx.runScopes.set(o.Name, det);
      for (const g of o.Groups || []) if (g?.Group?.Name) cx.runScopes.set(g.Group.Name, det);
    }
    if (type === 'table') for (const g of o.TableGroups || []) { const G = g?.Group || g?.Grouping; if (G?.Name) cx.scopes.set(G.Name, G.Name); }
    if (type === 'bandedlist') for (const g of o.Groups || []) if (g?.Group?.Name) cx.scopes.set(g.Group.Name, null);
    if (type === 'list' && o.Group?.Name) cx.scopes.set(o.Group.Name, null);
    if (type === 'tablix') {
      const m = (ms) => { for (const x of ms || []) { if (x?.Group?.Name) cx.scopes.set(x.Group.Name, isDyn(x) ? x.Group.Name : null); m(x?.Children); } };
      m(o.RowHierarchy?.Members); m(o.ColumnHierarchy?.Members);
    }
    if (type.includes('chart')) {
      for (const p of o.Plots || []) for (const g of [...(p?.CategoryGroupings || []), ...(p?.SeriesGroupings || [])]) if (g?.Grouping?.Name) cx.scopes.set(g.Grouping.Name, null);
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  walk(ar);
  for (const d of Array.isArray(ar.DataSets) ? ar.DataSets : []) if (d?.Name) cx.scopes.set(d.Name, d.Name);
}

function convertReport(ar, cx, opts) {
  const name = String(opts.name || ar.Name || 'Imported report');
  for (const img of Array.isArray(ar.EmbeddedImages) ? ar.EmbeddedImages : []) {
    if (!img?.Name || !img.ImageData || cx.images.has(img.Name)) continue;
    // stored once in "images" and referenced by name: a large image used by many items is not copied into each
    const key = /^(__proto__|constructor|prototype)$/.test(String(img.Name)) ? `_${img.Name}` : String(img.Name);
    cx.imageData[key] = `data:${img.MIMEType || 'image/png'};base64,${String(img.ImageData).replace(/\s+/g, '')}`;
    cx.images.set(img.Name, `embedded:${key}`);
  }
  collectScopes(ar, cx);
  const lang = typeof ar.Language === 'string' && !isExpr(ar.Language) && /^[a-z]{2}(-[A-Za-z]{2,4})?$/i.test(ar.Language) ? ar.Language : 'en-US';
  const sections = Array.isArray(ar.ReportSections) ? ar.ReportSections.filter(s => s && typeof s === 'object') : [];
  const sec0 = sections[0];
  const pinfo = pageOf(sec0?.Page || ar.Page, cx);
  const parameters = parametersOf(ar.ReportParameters, cx);
  for (const p of parameters) cx.params.add(p.name.toLowerCase());
  const { dataSources, dataSets } = dataPart(ar, cx);
  const layers = layersOf(ar, cx);
  const parts = partsOf(ar, cx);
  const master = ar.MasterReport ? reportId(ar.MasterReport) : undefined;
  if (master) cx.warn(`The report uses the master report "${ar.MasterReport}": import it too and save it as the report "${master}". Its page header, footer and items frame this report; the body goes in its first content placeholder.`);
  const fnHint = 'Rewrite reusable formulas as report functions ("functions", written in the expression language and called as Code.Name(…)).';
  if (ar.Code) cx.warn(`The report has custom code (Code); ReportWright does not run JavaScript, and expressions that call it are shown as text. ${fnHint}`);
  if (Array.isArray(ar.CustomCodeBlocks) && ar.CustomCodeBlocks.length) cx.warn(`The report has custom code; ReportWright does not run JavaScript. ${fnHint}`);

  let header, footer, bodyItems = [], bodyH = 0;
  const fixed = sec0?.FixedPage || (String(sec0?.Type || '').toLowerCase() === 'fixedpage' ? sec0 : null) || (!sec0 && ar.FixedPage);
  if (fixed && Array.isArray(fixed.Pages)) {
    const f = fixedPage(fixed, cx, pinfo);
    header = { ...f.header, printOnFirstPage: true, printOnLastPage: true };
    footer = { ...f.footer, printOnFirstPage: true, printOnLastPage: true };
    bodyItems = f.items;
    bodyH = Math.max(0, ...bodyItems.map(i => i.y + i.h));
  } else {
    const src = sec0 || ar;
    header = bandSection(src.PageHeader, cx, 'pageHeader', pinfo.bodyWidth);
    footer = bandSection(src.PageFooter, cx, 'pageFooter', pinfo.bodyWidth);
    bodyItems = convertItems(src.Body?.ReportItems, cx, { band: 'body', top: true });
    bodyH = toPt(src.Body?.Height);
  }
  // more sections: body sections, each with its own page setup; the first section's header and footer are used
  const more = [];
  for (const [k, s] of sections.slice(1).entries()) {
    if (s.PageHeader?.ReportItems?.length || s.PageFooter?.ReportItems?.length) cx.warn(`Section ${k + 2} has its own page header or footer; ReportWright uses the first section's for every page.`);
    const sp = s.Page ? pageOf(s.Page, cx) : pinfo;
    const f = s.FixedPage || (String(s.Type || '').toLowerCase() === 'fixedpage' ? s : null);
    const its = f?.Pages ? fixedPage(f, cx, sp).items : convertItems(s.Body?.ReportItems, cx, { band: 'body', top: true });
    const h = Math.max(toPt(s.Body?.Height), ...its.map(i => i.y + i.h), 0);
    /** @type {Record<string, any>} */
    const b = { name: s.Name || `Section${k + 2}`, height: r2(h), items: its };
    if (JSON.stringify(sp.page) !== JSON.stringify(pinfo.page)) b.page = sp.page;
    more.push(b);
  }
  // ReportWright needs room for the body between the header and the footer
  if (pinfo.contentH - header.height - footer.height < 24) {
    cx.warn('The page header and footer leave no room for the body; they were made shorter.');
    const room = Math.max(0, pinfo.contentH - 24);
    const scale = room / Math.max(1, header.height + footer.height);
    header.height = r2(header.height * scale); footer.height = r2(footer.height * scale);
  }
  /** @type {Record<string, any>} */
  const body = { height: r2(Math.max(bodyH, ...bodyItems.map(i => i.y + i.h), 0)), items: bodyItems };
  if (cx.columns) body.columns = cx.columns;
  if (more.length) body.name = sec0?.Name || 'Section1';
  return {
    $schema: 'pagewright/report@1',
    name,
    locale: lang,
    ...(currencyOf(lang) ? { currency: currencyOf(lang) } : {}), // the Language's country; none for a bare "fr"
    page: pinfo.page,
    parameters,
    dataSources,
    dataSets,
    styles: { base: { fontFamily: 'Inter', fontSize: 10, color: '#000000', padding: 0 } },
    ...(Object.keys(cx.imageData).length ? { images: cx.imageData } : {}),
    ...(master ? { master } : {}),
    ...(layers.length || cx.extraLayers.length ? { layers: [...layers, ...cx.extraLayers] } : {}),
    ...(parts.length ? { parts } : {}),
    sections: { pageHeader: header, body: more.length ? [body, ...more] : body, pageFooter: footer },
  };
}

/**
 * Convert an ActiveReportsJS report (.rdlx-json: an object, or its text, with or without a BOM).
 * @param {any} input
 * @param {{ name?: string }} [opts] name: the report name (e.g. from the file name); default: the report's Name
 * @returns {{ definition: any, warnings: string[], stats: { items: number, mapped: number, approximated: number, dropped: number } }}
 */
export function importRdlx(input, opts = {}) {
  const cx = newContext();
  let ar = input;
  if (typeof ar === 'string') {
    const s = ar.replace(/^﻿/, '').trim();
    try { ar = JSON.parse(s); } catch (e) {
      cx.warn(`The file is not valid JSON (${e instanceof Error ? e.message : e}), so the report is empty.`);
      ar = {};
    }
  }
  if (!ar || typeof ar !== 'object' || Array.isArray(ar)) {
    if (input != null && typeof input !== 'string') cx.warn('The file is not an ActiveReports report, so the report is empty.');
    else if (input == null) cx.warn('Nothing to import, so the report is empty.');
    ar = {};
  }
  let definition;
  try {
    definition = convertReport(ar, cx, opts);
    if (outputTooLarge(definition)) throw new ImportBudgetError(`the converted report would be larger than ${OUTPUT_LIMITS.chars / 1e6} million characters`);
  } catch (e) {
    if (e instanceof ImportBudgetError) {
      const error = `The report is too large to import: ${e.message}`;
      return { definition: convertReport({}, newContext(), opts), warnings: [`${error}.`], stats: { items: 0, mapped: 0, approximated: 0, dropped: 0 }, error };
    }
    cx.warn(`The import stopped early (${e instanceof Error ? e.message : e}), so parts of the report are missing.`);
    definition = convertReport({}, newContext(), opts);
  }
  return { definition, warnings: cx.warnings, stats: cx.stats };
}
