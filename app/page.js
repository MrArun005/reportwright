import { listReports } from '@/server/reports.js';
import { principalFromCookie, visibleReports, visibleFolders, canCreateIn } from '@/server/perms.js';
import Shell, { viewer } from '@/home/Shell.jsx';
import Overview from '@/home/Overview.jsx';
import Library from '@/home/Library.jsx';
import { pickLang } from '@/i18n/index.js';

export const dynamic = 'force-dynamic';

// The home page: the Overview with the report library under it. ?view=reports, ?folder= or ?q= show the library alone
// (the sidebar's Reports). Role gating: Library and Overview hide what the role cannot use; the APIs check again.
export default async function Home({ searchParams }) {
  const sp = (await searchParams) || {};
  const lang = pickLang(sp.lang);
  const { cookie, designer, isAdmin } = await viewer();
  const p = await principalFromCookie(cookie);
  const all = await visibleReports(p, await listReports());
  const folders = await visibleFolders(p, all);
  const libraryOnly = sp.view === 'reports' || typeof sp.folder === 'string' || typeof sp.q === 'string';
  const canCreate = designer && await canCreateIn(p, null).then(() => true, () => false); // the API's check: at the top, "create" counts too
  return (
    <Shell lang={lang} active={libraryOnly ? 'reports' : 'overview'} search={typeof sp.q === 'string' ? sp.q : ''}>
      <main className="home">
        {!libraryOnly && <Overview lang={lang} sp={sp} p={p} isAdmin={isAdmin} designer={designer} canCreate={canCreate} reports={new Map(all.map(r => [r.id, r]))} />}
        <Library lang={lang} sp={sp} p={p} all={all} folders={folders} designer={designer} isAdmin={isAdmin} top={libraryOnly} />
      </main>
    </Shell>
  );
}
