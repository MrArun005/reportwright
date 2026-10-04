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
