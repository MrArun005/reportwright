// @ts-check
/**
 * Java and ICU number and date patterns, for imported reports. JasperReports formats with java.text (DecimalFormat,
 * SimpleDateFormat), BIRT with ICU4J; their patterns are not .NET format strings, and translating them loses what
 * .NET cannot say (the day number "u", hours "k" and "K", per-mille scaling, the pattern's own grouping, a locale's
 * native digits, half-even rounding of the exact binary value). So the importers keep the pattern and the engine
 * formats it as the source engine does:
 *
 *   "java:<pattern>"  java.text: DecimalFormat rounds the exact binary value half to even; the pattern's decimals
 *                     stand for a currency (¤) too.
 *   "icu:<pattern>"   ICU4J (BIRT): rounds the shortest decimal form of the value ("{RoundingMode=HALF_UP}" picks the
 *                     mode); ¤ takes the currency's own decimals and a space before letters (CLDR currency spacing).
 *   "java:" / "icu:"  no pattern: String.valueOf (Double.toString: 2.0, 1.0E7; true/false; Date.toString), or BIRT's
 *                     unformatted value (shortest digits, the locale's decimal sign; medium date + short time).
 *   "icu:@date=short|medium|long|full[;time=short|medium|long|full]", "icu:@time=…": ICU's date and time styles.
 *
 * Symbols, names and digits come from Intl (the same CLDR data Java 9+ and ICU4J use), in the report's locale and
 * time zone. A pattern letter neither knows is dropped (ICU) or kept as text.
 */
import { toWall, currencyOf } from './format.js';
import { capText, capPattern, capDigits, ExprError } from './parser.js';

const cache = new Map();
const memo = (key, make) => { let v = cache.get(key); if (v === undefined) { v = make(); if (cache.size >= 500) cache.clear(); cache.set(key, v); } return v; };

/** The locale's number symbols and digits (its default numbering system, as Java and ICU use). */
function symbols(locale) {
  return memo(`s\u0001${locale}`, () => {
    const s = { digits: '0123456789', dec: '.', grp: ',', minus: '-', percent: '%', exp: 'E', expMinus: '-', inf: '∞', nan: 'NaN', perMille: '‰', latnDec: '.' };
    try {
      const nf = new Intl.NumberFormat(locale, { useGrouping: false });
      s.digits = [...'0123456789'].map(d => nf.format(Number(d))).join('');
      // a sign keeps the bidi mark CLDR writes next to it (ar: U+061C before "-", after "٪"), as Java and ICU print it
      const BIDI = /^[\u061c\u200e\u200f]+$/;
      const parts = (f, v) => f.formatToParts(v);
      const signed = (ps, type) => { const i = ps.findIndex(p => p.type === type); if (i < 0) return null; return (i > 0 && BIDI.test(ps[i - 1].value) ? ps[i - 1].value : '') + ps[i].value + (BIDI.test(ps[i + 1]?.value || '') ? ps[i + 1].value : ''); };
      const np = parts(new Intl.NumberFormat(locale), -12345.5);
      for (const p of np) { if (p.type === 'decimal') s.dec = p.value; else if (p.type === 'group') s.grp = p.value; }
      s.minus = signed(np, 'minusSign') ?? '-';
      s.percent = signed(parts(new Intl.NumberFormat(locale, { style: 'percent' }), 0.5), 'percentSign') ?? '%';
      const ep = parts(new Intl.NumberFormat(locale, { notation: 'scientific' }), -1.5e-5);
      s.exp = ep.find(p => p.type === 'exponentSeparator')?.value ?? 'E';
      s.expMinus = signed(ep, 'exponentMinusSign') ?? '-';
      s.inf = nf.format(Infinity); s.nan = nf.format(NaN);
      for (const p of new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).formatToParts(1.5)) if (p.type === 'decimal') s.latnDec = p.value;
      if (s.digits[0] === '\u0660') s.perMille = '\u0609'; // Arabic-Indic digits: the Arabic per-mille sign ؉
    } catch { /* en-US */ }
    if (s.digits.length !== 10) s.digits = '0123456789';
    return s;
  });
}
const localDigits = (str, sy) => (sy.digits === '0123456789' ? str : str.replace(/[0-9]/g, d => sy.digits[Number(d)]));

