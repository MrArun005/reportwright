import { readReport, writeReport, deleteReport, safeId } from '@/server/reports.js';
import { validate } from '@/engine/schema/validate.js';

export const runtime = 'nodejs';

const fail = (e) => Response.json({ error: e.message }, { status: e.status || 500 });

export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    const def = await readReport(safeId(id));
    return def ? Response.json(def) : Response.json({ error: 'Report not found' }, { status: 404 });
  } catch (e) { return fail(e); }
}

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const def = await req.json();
    const v = validate(def);
    // Save even with errors: the designer may hold work in progress.
    await writeReport(safeId(id), def);
    return Response.json({ ok: true, errors: v.errors, warnings: v.warnings });
  } catch (e) { return fail(e); }
}

export async function DELETE(_req, { params }) {
  try { const { id } = await params; await deleteReport(safeId(id)); return Response.json({ ok: true }); }
  catch (e) { return fail(e); }
}
