// @ts-check
/**
 * Value formatting with .NET-style format strings.
 * Numbers: C2, N0, F2, P1, D6, or custom patterns like "#,##0.00".
 * Dates: yyyy yy MMMM MMM MM M dddd ddd dd d HH H hh h mm ss tt.
 */

import { isJavaFormat, formatJava } from './javafmt.js';
import { capPattern, capDigits } from './parser.js';

const nfCache = new Map();
function nf(locale, opts) {
  const key = locale + JSON.stringify(opts);
  let f = nfCache.get(key);
  // Latin digits, as .NET (and so SSRS) formats in every culture: ar-SA -5 is "-5", not "٥" with its minus lost (N5)
  if (!f) { f = new Intl.NumberFormat(locale, { numberingSystem: 'latn', ...opts }); if (nfCache.size >= 500) nfCache.clear(); nfCache.set(key, f); } // bounded: a server renders many reports
  return f;
}

/* ------------------------------------------------------------------ time zones
 * A report shows dates on the wall clock of one time zone: the report's `timeZone` (or the render's, which the server
 * takes from the viewer), else the host's own zone. Every date part (Year, Day, Hour, a format's dd or HH) is read on
 * that clock, and every date built from parts (a date-only text, DateSerial, Today) is midnight there, so a server
 * PDF and the browser viewer agree. A "wall" value is the wall clock as a UTC timestamp: its getUTC* parts are the
 * parts in the zone.
 */
const DAY_MS = 86400000;
const zoneFmt = new Map();
/** The zone's offset from UTC in minutes at instant t (host zone: undefined; 'UTC'; or an IANA name). */
function offsetAt(t, tz) {
  if (!tz) return -new Date(t).getTimezoneOffset();
  if (tz === 'UTC' || tz === 'Etc/UTC') return 0;
  let z = zoneFmt.get(tz);
  if (!z) {
    let f = null;
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); } catch { /* unknown zone: the host's */ }
    z = { f, cache: new Map() };
    if (zoneFmt.size >= 100) zoneFmt.clear();
    zoneFmt.set(tz, z);
  }
  if (!z.f) return -new Date(t).getTimezoneOffset();
  // offsets change on quarter hours: one Intl call per 15 minutes of instants (ponytail: cleared when full)
  const key = Math.floor(t / 900000);
  let o = z.cache.get(key);
  if (o === undefined) {
    const p = {};
    for (const x of z.f.formatToParts(new Date(key * 900000))) p[x.type] = Number(x.value);
    o = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - key * 900000) / 60000);
    if (z.cache.size >= 20000) z.cache.clear();
    z.cache.set(key, o);
  }
  return o;
}
/** True for a time zone Intl knows ("UTC", "Europe/Berlin"); the host's zone is used for any other. */
export const validTimeZone = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
/** An instant → its wall clock in the zone, as a UTC timestamp (getUTC* parts are the zone's parts). */
export const toWall = (d, tz) => { const t = d instanceof Date ? d.getTime() : d; return t + offsetAt(t, tz) * 60000; };
/** A wall clock in the zone (as a UTC timestamp) → the instant; a time skipped by DST moves forward as Date does. */
export function fromWall(w, tz) {
  const a = w - offsetAt(w, tz) * 60000;
  const b = w - offsetAt(a, tz) * 60000;
  return new Date(toWall(b, tz) === w ? b : a);
}
/** Midnight in the zone on the given calendar day (months and days roll over as Date.UTC does). */
export const zoneDate = (y, m, d, tz, h = 0, mi = 0, sec = 0, ms = 0) => {
  const w = new Date(0);
  w.setUTCFullYear(y, m, d);
  w.setUTCHours(h, mi, sec, ms);
  return fromWall(w.getTime(), tz);
};
/** The wall-clock parts of a date in the zone, as a Date read with getUTC*. */
export const wallDate = (d, tz) => new Date(toWall(d, tz));
export { DAY_MS };

