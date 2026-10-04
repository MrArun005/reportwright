// GET: the definition (view). PUT: save (edit; a new id is a new report, as POST /api/reports). DELETE: manage.
// A report the caller may not view is "not found" whatever the method.
import { readReport, writeReport, deleteReport, safeId, readDefinition } from '@/server/reports.js';
import { validate } from '@/engine/schema/validate.js';
import { principalOf, readReportFor, checkReport, canCreateIn, recordNewReport, forgetReport } from '@/server/perms.js';
import { audit } from '@/server/audit.js';
import { withLock } from '@/server/storage/index.js';

export const runtime = 'nodejs';

const fail = (e) => Response.json({ error: e.message }, { status: e.status || 500 });

export async function GET(req, { params }) {
  try {
    const id = safeId((await params).id);
    const p = await principalOf(req);
    const def = await readReportFor(p, id, 'view');
    await audit('report.view', { req, principal: p, report: id, detail: { via: 'api' } });
    return Response.json(def);
  } catch (e) { return fail(e); }
}

export async function PUT(req, { params }) {
  try {
    const id = safeId((await params).id);
    const p = await principalOf(req);
    const def = await readDefinition(req);
    const v = validate(def);
    // the check and the write under one lock: a revoke cannot land between them
    const isNew = await withLock('acl', async () => {
      const fresh = !(await readReport(id));
      // a new id where the user may not create answers as a hidden report does (the id does not leak)
      if (fresh) await canCreateIn(p, null).catch((e) => { throw e.status === 403 ? Object.assign(new Error('Report not found'), { status: 404 }) : e; });
      else await checkReport(p, id, 'edit');
      if (fresh) await recordNewReport(p, id, null);
      // Save even with errors: the designer may hold work in progress.
      await writeReport(id, def);
      return fresh;
    });
    await audit(isNew ? 'report.create' : 'report.update', { req, principal: p, report: id });
    return Response.json({ ok: true, errors: v.errors, warnings: v.warnings });
  } catch (e) { return fail(e); }
}

export async function DELETE(req, { params }) {
  try {
    const id = safeId((await params).id);
    const p = await principalOf(req);
    await withLock('acl', async () => {
      await checkReport(p, id, 'manage');
      await deleteReport(id);
      await forgetReport(id);
    });
    await audit('report.delete', { req, principal: p, report: id });
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