/** The report locale's currency: its symbol and its decimals. */
function currency(locale, iso) {
  return memo(`c\u0001${locale}\u0001${iso}`, () => {
    try {
      const f = new Intl.NumberFormat(locale, { style: 'currency', currency: iso });
      const ps = f.formatToParts(1), i = ps.findIndex(p => p.type === 'currency');
      // the symbol with the bidi mark CLDR puts after it (ar: "ر.س." + U+200F)
      const sym = i < 0 ? iso : ps[i].value + (/^[\u200e\u200f\u061c]+$/.test(ps[i + 1]?.value || '') ? ps[i + 1].value : '');
      return { sym, iso, digits: f.resolvedOptions().maximumFractionDigits ?? 2 };
    } catch { return { sym: iso, iso, digits: 2 }; }
  });
}

/* ------------------------------------------------------------------ exact decimal digits */

/** A finite double ≥ 0 as an exact decimal: value = M / 10^s (BigInt M). */
function exact(x) {
  if (x === 0) return { M: 0n, s: 0 };
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e = be - 1075;
  if (be === 0) e = -1074; else m |= 1n << 52n;
  if (e >= 0) return { M: m << BigInt(e), s: 0 };
  return { M: m * 5n ** BigInt(-e), s: -e };
}
/** The shortest decimal that reads back as x (as ICU, JavaScript and Double.toString take a double). */
function shortest(x) {
  if (x === 0) return { M: 0n, s: 0 };
  const [mant, ex] = x.toExponential().split('e');
  const digits = mant.replace('.', '');
  return { M: BigInt(digits), s: digits.length - 1 - Number(ex) };
}
const P10 = (n) => 10n ** BigInt(n);
/** Round M/10^s to f decimals. mode: HALF_EVEN, HALF_UP, HALF_DOWN, UP, DOWN, CEILING, FLOOR. */
function roundTo(d, f, mode, neg) {
  if (d.s <= f) return { M: d.M * P10(f - d.s), s: f };
  const k = P10(d.s - f), q = d.M / k, r = d.M % k, half = k / 2n;
  let up;
  switch (mode) {
    case 'HALF_UP': up = r >= half; break;
    case 'HALF_DOWN': up = r > half; break;
    case 'UP': up = r > 0n; break;
    case 'DOWN': up = false; break;
    case 'CEILING': up = r > 0n && !neg; break;
    case 'FLOOR': up = r > 0n && neg; break;
    default: up = r > half || (r === half && q % 2n === 1n);
  }
  return { M: up ? q + 1n : q, s: f };
}
const digitCount = (M) => (M === 0n ? 0 : M.toString().length);

/* ------------------------------------------------------------------ DecimalFormat */

/** Affix text → parts: literal text, or the tokens % ‰ ¤ - */
function affix(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") {
      const e = text.indexOf("'", i + 1);
      if (e === i + 1) { out.push("'"); i++; continue; }
      out.push(e < 0 ? text.slice(i + 1) : text.slice(i + 1, e));
      i = e < 0 ? text.length : e;
      continue;
    }
    if (c === '¤') { let n = 1; while (text[i + n] === '¤') n++; out.push({ t: n >= 2 ? 'iso' : 'cur' }); i += n - 1; continue; }
    if (c === '%' || c === '‰' || c === '-' || c === '‰') { out.push({ t: c === '-' ? 'minus' : c === '%' ? 'pct' : 'mille' }); continue; }
    out.push(c);
  }
  return out;
}

