// GET: the definition (view), with its revision as the ETag. PUT: save (edit; a new id is a new report, as POST
// /api/reports). Saving an existing report needs If-Match: the revision it was edited from (or * to overwrite on
// purpose): a stale one is 409 { error, rev } with the current revision, a missing one 428, so two editors
// never overwrite each other silently. A 200 means the save is stored: the next read anywhere returns it. DELETE: manage.
// A report the caller may not view is "not found" whatever the method.
import { writeReport, deleteReport, safeId, readDefinition, revOf } from '@/server/reports.js';
import { validate } from '@/engine/schema/validate.js';
import { principalOf, readReportFor, checkReport, canCreateIn, recordNewReport, forgetReport, stampDefinition, withReport, stableCheck } from '@/server/perms.js';
import { audit } from '@/server/audit.js';
import { store } from '@/server/storage/index.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

const fail = (e) => errorResponse(e);

export async function GET(req, { params }) {
  try {
    const id = safeId((await params).id);
    const p = await principalOf(req);
    const def = await readReportFor(p, id, 'view');
    await audit('report.view', { req, principal: p, report: id, detail: { via: 'api' } });
    const rev = id.includes('@') ? null : revOf(await store().get('reports', id));
    return Response.json(def, { headers: rev ? { etag: `"${rev}"`, 'cache-control': 'no-store' } : {} });
  } catch (e) { return fail(e); }
}

export async function PUT(req, { params }) {
  try {
    const id = safeId((await params).id);
    const p = await principalOf(req);
    const def = await readDefinition(req);
    const v = validate(def);
    // the check and the write under one lock: a revoke cannot land between them
    // this report's lock (not every report's), and a check no permission change overtook (perms.stableCheck)
    const want = ifMatch(req);
    const { fresh: isNew, rev } = await withReport(id, async () => {
      const now = await store().get('reports', id);
      const fresh = now == null;
      // a new id where the user may not create answers as a hidden report does (the id does not leak)
      await stableCheck(() => (fresh ? canCreateIn(p, null).catch((e) => { throw e.status === 403 ? Object.assign(new Error('Report not found'), { status: 404 }) : e; }) : checkReport(p, id, 'edit')));
      // the lost-update check, under the report's lock (after the access check: no revision leaks to who may not edit)
      if (!fresh && want == null) throw conflict(428, 'Send If-Match with the revision you edited (the ETag of GET /api/reports/<id>), or If-Match: * to overwrite.', now, id);
      if (!fresh && want !== '*' && want !== revOf(now)) throw conflict(409, 'Someone saved this report after you opened it. Reload it, or save again with its new revision to overwrite.', now, id);
      if (fresh && want != null && want !== '*') throw conflict(409, 'This report was deleted after you opened it.', null, id);
      // SQL or internal data in it: designers only, and recorded so that it runs (readRunnable)
      if (fresh) await recordNewReport(p, id, null, def); else await stampDefinition(p, id, def);
      // Save even with errors: the designer may hold work in progress.
      return { fresh, rev: await writeReport(id, def) };
    });
    await audit(isNew ? 'report.create' : 'report.update', { req, principal: p, report: id });
    return Response.json({ ok: true, rev, errors: v.errors, warnings: v.warnings }, { headers: { etag: `"${rev}"` } });
  } catch (e) { return fail(e); }
}

/** The revision If-Match names ('*', a revision, or null when there is none). @param {Request} req */
function ifMatch(req) {
  const h = req.headers.get('if-match');
  if (h == null || !h.trim()) return null;
  return h.trim() === '*' ? '*' : h.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
}
/** A 409/428 that tells the editor the current revision (and when it was saved). */
function conflict(status, msg, text, id) {
  return Object.assign(new Error(msg), { status, body: { rev: revOf(text), id } });
}

export async function DELETE(req, { params }) {
  try {
    const id = safeId((await params).id);
    const p = await principalOf(req);
    await withReport(id, async () => {
      await stableCheck(() => checkReport(p, id, 'manage'));
      await deleteReport(id);
      await forgetReport(id);
    });
    await audit('report.delete', { req, principal: p, report: id });
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
