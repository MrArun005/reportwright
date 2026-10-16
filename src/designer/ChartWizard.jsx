'use client';
// Chart gallery: every chart type drawn live with the report's own data (the API in Data sources is called),
// next to a preview of the rows and the raw response. Pick a data set, the fields and a type, then insert.
import SvgHtml from './SvgHtml.jsx';
import { useEffect, useMemo, useState } from 'react';
import { useDesigner, addItem, updateItem, findItem } from './store.js';
import { loadSample, noSourceKey } from './DataPanel.jsx';
import { paintItemSvg } from './Canvas.jsx';
import { Dialog, Field, Select, Check } from './ui.jsx';
import { labelOf, isCode, compactFormat } from './tableGen.js';
import { t } from '@/i18n/index.js';

// labels and hints in the UI language: cw_t_<type> and cw_w_<type> in src/i18n
const TYPES = ['column', 'bar', 'line', 'area', 'pie', 'donut', 'scatter', 'bubble', 'radar', 'funnel', 'gauge', 'treemap', 'histogram', 'boxplot', 'waterfall', 'gantt'];
const PER_ROW = new Set(['scatter', 'bubble']);
const NO_SPLIT = new Set(['pie', 'donut', 'scatter', 'bubble', 'funnel', 'gauge', 'treemap', 'histogram', 'boxplot', 'waterfall']);
/** Charts of each row's own value (no aggregate): a histogram bins them, a box plot takes their quartiles. */
const RAW = new Set(['histogram', 'boxplot']);
// labels: in series names (report content, English) here; in the gallery, cw_agg_<value>
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
  // the legend reads "Amount", not "Sum of amount"; other aggregates say what they are
  const name = c.agg === 'Count' ? 'Rows' : c.agg === 'Sum' ? labelOf(c.value) : `${aggLabel} ${labelOf(c.value).toLowerCase()}`;
  const out = {
    type: 'chart', x: 0, y: 0, w: size.w, h: size.h, chartType: c.chartType, dataSet: c.dataSet,
    title: c.title ?? '', category: c.category ? `=Fields.${c.category}` : '',
    series: [{ name, value: valueExpr }], valueFormat: c.format || 'N0', legend: 'bottom',
  };
  if (c.dateCategory && !PER_ROW.has(c.chartType) && c.chartType !== 'gauge') out.categorySort = 'asc'; // months in order, not as the rows come
  // month numbers (1–12) as names, in calendar order: the key is a date, shown as "Jan"
  if (c.monthNames && c.category && !PER_ROW.has(c.chartType)) { out.category = `=DateSerial(2000, Fields.${c.category}, 1)`; out.categoryFormat = 'MMM'; out.categorySort = 'asc'; }
  // big values: a compact value axis (300M, 50K); a pie or donut shows its values (and centre total) the same way
  if (c.compact && !['gauge', 'gantt', 'funnel', 'treemap'].includes(c.chartType)) {
    if (c.chartType === 'pie' || c.chartType === 'donut') out.valueFormat = c.compact;
    else out.axes = { y: { format: c.compact } };
  }
  if (c.split && !NO_SPLIT.has(c.chartType)) out.seriesGroup = `=Fields.${c.split}`;
  if (c.stacked && out.seriesGroup) out.stacked = true;
  if (typeof c.top === 'string' && c.top) out.maxCategories = c.top; // an expression set in the Inspector (=Parameters.top)
  else if (c.top > 0) out.maxCategories = Number(c.top);
  if (PER_ROW.has(c.chartType)) { out.xValue = `=Fields.${c.category}`; out.series = [{ name: c.value, value: `=Sum(Fields.${c.value})` }]; }
  if (c.chartType === 'bubble') out.series[0].size = c.size ? `=Sum(Fields.${c.size})` : '=1';
  if (c.chartType === 'gauge' || c.chartType === 'histogram') out.category = '';
  if (RAW.has(c.chartType)) out.series = [{ name: labelOf(c.value || 'Value'), value: c.value ? `=Fields.${c.value}` : '=0' }];
  if (c.chartType === 'gantt') {
    out.ganttStart = c.start ? `=Fields.${c.start}` : '';
    out.ganttEnd = c.end ? `=Fields.${c.end}` : '';
    out.series = [];
    out.legend = c.split ? 'bottom' : 'none';
  }
  return out;
}

