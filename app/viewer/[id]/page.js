import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { safeId } from '@/server/reports.js';
import { principalFromCookie, readReportFor, checkReport, atLeast } from '@/server/perms.js';
import ViewerShell from '@/viewer/ViewerShell.jsx';
import { audit } from '@/server/audit.js';

export const dynamic = 'force-dynamic';

// View access; a report the user may not view is not found. "Edit in designer" shows only with edit access.
export default async function ViewerPage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const p = await principalFromCookie((await headers()).get('cookie'));
  let def, level;
  try { def = await readReportFor(p, safeId(id), 'view'); level = await checkReport(p, id, 'view'); } catch { notFound(); }
  const h = await headers();
  await audit('report.view', { req: new Request('http://pagewright.local/', { headers: { 'x-forwarded-for': h.get('x-forwarded-for') || '' } }), principal: p, report: id });
  return <ViewerShell id={id} def={def} params={sp} canEdit={atLeast(level, 'edit') && (p.kind !== 'user' || p.role !== 'viewer')} />;
}