/* ------------------------------------------------------------------ reading dates
 * Text dates as .NET CDate reads them: ISO (yyyy-MM-dd, with a time and a zone or not), or numeric dates with "/", "."
 * or "-" in the locale's field order (en-US M/d/yyyy; de-DE, en-GB d.M.yyyy / d/M/yyyy; ja-JP yyyy/M/d), with an
 * optional time. A part that rolls over (30 February, month 13, 25:00) is not a date. Other text goes to the JS
 * parser ("March 5, 2026", RFC 2822) only when it names a month.
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;
const NUMERIC = /^(\d{1,4})([./-])(\d{1,2})\2(\d{1,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;
const orderCache = new Map();
/** 'mdy' | 'dmy' | 'ymd': the locale's numeric date order (from Intl). */
export function dateOrder(locale) {
  const l = locale || 'en-US';
  let o = orderCache.get(l);
  if (!o) {
    try {
      o = new Intl.DateTimeFormat(l, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).formatToParts(new Date(Date.UTC(2026, 2, 5)))
        .filter(p => p.type === 'year' || p.type === 'month' || p.type === 'day').map(p => p.type[0]).join('');
    } catch { o = 'mdy'; }
    if (!/^(mdy|dmy|ymd)$/.test(o)) o = 'mdy';
    if (orderCache.size >= 200) orderCache.clear();
    orderCache.set(l, o);
  }
  return o;
}
const year2 = (y) => (y < 100 ? y + (y < 30 ? 2000 : 1900) : y); // VB: 00–29 → 2000s, 30–99 → 1900s
const validParts = (y, mo, d, h = 0, mi = 0, s = 0) => mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate() && h <= 23 && mi <= 59 && s <= 59;
/**
 * Read a value as a Date, or null. A date without a zone ("2026-03-01", "05/03/2026 14:30") is that wall clock in the
 * report's zone; one with a zone ("…T02:00:00Z") is that instant.
 * @param {any} v @param {{ locale?: string, timeZone?: string }} [opt]
 */
