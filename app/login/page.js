import { accountsOn, safeNext } from '@/server/session.js';
import { countUsers } from '@/server/users.js';
import LoginForm from './LoginForm.jsx';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · Pagewright' };

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const on = accountsOn();
  const noUsers = on && !(process.env.PW_ADMIN_EMAIL && process.env.PW_ADMIN_PASSWORD) && (await countUsers()) === 0;
  return (
    <main className="home" style={{ maxWidth: 440 }}>
      <h1>Sign in</h1>
      <p className="lede">Pagewright reports</p>
      {!on && <p className="vmsg">Accounts are off on this server. Set <code>PW_AUTH=users</code> to turn them on.</p>}
      {noUsers && (
        <div className="vmsg" role="note" style={{ margin: '0 0 18px' }}>
          <p style={{ marginTop: 0 }}><b>There are no users yet.</b> Create the first admin in one of two ways:</p>
          <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
            <li>set <code>PW_ADMIN_EMAIL</code> and <code>PW_ADMIN_PASSWORD</code> and restart the server, then sign in with them; or</li>
            <li>run <code>node scripts/user.mjs add you@example.com admin</code> in the app folder.</li>
          </ul>
        </div>
      )}
      {on && <LoginForm next={safeNext(sp.next)} />}
    </main>
  );
}
