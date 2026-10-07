// @ts-check
import { evalValue, toText } from '../expr/evaluate.js';
import { resolveFontKey } from '../text/fonts.js';

/**
 * Map item: shapes from GeoJSON (inline text, or a data set of features), filled by a value
 * joined on a key (choropleth), line layers (LineString, MultiLineString), plus point markers sized
 * by a value. Web Mercator, fitted to everything drawn. No map data ships with ReportWright: bring your own GeoJSON.
 * Page-model output only (path, ellipse, rect, text), so every exporter draws it.
 * A click on a region can drill through or set parameters (regionAction, like a chart's pointAction).
 * Deliberately no tile/basemap layer: tiles need a network at render time and do not print to a PDF
 * offline; the shapes and lines are the map.
 */

const LEGEND_H = 20;
/** Caps on untrusted GeoJSON and rows; each warns when it bites. */
export const MAP_CAPS = { shapes: 5000, coords: 200000, points: 10000, classes: 9 };
const MAX_LAT = 85.0511; // Web Mercator stops here

/** @returns {number[][][] | null} lines → [lon, lat] */
export function linesOf(g) {
  const line = (l) => Array.isArray(l) && l.length >= 2 && l.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (g?.type === 'LineString' && line(g.coordinates)) return [g.coordinates];
  if (g?.type === 'MultiLineString' && Array.isArray(g.coordinates) && g.coordinates.length && g.coordinates.every(line)) return g.coordinates;
  return null;
}

/** @returns {number[][][][] | null} polygons → rings → [lon, lat] */
export function polygonsOf(g) {
  const ring = (r) => Array.isArray(r) && r.length >= 3 && r.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const poly = (p) => Array.isArray(p) && p.length > 0 && p.every(ring);
  if (g?.type === 'Polygon' && poly(g.coordinates)) return [g.coordinates];
  if (g?.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length && g.coordinates.every(poly)) return g.coordinates;
  return null;
}

const project = (lon, lat) => {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return [(lon * Math.PI) / 180, Math.log(Math.tan(Math.PI / 4 + phi / 2))];
};

const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '')); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const r2 = (v) => Math.round(v * 100) / 100;

