// @ts-check
import { evalValue, toText } from '../expr/evaluate.js';
import { resolveFontKey } from '../text/fonts.js';

/**
 * Map item: shapes from GeoJSON (inline text, or a data set of features), filled by a value
 * joined on a key (choropleth), plus point markers sized by a value. Web Mercator, fitted to
 * everything drawn. No map data ships with Pagewright: bring your own GeoJSON.
 * Page-model output only (path, ellipse, rect, text), so every exporter draws it.
 */

const LEGEND_H = 20;
const MAX_LAT = 85.0511; // Web Mercator stops here

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

  /* shapes */
  const shapes = [];
  const addShape = (key, geom) => {
    const polys = polygonsOf(geom);
    if (polys) shapes.push({ key: key == null ? null : String(key), polys });
    else warn(`the shape "${key ?? '?'}" has no Polygon or MultiPolygon geometry`);
  };
  if (item.dataSet) {
    for (const r of rowsOf(item.dataSet)) {
      const c = { ...ctx, fields: r };
      addShape(ev(item.shapeKey, c), ev(item.geometry || '=Fields.geometry', c));
    }
  } else if (item.geojson) {
    let gj = null;
    try { gj = typeof item.geojson === 'string' ? JSON.parse(item.geojson) : item.geojson; } catch { warn('the GeoJSON text is not valid JSON'); }
    const features = gj?.type === 'FeatureCollection' ? gj.features || [] : gj?.type === 'Feature' ? [gj] : gj ? [{ properties: {}, geometry: gj }] : [];
    for (const f of features) addShape(item.shapeKey ? ev(item.shapeKey, { ...ctx, fields: f.properties || {} }) : f.properties?.name, f.geometry);
  }

  /* values joined on the shape key: one aggregate per key */
  const values = new Map();
  if (item.valueDataSet) {
    const groups = new Map();
    for (const r of rowsOf(item.valueDataSet)) {
      const k = String(ev(item.valueKey, { ...ctx, fields: r }));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const [k, g] of groups) {
      const v = ev(item.value, { ...ctx, fields: g[0], aggRows: g });
      if (typeof v === 'number' && Number.isFinite(v)) values.set(k, v);
    }
  }

  /* points */
  const points = [];
  if (item.pointDataSet) {
    for (const r of rowsOf(item.pointDataSet)) {
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
  const pts = [...shapes.flatMap(s => s.polys.flat(2)), ...points.map(p => [p.lon, p.lat])].map(([lon, lat]) => project(lon, lat));
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
  for (const s of shapes) {
    const v = s.key == null ? undefined : values.get(s.key);
    const fill = v === undefined ? (values.size ? item.fillEmpty || '#e5e7eb' : item.fill || '#cbd5e1') : mix(low, high, hi > lo ? (v - lo) / (hi - lo) : 1);
    const d = s.polys.flat(1).map(ring => ring.map(([lon, lat], i) => { const [x, y] = toXY(lon, lat); return `${i ? 'L' : 'M'} ${r2(x - item.x)} ${r2(y)}`; }).join(' ') + ' Z').join(' ');
    out.push({ t: 'path', x: item.x, y: 0, d, fill, stroke: item.stroke || '#ffffff', strokeWidth: 0.5, shape: s.key });
  }

  /* points: area grows with the value */
  const maxSize = Math.max(0, ...points.map(p => p.size || 0));
  const maxR = Number(item.pointMaxRadius) || 8;
  for (const p of points) {
    const [cx, cy] = toXY(p.lon, p.lat);
    const r = p.size != null && maxSize > 0 ? Math.max(1, maxR * Math.sqrt(Math.max(0, p.size) / maxSize)) : 3;
    out.push({ t: 'ellipse', cx, cy, rx: r, ry: r, fill: item.pointColor || '#dc2626', stroke: '#ffffff', strokeWidth: 0.5 });
    if (p.label != null && p.label !== '') text(p.label, cx + r + 2, cy + fs / 3);
  }

  /* legend: five steps between the lowest and highest value */
  if (showLegend) {
    const ly = H + 4, sw = 16;
    const lx = item.x + (W - sw * 5) / 2;
    for (let i = 0; i < 5; i++) out.push({ t: 'rect', x: lx + i * sw, y: ly, w: sw, h: 8, fill: mix(low, high, i / 4) });
    text(toText(lo, item.valueFormat, ctx), lx - 4, ly + 7, 'right');
    text(toText(hi, item.valueFormat, ctx), lx + 5 * sw + 4, ly + 7);
  }
  return out;
}
