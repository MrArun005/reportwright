'use client';
import { useEffect, useRef, useState } from 'react';
import { useDesigner, SECTIONS, bodyWidth, addItem, moveItems, updateItem, findItem, tableSetColumnWidth, tableParts, rowsOf, round, NESTING } from './store.js';
import { BASE_STYLE, parseBorder } from '@/engine/style.js';
import { isDynamic } from '@/engine/expr/evaluate.js';
import { resolveFontKey } from '@/engine/text/fonts.js';
import { normBox } from '@/engine/units.js';
import { fontFamilyCss, pageToSvg } from '@/exporters/svg.js';
import { ITEMS } from '@/engine/items/index.js';
import { TextMeasurer } from '@/engine/text/measure.js';
import { layoutItems } from '@/engine/layout.js';
import { shiftItems } from '@/engine/items/paint.js';
import { resolveParameters } from '@/engine/index.js';
import { fontStore } from '@/viewer/engineClient.js';

export const PX = 96 / 72;
export const MIME_TOOL = 'application/x-pw-tool';
export const MIME_FIELD = 'application/x-pw-field';

/* ---------------------------------------------------------------- style → css */
function staticStyle(layers) {
  const st = { ...BASE_STYLE };
  for (const l of layers) if (l) for (const k in l) if (l[k] !== undefined && !isDynamic(l[k])) st[k] = l[k];
  return st;
}
function cssBorder(b, s) { const p = parseBorder(b); return p ? `${Math.max(1, p.width * s)}px ${p.style} ${p.color}` : undefined; }
export function textCss(layers, s, numeric = false) {
  const st = staticStyle(layers);
  const pad = normBox(st.padding);
  const align = st.textAlign === 'auto' ? (numeric ? 'right' : 'left') : st.textAlign;
  return {
    box: {
      background: st.backgroundColor || undefined,
      padding: pad.map(p => `${p * s}px`).join(' '),
      alignItems: st.verticalAlign === 'middle' ? 'center' : st.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
      borderTop: cssBorder(st.borderTop ?? st.border, s), borderRight: cssBorder(st.borderRight ?? st.border, s),
      borderBottom: cssBorder(st.borderBottom ?? st.border, s), borderLeft: cssBorder(st.borderLeft ?? st.border, s),
    },
    text: {
      fontFamily: `"${fontFamilyCss(resolveFontKey(st.fontFamily, st.fontWeight, st.fontStyle))}"`,
      fontSize: `${(Number(st.fontSize) || 9) * s}px`, color: st.color, textAlign: align,
      lineHeight: st.lineHeight || 1.25, fontKerning: 'none',
    },
  };
}
const shown = (v) => (v == null ? '' : String(v));

/* ---------------------------------------------------------------- canvas */
export default function Canvas() {
  const def = useDesigner(s => s.def);
  const zoom = useDesigner(s => s.zoom);
  const scale = zoom * PX;
  const bw = bodyWidth(def);
  const [drag, setDrag] = useState(null); // {mode:'move', ids, dx, dy} | {mode:'resize', id, rect} | {mode:'band', section, h} | {mode:'col', id, col, w}

  return (
    <div className="cscroll" onPointerDown={(e) => { if (e.target === e.currentTarget) useDesigner.getState().select({ kind: 'report' }); }}>
      <Ruler width={bw} scale={scale} />
      <div className="paper" style={{ width: bw * scale }} data-testid="paper">
        {SECTIONS.map(s => <Band key={s.key} section={s.key} label={s.label} scale={scale} bw={bw} drag={drag} setDrag={setDrag} />)}
      </div>
    </div>
  );
}

const UNIT_STEP = { pt: [72, 12], mm: [72 / 25.4 * 10, 72 / 25.4 * 2], cm: [72 / 2.54, 72 / 2.54 / 5], in: [72, 72 / 8] };
function Ruler({ width, scale }) {
  const unit = useDesigner(s => s.unit);
  const [major, minor] = UNIT_STEP[unit] || UNIT_STEP.pt;
  const ticks = [];
  for (let x = 0, i = 0; x <= width + 0.01; x += minor, i++) {
    const isMajor = Math.abs((x / major) - Math.round(x / major)) < 1e-6;
    ticks.push(<line key={i} x1={x * scale} x2={x * scale} y1={isMajor ? 4 : 11} y2={16} stroke="#8e99a4" strokeWidth={isMajor ? 1 : 0.6} />);
    if (isMajor && x > 0) ticks.push(<text key={`t${i}`} x={x * scale + 2} y={10} fontSize="9" fill="#5f6b77" fontFamily="var(--mono)">{Math.round(x / major) * (unit === 'mm' ? 10 : unit === 'pt' ? 72 : 1)}</text>);
  }
  return <svg className="ruler" width={width * scale} height={16} style={{ display: 'block', margin: '0 auto 2px' }} aria-hidden="true">{ticks}</svg>;
}

