// GET /api/folders — the folders the caller may see (with its level on each) and its level at the top ("root").
// POST { name, parent? } — a new folder (manage on the parent, or at the top).
import { listReports } from '@/server/reports.js';
import { principalOf, visibleReports, visibleFolders, createFolder, folderParam, snapshot, folderLevel } from '@/server/perms.js';
import { audit } from '@/server/audit.js';
import { withLock } from '@/server/storage/index.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';
const fail = (e) => errorResponse(e);

export async function GET(req) {
  try {
    const p = await principalOf(req);
    const folders = await visibleFolders(p, await visibleReports(p, await listReports()));
    return Response.json({ root: { access: folderLevel(await snapshot(), p, null) }, folders });
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const p = await principalOf(req);
    const f = await withLock('acl', () => createFolder(p, { name: body.name, parent: folderParam(body.parent) }));
    await audit('folder.create', { req, principal: p, detail: { folder: f.id, name: f.name, parent: f.parent } });
    return Response.json(f, { status: 201 });
  } catch (e) { return fail(e); }
}
