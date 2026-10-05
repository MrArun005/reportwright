'use client';
// OData query editor (data source dialog): reads the service's $metadata, then entity set, fields ($select), filters
// ($filter from a simple builder), sort ($orderby), top/skip, $expand and a page cap. The engine builds the URL
// (src/engine/data/odata.js), so this only edits the source's fields.
import { useState } from 'react';
import { Field, TextInput, Select, Check } from './ui.jsx';
import { odataMetadata, ODATA_MAX_PAGES, ODATA_DEFAULT_PAGES } from '@/engine/data/odata.js';
import { sourceUrl } from '@/engine/data/index.js';
import { resolveParameters } from '@/engine/index.js';
import { origin } from '@/viewer/engineClient.js';
import { reportFetch } from '@/viewer/dataFetch.js';
import { useDesigner } from './store.js';

const OPS = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'contains', 'startswith', 'endswith'];
const OP_LABEL = { eq: '=', ne: '≠', gt: '>', ge: '≥', lt: '<', le: '≤' };

/** Fetch the service's $metadata through the same guarded fetch as the data itself. */
async function readMetadata(s) {
  const params = resolveParameters(useDesigner.getState().def, {});
  const root = sourceUrl(s.url, params).split('?')[0].replace(/\/+$/, '');
  let url = `${root}/$metadata`;
  if (s.useProxy) url = `/api/data/proxy?url=${encodeURIComponent(url)}`;
  const f = reportFetch(origin());
  const res = await f(url, { headers: { accept: 'application/xml' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return odataMetadata(await res.text());
}

export default function ODataEditor({ s, setS, T }) {
  const [meta, setMeta] = useState(null); // { state, sets?, message? }
  const sets = meta?.sets || [];
  const set = sets.find(x => x.name === s.entitySet);
  const props = set ? set.properties : (s.select || []).map(name => ({ name, type: s.types?.[name] || '' }));
  const propOpts = props.map(p => p.name);
  const typeOf = (name) => set?.properties.find(p => p.name === name)?.type || s.types?.[name];
  const read = async () => {
    setMeta({ state: 'loading' });
    try { setMeta({ state: 'done', sets: await readMetadata(s) }); } catch (e) { setMeta({ state: 'error', message: e.message }); }
  };
  const pickSet = (name) => {
    const st = sets.find(x => x.name === name);
    // the property types the engine maps (numbers that come as text, dates)
    const types = st ? Object.fromEntries(st.properties.filter(p => p.type !== 'Edm.String').map(p => [p.name, p.type])) : undefined;
    setS({ ...s, entitySet: name, select: [], filters: [], orderby: [], expand: [], types });
  };
  const toggleIn = (key, name, on) => setS({ ...s, [key]: on ? [...(s[key] || []), name] : (s[key] || []).filter(x => x !== name) });
  const filters = s.filters || [];
  const setFilter = (i, patch) => setS({ ...s, filters: filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const orderby = s.orderby || [];
  const setOrder = (i, patch) => setS({ ...s, orderby: orderby.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  return (
    <div data-testid="odata-editor" style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
        <Field label={T('odEntitySet')}>
          <Select value={s.entitySet || ''} allowEmpty options={sets.length ? sets.map(x => x.name) : s.entitySet ? [s.entitySet] : []} onChange={pickSet} />
        </Field>
        <button type="button" className="btn" onClick={read} disabled={!s.url || meta?.state === 'loading'}>{meta?.state === 'loading' ? T('dsReading') : T('odReadMeta')}</button>
      </div>
      {meta?.state === 'done' && <div className="hint" role="status">{T('odMetaFound', { n: sets.length })}</div>}
      {meta?.state === 'error' && <div className="err" role="status">{meta.message}</div>}
      {s.entitySet && <>
        {set && <div>
          <div className="hint" style={{ marginBottom: 4 }}>{T('odFields')}</div>
          <div role="group" aria-label={T('odFields')} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
            {set.properties.map(p => <Check key={p.name} label={p.name} checked={(s.select || []).includes(p.name)} onChange={v => toggleIn('select', p.name, v)} />)}
          </div>
        </div>}
        <div>
          <div className="hint" style={{ marginBottom: 4 }}>{T('odFilters')}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {filters.map((f, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 1fr auto', gap: 6 }}>
                <Select value={f.field} options={f.field && !propOpts.includes(f.field) ? [...propOpts, f.field] : propOpts} allowEmpty aria-label={T('odField')}
                  onChange={v => setFilter(i, { field: v, type: typeOf(v) })} />
                <Select value={f.op || 'eq'} aria-label={T('odOperator')} onChange={v => setFilter(i, { op: v })}
                  options={OPS.map(o => ({ value: o, label: OP_LABEL[o] || T(`odOp_${o}`) }))} />
                <TextInput value={f.value ?? ''} onChange={v => setFilter(i, { value: v })} mono placeholder={T('odValuePh')} aria-label={T('odValue')} />
                <button type="button" className="btn sm ghost danger" onClick={() => setS({ ...s, filters: filters.filter((_, j) => j !== i) })} aria-label={T('odRemove')}>✕</button>
              </div>
            ))}
            <div><button type="button" className="btn sm" onClick={() => setS({ ...s, filters: [...filters, { field: propOpts[0], op: 'eq', value: '', type: typeOf(propOpts[0]) }] })}>{T('odAddFilter')}</button></div>
            <div className="hint">{T('odFilterHint')}</div>
          </div>
        </div>
        <div>
          <div className="hint" style={{ marginBottom: 4 }}>{T('odOrderBy')}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {orderby.map((o, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px auto', gap: 6 }}>
                <Select value={o.field} options={o.field && !propOpts.includes(o.field) ? [...propOpts, o.field] : propOpts} allowEmpty aria-label={T('odField')} onChange={v => setOrder(i, { field: v })} />
                <Select value={o.dir || 'asc'} options={[{ value: 'asc', label: T('dsAsc') }, { value: 'desc', label: T('dsDesc') }]} onChange={v => setOrder(i, { dir: v })} />
                <button type="button" className="btn sm ghost danger" onClick={() => setS({ ...s, orderby: orderby.filter((_, j) => j !== i) })} aria-label={T('odRemove')}>✕</button>
              </div>
            ))}
            <div><button type="button" className="btn sm" onClick={() => setS({ ...s, orderby: [...orderby, { field: propOpts[0], dir: 'asc' }] })}>{T('odAddSort')}</button></div>
          </div>
        </div>
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Field label={T('odTop')}><TextInput value={s.top ?? ''} onChange={v => setS({ ...s, top: v })} mono /></Field>
          <Field label={T('odSkip')}><TextInput value={s.skip ?? ''} onChange={v => setS({ ...s, skip: v })} mono /></Field>
          <Field label={T('odMaxPages')} hint={T('odMaxPagesHint', { n: ODATA_MAX_PAGES })}><TextInput value={s.maxPages ?? ODATA_DEFAULT_PAGES} onChange={v => setS({ ...s, maxPages: v })} mono /></Field>
        </div>
        {set?.navigation.length > 0 && <div>
          <div className="hint" style={{ marginBottom: 4 }}>{T('odExpand')}</div>
          <div role="group" aria-label={T('odExpand')} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
            {set.navigation.map(n => <Check key={n} label={n} checked={(s.expand || []).includes(n)} onChange={v => toggleIn('expand', n, v)} />)}
          </div>
        </div>}
      </>}
    </div>
  );
}