/** Read a configuration back from a chart made here (or close to it). */
function configFromChart(item) {
  const month = /^=DateSerial\(2000, Fields\.(\w+), 1\)$/.exec(item.category || '')?.[1];
  const field = (e) => (typeof e === 'string' && /^=Fields\.(\w+)$/.test(e) ? e.slice(8) : e === item.category && month ? month : '');
  const v = item.series?.[0]?.value || '';
  const m = /^=(\w+)\(Fields\.(\w+)\)$/.exec(v) || (RAW.has(item.chartType) && /^=Fields\.(\w+)$/.test(v) ? [v, 'Sum', v.slice(8)] : null);
  return {
    start: field(item.ganttStart), end: field(item.ganttEnd),
    chartType: item.chartType || 'column', dataSet: item.dataSet, title: item.title ?? '',
    category: field(PER_ROW.has(item.chartType) ? item.xValue : item.category), size: field(item.series?.[0]?.size),
    agg: v === '=CountRows()' ? 'Count' : m?.[1] || 'Sum', value: m?.[2] || '', custom: !!v && v !== '=CountRows()' && !m,
    split: field(item.seriesGroup), stacked: !!item.stacked, top: item.maxCategories || 0, format: /,"[KMB]"$/.test(item.valueFormat || '') ? 'N0' : item.valueFormat || 'N0',
    monthNames: !!month,
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
  const dates = fields.filter(f => f.type === 'date');
  return { dataSet: ds?.name, category: cat?.name || '', value: num[0]?.name || '', agg: num[0] ? 'Sum' : 'Count', chartType, top: distinct > 15 ? 10 : 0, start: dates[0]?.name || '', end: (dates[1] || dates[0])?.name || '' };
}

/** Which types fit the picked fields best (a hint, never a rule). */
function suggested(c, rows, fields) {
  const cat = fields.find(f => f.name === c.category);
  const distinct = c.category ? new Set(rows.map(r => r[c.category])).size : 0;
  if (cat?.type === 'date') return ['line', 'area'];
  if (cat?.type === 'number' && isCode(cat.name) && /year|month|quarter|week|day/i.test(cat.name)) return ['column', 'line']; // a month or year number is a category
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
  const lang = useDesigner(s => s.lang);
  const tr = (k, v) => t(lang, `cw_${k}`, v);

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
  const dateCategory = fields.find(f => f.name === c.category)?.type === 'date';
  // a category of month numbers (1–12) can show as month names; values in the millions get a compact axis
  const monthish = fields.find(f => f.name === c.category)?.type === 'number' && /month/i.test(c.category) && rows.length > 0 && rows.every(r => r[c.category] == null || (Number.isInteger(r[c.category]) && r[c.category] >= 1 && r[c.category] <= 12));
  const compact = useMemo(() => {
    if (!c.value || c.agg === 'Count' || c.format === 'P1') return null;
    const per = new Map();
    for (const r of rows) { const v = Number(r[c.value]); if (!Number.isFinite(v)) continue; const k = c.category ? String(r[c.category]) : ''; per.set(k, c.agg === 'Sum' ? (per.get(k) || 0) + v : Math.max(per.get(k) ?? -Infinity, v)); }
    return compactFormat([...per.values()].reduce((m, v) => Math.max(m, Math.abs(v)), 0));
  }, [rows, c.value, c.agg, c.category, c.format]);
  const extra = { dateCategory, monthNames: monthish && c.monthNames !== false, compact };

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
        try { out[ty] = await paintItemSvg(chartFromConfig({ ...c, ...extra, chartType: ty, title: '' }, THUMB), def, sample); }
        catch (e) { out[ty] = { error: e.message }; }
      }
      let b = null;
      try { b = await paintItemSvg(chartFromConfig({ ...c, ...extra }, BIG), def, sample); } catch (e) { b = { error: e.message }; }
      if (alive) { setThumbs(out); setBig(b); }
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [cfgKey, sample, def]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    const { x, y, w, h, type, ...props } = chartFromConfig({ ...c, ...extra }, { w: editing?.w || 360, h: editing?.h || 220 });
    if (editing) {
      updateItem(editing.id, it => {
        for (const k of ['seriesGroup', 'stacked', 'maxCategories', 'xValue', 'category', 'categoryFormat', 'categorySort']) delete it[k];
        if (props.axes?.y?.format) it.axes = { ...(it.axes || {}), y: { ...(it.axes?.y || {}), format: props.axes.y.format } };
        delete props.axes;
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
    <Dialog className="cw" title={editing ? tr('titleEdit', { name: editing.name }) : tr('titleInsert')} onClose={close}
      footer={<>
        {!editing && <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={plain}>{tr('empty')}</button>}
        <button className="btn" onClick={close}>{tr('cancel')}</button>
        <button className="btn primary" onClick={apply} disabled={!c.dataSet || (!c.category && c.chartType !== 'gauge' && c.chartType !== 'histogram') || (c.chartType === 'gantt' && !(c.start && c.end))} data-testid="chart-wizard-apply">{editing ? tr('apply') : tr('insert')}</button>
      </>}>
      <div className="cw-body">
        <section className="cw-side" aria-label={tr('dataAria')}>
          <Field label={tr('dataSet')}><Select value={c.dataSet} options={(def.dataSets || []).map(d => d.name)} onChange={pickDataSet} /></Field>
          <div className="cw-src">
            {ds && <span className="hint">{tr('source')} <b>{ds.source}</b> · {tr('path')} <code>{ds.path || '$'}</code></span>}
            <button className="btn sm" onClick={loadSample} disabled={loading || !!noSourceKey(def)} title={noSourceKey(def) ? t(lang, noSourceKey(def)) : undefined}>{loading ? tr('calling') : tr('callAgain')}</button>
            {noSourceKey(def) && <span className="hint" role="status" data-testid="no-source">{t(lang, noSourceKey(def))}</span>}
            {sample?.error && <span className="err">{sample.error}</span>}
          </div>
          {c.chartType !== 'histogram' && <Field label={PER_ROW.has(c.chartType) ? tr('xNumber') : c.chartType === 'gantt' ? tr('task') : tr('category')}>
            <Select value={c.category} allowEmpty options={fields.map(f => ({ value: f.name, label: `${f.name} · ${f.type}` }))} onChange={v => set({ category: v || '' })} />
          </Field>}
          {c.chartType === 'gantt' ? <div className="grid2">
            <Field label={tr('start')}><Select value={c.start} allowEmpty options={fields.map(f => ({ value: f.name, label: `${f.name} · ${f.type}` }))} onChange={v => set({ start: v || '' })} data-testid="cw-gantt-start" /></Field>
            <Field label={tr('end')}><Select value={c.end} allowEmpty options={fields.map(f => ({ value: f.name, label: `${f.name} · ${f.type}` }))} onChange={v => set({ end: v || '' })} data-testid="cw-gantt-end" /></Field>
          </div> : RAW.has(c.chartType) ? <Field label={tr('rowValue')}><Select value={c.value} allowEmpty options={(numFields.length ? numFields : fields).map(f => f.name)} onChange={v => set({ value: v || '' })} /></Field> : <div className="grid2">
            <Field label={tr('value')}><Select value={c.agg} options={AGGS.map(a => ({ value: a.value, label: tr(`agg_${a.value}`) }))} onChange={v => set({ agg: v })} /></Field>
            {c.agg !== 'Count' && <Field label={tr('ofField')}><Select value={c.value} allowEmpty options={(numFields.length ? numFields : fields).map(f => f.name)} onChange={v => set({ value: v || '' })} /></Field>}
          </div>}
          {c.chartType === 'bubble' && <Field label={tr('bubbleSize')}><Select value={c.size} allowEmpty options={(numFields.length ? numFields : fields).map(f => f.name)} onChange={v => set({ size: v || '' })} /></Field>}
          {!NO_SPLIT.has(c.chartType) && <>
            <Field label={tr('split')}><Select value={c.split} allowEmpty options={fields.filter(f => f.type !== 'number').map(f => f.name)} onChange={v => set({ split: v || '' })} /></Field>
            {c.split && <Check label={tr('stack')} checked={c.stacked} onChange={v => set({ stacked: v })} />}
          </>}
          <div className="grid2">
            <Field label={tr('showAtMost')}><Select value={String(c.top || 0)} options={[{ value: '0', label: tr('allCats') }, ...[5, 8, 10, 15, 20].map(n => ({ value: String(n), label: tr('firstN', { n }) })), ...(typeof c.top === 'string' && c.top ? [{ value: c.top, label: c.top }] : [])]} onChange={v => set({ top: /^=/.test(v || '') ? v : Number(v) || 0 })} /></Field>
            <Field label={tr('format')}><Select value={c.format} options={[{ value: 'N0', label: '1,234' }, { value: 'N2', label: '1,234.56' }, { value: 'C0', label: tr('currency') }, { value: 'P1', label: tr('percent') }]} onChange={v => set({ format: v })} /></Field>
          </div>
          <Field label={tr('title')}><input className="input" value={c.title} onChange={e => set({ title: e.target.value })} placeholder={tr('optional')} /></Field>
          {/* what comes and goes with the data picked stays under the fields, so none of them moves */}
          {monthish && <Check label={t(lang, 'ux_monthNames')} checked={c.monthNames !== false} onChange={v => set({ monthNames: v })} />}
          {compact && <div className="hint" data-testid="cw-compact">{t(lang, 'ux_compactAxis')}</div>}
          {c.custom && <div className="hint">{tr('custom')}</div>}
        </section>

        <section className="cw-main" aria-label={tr('typesAria')}>
          <div className="cw-gallery" role="radiogroup" aria-label={tr('typeAria')}>
            {TYPES.map(type => {
              const th = thumbs[type];
              return (
                <button key={type} type="button" role="radio" aria-label={tr(`t_${type}`)} aria-checked={c.chartType === type} className={`cw-card${c.chartType === type ? ' sel' : ''}`}
                  onClick={() => set({ chartType: type })} data-chart-type={type}>
                  <span className="cw-thumb">
                    {!sample?.dataSets ? <span className="hint">{loading ? tr('calling') : tr('noData')}</span>
                      : PER_ROW.has(type) && fields.find(f => f.name === c.category)?.type !== 'number' ? <span className="hint">{tr('pickNumber')}</span>
                      : th?.error ? <span className="err">{th.error}</span>
                        : th ? <SvgHtml html={th.html} /> : <span className="hint">{tr('drawing')}</span>}
                  </span>
                  <span className="cw-name">{tr(`t_${type}`)}{good.includes(type) && <em>{tr('suggested')}</em>}</span>
                  <span className="hint">{tr(`w_${type}`)}</span>
                </button>
              );
            })}
          </div>
          <div className="cw-preview">
            <div className="cw-big">
              <h5>{tr('preview', { type: tr(`t_${c.chartType}`) })}</h5>
              <div className="cw-paper">{big?.error ? <span className="err">{big.error}</span> : big ? <SvgHtml as="div" html={big.html} /> : <span className="hint">{tr('drawing')}</span>}</div>
            </div>
            <div className="cw-data">
              <h5>{tr(ds?.filters?.length ? 'apiDataFiltered' : 'apiData', { n: rows.length })}</h5>
              <div className="cw-table">
                <table>
                  <thead><tr>{shown.map(f => (
                    <th key={f.name} className={f.name === c.category ? 'cw-cat' : f.name === c.value ? 'cw-val' : f.name === c.split ? 'cw-spl' : ''}>
                      <button type="button" className="linklike" title={tr(f.type === 'number' ? 'useValue' : 'useCategory', { name: f.name })}
                        onClick={() => (f.type === 'number' && !PER_ROW.has(c.chartType) ? set({ value: f.name, agg: c.agg === 'Count' ? 'Sum' : c.agg }) : set({ category: f.name }))}>{f.name}</button>
                    </th>))}</tr></thead>
                  <tbody>{rows.slice(0, 8).map((r, i) => <tr key={i}>{shown.map(f => <td key={f.name} className={f.name === c.category ? 'cw-cat' : f.name === c.value ? 'cw-val' : ''}>{fmt(r[f.name], f.name, def.locale)}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <span className="hint">{tr('clickHint')} <span className="cw-key cw-cat">{tr('keyCategory')}</span> <span className="cw-key cw-val">{tr('keyValue')}</span></span>
              {raw !== undefined && (
                <details className="cw-raw"><summary>{tr('raw')}</summary><pre>{rawText(raw)}</pre></details>
              )}
            </div>
          </div>
        </section>
      </div>
    </Dialog>
  );
}

/** A sample value as the report shows numbers: its locale's grouping (en-IN: 12,34,567), not the browser's. */
function fmt(v, name = '', locale = undefined) {
  if (v == null) return '—';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && isCode(name)) return String(v); // a year is 2026, an id 2785
  if (typeof v === 'number') { try { return v.toLocaleString(locale || undefined, { maximumFractionDigits: 2 }); } catch { return v.toLocaleString(undefined, { maximumFractionDigits: 2 }); } }
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}
function rawText(raw) {
  const s = JSON.stringify(raw, null, 2) ?? String(raw);
  return s.length > 4000 ? `${s.slice(0, 4000)}\n… (${(s.length / 1024).toFixed(0)} KB in total)` : s;
}
