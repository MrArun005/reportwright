// @ts-check
import { evalValue, toText, isDynamic, truthy } from '../expr/evaluate.js';
import { ExprError } from '../expr/parser.js';
import { isoDate } from '../expr/format.js';
import { resolveStyle, padding, borders } from '../style.js';
import { layoutTextLines, paintBox, paintBoxAt, OWNED } from './paint.js';
import { applyFilters, applySort, related } from '../data/index.js';
import { paintChart, CHART_TYPES } from './chart.js';
import { PALETTES } from './chart-kit.js';

const ROW_CHARTS = new Set(['scatter', 'bubble', 'polar']);
const MORE_CHARTS = new Set(['treemap', 'histogram', 'boxplot', 'waterfall', 'gantt']); // chart-more.js
const AXIS_CHARTS = new Set(['column', 'bar', 'line', 'area', 'candlestick', 'ohlc']);
import { paintVisual, ICON_SETS } from './visuals.js';
import { paintBarcode, SYMBOLOGIES, BARCODE_OPTIONS, bwipOptions, isTwoD } from './barcode.js';
import { paintMap } from './map.js';
import { shiftItems } from './paint.js';
import { richValue, layoutRich, paintRich, paintVertical } from './rich.js';
import { parseRich } from '../text/rich.js';
import { resolveFontKey } from '../text/fonts.js';
import { tocNumbers } from './toc.js';
import { resolveImageSrc, imageInfo, PX } from '../image.js';
import { groupRows, cmpKey, buildPivot, isTablix } from './pivot.js';
import { sliceColumns, itemLeft } from './hpage.js';
import { rowCells } from './cells.js';

/**
 * Item registry. Each item type has:
 *   label, defaults(), props (designer metadata, plain data),
 *   layout(item, lc) → { height, units[], table? }
 * Unit coordinates: x in content space, y relative to the item top.
 */

/** @type {Record<string, any>} */
export const ITEMS = {};
export const GROW_TOLERANCE = 1;
/** A cell's text layout in a dataOnly render (the data CSV): nothing is measured or drawn. */
const DATA_ONLY_TL = Object.freeze({ lines: Object.freeze([]), needed: 0, lh: 1, pad: [0, 0, 0, 0], size: 0, key: '', inner: 0 });
export function register(type, spec) { ITEMS[type] = { type, ...spec }; }
/** Alternative text for a picture, chart, map, barcode, shape or visual: the tagged PDF's Figure /Alt and Word's description. */
const ALT = { key: 'alt', label: 'Alternative text (screen readers: accessible PDF, Word)', type: 'text', category: 'Accessibility' };

/* ---------------------------------------------------------------- helpers */
function evalSafe(v, ctx, lc, who) {
  try { return { v: evalValue(v, ctx) }; } catch (e) {
    lc.warn(`${who}: ${e.message}`);
    return { v: '#Error', err: true };
  }
}
/** The row arrays of a group's sibling instances, once per sibling list (data bar maxima, ranks over groups). */
const SIBS = new WeakMap();
const sibRows = (sibs) => { let r = SIBS.get(sibs); if (!r) SIBS.set(sibs, r = sibs.map(b => b.rows)); return r; };
export function textOf(raw, st, ctx, lc) {
  if (typeof raw === 'string') return raw;
  if (raw == null && st.nullText != null) return String(st.nullText); // what a null shows (JasperReports prints "null")
  try { return toText(raw, st.format, ctx); } catch (e) {
    // a format over the caps (a 5,000-character pattern, 999 decimals) stops only this cell
    if (!(e instanceof ExprError)) throw e;
    lc?.warn(e.message);
    return '#Error';
  }
}
function hidden(item, ctx, lc) {
  let h = false;
  if (item.hidden === true) h = true;
  else if (item.hidden != null && item.hidden !== false && item.hidden !== '') { const r = evalSafe(item.hidden, ctx, lc, item.name || item.type); h = !r.err && truthy(r.v); }
  // another item's "toggle visibility" action flips it (the viewer keeps that in state.toggles)
  return item.name && lc.state?.toggles?.[`item:${item.name || item.type}`] ? !h : h;
}

/* ---------------------------------------------------------------- textbox */
/** Shrink-to-fit defaults; a text box can set its own `minFontSize` and `shrinkStep`. */
export const SHRINK_DEFAULTS = { minFontSize: 4, step: 0.5 };
/** A text box's rotation: degrees clockwise (any angle); swap = the layout box is turned on its side (90°, 270°). */
function rotationOf(item) {
  const a = ((Number(item.rotate) || 0) % 360 + 360) % 360;
  if (!a) return null;
  return { a, swap: a === 90 || a === 270 };
}
function paintTextbox(item, lc, ctx, forcedH) {
  let st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
  const r = evalSafe(item.value ?? '', ctx, lc, item.name || 'TextBox');
  const text = textOf(r.v, st, ctx, lc);
  const rot = rotationOf(item);
  // a box turned on its side lays its text out along its height
  const layoutW = rot?.swap ? item.h : item.w, layoutH = rot?.swap ? item.w : item.h;
  let tl = layoutTextLines(text, st, layoutW, lc.m);
  // shrink to fit: the largest size, in 0.5pt steps down to 4pt, at which the text fits the designed height.
  // A binary search, so a long text costs about 5 layouts, not 16.
  const size0 = Number(st.fontSize) || 9;
  /** The largest size down to `min` at which fits(layout) holds, or null. */
  const shrink = (min, fits, step) => {
    const steps = Number.isFinite(size0) ? Math.max(0, Math.floor((size0 - min) / step + 1e-9)) : 0;
    const at = (i) => { const s2 = { ...st, fontSize: Math.max(min, size0 - step * (i + 1)) }; return { s2, t2: layoutTextLines(text, s2, layoutW, lc.m) }; };
    let lo = 0, hi = steps - 1, best = null;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const c = at(mid);
      if (fits(c.t2)) { best = c; hi = mid - 1; } else lo = mid + 1;
    }
    return { best, last: steps > 0 ? () => at(steps - 1) : null };
  };
  const fitsBox = (t) => t.needed <= layoutH + GROW_TOLERANCE;
  if (item.shrinkToFit && !fitsBox(tl)) {
    const min = Math.max(1, Number(item.minFontSize) || SHRINK_DEFAULTS.minFontSize);
    // a definition can come from anyone with an API key: never more than 4,096 candidate sizes (12 layouts)
    const asked = Number(item.shrinkStep) > 0 ? Number(item.shrinkStep) : SHRINK_DEFAULTS.step;
    const r2 = shrink(min, fitsBox, Math.max(asked, 0.05, (size0 - min) / 4096));
    const best = r2.best || r2.last?.(); // still too long at the minimum: draw at the minimum, the box ellipsises
    if (best) { st = best.s2; tl = best.t2; }
  } else if (!item.shrinkToFit && !rot && forcedH == null && String(text).length <= 80 && tl.lines.length > 1) {
    // a short text (a KPI value, a label) shrinks before it is cut: in a box that cannot grow, down to half its size
    // so it fits; in one that can, a one-line box keeps it on one line when 15% smaller does it (a label as wide as
    // its neighbours' does not wrap alone)
    const fixed = item.canGrow === false && !fitsBox(tl);
    const oneLine = !fixed && layoutH < 2 * tl.lh + tl.pad[0] + tl.pad[2] - GROW_TOLERANCE;
    if (fixed || oneLine) {
      const { best } = shrink(Math.max(SHRINK_DEFAULTS.minFontSize, size0 * (fixed ? 0.5 : 0.85)), fixed ? fitsBox : (t) => t.lines.length === 1, 0.25);
      if (best) { st = best.s2; tl = best.t2; }
    }
  }
  let h = item.h;
  if (forcedH == null) {
    // Growth under 1pt is ignored: it would only push items below by a hair. Shrink-to-fit never grows.
    // A rotated box keeps its designed size: it never grows, shrinks or splits.
    if (item.canGrow !== false && !item.shrinkToFit && !rot && tl.needed > h + GROW_TOLERANCE) h = tl.needed;
    if (item.canShrink && !rot && tl.needed < h) h = tl.needed;
  } else h = forcedH;
  return { st, tl, h, numeric: typeof r.v === 'number', rot, text };
}

register('textbox', {
  label: 'Text box',
  defaults: () => ({ type: 'textbox', w: 144, h: 18, value: 'Text', canGrow: true, canShrink: false, style: {} }),
  props: [
    { key: 'value', label: 'Value', type: 'expr', category: 'Data' },
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'styleName', label: 'Named style', type: 'stylename', category: 'Text' },
    { key: 'canGrow', label: 'Can grow', type: 'bool', category: 'Layout' },
    { key: 'canShrink', label: 'Can shrink', type: 'bool', category: 'Layout' },
    { key: 'shrinkToFit', label: 'Shrink text to fit', type: 'bool', category: 'Layout' },
    { key: 'minFontSize', label: 'Shrink no smaller than (pt, default 4)', type: 'number', category: 'Layout' },
    { key: 'shrinkStep', label: 'Shrink step (pt, default 0.5)', type: 'number', category: 'Layout' },
    { key: 'rotate', label: 'Rotate (degrees clockwise)', type: 'number', category: 'Layout' },
    { key: 'headingLevel', label: 'Heading level (1–6, for a table of contents)', type: 'select', number: true, options: ['1', '2', '3', '4', '5', '6'], category: 'Interactivity' },
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'pageBreakAfter', label: 'Page break after', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
    { key: 'bookmark', label: 'Bookmark (document map)', type: 'expr', category: 'Interactivity' },
    { key: 'action', label: 'Action', type: 'action', category: 'Interactivity' },
    { key: 'tooltip', label: 'Tooltip (hover text)', type: 'expr', category: 'Interactivity' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const { st, tl, h: h0, numeric, rot, text } = paintTextbox(item, lc, ctx, lc.fixed ? item.h : null);
    // vertical text keeps the designed box (it does not grow or split), like a rotated box
    if (st.writingMode === 'tb-rl') {
      const items = paintVertical({ x: item.x, y: 0, w: item.w, h: item.h, st, text, m: lc.m });
      addInteractivity(items, item, ctx, lc, { x: item.x, y: 0, w: item.w, h: item.h }, text);
      return { height: item.h, units: [{ top: 0, height: item.h, items }] };
    }
    const h = h0;
    // Taller than a page: split into chunks of whole lines.
    if (!rot && !lc.fixed && h > lc.maxUnitHeight && tl.lines.length > 1) {
      const per = Math.max(1, Math.floor((lc.maxUnitHeight - tl.pad[0] - tl.pad[2]) / tl.lh));
      const units = [];
      for (let i = 0, top = 0; i < tl.lines.length; i += per) {
        const lines = tl.lines.slice(i, i + per);
        const ch = lines.length * tl.lh + tl.pad[0] + tl.pad[2];
        units.push({ top, height: ch, items: paintBox({ x: item.x, y: 0, w: item.w, h: ch, st, tl: { ...tl, lines }, numeric, m: lc.m }) });
        top += ch;
      }
      return { height: units.reduce((s, u) => s + u.height, 0), units };
    }
    let items;
    if (rot) {
      // lay out in the turned box, centred on the item's centre, then rotate every piece about that centre.
      // The link hit area (added below) stays the upright rectangle.
      const cx = item.x + item.w / 2, cy = h / 2;
      const bw = rot.swap ? h : item.w, bh = rot.swap ? item.w : h;
      items = paintBox({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, st, tl, numeric, m: lc.m }).map(i => ({ ...i, rotate: { a: rot.a, cx, cy } }));
    } else items = paintBox({ x: item.x, y: 0, w: item.w, h, st, tl, numeric, m: lc.m });
    addInteractivity(items, item, ctx, lc, { x: item.x, y: 0, w: item.w, h }, text);
    return { height: h, units: [{ top: 0, height: h, items }] };
  },
});

/* ---------------------------------------------------------------- rich text */
register('richtext', {
  label: 'Rich text',
  defaults: () => ({ type: 'richtext', w: 240, h: 48, value: '<p>Rich <b>text</b> with <i>styles</i> in {Globals.ReportName}</p>', canGrow: true, style: {} }),
  props: [
    { key: 'value', label: 'HTML (p, b, i, u, s, sup, sub, br, ul/ol/li, a, h1–h6, span style; {Fields.x})', type: 'html', category: 'Data' },
    { key: 'htmlFromData', label: 'Field values are HTML (trusted data only)', type: 'bool', category: 'Data' },
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'styleName', label: 'Named style', type: 'stylename', category: 'Text' },
    { key: 'canGrow', label: 'Can grow', type: 'bool', category: 'Layout' },
    { key: 'canShrink', label: 'Can shrink', type: 'bool', category: 'Layout' },
    { key: 'listIndent', label: 'List indent (pt, default 18)', type: 'number', category: 'Layout' },
    { key: 'paragraphSpacing', label: 'Space after paragraphs (pt, default 4)', type: 'number', category: 'Layout' },
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'pageBreakAfter', label: 'Page break after', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
    { key: 'bookmark', label: 'Bookmark (document map)', type: 'expr', category: 'Interactivity' },
    { key: 'action', label: 'Action', type: 'action', category: 'Interactivity' },
    { key: 'tooltip', label: 'Tooltip (hover text)', type: 'expr', category: 'Interactivity' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const who = item.name || 'Rich text';
    const st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
    let html;
    try { html = richValue(item.value ?? '', ctx, item.htmlFromData === true); } catch (e) { lc.warn(`${who}: ${e.message}`); html = '#Error'; }
    const { blocks } = parseRich(html, { baseSize: Number(st.fontSize) || 9, warn: (msg) => lc.warn(`${who}: ${msg}`) });
    const rl = layoutRich(blocks, st, item.w, lc.m, { listIndent: item.listIndent, paragraphSpacing: item.paragraphSpacing, maxLineHeight: lc.maxUnitHeight - padding(st)[0] - padding(st)[2], warn: (msg) => lc.warn(`${who}: ${msg}`) });
    let h = item.h;
    if (!lc.fixed) {
      if (item.canGrow !== false && rl.needed > h + GROW_TOLERANCE) h = rl.needed;
      if (item.canShrink && rl.needed < h) h = rl.needed;
    }
    const id = `${who}:${lc.nextId?.() ?? 0}`;
    const pv = rl.pad[0] + rl.pad[2];
    // Taller than a page: split into pieces of whole lines
    if (!lc.fixed && h > lc.maxUnitHeight && rl.lines.length > 1) {
      const units = [];
      let top = 0, start = 0;
      while (start < rl.lines.length) {
        let end = start, ch = pv;
        while (end < rl.lines.length && (end === start || ch + rl.lines[end].h <= lc.maxUnitHeight)) { ch += rl.lines[end].h + rl.lines[end].gap; end++; }
        const lines = rl.lines.slice(start, end);
        ch -= lines[lines.length - 1].gap;
        const items = paintRich({ x: item.x, y: 0, w: item.w, h: ch, st, rl: { ...rl, lines }, m: lc.m, id: `${id}:${start}` });
        if (!start) addInteractivity(items, item, ctx, lc, { x: item.x, y: 0, w: item.w, h: ch });
        units.push({ top, height: ch, items });
        top += ch; start = end;
      }
      return { height: top, units };
    }
    const items = paintRich({ x: item.x, y: 0, w: item.w, h, st, rl, m: lc.m, id });
    addInteractivity(items, item, ctx, lc, { x: item.x, y: 0, w: item.w, h });
    return { height: h, units: [{ top: 0, height: h, items }] };
  },
});

