// @ts-check
/**
 * Value formatting with .NET-style format strings.
 * Numbers: C2, N0, F2, P1, D6, or custom patterns like "#,##0.00".
 * Dates: yyyy yy MMMM MMM MM M dddd ddd dd d HH H hh h mm ss tt.
 */

const nfCache = new Map();
function nf(locale, opts) {
  const key = locale + JSON.stringify(opts);
  let f = nfCache.get(key);
  if (!f) { f = new Intl.NumberFormat(locale, opts); nfCache.set(key, f); }
  return f;
}

/**
 * Read a value as a Date. A date-only string ("2026-03-01") is local midnight, the same as
 * DateSerial and the date formatter; new Date() would read it as UTC midnight and shift the day.
 */
export function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim()) : null;
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local calendar date as "yyyy-MM-dd" (toISOString would give the UTC day). */
export const isoDate = (d) => formatDate(d, 'yyyy-MM-dd');

const P10F = Array.from({ length: 23 }, (_, i) => 10 ** i);
/** Shift a number's decimal point by e places through its decimal (exponent) form: no binary error (1.005 → 100.5). */
export const shiftDec = (x, e) => { const [m, k = '0'] = String(x).split('e'); return Number(`${m}e${Number(k) + e}`); };

/**
 * Round half away from zero on the decimal value, like Intl, Excel and .NET format strings ("N2", "F0"): 1.005 → 1.01,
 * 2.5 → 3. This is how displayed numbers round. VB's Round() rounds half to even instead: see roundHalfEven.
 * @param {number} v @param {number} [digits] may be negative (1234 → 1200 with -2)
 */
export function roundHalfAway(v, digits = 0) {
  if (!Number.isFinite(v)) return v;
  // already has no more decimals than asked for (8408.65 to 2): nothing to round. i / 10^d is the double nearest that
  // decimal, so when it is v, v's shortest form has at most d decimals and the decimal shift below gives v back.
  if (digits >= 0 && digits <= 22) { const i = Math.round(v * P10F[digits]); if (i / P10F[digits] === v) return v + 0; }
  return Math.sign(v) * shiftDec(Math.round(shiftDec(Math.abs(v), digits)), -digits) + 0; // + 0 turns -0 into 0
}

/**
 * VB / .NET Math.Round(x, digits): round half to even (MidpointRounding.ToEven, "banker's rounding"), 2.5 → 2,
 * 3.5 → 4, on the decimal value (2.675 is the decimal 2.675, as a Decimal money field is in SSRS).
 * @param {number} v @param {number} [digits] may be negative
 */
export function roundHalfEven(v, digits = 0) {
  if (!Number.isFinite(v)) return v;
  const x = shiftDec(Math.abs(v), digits);
  const f = Math.floor(x), diff = x - f;
  const r = diff > 0.5 || (diff === 0.5 && f % 2 !== 0) ? f + 1 : f;
  return Math.sign(v) * shiftDec(r, -digits) + 0;
}

/** Currency of a country, for a locale with a region ("de-DE" → EUR), as .NET's culture gives "C" its symbol. */
export const REGION_CURRENCY = { US: 'USD', IN: 'INR', GB: 'GBP', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', IE: 'EUR', FI: 'EUR',
  GR: 'EUR', JP: 'JPY', CN: 'CNY', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', SG: 'SGD', AE: 'AED', SA: 'SAR', BR: 'BRL', MX: 'MXN', ZA: 'ZAR', KR: 'KRW',
  RU: 'RUB', ID: 'IDR', MY: 'MYR', PH: 'PHP', TH: 'THB', VN: 'VND', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN',
  TR: 'TRY', IL: 'ILS', EG: 'EGP', NG: 'NGN', KE: 'KES', HK: 'HKD', TW: 'TWD' };
/** @param {string|undefined} locale */
export const currencyOf = (locale) => {
  const l = locale || '';
  if (CURRENCY_OF.has(l)) return CURRENCY_OF.get(l);
  const m = /^[a-z]{2,3}-(?:[A-Za-z]{4}-)?([A-Za-z]{2})$/i.exec(l);
  const c = m ? REGION_CURRENCY[m[1].toUpperCase()] : undefined;
  if (CURRENCY_OF.size < 1000 && l.length <= 35) CURRENCY_OF.set(l, c);
  return c;
};
const CURRENCY_OF = new Map();

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Format a value. Neutral defaults: no locale means en-US; no currency means the locale's own currency when the
 * locale names a country ("en-IN" → ₹, as a .NET culture does), else none, and "C" then shows the number alone.
 * @param {any} value
 * @param {string|undefined|null} fmt
 * @param {{locale?: string, currency?: string, fmtMemo?: Map<string, Map<any, string>>}} [opt] fmtMemo: a render's memo of formatted dates
 */