/** A DecimalFormat pattern, read once. */
function numberPattern(pat) {
  return memo(`n\u0001${pat}`, () => {
    let mode = 'HALF_EVEN';
    pat = pat.replace(/\{RoundingMode=([A-Z_]+)\}/, (_, m) => { mode = m; return ''; });
    const split = (s) => {
      // prefix | number (# 0 , . and an E0 exponent) | suffix, outside quotes
      let q = false, start = -1;
      for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === "'") { q = !q; continue; } if (!q && '#0,.'.includes(c)) { start = i; break; } }
      if (start < 0) return { prefix: s, num: '', suffix: '' };
      let end = start;
      while (end < s.length && '#0,.'.includes(s[end])) end++;
      if (s[end] === 'E') { let k = end + 1; if (s[k] === '+') k++; if (s[k] === '0') { while (s[k] === '0') k++; end = k; } }
      return { prefix: s.slice(0, start), num: s.slice(start, end), suffix: s.slice(end) };
    };
    const [posText, negText] = (() => { let q = false; for (let i = 0; i < pat.length; i++) { if (pat[i] === "'") q = !q; else if (!q && pat[i] === ';') return [pat.slice(0, i), pat.slice(i + 1)]; } return [pat, null]; })();
    const pos = split(posText);
    const num = pos.num;
    const ei = num.indexOf('E');
    const mant = ei >= 0 ? num.slice(0, ei) : num;
    const expPart = ei >= 0 ? num.slice(ei + 1) : null;
    const di = mant.indexOf('.');
    const intPart = di >= 0 ? mant.slice(0, di) : mant, fracPart = di >= 0 ? mant.slice(di + 1) : '';
    let zeros = (intPart.match(/0/g) || []).length, hashes = (intPart.match(/#/g) || []).length;
    let minFrac = (fracPart.match(/0/g) || []).length, maxFrac = (fracPart.match(/[0#]/g) || []).length;
    // JDK: "#.##" (no zero digit, a decimal point) is read as "0.##"
    if (zeros === 0 && hashes > 0 && di >= 0) { zeros = 1; hashes--; }
    const commas = [];
    for (let i = 0, d = 0; i < intPart.length; i++) { if (intPart[i] === ',') commas.push(d); else d++; }
    const intDigits = zeros + hashes;
    const grouping = commas.length ? intDigits - commas[commas.length - 1] : 0;
    const secondary = commas.length > 1 ? commas[commas.length - 1] - commas[commas.length - 2] : 0;
    const pa = affix(pos.prefix), sa = affix(pos.suffix);
    const all = [...pa, ...sa];
    const mult = all.some(x => typeof x === 'object' && x.t === 'pct') ? 2 : all.some(x => typeof x === 'object' && x.t === 'mille') ? 3 : 0;
    const neg = negText != null ? split(negText) : null;
    for (const n of [intDigits, maxFrac, (expPart?.match(/0/g) || []).length]) capDigits('Format', n);
    return {
      mode, minInt: zeros, maxInt: expPart != null ? intDigits : Infinity, minFrac, maxFrac, grouping, secondary,
      exp: expPart != null ? { plus: expPart.startsWith('+'), min: (expPart.match(/0/g) || []).length || 1 } : null,
      prefix: pa, suffix: sa, negPrefix: neg ? affix(neg.prefix) : null, negSuffix: neg ? affix(neg.suffix) : null,
      mult, cur: all.some(x => typeof x === 'object' && (x.t === 'cur' || x.t === 'iso')),
    };
  });
}

const renderAffix = (parts, sy, cur) => parts.map(p => (typeof p === 'string' ? p : p.t === 'pct' ? sy.percent : p.t === 'mille' ? sy.perMille : p.t === 'minus' ? sy.minus : p.t === 'iso' ? cur.iso : cur.sym)).join('');

/** Group an integer digit string as the pattern says (ICU also honours a secondary size: #,##,##0). */
function group(int, size, secondary, sep) {
  if (!size || int.length <= size) return int;
  const head = int.slice(0, -size), tail = int.slice(-size);
  const s2 = secondary || size;
  const parts = [];
  for (let i = head.length; i > 0; i -= s2) parts.unshift(head.slice(Math.max(0, i - s2), i));
  return [...parts, tail].join(sep);
}

/** @param {number} v @param {string} pat @param {string} locale @param {boolean} icu */
function formatNumber(v, pat, locale, icu) {
  const sy = symbols(locale);
  const p = numberPattern(pat);
  const neg = v < 0 || Object.is(v, -0);
  const iso = currencyOf(locale) || 'USD';
  const cur = currency(locale, iso);
  let minFrac = p.minFrac, maxFrac = p.maxFrac;
  if (icu && p.cur && !p.exp) { minFrac = cur.digits; maxFrac = cur.digits; } // ICU: a currency pattern uses the currency's decimals
  let body;
  if (!Number.isFinite(v)) body = Number.isNaN(v) ? sy.nan : sy.inf;
  else {
    const a = Math.abs(v);
    // Java multiplies the double (0.125 × 100); ICU shifts the decimal form
    const d0 = icu ? shortest(a) : exact(p.mult ? a * 10 ** p.mult : a);
    const d = icu && p.mult ? { M: d0.M, s: d0.s - p.mult } : d0;
    body = p.exp ? sci(d, p, minFrac, maxFrac, sy, neg) : fixed(d, p, minFrac, maxFrac, sy, neg);
  }
  if (Number.isNaN(v)) return body;
  let pre, suf;
  if (neg && p.negPrefix) { pre = renderAffix(p.negPrefix, sy, cur); suf = renderAffix(p.negSuffix || [], sy, cur); }
  else { pre = (neg ? sy.minus : '') + renderAffix(p.prefix, sy, cur); suf = renderAffix(p.suffix, sy, cur); }
  if (icu && p.cur) { // CLDR currency spacing: a symbol that ends (or starts) with a letter gets a no-break space next to the digits
    const notSym = (ch) => ch && !/[\p{S}\s]/u.test(ch);
    const last = pre.replace(/[‎‏؜]+$/, '').slice(-1), first = suf.replace(/^[‎‏؜]+/, '')[0];
    if (p.prefix.some(x => typeof x === 'object' && (x.t === 'cur' || x.t === 'iso')) && notSym(last)) pre += ' ';
    if (p.suffix.some(x => typeof x === 'object' && (x.t === 'cur' || x.t === 'iso')) && notSym(first) && !/^\s/.test(suf)) suf = ' ' + suf;
  }
  return pre + body + suf;
}

function fixed(d, p, minFrac, maxFrac, sy, neg) {
  const r = roundTo(d, maxFrac, p.mode, neg);
  let s = r.M.toString().padStart(r.s + 1, '0');
  let int = s.slice(0, s.length - r.s), frac = s.slice(s.length - r.s);
  frac = frac.replace(/0+$/, '');
  if (frac.length < minFrac) frac = frac.padEnd(minFrac, '0');
  int = int.replace(/^0+/, '');
  if (int.length < p.minInt) int = int.padStart(p.minInt, '0');
  if (!int && !frac) int = '0'; // JDK: no digits at all prints a zero
  const g = group(int, p.grouping, p.secondary, '\u0000');
  return localDigits(g, sy).replace(/\u0000/g, sy.grp) + (frac ? sy.dec + localDigits(frac, sy) : '');
}

/** E notation as JDK DecimalFormat: maxInt + maxFrac significant digits; maxInt > minInt repeats the exponent (##0 → multiples of 3) */
function sci(d, p, minFrac, maxFrac, sy, neg) {
  const maxInt = p.maxInt === Infinity ? p.minInt : p.maxInt;
  const sig = Math.max(1, maxInt + maxFrac);
  let M = d.M, s = d.s;
  let exponent = 0, intDigits;
  if (M === 0n) { exponent = 0; intDigits = Math.max(1, p.minInt); M = 0n; }
  else {
    // round to `sig` significant digits first
    const n = digitCount(M);
    if (n > sig) { const r = roundTo({ M, s: n - 1 }, sig - 1, p.mode, neg); M = r.M; s = s - (n - 1) + (sig - 1); }
    const n2 = digitCount(M);
    const decimalAt = n2 - s; // the value is 0.digits × 10^decimalAt
    if (maxInt > 1 && maxInt > p.minInt) {
      exponent = decimalAt >= 1 ? Math.trunc((decimalAt - 1) / maxInt) * maxInt : Math.trunc((decimalAt - maxInt) / maxInt) * maxInt; // Java int division
      intDigits = decimalAt - exponent;
    } else { exponent = decimalAt - Math.max(1, p.minInt); intDigits = Math.max(1, p.minInt); }
  }
  let digits = M === 0n ? '' : M.toString().replace(/0+$/, '');
  const minDigits = p.minInt + minFrac;
  const total = Math.max(digits.length, minDigits, intDigits);
  digits = digits.padEnd(total, '0');
  const int = digits.slice(0, intDigits).padEnd(intDigits, '0');
  let frac = digits.slice(intDigits);
  if (frac.length > minFrac) frac = frac.replace(/0+$/, '').padEnd(minFrac, '0');
  const e = String(Math.abs(exponent)).padStart(p.exp.min, '0');
  const es = exponent < 0 ? sy.expMinus : p.exp.plus ? '+' : '';
  return localDigits(int, sy) + (frac ? sy.dec + localDigits(frac, sy) : '') + sy.exp + es + localDigits(e, sy);
}

/** Double.toString: shortest digits; "2.0"; 1.0E7 and 1.0E-4 outside [10^-3, 10^7) */
export function javaDouble(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e7) { const s = String(x); return s.includes('.') ? s : `${s}.0`; }
  const [m, e] = x.toExponential().split('e');
  return `${m.includes('.') ? m : `${m}.0`}E${Number(e)}`;
}

/* ------------------------------------------------------------------ SimpleDateFormat */

const dtf = (locale, opts) => memo(`d\u0001${locale}\u0001${JSON.stringify(opts)}`, () => { try { return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }); } catch { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }); } });
const part = (locale, opts, w, type) => dtf(locale, opts).formatToParts(w).find(p => p.type === type)?.value ?? '';
/** Week rules (first day 1 = Monday … 7 = Sunday, minimal days in week 1) */
function weekInfo(locale) {
  return memo(`w\u0001${locale}`, () => {
    try { const L = /** @type {any} */ (new Intl.Locale(locale)); const w = L.getWeekInfo?.() || L.weekInfo; if (w) return { first: w.firstDay, min: w.minimalDays }; } catch { /* default */ }
    return { first: 7, min: 1 };
  });
}
const DAY_MS = 86400000;
function weekOf(w, info) {
  // days since the week's first day, for the wall date and for 1 January
  const dow = (x) => (((x.getUTCDay() || 7) - info.first + 7) % 7);
  const y = w.getUTCFullYear();
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const doy = Math.round((Date.UTC(y, w.getUTCMonth(), w.getUTCDate()) - jan1.getTime()) / DAY_MS);
  const offset = dow(jan1); // days of week 1's start before 1 January
  const firstWeekStart = 7 - offset >= info.min ? -offset : 7 - offset;
  let week = Math.floor((doy - firstWeekStart) / 7) + 1, wy = y;
  if (week < 1) { const prev = weekOf(new Date(Date.UTC(y - 1, 11, 31)), info); return prev; }
  const nextJan1 = new Date(Date.UTC(y + 1, 0, 1));
  const nOff = dow(nextJan1);
  const nextStart = Math.round((nextJan1.getTime() - jan1.getTime()) / DAY_MS) + (7 - nOff >= info.min ? -nOff : 7 - nOff);
  if (doy >= nextStart) { week = 1; wy = y + 1; }
  return { week, year: wy };
}

