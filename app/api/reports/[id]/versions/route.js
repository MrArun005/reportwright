// GET: saved versions of a report. POST { version }: restore one (the current file becomes a version too). Edit access.
import { listVersions, readReport, writeReport, safeId } from '@/server/reports.js';
import { principalOf, checkReport } from '@/server/perms.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  try {
    const id = safeId((await params).id);
    await checkReport(await principalOf(req), id, 'edit');
    return Response.json(await listVersions(id));
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}

export async function POST(req, { params }) {
  try {
    const id = safeId((await params).id);
    const p = await principalOf(req);
    await checkReport(p, id, 'edit');
    const { version } = await req.json();
    const def = await readReport(`${id}@${version}`);
    if (!def) return Response.json({ error: 'Version not found' }, { status: 404 });
    await writeReport(id, def);
    await audit('report.restore', { req, principal: p, report: id, detail: { version: String(version) } });
    return Response.json(def);
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