export function formatValue(value, fmt, opt = {}) {
  if (value == null) return '';
  const locale = opt.locale || 'en-US';
  if (value instanceof Date) {
    const t = value.getTime();
    if (Number.isNaN(t)) return '';
    if (!opt.fmtMemo) return formatDate(value, fmt || 'dd MMM yyyy', locale);
    // a date column repeats its days: each instant formats once per format and locale in a render (opt.fmtMemo: the
    // render's, so a time zone change between renders is seen)
    const memo = memoFor(opt.fmtMemo, 'i', fmt || 'dd MMM yyyy', locale);
    let out = memo.get(t);
    if (out === undefined) { out = formatDate(value, fmt || 'dd MMM yyyy', locale); memo.set(t, out); }
    return out;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    // No format: plain digits, no grouping (a year stays 2026). Use N0/N2/C2 to group. A safe integer reads the same.
    if (!fmt) return Number.isSafeInteger(value) && !Object.is(value, -0) ? String(value) : PLAIN.format(value);
    return numberFn(fmt, locale, opt.currency || currencyOf(opt.locale))(value);
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string' && fmt && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const memo = opt.fmtMemo && value.length <= 40 ? memoFor(opt.fmtMemo, 's', fmt, locale) : null;
    let out = memo?.get(value);
    if (out === undefined) {
      const d = toDate(value);
      out = d && /[yMd]/.test(fmt) ? formatDate(d, fmt, locale) : value;
      memo?.set(value, out);
    }
    return out;
  }
  return String(value);
}
const PLAIN = new Intl.NumberFormat('en-US', { maximumFractionDigits: 10, useGrouping: false });
/** Formatted dates in one render: by text ('s') or instant ('i'), per format and locale. @param {Map<string, Map<any, string>>} all */
function memoFor(all, kind, fmt, locale) {
  const key = `${kind}\u0001${fmt}\u0001${locale}`;
  let memo = all.get(key);
  // bounded per render: 50 formats × 5,000 values. ponytail: cleared when full, an LRU if a profile ever asks
  if (!memo) { if (all.size >= 50) all.clear(); memo = new Map(); all.set(key, memo); }
  else if (memo.size >= 5000) memo.clear();
  return memo;
}
/** @type {Map<string, (v: number) => string>} a number format, compiled once per format, locale and currency */
const numberFns = new Map();
function numberFn(fmt, locale, currency) {
  const key = `${fmt}\u0001${locale}\u0001${currency ?? ''}`;
  let fn = numberFns.get(key);
  if (!fn) {
    fn = compileNumber(fmt, locale, currency);
    if (key.length <= 128) { // formats from expressions can be any text: only short keys, at most 2,000
      if (numberFns.size >= 2000) numberFns.clear();
      numberFns.set(key, fn);
    }
  }
  return fn;
}
/** @returns {(value: number) => string} for a finite number */
function compileNumber(fmt, locale, currency) {
  const m = /^([CcNnFfPpDdEeXxGgRr])(\d{0,2})$/.exec(fmt);
  if (m) {
    const k = m[1].toUpperCase();
    const d = m[2] === '' ? null : Number(m[2]);
    // signDisplay 'negative': a value that rounds to zero shows 0.0, never -0.0
    const fixed = { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2, signDisplay: 'negative' };
    switch (k) {
      case 'C': { const f = nf(locale, currency ? { style: 'currency', currency, ...fixed } : fixed); return (v) => f.format(v); }
      case 'N': { const f = nf(locale, fixed); return (v) => f.format(v); }
      case 'F': return (v) => roundHalfAway(v, d ?? 2).toFixed(d ?? 2);
      case 'P': { const f = nf(locale, { style: 'percent', ...fixed }); return (v) => f.format(v); }
      case 'D': return (value) => { const t = Math.trunc(value); return (t < 0 ? '-' : '') + String(Math.abs(t)).padStart(d ?? 0, '0'); };
      case 'E': return (v) => scientific(v, d ?? 6, m[1] === 'e' ? 'e' : 'E', 3);
      case 'X': return (value) => {
        const t = Math.trunc(value);
        const h = t >= 0 ? t.toString(16) : BigInt.asUintN(t >= -(2 ** 31) ? 32 : 64, BigInt(t)).toString(16); // two's complement, as Int32 / Int64
        return (m[1] === 'X' ? h.toUpperCase() : h).padStart(d ?? 0, '0');
      };
      case 'G': return (v) => general(v, d || 15, m[1] === 'g' ? 'e' : 'E');
      case 'R': return (v) => general(v, 17, 'E', String(v));
    }
  }
  if (/[#0]/.test(fmt)) return (v) => customNumber(v, fmt, locale);
  return (v) => String(v);
}

/** "E": d.ddddE+ddd. Mantissa digits round on the decimal value. */
function scientific(v, digits, e, expDigits) {
  const [mant, exp] = Math.abs(v).toExponential(digits).split('e');
  const x = Number(exp);
  return `${v < 0 ? '-' : ''}${mant}${e}${x < 0 ? '-' : '+'}${String(Math.abs(x)).padStart(expDigits, '0')}`;
}
/**
 * "G" / "Gn": n significant digits (15 for a Double on .NET Framework, which SSRS runs), trailing zeros dropped; fixed
 * notation while the exponent is above -5 and below n, else d.dddE+dd. `shortest` (for "R") is the digits to show.
 */
function general(v, p, e, shortest) {
  if (v === 0) return '0';
  const [mant, exp] = (shortest ? Number(shortest) : v).toExponential(shortest ? undefined : Math.min(p, 100) - 1).split('e');
  const x = Number(exp), digits = mant.includes('.') ? mant.replace(/\.?0+$/, '') : mant;
  if (x > -5 && x < p) return nf('en-US', { maximumFractionDigits: 20, maximumSignificantDigits: 21, useGrouping: false }).format(Number(`${digits}e${x}`));
  return `${digits}${e}${x < 0 ? '-' : '+'}${String(Math.abs(x)).padStart(2, '0')}`;
}

/** A format string's parts: "a;b;c" sections, with 'quoted' and \escaped text kept whole. */
function sections(fmt) {
  const out = [''];
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c === '\\') { out[out.length - 1] += fmt.slice(i, i + 2); i++; continue; }
    if (c === '"' || c === "'") { const j = fmt.indexOf(c, i + 1); const end = j < 0 ? fmt.length : j; out[out.length - 1] += fmt.slice(i, end + 1); i = end; continue; }
    if (c === ';') { out.push(''); continue; }
    out[out.length - 1] += c;
  }
  return out;
}
/** Tokens of one numeric section: digit placeholders 0 #, the point, commas, % and literal text. */
function numTokens(sec) {
  const toks = [];
  for (let i = 0; i < sec.length; i++) {
    const c = sec[i];
    if (c === '\\') { toks.push({ k: 'lit', s: sec[i + 1] ?? '' }); i++; continue; }
    if (c === '"' || c === "'") { const j = sec.indexOf(c, i + 1); const end = j < 0 ? sec.length : j; toks.push({ k: 'lit', s: sec.slice(i + 1, end) }); i = end; continue; }
    toks.push('0#.,%'.includes(c) ? { k: c } : { k: 'lit', s: c });
  }
  return toks;
}

