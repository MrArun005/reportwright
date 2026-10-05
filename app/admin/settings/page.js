import SettingsAdmin from './SettingsAdmin.jsx';
import { dirOf, pickLang } from '@/i18n/index.js';

export const metadata = { title: 'Settings · Pagewright' };
export const dynamic = 'force-dynamic';

// Admins only (proxy.js). Everything goes through /api/admin/settings, which checks again.
export default async function SettingsPage({ searchParams }) {
  const lang = pickLang((await searchParams)?.lang);
  return (
    <main className="home" dir={dirOf(lang)} lang={lang}>
      <SettingsAdmin lang={lang} />
    </main>
  );
}
