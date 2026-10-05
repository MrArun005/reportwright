'use client';
import { useCallback, useEffect, useState } from 'react';
import { t } from '@/i18n/index.js';
import { signOutAndGo } from '@/home/Account.jsx';

const ROLES = ['viewer', 'designer', 'admin'];

async function call(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const one = (email) => `/api/users/${encodeURIComponent(email)}`;
const cell = { padding: '10px 16px', borderTop: '1px solid var(--line-2)', textAlign: 'left', verticalAlign: 'middle' };

export default function UsersAdmin({ lang }) {
  const T = (k, v) => t(lang, k, v);
  const q = lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : '';
  const [users, setUsers] = useState(null);
  const [me, setMe] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ email: '', role: 'viewer', password: '' });
  const [reset, setReset] = useState({ email: null, password: '' });

  const load = useCallback(async () => {
    try {
      const [list, who] = await Promise.all([call('/api/users'), call('/api/auth/me')]);
      setUsers(list); setMe(who);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Run a change, then show what happened and reload the list. */
  const act = async (fn, done) => {
    setErr(null); setMsg(null);
    try { await fn(); setMsg(done); await load(); return true; } catch (e) { setErr(e.message); return false; }
  };
  const add = async (e) => {
    e.preventDefault();
    if (await act(() => call('/api/users', 'POST', form), T('added', { email: form.email.trim().toLowerCase(), role: form.role }))) setForm({ email: '', role: 'viewer', password: '' });
  };
  const savePassword = async (e) => {
    e.preventDefault();
    if (await act(() => call(one(reset.email), 'PATCH', { password: reset.password }), T('passwordSet', { email: reset.email }))) setReset({ email: null, password: '' });
  };
  const remove = (u) => {
    if (window.confirm(T('confirmDelete', { email: u.email }))) act(() => call(one(u.email), 'DELETE'), T('deleted', { email: u.email }));
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ flex: 1 }}>{T('users')}</h1>
        {me && <span className="hint" style={{ fontSize: 13 }}>{T('signedInAs', { email: me.email, role: me.role })}</span>}
        <a className="btn" href={`/admin/audit${q}`}>{T('auditLog')}</a>
        <a className="btn" href={`/admin/settings${q}`}>{T('serverSettings')}</a>
        <a className="btn" href={`/${q}`}>{T('reports')}</a>
        <button type="button" className="btn" onClick={signOutAndGo}>{T('signOut')}</button>
      </div>
      <p className="lede">{T('rolesLede')}</p>

      <div aria-live="polite" style={{ minHeight: 22, marginBottom: 8 }}>
        {err && <p className="err" role="alert" style={{ margin: 0, fontSize: 13 }}>{err}</p>}
        {msg && <p style={{ margin: 0, color: 'var(--muted)' }}>{msg}</p>}
      </div>

      <form onSubmit={add} aria-label={T('addUserForm')} className="home-bar" style={{ alignItems: 'end' }}>
        <label className="field" style={{ minWidth: 240 }}>
          <span>{T('email')}</span>
          <input className="input" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="field">
          <span>{T('role')}</span>
          <select className="select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="field" style={{ minWidth: 220 }}>
          <span>{T('passwordMin')}</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        </label>
        <button className="btn primary">{T('addUser')}</button>
      </form>

      <div className="rlist">
        <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label={T('users')}>
          <thead>
            <tr>{[T('email'), T('role'), T('groups'), T('status'), T('twoFactorCol'), T('actions')].map(h => <th key={h} scope="col" style={{ ...cell, borderTop: 0, fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(users || []).map(u => (
              <tr key={u.email}>
                <td style={cell}><b>{u.email}</b>{me?.email === u.email && <span className="hint"> {T('you')}</span>}</td>
                <td style={cell}>
                  <select className="select" aria-label={T('roleOf', { email: u.email })} value={u.role} style={{ width: 'auto' }}
                    onChange={e => act(() => call(one(u.email), 'PATCH', { role: e.target.value }), T('nowRole', { email: u.email, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td style={cell}>
                  <form style={{ display: 'flex', gap: 6, alignItems: 'center' }} onSubmit={(e) => {
                    e.preventDefault();
                    const groups = String(new FormData(e.currentTarget).get('groups') || '').split(',').map(g => g.trim()).filter(Boolean);
                    act(() => call(one(u.email), 'PATCH', { groups }), T('groupsSaved', { email: u.email }));
                  }}>
                    <input className="input" name="groups" aria-label={T('groupsOf', { email: u.email })} defaultValue={(u.groups || []).join(', ')} key={(u.groups || []).join(',')} placeholder={T('groupsHint')} style={{ minWidth: 160 }} readOnly={!!u.sso} title={u.sso ? T('groupsFromSso') : undefined} />
                    {!u.sso && <button className="btn sm">{T('save')}</button>}
                  </form>
                </td>
                <td style={cell}>{u.disabled ? T('disabled') : T('active')}{u.sso && <span className="hint"> · {u.sso.toUpperCase()}</span>}</td>
                <td style={cell} data-testid={`tf-${u.email}`}>{u.password ? (u.twoFactor ? T('stateOn') : T('stateOff')) : <span className="hint">SSO</span>}</td>
                <td style={cell}>
                  {reset.email === u.email ? (
                    <form onSubmit={savePassword} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label className="field" style={{ minWidth: 200 }}>
                        <span>{T('newPasswordFor', { email: u.email })}</span>
                        <input className="input" type="password" autoComplete="new-password" required minLength={10} autoFocus value={reset.password} onChange={e => setReset({ ...reset, password: e.target.value })} />
                      </label>
                      <button className="btn sm primary">{T('savePassword')}</button>
                      <button type="button" className="btn sm" onClick={() => setReset({ email: null, password: '' })}>{T('cancel')}</button>
                    </form>
                  ) : (
                    <div className="acts" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn sm" onClick={() => setReset({ email: u.email, password: '' })}>{T('resetPassword')}</button>
                      <button type="button" className="btn sm" onClick={() => act(() => call(one(u.email), 'PATCH', { disabled: !u.disabled }), T(u.disabled ? 'isEnabled' : 'isDisabled', { email: u.email }))}>
                        {u.disabled ? T('enable') : T('disable')}
                      </button>
                      {u.twoFactor && <button type="button" className="btn sm" onClick={() => { if (window.confirm(T('confirmReset2fa', { email: u.email }))) act(() => call(one(u.email), 'PATCH', { resetTwoFactor: true }), T('twoFactorReset', { email: u.email })); }}>{T('reset2fa')}</button>}
                      {!u.sso && <button type="button" className="btn sm" title={T('allowSsoHint')} onClick={() => act(() => call(one(u.email), 'PATCH', { allowSso: !u.allowSso }), T(u.allowSso ? 'ssoNotAllowed' : 'ssoAllowed', { email: u.email }))}>{u.allowSso ? T('stopSso') : T('allowSso')}</button>}
                      <button type="button" className="btn sm danger" onClick={() => remove(u)} aria-label={T('deleteUser', { email: u.email })}>{T('delete')}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {users && !users.length && <tr><td style={cell} colSpan={6}><span className="hint">{T('noUsers')}</span></td></tr>}
            {!users && !err && <tr><td style={cell} colSpan={6}><span className="hint">{T('loading')}</span></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
