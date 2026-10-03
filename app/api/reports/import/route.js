// Import an ActiveReportsJS report: POST the .rdlx-json file's JSON (at most 5 MB); ?name= sets the report name
// (the home page sends the file name, so drill-through and subreport links between imported reports line up).
import { readDefinition, writeReport, newId } from '@/server/reports.js';
import { importRdlx } from '@/importers/rdlx.js';

export const runtime = 'nodejs';

const AR_KEYS = ['Body', 'ReportSections', 'FixedPage', 'PageHeader', 'PageFooter', 'DataSources', 'DataSets', 'ReportParameters'];

export async function POST(req) {
  let body;
  try { body = await readDefinition(req); } catch (e) { return Response.json({ error: e.message }, { status: e.status || 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !AR_KEYS.some(k => k in body)) {
    return Response.json({ error: 'This is not an ActiveReports report: it has no Body, ReportSections or FixedPage.' }, { status: 400 });
  }
  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 120) || undefined;
  const { definition, warnings, stats } = importRdlx(body, { name });
  try {
    const id = await newId(definition.name);
    await writeReport(id, definition);
    return Response.json({ id, warnings, stats }, { status: 201 });
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