export function toDate(v, opt) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  const s = String(v).trim();
  const tz = opt?.timeZone;
  let m = ISO.exec(s);
  if (m) {
    const [y, mo, d, h = 0, mi = 0, sec = 0] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(x => (x == null ? undefined : Number(x)));
    if (!validParts(y, mo, d, h, mi, sec)) return null;
    const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
    if (!m[8]) return zoneDate(y, mo - 1, d, tz, h, mi, sec, ms);
    const off = m[8].toUpperCase() === 'Z' ? 0 : (m[8][0] === '-' ? -1 : 1) * (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(-2)));
    return new Date(Date.UTC(y, mo - 1, d, h, mi, sec, ms) - off * 60000);
  }
  m = NUMERIC.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[3]), c = Number(m[4]);
    const ord = m[1].length === 4 ? 'ymd' : dateOrder(opt?.locale);
    let [y, mo, d] = ord === 'ymd' ? [a, b, c] : ord === 'dmy' ? [c, b, a] : [c, a, b];
    y = year2(y);
    let h = m[5] ? Number(m[5]) : 0;
    const mi = m[6] ? Number(m[6]) : 0, sec = m[7] ? Number(m[7]) : 0;
    if (m[8]) { if (h < 1 || h > 12) return null; h = (h % 12) + (/p/i.test(m[8]) ? 12 : 0); }
    if (!validParts(y, mo, d, h, mi, sec)) return null;
    return zoneDate(y, mo - 1, d, tz, h, mi, sec);
  }
  // other text: only with a month name (new Date("1") would read a bare number as a year)
  if (!/[A-Za-z]{3}/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // the JS parser reads a text without a zone on the host clock: move it to the report's
  return /(Z|GMT|UTC|[+-]\d{2}:?\d{2})\s*$/i.test(s) || !tz ? d : zoneDate(d.getFullYear(), d.getMonth(), d.getDate(), tz, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/** A calendar date as "yyyy-MM-dd" in the zone (toISOString would give the UTC day). */
export const isoDate = (d, tz) => formatDate(d, 'yyyy-MM-dd', undefined, tz);

/* ------------------------------------------------------------------ reading numbers */
const sepCache = new Map();
/** The locale's decimal and grouping separators (en-US: "." and ","; de-DE: "," and "."). */
export function separators(locale) {
  const l = locale || 'en-US';
  let r = sepCache.get(l);
  if (!r) {
    let dec = '.', grp = ',';
    try { for (const p of new Intl.NumberFormat(l).formatToParts(12345.6)) { if (p.type === 'decimal') dec = p.value; else if (p.type === 'group') grp = p.value; } } catch { /* en-US */ }
    r = { dec, grp };
    if (sepCache.size >= 200) sepCache.clear();
    sepCache.set(l, r);
  }
  return r;
}
/**
 * Text as a number the way the locale writes it: "1,234.5" (en-US), "1.234,56" / "12,5" (de-DE), with grouping
 * (also a space or a narrow no-break space), a currency symbol, a leading or trailing sign, accounting parentheses
 * "(1,234)" and a trailing %. NaN when it is not a number. A plain JS number text ("1e3", "-0.5") always reads.
 * @param {string} text @param {string} [locale]
 */
export function parseNumber(text, locale) {
  let s = String(text).trim();
  if (s === '') return NaN;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) {
    // plain digits: a comma-decimal locale reads "1.234" as 1234 only with grouping in threes, never "12.5"
    const { dec, grp } = separators(locale);
    if (dec === ',' && grp === '.' && /^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
    return Number(s);
  }
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  let pct = false;
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1).trim(); }
  s = s.replace(/^[\p{L}\p{Sc}]+\.?\s*|\s*[\p{L}\p{Sc}]+\.?$/gu, '').replace(/^[^\d.,+-]+|[^\d.,+-]+$/g, '').trim(); // currency symbols and codes ("$", "€", "Rs.", "USD")
  if (/^[+-]/.test(s)) { neg = neg !== (s[0] === '-'); s = s.slice(1).trim(); } else if (/[+-]$/.test(s)) { neg = neg !== s.endsWith('-'); s = s.slice(0, -1).trim(); }
  s = s.replace(/^[^\d.,]+|[^\d.,]+$/g, '').trim(); // a symbol after the sign: "-$5", "- € 5" (N25)
  const { dec, grp } = separators(locale);
  const g = grp === '\u00a0' || grp === '\u202f' || grp === ' ' ? '[ \u00a0\u202f]' : grp === '.' ? '\\.' : grp === "'" || grp === '\u2019' ? "['\u2019]" : grp;
  const d = dec === '.' ? '\\.' : dec;
  // groups of three; the Indian shape (12,34,567: twos before the last three) only in -IN locales, so en-US "1,23" is
  // not 123 (N25)
  const india = /-IN$/i.test(locale || '');
  const re = new RegExp(`^(\\d{1,3}(?:${g}\\d{3})+${india ? `|\\d{1,2}(?:${g}\\d{2})+${g}\\d{3}` : ''}|\\d+)(?:${d}(\\d+))?$`);
  const m = re.exec(s);
  if (!m) return NaN;
  // grouping: threes (and the Indian twos before the last three)
  const int = m[1].replace(new RegExp(g, 'g'), '');
  const n = Number(`${int}${m[2] ? `.${m[2]}` : ''}`);
  if (!Number.isFinite(n)) return NaN;
  const r = pct ? shiftDecSafe(n, -2) : n;
  return neg ? -r : r;
}
const shiftDecSafe = (x, e) => Number(`${x}e${e}`);

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
 * @param {{locale?: string, currency?: string, timeZone?: string, fmtMemo?: Map<string, Map<any, string>>}} [opt] fmtMemo: a render's memo of formatted dates
 */
