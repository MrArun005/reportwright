'use client';
import SvgHtml from './SvgHtml.jsx';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useDesigner, sectionList, secOf, isBodyKey, isContentKey, bodyWidth, addItem, insertItem, moveItems, updateItem, findItem, tableSetColumnWidth, tableParts, rowsOf, round, NESTING,
  selCells, selectCells, uploadImages, cellRange, columnCells, rowCells, tableInsertRow, tableDeleteRow, tableInsertColumn, tableDeleteColumn, tableMergeRight, tableAddGroup } from './store.js';
import { tableFor, formatFor } from './tableGen.js';
import { loadBarcodes } from '@/engine/items/barcode.js';
const hasType = (items, t) => (items || []).some(i => i.type === t || hasType(i.items, t));
import { BASE_STYLE, parseBorder } from '@/engine/style.js';
import { isDynamic, functionTable } from '@/engine/expr/evaluate.js';
import { resolveFontKey, fallbackKeys } from '@/engine/text/fonts.js';
import { normBox } from '@/engine/units.js';
import { fontFamilyCss, pageToSvg } from '@/exporters/svg.js';
import { ITEMS } from '@/engine/items/index.js';
import { TextMeasurer, finishText } from '@/engine/text/measure.js';
import { layoutItems } from '@/engine/layout.js';
import { shiftItems } from '@/engine/items/paint.js';
import { resolveParameters } from '@/engine/index.js';
import { fontStore, customFonts, loadModelFonts } from '@/viewer/engineClient.js';
import { withPartProps } from '@/engine/items/index.js';
import { t } from '@/i18n/index.js';
import { themeContext, findItemNamed } from '@/engine/reuse.js';
import { MIME_PART, insertPart, useReused, useLayerOf, useT } from './Reuse.jsx';
import { wouldOverlap, useDesignerStore, activeStore } from './store.js';
import { designIssues, checkIssues } from './issues.js';
import { validate } from '@/engine/schema/validate.js';

export const PX = 96 / 72;

/** The report's design problems (issues.js): overlaps, wider than the page, unknown fields. Live items report their drawn width. */
export function useDesignIssues() {
  const def = useDesigner(s => s.def);
  const extents = useDesigner(s => s.extents);
  const saveCheck = useDesigner(s => s.saveCheck);
  return useMemo(() => {
    const bands = sectionList(def).map(s => ({ key: s.key, items: secOf(def, s.key)?.items || [], width: bodyWidth(def, s.key) }));
    // what a save would report (validate's errors: unknown functions, symbologies, syntax) and the last save's missing reports
    return [...designIssues(def, bands, extents || {}), ...checkIssues(bands, [...validate(def).errors, ...(saveCheck?.missing || [])])];
  }, [def, extents, saveCheck]);
}
const IssueMap = createContext(new Map());
/** One line about an issue, in the UI language. */
export function issueLine(T, i) {
  if (i.kind === 'overlap') return T('ux_issueOverlap', { name: i.name, other: i.other });
  if (i.kind === 'wide') return T('ux_issueWide', { name: i.name, width: i.width, room: i.room });
  if (i.kind === 'check') return i.text;
  return i.suggest ? T('ux_issueFieldSuggest', { name: i.name, field: i.field, suggest: i.suggest }) : T('ux_issueField', { name: i.name, field: i.field });
}
export const MIME_TOOL = 'application/x-pw-tool';
export const MIME_FIELD = 'application/x-pw-field';
export const MIME_DATASET = 'application/x-pw-dataset';

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
  // auto: numbers right, text by its own direction (Arabic and Hebrew paragraphs right), as the engine does
  const align = st.textAlign === 'auto' ? (numeric ? 'right' : 'start') : st.textAlign;
  const key = resolveFontKey(st.fontFamily, st.fontWeight, st.fontStyle);
  return {
    box: {
      backgroundColor: st.backgroundColor || undefined, // not the background shorthand: it clashes with backgroundImage
      // a background image by URL or data URI; an expression is only known in the preview
      backgroundImage: /^(https?:|data:image\/|\/)/i.test(String(st.backgroundImage || '')) ? `url("${encodeURI(String(st.backgroundImage)).replace(/"/g, '%22')}")` : undefined,
      backgroundSize: st.backgroundFit === 'fill' ? '100% 100%' : st.backgroundFit || 'cover',
      backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
      padding: pad.map(p => `${p * s}px`).join(' '),
      alignItems: st.verticalAlign === 'middle' ? 'center' : st.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
      borderTop: cssBorder(st.borderTop ?? st.border, s), borderRight: cssBorder(st.borderRight ?? st.border, s),
      borderBottom: cssBorder(st.borderBottom ?? st.border, s), borderLeft: cssBorder(st.borderLeft ?? st.border, s),
      borderRadius: Number(st.radius) > 0 ? Number(st.radius) * s : undefined,
    },
    text: {
      fontFamily: [key, ...fallbackKeys(key)].map(k => `"${fontFamilyCss(k)}"`).join(', '), // the bundled fallbacks, like the engine
      fontSize: `${(Number(st.fontSize) || 9) * s}px`, color: st.color, textAlign: align, unicodeBidi: 'plaintext',
      lineHeight: st.lineHeight || 1.25, fontKerning: 'none',
      textDecoration: /underline|line-through/.test(String(st.textDecoration || '')) ? st.textDecoration : undefined,
      textDecorationColor: st.textDecorationColor || undefined,
      writingMode: st.writingMode === 'tb-rl' ? 'vertical-rl' : undefined,
    },
  };
}
const shown = (v) => (v == null ? '' : String(v));

