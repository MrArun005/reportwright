'use client';
import { useState } from 'react';
import { t } from '@/i18n/index.js';
import { postJson } from '@/home/TwoFactor.jsx';

/** Ask for a reset link (no token), or set the new password (token from the link). */
export default function ResetForm({ lang, token }) {
  const T = (k, v) => t(lang, k, v);
  const [value, setValue] = useState('');
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (token) { await postJson('/api/auth/reset/confirm', { token, password: value }); setDone(T('passwordChanged')); }
      else { await postJson('/api/auth/reset/request', { email: value }); setDone(T('resetSent', { email: value.trim() })); }
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  if (done) return <p role="status" className="vmsg" style={{ margin: '12px 0' }}>{done}</p>;
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }} aria-describedby={err ? 'reset-error' : undefined}>
      {!token && <p className="lede">{T('resetLede')}</p>}
      <label className="field">
        <span>{token ? T('newPassword') : T('email')}</span>
        <input className="input" required autoFocus type={token ? 'password' : 'email'} autoComplete={token ? 'new-password' : 'username'} minLength={token ? 10 : undefined}
          value={value} onChange={e => setValue(e.target.value)} style={{ height: 32 }} />
      </label>
      {err && <p id="reset-error" className="err" role="alert" style={{ margin: 0, fontSize: 13 }}>{err}</p>}
      <div><button className="btn primary" disabled={busy}>{token ? T('setNewPassword') : T('sendResetLink')}</button></div>
    </form>
  );
}