/** Link (hyperlink, drill-through, jump) and bookmark for any item. */
function addInteractivity(items, item, ctx, lc, rect, heading) {
  const link = lc.linkFor?.(item, ctx, rect);
  if (link) items.push(link);
  // a text box marked as a heading feeds a table of contents with source: 'headings' (not the PDF outline)
  const hl = Number(item.headingLevel);
  if (heading && hl >= 1 && hl <= 6) items.push({ t: 'bookmark', heading: true, label: String(heading).replace(/\s+/g, ' ').trim(), x: rect.x, y: rect.y, level: hl - 1 });
  if (item.bookmark) {
    const b = evalSafe(item.bookmark, ctx, lc, `${item.name || item.type} bookmark`).v;
    // a bookmarked heading sits at its heading level unless it says otherwise (as RDLX import maps it)
    if (b != null && b !== '' && b !== '#Error') items.push({ t: 'bookmark', label: String(b), x: rect.x, y: rect.y, level: item.bookmarkLevel ?? (hl >= 1 && hl <= 6 ? hl - 1 : 0) });
  }
}

/* ---------------------------------------------------------------- image */
register('image', {
  label: 'Image',
  defaults: () => ({ type: 'image', w: 96, h: 64, src: '', fit: 'contain', style: {} }),
  props: [
    { key: 'src', label: 'Source (URL, data URI, embedded:name, or a field with base64 or bytes)', type: 'expr', category: 'Data' },
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'fit', label: 'Fit', type: 'select', options: ['contain', 'cover', 'fill', 'clip'], category: 'Layout' },
    { key: 'autoSize', label: 'Size to the image (96 dpi)', type: 'bool', category: 'Layout' },
    ALT,
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
    const who = item.name || 'Image';
    const src = resolveImageSrc(evalSafe(item.src ?? '', ctx, lc, who).v, who, { images: lc.images, budget: lc.imageBudget, warn: lc.warn });
    let w = item.w, h = item.h, fit = ['contain', 'cover', 'fill', 'clip'].includes(item.fit) ? item.fit : 'contain';
    // natural size (autoSize, clip) is known for data images only; a URL loads later
    const info = src && (item.autoSize || fit === 'clip') ? imageInfo(src) : null;
    const nat = info && 'w' in info && info.w > 0 && info.h > 0 ? { w: info.w * PX, h: info.h * PX } : null;
    if (src && (item.autoSize || fit === 'clip') && !nat) { lc.warn(`${who}: the image's size is not known before it loads, so it is fitted inside the box`); fit = 'contain'; }
    if (item.autoSize && nat) { w = nat.w; h = nat.h; if (fit === 'clip') fit = 'fill'; }
    const items = paintBox({ x: item.x, y: 0, w, h, st, tl: null, m: lc.m });
    const img = fit === 'clip' && nat ? { t: 'image', x: item.x, y: 0, w: nat.w, h: nat.h, cw: w, ch: h, src, fit } : { t: 'image', x: item.x, y: 0, w, h, src, fit };
    // the picture goes above the box's background (colour and image) and below its borders
    if (src) items.splice((st.backgroundColor ? 1 : 0) + (st.backgroundImage ? 1 : 0), 0, img);
    return { height: h, units: [{ top: 0, height: h, items }] };
  },
});

/* ---------------------------------------------------------------- line */
register('line', {
  label: 'Line',
  defaults: () => ({ type: 'line', w: 144, h: 0, direction: 'down', style: { stroke: '#1f2328', strokeWidth: 1 } }),
  props: [
    { key: 'direction', label: 'Direction', type: 'select', options: ['down', 'up'], category: 'Layout' },
    ALT,
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  styleProps: ['stroke', 'strokeWidth', 'strokeDash'],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
    const up = item.direction === 'up';
    const sw = Number(st.strokeWidth) || 1;
    const dash = st.strokeDash === 'dashed' ? [4, 3] : st.strokeDash === 'dotted' ? [1, 2] : null;
    return {
      height: Math.max(item.h, sw),
      units: [{ top: 0, height: Math.max(item.h, sw), items: [{ t: 'line', x1: item.x, y1: up ? item.h : 0, x2: item.x + item.w, y2: up ? 0 : item.h, stroke: st.stroke || '#000', strokeWidth: sw, dash }] }],
    };
  },
});

/* ---------------------------------------------------------------- shape */
register('shape', {
  label: 'Shape',
  defaults: () => ({ type: 'shape', shape: 'rect', w: 96, h: 48, style: { fill: '#eef2ff', stroke: '#4f46e5', strokeWidth: 1, radius: 4 } }),
  props: [
    { key: 'shape', label: 'Shape', type: 'select', options: ['rect', 'ellipse'], category: 'Layout' },
    ALT,
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  styleProps: ['fill', 'stroke', 'strokeWidth', 'strokeDash', 'radius'],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
    const sw = st.stroke && st.stroke !== 'none' ? Number(st.strokeWidth) || 0 : 0;
    const dash = st.strokeDash === 'dashed' ? [4, 3] : st.strokeDash === 'dotted' ? [1, 2] : null;
    const shape = item.shape === 'ellipse'
      ? { t: 'ellipse', cx: item.x + item.w / 2, cy: item.h / 2, rx: item.w / 2, ry: item.h / 2, fill: st.fill || null, stroke: sw ? st.stroke : null, strokeWidth: sw, dash }
      : { t: 'rect', x: item.x, y: 0, w: item.w, h: item.h, fill: st.fill || null, stroke: sw ? st.stroke : null, strokeWidth: sw, radius: Number(st.radius) || 0, dash };
    return { height: item.h, units: [{ top: 0, height: item.h, items: [shape] }] };
  },
});

/** A table or matrix wider than the page: the default continues on the next pages (as SSRS); the others are opt-outs. */
const OVERFLOW_OPTIONS = [{ value: 'paginate', label: 'Continue on the next pages' }, { value: 'shrink', label: 'Narrow the columns' }, { value: 'clip', label: 'Cut at the page edge' }];

/* ---------------------------------------------------------------- table */
/** Rows measured for column widths from the content. */
const FIT_ROWS = 50;
/**
 * Column widths from the formatted content of the header, the first FIT_ROWS detail rows and the footer (single
 * cells; a merged cell does not count): each auto column's widest text plus its padding. Auto columns (all with
 * fitColumns, else those without a width) share what the fixed ones leave of the table's width, in proportion to
 * those natural widths. ponytail: proportional, not a water-fill; a column squeezed below its widest text wraps.
 */
function fitColumns(item, cols, rows, tctx, lc) {
  const auto = cols.map(c => !!item.fitColumns || c.width == null);
  const nat = cols.map(() => 0);
  const measure = (row, ctx) => {
    const rst = resolveStyle([lc.base, lc.named?.[item.styleName], item.style, row.style], ctx);
    const { at } = rowCells(row.cells, cols.length);
    for (let ci = 0; ci < cols.length; ci++) {
      const cell = at[ci];
      if (!auto[ci] || !cell || (cell.colSpan || 1) > 1 || cell.item) continue;
      let v;
      try { v = evalValue(cell.value ?? '', ctx); } catch { continue; }
      const st = resolveStyle([rst, lc.named?.[cell.styleName], cell.style], ctx);
      const tl = layoutTextLines(textOf(v, st, ctx, lc), st, 1e6, lc.m, { wrap: false });
      const w = Math.max(0, ...tl.lines.map(l => l.width)) + tl.pad[1] + tl.pad[3];
      if (w > nat[ci]) nat[ci] = w;
    }
  };
  const base = { ...tctx, aggRows: rows, fields: rows[0] || null };
  for (const r of item.header || []) measure(r, base);
  for (const r of item.footer || []) measure(r, base);
  const n = Math.min(rows.length, FIT_ROWS);
  for (let i = 0; i < n; i++) for (const r of item.detail || []) measure(r, { ...base, fields: rows[i], aggIndex: i });
  const total = item.fitColumns ? (cols.reduce((t, c) => t + (Number(c.width) || 0), 0) || Number(item.w) || 0) : Number(item.w) || 0;
  const fixed = cols.reduce((t, c, i) => t + (auto[i] ? 0 : Number(c.width) || 0), 0);
  const room = Math.max(0, total - fixed);
  const want = nat.reduce((t, w, i) => t + (auto[i] ? Math.max(w, 1) : 0), 0);
  return cols.map((c, i) => (auto[i] ? { ...c, width: room * Math.max(nat[i], 1) / want } : c));
}

