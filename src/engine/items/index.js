// @ts-check
import { evalValue, toText, isDynamic } from '../expr/evaluate.js';
import { resolveStyle } from '../style.js';
import { layoutTextLines, paintBox } from './paint.js';
import { applyFilters, applySort } from '../data/index.js';

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
  return !r.err && Boolean(r.v) && r.v !== 'false';
}

/* ---------------------------------------------------------------- textbox */
function paintTextbox(item, lc, ctx, forcedH) {
  const st = resolveStyle([lc.base, item.style], ctx);
  const r = evalSafe(item.value ?? '', ctx, lc, item.name || 'TextBox');
  const text = textOf(r.v, st, ctx);
  const tl = layoutTextLines(text, st, item.w, lc.m);
  let h = item.h;
  if (forcedH == null) {
    // Growth under 1pt is ignored: it would only push items below by a hair.
    if (item.canGrow !== false && tl.needed > h + GROW_TOLERANCE) h = tl.needed;
    if (item.canShrink && tl.needed < h) h = tl.needed;
  } else h = forcedH;
  return { st, tl, h, numeric: typeof r.v === 'number' };
}

register('textbox', {
  label: 'Text box',
  defaults: () => ({ type: 'textbox', w: 144, h: 18, value: 'Text', canGrow: true, canShrink: false, style: {} }),
  props: [
    { key: 'value', label: 'Value', type: 'expr', category: 'Data' },
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'canGrow', label: 'Can grow', type: 'bool', category: 'Layout' },
    { key: 'canShrink', label: 'Can shrink', type: 'bool', category: 'Layout' },
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const { st, tl, h, numeric } = paintTextbox(item, lc, ctx, lc.fixed ? item.h : null);
    // Taller than a page: split into chunks of whole lines.
    if (!lc.fixed && h > lc.maxUnitHeight && tl.lines.length > 1) {
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
    return { height: h, units: [{ top: 0, height: h, items: paintBox({ x: item.x, y: 0, w: item.w, h, st, tl, numeric, m: lc.m }) }] };
  },
});

