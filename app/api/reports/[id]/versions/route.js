// GET: saved versions of a report. POST { version }: restore one (the current file becomes a version too). Edit access.
import { listVersions, readReport, writeReport, safeId } from '@/server/reports.js';
import { principalOf, checkReport, stampDefinition } from '@/server/perms.js';
import { audit } from '@/server/audit.js';
import { withLock } from '@/server/storage/index.js';

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
    const { version } = await req.json();
    const def = await withLock('acl', async () => {
      await checkReport(p, id, 'edit');
      const d = await readReport(`${id}@${version}`);
      if (d) { await stampDefinition(p, id, d); await writeReport(id, d); } // whoever restores vouches for its SQL
      return d;
    });
    if (!def) return Response.json({ error: 'Version not found' }, { status: 404 });
    await audit('report.restore', { req, principal: p, report: id, detail: { version: String(version) } });
    return Response.json(def);
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
