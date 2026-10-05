import Link from 'next/link';
import Schedules from '@/home/Schedules.jsx';
import ThemeToggle from '@/theme/ThemeToggle.jsx';
import { t, dirOf, pickLang } from '@/i18n/index.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Schedules · Pagewright' };

// Designers and admins (proxy.js); /api/schedules checks again.
export default async function SchedulesPage({ searchParams }) {
  const lang = pickLang((await searchParams)?.lang);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  return (
    <div className="home-shell" dir={dirOf(lang)} lang={lang}>
      <header className="home-top">
        <Link href={`/${q}`} className="brand"><i />Pagewright</Link>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ThemeToggle /><Link className="btn sm" href={`/${q}`}>{t(lang, 'reports')}</Link></span>
      </header>
      <main className="home"><Schedules lang={lang} /></main>
    </div>
  );
}