register('table', {
  label: 'Table',
  defaults: () => ({
    type: 'table', w: 360, h: 54, dataSet: null, repeatHeader: true, noRowsText: 'No rows',
    columns: [{ width: 120 }, { width: 120 }, { width: 120 }],
    header: [{ height: 18, style: { fontWeight: 'bold', backgroundColor: '#f1f3f5', borderBottom: '1 solid #adb5bd' }, cells: [{ value: 'Column 1' }, { value: 'Column 2' }, { value: 'Column 3' }] }],
    groups: [],
    detail: [{ height: 18, style: { borderBottom: '0.5 solid #dee2e6' }, cells: [{ value: '' }, { value: '' }, { value: '' }] }],
    footer: [],
    style: { padding: [3, 4, 3, 4] },
  }),
  props: [
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'repeatHeader', label: 'Repeat header on each page', type: 'bool', category: 'Layout' },
    { key: 'fitColumns', label: 'Column widths from the content', type: 'bool', category: 'Layout' },
    { key: 'printAtBottom', label: 'Footer at the bottom of the page', type: 'bool', category: 'Layout' },
    { key: 'overflowTo', label: 'Fixed frame: continue rows in', labelKey: 'overflowTo', type: 'overflowTarget', category: 'Layout' },
    { key: 'overflow', label: 'Wider than the page', type: 'select', options: OVERFLOW_OPTIONS, category: 'Layout' },
    { key: 'repeatColumns', label: 'Columns repeated on each page set', type: 'number', category: 'Layout', showIf: (it) => (it.overflow || 'paginate') === 'paginate' },
    { key: 'pageOrder', label: 'Page order', type: 'select', options: [{ value: 'down', label: 'Down, then across' }, { value: 'across', label: 'Across, then down' }], category: 'Layout', showIf: (it) => (it.overflow || 'paginate') === 'paginate' },
    { key: 'noRowsText', label: 'Text when no rows', type: 'text', category: 'Data' },
    { key: 'bookmark', label: 'Bookmark (document map)', type: 'expr', category: 'Interactivity' },
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'pageBreakAfter', label: 'Page break after', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const tctx = item.__ctx || lc.ctxFor(item);
    if (hidden(item, tctx, lc)) return { height: 0, units: [] };
    let rows;
    if (item.__body) rows = item.__rows || []; // a pivot: its rows are built, these are only its scope
    else {
      rows = (item.dataSet && lc.dataSets[item.dataSet]) || [];
      rows = related(rows, tctx); // a nested data set inside a list of its parent: that row's children
      if (item.dataSet && !lc.dataSets[item.dataSet]) lc.warn(`${item.name || item.type}: the data set "${item.dataSet}" does not exist`);
      if (item.filters?.length) rows = applyFilters(rows, item.filters, tctx);
      const sort = lc.state?.sort?.[item.name] || item.sort;
      if (sort?.length) rows = applySort(rows, sort, tctx);
    }

    let cols = item.columns || [];
    // widths from the content: every column with fitColumns, else the columns that have no width
    if (!item.__body && cols.length && (item.fitColumns || cols.some(c => c.width == null))) cols = fitColumns(item, cols, rows, tctx, lc);
    // wider than the page: columns are never dropped silently. Unless the author chose otherwise they continue on the
    // next page set ("paginate", as SSRS); "shrink" narrows every column in proportion; "clip" cuts at the page edge
    const room = (lc.bodyWidth ?? Infinity) - item.x;
    const designedW = cols.reduce((s, c) => s + (Number(c.width) || 0), 0);
    const overflow = designedW > room + 1 ? ( // under 1pt over: a hairline, kept as it was
      ['shrink', 'clip', 'paginate'].includes(item.overflow) ? item.overflow : 'paginate') : null;
    if (overflow === 'shrink' && room > 0) {
      const k = room / designedW;
      cols = cols.map(c => ({ ...c, width: (Number(c.width) || 0) * k }));
      lc.warn(`${item.name || item.type}: its columns are ${Math.round(designedW)}pt wide, wider than the page (${Math.round(room)}pt), so they are narrowed to fit`);
    } else if (overflow === 'clip' || (overflow === 'paginate' && lc.fixed)) {
      lc.warn(`${item.name || item.type}: its columns are ${Math.round(designedW)}pt wide, wider than the page (${Math.round(room)}pt), so the columns past the page edge are cut`, true);
    } else if (overflow === 'paginate' && item.overflow !== 'paginate') {
      lc.warn(`${item.name || item.type}: its columns are ${Math.round(designedW)}pt wide, wider than the page (${Math.round(room)}pt), so they continue on the next pages`);
    }
    const colX = [];
    let acc = item.x;
    for (const c of cols) { colX.push(acc); acc += c.width; }
    const width = acc - item.x;

    const region = { name: item.name, columns: cols.map(c => c.width), rows: [] };
    if (lc.tablesSeen) lc.tablesSeen.n++; // a table in the report, whether or not its data is kept (exportData): Word and the others then say they need it
    // run: rows shown so far, in display order (groups reorder rows), for RunningValue over a scope
    const tableScope = { rows, index: -1, run: [] };
    const scopes = { ...(tctx.scopes || {}), [item.name]: tableScope };
    // each group's key chain: an aggregate scoped to a group outside that group's band (a table footer's Sum over
    // the inner group) reads the instance the current row is in (BIRT: the last group in a footer, the first in a header)
    const groupChains = {};
    (item.groups || []).forEach((g, i) => { if (g.name) groupChains[g.name] = { rows, keys: item.groups.slice(0, i + 1).map(x => x.expr) }; });
    // region: Previous() in a detail row reads its run; group: the innermost group instance (none at table level)
    // a window of a longer report (paged.js): the header reads the report's first row, not the window's
    const base = { ...tctx, aggRows: rows, aggIndex: undefined, fields: lc.win?.first || rows[0] || null, scopes, region: tableScope, group: undefined, groupChains: { ...(tctx.groupChains || {}), ...groupChains } };
    const units = [];
    let y = 0;
    let repeatH = 0; // header height that repeats above continued rows
    let rowSeq = 0;
    const colWidths = cols.map(c => c.width); // one array shared by every cell tag
    const colIdx = colX.map(x => colX.indexOf(x)); // a column's index as cell tags give it (a 0-wide column shares its neighbour's)

    /** A cell as the data exports (Excel, CSV) see it. */
    const regionCell = (c) => {
      const o = { col: Math.round((c.x - item.x) * 100), value: c.raw instanceof Date || typeof c.raw === 'boolean' ? c.raw : typeof c.raw === 'number' ? roundFor(c.raw, c.st.format) : c.plain, format: c.st.format || null, bold: c.st.fontWeight === 'bold' || Number(c.st.fontWeight) >= 600, span: c.span, colIndex: c.ci != null ? colIdx[c.ci] : colX.indexOf(c.x) };
      if (c.left > 1) o.rowSpan = c.left;
      return o;
    };
    // merged cells across rows: spans still open, each { ci, cols, left, x, w, st, tl, numeric, cell, ctx, raw, plain, units }
    let openSpans = [];
    const cover = new Array(cols.length).fill(null); // the open span over each column: O(1) per cell
    const covered = (ci) => cover[ci] !== null;
    const cellsAt = new WeakMap(); // row → its cells by column
    const layRow = (row, ctx, kind, extra) => {
      // a row hidden by its expression (per record for detail rows) takes no space; merged cells over it still count it
      if (row.hidden != null && row.hidden !== false && row.hidden !== '' && hidden({ hidden: row.hidden, name: `${item.name || item.type} row` }, ctx, lc)) {
        if (openSpans.length) {
          for (const s of openSpans) s.left--;
          for (const s of openSpans) if (s.left <= 0) closeSpan(s);
          openSpans = openSpans.filter(s => s.left > 0);
        }
        return null;
      }
      const rst = resolveStyle([lc.base, lc.named?.[item.styleName], item.style, lc.named?.[row.styleName], row.style], ctx);
      const cells = [];
      let started = null; // merged cells that start on this row (rare: no array otherwise)
      let need = row.height || 18;
      let at = cellsAt.get(row);
      if (!at) cellsAt.set(row, at = rowCells(row.cells, cols.length).at); // both colSpan forms; a cell under a span is not drawn
      for (let ci = 0; ci < cols.length; ci++) {
        const cell = at[ci];
        if (!cell || covered(ci)) continue;
        const span = Math.max(1, Math.min(cell.colSpan || 1, cols.length - ci));
        let cw = 0;
        for (let k = 0; k < span; k++) cw += cols[ci + k].width;
        const cctx = cell.ctx || ctx; // a pivot value cell carries its own scope
        let st = resolveStyle([rst, lc.named?.[cell.styleName], cell.style], cctx);
        // a recursive group's indent: the first cell's left padding grows by level
        if (ctx.indent > 0 && !cells.length && !started) { const pd = padding(st); st = { ...st, padding: [pd[0], pd[1], pd[2], pd[3] + ctx.indent] }; }
        else if (cell.indent > 0) { const pd = padding(st); st = { ...st, padding: [pd[0], pd[1], pd[2], pd[3] + Math.min(Number(cell.indent), cw / 2)] }; } // a pivot's recursive row header
        let v; // evalSafe without its result object: this runs for every cell
        if ('raw' in cell) v = cell.raw;
        else try { v = evalValue(cell.value ?? '', cctx); } catch (e) { lc.warn(`${item.name || item.type} cell: ${e.message}`); v = '#Error'; }
        let text = textOf(v, st, cctx, lc);
        const plain = text;
        const toggle = cell.toggle || (extra?.toggle && ci === 0 ? extra.toggle : null);
        if (toggle) text = `${toggle.open ? '▼' : '▶'} ${text}`;
        if (cell.sortBy && kind === 'header') {
          const cur = (lc.state?.sort?.[item.name] || [])[0];
          if (cur && cur.by === cell.sortBy) text += cur.dir === 'desc' ? ' ↓' : ' ↑';
        }
        const nested = cell.item?.type && ITEMS[cell.item.type] ? layoutInCell(cell.item, colX[ci], cw, st, cctx, row) : null;
        const tl = lc.dataOnly ? DATA_ONLY_TL : nested ? { ...layoutTextLines('', st, cw, lc.m), lines: [], needed: nested.height } : layoutTextLines(text, st, cw, lc.m, { atom: !toggle && (typeof v === 'number' || v instanceof Date) });
        const c = { x: colX[ci], w: cw, st, tl, numeric: typeof v === 'number', cell, ctx: cctx, raw: v, span, plain: nested ? '' : plain, toggle, nested, ci };
        const rs = Math.floor(Number(cell.rowSpan)) || 1;
        if (rs > 1) { (started ||= []).push({ ...c, ci, cols: span, left: rs, units: [], kind, level: extra?.level }); continue; }
        // an item in the cell (a table, list, chart) always grows its row, as in SSRS; canGrow: false keeps text to the row
        if ((row.canGrow !== false || nested) && tl.needed > need + GROW_TOLERANCE) need = tl.needed;
        cells.push(c);
      }
      if (started) {
        openSpans.push(...started);
        for (const st of started) for (let k = st.ci; k < st.ci + st.cols; k++) cover[k] = st;
      }
      // a merged cell that ends on this row: the row grows if the merged text needs more than the rows above gave
      if (openSpans.length) for (const s of openSpans) if (s.left === 1) {
        const above = s.units.reduce((t, u) => t + u.height, 0);
        if (s.tl.needed - above > need + GROW_TOLERANCE) need = s.tl.needed - above;
      }
      if (lc.regions) { // export data (Excel, CSV, Word, HTML): only when the render asks for it (render option exportData)
      const rcells = (started ? [...cells, ...started].sort((a, b) => a.x - b.x) : cells).map(regionCell);
      if (started) for (const st of started) st.region = rcells.find(rc => rc.colIndex === colX.indexOf(st.x)); // its rowSpan is set to the rows it really covered when it closes
      region.rows.push({ kind, level: extra?.level ?? 0, cells: rcells });
      }
      // h: height of this piece; lines: per-cell lines when the row is split; first: links, visuals and toggles go on the first piece
      const paint = (h, lines, first, rowId, chunk) => {
        const items = [];
        if (lc.dataOnly || lc.win?.count) return items; // the data CSV, and paged.js's page count: no drawing
        cells.forEach((c, k) => {
          if (c.cell.visual?.type) {
            items.push(...paintBox({ x: c.x, y: 0, w: c.w, h, st: c.st, tl: null, m: lc.m }));
            if (first) items.push(...paintVisual(c.cell.visual, { x: c.x, y: 0, w: c.w, h }, c.ctx, lc, c.st, `${item.name || item.type} cell`, { cell: true }));
            return;
          }
          if (c.nested) {
            items.push(...paintBox({ x: c.x, y: 0, w: c.w, h, st: c.st, tl: null, m: lc.m }));
            if (chunk && chunk.cell === c) items.push(...chunk.items); // a piece of an item that continues on the next page
            else if (first) items.push(...c.nested.items);
            return;
          }
          // cell text knows its table, row and column, so the Word export can rebuild the table
          const tag = lc.regions ? { table: item.name, row: rowId, col: colIdx[c.ci], span: c.span, kind, cols: colWidths, bg: c.st.backgroundColor || null } : null;
          paintBoxAt(c.x, 0, c.w, h, c.st, lines ? { ...c.tl, lines: lines[k] } : c.tl, c.numeric, lc.m, true, items, tag);
          if (first) cellLinks(items, c, h, kind, extra?.level);
        });
        if (first) for (const c of cells) if (c.cell.toggle) items.push(toggleLink(c, c.w, h));
        if (first && extra?.toggle) {
          // the whole first cell toggles, unless that cell has its own action (a drill-through): then only the ▶ does
          const c0 = cells[0];
          items.push(toggleLink({ x: colX[0], toggle: extra.toggle, cell: c0?.cell || {}, st: c0?.st, w: c0?.w }, cols[0]?.width || 20, h));
        }
        OWNED.add(items);
        return items;
      };
      // Taller than a page (less a repeated header): split into pieces of whole lines, like a text box, so it continues on the next pages.
      const room = (lc.maxUnitHeight ?? Infinity) - repeatH;
      const pieces = [];
      // an item in a cell (a table, a list) taller than the page: the row splits between its rows, a nested table's header again on top
      const nc = !lc.fixed && !openSpans.length && !started && need > room ? cells.find(c => c.nested?.units?.length > 1) : null;
      const chunks = nc ? splitNested(nc.nested, room) : null;
      if (chunks) {
        chunks.forEach((ch, i) => pieces.push({ h: i ? ch.h : Math.max(ch.h, row.height || 18, ...cells.filter(c => c !== nc).map(c => c.tl.needed)), lines: i ? cells.map(() => []) : null, chunk: { cell: nc, items: ch.items } }));
      } else if (!lc.fixed && !openSpans.length && need > room && cells.some(c => c.tl.lines.length > 1)) {
        const per = cells.map(c => Math.max(1, Math.floor((room - c.tl.pad[0] - c.tl.pad[2]) / c.tl.lh)));
        const n = Math.max(...cells.map((c, k) => Math.ceil(c.tl.lines.length / per[k])));
        for (let i = 0; i < n; i++) {
          const lines = cells.map((c, k) => c.tl.lines.slice(i * per[k], (i + 1) * per[k]));
          pieces.push({ lines, h: Math.max(...cells.map((c, k) => lines[k].length * c.tl.lh + c.tl.pad[0] + c.tl.pad[2])) });
        }
      } else pieces.push({ lines: null, h: need });
      let u;
      pieces.forEach((pc, i) => {
        u = { top: y, height: pc.h, items: paint(pc.h, pc.lines, i === 0, ++rowSeq, pc.chunk), kind, rowId: rowSeq };
        y += pc.h;
        units.push(u);
      });
      if (openSpans.length) for (const s of openSpans) { s.units.push(u); s.left--; }
      if (openSpans.length && openSpans.some(s => s.left <= 0)) { for (const s of openSpans) if (s.left <= 0) closeSpan(s); openSpans = openSpans.filter(s => s.left > 0); }
      return u;
    };
    /**
     * An item inside a cell (a table, list, chart…), laid out in the cell's inner box with the cell's scope:
     * the table's own data set is the cell's rows, and a related data set gets that row's children.
     */
    const layoutInCell = (inner, x, cw, st, cctx, row) => {
      const pd = padding(st);
      const it = { ...inner, name: inner.name || `${item.name || item.type}_cell`, x: x + pd[3], y: 0, w: Math.max(1, cw - pd[1] - pd[3]), h: Number(inner.h) || Math.max(1, (row.height || 18) - pd[0] - pd[2]) };
      const scopeRows = cctx.aggIndex != null ? [cctx.fields] : cctx.aggRows || [];
      const current = item.dataSet ? { ...(cctx.current || {}), [item.dataSet]: scopeRows } : cctx.current;
      const child = { ...lc, regions: null, rowBudget: null, maxUnitHeight: Infinity,
        dataSets: item.dataSet ? { ...lc.dataSets, [item.dataSet]: scopeRows } : lc.dataSets,
        ctxFor: (x) => {
          if (!x.dataSet || x.dataSet === item.dataSet) return { ...cctx, fields: scopeRows[0] || null, aggRows: scopeRows, aggIndex: undefined, current };
          const c = { ...lc.ctxFor(x), parentFields: cctx.fields, scopes: cctx.scopes, current };
          const kids = related(c.aggRows, c);
          return kids === c.aggRows ? c : { ...c, aggRows: kids, fields: kids[0] || null };
        } };
      // items in cells multiply with the rows: one budget for the render (an unrelated data set in every row is rows × rows)
      // charged by the data rows the item reads (a pivot over an unrelated data set reads every row) and the rows it draws
      const budget = lc.cellItems || (lc.cellItems = { left: CELL_ITEM_UNITS });
      const reads = (it.dataSet && it.dataSet !== item.dataSet ? child.ctxFor(it).aggRows?.length : scopeRows.length) || 1;
      if (budget.left < reads) { budget.left = 0; lc.warn(`${item.name || item.type}: more than ${CELL_ITEM_UNITS} rows of items inside cells; the rest are left empty`); return { items: [], height: 0 }; }
      budget.left -= reads;
      const res = lc.layoutItems([it], child);
      budget.left -= res.units.length;
      const items = [];
      for (const u of res.units) for (const i of shiftLocal(u.items.filter(i => i.t !== 'bookmark'), u.top + pd[0])) items.push(i.cell ? { ...i, cell: undefined } : i); // its own cells are not the outer table's (Word)
      // units and tables: for a row that splits between the item's own rows (splitNested)
      return { items, height: res.height + pd[0] + pd[2], units: res.units, tables: res.tables, pad: [pd[0], pd[2]] };
    };
    /** Links, bookmarks, sort and toggle hot spots of a cell, on the first piece of its row. */
    // a cell's bookmark nests in the outline: under the table's own bookmark, a group's under the groups outside it
    const tableLevel = item.bookmark ? (item.bookmarkLevel ?? 0) + 1 : (item.bookmarkLevel ?? 0);
    const cellLinks = (items, c, h, kind, level = 0) => {
      const link = lc.linkFor?.(c.cell, c.ctx, { x: c.x, y: 0, w: c.w, h });
      if (link) items.push(link);
      if (cell_bookmark(c.cell)) { const b = evalSafe(c.cell.bookmark, c.ctx, lc, 'bookmark').v; if (b) items.push({ t: 'bookmark', label: String(b), x: c.x, y: 0, level: c.cell.bookmarkLevel ?? (tableLevel + (kind === 'header' || kind === 'footer' ? 0 : level)) }); }
      if (c.cell.sortBy && kind === 'header') {
        const cur = (lc.state?.sort?.[item.name] || [])[0];
        const dir = cur && cur.by === c.cell.sortBy && cur.dir === 'asc' ? 'desc' : 'asc';
        items.push({ t: 'link', x: c.x, y: 0, w: c.w, h, action: { type: 'sort', table: item.name, by: c.cell.sortBy, dir } });
      }
    };
    /** The toggle hot spot: the whole cell (w), or only the ▶ when the cell has its own action (a drill-through). */
    const toggleLink = (c, w, h) => ({ t: 'link', x: c.x, y: 0, w: c.cell.action ? Math.min(c.w, padding(c.st)[3] + (Number(c.st.fontSize) || 9) * 1.4) : w, h, action: { type: 'toggle', key: c.toggle.key, open: c.toggle.open } });
    const NO_BOX = { backgroundColor: null, backgroundImage: null, border: null, borderTop: null, borderRight: null, borderBottom: null, borderLeft: null };
    /** A merged cell, once its rows are laid out: background and side borders on every row, the text once across them all. */
    const paintSpan = (s) => {
      const kind = s.kind;
      const H = s.units.reduce((t, u) => t + u.height, 0);
      const n = s.units.length;
      s.units.forEach((u, k) => {
        const st = k === 0 && n === 1 ? s.st : { ...s.st, ...(k > 0 ? { borderTop: 'none' } : {}), ...(k < n - 1 ? { borderBottom: 'none' } : {}) };
        const add = paintBox({ x: s.x, y: 0, w: s.w, h: u.height, st, tl: null, m: lc.m });
        if (k === 0) {
          const tag = lc.regions ? { table: item.name, row: u.rowId, col: colX.indexOf(s.x), span: s.cols, rowSpan: n, kind, cols: colWidths, bg: s.st.backgroundColor || null } : null;
          const text = paintBox({ x: s.x, y: 0, w: s.w, h: H, st: { ...s.st, ...NO_BOX }, tl: s.tl, numeric: s.numeric, m: lc.m, cell: tag });
          add.splice(s.st.backgroundColor ? 1 : 0, 0, ...text);
          cellLinks(add, s, u.height, kind, s.level);
          if (s.toggle) add.push(toggleLink(s, s.w, u.height));
        }
        // in reading order: before the cells to its right
        const at = u.items.findIndex(it => itemLeft(it) >= s.x + s.w - 0.01);
        u.items.splice(at < 0 ? u.items.length : at, 0, ...add);
      });
      // text that reaches below the first row (more lines, or centred): keep the rows on one page when they fit
      if (s.tl.needed > s.units[0].height + GROW_TOLERANCE || (s.st.verticalAlign && s.st.verticalAlign !== 'top')) {
        const id = `${item.name || item.type}:span:${lc.nextId()}`;
        for (const u of s.units) u.block ||= id;
      } else {
        // a page break inside the merged rows draws the text again at the top of the next page
        let above = s.units[0].height;
        for (let k = 1; k < n; k++) {
          const u = s.units[k];
          const cont = paintBox({ x: s.x, y: 0, w: s.w, h: H - above, st: { ...s.st, ...NO_BOX, verticalAlign: 'top' }, tl: s.tl, numeric: s.numeric, m: lc.m });
          (u.cont ||= []).push(...cont);
          above += u.height;
        }
      }
    };
    /** Close merged cells at the end of a band of rows (a span never reaches into the next band). */
    const closeSpan = (s) => {
      for (let k = s.ci; k < s.ci + s.cols; k++) cover[k] = null;
      if (s.region) { if (s.units.length > 1) s.region.rowSpan = s.units.length; else delete s.region.rowSpan; } // a band ends the span early
      if (s.units.length) paintSpan(s);
    };
    const endBand = () => { for (const s of openSpans) closeSpan(s); openSpans = []; };

    // table header
    // bandRows "first-last" (BIRT): a header row is evaluated on the first data row, a footer row on the last (fields and
    // running values); the default (RDL) runs a group header's running values over its group and reads the first row
    const fl = base.bandRows === 'first-last';
    const first0 = lc.win?.first || rows[0]; // a window of a longer report (paged.js): the report's first row
    const headerUnits = (item.header || []).map(r => layRow(r, fl && rows.length ? { ...base, pendingRows: [first0] } : base, 'header')).filter(Boolean);
    endBand();
    const headerHeight = headerUnits.reduce((s, u) => s + u.height, 0);
    if (item.repeatHeader !== false) repeatH = headerHeight;
    const headerItems = [];
    for (const u of headerUnits) for (const it of shiftLocal(u.items.filter(i => i.t !== 'link' && i.t !== 'bookmark'), u.top)) headerItems.push(it);
    if (headerUnits.length) headerUnits[headerUnits.length - 1].keepWithNext = true;

    if ((item.__body ? item.__body.length : rows.length) === 0 && item.noRowsText) {
      const st = resolveStyle([lc.base, item.style, { fontStyle: 'italic', color: '#868e96' }], base);
      const tl = layoutTextLines(String(item.noRowsText), st, width, lc.m);
      units.push({ top: y, height: tl.needed, items: paintBox({ x: item.x, y: 0, w: width, h: tl.needed, st, tl, m: lc.m }), kind: 'detail' });
      y += tl.needed;
    }

    // groups (outer → inner), then detail rows
    const groups = item.groups || [];
    let rowNo = lc.win?.rowOffset || 0; // a window (paged.js): the rows before it
    const groupTables = []; // groups whose header repeats: paginated like a table header (paginate/index.js)
    const tableKey = `${item.name || item.type}#${lc.nextId()}`;
    const emit = (level, grows, ctx, chain, keyPath) => {
      if (level === groups.length) {
        for (let i = 0; i < grows.length; i++) {
          if (lc.rowBudget && lc.rowBudget.left-- <= 0) { lc.rowBudget.cut = true; return; }
      lc.tick?.(); // first pages only
          lc.tick?.(); // the time limit, per row: rows whose cells all fail never reach evaluate()
          rowNo++;
          for (const s of chain) { s.index++; s.run.push(grows[i]); }
          const dctx = { ...ctx, fields: grows[i], aggRows: grows, aggIndex: i, rowNumber: rowNo };
          const u0 = units.length;
          for (const r of item.detail || []) layRow(r, dctx, 'detail', { level: groups.length });
          if (lc.win && units[u0]) { units[u0].rowHead = true; for (let k = u0; k < units.length; k++) units[k].dataRow = rowNo; } // paged.js: where a window may start
          // rows of one group instance: paginate keeps widows off them (no lone row at a page foot or head)
          // a group a window continues (paged.js): its rows before the window count too (grpBefore)
          if (groups.length && item.widowControl !== false) for (let k = u0; k < units.length; k++) { units[k].grp = tableKey + keyPath; if (ctx.__before) units[k].grpBefore = ctx.__before; }
          // pageBreakEvery: a new page after every N detail rows (BIRT's pageBreakInterval)
          const every = Math.trunc(Number(item.pageBreakEvery)) || 0;
          if (every > 0 && rowNo > (lc.win?.rowOffset || 0) + 1 && (rowNo - 1) % every === 0 && units[u0]) units[u0].breakBefore = true;
          endBand();
        }
        return;
      }
      const g = groups[level];
      const buckets = groupRows(grows, g.expr, ctx, lc, item.name);
      if (!g.sortBy && (g.sort === 'asc' || g.sort === 'desc')) {
        buckets.sort((a, b) => cmpKey(a.key, b.key, ctx) * (g.sort === 'desc' ? -1 : 1));
      }
      // a group's sortBy, or an interactive sort (which wins), orders the groups by an expression in each group's scope:
      // =Sum(Fields.x) sorts by group totals
      const us = lc.state?.sort?.[item.name] || (g.sortBy ? [{ by: g.sortBy, dir: g.sort === 'desc' ? 'desc' : 'asc' }] : null);
      if (us?.length) {
        const keys = new Map(buckets.map(bk => [bk, us.map(s => { const r = evalSafe(s.by, { ...ctx, fields: bk.rows[0], aggRows: bk.rows, aggIndex: undefined }, lc, item.name); return r.err ? null : r.v; })]));
        buckets.sort((a, b) => {
          for (let k = 0; k < us.length; k++) {
            const x = keys.get(a)[k], y = keys.get(b)[k];
            if (x === y) continue;
            if (x == null) return 1;
            if (y == null) return -1;
            return cmpKey(x, y, ctx) * (us[k].dir === 'desc' ? -1 : 1);
          }
          return 0;
        });
      }
      const gname = g.name || `Group${level + 1}`;
      // a recursive group (parent: the parent's id): instances form a tree, shown depth first
      let roots = buckets, kids = null;
      const recOf = new Map();
      if (g.parent) {
        const byText = new Map(buckets.map(b => [b.text, b]));
        kids = new Map(); roots = [];
        for (const b of buckets) {
          const pk = evalSafe(g.parent, { ...ctx, fields: b.rows[0], aggRows: b.rows, aggIndex: undefined }, lc, `${item.name || item.type} group parent`).v;
          const pr = pk == null || pk === '' ? null : byText.get(pk instanceof Date ? String(pk.getTime()) : String(pk));
          if (!pr || pr === b) roots.push(b);
          else { let k = kids.get(pr); if (!k) kids.set(pr, k = []); k.push(b); }
        }
        // each node's rows and its descendants' (Recursive aggregates); bounded depth, each node once
        const seen = new Set();
        const rec = (b, d) => {
          seen.add(b);
          let all = b.rows;
          for (const c of kids.get(b) || []) if (!seen.has(c) && d < MAX_TREE_DEPTH) all = all.concat(rec(c, d + 1));
          recOf.set(b, all);
          return all;
        };
        for (const r of roots) rec(r, 0);
        for (const b of buckets) if (!recOf.has(b)) rec(b, 0);
      }
      const shown = new Set();
      const node = (bk, bi, sibs, depth, parentPath) => {
        if (lc.rowBudget?.cut || shown.has(bk)) return;
        shown.add(bk);
        // number: GroupIndex(); prevRows: Previous() in a group header or footer
        const sc = { rows: bk.rows, index: -1, run: [], number: bi + 1, prevRows: bi > 0 ? sibs[bi - 1].rows : null, siblings: sibRows(sibs), ...(kids ? { level: depth, recRows: recOf.get(bk) } : {}) };
        // a window of a longer report (paged.js): its first group at each level may continue one begun before it
        const cont = bi === 0 && (level === 0 || ctx.__cont) ? lc.win?.cont?.[level] : null;
        const gctx = { ...ctx, fields: cont ? cont.first : bk.rows[0], aggRows: bk.rows, aggIndex: undefined, scopes: { ...ctx.scopes, [gname]: sc }, groupKey: bk.key, group: sc, __cont: !!cont, __before: cont && level === groups.length - 1 ? cont.before : 0 };
        if (kids) { gctx.level = depth; if (g.indent) gctx.indent = (ctx.indent || 0) + depth * Number(g.indent); }
        const path = `${parentPath}/${bk.text}`;
        const tkey = `${item.name || item.type}|${level}|${path}`;
        const dflt = kids && g.expandLevels != null ? depth < Number(g.expandLevels) : !g.initiallyCollapsed;
        const open = !g.collapsible ? true : (lc.state?.toggles?.[tkey] ?? dflt);
        const start = units.length;
        // a group header comes before its rows: RunningValue and RowNumber over a scope count them too (RDL)
        const hctx = g.header?.length ? { ...gctx, pendingRows: fl ? [cont ? cont.first : bk.rows[0]] : recOf.get(bk) || bk.rows } : gctx;
        // a continued group's header shows again only where it repeats on each page (as the whole report draws it)
        const hu = (cont && !g.repeatHeader ? [] : g.header || []).map((r, ri) => layRow(r, hctx, 'groupHeader', { level, ...(ri === 0 && g.collapsible ? { toggle: { key: tkey, open } } : {}) })).filter(Boolean);
        endBand();
        const before = units.length;
        if (lc.win && !cont && before > start) { for (let k = start; k < before; k++) units[k].dataRow = rowNo + 1; units[start].rowHead = true; units[start].headLevel = level; } // paged.js: a window may start at a group
        // a group header that repeats on each page its group continues on, under the table's (and outer groups') headers
        const rep = g.repeatHeader && before > start && !lc.fixed ? [...(ctx.__rep || []), (() => {
          const hdr = units.slice(start, before), h0 = hdr[0].top, its = [];
          for (const u of hdr) for (const it of shiftLocal(u.items.filter(i => i.t !== 'link' && i.t !== 'bookmark'), u.top - h0)) its.push(it);
          return { items: its, height: hdr.reduce((a, u) => a + u.height, 0) };
        })()] : null;
        if (rep) gctx.__rep = rep;
        const ch = kids?.get(bk) || [];
        if (open) {
          emit(level + 1, bk.rows, gctx, [...chain, sc], path);
          if (ch.length && depth + 1 >= MAX_TREE_DEPTH) lc.warn(`${item.name || item.type}: the group "${gname}" is more than ${MAX_TREE_DEPTH} levels deep; deeper rows are listed at the top level`);
          else ch.forEach((c, ci) => node(c, ci, ch, depth + 1, path));
        } else {
          const rs = recOf.get(bk) || bk.rows;
          for (const s of [...chain, sc]) { s.index += rs.length; for (const r of rs) s.run.push(r); }
          for (const c of ch) markShown(c);
        }
        // keep a group header with the group's content, never with the next group
        if (hu.length && units.length > before) hu[hu.length - 1].keepWithNext = true;
        const fctx = fl ? { ...gctx, fields: bk.rows[bk.rows.length - 1] } : gctx;
        const fu = (g.footer || []).map(r => layRow(r, fctx, 'groupFooter', { level })).filter(Boolean);
        endBand();
        if (rep && units.length > before) {
          let off = item.repeatHeader !== false ? headerHeight : 0;
          const its = item.repeatHeader !== false ? [...headerItems] : [];
          for (const r of rep) { for (const it of shiftLocal(r.items, off)) its.push(it); off += r.height; }
          groupTables.push({ top: units[before].top, bottom: y, headerHeight: off, headerItems: its, x0: item.x, x1: item.x + width, owner: tableKey, depth: rep.length });
        }
        if (fu.length && open) fu[0].keepWithPrevious = true;
        if (units.length > start) {
          if ((g.pageBreak === 'between' || g.newSection) && bi > 0) units[start].breakBefore = true;
          if (g.newSection) units[start].sectionStart = true;
          if (g.pageBreak === 'after' && bi < sibs.length - 1) units[units.length - 1].breakAfter = true;
          // a group a window continues (paged.js) was split in the whole report: its block stays (widow control reads it)
          // but is open: never kept together
          if (g.keepTogether) { const id = `${item.name || item.type}:g${level}:${path}:${lc.nextId()}`; for (let k = start; k < units.length; k++) if (!units[k].block) { units[k].block = id; if (cont) units[k].blockOpen = true; } }
        }
      };
      // a collapsed node hides its subtree: those nodes count as shown
      const markShown = (b) => { // a loop, not recursion: a chain of 50,000 rows must not overflow the stack
        const st = [b];
        while (st.length) { const x = st.pop(); if (shown.has(x)) continue; shown.add(x); for (const c of kids?.get(x) || []) st.push(c); }
      };
      roots.forEach((bk, bi) => node(bk, bi, roots, 0, keyPath));
      if (kids) {
        // nodes in a cycle (A → B → A) or cut off by the depth limit: listed at the top level, once
        const rest = buckets.filter(b => !shown.has(b));
        if (rest.length) { lc.warn(`${item.name || item.type}: ${rest.length} rows of the group "${gname}" have no root (a cycle or too deep); they are listed at the top level`); rest.forEach((bk, bi) => node(bk, bi, rest, 0, keyPath)); }
      }
    };
    if (item.__body) {
      // rows already built (a pivot): each with its own scope
      for (const b of item.__body) {
        if (lc.rowBudget && lc.rowBudget.left-- <= 0) { lc.rowBudget.cut = true; break; }
        lc.tick?.();
        layRow(b.row, b.ctx || base, b.kind || 'detail', { level: b.level ?? 0 });
      }
      endBand();
    } else emit(0, rows, base, [tableScope], '');

    // a total of the first rows only would be wrong: no footer in a partial (first pages) render
    const fStart = units.length;
    const footerUnits = lc.rowBudget?.cut ? [] : (item.footer || []).map(r => layRow(r, fl && rows.length ? { ...base, fields: rows[rows.length - 1] } : base, 'footer')).filter(Boolean);
    endBand();
    if (footerUnits.length) footerUnits[0].keepWithPrevious = true;
    if (item.printAtBottom && footerUnits.length && !lc.fixed) {
      // the footer sits at the bottom of the page the table ends on; what follows starts on the next page
      for (let k = fStart; k < units.length; k++) { units[k].atBottom = true; if (k > fStart) units[k].keepWithPrevious = true; }
      units[units.length - 1].breakAfter = true;
    }

    // the table's own bookmark (document map, jump targets): at its top, on the page where it starts
    if (item.bookmark && units.length) {
      const b = evalSafe(item.bookmark, base, lc, `${item.name || item.type} bookmark`).v;
      if (b != null && b !== '' && b !== '#Error') units[0].items.unshift({ t: 'bookmark', label: String(b), x: item.x, y: 0, level: item.bookmarkLevel ?? 0 });
    }
    if (!lc.fixed) lc.regions?.push(region);
    // wider than the page: the columns continue on the next page set (spec §3.3)
    if (overflow === 'paginate' && !lc.fixed && width > room + 0.01) {
      const hc = units.findIndex(u => u.kind !== 'header');
      const sliced = sliceColumns({
        units, height: y, headerCount: hc < 0 ? units.length : hc, headerHeight, repeatHeader: item.repeatHeader !== false,
        colX, widths: colWidths, x: item.x, repeat: item.repeatColumns || 0, room, order: item.pageOrder === 'across' ? 'across' : 'down',
        pageH: lc.maxUnitHeight ?? Infinity, name: item.name || 'Table', nextId: lc.nextId, warn: lc.warn, shiftLocal, block: item.columnBlock,
      });
      if (sliced) return sliced;
    }
    return {
      height: y, units, width,
      table: item.repeatHeader !== false && headerHeight ? { headerHeight, headerItems, x: item.x, owner: tableKey, depth: 0 } : null,
      ...(groupTables.length ? { tables: groupTables } : {}),
    };
  },
});

