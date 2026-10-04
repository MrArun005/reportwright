'use client';
import { useEffect, useState } from 'react';
import { rowArrays, bestRows } from './explore.js';
import { useDesigner, SECTIONS } from './store.js';
import { MIME_FIELD, MIME_DATASET } from './Canvas.jsx';
import { loadSources, buildDataSets, detectFields, jsonPath } from '@/engine/data/index.js';
import { resolveParameters } from '@/engine/index.js';
import { functionTable } from '@/engine/expr/evaluate.js';
import { Dialog, Field, TextInput, Select, Check } from './ui.jsx';
import { t } from '@/i18n/index.js';
import { OPS } from './Inspector.jsx';

const NAME = /^[A-Za-z_][\w]*$/;

/** Load every source and build data sets with parameter defaults. Used for previews and field detection. */
export async function loadSample() {
  const { def } = useDesigner.getState();
  useDesigner.setState({ sample: { loading: true } });
  try {
    const params = resolveParameters(def, {});
    const sources = await loadSources(def, { params, baseUrl: window.location.origin, sqlPreview: true });
    const ctx = { params, globals: { ExecutionTime: new Date() }, dataSets: {}, fields: null, locale: def.locale, currency: def.currency, functions: functionTable(def) };
    const dataSets = buildDataSets(def, sources, ctx);
    useDesigner.setState({ sample: { dataSets, sources, at: Date.now() } });
  } catch (e) {
    useDesigner.setState({ sample: { error: e.message } });
  }
}

