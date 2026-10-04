// GET /api/reports[?q=text&folder=id] — the reports the caller may view, each with its access level and folder.
// POST { name, definition? | template?, folder? } — a new report in that folder (edit there needed); its creator manages it.
import { listReports, writeReport, newId, readDefinition } from '@/server/reports.js';
import { blankReport, blankDashboard } from '@/engine/schema/template.js';
import { principalOf, visibleReports, canCreateIn, recordNewReport, folderParam } from '@/server/perms.js';
import { audit } from '@/server/audit.js';
import { withLock } from '@/server/storage/index.js';

export const runtime = 'nodejs';
const fail = (e) => Response.json({ error: e.message }, { status: e.status || 500 });

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    let list = await visibleReports(await principalOf(req), await listReports());
    const q = (sp.get('q') || '').trim().toLowerCase().slice(0, 200);
    if (q) list = list.filter(r => r.name.toLowerCase().includes(q) || r.id.includes(q));
    if (sp.has('folder')) { const f = folderParam(sp.get('folder')); list = list.filter(r => r.folder === f); }
    return Response.json(list);
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  let body;
  try { body = await readDefinition(req); } catch (e) { if (e.status === 413) return Response.json({ error: e.message }, { status: 413 }); body = {}; }
  try {
    const p = await principalOf(req);
    const folder = folderParam(body.folder);
    const name = String(body.name || 'Untitled report').slice(0, 120);
    const def = body.definition || (body.template === 'dashboard' ? blankDashboard(name) : blankReport(name));
    const id = await withLock('acl', async () => {
      await canCreateIn(p, folder, def); // SQL or internal data in it: designers only
      const nid = await newId(name);
      await recordNewReport(p, nid, folder, def);
      await writeReport(nid, def);
      return nid;
    });
    await audit('report.create', { req, principal: p, report: id, detail: { folder, template: body.definition ? 'definition' : body.template || 'blank' } });
    return Response.json({ id }, { status: 201 });
  } catch (e) { return fail(e); }
}