/**
 * .NET custom numeric formats: 0 and # digit placeholders, "." , (grouping, or ÷1,000 right before the point or the
 * end), % (×100), 'literal' and \c text, and up to three sections "positive;negative;zero". The negative section
 * shows no minus sign of its own; digits fill literal positions right to left ("000-00-0000"). Halves round away
 * from zero, as .NET format strings do.
 */
function customNumber(v, fmt, locale) {
  const secs = sections(fmt);
  let sec = secs[0], minus = v < 0;
  if (v < 0 && secs.length > 1 && secs[1] !== '') { sec = secs[1]; minus = false; }
  const shape = numShape(numTokens(sec));
  let x = Math.abs(v);
  if (shape.pct) x = shiftDec(x, 2 * shape.pct);
  if (shape.scale) x = shiftDec(x, -3 * shape.scale);
  // a value that rounds to zero takes the zero section when there is one
  if (secs.length > 2 && secs[2] !== '' && roundHalfAway(x, shape.decimals) === 0) return formatShape(numShape(numTokens(secs[2])), 0, false, locale);
  return formatShape(shape, x, minus, locale);
}
function numShape(toks) {
  const ph = (t) => t.k === '0' || t.k === '#';
  const last = toks.findLastIndex(ph);
  const first = toks.findIndex(t => ph(t) || t.k === '.'); // ".00" starts at its point
  if (last < 0) return { toks, pre: toks, post: [], int: [], frac: [], decimals: 0, minDec: 0, minInt: 0, grouping: false, scale: 0, pct: 0, inner: false };
  const span = toks.slice(first, last + 1);
  let dot = span.findIndex(t => t.k === '.');
  if (dot < 0) dot = span.length;
  const int = span.slice(0, dot), frac = span.slice(dot + 1).filter(ph);
  // commas right before the point (or the end of the digits) divide by 1,000 each; others group
  let scale = 0;
  for (let i = int.length - 1; i >= 0 && int[i].k === ','; i--) scale++;
  const intCore = int.slice(0, int.length - scale);
  if (dot === span.length) for (let j = last + 1; j < toks.length && toks[j].k === ','; j++) scale++;
  const intPh = intCore.filter(ph);
  const z = intPh.findIndex(t => t.k === '0');
  const lastZero = frac.findLastIndex(t => t.k === '0');
  return {
    pre: toks.slice(0, first), post: toks.slice(last + 1).filter(t => t.k !== ','), int: intCore, frac,
    decimals: frac.length, minDec: lastZero + 1, minInt: z < 0 ? 0 : intPh.length - z,
    grouping: intCore.some(t => t.k === ','), inner: intCore.some(t => t.k === 'lit'), scale,
    pct: toks.filter(t => t.k === '%').length,
  };
}
const litText = (toks) => toks.map(t => (t.k === 'lit' ? t.s : t.k === '%' ? '%' : t.k === '.' ? '.' : t.k === ',' ? ',' : '')).join('');
function formatShape(s, x, minus, locale) {
  if (!s.int.length && !s.frac.length) return (minus ? '-' : '') + litText(s.pre);
  let body;
  if (s.inner) {
    // digits fill the placeholders right to left; literals between them stay where they are
    const r = roundHalfAway(x, s.decimals);
    const [ip, fp = ''] = r.toFixed(s.decimals).split('.');
    let digits = ip === '0' ? '' : ip;
    const out = [];
    const phs = s.int.filter(t => t.k === '0' || t.k === '#').length;
    let k = 0;
    for (let i = s.int.length - 1; i >= 0; i--) {
      const t = s.int[i];
      if (t.k === 'lit') { out.unshift(t.s); continue; }
      if (t.k !== '0' && t.k !== '#') continue;
      k++;
      if (k === phs) { out.unshift(digits || (t.k === '0' ? '0' : '')); digits = ''; continue; } // the leftmost takes the rest
      const dch = digits.slice(-1);
      digits = digits.slice(0, -1);
      out.unshift(dch || (t.k === '0' ? '0' : ''));
    }
    const frac = fp.slice(0, s.decimals).replace(new RegExp(`0{0,${s.decimals - s.minDec}}$`), '');
    body = out.join('') + (frac ? '.' + frac : '');
    minus = minus && r !== 0;
  } else {
    body = nf(locale, { useGrouping: s.grouping, minimumFractionDigits: s.minDec, maximumFractionDigits: s.decimals, minimumIntegerDigits: Math.max(1, s.minInt) }).format(x);
    minus = minus && /[1-9]/.test(body);
    if (s.minInt === 0) body = body.replace(/^0(?=\D|$)/, ''); // "#.##" shows .5, "#" shows nothing for 0
  }
  return (minus ? '-' : '') + litText(s.pre) + body + litText(s.post);
}

