'use client';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './ui.jsx';
import Link from 'next/link';
import { useDesigner, insertItem, deleteSelection, duplicateSelection, moveItems, copySelection, pasteItems } from './store.js';
import Canvas, { MIME_TOOL } from './Canvas.jsx';
import Inspector from './Inspector.jsx';
import DataPanel, { loadSample } from './DataPanel.jsx';
import ReportViewer from '@/viewer/ReportViewer.jsx';
import { ITEMS } from '@/engine/items/index.js';
import { fontFaceCss } from '@/exporters/svg.js';
import { ALL_FONT_KEYS } from '@/engine/text/fonts.js';
import ThemeToggle from '@/theme/ThemeToggle.jsx';
import ChartWizard from './ChartWizard.jsx';

const FONT_CSS = fontFaceCss(ALL_FONT_KEYS);

const TOOLS = [
  { type: 'textbox', icon: <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 3h10M7 3v9" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg> },
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

function Toolbox() {
  const add = (type) => {
    const def = useDesigner.getState().def;
    const items = def.sections.body.items;
    const y = items.length ? Math.max(...items.map(i => i.y + i.h)) + 8 : 0;
    insertItem(type, 'body', 0, Math.ceil(y / 4) * 4);
  };
  return (
    <div className="pane">
      <h4>Insert</h4>
      <div className="pane-body tools">
        {TOOLS.map(t => (
          <div key={t.type} className="tool" draggable role="button" tabIndex={0} data-tool={t.type}
            title={`Drag onto the page, or click to add ${ITEMS[t.type].label.toLowerCase()} to the body`}
            onDragStart={(e) => { e.dataTransfer.setData(MIME_TOOL, t.type); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => add(t.type)} onKeyDown={(e) => { if (e.key === 'Enter') add(t.type); }}>
            {t.icon}{ITEMS[t.type].label}
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
  ['⌘/Ctrl S', 'Save'], ['⌘/Ctrl Z', 'Undo'], ['⇧⌘/Ctrl Z or ⌘/Ctrl Y', 'Redo'], ['⌘/Ctrl C / V', 'Copy and paste items (works across reports)'],
  ['⌘/Ctrl D', 'Duplicate'], ['Delete / Backspace', 'Delete the selection'], ['Arrows', 'Nudge 1 pt'], ['⇧ Arrows', 'Nudge 4 grid steps'],
  ['⇧ Click', 'Add to or remove from the selection'], ['Drag on empty space', 'Select an area'], ['Alt while dragging', 'Ignore smart guides'],
  ['Esc', 'Clear the selection'], ['?', 'Show this list'],
];

function HistoryDialog({ id, onClose }) {
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
    <Dialog title="Version history" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="hint">Each save keeps the previous version (the last 50). Restoring makes the current version a version too, so you can undo a restore.</div>
      {err && <div className="err">{err}</div>}
      {!list && !err && <div className="hint">Loading…</div>}
      {list && !list.length && <div className="hint">No earlier versions yet. Save a change first.</div>}
      {list?.map(v => (
        <div className="ver-row" key={v.version}>
          <span>{new Date(v.savedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })} <span className="hint">· {(v.bytes / 1024).toFixed(1)} KB</span></span>
          <span className="btnrow">
            <button className="btn sm" onClick={() => restore(v.version)}>Restore</button>
          </span>
        </div>
      ))}
    </Dialog>
  );
}

export default function Designer({ id, initial }) {
  const ready = useRef(false);
  // The store is module-global: never fill it on the server, where requests share it.
  if (!ready.current && typeof window !== 'undefined') { useDesigner.getState().init(id, initial); ready.current = true; }
  const def = useDesigner(s => s.def);
  const tab = useDesigner(s => s.tab);
  const saved = useDesigner(s => s.saved);
  const saving = useDesigner(s => s.saving);
  const saveError = useDesigner(s => s.saveError);
  const zoom = useDesigner(s => s.zoom);
  const snap = useDesigner(s => s.snap);
  const unit = useDesigner(s => s.unit);
  const canUndo = useDesigner(s => s.past.length > 0);
  const canRedo = useDesigner(s => s.future.length > 0);
  const st = useDesigner.getState;
  const [dialog, setDialog] = useState(null);
  const wizard = useDesigner(s => s.wizard);

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

  if (!def) return <div className="designer"><div className="dtop"><span className="brand"><i />Pagewright</span><span className="hint">Loading the designer…</span></div></div>;

  return (
    <div className="designer" data-testid="designer">
      <style>{FONT_CSS}</style>
      <div className="dtop">
        <Link href="/" className="brand"><i />Pagewright</Link>
        <input className="name" value={def.name || ''} aria-label="Report name" onChange={e => st().apply(d => { d.name = e.target.value; }, 'name')} />
        <span className={`saved${saved ? '' : ' dirty'}`} data-testid="save-state">{saving ? 'Saving…' : saved ? 'Saved' : 'Unsaved changes'}</span>
        {saveError && <span className="err">{saveError}</span>}
        <div className="spacer" />
        <button className="btn sm icon" title="Undo (⌘Z)" disabled={!canUndo} onClick={() => st().undo()}>↶</button>
        <button className="btn sm icon" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={() => st().redo()}>↷</button>
        <div className="seg" role="group" aria-label="Mode">
          <button aria-pressed={tab === 'design'} onClick={() => st().setUi({ tab: 'design' })}>Design</button>
          <button aria-pressed={tab === 'preview'} onClick={() => st().setUi({ tab: 'preview' })} data-testid="tab-preview">Preview</button>
        </div>
        <button className="btn sm ghost" onClick={() => setDialog('history')} title="Saved versions">History</button>
        <button className="btn sm ghost icon" onClick={() => setDialog('keys')} title="Keyboard shortcuts (?)">?</button>
        <ThemeToggle />
        <a className="btn sm" href={`/viewer/${id}`} target="_blank" rel="noreferrer" title="Opens the saved version">Open viewer</a>
        <button className="btn sm primary" onClick={() => st().save()} disabled={saving || saved} data-testid="save">Save <span className="kbd" style={{ background: 'transparent', color: 'inherit', borderColor: 'currentColor', opacity: 0.7 }}>⌘S</span></button>
      </div>
      {dialog === 'keys' && (
        <Dialog title="Keyboard shortcuts" onClose={() => setDialog(null)} footer={<button className="btn" onClick={() => setDialog(null)}>Close</button>}>
          <div className="kbd-grid">{SHORTCUTS.map(([k, d]) => <><span className="kbd" key={k}>{k}</span><span key={d}>{d}</span></>)}</div>
        </Dialog>
      )}
      {dialog === 'history' && <HistoryDialog id={id} onClose={() => setDialog(null)} />}
      {wizard && <ChartWizard />}
      {tab === 'preview' ? (
        <ReportViewer definition={def} reportId={id} compact />
      ) : (
        <div className="dmain">
          <aside className="dleft"><Toolbox /><DataPanel /></aside>
          <section className="dcenter">
            <div className="cbar">
              <label className="check">Zoom
                <select className="select" style={{ width: 80, height: 24 }} value={zoom} onChange={e => st().setUi({ zoom: Number(e.target.value) })}>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map(z => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={snap} onChange={e => st().setUi({ snap: e.target.checked })} />Snap to grid</label>
              <label className="check">Units
                <select className="select" style={{ width: 64, height: 24 }} value={unit} onChange={e => st().setUi({ unit: e.target.value })}>
                  {['pt', 'mm', 'cm', 'in'].map(u => <option key={u}>{u}</option>)}
                </select>
              </label>
              <span className="hint" style={{ marginLeft: 'auto' }}>Shift+click to add to the selection · drag on empty space to select an area · arrows nudge</span>
            </div>
            <Canvas />
          </section>
          <aside className="dright"><Inspector /></aside>
        </div>
      )}
    </div>
  );
}