/**
 * @param {Date} d @param {string} pat @param {string} locale @param {string|undefined} tz @param {boolean} icu
 */
function formatDatePattern(d, pat, locale, tz, icu) {
  const sy = symbols(locale);
  const w = new Date(toWall(d, tz));
  const num = (n, width) => localDigits(String(n).padStart(width, '0'), sy);
  let out = '';
  for (let i = 0; i < pat.length;) {
    const c = pat[i];
    if (c === "'") {
      if (pat[i + 1] === "'") { out += "'"; i += 2; continue; }
      const e = pat.indexOf("'", i + 1);
      const lit = e < 0 ? pat.slice(i + 1) : pat.slice(i + 1, e);
      out += lit.replace(/''/g, "'");
      i = e < 0 ? pat.length : e + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(c)) { out += c; i++; continue; }
    let n = 1;
    while (pat[i + n] === c) n++;
    i += n;
    capDigits('Format', n);
    out += field(c, n);
  }
  return out;

  function field(c, n) {
    const h = w.getUTCHours();
    switch (c) {
      case 'G': return part(locale, { era: n >= 4 ? 'long' : 'short', year: 'numeric' }, w, 'era');
      case 'y': case 'Y': case 'u': {
        if (c === 'u' && !icu) return num(w.getUTCDay() || 7, n); // Java: day number of the week, 1 = Monday
        const y = c === 'Y' ? weekOf(w, weekInfo(locale)).year : w.getUTCFullYear();
        return n === 2 ? num(y % 100, 2) : num(y, n);
      }
      case 'M': case 'L': {
        const m = w.getUTCMonth() + 1;
        if (n <= 2) return num(m, n);
        const style = n === 3 ? 'short' : n === 5 && icu ? 'narrow' : 'long';
        // M is the format form (genitive in Slavic languages: 5 марта), L the stand-alone form (март); a locale whose
        // dates spell the month as a number (ja: 7月14日) has its name only stand-alone (7月)
        const fmtForm = c === 'M' ? part(locale, { day: 'numeric', month: style }, w, 'month') : '';
        return fmtForm && !/^[\d\u0660-\u0669\u06f0-\u06f9]+$/.test(fmtForm) ? fmtForm : dtf(locale, { month: style }).format(w);
      }
      case 'd': return num(w.getUTCDate(), n);
      case 'D': return num(Math.round((Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()) - Date.UTC(w.getUTCFullYear(), 0, 1)) / DAY_MS) + 1, n);
      case 'F': return num(Math.floor((w.getUTCDate() - 1) / 7) + 1, n);
      case 'w': return num(weekOf(w, weekInfo(locale)).week, n);
      case 'W': {
        const info = weekInfo(locale), first = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), 1));
        const off = (((first.getUTCDay() || 7) - info.first + 7) % 7);
        const startWeek1 = 7 - off >= info.min ? -off : 7 - off;
        return num(Math.floor((w.getUTCDate() - 1 - startWeek1) / 7) + 1, n);
      }
      case 'E': case 'c': case 'e':
        if ((c === 'e' || c === 'c') && n <= 2) return num(((w.getUTCDay() - weekInfo(locale).first + 7) % 7) + 1, n);
        // the format form, as in a full date (de: "Do.", where the stand-alone form is "Do")
        return part(locale, { weekday: n >= 4 && !(n === 5 && icu) ? 'long' : n === 5 && icu ? 'narrow' : 'short', day: 'numeric', month: 'long' }, w, 'weekday');
      case 'a': return part(locale, { hour: 'numeric', hour12: true }, w, 'dayPeriod') || (h < 12 ? 'AM' : 'PM');
      case 'H': return num(h, n);
      case 'k': return num(h || 24, n);
      case 'K': return num(h % 12, n);
      case 'h': return num(h % 12 || 12, n);
      case 'm': return num(w.getUTCMinutes(), n);
      case 's': return num(w.getUTCSeconds(), n);
      case 'S': {
        const ms = w.getUTCMilliseconds();
        if (!icu) return num(ms, n); // Java: milliseconds, padded
        return localDigits(String(ms).padStart(3, '0').padEnd(n, '0').slice(0, n), sy); // ICU: fractional seconds
      }
      case 'z': { try { return new Intl.DateTimeFormat(locale, { timeZone: tz || undefined, timeZoneName: n >= 4 ? 'long' : 'short' }).formatToParts(d).find(x => x.type === 'timeZoneName')?.value || 'UTC'; } catch { return 'UTC'; } }
      case 'Z': case 'X': case 'x': {
        const off = Math.round((w.getTime() - d.getTime()) / 60000);
        if ((c === 'X') && off === 0) return 'Z';
        const sign = off < 0 ? '-' : '+', a = Math.abs(off), hh = String(Math.floor(a / 60)).padStart(2, '0'), mm = String(a % 60).padStart(2, '0');
        if (c === 'Z') return n >= 4 ? `GMT${sign}${hh}:${mm}` : `${sign}${hh}${mm}`;
        return n === 1 ? `${sign}${hh}${mm === '00' ? '' : mm}` : n === 2 ? `${sign}${hh}${mm}` : `${sign}${hh}:${mm}`;
      }
    }
    return icu ? '' : c.repeat(n);
  }
}

