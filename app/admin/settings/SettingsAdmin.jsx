'use client';
import { useCallback, useEffect, useState } from 'react';
import { t } from '@/i18n/index.js';

const ROLES = ['viewer', 'designer', 'admin'];
const box = { border: '1px solid var(--line)', borderRadius: 8, padding: '14px 16px', background: 'var(--panel)', display: 'grid', gap: 10, alignContent: 'start' };

async function call(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** What the server has configured by environment (read-only: set in the environment, see docs/GOVERNANCE.md). */
function StatusBox({ status: s, T }) {
  const row = (label, value) => (<><dt style={{ color: 'var(--muted)' }}>{label}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd></>);
  const onOff = (v) => (v ? T('stateOn') : T('stateOff'));
  return (
    <section style={box} aria-labelledby="st-h">
      <h2 id="st-h" style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{T('statusTitle')}</h2>
      <dl data-testid="server-status" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 14px', margin: 0 }}>
        {row(T('statusMail'), s.mail?.on ? `${s.mail.from} · ${s.mail.allowedDomains.length ? s.mail.allowedDomains.join(', ') : T('statusNoDomains')}` : T('notSet'))}
        {row(T('statusSlo'), `SAML ${onOff(s.sso?.samlLogout)} · OIDC ${onOff(s.sso?.oidcLogout)}`)}
        {row(T('statusSiem'), s.siem?.on ? `${s.siem.kind} ${s.siem.host} · ${T('siemQueue', { queued: s.siem.queued, sent: s.siem.sent, dropped: s.siem.dropped })}${s.siem.lastError ? ` · ${s.siem.lastError}` : ''}` : s.siem?.configured ? T('siemBad') : T('notSet'))}
        {row(T('statusAuditKey'), s.auditKey ? `${s.auditKey.fingerprint} (${s.auditKey.source})` : T('notSet'))}
      </dl>
      <p className="hint" style={{ margin: 0 }}>{T('statusHint')}</p>
    </section>
  );
}

/** Server settings for admins: who must use two-factor sign-in, and what the server has configured. */
export default function SettingsAdmin({ lang }) {
  const T = (k, v) => t(lang, k, v);
  const q = lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : '';
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [snap, setSnap] = useState(null);

  const load = useCallback(async () => {
    try { const d = await call('/api/admin/settings'); setData(d); setForm(d.settings); setSnap(await call('/api/admin/snapshots')); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (patch) => {
    setErr(null); setMsg(null);
    try { const d = await call('/api/admin/settings', 'PATCH', patch); setData(d); setForm(d.settings); setMsg(T('settingsSaved')); } catch (e) { setErr(e.message); }
  };
  const toggle = (r) => setForm(f => ({ ...f, require2fa: f.require2fa.includes(r) ? f.require2fa.filter(x => x !== r) : [...f.require2fa, r] }));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ flex: 1 }}>{T('serverSettings')}</h1>
        <a className="btn" href={`/admin/users${q}`}>{T('users')}</a>
        <a className="btn" href={`/admin/audit${q}`}>{T('auditLog')}</a>
        <a className="btn" href={`/${q}`}>{T('reports')}</a>
      </div>
      <div aria-live="polite" style={{ minHeight: 22, margin: '8px 0' }}>
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
        {msg && <p role="status" style={{ margin: 0, color: 'var(--muted)' }}>{msg}</p>}
      </div>
      {!form ? <p className="hint">{T('loading')}</p> : (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <form style={box} aria-label={T('twoFactor')} onSubmit={(e) => { e.preventDefault(); save({ require2fa: form.require2fa }); }}>
            <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{T('twoFactor')}</h2>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <legend style={{ marginBottom: 6 }}>{T('require2faFor')}</legend>
              {ROLES.map(r => (
                <label key={r} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={form.require2fa.includes(r)} onChange={() => toggle(r)} /> {r}
                </label>
              ))}
            </fieldset>
            <p className="hint" style={{ margin: 0 }}>{T('require2faHint')}</p>
            <div><button className="btn primary">{T('saveSettings')}</button></div>
          </form>
          <form style={box} aria-label={T('snapshotTitle')} onSubmit={(e) => { e.preventDefault(); save({ snapshotTtl: Number(form.snapshotTtl), snapshotMaxMb: Number(form.snapshotMaxMb) }); }}>
            <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{T('snapshotTitle')}</h2>
            <label className="field"><span>{T('snapshotTtl')}</span><input className="input" type="number" min={0} max={604800} required value={form.snapshotTtl} onChange={e => setForm({ ...form, snapshotTtl: e.target.value })} /></label>
            <label className="field"><span>{T('snapshotMax')}</span><input className="input" type="number" min={1} required value={form.snapshotMaxMb} onChange={e => setForm({ ...form, snapshotMaxMb: e.target.value })} /></label>
            <p className="hint" style={{ margin: 0 }}>{T('snapshotHint')}</p>
            {snap && <p data-testid="snapshot-stats" style={{ margin: 0 }}>{T('snapshotStats', { n: snap.entries, mb: (snap.bytes / 1048576).toFixed(1) })}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary">{T('saveSettings')}</button>
              <button type="button" className="btn" onClick={async () => { setErr(null); try { setSnap(await call('/api/admin/snapshots', 'DELETE')); setMsg(T('snapshotsCleared')); } catch (e) { setErr(e.message); } }}>{T('clearSnapshots')}</button>
            </div>
          </form>
          <form style={box} aria-labelledby="hx-h" data-testid="html-export-settings" onSubmit={(e) => { e.preventDefault(); save({ htmlExport: { html: form.htmlExport?.html || '', drillLinks: form.htmlExport?.drillLinks || '' } }); }}>
            <h2 id="hx-h" style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{T('hx_title')}</h2>
            <label className="field"><span>{T('hx_mode')}</span>
              <select className="select" data-testid="hx-mode" value={form.htmlExport?.html || ''} onChange={e => setForm({ ...form, htmlExport: { ...form.htmlExport, html: e.target.value } })}>
                <option value="">{T('hx_notSet')}</option>
                <option value="interactive">{T('hx_interactiveOpt')}</option>
                <option value="tables">{T('hx_tablesOpt')}</option>
                <option value="static">{T('hx_printOpt')}</option>
              </select></label>
            <label className="field"><span>{T('hx_drill')}</span>
              <select className="select" data-testid="hx-drill" value={form.htmlExport?.drillLinks || ''} onChange={e => setForm({ ...form, htmlExport: { ...form.htmlExport, drillLinks: e.target.value } })}>
                <option value="">{T('hx_notSet')}</option>
                <option value="inline">{T('hx_inline')}</option>
                <option value="new-tab">{T('hx_newTab')}</option>
                <option value="off">{T('hx_off')}</option>
              </select></label>
            <p className="hint" style={{ margin: 0 }}>{T('hx_hint')}</p>
            {data?.htmlExport && <p style={{ margin: 0 }} data-testid="hx-effective">{T('hx_effective', { html: data.htmlExport.html, drill: data.htmlExport.drillLinks })}</p>}
            <div><button className="btn primary">{T('saveSettings')}</button></div>
          </form>
          {data?.status && <StatusBox status={data.status} T={T} />}
        </div>
      )}
      {data?.settings?.updatedAt && <p className="hint" style={{ marginTop: 16 }}>{T('settingsChanged', { when: new Date(data.settings.updatedAt).toLocaleString(lang === 'en' ? 'en-IN' : lang), who: data.settings.updatedBy || '-' })}</p>}
    </>
  );
}
