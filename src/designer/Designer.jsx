'use client';
import { readReportFile } from './importFile.js';
import { declareDocumentStyles } from '../embed/styles.js';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from './ui.jsx';
import Link from 'next/link';
import { useDesigner, useDesignerStore, newDesignerStore, activateStore, DesignerStore, insertItem, insertSpot, deleteSelection, duplicateSelection, moveItems, copySelection, pasteItems, alignItems, selectedBand, selectAllItems, cutSelection } from './store.js';
import Canvas, { MIME_TOOL, useDesignIssues, issueLine } from './Canvas.jsx';
import Inspector from './Inspector.jsx';
import DataPanel, { loadSample } from './DataPanel.jsx';
import Outline from './Outline.jsx';
import ReportViewer from '@/viewer/ReportViewer.jsx';
import { ITEMS } from '@/engine/items/index.js';
import { fontFaceCss } from '@/exporters/svg.js';
import { allFontKeys, optionalMissing } from '@/engine/text/fonts.js';
import { customFonts, fontsBase } from '@/viewer/engineClient.js';
import { setFetchPolicy } from '@/viewer/dataFetch.js';
import ThemeToggle from '@/theme/ThemeToggle.jsx';
import ChartWizard from './ChartWizard.jsx';
import TableWizard from './TableWizard.jsx';
import AskAi from './AskAi.jsx';
import { PartsPanel, LayersPanel } from './Reuse.jsx';
import PivotWizard, { InstantVisuals } from './PivotWizard.jsx';
import { t, dirOf, pickLang } from '@/i18n/index.js';
import { Icon } from '@/viewer/icons.jsx';
import { sectionList, findItem, bodyWidth, nudgeStep, pageOf, secOf, bodyKeyOf } from './store.js';
import { resolvePage } from '@/engine/units.js';
import { readDraft, writeDraft, clearDraft, clearDrafts, mergeDraft, staleDraft } from './draft.js';

