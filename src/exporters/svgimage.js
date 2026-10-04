// @ts-check
/**
 * SVG images in the PDF, drawn as vector paths with pdf-lib (no rasteriser).
 * Drawn: path, rect (rx/ry), circle, ellipse, line, polyline, polygon, nested g and svg, transform,
 * fill, stroke, stroke-width, opacity, fill-opacity, stroke-opacity, and the same in a style attribute.
 * Not drawn: text, gradients, patterns, clip paths, masks, filters, <use>, <style> sheets; evenodd fills
 * are drawn nonzero. Anything it cannot read is skipped; it never throws on bad input.
 */
import { pushGraphicsState, popGraphicsState, concatTransformationMatrix, rgb } from 'pdf-lib';
import { parseColor } from './color.js';
import { svgRootAttrs, svgLength, IMAGE_LIMITS } from '../engine/image.js';

/** @typedef {[number, number, number, number, number, number]} M */
/** @param {M} a @param {M} b a∘b (apply b first) */
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
/** @type {M} */
const I = [1, 0, 0, 1, 0, 0];

/** @param {string} s @returns {M} */
export function parseTransform(s) {
  let m = I;
  for (const [, fn, args] of String(s || '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (a.some(x => !Number.isFinite(x))) continue;
    const r = (d) => d * Math.PI / 180;
    /** @type {M} */
    let t = I;
    if (fn === 'matrix' && a.length === 6) t = /** @type {M} */ (a);
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const c = Math.cos(r(a[0] || 0)), sn = Math.sin(r(a[0] || 0)), cx = a[1] || 0, cy = a[2] || 0;
      t = mul(mul([1, 0, 0, 1, cx, cy], [c, sn, -sn, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan(r(a[0] || 0)), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan(r(a[0] || 0)), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

/** @param {string} s */
function attrs(s) {
  /** @type {Record<string,string>} */
  const a = {};
  for (const x of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[x[1]] = x[2] ?? x[3];
  for (const d of String(a.style || '').split(';')) {
    const i = d.indexOf(':');
    if (i > 0) a[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return a;
}

const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const pts = (v) => (String(v || '').match(/-?[\d.]+(?:e[-+]?\d+)?/gi) || []).map(Number);

/** A shape as path data, or null. @param {string} tag @param {Record<string,string>} a */
function shapePath(tag, a) {
  switch (tag) {
    case 'path': return a.d || null;
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      if (!(w > 0 && h > 0)) return null;
      let rx = num(a.rx, NaN), ry = num(a.ry, NaN);
      if (!Number.isFinite(rx)) rx = Number.isFinite(ry) ? ry : 0;
      if (!Number.isFinite(ry)) ry = rx;
      rx = Math.min(Math.max(rx, 0), w / 2); ry = Math.min(Math.max(ry, 0), h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle': case 'ellipse': {
      const cx = num(a.cx), cy = num(a.cy), rx = tag === 'circle' ? num(a.r) : num(a.rx), ry = tag === 'circle' ? num(a.r) : num(a.ry);
      if (!(rx > 0 && ry > 0)) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'line': return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case 'polyline': case 'polygon': {
      const p = pts(a.points);
      if (p.length < 4) return null;
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return tag === 'polygon' ? d + 'Z' : d;
    }
  }
  return null;
}

const SKIP = new Set(['defs', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'symbol', 'marker', 'text', 'style', 'script', 'title', 'desc', 'metadata', 'filter', 'foreignObject']);

/**
 * Shapes of an SVG in its own user space (the root viewBox applied), with their paint resolved.
 * @param {string} text
 * @returns {{ w: number, h: number, shapes: { d: string, m: M, fill: any, stroke: any, sw: number, fo: number, so: number }[] } | null}
 */
export function parseSvg(text) {
  if (typeof text !== 'string' || text.length > IMAGE_LIMITS.svgBytes) return null;
  const root = svgRootAttrs(text);
  if (!root) return null;
  const vb = String(root.viewBox || '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const w = svgLength(root.width) || (hasVb ? vb[2] : 0), h = svgLength(root.height) || (hasVb ? vb[3] : 0);
  if (!(w > 0 && h > 0)) return null;
  // viewBox → width/height, meet, centred (the default preserveAspectRatio)
  /** @type {M} */
  let base = I;
  if (hasVb) {
    const s = Math.min(w / vb[2], h / vb[3]);
    base = [s, 0, 0, s, (w - vb[2] * s) / 2 - vb[0] * s, (h - vb[3] * s) / 2 - vb[1] * s];
  }
  const shapes = [];
  const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const top = { m: base, fill: '#000', stroke: 'none', sw: 1, op: 1, fo: 1, so: 1, skip: 0 };
  const stack = [top];
  let seenRoot = false;
  for (const t of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, rest, self] = t;
    const cur = stack[stack.length - 1];
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    if (tag === 'svg' && !seenRoot) { seenRoot = true; if (self) break; continue; }
    const a = attrs(rest);
    const g = {
      m: a.transform ? mul(cur.m, parseTransform(a.transform)) : cur.m,
      fill: a.fill ?? cur.fill, stroke: a.stroke ?? cur.stroke,
      sw: a['stroke-width'] != null ? num(a['stroke-width'], cur.sw) : cur.sw,
      op: cur.op * (a.opacity != null ? Math.min(1, Math.max(0, num(a.opacity, 1))) : 1),
      fo: a['fill-opacity'] != null ? num(a['fill-opacity'], 1) : cur.fo,
      so: a['stroke-opacity'] != null ? num(a['stroke-opacity'], 1) : cur.so,
      skip: cur.skip || (SKIP.has(tag) || a.display === 'none' || a.visibility === 'hidden' ? 1 : 0),
    };
    if (tag === 'svg') { // nested svg: x/y offset only
      g.m = mul(g.m, [1, 0, 0, 1, num(a.x), num(a.y)]);
    }
    if (!g.skip) {
      const d = shapePath(tag, a);
      if (d) {
        if (shapes.length >= IMAGE_LIMITS.svgShapes) break;
        const fill = tag === 'line' ? null : parseColor(paint(g.fill)); // a line has no area
        shapes.push({ d, m: g.m, fill, stroke: parseColor(paint(g.stroke)), sw: g.sw, fo: g.fo * g.op, so: g.so * g.op });
      }
    }
    if (!self && !/^(path|rect|circle|ellipse|line|polyline|polygon|image|use)$/.test(tag)) stack.push(g);
  }
  return { w, h, shapes };
}
const clamp01 = (v) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
/** currentColor and url(#…) paints: black and nothing. */
const paint = (v) => v === 'currentColor' ? '#000' : /^url\(/.test(String(v || '')) ? 'none' : v;

/**
 * Draw a parsed SVG into the box (PDF coordinates: x, y of the bottom-left corner), scaled by sx, sy.
 * @param {any} page pdf-lib PDFPage
 * @param {NonNullable<ReturnType<typeof parseSvg>>} svg
 * @param {{ x: number, y: number, sx: number, sy: number }} at
 */
export function drawSvg(page, svg, at) {
  // SVG user space (y down) → PDF (y up), then each shape's own matrix; drawSvgPath flips y itself, so undo it
  /** @type {M} */
  const place = [at.sx, 0, 0, -at.sy, at.x, at.y + svg.h * at.sy];
  for (const s of svg.shapes) {
    if (!s.fill && !s.stroke) continue;
    const m = mul(mul(place, s.m), [1, 0, 0, -1, 0, 0]);
    if (!m.every(Number.isFinite)) continue;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
    try {
      page.drawSvgPath(s.d, {
        x: 0, y: 0,
        color: s.fill ? rgb(s.fill.r, s.fill.g, s.fill.b) : undefined, opacity: s.fill ? clamp01(s.fill.a * s.fo) : undefined,
        borderColor: s.stroke ? rgb(s.stroke.r, s.stroke.g, s.stroke.b) : undefined, borderWidth: s.stroke ? s.sw : 0, borderOpacity: s.stroke ? clamp01(s.stroke.a * s.so) : undefined,
      });
    } catch { /* bad path data: skip the shape */ }
    page.pushOperators(popGraphicsState());
  }
}
