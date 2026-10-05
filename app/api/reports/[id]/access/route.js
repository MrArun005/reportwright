// GET /api/reports/<id>/access — its folder, inheritance and grants (manage access).
// PUT { folder?, inherit?, grants? } — move it, stop or start inheriting, share it (manage; moving needs edit in the folder).
import { safeId } from '@/server/reports.js';
import { principalOf, reportAccessInfo, setReportAccess, folderParam } from '@/server/perms.js';
import { audit } from '@/server/audit.js';
import { withLock } from '@/server/storage/index.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';
const fail = (e) => errorResponse(e);

export async function GET(req, { params }) {
  try { return Response.json(await reportAccessInfo(await principalOf(req), safeId((await params).id))); }
  catch (e) { return fail(e); }
}

export async function PUT(req, { params }) {
  try {
    const id = safeId((await params).id);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return Response.json({ error: 'Send { folder?, inherit?, grants? }' }, { status: 400 });
    const p = await principalOf(req);
    const patch = {};
    if ('folder' in body) patch.folder = folderParam(body.folder);
    if ('inherit' in body) patch.inherit = body.inherit;
    if ('grants' in body) patch.grants = body.grants;
    const { before, after } = await withLock('acl', () => setReportAccess(p, id, patch));
    await audit('access.report', { req, principal: p, report: id, detail: { before: { folder: before.folder, inherit: before.inherit !== false, grants: before.grants }, after: { folder: after.folder, inherit: after.inherit !== false, grants: after.grants } } });
    return Response.json(await reportAccessInfo(p, id));
  } catch (e) { return fail(e); }
}
