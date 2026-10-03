import { listReports, writeReport, newId } from '@/server/reports.js';
import { blankReport } from '@/engine/schema/template.js';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(await listReports());
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || 'Untitled report').slice(0, 120);
  const id = await newId(name);
  await writeReport(id, body.definition || blankReport(name));
  return Response.json({ id }, { status: 201 });
}
