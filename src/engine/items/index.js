// @ts-check
import { evalValue, toText, isDynamic } from '../expr/evaluate.js';
import { resolveStyle } from '../style.js';
import { layoutTextLines, paintBox } from './paint.js';
import { applyFilters, applySort } from '../data/index.js';
import { paintChart, CHART_TYPES } from './chart.js';
import { paintVisual } from './visuals.js';
import { paintBarcode, BARCODE_TYPES } from './barcode.js';
import { shiftItems } from './paint.js';

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
    { key: 'pageBreakAfter', label: 'Page break after', type: 'bool', category: 'Layout' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
    { key: 'bookmark', label: 'Bookmark (document map)', type: 'expr', category: 'Interactivity' },
    { key: 'action', label: 'Action', type: 'action', category: 'Interactivity' },
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
    const items = paintBox({ x: item.x, y: 0, w: item.w, h, st, tl, numeric, m: lc.m });
    addInteractivity(items, item, ctx, lc, { x: item.x, y: 0, w: item.w, h });
    return { height: h, units: [{ top: 0, height: h, items }] };
  },
});

/** Link (hyperlink, drill-through, jump) and bookmark for any item. */
function addInteractivity(items, item, ctx, lc, rect) {
  const link = lc.linkFor?.(item, ctx, rect);
  if (link) items.push(link);
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
    const tableScope = { rows, index: -1 };
    const scopes = { ...(tctx.scopes || {}), [item.name]: tableScope };
    const base = { ...tctx, aggRows: rows, aggIndex: undefined, fields: rows[0] || null, scopes };
    const units = [];
    let y = 0;

    const layRow = (row, ctx, kind, extra) => {
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
      const items = [];
      for (const c of cells) {
        if (c.cell.visual?.type) {
          items.push(...paintBox({ x: c.x, y: 0, w: c.w, h: need, st: c.st, tl: null, m: lc.m }));
          items.push(...paintVisual(c.cell.visual, { x: c.x, y: 0, w: c.w, h: need }, c.ctx, lc, c.st, `${item.name} cell`));
          continue;
        }
        items.push(...paintBox({ x: c.x, y: 0, w: c.w, h: need, st: c.st, tl: c.tl, numeric: c.numeric, m: lc.m }));
        const link = lc.linkFor?.(c.cell, c.ctx, { x: c.x, y: 0, w: c.w, h: need });
        if (link) items.push(link);
        if (cell_bookmark(c.cell)) { const b = evalSafe(c.cell.bookmark, c.ctx, lc, 'bookmark').v; if (b) items.push({ t: 'bookmark', label: String(b), x: c.x, y: 0, level: c.cell.bookmarkLevel || 0 }); }
        if (c.cell.sortBy && kind === 'header') {
          const cur = (lc.state?.sort?.[item.name] || [])[0];
          const dir = cur && cur.by === c.cell.sortBy && cur.dir === 'asc' ? 'desc' : 'asc';
          items.push({ t: 'link', x: c.x, y: 0, w: c.w, h: need, action: { type: 'sort', table: item.name, by: c.cell.sortBy, dir } });
        }
      }
      if (extra?.toggle) items.push({ t: 'link', x: colX[0], y: 0, w: cols[0]?.width || 20, h: need, action: { type: 'toggle', key: extra.toggle.key, open: extra.toggle.open } });
      const u = { top: y, height: need, items, kind };
      y += need;
      units.push(u);
      return u;
    };

    // table header
    const headerUnits = (item.header || []).map(r => layRow(r, base, 'header'));
    const headerHeight = headerUnits.reduce((s, u) => s + u.height, 0);
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
          rowNo++;
          for (const s of chain) s.index++;
          const dctx = { ...ctx, fields: grows[i], aggRows: grows, aggIndex: i, rowNumber: rowNo };
          for (const r of item.detail || []) layRow(r, dctx, 'detail', { level: groups.length });
        }
        return;
      }
      const g = groups[level];
      const buckets = groupRows(grows, g.expr, ctx, lc, item.name);
      if (g.sort === 'asc' || g.sort === 'desc') {
        buckets.sort((a, b) => cmpKey(a.key, b.key) * (g.sort === 'desc' ? -1 : 1));
      }
      buckets.forEach((bk, bi) => {
        const sc = { rows: bk.rows, index: -1 };
        const gname = g.name || `Group${level + 1}`;
        const gctx = { ...ctx, fields: bk.rows[0], aggRows: bk.rows, aggIndex: undefined, scopes: { ...ctx.scopes, [gname]: sc }, groupKey: bk.key };
        const path = `${keyPath}/${bk.text}`;
        const tkey = `${item.name}|${level}|${path}`;
        const open = !g.collapsible ? true : (lc.state?.toggles?.[tkey] ?? !g.initiallyCollapsed);
        const start = units.length;
        const hu = (g.header || []).map((r, ri) => layRow(r, gctx, 'groupHeader', { level, ...(ri === 0 && g.collapsible ? { toggle: { key: tkey, open } } : {}) }));
        const before = units.length;
        if (open) emit(level + 1, bk.rows, gctx, [...chain, sc], path);
        else for (const s of [...chain, sc]) s.index += bk.rows.length;
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

    const footerUnits = (item.footer || []).map(r => layRow(r, base, 'footer'));
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
  if (!m) return Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6;
  const d = (m[2] === '' ? 2 : Number(m[2])) + (m[1].toUpperCase() === 'P' ? 2 : 0);
  const k = 10 ** d;
  return Math.round(v * k) / k;
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
  const st = resolveStyle([lc.base, item.style], ctx);
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
    const listScope = { rows, index: -1 };
    reps.forEach((rs, i) => {
      listScope.index = i;
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
    const st = resolveStyle([lc.base, item.style], ctx);
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
    if (it.t === 'text') return { ...it, lines: it.lines.map(l => ({ ...l, y: l.y + dy })), clip: it.clip && { ...it.clip, y: it.clip.y + dy } };
    if (it.t === 'line') return { ...it, y1: it.y1 + dy, y2: it.y2 + dy };
    if (it.t === 'ellipse') return { ...it, cy: it.cy + dy };
    return { ...it, y: it.y + dy };
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
    { key: 'symbology', label: 'Symbology', type: 'select', options: BARCODE_TYPES, category: 'Barcode' },
    { key: 'value', label: 'Value', type: 'expr', category: 'Barcode' },
    { key: 'dataSet', label: 'Data set', type: 'dataset', category: 'Barcode' },
    { key: 'showText', label: 'Show text under the bars', type: 'bool', category: 'Barcode' },
    { key: 'hidden', label: 'Hidden', type: 'expr', category: 'Visibility' },
  ],
  layout(item, lc) {
    const ctx = lc.ctxFor(item);
    if (hidden(item, ctx, lc)) return { height: 0, units: [] };
    const st = resolveStyle([lc.base, item.style], ctx);
    const r = evalSafe(item.value ?? '', ctx, lc, item.name || 'Barcode');
    const text = r.err ? '' : textOf(r.v, st, ctx);
    const size = Number(st.fontSize) || 8;
    const th = item.showText !== false ? size * 1.4 : 0;
    const bc = paintBarcode({ type: item.symbology || 'code128', text, x: item.x, y: 0, w: item.w, h: item.h, color: st.color || '#000', showText: item.showText !== false, textHeight: th });
    const items = [...bc.items];
    if (bc.error) {
      lc.warn(`${item.name}: ${bc.error}`);
      const tl = layoutTextLines(`Barcode error: ${bc.error}`, { ...st, color: '#b91c1c' }, item.w, lc.m);
      items.push(...paintBox({ x: item.x, y: 0, w: item.w, h: item.h, st: { ...st, color: '#b91c1c', border: '0.5 dashed #b91c1c' }, tl, m: lc.m }));
    } else if (item.showText !== false && !bc.twoD && text) {
      const tl = layoutTextLines(text, { ...st, padding: 0 }, item.w, lc.m, { wrap: false });
      items.push(...paintBox({ x: item.x, y: item.h - th, w: item.w, h: th, st: { ...st, padding: 0, verticalAlign: 'bottom', textAlign: st.textAlign === 'auto' ? 'center' : st.textAlign }, tl, m: lc.m }));
    }
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
      header: [{ height: 18, style: item.headerStyle, cells: [{ value: item.corner || '' }, ...cols.map(cb => ({ value: label(cb.key), style: { textAlign: 'right' } })), ...(item.rowTotals !== false ? [{ value: 'Total', style: { textAlign: 'right' } }] : [])] }],
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
      params[k] = r.v instanceof Date ? r.v.toISOString().slice(0, 10) : r.v;
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
