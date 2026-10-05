'use client';
// Visual SQL query builder (SQL source dialog): browse the connection's tables, tick columns, join tables (drag a column
// onto another table's column, or take a suggested foreign-key join), filter (by report parameters, bound as @name),
// sort and limit; the SELECT is written live (sqlBuild.js) and rows can be previewed. "Edit as SQL" switches to text.
import { useEffect, useMemo, useState } from 'react';
import { Field, Select, TextInput } from './ui.jsx';
import { useDesigner } from './store.js';
import { buildSql, suggestJoins, aliasFor, FILTER_OPS } from './sqlBuild.js';
import { resolveParameters } from '@/engine/index.js';

const MIME_COL = 'application/x-pw-sql-column';
const schemas = new Map(); // connection → schema (this page)

/** GET /api/data/sql/schema?connection= → { tables: [{ name, columns: [{ name, type, pk? }], foreignKeys? }] } */
function useSchema(connection) {
  const [st, setSt] = useState(() => (schemas.has(connection) ? { tables: schemas.get(connection) } : { loading: !!connection }));
  useEffect(() => {
    if (!connection) { setSt({}); return undefined; }
    if (schemas.has(connection)) { setSt({ tables: schemas.get(connection) }); return undefined; }
    let alive = true;
    setSt({ loading: true });
    fetch(`/api/data/sql/schema?connection=${encodeURIComponent(connection)}`).then(async r => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      const tables = Array.isArray(body.tables) ? body.tables : [];
      schemas.set(connection, tables);
      if (alive) setSt({ tables });
    }).catch(e => { if (alive) setSt({ error: e.message }); });
    return () => { alive = false; };
  }, [connection]);
  return st;
}