/* ---------------------------------------------------------------- image */
register('image', {
  label: 'Image',
  defaults: () => ({ type: 'image', w: 96, h: 64, src: '', fit: 'contain', style: {} }),
  props: [
    { key: 'src', label: 'Source (URL or data URI)', type: 'expr', category: 'Data' },
    { key: 'fit', label: 'Fit', type: 'select', options: ['contain', 'cover', 'fill'], category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const st = resolveStyle([lc.base, item.style], ctx);
    const src = evalSafe(item.src ?? '', ctx, lc, item.name || 'Image').v;
    const items = paintBox({ x: item.x, y: 0, w: item.w, h: item.h, st, tl: null, m: lc.m });
    if (src && src !== '#Error') items.splice(st.backgroundColor ? 1 : 0, 0, { t: 'image', x: item.x, y: 0, w: item.w, h: item.h, src: String(src), fit: item.fit || 'contain' });
    return { height: item.h, units: [{ top: 0, height: item.h, items }] };
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
    const st = resolveStyle([lc.base, item.style], ctx);
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
    const st = resolveStyle([lc.base, item.style], ctx);
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
    detail: [{ height: 18, style: { borderBottom: '0.5 solid #dee2e6' }, cells: [{ value: '' }, { value: '' }, { value: '' }] }],
    footer: [],
    style: { padding: [3, 4, 3, 4] },
  }),
  props: [
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Data' },
    { key: 'repeatHeader', label: 'Repeat header on each page', type: 'bool', category: 'Layout' },
    { key: 'noRowsText', label: 'Text when no rows', type: 'text', category: 'Data' },
    { key: 'pageBreakBefore', label: 'Page break before', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const tctx = lc.ctxFor(item);
    if (hidden(item, tctx, lc)) return { height: 0, units: [] };
    let rows = (item.dataSet && lc.dataSets[item.dataSet]) || [];
    if (item.dataSet && !lc.dataSets[item.dataSet]) lc.warn(`${item.name || 'Table'}: the data set "${item.dataSet}" does not exist`);
    if (item.filters?.length) rows = applyFilters(rows, item.filters, tctx);
    if (item.sort?.length) rows = applySort(rows, item.sort, tctx);

    const cols = item.columns || [];
    const colX = [];
    let acc = item.x;
    for (const c of cols) { colX.push(acc); acc += c.width; }
    const width = acc - item.x;

    const scope = { ...tctx, aggRows: rows, fields: rows[0] || null };
    const units = [];
    let y = 0;

    const layRow = (row, ctx, kind) => {
      const rst = resolveStyle([lc.base, item.style, row.style], ctx);
      const cells = [];
      let need = row.height || 18;
      for (let ci = 0; ci < cols.length; ci++) {
        const cell = row.cells?.[ci];
        if (!cell) continue;
        const span = Math.max(1, Math.min(cell.colSpan || 1, cols.length - ci));
        let cw = 0;
        for (let k = 0; k < span; k++) cw += cols[ci + k].width;
        const st = resolveStyle([rst, cell.style], ctx);
        const r = evalSafe(cell.value ?? '', ctx, lc, `${item.name || 'Table'} cell`);
        const tl = layoutTextLines(textOf(r.v, st, ctx), st, cw, lc.m);
        if (row.canGrow !== false && tl.needed > need + GROW_TOLERANCE) need = tl.needed;
        cells.push({ x: colX[ci], w: cw, st, tl, numeric: typeof r.v === 'number' });
      }
      const items = [];
      for (const c of cells) items.push(...paintBox({ x: c.x, y: 0, w: c.w, h: need, st: c.st, tl: c.tl, numeric: c.numeric, m: lc.m }));
      const u = { top: y, height: need, items, kind };
      y += need;
      units.push(u);
      return u;
    };

    const headerUnits = (item.header || []).map(r => layRow(r, scope, 'header'));
    const headerHeight = headerUnits.reduce((s, u) => s + u.height, 0);
    const headerItems = [];
    for (const u of headerUnits) for (const it of shiftLocal(u.items, u.top)) headerItems.push(it);
    if (headerUnits.length) headerUnits[headerUnits.length - 1].keepWithNext = true;

    if (rows.length === 0 && item.noRowsText) {
      const st = resolveStyle([lc.base, item.style, { fontStyle: 'italic', color: '#868e96' }], scope);
      const tl = layoutTextLines(String(item.noRowsText), st, width, lc.m);
      units.push({ top: y, height: tl.needed, items: paintBox({ x: item.x, y: 0, w: width, h: tl.needed, st, tl, m: lc.m }), kind: 'detail' });
      y += tl.needed;
    }
    const dctx = { ...scope };
    for (let i = 0; i < rows.length; i++) {
      dctx.fields = rows[i];
      dctx.rowNumber = i + 1;
      for (const r of item.detail || []) layRow(r, dctx, 'detail');
    }
    const footerUnits = (item.footer || []).map(r => layRow(r, scope, 'footer'));
    if (footerUnits.length) footerUnits[0].keepWithPrevious = true;

    return {
      height: y, units,
      table: item.repeatHeader !== false && headerHeight ? { headerHeight, headerItems, x: item.x } : null,
    };
  },
});

function shiftLocal(items, dy) {
  return items.map((it) => {
    if (it.t === 'text') return { ...it, lines: it.lines.map(l => ({ ...l, y: l.y + dy })), clip: it.clip && { ...it.clip, y: it.clip.y + dy } };
    if (it.t === 'line') return { ...it, y1: it.y1 + dy, y2: it.y2 + dy };
    if (it.t === 'ellipse') return { ...it, cy: it.cy + dy };
    return { ...it, y: it.y + dy };
  });
}

/* ------------------------------------------------------- style metadata */
export const TEXT_STYLE_PROPS = [
  { key: 'fontFamily', label: 'Font', type: 'font', category: 'Text' },
  { key: 'fontSize', label: 'Size', type: 'number', category: 'Text' },
  { key: 'fontWeight', label: 'Weight', type: 'select', options: ['normal', '600', 'bold'], category: 'Text' },
  { key: 'fontStyle', label: 'Style', type: 'select', options: ['normal', 'italic'], category: 'Text' },
  { key: 'color', label: 'Color', type: 'color', category: 'Text' },
  { key: 'textAlign', label: 'Align', type: 'select', options: ['auto', 'left', 'center', 'right'], category: 'Text' },
  { key: 'verticalAlign', label: 'Vertical align', type: 'select', options: ['top', 'middle', 'bottom'], category: 'Text' },
  { key: 'format', label: 'Format (C2, N0, dd MMM yyyy)', type: 'text', category: 'Text' },
  { key: 'lineHeight', label: 'Line height', type: 'number', category: 'Text' },
  { key: 'backgroundColor', label: 'Background', type: 'color', category: 'Box' },
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
