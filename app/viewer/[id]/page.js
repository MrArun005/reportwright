import { notFound } from 'next/navigation';
import { readReport, safeId } from '@/server/reports.js';
import ViewerShell from '@/viewer/ViewerShell.jsx';

export const dynamic = 'force-dynamic';

export default async function ViewerPage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  let def;
  try { def = await readReport(safeId(id)); } catch { notFound(); }
  if (!def) notFound();
  return <ViewerShell id={id} def={def} params={sp} />;
}
