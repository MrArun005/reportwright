'use client';
import { useEffect, useState } from 'react';
import { rowArrays, bestRows } from './explore.js';
import { useDesigner, walk } from './store.js';
import { MIME_FIELD, MIME_DATASET } from './Canvas.jsx';
import { loadSources, buildDataSets, detectFields, jsonPath, sourceRows, isXmlDoc, FETCHED_TYPES } from '@/engine/data/index.js';
import { xmlRowPaths, bestXmlRows } from '@/engine/data/xml.js';
import { parseXml } from '@/importers/xml.js';
import ODataEditor from './ODataEditor.jsx';
import SqlBuilder from './SqlBuilder.jsx';
import { buildSql } from './sqlBuild.js';
import { resolveParameters } from '@/engine/index.js';
import { functionTable } from '@/engine/expr/evaluate.js';
import { Dialog, Field, TextInput, Select, Check } from './ui.jsx';
import { t } from '@/i18n/index.js';
import { origin } from '@/viewer/engineClient.js';
import { reportFetch } from '@/viewer/dataFetch.js';
import { OPS } from './Inspector.jsx';
import { nestedFields } from './fieldCheck.js';

const NAME = /^[A-Za-z_][\w]*$/;

/** The i18n key saying why sample data cannot load (the report has no data source), else null. */
export const noSourceKey = (def) => ((def?.dataSources || []).length ? null : 'r4_noDataSource');

/** Load every source and build data sets with parameter defaults. Used for previews and field detection. */
export async function loadSample() {
  const { def } = useDesigner.getState();
  useDesigner.setState({ sample: { loading: true } });
  try {
    const params = resolveParameters(def, {});
    const sources = await loadSources(def, { params, baseUrl: origin(), sqlPreview: true, fetch: reportFetch(origin(), undefined, { sqlPreview: true }) }); // the ReportWright server, also when embedded
    const ctx = { params, globals: { ExecutionTime: new Date() }, dataSets: {}, fields: null, locale: def.locale, currency: def.currency, functions: functionTable(def) };
    const dataSets = buildDataSets(def, sources, ctx);
    useDesigner.setState({ sample: { dataSets, sources, at: Date.now() } });
  } catch (e) {
    useDesigner.setState({ sample: { error: e.message } });
  }
}

