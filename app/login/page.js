import { accountsOn, safeNext } from '@/server/session.js';
import { countUsers } from '@/server/users.js';
import LoginForm from './LoginForm.jsx';
import { ssoLabels, passwordLoginOn } from '@/server/sso.js';
import { mailOn } from '@/server/mail.js';
import { t, tParts, dirOf, pickLang } from '@/i18n/index.js';

/** A translated sentence with code elements where its {placeholders} are. */
const withCode = (lang, key, code) => tParts(lang, key).map((s, i) => (i % 2 ? <code key={i}>{code[s]}</code> : s));

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · ReportWright' };

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const lang = pickLang(sp.lang);
  const on = accountsOn();
  const noUsers = on && !(process.env.PW_ADMIN_EMAIL && process.env.PW_ADMIN_PASSWORD) && (await countUsers()) === 0;
  return (
    <main className="home" style={{ maxWidth: 440 }} dir={dirOf(lang)} lang={lang}>
      <h1>{t(lang, 'signIn')}</h1>
      <p className="lede">{t(lang, 'signInLede')}</p>
      {!on && <p className="vmsg">{withCode(lang, 'accountsOff', { setting: 'PW_AUTH=users' })}</p>}
      {noUsers && (
        <div className="vmsg" role="note" style={{ margin: '0 0 18px' }}>
          <p style={{ marginTop: 0 }}><b>{t(lang, 'noUsersYet')}</b> {t(lang, 'firstAdmin')}</p>
          <ul style={{ paddingInlineStart: 18, marginBottom: 0 }}>
            <li>{withCode(lang, 'firstAdminEnv', { email: 'PW_ADMIN_EMAIL', password: 'PW_ADMIN_PASSWORD' })}</li>
            <li>{withCode(lang, 'firstAdminCli', { command: 'node scripts/user.mjs add you@example.com admin' })}</li>
          </ul>
        </div>
      )}
      {on && <LoginForm next={safeNext(sp.next)} lang={lang} sso={ssoLabels()} password={passwordLoginOn()} ssoError={typeof sp.sso_error === 'string' ? sp.sso_error.slice(0, 40) : null} resetByMail={mailOn()} />}
    </main>
  );
}