function snapV(v) {
  const { snap, grid } = useDesigner.getState();
  return snap ? Math.round(v / grid) * grid : round(v);
}

/* ---------------------------------------------------------------- band */
function Band({ section, label, scale, bw, drag, setDrag }) {
  const sec = useDesigner(s => s.def.sections[section]);
  const sel = useDesigner(s => s.sel);
  const grid = useDesigner(s => s.grid);
  const ref = useRef(null);
  const [marquee, setMarquee] = useState(null);
  const [dropping, setDropping] = useState(false);
  const h = drag?.mode === 'band' && drag.section === section ? drag.h : sec.height || 0;

  const toPt = (e) => { const r = ref.current.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };

  const onBgDown = (e) => {
    if (e.target !== ref.current || e.button !== 0) return;
    e.preventDefault();
    const st = useDesigner.getState();
    const p0 = toPt(e);
    const additive = e.shiftKey;
    const prev = additive && st.sel.kind === 'items' ? st.sel.ids : [];
    const move = (ev) => { const p = toPt(ev); setMarquee({ x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) }); };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const p = toPt(ev);
      const r = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      setMarquee(null);
      if (r.w < 3 && r.h < 3) { if (!additive) st.select({ kind: 'section', section }); return; }
      const hit = useDesigner.getState().def.sections[section].items
        .filter(i => i.x < r.x + r.w && i.x + Math.max(i.w, 1) > r.x && i.y < r.y + r.h && i.y + Math.max(i.h, 1) > r.y).map(i => i.id);
      const ids = [...new Set([...prev, ...hit])];
      st.select(ids.length ? { kind: 'items', ids } : { kind: 'section', section });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const onResizeDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const y0 = e.clientY, h0 = sec.height || 0;
    const minH = Math.max(0, ...sec.items.map(i => i.y + i.h));
    const move = (ev) => setDrag({ mode: 'band', section, h: Math.max(minH, snapV(h0 + (ev.clientY - y0) / scale)) });
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const nh = Math.max(minH, snapV(h0 + (ev.clientY - y0) / scale));
      setDrag(null);
      if (nh !== h0) useDesigner.getState().apply(d => { d.sections[section].height = nh; });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const accepts = (e) => e.dataTransfer.types.includes(MIME_TOOL) || e.dataTransfer.types.includes(MIME_FIELD);
  const onDrop = (e) => {
    setDropping(false);
    if (!accepts(e)) return;
    e.preventDefault();
    const p = toPt(e);
    const tool = e.dataTransfer.getData(MIME_TOOL);
    if (tool) {
      if ((tool === 'table' || tool === 'matrix' || tool === 'subreport') && section !== 'body') return alertOnce('Tables, matrices and subreports can only go in the body.');
      addItem(tool, section, snapV(p.x), snapV(p.y));
      return;
    }
    const f = JSON.parse(e.dataTransfer.getData(MIME_FIELD) || 'null');
    if (f) addItem('textbox', section, snapV(p.x), snapV(p.y), { value: `=Fields.${f.field}`, dataSet: f.dataSet, w: 120, h: 16, style: fieldStyle(f) });
  };

  const gridPx = grid * scale;
  const secSelected = sel.kind === 'section' && sel.section === section;
  return (
    <>
      <div className={`band-label${secSelected ? ' sel' : ''}`} onClick={() => useDesigner.getState().select({ kind: 'section', section })}>
        <span>{label}</span><span className="h">{round(h)} pt</span>
      </div>
      <div
        ref={ref}
        className={`band${dropping ? ' drop' : ''}`}
        data-section={section}
        style={{
          height: h * scale,
          backgroundImage: gridPx >= 5 ? 'radial-gradient(circle, rgba(95,107,119,.28) 0.8px, transparent 1px)' : undefined,
          backgroundSize: `${gridPx * 2}px ${gridPx * 2}px`,
        }}
        onPointerDown={onBgDown}
        onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        {sec.items.map(it => <AnyItem key={it.id} item={it} scale={scale} drag={drag} setDrag={setDrag} bw={bw} section={section} />)}
        {marquee && <div className="marquee" style={{ left: marquee.x * scale, top: marquee.y * scale, width: marquee.w * scale, height: marquee.h * scale }} />}
        {drag?.mode === 'move' && !drag.guideParent && sec.items.some(i => drag.ids.includes(i.id)) && (drag.guides || []).map((g, i) => (
          g.x != null
            ? <div key={i} className="guide v" style={{ left: g.x * scale }} />
            : <div key={i} className="guide h" style={{ top: g.y * scale }} />
        ))}
        {section === 'body' && sec.columns?.count > 1 && Array.from({ length: sec.columns.count - 1 }, (_, i) => {
          const cw = (bw - (sec.columns.gap ?? 18) * (sec.columns.count - 1)) / sec.columns.count;
          return <div key={`c${i}`} className="col-guide" style={{ left: ((i + 1) * cw + i * (sec.columns.gap ?? 18)) * scale, width: (sec.columns.gap ?? 18) * scale }} />;
        })}
        <div className="band-resize" onPointerDown={onResizeDown} title="Drag to change the band height" />
      </div>
    </>
  );
}