const cell_bookmark = (c) => c && c.bookmark;

/**
 * An item in a cell, in pieces that each fit `room`: cut between its units (a nested table's or list's rows), a nested table's
 * repeated header on top of each later piece. Null when it cannot be cut (one unit, overlapping units, a framed box).
 * Linear in the units; the units are already capped by the render's cell-item budget.
 * @returns {{ h: number, items: any[] }[] | null}
 */
function splitNested(nested, room) {
  const us = nested.units;
  if (us.some(u => u.deco)) return null;
  for (let i = 1; i < us.length; i++) if (us[i].top < us[i - 1].top + us[i - 1].height - 0.01) return null;
  const [pt, pb] = nested.pad;
  const head = (y) => { for (const t of nested.tables || []) if (t.headerItems && t.top < y - 0.01 && t.bottom > y + 0.01) return t; return null; };
  const out = [];
  let a = 0;
  while (a < us.length) {
    const t = a ? head(us[a].top) : null;
    const hh = t ? t.headerHeight : 0;
    let b = a + 1;
    while (b < us.length && us[b].top + us[b].height - us[a].top + hh + pt + pb <= room + 0.01) b++;
    // a header row kept with the row after it: the cut moves before it
    if (b < us.length && b - 1 > a && us[b - 1].keepWithNext) b--;
    const items = [];
    if (t) for (const i of shiftLocal(t.headerItems, pt)) items.push(i);
    for (let k = a; k < b; k++) for (const i of shiftLocal(us[k].items.filter(i => i.t !== 'bookmark'), us[k].top - us[a].top + hh + pt)) items.push(i.cell ? { ...i, cell: undefined } : i);
    out.push({ h: us[b - 1].top + us[b - 1].height - us[a].top + hh + pt + pb, items });
    a = b;
  }
  return out.length > 1 ? out : null;
}

