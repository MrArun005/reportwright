'use client';
// Outline: every band and item as a tree. Select any item (also one hidden under another), change the drawing
// order, or take an item out of its container or list.
import { useDesigner, sectionList, secOf, reorderItem, moveOutOfParent, NESTING } from './store.js';
import { ITEMS } from '@/engine/items/index.js';
import { t } from '@/i18n/index.js';

export default function Outline() {
  const def = useDesigner(s => s.def);
  const sel = useDesigner(s => s.sel);
  const lang = useDesigner(s => s.lang);
  const readOnly = useDesigner(s => s.readOnly);
  const T = (k, v) => t(lang, k, v);
  const chosen = new Set(sel.kind === 'items' ? sel.ids : sel.kind === 'cell' ? [sel.id] : []);
  const pick = (e, id) => {
    const st = useDesigner.getState();
    if (e.shiftKey && st.sel.kind === 'items') {
      const ids = st.sel.ids.includes(id) ? st.sel.ids.filter(x => x !== id) : [...st.sel.ids, id];
      st.select(ids.length ? { kind: 'items', ids } : { kind: 'report' });
    } else st.select({ kind: 'items', ids: [id] });
  };
  const rows = (list, parent, depth) => list.map((it, i) => (
    <li key={it.id}>
      <div className={`trow outline-row${chosen.has(it.id) ? ' sel' : ''}`} style={{ paddingInlineStart: depth * 14 }} data-outline={it.name}>
        <button type="button" className="linklike nm" onClick={(e) => pick(e, it.id)} aria-pressed={chosen.has(it.id)}>{it.name}</button>
        <span className="ty">{T(`item_${it.type}`) === `item_${it.type}` ? ITEMS[it.type]?.label || it.type : T(`item_${it.type}`)}</span>
        {!readOnly && <span className="act" style={{ display: 'inline-flex', gap: 2 }}>
          <button type="button" className="btn sm ghost icon" disabled={i === 0} onClick={() => reorderItem(it.id, -1)} title={T('outlineBackward')} aria-label={`${T('outlineBackward')}: ${it.name}`}>↑</button>
          <button type="button" className="btn sm ghost icon" disabled={i === list.length - 1} onClick={() => reorderItem(it.id, 1)} title={T('outlineForward')} aria-label={`${T('outlineForward')}: ${it.name}`}>↓</button>
          {parent && <button type="button" className="btn sm ghost icon" onClick={() => moveOutOfParent(it.id)} title={T('outlineMoveOut', { name: parent.name })} aria-label={`${T('outlineMoveOut', { name: parent.name })}: ${it.name}`}>⇱</button>}
        </span>}
      </div>
      {NESTING.has(it.type) && (it.items || []).length > 0 && <ul className="tree">{rows(it.items, it, depth + 1)}</ul>}
    </li>
  ));
  return (
    <div className="pane" data-testid="outline">
      <h4>{T('outline')}</h4>
      <div className="pane-body">
        {sectionList(def).map(({ key, label }) => {
          const items = secOf(def, key)?.items || [];
          if (!items.length && key !== 'body') return null;
          return (
            <div key={key}>
              <button type="button" className={`linklike outline-band${sel.kind === 'section' && sel.section === key ? ' sel' : ''}`} onClick={() => useDesigner.getState().select({ kind: 'section', section: key })}><b>{label}</b></button>
              <ul className="tree">{items.length ? rows(items, null, 1) : <li className="subtle">{T('outlineEmpty')}</li>}</ul>
            </div>
          );
        })}
        <div className="hint">{T('outlineHint')}</div>
      </div>
    </div>
  );
}
