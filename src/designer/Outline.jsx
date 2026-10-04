'use client';
// Outline: every band and item as a tree. Select any item (also one hidden under another), change the drawing order,
// or move an item into or out of a container or list: drag a row (onto the top or bottom edge of a row: before or after
// it; onto the middle of a container or list: into it; onto a band: to its end), or with the keyboard (Alt+arrows on a
// name). The buttons do the same and stay as the accessible fallback.
import { useRef, useState } from 'react';
import { useDesigner, sectionList, secOf, reorderItem, moveOutOfParent, moveItemTo, findItem, NESTING } from './store.js';
import { ITEMS } from '@/engine/items/index.js';
import { t } from '@/i18n/index.js';

const MIME = 'application/x-pw-outline';

export default function Outline() {
  const def = useDesigner(s => s.def);
  const sel = useDesigner(s => s.sel);
  const lang = useDesigner(s => s.lang);
  const readOnly = useDesigner(s => s.readOnly);
  const T = (k, v) => t(lang, k, v);
  const [drop, setDrop] = useState(null); // { id, where: 'before' | 'after' | 'into' } or { band }
  const [said, setSaid] = useState('');
  const dragged = useRef(null);
  const body = useRef(null);
  const chosen = new Set(sel.kind === 'items' ? sel.ids : sel.kind === 'cell' ? [sel.id] : []);
  const pick = (e, id) => {
    const st = useDesigner.getState();
    if (e.shiftKey && st.sel.kind === 'items') {
      const ids = st.sel.ids.includes(id) ? st.sel.ids.filter(x => x !== id) : [...st.sel.ids, id];
      st.select(ids.length ? { kind: 'items', ids } : { kind: 'report' });
    } else st.select({ kind: 'items', ids: [id] });
  };
  /** After a move: say where the item went (screen readers) and keep the keyboard on its row. */
  const moved = (id, ok) => {
    if (!ok) { setSaid(T('outlineCannotMove')); return; }
    const f = findItem(useDesigner.getState().def, id);
    if (!f) return;
    setSaid(T(f.parent ? 'outlineMovedInto' : 'outlineMovedBand', { name: f.item.name, parent: f.parent?.name || '', n: f.index + 1, of: f.list.length }));
    requestAnimationFrame(() => body.current?.querySelector(`[data-outline-id="${CSS.escape(id)}"] .nm`)?.focus());
  };
  /** Alt+Up/Down: earlier or later; Alt+Right: into the container or list just above; Alt+Left: out of its parent. */
  const onKey = (e, it, list, i, parent) => {
    if (readOnly || !e.altKey || e.shiftKey || e.metaKey || e.ctrlKey) return;
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      const j = k === 'ArrowUp' ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return;
      e.preventDefault(); reorderItem(it.id, j - i); moved(it.id, true);
    } else if (k === 'ArrowRight') {
      e.preventDefault();
      const prev = list[i - 1];
      if (!prev || !NESTING.has(prev.type)) { setSaid(T('outlineNoContainerAbove')); return; }
      moved(it.id, moveItemTo(it.id, prev.id, (prev.items || []).length));
    } else if (k === 'ArrowLeft') {
      if (!parent) return;
      e.preventDefault(); moveOutOfParent(it.id); moved(it.id, true);
    }
  };

  /** Where a drag over a row would land: its top quarter is before, bottom quarter after, the middle of a container into. */
  const zone = (e, it) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    if (NESTING.has(it.type) && y > 0.25 && y < 0.75) return 'into';
    return y < 0.5 ? 'before' : 'after';
  };
  /** Whether the dragged item may land there: same band, never into itself or one of its own children. */
  const allowed = (target, where, section) => {
    const id = dragged.current;
    if (!id || id === target?.id) return false;
    const d = useDesigner.getState().def;
    const f = findItem(d, id);
    if (!f || f.section !== section) return false;
    if (!target) return true;
    for (let q = findItem(d, target.id); q; q = q.parent ? findItem(d, q.parent.id) : null) if (q.item.id === id) return false;
    return where !== 'into' || NESTING.has(target.type);
  };
  const dragProps = (it, i, parent, section) => (readOnly ? {} : {
    draggable: true,
    onDragStart: (e) => { e.stopPropagation(); dragged.current = it.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(MIME, it.id); e.dataTransfer.setData('text/plain', it.name); },
    onDragEnd: () => { dragged.current = null; setDrop(null); },
    onDragOver: (e) => {
      const where = zone(e, it);
      e.stopPropagation(); // over a row the row decides: a refused drop must not fall through to the band
      if (!allowed(it, where, section)) { if (drop) setDrop(null); return; }
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      if (drop?.id !== it.id || drop?.where !== where) setDrop({ id: it.id, where });
    },
    onDrop: (e) => {
      const where = zone(e, it), id = dragged.current;
      e.stopPropagation();
      if (!allowed(it, where, section)) return;
      e.preventDefault(); setDrop(null);
      const ok = where === 'into' ? moveItemTo(id, it.id, (it.items || []).length) : moveItemTo(id, parent?.id || null, where === 'before' ? i : i + 1);
      moved(id, ok);
    },
  });
  const bandDrop = (key) => (readOnly ? {} : {
    onDragOver: (e) => { if (!allowed(null, 'after', key)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (drop?.band !== key) setDrop({ band: key }); },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrop(x => (x?.band === key ? null : x)); },
    onDrop: (e) => {
      const id = dragged.current;
      if (!allowed(null, 'after', key)) return;
      e.preventDefault(); setDrop(null);
      moved(id, moveItemTo(id, null, (secOf(useDesigner.getState().def, key)?.items || []).length));
    },
  });

  const rows = (list, parent, depth, section) => list.map((it, i) => {
    const mark = drop?.id === it.id ? ` drop-${drop.where}` : '';
    return (
      <li key={it.id}>
        <div className={`trow outline-row${chosen.has(it.id) ? ' sel' : ''}${mark}`} style={{ paddingInlineStart: depth * 14 }} data-outline={it.name} data-outline-id={it.id} {...dragProps(it, i, parent, section)}>
          {!readOnly && <span className="grip" aria-hidden="true">⠿</span>}
          <button type="button" className="linklike nm" onClick={(e) => pick(e, it.id)} onKeyDown={(e) => onKey(e, it, list, i, parent)} aria-pressed={chosen.has(it.id)} aria-describedby={readOnly ? undefined : 'outline-keys'}>{it.name}</button>
          <span className="ty">{T(`item_${it.type}`) === `item_${it.type}` ? ITEMS[it.type]?.label || it.type : T(`item_${it.type}`)}</span>
          {!readOnly && <span className="act" style={{ display: 'inline-flex', gap: 2 }}>
            <button type="button" className="btn sm ghost icon" disabled={i === 0} onClick={() => reorderItem(it.id, -1)} title={T('outlineBackward')} aria-label={`${T('outlineBackward')}: ${it.name}`}>↑</button>
            <button type="button" className="btn sm ghost icon" disabled={i === list.length - 1} onClick={() => reorderItem(it.id, 1)} title={T('outlineForward')} aria-label={`${T('outlineForward')}: ${it.name}`}>↓</button>
            {parent && <button type="button" className="btn sm ghost icon" onClick={() => moveOutOfParent(it.id)} title={T('outlineMoveOut', { name: parent.name })} aria-label={`${T('outlineMoveOut', { name: parent.name })}: ${it.name}`}>⇱</button>}
          </span>}
        </div>
        {NESTING.has(it.type) && (it.items || []).length > 0 && <ul className="tree">{rows(it.items, it, depth + 1, section)}</ul>}
      </li>
    );
  });
  return (
    <div className="pane" data-testid="outline">
      <h4>{T('outline')}</h4>
      <div className="pane-body" ref={body}>
        {sectionList(def).map(({ key, label }) => {
          const items = secOf(def, key)?.items || [];
          return (
            <div key={key} className={`outline-sec${drop?.band === key ? ' drop-band' : ''}`} data-outline-band={key} {...bandDrop(key)}>
              <button type="button" className={`linklike outline-band${sel.kind === 'section' && sel.section === key ? ' sel' : ''}`} onClick={() => useDesigner.getState().select({ kind: 'section', section: key })}><b>{label}</b></button>
              <ul className="tree">{items.length ? rows(items, null, 1, key) : <li className="subtle">{T('outlineEmpty')}</li>}</ul>
            </div>
          );
        })}
        <div className="hint">{T('outlineHint')}</div>
        {!readOnly && <div className="hint" id="outline-keys">{T('outlineKeys')}</div>}
        <div className="sr-only" role="status" aria-live="polite">{said}</div>
      </div>
    </div>
  );
}
