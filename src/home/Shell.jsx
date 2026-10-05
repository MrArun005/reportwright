import Link from 'next/link';
import { headers } from 'next/headers';
import ThemeToggle from '@/theme/ThemeToggle.jsx';
import UserMenu from './UserMenu.jsx';
import { accountsOn, currentUser, ROLE_RANK } from '@/server/session.js';
import { storageUse } from './overview.js';
import { t, dirOf } from '@/i18n/index.js';

/** Who is looking: the signed-in user (accounts on) and what their role may use. */
export async function viewer() {
  const cookie = (await headers()).get('cookie') || '';
  const user = accountsOn() ? await currentUser(new Request('http://pagewright.local/', { headers: { cookie } })) : null;
  return {
    cookie, user,
    designer: !accountsOn() || (ROLE_RANK[user?.role] || 0) >= ROLE_RANK.designer,
    isAdmin: !accountsOn() || user?.role === 'admin',
  };
}

const ICONS = {
  overview: 'M2 2h5v6H2zM9 2h5v3H9zM9 7h5v7H9zM2 10h5v4H2z',
  reports: 'M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13M6 8h5M6 10.5h5',
  schedules: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5',
  users: 'M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5M11 2.8a2.4 2.4 0 0 1 0 4.4M12.5 9.8c1.3.7 2 2.2 2 4.2',
  audit: 'M8 1.5l5.5 2v4c0 3.2-2.3 5.8-5.5 7-3.2-1.2-5.5-3.8-5.5-7v-4zM5.5 8l1.8 1.8L10.7 6.3',
  settings: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
};
export const Icon = ({ name, size = 16 }) => <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>;

export function fmtBytes(n, lang) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${new Intl.NumberFormat(lang === 'en' ? 'en-IN' : lang, { maximumFractionDigits: i ? 1 : 0 }).format(n)} ${u[i]}`;
}

/**
 * The console around a page: the sidebar (only what the role may use: pages that do not exist are not listed), the top
 * bar (search, theme, account). Admin pages, Schedules and the home page share it.
 * @param {{ lang: string, active: string, search?: string, children: any }} props
 */
export default async function Shell({ lang, active, search = '', children }) {
  const T = (k, v) => t(lang, k, v);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  const qa = lang === 'en' ? '' : `&lang=${encodeURIComponent(lang)}`;
  const { user, designer, isAdmin } = await viewer();
  const nav = [
    { id: 'overview', href: `/${q}`, label: T('hm_overview') },
    { id: 'reports', href: `/?view=reports${qa}`, label: T('reports') },
    designer && { id: 'schedules', href: `/schedules${q}`, label: T('schedules') },
    isAdmin && accountsOn() && { id: 'users', href: `/admin/users${q}`, label: T('users') },
    isAdmin && { id: 'audit', href: `/admin/audit${q}`, label: T('auditLog') },
    isAdmin && { id: 'settings', href: `/admin/settings${q}`, label: T('serverSettings') },
  ].filter(Boolean);
  const use = isAdmin ? await storageUse() : null;
  return (
    <div className="app" dir={dirOf(lang)} lang={lang}>
      <aside className="side">
        <Link href={`/${q}`} className="brand side-brand"><i />Pagewright</Link>
        <nav aria-label={T('hm_nav')} className="side-nav">
          {nav.map(n => <Link key={n.id} href={n.href} className="side-link" aria-current={n.id === active ? 'page' : undefined}><Icon name={n.id} />{n.label}</Link>)}
        </nav>
        {use && (
          <div className="side-card">
            <b>{T('hm_storage')}</b>
            <span className="side-big">{fmtBytes(use.bytes, lang)}</span>
            <span className="hint">{T('hm_storageUse', { size: fmtBytes(use.bytes, lang), n: use.files })}</span>
            <span className="hint">{T('hm_storageHint')} · {use.kind}</span>
          </div>
        )}
      </aside>
      <div className="app-main">
        <header className="topbar">
          <form action="/" method="get" role="search" className="top-search">
            {lang !== 'en' && <input type="hidden" name="lang" value={lang} />}
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.8" /><path d="M10.6 10.6L14 14" strokeLinecap="round" /></svg>
            <input type="search" name="q" defaultValue={search} placeholder={T('hm_searchPh')} aria-label={T('hm_searchAll')} />
          </form>
          <span className="top-acts">
            <ThemeToggle />
            {user && <UserMenu email={user.email} role={user.role} lang={lang} />}
          </span>
        </header>
        {children}
      </div>
    </div>
  );
}