export default function DataPanel() {
  const def = useDesigner(s => s.def);
  const lang = useDesigner(s => s.lang);
  const T = (k, v) => t(lang, k, v);
  const sample = useDesigner(s => s.sample);
  const [dlg, setDlg] = useState(null);
  const [open, setOpen] = useState(() => new Set((def.dataSets || []).map(d => d.name)));
  const toggle = (n) => setOpen(s => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  // embedded: data sources the host app offers ready-made, { label, source: { name, type, url, … } }
  const templates = useDesigner(s => s.embed?.dataSourceTemplates) || [];
  const addFromTemplate = (tpl) => {
    const src = JSON.parse(JSON.stringify(tpl.source || tpl));
    useDesigner.getState().apply(d => {
      const names = new Set((d.dataSources || []).map(x => x.name));
      let name = String(src.name || 'source'), n = 1;
      while (names.has(name)) name = `${src.name || 'source'}${++n}`;
      (d.dataSources ||= []).push({ ...src, name });
    });
    loadSample();
  };

  return (
    <>
      <div className="pane">
        <h4>Parameters <button className="btn sm ghost" onClick={() => setDlg({ kind: 'param' })}>+ Add</button></h4>
        <div className="pane-body">
          <ul className="tree">
            {(def.parameters || []).map((p, i) => (
              <li key={p.name} className="trow" onDoubleClick={() => setDlg({ kind: 'param', index: i })}>
                <span className="nm">{p.name}</span><span className="ty">{p.type || 'string'}</span>
                {p.optionsFrom && !p.optionsFrom.value && <span className="warn-dot" role="img" aria-label={T('ux_paramNoValueField')} title={T('ux_paramNoValueField')} data-testid={`param-warn-${p.name}`}>!</span>}
                <button className="btn sm ghost act" onClick={() => setDlg({ kind: 'param', index: i })} aria-label={`${T('ux_edit')} ${p.name}`}>{T('ux_edit')}</button>
              </li>
            ))}
            {!(def.parameters || []).length && <li className="subtle">None</li>}
          </ul>
        </div>
      </div>
      <div className="pane">
        <h4>Data sources <button className="btn sm ghost" onClick={() => setDlg({ kind: 'source' })}>+ Add</button></h4>
        {templates.length > 0 && (
          <div className="pane-body" style={{ paddingBottom: 0 }}>
            <select className="select" style={{ width: '100%' }} value="" aria-label="Add a data source from a template" data-testid="source-templates"
              onChange={e => { const tpl = templates[Number(e.target.value)]; if (tpl) addFromTemplate(tpl); }}>
              <option value="">+ Add from a template…</option>
              {templates.map((tpl, i) => <option key={i} value={i}>{tpl.label || (tpl.source || tpl).name}</option>)}
            </select>
          </div>
        )}
        <div className="pane-body">
          <ul className="tree">
            {(def.dataSources || []).map((s, i) => (
              <li key={s.name} className="trow" onDoubleClick={() => setDlg({ kind: 'source', index: i })}>
                <span className="nm">{s.name}</span><span className="ty">{s.type}</span>
                <button className="btn sm ghost act" onClick={() => setDlg({ kind: 'source', index: i })} aria-label={`${T('ux_edit')} ${s.name}`}>{T('ux_edit')}</button>
              </li>
            ))}
            {!(def.dataSources || []).length && <li className="subtle">None. Add a REST, JSON or CSV source.</li>}
          </ul>
        </div>
      </div>
      <div className="pane">
        <h4>Data sets <button className="btn sm ghost" disabled={!(def.dataSources || []).length} onClick={() => setDlg({ kind: 'dataset' })}>+ Add</button></h4>
        <div className="pane-body">
          <ul className="tree">
            {(def.dataSets || []).map((d, i) => (
              <li key={d.name}>
                <div className="trow" onDoubleClick={() => setDlg({ kind: 'dataset', index: i })}>
                  <button className="btn sm ghost icon" style={{ width: 18, height: 18 }} onClick={() => toggle(d.name)} aria-label="Show fields" aria-expanded={open.has(d.name)}>{open.has(d.name) ? '▾' : '▸'}</button>
                  <span className="nm" draggable title="Drag onto the page for a table of these rows"
                    onDragStart={(e) => { e.dataTransfer.setData(MIME_DATASET, JSON.stringify({ dataSet: d.name })); e.dataTransfer.effectAllowed = 'copy'; }}><b>{d.name}</b></span>
                  <span className="ty">{sample?.dataSets?.[d.name] ? `${sample.dataSets[d.name].length} rows` : ''}</span>
                  <button className="btn sm ghost act" onClick={() => setDlg({ kind: 'dataset', index: i })} aria-label={`${T('ux_edit')} ${d.name}`}>{T('ux_edit')}</button>
                </div>
                {(d.fields || []).length > 0 && <div className="btnrow" style={{ margin: '2px 0 4px 22px' }}>
                  <button type="button" className="btn sm ghost" onClick={() => useDesigner.getState().setUi({ instantVisuals: { dataSet: d.name } })} data-testid={`instant-${d.name}`}>{T('instantVisuals')}</button>
                  <button type="button" className="btn sm ghost" onClick={() => useDesigner.getState().setUi({ pivotWizard: { dataSet: d.name } })} data-testid={`pivot-wizard-${d.name}`}>{T('pivotWizard')}</button>
                </div>}
                {open.has(d.name) && (
                  <ul className="tree" style={{ paddingLeft: 18 }}>
                    {(d.fields || []).flatMap(f => (f.type === 'object' ? (f.fields || []).map(c => ({ name: `${f.name}.${c.name}`, type: c.type, nested: true })) : [f])).map(f => (
                      <li key={f.name} className={`trow field-chip${f.nested ? ' nested' : ''}`} draggable title="Drag onto the page or a table cell" data-field={f.name}
                        onDragStart={(e) => { e.dataTransfer.setData(MIME_FIELD, JSON.stringify({ dataSet: d.name, field: f.name, type: f.type })); e.dataTransfer.effectAllowed = 'copy'; }}>
                        <span className="nm">{f.name}</span><span className="ty">{f.type}</span>
                      </li>
                    ))}
                    {!(d.fields || []).length && <li className="subtle">No fields. Edit the data set and detect them.</li>}
                  </ul>
                )}
              </li>
            ))}
            {!(def.dataSets || []).length && <li className="subtle">None</li>}
          </ul>
          <div className="btnrow" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={loadSample} disabled={sample?.loading || !!noSourceKey(def)} title={noSourceKey(def) ? T(noSourceKey(def)) : undefined} data-testid="load-sample">{sample?.loading ? 'Loading…' : 'Load sample data'}</button>
          </div>
          {noSourceKey(def) && <div className="hint" role="status" style={{ marginTop: 6 }} data-testid="no-source">{T(noSourceKey(def))}</div>}
          {sample?.error && <div className="err" style={{ marginTop: 6 }}>{sample.error}</div>}
        </div>
      </div>
      {dlg?.kind === 'param' && <ParamDialog index={dlg.index} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'source' && <SourceDialog index={dlg.index} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'dataset' && <DataSetDialog index={dlg.index} onClose={() => { setDlg(null); }} onSaved={(n) => setOpen(s => new Set([...s, n]))} />}
    </>
  );
}

/* ---------------------------------------------------------------- dialogs */
function uniqueIn(list, name, skip) { return !(list || []).some((x, i) => i !== skip && x.name === name); }

/** One line of the fixed choices box: "value" or "value=label". A choice is a plain value or { value, label }. */
const optionLine = (o) => (o != null && typeof o === 'object' ? (o.label != null && String(o.label) !== String(o.value) ? `${o.value}=${o.label}` : String(o.value)) : String(o));
function parseOptionLine(l, type) {
  const [raw, ...lb] = l.split('=');
  const v = raw.trim();
  const value = type === 'number' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
  return lb.length ? { value, label: lb.join('=').trim() || v } : value;
}

const EDITORS = ['slider', 'range', 'dateRange', 'radio', 'list', 'toggle'];
const RANGE_EDITORS = new Set(['range', 'dateRange']);

function ParamDialog({ index, onClose }) {
  const def = useDesigner(s => s.def);
  const lang = useDesigner(s => s.lang);
  const T = (k, v) => t(lang, k, v);
  const orig = index != null ? def.parameters[index] : null;
  const [p, setP] = useState(orig || { name: '', type: 'string', prompt: '', default: '', required: false });
  const [columns, setColumns] = useState(String(def.parameterLayout?.columns || 1));
  const [live, setLive] = useState(def.liveParameters !== false);
  // the box keeps what is typed ("North=" mid-word); the choices are parsed from it
  const [choicesText, setChoicesText] = useState(() => (p.options || []).map(optionLine).join('\n'));
  const fromFields = (def.dataSets?.find(d => d.name === p.optionsFrom?.dataSet)?.fields || []).map(f => f.name);
  // the label is an expression: a field picks =Fields.x; another expression from the file stays as one more choice
  const labelOpts = [...fromFields.map(f => ({ value: `=Fields.${f}`, label: f })), ...(p.optionsFrom?.label && !fromFields.some(f => `=Fields.${f}` === p.optionsFrom.label) ? [{ value: p.optionsFrom.label, label: p.optionsFrom.label }] : [])];
  // choices from a data set need a value field: the select shows a placeholder until one is picked, and Save waits for it
  const err = !NAME.test(p.name) ? T('paramNameRule') : !uniqueIn(def.parameters, p.name, index) ? T('paramNameTaken')
    : p.optionsFrom && !p.optionsFrom.value ? T('ux_paramPickValueField') : null;
  const sampleRows = useDesigner(s => s.sample?.dataSets?.[p.optionsFrom?.dataSet]);
  const fieldOf = (e) => /^=Fields\.(\w+)$/.exec(e || '')?.[1];
  const choicePreview = (() => {
    const vf = fieldOf(p.optionsFrom?.value);
    if (!vf || !Array.isArray(sampleRows)) return null;
    const lf = fieldOf(p.optionsFrom.label) || vf;
    const seen = new Set(), list = [];
    for (const r of sampleRows) { const v = r?.[vf]; if (v == null || seen.has(v)) continue; seen.add(v); list.push(String(r[lf] ?? v)); }
    return list;
  })();
  /** A data set picked for the choices: the value field defaults to the one it had (when that set has it), else the first field. */
  const pickChoiceSet = (v) => {
    if (!v) { setP({ ...p, optionsFrom: undefined }); return; }
    const fs = (def.dataSets?.find(d => d.name === v)?.fields || []).map(f => f.name);
    const keep = fieldOf(p.optionsFrom?.value);
    const value = keep && fs.includes(keep) ? `=Fields.${keep}` : fs[0] ? `=Fields.${fs[0]}` : '';
    const label = p.optionsFrom?.label && fs.includes(fieldOf(p.optionsFrom.label)) ? p.optionsFrom.label : undefined;
    setP({ ...p, optionsFrom: { dataSet: v, value, ...(label ? { label } : {}) } });
  };
  // a limit is a number for number parameters, a date (yyyy-mm-dd) for date parameters
  const limit = (v) => (v === '' || v == null ? undefined : p.type === 'number' && !Number.isNaN(Number(v)) ? Number(v) : v);
  const setEditor = (editor) => setP({ ...p, editor, ...(RANGE_EDITORS.has(editor) ? { multi: true } : {}) });
  const save = () => {
    useDesigner.getState().apply(d => {
      d.parameters ||= [];
      const v = { ...p }; if (v.default === '') delete v.default; if (!v.prompt) delete v.prompt;
      if (!v.editor) { delete v.editor; delete v.min; delete v.max; delete v.step; }
      for (const k of ['min', 'max', 'step']) if (v[k] === undefined) delete v[k];
      if (index != null) d.parameters[index] = v; else d.parameters.push(v);
      const n = Number(columns);
      if (n > 1) d.parameterLayout = { ...(d.parameterLayout || {}), columns: n }; else delete d.parameterLayout;
      if (live) delete d.liveParameters; else d.liveParameters = false;
    });
    onClose();
    loadSample(); // the sample was loaded with the old parameters: an error about a missing one is stale now
  };
  const del = () => { useDesigner.getState().apply(d => { d.parameters.splice(index, 1); }); onClose(); loadSample(); };
  const needsChoices = (p.editor === 'radio' || p.editor === 'list') && !p.options && !p.optionsFrom;
  const limits = p.editor === 'slider' || RANGE_EDITORS.has(p.editor);
  return (
    <Dialog title={orig ? T('paramTitle', { name: orig.name }) : T('paramNew')} onClose={onClose}
      footer={<>{orig && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={del}>{T('delete')}</button>}<button className="btn" onClick={onClose}>{T('cancel')}</button><button className="btn primary" disabled={!!err} onClick={save}>{T('save')}</button></>}>
      <div className="grid2">
        <Field label={T('name')}><TextInput value={p.name} onChange={v => setP({ ...p, name: v })} autoFocus /></Field>
        <Field label={T('paramType')}><Select value={p.type} options={['string', 'number', 'date', 'boolean']} onChange={v => setP({ ...p, type: v })} /></Field>
        <Field label={T('prompt')}><TextInput value={p.prompt} onChange={v => setP({ ...p, prompt: v })} /></Field>
        <Field label={T('defaultValue')} hint={T(p.multi ? 'ux_defaultHintMulti' : 'defaultHint')}><TextInput value={p.default} onChange={v => setP({ ...p, default: v })} mono /></Field>
      </div>
      <Check label={T('required')} checked={p.required} onChange={v => setP({ ...p, required: v })} />
      <Check label={T('paramNullable')} checked={p.nullable} onChange={v => setP({ ...p, nullable: v || undefined })} />
      {p.type === 'string' && <Check label={T('paramAllowBlank')} checked={p.allowBlank} onChange={v => setP({ ...p, allowBlank: v || undefined })} />}
      <Check label={T('paramHidden')} checked={p.hidden} onChange={v => setP({ ...p, hidden: v || undefined })} />
      <Check label={T('multiHint')} checked={p.multi} onChange={v => setP({ ...p, multi: v || undefined })} />
      <Field label={T('fixedChoices')}>
        <textarea className="textarea" rows={3} value={choicesText} data-testid="param-choices"
          onChange={e => { setChoicesText(e.target.value); const list = e.target.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => parseOptionLine(l, p.type)); setP({ ...p, options: list.length ? list : undefined }); }} />
      </Field>
      <div className="grid2">
        <Field label={T('choicesFrom')}><Select value={p.optionsFrom?.dataSet} options={(def.dataSets || []).map(d => d.name)} allowEmpty onChange={pickChoiceSet} data-testid="param-choices-from" /></Field>
        {p.optionsFrom && <Field label={T('valueField')}><Select value={fieldOf(p.optionsFrom.value) || ''} options={[{ value: '', label: T('ux_choose') }, ...fromFields]} onChange={v => setP({ ...p, optionsFrom: { ...p.optionsFrom, value: v ? `=Fields.${v}` : '' } })} data-testid="param-value-field" aria-invalid={!p.optionsFrom.value || undefined} /></Field>}
        {p.optionsFrom && <Field label={T('labelField')} hint={T('labelFieldHint')}><Select value={p.optionsFrom.label} options={labelOpts} allowEmpty onChange={v => setP({ ...p, optionsFrom: { ...p.optionsFrom, label: v || undefined } })} data-testid="param-label-field" /></Field>}
      </div>
      {p.optionsFrom && choicePreview && <div className="hint" data-testid="param-choice-preview">{T('ux_choicePreview', { n: choicePreview.length, list: choicePreview.slice(0, 5).join(', ') + (choicePreview.length > 5 ? ', …' : '') })}</div>}
      {p.optionsFrom && <div className="hint">{T('cascadeHint')}</div>}
      <div className="grid2">
        <Field label={T('editor')} hint={T(`editorHint_${p.editor || 'auto'}`)}>
          <Select value={p.editor} allowEmpty onChange={setEditor} options={EDITORS.map(e => ({ value: e, label: T(`editor_${e}`) }))} />
        </Field>
        <Field label={T('panelColumns')} hint={T('panelColumnsHint')}>
          <Select value={columns} onChange={v => setColumns(v || '1')} options={['1', '2', '3', '4']} />
        </Field>
      </div>
      <Check label={T('liveParams')} checked={live} onChange={setLive} />
      {limits && (
        <div className="grid3">
          <Field label={T('minimum')}><TextInput value={p.min ?? ''} onChange={v => setP({ ...p, min: limit(v) })} mono type={p.type === 'date' ? 'date' : 'text'} /></Field>
          <Field label={T('maximum')}><TextInput value={p.max ?? ''} onChange={v => setP({ ...p, max: limit(v) })} mono type={p.type === 'date' ? 'date' : 'text'} /></Field>
          {p.type !== 'date' && <Field label={T('step')}><TextInput value={p.step ?? ''} onChange={v => setP({ ...p, step: v === '' || Number.isNaN(Number(v)) ? undefined : Number(v) })} mono /></Field>}
        </div>
      )}
      {needsChoices && <div className="err">{T('editorNeedsChoices')}</div>}
      {err && p.name && <div className="err">{err}</div>}
      <div className="hint">{T('useAsA')} <code>Parameters.{p.name || 'name'}</code> {T('useAsB')} <code>{'{Parameters.'}{p.name || 'name'}{'}'}</code>.</div>
    </Dialog>
  );
}

