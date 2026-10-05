import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import TwoFactorSettings from '@/home/TwoFactor.jsx';
import ThemeToggle from '@/theme/ThemeToggle.jsx';
import { accountsOn, currentUser } from '@/server/session.js';
import { t, dirOf, pickLang } from '@/i18n/index.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account · Pagewright' };

// Any signed-in user, for their own account (proxy.js lets viewers in; /api/account checks again).
export default async function AccountPage({ searchParams }) {
  const lang = pickLang((await searchParams)?.lang);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  if (!accountsOn()) redirect(`/${q}`);
  const user = await currentUser(new Request('http://pagewright.local/account', { headers: { cookie: (await headers()).get('cookie') || '' } }));
  if (!user) redirect('/login?next=%2Faccount');
  return (
    <div className="home-shell" dir={dirOf(lang)} lang={lang}>
      <header className="home-top">
        <Link href={`/${q}`} className="brand"><i />Pagewright</Link>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="hint">{user.email} · {user.role}</span><ThemeToggle /><Link className="btn sm" href={`/${q}`}>{t(lang, 'reports')}</Link></span>
      </header>
      <main className="home">
        <h1>{t(lang, 'accountTitle')}</h1>
        <TwoFactorSettings lang={lang} />
      </main>
    </div>
  );
}
