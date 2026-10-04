import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { safeId } from '@/server/reports.js';
import { principalFromCookie, readReportFor, checkReport } from '@/server/perms.js';
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
  return <Designer id={id} initial={def} lang={lang} />;
}
