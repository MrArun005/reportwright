// @ts-check
import { evalValue, toText, isDynamic, truthy } from '../expr/evaluate.js';
import { isoDate, roundHalfAway } from '../expr/format.js';
import { resolveStyle, padding } from '../style.js';
import { layoutTextLines, paintBox } from './paint.js';
import { applyFilters, applySort } from '../data/index.js';
import { paintChart, CHART_TYPES } from './chart.js';
import { paintVisual } from './visuals.js';
import { paintBarcode, SYMBOLOGIES, BARCODE_OPTIONS, bwipOptions, isTwoD } from './barcode.js';
import { paintMap } from './map.js';
import { shiftItems } from './paint.js';
import { richValue, layoutRich, paintRich, paintVertical } from './rich.js';
import { parseRich } from '../text/rich.js';
import { resolveFontKey } from '../text/fonts.js';
import { tocNumbers } from './toc.js';
import { resolveImageSrc, imageInfo, PX } from '../image.js';

/**
 * Item registry. Each item type has:
 *   label, defaults(), props (designer metadata, plain data),
 *   layout(item, lc) → { height, units[], table? }
 * Unit coordinates: x in content space, y relative to the item top.
 */

/** @type {Record<string, any>} */
export const ITEMS = {};
export const GROW_TOLERANCE = 1;
export function register(type, spec) { ITEMS[type] = { type, ...spec }; }

/* ---------------------------------------------------------------- helpers */
function evalSafe(v, ctx, lc, who) {
  try { return { v: evalValue(v, ctx) }; } catch (e) {
    lc.warn(`${who}: ${e.message}`);
    return { v: '#Error', err: true };
  }
}
function textOf(raw, st, ctx) {
  if (typeof raw === 'string') return raw;
  return toText(raw, st.format, ctx);
}
function hidden(item, ctx, lc) {
  if (item.hidden == null || item.hidden === false || item.hidden === '') return false;
  if (item.hidden === true) return true;
  const r = evalSafe(item.hidden, ctx, lc, item.name || item.type);
  return !r.err && truthy(r.v);
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
  const text = textOf(r.v, st, ctx);
  const rot = rotationOf(item);
  // a box turned on its side lays its text out along its height
  const layoutW = rot?.swap ? item.h : item.w, layoutH = rot?.swap ? item.w : item.h;
  let tl = layoutTextLines(text, st, layoutW, lc.m);
  // shrink to fit: the largest size, in 0.5pt steps down to 4pt, at which the text fits the designed height.
  // A binary search, so a long text costs about 5 layouts, not 16.
  if (item.shrinkToFit && tl.needed > layoutH + GROW_TOLERANCE) {
    const size0 = Number(st.fontSize) || 9;
    const min = Math.max(1, Number(item.minFontSize) || SHRINK_DEFAULTS.minFontSize);
    // a definition can come from anyone with an API key: never more than 4,096 candidate sizes (12 layouts)
    const asked = Number(item.shrinkStep) > 0 ? Number(item.shrinkStep) : SHRINK_DEFAULTS.step;
    const step = Math.max(asked, 0.05, (size0 - min) / 4096);
    const steps = Number.isFinite(size0) ? Math.max(0, Math.floor((size0 - min) / step + 1e-9)) : 0;
    const at = (i) => { const s2 = { ...st, fontSize: Math.max(min, size0 - step * (i + 1)) }; return { s2, t2: layoutTextLines(text, s2, layoutW, lc.m) }; };
    let lo = 0, hi = steps - 1, best = null;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const c = at(mid);
      if (c.t2.needed <= layoutH + GROW_TOLERANCE) { best = c; hi = mid - 1; } else lo = mid + 1;
    }
    if (!best && steps > 0) best = at(steps - 1); // still too long at the minimum: draw at the minimum, the box ellipsises
    if (best) { st = best.s2; tl = best.t2; }
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
    { key: 'headingLevel', label: 'Heading level (1–6, for a table of contents)', type: 'select', options: ['1', '2', '3', '4', '5', '6'], category: 'Interactivity' },
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
  defaults: () => ({ type: 'richtext', w: 240, h: 48, value: '<p>Rich <b>text</b> with <i>styles</i> and {Globals.PageNumber}</p>', canGrow: true, style: {} }),
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
    if (b != null && b !== '' && b !== '#Error') items.push({ t: 'bookmark', label: String(b), x: rect.x, y: rect.y, level: item.bookmarkLevel || 0 });
  }
}