/* ---------------------------------------------------------------- canvas */
export default function Canvas() {
  const def = useDesigner(s => s.def);
  const zoom = useDesigner(s => s.zoom);
  const bands = sectionList(def);
  // a body section with its own page may be wider (landscape): each band has its own width
  const widths = Object.fromEntries(bands.map(s => [s.key, bodyWidth(def, s.key)]));
  const bw = Math.max(...Object.values(widths));
  // zoom "fit": the page fills the canvas width (it follows the window)
  const scrollRef = useRef(null);
  const [fitW, setFitW] = useState(0);
  useEffect(() => {
    if (zoom !== 'fit' || !scrollRef.current) return;
    const el = scrollRef.current;
    const ro = new ResizeObserver(() => setFitW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom]);
  const scale = zoom === 'fit' ? Math.max(0.3, Math.min(3, ((fitW || 900) - 80) / bw)) : zoom * PX;
  const [drag, setDrag] = useState(null); // {mode:'move', ids, dx, dy} | {mode:'resize', id, rect} | {mode:'band', section, h} | {mode:'col', id, col, w}
  const T = useT();
  const issues = useDesignIssues();
  const byId = useMemo(() => { const m = new Map(); for (const i of issues) m.set(i.id, [...(m.get(i.id) || []), issueLine(T, i)]); return m; }, [issues]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <IssueMap.Provider value={byId}>
    <div className="cscroll" ref={scrollRef} onPointerDown={(e) => { if (e.target === e.currentTarget) useDesigner.getState().select({ kind: 'report' }); }}
      onPointerDownCapture={blurField}>
      <Ruler width={bw} scale={scale} />
      <div className="paper" style={{ width: bw * scale }} data-testid="paper">
        {/* a content report's named placeholders are drawn inside the master's body (Band), not as bands of their own */}
        {bands.filter(s => !(def.master && isContentKey(s.key))).map(s => <Band key={s.key} section={s.key} label={s.label} scale={scale} bw={widths[s.key]} drag={drag} setDrag={setDrag} />)}
      </div>
    </div>
    </IssueMap.Provider>
  );
}

/** A click on the canvas takes the keyboard back from an Inspector field, so shortcuts (Delete, arrows, ⌘D) work again.
 *  Item clicks preventDefault (for dragging), which would otherwise leave the focus in the field. */
function blurField(e) {
  const a = e.currentTarget.getRootNode().activeElement; // the shadow root when embedded
  if (a && !e.currentTarget.contains(a) && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) a.blur();
}

const UNIT_STEP = { pt: [72, 12], mm: [72 / 25.4 * 10, 72 / 25.4 * 2], cm: [72 / 2.54, 72 / 2.54 / 5], in: [72, 72 / 8] };
function Ruler({ width, scale, vertical = false }) {
  const unit = useDesigner(s => s.unit);
  const [major, minor] = UNIT_STEP[unit] || UNIT_STEP.pt;
  const ticks = [];
  for (let x = 0, i = 0; x <= width + 0.01; x += minor, i++) {
    const isMajor = Math.abs((x / major) - Math.round(x / major)) < 1e-6;
    const v = x * scale, a = isMajor ? 4 : 11;
    ticks.push(vertical
      ? <line key={i} y1={v} y2={v} x1={a} x2={16} stroke="var(--ruler-tick)" strokeWidth={isMajor ? 1 : 0.6} />
      : <line key={i} x1={v} x2={v} y1={a} y2={16} stroke="var(--ruler-tick)" strokeWidth={isMajor ? 1 : 0.6} />);
    const label = Math.round(x / major) * (unit === 'mm' ? 10 : unit === 'pt' ? 72 : 1);
    if (isMajor && x > 0) ticks.push(vertical
      ? <text key={`t${i}`} x={2} y={v - 2} fontSize="8" fill="var(--ruler-text)" fontFamily="var(--mono)">{label}</text>
      : <text key={`t${i}`} x={v + 2} y={10} fontSize="9" fill="var(--ruler-text)" fontFamily="var(--mono)">{label}</text>);
  }
  // the vertical ruler sits beside each band (its own 0 at the band's top), outside the page
  if (vertical) return <svg className="ruler v" width={16} height={width * scale} aria-hidden="true">{ticks}</svg>;
  return <svg className="ruler" width={width * scale} height={16} style={{ display: 'block', margin: '0 auto 2px' }} aria-hidden="true">{ticks}</svg>;
}

function snapV(v) {
  const { snap, grid, cells, cellSize } = useDesigner.getState();
  if (cells) return Math.round(v / cellSize) * cellSize; // cell mode: whole cells
  return snap ? Math.round(v / grid) * grid : round(v);
}

/* ---------------------------------------------------------------- band */
/** A master report's band as the content report sees it: items (locked), and where the content goes. */
function masterBand(m, section) {
  if (!m?.sections) return null;
  if (!isBodyKey(section)) {
    const b = m.sections[section];
    return b?.height ? { items: b.items || [], height: b.height, off: null } : null;
  }
  const b = (Array.isArray(m.sections.body) ? m.sections.body[0] : m.sections.body) || {};
  const all = b.items || [];
  // the body goes in the first placeholder; the others are filled by name (sections.content), in the first section only
  const phs = all.filter(i => i.type === 'placeholder');
  const ph = phs[0];
  const items = all.filter(i => i.type !== 'placeholder');
  const below = items.length ? Math.max(...items.map(i => i.y + i.h)) + 6 : 0;
  const extras = section === 'body' ? phs.slice(1).filter(p => p.name).map(p => ({ name: p.name, x: p.x, y: p.y, w: p.w, h: p.h })) : [];
  return { items, extras, height: Math.max(b.height || 0, below, ...phs.map(p => p.y + p.h)), off: ph ? { x: ph.x, y: ph.y, w: ph.w, h: ph.h } : { x: 0, y: below, w: null, h: 0 } };
}

/** Fill a master's named placeholder: the content report gets an entry for it in sections.content. */
function fillPlaceholder(p) {
  const st = useDesigner.getState();
  st.apply(d => { d.sections.content = [...(d.sections.content || []), { placeholder: p.name, height: Math.max(12, Math.round(p.h)), items: [] }]; });
  st.select({ kind: 'section', section: `content:${useDesigner.getState().def.sections.content.length - 1}` });
}

function Band({ section, label, scale, bw: bandW, drag, setDrag, phBox = null }) {
  const T = useT();
  const sec = useDesigner(s => secOf(s.def, section));
  const sel = useDesigner(s => s.sel);
  const grid = useDesigner(s => s.grid);
  const cells = useDesigner(s => s.cells);
  const cellSize = useDesigner(s => s.cellSize);
  const masterId = useDesigner(s => s.def.master);
  const readOnly = useDesigner(s => s.readOnly);
  const master = useReused(masterId);
  // phBox: a named placeholder's content, drawn inside the master's body at the placeholder's box
  const mb = masterId && !phBox ? masterBand(master, section) : null;
  const off = phBox || mb?.off || null; // the body of a content report: its items sit in the master's content placeholder
  const contentList = useDesigner(s => s.def.sections?.content);
  const bw = off?.w || bandW;
  const ref = useRef(null);
  const [marquee, setMarquee] = useState(null);
  const [dropping, setDropping] = useState(false);
  const h = drag?.mode === 'band' && drag.section === section ? drag.h : sec.height || 0;
  // while a tool or field is dragged over the band it shows room below its height; a drop there grows the band
  const DROP_ROOM = 96;

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
      const lay = useDesigner.getState().def.layers || [];
      const hit = secOf(useDesigner.getState().def, section).items
        .filter(i => !lay.some(l => l.name === i.layer && (l.locked || l.visible === false)))
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
      if (nh !== h0) useDesigner.getState().apply(d => { secOf(d, section).height = nh; });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const accepts = (e) => e.dataTransfer.types.includes(MIME_TOOL) || e.dataTransfer.types.includes(MIME_FIELD) || e.dataTransfer.types.includes(MIME_DATASET) || e.dataTransfer.types.includes(MIME_PART) || e.dataTransfer.types.includes('Files');
  const onDrop = (e) => {
    setDropping(false);
    if (!accepts(e)) return;
    e.preventDefault();
    if (mb && !off) return alertOnce(T('masterBandLocked'));
    const p = toPt(e);
    // an image file from the desktop: into the report's images, and an image item where it was dropped
    const files = [...(e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type));
    if (files.length) {
      uploadImages(files.slice(0, 1), T).then(({ names, err }) => {
        if (err) alertOnce(err);
        if (names[0]) addItem('image', section, snapV(p.x), snapV(p.y), { src: `embedded:${names[0]}`, w: 120, h: 60 });
      });
      return;
    }
    const part = JSON.parse(e.dataTransfer.getData(MIME_PART) || 'null');
    if (part) { insertPart(part.library, part.part, { section, x: snapV(p.x), y: snapV(p.y) }); return; }
    const tool = e.dataTransfer.getData(MIME_TOOL);
    if (tool) {
      if ((tool === 'table' || tool === 'matrix' || tool === 'subreport') && !isBodyKey(section) && !isContentKey(section)) return alertOnce('Tables, matrices and subreports can only go in the body.');
      insertItem(tool, section, snapV(p.x), snapV(p.y));
      return;
    }
    const dsDrop = JSON.parse(e.dataTransfer.getData(MIME_DATASET) || 'null');
    if (dsDrop) {
      // a data set dropped on the page: a table of its rows, with totals for the number fields
      if (!isBodyKey(section) && !isContentKey(section)) return alertOnce('Tables can only go in the body.');
      const st = useDesigner.getState();
      const ds = (st.def.dataSets || []).find(d => d.name === dsDrop.dataSet);
      if (!ds?.fields?.length) return alertOnce('Detect the fields of this data set first (Edit → Detect fields).');
      const x = snapV(p.x);
      const { type, x: _x, y: _y, ...props } = tableFor(ds, { layout: 'list', width: Math.max(120, bodyWidth(st.def, section) - x), rows: st.sample?.dataSets?.[ds.name], currency: st.def.currency, fields: ds.fields.slice(0, 8).map(f => f.name) });
      addItem('table', section, x, snapV(p.y), props);
      return;
    }
    const f = JSON.parse(e.dataTransfer.getData(MIME_FIELD) || 'null');
    if (f) addItem('textbox', section, snapV(p.x), snapV(p.y), { value: `=Fields.${f.field}`, dataSet: f.dataSet, w: 120, h: 16, style: fieldStyle(f) });
  };

  const gridPx = grid * scale;
  const cellPx = cellSize * scale;
  const secSelected = sel.kind === 'section' && sel.section === section;
  const surface = (
      <div
        ref={ref}
        className={`band${dropping ? ' drop' : ''}${off ? ' master-content' : ''}${mb && !off ? ' master-locked' : ''}`}
        data-section={section}
        style={{
          height: (h + (dropping ? DROP_ROOM : 0)) * scale, width: bw * scale,
          ...(off ? { position: 'absolute', left: off.x * scale, top: off.y * scale } : {}),
          // cell mode: the cells as lines; otherwise the snap grid as dots
          backgroundImage: cells ? 'linear-gradient(to right, rgba(14,116,144,.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(14,116,144,.18) 1px, transparent 1px)'
            : gridPx >= 5 ? 'radial-gradient(circle, rgba(95,107,119,.28) 0.8px, transparent 1px)' : undefined,
          backgroundSize: cells ? `${cellPx}px ${cellPx}px` : `${gridPx * 2}px ${gridPx * 2}px`,
        }}
        onPointerDown={onBgDown}
        onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); }} // not when moving onto an item inside
        onDrop={onDrop}
      >
        {sec.items.map(it => <AnyItem key={it.id} item={it} scale={scale} drag={drag} setDrag={setDrag} bw={bw} section={section} />)}
        {!sec.items.length && isBodyKey(section) && !readOnly && !dropping && h * scale >= 40 && <div className="band-empty" data-testid="band-empty">{T('emptyBodyHint')}</div>}
        {marquee && <div className="marquee" style={{ left: marquee.x * scale, top: marquee.y * scale, width: marquee.w * scale, height: marquee.h * scale }} />}
        {drag?.mode === 'move' && !drag.guideParent && sec.items.some(i => drag.ids.includes(i.id)) && (drag.guides || []).map((g, i) => (
          g.x != null
            ? <div key={i} className="guide v" style={{ left: g.x * scale }} />
            : <div key={i} className="guide h" style={{ top: g.y * scale }} />
        ))}
        {isBodyKey(section) && sec.columns?.count > 1 && Array.from({ length: sec.columns.count - 1 }, (_, i) => {
          const cw = (bw - (sec.columns.gap ?? 18) * (sec.columns.count - 1)) / sec.columns.count;
          return <div key={`c${i}`} className="col-guide" style={{ left: ((i + 1) * cw + i * (sec.columns.gap ?? 18)) * scale, width: (sec.columns.gap ?? 18) * scale }} />;
        })}
        <div className="band-resize" onPointerDown={onResizeDown} title="Drag to change the band height" />
        {!off && !phBox && <Ruler width={h} scale={scale} vertical />}
      </div>
  );
  if (phBox) return surface;
  return (
    <>
      <div className={`band-label${secSelected ? ' sel' : ''}`} onClick={() => useDesigner.getState().select({ kind: 'section', section })}>
        <span>{label}{mb ? ` · ${T('fromMaster')}` : ''}</span><span className="h">{round(h)} pt</span>
      </div>
      {mb ? (
        <div className="band master-host" style={{ height: (mb.height + (off ? Math.max(0, h - off.h) : 0)) * scale, width: bandW * scale }} data-master={masterId}>
          {/* the master's items below the placeholder move down as the content grows, as they will when rendered */}
          <div className="master-layer" aria-hidden="true">{mb.items.map((it, i) => <StaticItem key={it.id || i} item={off && it.y >= off.y + off.h ? { ...it, y: it.y + Math.max(0, h - off.h) } : it} scale={scale} />)}</div>
          {surface}
          {(mb.extras || []).map((p) => {
            const i = (contentList || []).findIndex(e => e?.placeholder === p.name);
            if (i >= 0) return <Band key={p.name} section={`content:${i}`} scale={scale} bw={p.w} drag={drag} setDrag={setDrag} phBox={p} />;
            return (
              <div key={p.name} className="band master-content" style={{ position: 'absolute', left: p.x * scale, top: p.y * scale, width: p.w * scale, height: p.h * scale, display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-placeholder={p.name}>
                {!readOnly && <button className="btn sm" onClick={() => fillPlaceholder(p)} data-testid={`fill-placeholder-${p.name}`}>{T('fillPlaceholder', { name: p.name })}</button>}
              </div>
            );
          })}
        </div>
      ) : surface}
    </>
  );
}

/** A master report's item in a content report: drawn, never selected or moved. */
function StaticItem({ item, scale }) {
  return (
    <div className="it" style={{ left: item.x * scale, top: item.y * scale, width: Math.max(item.w * scale, 2), height: Math.max(item.h * scale, 2) }} data-master-item={item.name}>
      {NESTING.has(item.type) ? <><NestBox item={item} scale={scale} />{(item.items || []).map((c, i) => <StaticItem key={c.id || i} item={c} scale={scale} />)}</>
        : item.type === 'table' ? <div className="box"><span className="hint">{ITEMS.table.label} · {item.name}</span></div>
          : <ItemBody item={item} scale={scale} />}
    </div>
  );
}

let alerted = 0;
function alertOnce(msg) { if (Date.now() - alerted > 3000) { alerted = Date.now(); const api = activeStore(); api.setState({ saveError: msg }); setTimeout(() => api.setState({ saveError: null }), 3000); } }
/** Default format for a dropped field: the field's one format (tableGen formatFor), the same in every row and total. */
export function fieldStyle(f) {
  const st = useDesigner.getState();
  const format = formatFor({ name: f.field, type: f.type }, (st.sample?.dataSets?.[f.dataSet] || []).slice(0, 200), { currency: st.def?.currency });
  return format ? { format } : {};
}

/**
 * Keyboard access to an item (N35): a Tab stop named "Text box T1, x 10, y 10"; Enter or Space selects it (Shift adds
 * or removes); then Delete, the arrows and Ctrl+D act on the selection as after a click.
 */
function useItemKeys(item) {
  const T = useT();
  const type = T(`item_${item.type}`) === `item_${item.type}` ? ITEMS[item.type]?.label || item.type : T(`item_${item.type}`);
  return {
    tabIndex: 0, role: 'group', 'data-item-key': item.id,
    'aria-label': T('b9_itemLabel', { type, name: item.name, x: round(item.x), y: round(item.y) }),
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); e.stopPropagation();
      const st = useDesigner.getState();
      const cur = st.sel.kind === 'items' ? st.sel.ids : [];
      const ids = !e.shiftKey ? [item.id] : cur.includes(item.id) ? cur.filter(i => i !== item.id) : [...cur, item.id];
      st.select(ids.length ? { kind: 'items', ids } : { kind: 'report' });
    },
  };
}

