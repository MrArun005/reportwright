// GET: the definition (view). PUT: save (edit; a new id is a new report, as POST /api/reports). DELETE: manage.
// A report the caller may not view is "not found" whatever the method.
import { readReport, writeReport, deleteReport, safeId, readDefinition } from '@/server/reports.js';
import { validate } from '@/engine/schema/validate.js';
import { principalOf, readReportFor, checkReport, canCreateIn, recordNewReport, forgetReport } from '@/server/perms.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

const fail = (e) => Response.json({ error: e.message }, { status: e.status || 500 });

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    return Response.json(await readReportFor(await principalOf(req), safeId(id), 'view'));
  } catch (e) { return fail(e); }
}

export async function PUT(req, { params }) {
  try {
    const id = safeId((await params).id);
    const p = await principalOf(req);
    const isNew = !(await readReport(id));
    if (isNew) await canCreateIn(p, null); else await checkReport(p, id, 'edit');
    const def = await readDefinition(req);
    const v = validate(def);
    if (isNew) await recordNewReport(p, id, null);
    // Save even with errors: the designer may hold work in progress.
    await writeReport(id, def);
    await audit(isNew ? 'report.create' : 'report.update', { req, principal: p, report: id });
    return Response.json({ ok: true, errors: v.errors, warnings: v.warnings });
  } catch (e) { return fail(e); }
}

export async function DELETE(req, { params }) {
  try {
    const id = safeId((await params).id);
    const p = await principalOf(req);
    await checkReport(p, id, 'manage');
    await deleteReport(id);
    await forgetReport(id);
    await audit('report.delete', { req, principal: p, report: id });
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