export function formatValue(value, fmt, opt = {}) {
  if (value == null) return '';
  if (typeof fmt === 'string') capPattern('Format', fmt); // a format from data or an expression can be any length
  if (isJavaFormat(fmt)) { // an imported JasperReports or BIRT pattern, formatted as that engine does (javafmt.js)
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) { const d = toDate(value, opt); if (d) value = d; }
    return formatJava(value, /** @type {string} */ (fmt), opt);
  }
  const locale = opt.locale || 'en-US';
  if (value instanceof Date) {
    const t = value.getTime();
    if (Number.isNaN(t)) return '';
    const tz = opt.timeZone;
    // no format: the date, and its time of day when it has one (SSRS shows the time too)
    if (!fmt && toWall(value, tz) % DAY_MS !== 0) fmt = `dd MMM yyyy ${standardDate('t', locale)}`;
    if (!opt.fmtMemo) return formatDate(value, fmt || 'dd MMM yyyy', locale, tz);
    // a date column repeats its days: each instant formats once per format and locale in a render (opt.fmtMemo: the
    // render's, so a time zone change between renders is seen)
    const memo = memoFor(opt.fmtMemo, 'i', fmt || 'dd MMM yyyy', locale);
    let out = memo.get(t);
    if (out === undefined) { out = formatDate(value, fmt || 'dd MMM yyyy', locale, tz); memo.set(t, out); }
    return out;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    // No format: as VB CStr, up to 15 significant digits with the locale's decimal sign and no grouping (a year stays
    // 2026). Use N0/N2/C2 to group. A safe integer reads the same.
    if (!fmt) return Number.isSafeInteger(value) && !Object.is(value, -0) ? String(value) : general(value, 15, 'E', undefined, locale);
    return numberFn(fmt, locale, opt.currency || currencyOf(opt.locale))(value);
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string' && fmt && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const memo = opt.fmtMemo && value.length <= 40 ? memoFor(opt.fmtMemo, 's', fmt, locale) : null;
    let out = memo?.get(value);
    if (out === undefined) {
      const d = toDate(value, opt);
      out = d && /[yMd]/.test(fmt) ? formatDate(d, fmt, locale, opt.timeZone) : value;
      memo?.set(value, out);
    }
    return out;
  }
  return String(value);
}
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
const BIDI_MARKS = /[\u200e\u061c]/g;
/** @returns {(value: number) => string} for a finite number */
function compileNumber(fmt, locale, currency) {
  const m = /^([CcNnFfPpDdEeXxGgRr])(\d{0,2})$/.exec(fmt);
  if (m) {
    const k = m[1].toUpperCase();
    const d = m[2] === '' ? null : Number(m[2]);
    // signDisplay 'negative': a value that rounds to zero shows 0.0, never -0.0
    // .NET groups every number above 999 (es-ES 1.234,50); CLDR's "auto" leaves 1234,50 below 10,000 (N13)
    const fixed = { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2, signDisplay: 'negative', useGrouping: 'always' };
    switch (k) {
      // ja-JP JPY comes out as the full-width ￥ (U+FFE5), which the bundled fonts lack; .NET ja-JP writes ¥ (U+00A5)
      case 'C': { const f = nf(locale, currency ? { style: 'currency', currency, ...fixed } : fixed); return (v) => f.format(v).replace(/\uFFE5/g, '\u00A5'); }
      case 'N': { const f = nf(locale, fixed); return (v) => f.format(v).replace(BIDI_MARKS, ''); } // .NET's plain "-" (CLDR ar adds U+200E)
      case 'F': { const f = nf(locale, { ...fixed, useGrouping: false }); return (v) => f.format(v); } // the locale's decimal sign, no grouping
      case 'P': { const f = nf(locale, { style: 'percent', ...fixed }); return (v) => f.format(v).replace(BIDI_MARKS, ''); }
      case 'D': return (value) => { const t = Math.trunc(value); return (t < 0 ? '-' : '') + String(Math.abs(t)).padStart(d ?? 0, '0'); };
      case 'E': { const dec = separators(locale).dec; return (v) => scientific(v, d ?? 6, m[1] === 'e' ? 'e' : 'E', 3).replace('.', dec); }
      case 'X': return (value) => {
        const t = Math.trunc(value);
        const h = t >= 0 ? t.toString(16) : BigInt.asUintN(t >= -(2 ** 31) ? 32 : 64, BigInt(t)).toString(16); // two's complement, as Int32 / Int64
        return (m[1] === 'X' ? h.toUpperCase() : h).padStart(d ?? 0, '0');
      };
      case 'G': return (v) => general(v, d || 15, m[1] === 'g' ? 'e' : 'E', undefined, locale);
      case 'R': return (v) => general(v, 17, 'E', String(v), locale);
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
function general(v, p, e, shortest, locale) {
  if (v === 0) return '0';
  const [mant, exp] = (shortest ? Number(shortest) : v).toExponential(shortest ? undefined : Math.min(p, 100) - 1).split('e');
  const x = Number(exp), digits = mant.includes('.') ? mant.replace(/\.?0+$/, '') : mant;
  const dec = locale ? separators(locale).dec : '.';
  if (x > -5 && x < p) return nf('en-US', { maximumFractionDigits: 20, maximumSignificantDigits: 21, useGrouping: false }).format(Number(`${digits}e${x}`)).replace('.', dec);
  return `${digits.replace('.', dec)}${e}${x < 0 ? '-' : '+'}${String(Math.abs(x)).padStart(2, '0')}`;
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
  const sci = exponentOf(sec);
  if (sci) return (minus ? '-' : '') + scientificCustom(Math.abs(v), sci, locale);
  const shape = numShape(numTokens(sec));
  let x = Math.abs(v);
  if (shape.pct) x = shiftDec(x, 2 * shape.pct);
  if (shape.mille) x = shiftDec(x, 3 * shape.mille); // ‰ multiplies by 1,000 (N28)
  if (shape.scale) x = shiftDec(x, -3 * shape.scale);
  // a value that rounds to zero takes the zero section when there is one
  if (secs.length > 2 && secs[2] !== '' && roundHalfAway(x, shape.decimals) === 0) return formatShape(numShape(numTokens(secs[2])), 0, false, locale);
  return formatShape(shape, x, minus, locale);
}
/**
 * A section's exponent ("0.00E+00", "#.##e-0"): E or e, then + (always signed) or - / nothing (signed when negative),
 * then the exponent's minimum digits. Null when the section has none (outside quotes).
 */
function exponentOf(sec) {
  let q = null;
  for (let i = 0; i < sec.length; i++) {
    const c = sec[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c === 'E' || c === 'e') {
      const m = /^([+-]?)(0+)/.exec(sec.slice(i + 1));
      if (m && /[0#]/.test(sec.slice(0, i))) return { mant: sec.slice(0, i), e: c, plus: m[1] === '+', digits: m[2].length, rest: sec.slice(i + 1 + m[0].length) };
    }
  }
  return null;
}
/** .NET custom scientific: the mantissa keeps as many integer digits as its pattern has (0.00E+00 → 1.23E-05). */
function scientificCustom(x, sci, locale) {
  const intPh = (sci.mant.split('.')[0].match(/[0#]/g) || []).length || 1;
  const decimals = ((sci.mant.split('.')[1] || '').match(/[0#]/g) || []).length;
  let exp = 0, m = x;
  if (x !== 0) {
    exp = Math.floor(Math.log10(x)) - (intPh - 1);
    m = shiftDec(x, -exp);
    if (roundHalfAway(m, decimals) >= 10 ** intPh) { exp++; m = shiftDec(x, -exp); } // 9.999 → 10.00: one more power
    else if (m < 10 ** (intPh - 1)) { exp--; m = shiftDec(x, -exp); } // log10 rounding just below a power of ten
  }
  const sign = exp < 0 ? '-' : sci.plus ? '+' : '';
  const mant = formatShape(numShape(numTokens(sci.mant)), roundHalfAway(m, decimals), false, locale);
  const rest = litText(numTokens(sci.rest));
  return `${mant}${sci.e}${sign}${String(Math.abs(exp)).padStart(sci.digits, '0')}${rest}`;
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
  // explicit group sizes, right to left: "#,##,##0" is [3, 2] (Indian lakh grouping in any locale); null = the locale's
  const sizes = [];
  for (let i = intCore.length - 1, n = 0; i >= 0; i--) { if (intCore[i].k === ',') { sizes.push(n); n = 0; } else if (ph(intCore[i])) n++; }
  const groups = sizes.length > 1 && sizes.some(n => n !== sizes[0]) && sizes.every(n => n > 0) ? sizes : null;
  capDigits('Format', frac.length); capDigits('Format', intPh.length);
  return {
    pre: toks.slice(0, first), post: toks.slice(last + 1).filter(t => t.k !== ','), int: intCore, frac,
    decimals: frac.length, minDec: lastZero + 1, minInt: z < 0 ? 0 : intPh.length - z,
    grouping: intCore.some(t => t.k === ','), groups, inner: intCore.some(t => t.k === 'lit'), scale,
    pct: toks.filter(t => t.k === '%').length, mille: toks.filter(t => t.k === 'lit' && t.s === '‰').length,
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
    body = out.join('') + (frac ? separators(locale).dec + frac : '');
    minus = minus && r !== 0;
  } else {
    body = nf(locale, { useGrouping: s.grouping && !s.groups, minimumFractionDigits: s.minDec, maximumFractionDigits: s.decimals, minimumIntegerDigits: Math.max(1, s.minInt) }).format(x);
    minus = minus && /[1-9]/.test(body);
    if (s.groups) body = body.replace(/^\d+/, (d) => { // the last size repeats
      const out = []; let k = 0;
      while (d.length > s.groups[Math.min(k, s.groups.length - 1)]) { const n = s.groups[Math.min(k++, s.groups.length - 1)]; out.unshift(d.slice(-n)); d = d.slice(0, -n); }
      return [d, ...out].join(separators(locale).grp);
    });
    if (s.minInt === 0) body = body.replace(/^0(?=\D|$)/, ''); // "#.##" shows .5, "#" shows nothing for 0
  }
  return (minus ? '-' : '') + litText(s.pre) + body + litText(s.post);
}

const dtfCache = new Map();
/** Month or weekday name in a non-English locale, of a wall date (read in UTC). English keeps the fixed tables. */
function localName(locale, kind, style, w) {
  const key = `${locale}|${kind}|${style}`;
  let f = dtfCache.get(key);
  if (f === undefined) {
    try { f = new Intl.DateTimeFormat(locale, { [kind]: style, timeZone: 'UTC' }); } catch { f = null; } // an unknown locale: English
    if (dtfCache.size >= 500) dtfCache.clear();
    dtfCache.set(key, f);
  }
  return f ? f.format(w) : null;
}
/** One part of a date formatted with Intl options (the wall date, UTC), or null. */
function localPart(locale, opts, w, type) {
  const key = `p|${locale}|${JSON.stringify(opts)}`;
  let f = dtfCache.get(key);
  if (f === undefined) { try { f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }); } catch { f = null; } if (dtfCache.size >= 500) dtfCache.clear(); dtfCache.set(key, f); }
  return f ? f.formatToParts(w).find(p => p.type === type)?.value ?? null : null;
}
/** The culture's date separator (en-US "/", de-DE ".", nl-NL "-"), as .NET's DateTimeFormatInfo.DateSeparator. */
function dateSep(locale) {
  const l = locale || 'en-US';
  const key = `sep|${l}`;
  let v = dtfCache.get(key);
  if (v === undefined) {
    try { v = new Intl.DateTimeFormat(l, { day: '2-digit', month: '2-digit', year: 'numeric', calendar: 'gregory', numberingSystem: 'latn', timeZone: 'UTC' }).formatToParts(new Date(Date.UTC(2026, 2, 5))).find(p => p.type === 'literal')?.value.trim() || '/'; } catch { v = '/'; }
    if (/[\u200e\u200f]/.test(v)) v = v.replace(/[\u200e\u200f]/g, '') || '/';
    dtfCache.set(key, v);
  }
  return v;
}
/** English locales keep the fixed English names (so existing reports never shift). */
export const english = (locale) => !locale || /^en\b/i.test(locale);

/**
 * .NET standard date formats (one letter). en-US (the default locale) has .NET's en-US patterns; another locale has
 * its own, read from Intl (CLDR): de-DE d is dd.MM.yyyy, ja-JP yyyy/MM/dd, fr-FR dd/MM/yyyy, with 4-digit years as
 * .NET writes them. s, u and o are the same everywhere.
 */
const US_DATES = { d: 'M/d/yyyy', D: 'dddd, MMMM d, yyyy', t: 'h:mm tt', T: 'h:mm:ss tt', M: 'MMMM d', Y: 'MMMM yyyy' };
const DAY_FIRST = { d: 'dd/MM/yyyy', D: 'dddd, dd MMMM yyyy', t: 'HH:mm', T: 'HH:mm:ss', M: 'dd MMMM', Y: 'MMMM yyyy' };
/** Where .NET's culture data (which SSRS uses) differs from CLDR in the short date. */
const NET_SHORT = { 'en-IN': 'dd-MM-yyyy' };
const INVARIANT = { s: "yyyy-MM-dd'T'HH:mm:ss", u: "yyyy-MM-dd HH:mm:ss'Z'", o: "yyyy-MM-dd'T'HH:mm:ss.fffffff" };
const patCache = new Map();
/** A .NET custom pattern from Intl's parts for the locale (5 March 2026 09:04:07 shows whether parts are padded). */
function intlPattern(locale, opts) {
  // Gregorian, Latin digits: fa-IR's Persian calendar and digits would read the month as a name (N15)
  const parts = new Intl.DateTimeFormat(locale, { ...opts, calendar: 'gregory', numberingSystem: 'latn', timeZone: 'UTC' }).formatToParts(new Date(Date.UTC(2026, 2, 5, 9, 4, 7)));
  const h12 = parts.some(p => p.type === 'dayPeriod');
  return parts.map(p => {
    const v = p.value;
    switch (p.type) {
      case 'year': return 'yyyy';
      case 'month': return /^[\d\u0660-\u0669\u06f0-\u06f9]+$/.test(v) ? (v.length > 1 ? 'MM' : 'M') : v.length > 4 || opts.month === 'long' ? 'MMMM' : 'MMM';
      case 'day': return v.length > 1 ? 'dd' : 'd';
      case 'weekday': return opts.weekday === 'long' ? 'dddd' : 'ddd';
      case 'hour': return h12 ? (v.length > 1 ? 'hh' : 'h') : v.length > 1 ? 'HH' : 'H';
      case 'minute': return 'mm';
      case 'second': return 'ss';
      case 'dayPeriod': return 'tt';
      default: return !v ? '' : v.includes("'") ? [...v].map(c => `\\${c}`).join('') : `'${v}'`; // literal text
    }
  }).join('');
}
/** The locale's d, D, t, T, M, Y patterns. */
function localePatterns(locale) {
  let p = patCache.get(locale);
  if (!p) {
    try {
      p = {
        d: NET_SHORT[locale] || intlPattern(locale, { dateStyle: 'short' }),
        D: intlPattern(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        t: intlPattern(locale, { hour: 'numeric', minute: '2-digit' }),
        T: intlPattern(locale, { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
        M: intlPattern(locale, { month: 'long', day: 'numeric' }),
        Y: intlPattern(locale, { year: 'numeric', month: 'long' }),
      };
    } catch { p = DAY_FIRST; } // an unknown locale
    if (patCache.size >= 200) patCache.clear();
    patCache.set(locale, p);
  }
  return p;
}
export function standardDate(fmt, locale) {
  const p = !locale || /^en-US$/i.test(locale) ? US_DATES : localePatterns(locale);
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
 * The parts are read on the wall clock of the time zone (tz; the host's when none is given).
 * @param {Date} d @param {string} fmt @param {string} [locale] month and day names follow it @param {string} [tz]
 */
export function formatDate(d, fmt, locale, tz) {
  if (fmt.length === 1) { const std = standardDate(fmt, locale); if (std) return formatDate(d, std, locale, tz); }
  if (fmt.length === 2 && fmt[0] === '%') fmt = fmt[1];
  const w = wallDate(d, tz);
  const en = english(locale);
  const name = (kind, style, fallback) => (en ? fallback : localName(locale, kind, style, w) ?? fallback);
  // with a day in the pattern, the month takes its format (genitive) form: ru "5 марта", pl "5 marca" (N14)
  const withDay = /(^|[^d])d{1,2}([^d]|$)/.test(fmt.replace(/'[^']*'|"[^"]*"/g, ' '));
  const month = (style, fallback) => {
    if (en) return fallback;
    if (withDay) { const g = localPart(locale, { day: 'numeric', month: style }, w, 'month'); if (g && !/^\d+$/.test(g)) return g; }
    return localName(locale, 'month', style, w) ?? fallback;
  };
  const p2 = (n) => String(n).padStart(2, '0');
  return fmt.replace(/(y+|M+|d+|H+|h+|m+|s+|f+|F+|t+|z+|\/)|'([^']*)'?|"([^"]*)"?|\\(.?)/g, (tok, run, q1, q2, esc) => {
    if (!run) return q1 ?? q2 ?? esc ?? '';
    const n = run.length;
    switch (run[0]) {
      case 'y': { const y = w.getUTCFullYear(); return n === 1 ? String(y % 100) : n === 2 ? p2(y % 100) : String(y).padStart(n, '0'); }
      case 'M': return n >= 4 ? month('long', MONTHS[w.getUTCMonth()]) : n === 3 ? month('short', MONTHS[w.getUTCMonth()].slice(0, 3)) : n === 2 ? p2(w.getUTCMonth() + 1) : String(w.getUTCMonth() + 1);
      case 'd': return n >= 4 ? name('weekday', 'long', DAYS[w.getUTCDay()]) : n === 3 ? name('weekday', 'short', DAYS[w.getUTCDay()].slice(0, 3)) : n === 2 ? p2(w.getUTCDate()) : String(w.getUTCDate());
      case 'H': return n >= 2 ? p2(w.getUTCHours()) : String(w.getUTCHours());
      case 'h': { const h = ((w.getUTCHours() + 11) % 12) + 1; return n >= 2 ? p2(h) : String(h); }
      case 'm': return n >= 2 ? p2(w.getUTCMinutes()) : String(w.getUTCMinutes());
      case 's': return n >= 2 ? p2(w.getUTCSeconds()) : String(w.getUTCSeconds());
      case 'f': case 'F': { // fractions of a second; a Date holds milliseconds, so digits past the third are 0
        const f = String(w.getUTCMilliseconds()).padStart(3, '0').padEnd(7, '0').slice(0, Math.min(n, 7));
        return run[0] === 'F' ? f.replace(/0+$/, '') : f;
      }
      case 't': { // the culture's designator: ko 오후, ja 午後, ar م (N16); English AM / PM
        const s = (en ? null : localPart(locale, { hour: 'numeric', hour12: true }, w, 'dayPeriod')) || (w.getUTCHours() < 12 ? 'AM' : 'PM');
        return n === 1 ? [...s][0] : s;
      }
      case '/': return dateSep(locale); // .NET: the culture's date separator (de-DE 05.03.2026); '/' or \/ for a slash (N17)
      case ':': return ':';
      case 'z': { // the zone's offset from UTC: z +5, zz +05, zzz +05:30
        const o = Math.round((w.getTime() - d.getTime()) / 60000), a = Math.abs(o), sg = o < 0 ? '-' : '+';
        return n === 1 ? `${sg}${Math.floor(a / 60)}` : n === 2 ? `${sg}${p2(Math.floor(a / 60))}` : `${sg}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
      }
    }
    return run;
  });
}