/* ---------------------------------------------------------------- shared drag */
function useItemDrag(item, scale, setDrag) {
  return (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    // preventDefault keeps the focus where it was (a removed Inspector field leaves it nowhere): the item takes it, so
    // Esc, Delete and Ctrl+S reach the designer (also embedded)
    e.currentTarget.closest?.('[data-item-key]')?.focus({ preventScroll: true });
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
    const room = f?.parent ? f.parent.w : bodyWidth(st.def, f?.section);
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
  const layer = useLayerOf(props.item);
  if (layer?.visible === false) return null; // a hidden layer is hidden here too
  const el = t === 'table' ? <TableView {...props} /> : NESTING.has(t) ? <ItemView {...props} nest /> : <ItemView {...props} />;
  return layer?.locked ? <div className="layer-locked" data-locked={props.item.name}>{el}</div> : el;
}

/** Children of a container or list, drawn inside it. Drops land in the parent. */
function NestChildren({ item, scale, drag, setDrag, section }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  const accepts = (e) => e.dataTransfer.types.includes(MIME_TOOL) || e.dataTransfer.types.includes(MIME_FIELD) || e.dataTransfer.types.includes(MIME_PART);
  const onDrop = (e) => {
    setOver(false);
    if (!accepts(e)) return;
    e.preventDefault(); e.stopPropagation();
    const r = ref.current.getBoundingClientRect();
    const x = snapV((e.clientX - r.left) / scale), y = snapV((e.clientY - r.top) / scale);
    const part = JSON.parse(e.dataTransfer.getData(MIME_PART) || 'null');
    if (part) { insertPart(part.library, part.part, { section, x, y, parentId: item.id }); return; }
    const tool = e.dataTransfer.getData(MIME_TOOL);
    if (tool) { insertItem(tool, section, x, y, {}, item.id); return; }
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
  const keys = useItemKeys(item);
  const r = rectOf(item, drag);
  const problems = useContext(IssueMap).get(item.id);

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
      if (rect !== o && useDesigner.getState().cells && wouldOverlap(useDesigner.getState().def, [item.id], () => rect)) { alertOnce(t(useDesigner.getState().lang, 'cellTaken')); return; }
      if (rect !== o) updateItem(item.id, (it, d, section) => {
        Object.assign(it, rect);
        const sec = secOf(d, section);
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
    <div className={`it${selected ? ' sel' : ''}${problems ? ' issue' : ''}`} data-item={item.name} title={problems?.join('\n')}
      style={{ left: r.x * scale, top: r.y * scale, width: Math.max(r.w * scale, 2), height: Math.max(r.h * scale, 2) }}
      onPointerDown={onDown} {...keys}>
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

// drawn by the engine (pageToSvg escapes all text): rich text never puts the report's HTML into the designer DOM
const LIVE = new Set(['chart', 'matrix', 'barcode', 'sparkline', 'databar', 'bullet', 'iconset', 'rangebar', 'richtext']);
let measurer = null;

/**
 * Paint one item with the real engine and the sample data. Returns {html, h} (SVG at the item's size).
 * Used by the canvas and by the chart gallery.
 */
export async function paintItemSvg(shape, def, sample, api = activeStore()) { // api: the designer's store (its reused reports)
  const store = fontStore();
  await Promise.all([store.load(), customFonts()]);
  if (shape.type === 'barcode' || hasType(shape.items, 'barcode')) await loadBarcodes();
  measurer ||= new TextMeasurer(store);
  const dataSets = sample?.dataSets || {};
  let params = {};
  try { params = resolveParameters(def, {}, { lenient: true }); } catch { /* defaults only */ }
  const base = { fontFamily: 'Inter', fontSize: 9, color: '#1f2937', padding: 2, lineHeight: 1.25, textAlign: 'auto', verticalAlign: 'top', ...(def.styles?.base || {}) };
  const theme = themeContext((typeof def.theme === 'string' && api.getState().reused[def.theme]?.themeDef) || def.themeDef);
  const ctxBase = { params, globals: { PageNumber: 1, TotalPages: 1, ExecutionTime: new Date(), ReportName: def.name }, dataSets, fields: null, locale: def.locale, currency: def.currency, functions: functionTable(def), theme };
  let seq = 0;
  const lc = {
    m: measurer, base, dataSets, warn: () => {}, fixed: true, maxUnitHeight: 1e6, state: {}, regions: [], nextId: () => ++seq,
    layoutItems: (its, l, o) => layoutItems(its, l, o), linkFor: () => null, bodyWidth: shape.w, subreports: null,
    ctxFor: (it) => { const ds = it.dataSet || def.dataSets?.[0]?.name; const rows = (ds && dataSets[ds]) || []; return { ...ctxBase, fields: rows[0] || null, aggRows: rows }; },
  };
  const plc = shape.partProps ? withPartProps(lc, shape.partProps) : lc; // a report part: PartProperties
  let res = ITEMS[shape.type].layout({ ...shape, x: 0, y: 0 }, plc);
  if (measurer.missing.size) { // text that needs a fallback font or the shaper: load them, lay out again (as render() does)
    await store.load([...measurer.missing]);
    measurer = lc.m = new TextMeasurer(store);
    res = ITEMS[shape.type].layout({ ...shape, x: 0, y: 0 }, shape.partProps ? withPartProps(lc, shape.partProps) : lc);
  }
  const items = res.units.flatMap(u => shiftItems(u.items, 0, u.top));
  finishText(items, measurer);
  const h = Math.max(shape.h, res.height || 0);
  await loadModelFonts({ pages: [{ items }] });
  // the drawn width: a matrix grows with its data past its box (the issues pane compares it with the page)
  const w = items.reduce((m, i) => { const r = (Number(i.x) || 0) + (Number(i.w) || 0); return Number.isFinite(r) && r > m ? r : m; }, shape.w); // no spread: a 100k-row table has millions of items
  return { html: pageToSvg({ items }, shape.w, h, { background: false }), h, w };
}

/** Draw chart-like items with the real engine and the sample data, so the design looks like the output. */
function LivePreview({ item, scale }) {
  const api = useDesignerStore(); // the timer below may fire while another designer is the active one
  const sample = useDesigner(s => s.sample);
  const def = useDesigner(s => s.def);
  const [svg, setSvg] = useState(null);
  const { x, y, ...shape } = item;
  const key = JSON.stringify(shape);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const out = await paintItemSvg(shape, def, sample, api);
        if (alive) {
          setSvg(out);
          const ex = api.getState().extents || {};
          if (Math.round(ex[item.id]?.w || 0) !== Math.round(out.w)) api.setState({ extents: { ...ex, [item.id]: { w: out.w } } });
        }
      } catch (e) { if (alive) setSvg({ error: e.message }); }
    }, 120);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sample, def.styles, def.parameters]);
  if (!svg) return <div className="box"><span className="hint">{ITEMS[item.type].label}</span></div>;
  if (svg.error) return <div className="box"><span className="err">{svg.error}</span></div>;
  return <div className="box live" style={{ overflow: 'visible' }}><SvgHtml as="div" style={{ width: item.w * scale, height: svg.h * scale }} html={svg.html} /></div>;
}

