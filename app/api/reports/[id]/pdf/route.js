// GET /api/reports/<id>/pdf?param=value[&format=xlsx|html|csv] — server-side render for links and quick checks.
import { readReport, safeId } from '@/server/reports.js';
import { renderTo, baseUrl } from '@/server/renderer.js';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const def = await readReport(safeId(id));
    if (!def) return Response.json({ error: 'Report not found' }, { status: 404 });
    const url = new URL(req.url);
    const parameters = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'format'));
    const format = url.searchParams.get('format') || 'pdf';
    const r = await renderTo(def, { parameters, format, baseUrl: baseUrl(req) });
    return new Response(r.bytes, {
      headers: {
        'content-type': r.contentType,
        'content-disposition': `inline; filename="${id}.${r.ext}"`,
        'x-pagewright-pages': String(r.model.pages.length),
        'x-pagewright-ms': String(r.model.stats.ms),
      },
    });
  } catch (e) {
    return Response.json({ error: e.message, missingParameters: e.missingParameters }, { status: e.status || (e.missingParameters ? 400 : 500) });
  }
}
