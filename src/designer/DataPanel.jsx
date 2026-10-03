'use client';
import { useState } from 'react';
import { useDesigner, SECTIONS } from './store.js';
import { MIME_FIELD } from './Canvas.jsx';
import { loadSources, buildDataSets, detectFields, jsonPath } from '@/engine/data/index.js';
import { resolveParameters } from '@/engine/index.js';
import { Dialog, Field, TextInput, Select, Check } from './ui.jsx';

const NAME = /^[A-Za-z_][\w]*$/;

/** Load every source and build data sets with parameter defaults. Used for previews and field detection. */
export async function loadSample() {
  const { def } = useDesigner.getState();
  useDesigner.setState({ sample: { loading: true } });
  try {
    const params = resolveParameters(def, {});
    const sources = await loadSources(def, { params, baseUrl: window.location.origin });
    const ctx = { params, globals: { ExecutionTime: new Date() }, dataSets: {}, fields: null, locale: def.locale, currency: def.currency };
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
                  <span className="nm"><b>{d.name}</b></span>
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

function ParamDialog({ index, onClose }) {
  const def = useDesigner(s => s.def);
  const orig = index != null ? def.parameters[index] : null;
  const [p, setP] = useState(orig || { name: '', type: 'string', prompt: '', default: '', required: false });
  const err = !NAME.test(p.name) ? 'The name must start with a letter and hold only letters, digits and _' : !uniqueIn(def.parameters, p.name, index) ? 'Another parameter has this name' : null;
  const save = () => {
    useDesigner.getState().apply(d => {
      d.parameters ||= [];
      const v = { ...p }; if (v.default === '') delete v.default; if (!v.prompt) delete v.prompt;
      if (index != null) d.parameters[index] = v; else d.parameters.push(v);
    });
    onClose();
  };
  const del = () => { useDesigner.getState().apply(d => { d.parameters.splice(index, 1); }); onClose(); };
  return (
    <Dialog title={orig ? `Parameter ${orig.name}` : 'New parameter'} onClose={onClose}
      footer={<>{orig && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!err} onClick={save}>Save</button></>}>
      <div className="grid2">
        <Field label="Name"><TextInput value={p.name} onChange={v => setP({ ...p, name: v })} autoFocus /></Field>
        <Field label="Type"><Select value={p.type} options={['string', 'number', 'date', 'boolean']} onChange={v => setP({ ...p, type: v })} /></Field>
        <Field label="Prompt"><TextInput value={p.prompt} onChange={v => setP({ ...p, prompt: v })} /></Field>
        <Field label="Default" hint="A value or =expression, e.g. =Today()"><TextInput value={p.default} onChange={v => setP({ ...p, default: v })} mono /></Field>
      </div>
      <Check label="Required" checked={p.required} onChange={v => setP({ ...p, required: v })} />
      {err && p.name && <div className="err">{err}</div>}
      <div className="hint">Use it in expressions as <code>Parameters.{p.name || 'name'}</code> and in a REST URL as <code>{'{Parameters.'}{p.name || 'name'}{'}'}</code>.</div>
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
  if (!err && s.type === 'rest' && !s.url) err = 'Give a URL';

  const save = () => {
    const v = { name: s.name, type: s.type };
    if (s.type === 'rest' || (s.type === 'csv' && s.url)) { v.url = s.url; v.method = s.method; if (headers) v.headers = headers; if (s.useProxy) v.useProxy = true; if (s.body && s.method !== 'GET') v.body = s.body; }
    if (s.type === 'json') v.data = data;
    if (s.type === 'csv' && !s.url) v.data = s.dataText;
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
        <Field label="Type"><Select value={s.type} options={[{ value: 'rest', label: 'REST API (JSON)' }, { value: 'json', label: 'Inline JSON' }, { value: 'csv', label: 'CSV' }]} onChange={v => setS({ ...s, type: v })} /></Field>
      </div>
      {(s.type === 'rest' || s.type === 'csv') && <>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8 }}>
          <Field label="Method"><Select value={s.method} options={['GET', 'POST']} onChange={v => setS({ ...s, method: v })} /></Field>
          <Field label="URL" hint="Use {Parameters.x} for values. A relative URL calls this app."><TextInput value={s.url} onChange={v => setS({ ...s, url: v })} mono placeholder="/api/... or https://..." /></Field>
        </div>
        <Field label="Headers (JSON)"><textarea className="textarea" rows={3} value={s.headersText} onChange={e => setS({ ...s, headersText: e.target.value })} placeholder='{"Authorization": "Bearer {Parameters.token}"}' /></Field>
        {s.method === 'POST' && <Field label="Body"><textarea className="textarea" rows={3} value={s.body || ''} onChange={e => setS({ ...s, body: e.target.value })} /></Field>}
        <Check label="Call through the server proxy (for CORS; the host must be in PW_PROXY_ALLOW)" checked={s.useProxy} onChange={v => setS({ ...s, useProxy: v })} />
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

  const run = async () => {
    setDetect({ state: 'loading' });
    try {
      const params = resolveParameters(useDesigner.getState().def, {});
      const src = useDesigner.getState().def.dataSources.find(s => s.name === d.source);
      const raw = (await loadSources({ dataSources: [src] }, { params, baseUrl: window.location.origin }))[src.name];
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
        {detect.state === 'done' && <span className="hint">Found {detect.rows} rows.</span>}
        {detect.state === 'error' && <span className="err">{detect.message}</span>}
      </div>
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
      <div className="grid2">
        <Field label="Sort by"><Select value={sortBy} allowEmpty options={d.fields.map(f => f.name)} onChange={v => setD({ ...d, sort: v ? [{ by: `=Fields.${v}`, dir: d.sort?.[0]?.dir || 'asc' }] : [] })} /></Field>
        <Field label="Direction"><Select value={d.sort?.[0]?.dir || 'asc'} options={['asc', 'desc']} onChange={v => setD({ ...d, sort: sortBy ? [{ by: `=Fields.${sortBy}`, dir: v }] : [] })} /></Field>
      </div>
      {err && d.name && <div className="err">{err}</div>}
    </Dialog>
  );
}
