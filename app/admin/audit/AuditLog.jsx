'use client';
import { useCallback, useEffect, useState } from 'react';
import { t } from '@/i18n/index.js';

const cell = { padding: '8px 12px', borderTop: '1px solid var(--line-2)', textAlign: 'start', verticalAlign: 'top', fontSize: 13 };
const PAGE = 200;

/** The audit log for admins: filters, the newest events first, more on demand, and the same filters as CSV. */
export default function AuditLog({ lang, types, retentionDays }) {
  const T = (k, v) => t(lang, k, v);
  const q = lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : '';
  const [f, setF] = useState({ from: '', to: '', type: '', actor: '', report: '' });
  const [applied, setApplied] = useState(f);
  const [events, setEvents] = useState(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState(null);

  const query = (extra = {}) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...applied, ...extra })) if (v) sp.set(k, String(v));
    return sp.toString();
  };
  const load = useCallback(async (before) => {
    setErr(null);
    try {
      const res = await fetch(`/api/audit?${query({ limit: PAGE, ...(before ? { before } : {}) })}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEvents(prev => (before ? [...(prev || []), ...data] : data));
      setMore(data.length === PAGE);
    } catch (e) { setErr(e.message); }
  }, [applied]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const field = (k, label, props = {}) => (
    <label className="field" style={{ minWidth: 150, flex: props.flex || 'none' }}>
      <span>{label}</span>
      <input className="input" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} {...props} />
    </label>
  );
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ flex: 1 }}>{T('auditLog')}</h1>
        <a className="btn" href={`/admin/users${q}`}>{T('users')}</a>
        <a className="btn" href={`/${q}`}>{T('reports')}</a>
      </div>
      <p className="lede">{T('auditLede', { days: retentionDays })}</p>

      <form className="home-bar" aria-label={T('auditFilters')} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end', margin: '14px 0' }}
        onSubmit={(e) => { e.preventDefault(); setApplied({ ...f }); }}>
        {field('from', T('auditFrom'), { type: 'date' })}
        {field('to', T('auditTo'), { type: 'date' })}
        <label className="field" style={{ minWidth: 180 }}>
          <span>{T('eventType')}</span>
          <select className="select" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
            <option value="">{T('allEvents')}</option>
            {['auth.', 'report.', 'access.', 'user.', 'schedule.'].map(p => <option key={p} value={p}>{p}*</option>)}
            {types.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        {field('actor', T('actor'), { placeholder: 'user:name@example.com', flex: 1 })}
        {field('report', T('reportId'), { placeholder: 'loan-statement' })}
        <button className="btn primary">{T('applyFilters')}</button>
        <a className="btn" href={`/api/audit?${query({ format: 'csv' })}`} download>{T('exportCsv')}</a>
      </form>

      {err && <p className="err" role="alert">{err}</p>}
      <div className="rlist" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label={T('auditLog')}>
          <thead>
            <tr>{[T('when'), T('eventType'), T('status'), T('actor'), T('fromAddress'), T('reportId'), T('formatCol'), T('paramsHashCol'), T('details')].map(h => (
              <th key={h} scope="col" style={{ ...cell, borderTop: 0, fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {(events || []).map(e => (
              <tr key={e.id} data-type={e.type}>
                <td style={{ ...cell, whiteSpace: 'nowrap' }} title={e.at}>{new Date(e.at).toLocaleString(lang === 'en' ? 'en-IN' : lang, { dateStyle: 'medium', timeStyle: 'medium' })}</td>
                <td style={cell}><code>{e.type}</code></td>
                <td style={{ ...cell, color: e.status === 'ok' ? 'inherit' : 'var(--danger)' }}>{e.status}</td>
                <td style={{ ...cell, overflowWrap: 'anywhere' }}>{e.actor}</td>
                <td style={cell}>{e.ip}</td>
                <td style={cell}>{e.report || ''}</td>
                <td style={cell}>{e.format || ''}</td>
                <td style={cell}><code>{e.params || ''}</code></td>
                <td style={{ ...cell, overflowWrap: 'anywhere', fontFamily: 'var(--mono)', fontSize: 12 }}>{e.detail ? JSON.stringify(e.detail) : ''}</td>
              </tr>
            ))}
            {events && !events.length && <tr><td style={cell} colSpan={9}><span className="hint">{T('noEvents')}</span></td></tr>}
            {!events && !err && <tr><td style={cell} colSpan={9}><span className="hint">{T('loading')}</span></td></tr>}
          </tbody>
        </table>
      </div>
      {more && <div style={{ marginTop: 12 }}><button type="button" className="btn" onClick={() => load(events.at(-1).id)}>{T('loadMore')}</button></div>}
    </>
  );
}
