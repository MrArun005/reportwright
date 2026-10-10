import Link from 'next/link';
import NewReport from './NewReport.jsx';
import { ShareButton, NewFolder } from './FolderActions.jsx';
import Thumb, { ReportFonts } from './Thumb.jsx';
import ServerPdf from './ServerPdf.jsx';
import { accountsOn } from '@/server/session.js';
import { snapshot, folderLevel, atLeast, canCreateIn } from '@/server/perms.js';
import { t } from '@/i18n/index.js';

function ago(iso, lang) {
  const rtf = new Intl.RelativeTimeFormat(lang === 'en' ? 'en-IN' : lang, { numeric: 'auto' });
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, sec] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit);
  }
  return t(lang, 'justNow');
}

/**
 * The report library: folders, search, sharing, thumbnails. `all` and `folders` are what the principal may see.
 * @param {{ lang: string, sp: any, p: any, all: any[], folders: any[], designer: boolean, isAdmin: boolean, top: boolean }} props
 * top: the page's own heading (the Reports view), else a section under the Overview
 */
export default async function Library({ lang, sp, p, all, folders, designer, isAdmin, top }) {
  const T = (k, v) => t(lang, k, v);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  const qa = lang === 'en' ? '' : `&lang=${encodeURIComponent(lang)}`;
  const count = (n, one, many) => (n === 1 ? T(one) : T(many, { n }));
  const byId = new Map(folders.map(f => [f.id, f]));
  // ?folder= one folder (unknown or hidden: the top); ?q= searches every report the user may see
  const here = typeof sp.folder === 'string' && byId.has(sp.folder) ? sp.folder : null;
  const search = typeof sp.q === 'string' ? sp.q.trim().slice(0, 200) : '';
  const reports = search ? all.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.id.includes(search.toLowerCase())) : all.filter(r => r.folder === here);
  const sub = search ? [] : folders.filter(f => f.parent === here);
  const crumbs = [];
  for (let f = here, i = 0; f && i < 32; i++, f = byId.get(f)?.parent || null) if (byId.has(f)) crumbs.unshift(byId.get(f));
  // with accounts on, people do not see what they cannot use (creating, designing, sharing, deleting)
  const hereLevel = folderLevel(await snapshot(), p, here);
  const canCreate = designer && await canCreateIn(p, here).then(() => true, () => false); // the API's check: at the top, "create" counts too
  const canFolder = designer && atLeast(hereLevel, 'manage');
  const shareProps = { folders, accounts: accountsOn(), lang };
  const link = (folder) => (folder ? `/?folder=${encodeURIComponent(folder)}${qa}` : `/?view=reports${qa}`);
  const H = top ? 'h1' : 'h2', CH = top ? 'h2' : 'h3';
  return (
    <section className="library" id="reports" aria-labelledby="library-title">
      <ReportFonts />
      <div className="home-head" id="new-report">
        <div>
          <H id="library-title" className={top ? undefined : 'section-title'}>{T('reports')}</H>
          <p className="lede">{T('lede')}</p>
        </div>
        {canCreate && <NewReport lang={lang} folder={here} />}
      </div>

      <nav className="home-bar" aria-label={T('folders')}>
        <ol className="crumbs">
          <li><Link href={link(null)} aria-current={!here && !search ? 'page' : undefined}>{T('allReports')}</Link></li>
          {crumbs.map(f => <li key={f.id}><span aria-hidden="true">/ </span><Link href={link(f.id)} aria-current={f.id === here ? 'page' : undefined}>{f.name}</Link></li>)}
        </ol>
        <form action="/" method="get" role="search" className="lib-search">
          {lang !== 'en' && <input type="hidden" name="lang" value={lang} />}
          <input className="input" type="search" name="q" defaultValue={search} placeholder={T('searchReports')} aria-label={T('searchReports')} />
          <button className="btn">{T('search')}</button>
        </form>
        {canFolder && !search && <NewFolder parent={here} lang={lang} />}
        {here && byId.get(here)?.access === 'manage' && designer && <ShareButton {...shareProps} kind="folder" id={here} name={byId.get(here).name} canDelete label={T('folderAccess')} className="btn" />}
        {!here && !search && isAdmin && accountsOn() && <ShareButton {...shareProps} kind="root" id="root" name={T('allReports')} label={T('topAccess')} className="btn" />}
      </nav>

      {sub.length > 0 && (
        <ul className="fgrid" aria-label={T('folders')}>
          {sub.map(f => (
            <li key={f.id} className="rcard fcard" data-folder={f.id}>
              <svg aria-hidden="true" width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1.5 3.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.6 1.8H15a1.5 1.5 0 0 1 1.5 1.5v7.7A1.5 1.5 0 0 1 15 14.5H3a1.5 1.5 0 0 1-1.5-1.5z" /></svg>
              <Link href={link(f.id)}>{f.name}</Link>
            </li>
          ))}
        </ul>
      )}

      <div className="rgrid" data-testid="report-list">
        {reports.map(r => (
          <article className="rcard" key={r.id} data-report={r.id}>
            <Link href={`/viewer/${r.id}${q}`} className="rcard-thumb" tabIndex={-1} aria-hidden="true"><Thumb id={r.id} name={r.name} lang={lang} /></Link>
            <div className="rcard-body">
              <CH><Link href={designer && atLeast(r.access, 'edit') ? `/designer/${r.id}${q}` : `/viewer/${r.id}${q}`}>{r.name}</Link></CH>
              <p className="meta">{count(r.items, 'itemOne', 'itemMany')} · {count(r.parameters.length, 'paramOne', 'paramMany')}</p>
              <p className="meta" title={new Date(r.updatedAt).toLocaleString(lang === 'en' ? 'en-IN' : lang, { dateStyle: 'medium', timeStyle: 'short' })}>{T('savedAgo', { ago: ago(r.updatedAt, lang) })} · <code>{r.id}</code></p>
            </div>
            <div className="rcard-acts">
              {designer && atLeast(r.access, 'edit') && <Link className="btn sm primary" href={`/designer/${r.id}${q}`}>{T('design')}</Link>}
              <Link className={designer && atLeast(r.access, 'edit') ? 'btn sm' : 'btn sm primary'} href={`/viewer/${r.id}${q}`}>{T('view')}</Link>
              {designer && r.access === 'manage' && <ShareButton {...shareProps} kind="report" id={r.id} name={r.name} canDelete label={accountsOn() ? T('share') : T('move')} />}
              <ServerPdf id={r.id} title={T('serverPdfHint')}>{T('serverPdf')}</ServerPdf>
            </div>
          </article>
        ))}
        {!reports.length && search && <div className="rempty"><b>{T('noReportMatches')}</b></div>}
        {!reports.length && !search && (here ? !sub.length && <div className="rempty"><b>{T('emptyFolder')}</b></div>
          : !sub.length && <div className="rempty"><b>{T('noReports')}</b><span className="hint">{canCreate ? T('noReportsDesigner') : T('noReportsViewer')}</span></div>)}
      </div>
    </section>
  );
}
