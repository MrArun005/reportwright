import Schedules from '@/home/Schedules.jsx';
import Shell from '@/home/Shell.jsx';
import { pickLang } from '@/i18n/index.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Schedules · Pagewright' };

// Designers and admins (proxy.js); /api/schedules checks again.
export default async function SchedulesPage({ searchParams }) {
  const lang = pickLang((await searchParams)?.lang);
  return (
    <Shell lang={lang} active="schedules">
      <main className="home"><Schedules lang={lang} cronOnly={process.env.PW_SCHEDULER === 'off' ? process.env.PW_CRON || '' : ''} /></main>
    </Shell>
  );
}
