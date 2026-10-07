import { accountsOn } from '@/server/session.js';
import { mailOn } from '@/server/mail.js';
import ResetForm from './ResetForm.jsx';
import { t, dirOf, pickLang } from '@/i18n/index.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reset password · ReportWright', referrer: 'no-referrer' };

// Open (proxy.js): ?token= sets a new password; without it, asks for the link by email.
export default async function ResetPage({ searchParams }) {
  const sp = await searchParams;
  const lang = pickLang(sp.lang);
  const token = typeof sp.token === 'string' ? sp.token.slice(0, 400) : null;
  return (
    <main className="home" style={{ maxWidth: 520 }} dir={dirOf(lang)} lang={lang}>
      <h1>{t(lang, 'resetTitle')}</h1>
      {!accountsOn() || (!token && !mailOn())
        ? <p className="vmsg" style={{ margin: '12px 0' }}>{t(lang, 'resetNoMail')}</p>
        : <ResetForm lang={lang} token={token} />}
      <p><a href={`/login${lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`}`}>{t(lang, 'backToSignIn')}</a></p>
    </main>
  );
}
