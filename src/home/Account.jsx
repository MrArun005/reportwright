'use client';
import { t } from '@/i18n/index.js';
/** Who is signed in, a link to user admin for admins, and sign-out. Shown only when accounts are on. */
export default function Account({ email, role, lang }) {
  const signOut = async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.assign('/login'); };
  return (
    <div className="account" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
      <span className="hint">{email} · {role}</span>
      {role === 'admin' && <a className="btn sm" href={`/admin/users${lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : ''}`}>{t(lang, 'users')}</a>}
      {role === 'admin' && <a className="btn sm" href={`/admin/audit${lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : ''}`}>{t(lang, 'auditLog')}</a>}
      <button type="button" className="btn sm" onClick={signOut}>{t(lang, 'signOut')}</button>
    </div>
  );
}