export function paintMap(item, ctx, lc, base) {
  const who = item.name || 'Map';
  const warn = (msg) => lc.warn(`${who}: ${msg}`);
  const ev = (v, c) => { if (v == null || v === '') return null; try { return evalValue(v, c); } catch (e) { warn(e.message); return null; } };
  const rowsOf = (name) => { const r = lc.dataSets[name]; if (!r) warn(`the data set "${name}" does not exist`); return r || []; };

  /* shapes and lines, within the caps */
  const shapes = [], lines = [];
  let coords = 0, capped = '';
  const count = (parts) => { let n = 0; for (const p of parts) n += p.length; return n; };
  const addShape = (key, geom, row) => {
    if (capped) return;
    if (shapes.length + lines.length >= MAP_CAPS.shapes) { capped = 'shapes'; warn(`more than ${MAP_CAPS.shapes.toLocaleString('en-US')} shapes; the rest are not drawn`); return; }
    const polys = polygonsOf(geom);
    const ls = polys ? null : linesOf(geom);
    if (!polys && !ls) { warn(`the shape "${key ?? '?'}" has no Polygon, MultiPolygon, LineString or MultiLineString geometry`); return; }
    const n = polys ? polys.reduce((a, p) => a + count(p), 0) : count(ls);
    if (coords + n > MAP_CAPS.coords) { warn(`more than ${MAP_CAPS.coords.toLocaleString('en-US')} coordinates; the shape "${key ?? '?'}" and those after it are not drawn`); capped = 'coords'; return; }
    coords += n;
    const k = key == null ? null : String(key);
    if (polys) shapes.push({ key: k, polys, row }); else lines.push({ key: k, lines: ls, row });
  };
  if (item.dataSet) {
    for (const r of rowsOf(item.dataSet)) {
      const c = { ...ctx, fields: r };
      addShape(ev(item.shapeKey, c), ev(item.geometry || '=Fields.geometry', c), r);
    }
  } else if (item.geojson) {
    let gj = null;
    try { gj = typeof item.geojson === 'string' ? JSON.parse(item.geojson) : item.geojson; } catch { warn('the GeoJSON text is not valid JSON'); }
    const features = gj?.type === 'FeatureCollection' ? gj.features || [] : gj?.type === 'Feature' ? [gj] : gj ? [{ properties: {}, geometry: gj }] : [];
    for (const f of features) addShape(item.shapeKey ? ev(item.shapeKey, { ...ctx, fields: f?.properties || {} }) : f?.properties?.name, f?.geometry, f?.properties || {});
  }

  /* values joined on the shape key: one aggregate per key */
  const values = new Map(), groupsOf = new Map();
  if (item.valueDataSet) {
    const groups = new Map();
    for (const r of rowsOf(item.valueDataSet)) {
      const k = String(ev(item.valueKey, { ...ctx, fields: r }));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const [k, g] of groups) {
      groupsOf.set(k, g);
      const v = ev(item.value, { ...ctx, fields: g[0], aggRows: g });
      if (typeof v === 'number' && Number.isFinite(v)) values.set(k, v);
    }
  }

  /* points */
  const points = [];
  if (item.pointDataSet) {
    let prs = rowsOf(item.pointDataSet);
    if (prs.length > MAP_CAPS.points) { warn(`${prs.length} points; only the first ${MAP_CAPS.points.toLocaleString('en-US')} are drawn`); prs = prs.slice(0, MAP_CAPS.points); }
    for (const r of prs) {
      const c = { ...ctx, fields: r };
      const lat = Number(ev(item.lat, c)), lon = Number(ev(item.lon, c));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const size = item.pointSize ? Number(ev(item.pointSize, c)) : null;
      points.push({ lat, lon, size: Number.isFinite(size) ? size : null, label: item.pointLabel ? ev(item.pointLabel, c) : null });
    }
  }

  const out = [];
  const font = resolveFontKey(base.fontFamily, 'normal', 'normal');
  const fs = Math.max(6, Number(item.fontSize) || 7);
  const text = (s, x, y, align = 'left') => {
    const str = String(s), w = lc.m.width(str, font, fs);
    out.push({ t: 'text', font, size: fs, color: '#374151', lines: [{ x: align === 'right' ? x - w : x, y, text: str, w }] });
  };

  /* fit everything into the item, keeping proportions */
  const pts = [...shapes.flatMap(s => s.polys.flat(2)), ...lines.flatMap(l => l.lines.flat(1)), ...points.map(p => [p.lon, p.lat])].map(([lon, lat]) => project(lon, lat));
  if (!pts.length) { text('No shapes or points to draw', item.x + 4, fs + 4); return out; }
  const showLegend = item.legend !== 'none' && values.size > 0;
  const H = item.h - (showLegend ? LEGEND_H : 0), W = item.w, pad = 4;
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const spanX = x1 - x0 || 0.01, spanY = y1 - y0 || 0.01;
  const k = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
  const ox = item.x + (W - spanX * k) / 2, oy = (H - spanY * k) / 2;
  const toXY = (lon, lat) => { const [x, y] = project(lon, lat); return [ox + (x - x0) * k, oy + (y1 - y) * k]; };

  /* shapes, filled low → high */
  let lo = Infinity, hi = -Infinity;
  for (const v of values.values()) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const low = item.colorLow || '#dbeafe', high = item.colorHigh || '#1e3a8a';
  // graduated (classes): k classes of equal width, each one colour; else a continuous (heat) scale
  const nk = item.colorScale === 'classes' ? Math.max(2, Math.min(MAP_CAPS.classes, Math.round(Number(item.classes)) || 5)) : 0;
  const classOf = (v) => Math.min(nk - 1, Math.max(0, Math.floor(hi > lo ? ((v - lo) / (hi - lo)) * nk : nk - 1)));
  const colorOf = (v) => (nk ? mix(low, high, classOf(v) / (nk - 1)) : mix(low, high, hi > lo ? (v - lo) / (hi - lo) : 1));
  const fmt = (v) => toText(v, item.valueFormat, ctx);
  const pathOf = (parts, close, dx) => parts.map(ring => ring.map(([lon, lat], i) => { const [x, y] = toXY(lon, lat); return `${i ? 'L' : 'M'} ${r2(x - dx)} ${r2(y)}`; }).join(' ') + (close ? ' Z' : '')).join(' ');
  const links = [];
  for (const s of shapes) {
    const v = s.key == null ? undefined : values.get(s.key);
    const fill = v === undefined ? (values.size ? item.fillEmpty || '#e5e7eb' : item.fill || '#cbd5e1') : colorOf(v);
    const rings = s.polys.flat(1);
    out.push({ t: 'path', x: item.x, y: 0, d: pathOf(rings, true, item.x), fill, stroke: item.stroke || '#ffffff', strokeWidth: 0.5, shape: s.key });
    // a click on the region: its scope is the value rows joined to it (else the feature's own properties)
    const g = s.key == null ? null : groupsOf.get(s.key);
    const rctx = { ...ctx, fields: g?.[0] || s.row || null, aggRows: g || (s.row ? [s.row] : []), aggIndex: undefined };
    const tip = item.tooltips === false || s.key == null ? null : v === undefined ? s.key : `${s.key}: ${fmt(v)}`;
    let l = item.regionAction?.type && item.regionAction.type !== 'none' ? lc.linkFor?.({ action: item.regionAction, name: item.name }, rctx, null) : null;
    if (!l && !tip) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of rings) for (const [lon, lat] of ring) { const [x, y] = toXY(lon, lat); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    l = { ...(l || { t: 'link', action: null }), x: x0, y: y0, w: x1 - x0, h: y1 - y0, d: pathOf(rings, true, 0), x0, y0 };
    if (tip) l.tip = tip;
    links.push(l);
  }
  /* line layers: strokes, coloured by the joined value when there is one */
  for (const ln of lines) {
    const v = ln.key == null ? undefined : values.get(ln.key);
    out.push({ t: 'path', x: item.x, y: 0, d: pathOf(ln.lines, false, item.x), fill: null, stroke: v === undefined ? item.lineColor || '#2563eb' : colorOf(v), strokeWidth: Number(item.lineWidth) > 0 ? Math.min(20, Number(item.lineWidth)) : 1.2, shape: ln.key });
  }

  /* points: area grows with the value */
  const maxSize = points.reduce((m, p) => Math.max(m, p.size || 0), 0);
  const maxR = Number(item.pointMaxRadius) || 8;
  for (const p of points) {
    const [cx, cy] = toXY(p.lon, p.lat);
    const r = p.size != null && maxSize > 0 ? Math.max(1, maxR * Math.sqrt(Math.max(0, p.size) / maxSize)) : 3;
    out.push({ t: 'ellipse', cx, cy, rx: r, ry: r, fill: item.pointColor || '#dc2626', stroke: '#ffffff', strokeWidth: 0.5 });
    if (p.label != null && p.label !== '') text(p.label, cx + r + 2, cy + fs / 3);
  }

  /* legend: classes with their ranges (graduated), or a gradient from the lowest to the highest value (heat) */
  if (showLegend) {
    const ly = H + 4;
    if (nk) {
      const step = (hi - lo) / nk;
      const labels = Array.from({ length: nk }, (_, i) => `${fmt(lo + step * i)} – ${fmt(i === nk - 1 ? hi : lo + step * (i + 1))}`);
      const ws = labels.map(s => 10 + lc.m.width(s, font, fs) + 8);
      let lx = item.x + Math.max(0, (W - ws.reduce((a, b) => a + b, 0)) / 2);
      labels.forEach((s, i) => { out.push({ t: 'rect', x: lx, y: ly, w: 8, h: 8, fill: mix(low, high, i / (nk - 1)) }); text(s, lx + 10, ly + 7); lx += ws[i]; });
    } else {
      const n = 20, sw = 4;
      const lx = item.x + (W - sw * n) / 2;
      for (let i = 0; i < n; i++) out.push({ t: 'rect', x: lx + i * sw, y: ly, w: sw + 0.2, h: 8, fill: mix(low, high, i / (n - 1)) });
      text(fmt(lo), lx - 4, ly + 7, 'right');
      text(fmt(hi), lx + n * sw + 4, ly + 7);
    }
  }
  return out.concat(links);
}
