// POST /api/audit/checkpoint — write a signed checkpoint now (they are also written every PW_AUDIT_CHECKPOINT_MINUTES).
// Admins only.
import { requireRole } from '@/server/access.js';
import { checkpoint } from '@/server/audit.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const { user: me, res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const e = await checkpoint({ actor: `user:${me.email}` });
    return Response.json(e ? { id: e.id, at: e.at, streams: Object.keys(e.detail.heads).length } : { id: null });
  } catch (e) { return errorResponse(e); }
}