let alerted = 0;
function alertOnce(msg) { if (Date.now() - alerted > 3000) { alerted = Date.now(); useDesigner.setState({ saveError: msg }); setTimeout(() => useDesigner.setState({ saveError: null }), 3000); } }
/** Default format for a dropped field. Whole numbers in the sample data get N0, other numbers N2. */
export function fieldStyle(f) {
  if (f.type === 'date') return { format: 'dd MMM yyyy' };
  if (f.type !== 'number') return {};
  const rows = useDesigner.getState().sample?.dataSets?.[f.dataSet] || [];
  const vals = rows.slice(0, 200).map(r => r[f.field]).filter(v => typeof v === 'number');
  return { format: vals.length && vals.every(Number.isInteger) ? 'N0' : 'N2' };
}

/* ---------------------------------------------------------------- shared drag */
function useItemDrag(item, scale, setDrag) {
  return (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const st = useDesigner.getState();
    let ids;
    if (e.shiftKey) {
      const cur = st.sel.kind === 'items' ? st.sel.ids : [];
      ids = cur.includes(item.id) ? cur.filter(i => i !== item.id) : [...cur, item.id];
      st.select(ids.length ? { kind: 'items', ids } : { kind: 'report' });
      return;
    }
    ids = st.sel.kind === 'items' && st.sel.ids.includes(item.id) ? st.sel.ids : [item.id];
    st.select({ kind: 'items', ids });
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, dx = 0, dy = 0;
    // smart guides: edges and centres of the other items in the same band or container
    const f = findItem(st.def, item.id);
    const room = f?.parent ? f.parent.w : bodyWidth(st.def);
    const others = (f?.list || []).filter(o => !ids.includes(o.id));
    const gx = [0, room / 2, room, ...others.flatMap(o => [o.x, o.x + o.w / 2, o.x + o.w])];
    const gy = others.flatMap(o => [o.y, o.y + o.h / 2, o.y + o.h]);
    const thr = 5 / scale;
    const snapTo = (pos, size, cands) => {
      let best = null;
      for (const [edge, off] of [[pos, 0], [pos + size / 2, size / 2], [pos + size, size]]) {
        for (const c of cands) { const d = Math.abs(edge - c); if (d < thr && (!best || d < best.d)) best = { d, at: c, pos: c - off }; }
      }
      return best;
    };
    const move = (ev) => {
      const rx = (ev.clientX - x0) / scale, ry = (ev.clientY - y0) / scale;
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return;
      moved = true;
      let nx = snapV(item.x + rx), ny = snapV(item.y + ry);
      const guides = [];
      if (!ev.altKey) {
        const sx = snapTo(item.x + rx, item.w, gx), sy = snapTo(item.y + ry, item.h, gy);
        if (sx) { nx = round(sx.pos); guides.push({ x: sx.at }); }
        if (sy) { ny = round(sy.pos); guides.push({ y: sy.at }); }
      }
      dx = nx - item.x; dy = ny - item.y;
      setDrag({ mode: 'move', ids, dx, dy, guides, guideParent: f?.parent?.id || null });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDrag(null);
      if (moved) moveItems(ids, dx, dy);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
}

function rectOf(item, drag) {
  if (drag?.mode === 'resize' && drag.id === item.id) return drag.rect;
  if (drag?.mode === 'move' && drag.ids.includes(item.id)) return { x: item.x + drag.dx, y: item.y + drag.dy, w: item.w, h: item.h };
  return item;
}

/* ---------------------------------------------------------------- items */
function AnyItem(props) {
  const t = props.item.type;
  if (t === 'table') return <TableView {...props} />;
  if (NESTING.has(t)) return <ItemView {...props} nest />;
  return <ItemView {...props} />;
}

/** Children of a container or list, drawn inside it. Drops land in the parent. */
function NestChildren({ item, scale, drag, setDrag, section }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  const accepts = (e) => e.dataTransfer.types.includes(MIME_TOOL) || e.dataTransfer.types.includes(MIME_FIELD);
  const onDrop = (e) => {
    setOver(false);
    if (!accepts(e)) return;
    e.preventDefault(); e.stopPropagation();
    const r = ref.current.getBoundingClientRect();
    const x = snapV((e.clientX - r.left) / scale), y = snapV((e.clientY - r.top) / scale);
    const tool = e.dataTransfer.getData(MIME_TOOL);
    if (tool) { addItem(tool, section, x, y, {}, item.id); return; }
    const f = JSON.parse(e.dataTransfer.getData(MIME_FIELD) || 'null');
    if (f) addItem('textbox', section, x, y, { value: `=Fields.${f.field}`, dataSet: f.dataSet === item.dataSet ? undefined : f.dataSet, w: 120, h: 16, style: fieldStyle(f) }, item.id);
  };
  return (
    <div ref={ref} className={`nest${over ? ' drop' : ''}`}
      onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={() => setOver(false)} onDrop={onDrop}>
      {(item.items || []).map(ch => <AnyItem key={ch.id} item={ch} scale={scale} drag={drag} setDrag={setDrag} bw={item.w} section={section} />)}
    </div>
  );
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function ItemView({ item, scale, drag, setDrag, bw, nest, section }) {
  const selected = useDesigner(s => s.sel.kind === 'items' && s.sel.ids.includes(item.id));
  const single = useDesigner(s => s.sel.kind === 'items' && s.sel.ids.length === 1);
  const onDown = useItemDrag(item, scale, setDrag);
  const r = rectOf(item, drag);

  const onHandle = (dir) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    const o = { x: item.x, y: item.y, w: item.w, h: item.h };
    const minW = item.type === 'line' ? 0 : 4, minH = item.type === 'line' ? 0 : 4;
    let rect = o;
    const move = (ev) => {
      const dx = (ev.clientX - x0) / scale, dy = (ev.clientY - y0) / scale;
      let { x, y, w, h } = o;
      if (dir.includes('e')) w = Math.max(minW, snapV(o.x + o.w + dx) - o.x);
      if (dir.includes('s')) h = Math.max(minH, snapV(o.y + o.h + dy) - o.y);
      if (dir.includes('w')) { const nx = Math.min(snapV(o.x + dx), o.x + o.w - minW); w = o.x + o.w - nx; x = nx; }
      if (dir.includes('n')) { const ny = Math.min(snapV(o.y + dy), o.y + o.h - minH); h = o.y + o.h - ny; y = ny; }
      x = Math.max(0, x); w = Math.min(w, bw - x);
      rect = { x: round(x), y: round(Math.max(0, y)), w: round(w), h: round(h) };
      setDrag({ mode: 'resize', id: item.id, rect });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDrag(null);
      if (rect !== o) updateItem(item.id, (it, d, section) => {
        Object.assign(it, rect);
        const sec = d.sections[section];
        if (it.y + it.h > sec.height) sec.height = Math.ceil(it.y + it.h);
      });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const handlePos = (d) => ({
    left: d.includes('w') ? -4 : d.includes('e') ? r.w * scale - 4 : r.w * scale / 2 - 4,
    top: d.includes('n') ? -4 : d.includes('s') ? r.h * scale - 4 : r.h * scale / 2 - 4,
    cursor: `${d}-resize`,
  });
  const showBadge = drag && ((drag.mode === 'move' && drag.ids[0] === item.id) || (drag.mode === 'resize' && drag.id === item.id));

  return (
    <div className={`it${selected ? ' sel' : ''}`} data-item={item.name}
      style={{ left: r.x * scale, top: r.y * scale, width: Math.max(r.w * scale, 2), height: Math.max(r.h * scale, 2) }}
      onPointerDown={onDown}>
      {nest ? <NestBox item={{ ...item, ...r }} scale={scale} /> : <ItemBody item={{ ...item, ...r }} scale={scale} />}
      {nest && <NestChildren item={item} scale={scale} drag={drag} setDrag={setDrag} section={section} />}
      {selected && single && HANDLES.map(d => <div key={d} className="handle" style={handlePos(d)} onPointerDown={onHandle(d)} />)}
      {showBadge && <div className="guide-badge" style={{ left: 0, top: -18 }}>{drag.mode === 'move' ? `${round(r.x)}, ${round(r.y)}` : `${round(r.w)} × ${round(r.h)}`}</div>}
    </div>
  );
}

function NestBox({ item, scale }) {
  const base = useDesigner(s => s.def.styles?.base);
  const c = textCss([base, item.style], scale, false);
  const label = item.type === 'list' ? `List · ${item.dataSet || 'no data set'}${item.groupBy ? ` · by ${String(item.groupBy).replace(/^=Fields\./, '')}` : ''}` : 'Container';
  return <div className="box nest-box" style={c.box}><span className="nest-tag">{label}</span></div>;
}

const LIVE = new Set(['chart', 'matrix', 'barcode', 'sparkline', 'databar', 'bullet']);
let measurer = null;

/** Draw chart-like items with the real engine and the sample data, so the design looks like the output. */
function LivePreview({ item, scale }) {
  const sample = useDesigner(s => s.sample);
  const def = useDesigner(s => s.def);
  const [svg, setSvg] = useState(null);
  const { x, y, ...shape } = item;
  const key = JSON.stringify(shape);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const store = fontStore();
        await store.load();
        measurer ||= new TextMeasurer(store);
        const dataSets = sample?.dataSets || {};
        let params = {};
        try { params = resolveParameters(def, {}, { lenient: true }); } catch { /* defaults only */ }
        const base = { fontFamily: 'Inter', fontSize: 9, color: '#1f2937', padding: 2, lineHeight: 1.25, textAlign: 'auto', verticalAlign: 'top', ...(def.styles?.base || {}) };
        const ctxBase = { params, globals: { PageNumber: 1, TotalPages: 1, ExecutionTime: new Date(), ReportName: def.name }, dataSets, fields: null, locale: def.locale, currency: def.currency };
        let seq = 0;
        const lc = {
          m: measurer, base, dataSets, warn: () => {}, fixed: true, maxUnitHeight: 1e6, state: {}, regions: [], nextId: () => ++seq,
          layoutItems: (its, l, o) => layoutItems(its, l, o), linkFor: () => null, bodyWidth: shape.w, subreports: null,
          ctxFor: (it) => { const ds = it.dataSet || def.dataSets?.[0]?.name; const rows = (ds && dataSets[ds]) || []; return { ...ctxBase, fields: rows[0] || null, aggRows: rows }; },
        };
        const res = ITEMS[shape.type].layout({ ...shape, x: 0, y: 0 }, lc);
        const items = res.units.flatMap(u => shiftItems(u.items, 0, u.top));
        const h = Math.max(shape.h, res.height || 0);
        if (alive) setSvg({ html: pageToSvg({ items }, shape.w, h, { background: false }), h });
      } catch (e) { if (alive) setSvg({ error: e.message }); }
    }, 120);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sample, def.styles, def.parameters]);
  if (!svg) return <div className="box"><span className="hint">{ITEMS[item.type].label}</span></div>;
  if (svg.error) return <div className="box"><span className="err">{svg.error}</span></div>;
  return <div className="box live" style={{ overflow: 'visible' }}><div style={{ width: item.w * scale, height: svg.h * scale }} dangerouslySetInnerHTML={{ __html: svg.html }} /></div>;
}

