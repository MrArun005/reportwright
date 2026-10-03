import Link from 'next/link';
import { listReports } from '@/server/reports.js';
import { headers } from 'next/headers';
import NewReport from '@/home/NewReport.jsx';
import Account from '@/home/Account.jsx';
import { accountsOn, currentUser, ROLE_RANK } from '@/server/session.js';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const reports = await listReports();
  // with accounts on, viewers do not see what they cannot use (creating and designing reports)
  const user = accountsOn() ? await currentUser(new Request('http://pagewright.local/', { headers: { cookie: (await headers()).get('cookie') || '' } })) : null;
  const canDesign = !accountsOn() || (ROLE_RANK[user?.role] || 0) >= ROLE_RANK.designer;
  return (
    <main className="home">
      {user && <Account email={user.email} role={user.role} />}
      <h1>Pagewright</h1>
      <p className="lede">Design a report, bind it to data, and get the same pages on screen and in the PDF.</p>
      {canDesign && <div className="home-bar"><NewReport /></div>}
      <div className="rlist" data-testid="report-list">
        {reports.map(r => (
          <div className="rrow" key={r.id}>
            <div>
              <Link href={canDesign ? `/designer/${r.id}` : `/viewer/${r.id}`}><b>{r.name}</b></Link>
              <div className="meta">{r.id}.pw.json · {r.items} items · saved {new Date(r.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            </div>
            <div className="acts">
              {canDesign && <Link className="btn sm" href={`/designer/${r.id}`}>Design</Link>}
              <Link className="btn sm" href={`/viewer/${r.id}`}>View</Link>
              <a className="btn sm" href={`/api/reports/${r.id}/pdf`} target="_blank" rel="noreferrer" title="Rendered on the server">Server PDF</a>
            </div>
          </div>
        ))}
        {!reports.length && <div className="rrow"><span className="hint">{canDesign ? 'No reports yet. Create one above.' : 'No reports yet.'}</span></div>}
      </div>
    </main>
  );
}
