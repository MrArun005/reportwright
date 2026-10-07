// @ts-check
import { pageToSvg, fontFamilyCss } from './svg.js';
import { safeUrl } from '../engine/url.js';
import { tablesData, DATA_SCRIPT, DATA_CSS, DATA_STRINGS, cspHash } from './htmldata.js';
import { needsTableData } from './regions.js';

/**
 * One self-contained HTML file: every page as inline SVG, fonts embedded as
 * base64 (subset when a subsetter is given). URLs open, bookmark jumps and TOC entries scroll to their target, and
 * drill-through opens the ReportWright viewer at drillBase (without one it is shown disabled).
 * Unless static, a file whose report has tables also gets a Tables view (htmldata.js): the tables as HTML, re-sorted on
 * their interactive-sort columns, groups opened and closed, rows filtered, by one inline script the file's CSP allows.
 * @param {any} model
 * @param {import('../engine/text/fonts.js').FontStore} fontStore
 * @param {{ title?: string, drillBase?: string, subset?: (font: Uint8Array, cps: Iterable<number>, o?: { layout?: boolean }) => Promise<Uint8Array>,
 *   static?: boolean, locale?: string, currency?: string, lang?: string, strings?: Partial<typeof DATA_STRINGS> }} [opt]
 */
export async function exportHtml(model, fontStore, opt = {}) {
  const used = new Map();
  const layout = new Set(); // fonts the browser shapes text in (Indic, Arabic, Hebrew): their subsets keep GSUB/GPOS
  const add = (key, text) => {
    let s = used.get(key);
    if (!s) { s = new Set([32]); used.set(key, s); }
    for (const ch of text) s.add(/** @type {number} */ (ch.codePointAt(0)));
  };
  for (const pg of model.pages) for (const it of pg.items.flatMap(i => (i.t === 'field' ? i.draw : [i]))) if (it.t === 'text') {
    for (const l of it.lines) {
      if (!l.runs) { add(it.font, l.text); continue; }
      for (const r of l.runs) { add(r.font, r.text); if (r.shaped || r.rtl) layout.add(r.font); }
    }
  }
  const faces = [];
  for (const [key, cps] of used) {
    let bytes = fontStore.bytes.get(key);
    if (!bytes) continue;
    if (opt.subset) { try { bytes = await opt.subset(bytes, cps, layout.has(key) ? { layout: true } : undefined); } catch { /* full font */ } }
    faces.push(`@font-face{font-family:"${fontFamilyCss(key)}";src:url(data:font/ttf;base64,${b64(bytes)}) format("truetype")}`);
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); // text content only (attributes use attr())
  // Links: URLs open; bookmark jumps and table-of-contents entries go to an anchor at the target's page and height
  // (as in the PDF); drill-through opens the report in the ReportWright viewer at opt.drillBase, or is shown disabled.
  const anchors = new Map(); // `${page}:${y}` → { id, page, y }
  const jumpTo = (a) => {
    const to = a.page ? a : model.bookmarks?.find(b => b.label === a.target) || model.headings?.find(b => b.label === a.target);
    if (!to?.page) return null;
    const y = Math.max(0, Math.round(to.y || 0));
    const key = `${to.page}:${y}`;
    if (!anchors.has(key)) anchors.set(key, { id: `at-${to.page}-${y}`, page: to.page, y });
    return `#${anchors.get(key).id}`;
  };
  const drillHref = (a) => {
    if (!opt.drillBase || !a.report) return null;
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(a.params || {})) for (const x of Array.isArray(v) ? v : [v]) q.append(k, x == null ? '' : String(x));
    const href = safeUrl(`${String(opt.drillBase).replace(/\/$/, '')}/viewer/${encodeURIComponent(a.report)}${q.size ? `?${q}` : ''}`);
    return href || null;
  };
  /** @returns {{ href: string, external?: boolean } | { off: string } | null} */
  const target = (a) => {
    if (a?.type === 'url') { const h = safeUrl(a.href); return h ? { href: h, external: true } : null; }
    if (a?.type === 'bookmark') { const h = jumpTo(a); return h ? { href: h } : null; }
    if (a?.type === 'drill') { const h = drillHref(a); return h ? { href: h, external: true } : { off: `Opens the report "${a.report}" in the ReportWright viewer` }; }
    return null; // sorting, open/close, filters: they run the report again, which a file cannot
  };
  const svgs = model.pages.map((p) => pageToSvg({ items: p.items.filter(it => it.t !== 'link' || target(it.action)) }, p.width ?? model.width, p.height ?? model.height, { proxyBase: opt.drillBase || '' }) // images by URL: through the server's data proxy
    .replace(/<rect class="pw-link"([^>]*?)data-action="([^"]*)"[^>]*>(<title>[^<]*<\/title>)?<\/rect>/g, (m, a, act, ttl = '') => {
      // the href comes from the action, never from the hover text (a tooltip can come from data)
      let t = null;
      try { t = target(JSON.parse(act.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&'))); } catch { /* not a link */ }
      if (t && 'href' in t) return `<a href="${attr(t.href)}"${t.external ? ' target="_blank" rel="noopener"' : ''}><rect${a}/>${ttl}</a>`;
      if (t && 'off' in t) return `<g class="pw-off"><rect${a}/><title>${esc(t.off)}</title></g>`;
      return `<rect${a}/>`;
    }));
  const pages = model.pages.map((p, i) => {
    const H = p.height ?? model.height;
    const marks = [...anchors.values()].filter(x => x.page === i + 1).map(x => `<a class="pw-at" id="${x.id}" style="top:${((Math.min(x.y, H) / H) * 100).toFixed(3)}%"></a>`).join('');
    return `<section class="page${p.width ? ' wide' : ''}" id="page-${i + 1}"${p.width ? ` style="width:min(100%,${Math.round(p.width * 96 / 72)}px)"` : ''}>${marks}${svgs[i]}</section>`;
  }).join('\n');
  if (!opt.static) needsTableData(model, 'Interactive HTML (or pass static: true)');
  const data = opt.static ? null : tablesData(model, { locale: opt.locale, currency: opt.currency });
  const S = { ...DATA_STRINGS, ...(opt.strings || {}) };
  const csp = data ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${await cspHash(DATA_SCRIPT)}'; style-src 'unsafe-inline'; font-src data:; img-src data: https: http:; base-uri 'none'; form-action 'none'">\n` : '';
  const lang = opt.lang && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(opt.lang) ? opt.lang : 'en';
  return `<!doctype html>
<html lang="${data ? lang : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${csp}<title>${esc(opt.title || model.name || 'Report')}</title>
<style>
${faces.join('\n')}
html{background:#e6eaee}body{margin:0;padding:24px 12px;display:flex;flex-direction:column;align-items:center;gap:18px;font-family:system-ui,sans-serif}
.page{position:relative;width:min(100%,${Math.round(model.width * 96 / 72)}px);background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08),0 6px 20px rgba(0,0,0,.08)}
.pw-at{position:absolute;left:0;width:1px;height:1px;scroll-margin-top:12px}.pw-off{cursor:not-allowed}
.page svg{display:block;width:100%;height:auto}
@media print{html{background:#fff}body{padding:0;gap:0}.page{box-shadow:none;width:100%;break-after:page}@page{size:${model.width}pt ${model.height}pt;margin:0}}
${data ? DATA_CSS + '\n' : ''}</style></head><body>
${data ? `<nav class="pw-bar" id="pw-bar" hidden><button type="button" data-view="pages" aria-pressed="true">${esc(S.pages)}</button><button type="button" data-view="tables" aria-pressed="false">${esc(S.tables)}</button></nav>\n` : ''}${pages}
${data ? `<div id="pw-tables" hidden></div>
<script type="application/json" id="pw-data">${JSON.stringify({ tables: data, strings: S }).replace(/</g, '\\u003c')}</script>
<script>${DATA_SCRIPT}</script>
` : ''}</body></html>`;
}

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
function b64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, /** @type {any} */ (u8.subarray(i, i + 0x8000)));
  return btoa(s);
}
