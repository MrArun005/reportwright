'use client';
import { useCallback, useEffect, useState } from 'react';

const ROLES = ['viewer', 'designer', 'admin'];

async function call(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const one = (email) => `/api/users/${encodeURIComponent(email)}`;
const cell = { padding: '10px 16px', borderTop: '1px solid var(--line-2)', textAlign: 'left', verticalAlign: 'middle' };

export default function UsersAdmin() {
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
    if (await act(() => call('/api/users', 'POST', form), `Added ${form.email.trim().toLowerCase()} as ${form.role}.`)) setForm({ email: '', role: 'viewer', password: '' });
  };
  const savePassword = async (e) => {
    e.preventDefault();
    if (await act(() => call(one(reset.email), 'PATCH', { password: reset.password }), `New password set for ${reset.email}. Their other sessions are signed out.`)) setReset({ email: null, password: '' });
  };
  const remove = (u) => {
    if (window.confirm(`Delete ${u.email}? They can no longer sign in.`)) act(() => call(one(u.email), 'DELETE'), `Deleted ${u.email}.`);
  };
  const signOut = async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.assign('/login'); };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ flex: 1 }}>Users</h1>
        {me && <span className="hint" style={{ fontSize: 13 }}>Signed in as {me.email} ({me.role})</span>}
        <a className="btn" href="/">Reports</a>
        <button type="button" className="btn" onClick={signOut}>Sign out</button>
      </div>
      <p className="lede">Viewers view and export reports. Designers also edit reports and preview SQL. Admins also manage users.</p>

      <div aria-live="polite" style={{ minHeight: 22, marginBottom: 8 }}>
        {err && <p className="err" role="alert" style={{ margin: 0, fontSize: 13 }}>{err}</p>}
        {msg && <p style={{ margin: 0, color: 'var(--muted)' }}>{msg}</p>}
      </div>

      <form onSubmit={add} aria-label="Add a user" className="home-bar" style={{ alignItems: 'end' }}>
        <label className="field" style={{ minWidth: 240 }}>
          <span>Email</span>
          <input className="input" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="field">
          <span>Role</span>
          <select className="select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="field" style={{ minWidth: 220 }}>
          <span>Password (at least 10 characters)</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        </label>
        <button className="btn primary">Add user</button>
      </form>

      <div className="rlist">
        <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Users">
          <thead>
            <tr>{['Email', 'Role', 'Status', 'Actions'].map(h => <th key={h} scope="col" style={{ ...cell, borderTop: 0, fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(users || []).map(u => (
              <tr key={u.email}>
                <td style={cell}><b>{u.email}</b>{me?.email === u.email && <span className="hint"> (you)</span>}</td>
                <td style={cell}>
                  <select className="select" aria-label={`Role of ${u.email}`} value={u.role} style={{ width: 'auto' }}
                    onChange={e => act(() => call(one(u.email), 'PATCH', { role: e.target.value }), `${u.email} is now ${e.target.value}.`)}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td style={cell}>{u.disabled ? 'Disabled' : 'Active'}</td>
                <td style={cell}>
                  {reset.email === u.email ? (
                    <form onSubmit={savePassword} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label className="field" style={{ minWidth: 200 }}>
                        <span>New password for {u.email}</span>
                        <input className="input" type="password" autoComplete="new-password" required minLength={10} autoFocus value={reset.password} onChange={e => setReset({ ...reset, password: e.target.value })} />
                      </label>
                      <button className="btn sm primary">Save password</button>
                      <button type="button" className="btn sm" onClick={() => setReset({ email: null, password: '' })}>Cancel</button>
                    </form>
                  ) : (
                    <div className="acts" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn sm" onClick={() => setReset({ email: u.email, password: '' })}>Reset password</button>
                      <button type="button" className="btn sm" onClick={() => act(() => call(one(u.email), 'PATCH', { disabled: !u.disabled }), `${u.email} is ${u.disabled ? 'enabled' : 'disabled'}.`)}>
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>
                      <button type="button" className="btn sm danger" onClick={() => remove(u)} aria-label={`Delete ${u.email}`}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {users && !users.length && <tr><td style={cell} colSpan={4}><span className="hint">No users.</span></td></tr>}
            {!users && !err && <tr><td style={cell} colSpan={4}><span className="hint">Loading…</span></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
