'use client';
import { useEffect, useState } from 'react';
import { t } from '@/i18n/index.js';
import { QrCode, RecoveryCodes, CodeField, postJson } from '@/home/TwoFactor.jsx';

/** The second step of a password sign-in: a code (or a recovery code), or enrolling when the role requires it. */
function SecondFactor({ mode, lang, next, onRestart, emailed = false }) {
  const T = (k, v) => t(lang, k, v);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mailCode, setMailCode] = useState('');
  useEffect(() => {
    if (mode === 'enrol' && !emailed) postJson('/api/auth/mfa/setup').then(setSetup, (e) => setErr(e.message));
  }, [mode, emailed]);
  const fromMail = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { setSetup(await postJson('/api/auth/mfa/setup', { emailCode: mailCode })); } catch (ex) { setErr(ex.message); } finally { setBusy(false); } };
  if (mode === 'enrol' && emailed && !setup) return (
    <form onSubmit={fromMail} style={{ display: 'grid', gap: 12 }} aria-label={T('twoFactor')}>
      <p style={{ margin: 0 }}>{T('mustEnrol')} {T('enrolEmailed')}</p>
      <label className="field"><span>{T('emailCode')}</span><input className="input" inputMode="numeric" autoComplete="one-time-code" required autoFocus value={mailCode} onChange={e => setMailCode(e.target.value)} style={{ height: 32, fontFamily: 'var(--mono)' }} /></label>
      {err && <p className="err" role="alert" style={{ margin: 0, fontSize: 13 }}>{err}</p>}
      <div><button className="btn primary" disabled={busy}>{T('continue')}</button></div>
    </form>
  );
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const d = await postJson('/api/auth/mfa', recovery ? { recoveryCode: code } : { code });
      if (d.recoveryCodes) { setCodes(d.recoveryCodes); setBusy(false); return; }
      window.location.assign(next);
    } catch (ex) { setErr(ex.message); setBusy(false); if (ex.status === 401 && /again/.test(ex.message)) onRestart(); }
  };
  if (codes) return (<div style={{ display: 'grid', gap: 12 }}><RecoveryCodes codes={codes} lang={lang} /><div><a className="btn primary" href={next}>{T('continue')}</a></div></div>);
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }} aria-label={T('twoFactor')} aria-describedby={err ? 'mfa-error' : undefined}>
      <p style={{ margin: 0 }}>{mode === 'enrol' ? T('mustEnrol') : recovery ? T('enterRecovery') : T('enterCode')}</p>
      {mode === 'enrol' && setup && <QrCode setup={setup} lang={lang} />}
      {recovery
        ? <label className="field"><span>{T('recoveryCode')}</span><input className="input" required autoFocus autoComplete="off" value={code} onChange={e => setCode(e.target.value)} style={{ height: 32, fontFamily: 'var(--mono)' }} /></label>
        : <CodeField value={code} onChange={setCode} lang={lang} />}
      {err && <p id="mfa-error" className="err" role="alert" style={{ margin: 0, fontSize: 13 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={busy || (mode === 'enrol' && !setup)}>{busy ? T('verifying') : T('verify')}</button>
        {mode === 'totp' && <button type="button" className="btn" onClick={() => { setRecovery(!recovery); setCode(''); setErr(null); }}>{recovery ? T('useAuthCode') : T('useRecoveryCode')}</button>}
      </div>
    </form>
  );
}

/** Sign-in form. `next` is already checked on the server: a path on this site. */
export default function LoginForm({ next, lang, sso = {}, password: passwordOn = true, ssoError = null, resetByMail = false }) {
  const T = (k, v) => t(lang, k, v);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState(null);
  const [mfa, setMfa] = useState(null); // { mode: 'totp' | 'enrol', emailed } after a right password

  useEffect(() => { fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)).then(setMe, () => {}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || T('signInFailed', { status: res.status }));
      if (body.mfa) { setMfa({ mode: body.mfa, emailed: !!body.emailed }); setBusy(false); return; }
      window.location.assign(next);
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  const signOut = async () => {
    const r = await fetch('/api/auth/logout', { method: 'POST' }).then(x => x.json()).catch(() => ({}));
    if (r.redirect) { window.location.assign(r.redirect); return; } // single logout at the identity provider
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
  const n = encodeURIComponent(next);
  const ssoButtons = (sso.oidc || sso.saml) && (
    <div style={{ display: 'grid', gap: 8, marginBottom: passwordOn ? 18 : 0 }}>
      {ssoError && <p className="err" role="alert" style={{ margin: 0, fontSize: 13 }}>{T('ssoFailed')}</p>}
      {sso.oidc && <a className="btn primary" style={{ justifyContent: 'center', height: 34 }} href={`/api/auth/oidc/start?next=${n}`}>{T('signInWith', { name: sso.oidc })}</a>}
      {sso.saml && <a className="btn primary" style={{ justifyContent: 'center', height: 34 }} href={`/api/auth/saml/login?next=${n}`}>{T('signInWith', { name: sso.saml })}</a>}
      {passwordOn && <p className="hint" style={{ margin: '6px 0 0', textAlign: 'center' }}>{T('orWithPassword')}</p>}
    </div>
  );
  if (!passwordOn) return ssoButtons || <p className="vmsg">{T('noSignInMethod')}</p>;
  if (mfa) return <SecondFactor mode={mfa.mode} emailed={mfa.emailed} lang={lang} next={next} onRestart={() => { setMfa(null); setPassword(''); }} />;
  return (
    <>{ssoButtons}
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
      <div><button className={sso.oidc || sso.saml ? 'btn' : 'btn primary'} disabled={busy}>{busy ? T('signingIn') : T('signIn')}</button></div>
      {resetByMail ? <p style={{ margin: 0 }}><a href={`/login/reset${lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : ''}`}>{T('forgotPassword')}</a></p>
        : <p className="hint" style={{ margin: 0 }}>{T('noMailReset')}</p>}
    </form>
    </>
  );
}
