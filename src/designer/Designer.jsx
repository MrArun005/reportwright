'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from './ui.jsx';
import Link from 'next/link';
import { secOf, useDesigner, insertItem, deleteSelection, duplicateSelection, moveItems, copySelection, pasteItems, alignItems } from './store.js';
import Canvas, { MIME_TOOL, useDesignIssues, issueLine } from './Canvas.jsx';
import Inspector from './Inspector.jsx';
import DataPanel, { loadSample } from './DataPanel.jsx';
import Outline from './Outline.jsx';
import ReportViewer from '@/viewer/ReportViewer.jsx';
import { ITEMS } from '@/engine/items/index.js';
import { fontFaceCss } from '@/exporters/svg.js';
import { allFontKeys } from '@/engine/text/fonts.js';
import { customFonts } from '@/viewer/engineClient.js';
import ThemeToggle from '@/theme/ThemeToggle.jsx';
import ChartWizard from './ChartWizard.jsx';
import TableWizard from './TableWizard.jsx';
import AskAi from './AskAi.jsx';
import { PartsPanel, LayersPanel } from './Reuse.jsx';
import PivotWizard, { InstantVisuals } from './PivotWizard.jsx';
import { t, dirOf, pickLang } from '@/i18n/index.js';
import { readDraft, writeDraft, clearDraft, clearDrafts, mergeDraft } from './draft.js';

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
  const name = (type) => (T(`item_${type}`) === `item_${type}` ? ITEMS[type].label : T(`item_${type}`));
  const add = (type) => {
    const def = useDesigner.getState().def;
    const items = secOf(def, 'body').items;
    const y = items.length ? Math.max(...items.map(i => i.y + i.h)) + 8 : 0;
    insertItem(type, 'body', 0, Math.ceil(y / 4) * 4);
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
function useAutosave(id, T, lang) {
  const [offer, setOffer] = useState(null); // { at, def }: a draft newer than the saved report
  const [user, setUser] = useState(null); // the signed-in email ('' without accounts); null until known
  useEffect(() => {
    if (!id || framed()) return undefined; // never inside another site's page
    let alive = true;
    fetch('/api/auth/me').then(r => (r.ok ? r.json() : {})).catch(() => ({})).then(me => { if (alive) setUser(String(me?.email || '')); });
    return () => { alive = false; };
  }, [id]);
  useEffect(() => {
    if (!id || user == null) return undefined;
    let store;
    try { store = window.localStorage; } catch { return undefined; }
    clearDrafts(store, user); // another user's drafts in this browser go (and expired ones)
    const d = readDraft(store, user, id);
    if (d && plain(mergeDraft(d.def, useDesigner.getState().def)) !== plain(useDesigner.getState().def)) setOffer(d); else if (d) clearDraft(store, user, id);
    const keep = () => { const s = useDesigner.getState(); if (!s.saved && !s.readOnly) writeDraft(store, user, id, s.def); };
    const t = setInterval(keep, AUTOSAVE_MS);
    const hide = () => { if (document.visibilityState === 'hidden') keep(); };
    window.addEventListener('pagehide', keep);
    document.addEventListener('visibilitychange', hide);
    const unsub = useDesigner.subscribe((s, prev) => { if (s.saved && !prev.saved) clearDraft(store, user, id); }); // saved: no draft needed
    return () => { clearInterval(t); window.removeEventListener('pagehide', keep); document.removeEventListener('visibilitychange', hide); unsub(); };
  }, [id, user]);
  if (!offer) return null;
  const when = new Date(offer.at).toLocaleString(lang === 'en' ? 'en-IN' : lang, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="draft-bar" role="alert" data-testid="draft-offer">
      <span>{T('ux_draftFound', { when })}</span>
      <button className="btn sm primary" data-testid="draft-restore" onClick={() => { const d = mergeDraft(offer.def, useDesigner.getState().def); useDesigner.getState().apply(() => JSON.parse(JSON.stringify(d))); useDesigner.getState().fixSelection(); setOffer(null); }}>{T('ux_draftRestore')}</button>
      <button className="btn sm" data-testid="draft-discard" onClick={() => { try { clearDraft(window.localStorage, user, id); } catch { /* no storage */ } setOffer(null); }}>{T('ux_draftDiscard')}</button>
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
  const issues = useDesignIssues();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!issues.length) setOpen(false); }, [issues.length]);
  if (!issues.length) return <span className="hint" data-testid="issues-none">{T('ux_noIssues')}</span>;
  return (
    <span className="issues-wrap">
      <button type="button" className="btn sm issues-btn" aria-expanded={open} onClick={() => setOpen(v => !v)} data-testid="issues">{T('ux_issues', { n: issues.length })}</button>
      {open && <ul className="issues-list" data-testid="issues-list">
        {issues.map((i, k) => <li key={k}><button type="button" className="linklike" onClick={() => useDesigner.getState().select({ kind: 'items', ids: [i.id] })}>{issueLine(T, i)}</button></li>)}
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
  ['⌘/Ctrl S', 'sc_save'], ['⌘/Ctrl Z', 'sc_undo'], ['⇧⌘/Ctrl Z, ⌘/Ctrl Y', 'sc_redo'], ['⌘/Ctrl C / V', 'sc_copy'],
  ['⌘/Ctrl D', 'sc_duplicate'], ['Delete / Backspace', 'sc_delete'], ['← ↑ → ↓', 'sc_nudge'], ['⇧ ← ↑ → ↓', 'sc_nudge4'],
  ['⇧ Click', 'sc_toggle'], ['Drag', 'sc_marquee'], ['Alt + Drag', 'sc_guides'],
  ['Esc', 'sc_clear'], ['?', 'sc_help'],
];

function HistoryDialog({ id, onClose, T, lang }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { fetch(`/api/reports/${id}/versions`).then(r => r.json()).then(setList).catch(e => setErr(e.message)); }, [id]);
  const restore = async (v) => {
    const res = await fetch(`/api/reports/${id}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: v }) });
    if (!res.ok) { setErr((await res.json()).error); return; }
    const def = await res.json();
    useDesigner.getState().init(id, def);
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
 * @param {{ id?: string, initial: object, lang?: string, embed?: { onSave?: (def: object) => any, onOpen?: () => any, readOnly?: boolean,
 *   toolbox?: { hide?: string[] }, panels?: { data?: boolean, inspector?: boolean }, dataSourceTemplates?: object[], server?: string } }} props
 *   embed: set by mountDesigner (another site); none on Pagewright's own pages
 */
export default function Designer({ id, initial, lang: langIn, embed = null }) {
  const lang = pickLang(langIn);
  const T = (k, v) => t(lang, k, v);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  const ready = useRef(false);
  // The store is module-global: never fill it on the server, where requests share it.
  if (!ready.current && typeof window !== 'undefined') { useDesigner.getState().init(id, initial); useDesigner.getState().setUi({ lang, embed, readOnly: !!embed?.readOnly }); ready.current = true; }
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
  const fontCss = useMemo(() => fontFaceCss(allFontKeys(), `${embed?.server || ''}/fonts`), [fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  // embedded: @font-face is ignored inside a shadow root, so the report fonts are declared on the host document
  useEffect(() => {
    if (!embed) return;
    let el = document.getElementById('pw-designer-fonts');
    if (!el) { el = document.createElement('style'); el.id = 'pw-designer-fonts'; document.head.appendChild(el); }
    el.textContent = fontCss;
  }, [embed, fontCss]);
  useEffect(() => { customFonts().then(list => useDesigner.getState().setUi({ fonts: list })); }, []);
  useEffect(() => { const z = savedZoom(); if (z != null) useDesigner.getState().setUi({ zoom: z }); }, []);
  const canUndo = useDesigner(s => s.past.length > 0);
  const canRedo = useDesigner(s => s.future.length > 0);
  const st = useDesigner.getState;
  const [dialog, setDialog] = useState(null);
  const wizard = useDesigner(s => s.wizard);
  const tableWizard = useDesigner(s => s.tableWizard);
  const pivotWizard = useDesigner(s => s.pivotWizard);
  const instantVisuals = useDesigner(s => s.instantVisuals);
  const cells = useDesigner(s => s.cells);
  const cellSize = useDesigner(s => s.cellSize);

  // sample data again whenever a data source or data set comes or goes (a report part brings its own)
  const dataKey = useDesigner(s => `${(s.def?.dataSources || []).map(x => x.name)}|${(s.def?.dataSets || []).map(x => x.name)}`);
  useEffect(() => { loadSample(); }, [dataKey]);

  useEffect(() => {
    const onKey = (e) => {
      // embedded: only keys typed inside the designer, never the host page's
      if (embed && !(e.composedPath?.() || []).includes(rootRef.current)) return;
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
      if (isTyping(e) || st().tab !== 'design') return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st().redo() : st().undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st().redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (mod && e.key.toLowerCase() === 'c') { if (st().sel.kind === 'items') { e.preventDefault(); copySelection(); } return; }
      if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteItems(st().sel.kind === 'section' ? st().sel.section : 'body'); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (st().sel.kind === 'items') { e.preventDefault(); deleteSelection(); } return; }
      if (e.key === 'Escape') { st().select({ kind: 'report' }); return; }
      if (e.key === '?') { setDialog(d => (d === 'keys' ? null : 'keys')); return; }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && st().sel.kind === 'items') {
        e.preventDefault();
        const step = st().cells ? st().cellSize : e.shiftKey ? st().grid * 4 : 1; // cell mode: a cell at a time
        const [dx, dy] = arrows[e.key];
        const s = st();
        s.lastKey = null;
        moveItems(s.sel.ids, dx * step, dy * step);
      }
    };
    const onLeave = (e) => { if (!st().saved) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', onKey);
    if (!embed) window.addEventListener('beforeunload', onLeave); // the host page decides about leaving
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave); };
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
    if (d && typeof d === 'object') { st().init(id, d); loadSample(); }
  };

  const draftBar = useAutosave(embed ? null : id, T, lang);
  if (!def) return <div className="designer" dir={dirOf(lang)} lang={lang}><div className="dtop"><span className="brand"><i />Pagewright</span><span className="hint">{T('loadingDesigner')}</span></div></div>;

  return (
    <div className="designer" data-testid="designer" dir={dirOf(lang)} lang={lang} ref={rootRef} data-readonly={readOnly || undefined}>
      {!embed && <style>{fontCss}</style>}
      <div className="dtop">
        {embed ? <span className="brand"><i />Pagewright</span> : <Link href={`/${q}`} className="brand"><i />Pagewright</Link>}
        <input className="name" value={def.name || ''} aria-label={T('reportName')} readOnly={readOnly} onChange={e => st().apply(d => { d.name = e.target.value; }, 'name')} />
        {!readOnly && <span className={`saved${saved ? '' : ' dirty'}`} data-testid="save-state">{saving ? T('saving') : saved ? T('saved') : T('unsaved')}</span>}
        {saveError && <span className="err">{saveError}</span>}
        <div className="spacer" />
        <button className="btn sm icon" title={T('undo')} aria-label={T('undo')} disabled={!canUndo} onClick={() => st().undo()}>{UNDO_ICON}</button>
        <button className="btn sm icon" title={T('redo')} aria-label={T('redo')} disabled={!canRedo} onClick={() => st().redo()}>{REDO_ICON}</button>
        <div className="seg" role="group" aria-label={T('mode')}>
          <button aria-pressed={tab === 'design'} onClick={() => st().setUi({ tab: 'design' })}>{T('design')}</button>
          <button aria-pressed={tab === 'preview'} onClick={() => st().setUi({ tab: 'preview' })} data-testid="tab-preview">{T('preview')}</button>
        </div>
        {!embed && <button className="btn sm ghost" onClick={() => setDialog('ai')} title={T('askAiHint')}>{T('askAi')}</button>}
        {!embed && <button className="btn sm ghost" onClick={() => setDialog('history')} title={T('historyHint')}>{T('history')}</button>}
        <button className="btn sm ghost" onClick={download} title={T('downloadDefHint')} data-testid="download-def">{T('downloadDef')}</button>
        <button className="btn sm ghost icon" onClick={() => setDialog('keys')} title={T('shortcutsHint')} aria-label={T('shortcutsHint')}>?</button>
        {!embed && <ThemeToggle />}
        {!embed && <a className="btn sm" href={`/viewer/${id}${q}`} target="_blank" rel="noreferrer" title={T('openViewerHint')}>{T('openViewer')}</a>}
        {embed?.onOpen && <button className="btn sm" onClick={open} data-testid="open">Open…</button>}
        {!readOnly && <button className="btn sm primary" onClick={() => st().save()} disabled={saving || saved} data-testid="save">{T('save')} <span className="kbd" style={{ background: 'transparent', color: 'inherit', borderColor: 'currentColor', opacity: 0.7 }}>⌘S</span></button>}
      </div>
      {draftBar}
      <div className="narrow-note" role="note">{T('ux_narrowDesigner')}</div>
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
        <ReportViewer definition={def} reportId={id} compact lang={lang} />
      ) : (
        <div className="dmain">
          {(!readOnly || embed?.panels?.data !== false) && (
            <aside className="dleft">{!readOnly && <Toolbox T={T} hide={embed?.toolbox?.hide} />}{embed?.panels?.data !== false && <DataPanel />}<PartsPanel /><LayersPanel /><Outline /></aside>
          )}
          <section className="dcenter">
            <div className="cbar">
              <label className="check">{T('zoom')}
                <select className="select" style={{ width: 'auto', minWidth: 80, height: 24 }} value={zoom} data-testid="zoom" onChange={e => { const z = e.target.value === 'fit' ? 'fit' : Number(e.target.value); st().setUi({ zoom: z }); keepZoom(z); }}>
                  <option value="fit">{T('zoomFit')}</option>
                  {ZOOMS.map(z => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={snap} onChange={e => st().setUi({ snap: e.target.checked })} />{T('snapToGrid')}</label>
              <label className="check" title={T('cellModeHint')}><input type="checkbox" checked={cells} onChange={e => st().setUi({ cells: e.target.checked })} data-testid="cell-mode" />{T('cellMode')}</label>
              {cells && <label className="check">{T('cellSize')}
                <select className="select" style={{ width: 64, height: 24 }} value={cellSize} onChange={e => st().setUi({ cellSize: Number(e.target.value) })} data-testid="cell-size">
                  {[6, 8, 12, 16, 18, 24, 36].map(c => <option key={c} value={c}>{c} pt</option>)}
                </select>
              </label>}
              <label className="check">{T('units')}
                <select className="select" style={{ width: 64, height: 24 }} value={unit} onChange={e => st().setUi({ unit: e.target.value })}>
                  {['pt', 'mm', 'cm', 'in'].map(u => <option key={u}>{u}</option>)}
                </select>
              </label>
              <AlignBar T={T} />
              <IssuesButton T={T} />
              <span className="hint" style={{ marginInlineStart: 'auto' }}>{T('canvasHint')}</span>
            </div>
            <Canvas />
          </section>
          {embed?.panels?.inspector !== false && <aside className="dright"><Inspector /></aside>}
        </div>
      )}
    </div>
  );
}
