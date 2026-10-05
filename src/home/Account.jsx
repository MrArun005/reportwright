'use client';
import { t } from '@/i18n/index.js';
import { clearAllDrafts } from '@/designer/draft.js';

/** Sign out; after a single sign-on session the identity provider's logout page comes next (single logout). */
export async function signOutAndGo({ everywhere = false } = {}) {
  clearAllDrafts(); // no designer draft stays behind for the next person at this browser
  const r = await fetch('/api/auth/logout', { method: 'POST', ...(everywhere ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ everywhere: true }) } : {}) }).then(x => x.json()).catch(() => ({}));
  window.location.assign(r.redirect || '/login');
}

/** Who is signed in, their account page, admin pages for admins, and sign-out. Shown only when accounts are on. */
export default function Account({ email, role, lang }) {
  const q = lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : '';
  return (
    <div className="account" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <a className="hint" href={`/account${q}`} title={t(lang, 'accountTitle')}>{email} · {role}</a>
      {role === 'admin' && <a className="btn sm" href={`/admin/users${q}`}>{t(lang, 'users')}</a>}
      {role === 'admin' && <a className="btn sm" href={`/admin/audit${q}`}>{t(lang, 'auditLog')}</a>}
      {role === 'admin' && <a className="btn sm" href={`/admin/settings${q}`}>{t(lang, 'serverSettings')}</a>}
      {role !== 'viewer' && <a className="btn sm" href={`/schedules${q}`}>{t(lang, 'schedules')}</a>}
      <button type="button" className="btn sm" onClick={signOutAndGo}>{t(lang, 'signOut')}</button>
    </div>
  );
}