/* ---------------------------------------------------------------- image */
register('image', {
  label: 'Image',
  defaults: () => ({ type: 'image', w: 96, h: 64, src: '', fit: 'contain', style: {} }),
  props: [
    { key: 'src', label: 'Source (URL, data URI, embedded:name, or a field with base64 or bytes)', type: 'expr', category: 'Data' },
    { key: 'fit', label: 'Fit', type: 'select', options: ['contain', 'cover', 'fill', 'clip'], category: 'Layout' },
    { key: 'autoSize', label: 'Size to the image (96 dpi)', type: 'bool', category: 'Layout' },
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

/* ---------------------------------------------------------------- table */
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
    { key: 'noRowsText', label: 'Text when no rows', type: 'text', category: 'Data' },
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'pageBreakAfter', label: 'Page break after', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const tctx = lc.ctxFor(item);
    if (hidden(item, tctx, lc)) return { height: 0, units: [] };
    let rows = (item.dataSet && lc.dataSets[item.dataSet]) || [];
    if (item.dataSet && !lc.dataSets[item.dataSet]) lc.warn(`${item.name || 'Table'}: the data set "${item.dataSet}" does not exist`);
    if (item.filters?.length) rows = applyFilters(rows, item.filters, tctx);
    const sort = lc.state?.sort?.[item.name] || item.sort;
    if (sort?.length) rows = applySort(rows, sort, tctx);

    const cols = item.columns || [];
    const colX = [];
    let acc = item.x;
    for (const c of cols) { colX.push(acc); acc += c.width; }
    const width = acc - item.x;

    const region = { name: item.name, columns: cols.map(c => c.width), rows: [] };
    // run: rows shown so far, in display order (groups reorder rows), for RunningValue over a scope
    const tableScope = { rows, index: -1, run: [] };
    const scopes = { ...(tctx.scopes || {}), [item.name]: tableScope };
    const base = { ...tctx, aggRows: rows, aggIndex: undefined, fields: rows[0] || null, scopes };
    const units = [];
    let y = 0;
    let repeatH = 0; // header height that repeats above continued rows
    let rowSeq = 0;
    const colWidths = cols.map(c => c.width); // one array shared by every cell tag

    const layRow = (row, ctx, kind, extra) => {
      const rst = resolveStyle([lc.base, lc.named?.[item.styleName], item.style, lc.named?.[row.styleName], row.style], ctx);
      const cells = [];
      let need = row.height || 18;
      for (let ci = 0; ci < cols.length; ci++) {
        const cell = row.cells?.[ci];
        if (!cell) continue;
        const span = Math.max(1, Math.min(cell.colSpan || 1, cols.length - ci));
        let cw = 0;
        for (let k = 0; k < span; k++) cw += cols[ci + k].width;
        const st = resolveStyle([rst, lc.named?.[cell.styleName], cell.style], ctx);
        const r = evalSafe(cell.value ?? '', ctx, lc, `${item.name || 'Table'} cell`);
        let text = textOf(r.v, st, ctx);
        const plain = text;
        if (extra?.toggle && ci === 0) text = `${extra.toggle.open ? '▼' : '▶'} ${text}`;
        if (cell.sortBy && kind === 'header') {
          const cur = (lc.state?.sort?.[item.name] || [])[0];
          if (cur && cur.by === cell.sortBy) text += cur.dir === 'desc' ? ' ↓' : ' ↑';
        }
        const tl = layoutTextLines(text, st, cw, lc.m);
        if (row.canGrow !== false && tl.needed > need + GROW_TOLERANCE) need = tl.needed;
        cells.push({ x: colX[ci], w: cw, st, tl, numeric: typeof r.v === 'number', cell, ctx, raw: r.v, span, plain });
      }
      region.rows.push({ kind, level: extra?.level ?? 0, cells: cells.map(c => ({ col: Math.round((c.x - item.x) * 100), value: c.raw instanceof Date || typeof c.raw === 'boolean' ? c.raw : typeof c.raw === 'number' ? roundFor(c.raw, c.st.format) : c.plain, format: c.st.format || null, bold: c.st.fontWeight === 'bold' || Number(c.st.fontWeight) >= 600, span: c.span, colIndex: colX.indexOf(c.x) })) });
      // h: height of this piece; lines: per-cell lines when the row is split; first: links, visuals and toggles go on the first piece
      const paint = (h, lines, first, rowId) => {
        const items = [];
        cells.forEach((c, k) => {
          if (c.cell.visual?.type) {
            items.push(...paintBox({ x: c.x, y: 0, w: c.w, h, st: c.st, tl: null, m: lc.m }));
            if (first) items.push(...paintVisual(c.cell.visual, { x: c.x, y: 0, w: c.w, h }, c.ctx, lc, c.st, `${item.name} cell`));
            return;
          }
          const box = paintBox({ x: c.x, y: 0, w: c.w, h, st: c.st, tl: lines ? { ...c.tl, lines: lines[k] } : c.tl, numeric: c.numeric, m: lc.m });
          // cell text knows its table, row and column, so the Word export can rebuild the table
          for (const b of box) if (b.t === 'text') b.cell = { table: item.name, row: rowId, col: colX.indexOf(c.x), span: c.span, kind, cols: colWidths, bg: c.st.backgroundColor || null };
          items.push(...box);
          if (!first) return;
          const link = lc.linkFor?.(c.cell, c.ctx, { x: c.x, y: 0, w: c.w, h });
          if (link) items.push(link);
          if (cell_bookmark(c.cell)) { const b = evalSafe(c.cell.bookmark, c.ctx, lc, 'bookmark').v; if (b) items.push({ t: 'bookmark', label: String(b), x: c.x, y: 0, level: c.cell.bookmarkLevel || 0 }); }
          if (c.cell.sortBy && kind === 'header') {
            const cur = (lc.state?.sort?.[item.name] || [])[0];
            const dir = cur && cur.by === c.cell.sortBy && cur.dir === 'asc' ? 'desc' : 'asc';
            items.push({ t: 'link', x: c.x, y: 0, w: c.w, h, action: { type: 'sort', table: item.name, by: c.cell.sortBy, dir } });
          }
        });
        if (first && extra?.toggle) {
          // the whole first cell toggles, unless that cell has its own action (a drill-through): then only the ▶ does
          const c0 = cells[0];
          const w = c0?.cell.action ? Math.min(c0.w, padding(c0.st)[3] + (Number(c0.st.fontSize) || 9) * 1.4) : cols[0]?.width || 20;
          items.push({ t: 'link', x: colX[0], y: 0, w, h, action: { type: 'toggle', key: extra.toggle.key, open: extra.toggle.open } });
        }
        return items;
      };
      // Taller than a page (less a repeated header): split into pieces of whole lines, like a text box, so it continues on the next pages.
      const room = (lc.maxUnitHeight ?? Infinity) - repeatH;
      const pieces = [];
      if (!lc.fixed && need > room && cells.some(c => c.tl.lines.length > 1)) {
        const per = cells.map(c => Math.max(1, Math.floor((room - c.tl.pad[0] - c.tl.pad[2]) / c.tl.lh)));
        const n = Math.max(...cells.map((c, k) => Math.ceil(c.tl.lines.length / per[k])));
        for (let i = 0; i < n; i++) {
          const lines = cells.map((c, k) => c.tl.lines.slice(i * per[k], (i + 1) * per[k]));
          pieces.push({ lines, h: Math.max(...cells.map((c, k) => lines[k].length * c.tl.lh + c.tl.pad[0] + c.tl.pad[2])) });
        }
      } else pieces.push({ lines: null, h: need });
      let u;
      pieces.forEach((pc, i) => {
        u = { top: y, height: pc.h, items: paint(pc.h, pc.lines, i === 0, ++rowSeq), kind };
        y += pc.h;
        units.push(u);
      });
      return u;
    };

    // table header
    const headerUnits = (item.header || []).map(r => layRow(r, base, 'header'));
    const headerHeight = headerUnits.reduce((s, u) => s + u.height, 0);
    if (item.repeatHeader !== false) repeatH = headerHeight;
    const headerItems = [];
    for (const u of headerUnits) for (const it of shiftLocal(u.items.filter(i => i.t !== 'link' && i.t !== 'bookmark'), u.top)) headerItems.push(it);
    if (headerUnits.length) headerUnits[headerUnits.length - 1].keepWithNext = true;

    if (rows.length === 0 && item.noRowsText) {
      const st = resolveStyle([lc.base, item.style, { fontStyle: 'italic', color: '#868e96' }], base);
      const tl = layoutTextLines(String(item.noRowsText), st, width, lc.m);
      units.push({ top: y, height: tl.needed, items: paintBox({ x: item.x, y: 0, w: width, h: tl.needed, st, tl, m: lc.m }), kind: 'detail' });
      y += tl.needed;
    }

    // groups (outer → inner), then detail rows
    const groups = item.groups || [];
    let rowNo = 0;
    const emit = (level, grows, ctx, chain, keyPath) => {
      if (level === groups.length) {
        for (let i = 0; i < grows.length; i++) {
          if (lc.rowBudget && lc.rowBudget.left-- <= 0) { lc.rowBudget.cut = true; return; } // first pages only
          rowNo++;
          for (const s of chain) { s.index++; s.run.push(grows[i]); }
          const dctx = { ...ctx, fields: grows[i], aggRows: grows, aggIndex: i, rowNumber: rowNo };
          for (const r of item.detail || []) layRow(r, dctx, 'detail', { level: groups.length });
        }
        return;
      }
      const g = groups[level];
      const buckets = groupRows(grows, g.expr, ctx, lc, item.name);
      if (!g.sortBy && (g.sort === 'asc' || g.sort === 'desc')) {
        buckets.sort((a, b) => cmpKey(a.key, b.key) * (g.sort === 'desc' ? -1 : 1));
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
            return cmpKey(x, y) * (us[k].dir === 'desc' ? -1 : 1);
          }
          return 0;
        });
      }
      buckets.forEach((bk, bi) => {
        if (lc.rowBudget?.cut) return;
        const sc = { rows: bk.rows, index: -1, run: [] };
        const gname = g.name || `Group${level + 1}`;
        const gctx = { ...ctx, fields: bk.rows[0], aggRows: bk.rows, aggIndex: undefined, scopes: { ...ctx.scopes, [gname]: sc }, groupKey: bk.key };
        const path = `${keyPath}/${bk.text}`;
        const tkey = `${item.name}|${level}|${path}`;
        const open = !g.collapsible ? true : (lc.state?.toggles?.[tkey] ?? !g.initiallyCollapsed);
        const start = units.length;
        const hu = (g.header || []).map((r, ri) => layRow(r, gctx, 'groupHeader', { level, ...(ri === 0 && g.collapsible ? { toggle: { key: tkey, open } } : {}) }));
        const before = units.length;
        if (open) emit(level + 1, bk.rows, gctx, [...chain, sc], path);
        else for (const s of [...chain, sc]) { s.index += bk.rows.length; for (const r of bk.rows) s.run.push(r); }
        // keep a group header with the group's content, never with the next group
        if (hu.length && units.length > before) hu[hu.length - 1].keepWithNext = true;
        const fu = (g.footer || []).map(r => layRow(r, gctx, 'groupFooter', { level }));
        if (fu.length && open) fu[0].keepWithPrevious = true;
        if (units.length > start) {
          if (g.pageBreak === 'between' && bi > 0) units[start].breakBefore = true;
          if (g.pageBreak === 'after' && bi < buckets.length - 1) units[units.length - 1].breakAfter = true;
          if (g.keepTogether) { const id = `${item.name}:g${level}:${path}:${lc.nextId()}`; for (let k = start; k < units.length; k++) units[k].block ||= id; }
        }
      });
    };
    emit(0, rows, base, [tableScope], '');

    // a total of the first rows only would be wrong: no footer in a partial (first pages) render
    const footerUnits = lc.rowBudget?.cut ? [] : (item.footer || []).map(r => layRow(r, base, 'footer'));
    if (footerUnits.length) footerUnits[0].keepWithPrevious = true;

    if (!lc.fixed) lc.regions?.push(region);
    return {
      height: y, units, width,
      table: item.repeatHeader !== false && headerHeight ? { headerHeight, headerItems, x: item.x } : null,
    };
  },
});

