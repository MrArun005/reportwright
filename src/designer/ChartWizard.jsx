'use client';
// Chart gallery: every chart type drawn live with the report's own data (the API in Data sources is called),
// next to a preview of the rows and the raw response. Pick a data set, the fields and a type, then insert.
import { useEffect, useMemo, useState } from 'react';
import { useDesigner, addItem, updateItem, findItem } from './store.js';
import { loadSample } from './DataPanel.jsx';
import { paintItemSvg } from './Canvas.jsx';
import { Dialog, Field, Select, Check } from './ui.jsx';

const TYPES = [
  { type: 'column', label: 'Column', when: 'Compare a few categories' },
  { type: 'bar', label: 'Bar', when: 'Rankings, long names' },
  { type: 'line', label: 'Line', when: 'A trend over time' },
  { type: 'area', label: 'Area', when: 'Volume over time' },
  { type: 'pie', label: 'Pie', when: 'Share of a whole, ≤ 6 slices' },
  { type: 'donut', label: 'Donut', when: 'Share, with the total' },
  { type: 'scatter', label: 'Scatter', when: 'Two numbers per row' },
];
const AGGS = [
  { value: 'Sum', label: 'Sum' }, { value: 'Avg', label: 'Average' }, { value: 'Count', label: 'Count of rows' },
  { value: 'CountDistinct', label: 'Count distinct' }, { value: 'Min', label: 'Minimum' }, { value: 'Max', label: 'Maximum' },
];
const THUMB = { w: 250, h: 150 };
const BIG = { w: 520, h: 290 };

/** The chart item a configuration produces. */
export function chartFromConfig(c, size) {
  const valueExpr = c.agg === 'Count' ? '=CountRows()' : `=${c.agg}(Fields.${c.value})`;
  const aggLabel = AGGS.find(a => a.value === c.agg)?.label || c.agg;
  const name = c.agg === 'Count' ? 'Rows' : `${aggLabel} of ${c.value}`;
  const out = {
    type: 'chart', x: 0, y: 0, w: size.w, h: size.h, chartType: c.chartType, dataSet: c.dataSet,
    title: c.title ?? '', category: c.category ? `=Fields.${c.category}` : '',
    series: [{ name, value: valueExpr }], valueFormat: c.format || 'N0', legend: 'bottom',
  };
  if (c.split && c.chartType !== 'pie' && c.chartType !== 'donut' && c.chartType !== 'scatter') out.seriesGroup = `=Fields.${c.split}`;
  if (c.stacked && out.seriesGroup) out.stacked = true;
  if (c.top > 0) out.maxCategories = Number(c.top);
  if (c.chartType === 'scatter') { out.xValue = `=Fields.${c.category}`; out.series = [{ name: c.value, value: `=Sum(Fields.${c.value})` }]; }
  return out;
}

/** Read a configuration back from a chart made here (or close to it). */
function configFromChart(item) {
  const field = (e) => (typeof e === 'string' && /^=Fields\.(\w+)$/.test(e) ? e.slice(8) : '');
  const v = item.series?.[0]?.value || '';
  const m = /^=(\w+)\(Fields\.(\w+)\)$/.exec(v);
  return {
    chartType: item.chartType || 'column', dataSet: item.dataSet, title: item.title ?? '',
    category: field(item.chartType === 'scatter' ? item.xValue : item.category),
    agg: v === '=CountRows()' ? 'Count' : m?.[1] || 'Sum', value: m?.[2] || '', custom: !!v && v !== '=CountRows()' && !m,
    split: field(item.seriesGroup), stacked: !!item.stacked, top: item.maxCategories || 0, format: item.valueFormat || 'N0',
  };
}