const dtfCache = new Map();
/** Month or weekday name in a non-English locale. English keeps the fixed tables, so its output never shifts. */
function localName(locale, kind, style, d) {
  const key = `${locale}|${kind}|${style}`;
  let f = dtfCache.get(key);
  if (f === undefined) {
    try { f = new Intl.DateTimeFormat(locale, { [kind]: style }); } catch { f = null; } // an unknown locale: English
    dtfCache.set(key, f);
  }
  return f ? f.format(d) : null;
}
/** English locales keep the fixed English names (so existing reports never shift). */
export const english = (locale) => !locale || /^en\b/i.test(locale);

/**
 * .NET standard date formats (one letter). en-US (the default locale) has .NET's en-US patterns; other locales keep the
 * day-first patterns Pagewright has always used. s, u and o are the same everywhere.
 */
const US_DATES = { d: 'M/d/yyyy', D: 'dddd, MMMM d, yyyy', t: 'h:mm tt', T: 'h:mm:ss tt', M: 'MMMM d', Y: 'MMMM yyyy' };
const DAY_FIRST = { d: 'dd/MM/yyyy', D: 'dddd, dd MMMM yyyy', t: 'HH:mm', T: 'HH:mm:ss', M: 'dd MMMM', Y: 'MMMM yyyy' };
const INVARIANT = { s: "yyyy-MM-dd'T'HH:mm:ss", u: "yyyy-MM-dd HH:mm:ss'Z'", o: "yyyy-MM-dd'T'HH:mm:ss.fffffff" };
function standardDate(fmt, locale) {
  const p = !locale || /^en-US$/i.test(locale) ? US_DATES : DAY_FIRST;
  switch (fmt) {
    case 'd': case 'D': case 't': case 'T': return p[fmt];
    case 'f': return `${p.D} ${p.t}`;
    case 'F': return `${p.D} ${p.T}`;
    case 'g': return `${p.d} ${p.t}`;
    case 'G': return `${p.d} ${p.T}`;
    case 'M': case 'm': return p.M;
    case 'Y': case 'y': return p.Y;
    case 's': case 'u': case 'o': return INVARIANT[fmt];
    case 'O': return INVARIANT.o;
  }
  return null;
}

