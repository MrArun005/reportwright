'use client';
import { useEffect, useState } from 'react';
import { t } from '@/i18n/index.js';

/** Sign-in form. `next` is already checked on the server: a path on this site. */
export default function LoginForm({ next, lang }) {
  const T = (k, v) => t(lang, k, v);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState(null);

  useEffect(() => { fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)).then(setMe, () => {}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || T('signInFailed', { status: res.status }));
      window.location.assign(next);
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setMe(null);
  };

  if (me) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0 }}>{T('signedInAsLong')} <b>{me.email}</b> ({me.role}).</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn primary" href={next}>{T('continue')}</a>
          <button type="button" className="btn" onClick={signOut}>{T('signOut')}</button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }} aria-describedby={err ? 'login-error' : undefined}>
      <label className="field">
        <span>{T('email')}</span>
        <input className="input" type="email" name="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} style={{ height: 32 }} />
      </label>
      <label className="field">
        <span>{T('password')}</span>
        <input className="input" type="password" name="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} style={{ height: 32 }} />
      </label>
      {err && <p id="login-error" className="err" role="alert" style={{ margin: 0, fontSize: 13 }}>{err}</p>}
      <div><button className="btn primary" disabled={busy}>{busy ? T('signingIn') : T('signIn')}</button></div>
    </form>
  );
}
