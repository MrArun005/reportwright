'use client';
import { useCallback, useEffect, useState } from 'react';
import { t } from '@/i18n/index.js';

const FORMATS = ['pdf', 'xlsx', 'docx', 'pptx', 'html', 'csv'];
const PRESETS = [['0 7 * * *', 'cronDaily'], ['0 7 * * 1', 'cronWeekly'], ['0 7 1 * *', 'cronMonthly'], ['0 * * * *', 'cronHourly']];
const cell = { padding: '8px 12px', borderTop: '1px solid var(--line-2)', textAlign: 'start', verticalAlign: 'top', fontSize: 13 };
const EMPTY = { template: '', cron: '0 7 * * *', timezone: '', format: 'pdf', params: '', delivery: 'download', to: '', subject: '', attach: true, fromSnapshot: false };

async function call(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
/** "name=value" lines to an object. */
const parseParams = (text) => Object.fromEntries(String(text).split('\n').map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf('='); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, '']; }));

/** Scheduled runs of saved reports: to download from the server, or emailed (attached, or a link when large). */
export default function Schedules({ lang }) {
  const T = (k, v) => t(lang, k, v);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => { try { setData(await call('/api/schedules')); } catch (e) { setErr(e.message); } }, []);
  useEffect(() => { load(); setForm(f => ({ ...f, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })); }, [load]);
  const act = async (fn, done) => { setErr(null); setMsg(null); try { await fn(); setMsg(done); await load(); return true; } catch (e) { setErr(e.message); return false; } };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const report = data?.reports.find(r => r.id === form.template);
  const add = async (e) => {
    e.preventDefault();
    const body = { template: form.template, cron: form.cron, timezone: form.timezone, format: form.format, parameters: parseParams(form.params), fromSnapshot: form.fromSnapshot,
      ...(form.delivery === 'email' ? { email: { to: form.to.split(/[,;\s]+/).filter(Boolean), subject: form.subject || undefined, attach: form.attach } } : {}) };
    if (await act(() => call('/api/schedules', 'POST', body), T('scheduleAdded'))) setForm({ ...EMPTY, timezone: form.timezone });
  };
  const when = (iso) => (iso ? new Date(iso).toLocaleString(lang === 'en' ? 'en-IN' : lang, { dateStyle: 'medium', timeStyle: 'short' }) : '–');

  return (
    <>
      <h1>{T('schedules')}</h1>
      <p className="lede" style={{ maxWidth: 'none' }}>{T('schedulesLede')}</p>
      <div aria-live="polite" style={{ minHeight: 22, margin: '8px 0' }}>
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
        {msg && <p role="status" style={{ margin: 0, color: 'var(--muted)' }}>{msg}</p>}
      </div>
      <form onSubmit={add} aria-label={T('addSchedule')} style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', alignItems: 'end', border: '1px solid var(--line)', borderRadius: 8, padding: 16, background: 'var(--panel)' }}>
        <label className="field"><span>{T('scheduleReport')}</span>
          <select className="select" required value={form.template} onChange={set('template')}>
            <option value="">–</option>
            {(data?.reports || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="field"><span>{T('scheduleWhen')}</span>
          <input className="input" required value={form.cron} onChange={set('cron')} list="cron-presets" style={{ fontFamily: 'var(--mono)' }} aria-describedby="cron-hint" />
          <datalist id="cron-presets">{PRESETS.map(([c, k]) => <option key={c} value={c}>{T(k)}</option>)}</datalist>
        </label>
        <label className="field"><span>{T('timeZone')}</span><input className="input" required value={form.timezone} onChange={set('timezone')} /></label>
        <label className="field"><span>{T('formatCol')}</span>
          <select className="select" value={form.format} onChange={set('format')}>{FORMATS.map(f => <option key={f} value={f}>{f}</option>)}</select>
        </label>
        <label className="field" style={{ gridColumn: 'span 2' }}><span>{T('scheduleParams')}</span>
          <textarea className="input" rows={2} value={form.params} onChange={set('params')} placeholder={(report?.parameters || []).map(p => `${p.name}=`).join('\n') || 'name=value'} style={{ fontFamily: 'var(--mono)', height: 'auto' }} />
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <legend className="hint" style={{ marginBottom: 4 }}>{T('delivery')}</legend>
          <label><input type="radio" name="delivery" value="download" checked={form.delivery === 'download'} onChange={set('delivery')} /> {T('deliverDownload')}</label>
          <label><input type="radio" name="delivery" value="email" checked={form.delivery === 'email'} onChange={set('delivery')} disabled={!data?.mail?.on} /> {T('deliverEmail')}</label>
        </fieldset>
        {form.delivery === 'email' && <>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>{T('mailTo', { domains: (data?.mail?.domains || []).join(', ') || '–' })}</span><input className="input" required value={form.to} onChange={set('to')} placeholder="ann@example.com, bob@example.com" /></label>
          <label className="field"><span>{T('mailSubject')}</span><input className="input" value={form.subject} onChange={set('subject')} maxLength={200} /></label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.attach} onChange={set('attach')} /> {T('mailAttach')}</label>
        </>}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title={T('fromSnapshotHint')}><input type="checkbox" checked={form.fromSnapshot} onChange={set('fromSnapshot')} /> {T('fromSnapshot')}</label>
        <div><button className="btn primary">{T('addSchedule')}</button></div>
        <p id="cron-hint" className="hint" style={{ margin: 0, gridColumn: '1 / -1' }}>{T('cronHint')}{!data?.mail?.on && ` ${T('mailOffHint')}`}</p>
      </form>

      <div className="rlist" style={{ overflowX: 'auto', marginTop: 18 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label={T('schedules')}>
          <thead><tr>{[T('scheduleReport'), T('scheduleWhen'), T('formatCol'), T('delivery'), T('nextRun'), T('lastRun'), T('actions')].map(h => <th key={h} scope="col" style={{ ...cell, borderTop: 0, fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{h}</th>)}</tr></thead>
          <tbody>
            {(data?.schedules || []).map(s => (
              <tr key={s.id} data-schedule={s.id}>
                <td style={cell}><b>{data.reports.find(r => r.id === s.template)?.name || s.template}</b>{s.enabled === false && <span className="hint"> · {T('stateOff')}</span>}</td>
                <td style={cell}><code>{s.cron}</code> <span className="hint">{s.timezone}</span></td>
                <td style={cell}>{s.format}{s.fromSnapshot && <span className="hint"> · {T('fromSnapshot')}</span>}</td>
                <td style={{ ...cell, overflowWrap: 'anywhere' }}>{s.email ? `${T('deliverEmail')}: ${s.email.to.join(', ')}${s.email.attach ? '' : ` (${T('mailLink')})`}` : T('deliverDownload')}</td>
                <td style={cell}>{when(s.nextRunAt)}</td>
                <td style={cell} data-testid="last-run">{s.lastJob ? <>{when(s.lastJob.finishedAt || s.lastRunAt)} · {s.lastJob.status}{s.lastJob.mail && <span className={s.lastJob.mail.status === 'sent' ? 'hint' : 'err'}> · {s.lastJob.mail.status === 'sent' ? T('mailSent', { how: s.lastJob.mail.how }) : T('mailFailed', { error: s.lastJob.mail.error })}</span>}</> : '–'}</td>
                <td style={cell}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" className="btn sm" onClick={() => act(() => call(`/api/schedules/${s.id}/run`, 'POST'), T('scheduleStarted'))}>{T('runNow')}</button>
                    <button type="button" className="btn sm" onClick={() => act(() => call(`/api/schedules/${s.id}`, 'PATCH', { enabled: s.enabled === false }), T('settingsSaved'))}>{s.enabled === false ? T('enable') : T('disable')}</button>
                    <button type="button" className="btn sm danger" onClick={() => { if (window.confirm(T('confirmDeleteSchedule'))) act(() => call(`/api/schedules/${s.id}`, 'DELETE'), T('scheduleDeleted')); }}>{T('delete')}</button>
                  </div>
                </td>
              </tr>
            ))}
            {data && !data.schedules.length && <tr><td style={cell} colSpan={7}><span className="hint">{T('noSchedules')}</span></td></tr>}
            {!data && !err && <tr><td style={cell} colSpan={7}><span className="hint">{T('loading')}</span></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
