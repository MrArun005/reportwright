import Link from 'next/link';
import { listReports } from '@/server/reports.js';
import { headers } from 'next/headers';
import NewReport from '@/home/NewReport.jsx';
import Account from '@/home/Account.jsx';
import { accountsOn, currentUser, ROLE_RANK } from '@/server/session.js';
import Thumb, { ReportFonts } from '@/home/Thumb.jsx';
import ThemeToggle from '@/theme/ThemeToggle.jsx';

export const dynamic = 'force-dynamic';

const rtf = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
function ago(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, sec] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit);
  }
  return 'just now';
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function Home() {
  const reports = await listReports();
  // with accounts on, viewers do not see what they cannot use (creating and designing reports)
  const user = accountsOn() ? await currentUser(new Request('http://pagewright.local/', { headers: { cookie: (await headers()).get('cookie') || '' } })) : null;
  const canDesign = !accountsOn() || (ROLE_RANK[user?.role] || 0) >= ROLE_RANK.designer;
  return (
    <div className="home-shell">
      <ReportFonts />
      <header className="home-top">
        <Link href="/" className="brand"><i />Pagewright</Link>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="hint">Designer · Viewer · Automation API</span><ThemeToggle />{user && <Account email={user.email} role={user.role} />}</span>
      </header>
      <main className="home">
        <section className="home-head">
          <div>
            <h1>Reports</h1>
            <p className="lede">Design a report, bind it to data, and get the same pages on screen and in the PDF.</p>
          </div>
          {canDesign && <NewReport />}
        </section>

        <div className="rgrid" data-testid="report-list">
          {reports.map(r => (
            <article className="rcard" key={r.id} data-report={r.id}>
              <Link href={`/viewer/${r.id}`} className="rcard-thumb" tabIndex={-1} aria-hidden="true"><Thumb id={r.id} name={r.name} /></Link>
              <div className="rcard-body">
                <h2><Link href={canDesign ? `/designer/${r.id}` : `/viewer/${r.id}`}>{r.name}</Link></h2>
                <p className="meta">{plural(r.items, 'item')} · {plural(r.parameters.length, 'parameter')}</p>
                <p className="meta" title={new Date(r.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}>Saved {ago(r.updatedAt)} · <code>{r.id}</code></p>
              </div>
              <div className="rcard-acts">
                {canDesign && <Link className="btn sm primary" href={`/designer/${r.id}`}>Design</Link>}
                <Link className={canDesign ? 'btn sm' : 'btn sm primary'} href={`/viewer/${r.id}`}>View</Link>
                <a className="btn sm ghost" href={`/api/reports/${r.id}/pdf`} target="_blank" rel="noreferrer" title="Rendered on the server">Server PDF ↗</a>
              </div>
            </article>
          ))}
          {!reports.length && <div className="rempty"><b>No reports yet.</b><span className="hint">{canDesign ? 'Name your first report above and press New report.' : 'Reports appear here when a designer saves one.'}</span></div>}
        </div>
      </main>
    </div>
  );
}