// A table with overflowTo is a fixed frame: it keeps its designed height and hands the rows that do not fit to the
// overflow placeholder of that name (on a later body section, the next page of the form). On a page repeated for
// more rows the table is not drawn again.
{
  const base = ITEMS.table.layout;
  ITEMS.table.layout = (item, lc) => {
    if (!item.overflowTo || !lc.overflow || item.__body || lc.fixed) return base(item, lc);
    if (lc.overflow.repeat) return emptyBox(item);
    const res = base({ ...item, overflowTo: undefined }, { ...lc, maxUnitHeight: Infinity });
    if (!res.units.length) return res;
    const head = res.units.filter(u => u.kind === 'header');
    const rows = res.units.filter(u => u.kind !== 'header');
    const n = fitRows(rows, item.h - head.reduce((a, u) => a + u.height, 0));
    if (n < rows.length) lc.overflow.pending.set(String(item.overflowTo), { table: item.name || 'Table', to: String(item.overflowTo), head, units: rows.slice(n), x: item.x });
    return { height: item.h, units: [{ top: 0, height: item.h, items: stack([...head, ...rows.slice(0, n)], 0) }] };
  };
}
const MAX_TREE_DEPTH = 64;
const CELL_ITEM_UNITS = 100000;

/**
 * A number for data export: the full value, as SSRS exports it (Excel's number format does the display rounding, so a
 * column of 0.333, 0.333, 0.334 shown as N2 still sums to 1). Only binary noise past 15 significant digits goes
 * (0.30000000000000004 is 0.3), which Excel would not show either. fmt is unused (kept for the call sites).
 */
export function roundFor(v, fmt) { // eslint-disable-line no-unused-vars
  return Number.isInteger(v) || !Number.isFinite(v) ? v : Number(v.toPrecision(15));
}

/* ---------------------------------------------------------------- container */
register('container', {
  label: 'Container',
  defaults: () => ({ type: 'container', w: 240, h: 72, items: [], keepTogether: true, style: { border: '0.75 solid #d0d7de', padding: 0 } }),
  props: [
    { key: 'dataSet', label: 'Data set (for its hidden expression and style)', type: 'dataset', category: 'Data' },
    { key: 'keepTogether', label: 'Keep together on one page', type: 'bool', category: 'Layout' },
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'pageBreakAfter', label: 'Page break after', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const res = lc.layoutItems(item.items, lc, { dx: item.x });
    return frame(item, lc, ctx, res, item.keepTogether !== false ? `c:${item.name || item.type}:${lc.nextId()}` : null);
  },
});

/** Wrap child units of a container or list row: background, border, keep-together block. */
function frame(item, lc, ctx, res, blockId0) {
  let blockId = blockId0;
  const h = Math.max(item.h, res.height);
  const st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
  const deco = paintBox({ x: item.x, y: 0, w: item.w, h, st, tl: null, m: lc.m });
  // taller than a page, it cannot be kept together: it flows, its rows start where it is (R4: a list row with a long
  // nested table went to the next page whole and left most of the page empty)
  if (blockId && h > (lc.maxUnitHeight ?? Infinity) + 0.01) blockId = null;
  const units = res.units.map(u => ({ ...u, block: u.block || blockId }));
  if (deco.length) {
    if (blockId || !units.length) units.unshift({ top: 0, height: h, items: deco, block: blockId, x0: item.x, x1: item.x + item.w, deco: true });
    else {
      // not kept together: the background and border go with the rows, one strip per unit (sides on every strip, the
      // top edge on the first, the bottom edge on the last), so they break across pages with them
      const ord = [...units].sort((a, b) => a.top - b.top);
      const b = borders(st), none = 'none';
      ord.forEach((u, i) => {
        const y0 = i === 0 ? 0 : u.top, y1 = i === ord.length - 1 ? h : ord[i + 1].top;
        if (y1 <= y0) return;
        const sst = { ...st, border: null, borderLeft: b.left ? st.borderLeft ?? st.border : none, borderRight: b.right ? st.borderRight ?? st.border : none,
          borderTop: i === 0 && b.top ? st.borderTop ?? st.border : none, borderBottom: i === ord.length - 1 && b.bottom ? st.borderBottom ?? st.border : none };
        const strip = paintBox({ x: item.x, y: y0 - u.top, w: item.w, h: y1 - y0, st: sst, tl: null, m: lc.m });
        const k = units.indexOf(u);
        units[k] = { ...u, items: [...strip, ...u.items], x0: Math.min(u.x0 ?? item.x, item.x), x1: Math.max(u.x1 ?? item.x + item.w, item.x + item.w) };
      });
    }
  }
  if (!units.length) units.push({ top: 0, height: h, items: [], x0: item.x, x1: item.x + item.w });
  return { height: h, units, tables: res.tables, width: item.w };
}

/* ---------------------------------------------------------------- list */
register('list', {
  label: 'List',
  defaults: () => ({ type: 'list', w: 360, h: 60, dataSet: null, groupBy: null, items: [], keepTogether: true, style: { borderBottom: '0.5 solid #d0d7de' } }),
  props: [
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'groupBy', label: 'Group by (one row per group)', type: 'expr', category: 'Data' },
    { key: 'groupAdjacent', label: 'A new group at every change (not sorted)', type: 'bool', category: 'Data' },
    { key: 'inheritRows', label: 'Rows of the enclosing list row', type: 'bool', category: 'Data' },
    { key: 'keepTogether', label: 'Keep each row on one page', type: 'bool', category: 'Layout' },
    { key: 'pageBreakBetween', label: 'Page break between rows', type: 'bool', category: 'Layout' },
    { key: 'columns', label: 'Records across (grid)', type: 'number', category: 'Layout' },
    { key: 'columnGap', label: 'Gap between records across (pt)', type: 'number', category: 'Layout', showIf: (it) => Number(it.columns) > 1 },
    { key: 'newSection', label: 'Each row starts a section (page numbers restart)', type: 'bool', category: 'Layout' },
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    let rows = (item.dataSet && lc.dataSets[item.dataSet]) || [];
    // inheritRows: a list inside a row of a list over the same data set takes that row's rows (a banded group)
    if (item.inheritRows && item.dataSet && ctx.current?.[item.dataSet]) rows = ctx.current[item.dataSet];
    else rows = related(rows, ctx); // a nested data set inside a list of its parent: that row's children
    if (item.dataSet && !lc.dataSets[item.dataSet]) lc.warn(`${item.name || item.type}: the data set "${item.dataSet}" does not exist`);
    if (item.filters?.length) rows = applyFilters(rows, item.filters, ctx);
    if (item.sort?.length) rows = applySort(rows, item.sort, ctx);
    const reps = item.groupBy ? groupRows(rows, item.groupBy, ctx, lc, item.name, item.groupAdjacent === true).map(b => b.rows) : rows.map(r => [r]);
    const units = [], tables = [];
    let y = 0;
    const listScope = { rows, index: -1, run: [] };
    const ncol = Math.max(1, Math.min(50, Math.floor(Number(item.columns)) || 1));
    const gap = Number(item.columnGap ?? 6) || 0;
    let cells = null;
    reps.forEach((rs, i) => {
      if (lc.rowBudget && lc.rowBudget.left-- <= 0) { lc.rowBudget.cut = true; return; }
      listScope.index = i;
      listScope.prevRows = i > 0 ? reps[i - 1] : null;
      if (item.groupBy) listScope.number = i + 1;
      for (const r of rs) listScope.run.push(r);
      // current: the rows of each data set this row stands for, so nested data sets inside see only their children
      const current = item.dataSet ? { ...(ctx.current || {}), [item.dataSet]: rs } : ctx.current;
      const rctx = { ...ctx, fields: rs[0], aggRows: rs, aggIndex: undefined, rowNumber: i + 1, parentFields: rs[0], scopes: { ...(ctx.scopes || {}), [item.name]: listScope }, region: listScope, group: item.groupBy ? listScope : undefined, current };
      const child = { ...lc, ctxFor: (it) => {
        if (!(it.dataSet && it.dataSet !== item.dataSet)) return rctx;
        const c = { ...lc.ctxFor(it), parentFields: rs[0], scopes: rctx.scopes, current };
        const kids = related(c.aggRows, c);
        return kids === c.aggRows ? c : { ...c, aggRows: kids, fields: kids[0] || null };
      } };
      const k = i % ncol;
      const res = lc.layoutItems(item.items, child, { dx: item.x + k * (item.w + gap) });
      const fr = frame({ ...item, x: item.x + k * (item.w + gap), name: `${item.name || item.type}[${i + 1}]` }, child, rctx, res, item.keepTogether !== false ? `l:${item.name || item.type}:${i}:${lc.nextId()}` : null);
      if (ncol > 1) {
        // a grid list: n records side by side, each row of the grid one unit
        if (k === 0) { cells = { top: y, height: 0, items: [], x0: item.x, x1: item.x + ncol * item.w + (ncol - 1) * gap, block: undefined }; units.push(cells); }
        for (const u of fr.units) for (const it of shiftLocal(u.items, u.top)) cells.items.push(it);
        cells.height = Math.max(cells.height, fr.height);
        if (k === ncol - 1 || i === reps.length - 1) y += cells.height;
        if (k === 0 && i > 0 && (item.pageBreakBetween || item.newSection)) cells.breakBefore = true;
        if (k === 0 && item.newSection) cells.sectionStart = true;
        return;
      }
      fr.units.forEach((u, j) => units.push({ ...u, top: u.top + y, breakBefore: u.breakBefore || (j === 0 && i > 0 && !!(item.pageBreakBetween || item.newSection)), ...(j === 0 && item.newSection ? { sectionStart: true } : {}) }));
      for (const t of fr.tables || []) tables.push({ ...t, top: t.top + y, bottom: t.bottom + y });
      y += fr.height;
    });
    if (!reps.length) units.push({ top: 0, height: 0, items: [] });
    return { height: y, units, tables, width: ncol > 1 ? ncol * item.w + (ncol - 1) * gap : item.w };
  },
});

/* ---------------------------------------------------------------- checkbox */
register('checkbox', {
  label: 'Check box',
  defaults: () => ({ type: 'checkbox', w: 120, h: 14, value: '=True', text: 'Label', style: {} }),
  props: [
    { key: 'value', label: 'Checked (true/false)', type: 'expr', category: 'Data' },
    { key: 'text', label: 'Label', type: 'expr', category: 'Data' },
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
    const r = evalSafe(item.value ?? false, ctx, lc, item.name || 'CheckBox');
    const on = r.v === true || r.v === 1 || (typeof r.v === 'string' && ['true', 'yes', 'y', '1'].includes(r.v.toLowerCase()));
    const size = Math.min(item.h, (Number(st.fontSize) || 9) + 2);
    const by = (item.h - size) / 2;
    const color = st.color || '#1f2328';
    const items = [{ t: 'rect', x: item.x, y: by, w: size, h: size, fill: '#ffffff', stroke: color, strokeWidth: 0.75, radius: 1.5 }];
    if (on) items.push({ t: 'path', x: item.x, y: by, d: `M ${size * 0.2} ${size * 0.52} L ${size * 0.42} ${size * 0.74} L ${size * 0.8} ${size * 0.26}`, stroke: color, strokeWidth: Math.max(1, size * 0.12), fill: null });
    const label = item.text != null ? textOf(evalSafe(item.text, ctx, lc, item.name).v, st, ctx, lc) : '';
    if (label) {
      const tst = { ...st, padding: 0, verticalAlign: 'middle' };
      const tl = layoutTextLines(label, tst, item.w - size - 4, lc.m, { wrap: false });
      items.push(...paintBox({ x: item.x + size + 4, y: 0, w: item.w - size - 4, h: item.h, st: { ...tst, backgroundColor: null, border: null }, tl, m: lc.m }));
    }
    return { height: item.h, units: [{ top: 0, height: item.h, items }] };
  },
});

function shiftLocal(items, dy) {
  return items.map((it) => {
    let o;
    if (it.t === 'text') o = { ...it, lines: it.lines.map(l => ({ ...l, y: l.y + dy })), clip: it.clip && { ...it.clip, y: it.clip.y + dy } };
    else if (it.t === 'line') o = { ...it, y1: it.y1 + dy, y2: it.y2 + dy };
    else if (it.t === 'ellipse') o = { ...it, cy: it.cy + dy };
    else if (it.t === 'field') o = { ...it, y: it.y + dy, draw: shiftLocal(it.draw, dy) };
    else o = { ...it, y: it.y + dy };
    if (it.rotate) o.rotate = { ...it.rotate, cy: it.rotate.cy + dy };
    return o;
  });
}

