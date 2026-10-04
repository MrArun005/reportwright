'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from './ui.jsx';
import Link from 'next/link';
import { useDesigner, insertItem, deleteSelection, duplicateSelection, moveItems, copySelection, pasteItems } from './store.js';
import Canvas, { MIME_TOOL } from './Canvas.jsx';
import Inspector from './Inspector.jsx';
import DataPanel, { loadSample } from './DataPanel.jsx';
import ReportViewer from '@/viewer/ReportViewer.jsx';
import { ITEMS } from '@/engine/items/index.js';
import { fontFaceCss } from '@/exporters/svg.js';
import { allFontKeys } from '@/engine/text/fonts.js';
import { customFonts } from '@/viewer/engineClient.js';
import ThemeToggle from '@/theme/ThemeToggle.jsx';
import ChartWizard from './ChartWizard.jsx';
import TableWizard from './TableWizard.jsx';
import AskAi from './AskAi.jsx';
import { t, dirOf, pickLang } from '@/i18n/index.js';

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
  { type: 'subreport', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="11" rx="1" stroke="currentColor" fill="none" /><rect x="4" y="5" width="7" height="5" stroke="currentColor" fill="none" /></svg> },
  { type: 'toc', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 3h7M2 7h7M2 11h7" stroke="currentColor" strokeWidth="1.3" /><path d="M11 3h1M11 7h1M11 11h1" stroke="currentColor" strokeWidth="1.3" /></svg> },
  { type: 'field', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="3.5" width="11" height="7" rx="1" stroke="currentColor" fill="none" /><path d="M4 5.5v3" stroke="currentColor" /></svg> },
  { type: 'map', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M1.5 3.5l3.5-1.5 4 1.5 3.5-1.5v8.5l-3.5 1.5-4-1.5-3.5 1.5z" stroke="currentColor" fill="none" strokeLinejoin="round" /><path d="M5 2v8.5M9 3.5V12" stroke="currentColor" /></svg> },
  { type: 'checkbox', icon: <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" fill="none" /><path d="M4.5 7.2l1.8 1.8 3.4-3.6" stroke="currentColor" fill="none" strokeWidth="1.4" /></svg> },
];

function Toolbox({ T }) {
  const add = (type) => {
    const def = useDesigner.getState().def;
    const items = def.sections.body.items;
    const y = items.length ? Math.max(...items.map(i => i.y + i.h)) + 8 : 0;
    insertItem(type, 'body', 0, Math.ceil(y / 4) * 4);
  };
  return (
    <div className="pane">
      <h4>{T('insert')}</h4>
      <div className="pane-body tools">
        {TOOLS.map(t => (
          <div key={t.type} className="tool" draggable role="button" tabIndex={0} data-tool={t.type}
            title={T('toolHint')}
            onDragStart={(e) => { e.dataTransfer.setData(MIME_TOOL, t.type); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => add(t.type)} onKeyDown={(e) => { if (e.key === 'Enter') add(t.type); }}>
            {t.icon}{T(`item_${t.type}`) === `item_${t.type}` ? ITEMS[t.type].label : T(`item_${t.type}`)}
          </div>
        ))}
      </div>
    </div>
  );
}

function isTyping(e) {
  const t = e.target;
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

export default function Designer({ id, initial, lang: langIn }) {
  const lang = pickLang(langIn);
  const T = (k, v) => t(lang, k, v);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  const ready = useRef(false);
  // The store is module-global: never fill it on the server, where requests share it.
  if (!ready.current && typeof window !== 'undefined') { useDesigner.getState().init(id, initial); useDesigner.getState().setUi({ lang }); ready.current = true; }
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
  const fontCss = useMemo(() => fontFaceCss(allFontKeys()), [fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { customFonts().then(list => useDesigner.getState().setUi({ fonts: list })); }, []);
  const canUndo = useDesigner(s => s.past.length > 0);
  const canRedo = useDesigner(s => s.future.length > 0);
  const st = useDesigner.getState;
  const [dialog, setDialog] = useState(null);
  const wizard = useDesigner(s => s.wizard);
  const tableWizard = useDesigner(s => s.tableWizard);

  useEffect(() => { loadSample(); }, []);

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); st().save(); return; }
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
        const step = e.shiftKey ? st().grid * 4 : 1;
        const [dx, dy] = arrows[e.key];
        const s = st();
        s.lastKey = null;
        moveItems(s.sel.ids, dx * step, dy * step);
      }
    };
    const onLeave = (e) => { if (!st().saved) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave); };
  }, [st]);

  if (!def) return <div className="designer" dir={dirOf(lang)} lang={lang}><div className="dtop"><span className="brand"><i />Pagewright</span><span className="hint">{T('loadingDesigner')}</span></div></div>;

  return (
    <div className="designer" data-testid="designer" dir={dirOf(lang)} lang={lang}>
      <style>{fontCss}</style>
      <div className="dtop">
        <Link href={`/${q}`} className="brand"><i />Pagewright</Link>
        <input className="name" value={def.name || ''} aria-label={T('reportName')} onChange={e => st().apply(d => { d.name = e.target.value; }, 'name')} />
        <span className={`saved${saved ? '' : ' dirty'}`} data-testid="save-state">{saving ? T('saving') : saved ? T('saved') : T('unsaved')}</span>
        {saveError && <span className="err">{saveError}</span>}
        <div className="spacer" />
        <button className="btn sm icon" title={T('undo')} aria-label={T('undo')} disabled={!canUndo} onClick={() => st().undo()}>↶</button>
        <button className="btn sm icon" title={T('redo')} aria-label={T('redo')} disabled={!canRedo} onClick={() => st().redo()}>↷</button>
        <div className="seg" role="group" aria-label={T('mode')}>
          <button aria-pressed={tab === 'design'} onClick={() => st().setUi({ tab: 'design' })}>{T('design')}</button>
          <button aria-pressed={tab === 'preview'} onClick={() => st().setUi({ tab: 'preview' })} data-testid="tab-preview">{T('preview')}</button>
        </div>
        <button className="btn sm ghost" onClick={() => setDialog('ai')} title={T('askAiHint')}>{T('askAi')}</button>
        <button className="btn sm ghost" onClick={() => setDialog('history')} title={T('historyHint')}>{T('history')}</button>
        <button className="btn sm ghost icon" onClick={() => setDialog('keys')} title={T('shortcutsHint')} aria-label={T('shortcutsHint')}>?</button>
        <ThemeToggle />
        <a className="btn sm" href={`/viewer/${id}${q}`} target="_blank" rel="noreferrer" title={T('openViewerHint')}>{T('openViewer')}</a>
        <button className="btn sm primary" onClick={() => st().save()} disabled={saving || saved} data-testid="save">{T('save')} <span className="kbd" style={{ background: 'transparent', color: 'inherit', borderColor: 'currentColor', opacity: 0.7 }}>⌘S</span></button>
      </div>
      {dialog === 'keys' && (
        <Dialog title={T('shortcuts')} onClose={() => setDialog(null)} footer={<button className="btn" onClick={() => setDialog(null)}>{T('close')}</button>}>
          <div className="kbd-grid">{SHORTCUTS.map(([k, d]) => <Fragment key={d}><span className="kbd">{k}</span><span>{T(d)}</span></Fragment>)}</div>
        </Dialog>
      )}
      {dialog === 'history' && <HistoryDialog id={id} onClose={() => setDialog(null)} T={T} lang={lang} />}
      {dialog === 'ai' && <AskAi onClose={() => setDialog(null)} />}
      {wizard && <ChartWizard />}
      {tableWizard && <TableWizard />}
      {tab === 'preview' ? (
        <ReportViewer definition={def} reportId={id} compact lang={lang} />
      ) : (
        <div className="dmain">
          <aside className="dleft"><Toolbox T={T} /><DataPanel /></aside>
          <section className="dcenter">
            <div className="cbar">
              <label className="check">{T('zoom')}
                <select className="select" style={{ width: 80, height: 24 }} value={zoom} onChange={e => st().setUi({ zoom: Number(e.target.value) })}>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map(z => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={snap} onChange={e => st().setUi({ snap: e.target.checked })} />{T('snapToGrid')}</label>
              <label className="check">{T('units')}
                <select className="select" style={{ width: 64, height: 24 }} value={unit} onChange={e => st().setUi({ unit: e.target.value })}>
                  {['pt', 'mm', 'cm', 'in'].map(u => <option key={u}>{u}</option>)}
                </select>
              </label>
              <span className="hint" style={{ marginInlineStart: 'auto' }}>{T('canvasHint')}</span>
            </div>
            <Canvas />
          </section>
          <aside className="dright"><Inspector /></aside>
        </div>
      )}
    </div>
  );
}
