'use client';
// Pivot wizard: fields dragged (or sent with a click) to Rows, Columns and Values, each value with its aggregate and
// "show as" (% of total, row or column), drawn live with the sample rows; inserts a Phase 4 tablix matrix.
// Instant visuals: tick fields, get a suggested chart, table and pivot drawn live, insert one.
import { useEffect, useState } from 'react';
import { useDesigner, addItem, bodyWidth, secOf } from './store.js';
import { loadSample, noSourceKey } from './DataPanel.jsx';
import { paintItemSvg } from './Canvas.jsx';
import { tableFor, labelOf, formatFor } from './tableGen.js';
import { Dialog, Field, Select, Check } from './ui.jsx';
import { useT } from './Reuse.jsx';
import { ITEMS } from '@/engine/items/index.js';

const MIME_PF = 'application/x-pw-pivot-field';
const AGGS = ['Sum', 'Avg', 'Count', 'Min', 'Max'];
const SHOWS = ['value', 'percentOfTotal', 'percentOfRow', 'percentOfColumn'];
const ident = (f) => f.replace(/\W/g, '').replace(/^./, c => c.toUpperCase()) || 'Group';

/** The tablix matrix for a pivot layout. rows/columns: field names; values: [{ field, agg, show }]. */
export function pivotFor(ds, { rows = [], columns = [], values = [], width = 523, sample = [], totals = true, currency }) {
  const fields = ds.fields || [];
  const used = new Set();
  const group = (f) => { let n = ident(f), k = 2; while (used.has(n)) n = `${ident(f)}${k++}`; used.add(n); return { name: n, expr: `=Fields.${f}`, sort: 'asc', ...(totals ? { total: 'after' } : {}) }; }; // a group's `label` is an expression per instance: not set
  const vals = (values.length ? values : [{ field: null, agg: 'Count' }]).map(v => {
    const f = fields.find(x => x.name === v.field);
    const agg = v.agg || (f?.type === 'number' ? 'Sum' : 'Count');
    const pct = v.show && v.show !== 'value';
    return {
      label: v.field ? `${agg} of ${labelOf(v.field)}` : 'Count',
      value: agg === 'Count' ? (v.field ? `=Count(Fields.${v.field})` : '=CountRows()') : `=${agg}(Fields.${v.field})`,
      ...(pct ? { show: v.show } : { format: agg === 'Count' ? 'N0' : (f && formatFor(f, sample, { currency })) || 'N2' }),
    };
  });
  return { type: 'matrix', dataSet: ds.name, w: width, h: 54, ...(rows[0] ? { corner: labelOf(rows[0]) } : {}), rowGroups: rows.map(group), columnGroups: columns.map(group), values: vals, repeatHeader: true };
}