/** A sensible starting chart for a data set: first text field by first number field. */
function guess(ds, rows) {
  const fields = ds?.fields || [];
  const num = fields.filter(f => f.type === 'number' && !/^(id|year|month|day)$/i.test(f.name));
  // the best category groups rows: a text field with few distinct values (category, status), not one unique per row (title)
  const strs = fields.filter(f => f.type === 'string');
  const card = (f) => new Set(rows.map(r => r[f.name])).size;
  const grouping = rows.length ? strs.filter(f => card(f) > 1 && card(f) < Math.max(3, rows.length * 0.6)).sort((a, b) => card(a) - card(b))[0] : null;
  const cat = grouping || fields.find(f => f.type === 'date') || strs[0] || fields[0];
  const distinct = cat ? new Set(rows.map(r => r[cat.name])).size : 0;
  const chartType = cat?.type === 'date' ? 'line' : distinct > 0 && distinct <= 5 ? 'donut' : distinct > 12 ? 'bar' : 'column';
  return { dataSet: ds?.name, category: cat?.name || '', value: num[0]?.name || '', agg: num[0] ? 'Sum' : 'Count', chartType, top: distinct > 15 ? 10 : 0 };
}

/** Which types fit the picked fields best (a hint, never a rule). */
function suggested(c, rows, fields) {
  const cat = fields.find(f => f.name === c.category);
  const distinct = c.category ? new Set(rows.map(r => r[c.category])).size : 0;
  if (cat?.type === 'date') return ['line', 'area'];
  if (cat?.type === 'number' && c.value) return ['scatter'];
  if (distinct && distinct <= 5) return ['donut', 'column'];
  if (distinct > 12) return ['bar'];
  return ['column', 'bar'];
}