/** ICU date/time styles (BIRT's Short Date, Long Time…): Intl's dateStyle/timeStyle in the report's zone. */
function formatStyle(d, spec, locale, tz) {
  const o = {};
  for (const kv of spec.split(';')) { const [k, v] = kv.split('='); if ((k === 'date' || k === 'time') && /^(short|medium|long|full)$/.test(v)) o[`${k}Style`] = v; }
  try { return new Intl.DateTimeFormat(locale, { ...o, timeZone: tz || undefined }).format(d); } catch { return d.toISOString(); }
}

const JAVA_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const JAVA_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** java.util.Date.toString(): "Thu Mar 05 14:30:00 UTC 2026" (always English) */
function javaDateString(d, tz) {
  const w = new Date(toWall(d, tz)), p = (n) => String(n).padStart(2, '0');
  const zone = tz && tz !== 'UTC' ? part('en-US', { timeZoneName: 'short' }, d, 'timeZoneName') : 'UTC';
  return `${JAVA_DAYS[w.getUTCDay()]} ${JAVA_MONTHS[w.getUTCMonth()]} ${p(w.getUTCDate())} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())} ${zone} ${w.getUTCFullYear()}`;
}

/** True for a "java:" or "icu:" format. */
export const isJavaFormat = (fmt) => typeof fmt === 'string' && (fmt.startsWith('java:') || fmt.startsWith('icu:'));