/* ---------------------------------------------------------------- chart */
register('chart', {
  label: 'Chart',
  defaults: () => ({ type: 'chart', w: 320, h: 180, chartType: 'column', dataSet: null, category: '', series: [{ name: 'Value', value: '' }], legend: 'bottom', valueFormat: 'N0', title: '' }),
  props: [
    { key: 'chartType', label: 'Chart type', type: 'select', options: CHART_TYPES, category: 'Chart' },
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Chart' },
    { key: 'title', label: 'Title', type: 'expr', category: 'Chart' },
    { key: 'category', label: 'Category (x axis / slices)', type: 'expr', category: 'Chart', showIf: (i) => !ROW_CHARTS.has(i.chartType) && i.chartType !== 'gauge' && i.chartType !== 'histogram' },
    { key: 'categorySort', label: 'Sort categories', type: 'select', options: ['asc', 'desc'], category: 'Chart', showIf: (i) => !ROW_CHARTS.has(i.chartType) && i.chartType !== 'gauge' },
    { key: 'categoryFormat', label: 'Category format', type: 'text', category: 'Chart', showIf: (i) => !ROW_CHARTS.has(i.chartType) && i.chartType !== 'gauge' },
    { key: 'maxCategories', label: 'Show at most N categories (a number or =Parameters.top)', labelKey: 'chartMaxCategories', type: 'expr', category: 'Chart', showIf: (i) => !ROW_CHARTS.has(i.chartType) && i.chartType !== 'gauge' },
    { key: 'xValue', label: 'X value (scatter, bubble) or angle in degrees (polar)', type: 'expr', category: 'Chart', showIf: (i) => ROW_CHARTS.has(i.chartType) },
    { key: 'series', label: 'Series', type: 'series', category: 'Chart', showIf: (i) => i.chartType !== 'gantt' },
    { key: 'seriesGroup', label: 'One series per value of', type: 'expr', category: 'Chart', showIf: (i) => !ROW_CHARTS.has(i.chartType) && !['pie', 'donut', 'gauge', 'funnel', 'treemap', 'histogram', 'boxplot', 'waterfall'].includes(i.chartType) },
    { key: 'binCount', label: 'Number of bins (empty: automatic)', type: 'number', category: 'Chart', showIf: (i) => i.chartType === 'histogram' },
    { key: 'binWidth', label: 'Bin width (instead of a number of bins)', type: 'number', category: 'Chart', showIf: (i) => i.chartType === 'histogram' },
    { key: 'showMean', label: 'Mark the mean', type: 'bool', category: 'Chart', showIf: (i) => i.chartType === 'boxplot' },
    { key: 'waterfallTotals', label: 'Subtotal bar when (e.g. =Fields.isTotal)', type: 'expr', category: 'Chart', showIf: (i) => i.chartType === 'waterfall' },
    { key: 'showTotal', label: 'Total bar at the end', type: 'bool', defaultOn: true, category: 'Chart', showIf: (i) => i.chartType === 'waterfall' },
    { key: 'totalLabel', label: 'Total bar label', type: 'text', category: 'Chart', showIf: (i) => i.chartType === 'waterfall' && i.showTotal !== false },
    { key: 'totalColor', label: 'Total colour', type: 'color', category: 'Chart', showIf: (i) => i.chartType === 'waterfall' },
    { key: 'ganttStart', label: 'Bar start (date or number)', type: 'expr', category: 'Chart', showIf: (i) => i.chartType === 'gantt' },
    { key: 'ganttEnd', label: 'Bar end (date or number)', type: 'expr', category: 'Chart', showIf: (i) => i.chartType === 'gantt' },
    { key: 'ganttToday', label: 'Today line', type: 'bool', defaultOn: true, category: 'Chart', showIf: (i) => i.chartType === 'gantt' },
    { key: 'todayColor', label: 'Today line colour', type: 'color', category: 'Chart', showIf: (i) => i.chartType === 'gantt' && i.ganttToday !== false },
    { key: 'stacked', label: 'Stacking', type: 'stacked', category: 'Chart', showIf: (i) => AXIS_CHARTS.has(i.chartType || 'column') },
    { key: 'line', label: 'Lines', type: 'select', options: ['straight', 'smooth', 'step'], category: 'Chart', showIf: (i) => AXIS_CHARTS.has(i.chartType || 'column') },
    { key: 'upColor', label: 'Rising colour', type: 'color', category: 'Chart', showIf: (i) => i.chartType === 'candlestick' || i.chartType === 'ohlc' || i.chartType === 'waterfall' },
    { key: 'downColor', label: 'Falling colour', type: 'color', category: 'Chart', showIf: (i) => i.chartType === 'candlestick' || i.chartType === 'ohlc' || i.chartType === 'waterfall' },
    { key: 'gaugeShape', label: 'Gauge shape', labelKey: 'gaugeShape', type: 'select', options: [{ value: 'half', label: 'Half circle' }, { value: 'threeQuarter', label: 'Three-quarter circle' }, { value: 'full', label: 'Full circle' }], category: 'Chart', showIf: (i) => i.chartType === 'gauge' },
    { key: 'gaugeIndicator', label: 'Value shown by', labelKey: 'gaugeIndicator', type: 'select', options: [{ value: 'needle', label: 'Needle' }, { value: 'pointer', label: 'Pointer on the scale' }, { value: 'bar', label: 'Bar along the scale' }], category: 'Chart', showIf: (i) => i.chartType === 'gauge' },
    { key: 'pointerColor', label: 'Needle or pointer colour', labelKey: 'gaugePointerColor', type: 'color', category: 'Chart', showIf: (i) => i.chartType === 'gauge' && i.gaugeIndicator !== 'bar' },
    { key: 'gaugeTicks', label: 'Tick marks and values', labelKey: 'gaugeTicks', type: 'bool', defaultOn: true, category: 'Chart', showIf: (i) => i.chartType === 'gauge' },
    { key: 'axes', label: 'Axes', type: 'axes', category: 'Axes', showIf: (i) => !['pie', 'donut', 'funnel', 'treemap'].includes(i.chartType) },
    { key: 'xTitle', label: 'X axis title', type: 'text', category: 'Axes', showIf: (i) => !i.axes?.x?.title && !['pie', 'donut', 'funnel', 'gauge', 'radar', 'polar', 'treemap'].includes(i.chartType) },
    { key: 'overlays', label: 'Trend lines, reference lines and bands', type: 'overlays', category: 'Overlays', showIf: (i) => !['pie', 'donut', 'funnel', 'radar', 'polar'].includes(i.chartType) && !MORE_CHARTS.has(i.chartType) },
    { key: 'showValues', label: 'Show values', type: 'bool', category: 'Labels' },
    { key: 'labelTemplate', label: 'Label text: {value} {category} {series} {percent}, or =expression', type: 'text', category: 'Labels' },
    { key: 'labelPosition', label: 'Label position', type: 'select', options: ['outside', 'inside', 'center'], category: 'Labels' },
    { key: 'valueFormat', label: 'Value format', type: 'text', category: 'Labels' },
    { key: 'legend', label: 'Legend', type: 'select', options: ['bottom', 'none'], category: 'Look' },
    { key: 'palette', label: 'Palette', labelKey: 'chartPalette', type: 'palette', options: Object.keys(PALETTES), category: 'Look' },
    { key: 'animation', label: 'Animation in the viewer', type: 'select', options: ['none', 'grow', 'fade'], category: 'Look' },
    { key: 'fontSize', label: 'Text size', type: 'number', category: 'Look' },
    { key: 'background', label: 'Background', type: 'color', category: 'Look' },
    { key: 'pointAction', label: 'Click on a bar or slice', type: 'action', category: 'Interactivity' },
    { key: 'pointColor', label: 'Bar or slice colour (expression, e.g. highlight the selected one)', type: 'expr', category: 'Interactivity' },
    { key: 'tooltips', label: 'Tooltips on hover', type: 'bool', category: 'Interactivity' },
    { key: 'keepTogether', label: 'Keep on one page', type: 'bool', category: 'Layout' },
    ALT,
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  styleProps: [],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const meta = {};
    const items = paintChart(item, ctx, lc, lc.base, meta);
    addInteractivity(items, item, ctx, lc, { x: item.x, y: 0, w: item.w, h: item.h });
    return { height: item.h, units: [{ top: 0, height: item.h, items }], alt: meta.alt };
  },
});

/* ---------------------------------------------------------------- form field */
const FIELD_KINDS = ['text', 'multiline', 'checkbox', 'choice'];
// A fillable field. The PDF gets a real form widget; the viewer and HTML draw `draw` instead.
register('field', {
  label: 'Form field',
  defaults: () => ({ type: 'field', w: 180, h: 18, kind: 'text', fieldName: 'field1', value: '', style: {} }),
  props: [
    { key: 'kind', label: 'Kind', type: 'select', options: FIELD_KINDS, category: 'Field' },
    { key: 'fieldName', label: 'Field name (unique; {Fields.x} allowed)', type: 'expr', category: 'Field' },
    { key: 'label', label: 'Label (the name a screen reader says)', type: 'expr', category: 'Field' },
    { key: 'value', label: 'Starting value', type: 'expr', category: 'Field' },
    { key: 'options', label: 'Choices (comma-separated or =expression)', type: 'expr', category: 'Field' },
    { key: 'required', label: 'Required', type: 'bool', category: 'Field' },
    { key: 'readOnly', label: 'Read only', type: 'bool', category: 'Field' },
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const who = item.name || 'Field';
    const st = resolveStyle([lc.base, { border: '0.75 solid #9ca3af', padding: '2 3', backgroundColor: '#ffffff' }, lc.named?.[item.styleName], item.style], ctx);
    const kind = FIELD_KINDS.includes(item.kind) ? item.kind : 'text';
    // "." means a field hierarchy in PDF forms; spaces trip some readers
    const name = String(evalSafe(item.fieldName || item.name || 'field', ctx, lc, who).v || 'field').replace(/[.\s]+/g, '_');
    const lab = item.label ?? item.tooltip; // the accessible name (a tagged PDF's /TU)
    const label = lab == null || lab === '' ? '' : String(evalSafe(lab, ctx, lc, who).v ?? '');
    const raw = evalSafe(item.value ?? '', ctx, lc, who).v;
    let options = [];
    if (kind === 'choice') {
      const o = evalSafe(item.options ?? '', ctx, lc, who).v;
      options = (Array.isArray(o) ? o : String(o ?? '').split(',')).map(s => String(s).trim()).filter(Boolean);
    }
    const value = kind === 'checkbox' ? truthy(raw) : raw == null ? '' : textOf(raw, st, ctx, lc);
    const draw = [];
    if (kind === 'checkbox') {
      const size = Math.min(item.w, item.h);
      draw.push({ t: 'rect', x: item.x, y: 0, w: size, h: size, fill: st.backgroundColor, stroke: '#9ca3af', strokeWidth: 0.75 });
      if (value) draw.push({ t: 'path', x: item.x, y: 0, d: `M ${size * 0.2} ${size * 0.52} L ${size * 0.42} ${size * 0.74} L ${size * 0.8} ${size * 0.26}`, stroke: st.color || '#1f2328', strokeWidth: Math.max(1, size * 0.12), fill: null });
    } else {
      const tl = layoutTextLines(String(value), st, item.w - (kind === 'choice' ? 12 : 0), lc.m, { wrap: kind === 'multiline' });
      draw.push(...paintBox({ x: item.x, y: 0, w: item.w, h: item.h, st, tl, m: lc.m }));
      if (kind === 'choice') draw.push({ t: 'path', x: item.x + item.w - 10, y: item.h / 2 - 2, d: 'M 0 0 L 3 3 L 6 0', stroke: '#6b7280', strokeWidth: 1, fill: null });
    }
    const field = {
      t: 'field', kind, name, ...(label ? { label } : {}), value, options, required: !!item.required, readOnly: !!item.readOnly,
      x: item.x, y: 0, w: item.w, h: item.h, font: resolveFontKey(st.fontFamily, st.fontWeight, st.fontStyle), size: Number(st.fontSize) || 9, draw,
    };
    return { height: item.h, units: [{ top: 0, height: item.h, items: [field] }] };
  },
});

/* ---------------------------------------------------------------- map */
register('map', {
  label: 'Map',
  defaults: () => ({ type: 'map', w: 360, h: 240, geojson: '', shapeKey: '=Fields.name', colorLow: '#dbeafe', colorHigh: '#1e3a8a', legend: 'bottom', valueFormat: 'N0' }),
  props: [
    { key: 'geojson', label: 'Shapes: GeoJSON text', type: 'text', category: 'Shapes' },
    { key: 'dataSet', label: 'Shapes: data set of features (instead of the text)', type: 'dataset', category: 'Shapes' },
    { key: 'geometry', label: 'Shapes: geometry (data set)', type: 'expr', category: 'Shapes' },
    { key: 'shapeKey', label: 'Shapes: key (e.g. =Fields.name)', type: 'expr', category: 'Shapes' },
    { key: 'valueDataSet', label: 'Colour by: data set', type: 'dataset', category: 'Colour' },
    { key: 'valueKey', label: 'Colour by: key that matches the shape key', type: 'expr', category: 'Colour' },
    { key: 'value', label: 'Colour by: value (aggregate)', type: 'expr', category: 'Colour' },
    { key: 'valueFormat', label: 'Value format', type: 'text', category: 'Colour' },
    { key: 'colorLow', label: 'Lowest value colour', type: 'color', category: 'Colour' },
    { key: 'colorHigh', label: 'Highest value colour', type: 'color', category: 'Colour' },
    { key: 'legend', label: 'Legend', type: 'select', options: ['bottom', 'none'], category: 'Colour' },
    { key: 'colorScale', label: 'Colour scale', type: 'select', options: [{ value: 'continuous', label: 'Continuous (heat)' }, { value: 'classes', label: 'Classes (graduated)' }], category: 'Colour' },
    { key: 'classes', label: 'Number of classes (2–9)', type: 'number', category: 'Colour', showIf: (i) => i.colorScale === 'classes' },
    { key: 'lineColor', label: 'Lines: colour (LineString shapes)', type: 'color', category: 'Shapes' },
    { key: 'lineWidth', label: 'Lines: width (pt)', type: 'number', category: 'Shapes' },
    { key: 'regionAction', label: 'Click on a region', type: 'action', category: 'Interactivity' },
    { key: 'tooltips', label: 'Tooltips on hover', type: 'bool', defaultOn: true, category: 'Interactivity' },
    { key: 'pointDataSet', label: 'Points: data set', type: 'dataset', category: 'Points' },
    { key: 'lat', label: 'Points: latitude', type: 'expr', category: 'Points' },
    { key: 'lon', label: 'Points: longitude', type: 'expr', category: 'Points' },
    { key: 'pointSize', label: 'Points: size by', type: 'expr', category: 'Points' },
    { key: 'pointLabel', label: 'Points: label', type: 'expr', category: 'Points' },
    { key: 'pointColor', label: 'Points: colour', type: 'color', category: 'Points' },
    { key: 'keepTogether', label: 'Keep on one page', type: 'bool', category: 'Layout' },
    ALT,
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  styleProps: [],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const items = paintMap(item, ctx, lc, lc.base);
    addInteractivity(items, item, ctx, lc, { x: item.x, y: 0, w: item.w, h: item.h });
    return { height: item.h, units: [{ top: 0, height: item.h, items }] };
  },
});