export default function ChartWizard() {
  const wizard = useDesigner(s => s.wizard);
  const def = useDesigner(s => s.def);
  const sample = useDesigner(s => s.sample);
  const editing = wizard?.mode === 'edit' ? findItem(def, wizard.id)?.item : null;
  const close = () => useDesigner.getState().setUi({ wizard: null });

  const [c, setC] = useState(() => {
    if (editing) return configFromChart(editing);
    // start from the data set most worth charting: one with number fields and the most rows
    const score = (d) => ((d.fields || []).some(f => f.type === 'number') ? 1e6 : 0) + (sample?.dataSets?.[d.name]?.length || 0);
    const ds = [...(def.dataSets || [])].sort((a, b) => score(b) - score(a))[0];
    return { title: '', split: '', stacked: false, format: 'N0', ...guess(ds, sample?.dataSets?.[ds?.name] || []) };
  });
  const set = (patch) => setC(x => ({ ...x, ...patch, custom: false }));

  // call the APIs in Data sources once when the gallery opens without sample data
  useEffect(() => { if (!sample?.dataSets && !sample?.loading) loadSample(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ds = (def.dataSets || []).find(d => d.name === c.dataSet);
  const fields = ds?.fields || [];
  const rows = sample?.dataSets?.[c.dataSet] || [];
  const raw = ds && sample?.sources ? sample.sources[ds.source] : undefined;
  const numFields = fields.filter(f => f.type === 'number');
  const good = suggested(c, rows, fields);

  // a new data set: start from its best guess
  const pickDataSet = (name) => { const d = def.dataSets.find(x => x.name === name); setC(x => ({ ...x, split: '', ...guess(d, sample?.dataSets?.[name] || []) })); };
  // first time the data arrives for a new chart, refine the guess with real rows
  useEffect(() => {
    if (editing || !rows.length || c.touched) return;
    setC(x => ({ ...x, ...guess(ds, rows), touched: true }));
  }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // live thumbnails of every type, plus a big preview of the picked one
  const [thumbs, setThumbs] = useState({});
  const [big, setBig] = useState(null);
  const cfgKey = JSON.stringify({ ...c, touched: undefined });
  useEffect(() => {
    if (!sample?.dataSets || !c.dataSet) return;
    let alive = true;
    const t = setTimeout(async () => {
      const out = {};
      for (const ty of TYPES) {
        try { out[ty.type] = await paintItemSvg(chartFromConfig({ ...c, chartType: ty.type, title: '' }, THUMB), def, sample); }
        catch (e) { out[ty.type] = { error: e.message }; }
      }
      let b = null;
      try { b = await paintItemSvg(chartFromConfig(c, BIG), def, sample); } catch (e) { b = { error: e.message }; }
      if (alive) { setThumbs(out); setBig(b); }
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [cfgKey, sample, def]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    const { x, y, w, h, type, ...props } = chartFromConfig(c, { w: editing?.w || 360, h: editing?.h || 220 });
    if (editing) {
      updateItem(editing.id, it => {
        for (const k of ['seriesGroup', 'stacked', 'maxCategories', 'xValue']) delete it[k];
        Object.assign(it, props);
      });
    } else {
      addItem('chart', wizard.section, wizard.x, wizard.y, { ...(wizard.extra || {}), ...props, w: 360, h: 220 }, wizard.parentId);
    }
    close();
  };
  const plain = () => { addItem('chart', wizard.section, wizard.x, wizard.y, wizard.extra || {}, wizard.parentId); close(); };

  // the columns in the chart first, then the rest, up to 8
  const picked = [c.category, c.value, c.split].filter(Boolean);
  const shown = [...fields.filter(f => picked.includes(f.name)).sort((a, b) => picked.indexOf(a.name) - picked.indexOf(b.name)), ...fields.filter(f => !picked.includes(f.name))].slice(0, 8);
  const loading = sample?.loading;
  return (
    <Dialog className="cw" title={editing ? `Chart gallery · ${editing.name}` : 'Insert a chart'} onClose={close}
      footer={<>
        {!editing && <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={plain}>Insert an empty chart</button>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" onClick={apply} disabled={!c.dataSet || (!c.category && c.chartType !== 'scatter')} data-testid="chart-wizard-apply">{editing ? 'Apply to the chart' : 'Insert chart'}</button>
      </>}>
      <div className="cw-body">
        <section className="cw-side" aria-label="Data for the chart">
          <Field label="Data set"><Select value={c.dataSet} options={(def.dataSets || []).map(d => d.name)} onChange={pickDataSet} /></Field>
          <div className="cw-src">
            {ds && <span className="hint">Source <b>{ds.source}</b> · path <code>{ds.path || '$'}</code></span>}
            <button className="btn sm" onClick={loadSample} disabled={loading}>{loading ? 'Calling the API…' : 'Call the API again'}</button>
            {sample?.error && <span className="err">{sample.error}</span>}
          </div>
          <Field label={c.chartType === 'scatter' ? 'X axis (a number field)' : 'Category (x axis or slices)'}>
            <Select value={c.category} allowEmpty options={fields.map(f => ({ value: f.name, label: `${f.name} · ${f.type}` }))} onChange={v => set({ category: v || '' })} />
          </Field>
          <div className="grid2">
            <Field label="Value"><Select value={c.agg} options={AGGS} onChange={v => set({ agg: v })} /></Field>
            {c.agg !== 'Count' && <Field label="of field"><Select value={c.value} allowEmpty options={(numFields.length ? numFields : fields).map(f => f.name)} onChange={v => set({ value: v || '' })} /></Field>}
          </div>
          {c.chartType !== 'pie' && c.chartType !== 'donut' && c.chartType !== 'scatter' && <>
            <Field label="Split into series by (optional)"><Select value={c.split} allowEmpty options={fields.filter(f => f.type !== 'number').map(f => f.name)} onChange={v => set({ split: v || '' })} /></Field>
            {c.split && <Check label="Stack the series" checked={c.stacked} onChange={v => set({ stacked: v })} />}
          </>}
          <div className="grid2">
            <Field label="Show at most"><Select value={String(c.top || 0)} options={[{ value: '0', label: 'All categories' }, ...[5, 8, 10, 15, 20].map(n => ({ value: String(n), label: `First ${n}` }))]} onChange={v => set({ top: Number(v) || 0 })} /></Field>
            <Field label="Number format"><Select value={c.format} options={[{ value: 'N0', label: '1,234' }, { value: 'N2', label: '1,234.56' }, { value: 'C0', label: 'Currency' }, { value: 'P1', label: 'Percent' }]} onChange={v => set({ format: v })} /></Field>
          </div>
          <Field label="Title"><input className="input" value={c.title} onChange={e => set({ title: e.target.value })} placeholder="Optional" /></Field>
          {c.custom && <div className="hint">This chart uses a custom value expression. Applying here replaces it with the choice above.</div>}
        </section>

        <section className="cw-main" aria-label="Chart types">
          <div className="cw-gallery" role="radiogroup" aria-label="Chart type">
            {TYPES.map(t => {
              const th = thumbs[t.type];
              return (
                <button key={t.type} type="button" role="radio" aria-checked={c.chartType === t.type} className={`cw-card${c.chartType === t.type ? ' sel' : ''}`}
                  onClick={() => set({ chartType: t.type })} data-chart-type={t.type}>
                  <span className="cw-thumb">
                    {!sample?.dataSets ? <span className="hint">{loading ? 'Calling the API…' : 'No data yet'}</span>
                      : t.type === 'scatter' && fields.find(f => f.name === c.category)?.type !== 'number' ? <span className="hint">Pick a number field for the X axis</span>
                      : th?.error ? <span className="err">{th.error}</span>
                        : th ? <span dangerouslySetInnerHTML={{ __html: th.html }} /> : <span className="hint">Drawing…</span>}
                  </span>
                  <span className="cw-name">{t.label}{good.includes(t.type) && <em>Suggested</em>}</span>
                  <span className="hint">{t.when}</span>
                </button>
              );
            })}
          </div>
          <div className="cw-preview">
            <div className="cw-big">
              <h5>Preview · {TYPES.find(t => t.type === c.chartType)?.label}</h5>
              <div className="cw-paper">{big?.error ? <span className="err">{big.error}</span> : big ? <div dangerouslySetInnerHTML={{ __html: big.html }} /> : <span className="hint">Drawing…</span>}</div>
            </div>
            <div className="cw-data">
              <h5>API data · {rows.length} rows{ds?.filters?.length ? ' (after the data set filters)' : ''}</h5>
              <div className="cw-table">
                <table>
                  <thead><tr>{shown.map(f => (
                    <th key={f.name} className={f.name === c.category ? 'cw-cat' : f.name === c.value ? 'cw-val' : f.name === c.split ? 'cw-spl' : ''}>
                      <button type="button" className="linklike" title={f.type === 'number' ? `Use ${f.name} as the value` : `Use ${f.name} as the category`}
                        onClick={() => (f.type === 'number' && c.chartType !== 'scatter' ? set({ value: f.name, agg: c.agg === 'Count' ? 'Sum' : c.agg }) : set({ category: f.name }))}>{f.name}</button>
                    </th>))}</tr></thead>
                  <tbody>{rows.slice(0, 8).map((r, i) => <tr key={i}>{shown.map(f => <td key={f.name} className={f.name === c.category ? 'cw-cat' : f.name === c.value ? 'cw-val' : ''}>{fmt(r[f.name])}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <span className="hint">Click a column name to chart it (numbers become the value, the rest the category). <span className="cw-key cw-cat">category</span> <span className="cw-key cw-val">value</span></span>
              {raw !== undefined && (
                <details className="cw-raw"><summary>Raw API response</summary><pre>{rawText(raw)}</pre></details>
              )}
            </div>
          </div>
        </section>
      </div>
    </Dialog>
  );
}

function fmt(v) {
  if (v == null) return '—';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}
function rawText(raw) {
  const s = JSON.stringify(raw, null, 2) ?? String(raw);
  return s.length > 4000 ? `${s.slice(0, 4000)}\n… (${(s.length / 1024).toFixed(0)} KB in total)` : s;
}