export default function SqlBuilder({ s, setS, T, kind, onManual }) {
  const def = useDesigner(st => st.def);
  const schema = useSchema(s.connection);
  const b = s.builder || { tables: [], columns: [], joins: [], filters: [], sort: [] };
  const set = (patch) => { const nb = { ...b, ...patch }; setS({ ...s, builder: nb, query: buildSql(nb, kind) }); };
  const [find, setFind] = useState('');
  const [preview, setPreview] = useState(null);
  const sql = buildSql(b, kind);
  const tableOf = (name) => (schema.tables || []).find(t => t.name === name);
  const colsOf = (alias) => tableOf(b.tables.find(t => t.alias === alias)?.name)?.columns || [];
  const allCols = b.tables.flatMap(t => colsOf(t.alias).map(c => ({ value: `${t.alias}.${c.name}`, label: `${t.alias}.${c.name}` })));
  const split = (v) => { const i = String(v || '').indexOf('.'); return i < 0 ? { t: '', c: '' } : { t: v.slice(0, i), c: v.slice(i + 1) }; };
  const params = (def.parameters || []).map(p => p.name);

  const addTable = (name) => {
    const alias = aliasFor(name, new Set(b.tables.map(t => t.alias)));
    const tables = [...b.tables, { name, alias }];
    const sugg = suggestJoins({ ...b, tables }, schema.tables, alias);
    set({ tables, joins: [...b.joins, ...sugg.slice(0, 1)] }); // the first foreign-key join is taken; others are offered
  };
  const removeTable = (alias) => set({
    tables: b.tables.filter(t => t.alias !== alias), columns: b.columns.filter(c => c.t !== alias),
    joins: b.joins.filter(j => j.from.t !== alias && j.to.t !== alias), filters: b.filters.filter(f => f.t !== alias), sort: b.sort.filter(x => x.t !== alias),
  });
  const ticked = (t, c) => b.columns.some(x => x.t === t && x.c === c);
  const tick = (t, c, on) => set({ columns: on ? [...b.columns, { t, c }] : b.columns.filter(x => !(x.t === t && x.c === c)) });
  const join = (from, to) => { if (from.t === to.t || b.joins.some(j => (j.from.t === from.t && j.from.c === from.c && j.to.t === to.t && j.to.c === to.c))) return; set({ joins: [...b.joins, { type: 'inner', from, to }] }); };
  const offered = useMemo(() => b.tables.flatMap(t => suggestJoins(b, schema.tables, t.alias)).filter((j, i, a) => !b.joins.some(x => x.from.t === j.from.t && x.from.c === j.from.c && x.to.t === j.to.t && x.to.c === j.to.c) && a.findIndex(y => JSON.stringify(y) === JSON.stringify(j)) === i), [b, schema.tables]);

  const runPreview = async () => {
    setPreview({ loading: true });
    try {
      let ps = {};
      try { ps = resolveParameters(def, {}, { lenient: true }); } catch { /* defaults only */ }
      const r = await fetch('/api/data/sql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connection: s.connection, query: sql, params: ps }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setPreview({ rows: (body.rows || []).slice(0, 20), n: (body.rows || []).length });
    } catch (e) { setPreview({ error: e.message }); }
  };

  if (!s.connection) return <div className="hint">{T('qb_pickConnection')}</div>;
  if (schema.loading) return <div className="hint">{T('qb_loading')}</div>;
  if (schema.error) return <div className="err" data-testid="qb-error">{T('qb_noSchema', { message: schema.error })} <button type="button" className="btn sm" onClick={onManual}>{T('qb_editSql')}</button></div>;
  const list = (schema.tables || []).filter(t => !find || t.name.toLowerCase().includes(find.toLowerCase()));
  return (
    <div className="qb" data-testid="query-builder">
      <aside className="qb-tables" aria-label={T('qb_tables')}>
        <input type="search" className="input" placeholder={T('qb_findTable')} aria-label={T('qb_findTable')} value={find} onChange={e => setFind(e.target.value)} />
        <ul>
          {list.map(t => <li key={t.name}><button type="button" className="linklike" onClick={() => addTable(t.name)} data-qb-add={t.name} title={T('qb_addTable')}>+ {t.name}</button> <span className="hint">{t.columns?.length || 0}</span></li>)}
          {!list.length && <li className="hint">{T('qb_noTables')}</li>}
        </ul>
      </aside>
      <div className="qb-main">
        <div className="qb-canvas">
          {!b.tables.length && <div className="hint">{T('qb_start')}</div>}
          {b.tables.map(t => (
            <div className="qb-table" key={t.alias} data-qb-table={t.alias}>
              <header><b>{t.name}</b> <span className="hint">{t.alias}</span><button type="button" className="btn sm ghost danger" onClick={() => removeTable(t.alias)} aria-label={T('qb_removeTable', { name: t.name })}>✕</button></header>
              <ul>
                {colsOf(t.alias).map(c => (
                  <li key={c.name} draggable data-qb-col={`${t.alias}.${c.name}`}
                    onDragStart={(e) => { e.dataTransfer.setData(MIME_COL, JSON.stringify({ t: t.alias, c: c.name })); e.dataTransfer.effectAllowed = 'link'; }}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes(MIME_COL)) e.preventDefault(); }}
                    onDrop={(e) => { const f = JSON.parse(e.dataTransfer.getData(MIME_COL) || 'null'); if (f) { e.preventDefault(); join(f, { t: t.alias, c: c.name }); } }}>
                    <label className="check"><input type="checkbox" checked={ticked(t.alias, c.name)} onChange={e => tick(t.alias, c.name, e.target.checked)} />{c.name}</label>
                    <span className="ty">{c.pk ? 'PK ' : ''}{c.type || ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {b.tables.length > 1 && <section className="qb-sec" data-testid="qb-joins">
          <h5>{T('qb_joins')}</h5>
          {b.joins.map((j, i) => (
            <div className="qb-row" key={i}>
              <Select value={j.type} options={[{ value: 'inner', label: T('qb_inner') }, { value: 'left', label: T('qb_left') }]} onChange={v => set({ joins: b.joins.map((x, k) => (k === i ? { ...x, type: v } : x)) })} aria-label={T('qb_joinType')} />
              <code>{j.from.t}.{j.from.c} = {j.to.t}.{j.to.c}</code>
              <button type="button" className="btn sm ghost danger" onClick={() => set({ joins: b.joins.filter((_, k) => k !== i) })} aria-label={T('i_remove')}>✕</button>
            </div>
          ))}
          {offered.map((j, i) => <div className="qb-row" key={`o${i}`}><span className="hint">{T('qb_suggested')}</span><code>{j.from.t}.{j.from.c} = {j.to.t}.{j.to.c}</code><button type="button" className="btn sm" onClick={() => set({ joins: [...b.joins, j] })}>{T('qb_addJoin')}</button></div>)}
          <JoinAdder allCols={allCols} split={split} onAdd={join} T={T} />
          <div className="hint">{T('qb_joinHint')}</div>
        </section>}
        {b.tables.length > 0 && <section className="qb-sec" data-testid="qb-filters">
          <h5>{T('qb_filters')}</h5>
          {b.filters.map((f, i) => {
            const setF = (patch) => set({ filters: b.filters.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
            const noValue = f.op === 'is null' || f.op === 'is not null';
            return (
              <div className="qb-row" key={i}>
                <Select value={`${f.t}.${f.c}`} options={allCols} onChange={v => setF(split(v))} aria-label={T('qb_column')} />
                <Select value={f.op} options={FILTER_OPS} onChange={v => setF({ op: v })} aria-label={T('sfOperator')} />
                {!noValue && <Select value={f.param ? `p:${f.param}` : 'v'} options={[{ value: 'v', label: T('qb_value') }, ...params.map(p => ({ value: `p:${p}`, label: `@${p}` }))]} onChange={v => setF(v === 'v' ? { param: undefined } : { param: v.slice(2), value: undefined })} aria-label={T('qb_valueFrom')} />}
                {!noValue && !f.param && <TextInput value={f.value ?? ''} onChange={v => setF({ value: v })} aria-label={T('qb_value')} mono />}
                <button type="button" className="btn sm ghost danger" onClick={() => set({ filters: b.filters.filter((_, k) => k !== i) })} aria-label={T('dsRemoveFilter')}>✕</button>
              </div>
            );
          })}
          <div><button type="button" className="btn sm" data-testid="qb-add-filter" onClick={() => set({ filters: [...b.filters, { ...split(allCols[0]?.value), op: '=', ...(params[0] ? { param: params[0] } : { value: '' }) }] })}>{T('dsAddFilter')}</button></div>
          <div className="hint">{T('qb_filterHint')}</div>
        </section>}
        {b.tables.length > 0 && <section className="qb-sec" data-testid="qb-sort">
          <h5>{T('qb_sortLimit')}</h5>
          {b.sort.map((x, i) => (
            <div className="qb-row" key={i}>
              <Select value={`${x.t}.${x.c}`} options={allCols} onChange={v => set({ sort: b.sort.map((y, k) => (k === i ? { ...y, ...split(v) } : y)) })} aria-label={T('qb_column')} />
              <Select value={x.dir || 'asc'} options={[{ value: 'asc', label: T('dsAsc') }, { value: 'desc', label: T('dsDesc') }]} onChange={v => set({ sort: b.sort.map((y, k) => (k === i ? { ...y, dir: v } : y)) })} aria-label={T('sfDirection')} />
              <button type="button" className="btn sm ghost danger" onClick={() => set({ sort: b.sort.filter((_, k) => k !== i) })} aria-label={T('dsRemoveSort')}>✕</button>
            </div>
          ))}
          <div className="qb-row">
            <button type="button" className="btn sm" onClick={() => set({ sort: [...b.sort, { ...split(allCols[0]?.value), dir: 'asc' }] })}>{T('dsAddSort')}</button>
            <Field label={T('qb_limit')}><TextInput value={b.limit ?? ''} onChange={v => set({ limit: /^\d+$/.test(v) ? Number(v) : undefined })} mono data-testid="qb-limit" /></Field>
          </div>
        </section>}
        <section className="qb-sec">
          <h5>{T('qb_sql')}</h5>
          <pre className="qb-sql" data-testid="qb-sql" aria-live="polite">{sql || '—'}</pre>
          <div className="btnrow">
            <button type="button" className="btn sm" disabled={!sql || preview?.loading} onClick={runPreview} data-testid="qb-preview">{preview?.loading ? T('dsReading') : T('qb_preview')}</button>
            <button type="button" className="btn sm ghost" onClick={onManual} data-testid="qb-edit-sql">{T('qb_editSql')}</button>
          </div>
          {preview?.error && <div className="err" data-testid="qb-preview-error">{preview.error}</div>}
          {preview?.rows && <div className="cw-table" data-testid="qb-rows">
            <div className="hint">{T('qb_rows', { n: preview.n })}</div>
            <table><thead><tr>{Object.keys(preview.rows[0] || {}).map(k => <th key={k}>{k}</th>)}</tr></thead>
              <tbody>{preview.rows.map((r, i) => <tr key={i}>{Object.keys(preview.rows[0] || {}).map(k => <td key={k}>{r[k] == null ? '—' : String(r[k])}</td>)}</tr>)}</tbody></table>
          </div>}
        </section>
      </div>
    </div>
  );
}

/** A join by picking both columns (the keyboard way to what dragging a column onto another does). */
function JoinAdder({ allCols, split, onAdd, T }) {
  const [a, setA] = useState(''), [z, setZ] = useState('');
  return (
    <div className="qb-row">
      <Select value={a} allowEmpty options={allCols} onChange={v => setA(v || '')} aria-label={T('qb_joinFrom')} />
      <span>=</span>
      <Select value={z} allowEmpty options={allCols} onChange={v => setZ(v || '')} aria-label={T('qb_joinTo')} />
      <button type="button" className="btn sm" disabled={!a || !z || split(a).t === split(z).t} onClick={() => { onAdd(split(a), split(z)); setA(''); setZ(''); }}>{T('qb_addJoin')}</button>
    </div>
  );
}