/* ---------------------------------------------------------------- sparkline / data bar / bullet */
for (const [type, label, defaults] of [
  ['sparkline', 'Sparkline', { value: '', style: 'line' }],
  ['databar', 'Data bar', { value: '', max: '' }],
  ['bullet', 'Bullet', { value: '', max: '', target: '' }],
  ['iconset', 'Icon set', { value: '', iconSet: 'trafficLights', lower: '=33', upper: '=67', w: 18, h: 18 }],
  ['rangebar', 'Range bar', { low: '', high: '', min: '', max: '' }],
]) {
  register(type, {
    label,
    defaults: () => ({ type, w: 120, h: 18, color: '#2563eb', ...defaults }),
    props: [
      { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
      ...(type === 'sparkline' ? [{ key: 'category', label: 'One point per (e.g. =Fields.month)', type: 'expr', category: 'Data' }] : []),
      ...(type !== 'rangebar' ? [{ key: 'value', label: type === 'sparkline' ? 'Value (aggregate when a category is set)' : 'Value', type: 'expr', category: 'Data' }] : []),
      ...(type === 'sparkline' ? [
        { key: 'style', label: 'Style', type: 'select', options: ['line', 'column', 'area', 'winloss'], category: 'Data' },
        { key: 'bandLow', label: 'Range band from', type: 'expr', category: 'Data' },
        { key: 'bandHigh', label: 'Range band to', type: 'expr', category: 'Data' },
        { key: 'bandColor', label: 'Range band colour', type: 'color', category: 'Data' },
      ] : []),
      ...(type === 'iconset' ? [
        { key: 'iconSet', label: 'Icons', type: 'select', options: ICON_SETS, category: 'Data' },
        { key: 'lower', label: 'Low below', type: 'expr', category: 'Data' },
        { key: 'upper', label: 'High from', type: 'expr', category: 'Data' },
        { key: 'reverse', label: 'Reverse order (higher is worse)', type: 'bool', category: 'Data' },
      ] : []),
      ...(type === 'rangebar' ? [
        { key: 'low', label: 'From', type: 'expr', category: 'Data' },
        { key: 'high', label: 'To', type: 'expr', category: 'Data' },
        { key: 'min', label: 'Scale minimum', type: 'expr', category: 'Data' },
      ] : []),
      ...(type !== 'sparkline' && type !== 'iconset' ? [{ key: 'max', label: 'Maximum', type: 'expr', category: 'Data' }] : []),
      ...(type === 'bullet' ? [{ key: 'target', label: 'Target', type: 'expr', category: 'Data' }] : []),
      ...(type !== 'iconset' ? [{ key: 'color', label: 'Color', type: 'color', category: 'Data' }] : []),
      ALT,
      { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
    ],
    styleProps: [],
    layout(item, lc) {
      const ctx = lc.ctxFor(item);
      if (hidden(item, ctx, lc)) return { height: 0, units: [] };
      // in a detail cell or a list row (one row of a region): compare with the region's other rows, as a cell visual does
      // (a bar's maximum is the column's largest value), not with this row alone (every bar full)
      const oneRow = ctx.aggIndex == null && ctx.region?.rows && ctx.aggRows?.length === 1 && ctx.aggRows[0] === ctx.fields;
      const items = paintVisual({ ...item, type }, { x: item.x, y: 0, w: item.w, h: item.h }, oneRow ? { ...ctx, aggIndex: 0 } : ctx, lc, lc.base, item.name);
      return { height: item.h, units: [{ top: 0, height: item.h, items }] };
    },
  });
}

/* ---------------------------------------------------------------- barcode */
register('barcode', {
  label: 'Barcode',
  defaults: () => ({ type: 'barcode', w: 160, h: 48, symbology: 'code128', value: '', showText: true, style: { fontSize: 8, textAlign: 'center' } }),
  props: [
    { key: 'symbology', label: 'Symbology', type: 'select', options: SYMBOLOGIES.map(s => ({ value: s.id, label: s.name })), category: 'Barcode' },
    { key: 'value', label: 'Value', type: 'expr', category: 'Barcode' },
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Barcode' },
    { key: 'showText', label: 'Show the text', type: 'bool', category: 'Barcode', showIf: (it) => !isTwoD(it.symbology || 'code128') },
    { key: 'captionPosition', label: 'Text position', type: 'select', options: ['below', 'above'], category: 'Barcode', showIf: (it) => !isTwoD(it.symbology || 'code128') && it.showText !== false },
    { key: 'quietZone', label: 'Quiet zone (pt of white around the code)', type: 'number', category: 'Barcode' },
    { key: 'rotate', label: 'Rotate', type: 'select', options: ['0', '90', '180', '270'], category: 'Barcode' },
    ...BARCODE_OPTIONS.map(o => ({ key: o.key, label: o.label, type: o.enum ? 'select' : o.bool ? 'bool' : o.size ? 'text' : 'number', options: o.enum, category: 'Barcode options', showIf: (it) => o.for.includes(it.symbology || 'code128') })),
    { key: 'action', label: 'Action', type: 'action', category: 'Interactivity' },
    ALT,
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
    const who = item.name || `Barcode at (${item.x}, ${item.y})`; // an unnamed item is named by its type and place
    const r = evalSafe(item.value ?? '', ctx, lc, who);
    const text = r.err ? '' : textOf(r.v, st, ctx, lc);
    const size = Number(st.fontSize) || 8;
    const show = item.showText !== false;
    const th = show ? size * 1.4 : 0;
    const above = item.captionPosition === 'above';
    // a turned code is drawn in the box turned on its side, then rotated about the item's centre
    const a = (((Math.round(Number(item.rotate) / 90) || 0) * 90) % 360 + 360) % 360;
    const swap = a === 90 || a === 270;
    const cx = item.x + item.w / 2, cy = item.h / 2;
    const bw = swap ? item.h : item.w, bh = swap ? item.w : item.h;
    const bx = cx - bw / 2, by = cy - bh / 2;
    const q = Math.min(Math.max(0, Number(item.quietZone) || 0), bw / 3, bh / 3);
    const bc = paintBarcode({ type: item.symbology || 'code128', text, x: bx + q, y: by + q, w: bw - 2 * q, h: bh - 2 * q, color: st.color || '#000', showText: show, textHeight: th, captionAbove: above, options: bwipOptions(item) });
    let items = [...bc.items];
    if (bc.error) {
      lc.warn(`${who}: ${bc.error}`);
      const tl = layoutTextLines(`Barcode error: ${bc.error}`, { ...st, color: '#b91c1c' }, item.w, lc.m);
      return { height: item.h, units: [{ top: 0, height: item.h, items: paintBox({ x: item.x, y: 0, w: item.w, h: item.h, st: { ...st, color: '#b91c1c', border: '0.5 dashed #b91c1c' }, tl, m: lc.m }) }] };
    }
    if (show && !bc.twoD && text) {
      const tl = layoutTextLines(text, { ...st, padding: 0 }, bw - 2 * q, lc.m, { wrap: false });
      items.push(...paintBox({ x: bx + q, y: above ? by + q : by + bh - q - th, w: bw - 2 * q, h: th, st: { ...st, padding: 0, verticalAlign: above ? 'top' : 'bottom', textAlign: st.textAlign === 'auto' ? 'center' : st.textAlign }, tl, m: lc.m }));
    }
    if (a) items = items.map(i => ({ ...i, rotate: { a, cx, cy } }));
    addInteractivity(items, item, ctx, lc, { x: item.x, y: 0, w: item.w, h: item.h }); // after the turn: the hot spot is the item's box
    const name = SYMBOLOGIES.find(s => s.id === (item.symbology || 'code128'))?.name || item.symbology || 'code128';
    return { height: item.h, units: [{ top: 0, height: item.h, items }], alt: `${name} barcode${text ? `: ${text}` : ''}` };
  },
});

/* ---------------------------------------------------------------- matrix (pivot) */
register('matrix', {
  label: 'Matrix',
  defaults: () => ({ type: 'matrix', w: 360, h: 54, dataSet: null, rowGroup: '', columnGroup: '', value: '=Count(Fields)', valueFormat: 'N0',
    corner: '', rowHeaderWidth: 110, columnWidth: 64, rowTotals: true, columnTotals: true, columnSort: 'asc', rowSort: 'asc',
    headerStyle: { fontWeight: 'bold', backgroundColor: '#f1f5f9', borderBottom: '1 solid #94a3b8' }, style: { padding: [3, 4, 3, 4] } }),
  // rows, columns and values: the designer's pivot editor (rowGroups / columnGroups / values, or the old single-group keys)
  props: [
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'corner', label: 'Corner text', type: 'text', category: 'Data' },
    { key: 'rowHeaderWidth', label: 'Row header width', type: 'number', category: 'Layout' },
    { key: 'columnWidth', label: 'Column width', type: 'number', category: 'Layout' },
    { key: 'repeatHeader', label: 'Repeat header on each page', type: 'bool', category: 'Layout' },
    { key: 'overflow', label: 'Wider than the page', type: 'select', options: OVERFLOW_OPTIONS, category: 'Layout' },
    { key: 'pageOrder', label: 'Page order', type: 'select', options: [{ value: 'down', label: 'Down, then across' }, { value: 'across', label: 'Across, then down' }], category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    let rows = (item.dataSet && lc.dataSets[item.dataSet]) || [];
    // inheritRows: a list inside a row of a list over the same data set takes that row's rows (a banded group)
    if (item.inheritRows && item.dataSet && ctx.current?.[item.dataSet]) rows = ctx.current[item.dataSet];
    else rows = related(rows, ctx); // a nested data set inside a list of its parent: that row's children
    if (item.filters?.length) rows = applyFilters(rows, item.filters, ctx);
    const who = item.name || 'Matrix';
    const it = { ...item, name: who };
    let p = buildPivot(it, rows, ctx, lc);
    const { spec, R, V } = p;
    const rhw = item.rowHeaderWidth || 110;
    const hw = spec.rowGroups.map(g => Number(g.width) || rhw);
    const headW = hw.reduce((a, b) => a + b, 0);
    let cw = item.columnWidth || 64;
    const room = (lc.bodyWidth ?? 1e9) - item.x;
    if (spec.overflow === 'shrink' && headW + cw * p.cols.length > room) {
      // fit the page: narrow the value columns, then leave out the columns that still do not fit
      const nTot = p.cols.filter(c => c.kind === 'total').length;
      const nLeaf = (p.cols.length - nTot) / V;
      const fit = (room - headW) / p.cols.length;
      if (fit < 28) lc.warn(`${who}: ${nLeaf} columns do not fit the page; showing the first ${Math.max(1, Math.floor((room - headW) / 28) - nTot)}`, true);
      else lc.warn(`${who}: its columns are wider than the page, so they are narrowed to fit`);
      cw = Math.max(28, fit);
      const keep = Math.max(1, Math.floor((room - headW) / cw) - nTot);
      if (keep < p.cols.length - nTot) p = buildPivot(it, rows, ctx, { ...lc, colLimit: Math.max(1, Math.floor(keep / V)) }); // colLimit counts column instances, each V columns wide
    }
    const fmtOf = (v) => v.format ?? (['percentOfTotal', 'percentOfRow', 'percentOfColumn'].includes(v.show) ? 'P1' : null);
    const vstyles = spec.values.map(v => ({ format: fmtOf(v), textAlign: 'right', ...(v.style || {}) }));
    const vbold = vstyles.map(s => ({ ...s, fontWeight: 'bold' }));
    const right = { textAlign: 'right' };
    const cellStyle = item.cellStyle || { borderBottom: '0.5 solid #e5e7eb' };
    const totalStyle = item.totalStyle || { fontWeight: 'bold', borderTop: '1 solid #94a3b8' };
    const N = R + p.cols.length;
    const columns = [...hw.map(width => ({ width })), ...p.cols.map(c => ({ width: Number(spec.values[c.v].width) || cw }))];
    // a cell's click action and bookmark (pivot.js), evaluated by the table in the cell's own scope (ctx)
    const click = (o, c) => { if (c.action) o.action = c.action; if (c.bookmark) o.bookmark = c.bookmark; if (c.ctx) o.ctx = c.ctx; return o; };
    // a key or label is data: it goes in as a raw value, never as an expression or template
    const hcell = (c) => {
      const o = c.role === 'corner' ? { value: c.text } : { raw: c.text };
      if (c.rowSpan > 1) o.rowSpan = c.rowSpan;
      if (c.colSpan > 1) o.colSpan = c.colSpan;
      if (c.toggle) o.toggle = c.toggle;
      if (c.role !== 'corner') o.style = spec.legacy || c.colSpan === 1 ? right : { textAlign: 'center' };
      return click(o, c);
    };
    const header = p.header.map(hr => {
      const cells = new Array(N).fill(null);
      for (const c of hr) cells[c.c] = hcell(c);
      return { height: 18, style: item.headerStyle, cells };
    });
    const bodyRow = (br) => {
      const cells = new Array(N).fill(null);
      for (const c of br.cells) {
        if (c.role === 'value') {
          cells[c.c] = click({ raw: c.raw, style: c.colTotal && br.kind !== 'total' ? vbold[c.v] : vstyles[c.v] }, c);
          continue;
        }
        const o = { raw: c.text };
        if (c.rowSpan > 1) o.rowSpan = c.rowSpan;
        if (c.colSpan > 1) o.colSpan = c.colSpan;
        if (c.toggle) o.toggle = c.toggle;
        if (c.indent) o.indent = c.indent;
        const gs = spec.rowGroups[c.level]?.style;
        if (gs && c.role !== 'total') o.style = gs;
        cells[c.c] = click(o, c);
      }
      const total = br.kind === 'total';
      return { height: total && br.level === 0 ? 18 : 16, style: total ? totalStyle : cellStyle, cells };
    };
    const body = [], footer = [];
    p.body.forEach((br, i) => {
      // the grand total after the rows is the table footer: it stays with the last rows and is left out of a first-pages render
      if (br.kind === 'total' && br.level === 0 && i === p.body.length - 1) { footer.push(bodyRow(br)); return; }
      const kind = br.kind !== 'total' ? 'detail' : br.level === 0 ? 'footer' : spec.rowGroups[br.level].total === 'before' ? 'groupHeader' : 'groupFooter';
      body.push({ row: bodyRow(br), kind, level: br.kind === 'total' ? br.level : Math.max(0, br.level) });
    });
    const table = {
      type: 'table', name: who, x: item.x, y: item.y, w: 0, h: item.h, dataSet: null, repeatHeader: item.repeatHeader !== false, style: item.style,
      columns, header, footer, __body: rows.length ? body : [], __rows: rows, __ctx: ctx, noRowsText: 'No data',
      // too wide: continues on the next pages (the table warns when the author did not ask for it), "clip" cuts at the edge;
      // "shrink" was done above
      overflow: spec.overflow === 'paginate' ? item.overflow : spec.overflow, repeatColumns: R, pageOrder: spec.pageOrder, columnBlock: V,
    };
    return ITEMS.table.layout(table, lc);
  },
});

/* ---------------------------------------------------------------- subreport */
register('subreport', {
  label: 'Subreport',
  defaults: () => ({ type: 'subreport', w: 360, h: 60, report: '', params: {} }),
  props: [
    { key: 'report', label: 'Report', labelKey: 'subreportTarget', type: 'report', category: 'Data' },
    { key: 'params', label: 'Parameters', type: 'params', category: 'Data' },
    { key: 'keepTogether', label: 'Keep on one page', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const params = {};
    for (const [k, v] of Object.entries(item.params || {})) {
      const r = evalSafe(v, ctx, lc, `${item.name || item.type} parameter ${k}`);
      params[k] = r.v instanceof Date ? isoDate(r.v, ctx.timeZone) : r.v;
    }
    const key = `${item.report}|${JSON.stringify(params)}`;
    const sub = lc.subreports;
    const placeholder = (msg) => {
      const st = resolveStyle([lc.base, { color: '#b91c1c', fontStyle: 'italic', border: '0.5 dashed #b91c1c', padding: 4 }], ctx);
      const tl = layoutTextLines(msg, st, item.w, lc.m);
      return { height: item.h, units: [{ top: 0, height: item.h, items: paintBox({ x: item.x, y: 0, w: item.w, h: item.h, st, tl, m: lc.m }) }] };
    };
    // no report yet: the designer draws its own hint; the output keeps the space and prints nothing
    if (!item.report) { lc.warn(`${item.name || 'Subreport'} has no report: nothing is printed`); return { height: item.h, units: [{ top: 0, height: item.h, items: [] }] }; }
    if (!sub) return placeholder(`Subreport "${item.report}" needs a report loader`);
    if (sub.mode === 'collect') { sub.requests.set(key, { report: item.report, params }); return { height: item.h, units: [{ top: 0, height: item.h, items: [] }] }; }
    const res = sub.results.get(key);
    if (!res) return placeholder(`Subreport "${item.report}" did not load`);
    if (res.error) { lc.warn(`${item.name || item.type}: ${res.error}`); return placeholder(`Subreport "${item.report}": ${res.error}`); }
    const block = item.keepTogether ? `s:${item.name || item.type}:${lc.nextId()}` : undefined;
    const units = res.units.map(u => ({ ...u, items: shiftItems(u.items, item.x, 0), ...(u.cont ? { cont: shiftItems(u.cont, item.x, 0) } : {}), x0: (u.x0 ?? 0) + item.x, x1: (u.x1 ?? item.w) + item.x, block: u.block || block, tableId: undefined }));
    const tables = res.tables.map(t => ({ ...t, x0: t.x0 + item.x, x1: t.x1 + item.x, headerItems: shiftItems(t.headerItems, item.x, 0), id: `sub${lc.nextId()}` }));
    for (const r of res.regions || []) lc.regions?.push(r);
    return { height: res.height, units: units.length ? units : [{ top: 0, height: 0, items: [] }], tables };
  },
});

/* ---------------------------------------------------------------- reuse: parts, placeholders, overflow */
/** A layout context whose expressions read PartProperties.<name> from `props` (a report part's values). */
export function withPartProps(lc, props) {
  return { ...lc, ctxFor: (x) => ({ ...lc.ctxFor(x), partProps: props }) };
}
function notice(item, lc, msg) {
  const st = resolveStyle([lc.base, { color: '#b91c1c', fontStyle: 'italic', border: '0.5 dashed #b91c1c', padding: 4 }], lc.ctxFor(item));
  const tl = layoutTextLines(msg, st, item.w, lc.m);
  return { height: item.h, units: [{ top: 0, height: item.h, items: paintBox({ x: item.x, y: 0, w: item.w, h: item.h, st, tl, m: lc.m }) }] };
}
const emptyBox = (item) => ({ height: item.h, units: [{ top: 0, height: item.h, items: [] }] });

// A linked report part: the library's item, drawn here with this instance's property values (engine/reuse.js loads it).
register('part', {
  label: 'Report part',
  styleProps: [], // no style of its own
  defaults: () => ({ type: 'part', w: 200, h: 60, library: '', part: '', properties: {} }),
  props: [
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const who = item.name || 'Part';
    if (!item.library || !item.part) return notice(item, lc, 'Pick a report part');
    if (item.__cycle) return notice(item, lc, `Part "${item.part}" would include itself`);
    const p = lc.parts?.get(`${item.library}\u0000${item.part}`);
    if (!p) { lc.warn(`${who}: the part "${item.part}" of "${item.library}" needs a report loader`); return notice(item, lc, `Part "${item.part}" of "${item.library}"`); }
    if (p.error) { lc.warn(`${who}: ${p.error}`); return notice(item, lc, `${p.error}`); }
    const it = { ...p.item, x: item.x, y: item.y, name: who, partProps: undefined, layer: undefined };
    const props = { ...(p.item.partProps || {}), ...p.props, ...(item.properties && typeof item.properties === 'object' ? item.properties : {}) };
    const spec = ITEMS[it.type];
    if (!spec) return notice(item, lc, `Unknown item type "${it.type}"`);
    const res = spec.layout(it, withPartProps(lc, props));
    if (item.pageBreakBefore && res.units[0]) res.units[0] = { ...res.units[0], breakBefore: true };
    return res;
  },
});

// Where a content report's body goes in a master report. Rendering the master alone leaves the room empty.
register('placeholder', {
  label: 'Content placeholder',
  styleProps: [], // no style of its own
  defaults: () => ({ type: 'placeholder', w: 400, h: 160 }),
  props: [],
  layout: (item) => emptyBox(item),
});

/** Rows of a stacked list of units that fit `room` (at least one, so a row taller than the frame still moves on). */
function fitRows(units, room) {
  let h = 0, n = 0;
  for (const u of units) { if (n && h + u.height > room + 0.01) break; h += u.height; n++; }
  return n;
}
/** Units stacked from the top as one unit's items, moved right by dx. */
function stack(units, dx) {
  const items = [];
  let y = 0;
  for (const u of units) { for (const i of shiftItems(u.items, dx, y)) items.push(i); y += u.height; }
  return items;
}

// A fixed-page form: rows that do not fit a table's frame continue here (table.overflowTo), header repeated.
register('overflow', {
  label: 'Overflow placeholder',
  styleProps: [], // no style of its own
  defaults: () => ({ type: 'overflow', w: 360, h: 200 }),
  props: [
    { key: 'overflowTo', label: 'Then continue in', labelKey: 'overflowThen', type: 'overflowTarget', category: 'Data' },
  ],
  layout(item, lc) {
    const o = lc.overflow;
    const p = o?.pending.get(item.name);
    if (!p) return emptyBox(item);
    o.pending.delete(item.name);
    o.head ||= item.name; // the first placeholder filled on this page: a repeated page starts there again
    const hh = p.head.reduce((a, u) => a + u.height, 0);
    const n = fitRows(p.units, item.h - hh);
    const items = stack([...p.head, ...p.units.slice(0, n)], item.x - p.x);
    if (n < p.units.length) {
      const rest = { ...p, units: p.units.slice(n) };
      if (item.overflowTo) o.pending.set(item.overflowTo, { ...rest, to: item.overflowTo });
      else { o.pending.set(o.head, rest); o.more = item.name; }
    }
    return { height: item.h, units: [{ top: 0, height: item.h, items }] };
  },
});

/* ---------------------------------------------------------------- table of contents */
/** The entries a table of contents shows from the report's list (bookmarks or headings, to its levels), each with its index in the list. @param {any} item @param {any[]} [toc] */
export function tocEntries(item, toc) {
  const fromHeadings = item.source === 'headings';
  return (toc || []).map((e, i) => ({ ...e, i })).filter(e => !!e.heading === fromHeadings && (e.level || 0) < (item.levels || 3));
}
register('toc', {
  label: 'Table of contents',
  defaults: () => ({ type: 'toc', w: 400, h: 40, title: 'Contents', levels: 3, style: {} }),
  props: [
    { key: 'title', label: 'Title', type: 'text', category: 'Data' },
    { key: 'levels', label: 'Levels to show', type: 'number', category: 'Data' },
    { key: 'source', label: 'Entries from', type: 'select', options: ['bookmarks', 'headings'], category: 'Data' },
    { key: 'numbering', label: 'Numbering (decimal, roman, alpha; one per level: roman,alpha)', type: 'text', category: 'Data' },
    { key: 'styleName', label: 'Named style', type: 'stylename', category: 'Text' },
    { key: 'pageBreakAfter', label: 'Page break after', type: 'bool', category: 'Layout' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    const st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
    const units = [];
    let y = 0;
    if (item.title) {
      const tst = { ...st, fontWeight: 'bold', fontSize: (Number(st.fontSize) || 9) * 1.5, padding: [0, 0, 6, 0] };
      const tl = layoutTextLines(String(item.title), tst, item.w, lc.m);
      const ti = paintBox({ x: item.x, y: 0, w: item.w, h: tl.needed, st: tst, tl, m: lc.m });
      for (const x of ti) if (x.t === 'text') x.tocTitle = true; // the tagged PDF's heading for the contents
      units.push({ top: 0, height: tl.needed, items: ti, keepWithNext: true });
      y += tl.needed;
    }
    // each entry keeps its index in lc.toc: the render fills in the page numbers once the pages are known (engine/index.js)
    const entries = tocEntries(item, lc.toc);
    const kinds = (Array.isArray(item.numbering) ? item.numbering : String(item.numbering || '').split(',')).map(k => String(k).trim()).filter(k => ['decimal', 'roman', 'alpha'].includes(k));
    const nums = kinds.length ? tocNumbers(entries, kinds) : null;
    // no entries (yet): the title only; the render warns once the entries are known (engine/index.js)
    if (!entries.length) return { height: Math.max(item.h, y), units: units.length ? units : [{ top: 0, height: item.h, items: [] }] };
    const key = resolveFontKey(st.fontFamily, st.fontWeight, st.fontStyle);
    const size = Number(st.fontSize) || 9;
    const lh = size * 1.6;
    const { ascent } = lc.m.metrics(key, size);
    for (const [ei, e] of entries.entries()) {
      const indent = (e.level || 0) * 12;
      const num = String(e.page);
      const nw = lc.m.width(num, key, size);
      // room for a 4-digit page number whatever this pass shows, so the final numbers never re-wrap a label
      const label = lc.m.ellipsize(nums ? `${nums[ei]} ${e.label}` : e.label, key, size, item.w - indent - Math.max(nw, lc.m.width('0000', key, size)) - 24);
      const lw = lc.m.width(label, key, size);
      const base = (lh - size) / 2 + ascent * 0.9;
      const items = [
        { t: 'text', font: key, size, color: st.color || '#111', lines: [{ x: item.x + indent, y: base, text: label, w: lw }], tocEntry: e.i },
        { t: 'line', x1: item.x + indent + lw + 4, y1: base, x2: item.x + item.w - nw - 4, y2: base, stroke: '#9ca3af', strokeWidth: 0.6, dash: [0.6, 2.4], tocDots: e.i },
        { t: 'text', font: key, size, color: st.color || '#111', lines: [{ x: item.x + item.w - nw, y: base, text: num, w: nw }], tocPage: e.i, tocEntry: e.i },
        { t: 'link', x: item.x, y: 0, w: item.w, h: lh, action: e.heading && typeof e.page === 'number' ? { type: 'bookmark', target: e.label, page: e.page, y: e.y } : { type: 'bookmark', target: e.label }, tocLink: e.i, tocEntry: e.i },
      ];
      units.push({ top: y, height: lh, items });
      y += lh;
    }
    return { height: Math.max(item.h, y), units };
  },
});

/* ------------------------------------------------------- style metadata */
export const TEXT_STYLE_PROPS = [
  { key: 'fontFamily', label: 'Font', type: 'font', category: 'Text' },
  { key: 'fontSize', label: 'Size', type: 'number', category: 'Text', expr: true },
  { key: 'fontWeight', label: 'Weight', type: 'select', options: ['normal', '600', 'bold'], category: 'Text', expr: true },
  { key: 'fontStyle', label: 'Style', type: 'select', options: ['normal', 'italic'], category: 'Text', expr: true },
  { key: 'color', label: 'Color', type: 'color', category: 'Text' },
  { key: 'textAlign', label: 'Align', type: 'select', options: ['auto', 'left', 'center', 'right', 'justify'], category: 'Text' },
  { key: 'verticalAlign', label: 'Vertical align', type: 'select', options: ['top', 'middle', 'bottom'], category: 'Text' },
  { key: 'format', label: 'Format (C2, N0, dd MMM yyyy)', type: 'text', category: 'Text' },
  { key: 'nullText', label: 'Text for a null value', type: 'text', category: 'Text' },
  { key: 'lineHeight', label: 'Line height', type: 'number', category: 'Text' },
  { key: 'textDecoration', label: 'Decoration', type: 'select', options: ['none', 'underline', 'line-through', 'underline line-through'], category: 'Text' },
  { key: 'textDecorationColor', label: 'Decoration colour', type: 'color', category: 'Text' },
  { key: 'writingMode', label: 'Writing mode (tb-rl = vertical)', type: 'select', options: ['lr-tb', 'tb-rl'], category: 'Text' },
  { key: 'backgroundColor', label: 'Background', type: 'color', category: 'Box' },
  { key: 'backgroundImage', label: 'Background image (URL or =expression)', type: 'text', category: 'Box' },
  { key: 'backgroundFit', label: 'Background fit', type: 'select', options: ['cover', 'contain', 'fill'], category: 'Box' },
  { key: 'padding', label: 'Padding (t r b l)', type: 'text', category: 'Box' },
  { key: 'border', label: 'Border (1 solid #ccc)', type: 'text', category: 'Box' },
  { key: 'radius', label: 'Corner radius', labelKey: 'cornerRadius', type: 'number', category: 'Box' },
  { key: 'borderTop', label: 'Border top', type: 'text', category: 'Box' },
  { key: 'borderBottom', label: 'Border bottom', type: 'text', category: 'Box' },
];
export const SHAPE_STYLE_PROPS = {
  fill: { key: 'fill', label: 'Fill', type: 'color', category: 'Shape' },
  stroke: { key: 'stroke', label: 'Stroke', type: 'color', category: 'Shape' },
  strokeWidth: { key: 'strokeWidth', label: 'Stroke width', type: 'number', category: 'Shape' },
  strokeDash: { key: 'strokeDash', label: 'Dash', type: 'select', options: ['solid', 'dashed', 'dotted'], category: 'Shape' },
  radius: { key: 'radius', label: 'Corner radius', type: 'number', category: 'Shape' },
};
/** Style props the inspector shows for an item type. */
export function stylePropsFor(type) {
  const spec = ITEMS[type];
  if (spec?.styleProps) return spec.styleProps.map(k => SHAPE_STYLE_PROPS[k]);
  if (type === 'image') return TEXT_STYLE_PROPS.filter(p => p.category === 'Box');
  return TEXT_STYLE_PROPS;
}

export { isDynamic };