/** A linked report part, drawn by the engine from its library with this instance's property values. */
function PartPreview({ item, scale }) {
  const lib = useReused(item.library);
  const def = useDesigner(s => s.def);
  const sample = useDesigner(s => s.sample);
  const p = (lib?.parts || []).find(q => q.name === item.part);
  const src = p && findItemNamed(lib, p.item);
  const props = { ...Object.fromEntries((p?.properties || []).map(q => [q.name, q.default ?? null])), ...(item.properties || {}) };
  const [svg, setSvg] = useState(null);
  const key = JSON.stringify([src, props]);
  useEffect(() => {
    if (!src) return undefined;
    let alive = true;
    const t = setTimeout(() => { paintItemSvg({ ...src, partProps: props }, def, sample).then(o => { if (alive) setSvg(o); }, e => { if (alive) setSvg({ error: e.message }); }); }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [key, sample]); // eslint-disable-line react-hooks/exhaustive-deps
  const tag = <span className="nest-tag">{ITEMS.part.label} · {p?.label || item.part}</span>;
  if (!src || !svg || svg.error) return <div className="box reuse-box"><span className={svg?.error ? 'err' : 'hint'}>{svg?.error || `${item.library} / ${item.part}`}</span>{tag}</div>;
  return <div className="box live reuse-part" style={{ overflow: 'visible' }}><SvgHtml as="div" style={{ width: src.w * scale, height: svg.h * scale }} html={svg.html} />{tag}</div>;
}

function ItemBody({ item, scale }) {
  const base = useDesigner(s => s.def.styles?.base);
  const images = useDesigner(s => s.def.images);
  if (LIVE.has(item.type)) return <LivePreview item={item} scale={scale} />;
  if (item.type === 'part') return <PartPreview item={item} scale={scale} />;
  if (item.type === 'placeholder' || item.type === 'overflow') {
    return <div className="box reuse-box" data-kind={item.type}><span className="hint">{ITEMS[item.type].label}{item.type === 'overflow' ? ` · ${item.name}${item.overflowTo ? ` → ${item.overflowTo}` : ''}` : ''}</span></div>;
  }
  if (item.type === 'subreport') {
    return <div className="box" style={{ background: '#f5f3ff', alignItems: 'center', justifyContent: 'center' }}><span className="hint" style={{ color: '#6d28d9' }}>Subreport · {item.report || 'pick a report'}</span></div>;
  }
  if (item.type === 'textbox') {
    const dyn = isDynamic(item.value);
    const c = textCss([base, item.style], scale, false);
    const a = ((Number(item.rotate) || 0) % 360 + 360) % 360;
    let box = c.box;
    if (a) {
      // as the engine does: lay the text out in the box turned on its side (90°, 270°) or as drawn, then rotate about the centre
      const swap = a === 90 || a === 270;
      const bw = (swap ? item.h : item.w) * scale, bh = (swap ? item.w : item.h) * scale;
      box = { ...c.box, inset: 'auto', left: (item.w * scale - bw) / 2, top: (item.h * scale - bh) / 2, width: bw, height: bh, transform: `rotate(${a}deg)` };
    }
    return <div className="box" style={box}><div className={`tx${dyn ? ' dyn' : ''}`} style={c.text}>{shown(item.value)}</div></div>;
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
    // an embedded image (embedded:logo) is drawn from the report's images, as in the output
    const emb = typeof item.src === 'string' && /^embedded:(.+)$/.exec(item.src)?.[1];
    const src = emb ? (typeof images?.[emb] === 'string' && images[emb].startsWith('data:image/') ? images[emb] : null)
      : typeof item.src === 'string' && !isDynamic(item.src) && /^(data:image|https?:|\/)/.test(item.src) ? item.src : null;
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
const cellOf = (el) => { const m = /^(.+)-(\d+)-(\d+)$/.exec(el?.closest?.('[data-cell]')?.getAttribute('data-cell') || ''); return m ? { part: m[1], row: Number(m[2]), col: Number(m[3]) } : null; };
const same = (a, b) => a.part === b.part && a.row === b.row && a.col === b.col;

function TableView({ item, scale, drag, setDrag }) {
  const T = useT();
  const sel = useDesigner(s => s.sel);
  const base = useDesigner(s => s.def.styles?.base);
  const readOnly = useDesigner(s => s.readOnly);
  const tableSelected = sel.kind === 'items' && sel.ids.includes(item.id);
  const onGrip = useItemDrag(item, scale, setDrag);
  const keys = useItemKeys(item);
  const r = rectOf(item, drag);
  const widths = item.columns.map((c, i) => (drag?.mode === 'col' && drag.id === item.id && drag.col === i ? drag.w : c.width));
  const [dropCell, setDropCell] = useState(null);
  const [menu, setMenu] = useState(null); // { x, y, part, row, col }: the cell's right-click menu
  const problems = useContext(IssueMap).get(item.id);
  const tblRef = useRef(null);
  const chosen = sel.kind === 'cell' && sel.id === item.id ? selCells(sel) : [];
  useEffect(() => {
    if (!menu) return undefined;
    // composedPath: inside the embed's shadow root e.target is the host element, never the menu
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !e.composedPath().some(n => n.classList?.contains('cell-menu'))) setMenu(null); };
    window.addEventListener('pointerdown', close, true); window.addEventListener('keydown', close);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', close); };
  }, [menu]);

  /** A cell click: one cell; Shift: the range from the anchor; Cmd/Ctrl: add or remove it; a drag: the rectangle it covers. */
  const cellDown = (part, ri, ci) => (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection across cells
    e.currentTarget.closest('[data-item-key]')?.focus({ preventScroll: true }); // the keys go to this designer
    const st = useDesigner.getState();
    const here = { part, row: ri, col: ci };
    const cur = st.sel.kind === 'cell' && st.sel.id === item.id ? st.sel : null;
    if (e.shiftKey && cur) { const a = cur.anchor || cur; selectCells(item.id, cellRange(item, a, here), a); return; }
    if ((e.metaKey || e.ctrlKey) && cur) {
      const list = selCells(cur);
      const next = list.some(c => same(c, here)) ? list.filter(c => !same(c, here)) : [...list, here];
      if (next.length) selectCells(item.id, next, cur.anchor);
      return;
    }
    selectCells(item.id, [here], here);
    const root = e.currentTarget.getRootNode();
    const move = (ev) => { const c = cellOf(root.elementFromPoint?.(ev.clientX, ev.clientY)); if (c && !same(c, here)) selectCells(item.id, cellRange(item, here, c), here); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const onMenu = (part, ri, ci) => (e) => {
    e.preventDefault(); e.stopPropagation();
    if (readOnly) return;
    const here = { part, row: ri, col: ci };
    if (!chosen.some(c => same(c, here))) selectCells(item.id, [here], here);
    const b = tblRef.current.getBoundingClientRect();
    setMenu({ x: e.clientX - b.left, y: e.clientY - b.top, ...here });
  };
  const menuDo = (fn) => () => { setMenu(null); fn(); };
  const fieldOfCol = (ci) => /^=Fields\.(\w+)$/.exec(item.detail?.[0]?.cells?.[ci]?.value || '')?.[1];

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
      } else if ((part === 'footer' || /^g\d+[hf]$/.test(part)) && f.type === 'number') { // a group header sums its group too
        cell.value = `=Sum(Fields.${f.field})`;
        cell.style = { ...(cell.style || {}), ...fieldStyle(f) };
      }
      else cell.value = `=Fields.${f.field}`;
    });
    useDesigner.getState().select({ kind: 'cell', id: item.id, part, row: ri, col: ci });
  };

  let first = true;
  return (
    <div ref={tblRef} className={`tbl${tableSelected ? ' sel' : ''}${problems ? ' issue' : ''}`} data-item={item.name} style={{ left: r.x * scale, top: r.y * scale }} {...keys}>
      {problems && <div className="issue-tag" title={problems.join('\n')} aria-label={problems.join('. ')}>!</div>}
      <div className="grip" title="Select or move the table" onPointerDown={onGrip}>⠿</div>
      <div className="col-handles" aria-label={T('ux_columns')} role="group">
        {widths.map((w, ci) => <button type="button" key={ci} className="col-handle" style={{ width: w * scale }} data-col-handle={ci} title={T('ux_selectColumn', { n: ci + 1 })} aria-label={T('ux_selectColumn', { n: ci + 1 })}
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); const cur = useDesigner.getState().sel; const add = (e.shiftKey || e.metaKey || e.ctrlKey) && cur.kind === 'cell' && cur.id === item.id; selectCells(item.id, [...(add ? selCells(cur) : []), ...columnCells(item, ci)]); }} />)}
      </div>
      {menu && <div className="cell-menu" role="menu" style={{ left: menu.x, top: menu.y }} data-testid="cell-menu">
        <button role="menuitem" onClick={menuDo(() => tableInsertRow(item.id, menu.part, menu.row))}>{T('i_rowAbove')}</button>
        <button role="menuitem" onClick={menuDo(() => tableInsertRow(item.id, menu.part, menu.row + 1))}>{T('i_rowBelow')}</button>
        <button role="menuitem" onClick={menuDo(() => tableInsertColumn(item.id, menu.col))}>{T('i_colLeft')}</button>
        <button role="menuitem" onClick={menuDo(() => tableInsertColumn(item.id, menu.col + 1))}>{T('i_colRight')}</button>
        <hr />
        {fieldOfCol(menu.col) && <button role="menuitem" onClick={menuDo(() => tableAddGroup(item.id, fieldOfCol(menu.col)))}>{T('ux_groupByField', { field: fieldOfCol(menu.col) })}</button>}
        <button role="menuitem" onClick={menuDo(() => tableMergeRight(item.id, menu.part, menu.row, menu.col))}>{T('i_mergeRight')}</button>
        <button role="menuitem" onClick={menuDo(() => updateItem(item.id, t => { for (const c of selCells(useDesigner.getState().sel)) { const x = rowsOf(t, c.part)?.[c.row]?.cells?.[c.col]; if (x) x.value = ''; } }))}>{T('ux_clearCells')}</button>
        <button role="menuitem" onClick={menuDo(() => requestAnimationFrame(() => { const el = tblRef.current?.getRootNode().querySelector('[data-testid=inspector] [data-prop=format] input'); el?.scrollIntoView({ block: 'center' }); el?.focus(); }))}>{T('ux_formatCells')}</button>
        <hr />
        <button role="menuitem" className="danger" onClick={menuDo(() => { tableDeleteRow(item.id, menu.part, menu.row); useDesigner.getState().select({ kind: 'items', ids: [item.id] }); })}>{T('i_delRow')}</button>
        <button role="menuitem" className="danger" onClick={menuDo(() => { tableDeleteColumn(item.id, menu.col); useDesigner.getState().select({ kind: 'items', ids: [item.id] }); })}>{T('i_delColumn')}</button>
      </div>}
      {tableParts(item).map(({ part, tag }) => { const prows = rowsOf(item, part) || []; const down = {}; return prows.map((row, ri) => {
        const rowStyle = row.style;
        const isFirst = first; first = false;
        let ci = 0;
        const cells = [];
        while (ci < item.columns.length) {
          const cell = row.cells?.[ci];
          // a cell merged down from a row above: keep its place, draw nothing
          if (down[ci]?.left > 0) {
            const d = down[ci]; d.left--;
            cells.push(<div key={ci} className="cell" style={{ width: widths.slice(ci, ci + d.span).reduce((a, b) => a + b, 0) * scale, visibility: 'hidden' }} />);
            ci += d.span;
            continue;
          }
          const span = Math.max(1, Math.min(cell?.colSpan || 1, item.columns.length - ci));
          const w = widths.slice(ci, ci + span).reduce((a, b) => a + b, 0);
          const rs = Math.max(1, Math.min(cell?.rowSpan || 1, prows.length - ri));
          if (rs > 1) down[ci] = { left: rs - 1, span };
          const tall = rs > 1 ? { height: prows.slice(ri, ri + rs).reduce((a, r) => a + (r.height || 18), 0) * scale, alignSelf: 'flex-start', position: 'relative', zIndex: 1 } : null;
          const c = textCss([base, item.style, rowStyle, cell?.style], scale, false);
          const isSel = chosen.some(c => c.part === part && c.row === ri && c.col === ci);
          const col = ci;
          cells.push(
            <div key={ci} className={`cell${isSel ? ' sel' : ''}${dropCell === `${part}${ri}${col}` ? ' drop' : ''}`}
              style={{ width: w * scale, ...c.box, ...tall }} data-cell={`${part}-${ri}-${col}`}
              onPointerDown={cellDown(part, ri, col)} onContextMenu={onMenu(part, ri, col)}
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
            <div className="row-tag" title={T('ux_selectRow')} data-row-handle={`${part}-${ri}`}
              onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); const cur = useDesigner.getState().sel; const add = (e.shiftKey || e.metaKey || e.ctrlKey) && cur.kind === 'cell' && cur.id === item.id; selectCells(item.id, [...(add ? selCells(cur) : []), ...rowCells(item, part, ri)]); }}>{tag}</div>
            {cells}
          </div>
        );
      }); })}
    </div>
  );
}

export { findItem };
