// Import a report: POST an ActiveReportsJS .rdlx-json file's JSON, or (as XML) an SSRS .rdl/.rdlc, JasperReports .jrxml or
// BIRT .rptdesign file (at most 5 MB); ?name= sets the report name
// (the home page sends the file name, so drill-through and subreport links between imported reports line up).
import { readDefinition } from '@/server/reports.js';
import { importRdlx } from '@/importers/rdlx.js';
import { importXmlReport } from '@/importers/index.js';
import { principalOf, createReport, folderParam } from '@/server/perms.js';
import { audit } from '@/server/audit.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

const AR_KEYS = ['Body', 'ReportSections', 'FixedPage', 'PageHeader', 'PageFooter', 'DataSources', 'DataSets', 'ReportParameters'];

async function readXml(req) {
  const tooBig = () => Object.assign(new Error('A report can be at most 5 MB'), { status: 413 });
  if (Number(req.headers.get('content-length')) > 5 * 1024 * 1024) throw tooBig();
  const text = await req.text();
  if (text.length > 5 * 1024 * 1024) throw tooBig();
  return text;
}

export async function POST(req) {
  let body;
  // SSRS, JasperReports and BIRT reports are XML: the home page sends them as application/xml
  const xml = /xml/i.test(req.headers.get('content-type') || '');
  try { body = xml ? await readXml(req) : await readDefinition(req); } catch (e) { return Response.json({ error: e.message }, { status: e.status || 400 }); }
  if (!xml && (!body || typeof body !== 'object' || Array.isArray(body) || !AR_KEYS.some(k => k in body))) {
    return Response.json({ error: 'This is not an ActiveReports report: it has no Body, ReportSections or FixedPage.' }, { status: 400 });
  }
  const sp = new URL(req.url).searchParams;
  const name = sp.get('name')?.trim().slice(0, 120) || undefined;
  try {
    const p = await principalOf(req);
    const folder = folderParam(sp.get('folder'));
    const { definition, warnings, stats, error } = xml ? importXmlReport(body, { name }) : importRdlx(body, { name });
    if (error) return Response.json({ error }, { status: 400 });
    const id = await createReport(p, definition.name, folder, definition); // its own id, under its own lock
    await audit('report.import', { req, principal: p, report: id, detail: { folder, warnings: warnings.length } });
    return Response.json({ id, warnings, stats }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
