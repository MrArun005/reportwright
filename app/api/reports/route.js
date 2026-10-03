import { listReports, writeReport, newId, readDefinition } from '@/server/reports.js';
import { blankReport } from '@/engine/schema/template.js';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(await listReports());
}

export async function POST(req) {
  let body;
  try { body = await readDefinition(req); } catch (e) { if (e.status === 413) return Response.json({ error: e.message }, { status: 413 }); body = {}; }
  const name = String(body.name || 'Untitled report').slice(0, 120);
  const id = await newId(name);
  await writeReport(id, body.definition || blankReport(name));
  return Response.json({ id }, { status: 201 });
}