const cell_bookmark = (c) => c && c.bookmark;

/** Round a number for data export to the precision its format shows (percent keeps 2 more places). */
function roundFor(v, fmt) {
  const m = /^([CcNnFfPp])(\d{0,2})$/.exec(fmt || '');
  if (!m) return Number.isInteger(v) ? v : roundHalfAway(v, 6);
  const d = (m[2] === '' ? 2 : Number(m[2])) + (m[1].toUpperCase() === 'P' ? 2 : 0);
  return roundHalfAway(v, d); // same rule as the Intl formatter that drew the cell
}

function groupRows(rows, expr, ctx, lc, who) {
  const map = new Map();
  const c = { ...ctx };
  for (const r of rows) {
    c.fields = r;
    let key;
    try { key = evalValue(expr, c); } catch (e) { lc.warn(`${who} group: ${e.message}`); key = '#Error'; }
    const text = key instanceof Date ? String(key.getTime()) : String(key);
    let b = map.get(text);
    if (!b) { b = { key, text, rows: [] }; map.set(text, b); }
    b.rows.push(r);
  }
  return [...map.values()];
}
function cmpKey(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------------------------------------------------------------- container */
register('container', {
  label: 'Container',
  defaults: () => ({ type: 'container', w: 240, h: 72, items: [], keepTogether: true, style: { border: '0.75 solid #d0d7de', padding: 0 } }),
  props: [
    { key: 'keepTogether', label: 'Keep together on one page', type: 'bool', category: 'Layout' },
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'pageBreakAfter', label: 'Page break after', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const res = lc.layoutItems(item.items, lc, { dx: item.x });
    return frame(item, lc, ctx, res, item.keepTogether !== false ? `c:${item.name}:${lc.nextId()}` : null);
  },
});

/** Wrap child units of a container or list row: background, border, keep-together block. */
function frame(item, lc, ctx, res, blockId) {
  const h = Math.max(item.h, res.height);
  const st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
  const deco = paintBox({ x: item.x, y: 0, w: item.w, h, st, tl: null, m: lc.m });
  const units = res.units.map(u => ({ ...u, block: u.block || blockId }));
  if (deco.length) {
    if (blockId || !units.length) units.unshift({ top: 0, height: h, items: deco, block: blockId, x0: item.x, x1: item.x + item.w, deco: true });
    else lc.warn(`${item.name}: background and border need "Keep together"`);
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
    { key: 'keepTogether', label: 'Keep each row on one page', type: 'bool', category: 'Layout' },
    { key: 'pageBreakBetween', label: 'Page break between rows', type: 'bool', category: 'Layout' },
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    let rows = (item.dataSet && lc.dataSets[item.dataSet]) || [];
    if (item.dataSet && !lc.dataSets[item.dataSet]) lc.warn(`${item.name}: the data set "${item.dataSet}" does not exist`);
    if (item.filters?.length) rows = applyFilters(rows, item.filters, ctx);
    if (item.sort?.length) rows = applySort(rows, item.sort, ctx);
    const reps = item.groupBy ? groupRows(rows, item.groupBy, ctx, lc, item.name).map(b => b.rows) : rows.map(r => [r]);
    const units = [], tables = [];
    let y = 0;
    const listScope = { rows, index: -1, run: [] };
    reps.forEach((rs, i) => {
      if (lc.rowBudget && lc.rowBudget.left-- <= 0) { lc.rowBudget.cut = true; return; }
      listScope.index = i;
      for (const r of rs) listScope.run.push(r);
      const rctx = { ...ctx, fields: rs[0], aggRows: rs, aggIndex: undefined, rowNumber: i + 1, parentFields: rs[0], scopes: { ...(ctx.scopes || {}), [item.name]: listScope } };
      const child = { ...lc, ctxFor: (it) => (it.dataSet && it.dataSet !== item.dataSet ? { ...lc.ctxFor(it), parentFields: rs[0], scopes: rctx.scopes } : rctx) };
      const res = lc.layoutItems(item.items, child, { dx: item.x });
      const fr = frame({ ...item, name: `${item.name}[${i + 1}]` }, child, rctx, res, item.keepTogether !== false ? `l:${item.name}:${i}:${lc.nextId()}` : null);
      fr.units.forEach((u, k) => units.push({ ...u, top: u.top + y, breakBefore: u.breakBefore || (k === 0 && i > 0 && !!item.pageBreakBetween) }));
      for (const t of fr.tables || []) tables.push({ ...t, top: t.top + y, bottom: t.bottom + y });
      y += fr.height;
    });
    if (!reps.length) units.push({ top: 0, height: 0, items: [] });
    return { height: y, units, tables, width: item.w };
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
    const label = item.text != null ? textOf(evalSafe(item.text, ctx, lc, item.name).v, st, ctx) : '';
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
    { key: 'category', label: 'Category (x axis / slices)', type: 'expr', category: 'Chart' },
    { key: 'categorySort', label: 'Sort categories', type: 'select', options: ['asc', 'desc'], category: 'Chart' },
    { key: 'categoryFormat', label: 'Category format', type: 'text', category: 'Chart' },
    { key: 'series', label: 'Series', type: 'series', category: 'Chart' },
    { key: 'seriesGroup', label: 'One series per value of', type: 'expr', category: 'Chart' },
    { key: 'stacked', label: 'Stacked', type: 'bool', category: 'Chart' },
    { key: 'showValues', label: 'Show values', type: 'bool', category: 'Chart' },
    { key: 'valueFormat', label: 'Value format', type: 'text', category: 'Chart' },
    { key: 'legend', label: 'Legend', type: 'select', options: ['bottom', 'none'], category: 'Chart' },
    { key: 'xValue', label: 'X value (scatter)', type: 'expr', category: 'Chart' },
    { key: 'pointAction', label: 'Click on a bar or slice', type: 'action', category: 'Interactivity' },
    { key: 'pointColor', label: 'Bar or slice colour (expression, e.g. highlight the selected one)', type: 'expr', category: 'Interactivity' },
    { key: 'tooltips', label: 'Tooltips on hover', type: 'bool', category: 'Interactivity' },
    { key: 'xTitle', label: 'X axis title', type: 'text', category: 'Chart' },
    { key: 'fontSize', label: 'Text size', type: 'number', category: 'Chart' },
    { key: 'background', label: 'Background', type: 'color', category: 'Chart' },
    { key: 'keepTogether', label: 'Keep on one page', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  styleProps: [],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const items = paintChart(item, ctx, lc, lc.base);
    addInteractivity(items, item, ctx, lc, { x: item.x, y: 0, w: item.w, h: item.h });
    return { height: item.h, units: [{ top: 0, height: item.h, items }] };
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
    const raw = evalSafe(item.value ?? '', ctx, lc, who).v;
    let options = [];
    if (kind === 'choice') {
      const o = evalSafe(item.options ?? '', ctx, lc, who).v;
      options = (Array.isArray(o) ? o : String(o ?? '').split(',')).map(s => String(s).trim()).filter(Boolean);
    }
    const value = kind === 'checkbox' ? truthy(raw) : raw == null ? '' : textOf(raw, st, ctx);
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
      t: 'field', kind, name, value, options, required: !!item.required, readOnly: !!item.readOnly,
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
    { key: 'pointDataSet', label: 'Points: data set', type: 'dataset', category: 'Points' },
    { key: 'lat', label: 'Points: latitude', type: 'expr', category: 'Points' },
    { key: 'lon', label: 'Points: longitude', type: 'expr', category: 'Points' },
    { key: 'pointSize', label: 'Points: size by', type: 'expr', category: 'Points' },
    { key: 'pointLabel', label: 'Points: label', type: 'expr', category: 'Points' },
    { key: 'pointColor', label: 'Points: colour', type: 'color', category: 'Points' },
    { key: 'keepTogether', label: 'Keep on one page', type: 'bool', category: 'Layout' },
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
]) {
  register(type, {
    label,
    defaults: () => ({ type, w: 120, h: 18, color: '#2563eb', ...defaults }),
    props: [
      { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
      ...(type === 'sparkline' ? [{ key: 'category', label: 'One point per (e.g. =Fields.month)', type: 'expr', category: 'Data' }] : []),
      { key: 'value', label: type === 'sparkline' ? 'Value (aggregate when a category is set)' : 'Value', type: 'expr', category: 'Data' },
      ...(type === 'sparkline' ? [{ key: 'style', label: 'Style', type: 'select', options: ['line', 'column'], category: 'Data' }] : []),
      ...(type !== 'sparkline' ? [{ key: 'max', label: 'Maximum', type: 'expr', category: 'Data' }] : []),
      ...(type === 'bullet' ? [{ key: 'target', label: 'Target', type: 'expr', category: 'Data' }] : []),
      { key: 'color', label: 'Color', type: 'color', category: 'Data' },
      { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
    ],
    styleProps: [],
    layout(item, lc) {
      const ctx = lc.ctxFor(item);
      if (hidden(item, ctx, lc)) return { height: 0, units: [] };
      const items = paintVisual({ ...item, type }, { x: item.x, y: 0, w: item.w, h: item.h }, ctx, lc, lc.base, item.name);
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
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const st = resolveStyle([lc.base, lc.named?.[item.styleName], item.style], ctx);
    const r = evalSafe(item.value ?? '', ctx, lc, item.name || 'Barcode');
    const text = r.err ? '' : textOf(r.v, st, ctx);
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
      lc.warn(`${item.name}: ${bc.error}`);
      const tl = layoutTextLines(`Barcode error: ${bc.error}`, { ...st, color: '#b91c1c' }, item.w, lc.m);
      return { height: item.h, units: [{ top: 0, height: item.h, items: paintBox({ x: item.x, y: 0, w: item.w, h: item.h, st: { ...st, color: '#b91c1c', border: '0.5 dashed #b91c1c' }, tl, m: lc.m }) }] };
    }
    if (show && !bc.twoD && text) {
      const tl = layoutTextLines(text, { ...st, padding: 0 }, bw - 2 * q, lc.m, { wrap: false });
      items.push(...paintBox({ x: bx + q, y: above ? by + q : by + bh - q - th, w: bw - 2 * q, h: th, st: { ...st, padding: 0, verticalAlign: above ? 'top' : 'bottom', textAlign: st.textAlign === 'auto' ? 'center' : st.textAlign }, tl, m: lc.m }));
    }
    if (a) items = items.map(i => ({ ...i, rotate: { a, cx, cy } }));
    return { height: item.h, units: [{ top: 0, height: item.h, items }] };
  },
});

/* ---------------------------------------------------------------- matrix (pivot) */
register('matrix', {
  label: 'Matrix',
  defaults: () => ({ type: 'matrix', w: 360, h: 54, dataSet: null, rowGroup: '', columnGroup: '', value: '=Count(Fields)', valueFormat: 'N0',
    corner: '', rowHeaderWidth: 110, columnWidth: 64, rowTotals: true, columnTotals: true, columnSort: 'asc', rowSort: 'asc',
    headerStyle: { fontWeight: 'bold', backgroundColor: '#f1f5f9', borderBottom: '1 solid #94a3b8' }, style: { padding: [3, 4, 3, 4] } }),
  props: [
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'rowGroup', label: 'Rows: group by', type: 'expr', category: 'Data' },
    { key: 'columnGroup', label: 'Columns: group by', type: 'expr', category: 'Data' },
    { key: 'value', label: 'Value (aggregate)', type: 'expr', category: 'Data' },
    { key: 'valueFormat', label: 'Value format', type: 'text', category: 'Data' },
    { key: 'corner', label: 'Corner text', type: 'text', category: 'Data' },
    { key: 'rowSort', label: 'Sort rows', type: 'select', options: ['asc', 'desc'], category: 'Data' },
    { key: 'columnSort', label: 'Sort columns', type: 'select', options: ['asc', 'desc'], category: 'Data' },
    { key: 'rowTotals', label: 'Total column at the right', type: 'bool', category: 'Layout' },
    { key: 'columnTotals', label: 'Total row at the bottom', type: 'bool', category: 'Layout' },
    { key: 'rowHeaderWidth', label: 'Row header width', type: 'number', category: 'Layout' },
    { key: 'columnWidth', label: 'Column width', type: 'number', category: 'Layout' },
    { key: 'repeatHeader', label: 'Repeat header on each page', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    let rows = (item.dataSet && lc.dataSets[item.dataSet]) || [];
    if (item.filters?.length) rows = applyFilters(rows, item.filters, ctx);
    const who = item.name || 'Matrix';
    const sortB = (bs, dir) => { if (dir === 'asc' || dir === 'desc') bs.sort((a, b) => cmpKey(a.key, b.key) * (dir === 'desc' ? -1 : 1)); return bs; };
    const rowB = sortB(groupRows(rows, item.rowGroup || "=''", ctx, lc, who), item.rowSort);
    const colB = sortB(groupRows(rows, item.columnGroup || "=''", ctx, lc, who), item.columnSort);
    const agg = (rs) => { if (!rs.length) return null; const r = evalSafe(item.value || '=Count(Fields)', { ...ctx, fields: rs[0], aggRows: rs, aggIndex: undefined }, lc, who); return r.err ? null : r.v; };
    // fit the page: shrink value columns if needed
    const room = (lc.bodyWidth ?? 1e9) - item.x;
    let cw = item.columnWidth || 64;
    const nCols = colB.length + (item.rowTotals !== false ? 1 : 0);
    const rhw = item.rowHeaderWidth || 110;
    if (rhw + cw * nCols > room) {
      const fit = (room - rhw) / nCols;
      if (fit < 28) lc.warn(`${who}: ${colB.length} columns do not fit the page; showing the first ${Math.max(1, Math.floor((room - rhw) / 28) - 1)}`);
      cw = Math.max(28, fit);
    }
    const maxCols = Math.max(1, Math.floor((room - rhw) / cw) - (item.rowTotals !== false ? 1 : 0));
    const cols = colB.slice(0, maxCols);
    const fmt = { format: item.valueFormat || null };
    const vstyle = { ...fmt, textAlign: 'right' };
    const label = (k) => textOf(k, {}, ctx);
    // a data key becomes cell text, never a template or an expression ("=1+1", "{x}")
    const lit = (s) => `="${s.replace(/[\\"]/g, '\\$&')}"`;
    const synthRows = rowB.map(rb => {
      const o = { __label: label(rb.key) };
      const set = new Set(rb.rows);
      cols.forEach((cb, i) => { o[`c${i}`] = agg(cb.rows.filter(r => set.has(r))); });
      o.__total = agg(rb.rows);
      return o;
    });
    const table = {
      type: 'table', name: who, x: item.x, y: item.y, w: 0, h: item.h, dataSet: '__matrix', repeatHeader: item.repeatHeader !== false, style: item.style,
      columns: [{ width: rhw }, ...cols.map(() => ({ width: cw })), ...(item.rowTotals !== false ? [{ width: cw }] : [])],
      header: [{ height: 18, style: item.headerStyle, cells: [{ value: item.corner || '' }, ...cols.map(cb => ({ value: lit(label(cb.key)), style: { textAlign: 'right' } })), ...(item.rowTotals !== false ? [{ value: 'Total', style: { textAlign: 'right' } }] : [])] }],
      detail: [{ height: 16, style: item.cellStyle || { borderBottom: '0.5 solid #e5e7eb' }, cells: [{ value: '=Fields.__label' }, ...cols.map((_, i) => ({ value: `=Fields.c${i}`, style: vstyle })), ...(item.rowTotals !== false ? [{ value: '=Fields.__total', style: { ...vstyle, fontWeight: 'bold' } }] : [])] }],
      footer: item.columnTotals !== false ? [{ height: 18, style: item.totalStyle || { fontWeight: 'bold', borderTop: '1 solid #94a3b8' }, cells: [{ value: 'Total' },
        ...cols.map(cb => ({ value: agg(cb.rows), style: vstyle })), ...(item.rowTotals !== false ? [{ value: agg(rows), style: vstyle }] : [])] }] : [],
      noRowsText: 'No data',
    };
    return ITEMS.table.layout(table, { ...lc, dataSets: { ...lc.dataSets, __matrix: synthRows } });
  },
});

/* ---------------------------------------------------------------- subreport */
register('subreport', {
  label: 'Subreport',
  defaults: () => ({ type: 'subreport', w: 360, h: 60, report: '', params: {} }),
  props: [
    { key: 'report', label: 'Report id', type: 'text', category: 'Data' },
    { key: 'params', label: 'Parameters', type: 'params', category: 'Data' },
    { key: 'keepTogether', label: 'Keep on one page', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const params = {};
    for (const [k, v] of Object.entries(item.params || {})) {
      const r = evalSafe(v, ctx, lc, `${item.name} parameter ${k}`);
      params[k] = r.v instanceof Date ? isoDate(r.v) : r.v;
    }
    const key = `${item.report}|${JSON.stringify(params)}`;
    const sub = lc.subreports;
    const placeholder = (msg) => {
      const st = resolveStyle([lc.base, { color: '#b91c1c', fontStyle: 'italic', border: '0.5 dashed #b91c1c', padding: 4 }], ctx);
      const tl = layoutTextLines(msg, st, item.w, lc.m);
      return { height: item.h, units: [{ top: 0, height: item.h, items: paintBox({ x: item.x, y: 0, w: item.w, h: item.h, st, tl, m: lc.m }) }] };
    };
    if (!item.report) return placeholder('Pick a report for this subreport');
    if (!sub) return placeholder(`Subreport "${item.report}" needs a report loader`);
    if (sub.mode === 'collect') { sub.requests.set(key, { report: item.report, params }); return { height: item.h, units: [{ top: 0, height: item.h, items: [] }] }; }
    const res = sub.results.get(key);
    if (!res) return placeholder(`Subreport "${item.report}" did not load`);
    if (res.error) { lc.warn(`${item.name}: ${res.error}`); return placeholder(`Subreport "${item.report}": ${res.error}`); }
    const block = item.keepTogether ? `s:${item.name}:${lc.nextId()}` : undefined;
    const units = res.units.map(u => ({ ...u, items: shiftItems(u.items, item.x, 0), x0: (u.x0 ?? 0) + item.x, x1: (u.x1 ?? item.w) + item.x, block: u.block || block, tableId: undefined }));
    const tables = res.tables.map(t => ({ ...t, x0: t.x0 + item.x, x1: t.x1 + item.x, headerItems: shiftItems(t.headerItems, item.x, 0), id: `sub${lc.nextId()}` }));
    for (const r of res.regions || []) lc.regions?.push(r);
    return { height: res.height, units: units.length ? units : [{ top: 0, height: 0, items: [] }], tables };
  },
});

/* ---------------------------------------------------------------- table of contents */
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
      units.push({ top: 0, height: tl.needed, items: paintBox({ x: item.x, y: 0, w: item.w, h: tl.needed, st: tst, tl, m: lc.m }), keepWithNext: true });
      y += tl.needed;
    }
    const fromHeadings = item.source === 'headings';
    const entries = (lc.toc || []).filter(e => !!e.heading === fromHeadings && (e.level || 0) < (item.levels || 3));
    const kinds = (Array.isArray(item.numbering) ? item.numbering : String(item.numbering || '').split(',')).map(k => String(k).trim()).filter(k => ['decimal', 'roman', 'alpha'].includes(k));
    const nums = kinds.length ? tocNumbers(entries, kinds) : null;
    if (!entries.length) {
      const tl = layoutTextLines('Entries appear here: add bookmarks to items or cells.', { ...st, fontStyle: 'italic', color: '#9ca3af' }, item.w, lc.m);
      units.push({ top: y, height: tl.needed, items: paintBox({ x: item.x, y: 0, w: item.w, h: tl.needed, st: { ...st, fontStyle: 'italic', color: '#9ca3af' }, tl, m: lc.m }) });
      return { height: Math.max(item.h, y + tl.needed), units };
    }
    const key = resolveFontKey(st.fontFamily, st.fontWeight, st.fontStyle);
    const size = Number(st.fontSize) || 9;
    const lh = size * 1.6;
    const { ascent } = lc.m.metrics(key, size);
    for (const [ei, e] of entries.entries()) {
      const indent = (e.level || 0) * 12;
      const num = String(e.page);
      const nw = lc.m.width(num, key, size);
      const label = lc.m.ellipsize(nums ? `${nums[ei]} ${e.label}` : e.label, key, size, item.w - indent - nw - 24);
      const lw = lc.m.width(label, key, size);
      const base = (lh - size) / 2 + ascent * 0.9;
      const items = [
        { t: 'text', font: key, size, color: st.color || '#111', lines: [{ x: item.x + indent, y: base, text: label, w: lw }] },
        { t: 'line', x1: item.x + indent + lw + 4, y1: base, x2: item.x + item.w - nw - 4, y2: base, stroke: '#9ca3af', strokeWidth: 0.6, dash: [0.6, 2.4] },
        { t: 'text', font: key, size, color: st.color || '#111', lines: [{ x: item.x + item.w - nw, y: base, text: num, w: nw }] },
        { t: 'link', x: item.x, y: 0, w: item.w, h: lh, action: e.heading ? { type: 'bookmark', target: e.label, page: e.page, y: e.y } : { type: 'bookmark', target: e.label } },
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
  { key: 'fontSize', label: 'Size', type: 'number', category: 'Text' },
  { key: 'fontWeight', label: 'Weight', type: 'select', options: ['normal', '600', 'bold'], category: 'Text' },
  { key: 'fontStyle', label: 'Style', type: 'select', options: ['normal', 'italic'], category: 'Text' },
  { key: 'color', label: 'Color', type: 'color', category: 'Text' },
  { key: 'textAlign', label: 'Align', type: 'select', options: ['auto', 'left', 'center', 'right', 'justify'], category: 'Text' },
  { key: 'verticalAlign', label: 'Vertical align', type: 'select', options: ['top', 'middle', 'bottom'], category: 'Text' },
  { key: 'format', label: 'Format (C2, N0, dd MMM yyyy)', type: 'text', category: 'Text' },
  { key: 'lineHeight', label: 'Line height', type: 'number', category: 'Text' },
  { key: 'textDecoration', label: 'Decoration', type: 'select', options: ['none', 'underline', 'line-through', 'underline line-through'], category: 'Text' },
  { key: 'textDecorationColor', label: 'Decoration colour', type: 'color', category: 'Text' },
  { key: 'writingMode', label: 'Writing mode (tb-rl = vertical)', type: 'select', options: ['lr-tb', 'tb-rl'], category: 'Text' },
  { key: 'backgroundColor', label: 'Background', type: 'color', category: 'Box' },
  { key: 'backgroundImage', label: 'Background image (URL or =expression)', type: 'text', category: 'Box' },
  { key: 'backgroundFit', label: 'Background fit', type: 'select', options: ['cover', 'contain', 'fill'], category: 'Box' },
  { key: 'padding', label: 'Padding (t r b l)', type: 'text', category: 'Box' },
  { key: 'border', label: 'Border (1 solid #ccc)', type: 'text', category: 'Box' },
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