/**
 * Format a value with a "java:…" or "icu:…" format (see the top of this file). null and undefined give ''.
 * @param {any} value @param {string} fmt @param {{ locale?: string, timeZone?: string }} [opt]
 */
export function formatJava(value, fmt, opt = {}) {
  if (value == null) return '';
  capPattern('Format', fmt);
  const icu = fmt.startsWith('icu:');
  const pat = fmt.slice(icu ? 4 : 5);
  const locale = opt.locale || 'en-US';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    // BIRT's unformatted date-time: ICU's medium date and short time (English joins them with a space, not ", ")
    if (!pat) {
      if (!icu) return javaDateString(value, opt.timeZone);
      const s = formatStyle(value, 'date=medium;time=short', locale, opt.timeZone);
      return /^en\b/i.test(locale) ? s.replace(/^(.*\d{4}), /, '$1 ') : s; // ponytail: en only, from BIRT 4.25's output
    }
    if (pat.startsWith('@')) return formatStyle(value, pat.slice(1), locale, opt.timeZone);
    return formatDatePattern(value, pat, locale, opt.timeZone, icu);
  }
  if (typeof value === 'number') {
    if (!pat || pat.startsWith('@')) {
      if (!icu) return javaDouble(value);
      // BIRT's unformatted number: Double.toString without a trailing ".0" (12345678.9 is 1.23456789E7), Latin digits
      // and the locale's decimal sign
      if (!Number.isFinite(value)) return Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity';
      return javaDouble(value).replace(/\.0$/, '').replace('.', symbols(locale).dec);
    }
    return formatNumber(value, pat, locale, icu);
  }
  return String(value);
}

