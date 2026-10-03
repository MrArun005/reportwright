// GET: saved versions of a report. POST { version }: restore one (the current file becomes a version too).
import { listVersions, readReport, writeReport, safeId } from '@/server/reports.js';

export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  try { return Response.json(await listVersions(safeId((await params).id))); }
  catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}

export async function POST(req, { params }) {
  try {
    const id = safeId((await params).id);
    const { version } = await req.json();
    const def = await readReport(`${id}@${version}`);
    if (!def) return Response.json({ error: 'Version not found' }, { status: 404 });
    await writeReport(id, def);
    return Response.json(def);
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
