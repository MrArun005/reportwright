import Link from 'next/link';
import { listReports } from '@/server/reports.js';
import { headers } from 'next/headers';
import NewReport from '@/home/NewReport.jsx';
import Account from '@/home/Account.jsx';
import { accountsOn, currentUser, ROLE_RANK } from '@/server/session.js';
import { principalFromCookie, visibleReports, visibleFolders, snapshot, folderLevel, atLeast } from '@/server/perms.js';
import { ShareButton, NewFolder } from '@/home/FolderActions.jsx';
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
  const sp = (await searchParams) || {};
  const lang = pickLang(sp.lang);
  const T = (k, v) => t(lang, k, v);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  const qa = lang === 'en' ? '' : `&lang=${encodeURIComponent(lang)}`;
  const count = (n, one, many) => (n === 1 ? T(one) : T(many, { n }));
  const cookie = (await headers()).get('cookie') || '';
  const p = await principalFromCookie(cookie);
  const all = await visibleReports(p, await listReports());
  const folders = await visibleFolders(p, all);
  const byId = new Map(folders.map(f => [f.id, f]));
  // ?folder= one folder (unknown or hidden: the top); ?q= searches every report the user may see
  const here = typeof sp.folder === 'string' && byId.has(sp.folder) ? sp.folder : null;
  const search = typeof sp.q === 'string' ? sp.q.trim().slice(0, 200) : '';
  const reports = search ? all.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.id.includes(search.toLowerCase())) : all.filter(r => r.folder === here);
  const sub = search ? [] : folders.filter(f => f.parent === here);
  const crumbs = [];
  for (let f = here, i = 0; f && i < 32; i++, f = byId.get(f)?.parent || null) if (byId.has(f)) crumbs.unshift(byId.get(f));
  // with accounts on, people do not see what they cannot use (creating, designing, sharing, deleting)
  const user = accountsOn() ? await currentUser(new Request('http://pagewright.local/', { headers: { cookie } })) : null;
  const designer = !accountsOn() || (ROLE_RANK[user?.role] || 0) >= ROLE_RANK.designer;
  const hereLevel = folderLevel(await snapshot(), p, here);
  const canCreate = designer && atLeast(hereLevel, 'edit');
  const canFolder = designer && atLeast(hereLevel, 'manage');
  const isAdmin = !accountsOn() || user?.role === 'admin';
  const shareProps = { folders, accounts: accountsOn(), lang };
  const link = (folder) => (folder ? `/?folder=${encodeURIComponent(folder)}${qa}` : `/${q}`);
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
          {canCreate && <NewReport lang={lang} folder={here} />}
        </section>

        <nav className="home-bar" aria-label={T('folders')} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <ol className="crumbs" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, listStyle: 'none', margin: 0, padding: 0, flex: 1, minWidth: 200 }}>
            <li><Link href={link(null)} aria-current={!here && !search ? 'page' : undefined}>{T('allReports')}</Link></li>
            {crumbs.map(f => <li key={f.id}><span aria-hidden="true">/ </span><Link href={link(f.id)} aria-current={f.id === here ? 'page' : undefined}>{f.name}</Link></li>)}
          </ol>
          <form action="/" method="get" role="search" style={{ display: 'flex', gap: 6 }}>
            {lang !== 'en' && <input type="hidden" name="lang" value={lang} />}
            <input className="input" type="search" name="q" defaultValue={search} placeholder={T('searchReports')} aria-label={T('searchReports')} style={{ width: 220 }} />
            <button className="btn">{T('search')}</button>
          </form>
          {canFolder && !search && <NewFolder parent={here} lang={lang} />}
          {here && byId.get(here)?.access === 'manage' && designer && <ShareButton {...shareProps} kind="folder" id={here} name={byId.get(here).name} canDelete label={T('folderAccess')} className="btn" />}
          {!here && !search && isAdmin && accountsOn() && <ShareButton {...shareProps} kind="root" id="root" name={T('allReports')} label={T('topAccess')} className="btn" />}
        </nav>

        {sub.length > 0 && (
          <ul className="fgrid" aria-label={T('folders')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, listStyle: 'none', padding: 0, margin: '0 0 14px' }}>
            {sub.map(f => (
              <li key={f.id} className="rcard" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }} data-folder={f.id}>
                <svg aria-hidden="true" width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ color: 'var(--accent)', flex: 'none' }}><path d="M1.5 3.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.6 1.8H15a1.5 1.5 0 0 1 1.5 1.5v7.7A1.5 1.5 0 0 1 15 14.5H3a1.5 1.5 0 0 1-1.5-1.5z" /></svg>
                <Link href={link(f.id)} style={{ flex: 1, fontWeight: 'var(--fw-strong)', color: 'var(--ink)', textDecoration: 'none' }}>{f.name}</Link>
              </li>
            ))}
          </ul>
        )}

        <div className="rgrid" data-testid="report-list">
          {reports.map(r => (
            <article className="rcard" key={r.id} data-report={r.id}>
              <Link href={`/viewer/${r.id}${q}`} className="rcard-thumb" tabIndex={-1} aria-hidden="true"><Thumb id={r.id} name={r.name} lang={lang} /></Link>
              <div className="rcard-body">
                <h2><Link href={designer && atLeast(r.access, 'edit') ? `/designer/${r.id}${q}` : `/viewer/${r.id}${q}`}>{r.name}</Link></h2>
                <p className="meta">{count(r.items, 'itemOne', 'itemMany')} · {count(r.parameters.length, 'paramOne', 'paramMany')}</p>
                <p className="meta" title={new Date(r.updatedAt).toLocaleString(lang === 'en' ? 'en-IN' : lang, { dateStyle: 'medium', timeStyle: 'short' })}>{T('savedAgo', { ago: ago(r.updatedAt, lang) })} · <code>{r.id}</code></p>
              </div>
              <div className="rcard-acts">
                {designer && atLeast(r.access, 'edit') && <Link className="btn sm primary" href={`/designer/${r.id}${q}`}>{T('design')}</Link>}
                <Link className={designer && atLeast(r.access, 'edit') ? 'btn sm' : 'btn sm primary'} href={`/viewer/${r.id}${q}`}>{T('view')}</Link>
                {designer && r.access === 'manage' && <ShareButton {...shareProps} kind="report" id={r.id} name={r.name} canDelete label={accountsOn() ? T('share') : T('move')} />}
                <a className="btn sm ghost" href={`/api/reports/${r.id}/pdf`} target="_blank" rel="noreferrer" title={T('serverPdfHint')}>{T('serverPdf')}</a>
              </div>
            </article>
          ))}
          {!reports.length && search && <div className="rempty"><b>{T('noReportMatches')}</b></div>}
          {!reports.length && !search && (here ? !sub.length && <div className="rempty"><b>{T('emptyFolder')}</b></div>
            : !sub.length && <div className="rempty"><b>{T('noReports')}</b><span className="hint">{canCreate ? T('noReportsDesigner') : T('noReportsViewer')}</span></div>)}
        </div>
      </main>
    </div>
  );
}