/**
 * String.valueOf(x) in Java, for string concatenation in JasperReports expressions: "null", true/false,
 * Double.toString ("2.0"), Date.toString; kind "int" for an integral value (Integer, Long: "2").
 * @param {any} v @param {string} [kind] @param {string} [tz]
 */
export function javaString(v, kind, tz) {
  if (v == null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(kind).toLowerCase() === 'int' && Number.isFinite(v) ? String(Math.trunc(v)) : javaDouble(v);
  if (v instanceof Date) return javaDateString(v, tz);
  return String(v);
}

/** JavaScript's String(x), for string concatenation in BIRT expressions: "null", true/false, shortest digits. */
export function jsString(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (v instanceof Date) return v.toString();
  return String(v);
}

/**
 * java.util.Formatter (String.format) for the common conversions: %s %S %b %c %d %o %x %X %f %e %E %% %n, with flags
 * - + space 0 , ( and width, precision and argument index (%2$s). %f rounds half up on the shortest decimal form, as
 * Java does (String.format("%.2f", 1.005) is "1.01"). Digits and separators are the locale's.
 * @param {string} f @param {any[]} args @param {string} [locale] @param {string} [tz]
 */
export function javaFormatString(f, args, locale = 'en-US', tz) {
  const sy = symbols(locale);
  let next = 0, out = '';
  // bounded quantifiers: no backtracking blow-up on a long run of flags or digits
  const re = /%(?:(\d{1,4})\$)?([-#+ 0,(]{0,7})(\d{1,9})?(?:\.(\d{1,9}))?([a-zA-Z%])/g;
  capText('JavaFormat', f.length);
  let last = 0, m;
  const lit = (a, b) => { const t = f.slice(a, b); if (t.includes('%')) throw new ExprError(`JavaFormat: "${t.slice(t.indexOf('%'), t.indexOf('%') + 12)}…" is not a format specifier`); return t; };
  while ((m = re.exec(f))) {
    out += lit(last, m.index);
    last = re.lastIndex;
    const [, idx, flags, width, prec, conv] = m;
    if (conv === '%') { out += '%'; continue; }
    if (conv === 'n') { out += '\n'; continue; }
    const v = idx ? args[Number(idx) - 1] : args[next++];
    const w = width ? Number(width) : 0, p = prec != null ? Number(prec) : null;
    capDigits('JavaFormat', w); if (p != null && /[fFeE]/.test(conv)) capDigits('JavaFormat', p);
    let s;
    const lc = conv.toLowerCase();
    if (lc === 's') s = javaString(v, undefined, tz);
    else if (lc === 'b') s = v == null ? 'false' : typeof v === 'boolean' ? String(v) : 'true';
    else if (lc === 'c') s = v == null ? 'null' : typeof v === 'number' ? String.fromCodePoint(v) : String(v)[0] ?? '';
    else if (v == null) s = 'null';
    else {
      const x = Number(v);
      const neg = x < 0 || Object.is(x, -0);
      let body;
      if (lc === 'd') body = group(String(Math.abs(Math.trunc(x))), flags.includes(',') ? 3 : 0, 0, '\u0000');
      else if (lc === 'o' || lc === 'x') { const t = Math.trunc(x); const u = t >= 0 ? t : t >= -(2 ** 31) ? t >>> 0 : Number(BigInt.asUintN(64, BigInt(t))); body = u.toString(lc === 'o' ? 8 : 16); }
      else if (lc === 'f') {
        const r = roundTo(shortest(Math.abs(x)), p ?? 6, 'HALF_UP', neg);
        const str = r.M.toString().padStart(r.s + 1, '0');
        const int = str.slice(0, str.length - r.s), frac = str.slice(str.length - r.s);
        body = group(int, flags.includes(',') ? 3 : 0, 0, '\u0000') + (frac ? `\u0001${frac}` : '');
      } else if (lc === 'e') {
        const d = shortest(Math.abs(x)), n = digitCount(d.M) || 1, pp = p ?? 6;
        const r = d.M === 0n ? { M: 0n, s: pp } : roundTo({ M: d.M, s: n - 1 }, pp, 'HALF_UP', neg);
        let e = d.M === 0n ? 0 : n - 1 - d.s;
        let str = r.M.toString();
        if (str.length > pp + 1) { str = str.slice(0, -1); e++; } // 9.99… rounded up to 10.0…
        str = str.padStart(pp + 1, '0');
        body = str[0] + (pp ? `\u0001${str.slice(1)}` : '') + `${conv}${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
      } else { s = String(v); body = null; }
      if (body != null) {
        const loc = lc === 'x' || lc === 'o' ? body : localDigits(body, sy).replace(/\u0000/g, sy.grp).replace(/\u0001/g, sy.dec);
        const signed = (lc === 'x' || lc === 'o') ? loc : neg ? (flags.includes('(') ? `(${loc})` : `-${loc}`) : flags.includes('+') ? `+${loc}` : flags.includes(' ') ? ` ${loc}` : loc;
        s = signed;
        if (flags.includes('0') && !flags.includes('-') && s.length < w) {
          const sign = /^[-+ (]/.test(s) ? s[0] : '';
          s = sign + localDigits('0'.repeat(w - s.length), sy) + s.slice(sign.length);
        }
      }
    }
    if (p != null && (lc === 's' || lc === 'b' || lc === 'c')) s = s.slice(0, p);
    if (conv === 'S' || conv === 'B' || conv === 'X' || conv === 'E') s = s.toUpperCase();
    if (s.length < w) s = flags.includes('-') ? s.padEnd(w) : s.padStart(w);
    capText('JavaFormat', out.length + s.length + (f.length - last)); // before the result grows
    out += s;
  }
  return out + lit(last, f.length);
}