export default function DataPanel() {
  const def = useDesigner(s => s.def);
  const sample = useDesigner(s => s.sample);
  const [dlg, setDlg] = useState(null);
  const [open, setOpen] = useState(() => new Set((def.dataSets || []).map(d => d.name)));
  const toggle = (n) => setOpen(s => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });

  return (
    <>
      <div className="pane">
        <h4>Parameters <button className="btn sm ghost" onClick={() => setDlg({ kind: 'param' })}>+ Add</button></h4>
        <div className="pane-body">
          <ul className="tree">
            {(def.parameters || []).map((p, i) => (
              <li key={p.name} className="trow" onDoubleClick={() => setDlg({ kind: 'param', index: i })}>
                <span className="nm">{p.name}</span><span className="ty">{p.type || 'string'}</span>
                <button className="btn sm ghost act" onClick={() => setDlg({ kind: 'param', index: i })}>Edit</button>
              </li>
            ))}
            {!(def.parameters || []).length && <li className="subtle">None</li>}
          </ul>
        </div>
      </div>
      <div className="pane">
        <h4>Data sources <button className="btn sm ghost" onClick={() => setDlg({ kind: 'source' })}>+ Add</button></h4>
        <div className="pane-body">
          <ul className="tree">
            {(def.dataSources || []).map((s, i) => (
              <li key={s.name} className="trow" onDoubleClick={() => setDlg({ kind: 'source', index: i })}>
                <span className="nm">{s.name}</span><span className="ty">{s.type}</span>
                <button className="btn sm ghost act" onClick={() => setDlg({ kind: 'source', index: i })}>Edit</button>
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
                <div className="trow">
                  <button className="btn sm ghost icon" style={{ width: 18, height: 18 }} onClick={() => toggle(d.name)} aria-label="Show fields">{open.has(d.name) ? '▾' : '▸'}</button>
                  <span className="nm" draggable title="Drag onto the page for a table of these rows"
                    onDragStart={(e) => { e.dataTransfer.setData(MIME_DATASET, JSON.stringify({ dataSet: d.name })); e.dataTransfer.effectAllowed = 'copy'; }}><b>{d.name}</b></span>
                  <span className="ty">{sample?.dataSets?.[d.name] ? `${sample.dataSets[d.name].length} rows` : ''}</span>
                  <button className="btn sm ghost act" onClick={() => setDlg({ kind: 'dataset', index: i })}>Edit</button>
                </div>
                {open.has(d.name) && (
                  <ul className="tree" style={{ paddingLeft: 18 }}>
                    {(d.fields || []).map(f => (
                      <li key={f.name} className="trow field-chip" draggable title="Drag onto the page or a table cell"
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
            <button className="btn sm" onClick={loadSample} disabled={sample?.loading}>{sample?.loading ? 'Loading…' : 'Load sample data'}</button>
          </div>
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

const EDITORS = ['slider', 'range', 'dateRange', 'radio', 'list', 'toggle'];
const RANGE_EDITORS = new Set(['range', 'dateRange']);

function ParamDialog({ index, onClose }) {
  const def = useDesigner(s => s.def);
  const lang = useDesigner(s => s.lang);
  const T = (k, v) => t(lang, k, v);
  const orig = index != null ? def.parameters[index] : null;
  const [p, setP] = useState(orig || { name: '', type: 'string', prompt: '', default: '', required: false });
  const [columns, setColumns] = useState(String(def.parameterLayout?.columns || 1));
  const err = !NAME.test(p.name) ? T('paramNameRule') : !uniqueIn(def.parameters, p.name, index) ? T('paramNameTaken') : null;
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
    });
    onClose();
  };
  const del = () => { useDesigner.getState().apply(d => { d.parameters.splice(index, 1); }); onClose(); };
  const needsChoices = (p.editor === 'radio' || p.editor === 'list') && !p.options && !p.optionsFrom;
  const limits = p.editor === 'slider' || RANGE_EDITORS.has(p.editor);
  return (
    <Dialog title={orig ? T('paramTitle', { name: orig.name }) : T('paramNew')} onClose={onClose}
      footer={<>{orig && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={del}>{T('delete')}</button>}<button className="btn" onClick={onClose}>{T('cancel')}</button><button className="btn primary" disabled={!!err} onClick={save}>{T('save')}</button></>}>
      <div className="grid2">
        <Field label={T('name')}><TextInput value={p.name} onChange={v => setP({ ...p, name: v })} autoFocus /></Field>
        <Field label={T('paramType')}><Select value={p.type} options={['string', 'number', 'date', 'boolean']} onChange={v => setP({ ...p, type: v })} /></Field>
        <Field label={T('prompt')}><TextInput value={p.prompt} onChange={v => setP({ ...p, prompt: v })} /></Field>
        <Field label={T('defaultValue')} hint={T('defaultHint')}><TextInput value={p.default} onChange={v => setP({ ...p, default: v })} mono /></Field>
      </div>
      <Check label={T('required')} checked={p.required} onChange={v => setP({ ...p, required: v })} />
      <Check label={T('paramNullable')} checked={p.nullable} onChange={v => setP({ ...p, nullable: v || undefined })} />
      {p.type === 'string' && <Check label={T('paramAllowBlank')} checked={p.allowBlank} onChange={v => setP({ ...p, allowBlank: v || undefined })} />}
      <Check label={T('paramHidden')} checked={p.hidden} onChange={v => setP({ ...p, hidden: v || undefined })} />
      <Check label={T('multiHint')} checked={p.multi} onChange={v => setP({ ...p, multi: v || undefined })} />
      <Field label={T('fixedChoices')}>
        <textarea className="textarea" rows={3} value={(p.options || []).map(o => (o.label != null && o.label !== String(o.value) ? `${o.value}=${o.label}` : String(o.value))).join('\n')}
          onChange={e => { const list = e.target.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [v, ...lb] = l.split('='); return { value: v.trim(), label: (lb.join('=') || v).trim() }; }); setP({ ...p, options: list.length ? list : undefined }); }} />
      </Field>
      <div className="grid2">
        <Field label={T('choicesFrom')}><Select value={p.optionsFrom?.dataSet} options={(def.dataSets || []).map(d => d.name)} allowEmpty onChange={v => setP({ ...p, optionsFrom: v ? { dataSet: v, value: p.optionsFrom?.value || '', label: p.optionsFrom?.label } : undefined })} /></Field>
        {p.optionsFrom && <Field label={T('valueField')}><Select value={p.optionsFrom.value?.replace(/^=Fields\./, '')} options={(def.dataSets.find(d => d.name === p.optionsFrom.dataSet)?.fields || []).map(f => f.name)} onChange={v => setP({ ...p, optionsFrom: { ...p.optionsFrom, value: `=Fields.${v}` } })} /></Field>}
      </div>
      {p.optionsFrom && <div className="hint">{T('cascadeHint')}</div>}
      <div className="grid2">
        <Field label={T('editor')} hint={T(`editorHint_${p.editor || 'auto'}`)}>
          <Select value={p.editor} allowEmpty onChange={setEditor} options={EDITORS.map(e => ({ value: e, label: T(`editor_${e}`) }))} />
        </Field>
        <Field label={T('panelColumns')} hint={T('panelColumnsHint')}>
          <Select value={columns} onChange={v => setColumns(v || '1')} options={['1', '2', '3', '4']} />
        </Field>
      </div>
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
  const orig = index != null ? def.dataSources[index] : null;
  const [s, setS] = useState(() => ({ name: '', type: 'rest', method: 'GET', url: '', useProxy: false, ...(orig || {}), headersText: orig?.headers ? JSON.stringify(orig.headers, null, 2) : '', dataText: orig?.data != null ? (typeof orig.data === 'string' ? orig.data : JSON.stringify(orig.data, null, 2)) : '' }));
  let err = !NAME.test(s.name) ? 'The name must start with a letter and hold only letters, digits and _' : !uniqueIn(def.dataSources, s.name, index) ? 'Another source has this name' : null;
  let headers;
  if (!err && s.headersText.trim()) { try { headers = JSON.parse(s.headersText); } catch { err = 'Headers must be a JSON object'; } }
  let data;
  if (!err && s.type === 'json') { try { data = JSON.parse(s.dataText || 'null'); } catch (e) { err = `The JSON is not valid: ${e.message}`; } }
  if (!err && s.type === 'csv' && !s.url && !s.dataText.trim()) err = 'Give a URL or paste CSV text';
  if (!err && (s.type === 'rest' || s.type === 'graphql') && !s.url) err = 'Give a URL';
  if (!err && s.type === 'graphql' && !s.query) err = 'Give a GraphQL query';
  if (!err && s.type === 'sql' && !s.connection) err = 'Pick a connection';
  if (!err && s.type === 'sql' && !/^\s*(select|with)\b/i.test(s.query || '')) err = 'Write a SELECT query';
  const [conns, setConns] = useState(null);
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
    if (s.type === 'rest' || s.type === 'graphql' || (s.type === 'csv' && s.url)) { v.url = s.url; v.method = s.type === 'graphql' ? 'POST' : s.method; if (headers) v.headers = headers; if (s.useProxy) v.useProxy = true; if (s.body && s.method !== 'GET') v.body = s.body; }
    if (s.type === 'graphql') { v.query = s.query || ''; if (s.variables) v.variables = s.variables; }
    if (s.type === 'json') v.data = data;
    if (s.type === 'csv' && !s.url) v.data = s.dataText;
    if (s.type === 'sql') { v.connection = s.connection; v.query = s.query; }
    useDesigner.getState().apply(d => {
      d.dataSources ||= [];
      if (index != null) {
        const old = d.dataSources[index].name;
        d.dataSources[index] = v;
        if (old !== v.name) for (const ds of d.dataSets || []) if (ds.source === old) ds.source = v.name;
      } else d.dataSources.push(v);
    });
    onClose();
  };
  const del = () => {
    if (def.dataSets?.some(d => d.source === orig.name)) { window.alert('A data set still uses this source. Delete or change that data set first.'); return; }
    useDesigner.getState().apply(d => { d.dataSources.splice(index, 1); }); onClose();
  };
  return (
    <Dialog wide title={orig ? `Data source ${orig.name}` : 'New data source'} onClose={onClose}
      footer={<>{orig && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!err} onClick={save}>Save</button></>}>
      <div className="grid2">
        <Field label="Name"><TextInput value={s.name} onChange={v => setS({ ...s, name: v })} autoFocus /></Field>
        <Field label="Type"><Select value={s.type} options={[{ value: 'rest', label: 'REST API (JSON)' }, { value: 'json', label: 'Inline JSON' }, { value: 'csv', label: 'CSV' }, { value: 'graphql', label: 'GraphQL' }, { value: 'sql', label: 'SQL database (on the server)' }]} onChange={v => setS({ ...s, type: v })} /></Field>
      </div>
      {(s.type === 'rest' || s.type === 'csv' || s.type === 'graphql') && <>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8 }}>
          <Field label="Method"><Select value={s.method} options={['GET', 'POST']} onChange={v => setS({ ...s, method: v })} /></Field>
          <Field label="URL" hint="Use {Parameters.x} for values. A relative URL calls this app."><TextInput value={s.url} onChange={v => setS({ ...s, url: v })} mono placeholder="/api/... or https://..." /></Field>
        </div>
        <Field label="Headers (JSON)"><textarea className="textarea" rows={3} value={s.headersText} onChange={e => setS({ ...s, headersText: e.target.value })} placeholder='{"Authorization": "Bearer {Parameters.token}"}' /></Field>
        {s.method === 'POST' && s.type !== 'graphql' && <Field label="Body"><textarea className="textarea" rows={3} value={s.body || ''} onChange={e => setS({ ...s, body: e.target.value })} /></Field>}
        {s.type === 'graphql' && <>
          <Field label="GraphQL query"><textarea className="textarea" rows={5} value={s.query || ''} onChange={e => setS({ ...s, query: e.target.value })} placeholder="query ($id: ID!) { account(id: $id) { name payments { due amount } } }" /></Field>
          <Field label="Variables (JSON, {Parameters.x} allowed)"><textarea className="textarea" rows={2} value={s.variables || ''} onChange={e => setS({ ...s, variables: e.target.value })} placeholder='{"id": "{Parameters.accountId}"}' /></Field>
        </>}
        <Check label="Call through the server proxy (for CORS; the host must be in PW_PROXY_ALLOW)" checked={s.useProxy} onChange={v => setS({ ...s, useProxy: v })} />
      </>}
      {s.type === 'sql' && <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
          <Field label="Connection" hint="Set up on the server as PW_DB_<NAME> (SQLite, Postgres or MySQL).">
            <Select value={s.connection || ''} allowEmpty options={(conns || []).map(c => ({ value: c.name, label: `${c.name} (${c.kind})` }))} onChange={v => { setS({ ...s, connection: v }); setProbe(null); }} />
          </Field>
          <button className="btn" onClick={testConn} disabled={!s.connection || probe?.state === 'testing'}>{probe?.state === 'testing' ? 'Testing…' : 'Test'}</button>
        </div>
        {conns && !conns.length && <div className="hint">No connections on this server yet. Set PW_DB_MAIN=sqlite:/path/file.db (or a postgres:// / mysql:// URL) and restart.</div>}
        {probe && probe.state !== 'testing' && <div className={probe.state === 'ok' ? 'hint' : 'err'} role="status">{probe.text}</div>}
        <Field label="Query" hint="SELECT only. @name uses the report parameter name (bound, never pasted into the SQL). Lists work with in (@name).">
          <textarea className="textarea" rows={6} value={s.query || ''} onChange={e => setS({ ...s, query: e.target.value })} placeholder="select region, month, sum(amount) as amount from sales where year = @year group by region, month" style={{ fontFamily: 'var(--mono)' }} />
        </Field>
      </>}
      {(s.type === 'json' || (s.type === 'csv' && !s.url)) && (
        <Field label={s.type === 'json' ? 'JSON data' : 'CSV text (first row = headers)'}><textarea className="textarea" rows={10} value={s.dataText} onChange={e => setS({ ...s, dataText: e.target.value })} /></Field>
      )}
      {err && s.name && <div className="err">{err}</div>}
    </Dialog>
  );
}

function DataSetDialog({ index, onClose, onSaved }) {
  const def = useDesigner(s => s.def);
  const orig = index != null ? def.dataSets[index] : null;
  const [d, setD] = useState(() => ({ name: '', source: def.dataSources?.[0]?.name, path: '$', fields: [], sort: [], ...(orig ? JSON.parse(JSON.stringify(orig)) : {}) }));
  const [detect, setDetect] = useState({ state: 'idle' });
  const err = !NAME.test(d.name) ? 'The name must start with a letter and hold only letters, digits and _' : !uniqueIn(def.dataSets, d.name, index) ? 'Another data set has this name' : !d.source ? 'Pick a source' : null;

  const [explore, setExplore] = useState(null);
  const loadRaw = async () => {
    const params = resolveParameters(useDesigner.getState().def, {});
    const src = useDesigner.getState().def.dataSources.find(s => s.name === d.source);
    return (await loadSources({ dataSources: [src] }, { params, baseUrl: window.location.origin, sqlPreview: true }))[src.name];
  };
  // Response explorer: every list in the response, with its path and fields; pick one to use it as the rows.
  const openExplorer = async () => {
    setExplore({ state: 'loading' });
    try {
      const raw = await loadRaw();
      const arrays = rowArrays(raw);
      setExplore({ state: 'done', arrays, best: bestRows(raw)?.path, raw });
    } catch (e) { setExplore({ state: 'error', message: e.message }); }
  };
  const pick = (path) => {
    let list = jsonPath(explore.raw, path);
    if (!Array.isArray(list)) list = [list];
    const keep = new Map(d.fields.map(f => [f.name, f]));
    setD({ ...d, path, fields: detectFields(list).map(f => keep.get(f.name) || f).concat(d.fields.filter(f => f.expr)) });
    setDetect({ state: 'done', rows: list.length });
    setExplore(null);
  };
  const run = async () => {
    setDetect({ state: 'loading' });
    try {
      const raw = await loadRaw();
      let list = jsonPath(raw, d.path || '$');
      if (list == null) throw new Error(`Nothing at the path "${d.path}"`);
      if (!Array.isArray(list)) list = [list];
      const found = detectFields(list);
      const keep = new Map(d.fields.map(f => [f.name, f]));
      setD({ ...d, fields: found.map(f => keep.get(f.name) || f).concat(d.fields.filter(f => f.expr)) });
      setDetect({ state: 'done', rows: list.length });
    } catch (e) { setDetect({ state: 'error', message: e.message }); }
  };

  const save = () => {
    useDesigner.getState().apply(x => {
      x.dataSets ||= [];
      const v = { name: d.name, source: d.source, path: d.path || '$', fields: d.fields.filter(f => f.name) };
      if (d.filters?.length) v.filters = d.filters;
      if (d.sort?.length) v.sort = d.sort.filter(s => s.by);
      if (index != null) {
        const old = x.dataSets[index].name;
        x.dataSets[index] = v;
        if (old !== v.name) for (const s of SECTIONS) for (const it of x.sections[s.key].items) if (it.dataSet === old) it.dataSet = v.name;
      } else x.dataSets.push(v);
    });
    onSaved?.(d.name);
    onClose();
    loadSample();
  };
  const del = () => {
    useDesigner.getState().apply(x => {
      x.dataSets.splice(index, 1);
      for (const s of SECTIONS) for (const it of x.sections[s.key].items) if (it.dataSet === orig.name) delete it.dataSet;
    });
    onClose();
  };
  const setField = (i, k, v) => setD({ ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, [k]: v } : f)) });
  const sortBy = d.sort?.[0]?.by?.replace(/^=Fields\./, '') || '';
  return (
    <Dialog wide title={orig ? `Data set ${orig.name}` : 'New data set'} onClose={onClose}
      footer={<>{orig && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!err} onClick={save}>Save</button></>}>
      <div className="grid2">
        <Field label="Name"><TextInput value={d.name} onChange={v => setD({ ...d, name: v })} autoFocus /></Field>
        <Field label="Source"><Select value={d.source} options={(def.dataSources || []).map(s => s.name)} onChange={v => setD({ ...d, source: v })} /></Field>
      </div>
      <Field label="Path to the rows" hint="JSONPath subset: $, $.items, $.data[*].lines"><TextInput value={d.path} onChange={v => setD({ ...d, path: v })} mono /></Field>
      <div className="btnrow" style={{ alignItems: 'center' }}>
        <button className="btn" onClick={run} disabled={!d.source || detect.state === 'loading'}>{detect.state === 'loading' ? 'Reading the source…' : 'Detect fields'}</button>
        <button className="btn" onClick={openExplorer} disabled={!d.source || explore?.state === 'loading'}>{explore?.state === 'loading' ? 'Reading the source…' : 'Explore the response'}</button>
        {detect.state === 'done' && <span className="hint">Found {detect.rows} rows.</span>}
        {detect.state === 'error' && <span className="err">{detect.message}</span>}
      </div>
      {explore?.state === 'error' && <div className="err">{explore.message}</div>}
      {explore?.state === 'done' && (
        <div className="explorer" role="list" aria-label="Lists in the response" style={{ display: 'grid', gap: 4, maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6, padding: 6 }}>
          {!explore.arrays.length && <div className="hint">The response has no lists. Use the path $ for a single row.</div>}
          {explore.arrays.map(a => (
            <div key={a.path} role="listitem" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
              <div>
                <code>{a.path}</code> <span className="hint">· {a.rows} {a.rows === 1 ? 'row' : 'rows'}{a.path === explore.best ? ' · suggested' : ''}</span>
                {a.objects && <div className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fields.join(', ') || 'no plain fields'}</div>}
              </div>
              <button className={`btn sm${a.path === explore.best ? ' primary' : ''}`} disabled={!a.objects} onClick={() => pick(a.path)} title={a.objects ? 'Use these rows' : 'A list of plain values cannot be rows with fields'}>Use</button>
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="hint" style={{ marginBottom: 6 }}>Fields</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {d.fields.map((f, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1.4fr auto', gap: 6 }}>
              <TextInput value={f.name} onChange={v => setField(i, 'name', v)} mono aria-label="Field name" />
              <Select value={f.type} options={['string', 'number', 'date', 'boolean']} onChange={v => setField(i, 'type', v)} />
              <TextInput value={f.expr || ''} onChange={v => setField(i, 'expr', v || undefined)} mono placeholder="calculated: =Fields.a * 2" />
              <button className="btn sm ghost danger" onClick={() => setD({ ...d, fields: d.fields.filter((_, j) => j !== i) })} aria-label="Remove field">✕</button>
            </div>
          ))}
          <div><button className="btn sm" onClick={() => setD({ ...d, fields: [...d.fields, { name: '', type: 'string' }] })}>Add field</button></div>
        </div>
      </div>
      <div>
        <div className="hint" style={{ marginBottom: 6 }}>Filters (all must match)</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {(d.filters || []).map((f, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr auto', gap: 6 }}>
              <TextInput value={f.expr} onChange={v => setD({ ...d, filters: d.filters.map((x, j) => j === i ? { ...x, expr: v } : x) })} mono aria-label="Filter field" />
              <Select value={f.op || '='} options={OPS} onChange={v => setD({ ...d, filters: d.filters.map((x, j) => j === i ? { ...x, op: v } : x) })} />
              <div style={{ display: 'flex', gap: 4 }}>
                <TextInput value={f.value} onChange={v => setD({ ...d, filters: d.filters.map((x, j) => j === i ? { ...x, value: v } : x) })} mono placeholder="value or =Parameters.x" aria-label="Filter value" />
                {f.op === 'Between' && <TextInput value={f.value2} onChange={v => setD({ ...d, filters: d.filters.map((x, j) => j === i ? { ...x, value2: v } : x) })} mono placeholder="and" aria-label="Upper value" />}
              </div>
              <button className="btn sm ghost danger" onClick={() => setD({ ...d, filters: d.filters.filter((_, j) => j !== i) })} aria-label="Remove filter">✕</button>
            </div>
          ))}
          <div><button className="btn sm" onClick={() => setD({ ...d, filters: [...(d.filters || []), { expr: d.fields[0] ? `=Fields.${d.fields[0].name}` : '', op: '=', value: '' }] })}>Add filter</button></div>
        </div>
      </div>
      <div className="grid2">
        <Field label="Sort by"><Select value={sortBy} allowEmpty options={d.fields.map(f => f.name)} onChange={v => setD({ ...d, sort: v ? [{ by: `=Fields.${v}`, dir: d.sort?.[0]?.dir || 'asc' }] : [] })} /></Field>
        <Field label="Direction"><Select value={d.sort?.[0]?.dir || 'asc'} options={['asc', 'desc']} onChange={v => setD({ ...d, sort: sortBy ? [{ by: `=Fields.${sortBy}`, dir: v }] : [] })} /></Field>
      </div>
      {err && d.name && <div className="err">{err}</div>}
    </Dialog>
  );
}
