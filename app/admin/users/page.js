import UsersAdmin from './UsersAdmin.jsx';
import { dirOf, pickLang } from '@/i18n/index.js';
import Shell from '@/home/Shell.jsx';

export const metadata = { title: 'Users · Pagewright' };

// Admins only (proxy.js). The list and every change go through /api/users, which checks again.
export default async function UsersPage({ searchParams }) {
  const lang = pickLang((await searchParams)?.lang);
  return (
    <Shell lang={lang} active="users">
      <main className="home" style={{ maxWidth: 'none' }} dir={dirOf(lang)} lang={lang}>
        <UsersAdmin lang={lang} />
      </main>
    </Shell>
  );
}