/** One live thumbnail of an item with the sample data. */
function Thumb({ item }) {
  const T = useT();
  const def = useDesigner(s => s.def);
  const sample = useDesigner(s => s.sample);
  const [svg, setSvg] = useState(null);
  const key = JSON.stringify(item);
  useEffect(() => {
    if (!item || !sample?.dataSets) return undefined;
    let alive = true;
    const t = setTimeout(() => { paintItemSvg({ ...ITEMS[item.type].defaults(), ...item, x: 0, y: 0 }, def, sample).then(o => { if (alive) setSvg(o); }, e => { if (alive) setSvg({ error: e.message }); }); }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [key, sample]); // eslint-disable-line react-hooks/exhaustive-deps
  // no data source or a failed load: say so, not an endless "…"
  if (!svg) return <span className="hint">{(noSourceKey(def) && T(noSourceKey(def))) || sample?.error || '…'}</span>;
  if (svg.error) return <span className="err">{svg.error}</span>;
  return <span dangerouslySetInnerHTML={{ __html: svg.html }} />;
}

function useData(name) {
  const def = useDesigner(s => s.def);
  const sample = useDesigner(s => s.sample);
  useEffect(() => { if (!sample?.dataSets && !sample?.loading) loadSample(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ds = (def.dataSets || []).find(d => d.name === name);
  return { def, ds, fields: ds?.fields || [], rows: sample?.dataSets?.[name] || [] };
}

/** Where an inserted item goes: the place the wizard was opened for, else under the body's last item. */
function placeOf(w, def) {
  const section = w.section || 'body';
  if (w.x != null && w.y != null) return { section, x: w.x, y: w.y, parentId: w.parentId };
  const items = secOf(def, section)?.items || [];
  return { section, x: 0, y: items.length ? Math.ceil(Math.max(...items.map(i => i.y + i.h)) + 8) : 0 };
}

export default function PivotWizard() {
  const T = useT();
  const w = useDesigner(s => s.pivotWizard);
  const [dsName, setDs] = useState(() => w?.dataSet || useDesigner.getState().def.dataSets?.[0]?.name);
  const { def, ds, fields, rows } = useData(dsName);
  const [lay, setLay] = useState({ rows: [], columns: [], values: [] });
  const [totals, setTotals] = useState(true);
  const close = () => useDesigner.getState().setUi({ pivotWizard: null });
  const width = Math.round(bodyWidth(def, w?.section || 'body') - (w?.x || 0));
  const add = (zone, f) => setLay(l => {
    const clean = { rows: l.rows.filter(x => x !== f), columns: l.columns.filter(x => x !== f), values: l.values };
    if (zone === 'values') return { ...clean, rows: l.rows, columns: l.columns, values: [...l.values, { field: f, agg: fields.find(x => x.name === f)?.type === 'number' ? 'Sum' : 'Count', show: 'value' }] };
    return { ...clean, [zone]: [...clean[zone], f] };
  });
  const remove = (zone, i) => setLay(l => ({ ...l, [zone]: l[zone].filter((_, k) => k !== i) }));
  const setV = (i, k, v) => setLay(l => ({ ...l, values: l.values.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const item = ds && (lay.rows.length || lay.columns.length) ? pivotFor(ds, { ...lay, width, sample: rows, totals, currency: def.currency }) : null;
  const insert = () => {
    const { type, ...props } = pivotFor(ds, { ...lay, width, sample: rows, totals, currency: def.currency });
    const at = placeOf(w, def);
    addItem(type, at.section, at.x, at.y, props, at.parentId);
    close();
  };
  const zone = (z, title) => (
    <div className="pv-zone" data-zone={z} aria-label={title}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(MIME_PF)) e.preventDefault(); }}
      onDrop={(e) => { const f = e.dataTransfer.getData(MIME_PF); if (f) { e.preventDefault(); add(z, f); } }}>
      <b>{title}</b>
      {lay[z].length === 0 && <span className="hint">{T('pivotDropHere')}</span>}
      {z !== 'values' && lay[z].map((f, i) => (
        <span key={f} className="pv-chip">{labelOf(f)}<button type="button" className="btn sm ghost" onClick={() => remove(z, i)} aria-label={`${T('remove')}: ${f}`}>✕</button></span>
      ))}
      {z === 'values' && lay.values.map((v, i) => (
        <div key={i} className="pv-chip pv-value">
          <span>{labelOf(v.field)}</span>
          <Select value={v.agg} options={AGGS} onChange={x => setV(i, 'agg', x || 'Sum')} aria-label={T('pivotAggregate')} data-testid={`pv-agg-${i}`} />
          <Select value={v.show} options={SHOWS.map(k => ({ value: k, label: T(`pivotShow_${k}`) }))} onChange={x => setV(i, 'show', x || 'value')} aria-label={T('pivotShowAs')} data-testid={`pv-show-${i}`} />
          <button type="button" className="btn sm ghost" onClick={() => remove('values', i)} aria-label={`${T('remove')}: ${v.field}`}>✕</button>
        </div>
      ))}
    </div>
  );
  if (!w) return null;
  return (
    <Dialog className="cw" title={T('pivotWizard')} onClose={close}
      footer={<><button className="btn" onClick={close}>{T('cancel')}</button><button className="btn primary" disabled={!item} onClick={insert} data-testid="pivot-wizard-insert">{T('pivotInsert')}</button></>}>
      <div className="cw-body">
        <section className="cw-side" aria-label={T('pivotFields')}>
          {noSourceKey(def) && <div className="hint" role="status" data-testid="no-source">{T(noSourceKey(def))}</div>}
          <Field label={T('dataSet')}><Select value={dsName} options={(def.dataSets || []).map(d => d.name)} onChange={v => { setDs(v); setLay({ rows: [], columns: [], values: [] }); }} /></Field>
          <ul className="tree" data-testid="pivot-fields">
            {fields.map(f => (
              <li key={f.name} className="trow field-chip" draggable data-field={f.name}
                onDragStart={(e) => { e.dataTransfer.setData(MIME_PF, f.name); e.dataTransfer.effectAllowed = 'copy'; }}>
                <span className="nm">{labelOf(f.name)}</span>
                <span className="act" style={{ display: 'inline-flex', gap: 2 }}>
                  <button type="button" className="btn sm ghost" onClick={() => add('rows', f.name)} data-testid={`pv-rows-${f.name}`}>{T('pivotToRows')}</button>
                  <button type="button" className="btn sm ghost" onClick={() => add('columns', f.name)} data-testid={`pv-columns-${f.name}`}>{T('pivotToColumns')}</button>
                  <button type="button" className="btn sm ghost" onClick={() => add('values', f.name)} data-testid={`pv-values-${f.name}`}>{T('pivotToValues')}</button>
                </span>
              </li>
            ))}
            {!fields.length && <li className="subtle">{T('pivotNoFields')}</li>}
          </ul>
          <Check label={T('pivotTotals')} checked={totals} onChange={setTotals} />
        </section>
        <section className="cw-main">
          <div className="pv-zones">{zone('rows', T('pivotRows'))}{zone('columns', T('pivotColumns'))}{zone('values', T('pivotValues'))}</div>
          <div className="cw-thumb pv-preview" data-testid="pivot-preview">{item ? <Thumb item={item} /> : <span className="hint">{T('pivotPreviewHint')}</span>}</div>
        </section>
      </div>
    </Dialog>
  );
}

/** Suggestions for the ticked fields: a chart, a table and a pivot. */
export function suggestions(ds, picked, width, rows, currency) {
  const fields = (ds.fields || []).filter(f => picked.includes(f.name));
  const text = fields.filter(f => f.type !== 'number'), nums = fields.filter(f => f.type === 'number');
  const out = [];
  if (text.length && nums.length) {
    out.push({ kind: 'chart', item: { type: 'chart', dataSet: ds.name, w: Math.min(width, 420), h: 200, chartType: text.length > 1 ? 'column' : nums.length > 1 ? 'line' : 'column', category: `=Fields.${text[0].name}`, ...(text[1] ? { seriesGroup: `=Fields.${text[1].name}` } : {}), series: nums.slice(0, 3).map(n => ({ name: labelOf(n.name), value: `=Sum(Fields.${n.name})` })), legend: 'bottom', valueFormat: 'N0', title: `${nums.map(n => labelOf(n.name)).join(', ')} by ${labelOf(text[0].name)}` } });
  }
  if (fields.length) out.push({ kind: 'table', item: tableFor(ds, { layout: text.length && nums.length ? 'summary' : 'list', groupBy: text[0]?.name, width, rows, currency, fields: fields.map(f => f.name) }) });
  if (text.length) out.push({ kind: 'pivot', item: pivotFor(ds, { rows: [text[0].name], columns: text[1] ? [text[1].name] : [], values: nums.slice(0, 2).map(n => ({ field: n.name, agg: 'Sum' })), width, sample: rows, currency }) });
  return out;
}

export function InstantVisuals() {
  const T = useT();
  const w = useDesigner(s => s.instantVisuals);
  const { def, ds, fields, rows } = useData(w?.dataSet);
  const [picked, setPicked] = useState(() => (ds?.fields || []).slice(0, 2).map(f => f.name));
  const close = () => useDesigner.getState().setUi({ instantVisuals: null });
  const width = Math.round(bodyWidth(def, 'body'));
  const list = ds ? suggestions(ds, picked, width, rows, def.currency) : [];
  const insert = (s) => {
    const { type, x: _x, y: _y, ...props } = s.item;
    const at = placeOf(w, def);
    addItem(type, at.section, at.x, at.y, props);
    close();
  };
  if (!w) return null;
  return (
    <Dialog className="cw" title={T('instantVisuals')} onClose={close} footer={<button className="btn" onClick={close}>{T('close')}</button>}>
      <div className="cw-body">
        <section className="cw-side" aria-label={T('pivotFields')}>
          {noSourceKey(def) && <div className="hint" role="status" data-testid="no-source">{T(noSourceKey(def))}</div>}
          <div className="hint">{T('instantHint')}</div>
          {fields.map(f => <Check key={f.name} label={`${labelOf(f.name)} · ${f.type}`} checked={picked.includes(f.name)} onChange={v => setPicked(p => (v ? [...p, f.name] : p.filter(n => n !== f.name)))} />)}
        </section>
        <section className="cw-main">
          <div className="cw-gallery" data-testid="instant-visuals">
            {list.map(s => (
              <button key={s.kind} type="button" className="cw-card" onClick={() => insert(s)} data-visual={s.kind}>
                <span className="cw-thumb" style={{ overflow: 'hidden' }}><Thumb item={{ ...s.item, w: Math.min(s.item.w, 260) }} /></span>
                <span className="cw-name">{T(`instant_${s.kind}`)}</span>
              </button>
            ))}
            {!list.length && <span className="hint">{T('instantPick')}</span>}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
