'use client';
import { useCallback, useEffect, useState } from 'react';
import { t } from '@/i18n/index.js';

/** POST JSON, the answer's JSON or an Error with the server's message. */
export async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}
const svgSrc = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The QR code and the key to type, for a setup answer { secret, qr }. */
export function QrCode({ setup, lang }) {
  const T = (k, v) => t(lang, k, v);
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <img src={svgSrc(setup.qr)} alt={T('qrAlt')} width={180} height={180} style={{ background: 'var(--paper)', borderRadius: 6, border: '1px solid var(--line)' }} />
      <div style={{ display: 'grid', gap: 6, minWidth: 240, flex: 1 }}>
        <p style={{ margin: 0 }}>{T('scanQr')}</p>
        <p className="hint" style={{ margin: 0 }}>{T('cantScan')}</p>
        <code data-testid="totp-secret" style={{ fontFamily: 'var(--mono)', overflowWrap: 'anywhere', userSelect: 'all' }}>{setup.secret.match(/.{1,4}/g).join(' ')}</code>
      </div>
    </div>
  );
}

/** Recovery codes, shown once. */
export function RecoveryCodes({ codes, lang }) {
  const T = (k, v) => t(lang, k, v);
  return (
    <div role="region" aria-label={T('recoveryCodesTitle')} className="vmsg" style={{ margin: '12px 0', maxWidth: 'none' }}>
      <b>{T('recoveryCodesTitle')}</b>
      <p className="hint" style={{ margin: '4px 0 10px' }}>{T('recoveryCodesHint')}</p>
      <ul data-testid="recovery-codes" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6, listStyle: 'none', padding: 0, margin: 0, fontFamily: 'var(--mono)' }}>
        {codes.map(c => <li key={c}>{c}</li>)}
      </ul>
    </div>
  );
}

/** A 6-digit code field (one-time-code autofill on phones). */
export function CodeField({ value, onChange, lang, label, autoFocus = true }) {
  return (
    <label className="field" style={{ minWidth: 200 }}>
      <span>{label || t(lang, 'authCode')}</span>
      <input className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus={autoFocus}
        value={value} onChange={e => onChange(e.target.value)} style={{ height: 32, fontFamily: 'var(--mono)', letterSpacing: '.15em' }} />
    </label>
  );
}

/** The account page's two-factor section: status, enrol, new recovery codes, turn off. */
export default function TwoFactorSettings({ lang }) {
  const T = (k, v) => t(lang, k, v);
  const [acc, setAcc] = useState(null);
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState(null); // 'recovery' | 'disable' while asking for a code
  const [asking, setAsking] = useState(false); // the password, before a new secret
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch('/api/account'); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); setAcc(d); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => { setBusy(true); setErr(null); setMsg(null); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const start = (e) => { e.preventDefault(); run(async () => { setCodes(null); setSetup(await postJson('/api/account/2fa', { action: 'setup', password: pw })); setPw(''); setAsking(false); setCode(''); }); };
  const enable = (e) => { e.preventDefault(); run(async () => { const d = await postJson('/api/account/2fa', { action: 'enable', code }); setSetup(null); setCodes(d.recoveryCodes); setCode(''); setMsg(T('twoFactorTurnedOn')); await load(); }); };
  const withCode = (e) => {
    e.preventDefault();
    run(async () => {
      const recovery = /[a-z]/i.test(code);
      const d = await postJson('/api/account/2fa', { action: mode, ...(recovery ? { recoveryCode: code } : { code }) });
      setCode(''); setMode(null);
      if (d.recoveryCodes) setCodes(d.recoveryCodes); else { setCodes(null); setMsg(T('twoFactorTurnedOff')); }
      await load();
    });
  };

  if (!acc) return err ? <p className="err" role="alert">{err}</p> : <p className="hint">{T('loading')}</p>;
  const tf = acc.twoFactor;
  return (
    <section aria-labelledby="tf-h" style={{ display: 'grid', gap: 12 }}>
      <h2 id="tf-h" style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{T('twoFactor')}</h2>
      <p className="lede" style={{ maxWidth: 'none' }}>{acc.password ? T('twoFactorLede') : T('twoFactorSso')}</p>
      {acc.password && (
        <p style={{ margin: 0 }} data-testid="tf-status">
          <b>{tf.enabled ? T('stateOn') : T('stateOff')}</b>
          {tf.enabled && tf.enabledAt && <span className="hint"> · {T('twoFactorSince', { date: new Date(tf.enabledAt).toLocaleDateString(lang === 'en' ? 'en-IN' : lang, { dateStyle: 'medium' }) })}</span>}
          {tf.required && <span className="hint"> · {T('twoFactorRequired')}</span>}
          {tf.enabled && <span className="hint"> · {T('recoveryLeft', { n: tf.recoveryLeft })}</span>}
        </p>
      )}
      <div aria-live="polite">
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
        {msg && <p role="status" style={{ margin: 0, color: 'var(--muted)' }}>{msg}</p>}
      </div>
      {codes && <RecoveryCodes codes={codes} lang={lang} />}
      {acc.password && !tf.enabled && !setup && !asking && <div><button type="button" className="btn primary" onClick={() => setAsking(true)} disabled={busy}>{T('turnOn2fa')}</button></div>}
      {asking && !setup && (
        <form onSubmit={start} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }} aria-label={T('turnOn2fa')}>
          <label className="field" style={{ minWidth: 260 }}><span>{T('passwordToConfirm')}</span>
            <input className="input" type="password" autoComplete="current-password" required autoFocus value={pw} onChange={e => setPw(e.target.value)} style={{ height: 32 }} />
          </label>
          <button className="btn primary" disabled={busy}>{T('continue')}</button>
          <button type="button" className="btn" onClick={() => { setAsking(false); setPw(''); }}>{T('cancel')}</button>
        </form>
      )}
      {setup && (
        <form onSubmit={enable} style={{ display: 'grid', gap: 12 }} aria-label={T('turnOn2fa')}>
          <QrCode setup={setup} lang={lang} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <CodeField value={code} onChange={setCode} lang={lang} />
            <button className="btn primary" disabled={busy}>{T('confirmCode')}</button>
            <button type="button" className="btn" onClick={() => setSetup(null)}>{T('cancel')}</button>
          </div>
        </form>
      )}
      {tf.enabled && !mode && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => { setMode('recovery'); setCode(''); }}>{T('newRecoveryCodes')}</button>
          {!tf.required && <button type="button" className="btn danger" onClick={() => { setMode('disable'); setCode(''); }}>{T('turnOff2fa')}</button>}
        </div>
      )}
      {mode && (
        <form onSubmit={withCode} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }} aria-label={mode === 'disable' ? T('turnOff2fa') : T('newRecoveryCodes')}>
          <label className="field" style={{ minWidth: 260 }}>
            <span>{T('codeToConfirm')}</span>
            <input className="input" autoComplete="one-time-code" required autoFocus value={code} onChange={e => setCode(e.target.value)} style={{ height: 32, fontFamily: 'var(--mono)' }} />
          </label>
          <button className={mode === 'disable' ? 'btn danger' : 'btn primary'} disabled={busy}>{mode === 'disable' ? T('turnOff2fa') : T('newRecoveryCodes')}</button>
          <button type="button" className="btn" onClick={() => setMode(null)}>{T('cancel')}</button>
        </form>
      )}
    </section>
  );
}
