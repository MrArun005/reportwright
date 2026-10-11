// @ts-check
// HTML export config, most specific first: viewer prop > report `export` > Settings page > env > default. docs/CONFIG.md
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
export const envHtmlExport = (env) => (env ? { html: env.PW_HTML_EXPORT, drillLinks: env.PW_HTML_DRILL_LINKS }
  : typeof process === 'undefined' ? {} : { html: process.env.PW_HTML_EXPORT, drillLinks: process.env.PW_HTML_DRILL_LINKS });

