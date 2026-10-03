// @ts-check
import { pageToSvg, fontFamilyCss } from './svg.js';

/**
 * One self-contained HTML file: every page as inline SVG, fonts embedded as
 * base64 (subset when a subsetter is given), links still clickable for URLs.
 * @param {any} model
 * @param {import('../engine/text/fonts.js').FontStore} fontStore
 * @param {{ title?: string, subset?: (font: Uint8Array, cps: Iterable<number>, o?: { layout?: boolean }) => Promise<Uint8Array> }} [opt]
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
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const pages = model.pages.map((p, i) => `<section class="page" id="page-${i + 1}">${pageToSvg({ items: p.items.filter(it => it.t !== 'link' || it.action?.type === 'url') }, model.width, model.height)
    .replace(/<rect class="pw-link"([^>]*?)data-action="([^"]*)"[^>]*><title>([^<]*)<\/title><\/rect>/g, (m, a, act, ttl) => `<a href="${ttl}" target="_blank" rel="noopener"><rect${a}/></a>`)}</section>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opt.title || model.name || 'Report')}</title>
<style>
${faces.join('\n')}
html{background:#e6eaee}body{margin:0;padding:24px 12px;display:flex;flex-direction:column;align-items:center;gap:18px;font-family:system-ui,sans-serif}
.page{width:min(100%,${Math.round(model.width * 96 / 72)}px);background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08),0 6px 20px rgba(0,0,0,.08)}
.page svg{display:block;width:100%;height:auto}
@media print{html{background:#fff}body{padding:0;gap:0}.page{box-shadow:none;width:100%;break-after:page}@page{size:${model.width}pt ${model.height}pt;margin:0}}
</style></head><body>
${pages}
</body></html>`;
}

function b64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, /** @type {any} */ (u8.subarray(i, i + 0x8000)));
  return btoa(s);
}
