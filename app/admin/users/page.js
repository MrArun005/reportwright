import UsersAdmin from './UsersAdmin.jsx';

export const metadata = { title: 'Users · Pagewright' };

// Admins only (proxy.js). The list and every change go through /api/users, which checks again.
export default function UsersPage() {
  return (
    <main className="home" style={{ maxWidth: 'none' }}>
      <UsersAdmin />
    </main>
  );
}
