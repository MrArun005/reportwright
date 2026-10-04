import UsersAdmin from './UsersAdmin.jsx';
import { dirOf, pickLang } from '@/i18n/index.js';

export const metadata = { title: 'Users · Pagewright' };

// Admins only (proxy.js). The list and every change go through /api/users, which checks again.
export default async function UsersPage({ searchParams }) {
  const lang = pickLang((await searchParams)?.lang);
  return (
    <main className="home" style={{ maxWidth: 'none' }} dir={dirOf(lang)} lang={lang}>
      <UsersAdmin lang={lang} />
    </main>
  );
}
