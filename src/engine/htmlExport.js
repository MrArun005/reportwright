// @ts-check
// How an HTML export is made, at every level. Most specific wins:
//   viewer prop exportOptions > report definition `export: { html, drillLinks }` > admin setting (Settings page)
//   > env PW_HTML_EXPORT / PW_HTML_DRILL_LINKS > default (interactive, inline).
// The viewer user's choice in the Export options panel then applies per export.
//   html:       interactive (the whole viewer in one file) | tables (pages + sortable tables) | static (pages only, print)
//   drillLinks: inline (open in place / same tab) | new-tab | off (shown disabled)
export const HTML_MODES = ['interactive', 'tables', 'static'];
export const DRILL_LINKS = ['inline', 'new-tab', 'off'];
export const HTML_EXPORT_DEFAULTS = Object.freeze({ html: 'interactive', drillLinks: 'inline' });

/**
 * The HTML export config from layers, most specific first. Unknown or empty values fall through to the next layer.
 * @param {...({ html?: any, drillLinks?: any } | null | undefined)} layers
 * @returns {{ html: 'interactive'|'tables'|'static', drillLinks: 'inline'|'new-tab'|'off' }}
 */
export function resolveHtmlExport(...layers) {
  const pick = (k, ok) => { for (const l of layers) if (l && ok.includes(l[k])) return l[k]; return HTML_EXPORT_DEFAULTS[k]; };
  return /** @type {any} */ ({ html: pick('html', HTML_MODES), drillLinks: pick('drillLinks', DRILL_LINKS) });
}

/** The env layer. @param {Record<string, string | undefined>} [env] */
export const envHtmlExport = (env = typeof process !== 'undefined' ? process.env : {}) => ({ html: env.PW_HTML_EXPORT, drillLinks: env.PW_HTML_DRILL_LINKS });

/**
 * Whether a drill base is a URL a client who receives the file can open: http(s), not localhost, 127.x, ::1 or 0.0.0.0.
 * @param {string | undefined | null} base
 */
export function isPublicBase(base) {
  if (!base) return false;
  let u;
  try { u = new URL(base); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return !(h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || h === '::1' || h === '0.0.0.0');
}

/** Set or clear one key of a definition's `export` (the designer's Report properties); no empty object is left. @param {any} def @param {'html'|'drillLinks'} k @param {string} v */
export function setExport(def, k, v) {
  if (v) { def.export ||= {}; def.export[k] = v; } else if (def.export) { delete def.export[k]; if (!Object.keys(def.export).length) delete def.export; }
}
