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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * @param {any} value
 * @param {string|undefined|null} fmt
 * @param {{locale?: string, currency?: string}} [opt]
 */
export function formatValue(value, fmt, opt = {}) {
  const locale = opt.locale || 'en-IN';
  const currency = opt.currency || 'INR';
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : formatDate(value, fmt || 'dd MMM yyyy');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    // No format: plain digits, no grouping (a year stays 2026). Use N0/N2/C2 to group.
    if (!fmt) return nf('en-US', { maximumFractionDigits: 10, useGrouping: false }).format(value);
    const m = /^([CcNnFfPpDdEe])(\d{0,2})$/.exec(fmt);
    if (m) {
      const k = m[1].toUpperCase();
      const d = m[2] === '' ? null : Number(m[2]);
      switch (k) {
        case 'C': return nf(locale, { style: 'currency', currency, minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 }).format(value);
        case 'N': return nf(locale, { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 }).format(value);
        case 'F': return value.toFixed(d ?? 2);
        case 'P': return nf(locale, { style: 'percent', minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 }).format(value);
        case 'D': return String(Math.trunc(value)).padStart(d ?? 0, '0');
        case 'E': return value.toExponential(d ?? 6);
      }
    }
    if (/[#0]/.test(fmt)) return customNumber(value, fmt, locale);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string' && fmt && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime()) && /[yMd]/.test(fmt)) return formatDate(d, fmt);
  }
  return String(value);
}

function customNumber(v, fmt, locale) {
  const pct = fmt.includes('%');
  if (pct) v *= 100;
  const [, prefix = '', body, suffix = ''] = /^([^#0,.]*)([#0,.]+)(.*)$/.exec(fmt) || [null, '', fmt, ''];
  const dot = body.indexOf('.');
  const decimals = dot >= 0 ? body.length - dot - 1 : 0;
  const minDec = dot >= 0 ? (body.slice(dot + 1).match(/0/g) || []).length : 0;
  const grouping = body.includes(',');
  const intPart = dot >= 0 ? body.slice(0, dot) : body;
  const minInt = (intPart.match(/0/g) || []).length || 1;
  const s = nf(locale, { useGrouping: grouping, minimumFractionDigits: minDec, maximumFractionDigits: decimals, minimumIntegerDigits: minInt }).format(v);
  return prefix + s + suffix;
}

/** @param {Date} d @param {string} fmt */
export function formatDate(d, fmt) {
  if (fmt === 'd') return formatDate(d, 'dd/MM/yyyy');
  if (fmt === 'D') return formatDate(d, 'dddd, dd MMMM yyyy');
  if (fmt === 'g') return formatDate(d, 'dd/MM/yyyy HH:mm');
  return fmt.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|ss|tt|'[^']*'/g, (tok) => {
    switch (tok) {
      case 'yyyy': return String(d.getFullYear());
      case 'yy': return String(d.getFullYear()).slice(-2);
      case 'MMMM': return MONTHS[d.getMonth()];
      case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
      case 'MM': return String(d.getMonth() + 1).padStart(2, '0');
      case 'M': return String(d.getMonth() + 1);
      case 'dddd': return DAYS[d.getDay()];
      case 'ddd': return DAYS[d.getDay()].slice(0, 3);
      case 'dd': return String(d.getDate()).padStart(2, '0');
      case 'd': return String(d.getDate());
      case 'HH': return String(d.getHours()).padStart(2, '0');
      case 'H': return String(d.getHours());
      case 'hh': return String(((d.getHours() + 11) % 12) + 1).padStart(2, '0');
      case 'h': return String(((d.getHours() + 11) % 12) + 1);
      case 'mm': return String(d.getMinutes()).padStart(2, '0');
      case 'ss': return String(d.getSeconds()).padStart(2, '0');
      case 'tt': return d.getHours() < 12 ? 'AM' : 'PM';
      default: return tok.slice(1, -1);
    }
  });
}