const TOOLS = [
  { type: 'textbox', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 3h10M7 3v9" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg> },
  { type: 'richtext', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 3h6M5 3v8" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M8.5 7.5h4M8.5 10h4M8.5 12.5h2.5" stroke="currentColor" strokeWidth="1.1" /></svg> },
  { type: 'table', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="2" width="11" height="10" rx="1" stroke="currentColor" fill="none" /><path d="M1.5 5.5h11M1.5 8.7h11M5.5 2v10" stroke="currentColor" fill="none" /></svg> },
  { type: 'image', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="2" width="11" height="10" rx="1" stroke="currentColor" fill="none" /><path d="M2 11l3.5-4 3 3 1.5-1.5L12 11" stroke="currentColor" fill="none" /></svg> },
  { type: 'line', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 12L12 2" stroke="currentColor" strokeWidth="1.6" /></svg> },
  { type: 'shape', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="3" width="10" height="8" rx="2" stroke="currentColor" fill="none" strokeWidth="1.4" /></svg> },
  { type: 'list', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="4.5" rx="1" stroke="currentColor" fill="none" /><rect x="1.5" y="8" width="11" height="4.5" rx="1" stroke="currentColor" fill="none" strokeDasharray="2 1.5" /></svg> },
  { type: 'container', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" fill="none" strokeDasharray="2.5 1.5" /></svg> },
  { type: 'chart', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 12V7M5.5 12V3M9 12V6M12.5 12V9" stroke="currentColor" strokeWidth="2" /></svg> },
  { type: 'matrix', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="11" rx="1" stroke="currentColor" fill="none" /><path d="M1.5 5h11M5 1.5v11M8.7 5v7.5M5 8.7h7.5" stroke="currentColor" fill="none" /></svg> },
  { type: 'barcode', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2v10M4 2v10M5.5 2v10M8 2v10M9.5 2v10M12 2v10" stroke="currentColor" strokeWidth="1.2" /></svg> },
  { type: 'sparkline', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 10l3-4 3 3 3-6 3 4" stroke="currentColor" fill="none" strokeWidth="1.4" /></svg> },
  { type: 'databar', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="4" width="9" height="6" rx="1" fill="currentColor" /></svg> },
  { type: 'bullet', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="4" width="12" height="6" fill="none" stroke="currentColor" /><rect x="1" y="5.8" width="7" height="2.4" fill="currentColor" /><path d="M10 3v8" stroke="currentColor" strokeWidth="1.5" /></svg> },
  { type: 'iconset', icon: <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="3" cy="7" r="2.2" fill="currentColor" /><circle cx="7" cy="7" r="2.2" fill="none" stroke="currentColor" /><path d="M10 9.5l1.8-5 1.8 5z" fill="currentColor" /></svg> },
  { type: 'rangebar', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="5.5" width="12" height="3" rx="1" fill="none" stroke="currentColor" /><rect x="4" y="4" width="5.5" height="6" rx="1" fill="currentColor" /></svg> },
  { type: 'subreport', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="11" rx="1" stroke="currentColor" fill="none" /><rect x="4" y="5" width="7" height="5" stroke="currentColor" fill="none" /></svg> },
  { type: 'toc', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 3h7M2 7h7M2 11h7" stroke="currentColor" strokeWidth="1.3" /><path d="M11 3h1M11 7h1M11 11h1" stroke="currentColor" strokeWidth="1.3" /></svg> },
  { type: 'field', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="3.5" width="11" height="7" rx="1" stroke="currentColor" fill="none" /><path d="M4 5.5v3" stroke="currentColor" /></svg> },
  { type: 'map', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M1.5 3.5l3.5-1.5 4 1.5 3.5-1.5v8.5l-3.5 1.5-4-1.5-3.5 1.5z" stroke="currentColor" fill="none" strokeLinejoin="round" /><path d="M5 2v8.5M9 3.5V12" stroke="currentColor" /></svg> },
  { type: 'placeholder', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="11" rx="1" stroke="currentColor" fill="none" strokeDasharray="2 1.5" /><path d="M4.5 7h5M7 4.5v5" stroke="currentColor" /></svg> },
  { type: 'overflow', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="11" rx="1" stroke="currentColor" fill="none" strokeDasharray="2 1.5" /><path d="M4 5h6M4 7.5h6M7 9.5l-1.5 1.5M7 9.5l1.5 1.5" stroke="currentColor" fill="none" /></svg> },
  { type: 'checkbox', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" fill="none" /><path d="M4.5 7.2l1.8 1.8 3.4-3.6" stroke="currentColor" fill="none" strokeWidth="1.4" /></svg> },
];

function Toolbox({ T, hide = [] }) {
  const api = useDesignerStore();
  const name = (type) => (T(`item_${type}`) === `item_${type}` ? ITEMS[type].label : T(`item_${type}`));
  // a selected list or container takes the new item; otherwise the selected band, or the band of the selected item (#12)
  const add = (type) => {
    const s = api.getState();
    const at = insertSpot(s.def, s.sel, type);
    insertItem(type, at.section, 0, at.y, {}, at.parentId);
  };
  return (
    <div className="pane">
      <h4>{T('insert')}</h4>
      <div className="pane-body tools">
        {TOOLS.filter(t => !hide.includes(t.type)).map(t => (
          <div key={t.type} className="tool" draggable role="button" tabIndex={0} data-tool={t.type}
            title={`${name(t.type)} · ${T('toolHint')}`}
            onDragStart={(e) => { e.dataTransfer.setData(MIME_TOOL, t.type); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => add(t.type)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(t.type); } }}>
            {t.icon}<span className="tool-nm">{name(t.type)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// drawn, not the ↶ ↷ characters: the UI font has no such glyphs and the fallback looked like an empty box
const UNDO_ICON = <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M4.5 3L1.8 5.7l2.7 2.7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M2.2 5.7h6.3a3.3 3.3 0 0 1 0 6.6H6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>;
const REDO_ICON = <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ transform: 'scaleX(-1)' }}><path d="M4.5 3L1.8 5.7l2.7 2.7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M2.2 5.7h6.3a3.3 3.3 0 0 1 0 6.6H6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>;
/** A labelled group of the top bar: its buttons, and the group's name under them (File, Insert, Arrange, View, Preview). */
const TbGroup = ({ label, children }) => (
  <div className="tb-group" role="group" aria-label={label}>
    <div className="tb-items">{children}</div>
    <span className="tb-cap" aria-hidden="true">{label}</span>
  </div>
);
const QUICK = [['textbox', 'text'], ['table', 'table'], ['chart', 'chart'], ['image', 'image']];

/** The left rail: Toolbox, Data and Outline. A tab shows its section at the top; scrolling marks the section in view. */
function LeftRail({ T, readOnly, embed }) {
  const body = useRef(null);
  const [at, setAt] = useState('tools');
  const tabs = [!readOnly && ['tools', 'b2_toolbox', 'tools'], embed?.panels?.data !== false && ['data', 'b2_data', 'data'], ['outline', 'b2_outline', 'outline']].filter(Boolean);
  const go = (id) => {
    const el = body.current?.querySelector(`[data-rail="${id}"]`);
    if (el) {
      body.current.scrollTo({ top: el.offsetTop - body.current.offsetTop, behavior: 'smooth' });
      // the keyboard goes along: to the outline's current row, else the section's first control (N35: no long Tab walk)
      (el.querySelector('[data-opt][tabindex="0"]') || el.querySelector('button, input, select, textarea'))?.focus({ preventScroll: true });
    }
    setAt(id);
  };
  const spy = () => {
    const b = body.current;
    if (!b) return;
    let cur = tabs[0]?.[0];
    for (const [id] of tabs) { const el = b.querySelector(`[data-rail="${id}"]`); if (el && el.offsetTop - b.offsetTop <= b.scrollTop + 24) cur = id; }
    if (b.scrollTop + b.clientHeight >= b.scrollHeight - 2) cur = tabs[tabs.length - 1][0];
    setAt(cur);
  };
  return (
    <>
      <nav className="rail" aria-label={T('b2_panels')}>
        {tabs.map(([id, key, icon]) => (
          <button key={id} type="button" className="rail-tab" aria-current={at === id ? 'true' : undefined} onClick={() => go(id)} title={T(key)} data-testid={`rail-${id}`}>
            <Icon name={icon} size={18} /><span>{T(key)}</span>
          </button>
        ))}
      </nav>
      <div className="rail-body" ref={body} onScroll={spy}>
        {!readOnly && <section data-rail="tools"><Toolbox T={T} hide={embed?.toolbox?.hide} /><PartsPanel /></section>}
        {embed?.panels?.data !== false && <section data-rail="data"><DataPanel /></section>}
        {readOnly && <PartsPanel />}
        <section data-rail="outline"><LayersPanel /><Outline /></section>
      </div>
    </>
  );
}

/** The status bar under the canvas: zoom, what is selected, the page. */
function StatusBar({ T, zoom, setZoom }) {
  const sel = useDesigner(s => s.sel);
  const def = useDesigner(s => s.def);
  const unit = useDesigner(s => s.unit);
  let what;
  if (sel.kind === 'items' && sel.ids.length > 1) what = T('b2_selItems', { n: sel.ids.length });
  else if (sel.kind === 'items') { const it = findItem(def, sel.ids[0])?.item; what = it ? `${it.name} · ${T(`item_${it.type}`) === `item_${it.type}` ? (ITEMS[it.type]?.label || it.type) : T(`item_${it.type}`)} · ${Math.round(it.x)}, ${Math.round(it.y)} · ${Math.round(it.w)} × ${Math.round(it.h)} pt` : ''; }
  else if (sel.kind === 'cell') what = T('b2_selCell', { name: findItem(def, sel.id)?.item?.name || '' });
  else if (sel.kind === 'section') what = T('b2_selBand', { band: sectionList(def).find(x => x.key === sel.section)?.label || sel.section });
  else what = T('b2_selReport');
  let page = '';
  try {
    // #16: the page of the selected body section (a landscape section has its own), else the report's
    const key = sel.kind === 'section' ? sel.section : sel.kind === 'items' ? findItem(def, sel.ids[0])?.section : sel.kind === 'cell' ? findItem(def, sel.id)?.section : null;
    const own = key && bodyKeyOf(key) && Array.isArray(def.sections?.body) ? secOf(def, bodyKeyOf(key))?.page : null;
    const pg = own ? pageOf(def, key) : resolvePage(def.page);
    const size = `${own?.size || def.page?.size || ''}${pg.width > pg.height && !pg.pageless ? ` ${T('ux_landscape')}` : ''}`;
    const k = { pt: 1, mm: 25.4 / 72, cm: 2.54 / 72, in: 1 / 72 }[unit] || 1;
    const r = (v) => Math.round(v * k * (unit === 'pt' ? 1 : 10)) / (unit === 'pt' ? 1 : 10);
    page = pg.pageless ? `${def.page?.size || 'Pageless'} · ${r(bodyWidth(def, 'body'))} ${unit}` : T('b2_pageInfo', { size, w: r(pg.width), h: r(pg.height), unit });
  } catch { /* an unknown size: the Inspector says so */ }
  const step = (dir) => { const z = zoom === 'fit' ? 1 : zoom; const next = dir > 0 ? ZOOMS.find(x => x > z) : [...ZOOMS].reverse().find(x => x < z); if (next) setZoom(next); };
  return (
    <div className="dstatus" aria-label={T('b2_status')}>
      <span className="dstatus-zoom">
        <button type="button" className="btn sm icon ghost" title={T('zoomOut')} aria-label={T('zoomOut')} onClick={() => step(-1)} disabled={zoom !== 'fit' && zoom <= ZOOMS[0]}><Icon name="zoomOut" /></button>
        <select className="select" aria-label={T('zoom')} value={zoom} data-testid="zoom" onChange={e => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
          <option value="fit">{T('zoomFit')}</option>
          {ZOOMS.map(z => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
        </select>
        <button type="button" className="btn sm icon ghost" title={T('zoomIn')} aria-label={T('zoomIn')} onClick={() => step(1)} disabled={zoom !== 'fit' && zoom >= ZOOMS[ZOOMS.length - 1]}><Icon name="zoomIn" /></button>
      </span>
      <span className="dstatus-sel" data-testid="status-selection"><i aria-hidden="true" />{what}</span>
      <span className="hint dstatus-hint" title={T('canvasHint')}>{T('canvasHint')}</span>
      <span className="dstatus-page">{page}</span>
    </div>
  );
}

/** The zoom the user picked last (this browser only); "fit" fills the canvas width. */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
function savedZoom() { try { const z = localStorage.getItem('pw.designer.zoom'); return z === 'fit' ? 'fit' : ZOOMS.includes(Number(z)) ? Number(z) : null; } catch { return null; } }
function keepZoom(z) { try { localStorage.setItem('pw.designer.zoom', String(z)); } catch { /* private window */ } }

/* ---- autosave: a draft of unsaved changes in this browser (no secrets, per user: draft.js), offered back on the next open ---- */
const AUTOSAVE_MS = 10000;
/** The definition without the designer's own ids, to compare a draft with what the server has. */
const plain = (d) => JSON.stringify(d, (k, v) => (k === 'id' ? undefined : v));
const framed = () => { try { return window.self !== window.top; } catch { return true; } };

/** Unsaved changes are kept as a draft every few seconds (and when the page goes away); "Restore" brings them back. */
function useAutosave(id, T, lang, user) {
  const api = useDesignerStore();
  const [offer, setOffer] = useState(null); // { at, def }: a draft newer than the saved report
  useEffect(() => {
    if (!id || user == null || framed()) return undefined; // the page names the signed-in user; never inside another site's page
    let store;
    try { store = window.localStorage; } catch { return undefined; }
    clearDrafts(store, user); // another user's drafts in this browser go (and expired ones)
    const d = readDraft(store, user, id);
    if (d && plain(mergeDraft(d.def, api.getState().def)) !== plain(api.getState().def)) setOffer(d); else if (d) clearDraft(store, user, id);
    const keep = () => { const s = api.getState(); if (!s.saved && !s.readOnly) writeDraft(store, user, id, s.def, Date.now(), s.rev || null); };
    const t = setInterval(keep, AUTOSAVE_MS);
    const hide = () => { if (document.visibilityState === 'hidden') keep(); };
    window.addEventListener('pagehide', keep);
    document.addEventListener('visibilitychange', hide);
    const unsub = api.subscribe((s, prev) => { if (s.saved && !prev.saved) clearDraft(store, user, id); }); // saved: no draft needed
    return () => { clearInterval(t); window.removeEventListener('pagehide', keep); document.removeEventListener('visibilitychange', hide); unsub(); };
  }, [id, user]);
  if (!offer) return null;
  const when = new Date(offer.at).toLocaleString(lang === 'en' ? 'en-IN' : lang, { dateStyle: 'medium', timeStyle: 'short' });
  // made on an older revision: the report was saved again after these changes; restoring and saving would replace it
  const stale = staleDraft(offer, api.getState().rev);
  return (
    <div className="draft-bar" role="alert" data-testid="draft-offer" data-stale={stale || undefined}>
      <span>{T(stale ? 'ux_draftStale' : 'ux_draftFound', { when })}</span>
      <button className={`btn sm${stale ? '' : ' primary'}`} data-testid="draft-restore" onClick={() => { const d = mergeDraft(offer.def, api.getState().def); api.getState().apply(() => JSON.parse(JSON.stringify(d))); api.getState().fixSelection(); setOffer(null); }}>{T(stale ? 'ux_draftRestoreAnyway' : 'ux_draftRestore')}</button>
      <button className="btn sm" data-testid="draft-discard" onClick={() => { try { clearDraft(window.localStorage, user, id); } catch { /* no storage */ } setOffer(null); }}>{T('ux_draftDiscard')}</button>
    </div>
  );
}

/** A save that met someone else's newer save (409): nothing was overwritten; the user chooses. */
function ConflictBar({ T }) {
  const api = useDesignerStore();
  const conflict = useDesigner(s => s.conflict);
  if (!conflict) return null;
  return (
    <div className="draft-bar" role="alert" data-testid="save-conflict">
      <span>{T('ux_conflict')}</span>
      <button className="btn sm" data-testid="conflict-mine" onClick={() => api.getState().save({ overwrite: true })}>{T('ux_conflictMine')}</button>
      <button className="btn sm" data-testid="conflict-theirs" onClick={() => api.getState().takeTheirs()}>{T('ux_conflictTheirs')}</button>
    </div>
  );
}

const AL = (d) => <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">{d}</svg>;
const ALIGN = [
  ['left', 'ux_alignLeft', AL(<><path d="M1.5 1v12" stroke="currentColor" /><rect x="3" y="3" width="9" height="3" fill="currentColor" /><rect x="3" y="8" width="5" height="3" fill="currentColor" /></>)],
  ['hcenter', 'ux_alignHCenter', AL(<><path d="M8 1v12" stroke="currentColor" /><rect x="3" y="3" width="10" height="3" fill="currentColor" opacity=".8" /><rect x="5" y="8" width="6" height="3" fill="currentColor" opacity=".8" /></>)],
  ['right', 'ux_alignRight', AL(<><path d="M14.5 1v12" stroke="currentColor" /><rect x="4" y="3" width="9" height="3" fill="currentColor" /><rect x="8" y="8" width="5" height="3" fill="currentColor" /></>)],
  ['top', 'ux_alignTop', AL(<><path d="M1 1.5h14" stroke="currentColor" /><rect x="3" y="3" width="3" height="9" fill="currentColor" /><rect x="9" y="3" width="3" height="5" fill="currentColor" /></>)],
  ['vmiddle', 'ux_alignVMiddle', AL(<><path d="M1 7h14" stroke="currentColor" /><rect x="3" y="2" width="3" height="10" fill="currentColor" opacity=".8" /><rect x="9" y="4" width="3" height="6" fill="currentColor" opacity=".8" /></>)],
  ['bottom', 'ux_alignBottom', AL(<><path d="M1 12.5h14" stroke="currentColor" /><rect x="3" y="2" width="3" height="9" fill="currentColor" /><rect x="9" y="6" width="3" height="5" fill="currentColor" /></>)],
  ['hdist', 'ux_distH', AL(<><rect x="1" y="4" width="3" height="6" fill="currentColor" /><rect x="6.5" y="4" width="3" height="6" fill="currentColor" /><rect x="12" y="4" width="3" height="6" fill="currentColor" /></>)],
  ['vdist', 'ux_distV', AL(<><rect x="4" y="0.5" width="8" height="3" fill="currentColor" /><rect x="4" y="5.5" width="8" height="3" fill="currentColor" /><rect x="4" y="10.5" width="8" height="3" fill="currentColor" /></>)],
  ['width', 'ux_sameWidth', AL(<><path d="M1 7h14M1 5v4M15 5v4" stroke="currentColor" /></>)],
  ['height', 'ux_sameHeight', AL(<><path d="M8 1v12M6 1h4M6 13h4" stroke="currentColor" /></>)],
];
/** Align, distribute and size the selected items (to each other, or to the page), from the canvas bar. */
function AlignBar({ T }) {
  const sel = useDesigner(s => s.sel);
  const [toPage, setToPage] = useState(false);
  if (sel.kind !== 'items' || !sel.ids.length) return null;
  const n = sel.ids.length;
  return (
    <span className="align-bar" role="toolbar" aria-label={T('ux_alignBar')} data-testid="align-bar">
      {ALIGN.map(([how, key, icon]) => {
        const off = (how === 'hdist' || how === 'vdist') ? n < 3 : (how === 'width' || how === 'height') ? n < 2 : false;
        return <button key={how} type="button" className="btn sm icon" disabled={off} title={T(key)} aria-label={T(key)} onClick={() => alignItems(sel.ids, how, toPage)} data-align={how}>{icon}</button>;
      })}
      {n > 1 && <label className="check" title={T('ux_toPageHint')}><input type="checkbox" checked={toPage} onChange={e => setToPage(e.target.checked)} data-testid="align-to-page" />{T('ux_toPage')}</label>}
    </span>
  );
}

/** The design problems of the report (overlaps, wider than the page, unknown fields): a count, and a list to jump from. */
function IssuesButton({ T }) {
  const api = useDesignerStore();
  const issues = useDesignIssues();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!issues.length) setOpen(false); }, [issues.length]);
  // the list opens under its button: moved left or right as far as it takes to stay inside the window (8 px margin)
  const listRef = useRef(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const place = () => {
      el.style.translate = '0px';
      const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      const dx = r.right > vw - 8 ? vw - 8 - r.right : r.left < 8 ? 8 - r.left : 0;
      el.style.translate = `${Math.round(dx)}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, issues.length]);
  if (!issues.length) return <span className="hint" data-testid="issues-none">{T('ux_noIssues')}</span>;
  return (
    <span className="issues-wrap">
      <button type="button" className="btn sm issues-btn" aria-expanded={open} onClick={() => setOpen(v => !v)} data-testid="issues">{T('ux_issues', { n: issues.length })}</button>
      {open && <ul className="issues-list" data-testid="issues-list" ref={listRef}>
        {issues.map((i, k) => <li key={k}><button type="button" className="linklike" onClick={() => { if (i.id) api.getState().select({ kind: 'items', ids: [i.id] }); }}>{issueLine(T, i)}</button></li>)}
      </ul>}
    </span>
  );
}

function isTyping(e) {
  // inside a shadow root (the embed) e.target is the host element: the real target is the first in the path
  const t = e.composedPath?.()[0] || e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

const SHORTCUTS = [
  ['⌘/Ctrl S', 'sc_save'], ['⌘/Ctrl Z', 'sc_undo'], ['⇧⌘/Ctrl Z, ⌘/Ctrl Y', 'sc_redo'], ['⌘/Ctrl C / X / V', 'sc_copy'],
  ['⌘/Ctrl A', 'selectAll'], ['⌘/Ctrl D', 'sc_duplicate'], ['Delete / Backspace', 'sc_delete'], ['← ↑ → ↓', 'c132_nudge1'], ['⇧ ← ↑ → ↓', 'c132_nudge10'],
  ['⇧ Click', 'sc_toggle'], ['Drag', 'sc_marquee'], ['Alt + Drag', 'sc_guides'],
  ['Esc', 'sc_clear'], ['?', 'sc_help'],
];

function HistoryDialog({ id, onClose, T, lang }) {
  const api = useDesignerStore();
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { fetch(`/api/reports/${id}/versions`).then(r => r.json()).then(setList).catch(e => setErr(e.message)); }, [id]);
  const restore = async (v) => {
    const res = await fetch(`/api/reports/${id}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: v }) });
    if (!res.ok) { setErr((await res.json()).error); return; }
    const def = await res.json();
    api.getState().init(id, def);
    onClose();
  };
  return (
    <Dialog title={T('versionHistory')} onClose={onClose} footer={<button className="btn" onClick={onClose}>{T('close')}</button>}>
      <div className="hint">{T('versionHint')}</div>
      {err && <div className="err">{err}</div>}
      {!list && !err && <div className="hint">{T('loading')}</div>}
      {list && !list.length && <div className="hint">{T('noVersions')}</div>}
      {list?.map(v => (
        <div className="ver-row" key={v.version}>
          <span>{new Date(v.savedAt).toLocaleString(lang === 'en' ? 'en-IN' : lang, { dateStyle: 'medium', timeStyle: 'medium' })} <span className="hint">· {(v.bytes / 1024).toFixed(1)} KB</span></span>
          <span className="btnrow">
            <button className="btn sm" onClick={() => restore(v.version)}>{T('restore')}</button>
          </span>
        </div>
      ))}
    </Dialog>
  );
}

/**
 * @param {{ id?: string, initial: object, rev?: string|null, lang?: string, embed?: { onSave?: (def: import('@reportwright/engine/report').Report) => any, onOpen?: () => any, readOnly?: boolean,
 *   toolbox?: { hide?: string[] }, panels?: { data?: boolean, inspector?: boolean }, dataSourceTemplates?: object[], server?: string } }} props
 *   embed: set by mountDesigner (another site); none on ReportWright's own pages
 */
export default function Designer({ store: storeIn = null, allowHosts = null, ...props }) {
  // its own store (N17: two designers on a page shared one), active from its first render and on every event in it
  // allowHosts: the app's designer page passes PW_INTERNAL_HOSTS, which designers' data may reach (as in server renders);
  // the embedded designer sets its policy from mountDesigner's options instead
  const [store] = useState(() => { if (allowHosts) setFetchPolicy({ allowHosts }); const s = storeIn || newDesignerStore(); activateStore(s); return s; });
  return <DesignerStore.Provider value={store}><DesignerIn {...props} /></DesignerStore.Provider>;
}
/** Events that may change a designer's state: each makes this designer's store the active one first (capture phase). */
const ACTIVATE = ['onPointerDownCapture', 'onMouseDownCapture', 'onKeyDownCapture', 'onFocusCapture', 'onClickCapture', 'onInputCapture', 'onChangeCapture',
  'onDragStartCapture', 'onDragOverCapture', 'onDropCapture', 'onPasteCapture', 'onWheelCapture', 'onContextMenuCapture', 'onDoubleClickCapture', 'onSubmitCapture'];

function DesignerIn({ id, initial, rev = null, lang: langIn, embed = null, user = null, ai = false }) {
  const api = useDesignerStore();
  const activators = useMemo(() => { const on = () => activateStore(api); return Object.fromEntries(ACTIVATE.map(k => [k, on])); }, [api]);
  const lang = pickLang(langIn);
  const T = (k, v) => t(lang, k, v);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  const ready = useRef(false);
  if (!ready.current && typeof window !== 'undefined') { api.getState().init(id, initial); api.getState().setUi({ lang, embed, readOnly: !!embed?.readOnly, rev, conflict: null }); ready.current = true; }
  const readOnly = !!embed?.readOnly;
  const rootRef = useRef(null);
  const def = useDesigner(s => s.def);
  const tab = useDesigner(s => s.tab);
  const saved = useDesigner(s => s.saved);
  const saving = useDesigner(s => s.saving);
  const saveError = useDesigner(s => s.saveError);
  const zoom = useDesigner(s => s.zoom);
  const snap = useDesigner(s => s.snap);
  const unit = useDesigner(s => s.unit);
  // every report font, bundled and uploaded: the canvas draws text boxes as HTML in them (the browser only
  // downloads the ones it uses, e.g. Noto Sans Devanagari once there is Hindi on the page)
  const fonts = useDesigner(s => s.fonts);
  const fontCss = useMemo(() => fontFaceCss(allFontKeys().filter(k => !optionalMissing(k)), fontsBase().replace(/\/$/, '')), [fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  // embedded: @font-face is ignored inside a shadow root, so the report fonts are declared on the host document
  useEffect(() => { if (embed) declareDocumentStyles('pw-designer-fonts', fontCss); }, [embed, fontCss]);
  useEffect(() => { customFonts().then(list => api.getState().setUi({ fonts: list })); }, []);
  useEffect(() => { const z = savedZoom(); if (z != null) api.getState().setUi({ zoom: z }); }, []);
  const canUndo = useDesigner(s => s.past.length > 0);
  const canRedo = useDesigner(s => s.future.length > 0);
  const st = api.getState;
  const [dialog, setDialog] = useState(null);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const selKind = useDesigner(s => s.sel.kind);
  const wizard = useDesigner(s => s.wizard);
  const tableWizard = useDesigner(s => s.tableWizard);
  const pivotWizard = useDesigner(s => s.pivotWizard);
  const instantVisuals = useDesigner(s => s.instantVisuals);
  const cells = useDesigner(s => s.cells);
  const cellSize = useDesigner(s => s.cellSize);

  // sample data again whenever a data source or data set comes or goes (a report part brings its own)
  const dataKey = useDesigner(s => `${(s.def?.dataSources || []).map(x => x.name)}|${(s.def?.dataSets || []).map(x => x.name)}`);
  useEffect(() => { loadSample(api); }, [dataKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Embedded: only keys typed inside the designer, never the host page's. A click that leaves the focus nowhere (a band
    // label, a matrix, a drill-through link in Preview that re-renders) puts it on <body>: a key there belongs to the
    // designer clicked last, so Esc and Ctrl+S still work after it.
    let lastInside = false;
    const inside = (e) => (e.composedPath?.() || []).includes(rootRef.current);
    const onDown = (e) => { lastInside = inside(e); };
    const ours = (e) => inside(e) || (lastInside && (e.target === document.body || e.target === document.documentElement));
    const onKey = (e) => {
      if (embed && !ours(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // a dialog open (a parameter, data set…): its own Save first, so the report is saved with what it holds
        const dlg = rootRef.current?.querySelector('.dialog');
        const ok = dlg?.querySelector('footer .btn.primary');
        if (dlg && ok?.disabled) { st().setUi({ saveError: t(lang, 'ux_saveDialogInvalid') }); setTimeout(() => st().setUi({ saveError: null }), 4000); return; }
        if (ok) { ok.click(); setTimeout(() => st().save(), 0); return; }
        st().save();
        return;
      }
      if (isTyping(e) || st().tab !== 'design' || e.defaultPrevented) return; // handled already (the outline's arrows)
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st().redo() : st().undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st().redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (mod && e.key.toLowerCase() === 'c') { if (st().sel.kind === 'items') { e.preventDefault(); copySelection(); } return; }
      if (mod && e.key.toLowerCase() === 'x') { if (st().sel.kind === 'items') { e.preventDefault(); cutSelection(); } return; } // #14
      // Ctrl+A: the items of the band (the selected one, the selected item's, else the body), not the page's text (#6)
      if (mod && !e.altKey && e.key.toLowerCase() === 'a') { if (!rootRef.current?.querySelector('.dialog')) { e.preventDefault(); selectAllItems(); } return; }
      if (mod && e.key.toLowerCase() === 'v') return; // the paste event below: its clipboard needs no permission (N36)
      if (e.key === 'Delete' || e.key === 'Backspace') { if (st().sel.kind === 'items') { e.preventDefault(); deleteSelection(); } return; }
      if (e.key === 'Escape') { st().select({ kind: 'report' }); return; }
      if (e.key === '?') { setDialog(d => (d === 'keys' ? null : 'keys')); return; }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      // Alt+arrows are the browser's (back, forward) and the outline's (move out, in): never a nudge (#15)
      if (arrows[e.key] && !e.altKey && st().sel.kind === 'items') {
        e.preventDefault();
        const step = nudgeStep(st(), e.shiftKey);
        const [dx, dy] = arrows[e.key];
        const s = st();
        s.lastKey = null;
        moveItems(s.sel.ids, dx * step, dy * step, { nudge: true });
      }
    };
    const onLeave = (e) => { if (!st().saved) { e.preventDefault(); e.returnValue = ''; } };
    const onPaste = (e) => {
      if ((embed && !ours(e)) || isTyping(e) || st().tab !== 'design') return;
      e.preventDefault();
      if (!pasteItems(selectedBand(st().def, st().sel), e.clipboardData?.getData('text/plain'))) {
        st().setUi({ saveError: t(lang, 'b9_nothingToPaste') }); setTimeout(() => st().setUi({ saveError: null }), 3000);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('focusin', onDown, true); // a keyboard user's last focus counts as a click
    // embedded: mountDesigner's warnOnLeave adds its own guard (the host page can turn it off)
    if (!embed) window.addEventListener('beforeunload', onLeave);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('focusin', onDown, true); window.removeEventListener('beforeunload', onLeave); };
  }, [st, embed]);
  // the definition as it is in the Designer now (unsaved changes too), as a file to keep, share or `pw render`
  const download = () => {
    const d = st().def;
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${(d.name || id || 'report').replace(/[^\w-]+/g, '-')}.pw.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const open = async () => {
    const d = await embed.onOpen();
    if (d && typeof d === 'object') { st().init(id, d); loadSample(api); }
  };
  // Import: a JasperReports, SSRS or BIRT design, or a definition file (.pw.json); the warnings of the importer are shown
  const importInput = useRef(null);
  const [imported, setImported] = useState(null);
  const importFile = async (file) => {
    if (!file) return;
    const r = readReportFile(file.name, await file.text());
    if (r.definition) { st().init(id, r.definition); loadSample(api); }
    setImported({ name: file.name, ok: !!r.definition, warnings: r.warnings || [], error: r.error });
  };

  const draftBar = useAutosave(embed ? null : id, T, lang, user);
  const hasLeft = !readOnly || embed?.panels?.data !== false;
  const hasRight = embed?.panels?.inspector !== false;
  if (!def) return <div className="designer" dir={dirOf(lang)} lang={lang}><div className="dtop"><span className="brand"><i />ReportWright</span><span className="hint">{T('loadingDesigner')}</span></div></div>;

  return (
    <div className="designer" data-testid="designer" dir={dirOf(lang)} lang={lang} ref={rootRef} data-readonly={readOnly || undefined} {...activators}>
      {!embed && <style>{fontCss}</style>}
      <header className="dtop dbar">
        {embed ? <span className="brand"><i />ReportWright</span> : <Link href={`/${q}`} className="brand"><i />ReportWright</Link>}
        <span className="dtop-sep" aria-hidden="true" />
        <div className="dname">
          <input className="name" value={def.name || ''} aria-label={T('reportName')} readOnly={readOnly} onChange={e => st().apply(d => { d.name = e.target.value; }, 'name')} />
          {!readOnly && <span className={`saved${saved ? '' : ' dirty'}`} data-testid="save-state"><i aria-hidden="true" />{saving ? T('saving') : saved ? T('saved') : T('unsaved')}</span>}
        </div>
        {/* a message (Nothing to paste, a save error) floats below the bar: it never squeezes the bar or pushes the canvas (#14) */}
        {saveError && <span className="dmsg"><span className="err" role="status">{saveError}</span></span>}
        <div className="spacer" />
        <TbGroup label={T('b2_file')}>
          {!embed && <button className="tb-btn" onClick={() => setDialog('history')} title={T('historyHint')} aria-label={T('history')}><Icon name="history" /></button>}
          <button className="tb-btn" onClick={download} title={T('downloadDefHint')} aria-label={T('downloadDef')} data-testid="download-def"><Icon name="download" /></button>
          {embed?.onOpen && <button className="tb-btn" onClick={open} data-testid="open" title="Open…" aria-label="Open…"><Icon name="open" /></button>}
          {!readOnly && <button className="tb-btn" onClick={() => importInput.current?.click()} data-testid="import-report" title="Import report…" aria-label="Import report…"><Icon name="open" /></button>}
          <input ref={importInput} type="file" accept=".jrxml,.rdl,.rdlc,.rptdesign,.json" hidden data-testid="import-file"
            onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
          {!embed && <a className="tb-btn" href={`/viewer/${id}${q}`} target="_blank" rel="noreferrer" title={T('openViewerHint')} aria-label={T('openViewer')}><Icon name="viewer" /></a>}
        </TbGroup>
        {!readOnly && tab === 'design' && (
          <TbGroup label={T('b2_insert')}>
            {QUICK.filter(([type]) => !(embed?.toolbox?.hide || []).includes(type)).map(([type, icon]) => {
              const nm = T(`item_${type}`) === `item_${type}` ? ITEMS[type].label : T(`item_${type}`);
              return <button key={type} className="tb-btn" title={`${T('b2_insertItem', { item: nm })} · ${T('b2_insertHint')}`} aria-label={T('b2_insertItem', { item: nm })} data-testid={`quick-${type}`}
                onClick={() => { const s0 = st(); const at = insertSpot(s0.def, s0.sel, type); insertItem(type, at.section, 0, at.y, {}, at.parentId); }}><Icon name={icon} /></button>;
            })}
          </TbGroup>
        )}
        <TbGroup label={T('b2_arrange')}>
          <button className="tb-btn" title={T('undo')} aria-label={T('undo')} disabled={!canUndo} onClick={() => st().undo()}>{UNDO_ICON}</button>
          <button className="tb-btn" title={T('redo')} aria-label={T('redo')} disabled={!canRedo} onClick={() => st().redo()}>{REDO_ICON}</button>
          {!readOnly && tab === 'design' && <>
            <button className="tb-btn" title={`${T('i_duplicate')} (⌘D)`} aria-label={T('i_duplicate')} disabled={selKind !== 'items'} onClick={duplicateSelection}><Icon name="duplicate" /></button>
            <button className="tb-btn danger" title={`${T('i_delete')} (Del)`} aria-label={T('i_delete')} disabled={selKind !== 'items'} onClick={deleteSelection}><Icon name="trash" /></button>
          </>}
        </TbGroup>
        <TbGroup label={T('b2_view')}>
          {tab === 'design' && <>
            <button className="tb-btn" aria-pressed={showLeft} title={T('b2_leftPanel')} aria-label={T('b2_leftPanel')} onClick={() => setShowLeft(v => !v)}><Icon name="panelLeft" /></button>
            <button className="tb-btn" aria-pressed={showRight} title={T('b2_rightPanel')} aria-label={T('b2_rightPanel')} onClick={() => setShowRight(v => !v)}><Icon name="panelRight" /></button>
          </>}
          <button className="tb-btn" onClick={() => setDialog('keys')} title={T('shortcutsHint')} aria-label={T('shortcutsHint')}><Icon name="keys" /></button>
          {!embed && <ThemeToggle className="tb-btn" />}
        </TbGroup>
        <TbGroup label={T('b2_previewGroup')}>
          <div className="seg" role="group" aria-label={T('mode')}>
            <button aria-pressed={tab === 'design'} onClick={() => st().setUi({ tab: 'design' })}><Icon name="pencil" />{T('design')}</button>
            <button aria-pressed={tab === 'preview'} onClick={() => st().setUi({ tab: 'preview' })} data-testid="tab-preview"><Icon name="viewer" />{T('preview')}</button>
          </div>
        </TbGroup>
        {!embed && <button className="btn ai-btn" onClick={() => setDialog('ai')} disabled={!ai} title={ai ? T('askAiHint') : T('r4_aiOff')} data-testid="ask-ai"><Icon name="ai" />{T('askAi')}</button>}
        {!readOnly && (!embed || embed.onSave || embed.server) && <button className="btn primary save-btn" onClick={() => st().save()} disabled={saving || saved} data-testid="save"><Icon name="save" />{T('save')} <span className="kbd" style={{ background: 'transparent', color: 'inherit', borderColor: 'currentColor', opacity: 0.7 }}>⌘S</span></button>}
      </header>
      {draftBar}
      <ConflictBar T={T} />
      <div className="narrow-note" role="note">{T('ux_narrowDesigner')}</div>
      {imported && (
        <Dialog title="Import report" onClose={() => setImported(null)} footer={<button className="btn" onClick={() => setImported(null)}>{T('close')}</button>}>
          <p data-testid="import-result">{imported.error || `${imported.name} is imported. Read the warnings below, then save.`}</p>
          {imported.warnings.length > 0 && <ul>{imported.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </Dialog>
      )}
      {dialog === 'keys' && (
        <Dialog title={T('shortcuts')} onClose={() => setDialog(null)} footer={<button className="btn" onClick={() => setDialog(null)}>{T('close')}</button>}>
          <div className="kbd-grid">{SHORTCUTS.map(([k, d]) => <Fragment key={d}><span className="kbd">{k}</span><span>{T(d)}</span></Fragment>)}</div>
        </Dialog>
      )}
      {dialog === 'history' && <HistoryDialog id={id} onClose={() => setDialog(null)} T={T} lang={lang} />}
      {dialog === 'ai' && <AskAi onClose={() => setDialog(null)} />}
      {wizard && <ChartWizard />}
      {tableWizard && <TableWizard />}
      {pivotWizard && <PivotWizard />}
      {instantVisuals && <InstantVisuals />}
      {tab === 'preview' ? (
        <main className="dpreview"><ReportViewer definition={def} reportId={id} compact lang={lang} showWarnings /></main>
      ) : (
        <div className="dmain" data-left={hasLeft && showLeft ? 'open' : 'closed'} data-right={hasRight && showRight ? 'open' : 'closed'}
          style={{ gridTemplateColumns: `${hasLeft && showLeft ? 'var(--left-w)' : '0px'} minmax(0, 1fr) ${hasRight && showRight ? 'var(--right-w)' : '0px'}` }}>
          {hasLeft ? <aside className="dleft" aria-label={T('b2_panels')} inert={!showLeft || undefined}><LeftRail T={T} readOnly={readOnly} embed={embed} /></aside> : <span />}
          <main className="dcenter">
            <div className="cbar">
              <label className="check"><input type="checkbox" checked={snap} onChange={e => st().setUi({ snap: e.target.checked })} />{T('snapToGrid')}</label>
              <label className="check" title={T('cellModeHint')}><input type="checkbox" checked={cells} onChange={e => st().setUi({ cells: e.target.checked })} data-testid="cell-mode" />{T('cellMode')}</label>
              {cells && <label className="check">{T('cellSize')}
                <select className="select" style={{ width: 72 }} value={cellSize} onChange={e => st().setUi({ cellSize: Number(e.target.value) })} data-testid="cell-size">
                  {[6, 8, 12, 16, 18, 24, 36].map(c => <option key={c} value={c}>{c} pt</option>)}
                </select>
              </label>}
              <label className="check">{T('units')}
                <select className="select" style={{ width: 72 }} value={unit} onChange={e => st().setUi({ unit: e.target.value })}>
                  {['pt', 'mm', 'cm', 'in'].map(u => <option key={u}>{u}</option>)}
                </select>
              </label>
              <AlignBar T={T} />
              <IssuesButton T={T} />
            </div>
            <Canvas />
            <StatusBar T={T} zoom={zoom} setZoom={(z) => { st().setUi({ zoom: z }); keepZoom(z); }} />
          </main>
          {hasRight ? <aside className="dright" aria-label={T('b2_inspector')} inert={!showRight || undefined}><Inspector /></aside> : <span />}
        </div>
      )}
    </div>
  );
}
