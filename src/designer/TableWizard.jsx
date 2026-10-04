'use client';
// Table gallery: a list, a grouped list with subtotals, a summary per group, or a matrix, each drawn live
// with the report's own rows. Pick a data set, the fields and a layout, then insert. Same look as the chart gallery.
import { useEffect, useState } from 'react';
import { useDesigner, addItem, bodyWidth, findItem } from './store.js';
import { loadSample } from './DataPanel.jsx';
import { paintItemSvg } from './Canvas.jsx';
import { tableFor, matrixFor, labelOf } from './tableGen.js';
import { Dialog, Field, Select, Check } from './ui.jsx';

const LAYOUTS = [
  { id: 'list', label: 'List', when: 'Every row, with totals' },
  { id: 'grouped', label: 'Grouped', when: 'Rows under each group, subtotals' },
  { id: 'summary', label: 'Summary', when: 'One row per group' },
  { id: 'matrix', label: 'Matrix', when: 'Groups across and down' },
];
const THUMB_W = 250;

export default function TableWizard() {
  const wiz = useDesigner(s => s.tableWizard);
  const def = useDesigner(s => s.def);
  const sample = useDesigner(s => s.sample);
  const close = () => useDesigner.getState().setUi({ tableWizard: null });
  // the band the table goes into (a landscape section is wider), or the container it is dropped in
  const parent = wiz?.parentId ? findItem(def, wiz.parentId)?.item : null;
  const width = Math.max(120, Math.round((parent ? parent.w : bodyWidth(def, wiz?.section || 'body')) - (wiz?.x || 0)));

  const [c, setC] = useState(() => ({ dataSet: wiz?.dataSet || def.dataSets?.[0]?.name, layout: wiz?.type === 'matrix' ? 'matrix' : 'list', groupBy: '', fields: null, mRows: '', mCols: '', mValue: '' }));
  const set = (patch) => setC(x => ({ ...x, ...patch }));
  useEffect(() => { if (!sample?.dataSets && !sample?.loading) loadSample(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ds = (def.dataSets || []).find(d => d.name === c.dataSet);
  const fields = ds?.fields || [];
  const rows = sample?.dataSets?.[c.dataSet] || [];
  const text = fields.filter(f => f.type !== 'number');
  const nums = fields.filter(f => f.type === 'number');
  const chosen = c.fields || fields.slice(0, 8).map(f => f.name);
  // sensible defaults once the fields are known: group by the text field with the fewest distinct values
  const card = (f) => new Set(rows.map(r => r[f.name])).size;
  const groupGuess = [...text].filter(f => !rows.length || (card(f) > 1 && card(f) < Math.max(3, rows.length * 0.6))).sort((a, b) => card(a) - card(b))[0]?.name || text[0]?.name || '';
  const groupBy = c.groupBy || groupGuess;
  const mRows = c.mRows || groupBy, mCols = c.mCols || text.find(f => f.name !== mRows)?.name || '', mValue = c.mValue || nums[0]?.name || '';

  const itemFor = (layout, w) => (layout === 'matrix'
    ? (mRows && mCols ? matrixFor(ds, { rows: mRows, columns: mCols, value: mValue, agg: mValue ? 'Sum' : 'Count', width: w, sample: rows }) : null)
    : tableFor(ds, { layout, groupBy, width: w, rows, fields: chosen }));

  const [thumbs, setThumbs] = useState({});
  const key = JSON.stringify([c, groupBy, mRows, mCols, mValue, chosen]);
  useEffect(() => {
    if (!ds || !sample?.dataSets) return;
    let alive = true;
    const t = setTimeout(async () => {
      const out = {};
      for (const l of LAYOUTS) {
        const it = itemFor(l.id, THUMB_W);
        try { out[l.id] = it ? await paintItemSvg({ ...it, x: 0, y: 0 }, def, sample) : { note: 'Needs two text fields' }; } catch (e) { out[l.id] = { error: e.message }; }
      }
      if (alive) setThumbs(out);
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [key, sample, def]); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = () => {
    const { type, x, y, ...props } = itemFor(c.layout, width);
    addItem(type, wiz.section || 'body', wiz.x || 0, wiz.y || 0, props, wiz.parentId);
    close();
  };
  const plain = () => { addItem(wiz.type || 'table', wiz.section || 'body', wiz.x || 0, wiz.y || 0, wiz.extra || {}, wiz.parentId); close(); };
  const toggleField = (name, on) => set({ fields: on ? [...chosen, name] : chosen.filter(n => n !== name) });

  if (!wiz) return null;
  return (
    <Dialog className="cw" title="Insert a table" onClose={close}
      footer={<>
        <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={plain}>Insert an empty {wiz.type === 'matrix' ? 'matrix' : 'table'}</button>
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" onClick={insert} disabled={!ds || !itemFor(c.layout, width) || sample?.loading} data-testid="table-wizard-apply">Insert {c.layout === 'matrix' ? 'matrix' : 'table'}</button>
      </>}>
      <div className="cw-body">
        <section className="cw-side" aria-label="Data for the table">
          <Field label="Data set"><Select value={c.dataSet} options={(def.dataSets || []).map(d => d.name)} onChange={v => set({ dataSet: v, fields: null, groupBy: '', mRows: '', mCols: '', mValue: '' })} /></Field>
          {sample?.loading && <span className="hint">Calling the API…</span>}
          {sample?.error && <span className="err">{sample.error}</span>}
          {c.layout !== 'matrix' && <>
            {c.layout !== 'list' && <Field label="Group by"><Select value={groupBy} options={text.map(f => f.name)} onChange={v => set({ groupBy: v })} /></Field>}
            <div role="group" aria-label="Columns">
              <div className="hint" style={{ marginBottom: 4 }}>Columns</div>
              {fields.map(f => <Check key={f.name} label={`${labelOf(f.name)} · ${f.type}`} checked={chosen.includes(f.name)} onChange={v => toggleField(f.name, v)} />)}
            </div>
          </>}
          {c.layout === 'matrix' && <>
            <Field label="Rows"><Select value={mRows} options={text.map(f => f.name)} onChange={v => set({ mRows: v })} /></Field>
            <Field label="Columns"><Select value={mCols} options={text.filter(f => f.name !== mRows).map(f => f.name)} onChange={v => set({ mCols: v })} /></Field>
            <Field label="Sum of"><Select value={mValue} allowEmpty options={nums.map(f => f.name)} onChange={v => set({ mValue: v || '' })} /></Field>
          </>}
        </section>
        <section className="cw-main" aria-label="Table layouts">
          <div className="cw-gallery" role="radiogroup" aria-label="Layout">
            {LAYOUTS.map(l => {
              const th = thumbs[l.id];
              return (
                <button key={l.id} type="button" role="radio" aria-checked={c.layout === l.id} className={`cw-card${c.layout === l.id ? ' sel' : ''}`} onClick={() => set({ layout: l.id })} data-layout={l.id}>
                  <span className="cw-thumb" style={{ overflow: 'hidden' }}>
                    {!sample?.dataSets ? <span className="hint">{sample?.loading ? 'Calling the API…' : 'No data yet'}</span>
                      : th?.error ? <span className="err">{th.error}</span>
                        : th?.note ? <span className="hint">{th.note}</span>
                          : th ? <span dangerouslySetInnerHTML={{ __html: th.html }} /> : <span className="hint">Drawing…</span>}
                  </span>
                  <span className="cw-name">{l.label}</span>
                  <span className="hint">{l.when}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