function ItemBody({ item, scale }) {
  const base = useDesigner(s => s.def.styles?.base);
  if (LIVE.has(item.type)) return <LivePreview item={item} scale={scale} />;
  if (item.type === 'subreport') {
    return <div className="box" style={{ background: '#f5f3ff', alignItems: 'center', justifyContent: 'center' }}><span className="hint" style={{ color: '#6d28d9' }}>Subreport · {item.report || 'pick a report'}</span></div>;
  }
  if (item.type === 'textbox') {
    const dyn = isDynamic(item.value);
    const c = textCss([base, item.style], scale, false);
    return <div className="box" style={c.box}><div className={`tx${dyn ? ' dyn' : ''}`} style={c.text}>{shown(item.value)}</div></div>;
  }
  if (item.type === 'shape') {
    const st = staticStyle([item.style]);
    const sw = st.stroke && st.stroke !== 'none' ? (Number(st.strokeWidth) || 0) * scale : 0;
    const w = item.w * scale, h = item.h * scale;
    return (
      <div className="box" style={{ outlineStyle: 'none' }}>
        <svg width={w} height={h} style={{ overflow: 'visible' }}>
          {item.shape === 'ellipse'
            ? <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={st.fill || 'none'} stroke={sw ? st.stroke : 'none'} strokeWidth={sw} />
            : <rect x={0} y={0} width={w} height={h} rx={(Number(st.radius) || 0) * scale} fill={st.fill || 'none'} stroke={sw ? st.stroke : 'none'} strokeWidth={sw} />}
        </svg>
      </div>
    );
  }
  if (item.type === 'line') {
    const st = staticStyle([item.style]);
    const w = Math.max(item.w * scale, 1), h = Math.max(item.h * scale, 1);
    const up = item.direction === 'up';
    return (
      <div className="box" style={{ outlineStyle: 'none', overflow: 'visible' }}>
        <svg width={w} height={h} style={{ overflow: 'visible' }}>
          <line x1={0} y1={up ? item.h * scale : 0} x2={item.w * scale} y2={up ? 0 : item.h * scale} stroke={st.stroke || '#000'} strokeWidth={Math.max(1, (Number(st.strokeWidth) || 1) * scale)}
            strokeDasharray={st.strokeDash === 'dashed' ? '6 4' : st.strokeDash === 'dotted' ? '2 3' : undefined} />
        </svg>
      </div>
    );
  }
  if (item.type === 'image') {
    const src = typeof item.src === 'string' && !isDynamic(item.src) && /^(data:image|https?:|\/)/.test(item.src) ? item.src : null;
    return (
      <div className="box" style={{ background: '#f5f7f9', alignItems: 'center', justifyContent: 'center' }}>
        {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: item.fit === 'fill' ? 'fill' : item.fit || 'contain' }} />
          : <span className="hint">{item.src ? shown(item.src) : 'Image'}</span>}
      </div>
    );
  }
  if (item.type === 'checkbox') {
    const c = textCss([base, item.style], scale, false);
    const size = Math.min(item.h, ((Number(item.style?.fontSize) || Number(base?.fontSize) || 9) + 2)) * scale;
    return (
      <div className="box" style={{ ...c.box, alignItems: 'center', gap: 4 * scale, padding: 0 }}>
        <span style={{ width: size, height: size, border: '1px solid #1f2328', borderRadius: 2, flex: 'none', display: 'grid', placeItems: 'center', fontSize: size * 0.8 }}>✓</span>
        <div className={`tx${isDynamic(item.text) ? ' dyn' : ''}`} style={c.text}>{shown(item.text)}</div>
      </div>
    );
  }
  return <div className="box"><span className="hint">{item.type}</span></div>;
}

