import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { safeId } from '@/server/reports.js';
import { principalFromCookie, readReportFor, checkReport, revOfRead } from '@/server/perms.js';
import { audit } from '@/server/audit.js';
import Designer from '@/designer/Designer.jsx';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: `${id} · Designer · Pagewright` };
}

// Edit access. Someone who may only view the report goes to the viewer; someone who may not even view it gets 404.
export default async function DesignerPage({ params, searchParams }) {
  const { id } = await params;
  const { lang } = await searchParams;
  const p = await principalFromCookie((await headers()).get('cookie'));
  let level;
  try { level = await checkReport(p, safeId(id), 'view'); } catch { notFound(); }
  if (level === 'view') redirect(`/viewer/${id}${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`);
  let def;
  try { def = await readReportFor(p, id, 'edit'); } catch { notFound(); }
  const h = await headers();
  await audit('report.view', { req: new Request('http://pagewright.local/', { headers: { 'x-forwarded-for': h.get('x-forwarded-for') || '', 'x-pw-peer': h.get('x-pw-peer') || '' } }), principal: p, report: id, detail: { via: 'designer' } });
  // user: who keeps autosave drafts in this browser (hashed into the key; '' without accounts)
  // rev: the revision this designer edits from; a save sends it back (If-Match), so a newer save is never overwritten
  const rev = revOfRead(def); // of the text this page shows
  return <Designer id={id} initial={def} rev={rev} lang={lang} user={p?.kind === 'user' ? p.email : ''} />;
}
