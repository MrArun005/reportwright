// GET /api/folders/<id> — a folder with its grants (manage access). "root": the top-level grants (admins).
// PATCH { name?, parent?, inherit?, grants? } — change it (manage). DELETE — an empty folder (manage).
import { principalOf, updateFolder, deleteFolder, folderParam, snapshot, folderLevel, atLeast } from '@/server/perms.js';
import { audit } from '@/server/audit.js';
import { withLock } from '@/server/storage/index.js';

export const runtime = 'nodejs';
const fail = (e) => Response.json({ error: e.message }, { status: e.status || 500 });
const idOf = async (params) => { const id = String((await params).id); return id === 'root' ? 'root' : folderParam(id); };

export async function GET(req, { params }) {
  try {
    const id = await idOf(params);
    const p = await principalOf(req);
    const s = await snapshot();
    if (id === 'root') {
      if (!(p.kind === 'open' || (p.kind === 'user' && p.role === 'admin'))) return Response.json({ error: 'Only an admin can see the top-level permissions.' }, { status: 403 });
      return Response.json({ id: 'root', grants: s.root, create: s.rootCreate || [], access: 'manage' });
    }
    const f = s.folders.get(id);
    const lvl = f ? folderLevel(s, p, id) : 'none';
    if (!f || !atLeast(lvl, 'view')) return Response.json({ error: 'No such folder.' }, { status: 404 });
    if (!atLeast(lvl, 'manage')) return Response.json({ error: 'You cannot see who has access to this folder.' }, { status: 403 });
    return Response.json({ id, name: f.name, parent: f.parent || null, inherit: f.inherit !== false, grants: f.grants || [], access: lvl });
  } catch (e) { return fail(e); }
}

export async function PATCH(req, { params }) {
  try {
    const id = await idOf(params);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return Response.json({ error: 'Send { name?, parent?, inherit?, grants?, create? } (create: the top only)' }, { status: 400 });
    const patch = {};
    for (const k of ['name', 'inherit', 'grants', 'create']) if (k in body) patch[k] = body[k];
    if ('parent' in body) patch.parent = folderParam(body.parent);
    const p = await principalOf(req);
    const { before, after } = await withLock('acl', () => updateFolder(p, id, patch));
    const pick = (f) => ({ name: f.name, parent: f.parent, inherit: f.inherit !== false, grants: f.grants, ...(f.create && { create: f.create }) });
    await audit(id === 'root' ? 'access.root' : 'access.folder', { req, principal: p, detail: { folder: id, before: pick(before), after: pick(after) } });
    return Response.json(after);
  } catch (e) { return fail(e); }
}

export async function DELETE(req, { params }) {
  try {
    const p = await principalOf(req);
    const fid = await idOf(params);
    const f = await withLock('acl', () => deleteFolder(p, fid));
    await audit('folder.delete', { req, principal: p, detail: { folder: f.id, name: f.name } });
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