/* ---------------------------------------------------------------- table */
function TableView({ item, scale, drag, setDrag }) {
  const sel = useDesigner(s => s.sel);
  const base = useDesigner(s => s.def.styles?.base);
  const tableSelected = sel.kind === 'items' && sel.ids.includes(item.id);
  const onGrip = useItemDrag(item, scale, setDrag);
  const r = rectOf(item, drag);
  const widths = item.columns.map((c, i) => (drag?.mode === 'col' && drag.id === item.id && drag.col === i ? drag.w : c.width));
  const [dropCell, setDropCell] = useState(null);

  const colDown = (ci) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = item.columns[ci].width;
    let w = w0;
    const move = (ev) => { w = Math.max(12, snapV(w0 + (ev.clientX - x0) / scale)); setDrag({ mode: 'col', id: item.id, col: ci, w }); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDrag(null); if (w !== w0) tableSetColumnWidth(item.id, ci, w); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const cellDrop = (part, ri, ci) => (e) => {
    setDropCell(null);
    if (!e.dataTransfer.types.includes(MIME_FIELD)) return;
    e.preventDefault(); e.stopPropagation();
    const f = JSON.parse(e.dataTransfer.getData(MIME_FIELD));
    updateItem(item.id, (t) => {
      if (!t.dataSet) t.dataSet = f.dataSet;
      const cell = rowsOf(t, part)[ri].cells[ci];
      if (part === 'detail') {
        cell.value = `=Fields.${f.field}`;
        const fs = fieldStyle(f);
        if (fs.format) cell.style = { ...(cell.style || {}), ...fs };
        // name the header cell above when it still holds a placeholder
        const h = t.header?.[t.header.length - 1]?.cells?.[ci];
        if (h && (!h.value || /^Column \d+$/.test(h.value))) h.value = f.field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
        if (h && f.type === 'number') h.style = { ...(h.style || {}), textAlign: 'right' };
      } else if ((part === 'footer' || /^g\d+f$/.test(part)) && f.type === 'number') {
        cell.value = `=Sum(Fields.${f.field})`;
        cell.style = { ...(cell.style || {}), ...fieldStyle(f) };
      }
      else cell.value = `=Fields.${f.field}`;
    });
    useDesigner.getState().select({ kind: 'cell', id: item.id, part, row: ri, col: ci });
  };

  let first = true;
  return (
    <div className={`tbl${tableSelected ? ' sel' : ''}`} data-item={item.name} style={{ left: r.x * scale, top: r.y * scale }}>
      <div className="grip" title="Select or move the table" onPointerDown={onGrip}>⠿</div>
      {tableParts(item).map(({ part, tag }) => (rowsOf(item, part) || []).map((row, ri) => {
        const rowStyle = row.style;
        const isFirst = first; first = false;
        let ci = 0;
        const cells = [];
        while (ci < item.columns.length) {
          const cell = row.cells?.[ci];
          const span = Math.max(1, Math.min(cell?.colSpan || 1, item.columns.length - ci));
          const w = widths.slice(ci, ci + span).reduce((a, b) => a + b, 0);
          const c = textCss([base, item.style, rowStyle, cell?.style], scale, false);
          const isSel = sel.kind === 'cell' && sel.id === item.id && sel.part === part && sel.row === ri && sel.col === ci;
          const col = ci;
          cells.push(
            <div key={ci} className={`cell${isSel ? ' sel' : ''}${dropCell === `${part}${ri}${col}` ? ' drop' : ''}`}
              style={{ width: w * scale, ...c.box }} data-cell={`${part}-${ri}-${col}`}
              onPointerDown={(e) => { e.stopPropagation(); useDesigner.getState().select({ kind: 'cell', id: item.id, part, row: ri, col }); }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(MIME_FIELD)) { e.preventDefault(); e.stopPropagation(); setDropCell(`${part}${ri}${col}`); } }}
              onDragLeave={() => setDropCell(null)}
              onDrop={cellDrop(part, ri, col)}>
              <div className={`tx${isDynamic(cell?.value) || cell?.visual ? ' dyn' : ''}`} style={c.text}>{cell?.visual?.type ? `∿ ${cell.visual.type}` : shown(cell?.value)}</div>
              {isFirst && <div className="col-resize" onPointerDown={colDown(ci + span - 1)} title="Drag to change the column width" />}
            </div>,
          );
          ci += span;
        }
        return (
          <div className="row" key={`${part}${ri}`} style={{ height: (row.height || 18) * scale }}>
            <div className="row-tag" title={part}>{tag}</div>
            {cells}
          </div>
        );
      }))}
    </div>
  );
}

export { findItem };
