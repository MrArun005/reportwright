// DELETE /api/fonts/<id>: remove an uploaded font (designers). Reports that use it fall back to Inter.
import { deleteFont } from '@/server/fonts.js';
import { principalOf, canDesign } from '@/server/perms.js';

export const runtime = 'nodejs';

export async function DELETE(req, { params }) {
  if (!canDesign(await principalOf(req))) return Response.json({ error: 'Only designers can delete fonts.' }, { status: 403 });
  const { id } = await params;
  return (await deleteFont(id)) ? Response.json({ ok: true }) : Response.json({ error: 'Font not found' }, { status: 404 });
}
