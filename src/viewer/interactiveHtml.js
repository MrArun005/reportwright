'use client';
// Interactive HTML export: one file that carries the viewer, the report definitions it can drill into,
// the report fonts and a snapshot of the data. Open it in any browser: parameters, open/close, sorting,
// chart clicks, tooltips, document map and drill-through keep working. Live data sources are called again
// when the file is opened; the snapshot is the fallback when a call fails (offline, CORS, server gone).
import { reportFetch } from './dataFetch.js';
import { origin, fetchReport, customFonts } from './engineClient.js';
import { ALL_FONT_KEYS, SHAPER, fontFile } from '@/engine/text/fonts.js';
import { fontKeysOf } from '@/exporters/svg.js';
import { loadSources } from '@/engine/data/index.js';
import { resolveParameters } from '@/engine/index.js';
import { reuseRefs, drillRefs } from '@/engine/reuse.js';
import { pruneSnapshot } from './logic.js';

const toB64 = (buf) => {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const getBuf = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.arrayBuffer(); };

/** Report ids this definition can open or reuses: drill-through actions, subreports, its master, part libraries,
 *  stylesheet and theme (fixed ids only, not expressions). */
export function reachableReportIds(def) {
  const out = reuseRefs(def);
  for (const r of drillRefs(def)) out.add(r.report);
  return out;
}

/** Every report reachable by drilling, however deep (cycles are fine). */
async function collectReports(def, rootId) {
  const reports = {};
  if (rootId) reports[rootId] = def;
  const queue = [...reachableReportIds(def)];
  const missing = [];
  while (queue.length) {
    const id = queue.shift();
    if (reports[id] || missing.includes(id)) continue;
    try {
      const d = await fetchReport(id);
      reports[id] = d;
      queue.push(...reachableReportIds(d));
    } catch { missing.push(id); }
  }
  return { reports, missing };
}

/**
 * The data the report used right now, plus the data behind every drill-through link on its pages
 * (one level down), keyed by the exact URL. Offline, those clicks still open with real data.
 */
const MAX_DRILL_SNAPSHOTS = 250;
async function snapshotData(def, params, model, reports) {
  const snapshot = {};
  const base = origin();
  const recording = async (url, init) => {
    if (url in snapshot) return new Response(JSON.stringify(snapshot[url]), { status: 200, headers: { 'content-type': 'application/json' } });
    const res = await reportFetch(base)(url, init);
    if (res.ok) { try { snapshot[url] = await res.clone().json(); } catch { /* not JSON (CSV): no snapshot */ } }
    return res;
  };
  const load = async (d, p) => { try { await loadSources(d, { params: resolveParameters(d, p, { lenient: true }), fetch: recording, baseUrl: base }); } catch { /* skip */ } };
  await load(def, params);
  const seen = new Set(), jobs = [];
  for (const pg of model?.pages || []) for (const it of pg.items) {
    const a = it.t === 'link' && it.action;
    if (!a || a.type !== 'drill' || !reports[a.report]) continue;
    const key = a.report + JSON.stringify(a.params || {});
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push([reports[a.report], Object.fromEntries(Object.entries(a.params || {}).map(([k, v]) => [k, v == null ? '' : String(v)]))]);
  }
  const todo = jobs.slice(0, MAX_DRILL_SNAPSHOTS);
  for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(([d, p]) => load(d, p)));
  return { snapshot, drillTargets: jobs.length, drillSnapshots: todo.length };
}

/**
 * @param {any} def report definition
 * @param {{ params?: Record<string,string>, reportId?: string, lang?: string, model?: any }} opt
 * @returns {Promise<{ html: string, info: { reports: number, missing: string[], bytes: number } }>}
 */
export async function exportInteractiveHtml(def, opt = {}) {
  const base = origin();
  // the single-file bundle (the loader in pagewright-viewer.js would need the server)
  const bundleRes = await fetch(`${base}/embed/pagewright-viewer.full.js`);
  if (!bundleRes.ok) throw Object.assign(new Error('The viewer bundle is missing. Run "npm run build:embed" (it also runs in "npm run build").'), { code: 'NO_BUNDLE' });
  const bundle = (await bundleRes.text()).replace(/<\/script/gi, '<\\/script');

  // the default fonts, the ones this view draws with (fallbacks, uploaded fonts) and the shaper when text needs it
  const used = fontKeysOf(opt.model);
  const shaped = (opt.model?.pages || []).some(pg => pg.items.some(it => it.t === 'text' && it.lines.some(l => l.runs?.some(r => r.shaped || r.rtl))));
  const keys = [...new Set([...ALL_FONT_KEYS, ...used, ...(shaped ? [SHAPER] : [])])];
  const fonts = {};
  await Promise.all(keys.map(async (k) => { fonts[k] = toB64(await getBuf(`${base}/fonts/${fontFile(k)}`)); }));
  const uploaded = (await customFonts()).filter(f => keys.includes(`u-${f.id}`));

  // interface font (Latin only, to keep the file small); falls back to the system font for other scripts
  let uiCss = '';
  try {
    const faces = [['PW UI', 'ibm-plex-sans-latin-400-normal', 400], ['PW UI', 'ibm-plex-sans-latin-600-normal', 600], ['PW Mono', 'ibm-plex-mono-latin-400-normal', 400]];
    const parts = await Promise.all(faces.map(async ([fam, file, w]) => `@font-face{font-family:"${fam}";src:url(data:font/woff2;base64,${toB64(await getBuf(`${base}/fonts/ui/${file}.woff2`))}) format("woff2");font-weight:${w};font-display:swap}`));
    uiCss = parts.join('\n');
  } catch { /* system font */ }

  const { reports, missing } = await collectReports(def, opt.reportId);
  const { snapshot: raw, drillTargets, drillSnapshots } = await snapshotData(def, opt.params || {}, opt.model, reports);
  const snapshot = pruneSnapshot(raw, [def, ...Object.values(reports)]); // only the values a report can read, not whole data sets

  const config = {
    server: base, definition: def, params: opt.params || {}, lang: opt.lang || 'en', reports, fonts, customFonts: uploaded, uiFontCss: uiCss, snapshot,
    height: '100vh', title: def.name,
  };
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html>
<html lang="${esc(opt.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(def.name || 'Report')}</title>
<meta name="generator" content="Pagewright interactive HTML">
<style>html,body{margin:0;height:100%;background:#e6eaee}#report{height:100vh}#report-note{position:fixed;right:8px;bottom:6px;font:11px system-ui,sans-serif;color:#5f6b77;pointer-events:none}</style>
</head><body>
<div id="report"></div>
<div id="report-note">Exported ${esc(new Date().toLocaleString())} · data refreshes when online</div>
<script>${bundle}</script>
<script type="application/json" id="pw-config">${json}</script>
<script>
(function(){var c=JSON.parse(document.getElementById('pw-config').textContent);
var el=document.getElementById('report');var s=el.style;s.height='100vh';
Pagewright.mountViewer(el,c);})();
</script>
</body></html>`;
  return { html, info: { reports: Object.keys(reports).length || 1, missing, bytes: html.length, drillTargets, drillSnapshots } };
}