/**
 * .NET custom date format: runs of y M d H h m s f F t, 'quoted' and \escaped text; "%d" is the custom "d" alone.
 * @param {Date} d @param {string} fmt @param {string} [locale] month and day names follow it
 */
export function formatDate(d, fmt, locale) {
  if (fmt.length === 1) { const std = standardDate(fmt, locale); if (std) return formatDate(d, std, locale); }
  if (fmt.length === 2 && fmt[0] === '%') fmt = fmt[1];
  const en = english(locale);
  const name = (kind, style, fallback) => (en ? fallback : localName(locale, kind, style, d) ?? fallback);
  const p2 = (n) => String(n).padStart(2, '0');
  return fmt.replace(/(y+|M+|d+|H+|h+|m+|s+|f+|F+|t+)|'([^']*)'?|"([^"]*)"?|\\(.?)/g, (tok, run, q1, q2, esc) => {
    if (!run) return q1 ?? q2 ?? esc ?? '';
    const n = run.length;
    switch (run[0]) {
      case 'y': { const y = d.getFullYear(); return n === 1 ? String(y % 100) : n === 2 ? p2(y % 100) : String(y).padStart(n, '0'); }
      case 'M': return n >= 4 ? name('month', 'long', MONTHS[d.getMonth()]) : n === 3 ? name('month', 'short', MONTHS[d.getMonth()].slice(0, 3)) : n === 2 ? p2(d.getMonth() + 1) : String(d.getMonth() + 1);
      case 'd': return n >= 4 ? name('weekday', 'long', DAYS[d.getDay()]) : n === 3 ? name('weekday', 'short', DAYS[d.getDay()].slice(0, 3)) : n === 2 ? p2(d.getDate()) : String(d.getDate());
      case 'H': return n >= 2 ? p2(d.getHours()) : String(d.getHours());
      case 'h': { const h = ((d.getHours() + 11) % 12) + 1; return n >= 2 ? p2(h) : String(h); }
      case 'm': return n >= 2 ? p2(d.getMinutes()) : String(d.getMinutes());
      case 's': return n >= 2 ? p2(d.getSeconds()) : String(d.getSeconds());
      case 'f': case 'F': { // fractions of a second; a Date holds milliseconds, so digits past the third are 0
        const f = String(d.getMilliseconds()).padStart(3, '0').padEnd(7, '0').slice(0, Math.min(n, 7));
        return run[0] === 'F' ? f.replace(/0+$/, '') : f;
      }
      case 't': { const s = d.getHours() < 12 ? 'AM' : 'PM'; return n === 1 ? s[0] : s; }
    }
    return run;
  });
}
