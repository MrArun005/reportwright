'use client';
import { signOutAndGo } from './Account.jsx';
import { t } from '@/i18n/index.js';

/** The avatar, name and role in the top bar; its menu has the account page and sign-out. */
export default function UserMenu({ email, role, lang }) {
  const q = lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : '';
  const name = email.split('@')[0].replace(/[._-]+/g, ' ');
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  return (
    <details className="umenu">
      <summary aria-label={t(lang, 'hm_menu')}>
        <span className="avatar" aria-hidden="true">{initials}</span>
        <span className="uwho"><b>{name}</b><span>{role}</span></span>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </summary>
      <div className="menu" role="menu">
        <span className="hint menu-email">{email}</span>
        <a role="menuitem" href={`/account${q}`}>{t(lang, 'accountTitle')}</a>
        <button role="menuitem" type="button" onClick={() => signOutAndGo()}>{t(lang, 'signOut')}</button>
      </div>
    </details>
  );
}
