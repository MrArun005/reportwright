import { notFound } from 'next/navigation';
import { readReport, safeId } from '@/server/reports.js';
import Designer from '@/designer/Designer.jsx';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: `${id} · Designer · Pagewright` };
}

export default async function DesignerPage({ params, searchParams }) {
  const { id } = await params;
  const { lang } = await searchParams;
  let def;
  try { def = await readReport(safeId(id)); } catch { notFound(); }
  if (!def) notFound();
  return <Designer id={id} initial={def} lang={lang} />;
}
