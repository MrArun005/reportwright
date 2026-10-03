import Link from 'next/link';
import { listReports } from '@/server/reports.js';
import NewReport from '@/home/NewReport.jsx';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const reports = await listReports();
  return (
    <main className="home">
      <h1>Pagewright</h1>
      <p className="lede">Design a report, bind it to data, and get the same pages on screen and in the PDF.</p>
      <div className="home-bar"><NewReport /></div>
      <div className="rlist" data-testid="report-list">
        {reports.map(r => (
          <div className="rrow" key={r.id}>
            <div>
              <Link href={`/designer/${r.id}`}><b>{r.name}</b></Link>
              <div className="meta">{r.id}.pw.json · {r.items} items · saved {new Date(r.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            </div>
            <div className="acts">
              <Link className="btn sm" href={`/designer/${r.id}`}>Design</Link>
              <Link className="btn sm" href={`/viewer/${r.id}`}>View</Link>
              <a className="btn sm" href={`/api/reports/${r.id}/pdf`} target="_blank" rel="noreferrer" title="Rendered on the server">Server PDF</a>
            </div>
          </div>
        ))}
        {!reports.length && <div className="rrow"><span className="hint">No reports yet. Create one above.</span></div>}
      </div>
    </main>
  );
}
