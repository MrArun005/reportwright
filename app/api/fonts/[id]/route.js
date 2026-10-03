// DELETE /api/fonts/<id>: remove an uploaded font (designers). Reports that use it fall back to Inter.
import { deleteFont } from '@/server/fonts.js';

export const runtime = 'nodejs';

export async function DELETE(_req, { params }) {
  const { id } = await params;
  return (await deleteFont(id)) ? Response.json({ ok: true }) : Response.json({ error: 'Font not found' }, { status: 404 });
}