function SourceDialog({ index, onClose }) {
  const def = useDesigner(s => s.def);
  const lang = useDesigner(s => s.lang);
  const T = (k, v) => t(lang, k, v);
  const orig = index != null ? def.dataSources[index] : null;
  const [s, setS] = useState(() => ({ name: '', type: 'rest', method: 'GET', url: '', useProxy: false, ...(orig || {}), headersText: orig?.headers ? JSON.stringify(orig.headers, null, 2) : '', dataText: orig?.data != null ? (typeof orig.data === 'string' ? orig.data : JSON.stringify(orig.data, null, 2)) : '',
    nsText: Object.entries(orig?.namespaces || {}).map(([k, v]) => `${k}=${v}`).join('\n'), argsText: (orig?.args || []).map(x => `${x.name} = ${x.param}`).join('\n') }));
  const xmlish = s.type === 'xml' || s.type === 'soap';
  const fetched = FETCHED_TYPES.includes(s.type);
  let err = !NAME.test(s.name) ? 'The name must start with a letter and hold only letters, digits and _' : !uniqueIn(def.dataSources, s.name, index) ? 'Another source has this name' : null;
  let headers;
  if (!err && s.headersText.trim()) { try { headers = JSON.parse(s.headersText); } catch { err = 'Headers must be a JSON object'; } }
  let data;
  if (!err && s.type === 'json') { try { data = JSON.parse(s.dataText || 'null'); } catch (e) { err = `The JSON is not valid: ${e.message}`; } }
  if (!err && s.type === 'csv' && !s.url && !s.dataText.trim()) err = 'Give a URL or paste CSV text';
  if (!err && s.type === 'csv' && ((s.separator && s.separator !== 'tab' && s.separator.length !== 1) || (s.quote && s.quote.length !== 1))) err = 'The separator and the quote are one character each';
  if (!err && (s.type === 'rest' || s.type === 'graphql') && !s.url) err = 'Give a URL';
  if (!err && s.type === 'graphql' && !s.query) err = 'Give a GraphQL query';
  if (!err && s.type === 'xml' && !s.url && !s.dataText.trim()) err = T('srcGiveUrlOrXml');
  if (!err && (s.type === 'soap' || s.type === 'odata') && !s.url) err = 'Give a URL';
  if (!err && s.type === 'odata' && !s.entitySet) err = T('odPickSet');
  let namespaces;
  if (!err && xmlish && s.nsText.trim()) {
    namespaces = {};
    for (const l of s.nsText.split('\n').map(x => x.trim()).filter(Boolean)) {
      const m = /^([A-Za-z_][\w.-]*)\s*=\s*(\S+)$/.exec(l);
      if (!m) { err = T('srcBadNamespaces'); break; }
      namespaces[m[1]] = m[2];
    }
  }
  if (!err && s.type === 'soap') {
    if (!(s.envelope || '').trim()) err = T('srcGiveEnvelope');
    else if (/["\r\n]/.test(s.soapAction || '')) err = T('srcBadAction');
    else { try { parseXml(s.envelope.replace(/\{\{|\}\}/g, '').replace(/\{[^}]*\}/g, 'x')); } catch (e) { err = T('srcBadEnvelope', { message: e.message }); } }
  }
  if (!err && s.type === 'sql' && !s.connection) err = 'Pick a connection';
  if (!err && s.type === 'sql' && s.procedure != null && !s.procedure) err = 'Pick a stored procedure';
  if (!err && s.type === 'sql' && s.procedure == null && !/^\s*(select|with)\b/i.test(s.query || '')) err = 'Write a SELECT query';
  const [conns, setConns] = useState(null);
  const procs = (conns || []).find(c => c.name === s.connection)?.procs || [];
  const sqlKind = (conns || []).find(c => c.name === s.connection)?.kind || 'sqlite';
  const [probe, setProbe] = useState(null);
  useEffect(() => {
    if (s.type !== 'sql' || conns) return;
    fetch('/api/data/sql/connections').then(r => (r.ok ? r.json() : [])).then(setConns).catch(() => setConns([]));
  }, [s.type, conns]);
  const testConn = async () => {
    setProbe({ state: 'testing' });
    try {
      const r = await (await fetch('/api/data/sql/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connection: s.connection }) })).json();
      setProbe(r.ok ? { state: 'ok', text: `Connected in ${r.ms} ms` } : { state: 'error', text: r.error });
    } catch (e) { setProbe({ state: 'error', text: e.message }); }
  };

  const save = () => {
    const v = { name: s.name, type: s.type };
    if (s.type === 'rest' || s.type === 'graphql' || ((s.type === 'csv' || s.type === 'xml') && s.url)) { v.url = s.url; v.method = s.type === 'graphql' ? 'POST' : s.method; if (headers) v.headers = headers; if (s.useProxy) v.useProxy = true; if (s.body && s.method !== 'GET') v.body = s.body; }
    if (s.type === 'xml' && !s.url) v.data = s.dataText;
    if (xmlish && namespaces) v.namespaces = namespaces;
    if (s.type === 'soap') { v.url = s.url; if (headers) v.headers = headers; v.soapAction = s.soapAction || ''; if (s.soapVersion === '1.2') v.soapVersion = '1.2'; v.envelope = s.envelope; }
    if (s.type === 'odata') {
      v.url = s.url; if (headers) v.headers = headers; if (s.useProxy) v.useProxy = true;
      v.entitySet = s.entitySet;
      for (const k of ['select', 'expand']) if (s[k]?.length) v[k] = s[k];
      const fl = (s.filters || []).filter(f => f.field);
      if (fl.length) v.filters = fl.map(f => ({ field: f.field, op: f.op || 'eq', value: f.value ?? '', ...(f.type ? { type: f.type } : {}) }));
      const ob = (s.orderby || []).filter(o => o.field);
      if (ob.length) v.orderby = ob;
      for (const k of ['top', 'skip', 'maxPages']) if (s[k] != null && String(s[k]).trim() !== '') v[k] = /^\d+$/.test(String(s[k]).trim()) ? Number(s[k]) : s[k];
      if (s.types && Object.keys(s.types).length) v.types = s.types;
    }
    if (s.type === 'graphql') { v.query = s.query || ''; if (s.variables) v.variables = s.variables; }
    if (s.type === 'json') v.data = data;
    if (s.type === 'csv' && !s.url) v.data = s.dataText;
    if (s.type === 'csv') {
      if (s.separator && s.separator !== ',') v.separator = s.separator;
      if (s.quote && s.quote !== '"') v.quote = s.quote;
      if (s.headerRow === false) v.headerRow = false;
      if (Number(s.startRow) > 1) v.startRow = Number(s.startRow);
    }
    if (s.type === 'sql') {
      v.connection = s.connection;
      if (s.procedure != null) { v.procedure = s.procedure; const a = procArgs(s.argsText); if (a.length) v.args = a; }
      else if (s.builder) { v.query = buildSql(s.builder, sqlKind); v.builder = s.builder; } // the visual builder's query, and its model to reopen
      else v.query = s.query;
    }
    useDesigner.getState().apply(d => {
      d.dataSources ||= [];
      if (index != null) {
        const old = d.dataSources[index].name;
        d.dataSources[index] = v;
        if (old !== v.name) for (const ds of d.dataSets || []) if (ds.source === old) ds.source = v.name;
      } else d.dataSources.push(v);
    });
    onClose();
    loadSample();
  };
  const del = () => {
    if (def.dataSets?.some(d => d.source === orig.name)) { window.alert('A data set still uses this source. Delete or change that data set first.'); return; }
    useDesigner.getState().apply(d => { d.dataSources.splice(index, 1); }); onClose(); loadSample();
  };
  return (
    <Dialog wide className={s.type === 'sql' && s.builder ? 'qb-wide' : ''} title={orig ? `Data source ${orig.name}` : 'New data source'} onClose={onClose}
      footer={<>{orig && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!err} onClick={save}>Save</button></>}>
      <div className="grid2">
        <Field label="Name"><TextInput value={s.name} onChange={v => setS({ ...s, name: v })} autoFocus /></Field>
        <Field label="Type"><Select value={s.type} options={[{ value: 'rest', label: 'REST API (JSON)' }, { value: 'json', label: 'Inline JSON' }, { value: 'csv', label: 'CSV' }, { value: 'xml', label: T('srcTypeXml') }, { value: 'soap', label: T('srcTypeSoap') }, { value: 'odata', label: T('srcTypeOData') }, { value: 'graphql', label: 'GraphQL' }, { value: 'sql', label: 'SQL database (on the server)' }]} onChange={v => setS({ ...s, type: v })} /></Field>
      </div>
      {fetched && <>
        <div style={{ display: 'grid', gridTemplateColumns: s.type === 'soap' || s.type === 'odata' ? '1fr' : '110px 1fr', gap: 8 }}>
          {s.type !== 'soap' && s.type !== 'odata' && <Field label="Method"><Select value={s.method} options={['GET', 'POST']} onChange={v => setS({ ...s, method: v })} /></Field>}
          <Field label="URL" hint={s.type === 'odata' ? T('odServiceHint') : s.type === 'xml' ? T('srcXmlUrlHint') : 'Use {Parameters.x} for values. A relative URL calls this app.'}><TextInput value={s.url} onChange={v => setS({ ...s, url: v })} mono placeholder="/api/... or https://..." /></Field>
        </div>
        {s.type === 'soap' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8 }}>
          <Field label={T('srcSoapAction')}><TextInput value={s.soapAction || ''} onChange={v => setS({ ...s, soapAction: v })} mono placeholder="http://tempuri.org/GetOrders" /></Field>
          <Field label={T('srcSoapVersion')}><Select value={s.soapVersion || '1.1'} options={['1.1', '1.2']} onChange={v => setS({ ...s, soapVersion: v })} /></Field>
        </div>}
        {s.type === 'soap' && <Field label={T('srcEnvelope')} hint={T('srcEnvelopeHint')}>
          <textarea className="textarea" rows={9} value={s.envelope || ''} onChange={e => setS({ ...s, envelope: e.target.value })} style={{ fontFamily: 'var(--mono)' }} spellCheck={false} />
        </Field>}
        {s.type === 'soap' && <div><button type="button" className="btn sm" onClick={() => setS({ ...s, envelope: envelopeTemplate(s.soapVersion) })}>{T('srcEnvelopeTemplate')}</button></div>}
        <Field label="Headers (JSON)"><textarea className="textarea" rows={3} value={s.headersText} onChange={e => setS({ ...s, headersText: e.target.value })} placeholder='{"Authorization": "Bearer {Parameters.token}"}' /></Field>
        {s.method === 'POST' && !['graphql', 'soap', 'odata'].includes(s.type) && <Field label="Body"><textarea className="textarea" rows={3} value={s.body || ''} onChange={e => setS({ ...s, body: e.target.value })} /></Field>}
        {s.type === 'graphql' && <>
          <Field label="GraphQL query"><textarea className="textarea" rows={5} value={s.query || ''} onChange={e => setS({ ...s, query: e.target.value })} placeholder="query ($id: ID!) { account(id: $id) { name payments { due amount } } }" /></Field>
          <Field label="Variables (JSON, {Parameters.x} allowed)"><textarea className="textarea" rows={2} value={s.variables || ''} onChange={e => setS({ ...s, variables: e.target.value })} placeholder='{"id": "{Parameters.accountId}"}' /></Field>
        </>}
        {s.type !== 'soap' && <Check label="Call through the server proxy (for CORS; the host must be in PW_PROXY_ALLOW)" checked={s.useProxy} onChange={v => setS({ ...s, useProxy: v })} />}
        {s.type === 'odata' && <ODataEditor s={s} setS={setS} T={T} />}
      </>}
      {xmlish && <Field label={T('srcNamespaces')} hint={T('srcNamespacesHint')}>
        <textarea className="textarea" rows={2} value={s.nsText} onChange={e => setS({ ...s, nsText: e.target.value })} placeholder="o=urn:example:orders" style={{ fontFamily: 'var(--mono)' }} spellCheck={false} />
      </Field>}
      {s.type === 'xml' && !s.url && <Field label={T('srcXmlData')}>
        <textarea className="textarea" rows={10} value={s.dataText} onChange={e => setS({ ...s, dataText: e.target.value })} style={{ fontFamily: 'var(--mono)' }} spellCheck={false} />
      </Field>}
      {s.type === 'sql' && <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
          <Field label="Connection" hint="Set up on the server as PW_DB_<NAME> (SQLite, PostgreSQL, MySQL, SQL Server, Oracle, Snowflake or BigQuery).">
            <Select value={s.connection || ''} allowEmpty options={(conns || []).map(c => ({ value: c.name, label: `${c.name} (${c.kind})` }))} onChange={v => { setS({ ...s, connection: v }); setProbe(null); }} />
          </Field>
          <button className="btn" onClick={testConn} disabled={!s.connection || probe?.state === 'testing'}>{probe?.state === 'testing' ? 'Testing…' : 'Test'}</button>
        </div>
        {conns && !conns.length && <div className="hint">No connections on this server yet. Set PW_DB_MAIN=sqlite:/path/file.db (or a postgres:// / mysql:// / mssql:// URL) and restart.</div>}
        {probe && probe.state !== 'testing' && <div className={probe.state === 'ok' ? 'hint' : 'err'} role="status">{probe.text}</div>}
        {(procs.length > 0 || s.procedure != null) && <Field label="Mode" hint="Stored procedures are only those the admin allows on this connection (PW_DB_<NAME>_PROCS).">
          <Select value={s.procedure != null ? 'proc' : 'query'} options={[{ value: 'query', label: 'Query' }, { value: 'proc', label: 'Stored procedure' }]} onChange={v => setS({ ...s, procedure: v === 'proc' ? (s.procedure ?? procs[0] ?? '') : undefined })} />
        </Field>}
        {s.procedure != null ? <>
          <Field label="Stored procedure"><Select value={s.procedure} allowEmpty options={procs.map(p => ({ value: p, label: p }))} onChange={v => setS({ ...s, procedure: v })} /></Field>
          <Field label="Arguments" hint="One per line: procedure argument = report parameter (bound, never pasted into SQL). The first result set is the data.">
            <textarea className="textarea" rows={3} value={s.argsText ?? ''} onChange={e => setS({ ...s, argsText: e.target.value })} placeholder={'region = region\nyear = year'} style={{ fontFamily: 'var(--mono)' }} />
          </Field>
        </> : <>
          <div className="seg" role="group" aria-label={T('qb_mode')}>
            <button type="button" aria-pressed={!!s.builder} onClick={() => { if (!s.builder && s.query?.trim() && !window.confirm(T('qb_replaceSql'))) return; setS({ ...s, builder: s.builder || { tables: [], columns: [], joins: [], filters: [], sort: [] } }); }} data-testid="qb-mode-build">{T('qb_build')}</button>
            <button type="button" aria-pressed={!s.builder} onClick={() => { const { builder: _b, ...rest } = s; setS(rest); }} data-testid="qb-mode-sql">{T('qb_sql')}</button>
          </div>
          {s.builder ? <SqlBuilder s={s} setS={setS} T={T} kind={sqlKind} onManual={() => { const { builder: _b, ...rest } = s; setS({ ...rest, query: s.builder ? buildSql(s.builder, sqlKind) : s.query }); }} />
            : <Field label="Query" hint="SELECT only. @name uses the report parameter name (bound, never pasted into the SQL). Lists work with in (@name).">
              <textarea className="textarea" rows={6} value={s.query || ''} onChange={e => setS({ ...s, query: e.target.value })} placeholder="select region, month, sum(amount) as amount from sales where year = @year group by region, month" style={{ fontFamily: 'var(--mono)' }} />
            </Field>}
        </>}
      </>}
      {s.type === 'csv' && <div className="grid2">
        <Field label="Separator" hint='One character; "tab" for a tab'><TextInput value={s.separator ?? ','} onChange={v => setS({ ...s, separator: v })} mono /></Field>
        <Field label="Quote"><TextInput value={s.quote ?? '"'} onChange={v => setS({ ...s, quote: v })} mono /></Field>
        <Field label="Start row" hint="Rows above it are skipped"><TextInput value={s.startRow ?? 1} onChange={v => setS({ ...s, startRow: v })} mono /></Field>
        <Check label="First row has the column names" checked={s.headerRow !== false} onChange={v => setS({ ...s, headerRow: v })} />
      </div>}
      {(s.type === 'json' || (s.type === 'csv' && !s.url)) && (
        <Field label={s.type === 'json' ? 'JSON data' : 'CSV text (first row = headers)'}><textarea className="textarea" rows={10} value={s.dataText} onChange={e => setS({ ...s, dataText: e.target.value })} /></Field>
      )}
      {err && s.name && <div className="err">{err}</div>}
    </Dialog>
  );
}

/** A starting SOAP envelope: replace the method, its namespace and the parameters. */
const envelopeTemplate = (version) => `<soap:Envelope xmlns:soap="${version === '1.2' ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/'}">
  <soap:Body>
    <GetOrders xmlns="http://tempuri.org/">
      <customerId>{Parameters.customer}</customerId>
    </GetOrders>
  </soap:Body>
</soap:Envelope>`;

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** "region = region" lines → [{ name, param }] (the stored procedure's arguments); blank and malformed lines are left out. */
export const procArgs = (text) => String(text || '').split(/\r?\n/).map(l => /^\s*@?(\w+)\s*=\s*@?(\w+)\s*$/.exec(l)).filter(Boolean).map(m => ({ name: m[1], param: m[2] }));

function DataSetDialog({ index, onClose, onSaved }) {
  const def = useDesigner(s => s.def);
  const lang = useDesigner(s => s.lang);
  const T = (k, v) => t(lang, k, v);
  const orig = index != null ? def.dataSets[index] : null;
  // every key of the data set is kept (relation and anything this dialog has no control for), not only the ones shown
  const [d, setD] = useState(() => ({ name: '', source: def.dataSources?.[0]?.name, path: '$', fields: [], sort: [], ...(orig ? JSON.parse(JSON.stringify(orig)) : {}) }));
  const [detect, setDetect] = useState({ state: 'idle' });
  // a new data set's path is a guess until the author types one: Detect then takes the obvious list ($.lines), not the root
  const [pathTyped, setPathTyped] = useState(!!orig);
  const nested = !!d.relation;
  const parents = (def.dataSets || []).filter((x, i) => i !== index && x.name !== d.name);
  const err = !NAME.test(d.name) ? T('dsNameRule') : !uniqueIn(def.dataSets, d.name, index) ? T('dsNameTaken')
    : nested ? (!d.relation.parent ? T('dsPickParent') : null) : !d.source ? T('dsPickSource') : null;

  const [explore, setExplore] = useState(null);
  const loadSourceRaw = async (name) => {
    const params = resolveParameters(useDesigner.getState().def, {});
    const src = useDesigner.getState().def.dataSources.find(s => s.name === name);
    if (!src) throw new Error(T('dsNoSource', { name }));
    return (await loadSources({ dataSources: [src] }, { params, baseUrl: origin(), sqlPreview: true, fetch: reportFetch(origin(), undefined, { sqlPreview: true }) }))[src.name]; // the ReportWright server, also when embedded
  };
  /** The raw rows of a data set: its source at its path, or for a nested one each parent row's children. */
  const rawRowsOf = async (ds, seen = new Set()) => {
    if (!ds || seen.has(ds.name)) return [];
    seen.add(ds.name);
    if (!ds.relation) return sourceRows(await loadSourceRaw(ds.source), ds.path || '$');
    const up = await rawRowsOf((useDesigner.getState().def.dataSets || []).find(x => x.name === ds.relation.parent), seen);
    return up.flatMap(r => asList(jsonPath(r, ds.relation.path || '$')));
  };
  // what "Explore" and "Detect" look in: the source's response, or the first parent row for a nested set
  const loadRaw = async () => {
    if (!nested) return loadSourceRaw(d.source);
    const rows = await rawRowsOf((def.dataSets || []).find(x => x.name === d.relation.parent));
    return rows.find(r => r && typeof r === 'object') ?? null;
  };
  // Response explorer: every list in the response, with its path and fields; pick one to use it as the rows.
  const openExplorer = async () => {
    setExplore({ state: 'loading' });
    try {
      const raw = await loadRaw();
      const xml = isXmlDoc(raw); // XML: repeating elements, by XPath
      setExplore({ state: 'done', arrays: xml ? xmlRowPaths(raw) : rowArrays(raw), best: (xml ? bestXmlRows(raw) : bestRows(raw))?.path, raw });
    } catch (e) { setExplore({ state: 'error', message: e.message }); }
  };
  // nested objects (customer: { name, address }) come as object fields with dotted children: Fields.customer.name
  const keepFields = (list) => { const keep = new Map(d.fields.map(f => [f.name, f])); return [...detectFields(list), ...nestedFields(list)].map(f => (keep.has(f.name) && f.type !== 'object' ? keep.get(f.name) : f)).concat(d.fields.filter(f => f.expr)); };
  const pick = async (path) => {
    if (nested) {
      const rows = await rawRowsOf({ ...d, relation: { ...d.relation, path } }).catch(() => []);
      setD({ ...d, relation: { ...d.relation, path }, fields: keepFields(rows) });
      setDetect({ state: 'done', rows: rows.length });
    } else {
      const list = sourceRows(explore.raw, path);
      setD({ ...d, path, fields: keepFields(list) });
      setDetect({ state: 'done', rows: list.length });
    }
    setExplore(null);
  };
  const run = async () => {
    setDetect({ state: 'loading' });
    try {
      let list;
      if (nested) list = await rawRowsOf(d);
      else {
        const raw = await loadSourceRaw(d.source);
        let path = d.path || '$';
        // the root is an object that holds lists: the suggested list is the rows (the explorer shows the others)
        if (!pathTyped && path === '$' && raw && typeof raw === 'object' && !Array.isArray(raw) && !isXmlDoc(raw)) {
          const best = bestRows(raw);
          if (best && best.path !== '$') { path = best.path; setExplore({ state: 'done', arrays: rowArrays(raw), best: path, raw, auto: true }); }
        }
        if (!isXmlDoc(raw) && jsonPath(raw, path) == null) throw new Error(T('dsNothingAt', { path }));
        list = sourceRows(raw, path);
        if (!list.length && isXmlDoc(raw)) throw new Error(T('dsNothingAt', { path }));
        setD({ ...d, path, fields: keepFields(list) });
        setDetect({ state: 'done', rows: list.length, path: path !== (d.path || '$') ? path : null });
        return;
      }
      setD({ ...d, fields: keepFields(list) });
      setDetect({ state: 'done', rows: list.length });
    } catch (e) { setDetect({ state: 'error', message: e.message }); }
  };

  const save = () => {
    useDesigner.getState().apply(x => {
      x.dataSets ||= [];
      const v = JSON.parse(JSON.stringify(d));
      v.fields = d.fields.filter(f => f.name);
      if (nested) { delete v.source; delete v.path; v.relation = { ...d.relation, path: d.relation.path || '$' }; }
      else { delete v.relation; v.path = d.path || '$'; }
      if (!d.filters?.length) delete v.filters;
      const sort = (d.sort || []).filter(s => s.by);
      if (sort.length) v.sort = sort; else delete v.sort;
      let at = index;
      if (index != null) {
        const old = x.dataSets[index].name;
        x.dataSets[index] = v;
        if (old !== v.name) {
          walk(x, (it) => { if (it.dataSet === old) it.dataSet = v.name; });
          for (const o of x.dataSets) if (o.relation?.parent === old) o.relation.parent = v.name;
        }
      } else { x.dataSets.push(v); at = x.dataSets.length - 1; }
      // a nested data set comes after its parent (the engine builds them in order)
      const pi = nested ? x.dataSets.findIndex(o => o.name === v.relation.parent) : -1;
      if (pi > at) { const [moved] = x.dataSets.splice(at, 1); x.dataSets.splice(pi, 0, moved); }
    });
    onSaved?.(d.name);
    onClose();
    loadSample();
  };
  const del = () => {
    useDesigner.getState().apply(x => {
      x.dataSets.splice(index, 1);
      walk(x, (it) => { if (it.dataSet === orig.name) delete it.dataSet; });
    });
    onClose();
    loadSample();
  };
  const setField = (i, k, v) => setD({ ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, [k]: v } : f)) });
  const setFilter = (i, k, v) => setD({ ...d, filters: d.filters.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const sorts = d.sort || [];
  const setSort = (i, k, v) => setD({ ...d, sort: sorts.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const moveSort = (i, by) => { const a = [...sorts]; const j = i + by; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setD({ ...d, sort: a }); };
  const fieldOpts = d.fields.filter(f => f.name).map(f => ({ value: `=Fields.${f.name}`, label: f.name }));
  const sortOpts = (by) => (by && !fieldOpts.some(o => o.value === by) ? [...fieldOpts, { value: by, label: by }] : fieldOpts);
  const relPath = d.relation?.path ?? '$';
  return (
    <Dialog wide title={orig ? T('dsTitle', { name: orig.name }) : T('dsNew')} onClose={onClose}
      footer={<>{orig && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={del}>{T('delete')}</button>}<button className="btn" onClick={onClose}>{T('cancel')}</button><button className="btn primary" disabled={!!err} onClick={save}>{T('save')}</button></>}>
      <div className="grid2">
        <Field label={T('name')}><TextInput value={d.name} onChange={v => setD({ ...d, name: v })} autoFocus /></Field>
        <Field label={T('dsRowsFrom')}>
          <Select value={nested ? 'nested' : 'source'} options={[{ value: 'source', label: T('dsFromSource') }, { value: 'nested', label: T('dsFromParent') }]} data-testid="ds-rows-from"
            onChange={v => setD(v === 'nested' ? { ...d, relation: { parent: d.relation?.parent || parents[0]?.name, path: d.relation?.path || '$' } } : (({ relation: _r, ...rest }) => ({ ...rest, source: rest.source || def.dataSources?.[0]?.name }))(d))} />
        </Field>
      </div>
      {nested ? (
        <div className="grid2">
          <Field label={T('dsParent')} hint={T('dsParentHint')}><Select value={d.relation.parent} options={parents.map(x => x.name)} allowEmpty onChange={v => setD({ ...d, relation: { ...d.relation, parent: v } })} data-testid="ds-parent" /></Field>
          <Field label={T('dsChildPath')} hint={T('dsChildPathHint')}><TextInput value={relPath} onChange={v => setD({ ...d, relation: { ...d.relation, path: v } })} mono data-testid="ds-child-path" /></Field>
        </div>
      ) : (
        <>
          <Field label={T('dsSource')}><Select value={d.source} options={(def.dataSources || []).map(s => s.name)} onChange={v => setD({ ...d, source: v })} /></Field>
          <Field label={T('dsPath')} hint={['xml', 'soap'].includes(def.dataSources?.find(x => x.name === d.source)?.type) ? T('dsXPathHint') : T('dsPathHint')}><TextInput value={d.path} onChange={v => { setPathTyped(true); setD({ ...d, path: v }); }} mono data-testid="ds-path" /></Field>
        </>
      )}
      <div className="btnrow" style={{ alignItems: 'center' }}>
        <button className="btn" onClick={run} disabled={(nested ? !d.relation.parent : !d.source) || detect.state === 'loading'}>{detect.state === 'loading' ? T('dsReading') : T('dsDetect')}</button>
        <button className="btn" onClick={openExplorer} disabled={(nested ? !d.relation.parent : !d.source) || explore?.state === 'loading'}>{explore?.state === 'loading' ? T('dsReading') : T('dsExplore')}</button>
        {detect.state === 'done' && <span className="hint">{T('dsFound', { n: detect.rows })}{detect.path ? ` ${T('ux_dsPickedPath', { path: detect.path })}` : ''}</span>}
        {detect.state === 'error' && <span className="err">{detect.message}</span>}
      </div>
      {explore?.state === 'error' && <div className="err">{explore.message}</div>}
      {explore?.state === 'done' && (
        <div className="explorer" role="list" aria-label={T('dsLists')} style={{ display: 'grid', gap: 4, maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6, padding: 6 }}>
          {!explore.arrays.length && <div className="hint">{T('dsNoLists')}</div>}
          {explore.arrays.map(a => (
            <div key={a.path} role="listitem" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
              <div>
                <code>{a.path}</code> <span className="hint">· {T('dsRows', { n: a.rows })}{a.path === explore.best ? ` · ${T('dsSuggested')}` : ''}</span>
                {a.objects && <div className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fields.join(', ') || T('dsNoPlainFields')}</div>}
              </div>
              <button className={`btn sm${a.path === explore.best ? ' primary' : ''}`} disabled={!a.objects} onClick={() => pick(a.path)} title={a.objects ? T('dsUseRows') : T('dsPlainList')}>{T('dsUse')}</button>
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="hint" style={{ marginBottom: 6 }}>{T('dsFields')}</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {d.fields.map((f, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1.4fr auto', gap: 6 }}>
              <TextInput value={f.name} onChange={v => setField(i, 'name', v)} mono aria-label={T('dsFieldName')} />
              <Select value={f.type} options={['string', 'number', 'date', 'boolean', { value: 'list', label: T('fieldTypeList') }, ...(f.type === 'object' ? [{ value: 'object', label: T('ux_fieldTypeObject') }] : [])]} onChange={v => setField(i, 'type', v)} aria-label={T('fieldType')} />
              {f.type === 'object' ? <span className="hint" style={{ alignSelf: 'center' }} data-testid={`ds-object-${f.name}`}>{(f.fields || []).map(c => `${f.name}.${c.name}`).join(', ')}</span>
                : <TextInput value={f.expr || ''} onChange={v => setField(i, 'expr', v || undefined)} mono placeholder={T('dsCalcPlaceholder')} />}
              <button className="btn sm ghost danger" onClick={() => setD({ ...d, fields: d.fields.filter((_, j) => j !== i) })} aria-label={T('dsRemoveField')}>✕</button>
            </div>
          ))}
          <div><button className="btn sm" onClick={() => setD({ ...d, fields: [...d.fields, { name: '', type: 'string' }] })}>{T('dsAddField')}</button></div>
        </div>
      </div>
      <div>
        <div className="hint" style={{ marginBottom: 6 }}>{T('dsFilters')}</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {(d.filters || []).map((f, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr auto', gap: 6 }}>
              <TextInput value={f.expr} onChange={v => setFilter(i, 'expr', v)} mono aria-label={T('dsFilterField')} />
              <Select value={f.op || '='} options={OPS} onChange={v => setFilter(i, 'op', v)} />
              <div style={{ display: 'flex', gap: 4 }}>
                <TextInput value={f.value} onChange={v => setFilter(i, 'value', v)} mono placeholder={T('dsFilterValueHint')} aria-label={T('dsFilterValue')} />
                {f.op === 'Between' && <TextInput value={f.value2} onChange={v => setFilter(i, 'value2', v)} mono placeholder={T('dsAnd')} aria-label={T('dsUpperValue')} />}
              </div>
              <button className="btn sm ghost danger" onClick={() => setD({ ...d, filters: d.filters.filter((_, j) => j !== i) })} aria-label={T('dsRemoveFilter')}>✕</button>
              <label className="check" style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={!!f.skipBlank} onChange={e => setFilter(i, 'skipBlank', e.target.checked || undefined)} data-testid="filter-skip-blank" />{T('b2_skipBlank')}</label>
            </div>
          ))}
          <div><button className="btn sm" onClick={() => setD({ ...d, filters: [...(d.filters || []), { expr: d.fields[0] ? `=Fields.${d.fields[0].name}` : '', op: '=', value: '' }] })}>{T('dsAddFilter')}</button></div>
        </div>
      </div>
      <div data-testid="ds-sort">
        <div className="hint" style={{ marginBottom: 6 }}>{T('dsSortKeys')}</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {sorts.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px auto auto auto', gap: 6 }}>
              <Select value={s.by} options={sortOpts(s.by)} allowEmpty onChange={v => setSort(i, 'by', v)} aria-label={T('dsSortBy', { n: i + 1 })} />
              <Select value={s.dir || 'asc'} options={[{ value: 'asc', label: T('dsAsc') }, { value: 'desc', label: T('dsDesc') }]} onChange={v => setSort(i, 'dir', v)} aria-label={T('dsSortDir', { n: i + 1 })} />
              <button className="btn sm ghost" disabled={i === 0} onClick={() => moveSort(i, -1)} aria-label={T('moveUp')} title={T('moveUp')}>↑</button>
              <button className="btn sm ghost" disabled={i === sorts.length - 1} onClick={() => moveSort(i, 1)} aria-label={T('moveDown')} title={T('moveDown')}>↓</button>
              <button className="btn sm ghost danger" onClick={() => setD({ ...d, sort: sorts.filter((_, j) => j !== i) })} aria-label={T('dsRemoveSort')}>✕</button>
            </div>
          ))}
          <div><button className="btn sm" onClick={() => setD({ ...d, sort: [...sorts, { by: fieldOpts[0]?.value || '', dir: 'asc' }] })} data-testid="ds-add-sort">{T('dsAddSort')}</button></div>
        </div>
      </div>
      {err && d.name && <div className="err">{err}</div>}
    </Dialog>
  );
}
