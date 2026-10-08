// @ts-check
/**
 * The one allow-list for links the engine emits (url actions, rich text <a href>), checked on the exact
 * string that is emitted. Browsers and PDF readers parse URLs leniently (they drop tabs and newlines before
 * the scheme, read "\" as "/", take "https:x" and "//host" as absolute), so the rule is strict:
 * - no character at or below U+0020, no DEL or C1 control, no backslash;
 * - http:// or https:// with a host (double slash required), or mailto:;
 * - a relative path that starts with one "/" (not "//").
 * @param {unknown} v
 * @returns {string|null} v itself when allowed, else null
 */
export function safeUrl(v) {
  if (typeof v !== 'string' || !v || v.length > 8192) return null;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c <= 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x5c) return null;
  }
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? v : null;
    } catch { return null; }
  }
  if (/^mailto:/i.test(v)) return v;
  if (v[0] === '/' && v[1] !== '/') return v;
  return null;
}

/**
 * A drill-through's address in the ReportWright viewer: `<base>/viewer/<report>?<parameters>` (a list parameter
 * repeats its name), checked by safeUrl; null without a base URL or a report. The HTML and PDF exports link to it.
 * @param {string|undefined|null} base @param {{ report?: string, params?: Record<string, any> }} a @returns {string|null}
 */
export function drillUrl(base, a) {
  if (!base || !a?.report) return null;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(a.params || {})) for (const x of Array.isArray(v) ? v : [v]) q.append(k, x == null ? '' : String(x));
  const s = q.toString();
  return safeUrl(`${String(base).replace(/\/$/, '')}/viewer/${encodeURIComponent(a.report)}${s ? `?${s}` : ''}`);
}

/** A URL as a PDF URI action may hold it: 7-bit ASCII (an international host as punycode, other characters
 *  percent-encoded). @param {string} href @returns {string} */
export function asciiUrl(href) {
  try { return new URL(href).href; } catch { return encodeURI(href); }
}
