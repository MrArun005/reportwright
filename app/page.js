import Link from 'next/link';
import { listReports } from '@/server/reports.js';
import { headers } from 'next/headers';
import NewReport from '@/home/NewReport.jsx';
import Account from '@/home/Account.jsx';
import { accountsOn, currentUser, ROLE_RANK } from '@/server/session.js';
import Thumb, { ReportFonts } from '@/home/Thumb.jsx';
import ThemeToggle from '@/theme/ThemeToggle.jsx';
import { t, dirOf, pickLang } from '@/i18n/index.js';

export const dynamic = 'force-dynamic';

function ago(iso, lang) {
  const rtf = new Intl.RelativeTimeFormat(lang === 'en' ? 'en-IN' : lang, { numeric: 'auto' });
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, sec] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit);
  }
  return t(lang, 'justNow');
}

export default async function Home({ searchParams }) {
  const lang = pickLang((await searchParams)?.lang);
  const T = (k, v) => t(lang, k, v);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  const count = (n, one, many) => (n === 1 ? T(one) : T(many, { n }));
  const reports = await listReports();
  // with accounts on, viewers do not see what they cannot use (creating and designing reports)
  const user = accountsOn() ? await currentUser(new Request('http://pagewright.local/', { headers: { cookie: (await headers()).get('cookie') || '' } })) : null;
  const canDesign = !accountsOn() || (ROLE_RANK[user?.role] || 0) >= ROLE_RANK.designer;
  return (
    <div className="home-shell" dir={dirOf(lang)} lang={lang}>
      <ReportFonts />
      <header className="home-top">
        <Link href={`/${q}`} className="brand"><i />Pagewright</Link>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="hint">{T('tagline')}</span><ThemeToggle />{user && <Account email={user.email} role={user.role} lang={lang} />}</span>
      </header>
      <main className="home">
        <section className="home-head">
          <div>
            <h1>{T('reports')}</h1>
            <p className="lede">{T('lede')}</p>
          </div>
          {canDesign && <NewReport lang={lang} />}
        </section>

        <div className="rgrid" data-testid="report-list">
          {reports.map(r => (
            <article className="rcard" key={r.id} data-report={r.id}>
              <Link href={`/viewer/${r.id}${q}`} className="rcard-thumb" tabIndex={-1} aria-hidden="true"><Thumb id={r.id} name={r.name} lang={lang} /></Link>
              <div className="rcard-body">
                <h2><Link href={canDesign ? `/designer/${r.id}${q}` : `/viewer/${r.id}${q}`}>{r.name}</Link></h2>
                <p className="meta">{count(r.items, 'itemOne', 'itemMany')} · {count(r.parameters.length, 'paramOne', 'paramMany')}</p>
                <p className="meta" title={new Date(r.updatedAt).toLocaleString(lang === 'en' ? 'en-IN' : lang, { dateStyle: 'medium', timeStyle: 'short' })}>{T('savedAgo', { ago: ago(r.updatedAt, lang) })} · <code>{r.id}</code></p>
              </div>
              <div className="rcard-acts">
                {canDesign && <Link className="btn sm primary" href={`/designer/${r.id}${q}`}>{T('design')}</Link>}
                <Link className={canDesign ? 'btn sm' : 'btn sm primary'} href={`/viewer/${r.id}${q}`}>{T('view')}</Link>
                <a className="btn sm ghost" href={`/api/reports/${r.id}/pdf`} target="_blank" rel="noreferrer" title={T('serverPdfHint')}>{T('serverPdf')}</a>
              </div>
            </article>
          ))}
          {!reports.length && <div className="rempty"><b>{T('noReports')}</b><span className="hint">{canDesign ? T('noReportsDesigner') : T('noReportsViewer')}</span></div>}
        </div>
      </main>
    </div>
  );
}
